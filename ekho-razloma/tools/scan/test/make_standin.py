# make_standin.py — turns a clean CC0 photogrammetry model (Poly Haven: delit albedo) into a "phone scan" stand-in:
# the albedo is re-lit with a sunny-day sun + sky and baked into ONE texture (what Scaniverse captures), optionally with a
# patch of ground around it, exported as GLB or OBJ. Validation then checks that import.mjs removes that lighting again.
#   Blender -b --factory-startup -P make_standin.py -- <in.gltf> <out.glb|.obj> [--ground] [--tex 2048]
import bpy, bmesh, sys, os, math
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:]
src, out = a[0], a[1]; ground = '--ground' in a; TEX = int(a[a.index('--tex') + 1]) if '--tex' in a else 2048
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
ms = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in list(bpy.context.view_layer.objects): o.select_set(o in ms)
bpy.context.view_layer.objects.active = ms[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(ms) > 1: bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
sc = bpy.context.scene; sc.render.engine = 'CYCLES'
try:
    pr = bpy.context.preferences.addons['cycles'].preferences; pr.compute_device_type = 'METAL'; pr.get_devices()
    for d in pr.devices: d.use = True
    sc.cycles.device = 'GPU'
except Exception: pass
# sunny afternoon: warm sun 40° high + blue sky
sc.world = bpy.data.worlds.new('sky'); sc.world.use_nodes = True
bg = sc.world.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (0.35, 0.5, 0.85, 1); bg.inputs['Strength'].default_value = 0.9
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 4.0; sun.data.color = (1, 0.93, 0.82); sun.data.angle = math.radians(2)
sun.rotation_euler = (math.radians(50), 0, math.radians(-40)); sc.collection.objects.link(sun)
co = [obj.matrix_world @ v.co for v in obj.data.vertices]; zmin = min(c.z for c in co)
xs = [c.x for c in co]; ys = [c.y for c in co]; cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2; ext = max(max(xs) - min(xs), max(ys) - min(ys))
targets = [obj]
if ground:   # a lumpy patch of gravel/soil around the object, as a phone scan keeps it
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=60, y_subdivisions=60, size=ext * 2.2, location=(cx, cy, zmin + ext * 0.02))
    g = bpy.context.active_object; g.name = 'ground'
    import random; random.seed(3)
    for v in g.data.vertices: v.co.z += random.uniform(-1, 1) * ext * 0.004
    gm = bpy.data.materials.new('soil'); gm.use_nodes = True; nt = gm.node_tree
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 40; ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.12, 0.1, 0.08, 1); ramp.color_ramp.elements[1].color = (0.35, 0.3, 0.24, 1)
    nt.links.new(nz.outputs['Fac'], ramp.inputs['Fac']); nt.links.new(ramp.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    g.data.materials.append(gm); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.uv.smart_project(); bpy.ops.object.mode_set(mode='OBJECT')
    targets.append(g)
sc.cycles.samples = 64
for t in targets:
    im = bpy.data.images.new(t.name + '_lit', TEX if t is obj else 1024, TEX if t is obj else 1024)
    for m in t.data.materials:
        n = m.node_tree.nodes.new('ShaderNodeTexImage'); n.image = im; m.node_tree.nodes.active = n
    for o in list(bpy.context.view_layer.objects): o.select_set(o is t)
    bpy.context.view_layer.objects.active = t
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT', 'COLOR'}, margin=8, use_clear=True)
    im.pack()
    # swap the surface to the lit texture only (a scan has no separate normal / AO maps)
    for m in t.data.materials:
        nt = m.node_tree; nt.nodes.clear()
        tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = im; p = nt.nodes.new('ShaderNodeBsdfPrincipled'); o_ = nt.nodes.new('ShaderNodeOutputMaterial')
        p.inputs['Roughness'].default_value = 1.0; nt.links.new(tx.outputs['Color'], p.inputs['Base Color']); nt.links.new(p.outputs[0], o_.inputs['Surface'])
bpy.data.objects.remove(sun)
bpy.context.view_layer.update()
for o in list(bpy.context.view_layer.objects): o.select_set(o in targets)
if out.endswith('.obj'):
    d = os.path.dirname(out)
    for t in targets:
        for m in t.data.materials:
            for n in m.node_tree.nodes:
                if n.bl_idname == 'ShaderNodeTexImage': n.image.filepath_raw = os.path.join(d, n.image.name + '.jpg'); n.image.file_format = 'JPEG'; n.image.save()
    bpy.ops.wm.obj_export(filepath=out, export_selected_objects=True, export_materials=True, path_mode='RELATIVE', forward_axis='NEGATIVE_Z', up_axis='Y')
else:
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_image_format='JPEG', export_image_quality=90)
print('standin written', out)
