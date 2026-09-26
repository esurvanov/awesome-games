// port of game/content/army_base.py
// Army: armor classes and bonuses of the base units from data.py (rules of the original, DE values).
// Format (see World.calc_damage): 'cls', 'ac', 'bonus', 'carm', 'dtype', 'acc', 'minr', 'blast', 'pierce', 'shot',
// 'bld_only', 'pack', 'look_up', 'monk', 'req', 'bar_h' - see the Python module docstring.
import * as py from '../../runtime/py.js';
import { UNITS, TECHS } from '../data.js';

export const MILITIA_LINE = ['militia', 'man_at_arms', 'long_swordsman', 'two_handed_swordsman', 'champion'];

Object.assign(UNITS['militia'], { line: 'militia' });
Object.assign(UNITS['spearman'], { ac: ['spear'], bonus: { cav: 15 }, line: 'spearman' });
Object.assign(UNITS['archer'], { ac: ['foot_arch'], bonus: { spear: 3 }, acc: 0.8, line: 'archer' });
Object.assign(UNITS['skirmisher'], { ac: ['skirm', 'foot_arch'], bonus: { arch: 3, spear: 3 }, acc: 0.9, shot: 'javelin',
    line: 'skirmisher' });
Object.assign(UNITS['scout'], { ac: ['light_cav'], line: 'scout' });
Object.assign(UNITS['knight'], { line: 'knight' });
Object.assign(UNITS['ram'], { ac: ['ram'], bonus: { bld: 125, siege: 40 }, bld_only: true, bar_h: 34,
    line: 'ram' });

// "Imperial Age" gives troops no attack in the original - remove the simplification from data.py
py.dpop(TECHS['imperial'], 'effects', null);
