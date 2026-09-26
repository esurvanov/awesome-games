"""Minimal glTF/GLB skeleton + animation IO (numpy). Quaternions are (x, y, z, w) like glTF."""
import json, struct, numpy as np, base64, re

CT = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8, 5122: np.int16, 5120: np.int8}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def read_glb(path_or_bytes):
    b = open(path_or_bytes, 'rb').read() if isinstance(path_or_bytes, str) else path_or_bytes
    if b[:4] != b'glTF':   # pack .js: (window.__PACK ...)['name'] = '<b64>';
        m = re.search(rb"= '([^']+)'", b); b = base64.b64decode(m.group(1))
    l = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + l])
    o = 20 + l; bin_ = b''
    if o < len(b):
        bl = struct.unpack('<I', b[o:o + 4])[0]; bin_ = b[o + 8:o + 8 + bl]
    return j, bin_

def accessor(j, bin_, i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
    dt = CT[a['componentType']]; n = NC[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', 0); isz = np.dtype(dt).itemsize * n
    if stride and stride != isz:
        raw = np.frombuffer(bin_, np.uint8, count=stride * a['count'], offset=off).reshape(a['count'], stride)[:, :isz]
        arr = np.frombuffer(raw.tobytes(), dt).reshape(a['count'], n)
    else:
        arr = np.frombuffer(bin_, dt, count=a['count'] * n, offset=off).reshape(a['count'], n)
    arr = arr.astype(np.float64)
    if a.get('normalized'):
        arr = arr / {np.int8: 127, np.uint8: 255, np.int16: 32767, np.uint16: 65535}[dt]
    return arr

# ---------------- quaternion helpers (x,y,z,w) ----------------
def qmul(a, b):
    ax, ay, az, aw = np.moveaxis(a, -1, 0); bx, by, bz, bw = np.moveaxis(b, -1, 0)
    return np.stack([aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz], -1)
def qinv(q): return q * np.array([-1, -1, -1, 1.0])
def qrot(q, v):
    u = q[..., :3]; w = q[..., 3:4]
    t = 2 * np.cross(u, v)
    return v + w * t + np.cross(u, t)
def qnorm(q): return q / np.linalg.norm(q, axis=-1, keepdims=True)
def qslerp(a, b, t):
    a = np.asarray(a, float); b = np.asarray(b, float)
    d = np.sum(a * b, -1, keepdims=True); b = np.where(d < 0, -b, b); d = np.abs(d)
    t = np.asarray(t, float)[..., None] if np.ndim(t) else t
    lin = d > 0.9995
    th = np.arccos(np.clip(d, -1, 1)); s = np.sin(th) + 1e-12
    wa = np.where(lin, 1 - t, np.sin((1 - t) * th) / s); wb = np.where(lin, t, np.sin(t * th) / s)
    return qnorm(wa * a + wb * b)
def qaxis(axis, ang):
    axis = np.asarray(axis, float); axis = axis / np.linalg.norm(axis, axis=-1, keepdims=True)
    ang = np.asarray(ang, float)[..., None]
    return np.concatenate([axis * np.sin(ang / 2), np.cos(ang / 2)], -1)
def qbetween(u, v):
    """shortest-arc rotation taking direction u to v"""
    u = u / np.linalg.norm(u, axis=-1, keepdims=True); v = v / np.linalg.norm(v, axis=-1, keepdims=True)
    c = np.cross(u, v); d = np.sum(u * v, -1, keepdims=True)
    q = np.concatenate([c, 1 + d], -1)
    bad = (1 + d[..., 0]) < 1e-8
    if np.any(bad):
        o = np.cross(u, [1.0, 0, 0]); o2 = np.cross(u, [0, 1.0, 0])
        o = np.where(np.linalg.norm(o, axis=-1, keepdims=True) < 1e-6, o2, o)
        q = np.where(bad[..., None], np.concatenate([o, np.zeros_like(d)], -1), q)
    return qnorm(q)
def mat_to_q(m):
    m = np.asarray(m, float)[..., :3, :3]
    m = m / np.linalg.norm(m, axis=-2, keepdims=True)  # strip scale
    M = m.reshape(-1, 3, 3); q = np.zeros((len(M), 4))
    t = M[:, 0, 0] + M[:, 1, 1] + M[:, 2, 2]
    c0 = t > 0; c1 = (~c0) & (M[:, 0, 0] > M[:, 1, 1]) & (M[:, 0, 0] > M[:, 2, 2]); c2 = (~c0) & (~c1) & (M[:, 1, 1] > M[:, 2, 2]); c3 = ~(c0 | c1 | c2)
    with np.errstate(all='ignore'):
        s = np.sqrt(np.maximum(t + 1, 1e-12)) * 2
        q0 = np.stack([(M[:, 2, 1] - M[:, 1, 2]) / s, (M[:, 0, 2] - M[:, 2, 0]) / s, (M[:, 1, 0] - M[:, 0, 1]) / s, 0.25 * s], -1)
        s = np.sqrt(np.maximum(1 + M[:, 0, 0] - M[:, 1, 1] - M[:, 2, 2], 1e-12)) * 2
        q1 = np.stack([0.25 * s, (M[:, 0, 1] + M[:, 1, 0]) / s, (M[:, 0, 2] + M[:, 2, 0]) / s, (M[:, 2, 1] - M[:, 1, 2]) / s], -1)
        s = np.sqrt(np.maximum(1 + M[:, 1, 1] - M[:, 0, 0] - M[:, 2, 2], 1e-12)) * 2
        q2 = np.stack([(M[:, 0, 1] + M[:, 1, 0]) / s, 0.25 * s, (M[:, 1, 2] + M[:, 2, 1]) / s, (M[:, 0, 2] - M[:, 2, 0]) / s], -1)
        s = np.sqrt(np.maximum(1 + M[:, 2, 2] - M[:, 0, 0] - M[:, 1, 1], 1e-12)) * 2
        q3 = np.stack([(M[:, 0, 2] + M[:, 2, 0]) / s, (M[:, 1, 2] + M[:, 2, 1]) / s, 0.25 * s, (M[:, 1, 0] - M[:, 0, 1]) / s], -1)
    q = np.where(c0[:, None], q0, np.where(c1[:, None], q1, np.where(c2[:, None], q2, q3)))
    return qnorm(q).reshape(m.shape[:-2] + (4,))
def q_to_mat(q):
    x, y, z, w = np.moveaxis(q, -1, 0)
    return np.stack([np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], -1),
                     np.stack([2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], -1),
                     np.stack([2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)], -1)], -2)
def qcontinuous(q):
    """flip signs along axis 0 so consecutive quats are in the same hemisphere"""
    q = q.copy()
    for i in range(1, len(q)):
        s = np.sum(q[i] * q[i - 1], -1) < 0
        q[i][s] *= -1
    return q

# ---------------- skeleton ----------------
class Skeleton:
    """Node hierarchy of a glTF (all nodes; joints subset)"""
    def __init__(self, j, bin_=None):
        self.j = j; self.bin = bin_
        N = j['nodes']; self.n = len(N)
        self.names = [nd.get('name', 'node%d' % i) for i, nd in enumerate(N)]
        self.parent = [-1] * self.n
        for i, nd in enumerate(N):
            for c in nd.get('children', []): self.parent[c] = i
        self.T = np.array([nd.get('translation', [0, 0, 0]) for nd in N], float)
        self.R = np.array([nd.get('rotation', [0, 0, 0, 1]) for nd in N], float)
        self.S = np.array([nd.get('scale', [1, 1, 1]) for nd in N], float)
        self.order = []
        seen = set()
        def visit(i):
            if i in seen: return
            if self.parent[i] >= 0: visit(self.parent[i])
            seen.add(i); self.order.append(i)
        for i in range(self.n): visit(i)
        self.idx = {nm: i for i, nm in enumerate(self.names)}
        self.joints = j['skins'][0]['joints'] if j.get('skins') else list(range(self.n))

    def fk(self, T, R, S=None):
        """T,R: [..., n, 3/4] local -> world pos [...,n,3], world rot [...,n,4] (uniform-scale aware)"""
        S = self.S if S is None else S
        sh = T.shape[:-2]
        P = np.zeros(sh + (self.n, 3)); Q = np.zeros(sh + (self.n, 4)); SC = np.ones(sh + (self.n, 1))
        for i in self.order:
            p = self.parent[i]
            if p < 0:
                P[..., i, :] = T[..., i, :]; Q[..., i, :] = R[..., i, :]; SC[..., i, :] = S[..., i, :1] if np.ndim(S) else 1
            else:
                P[..., i, :] = P[..., p, :] + qrot(Q[..., p, :], T[..., i, :] * SC[..., p, :])
                Q[..., i, :] = qmul(Q[..., p, :], R[..., i, :])
                SC[..., i, :] = SC[..., p, :] * (S[..., i, :1] if np.ndim(S) else 1)
        return P, Q

    def sample(self, anim_index, fps=30.0, t0=None, t1=None):
        """returns times, T[F,n,3], R[F,n,4] (rest where no channel)"""
        j, b = self.j, self.bin
        A = j['animations'][anim_index]
        tmax = max(accessor(j, b, s['input'])[-1, 0] for s in A['samplers'])
        t0 = 0 if t0 is None else t0; t1 = tmax if t1 is None else t1
        F = int(round((t1 - t0) * fps)) + 1
        ts = t0 + np.arange(F) / fps
        T = np.repeat(self.T[None], F, 0).copy(); R = np.repeat(self.R[None], F, 0).copy()
        for ch in A['channels']:
            s = A['samplers'][ch['sampler']]; node = ch['target'].get('node'); path = ch['target']['path']
            if node is None or path not in ('translation', 'rotation'): continue
            ti = accessor(j, b, s['input'])[:, 0]; v = accessor(j, b, s['output'])
            if s.get('interpolation') == 'CUBICSPLINE': v = v[1::3]
            if path == 'translation':
                for k in range(3): T[:, node, k] = np.interp(ts, ti, v[:, k])
            else:
                k = np.clip(np.searchsorted(ti, ts) - 1, 0, len(ti) - 1); k2 = np.clip(k + 1, 0, len(ti) - 1)
                dt = np.where(ti[k2] > ti[k], (ts - ti[k]) / np.maximum(ti[k2] - ti[k], 1e-9), 0)
                R[:, node] = qslerp(v[k], v[k2], np.clip(dt, 0, 1))
        return ts, T, R

    def anim_names(self): return [a['name'] for a in self.j.get('animations', [])]

# ---------------- writer: animation-only GLB with a bone-only node tree ----------------
def write_anim_glb(path, skel, clips, extras=None, node_subset=None):
    """clips: list of dict(name, times[F], tracks={node_index: {'translation':[F,3], 'rotation':[F,4]}})
    Writes a GLB whose node tree copies skel (names, rest TRS), no meshes. three.js binds tracks by node name."""
    nodes = []
    for i in range(skel.n):
        nd = {'name': skel.names[i], 'translation': skel.T[i].tolist(), 'rotation': skel.R[i].tolist()}
        if not np.allclose(skel.S[i], 1): nd['scale'] = skel.S[i].tolist()
        ch = [c for c in range(skel.n) if skel.parent[c] == i]
        if ch: nd['children'] = ch
        nodes.append(nd)
    roots = [i for i in range(skel.n) if skel.parent[i] < 0]
    buf = bytearray(); views = []; accs = []
    def add(arr, typ, minmax=False):
        arr = np.ascontiguousarray(arr, np.float32)
        while len(buf) % 4: buf.append(0)
        off = len(buf); buf.extend(arr.tobytes())
        views.append({'buffer': 0, 'byteOffset': off, 'byteLength': arr.nbytes})
        a = {'bufferView': len(views) - 1, 'componentType': 5126, 'count': int(arr.shape[0]), 'type': typ}
        if minmax: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
        accs.append(a); return len(accs) - 1
    anims = []
    for c in clips:
        tin = add(np.asarray(c['times'], np.float32)[:, None], 'SCALAR', True)
        samplers = []; channels = []
        for node, tr in sorted(c['tracks'].items()):
            for path, arr in tr.items():
                arr = np.asarray(arr, np.float32)
                if path == 'rotation': arr = qcontinuous(arr.astype(np.float64)).astype(np.float32)
                o = add(arr, 'VEC4' if path == 'rotation' else 'VEC3')
                samplers.append({'input': tin, 'output': o, 'interpolation': 'LINEAR'})
                channels.append({'sampler': len(samplers) - 1, 'target': {'node': int(node), 'path': path}})
        anims.append({'name': c['name'], 'samplers': samplers, 'channels': channels, **({'extras': c['extras']} if c.get('extras') else {})})
    j = {'asset': {'version': '2.0', 'generator': 'game/tools/anim'}, 'scene': 0, 'scenes': [{'nodes': roots}],
         'nodes': nodes, 'animations': anims, 'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(buf)}]}
    if extras: j['extras'] = extras
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    while len(buf) % 4: buf.append(0)
    total = 12 + 8 + len(js) + 8 + len(buf)
    out = struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(buf), 0x004E4942) + bytes(buf)
    open(path, 'wb').write(out)
    return len(out)
