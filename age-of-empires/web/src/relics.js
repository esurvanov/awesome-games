// port of game/relics.py
// Relics (as in AoE II DE): they lie on the map owned by nobody and cannot be destroyed. A monk picks up a relic
// (while carrying it - he neither heals nor converts), takes it to his monastery; each relic in a monastery brings its
// owner 0.5 gold per game second. The monk died - the relic falls to the ground; the monastery is destroyed -
// the relics fall out around it. Relic victory is not enabled.
//
// API:
//   spawn(w, tx, ty)            - put a relic on a tile (or the nearest free one); -> Relic
//   on_ground(w)                - relics on the ground
//   held(w, b)                  - how many relics are in building b
//   cmd_pick(u, w, r)           - a monk: pick up relic r (the order orders 'relic')
//   cmd_deposit(u, w, b)        - a monk with a relic: carry it to monastery b (the order orders 'relic_in')
//   tick(w, dt)                 - income, dropping, simple AI logic (WORLD_HOOKS['tick'])
//   draw_ground / draw_carried  - drawing (game/ui.py); panel - a line in the monastery panel
// World state: w.relics - a list of Relic (the world has it after the first spawn; getattr(w, 'relics', ())).
import * as py from '../runtime/py.js';
import { math, modules } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import * as i18n from './i18n.js';
import { TILE, UNITS, BUILDINGS, WORLD_HOOKS } from './data.js';

export const GOLD_PER_S = 0.5            // AoE2 DE: gold per game second per relic
export const AI_T = 3.0                  // the AI thinks about relics once every this many seconds
export const AI_LEVEL = 2                // from which AI level (0...5) monks collect relics
export const REACH = 6                   // px: a monk takes a relic once he is right next to it

/** obj.__dict__.get(k, dflt): only the instance's own attribute. */
function _own(o, k, dflt = null) {
    return Object.hasOwn(o, k) ? o[k] : dflt;
}

/** A relic. On the ground - carrier and holder are None; with a monk - carrier; in a monastery - holder. */
export class Relic {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.carrier = null;
        this.holder = null;
        this.alive = true;
        this.var = Math.trunc(x * 7 + y * 13) & 0xff;
    }

    get tx() {
        return Math.floor(this.x / TILE);
    }

    get ty() {
        return Math.floor(this.y / TILE);
    }

    center() {
        return [this.x, this.y];
    }

    get free() {
        return this.carrier == null && this.holder == null;
    }
}
py.classattrs(Relic, { kind: 'relic', owner: -1, w: 1, h: 1, is_relic: true });
py.register_class(Relic, 'relics.Relic');

export function _list(w) {
    let lst = _own(w, 'relics');
    if (lst == null) lst = w.relics = [];
    return lst;
}

/** A relic on tile (tx, ty); if the tile is occupied/impassable - on the nearest free one. */
export function spawn(w, tx, ty) {
    if (!w.passable(tx, ty) || w.occ[ty][tx] != null) [tx, ty] = w.nearest_free_tile(tx, ty);
    const r = new Relic((tx + 0.5) * TILE, (ty + 0.5) * TILE);
    _list(w).push(r);
    return r;
}

export function on_ground(w) {
    return py.getattr(w, 'relics', []).filter(r => r.free);
}

export function held(w, b) {
    let n = 0;
    for (const r of py.getattr(w, 'relics', [])) if (r.holder === b) n += 1;
    return n;
}

export function _monastery_ok(u, b) {
    return b != null && b.alive && b.kind === 'monastery' && b.complete && b.owner === u.owner;
}

// ============================================================ monk orders
export function cmd_pick(u, w, r) {
    if (!py.bool(py.get(u.d, 'monk', null)) || u.relic != null || r == null || !r.free) return false;
    u.release();
    u.state = 'relic_pick';
    u.target = r;
    u.path_target = null;
    u.path = [];
    return true;
}

export function cmd_deposit(u, w, b) {
    if (u.relic == null || !_monastery_ok(u, b)) return false;
    u.release();
    u.state = 'relic_in';
    u.target = b;
    u.path_target = null;
    u.path = [];
    return true;
}

export function _st_pick(u, w, dt) {
    const r = u.target;
    if (r == null || !(r instanceof Relic) || !r.free || u.relic != null) {
        u.state = 'idle';
        u.target = null;
        return;
    }
    if (u.approach(w, r, REACH, dt)) {
        r.carrier = u;
        u.relic = r;
        r.x = u.x;
        r.y = u.y;
        u.state = 'idle';
        u.target = null;
        if (u.owner === w.human) w.msg(i18n.t('msg.relic_picked'), [255, 230, 150]);
        // straight to the nearest own monastery, if there is one (as DE does on a Shift order - simplified)
        const b = nearest_monastery(w, u);
        if (b != null && u.owner !== w.human) cmd_deposit(u, w, b);
    }
}

export function _st_deposit(u, w, dt) {
    const b = u.target;
    const r = u.relic;
    if (r == null || !_monastery_ok(u, b)) {
        u.state = 'idle';
        u.target = null;
        return;
    }
    if (u.approach(w, b, 0.5 * TILE, dt)) {
        r.carrier = null;
        r.holder = b;
        const [cx, cy] = b.center();
        r.x = cx;
        r.y = cy;
        u.relic = null;
        u.state = 'idle';
        u.target = null;
        if (b.owner === w.human) w.msg(i18n.t('msg.relic_stored', { n: py.fmt(GOLD_PER_S, 'g') }), [255, 230, 150]);
    }
}

export function nearest_monastery(w, u) {
    let best = null, bd = 1e18;
    for (const b of w.buildings) {
        if (_monastery_ok(u, b)) {
            const d = u.dist_to(b);
            if (d < bd) {
                bd = d;
                best = b;
            }
        }
    }
    return best;
}

// ============================================================ world
/** Put a relic on the ground at the point (x, y) px; k - a number when several fall out (to spread them). */
export function _drop(w, r, x, y, k = 0) {
    let tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (k) {
        const a = k * 2.39996;
        tx += py.round(math.cos(a) * (1 + k * 0.4));
        ty += py.round(math.sin(a) * (1 + k * 0.4));
    }
    tx = Math.max(0, Math.min(w.W - 1, tx));
    ty = Math.max(0, Math.min(w.H - 1, ty));
    if (!w.passable(tx, ty)) [tx, ty] = w.nearest_free_tile(tx, ty);
    r.carrier = null;
    r.holder = null;
    r.x = (tx + 0.5) * TILE;
    r.y = (ty + 0.5) * TILE;
}

export function tick(w, dt) {
    const lst = _own(w, 'relics');
    if (!py.bool(lst)) return;
    const players = w.players;
    const out = new Map();              // building -> how many fell out  [Python: id(b)]
    for (const r of lst) {
        const c = r.carrier;
        if (c != null) {
            if (c.alive || c.inside != null) {
                r.x = c.x;
                r.y = c.y;
                if (c.relic !== r) c.relic = r;     // the monk was converted/reset its state - restore the link
            } else {
                _drop(w, r, c.x, c.y);       // the monk died - the relic is on the ground
                c.relic = null;
            }
            continue;
        }
        const b = r.holder;
        if (b != null) {
            if (!b.alive) {
                const k = (out.has(b) ? out.get(b) : -1) + 1;
                out.set(b, k);
                const [cx, cy] = b.center();
                _drop(w, r, cx, cy + (b.h / 2 + 0.6) * TILE, k);
            } else if (0 <= b.owner && b.owner < players.length) {
                players[b.owner].res['gold'] += GOLD_PER_S * dt;
            }
        }
    }
    // AI: one free monk goes for the nearest relic, a monk with a relic - to the monastery
    let t = _own(w, '_relic_ai_t', 0.0) - dt;
    if (t <= 0) {
        t = AI_T;
        _ai(w);
    }
    w._relic_ai_t = t;
}

export function _ai(w) {
    const ais = py.getattr(w, 'ais', null);
    if (!py.bool(ais)) return;
    const ground = on_ground(w);
    for (const ai of ais) {
        if (py.getattr(ai, 'level', 0) < AI_LEVEL) continue;
        const pid = ai.pid;
        const monks = w.units.filter(u => u.owner === pid && u.alive && py.bool(py.get(u.d, 'monk', null)));
        if (!monks.length) continue;
        let home = null;
        for (const u of monks) {
            if (u.relic != null && u.state !== 'relic_in') {
                home = home || nearest_monastery(w, u);
                if (home != null) cmd_deposit(u, w, home);
            }
        }
        if (!ground.length || monks.some(u => u.state === 'relic_pick')) continue;
        const idle = monks.filter(u => u.relic == null && u.state === 'idle');
        if (!idle.length || nearest_monastery(w, idle[0]) == null) continue;
        const taken = new Set();
        for (const u of w.units) if (u.state === 'relic_pick') taken.add(u.target);
        let best = null;
        for (const m of idle) {
            for (const r of ground) {
                if (taken.has(r)) continue;
                const d = math.hypot(r.x - m.x, r.y - m.y);
                if (best == null || d < best[0]) best = [d, m, r];
            }
        }
        if (best != null) cmd_pick(best[1], w, best[2]);
    }
}

// ============================================================ drawing
/** A procedural relic: a golden casket on a litter (~ 22x18 px at k=1). */
export function _chest(k = 1.0) {
    const W = Math.trunc(24 * k) + 2, H = Math.trunc(20 * k) + 2;
    const s = new pygame.Surface([W, H], pygame.SRCALPHA);
    const P = (x, y) => [Math.trunc(x * k) + 1, Math.trunc(y * k) + 1];
    pygame.draw.ellipse(s, [0, 0, 0, 70], [...P(1, 13), Math.trunc(22 * k), Math.trunc(6 * k)]);
    pygame.draw.line(s, [110, 70, 30], P(0, 13), P(23, 9), Math.max(1, Math.trunc(2 * k)));
    const body = [P(4, 8), P(14, 5), P(20, 8), P(20, 14), P(10, 17), P(4, 14)];
    pygame.draw.polygon(s, [214, 170, 52], body);
    pygame.draw.polygon(s, [170, 124, 30], [P(10, 11), P(20, 8), P(20, 14), P(10, 17)]);
    pygame.draw.polygon(s, [250, 220, 110], [P(4, 8), P(14, 5), P(20, 8), P(10, 11)]);
    pygame.draw.polygon(s, [90, 60, 20], body, 1);
    pygame.draw.line(s, [255, 245, 190], P(7, 7), P(9, 3), 1);
    pygame.draw.line(s, [255, 245, 190], P(15, 5), P(17, 1), 1);
    return [s, Math.floor(W / 2), H - Math.trunc(4 * k)];
}

export const _SPR = new Map();

/** (surface, ax, ay) - the point (ax, ay) of the sprite is placed on the ground. */
export function sprite(small = false) {
    const key = small;
    let hit = _SPR.get(key);
    if (hit === undefined) {
        let got = null;
        try {
            const map_assets = modules.map_assets;
            got = map_assets.relic();
        } catch (e) {
            got = null;
        }
        if (got != null) {
            let [surf, ox, oy] = got;
            if (small) {
                const k = 0.6;
                surf = pygame.transform.smoothscale(surf, [Math.max(1, Math.trunc(surf.get_width() * k)),
                    Math.max(1, Math.trunc(surf.get_height() * k))]);
                ox = ox * k;
                oy = oy * k;
            }
            // a nature sprite: (ox, oy) - the top corner of the tile's diamond; the ground - the center of the diamond (+16)
            hit = [surf, Math.trunc(ox), Math.trunc(oy) + 16];
        } else {
            hit = _chest(small ? 0.7 : 1.0);
        }
        _SPR.set(key, hit);
    }
    return hit;
}

export function draw_ground(g, r, sx, sy) {
    const [surf, ax, ay] = sprite();
    const x = Math.trunc(sx - ax), y = Math.trunc(sy - ay);
    g.screen.blit(surf, [x, y]);
    g.drawn.push([new pygame.Rect(x, y, ...surf.get_size()), r, surf]);
}

export function draw_carried(g, u, sx, sy) {
    const [surf, ax, ay] = sprite(true);
    g.screen.blit(surf, [Math.trunc(sx - ax + 6), Math.trunc(sy - ay - 30)]);
}

/** A line in the monastery panel: relics and income. */
export function panel(g, b, x, y) {
    const n = held(g.world, b);
    if (n) {
        g.text(i18n.t('relic.panel', { n: n, gold: py.fmt(n * GOLD_PER_S, 'g') }), [x, y], 'bs', [120, 80, 10], 'midleft');
    }
}

// ============================================================ registration
export function register() {
    const m = py.get(UNITS, 'monk', null);
    if (m != null) {
        const st = py.setdefault(m, 'states', {});
        st['relic_pick'] = _st_pick;
        st['relic_in'] = _st_deposit;
    }
    const b = py.get(BUILDINGS, 'monastery', null);
    if (b != null && !Object.hasOwn(b, 'panel')) b['panel'] = panel;
    if (!WORLD_HOOKS['tick'].includes(tick)) WORLD_HOOKS['tick'].push(tick);
}
