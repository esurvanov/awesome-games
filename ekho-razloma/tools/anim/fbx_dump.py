# Blender -b --factory-startup --python fbx_dump.py -- <out_dir> <fbx...>
# Dumps each FBX armature's per-frame world bone matrices (glTF Y-up, metres) to <out_dir>/<name>.npz
import bpy, sys, os, numpy as np, mathutils
argv = sys.argv[sys.argv.index('--') + 1:]
out, files = argv[0], argv[1:]
C = mathutils.Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))  # Blender Z-up -> glTF Y-up
for f in files:
    name = os.path.splitext(os.path.basename(f))[0]
    dst = os.path.join(out, name + '.npz')
    if os.path.exists(dst): continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=f)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    act = arm.animation_data.action
    f0, f1 = [int(round(x)) for x in act.frame_range]
    fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
    bones = list(arm.pose.bones)
    names = [b.name for b in bones]
    parents = [names.index(b.parent.name) if b.parent else -1 for b in bones]
    rest = np.array([np.array(C @ arm.matrix_world @ b.bone.matrix_local) for b in bones])
    mats = np.zeros((f1 - f0 + 1, len(bones), 4, 4), np.float32)
    for i, fr in enumerate(range(f0, f1 + 1)):
        bpy.context.scene.frame_set(fr)
        W = C @ arm.matrix_world
        for j, b in enumerate(bones): mats[i, j] = np.array(W @ b.matrix)
    np.savez_compressed(dst, names=np.array(names), parents=np.array(parents), rest=rest, mats=mats, fps=fps)
    print('DUMP', name, len(bones), mats.shape[0], fps, flush=True)
