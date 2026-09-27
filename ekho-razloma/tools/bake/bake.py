"""bake.py — offline night-light bake for "Эхо Разлома" (Blender 4.2 LTS, Cycles). See tools/bake/BAKE.md.

  Blender -b --factory-startup -P tools/bake/bake.py -- --in tools/bake/out --jobs terrain,tiles,objects,instanced,trees
          [--samples 128] [--terrain-res 4096] [--tile-res 1024] [--device METAL|CPU] [--quick]

Input : <in>/scene.glb + <in>/export.json (tools/bake/export-scene.mjs).
Output: <in>/bake/*.png (8-bit, see ENCODING) + <in>/bake/bake.json (what was baked, scales, UV2 data refs) and
        <in>/bake/uv2/*.bin (per-corner UV2 of object/instanced meshes, Float32, in the exported index order) and
        <in>/bake/treeao/*.bin (per-vertex crown AO of tree parts, Uint8 ×2).
tools/bake/encode.mjs turns that into assets/baked/ (KTX2 + manifest.json + base64 JS sidecars).

Light model (matches the game: open-world.html + atmosphere.js night preset, export.json env):
  moon   = sun lamp, strength = three intensity (W/m² ≙ three's irradiance units), colour, 1.2° disc (soft penumbra)
  sky    = world: assets/sky.jpg (upper hemisphere) × envIntensity  +  uniform hemisphere term (hemi.sky × I / π, the
           radiance that gives three's HemisphereLight irradiance on an up-facing surface) + a faint aurora band
  aurora = sun lamp (aurLight), point lights = three candela × 4π (glTF "compat" units, what three uses)
Channels (per texel, linear irradiance-like values = Cycles "diffuse lighting, no colour"):
  AMB = sky dome (direct + bounces) + emissive surfaces + indirect (bounce) of moon, aurora and point lights
        → replaces HemisphereLight + IBL irradiance on baked surfaces (runtime keeps moon/aurora/point DIRECT dynamic)
  VIS = moon visibility (Cycles SHADOW bake, moon only): 1 lit, 0 in static shadow → alpha channel
ENCODING: rgb8 = sRGB-curve(AMB / scale) (runtime decodes → linear; lightMapIntensity = π·scale), a8 = VIS (linear).
"""
import bpy, bmesh, sys, os, json, struct, math, time
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def opt(k, d=None):
    if '--' + k in argv:
        i = argv.index('--' + k)
        return argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith('--') else True
    return d

GAME = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
IN = os.path.abspath(opt('in', os.path.join(GAME, 'tools', 'bake', 'out')))
OUT = os.path.join(IN, 'bake'); os.makedirs(OUT, exist_ok=True)
for d in ('uv2', 'treeao', 'png'): os.makedirs(os.path.join(OUT, d), exist_ok=True)
JOBS = str(opt('jobs', 'terrain,tiles,objects,instanced,trees')).split(',')
QUICK = bool(opt('quick', False))
SAMPLES = int(opt('samples', 24 if QUICK else 128))
TERRAIN_RES = int(opt('terrain-res', 1024 if QUICK else 4096))
TILE_RES = int(opt('tile-res', 256 if QUICK else 1024))
TILE_SIZE = float(opt('tile-size', 128))
DEVICE = str(opt('device', 'METAL'))
T0 = time.time()
def log(*a): print('[bake %6.1fs]' % (time.time() - T0), *a, flush=True)

# three (Y up) → Blender (Z up): (x, y, z) → (x, -z, y)
C3 = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))

# ------------------------------------------------------------------ GLB reader
def read_glb(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'glTF'
    jl = struct.unpack_from('<I', b, 12)[0]
    js = json.loads(b[20:20 + jl])
    o = 20 + jl; bl = struct.unpack_from('<I', b, o)[0]
    return js, memoryview(b)[o + 8:o + 8 + bl]
CT = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
def accessor(js, bin_, i):
    a = js['accessors'][i]; v = js['bufferViews'][a['bufferView']]
    dt = CT[a['componentType']]; n = a['count'] * NC[a['type']]
    arr = np.frombuffer(bin_, dtype=dt, count=n, offset=v.get('byteOffset', 0) + a.get('byteOffset', 0))
    return arr.reshape(a['count'], NC[a['type']]) if NC[a['type']] > 1 else arr

JS, BIN = read_glb(os.path.join(IN, 'scene.glb'))
MAN = json.load(open(os.path.join(IN, 'export.json')))
ENV = JS['scenes'][0]['extras']['env']

# ------------------------------------------------------------------ scene setup
bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
scn.render.engine = 'CYCLES'
cy = scn.cycles
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = DEVICE if DEVICE != 'CPU' else 'NONE'
    prefs.get_devices()
    for d in prefs.devices: d.use = True
    cy.device = 'GPU' if DEVICE != 'CPU' else 'CPU'
    log('devices', [(d.name, d.type, d.use) for d in prefs.devices], 'using', cy.device)
except Exception as e:
    log('GPU setup failed, CPU', e); cy.device = 'CPU'
cy.samples = SAMPLES
cy.use_denoising = True
cy.max_bounces = 4; cy.diffuse_bounces = 3; cy.glossy_bounces = 1; cy.transparent_max_bounces = 16; cy.transmission_bounces = 2
cy.sample_clamp_indirect = 4.0
scn.render.bake.margin = 4
scn.render.bake.use_clear = True

# ---- materials
def principled(name, albedo, rough=0.9, metal=0.0, emissive=None, estr=1.0, alpha_img=None, cutoff=0.5, vcol=False):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; P = nt.nodes['Principled BSDF']
    P.inputs['Base Color'].default_value = (*albedo[:3], 1)
    P.inputs['Roughness'].default_value = rough; P.inputs['Metallic'].default_value = min(metal, 0.5)   # bake is diffuse-only
    if emissive is not None and max(emissive) > 0:
        P.inputs['Emission Color'].default_value = (*emissive[:3], 1); P.inputs['Emission Strength'].default_value = estr
    if vcol:
        a = nt.nodes.new('ShaderNodeVertexColor'); a.layer_name = 'Col'
        mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1
        mul.inputs[6].default_value = (*albedo[:3], 1)
        nt.links.new(a.outputs['Color'], mul.inputs[7]); nt.links.new(mul.outputs[2], P.inputs['Base Color'])
    if alpha_img is not None:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = alpha_img; t.interpolation = 'Closest'
        uv = nt.nodes.new('ShaderNodeUVMap'); uv.uv_map = 'UVMap'; nt.links.new(uv.outputs['UV'], t.inputs['Vector'])
        gt = nt.nodes.new('ShaderNodeMath'); gt.operation = 'GREATER_THAN'; gt.inputs[1].default_value = cutoff
        nt.links.new(t.outputs['Alpha'], gt.inputs[0])
        # the bake target itself is shaded as a camera ray → opaque (vertex bakes sample card corners, which are
        # transparent); every occlusion ray still sees the cut-out
        lp = nt.nodes.new('ShaderNodeLightPath'); mx = nt.nodes.new('ShaderNodeMath'); mx.operation = 'MAXIMUM'
        nt.links.new(gt.outputs[0], mx.inputs[0]); nt.links.new(lp.outputs['Is Camera Ray'], mx.inputs[1]); nt.links.new(mx.outputs[0], P.inputs['Alpha'])
    return m

MATS = []
for i, mj in enumerate(JS['materials']):
    pbr = mj.get('pbrMetallicRoughness', {})
    alb = pbr.get('baseColorFactor', [0.5, 0.5, 0.5, 1])
    em = mj.get('emissiveFactor'); es = mj.get('extensions', {}).get('KHR_materials_emissive_strength', {}).get('emissiveStrength', 1)
    img = None
    if 'baseColorTexture' in pbr:
        tex = JS['textures'][pbr['baseColorTexture']['index']]; im = JS['images'][tex['source']]; v = JS['bufferViews'][im['bufferView']]
        p = os.path.join(OUT, 'png', 'alpha_%d.png' % i)
        open(p, 'wb').write(bytes(BIN[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]))
        img = bpy.data.images.load(p); img.colorspace_settings.name = 'Non-Color'
    MATS.append(principled(mj.get('name', 'm%d' % i), alb, pbr.get('roughnessFactor', 0.9), pbr.get('metallicFactor', 0), em, es, img, mj.get('alphaCutoff', 0.5), mj.get('extras', {}).get('vertexColors', False)))

# ---- meshes (three local space; the object matrix carries C3)
MESH_CACHE = {}
def build_mesh(mi, name, single=False):
    key = (mi,)
    if not single and key in MESH_CACHE: return MESH_CACHE[key]
    pr = JS['meshes'][mi]['primitives'][0]; at = pr['attributes']
    P = accessor(JS, BIN, at['POSITION']).astype(np.float32)
    I = accessor(JS, BIN, pr['indices']).astype(np.int32).reshape(-1, 3)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(P)); me.vertices.foreach_set('co', P.ravel())
    nt = len(I); me.loops.add(nt * 3); me.polygons.add(nt)
    me.loops.foreach_set('vertex_index', I.ravel())
    me.polygons.foreach_set('loop_start', np.arange(0, nt * 3, 3, dtype=np.int32))
    me.polygons.foreach_set('loop_total', np.full(nt, 3, dtype=np.int32))
    if 'TEXCOORD_0' in at:
        uv = accessor(JS, BIN, at['TEXCOORD_0']).astype(np.float32).copy(); uv[:, 1] = 1 - uv[:, 1]   # glTF v down → Blender v up
        lay = me.uv_layers.new(name='UVMap'); lay.data.foreach_set('uv', uv[I.ravel()].ravel())
    if 'COLOR_0' in at:
        c = accessor(JS, BIN, at['COLOR_0']).astype(np.float32)
        c4 = np.ones((len(c), 4), np.float32); c4[:, :3] = c[:, :3]
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT'); ca.data.foreach_set('color', c4.ravel())
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    if 'NORMAL' in at:
        N = accessor(JS, BIN, at['NORMAL']).astype(np.float32)
        try: me.normals_split_custom_set_from_vertices([tuple(n) for n in N])
        except Exception: pass
    me.polygons.foreach_set('use_smooth', np.ones(nt, dtype=bool))
    me.materials.append(MATS[pr['material']])
    if not single: MESH_CACHE[key] = me
    return me

def node_matrix(n):
    if 'matrix' in n: return Matrix([n['matrix'][c * 4:(c + 1) * 4] for c in range(4)]).transposed()
    t = n.get('translation', [0, 0, 0]); r = n.get('rotation', [0, 0, 0, 1]); s = n.get('scale', [1, 1, 1])
    from mathutils import Quaternion
    return Matrix.LocRotScale(Vector(t), Quaternion((r[3], r[0], r[1], r[2])), Vector(s))

def inst_mats(n):
    a = n['extensions']['EXT_mesh_gpu_instancing']['attributes']
    T = accessor(JS, BIN, a['TRANSLATION']); R = accessor(JS, BIN, a['ROTATION']); S = accessor(JS, BIN, a['SCALE'])
    from mathutils import Quaternion
    return [Matrix.LocRotScale(Vector(T[i]), Quaternion((R[i][3], R[i][0], R[i][1], R[i][2])), Vector(S[i])) for i in range(len(T))]

COLL = {}
def coll(name):
    if name not in COLL:
        c = bpy.data.collections.new(name); scn.collection.children.link(c); COLL[name] = c
    return COLL[name]

OBJ = {}          # id → [objects]
NODE = {}         # id → gltf node
log('building scene…')
for n in JS['nodes']:
    ex = n.get('extras', {}); nid = ex.get('id', n.get('name'))
    if 'mesh' not in n: continue
    cat, bake = ex.get('cat'), ex.get('bake')
    if cat == 'pickup': continue
    NODE[nid] = n
    single = bake in ('object', 'terrain')
    if 'extensions' in n and 'EXT_mesh_gpu_instancing' in n['extensions']:
        me = build_mesh(n['mesh'], nid[:60], single=False)
        objs = []
        for k, M in enumerate(inst_mats(n)):
            if single and k > 0: me = build_mesh(n['mesh'], nid[:60], single=True)
            ob = bpy.data.objects.new('%s#%d' % (nid[:50], k), me); ob.matrix_world = C3 @ M; coll(cat or 'misc').objects.link(ob); objs.append(ob)
        OBJ[nid] = objs
    else:
        me = build_mesh(n['mesh'], nid[:60], single=single)
        ob = bpy.data.objects.new(nid[:60], me); ob.matrix_world = C3 @ node_matrix(n); coll(cat or 'misc').objects.link(ob); OBJ[nid] = [ob]
log('objects', sum(len(v) for v in OBJ.values()), 'meshes', len(bpy.data.meshes))

# ---- lights
def sun(name, d, color, strength, angle_deg):
    L = bpy.data.lights.new(name, 'SUN'); L.energy = strength; L.color = color[:3]; L.angle = math.radians(angle_deg)
    ob = bpy.data.objects.new(name, L); scn.collection.objects.link(ob)
    v = (C3 @ Vector((d[0], d[1], d[2], 0))).to_3d().normalized()
    ob.rotation_euler = (-v).to_track_quat('-Z', 'Y').to_euler()
    return ob
MOON = sun('moon', ENV['moon']['dir'], ENV['moon']['color'], ENV['moon']['intensity'], 1.2)
AUR = sun('aurora', ENV['aurora']['dir'], ENV['aurora']['color'], ENV['aurora']['intensity'], 40)
POINTS = []
for i, L in enumerate(JS['extensions']['KHR_lights_punctual']['lights']):
    if L['type'] != 'point': continue
    nd = next((n for n in JS['nodes'] if n.get('extensions', {}).get('KHR_lights_punctual', {}).get('light') == i), None)
    if not nd: continue
    pl = bpy.data.lights.new('pt%d' % i, 'POINT'); pl.energy = L['intensity'] * 4 * math.pi; pl.color = L['color'][:3]; pl.shadow_soft_size = 0.3
    ob = bpy.data.objects.new('pt%d' % i, pl); ob.location = (C3 @ Vector((*nd['translation'], 1))).to_3d(); scn.collection.objects.link(ob); POINTS.append(ob)
LAMPS = [MOON, AUR] + POINTS

# ---- world: sky.jpg upper hemisphere × envIntensity + hemisphere term + aurora band
def build_world():
    w = bpy.data.worlds.new('night'); scn.world = w; w.use_nodes = True; nt = w.node_tree; N = nt.nodes; Lk = nt.links
    N.clear()
    out = N.new('ShaderNodeOutputWorld'); bg = N.new('ShaderNodeBackground'); Lk.new(bg.outputs[0], out.inputs[0])
    tc = N.new('ShaderNodeTexCoord'); sep = N.new('ShaderNodeSeparateXYZ'); Lk.new(tc.outputs['Generated'], sep.inputs[0])
    env = N.new('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(os.path.join(GAME, 'assets', 'sky.jpg'))
    # sky.jpg is authored with the moon at MOON_DIR in three's equirect mapping (u = atan2(dir.z, dir.x)); Blender's
    # equirect u = atan2(dir.y, -dir.x) — rotate so the painted moon lands on the lamp
    mp = N.new('ShaderNodeMapping'); mp.inputs['Rotation'].default_value = (0, 0, math.radians(float(opt('sky-rot', 180))))
    Lk.new(tc.outputs['Generated'], mp.inputs[0]); Lk.new(mp.outputs[0], env.inputs[0])
    envI = float(ENV.get('envIntensity') or 0.3)
    k_env = N.new('ShaderNodeMixRGB'); k_env.blend_type = 'MULTIPLY'; k_env.inputs[0].default_value = 1; k_env.inputs[2].default_value = (envI, envI, envI, 1)
    Lk.new(env.outputs[0], k_env.inputs[1])
    h = ENV['hemi']; s = h['intensity'] / math.pi
    up = N.new('ShaderNodeMath'); up.operation = 'GREATER_THAN'; up.inputs[1].default_value = 0.0; Lk.new(sep.outputs['Z'], up.inputs[0])
    hemi = N.new('ShaderNodeMixRGB'); Lk.new(up.outputs[0], hemi.inputs[0])
    hemi.inputs[1].default_value = (h['ground'][0] * s, h['ground'][1] * s, h['ground'][2] * s, 1)
    hemi.inputs[2].default_value = (h['sky'][0] * s, h['sky'][1] * s, h['sky'][2] * s, 1)
    skyUp = N.new('ShaderNodeMixRGB'); skyUp.blend_type = 'MULTIPLY'; skyUp.inputs[0].default_value = 1
    Lk.new(k_env.outputs[0], skyUp.inputs[1]); Lk.new(up.outputs[0], skyUp.inputs[2])
    add = N.new('ShaderNodeMixRGB'); add.blend_type = 'ADD'; add.inputs[0].default_value = 1; Lk.new(skyUp.outputs[0], add.inputs[1]); Lk.new(hemi.outputs[0], add.inputs[2])
    # aurora: a soft green band 25–60° up towards three −Z (Blender +Y), colour STYLE auroraA
    ab = N.new('ShaderNodeMapRange'); ab.inputs['From Min'].default_value = 0.35; ab.inputs['From Max'].default_value = 0.8
    Lk.new(sep.outputs['Z'], ab.inputs['Value'])
    tri = N.new('ShaderNodeMath'); tri.operation = 'PINGPONG'; tri.inputs[1].default_value = 0.5; Lk.new(ab.outputs[0], tri.inputs[0])
    fy = N.new('ShaderNodeMath'); fy.operation = 'MAXIMUM'; fy.inputs[1].default_value = 0; Lk.new(sep.outputs['Y'], fy.inputs[0])
    band = N.new('ShaderNodeMath'); band.operation = 'MULTIPLY'; Lk.new(tri.outputs[0], band.inputs[0]); Lk.new(fy.outputs[0], band.inputs[1])
    ac = N.new('ShaderNodeMixRGB'); ac.blend_type = 'MULTIPLY'; ac.inputs[0].default_value = 1; ac.inputs[1].default_value = (0.074 * 0.25, 1.0 * 0.25, 0.27 * 0.25, 1)
    Lk.new(band.outputs[0], ac.inputs[2])
    add2 = N.new('ShaderNodeMixRGB'); add2.blend_type = 'ADD'; add2.inputs[0].default_value = float(opt('aurora-k', 0.12))
    Lk.new(add.outputs[0], add2.inputs[1]); Lk.new(ac.outputs[0], add2.inputs[2])
    Lk.new(add2.outputs[0], bg.inputs['Color']); bg.inputs['Strength'].default_value = 1
    # generated coords of the world are the view direction
    return w, bg
WORLD, WBG = build_world()
BLACK = bpy.data.worlds.new('black'); BLACK.use_nodes = True; BLACK.node_tree.nodes['Background'].inputs['Strength'].default_value = 0
WHITE = bpy.data.worlds.new('white'); WHITE.use_nodes = True; WHITE.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1); WHITE.node_tree.nodes['Background'].inputs['Strength'].default_value = 1

def lamps(on):
    for L in LAMPS: L.hide_render = L not in on

# ------------------------------------------------------------------ bake helpers
def new_image(name, w, h, float_=True):
    im = bpy.data.images.new(name, w, h, alpha=True, float_buffer=float_); im.colorspace_settings.name = 'Non-Color'
    return im

def set_bake_target(objs, img, uv_name):
    """image texture node (active) in every material slot of objs, reading uv_name"""
    for ob in objs:
        me = ob.data
        if uv_name and me.uv_layers.get(uv_name): me.uv_layers.active = me.uv_layers[uv_name]
        # per-object material copies so the target node does not leak into other objects' bakes
        for si, slot in enumerate(ob.material_slots):
            m = slot.material
            if m is None: continue
            if not m.get('_bakecopy'):
                m = m.copy(); m['_bakecopy'] = True; ob.material_slots[si].link = 'OBJECT'; ob.material_slots[si].material = m
            nt = m.node_tree
            t = nt.nodes.get('_bake') or nt.nodes.new('ShaderNodeTexImage'); t.name = '_bake'; t.image = img
            for nn in nt.nodes: nn.select = False
            t.select = True; nt.nodes.active = t

def select_only(objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]

def bake(kind, objs, img, uv_name, passes=('DIRECT', 'INDIRECT'), samples=None, target='IMAGE_TEXTURES', margin=None):
    cy.samples = samples or SAMPLES
    set_bake_target(objs, img, uv_name) if target == 'IMAGE_TEXTURES' else None
    select_only(objs)
    b = scn.render.bake; b.target = target
    b.use_pass_direct = 'DIRECT' in passes; b.use_pass_indirect = 'INDIRECT' in passes; b.use_pass_color = False
    if margin is not None: b.margin = margin
    t = time.time()
    bpy.ops.object.bake(type=kind, pass_filter=set(passes) if kind == 'DIFFUSE' else set(), use_clear=True, margin=b.margin, target=target)
    log('  bake', kind, passes, img.name if img else target, '%d objs' % len(objs), '%.1fs' % (time.time() - t))

def px(img):
    a = np.empty(img.size[0] * img.size[1] * 4, np.float32); img.pixels.foreach_get(a); return a.reshape(img.size[1], img.size[0], 4)

_DN = {}
def denoise(arr):
    """OIDN (compositor Denoise node, HDR) on a (h, w, c) float array; c = 1 or 3. Bakes are rendered without Cycles'
    own denoiser (it does not run on bakes), so every channel goes through here."""
    if opt('no-denoise'): return arr
    h, w = arr.shape[:2]; one = arr.ndim == 2
    rgb = np.dstack([arr] * 3) if one else arr
    t = time.time()
    src = bpy.data.images.new('_dn_src', w, h, alpha=True, float_buffer=True)
    src.pixels.foreach_set(np.dstack([rgb, np.ones((h, w), np.float32)]).astype(np.float32).ravel())
    dn = _DN.get('scene')
    if dn is None:
        dn = bpy.data.scenes.new('_dn'); dn.render.engine = 'BLENDER_WORKBENCH'; dn.use_nodes = True
        cam = bpy.data.objects.new('_dncam', bpy.data.cameras.new('_dncam')); dn.collection.objects.link(cam); dn.camera = cam
        dn.render.image_settings.file_format = 'OPEN_EXR'; dn.render.image_settings.color_depth = '32'; dn.render.image_settings.color_mode = 'RGBA'
        dn.view_settings.view_transform = 'Standard'; dn.render.resolution_percentage = 100; dn.render.film_transparent = True
        nt = dn.node_tree; nt.nodes.clear()
        im = nt.nodes.new('CompositorNodeImage'); de = nt.nodes.new('CompositorNodeDenoise'); co = nt.nodes.new('CompositorNodeComposite')
        de.use_hdr = True
        try: de.prefilter = 'ACCURATE'
        except Exception: pass
        nt.links.new(im.outputs['Image'], de.inputs['Image']); nt.links.new(de.outputs['Image'], co.inputs['Image'])
        _DN['scene'] = dn; _DN['img'] = im
    dn.render.resolution_x = w; dn.render.resolution_y = h
    _DN['img'].image = src
    fp = os.path.join(OUT, '_dn.exr'); dn.render.filepath = fp
    bpy.ops.render.render(write_still=True, scene=dn.name)
    res = bpy.data.images.load(fp, check_existing=False); a = np.empty(w * h * 4, np.float32); res.pixels.foreach_get(a); a = a.reshape(h, w, 4)[..., :3]
    bpy.data.images.remove(res); bpy.data.images.remove(src)
    log('  denoise %dx%d %.1fs' % (w, h, time.time() - t))
    a = np.maximum(a, 0)
    return a.mean(-1) if one else a

def bake_channels(objs, name, w, h, uv_name, samples=None, vis=True):
    """AMB (world+emissive: direct+indirect; lamps: indirect) and VIS (moon shadow) → float arrays (h, w, 3) / (h, w)"""
    img = new_image(name + '_tmp', w, h)
    scn.world = WORLD; lamps([])
    bake('DIFFUSE', objs, img, uv_name, ('DIRECT', 'INDIRECT'), samples)
    amb = px(img)[..., :3].copy()
    scn.world = BLACK; lamps(LAMPS)
    bake('DIFFUSE', objs, img, uv_name, ('INDIRECT',), max(8, (samples or SAMPLES) // 2))
    amb += px(img)[..., :3]
    visv = None
    if vis:
        # moon visibility = direct moon light / the same without shadows (Cycles' SHADOW bake type is 3–4× slower on the
        # GPU than two DIFFUSE-direct bakes)
        lamps([MOON]); scn.world = BLACK
        bake('DIFFUSE', objs, img, uv_name, ('DIRECT',), int(opt('vis-samples', max(8, (samples or SAMPLES) // 4))))
        dm = px(img)[..., :3].mean(-1).copy()
        cov = px(img)[..., 3].copy()
        MOON.data.cycles.cast_shadow = False
        bake('DIFFUSE', objs, img, uv_name, ('DIRECT',), 4)
        MOON.data.cycles.cast_shadow = True
        du = px(img)[..., :3].mean(-1)
        visv = np.where(du > 1e-4, np.clip(dm / np.maximum(du, 1e-4), 0, 1), 0.0).astype(np.float32)
        visv[cov <= 0] = 1.0
        log('  vis: lit %.2f' % float((visv > 0.5).mean()))
    scn.world = WORLD; lamps(LAMPS)
    bpy.data.images.remove(img)
    # keep uncovered texels (alpha 0 = no surface) out of the denoiser's statistics: they stay 0
    amb = denoise(amb)
    if visv is not None: visv = np.clip(denoise(visv), 0, 1)
    return amb, visv

def save_rgba(path, amb, vis, scale):
    """rgb = srgb(amb/scale), a = vis → 8-bit PNG (row 0 = v = 0 = bottom, Blender convention)"""
    h, w = amb.shape[:2]
    x = np.clip(amb / scale, 0, 1); rgb = np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)   # sRGB curve
    a = np.ones((h, w), np.float32) if vis is None else np.clip(vis, 0, 1)
    im = bpy.data.images.new(os.path.basename(path), w, h, alpha=True, float_buffer=False)
    im.colorspace_settings.name = 'Non-Color'
    im.pixels.foreach_set(np.dstack([rgb, a]).astype(np.float32).ravel())
    im.filepath_raw = path; im.file_format = 'PNG'; im.save(); bpy.data.images.remove(im)

REPORT = {'version': 1, 'date': time.strftime('%Y-%m-%d %H:%M'), 'samples': SAMPLES, 'device': cy.device, 'blender': bpy.app.version_string,
          'encoding': 'rgb = srgb(irradiance / scale); a = moon visibility (linear). lightMapIntensity = PI * scale',
          'terrain': None, 'tileAtlas': None, 'tiles': [], 'atlases': [], 'instanced': [], 'trees': [], 'timings': {}}
_rp = os.path.join(OUT, 'bake.json')
if os.path.exists(_rp) and not opt('fresh'):   # jobs can run separately: keep what earlier runs baked
    _old = json.load(open(_rp))
    for _k in ('terrain', 'tileAtlas', 'atlases', 'instanced', 'trees', 'objectsUnbaked'):
        if _k in _old: REPORT[_k] = _old[_k]
    REPORT['timings'] = _old.get('timings', {})
for _j in JOBS:   # a job that runs again starts empty
    if _j == 'objects':
        _only = str(opt('only')).split(',') if opt('only') else None
        REPORT['atlases'] = [a for a in REPORT['atlases'] if _only and a['file'][len('atlas_'):] not in _only]
    elif _j in ('instanced', 'trees'): REPORT[_j] = []
def pct_scale(amb, q=99.7):
    v = np.percentile(amb.max(axis=-1), q); return float(max(v, 1e-3)) * 1.05

# ------------------------------------------------------------------ (b) terrain: world-space atlas + POI tiles
TER = OBJ.get('terrain', [None])[0]
def terrain_uv(name, x0, z0, size):
    """UV layer mapping world (x, z) → ((x - x0) / size, (z - z0) / size); v along three +z"""
    me = TER.data
    lay = me.uv_layers.get(name) or me.uv_layers.new(name=name)
    co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)   # three local = world
    vi = np.empty(len(me.loops), np.int32); me.loops.foreach_get('vertex_index', vi)
    uv = np.stack([(co[vi, 0] - x0) / size, (co[vi, 2] - z0) / size], -1).astype(np.float32)
    lay.data.foreach_set('uv', uv.ravel())
    return name

if 'terrain' in JOBS and TER:
    # quadrants (--quad 0..3, each its own Blender run so the GPU is released in between; default all four), then
    # assembled once all four exist
    t = time.time(); T = MAN['terrain']; W = T['W']; x0, z0 = T['origin']; H2 = TERRAIN_RES // 2
    quads = [int(q) for q in str(opt('quad', '0,1,2,3')).split(',')]
    for q in quads:
        qx, qz = q % 2, q // 2
        uvn = terrain_uv('quad', x0 + qx * W / 2, z0 + qz * W / 2, W / 2)
        amb, vis = bake_channels([TER], 'terrain_q%d' % q, H2, H2, uvn)
        np.save(os.path.join(OUT, 'terrain_q%d_amb.npy' % q), amb.astype(np.float16)); np.save(os.path.join(OUT, 'terrain_q%d_vis.npy' % q), vis.astype(np.float16))
        log('terrain quadrant', q, '%.0fs' % (time.time() - t))
    qf = [os.path.join(OUT, 'terrain_q%d_%s.npy' % (q, c)) for q in range(4) for c in ('amb', 'vis')]
    if all(os.path.exists(f) for f in qf):
        amb = np.zeros((TERRAIN_RES, TERRAIN_RES, 3), np.float32); vis = np.ones((TERRAIN_RES, TERRAIN_RES), np.float32)
        for q in range(4):
            qx, qz = q % 2, q // 2   # rows = v = z (row 0 bottom)
            amb[qz * H2:(qz + 1) * H2, qx * H2:(qx + 1) * H2] = np.load(os.path.join(OUT, 'terrain_q%d_amb.npy' % q))
            vis[qz * H2:(qz + 1) * H2, qx * H2:(qx + 1) * H2] = np.load(os.path.join(OUT, 'terrain_q%d_vis.npy' % q))
        sc = pct_scale(amb)
        save_rgba(os.path.join(OUT, 'png', 'terrain.png'), amb, vis, sc)
        REPORT['terrain'] = {'file': 'terrain', 'res': TERRAIN_RES, 'origin': [x0, z0], 'size': W, 'scale': sc, 'meanAmb': float(amb.mean()), 'litFrac': float((vis > 0.5).mean())}
        log('terrain assembled', REPORT['terrain'])
    REPORT['timings']['terrain'] = REPORT['timings'].get('terrain', 0) + time.time() - t

def tile_sites():
    M = MAN['meta']; P = M['pois']; s = []
    for k in ('crash', 'station', 'lake', 'rift', 'spireN', 'spireW', 'spireE'):
        if k in P: s.append((k, P[k]['x'], P[k]['z']))
    wf = M.get('wf') or {}
    if wf.get('camp'): s.append(('camp', wf['camp']['x'], wf['camp']['z']))
    if wf.get('ship'): s.append(('ship', wf['ship']['x'], wf['ship']['z']))
    if wf.get('pier'): s.append(('pier', wf['pier']['x'], wf['pier']['z']))
    for i, r in enumerate(wf.get('ruins') or []): s.append(('ruins%d' % i, r['x'], r['z']))
    # merge sites closer than half a tile (one tile covers both)
    out = []
    for n, x, z in s:
        if any(math.hypot(x - a[1], z - a[2]) < TILE_SIZE * 0.35 for a in out): continue
        out.append((n, x, z))
    return out

if 'tiles' in JOBS and TER:
    t = time.time()
    sites = tile_sites(); n = len(sites); grid = int(math.ceil(math.sqrt(n))); A = grid * TILE_RES
    want = str(opt('sites', '')).split(',') if opt('sites') else None
    for nm, x, z in sites:   # bake (cached per site: --sites a,b runs a subset, the atlas is assembled from the cache)
        if want and nm not in want: continue
        x0, z0 = x - TILE_SIZE / 2, z - TILE_SIZE / 2
        uvn = terrain_uv('tile', x0, z0, TILE_SIZE)
        amb, vis = bake_channels([TER], 'tile_' + nm, TILE_RES, TILE_RES, uvn)
        np.save(os.path.join(OUT, 'tile_%s_amb.npy' % nm), amb.astype(np.float16)); np.save(os.path.join(OUT, 'tile_%s_vis.npy' % nm), vis.astype(np.float16))
    at_amb = np.zeros((A, A, 3), np.float32); at_vis = np.ones((A, A), np.float32); tiles = []
    for k, (nm, x, z) in enumerate(sites):
        x0, z0 = x - TILE_SIZE / 2, z - TILE_SIZE / 2
        fa = os.path.join(OUT, 'tile_%s_amb.npy' % nm)
        if not os.path.exists(fa): continue
        amb = np.load(fa).astype(np.float32); vis = np.load(os.path.join(OUT, 'tile_%s_vis.npy' % nm)).astype(np.float32)
        c, r = k % grid, k // grid   # cell (column, row); row 0 = bottom (v up)
        at_amb[r * TILE_RES:(r + 1) * TILE_RES, c * TILE_RES:(c + 1) * TILE_RES] = amb
        at_vis[r * TILE_RES:(r + 1) * TILE_RES, c * TILE_RES:(c + 1) * TILE_RES] = vis
        # cell = (u0, v0, du): uv_atlas = cell.xy + uv_tile * cell.z, half-texel inset against bleeding
        tiles.append({'site': nm, 'origin': [x0, z0], 'size': TILE_SIZE, 'cell': [(c * TILE_RES + 0.5) / A, (r * TILE_RES + 0.5) / A, (TILE_RES - 1) / A]})
        log('tile', nm)
    sc = (REPORT['terrain'] or {}).get('scale') or pct_scale(at_amb)
    sc = max(sc, pct_scale(at_amb, 99.9))
    for tl in tiles: tl['scale'] = sc
    save_rgba(os.path.join(OUT, 'png', 'tiles.png'), at_amb, at_vis, sc)
    REPORT['tileAtlas'] = {'file': 'tiles', 'res': A, 'grid': grid, 'tileRes': TILE_RES, 'scale': sc, 'tiles': tiles}
    REPORT['timings']['tiles'] = time.time() - t

# ------------------------------------------------------------------ UV2 generation
def gen_uv2(objs, margin=0.004):
    """smart-project + average scale + pack all objs into one shared 0..1 space → uv layer 'UV2' (active)"""
    for ob in objs:
        me = ob.data
        lay = me.uv_layers.get('UV2') or me.uv_layers.new(name='UV2')
        me.uv_layers.active = lay
    select_only(objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    try: bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, margin_method='FRACTION', margin=margin, shape_method='AABB')
    except TypeError: bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')
    # pack_islands may overflow 0..1 (many islands): fit the union uniformly back into [margin, 1 - margin]
    allv = [np.empty(len(o.data.loops) * 2, np.float32) for o in objs]
    for o, a in zip(objs, allv): o.data.uv_layers['UV2'].data.foreach_get('uv', a)
    cat = np.concatenate(allv).reshape(-1, 2); lo = cat.min(0); ext = float((cat.max(0) - lo).max()) or 1
    k = (1 - 2 * margin) / ext
    for o, a in zip(objs, allv):
        a = a.reshape(-1, 2); a = (a - lo) * k + margin; o.data.uv_layers['UV2'].data.foreach_set('uv', a.astype(np.float32).ravel())

def uv2_of(ob):
    lay = ob.data.uv_layers['UV2']; a = np.empty(len(ob.data.loops) * 2, np.float32); lay.data.foreach_get('uv', a)
    return a   # per corner, in the exported index order (polygons were created in order, 3 loops each)

def area_of(objs):
    s = 0.0
    for ob in objs:
        sc = ob.matrix_world.to_scale(); k = abs(sc.x * sc.y * sc.z) ** (2 / 3)
        a = np.empty(len(ob.data.polygons), np.float32); ob.data.polygons.foreach_get('area', a); s += float(a.sum()) * k
    return s

def pow2(v, lo, hi): return int(min(hi, max(lo, 2 ** round(math.log2(max(v, 1))))))

def safe(s): return ''.join(c if c.isalnum() or c in '-_' else '_' for c in s)[:80]

# ------------------------------------------------------------------ (a) per-object lightmaps, one atlas per site
if 'objects' in JOBS:
    t = time.time()
    objs = []
    for nid, obs in OBJ.items():
        n = NODE.get(nid); ex = n.get('extras', {}) if n else {}
        if ex.get('bake') != 'object': continue
        for ob in obs: objs.append((nid, ob))
    # world bbox per object: huge / island-spanning merged meshes (sea plane, sea ice, wf_built) stay unbaked
    def wbox(ob):
        c = np.array([ob.matrix_world @ Vector(v) for v in ob.bound_box]); return c.min(0), c.max(0)
    sites = [(n, x, -z) for n, x, z in tile_sites()]   # Blender xy
    groups = {}
    skipped = []
    for nid, ob in objs:
        lo, hi = wbox(ob); d = hi - lo
        if max(d[0], d[1]) > 90: skipped.append(nid); continue
        c = (lo + hi) / 2
        best = min(sites, key=lambda s: math.hypot(c[0] - s[1], c[1] - s[2])) if sites else ('all', 0, 0)
        key = best[0] if math.hypot(c[0] - best[1], c[1] - best[2]) < 70 else 'misc'
        if key not in ('crash', 'station', 'camp'): key = 'misc'   # few objects elsewhere: one shared atlas
        groups.setdefault(key, []).append((nid, ob))
    log('object atlases', {k: len(v) for k, v in groups.items()}, 'unbaked (too large):', skipped)
    DENS = float(opt('texel-density', 12 if QUICK else 24))   # texels per metre
    only = opt('only'); only = str(only).split(',') if only else None
    for key, lst in groups.items():
        if only and key not in only: continue
        obs = [ob for _, ob in lst]
        gen_uv2(obs)
        uvs = np.concatenate([uv2_of(o).reshape(-1, 2) for o in obs]); log('  uv2 bounds', key, uvs.min(0), uvs.max(0), 'corners', len(uvs))
        side = pow2(math.sqrt(area_of(obs)) * DENS * 1.4, 256, 2048)
        amb, vis = bake_channels(obs, 'atlas_' + key, side, side, 'UV2')
        sc = pct_scale(amb)
        save_rgba(os.path.join(OUT, 'png', 'atlas_%s.png' % key), amb, vis, sc)
        ent = {'file': 'atlas_' + key, 'res': side, 'scale': sc, 'objects': []}
        for nid, ob in lst:
            f = 'uv2/%s.bin' % safe(nid); uv2_of(ob).tofile(os.path.join(OUT, f)); ent['objects'].append({'id': nid, 'uv2': f, 'corners': len(ob.data.loops)})
        REPORT['atlases'].append(ent); log('atlas', key, side, len(lst), 'objects')
    REPORT['objectsUnbaked'] = skipped
    REPORT['timings']['objects'] = time.time() - t

# ------------------------------------------------------------------ (a') instanced geometry: object-space AO on UV2
if 'instanced' in JOBS:
    t = time.time()
    seen = {}
    for nid, obs in OBJ.items():
        n = NODE.get(nid); ex = n.get('extras', {}) if n else {}
        if ex.get('bake') != 'instanced': continue
        me = obs[0].data
        seen.setdefault(me.name, (me, []))[1].append(nid)
    # isolate: hide everything else while baking one geometry's self-occlusion
    allobs = [o for o in scn.objects if o.type == 'MESH']
    for mname, (me, ids) in seen.items():
        tmp = bpy.data.objects.new('_ao_' + mname[:40], me); scn.collection.objects.link(tmp)
        for o in allobs: o.hide_render = True
        tmp.hide_render = False
        gen_uv2([tmp], margin=0.01)
        dims = tmp.dimensions; size = max(dims) or 1
        side = pow2(math.sqrt(area_of([tmp])) * 20, 128, 512)
        img = new_image('ao_' + mname[:40], side, side)
        scn.world = WHITE; lamps([])
        scn.world.light_settings.distance = max(0.5, size * 0.35)
        bake('AO', [tmp], img, 'UV2', (), max(32, SAMPLES // 2))
        ao = px(img)[..., 0].copy()
        f = safe(mname)
        im = bpy.data.images.new('aoimg', side, side, alpha=False, float_buffer=False); im.colorspace_settings.name = 'Non-Color'
        im.pixels.foreach_set(np.dstack([ao, ao, ao, np.ones_like(ao)]).astype(np.float32).ravel()); im.filepath_raw = os.path.join(OUT, 'png', 'ao_%s.png' % f); im.file_format = 'PNG'; im.save(); bpy.data.images.remove(im)
        uvf = 'uv2/geo_%s.bin' % f; uv2_of(tmp).tofile(os.path.join(OUT, uvf))
        REPORT['instanced'].append({'file': 'ao_' + f, 'res': side, 'ids': ids, 'uv2': uvf, 'corners': len(me.loops), 'mean': float(ao.mean())})
        bpy.data.objects.remove(tmp); bpy.data.images.remove(img)
        for o in allobs: o.hide_render = False
        log('instanced AO', mname, side, 'mean %.2f' % ao.mean())
    scn.world = WORLD; lamps(LAMPS)
    REPORT['timings']['instanced'] = time.time() - t

# ------------------------------------------------------------------ (c) trees: crown AO + sky visibility per vertex
# Own ray caster (mathutils BVHTree) instead of a Cycles vertex bake: the foliage is alpha-cut cards authored double-
# sided as coincident face pairs, and Cycles' vertex bake samples the card corners (fully transparent). Here every ray
# marches through up to 6 hits, each hit on a foliage card attenuating by the card's alpha (texture lookup at the hit's
# barycentric uv); bark is opaque. Per vertex: ao = mean transmittance over the cosine hemisphere around the normal
# (both sides for foliage cards), sky = over the upper hemisphere (what the night sky + moon glow can reach).
if 'trees' in JOBS:
    from mathutils.bvhtree import BVHTree
    t = time.time()
    by_species = {}
    for nid, obs in OBJ.items():
        n = NODE.get(nid); ex = n.get('extras', {}) if n else {}
        if ex.get('bake') != 'tree': continue
        for sp in ex.get('species', []): by_species.setdefault(sp, []).append((nid, obs[0].data))
    rng = np.random.default_rng(7)
    NR = int(opt('tree-rays', 24 if QUICK else 48))
    def hemi(nr):   # cosine-weighted directions around +Y
        u1, u2 = rng.random(nr), rng.random(nr); r = np.sqrt(u1); ph = 2 * np.pi * u2
        return np.stack([r * np.cos(ph), np.sqrt(1 - u1), r * np.sin(ph)], -1)
    def basis(nv):
        nv = nv / (np.linalg.norm(nv) or 1); a = np.array([1, 0, 0]) if abs(nv[0]) < 0.9 else np.array([0, 1, 0])
        tt = np.cross(a, nv); tt /= np.linalg.norm(tt); bb = np.cross(nv, tt); return np.stack([tt, nv, bb], 0)   # rows: x→t, y→n, z→b
    for spn, parts in by_species.items():
        V, F, FUV, FA = [], [], [], []   # combined: verts, faces, face uv (3×2), face alpha image index
        imgs = []; off = 0; meta = []
        for nid, me in parts:
            co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
            vi = np.empty(len(me.loops), np.int32); me.loops.foreach_get('vertex_index', vi); tri = vi.reshape(-1, 3)
            uvl = np.zeros((len(me.loops), 2), np.float32)
            if me.uv_layers.get('UVMap'): a = np.empty(len(me.loops) * 2, np.float32); me.uv_layers['UVMap'].data.foreach_get('uv', a); uvl = a.reshape(-1, 2)
            ai = -1; m = me.materials[0]
            for nd in m.node_tree.nodes:
                if nd.type == 'TEX_IMAGE' and nd.image and nd.name != '_bake':
                    im = nd.image; px_ = np.empty(im.size[0] * im.size[1] * 4, np.float32); im.pixels.foreach_get(px_)
                    imgs.append(px_.reshape(im.size[1], im.size[0], 4)[..., 3] > 0.5); ai = len(imgs) - 1
            # drop the second face of coincident pairs (double-sided cards)
            cen = np.round(co[tri].mean(1), 3); _, first = np.unique(cen, axis=0, return_index=True); keep = np.sort(first)
            V.append(co); F.append(tri[keep] + off); FUV.append(uvl.reshape(-1, 3, 2)[keep]); FA.append(np.full(len(keep), ai))
            meta.append((nid, me, co, off, ai >= 0)); off += len(co)
        Vc = np.concatenate(V); Fc = np.concatenate(F); UVc = np.concatenate(FUV); FAc = np.concatenate(FA)
        bvh = BVHTree.FromPolygons([tuple(v) for v in Vc], [tuple(f) for f in Fc], all_triangles=True, epsilon=0.0)
        def alpha_at(fi, loc):
            a = FAc[fi]
            if a < 0: return 1.0
            p0, p1, p2 = Vc[Fc[fi]]; v0, v1, v2 = p1 - p0, p2 - p0, np.array(loc) - p0
            d00, d01, d11, d20, d21 = v0 @ v0, v0 @ v1, v1 @ v1, v2 @ v0, v2 @ v1; den = d00 * d11 - d01 * d01 or 1e-12
            b1 = (d11 * d20 - d01 * d21) / den; b2 = (d00 * d21 - d01 * d20) / den; b0 = 1 - b1 - b2
            uv = UVc[fi][0] * b0 + UVc[fi][1] * b1 + UVc[fi][2] * b2; im = imgs[a]
            x = int((uv[0] % 1) * (im.shape[1] - 1)); y = int((uv[1] % 1) * (im.shape[0] - 1)); return 1.0 if im[y, x] else 0.0
        def trans(o, d):
            T = 1.0; o = Vector(o); d = Vector(d)
            for _ in range(6):
                loc, nrm, fi, dist = bvh.ray_cast(o, d, 40.0)
                if loc is None: return T
                T *= 1.0 - alpha_at(fi, loc)
                if T <= 0.01: return 0.0
                o = loc + d * 0.004
            return T
        H = hemi(NR); UP = hemi(NR)
        for nid, me, co, voff, foliage in meta:
            nrm = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('normal', nrm); nrm = nrm.reshape(-1, 3)
            ao = np.zeros(len(co), np.float32); sky = np.zeros(len(co), np.float32)
            for k in range(len(co)):
                p = co[k]; nv = nrm[k]
                R = H @ basis(nv); ok = 0.0
                for d in R: ok += trans(p + nv * 0.01 + d * 0.01, d)
                a1 = ok / NR
                if foliage:   # a card is lit from both sides: take the better side
                    R2 = H @ basis(-nv); ok2 = 0.0
                    for d in R2: ok2 += trans(p - nv * 0.01 + d * 0.01, d)
                    a1 = max(a1, ok2 / NR)
                ok = 0.0
                for d in UP: ok += trans(p + d * 0.02, d)
                ao[k] = a1; sky[k] = ok / NR
            buf = np.stack([ao, sky], -1)
            f = 'treeao/%s.bin' % safe(nid); (np.round(np.clip(buf, 0, 1) * 255)).astype(np.uint8).tofile(os.path.join(OUT, f))
            REPORT['trees'].append({'id': nid, 'species': spn, 'file': f, 'verts': len(co), 'meanAO': float(ao.mean()), 'meanSky': float(sky.mean())})
        log('tree', spn, [(e['id'][-18:], round(e['meanAO'], 2), round(e['meanSky'], 2)) for e in REPORT['trees'] if e['species'] == spn], '%.0fs' % (time.time() - t))
    REPORT['timings']['trees'] = time.time() - t

rp = os.path.join(OUT, 'bake.json')
json.dump(REPORT, open(rp, 'w'), indent=1)
if opt('save-blend'): bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'scene.blend'))
log('done', json.dumps(REPORT['timings']))
