"""Акторы 0 A.D. (XML): выбор вариантов, материалы, текстуры и рекурсивные пропы → плоский список деталей.

Актор — набор групп `<group>`, из каждой берётся один `<variant>`; итог — слияние выбранных вариантов
(меш, текстуры, пропы, декаль). Вариант может подтягивать общий блок `file="…"` из `art/variants/`.
Пропы крепятся к точкам `prop_<имя>` меша-родителя (`root` — начало координат модели) и сами могут
быть акторами с пропами.

Выбор варианта детерминирован:
  1) если имя варианта есть в `prefer` (напр. {'alive', 'ungarrisoned'}) — берём его;
  2) иначе, если в `pick` есть ключ с именем группы/индексом и он подходит — по нему;
  3) иначе — взвешенно по `frequency` генератором random.Random(seed + глубина + номер группы).
"""
import os
import random
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

import numpy as np

from . import assets

DEFAULT_PREFER = frozenset({'alive', 'garrisoned', 'idle', 'base', 'gate_closed', 'closed', 'normal',
                            'lod0', 'no_trees', 'none'})
SKIP_ACTOR_PREFIXES = ('particle/',)


@dataclass
class Part:
    """Одна рисуемая деталь: меш + мировая матрица (в координатах модели корневого актора)."""
    mesh: str
    matrix: np.ndarray
    textures: dict
    material: str
    actor: str
    decal: dict = None          # для декалей: width, depth, offsetx, offsetz, angle
    tags: set = field(default_factory=set)
    geom: dict = None           # готовая геометрия (поза скелета) вместо assets.mesh(mesh)

    @property
    def player(self):
        return 'player' in self.material

    @property
    def alpha_test(self):
        m = self.material
        return 'basic_trans' in m or m.startswith('basic_') or 'trans_wind' in m or 'player_water' in m

    @property
    def is_decal(self):
        return self.decal is not None


_XML = {}


def _xml(path):
    if path not in _XML:
        _XML[path] = ET.parse(path).getroot() if os.path.exists(path) else None
    return _XML[path]


def _actor_root(rel):
    return _xml(assets.art('actors', rel))


def _variant_file(rel):
    return _xml(assets.art('variants', rel))


def _merge(acc, v):
    """Сливает вариант v (Element) в накопитель acc."""
    f = v.get('file')
    if f:
        base = _variant_file(f)
        if base is not None:
            _merge(acc, base)
    m = v.find('mesh')
    if m is not None and (m.text or '').strip():
        acc['mesh'] = m.text.strip()
    tx = v.find('textures')
    if tx is not None:
        for t in tx.findall('texture'):
            acc['textures'][t.get('name')] = t.get('file')
    pr = v.find('props')
    if pr is not None:
        for p in pr.findall('prop'):
            ap = p.get('attachpoint')
            a = p.get('actor') or ''
            if not a:
                acc['props'] = [x for x in acc['props'] if x[1] != ap]
            else:
                acc['props'].append((a, ap, p))
    d = v.find('decal')
    if d is not None:
        acc['decal'] = {k: float(d.get(k, 0)) for k in ('width', 'depth', 'offsetx', 'offsetz', 'angle')}
    c = v.find('color')
    if c is not None and (c.text or '').strip():
        acc['color'] = c.text.strip()


def choose_variants(root, seed=0, prefer=DEFAULT_PREFER, pick=None, depth=0):
    """Возвращает список выбранных <variant> по группам."""
    pick = pick or {}
    out = []
    for gi, g in enumerate(root.findall('group')):
        vs = g.findall('variant')
        if not vs:
            continue
        chosen = None
        for v in vs:
            if (v.get('name') or '').strip().lower() in prefer:
                chosen = v
                break
        if chosen is None:
            # явный выбор: по номеру группы или по имени одного из вариантов
            for key in (gi, *(v.get('name') for v in vs)):
                if key in pick:
                    want = pick[key]
                    if isinstance(want, int) and 0 <= want < len(vs):
                        chosen = vs[want]
                    else:
                        chosen = next((v for v in vs if v.get('name') == want), None)
                    if chosen is not None:
                        break
        if chosen is None:
            w = [float(v.get('frequency', '0') or 0) for v in vs]
            if sum(w) <= 0:
                chosen = vs[0]
            else:
                r = random.Random(seed * 1009 + depth * 97 + gi * 13)
                chosen = r.choices(vs, weights=w)[0]
        out.append(chosen)
    return out


def resolve(actor, seed=0, prefer=DEFAULT_PREFER, pick=None, matrix=None, depth=0, skip=None, prop_scale=None):
    """Актор (путь относительно art/actors/) → список Part. skip — функция(actor_path, attachpoint) → True,
    чтобы пропустить проп (например, флаги гарнизона или дым). prop_scale — {префикс пути актора: множитель}:
    увеличить проп (флаги цвета игрока делаем крупнее, чтобы цвет читался в мелком спрайте)."""
    if depth > 8:
        return []
    root = _actor_root(actor)
    if root is None:
        return []
    matrix = np.eye(4) if matrix is None else matrix
    acc = {'mesh': None, 'textures': {}, 'props': [], 'decal': None, 'color': None}
    for v in choose_variants(root, seed, prefer, pick if depth == 0 else None, depth):
        _merge(acc, v)
    mat_el = root.find('material')
    material = (mat_el.text or '').strip() if mat_el is not None else 'default.xml'
    parts = []
    points = {}
    if acc['decal'] is not None:
        parts.append(Part(mesh='', matrix=matrix, textures=acc['textures'], material=material, actor=actor,
                          decal=acc['decal']))
    elif acc['mesh']:
        m = assets.mesh(acc['mesh'])
        if m is not None:
            parts.append(Part(mesh=acc['mesh'], matrix=matrix, textures=acc['textures'], material=material,
                              actor=actor))
            points = m['props']
    for (pa, ap, _el) in acc['props']:
        if pa.startswith(SKIP_ACTOR_PREFIXES) or (skip and skip(pa, ap)):
            continue
        if ap == 'root':
            pm = np.eye(4)
        else:
            pm = points.get(ap)
            if pm is None:
                continue
        for pre, k in (prop_scale or {}).items():
            if pa.startswith(pre):
                pm = pm @ np.diag([k, k, k, 1.0])
                break
        parts += resolve(pa, seed, prefer, None, matrix @ pm, depth + 1, skip, prop_scale)
    return parts


def actor_exists(actor):
    return os.path.exists(assets.art('actors', actor))
