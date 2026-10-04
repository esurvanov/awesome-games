/* modules/interaction-contact.js — how the pilot leans on a rock and puts a hand on a surface: sensing what is ahead, choosing the contact (the rules replace the old AI question), the raycast against the real drawn faces, the pose layer for the hands. Moved out of modules/interaction.js unchanged. Classic script, loaded BEFORE interaction.js: window.createInteractionContact(deps) → { CT, rockTag, contactReady, contactHit, contactExit, rkFront, RK, layerHands, contactUpdate, bind({ C, V3, Q, T3 }) }. */
(function () {
  'use strict';
  window.createInteractionContact = function (X) {
    const { K, B, clamp, STATS, _p, wrapA, wpos } = X;
    let C, T3, V3;   // assigned later in the source module: set through bind()
  /* ------------------------------------------------------------------ contact: lean on a rock, hand on a wall, brace a
   * slope, step over / vault low obstacles, brush a branch, inspect/pick up — the "bumps into a rock from a distance"
   * fix. ANIMLIB.md's 37 pilot/hermit clips (assets/pack/anim_pilot_contact.js) carry, per clip, which hand/foot holds
   * where on the real surface and the ideal stand-off; ANIMLIB.chooseContact(intent, sense, meta) turns a probed
   * "sense" + a high-level intent into {clip, enter, standOff}. The intent itself (which of the 7 actions, if any) is
   * asked of Jev (CONTACT_INTENT, ai-content.js) only when the probed surface state actually changes near the player;
   * offline / low-confidence falls back to AI_CONTENT.contactRules (deterministic, same file). */
  const CT = { ready: false, meta: null, layer: null, state: 'idle', phase: null, pick: null, t: 0, sense: null,
    wantIntent: 'none', wantSrc: 'rules', askKey: '', askAt: -9, senseT: 0, plan: null, keyT: 0 };
  // INTERACT (modules/interact.js): kinds with authored contact points go through the mediator — stand spot, facing
  // and hand/foot targets come from the object's interaction passport; unmarked surfaces keep the probe + BVH path below
  K.passport = true; K.passportOnly = true; K.steerSpeed = 1.4; K.steerTurn = 4.5; K.steerMax = 2.2;
  // ROCKS (Passport names rock*, st_rock*, boulder*) belong to modules/rock-brain.js: while it is on, this generic
  // contact path never acts on a rock (contactDecide / contactStep / contactUpdate below) — one owner, no competing rules.
  const ROCK_RE = window.CORE ? window.CORE.surfaceRe : /^(st_)?(rock|boulder)/i;   // the family list lives in modules/contact-core.js
  const rockOwner = () => !!(window.ROCKBRAIN && window.ROCKBRAIN.K.on);
  // the physics tag of some scans carries only the Passport id, not the name: resolve the entry's own name
  const rockTag = (h) => {
    if (!h || !h.tag) return false;
    let n = h.tag.name;
    if (!n && h.tag.passport != null && window.INTERACT) { const e = window.INTERACT.entryById(h.tag.passport); n = e && e.name; }
    return !!(n && ROCK_RE.test(String(n)));
  };
  function contactReady() {
    const A = C.AV && C.AV.player;
    if (A && A.contact && A.contactMeta) { CT.meta = A.contactMeta; CT.layer = A.contact; CT.ready = true; }
    return CT.ready;
  }
  // one probe: horizontal ray at height `oy` above the feet, then a downward ray to the real top of whatever it hit
  // (= "height = top of the hit surface above the feet", per ANIMLIB.md's sense spec)
  function probeDir(ox, oz, len, oy) {
    const P = C.player, PH = C.PH;
    // rocks/walls/ruins are STATIC, tree trunks are their own TRUNK group, static/pushable props are PROP (see
    // physics.js) — a contact probe wants all three (unlike hitDown()'s foot-ground ray, which stays STATIC-only)
    const grp = PH.P.groups.STATIC | PH.P.groups.TRUNK | PH.P.groups.PROP;
    const h = PH.P.raycast({ x: P.x, y: P.y + oy, z: P.z }, { x: ox, y: 0, z: oz }, len, { groups: grp });
    if (!h) return null;
    // "height" = real top of the surface above the feet, sampled at 3 points along the ray PAST the hit (0.05 / 0.35 /
    // 0.65 m further in) rather than only at the exact hit XZ, and taking the tallest: a photogrammetry rock/wall is
    // craggy, so a single vertical column at the near edge can land on a low crack or foot of the rock and read as
    // knee-height even when the same surface is a 3 m wall a few dozen cm further in (this under-read is what made
    // senseKind() classify tall rocks/walls as a step-over "obstacle" — see CONTACT-SURFACE.md).
    let height = 0;
    for (const push of [0.05, 0.35, 0.65]) {
      const hx = P.x + ox * (h.distance + push), hz = P.z + oz * (h.distance + push);
      const top = PH.P.raycast({ x: hx, y: P.y + 3.5, z: hz }, { x: 0, y: -1, z: 0 }, 4.2, { groups: grp });
      if (top) height = Math.max(height, clamp(top.point.y - P.y, 0, 3));
    }
    if (height === 0) height = 1.2;   // no vertical sample landed on the object at all (rare: a razor-thin edge) — the old constant default
    const nx = h.normal ? h.normal.x : -ox, ny = h.normal ? h.normal.y : 0, nz = h.normal ? h.normal.z : -oz;
    return { dist: h.distance, height, nx, ny, nz, px: h.point.x, py: h.point.y, pz: h.point.z, tag: h.tag };
  }
  function contactSense() {
    const P = C.player, PH = C.PH; if (!PH.ok) return null;
    const face = P.c.g.rotation.y, fx = -Math.sin(face), fz = -Math.cos(face), rx = Math.cos(face), rz = -Math.sin(face);
    const front = probeDir(fx, fz, K.contactRange, 1.0), left = probeDir(-rx, -rz, 1.15, 1.0), right = probeDir(rx, rz, 1.15, 1.0), back = probeDir(-fx, -fz, 1.15, 1.0);
    const knee = probeDir(fx, fz, 1.5, 0.38), obstacle = knee && knee.height <= 1.3 && knee.height > 0.12 ? knee : null;
    // slope AHEAD (not just under the player's own feet): signed rise angle over the next 1.2 m along facing —
    // positive = uphill, what climb_slope / brace_slope actually needs
    const slope = Math.atan2(C.groundH(P.x + fx * 1.2, P.z + fz * 1.2) - C.groundH(P.x, P.z), 1.2);
    const g0 = B.legs[0] ? B.legs[0].g : null;
    return { front, left, right, back, knee, obstacle, ground: { slope, normal: g0 ? [g0.nx, g0.ny, g0.nz] : [0, 1, 0] }, speed: Math.hypot(P.vx, P.vz), onIce: B.lastSurf === 'ice' };
  }
  // coarse surface classification for the Jev question + the rule fallback (chooseContact does its own, finer-grained
  // thresholding once an intent is picked)
  function senseKind(sense) {
    const f = sense.front;
    // a pushable prop directly ahead (or under the knee probe) is never a lean / vault / step-over target: the
    // dedicated push mechanic (pushState() in armsUpdate) owns it. Before this check, a waist-high crate satisfying
    // the knee+chest obstacle_top height window got read as a low obstacle and vaulted/stepped-over — and a taller
    // one (object_face, below) still competed with push at walking speed (< 1.4 m/s) — either way CT took over
    // control before the pilot ever got close enough to push (INTERACT.md: crate_wood engage rate, pilot_push look-gate).
    if ((f && f.tag && f.tag.kind === 'prop') || (sense.obstacle && sense.obstacle.tag && sense.obstacle.tag.kind === 'prop')) return { surface: 'none', height: 0, dist: 3 };
    // `obstacle` (the knee-height probe) is only a genuine low object when the chest-height probe flew OVER it (per
    // its own doc: "a chest-height ray flies over anything short"). If the front probe ALSO reads a wall/ledge height
    // right there, the surface keeps going up past knee height — it is not a crate to vault, it is the base of a
    // taller rock/wall the knee ray happened to catch (found live: 3–5 m boulders read as 0.4 m "obstacles" and got
    // vaulted instead of leaned on — see CONTACT-SURFACE.md).
    if (sense.obstacle && (!f || f.height <= 1.3)) return { surface: 'obstacle_top', height: sense.obstacle.height, dist: sense.obstacle.dist };
    if (!f) return { surface: 'none', height: 0, dist: 3 };
    if (f.tag && f.tag.name && /branch|krummholz|shrub/i.test(f.tag.name)) return { surface: 'branch', height: f.height, dist: f.dist };
    if (sense.ground.slope > 0.5 && f.dist > 1.1) return { surface: 'slope', height: f.height, dist: f.dist };
    if (f.tag && f.tag.kind === 'prop') return { surface: 'object_face', height: f.height, dist: f.dist };
    if (f.height > 0.45 && f.height < 0.95) return { surface: 'ledge', height: f.height, dist: f.dist };
    if (f.height >= 0.95) return { surface: 'wall', height: f.height, dist: f.dist };
    return { surface: 'ground', height: f.height, dist: f.dist };
  }
  function contactDecide() {
    const sense = CT.sense; if (!sense) { CT.wantIntent = 'none'; return; }
    const P = C.player, G = C.G, AC = window.AI_CONTENT;
    const kind = senseKind(sense);
    const state = G.riding ? 'riding' : C.Creatures.inCombat() ? 'combat'
      : (C.CLIMB && C.CLIMB.t >= 0) ? 'climbing' : P.sliding ? 'sliding' : sense.speed > 6 ? 'running' : sense.speed > 0.15 ? 'walking' : 'idle';
    const animalsNear = C.Creatures.animalsNear(P.x, P.z);   // stags within 30 m, a fox that has joined within 15 m (modules/creatures.js)
    const npcNear = !!(C.orm && C.orm.pos && Math.hypot(C.orm.pos.x - P.x, C.orm.pos.z - P.z) < 10);
    const raw = { surface: kind.surface, height: kind.height || 0, distance: clamp(kind.dist, 0, 3), angleDeg: 0, speed: sense.speed, state,
      stamina: clamp(P.hp / Math.max(1, P.hpMax), 0, 1), cold: clamp((C.WX && C.WX.storm) || 0, 0, 1), animalsNear: Math.min(9, animalsNear), npcNear, onIce: sense.onIce };
    CT.wantIntent = AC && AC.contactRules ? AC.contactRules(raw) : 'none'; CT.wantState = state;
    // a rock ahead (or under the knee probe) is rock-brain's: no generic intent on it
    if (rockOwner() && rkFront(sense)) { CT.wantIntent = 'none'; return; }
    const key = raw.surface + '|' + Math.round(raw.distance * 4) + '|' + raw.state + '|' + Math.round(raw.height * 4) + '|' + (raw.onIce ? 1 : 0);
    if (window.AI && window.AI.available && window.AI.ask && (key !== CT.askKey) && (C.T - CT.askAt > K.contactAsk)) {
      CT.askKey = key; CT.askAt = C.T; STATS.contactAsks = (STATS.contactAsks || 0) + 1;
      window.AI.ask('CONTACT_INTENT', raw).then((r) => { if (r && r.intent) { CT.wantIntent = r.intent; CT.wantSrc = r.src; } });
    }
  }
  function playPick(A, name) {
    const m = CT.meta.clips[name]; if (!A.acts[name]) return false;
    if (m && m.loop === false) A.once(name, m.duration, 0.15); else A.loop(name, 0.2);
    return true;
  }

  /* ---- CONTACT-SURFACE: hand/foot IK aims at the RENDERED surface, not the physics collider ------------------
   * physics.js/open-world.html give rocks/boulders/outcrops a convex-HULL collider (Passport.register(..., 'solid',
   * {shape:'hull'}), see structures.js/vegetation.js) — a fine approximation for walking on, but on a cracked or
   * curved scan the hull and the drawn mesh disagree by several cm, so a hand IK'd onto the hull hovers in front of
   * what the player actually sees. Passport already keeps the EXACT drawn-mesh vertices in world space for every
   * 'solid' entry (e.geo, built before any hull simplification — see open-world.html Passport.make()/toPhys()), so
   * the correction needs no scene traversal and no new geometry extraction: wrap e.geo in a throwaway BufferGeometry,
   * build a three-mesh-bvh tree on it once (lazily, only for entries a hand ever actually reaches, cached forever by
   * entry identity), and raycast that instead. Any failure (library not loaded, geometry too big, nothing found)
   * silently keeps the physics hit — this is a correction layer, never the only path. */
  // NOTE: T3 (ctx.THREE) is only assigned once init(ctx) runs, well after this IIFE's top-level code — a `const`
  // computed from T3 here would freeze at null forever. Lazily construct on first real use instead.
  let _bvhRay = null;
  function bvhRay() { if (!_bvhRay && T3 && T3.Ray) _bvhRay = new T3.Ray(); return _bvhRay; }
  const bvhCache = new WeakMap();   // Passport entry -> BufferGeometry (with .boundsTree) | null, built lazily
  const passportIdCache = new Map();   // physics tag.passport (number) -> Passport entry | null, resolved lazily
  function bvhGeoFor(e) {
    if (!e || !e.geo || !e.geo.vn || !e.geo.i || e.geo.i.length / 3 > 20000) return null;   // guard: never build for something terrain-scale that slipped through
    if (bvhCache.has(e)) return bvhCache.get(e);
    let geo = null;
    try {
      if (T3.BufferGeometry.prototype.computeBoundsTree) {
        geo = new T3.BufferGeometry();
        geo.setAttribute('position', new T3.BufferAttribute(e.geo.v, 3));
        geo.setIndex(new T3.BufferAttribute(e.geo.i, 1));
        geo.computeBoundsTree();
      }
    } catch (err) { geo = null; }
    bvhCache.set(e, geo);
    return geo;
  }
  // Resolve the EXACT Passport entry the physics ray already hit (its collider carries `{kind,name,passport:e.id}`
  // as its tag, see open-world.html Passport.toPhys()) — a linear scan over Passport.list, but only the first time a
  // given id is ever touched (cached after by id; a nearest-neighbourhood search was tried first and dropped: with
  // several small rocks/props often clustered around one big boulder, "nearest plausible BVH hit" sometimes landed
  // on a NEIGHBOUR's geometry instead of the boulder actually being touched — exact id lookup can't do that).
  function entryByPassportId(id) {
    if (id == null) return null;
    if (passportIdCache.has(id)) return passportIdCache.get(id);
    let found = null; for (const e of (C.Passport && C.Passport.list) || []) if (e.id === id) { found = e; break; }
    passportIdCache.set(id, found);
    return found;
  }
  function faceNormalTowards(hit, dx, dz) {
    const n = hit.face && hit.face.normal ? hit.face.normal : null; if (!n) return null;
    if (n.x * dx + n.z * dz > 0) n.negate();   // three-mesh-bvh returns the raw winding normal; face it back at the ray origin like the physics hit's normal
    return n;
  }
  // BVH raycast against the ONE Passport entry the physics probe already hit, same ray, its exact drawn geometry;
  // used only to correct the point/normal (`dist` sanity-checks against the physics distance as a last-ditch guard).
  function bvhRaycastTag(ox, oy, oz, dx, dz, dist, tag) {
    const ray = bvhRay(); if (!ray || !tag) return null;
    const e = entryByPassportId(tag.passport);
    const geo = bvhGeoFor(e); if (!geo || !geo.boundsTree) return null;
    ray.origin.set(ox, oy, oz); ray.direction.set(dx, 0, dz);
    let hit = null; try { hit = geo.boundsTree.raycastFirst(ray, T3.DoubleSide); } catch (err) { return null; }
    return hit && Math.abs(hit.distance - dist) < 0.6 ? hit : null;
  }
  // hand/foot IK target for a clip's contact window: obstacle-top contacts (vault, step_over) pin to the knee-height
  // probe, everything else (wall, ledge_top, slope) pins to the front probe — approach.facing is always [0,0,1] in
  // this clip set (the surface is authored to be in front of the character; bone side just says which hand, not which
  // side to probe)
  function contactHit(c) {
    if (CT.plan) { const t = CT.plan.targets && CT.plan.targets[c.bone]; return t ? { point: t.point, normal: t.normal } : null; }
    const s = CT.sense; if (!s) return null;
    const P = C.player, PH = C.PH;
    let physHit = null, ox = P.x, oy = P.y + 1.0, oz = P.z, dx = 0, dz = 0, dist = 3, tag = null;
    if (c.surface && c.surface.type === 'obstacle_top') {
      if (!s.obstacle) return null;
      // fallback: the shared knee-height probe point, same for both hands (the original behaviour) — but the clip's
      // own metadata carries a per-hand LATERAL offset here too (surface.point[0], ±0.2 m, same convention as the
      // wall/ledge branch below), and its own note says the vertical key is authored for a 1 m obstacle and meant to
      // be scaled by (real top ÷ 1 m) — exactly `chooseContact`'s own `heightScale` on the picked clip. Re-probing
      // per hand at that scaled height, like the wall branch already does, is what turned a 37–47 cm miss (both
      // hands aimed at one shared point well below the vault clip's actual hand height) into a close match.
      physHit = { point: new V3(s.obstacle.px, s.obstacle.py, s.obstacle.pz), normal: new V3(s.obstacle.nx, s.obstacle.ny, s.obstacle.nz) };
      const face = P.c.g.rotation.y, fx = -Math.sin(face), fz = -Math.cos(face), lx = -Math.cos(face), lz = Math.sin(face);
      const hs = (CT.pick && CT.pick.heightScale) || 1, lo = (c.surface.point && c.surface.point[0]) || 0, ly = ((c.surface.point && c.surface.point[1]) || 0.38) * hs;
      ox = P.x + lx * lo; oy = P.y + ly; oz = P.z + lz * lo; dx = fx; dz = fz; dist = s.obstacle.dist; tag = s.obstacle.tag;
      if (PH.ok) {
        const h = PH.P.raycast({ x: ox, y: oy, z: oz }, { x: dx, y: 0, z: dz }, K.contactRange, { groups: PH.P.groups.STATIC | PH.P.groups.TRUNK | PH.P.groups.PROP });
        if (h) { const n = h.normal || { x: -dx, y: 0, z: -dz }; physHit = { point: new V3(h.point.x, h.point.y, h.point.z), normal: new V3(n.x, n.y, n.z) }; dist = h.distance; tag = h.tag; }
      }
    } else if (PH.ok && c.surface && c.surface.point) {
      // the periodic front/knee probes are ONE point straight ahead — good enough to classify the surface and steer to
      // it, but the two hands of a *_both clip sit ~0.2 m apart sideways (see the clip's own surface.point[0], character
      // space, +X = left) and a boulder is rarely flat across that span. Re-probe per hand, at query time (cheap: 2
      // rays, only while a hold is looping), offset by the clip's own local point so each hand pins to what is really
      // under IT, not a shared centre point.
      // world forward = rotate the model's local +Z by (face + π) (the wrap group's 180° flip, see attach()); world
      // left (local +X, ANIMLIB.md's convention) by the same rotation = (-cos(face), sin(face))
      const face = P.c.g.rotation.y, fx = -Math.sin(face), fz = -Math.cos(face), lx = -Math.cos(face), lz = Math.sin(face);
      const lo = c.surface.point[0] || 0, ly = c.surface.point[1] || 0;
      ox = P.x + lx * lo; oy = P.y + ly; oz = P.z + lz * lo; dx = fx; dz = fz;
      const h = PH.P.raycast({ x: ox, y: oy, z: oz }, { x: dx, y: 0, z: dz }, K.contactRange, { groups: PH.P.groups.STATIC | PH.P.groups.TRUNK | PH.P.groups.PROP });
      if (h) { const n = h.normal || { x: -dx, y: 0, z: -dz }; physHit = { point: new V3(h.point.x, h.point.y, h.point.z), normal: new V3(n.x, n.y, n.z) }; dist = h.distance; tag = h.tag; }
    } else if (s.front) {
      physHit = { point: new V3(s.front.px, s.front.py, s.front.pz), normal: new V3(s.front.nx, s.front.ny, s.front.nz) };
      const face = P.c.g.rotation.y; dx = -Math.sin(face); dz = -Math.cos(face); dist = s.front.dist; tag = s.front.tag;
    }
    if (!physHit) return null;
    if (K.contactBVH && tag) {
      try {
        const bh = bvhRaycastTag(ox, oy, oz, dx, dz, dist, tag);
        if (bh) { const n = faceNormalTowards(bh, dx, dz); if (n) return { point: bh.point.clone(), normal: n.clone().normalize() }; }
      } catch (err) { /* correction only: any failure keeps the physics hit below */ }
    }
    return physHit;
  }
  function contactExit() { CT.state = 'idle'; CT.pick = null; CT.phase = null; CT.plan = null; CT.keyT = 0; }
  const moveKeys = () => { const k = C.keys; return !!(k && (k.KeyW || k.KeyA || k.KeyS || k.KeyD || k.ArrowUp || k.ArrowDown || k.ArrowLeft || k.ArrowRight)); };
  // the Passport entries the probes touched (their physics tags carry the entry id)
  function sensedEntries(s) {
    const I = window.INTERACT, out = []; if (!I || !s) return out;
    for (const pr of [s.front, s.knee, s.left, s.right]) { const e = pr && pr.tag ? I.entryById(pr.tag.passport) : null; if (e && !out.includes(e)) out.push(e); }
    return out;
  }

  // is the thing a probe touched a rock (rock-brain's)? Some rocks sit in a terrain hump: the probes hit the ground
  // collider right at the rock — a terrain hit inside a rock's box counts as that rock
  let _rkList = null, _rkN = -1;
  function rockEntryNear(x, z, pad) {
    const L = (C.Passport && C.Passport.list) || []; if (!_rkList || _rkN !== L.length) { _rkList = L.filter((e) => e.alive && e.box && ROCK_RE.test(String(e.name || ''))); _rkN = L.length; }
    let best = null, bd = 1e9;
    for (const e of _rkList) { const b = e.box; if (!e.alive || x < b.min[0] - pad || x > b.max[0] + pad || z < b.min[2] - pad || z > b.max[2] + pad) continue; const d = Math.hypot(x - (b.min[0] + b.max[0]) / 2, z - (b.min[2] + b.max[2]) / 2); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  const rkOne = (h) => { if (!h) return null; if (rockTag(h)) return h; if (h.tag && h.tag.kind === 'terrain') { const e = rockEntryNear(h.px, h.pz, 0.8); if (e) { h.rockEntry = e; return h; } } return null; };
  const rkFront = (s) => (s ? (rkOne(s.front) || rkOne(s.knee)) : null);
  // mediator: kinds with an interaction passport get their stand spot / facing / targets from it
  function contactPlan() {
    const I = window.INTERACT; if (!K.passport || !I || !CT.sense) return { marked: false, plan: null };
    const ents = sensedEntries(CT.sense).filter((e) => !(rockOwner() && ROCK_RE.test(String(e.name || '')))), marked = ents.some((e) => I.hasPoints(e)); if (!marked) return { marked: false, plan: null };
    const P = C.player; let plan = null;
    // the same situation that just failed is not re-planned every 0.2 s (standing still next to a rock with no valid point)
    const key = CT.wantIntent + '|' + ents.map((e) => e.id).join(',') + '|' + Math.round(P.x * 8) + ',' + Math.round(P.z * 8) + ',' + Math.round(P.face * 8);
    if (CT.missKey === key && C.T - CT.missAt < 1.5) return { marked, plan: null };
    try { plan = I.plan(CT.wantIntent, ents, { x: P.x, y: P.y, z: P.z, face: P.face }, CT.meta); } catch (e) { plan = null; STATS.planErr = String(e && e.message); }
    if (!plan) { CT.missKey = key; CT.missAt = C.T; }
    return { marked, plan };
  }
  function contactStep(dt) {
    const A = C.AV.player;
    if (CT.state === 'idle') {
      if (CT.wantIntent !== 'none' && CT.sense && !(rockOwner() && rkFront(CT.sense))) {
        const mp = contactPlan();
        if (mp.plan && A.acts[mp.plan.clip] && CT.meta.clips[mp.plan.clip]) {
          CT.plan = mp.plan; CT.pick = { clip: mp.plan.clip, enter: mp.plan.enter, standOff: mp.plan.standOff, heightScale: mp.plan.heightScale }; CT.state = 'steer'; CT.t = 0; CT.keyT = 0; STATS.planned = (STATS.planned || 0) + 1;
          return;
        }
        if (mp.marked && K.passportOnly) return;   // marked kind, no valid point from here: no contact (never a hand in the air)
        let pick = null; try { pick = window.ANIMLIB.chooseContact(CT.wantIntent, CT.sense, CT.meta); } catch (e) { pick = null; }
        if (pick && A.acts[pick.clip] && CT.meta.clips[pick.clip]) { CT.pick = pick; CT.state = 'steer'; }
      }
      return;
    }
    const pick = CT.pick; if (!pick) { contactExit(); return; }
    const P = C.player;
    if (CT.plan) { planStep(dt, A, P); return; }
    // no per-frame key/velocity check here on purpose: a player who keeps holding W into a wall they've already
    // reached is capsule-blocked, but a kinematic character controller can keep reporting a non-trivial "grinding"
    // velocity for several frames while it's blocked (or during the steer nudge itself) — gating cancellation on
    // that every frame flip-flopped the state (idle→steer→play→idle…) and, worse, kept restarting the one-shot enter
    // clip from t=0 (A.once() always restarts) so it never reached the loop hold. contactDecide() already re-derives
    // CT.wantIntent from distance/speed/state every 0.2 s (contactRules' own gates) — that's the single source of
    // truth for "should this still be happening", checked here, not re-derived per frame from raw motion.
    if (CT.state === 'steer') {
      if (CT.steerDist == null || CT.wantIntent === 'none') { contactExit(); return; }
      const standOff = pick.standOff || 0.45, need = CT.steerDist - standOff, face = P.c.g.rotation.y;
      if (Math.abs(need) > 0.03) {   // the capsule already stopped the player a few cm out; close the last bit smoothly.
        // track the closing distance locally (not the probe, which only refreshes every 0.2 s / ~12 frames — using the
        // stale value directly would keep pushing at a near-constant rate for that whole window and overshoot)
        const dx = -Math.sin(face), dz = -Math.cos(face), step = clamp(need, -0.35, 0.35) * Math.min(1, dt * 4);
        P.x += dx * step; P.z += dz * step; CT.steerDist -= step; if (C.PH.ok) C.PH.ch.setPosition(P.x, P.y, P.z);
        return;
      }
      CT.state = 'play'; CT.t = 0; CT.phase = pick.enter ? 'enter' : 'main';
      playPick(A, pick.enter || pick.clip);
    } else if (CT.state === 'play') {
      const cmMain = CT.meta.clips[pick.clip];
      CT.t += dt;
      if (CT.phase === 'enter') {   // committed once started: a clean 0.6 s transition, never re-triggered mid-way
        const cm = CT.meta.clips[pick.enter || pick.clip], dur = cm ? cm.duration : 0.6;
        if (CT.t >= dur - 0.03) { CT.phase = 'main'; CT.t = 0; playPick(A, pick.clip); }
      } else {
        if (CT.wantIntent === 'none' && cmMain && cmMain.loop) { contactExit(); return; }   // holds end once the reason is gone (re-decided every 0.2 s)
        if (!cmMain || cmMain.loop === false) { if (CT.t >= (cmMain ? cmMain.duration : 0.6) - 0.03) { contactExit(); return; } }   // one-shot main clip (vault, step_over, pickup, crouch) finished
        else playPick(A, pick.clip);   // re-assert the hold (idempotent: same key each frame, no crossfade churn)
      }
    }
    if (A.cur && CT.layer && A.acts[A.cur]) layerHands(A.acts[A.cur], contactHit, 'contact');
  }
  // RK: the channel modules/rock-brain.js drives the body through (it decides; this module only applies it next frame):
  // spine pitch / roll (leanUpdate), knees (pelvis dip), the head's look-at, both arms onto hand points (armsUpdate)
  const RK = { pitch: 0, roll: 0, dip: 0, armW: 0, hands: { 1: { x: 0, y: 0, z: 0 }, '-1': { x: 0, y: 0, z: 0 } }, lookPt: { x: 0, y: 0, z: 0 }, lookOn: false };
  const rkReset = () => { RK.pitch = RK.roll = RK.dip = 0; RK.lookOn = false; RK.armW = 0; };
  // planned contact: walk the last bit to the stand spot while turning to the planned facing, then play; the hold ends
  // when the player moves (a movement key held past the enter clip) or the pose is knocked off the stand spot
  // the contact clip's hand / foot IK (ANIMLIB ContactLayer): a PoseRequest when the pose pipeline owns the hands
  function layerHands(act, hit, source, slot) {
    const PP = window.POSE, lay = CT.layer; if (!lay || !act) return;
    const hit2 = PP && PP.hit && PP.active('hands') ? PP.hit(hit) : hit;   // PoseSolver: palm feedback / palms higher
    const go = () => { try { lay.update(act, hit2, 1); } catch (e) { /* clip has no hand/foot contacts */ } };
    if (PP && PP.active('hands')) PP.request({ slot: slot || 'contact', source, type: 'limbTarget', data: { clip: act.getClip().name, hit }, apply: go }); else go();
  }
  function planStep(dt, A, P) {
    const pl = CT.plan, PH = C.PH;
    if (CT.state === 'steer') {
      CT.t += dt;
      if (moveKeys()) { CT.keyT += dt; if (CT.keyT > 0.5) contactExit(); return; }   // the player is steering: wait, then give up
      const dx = pl.sx - P.x, dz = pl.sz - P.z, d = Math.hypot(dx, dz), dy = wrapA(pl.yaw - P.face);
      if (CT.t > K.steerMax || d > 2.5) { contactExit(); return; }
      if (d > 0.01 || Math.abs(dy) > 0.02) {
        const st = Math.min(d, K.steerSpeed * dt); if (d > 1e-4) { P.x += dx / d * st; P.z += dz / d * st; }
        P.face += clamp(dy, -K.steerTurn * dt, K.steerTurn * dt); P.c.g.rotation.y = P.face; P.c.g.position.x = P.x; P.c.g.position.z = P.z;
        if (PH.ok) PH.ch.setPosition(P.x, P.y, P.z);
        return;
      }
      P.x = pl.sx; P.z = pl.sz; P.face = pl.yaw; P.c.g.rotation.y = pl.yaw; if (PH.ok) PH.ch.setPosition(P.x, P.y, P.z);
      CT.state = 'play'; CT.t = 0; CT.phase = pl.enter ? 'enter' : 'main'; CT.keyT = 0; pl.at = { x: P.x, z: P.z };
      playPick(A, pl.enter || pl.clip);
    } else if (CT.state === 'play') {
      const cmMain = CT.meta.clips[pl.clip]; CT.t += dt;
      if (CT.phase === 'enter') {
        const cm = CT.meta.clips[pl.enter], dur = cm ? cm.duration : 0.6;
        if (CT.t >= dur - 0.03) { CT.phase = 'main'; CT.t = 0; playPick(A, pl.clip); }
      } else {
        const oneShot = !cmMain || cmMain.loop === false;
        if (oneShot) { if (CT.t >= (cmMain ? cmMain.duration : 0.6) - 0.03) { contactExit(); return; } }
        else {
          if (moveKeys()) { CT.keyT += dt; if (CT.keyT > 0.12) { contactExit(); return; } } else CT.keyT = 0;
          if (Math.hypot(P.x - pl.at.x, P.z - pl.at.z) > 0.25 || CT.wantState === 'combat' || CT.wantState === 'riding') { contactExit(); return; }
          playPick(A, pl.clip);
        }
      }
      // hold still on the stand spot (the capsule may be nudged by the controller's own snap)
      if (!moveKeys()) { P.face = pl.yaw; P.c.g.rotation.y = pl.yaw; }
      // a shoulder lean has no limb IK: slide the pilot along the surface normal until the shoulder (bone + the clip's
      // 10 cm of shoulder) meets the face — the capsule may have been pushed off it by a lower bulge (wheels, a plinth)
      if (pl.shoulder && CT.phase === 'main' && !moveKeys() && B.root) {
        const sb = B.root.getObjectByName(pl.shoulder.bone); if (sb) { const w = wpos(sb, _p[18]), q = pl.shoulder;
          const d = (w.x - q.x) * q.ex + (w.z - q.z) * q.ez - 0.1 * B.root.getWorldScale(_p[19]).x, st = clamp(d, -0.3, 0.3) * Math.min(1, dt * 6);
          if (Math.abs(d) > 0.01 && Math.abs(pl.slid || 0) < 0.45) { P.x -= q.ex * st; P.z -= q.ez * st; pl.at.x -= q.ex * st; pl.at.z -= q.ez * st; pl.slid = (pl.slid || 0) + st; if (PH.ok) PH.ch.setPosition(P.x, P.y, P.z); } } }
    }
    if (A.cur && CT.layer && A.acts[A.cur]) layerHands(A.acts[A.cur], contactHit, 'contact');
  }
  function contactUpdate(dt) {
    if (!K.contact || !B.ready || (!CT.ready && !contactReady())) return;
    const P = C.player, G = C.G;
    const active = (C.mode === 'play' || C.mode === 'menu') && P.onGround && !G.riding && G.deadT <= 0 && !(C.CLIMB && C.CLIMB.t >= 0) && P.aimT <= 0 && B.arms.mode !== 'push';
    rkReset();
    if (!active) { if (CT.state !== 'idle') contactExit(); return; }
    if (rockOwner() && window.ROCKBRAIN.owns()) { if (CT.state !== 'idle') contactExit(); return; }   // rock-brain is acting: no generic contact
    CT.senseT -= dt;
    if (CT.senseT <= 0) { CT.senseT = 0.2; CT.sense = contactSense(); contactDecide(); CT.steerDist = CT.sense && CT.sense.front ? CT.sense.front.dist : null; }
    contactStep(dt);
  }


    return { CT, rockTag, contactReady, contactHit, contactExit, rkFront, RK, layerHands, contactUpdate, bind(o) { if ("C" in o) C = o.C; if ("T3" in o) T3 = o.T3; if ("V3" in o) V3 = o.V3; } };
  };
})();
