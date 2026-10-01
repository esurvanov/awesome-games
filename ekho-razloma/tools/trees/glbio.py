"""glbio.py — tiny GLB reader / writer for the tree pipeline (numpy only).
read_gltf(path)  -> (json, accessor(i)->ndarray)   .gltf + .bin side by side
read_glb(path)   -> (json, accessor(i))            binary .glb
write_glb(path, nodes)  nodes = [{ name, parts: [{ name, material:{name,color,doubleSided,alphaMode}, pos, nrm, uv, col, idx }] }]
                        one scene, each node a child of the root with one mesh holding one primitive per part
"""
import json, struct
import numpy as np

CT = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8, 5120: np.int8, 5122: np.int16}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def _accessor(j, B):
    def acc(i):
        A = j['accessors'][i]; bv = j['bufferViews'][A['bufferView']]
        ct = CT[A['componentType']]; n = NC[A['type']]; isz = np.dtype(ct).itemsize
        off = bv.get('byteOffset', 0) + A.get('byteOffset', 0); stride = bv.get('byteStride')
        if stride and stride != n * isz:
            raw = np.lib.stride_tricks.as_strided(B[off:], shape=(A['count'], n * isz), strides=(stride, 1))
            out = np.ascontiguousarray(raw).view(ct).reshape(A['count'], n)
        else:
            out = np.frombuffer(B, dtype=ct, count=A['count'] * n, offset=off).reshape(A['count'], n)
        if A.get('normalized'):
            out = out.astype(np.float32) / {5121: 255.0, 5123: 65535.0, 5120: 127.0, 5122: 32767.0}[A['componentType']]
        return out if n > 1 else out.reshape(-1)
    return acc


def read_gltf(path):
    import os
    j = json.load(open(path)); B = np.fromfile(os.path.join(os.path.dirname(path), j['buffers'][0]['uri']), dtype=np.uint8)
    return j, _accessor(j, B)


def read_glb(path):
    b = open(path, 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + jl])
    bl = struct.unpack('<I', b[20 + jl:24 + jl])[0]; B = np.frombuffer(b[28 + jl:28 + jl + bl], dtype=np.uint8)
    return j, _accessor(j, B)


def write_glb(path, nodes):
    used_q = False; buf = bytearray(); views = []; accs = []; meshes = []; mats = []; matidx = {}; gnodes = []

    def add(arr, target, ctype, typ, mn=None, mx=None, norm=False, stride=None):
        while len(buf) % 4: buf.append(0)
        v = {'buffer': 0, 'byteOffset': len(buf), 'byteLength': arr.nbytes, 'target': target}
        if stride: v['byteStride'] = stride
        views.append(v); buf.extend(arr.tobytes())
        a = {'bufferView': len(views) - 1, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
        if mn is not None: a['min'] = [float(x) for x in mn]; a['max'] = [float(x) for x in mx]
        if norm: a['normalized'] = True
        accs.append(a); return len(accs) - 1
    for nd in nodes:
        prims = []
        for p in nd['parts']:
            m = p['material']; key = m['name']
            if key not in matidx:
                mm = {'name': key, 'pbrMetallicRoughness': {'baseColorFactor': list(m.get('color', [1, 1, 1, 1])), 'metallicFactor': 0.0, 'roughnessFactor': 0.9}, 'doubleSided': bool(m.get('doubleSided', True))}
                if m.get('alphaMode'): mm['alphaMode'] = m['alphaMode']
                matidx[key] = len(mats); mats.append(mm)
            pos = np.ascontiguousarray(p['pos'], dtype=np.float32); at = {'POSITION': add(pos, 34962, 5126, 'VEC3', pos.min(0), pos.max(0))}
            q = bool(p.get('quant'))
            if p.get('nrm') is not None:
                if q:
                    n8 = np.zeros((len(p['nrm']), 4), np.int8); n8[:, :3] = np.clip(np.round(np.asarray(p['nrm']) * 127), -127, 127).astype(np.int8)
                    at['NORMAL'] = add(n8, 34962, 5120, 'VEC3', norm=True, stride=4); used_q = True
                else: at['NORMAL'] = add(np.ascontiguousarray(p['nrm'], dtype=np.float32), 34962, 5126, 'VEC3')
            if p.get('uv') is not None:
                at['TEXCOORD_0'] = add(np.clip(np.round(np.asarray(p['uv']) * 65535), 0, 65535).astype(np.uint16), 34962, 5123, 'VEC2', norm=True) if q else add(np.ascontiguousarray(p['uv'], dtype=np.float32), 34962, 5126, 'VEC2')
            if p.get('col') is not None:
                at['COLOR_0'] = add(np.clip(np.round(np.asarray(p['col']) * 255), 0, 255).astype(np.uint8), 34962, 5121, 'VEC4', norm=True) if q else add(np.ascontiguousarray(p['col'], dtype=np.float32), 34962, 5126, 'VEC4')
            idx = np.asarray(p['idx']).reshape(-1)
            if idx.max() < 65536: prims.append({'attributes': at, 'indices': add(idx.astype(np.uint16), 34963, 5123, 'SCALAR'), 'material': matidx[key], 'mode': 4})
            else: prims.append({'attributes': at, 'indices': add(idx.astype(np.uint32), 34963, 5125, 'SCALAR'), 'material': matidx[key], 'mode': 4})
        meshes.append({'name': nd['name'], 'primitives': prims}); gnodes.append({'name': nd['name'], 'mesh': len(meshes) - 1})
    j = {'asset': {'version': '2.0', 'generator': 'tools/trees/glbio.py'}, 'scene': 0, 'scenes': [{'nodes': list(range(len(gnodes)))}], 'nodes': gnodes, 'meshes': meshes,
         'materials': mats, 'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(buf)}]}
    if used_q: j['extensionsUsed'] = ['KHR_mesh_quantization']; j['extensionsRequired'] = ['KHR_mesh_quantization']
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    while len(buf) % 4: buf.append(0)
    out = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(js) + 8 + len(buf)) + struct.pack('<I', len(js)) + b'JSON' + js + struct.pack('<I', len(buf)) + b'BIN\x00' + bytes(buf)
    open(path, 'wb').write(out); return len(out)
