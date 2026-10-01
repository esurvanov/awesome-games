"""blender_decimate.py — run inside Blender:  blender -b --python tools/trees/blender_decimate.py -- <in trunk_raw.glb> <out dir> <bark_tris0> <trunk_tris0> <dead_tris0> <lod1 factor>
Splits the raw trunk GLB by material (bark stubs / trunk / dead branches), collapse-decimates every part to its LOD0 triangle target
(UV seams kept), writes trunk_l0.glb; then a second pass to LOD1 (× factor) -> trunk_l1.glb."""
import bpy, sys, os

argv = sys.argv[sys.argv.index('--') + 1:]
src, outdir = argv[0], argv[1]
T0 = {'bark': int(argv[2]), 'trunk': int(argv[3]), 'dead_branches': int(argv[4])}
F1 = float(argv[5])

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def load():
    reset(); bpy.ops.import_scene.gltf(filepath=src)
    objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.separate(type='MATERIAL'); bpy.ops.object.mode_set(mode='OBJECT')
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']

def tris(o):
    me = o.data; me.calc_loop_triangles(); return len(me.loop_triangles)

def decimate(o, target):
    n = tris(o)
    if n <= target: return n
    m = o.modifiers.new('dec', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = max(0.005, target / n); m.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier='dec'); return tris(o)

for tag, factor in (('l0', 1.0), ('l1', F1)):
    objs = load(); rep = {}
    for o in objs:
        key = o.data.materials[0].name if o.data.materials else o.name
        k = 'bark' if key.startswith('bark') else 'dead_branches' if key.startswith('dead') else 'trunk'
        o.name = key
        rep[key] = (tris(o), decimate(o, int(T0[k] * factor)))
    print('DECIMATE', tag, rep)
    bpy.ops.export_scene.gltf(filepath=os.path.join(outdir, f'trunk_{tag}.glb'), export_format='GLB', export_apply=True, use_selection=False, export_yup=True)
