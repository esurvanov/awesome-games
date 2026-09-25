"""Обвязка интерфейса в духе классических RTS: каменные/деревянные панели, золотые рамки, кнопки,
пергаментные подсказки, значки ресурсов, портреты юнитов/зданий/технологий, курсоры.

Графика — из 0 A.D. (© Wildfire Games, CC BY-SA 3.0), собрана в assets/ui/ скриптом
tools/build_ui_assets.py. Если папки нет — всё рисуется процедурно (плоские цвета), игра работает.
Шрифты (assets/fonts/): PT Serif — имена, числа, подсказки (жирная антиква, как в DE); Cormorant SC —
заголовки меню (капитель); Linux Biolinum и GNU FreeSans — прочий текст.
Рамки панелей — по группе культуры цивилизации игрока (CULTURES: 5 наборов, tools/ui_icon_art.py).
Состояния кнопок как в DE (icon_frame): нет ресурсов — значок залит красным, недоступна — серая.
"""
import json
import os

import pygame

from . import uiskin_map as M

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
UI_DIR = os.path.join(ROOT, 'assets', 'ui')
FONT_DIR = os.path.join(ROOT, 'assets', 'fonts')

# палитра
GOLD = (236, 200, 120)
GOLD_HI = (255, 228, 160)
GOLD_DK = (150, 112, 52)
INK = (58, 36, 18)            # текст на пергаменте
INK_DIM = (96, 66, 34)
TEXT = (240, 232, 214)
TEXT_DIM = (190, 178, 152)
RED = (255, 120, 96)
GREEN = (150, 225, 130)
SHADOW = (12, 9, 6)

_img = {}
_cache = {}


def _key_limit():
    if len(_cache) > 900:
        _cache.clear()


def image(rel):
    """Картинка из assets/ui (с альфой) или None."""
    if rel in _img:
        return _img[rel]
    path = os.path.join(UI_DIR, rel)
    surf = None
    if os.path.exists(path):
        try:
            surf = pygame.image.load(path)
            if pygame.display.get_surface() is not None:
                surf = surf.convert_alpha()
        except pygame.error:
            surf = None
    _img[rel] = surf
    return surf


def available():
    return image('skin/btn_base.png') is not None


# ============================================================ шрифты
_fonts = {}


FONT_FILES = {
    # (вид, жирный) → файл; вид: 'serif' — Linux Biolinum (прежние заголовки), 'sans' — FreeSans (мелкий текст),
    # 'antiqua' — PT Serif (DE: жирная антиква имён, чисел, подсказок), 'italic' — PT Serif Italic,
    # 'title' — Cormorant SC (капитель «под Trajan» — заголовки меню)
    ('serif', False): 'LinBiolinum_Rah.ttf', ('serif', True): 'LinBiolinum_RBah.ttf',
    ('sans', False): 'FreeSans.ttf', ('sans', True): 'FreeSansBold.ttf',
    ('antiqua', False): 'PTSerif-Regular.ttf', ('antiqua', True): 'PTSerif-Bold.ttf',
    ('italic', False): 'PTSerif-Italic.ttf', ('italic', True): 'PTSerif-Italic.ttf',
    ('title', False): 'CormorantSC-Bold.ttf', ('title', True): 'CormorantSC-Bold.ttf',
}
FONT_FALLBACK = {'antiqua': ('serif', 'georgia'), 'italic': ('serif', 'georgia'), 'title': ('serif', 'georgia'),
                 'serif': (None, 'georgia'), 'sans': (None, 'arial')}


def font(kind, size, bold=False):
    """kind: 'serif' | 'sans' | 'antiqua' | 'italic' | 'title' (см. FONT_FILES)."""
    key = (kind, size, bold)
    f = _fonts.get(key)
    if f is None:
        path = os.path.join(FONT_DIR, FONT_FILES.get((kind, bold), FONT_FILES[('sans', bold)]))
        if not os.path.exists(path):
            alt, sysname = FONT_FALLBACK.get(kind, (None, 'arial'))
            if alt is not None:
                f = font(alt, size, bold)
                _fonts[key] = f
                return f
            path = pygame.font.match_font(sysname, bold=bold)
        f = pygame.font.Font(path, size)
        _fonts[key] = f
    return f


def game_fonts():
    """Набор шрифтов для ui.Game.fonts (ключи прежние + заголовочные)."""
    # DE: имена, числа, подсказки — жирная антиква (PT Serif Bold); заголовки меню — капитель (Cormorant SC)
    return {
        's': font('sans', 12), 'm': font('sans', 14), 'b': font('antiqua', 15, True),
        'l': font('antiqua', 21, True), 'xl': font('title', 50, True),
        'h': font('title', 29, True), 'title': font('title', 74, True), 'btn': font('title', 26, True),
        'bs': font('antiqua', 13, True),
    }


def text(surf, s, pos, f, color=TEXT, anchor='topleft', shadow=SHADOW):
    img = f.render(s, True, color)
    r = img.get_rect(**{anchor: pos})
    if shadow is not None:
        sh = f.render(s, True, shadow)
        surf.blit(sh, (r.x + 1, r.y + 1))
    surf.blit(img, r)
    return r


def gold_text(s, f, top=(255, 236, 170), bottom=(196, 140, 52), outline=(40, 24, 8)):
    """Надпись с вертикальным золотым градиентом и тёмной обводкой (заголовки)."""
    key = ('gold', s, id(f), top, bottom)
    got = _cache.get(key)
    if got is not None:
        return got
    base = f.render(s, True, (255, 255, 255))
    w, h = base.get_size()
    grad = pygame.Surface((w, h), pygame.SRCALPHA)
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        pygame.draw.line(grad, c, (0, y), (w, y))
    grad.blit(base, (0, 0), special_flags=pygame.BLEND_RGBA_MULT)
    out = pygame.Surface((w + 6, h + 6), pygame.SRCALPHA)
    ol = f.render(s, True, outline)
    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1), (2, 3), (3, 3)):
        out.blit(ol, (3 + dx, 3 + dy))
    out.blit(grad, (3, 3))
    _key_limit()
    _cache[key] = out
    return out


# ============================================================ заливки и рамки
def tiled(rel, size, tint=None, fallback=(46, 38, 30)):
    """Поверхность size, замощённая текстурой (tint — (r,g,b) множитель ×/255)."""
    key = ('tile', rel, size, tint)
    got = _cache.get(key)
    if got is not None:
        return got
    w, h = size
    out = pygame.Surface((max(1, w), max(1, h)))
    tex = image(rel)
    if tex is None:
        out.fill(fallback)
    else:
        tw, th = tex.get_size()
        for y in range(0, h, th):
            for x in range(0, w, tw):
                out.blit(tex, (x, y))
    if tint:
        out.fill(tint, special_flags=pygame.BLEND_RGB_MULT)
    _key_limit()
    _cache[key] = out
    return out


def nine(rel, size, border, fallback=None):
    """9-slice: углы border×border как есть, края и центр растянуты."""
    key = ('nine', rel, size, border)
    got = _cache.get(key)
    if got is not None:
        return got
    w, h = max(2 * border + 1, size[0]), max(2 * border + 1, size[1])
    src = image(rel)
    out = pygame.Surface((w, h), pygame.SRCALPHA)
    if src is None:
        out.fill(fallback or (110, 84, 50))
    else:
        sw, sh = src.get_size()
        b = border

        def part(x, y, pw, ph, dw, dh, dx, dy):
            if pw <= 0 or ph <= 0 or dw <= 0 or dh <= 0:
                return
            p = src.subsurface((x, y, pw, ph))
            if (pw, ph) != (dw, dh):
                p = pygame.transform.smoothscale(p, (dw, dh))
            out.blit(p, (dx, dy))
        cw, ch = sw - 2 * b, sh - 2 * b
        dw, dh = w - 2 * b, h - 2 * b
        part(b, b, cw, ch, dw, dh, b, b)
        part(b, 0, cw, b, dw, b, b, 0)
        part(b, sh - b, cw, b, dw, b, b, h - b)
        part(0, b, b, ch, b, dh, 0, b)
        part(sw - b, b, b, ch, b, dh, w - b, b)
        part(0, 0, b, b, b, b, 0, 0)
        part(sw - b, 0, b, b, b, b, w - b, 0)
        part(0, sh - b, b, b, b, b, 0, h - b)
        part(sw - b, sh - b, b, b, b, b, w - b, h - b)
    _key_limit()
    _cache[key] = out
    return out


def bevel(surf, rect, light=(255, 240, 200, 60), dark=(0, 0, 0, 110), width=2):
    """Фаска: светлый верх/лево, тёмный низ/право (полупрозрачно)."""
    r = pygame.Rect(rect)
    s = pygame.Surface(r.size, pygame.SRCALPHA)
    for i in range(width):
        pygame.draw.line(s, light, (i, i), (r.w - 1 - i, i))
        pygame.draw.line(s, light, (i, i), (i, r.h - 1 - i))
        pygame.draw.line(s, dark, (i, r.h - 1 - i), (r.w - 1 - i, r.h - 1 - i))
        pygame.draw.line(s, dark, (r.w - 1 - i, i), (r.w - 1 - i, r.h - 1 - i))
    surf.blit(s, r.topleft)


def _line_img(size, color=None):
    """Тонкая рамка 0 A.D. (золото) или перекрашенная в color (металл культуры)."""
    img = nine('skin/goldline.png', size, 4)
    if color is None:
        return img
    key = ('line', size, color)
    got = _cache.get(key)
    if got is None:
        got = pygame.transform.grayscale(img)
        got.fill((min(255, color[0] + 40), min(255, color[1] + 40), min(255, color[2] + 40)),
                 special_flags=pygame.BLEND_RGB_MULT)
        _key_limit()
        _cache[key] = got
    return got


def gold_frame(surf, rect, thick=False, color=None):
    """Тонкая золотая рамка 0 A.D.; thick — двойная, с тёмной прокладкой и уголками; color — цвет металла
    (рамки по культурам: сталь, бирюза, золото)."""
    r = pygame.Rect(rect)
    if thick:
        pygame.draw.rect(surf, (20, 14, 8), r.inflate(6, 6), 3)
        surf.blit(_line_img(r.inflate(8, 8).size, color), r.inflate(8, 8).topleft)
        corners(surf, r.inflate(8, 8))
    if image('skin/goldline.png') is None:
        pygame.draw.rect(surf, color or GOLD_DK, r, 2)
        return
    surf.blit(_line_img(r.size, color), r.topleft)


# ============================================================ культуры (рамки панелей по группам цивилизаций)
# DE: у каждой группы цивилизаций своя обвязка (песчаник с плющом, железо с цепями, резной камень…);
# у нас 5 наборов из своих текстур (tools/ui_icon_art.py: build_skins).
CULTURES = {
    'west': dict(name='Западная Европа', tex='skin/hud.png', tint=(255, 240, 220), trim='skin/trim_west.png',
                 metal=None, grid_tint=(120, 112, 104)),
    'central': dict(name='Центральная Европа', tex='skin/culture_iron.png', tint=(235, 238, 245),
                    trim='skin/trim_iron.png', metal=(170, 176, 190), grid_tint=(100, 104, 112)),
    'med': dict(name='Средиземноморье', tex='skin/culture_marble.png', tint=(230, 224, 214),
                trim='skin/trim_marble.png', metal=None, grid_tint=(110, 104, 98)),
    'mideast': dict(name='Ближний Восток', tex='skin/culture_sandstone.png', tint=(225, 215, 200),
                    trim='skin/trim_sandstone.png', metal=(100, 190, 200), grid_tint=(118, 104, 88)),
    'asia': dict(name='Азия', tex='skin/culture_lacquer.png', tint=(230, 220, 215),
                 trim='skin/trim_lacquer.png', metal=(230, 176, 70), grid_tint=(96, 70, 64)),
}
CULTURE_OF = {'britons': 'west', 'franks': 'west', 'celts': 'west',
              'teutons': 'central', 'goths': 'central', 'vikings': 'central',
              'byzantines': 'med', 'spanish': 'med',
              'persians': 'mideast', 'saracens': 'mideast', 'turks': 'mideast',
              'chinese': 'asia', 'japanese': 'asia', 'mongols': 'asia'}


def culture(civ):
    """Набор обвязки цивилизации: dict (см. CULTURES) + 'key'. Нет текстуры — западный набор."""
    key = CULTURE_OF.get(civ, 'west')
    c = CULTURES[key]
    if image(c['tex']) is None:
        key, c = 'west', CULTURES['west']
    return dict(c, key=key)


def culture_panel(size, civ):
    """Фон панели культуры цивилизации civ (замощённая текстура)."""
    c = culture(civ)
    return tiled(c['tex'], size, tint=c['tint'], fallback=(52, 42, 30))


def trim_band(surf, rect, civ):
    """Кант-орнамент культуры вдоль rect (по горизонтали)."""
    r = pygame.Rect(rect)
    t = image(culture(civ)['trim'])
    if t is None:
        rib = image('skin/ribbon.png')
        if rib is not None:
            surf.blit(pygame.transform.smoothscale(rib, r.size), r.topleft)
        return
    band = tiled(culture(civ)['trim'], (r.w, t.get_height()))
    if band.get_height() != r.h:
        band = pygame.transform.smoothscale(band, r.size)
    surf.blit(band, r.topleft)


def parchment_flat(size, emblem=None):
    """Ровный пергамент DE с мягкой виньеткой и бледным гербом-водяным знаком по центру (emblem — Surface)."""
    key = ('pflat', size, id(emblem) if emblem is not None else None)
    got = _cache.get(key)
    if got is not None:
        return got
    if image('skin/parchment_flat.png') is None:
        return parchment(size)
    out = tiled('skin/parchment_flat.png', size).copy()
    if emblem is not None:
        wm = emblem.copy()
        wm.set_alpha(26)
        out.blit(wm, wm.get_rect(center=(size[0] // 2, size[1] // 2)))
    v = pygame.Surface(size, pygame.SRCALPHA)
    steps = 14
    for i in range(steps):
        a = int(70 * (1 - i / steps) ** 2)
        pygame.draw.rect(v, (90, 60, 20, a), (i * 2, i * 2, size[0] - i * 4, size[1] - i * 4), 2)
    out.blit(v, (0, 0))
    _key_limit()
    _cache[key] = out
    return out


def corners(surf, rect, size=7):
    """Золотые ромбики-заклёпки по углам рамки."""
    r = pygame.Rect(rect)
    for cx, cy in (r.topleft, (r.right - 1, r.top), (r.left, r.bottom - 1), (r.right - 1, r.bottom - 1)):
        pts = [(cx, cy - size), (cx + size, cy), (cx, cy + size), (cx - size, cy)]
        pygame.draw.polygon(surf, (40, 26, 10), [(x + 1, y + 1) for x, y in pts])
        pygame.draw.polygon(surf, GOLD_DK, pts)
        inner = [(cx, cy - size + 3), (cx + size - 3, cy), (cx, cy + size - 3), (cx - size + 3, cy)]
        pygame.draw.polygon(surf, GOLD_HI, inner)


def panel(surf, rect, style='stone', frame=True, alpha=None, ornate=False):
    """Панель: 'stone' (тёмный камень), 'light' (светлый камень), 'wood' (резное дерево HUD),
    'parchment' (пергамент). ornate — толстая рамка с уголками."""
    r = pygame.Rect(rect)
    if style == 'parchment':
        bg = parchment(r.size)
    elif style == 'wood':
        bg = tiled('skin/hud.png', r.size, tint=(235, 220, 205), fallback=(52, 42, 30))
    elif style == 'light':
        bg = tiled('skin/stone_light.png', r.size, tint=(170, 160, 146), fallback=(120, 112, 100))
    else:
        bg = tiled('skin/stone_dark.png', r.size, tint=(200, 190, 175), fallback=(40, 34, 28))
    if alpha is not None:
        bg = bg.copy()
        bg.set_alpha(alpha)
    surf.blit(bg, r.topleft)
    if style != 'parchment':
        vignette(surf, r)
    if frame:
        gold_frame(surf, r, thick=ornate)


def parchment(size):
    """Лист пергамента с рваными краями (9-slice текстуры 0 A.D.)."""
    return nine('skin/parchment.png', size, 24, fallback=(214, 190, 140))


def glow(size, strength):
    """Мягкое свечение (добавляется BLEND_RGB_ADD): текстура 0 A.D., ослабленная до strength/255."""
    key = ('glow', size, strength)
    g = _cache.get(key)
    if g is None:
        src = image('skin/glow_over.png')
        if src is None:
            return None
        g = pygame.Surface(size)
        g.fill((0, 0, 0))
        g.blit(pygame.transform.smoothscale(src, size), (0, 0))
        g.fill((strength, strength, strength), special_flags=pygame.BLEND_RGB_MULT)
        _key_limit()
        _cache[key] = g
    return g


def vignette(surf, rect, strength=90):
    r = pygame.Rect(rect)
    key = ('vig', r.size, strength)
    v = _cache.get(key)
    if v is None:
        v = pygame.Surface(r.size, pygame.SRCALPHA)
        steps = 10
        for i in range(steps):
            a = int(strength * (1 - i / steps) ** 2)
            pygame.draw.rect(v, (0, 0, 0, a), (i * 2, i * 2, r.w - i * 4, r.h - i * 4), 2)
        _cache[key] = v
    surf.blit(v, r.topleft)


def shade_overlay(surf, rect, color=(0, 0, 0), alpha=150):
    r = pygame.Rect(rect)
    s = pygame.Surface(r.size, pygame.SRCALPHA)
    s.fill((*color, alpha))
    surf.blit(s, r.topleft)


# ============================================================ кнопки
def button(surf, rect, state='normal'):
    """Большая резная кнопка: normal | hover | pressed | disabled | on (выбрана).
    Все состояния — из тёмной деревянной текстуры 0 A.D.: подсветка, вдавливание, серость, золотая кайма."""
    r = pygame.Rect(rect)
    key = ('btn', r.size, state)
    img = _cache.get(key)
    if img is None:
        img = nine('skin/btn_base.png', r.size, 8).copy()
        if state == 'hover':
            img.fill((30, 24, 12), special_flags=pygame.BLEND_RGB_ADD)
        elif state == 'on':
            img.fill((44, 32, 10), special_flags=pygame.BLEND_RGB_ADD)
        elif state == 'pressed':
            img.fill((170, 160, 150), special_flags=pygame.BLEND_RGB_MULT)
        elif state == 'disabled':
            img = pygame.transform.grayscale(img)
            img.fill((130, 124, 118), special_flags=pygame.BLEND_RGB_MULT)
        if state in ('hover', 'on', 'pressed'):
            g = glow(r.size, 50 if state == 'hover' else 70) if state != 'pressed' else None
            if g is not None:
                img.blit(g, (0, 0), special_flags=pygame.BLEND_RGB_ADD)
            inner = img.get_rect().inflate(-6, -6)
            pygame.draw.rect(img, GOLD if state != 'pressed' else GOLD_DK, inner, 1)
            if state == 'on':
                pygame.draw.rect(img, GOLD_HI, img.get_rect(), 2)
        if image('skin/btn_base.png') is None:
            pygame.draw.rect(img, GOLD_DK, img.get_rect(), 2)
        _key_limit()
        _cache[key] = img
    surf.blit(img, r.topleft)


def slot(surf, rect, state='normal'):
    """Квадратная каменная ячейка под значок (сетка команд, очередь, портрет)."""
    r = pygame.Rect(rect)
    key = ('slot', r.size, state)
    s = _cache.get(key)
    if s is None:
        s = pygame.Surface(r.size, pygame.SRCALPHA)
        s.blit(tiled('skin/stone_dark.png', r.size, tint=(150, 142, 130)), (0, 0))
        pygame.draw.rect(s, (14, 10, 6), s.get_rect(), 2)
        pygame.draw.rect(s, (96, 78, 50) if state != 'hover' else GOLD, s.get_rect().inflate(-2, -2), 1)
        _cache[key] = s
    surf.blit(s, r.topleft)


def icon_state(surf, rect, state):
    """Значок в состоянии DE (меняет уже нарисованный значок на surf):
    'poor' — не хватает ресурсов: значок залит красным; 'disabled' — недоступен: серый;
    'pressed' — темнее; 'hover' — ярче."""
    r = pygame.Rect(rect).clip(surf.get_rect())
    if r.w <= 0 or r.h <= 0:
        return
    if state in ('poor', 'disabled'):
        g = pygame.transform.grayscale(surf.subsurface(r).copy())
        if state == 'poor':
            g.fill((255, 70, 56), special_flags=pygame.BLEND_RGB_MULT)
            g.fill((70, 0, 0), special_flags=pygame.BLEND_RGB_ADD)
        else:
            g.fill((150, 150, 150), special_flags=pygame.BLEND_RGB_MULT)
        surf.blit(g, r.topleft)
    elif state == 'pressed':
        surf.fill((200, 200, 200), r, special_flags=pygame.BLEND_RGB_MULT)
    elif state in ('hover', 'on'):
        surf.fill((28, 26, 22), r, special_flags=pygame.BLEND_RGB_ADD)


def icon_frame(surf, rect, state='normal'):
    """Рамка значка кнопки DE: тонкая светлая фаска 1 px, значок во всю ячейку; состояния — icon_state."""
    r = pygame.Rect(rect)
    icon_state(surf, r, state)
    col = {'hover': GOLD_HI, 'pressed': GOLD, 'on': GOLD_HI, 'poor': (200, 70, 60)}.get(state, (150, 138, 110))
    pygame.draw.rect(surf, (6, 5, 4), r.inflate(2, 2), 1)
    pygame.draw.line(surf, col, r.topleft, (r.right - 1, r.top))
    pygame.draw.line(surf, col, r.topleft, (r.left, r.bottom - 1))
    dk = tuple(c // 3 for c in col)
    pygame.draw.line(surf, dk, (r.left, r.bottom - 1), (r.right - 1, r.bottom - 1))
    pygame.draw.line(surf, dk, (r.right - 1, r.top), (r.right - 1, r.bottom - 1))
    if state == 'hover':
        pygame.draw.rect(surf, GOLD_HI, r, 1)


# ============================================================ значки
RES_ICON = {'food': 'icons/food.png', 'wood': 'icons/wood.png', 'stone': 'icons/stone.png',
            'gold': 'icons/bribes.png', 'metal': 'icons/metal.png', 'pop': 'icons/population.png',
            'time': 'icons/time.png'}


def icon(name, size):
    """Значок из assets/ui/icons (или путь 'dir/name.png'), масштабированный; None — нет файла."""
    rel = RES_ICON.get(name) or (name if name.endswith('.png') else f'icons/{name}.png')
    key = ('icon', rel, size)
    got = _cache.get(key)
    if got is not None or key in _cache:
        return got
    src = image(rel)
    out = None
    if src is not None:
        w, h = src.get_size()
        k = size / max(w, h)
        out = pygame.transform.smoothscale(src, (max(1, round(w * k)), max(1, round(h * k))))
    _cache[key] = out
    return out


def blit_icon(surf, name, center, size):
    ic = icon(name, size)
    if ic is None:
        return False
    surf.blit(ic, ic.get_rect(center=center))
    return True


# ============================================================ портреты
_pfiles = None


def _portrait_index():
    global _pfiles
    if _pfiles is None:
        _pfiles = set()
        base = os.path.join(UI_DIR, 'portraits')
        for dp, _, fs in os.walk(base):
            rel = os.path.relpath(dp, base).replace(os.sep, '/')
            for f in fs:
                if f.endswith('.png'):
                    _pfiles.add(f'{rel}/{f[:-4]}' if rel != '.' else f[:-4])
    return _pfiles


def civ_group(civ):
    """Группа архитектуры цивилизации (как в атласе зданий)."""
    return M.CIV_GROUP.get(civ, M.DEFAULT_GROUP)


def portrait_path(typ, name, civ=None):
    """Относительный путь портрета (без .png) или None. typ: 'u' | 'b' | 't' | 'n' | 'age'.
    Порядок: значок по словарю DE (de/, scenic/, units3d/) → портрет 0 A.D."""
    idx = _portrait_index()
    g = civ_group(civ)
    if typ == 'u':
        if name in M.GAIA_PORTRAITS:
            p = M.GAIA_PORTRAITS[name]
            return p if p in idx else None
        ug = M.UNIT_GROUP.get(g, g)
        for p in (f'units3d/{name}.{ug}', f'units3d/{name}.{M.UNIT_GROUP[M.DEFAULT_GROUP]}'):
            if p in idx:
                return p
        cands = M.UNIT_PORTRAITS.get(name)
        if not cands:
            return None
        dirs = M.CIV_DIRS.get(civ, ()) + tuple(d for d in M.FALLBACK_DIRS if d not in M.CIV_DIRS.get(civ, ()))
        for c in cands:            # сначала лучший кандидат в своей группе, потом — у всех
            for d in M.CIV_DIRS.get(civ, ()):
                if f'units/{d}/{c}' in idx:
                    return f'units/{d}/{c}'
        for c in cands:
            for d in dirs:
                if f'units/{d}/{c}' in idx:
                    return f'units/{d}/{c}'
        return None
    de = None
    if typ == 'b':
        if name in M.SCENIC_BUILDINGS:
            de = [f'scenic/{g}/{M.SCENIC_BUILDINGS[name]}', f'scenic/{M.DEFAULT_GROUP}/{M.SCENIC_BUILDINGS[name]}']
        elif name in M.DE_BUILDINGS:
            de = [M.DE_BUILDINGS[name]]
        p = M.BUILDING_PORTRAITS.get(name)
    elif typ == 't':
        if name in M.SCENIC_TECHS:
            de = [f'scenic/{g}/{M.SCENIC_TECHS[name]}', f'scenic/{M.DEFAULT_GROUP}/{M.SCENIC_TECHS[name]}']
        elif name in M.DE_TECHS:
            de = [M.DE_TECHS[name]]
        elif name in _unique_age():
            de = [M.CROWN[_unique_age()[name]]]
        p = M.TECH_PORTRAITS.get(name)
    elif typ == 'n':
        p = M.GAIA_PORTRAITS.get(name)
    elif typ == 'age':
        de = [M.AGE_PORTRAITS[name]]
        p = M.AGE_PORTRAITS_0AD[name]
    else:
        p = None
    for q in de or ():
        if q in idx:
            return q
    return p if p in idx else None


_uniq = None


def _unique_age():
    """Уникальные технологии цивилизаций (не улучшения юнитов) → эпоха (2 — замков, 3 — имперская)."""
    global _uniq
    if _uniq is None:
        from .data import TECHS
        _uniq = {k: max(2, min(3, t.get('age', 2))) for k, t in TECHS.items()
                 if t.get('civ') and not t.get('upgrade')}
    return _uniq


def portrait(typ, name, civ=None, size=64, upgrade_of=None):
    """Портрет size×size (скруглённые углы не нужны — рамку рисует кнопка) или None."""
    key = ('portrait', typ, name, civ, size)
    if key in _cache:
        return _cache[key]
    out = None
    if typ == 't' and upgrade_of:
        base = portrait('u', upgrade_of, civ, size)       # DE: улучшение — портрет нового юнита, без стрелки
        if base is not None:
            out = base.copy()
    else:
        p = portrait_path(typ, name, civ)
        src = image(f'portraits/{p}.png') if p else None
        if src is not None:
            out = pygame.transform.smoothscale(src, (size, size))
    _cache[key] = out
    return out


# ============================================================ курсоры
CURSOR_FILES = {
    'arrow': 'arrow-default-down', 'attack': 'action-attack', 'build': 'action-build', 'repair': 'action-repair',
    'garrison': 'action-garrison', 'tree': 'action-gather-tree', 'stone': 'action-gather-rock',
    'gold': 'action-gather-ore', 'berries': 'action-gather-fruit', 'farm': 'action-gather-grain',
    'meat': 'action-gather-meat', 'fish': 'action-gather-fish', 'drop': 'action-return-food',
    'heal': 'action-heal', 'no': 'cursor-no', 'rally': 'cursor-rally',
}
# DE: курсор добычи — инструмент (топор, кирка, корзина, серп, копьё, сеть), не ресурс (tools/ui_icon_art.py)
for _k in ('tree', 'gold', 'stone', 'berries', 'farm', 'meat', 'fish', 'drop', 'heal'):
    if os.path.exists(os.path.join(UI_DIR, 'cursors', f'de_{_k}.png')):
        CURSOR_FILES[_k] = f'de_{_k}'


class Cursors:
    """Курсоры 0 A.D. Включаются, только если файлы на месте и система умеет цветные курсоры."""

    def __init__(self):
        self.enabled = True
        self.cur = None
        self.cache = {}
        try:
            with open(os.path.join(UI_DIR, 'cursors', 'hotspots.json')) as f:
                self.hot = json.load(f)
        except (OSError, ValueError):
            self.hot = None

    def get(self, name):
        if name in self.cache:
            return self.cache[name]
        c = None
        fn = CURSOR_FILES.get(name)
        img = image(f'cursors/{fn}.png') if fn and self.hot is not None else None
        if img is not None:
            hx, hy = self.hot.get(fn, [1, 1])
            if img.get_width() > 32:
                k = 32 / img.get_width()
                img = pygame.transform.smoothscale(img, (32, round(img.get_height() * k)))
                hx, hy = int(hx * k), int(hy * k)
            try:
                c = pygame.cursors.Cursor((hx, hy), img)
            except (pygame.error, TypeError, ValueError):
                c = None
        self.cache[name] = c
        return c

    def set(self, name):
        if not self.enabled:
            name = None
        if name == self.cur:
            return
        self.cur = name
        try:
            if name is None:
                pygame.mouse.set_cursor(pygame.SYSTEM_CURSOR_ARROW)
                return
            c = self.get(name) or self.get('arrow')
            if c is not None:
                pygame.mouse.set_cursor(c)
        except pygame.error:
            self.enabled = False
