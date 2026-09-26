// port of game/content/civ_units.py
// Unique units of the civilizations (trained in the castle, the elite upgrade there too) and unique techs
// (castle and imperial). The numbers are Definitive Edition values converted to the game's scales
// (speed - tiles/s, reload and time - game seconds).
//
// A unit/tech entry with a 'civ' field is available only to that civilization (see world.civ_bans).
// Special tricks go through hooks:
//   'on_attack'(unit, world, target, dmg) - after every hit/shot (Chu Ko Nu volley, trampling);
//   'regen' - HP per second (berserk; tick in WORLD_HOOKS), the 'regen' stat multiplies (Berserkergang).
// Armor classes: all unique units get the extra class 'unique' (the samurai has a bonus against it).
import * as py from '../../runtime/py.js';
import { math, random } from '../../runtime/py.js';
import { add_unit, add_tech, add_trains } from './__init__.js';
import * as art from '../civ_art.js';
import { TILE, UNITS, BUILDINGS, WORLD_HOOKS } from '../data.js';

export const UNIQUE = {};         // civilization -> [base kinds of unique units]
export const UTECHS = {};         // civilization -> [castle tech, imperial tech]

// hmat rows are indexed by owner, and owner == -1 (Gaia) reads the last element like Python's row[-1]
function _row_at(row, i) { return i < 0 ? row[row.length + i] : row[i]; }


// ============================================================ special tricks
/** Chu Ko Nu: besides the main arrow - n more arrows of 'volley_atk' damage at the target and nearby. */
export function _volley(u, w, t, dmg) {
    const [n, a] = u.d['volley'];
    const hrow = _row_at(w.hmat, u.owner);
    const near = py.hasattr(t, 'radius')
        ? w.units.filter(o => _row_at(hrow, o.owner) && o.alive && Math.abs(o.x - t.x) < 1.6 * TILE
            && Math.abs(o.y - t.y) < 1.6 * TILE)
        : [];
    for (let i = 0; i < n; i++) {
        const tt = (near.length && random.random() < 0.6) ? random.choice(near) : t;
        if (!tt.alive) continue;
        const pa = tt.armor()[1];
        // World.fire(src, t, dmg, x=None, y=None, delay=0.0, sound=True)
        w.fire(u, tt, Math.max(1, a - pa), undefined, undefined, 0.05 * (i + 1), false);
    }
}


/** Trampling: damage to enemies around the target (war elephant - always; cataphract - with Logistica). */
export function _trample(u, w, t, dmg) {
    let [frac, flat] = py.get(u.d, 'trample', [0.0, 0]);
    flat += u.p.stat('trample', u.kind, 0);
    if (frac <= 0 && flat <= 0) return;
    if (!py.hasattr(t, 'radius')) return;          // does not trample buildings
    const r = 0.6 * TILE;
    const tx = t.x, ty = t.y;
    const hrow = _row_at(w.hmat, u.owner);
    for (const o of w.units) {
        if (o === t || !o.alive || !_row_at(hrow, o.owner) || py.getattr(o, 'naval', false)) continue;
        if (Math.abs(o.x - tx) > r + o.radius || Math.abs(o.y - ty) > r + o.radius) continue;
        if (math.hypot(o.x - tx, o.y - ty) <= r + o.radius) {
            w.damage(o, u, Math.max(1, Math.trunc(dmg * frac + flat)));
        }
    }
}


export const _regen_t = [0.0];


/** Once a second: units with 'regen' (berserks) restore health. */
export function _regen_tick(w, dt) {
    _regen_t[0] -= dt;
    if (_regen_t[0] > 0) return;
    _regen_t[0] = 1.0;
    for (const u of w.units) {
        const r = py.get(u.d, 'regen');
        if (r && u.hp < u.max_hp && u.alive) {
            u.hp = Math.min(u.max_hp, u.hp + r * u.p.stat('regen', u.kind, 1.0));
        }
    }
}


WORLD_HOOKS['tick'].push(_regen_tick);


// ============================================================ registration
/** Unique unit key and its elite version. elite - the fields that differ for the elite (hp, atk...);
 * names and descriptions come from the locale (unit.<key>.name, unit.elite_<key>.name, tech.elite_<key>.desc). */
export function unique(civ, key, elite, up_cost, look, elite_look, d = {}) {
    py.setdefault(d, 'radius', 8);
    py.setdefault(d, 'age', 2);
    const ac = [...py.dpop(d, 'ac', []), 'unique'];
    const base = { ...d, civ: civ, ac: ac, line: key, art: look };
    add_unit(key, base);
    const ek = 'elite_' + key;
    const e = { ...base, art: elite_look, age: 3, ...elite };
    add_unit(ek, e);
    add_tech(ek, 'castle', { cost: up_cost, time: 60, age: 3, civ: civ, upgrade: [key, ek] });
    add_trains('castle', key);
    py.setdefault(UNIQUE, civ, []).push(key);
}


export function utech(civ, key, age, d = {}) {
    const time = py.dpop(d, 'time', 60);
    add_tech(key, 'castle', { age: age, time: time, civ: civ, ...d });
    py.setdefault(UTECHS, civ, []).push(key);
}


export const FOOT_ARCH = ['archer', 'crossbowman', 'arbalester', 'longbowman', 'elite_longbowman',
    'chu_ko_nu', 'elite_chu_ko_nu'];

// ---- Franks: throwing axeman (ranged "melee" damage)
unique('franks', 'throwing_axeman', { hp: 70, atk: 8, rng: 4, arm: [1, 0], los: 6 },
    { food: 1000, gold: 850 }, art.axeman(false), art.axeman(true),
    { hp: 60, atk: 7, rng: 3, reload: 2.0, arm: [0, 0], speed: 1.0, los: 5,
        cost: { food: 55, gold: 25 }, time: 17, cls: 'inf', dtype: 'melee', shot: 'javelin', shot_speed: 240,
        bonus: { bld: 1 } });
utech('franks', 'bearded_axe', 2, { cost: { food: 400, gold: 400 }, effects: [{ stat: 'rng', kind: ['throwing_axeman', 'elite_throwing_axeman'], add: 1 }] });
utech('franks', 'chivalry', 3, { cost: { food: 400, gold: 400 }, effects: [{ stat: 'time', kind: ['scout', 'light_cavalry', 'hussar', 'knight', 'cavalier', 'paladin',
    'camel_rider', 'heavy_camel_rider'], mul: 1 / 1.4 }] });

// ---- Britons: longbowman
unique('britons', 'longbowman', { hp: 40, atk: 7, rng: 6, los: 8, acc: 0.9 },
    { food: 850, gold: 850 }, art.longbow(false), art.longbow(true),
    { hp: 35, atk: 6, rng: 5, reload: 2.0, arm: [0, 1], speed: 0.96, los: 7, acc: 0.8,
        cost: { wood: 35, gold: 40 }, time: 18, cls: 'arch', ac: ['foot_arch'], bonus: { spear: 3 } });
utech('britons', 'yeomen', 2, { cost: { wood: 750, gold: 450 }, effects: [{ stat: 'rng', kind: FOOT_ARCH, add: 1 },
    { stat: 'atk', kind: ['tower', 'guard_tower', 'keep'], add: 2 }] });
utech('britons', 'warwolf', 3, { cost: { wood: 800, gold: 400 }, effects: [{ stat: 'acc', kind: 'trebuchet', add: 1 },
    { stat: 'bonus:bld', kind: 'trebuchet', mul: 1.2 }] });

// ---- Mongols: mangudai (cavalry archer against siege)
unique('mongols', 'mangudai', { hp: 65, atk: 8, arm: [1, 0], bonus: { siege: 5, spear: 1 } },
    { food: 1100, gold: 675 }, art.mangudai(false), art.mangudai(true),
    { hp: 60, atk: 6, rng: 4, reload: 2.1, arm: [0, 0], speed: 1.43, los: 6, acc: 0.95,
        cost: { wood: 55, gold: 65 }, time: 26, cls: 'cav', ac: ['arch', 'cav_arch'], bonus: { siege: 3, spear: 1 },
        radius: 11 });
utech('mongols', 'nomads', 2, { cost: { wood: 300 } });
utech('mongols', 'drill', 3, { cost: { food: 500, gold: 450 }, effects: [{ stat: 'speed', cls: 'siege', not_cls: ['ship'], mul: 1.5 }] });

// ---- Byzantines: cataphract
unique('byzantines', 'cataphract', { hp: 150, atk: 12, bonus: { inf: 16 } },
    { food: 1600, gold: 800 }, art.cataphract(false), art.cataphract(true),
    { hp: 110, atk: 9, rng: 0, reload: 1.7, arm: [2, 1], speed: 1.35, los: 4,
        cost: { food: 70, gold: 75 }, time: 20, cls: 'cav', bonus: { inf: 12 }, carm: { cav: 12 },
        on_attack: _trample, radius: 12 });
utech('byzantines', 'greek_fire', 2, { cost: { food: 250, gold: 300 }, effects: [{ stat: 'rng', kind: ['fire_galley', 'fire_ship', 'fast_fire_ship'], add: 1 }] });
utech('byzantines', 'logistica', 3, { cost: { food: 800, gold: 600 }, effects: [{ stat: 'trample', kind: ['cataphract', 'elite_cataphract'], add: 5 },
    { stat: 'bonus:inf', kind: ['cataphract', 'elite_cataphract'], add: 6 }] });

// ---- Teutons: teutonic knight
unique('teutons', 'teutonic_knight', { hp: 100, atk: 17, arm: [10, 2] },
    { food: 1200, gold: 600 }, art.teutonic(false), art.teutonic(true),
    { hp: 80, atk: 12, rng: 0, reload: 2.0, arm: [5, 2], speed: 0.8, los: 3,
        cost: { food: 85, gold: 40 }, time: 12, cls: 'inf', bonus: { bld: 4 } });
utech('teutons', 'ironclad', 2, { cost: { wood: 400, gold: 350 }, effects: [{ stat: 'arm_m', cls: 'siege', not_cls: ['ship'], add: 4 }] });
utech('teutons', 'crenellations', 3, { cost: { food: 600, stone: 400 }, effects: [{ stat: 'rng', kind: 'castle', add: 3 }] });

// ---- Japanese: samurai (against unique units)
unique('japanese', 'samurai', { hp: 80, atk: 12, bonus: { unique: 12, bld: 2 } },
    { food: 950, gold: 875 }, art.samurai(false), art.samurai(true),
    { hp: 60, atk: 8, rng: 0, reload: 1.45, arm: [1, 1], speed: 1.0, los: 4,
        cost: { food: 60, gold: 30 }, time: 9, cls: 'inf', bonus: { unique: 10, bld: 2 } });
utech('japanese', 'yasama', 2, { cost: { food: 300, wood: 300 }, effects: [{ stat: 'arrows', kind: ['tower', 'guard_tower', 'keep'], add: 2 }] });
utech('japanese', 'kataparuto', 3, { cost: { wood: 550, gold: 600 }, effects: [{ stat: 'reload', kind: 'trebuchet', mul: 1 / 1.33 }] });

// ---- Chinese: chu ko nu (a volley of several arrows)
unique('chinese', 'chu_ko_nu', { hp: 50, volley: [4, 3] },
    { food: 760, gold: 760 }, art.chukonu(false), art.chukonu(true),
    { hp: 45, atk: 8, rng: 4, reload: 3.0, arm: [0, 0], speed: 0.96, los: 6, acc: 0.85,
        cost: { wood: 40, gold: 35 }, time: 19, cls: 'arch', ac: ['foot_arch'], bonus: { spear: 3 },
        volley: [2, 3], on_attack: _volley, shot: 'bolt' });
utech('chinese', 'great_wall', 2, { cost: { wood: 400, stone: 200 }, effects: [{ stat: 'hp', kind: ['palisade_wall', 'palisade_gate', 'stone_wall', 'gate', 'tower',
    'guard_tower', 'keep'], mul: 1.3 }] });
utech('chinese', 'rocketry', 3, { cost: { wood: 750, gold: 750 }, effects: [{ stat: 'atk', kind: ['chu_ko_nu', 'elite_chu_ko_nu'], add: 2 },
    { stat: 'atk', kind: ['scorpion', 'heavy_scorpion'], add: 4 }] });

// ---- Persians: war elephant (huge, tramples)
unique('persians', 'war_elephant', { hp: 600, atk: 20, arm: [1, 3] },
    { food: 1600, gold: 1200 }, art.elephant(false), art.elephant(true),
    { hp: 450, atk: 15, rng: 0, reload: 2.0, arm: [1, 2], speed: 0.6, los: 4,
        cost: { food: 120, gold: 70 }, time: 25, cls: 'cav', ac: ['elephant'], bonus: { bld: 7 },
        trample: [0.25, 0], on_attack: _trample, radius: 17, bar_h: 52, icon_k: 0.52 });
utech('persians', 'kamandaran', 2, { cost: { food: 400, gold: 300 }, effects: [{ stat: 'cost', kind: ['archer', 'crossbowman', 'arbalester'], res: 'gold', mul: 0 },
    { stat: 'cost', kind: ['archer', 'crossbowman', 'arbalester'], res: 'wood', add: 45 }] });
utech('persians', 'mahouts', 3, { cost: { food: 300, gold: 300 }, effects: [{ stat: 'speed', kind: ['war_elephant', 'elite_war_elephant'], mul: 1.3 }] });

// ---- Saracens: mameluke (a camel, hits with a sabre from 3 tiles)
unique('saracens', 'mameluke', { hp: 80, atk: 9, arm: [1, 0], bonus: { cav: 12 } },
    { food: 600, gold: 500 }, art.mameluke(false), art.mameluke(true),
    { hp: 65, atk: 7, rng: 3, reload: 2.0, arm: [0, 0], speed: 1.4, los: 5,
        cost: { food: 55, gold: 85 }, time: 23, cls: 'cav', ac: ['camel'], dtype: 'melee', shot: 'javelin',
        bonus: { cav: 9 }, radius: 11, bar_h: 40 });
utech('saracens', 'bimaristan', 2, { cost: { wood: 300, gold: 200 }, effects: [{ stat: 'heal', kind: 'monk', mul: 3 }] });
utech('saracens', 'zealotry', 3, { cost: { food: 750, gold: 800 }, effects: [{ stat: 'hp', cls: 'camel', add: 20 }] });

// ---- Turks: janissary (gunpowder)
unique('turks', 'janissary', { hp: 44, atk: 22, arm: [2, 0], acc: 0.65 },
    { food: 850, gold: 750 }, art.janissary(false), art.janissary(true),
    { hp: 35, atk: 17, rng: 8, reload: 3.45, arm: [1, 0], speed: 0.96, los: 10, acc: 0.5,
        cost: { food: 60, gold: 55 }, time: 17, cls: 'arch', ac: ['gunpowder'], shot: 'ball', shot_speed: 420 });
utech('turks', 'sipahi', 2, { cost: { food: 350, gold: 150 }, effects: [{ stat: 'hp', kind: ['cavalry_archer', 'heavy_cavalry_archer'], add: 20 }] });
utech('turks', 'artillery', 3, { cost: { wood: 500, gold: 450 }, effects: [{ stat: 'rng', kind: ['bombard_cannon', 'cannon_galleon'], add: 2 }] });

// ---- Vikings: berserk (heals itself)
unique('vikings', 'berserk', { hp: 62, atk: 14, arm: [2, 1] },
    { food: 1300, gold: 550 }, art.berserk(false), art.berserk(true),
    { hp: 54, atk: 9, rng: 0, reload: 2.0, arm: [0, 1], speed: 1.05, los: 3,
        cost: { food: 65, gold: 25 }, time: 14, cls: 'inf', regen: 40 / 60, bonus: { bld: 2 } });
utech('vikings', 'chieftains', 2, { cost: { food: 400, gold: 300 }, effects: [{ stat: 'bonus:cav', cls: 'inf', add: 5 }] });
utech('vikings', 'berserkergang', 3, { cost: { food: 850, gold: 400 }, effects: [{ stat: 'regen', kind: ['berserk', 'elite_berserk'], mul: 2 }] });

// ---- Goths: huskarl (arrows barely hurt it); "Anarchy" unlocks it in the barracks
unique('goths', 'huskarl', { hp: 70, atk: 12, arm: [0, 8], bonus: { arch: 10, bld: 3 } },
    { food: 1200, gold: 550 }, art.huskarl(false), art.huskarl(true),
    { hp: 60, atk: 10, rng: 0, reload: 2.0, arm: [0, 6], speed: 1.05, los: 3,
        cost: { food: 52, gold: 26 }, time: 16, cls: 'inf', bonus: { arch: 6, bld: 2 } });
add_trains('barracks', 'huskarl');


export function _anarchy(w, p) {
    // p.banned: a set of kinds and (building, unit) tuples (py.TSet); set.discard
    const x = ['barracks', 'huskarl'];
    if (typeof p.banned.discard === 'function') {
        p.banned.discard(x);
    } else {
        for (const v of Array.from(p.banned)) if (py.eq(v, x)) p.banned.delete(v);
    }
}


utech('goths', 'anarchy', 2, { cost: { food: 450, gold: 250 }, on_apply: _anarchy });
utech('goths', 'perfusion', 3, { cost: { wood: 400, gold: 600 }, effects: [{ stat: 'time', kind: [...BUILDINGS['barracks']['trains'],
    'man_at_arms', 'long_swordsman', 'two_handed_swordsman', 'champion', 'pikeman', 'halberdier',
    'elite_huskarl'], mul: 0.5 }] });

// ---- Celts: woad raider (very fast)
unique('celts', 'woad_raider', { hp: 80, atk: 13, arm: [0, 1] },
    { food: 1000, gold: 800 }, art.woad(false), art.woad(true),
    { hp: 65, atk: 8, rng: 0, reload: 2.0, arm: [0, 1], speed: 1.38, los: 5,
        cost: { food: 65, gold: 25 }, time: 10, cls: 'inf', bonus: { bld: 2 } });
utech('celts', 'stronghold', 2, { cost: { food: 250, gold: 200 }, effects: [{ stat: 'reload', kind: ['castle', 'tower', 'guard_tower', 'keep'], mul: 0.8 }] });
utech('celts', 'furor_celtica', 3, { cost: { food: 750, gold: 450 }, effects: [{ stat: 'hp', cls: 'siege', not_cls: ['ship'], mul: 1.4 }] });

// ---- Spanish: conquistador (a mounted gunner)
unique('spanish', 'conquistador', { hp: 70, atk: 18, acc: 0.7 },
    { food: 1200, gold: 600 }, art.conquistador(false), art.conquistador(true),
    { hp: 55, atk: 16, rng: 6, reload: 2.9, arm: [2, 2], speed: 1.3, los: 6, acc: 0.65,
        cost: { food: 60, gold: 70 }, time: 24, cls: 'cav', ac: ['gunpowder'], shot: 'ball', shot_speed: 420,
        radius: 11 });
utech('spanish', 'inquisition', 2, { cost: { food: 100, gold: 300 }, effects: [{ stat: 'conv_speed', kind: 'monk', mul: 1.6 }] });
utech('spanish', 'supremacy', 3, { cost: { food: 400, gold: 250 }, effects: [{ stat: 'atk', kind: 'villager', add: 6 },
    { stat: 'arm_m', kind: 'villager', add: 2 },
    { stat: 'arm_p', kind: 'villager', add: 2 },
    { stat: 'hp', kind: 'villager', add: 40 }] });


// ---- "Nomads": a house with the tech does not take population away when destroyed
export function _house_removed(w, b) {
    const p = b.p;
    if (p != null && b.complete && py.contains(p.techs, 'nomads')) {
        p.pop_keep += py.get(b.d, 'pop', 0);
    }
}


BUILDINGS['house']['on_remove'] = _house_removed;

// in the castle: unique units first, the trebuchet last
export const _tr = BUILDINGS['castle']['trains'];
if (_tr.includes('trebuchet')) {
    py.remove(_tr, 'trebuchet');
    _tr.push('trebuchet');
}
if (!Object.values(UNIQUE).every(c => c.every(k => py.bool(py.get(UNITS[k], 'civ'))))) {
    throw new py.AssertionError('unique units without civ');
}
