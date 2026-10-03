/* modules/controllers.js — Controllers: who steers a creature, in one place.
 * Classic script, loaded before the page: window.Controllers = { intent(native), steer(native, act, kind) }
 * A creature is steered by one of: the player (Player, modules/player-control.js) · the story (scripted: Orm, the guardian) · rules, optionally advised
 * by the AI layer (fox, stags, shardlings) · a flock (ravens). The kind of steering is the creature record's `controller` (modules/creatures.js).
 * For the rule-driven ones the AI layer (ai.js) may hold an «intent» for a creature — flee, alert, approach, retreat, circle, lead_player_to_shard,
 * graze — and the update of each kind asks here instead of reaching into window.AI: no layer, or no intent now → null, and the plain rules run. */
(function () {
  'use strict';
  window.Controllers = {
    intent: (native) => (window.AI ? window.AI.intent(native) : null),
    steer: (native, act, kind) => window.AI.steer(native, act, kind),
  };
})();
