// port of game/widgets.py
/* Simple menu screen elements in the spirit of AoE2 DE (drawn by code - without Microsoft art):
a red button with a golden edge, a dropdown field, a checkbox, a tab, a slider, a heading plate.
*/
import * as py from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import * as S from './uiskin.js';

export const RED = [128, 22, 16];
export const RED_HI = [168, 40, 28];
export const RED_DK = [70, 10, 8];
export const PAPER = [222, 200, 156];
export const PAPER_DK = [196, 170, 122];
export const INK = [52, 32, 14];
export const GOLD = S.GOLD;
export const _cache = new Map();       // py.tkey(tuple key) -> Surface

const _int = Math.trunc;

export function _grad(size, top, bot) {
    const key = py.tkey(['g', [size[0], size[1]], top, bot]);
    let g = _cache.get(key);
    if (g == null) {
        const [w, h] = size;
        g = new pygame.Surface(size);
        for (let y = 0; y < h; y++) {
            const t = y / Math.max(1, h - 1);
            pygame.draw.line(g, [0, 1, 2].map(i => _int(top[i] + (bot[i] - top[i]) * t)), [0, y], [w, y]);
        }
        if (_cache.size > 400) _cache.clear();
        _cache.set(key, g);
    }
    return g;
}

/** A DE button: burgundy, with a golden edge; state: normal | hover | pressed | disabled | on. */
export function red_button(surf, rect, label, f, state = 'normal', icon = null) {
    const r = new pygame.Rect(rect);
    let top, bot;
    if (state === 'disabled') [top, bot] = [[96, 84, 78], [60, 52, 48]];
    else if (state === 'hover' || state === 'on') [top, bot] = [[190, 52, 36], [112, 20, 14]];
    else if (state === 'pressed') [top, bot] = [[100, 16, 10], [140, 30, 22]];
    else [top, bot] = [[156, 34, 24], [92, 14, 10]];
    surf.blit(_grad(r.size, top, bot), r.topleft);
    pygame.draw.rect(surf, [24, 8, 4], r.inflate(2, 2), 1);
    pygame.draw.rect(surf, state !== 'disabled' ? [230, 184, 96] : [150, 140, 120], r, 1);
    pygame.draw.rect(surf, [90, 50, 20], r.inflate(-4, -4), 1);
    if (state === 'on') pygame.draw.rect(surf, S.GOLD_HI, r.inflate(4, 4), 2);
    const col = state !== 'disabled' ? [255, 240, 205] : [190, 180, 165];
    let x = r.centerx;
    let avail = r.w - 16;
    if (icon) {
        S.blit_icon(surf, icon, [r.x + py.floordiv(r.h, 2) + 4, r.centery], r.h - 12);
        x += py.floordiv(r.h, 3);
        avail -= r.h + 4;
    }
    S.text_fit(surf, label, [x, r.centery], f, col, 'center', [30, 8, 4], avail);
}

/** A dropdown field: a light plate, text on the left, a diamond arrow on the right. */
export function field(surf, rect, label, f, hover = false, arrow = true, color = INK, enabled = true) {
    const r = new pygame.Rect(rect);
    surf.blit(_grad(r.size, hover ? [238, 222, 186] : [226, 208, 168], [206, 184, 140]), r.topleft);
    pygame.draw.rect(surf, [120, 92, 52], r, 1);
    pygame.draw.line(surf, [255, 246, 220], [r.x + 1, r.y + 1], [r.right - 2, r.y + 1]);
    if (!enabled) S.shade_overlay(surf, r, [120, 110, 100], 110);
    S.text_fit(surf, label, [r.x + 8, r.centery], f, enabled ? color : [110, 96, 80], 'midleft', null,
        r.w - 12 - (arrow ? 20 : 0));
    if (arrow) {
        const cx = r.right - 13, cy = r.centery;
        const pts = [[cx - 6, cy - 3], [cx + 6, cy - 3], [cx, cy + 4]];
        pygame.draw.polygon(surf, [90, 60, 28], pts);
        pygame.draw.polygon(surf, [40, 24, 10], pts, 1);
    }
}

/** An open list under the anchor field (or above it if it does not fit). items - captions.
 *  Returns [[rect, index]]. */
export function dropdown_list(surf, anchor, items, f, cur = null, hover_i = null, row_h = 24, max_h = null) {
    const a = new pygame.Rect(anchor);
    const h = row_h * items.length + 4;
    let y = a.bottom;
    const sh = surf.get_height();
    if (y + h > sh - 6) y = Math.max(6, a.y - h);
    const box = new pygame.Rect(a.x, y, Math.max(a.w, 120), h);
    pygame.draw.rect(surf, [20, 12, 6], box.move(3, 3));
    pygame.draw.rect(surf, [238, 224, 190], box);
    pygame.draw.rect(surf, [110, 70, 30], box, 2);
    const out = [];
    items.forEach((lbl, i) => {
        const r = new pygame.Rect(box.x + 2, box.y + 2 + i * row_h, box.w - 4, row_h);
        let col;
        if (i === hover_i) {
            pygame.draw.rect(surf, RED_HI, r);
            col = [255, 240, 210];
        } else if (i === cur) {
            pygame.draw.rect(surf, [214, 190, 140], r);
            col = INK;
        } else {
            col = INK;
        }
        S.text_fit(surf, lbl, [r.x + 8, r.centery], f, col, 'midleft', null, r.w - 12);
        out.push([r, i]);
    });
    return out;
}

/** The same rectangles that dropdown_list draws (for clicks without drawing). */
export function list_rects(surf_h, anchor, n, row_h = 24) {
    const a = new pygame.Rect(anchor);
    const h = row_h * n + 4;
    let y = a.bottom;
    if (y + h > surf_h - 6) y = Math.max(6, a.y - h);
    const w = Math.max(a.w, 120);
    const out = [];
    for (let i = 0; i < n; i++) out.push([new pygame.Rect(a.x + 2, y + 2 + i * row_h, w - 4, row_h), i]);
    return out;
}

export function checkbox(surf, rect, on, label, f, hover = false, color = INK) {
    const r = new pygame.Rect(rect);
    const b = new pygame.Rect(r.x, r.centery - 8, 16, 16);
    pygame.draw.rect(surf, !hover ? [236, 222, 190] : [250, 240, 214], b);
    pygame.draw.rect(surf, [90, 60, 28], b, 1);
    if (on) pygame.draw.lines(surf, [170, 24, 16], false, [[b.x + 3, b.y + 8], [b.x + 7, b.y + 12], [b.x + 13, b.y + 3]], 3);
    S.text_fit(surf, label, [b.right + 8, r.centery], f, color, 'midleft', null, r.right - b.right - 8);
}

export function tab(surf, rect, label, f, on, hover = false, icon = null) {
    const r = new pygame.Rect(rect);
    const [top, bot] = on ? [[236, 216, 172], [214, 190, 140]] : (hover ? [[150, 40, 28], [96, 18, 12]]
        : [[120, 30, 20], [74, 12, 8]]);
    surf.blit(_grad(r.size, top, bot), r.topleft);
    pygame.draw.rect(surf, [230, 184, 96], r, 1);
    const col = on ? INK : [250, 232, 200];
    let x = r.centerx;
    let avail = r.w - 12;
    if (icon) {
        S.blit_icon(surf, icon, [r.x + 20, r.centery], 22);
        x += 10;
        avail -= 44;
    }
    S.text_fit(surf, label, [x, r.centery], f, col, 'center', on ? null : [20, 6, 2], avail);
}

/** A 0...1 slider: a track and a handle. Returns the track (for clicks). */
export function slider(surf, rect, v, hover = false) {
    const r = new pygame.Rect(rect);
    const tr = new pygame.Rect(r.x, r.centery - 4, r.w, 8);
    pygame.draw.rect(surf, [70, 50, 30], tr, 0, 4);
    pygame.draw.rect(surf, [200, 60, 40], [tr.x, tr.y, _int(tr.w * v), tr.h], 0, 4);
    pygame.draw.rect(surf, [30, 18, 8], tr, 1, 4);
    const kx = tr.x + _int(tr.w * v);
    pygame.draw.circle(surf, [30, 18, 8], [kx + 1, tr.centery + 1], 10);
    pygame.draw.circle(surf, hover ? [240, 206, 130] : [214, 176, 100], [kx, tr.centery], 10);
    pygame.draw.circle(surf, [110, 70, 28], [kx, tr.centery], 10, 2);
    return tr;
}

/** A screen heading plate (like "Standard Game" in DE): a light ribbon with ornaments on the sides. */
export function plate(surf, center, text, f, w = null) {
    if (w) [f, text] = S.fit_text(f, text, w - 24);
    const img = f.render(text, true, INK);
    w = w || img.get_width() + 120;
    const r = new pygame.Rect(0, 0, w, img.get_height() + 16);
    r.center = center;
    surf.blit(_grad(r.size, [246, 234, 204], [216, 196, 150]), r.topleft);
    pygame.draw.rect(surf, [120, 84, 40], r, 2);
    pygame.draw.rect(surf, [250, 240, 214], r.inflate(-6, -6), 1);
    for (const side of [-1, 1]) {
        const x0 = side < 0 ? r.left - 10 : r.right + 10;
        const x1 = x0 + side * 90;
        pygame.draw.line(surf, [120, 84, 40], [x0, r.centery], [x1, r.centery], 3);
        pygame.draw.circle(surf, [170, 40, 26], [x1, r.centery], 5);
        pygame.draw.circle(surf, [120, 84, 40], [x1, r.centery], 5, 1);
    }
    surf.blit(img, img.get_rect({ center: r.center }));
    return r;
}

/** A nested frame on parchment (the players / parameters block). */
export function box(surf, rect, alpha = 70) {
    const r = new pygame.Rect(rect);
    S.shade_overlay(surf, r, [90, 60, 20], alpha);
    pygame.draw.rect(surf, [120, 84, 40], r, 2);
    pygame.draw.rect(surf, [240, 222, 180], r.inflate(-6, -6), 1);
}

export function color_badge(surf, rect, color, num, f, hover = false) {
    const r = new pygame.Rect(rect);
    pygame.draw.rect(surf, [20, 12, 6], r.inflate(2, 2));
    pygame.draw.rect(surf, color, r);
    pygame.draw.rect(surf, hover ? [255, 255, 255] : [230, 210, 170], r, 2);
    S.text(surf, py.str(num), r.center, f, [255, 255, 255], 'center', [0, 0, 0]);
}
