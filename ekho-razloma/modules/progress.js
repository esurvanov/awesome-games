/* modules/progress.js — Progress: what the game remembers about the player's run, as plain functions (no scene, no DOM).
 * Classic script, loaded before the page: window.Progress = { KEY, ENDINGS_KEY, VERSION, canSave(G), record(G, scene), apply(G, record), hpMax(shards) }
 *   record(G, scene)  the object stored under KEY: the story state from G plus what only the scene knows (taken spire parts, the fox, the
 *                     pilot's spot, the snowmobile, the boss) passed in as `scene`
 *   apply(G, rec)     writes the story state back into G, with the defaults old saves need; returns the scene part for the page to apply
 *   hpMax(shards)     max health grows by one per six shards
 *   onRestore(fn)     a module registers what it restores from a record: fn(sceneRecord, record, G); restore(G, rec) = apply + every listener
 * The page keeps the scene side (making spires, shards and the fox match the record) in applySave; this file owns the save format.
 * Tested without a browser: tools/refactor/progress.test.mjs */
(function () {
  'use strict';
  const Progress = {
    VERSION: 1, KEY: 'eor-save', ENDINGS_KEY: 'eor-endings',
    canSave: (G) => G.mode === 'play' && G.stage < 9,
    record(G, scene) {
      return { v: Progress.VERSION, stage: G.stage, hasTool: G.hasTool, hasCell: G.hasCell, parts: scene.parts, shards: G.shards, echoes: G.echoes,
        cleared: G.cleared, deaths: G.deaths, fox: scene.fox, time: G.time, pos: scene.pos, sk: scene.sk, bossDead: scene.bossDead, ending: G.ending, cp: G.checkpoint };
    },
    apply(G, s) {
      G.stage = s.stage; G.hasTool = s.hasTool; G.hasCell = s.hasCell; G.shards = s.shards || []; G.echoes = s.echoes || []; G.cleared = s.cleared || [];
      G.deaths = s.deaths || 0; G.time = s.time || 0; G.checkpoint = s.cp || 'crash'; G.ending = s.ending || null;
      return { parts: s.parts || [], fox: !!s.fox, sk: !!s.sk, bossDead: !!s.bossDead, pos: s.pos || null };
    },
    hpMax: (shards) => 5 + Math.floor(shards.length / 6),
    // the scene side of loading a save is done by whoever owns the thing: each module registers what it restores, restore() runs them all
    _listeners: [],
    onRestore(fn) { Progress._listeners.push(fn); },
    restore(G, s) { const x = Progress.apply(G, s); for (const fn of Progress._listeners) { try { fn(x, s, G); } catch (e) { console.warn('[progress] restore listener', e); } } return x; },
  };
  window.Progress = Progress;
})();
