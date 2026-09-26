// port of game/defense_ui.py
/* Defense interface (a mixin of ui.Game): wall dragging, gates, garrison, town bell, icons.

   ui.py calls the hooks from here with a single line; logic - game/defense.py, wall graphics - game/wallgfx.py. */
import * as py from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import * as i18n from './i18n.js';
import { TILE, HW, HH, BUILDINGS, RES, shade } from './data.js';
import { Unit, Building } from './world.js';
import * as defense from './defense.js';
import * as wallgfx from './wallgfx.js';
import * as sprites3d from './sprites3d.js';


export class DefenseUI {
    // ---- sprites
    /** The default wall/gate sprite (for bsprite: icons, menus). */
    wall_sprite(kind, owner) {
        return wallgfx.kind_sprite(kind, this.pcolor(owner), this.civ_of(owner));
    }

    /** (surface, ox, oy, bbox) for a specific building: walls - taking neighbors into account, gates - whether open. */
    bsprite_for(b) {
        if (!py.bool(py.get(b.d, 'wall', null))) {
            let look = py.getattr(b, '_look', null);
            if (look == null) {
                look = b._look = this.blook(b.kind, b.owner, b.tx, b.ty);
            }
            return this.bsprite(b.kind, b.owner, null, ...look);
        }
        const col = this.pcolor(b.owner);
        let spr, ox, oy;
        if (py.bool(py.get(b.d, 'gate', null))) {
            [spr, ox, oy] = wallgfx.gate_sprite(b.kind, col, b.w >= b.h, defense.gate_open(this.world, b),
                this.civ_of(b.owner));
        } else {
            [spr, ox, oy] = wallgfx.piece_sprite(b.kind, col, defense.wall_mask(this.world, b), this.civ_of(b.owner));
        }
        let bb = this._bbox.get(spr);
        if (bb == null) {
            bb = spr.get_bounding_rect();
            this._bbox.set(spr, bb);
        }
        return [spr, ox, oy, bb];
    }

    /** A wall/gate under construction: a 0 A.D. foundation under each tile, a growing segment, scaffolding on top.
     *  False - no pre-rendered sprites (the procedural fallback draws it). */
    draw_wall_build(b, sx, sy, spr, ox, oy, bb) {
        const civ = this.civ_of(b.owner);
        const fn = sprites3d.wall_build(b.kind, civ, 'fndn');
        const sc = sprites3d.wall_build(b.kind, civ, 'scaf');
        if (fn == null || sc == null) return false;
        const scr = this.screen;
        const cells = [];
        for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) cells.push([b.tx + i, b.ty + j]);
        for (const [cx, cy] of cells) {
            const [px, py_] = this.w2s(cx * TILE, cy * TILE);
            scr.blit(fn[0], [px - fn[1], py_ - fn[2]]);
        }
        const h = spr.get_height();
        const vis_h = Math.trunc((h - bb.top) * (0.05 + 0.95 * b.progress));
        if (vis_h > 0 && b.progress > 0.05) {
            const part = spr.subsurface([0, h - vis_h, spr.get_width(), vis_h]);
            scr.blit(part, [sx - ox, sy - oy + h - vis_h]);
        }
        if (b.progress > 0.12) {
            const [s_img, sox, soy] = sc;
            const sh = s_img.get_height();
            const sv = Math.trunc(sh * Math.min(1.0, 0.35 + b.progress));
            const sub = s_img.subsurface([0, sh - sv, s_img.get_width(), sv]);
            for (const [cx, cy] of cells) {
                const [px, py_] = this.w2s(cx * TILE, cy * TILE);
                scr.blit(sub, [px - sox, py_ - soy + sh - sv]);
            }
        }
        this.drawn.push([new pygame.Rect(sx - ox, sy - oy, ...spr.get_size()), b, spr]);
        const pts = this.diamond(b.tx, b.ty, b.w, b.h);
        this.hpbar(sx - 30, pts[2][1] - 8, 60, b.progress, 0);
        return true;
    }

    ghost_of(spr) {
        let g = this._ghost.get(spr);
        if (g == null) {
            g = spr.copy();
            this._ghost.set(spr, g);
            g.set_alpha(150);
        }
        return g;
    }

    // ---- placement
    /** Left click while placing. True - handled (walls: the start of a drag; gates: lay it). */
    place_down(pos) {
        const kind = this.placing;
        const d = BUILDINGS[kind];
        if (py.bool(py.get(d, 'line', null))) {
            this.line_start = this.place_tile(pos);
            return true;
        }
        if (py.bool(py.get(d, 'gate', null))) {
            this.try_place_gate(pos);
            return true;
        }
        return false;
    }

    /** Left button released after a drag - lay the wall line. */
    place_up(pos) {
        const start = this.line_start;
        this.line_start = null;
        const kind = this.placing;
        if (kind == null || start == null) return;
        const w = this.world;
        const end = this.place_tile(pos);
        const vils = this.selected.filter(u => u instanceof Unit && u.kind === 'villager' && u.owner === 0);
        const placed = defense.place_wall_line(w, kind, 0, start[0], start[1], end[0], end[1], vils);
        if (!py.bool(placed) && !py.bool(defense.wall_plan(w, kind, 0, defense.line_tiles(...start, ...end)))) {
            w.msg(i18n.t('msg.cannot_build_here'), [255, 150, 90]);
        }
        const p = w.players[0];
        if (!(this.mods() & pygame.KMOD_SHIFT) || !p.afford(p.cost_of('bld', kind))) {
            this.placing = null;
        }
    }

    gate_at(pos) {
        const kind = this.placing;
        const [wx, wy] = this.s2w(...pos);
        const span = defense.gate_span(kind);
        let res = null;
        for (const horiz of [this.gate_horiz, !this.gate_horiz]) {
            let tx, ty;
            if (horiz) {
                tx = Math.trunc(py.round(wx / TILE - span / 2)); ty = Math.trunc(py.floordiv(wy, TILE));
            } else {
                tx = Math.trunc(py.floordiv(wx, TILE)); ty = Math.trunc(py.round(wy / TILE - span / 2));
            }
            if (res == null) res = [tx, ty, horiz];
            const [x0, y0, gw, gh] = defense.gate_rect(tx, ty, horiz, span);
            const W = this.world;
            let walls = 0;
            for (let y = y0; y < y0 + gh; y++) {
                for (let x = x0; x < x0 + gw; x++) {
                    if (0 <= x && x < W.W && 0 <= y && y < W.H
                        && defense.is_wall(W.occ[y][x]) && W.occ[y][x].owner === 0) walls += 1;
                }
            }
            if (walls >= 2) return [tx, ty, horiz];
        }
        return res;
    }

    try_place_gate(pos) {
        const w = this.world;
        const p = w.players[0];
        const kind = this.placing;
        const [tx, ty, horiz] = this.gate_at(pos);
        if (!defense.can_place_gate(w, kind, tx, ty, horiz, 0)) {
            w.msg(i18n.t('msg.cannot_build_here'), [255, 150, 90]);
            return;
        }
        const vils = this.selected.filter(u => u instanceof Unit && u.kind === 'villager' && u.owner === 0);
        if (defense.place_gate(w, kind, 0, tx, ty, horiz, vils) == null) {
            w.msg(i18n.t('msg.not_enough_resources'), [255, 150, 90]);
            this.placing = null;
            return;
        }
        if (!(this.mods() & pygame.KMOD_SHIFT) || !p.afford(p.cost_of('bld', kind))) {
            this.placing = null;
        }
    }

    defense_key(k) {
        if (k === pygame.K_TAB && this.placing && py.bool(py.get(BUILDINGS[this.placing], 'gate', null))) {
            this.gate_horiz = !this.gate_horiz;
            return true;
        }
        if (k === pygame.K_ESCAPE) this.line_start = null;
        return false;
    }

    /** The ghost of a wall drag / gate. True - drawn here. */
    draw_defense_ghost(mp) {
        const kind = this.placing;
        const d = BUILDINGS[kind];
        if (!(py.bool(py.get(d, 'line', null)) || py.bool(py.get(d, 'gate', null)))) return false;
        const scr = this.screen;
        const w = this.world;
        const col = this.pcolor(0);
        if (py.bool(py.get(d, 'gate', null))) {
            const [tx, ty, horiz] = this.gate_at(mp);
            const ok = defense.can_place_gate(w, kind, tx, ty, horiz, 0);
            const [x0, y0, gw, gh] = defense.gate_rect(tx, ty, horiz, defense.gate_span(kind));
            const marks = [];
            for (let y = y0; y < y0 + gh; y++) for (let x = x0; x < x0 + gw; x++) marks.push([x, y, ok]);
            this.tile_marks(marks);
            const [spr, ox, oy] = wallgfx.gate_sprite(kind, col, horiz, false, this.civ_of(0));
            const [sx, sy] = this.w2s(x0 * TILE, y0 * TILE);
            scr.blit(this.ghost_of(spr), [sx - ox, sy - oy]);
            return true;
        }
        const cur = this.place_tile(mp);
        const tiles = defense.line_tiles(...(this.line_start || cur), ...cur);
        const tset = new py.TSet(tiles);
        const marks = [];
        let n = 0;
        for (const [x, y] of tiles) {
            const ok = w.can_place(kind, x, y, 0);
            marks.push([x, y, ok]);
            n += ok ? 1 : 0;
        }
        this.tile_marks(marks);
        for (const [x, y, ok] of py.sorted(marks, m => m[0] + m[1])) {
            if (!ok) continue;
            const m = defense.mask_at(w, x, y, 0, tset);
            const [spr, ox, oy] = wallgfx.piece_sprite(kind, col, m, this.civ_of(0));
            const [sx, sy] = this.w2s(x * TILE, y * TILE);
            scr.blit(this.ghost_of(spr), [sx - ox, sy - oy]);
        }
        // cost of the line at the cursor
        const p = w.players[0];
        const cost = p.cost_of('bld', kind);
        let cx = mp[0] + 18;
        const cy = mp[1] + 14;
        for (const r of RES) {
            if (py.get(cost, r, null)) {
                const tot = cost[r] * n;
                this.res_icon(r, cx + 7, cy);
                const img = this.text(`${tot}`, [cx + 17, cy], 'b', p.res[r] >= tot ? [240, 235, 220] : [255, 110, 90],
                    'midleft');
                cx = img.right + 10;
            }
        }
        return true;
    }

    tile_marks(marks) {
        let ov = null;
        for (const [x, y, ok] of marks) {
            const pts = this.diamond(x, y, 1, 1);
            const minx = Math.min(...pts.map(q => q[0]));
            const miny = Math.min(...pts.map(q => q[1]));
            if (ov == null) ov = new Map();
            const okk = !!ok;
            let s = ov.get(okk);
            if (s == null) {
                s = new pygame.Surface([2 * HW + 2, 2 * HH + 2], pygame.SRCALPHA);
                ov.set(okk, s);
                pygame.draw.polygon(s, ok ? [60, 255, 60, 70] : [255, 50, 50, 100],
                    pts.map(q => [q[0] - minx, q[1] - miny]));
            }
            this.screen.blit(s, [minx, miny]);
        }
    }

    // ---- buttons
    defense_buttons(b) {
        const w = this.world;
        const p = w.players[0];
        const items = [];
        if (b.kind === 'town_center') {
            if (py.getattr(p, 'bell', false)) {
                items.push({
                    icon: ['x', 'clear'], act: ['clear'], ok: true,
                    tip: [i18n.t('def.all_clear'), {}, i18n.t('def.all_clear_desc')],
                });
            } else {
                items.push({
                    icon: ['x', 'bell'], act: ['bell'], ok: true,
                    tip: [i18n.t('def.bell'), {}, i18n.t('def.bell_desc')],
                });
            }
        }
        if (b.garrison.length) {
            items.push({
                icon: ['x', 'eject'], act: ['eject', b], ok: true,
                tip: [i18n.t('def.eject'), {}, i18n.t('def.inside', { n: b.garrison.length })],
            });
        }
        return items;
    }

    defense_press(act) {
        const w = this.world;
        if (act[0] === 'bell') {
            defense.ring_bell(w, 0);
        } else if (act[0] === 'clear') {
            defense.all_clear(w, 0);
        } else if (act[0] === 'eject') {
            defense.eject(w, act[1]);
        } else {
            return false;
        }
        return true;
    }

    draw_x_icon(ic, name, size) {
        const c = py.floordiv(size, 2);
        const s = size / 40;
        const gold = [236, 196, 70];
        if (name === 'bell' || name === 'clear') {
            const pts = [[c - 11 * s, c + 8 * s], [c - 8 * s, c + 3 * s], [c - 7 * s, c - 7 * s], [c, c - 12 * s],
                [c + 7 * s, c - 7 * s], [c + 8 * s, c + 3 * s], [c + 11 * s, c + 8 * s]];
            pygame.draw.polygon(ic, gold, pts);
            pygame.draw.polygon(ic, shade(gold, -90), pts, 2);
            pygame.draw.circle(ic, shade(gold, -70), [c, Math.trunc(c + 11 * s)], Math.max(2, Math.trunc(3 * s)));
            pygame.draw.line(ic, [255, 245, 200], [c - 3 * s, c - 6 * s], [c - 4 * s, c + 3 * s], 2);
            if (name === 'clear') {
                pygame.draw.lines(ic, [90, 230, 90], false, [[c + 2 * s, c + 8 * s], [c + 8 * s, c + 14 * s],
                    [c + 17 * s, c + 1 * s]], Math.max(3, Math.trunc(4 * s)));
            } else {
                for (const k of [-1, 1]) {
                    pygame.draw.arc(ic, [255, 120, 90], [c + k * 14 * s - 4 * s, c - 10 * s, 8 * s, 16 * s],
                        k > 0 ? -1.2 : 1.9, k > 0 ? 1.2 : 4.3, 2);
                }
            }
        } else if (name === 'eject') {
            const wall = [170, 164, 150];
            pygame.draw.rect(ic, wall, [c - 15 * s, c - 13 * s, 16 * s, 26 * s]);
            pygame.draw.rect(ic, [70, 48, 30], [c - 11 * s, c - 5 * s, 9 * s, 18 * s]);
            pygame.draw.polygon(ic, [120, 230, 120], [[c + 2 * s, c - 3 * s], [c + 10 * s, c - 3 * s],
                [c + 10 * s, c - 9 * s], [c + 18 * s, c + 1 * s],
                [c + 10 * s, c + 11 * s], [c + 10 * s, c + 5 * s],
                [c + 2 * s, c + 5 * s]]);
        } else if (name === 'shield') {
            const pts = [[c - 12 * s, c - 12 * s], [c + 12 * s, c - 12 * s], [c + 12 * s, c + 1 * s], [c, c + 14 * s],
                [c - 12 * s, c + 1 * s]];
            pygame.draw.polygon(ic, [120, 150, 200], pts);
            pygame.draw.polygon(ic, [40, 50, 80], pts, 2);
        }
    }

    // ---- the "garrison" order
    /** Right click on your own building with a garrison. DE: a villager carrying a load takes it to the storage (inside - with Alt),
     *  a villager with empty hands goes inside even without Alt. True - the order was given. */
    garrison_command(units, target, wx, wy) {
        const w = this.world;
        if (!(target instanceof Building) || target.owner !== 0 || defense.capacity(target) <= 0) return false;
        const alt = this.mods() & pygame.KMOD_ALT;
        const vils = units.filter(u => u.kind === 'villager');
        if (py.bool(py.get(target.d, 'drop', null)) && vils.length && !alt && vils.some(u => u.carry > 0)) return false;
        const allowed = py.get(target.d, 'garrison_cls', ['vil', 'inf', 'arch']);
        const cands = units.filter(u => py.contains(allowed, u.cls));
        if (!cands.length) return false;
        const room = defense.capacity(target) - target.garrison.length;
        if (room <= 0) {
            w.msg(i18n.t('msg.no_room'), [255, 150, 90]);
            return true;
        }
        py.sort(cands, u => u.dist_to(target));
        const chosen = cands.slice(0, room);
        for (const u of chosen) this.o(u, ['garrison', target]);
        const rest = units.filter(u => !chosen.includes(u));
        this.group_move(rest, wx, wy);
        this.markers.push([wx, wy, [120, 170, 255], w.time]);
        w.emit('command', wx, wy, 0, 'garrison');
        return true;
    }

    // ---- garrison on screen and in the panel
    draw_garrison_badge(b, sx, top) {
        const n = b.garrison.length;
        const x = Math.trunc(sx), y = Math.trunc(top) - 18;
        const pts = [[x - 9, y - 9], [x + 9, y - 9], [x + 9, y + 1], [x, y + 9], [x - 9, y + 1]];
        pygame.draw.polygon(this.screen, [40, 36, 30], pts.map(([px, py_]) => [px + 1, py_ + 1]));
        pygame.draw.polygon(this.screen, this.pcolor(b.owner), pts);
        pygame.draw.polygon(this.screen, [240, 235, 220], pts, 1);
        this.text(String(n), [x, y - 1], 's', [255, 255, 255], 'center');
    }

    draw_garrison_info(b, x, y) {
        const cap = defense.capacity(b);
        if (cap <= 0) return;
        let ic = this.icon('x', 'shield', 0, 26);
        this.screen.blit(ic, [x, y]);
        this.text(`${b.garrison.length}/${cap}`, [x + 30, y + 13], 'b', undefined, 'midleft');
        const arrows = defense.bonus_arrows(b);
        if (py.bool(py.get(b.d, 'atk', null)) && arrows) {
            this.text(`+${arrows}`, [x + 84, y + 13], 'b', [255, 220, 130], 'midleft');
            this.stat(x + 108, y + 13, 'rng', '');
        }
        b.garrison.slice(0, 20).forEach((u, i) => {
            const r = new pygame.Rect(x + (i % 10) * 30, y + 30 + Math.floor(i / 10) * 32, 28, 28);
            pygame.draw.rect(this.screen, [70, 60, 48], r, 0, 4);
            ic = this.icon('u', u.kind, u.owner, 26);
            this.screen.blit(ic, ic.get_rect({ center: r.center }));
            this.hpbar(r.x + 2, r.bottom - 3, 24, u.hp / u.max_hp, u.owner);
            if (b.owner === 0) this.panel_hits.push([r, ['ungarrison', b, u]]);
        });
    }
}
py.classattrs(DefenseUI, {
    line_start: null,       // the tile where the wall drag started
    gate_horiz: true,       // preferred gate orientation (Tab - rotate)
    _bbox: new Map(),       // Python: {id(sprite): bbox} shared by the class -> Map keyed by the sprite
    _ghost: new Map(),
});
