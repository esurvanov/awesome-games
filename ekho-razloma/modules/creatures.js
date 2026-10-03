/* modules/creatures.js — Creatures: the one list of every living thing, with the same fields for each kind (the data model's «Существо»).
 * Classic script, loaded before the page: window.createCreatures(deps) → Creatures
 *   all()            records of every creature: pilot, orm, fox, stags, shardlings, golem, ravens — in that order
 *   ofKind(kind) · natives(kind) · byFamily(family)       the records / the original objects of one kind
 *   record fields    id, kind, family (from CORE), controller (who steers it: player · story · rules+ai · flock), native (the original object),
 *                    x, y, z, yaw, st (state), hp, group (the model root, or null) — read through accessors, whatever the native object calls them
 *   beings()         [{ kind, family, ref }] — what Passport.beings() returns
 * and the rules the other modules used to repeat per kind, now in one table (the order of each list is the order the old code used):
 *   snowRoots() · pressMarks() · grassActors() · blendRoots() · shadowRoots() · animalsNear(x, z) · inCombat()
 * The natives stay where they live (modules/wildlife.js, modules/combat.js, the page, worldfill.js) and keep their field names; nothing is renamed.
 * deps (open-world.html builds them): player, orm, fox, STAGS, enemies, boss, getH; D.G is read at run time. */
(function () {
  'use strict';
  window.createCreatures = function (D) {
    const { player, orm, fox, STAGS, enemies, boss, getH } = D;
    const CTL = { pilot: 'player', orm: 'story', fox: 'rules+ai', stag: 'rules+ai', raven: 'flock', shardling: 'rules+ai', golem: 'story' };
    // how each kind's native object spells the common fields
    const ACC = {
      pilot: { x: (o) => o.x, y: (o) => o.y, z: (o) => o.z, yaw: (o) => o.face, st: () => null, hp: (o) => o.hp, group: (o) => (o.c && o.c.g) || null },
      orm: { x: (o) => o.pos.x, y: (o) => o.pos.y, z: (o) => o.pos.z, yaw: (o) => o.g.rotation.y, st: () => null, hp: () => null, group: (o) => o.g || null },
      fox: { x: (o) => o.x, y: (o) => o.y, z: (o) => o.z, yaw: (o) => o.yaw, st: (o) => o.st, hp: () => null, group: (o) => o.g || o.root || null },
      stag: { x: (o) => o.x, y: (o) => getH(o.x, o.z), z: (o) => o.z, yaw: (o) => o.yaw, st: (o) => o.st, hp: () => null, group: (o) => o.g || o.root || null },
      shardling: { x: (o) => o.x, y: (o) => o.y, z: (o) => o.z, yaw: (o) => (o.g ? o.g.rotation.y : 0), st: (o) => o.st, hp: (o) => o.hp, group: (o) => o.g || o.mesh || null },
      golem: { x: (o) => o.x, y: (o) => o.y, z: (o) => o.z, yaw: (o) => (o.g ? o.g.rotation.y : 0), st: (o) => o.st, hp: (o) => o.hp, group: (o) => o.g || o.root || null },
      raven: { x: (o) => o.pos.x, y: (o) => o.pos.y, z: (o) => o.pos.z, yaw: (o) => o.yaw, st: (o) => o.st, hp: () => null, group: () => null },
    };
    const cache = new WeakMap(); let seq = 0;
    const familyOf = (kind) => (window.CORE ? window.CORE.familyOf(kind) : null);
    function rec(kind, native) {
      let r = cache.get(native); if (r) return r;
      const a = ACC[kind];
      r = { id: kind + '#' + (seq++), kind, family: familyOf(kind), controller: CTL[kind], native,
        get x() { return a.x(native); }, get y() { return a.y(native); }, get z() { return a.z(native); }, get yaw() { return a.yaw(native); },
        get st() { return a.st(native); }, get hp() { return a.hp(native); }, get group() { return a.group(native); } };
      cache.set(native, r); return r;
    }
    const ravens = () => (window.WorldFill && window.WorldFill.ravens) || [];
    function all() {
      const out = [rec('pilot', player), rec('orm', orm), rec('fox', fox)];
      for (const s of STAGS) out.push(rec('stag', s));
      for (const e of enemies) out.push(rec('shardling', e));
      out.push(rec('golem', boss));
      for (const r of ravens()) out.push(rec('raven', r));
      return out;
    }
    const sources = { pilot: () => [player], orm: () => [orm], fox: () => [fox], stag: () => STAGS, shardling: () => enemies, golem: () => [boss], raven: ravens };
    const natives = (kind) => (sources[kind] ? sources[kind]() : []);
    const ofKind = (kind) => natives(kind).map((n) => rec(kind, n));
    const byFamily = (family) => all().filter((r) => r.family === family);

    /* ---- the rules other modules repeated per kind ---- */
    // terrain.js: the models that press into snow ({ root, r, kind }); the dead shardlings and a boss without a model are left out
    function snowRoots() {
      const out = [], add = (root, r, kind) => { if (root && root.isObject3D) out.push({ root, r, kind }); };
      if (player.c) add(player.c.g, 1.3, 'pilot');
      if (orm.g) add(orm.g, 1.3, 'hermit');
      if (fox.g) add(fox.g, 1.2, 'fox');
      for (const s of STAGS) add(s.g, 2.2, 'stag');
      for (const e of enemies) if (!e.dead) add(e.g, 1.8, 'shardling');
      if (boss.g) add(boss.g, 5, 'golem');
      return out;
    }
    // terrain.js: footprints the fox and the stags leave ({ x, y, z, tol, f }: tolerance above the snow, strength)
    function pressMarks() {
      const out = [];
      if (fox.g) out.push({ x: fox.x, y: fox.g.position.y, z: fox.z, tol: 0.3, f: 0.3 });
      for (const s of STAGS) if (s.g && s.g.visible !== false) out.push({ x: s.x, y: s.g.position.y, z: s.z, tol: 0.4, f: 0.45 });
      return out;
    }
    // vegetation.js: what bends the grass, as [x, y, z, radius]: the pilot, the fox (if shown), the stags, the living shardlings
    function grassActors() {
      const out = [];
      if (player) out.push([player.x, player.y, player.z, 1.1]);
      if (fox.g && fox.g.visible !== false) out.push([fox.x, fox.y || getH(fox.x, fox.z), fox.z, 0.7]);
      for (const s of STAGS) out.push([s.x, getH(s.x, s.z), s.z, 1.3]);
      for (const e of enemies) if (e.hp > 0) out.push([e.x, (e.y || 0) - 1.3, e.z, 1.2]);
      return out;
    }
    // groundblend.js: model roots that are not terrain ({ kind, group }); the pilot's skeleton root is the caller's
    function blendRoots() {
      const out = [{ kind: 'pilot', group: ACC.pilot.group(player) }, { kind: 'fox', group: ACC.fox.group(fox) }];
      for (const s of STAGS) out.push({ kind: 'stag', group: ACC.stag.group(s) });
      for (const e of enemies) out.push({ kind: 'shardling', group: ACC.shardling.group(e) });
      out.push({ kind: 'golem', group: ACC.golem.group(boss) });
      return out;
    }
    // the page's shadow casters that move: model roots of every creature that has one
    function shadowRoots() {
      const out = [player.c.g, fox.g, orm.g];
      if (boss.g) out.push(boss.g);
      for (const s of STAGS) if (s.g) out.push(s.g);
      for (const e of enemies) if (e.g) out.push(e.g);
      return out;
    }
    // how many animals are close to a spot (interaction.js: contact intent): stags within 30 m, a fox that has joined within 15 m
    function animalsNear(x, z) {
      let n = 0;
      for (const s of STAGS) if (Math.hypot(s.x - x, s.z - z) < 30) n++;
      if (fox.joined && Math.hypot(fox.x - x, fox.z - z) < 15) n++;
      return n;
    }
    // is a fight going on (a shardling that is not idle or going home, or the guardian awake)
    const inCombat = () => enemies.some((e) => !e.dead && e.st !== 'idle' && e.st !== 'return') || (boss.active && !boss.dead);
    const beings = () => all().map((r) => ({ kind: r.kind, family: r.family, ref: r.native }));

    return { all, ofKind, natives, byFamily, beings, snowRoots, pressMarks, grassActors, blendRoots, shadowRoots, animalsNear, inCombat, KINDS: Object.keys(CTL) };
  };
})();
