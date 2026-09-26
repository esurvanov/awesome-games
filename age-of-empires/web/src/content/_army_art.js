// port of game/content/_army_art.py
// Procedural army graphics: infantry, ranged units, horsemen, siege weapons, the monk; the university and monastery.
//
// Everything is drawn by code (pygame.draw). The module is not loaded automatically (its name starts with "_"), it is
// imported by army_*.js. Unit functions have the signature UNITS[kind]['art']:
//     art(surf, kind, color, x, y, face, anim, swing, k, carry_res, moving)
import { math, modules, KeyError } from '../../runtime/py.js';
import * as pygame from '../../runtime/pygame.js';
import { shade } from '../data.js';

const int = Math.trunc;
const max = Math.max;

export const SKIN = [232, 190, 145];
export const IRON = [160, 162, 175];
export const IRON_D = [105, 106, 118];
export const STEEL = [220, 222, 232];
export const WOOD = [125, 88, 52];
export const WOOD_D = [88, 62, 38];
export const GOLD = [236, 196, 70];
export const ROPE = [196, 176, 120];


export function _pt(x, y, k, bob) {
    return function P(a, b, bb = true) {
        return [int(x + a * k), int(y + b * k + (bb ? bob : 0))];
    };
}


export function _shadow(surf, x, y, w, h) {
    const gfx = modules.gfx;
    gfx.shadow(surf, x, y, w, h);
}


// ============================================================ infantry and foot ranged units
/** Factory: a foot soldier (body - gfx.draw_foot), with its own weapon, helmet, armor on top. */
export function foot(helmet = 'iron', weapon = 'sword', shield = false, plate = false, plume = false, cape = false) {
    const base_helmet = ['hat', 'iron', 'crest', 'hood'].includes(helmet) ? helmet : 'iron';
    const base_weapon = ['tool', 'sword', 'longsword', 'spear', 'bow', 'javelin'].includes(weapon) ? weapon : null;

    function art(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null, moving = false) {
        const gfx = modules.gfx;
        const hx = face[0] >= 0 ? 1 : -1;
        const bob = moving ? Math.sin(anim) * 1.0 * k : 0;
        const P = _pt(x, y, k, bob);
        const lw = max(1, int(2 * k));
        const s = swing > 0 ? swing / 0.3 : 0;
        if (cape) {
            pygame.draw.polygon(surf, shade(color, -45), [P(-4 * hx, -12), P(-9 * hx, -1), P(-2 * hx, -2)]);
        }
        // draw_foot(surf, color, x, y, face, anim, swing, k, carry_res, moving, helmet, weapon, shield)
        gfx.draw_foot(surf, color, x, y, face, anim, swing, k, carry_res, moving, base_helmet, base_weapon, shield);
        if (plate) {
            pygame.draw.ellipse(surf, IRON, [...P(-3.6, -12), int(7.2 * k), int(7 * k)]);
            pygame.draw.ellipse(surf, IRON_D, [...P(-3.6, -12), int(7.2 * k), int(7 * k)], 1);
            pygame.draw.line(surf, shade(color, 20), P(-3.5, -7), P(3.5, -7), max(1, int(1.5 * k)));
        }
        // helmets
        if (helmet === 'great') {      // closed bucket helm
            pygame.draw.rect(surf, IRON, [...P(-3.8, -20), int(7.6 * k), int(7 * k)], 0, max(1, int(2 * k)));
            pygame.draw.line(surf, [40, 40, 48], P(-2.5 + hx, -16), P(2.5 + hx, -16), max(1, int(k)));
            if (plume) {
                pygame.draw.line(surf, shade(color, 40), P(0, -20), P(-4 * hx, -25), max(2, int(2.5 * k)));
                pygame.draw.circle(surf, shade(color, 60), P(-4 * hx, -25), max(1, int(2 * k)));
            }
        } else if (helmet === 'kettle') {   // hat-helmet with a wide brim
            pygame.draw.ellipse(surf, IRON, [...P(-5.5, -18.5), int(11 * k), int(3.5 * k)]);
            pygame.draw.ellipse(surf, IRON_D, [...P(-3, -21), int(6 * k), int(4 * k)]);
        } else if (helmet === 'cap') {      // padded crossbowman's cap
            pygame.draw.ellipse(surf, [150, 120, 80], [...P(-3.8, -20), int(7.6 * k), int(5 * k)]);
            pygame.draw.line(surf, shade(color, 30), P(-3.5, -16.5), P(3.5, -16.5), max(1, int(k)));
        } else if (helmet === 'brim') {     // wide-brimmed hat with a feather (hand cannon)
            pygame.draw.ellipse(surf, [60, 48, 40], [...P(-6, -18.5), int(12 * k), int(3.5 * k)]);
            pygame.draw.ellipse(surf, [70, 56, 46], [...P(-3.2, -21.5), int(6.4 * k), int(4 * k)]);
            pygame.draw.line(surf, shade(color, 50), P(2 * hx, -20), P(-3 * hx, -24), max(1, int(1.5 * k)));
        } else if (helmet === 'sallet') {   // sallet with a neck guard
            pygame.draw.ellipse(surf, IRON, [...P(-4, -20.5), int(8 * k), int(6 * k)]);
            pygame.draw.line(surf, IRON_D, P(-4 * hx, -16), P(-6 * hx, -14), max(1, int(1.5 * k)));
        }
        const hand = P(5 * hx, -8);
        // weapons
        if (weapon === 'greatsword') {
            const tip = P((17 + s * 4) * hx, -26 + s * 17);
            pygame.draw.line(surf, STEEL, hand, tip, max(2, int(2.5 * k)));
            pygame.draw.line(surf, [140, 140, 150], hand, tip, 1);
            const [gx, gy] = P(6 * hx, -10 + s * 2);
            pygame.draw.line(surf, [190, 160, 70], [gx - int(3 * k), gy - int(2 * k)], [gx + int(3 * k), gy + int(2 * k)],
                lw);
        } else if (weapon === 'pike' || weapon === 'halberd') {
            const base = P(2 * hx, 2), top = P((11 + s * 6) * hx, -33 + s * 7);
            pygame.draw.line(surf, [140, 105, 65], base, top, lw);
            if (weapon === 'pike') {
                pygame.draw.circle(surf, STEEL, top, max(1, int(2 * k)));
            } else {
                const [tx, ty] = top;
                pygame.draw.line(surf, STEEL, [tx, ty], [tx + int(2 * k * hx), ty - int(4 * k)], lw);
                pygame.draw.polygon(surf, STEEL, [[tx - int(1 * k * hx), ty + int(2 * k)],
                    [tx + int(5 * k * hx), ty],
                    [tx + int(6 * k * hx), ty + int(5 * k)],
                    [tx - int(1 * k * hx), ty + int(5 * k)]]);
                pygame.draw.polygon(surf, IRON_D, [[tx - int(1 * k * hx), ty + int(2 * k)],
                    [tx + int(5 * k * hx), ty],
                    [tx + int(6 * k * hx), ty + int(5 * k)],
                    [tx - int(1 * k * hx), ty + int(5 * k)]], 1);
            }
        } else if (weapon === 'crossbow') {
            const a = P(1 * hx, -9), b = P(11 * hx, -11);
            pygame.draw.line(surf, [110, 78, 45], a, b, max(2, int(2.5 * k)));
            const [bx, by] = P(9 * hx, -11);
            pygame.draw.line(surf, [70, 60, 55], [bx, by - int(5 * k)], [bx, by + int(5 * k)], lw);
            pygame.draw.line(surf, [230, 230, 230], [bx, by - int(5 * k)], P(5 * hx, -11), 1);
            pygame.draw.line(surf, [230, 230, 230], [bx, by + int(5 * k)], P(5 * hx, -11), 1);
        } else if (weapon === 'handcannon') {
            const a = P(-1 * hx, -10), b = P(13 * hx, -13);
            pygame.draw.line(surf, [110, 78, 45], a, P(4 * hx, -11), max(2, int(2.5 * k)));
            pygame.draw.line(surf, [60, 60, 66], P(3 * hx, -11), b, max(2, int(3 * k)));
            pygame.draw.circle(surf, [40, 40, 44], b, max(1, int(1.5 * k)));
            if (s > 0.3) {
                const [bx, by] = b;
                for (let i = 0; i < 3; i++) {
                    pygame.draw.circle(surf, [225, 225, 225], [bx + int((3 + i * 3) * k * hx), by - int(i * 2 * k)],
                        max(1, int((2.5 + i) * k)));
                }
                pygame.draw.circle(surf, [255, 200, 80], [bx + int(2 * k * hx), by], max(1, int(1.5 * k)));
            }
        } else if (weapon === 'bigbow') {      // a larger bow (for archers in armor)
            const [bx, by] = P(6 * hx, -11);
            const r = new pygame.Rect(0, 0, int(9 * k), int(19 * k));
            r.center = [bx, by];
            const a0 = hx > 0 ? -Math.PI / 2 : Math.PI / 2;
            pygame.draw.arc(surf, [120, 76, 36], r, a0, a0 + Math.PI, lw);
            pygame.draw.line(surf, [230, 230, 230], [bx, r.top], [bx, r.bottom], 1);
        }
    }
    return art;
}


/** Monk: a long robe, a belt in player color, a tonsure, a staff; when converting/healing - a glow. */
export function monk(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null, moving = false) {
    const hx = face[0] >= 0 ? 1 : -1;
    const bob = moving ? Math.sin(anim) * 0.8 * k : 0;
    const P = _pt(x, y, k, bob);
    _shadow(surf, x - 7 * k, y - 2 * k, 14 * k, 5 * k);
    const robe = [150, 112, 62];
    const pts = [P(-3.5, -13), P(3.5, -13), P(6, 0, false), P(-6, 0, false)];
    pygame.draw.polygon(surf, robe, pts);
    pygame.draw.polygon(surf, shade(robe, -60), pts, 1);
    pygame.draw.line(surf, color, P(-4.5, -6), P(4.5, -6), max(2, int(2 * k)));
    pygame.draw.line(surf, color, P(2 * hx, -6), P(2.5 * hx, -1), max(1, int(1.5 * k)));
    pygame.draw.ellipse(surf, shade(robe, -25), [...P(-4.5, -15), int(9 * k), int(4 * k)]);
    pygame.draw.circle(surf, SKIN, P(0, -17), int(3.4 * k));
    pygame.draw.arc(surf, [110, 80, 50], [...P(-3.4, -20.4), int(6.8 * k), int(6.8 * k)], 0.3, Math.PI - 0.3,
        max(1, int(1.2 * k)));
    const [sx, sy] = P(6 * hx, 0, false);
    const [tx, ty] = P(7 * hx, -24);
    pygame.draw.line(surf, [120, 88, 52], [sx, sy], [tx, ty], max(1, int(2 * k)));
    pygame.draw.circle(surf, [140, 104, 60], [tx, ty], max(2, int(2.3 * k)), max(1, int(k)));
    if (swing > 0) {
        const glow = new pygame.Surface([int(26 * k), int(26 * k)], pygame.SRCALPHA);
        pygame.draw.circle(glow, [255, 245, 170, 90], glow.get_rect().center, int(12 * k));
        pygame.draw.circle(glow, [255, 250, 210, 150], glow.get_rect().center, int(6 * k));
        surf.blit(glow, [tx - int(13 * k), ty - int(13 * k)]);
    }
}


// ============================================================ horsemen
/** Horseman factory. bard: None | 'cloth' | 'plate' | 'gold'; head: 'skin' | 'helm' | 'great' | 'gold' |
 * 'turban' | 'cap'; weapon: 'sword' | 'lance' | 'sabre' | 'bow'. */
export function rider(horse = [110, 76, 48], bard = null, head = 'helm', weapon = 'sword', camel = false, plume = false, big = false) {

    function art(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null, moving = false) {
        const hx = face[0] >= 0 ? 1 : -1;
        const bob = moving ? Math.sin(anim) * 1.0 * k : 0;
        const P = _pt(x, y, k, bob);
        const lw = max(1, int(2 * k));
        const sc = big ? 1.1 : 1.0;
        _shadow(surf, x - 14 * k * sc, y - 3 * k, 28 * k * sc, 9 * k);
        const legh = camel ? 5 : 3;
        const LX = [-7, -4, 5, 8];
        for (let i = 0; i < LX.length; i++) {
            const lx = LX[i];
            const off = moving ? Math.sin(anim + i * 1.7) * 2.5 : 0;
            pygame.draw.line(surf, shade(horse, -40), P(lx * sc, -3 - legh + 3), P(lx * sc + off, 3, false), lw);
        }
        const by = -11 - (legh - 3);
        const body = [...P(-11 * sc, by), int(22 * k * sc), int(10 * k)];
        pygame.draw.ellipse(surf, horse, body);
        if (camel) {
            pygame.draw.circle(surf, shade(horse, 12), P(-2, by - 1), int(4.5 * k));
            // long curved neck
            pygame.draw.line(surf, horse, P(8 * hx, by + 3), P(13 * hx, by - 6), max(3, int(4 * k)));
            pygame.draw.line(surf, horse, P(13 * hx, by - 6), P(17 * hx, by - 7), max(3, int(3.5 * k)));
            pygame.draw.circle(surf, horse, P(17 * hx, by - 7), int(2.8 * k));
        } else {
            pygame.draw.polygon(surf, horse, [P(6 * hx * sc, by + 1), P(11 * hx * sc, by - 5), P(14 * hx * sc, by - 2),
                P(9 * hx * sc, by + 5)]);
            pygame.draw.circle(surf, horse, P(13 * hx * sc, by - 3), int(3.3 * k));
            pygame.draw.line(surf, shade(horse, -50), P(10 * hx * sc, by - 5), P(8 * hx * sc, by - 1), max(1, int(k)));
        }
        pygame.draw.line(surf, shade(horse, -30), P(-10 * hx * sc, by + 3), P(-15 * hx * sc, by + 9), lw);
        if (bard === 'cloth') {
            pygame.draw.ellipse(surf, color, [...P(-9 * sc, by + 1), int(18 * k * sc), int(8 * k)]);
        } else if (bard === 'plate' || bard === 'gold') {
            pygame.draw.ellipse(surf, color, [...P(-10 * sc, by + 1), int(20 * k * sc), int(9 * k)]);
            const trim = bard === 'gold' ? GOLD : IRON;
            pygame.draw.ellipse(surf, trim, [...P(-10 * sc, by + 1), int(20 * k * sc), int(9 * k)], max(1, int(1.5 * k)));
            pygame.draw.polygon(surf, trim, [P(9 * hx * sc, by - 2), P(13 * hx * sc, by - 6), P(15 * hx * sc, by - 3)]);
        }
        pygame.draw.ellipse(surf, shade(horse, -70), body, 1);
        // rider
        const ry = by - 4;
        pygame.draw.circle(surf, color, P(0, ry), int(4.6 * k));
        pygame.draw.circle(surf, shade(color, -80), P(0, ry), int(4.6 * k), 1);
        const hy = ry - 6;
        if (head === 'skin') {
            pygame.draw.circle(surf, SKIN, P(0, hy), int(3.2 * k));
        } else if (head === 'turban') {
            pygame.draw.circle(surf, SKIN, P(0, hy), int(3.2 * k));
            pygame.draw.ellipse(surf, [235, 230, 215], [...P(-3.8, hy - 4), int(7.6 * k), int(4.5 * k)]);
        } else if (head === 'cap') {
            pygame.draw.circle(surf, SKIN, P(0, hy), int(3.2 * k));
            pygame.draw.ellipse(surf, shade(color, -30), [...P(-3.6, hy - 4), int(7.2 * k), int(4 * k)]);
            pygame.draw.line(surf, [240, 240, 240], P(-2 * hx, hy - 3), P(-6 * hx, hy - 7), max(1, int(1.5 * k)));
        } else if (head === 'great') {
            pygame.draw.rect(surf, IRON, [...P(-3.3, hy - 3.5), int(6.6 * k), int(7 * k)], 0, max(1, int(2 * k)));
            pygame.draw.line(surf, [40, 40, 48], P(-2 + hx, hy), P(2 + hx, hy), 1);
        } else if (head === 'gold') {
            pygame.draw.rect(surf, [225, 215, 190], [...P(-3.3, hy - 3.5), int(6.6 * k), int(7 * k)],
                0, max(1, int(2 * k)));
            pygame.draw.polygon(surf, GOLD, [P(-3.3, hy - 3.5), P(-2, hy - 6.5), P(0, hy - 4), P(2, hy - 6.5),
                P(3.3, hy - 3.5)]);
        } else {
            pygame.draw.circle(surf, [175, 175, 185], P(0, hy), int(3.2 * k));
        }
        if (plume) {
            pygame.draw.line(surf, shade(color, 50), P(0, hy - 3), P(-4 * hx, hy - 8), max(2, int(2.2 * k)));
        }
        const s = swing * 20;
        if (weapon === 'lance') {
            pygame.draw.line(surf, [200, 180, 140], P(2 * hx, ry), P((21 + s * 0.3) * hx, ry - 8 + s * 0.4), lw);
            pygame.draw.circle(surf, STEEL, P((21 + s * 0.3) * hx, ry - 8 + s * 0.4), max(1, int(1.5 * k)));
        } else if (weapon === 'sabre') {
            const a = P(3 * hx, ry);
            const b = P((12 + s * 0.2) * hx, ry - 7 + s * 0.5);
            pygame.draw.line(surf, STEEL, a, b, lw);
            pygame.draw.circle(surf, STEEL, b, max(1, int(k)));
        } else if (weapon === 'bow') {
            const [bx, by2] = P(6 * hx, ry - 1);
            const r = new pygame.Rect(0, 0, int(7 * k), int(14 * k));
            r.center = [bx, by2];
            const a0 = hx > 0 ? -Math.PI / 2 : Math.PI / 2;
            pygame.draw.arc(surf, [130, 85, 40], r, a0, a0 + Math.PI, lw);
            pygame.draw.line(surf, [220, 220, 220], [bx, r.top], [bx, r.bottom], 1);
            // quiver
            pygame.draw.line(surf, [110, 70, 40], P(-4 * hx, ry - 4), P(-6 * hx, ry + 3), max(2, int(2.5 * k)));
        } else if (weapon !== 'none') {
            pygame.draw.line(surf, STEEL, P(3 * hx, ry), P(10 * hx, ry - 6 + s * 0.4), lw);
        }
    }
    return art;
}


// ============================================================ siege weapons
export function _wheel(surf, c, r, k) {
    pygame.draw.circle(surf, [60, 45, 30], c, int(r * k));
    pygame.draw.circle(surf, [110, 90, 60], c, int(r * k), max(1, int(k)));
    pygame.draw.circle(surf, [40, 30, 20], c, max(1, int(1.3 * k)));
}


/** Ram: 'plank' - planks, 'hide' - covered with hides (Capped Ram), 'iron' - iron-bound (Siege Ram). */
export function ram(roof = 'hide', big = false) {

    function art(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null, moving = false) {
        const hx = face[0] >= 0 ? 1 : -1;
        const P = _pt(x, y, k, 0);
        const sc = big ? 1.15 : 1.0;
        _shadow(surf, x - 17 * k * sc, y - 4 * k, 34 * k * sc, 11 * k);
        const s = swing * 12;
        pygame.draw.line(surf, WOOD_D, P((6 + s) * hx, -7), P((19 * sc + s) * hx, -7), max(2, int(4 * k)));
        const head = roof !== 'iron' ? [150, 150, 160] : [120, 122, 135];
        pygame.draw.circle(surf, head, P((19 * sc + s) * hx, -7), int(3.5 * k));
        if (roof === 'iron') {
            pygame.draw.polygon(surf, head, [P((19 * sc + s) * hx, -11), P((23 * sc + s) * hx, -7),
                P((19 * sc + s) * hx, -3)]);
        }
        const w = 13 * sc;
        const wall = roof !== 'iron' ? WOOD : [105, 80, 55];
        pygame.draw.rect(surf, wall, [...P(-w, -13), int(2 * w * k), int(12 * k)]);
        const RC = { plank: shade(WOOD, 20), hide: [150, 118, 80], iron: [118, 120, 132] };
        if (!Object.hasOwn(RC, roof)) throw new KeyError(roof);
        const rc = RC[roof];
        const top = -21 - (big ? 3 : 0);
        pygame.draw.polygon(surf, rc, [P(-w - 2, -11), P(0, top), P(w + 2, -11)]);
        if (roof === 'hide') {
            for (let i = -2; i < 3; i++) {
                pygame.draw.line(surf, shade(rc, -35), P(i * 5, -11), P(i * 2, top + 2), 1);
            }
            pygame.draw.line(surf, shade(rc, 25), P(-w, -12), P(w, -12), 1);
        } else if (roof === 'iron') {
            for (let i = -2; i < 3; i++) {
                pygame.draw.line(surf, shade(rc, -35), P(i * 5, -11), P(i * 2, top + 2), 1);
            }
            for (const [a, b] of [[-8, -14], [0, -17], [8, -14], [-4, -12], [4, -12]]) {
                pygame.draw.circle(surf, [200, 200, 210], P(a, b), max(1, int(k)));
            }
        }
        pygame.draw.polygon(surf, shade(rc, -50), [P(-w - 2, -11), P(0, top), P(w + 2, -11)], 1);
        pygame.draw.line(surf, color, P(-w, -5), P(w, -5), max(1, int(3 * k)));
        pygame.draw.rect(surf, shade(wall, -50), [...P(-w, -13), int(2 * w * k), int(12 * k)], 1);
        for (const wx of [-w + 4, w - 4]) {
            _wheel(surf, P(wx, 0), 3.8, k);
        }
    }
    return art;
}


/** Catapult with a lever and a bucket: 0 - mangonel, 1 - onager (larger, a bundle of ropes), 2 - siege onager
 * (iron-bound). */
export function mangonel(level = 0) {

    function art(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null, moving = false) {
        const hx = face[0] >= 0 ? 1 : -1;
        const P = _pt(x, y, k, 0);
        const sc = 1.0 + 0.1 * level;
        _shadow(surf, x - 15 * k * sc, y - 4 * k, 30 * k * sc, 10 * k);
        const frame = level < 2 ? WOOD : [98, 72, 48];
        const L = 12 * sc;
        pygame.draw.rect(surf, frame, [...P(-L, -8), int(2 * L * k), int(5 * k)]);
        pygame.draw.rect(surf, shade(frame, -50), [...P(-L, -8), int(2 * L * k), int(5 * k)], 1);
        // supports
        pygame.draw.line(surf, shade(frame, -20), P(-2 * hx, -8), P(2 * hx, -18), max(2, int(3 * k)));
        pygame.draw.line(surf, shade(frame, -20), P(4 * hx, -8), P(2 * hx, -18), max(2, int(3 * k)));
        pygame.draw.line(surf, shade(frame, 20), P(-3 * hx, -18), P(6 * hx, -18), max(2, int(2.5 * k)));
        if (level >= 1) {
            pygame.draw.ellipse(surf, ROPE, [...P(-5, -10), int(10 * k), int(5 * k)]);
            pygame.draw.ellipse(surf, shade(ROPE, -60), [...P(-5, -10), int(10 * k), int(5 * k)], 1);
        }
        // lever: at rest it is thrown back, on firing - forward
        const s = swing > 0 ? swing / 0.3 : 0;
        const ang = hx > 0 ? math.radians(200 - 110 * s) : math.radians(-20 + 110 * s);
        const ln = (16 + 2 * level) * k;
        const [px, py] = P(0, -8);
        const ex = px + Math.cos(ang) * ln, ey = py - Math.abs(Math.sin(ang)) * ln;
        pygame.draw.line(surf, WOOD_D, [px, py], [ex, ey], max(2, int(3 * k)));
        pygame.draw.circle(surf, [95, 70, 40], [int(ex), int(ey)], int(3.2 * k));
        if (s < 0.5) {
            pygame.draw.circle(surf, [150, 145, 135], [int(ex), int(ey - 1 * k)], int(2.2 * k));
        }
        if (level >= 2) {
            for (const bx of [-L + 3, L - 3]) {
                pygame.draw.line(surf, IRON, P(bx, -8), P(bx, -3), max(1, int(2 * k)));
            }
        }
        pygame.draw.line(surf, color, P(-L, -4), P(L, -4), max(1, int(2 * k)));
        for (const wx of [-L + 3, L - 3]) {
            _wheel(surf, P(wx, 0), 3.5 + 0.3 * level, k);
        }
    }
    return art;
}


export function scorpion(heavy = false) {
    function art(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null, moving = false) {
        const hx = face[0] >= 0 ? 1 : -1;
        const P = _pt(x, y, k, 0);
        _shadow(surf, x - 12 * k, y - 4 * k, 24 * k, 8 * k);
        // cart
        pygame.draw.rect(surf, WOOD, [...P(-9, -6), int(18 * k), int(4 * k)]);
        pygame.draw.line(surf, color, P(-9, -3), P(9, -3), max(1, int(2 * k)));
        pygame.draw.line(surf, WOOD_D, P(0, -6), P(0, -12), max(2, int(3 * k)));
        // ballista stock and bow
        const s = swing > 0 ? swing / 0.3 : 0;
        const a = P(-8 * hx, -12), b = P(11 * hx, -15);
        pygame.draw.line(surf, [110, 78, 45], a, b, max(2, int(3 * k)));
        const [bx, by] = P(7 * hx, -14);
        const span = (heavy ? 9 : 7) * k;
        const bend = (1 - s) * 4 * k;
        const tip1 = [bx - int(bend * hx), by - int(span)];
        const tip2 = [bx - int(bend * hx), by + int(span)];
        const arm = heavy ? IRON : [100, 70, 42];
        pygame.draw.line(surf, arm, [bx, by], tip1, max(2, int(2.5 * k)));
        pygame.draw.line(surf, arm, [bx, by], tip2, max(2, int(2.5 * k)));
        const sx = P((1 + 5 * s) * hx, -13);
        pygame.draw.line(surf, [230, 230, 230], tip1, sx, 1);
        pygame.draw.line(surf, [230, 230, 230], tip2, sx, 1);
        if (s < 0.5) {
            pygame.draw.line(surf, [200, 200, 210], P(1 * hx, -13), P(13 * hx, -15), max(1, int(1.5 * k)));
        }
        if (heavy) {
            pygame.draw.circle(surf, IRON_D, [bx, by], max(2, int(2.2 * k)));
        }
        for (const wx of [-6, 6]) {
            _wheel(surf, P(wx, 0), 3.2, k);
        }
    }
    return art;
}


/** Bombard: a thick iron barrel on a two-wheeled carriage. */
export function bombard(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null, moving = false) {
    const hx = face[0] >= 0 ? 1 : -1;
    const P = _pt(x, y, k, 0);
    _shadow(surf, x - 15 * k, y - 4 * k, 30 * k, 9 * k);
    const s = swing > 0 ? swing / 0.3 : 0;
    const rec = -2 * s;
    pygame.draw.polygon(surf, WOOD, [P((-14 + rec) * hx, -2), P((-2 + rec) * hx, -9), P((4 + rec) * hx, -9),
        P((-10 + rec) * hx, 0)]);
    pygame.draw.polygon(surf, WOOD_D, [P((-14 + rec) * hx, -2), P((-2 + rec) * hx, -9), P((4 + rec) * hx, -9),
        P((-10 + rec) * hx, 0)], 1);
    const a = P((-6 + rec) * hx, -10), b = P((15 + rec) * hx, -14);
    pygame.draw.line(surf, [70, 72, 80], a, b, max(4, int(7 * k)));
    for (const t of [0.2, 0.5, 0.8]) {
        const cx = a[0] + (b[0] - a[0]) * t;
        const cy = a[1] + (b[1] - a[1]) * t;
        pygame.draw.circle(surf, [110, 112, 122], [int(cx), int(cy)], int(3.8 * k), max(1, int(k)));
    }
    pygame.draw.circle(surf, [25, 25, 28], b, int(2.5 * k));
    pygame.draw.line(surf, color, P(-6 * hx, -5), P(3 * hx, -8), max(1, int(2 * k)));
    _wheel(surf, P(0, -1), 5.5, k);
    if (s > 0.3) {
        const [bx, by] = b;
        for (let i = 0; i < 4; i++) {
            pygame.draw.circle(surf, [230, 230, 225], [bx + int((4 + i * 4) * k * hx), by - int(i * 3 * k)],
                max(1, int((3 + i * 1.5) * k)));
        }
        pygame.draw.circle(surf, [255, 190, 70], [bx + int(3 * k * hx), by], max(2, int(2.5 * k)));
    }
}


/** Packed trebuchet: a long wagon with the lever and counterweight laid down. */
export function trebuchet_packed(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null,
    moving = false) {
    const hx = face[0] >= 0 ? 1 : -1;
    const P = _pt(x, y, k, 0);
    _shadow(surf, x - 20 * k, y - 5 * k, 40 * k, 11 * k);
    pygame.draw.rect(surf, WOOD, [...P(-17, -9), int(34 * k), int(6 * k)]);
    pygame.draw.rect(surf, WOOD_D, [...P(-17, -9), int(34 * k), int(6 * k)], 1);
    pygame.draw.line(surf, [110, 80, 50], P(-19 * hx, -14), P(22 * hx, -12), max(3, int(4 * k)));
    pygame.draw.rect(surf, [90, 84, 78], [...P(-12 * hx - 4, -19), int(8 * k), int(7 * k)]);
    pygame.draw.rect(surf, [60, 56, 52], [...P(-12 * hx - 4, -19), int(8 * k), int(7 * k)], 1);
    for (const i of [-6, 2, 10]) {
        pygame.draw.line(surf, ROPE, P(i, -9), P(i + 1, -14), 1);
    }
    pygame.draw.line(surf, color, P(-17, -4), P(17, -4), max(1, int(2 * k)));
    for (const wx of [-13, -4, 5, 14]) {
        _wheel(surf, P(wx, 0), 3.2, k);
    }
}


/** Deployed trebuchet: a tall A-frame, a long lever, a counterweight box, a sling. */
export function trebuchet_up(surf, kind, color, x, y, face = [1.0, 0.0], anim = 0.0, swing = 0.0, k = 1.0, carry_res = null,
    moving = false) {
    const hx = face[0] >= 0 ? 1 : -1;
    const P = _pt(x, y, k, 0);
    _shadow(surf, x - 20 * k, y - 6 * k, 40 * k, 13 * k);
    // base
    pygame.draw.line(surf, WOOD_D, P(-18, -2), P(18, -2), max(3, int(4 * k)));
    pygame.draw.line(surf, WOOD_D, P(-8, 2), P(8, -6), max(2, int(3 * k)));
    // A-frame
    const top = P(0, -34);
    for (const bx of [-11, 11]) {
        pygame.draw.line(surf, WOOD, P(bx, -2), top, max(3, int(4 * k)));
    }
    pygame.draw.line(surf, WOOD, P(-6, -18), P(6, -18), max(2, int(3 * k)));
    // lever: at rest the long arm points down-back, on firing - up-forward
    const s = swing > 0 ? swing / 0.3 : 0;
    const ang = math.radians(-35 + 115 * s);     // from the horizontal, positive is up and forward
    const [tx, ty] = top;
    const L1 = 30 * k, L2 = 10 * k;
    const ex = tx + Math.cos(ang) * L1 * hx;
    const ey = ty - Math.sin(ang) * L1;
    const cx = tx - Math.cos(ang) * L2 * hx;
    const cy = ty + Math.sin(ang) * L2;
    pygame.draw.line(surf, [105, 74, 44], [cx, cy], [ex, ey], max(3, int(4 * k)));
    pygame.draw.rect(surf, [92, 86, 80], [int(cx - 5 * k), int(cy), int(10 * k), int(9 * k)]);
    pygame.draw.rect(surf, [60, 56, 52], [int(cx - 5 * k), int(cy), int(10 * k), int(9 * k)], 1);
    pygame.draw.line(surf, ROPE, [ex, ey], [ex + 3 * k * hx, ey + 8 * k], 1);
    if (s < 0.5) {
        pygame.draw.circle(surf, [140, 135, 125], [int(ex + 3 * k * hx), int(ey + 9 * k)], int(2.5 * k));
    }
    pygame.draw.circle(surf, IRON_D, top, max(2, int(2.5 * k)));
    // a player-color pennant
    const [fx, fy] = P(-11 * hx, -2);
    pygame.draw.line(surf, [70, 50, 35], [fx, fy], [fx, fy - int(14 * k)], 1);
    pygame.draw.polygon(surf, color, [[fx, fy - int(14 * k)], [fx + int(8 * k * hx), fy - int(11 * k)],
        [fx, fy - int(8 * k)]]);
}


// ============================================================ buildings
// gfx.IsoPainter signatures (kwargs placed by position): box(x0, y0, x1, y1, h, color, z0=0.0, top=True, tex=None),
// gable(x0, y0, x1, y1, z, rh, color, wall, axis='x', ov=0.1), hip(x0, y0, x1, y1, z, rh, color, ov=0.1),
// poly(pts, color, outline=True).

/** University 4x4: an observatory tower with a dome (behind), a hall with a colonnade, a book emblem. */
export function university(p, surf, color, s) {
    const gfx = modules.gfx;
    p.box(0.1, 0.1, s - 0.1, s - 0.1, 6, [170, 162, 148]);
    // the domed tower is behind the hall, so it is drawn first
    p.box(0.5, 0.5, 1.4, 1.4, 74, gfx.STONE, 6, true, 'stone');
    p.window_l(0.95, 1.4, 58, 0.14, 9);
    p.window_r(1.4, 0.95, 58, 0.14, 9);
    let [cx, cy] = p.P(0.95, 0.95, 80);
    cx = int(cx); cy = int(cy);
    pygame.draw.circle(surf, [96, 122, 150], [cx, cy], 17, 0, true, true);
    pygame.draw.circle(surf, [130, 156, 184], [cx - 5, cy - 7], 5);
    pygame.draw.circle(surf, [60, 80, 100], [cx, cy], 17, 1, true, true);
    pygame.draw.line(surf, [40, 50, 60], [cx - 1, cy - 14], [cx + 9, cy - 22], 4);
    // hall
    p.box(0.4, 1.5, s - 0.4, s - 0.9, 34, gfx.PLASTER, 6, false, 'stone');
    p.box(1.5, 0.4, s - 0.4, 1.5, 34, gfx.PLASTER, 6, false, 'stone');
    p.gable(1.5, 0.4, s - 0.4, s - 0.9, 40, 18, gfx.ROOF_SLATE, gfx.PLASTER, 'x');
    p.gable(0.4, 1.5, 1.5, s - 0.9, 40, 18, gfx.ROOF_SLATE, gfx.PLASTER, 'x');
    // colonnade along the facade
    for (let i = 0; i < 6; i++) {
        const xm = 0.7 + i * (s - 1.4) / 5;
        p.box(xm - 0.07, s - 0.9, xm + 0.07, s - 0.76, 30, [236, 228, 210], 6, false);
    }
    p.box(0.4, s - 0.95, s - 0.4, s - 0.72, 5, [220, 210, 190], 36);
    p.door(s / 2, s - 0.9, 0.5, 20, [70, 50, 34]);
    for (const ym of [1.8, 2.6]) {
        p.window_r(s - 0.4, ym, 20);
    }
    // emblem: an open book
    let [ex, ey] = p.P(s / 2, s - 0.72, 52);
    ex = int(ex); ey = int(ey);
    pygame.draw.circle(surf, color, [ex, ey], 8);
    pygame.draw.circle(surf, shade(color, -70), [ex, ey], 8, 1);
    pygame.draw.polygon(surf, [250, 245, 230], [[ex - 5, ey - 3], [ex, ey - 1], [ex + 5, ey - 3], [ex + 5, ey + 3],
        [ex, ey + 4], [ex - 5, ey + 3]]);
    pygame.draw.line(surf, [120, 100, 80], [ex, ey - 1], [ex, ey + 4], 1);
    p.banner_l(0.9, s - 0.9, 34, color);
    p.banner_l(s - 0.9, s - 0.9, 34, color);
}


/** Monastery 3x3: a bell tower (behind), a long nave with a tiled roof, a round rose window. */
export function monastery(p, surf, color, s) {
    const gfx = modules.gfx;
    p.poly([[0.1, 0.1], [s - 0.1, 0.1], [s - 0.1, s - 0.1], [0.1, s - 0.1]], [150, 140, 118], false);
    const wall = [206, 192, 160];
    // bell tower
    p.box(0.3, 0.25, 1.0, 0.95, 64, gfx.STONE, undefined, false, 'stone');
    let [bx, by] = p.P(1.0, 0.6, 52);
    pygame.draw.rect(surf, [40, 34, 30], [int(bx) - 4, int(by) - 8, 8, 11]);
    pygame.draw.circle(surf, GOLD, [int(bx), int(by) - 2], 3);
    [bx, by] = p.P(0.65, 0.95, 52);
    pygame.draw.rect(surf, [40, 34, 30], [int(bx) - 4, int(by) - 8, 8, 11]);
    p.hip(0.3, 0.25, 1.0, 0.95, 64, 24, gfx.ROOF_SLATE, 0.05);
    p.flag(0.65, 0.6, 88, color, 14);
    // nave
    p.box(0.35, 1.0, s - 0.35, s - 0.35, 30, wall, undefined, false, 'stone');
    p.box(1.0, 0.35, s - 0.35, 1.0, 30, wall, undefined, false, 'stone');
    p.gable(1.0, 0.35, s - 0.35, s - 0.35, 30, 22, gfx.ROOF_RED, wall, 'y');
    p.door(s / 2 - 0.2, s - 0.35, 0.4, 16, [70, 48, 30]);
    const [rx, ry] = p.P(s - 0.35, (0.35 + s - 0.35) / 2, 36);
    pygame.draw.circle(surf, [70, 110, 170], [int(rx), int(ry)], 6);
    pygame.draw.circle(surf, [230, 210, 150], [int(rx), int(ry)], 6, 1);
    pygame.draw.line(surf, [230, 210, 150], [int(rx) - 5, int(ry)], [int(rx) + 5, int(ry)], 1);
    for (const xm of [0.7, 2.1]) {
        p.window_l(xm, s - 0.35, 14, 0.12, 9);
    }
    p.banner_l(s - 0.8, s - 0.35, 28, color);
}
