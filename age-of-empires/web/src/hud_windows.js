// port of game/hud_windows.py
/* Windows over the game via the round buttons of the top panel (AoE2 DE): objectives, chat, diplomacy, tech tree;
   as well as the player score (F4 above the minimap, the objectives window) and the message history (PgUp).

   Windows do not pause the game (as in DE). The layout is procedural, with minimal text. */
import * as py from '../runtime/py.js';
import { random, modules } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import {
    SCREEN_W, TOP_H, UNITS, TECHS, BUILDINGS, CIVS, AGE_NAMES, AGE_TECHS, BUILD_MENU, RES_NAME,
    shade,
} from './data.js';
import * as civ_ui from './civ_ui.js';
import * as i18n from './i18n.js';
import * as mk from './market.js';
import * as scoring from './scoring.js';
import * as S from './uiskin.js';

export const BOXES = {
    'objectives': new pygame.Rect(py.floordiv(SCREEN_W, 2) - 360, 80, 720, 470),
    'chat': new pygame.Rect(py.floordiv(SCREEN_W, 2) - 290, 380, 580, 236),
    'diplomacy': new pygame.Rect(py.floordiv(SCREEN_W, 2) - 420, 80, 840, 300),
    'techtree': new pygame.Rect(20, TOP_H + 16, SCREEN_W - 40, 552),
};
// window headings and captions are locale keys (win.*), see assets/locale/en.json
export const TITLES = {
    'objectives': ['hud.objectives', 'victory'], 'chat': ['hud.chat', null],
    'diplomacy': ['hud.diplomacy', 'diplomacy'], 'techtree': ['hud.techtree', 'upgrade'],
};
export const SCORE_COLS = [['mil', 'score.military', [200, 60, 50]], ['eco', 'score.economy', [230, 185, 50]],
    ['tech', 'score.technology', [70, 130, 220]], ['soc', 'score.society', [150, 90, 190]]];
// own short phrases (number -> key), like DE's "taunts" by number
export const TAUNTS = Object.fromEntries(py.range(1, 15).map(i => [String(i), `taunt.${i}`]));
export const ALLY_REPLY = py.range(1, 6).map(i => `reply.ally.${i}`);
export const ENEMY_REPLY = py.range(1, 4).map(i => `reply.enemy.${i}`);
export const FLARE_REPLY = py.range(1, 4).map(i => `reply.flare.${i}`);
// tech tree rows: buildings in DE order (military, then economy)
export const TT_ROWS = ['barracks', 'archery_range', 'stable', 'siege_workshop', 'castle', 'dock', 'monastery', 'blacksmith',
    'university', 'town_center', 'market', 'mill', 'lumber_camp', 'mining_camp'];
export const TT_ICON = 24;

// Python len()/slicing count code points; JS strings count UTF-16 units
function _cp(s) { return Array.from(s); }


export function box(name) {
    return BOXES[name];
}


// ============================================================ score
export function _short(sc) {
    return {
        'mil': sc['military'], 'eco': sc['economy'], 'tech': sc['technology'], 'soc': sc['society'],
        'total': sc['total'],
    };
}


/** The AoE2-style score - one formula for F4, the objectives window and the achievements screen (game/scoring.py). */
export function score_of(w, p) {
    return _short(scoring.score(w, p.id));
}


/** The score of all players, recomputed once per game second. Returns a Map {player id: score}. */
export function scores(game) {
    const w = game.world;
    let [t, cache] = game._score;
    if (w.time - t >= 1.0 || py.len(cache) !== w.players.length) {
        const all = scoring.scores(w);
        cache = new Map(py.zip(w.players, all).map(([p, sc]) => [p.id, _short(sc)]));
        game._score = [w.time, cache];
    }
    return cache;
}


// ============================================================ drawing
export function frame(game, name) {
    const scr = game.screen;
    const b = BOXES[name];
    S.panel(scr, b, 'stone', undefined, undefined, true);
    const [title, ic] = TITLES[name];
    game.title_bar(b, i18n.t(title), ic);
    const close = close_rect(name);
    const h = close.collidepoint(pygame.mouse.get_pos());
    S.slot(scr, close, h ? 'hover' : 'normal');
    for (const d of [1, -1]) {
        pygame.draw.line(scr, [230, 90, 70], [close.x + 7, close.centery - 6 * d], [close.right - 7, close.centery + 6 * d], 3);
    }
}


export function close_rect(name) {
    const b = BOXES[name];
    return new pygame.Rect(b.right - 40, b.y + 14, 28, 28);
}


export function draw(game, name) {
    frame(game, name);
    ({
        'objectives': draw_objectives, 'chat': draw_chat, 'diplomacy': draw_diplomacy,
        'techtree': draw_techtree,
    })[name](game);
}


export function click(game, name, pos) {
    if (close_rect(name).collidepoint(pos)) {
        game.window = null;
        return;
    }
    const fn = py.get({ 'chat': click_chat, 'diplomacy': click_diplomacy, 'techtree': click_techtree }, name, null);
    if (fn) fn(game, pos);
}


// ---- objectives
export function draw_objectives(game) {
    const scr = game.screen;
    const w = game.world;
    const b = BOXES['objectives'];
    const p = w.players[0];
    const x0 = b.x + 30;
    let y = b.y + 64;
    // victory condition
    const row = new pygame.Rect(x0, y, b.w - 60, 40);
    S.panel(scr, row, 'parchment', false);
    const cb = new pygame.Rect(row.x + 10, row.centery - 10, 20, 20);
    pygame.draw.rect(scr, [60, 40, 20], cb, 2);
    if (w.winner != null && w.human_won()) {
        pygame.draw.lines(scr, [40, 120, 40], false, [[cb.x + 4, cb.centery], [cb.centerx - 1, cb.bottom - 4],
            [cb.right - 3, cb.y + 3]], 3);
    }
    S.blit_icon(scr, 'victory', [cb.right + 20, row.centery], 26);
    S.text_fit(scr, i18n.t('win.conquest_goal'), [cb.right + 40, row.centery], game.fonts['b'],
        S.INK, 'midleft', null, row.right - cb.right - 120);
    const t = Math.trunc(w.time);
    S.text(scr, `${py.floordiv(t, 3600)}:${py.fmt(py.mod(py.floordiv(t, 60), 60), '02d')}:${py.fmt(py.mod(t, 60), '02d')}`,
        [row.right - 12, row.centery], game.fonts['b'], S.INK, 'midright', null);
    // players: the score as a bar of 4 parts
    const sc = scores(game);
    const top = Math.max(1, Math.max(...[...sc.values()].map(s => s['total'])));
    y += 58;
    const lx = x0 + 250;
    SCORE_COLS.forEach(([key, lbl, col], i) => {
        pygame.draw.rect(scr, col, [lx + i * 105, y, 12, 12]);
        game.text(i18n.t(lbl), [lx + i * 105 + 17, y + 6], 's', S.TEXT_DIM, 'midleft');
    });
    y += 24;
    for (const q of py.sorted(w.players, q => [q.team, q.id])) {
        const s = sc.get(q.id);
        const r = new pygame.Rect(x0, y, b.w - 60, 38);
        S.shade_overlay(scr, r, undefined, 70);
        pygame.draw.rect(scr, q.color, [r.x, r.y, 6, r.h]);
        civ_ui.blit_emblem(game, q.civ, [r.x + 12, r.y + 3, 26, 32]);
        game.text(q.name, [r.x + 46, r.y + 4], 'b', q.alive ? shade(q.color, 60) : [140, 130, 120]);
        game.text(`${civ_ui.civ_name(q.civ)} · ` + i18n.t('win.team_n', { n: q.team + 1 }), [r.x + 46, r.y + 21], 's',
            S.TEXT_DIM);
        game.age_shield(r.x + 228, r.centery, q.age, 30, shade(q.color, -50));
        const bx = lx, bw = r.right - lx - 70;
        let xx = bx;
        for (const [key, , col] of SCORE_COLS) {
            const ww = Math.trunc(bw * s[key] / top);
            if (ww) {
                pygame.draw.rect(scr, col, [xx, r.y + 11, ww, 16]);
                xx += ww;
            }
        }
        pygame.draw.rect(scr, [90, 74, 50], [bx, r.y + 10, bw, 18], 1);
        game.text(String(s['total']), [r.right - 8, r.centery], 'b', undefined, 'midright');
        if (!q.alive) {
            pygame.draw.line(scr, [230, 90, 70], [r.x + 8, r.centery], [r.right - 8, r.centery], 2);
        }
        y += 44;
    }
    // own totals: gathered, killed, units, buildings
    y = b.bottom - 62;
    const stats = [['economics', Math.trunc(py.sum(Object.values(p.gathered)))], ['kill', p.kills],
        ['training', w.units.filter(u => u.owner === 0).length],
        ['construction', w.buildings.filter(bb => bb.owner === 0 && bb.complete).length]];
    const tw = py.floordiv(b.w - 60, stats.length);
    stats.forEach(([ic, v], i) => {
        const r = new pygame.Rect(x0 + i * tw, y, tw - 10, 40);
        S.slot(scr, r);
        S.blit_icon(scr, ic, [r.x + 22, r.centery], 28);
        game.text(String(v), [r.x + 44, r.centery], 'b', undefined, 'midleft');
    });
}


// ---- diplomacy
/** [(player, row rectangle, {relation: rect}, {resource: rect})]. */
export function dip_rows(game) {
    const w = game.world;
    const b = BOXES['diplomacy'];
    const out = [];
    let y = b.y + 96;
    for (const q of w.players.slice(1)) {
        const r = new pygame.Rect(b.x + 24, y, b.w - 48, 46);
        const st = {};
        ['ally', 'neutral', 'enemy'].forEach((k, i) => { st[k] = new pygame.Rect(r.x + 250 + i * 86, r.y + 9, 80, 28); });
        const tr = {};
        ['wood', 'food', 'gold', 'stone'].forEach((res, i) => { tr[res] = new pygame.Rect(r.x + 520 + i * 66, r.y + 7, 60, 32); });
        out.push([q, r, st, tr]);
        y += 54;
    }
    return out;
}


export function draw_diplomacy(game) {
    const scr = game.screen;
    const w = game.world;
    const b = BOXES['diplomacy'];
    const p = w.players[0];
    const mp = pygame.mouse.get_pos();
    // header: a "teams locked" padlock, tribute (fee %), the market
    const hy = b.y + 70;
    lock(scr, b.x + 290, hy);
    game.text(i18n.t('win.teams_locked'), [b.x + 304, hy], 's', S.TEXT_DIM, 'midleft');
    const has_market = mk.has_market(w, 0);
    const fee = Math.trunc(py.round(mk.tribute_fee(p) * 100));
    game.text(i18n.t('win.tribute_lot', { n: mk.LOT }) + (has_market ? ' · ' + i18n.t('win.fee', { n: fee }) : ''),
        [b.x + 544, hy], 's', S.TEXT_DIM, 'midleft');
    if (!has_market) {
        const ic = game.icon('b', 'market', 0, 24);
        scr.blit(ic, [b.right - 150, hy - 12]);
        game.text(i18n.t('win.need_market'), [b.right - 122, hy], 's', S.RED, 'midleft');
    }
    for (const [q, r, st, tr] of dip_rows(game)) {
        S.shade_overlay(scr, r, undefined, 70);
        pygame.draw.rect(scr, q.color, [r.x, r.y, 6, r.h]);
        civ_ui.blit_emblem(game, q.civ, [r.x + 12, r.y + 5, 30, 36]);
        game.text(q.name, [r.x + 50, r.y + 6], 'b', q.alive ? shade(q.color, 60) : [140, 130, 120]);
        game.text(civ_ui.civ_name(q.civ), [r.x + 50, r.y + 25], 's', S.TEXT_DIM);
        const rel = w.allied(0, q.id) ? 'ally' : (w.hostile(0, q.id) ? 'enemy' : 'neutral');
        for (const [k, rr] of Object.entries(st)) {
            const on = k === rel;
            S.button(scr, rr, on ? 'on' : 'disabled');
            const col = { 'ally': [150, 225, 130], 'neutral': [230, 220, 170], 'enemy': [255, 130, 110] }[k];
            S.text_fit(scr, i18n.t('rel.' + k), rr.center, game.fonts['bs'],
                on ? col : [150, 140, 120], 'center', undefined, rr.w - 6);
        }
        const can = has_market && q.alive && rel === 'ally';
        for (const [res, rr] of Object.entries(tr)) {
            const ok = can && p.res[res] >= mk.tribute_cost(p);
            S.slot(scr, rr, ok && rr.collidepoint(mp) ? 'hover' : 'normal');
            S.blit_icon(scr, res, [rr.x + 14, rr.centery], 22);
            game.text(`+${mk.LOT}`, [rr.x + 27, rr.centery], 's', ok ? [240, 235, 220] : [120, 110, 100],
                'midleft');
        }
        if (!q.alive) {
            pygame.draw.line(scr, [230, 90, 70], [r.x + 8, r.centery], [r.right - 8, r.centery], 2);
        }
    }
    for (const [q, r, st, tr] of dip_rows(game)) {
        for (const [res, rr] of Object.entries(tr)) {
            if (rr.collidepoint(mp)) {
                game.draw_tip([i18n.t('eco.tribute_to', { name: q.name }), { [res]: mk.tribute_cost(p) },
                    `+${mk.LOT} ${RES_NAME[res].toLowerCase()}`, ['dim', i18n.t('eco.shift_x5')]],
                undefined, undefined, [rr.x, rr.y - 4]);
            }
        }
    }
}


export function click_diplomacy(game, pos) {
    const w = game.world;
    const p = w.players[0];
    for (const [q, r, st, tr] of dip_rows(game)) {
        for (const [k, rr] of Object.entries(st)) {
            if (rr.collidepoint(pos)) {
                w.msg(i18n.t('win.teams_locked'), [230, 210, 160]);
                return;
            }
        }
        for (const [res, rr] of Object.entries(tr)) {
            if (rr.collidepoint(pos)) {
                game.audio.click();
                const n = (game.mods() & pygame.KMOD_SHIFT) ? 5 : 1;
                if (!mk.has_market(w, 0)) {
                    w.msg(i18n.t('win.tribute_needs_market'), [255, 150, 90]);
                } else if (!w.allied(0, q.id)) {
                    w.msg(i18n.t('win.tribute_allies_only'), [255, 150, 90]);
                } else {
                    let done = 0;
                    for (let i = 0; i < n; i++) if (mk.tribute(w, p, q.id, res)) done += 1;
                    if (!done) w.msg(i18n.t('msg.not_enough_resources'), [255, 150, 90]);
                }
                return;
            }
        }
    }
}


// ---- chat
export function chat_rects() {
    const b = BOXES['chat'];
    return {
        'all': new pygame.Rect(b.x + 20, b.bottom - 46, 110, 30), 'allies': new pygame.Rect(b.x + 136, b.bottom - 46, 110, 30),
        'input': new pygame.Rect(b.x + 254, b.bottom - 46, b.w - 274, 30),
    };
}


export function draw_chat(game) {
    const scr = game.screen;
    const b = BOXES['chat'];
    const log = new pygame.Rect(b.x + 20, b.y + 58, b.w - 40, b.h - 112);
    S.shade_overlay(scr, log, undefined, 120);
    let y = log.bottom - 4;
    for (const [txt, col] of game.chat_log.slice(-7).reverse()) {
        const r = game.text(txt, [log.x + 8, y], 'm', col, 'bottomleft');
        y = r.y - 1;
        if (y < log.y + 16) break;
    }
    if (!game.chat_log.length) {
        game.text(i18n.t('win.chat_hint'), [log.centerx, log.centery], 's', S.TEXT_DIM, 'center');
    }
    const rs = chat_rects();
    for (const [k, lbl] of [['all', 'win.chat_all'], ['allies', 'win.chat_allies']]) {
        S.button(scr, rs[k], game.chat_to === k ? 'on' : 'normal');
        S.text_fit(scr, i18n.t(lbl), rs[k].center, game.fonts['bs'], [255, 236, 190], 'center', undefined,
            rs[k].w - 8);
    }
    const inp = rs['input'];
    pygame.draw.rect(scr, [16, 12, 8], inp);
    pygame.draw.rect(scr, S.GOLD_DK, inp, 1);
    const caret = py.mod(py.floordiv(pygame.time.get_ticks(), 500), 2) ? '|' : '';
    const img = game.fonts['m'].render(game.chat_text + caret, true, [250, 245, 230]);
    scr.blit(img, [inp.x + 8, inp.centery - py.floordiv(img.get_height(), 2)], [Math.max(0, img.get_width() - inp.w + 16), 0,
        inp.w - 16, img.get_height()]);
}


export function click_chat(game, pos) {
    const rs = chat_rects();
    for (const k of ['all', 'allies']) {
        if (rs[k].collidepoint(pos)) {
            game.audio.click();
            game.chat_to = k;
        }
    }
}


export function chat_key(game, e) {
    const k = e.key;
    if (k === pygame.K_ESCAPE) {
        game.window = null;
        game.chat_text = '';
    } else if (k === pygame.K_RETURN || k === pygame.K_KP_ENTER) {
        send_chat(game, py.strip(game.chat_text));
        game.chat_text = '';
        game.window = null;
    } else if (k === pygame.K_BACKSPACE) {
        game.chat_text = _cp(game.chat_text).slice(0, -1).join('');
    } else if (k === pygame.K_TAB) {
        game.chat_to = game.chat_to === 'all' ? 'allies' : 'all';
    } else {
        const ch = py.getattr(e, 'unicode', '');
        if (ch && py.isprintable(ch) && _cp(game.chat_text).length < 80) {
            game.chat_text += ch;
        }
    }
    return true;
}


/** A message from a player: into the log and onto the screen; computer players answer with canned phrases. */
export function send_chat(game, text) {
    if (!text) return;
    const w = game.world;
    const p = w.players[0];
    const shown = Object.hasOwn(TAUNTS, text) ? i18n.t(TAUNTS[text]) : text;
    const to = game.chat_to === 'all' ? '' : i18n.t('win.chat_to_allies') + ' ';
    const col = shade(p.color, 70);
    game.chat_log.push([`${to}${p.name}: ${shown}`, col]);
    w.msg(`${to}${p.name}: ${shown}`, col);
    const now = pygame.time.get_ticks();
    let delay = 1200;
    const n = _cp(text).length;
    for (const q of w.players.slice(1)) {
        if (!q.alive || !q.is_ai) continue;
        const ally = w.allied(0, q.id);
        if (game.chat_to === 'allies' && !ally) continue;
        let ans;
        if (ally) {
            ans = i18n.t(ALLY_REPLY[py.mod(n + q.id, ALLY_REPLY.length)]);
        } else if (random.random() < 0.5) {
            ans = i18n.t(ENEMY_REPLY[py.mod(n + q.id, ENEMY_REPLY.length)]);
        } else {
            continue;
        }
        game.chat_replies.push([now + delay, `${q.name}: ${ans}`, shade(q.color, 60)]);
        delay += 700;
    }
}


// ---- message history (PgUp)
export function draw_history(game) {
    const log = game.chat_log.slice(-14);
    const msgs = game.world.messages.map(([t, , c]) => [t, c]);
    const lines = [...log, ...msgs.filter(m => !py.contains(log, m))].slice(-16);
    if (!lines.length) return;
    const r = new pygame.Rect(8, TOP_H + 44, 520, 20 * lines.length + 12);
    S.shade_overlay(game.screen, r, undefined, 150);
    lines.forEach(([t, c], i) => {
        game.text(t, [r.x + 8, r.y + 6 + i * 20], 'm', c);
    });
}


// ---- tech tree
export function civ_list() {
    const lst = py.sorted(Object.keys(CIVS).filter(k => k !== 'default'), civ_ui.civ_name);
    return lst.length ? lst : ['default'];
}


export function tt_civ(game) {
    if (game.tt_civ == null) game.tt_civ = game.world.players[0].civ;
    return game.tt_civ;
}


/** [(building, [(type, name, age)])] for a civilization: units and techs by building. */
export function tt_items(civ) {
    const out = [];
    for (const bk of TT_ROWS) {
        const d = py.get(BUILDINGS, bk, null);
        if (!py.bool(d)) continue;
        const its = [];
        for (const u of py.get(d, 'trains', [])) {
            const ud = py.get(UNITS, u, null);
            if (py.bool(ud) && (!py.get(ud, 'civ', null) || ud['civ'] === civ)) {
                its.push(['u', u, py.get(ud, 'age', 0)]);
            }
        }
        for (const t of py.get(d, 'techs', [])) {
            const td = py.get(TECHS, t, null);
            if (py.bool(td) && !py.contains(AGE_TECHS, t) && (!py.get(td, 'civ', null) || td['civ'] === civ)) {
                its.push(['t', t, py.get(td, 'age', 0)]);
            }
        }
        out.push([bk, its]);
    }
    const other = BUILD_MENU.filter(k => Object.hasOwn(BUILDINGS, k) && !TT_ROWS.includes(k) && !py.get(BUILDINGS[k], 'civ', null))
        .map(k => ['b', k, py.get(BUILDINGS[k], 'age', 0)]);
    out.push([null, other]);
    return out;
}


/** [(rect, type, name, age, building)] + rows [(y, h, building)] - cached by civilization. */
export function tt_layout(game) {
    const civ = tt_civ(game);
    if (!Object.hasOwn(game, '_tt')) game._tt = new Map();
    const cache = game._tt;
    if (cache.has(civ)) return cache.get(civ);
    const b = BOXES['techtree'];
    const x0 = b.x + 70;
    const colw = py.floordiv(b.right - 16 - x0, 4);
    const per = Math.max(1, py.floordiv(colw - 8, TT_ICON + 2));
    let y = b.y + 100;
    const cells = [], rows = [];
    for (const [bk, its] of tt_items(civ)) {
        const by_age = [[], [], [], []];
        for (const [typ, nm, age] of its) {
            by_age[Math.max(0, Math.min(3, age))].push([typ, nm, age]);
        }
        const lines = Math.max(1, ...by_age.map(v => py.floordiv(v.length + per - 1, per)));
        const h = lines * (TT_ICON + 2) + 4;
        rows.push([y, h, bk]);
        by_age.forEach((lst, a) => {
            lst.forEach(([typ, nm, age], i) => {
                const r = new pygame.Rect(x0 + a * colw + 4 + (i % per) * (TT_ICON + 2), y + 2 + Math.floor(i / per) * (TT_ICON + 2),
                    TT_ICON, TT_ICON);
                cells.push([r, typ, nm, age, bk]);
            });
        });
        y += h;
    }
    cache.set(civ, [cells, rows, x0, colw]);
    return cache.get(civ);
}


export function tt_arrows() {
    const b = BOXES['techtree'];
    return [new pygame.Rect(b.x + 24, b.y + 50, 24, 24), new pygame.Rect(b.x + 290, b.y + 50, 24, 24)];
}


export function draw_techtree(game) {
    const scr = game.screen;
    const w = game.world;
    const b = BOXES['techtree'];
    const civ = tt_civ(game);
    const own = civ === w.players[0].civ;
    const p = w.players[0];
    const bans = own ? p.banned : _bans(civ);
    const [cells, rows, x0, colw] = tt_layout(game);
    const mp = pygame.mouse.get_pos();
    // civilization: <- crest name ->
    const [la, ra] = tt_arrows();
    for (const [r, d] of [[la, -1], [ra, 1]]) {
        S.slot(scr, r, r.collidepoint(mp) ? 'hover' : 'normal');
        const [cx, cy] = r.center;
        pygame.draw.polygon(scr, S.GOLD, [[cx - 5 * d, cy - 7], [cx + 5 * d, cy], [cx - 5 * d, cy + 7]]);
    }
    civ_ui.blit_emblem(game, civ, [la.right + 10, la.y - 4, 26, 32]);
    game.text(civ_ui.civ_name(civ), [la.right + 50, la.centery], 'b', [255, 228, 160], 'midleft');
    // legend
    const lx = b.right - 420;
    ['done', 'ok', 'later', 'ban'].forEach((st, i) => {
        const r = new pygame.Rect(lx + i * 100, la.y + 4, 16, 16);
        tt_mark(scr, r, st);
        game.text(i18n.t(`win.tt_${st}`), [r.right + 6, r.centery], 's', S.TEXT_DIM, 'midleft');
    });
    // age columns
    for (let a = 0; a < 4; a++) {
        const cx = x0 + a * colw;
        const hr = new pygame.Rect(cx + 2, b.y + 78, colw - 4, 20);
        S.shade_overlay(scr, hr, undefined, a % 2 ? 90 : 60);
        game.age_shield(hr.x + 12, hr.centery, a, 20, (own && a <= p.age) ? [110, 40, 30] : [70, 60, 50],
            !(own && a <= p.age));
        game.text(AGE_NAMES[a], [hr.x + 28, hr.centery], 'bs', (!own || a <= p.age) ? [250, 214, 130]
            : S.TEXT_DIM, 'midleft');
        if (own && a === p.age) pygame.draw.rect(scr, S.GOLD, hr, 1);
    }
    // building rows
    rows.forEach(([y, h, bk], i) => {
        if (i % 2 === 0) S.shade_overlay(scr, [b.x + 14, y, b.w - 28, h], undefined, 45);
        if (bk) {
            const ic = game.icon('b', bk, 0, Math.min(h - 2, 26));
            scr.blit(ic, ic.get_rect({ center: [b.x + 42, y + py.floordiv(h, 2)] }));
        } else {
            S.blit_icon(scr, 'construction', [b.x + 42, y + py.floordiv(h, 2)], 24);
        }
    });
    let hover = null;
    for (const [r, typ, nm, age, bk] of cells) {
        scr.blit(game.icon(typ, nm, 0, TT_ICON), r);
        let st;
        if (py.contains(bans, nm) || (bk && py.contains(bans, bk))) {
            st = 'ban';
        } else if (own && typ === 't' && p.techs.has(nm)) {
            st = 'done';
        } else if (own && age > p.age) {
            st = 'later';
        } else {
            st = 'ok';
        }
        tt_mark(scr, r, st);
        if (r.collidepoint(mp)) {
            hover = [r, typ, nm];
            pygame.draw.rect(scr, S.GOLD_HI, r.inflate(2, 2), 1);
        }
    }
    if (hover) {
        const [r, typ, nm] = hover;
        const d = (typ === 'u' ? UNITS : typ === 't' ? TECHS : BUILDINGS)[nm];
        game.draw_tip([d['name'], py.get(d, 'cost', {}), py.get(d, 'desc', '')], undefined, undefined, [r.x, r.y - 4]);
    }
}


/** Icon state: researched - a green frame and a tick; later - dimmed; unavailable - grey with a red cross. */
export function tt_mark(scr, r, st) {
    if (st === 'done') {
        pygame.draw.rect(scr, [90, 220, 90], r, 2);
        pygame.draw.lines(scr, [90, 240, 90], false, [[r.right - 10, r.bottom - 7], [r.right - 7, r.bottom - 3],
            [r.right - 2, r.bottom - 11]], 2);
    } else if (st === 'later') {
        S.shade_overlay(scr, r, undefined, 110);
        pygame.draw.rect(scr, [90, 74, 50], r, 1);
    } else if (st === 'ban') {
        S.shade_overlay(scr, r, [40, 40, 40], 170);
        pygame.draw.line(scr, [220, 50, 40], r.topleft, [r.right - 1, r.bottom - 1], 2);
        pygame.draw.line(scr, [220, 50, 40], [r.right - 1, r.y], [r.x, r.bottom - 1], 2);
    } else {
        pygame.draw.rect(scr, [150, 118, 70], r, 1);
    }
}


export const _BANS = new Map();


export function _bans(civ) {
    if (!_BANS.has(civ)) {
        const { civ_bans } = modules.world;
        _BANS.set(civ, civ_bans(civ));
    }
    return _BANS.get(civ);
}


export function click_techtree(game, pos) {
    const [la, ra] = tt_arrows();
    for (const [r, d] of [[la, -1], [ra, 1]]) {
        if (r.collidepoint(pos)) {
            game.audio.click();
            const lst = civ_list();
            const cur = tt_civ(game);
            const i = lst.includes(cur) ? lst.indexOf(cur) : 0;
            game.tt_civ = lst[py.mod(i + d, lst.length)];
        }
    }
}


export function lock(scr, cx, cy) {
    pygame.draw.rect(scr, [200, 170, 90], [cx - 6, cy - 2, 12, 9], 0, 2);
    pygame.draw.arc(scr, [200, 170, 90], [cx - 5, cy - 9, 10, 12], 0, 3.1416, 2);
}
