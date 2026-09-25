"""Интерфейс цивилизаций: выбор в меню (сетка гербов + карточка бонусов), герб в верхней панели,
карточка цивилизации (F2 / клик по гербу), цивилизация владельца в панели выбранного.

Функции получают game (ui.Game) и рисуют на game.screen его же шрифтами и значками.
"""
import pygame

from .data import CIVS, UNITS, TECHS, SCREEN_W, SCREEN_H, TOP_H
from . import civ_art, uiskin

CELL_W, CELL_H = 90, 88
GRID_COLS = 3
LEFT = pygame.Rect(16, 246, GRID_COLS * CELL_W + 22, 5 * CELL_H + 46)
RIGHT = pygame.Rect(SCREEN_W - 16 - 396, 246, 396, 5 * CELL_H + 46)
RANDOM_SPEC = dict(field=((120, 110, 96), (90, 82, 72)), div='quarterly', charge=None)


def playable():
    return [k for k in CIVS if k != 'default']


def civ_name(key):
    return 'Случайная' if key == 'random' else CIVS.get(key, CIVS['default'])['name']


def emblem(key, w, h):
    if key == 'random' or key not in CIVS or 'emblem' not in CIVS[key]:
        img = civ_art.emblem('random', RANDOM_SPEC, w, h)
        return img
    return civ_art.emblem(key, CIVS[key]['emblem'], w, h)


def blit_emblem(game, key, rect):
    r = pygame.Rect(rect)
    game.screen.blit(emblem(key, r.w, r.h), r.topleft)
    if key == 'random' or key not in CIVS:
        game.text('?', (r.centerx, r.centery - r.h // 14), 'xl' if r.h > 40 else 'b', (250, 235, 190),
                  anchor='center')


def unique_units(key):
    return [k for k, d in UNITS.items() if d.get('civ') == key and not k.startswith('elite_')]


def unique_techs(key):
    return sorted((k for k, d in TECHS.items() if d.get('civ') == key and not d.get('upgrade')),
                  key=lambda k: TECHS[k]['age'])


# ============================================================ меню
def menu_items():
    items = []
    keys = playable() + ['random']
    for i, k in enumerate(keys):
        r = pygame.Rect(LEFT.x + 12 + (i % GRID_COLS) * CELL_W, LEFT.y + 36 + (i // GRID_COLS) * CELL_H,
                        CELL_W - 6, CELL_H - 6)
        items.append((r, 'civ', k))
    return items


def draw_menu(game):
    scr = game.screen
    cfg = game.menu_cfg
    sel = cfg.get('civ', 'random')
    mp = pygame.mouse.get_pos()
    _panel(scr, LEFT)
    _panel(scr, RIGHT)
    _flag_icon(scr, LEFT.x + 20, LEFT.y + 18)
    game.text('Цивилизация', (LEFT.x + 34, LEFT.y + 18), 'b', (255, 225, 150), anchor='midleft')
    hover = None
    for r, act, key in menu_items():
        h = r.collidepoint(mp)
        if h:
            hover = key
        on = key == sel
        fill = (150, 112, 52) if on else (104, 84, 56) if h else (70, 58, 42)
        pygame.draw.rect(scr, fill, r, border_radius=8)
        pygame.draw.rect(scr, (240, 205, 120) if on else (130, 108, 74), r, 2, border_radius=8)
        blit_emblem(game, key, (r.centerx - 22, r.y + 6, 44, 52))
        game.text(civ_name(key), (r.centerx, r.bottom - 14), 's', (250, 240, 215) if on else (220, 208, 180),
                  anchor='center')
    draw_card(game, hover or sel, RIGHT, compact=True)


def _panel(scr, r):
    uiskin.panel(scr, r, 'stone', ornate=True, alpha=240)


def _flag_icon(scr, x, y):
    pygame.draw.line(scr, (200, 180, 140), (x - 6, y + 9), (x - 6, y - 9), 2)
    pygame.draw.polygon(scr, (200, 60, 50), [(x - 5, y - 9), (x + 7, y - 6), (x - 5, y - 2)])


def _icon(game, spec, x, y, size=28):
    """Значок строки бонуса: ('u'|'b'|'t', вид) или ('r', ресурс). (x, y) — левый верх."""
    typ, name = spec
    pygame.draw.rect(game.screen, (62, 52, 40), (x, y, size, size), border_radius=5)
    if typ == 'r':
        game.res_icon(name, x + size // 2, y + size // 2, 8)
        return
    try:
        ic = game.icon(typ, name, 0, size)
    except (KeyError, AttributeError):
        return
    game.screen.blit(ic, (x, y))


def draw_card(game, key, box, compact=False, player=None):
    """Карточка цивилизации: герб, имя, направление, бонусы с иконками, командный бонус,
    уникальный юнит и технологии, недоступное (перечёркнутые значки)."""
    scr = game.screen
    x, y = box.x + 16, box.y + 14
    blit_emblem(game, key, (x, y, 56, 66))
    game.text(civ_name(key), (x + 70, y + 14), 'l', (255, 225, 150), anchor='midleft')
    if key == 'random' or key not in CIVS:
        game.text('Цивилизация выпадет при старте', (x + 70, y + 42), 'm', (215, 205, 180), anchor='midleft')
        # мини-гербы всех
        for i, k in enumerate(playable()):
            gx = box.x + 18 + (i % 7) * 52
            gy = box.y + 110 + (i // 7) * 64
            blit_emblem(game, k, (gx, gy, 40, 48))
        return
    c = CIVS[key]
    tag = c.get('style', '')
    r = game.text(tag, (x + 72, y + 44), 'b', (20, 16, 12), anchor='midleft', sh=False)
    pygame.draw.rect(scr, (220, 190, 110), r.inflate(12, 4), border_radius=9)
    game.text(tag, (x + 72, y + 44), 'b', (40, 30, 18), anchor='midleft', sh=False)
    y += 80
    for spec, txt in c.get('bonus', []):
        _icon(game, spec, x, y)
        game.text(txt, (x + 38, y + 14), 'm', (235, 228, 210), anchor='midleft')
        y += 32
    # командный бонус
    spec, txt = c.get('team_desc', (None, ''))
    if spec:
        pygame.draw.line(scr, (100, 84, 60), (x, y + 2), (box.right - 16, y + 2), 1)
        y += 8
        _team_icon(scr, x + 14, y + 14)
        _icon(game, spec, x + 32, y)
        game.text(txt, (x + 70, y + 14), 'm', (170, 225, 160), anchor='midleft')
        y += 34
    # уникальный юнит и технологии
    pygame.draw.line(scr, (100, 84, 60), (x, y + 2), (box.right - 16, y + 2), 1)
    y += 8
    for u in unique_units(key):
        pygame.draw.rect(scr, (92, 70, 38), (x, y, 44, 44), border_radius=6)
        pygame.draw.rect(scr, (230, 190, 90), (x, y, 44, 44), 2, border_radius=6)
        ic = game.icon('u', u, player if player is not None else 0, 44)
        scr.blit(ic, (x, y))
        game.text(UNITS[u]['name'], (x + 54, y + 12), 'b', (255, 220, 140), anchor='midleft')
        game.text(UNITS[u]['desc'], (x + 54, y + 32), 's', (215, 205, 180), anchor='midleft')
        y += 50
    for t in unique_techs(key):
        d = TECHS[t]
        _icon(game, ('t', t), x, y, 28)
        game.text(('III ' if d['age'] == 2 else 'IV ') + d['name'], (x + 38, y + 7), 'b', (240, 225, 180),
                  anchor='midleft')
        game.text(d['desc'], (x + 38, y + 22), 's', (205, 195, 170), anchor='midleft')
        y += 34
    if compact and y > box.bottom - 50:
        return
    # недоступное
    dis = [k for k in c.get('disabled', ()) if k in UNITS or k in TECHS]
    if dis:
        y += 4
        game.text('нет:', (x, y + 14), 's', (200, 150, 130), anchor='midleft')
        xx = x + 30
        for k in dis[:8]:
            spec = ('u', k) if k in UNITS else ('t', k)
            _icon(game, spec, xx, y, 28)
            pygame.draw.line(scr, (220, 60, 50), (xx + 3, y + 3), (xx + 25, y + 25), 3)
            xx += 32


def _team_icon(scr, cx, cy):
    """Две фигурки рядом — «команда»."""
    for dx, c in ((-4, (170, 225, 160)), (4, (120, 190, 120))):
        pygame.draw.circle(scr, c, (cx + dx, cy - 5), 3)
        pygame.draw.rect(scr, c, (cx + dx - 4, cy - 1, 8, 8), border_radius=3)


# ============================================================ в игре
def top_emblem_rect():
    """Герб-знамя справа вверху, перед круглыми кнопками (DE); свисает ниже верхней панели."""
    return pygame.Rect(986, 2, 44, TOP_H + 10)


def draw_top(game):
    p = game.world.players[0]
    blit_emblem(game, p.civ, top_emblem_rect())


def owner_civ(game, owner, x, y):
    """Герб и имя цивилизации владельца после имени игрока. Возвращает правую границу."""
    p = game.world.players[owner]
    blit_emblem(game, p.civ, (x, y - 1, 14, 17))
    r = game.text(civ_name(p.civ), (x + 18, y), 's', (215, 200, 165))
    return r.right


def draw_overlay(game):
    """Карточка своей цивилизации + гербы всех игроков партии."""
    scr = game.screen
    w = game.world
    ov = pygame.Surface((SCREEN_W, SCREEN_H), pygame.SRCALPHA)
    ov.fill((0, 0, 0, 160))
    scr.blit(ov, (0, 0))
    box = pygame.Rect(SCREEN_W // 2 - 220, 70, 440, 530)
    _panel(scr, box)
    p = w.players[0]
    draw_card(game, p.civ, box, player=0)
    # игроки партии
    y = box.bottom - 70
    pygame.draw.line(scr, (100, 84, 60), (box.x + 16, y - 8), (box.right - 16, y - 8), 1)
    x = box.x + 16
    for q in w.players:
        blit_emblem(game, q.civ, (x, y, 30, 36))
        pygame.draw.rect(scr, q.color, (x, y + 40, 30, 5))
        rel = 'вы' if q.id == 0 else ('союзник' if w.allied(0, q.id) else 'враг')
        game.text(civ_name(q.civ), (x + 36, y + 8), 's', (235, 225, 200))
        game.text(rel, (x + 36, y + 24), 's', (170, 225, 160) if rel != 'враг' else (240, 140, 120))
        x += 104
    game.text('F2 / Esc', (box.right - 14, box.y + 16), 's', (190, 175, 150), anchor='topright')
