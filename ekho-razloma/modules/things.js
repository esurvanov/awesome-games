/* modules/things.js — Things: the objects of the world that have a state and a part in the story (the data model's «Вещь с состоянием»).
 * Classic script, loaded before the page: window.createThings(deps) → Things
 *   all() · get(id) · ofKind(kind) · nearest(kind, x, z, max, ok)    records: { id, kind, family, native, position, state, taken }
 *   kinds: container (the cutter case) · cell (the power cell) · spire ×3 (+ its part) · shard ×24 · echo ×8 · heart (of the rift) · ship (Kestrel) · snowmobile · campfire
 *   position   the thing's spot as a THREE.Vector3-like object ({ x, y, z })      state   a short word: closed/open · placed/taken · … · dark/lit
 * Plain, collider-bearing objects (rocks, trees, buildings…) are the Passport's; this list is for the ones the story, the save or the player changes.
 * The natives stay where they are built (the page, structures.js, snowmobile.js, campfire.js); this is the one place that names them.
 * deps (open-world.html builds them): WORLD, sk, FIRE; D.G is read at run time. */
(function () {
  'use strict';
  window.createThings = function (D) {
    const { WORLD, sk, FIRE } = D;
    const list = [], byId = new Map();
    function add(id, kind, family, native, position, state, taken) {
      const t = { id, kind, family, native, get position() { return position(); }, get state() { return state(); }, get taken() { return taken ? taken() : false; } };
      list.push(t); byId.set(id, t); return t;
    }
    const G = () => D.G;
    add('crate', 'container', 'prop', WORLD.crate, () => WORLD.crate.position, () => (G().hasTool ? 'open' : 'closed'), () => G().hasTool);
    add('cell', 'cell', 'pickup', WORLD.cell, () => WORLD.cell.position, () => (G().hasCell ? 'taken' : 'placed'), () => G().hasCell);
    WORLD.spires.forEach((s, i) => add('spire' + i, 'spire', 'crystal', s, () => s.altar, () => (s.taken ? 'taken' : 'waiting'), () => s.taken));
    WORLD.shards.forEach((s, i) => add('shard' + i, 'shard', 'pickup', s, () => s.g.position, () => (s.taken ? 'taken' : 'placed'), () => s.taken));
    WORLD.echoes.forEach((e, i) => add('echo' + i, 'echo', 'landmark', e, () => e.pos, () => (G().echoes.includes(e.i) ? 'read' : 'unread'), () => G().echoes.includes(e.i)));
    add('heart', 'heart', 'crystal', WORLD.heart, () => WORLD.heart.g.position, () => (!WORLD.heart.g.visible ? 'gone' : G().heartRise ? 'rising' : 'sealed'));
    const ship = add('ship', 'ship', 'vehicle', WORLD.kestrel, () => WORLD.kestrel.g.position, () => (G().mode === 'ending' || G().stage >= 9 ? 'flying' : 'wrecked'));
    Object.defineProperties(ship, { base: { get: () => WORLD.kestrelBase },   // the pose it was placed in: the liftoff starts from it
      collider: { get: () => WORLD.kestrelCol, set: (v) => { WORLD.kestrelCol = v; } } });   // its Passport entry (set by structures.js, removed when it lifts off)
    add('snowmobile', 'snowmobile', 'vehicle', sk, () => sk.g.position, () => (sk.mounted ? 'ridden' : sk.unlocked ? 'ready' : 'locked'), () => sk.unlocked);
    add('campfire', 'campfire', 'prop', FIRE, () => FIRE.pos, () => 'lit');
    // the nearest thing of a kind to a spot (x, z): within `max` metres, accepted by `ok` (e.g. not taken yet); ties go to the first
    function nearest(kind, x, z, max = Infinity, ok) {
      let best = null, bd = max;
      for (const t of list) { if (t.kind !== kind || (ok && !ok(t))) continue; const p = t.position, d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = t; } }
      return best;
    }
    return { all: () => list, get: (id) => byId.get(id), ofKind: (kind) => list.filter((t) => t.kind === kind), nearest, KINDS: [...new Set(list.map((t) => t.kind))] };
  };
})();
