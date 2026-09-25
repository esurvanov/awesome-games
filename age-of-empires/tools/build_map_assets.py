#!/usr/bin/env python3
"""Графика пейзажей карт (game/themes.py) из 0 A.D. → assets/gen/maps/ + индекс assets/gen/maps/maps.json.

Пишет только в assets/gen/maps/ (атлас assets/gen/atlas.json и assets/gen/nature не трогаются):
  terrain  — плитки земли пейзажей (пустыня, степь, снега, тропики, осень), как build_nature.build_terrain;
  trees    — породы пейзажей (пальмы, акации, заснеженные ели, осенние дубы/клёны…), как render_tree;
  animals  — волк, 8 направлений (как животные build_nature);
  relic    — реликвия: золотой ларец-реликварий (свой, процедурно, PIL).

  .venv/bin/python tools/build_map_assets.py [--only terrain,trees,animals,relic] [--sheet out.png]

Сырые ассеты — tools/fetch_0ad.py (пальмы, акации, текстуры снега/пустыни/тропиков добавлены в выборку).
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, REPO)

from tools.render3d import Renderer, resolve, camera, assets  # noqa: E402
from tools.render3d.actor import actor_exists  # noqa: E402
from tools import build_nature as bn  # noqa: E402
from tools.build_sprites import save_sprite  # noqa: E402

GEN = os.path.join(REPO, 'assets', 'gen')
OUT = os.path.join(GEN, 'maps')
INDEX = os.path.join(OUT, 'maps.json')

# порода: (актор, вариантов, предел высоты в клетках высоты, множитель масштаба)
TREES = {
    'palm': ('flora/trees/palm_date_new.xml', 3, 2.9, 1.1),
    'palm_tall': ('flora/trees/palm_date_new_3.xml', 2, 3.1, 1.1),
    'palm_tropical': ('flora/trees/palm_tropical.xml', 3, 2.9, 1.1),
    'tropic': ('flora/trees/tree_tropic.xml', 3, 2.6, 1.15),
    'acacia': ('flora/trees/acacia.xml', 3, 2.3, 1.0),
    'baobab': ('flora/trees/baobab_new.xml', 2, 2.7, 1.0),
    'snow_pine': ('flora/trees/snow_pine2.xml', 3, 2.6, 1.0),
    'fir_winter': ('flora/trees/fir_tree_winter.xml', 3, 2.6, 1.0),
    'winter_tree': ('flora/trees/temperate_forest_biome_tree_winter.xml', 2, 2.5, 1.1),
    'oak_aut': ('flora/trees/oak_new_aut.xml', 4, 2.6, 1.15),
    'maple_aut': ('flora/trees/maple_autumn.xml', 3, 2.6, 1.15),
    'beech_aut': ('flora/trees/european_beech_aut.xml', 3, 2.6, 1.15),
    'poplar_aut': ('flora/trees/poplar_autumn.xml', 2, 2.6, 1.0),
}

T = 'textures/terrain/types/'
# плитка: (текстура под art/textures/terrain/types/, средний цвет-цель (как у DE) или None — без поправки)
TERRAIN = {
    # пустыня: светлый песок, дюны, сухая земля
    'desert_sand': ('sand_sahara.dds', (214, 180, 120)),
    'desert_sand2': ('desert_sahara.dds', (206, 170, 110)),
    'desert_dunes': ('sand_dunes.dds', (224, 192, 134)),
    'desert_dirt': ('medit_dirt_dry.dds', (200, 150, 92)),
    'desert_dirt2': ('dirty_sand.dds', (212, 176, 118)),
    'desert_scrub': ('sand_scrub_50.dds', (196, 170, 110)),
    'desert_forest': ('sand_scrub_100.dds', (150, 132, 80)),
    'desert_rocky': ('dirt_rocks.dds', (170, 140, 100)),
    # степь: сухая жёлтая трава, пыльная земля
    'steppe_grass': ('new_savanna_grass_a.dds', (178, 160, 88)),
    'steppe_grass2': ('new_savanna_grass_b.dds', (168, 150, 80)),
    'steppe_grass3': ('grass_field_dry.png', (188, 166, 96)),
    'steppe_dirt': ('new_savanna_dirt_c.dds', (196, 154, 94)),
    'steppe_dirt2': ('new_savanna_dirt_d.dds', (206, 170, 112)),
    'steppe_forest': ('savanna_forestfloor_a.png', (130, 112, 64)),
    # снега
    'snow': ('alpine_snow_a.dds', (226, 230, 238)),
    'snow2': ('polar_snow_a.dds', (214, 220, 232)),
    'snow_grass': ('snow grass 75.dds', (186, 192, 186)),
    'snow_dirt': ('alpine_dirt_snow.dds', (170, 164, 156)),
    'snow_forest': ('alpine_forrestfloor_snow.dds', (178, 184, 186)),
    'snow_rocky': ('alpine_snow_rocky.dds', (160, 160, 164)),
    # тропики: сочная трава, красная земля, светлый пляж
    'tropic_grass': ('tropic_grass_a.png', (112, 150, 60)),
    'tropic_grass2': ('tropic_grass_b.png', (100, 140, 52)),
    'tropic_grass3': ('tropic_grass_plants.png', (96, 132, 50)),
    'tropic_dirt': ('tropic_dirt_a.png', (176, 124, 76)),
    'tropic_dirt2': ('tropic_dirt_b.png', (186, 140, 90)),
    'tropic_forest': ('tropic_forestfloor_a.png', (84, 96, 44)),
    'tropic_beach': ('tropic_beach_dry.png', (226, 206, 150)),
    # осень: трава с опавшей листвой
    'autumn_grass': ('temp_grass_aut.png', (170, 150, 70)),
    'autumn_grass2': ('temp_grass_b_aut.png', (160, 136, 62)),
    'autumn_grass3': ('temp_grass_c_aut.png', (178, 150, 76)),
    'autumn_forest': ('temp_forestfloor_autumn.dds', (140, 100, 52)),
}
P = 4           # период плитки, клеток
# контраст рисунка плитки (1 — как в текстуре): рябь дюн 0 A.D. сильнее, чем ровный песок DE
CONTRAST = {'desert_sand': 0.45, 'desert_sand2': 0.6, 'desert_dunes': 0.45, 'snow': 0.8, 'snow2': 0.8}
# листва пород под зелень DE (тон 90–100°, не кислотная): (целевой тон, доля сдвига, насыщенность ×, яркость ×)
LEAF_TONE = {'palm': (96, 0.6, 0.85, 0.82), 'palm_tall': (96, 0.6, 0.85, 0.82),
             'palm_tropical': (100, 0.5, 0.9, 0.85), 'tropic': (100, 0.5, 0.9, 0.9),
             'acacia': (80, 0.35, 0.8, 0.9), 'baobab': (80, 0.35, 0.8, 0.9)}


def leaf_tone(rgba, tone):
    """Сдвиг листвы (зеленовато-жёлтые пиксели) к тону DE; кора и тени почти не меняются."""
    th, k, ks, kv = tone
    a = rgba[..., :3].astype(np.float32) / 255.0
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(2), a.min(2)
    d = mx - mn
    with np.errstate(divide='ignore', invalid='ignore'):
        h = np.nan_to_num(np.where(mx == g, 120.0 + 60.0 * (b - r) / d, 60.0 * ((g - b) / d % 6)))
    sat = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0.0)
    wgt = np.clip((sat - 0.15) / 0.25, 0, 1) * ((d > 0.04) & (h >= 35) & (h <= 130) & (g >= r * 0.75))
    h2 = h + (th - h) * k * wgt
    s2 = sat * (1 + (ks - 1) * wgt)
    v2 = mx * (1 + (kv - 1) * wgt)
    c = v2 * s2
    hp = (h2 / 60.0) % 6
    x = c * (1 - np.abs(hp % 2 - 1))
    m = v2 - c
    z = np.zeros_like(c)
    sec = hp.astype(np.int32)
    rr = np.choose(sec, [c, x, z, z, x, c])
    gg = np.choose(sec, [x, c, c, x, z, z])
    bb = np.choose(sec, [z, z, x, c, c, x])
    new = np.stack([rr + m, gg + m, bb + m], 2)
    sel = wgt > 0
    a[sel] = new[sel]
    out = rgba.copy()
    out[..., :3] = np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)
    return out


def _load_index():
    try:
        with open(INDEX, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {'version': 1}


def build_terrain(idx):
    ter = idx['terrain'] = {}
    for name, (rel, target) in TERRAIN.items():
        path = assets.art(*(T + rel).split('/'))
        tex = assets.texture(path)
        if tex is None:
            print('  ! нет текстуры', rel)
            continue
        tile = bn.iso_tile(tex, P)
        if name in CONTRAST:
            f = tile.astype(np.float32)
            mean = f.reshape(-1, 3).mean(0)
            tile = np.clip(mean + (f - mean) * CONTRAST[name], 0, 255).astype(np.uint8)
        if target is not None:
            m = tile.reshape(-1, 3).astype(np.float32).mean(0)
            g = np.array(target, np.float32) / np.maximum(m, 1.0)
            tile = np.clip(tile.astype(np.float32) * g, 0, 255).astype(np.uint8)
        p = os.path.join(OUT, 'terrain', f'{name}.png')
        os.makedirs(os.path.dirname(p), exist_ok=True)
        Image.fromarray(tile).convert('RGB').quantize(colors=192, dither=Image.Dither.NONE).convert('RGB') \
            .save(p, optimize=True)
        ter[name] = {'file': os.path.relpath(p, GEN).replace(os.sep, '/'), 'period': P,
                     'mean': [int(x) for x in tile.reshape(-1, 3).mean(0)]}
        print(f'  + земля {name} ← {rel}')


def build_trees(r, idx):
    trees = idx['trees'] = {}
    for sp, (actor, n, hmax, k) in TREES.items():
        if not actor_exists(actor):
            print('  ! нет актора', actor)
            continue
        seen, recs = set(), []
        for seed in range(40):
            parts = resolve(actor, seed=seed)
            sig = bn._sig(parts)
            if sig in seen or not parts:
                continue
            seen.add(sig)
            _, spr = bn.render_tree(r, actor, seed, hmax, k)
            if sp in LEAF_TONE:
                spr.rgba = leaf_tone(spr.rgba, LEAF_TONE[sp])
            recs.append(save_sprite(spr, os.path.join(OUT, 'trees', f'{sp}_{len(recs)}')))
            if len(recs) >= n:
                break
        trees[sp] = recs
        print(f'  + деревья {sp}: {len(recs)}')


def build_animals(r, idx):
    an = idx['animals'] = {}
    for kind, actor in (('wolf', 'fauna/wolf.xml'),):
        if not actor_exists(actor):
            print('  ! нет актора', actor)
            continue
        parts = resolve(actor, seed=0, prefer=frozenset({'alive', 'idle', 'normal', 'base'}),
                        skip=lambda a, ap: 'blood' in a)
        dirs = []
        for d in range(8):
            yaw = d * 45.0 - bn.ANIMAL_FWD
            place = camera.placement(bn.ANIMAL_S, yaw, center=(0.5, 0.5))
            items = Renderer.build_items(parts, place)
            spr = r.render(items, footprint=(1, 1), look=None, shadow_scale=0.9)
            dirs.append(save_sprite(spr, os.path.join(OUT, 'animals', f'{kind}_d{d}')))
        an[kind] = [dirs]
        print(f'  + {kind}: 8 направлений')


def build_relic(idx):
    """Реликвия: небольшой золотой ларец на ножках с двускатной крышкой (изометрия, клетка 64×32).
    Рисуется в 4× и уменьшается; (ox, oy) — верхний угол ромба клетки, как у спрайтов природы."""
    S = 4
    Wd, Hd = 64, 64
    im = Image.new('RGBA', (Wd * S, Hd * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    def p(x, y):
        return (x * S, y * S)

    cx, base = 32, 50                    # центр клетки на земле: (32, 32 + 16) в координатах спрайта
    # тень
    d.ellipse([p(cx - 15, base - 5), p(cx + 15, base + 5)], fill=(0, 0, 0, 90))
    # ларец в изометрии: ширина по x ±11, «глубина» ±6 (ромб), высота 11
    fl = [(cx - 11, base - 3), (cx, base + 3), (cx + 11, base - 3), (cx, base - 9)]   # дно
    h = 11
    top = [(x, y - h) for x, y in fl]
    gold_d, gold_m, gold_l, gold_h = (122, 84, 18), (186, 136, 34), (226, 180, 60), (255, 232, 140)
    # ножки
    for x, y in fl[:3]:
        d.rectangle([p(x - 1, y - 1), p(x + 1, y + 2)], fill=gold_d)
    # левая и правая грани
    d.polygon([p(*fl[0]), p(*fl[1]), p(*top[1]), p(*top[0])], fill=gold_m)
    d.polygon([p(*fl[1]), p(*fl[2]), p(*top[2]), p(*top[1])], fill=gold_l)
    # крышка-кровля: конёк вдоль длинной оси
    ridge_a = ((top[0][0] + top[3][0]) / 2, (top[0][1] + top[3][1]) / 2 - 6)
    ridge_b = ((top[1][0] + top[2][0]) / 2, (top[1][1] + top[2][1]) / 2 - 6)
    d.polygon([p(*top[0]), p(*top[1]), p(*ridge_b), p(*ridge_a)], fill=gold_l)
    d.polygon([p(*top[1]), p(*top[2]), p(*ridge_b)], fill=gold_m)
    d.polygon([p(*ridge_a), p(*ridge_b), p(*top[2]), p(*top[3])], fill=gold_h)
    # полосы и «камни»
    for t in (0.33, 0.66):
        a = (fl[0][0] + (fl[1][0] - fl[0][0]) * t, fl[0][1] + (fl[1][1] - fl[0][1]) * t)
        d.line([p(*a), p(a[0], a[1] - h)], fill=gold_d, width=S)
    for t in (0.5,):
        a = (fl[1][0] + (fl[2][0] - fl[1][0]) * t, fl[1][1] + (fl[2][1] - fl[1][1]) * t)
        d.line([p(*a), p(a[0], a[1] - h)], fill=gold_m, width=S)
        d.ellipse([p(a[0] - 2, a[1] - h / 2 - 2), p(a[0] + 2, a[1] - h / 2 + 2)], fill=(170, 30, 40))
    a = ((fl[0][0] + fl[1][0]) / 2, (fl[0][1] + fl[1][1]) / 2)
    d.ellipse([p(a[0] - 2, a[1] - h / 2 - 2), p(a[0] + 2, a[1] - h / 2 + 2)], fill=(40, 90, 170))
    # контур
    for poly in ([fl[0], fl[1], top[1], top[0]], [fl[1], fl[2], top[2], top[1]]):
        d.line([p(*q) for q in poly + [poly[0]]], fill=(70, 46, 10), width=S)
    d.line([p(*ridge_a), p(*ridge_b)], fill=(255, 245, 190), width=S)
    # блик-ореол (реликвия заметна на земле)
    glow = Image.new('RGBA', im.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([p(cx - 18, base - 30), p(cx + 18, base + 4)], fill=(255, 236, 150, 60))
    glow = glow.filter(ImageFilter.GaussianBlur(6 * S))
    out = Image.alpha_composite(glow, im).resize((Wd, Hd), Image.LANCZOS)
    p_out = os.path.join(OUT, 'relic.png')
    os.makedirs(OUT, exist_ok=True)
    out.save(p_out, optimize=True)
    # верхний угол ромба клетки: центр на земле (32, 50) → угол (32, 34)
    idx['relic'] = {'file': os.path.relpath(p_out, GEN).replace(os.sep, '/'), 'ox': 32, 'oy': base - 16,
                    'w': Wd, 'h': Hd}
    print('  + реликвия')


def contact(idx, png):
    tiles = []
    for name, rec in idx.get('terrain', {}).items():
        tiles.append(Image.open(os.path.join(GEN, rec['file'])).convert('RGBA').crop((0, 0, 128, 64)))
    for sp, lst in idx.get('trees', {}).items():
        for rec in lst:
            tiles.append(Image.open(os.path.join(GEN, rec['file'])).convert('RGBA'))
    for dirs in idx.get('animals', {}).get('wolf', []):
        for rec in dirs:
            tiles.append(Image.open(os.path.join(GEN, rec['file'])).convert('RGBA'))
    if idx.get('relic'):
        tiles.append(Image.open(os.path.join(GEN, idx['relic']['file'])).convert('RGBA'))
    W = 1800
    rows, row, x, hmax = [], [], 0, 0
    for t in tiles:
        if x + t.size[0] + 8 > W and row:
            rows.append((row, hmax))
            row, x, hmax = [], 0, 0
        row.append((x, t))
        x += t.size[0] + 8
        hmax = max(hmax, t.size[1])
    rows.append((row, hmax))
    sheet = Image.new('RGBA', (W, sum(h + 8 for _, h in rows)), (98, 140, 62, 255))
    y = 0
    for row, h in rows:
        for x, t in row:
            sheet.alpha_composite(t, (x, y))
        y += h + 8
    sheet.save(png)
    print('лист:', png)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='terrain,trees,animals,relic')
    ap.add_argument('--ss', type=int, default=3)
    ap.add_argument('--sheet', default='')
    a = ap.parse_args()
    only = set(a.only.split(','))
    idx = _load_index()
    idx['license'] = 'CC BY-SA 3.0, derived from 0 A.D. (c) Wildfire Games; relic — own drawing; see CREDITS.md'
    r = Renderer(ss=a.ss) if only & {'trees', 'animals'} else None
    if 'terrain' in only:
        build_terrain(idx)
    if 'trees' in only:
        build_trees(r, idx)
    if 'animals' in only:
        build_animals(r, idx)
    if 'relic' in only:
        build_relic(idx)
    os.makedirs(OUT, exist_ok=True)
    with open(INDEX, 'w', encoding='utf-8') as f:
        json.dump(idx, f, ensure_ascii=False, separators=(',', ':'))
    if a.sheet:
        contact(idx, a.sheet)


if __name__ == '__main__':
    main()
