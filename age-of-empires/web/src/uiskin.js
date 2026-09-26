// port of game/uiskin.py
/* The interface frame in the spirit of classic RTS: stone/wooden panels, golden frames, buttons,
parchment tooltips, resource icons, portraits of units/buildings/techs, cursors.

The graphics are from 0 A.D. (c Wildfire Games, CC BY-SA 3.0), built into assets/ui/ by the script
tools/build_ui_assets.py. If the folder is missing - everything is drawn procedurally (flat colors), the game works.
Fonts (assets/fonts/): PT Serif - names, numbers, tooltips (a bold old-style serif, as in DE); Cormorant SC -
menu headings (small caps); Linux Biolinum and GNU FreeSans - other text.
Panel frames - by the culture group of the player's civilization (CULTURES: 5 sets, tools/ui_icon_art.py).
Button states as in DE (icon_frame): no resources - the icon is filled red, unavailable - grey.
*/
import * as py from '../runtime/py.js';
import { os, modules } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import * as assets from '../runtime/assets.js';
import * as M from './uiskin_map.js';

export const ROOT = '';
export const UI_DIR = 'assets/ui';
export const FONT_DIR = 'assets/fonts';

// palette
export const GOLD = [236, 200, 120];
export const GOLD_HI = [255, 228, 160];
export const GOLD_DK = [150, 112, 52];
export const INK = [58, 36, 18];            // text on parchment
export const INK_DIM = [96, 66, 34];
export const TEXT = [240, 232, 214];
export const TEXT_DIM = [190, 178, 152];
export const RED = [255, 120, 96];
export const GREEN = [150, 225, 130];
export const SHADOW = [12, 9, 6];

export const _img = new Map();
export const _cache = new Map();      // py.tkey(tuple key) -> value

const _int = Math.trunc;

export function _key_limit() {
    if (_cache.size > 900) _cache.clear();
}

/** A picture from assets/ui (with alpha) or null. */
export function image(rel) {
    if (_img.has(rel)) return _img.get(rel);
    const path = os.path.join(UI_DIR, rel);
    let surf = null;
    if (os.path.exists(path)) {
        try {
            surf = pygame.image.load(path);
            if (pygame.display.get_surface() != null) surf = surf.convert_alpha();
        } catch (e) {
            if (!(e instanceof pygame.error)) throw e;
            surf = null;
        }
    }
    _img.set(rel, surf);
    return surf;
}

export function available() {
    return image('skin/btn_base.png') != null;
}

// ============================================================ fonts
export const _fonts = new Map();      // py.tkey([kind, size, bold]) -> Font

const _FF = (kind, bold) => kind + '|' + (bold ? 1 : 0);
export const FONT_FILES = {
    // (kind, bold) -> file; kind: 'serif' - Linux Biolinum (the former headings), 'sans' - FreeSans (small text),
    // 'antiqua' - PT Serif (DE: a bold old-style serif of names, numbers, tooltips), 'italic' - PT Serif Italic,
    // 'title' - Cormorant SC (small caps "in the Trajan style" - menu headings)
    // keys: 'kind|0' / 'kind|1' (the Python tuple (kind, bold))
    [_FF('serif', false)]: 'LinBiolinum_Rah.ttf', [_FF('serif', true)]: 'LinBiolinum_RBah.ttf',
    [_FF('sans', false)]: 'FreeSans.ttf', [_FF('sans', true)]: 'FreeSansBold.ttf',
    [_FF('antiqua', false)]: 'PTSerif-Regular.ttf', [_FF('antiqua', true)]: 'PTSerif-Bold.ttf',
    [_FF('italic', false)]: 'PTSerif-Italic.ttf', [_FF('italic', true)]: 'PTSerif-Italic.ttf',
    [_FF('title', false)]: 'CormorantSC-Bold.ttf', [_FF('title', true)]: 'CormorantSC-Bold.ttf',
};
export const FONT_FALLBACK = {
    'antiqua': ['serif', 'georgia'], 'italic': ['serif', 'georgia'], 'title': ['serif', 'georgia'],
    'serif': [null, 'georgia'], 'sans': [null, 'arial'],
};
// Chinese and Japanese: our fonts have no ideographs - one Noto Sans (OFL, a subset of GB 2312 / JIS X 0208,
// tools/build_cjk_fonts.py) for all kinds; the bold is synthetic. Heading sizes are slightly smaller (ideographs are wider).
export const CJK_FONT = { 'zh-CN': 'NotoSansSC-Subset.otf', 'ja': 'NotoSansJP-Subset.otf' };
export const CJK_SCALE = { 'title': 0.8, 'xl': 0.9 };
export const _font_info = new Map();   // Font -> [kind, size, bold] - for choosing a smaller size (fit_text)
export const OVERFLOW = [];            // [text, the needed width, the available one] - captions that had to be cut (checks)

export function _lang() {
    const i18n = modules.i18n;
    return i18n.current();
}

/** The font file with ideographs for the current language or null. */
export function cjk_file() {
    const fn = py.get(CJK_FONT, _lang(), null);
    if (fn && os.path.exists(os.path.join(FONT_DIR, fn))) return fn;
    return null;
}

/** kind: 'serif' | 'sans' | 'antiqua' | 'italic' | 'title' (see FONT_FILES). */
export function font(kind, size, bold = false) {
    const key = py.tkey([kind, size, !!bold]);
    let f = _fonts.get(key);
    if (f == null) {
        const cjk = cjk_file();
        if (cjk != null) {
            f = new pygame.font.Font(os.path.join(FONT_DIR, cjk), size);
            f.bold = !!bold || kind === 'title';
            _fonts.set(key, f);
            _font_info.set(f, [kind, size, bold]);
            return f;
        }
        let path = os.path.join(FONT_DIR, py.get(FONT_FILES, _FF(kind, bold), FONT_FILES[_FF('sans', bold)]));
        if (!os.path.exists(path)) {
            const [alt, sysname] = py.get(FONT_FALLBACK, kind, [null, 'arial']);
            if (alt != null) {
                f = font(alt, size, bold);
                _fonts.set(key, f);
                return f;
            }
            path = pygame.font.match_font(sysname, bold);
        }
        f = new pygame.font.Font(path, size);
        _fonts.set(key, f);
        _font_info.set(f, [kind, size, bold]);
    }
    return f;
}

/** Language change: fonts (Latin <-> ideographs) and caption caches - anew. */
export function reset_fonts() {
    _fonts.clear();
    _font_info.clear();
    _cache.clear();
}

/** The font set for ui.Game.fonts (the former keys + heading ones). */
export function game_fonts() {
    // DE: names, numbers, tooltips - a bold old-style serif (PT Serif Bold); menu headings - small caps (Cormorant SC)
    const k = cjk_file() ? CJK_SCALE : {};
    return {
        's': font('sans', 12), 'm': font('sans', 14), 'b': font('antiqua', 15, true),
        'l': font('antiqua', 21, true), 'xl': font('title', py.round(50 * py.get(k, 'xl', 1)), true),
        'h': font('title', 29, true), 'title': font('title', py.round(74 * py.get(k, 'title', 1)), true),
        'btn': font('title', 26, true), 'bs': font('antiqua', 13, true),
    };
}

export function text(surf, s, pos, f, color = TEXT, anchor = 'topleft', shadow = SHADOW) {
    const img = f.render(s, true, color);
    const r = img.get_rect({ [anchor]: pos });
    if (shadow != null) {
        const sh = f.render(s, true, shadow);
        surf.blit(sh, [r.x + 1, r.y + 1]);
    }
    surf.blit(img, r);
    return r;
}

/** [font, string] that fit into max_w: first a smaller font of the same kind (down to min_size),
 *  then truncation with "...". Truncated captions go into OVERFLOW (tools/i18n_check.py). */
export function fit_text(f, s, max_w, min_size = 9) {
    if (max_w == null || max_w <= 0 || f.size(s)[0] <= max_w) return [f, s];
    const info = _font_info.get(f);
    if (info != null) {
        let [kind, size, bold] = info;
        while (size > min_size) {
            size -= 1;
            f = font(kind, size, bold);
            if (f.size(s)[0] <= max_w) return [f, s];
        }
    }
    const full = s;
    // Python strings are indexed by code points
    while (Array.from(s).length > 1 && f.size(s + '…')[0] > max_w) s = py.rstrip(Array.from(s).slice(0, -1).join(''));
    OVERFLOW.push([full, f.size(full)[0], max_w]);
    if (OVERFLOW.length > 500) OVERFLOW.splice(0, 250);
    return [f, s + '…'];
}

/** Like text(), but the caption is no wider than max_w (a smaller font / "..."). */
export function text_fit(surf, s, pos, f, color = TEXT, anchor = 'topleft', shadow = SHADOW, max_w = null) {
    [f, s] = fit_text(f, s, max_w);
    return text(surf, s, pos, f, color, anchor, shadow);
}

/** A caption with a vertical golden gradient and a dark outline (headings). */
export function gold_text(s, f, top = [255, 236, 170], bottom = [196, 140, 52], outline = [40, 24, 8]) {
    const key = py.tkey(['gold', s, py.id(f), top, bottom]);
    const got = _cache.get(key);
    if (got != null) return got;
    const base = f.render(s, true, [255, 255, 255]);
    const [w, h] = base.get_size();
    const grad = new pygame.Surface([w, h], pygame.SRCALPHA);
    for (let y = 0; y < h; y++) {
        const t = y / Math.max(1, h - 1);
        const c = [0, 1, 2].map(i => _int(top[i] + (bottom[i] - top[i]) * t));
        pygame.draw.line(grad, c, [0, y], [w, y]);
    }
    grad.blit(base, [0, 0], null, pygame.BLEND_RGBA_MULT);
    const out = new pygame.Surface([w + 6, h + 6], pygame.SRCALPHA);
    const ol = f.render(s, true, outline);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1], [2, 3], [3, 3]])
        out.blit(ol, [3 + dx, 3 + dy]);
    out.blit(grad, [3, 3]);
    _key_limit();
    _cache.set(key, out);
    return out;
}

// ============================================================ fills and frames
/** A surface of size tiled with a texture (tint - an (r,g,b) multiplier x/255). */
export function tiled(rel, size, tint = null, fallback = [46, 38, 30]) {
    const key = py.tkey(['tile', rel, [size[0], size[1]], tint]);
    const got = _cache.get(key);
    if (got != null) return got;
    const [w, h] = size;
    const out = new pygame.Surface([Math.max(1, w), Math.max(1, h)]);
    const tex = image(rel);
    if (tex == null) {
        out.fill(fallback);
    } else {
        const [tw, th] = tex.get_size();
        for (let y = 0; y < h; y += th)
            for (let x = 0; x < w; x += tw) out.blit(tex, [x, y]);
    }
    if (py.bool(tint)) out.fill(tint, null, pygame.BLEND_RGB_MULT);
    _key_limit();
    _cache.set(key, out);
    return out;
}

/** 9-slice: the border x border corners as they are, the edges and center stretched. */
export function nine(rel, size, border, fallback = null) {
    const key = py.tkey(['nine', rel, [size[0], size[1]], border]);
    const got = _cache.get(key);
    if (got != null) return got;
    const w = Math.max(2 * border + 1, size[0]), h = Math.max(2 * border + 1, size[1]);
    const src = image(rel);
    const out = new pygame.Surface([w, h], pygame.SRCALPHA);
    if (src == null) {
        out.fill(py.bool(fallback) ? fallback : [110, 84, 50]);
    } else {
        const [sw, sh] = src.get_size();
        const b = border;

        const part = (x, y, pw, ph, dw, dh, dx, dy) => {
            if (pw <= 0 || ph <= 0 || dw <= 0 || dh <= 0) return;
            let p = src.subsurface([x, y, pw, ph]);
            if (pw !== dw || ph !== dh) p = pygame.transform.smoothscale(p, [dw, dh]);
            out.blit(p, [dx, dy]);
        };
        const cw = sw - 2 * b, ch = sh - 2 * b;
        const dw = w - 2 * b, dh = h - 2 * b;
        part(b, b, cw, ch, dw, dh, b, b);
        part(b, 0, cw, b, dw, b, b, 0);
        part(b, sh - b, cw, b, dw, b, b, h - b);
        part(0, b, b, ch, b, dh, 0, b);
        part(sw - b, b, b, ch, b, dh, w - b, b);
        part(0, 0, b, b, b, b, 0, 0);
        part(sw - b, 0, b, b, b, b, w - b, 0);
        part(0, sh - b, b, b, b, b, 0, h - b);
        part(sw - b, sh - b, b, b, b, b, w - b, h - b);
    }
    _key_limit();
    _cache.set(key, out);
    return out;
}

/** A bevel: light top/left, dark bottom/right (translucent). */
export function bevel(surf, rect, light = [255, 240, 200, 60], dark = [0, 0, 0, 110], width = 2) {
    const r = new pygame.Rect(rect);
    const s = new pygame.Surface(r.size, pygame.SRCALPHA);
    for (let i = 0; i < width; i++) {
        pygame.draw.line(s, light, [i, i], [r.w - 1 - i, i]);
        pygame.draw.line(s, light, [i, i], [i, r.h - 1 - i]);
        pygame.draw.line(s, dark, [i, r.h - 1 - i], [r.w - 1 - i, r.h - 1 - i]);
        pygame.draw.line(s, dark, [r.w - 1 - i, i], [r.w - 1 - i, r.h - 1 - i]);
    }
    surf.blit(s, r.topleft);
}

/** A thin 0 A.D. frame (gold) or recolored to color (the culture's metal). */
export function _line_img(size, color = null) {
    const img = nine('skin/goldline.png', size, 4);
    if (color == null) return img;
    const key = py.tkey(['line', [size[0], size[1]], color]);
    let got = _cache.get(key);
    if (got == null) {
        got = pygame.transform.grayscale(img);
        got.fill([Math.min(255, color[0] + 40), Math.min(255, color[1] + 40), Math.min(255, color[2] + 40)],
            null, pygame.BLEND_RGB_MULT);
        _key_limit();
        _cache.set(key, got);
    }
    return got;
}

/** A thin golden 0 A.D. frame; thick - a double one, with a dark backing and corners; color - the metal's color
 *  (frames by culture: steel, turquoise, gold). */
export function gold_frame(surf, rect, thick = false, color = null) {
    const r = new pygame.Rect(rect);
    if (thick) {
        pygame.draw.rect(surf, [20, 14, 8], r.inflate(6, 6), 3);
        surf.blit(_line_img(r.inflate(8, 8).size, color), r.inflate(8, 8).topleft);
        corners(surf, r.inflate(8, 8));
    }
    if (image('skin/goldline.png') == null) {
        pygame.draw.rect(surf, py.bool(color) ? color : GOLD_DK, r, 2);
        return;
    }
    surf.blit(_line_img(r.size, color), r.topleft);
}

// ============================================================ cultures (panel frames by civilization group)
// DE: every civilization group has its own trim (sandstone with ivy, iron with chains, carved stone...);
// we have 5 sets from our own textures (tools/ui_icon_art.py: build_skins).
export const CULTURES = {
    'west': { name: 'west', tex: 'skin/hud.png', tint: [255, 240, 220], trim: 'skin/trim_west.png',
        metal: null, grid_tint: [120, 112, 104] },
    'central': { name: 'central', tex: 'skin/culture_iron.png', tint: [235, 238, 245],
        trim: 'skin/trim_iron.png', metal: [170, 176, 190], grid_tint: [100, 104, 112] },
    'med': { name: 'mediterranean', tex: 'skin/culture_marble.png', tint: [230, 224, 214],
        trim: 'skin/trim_marble.png', metal: null, grid_tint: [110, 104, 98] },
    'mideast': { name: 'middle_east', tex: 'skin/culture_sandstone.png', tint: [225, 215, 200],
        trim: 'skin/trim_sandstone.png', metal: [100, 190, 200], grid_tint: [118, 104, 88] },
    'asia': { name: 'asia', tex: 'skin/culture_lacquer.png', tint: [230, 220, 215],
        trim: 'skin/trim_lacquer.png', metal: [230, 176, 70], grid_tint: [96, 70, 64] },
};
export const CULTURE_OF = {
    'britons': 'west', 'franks': 'west', 'celts': 'west',
    'teutons': 'central', 'goths': 'central', 'vikings': 'central',
    'byzantines': 'med', 'spanish': 'med',
    'persians': 'mideast', 'saracens': 'mideast', 'turks': 'mideast',
    'chinese': 'asia', 'japanese': 'asia', 'mongols': 'asia',
};

/** A civilization's trim set: a dict (see CULTURES) + 'key'. No texture - the western set. */
export function culture(civ) {
    let key = py.get(CULTURE_OF, civ, 'west');
    let c = CULTURES[key];
    if (image(c.tex) == null) {
        key = 'west';
        c = CULTURES['west'];
    }
    return { ...c, key };
}

/** The panel background of civilization civ's culture (a tiled texture). */
export function culture_panel(size, civ) {
    const c = culture(civ);
    return tiled(c.tex, size, c.tint, [52, 42, 30]);
}

/** The culture's border ornament along rect (horizontally). */
export function trim_band(surf, rect, civ) {
    const r = new pygame.Rect(rect);
    const t = image(culture(civ).trim);
    if (t == null) {
        const rib = image('skin/ribbon.png');
        if (rib != null) surf.blit(pygame.transform.smoothscale(rib, r.size), r.topleft);
        return;
    }
    let band = tiled(culture(civ).trim, [r.w, t.get_height()]);
    if (band.get_height() !== r.h) band = pygame.transform.smoothscale(band, r.size);
    surf.blit(band, r.topleft);
}

/** Plain DE parchment with a soft vignette and a pale coat-of-arms watermark in the center (emblem - a Surface). */
export function parchment_flat(size, emblem = null) {
    const key = py.tkey(['pflat', [size[0], size[1]], emblem != null ? py.id(emblem) : null]);
    const got = _cache.get(key);
    if (got != null) return got;
    if (image('skin/parchment_flat.png') == null) return parchment(size);
    const out = tiled('skin/parchment_flat.png', size).copy();
    if (emblem != null) {
        const wm = emblem.copy();
        wm.set_alpha(26);
        out.blit(wm, wm.get_rect({ center: [py.floordiv(size[0], 2), py.floordiv(size[1], 2)] }));
    }
    const v = new pygame.Surface(size, pygame.SRCALPHA);
    const steps = 14;
    for (let i = 0; i < steps; i++) {
        const a = _int(70 * (1 - i / steps) ** 2);
        pygame.draw.rect(v, [90, 60, 20, a], [i * 2, i * 2, size[0] - i * 4, size[1] - i * 4], 2);
    }
    out.blit(v, [0, 0]);
    _key_limit();
    _cache.set(key, out);
    return out;
}

/** Golden diamond rivets at the frame's corners. */
export function corners(surf, rect, size = 7) {
    const r = new pygame.Rect(rect);
    for (const [cx, cy] of [r.topleft, [r.right - 1, r.top], [r.left, r.bottom - 1], [r.right - 1, r.bottom - 1]]) {
        const pts = [[cx, cy - size], [cx + size, cy], [cx, cy + size], [cx - size, cy]];
        pygame.draw.polygon(surf, [40, 26, 10], pts.map(([x, y]) => [x + 1, y + 1]));
        pygame.draw.polygon(surf, GOLD_DK, pts);
        const inner = [[cx, cy - size + 3], [cx + size - 3, cy], [cx, cy + size - 3], [cx - size + 3, cy]];
        pygame.draw.polygon(surf, GOLD_HI, inner);
    }
}

/** A panel: 'stone' (dark stone), 'light' (light stone), 'wood' (the HUD's carved wood),
 *  'parchment' (parchment). ornate - a thick frame with corners. */
export function panel(surf, rect, style = 'stone', frame = true, alpha = null, ornate = false) {
    const r = new pygame.Rect(rect);
    let bg;
    if (style === 'parchment') bg = parchment(r.size);
    else if (style === 'wood') bg = tiled('skin/hud.png', r.size, [235, 220, 205], [52, 42, 30]);
    else if (style === 'light') bg = tiled('skin/stone_light.png', r.size, [170, 160, 146], [120, 112, 100]);
    else bg = tiled('skin/stone_dark.png', r.size, [200, 190, 175], [40, 34, 28]);
    if (alpha != null) {
        bg = bg.copy();
        bg.set_alpha(alpha);
    }
    surf.blit(bg, r.topleft);
    if (style !== 'parchment') vignette(surf, r);
    if (frame) gold_frame(surf, r, ornate);
}

/** A sheet of parchment with torn edges (a 9-slice of a 0 A.D. texture). */
export function parchment(size) {
    return nine('skin/parchment.png', size, 24, [214, 190, 140]);
}

/** A soft glow (added by BLEND_RGB_ADD): a 0 A.D. texture attenuated to strength/255. */
export function glow(size, strength) {
    const key = py.tkey(['glow', [size[0], size[1]], strength]);
    let g = _cache.get(key);
    if (g == null) {
        const src = image('skin/glow_over.png');
        if (src == null) return null;
        g = new pygame.Surface(size);
        g.fill([0, 0, 0]);
        g.blit(pygame.transform.smoothscale(src, size), [0, 0]);
        g.fill([strength, strength, strength], null, pygame.BLEND_RGB_MULT);
        _key_limit();
        _cache.set(key, g);
    }
    return g;
}

export function vignette(surf, rect, strength = 90) {
    const r = new pygame.Rect(rect);
    const key = py.tkey(['vig', r.size, strength]);
    let v = _cache.get(key);
    if (v == null) {
        v = new pygame.Surface(r.size, pygame.SRCALPHA);
        const steps = 10;
        for (let i = 0; i < steps; i++) {
            const a = _int(strength * (1 - i / steps) ** 2);
            pygame.draw.rect(v, [0, 0, 0, a], [i * 2, i * 2, r.w - i * 4, r.h - i * 4], 2);
        }
        _cache.set(key, v);
    }
    surf.blit(v, r.topleft);
}

export function shade_overlay(surf, rect, color = [0, 0, 0], alpha = 150) {
    const r = new pygame.Rect(rect);
    const s = new pygame.Surface(r.size, pygame.SRCALPHA);
    s.fill([...color, alpha]);
    surf.blit(s, r.topleft);
}

// ============================================================ buttons
/** A large carved button: normal | hover | pressed | disabled | on (selected).
 *  All states come from the dark wooden 0 A.D. texture: highlight, pressing in, greyness, a golden edge. */
export function button(surf, rect, state = 'normal') {
    const r = new pygame.Rect(rect);
    const key = py.tkey(['btn', r.size, state]);
    let img = _cache.get(key);
    if (img == null) {
        img = nine('skin/btn_base.png', r.size, 8).copy();
        if (state === 'hover') img.fill([30, 24, 12], null, pygame.BLEND_RGB_ADD);
        else if (state === 'on') img.fill([44, 32, 10], null, pygame.BLEND_RGB_ADD);
        else if (state === 'pressed') img.fill([170, 160, 150], null, pygame.BLEND_RGB_MULT);
        else if (state === 'disabled') {
            img = pygame.transform.grayscale(img);
            img.fill([130, 124, 118], null, pygame.BLEND_RGB_MULT);
        }
        if (['hover', 'on', 'pressed'].includes(state)) {
            const g = state !== 'pressed' ? glow(r.size, state === 'hover' ? 50 : 70) : null;
            if (g != null) img.blit(g, [0, 0], null, pygame.BLEND_RGB_ADD);
            const inner = img.get_rect().inflate(-6, -6);
            pygame.draw.rect(img, state !== 'pressed' ? GOLD : GOLD_DK, inner, 1);
            if (state === 'on') pygame.draw.rect(img, GOLD_HI, img.get_rect(), 2);
        }
        if (image('skin/btn_base.png') == null) pygame.draw.rect(img, GOLD_DK, img.get_rect(), 2);
        _key_limit();
        _cache.set(key, img);
    }
    surf.blit(img, r.topleft);
}

/** A square stone cell for an icon (the command grid, queue, portrait). */
export function slot(surf, rect, state = 'normal') {
    const r = new pygame.Rect(rect);
    const key = py.tkey(['slot', r.size, state]);
    let s = _cache.get(key);
    if (s == null) {
        s = new pygame.Surface(r.size, pygame.SRCALPHA);
        s.blit(tiled('skin/stone_dark.png', r.size, [150, 142, 130]), [0, 0]);
        pygame.draw.rect(s, [14, 10, 6], s.get_rect(), 2);
        pygame.draw.rect(s, state !== 'hover' ? [96, 78, 50] : GOLD, s.get_rect().inflate(-2, -2), 1);
        _cache.set(key, s);
    }
    surf.blit(s, r.topleft);
}

/** An icon in a DE state (changes the already drawn icon on surf):
 *  'poor' - only resources are missing: the icon is filled red; 'disabled' - unavailable: grey;
 *  'pressed' - darker; 'hover' - brighter. */
export function icon_state(surf, rect, state) {
    const r = new pygame.Rect(rect).clip(surf.get_rect());
    if (r.w <= 0 || r.h <= 0) return;
    if (state === 'poor' || state === 'disabled') {
        const g = pygame.transform.grayscale(surf.subsurface(r).copy());
        if (state === 'poor') {
            g.fill([255, 70, 56], null, pygame.BLEND_RGB_MULT);
            g.fill([70, 0, 0], null, pygame.BLEND_RGB_ADD);
        } else {
            g.fill([150, 150, 150], null, pygame.BLEND_RGB_MULT);
        }
        surf.blit(g, r.topleft);
    } else if (state === 'pressed') {
        surf.fill([200, 200, 200], r, pygame.BLEND_RGB_MULT);
    } else if (state === 'hover' || state === 'on') {
        surf.fill([28, 26, 22], r, pygame.BLEND_RGB_ADD);
    }
}

/** A DE button icon frame: a thin light 1 px bevel, the icon fills the whole cell; states - icon_state. */
export function icon_frame(surf, rect, state = 'normal') {
    const r = new pygame.Rect(rect);
    icon_state(surf, r, state);
    const col = py.get({ 'hover': GOLD_HI, 'pressed': GOLD, 'on': GOLD_HI, 'poor': [200, 70, 60] }, state, [150, 138, 110]);
    pygame.draw.rect(surf, [6, 5, 4], r.inflate(2, 2), 1);
    pygame.draw.line(surf, col, r.topleft, [r.right - 1, r.top]);
    pygame.draw.line(surf, col, r.topleft, [r.left, r.bottom - 1]);
    const dk = col.map(c => py.floordiv(c, 3));
    pygame.draw.line(surf, dk, [r.left, r.bottom - 1], [r.right - 1, r.bottom - 1]);
    pygame.draw.line(surf, dk, [r.right - 1, r.top], [r.right - 1, r.bottom - 1]);
    if (state === 'hover') pygame.draw.rect(surf, GOLD_HI, r, 1);
}

// ============================================================ icons
export const RES_ICON = {
    'food': 'icons/food.png', 'wood': 'icons/wood.png', 'stone': 'icons/stone.png',
    'gold': 'icons/bribes.png', 'metal': 'icons/metal.png', 'pop': 'icons/population.png',
    'time': 'icons/time.png',
};

/** An icon from assets/ui/icons (or a 'dir/name.png' path), scaled; null - no file. */
export function icon(name, size) {
    const rel = py.get(RES_ICON, name, null) || (name.endsWith('.png') ? name : `icons/${name}.png`);
    const key = py.tkey(['icon', rel, size]);
    const got = _cache.get(key);
    if (got != null || _cache.has(key)) return got ?? null;
    const src = image(rel);
    let out = null;
    if (src != null) {
        const [w, h] = src.get_size();
        const k = size / Math.max(w, h);
        out = pygame.transform.smoothscale(src, [Math.max(1, py.round(w * k)), Math.max(1, py.round(h * k))]);
    }
    _cache.set(key, out);
    return out;
}

export function blit_icon(surf, name, center, size) {
    const ic = icon(name, size);
    if (ic == null) return false;
    surf.blit(ic, ic.get_rect({ center }));
    return true;
}

// ============================================================ portraits
export let _pfiles = null;

export function _portrait_index() {
    if (_pfiles == null) {
        _pfiles = new Set();
        const base = os.path.join(UI_DIR, 'portraits');
        for (const [dp, , fs] of assets.walk(base)) {
            const rel = os.path.relpath(dp, base).replaceAll('\\', '/');
            for (const f of fs) {
                if (f.endsWith('.png')) _pfiles.add(rel !== '.' ? `${rel}/${f.slice(0, -4)}` : f.slice(0, -4));
            }
        }
    }
    return _pfiles;
}

/** A civilization's architecture group (as in the building atlas). */
export function civ_group(civ) {
    return py.get(M.CIV_GROUP, civ, M.DEFAULT_GROUP);
}

/** The relative path of a portrait (without .png) or null. typ: 'u' | 'b' | 't' | 'n' | 'age'.
 *  Order: an icon by the DE dictionary (de/, scenic/, units3d/) -> a 0 A.D. portrait. */
export function portrait_path(typ, name, civ = null) {
    const idx = _portrait_index();
    const g = civ_group(civ);
    if (typ === 'u') {
        if (Object.hasOwn(M.GAIA_PORTRAITS, name)) {
            const p = M.GAIA_PORTRAITS[name];
            return idx.has(p) ? p : null;
        }
        const ug = py.get(M.UNIT_GROUP, g, g);
        for (const p of [`units3d/${name}.${ug}`, `units3d/${name}.${M.UNIT_GROUP[M.DEFAULT_GROUP]}`]) {
            if (idx.has(p)) return p;
        }
        const cands = py.get(M.UNIT_PORTRAITS, name, null);
        if (!py.bool(cands)) return null;
        const own = py.get(M.CIV_DIRS, civ, []);
        const dirs = own.concat(M.FALLBACK_DIRS.filter(d => !own.includes(d)));
        for (const c of cands) {            // first the best candidate in its own group, then - among all
            for (const d of own) {
                if (idx.has(`units/${d}/${c}`)) return `units/${d}/${c}`;
            }
        }
        for (const c of cands) {
            for (const d of dirs) {
                if (idx.has(`units/${d}/${c}`)) return `units/${d}/${c}`;
            }
        }
        return null;
    }
    let de = null;
    let p;
    if (typ === 'b') {
        if (Object.hasOwn(M.SCENIC_BUILDINGS, name)) {
            de = [`scenic/${g}/${M.SCENIC_BUILDINGS[name]}`, `scenic/${M.DEFAULT_GROUP}/${M.SCENIC_BUILDINGS[name]}`];
        } else if (Object.hasOwn(M.DE_BUILDINGS, name)) {
            de = [M.DE_BUILDINGS[name]];
        }
        p = py.get(M.BUILDING_PORTRAITS, name, null);
    } else if (typ === 't') {
        if (Object.hasOwn(M.SCENIC_TECHS, name)) {
            de = [`scenic/${g}/${M.SCENIC_TECHS[name]}`, `scenic/${M.DEFAULT_GROUP}/${M.SCENIC_TECHS[name]}`];
        } else if (Object.hasOwn(M.DE_TECHS, name)) {
            de = [M.DE_TECHS[name]];
        } else if (Object.hasOwn(_unique_age(), name)) {
            de = [M.CROWN.get(_unique_age()[name])];
        }
        p = py.get(M.TECH_PORTRAITS, name, null);
    } else if (typ === 'n') {
        p = py.get(M.GAIA_PORTRAITS, name, null);
    } else if (typ === 'age') {
        de = [M.AGE_PORTRAITS[name]];
        p = M.AGE_PORTRAITS_0AD[name];
    } else {
        p = null;
    }
    for (const q of de || []) {
        if (idx.has(q)) return q;
    }
    return p != null && idx.has(p) ? p : null;
}

export let _uniq = null;

/** Civilizations' unique techs (not unit upgrades) -> age (2 - castle, 3 - imperial). */
export function _unique_age() {
    if (_uniq == null) {
        const { TECHS } = modules.data;
        _uniq = {};
        for (const [k, t] of Object.entries(TECHS)) {
            if (py.bool(py.get(t, 'civ', null)) && !py.bool(py.get(t, 'upgrade', null)))
                _uniq[k] = Math.max(2, Math.min(3, py.get(t, 'age', 2)));
        }
    }
    return _uniq;
}

/** A size x size portrait (rounded corners are not needed - the button draws the frame) or null. */
export function portrait(typ, name, civ = null, size = 64, upgrade_of = null) {
    const key = py.tkey(['portrait', typ, name, civ, size]);
    if (_cache.has(key)) return _cache.get(key);
    let out = null;
    if (typ === 't' && upgrade_of) {
        const base = portrait('u', upgrade_of, civ, size);       // DE: an upgrade - a portrait of the new unit, without an arrow
        if (base != null) out = base.copy();
    } else {
        const p = portrait_path(typ, name, civ);
        const src = p ? image(`portraits/${p}.png`) : null;
        if (src != null) out = pygame.transform.smoothscale(src, [size, size]);
    }
    _cache.set(key, out);
    return out;
}

// ============================================================ cursors
// States (hud.cursor_kind / controls.order_mode) -> files assets/ui/cursors. The base is 0 A.D.; the action cursors
// in the DE style (de_*, tools/ui_icon_art.py): one object without an arrow, the working end = the aim point (1, 1).
export const CURSOR_FILES = {
    'arrow': 'arrow-default-down', 'attack': 'action-attack', 'amove': 'action-attack-move',
    'build': 'action-build', 'repair': 'action-repair', 'garrison': 'action-garrison',
    'patrol': 'action-patrol', 'guard': 'action-guard', 'follow': 'action-patrol', 'aground': 'action-target',
    'trade': 'action-setup-trade-route', 'board': 'action-garrison', 'unload': 'action-unload',
    'flare': 'cursor-flare', 'rally': 'cursor-rally', 'no': 'cursor-no',
    'tree': 'action-gather-tree', 'stone': 'action-gather-rock', 'gold': 'action-gather-ore',
    'berries': 'action-gather-fruit', 'farm': 'action-gather-grain', 'meat': 'action-gather-meat',
    'fish': 'action-gather-fish', 'drop': 'action-return-food', 'heal': 'action-heal',
};
for (const _k of ['tree', 'gold', 'stone', 'berries', 'farm', 'meat', 'fish', 'drop', 'heal', 'repair', 'attack', 'amove',
    'flare', 'rally', 'board', 'unload', 'follow']) {
    if (os.path.exists(os.path.join(UI_DIR, 'cursors', `de_${_k}.png`))) CURSOR_FILES[_k] = `de_${_k}`;
}

/** The window's screen scale (Retina - 2.0): in the browser - devicePixelRatio; 1.0 if it cannot be determined. */
export function backing_scale() {
    try {
        const k = Number(pygame.display.get_backing_scale());
        if (k > 0) return k;
    } catch (e) {
        // fall through
    }
    return 1.0;
}

/** 0 A.D./DE cursors. The system cursor (a CSS cursor in the browser) is 32 points; the software one (soft) is drawn at
 *  the end of the frame on the game's surface - in the same pixel grid as the world, with the aim point under our control. */
export class Cursors {
    constructor() {
        this.enabled = true;
        this.soft = false;               // software cursor (settings 'cursor_soft'; None - auto by Retina)
        this.cur = null;
        this.cache = new Map();          // name -> pygame.cursors.Cursor (system)
        this.imgs = new Map();           // name -> [surface, hx, hy] (software)
        this._sys_visible = true;
        try {
            this.hot = assets.read_json(os.path.join(UI_DIR, 'cursors', 'hotspots.json'));
        } catch (e) {
            this.hot = null;
        }
    }

    /** [a 32 px surface, hx, hy] of a cursor or null. */
    load(name) {
        if (this.imgs.has(name)) return this.imgs.get(name);
        let rec = null;
        const fn = py.get(CURSOR_FILES, name, null);
        let img = (fn && this.hot != null) ? image(`cursors/${fn}.png`) : null;
        if (img != null) {
            let [hx, hy] = py.get(this.hot, fn, [1, 1]);
            if (img.get_width() > 32) {
                const k = 32 / img.get_width();
                img = pygame.transform.smoothscale(img, [32, py.round(img.get_height() * k)]);
                hx = _int(hx * k);
                hy = _int(hy * k);
            }
            rec = [img, hx, hy];
        }
        this.imgs.set(name, rec);
        return rec;
    }

    get(name) {
        if (this.cache.has(name)) return this.cache.get(name);
        let c = null;
        const rec = this.load(name);
        if (rec != null) {
            const [img, hx, hy] = rec;
            try {
                c = new pygame.cursors.Cursor([hx, hy], img);
            } catch (e) {
                c = null;
            }
        }
        this.cache.set(name, c);
        return c;
    }

    set(name) {
        if (!this.enabled) name = null;
        if (name === this.cur || (name == null && this.cur == null)) return;
        this.cur = name;
        if (this.soft && name != null) return;      // we draw it ourselves (draw); the system one is hidden there
        try {
            if (name == null) {
                pygame.mouse.set_cursor(pygame.SYSTEM_CURSOR_ARROW);
                return;
            }
            const c = this.get(name) || this.get('arrow');
            if (c != null) pygame.mouse.set_cursor(c);
        } catch (e) {
            if (!(e instanceof pygame.error)) throw e;
            this.enabled = false;
        }
    }

    _show_sys(v) {
        if (v !== this._sys_visible) {
            try {
                pygame.mouse.set_visible(v);
            } catch (e) {
                if (!(e instanceof pygame.error)) throw e;
            }
            this._sys_visible = v;
        }
    }

    /** The software cursor: at the end of the frame by the current mouse position minus the aim point.
     *  Outside the window (and when the mode is off) - the system cursor. */
    draw(scr) {
        if (!(this.soft && this.enabled && this.cur != null)) {
            this._show_sys(true);
            return;
        }
        const focused = pygame.mouse.get_focused();
        this._show_sys(!focused);
        if (!focused) return;
        const rec = this.load(this.cur) || this.load('arrow');
        if (rec == null) {
            this._show_sys(true);
            return;
        }
        const [img, hx, hy] = rec;
        const [mx, my] = pygame.mouse.get_pos();
        scr.blit(img, [mx - hx, my - hy]);
    }

    /** Turn the software cursor on/off; the system one is reinstalled on the next frame. */
    set_soft(v) {
        this.soft = py.bool(v);
        this.cur = '?';
        this.imgs.clear();
    }
}
