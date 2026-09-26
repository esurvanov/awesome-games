// port of game/content/naval.py
// Navy: the dock, ships, fish and naval techs (values as in the classic historical RTS).
// Ship logic is in naval.js (class Ship: movement only on water, fishing, transport, combat), graphics in
// naval_gfx.js. A unit with 'naval': True is created as a Ship (World.spawn -> naval.spawn_ship).
// Extra entry fields: unit - 'carry', 'cargo', 'fisher', 'fire', 'blast', 'minrng', 'siege', 'bar';
// building - 'water': True; resource - 'ship_rate', 'sprite' / 'anim' / 'anchor' / 'mm'. All ships have cls='ship'.
import { modules } from '../../runtime/py.js';
import { add_unit, add_building, add_tech } from './__init__.js';
import { NODE_DEFS } from '../data.js';


export function _art(kind) {
    return function draw(surf, k_, color, x, y, face, anim, swing, k, carry_res, moving) {
        const naval_gfx = modules.naval_gfx;
        naval_gfx.draw_ship(surf, kind, color, x, y, face, anim, swing, k, carry_res, moving);
    };
}


export function _dock_art(p, surf, color, size) {
    const naval_gfx = modules.naval_gfx;
    naval_gfx.draw_dock(p, surf, color, size);
}


export function _fish_sprite(kind) {
    return function make(var_) {
        const naval_gfx = modules.naval_gfx;
        return naval_gfx.make_fish(kind, var_);
    };
}


export function _fish_anim(scr, n, sx, sy, t) {
    const naval_gfx = modules.naval_gfx;
    naval_gfx.fish_ripple(scr, n, sx, sy, t);
}


// ---- fish: near the shore they are caught by both villagers (from land) and fishing ships; deep-water fish only by ships
NODE_DEFS['shore_fish'] = { res: 'food', amount: 200, rate: 0.43, ship_rate: 0.49, water: true,
    sprite: _fish_sprite('shore_fish'), anim: _fish_anim, anchor: 'center', mm: [150, 210, 235] };
NODE_DEFS['deep_fish'] = { res: 'food', amount: 225, rate: 0.0, ship_rate: 0.49, water: true,
    deep: true, sprite: _fish_sprite('deep_fish'), anim: _fish_anim, anchor: 'center',
    mm: [200, 235, 250] };

// ---- ships (speed - tiles per second, time - seconds)
export const SHIP = { cls: 'ship', naval: true, rng: 0, reload: 2.0 };

add_unit('fishing_ship', { ...SHIP, hp: 60, atk: 0, arm: [0, 4], speed: 1.26, los: 5,
    cost: { wood: 75 }, time: 40, age: 0, radius: 13, carry: 15, fisher: true, bar: 30,
    art: _art('fishing_ship') });
add_unit('transport_ship', { ...{ ...SHIP, rng: 0 }, hp: 100, atk: 0, arm: [4, 8], speed: 1.45, los: 5,
    cost: { wood: 125 }, time: 46, age: 0, radius: 16, cargo: 5, bar: 32,
    art: _art('transport_ship') });

add_unit('galley', { ...{ ...SHIP, rng: 5, reload: 3.0 }, hp: 120, atk: 6, arm: [0, 6], speed: 1.43, los: 7,
    cost: { wood: 90, gold: 30 }, time: 60, age: 1, radius: 15, bonus: { ship: 6 }, bar: 40,
    art: _art('galley') });
add_unit('war_galley', { ...{ ...SHIP, rng: 6, reload: 3.0 }, hp: 135, atk: 7, arm: [0, 6], speed: 1.43,
    los: 8, cost: { wood: 90, gold: 30 }, time: 36, age: 2, radius: 16, bonus: { ship: 7 }, bar: 44,
    art: _art('war_galley') });
add_unit('galleon', { ...{ ...SHIP, rng: 7, reload: 3.0 }, hp: 165, atk: 8, arm: [0, 8], speed: 1.43, los: 9,
    cost: { wood: 90, gold: 30 }, time: 36, age: 3, radius: 17, bonus: { ship: 8 }, bar: 50,
    art: _art('galleon') });

add_unit('fire_galley', { ...{ ...SHIP, rng: 2.5, reload: 0.25 }, hp: 100, atk: 1, arm: [0, 6],
    speed: 1.30, los: 5, cost: { wood: 75, gold: 45 }, time: 65, age: 1, radius: 15, fire: true,
    bonus: { ship: 2, bld: 1 }, bar: 38, art: _art('fire_galley') });
add_unit('fire_ship', { ...{ ...SHIP, rng: 2.5, reload: 0.25 }, hp: 120, atk: 2, arm: [0, 6], speed: 1.35,
    los: 6, cost: { wood: 75, gold: 45 }, time: 36, age: 2, radius: 16, fire: true,
    bonus: { ship: 3, bld: 1 }, bar: 40, art: _art('fire_ship') });
add_unit('fast_fire_ship', { ...{ ...SHIP, rng: 2.5, reload: 0.25 }, hp: 140, atk: 3, arm: [0, 8],
    speed: 1.43, los: 6, cost: { wood: 75, gold: 45 }, time: 36, age: 3, radius: 16, fire: true,
    bonus: { ship: 4, bld: 2 }, bar: 40, art: _art('fast_fire_ship') });

add_unit('demolition_ship', { ...SHIP, hp: 60, atk: 110, arm: [0, 3], speed: 1.6, los: 6,
    cost: { wood: 70, gold: 50 }, time: 31, age: 2, radius: 14, blast: 2.5, bonus: { bld: 180 }, bar: 30,
    art: _art('demolition_ship') });
add_unit('heavy_demolition_ship', { ...SHIP, hp: 70, atk: 140, arm: [0, 5], speed: 1.6, los: 6,
    cost: { wood: 70, gold: 50 }, time: 31, age: 3, radius: 15, blast: 2.5, bonus: { bld: 180 }, bar: 30,
    art: _art('heavy_demolition_ship') });

// (the classic also requires "Chemistry"; there is no such tech yet - it opens with the Imperial Age)
add_unit('cannon_galleon', { ...{ ...SHIP, rng: 13, reload: 10.0 }, hp: 120, atk: 35, arm: [0, 6],
    speed: 1.1, los: 15, cost: { wood: 200, gold: 150 }, time: 46, age: 3, radius: 18, minrng: 3, siege: true,
    bonus: { bld: 40 }, bar: 50, art: _art('cannon_galleon') });

// ---- dock
add_building('dock', undefined, { size: 3, hp: 1800, cost: { wood: 150 }, time: 35, age: 0, water: true, los: 6,
    drop: ['food'], arm: [0, 7], art: _dock_art, art_h: 90,
    trains: ['fishing_ship', 'transport_ship', 'galley', 'fire_galley', 'demolition_ship', 'cannon_galleon'] });

// ---- dock techs
export const SHIPS = 'ship';
add_tech('gillnets', 'dock', { cost: { food: 150, wood: 200 }, time: 40, age: 1, effects: [{ stat: 'gather', kind: 'fishing_ship', mul: 1.25 }] });
add_tech('war_galley', 'dock', { cost: { food: 230, gold: 100 }, time: 50, age: 2,
    upgrade: ['galley', 'war_galley'] });
add_tech('fire_ship', 'dock', { cost: { food: 230, gold: 100 }, time: 50, age: 2,
    upgrade: ['fire_galley', 'fire_ship'] });
add_tech('careening', 'dock', { cost: { food: 250, gold: 150 }, time: 60, age: 2, effects: [{ stat: 'arm_p', cls: SHIPS, add: 1 }, { stat: 'cargo', kind: 'transport_ship', add: 5 }] });
add_tech('dry_dock', 'dock', { cost: { food: 600, gold: 400 }, time: 60, age: 2, effects: [{ stat: 'speed', cls: SHIPS, mul: 1.15 }, { stat: 'cargo', kind: 'transport_ship', add: 10 }] });
add_tech('galleon', 'dock', { cost: { food: 400, wood: 315 }, time: 65, age: 3, req: 'war_galley',
    upgrade: ['war_galley', 'galleon'] });
add_tech('fast_fire_ship', 'dock', { cost: { wood: 280, gold: 250 }, time: 50, age: 3,
    req: 'fire_ship', upgrade: ['fire_ship', 'fast_fire_ship'] });
add_tech('heavy_demolition_ship', 'dock', { cost: { wood: 200, gold: 300 }, time: 50,
    age: 3, upgrade: ['demolition_ship', 'heavy_demolition_ship'] });
add_tech('shipwright', 'dock', { cost: { food: 1000, gold: 300 }, time: 60, age: 3, effects: [{ stat: 'cost', cls: SHIPS, res: 'wood', mul: 0.8 }] });
