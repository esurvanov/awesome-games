"""The interface frame in the spirit of classic RTS: stone/wooden panels, golden frames, buttons,
parchment tooltips, resource icons, portraits of units/buildings/techs, cursors.

The graphics are from 0 A.D. (c Wildfire Games, CC BY-SA 3.0), built into assets/ui/ by the script
tools/build_ui_assets.py. If the folder is missing - everything is drawn procedurally (flat colors), the game works.
Fonts (assets/fonts/): PT Serif - names, numbers, tooltips (a bold old-style serif, as in DE); Cormorant SC -
menu headings (small caps); Linux Biolinum and GNU FreeSans - other text.
Panel frames - by the culture group of the player's civilization (CULTURES: 5 sets, tools/ui_icon_art.py).
Button states as in DE (icon_frame): no resources - the icon is filled red, unavailable - grey.
"""
import json
import os
import sys

import pygame

from . import uiskin_map as M

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
UI_DIR = os.path.join(ROOT, 'assets', 'ui')
FONT_DIR = os.path.join(ROOT, 'assets', 'fonts')

# palette
GOLD = (236, 200, 120)
GOLD_HI = (255, 228, 160)
GOLD_DK = (150, 112, 52)
INK = (58, 36, 18)            # text on parchment
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
    """A picture from assets/ui (with alpha) or None."""
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


# ============================================================ fonts
_fonts = {}


FONT_FILES = {
    # (kind, bold) -> file; kind: 'serif' - Linux Biolinum (the former headings), 'sans' - FreeSans (small text),
    # 'antiqua' - PT Serif (DE: a bold old-style serif of names, numbers, tooltips), 'italic' - PT Serif Italic,
    # 'title' - Cormorant SC (small caps "in the Trajan style" - menu headings)
    ('serif', False): 'LinBiolinum_Rah.ttf', ('serif', True): 'LinBiolinum_RBah.ttf',
    ('sans', False): 'FreeSans.ttf', ('sans', True): 'FreeSansBold.ttf',
    ('antiqua', False): 'PTSerif-Regular.ttf', ('antiqua', True): 'PTSerif-Bold.ttf',
    ('italic', False): 'PTSerif-Italic.ttf', ('italic', True): 'PTSerif-Italic.ttf',
    ('title', False): 'CormorantSC-Bold.ttf', ('title', True): 'CormorantSC-Bold.ttf',
}
FONT_FALLBACK = {'antiqua': ('serif', 'georgia'), 'italic': ('serif', 'georgia'), 'title': ('serif', 'georgia'),
                 'serif': (None, 'georgia'), 'sans': (None, 'arial')}
# Chinese and Japanese: our fonts have no ideographs - one Noto Sans (OFL, a subset of GB 2312 / JIS X 0208,
# tools/build_cjk_fonts.py) for all kinds; the bold is synthetic. Heading sizes are slightly smaller (ideographs are wider).
CJK_FONT = {'zh-CN': 'NotoSansSC-Subset.otf', 'ja': 'NotoSansJP-Subset.otf'}
CJK_SCALE = {'title': 0.8, 'xl': 0.9}
_font_info = {}             # id(Font) -> (kind, size, bold) - for choosing a smaller size (fit_text)
OVERFLOW = []               # (text, the needed width, the available one) - captions that had to be cut (checks)


def _lang():
    from . import i18n
    return i18n.current()


def cjk_file():
    """The font file with ideographs for the current language or None."""
    fn = CJK_FONT.get(_lang())
    if fn and os.path.exists(os.path.join(FONT_DIR, fn)):
        return fn
    return None


def font(kind, size, bold=False):
    """kind: 'serif' | 'sans' | 'antiqua' | 'italic' | 'title' (see FONT_FILES)."""
    key = (kind, size, bold)
    f = _fonts.get(key)
    if f is None:
        cjk = cjk_file()
        if cjk is not None:
            f = pygame.font.Font(os.path.join(FONT_DIR, cjk), size)
            f.bold = bool(bold) or kind == 'title'
            _fonts[key] = f
            _font_info[id(f)] = key
            return f
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
        _font_info[id(f)] = key
    return f


def reset_fonts():
    """Language change: fonts (Latin <-> ideographs) and caption caches - anew."""
    _fonts.clear()
    _font_info.clear()
    _cache.clear()


def game_fonts():
    """The font set for ui.Game.fonts (the former keys + heading ones)."""
    # DE: names, numbers, tooltips - a bold old-style serif (PT Serif Bold); menu headings - small caps (Cormorant SC)
    k = CJK_SCALE if cjk_file() else {}
    return {
        's': font('sans', 12), 'm': font('sans', 14), 'b': font('antiqua', 15, True),
        'l': font('antiqua', 21, True), 'xl': font('title', round(50 * k.get('xl', 1)), True),
        'h': font('title', 29, True), 'title': font('title', round(74 * k.get('title', 1)), True),
        'btn': font('title', 26, True), 'bs': font('antiqua', 13, True),
    }


def text(surf, s, pos, f, color=TEXT, anchor='topleft', shadow=SHADOW):
    img = f.render(s, True, color)
    r = img.get_rect(**{anchor: pos})
    if shadow is not None:
        sh = f.render(s, True, shadow)
        surf.blit(sh, (r.x + 1, r.y + 1))
    surf.blit(img, r)
    return r


def fit_text(f, s, max_w, min_size=9):
    """(font, string) that fit into max_w: first a smaller font of the same kind (down to min_size),
    then truncation with "...". Truncated captions go into OVERFLOW (tools/i18n_check.py)."""
    if max_w is None or max_w <= 0 or f.size(s)[0] <= max_w:
        return f, s
    info = _font_info.get(id(f))
    if info is not None:
        kind, size, bold = info
        while size > min_size:
            size -= 1
            f = font(kind, size, bold)
            if f.size(s)[0] <= max_w:
                return f, s
    full = s
    while len(s) > 1 and f.size(s + '…')[0] > max_w:
        s = s[:-1].rstrip()
    OVERFLOW.append((full, f.size(full)[0], max_w))
    if len(OVERFLOW) > 500:
        del OVERFLOW[:250]
    return f, s + '…'


def text_fit(surf, s, pos, f, color=TEXT, anchor='topleft', shadow=SHADOW, max_w=None):
    """Like text(), but the caption is no wider than max_w (a smaller font / "...")."""
    f, s = fit_text(f, s, max_w)
    return text(surf, s, pos, f, color, anchor, shadow)


def gold_text(s, f, top=(255, 236, 170), bottom=(196, 140, 52), outline=(40, 24, 8)):
    """A caption with a vertical golden gradient and a dark outline (headings)."""
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


# ============================================================ fills and frames
def tiled(rel, size, tint=None, fallback=(46, 38, 30)):
    """A surface of size tiled with a texture (tint - an (r,g,b) multiplier x/255)."""
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
    """9-slice: the border x border corners as they are, the edges and center stretched."""
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
    """A bevel: light top/left, dark bottom/right (translucent)."""
    r = pygame.Rect(rect)
    s = pygame.Surface(r.size, pygame.SRCALPHA)
    for i in range(width):
        pygame.draw.line(s, light, (i, i), (r.w - 1 - i, i))
        pygame.draw.line(s, light, (i, i), (i, r.h - 1 - i))
        pygame.draw.line(s, dark, (i, r.h - 1 - i), (r.w - 1 - i, r.h - 1 - i))
        pygame.draw.line(s, dark, (r.w - 1 - i, i), (r.w - 1 - i, r.h - 1 - i))
    surf.blit(s, r.topleft)


def _line_img(size, color=None):
    """A thin 0 A.D. frame (gold) or recolored to color (the culture's metal)."""
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
    """A thin golden 0 A.D. frame; thick - a double one, with a dark backing and corners; color - the metal's color
    (frames by culture: steel, turquoise, gold)."""
    r = pygame.Rect(rect)
    if thick:
        pygame.draw.rect(surf, (20, 14, 8), r.inflate(6, 6), 3)
        surf.blit(_line_img(r.inflate(8, 8).size, color), r.inflate(8, 8).topleft)
        corners(surf, r.inflate(8, 8))
    if image('skin/goldline.png') is None:
        pygame.draw.rect(surf, color or GOLD_DK, r, 2)
        return
    surf.blit(_line_img(r.size, color), r.topleft)


# ============================================================ cultures (panel frames by civilization group)
# DE: every civilization group has its own trim (sandstone with ivy, iron with chains, carved stone...);
# we have 5 sets from our own textures (tools/ui_icon_art.py: build_skins).
CULTURES = {
    'west': dict(name='west', tex='skin/hud.png', tint=(255, 240, 220), trim='skin/trim_west.png',
                 metal=None, grid_tint=(120, 112, 104)),
    'central': dict(name='central', tex='skin/culture_iron.png', tint=(235, 238, 245),
                    trim='skin/trim_iron.png', metal=(170, 176, 190), grid_tint=(100, 104, 112)),
    'med': dict(name='mediterranean', tex='skin/culture_marble.png', tint=(230, 224, 214),
                trim='skin/trim_marble.png', metal=None, grid_tint=(110, 104, 98)),
    'mideast': dict(name='middle_east', tex='skin/culture_sandstone.png', tint=(225, 215, 200),
                    trim='skin/trim_sandstone.png', metal=(100, 190, 200), grid_tint=(118, 104, 88)),
    'asia': dict(name='asia', tex='skin/culture_lacquer.png', tint=(230, 220, 215),
                 trim='skin/trim_lacquer.png', metal=(230, 176, 70), grid_tint=(96, 70, 64)),
}
CULTURE_OF = {'britons': 'west', 'franks': 'west', 'celts': 'west',
              'teutons': 'central', 'goths': 'central', 'vikings': 'central',
              'byzantines': 'med', 'spanish': 'med',
              'persians': 'mideast', 'saracens': 'mideast', 'turks': 'mideast',
              'chinese': 'asia', 'japanese': 'asia', 'mongols': 'asia'}


def culture(civ):
    """A civilization's trim set: a dict (see CULTURES) + 'key'. No texture - the western set."""
    key = CULTURE_OF.get(civ, 'west')
    c = CULTURES[key]
    if image(c['tex']) is None:
        key, c = 'west', CULTURES['west']
    return dict(c, key=key)


def culture_panel(size, civ):
    """The panel background of civilization civ's culture (a tiled texture)."""
    c = culture(civ)
    return tiled(c['tex'], size, tint=c['tint'], fallback=(52, 42, 30))


def trim_band(surf, rect, civ):
    """The culture's border ornament along rect (horizontally)."""
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
    """Plain DE parchment with a soft vignette and a pale coat-of-arms watermark in the center (emblem - a Surface)."""
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
    """Golden diamond rivets at the frame's corners."""
    r = pygame.Rect(rect)
    for cx, cy in (r.topleft, (r.right - 1, r.top), (r.left, r.bottom - 1), (r.right - 1, r.bottom - 1)):
        pts = [(cx, cy - size), (cx + size, cy), (cx, cy + size), (cx - size, cy)]
        pygame.draw.polygon(surf, (40, 26, 10), [(x + 1, y + 1) for x, y in pts])
        pygame.draw.polygon(surf, GOLD_DK, pts)
        inner = [(cx, cy - size + 3), (cx + size - 3, cy), (cx, cy + size - 3), (cx - size + 3, cy)]
        pygame.draw.polygon(surf, GOLD_HI, inner)


def panel(surf, rect, style='stone', frame=True, alpha=None, ornate=False):
    """A panel: 'stone' (dark stone), 'light' (light stone), 'wood' (the HUD's carved wood),
    'parchment' (parchment). ornate - a thick frame with corners."""
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
    """A sheet of parchment with torn edges (a 9-slice of a 0 A.D. texture)."""
    return nine('skin/parchment.png', size, 24, fallback=(214, 190, 140))


def glow(size, strength):
    """A soft glow (added by BLEND_RGB_ADD): a 0 A.D. texture attenuated to strength/255."""
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


# ============================================================ buttons
def button(surf, rect, state='normal'):
    """A large carved button: normal | hover | pressed | disabled | on (selected).
    All states come from the dark wooden 0 A.D. texture: highlight, pressing in, greyness, a golden edge."""
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
    """A square stone cell for an icon (the command grid, queue, portrait)."""
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
    """An icon in a DE state (changes the already drawn icon on surf):
    'poor' - only resources are missing: the icon is filled red; 'disabled' - unavailable: grey;
    'pressed' - darker; 'hover' - brighter."""
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
    """A DE button icon frame: a thin light 1 px bevel, the icon fills the whole cell; states - icon_state."""
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


# ============================================================ icons
RES_ICON = {'food': 'icons/food.png', 'wood': 'icons/wood.png', 'stone': 'icons/stone.png',
            'gold': 'icons/bribes.png', 'metal': 'icons/metal.png', 'pop': 'icons/population.png',
            'time': 'icons/time.png'}


def icon(name, size):
    """An icon from assets/ui/icons (or a 'dir/name.png' path), scaled; None - no file."""
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


# ============================================================ portraits
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
    """A civilization's architecture group (as in the building atlas)."""
    return M.CIV_GROUP.get(civ, M.DEFAULT_GROUP)


def portrait_path(typ, name, civ=None):
    """The relative path of a portrait (without .png) or None. typ: 'u' | 'b' | 't' | 'n' | 'age'.
    Order: an icon by the DE dictionary (de/, scenic/, units3d/) -> a 0 A.D. portrait."""
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
        for c in cands:            # first the best candidate in its own group, then - among all
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
    """Civilizations' unique techs (not unit upgrades) -> age (2 - castle, 3 - imperial)."""
    global _uniq
    if _uniq is None:
        from .data import TECHS
        _uniq = {k: max(2, min(3, t.get('age', 2))) for k, t in TECHS.items()
                 if t.get('civ') and not t.get('upgrade')}
    return _uniq


def portrait(typ, name, civ=None, size=64, upgrade_of=None):
    """A size x size portrait (rounded corners are not needed - the button draws the frame) or None."""
    key = ('portrait', typ, name, civ, size)
    if key in _cache:
        return _cache[key]
    out = None
    if typ == 't' and upgrade_of:
        base = portrait('u', upgrade_of, civ, size)       # DE: an upgrade - a portrait of the new unit, without an arrow
        if base is not None:
            out = base.copy()
    else:
        p = portrait_path(typ, name, civ)
        src = image(f'portraits/{p}.png') if p else None
        if src is not None:
            out = pygame.transform.smoothscale(src, (size, size))
    _cache[key] = out
    return out


# ============================================================ cursors
# States (hud.cursor_kind / controls.order_mode) -> files assets/ui/cursors. The base is 0 A.D.; the action cursors
# in the DE style (de_*, tools/ui_icon_art.py): one object without an arrow, the working end = the aim point (1, 1).
CURSOR_FILES = {
    'arrow': 'arrow-default-down', 'attack': 'action-attack', 'amove': 'action-attack-move',
    'build': 'action-build', 'repair': 'action-repair', 'garrison': 'action-garrison',
    'patrol': 'action-patrol', 'guard': 'action-guard', 'follow': 'action-patrol', 'aground': 'action-target',
    'trade': 'action-setup-trade-route', 'board': 'action-garrison', 'unload': 'action-unload',
    'flare': 'cursor-flare', 'rally': 'cursor-rally', 'no': 'cursor-no',
    'tree': 'action-gather-tree', 'stone': 'action-gather-rock', 'gold': 'action-gather-ore',
    'berries': 'action-gather-fruit', 'farm': 'action-gather-grain', 'meat': 'action-gather-meat',
    'fish': 'action-gather-fish', 'drop': 'action-return-food', 'heal': 'action-heal',
}
for _k in ('tree', 'gold', 'stone', 'berries', 'farm', 'meat', 'fish', 'drop', 'heal', 'repair', 'attack', 'amove',
           'flare', 'rally', 'board', 'unload', 'follow'):
    if os.path.exists(os.path.join(UI_DIR, 'cursors', f'de_{_k}.png')):
        CURSOR_FILES[_k] = f'de_{_k}'


def backing_scale():
    """The window's screen scale (Retina - 2.0): pixels / points via SDL2 (ctypes); 1.0 if it cannot be determined."""
    try:
        import ctypes
        import ctypes.util
        import glob
        base = os.path.dirname(pygame.__file__)
        lib = None
        for c in (glob.glob(os.path.join(base, '.dylibs', 'libSDL2-*.dylib'))
                  + glob.glob(os.path.join(base, '..', 'pygame.libs', 'libSDL2-*.so*'))
                  + [ctypes.util.find_library('SDL2') or '']):
            if not c:
                continue
            try:
                lib = ctypes.CDLL(c)
                break
            except OSError:
                continue
        if lib is None:
            return 1.0
        ci = ctypes.c_int
        lib.SDL_GetWindowFromID.restype = ctypes.c_void_p
        lib.SDL_GetWindowFromID.argtypes = [ctypes.c_uint32]
        for fn in (lib.SDL_GetWindowSize, lib.SDL_GetWindowSizeInPixels):
            fn.argtypes = [ctypes.c_void_p, ctypes.POINTER(ci), ctypes.POINTER(ci)]
            fn.restype = None
        for wid in range(1, 9):
            win = lib.SDL_GetWindowFromID(wid)
            if not win:
                continue
            w, h, pw, ph = ci(), ci(), ci(), ci()
            lib.SDL_GetWindowSize(win, ctypes.byref(w), ctypes.byref(h))
            lib.SDL_GetWindowSizeInPixels(win, ctypes.byref(pw), ctypes.byref(ph))
            if w.value > 0 and pw.value > 0 and pw.value != w.value:
                return pw.value / w.value
    except Exception:
        pass
    # a window without HIGHDPI (pygame SCALED on macOS): SDL sees 1280x800 both ways - we ask Cocoa for the screen
    if sys.platform == 'darwin':
        try:
            import ctypes
            objc = ctypes.CDLL('/usr/lib/libobjc.A.dylib')
            objc.objc_getClass.restype = ctypes.c_void_p
            objc.objc_getClass.argtypes = [ctypes.c_char_p]
            objc.sel_registerName.restype = ctypes.c_void_p
            objc.sel_registerName.argtypes = [ctypes.c_char_p]
            send = objc.objc_msgSend
            send.restype = ctypes.c_void_p
            send.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
            screen = send(objc.objc_getClass(b'NSScreen'), objc.sel_registerName(b'mainScreen'))
            if screen:
                sendf = ctypes.cast(objc.objc_msgSend, ctypes.CFUNCTYPE(ctypes.c_double, ctypes.c_void_p,
                                                                        ctypes.c_void_p))
                k = float(sendf(screen, objc.sel_registerName(b'backingScaleFactor')))
                if 0.5 < k < 8:
                    return k
        except Exception:
            pass
    return 1.0


class Cursors:
    """0 A.D./DE cursors. The system cursor (SDL) is 32 points, on Retina macOS it is stretched to 64 px and blurred
    (docs/research/08_cursor.md, root 3); the software one (soft) is drawn at the end of the frame on the game's surface -
    in the same pixel grid as the world, with the aim point under our control."""

    def __init__(self):
        self.enabled = True
        self.soft = False               # software cursor (settings 'cursor_soft'; None - auto by Retina)
        self.cur = None
        self.cache = {}                 # name -> pygame.cursors.Cursor (system)
        self.imgs = {}                  # name -> (surface, hx, hy) (software)
        self._sys_visible = True
        try:
            with open(os.path.join(UI_DIR, 'cursors', 'hotspots.json')) as f:
                self.hot = json.load(f)
        except (OSError, ValueError):
            self.hot = None

    def load(self, name):
        """(a 32 px surface, hx, hy) of a cursor or None."""
        if name in self.imgs:
            return self.imgs[name]
        rec = None
        fn = CURSOR_FILES.get(name)
        img = image(f'cursors/{fn}.png') if fn and self.hot is not None else None
        if img is not None:
            hx, hy = self.hot.get(fn, [1, 1])
            if img.get_width() > 32:
                k = 32 / img.get_width()
                img = pygame.transform.smoothscale(img, (32, round(img.get_height() * k)))
                hx, hy = int(hx * k), int(hy * k)
            rec = (img, hx, hy)
        self.imgs[name] = rec
        return rec

    def get(self, name):
        if name in self.cache:
            return self.cache[name]
        c = None
        rec = self.load(name)
        if rec is not None:
            img, hx, hy = rec
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
        if self.soft and name is not None:
            return                      # we draw it ourselves (draw); the system one is hidden there
        try:
            if name is None:
                pygame.mouse.set_cursor(pygame.SYSTEM_CURSOR_ARROW)
                return
            c = self.get(name) or self.get('arrow')
            if c is not None:
                pygame.mouse.set_cursor(c)
        except pygame.error:
            self.enabled = False

    def _show_sys(self, v):
        if v != self._sys_visible:
            try:
                pygame.mouse.set_visible(v)
            except pygame.error:
                pass
            self._sys_visible = v

    def draw(self, scr):
        """The software cursor: at the end of the frame by the current mouse position minus the aim point.
        Outside the window (and when the mode is off) - the system cursor."""
        if not (self.soft and self.enabled and self.cur is not None):
            self._show_sys(True)
            return
        focused = pygame.mouse.get_focused()
        self._show_sys(not focused)
        if not focused:
            return
        rec = self.load(self.cur) or self.load('arrow')
        if rec is None:
            self._show_sys(True)
            return
        img, hx, hy = rec
        mx, my = pygame.mouse.get_pos()
        scr.blit(img, (mx - hx, my - hy))

    def set_soft(self, v):
        """Turn the software cursor on/off; the system one is reinstalled on the next frame."""
        self.soft = bool(v)
        self.cur = '?'
        self.imgs.clear()
