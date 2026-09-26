// port of game/controls.py
/* AoE2 DE-style controls (a mixin of ui.Game): selection (cap of 60, own units first, Ctrl/Shift, lines),
groups (Ctrl/Shift/Alt + digit, buildings in groups), finding idle units, jumps to buildings, previous view,
deletion, order modes (patrol, guard, follow, attack-move, attack ground), stances, formations,
Shift queue, signal to allies, army buttons in the command grid.

Order mechanics - game/orders.py; drawing of markers (group numbers, route flags, signals) -
game/controls_draw.py. ui.py calls the hooks from here with a single line.

Game.groups is a Map (int group number -> list of entities).
*/
import * as py from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import * as i18n from './i18n.js';
import { BUILDINGS, TECHS, HOTKEYS } from './data.js';
import { Unit, Building, Animal } from './world.js';
import * as orders from './orders.js';
import * as defense from './defense.js';

export const SEL_MAX = 60;          // DE: no more than 60 in a selection
export const DBL_MS = 350;
export const GROUP_MS = 400;
export const FLARE_S = 4.0;         // how many seconds a signal is visible
// DE: "go to building" - Ctrl+letter (all of that kind - Ctrl+Shift+letter)
export const GOTO_KEYS = new Map([
    [pygame.K_b, ['barracks']], [pygame.K_a, ['archery_range']], [pygame.K_l, ['stable']],
    [pygame.K_k, ['siege_workshop']], [pygame.K_d, ['dock']], [pygame.K_y, ['monastery']],
    [pygame.K_c, ['castle']], [pygame.K_m, ['market']], [pygame.K_s, ['blacksmith']],
    [pygame.K_u, ['university']], [pygame.K_n, ['mill']], [pygame.K_e, ['lumber_camp']],
    [pygame.K_i, ['mining_camp']], [pygame.K_t, ['tower', 'guard_tower', 'keep']],
]);
// army buttons: command grid slot QWERT/ASDFG/ZXCVB -> action; name and description - locale ctl.<action> / ctl.<action>.desc
export const ORDER_SLOTS = [[0, 'patrol'], [1, 'guard'], [2, 'follow'], [3, 'amove'], [4, 'aground']];
export const STANCE_SLOTS = [[5, 'aggressive'], [6, 'defensive'], [7, 'stand_ground'], [8, 'no_attack']];
export const FORM_SLOTS = [[10, 'line'], [11, 'box'], [12, 'staggered'], [13, 'flank']];
export const STOP_SLOT = 9;
export const SPARE_SLOTS = [14, 4, 13, 12, 11, 10];

export function _line_roots() {
    const root = {};
    for (const t of Object.values(TECHS)) {
        const up = py.get(t, 'upgrade', null);
        if (py.bool(up)) root[up[1]] = up[0];
    }
    return root;
}

const _rm = (lst, x) => { const i = lst.indexOf(x); if (i >= 0) lst.splice(i, 1); };

export class ControlsUI {
    ctl_init() {
        this.order_mode = null;
        this.order_pts = [];
        this.cam_prev = null;
        this.flares = [];
        this.goto_idx = new Map();       // py.tkey(kinds) -> index
        this.last_event = null;
        this._queue = false;
    }

    // ============================================================ camera
    /** Move the camera, remembering the previous view (Backspace). */
    jump_to(x, y) {
        this.cam_prev = [this.cam_x, this.cam_y];
        this.center_on(x, y);
    }

    prev_view() {
        if (this.cam_prev == null) return;
        const cur = [this.cam_x, this.cam_y];
        [this.cam_x, this.cam_y] = this.cam_prev;
        this.clamp_cam();
        this.cam_prev = cur;
    }

    /** Interface frame: the last event (Home), stale signals. */
    ctl_update() {
        const w = this.world;
        for (const ev of this.events) {
            if (['attack_alert', 'build_done', 'train_done', 'tech_done', 'age_up', 'flare'].includes(ev[0]) &&
                (ev[3] === 0 || ev[0] === 'attack_alert' || ev[0] === 'flare')) {
                if (ev[0] !== 'attack_alert' || ev[3] === 0) this.last_event = [ev[1], ev[2]];
            }
        }
        if (this.flares.length) this.flares = this.flares.filter(f => w.time - f[2] < FLARE_S);
    }

    // ============================================================ selection
    own_units(sel = null) {
        return (sel == null ? this.selected : sel).filter(u => u instanceof Unit && u.owner === 0 && u.alive);
    }

    cap(lst) {
        return lst.slice(0, SEL_MAX);
    }

    /** A unit's line (LineID): the root of the upgrade chain (militia -> ... -> champion). */
    line_of(kind) {
        if (ControlsUI._line_root == null) ControlsUI._line_root = _line_roots();
        const root = ControlsUI._line_root;
        let k = kind;
        for (let i = 0; i < 8; i++) {
            if (!Object.hasOwn(root, k)) break;
            k = root[k];
        }
        return k;
    }

    /** Click on the map: e - the entity under the cursor (or null). */
    click_select(e, shift, ctrl, dbl) {
        const w = this.world;
        if (e == null || py.getattr(e, 'is_relic', false)) {     // a relic is not selected - only right-click with a monk
            if (!(shift || ctrl)) this.selected = [];
            return;
        }
        const own = e.owner === 0 && (e instanceof Unit || e instanceof Building);
        if (dbl && own) {
            // double click: the whole line on screen (buildings - all of the same kind), <= 60, nearest first
            let pool;
            if (e instanceof Unit) {
                const ln = this.line_of(e.kind);
                pool = w.units.filter(u => u.owner === 0 && this.line_of(u.kind) === ln && this.on_screen(u));
            } else {
                pool = w.buildings.filter(b => b.owner === 0 && b.kind === e.kind && b.complete && this.on_screen_b(b));
            }
            const [ex, ey] = e.center();
            py.sort(pool, o => [o !== e ? 1 : 0, Math.abs(o.center()[0] - ex) + Math.abs(o.center()[1] - ey)]);
            this.selected = this.cap(pool);
            return;
        }
        if ((shift || ctrl) && own && this.selected.every(s => s.owner === 0) &&
            ((e instanceof Unit) === this.selected.every(s => s instanceof Unit) || !this.selected.length)) {
            if (this.selected.includes(e)) _rm(this.selected, e);
            else if (this.selected.length < SEL_MAX) this.selected.push(e);
            return;
        }
        this.selected = [e];
    }

    on_screen_b(b) {
        const [sx, sy] = this.w2s(...b.center());
        return this.in_view([sx, sy]) && 0 <= sx && sx < this.screen.get_width();
    }

    /** Box: only own units, top to bottom, up to 60 (buildings - no). */
    box_select(r, shift) {
        const w = this.world;
        let found = [];
        const ri = r.inflate(12, 12);
        for (const u of w.units) {
            if (u.owner !== 0) continue;
            const [sx, sy] = this.w2s(u.x, u.y);
            if (ri.collidepoint(sx, sy - 8)) found.push([sy, sx, u]);
        }
        found.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
        found = found.map(f => f[2]);
        if (!found.length) return null;
        if (shift) {
            const base = this.selected.filter(s => s instanceof Unit);
            this.selected = this.cap(base.concat(found.filter(u => !base.includes(u))));
        } else {
            this.selected = this.cap(found);
        }
        return found[0];
    }

    /** Click on a portrait in the selection panel: Ctrl - remove, Shift - only this kind, Ctrl+Shift - remove the kind. */
    panel_select(e) {
        const m = this.mods();
        const ctrl = m & (pygame.KMOD_CTRL | pygame.KMOD_META);
        const shift = m & pygame.KMOD_SHIFT;
        const kind = typeof e === 'string' ? e : e.kind;
        if (ctrl && shift) this.selected = this.selected.filter(s => s.kind !== kind);
        else if (ctrl) this.selected = this.selected.filter(s => s !== e);
        else if (shift) this.selected = this.selected.filter(s => s.kind === kind);
        else this.selected = typeof e !== 'string' ? [e] : this.selected.filter(s => s.kind === kind).slice(0, 1);
    }

    // ============================================================ keys
    /** Control keys. true - handled. */
    ctl_key(k) {
        const w = this.world;
        const m = this.mods();
        const ctrl = m & (pygame.KMOD_CTRL | pygame.KMOD_META);
        const shift = m & pygame.KMOD_SHIFT;
        const alt = m & pygame.KMOD_ALT;
        if (k === pygame.K_ESCAPE && this.order_mode) {
            this.order_mode = null;
            this.order_pts = [];
            return true;
        }
        if (k === pygame.K_BACKSPACE) {
            this.prev_view();
            return true;
        }
        if (k === pygame.K_DELETE) {
            this.delete_selected(!!shift);
            return true;
        }
        if (k === pygame.K_HOME) {
            if (this.last_event != null) this.jump_to(...this.last_event);
            return true;
        }
        if (k === pygame.K_h && !alt) {
            const tcs = w.buildings.filter(b => b.owner === 0 && b.kind === 'town_center');
            if (tcs.length) {
                if (ctrl && shift) {
                    this.selected = tcs;
                    this.jump_to(...tcs[0].center());
                } else {
                    this.tc_idx = (this.selected.length === 1 && tcs.includes(this.selected[0]))
                        ? (this.tc_idx + 1) % tcs.length : 0;
                    const tc = tcs[this.tc_idx % tcs.length];
                    this.selected = [tc];
                    this.jump_to(...tc.center());
                }
            }
            return true;
        }
        if (k === pygame.K_PERIOD) {
            if (shift || ctrl) {
                const idle = this.idle_units(false);
                if (idle.length) {
                    this.selected = this.cap(idle);
                    this.jump_to(...idle[0].center());
                }
            } else {
                this.select_idle();
            }
            return true;
        }
        if (k === pygame.K_COMMA) {
            let units;
            if (ctrl) {
                units = this.idle_units(true);
            } else if (shift) {
                units = w.units.filter(u => u.owner === 0 && this.is_military(u));
            } else {
                this.select_idle(true);
                return true;
            }
            if (units.length) {
                this.selected = this.cap(units);
                this.jump_to(...units[0].center());
            }
            return true;
        }
        if (pygame.K_0 <= k && k <= pygame.K_9) {
            this.group_key(k - pygame.K_0 + (alt ? 10 : 0), ctrl, shift);
            return true;
        }
        if (alt && k === pygame.K_f) {
            this.order_mode = 'flare';
            return true;
        }
        if (ctrl && GOTO_KEYS.has(k)) {
            this.goto_building(GOTO_KEYS.get(k), !!shift);
            return true;
        }
        if (k === pygame.K_F3) {
            this.paused = !this.paused;
            return true;
        }
        return false;
    }

    is_military(u) {
        const d = u.d;
        return u.cls !== 'vil' && !py.get(d, 'fisher', null) && !py.get(d, 'command', null) && !!u.alive && u.inside == null;
    }

    idle_units(military) {
        const w = this.world;
        if (military) {
            return w.units.filter(u => u.owner === 0 && u.state === 'idle' && this.is_military(u)
                && u.mission == null && !py.bool(u.orders));
        }
        return w.units.filter(u => u.owner === 0 && u.kind === 'villager' && u.state === 'idle');
    }

    select_idle(military = false) {
        const idle = this.idle_units(military);
        if (!idle.length) return;
        let u;
        if (military) {
            this.idle_mil_idx = (this.idle_mil_idx + 1) % idle.length;
            u = idle[this.idle_mil_idx];
        } else {
            this.idle_idx = (this.idle_idx + 1) % idle.length;
            u = idle[this.idle_idx];
        }
        this.selected = [u];
        this.jump_to(u.x, u.y);
    }

    goto_building(kinds, all_of = false) {
        const w = this.world;
        const bs = w.buildings.filter(b => b.owner === 0 && kinds.includes(b.kind) && b.complete);
        if (!bs.length) return;
        if (all_of) {
            this.selected = this.cap(bs);
            this.jump_to(...bs[0].center());
            return;
        }
        const gk = py.tkey(kinds);
        const i = ((this.goto_idx.has(gk) ? this.goto_idx.get(gk) : -1) + 1) % bs.length;
        this.goto_idx.set(gk, i);
        this.selected = [bs[i]];
        this.jump_to(...bs[i].center());
    }

    /** Ctrl+N - assign (units and buildings, <= 60; a unit - in one group only); N - select
     *  (twice - camera); Shift+N - add to the selection; Ctrl+Shift+N - select and add them; Alt - groups 10-19. */
    group_key(n, ctrl, shift) {
        const w = this.world;
        if (ctrl && !shift) {
            const mem = this.cap(this.selected.filter(s => s.owner === 0 && s.alive));
            for (const [g, lst] of Array.from(this.groups.entries())) {
                if (g !== n) this.groups.set(g, lst.filter(s => !mem.includes(s)));
            }
            this.groups.set(n, mem);
            w.msg(i18n.t('msg.group', { n, count: mem.length }));
            return;
        }
        const g = (this.groups.has(n) ? this.groups.get(n) : []).filter(s => s.alive);
        if (!g.length) return;
        if (shift && !ctrl) {
            this.selected = this.cap(this.selected.concat(g.filter(s => !this.selected.includes(s))));
            return;
        }
        const now = pygame.time.get_ticks();
        if ((ctrl && shift) || (this.last_group[0] === n && now - this.last_group[1] < GROUP_MS)) this.jump_to(...g[0].center());
        this.last_group = [n, now];
        this.selected = g;
    }

    group_of(e) {
        for (const [n, lst] of this.groups) {
            if (lst.includes(e)) return n;
        }
        return null;
    }

    /** Del - delete one (the first in the selection), Shift+Del - all selected; buildings too. */
    delete_selected(all_of = false) {
        const w = this.world;
        const own = this.selected.filter(s => s.owner === 0 && s.alive);
        if (!own.length) return;
        for (const e of (all_of ? own : own.slice(0, 1))) {
            if (e instanceof Unit) {
                e.hp = 0;
                w.damage(e, e, 1);
            } else {
                const p = w.players[0];
                if (!e.complete && e.progress <= 0.0) p.refund(p.cost_of('bld', e.kind));      // a foundation without construction - resources back
                if (py.bool(e.garrison)) defense.eject(w, e);
                e.hp = 0;
                w.damage(e, e, 1);
            }
            if (this.selected.includes(e)) _rm(this.selected, e);
        }
    }

    /** Ctrl+wheel while placing a gate - rotate (as in DE; Tab works too). true - consumed. */
    ctl_wheel(e) {
        if (this.placing && py.get(BUILDINGS[this.placing], 'gate', null) &&
            (this.mods() & (pygame.KMOD_CTRL | pygame.KMOD_META))) {
            this.gate_horiz = !this.gate_horiz;
            return true;
        }
        return false;
    }

    // ============================================================ orders
    queue_mode() {
        return !!(this.mods() & pygame.KMOD_SHIFT);
    }

    /** An order to a unit from the interface (Shift - into the queue). */
    o(u, item) {
        return orders.issue(u, this.world, item, this._queue);
    }

    formation_of(units) {
        const cnt = new Map();
        for (const u of units) {
            const f = py.getattr(u, 'formation', 'line');
            cnt.set(f, (cnt.has(f) ? cnt.get(f) : 0) + 1);
        }
        return cnt.size ? py.max(Array.from(cnt.keys()), k => cnt.get(k)) : 'line';
    }

    /** Group movement in formation: places by formation, speed - by the slowest. */
    form_move(units, wx, wy, kind = 'move') {
        if (!units.length) return;
        units = units.filter(u => u.alive);
        if (!units.length) return;
        let heading = null;
        if (this._queue) {
            // from the last point of the queue - the formation faces the same way
            const last = [];
            for (const u of units) for (const it of (u.orders || [])) if (it[0] === 'move' || it[0] === 'amove') last.push(it);
            if (last.length) heading = [wx - last[last.length - 1][1], wy - last[last.length - 1][2]];
        }
        const slots = orders.layout(units, wx, wy, this.formation_of(units), heading);
        const fs = units.length > 1 ? orders.group_speed(units) : null;
        const land = slots.filter(s => !s[0].naval);
        for (const [u, x, y] of slots) {
            if (kind === 'amove') this.o(u, ['amove', x, y]);
            else this.o(u, ['move', x, y, !u.naval && land.length > 1 ? fs : null]);
        }
    }

    start_order(mode) {
        const units = this.own_units();
        if (!units.length) return;
        if (mode === 'aground' && !units.some(u => orders.can_attack_ground(u))) return;
        this.order_mode = mode;
        this.order_pts = [];
    }

    /** Left click in order mode. pos - a screen point; mm - via the minimap. */
    order_click(pos, target = null, mm = false) {
        const w = this.world;
        const mode = this.order_mode;
        let wx, wy;
        if (mm) {
            [wx, wy] = this.mm_to_world(pos);
            target = null;
        } else {
            [wx, wy] = this.s2w(...pos);
            target = target == null ? this.entity_at(pos) : target;
        }
        const shift = this.queue_mode();
        if (mode === 'flare') {
            this.flare(wx, wy);
            this.order_mode = null;
            return;
        }
        const units = this.own_units();
        this.order_mode = !(mode === 'patrol' && shift) ? null : mode;
        if (!units.length) return;
        this._queue = shift && mode !== 'patrol';
        try {
            let col = [255, 80, 60];
            if (mode === 'patrol') {
                this.order_pts.push([wx, wy]);
                if (shift && this.order_pts.length < orders.PATROL_MAX) {
                    this.order_mode = 'patrol';
                    this.markers.push([wx, wy, [120, 200, 255], w.time]);
                    return;
                }
                const pts = this.order_pts.slice();
                this.order_pts = [];
                for (const u of units) this.o(u, ['patrol', pts]);
                col = [120, 200, 255];
            } else if (mode === 'amove') {
                if (target != null && w.hostile(0, py.getattr(target, 'owner', -1))) {
                    for (const u of units) this.o(u, ['attack', target]);
                } else {
                    this.form_move(units, wx, wy, 'amove');
                }
            } else if (mode === 'guard' || mode === 'follow') {
                if (target == null || target instanceof Animal || py.getattr(target, 'owner', -1) < 0) return;
                if (mode === 'guard' && !w.allied(0, target.owner)) return;
                for (const u of units) {
                    if (u !== target) this.o(u, [mode, target]);
                }
                col = [120, 255, 120];
            } else if (mode === 'aground') {
                for (const u of units) {
                    if (orders.can_attack_ground(u)) this.o(u, ['aground', wx, wy]);
                }
            }
            this.markers.push([wx, wy, col, w.time]);
            w.emit('command', wx, wy, 0, (mode === 'amove' || mode === 'aground') ? 'attack' : 'move');
        } finally {
            this._queue = false;
        }
    }

    /** Signal to allies: a mark on the map and minimap + a sound (event 'flare'). */
    flare(wx, wy) {
        const w = this.world;
        this.flares.push([wx, wy, w.time, 0]);
        w.emit('flare', wx, wy, 0, null);
    }

    // ============================================================ army buttons
    army_selection(units) {
        return units.some(u => this.is_military(u) && u.d['atk'] > 0) ||
            (units.length > 0 && units.every(u => u.cls === 'monk'));
    }

    /** The DE grid for the army: Q patrol · W guard · E follow · R attack-move · T attack ground /
     *  A S D F - stances · G stop / Z X C V - formations · B - special (pack, unload). */
    army_buttons(units, extra) {
        const slots = new Map();
        const mil = units.filter(u => u.cls !== 'vil');
        const st = this.common(mil, 'stance', 'aggressive');
        const T = i18n.t;
        for (const [i, name] of ORDER_SLOTS) {
            if (name === 'aground' && !units.some(u => orders.can_attack_ground(u))) continue;
            slots.set(i, { icon: ['ctl', name + (this.order_mode === name ? '*' : '')], act: ['omode', name],
                ok: true, tip: [T('ctl.' + name), {}, T('ctl.' + name + '.desc')] });
        }
        for (const [i, name] of STANCE_SLOTS) {
            slots.set(i, { icon: ['ctl', name + (st === name ? '*' : '')], act: ['stance', name], ok: true,
                tip: [T('ctl.' + name), {}, T('ctl.' + name + '.desc')] });
        }
        slots.set(STOP_SLOT, { icon: ['stop', null], act: ['stop', null], ok: true, tip: [T('hud.stop'), {}, T('hud.stop_desc')] });
        if (units.length > 1) {
            const fm = this.formation_of(units);
            for (const [i, name] of FORM_SLOTS) {
                slots.set(i, { icon: ['ctl', name + (fm === name ? '*' : '')], act: ['form', name], ok: true,
                    tip: [T('ctl.' + name), {}, T('ctl.' + name + '.desc')] });
            }
        }
        const free = SPARE_SLOTS.filter(s => !slots.has(s));
        for (const [it, s] of py.zip(extra, free)) slots.set(s, it);
        const out = [];
        for (const s of Array.from(slots.keys()).sort((a, b) => a - b)) {
            out.push({ ...slots.get(s), rect: this.grid_rect(s), key: HOTKEYS[s] });     // hud.py: the DE grid
        }
        return out;
    }

    static common(units, attr, default_) {
        const vals = new Set(units.map(u => py.getattr(u, attr, default_)));
        return vals.size === 1 ? vals.values().next().value : null;
    }

    /** Army buttons. true - handled. */
    army_press(act) {
        const units = this.own_units();
        const k = act[0];
        if (k === 'stop') {
            for (const u of units) {
                orders.clear(u);
                u.stop();
            }
            return true;
        }
        if (k === 'stance') {
            orders.set_stance(units.filter(u => u.cls !== 'vil'), act[1]);
            return true;
        }
        if (k === 'form') {
            for (const u of units) u.formation = act[1];
            return true;
        }
        if (k === 'omode') {
            this.start_order(act[1]);
            return true;
        }
        if (k === 'pack') {
            for (const u of units) {
                if (py.get(u.d, 'pack', null)) {
                    orders.clear(u);
                    u.stop();
                    u.start_pack(this.world, act[1]);
                }
            }
            return true;
        }
        return false;
    }

    // ============================================================ RMB: repair
    /** Monks: right-click on a relic - one goes to pick it up; right-click on your own monastery - carriers drop off relics.
     *  true - the order was given. */
    relic_command(units, target, wx, wy) {
        const w = this.world;
        const monks = units.filter(u => py.get(u.d, 'monk', null));
        if (!monks.length) return false;
        if (py.getattr(target, 'is_relic', false)) {
            const free = monks.filter(u => u.relic == null);
            if (!free.length || !target.free) return false;
            const u = py.min(free, m => Math.abs(m.x - target.x) + Math.abs(m.y - target.y));
            this.o(u, ['relic', target]);
            this.group_move(units.filter(m => m !== u), wx, wy);
            this.markers.push([wx, wy, [255, 230, 120], w.time]);
            w.emit('command', wx, wy, 0, 'work');
            return true;
        }
        if (target instanceof Building && target.kind === 'monastery' && target.owner === 0 && target.complete) {
            const carry = monks.filter(u => u.relic != null);
            if (!carry.length) return false;
            for (const u of carry) this.o(u, ['relic_in', target]);
            this.group_move(units.filter(m => !carry.includes(m)), wx, wy);
            this.markers.push([wx, wy, [255, 230, 120], w.time]);
            w.emit('command', wx, wy, 0, 'work');
            return true;
        }
        return false;
    }

    /** Villagers -> their own damaged building / siege / ship: repair; the rest - as usual. true - given. */
    repair_command(units, target, wx, wy) {
        const w = this.world;
        const vils = units.filter(u => u.kind === 'villager');
        if (!vils.length || !orders.repairable(vils[0], target)) return false;
        for (const u of vils) this.o(u, ['repair', target]);
        const rest = units.filter(u => u.kind !== 'villager');
        if (rest.length && !(target instanceof Building && this.garrison_command(rest, target, wx, wy))) this.group_move(rest, wx, wy);
        this.markers.push([wx, wy, [120, 255, 120], w.time]);
        w.emit('command', wx, wy, 0, 'work');
        return true;
    }
}
py.classattrs(ControlsUI, {
    order_mode: null,       // 'patrol' | 'guard' | 'follow' | 'amove' | 'aground' | 'flare' - waiting for a left click
    order_pts: [],
    cam_prev: null,
    _queue: false,
    _line_root: null,       // read/written only as ControlsUI._line_root (mutated through the class)
    idle_mil_idx: 0,
    tc_idx: 0,
    last_event: null,
});
py.statics(ControlsUI, 'common');

/** Height of the figure above the feet (for icons above a unit) - from the current frame's bounding box. */
export function unit_top_px(g, u) {
    if (py.hasattr(g, 'unit_top')) return g.unit_top(u, 9);
    return py.get(u.d, 'bar', null) || py.get(u.d, 'bar_h', null) || (u.cls === 'cav' ? 36 : 30);
}
