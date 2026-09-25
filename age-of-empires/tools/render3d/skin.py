"""Скелетная анимация 0 A.D.: скелет, скин-контроллер и анимации из COLLADA — свой лёгкий разбор ElementTree
(pycollada падает на ~35 % файлов анимаций), скиннинг на CPU (numpy, линейное смешивание).

  sm = skinned('skeletal/new/m_pants.dae')       # меш со скином (или None — меш без контроллера)
  an = animation('biped/infantry/spearman/walk_relax_shield.dae')
  W  = pose(sm['skel'], an, t)                    # мировые матрицы узлов скелета меша в момент t (с)
  g  = deform(sm, W)                              # {'pos', 'nrm', 'uv0', 'uv1'} — как assets.mesh()
  prop_points(sm['skel'], W)                      # {'weapon_R': 4×4, ...} — точки пропов в этой позе

Семантика — как у конвертера 0 A.D.: кость меша j получает матрицу W_anim[j] · IBM_j (IBM — обратная матрица
привязки), вершины заранее умножены на bind_shape_matrix. Кости сопоставляются по имени (sid/name) узлов;
узлы меша, которых нет в анимации, наследуют позу родителя с собственной локальной матрицей покоя.
Кэш разбора — .npz в assets/0ad_raw/_cache/{skin,anim}/.
"""
import hashlib
import os
import xml.etree.ElementTree as ET

import numpy as np

from . import assets

NS = '{http://www.collada.org/2005/11/COLLADASchema}'
_VER = 4
_SKIN = {}
_ANIM = {}


def _tag(el):
    return el.tag.replace(NS, '')


def _node_local(el):
    m = np.eye(4)
    for ch in el:
        tag = _tag(ch)
        if tag not in ('matrix', 'translate', 'scale', 'rotate'):
            continue
        vals = [float(x) for x in (ch.text or '').split()]
        if tag == 'matrix' and len(vals) == 16:
            m = m @ np.array(vals).reshape(4, 4)
        elif tag == 'translate' and len(vals) == 3:
            t = np.eye(4)
            t[:3, 3] = vals
            m = m @ t
        elif tag == 'scale' and len(vals) == 3:
            m = m @ np.diag(vals + [1.0])
        elif tag == 'rotate' and len(vals) == 4:
            x, y, z, a = vals
            a = np.radians(a)
            ax = np.array([x, y, z]) / (np.linalg.norm([x, y, z]) or 1)
            K = np.array([[0, -ax[2], ax[1]], [ax[2], 0, -ax[0]], [-ax[1], ax[0], 0]])
            r = np.eye(4)
            r[:3, :3] = np.eye(3) + np.sin(a) * K + (1 - np.cos(a)) * K @ K
            m = m @ r
    return m


def _scene_nodes(root):
    """Узлы сцены в порядке обхода (родитель раньше детей): names, ids, parent, rest (N,4,4), ctrl_url."""
    names, ids, parent, rest, ctrl = [], [], [], [], []
    sc = root.find(f'{NS}scene/{NS}instance_visual_scene')
    vs_id = (sc.get('url') or '')[1:] if sc is not None else None

    def walk(el, par):
        i = len(names)
        names.append(el.get('sid') or el.get('name') or el.get('id') or f'n{i}')
        ids.append(el.get('id') or '')
        parent.append(par)
        rest.append(_node_local(el))
        ic = el.find(f'{NS}instance_controller')
        ctrl.append((ic.get('url') or '')[1:] if ic is not None else '')
        for ch in el.findall(f'{NS}node'):
            walk(ch, i)

    for vs in root.iter(f'{NS}visual_scene'):
        if vs_id and vs.get('id') != vs_id:
            continue
        for n in vs.findall(f'{NS}node'):
            walk(n, -1)
    return names, ids, np.array(parent, np.int32), np.array(rest, np.float64).reshape(-1, 4, 4), ctrl


def _up_conv(root):
    up = root.find(f'{NS}asset/{NS}up_axis')
    if up is not None and (up.text or '').strip().upper() == 'Y_UP':
        c = np.eye(4)
        c[:3, :3] = [[1, 0, 0], [0, 0, -1], [0, 1, 0]]
        return c
    return None


def _cache_path(kind, path):
    st = os.stat(path)
    key = hashlib.md5(f'{path}|{st.st_size}|{st.st_mtime}|{_VER}'.encode()).hexdigest()
    return os.path.join(assets.CACHE, kind, key + '.npz')


# ------------------------------------------------------------------ меш со скином
def skinned(rel):
    """`meshes/<rel>` со скин-контроллером → dict или None (нет файла / нет контроллера)."""
    if rel in _SKIN:
        return _SKIN[rel]
    path = assets.art('meshes', rel)
    if not os.path.exists(path):
        _SKIN[rel] = None
        return None
    cp = _cache_path('skin', path)
    if os.path.exists(cp):
        z = np.load(cp, allow_pickle=False)
        if not bool(z['has']):
            _SKIN[rel] = None
            return None
        res = {k: z[k] for k in ('pos', 'nrm', 'uv0', 'uv1', 'jidx', 'jw', 'ibm')}
        res['joints'] = [str(x) for x in z['joints']]
        res['skel'] = dict(names=[str(x) for x in z['names']], parent=z['parent'], rest=z['rest'],
                           conv=z['conv'] if z['conv'].size else None)
        _SKIN[rel] = res
        return res
    try:
        res = _load_skinned(path)
    except Exception as e:
        print('  ! скин не читается:', rel, type(e).__name__, str(e)[:100])
        res = None
    os.makedirs(os.path.dirname(cp), exist_ok=True)
    if res is None:
        np.savez_compressed(cp, has=False)
    else:
        sk = res['skel']
        np.savez_compressed(cp, has=True, pos=res['pos'], nrm=res['nrm'], uv0=res['uv0'], uv1=res['uv1'],
                            jidx=res['jidx'], jw=res['jw'], ibm=res['ibm'],
                            joints=np.array(res['joints'], dtype='U64'),
                            names=np.array(sk['names'], dtype='U64'), parent=sk['parent'], rest=sk['rest'],
                            conv=sk['conv'] if sk['conv'] is not None else np.zeros(0))
    _SKIN[rel] = res
    return res


def _source_floats(root, sid):
    src = root.find(f".//{NS}source[@id='{sid}']")
    fa = src.find(f'{NS}float_array')
    return np.array((fa.text or '').split(), np.float64)


def _source_names(root, sid):
    src = root.find(f".//{NS}source[@id='{sid}']")
    na = src.find(f'{NS}Name_array')
    if na is None:
        na = src.find(f'{NS}IDREF_array')
    return (na.text or '').split()


def _load_skinned(path):
    import collada
    root = ET.parse(path).getroot()
    ctrl = root.find(f'{NS}library_controllers/{NS}controller')
    if ctrl is None:
        return None
    names, ids, parent, rest, ctrls = _scene_nodes(root)
    # контроллер, реально подключённый в сцене
    used = [c for c in ctrls if c]
    if used:
        ctrl = root.find(f".//{NS}controller[@id='{used[0]}']") or ctrl
    skin = ctrl.find(f'{NS}skin')
    geom_id = (skin.get('source') or '')[1:]
    bsm_el = skin.find(f'{NS}bind_shape_matrix')
    bsm = np.array((bsm_el.text or '').split(), np.float64).reshape(4, 4) if bsm_el is not None else np.eye(4)
    jn = ibm = None
    for inp in skin.find(f'{NS}joints').findall(f'{NS}input'):
        s = (inp.get('source') or '')[1:]
        if inp.get('semantic') == 'JOINT':
            jn = _source_names(skin, s)
        elif inp.get('semantic') == 'INV_BIND_MATRIX':
            ibm = _source_floats(skin, s).reshape(-1, 4, 4)
    vw = skin.find(f'{NS}vertex_weights')
    offs, srcs = {}, {}
    for inp in vw.findall(f'{NS}input'):
        offs[inp.get('semantic')] = int(inp.get('offset'))
        srcs[inp.get('semantic')] = (inp.get('source') or '')[1:]
    wts = _source_floats(skin, srcs['WEIGHT'])
    vcount = np.array((vw.find(f'{NS}vcount').text or '').split(), np.int64)
    v = np.array((vw.find(f'{NS}v').text or '').split(), np.int64)
    stride = max(offs.values()) + 1
    v = v.reshape(-1, stride)
    nv = len(vcount)
    jidx = np.zeros((nv, 4), np.int32)
    jw = np.zeros((nv, 4), np.float32)
    k = 0
    for i, c in enumerate(vcount):
        ent = v[k:k + c]
        k += c
        if c == 0:
            continue
        js = ent[:, offs['JOINT']]
        ws = wts[ent[:, offs['WEIGHT']]]
        order = np.argsort(-ws)[:4]
        s = ws[order].sum()
        if s <= 0:
            continue
        jidx[i, :len(order)] = js[order]
        jw[i, :len(order)] = ws[order] / s
    # геометрия: треугольники подряд, индексы позиций → веса
    d = collada.Collada(path, ignore=[collada.common.DaeUnsupportedError, collada.common.DaeBrokenRefError])
    g = next((x for x in d.geometries if x.id == geom_id), None)
    if g is None:
        return None
    P, N, U0, U1, J, Wt = [], [], [], [], [], []
    for p in g.primitives:
        try:
            t = p if type(p).__name__ in ('TriangleSet',) else p.triangleset()
        except Exception:
            continue
        if t is None or t.vertex_index is None or len(t.vertex_index) == 0:
            continue
        vi = t.vertex_index.reshape(-1)
        pos = np.asarray(t.vertex, np.float64)[vi]
        pos = (np.c_[pos, np.ones(len(pos))] @ bsm.T)[:, :3]
        if t.normal is not None and t.normal_index is not None:
            n = np.asarray(t.normal, np.float64)[t.normal_index.reshape(-1)]
            n = n @ np.linalg.inv(bsm[:3, :3])
        else:
            tri = pos.reshape(-1, 3, 3)
            fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
            n = np.repeat(fn, 3, axis=0)
        n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
        uvs = []
        for i in range(2):
            if t.texcoordset and len(t.texcoordset) > i and t.texcoord_indexset[i] is not None:
                uvs.append(np.asarray(t.texcoordset[i], np.float64)[t.texcoord_indexset[i].reshape(-1)][:, :2])
            else:
                uvs.append(uvs[0] if uvs else np.zeros((len(pos), 2)))
        P.append(pos)
        N.append(n)
        U0.append(uvs[0])
        U1.append(uvs[1])
        vi = np.minimum(vi, nv - 1)
        J.append(jidx[vi])
        Wt.append(jw[vi])
    if not P:
        return None
    return dict(pos=np.concatenate(P).astype(np.float32), nrm=np.concatenate(N).astype(np.float32),
                uv0=np.concatenate(U0).astype(np.float32), uv1=np.concatenate(U1).astype(np.float32),
                jidx=np.concatenate(J).astype(np.int32), jw=np.concatenate(Wt).astype(np.float32),
                ibm=ibm.astype(np.float64), joints=jn,
                skel=dict(names=names, parent=parent, rest=rest, conv=_up_conv(root)))


# ------------------------------------------------------------------ анимации
def animation(rel):
    """`animation/<rel>` → dict: names, parent, rest (узлы файла), dur (с), chan {индекс узла: (times, mats)}."""
    if rel in _ANIM:
        return _ANIM[rel]
    path = assets.art('animation', rel)
    if not os.path.exists(path):
        _ANIM[rel] = None
        return None
    cp = _cache_path('anim', path)
    if os.path.exists(cp):
        z = np.load(cp, allow_pickle=False)
        chan = {}
        ci = z['chan_node']
        off = z['chan_off']
        for k, n in enumerate(ci):
            a, b = off[k], off[k + 1]
            chan[int(n)] = (z['times'][a:b], z['mats'][a:b])
        res = dict(names=[str(x) for x in z['names']], parent=z['parent'], rest=z['rest'], dur=float(z['dur']),
                   chan=chan)
        _ANIM[rel] = res
        return res
    try:
        res = _load_anim(path)
    except Exception as e:
        print('  ! анимация не читается:', rel, type(e).__name__, str(e)[:100])
        res = None
    if res is not None:
        os.makedirs(os.path.dirname(cp), exist_ok=True)
        keys = sorted(res['chan'])
        off = [0]
        T, M = [], []
        for k in keys:
            t, m = res['chan'][k]
            T.append(t)
            M.append(m)
            off.append(off[-1] + len(t))
        np.savez_compressed(cp, names=np.array(res['names'], dtype='U64'), parent=res['parent'], rest=res['rest'],
                            dur=res['dur'], chan_node=np.array(keys, np.int32), chan_off=np.array(off, np.int64),
                            times=np.concatenate(T) if T else np.zeros(0),
                            mats=np.concatenate(M) if M else np.zeros((0, 4, 4)))
    _ANIM[rel] = res
    return res


def _load_anim(path):
    root = ET.parse(path).getroot()
    names, ids, parent, rest, _ = _scene_nodes(root)
    by_id = {}
    for k, i in enumerate(ids):
        if i:
            by_id.setdefault(i, k)      # в некоторых файлах скелет продублирован — берём первый
    chan = {}
    dur = 0.0
    for an in root.iter(f'{NS}animation'):
        srcs = {s.get('id'): s for s in an.findall(f'{NS}source')}
        samplers = {s.get('id'): s for s in an.findall(f'{NS}sampler')}
        for ch in an.findall(f'{NS}channel'):
            tgt = ch.get('target') or ''
            if '/' not in tgt:
                continue
            nid, what = tgt.split('/', 1)
            if what not in ('transform', 'matrix') or nid not in by_id:
                continue
            smp = samplers.get((ch.get('source') or '')[1:])
            if smp is None:
                continue
            inp = {i.get('semantic'): (i.get('source') or '')[1:] for i in smp.findall(f'{NS}input')}
            si, so = srcs.get(inp.get('INPUT')), srcs.get(inp.get('OUTPUT'))
            if si is None or so is None:
                continue
            t = np.array((si.find(f'{NS}float_array').text or '').split(), np.float64)
            m = np.array((so.find(f'{NS}float_array').text or '').split(), np.float64)
            if len(m) != len(t) * 16 or not len(t):
                continue
            chan[by_id[nid]] = (t, m.reshape(-1, 4, 4))
            dur = max(dur, float(t[-1]))
    conv = _up_conv(root)
    if conv is not None and len(rest):
        # корень сцены Y-вверх → Z-вверх (поворачиваем только корневые узлы)
        for k in range(len(rest)):
            if parent[k] < 0:
                rest[k] = conv @ rest[k]
                if k in chan:
                    t, m = chan[k]
                    chan[k] = (t, conv[None] @ m)
    return dict(names=names, parent=parent, rest=rest, dur=dur, chan=chan)


def _orth(m):
    """Убирает «дрейф» линейной интерполяции: вращение → ближайшее ортогональное с сохранением масштаба."""
    r = m[..., :3, :3]
    u, s, vt = np.linalg.svd(r)
    q = u @ vt
    sc = np.linalg.norm(r, axis=-2, keepdims=True)
    out = m.copy()
    out[..., :3, :3] = q * sc
    return out


def sample_local(an, t):
    """Локальные матрицы всех узлов файла анимации в момент t (циклически обрезается по длительности)."""
    L = an['rest'].copy()
    for k, (ts, ms) in an['chan'].items():
        if len(ts) == 1 or t <= ts[0]:
            L[k] = ms[0]
            continue
        if t >= ts[-1]:
            L[k] = ms[-1]
            continue
        i = int(np.searchsorted(ts, t, side='right')) - 1
        i = min(max(i, 0), len(ts) - 2)
        f = (t - ts[i]) / max(ts[i + 1] - ts[i], 1e-9)
        m = ms[i] * (1 - f) + ms[i + 1] * f
        L[k] = _orth(m) if 0 < f < 1 else m
    return L


def world(names, parent, local):
    W = np.empty_like(local)
    for i in range(len(names)):
        p = parent[i]
        W[i] = local[i] if p < 0 else W[p] @ local[i]
    return W


def pose(skel, an, t):
    """Мировые матрицы узлов скелета skel ({names, parent, rest}) под анимацией an в момент t.
    an=None — поза покоя файла меша."""
    names, parent, rest = skel['names'], skel['parent'], skel['rest']
    if an is None:
        W = world(names, parent, rest)
    else:
        aw = world(an['names'], an['parent'], sample_local(an, t))
        amap = {}
        for k, n in enumerate(an['names']):
            amap.setdefault(n, k)
        W = np.empty_like(rest)
        for i, n in enumerate(names):
            k = amap.get(n)
            if k is not None:
                W[i] = aw[k]
            else:
                p = parent[i]
                W[i] = rest[i] if p < 0 else W[p] @ rest[i]
    conv = skel.get('conv')
    if conv is not None:
        W = conv[None] @ W
    return W


def deform(sm, W):
    """Скиннинг меша sm позой W (из pose) → {'pos', 'nrm', 'uv0', 'uv1', 'props': {}}."""
    idx = {n: i for i, n in enumerate(sm['skel']['names'])}
    J = len(sm['joints'])
    S = np.zeros((J, 4, 4))
    for j, n in enumerate(sm['joints']):
        i = idx.get(n)
        S[j] = (W[i] if i is not None else np.eye(4)) @ sm['ibm'][j]
    conv = sm['skel'].get('conv')
    if conv is not None:
        # W уже в Z-вверх; вершины и IBM — в осях файла
        pass
    ji, jw = sm['jidx'], sm['jw']
    M = np.einsum('nk,nkij->nij', jw.astype(np.float64), S[ji])          # (N,4,4) смешанные матрицы
    p = sm['pos'].astype(np.float64)
    pos = np.einsum('nij,nj->ni', M[:, :3, :3], p) + M[:, :3, 3]
    nrm = np.einsum('nij,nj->ni', M[:, :3, :3], sm['nrm'].astype(np.float64))
    nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
    return dict(pos=pos.astype(np.float32), nrm=nrm.astype(np.float32), uv0=sm['uv0'], uv1=sm['uv1'], props={})


def orthonormal(m):
    return assets._orthonormal(m)


def prop_points(skel, W):
    """{имя точки: 4×4} — узлы 'prop-X' / 'prop_X' скелета в позе W."""
    out = {}
    for i, n in enumerate(skel['names']):
        if n.startswith('prop-') or n.startswith('prop_'):
            out.setdefault(n[5:], orthonormal(W[i]))
    return out
