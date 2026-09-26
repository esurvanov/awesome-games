// G9 screens: checks the pure-logic parts of the JS ports of menu, screens, lobby, settings_ui, saves_ui, playlist
// against the Python modules run on the same mock game object.
// Reference: web/tests/fixtures/G9-screens_ref.json (.venv/bin/python web/tests/gen_G9-screens_ref.py).
// Run: node --import ./web/tests/stub_loader.mjs --test web/tests/G9-screens.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setup } from './node_env.mjs';
import * as py from '../runtime/py.js';
import { random } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';

await setup();
const REF = JSON.parse(fs.readFileSync(new URL('./fixtures/G9-screens_ref.json', import.meta.url), 'utf8'));
await import('../src/_data_init.js');
const i18n = await import('../src/i18n.js');
i18n.set_language('en', false);
const menu = await import('../src/menu.js');
const screens = await import('../src/screens.js');
const lobby = await import('../src/lobby.js');
const settings_ui = await import('../src/settings_ui.js');
const saves_ui = await import('../src/saves_ui.js');
const playlist = await import('../src/playlist.js');
const gsettings = await import('../src/settings.js');

class Font {
    constructor(k) { this.k = k; }
    size(t) { return [Array.from(t).length * this.k, 16]; }
}
const FONTS = {
    h: new Font(12), l: new Font(9), btn: new Font(8), s: new Font(6), m: new Font(7), b: new Font(8), bs: new Font(7),
    xl: new Font(14),
};
class Audio {
    constructor() {
        this.clicks = 0;
        this.settings = { music: true, sfx: true, music_vol: 0.8, sfx_vol: 0.8, voice_vol: 0.8 };
    }
    click() { this.clicks += 1; }
}
class Mock {
    constructor() {
        this.menu_cfg = {};
        this.audio = new Audio();
        this.fonts = FONTS;
        this.state = 'menu';
        this.help = false;
        this.world = null;
        this.loaded = null;
        this.running = true;
    }
    begin_loading(args) { this.loaded = args; }
}
py.mixin(Mock, screens.ScreensUI, menu.MenuUI, lobby.LobbyUI);

const R = r => [r.x, r.y, r.w, r.h];
const rects = lst => lst.map(([r, ...rest]) => [R(r), ...rest]);
const J = x => JSON.parse(JSON.stringify(x));     // undefined -> dropped, Maps are not used here
const r6 = v => Math.round(v * 1e6) / 1e6;

test('playlist: shuffle order, TrackPlayer lists and a scripted run', () => {
    const pl = new playlist.Playlist(['a', 'b', 'c', 'd', 'e'], random.Random(5));
    assert.deepEqual(py.range(17).map(() => pl.next()), REF.playlist_seq);
    const calls = [];
    const music = {
        busy: false,
        load(p) { calls.push(['load', p]); },
        set_volume(v) { calls.push(['vol', r6(v)]); },
        play(loops = 0) { calls.push(['play', loops]); this.busy = true; },
        stop() { calls.push(['stop']); this.busy = false; },
        get_busy() { return this.busy; },
    };
    const man = JSON.parse(fs.readFileSync(new URL('../../assets/audio/manifest.json', import.meta.url), 'utf8'));
    const tp = new playlist.TrackPlayer({ mixer: { music } }, 'assets/audio', man);
    const shared = random.Random(1);
    for (const v of Object.values(tp.lists)) v.rnd = shared;
    assert.deepEqual(tp.dur, REF.tp_dur);
    assert.deepEqual(tp.title, REF.tp_title);
    assert.deepEqual(Object.fromEntries(Object.entries(tp.lists).map(([k, v]) => [k, v.items])), REF.tp_lists);
    assert.equal(tp.ok, REF.tp_ok);
    const script = [].concat(Array(30).fill(['menu', 0.05, 0.0]), Array(60).fill(['play', 0.05, 0.0]),
        Array(40).fill(['play', 0.05, 1.2]), Array(30).fill(['play', 0.05, 0.1]));
    const trace = [];
    script.forEach(([mode, dt, inten], i) => {
        tp.update(mode, dt, inten);
        trace.push([tp.kind, tp.cur, r6(tp.level), r6(tp.target), tp.pending ? tp.pending.slice() : null]);
        if (i === 100) tp.stinger(true);
    });
    assert.deepEqual(trace, REF.tp_trace);
    assert.deepEqual(calls, REF.tp_calls);
});

test('lobby: model, layout, actions', () => {
    const g = new Mock();
    assert.deepEqual(lobby.de_colors(), REF.de_colors);
    assert.deepEqual(lobby.default_slots(), REF.default_slots);
    assert.deepEqual(rects(g.setup_rects()), REF.setup_rects0);
    assert.deepEqual(g.setting_rows(), REF.setting_rows0);
    const ov = {};
    for (const key of ['map', 'ai_all', 'player', 'nplayers', 'mode', 'resources', 'speed', 'treaty'])
        ov[key] = g.option_values(key);
    assert.deepEqual(J(ov), REF.option_values0);
    for (const [act, val] of [['color', 1], ['color', 1], ['team', 1], ['team', 0], ['flag', 'lock_speed'], ['map', 'arena']])
        g.lobby_action(act, val);
    g.apply_choice('nplayers', null, 5);
    g.apply_choice('player', 3, ['ai', 4]);
    g.apply_choice('ai_all', null, 3);
    g.apply_choice('player', 2, ['closed', null]);
    g.apply_choice('mode', null, 'dm');
    g.apply_choice('treaty', null, 10);
    g.lobby_action('opt', 'speed');
    assert.deepEqual([R(g.dropdown[0]), ...g.dropdown.slice(1)], REF.dropdown);
    g.dropdown = null;
    assert.deepEqual(g.slots(), REF.slots1);
    assert.deepEqual(J(g.opts()), REF.opts1);
    assert.deepEqual(g.active_slots(), REF.active1);
    assert.equal(g.teams_ok(), REF.teams_ok1);
    assert.equal(g.ai_level_all(), REF.ai_all1);
    assert.deepEqual(rects(g.setup_rects()), REF.setup_rects1);
    assert.equal(g.flags_y(), REF.flags_y1);
    g.lobby_action('play', null);
    assert.deepEqual(J(g.loaded), REF.loaded);
    g.lobby_action('reset', null);
    assert.deepEqual(g.slots(), REF.slots_reset);
});

test('screens: clock, tabs, layouts, stat columns', () => {
    const g = new Mock();
    assert.deepEqual([null, 0, 5.7, 59, 61, 3599, 3600, 3725.2, 86399].map(screens._clock), REF.clock);
    assert.deepEqual(screens.TIPS, REF.tips);
    assert.deepEqual(rects(g.stats_rects()), REF.stats_rects);
    for (const name of ['game_menu_rects', 'gameover_rects', 'confirm_rects']) {
        const [box, items] = g[name]();
        assert.deepEqual([R(box), rects(items)], REF[name], name);
    }
    const P = { id: 0, gathered: { food: 123.7, wood: 55.2 } };
    const st = {
        kills: 4, losses: 2, razed: 1, bld_lost: 0, converted: 0, army_max: 12, trib_sent: 10.5,
        trib_recv: 0.0, trade: 44.9, age_t: [0, 300.5, null, 0], techs: 7, explored: 0.4567, castles: 1,
        vil_max: 30, pop_max: 50, samples: [[0, 4], [30, 7], [60, 12], [400, 30]],
    };
    const sc = { military: 1, economy: 2, technology: 3, society: 4, total: 10 };
    const cols = {};
    for (const tab of ['score', 'military', 'economy', 'tech', 'society', 'timeline'])
        cols[tab] = screens.stat_columns(tab).map(([lbl, ic, fn, fmt]) => [lbl, ic, fn(null, P, st, sc), fmt]);
    assert.deepEqual(cols, REF.stat_columns);
    assert.deepEqual([-1, 0, 29, 30, 100, 1000].map(t => screens.ScreensUI._pop_at(st, t)), REF.pop_at);
    assert.deepEqual([-1, 0, 29, 30, 100, 1000].map(t => g._pop_at(st, t)), REF.pop_at);
    g.help = 'menu';
    g.game_menu_action('resume');
    assert.equal(g.help, REF.help_after_resume);
});

test('settings_ui: layout, dropdown, slider, text field', () => {
    const g = new Mock();
    g.state = 'menu';
    const sr = {};
    for (const tab of ['game', 'graphics', 'interface', 'audio', 'keys']) {
        g.set_tab = tab;
        sr[tab] = rects(g.settings_rects());
    }
    assert.deepEqual(sr, REF.settings_rects);
    g.set_tab = 'game';
    assert.deepEqual(['game_speed', 'scroll_speed', 'nope'].map(k => g.row_of(k)), REF.row_of);
    assert.deepEqual(['settings.off', 'match.val.speed.1.5', '30', 'English'].map(settings_ui._lbl), REF.lbl);
    g.settings_action('ctl', 'game_speed');
    const d = g.set_drop;
    assert.deepEqual([R(d[0]), d[1], d[2], d[3], d[4]], REF.set_drop);
    g.set_drop = null;
    g.settings_action('ctl', 'scroll_speed', [1000, 200]);
    assert.equal(gsettings.get('scroll_speed'), REF.scroll_speed);
    g.settings_event(new pygame.event.Event(pygame.MOUSEMOTION, { pos: [1100, 200], rel: [0, 0], buttons: [1, 0, 0] }));
    assert.equal(gsettings.get('scroll_speed'), REF.scroll_speed2);
    // audio: the mock Audio has no set_volume -> a.settings[key] = v, then sound.save_settings (late-bound)
    py.register_modules({ sound: { save_settings() {} } });
    g.set_tab = 'audio';
    g.settings_action('ctl', 'music_vol', [1150, 300]);
    assert.equal(g.audio.settings.music_vol, REF.music_vol);
    g.set_tab = 'interface';
    g.settings_action('ctl', 'player_name');
    for (const ch of 'Ann')
        g.settings_event(new pygame.event.Event(pygame.KEYDOWN, { key: ch.toLowerCase().charCodeAt(0), unicode: ch, mod: 0 }));
    g.settings_event(new pygame.event.Event(pygame.KEYDOWN, { key: pygame.K_BACKSPACE, unicode: '', mod: 0 }));
    assert.equal(gsettings.get('player_name'), REF.player_name);
    g.settings_action('done', null);
    assert.deepEqual([g.menu_screen, g.set_tab], REF.after_done);
});

test('saves_ui: layout and slot selection', () => {
    const g = new Mock();
    g.saves_mode = 'load';
    g.saves_list = py.range(9).map(i => ['s' + i, { name: 'n' + i }, null]);
    g.saves_scroll = 60;
    assert.deepEqual(rects(g.saves_rects()), REF.saves_rects_load);
    g.saves_mode = 'save';
    g.saves_scroll = 0;
    assert.deepEqual(rects(g.saves_rects()), REF.saves_rects_save);
    g.saves_action('slot', 's3');
    assert.equal(g.save_name, REF.save_name);
    assert.deepEqual([0, 75.5, 4000].map(saves_ui._clock), REF.saves_clock);
});

test('menu: layout, wrap, credits, actions', () => {
    const g = new Mock();
    g.menu_screen = 'main';
    assert.deepEqual(rects(g.main_rects()), REF.main_rects);
    assert.deepEqual(rects(g.single_rects()), REF.single_rects);
    assert.deepEqual(rects(g.learn_rects()), REF.learn_rects);
    assert.deepEqual(menu._wrap(FONTS.m, 'The quick brown fox jumps over the lazy dog, again and again and again.', 120), REF.wrap);
    assert.deepEqual(g.credits_lines(), REF.credits);
    const seq = [];
    for (const act of ['single', 'skirmish', 'back', 'back', 'learn', 'back', 'news', 'credits', 'back', 'multi']) {
        g.menu_action(act, null);
        seq.push(g.menu_screen);
    }
    assert.deepEqual(seq, REF.menu_seq);
    g.start_tutorial();
    assert.deepEqual(J(g.loaded), REF.tutorial);
    assert.ok(menu.version_line().includes('0.9.'));
    assert.ok(menu.news().length > 0);
});
