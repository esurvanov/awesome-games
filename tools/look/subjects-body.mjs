/* subjects-body.mjs — PHYSBODY look-gate subjects (side-effect module, imported by look-gate.mjs): the pilot's body
 * reacting physically, filmed from the player's own third-person gameplay camera (framings in lg-body.js). */
import { SUBJECTS, ANTI } from './subjects.mjs';
ANTI.jelly = '🍮 jelly body — the torso / head / arms wobble on their own, ring after a push, or bend like rubber';
ANTI.pop = '⚡ pops — a limb or the whole body snaps between poses (ragdoll → get-up, foot re-plant)';
ANTI.penetrate = '🪨 limbs inside rock / ground — the ragdoll or an arm sinks into a solid';
const B = (name, icon, title, refs, anti) => ({ name, icon, title, shots: [name + '_end'], refs, motions: [name], mrefs: refs.slice(0, 1), criteria: ['motion', 'contact'], anti });
for (const s of [
  B('body_stop', '🛑', 'Jog → stop: planted boots, settle step, chest sways forward and back', [['c05', [0, 0.3, 1, 0.8]], ['c01', [0, 0, 1, 1]]], ['sliding', 'jelly', 'pop', 'craters']),
  B('body_bump', '🪨', 'Shoulder brushes a rock: arm / shoulders give way, recover', [['d01', [0, 0.3, 1, 0.95]], ['d04', [0, 0.2, 1, 1]]], ['penetrate', 'jelly', 'pop', 'sliding']),
  B('body_push', '👊', 'Hit by a shardling: upper body knocked back, recovers', [['a02', [0, 0.3, 1, 1]], ['c05', [0, 0.3, 1, 0.8]]], ['jelly', 'pop', 'sliding', 'hover']),
  B('body_fall', '🪂', 'Fall from a ledge → ragdoll → gets up', [['d03', [0, 0.25, 0.8, 1]], ['d05', [0.2, 0, 1, 1]]], ['penetrate', 'pop', 'jelly', 'hover']),
  B('body_slope', '⛰', 'Walking across a 25° slope: feet on the snow, body upright', [['d06', [0, 0, 1, 1]], ['c05', [0, 0.3, 1, 0.8]]], ['sliding', 'hover', 'jelly']),
]) if (!SUBJECTS.some((q) => q.name === s.name)) SUBJECTS.push(s);
