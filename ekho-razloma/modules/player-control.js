/* modules/player-control.js — Player: the human's side of the game, separate from the creature they drive.
 * Classic script, loaded before the page: window.createPlayer(deps) → Player
 *   Player.creature   the creature being driven (the pilot)         Player.input   { keys, pressed } — the keyboard and mouse state
 *   Player.camera     the camera rig (yaw, pitch, distance, look)    Player.climb   the ledge-climb in progress (t < 0 = none)
 *   Player.aim.t      seconds left of the aiming pose                Player.fire.cd  bolt cooldown
 *   Player.roll       { t, cd, dir } — the dodge roll: time left, cooldown, direction
 *   Player.held       { tool, tip } — the cutter in the hand and its glow tip
 *   Player.mode       what the pilot is doing right now, one word: 'dead' · 'ride' · 'climb' · 'roll' · 'walk' (in this order of precedence)
 *   Player.riding     is the pilot on the snowmobile; Player.board() / Player.leave() are the ONLY writers (modules/snowmobile.js calls them);
 *                     G.riding stays as the old name for the same fact (about 80 readers, the AI layer and the tools)
 * The pilot keeps its old fields as aliases of these (creature.aimT, fireCd, rollT, rollCd, rollDir), so physbody, terrain and the page read them
 * as before; the data now lives here. Health stays on the creature, its maximum comes from Progress.hpMax.
 * deps (open-world.html builds them): creature, keys, pressed, cam, CLIMB, tool; D.handTip and D.G are read at run time (defined later in the page). */
(function () {
  'use strict';
  window.createPlayer = function (D) {
    const { creature, keys, pressed, cam, CLIMB, tool } = D;
    const Player = {
      creature, input: { keys, pressed }, camera: cam, climb: CLIMB,
      aim: { t: 0 }, fire: { cd: 0 }, roll: { t: 0, cd: 0, dir: [0, -1] },
      held: { tool, get tip() { return D.handTip; } },
      get riding() { return !!D.G.riding; },
      board() { D.G.riding = true; },
      leave() { D.G.riding = false; },
      get mode() { const G = D.G; return G.deadT > 0 ? 'dead' : G.riding ? 'ride' : CLIMB.t >= 0 ? 'climb' : Player.roll.t > 0 ? 'roll' : 'walk'; },
    };
    const alias = (name, store, key) => Object.defineProperty(creature, name, { get: () => store[key], set: (v) => { store[key] = v; }, enumerable: true, configurable: true });
    alias('aimT', Player.aim, 't'); alias('fireCd', Player.fire, 'cd');
    alias('rollT', Player.roll, 't'); alias('rollCd', Player.roll, 'cd'); alias('rollDir', Player.roll, 'dir');
    return Player;
  };
})();
