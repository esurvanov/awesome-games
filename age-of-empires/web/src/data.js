// port of game/data.py
// Game constants and tables.
//
// The stats of units, buildings and techs follow the rules of the classic historical RTS (values are game seconds,
// tiles, tiles per second). Game time runs 1.7 times faster than real time, like the "normal" speed.
//
// NOTE: data.py ends with `import .content` + `i18n.relabel()`; in JS that is done by web/src/_data_init.js
// (an ES module cannot import content from here without a cycle).
import { math } from '../runtime/py.js';

export const TITLE = 'Chronicles of Kingdoms';       // window title; in the menu - i18n.t('app.title')

// ---- world
export const TILE = 32;                 // logical tile size (the simulation runs on a square grid)
export const MAP_W = 96, MAP_H = 96;    // default size; the real size is World.W / World.H
// map side by player count (DE) - int keys -> Map
export const MAP_SIZES = new Map([[2, 120], [3, 144], [4, 168], [5, 200], [6, 200], [7, 220], [8, 220]]);
export const MAX_PLAYERS = 8;
export const GAME_SPEED = 1.7;          // game seconds per real second

// ---- isometry: a tile on screen is a 64x32 diamond
export const HW = 32, HH = 16;
export const ISO_OX = MAP_H * HW;       // offset so that the left corner of the map is at x=0 (for the default map)
export const ISO_TW = (MAP_W + MAP_H) * HW;
export const ISO_TH = (MAP_W + MAP_H) * HH;

// ---- screen
export const SCREEN_W = 1280, SCREEN_H = 800;
export const TOP_H = 48;
export const PANEL_H = 168;             // height of the command panel
export const VIEW_H = SCREEN_H - TOP_H - PANEL_H;   // the "main" camera window (above the command panel)
export const FPS = 60;

export const RES = ['food', 'wood', 'gold', 'stone'];
export const RES_NAME = Object.fromEntries(RES.map(r => [r, r]));   // captions filled in by i18n.relabel() (res.food...)
export const RES_COLOR = { food: [215, 60, 50], wood: [150, 100, 55], gold: [240, 200, 40], stone: [165, 165, 175] };
export const START_RES = { food: 200, wood: 200, gold: 100, stone: 200 };

// 8 player colors in the order and shades of AoE II DE: blue, red, green, yellow, teal, purple, grey, orange
export const PLAYER_COLORS = [[0, 0, 255], [255, 0, 0], [0, 169, 27], [214, 214, 27],
    [123, 239, 240], [138, 19, 247], [102, 102, 102], [255, 146, 5]];
// The captions below (colors, ages, difficulty) are filled in by i18n.relabel() from the locale (color.*, age.*, diff.*)
export const COLOR_NAMES = ['blue', 'red', 'green', 'yellow', 'cyan', 'purple', 'grey', 'orange'];
export const PLAYER_NAMES = ['you', ...COLOR_NAMES.slice(1)];   // player name by index (0 - the human)
export const GAIA = -1;                                          // owner of "nobody's" objects (nature)
export const AGE_NAMES = ['dark', 'feudal', 'castle', 'imperial'];
export const DIFF_NAMES = ['easy', 'normal', 'hard'];

// ---- resources on the map (gather rate - units per game second); 'name' comes from the locale (node.*)
export const NODE_DEFS = {
    tree: { res: 'wood', amount: 100, rate: 0.39 },
    berries: { res: 'food', amount: 125, rate: 0.31 },
    gold: { res: 'gold', amount: 800, rate: 0.38 },
    stone: { res: 'stone', amount: 350, rate: 0.36 },
};
// animals: hp, food in the carcass, butchering speed (units/s), running speed (tiles/s)
export const ANIMALS = {
    sheep: { hp: 7, food: 100, rate: 0.33, speed: 0.7, radius: 8, los: 2, atk: 0, arm: [0, 0] },
    deer: { hp: 5, food: 140, rate: 0.41, speed: 1.2, radius: 9, los: 3, atk: 0, arm: [0, 0] },
    boar: { hp: 75, food: 340, rate: 0.41, speed: 1.2, radius: 10, los: 4, atk: 8, arm: [0, 1] },
    // predator (AoE2 DE): gives no food, attacks players' units in sight on its own; hunt=False - not game
    wolf: { hp: 25, food: 0, rate: 0.0, speed: 1.2, radius: 8, los: 6, atk: 3, arm: [0, 0], hunt: false, predator: true },
};
export const FARM_RATE = 0.32;
export const FARM_FOOD = 175;
export const CARRY = 10;

// speed - tiles per second; rng, los - tiles; time - training seconds
export const UNITS = {
    villager: { hp: 25, atk: 3, rng: 0, reload: 2.0, arm: [0, 0], speed: 0.8, los: 4,
        cost: { food: 50 }, time: 25, age: 0, cls: 'vil', radius: 7 },
    militia: { hp: 40, atk: 4, rng: 0, reload: 2.0, arm: [0, 1], speed: 0.9, los: 4,
        cost: { food: 60, gold: 20 }, time: 21, age: 0, cls: 'inf', radius: 8 },
    spearman: { hp: 45, atk: 3, rng: 0, reload: 3.0, arm: [0, 0], speed: 1.0, los: 4,
        cost: { food: 35, wood: 25 }, time: 22, age: 1, cls: 'inf', radius: 8, bonus: { cav: 15 } },
    archer: { hp: 30, atk: 4, rng: 4, reload: 2.0, arm: [0, 0], speed: 0.96, los: 6,
        cost: { wood: 25, gold: 45 }, time: 35, age: 1, cls: 'arch', radius: 7 },
    skirmisher: { hp: 30, atk: 2, rng: 4, reload: 3.0, arm: [0, 3], speed: 0.96, los: 6,
        cost: { food: 25, wood: 35 }, time: 22, age: 1, cls: 'arch', radius: 7, bonus: { arch: 3 } },
    scout: { hp: 45, atk: 3, rng: 0, reload: 2.0, arm: [0, 2], speed: 1.55, los: 6,
        cost: { food: 80 }, time: 30, age: 1, cls: 'cav', radius: 11 },
    knight: { hp: 100, atk: 10, rng: 0, reload: 1.8, arm: [2, 2], speed: 1.35, los: 4,
        cost: { food: 60, gold: 75 }, time: 30, age: 2, cls: 'cav', radius: 11 },
    ram: { hp: 175, atk: 2, rng: 0, reload: 5.0, arm: [0, 180], speed: 0.5, los: 3,
        cost: { wood: 160, gold: 75 }, time: 36, age: 2, cls: 'siege', radius: 13, bonus: { bld: 125 } },
};

// size - the square's side in tiles; time - build seconds for one villager
export const BUILDINGS = {
    town_center: { size: 4, hp: 2400, cost: { wood: 275, stone: 100 }, time: 150,
        age: 2, pop: 5, drop: ['food', 'wood', 'gold', 'stone'], trains: ['villager'],
        techs: ['feudal', 'castle', 'imperial', 'loom', 'wheelbarrow'],
        atk: 5, rng: 6, reload: 2.0, los: 8, arm: [3, 5] },
    house: { size: 2, hp: 550, cost: { wood: 25 }, time: 25, age: 0, pop: 5, los: 2 },
    mill: { size: 2, hp: 600, cost: { wood: 100 }, time: 35, age: 0, drop: ['food'],
        techs: ['horse_collar'] },
    lumber_camp: { size: 2, hp: 600, cost: { wood: 100 }, time: 35, age: 0, drop: ['wood'],
        techs: ['double_bit'] },
    mining_camp: { size: 2, hp: 600, cost: { wood: 100 }, time: 35, age: 0,
        drop: ['gold', 'stone'], techs: ['gold_mining'] },
    farm: { size: 3, hp: 480, cost: { wood: 60 }, time: 15, age: 0, walk: true, los: 1 },
    barracks: { size: 3, hp: 1200, cost: { wood: 175 }, time: 50, age: 0,
        trains: ['militia', 'spearman'], los: 5 },
    archery_range: { size: 3, hp: 1500, cost: { wood: 175 }, time: 50, age: 1,
        trains: ['archer', 'skirmisher'], los: 5 },
    stable: { size: 3, hp: 1500, cost: { wood: 175 }, time: 50, age: 1,
        trains: ['scout', 'knight'], los: 5 },
    blacksmith: { size: 3, hp: 2100, cost: { wood: 150 }, time: 40, age: 1,
        techs: ['forging', 'fletching', 'scale_armor'], los: 5 },
    tower: { size: 1, hp: 1020, cost: { wood: 25, stone: 125 }, time: 80,
        age: 1, atk: 5, rng: 8, reload: 2.0, los: 10, arm: [1, 7] },
    siege_workshop: { size: 4, hp: 2100, cost: { wood: 200 }, time: 40, age: 2,
        trains: ['ram'], los: 5 },
    castle: { size: 4, hp: 4800, cost: { stone: 650 }, time: 200, age: 2, pop: 20,
        atk: 11, rng: 8, reload: 2.0, arrows: 4, los: 11, arm: [8, 11] },
};
export const BUILDING_ARMOR = [0, 7];

// ---- modifiers (techs, civilization bonuses, difficulty) - see data.py for the format description.
export const TECHS = {
    feudal: { cost: { food: 500 }, time: 130, age: 0, icon: 'II' },
    castle: { cost: { food: 800, gold: 200 }, time: 160, age: 1, icon: 'III' },
    imperial: { cost: { food: 1000, gold: 800 }, time: 190, age: 2, icon: 'IV',
        effects: [{ stat: 'atk', not_cls: ['vil'], add: 1 }] },
    loom: { cost: { gold: 50 }, time: 25, age: 0, effects: [{ stat: 'hp', kind: 'villager', add: 15 },
        { stat: 'arm_m', kind: 'villager', add: 1 },
        { stat: 'arm_p', kind: 'villager', add: 2 }] },
    wheelbarrow: { cost: { food: 175, wood: 50 }, time: 75, age: 1, effects: [{ stat: 'speed', kind: 'villager', mul: 1.1 },
        { stat: 'carry', kind: 'villager', mul: 1.25 }] },
    double_bit: { cost: { food: 100, wood: 50 }, time: 25, age: 1, effects: [{ stat: 'gather', res: 'wood', mul: 1.2 }] },
    gold_mining: { cost: { food: 100, wood: 75 }, time: 30, age: 1, effects: [{ stat: 'gather', res: 'gold', mul: 1.15 }] },
    horse_collar: { cost: { food: 75, wood: 75 }, time: 20, age: 1, effects: [{ stat: 'farm_food', add: 75 }] },
    forging: { cost: { food: 150 }, time: 50, age: 1, effects: [{ stat: 'atk', cls: ['inf', 'cav'], add: 1 }] },
    fletching: { cost: { food: 100, gold: 50 }, time: 30, age: 1, effects: [{ stat: 'atk', cls: 'arch', add: 1 },
        { stat: 'rng', cls: 'arch', add: 1 }] },
    scale_armor: { cost: { food: 100 }, time: 40, age: 1, effects: [{ stat: 'arm_m', cls: ['inf', 'cav', 'arch'], add: 1 },
        { stat: 'arm_p', cls: ['inf', 'cav', 'arch'], add: 1 }] },
};
// Upgrade lines: a tech with 'upgrade': (old, new) turns all units of the old kind into the new one on completion,
// and buildings train the new kind (Player.current()). 'req' - required techs.

// ---- civilizations: permanent effects, given to a player at the start of a match (Player.set_civ).
// Int-keyed fields ('ages', 'free', 'pop_bonus') are Maps (see game/content/civs.py).
export const CIVS = {
    default: { effects: [] },
};
// World hooks for content: 'init' - fn(world) after map generation; 'tick' - fn(world, dt) every step.
export const WORLD_HOOKS = { init: [], tick: [] };
export const AGE_TECHS = ['feudal', 'castle', 'imperial'];
export const AGE_REQ = {
    feudal: [new Set(['mill', 'lumber_camp', 'mining_camp', 'barracks']), 2],
    castle: [new Set(['archery_range', 'stable', 'blacksmith']), 2],
    imperial: [new Set(['siege_workshop', 'castle']), 1],
};

export const BUILD_MENU = ['house', 'mill', 'lumber_camp', 'mining_camp', 'farm',
    'barracks', 'archery_range', 'stable', 'blacksmith', 'tower',
    'siege_workshop', 'castle', 'town_center'];
export const HOTKEYS = 'QWERTASDFGZXCVB';

export const DIRS = [[1, 0, 1.0], [-1, 0, 1.0], [0, 1, 1.0], [0, -1, 1.0],
    [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];


// ---- utilities
export const _SHADE = new Map();

/** Color c (RGB[A]) shifted in brightness by d; the result is an RGB array (cached - don't mutate it). */
export function shade(c, d) {
    const key = c.length > 3 ? `${c[0]},${c[1]},${c[2]},${c[3]}|${d}` : `${c[0]},${c[1]},${c[2]}|${d}`;
    let r = _SHADE.get(key);
    if (r !== undefined) return r;
    r = [Math.max(0, Math.min(255, c[0] + d)), Math.max(0, Math.min(255, c[1] + d)), Math.max(0, Math.min(255, c[2] + d))];
    _SHADE.set(key, r);
    if (_SHADE.size > 20000) _SHADE.clear();
    return r;
}

export function dist_point_rect(px, py, rx, ry, rw, rh) {
    // the same as hypot(max(rx - px, 0, px - rx - rw), max(...)), but without max() - a hot path
    let dx = rx - px;
    if (dx < 0) {
        dx = px - rx - rw;
        if (dx < 0) dx = 0;
    }
    let dy = ry - py;
    if (dy < 0) {
        dy = py - ry - rh;
        if (dy < 0) dy = 0;
    }
    if (!dx) return dy;
    if (!dy) return dx;
    return math.hypot(dx, dy);
}

export function cost_add(a, b) {
    const out = {};
    for (const k of RES) out[k] = (Object.hasOwn(a, k) ? a[k] : 0) + (Object.hasOwn(b, k) ? b[k] : 0);
    return out;
}

/** World logical pixels -> pixels of the isometric map (ox = H * HW for a map of height H);
 * z - lift above the plane in screen pixels (ground height: World.z_at, game/terrain.py). */
export function to_iso(x, y, ox = ISO_OX, z = 0.0) {
    return [x - y + ox, (x + y) * 0.5 - z];
}

export function from_iso(ix, iy, ox = ISO_OX) {
    ix -= ox;
    return [(ix + 2 * iy) * 0.5, (2 * iy - ix) * 0.5];
}

export function as_tuple(v) {
    return Array.isArray(v) ? v : [v];
}

// ---- content: the game/content/* modules append to the tables above; see web/src/_data_init.js.
