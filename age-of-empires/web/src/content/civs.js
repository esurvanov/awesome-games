// port of game/content/civs.py
// Civilizations: bonuses (modifiers), team bonuses, the tech tree (unavailable items), starting differences,
// bonuses per age, free techs, coats of arms, interface captions and AI preferences.
//
// Values follow Definitive Edition. Field format - data.py above CIVS. Unique units and techs - civ_units.js;
// coat-of-arms graphics - civ_art.js; interface - civ_ui.js.
// Bonus captions: 'bonus_icons' - [icon], an icon is: ['u', unit] | ['b', building] | ['t', tech] | ['r', resource];
// the texts come from the locale (i18n.relabel assembles 'bonus' = [[icon, text]] and 'team_desc').
// 'ai' - multipliers of the AI's unit choice weights by base line (see ai_army.ArmyPlanner.weights).
//
// Int-keyed dicts ('ages', 'free', 'pop_bonus' and step()'s levels/ages) are Maps (PORTING.md §4).
import * as py from '../../runtime/py.js';
import { modules } from '../../runtime/py.js';
import { CIVS, TECHS, WORLD_HOOKS, AGE_TECHS, TILE } from '../data.js';   // TILE: function-local import in Python

export const KNIGHTS = ['knight', 'cavalier', 'paladin'];
export const LIGHT = ['scout', 'light_cavalry', 'hussar'];
export const STABLE = [...LIGHT, ...KNIGHTS, 'camel_rider', 'heavy_camel_rider'];
export const RANGE = ['archer', 'crossbowman', 'arbalester', 'skirmisher', 'elite_skirmisher', 'cavalry_archer',
    'heavy_cavalry_archer', 'hand_cannoneer'];
export const BARRACKS = ['militia', 'man_at_arms', 'long_swordsman', 'two_handed_swordsman', 'champion', 'spearman', 'pikeman',
    'halberdier', 'huskarl', 'elite_huskarl'];
export const WORKSHOP = ['ram', 'capped_ram', 'siege_ram', 'mangonel', 'onager', 'siege_onager', 'scorpion', 'heavy_scorpion',
    'bombard_cannon'];
export const TC_WORK = ['villager', 'loom', 'wheelbarrow', 'hand_cart', 'town_watch', 'town_patrol', ...AGE_TECHS];
export const DOCK_WORK = ['fishing_ship', 'transport_ship', 'galley', 'war_galley', 'galleon', 'fire_galley', 'fire_ship',
    'fast_fire_ship', 'demolition_ship', 'heavy_demolition_ship', 'cannon_galleon', 'gillnets',
    'careening', 'dry_dock', 'shipwright'];
export const WARSHIPS = ['galley', 'war_galley', 'galleon', 'fire_galley', 'fire_ship', 'fast_fire_ship', 'demolition_ship',
    'heavy_demolition_ship', 'cannon_galleon'];
export const SMITH = ['forging', 'iron_casting', 'blast_furnace', 'fletching', 'bodkin_arrow', 'bracer', 'scale_armor',
    'chain_mail', 'plate_mail', 'scale_barding', 'chain_barding', 'plate_barding', 'padded_archer_armor',
    'leather_archer_armor', 'ring_archer_armor'];
export const COUNTERS = ['spearman', 'pikeman', 'halberdier', 'skirmisher', 'elite_skirmisher', 'camel_rider', 'heavy_camel_rider'];
export const FOOT_ARCH = { cls: 'foot_arch' };
export const INF = { cls: 'inf' };


export function E(stat, kw = {}) {
    kw['stat'] = stat;
    return kw;
}


/** A "per age" bonus from the final multipliers levels = {age: total} (a Map): each age adds the ratio
 * to the previous level (effects only accumulate). Returns [effects from the start, Map{age: [effects]}]. */
export function step(stat, levels, f = {}) {
    const start = [], ages = new Map();
    let prev = 1.0;
    for (const age of py.sorted(Array.from(levels.keys()))) {
        const m = levels.get(age) / prev;
        prev = levels.get(age);
        const e = E(stat, { mul: m, ...f });
        if (age === 0) {
            start.push(e);
        } else {
            py.setdefault(ages, age, []).push(e);
        }
    }
    return [start, ages];
}


export function merge(...dicts) {
    const out = {};
    for (const d of dicts) {
        for (const [k, v] of py.items(d)) py.extend(py.setdefault(out, k, []), v);
    }
    return out;
}


export function civ(key, emblem, effects, team, bonus_icons, team_icon, disabled = [], ai = null, extra = {}) {
    CIVS[key] = { emblem: emblem, effects: effects, team: team, bonus_icons: bonus_icons, team_icon: team_icon,
        disabled: Array.from(disabled), ai: py.bool(ai) ? ai : {}, ...extra };
}


export const GOLD = [240, 205, 80], SILVER = [236, 234, 226], BLACK = [30, 28, 30];

// civ(key, emblem, effects, team, bonus_icons, team_icon, disabled, ai, **extra)
// ---- Franks: cavalry
civ('franks', { field: [[38, 72, 168], [38, 72, 168]], charge: 'lily3', metal: GOLD },
    [E('cost', { kind: 'castle', mul: 0.85 }),
        E('cost', { kind: ['horse_collar', 'heavy_plow', 'crop_rotation'], mul: 0 }),
        E('gather', { src: 'berries', mul: 1.15 }),
        E('hp', { cls: 'cav', not_cls: ['arch'], mul: 1.2 })],
    [E('los', { kind: KNIGHTS, add: 2 })],
    [['u', 'knight'], ['b', 'castle'],
        ['t', 'heavy_plow'], ['r', 'food']],
    ['u', 'knight'],
    ['arbalester', 'thumb_ring', 'parthian_tactics', 'camel_rider', 'heavy_camel_rider'],
    { knight: 1.9, scout: 1.2, archer: 0.6, cavalry_archer: 0.6, throwing_axeman: 2.2 });

// ---- Britons: archers
civ('britons', { field: [[190, 30, 36], [190, 30, 36]], div: 'bordure', charge: 'crown', metal: GOLD },
    [E('gather', { src: 'hunt', mul: 1.25 })],
    [E('time', { kind: [...RANGE, 'longbowman', 'elite_longbowman'], mul: 1 / 1.2 })],
    [['u', 'archer'], ['b', 'town_center'],
        ['r', 'food']],
    ['b', 'archery_range'],
    ['paladin', 'camel_rider', 'heavy_camel_rider', 'bombard_cannon', 'parthian_tactics'],
    { archer: 2.2, skirmisher: 1.0, knight: 0.6, cavalry_archer: 0.4, longbowman: 3.0 },
    { ages: new Map([[2, [E('rng', { cls: 'foot_arch', not_cls: ['gunpowder'], add: 1 }),
        E('cost', { kind: 'town_center', res: 'wood', mul: 0.5 })]],
    [3, [E('rng', { cls: 'foot_arch', not_cls: ['gunpowder'], add: 1 })]]]) });

// ---- Mongols: cavalry archers
civ('mongols', { field: [[70, 132, 205], [70, 132, 205]], div: 'chief', charge: 'bow', metal: GOLD },
    [E('reload', { cls: 'cav_arch', mul: 1 / 1.25 }),
        E('hp', { kind: ['light_cavalry', 'hussar'], mul: 1.3 }),
        E('gather', { src: 'hunt', mul: 1.4 })],
    [E('los', { kind: LIGHT, add: 2 })],
    [['u', 'cavalry_archer'],
        ['u', 'light_cavalry'], ['r', 'food']],
    ['u', 'scout'],
    ['paladin', 'halberdier', 'keep', 'bombard_cannon'],
    { cavalry_archer: 3.0, scout: 1.6, archer: 0.6, mangonel: 1.5, militia: 0.5, mangudai: 3.2 });

// ---- Byzantines: defense and counter units
export let _s, _a;
[_s, _a] = step('hp', new Map([[0, 1.1], [1, 1.2], [2, 1.3], [3, 1.4]]), { cls: 'bld' });
civ('byzantines', { field: [[104, 36, 110], [104, 36, 110]], charge: 'eagle2', metal: GOLD },
    [..._s, E('cost', { kind: COUNTERS, mul: 0.75 }), E('cost', { kind: 'imperial', mul: 0.67 }),
        E('atk', { kind: ['fire_galley', 'fire_ship', 'fast_fire_ship'], mul: 1.2 })],
    [E('heal', { kind: 'monk', mul: 2 })],
    [['b', 'castle'], ['u', 'spearman'],
        ['t', 'imperial']],
    ['u', 'monk'],
    ['blast_furnace', 'siege_onager', 'parthian_tactics'],
    { spearman: 1.7, skirmisher: 1.7, camel_rider: 1.7, knight: 0.8, monk: 1.5, cataphract: 3.0 },
    { ages: _a, refresh_hp: true });

// ---- Teutons: infantry and armor
civ('teutons', { field: [[238, 236, 228], [238, 236, 228]], charge: 'cross', metal: BLACK },
    [E('cost', { kind: 'farm', mul: 0.6 }), E('cost', { kind: 'murder_holes', mul: 0 })],
    [E('conv_resist', { mul: 1.5 })],
    [['b', 'farm'], ['u', 'long_swordsman'],
        ['t', 'murder_holes']],
    ['u', 'monk'],
    ['hussar', 'thumb_ring', 'parthian_tactics', 'camel_rider', 'heavy_camel_rider', 'husbandry',
        'heavy_cavalry_archer'],
    { militia: 1.7, knight: 1.3, spearman: 1.2, archer: 0.6, cavalry_archer: 0.3, scout: 0.6,
        teutonic_knight: 3.0 },
    { ages: new Map([[2, [E('arm_m', { cls: ['inf', 'cav'], not_cls: ['arch'], add: 1 })]],
        [3, [E('arm_m', { cls: ['inf', 'cav'], not_cls: ['arch'], add: 1 })]]]) });

// ---- Japanese: infantry
civ('japanese', { field: [[238, 236, 228], [238, 236, 228]], charge: 'mon', metal: [200, 30, 40] },
    [E('cost', { kind: ['mill', 'lumber_camp', 'mining_camp'], mul: 0.5 }),
        E('hp', { kind: 'fishing_ship', mul: 2 }), E('arm_p', { kind: 'fishing_ship', add: 2 })],
    [E('los', { kind: ['galley', 'war_galley', 'galleon'], mul: 1.5 })],
    [['u', 'man_at_arms'], ['b', 'lumber_camp'],
        ['u', 'fishing_ship']],
    ['u', 'galley'],
    ['hussar', 'paladin', 'camel_rider', 'heavy_camel_rider', 'siege_ram'],
    { militia: 1.5, archer: 1.7, knight: 0.7, samurai: 2.6 },
    { ages: new Map([[1, [E('reload', { cls: 'inf', mul: 1 / 1.33 })]]]) });

// ---- Chinese: ranged units and techs
[_s, _a] = step('cost', new Map([[1, 0.9], [2, 0.85], [3, 0.8]]), { cls: 'tech' });
civ('chinese', { field: [[200, 36, 30], [200, 36, 30]], charge: 'dragon', metal: GOLD },
    [E('hp', { kind: ['demolition_ship', 'heavy_demolition_ship'], mul: 1.5 })],
    [E('farm_food', { mul: 1.1 })],
    [['u', 'villager'], ['t', 'feudal'],
        ['b', 'town_center']],
    ['b', 'farm'],
    ['paladin', 'heavy_camel_rider', 'bombard_cannon', 'plate_barding'],
    { archer: 1.8, skirmisher: 1.3, scorpion: 1.5, chu_ko_nu: 3.0 },
    { ages: _a, start: { food: -200, wood: -50 }, start_units: { villager: 3 }, pop_extra: { town_center: 10 } });

// ---- Persians: economy and cavalry
[_s, _a] = step('time', new Map([[1, 1 / 1.10], [2, 1 / 1.15], [3, 1 / 1.20]]), { kind: [...TC_WORK, ...DOCK_WORK] });
civ('persians', { field: [[34, 118, 70], [225, 185, 70]], div: 'fess', charge: 'sun', metal: GOLD },
    [E('hp', { kind: ['town_center', 'dock'], mul: 2 })],
    [E('bonus:arch', { kind: KNIGHTS, add: 2 })],
    [['r', 'wood'], ['b', 'town_center'],
        ['u', 'villager']],
    ['u', 'knight'],
    ['champion', 'siege_onager', 'siege_ram', 'plate_mail', 'keep'],
    { knight: 1.9, camel_rider: 1.2, scout: 1.2, militia: 0.5, war_elephant: 2.4 },
    { ages: _a, start: { food: 50, wood: 50 } });

// ---- Saracens: camels and the market
civ('saracens', { field: [[30, 110, 60], [30, 110, 60]], charge: 'swords', metal: SILVER },
    [E('market_fee', { add: -0.25 }), E('hp', { cls: 'camel', add: 10 }),
        E('reload', { kind: ['galley', 'war_galley', 'galleon'], mul: 0.8 })],
    [E('bonus:bld', { cls: 'foot_arch', add: 2 })],
    [['b', 'market'], ['u', 'camel_rider'],
        ['u', 'galley']],
    ['u', 'archer'],
    ['paladin', 'halberdier', 'plate_barding'],
    { camel_rider: 2.2, archer: 1.5, knight: 0.8, monk: 1.3, mameluke: 2.6 });

// ---- Turks: gunpowder
civ('turks', { field: [[196, 28, 36], [196, 28, 36]], charge: 'crescent_star', metal: SILVER },
    [E('hp', { cls: 'gunpowder', mul: 1.25 }), E('gather', { src: 'gold', mul: 1.2 }),
        E('cost', { kind: ['light_cavalry', 'hussar'], mul: 0 })],
    [E('time', { cls: 'gunpowder', mul: 0.8 })],
    [['u', 'hand_cannoneer'], ['r', 'gold'],
        ['t', 'chemistry'], ['u', 'hussar']],
    ['u', 'hand_cannoneer'],
    ['pikeman', 'halberdier', 'elite_skirmisher', 'arbalester', 'paladin'],
    { hand_cannoneer: 2.6, scout: 1.5, cavalry_archer: 1.3, bombard_cannon: 2.0, spearman: 0.2,
        skirmisher: 0.3, archer: 0.7, janissary: 3.0 },
    { free: new Map([[3, ['chemistry']]]) });

// ---- Vikings: infantry and navy
[_s, _a] = step('hp', new Map([[1, 1.1], [2, 1.15], [3, 1.2]]), { cls: 'inf' });
civ('vikings', { field: [[232, 190, 60], [232, 190, 60]], div: 'bend', charge: 'raven', metal: BLACK },
    [E('cost', { kind: WARSHIPS, mul: 0.85 })],
    [E('cost', { kind: 'dock', mul: 0.85 })],
    [['u', 'militia'], ['t', 'wheelbarrow'],
        ['u', 'galley']],
    ['b', 'dock'],
    ['paladin', 'hussar', 'camel_rider', 'heavy_camel_rider', 'fire_galley', 'fire_ship', 'fast_fire_ship'],
    { militia: 2.0, spearman: 1.2, archer: 1.0, knight: 0.6, berserk: 2.6 },
    { ages: _a, refresh_hp: true, free: new Map([[1, ['wheelbarrow']], [2, ['hand_cart']]]) });

// ---- Goths: infantry hordes
[_s, _a] = step('cost', new Map([[0, 0.8], [1, 0.75], [2, 0.7], [3, 0.65]]), { cls: 'inf' });
civ('goths', { field: [[34, 32, 38], [34, 32, 38]], charge: 'eagle', metal: GOLD },
    [..._s, E('bonus:bld', { cls: 'inf', add: 1 })],
    [E('time', { kind: BARRACKS, mul: 1 / 1.2 })],
    [['u', 'militia'], ['b', 'castle'],
        ['b', 'house']],
    ['b', 'barracks'],
    ['plate_mail', 'guard_tower', 'keep', 'siege_onager', 'ring_archer_armor'],
    { militia: 2.6, spearman: 1.6, skirmisher: 1.2, archer: 0.5, knight: 0.5, huskarl: 3.0 },
    { ages: _a, pop_bonus: new Map([[3, 10]]), banned_at: [['barracks', 'huskarl']] });

// ---- Celts: infantry and siege
civ('celts', { field: [[40, 120, 60], [40, 120, 60]], div: 'bordure', charge: 'triskele', metal: SILVER },
    [E('gather', { src: 'tree', mul: 1.15 }), E('reload', { cls: 'siege', not_cls: ['ship'], mul: 0.8 })],
    [E('time', { kind: WORKSHOP, mul: 1 / 1.2 })],
    [['u', 'militia'], ['r', 'wood'],
        ['u', 'mangonel']],
    ['b', 'siege_workshop'],
    ['heavy_cavalry_archer', 'camel_rider', 'heavy_camel_rider', 'hand_cannoneer', 'arbalester',
        'thumb_ring'],
    { militia: 2.2, spearman: 1.3, mangonel: 2.0, ram: 1.5, archer: 0.5, woad_raider: 2.6 },
    { ages: new Map([[1, [E('speed', { cls: 'inf', mul: 1.15 })]]]) });

// ---- Spanish: builders and gunpowder
civ('spanish', { field: [[225, 185, 60], [190, 30, 36]], div: 'quarterly', charge: 'tower',
    metal: [236, 234, 226] },
    [E('build', { kind: 'villager', mul: 1.3 }), E('cost', { kind: SMITH, res: 'gold', mul: 0 }),
        E('reload', { cls: 'gunpowder', mul: 1 / 1.18 })],
    [E('trade', { mul: 1.25 })],
    [['u', 'villager'], ['b', 'blacksmith'],
        ['u', 'hand_cannoneer']],
    ['u', 'trade_cart'],
    ['camel_rider', 'heavy_camel_rider', 'heavy_cavalry_archer', 'parthian_tactics', 'siege_onager'],
    { knight: 1.7, hand_cannoneer: 1.5, militia: 1.2, conquistador: 2.6 });

export const PLAYABLE = Object.keys(CIVS).filter(k => k !== 'default');


// ============================================================ mechanics
/** Team bonuses - for all allies (and yourself); identical civilizations in a team do not stack.
 * A civilization's starting units are placed at the town center. */
export function team_bonus(w) {
    const { Unit } = modules.world;
    for (const p of w.players) {
        const civs = new Set();
        for (const q of w.players) if (w.allied(p.id, q.id)) civs.add(q.civ);
        for (const c of py.sorted(Array.from(civs))) {
            p.add_effects(py.get(py.get(CIVS, c, {}), 'team', []));
        }
        w.refresh_hp(p);
        const extra = py.get(py.get(CIVS, p.civ, {}), 'start_units', {});
        if (py.bool(extra)) {
            let tc = null;
            for (const b of w.buildings) {
                if (b.owner === p.id && b.kind === 'town_center') { tc = b; break; }
            }
            if (tc == null) continue;
            const cx = tc.tx + Math.floor(tc.w / 2), cy = tc.ty + Math.floor(tc.h / 2);
            for (const [kind, n] of py.items(extra)) {
                for (let i = 0; i < n; i++) {
                    const [tx, ty] = w.nearest_free_tile(cx + (i % 3) - 1, cy + Math.floor(tc.h / 2) + 1 + Math.floor(i / 3));
                    w.units.push(new Unit(kind, p.id, (tx + 0.5) * TILE, (ty + 0.5) * TILE, w));
                }
            }
        }
    }
}


WORLD_HOOKS['init'].push(team_bonus);


/** A new age: this age's effects, free techs, a population increase. */
export function on_age(w, p) {
    const c = py.get(CIVS, p.civ, {});
    const eff = py.get(py.get(c, 'ages', new Map()), p.age);
    if (py.bool(eff)) {
        p.add_effects(eff);
        if (py.get(c, 'refresh_hp') || eff.some(e => e['stat'] === 'hp')) {
            w.refresh_hp(p);
        }
    }
    p.pop_bonus += py.get(py.get(c, 'pop_bonus', new Map()), p.age, 0);
    for (const t of py.get(py.get(c, 'free', new Map()), p.age, [])) {
        if (Object.hasOwn(TECHS, t) && !py.contains(p.techs, t) && p.allows(t)) {
            for (const b of w.buildings) {          // already in the queue - refund the cost
                if (b.owner === p.id && py.contains(b.queue, ['tech', t])) {
                    if (py.eq(b.queue[0], ['tech', t])) {
                        b.qt = 0.0;
                    }
                    py.remove(b.queue, ['tech', t]);
                    p.refund(p.cost_of('tech', t));
                }
            }
            p.researching.delete(t);
            w.apply_tech(p, t);
        }
    }
}


export function _chain(prev) {
    return function f(w, p) {
        if (prev) prev(w, p);
        on_age(w, p);
    };
}


for (const _t of AGE_TECHS) {
    TECHS[_t]['on_apply'] = _chain(py.get(TECHS[_t], 'on_apply'));
}
