// pygame-ce compatible API on Canvas 2D + Web Audio + DOM events (the subset game/*.py uses; see PORTING.md).
// Usage in ported modules:   import * as pygame from '../runtime/pygame.js';
// Signatures follow pygame positionally (PORTING.md kwargs rule): blit(source, dest, area=null, special_flags=0),
// fill(color, rect=null, special_flags=0), draw.rect(surface, color, rect, width=0, border_radius=0, ...),
// get_rect(kw) takes the **kwargs object: surf.get_rect({center: [x, y]}).
// Colors are arrays [r, g, b] / [r, g, b, a]; positions/sizes are arrays [x, y] or Rects.
import * as assets from './assets.js';
import * as storage from './storage.js';
import * as np from './np.js';
import { RuntimeError } from './py.js';

// ============================================================ constants
export class error extends RuntimeError {}
export const SRCALPHA = 0x00010000, SWSURFACE = 0, HWSURFACE = 1, ASYNCBLIT = 4, RLEACCEL = 0x4000, PREALLOC = 0x01000000;
export const FULLSCREEN = -2147483648, DOUBLEBUF = 0x40000000, RESIZABLE = 16, NOFRAME = 32, SCALED = 512, OPENGL = 2, SHOWN = 64, HIDDEN = 128;
export const BLEND_ADD = 1, BLEND_RGB_ADD = 1, BLEND_SUB = 2, BLEND_RGB_SUB = 2, BLEND_MULT = 3, BLEND_RGB_MULT = 3,
    BLEND_MIN = 4, BLEND_RGB_MIN = 4, BLEND_MAX = 5, BLEND_RGB_MAX = 5, BLEND_RGBA_ADD = 6, BLEND_RGBA_SUB = 7,
    BLEND_RGBA_MULT = 8, BLEND_RGBA_MIN = 9, BLEND_RGBA_MAX = 16, BLEND_PREMULTIPLIED = 17, BLEND_ALPHA_SDL2 = 18;
export const NOEVENT = 0, QUIT = 256, ACTIVEEVENT = 32768, KEYDOWN = 768, KEYUP = 769, TEXTEDITING = 770, TEXTINPUT = 771,
    MOUSEMOTION = 1024, MOUSEBUTTONDOWN = 1025, MOUSEBUTTONUP = 1026, MOUSEWHEEL = 1027, VIDEORESIZE = 32769,
    VIDEOEXPOSE = 32770, WINDOWFOCUSGAINED = 32780, WINDOWFOCUSLOST = 32781, WINDOWENTER = 32776, WINDOWLEAVE = 32777,
    USEREVENT = 32866, WINDOWSHOWN = 32769 + 1000, WINDOWHIDDEN = 32769 + 1001;
export const BUTTON_LEFT = 1, BUTTON_MIDDLE = 2, BUTTON_RIGHT = 3, BUTTON_WHEELUP = 4, BUTTON_WHEELDOWN = 5, BUTTON_X1 = 6, BUTTON_X2 = 7;
export const KMOD_NONE = 0, KMOD_LSHIFT = 1, KMOD_RSHIFT = 2, KMOD_SHIFT = 3, KMOD_LCTRL = 0x40, KMOD_RCTRL = 0x80, KMOD_CTRL = 0xC0,
    KMOD_LALT = 0x100, KMOD_RALT = 0x200, KMOD_ALT = 0x300, KMOD_LGUI = 0x400, KMOD_RGUI = 0x800, KMOD_GUI = 0xC00,
    KMOD_LMETA = 0x400, KMOD_RMETA = 0x800, KMOD_META = 0xC00, KMOD_NUM = 0x1000, KMOD_CAPS = 0x2000, KMOD_MODE = 0x4000;
export const SYSTEM_CURSOR_ARROW = 0, SYSTEM_CURSOR_IBEAM = 1, SYSTEM_CURSOR_WAIT = 2, SYSTEM_CURSOR_CROSSHAIR = 3,
    SYSTEM_CURSOR_WAITARROW = 4, SYSTEM_CURSOR_SIZENWSE = 5, SYSTEM_CURSOR_SIZENESW = 6, SYSTEM_CURSOR_SIZEWE = 7,
    SYSTEM_CURSOR_SIZENS = 8, SYSTEM_CURSOR_SIZEALL = 9, SYSTEM_CURSOR_NO = 10, SYSTEM_CURSOR_HAND = 11;

// SDL2 keycodes (pygame 2 K_* values)
const SC = n => (n | 0x40000000) >>> 0;
const KEYS = {
    K_UNKNOWN: 0, K_BACKSPACE: 8, K_TAB: 9, K_CLEAR: SC(156), K_RETURN: 13, K_PAUSE: SC(72), K_ESCAPE: 27, K_SPACE: 32,
    K_EXCLAIM: 33, K_QUOTEDBL: 34, K_HASH: 35, K_DOLLAR: 36, K_PERCENT: 37, K_AMPERSAND: 38, K_QUOTE: 39,
    K_LEFTPAREN: 40, K_RIGHTPAREN: 41, K_ASTERISK: 42, K_PLUS: 43, K_COMMA: 44, K_MINUS: 45, K_PERIOD: 46, K_SLASH: 47,
    K_COLON: 58, K_SEMICOLON: 59, K_LESS: 60, K_EQUALS: 61, K_GREATER: 62, K_QUESTION: 63, K_AT: 64,
    K_LEFTBRACKET: 91, K_BACKSLASH: 92, K_RIGHTBRACKET: 93, K_CARET: 94, K_UNDERSCORE: 95, K_BACKQUOTE: 96,
    K_DELETE: 127, K_CAPSLOCK: SC(57), K_PRINTSCREEN: SC(70), K_SCROLLLOCK: SC(71), K_INSERT: SC(73), K_HOME: SC(74),
    K_PAGEUP: SC(75), K_END: SC(77), K_PAGEDOWN: SC(78), K_RIGHT: SC(79), K_LEFT: SC(80), K_DOWN: SC(81), K_UP: SC(82),
    K_NUMLOCK: SC(83), K_NUMLOCKCLEAR: SC(83), K_KP_DIVIDE: SC(84), K_KP_MULTIPLY: SC(85), K_KP_MINUS: SC(86),
    K_KP_PLUS: SC(87), K_KP_ENTER: SC(88), K_KP1: SC(89), K_KP2: SC(90), K_KP3: SC(91), K_KP4: SC(92), K_KP5: SC(93),
    K_KP6: SC(94), K_KP7: SC(95), K_KP8: SC(96), K_KP9: SC(97), K_KP0: SC(98), K_KP_PERIOD: SC(99), K_KP_EQUALS: SC(103),
    K_MENU: SC(118), K_POWER: SC(102), K_HELP: SC(117), K_SYSREQ: SC(154),
    K_LCTRL: SC(224), K_LSHIFT: SC(225), K_LALT: SC(226), K_LGUI: SC(227), K_LMETA: SC(227), K_LSUPER: SC(227),
    K_RCTRL: SC(228), K_RSHIFT: SC(229), K_RALT: SC(230), K_RGUI: SC(231), K_RMETA: SC(231), K_RSUPER: SC(231), K_MODE: SC(257),
};
for (let i = 0; i < 10; i++) { KEYS['K_' + i] = 48 + i; KEYS['K_KP_' + i] = KEYS['K_KP' + i]; }
for (let i = 0; i < 26; i++) KEYS['K_' + String.fromCharCode(97 + i)] = 97 + i;
for (let i = 1; i <= 12; i++) KEYS['K_F' + i] = SC(57 + i);
for (let i = 13; i <= 15; i++) KEYS['K_F' + i] = SC(91 + i);
export const {
    K_UNKNOWN, K_BACKSPACE, K_TAB, K_CLEAR, K_RETURN, K_PAUSE, K_ESCAPE, K_SPACE, K_EXCLAIM, K_QUOTEDBL, K_HASH, K_DOLLAR,
    K_PERCENT, K_AMPERSAND, K_QUOTE, K_LEFTPAREN, K_RIGHTPAREN, K_ASTERISK, K_PLUS, K_COMMA, K_MINUS, K_PERIOD, K_SLASH,
    K_COLON, K_SEMICOLON, K_LESS, K_EQUALS, K_GREATER, K_QUESTION, K_AT, K_LEFTBRACKET, K_BACKSLASH, K_RIGHTBRACKET,
    K_CARET, K_UNDERSCORE, K_BACKQUOTE, K_DELETE, K_CAPSLOCK, K_PRINTSCREEN, K_SCROLLLOCK, K_INSERT, K_HOME, K_PAGEUP,
    K_END, K_PAGEDOWN, K_RIGHT, K_LEFT, K_DOWN, K_UP, K_NUMLOCK, K_NUMLOCKCLEAR, K_KP_DIVIDE, K_KP_MULTIPLY, K_KP_MINUS,
    K_KP_PLUS, K_KP_ENTER, K_KP1, K_KP2, K_KP3, K_KP4, K_KP5, K_KP6, K_KP7, K_KP8, K_KP9, K_KP0, K_KP_PERIOD,
    K_KP_EQUALS, K_MENU, K_POWER, K_HELP, K_SYSREQ, K_LCTRL, K_LSHIFT, K_LALT, K_LGUI, K_LMETA, K_LSUPER, K_RCTRL,
    K_RSHIFT, K_RALT, K_RGUI, K_RMETA, K_RSUPER, K_MODE,
    K_0, K_1, K_2, K_3, K_4, K_5, K_6, K_7, K_8, K_9, K_KP_0, K_KP_1, K_KP_2, K_KP_3, K_KP_4, K_KP_5, K_KP_6, K_KP_7, K_KP_8, K_KP_9,
    K_a, K_b, K_c, K_d, K_e, K_f, K_g, K_h, K_i, K_j, K_k, K_l, K_m, K_n, K_o, K_p, K_q, K_r, K_s, K_t, K_u, K_v, K_w, K_x, K_y, K_z,
    K_F1, K_F2, K_F3, K_F4, K_F5, K_F6, K_F7, K_F8, K_F9, K_F10, K_F11, K_F12, K_F13, K_F14, K_F15,
} = KEYS;

// ============================================================ helpers
const _t = Math.trunc;
function _num(v) { const n = +v; return Number.isFinite(n) ? n : 0; }
function _pair(p) {
    if (p == null) return [0, 0];
    if (p instanceof Rect) return [p.x, p.y];
    if (typeof p.x === 'number' && !Array.isArray(p)) return [p.x, p.y];
    return [p[0], p[1]];
}
function _isKw(o) { return o != null && typeof o === 'object' && !Array.isArray(o) && !(o instanceof Rect) && !ArrayBuffer.isView(o) && Object.getPrototypeOf(o) === Object.prototype; }
function _rgba(c) {
    if (c == null) throw new error('invalid color argument');
    if (typeof c === 'number') return [(c >>> 16) & 255, (c >>> 8) & 255, c & 255, 255];
    if (typeof c === 'string') return Color(c);
    const r = c[0] | 0, g = c[1] | 0, b = c[2] | 0, a = c.length > 3 && c[3] != null ? c[3] | 0 : 255;
    return [r < 0 ? 0 : r > 255 ? 255 : r, g < 0 ? 0 : g > 255 ? 255 : g, b < 0 ? 0 : b > 255 ? 255 : b, a < 0 ? 0 : a > 255 ? 255 : a];
}
const _cssCache = new Map();
function _css(r, g, b, a) {
    const key = ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
    let s = _cssCache.get(key);
    if (s === undefined) {
        s = a === 255 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a / 255})`;
        if (_cssCache.size > 4096) _cssCache.clear();
        _cssCache.set(key, s);
    }
    return s;
}
const _HAS_OFFSCREEN = typeof OffscreenCanvas !== 'undefined';
function _mkcanvas(w, h) {
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    if (_HAS_OFFSCREEN) return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
}
function _ctx(cv, opaque) {
    const ctx = cv.getContext('2d', { alpha: !opaque });
    ctx.imageSmoothingEnabled = false;
    return ctx;
}
let _scratch = null, _scratchCtx = null;
function _scratch2d(w, h) {
    if (!_scratch || _scratch.width < w || _scratch.height < h) {
        _scratch = _mkcanvas(Math.max(w, _scratch ? _scratch.width : 1), Math.max(h, _scratch ? _scratch.height : 1));
        _scratchCtx = _scratch.getContext('2d', { willReadFrequently: true });
    }
    _scratchCtx.clearRect(0, 0, w, h);
    return _scratchCtx;
}

// ============================================================ Color / Vector2
const NAMED = { black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255],
    yellow: [255, 255, 0], gray: [190, 190, 190], grey: [190, 190, 190], orange: [255, 165, 0], purple: [160, 32, 240],
    cyan: [0, 255, 255], magenta: [255, 0, 255], darkgray: [169, 169, 169], lightgray: [211, 211, 211] };
/** pygame.Color(...) -> a plain [r, g, b, a] array. */
export function Color(r, g, b, a = 255) {
    if (typeof r === 'string') {
        const s = r.trim().toLowerCase();
        if (s.startsWith('#') || s.startsWith('0x')) {
            const h = s.replace(/^#|^0x/, '');
            const v = parseInt(h, 16);
            return h.length > 6 ? [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255] : [(v >>> 16) & 255, (v >>> 8) & 255, v & 255, 255];
        }
        const n = NAMED[s.replace(/\s/g, '')];
        if (!n) throw new ValueError_('invalid color name');
        return [...n, 255];
    }
    if (Array.isArray(r)) return _rgba(r);
    if (g === undefined) return [(r >>> 16) & 255, (r >>> 8) & 255, r & 255, 255];
    return [r | 0, g | 0, b | 0, a | 0];
}
class ValueError_ extends Error {}

export class Vector2 {
    constructor(x = 0, y = undefined) {
        if (y === undefined) {
            if (typeof x === 'number') { this.x = x; this.y = x; } else { const p = _pair(x); this.x = +p[0]; this.y = +p[1]; }
        } else { this.x = +x; this.y = +y; }
    }
    get 0() { return this.x; } get 1() { return this.y; }
    *[Symbol.iterator]() { yield this.x; yield this.y; }
    copy() { return new Vector2(this.x, this.y); }
    add(o) { const p = _pair(o); return new Vector2(this.x + p[0], this.y + p[1]); }
    sub(o) { const p = _pair(o); return new Vector2(this.x - p[0], this.y - p[1]); }
    mul(k) { if (typeof k === 'number') return new Vector2(this.x * k, this.y * k); const p = _pair(k); return this.x * p[0] + this.y * p[1]; }
    div(k) { return new Vector2(this.x / k, this.y / k); }
    neg() { return new Vector2(-this.x, -this.y); }
    dot(o) { const p = _pair(o); return this.x * p[0] + this.y * p[1]; }
    cross(o) { const p = _pair(o); return this.x * p[1] - this.y * p[0]; }
    length() { return Math.sqrt(this.x * this.x + this.y * this.y); }
    magnitude() { return this.length(); }
    length_squared() { return this.x * this.x + this.y * this.y; }
    magnitude_squared() { return this.length_squared(); }
    normalize() { const l = this.length(); if (!l) throw new ValueError_("Can't normalize Vector of length Zero"); return new Vector2(this.x / l, this.y / l); }
    normalize_ip() { const v = this.normalize(); this.x = v.x; this.y = v.y; }
    scale_to_length(l) { const k = l / this.length(); this.x *= k; this.y *= k; }
    distance_to(o) { const p = _pair(o); return Math.hypot(this.x - p[0], this.y - p[1]); }
    distance_squared_to(o) { const p = _pair(o); const dx = this.x - p[0], dy = this.y - p[1]; return dx * dx + dy * dy; }
    rotate(deg) {
        const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
        // exact quarter turns like pygame
        const q = ((deg % 360) + 360) % 360;
        if (q === 90) return new Vector2(-this.y, this.x);
        if (q === 180) return new Vector2(-this.x, -this.y);
        if (q === 270) return new Vector2(this.y, -this.x);
        if (q === 0) return new Vector2(this.x, this.y);
        return new Vector2(this.x * c - this.y * s, this.x * s + this.y * c);
    }
    rotate_ip(deg) { const v = this.rotate(deg); this.x = v.x; this.y = v.y; }
    angle_to(o) { const p = _pair(o); return (Math.atan2(p[1], p[0]) - Math.atan2(this.y, this.x)) * 180 / Math.PI; }
    as_polar() { return [this.length(), Math.atan2(this.y, this.x) * 180 / Math.PI]; }
    lerp(o, t) { const p = _pair(o); return new Vector2(this.x + (p[0] - this.x) * t, this.y + (p[1] - this.y) * t); }
    __eq__(o) { if (o == null) return false; const p = _pair(o); return this.x === p[0] && this.y === p[1]; }
    toString() { return `Vector2(${this.x}, ${this.y})`; }
}
export const math = { Vector2 };

// ============================================================ Rect
export class Rect {
    constructor(a = 0, b, c, d) {
        if (b === undefined) {
            if (a instanceof Rect) { this.x = a.x; this.y = a.y; this.w = a.w; this.h = a.h; return; }
            if (a != null && !Array.isArray(a) && a.rect !== undefined) { const r = typeof a.rect === 'function' ? a.rect() : a.rect; return new Rect(r); }
            if (Array.isArray(a) || ArrayBuffer.isView(a)) {
                if (a.length === 4) { this.x = _t(_num(a[0])); this.y = _t(_num(a[1])); this.w = _t(_num(a[2])); this.h = _t(_num(a[3])); return; }
                if (a.length === 2) { const p = _pair(a[0]), s = _pair(a[1]); this.x = _t(_num(p[0])); this.y = _t(_num(p[1])); this.w = _t(_num(s[0])); this.h = _t(_num(s[1])); return; }
            }
            throw new TypeError('Argument must be rect style object');
        }
        if (c === undefined) { const p = _pair(a), s = _pair(b); this.x = _t(_num(p[0])); this.y = _t(_num(p[1])); this.w = _t(_num(s[0])); this.h = _t(_num(s[1])); return; }
        this.x = _t(_num(a)); this.y = _t(_num(b)); this.w = _t(_num(c)); this.h = _t(_num(d));
    }
    // ---- virtual attributes (setters truncate like pygame)
    get left() { return this.x; } set left(v) { this.x = _t(v); }
    get top() { return this.y; } set top(v) { this.y = _t(v); }
    get width() { return this.w; } set width(v) { this.w = _t(v); }
    get height() { return this.h; } set height(v) { this.h = _t(v); }
    get right() { return this.x + this.w; } set right(v) { this.x = _t(v) - this.w; }
    get bottom() { return this.y + this.h; } set bottom(v) { this.y = _t(v) - this.h; }
    get centerx() { return this.x + _t(this.w / 2); } set centerx(v) { this.x = _t(v) - _t(this.w / 2); }
    get centery() { return this.y + _t(this.h / 2); } set centery(v) { this.y = _t(v) - _t(this.h / 2); }
    get center() { return [this.centerx, this.centery]; } set center(p) { this.centerx = p[0]; this.centery = p[1]; }
    get topleft() { return [this.x, this.y]; } set topleft(p) { this.x = _t(p[0]); this.y = _t(p[1]); }
    get topright() { return [this.right, this.y]; } set topright(p) { this.right = p[0]; this.y = _t(p[1]); }
    get bottomleft() { return [this.x, this.bottom]; } set bottomleft(p) { this.x = _t(p[0]); this.bottom = p[1]; }
    get bottomright() { return [this.right, this.bottom]; } set bottomright(p) { this.right = p[0]; this.bottom = p[1]; }
    get midtop() { return [this.centerx, this.y]; } set midtop(p) { this.centerx = p[0]; this.y = _t(p[1]); }
    get midbottom() { return [this.centerx, this.bottom]; } set midbottom(p) { this.centerx = p[0]; this.bottom = p[1]; }
    get midleft() { return [this.x, this.centery]; } set midleft(p) { this.x = _t(p[0]); this.centery = p[1]; }
    get midright() { return [this.right, this.centery]; } set midright(p) { this.right = p[0]; this.centery = p[1]; }
    get size() { return [this.w, this.h]; } set size(p) { this.w = _t(p[0]); this.h = _t(p[1]); }
    get 0() { return this.x; } set 0(v) { this.x = _t(v); }
    get 1() { return this.y; } set 1(v) { this.y = _t(v); }
    get 2() { return this.w; } set 2(v) { this.w = _t(v); }
    get 3() { return this.h; } set 3(v) { this.h = _t(v); }
    get length() { return 4; }
    *[Symbol.iterator]() { yield this.x; yield this.y; yield this.w; yield this.h; }
    __len__() { return 4; }
    __bool__() { return this.w !== 0 && this.h !== 0; }
    __eq__(o) { if (o == null) return false; try { const r = o instanceof Rect ? o : new Rect(o); return r.x === this.x && r.y === this.y && r.w === this.w && r.h === this.h; } catch { return false; } }
    toString() { return `<rect(${this.x}, ${this.y}, ${this.w}, ${this.h})>`; }
    __repr__() { return this.toString(); }
    // ---- methods
    copy() { return new Rect(this.x, this.y, this.w, this.h); }
    update(...a) { const r = new Rect(...a); this.x = r.x; this.y = r.y; this.w = r.w; this.h = r.h; }
    move(x, y) { if (y === undefined) [x, y] = _pair(x); return new Rect(this.x + _t(x), this.y + _t(y), this.w, this.h); }
    move_ip(x, y) { if (y === undefined) [x, y] = _pair(x); this.x += _t(x); this.y += _t(y); }
    inflate(x, y) { if (y === undefined) [x, y] = _pair(x); x = _t(x); y = _t(y); return new Rect(this.x - _t(x / 2), this.y - _t(y / 2), this.w + x, this.h + y); }
    inflate_ip(x, y) { const r = this.inflate(x, y); this.x = r.x; this.y = r.y; this.w = r.w; this.h = r.h; }
    scale_by(x, y = null) {
        if (y == null) { if (typeof x === 'number') y = x; else [x, y] = _pair(x); }
        const nw = _t(this.w * x), nh = _t(this.h * y);
        return new Rect(this.x + _t((this.w - nw) / 2), this.y + _t((this.h - nh) / 2), nw, nh);
    }
    scale_by_ip(x, y = null) { const r = this.scale_by(x, y); this.update(r); }
    clamp(r) {
        r = _R(r);
        let x, y;
        if (this.w >= r.w) x = r.x + _t(r.w / 2) - _t(this.w / 2);
        else if (this.x < r.x) x = r.x;
        else if (this.x + this.w > r.x + r.w) x = r.x + r.w - this.w;
        else x = this.x;
        if (this.h >= r.h) y = r.y + _t(r.h / 2) - _t(this.h / 2);
        else if (this.y < r.y) y = r.y;
        else if (this.y + this.h > r.y + r.h) y = r.y + r.h - this.h;
        else y = this.y;
        return new Rect(x, y, this.w, this.h);
    }
    clamp_ip(r) { const c = this.clamp(r); this.x = c.x; this.y = c.y; }
    clip(r, ...rest) {
        if (rest.length) r = new Rect(r, ...rest);
        const A = this, B = _R(r);
        let x, y, w, h;
        if (A.x >= B.x && A.x < B.x + B.w) x = A.x;
        else if (B.x >= A.x && B.x < A.x + A.w) x = B.x;
        else return new Rect(A.x, A.y, 0, 0);
        if (A.x + A.w > B.x && A.x + A.w <= B.x + B.w) w = A.x + A.w - x;
        else if (B.x + B.w > A.x && B.x + B.w <= A.x + A.w) w = B.x + B.w - x;
        else return new Rect(A.x, A.y, 0, 0);
        if (A.y >= B.y && A.y < B.y + B.h) y = A.y;
        else if (B.y >= A.y && B.y < A.y + A.h) y = B.y;
        else return new Rect(A.x, A.y, 0, 0);
        if (A.y + A.h > B.y && A.y + A.h <= B.y + B.h) h = A.y + A.h - y;
        else if (B.y + B.h > A.y && B.y + B.h <= A.y + A.h) h = B.y + B.h - y;
        else return new Rect(A.x, A.y, 0, 0);
        return new Rect(x, y, w, h);
    }
    clip_ip(r) { this.update(this.clip(r)); }
    union(r) {
        r = _R(r);
        const x = Math.min(this.x, r.x), y = Math.min(this.y, r.y);
        return new Rect(x, y, Math.max(this.x + this.w, r.x + r.w) - x, Math.max(this.y + this.h, r.y + r.h) - y);
    }
    union_ip(r) { this.update(this.union(r)); }
    unionall(list) { let u = this.copy(); for (const r of list) u = u.union(r); return u; }
    unionall_ip(list) { this.update(this.unionall(list)); }
    fit(r) {
        r = _R(r);
        const ratio = Math.max(this.w / r.w, this.h / r.h);
        const w = _t(this.w / ratio), h = _t(this.h / ratio);
        return new Rect(r.x + _t((r.w - w) / 2), r.y + _t((r.h - h) / 2), w, h);
    }
    normalize() {
        if (this.w < 0) { this.x += this.w; this.w = -this.w; }
        if (this.h < 0) { this.y += this.h; this.h = -this.h; }
    }
    contains(r, ...rest) {
        if (rest.length) r = new Rect(r, ...rest);
        r = _R(r);
        return this.x <= r.x && this.y <= r.y && this.x + this.w >= r.x + r.w && this.y + this.h >= r.y + r.h
            && this.x + this.w > r.x && this.y + this.h > r.y;
    }
    collidepoint(x, y) {
        if (y === undefined) [x, y] = _pair(x);
        return x >= this.x && x < this.x + this.w && y >= this.y && y < this.y + this.h;
    }
    colliderect(r, ...rest) {
        if (rest.length) r = new Rect(r, ...rest);
        const A = this, B = _R(r);
        if (A.w === 0 || A.h === 0 || B.w === 0 || B.h === 0) return false;
        return Math.min(A.x, A.x + A.w) < Math.max(B.x, B.x + B.w) && Math.min(A.y, A.y + A.h) < Math.max(B.y, B.y + B.h)
            && Math.max(A.x, A.x + A.w) > Math.min(B.x, B.x + B.w) && Math.max(A.y, A.y + A.h) > Math.min(B.y, B.y + B.h);
    }
    collidelist(list) { for (let i = 0; i < list.length; i++) if (this.colliderect(list[i])) return i; return -1; }
    collidelistall(list) { const out = []; for (let i = 0; i < list.length; i++) if (this.colliderect(list[i])) out.push(i); return out; }
    collideobjects(list, key = null) { for (const o of list) if (this.colliderect(key ? key(o) : o)) return o; return null; }
    collideobjectsall(list, key = null) { return list.filter(o => this.colliderect(key ? key(o) : o)); }
}
function _R(r) { return r instanceof Rect ? r : new Rect(r); }
export const FRect = Rect;

// ============================================================ Surface
let _screen = null;
/**
 * A pygame Surface backed by a canvas (or, until first written, by a decoded ImageBitmap).
 * Subsurfaces share the root's pixels (writes go to the parent) with an offset.
 * Per-pixel access (get_at/set_at/surfarray) uses a cached ImageData that is flushed before the next canvas op.
 */
export class Surface {
    constructor(size, flags = 0, depth = 0, masks = null) {
        if (_isKw(flags)) flags = flags.flags || 0;
        const [w, h] = _pair(size);
        const W = _t(_num(w)), H = _t(_num(h));
        if (W < 0 || H < 0) throw new error('Invalid resolution for Surface');
        this._w = W; this._h = H;
        this._flags = flags & SRCALPHA;
        this._root = this; this._ox = 0; this._oy = 0; this._parent = null;
        this._alpha = null; this._colorkey = null; this._clip = null;
        this._cv = null; this._c = null; this._bmp = null; this._px = null; this._pxDirty = false; this._ver = 0; this._keyed = null;
        this._reads = 0; this._wrf = false;
        this._fillc = null;
        if (!(flags & PREALLOC)) { this._materialize(); this._fillc = this._opaque ? [0, 0, 0, 255] : [0, 0, 0, 0]; }
    }
    static _fromDrawable(src, w, h, alpha) {
        const s = new Surface([w, h], (alpha ? SRCALPHA : 0) | PREALLOC);
        s._bmp = src;
        return s;
    }
    get _opaque() { return !(this._flags & SRCALPHA); }
    _materialize() {
        const R = this._root;
        if (R._cv) return;
        R._cv = _mkcanvas(R._w, R._h);
        R._c = _ctx(R._cv, R._opaque);
        if (R._bmp) { R._c.drawImage(R._bmp, 0, 0); R._bmp = null; }
    }
    /** Push pending per-pixel writes to the canvas. */
    _flush() {
        const R = this._root;
        if (R._pxDirty) {
            if (!R._cv) { R._cv = _mkcanvas(R._w, R._h); R._c = _ctx(R._cv, R._opaque); R._bmp = null; }
            R._c.putImageData(R._px, 0, 0);
            R._pxDirty = false;
        }
    }
    /** Before a canvas write: returns the root 2d context. Call _wrote() after. */
    _wctx() {
        const R = this._root;
        R._flush();
        if (!R._cv) R._materialize();
        return R._c;
    }
    _wrote() { const R = this._root; R._px = null; R._fillc = null; R._ver++; }
    /** ImageData of the uniform color the whole root was last filled with (no canvas read-back). */
    _fillImage(w, h) {
        const c = this._root._fillc, img = new ImageData(Math.max(1, w), Math.max(1, h)), d = img.data;
        if (c[0] || c[1] || c[2] || c[3]) for (let i = 0; i < d.length; i += 4) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3]; }
        return img;
    }
    /** A drawable (canvas or bitmap) with the root's current pixels. */
    _src() {
        const R = this._root;
        R._flush();
        return R._cv || R._bmp;
    }
    /** A canvas read back more than once becomes a willReadFrequently (CPU) canvas - what Chrome recommends. */
    _noteRead() {
        const R = this._root;
        if (R._wrf || R === _screen || !R._cv) return;
        if (++R._reads < 2) return;
        const cv = _mkcanvas(R._w, R._h);
        const c = cv.getContext('2d', { alpha: !R._opaque, willReadFrequently: true });
        c.imageSmoothingEnabled = false;
        c.drawImage(R._cv, 0, 0);
        R._cv = cv; R._c = c; R._wrf = true;
    }
    /** Root ImageData (cached). Callers that write must set root._pxDirty = true and root._ver++. */
    _pixels() {
        const R = this._root;
        if (!R._px) {
            if (R._fillc) { R._px = R._fillImage(R._w, R._h); return R._px; }
            this._noteRead();
            if (R._cv) R._px = R._c.getImageData(0, 0, R._w || 1, R._h || 1);
            else if (R._bmp) { const c = _scratch2d(R._w, R._h); c.drawImage(R._bmp, 0, 0); R._px = c.getImageData(0, 0, R._w || 1, R._h || 1); }
            else R._px = new ImageData(Math.max(1, R._w), Math.max(1, R._h));
        }
        return R._px;
    }
    /** ImageData of a region in ROOT coordinates (a copy). */
    _readRegion(x, y, w, h) {
        const R = this._root;
        if (w <= 0 || h <= 0) return new ImageData(1, 1);
        if (R._px) {
            const px = R._px, out = new ImageData(w, h), W = R._w;
            for (let j = 0; j < h; j++) out.data.set(px.data.subarray(((y + j) * W + x) * 4, ((y + j) * W + x + w) * 4), j * w * 4);
            return out;
        }
        if (R._fillc) return R._fillImage(w, h);
        if (R._cv) { this._noteRead(); return R._c.getImageData(x, y, w, h); }
        const c = _scratch2d(w, h);
        if (R._bmp) c.drawImage(R._bmp, x, y, w, h, 0, 0, w, h);
        return c.getImageData(0, 0, w, h);
    }
    _writeRegion(img, x, y) {
        const c = this._wctx();
        c.putImageData(img, x, y);
        this._wrote();
        // the whole (SRCALPHA) surface was just written from img: keep it as the pixel cache, so the next pixel read
        // (a blend blit, a mask, get_at) does not read the canvas back - on a GPU canvas that stalls for milliseconds
        const R = this._root;
        if (!R._opaque && x === 0 && y === 0 && img.width === R._w && img.height === R._h) R._px = img;
    }
    // ---- info
    get_size() { return [this._w, this._h]; }
    get_width() { return this._w; }
    get_height() { return this._h; }
    get_rect(kw = null) {
        const r = new Rect(0, 0, this._w, this._h);
        if (kw) for (const k of Object.keys(kw)) r[k] = kw[k];
        return r;
    }
    get_frect(kw = null) { return this.get_rect(kw); }
    get_flags() { return this._flags; }
    get_bitsize() { return 32; }
    get_bytesize() { return 4; }
    get_pitch() { return this._root._w * 4; }
    get_masks() { return [0xff0000, 0xff00, 0xff, this._opaque ? 0 : 0xff000000]; }
    get_locked() { return false; }
    lock() {} unlock() {} mustlock() { return false; } get_locks() { return []; }
    get_parent() { return this._parent; }
    get_abs_parent() { return this._root; }
    get_offset() { return this._parent ? [this._ox - this._parent._ox, this._oy - this._parent._oy] : [0, 0]; }
    get_abs_offset() { return [this._ox, this._oy]; }
    convert() {
        const s = new Surface([this._w, this._h], 0);
        s.blit(this, [0, 0]);
        s._colorkey = this._colorkey;
        return s;
    }
    convert_alpha() {
        if (!this._opaque && this._root === this && this._bmp) {
            const s = Surface._fromDrawable(this._bmp, this._w, this._h, true);
            return s;
        }
        const s = new Surface([this._w, this._h], SRCALPHA);
        s.blit(this, [0, 0]);
        return s;
    }
    copy() {
        if (this._root === this && this._bmp && !this._pxDirty) {
            const s = Surface._fromDrawable(this._bmp, this._w, this._h, !this._opaque);
            s._alpha = this._alpha; s._colorkey = this._colorkey;
            return s;
        }
        const s = new Surface([this._w, this._h], this._flags);
        if (this._w && this._h) {
            const c = s._wctx();
            c.drawImage(this._src(), this._ox, this._oy, this._w, this._h, 0, 0, this._w, this._h);
            s._wrote();
        }
        s._alpha = this._alpha; s._colorkey = this._colorkey ? this._colorkey.slice() : null;
        return s;
    }
    subsurface(...args) {
        const r = args.length === 1 ? _R(args[0]) : new Rect(...args);
        if (r.x < 0 || r.y < 0 || r.x + r.w > this._w || r.y + r.h > this._h || r.w < 0 || r.h < 0) throw new ValueError_('subsurface rectangle outside surface area');
        const s = new Surface([r.w, r.h], this._flags | PREALLOC);
        s._root = this._root; s._parent = this;
        s._ox = this._ox + r.x; s._oy = this._oy + r.y;
        return s;
    }
    set_alpha(value = null, flags = 0) { this._alpha = value == null ? null : Math.max(0, Math.min(255, _t(value))); }
    get_alpha() { return this._alpha != null ? this._alpha : (this._opaque ? null : 255); }
    set_colorkey(color = null, flags = 0) { this._colorkey = color == null ? null : _rgba(color); this._keyed = null; }
    get_colorkey() { return this._colorkey ? this._colorkey.slice() : null; }
    set_clip(rect = null) { this._clip = rect == null ? null : _R(rect).clip(new Rect(0, 0, this._w, this._h)); }
    get_clip() { return this._clip ? this._clip.copy() : new Rect(0, 0, this._w, this._h); }
    /** The clip rect in root coordinates. */
    _rootClip() {
        const c = this._clip || new Rect(0, 0, this._w, this._h);
        return new Rect(c.x + this._ox, c.y + this._oy, c.w, c.h);
    }
    _hasClip() { return this._clip != null || this._root !== this; }
    // ---- pixels
    get_at(pos) {
        let [x, y] = _pair(pos);
        x = _t(x); y = _t(y);
        if (x < 0 || y < 0 || x >= this._w || y >= this._h) throw new IndexError_('pixel index out of range');
        const R = this._root;
        x += this._ox; y += this._oy;
        let d, o;
        if (R._px || R._w * R._h <= 262144) { d = this._pixels().data; o = (y * R._w + x) * 4; }
        else { d = this._readRegion(x, y, 1, 1).data; o = 0; }
        return [d[o], d[o + 1], d[o + 2], this._opaque ? 255 : d[o + 3]];
    }
    set_at(pos, color) {
        let [x, y] = _pair(pos);
        x = _t(x); y = _t(y);
        if (this._clip && !this._clip.collidepoint(x, y)) return;
        if (x < 0 || y < 0 || x >= this._w || y >= this._h) return;
        const c = _rgba(color);
        const R = this._root, d = this._pixels().data, o = ((y + this._oy) * R._w + x + this._ox) * 4;
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = this._opaque ? 255 : c[3];
        R._pxDirty = true; R._ver++;
    }
    get_bounding_rect(min_alpha = 1) {
        if (_isKw(min_alpha)) min_alpha = min_alpha.min_alpha ?? 1;
        const w = this._w, h = this._h;
        if (!w || !h) return new Rect(0, 0, 0, 0);
        if (this._opaque && !this._colorkey) return new Rect(0, 0, w, h);
        const img = this._readRegion(this._ox, this._oy, w, h), d = img.data;
        let x0 = w, y0 = h, x1 = -1, y1 = -1;
        const ck = this._colorkey;
        for (let y = 0; y < h; y++) {
            let o = y * w * 4;
            for (let x = 0; x < w; x++, o += 4) {
                const on = ck ? !(d[o] === ck[0] && d[o + 1] === ck[1] && d[o + 2] === ck[2]) : d[o + 3] >= min_alpha;
                if (on) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
            }
        }
        if (x1 < 0) return new Rect(0, 0, 0, 0);
        return new Rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    }
    // ---- fill
    fill(color, rect = null, special_flags = 0) {
        if (_isKw(rect)) { special_flags = rect.special_flags || 0; rect = rect.rect ?? null; }
        else if (_isKw(special_flags)) special_flags = special_flags.special_flags || 0;
        const c = _rgba(color);
        let r = rect == null ? new Rect(0, 0, this._w, this._h) : _R(rect).copy();
        r.normalize();
        r = r.clip(this._clip || new Rect(0, 0, this._w, this._h));
        if (r.w <= 0 || r.h <= 0) return new Rect(r.x, r.y, 0, 0);
        const X = r.x + this._ox, Y = r.y + this._oy;
        if (!special_flags) {
            const ctx = this._wctx();
            if (this._opaque) { ctx.fillStyle = _css(c[0], c[1], c[2], 255); ctx.fillRect(X, Y, r.w, r.h); }
            else {
                ctx.clearRect(X, Y, r.w, r.h);
                if (c[3] > 0) { ctx.fillStyle = _css(c[0], c[1], c[2], c[3]); ctx.fillRect(X, Y, r.w, r.h); }
            }
            this._wrote();
            const R = this._root;
            // the whole surface is one color now: pixel reads can be answered without reading the canvas back
            if (X === 0 && Y === 0 && r.w === R._w && r.h === R._h) R._fillc = this._opaque ? [c[0], c[1], c[2], 255] : (c[3] ? c.slice(0, 4) : [0, 0, 0, 0]);
            return r;
        }
        // fast exact paths through canvas composition
        if (this._opaque && (special_flags === BLEND_RGB_MULT || special_flags === BLEND_RGB_ADD || special_flags === BLEND_RGBA_MULT || special_flags === BLEND_RGBA_ADD)) {
            const ctx = this._wctx();
            ctx.globalCompositeOperation = (special_flags === BLEND_RGB_MULT || special_flags === BLEND_RGBA_MULT) ? 'multiply' : 'lighter';
            ctx.fillStyle = _css(c[0], c[1], c[2], 255);
            ctx.fillRect(X, Y, r.w, r.h);
            ctx.globalCompositeOperation = 'source-over';
            this._wrote();
            return r;
        }
        if (special_flags === BLEND_RGBA_MULT && c[0] === 255 && c[1] === 255 && c[2] === 255) {
            const ctx = this._wctx();
            ctx.save();
            ctx.beginPath(); ctx.rect(X, Y, r.w, r.h); ctx.clip();
            ctx.globalCompositeOperation = 'destination-in';
            ctx.fillStyle = _css(0, 0, 0, c[3]);
            ctx.fillRect(X, Y, r.w, r.h);
            ctx.restore();
            this._wrote();
            return r;
        }
        const img = this._readRegion(X, Y, r.w, r.h);
        _blendConst(img.data, c, special_flags, this._opaque);
        this._writeRegion(img, X, Y);
        return r;
    }
    // ---- blit
    blit(source, dest, area = null, special_flags = 0) {
        if (_isKw(area)) { special_flags = area.special_flags || 0; area = area.area ?? null; }
        else if (_isKw(special_flags)) special_flags = special_flags.special_flags || 0;
        let [dx, dy] = _pair(dest);
        dx = _t(dx); dy = _t(dy);
        let sx = 0, sy = 0, w = source._w, h = source._h;
        if (area != null) {
            const a = _R(area);
            sx = a.x; sy = a.y; w = a.w; h = a.h;
            if (sx < 0) { dx -= sx; w += sx; sx = 0; }
            if (sy < 0) { dy -= sy; h += sy; sy = 0; }
            if (sx + w > source._w) w = source._w - sx;
            if (sy + h > source._h) h = source._h - sy;
        }
        const cl = this._clip || new Rect(0, 0, this._w, this._h);
        if (dx < cl.x) { const d = cl.x - dx; sx += d; w -= d; dx = cl.x; }
        if (dy < cl.y) { const d = cl.y - dy; sy += d; h -= d; dy = cl.y; }
        if (dx + w > cl.x + cl.w) w = cl.x + cl.w - dx;
        if (dy + h > cl.y + cl.h) h = cl.y + cl.h - dy;
        if (w <= 0 || h <= 0) return new Rect(dx, dy, 0, 0);
        const SX = sx + source._ox, SY = sy + source._oy, DX = dx + this._ox, DY = dy + this._oy;
        if (!special_flags || special_flags === BLEND_ALPHA_SDL2 || special_flags === BLEND_PREMULTIPLIED) {
            let src = source._colorkey ? source._keyedSrc() : source._src();
            if (source._root === this._root && src === this._root._cv) {
                // blitting a surface onto itself (overlapping): go through a copy
                const tmp = _mkcanvas(w, h);
                tmp.getContext('2d').drawImage(src, SX, SY, w, h, 0, 0, w, h);
                src = tmp;
                const ctx = this._wctx();
                if (source._alpha != null) ctx.globalAlpha = source._alpha / 255;
                ctx.drawImage(src, 0, 0, w, h, DX, DY, w, h);
                ctx.globalAlpha = 1;
                this._wrote();
                return new Rect(dx, dy, w, h);
            }
            const ctx = this._wctx();
            if (source._alpha != null) {
                if (source._alpha === 0) return new Rect(dx, dy, w, h);
                ctx.globalAlpha = source._alpha / 255;
            }
            ctx.drawImage(src, SX, SY, w, h, DX, DY, w, h);
            if (source._alpha != null) ctx.globalAlpha = 1;
            this._wrote();
            return new Rect(dx, dy, w, h);
        }
        // blend modes: exact pygame arithmetic per pixel (fast canvas path for opaque ADD/MULT)
        if (this._opaque && source._opaque && !source._colorkey && source._alpha == null
            && (special_flags === BLEND_RGB_ADD || special_flags === BLEND_RGB_MULT || special_flags === BLEND_RGBA_ADD || special_flags === BLEND_RGBA_MULT)) {
            const src = source._src();
            const ctx = this._wctx();
            ctx.globalCompositeOperation = (special_flags === BLEND_RGB_ADD || special_flags === BLEND_RGBA_ADD) ? 'lighter' : 'multiply';
            ctx.drawImage(src, SX, SY, w, h, DX, DY, w, h);
            ctx.globalCompositeOperation = 'source-over';
            this._wrote();
            return new Rect(dx, dy, w, h);
        }
        const s = source._readRegion(SX, SY, w, h);
        const d = this._readRegion(DX, DY, w, h);
        _blendPix(d.data, s.data, special_flags, this._opaque, source._opaque, source._colorkey);
        this._writeRegion(d, DX, DY);
        return new Rect(dx, dy, w, h);
    }
    blits(seq, doreturn = true) {
        const out = [];
        for (const item of seq) {
            const r = this.blit(item[0], item[1], item.length > 2 ? item[2] : null, item.length > 3 ? item[3] : 0);
            if (doreturn) out.push(r);
        }
        return doreturn ? out : null;
    }
    fblits(seq, special_flags = 0) { for (const [s, p] of seq) this.blit(s, p, null, special_flags); }
    /** A canvas where the colorkey color is transparent (cached per content version). */
    _keyedSrc() {
        const R = this._root;
        const key = this._colorkey.join(',');
        if (this._keyed && this._keyed.ver === R._ver && this._keyed.key === key) return this._keyed.cv;
        const img = this._readRegion(0, 0, R._w, R._h), d = img.data;
        const [kr, kg, kb] = this._colorkey;
        for (let i = 0; i < d.length; i += 4) if (d[i] === kr && d[i + 1] === kg && d[i + 2] === kb) d[i + 3] = 0;
        const cv = _mkcanvas(R._w, R._h);
        cv.getContext('2d').putImageData(img, 0, 0);
        this._keyed = { ver: R._ver, key, cv };
        return cv;
    }
    scroll(dx = 0, dy = 0) {
        const w = this._w, h = this._h;
        if (!w || !h) return;
        const tmp = _mkcanvas(w, h);
        tmp.getContext('2d').drawImage(this._src(), this._ox, this._oy, w, h, 0, 0, w, h);
        const ctx = this._wctx();
        ctx.save();
        ctx.beginPath(); ctx.rect(this._ox, this._oy, w, h); ctx.clip();
        ctx.drawImage(tmp, this._ox + _t(dx), this._oy + _t(dy));
        ctx.restore();
        this._wrote();
    }
    premul_alpha() {
        const s = this.copy();
        if (this._opaque) return s;
        const img = s._readRegion(0, 0, s._w, s._h), d = img.data;
        for (let i = 0; i < d.length; i += 4) { const a = d[i + 3]; d[i] = (d[i] * a + 255) >> 8; d[i + 1] = (d[i + 1] * a + 255) >> 8; d[i + 2] = (d[i + 2] * a + 255) >> 8; }
        s._writeRegion(img, 0, 0);
        return s;
    }
    /** Run a canvas drawing callback with the offset/clip of this surface applied (used by draw.*). */
    _draw(fn) {
        const ctx = this._wctx();
        const clipped = this._hasClip();
        if (clipped) {
            ctx.save();
            const c = this._rootClip();
            ctx.beginPath(); ctx.rect(c.x, c.y, c.w, c.h); ctx.clip();
            if (this._ox || this._oy) ctx.translate(this._ox, this._oy);
        }
        try { fn(ctx); } finally {
            if (clipped) ctx.restore();
            this._wrote();
        }
    }
    toString() { return `<Surface(${this._w}x${this._h}x32${this._opaque ? '' : ' SRCALPHA'})>`; }
}
class IndexError_ extends Error {}

function _blendConst(d, c, flags, dstOpaque) {
    const [cr, cg, cb, ca] = c;
    const n = d.length;
    switch (flags) {
        case BLEND_RGB_ADD: for (let i = 0; i < n; i += 4) { d[i] = Math.min(255, d[i] + cr); d[i + 1] = Math.min(255, d[i + 1] + cg); d[i + 2] = Math.min(255, d[i + 2] + cb); } break;
        case BLEND_RGB_SUB: for (let i = 0; i < n; i += 4) { d[i] = Math.max(0, d[i] - cr); d[i + 1] = Math.max(0, d[i + 1] - cg); d[i + 2] = Math.max(0, d[i + 2] - cb); } break;
        case BLEND_RGB_MULT: for (let i = 0; i < n; i += 4) { d[i] = (d[i] * cr + 255) >> 8; d[i + 1] = (d[i + 1] * cg + 255) >> 8; d[i + 2] = (d[i + 2] * cb + 255) >> 8; } break;
        case BLEND_RGB_MIN: for (let i = 0; i < n; i += 4) { d[i] = Math.min(d[i], cr); d[i + 1] = Math.min(d[i + 1], cg); d[i + 2] = Math.min(d[i + 2], cb); } break;
        case BLEND_RGB_MAX: for (let i = 0; i < n; i += 4) { d[i] = Math.max(d[i], cr); d[i + 1] = Math.max(d[i + 1], cg); d[i + 2] = Math.max(d[i + 2], cb); } break;
        case BLEND_RGBA_ADD: for (let i = 0; i < n; i += 4) { d[i] = Math.min(255, d[i] + cr); d[i + 1] = Math.min(255, d[i + 1] + cg); d[i + 2] = Math.min(255, d[i + 2] + cb); d[i + 3] = Math.min(255, d[i + 3] + ca); } break;
        case BLEND_RGBA_SUB: for (let i = 0; i < n; i += 4) { d[i] = Math.max(0, d[i] - cr); d[i + 1] = Math.max(0, d[i + 1] - cg); d[i + 2] = Math.max(0, d[i + 2] - cb); d[i + 3] = Math.max(0, d[i + 3] - ca); } break;
        case BLEND_RGBA_MULT: for (let i = 0; i < n; i += 4) { d[i] = (d[i] * cr + 255) >> 8; d[i + 1] = (d[i + 1] * cg + 255) >> 8; d[i + 2] = (d[i + 2] * cb + 255) >> 8; d[i + 3] = (d[i + 3] * ca + 255) >> 8; } break;
        case BLEND_RGBA_MIN: for (let i = 0; i < n; i += 4) { d[i] = Math.min(d[i], cr); d[i + 1] = Math.min(d[i + 1], cg); d[i + 2] = Math.min(d[i + 2], cb); d[i + 3] = Math.min(d[i + 3], ca); } break;
        case BLEND_RGBA_MAX: for (let i = 0; i < n; i += 4) { d[i] = Math.max(d[i], cr); d[i + 1] = Math.max(d[i + 1], cg); d[i + 2] = Math.max(d[i + 2], cb); d[i + 3] = Math.max(d[i + 3], ca); } break;
        default: throw new error('unsupported special_flags ' + flags);
    }
    if (dstOpaque) for (let i = 3; i < n; i += 4) d[i] = 255;
}
function _blendPix(d, s, flags, dstOpaque, srcOpaque, ck) {
    const n = d.length;
    for (let i = 0; i < n; i += 4) {
        if (ck && s[i] === ck[0] && s[i + 1] === ck[1] && s[i + 2] === ck[2]) continue;
        const sa = srcOpaque ? 255 : s[i + 3];
        switch (flags) {
            case BLEND_RGB_ADD: d[i] = Math.min(255, d[i] + s[i]); d[i + 1] = Math.min(255, d[i + 1] + s[i + 1]); d[i + 2] = Math.min(255, d[i + 2] + s[i + 2]); break;
            case BLEND_RGB_SUB: d[i] = Math.max(0, d[i] - s[i]); d[i + 1] = Math.max(0, d[i + 1] - s[i + 1]); d[i + 2] = Math.max(0, d[i + 2] - s[i + 2]); break;
            case BLEND_RGB_MULT: d[i] = (d[i] * s[i] + 255) >> 8; d[i + 1] = (d[i + 1] * s[i + 1] + 255) >> 8; d[i + 2] = (d[i + 2] * s[i + 2] + 255) >> 8; break;
            case BLEND_RGB_MIN: d[i] = Math.min(d[i], s[i]); d[i + 1] = Math.min(d[i + 1], s[i + 1]); d[i + 2] = Math.min(d[i + 2], s[i + 2]); break;
            case BLEND_RGB_MAX: d[i] = Math.max(d[i], s[i]); d[i + 1] = Math.max(d[i + 1], s[i + 1]); d[i + 2] = Math.max(d[i + 2], s[i + 2]); break;
            case BLEND_RGBA_ADD: d[i] = Math.min(255, d[i] + s[i]); d[i + 1] = Math.min(255, d[i + 1] + s[i + 1]); d[i + 2] = Math.min(255, d[i + 2] + s[i + 2]); d[i + 3] = Math.min(255, d[i + 3] + sa); break;
            case BLEND_RGBA_SUB: d[i] = Math.max(0, d[i] - s[i]); d[i + 1] = Math.max(0, d[i + 1] - s[i + 1]); d[i + 2] = Math.max(0, d[i + 2] - s[i + 2]); d[i + 3] = Math.max(0, d[i + 3] - sa); break;
            case BLEND_RGBA_MULT: d[i] = (d[i] * s[i] + 255) >> 8; d[i + 1] = (d[i + 1] * s[i + 1] + 255) >> 8; d[i + 2] = (d[i + 2] * s[i + 2] + 255) >> 8; d[i + 3] = (d[i + 3] * sa + 255) >> 8; break;
            case BLEND_RGBA_MIN: d[i] = Math.min(d[i], s[i]); d[i + 1] = Math.min(d[i + 1], s[i + 1]); d[i + 2] = Math.min(d[i + 2], s[i + 2]); d[i + 3] = Math.min(d[i + 3], sa); break;
            case BLEND_RGBA_MAX: d[i] = Math.max(d[i], s[i]); d[i + 1] = Math.max(d[i + 1], s[i + 1]); d[i + 2] = Math.max(d[i + 2], s[i + 2]); d[i + 3] = Math.max(d[i + 3], sa); break;
            default: throw new error('unsupported special_flags ' + flags);
        }
        if (dstOpaque) d[i + 3] = 255;
    }
}

// ============================================================ draw
function _shape(surface, color, paint) {
    // pygame.draw writes the color without blending: opaque surfaces ignore alpha; on SRCALPHA surfaces a
    // translucent color REPLACES the pixels (destination-out, then paint)
    const c = _rgba(color);
    const a = surface._opaque ? 255 : c[3];
    const css = _css(c[0], c[1], c[2], a);
    surface._draw(ctx => {
        if (a < 255) {
            ctx.globalCompositeOperation = 'destination-out';
            paint(ctx, '#000');
            ctx.globalCompositeOperation = 'source-over';
            if (a > 0) paint(ctx, css);
        } else paint(ctx, css);
    });
}
function _bbox(pts, pad = 0) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { const [x, y] = _pair(p); if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    return new Rect(x0 - pad, y0 - pad, x1 - x0 + 1 + 2 * pad, y1 - y0 + 1 + 2 * pad);
}
function _radius(r, w, h) { return Math.max(0, Math.min(r, Math.floor(Math.min(w, h) / 2))); }
export const draw = {
    rect(surface, color, rect, width = 0, border_radius = 0, border_top_left_radius = -1, border_top_right_radius = -1, border_bottom_left_radius = -1, border_bottom_right_radius = -1) {
        if (_isKw(width)) ({ width = 0, border_radius = 0, border_top_left_radius = -1, border_top_right_radius = -1, border_bottom_left_radius = -1, border_bottom_right_radius = -1 } = width);
        else if (_isKw(border_radius)) ({ border_radius = 0, border_top_left_radius = -1, border_top_right_radius = -1, border_bottom_left_radius = -1, border_bottom_right_radius = -1 } = border_radius);
        const r = _R(rect).copy();
        r.normalize();
        width = _t(width);
        if (width < 0 || r.w <= 0 || r.h <= 0) return new Rect(r.x, r.y, 0, 0);
        const rounded = border_radius > 0 || border_top_left_radius > 0 || border_top_right_radius > 0 || border_bottom_left_radius > 0 || border_bottom_right_radius > 0;
        if (!rounded && width === 0) return surface.fill(color, r);     // draw.rect(width=0) replaces pixels like fill
        const radii = () => {
            const b = border_radius;
            const pick = v => _radius(v >= 0 ? v : b, r.w, r.h);
            return [pick(border_top_left_radius), pick(border_top_right_radius), pick(border_bottom_right_radius), pick(border_bottom_left_radius)];
        };
        _shape(surface, color, (ctx, style) => {
            ctx.fillStyle = style;
            ctx.beginPath();
            if (rounded) {
                const rr = radii();
                ctx.roundRect(r.x, r.y, r.w, r.h, rr);
                if (width > 0 && width * 2 < Math.min(r.w, r.h)) ctx.roundRect(r.x + width, r.y + width, r.w - 2 * width, r.h - 2 * width, rr.map(v => Math.max(0, v - width)));
            } else {
                ctx.rect(r.x, r.y, r.w, r.h);
                if (width > 0 && width * 2 < Math.min(r.w, r.h)) ctx.rect(r.x + width, r.y + width, r.w - 2 * width, r.h - 2 * width);
            }
            ctx.fill('evenodd');
        });
        return r;
    },
    line(surface, color, start_pos, end_pos, width = 1) {
        width = _t(width);
        const [x1, y1] = _pair(start_pos), [x2, y2] = _pair(end_pos);
        if (width < 1) return new Rect(_t(x1), _t(y1), 0, 0);
        const off = width % 2 ? 0.5 : 0;
        _shape(surface, color, (ctx, style) => {
            ctx.strokeStyle = style;
            ctx.lineWidth = width;
            ctx.lineCap = width === 1 ? 'square' : 'butt';
            ctx.beginPath();
            ctx.moveTo(_t(x1) + off, _t(y1) + off);
            ctx.lineTo(_t(x2) + off, _t(y2) + off);
            ctx.stroke();
        });
        return _bbox([start_pos, end_pos], width >> 1);
    },
    aaline(surface, color, start_pos, end_pos, blend = 1) { return draw.line(surface, color, start_pos, end_pos, 1); },
    lines(surface, color, closed, points, width = 1) {
        width = _t(width);
        if (width < 1 || points.length < 2) return new Rect(0, 0, 0, 0);
        const off = width % 2 ? 0.5 : 0;
        _shape(surface, color, (ctx, style) => {
            ctx.strokeStyle = style;
            ctx.lineWidth = width;
            ctx.lineCap = width === 1 ? 'square' : 'butt';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            points.forEach((p, i) => { const [x, y] = _pair(p); (i ? ctx.lineTo : ctx.moveTo).call(ctx, _t(x) + off, _t(y) + off); });
            if (closed) ctx.closePath();
            ctx.stroke();
        });
        return _bbox(points, width >> 1);
    },
    aalines(surface, color, closed, points, blend = 1) { return draw.lines(surface, color, closed, points, 1); },
    polygon(surface, color, points, width = 0) {
        width = _t(width);
        if (points.length < 3) return new Rect(0, 0, 0, 0);
        if (width > 0) return draw.lines(surface, color, true, points, width);
        const c = _rgba(color);
        const translucent = !surface._opaque && c[3] < 255;
        _shape(surface, color, (ctx, style) => {
            ctx.fillStyle = style;
            ctx.beginPath();
            points.forEach((p, i) => { const [x, y] = _pair(p); (i ? ctx.lineTo : ctx.moveTo).call(ctx, _t(x) + 0.5, _t(y) + 0.5); });
            ctx.closePath();
            ctx.fill();
            if (!translucent) {                   // pygame includes the edge pixels
                ctx.strokeStyle = style;
                ctx.lineWidth = 1;
                ctx.lineJoin = 'round';
                ctx.stroke();
            }
        });
        return _bbox(points);
    },
    circle(surface, color, center, radius, width = 0, draw_top_right = null, draw_top_left = null, draw_bottom_left = null, draw_bottom_right = null) {
        const [cx0, cy0] = _pair(center);
        const cx = _t(cx0), cy = _t(cy0);
        radius = _t(radius); width = _t(width);
        if (radius < 1 || width < 0) return new Rect(cx, cy, 0, 0);
        const quads = [draw_top_right, draw_top_left, draw_bottom_left, draw_bottom_right];
        const partial = quads.some(q => q != null) && !quads.every(q => q);
        _shape(surface, color, (ctx, style) => {
            ctx.beginPath();
            if (partial) {
                // quadrants: top-right = angles [-90, 0] in canvas (y down)
                const segs = [[-Math.PI / 2, 0, draw_top_right], [-Math.PI, -Math.PI / 2, draw_top_left], [Math.PI / 2, Math.PI, draw_bottom_left], [0, Math.PI / 2, draw_bottom_right]];
                for (const [a0, a1, on] of segs) {
                    if (!on) continue;
                    if (width === 0 || width >= radius) { ctx.moveTo(cx, cy); ctx.arc(cx, cy, radius, a0, a1); ctx.closePath(); } else { ctx.moveTo(cx + (radius - width / 2) * Math.cos(a0), cy + (radius - width / 2) * Math.sin(a0)); ctx.arc(cx, cy, radius - width / 2, a0, a1); }
                }
                if (width === 0 || width >= radius) { ctx.fillStyle = style; ctx.fill(); } else { ctx.strokeStyle = style; ctx.lineWidth = width; ctx.stroke(); }
                return;
            }
            if (width === 0 || width >= radius) {
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.fillStyle = style;
                ctx.fill();
            } else {
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.arc(cx, cy, radius - width, 0, Math.PI * 2, true);
                ctx.fillStyle = style;
                ctx.fill('evenodd');
            }
        });
        return new Rect(cx - radius, cy - radius, radius * 2, radius * 2);
    },
    ellipse(surface, color, rect, width = 0) {
        const r = _R(rect).copy();
        r.normalize();
        width = _t(width);
        if (r.w <= 0 || r.h <= 0 || width < 0) return new Rect(r.x, r.y, 0, 0);
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w / 2, ry = r.h / 2;
        _shape(surface, color, (ctx, style) => {
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            if (width > 0 && width < Math.min(rx, ry)) ctx.ellipse(cx, cy, rx - width, ry - width, 0, 0, Math.PI * 2, true);
            ctx.fillStyle = style;
            ctx.fill('evenodd');
        });
        return r;
    },
    arc(surface, color, rect, start_angle, stop_angle, width = 1) {
        const r = _R(rect).copy();
        r.normalize();
        width = _t(width);
        if (r.w <= 0 || r.h <= 0 || width < 1) return new Rect(r.x, r.y, 0, 0);
        if (stop_angle < start_angle) stop_angle += Math.PI * 2;
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        const w = Math.min(width, r.w / 2, r.h / 2);
        const rx = r.w / 2 - w / 2, ry = r.h / 2 - w / 2;
        _shape(surface, color, (ctx, style) => {
            ctx.beginPath();
            ctx.ellipse(cx, cy, Math.max(0, rx), Math.max(0, ry), 0, -stop_angle, -start_angle);
            ctx.strokeStyle = style;
            ctx.lineWidth = w;
            ctx.stroke();
        });
        return r;
    },
};

// ============================================================ transform
export const transform = {
    scale(surface, size, dest_surface = null) { return _scaled(surface, size, false, dest_surface); },
    smoothscale(surface, size, dest_surface = null) { return _scaled(surface, size, true, dest_surface); },
    scale_by(surface, factor) { const [fx, fy] = typeof factor === 'number' ? [factor, factor] : _pair(factor); return _scaled(surface, [surface._w * fx, surface._h * fy], false); },
    smoothscale_by(surface, factor) { const [fx, fy] = typeof factor === 'number' ? [factor, factor] : _pair(factor); return _scaled(surface, [surface._w * fx, surface._h * fy], true); },
    scale2x(surface) { return _scaled(surface, [surface._w * 2, surface._h * 2], false); },
    flip(surface, flip_x, flip_y) {
        const s = new Surface([surface._w, surface._h], surface._flags);
        if (!surface._w || !surface._h) return s;
        const ctx = s._wctx();
        ctx.save();
        ctx.translate(flip_x ? surface._w : 0, flip_y ? surface._h : 0);
        ctx.scale(flip_x ? -1 : 1, flip_y ? -1 : 1);
        ctx.drawImage(surface._src(), surface._ox, surface._oy, surface._w, surface._h, 0, 0, surface._w, surface._h);
        ctx.restore();
        s._wrote();
        s._colorkey = surface._colorkey;
        return s;
    },
    rotate(surface, angle) {
        const w = surface._w, h = surface._h;
        const q = ((angle % 360) + 360) % 360;
        let nw, nh;
        if (q % 90 === 0) { [nw, nh] = (q === 90 || q === 270) ? [h, w] : [w, h]; }
        else {
            const rad = angle * 0.01745329251994329, s = Math.sin(rad), c = Math.cos(rad);
            const cx = c * w, cy = c * h, sx = s * w, sy = s * h;
            nw = _t(Math.max(Math.abs(cx + sy), Math.abs(cx - sy), Math.abs(-cx + sy), Math.abs(-cx - sy)));
            nh = _t(Math.max(Math.abs(sx + cy), Math.abs(sx - cy), Math.abs(-sx + cy), Math.abs(-sx - cy)));
        }
        const out = new Surface([nw, nh], surface._flags);
        if (!w || !h) return out;
        if (surface._opaque) {
            // pygame fills the corners with the colorkey or the top-left pixel
            out.fill(surface._colorkey || surface.get_at([0, 0]));
            out._colorkey = surface._colorkey;
        }
        const ctx = out._wctx();
        ctx.save();
        ctx.translate(nw / 2, nh / 2);
        ctx.rotate(-angle * Math.PI / 180);
        ctx.drawImage(surface._src(), surface._ox, surface._oy, w, h, -w / 2, -h / 2, w, h);
        ctx.restore();
        out._wrote();
        return out;
    },
    rotozoom(surface, angle, scale) {
        const w = surface._w, h = surface._h;
        let nw, nh;
        scale = Math.fround(scale);          // SDL_gfx takes the zoom as a C float
        if (Math.abs(angle) <= 0.0001) { nw = Math.max(1, _t(w * scale)); nh = Math.max(1, _t(h * scale)); }
        else {
            const rad = angle * Math.PI / 180, s = Math.sin(rad) * scale, c = Math.cos(rad) * scale;
            const x = _t(w / 2), y = _t(h / 2);
            const cx = c * x, cy = c * y, sx = s * x, sy = s * y;
            nw = 2 * Math.max(Math.ceil(Math.max(Math.abs(cx + sy), Math.abs(cx - sy), Math.abs(-cx + sy), Math.abs(-cx - sy))), 1);
            nh = 2 * Math.max(Math.ceil(Math.max(Math.abs(sx + cy), Math.abs(sx - cy), Math.abs(-sx + cy), Math.abs(-sx - cy))), 1);
        }
        const out = new Surface([nw, nh], SRCALPHA);
        if (!w || !h) return out;
        const src = surface._colorkey ? surface._keyedSrc() : surface._src();
        const ctx = out._wctx();
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.translate(nw / 2, nh / 2);
        ctx.rotate(-angle * Math.PI / 180);
        ctx.scale(scale, scale);
        ctx.drawImage(src, surface._ox, surface._oy, w, h, -w / 2, -h / 2, w, h);
        ctx.restore();
        out._wrote();
        return out;
    },
    /** pygame-ce grayscale: 0.299 R + 0.587 G + 0.114 B (truncated), alpha kept. */
    grayscale(surface, dest_surface = null) {
        const out = dest_surface || new Surface([surface._w, surface._h], surface._flags);
        if (!surface._w || !surface._h) return out;
        const img = surface._readRegion(surface._ox, surface._oy, surface._w, surface._h), d = img.data;
        for (let i = 0; i < d.length; i += 4) {
            const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
            d[i] = d[i + 1] = d[i + 2] = g;
        }
        out._writeRegion(img, out._ox, out._oy);
        return out;
    },
    average_color(surface, rect = null, consider_alpha = false) {
        const r = rect ? _R(rect) : new Rect(0, 0, surface._w, surface._h);
        const d = surface._readRegion(r.x + surface._ox, r.y + surface._oy, r.w, r.h).data;
        let s = [0, 0, 0, 0], n = 0;
        for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; s[3] += d[i + 3]; n++; }
        return s.map(v => (n ? _t(v / n) : 0));
    },
};
function _scaled(surface, size, smooth, dest = null) {
    const [w0, h0] = _pair(size);
    const w = Math.max(0, _t(w0)), h = Math.max(0, _t(h0));
    const out = dest || new Surface([w, h], surface._flags);
    if (!w || !h || !surface._w || !surface._h) return out;
    const src = surface._colorkey ? surface._keyedSrc() : surface._src();
    const ctx = out._wctx();
    ctx.save();
    ctx.imageSmoothingEnabled = smooth;
    // pygame's smoothscale enlarges by linear interpolation and shrinks by box averaging: 'low' (bilinear) for
    // enlarging - the same filter and much cheaper than 'high' on big targets (the fog view); 'high' for shrinking
    if (smooth) ctx.imageSmoothingQuality = (w > surface._w || h > surface._h) ? 'low' : 'high';
    if (!out._opaque) ctx.clearRect(out._ox, out._oy, w, h);
    ctx.drawImage(src, surface._ox, surface._oy, surface._w, surface._h, out._ox, out._oy, w, h);
    ctx.restore();
    out._wrote();
    out._colorkey = surface._colorkey;
    return out;
}

// ============================================================ image / surfarray / mask
export const image = {
    /** Synchronous: the asset (or a stored user file) must already be loaded (assets.request / load_group). */
    load(file, namehint = '') {
        const path = typeof file === 'string' ? file : String(file);
        const bmp = assets.image(path);
        if (bmp) {
            const inf = assets.info(path);
            return Surface._fromDrawable(bmp, bmp.width, bmp.height, inf ? inf.alpha : true);
        }
        const st = storage.image(path);
        if (st) return Surface._fromDrawable(st, st.width, st.height, true);
        throw new error(`Couldn't open ${path} (not preloaded)`);
    },
    /** Encodes PNG synchronously (needs a DOM canvas) and stores it in storage.js at `file`. */
    save(surface, file) {
        const c = document.createElement('canvas');
        c.width = Math.max(1, surface._w); c.height = Math.max(1, surface._h);
        c.getContext('2d').drawImage(surface._src(), surface._ox, surface._oy, surface._w, surface._h, 0, 0, surface._w, surface._h);
        const b64 = c.toDataURL('image/png').split(',')[1];
        const bin = atob(b64), u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        storage.put_image(file, u8, c);
    },
    frombuffer(buf, size, format) { return _frombytes(buf, size, format); },
    frombytes(buf, size, format) { return _frombytes(buf, size, format); },
    fromstring(buf, size, format) { return _frombytes(buf, size, format); },
    tobytes(surface, format = 'RGBA') {
        const d = surface._readRegion(surface._ox, surface._oy, surface._w, surface._h).data;
        if (format === 'RGBA' || format === 'RGBX') return new Uint8Array(d.buffer.slice(0));
        const out = new Uint8Array(surface._w * surface._h * 3);
        for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { out[j] = d[i]; out[j + 1] = d[i + 1]; out[j + 2] = d[i + 2]; }
        return out;
    },
    get_extended() { return true; },
};
export const image_tostring = image.tobytes;
function _frombytes(buf, size, format) {
    const [w, h] = _pair(size);
    const u8 = buf instanceof Uint8Array || buf instanceof Uint8ClampedArray ? buf : (buf instanceof np.NDArray ? Uint8Array.from(buf.toTyped()) : Uint8Array.from(buf));
    const alpha = format === 'RGBA' || format === 'ARGB' || format === 'BGRA';
    const s = new Surface([w, h], alpha ? SRCALPHA : 0);
    if (!w || !h) return s;
    const img = new ImageData(w, h), d = img.data;
    const n = w * h;
    if (format === 'RGBA') d.set(u8.subarray(0, n * 4));
    else if (format === 'RGBX') { d.set(u8.subarray(0, n * 4)); for (let i = 3; i < n * 4; i += 4) d[i] = 255; }
    else if (format === 'ARGB') for (let i = 0; i < n; i++) { d[i * 4] = u8[i * 4 + 1]; d[i * 4 + 1] = u8[i * 4 + 2]; d[i * 4 + 2] = u8[i * 4 + 3]; d[i * 4 + 3] = u8[i * 4]; }
    else if (format === 'BGRA') for (let i = 0; i < n; i++) { d[i * 4] = u8[i * 4 + 2]; d[i * 4 + 1] = u8[i * 4 + 1]; d[i * 4 + 2] = u8[i * 4]; d[i * 4 + 3] = u8[i * 4 + 3]; }
    else if (format === 'RGB') for (let i = 0; i < n; i++) { d[i * 4] = u8[i * 3]; d[i * 4 + 1] = u8[i * 3 + 1]; d[i * 4 + 2] = u8[i * 3 + 2]; d[i * 4 + 3] = 255; }
    else if (format === 'P' || format === 'L') for (let i = 0; i < n; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = u8[i]; d[i * 4 + 3] = 255; }
    else throw new error('unsupported format ' + format);
    s._writeRegion(img, 0, 0);
    return s;
}

/** surfarray: numpy-style (x, y[, c]) views over the surface's pixel cache (np.NDArray). Writes mark it dirty. */
export const surfarray = {
    pixels3d(surface) {
        const R = surface._root, px = surface._pixels();
        R._pxDirty = true; R._ver++;
        return new np.NDArray(px.data, [surface._w, surface._h, 3], [4, R._w * 4, 1], (surface._oy * R._w + surface._ox) * 4, 'uint8c');
    },
    pixels_alpha(surface) {
        const R = surface._root, px = surface._pixels();
        R._pxDirty = true; R._ver++;
        return new np.NDArray(px.data, [surface._w, surface._h], [4, R._w * 4], (surface._oy * R._w + surface._ox) * 4 + 3, 'uint8c');
    },
    pixels2d(surface) {
        const d = surface._readRegion(surface._ox, surface._oy, surface._w, surface._h).data;
        const out = np.zeros([surface._w, surface._h], 'uint32');
        for (let y = 0; y < surface._h; y++) for (let x = 0; x < surface._w; x++) { const o = (y * surface._w + x) * 4; out.data[x * surface._h + y] = (d[o] << 16) | (d[o + 1] << 8) | d[o + 2]; }
        return out;
    },
    array3d(surface) { return surfarray.pixels3d(surface).astype('uint8'); },
    array_alpha(surface) { return surfarray.pixels_alpha(surface).astype('uint8'); },
    array2d(surface) { return surfarray.pixels2d(surface); },
    /** make_surface(array (w, h, 3)) -> an opaque surface. */
    make_surface(arr) {
        arr = np.asarray(arr);
        const [w, h] = arr.shape;
        const s = new Surface([w, h], 0);
        surfarray.pixels3d(s).assign(arr.ndim === 3 ? arr.s(null, null, [0, 3]) : arr);
        const d = s._pixels().data;
        for (let i = 3; i < d.length; i += 4) d[i] = 255;
        return s;
    },
    blit_array(surface, arr) { surfarray.pixels3d(surface).assign(np.asarray(arr)); },
};

export class Mask {
    constructor(size, fill = false) {
        const [w, h] = _pair(size);
        this.w = _t(w); this.h = _t(h);
        this.bits = new Uint8Array(Math.max(0, this.w * this.h));
        if (fill) this.bits.fill(1);
    }
    get_size() { return [this.w, this.h]; }
    get_rect(kw = null) { const r = new Rect(0, 0, this.w, this.h); if (kw) for (const k of Object.keys(kw)) r[k] = kw[k]; return r; }
    get_at(pos) { const [x, y] = _pair(pos); if (x < 0 || y < 0 || x >= this.w || y >= this.h) throw new IndexError_('mask index out of range'); return this.bits[y * this.w + x]; }
    set_at(pos, value = 1) { const [x, y] = _pair(pos); if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.bits[y * this.w + x] = value ? 1 : 0; }
    fill() { this.bits.fill(1); }
    clear() { this.bits.fill(0); }
    invert() { for (let i = 0; i < this.bits.length; i++) this.bits[i] ^= 1; }
    copy() { const m = new Mask([this.w, this.h]); m.bits.set(this.bits); return m; }
    count() { let n = 0; for (let i = 0; i < this.bits.length; i++) n += this.bits[i]; return n; }
    _each(other, offset, fn) {
        const [ox, oy] = _pair(offset);
        const x0 = Math.max(0, ox), y0 = Math.max(0, oy), x1 = Math.min(this.w, ox + other.w), y1 = Math.min(this.h, oy + other.h);
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) fn(y * this.w + x, (y - oy) * other.w + (x - ox), x, y);
    }
    overlap(other, offset) { let hit = null; try { this._each(other, offset, (i, j, x, y) => { if (this.bits[i] && other.bits[j]) { hit = [x, y]; throw 0; } }); } catch (e) { if (e !== 0) throw e; } return hit; }
    overlap_area(other, offset) { let n = 0; this._each(other, offset, (i, j) => { if (this.bits[i] && other.bits[j]) n++; }); return n; }
    overlap_mask(other, offset) { const m = new Mask([this.w, this.h]); this._each(other, offset, (i, j) => { if (this.bits[i] && other.bits[j]) m.bits[i] = 1; }); return m; }
    draw(other, offset) { this._each(other, offset, (i, j) => { if (other.bits[j]) this.bits[i] = 1; }); }
    erase(other, offset) { this._each(other, offset, (i, j) => { if (other.bits[j]) this.bits[i] = 0; }); }
    centroid() { let sx = 0, sy = 0, n = 0; for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.bits[y * this.w + x]) { sx += x; sy += y; n++; } return n ? [_t(sx / n), _t(sy / n)] : [0, 0]; }
    get_bounding_rects() {
        let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1;
        for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.bits[y * this.w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
        return x1 < 0 ? [] : [new Rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1)];
    }
    /** to_surface(surface=None, setsurface=None, unsetsurface=None, setcolor=(255,255,255,255), unsetcolor=(0,0,0,255), dest=(0,0)) */
    to_surface(surface = null, setsurface = null, unsetsurface = null, setcolor = [255, 255, 255, 255], unsetcolor = [0, 0, 0, 255], dest = [0, 0]) {
        if (_isKw(surface)) ({ surface = null, setsurface = null, unsetsurface = null, setcolor = [255, 255, 255, 255], unsetcolor = [0, 0, 0, 255], dest = [0, 0] } = surface);
        const out = surface || new Surface([this.w, this.h], SRCALPHA);
        const sc = setcolor == null ? null : _rgba(setcolor), uc = unsetcolor == null ? null : _rgba(unsetcolor);
        const img = new ImageData(Math.max(1, this.w), Math.max(1, this.h)), d = img.data;
        for (let i = 0; i < this.bits.length; i++) {
            const c = this.bits[i] ? sc : uc;
            if (c) { d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = c[3]; }
        }
        const [dx, dy] = _pair(dest);
        if (!this.w || !this.h) return out;
        if (!surface) out._writeRegion(img, 0, 0);
        else { const tmp = new Surface([this.w, this.h], SRCALPHA); tmp._writeRegion(img, 0, 0); out.blit(tmp, [dx, dy]); }
        return out;
    }
}
export const mask = {
    Mask,
    from_surface(surface, threshold = 127) {
        const m = new Mask([surface._w, surface._h]);
        if (!surface._w || !surface._h) return m;
        if (surface._opaque && !surface._colorkey) { m.bits.fill(1); return m; }
        const d = surface._readRegion(surface._ox, surface._oy, surface._w, surface._h).data;
        const ck = surface._colorkey;
        for (let i = 0, j = 0; j < m.bits.length; i += 4, j++) m.bits[j] = ck ? (d[i] === ck[0] && d[i + 1] === ck[1] && d[i + 2] === ck[2] ? 0 : 1) : (d[i + 3] > threshold ? 1 : 0);
        return m;
    },
};

// ============================================================ font
const _measure = (() => { let c = null; return () => { if (!c) c = _mkcanvas(8, 8).getContext('2d'); return c; }; })();
const _DEFAULT_FONT = 'assets/fonts/FreeSansBold.ttf';
export class Font {
    constructor(file = null, size = 20) {
        let path = file == null ? _DEFAULT_FONT : String(file);
        let info = assets.font(path);
        if (!info) {
            // accept a bare file name ('PTSerif-Bold.ttf') or any path ending with a shipped font
            const base = path.slice(path.lastIndexOf('/') + 1);
            const cand = 'assets/fonts/' + base;
            info = assets.font(cand);
            if (!info) { console.warn('pygame.font: font not preloaded, using default:', path); info = assets.font(_DEFAULT_FONT) || { family: 'sans-serif', upem: 1000, asc: 900, desc: -212, lineGap: 33 }; }
        }
        this._info = info;
        this._size = Math.max(1, _t(size));
        this.bold = false; this.italic = false; this.underline = false; this.strikethrough = false;
        const k = this._size * 64 / info.upem;
        const ceil26 = v => Math.ceil(Math.round(v) / 64);
        this._ascent = ceil26(info.asc * k);
        this._descent = ceil26(info.desc * k);
        this._height = ceil26((info.asc - info.desc) * k);
        this._linesize = ceil26((info.asc - info.desc + info.lineGap) * k);
        this._wcache = new Map();
    }
    get point_size() { return this._size; }
    _css() { return `${this.italic ? 'italic ' : ''}${this.bold ? 'bold ' : ''}${this._size}px "${this._info.family}"`; }
    get_height() { return this._height; }
    get_linesize() { return this._linesize; }
    get_ascent() { return this._ascent; }
    get_descent() { return this._descent; }
    set_bold(v) { this.bold = !!v; } get_bold() { return this.bold; }
    set_italic(v) { this.italic = !!v; } get_italic() { return this.italic; }
    set_underline(v) { this.underline = !!v; } get_underline() { return this.underline; }
    set_strikethrough(v) { this.strikethrough = !!v; } get_strikethrough() { return this.strikethrough; }
    _width(text) {
        const key = (this.bold ? 'b' : '') + (this.italic ? 'i' : '') + text;
        let w = this._wcache.get(key);
        if (w === undefined) {
            const c = _measure();
            c.font = this._css();
            w = Math.ceil(c.measureText(text).width - 0.01);
            if (this.italic) w += Math.ceil(this._size * 0.1);
            if (this._wcache.size > 2000) this._wcache.clear();
            this._wcache.set(key, w);
        }
        return w;
    }
    size(text) { text = String(text ?? ''); return [text ? this._width(text) : 0, this._height]; }
    render(text, antialias, color, background = null) {
        if (_isKw(background)) background = background.background ?? null;
        text = String(text ?? '').replace(/[\r\n]/g, '');
        // SDL_ttf 2.2x: size() reports get_height(), rendered surfaces are max(height, lineskip) tall
        const w = text ? this._width(text) : 0, h = text ? Math.max(this._height, this._linesize) : this._height;
        const s = new Surface([w, h], background == null ? SRCALPHA : 0);
        if (background != null) s.fill(background);
        if (!w) return s;
        const c = _rgba(color);
        const ctx = s._wctx();
        ctx.font = this._css();
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = _css(c[0], c[1], c[2], c[3]);
        ctx.fillText(text, 0, this._ascent);
        if (this.underline || this.strikethrough) {
            const y = this.underline ? this._ascent + Math.max(1, _t(this._size / 14)) : this._ascent - _t(this._size * 0.3);
            ctx.fillRect(0, y, w, Math.max(1, _t(this._size / 16)));
        }
        s._wrote();
        return s;
    }
    metrics(text) { return Array.from(String(text), ch => { const w = this._width(ch); return [0, w, -this._descent, this._ascent, w]; }); }
}
export const font = {
    Font,
    SysFont(name, size, bold = false, italic = false) { const f = new Font(null, size); f.bold = !!bold; f.italic = !!italic; return f; },
    init() {}, quit() {}, get_init() { return true; },
    get_default_font() { return 'freesansbold.ttf'; },
    /** No system fonts in the browser: returns null (callers fall back to shipped fonts). */
    match_font(name, bold = false, italic = false) { return null; },
    get_fonts() { return []; },
};

// ============================================================ time / loop
const _T0 = performance.now();
export class Clock {
    constructor() { this._last = null; this._dt = 0; this._raw = 0; this._hist = []; }
    /** Returns ms since the previous tick (int). The frame rate cap is applied by run_loop (never sleeps). */
    tick(framerate = 0) {
        const now = performance.now();
        const dt = this._last == null ? 0 : now - this._last;
        this._last = now;
        this._dt = Math.round(dt);
        this._raw = this._dt;
        if (framerate > 0) _fpsLimit = framerate;
        this._hist.push(dt);
        if (this._hist.length > 10) this._hist.shift();
        return this._dt;
    }
    tick_busy_loop(framerate = 0) { return this.tick(framerate); }
    get_time() { return this._dt; }
    get_rawtime() { return this._raw; }
    get_fps() { const n = this._hist.length; if (!n) return 0; const s = this._hist.reduce((a, b) => a + b, 0); return s > 0 ? 1000 * n / s : 0; }
}
let _fpsLimit = 0;
const _timers = new Map();
export const time = {
    Clock,
    get_ticks() { return Math.floor(performance.now() - _T0); },
    delay(ms) { return 0; },
    wait(ms) { return 0; },
    /** set_timer(event, millis, loops=0): posts the event every millis (0 cancels). */
    set_timer(ev, millis, loops = 0) {
        const type = typeof ev === 'number' ? ev : ev.type;
        if (_timers.has(type)) { clearInterval(_timers.get(type)); _timers.delete(type); }
        if (millis > 0) {
            let n = 0;
            const id = setInterval(() => {
                event.post(typeof ev === 'number' ? new Event(ev) : ev);
                if (loops && ++n >= loops) { clearInterval(id); _timers.delete(type); }
            }, millis);
            _timers.set(type, id);
        }
    },
};

let _loopErrorHandler = null;
/** Called with the Error when a frame throws (the loop stops). Default: console + a red message on the screen. */
export function set_error_handler(fn) { _loopErrorHandler = fn; }
/**
 * Drive a Python `while running:` loop from requestAnimationFrame. `frame()` runs one iteration and returns
 * false to stop. The last Clock.tick(fps) cap is honoured by skipping animation frames.
 * Returns a promise that resolves when the loop ends (frame returned false) or rejects on an error.
 */
// time spent inside the frame callback (for profiling / web/tests/e2e.mjs); reset() starts a new window
export const loop_stats = {
    frames: 0, total_ms: 0, max_ms: 0, last_ms: 0, slow: 0,        // slow: frames longer than 50 ms
    reset() { this.frames = 0; this.total_ms = 0; this.max_ms = 0; this.slow = 0; },
    get mean_ms() { return this.frames ? this.total_ms / this.frames : 0; },
};
export function run_loop(frame) {
    return new Promise((resolve, reject) => {
        let last = 0;
        const step = now => {
            if (_fpsLimit > 0 && last && now - last < 1000 / _fpsLimit - 2) { requestAnimationFrame(step); return; }
            last = now;
            let go;
            const t0 = performance.now();
            try { go = frame(); } catch (e) {
                console.error(e);
                (_loopErrorHandler || _showError)(e);
                reject(e);
                return;
            }
            const ms = performance.now() - t0;
            loop_stats.frames++; loop_stats.total_ms += ms; loop_stats.last_ms = ms;
            if (ms > loop_stats.max_ms) loop_stats.max_ms = ms;
            if (ms > 50) loop_stats.slow++;
            if (go === false) { resolve(); return; }
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    });
}
function _showError(e) {
    if (!_screen) return;
    const c = _screen._wctx();
    c.fillStyle = 'rgba(80,0,0,0.85)';
    c.fillRect(0, 0, _screen._w, 120);
    c.fillStyle = '#fff';
    c.font = '16px monospace';
    const lines = String(e && e.stack || e).split('\n').slice(0, 6);
    lines.forEach((l, i) => c.fillText(l.slice(0, 150), 10, 24 + i * 18));
}

// ============================================================ events / input
export class Event {
    constructor(type, dict = null) {
        this.type = type;
        if (dict) Object.assign(this, dict);
    }
    get dict() { const o = Object.assign({}, this); delete o.type; return o; }
    toString() { return `<Event(${this.type} ${JSON.stringify(this.dict)})>`; }
}
const _queue = [];
const _pressed = Object.create(null);
let _mods = 0;
let _mousePos = [0, 0], _mouseRel = [0, 0], _mouseButtons = [false, false, false, false, false];
let _mouseInside = false, _focused = true;
let _wheelAcc = 0, _wheelAccX = 0;
let _repeat = [0, 0];
let _canvasEl = null, _cursorVisible = true, _cursorCss = 'default';
let _customType = USEREVENT + 1;

function _post(e) { if (_queue.length < 1024) _queue.push(e); }
export const event = {
    Event,
    /** get(eventtype=None, pump=True, exclude=None) -> drains the queue (or only the given types). */
    get(eventtype = null, pump = true, exclude = null) {
        if (eventtype == null && exclude == null) return _queue.splice(0);
        const types = eventtype == null ? null : new Set(Array.isArray(eventtype) ? eventtype : [eventtype]);
        const ex = exclude == null ? null : new Set(Array.isArray(exclude) ? exclude : [exclude]);
        const out = [], keep = [];
        for (const e of _queue) ((types == null || types.has(e.type)) && (ex == null || !ex.has(e.type)) ? out : keep).push(e);
        _queue.length = 0;
        _queue.push(...keep);
        return out;
    },
    poll() { return _queue.length ? _queue.shift() : new Event(NOEVENT); },
    wait() { return _queue.length ? _queue.shift() : new Event(NOEVENT); },
    peek(eventtype = null) { return eventtype == null ? _queue.length > 0 : _queue.some(e => (Array.isArray(eventtype) ? eventtype.includes(e.type) : e.type === eventtype)); },
    pump() {},
    post(e) { _post(e); return true; },
    clear(eventtype = null) { if (eventtype == null) _queue.length = 0; else { const k = _queue.filter(e => !(Array.isArray(eventtype) ? eventtype.includes(e.type) : e.type === eventtype)); _queue.length = 0; _queue.push(...k); } },
    set_allowed() {}, set_blocked() {}, get_blocked() { return false; }, set_grab() {}, get_grab() { return false; },
    custom_type() { return _customType++; },
    event_name(t) { return ({ [QUIT]: 'Quit', [KEYDOWN]: 'KeyDown', [KEYUP]: 'KeyUp', [MOUSEMOTION]: 'MouseMotion', [MOUSEBUTTONDOWN]: 'MouseButtonDown', [MOUSEBUTTONUP]: 'MouseButtonUp', [MOUSEWHEEL]: 'MouseWheel', [TEXTINPUT]: 'TextInput' })[t] || 'Unknown'; },
};

// DOM code -> SDL keycode (layout-independent for letters/digits, like SDL on non-Latin layouts)
const CODE2KEY = {
    Backspace: K_BACKSPACE, Tab: K_TAB, Enter: K_RETURN, Escape: K_ESCAPE, Space: K_SPACE, Delete: K_DELETE,
    Minus: K_MINUS, Equal: K_EQUALS, Comma: K_COMMA, Period: K_PERIOD, Slash: K_SLASH, Semicolon: K_SEMICOLON,
    Quote: K_QUOTE, BracketLeft: K_LEFTBRACKET, BracketRight: K_RIGHTBRACKET, Backslash: K_BACKSLASH, Backquote: K_BACKQUOTE,
    IntlBackslash: K_BACKSLASH, CapsLock: K_CAPSLOCK, PrintScreen: K_PRINTSCREEN, ScrollLock: K_SCROLLLOCK, Pause: K_PAUSE,
    Insert: K_INSERT, Home: K_HOME, PageUp: K_PAGEUP, End: K_END, PageDown: K_PAGEDOWN, ArrowRight: K_RIGHT,
    ArrowLeft: K_LEFT, ArrowDown: K_DOWN, ArrowUp: K_UP, NumLock: K_NUMLOCKCLEAR, NumpadDivide: K_KP_DIVIDE,
    NumpadMultiply: K_KP_MULTIPLY, NumpadSubtract: K_KP_MINUS, NumpadAdd: K_KP_PLUS, NumpadEnter: K_KP_ENTER,
    NumpadDecimal: K_KP_PERIOD, NumpadEqual: K_KP_EQUALS, ContextMenu: K_MENU, Help: K_HELP,
    ControlLeft: K_LCTRL, ShiftLeft: K_LSHIFT, AltLeft: K_LALT, MetaLeft: K_LGUI, OSLeft: K_LGUI,
    ControlRight: K_RCTRL, ShiftRight: K_RSHIFT, AltRight: K_RALT, MetaRight: K_RGUI, OSRight: K_RGUI,
};
for (let i = 0; i < 26; i++) CODE2KEY['Key' + String.fromCharCode(65 + i)] = 97 + i;
for (let i = 0; i < 10; i++) { CODE2KEY['Digit' + i] = 48 + i; CODE2KEY['Numpad' + i] = KEYS['K_KP' + i]; }
for (let i = 1; i <= 15; i++) CODE2KEY['F' + i] = KEYS['K_F' + i];
const MODBIT = { [K_LSHIFT]: KMOD_LSHIFT, [K_RSHIFT]: KMOD_RSHIFT, [K_LCTRL]: KMOD_LCTRL, [K_RCTRL]: KMOD_RCTRL,
    [K_LALT]: KMOD_LALT, [K_RALT]: KMOD_RALT, [K_LGUI]: KMOD_LGUI, [K_RGUI]: KMOD_RGUI };

// pygame (compat) key names
const KEYNAME = new Map([
    [K_BACKSPACE, 'backspace'], [K_TAB, 'tab'], [K_CLEAR, 'clear'], [K_RETURN, 'return'], [K_PAUSE, 'pause'],
    [K_ESCAPE, 'escape'], [K_SPACE, 'space'], [K_DELETE, 'delete'], [K_KP_PERIOD, '[.]'], [K_KP_DIVIDE, '[/]'],
    [K_KP_MULTIPLY, '[*]'], [K_KP_MINUS, '[-]'], [K_KP_PLUS, '[+]'], [K_KP_ENTER, 'enter'], [K_KP_EQUALS, 'equals'],
    [K_UP, 'up'], [K_DOWN, 'down'], [K_RIGHT, 'right'], [K_LEFT, 'left'], [K_INSERT, 'insert'], [K_HOME, 'home'],
    [K_END, 'end'], [K_PAGEUP, 'page up'], [K_PAGEDOWN, 'page down'], [K_NUMLOCK, 'numlock'], [K_CAPSLOCK, 'caps lock'],
    [K_SCROLLLOCK, 'scroll lock'], [K_RSHIFT, 'right shift'], [K_LSHIFT, 'left shift'], [K_RCTRL, 'right ctrl'],
    [K_LCTRL, 'left ctrl'], [K_RALT, 'right alt'], [K_LALT, 'left alt'], [K_RGUI, 'right meta'], [K_LGUI, 'left meta'],
    [K_MODE, 'alt gr'], [K_HELP, 'help'], [K_PRINTSCREEN, 'print screen'], [K_SYSREQ, 'sys req'], [K_MENU, 'menu'], [K_POWER, 'power'],
]);
for (let i = 0; i < 10; i++) KEYNAME.set(KEYS['K_KP' + i], `[${i}]`);
for (let i = 1; i <= 15; i++) KEYNAME.set(KEYS['K_F' + i], 'f' + i);
const NAME2KEY = new Map();
for (const [k, n] of KEYNAME) if (!NAME2KEY.has(n)) NAME2KEY.set(n, k);
NAME2KEY.set('keypad enter', K_KP_ENTER).set('keypad +', K_KP_PLUS).set('keypad -', K_KP_MINUS).set('left gui', K_LGUI).set('right gui', K_RGUI);

export const key = {
    /** A snapshot indexable by key code: key.get_pressed()[K_LEFT] -> true/false. */
    get_pressed() {
        const snap = Object.assign(Object.create(null), _pressed);
        return new Proxy(snap, { get: (t, k) => (typeof k === 'string' && k in t ? t[k] : false) });
    },
    get_mods() { return _mods; },
    set_mods(m) { _mods = m; },
    get_focused() { return _focused; },
    name(k, use_compat = true) {
        if (KEYNAME.has(k)) return KEYNAME.get(k);
        if (k > 0 && k < 0x110000 && !(k & 0x40000000)) return String.fromCodePoint(k).toLowerCase();
        return '';
    },
    key_code(name) {
        const n = String(name).toLowerCase();
        if (NAME2KEY.has(n)) return NAME2KEY.get(n);
        if ([...n].length === 1) return n.codePointAt(0);
        throw new ValueError_('unknown key name');
    },
    set_repeat(delay = 0, interval = 0) { _repeat = [delay, interval || delay]; },
    get_repeat() { return _repeat.slice(); },
    start_text_input() {}, stop_text_input() {}, set_text_input_rect() {},
};

export const mouse = {
    get_pos() { return _mousePos.slice(); },
    get_rel() { const r = _mouseRel; _mouseRel = [0, 0]; return r.slice(); },
    get_pressed(num_buttons = 3) { return num_buttons === 5 ? _mouseButtons.slice() : _mouseButtons.slice(0, 3); },
    get_focused() { return _mouseInside && _focused; },
    set_visible(v) { const was = _cursorVisible; _cursorVisible = !!v; _applyCursor(); return was; },
    get_visible() { return _cursorVisible; },
    set_pos(pos) { const [x, y] = _pair(pos); _mousePos = [_t(x), _t(y)]; },
    set_cursor(c, ...rest) {
        if (typeof c === 'number') _cursorCss = _SYSCUR[c] || 'default';
        else if (c instanceof cursors.Cursor) _cursorCss = c._css;
        else if (rest.length) _cursorCss = new cursors.Cursor(c, rest[0])._css;
        _applyCursor();
    },
    get_cursor() { return null; },
};
const _SYSCUR = { [SYSTEM_CURSOR_ARROW]: 'default', [SYSTEM_CURSOR_IBEAM]: 'text', [SYSTEM_CURSOR_WAIT]: 'wait',
    [SYSTEM_CURSOR_CROSSHAIR]: 'crosshair', [SYSTEM_CURSOR_WAITARROW]: 'progress', [SYSTEM_CURSOR_SIZENWSE]: 'nwse-resize',
    [SYSTEM_CURSOR_SIZENESW]: 'nesw-resize', [SYSTEM_CURSOR_SIZEWE]: 'ew-resize', [SYSTEM_CURSOR_SIZENS]: 'ns-resize',
    [SYSTEM_CURSOR_SIZEALL]: 'move', [SYSTEM_CURSOR_NO]: 'not-allowed', [SYSTEM_CURSOR_HAND]: 'pointer' };
// the letterbox bars count as the window (pointer clamped to the canvas edge), so the cursor style covers them too:
// otherwise a hidden system cursor (software cursor on HiDPI) reappears over the bars next to the game's own one
function _applyCursor() {
    if (!_canvasEl) return;
    const c = _cursorVisible ? _cursorCss : 'none';
    _canvasEl.style.cursor = c;
    if (_canvasEl.parentElement) _canvasEl.parentElement.style.cursor = c;
}
export const cursors = {
    /** Cursor((hx, hy), surface) or Cursor(SYSTEM_CURSOR_*) -> a CSS cursor (image scaled to the page scale). */
    Cursor: class {
        constructor(a, b = null) {
            if (typeof a === 'number' && b == null) { this._css = _SYSCUR[a] || 'default'; this.type = 'system'; return; }
            const [hx, hy] = _pair(a), surf = b;
            const c = document.createElement('canvas');
            c.width = Math.max(1, surf._w); c.height = Math.max(1, surf._h);
            c.getContext('2d').drawImage(surf._src(), surf._ox, surf._oy, surf._w, surf._h, 0, 0, surf._w, surf._h);
            this._css = `url(${c.toDataURL('image/png')}) ${_t(hx)} ${_t(hy)}, default`;
            this.type = 'color';
            this.data = [a, b];
        }
    },
    arrow: SYSTEM_CURSOR_ARROW,
};

function _toLogical(ev) {
    const r = _canvasEl.getBoundingClientRect();
    const sw = _screen ? _screen._w : _canvasEl.width, sh = _screen ? _screen._h : _canvasEl.height;
    const x = Math.floor((ev.clientX - r.left) * sw / r.width), y = Math.floor((ev.clientY - r.top) * sh / r.height);
    return [Math.max(0, Math.min(sw - 1, x)), Math.max(0, Math.min(sh - 1, y))];
}
const _DOMBTN = { 0: 1, 1: 2, 2: 3, 3: 6, 4: 7 };
let _gestureHooks = [];
function _gesture() { for (const f of _gestureHooks) { try { f(); } catch (e) { console.warn(e); } } }
/** Reserved browser shortcuts we leave alone (reload, devtools, quit/close/tab ops). */
function _browserReserved(e) {
    if (e.code === 'F12') return true;
    if ((e.metaKey || e.ctrlKey) && ['KeyR', 'KeyQ', 'KeyW', 'Tab'].includes(e.code)) return true;
    // Cmd+T/N are the macOS new-tab/new-window shortcuts; plain Ctrl+T/N reach the page
    // (macOS) and are the game's Mill/Tower jump keys (controls.py GOTO_KEYS). On
    // Windows/Linux the browser swallows Ctrl+T/N before the page sees them anyway.
    if (e.metaKey && ['KeyT', 'KeyN'].includes(e.code)) return true;
    if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyI') return true;
    // page zoom and find, fullscreen: the game binds none of these (Ctrl+L / Ctrl+digits are game keys: stable, groups)
    if ((e.metaKey || e.ctrlKey) && ['Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract', 'KeyF'].includes(e.code)) return true;
    if (e.code === 'F11') return true;
    return false;
}
function _install(canvas) {
    if (_canvasEl === canvas) return;
    _canvasEl = canvas;
    canvas.tabIndex = 0;
    canvas.style.outline = 'none';
    _applyCursor();
    const onMove = ev => {
        const p = _toLogical(ev);
        const rel = [p[0] - _mousePos[0], p[1] - _mousePos[1]];
        _mouseRel = [_mouseRel[0] + rel[0], _mouseRel[1] + rel[1]];
        _mousePos = p;
        _mouseInside = true;
        if (rel[0] || rel[1]) _post(new Event(MOUSEMOTION, { pos: p.slice(), rel, buttons: _mouseButtons.slice(0, 3), touch: false, window: null }));
    };
    // the whole page is the "window": the pointer over the letterbox bars counts as inside, clamped to the
    // canvas edge (so edge scrolling works in fullscreen, like SDL's window)
    window.addEventListener('pointermove', onMove);
    document.documentElement.addEventListener('pointerenter', ev => { _mouseInside = true; _mousePos = _toLogical(ev); _post(new Event(WINDOWENTER, {})); });
    document.documentElement.addEventListener('pointerleave', () => { _mouseInside = false; _post(new Event(WINDOWLEAVE, {})); });
    canvas.addEventListener('pointerdown', ev => {
        canvas.focus({ preventScroll: true });
        if (canvas.setPointerCapture) try { canvas.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
        _gesture();
        _mousePos = _toLogical(ev);
        const b = _DOMBTN[ev.button] || 1;
        if (b <= 5) _mouseButtons[b - 1] = true;
        _post(new Event(MOUSEBUTTONDOWN, { pos: _mousePos.slice(), button: b, touch: false, window: null }));
        ev.preventDefault();
    });
    const onUp = ev => {
        _mousePos = _toLogical(ev);
        const b = _DOMBTN[ev.button] || 1;
        if (b <= 5) _mouseButtons[b - 1] = false;
        _post(new Event(MOUSEBUTTONUP, { pos: _mousePos.slice(), button: b, touch: false, window: null }));
    };
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('contextmenu', ev => ev.preventDefault());
    canvas.addEventListener('wheel', ev => {
        ev.preventDefault();
        const unit = ev.deltaMode === 1 ? 1 / 3 : ev.deltaMode === 2 ? 1 : 1 / 100;
        const py = -ev.deltaY * unit, px = ev.deltaX * unit;
        _wheelAcc += py; _wheelAccX += px;
        const iy = _t(_wheelAcc), ix = _t(_wheelAccX);
        _wheelAcc -= iy; _wheelAccX -= ix;
        _post(new Event(MOUSEWHEEL, { x: ix, y: iy, precise_x: px, precise_y: py, flipped: false, touch: false, which: 0, window: null }));
        // pygame 2 also reports whole wheel steps as buttons 4/5
        for (let i = 0; i < Math.abs(iy); i++) {
            const b = iy > 0 ? 4 : 5;
            _post(new Event(MOUSEBUTTONDOWN, { pos: _mousePos.slice(), button: b, touch: false, window: null }));
            _post(new Event(MOUSEBUTTONUP, { pos: _mousePos.slice(), button: b, touch: false, window: null }));
        }
    }, { passive: false });
    window.addEventListener('keydown', ev => {
        if (_browserReserved(ev)) return;
        _gesture();
        const k = _keycode(ev);
        if (MODBIT[k]) _mods |= MODBIT[k];
        _syncMods(ev);
        ev.preventDefault();
        if (ev.repeat && !_repeat[0]) return;
        _pressed[k] = true;
        const ctrl = ev.ctrlKey || ev.metaKey;
        let uni = ev.key && [...ev.key].length === 1 && !ctrl ? ev.key : '';
        if (!uni) uni = { Enter: '\r', Tab: '\t', Backspace: '\b', Escape: '\x1b', Delete: '\x7f' }[ev.key] || '';
        _post(new Event(KEYDOWN, { key: k, mod: _mods, unicode: uni, scancode: k & 0x40000000 ? k & 0x1ff : 0, window: null }));
        if (uni && uni >= ' ' && uni !== '\x7f') _post(new Event(TEXTINPUT, { text: uni, window: null }));
    });
    window.addEventListener('keyup', ev => {
        if (_browserReserved(ev)) return;
        const k = _keycode(ev);
        if (MODBIT[k]) _mods &= ~MODBIT[k];
        _syncMods(ev);
        delete _pressed[k];
        ev.preventDefault();
        _post(new Event(KEYUP, { key: k, mod: _mods, unicode: '', scancode: 0, window: null }));
    });
    window.addEventListener('blur', () => {
        _focused = false;
        for (const k of Object.keys(_pressed)) delete _pressed[k];
        _mods = 0;
        _mouseButtons = [false, false, false, false, false];
        _post(new Event(WINDOWFOCUSLOST, {}));
        _post(new Event(ACTIVEEVENT, { gain: 0, state: 2 }));
    });
    window.addEventListener('focus', () => { _focused = true; _post(new Event(WINDOWFOCUSGAINED, {})); _post(new Event(ACTIVEEVENT, { gain: 1, state: 2 })); });
    window.addEventListener('beforeunload', () => { _post(new Event(QUIT, {})); });
}
// SDL keycodes follow the keyboard layout's unshifted character for printable ASCII keys (AZERTY 'a' on KeyQ,
// German '+' on BracketRight) and the US position otherwise (Cyrillic letters -> K_a..K_z like SDL).
let _layout = null;
try {
    if (typeof navigator !== 'undefined' && navigator.keyboard && navigator.keyboard.getLayoutMap) {
        navigator.keyboard.getLayoutMap().then(m => { _layout = m; }).catch(() => {});
    }
} catch { /* not available */ }
function _keycode(ev) {
    const code = ev.code;
    if (_layout && _layout.has(code) && !code.startsWith('Numpad')) {
        const ch = _layout.get(code);
        if (ch && ch.length === 1 && ch >= '!' && ch <= '~') return ch.toLowerCase().codePointAt(0);
    }
    const k = CODE2KEY[code];
    if (k !== undefined) return k;
    return ev.key && ev.key.length === 1 ? ev.key.toLowerCase().codePointAt(0) : 0;
}
function _syncMods(ev) {
    // keep the lock bits and repair drift (a key released outside the window)
    if (!ev.shiftKey) _mods &= ~KMOD_SHIFT;
    if (!ev.ctrlKey) _mods &= ~KMOD_CTRL;
    if (!ev.altKey) _mods &= ~KMOD_ALT;
    if (!ev.metaKey) _mods &= ~KMOD_GUI;
    if (ev.shiftKey && !(_mods & KMOD_SHIFT)) _mods |= KMOD_LSHIFT;
    if (ev.ctrlKey && !(_mods & KMOD_CTRL)) _mods |= KMOD_LCTRL;
    if (ev.altKey && !(_mods & KMOD_ALT)) _mods |= KMOD_LALT;
    if (ev.metaKey && !(_mods & KMOD_GUI)) _mods |= KMOD_LGUI;
    _mods = ev.getModifierState && ev.getModifierState('CapsLock') ? _mods | KMOD_CAPS : _mods & ~KMOD_CAPS;
}

// ============================================================ display
let _caption = '';
export const display = {
    /** set_mode(size, flags=0, ...) -> the screen Surface drawn straight into the page canvas (#screen). */
    set_mode(size = [0, 0], flags = 0, depth = 0, disp = 0, vsync = 0) {
        let [w, h] = _pair(size);
        const canvas = document.getElementById('screen') || (() => { const c = document.createElement('canvas'); c.id = 'screen'; document.body.appendChild(c); return c; })();
        if (!w || !h) { w = canvas.width || 1280; h = canvas.height || 800; }
        canvas.width = w; canvas.height = h;
        const s = new Surface([w, h], PREALLOC);
        s._cv = canvas;
        s._c = canvas.getContext('2d', { alpha: false });
        s._c.imageSmoothingEnabled = false;
        s._c.fillStyle = '#000';
        s._c.fillRect(0, 0, w, h);
        _screen = s;
        _install(canvas);
        _fit();
        window.addEventListener('resize', _fit);
        document.addEventListener('fullscreenchange', _fit);
        return s;
    },
    get_surface() { return _screen; },
    /** Presenting happens when the animation frame ends; flush pending pixel writes on the screen. */
    flip() { if (_screen) _screen._flush(); },
    update() { if (_screen) _screen._flush(); },
    set_caption(title, icontitle = null) { _caption = String(title); if (typeof document !== 'undefined') document.title = _caption; },
    get_caption() { return [_caption, _caption]; },
    set_icon() {},
    get_init() { return _screen != null; },
    init() {}, quit() {},
    is_fullscreen() { return typeof document !== 'undefined' && !!document.fullscreenElement; },
    toggle_fullscreen() {
        const host = (_canvasEl && _canvasEl.parentElement) || document.documentElement;
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else if (host.requestFullscreen) host.requestFullscreen().catch(e => console.warn('fullscreen refused:', e.message));
        return 1;
    },
    get_window_size() { return _screen ? [_screen._w, _screen._h] : [0, 0]; },
    get_desktop_sizes() { return [[screen.width, screen.height]]; },
    /** The Retina factor (NSWindow backingScaleFactor analogue). */
    get_backing_scale() { return window.devicePixelRatio || 1; },
    Info() { return { current_w: window.innerWidth, current_h: window.innerHeight }; },
};
function _fit() {
    if (!_canvasEl || !_screen) return;
    const host = _canvasEl.parentElement || document.body;
    const W = host.clientWidth || window.innerWidth, H = host.clientHeight || window.innerHeight;
    const k = Math.min(W / _screen._w, H / _screen._h);
    _canvasEl.style.width = Math.floor(_screen._w * k) + 'px';
    _canvasEl.style.height = Math.floor(_screen._h * k) + 'px';
}

// ============================================================ mixer (Web Audio)
let _mixerInit = null;
let _channels = [];
let _reserved = 0;
let _master = null;
function _actx() { return assets.get_audio_context(); }
_gestureHooks.push(() => {
    const c = _actx();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
    music._retry();
});
function _audioBufferFromWav(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const tag = o => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new error('Unrecognized audio format');
    let pos = 12, fmt = null, data = null;
    while (pos + 8 <= u8.length) {
        const id = tag(pos), len = dv.getUint32(pos + 4, true);
        if (id === 'fmt ') fmt = { format: dv.getUint16(pos + 8, true), ch: dv.getUint16(pos + 10, true), rate: dv.getUint32(pos + 12, true), bits: dv.getUint16(pos + 22, true) };
        else if (id === 'data') data = [pos + 8, len];
        pos += 8 + len + (len & 1);
    }
    if (!fmt || !data) throw new error('bad WAV');
    const ctx = _actx();
    const bps = fmt.bits / 8, frames = Math.floor(data[1] / (bps * fmt.ch));
    const buf = ctx.createBuffer(fmt.ch, Math.max(1, frames), fmt.rate);
    for (let c = 0; c < fmt.ch; c++) {
        const out = buf.getChannelData(c);
        for (let i = 0; i < frames; i++) {
            const o = data[0] + (i * fmt.ch + c) * bps;
            out[i] = fmt.bits === 16 ? dv.getInt16(o, true) / 32768 : fmt.bits === 8 ? (u8[o] - 128) / 128 : fmt.format === 3 ? dv.getFloat32(o, true) : dv.getInt32(o, true) / 2147483648;
        }
    }
    return buf;
}
export class Sound {
    /** Sound(file) where file is an asset path (preloaded), WAV bytes (Uint8Array/ArrayBuffer), or an AudioBuffer.
     *  Sound({buffer: Int16Array interleaved stereo, channels=2, rate}) / Sound({array: np.NDArray int16 (n, 2)}). */
    constructor(file = null, buffer = null, array = null) {
        if (_isKw(file)) ({ file = null, buffer = null, array = null } = file);
        const ctx = _actx();
        if (!ctx) throw new error('mixer not initialized');
        this._vol = 1;
        if (typeof file === 'string') {
            const ab = assets.audio(file);
            if (!ab) throw new error(`Unable to open file '${file}' (not preloaded)`);
            this._buf = ab;
        } else if (file instanceof AudioBuffer) this._buf = file;
        else if (file instanceof ArrayBuffer || ArrayBuffer.isView(file)) this._buf = _audioBufferFromWav(file instanceof ArrayBuffer ? new Uint8Array(file) : new Uint8Array(file.buffer, file.byteOffset, file.byteLength));
        else if (file && file.getvalue) this._buf = _audioBufferFromWav(file.getvalue());
        else if (buffer != null || array != null) {
            const ch = 2, rate = ctx.sampleRate;
            let data = array != null ? np.asarray(array).toTyped() : (buffer instanceof ArrayBuffer ? new Int16Array(buffer) : buffer);
            const frames = Math.floor(data.length / ch);
            this._buf = ctx.createBuffer(ch, Math.max(1, frames), rate);
            const scale = data instanceof Float32Array || data instanceof Float64Array ? 1 : 1 / 32768;
            for (let c = 0; c < ch; c++) { const o = this._buf.getChannelData(c); for (let i = 0; i < frames; i++) o[i] = data[i * ch + c] * scale; }
        } else throw new error('Sound needs a file, buffer or array');
    }
    play(loops = 0, maxtime = 0, fade_ms = 0) {
        if (_isKw(loops)) ({ loops = 0, maxtime = 0, fade_ms = 0 } = loops);
        const ch = mixer.find_channel(false);
        if (!ch) return null;
        ch._lr = [1, 1];
        ch._vol = 1;
        ch.play(this, loops, maxtime, fade_ms);
        return ch;
    }
    stop() { for (const c of _channels) if (c._sound === this) c.stop(); }
    fadeout(ms) { for (const c of _channels) if (c._sound === this) c.fadeout(ms); }
    set_volume(v) { this._vol = Math.max(0, Math.min(1, v)); for (const c of _channels) if (c._sound === this) c._apply(); }
    get_volume() { return this._vol; }
    get_num_channels() { return _channels.filter(c => c._sound === this && c.get_busy()).length; }
    get_length() { return this._buf.duration; }
    get_raw() { return new Uint8Array(0); }
}
export class Channel {
    constructor(id) {
        this._id = id; this._src = null; this._sound = null; this._queued = null; this._end = null;
        this._lr = [1, 1]; this._vol = 1; this._fade = null; this._endevent = null;
    }
    _graph() {
        if (this._g) return this._g;
        const ctx = _actx();
        // input: up-mix mono to stereo ('speakers'), then independent left/right gains (Mix_SetPanning)
        const inp = ctx.createGain();
        inp.channelCount = 2; inp.channelCountMode = 'explicit'; inp.channelInterpretation = 'speakers';
        const split = ctx.createChannelSplitter(2);
        inp.connect(split);
        const gl = ctx.createGain(), gr = ctx.createGain(), merge = ctx.createChannelMerger(2), out = ctx.createGain();
        split.connect(gl, 0); split.connect(gr, 1);
        gl.connect(merge, 0, 0); gr.connect(merge, 0, 1);
        merge.connect(out);
        out.connect(_masterGain());
        this._g = { inp, split, gl, gr, out };
        return this._g;
    }
    _apply() {
        const g = this._graph();
        const k = this._vol * (this._sound ? this._sound._vol : 1);
        g.gl.gain.value = this._lr[0] * k;
        g.gr.gain.value = this._lr[1] * k;
    }
    play(sound, loops = 0, maxtime = 0, fade_ms = 0) {
        if (_isKw(loops)) ({ loops = 0, maxtime = 0, fade_ms = 0 } = loops);
        this.stop();
        const ctx = _actx();
        const g = this._graph();
        const src = ctx.createBufferSource();
        src.buffer = sound._buf;
        const t0 = ctx.currentTime;
        g.out.gain.cancelScheduledValues(t0);
        if (fade_ms > 0) { g.out.gain.setValueAtTime(0, t0); g.out.gain.linearRampToValueAtTime(1, t0 + fade_ms / 1000); } else g.out.gain.setValueAtTime(1, t0);
        let dur = null;
        if (loops < 0) src.loop = true;
        else if (loops > 0) { src.loop = true; dur = sound._buf.duration * (loops + 1); }
        if (maxtime > 0) dur = dur == null ? maxtime / 1000 : Math.min(dur, maxtime / 1000);
        src.connect(g.inp);
        this._sound = sound;
        this._src = src;
        this._end = dur != null ? t0 + dur : (src.loop ? Infinity : t0 + sound._buf.duration);
        src.onended = () => {
            if (this._src !== src) return;
            this._src = null;
            if (this._endevent != null) _post(new Event(this._endevent, {}));
            if (this._queued) { const q = this._queued; this._queued = null; this.play(q); } else this._sound = null;
        };
        this._apply();
        src.start(t0);
        if (dur != null) src.stop(t0 + dur);
        return this;
    }
    stop() {
        if (this._src) { const s = this._src; this._src = null; try { s.stop(); } catch { /* not started */ } s.disconnect(); }
        this._sound = null; this._queued = null;
    }
    pause() { const c = _actx(); if (c) this._pausedAt = c.currentTime; }
    unpause() {}
    fadeout(ms) {
        if (!this._src) return;
        const ctx = _actx(), g = this._graph(), t0 = ctx.currentTime;
        g.out.gain.cancelScheduledValues(t0);
        g.out.gain.setValueAtTime(g.out.gain.value, t0);
        g.out.gain.linearRampToValueAtTime(0, t0 + ms / 1000);
        try { this._src.stop(t0 + ms / 1000); } catch { /* ignore */ }
        this._end = t0 + ms / 1000;
    }
    /** set_volume(v) or set_volume(left, right) — the stereo gains of this channel. */
    set_volume(left, right = null) {
        left = Math.max(0, Math.min(1, left));
        if (right == null) { this._lr = [1, 1]; this._vol = left; } else { this._lr = [left, Math.max(0, Math.min(1, right))]; this._vol = 1; }
        this._apply();
    }
    get_volume() { return this._vol; }
    get_busy() {
        if (!this._src) return false;
        const c = _actx();
        return c.currentTime < this._end;
    }
    get_sound() { return this.get_busy() ? this._sound : null; }
    queue(sound) { if (!this.get_busy()) this.play(sound); else this._queued = sound; }
    get_queue() { return this._queued; }
    set_endevent(type = null) { this._endevent = type; }
    get_endevent() { return this._endevent ?? NOEVENT; }
}
function _masterGain() {
    if (!_master) { const c = _actx(); _master = c.createGain(); _master.connect(c.destination); }
    return _master;
}
function _ensureChannels(n) {
    while (_channels.length < n) _channels.push(new Channel(_channels.length));
    _channels.length = n;
}
export const mixer = {
    Sound,
    /** mixer.Channel(id) — the same object every time (works with or without `new`). */
    Channel: function (id) { _ensureChannels(Math.max(_channels.length, id + 1)); return _channels[id]; },
    pre_init() {},
    init(frequency = 44100, size = -16, channels = 2, buffer = 512) {
        const c = _actx();
        if (!c) throw new error('No Web Audio');
        _mixerInit = [c.sampleRate, -16, 2];
        if (!_channels.length) _ensureChannels(8);
    },
    quit() { for (const c of _channels) c.stop(); music.stop(); _mixerInit = null; },
    get_init() { return _mixerInit ? _mixerInit.slice() : null; },
    set_num_channels(n) { _ensureChannels(n); },
    get_num_channels() { return _channels.length; },
    set_reserved(n) { _reserved = Math.max(0, n); return _reserved; },
    find_channel(force = false) {
        for (let i = _reserved; i < _channels.length; i++) if (!_channels[i].get_busy()) return _channels[i];
        if (!force) return null;
        let best = null;
        for (let i = _reserved; i < _channels.length; i++) { const c = _channels[i]; if (!best || (c._src && best._src && c._src.__t0 < best._src.__t0)) best = c; }
        return best || _channels[_reserved] || null;
    },
    stop() { for (const c of _channels) c.stop(); },
    pause() { const c = _actx(); if (c) c.suspend(); },
    unpause() { const c = _actx(); if (c) c.resume(); },
    fadeout(ms) { for (const c of _channels) c.fadeout(ms); },
    get_busy() { return _channels.some(c => c.get_busy()); },
    get_sdl_mixer_version() { return [2, 8, 0]; },
};
// track start times for find_channel(force=True) (oldest playing)
const _origPlay = Channel.prototype.play;
Channel.prototype.play = function (...a) { const r = _origPlay.apply(this, a); if (this._src) this._src.__t0 = performance.now(); return r; };

/** mixer.music: streaming through an <audio> element (asset path via assets.url). */
export const music = {
    _el: null, _path: null, _vol: 1, _want: false, _loops: 0, _queue: null, _endevent: null, _startPos: 0,
    _elem() {
        if (!this._el) {
            this._el = new Audio();
            this._el.preload = 'auto';
            this._el.addEventListener('ended', () => {
                if (this._loops > 0) { this._loops--; this._el.currentTime = 0; this._el.play().catch(() => {}); return; }
                this._want = false;
                if (this._endevent != null) _post(new Event(this._endevent, {}));
                if (this._queue) { const q = this._queue; this._queue = null; this.load(q); this.play(); }
            });
        }
        return this._el;
    },
    load(filename, namehint = '') {
        const el = this._elem();
        el.pause();
        this._path = String(filename);
        el.src = assets.url(this._path);
        el.volume = this._vol;
        this._want = false;
    },
    unload() { if (this._el) { this._el.pause(); this._el.removeAttribute('src'); this._el.load(); } this._path = null; this._want = false; },
    play(loops = 0, start = 0.0, fade_ms = 0) {
        if (_isKw(loops)) ({ loops = 0, start = 0.0, fade_ms = 0 } = loops);
        const el = this._elem();
        if (!this._path) throw new error('music not loaded');
        el.loop = loops < 0;
        this._loops = loops > 0 ? loops : 0;
        try { el.currentTime = start || 0; } catch { /* not loaded yet */ }
        this._want = true;
        this._startPos = performance.now();
        el.play().catch(() => { /* autoplay blocked: retried on the first user gesture */ });
    },
    _retry() { if (this._want && this._el && this._el.paused) this._el.play().catch(() => {}); },
    rewind() { if (this._el) this._el.currentTime = 0; },
    stop() { if (this._el) { this._el.pause(); try { this._el.currentTime = 0; } catch { /* ignore */ } } this._want = false; },
    pause() { if (this._el) this._el.pause(); this._paused = true; },
    unpause() { if (this._el && this._want) this._el.play().catch(() => {}); this._paused = false; },
    fadeout(ms) {
        const el = this._el;
        if (!el) return;
        const v0 = el.volume, t0 = performance.now();
        const step = () => {
            const k = Math.min(1, (performance.now() - t0) / Math.max(1, ms));
            el.volume = v0 * (1 - k);
            if (k < 1) requestAnimationFrame(step); else { this.stop(); el.volume = this._vol; }
        };
        step();
    },
    set_volume(v) { this._vol = Math.max(0, Math.min(1, v)); if (this._el) this._el.volume = this._vol; },
    get_volume() { return this._vol; },
    /** True while playing — also while waiting for the browser's autoplay unlock (so playlists don't skip). */
    get_busy() { return !!this._want && !this._paused; },
    get_pos() { return this._el && this._want ? Math.floor(this._el.currentTime * 1000) : -1; },
    set_pos(s) { if (this._el) this._el.currentTime = s; },
    queue(filename, namehint = '', loops = 0) { this._queue = String(filename); },
    set_endevent(type = null) { this._endevent = type; },
    get_endevent() { return this._endevent ?? NOEVENT; },
};
mixer.music = music;

// ============================================================ init / quit
let _inited = false;
export function init() { _inited = true; return [6, 0]; }
export function get_init() { return _inited; }
export function quit() {
    _inited = false;
    try { mixer.quit(); } catch { /* ignore */ }
    for (const id of _timers.values()) clearInterval(id);
    _timers.clear();
}
export const version = { ver: '2.5.0-web', vernum: [2, 5, 0] };
export const __file__ = 'web/runtime/pygame.js';
/** Test hook: inject a synthetic event as if it came from the DOM (updates pressed keys / mouse state). */
export function _inject(e) {
    if (e.type === KEYDOWN) _pressed[e.key] = true;
    if (e.type === KEYUP) delete _pressed[e.key];
    if (e.type === MOUSEMOTION || e.type === MOUSEBUTTONDOWN || e.type === MOUSEBUTTONUP) _mousePos = _pair(e.pos).slice();
    _post(e);
}
