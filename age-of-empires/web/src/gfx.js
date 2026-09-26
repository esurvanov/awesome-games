// port of game/gfx.py
// Procedural isometric graphics: buildings, trees, resources, units.
// All images are drawn by code - no third-party pictures.
import * as py from '../runtime/py.js';
import { math, random } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import { BUILDINGS, UNITS, RES_COLOR, HW, HH, shade } from './data.js';

export { BUILDINGS, UNITS, RES_COLOR, HW, HH, shade };

const _int = Math.trunc;

export const _shadow_cache = new Map();

export function shadow(surf, x, y, w, h, a = 70) {
    const key = _int(w) + ',' + _int(h) + ',' + a;
    let s = _shadow_cache.get(key);
    if (s === undefined) {
        s = new pygame.Surface([Math.max(1, _int(w)), Math.max(1, _int(h))], pygame.SRCALPHA);
        pygame.draw.ellipse(s, [0, 0, 0, a], s.get_rect());
        _shadow_cache.set(key, s);
    }
    surf.blit(s, [_int(x), _int(y)]);
}

// ============================================================ units
export function draw_unit(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null,
    moving = false) {
    // face - direction in screen coordinates.
    const [fx, fy] = face;
    const hx = fx >= 0 ? 1 : -1;
    const dark = shade(color, -80);
    const skin = [232, 190, 145];
    const bob = moving ? Math.sin(anim) * 1.0 * k : 0;

    const P = (a, b, bb = true) => [_int(x + a * k), _int(y + b * k + (bb ? bob : 0))];

    const lw = Math.max(1, _int(2 * k));
    if (kind === 'scout' || kind === 'knight') {
        shadow(surf, x - 14 * k, y - 3 * k, 28 * k, 9 * k);
        const horse = kind === 'scout' ? [130, 88, 50] : [75, 62, 55];
        [-7, -4, 5, 8].forEach((lx, i) => {
            const off = moving ? Math.sin(anim + i * 1.7) * 2.5 : 0;
            pygame.draw.line(surf, shade(horse, -40), P(lx, -3), P(lx + off, 3, false), lw);
        });
        pygame.draw.ellipse(surf, horse, [...P(-11, -11), _int(22 * k), _int(10 * k)]);
        if (kind === 'knight') pygame.draw.ellipse(surf, color, [...P(-9, -10), _int(18 * k), _int(8 * k)]);
        pygame.draw.line(surf, shade(horse, -30), P(-10 * hx, -8), P(-15 * hx, -2), lw);
        pygame.draw.polygon(surf, horse, [P(6 * hx, -10), P(11 * hx, -16), P(14 * hx, -13), P(9 * hx, -6)]);
        pygame.draw.circle(surf, horse, P(13 * hx, -14), _int(3.3 * k));
        pygame.draw.ellipse(surf, dark, [...P(-11, -11), _int(22 * k), _int(10 * k)], 1);
        pygame.draw.circle(surf, color, P(0, -15), _int(4.6 * k));
        pygame.draw.circle(surf, dark, P(0, -15), _int(4.6 * k), 1);
        const head = kind === 'knight' ? [175, 175, 185] : skin;
        pygame.draw.circle(surf, head, P(0, -21), _int(3.2 * k));
        const s = swing * 20;
        if (kind === 'knight') pygame.draw.line(surf, [200, 180, 140], P(2 * hx, -15), P((19 + s * 0.3) * hx, -22 + s * 0.4), lw);
        else pygame.draw.line(surf, [210, 210, 220], P(3 * hx, -15), P(10 * hx, -21 + s * 0.4), lw);
        return;
    }
    if (kind === 'ram') {
        shadow(surf, x - 16 * k, y - 4 * k, 32 * k, 11 * k);
        const wood = [125, 88, 52];
        const s = swing * 12;
        pygame.draw.line(surf, [95, 68, 40], P((6 + s) * hx, -7), P((18 + s) * hx, -7), Math.max(2, _int(4 * k)));
        pygame.draw.circle(surf, [150, 150, 160], P((18 + s) * hx, -7), _int(3 * k));
        pygame.draw.rect(surf, wood, [...P(-13, -13), _int(26 * k), _int(12 * k)]);
        pygame.draw.polygon(surf, shade(wood, 20), [P(-15, -11), P(0, -21), P(15, -11)]);
        pygame.draw.polygon(surf, shade(wood, -40), [P(-15, -11), P(0, -21), P(15, -11)], 1);
        pygame.draw.line(surf, color, P(-13, -5), P(13, -5), Math.max(1, _int(3 * k)));
        pygame.draw.rect(surf, shade(wood, -50), [...P(-13, -13), _int(26 * k), _int(12 * k)], 1);
        for (const wx of [-9, 9]) {
            pygame.draw.circle(surf, [60, 45, 30], P(wx, 0, false), _int(3.5 * k));
            pygame.draw.circle(surf, [110, 90, 60], P(wx, 0, false), _int(1.5 * k));
        }
        return;
    }
    const art = Object.hasOwn(UNITS, kind) ? py.get(UNITS[kind], 'art') : py.get(ART, kind);
    if (typeof art === 'function') {
        art(surf, kind, color, x, y, face, anim, swing, k, carry_res, moving);
        return;
    }
    const key = py.tkey([kind, py.id(art)]);
    let spec = _SPEC.get(key);
    if (spec === undefined) {
        spec = { ...py.get(FOOT_ART, kind, { helmet: 'hood', weapon: 'sword' }) };
        if (art && py.bool(art)) Object.assign(spec, art);
        _SPEC.set(key, spec);
    }
    // **spec -> draw_foot's keyword parameters (helmet, weapon, shield)
    draw_foot(surf, color, x, y, face, anim, swing, k, carry_res, moving, spec.helmet, spec.weapon, spec.shield);
}

export const _SPEC = new Map();      // (kind, id(art)) -> the assembled look of a foot unit (FOOT_ART + UNITS[kind]['art'])

// extra "poses" without their own entry in UNITS (for example, the unpacked trebuchet - Unit.look()):
// kind -> a drawing function with the same signature as UNITS[kind]['art']; filled in by content
export const ART = {};

// appearance of foot units: helmet and weapon (content sets the same through UNITS[kind]['art'])
export const FOOT_ART = {
    'villager': { helmet: 'hat', weapon: 'tool' },
    'militia': { helmet: 'iron', weapon: 'sword' },
    'spearman': { helmet: 'iron', weapon: 'spear' },
    'archer': { helmet: 'hood', weapon: 'bow' },
    'skirmisher': { helmet: 'hood', weapon: 'javelin' },
};

export function draw_foot(surf, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null, moving = false,
    helmet = 'hood', weapon = null, shield = false) {
    // A little foot figure. helmet: 'hat' | 'iron' | 'crest' | 'hood'; weapon: 'tool' | 'sword' | 'longsword' |
    // 'spear' | 'bow' | 'javelin' | None; shield - a round shield in player color.
    const [fx, fy] = face;
    const hx = fx >= 0 ? 1 : -1;
    const dark = shade(color, -80);
    const skin = [232, 190, 145];
    const bob = moving ? Math.sin(anim) * 1.0 * k : 0;

    const P = (a, b, bb = true) => [_int(x + a * k), _int(y + b * k + (bb ? bob : 0))];

    const lw = Math.max(1, _int(2 * k));
    shadow(surf, x - 7 * k, y - 2 * k, 14 * k, 5 * k);
    const ls = moving ? Math.sin(anim) * 2.2 : 0;
    pygame.draw.line(surf, shade(dark, -10), P(-2, -4), P(-2 + ls, 1, false), lw);
    pygame.draw.line(surf, shade(dark, -10), P(2, -4), P(2 - ls, 1, false), lw);
    if (carry_res) {
        pygame.draw.rect(surf, RES_COLOR[carry_res], [...P(-8 * hx - 3, -12), _int(6 * k), _int(6 * k)]);
        pygame.draw.rect(surf, [40, 30, 20], [...P(-8 * hx - 3, -12), _int(6 * k), _int(6 * k)], 1);
    }
    pygame.draw.circle(surf, color, P(0, -8), _int(5.5 * k));
    pygame.draw.circle(surf, dark, P(0, -8), _int(5.5 * k), 1);
    pygame.draw.circle(surf, skin, P(0, -15), _int(3.4 * k));
    if (helmet === 'hat') {
        pygame.draw.ellipse(surf, [205, 175, 105], [...P(-5, -19), _int(10 * k), _int(4 * k)]);
    } else if (helmet === 'iron') {
        pygame.draw.ellipse(surf, [160, 160, 172], [...P(-3.8, -19.5), _int(7.6 * k), _int(5.5 * k)]);
    } else if (helmet === 'crest') {
        // closed helmet with a nasal guard and a crest in player color
        pygame.draw.ellipse(surf, [130, 132, 145], [...P(-4.2, -20), _int(8.4 * k), _int(6.5 * k)]);
        pygame.draw.line(surf, [95, 96, 108], P(1.5 * hx, -17), P(1.5 * hx, -13.5), Math.max(1, _int(1.3 * k)));
        pygame.draw.line(surf, shade(color, 30), P(-3 * hx, -21), P(2 * hx, -21.5), Math.max(1, _int(2 * k)));
    } else {
        pygame.draw.ellipse(surf, shade(color, -40), [...P(-3.8, -19.5), _int(7.6 * k), _int(5 * k)]);
    }
    if (shield) {
        const [sx, sy] = P(-5 * hx, -9);
        pygame.draw.circle(surf, shade(color, -20), [sx, sy], Math.max(2, _int(3.6 * k)));
        pygame.draw.circle(surf, [185, 170, 120], [sx, sy], Math.max(2, _int(3.6 * k)), 1);
        pygame.draw.circle(surf, [200, 200, 210], [sx, sy], Math.max(1, _int(1 * k)));
    }
    const hand = P(5 * hx, -8);
    const s = swing > 0 ? swing / 0.3 : 0;
    if (weapon === 'tool') {
        const tip = P((9 - s * 2) * hx, -16 + s * 9);
        pygame.draw.line(surf, [120, 88, 55], hand, tip, lw);
        pygame.draw.circle(surf, [150, 150, 160], tip, Math.max(1, _int(1.8 * k)));
    } else if (weapon === 'sword') {
        pygame.draw.line(surf, [215, 215, 225], hand, P((12 + s * 2) * hx, -15 + s * 9), lw);
        pygame.draw.line(surf, [120, 90, 50], P(4 * hx, -10), P(6 * hx, -6), lw);
    } else if (weapon === 'longsword') {
        pygame.draw.line(surf, [225, 225, 235], hand, P((14 + s * 3) * hx, -18 + s * 11), lw);
        pygame.draw.line(surf, [190, 160, 70], P(3 * hx, -10), P(7 * hx, -6), lw);
    } else if (weapon === 'spear') {
        pygame.draw.line(surf, [140, 105, 65], P(3 * hx, 0), P((10 + s * 5) * hx, -25 + s * 6), lw);
        pygame.draw.circle(surf, [200, 200, 210], P((10 + s * 5) * hx, -25 + s * 6), Math.max(1, _int(1.8 * k)));
    } else if (weapon === 'bow') {
        const [bx, by] = P(6 * hx, -10);
        const r = new pygame.Rect(0, 0, _int(8 * k), _int(16 * k));
        r.center = [bx, by];
        if (hx > 0) pygame.draw.arc(surf, [130, 85, 40], r, -Math.PI / 2, Math.PI / 2, lw);
        else pygame.draw.arc(surf, [130, 85, 40], r, Math.PI / 2, 3 * Math.PI / 2, lw);
        pygame.draw.line(surf, [220, 220, 220], [bx, r.top], [bx, r.bottom], 1);
    } else if (weapon === 'javelin') {
        pygame.draw.line(surf, [150, 115, 70], P(2 * hx, -5), P((12 + s * 3) * hx, -17), lw);
        pygame.draw.polygon(surf, [100, 150, 180], [P(3 * hx, -8), P(-3 * hx, -5), P(-2 * hx, 0), P(4 * hx, -2)]);
    }
}

// ============================================================ nature
export const TREE_ANCHOR = [30, 78];     // the tree's "root" point in the sprite

export function make_tree(seed) {
    const rnd = random.Random(seed * 7919 + 13);
    const s = new pygame.Surface([60, 84], pygame.SRCALPHA);
    const [ax, ay] = TREE_ANCHOR;
    pygame.draw.ellipse(s, [0, 0, 0, 70], [ax - 20, ay - 8, 44, 14]);
    pygame.draw.rect(s, [92, 62, 36], [ax - 3, ay - 26, 6, 26]);
    if (py.mod(seed, 3) === 2) {   // fir
        const base = [36 + rnd.randint(-6, 6), 88 + rnd.randint(-10, 10), 48];
        [[42, ay - 14], [34, ay - 30], [26, ay - 44], [16, ay - 56]].forEach(([w, y], i) => {
            const c = shade(base, i * 8);
            const pts = [[ax - Math.floor(w / 2), y], [ax, y - 22], [ax + Math.floor(w / 2), y]];
            pygame.draw.polygon(s, shade(base, -25), pts.map(p => [p[0] + 2, p[1] + 2]));
            pygame.draw.polygon(s, c, pts);
            pygame.draw.line(s, shade(c, 25), [ax - Math.floor(w / 4), y - 6], [ax, y - 20], 1);
        });
    } else {
        // the three randint calls happen left to right, as in the Python tuple
        const r0 = 58 + rnd.randint(-10, 10), r1 = 116 + rnd.randint(-15, 15), r2 = 48 + rnd.randint(-8, 8);
        const base = [r0, r1, r2];
        const blobs = [[ax, ay - 42, 17], [ax - 11, ay - 34, 12], [ax + 11, ay - 33, 12], [ax, ay - 56, 12],
            [ax - 8, ay - 50, 10], [ax + 9, ay - 49, 10]];
        for (const [bx, by, r] of blobs) pygame.draw.circle(s, shade(base, -38), [bx + 2, by + 3], r);
        for (const [bx, by, r] of blobs) pygame.draw.circle(s, base, [bx, by], r);
        for (const [bx, by, r] of blobs) pygame.draw.circle(s, shade(base, 22), [bx - Math.floor(r / 3), by - Math.floor(r / 3)], Math.floor(r / 2));
        for (let i = 0; i < 10; i++) {
            const px = ax + rnd.randint(-14, 14);
            const pyy = ay - rnd.randint(34, 62);
            pygame.draw.circle(s, shade(base, 40), [px, pyy], 2);
        }
    }
    return s;
}

export function make_rocks(color, seed, sparkle = false) {
    const rnd = random.Random(seed * 31 + 7);
    const s = new pygame.Surface([64, 40], pygame.SRCALPHA);
    pygame.draw.ellipse(s, [0, 0, 0, 60], [8, 20, 48, 18]);
    for (let i = 0; i < 6; i++) {
        const w = rnd.randint(14, 22);
        const h = rnd.randint(10, 15);
        const x = rnd.randint(8, 56 - w);
        const y = rnd.randint(8, 34 - h);
        const c = shade(color, rnd.randint(-25, 15));
        pygame.draw.ellipse(s, c, [x, y, w, h]);
        pygame.draw.ellipse(s, shade(c, -60), [x, y, w, h], 1);
        pygame.draw.ellipse(s, shade(c, 45), [x + 3, y + 2, Math.floor(w / 2), Math.floor(h / 3)]);
    }
    if (sparkle) {
        for (let i = 0; i < 5; i++) {
            const px = rnd.randint(12, 52), pyy = rnd.randint(10, 30);
            pygame.draw.circle(s, [255, 250, 200], [px, pyy], 1);
        }
    }
    return s;
}

export function make_bush(seed) {
    const rnd = random.Random(seed * 17 + 3);
    const s = new pygame.Surface([64, 44], pygame.SRCALPHA);
    pygame.draw.ellipse(s, [0, 0, 0, 60], [12, 26, 40, 14]);
    for (const [bx, by, r] of [[32, 22, 13], [22, 26, 10], [42, 26, 10], [32, 30, 9]]) {
        pygame.draw.circle(s, [46, 104, 42], [bx, by], r);
        pygame.draw.circle(s, [68, 132, 58], [bx - 3, by - 3], Math.floor(r / 2));
    }
    for (let i = 0; i < 14; i++) {
        const px = rnd.randint(20, 44), pyy = rnd.randint(14, 34);
        pygame.draw.circle(s, [205, 40, 72], [px, pyy], 2);
    }
    return s;
}

// ============================================================ buildings
export class IsoPainter {
    // Draws volumetric boxes/roofs in isometry; coordinates are tiles and height in pixels.
    constructor(surf, ox, oy) {
        this.s = surf;
        this.ox = ox; this.oy = oy;
    }

    P(x, y, z = 0.0) {
        return [this.ox + (x - y) * HW, this.oy + (x + y) * HH - z];
    }

    poly(pts, color, outline = true) {
        const sp = pts.map(p => this.P(...p));
        pygame.draw.polygon(this.s, color, sp);
        if (outline) pygame.draw.polygon(this.s, shade(color, -70), sp, 1);
    }

    line(a, b, color, w = 1) {
        pygame.draw.line(this.s, color, this.P(...a), this.P(...b), w);
    }

    box(x0, y0, x1, y1, h, color, z0 = 0.0, top = true, tex = null) {
        const lc = color;
        const rc = shade(color, -38);
        // left (south-west) face: y = y1
        this.poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z0 + h], [x0, y1, z0 + h]], lc);
        // right (south-east) face: x = x1
        this.poly([[x1, y1, z0], [x1, y0, z0], [x1, y0, z0 + h], [x1, y1, z0 + h]], rc);
        if (tex === 'stone') {
            for (let z = _int(z0) + 6; z < _int(z0 + h) - 1; z += 6) {
                this.line([x0, y1, z], [x1, y1, z], shade(lc, -22));
                this.line([x1, y1, z], [x1, y0, z], shade(rc, -22));
            }
        } else if (tex === 'wood') {
            let n = Math.max(2, _int((x1 - x0) * 6));
            for (let i = 1; i < n; i++) {
                const t = x0 + (x1 - x0) * i / n;
                this.line([t, y1, z0], [t, y1, z0 + h], shade(lc, -25));
            }
            n = Math.max(2, _int((y1 - y0) * 6));
            for (let i = 1; i < n; i++) {
                const t = y0 + (y1 - y0) * i / n;
                this.line([x1, t, z0], [x1, t, z0 + h], shade(rc, -25));
            }
        } else if (tex === 'timber') {
            this.line([x0, y1, z0 + h * 0.5], [x1, y1, z0 + h * 0.5], shade(lc, -90), 2);
            this.line([x1, y1, z0 + h * 0.5], [x1, y0, z0 + h * 0.5], shade(rc, -90), 2);
            this.line([x0, y1, z0], [x0 + (x1 - x0) * 0.3, y1, z0 + h], shade(lc, -90), 2);
            this.line([x1, y1 - (y1 - y0) * 0.3, z0 + h], [x1, y0, z0], shade(rc, -90), 2);
        }
        if (top) this.poly([[x0, y0, z0 + h], [x1, y0, z0 + h], [x1, y1, z0 + h], [x0, y1, z0 + h]], shade(color, 22));
    }

    gable(x0, y0, x1, y1, z, rh, color, wall, axis = 'x', ov = 0.1) {
        if (axis === 'x') {
            const ym = (y0 + y1) / 2;
            this.poly([[x0 - ov, y0 - ov, z], [x1 + ov, y0 - ov, z], [x1 + ov, ym, z + rh], [x0 - ov, ym, z + rh]],
                shade(color, -30));
            this.poly([[x1, y0, z], [x1, y1, z], [x1, ym, z + rh]], shade(wall, -38));
            this.poly([[x0 - ov, y1 + ov, z], [x1 + ov, y1 + ov, z], [x1 + ov, ym, z + rh], [x0 - ov, ym, z + rh]],
                color);
            const n = _int((x1 - x0) * 5);
            for (let i = 1; i < n + 1; i++) {
                const t = x0 - ov + (x1 - x0 + 2 * ov) * i / (n + 1);
                this.line([t, y1 + ov, z], [t, ym, z + rh], shade(color, -28));
            }
            this.line([x0 - ov, ym, z + rh], [x1 + ov, ym, z + rh], shade(color, 40), 2);
        } else {
            const xm = (x0 + x1) / 2;
            this.poly([[x0 - ov, y0 - ov, z], [x0 - ov, y1 + ov, z], [xm, y1 + ov, z + rh], [xm, y0 - ov, z + rh]],
                shade(color, -30));
            this.poly([[x0, y1, z], [x1, y1, z], [xm, y1, z + rh]], wall);
            this.poly([[x1 + ov, y0 - ov, z], [x1 + ov, y1 + ov, z], [xm, y1 + ov, z + rh], [xm, y0 - ov, z + rh]],
                shade(color, -18));
            const n = _int((y1 - y0) * 5);
            for (let i = 1; i < n + 1; i++) {
                const t = y0 - ov + (y1 - y0 + 2 * ov) * i / (n + 1);
                this.line([x1 + ov, t, z], [xm, t, z + rh], shade(color, -45));
            }
            this.line([xm, y0 - ov, z + rh], [xm, y1 + ov, z + rh], shade(color, 40), 2);
        }
    }

    hip(x0, y0, x1, y1, z, rh, color, ov = 0.1) {
        [x0, y0, x1, y1] = [x0 - ov, y0 - ov, x1 + ov, y1 + ov];
        const a = [(x0 + x1) / 2, (y0 + y1) / 2, z + rh];
        this.poly([[x0, y0, z], [x1, y0, z], a], shade(color, -40));
        this.poly([[x0, y0, z], [x0, y1, z], a], shade(color, -30));
        this.poly([[x0, y1, z], [x1, y1, z], a], color);
        this.poly([[x1, y0, z], [x1, y1, z], a], shade(color, -22));
    }

    crenels(x0, y0, x1, y1, z, color, step = 0.32, sz = 0.14, h = 5) {
        let pts = [];
        let n = Math.max(1, _int((x1 - x0) / step));
        for (let i = 0; i < n + 1; i++) {
            const t = x0 + (x1 - x0) * i / n;
            pts.push([t, y0]);
            pts.push([t, y1]);
        }
        n = Math.max(1, _int((y1 - y0) / step));
        for (let i = 0; i < n + 1; i++) {
            const t = y0 + (y1 - y0) * i / n;
            pts.push([x0, t]);
            pts.push([x1, t]);
        }
        const uniq = new py.TSet(pts.map(([a, b]) => [py.round(a, 3), py.round(b, 3)]));
        pts = py.sorted(uniq, p => p[0] + p[1]);
        for (const [cx, cy] of pts) this.box(cx - sz / 2, cy - sz / 2, cx + sz / 2, cy + sz / 2, h, color, z);
    }

    door(xm, y1, w, h, color = [58, 40, 26]) {
        this.poly([[xm - w / 2, y1, 0], [xm + w / 2, y1, 0], [xm + w / 2, y1, h], [xm, y1, h + 4],
            [xm - w / 2, y1, h]], color);
    }

    window_l(xm, y1, z, w = 0.12, h = 7) {
        this.poly([[xm - w / 2, y1, z], [xm + w / 2, y1, z], [xm + w / 2, y1, z + h], [xm - w / 2, y1, z + h]],
            [45, 38, 34], false);
    }

    window_r(x1, ym, z, w = 0.12, h = 7) {
        this.poly([[x1, ym - w / 2, z], [x1, ym + w / 2, z], [x1, ym + w / 2, z + h], [x1, ym - w / 2, z + h]],
            [38, 32, 30], false);
    }

    flag(x, y, z, color, h = 18) {
        const [bx, by] = this.P(x, y, z);
        pygame.draw.line(this.s, [70, 50, 35], [bx, by], [bx, by - h], 2);
        pygame.draw.polygon(this.s, color, [[bx + 1, by - h], [bx + 13, by - h + 4], [bx + 1, by - h + 9]]);
        pygame.draw.polygon(this.s, shade(color, -60), [[bx + 1, by - h], [bx + 13, by - h + 4], [bx + 1, by - h + 9]], 1);
    }

    banner_l(xm, y1, z, color, w = 0.18, h = 12) {
        this.poly([[xm - w / 2, y1 + 0.01, z], [xm + w / 2, y1 + 0.01, z], [xm + w / 2, y1 + 0.01, z - h],
            [xm, y1 + 0.01, z - h - 4], [xm - w / 2, y1 + 0.01, z - h]], color);
    }

    emblem(x, y, z, color, kind) {
        let [cx, cy] = this.P(x, y, z);
        cx = _int(cx); cy = _int(cy);
        const r = 7;
        pygame.draw.circle(this.s, color, [cx, cy], r);
        pygame.draw.circle(this.s, shade(color, -70), [cx, cy], r, 1);
        const wc = [245, 240, 230];
        if (kind === 'swords') {
            pygame.draw.line(this.s, wc, [cx - 4, cy + 4], [cx + 4, cy - 4], 2);
            pygame.draw.line(this.s, wc, [cx - 4, cy - 4], [cx + 4, cy + 4], 2);
        } else if (kind === 'target') {
            pygame.draw.circle(this.s, wc, [cx, cy], 4, 1);
            pygame.draw.circle(this.s, wc, [cx, cy], 1);
        } else if (kind === 'horseshoe') {
            pygame.draw.arc(this.s, wc, [cx - 4, cy - 4, 8, 9], 0, Math.PI, 2);
            pygame.draw.line(this.s, wc, [cx - 4, cy], [cx - 4, cy + 3], 2);
            pygame.draw.line(this.s, wc, [cx + 3, cy], [cx + 3, cy + 3], 2);
        } else if (kind === 'anvil') {
            pygame.draw.polygon(this.s, wc, [[cx - 5, cy - 2], [cx + 5, cy - 2], [cx + 2, cy + 1], [cx + 2, cy + 4],
                [cx - 2, cy + 4], [cx - 2, cy + 1]]);
        } else if (kind === 'wheel') {
            pygame.draw.circle(this.s, wc, [cx, cy], 4, 1);
            pygame.draw.line(this.s, wc, [cx - 4, cy], [cx + 4, cy], 1);
            pygame.draw.line(this.s, wc, [cx, cy - 4], [cx, cy + 4], 1);
        } else if (kind === 'crown') {
            pygame.draw.polygon(this.s, wc, [[cx - 5, cy + 3], [cx - 5, cy - 2], [cx - 2, cy + 1], [cx, cy - 4],
                [cx + 2, cy + 1], [cx + 5, cy - 2], [cx + 5, cy + 3]]);
        }
    }

    logs(x, y, n = 3) {
        for (let i = 0; i < n; i++) {
            let [cx, cy] = this.P(x, y, 4 + i * 5);
            cx += (i % 2) * 5;
            pygame.draw.ellipse(this.s, [130, 88, 50], [cx - 12, cy - 3, 20, 7]);
            pygame.draw.ellipse(this.s, [195, 155, 105], [cx + 4, cy - 3, 6, 7]);
            pygame.draw.ellipse(this.s, [90, 60, 35], [cx + 4, cy - 3, 6, 7], 1);
        }
    }

    rocks(x, y, color, n = 4) {
        const rnd = random.Random(_int(x * 100 + y * 7));
        for (let i = 0; i < n; i++) {
            const u = rnd.uniform(-0.2, 0.2);
            const v = rnd.uniform(-0.2, 0.2);
            const [cx, cy] = this.P(x + u, y + v, 0);
            pygame.draw.ellipse(this.s, color, [cx - 6, cy - 7, 12, 9]);
            pygame.draw.ellipse(this.s, shade(color, -60), [cx - 6, cy - 7, 12, 9], 1);
        }
    }
}

export const STONE = [182, 175, 160];
export const STONE_D = [160, 152, 138];
export const PLASTER = [214, 196, 160];
export const WOOD = [168, 124, 80];
export const ROOF_RED = [170, 68, 44];
export const ROOF_BROWN = [128, 82, 52];
export const ROOF_SLATE = [86, 90, 104];

export function make_building_sprite(kind, color) {
    // Returns (surface, ox, oy): (ox, oy) is where the top corner of the base diamond is in the sprite.
    const d = BUILDINGS[kind];
    const s = d['size'];
    const extra = py.get(d, 'art_h') || py.get({ 'tower': 120, 'castle': 130, 'town_center': 110 }, kind, 80);
    const W = s * 2 * HW;
    const Hh = s * 2 * HH;
    const surf = new pygame.Surface([W + 8, Hh + extra + 4], pygame.SRCALPHA);
    const ox = Math.floor(W / 2) + 4, oy = extra;
    const p = new IsoPainter(surf, ox, oy);
    // shadow (shifted east)
    const sh = new pygame.Surface(surf.get_size(), pygame.SRCALPHA);
    const ps = new IsoPainter(sh, ox + 10, oy + 2);
    pygame.draw.polygon(sh, [0, 0, 0, 55], [ps.P(0.1, 0.1), ps.P(s - 0.1, 0.1), ps.P(s - 0.1, s - 0.1),
        ps.P(0.1, s - 0.1)]);
    surf.blit(sh, [0, 0]);

    const art = py.get(d, 'art');
    if (typeof art === 'function') {
        // a content building draws itself: art(painter, surf, color, size)
        art(p, surf, color, s);
    } else if (kind === 'house') {
        p.poly([[0.1, 0.1], [1.9, 0.1], [1.9, 1.9], [0.1, 1.9]], [150, 130, 95], false);
        p.box(0.35, 0.35, 1.65, 1.65, 18, PLASTER, undefined, false, 'timber');
        p.door(0.95, 1.65, 0.28, 12);
        p.window_r(1.65, 1.0, 8);
        p.gable(0.35, 0.35, 1.65, 1.65, 18, 20, ROOF_RED, PLASTER, 'x');
        p.box(1.2, 0.6, 1.36, 0.76, 10, [120, 110, 100], 28);
        p.banner_l(0.55, 1.65, 17, color);
    } else if (kind === 'mill') {
        p.box(0.4, 0.4, 1.6, 1.6, 26, STONE, undefined, false, 'stone');
        p.door(1.0, 1.6, 0.3, 13);
        p.hip(0.4, 0.4, 1.6, 1.6, 26, 22, ROOF_BROWN);
        p.banner_l(0.6, 1.6, 24, color);
        const [hx, hy] = p.P(1.6, 1.25, 30);
        for (let a = 0; a < 4; a++) {
            const ang = Math.PI / 4 + a * Math.PI / 2 + 0.2;
            const ex = hx + Math.cos(ang) * 34, ey = hy + Math.sin(ang) * 34;
            const px = -Math.sin(ang) * 7, pyy = Math.cos(ang) * 7;
            const mx = hx + Math.cos(ang) * 12, my = hy + Math.sin(ang) * 12;
            pygame.draw.polygon(surf, [236, 226, 200], [[mx, my], [ex, ey], [ex + px, ey + pyy], [mx + px, my + pyy]]);
            pygame.draw.polygon(surf, [120, 95, 60], [[mx, my], [ex, ey], [ex + px, ey + pyy], [mx + px, my + pyy]], 1);
            pygame.draw.line(surf, [100, 72, 44], [hx, hy], [ex, ey], 2);
        }
        pygame.draw.circle(surf, [80, 60, 40], [_int(hx), _int(hy)], 4);
    } else if (kind === 'lumber_camp') {
        for (const [px_, py_] of [[0.3, 0.3], [1.3, 0.3], [0.3, 1.2], [1.3, 1.2]]) {
            p.box(px_, py_, px_ + 0.1, py_ + 0.1, 20, [110, 78, 48], undefined, false);
        }
        p.box(0.3, 0.3, 1.4, 0.55, 20, WOOD, undefined, false, 'wood');
        p.gable(0.3, 0.3, 1.4, 1.3, 20, 14, [122, 90, 56], WOOD, 'x');
        p.logs(1.1, 1.6, 3);
        p.logs(0.5, 1.7, 2);
        p.banner_l(0.8, 1.3, 19, color);
    } else if (kind === 'mining_camp') {
        for (const [px_, py_] of [[0.3, 0.3], [1.3, 0.3], [0.3, 1.2], [1.3, 1.2]]) {
            p.box(px_, py_, px_ + 0.1, py_ + 0.1, 18, [110, 78, 48], undefined, false);
        }
        p.box(0.3, 0.3, 1.4, 0.55, 18, STONE_D, undefined, false, 'stone');
        p.gable(0.3, 0.3, 1.4, 1.3, 18, 14, [112, 98, 84], STONE_D, 'y');
        p.rocks(1.55, 1.2, [150, 150, 156], 4);
        p.rocks(1.2, 1.65, [232, 192, 48], 3);
        p.banner_l(0.8, 1.3, 17, color);
    } else if (kind === 'town_center') {
        p.box(0.1, 0.1, 3.9, 3.9, 8, [164, 155, 138], undefined, undefined, null);
        for (const [tx_, ty_] of [[0.25, 0.25]]) {
            p.box(tx_, ty_, tx_ + 0.7, ty_ + 0.7, 52, STONE, 8, false, 'stone');
            p.hip(tx_, ty_, tx_ + 0.7, ty_ + 0.7, 60, 16, ROOF_SLATE, 0.06);
        }
        for (const [tx_, ty_] of [[3.05, 0.25], [0.25, 3.05]]) {
            p.box(tx_, ty_, tx_ + 0.7, ty_ + 0.7, 52, STONE, 8, false, 'stone');
            p.hip(tx_, ty_, tx_ + 0.7, ty_ + 0.7, 60, 16, ROOF_SLATE, 0.06);
        }
        p.box(0.8, 0.8, 3.2, 3.2, 36, PLASTER, 8, false, 'timber');
        p.door(2.0, 3.2, 0.5, 20);
        for (const xm of [1.2, 2.8]) p.window_l(xm, 3.2, 26);
        for (const ym of [1.4, 2.6]) p.window_r(3.2, ym, 26);
        p.hip(0.8, 0.8, 3.2, 3.2, 44, 40, ROOF_BROWN, 0.15);
        p.banner_l(1.5, 3.2, 40, color, 0.22, 16);
        p.banner_l(2.5, 3.2, 40, color, 0.22, 16);
        p.box(3.05, 3.05, 3.75, 3.75, 52, STONE, 8, false, 'stone');
        p.hip(3.05, 3.05, 3.75, 3.75, 60, 16, ROOF_SLATE, 0.06);
        p.flag(2.0, 2.0, 84, color, 22);
        p.emblem(2.0, 3.2, 30, color, 'crown');
    } else if (kind === 'barracks' || kind === 'blacksmith') {
        const wall = kind === 'barracks' ? STONE : [150, 140, 128];
        p.box(0.35, 0.35, 2.65, 2.65, 30, wall, undefined, false, 'stone');
        p.door(1.5, 2.65, 0.45, 18);
        p.window_l(0.8, 2.65, 18);
        p.window_l(2.2, 2.65, 18);
        p.window_r(2.65, 1.0, 18);
        p.window_r(2.65, 2.0, 18);
        if (kind === 'barracks') {
            p.gable(0.35, 0.35, 2.65, 2.65, 30, 30, [140, 52, 44], wall, 'y');
            p.emblem(1.5, 2.65, 38, color, 'swords');
            p.banner_l(0.6, 2.65, 28, color);
            p.banner_l(2.4, 2.65, 28, color);
        } else {
            p.hip(0.35, 0.35, 2.65, 2.65, 30, 28, [72, 70, 78]);
            p.box(1.9, 0.8, 2.2, 1.1, 24, [80, 74, 72], 40);
            const [cx, cy] = p.P(2.05, 0.95, 66);
            for (let i = 0; i < 3; i++) {
                pygame.draw.circle(surf, [170, 170, 170, 110], [_int(cx + i * 4), _int(cy - i * 9)], 5 + i * 2);
            }
            p.emblem(1.5, 2.65, 36, color, 'anvil');
            p.banner_l(0.6, 2.65, 28, color);
        }
    } else if (kind === 'archery_range') {
        p.box(0.3, 0.3, 2.7, 1.5, 26, WOOD, undefined, false, 'wood');
        p.gable(0.3, 0.3, 2.7, 1.5, 26, 22, [82, 108, 60], WOOD, 'x');
        p.emblem(1.5, 1.5, 22, color, 'target');
        for (const tx_ of [0.7, 1.5, 2.3]) {
            const [cx, cy] = p.P(tx_, 2.5, 0);
            pygame.draw.line(surf, [110, 80, 50], [cx, cy], [cx, cy - 16], 2);
            pygame.draw.circle(surf, [230, 220, 190], [_int(cx), _int(cy - 20)], 7);
            pygame.draw.circle(surf, [200, 50, 45], [_int(cx), _int(cy - 20)], 4);
            pygame.draw.circle(surf, [240, 230, 200], [_int(cx), _int(cy - 20)], 1);
        }
        p.banner_l(0.6, 1.5, 24, color);
    } else if (kind === 'stable') {
        p.box(0.3, 0.3, 2.7, 1.6, 24, [176, 134, 88], undefined, false, 'wood');
        p.gable(0.3, 0.3, 2.7, 1.6, 24, 22, [150, 108, 62], [176, 134, 88], 'x');
        for (let i = 0; i < 3; i++) p.door(0.8 + i * 0.7, 1.6, 0.35, 14, [70, 48, 30]);
        // pen
        for (const t of [0.3, 1.0, 1.7, 2.4, 2.7]) p.box(t - 0.03, 2.62, t + 0.03, 2.68, 10, [130, 95, 60], undefined, false);
        p.line([0.3, 2.65, 8], [2.7, 2.65, 8], [140, 100, 62], 2);
        p.line([0.3, 2.65, 4], [2.7, 2.65, 4], [140, 100, 62], 2);
        const [cx, cy] = p.P(2.2, 2.1, 0);
        pygame.draw.ellipse(surf, [220, 190, 90], [cx - 10, cy - 8, 20, 10]);
        p.emblem(1.5, 1.6, 20, color, 'horseshoe');
        p.banner_l(0.5, 1.6, 22, color);
    } else if (kind === 'tower') {
        p.box(0.2, 0.2, 0.8, 0.8, 78, STONE, undefined, true, 'stone');
        p.box(0.12, 0.12, 0.88, 0.88, 6, shade(STONE, 8), 78);
        p.crenels(0.12, 0.12, 0.88, 0.88, 84, STONE, 0.25, 0.12);
        p.window_l(0.5, 0.8, 52, 0.1, 9);
        p.window_r(0.8, 0.5, 52, 0.1, 9);
        p.door(0.5, 0.8, 0.22, 12);
        p.banner_l(0.5, 0.8, 74, color, 0.2, 14);
        p.flag(0.5, 0.5, 90, color, 18);
    } else if (kind === 'siege_workshop') {
        p.box(0.3, 0.3, 3.7, 3.0, 32, WOOD, undefined, false, 'wood');
        p.door(2.0, 3.0, 1.0, 24, [64, 44, 28]);
        p.gable(0.3, 0.3, 3.7, 3.0, 32, 30, [110, 86, 62], WOOD, 'x');
        p.emblem(2.0, 3.0, 40, color, 'wheel');
        p.logs(3.2, 3.5, 3);
        p.banner_l(0.7, 3.0, 30, color);
        p.banner_l(3.3, 3.0, 30, color);
    } else if (kind === 'castle') {
        const T = 0.95;
        const corners = [[0.1, 0.1], [3.9 - T, 0.1], [0.1, 3.9 - T], [3.9 - T, 3.9 - T]];
        for (const [tx_, ty_] of corners.slice(0, 3)) {
            p.box(tx_, ty_, tx_ + T, ty_ + T, 58, STONE, undefined, true, 'stone');
            p.crenels(tx_, ty_, tx_ + T, ty_ + T, 58, STONE, 0.3);
        }
        p.box(0.4, 0.4, 3.6, 3.6, 40, STONE_D, undefined, true, 'stone');
        p.crenels(0.4, 0.4, 3.6, 3.6, 40, STONE_D, 0.34);
        p.box(1.3, 1.3, 2.7, 2.7, 86, STONE, 0, true, 'stone');
        p.crenels(1.3, 1.3, 2.7, 2.7, 86, STONE, 0.3);
        p.banner_l(2.0, 2.7, 80, color, 0.3, 20);
        p.window_l(1.65, 2.7, 58, 0.1, 10);
        p.window_l(2.35, 2.7, 58, 0.1, 10);
        p.window_r(2.7, 2.0, 58, 0.1, 10);
        p.flag(2.0, 2.0, 92, color, 24);
        p.door(2.0, 3.6, 0.6, 22, [50, 38, 30]);
        p.banner_l(1.1, 3.6, 36, color);
        p.banner_l(2.9, 3.6, 36, color);
        const [tx_, ty_] = corners[3];
        p.box(tx_, ty_, tx_ + T, ty_ + T, 58, STONE, undefined, true, 'stone');
        p.crenels(tx_, ty_, tx_ + T, ty_ + T, 58, STONE, 0.3);
        p.banner_l(tx_ + T / 2, ty_ + T, 52, color);
    } else {
        // a generic building - for new content without its own graphics
        const m = s > 1 ? 0.3 : 0.15;
        p.box(m, m, s - m, s - m, 12 + 8 * s, STONE, undefined, false, 'stone');
        p.door(s / 2, s - m, 0.3 * s / 2, 12);
        p.gable(m, m, s - m, s - m, 12 + 8 * s, 10 + 6 * s, ROOF_RED, STONE, 'x');
        p.banner_l(s / 2 - 0.3 * s / 2 - 0.1, s - m, 10 + 8 * s, color);
    }
    return [surf, ox, oy];
}

export function draw_farm(surf, ox, oy, size, prog, fill) {
    // A farm - a diamond of soil with furrows; (ox, oy) is the top corner of the base.
    const p = new IsoPainter(surf, ox, oy);
    const soil = prog >= 1 ? [122, 90, 56] : [150, 122, 86];
    p.poly([[0.05, 0.05], [size - 0.05, 0.05], [size - 0.05, size - 0.05], [0.05, size - 0.05]], soil, false);
    const rows = 8;
    const rnd = random.Random(7);
    for (let i = 1; i < rows; i++) {
        const t = size * i / rows;
        p.line([t, 0.15, 0], [t, size - 0.15, 0], shade(soil, -28), 2);
        if (prog >= 1 && fill > 0) {
            for (let j = 0; j < 12; j++) {
                const u = 0.2 + (size - 0.4) * j / 11;
                if (rnd.random() < 0.2 + 0.8 * fill) {
                    const [x, y] = p.P(t - 0.06, u, 0);
                    const h = 3 + 4 * fill;
                    pygame.draw.line(surf, fill > 0.3 ? [222, 196, 92] : [140, 170, 70], [x, y], [x + 1, y - h], 2);
                }
            }
        }
    }
    pygame.draw.polygon(surf, [96, 70, 44], [p.P(0.05, 0.05), p.P(size - 0.05, 0.05), p.P(size - 0.05, size - 0.05),
        p.P(0.05, size - 0.05)], 2);
}

export function draw_animal(surf, kind, x, y, face = [1.0, 0.0], anim = 0.0, moving = false, dead = false, collar = null, k = 1.0) {
    const hx = face[0] >= 0 ? 1 : -1;
    const lw = Math.max(1, _int(2 * k));

    const P = (a, b) => [_int(x + a * k), _int(y + b * k)];

    if (dead) {
        const body = py.get({ 'sheep': [225, 222, 210], 'deer': [150, 100, 60], 'boar': [80, 60, 45],
            'wolf': [110, 106, 100] }, kind, [120, 100, 80]);
        shadow(surf, x - 11 * k, y - 4 * k, 22 * k, 7 * k);
        pygame.draw.ellipse(surf, body, [...P(-10, -6), _int(20 * k), _int(8 * k)]);
        pygame.draw.ellipse(surf, [150, 40, 35], [...P(-4, -4), _int(8 * k), _int(4 * k)]);
        pygame.draw.ellipse(surf, shade(body, -60), [...P(-10, -6), _int(20 * k), _int(8 * k)], 1);
        return;
    }
    const ls = moving ? Math.sin(anim) * 2 : 0;
    if (kind === 'sheep') {
        shadow(surf, x - 10 * k, y - 3 * k, 20 * k, 6 * k);
        [-5, -2, 3, 6].forEach((lx, i) => {
            const o = i % 2 ? ls : -ls;
            pygame.draw.line(surf, [60, 55, 50], P(lx, -4), P(lx + o, 0), lw);
        });
        const wool = [236, 234, 224];
        const blobs = [[-4, -9, 5], [0, -10, 5.5], [4, -9, 5], [0, -7, 5]];
        for (const [bx, by, r] of blobs) pygame.draw.circle(surf, shade(wool, -30), P(bx + 0.5, by + 1), _int(r * k));
        for (const [bx, by, r] of blobs) pygame.draw.circle(surf, wool, P(bx, by), _int(r * k));
        pygame.draw.ellipse(surf, [70, 64, 60], [...P(7 * hx - 3, -12), _int(6 * k), _int(5 * k)]);
        if (collar) pygame.draw.circle(surf, collar, P(5 * hx, -9), Math.max(1, _int(2 * k)));
    } else if (kind === 'deer') {
        const c = [165, 110, 62];
        shadow(surf, x - 11 * k, y - 3 * k, 22 * k, 6 * k);
        [-6, -3, 4, 7].forEach((lx, i) => {
            const o = i % 2 ? ls : -ls;
            pygame.draw.line(surf, shade(c, -50), P(lx, -8), P(lx + o, 0), lw);
        });
        pygame.draw.ellipse(surf, c, [...P(-9, -13), _int(18 * k), _int(8 * k)]);
        pygame.draw.ellipse(surf, [230, 215, 190], [...P(hx < 0 ? -9 * hx : -9, -10), _int(6 * k), _int(3 * k)]);
        pygame.draw.line(surf, c, P(7 * hx, -11), P(10 * hx, -18), Math.max(2, _int(3 * k)));
        pygame.draw.ellipse(surf, c, [...P(10 * hx - 3, -21), _int(7 * k), _int(5 * k)]);
        pygame.draw.line(surf, [215, 200, 170], P(10 * hx, -21), P(8 * hx, -27), 1);
        pygame.draw.line(surf, [215, 200, 170], P(11 * hx, -21), P(14 * hx, -27), 1);
    } else if (kind === 'wolf') {
        const c = [118, 112, 104];
        shadow(surf, x - 11 * k, y - 3 * k, 22 * k, 6 * k);
        [-6, -3, 4, 7].forEach((lx, i) => {
            const o = i % 2 ? ls : -ls;
            pygame.draw.line(surf, shade(c, -45), P(lx, -7), P(lx + o, 0), lw);
        });
        pygame.draw.ellipse(surf, c, [...P(-9, -13), _int(18 * k), _int(7 * k)]);
        pygame.draw.ellipse(surf, [178, 172, 160], [...P(-5, -9), _int(10 * k), _int(3 * k)]);
        pygame.draw.line(surf, shade(c, -20), P(-8 * hx, -11), P(-14 * hx, -8), Math.max(2, _int(2 * k)));
        pygame.draw.polygon(surf, c, [P(6 * hx, -14), P(14 * hx, -12), P(10 * hx, -8), P(6 * hx, -9)]);
        pygame.draw.polygon(surf, shade(c, -30), [P(7 * hx, -14), P(8 * hx, -18), P(10 * hx, -14)]);
        pygame.draw.circle(surf, [230, 200, 60], P(10 * hx, -12), Math.max(1, _int(k)));
    } else if (kind === 'wolf') {        // (unreachable in the Python source too - kept 1:1)
        const c = [122, 118, 110];
        shadow(surf, x - 11 * k, y - 3 * k, 22 * k, 6 * k);
        [-6, -3, 4, 7].forEach((lx, i) => {
            const o = i % 2 ? ls : -ls;
            pygame.draw.line(surf, shade(c, -45), P(lx, -7), P(lx + o, 0), lw);
        });
        pygame.draw.ellipse(surf, c, [...P(-9, -13), _int(18 * k), _int(7 * k)]);
        pygame.draw.ellipse(surf, shade(c, 40), [...P(-6, -10), _int(10 * k), _int(3 * k)]);
        pygame.draw.line(surf, shade(c, -20), P(-9 * hx, -11), P(-14 * hx, -7), Math.max(2, _int(2 * k)));     // tail
        pygame.draw.polygon(surf, c, [P(7 * hx, -14), P(14 * hx, -12), P(8 * hx, -9)]);                     // muzzle
        pygame.draw.polygon(surf, shade(c, -30), [P(7 * hx, -14), P(8 * hx, -18), P(10 * hx, -14)]);       // ear
    } else {  // boar
        const c = [84, 64, 48];
        shadow(surf, x - 12 * k, y - 3 * k, 24 * k, 7 * k);
        [-6, -3, 4, 7].forEach((lx, i) => {
            const o = i % 2 ? ls : -ls;
            pygame.draw.line(surf, shade(c, -30), P(lx, -5), P(lx + o, 0), Math.max(2, _int(3 * k)));
        });
        pygame.draw.ellipse(surf, c, [...P(-11, -14), _int(22 * k), _int(11 * k)]);
        for (let i = 0; i < 5; i++) pygame.draw.line(surf, shade(c, -35), P(-6 + i * 3, -14), P(-7 + i * 3, -17), 1);
        pygame.draw.polygon(surf, shade(c, 10), [P(8 * hx, -12), P(15 * hx, -8), P(8 * hx, -5)]);
        pygame.draw.line(surf, [240, 235, 220], P(12 * hx, -7), P(14 * hx, -11), 1);
    }
}
