"""Природа и террейн из 0 A.D. для tools/build_sprites.py: деревья, кусты, шахты, животные, плитки земли.

Все спрайты природы — «на клетку»: (ox, oy) — пиксель верхнего угла ромба клетки, как у зданий размером 1.
"""
import os

import numpy as np
from PIL import Image

from tools.render3d import Renderer, resolve, parts_bounds, camera, assets
from tools.render3d.actor import actor_exists

# масштаб природы: единиц 0 A.D. на клетку — как у зданий (центр 0 A.D. ≈ 28–32 ед. → 4 клетки)
UNITS_PER_TILE = 7.5
# животные — в масштабе наших юнитов (S_ANIMAL в tools/build_units.py, пропорции DE)
ANIMAL_S = 0.12

TREES = {
    # вид: (актор, сколько вариантов, предел высоты в клетках высоты, множитель масштаба)
    # лиственные — крона шире (DE: 1.2–1.5 клетки, лес — сплошной полог; квант 14)
    'oak': ('flora/trees/oak_new.xml', 4, 2.6, 1.15),
    'beech': ('flora/trees/european_beech.xml', 3, 2.6, 1.15),
    'deci': ('flora/trees/temperate_forest_biome_tree.xml', 3, 2.5, 1.12),
    'birch': ('flora/trees/euro_birch_tree.xml', 3, 2.5, 1.1),
    'pine': ('flora/trees/pine.xml', 4, 2.6, 1.0),
    'fir': ('flora/trees/fir_tree.xml', 4, 2.6, 1.0),
    'poplar': ('flora/trees/poplar.xml', 2, 2.6, 1.0),
}
NODES = {
    'berries': [('props/flora/berry_bush.xml', s) for s in range(3)],
    'gold': [('geology/metal_temperate_round.xml', 0), ('geology/metal_temperate_small.xml', 0),
             ('geology/metal_temperate_square.xml', 0), ('geology/metal_temperate_round.xml', 1)],
    'stone': [('geology/stonemine_temperate_quarry.xml', 0), ('geology/stonemine_temperate_small.xml', 0),
              ('geology/stonemine_temperate_quarry_01.xml', 0), ('geology/stonemine_temperate_quarry_02.xml', 0)],
}
NODE_FILL = {'berries': 0.95, 'gold': 1.05, 'stone': 1.05}
TREE_WMAX = 1.75          # ширина кроны, клеток
GOLD_TINT = (1.2, 1.04, 0.6, 1.0)
ANIMALS = {'sheep': ['fauna/sheep1.xml', 'fauna/sheep2.xml'], 'deer': ['fauna/deer.xml'], 'boar': ['fauna/boar.xml']}
# направление «вперёд» модели животного в её координатах (угол, градусы); подобрано по рендеру
ANIMAL_FWD = -90.0


def _rel(out, path):
    return os.path.relpath(path, out).replace(os.sep, '/')


def _save(out, spr, base):
    from tools.build_sprites import save_sprite
    return save_sprite(spr, base)


def _sig(parts):
    return tuple(sorted((p.mesh, p.textures.get('baseTex') or '') for p in parts))


def trunk_base(parts):
    """Точка модели (x, y) у основания ствола: центр самых нижних вершин (у ели ствол не в начале
    координат модели — дерево стояло на 9–11 px левее клетки, 09 · №28)."""
    vs = []
    for p in parts:
        if p.is_decal:
            continue
        m = p.geom if p.geom is not None else assets.mesh(p.mesh)
        if m is None:
            continue
        v = (np.c_[m['pos'], np.ones(len(m['pos']))] @ p.matrix.T)[:, :3]
        vs.append(v)
    if not vs:
        return (0.0, 0.0)
    v = np.concatenate(vs)
    z0, z1 = v[:, 2].min(), v[:, 2].max()
    low = v[v[:, 2] <= z0 + max(0.25, 0.015 * (z1 - z0))]       # тонкий слой у земли — сам ствол, не ветви
    if len(low) < 3:
        return (0.0, 0.0)
    return (float(low[:, 0].mean()), float(low[:, 1].mean()))


def render_tree(r, actor, seed, hmax, k):
    parts = resolve(actor, seed=seed, prefer=frozenset({'alive', 'idle', 'base'}))
    lo, hi = parts_bounds(parts)
    s = k / UNITS_PER_TILE
    if (hi[2] - max(lo[2], 0)) * s > hmax:
        s = hmax / (hi[2] - max(lo[2], 0))
    wide = max(hi[0] - lo[0], hi[1] - lo[1], 1e-3)
    s = min(s, TREE_WMAX / wide)
    place = camera.placement(s, 0.0, center=(0.5, 0.5), model_center=trunk_base(parts))
    items = Renderer.build_items(parts, place)
    spr = r.render(items, footprint=(1, 1), decal_clip=(-0.15, -0.15, 1.15, 1.15))
    return parts, spr


def build(r, atlas, out, only=None):
    """only — множество групп ('trees', 'nodes', 'animals'); None — всё."""
    if only:
        nat = atlas.setdefault('nature', {})
    else:
        nat = atlas['nature'] = {}
    # ---- деревья
    trees = nat.setdefault('trees', {})
    for sp, (actor, n, hmax, k) in TREES.items():
        if only and 'trees' not in only:
            break
        if not actor_exists(actor):
            continue
        seen, recs = set(), []
        for seed in range(40):
            parts = resolve(actor, seed=seed)
            sig = _sig(parts)
            if sig in seen or not parts:
                continue
            seen.add(sig)
            _, spr = render_tree(r, actor, seed, hmax, k)
            recs.append(_save(out, spr, os.path.join(out, 'nature', f'tree_{sp}_{len(recs)}')))
            if len(recs) >= n:
                break
        trees[sp] = recs
        print(f'  + деревья {sp}: {len(recs)}')
    # ---- ресурсы
    for kind, lst in NODES.items():
        if only and 'nodes' not in only:
            break
        recs = []
        for i, (actor, seed) in enumerate(lst):
            if not actor_exists(actor):
                continue
            parts = resolve(actor, seed=seed, skip=lambda a, ap: 'sparkle' in a)
            lo, hi = parts_bounds(parts)
            ext = max(hi[0] - lo[0], hi[1] - lo[1], 1e-3)
            s = NODE_FILL[kind] / ext
            if kind == 'berries':
                s = min(s, 1.4 / UNITS_PER_TILE * 1.6)
            mc = ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2)
            place = camera.placement(s, 20.0 * i, center=(0.5, 0.5), model_center=mc)
            items = Renderer.build_items(parts, place, tint_fn=(lambda p: GOLD_TINT) if kind == 'gold' else None)
            spr = r.render(items, footprint=(1, 1), decal_clip=(-0.1, -0.1, 1.1, 1.1))
            recs.append(_save(out, spr, os.path.join(out, 'nature', f'{kind}_{len(recs)}')))
        nat[kind] = recs
        print(f'  + {kind}: {len(recs)}')
    # ---- животные: 8 направлений (индекс d: угол d·45° в координатах мира, 0 — вдоль +X)
    an = nat.setdefault('animals', {})
    for kind, actors in ANIMALS.items():
        if only and 'animals' not in only:
            break
        variants = []
        for vi, actor in enumerate(actors):
            if not actor_exists(actor):
                continue
            parts = resolve(actor, seed=vi, prefer=frozenset({'alive', 'idle', 'normal', 'base'}),
                            skip=lambda a, ap: 'blood' in a)
            dirs = []
            for d in range(8):
                yaw = d * 45.0 - ANIMAL_FWD
                place = camera.placement(ANIMAL_S, yaw, center=(0.5, 0.5))
                items = Renderer.build_items(parts, place)
                spr = r.render(items, footprint=(1, 1), look=None, shadow_scale=0.9)
                dirs.append(_save(out, spr, os.path.join(out, 'nature', f'{kind}_{vi}_d{d}')))
            variants.append(dirs)
        an[kind] = variants
        print(f'  + {kind}: {len(variants)}×8')
    build_farm(r, atlas, out)


# обрывы (AoE2: отдельные объекты-скалы вдоль линии): скальные глыбы 0 A.D., шире клетки — соседние
# куски перекрываются в сплошную стену; тёплый серо-бурый тон как у утёсов DE
CLIFFS = [('geology/highland1.xml', 0), ('geology/highland2.xml', 0), ('geology/highland_d.xml', 0),
          ('geology/highland_e.xml', 0)]
CLIFF_YAWS = (0.0, 120.0, 240.0)
CLIFF_W = 1.6             # ширина глыбы по земле, клеток
CLIFF_H = 1.4             # предел высоты, клеток высоты (ZK ≈ 39 px)
CLIFF_TINT = (0.8, 0.76, 0.72, 1.0)


def build_cliffs(r, atlas, out):
    recs = []
    for actor, seed in CLIFFS:
        if not actor_exists(actor):
            continue
        parts = resolve(actor, seed=seed)
        lo, hi = parts_bounds(parts)
        for yaw in CLIFF_YAWS:
            ext = max(hi[0] - lo[0], hi[1] - lo[1], 1e-3)
            s = CLIFF_W / ext
            ht = max(hi[2] - max(lo[2], 0), 1e-3)
            if ht * s > CLIFF_H:
                s = CLIFF_H / ht
            mc = ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2)
            place = camera.placement(s, yaw, center=(0.5, 0.5), model_center=mc)
            items = Renderer.build_items(parts, place, tint_fn=lambda p: CLIFF_TINT)
            spr = r.render(items, footprint=(1, 1))
            recs.append(_save(out, spr, os.path.join(out, 'nature', f'cliff_{len(recs)}')))
    atlas.setdefault('nature', {})['cliffs'] = recs
    print(f'  + обрывы: {len(recs)}')


def build_farm(r, atlas, out):
    """Поле 3×3: уровни 0..4 — сколько осталось урожая (колосья срезаются по высоте), 0 — голая пашня."""
    parts = resolve('structures/plot_field_temp.xml', seed=0)
    from tools.render3d import fit_to_footprint
    place, s = fit_to_footprint(parts, 3, 1.0)
    items = Renderer.build_items(parts, place)
    zs = np.concatenate([it['pos'][:, 2] for it in items if it['kind'] == 'mesh'])
    ztop = float(np.percentile(zs, 99))
    recs = []
    for lv in range(5):
        its = []
        for it in items:
            it = dict(it)
            it['clipz'] = max(0.012, ztop * lv / 4)
            its.append(it)
        spr = r.render(its, footprint=(3, 3), decal_clip=(0, 0, 3, 3), shadow_scale=0.6)
        recs.append(_save(out, spr, os.path.join(out, 'nature', f'farm_{lv}')))
    atlas.setdefault('nature', {})['farm'] = recs
    print('  + поле: 5 уровней')


# ------------------------------------------------------------------ террейн
# тип: (текстура под art/textures/terrain/types/, период в клетках P) — плитка в изометрии P·64 × P·32 px
TERRAIN = {
    'grass': ('temp_grass.png', 4),
    'grass2': ('temp_grass_d.png', 4),
    'grass3': ('temp_grass_c.png', 4),
    'dirt': ('temperate/mud_01.png', 4),
    'forest': ('temperate/forestfloor_003.png', 4),
    'sand': ('temp_dirt_a.png', 4),
    # типы земли для смешения по маскам (game/terrain.py GROUNDS)
    'dirt2': ('medit_dirt_a.dds', 4),               # светлая сухая земля (AoE2 «Dirt 2»)
    'dirt3': ('temperate/grass_dirt_03.png', 4),    # земля с травой (AoE2 «Dirt 3»)
    'pine': ('temp_forestfloor_pine.png', 4),       # хвойная подстилка
    'beach': ('sand_d.dds', 4),                     # пляж
    'shallow': ('sand_wet_a.dds', 4),               # дно мелководья (бирюза поверх — в игре)
    'rocky': ('temperate/rocks_dirt_01.png', 4),    # каменистая земля у обрывов
}
# средний цвет (замер скринов DE), к которому приводится текстура без ручных множителей TERRAIN_GAIN
TERRAIN_TARGET = {
    'dirt2': (208, 176, 110), 'dirt3': (160, 148, 80), 'pine': (118, 104, 58), 'beach': (218, 196, 140),
    'shallow': (196, 180, 128), 'rocky': (150, 134, 100),
}
# Цвет земли AoE II DE теплее и светлее зелёных текстур 0 A.D.: трава DE ≈ (163, 157, 89), дорожная земля
# ≈ (190, 158, 78), лесная подстилка ≈ (103, 106, 54) (замер скринов shots/ref/gfx). Множители по каналам
# переводят средний цвет каждой текстуры к этим значениям, не трогая рисунок.
TERRAIN_GAIN = {
    'grass': (1.9, 1.3, 1.95), 'grass2': (1.98, 1.36, 2.05), 'grass3': (1.78, 1.2, 1.9),
    'dirt': (1.6, 1.48, 1.08), 'forest': (1.1, 1.24, 0.75), 'sand': (1.12, 1.08, 0.92),
}


def iso_tile(tex, P):
    """Квадратная текстура (повтор на P×P клеток) → бесшовная изометрическая плитка (P·64 × P·32).

    Пиксель плитки (x, y) → клетки (gx, gy) = обратная проекция; текстура — выборка с билинейной фильтрацией."""
    from PIL import ImageFilter
    W, H = P * 64, P * 32
    th, tw = tex.shape[:2]
    # сначала уменьшаем текстуру до ~ 64·√2/2 текселей на клетку (≈ разрешению ромба), чтобы не было муара
    target = int(P * 48)
    img = Image.fromarray(tex[..., :3])
    if tw > target:
        img = img.resize((target, target), Image.LANCZOS)
    img = img.filter(ImageFilter.UnsharpMask(radius=1.2, percent=40, threshold=2))
    t = np.asarray(img, np.float32)
    n = t.shape[0]
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32) + 0.5
    gx = (xs / 32 + ys / 16) / 2
    gy = (ys / 16 - xs / 32) / 2
    u = (gx / P * n) % n
    v = (gy / P * n) % n
    x0 = np.floor(u).astype(int)
    y0 = np.floor(v).astype(int)
    fx = (u - x0)[..., None]
    fy = (v - y0)[..., None]
    x1 = (x0 + 1) % n
    y1 = (y0 + 1) % n
    x0 %= n
    y0 %= n
    c = (t[y0, x0] * (1 - fx) * (1 - fy) + t[y0, x1] * fx * (1 - fy) + t[y1, x0] * (1 - fx) * fy
         + t[y1, x1] * fx * fy)
    return np.clip(c, 0, 255).astype(np.uint8)


def build_terrain(atlas, out):
    ter = atlas['terrain'] = {}
    for name, (rel, P) in TERRAIN.items():
        path = assets.art('textures', 'terrain', 'types', rel)
        tex = assets.texture(path)
        if tex is None:
            print('  ! нет текстуры', rel)
            continue
        tile = iso_tile(tex, P)
        if name in TERRAIN_TARGET:
            m = tile.reshape(-1, 3).astype(np.float32).mean(0)
            g = np.array(TERRAIN_TARGET[name], np.float32) / np.maximum(m, 1.0)
        else:
            g = np.array(TERRAIN_GAIN.get(name, (1, 1, 1)), np.float32)
        tile = np.clip(tile.astype(np.float32) * g, 0, 255).astype(np.uint8)
        p = os.path.join(out, 'terrain', f'{name}.png')
        os.makedirs(os.path.dirname(p), exist_ok=True)
        Image.fromarray(tile).save(p, optimize=True)
        ter[name] = {'file': _rel(out, p), 'period': P, 'mean': [int(x) for x in tile.reshape(-1, 3).mean(0)]}
        print(f'  + террейн {name} ← {rel}')


# ------------------------------------------------------------------ контактный лист
def contact_sheet(atlas, out, png):
    from PIL import ImageDraw
    nat = atlas.get('nature', {})
    recs = []
    for sp, lst in nat.get('trees', {}).items():
        recs += lst
    for k in ('berries', 'gold', 'stone'):
        recs += nat.get(k, [])
    for k, vs in nat.get('animals', {}).items():
        for dirs in vs:
            recs += dirs
    tiles = []
    for rec in recs:
        im = Image.open(os.path.join(out, rec['file'])).convert('RGBA')
        W, H = max(im.size[0], 64) + 24, im.size[1] + 24
        bg = Image.new('RGBA', (W, H), (98, 140, 62, 255))
        d = ImageDraw.Draw(bg)
        ox, oy = rec['ox'] + 12, rec['oy'] + 12
        d.polygon([(ox, oy), (ox + 32, oy + 16), (ox, oy + 32), (ox - 32, oy + 16)], outline=(255, 255, 0))
        bg.alpha_composite(im, (12, 12))
        tiles.append(bg)
    if not tiles:
        return
    rows, row, x = [], [], 0
    for t in tiles:
        if x + t.size[0] > 1900 and row:
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
    os.makedirs(os.path.dirname(png), exist_ok=True)
    sheet.save(png)
    print('лист', png)
