#!/usr/bin/env python3
"""Сборка спрайтов из 3D-моделей 0 A.D. → assets/gen/ (PNG + atlas.json).

Нужны скачанные сырые ассеты (tools/fetch_0ad.py → assets/0ad_raw/). Рендер — tools/render3d.

  .venv/bin/python tools/build_sprites.py                 # всё
  .venv/bin/python tools/build_sprites.py --only buildings --groups brit,han
  .venv/bin/python tools/build_sprites.py --sheets shots/sheets    # + контактные листы для проверки глазами

Что получается (все пути — относительно assets/gen/):
  atlas.json            — индекс: группы цивилизаций, здания (якоря, маски, стадии стройки), природа, террейн
  buildings/<группа>/<вид>.png        — готовое здание, RGBA; <вид>.m.png — маска цвета игрока (L8)
  buildings/<группа>/<вид>.c<N>.png   — стадии стройки 0..2 (фундамент, треть, две трети)
  nature/*.png          — деревья, пни, кусты, шахты, рыба, животные (8 направлений)
  terrain/*.png         — изометрические плитки текстур земли (бесшовные, период P×P клеток)
Производные материалы 0 A.D. © Wildfire Games, CC BY-SA 3.0 (см. CREDITS.md).
"""
import argparse
import json
import math
import os
import sys
import time

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from tools.render3d import Renderer, resolve, fit_to_footprint, parts_bounds, camera, assets  # noqa: E402
from tools.render3d.actor import actor_exists  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(REPO, 'assets', 'gen')

# ---------------------------------------------------------------- цивилизации → наборы архитектуры
# Средневековые наборы — из мода Millennium A.D. (tools/fetch_millennium.py; пути акторов те же, что в
# 0 A.D.: мод перекрывает public), недостающие виды — из 0 A.D. Ханьский набор — из 0 A.D.
GROUPS = ['caro', 'teut', 'anglo', 'celt', 'norse', 'rus', 'byz', 'hisp', 'umay', 'han']
CIV_GROUP = {
    'franks': 'caro', 'teutons': 'teut', 'britons': 'anglo', 'celts': 'celt', 'vikings': 'norse',
    'goths': 'rus', 'byzantines': 'byz', 'spanish': 'hisp',
    'persians': 'umay', 'saracens': 'umay', 'turks': 'umay',
    'chinese': 'han', 'japanese': 'han', 'mongols': 'han',
    'default': 'caro',
}
_C, _A, _N, _R, _B, _U = ('structures/carolingian/', 'structures/anglo/', 'structures/norse/', 'structures/rus/',
                          'structures/byzantines/', 'structures/umayyads/')
_G0 = 'structures/germans/'          # 0 A.D. (германцы): стрельбище, мастерская, большой зал
# вид → актор (или список вариантов для домов: (актор, номер варианта модели))
MED = {
    'caro': {  # франки: каролингский фахверк, романская церковь, кольцевая крепость
        'town_center': _C + 'civil_centre', 'house': [(_C + 'house', 0), (_C + 'house', 1), (_A + 'house', 2)],
        'mill': _C + 'farmstead', 'lumber_camp': _C + 'storehouse', 'mining_camp': _C + 'storehouse',
        'barracks': _C + 'jarls_hold', 'archery_range': _A + 'barracks', 'stable': _A + 'stables',
        'blacksmith': _C + 'blacksmith', 'tower': _C + 'sentry_tower', 'guard_tower': _C + 'defense_tower',
        'keep': _A + 'defense_tower', 'siege_workshop': _G0 + 'workshop', 'castle': _C + 'fortress',
        'monastery': _C + 'church', 'market': _C + 'market', 'university': _C + 'lorsch_abbey',
        'dock': _C + 'dock_base'},
    'teut': {  # тевтоны: каролингская база, каменные замок и башни
        'town_center': _C + 'civil_centre', 'house': [(_C + 'house', 1), (_R + 'house', 0), (_C + 'house', 0)],
        'mill': _C + 'farmstead', 'lumber_camp': _C + 'storehouse', 'mining_camp': _C + 'storehouse',
        'barracks': _R + 'barracks', 'archery_range': _G0 + 'range', 'stable': _A + 'stables',
        'blacksmith': _C + 'blacksmith', 'tower': _C + 'sentry_tower', 'guard_tower': _B + 'wall_tower',
        'keep': _B + 'wall_tower_sq', 'siege_workshop': _G0 + 'workshop', 'castle': _B + 'fortress',
        'monastery': _C + 'lorsch_abbey', 'market': _C + 'market', 'university': _C + 'church',
        'dock': _C + 'dock_base'},
    'anglo': {  # бритты: англосаксонские соломенные крыши, частокол с каменной башней
        'town_center': _A + 'civil_center', 'house': [(_A + 'house', 0), (_A + 'house', 1), (_A + 'house', 3)],
        'mill': _A + 'farmstead', 'lumber_camp': _A + 'storehouse', 'mining_camp': _A + 'storehouse',
        'barracks': _A + 'barracks', 'archery_range': _G0 + 'range', 'stable': _A + 'stables',
        'blacksmith': _A + 'blacksmith', 'tower': _N + 'outpost', 'guard_tower': _C + 'defense_tower',
        'keep': _A + 'defense_tower', 'siege_workshop': _G0 + 'workshop', 'castle': _A + 'fortress',
        'monastery': _A + 'temple', 'market': _A + 'market', 'university': _C + 'lorsch_abbey',
        'dock': _A + 'dock'},
    'celt': {  # кельты: англосаксонская/норманнская смесь
        'town_center': _C + 'jarls_hold', 'house': [(_A + 'house', 2), (_A + 'house', 1), (_N + 'house', 0)],
        'mill': _A + 'farmstead', 'lumber_camp': _N + 'storehouse', 'mining_camp': _N + 'storehouse',
        'barracks': _A + 'barracks', 'archery_range': _G0 + 'range', 'stable': _A + 'stables',
        'blacksmith': _N + 'blacksmith', 'tower': _N + 'outpost', 'guard_tower': _N + 'defense_tower',
        'keep': _A + 'defense_tower', 'siege_workshop': _G0 + 'workshop', 'castle': _A + 'fortress',
        'monastery': _A + 'temple', 'market': _A + 'market', 'university': _G0 + 'great_hall',
        'dock': _A + 'dock'},
    'norse': {  # викинги: длинные дома, кольцевая крепость (Треллеборг)
        'town_center': _N + 'jarls_hold', 'house': [(_N + 'house', 0), (_N + 'longhouse', 0), (_N + 'house', 0)],
        'mill': _A + 'farmstead', 'lumber_camp': _N + 'storehouse', 'mining_camp': _N + 'storehouse',
        'barracks': _N + 'barracks', 'archery_range': _N + 'longhouse', 'stable': _A + 'stables',
        'blacksmith': _N + 'blacksmith', 'tower': _N + 'outpost', 'guard_tower': _N + 'defense_tower',
        'keep': _A + 'defense_tower', 'siege_workshop': _G0 + 'workshop', 'castle': _C + 'fortress',
        'monastery': _N + 'temple', 'market': _N + 'market', 'university': _G0 + 'great_hall',
        'dock': _N + 'dock_base'},
    'rus': {  # готы: восточноевропейское дерево (срубы, шатровые башни)
        'town_center': _R + 'civic_center', 'house': [(_R + 'house', 0), (_R + 'house', 0), (_R + 'house', 0)],
        'mill': _R + 'farmstead', 'lumber_camp': _R + 'storehouse', 'mining_camp': _R + 'storehouse',
        'barracks': _R + 'barracks', 'archery_range': _R + 'hunting_lodge', 'stable': _R + 'stables',
        'blacksmith': _R + 'blacksmith', 'tower': _R + 'sentry_tower', 'guard_tower': _N + 'defense_tower',
        'keep': _A + 'defense_tower', 'siege_workshop': _G0 + 'workshop', 'castle': _R + 'fortress',
        'monastery': _R + 'temple', 'market': _R + 'market', 'university': _R + 'trading_post',
        'dock': _R + 'dock'},
    'byz': {  # византийцы: кирпич с черепицей, купольный храм
        'town_center': _B + 'civic_center', 'house': [(_B + 'house', 0), (_B + 'house', 1), (_B + 'house', 3)],
        'mill': _B + 'farmstead', 'lumber_camp': _B + 'storehouse', 'mining_camp': _B + 'storehouse',
        'barracks': _B + 'barracks', 'archery_range': _B + 'range', 'stable': _B + 'stable',
        'blacksmith': _B + 'blacksmith', 'tower': _B + 'sentry_tower', 'guard_tower': _B + 'defense_tower',
        'keep': _B + 'defense_tower_02', 'siege_workshop': _B + 'armory', 'castle': _B + 'fortress',
        'monastery': _B + 'temple_02', 'market': _B + 'market', 'university': _B + 'library',
        'dock': _B + 'dock'},
    'hisp': {  # испанцы: романская церковь, алькасар, черепица
        'town_center': _B + 'civic_center', 'house': [(_B + 'house', 2), (_B + 'house', 4), (_U + 'house', 0)],
        'mill': _B + 'farmstead', 'lumber_camp': _U + 'storehouse', 'mining_camp': _U + 'storehouse',
        'barracks': _B + 'barracks_02', 'archery_range': _B + 'range', 'stable': _U + 'stables',
        'blacksmith': _B + 'blacksmith', 'tower': _B + 'sentry_tower_02', 'guard_tower': _B + 'defense_tower',
        'keep': _U + 'defense_tower', 'siege_workshop': _B + 'armory', 'castle': _U + 'fortress',
        'monastery': _C + 'church', 'market': _U + 'market', 'university': _B + 'library',
        'dock': _B + 'dock'},
    'umay': {  # персы, сарацины, турки: омейядская архитектура (мечеть, крепость, купола)
        'town_center': _U + 'civic_center', 'house': [(_U + 'house', 0), (_U + 'house', 1), (_U + 'house', 3)],
        'mill': _U + 'farmstead', 'lumber_camp': _U + 'storehouse', 'mining_camp': _U + 'storehouse',
        'barracks': _U + 'military_colony', 'archery_range': _B + 'range', 'stable': _U + 'stables',
        'blacksmith': _U + 'blacksmith', 'tower': _U + 'sentry_tower', 'guard_tower': _U + 'defense_tower',
        'keep': _B + 'defense_tower', 'siege_workshop': _B + 'armory', 'castle': _U + 'fortress',
        'monastery': _U + 'temple', 'market': _U + 'market', 'university': 'structures/achaemenids/hall',
        'dock': _B + 'dock'},
}
SETS = {'han': ['han']}
FLAG = {'han': 'han'}

# наш вид → имена акторов 0 A.D. (первый найденный в цепочке наборов группы)
KIND_ACTORS = {
    'town_center': ['civic_centre', 'civic_center', 'civil_centre'],
    'house': ['house'],
    'mill': ['farmstead'],
    'lumber_camp': ['storehouse'],
    'mining_camp': ['storehouse'],
    'barracks': ['barracks'],
    'archery_range': ['range'],
    'stable': ['stable'],
    'blacksmith': ['blacksmith', 'forge'],
    'tower': ['wooden_tower', 'sentry_tower', 'tower_small'],
    'guard_tower': ['scout_tower', 'tower_great'],
    'keep': ['defense_tower', 'tower_bolt', 'tower_large'],
    'siege_workshop': ['workshop', 'arsenal'],
    'castle': ['fortress'],
    'monastery': ['temple'],
    'market': ['market', 'market_newest'],
    'university': ['academy', 'hall'],
    'dock': ['dock'],
}
# точечные замены: (группа, вид) → полный путь актора
OVERRIDE = {
    ('han', 'guard_tower'): 'structures/han/tower_great.xml',
    ('han', 'university'): 'structures/han/academy.xml',
}
SIZE = {'town_center': 4, 'house': 2, 'mill': 2, 'lumber_camp': 2, 'mining_camp': 2, 'farm': 3, 'barracks': 3,
        'archery_range': 3, 'stable': 3, 'blacksmith': 3, 'tower': 1, 'guard_tower': 1, 'keep': 1,
        'siege_workshop': 4, 'castle': 4, 'monastery': 3, 'university': 4, 'market': 4, 'dock': 3}
# Заполнение основания (как в AoE II DE: здание занимает весь участок, ширина спрайта ≈ 0.98–1.05 ширины ромба).
# Масштаб — наименьший из двух: ширина габарита на экране (dx + dy)/2 = WFILL·n и длинная сторона ≤ OVER·n
# (вытянутые модели 0 A.D. иначе либо мелкие, либо далеко вылезают за участок). FILL — поправка по виду.
WFILL = 1.0
OVER = 1.2
FILL = {'tower': 1.0, 'guard_tower': 1.05, 'keep': 1.1, 'castle': 1.05, 'dock': 0.97}
YAW = {}                    # (группа, вид) или вид → поворот модели, градусы
# ящики, дрова, камни у складов: (актор, x, y (клетки основания), поворот, множитель масштаба)
EXTRAS = {
    'lumber_camp': [('props/special/eyecandy/woodcord.xml', 1.55, 1.25, 90, 1.0),
                    ('props/special/eyecandy/wood_pile.xml', 1.2, 1.7, 0, 1.0),
                    ('props/special/eyecandy/plank_pile_big_01.xml', 0.45, 1.65, 45, 1.0)],
    'mining_camp': [('geology/stone_granite_small.xml', 1.6, 1.3, 0, 0.45),
                    ('geology/metal_temperate_small.xml', 1.25, 1.7, 30, 0.4),
                    ('props/special/eyecandy/handcart_1.xml', 0.45, 1.6, 60, 1.0)],
    'mill': [('props/special/eyecandy/hay_large.xml', 1.6, 1.55, 20, 1.0),
             ('props/special/eyecandy/food_sack.xml', 1.25, 1.75, 0, 1.2)],
}
FLAG_SCALE = 1.4
FLAG_TEX = '@flag_cloth'
# предел высоты (клетки высоты, 1 ≈ 39 px): узкие высокие модели иначе вырастают над картой
MAX_H = {'tower': 2.3, 'guard_tower': 2.6, 'keep': 2.9, 'house': 1.85}


def _xml(a):
    return a if a.endswith('.xml') else a + '.xml'


def _variant_pick(actor, i):
    """Выбор i-го варианта модели в первой группе актора, где вариантов с мешем больше одного."""
    from tools.render3d.actor import _actor_root
    root = _actor_root(actor)
    if root is None:
        return None
    for gi, g in enumerate(root.findall('group')):
        vs = [v for v in g.findall('variant') if v.find('mesh') is not None or v.get('file')]
        if len(vs) > 1:
            return {gi: i % len(g.findall('variant'))}
    return None


def building_actor(group, kind):
    """→ актор (путь) или None; для домов см. building_variants."""
    v = building_variants(group, kind)
    return v[0][0] if v else None


def building_variants(group, kind):
    """→ [(актор, pick | None), …]: у домов — 2–3 варианта (разные модели), у прочих — один."""
    if group in MED:
        spec = MED[group].get(kind)
        if spec is None:
            return []
        if isinstance(spec, str):
            spec = [(spec, None)]
        out = []
        for a, *rest in spec:
            a = _xml(a)
            if not actor_exists(a):
                print(f'  ! нет актора {a}')
                continue
            pick = _variant_pick(a, rest[0]) if rest and rest[0] is not None else None
            out.append((a, pick))
        return out
    a = OVERRIDE.get((group, kind))
    if a and actor_exists(a):
        return [(a, None)]
    for st in SETS[group]:
        for name in KIND_ACTORS[kind]:
            p = f'structures/{st}/{name}.xml'
            if actor_exists(p):
                return [(p, None)]
    return []


# ---------------------------------------------------------------- вывод
def save_png(path, arr, mode=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im = Image.fromarray(arr, mode) if mode else Image.fromarray(arr)
    im.save(path, optimize=True)


def rel(path):
    return os.path.relpath(path, OUT).replace(os.sep, '/')


def save_sprite(spr, base):
    """Sprite → base.png (+ base.m.png, если есть цвет игрока). Возвращает запись атласа."""
    save_png(base + '.png', spr.rgba)
    rec = {'file': rel(base + '.png'), 'ox': int(spr.ox), 'oy': int(spr.oy),
           'w': int(spr.rgba.shape[1]), 'h': int(spr.rgba.shape[0])}
    if spr.mask.max() > 8:
        save_png(base + '.m.png', spr.mask, 'L')
        rec['mask'] = rel(base + '.m.png')
    return rec


# ---------------------------------------------------------------- здания
def _flag_prop(group):
    return {'props/special/common/garrison_flag': FLAG_SCALE}


def _roof_flag(parts):
    """Флаг цвета игрока на самой высокой точке здания — у акторов без точки 'garrisoned'."""
    best = None
    for p in parts:
        if p.is_decal:
            continue
        m = assets.mesh(p.mesh)
        if m is None:
            continue
        v = (np.c_[m['pos'], np.ones(len(m['pos']))] @ p.matrix.T)[:, :3]
        i = int(np.argmax(v[:, 2]))
        if best is None or v[i, 2] > best[2]:
            best = v[i]
    if best is None:
        return []
    M = np.diag([FLAG_SCALE, FLAG_SCALE, FLAG_SCALE, 1.0])
    M[:3, 3] = best - [0, 0, 0.3]
    return resolve('props/special/common/garrison_flag_celt.xml', matrix=M)


def _seat_flags(parts):
    """Точка гарнизона в 0 A.D. часто висит над крышей (там флаг поднимается над юнитами) — опускаем
    древко на крышу под ним; если под флагом ничего нет — переносим на самую высокую точку."""
    vs = []
    for p in parts:
        if p.is_decal or 'garrison_flag' in p.actor:
            continue
        m = assets.mesh(p.mesh)
        if m is not None:
            vs.append((np.c_[m['pos'], np.ones(len(m['pos']))] @ p.matrix.T)[:, :3])
    if not vs:
        return
    v = np.concatenate(vs)
    for p in parts:
        if 'garrison_flag' not in p.actor:
            continue
        b = p.matrix[:3, 3]
        near = v[np.hypot(v[:, 0] - b[0], v[:, 1] - b[1]) < 1.5]
        if len(near):
            top = near[:, 2].max()
            if b[2] > top - 0.2:
                p.matrix = p.matrix.copy()
                p.matrix[2, 3] = top - 0.3
        else:
            i = int(np.argmax(v[:, 2]))
            p.matrix = p.matrix.copy()
            p.matrix[:3, 3] = v[i] - [0, 0, 0.3]


# детали на земле, которые в игре не нужны (мощёные площади под зданием): подстроки пути актора / меша
SKIP_GROUND = ('plaza', 'pavement', 'paving', 'podium_floor', 'marble_floor')


def _skip_ground(actor, ap):
    return any(k in actor for k in SKIP_GROUND)


def _body_bounds(parts, yaw):
    """Габарит модели (без флага) после поворота на yaw: (lo, hi) в координатах модели."""
    from tools.render3d import Part
    pl0 = camera.placement(1.0, yaw)
    body = [Part(p.mesh, pl0 @ p.matrix, p.textures, p.material, p.actor, p.decal)
            for p in parts if 'garrison_flag' not in p.actor]
    # без низких деталей у земли (стога, телеги, мостовые): иначе центр основания уезжает к ним
    lo, hi = parts_bounds(body)
    return parts_bounds(body, z_min=max(lo[2], 0.0) + 0.12 * (hi[2] - max(lo[2], 0.0)))


def fill_scale(lo, hi, n, kind):
    """Масштаб модели, при котором она заполняет основание n×n (см. WFILL, OVER, FILL)."""
    dx, dy = max(hi[0] - lo[0], 1e-3), max(hi[1] - lo[1], 1e-3)
    return FILL.get(kind, 1.0) * min(WFILL * 2 * n / (dx + dy), OVER * n / max(dx, dy))


def building_items(r, group, kind, actor, pick=None, yaw=None):
    n = SIZE[kind]
    parts = resolve(actor, seed=0, pick=pick, prop_scale=_flag_prop(group), skip=_skip_ground)
    parts = [p for p in parts if not any(k in p.mesh for k in SKIP_GROUND)]
    if not any('garrison_flag' in p.actor for p in parts):
        parts += _roof_flag(parts)
    else:
        _seat_flags(parts)
    for p in parts:
        if 'garrison_flag' in p.actor:
            # светлое полотнище: цвет игрока читается одинаково у всех наборов (у германского и ханьского
            # флагов полотнище тёмное или текстуры нет)
            p.textures = dict(p.textures, baseTex=FLAG_TEX)
            p.tags = set(p.tags) | {'bright'}
    if yaw is None:
        yaw = YAW.get((group, kind), YAW.get(kind, 0.0))
    bb = _body_bounds(parts, yaw)
    place, s = fit_to_footprint(parts, n, yaw=yaw, bounds=bb, scale=fill_scale(*bb, n, kind))
    if kind in MAX_H:
        lo, hi = parts_bounds([p for p in parts if 'garrison_flag' not in p.actor])
        if (hi[2] - max(lo[2], 0)) * s > MAX_H[kind]:
            place, s = fit_to_footprint(parts, n, yaw=yaw, scale=MAX_H[kind] / (hi[2] - max(lo[2], 0)))
    items = Renderer.build_items(parts, place)
    for (a, x, y, ay, k) in EXTRAS.get(kind, ()):
        ep = resolve(a, seed=1)
        if not ep:
            continue
        pl = camera.placement(s * k, ay, center=(x, y))
        items += Renderer.build_items(ep, pl)
    items = clip_items(items, (-0.25, -0.25, n + 0.25, n + 0.25))
    return items, parts, place, s, yaw


def clip_items(items, box):
    """Выкидывает треугольники, центр которых вне прямоугольника box (клетки) — мусор лесов за основанием."""
    x0, y0, x1, y1 = box
    out = []
    for it in items:
        if it['kind'] != 'mesh':
            out.append(it)
            continue
        c = it['pos'].reshape(-1, 3, 3).mean(1)
        keep = (c[:, 0] >= x0) & (c[:, 0] <= x1) & (c[:, 1] >= y0) & (c[:, 1] <= y1)
        if not keep.any():
            continue
        it = dict(it)
        k3 = np.repeat(keep, 3)
        for key in ('pos', 'nrm', 'uv0', 'uv1'):
            it[key] = it[key][k3]
        out.append(it)
    return out


def foundation_items(n, s, place_center, yaw, ext_units):
    """Фундамент и леса 0 A.D. подходящего размера, в том же масштабе, что и здание."""
    k = int(max(1, min(9, round(ext_units / 4.0))))
    items_f, items_s = [], []
    for kk in (k, k - 1, k + 1, 4, 3):
        f = f'structures/fndn_{kk}x{kk}.xml'
        if actor_exists(f):
            pf = resolve(f, seed=0, prefer=frozenset({'base', 'idle'}))
            items_f = Renderer.build_items(pf, camera.placement(s, yaw, center=place_center))
            break
    for kk in (k, k - 1, k + 1, 5, 4, 3):
        f = f'props/structures/construction/scaf_{kk}x{kk}.xml'
        if actor_exists(f):
            ps = resolve(f, seed=0)
            items_s = Renderer.build_items(ps, camera.placement(s, yaw, center=place_center))
            break
    return items_f, items_s


def land_dir(items, n):
    """Сторона основания (dx, dy), к которой прижата «высокая» часть модели (дом дока — к берегу)."""
    P = np.concatenate([it['pos'] for it in items if it['kind'] == 'mesh'])
    z = P[:, 2]
    hi = P[z > np.percentile(z, 70)]
    c = hi[:, :2].mean(0) - (n / 2, n / 2)
    if abs(c[0]) >= abs(c[1]):
        return (1 if c[0] > 0 else -1, 0)
    return (0, 1 if c[1] > 0 else -1)


def render_building(r, group, kind, actor, base, stages=True, pick=None, yaw=None):
    n = SIZE[kind]
    items, parts, place, s, yaw = building_items(r, group, kind, actor, pick, yaw)
    clip = (-0.3, -0.3, n + 0.3, n + 0.3)
    spr = r.render(items, footprint=(n, n), decal_clip=clip)
    rec = save_sprite(spr, base)
    rec['size'] = n
    rec['actor'] = actor
    if kind == 'dock':
        rec['land'] = list(land_dir(items, n))
    if stages:
        lo, hi = parts_bounds(parts)
        ext = max(hi[0] - lo[0], hi[1] - lo[1])
        zs = np.concatenate([it['pos'][:, 2] for it in items if it['kind'] == 'mesh'])
        ztop = float(np.percentile(zs, 99.5))
        fi, si = foundation_items(n, s, (n / 2, n / 2), yaw, ext)
        box = (-0.1, -0.1, n + 0.1, n + 0.1)
        fi, si = clip_items(fi, box), clip_items(si, box)
        rec['stages'] = []
        for st, (frac, scaf) in enumerate(((0.0, False), (0.38, True), (0.72, True))):
            its = [dict(it) for it in fi]
            if frac > 0:
                for it in items:
                    it2 = dict(it)
                    if it2['kind'] == 'decal':
                        continue
                    it2['clipz'] = ztop * frac
                    its.append(it2)
            if scaf:
                for it in si:
                    it2 = dict(it)
                    it2['clipz'] = max(ztop * frac + 0.15, 0.3)
                    its.append(it2)
            if not its:
                continue
            sp = r.render(its, footprint=(n, n), decal_clip=clip)
            rec['stages'].append(save_sprite(sp, f'{base}.c{st}'))
    return rec


DOCK_YAWS = (0.0, 90.0, 180.0, 270.0)


def build_buildings(r, groups, atlas, stages=True):
    bl = atlas.setdefault('buildings', {})
    for g0 in [g for g in bl if g not in GROUPS]:
        del bl[g0]                      # наборы, на которые больше не ссылается ни одна цивилизация
    done = {}

    def one(g, kind, actor, pick, yaw, base, stg):
        key = (actor, kind, yaw, repr(pick), stg)
        if key in done:
            print(f'  = {g}/{kind} ← {actor} (как у {done[key]["file"]})')
            return done[key]
        t = time.time()
        rec = render_building(r, g, kind, actor, base, stg, pick, yaw)
        done[key] = rec
        print(f'  + {g}/{kind} ← {actor} {pick or ""} {yaw:g}°  {rec["w"]}×{rec["h"]}  {time.time() - t:.2f} с')
        return rec

    for g in groups:
        bl[g] = {}
        for kind in SIZE:
            if kind == 'farm':
                continue
            vs = building_variants(g, kind)
            if not vs:
                print(f'  - {g}/{kind}: нет актора')
                continue
            base = os.path.join(OUT, 'buildings', g, kind)
            yaw0 = YAW.get((g, kind), YAW.get(kind, 0.0))
            rec = dict(one(g, kind, vs[0][0], vs[0][1], yaw0, base, stages))
            if len(vs) > 1:
                # варианты модели (дома): в игре выбираются по клетке; стадии стройки — общие
                var = [rec] + [one(g, kind, a, pk, yaw0, f'{base}.v{i}', False) for i, (a, pk) in enumerate(vs[1:], 1)]
                rec['variants'] = [{k: v for k, v in x.items() if k not in ('stages', 'variants', 'dirs')} for x in var]
            if kind == 'dock':
                # док в 4 поворотах: в игре берётся тот, у которого «дом» смотрит на берег
                dirs = {}
                for i, yw in enumerate(DOCK_YAWS):
                    rr = rec if yw == yaw0 else one(g, kind, vs[0][0], vs[0][1], yw, f'{base}.r{i}', stages)
                    dirs['%d,%d' % tuple(rr['land'])] = {k: v for k, v in rr.items() if k != 'dirs'}
                rec['dirs'] = dirs
            bl[g][kind] = rec


# ---------------------------------------------------------------- стены и ворота
# Сегмент стены 1×1 собирается в игре из «рукавов» к соседям (8 направлений, от центра клетки до края)
# и столба в центре (если стена не прямая). Рукав — середина длинной стены 0 A.D., отсечённая плоскостями.
_W0 = 'structures/germans/wooden_wall_'
_WS = {  # набор стен → (длинная стена, башня, ворота)
    'caro': (_C + 'wall_long', _C + 'wall_tower', _C + 'wall_gate'),
    'anglo': (_A + 'wall_long', _A + 'wall_tower', _A + 'wall_gate'),
    'norse': (_N + 'wall_long', _N + 'wall_tower', _N + 'wall_gate'),
    'byz': (_B + 'wall_long', _B + 'wall_tower', _B + 'wall_gate'),
    'byz_s': (_B + 's_wall_long', _B + 'wall_tower_sq', _B + 's_wall_gate'),
    'pers': ('structures/achaemenids/wall_long', 'structures/achaemenids/wall_tower',
             'structures/achaemenids/wall_gate'),
    'han': ('structures/han/wall_long', 'structures/han/wall_tower', 'structures/han/wall_gate'),
    'wood': (_W0 + 'long', _W0 + 'tower', _W0 + 'gate'),
}
# группа → {каменная стена, частокол} → набор
WALL_SETS = {
    'caro': {'stone': 'caro', 'palisade': 'wood'},
    'teut': {'stone': 'byz_s', 'palisade': 'wood'},
    'anglo': {'stone': 'caro', 'palisade': 'anglo'},
    'celt': {'stone': 'caro', 'palisade': 'anglo'},
    'norse': {'stone': 'anglo', 'palisade': 'norse'},
    'rus': {'stone': 'anglo', 'palisade': 'norse'},
    'byz': {'stone': 'byz', 'palisade': 'wood'},
    'hisp': {'stone': 'byz_s', 'palisade': 'wood'},
    'umay': {'stone': 'pers', 'palisade': 'wood'},
    'han': {'stone': 'han', 'palisade': 'wood'},
}
WALL_UPT = 9.4               # единиц 0 A.D. на клетку (длинная стена ≈ 36.6 ед. = 4 клетки ворот)
POST_W = {'stone': 0.72, 'palisade': 0.62}
DIRS8 = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]


def render_walls(r, st, wkind, base):
    long_a, tower_a, gate_a = (_xml(a) for a in _WS[st])
    return _render_walls(r, long_a, tower_a, gate_a, wkind, base)


def _render_walls(r, long_a, tower_a, gate_a, wkind, base):
    s = 1.0 / WALL_UPT
    rec = {'arms': {}}
    parts = resolve(long_a, seed=0)
    for (dx, dy) in DIRS8:
        yaw = math.degrees(math.atan2(dy, dx))
        n = math.hypot(dx, dy)
        L = 0.5 * n
        place = camera.placement(s, yaw, center=(0.5, 0.5))
        items = Renderer.build_items(parts, place)
        for it in items:
            it['keep'] = (0.5, 0.5, dx / n, dy / n, -0.03, L + 0.02)
        spr = r.render(items, footprint=(1, 1))
        rec['arms'][f'{dx},{dy}'] = save_sprite(spr, f'{base}_arm{DIRS8.index((dx, dy))}')
    tp = [p for p in resolve(tower_a, seed=0) if 'garrison_flag' not in p.actor]
    lo, hi = parts_bounds(tp)
    sp = POST_W[wkind] / max(hi[0] - lo[0], hi[1] - lo[1])
    place = camera.placement(sp, 0.0, center=(0.5, 0.5), model_center=((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2))
    rec['post'] = save_sprite(r.render(Renderer.build_items(tp, place), footprint=(1, 1)), f'{base}_post')
    # ворота: 4 клетки вдоль x (h) или y (v), закрытые (0) и открытые (1)
    gp = resolve(gate_a, seed=0)
    lo, hi = parts_bounds(gp)
    # масштаб стен (в 0 A.D. ворота и стены одного набора соразмерны), но длина — 3.6..4.3 клетки
    ln = max(hi[0] - lo[0], 1e-3)
    sg = min(max(s, 3.6 / ln), 4.3 / ln)
    zt = hi[2] * sg
    rec['gate'] = {}
    for horiz in (True, False):
        yaw = 0.0 if horiz else 90.0
        c = (2.0, 0.5) if horiz else (0.5, 2.0)
        fp = (4, 1) if horiz else (1, 4)
        place = camera.placement(sg, yaw, center=c, model_center=((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2))
        for opened in (False, True):
            pp = gp
            if opened and any('door' in p.mesh for p in gp):
                pp = [p for p in gp if 'door' not in p.mesh and 'gate_roof' not in p.actor]
            items = Renderer.build_items(pp, place)
            if opened and pp is gp:
                # створки — посередине проёма: вырезаем их коробкой
                a0, a1 = GATE_CUT
                if horiz:
                    cut = ((a0, -0.5, -1.0), (a1, 1.5, zt * GATE_CUT_H))
                else:
                    cut = ((-0.5, a0, -1.0), (1.5, a1, zt * GATE_CUT_H))
                for it in items:
                    it['cut'] = cut
            spr = r.render(items, footprint=fp)
            key = f'{"h" if horiz else "v"}{int(opened)}'
            spr_rec = save_sprite(spr, f'{base}_gate_{key}')
            spr_rec['w_tiles'], spr_rec['h_tiles'] = fp
            rec['gate'][key] = spr_rec
    # стройка: фундамент 1×1 и леса 1×1 (в игре — под и поверх растущего сегмента)
    zw = parts_bounds(parts)[1][2] * s
    fa = 'structures/fndn_1x1pal.xml' if wkind == 'palisade' else 'structures/fndn_1x1.xml'
    fp_ = resolve(fa, seed=0, prefer=frozenset({'base', 'idle'}))
    lo, hi = parts_bounds(fp_, z_min=-1)
    sf = 1.0 / max(hi[0] - lo[0], hi[1] - lo[1], 1e-3)
    pl = camera.placement(sf, 0.0, center=(0.5, 0.5), model_center=((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2))
    rec['fndn'] = save_sprite(r.render(Renderer.build_items(fp_, pl), footprint=(1, 1)), f'{base}_fndn')
    sc_ = resolve('props/structures/construction/scaf_3x3_tower.xml', seed=0)
    lo, hi = parts_bounds(sc_)
    ss_ = 1.05 / max(hi[0] - lo[0], hi[1] - lo[1], 1e-3)
    ss_z = min(ss_, (zw + 0.15) / max(hi[2], 1e-3))
    pl = camera.placement(ss_, 0.0, center=(0.5, 0.5), model_center=((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2))
    pl = pl @ np.diag([1.0, 1.0, ss_z / ss_, 1.0])
    rec['scaf'] = save_sprite(r.render(Renderer.build_items(sc_, pl), footprint=(1, 1)), f'{base}_scaf')
    rec['actors'] = [long_a, tower_a, gate_a]
    return rec


GATE_CUT = (1.55, 2.45)
GATE_CUT_H = 0.5


def build_walls(r, groups, atlas):
    wl = atlas.setdefault('walls', {})
    for g0 in [g for g in wl if g not in GROUPS]:
        del wl[g0]
    done = {}
    for g in groups:
        wl[g] = {}
        for wkind, st in WALL_SETS[g].items():
            if (wkind, st) not in done:
                t = time.time()
                done[(wkind, st)] = render_walls(r, st, wkind, os.path.join(OUT, 'walls', f'{wkind}_{st}'))
                print(f'  + стены {wkind}/{st}  {time.time() - t:.2f} с')
            wl[g][wkind] = done[(wkind, st)]


# ---------------------------------------------------------------- контактные листы (проверка глазами)
def contact_sheet(atlas, group, out_png, color=(45, 115, 235), stages=True, width=2400):
    from PIL import ImageDraw
    recs = atlas['buildings'].get(group, {})
    tiles = []
    for kind, rec in recs.items():
        extra = list(rec.get('variants', [])[1:]) + [v for k, v in sorted(rec.get('dirs', {}).items())]
        for r0 in [rec] + extra + (rec.get('stages', []) if stages else []):
            im = Image.open(os.path.join(OUT, r0['file'])).convert('RGBA')
            if r0.get('mask'):
                m = np.asarray(Image.open(os.path.join(OUT, r0['mask'])), np.float32)[..., None] / 255
                a = np.asarray(im, np.float32)
                f = 1 - m * (1 - np.array(color, np.float32) / 255)
                a[..., :3] *= f
                im = Image.fromarray(a.clip(0, 255).astype(np.uint8))
            n = rec['size']
            W, H = im.size[0] + 30, im.size[1] + 30
            bg = Image.new('RGBA', (W, H), (98, 140, 62, 255))
            d = ImageDraw.Draw(bg)
            ox, oy = r0['ox'] + 15, r0['oy'] + 15
            for i in range(-10, 14):
                for j in range(-10, 14):
                    x, y = ox + (i - j) * 32, oy + (i + j) * 16
                    d.polygon([(x, y), (x + 32, y + 16), (x, y + 32), (x - 32, y + 16)],
                              fill=(90, 130, 58) if (i + j) % 2 else (100, 142, 64))
            d.polygon([(ox, oy), (ox + n * 32, oy + n * 16), (ox, oy + n * 32), (ox - n * 32, oy + n * 16)],
                      outline=(255, 255, 0))
            bg.alpha_composite(im, (15, 15))
            # человечек 24 px для масштаба
            d = ImageDraw.Draw(bg)
            fx, fy = ox - n * 32 - 6, oy + n * 16 + 8
            d.rectangle((fx - 3, fy - 18, fx + 3, fy - 6), fill=color)
            d.ellipse((fx - 3, fy - 24, fx + 3, fy - 18), fill=(232, 190, 145))
            d.rectangle((fx - 3, fy - 6, fx + 3, fy), fill=(60, 50, 40))
            tiles.append(bg)
    if not tiles:
        return
    rows, row, x = [], [], 0
    for t in tiles:
        if x + t.size[0] > width and row:
            rows.append(row)
            row, x = [], 0
        row.append(t)
        x += t.size[0]
    rows.append(row)
    W = max(sum(t.size[0] for t in rw) for rw in rows)
    H = sum(max(t.size[1] for t in rw) for rw in rows)
    sheet = Image.new('RGBA', (W, H), (30, 30, 30, 255))
    y = 0
    for rw in rows:
        x = 0
        for t in rw:
            sheet.paste(t, (x, y))
            x += t.size[0]
        y += max(t.size[1] for t in rw)
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    sheet.save(out_png)
    print('лист', out_png)


def prune(atlas):
    """Удаляет из buildings/ и walls/ файлы, на которые атлас больше не ссылается (старые наборы)."""
    used = set()

    def walk(x):
        if isinstance(x, dict):
            for k, v in x.items():
                if k in ('file', 'mask') and isinstance(v, str):
                    used.add(v)
                else:
                    walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(atlas.get('buildings', {}))
    walk(atlas.get('walls', {}))
    n = 0
    for sub in ('buildings', 'walls'):
        root = os.path.join(OUT, sub)
        for dp, dns, fns in os.walk(root, topdown=False):
            for fn in fns:
                if fn.endswith('.png') and rel(os.path.join(dp, fn)) not in used:
                    os.remove(os.path.join(dp, fn))
                    n += 1
            if dp != root and not os.listdir(dp):
                os.rmdir(dp)
    if n:
        print(f'удалено устаревших файлов: {n}')


def load_atlas():
    p = os.path.join(OUT, 'atlas.json')
    if os.path.exists(p):
        with open(p) as f:
            return json.load(f)
    return {}


def save_atlas(atlas):
    atlas['version'] = 1
    atlas['civ_groups'] = CIV_GROUP
    atlas['license'] = ('Derived from 0 A.D. (c) Wildfire Games and Millennium A.D. (c) The Council of Modders, '
                        'Fallen Empire Studio, Scion Development; CC BY-SA 3.0; see CREDITS.md')
    os.makedirs(OUT, exist_ok=True)          # assets/gen/LICENSE.md хранится в репозитории (атрибуция)
    with open(os.path.join(OUT, 'atlas.json'), 'w') as f:
        json.dump(atlas, f, ensure_ascii=False, indent=1, sort_keys=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--only', default='buildings,walls,nature,terrain,cliffs')
    ap.add_argument('--groups', default=','.join(GROUPS))
    ap.add_argument('--ss', type=int, default=3, help='сверхвыборка')
    ap.add_argument('--no-stages', action='store_true')
    ap.add_argument('--sheets', default='', help='папка для контактных листов')
    a = ap.parse_args()
    only = set(a.only.split(','))
    groups = [g for g in a.groups.split(',') if g]
    if not os.path.isdir(assets.ART):
        sys.exit(f'нет сырых ассетов: {assets.ART} (запустите tools/fetch_0ad.py)')
    t0 = time.time()
    r = Renderer(ss=a.ss)
    atlas = load_atlas()
    if 'buildings' in only:
        build_buildings(r, groups, atlas, not a.no_stages)
        save_atlas(atlas)
    if 'walls' in only:
        build_walls(r, groups, atlas)
        save_atlas(atlas)
    if ('buildings' in only or 'walls' in only) and set(groups) == set(GROUPS):
        prune(atlas)
    if 'nature' in only:
        from tools import build_nature
        build_nature.build(r, atlas, OUT)
        save_atlas(atlas)
    if 'terrain' in only:
        from tools import build_nature
        build_nature.build_terrain(atlas, OUT)
        save_atlas(atlas)
    if 'cliffs' in only or 'nature' in only:
        from tools import build_nature
        build_nature.build_cliffs(r, atlas, OUT)
        save_atlas(atlas)
    if a.sheets:
        for g in groups:
            contact_sheet(atlas, g, os.path.join(a.sheets, f'bld_{g}.png'))
        if 'nature' in atlas:
            from tools import build_nature
            build_nature.contact_sheet(atlas, OUT, os.path.join(a.sheets, 'nature.png'))
    print(f'готово за {time.time() - t0:.1f} с')


if __name__ == '__main__':
    main()
