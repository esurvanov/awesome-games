"""Доступ к сырым ассетам 0 A.D.: пути, текстуры (DDS/PNG → numpy RGBA), COLLADA-меши с кэшем.

Все пути — относительно `assets/0ad_raw/public/art/`. Кэш (конвертированные текстуры и меши в .npz)
лежит в `assets/0ad_raw/_cache/` — он в .gitignore, как и сами сырые ассеты.
"""
import hashlib
import os

import numpy as np
from PIL import Image

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RAW = os.environ.get('OAD_RAW') or os.path.join(REPO, 'assets', '0ad_raw')
if not os.path.isdir(RAW):
    # рабочее дерево git (worktree) без скачанных ассетов — берём из основной копии репозитория
    _main = os.path.abspath(os.path.join(REPO, '..', '..', '..', 'assets', '0ad_raw'))
    if os.path.isdir(_main):
        RAW = _main
ART = os.path.join(RAW, 'public', 'art')
CACHE = os.path.join(RAW, '_cache')

# Мод Millennium A.D. (tools/fetch_millennium.py): его файлы перекрывают public, как в движке 0 A.D.
MIL = os.environ.get('MIL_RAW') or os.path.join(REPO, 'assets', 'millenniumad_raw')
if not os.path.isdir(MIL):
    _main = os.path.abspath(os.path.join(REPO, '..', '..', '..', 'assets', 'millenniumad_raw'))
    if os.path.isdir(_main):
        MIL = _main
MIL_ART = os.path.join(MIL, '_repo', 'art')
# порядок поиска: мод → public 0 A.D. → файлы public, докачанные для мода
ROOTS = [r for r in (MIL_ART, ART, os.path.join(MIL, 'public_deps', 'public', 'art')) if os.path.isdir(r)] or [ART]
_ART_CACHE = {}


def art(*parts):
    """Путь к файлу под art/ с приоритетом модов (первый существующий; иначе — путь в public)."""
    rel = os.path.join(*parts)
    hit = _ART_CACHE.get(rel)
    if hit is None:
        hit = os.path.join(ART, rel)
        for r in ROOTS:
            p = os.path.join(r, rel)
            if os.path.exists(p):
                hit = p
                break
        _ART_CACHE[rel] = hit
    return hit


def mod_of(path):
    """'millenniumad' | 'public' — из какого мода взят файл (для лицензий/отчётов)."""
    return 'millenniumad' if path.startswith(MIL) else 'public'


def exists(*parts):
    return os.path.exists(art(*parts))


# ------------------------------------------------------------------ текстуры
_TEX = {}


def texture(rel):
    """RGBA uint8 (H, W, 4) текстуры скина `textures/skins/<rel>` (или абсолютного пути под art/).

    DDS декодируется Pillow и кэшируется в PNG. Отсутствующая текстура → None."""
    if rel in _TEX:
        return _TEX[rel]
    if rel in GENERATED:
        _TEX[rel] = GENERATED[rel]()
        return _TEX[rel]
    img = None
    root, ext = os.path.splitext(rel)
    # в акторах встречаются .png, которые в репозитории лежат как .dds, и наоборот
    names = [rel] + [root + e for e in ('.png', '.dds', '.tga') if e != ext]
    cands = [n if os.path.isabs(n) else art('textures', 'skins', n) for n in names]
    for p in cands:
        if not os.path.exists(p):
            continue
        if p.endswith('.dds'):
            cp = os.path.join(CACHE, 'tex', hashlib.md5(p.encode()).hexdigest() + '.png')
            if os.path.exists(cp):
                img = Image.open(cp)
            else:
                img = Image.open(p)
                img.load()
                img = img.convert('RGBA')
                os.makedirs(os.path.dirname(cp), exist_ok=True)
                img.save(cp)
        else:
            img = Image.open(p)
        break
    if img is None:
        _TEX[rel] = None
        return None
    a = np.asarray(img.convert('RGBA'), dtype=np.uint8).copy()
    _TEX[rel] = a
    return a


def _flag_cloth():
    """Полотнище флага гарнизона (кельтское) с высветленной тканью: в спрайте цвет игрока — чистый и яркий."""
    a = texture('props/garrison_celt_1.png')
    if a is None:
        return None
    a = a.copy()
    cloth = a[..., 3] < 128
    lum = a[..., :3].astype(np.float32).mean(axis=2, keepdims=True)
    a[..., :3] = np.where(cloth[..., None], np.clip(200 + (lum - lum[cloth].mean()) * 0.5, 0, 255), a[..., :3])
    return a


# Сгенерированные текстуры: имя → функция без аргументов, возвращающая RGBA
GENERATED = {'@flag_cloth': _flag_cloth}


# ------------------------------------------------------------------ меши COLLADA
_MESH = {}
_MESH_VER = 4


def _orthonormal(m):
    """Точка крепления: только поворот + сдвиг (как в PMD 0 A.D.: позиция + кватернион)."""
    m = np.array(m, dtype=np.float64)
    r = m[:3, :3]
    u, _, vt = np.linalg.svd(r)
    q = u @ vt
    if np.linalg.det(q) < 0:
        u[:, -1] *= -1
        q = u @ vt
    m[:3, :3] = q
    return m


def mesh(rel):
    """Меш `meshes/<rel>` → dict: pos (N,3) float32 — треугольники подряд, nrm (N,3), uv0 (N,2), uv1 (N,2),
    props {имя_точки: 4×4}. Координаты — как в файле (Z вверх), с применёнными трансформами узлов.
    None — если файла нет или он не читается."""
    if rel in _MESH:
        return _MESH[rel]
    path = art('meshes', rel)
    if not os.path.exists(path):
        _MESH[rel] = None
        return None
    st = os.stat(path)
    key = hashlib.md5(f'{path}|{st.st_size}|{st.st_mtime}|{_MESH_VER}'.encode()).hexdigest()
    cp = os.path.join(CACHE, 'mesh', key + '.npz')
    if os.path.exists(cp):
        z = np.load(cp, allow_pickle=False)
        names = [str(n) for n in z['prop_names']]
        res = dict(pos=z['pos'], nrm=z['nrm'], uv0=z['uv0'], uv1=z['uv1'],
                   props={n: z['prop_mats'][i] for i, n in enumerate(names)})
        _MESH[rel] = res
        return res
    try:
        res = _load_collada(path)
    except Exception as e:     # битый файл — пропускаем деталь
        print('  ! меш не читается:', rel, type(e).__name__, str(e)[:80])
        res = None
    if res is not None:
        os.makedirs(os.path.dirname(cp), exist_ok=True)
        names = list(res['props'])
        mats = np.array([res['props'][n] for n in names], dtype=np.float64).reshape(-1, 4, 4)
        np.savez_compressed(cp, pos=res['pos'], nrm=res['nrm'], uv0=res['uv0'], uv1=res['uv1'],
                            prop_names=np.array(names, dtype='U64'), prop_mats=mats)
    _MESH[rel] = res
    return res


def _load_collada(path):
    import collada
    d = collada.Collada(path, ignore=[collada.common.DaeUnsupportedError, collada.common.DaeBrokenRefError])
    P, N, U0, U1 = [], [], [], []

    def add_prim(p, mat):
        try:
            t = p if type(p).__name__ in ('TriangleSet', 'BoundTriangleSet') else p.triangleset()
        except Exception:
            return
        if t is None or t.vertex_index is None or len(t.vertex_index) == 0:
            return
        vi = t.vertex_index.reshape(-1)
        v = np.asarray(t.vertex, dtype=np.float64)[vi]
        v = (np.c_[v, np.ones(len(v))] @ mat.T)[:, :3]
        if t.normal is not None and t.normal_index is not None:
            n = np.asarray(t.normal, dtype=np.float64)[t.normal_index.reshape(-1)]
            n = n @ np.linalg.inv(mat[:3, :3])      # (M^-1)^T · n, в строчной записи
        else:
            tri = v.reshape(-1, 3, 3)
            fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
            n = np.repeat(fn, 3, axis=0)
        ln = np.linalg.norm(n, axis=1, keepdims=True)
        n = n / np.maximum(ln, 1e-9)
        uvs = []
        for i in range(2):
            if t.texcoordset and len(t.texcoordset) > i and t.texcoord_indexset[i] is not None:
                uvs.append(np.asarray(t.texcoordset[i], dtype=np.float64)[t.texcoord_indexset[i].reshape(-1)][:, :2])
            else:
                uvs.append(uvs[0] if uvs else np.zeros((len(v), 2)))
        P.append(v)
        N.append(n)
        U0.append(uvs[0])
        U1.append(uvs[1])

    props = {}
    # сцену обходим сами (ElementTree): pycollada молча теряет instance_geometry с «битым» материалом
    import xml.etree.ElementTree as ET
    ns = '{http://www.collada.org/2005/11/COLLADASchema}'
    geoms = {g.id: g for g in d.geometries}
    ctrls = {c.id: c for c in d.controllers}

    def node_matrix(el):
        m = np.eye(4)
        for ch in el:
            tag = ch.tag.replace(ns, '')
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

    def walk(el, parent):
        m = parent @ node_matrix(el)
        nid = el.get('id') or el.get('name') or ''
        if nid.startswith('prop_') or nid.startswith('prop-'):
            props[nid[5:]] = _orthonormal(m)
        for ch in el:
            tag = ch.tag.replace(ns, '')
            if tag == 'node':
                walk(ch, m)
            elif tag == 'instance_geometry':
                g = geoms.get((ch.get('url') or '')[1:])
                if g is not None:
                    for pr in g.primitives:
                        add_prim(pr, m)
            elif tag == 'instance_controller':
                c = ctrls.get((ch.get('url') or '')[1:])
                geom = getattr(c, 'geometry', None)
                if geom is not None:
                    # скиннинг: поза привязки (bind shape); трансформ узла контроллера не применяется,
                    # как и в конвертере 0 A.D.
                    bsm = np.asarray(getattr(c, 'bind_shape_matrix', np.eye(4)), dtype=np.float64).reshape(4, 4)
                    for pr in geom.primitives:
                        add_prim(pr, bsm)

    root = ET.parse(path).getroot()
    scene = root.find(f'{ns}scene/{ns}instance_visual_scene')
    vs_id = (scene.get('url') or '')[1:] if scene is not None else None
    for vs in root.iter(f'{ns}visual_scene'):
        if vs_id and vs.get('id') != vs_id:
            continue
        for n in vs.findall(f'{ns}node'):
            walk(n, np.eye(4))
    if not P:
        return None
    pos = np.concatenate(P).astype(np.float32)
    nrm = np.concatenate(N).astype(np.float32)
    up = (d.assetInfo.upaxis or 'Z_UP').upper()
    if up == 'Y_UP':
        # (x, y, z) Y-вверх → Z-вверх: (x, -z, y)
        conv = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float32)
        pos = pos @ conv.T
        nrm = nrm @ conv.T
        c4 = np.eye(4)
        c4[:3, :3] = conv
        props = {k: c4 @ v for k, v in props.items()}
    return dict(pos=pos, nrm=nrm, uv0=np.concatenate(U0).astype(np.float32),
                uv1=np.concatenate(U1).astype(np.float32), props=props)
