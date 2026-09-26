// port of game/content/towers.py
// The tower line: Watch -> Guard (Castle Age) -> Keep (Imperial Age).
// The upgrade turns all of the player's existing towers (the HP share is kept), new ones are built already
// upgraded (World.place_building takes the kind with Player.alias in mind). Researched at the university.
// Arrowslits remove the minimum range of towers and the castle; Murder Holes - +attack for towers.
import { modules } from '../../runtime/py.js';
import { add_building, add_tech } from './__init__.js';
import { at_university } from './_uni.js';
import { BUILDINGS } from '../data.js';

export const FOOT = ['vil', 'inf', 'arch'];
export const TOWERS = ['tower', 'guard_tower', 'keep'];


export function _upgrade(old, new_) {
    return function apply(w, p) {
        const { upgrade_buildings } = modules.defense;
        upgrade_buildings(w, p, old, new_);
    };
}


// IsoPainter: box(x0, y0, x1, y1, h, color, z0=0.0, top=True, tex=None), window_l(xm, y1, z, w=0.12, h=7),
// banner_l(xm, y1, z, color, w=0.18, h=12), crenels(x0, y0, x1, y1, z, color, step=0.32, sz=0.14, h=5),
// hip(x0, y0, x1, y1, z, rh, color, ov=0.1), flag(x, y, z, color, h=18)
export function _tower_art(level) {
    return function art(p, surf, color, size) {
        const gfx = modules.gfx;
        const stone = level === 1 ? gfx.STONE : [170, 166, 158];
        const top = level === 1 ? 88 : 100;
        const w0 = level === 1 ? 0.22 : 0.14;
        p.box(w0, w0, 1 - w0, 1 - w0, top, stone, undefined, true, 'stone');
        // cornice belt
        p.box(w0 - 0.07, w0 - 0.07, 1 - w0 + 0.07, 1 - w0 + 0.07, 7, gfx.shade(stone, 10), top - 26);
        for (const z of [top * 0.45, top * 0.7]) {
            p.window_l(0.5, 1 - w0, z, 0.1, 9);
            p.window_r(1 - w0, 0.5, z, 0.1, 9);
        }
        p.door(0.5, 1 - w0, 0.24, 13);
        p.banner_l(0.5, 1 - w0, top - 30, color, 0.2, 14);
        if (level === 1) {
            // guard: a hip roof over the battlements
            p.box(0.1, 0.1, 0.9, 0.9, 6, gfx.shade(stone, 8), top);
            p.crenels(0.1, 0.1, 0.9, 0.9, top + 6, stone, 0.25, 0.12);
            p.hip(0.2, 0.2, 0.8, 0.8, top + 12, 26, gfx.ROOF_SLATE, 0.04);
            p.flag(0.5, 0.5, top + 38, color, 16);
        } else {
            // keep: a wide platform, battlements, corner turrets and a pavilion
            p.box(0.02, 0.02, 0.98, 0.98, 9, gfx.shade(stone, 8), top);
            p.crenels(0.02, 0.02, 0.98, 0.98, top + 9, stone, 0.24, 0.12, 7);
            for (const [cx, cy] of [[0.02, 0.02], [0.78, 0.02], [0.02, 0.78]]) {
                p.box(cx, cy, cx + 0.2, cy + 0.2, 16, stone, top + 9);
            }
            p.box(0.3, 0.3, 0.7, 0.7, 22, stone, top + 9, undefined, 'stone');
            p.hip(0.28, 0.28, 0.72, 0.72, top + 31, 20, gfx.ROOF_SLATE, 0.03);
            p.box(0.78, 0.78, 0.98, 0.98, 16, stone, top + 9);
            p.flag(0.5, 0.5, top + 51, color, 18);
        }
    };
}


export const base = BUILDINGS['tower'];
add_building('guard_tower', false, { ...base, hp: 1500, atk: 6, arm: [1, 8],
    art: _tower_art(1), art_h: 150, garrison: 5, garrison_cls: FOOT,
    min_rng: 1 });
add_building('keep', false, { ...base, hp: 2250, atk: 7, arm: [2, 9],
    art: _tower_art(2), art_h: 175, garrison: 5, garrison_cls: FOOT,
    min_rng: 1 });

add_tech('guard_tower', null, { cost: { food: 100, wood: 250 }, time: 30, age: 2, on_apply: _upgrade('tower', 'guard_tower') });
add_tech('keep', null, { cost: { food: 500, wood: 350 }, time: 75, age: 3, req: 'guard_tower', on_apply: _upgrade('guard_tower', 'keep') });
add_tech('murder_holes', null, { cost: { food: 200, stone: 100 }, time: 60, age: 2, effects: [{ stat: 'min_rng', kind: [...TOWERS, 'castle'], mul: 0 }] });
add_tech('arrowslits', null, { cost: { food: 250, wood: 250 }, time: 40, age: 3, effects: [{ stat: 'atk', kind: 'tower', add: 1 },
    { stat: 'atk', kind: 'guard_tower', add: 2 },
    { stat: 'atk', kind: 'keep', add: 3 }] });

at_university('guard_tower', 'keep', 'murder_holes', 'arrowslits');
