# scan_blender.py — Blender (4.2 LTS) half of tools/scan/import.mjs. Run by import.mjs:
#   Blender -b --factory-startup -P tools/scan/scan_blender.py -- <job.json>
# One scanned object in → <work>/<name>.glb (LOD0/1/2, shared baked textures) + textures PNG + thumbnails + blender_meta.json.
# See SCAN.md ("Mesh path") for the method; every step is logged with its timing.
import bpy, bmesh, sys, json, math, os, time
import numpy as np
from mathutils import Vector, Matrix

T0 = time.time()
job = json.load(open(sys.argv[sys.argv.index('--') + 1]))
W = job['work']; os.makedirs(W, exist_ok=True)
NAME = job['name']
META = {'name': NAME, 'source': os.path.basename(job['input']), 'steps': {}}
def log(*a): print('[scan_blender]', f'{time.time() - T0:6.1f}s', *a, flush=True)
def step(k, t): META['steps'][k] = round(time.time() - t, 2)
LUMW = np.array([0.2126, 0.7152, 0.0722], np.float32)

# ------------------------------------------------------------------ helpers
def sel_only(*objs, active=None):
    bpy.context.view_layer.update()
    for o in list(bpy.context.view_layer.objects): o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]

def tris_of(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)

def dup(o, name):
    c = o.copy(); c.data = o.data.copy(); c.name = name; c.data.name = name
    bpy.context.scene.collection.objects.link(c); return c

def apply_mod(o, mod):
    sel_only(o); bpy.ops.object.modifier_apply(modifier=mod.name)

def decimate_to(o, target):
    n = tris_of(o)
    if n <= target: return
    # protect the ground contact ring: without it low LODs collapse a flat base into a cone
    zs = [v.co.z for v in o.data.vertices]; zt = max(zs) * 0.04; prot = job.get('protectBase', True)
    # (Blender collapse: weight 1 = free to collapse, lower = kept longer)
    vg = o.vertex_groups.get('dec') or o.vertex_groups.new(name='dec')
    vg.add([v.index for v in o.data.vertices if v.co.z > zt], 1.0, 'REPLACE'); vg.add([v.index for v in o.data.vertices if v.co.z <= zt], 0.25, 'REPLACE')
    for _ in range(6):                                  # collapse ratio is approximate: correct a few times
        m = o.modifiers.new('dec', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = max(0.0005, target / tris_of(o)); m.use_collapse_triangulate = True
        if prot: m.vertex_group = 'dec'; m.vertex_group_factor = 1.0
        apply_mod(o, m)
        if tris_of(o) <= target * 1.08: break

def to_srgb(x):
    x = np.clip(x, 0, 1); return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)
def to_lin(x):
    x = np.clip(x, 0, 1); return np.where(x <= 0.04045, x / 12.92, np.power((x + 0.055) / 1.055, 2.4))

def img_new(name, size, float_buffer=True):
    im = bpy.data.images.new(name, size, size, alpha=True, float_buffer=float_buffer)
    im.generated_color = (0, 0, 0, 0); return im
def img_get(im):
    a = np.empty(im.size[0] * im.size[1] * 4, np.float32); im.pixels.foreach_get(a); return a.reshape(im.size[1], im.size[0], 4)
def img_save(arr, path, noncolor):
    h, w = arr.shape[:2]; name = os.path.splitext(os.path.basename(path))[0]
    im = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False)
    rgba = np.ones((h, w, 4), np.float32); rgba[..., :3] = np.clip(arr[..., :3], 0, 1)
    im.pixels.foreach_set(rgba.ravel()); im.filepath_raw = path; im.file_format = 'PNG'; im.save()
    bpy.data.images.remove(im)
    im = bpy.data.images.load(path); im.name = name
    if noncolor: im.colorspace_settings.name = 'Non-Color'
    return im

# ------------------------------------------------------------------ 1. import
t = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
src = job['input']; ext = os.path.splitext(src)[1].lower()
if ext in ('.glb', '.gltf'): bpy.ops.import_scene.gltf(filepath=src)
elif ext == '.obj': bpy.ops.wm.obj_import(filepath=src, forward_axis='NEGATIVE_Z', up_axis='Y')
elif ext == '.ply': bpy.ops.wm.ply_import(filepath=src, forward_axis='NEGATIVE_Z', up_axis='Y')
elif ext == '.fbx': bpy.ops.import_scene.fbx(filepath=src)
elif ext in ('.usdz', '.usd', '.usdc', '.usda'): bpy.ops.wm.usd_import(filepath=src)
elif ext == '.stl': bpy.ops.wm.stl_import(filepath=src, forward_axis='NEGATIVE_Z', up_axis='Y')
else: raise SystemExit('unsupported input ' + ext)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not meshes: raise SystemExit('no mesh in ' + src)
for o in list(bpy.context.scene.objects):
    if o.type != 'MESH': continue
    mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
for o in list(bpy.context.scene.objects):
    if o.type != 'MESH': bpy.data.objects.remove(o)
sel_only(*meshes); bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(meshes) > 1: bpy.ops.object.join()
HIGH = bpy.context.view_layer.objects.active; HIGH.name = 'HIGH'
# a texture given explicitly (OBJ whose .mtl is missing — RealityCapture / some exports): put it on every face
if job.get('texture'):
    m = bpy.data.materials.new('tex'); m.use_nodes = True; nt = m.node_tree
    ti = nt.nodes.new('ShaderNodeTexImage'); ti.image = bpy.data.images.load(job['texture'])
    nt.links.new(ti.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    HIGH.data.materials.clear(); HIGH.data.materials.append(m)
    for p_ in HIGH.data.polygons: p_.material_index = 0
# vertex-colour meshes (PLY / some OBJ) without material: give them one that reads the colour attribute
if not HIGH.data.materials or all(m is None for m in HIGH.data.materials):
    m = bpy.data.materials.new('vcol'); m.use_nodes = True; nt = m.node_tree
    ca = nt.nodes.new('ShaderNodeVertexColor'); nt.links.new(ca.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    HIGH.data.materials.clear(); HIGH.data.materials.append(m)
META['highTrisIn'] = tris_of(HIGH)
log('imported', src, META['highTrisIn'], 'tris')
step('import', t)

# ------------------------------------------------------------------ 2. orientation + scale
t = time.time()
GL2B = {'x': Vector((1, 0, 0)), 'y': Vector((0, 0, 1)), 'z': Vector((0, -1, 0))}   # glTF/three axis → Blender axis
up = str(job.get('up', 'y')).lower()
if up not in ('y', '+y', 'auto'):
    sgn = -1 if up.startswith('-') else 1; v = GL2B[up.strip('+-')] * sgn
    q = v.rotation_difference(Vector((0, 0, 1)))
    HIGH.data.transform(q.to_matrix().to_4x4())
yaw = float(job.get('yaw', 0))
if yaw: HIGH.data.transform(Matrix.Rotation(math.radians(yaw), 4, 'Z'))
def bounds(o):
    co = np.empty(len(o.data.vertices) * 3, np.float32); o.data.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    return co.min(0), co.max(0), co
lo, hi, _ = bounds(HIGH)
s = float(job.get('scale', 1) or 1)
if job.get('height'): s = float(job['height']) / max(1e-6, (hi[2] - lo[2]))
if s != 1: HIGH.data.transform(Matrix.Scale(s, 4))
META['scaleApplied'] = s
step('orient', t)

# ------------------------------------------------------------------ 3. cleanup: weld, floaters, ground cut, holes
t = time.time()
lo, hi, co = bounds(HIGH); diag = float(np.linalg.norm(hi - lo)); H0 = float(hi[2] - lo[2])
bm = bmesh.new(); bm.from_mesh(HIGH.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=diag * 2e-5)
# ground: Scaniverse keeps a patch of the floor around the object. auto = a flat, up-facing layer at the bottom that covers
# a large share of the footprint → cut just above it; number = cut height above the lowest point (m); off = keep.
cut = job.get('cutGround', 'auto'); cutAt = None
bm.faces.ensure_lookup_table()
if cut == 'auto':
    zs, ar = [], []
    for f in bm.faces:
        if f.normal.z > 0.9:
            c = f.calc_center_median()
            if c.z < lo[2] + 0.2 * H0: zs.append(c.z); ar.append(f.calc_area())
    if zs:
        zs, ar = np.array(zs), np.array(ar); binw = max(0.005, H0 * 0.01)
        hist, edges = np.histogram(zs, bins=max(4, int((zs.max() - zs.min()) / binw) + 1), weights=ar)
        k = int(hist.argmax()); z0 = (edges[k] + edges[k + 1]) / 2; flatA = hist[max(0, k - 2):k + 3].sum()
        foot = (hi[0] - lo[0]) * (hi[1] - lo[1])
        META['groundProbe'] = {'z': round(float(z0 - lo[2]), 3), 'flatArea': round(float(flatA), 3), 'bboxFootprint': round(float(foot), 3)}
        if flatA > 0.3 * foot: cutAt = z0 + max(0.01, H0 * 0.01)
elif cut not in ('off', None, False):
    cutAt = lo[2] + float(cut)
if cutAt is not None:
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, cutAt), plane_no=(0, 0, 1), clear_inner=True)
    META['groundCutAt'] = round(float(cutAt - lo[2]), 3)
# floaters: drop disconnected islands with < minIsland of the largest island's area
def drop_islands(bm, frac):
    bm.faces.ensure_lookup_table(); seen = set(); islands = []
    for f in bm.faces:
        if f.index in seen: continue
        stack = [f]; seen.add(f.index); isl = []
        while stack:
            g = stack.pop(); isl.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen: seen.add(h.index); stack.append(h)
        islands.append((sum(x.calc_area() for x in isl), isl))
    islands.sort(key=lambda x: -x[0])
    small = [isl for a, isl in islands[1:] if a < islands[0][0] * frac]
    bmesh.ops.delete(bm, geom=[f for isl in small for f in isl], context='FACES')
    return len(small)
META['islandsRemoved'] = drop_islands(bm, float(job.get('minIsland', 0.03)))
bm.to_mesh(HIGH.data); bm.free()
# centre: footprint centre on x/z (game), base at y = 0
lo, hi, co = bounds(HIGH)
HIGH.data.transform(Matrix.Translation((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2])))
lo, hi, co = bounds(HIGH); diag = float(np.linalg.norm(hi - lo)); R = diag / 2
META['highTris'] = tris_of(HIGH)
log('clean: tris', META['highTris'], 'ground cut', META.get('groundCutAt'), 'floaters', META['islandsRemoved'], 'dims', (hi - lo).round(3))
step('clean', t)

# ------------------------------------------------------------------ 4. closed shell (hole fill + voxel remesh) → LOD meshes → UVs
t = time.time()
SHELL = dup(HIGH, 'SHELL'); SHELL.data.materials.clear()
bm = bmesh.new(); bm.from_mesh(SHELL.data)
bnd = [e for e in bm.edges if e.is_boundary]
if bnd:
    res = bmesh.ops.holes_fill(bm, edges=bnd, sides=0)
    bmesh.ops.triangulate(bm, faces=res['faces'])
bm.to_mesh(SHELL.data); bm.free()
def make_shell(div):
    """closed, manifold shell at voxel size diag/div; voxel crumbs (spines, twigs) under 2 % of the main island dropped;
    base flattened onto y = 0. A coarser voxel for a smaller budget also closes tunnels/handles (high genus stalls decimation)."""
    sh = dup(SHELL, 'SHELL%d' % div)
    if job.get('remesh', 'voxel') == 'voxel':
        m = sh.modifiers.new('rm', 'REMESH'); m.mode = 'VOXEL'; m.voxel_size = diag / div; m.adaptivity = 0; m.use_smooth_shade = True
        apply_mod(sh, m)
    bm = bmesh.new(); bm.from_mesh(sh.data); crumbs = drop_islands(bm, 0.02)
    for v in bm.verts:
        if v.co.z < 0: v.co.z = 0
    bm.to_mesh(sh.data); bm.free(); return sh, crumbs
lods = []; META['voxel'] = []; div0 = float(job.get('voxelDiv', 260)); t0n = float(job['tris'][0])
for i, n in enumerate(job['tris']):
    div = max(24, div0 * math.sqrt(float(n) / t0n)) if job.get('remesh', 'voxel') == 'voxel' else 0
    sh, crumbs = make_shell(div) if div else (dup(SHELL, 'S'), 0)
    decimate_to(sh, int(n)); sh.name = sh.data.name = f'LOD{i}'; lods.append(sh)
    for p in sh.data.polygons: p.use_smooth = True
    META['voxel'].append({'size': round(diag / div, 4) if div else None, 'crumbsRemoved': crumbs})
bm = bmesh.new(); bm.from_mesh(lods[0].data); META['volume'] = round(abs(bm.calc_volume()), 4); bm.free()
if job.get('pylib'): sys.path.insert(0, job['pylib'])
try:
    import xatlas
except Exception:
    xatlas = None
TEX = int(job['tex'])
TEXS = [max(128, TEX >> i) for i in range(len(lods))]      # LOD0 full, LOD1 half, LOD2 quarter
def unwrap(o, res):
    """xatlas (few big charts → few seams → fewer split vertices in the GLB) when available, else Blender smart project.
    The flat underside (filled hole / ground contact) is never seen and has nothing to bake: it gets no texels."""
    me = o.data; info = {}
    V = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', V); V = V.reshape(-1, 3)
    F = np.empty(len(me.polygons) * 3, np.int32); me.polygons.foreach_get('vertices', F); F = F.reshape(-1, 3)
    FN = np.empty(len(me.polygons) * 3, np.float32); me.polygons.foreach_get('normal', FN); FN = FN.reshape(-1, 3)
    Hb = V[:, 2].max(); bottom = (FN[:, 2] < -0.9) & (V[F].mean(1)[:, 2] < Hb * 0.03)
    if xatlas is not None and job.get('uv', 'xatlas') == 'xatlas':
        keep = np.flatnonzero(~bottom)
        at = xatlas.Atlas(); at.add_mesh(V, F[keep])
        co_ = xatlas.ChartOptions(); co_.max_cost = float(job.get('uvMaxCost', 4.0))
        po = xatlas.PackOptions(); po.resolution = res; po.padding = max(2, res // 170); po.bilinear = True; po.blockAlign = True
        at.generate(co_, po)
        vm_, ind, uv = at[0]
        uvl = me.uv_layers.new(name='UVMap') if not me.uv_layers else me.uv_layers[0]
        L = np.zeros((len(me.polygons), 3, 2), np.float32); L[keep] = uv[ind]
        if bottom.any(): L[bottom] = uv[ind][0, 0]
        uvl.data.foreach_set('uv', L.ravel())
        info = {'method': 'xatlas', 'charts': at.chart_count, 'uvVerts': int(len(vm_))}
    else:
        sel_only(o); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(float(job.get('uvAngle', 70))), island_margin=0.004, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode='OBJECT')
        bm = bmesh.new(); bm.from_mesh(me); uvl = bm.loops.layers.uv.active; bm.faces.ensure_lookup_table()
        for fi in np.flatnonzero(bottom):
            f = bm.faces[int(fi)]; c = sum((l[uvl].uv for l in f.loops), Vector((0, 0))) / len(f.loops)
            for l in f.loops: l[uvl].uv = c + (l[uvl].uv - c) * 0.02
        bm.to_mesh(me); bm.free()
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.pack_islands(margin=0.003, rotate=True); bpy.ops.object.mode_set(mode='OBJECT')
        info = {'method': 'smart_project'}
    U = np.empty(len(me.loops) * 2, np.float32); me.uv_layers[0].data.foreach_get('uv', U); U = U.reshape(-1, 3, 2)
    e1, e2 = U[:, 1] - U[:, 0], U[:, 2] - U[:, 0]; info['uvUsed'] = round(float(np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]).sum() / 2), 3)
    info['bottomFaces'] = int(bottom.sum()); return info
META['uv'] = []
for o, res in zip(lods, TEXS):
    tu = time.time(); META['uv'].append(unwrap(o, res)); log(o.name, tris_of(o), 'tris · uv', META['uv'][-1], f'{time.time() - tu:.1f}s')
step('lods_uv', t)

# ------------------------------------------------------------------ 5. bake high → each LOD (Cycles)
t = time.time()
sc = bpy.context.scene; sc.render.engine = 'CYCLES'
try:
    pr = bpy.context.preferences.addons['cycles'].preferences; pr.compute_device_type = job.get('device', 'METAL'); pr.get_devices()
    for d in pr.devices: d.use = True
    sc.cycles.device = 'GPU' if any(d.use and d.type != 'CPU' for d in pr.devices) else 'CPU'
except Exception as e: sc.cycles.device = 'CPU'
META['bakeDevice'] = sc.cycles.device
if sc.world is None: sc.world = bpy.data.worlds.new('w')
sc.world.use_nodes = True; sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0
sc.world.light_settings.distance = max(0.05, R * float(job.get('aoDist', 0.35)))
VIS = ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow')
for o in lods + [SHELL]:
    for v in VIS: setattr(o, v, False)                  # cages must not occlude / shade the scan they sample
SHELL.hide_render = True
# high materials → emission of their base colour (works for Principled, glTF unlit, vertex colour)
for mt in HIGH.data.materials:
    if mt is None or not mt.use_nodes: continue
    nt = mt.node_tree; out = next((n for n in nt.nodes if n.bl_idname == 'ShaderNodeOutputMaterial' and n.is_active_output), None) or nt.nodes.new('ShaderNodeOutputMaterial')
    srcsock = None
    for n in nt.nodes:
        if n.bl_idname == 'ShaderNodeBsdfPrincipled' and n.inputs['Base Color'].is_linked: srcsock = n.inputs['Base Color'].links[0].from_socket; break
    if srcsock is None:
        n = next((n for n in nt.nodes if n.bl_idname == 'ShaderNodeTexImage'), None) or next((n for n in nt.nodes if n.bl_idname in ('ShaderNodeVertexColor', 'ShaderNodeAttribute')), None)
        if n: srcsock = n.outputs[0]
    em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = 1
    if srcsock is not None: nt.links.new(srcsock, em.inputs['Color'])
    else:
        p = next((n for n in nt.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
        if p: em.inputs['Color'].default_value = p.inputs['Base Color'].default_value
    nt.links.new(em.outputs[0], out.inputs['Surface'])
ext_ = diag * 0.012; ray = diag * 0.05
def bake_lod(o, res):
    bakemat = bpy.data.materials.new('bake_' + o.name); bakemat.use_nodes = True; o.data.materials.clear(); o.data.materials.append(bakemat)
    bn = bakemat.node_tree.nodes.new('ShaderNodeTexImage'); bakemat.node_tree.nodes.active = bn
    sel_only(HIGH, o, active=o)
    # the lower LODs sit inside/outside the scan by more than LOD0 does: widen the cage with the decimation error
    k = 1 + 0.8 * (res < TEX) + 0.8 * (res < TEX // 2)
    def bake(kind, name, samples=1, margin=None, **kw):
        im = img_new(name, res); bn.image = im; sc.cycles.samples = samples; tb = time.time()
        bpy.ops.object.bake(type=kind, use_selected_to_active=True, cage_extrusion=ext_ * k, max_ray_distance=ray * k, margin=max(2, res // 64) if margin is None else margin,
                            margin_type='EXTEND', use_clear=True, target='IMAGE_TEXTURES', **kw)
        return img_get(im)
    out = {'mask': bake('EMIT', 'mask', margin=0)[..., 3] > 0.5, 'col': bake('EMIT', 'col')[..., :3],
           'nobj': bake('NORMAL', 'nobj', normal_space='OBJECT')[..., :3] * 2 - 1, 'ntan': bake('NORMAL', 'ntan', normal_space='TANGENT')[..., :3],
           'ao': bake('AO', 'ao', samples=int(job.get('aoSamples', 48)))[..., 0]}
    return out
BK = []
for o, res in zip(lods, TEXS):
    tb = time.time(); BK.append(bake_lod(o, res)); log('baked', o.name, res, f'{time.time() - tb:.1f}s')
META['coverage'] = round(float(BK[0]['mask'].mean()), 3)
step('bake', t)

# ------------------------------------------------------------------ 6. delight + night grade (numpy, linear) — fitted on LOD0, applied to every LOD
t = time.time()
dl = job.get('delight', {}); kAO = float(dl.get('ao', 0.6)); kDir = float(dl.get('dir', 1.0))
def unao(b): return b['col'] / (1 - kAO + kAO * np.clip(b['ao'], 0.15, 1))[..., None]   # 6a: remove baked cavity darkening (partial: sky occlusion is softer than AO)
b0 = BK[0]; c1 = unao(b0); lum = c1 @ LUMW
m = b0['mask'] & (lum > 1e-4)
idx = np.flatnonzero(m.ravel()); rng = np.random.default_rng(1); idx = rng.choice(idx, min(len(idx), 80000), replace=False) if len(idx) else idx
N = b0['nobj'].reshape(-1, 3)[idx]; L = lum.ravel()[idx]
A = np.c_[np.ones(len(idx)), N]; w = np.ones(len(idx))
for _ in range(4):                                      # 6b: robust (IRLS) fit lum ≈ c0 + c·n  (order-1 spherical harmonics = baked sun + sky)
    sw = np.sqrt(w); coef, *_ = np.linalg.lstsq(A * sw[:, None], L * sw, rcond=None)
    r = L - A @ coef; sc_ = np.median(np.abs(r)) * 1.4826 + 1e-6; w = 1 / np.maximum(1, np.abs(r) / (2 * sc_))
c0, cv = float(coef[0]), coef[1:]
def shading(nobj):
    S = (c0 + nobj @ cv) / max(c0, 1e-4); return 1 + (np.clip(S, 0.35, 2.0) - 1) * kDir
c2_0 = c1 / shading(b0['nobj'])[..., None]
dirStrength = float(np.linalg.norm(cv) / max(c0, 1e-4)); ldir = cv / (np.linalg.norm(cv) + 1e-9)
corr_before = float(np.corrcoef(b0['col'].reshape(-1, 3)[idx] @ LUMW, N @ ldir)[0, 1]) if len(idx) > 10 else 0
corr_after = float(np.corrcoef(c2_0.reshape(-1, 3)[idx] @ LUMW, N @ ldir)[0, 1]) if len(idx) > 10 else 0
mean2 = float(np.median((c2_0 @ LUMW)[m])) if m.any() else 0.2
tgt = float(job.get('targetLum', 0.16)); pull = float(dl.get('expo', 0.75)); expo = (tgt / max(mean2, 1e-4)) ** pull   # 6d: exposure → role target albedo
g = job.get('grade', {}); desat = float(g.get('desat', 0)); mul = np.array(g.get('mul', [1, 1, 1]), np.float32)
rough = float(job.get('roughness', 0.9)); metal = float(job.get('metalness', 0))
mats = []
for i, (o, b, res) in enumerate(zip(lods, BK, TEXS)):
    c2 = unao(b) / shading(b['nobj'])[..., None] * expo
    l3 = (c2 @ LUMW)[..., None]; c3 = (c2 + (l3 - c2) * desat) * mul      # 6e: night grade from style.js (desaturate, multiply)
    if i == 0:
        META['delight'] = {'aoStrength': kAO, 'dirStrength': round(dirStrength, 3), 'lightDirGame': [round(float(ldir[0]), 3), round(float(ldir[2]), 3), round(float(-ldir[1]), 3)],
                           'corrShadingBefore': round(corr_before, 3), 'corrShadingAfter': round(corr_after, 3), 'medianLumIn': round(float(np.median((b['col'] @ LUMW)[m])) if m.any() else 0, 4),
                           'medianLumDelit': round(mean2, 4), 'targetLum': tgt, 'medianLumOut': round(float(np.median((c3 @ LUMW)[m])) if m.any() else 0, 4), 'grade': {'desat': desat, 'mul': [round(float(x), 3) for x in mul]}}
        log('delight', META['delight'])
        img_save(to_srgb(b['col']), os.path.join(W, 'albedo_raw.png'), False)
    # 6f: ORM = AO (three applies it to ambient/hemi light only) · roughness · metalness; half size (low-frequency)
    hp = (c3 @ LUMW); mk = b['mask']; hp = hp / (np.median(hp[mk]) + 1e-4) if mk.any() else hp
    orm = np.stack([np.clip(b['ao'], 0, 1) ** 0.8, np.clip(rough + (1 - hp) * 0.05, 0.3, 1), np.full_like(b['ao'], metal)], -1)
    orm = orm.reshape(orm.shape[0] // 2, 2, orm.shape[1] // 2, 2, 3).mean((1, 3))
    sfx = '' if i == 0 else str(i)
    ims = (img_save(to_srgb(c3), os.path.join(W, f'albedo{sfx}.png'), False), img_save(b['ntan'], os.path.join(W, f'normal{sfx}.png'), True), img_save(orm, os.path.join(W, f'orm{sfx}.png'), True))
    # final material for this LOD
    mat = bpy.data.materials.new(f'{NAME}_lod{i}'); mat.use_nodes = True; nt = mat.node_tree; P = nt.nodes['Principled BSDF']
    def tex(im, loc):
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = im; n.location = loc; return n
    ta = tex(ims[0], (-600, 300)); nt.links.new(ta.outputs['Color'], P.inputs['Base Color'])
    tn = tex(ims[1], (-600, -300)); nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], P.inputs['Normal'])
    to = tex(ims[2], (-900, 0)); sp = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(to.outputs['Color'], sp.inputs['Color'])
    nt.links.new(sp.outputs['Green'], P.inputs['Roughness']); nt.links.new(sp.outputs['Blue'], P.inputs['Metallic'])
    grp = bpy.data.node_groups.get('glTF Material Output')
    if grp is None:
        grp = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree'); grp.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    gn = nt.nodes.new('ShaderNodeGroup'); gn.node_tree = grp; nt.links.new(sp.outputs['Red'], gn.inputs['Occlusion'])
    o.data.materials.clear(); o.data.materials.append(mat)
    for v in VIS: setattr(o, v, True)
step('delight', t)

# ------------------------------------------------------------------ 7. hierarchy + metadata
t = time.time()
lo, hi, _ = bounds(lods[0])
root = bpy.data.objects.new(NAME, None); sc.collection.objects.link(root)
for i, o in enumerate(lods): o.parent = root; o.name = f'{NAME}_LOD{i}'
R = float(np.linalg.norm(hi - lo) / 2)
lk = job.get('lodK', [0, 14, 40])
lodDist = [0] + [round(max(8 * i, R * float(lk[min(i, len(lk) - 1)])), 1) for i in range(1, len(lods))]
META['lodDist'] = lodDist
META['texSizes'] = TEXS
META['lods'] = [{'name': o.name, 'tris': tris_of(o), 'verts': len(o.data.vertices), 'tex': r_, 'uvVerts': u.get('uvVerts')} for o, r_, u in zip(lods, TEXS, META['uv'])]
META['bounds'] = {'min': [round(float(lo[0]), 3), round(float(lo[2]), 3), round(float(-hi[1]), 3)], 'max': [round(float(hi[0]), 3), round(float(hi[2]), 3), round(float(-lo[1]), 3)]}
META['size'] = [round(float(hi[0] - lo[0]), 3), round(float(hi[2] - lo[2]), 3), round(float(hi[1] - lo[1]), 3)]
META['radius'] = round(R, 3)
root['scan'] = json.dumps({'lodDist': lodDist, 'role': job.get('role'), 'size': META['size']})   # → userData.scan (JSON string)
BASE = lods[0]
bpy.data.objects.remove(SHELL)
step('lods', t)

# ------------------------------------------------------------------ 8. export GLB (JPEG textures, tangents, extras)
t = time.time()
sel_only(root, *lods, active=root)
glb = os.path.join(W, NAME + '.glb')
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_image_format='JPEG', export_image_quality=int(job.get('jpegQ', 88)),
                          export_tangents=True, export_extras=True, export_yup=True, export_apply=True, export_materials='EXPORT', export_draco_mesh_compression_enable=False,
                          export_animations=False, export_cameras=False, export_lights=False)
META['glbBytes'] = os.path.getsize(glb)
step('export', t)

# ------------------------------------------------------------------ 9. thumbnails: input vs output under the game's night rig
t = time.time()
def night_rig():
    for o in [o for o in sc.objects if o.type in ('LIGHT', 'CAMERA')]: bpy.data.objects.remove(o)
    wt = sc.world.node_tree; wn = wt.nodes['Background']; hs = job.get('hemiSky', [0.2, 0.28, 0.66])
    wn.inputs['Color'].default_value = (*hs, 1); wn.inputs['Strength'].default_value = float(job.get('hemiI', 1.2)) * 0.45
    fogb = wt.nodes.new('ShaderNodeBackground'); fogb.inputs['Color'].default_value = (*job.get('fog', [0.01, 0.025, 0.06]), 1)
    lp = wt.nodes.new('ShaderNodeLightPath'); mx = wt.nodes.new('ShaderNodeMixShader')
    wt.links.new(lp.outputs['Is Camera Ray'], mx.inputs[0]); wt.links.new(wn.outputs[0], mx.inputs[1]); wt.links.new(fogb.outputs[0], mx.inputs[2])
    wt.links.new(mx.outputs[0], wt.nodes['World Output'].inputs['Surface'])
    ld = bpy.data.lights.new('moon', 'SUN'); ld.energy = float(job.get('moonI', 2.8)) * 1.1; ld.color = job.get('moonCol', [0.87, 0.82, 0.78]); ld.angle = math.radians(1.5)
    lo_ = bpy.data.objects.new('moon', ld); sc.collection.objects.link(lo_); lo_.rotation_euler = (math.radians(55), 0, math.radians(35))
    cd = bpy.data.cameras.new('cam'); cd.lens = 60; cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam); sc.camera = cam
    ctr = Vector(((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2)); d = Vector((1.0, -1.35, 0.62)).normalized()
    fov = 2 * math.atan(18 / 60); cam.location = ctr + d * (R / math.sin(fov / 2) * 1.02)
    cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.resolution_x = sc.render.resolution_y = int(job.get('thumb', 320)); sc.cycles.samples = 48; sc.cycles.use_denoising = True
    sc.render.film_transparent = False; sc.view_settings.view_transform = 'AgX' if job.get('agx') else 'Standard'; sc.view_settings.exposure = float(job.get('thumbExposure', 0.6))
    sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 85
def render(path, show):
    for o in sc.objects:
        if o.type == 'MESH': o.hide_render = o not in show
    sc.render.filepath = path; bpy.ops.render.render(write_still=True)
night_rig()
# restore the high mesh's original surface (undo the emission swap) for the "input" shot
for mt in HIGH.data.materials:
    if mt is None or not mt.use_nodes: continue
    nt2 = mt.node_tree; out = next(n for n in nt2.nodes if n.bl_idname == 'ShaderNodeOutputMaterial' and n.is_active_output)
    p = next((n for n in nt2.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
    if p: nt2.links.new(p.outputs[0], out.inputs['Surface'])
for v in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'): setattr(HIGH, v, True)
render(os.path.join(W, 'thumb_src.jpg'), [HIGH])
render(os.path.join(W, 'thumb.jpg'), [lods[0]])
render(os.path.join(W, 'thumb_lod2.jpg'), [lods[-1]])
step('thumbs', t)
META['seconds'] = round(time.time() - T0, 1)
json.dump(META, open(os.path.join(W, 'blender_meta.json'), 'w'), indent=1)
log('done', META['seconds'], 's')
