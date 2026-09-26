// port of game/match.py
// Match parameters (the "Game Settings" column in the lobby, like Game Settings in AoE2 DE) and their effect on the world.
//
//   OPTIONS            - [(key, caption, [(value, caption)...], default)] - the rows of the lobby column
//   defaults()         - a dict of all parameters by default
//   normalize(s)       - complete a dict with the missing keys
//   map_side(s, n, mt) - the map side in tiles
//   apply_start(w)     - after map generation: resources, starting age, map reveal, the full tree...
//   treaty_active(w)   - whether a treaty is in force (attacking others is not allowed)
//   victory_check(w)   - special victory conditions (time, score); called from World.check_victory
//
// The rules are taken from AoE2 (see docs/research/02_menus.md, M15-M26): resources Low/Medium/High/Ultra,
// Death Match (20000/20000/10000/5000), population 25-200, starting/ending age, treaty 5-60 min
// ("no attacking"), victory: standard / conquest / time limit / score.
import * as py from '../runtime/py.js';
import { random, modules } from '../runtime/py.js';
import { AGE_TECHS, TECHS, BUILDINGS, CIVS, TILE } from './data.js';
import * as i18n from './i18n.js';

export const M = 60.0;

// ---- tables
export const RESOURCES = {       // food, wood, gold, stone
    'standard': null,                                   // standard (START_RES + civilization bonuses)
    'low': [200, 200, 100, 200],
    'medium': [500, 500, 300, 300],
    'high': [1000, 1000, 700, 700],
    'ultra': [10000, 10000, 10000, 10000],
};
export const DEATHMATCH = [20000, 20000, 10000, 5000];
export const MAP_SIZE = { 'tiny': 120, 'small': 144, 'medium': 168, 'normal': 200, 'large': 220, 'huge': 240 };   // DE
export const AUTO_SIZE = new Map([[2, 'tiny'], [3, 'small'], [4, 'medium'], [5, 'normal'], [6, 'normal'], [7, 'large'], [8, 'large']]);
export const AGE_IDX = { 'standard': 0, 'dark': 0, 'feudal': 1, 'castle': 2, 'imperial': 3, 'post': 3 };
export const POST_VILLAGERS = 20;         // post-imperial age: villagers at the start (instead of 3)
export const ECO_HOSTS = ['town_center', 'mill', 'lumber_camp', 'mining_camp', 'market', 'dock'];

function _range(a, b, s) { const out = []; for (let i = a; i < b; i += s) out.push(i); return out; }

// The captions are locale keys (match.opt.<key>, match.val.<key>.<value>, match.flag.<key>, match.ai.<n>);
// the number of minutes - 'match.minutes' with {n}; population and score - the number itself. The text comes from value_label() / label().
export const OPTIONS = [
    ['mode', [['rm', 'match.val.mode.rm'], ['dm', 'match.val.mode.dm']], 'rm'],
    ['size', [['auto', 'match.val.size.auto'], ['tiny', 'match.val.size.tiny'], ['small', 'match.val.size.small'],
        ['medium', 'match.val.size.medium'], ['normal', 'match.val.size.normal'],
        ['large', 'match.val.size.large'], ['huge', 'match.val.size.huge']], 'auto'],
    ['theme', [['auto', 'match.val.theme.auto'], ['grass', 'match.val.theme.grass'],
        ['desert', 'match.val.theme.desert'], ['steppe', 'match.val.theme.steppe'],
        ['snow', 'match.val.theme.snow'], ['tropical', 'match.val.theme.tropical'],
        ['autumn', 'match.val.theme.autumn']], 'auto'],   // Wasteland "Auto" - 1 of 6 landscapes (the Arabia DE biomes)
    ['ai_all', null, null],            // a common choice: sets the level for all computers
    ['resources', [['standard', 'match.val.resources.standard'], ['low', 'match.val.resources.low'],
        ['medium', 'match.val.resources.medium'], ['high', 'match.val.resources.high'],
        ['ultra', 'match.val.resources.ultra']], 'standard'],
    ['pop', _range(25, 201, 25).map(v => [v, String(v)]), 200],
    ['speed', [[1.0, 'match.val.speed.1.0'], [1.5, 'match.val.speed.1.5'], [1.7, 'match.val.speed.1.7'],
        [2.0, 'match.val.speed.2.0']], 1.7],
    ['reveal', [['normal', 'match.val.reveal.normal'], ['explored', 'match.val.reveal.explored'],
        ['all', 'match.val.reveal.all']], 'normal'],
    ['start_age', [['standard', 'match.val.age.standard'], ['dark', 'match.val.age.dark'],
        ['feudal', 'match.val.age.feudal'], ['castle', 'match.val.age.castle'],
        ['imperial', 'match.val.age.imperial'], ['post', 'match.val.age.post']], 'standard'],
    ['end_age', [['standard', 'match.val.age.standard'], ['dark', 'match.val.age.dark'],
        ['feudal', 'match.val.age.feudal'], ['castle', 'match.val.age.castle'],
        ['imperial', 'match.val.age.imperial']], 'standard'],
    ['treaty', [[0, 'match.val.treaty.0']].concat(_range(5, 61, 5).map(m => [m, 'match.minutes'])), 0],
    ['victory', [['standard', 'match.val.victory.standard'], ['conquest', 'match.val.victory.conquest'],
        ['time', 'match.val.victory.time'], ['score', 'match.val.victory.score']], 'standard'],
    ['victory_time', [10, 15, 20, 30, 45, 60, 90, 120].map(m => [m, 'match.minutes']), 30],
    ['victory_score', [1000, 2000, 4000, 6000, 8000, 10000, 15000].map(v => [v, String(v)]), 4000],
];
export const FLAGS = [   // the "Teams" and "Advanced" checkboxes: (key, caption key, default)
    ['lock_teams', 'match.flag.lock_teams', true],
    ['team_together', 'match.flag.team_together', true],
    ['lock_speed', 'match.flag.lock_speed', false],
    ['all_techs', 'match.flag.all_techs', false],
];
export const OPT = {};
export const LABEL = {};
for (const [k, vals, d] of OPTIONS) {
    OPT[k] = ['match.opt.' + k, vals, d];
    LABEL[k] = 'match.opt.' + k;
}
export const HIDDEN_UNLESS = { 'victory_time': ['victory', 'time'], 'victory_score': ['victory', 'score'] };

// AI levels as in DE (0...5) - PROFILES in game/ai.py; captions - match.ai.0...5
export const AI_LEVELS = _range(0, 6, 1).map(i => 'match.ai.' + i);

/** A lobby parameter's caption in the player's language. */
export function label(key) {
    return i18n.t(py.get(LABEL, key, key));
}

export function ai_level_name(level) {
    return i18n.t(AI_LEVELS[Math.max(0, Math.min(AI_LEVELS.length - 1, py.int(level)))]);
}
export const LEVEL_OF_DIFF = new Map([[0, 0], [1, 2], [2, 3]]);      // the old 3 levels (Easy/Normal/Hard) -> DE levels
export const TIER_OF_LEVEL = [0, 0, 1, 2, 2, 2];      // DE level -> the "step" of the old AI code (comparisons diff >= 1/2)
export const LEVEL_GATHER = [0.85, 0.92, 1.0, 1.3, 1.45, 1.6];    // the computer's gather bonus (as before: 0.85/1.0/1.3)

export function defaults() {
    const d = {};
    for (const [k, vals, dflt] of OPTIONS) if (vals != null) d[k] = dflt;
    for (const [k, , v] of FLAGS) d[k] = v;
    d['map'] = 'arabia';
    return d;
}

export function normalize(s) {
    const d = defaults();
    if (py.bool(s)) {
        for (const [k, v] of py.items(s)) if (Object.hasOwn(d, k)) d[k] = v;
    }
    return d;
}

export function visible(s, key) {
    const cond = py.get(HIDDEN_UNLESS, key, null);
    return cond == null || py.eq(py.get(s, cond[0], null), cond[1]);
}

/** A parameter value's caption in the player's language (the number of minutes - "{n} min"). */
export function value_label(key, v) {
    const vals = OPT[key][1] || [];
    for (const [val, lbl] of vals) {
        if (py.eq(val, v)) {
            if (lbl === 'match.minutes') return i18n.t(lbl, { n: val });
            return lbl.startsWith('match.') ? i18n.t(lbl) : lbl;
        }
    }
    return py.str(v);
}

/** [caption] of all values of a parameter in the OPT order (for the lobby list). */
export function value_labels(key) {
    return (OPT[key][1] || []).map(([v]) => value_label(key, v));
}

/** The DE map side by size (tiny 120 ... huge 240); "auto" - by the number of players, as in DE. */
export function map_side(s, n, map_type = 'arabia') {
    let size = py.get(s, 'size', 'auto');
    if (size === 'auto' || !Object.hasOwn(MAP_SIZE, size)) size = AUTO_SIZE.has(n) ? AUTO_SIZE.get(n) : 'large';
    return MAP_SIZE[size];
}

export function start_age(s) {
    return py.get(AGE_IDX, py.get(s, 'start_age', 'standard'), 0);
}

export function max_age(s) {
    const e = py.get(s, 'end_age', 'standard');
    return e === 'standard' ? 3 : py.get(AGE_IDX, e, 3);
}

// ============================================================ match start
/** After map generation and content hooks (the civilizations' starting units). */
export function apply_start(w) {
    const s = w.settings;
    w.pop_limit = py.int(py.get(s, 'pop', 200));
    w.max_age = max_age(s);
    w.treaty_end = py.float(py.or_(py.get(s, 'treaty', 0), 0)) * M;
    w.reveal = py.get(s, 'reveal', 'normal');
    // resources: Death Match - its own numbers; standard - as before (with civilization bonuses)
    const table = py.get(s, 'mode', null) === 'dm' ? DEATHMATCH : py.get(RESOURCES, py.get(s, 'resources', 'standard'), null);
    if (table != null) {
        for (const p of w.players) {
            const civ_add = _civ_start(p.civ);
            const rs = ['food', 'wood', 'gold', 'stone'];
            for (let i = 0; i < Math.min(rs.length, table.length); i++) {
                const r = rs[i], v = table[i];
                p.res[r] = Math.max(0, v + py.get(civ_add, r, 0));
            }
        }
    }
    // the full tech tree: lift the civilization bans (except foreign unique ones)
    if (py.bool(py.get(s, 'all_techs', null))) {
        const { civ_bans } = modules.world;
        for (const p of w.players) p.banned = civ_bans(p.civ, true);
    }
    // starting age
    const age = Math.min(start_age(s), w.max_age);
    if (age > 0) {
        for (const p of w.players) {
            for (const t of AGE_TECHS.slice(0, age)) {
                if (!py.contains(p.techs, t)) w.apply_tech(p, t);
            }
        }
        if (py.get(s, 'start_age', null) === 'post') {
            for (const p of w.players) _post_imperial(w, p);
        }
        _clear(w.messages);
        _clear(w.events);
        w.recount();
    }
    // map reveal
    if (w.reveal === 'explored' || w.reveal === 'all') {
        w.explored.fill(1, 0, w.W * w.H);
        for (const b of w.buildings) b.seen = true;
        w.fog_version += 1;
    }
    w.update_teams();
}

function _clear(x) {
    if (Array.isArray(x)) x.length = 0;
    else x.clear();
}

export function _civ_start(civ) {
    return py.get(py.get(CIVS, civ, {}), 'start', {});
}

/** Post-Imperial Age (AoE2): Imperial + the economic techs researched, 20 villagers. */
export function _post_imperial(w, p) {
    const { Unit } = modules.world;
    const has = (t) => py.contains(p.techs, t);
    for (const host of ECO_HOSTS) {
        for (const t of py.get(py.get(BUILDINGS, host, {}), 'techs', [])) {
            if (Object.hasOwn(TECHS, t) && !AGE_TECHS.includes(t) && !has(t) && p.allows(t)
                    && py.get(TECHS[t], 'age', 0) <= 3) {
                const ok = _req(t).every(r => has(r));
                if (ok) w.apply_tech(p, t);
            }
        }
    }
    // a second pass - the chains (req) got researched in order
    for (const host of ECO_HOSTS) {
        for (const t of py.get(py.get(BUILDINGS, host, {}), 'techs', [])) {
            if (Object.hasOwn(TECHS, t) && !AGE_TECHS.includes(t) && !has(t) && p.allows(t)
                    && _req(t).every(r => has(r))) {
                w.apply_tech(p, t);
            }
        }
    }
    const tc = w.buildings.find(b => b.owner === p.id && b.kind === 'town_center');
    if (tc === undefined || tc == null) return;
    let have = 0;
    for (const u of w.units) if (u.owner === p.id && u.kind === 'villager') have += 1;
    const cx = tc.tx + Math.floor(tc.w / 2), cy = tc.ty + Math.floor(tc.h / 2);
    for (let i = 0; i < Math.max(0, POST_VILLAGERS - have); i++) {
        const [tx, ty] = w.nearest_free_tile(cx + (i % 5) - 2, cy + Math.floor(tc.h / 2) + 2 + Math.floor(i / 5));
        w.units.push(new Unit('villager', p.id, (tx + 0.5) * TILE, (ty + 0.5) * TILE, w));
    }
}

export function _req(t) {
    const r = py.get(TECHS[t], 'req', []);
    return Array.isArray(r) ? r : [r];
}

// ============================================================ treaty
export function treaty_active(w) {
    return w.time < py.getattr(w, 'treaty_end', 0.0);
}

export function treaty_left(w) {
    return Math.max(0.0, py.getattr(w, 'treaty_end', 0.0) - w.time);
}

// ============================================================ victory
/** Special conditions: a time limit (the team with the highest score wins) and score (the first team
 *  to reach the target). teams - the living teams. Returns the winning team's number or None. */
export function victory_check(w, teams) {
    const s = w.settings;
    const v = py.get(s, 'victory', 'standard');
    if (!(v === 'time' || v === 'score') || py.len(teams) <= 1) return null;
    const { team_scores } = modules.scoring;
    if (v === 'time') {
        if (w.time < py.float(py.get(s, 'victory_time', 30)) * M) return null;
        const sc = team_scores(w);
        const best = py.max(py.list(teams), t => py.get(sc, t, 0));
        return best;
    }
    const target = py.float(py.get(s, 'victory_score', 4000));
    const sc = team_scores(w);
    for (const t of py.sorted(teams, t => -py.get(sc, t, 0))) {
        if (py.get(sc, t, 0) >= target) return t;
    }
    return null;
}

/** Lobby slot teams -> world team numbers. raw: 0 - "-" (on one's own), 1-4, 5 - "?" (random).
 *  "?" is chosen so that at least two teams remain in the match. */
export function resolve_teams(raw, rnd = null) {
    rnd = rnd || random;
    const n = raw.length;
    let t;
    for (let it = 0; it < 40; it++) {
        t = [];
        raw.forEach((v, i) => {
            if (v === 0) t.push(10 + i);            // "-": one's own team
            else if (v === 5) t.push(rnd.randint(1, 4));
            else t.push(v);
        });
        if (new Set(t).size >= 2 || n < 2) break;
    }
    // dense numbers 0...
    const order = [];
    for (const x of t) if (!order.includes(x)) order.push(x);
    return t.map(x => order.indexOf(x));
}

/** Whether the match can start: there is a "?" / "-" or at least two different teams. */
export function teams_valid(raw) {
    if (raw.length < 2) return false;
    if (raw.some(v => v === 0 || v === 5)) return true;
    return new Set(raw).size >= 2;
}
