/* subjects-camp.mjs — CAMP look-gate subjects (side-effect module, imported by look-gate.mjs): the polar camp tents and the
 * station campfire, framed from the player's third-person camera (framings in lg-camp.js). No tent / campfire photo exists
 * in references/selected.txt — f01 / f05 / f04 are the night-light and polar-camp mood references. */
import { SUBJECTS } from './subjects.mjs';
const add = (s) => { if (!SUBJECTS.some((q) => q.name === s.name)) SUBJECTS.push(s); };
add({ name: 'camp_fire', icon: '🔥', title: 'Station campfire — player camera (flame, embers, smoke, heat glow)', shots: ['fire_player', 'fire_wide'],
  refs: [['f05', [0, 0.4, 1, 0.95]], ['f01', [0, 0, 1, 1]]], criteria: ['contact'], anti: ['cards', 'blobs', 'hover', 'plastic'] });
add({ name: 'tents', icon: '⛺', title: 'Polar pyramid tents in the camp — player camera', shots: ['tent_player', 'camp_wide'],
  refs: [['f04', [0, 0, 1, 1]], ['f01', [0, 0, 1, 1]]], criteria: ['contact'], anti: ['plastic', 'hover', 'cards', 'blobs'] });
