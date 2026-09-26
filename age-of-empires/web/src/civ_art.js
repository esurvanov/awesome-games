// port of game/civ_art.py
// Procedural civilization graphics: unique units (regular and elite) and coats of arms.
// Everything is drawn by code (pygame.draw) - no third-party images. Unit functions return art with the signature
// UNITS[kind]['art']: art(surf, kind, color, x, y, face, anim, swing, k, carry_res, moving).
// Coats of arms are draw_emblem(surf, rect, spec): a shield with a field division and a charge (spec is CIVS[civ]['emblem']).
import * as py from '../runtime/py.js';
import { math, modules } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import { shade } from './data.js';
// civ_units (content) calls mangudai()/cataphract()/... while the content package is still loading, before _all.js
// fills py.modules - so the function-local `from .content import _army_art` becomes a static import (no cycle:
// _army_art imports only data).
import * as _army_art from './content/_army_art.js';

export { shade };

const _int = Math.trunc;

export const SKIN = [232, 190, 145];
export const IRON = [160, 162, 175];
export const IRON_D = [105, 106, 118];
export const STEEL = [220, 222, 232];
export const WOOD = [125, 88, 52];
export const WOOD_D = [88, 62, 38];
export const GOLD = [236, 196, 70];
export const FUR = [120, 86, 52];
export const WHITE = [238, 234, 222];

const _sum = c => c[0] + c[1] + c[2];

export function _P(x, y, k, bob) {
    function P(a, b, bb = true) {
        return [_int(x + a * k), _int(y + b * k + (bb ? bob : 0))];
    }
    return P;
}

export function _shadow(surf, x, y, w, h) {
    const gfx = modules.gfx;
    gfx.shadow(surf, x, y, w, h);
}

export function _poly(surf, c, pts, outline = null) {
    pygame.draw.polygon(surf, c, pts);
    if (outline) pygame.draw.polygon(surf, outline, pts, 1);
}

// ============================================================ infantry
export function _foot(surf, color, x, y, face, anim, k, moving, skin = SKIN, torso = null, legs = null, sc = 1.0) {
    // Body of a foot soldier (legs, torso, head). Returns (P, hx) - points already scaled by sc.
    const hx = face[0] >= 0 ? 1 : -1;
    const bob = moving ? Math.sin(anim) * 1.0 * k : 0;
    const kk = k * sc;
    const P = _P(x, y, kk, bob);
    const lw = Math.max(1, _int(2 * kk));
    _shadow(surf, x - 7 * kk, y - 2 * kk, 14 * kk, 5 * kk);
    const ls = moving ? Math.sin(anim) * 2.2 : 0;
    const lc = legs || shade(color, -90);
    pygame.draw.line(surf, lc, P(-2, -4), P(-2 + ls, 1, false), lw);
    pygame.draw.line(surf, lc, P(2, -4), P(2 - ls, 1, false), lw);
    const tc = torso || color;
    pygame.draw.circle(surf, tc, P(0, -8), _int(5.5 * kk));
    pygame.draw.circle(surf, shade(tc, -80), P(0, -8), _int(5.5 * kk), 1);
    pygame.draw.circle(surf, skin, P(0, -15), _int(3.4 * kk));
    return [P, hx, kk];
}

export function _round_shield(surf, P, hx, kk, color, big = false, front = false, pattern = null) {
    const [sx, sy] = P((front ? 3 : -5) * hx, -9);
    const r = _int((big ? 5.2 : 3.8) * kk);
    pygame.draw.circle(surf, color, [sx, sy], Math.max(2, r));
    if (pattern === 'quarter') {
        pygame.draw.line(surf, WHITE, [sx - r, sy], [sx + r, sy], Math.max(1, _int(kk)));
        pygame.draw.line(surf, WHITE, [sx, sy - r], [sx, sy + r], Math.max(1, _int(kk)));
    } else if (pattern === 'spiral') {
        pygame.draw.arc(surf, WHITE, [sx - Math.floor(r / 2), sy - Math.floor(r / 2), r, r], 0, 4.5, Math.max(1, _int(kk)));
    }
    pygame.draw.circle(surf, [120, 90, 55], [sx, sy], Math.max(2, r), Math.max(1, _int(kk)));
    pygame.draw.circle(surf, STEEL, [sx, sy], Math.max(1, _int(1.3 * kk)));
}

export function axeman(elite) {
    // Throwing axeman: helmet with a nasal guard, a francisca in the raised hand, a spare axe on the belt.
    function art(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null, moving = false) {
        const [P, hx, kk] = _foot(surf, color, x, y, face, anim, k, moving);
        const lw = Math.max(1, _int(2 * kk));
        if (elite) _round_shield(surf, P, hx, kk, shade(color, -25), undefined, undefined, 'quarter');
        // belt and a spare hatchet
        pygame.draw.line(surf, [90, 60, 35], P(-4.5, -5), P(4.5, -5), Math.max(1, _int(1.5 * kk)));
        pygame.draw.line(surf, WOOD, P(-2 * hx, -5), P(-3 * hx, -1), lw);
        pygame.draw.polygon(surf, STEEL, [P(-3 * hx, -2), P(-5.5 * hx, -3), P(-5 * hx, 0)]);
        // helmet
        pygame.draw.ellipse(surf, IRON, [...P(-3.8, -20), _int(7.6 * kk), _int(5.8 * kk)]);
        pygame.draw.line(surf, IRON_D, P(1.6 * hx, -17), P(1.6 * hx, -13.5), Math.max(1, _int(1.2 * kk)));
        if (elite) pygame.draw.line(surf, shade(color, 50), P(-3 * hx, -20.5), P(2 * hx, -21.5), Math.max(2, _int(2 * kk)));
        // axe arm: wind-up back -> throw forward
        const s = swing > 0 ? swing / 0.3 : 0;
        const hand = P(s < 0.5 ? (3 - 6 * (1 - s)) * hx : 6 * hx, -13 + 5 * s);
        const sh = P(2 * hx, -10);
        pygame.draw.line(surf, SKIN, sh, hand, lw);
        if (s < 0.5) {
            const [hx0, hy0] = hand;
            const top = [hx0 - _int(1 * kk * hx), hy0 - _int(9 * kk)];
            pygame.draw.line(surf, WOOD, hand, top, lw);
            const [tx, ty] = top;
            const blade = [[tx, ty - _int(0.5 * kk)], [tx + _int(5.5 * kk * hx), ty - _int(2.5 * kk)],
                [tx + _int(6 * kk * hx), ty + _int(3.5 * kk)], [tx, ty + _int(2.5 * kk)]];
            pygame.draw.polygon(surf, STEEL, blade);
            pygame.draw.polygon(surf, IRON_D, blade, 1);
        }
    }
    return art;
}

export function longbow(elite) {
    // Longbowman: hood, a bow taller than a man, a quiver on the back.
    function art(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null, moving = false) {
        const [P, hx, kk] = _foot(surf, color, x, y, face, anim, k, moving, undefined, !elite ? [96, 120, 64] : null);
        const lw = Math.max(1, _int(2 * kk));
        // quiver
        pygame.draw.line(surf, [110, 70, 40], P(-4 * hx, -14), P(-6 * hx, -4), Math.max(2, _int(3 * kk)));
        for (let i = 0; i < 3; i++) {
            pygame.draw.line(surf, WHITE, P((-4 - i * 0.6) * hx, -14 - i * 0.3), P((-3.5 - i * 0.6) * hx, -16.5), 1);
        }
        if (elite) {
            // padded coat over it: a belt in player color, a kettle hat
            pygame.draw.line(surf, shade(color, -50), P(-4.5, -6), P(4.5, -6), Math.max(1, _int(1.5 * kk)));
            pygame.draw.ellipse(surf, IRON, [...P(-5.5, -18.5), _int(11 * kk), _int(3.2 * kk)]);
            pygame.draw.ellipse(surf, IRON_D, [...P(-3, -21), _int(6 * kk), _int(4 * kk)]);
        } else {
            // hood in player color with a tail
            pygame.draw.ellipse(surf, shade(color, -30), [...P(-4, -20), _int(8 * kk), _int(6 * kk)]);
            pygame.draw.line(surf, shade(color, -30), P(-3 * hx, -17), P(-6 * hx, -13), Math.max(1, _int(2 * kk)));
        }
        // tall bow: from the knee to the crown and above
        const s = swing > 0 ? swing / 0.3 : 0;
        const [bx, by] = P((7 + s) * hx, -12);
        const r = new pygame.Rect(0, 0, _int((8 - 2 * s) * kk), _int(30 * kk));
        r.center = [bx, by];
        const a0 = hx > 0 ? -Math.PI / 2 : Math.PI / 2;
        pygame.draw.arc(surf, [140, 92, 44], r, a0, a0 + Math.PI, lw);
        const sx = bx - _int((2 + 3 * (1 - s)) * kk * hx);
        pygame.draw.line(surf, [230, 230, 225], [bx, r.top], [sx, by], 1);
        pygame.draw.line(surf, [230, 230, 225], [bx, r.bottom], [sx, by], 1);
        pygame.draw.line(surf, SKIN, P(2 * hx, -10), [sx, by], Math.max(1, _int(1.5 * kk)));
    }
    return art;
}

export function _rider_pts(x, y, k, anim, moving, camel = false) {
    const bob = moving ? Math.sin(anim) * 1.0 * k : 0;
    const legh = camel ? 5 : 3;
    const by = -11 - (legh - 3);
    const ry = by - 4;
    return [_P(x, y, k, bob), by, ry, ry - 6];
}

// aa.rider(horse=(110, 76, 48), bard=None, head='helm', weapon='sword', camel=False, plume=False, big=False)
function _aa() { return modules['content._army_art'] || _army_art; }

export function mangudai(elite) {
    // Mangudai: a small steppe horse, a fur hat with a colored top, a bow.
    const aa = _aa();
    const base = aa.rider(!elite ? [176, 140, 90] : [150, 118, 80], elite ? 'cloth' : null, 'skin', 'bow');

    function art(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null, moving = false) {
        base(surf, kind, color, x, y, face, anim, swing, k, carry_res, moving);
        const hx = face[0] >= 0 ? 1 : -1;
        const [P, by, ry, hy] = _rider_pts(x, y, k, anim, moving);
        // mane
        pygame.draw.line(surf, [60, 44, 30], P(9 * hx, by - 4), P(12 * hx, by - 6), Math.max(1, _int(2 * k)));
        // hat: a colored cone and a fur brim
        _poly(surf, shade(color, 10), [P(-2.8, hy - 2), P(0.5 * hx, hy - 8.5), P(2.8, hy - 2)]);
        pygame.draw.ellipse(surf, FUR, [...P(-4.2, hy - 3.6), _int(8.4 * k), _int(3.4 * k)]);
        pygame.draw.ellipse(surf, shade(FUR, -40), [...P(-4.2, hy - 3.6), _int(8.4 * k), _int(3.4 * k)], 1);
        if (elite) {
            pygame.draw.circle(surf, GOLD, P(0.5 * hx, hy - 8.5), Math.max(1, _int(1.3 * k)));
            pygame.draw.line(surf, [245, 245, 240], P(0.5 * hx, hy - 8.5), P(-3 * hx, hy - 12), Math.max(1, _int(k)));
        }
    }
    return art;
}

export function cataphract(elite) {
    // Cataphract: a horse in scale armor down to the knees, a rider in a pointed helmet with an aventail, a spear.
    const aa = _aa();
    const base = aa.rider([84, 74, 68], 'plate', 'helm', 'lance', undefined, undefined, elite);

    function art(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null, moving = false) {
        base(surf, kind, color, x, y, face, anim, swing, k, carry_res, moving);
        const hx = face[0] >= 0 ? 1 : -1;
        const [P, by, ry, hy] = _rider_pts(x, y, k, anim, moving);
        const sc = elite ? 1.1 : 1.0;
        const scale = elite ? GOLD : [190, 192, 204];
        // scales on the horse's body and chest
        for (let row = 0; row < 2; row++) {
            for (let i = -4; i < 5; i++) {
                const [cx, cy] = P(i * 2.1 * sc, by + 3 + row * 2.6);
                pygame.draw.arc(surf, scale, [cx - _int(1.3 * k), cy - _int(1.3 * k), _int(2.6 * k), _int(2.6 * k)],
                    Math.PI, 2 * Math.PI, 1);
            }
        }
        // scale breastplate at the neck
        _poly(surf, shade(color, -30), [P(7 * hx * sc, by + 1), P(12 * hx * sc, by - 4), P(13 * hx * sc, by + 2),
            P(9 * hx * sc, by + 6)], scale);
        // rider: scale armor on the torso, a spiked helmet with an aventail
        for (const i of [-2.5, 0, 2.5]) {
            pygame.draw.arc(surf, scale, [...P(i - 1.3, ry - 1), _int(2.6 * k), _int(2.6 * k)], Math.PI, 2 * Math.PI, 1);
        }
        _poly(surf, IRON, [P(-3.3, hy - 1), P(0, hy - 7), P(3.3, hy - 1)], IRON_D);
        pygame.draw.line(surf, IRON_D, P(-3.2, hy + 1), P(-3.2, hy + 3), Math.max(1, _int(1.5 * k)));
        pygame.draw.line(surf, IRON_D, P(3.2, hy + 1), P(3.2, hy + 3), Math.max(1, _int(1.5 * k)));
        if (elite) pygame.draw.line(surf, shade(color, 60), P(0, hy - 7), P(-3 * hx, hy - 11), Math.max(2, _int(2 * k)));
    }
    return art;
}

export function teutonic(elite) {
    // Teutonic Knight: full plate armor, a bucket helm, a surcoat in player color with a cross, a two-handed sword.
    function art(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null, moving = false) {
        const sc = elite ? 1.12 : 1.06;
        const [P, hx, kk] = _foot(surf, color, x, y, face, anim, k, moving, undefined, IRON, IRON_D, sc);
        const lw = Math.max(1, _int(2 * kk));
        if (elite) _poly(surf, WHITE, [P(-4 * hx, -13), P(-9 * hx, 0, false), P(-2 * hx, -2)], [150, 150, 150]);
        // surcoat
        _poly(surf, color, [P(-3.6, -12), P(3.6, -12), P(4.6, -2), P(-4.6, -2)], shade(color, -80));
        const cc = _sum(color) < 360 ? WHITE : [30, 30, 34];
        pygame.draw.line(surf, cc, P(0, -11), P(0, -4), Math.max(1, _int(1.6 * kk)));
        pygame.draw.line(surf, cc, P(-2.5, -8.5), P(2.5, -8.5), Math.max(1, _int(1.6 * kk)));
        // pauldrons
        for (const sx of [-4.5, 4.5]) pygame.draw.circle(surf, IRON, P(sx, -11.5), Math.max(1, _int(2.2 * kk)));
        // bucket helm
        pygame.draw.rect(surf, IRON, [...P(-3.9, -20.5), _int(7.8 * kk), _int(7.5 * kk)], 0, Math.max(1, _int(1.5 * kk)));
        pygame.draw.rect(surf, IRON_D, [...P(-3.9, -20.5), _int(7.8 * kk), _int(7.5 * kk)], 1, Math.max(1, _int(1.5 * kk)));
        pygame.draw.line(surf, [30, 30, 36], P(-2.5 + hx, -17), P(2.5 + hx, -17), Math.max(1, _int(kk)));
        pygame.draw.line(surf, [30, 30, 36], P(1 * hx, -17), P(1 * hx, -14.5), Math.max(1, _int(kk)));
        if (elite) {
            // crown finial
            _poly(surf, GOLD, [P(-3.5, -20.5), P(-3, -23.5), P(-1.2, -21.5), P(0, -24.5), P(1.2, -21.5),
                P(3, -23.5), P(3.5, -20.5)]);
        }
        // two-handed sword
        const s = swing > 0 ? swing / 0.3 : 0;
        const hand = P(5 * hx, -8);
        const tip = P((16 + s * 5) * hx, -27 + s * 19);
        pygame.draw.line(surf, STEEL, hand, tip, Math.max(2, _int(2.6 * kk)));
        pygame.draw.line(surf, [130, 130, 140], hand, tip, 1);
        const [gx, gy] = P(6 * hx, -10 + s * 2);
        pygame.draw.line(surf, elite ? GOLD : IRON_D, [gx - _int(3 * kk), gy - _int(2 * kk)],
            [gx + _int(3 * kk), gy + _int(2 * kk)], lw);
    }
    return art;
}

export function samurai(elite) {
    // Samurai: a kabuto helmet with a golden crescent, lamellar armor, a curved sword; the elite has a banner on the back.
    function art(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null, moving = false) {
        const [P, hx, kk] = _foot(surf, color, x, y, face, anim, k, moving, undefined, undefined, [40, 36, 40]);
        if (elite) {
            // sashimono - a narrow banner on a pole
            pygame.draw.line(surf, WOOD_D, P(-3 * hx, -8), P(-3 * hx, -30), Math.max(1, _int(1.3 * kk)));
            _poly(surf, color, [P(-3 * hx, -30), P(-8 * hx, -30), P(-8 * hx, -21), P(-3 * hx, -21)], shade(color, -80));
            pygame.draw.circle(surf, WHITE, P(-5.5 * hx, -25.5), Math.max(1, _int(1.4 * kk)));
        }
        // lamellae: dark stripes on the torso
        for (const yy of [-10.5, -8, -5.5]) pygame.draw.line(surf, shade(color, -70), P(-4.5, yy), P(4.5, yy), 1);
        // sode shoulder guards
        for (const sx of [-5, 5]) {
            pygame.draw.rect(surf, shade(color, -40), [...P(sx - 1.6, -12), _int(3.2 * kk), _int(4.5 * kk)]);
        }
        // kabuto: a black dome, a wide neck guard, a crescent
        pygame.draw.ellipse(surf, [40, 38, 44], [...P(-4, -20.5), _int(8 * kk), _int(5.5 * kk)]);
        pygame.draw.polygon(surf, [40, 38, 44], [P(-5.5, -16), P(5.5, -16), P(4, -17.5), P(-4, -17.5)]);
        pygame.draw.arc(surf, GOLD, [...P(-3.6, -25), _int(7.2 * kk), _int(6 * kk)], Math.PI * 1.05, Math.PI * 1.95,
            Math.max(1, _int(1.5 * kk)));
        // katana in both hands: a thin, slightly curved blade
        const s = swing > 0 ? swing / 0.3 : 0;
        const hand = P(4 * hx, -9);
        const ang = math.radians(-70 + 110 * s);
        const L = 15 * kk;
        const pts = [];
        for (let i = 0; i < 6; i++) {
            const t = i / 5;
            const a = ang + 0.25 * t;
            pts.push([hand[0] + Math.cos(a) * L * t * hx, hand[1] + Math.sin(a) * L * t]);
        }
        pygame.draw.lines(surf, STEEL, false, pts, Math.max(1, _int(1.8 * kk)));
        pygame.draw.line(surf, [40, 30, 30], hand, [hand[0] - _int(2.5 * kk * hx * Math.cos(ang)),
            hand[1] - _int(2.5 * kk * Math.sin(ang))], Math.max(2, _int(2 * kk)));
        pygame.draw.circle(surf, GOLD, hand, Math.max(1, _int(1.2 * kk)));
    }
    return art;
}

export function chukonu(elite) {
    // Chu Ko Nu: a wide conical hat, a repeating crossbow with a magazine.
    function art(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null, moving = false) {
        const [P, hx, kk] = _foot(surf, color, x, y, face, anim, k, moving);
        const lw = Math.max(1, _int(2 * kk));
        if (elite) {
            for (const yy of [-10.5, -7.5]) pygame.draw.line(surf, shade(color, -60), P(-4.5, yy), P(4.5, yy), 1);
            pygame.draw.line(surf, GOLD, P(-4.5, -5), P(4.5, -5), Math.max(1, _int(1.5 * kk)));
        }
        // hat
        const hat = !elite ? [200, 170, 100] : [70, 60, 50];
        _poly(surf, hat, [P(-7, -17), P(0, -22.5), P(7, -17)], shade(hat, -60));
        if (elite) {
            pygame.draw.line(surf, [215, 40, 40], P(0, -22.5), P(0, -25), Math.max(1, _int(2 * kk)));
            pygame.draw.circle(surf, [215, 40, 40], P(0, -25), Math.max(1, _int(1.5 * kk)));
        }
        // crossbow: stock, bow, magazine on top; on firing - the lever goes forward
        const s = swing > 0 ? swing / 0.3 : 0;
        const a = P(0, -9), b = P(12 * hx, -10);
        pygame.draw.line(surf, [110, 78, 45], a, b, Math.max(2, _int(2.5 * kk)));
        const [bx, by] = P(10 * hx, -10);
        pygame.draw.line(surf, [70, 60, 55], [bx, by - _int(5 * kk)], [bx, by + _int(5 * kk)], lw);
        pygame.draw.line(surf, [230, 230, 230], [bx, by - _int(5 * kk)], P(6 * hx, -10), 1);
        pygame.draw.line(surf, [230, 230, 230], [bx, by + _int(5 * kk)], P(6 * hx, -10), 1);
        const mag = new pygame.Rect(0, 0, _int(7 * kk), _int(3.5 * kk));
        mag.midbottom = P(6 * hx, -11);
        pygame.draw.rect(surf, [140, 100, 60], mag);
        pygame.draw.rect(surf, WOOD_D, mag, 1);
        const [lx, ly] = P((1 + 3 * s) * hx, -12.5 - 2 * (1 - s));
        pygame.draw.line(surf, WOOD_D, P(3 * hx, -11), [lx, ly], Math.max(1, _int(1.5 * kk)));
    }
    return art;
}

export function elephant(elite) {
    // War Elephant: huge, with tusks and a trunk; on the back a howdah tower with a canopy in player color,
    // a mahout on the neck and an archer in the tower. The elite has a gilded frontlet and caparison.
    function art(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null, moving = false) {
        const hx = face[0] >= 0 ? 1 : -1;
        const bob = moving ? Math.sin(anim * 0.7) * 0.8 * k : 0;
        const P = _P(x, y, k, bob);
        const sc = elite ? 1.08 : 1.0;
        const skin = [128, 124, 122];
        const dark = shade(skin, -45);
        _shadow(surf, x - 22 * k * sc, y - 5 * k, 44 * k * sc, 13 * k);
        // pillar legs
        [-11, -6, 6, 11].forEach((lx, i) => {
            const off = moving ? Math.sin(anim * 0.7 + i * 1.6) * 1.8 : 0;
            const c = (i === 0 || i === 2) ? dark : skin;
            pygame.draw.line(surf, c, P(lx * sc, -10), P(lx * sc + off, 1, false), Math.max(3, _int(5 * k)));
        });
        // body
        const body = [...P(-17 * sc, -26), _int(34 * k * sc), _int(20 * k)];
        pygame.draw.ellipse(surf, skin, body);
        // caparison
        const cloth = color;
        pygame.draw.ellipse(surf, cloth, [...P(-12 * sc, -24), _int(24 * k * sc), _int(14 * k)]);
        const trim = elite ? GOLD : shade(color, 60);
        pygame.draw.ellipse(surf, trim, [...P(-12 * sc, -24), _int(24 * k * sc), _int(14 * k)], Math.max(1, _int(1.5 * k)));
        pygame.draw.ellipse(surf, shade(skin, -70), body, 1);
        // tail
        pygame.draw.line(surf, dark, P(-17 * hx * sc, -20), P(-19 * hx * sc, -12), Math.max(1, _int(1.5 * k)));
        // head, ear, trunk, tusks
        const hx0 = 16 * sc;
        pygame.draw.circle(surf, skin, P(hx0 * hx, -22), _int(7 * k));
        pygame.draw.ellipse(surf, shade(skin, -18), [...P((hx0 - 6) * hx - 4.5, -27), _int(9 * k), _int(11 * k)]);
        pygame.draw.ellipse(surf, dark, [...P((hx0 - 6) * hx - 4.5, -27), _int(9 * k), _int(11 * k)], 1);
        const s = swing > 0 ? swing / 0.3 : 0;
        const trunk = [P((hx0 + 5) * hx, -21), P((hx0 + 8) * hx, -15), P((hx0 + 8 + 3 * s) * hx, -9 - 6 * s),
            P((hx0 + 10 + 4 * s) * hx, -6 - 9 * s)];
        pygame.draw.lines(surf, skin, false, trunk, Math.max(3, _int(3.6 * k)));
        pygame.draw.lines(surf, dark, false, trunk, 1);
        pygame.draw.line(surf, [245, 240, 225], P((hx0 + 4) * hx, -17), P((hx0 + 10) * hx, -13),
            Math.max(2, _int(2.4 * k)));
        pygame.draw.circle(surf, [30, 26, 24], P((hx0 + 3) * hx, -24), Math.max(1, _int(1.1 * k)));
        if (elite) {
            _poly(surf, GOLD, [P((hx0 - 2) * hx, -28), P((hx0 + 5) * hx, -26), P((hx0 + 4) * hx, -20),
                P((hx0 - 1) * hx, -22)], shade(GOLD, -70));
        }
        // mahout on the neck
        const mx = (hx0 - 6) * hx, my = -31;
        pygame.draw.circle(surf, [230, 225, 210], P(mx, my), _int(2.8 * k));
        pygame.draw.circle(surf, SKIN, P(mx, my - 4.5), _int(2.2 * k));
        pygame.draw.ellipse(surf, WHITE, [...P(mx - 2.4, my - 7.4), _int(4.8 * k), _int(2.6 * k)]);
        // howdah: a wooden box, an archer, a canopy
        _poly(surf, WOOD, [P(-8, -35), P(7, -35), P(6, -26), P(-7, -26)], WOOD_D);
        for (let i = -6; i < 7; i += 3) pygame.draw.line(surf, WOOD_D, P(i, -35), P(i * 0.93, -26), 1);
        pygame.draw.circle(surf, color, P(0, -38), _int(3.4 * k));
        pygame.draw.circle(surf, SKIN, P(0, -42.5), _int(2.4 * k));
        const [bxx, byy] = P(4 * hx, -39);
        const r = new pygame.Rect(0, 0, _int(5 * k), _int(10 * k));
        r.center = [bxx, byy];
        const a0 = hx > 0 ? -Math.PI / 2 : Math.PI / 2;
        pygame.draw.arc(surf, [130, 85, 40], r, a0, a0 + Math.PI, Math.max(1, _int(1.5 * k)));
        for (const px of [-7, 6]) pygame.draw.line(surf, WOOD_D, P(px, -35), P(px, -46), Math.max(1, _int(1.3 * k)));
        _poly(surf, shade(color, 25), [P(-9, -46), P(8, -46), P(0, -51)], shade(color, -70));
        pygame.draw.line(surf, trim, P(-9, -46), P(8, -46), Math.max(1, _int(1.3 * k)));
    }
    return art;
}

export function mameluke(elite) {
    // Mameluke: a dark camel, a rider in a turban with a spiked helmet, a curved sabre and a round shield.
    const aa = _aa();
    const base = aa.rider(!elite ? [150, 112, 70] : [120, 88, 58], elite ? 'cloth' : null, 'turban', 'none', true);

    function art(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null, moving = false) {
        base(surf, kind, color, x, y, face, anim, swing, k, carry_res, moving);
        const hx = face[0] >= 0 ? 1 : -1;
        const [P, by, ry, hy] = _rider_pts(x, y, k, anim, moving, true);
        // spike above the turban
        _poly(surf, elite ? GOLD : IRON, [P(-1.6, hy - 3.2), P(0, hy - 7.5), P(1.6, hy - 3.2)]);
        // shield on the left arm
        const [sx, sy] = P(-4 * hx, ry + 1);
        pygame.draw.circle(surf, shade(color, -30), [sx, sy], Math.max(2, _int(3.2 * k)));
        pygame.draw.circle(surf, elite ? GOLD : [200, 180, 120], [sx, sy], Math.max(2, _int(3.2 * k)), 1);
        // sabre: an arc
        const s = swing * 20;
        const hand = P(3 * hx, ry);
        const a0 = math.radians(-60 + s * 4);
        const pts = [];
        for (let t = 0; t < 6; t++) {
            pts.push([hand[0] + Math.cos(a0 + 0.35 * t / 5) * 11 * k * t / 5 * hx,
                hand[1] + Math.sin(a0 + 0.35 * t / 5) * 11 * k * t / 5]);
        }
        pygame.draw.lines(surf, STEEL, false, pts, Math.max(1, _int(2 * k)));
        pygame.draw.circle(surf, GOLD, hand, Math.max(1, _int(1.2 * k)));
    }
    return art;
}

export function janissary(elite) {
    // Janissary: a tall white cap, a long kaftan in player color, a long gun with smoke when firing.
    function art(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null, moving = false) {
        const [P, hx, kk] = _foot(surf, color, x, y, face, anim, k, moving);
        // kaftan skirts
        _poly(surf, shade(color, -15), [P(-4.5, -6), P(4.5, -6), P(5.5, -1), P(-5.5, -1)], shade(color, -80));
        pygame.draw.line(surf, elite ? GOLD : [220, 200, 150], P(-4.8, -6), P(4.8, -6), Math.max(1, _int(1.5 * kk)));
        // bork cap: tall, bent backwards
        _poly(surf, WHITE, [P(-3.4, -17.5), P(3.4, -17.5), P(2 - 4 * hx, -26), P(-1 - 5 * hx, -25)],
            [170, 165, 150]);
        pygame.draw.rect(surf, elite ? GOLD : [200, 180, 120], [...P(-3.6, -18.5), _int(7.2 * kk), _int(2 * kk)]);
        if (elite) pygame.draw.line(surf, [245, 245, 240], P(0, -19), P(1.5 * hx, -28), Math.max(2, _int(2.2 * kk)));
        // gun
        const s = swing > 0 ? swing / 0.3 : 0;
        const a = P(-2 * hx, -9), b = P(15 * hx, -12);
        pygame.draw.line(surf, [110, 78, 45], a, P(5 * hx, -10.2), Math.max(2, _int(2.5 * kk)));
        pygame.draw.line(surf, [70, 70, 76], P(4 * hx, -10.4), b, Math.max(2, _int(2 * kk)));
        if (s > 0.3) {
            const [bx, by] = b;
            for (let i = 0; i < 3; i++) {
                pygame.draw.circle(surf, [225, 225, 225], [bx + _int((3 + i * 3) * kk * hx), by - _int(i * 2 * kk)],
                    Math.max(1, _int((2.5 + i) * kk)));
            }
            pygame.draw.circle(surf, [255, 200, 80], [bx + _int(2 * kk * hx), by], Math.max(1, _int(1.5 * kk)));
        }
    }
    return art;
}

export function berserk(elite) {
    // Berserk: no helmet (the elite has a helmet with spectacles), red hair and beard, fur on the shoulders,
    // a broad axe and a round shield.
    function art(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null, moving = false) {
        const [P, hx, kk] = _foot(surf, color, x, y, face, anim, k, moving, undefined, undefined, [80, 66, 50]);
        _round_shield(surf, P, hx, kk, shade(color, -10), undefined, undefined, 'spiral');
        // fur on the shoulders
        pygame.draw.ellipse(surf, FUR, [...P(-5.5, -13.5), _int(11 * kk), _int(4 * kk)]);
        const hair = [205, 110, 45];
        pygame.draw.polygon(surf, hair, [P(-1 + 1 * hx, -13), P(2.5 * hx, -13), P(1 * hx, -9.5)]);
        if (elite) {
            pygame.draw.ellipse(surf, IRON, [...P(-3.8, -19.8), _int(7.6 * kk), _int(5 * kk)]);
            pygame.draw.circle(surf, IRON_D, P(1.6 * hx, -15.5), Math.max(1, _int(1.2 * kk)), 1);
        } else {
            for (let i = -3; i < 4; i++) {
                pygame.draw.line(surf, hair, P(i * 1.1, -17.5), P(i * 1.6, -20.5 + Math.abs(i) * 0.4), Math.max(1, _int(kk)));
            }
        }
        // axe: overhead swing
        const s = swing > 0 ? swing / 0.3 : 0;
        const hand = P(4 * hx, -9);
        const ang = math.radians(-100 + 120 * s);
        const L = 12 * kk;
        const top = [hand[0] + Math.cos(ang) * L * hx, hand[1] + Math.sin(ang) * L];
        pygame.draw.line(surf, WOOD, hand, top, Math.max(1, _int(2 * kk)));
        const [tx, ty] = top;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const w = (elite ? 5.5 : 4.5) * kk;
        const blade = [[tx, ty], [tx - sa * w * hx * 0.2 + ca * 2 * kk * hx, ty + ca * w * 0.2 + sa * 2 * kk],
            [tx + (-sa * w + ca * 3 * kk) * hx, ty + ca * w + sa * 3 * kk],
            [tx + (-sa * w - ca * 2.5 * kk) * hx, ty + ca * w - sa * 2.5 * kk]];
        pygame.draw.polygon(surf, STEEL, blade);
        pygame.draw.polygon(surf, IRON_D, blade, 1);
    }
    return art;
}

export function huskarl(elite) {
    // Huskarl: a large round shield in front (arrows cannot pierce it), a helmet with a nasal guard, mail, a sword.
    function art(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null, moving = false) {
        const [P, hx, kk] = _foot(surf, color, x, y, face, anim, k, moving, undefined, elite ? [150, 150, 158] : null);
        // helmet
        _poly(surf, IRON, [P(-3.8, -16.5), P(0, -21.5), P(3.8, -16.5)], IRON_D);
        pygame.draw.line(surf, IRON_D, P(1.4 * hx, -17), P(1.4 * hx, -13.5), Math.max(1, _int(1.2 * kk)));
        // sword behind the shield
        const s = swing > 0 ? swing / 0.3 : 0;
        pygame.draw.line(surf, STEEL, P(4 * hx, -9), P((10 + s * 3) * hx, -18 + s * 11), Math.max(1, _int(2 * kk)));
        // shield in front: large, in player color, with a pattern
        const [sx, sy] = P(4.5 * hx, -8);
        const r = _int((elite ? 5.8 : 5.2) * kk);
        pygame.draw.circle(surf, color, [sx, sy], r);
        pygame.draw.circle(surf, shade(color, 55), [sx, sy], r, Math.max(1, _int(1.2 * kk)));
        for (let a = 0; a < 360; a += 90) {
            const ra = math.radians(a + 45);
            pygame.draw.line(surf, shade(color, -60), [sx, sy], [sx + _int(Math.cos(ra) * r), sy + _int(Math.sin(ra) * r)],
                Math.max(1, _int(kk)));
        }
        pygame.draw.circle(surf, elite ? GOLD : STEEL, [sx, sy], Math.max(1, _int(1.6 * kk)));
    }
    return art;
}

export function woad(elite) {
    // Woad Raider: blue paint, lime-spiked hair, a checkered kilt in player color, a sword.
    const blue = [120, 150, 200];

    function art(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null, moving = false) {
        const [P, hx, kk] = _foot(surf, color, x, y, face, anim, k, moving, blue, blue, [90, 110, 160]);
        // patterns on the chest
        pygame.draw.arc(surf, [40, 60, 130], [...P(-3, -11), _int(6 * kk), _int(6 * kk)], 0.5, 5.5, 1);
        // kilt
        _poly(surf, color, [P(-5, -6), P(5, -6), P(6, -1), P(-6, -1)], shade(color, -80));
        for (const i of [-3, 0, 3]) pygame.draw.line(surf, shade(color, 60), P(i, -6), P(i * 1.2, -1), 1);
        pygame.draw.line(surf, shade(color, -60), P(-5.5, -3.5), P(5.5, -3.5), 1);
        // hair
        for (let i = -3; i < 4; i++) {
            pygame.draw.line(surf, [235, 225, 190], P(i * 0.9, -17.5), P(i * 1.9, -22 + Math.abs(i) * 0.5),
                Math.max(1, _int(1.3 * kk)));
        }
        if (elite) {
            pygame.draw.arc(surf, GOLD, [...P(-3.5, -14), _int(7 * kk), _int(4 * kk)], Math.PI, 2 * Math.PI,
                Math.max(1, _int(1.5 * kk)));
        }
        const s = swing > 0 ? swing / 0.3 : 0;
        const L = elite ? 1.2 : 1.0;
        pygame.draw.line(surf, STEEL, P(5 * hx, -8), P((5 + (10 + s * 3) * L) * hx, -8 - (11 - s * 13) * L),
            Math.max(2, _int(2.2 * kk)));
        pygame.draw.line(surf, elite ? GOLD : WOOD, P(3.5 * hx, -9.5), P(6.5 * hx, -6.5), Math.max(1, _int(2 * kk)));
    }
    return art;
}

export function conquistador(elite) {
    // Conquistador: a black horse, a morion helmet with a crest and upturned brim, a gun.
    const aa = _aa();
    const base = aa.rider([46, 40, 38], elite ? 'plate' : null, 'skin', 'none');

    function art(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null, moving = false) {
        base(surf, kind, color, x, y, face, anim, swing, k, carry_res, moving);
        const hx = face[0] >= 0 ? 1 : -1;
        const [P, by, ry, hy] = _rider_pts(x, y, k, anim, moving);
        // cuirass
        pygame.draw.circle(surf, IRON, P(0, ry), _int(3.2 * k));
        // morion
        pygame.draw.arc(surf, STEEL, [...P(-5, hy - 3), _int(10 * k), _int(5 * k)], 0, Math.PI, Math.max(1, _int(1.6 * k)));
        pygame.draw.ellipse(surf, STEEL, [...P(-2.8, hy - 5.5), _int(5.6 * k), _int(4 * k)]);
        pygame.draw.line(surf, IRON_D, P(-1.8, hy - 6.5), P(1.8, hy - 6.5), Math.max(1, _int(1.4 * k)));
        if (elite) pygame.draw.line(surf, shade(color, 60), P(0, hy - 6), P(-4 * hx, hy - 10), Math.max(2, _int(2 * k)));
        // gun at the ready
        const s = swing > 0 ? swing / 0.3 : 0;
        const b = P(15 * hx, ry - 4);
        pygame.draw.line(surf, [110, 78, 45], P(-1 * hx, ry + 1), P(5 * hx, ry - 1), Math.max(2, _int(2.4 * k)));
        pygame.draw.line(surf, [70, 70, 76], P(4 * hx, ry - 1), b, Math.max(2, _int(2 * k)));
        if (s > 0.3) {
            const [bx, by2] = b;
            for (let i = 0; i < 3; i++) {
                pygame.draw.circle(surf, [225, 225, 225], [bx + _int((3 + i * 3) * k * hx), by2 - _int(i * 2 * k)],
                    Math.max(1, _int((2.5 + i) * k)));
            }
        }
    }
    return art;
}

// ============================================================ coats of arms
export function _shield_poly(r) {
    // Shield outline (a knightly "triangular" shield with convex lower edges) inside the rectangle r.
    const [x, y, w, h] = r;
    const top = h * 0.5;
    const pts = [[x, y], [x + w, y]];
    for (let i = 0; i < 13; i++) {
        const a = i / 12 * Math.PI / 2;
        pts.push([x + w / 2 + w / 2 * Math.pow(Math.cos(a), 0.8), y + top + (h - top) * Math.sin(a)]);
    }
    for (let i = 11; i > -1; i--) {
        const a = i / 12 * Math.PI / 2;
        pts.push([x + w / 2 - w / 2 * Math.pow(Math.cos(a), 0.8), y + top + (h - top) * Math.sin(a)]);
    }
    return pts;
}

export function _field(surf, r, div, c1, c2) {
    const [x, y, w, h] = r;
    surf.fill(c1);
    if (div === 'pale') {
        pygame.draw.rect(surf, c2, [x + Math.floor(w / 2), y, w - Math.floor(w / 2), h]);
    } else if (div === 'fess') {
        pygame.draw.rect(surf, c2, [x, y + Math.floor(h / 2), w, h - Math.floor(h / 2)]);
    } else if (div === 'quarterly') {
        pygame.draw.rect(surf, c2, [x + Math.floor(w / 2), y, w - Math.floor(w / 2), Math.floor(h / 2)]);
        pygame.draw.rect(surf, c2, [x, y + Math.floor(h / 2), Math.floor(w / 2), h - Math.floor(h / 2)]);
    } else if (div === 'bend') {
        pygame.draw.polygon(surf, c2, [[x + w, y], [x + w, y + h], [x, y + h]]);
    } else if (div === 'chevron') {
        pygame.draw.polygon(surf, c2, [[x, y + h], [x + w / 2, y + h * 0.35], [x + w, y + h], [x + w, y + h * 0.75],
            [x + w / 2, y + h * 0.1], [x, y + h * 0.75]]);
    } else if (div === 'bordure') {
        pygame.draw.rect(surf, c2, [x, y, w, h]);
        pygame.draw.rect(surf, c1, [x + w * 0.12, y + h * 0.1, w * 0.76, h * 0.8]);
    } else if (div === 'chief') {
        pygame.draw.rect(surf, c2, [x, y, w, h * 0.3]);
    }
}

export function _lily(surf, cx, cy, s, c) {
    const o = shade(c, -90);
    let pts = [[cx, cy - s], [cx + s * 0.28, cy - s * 0.35], [cx + s * 0.12, cy + s * 0.2], [cx - s * 0.12, cy + s * 0.2],
        [cx - s * 0.28, cy - s * 0.35]];
    _poly(surf, c, pts, o);
    for (const sg of [-1, 1]) {
        pts = [[cx + sg * s * 0.12, cy + s * 0.05], [cx + sg * s * 0.7, cy - s * 0.55], [cx + sg * s * 0.8, cy - s * 0.05],
            [cx + sg * s * 0.45, cy + s * 0.3]];
        _poly(surf, c, pts, o);
    }
    pygame.draw.rect(surf, c, [cx - s * 0.5, cy + s * 0.2, s, s * 0.22]);
    pygame.draw.rect(surf, o, [cx - s * 0.5, cy + s * 0.2, s, s * 0.22], 1);
    _poly(surf, c, [[cx - s * 0.15, cy + s * 0.42], [cx + s * 0.15, cy + s * 0.42], [cx, cy + s * 0.85]], o);
}

export function _crown(surf, cx, cy, s, c) {
    const o = shade(c, -90);
    const pts = [[cx - s, cy + s * 0.5], [cx - s, cy - s * 0.3], [cx - s * 0.5, cy + s * 0.05], [cx, cy - s * 0.6],
        [cx + s * 0.5, cy + s * 0.05], [cx + s, cy - s * 0.3], [cx + s, cy + s * 0.5]];
    _poly(surf, c, pts, o);
    for (const [px, pyy] of [[cx - s, cy - s * 0.3], [cx, cy - s * 0.6], [cx + s, cy - s * 0.3]]) {
        pygame.draw.circle(surf, c, [_int(px), _int(pyy)], Math.max(2, _int(s * 0.16)));
    }
    pygame.draw.rect(surf, shade(c, -30), [cx - s, cy + s * 0.3, 2 * s, s * 0.22]);
    for (const i of [-1, 0, 1]) {
        pygame.draw.circle(surf, i === 0 ? [200, 40, 40] : [40, 120, 200], [_int(cx + i * s * 0.55),
            _int(cy + s * 0.41)], Math.max(1, _int(s * 0.1)));
    }
}

export function _cross(surf, cx, cy, s, c, pattee = true) {
    const o = _sum(c) > 300 ? shade(c, -60) : shade(c, 90);
    if (pattee) {
        for (let a = 0; a < 4; a++) {
            const ang = a * Math.PI / 2;
            const ca = Math.cos(ang), sa = Math.sin(ang);

            const R = (u, v) => [cx + u * ca - v * sa, cy + u * sa + v * ca];
            _poly(surf, c, [R(0, -s * 0.18), R(s, -s * 0.5), R(s, s * 0.5), R(0, s * 0.18)], o);
        }
        pygame.draw.circle(surf, c, [_int(cx), _int(cy)], Math.max(2, _int(s * 0.2)));
    } else {
        pygame.draw.rect(surf, c, [cx - s * 0.2, cy - s, s * 0.4, 2 * s]);
        pygame.draw.rect(surf, c, [cx - s, cy - s * 0.2, 2 * s, s * 0.4]);
    }
}

export function _bird(surf, cx, cy, s, c, double = false) {
    // A heraldic bird with spread wings (double-headed - double).
    const o = shade(c, -100);
    for (const sg of [-1, 1]) {
        const wing = [[cx + sg * s * 0.15, cy - s * 0.15], [cx + sg * s * 1.0, cy - s * 0.75], [cx + sg * s * 0.95, cy - s * 0.35],
            [cx + sg * s * 1.05, cy - s * 0.25], [cx + sg * s * 0.9, cy], [cx + sg * s * 0.95, cy + s * 0.1],
            [cx + sg * s * 0.25, cy + s * 0.2]];
        _poly(surf, c, wing, o);
    }
    _poly(surf, c, [[cx - s * 0.25, cy - s * 0.3], [cx + s * 0.25, cy - s * 0.3], [cx + s * 0.2, cy + s * 0.45],
        [cx, cy + s * 0.55], [cx - s * 0.2, cy + s * 0.45]], o);
    _poly(surf, c, [[cx - s * 0.35, cy + s * 0.5], [cx, cy + s * 0.35], [cx + s * 0.35, cy + s * 0.5],
        [cx + s * 0.2, cy + s * 0.85], [cx, cy + s * 0.7], [cx - s * 0.2, cy + s * 0.85]], o);
    const heads = double ? [[-0.28, -1], [0.28, 1]] : [[0, 1]];
    for (const [dx, sg] of heads) {
        const hx = cx + dx * s, hy = cy - s * 0.52;
        pygame.draw.circle(surf, c, [_int(hx), _int(hy)], Math.max(2, _int(s * 0.18)));
        pygame.draw.circle(surf, o, [_int(hx), _int(hy)], Math.max(2, _int(s * 0.18)), 1);
        _poly(surf, [225, 60, 40], [[hx + sg * s * 0.14, hy - s * 0.04], [hx + sg * s * 0.34, hy + s * 0.04],
            [hx + sg * s * 0.14, hy + s * 0.1]]);
    }
}

export function _crescent(surf, cx, cy, s, c, bg, star = false) {
    pygame.draw.circle(surf, c, [_int(cx), _int(cy)], _int(s * 0.75));
    pygame.draw.circle(surf, bg, [_int(cx + s * 0.28), _int(cy - s * 0.05)], _int(s * 0.62));
    if (star) _star(surf, cx + s * 0.45, cy, s * 0.3, c);
}

export function _star(surf, cx, cy, s, c, n = 5) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
        const a = -Math.PI / 2 + i * Math.PI / n;
        const r = i % 2 === 0 ? s : s * 0.42;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    pygame.draw.polygon(surf, c, pts);
}

export function _sun(surf, cx, cy, s, c) {
    for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6;
        const a2 = a + Math.PI / 12;
        _poly(surf, c, [[cx + Math.cos(a - 0.14) * s * 0.5, cy + Math.sin(a - 0.14) * s * 0.5],
            [cx + Math.cos(a) * s, cy + Math.sin(a) * s],
            [cx + Math.cos(a + 0.14) * s * 0.5, cy + Math.sin(a + 0.14) * s * 0.5]]);
        pygame.draw.line(surf, c, [cx + Math.cos(a2) * s * 0.5, cy + Math.sin(a2) * s * 0.5],
            [cx + Math.cos(a2) * s * 0.8, cy + Math.sin(a2) * s * 0.8], Math.max(1, _int(s * 0.08)));
    }
    pygame.draw.circle(surf, c, [_int(cx), _int(cy)], _int(s * 0.48));
    pygame.draw.circle(surf, shade(c, -70), [_int(cx), _int(cy)], _int(s * 0.48), 1);
}

export function _bow(surf, cx, cy, s, c) {
    const r = new pygame.Rect(0, 0, _int(s * 1.0), _int(s * 2.0));
    r.center = [_int(cx - s * 0.1), _int(cy)];
    pygame.draw.arc(surf, c, r, -Math.PI / 2, Math.PI / 2, Math.max(2, _int(s * 0.16)));
    pygame.draw.line(surf, c, [r.centerx, r.top + 1], [r.centerx, r.bottom - 1], Math.max(1, _int(s * 0.06)));
    pygame.draw.line(surf, c, [cx - s * 0.9, cy], [cx + s * 0.75, cy], Math.max(1, _int(s * 0.1)));
    _poly(surf, c, [[cx + s * 0.95, cy], [cx + s * 0.65, cy - s * 0.18], [cx + s * 0.65, cy + s * 0.18]]);
    for (const d of [-1, 1]) {
        pygame.draw.line(surf, c, [cx - s * 0.9, cy], [cx - s * 1.1, cy + d * s * 0.2], Math.max(1, _int(s * 0.08)));
    }
}

export function _axes(surf, cx, cy, s, c) {
    for (const sg of [-1, 1]) {
        const a = [cx - sg * s * 0.8, cy + s * 0.9];
        const b = [cx + sg * s * 0.7, cy - s * 0.8];
        pygame.draw.line(surf, c, a, b, Math.max(2, _int(s * 0.14)));
        const [bx, by] = b;
        _poly(surf, c, [[bx - sg * s * 0.15, by + s * 0.1], [bx + sg * s * 0.1, by - s * 0.45],
            [bx + sg * s * 0.5, by - s * 0.05], [bx + sg * s * 0.3, by + s * 0.35]], shade(c, -90));
    }
}

export function _swords(surf, cx, cy, s, c) {
    for (const sg of [-1, 1]) {
        const pts = [];
        for (let i = 0; i < 7; i++) {
            const t = i / 6;
            const px = cx - sg * s * 0.8 + sg * s * 1.6 * t;
            const pyy = cy + s * 0.85 - s * 1.7 * t - Math.sin(t * Math.PI) * s * 0.25 * sg * 0;
            pts.push([px + Math.sin(t * Math.PI) * s * 0.15, pyy]);
        }
        pygame.draw.lines(surf, c, false, pts, Math.max(3, _int(s * 0.2)));
        const [gx, gy] = pts[1];
        pygame.draw.line(surf, c, [gx - s * 0.2, gy - sg * s * 0.2], [gx + s * 0.2, gy + sg * s * 0.2],
            Math.max(1, _int(s * 0.1)));
    }
}

export function _mon(surf, cx, cy, s, c, bg) {
    // A round heraldic sign: a circle and five petals.
    pygame.draw.circle(surf, c, [_int(cx), _int(cy)], _int(s));
    pygame.draw.circle(surf, bg, [_int(cx), _int(cy)], _int(s * 0.82));
    for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + i * 2 * Math.PI / 5;
        pygame.draw.circle(surf, c, [_int(cx + Math.cos(a) * s * 0.42), _int(cy + Math.sin(a) * s * 0.42)], _int(s * 0.3));
    }
    pygame.draw.circle(surf, bg, [_int(cx), _int(cy)], _int(s * 0.18));
}

export function _dragon(surf, cx, cy, s, c) {
    // A coiled dragon-snake: an S-shaped body with a crest and a head.
    const pts = [];
    for (let i = 0; i < 24; i++) {
        const t = i / 23;
        const a = t * Math.PI * 2.2;
        pts.push([cx + Math.sin(a) * s * 0.55 * (1 - t * 0.2), cy + s * 0.8 - t * s * 1.5]);
    }
    pygame.draw.lines(surf, c, false, pts, Math.max(3, _int(s * 0.28)));
    for (let i = 2; i < 22; i += 3) {
        const [x, y] = pts[i];
        pygame.draw.line(surf, shade(c, 40), [x, y], [x - s * 0.18, y - s * 0.1], Math.max(1, _int(s * 0.07)));
    }
    const [hx, hy] = pts[pts.length - 1];
    pygame.draw.circle(surf, c, [_int(hx), _int(hy)], _int(s * 0.22));
    _poly(surf, c, [[hx, hy - s * 0.1], [hx + s * 0.45, hy - s * 0.05], [hx, hy + s * 0.12]]);
    pygame.draw.line(surf, c, [hx - s * 0.1, hy - s * 0.15], [hx - s * 0.3, hy - s * 0.4], Math.max(1, _int(s * 0.07)));
}

export function _triskele(surf, cx, cy, s, c) {
    for (let i = 0; i < 3; i++) {
        const a0 = -Math.PI / 2 + i * 2 * Math.PI / 3;
        const pts = [];
        for (let j = 0; j < 14; j++) {
            const t = j / 13;
            const r = s * 0.85 * t;
            const a = a0 + t * 2.4;
            pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
        pygame.draw.lines(surf, c, false, pts, Math.max(2, _int(s * 0.18)));
    }
    pygame.draw.circle(surf, c, [_int(cx), _int(cy)], Math.max(2, _int(s * 0.14)));
}

export function _tower(surf, cx, cy, s, c) {
    const o = shade(c, -90);
    pygame.draw.rect(surf, c, [cx - s * 0.55, cy - s * 0.35, s * 1.1, s * 1.15]);
    pygame.draw.rect(surf, o, [cx - s * 0.55, cy - s * 0.35, s * 1.1, s * 1.15], 1);
    for (let i = 0; i < 3; i++) pygame.draw.rect(surf, c, [cx - s * 0.65 + i * s * 0.5, cy - s * 0.65, s * 0.3, s * 0.35]);
    pygame.draw.rect(surf, c, [cx - s * 0.7, cy - s * 0.4, s * 1.4, s * 0.12]);
    pygame.draw.rect(surf, o, [cx - s * 0.16, cy + s * 0.35, s * 0.32, s * 0.45]);
    pygame.draw.rect(surf, o, [cx - s * 0.35, cy - s * 0.1, s * 0.14, s * 0.22]);
    pygame.draw.rect(surf, o, [cx + s * 0.21, cy - s * 0.1, s * 0.14, s * 0.22]);
}

export function _raven(surf, cx, cy, s, c) {
    const o = shade(c, 70);
    _poly(surf, c, [[cx - s * 0.9, cy + s * 0.1], [cx - s * 0.2, cy - s * 0.15], [cx + s * 0.3, cy - s * 0.55],
        [cx + s * 0.55, cy - s * 0.5], [cx + s * 0.85, cy - s * 0.42], [cx + s * 0.55, cy - s * 0.3],
        [cx + s * 0.4, cy + s * 0.15], [cx - s * 0.1, cy + s * 0.4], [cx - s * 0.5, cy + s * 0.75],
        [cx - s * 0.45, cy + s * 0.35]], o);
    _poly(surf, c, [[cx - s * 0.2, cy - s * 0.1], [cx - s * 0.1, cy - s * 0.95], [cx + s * 0.25, cy - s * 0.2]], o);
    pygame.draw.circle(surf, o, [_int(cx + s * 0.5), _int(cy - s * 0.44)], Math.max(1, _int(s * 0.06)));
}

export const CHARGES = {
    'lily3': null, 'crown': _crown, 'cross': _cross, 'eagle': _bird, 'eagle2': null, 'crescent': null,
    'crescent_star': null, 'sun': _sun, 'bow': _bow, 'axes': _axes, 'swords': _swords, 'mon': null,
    'dragon': _dragon, 'triskele': _triskele, 'tower': _tower, 'raven': _raven, 'star': _star,
};

export function draw_emblem(surf, rect, spec, outline = [30, 24, 18]) {
    // Coat of arms: spec = dict(field=(c1, c2), div='plain'|'pale'|'fess'|'quarterly'|'bend'|'chevron'|'bordure'|'chief',
    // charge='lily3'|'crown'|'cross'|'eagle'|'eagle2'|'crescent'|'crescent_star'|'sun'|'bow'|'axes'|'swords'|'mon'|
    // 'dragon'|'triskele'|'tower'|'raven'|'star', metal=color of the charge).
    rect = new pygame.Rect(rect);
    const [w, h] = rect.size;
    const tmp = new pygame.Surface([w, h], pygame.SRCALPHA);
    const [c1, c2] = spec['field'];
    _field(tmp, [0, 0, w, h], py.get(spec, 'div', 'plain'), c1, c2);
    const s = Math.min(w, h) * 0.3;
    const cx = w / 2, cy = h * 0.44;
    const m = py.get(spec, 'metal', [240, 205, 80]);
    const ch = py.get(spec, 'charge');
    if (ch === 'lily3') {
        for (const [dx, dy, sc] of [[-0.24, -0.1, 0.55], [0.24, -0.1, 0.55], [0, 0.3, 0.55]]) {
            _lily(tmp, cx + dx * w, cy + dy * h, s * sc * 1.2, m);
        }
    } else if (ch === 'eagle2') {
        _bird(tmp, cx, cy + s * 0.1, s * 1.05, m, true);
    } else if (ch === 'eagle') {
        _bird(tmp, cx, cy + s * 0.1, s * 1.05, m);
    } else if (ch === 'crescent' || ch === 'crescent_star') {
        _crescent(tmp, cx - s * 0.1, cy, s * 1.1, m, c1, ch === 'crescent_star');
    } else if (ch === 'mon') {
        _mon(tmp, cx, cy + s * 0.05, s * 0.95, m, c1);
    } else if (ch === 'star') {
        _star(tmp, cx, cy, s, m);
    } else if (ch != null && Object.hasOwn(CHARGES, ch) && CHARGES[ch]) {
        CHARGES[ch](tmp, cx, cy + s * 0.05, s, m);
    }
    const mask = new pygame.Surface([w, h], pygame.SRCALPHA);
    const poly = _shield_poly([1, 1, w - 2, h - 2]);
    pygame.draw.polygon(mask, [255, 255, 255, 255], poly);
    tmp.blit(mask, [0, 0], null, pygame.BLEND_RGBA_MIN);
    // highlight at the top left
    const hl = new pygame.Surface([w, h], pygame.SRCALPHA);
    pygame.draw.polygon(hl, [255, 255, 255, 38], [[2, 2], [w * 0.5, 2], [2, h * 0.5]]);
    hl.blit(mask, [0, 0], null, pygame.BLEND_RGBA_MIN);
    tmp.blit(hl, [0, 0]);
    surf.blit(tmp, rect.topleft);
    const pts = poly.map(([px, pyy]) => [rect.x + px, rect.y + pyy]);
    pygame.draw.polygon(surf, outline, pts, Math.max(1, _int(w / 26)));
    pygame.draw.polygon(surf, shade(m, -20), _shield_poly([w * 0.06, h * 0.05, w * 0.88, h * 0.9]).map(([px, pyy]) =>
        [rect.x + px, rect.y + pyy]), 1);
}

export const _EMB = new Map();

export function emblem(spec_key, spec, w, h) {
    // Cached coat-of-arms image.
    const key = py.tkey([spec_key, w, h]);
    let img = _EMB.get(key);
    if (img === undefined) {
        img = new pygame.Surface([w, h], pygame.SRCALPHA);
        draw_emblem(img, [0, 0, w, h], spec);
        _EMB.set(key, img);
    }
    return img;
}
