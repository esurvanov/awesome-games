// port of game/controls_draw.py
/* Drawing of control markers (called from ui.Game with a single line):
group numbers above units and buildings, Shift-route and patrol flags, several rally points, signals to allies
(on the map and minimap), the order-mode hint, army button icons (stances, formations, orders).
Coordinates go only through Game.w2s / world_to_mm (no hard-coded tile size). */
import * as py from '../runtime/py.js';
import { math, modules } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import * as i18n from './i18n.js';
import { TOP_H } from './data.js';
import { Unit, Building } from './world.js';
import * as orders from './orders.js';

export const GROUP_BG = [28, 24, 18];
export const GROUP_FG = [255, 236, 170];
export const FLAG = [250, 250, 250];
export const PATROL = [120, 200, 255];
export const FLARE = [255, 220, 60];
export const MODE_TIPS = {};     // locale keys
for (const m of ['patrol', 'guard', 'follow', 'amove', 'aground', 'flare']) MODE_TIPS[m] = 'ctl.mode.' + m;

const _int = Math.trunc;

// ============================================================ world
export function draw_world_overlay(g) {
    const scr = g.screen;
    const w = g.world;
    _groups(g, scr, w);
    _routes(g, scr, w);
    _rally_pts(g, scr);
    for (const [x, y, t, _o] of py.getattr(g, 'flares', [])) {
        const a = py.mod(w.time - t, 1.0);
        const [sx, sy] = g.w2s(x, y);
        for (const k of [0.0, 0.5]) {
            const r = _int(6 + py.mod(a + k, 1.0) * 26);
            pygame.draw.ellipse(scr, FLARE, [sx - r, sy - r / 2, 2 * r, r], 2);
        }
        pygame.draw.line(scr, [90, 70, 40], [sx, sy], [sx, sy - 26], 2);
        pygame.draw.polygon(scr, FLARE, [[sx, sy - 26], [sx + 14, sy - 21], [sx, sy - 16]]);
    }
}

export function _groups(g, scr, w) {
    const groups = py.getattr(g, 'groups', null);
    if (!py.bool(groups)) return;
    const view = scr.get_rect();
    for (const [n0, lst] of py.items(groups)) {
        const n = Number(n0);
        if (!py.bool(lst)) continue;
        const label = n < 10 ? String(py.mod(n, 10)) : `${n - 10}`;
        const alt = n >= 10;
        for (const e of lst) {
            if (!e.alive || e.owner !== 0) continue;
            if (e instanceof Unit) {
                const [sx, sy] = g.w2s(e.x, e.y);
                if (!view.collidepoint(sx, sy) || sy < TOP_H) continue;
                const { unit_top_px } = modules.controls;
                const top = unit_top_px(g, e);
                _badge(g, scr, sx + 16, sy - top + 2, label, alt);
            } else if (e instanceof Building) {
                const [sx, sy] = g.w2s(...e.center());
                if (view.collidepoint(sx, sy) && sy >= TOP_H) _badge(g, scr, sx + 20, sy - 40, label, alt);
            }
        }
    }
}

export function _badge(g, scr, x, y, label, alt) {
    const r = new pygame.Rect(0, 0, 13, 13);
    r.center = [_int(x), _int(y)];
    pygame.draw.rect(scr, GROUP_BG, r, 0, 3);
    pygame.draw.rect(scr, alt ? [120, 200, 255] : GROUP_FG, r, 1, 3);
    g.text(label, r.center, 's', GROUP_FG, 'center', false);
}

export function _flag(scr, sx, sy, col, n = null, g = null) {
    pygame.draw.line(scr, [60, 48, 30], [sx, sy], [sx, sy - 16], 2);
    pygame.draw.polygon(scr, col, [[sx, sy - 16], [sx + 10, sy - 12], [sx, sy - 8]]);
    pygame.draw.ellipse(scr, [30, 30, 30], [sx - 4, sy - 2, 8, 4], 1);
}

/** Shift-route flags of the selected units (up to 10, as in DE): one flag per point - in the middle of the formation;
 *  the patrol loop. */
export function _routes(g, scr, w) {
    const units = g.selected.filter(u => u instanceof Unit && u.owner === 0 && u.alive);
    const seen = new Set();
    const legs = [];                       // i-th queue point -> [[x, y], ...] for all units
    for (const u of units) {
        const m = u.mission;
        if (m != null && m[0] === 'patrol') {
            const ring = m[1].map(p => g.w2s(...p));
            const key = py.tkey(ring.map(p => [py.floordiv(_int(p[0]), 24), py.floordiv(_int(p[1]), 24)]));
            if (seen.has(key)) continue;
            seen.add(key);
            if (ring.length > 1) pygame.draw.lines(scr, PATROL, true, ring, 1);
            for (const p of ring) _flag(scr, _int(p[0]), _int(p[1]), PATROL);
            continue;
        }
        let i = 0;
        for (const it of (u.orders || []).slice(0, orders.FLAGS_SHOWN)) {
            let pt;
            if (['move', 'amove', 'aground'].includes(it[0])) {
                pt = [it[1], it[2]];
            } else if (it.length > 1 && it[1] != null && typeof it[1] === 'object' && py.hasattr(it[1], 'center') && it[1].alive) {
                pt = it[1].center();
            } else {
                continue;
            }
            if (legs.length <= i) legs.push([]);
            legs[i].push(pt);
            i += 1;
        }
    }
    if (!legs.length) return;
    const n = units.length;
    let prev = g.w2s(py.sum(units.map(u => u.x)) / n, py.sum(units.map(u => u.y)) / n);
    for (const pts of legs) {
        const c = g.w2s(py.sum(pts.map(p => p[0])) / pts.length, py.sum(pts.map(p => p[1])) / pts.length);
        pygame.draw.line(scr, [230, 230, 230], prev, c, 1);
        _flag(scr, _int(c[0]), _int(c[1]), FLAG);
        prev = c;
    }
}

export function _rally_pts(g, scr) {
    for (const s of g.selected) {
        const pts = py.getattr(s, 'rally_pts', null);
        if (!(s instanceof Building && s.owner === 0 && py.bool(pts) && s.rally != null)) continue;
        const chain = [g.w2s(...s.center())].concat(pts.map(p => g.w2s(...p)));
        const r = s.rally;
        chain.push(g.w2s(...(Array.isArray(r) ? r : r.center())));
        pygame.draw.lines(scr, [255, 230, 120], false, chain, 1);
        for (const p of chain.slice(1, -1)) _flag(scr, _int(p[0]), _int(p[1]), g.pcolor(0));
    }
}

// ============================================================ panel
export function draw_panel_overlay(g) {
    const scr = g.screen;
    const w = g.world;
    for (const [x, y, t, _o] of py.getattr(g, 'flares', [])) {
        const a = py.mod(w.time - t, 0.8) / 0.8;
        const [mx, my] = g.world_to_mm(x, y);
        pygame.draw.circle(scr, FLARE, [_int(mx), _int(my)], _int(3 + a * 9), 2);
    }
    const mode = py.getattr(g, 'order_mode', null);
    if (mode) {
        const tip = Object.hasOwn(MODE_TIPS, mode) ? i18n.t(MODE_TIPS[mode]) : '';
        const img = g.fonts['m'].render(tip, true, [255, 240, 200]);
        const r = img.get_rect({ midtop: [py.floordiv(scr.get_width(), 2), TOP_H + 8] }).inflate(16, 8);
        pygame.draw.rect(scr, [20, 16, 12], r, 0, 6);
        pygame.draw.rect(scr, [200, 170, 100], r, 1, 6);
        scr.blit(img, img.get_rect({ center: r.center }));
    }
}

// ============================================================ army button icons
// DE: orders - a figure of our soldier in a pose (tools/build_portraits.py --orders); stances - in an octagonal
// frame (the active one is green); formations - white balls and a red "roof" (the selected one has green balls)
export const CTL_ART = {
    'patrol': 'portraits/orders/patrol.png', 'guard': 'portraits/orders/guard.png',
    'follow': 'portraits/orders/follow.png', 'amove': 'portraits/orders/amove.png',
    'aground': 'portraits/de/aground.png',
    'aggressive': 'portraits/de/stance_aggressive.png', 'defensive': 'portraits/de/stance_defensive.png',
    'stand_ground': 'portraits/orders/stand_ground.png', 'no_attack': 'portraits/de/stance_no_attack.png',
};
export const STANCES = ['aggressive', 'defensive', 'stand_ground', 'no_attack'];

/** An icon from the built graphics; false - no files (draw procedurally). */
export function _ctl_art(ic, name, active, size) {
    const S = modules.uiskin;
    let art;
    if (orders.FORMATIONS.includes(name)) {
        art = S.icon(`portraits/de/form_${name}${active ? '_on' : ''}.png`, size);
    } else {
        art = Object.hasOwn(CTL_ART, name) ? S.icon(py.get(CTL_ART, name, ''), size) : null;
    }
    if (art == null) return false;
    ic.blit(art, art.get_rect({ center: [py.floordiv(size, 2), py.floordiv(size, 2)] }));
    if (STANCES.includes(name)) {
        const fr = S.icon(`portraits/de/oct${active ? '_on' : ''}.png`, size);
        if (fr != null) ic.blit(fr, [0, 0]);
    } else if (active && !orders.FORMATIONS.includes(name)) {
        pygame.draw.rect(ic, [110, 230, 110], ic.get_rect(), Math.max(2, py.floordiv(size, 20)));
    }
    return true;
}

export function draw_ctl_icon(ic, name, size) {
    const active = name.endsWith('*');
    name = py.rstrip(name, '*');
    if (_ctl_art(ic, name, active, size)) return ic;
    const s = size / 40;
    const c = size / 2;
    const bg = py.get({ 'aggressive': [140, 40, 30], 'defensive': [60, 90, 140], 'stand_ground': [120, 100, 50],
        'no_attack': [70, 70, 70] }, name, orders.FORMATIONS.includes(name) ? [58, 70, 52] : [80, 60, 40]);
    pygame.draw.rect(ic, bg, [2, 2, size - 4, size - 4], 0, _int(6 * s));
    pygame.draw.rect(ic, active ? [255, 215, 90] : _sh(bg, 50), [2, 2, size - 4, size - 4],
        Math.max(1, _int((active ? 3 : 1) * s)), _int(6 * s));
    const wht = [240, 235, 220];
    const steel = [210, 215, 225];

    const P = (x, y) => [c + x * s, c + y * s];

    const sword = (x0, y0, x1, y1, col = steel, wdt = 3) => {
        pygame.draw.line(ic, col, P(x0, y0), P(x1, y1), Math.max(2, _int(wdt * s)));
        const mx = x0 + (x1 - x0) * 0.8, my = y0 + (y1 - y0) * 0.8;
        let dx = y1 - y0, dy = -(x1 - x0);
        const dl = math.hypot(dx, dy) || 1;
        dx = dx / dl * 5;
        dy = dy / dl * 5;
        pygame.draw.line(ic, [190, 150, 60], P(mx - dx, my - dy), P(mx + dx, my + dy), Math.max(2, _int(3 * s)));
    };

    const shield = (x, y, r, col = [90, 130, 200]) => {
        const pts = [P(x - r, y - r), P(x + r, y - r), P(x + r, y + r * 0.2), P(x, y + r * 1.2), P(x - r, y + r * 0.2)];
        pygame.draw.polygon(ic, col, pts);
        pygame.draw.polygon(ic, wht, pts, Math.max(1, _int(1.5 * s)));
    };

    const dots = (pts) => {
        for (const [x, y] of pts) pygame.draw.circle(ic, wht, P(x, y), Math.max(2, _int(2.6 * s)));
    };

    if (name === 'aggressive') {
        sword(-11, 11, 11, -11);
        sword(11, 11, -11, -11);
    } else if (name === 'defensive') {
        shield(-3, -2, 9);
        sword(4, 12, 13, -10);
    } else if (name === 'stand_ground') {
        pygame.draw.line(ic, [70, 50, 30], P(-2, 13), P(-2, -13), Math.max(2, _int(3 * s)));
        pygame.draw.polygon(ic, [220, 60, 50], [P(-2, -13), P(12, -8), P(-2, -3)]);
        pygame.draw.line(ic, wht, P(-12, 13), P(10, 13), Math.max(2, _int(2 * s)));
    } else if (name === 'no_attack') {
        sword(-10, 10, 10, -10);
        pygame.draw.circle(ic, [230, 60, 50], P(0, 0), 14 * s, Math.max(2, _int(3 * s)));
        pygame.draw.line(ic, [230, 60, 50], P(-10, -10), P(10, 10), Math.max(2, _int(3 * s)));
    } else if (name === 'patrol') {
        for (const x of [-10, 10]) {
            pygame.draw.line(ic, [70, 50, 30], P(x, 12), P(x, -8), Math.max(2, _int(2 * s)));
            pygame.draw.polygon(ic, PATROL, [P(x, -12), P(x + 8, -9), P(x, -6)]);
        }
        pygame.draw.line(ic, wht, P(-7, 4), P(7, 4), Math.max(2, _int(2 * s)));
        pygame.draw.polygon(ic, wht, [P(8, 4), P(3, 0), P(3, 8)]);
        pygame.draw.polygon(ic, wht, [P(-8, 4), P(-3, 0), P(-3, 8)]);
    } else if (name === 'guard') {
        shield(0, -2, 11, [200, 170, 70]);
        pygame.draw.circle(ic, wht, P(0, -1), 3 * s);
    } else if (name === 'follow') {
        [-10, 0, 10].forEach((x, i) => {
            pygame.draw.circle(ic, i < 2 ? wht : [120, 230, 120], P(x, 4 - i * 4), Math.max(2, _int(3.5 * s)));
        });
        pygame.draw.polygon(ic, [120, 230, 120], [P(14, -10), P(6, -10), P(12, -3)]);
    } else if (name === 'amove') {
        sword(-12, 10, 6, -8);
        pygame.draw.polygon(ic, [255, 120, 90], [P(13, -13), P(3, -12), P(12, -3)]);
        pygame.draw.line(ic, [255, 120, 90], P(-4, 12), P(12, 12), Math.max(2, _int(2 * s)));
    } else if (name === 'aground') {
        pygame.draw.ellipse(ic, [140, 110, 70], [c - 14 * s, c + 4 * s, 28 * s, 10 * s]);
        pygame.draw.circle(ic, [230, 70, 50], P(0, 0), 11 * s, Math.max(2, _int(2 * s)));
        pygame.draw.line(ic, [230, 70, 50], P(-14, 0), P(14, 0), Math.max(1, _int(2 * s)));
        pygame.draw.line(ic, [230, 70, 50], P(0, -14), P(0, 14), Math.max(1, _int(2 * s)));
    } else if (name === 'line') {
        const pts = [];
        for (const y of [-6, 6]) for (const x of [-12, -4, 4, 12]) pts.push([x, y]);
        dots(pts);
    } else if (name === 'box') {
        const pts = [];
        for (const x of [-10, 0, 10]) for (const y of [-10, 0, 10]) if (!(x === 0 && y === 0)) pts.push([x, y]);
        dots(pts);
        pygame.draw.circle(ic, [255, 200, 120], P(0, 0), Math.max(2, _int(2.6 * s)));
    } else if (name === 'staggered') {
        dots([[-12, -7], [0, -7], [12, -7], [-6, 7], [6, 7]]);
    } else if (name === 'flank') {
        dots([[-14, -6], [-7, -6], [-14, 6], [-7, 6], [7, -6], [14, -6], [7, 6], [14, 6]]);
    }
    return ic;
}

export function _sh(c, d) {
    return c.map(v => Math.max(0, Math.min(255, v + d)));
}
