"""Значки карт для лобби — свои, рисуются из настоящей генерации карты (как иконки выбора карты DE:
ромб карты на квадрате, лес «деревцами», вода с отмелью, стены, цветные ромбики игроков).

  icon(mt, size)   → pygame.Surface size×size (кэш в памяти; генерация ~0.2–0.5 с на карту)
Никаких картинок DE: всё рисуется по карте, которую выдаёт наш генератор (game/mapgen.py).
"""
import random

import pygame

from .data import PLAYER_COLORS

_cache = {}

# краски значка (приглушённые, «рисованные»)
GRASS = {'grass': (104, 150, 62), 'desert': (222, 188, 118), 'steppe': (178, 164, 86), 'snow': (226, 230, 236),
         'tropical': (86, 158, 70), 'autumn': (150, 140, 66)}
FOREST = {'grass': (34, 78, 34), 'desert': (86, 118, 52), 'steppe': (84, 98, 44), 'snow': (46, 74, 60),
          'tropical': (26, 92, 40), 'autumn': (120, 70, 30)}
WATER = (40, 104, 176)
SHORE = (92, 170, 206)
BEACH = (214, 196, 140)
WALL = (150, 150, 150)
DIRT = (176, 140, 80)
BG = (24, 18, 12)
SEED = {'arabia': 5, 'arena': 3, 'black_forest': 2, 'nomad': 4, 'islands': 3, 'mediterranean': 1}
THEME = {'arabia': 'desert'}         # значок Пустоши — пустынный пейзаж (как у DE)


def _world(mt):
    from .world import World
    state = random.getstate()
    try:
        random.seed(SEED.get(mt, 1))
        s = {'map': mt, 'theme': THEME.get(mt, 'auto'), 'team_together': True}
        return World(1, 4, [0, 0, 1, 1], map_type=mt, civs=['random'] * 4, settings=s, size=96)
    finally:
        random.setstate(state)


def icon(mt, size):
    key = (mt, size)
    s = _cache.get(key)
    if s is None:
        try:
            s = _draw(_world(mt), size)
        except Exception:
            s = pygame.Surface((size, size))
            s.fill(BG)
        _cache[key] = s
    return s


def draw(w, size):
    """Значок по готовому миру w (экран загрузки)."""
    return _draw(w, size)


def _draw(w, size):
    W, H = w.W, w.H
    theme = getattr(w, 'theme', 'grass')
    theme = theme if theme in GRASS else 'grass'
    k = 3                                   # пикселей на клетку до поворота
    top = pygame.Surface((W * k, H * k))
    top.fill(GRASS[theme])
    rnd = random.Random(3)
    T = w.terrain
    near = _water_dist(w)
    for y in range(H):
        for x in range(W):
            t = T[y][x]
            if t == 1:
                c = WATER if near[y][x] > 1 else SHORE
            elif t == 2:
                c = SHORE
            elif near[y][x] <= 1 and theme != 'desert':
                c = BEACH
            else:
                v = rnd.randint(-6, 6)
                c = tuple(max(0, min(255, a + v)) for a in GRASS[theme])
            top.fill(c, (x * k, y * k, k, k))
    # у стартов — земля
    for sx, sy in w.starts:
        pygame.draw.circle(top, DIRT, ((sx + 0.5) * k, (sy + 0.5) * k), 4 * k)
    # лес — «деревца» (кружки с тенью) плотно по клеткам леса
    fc = FOREST[theme]
    dark = tuple(max(0, a - 26) for a in fc)
    light = tuple(min(255, a + 28) for a in fc)
    trees = [n for n in w.nodes if n.kind == 'tree']
    for n in trees:
        top.fill(dark, (n.tx * k, n.ty * k, k, k))
    for n in trees:
        if (n.tx * 7 + n.ty * 3) % 2 == 0:
            cx, cy = n.tx * k + k // 2, n.ty * k + k // 2
            pygame.draw.circle(top, fc, (cx, cy), k * 0.9)
            pygame.draw.circle(top, light, (cx - 1, cy - 1), k * 0.4)
    for n in w.nodes:
        if n.kind == 'gold':
            top.fill((240, 200, 50), (n.tx * k, n.ty * k, k, k))
        elif n.kind == 'stone':
            top.fill((170, 170, 170), (n.tx * k, n.ty * k, k, k))
    for b in w.buildings:
        if b.d.get('wall'):
            top.fill(WALL, (b.tx * k, b.ty * k, b.w * k, b.h * k))
    # поворот в ромб 1:1 (как значки выбора карты DE: ромб на квадрате)
    rot = pygame.transform.rotate(top.convert_alpha() if pygame.display.get_surface() else top, -45)
    d = size - 4
    dia = pygame.transform.smoothscale(rot, (d, d))
    out = pygame.Surface((size, size))
    out.fill(BG)
    # углы квадрата — продолжение края карты, темнее
    edge = [top.get_at((x * k, y * k)) for x, y in ((0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1),
                                                     (W // 2, 0), (0, H // 2), (W - 1, H // 2), (W // 2, H - 1))]
    base = tuple(max(0, int(sum(c[i] for c in edge) / len(edge)) - 36) for i in range(3))
    pygame.draw.rect(out, base, (2, 2, d, d))
    dy = 2
    out.blit(dia, (2, dy))
    # ромбики игроков
    Wd = Hd = d
    for pid, (sx, sy) in enumerate(w.starts):
        u = (sx + 0.5) / W
        v = (sy + 0.5) / H
        px = 2 + (u - v + 1) * 0.5 * Wd
        py = dy + (u + v) * 0.5 * Hd
        col = PLAYER_COLORS[pid % len(PLAYER_COLORS)]
        r = max(4, size // 18)
        pts = [(px, py - r), (px + r, py), (px, py + r), (px - r, py)]
        pygame.draw.polygon(out, col, pts)
        pygame.draw.polygon(out, (20, 14, 8), pts, 2)
    pygame.draw.rect(out, (120, 84, 40), out.get_rect(), 1)
    return out


def _water_dist(w):
    """Расстояние (0, 1, 2+) до воды по 8 соседям — для кромки отмели/пляжа."""
    W, H = w.W, w.H
    T = w.terrain
    out = [[3] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            if T[y][x] == 1:
                land = any(0 <= x + dx < W and 0 <= y + dy < H and T[y + dy][x + dx] != 1
                           for dx in (-1, 0, 1) for dy in (-1, 0, 1))
                out[y][x] = 1 if land else 3
            else:
                wet = any(0 <= x + dx < W and 0 <= y + dy < H and T[y + dy][x + dx] == 1
                          for dx in (-1, 0, 1) for dy in (-1, 0, 1))
                out[y][x] = 1 if wet else 3
    return out

