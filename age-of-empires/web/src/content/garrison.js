// port of game/content/garrison.py
// Garrison (rules of the original): capacity and who may enter. Logic - defense.js.
// Town center - 15 (villagers, infantry, ranged units), watch towers - 5, castle - 20 (all land units).
// Every villager or ranged unit inside adds an arrow to the building. Min. range of towers and castle - 1 tile
// (removed by "Arrowslits", see towers.js).
import { BUILDINGS } from '../data.js';

export const FOOT = ['vil', 'inf', 'arch'];

Object.assign(BUILDINGS['town_center'], { garrison: 15, garrison_cls: FOOT });
Object.assign(BUILDINGS['tower'], { garrison: 5, garrison_cls: FOOT, min_rng: 1 });
Object.assign(BUILDINGS['castle'], { garrison: 20, garrison_cls: [...FOOT, 'cav'], min_rng: 1 });
