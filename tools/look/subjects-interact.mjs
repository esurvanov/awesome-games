/* subjects-interact.mjs — INTERACT look-gate subjects (side-effect module, imported by look-gate.mjs): the pilot touching
 * objects through the interaction passport, seen from the player's own third-person camera (framings in lg-interact.js). */
import { SUBJECTS } from './subjects.mjs';
const add = (s) => { if (!SUBJECTS.some((q) => q.name === s.name)) SUBJECTS.push(s); };
add({ name: 'pilot_wall', icon: '🧱', title: 'Pilot leaning on a ruin wall — player camera', shots: ['lean_wall'], refs: [['d03', [0, 0, 1, 1]], ['d02', [0, 0, 1, 1]]], criteria: ['contact'], anti: ['hover', 'plastic'] });
add({ name: 'pilot_wreck', icon: '✈', title: 'Pilot touching the Kestrel wreck — player camera', shots: ['lean_wreck'], refs: [['j01', [0, 0, 1, 1]], ['j05', [0, 0, 1, 1]]], criteria: ['contact'], anti: ['hover', 'plastic'] });
add({ name: 'pilot_tree', icon: '🌲', title: 'Pilot leaning on a tree trunk — player camera', shots: ['lean_tree'], refs: [['b06', [0, 0, 1, 1]], ['b05', [0, 0, 1, 1]]], criteria: ['contact'], anti: ['hover', 'plastic'] });
add({ name: 'pilot_push', icon: '📦', title: 'Pilot pushing a crate — player camera + strip', shots: ['push_crate'], refs: [['f01', [0, 0, 1, 1]]], motions: ['pilot_push'], mrefs: [['f01', [0, 0, 1, 1]]], criteria: ['motion', 'contact'], anti: ['hover', 'sliding'] });
