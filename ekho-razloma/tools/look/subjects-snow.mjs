/* subjects-snow.mjs — SNOW-CONTACT look-gate subject (side-effect module, imported by look-gate.mjs): boots / prints seen
 * from the player's own gameplay camera while walking, after a landing and after a roll (framings in lg-snow.js). */
import { SUBJECTS } from './subjects.mjs';
if (!SUBJECTS.some((s) => s.name === 'snow_contact')) SUBJECTS.push(
  { name: 'snow_contact', icon: '🥾', title: 'Boots in snow — player camera (walk · landing · roll)', shots: ['walk_play', 'walk_close', 'land_play', 'roll_play'],
    refs: [['c01', [0, 0, 1, 1]], ['c06', [0.1, 0.25, 1, 1]], ['c02', [0, 0, 1, 1]], ['c04', [0, 0, 1, 1]]],
    motions: ['walk_play'], mrefs: [['c05', [0, 0.3, 1, 0.8]]], criteria: ['motion', 'contact'], anti: ['craters', 'sliding', 'hover', 'stripes'] });
