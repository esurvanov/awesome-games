/* modules/interaction-tests.js — the measurement helpers for tools/stand.mjs (INTERACTION.testIK, testWalk, testContact, testContactSurface): walk the pilot into things and measure feet and hands. Moved out of modules/interaction.js unchanged. Classic script, loaded BEFORE interaction.js: window.createInteractionTests(deps) → { wait, place, testIK, testWalk, testContact, testContactSurface, bind({ C, V3, Q, T3 }) }. */
(function () {
  'use strict';
  window.createInteractionTests = function (X) {
    const { CT, B, K, wpos, hitDown, contactReady, contactHit, STATS, contactExit } = X;
    let C, V3, T3;   // assigned later in the source module: set through bind()
  /* ------------------------------------------------------------------ tests (tools/stand.mjs --eval "INTERACTION.testIK()") */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  function footErr() {
    // heel = ankle bone, toe = ball bone; height above the ground straight below minus the same height on flat ground
    const P = C.player, out = [];
    for (const L of B.legs) {
      const a = wpos(L.foot, new V3()), b = L.ball ? wpos(L.ball, new V3()) : null;
      const ga = hitDown(a.x, a.y + 0.6, a.z, 2), gb = b ? hitDown(b.x, b.y + 0.6, b.z, 2) : null;
      out.push({ ankle: ga ? (a.y - ga.y) * ga.ny : NaN, ball: gb ? (b.y - gb.y) * gb.ny : NaN, nY: ga ? ga.ny : 1, animH: L.h });   // distance to the ground plane
    }
    return out;
  }
  async function sampleFeet(ms) {
    const rows = []; const t0 = performance.now();
    while (performance.now() - t0 < ms) { await wait(50); rows.push(footErr()); }
    return rows;
  }
  function findSlope(deg) {
    const want = Math.cos(deg * Math.PI / 180); let best = null;
    for (let i = 0; i < 20000; i++) {
      const x = (Math.random() - 0.5) * 700, z = (Math.random() - 0.5) * 700;
      if (C.getH(x, z) < 3 || C.inRift(x, z, 10) || C.nearPOI(x, z, 12)) continue;
      const ny = C.normalY(x, z); if (Math.abs(ny - want) > 0.01) continue;
      // planar: normals around agree, no solids/trees in 3 m
      let ok = true; for (const [ox, oz] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) if (Math.abs(C.normalY(x + ox, z + oz) - want) > 0.02) { ok = false; break; }
      if (!ok) continue;
      const h = hitDown(x, C.getH(x, z) + 30, z, 40); if (!h || (h.tag && h.tag.kind !== 'terrain') || Math.abs(h.y - C.getH(x, z)) > 0.05) continue;
      if (C.FOREST && C.FOREST.list.some((t) => (t[0] - x) ** 2 + (t[2] - z) ** 2 < 25)) continue;
      best = { x, z, ny }; break;
    }
    return best;
  }
  function findFlat() {
    for (let i = 0; i < 20000; i++) {
      const x = (Math.random() - 0.5) * 600, z = (Math.random() - 0.5) * 600;
      if (C.getH(x, z) < 3 || C.inRift(x, z, 10) || C.nearPOI(x, z, 12)) continue;
      let ok = C.normalY(x, z) > 0.998; for (const [ox, oz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (C.normalY(x + ox, z + oz) < 0.997) ok = false;
      if (!ok) continue; const h = hitDown(x, C.getH(x, z) + 30, z, 40); if (!h || (h.tag && h.tag.kind !== 'terrain')) continue;
      return { x, z };
    }
    return null;
  }
  async function place(x, z, yaw) {
    const D = window.DBG; D.teleport(x, z, yaw); C.player.face = yaw; C.player.c.g.rotation.y = yaw; await wait(1300);
  }
  function stat(rows, key, ref) {   // max |err| over samples and both feet (planted feet only when walking)
    let mx = 0, sum = 0, n = 0;
    for (const r of rows) for (const f of r) { if (!isFinite(f[key])) continue; const e = Math.abs(f[key] - ref); mx = Math.max(mx, e); sum += e; n++; }
    return { max: +mx.toFixed(3), mean: +(sum / Math.max(1, n)).toFixed(3), n };
  }
  async function testIK(deg = 25) {
    if (!B.ready) return { error: 'pilot not ready' };
    const D = window.DBG; if (!D) return { error: 'needs #dbg' };
    const out = { slopeDeg: deg };
    const flat = findFlat(), sl = findSlope(deg); if (!flat || !sl) return { error: 'no test ground', flat, sl };
    out.flatAt = [+flat.x.toFixed(1), +flat.z.toFixed(1)]; out.slopeAt = [+sl.x.toFixed(1), +sl.z.toFixed(1)];
    const run = async (ik) => {
      K.ik = ik; const r = {};
      await place(flat.x, flat.z, 0); const fr = await sampleFeet(500);
      const refA = fr.flat().reduce((a, f) => a + f.ankle, 0) / (fr.length * 2), refB = fr.flat().reduce((a, f) => a + f.ball, 0) / (fr.length * 2);
      r.flatRef = { ankle: +refA.toFixed(3), ball: +refB.toFixed(3) };
      // downhill direction from the normal; stand across the slope, then facing uphill and downhill
      const e = 1, gx = C.getH(sl.x + e, sl.z) - C.getH(sl.x - e, sl.z), gz = C.getH(sl.x, sl.z + e) - C.getH(sl.x, sl.z - e);
      const upYaw = Math.atan2(-gx, -gz);   // face = atan2(-dx,-dz): forward along +gradient
      for (const [name, yaw] of [['across', upYaw + Math.PI / 2], ['uphill', upYaw], ['downhill', upYaw + Math.PI]]) {
        await place(sl.x, sl.z, yaw); const rows = await sampleFeet(600);
        r[name] = { ankle: stat(rows, 'ankle', refA), ball: stat(rows, 'ball', refB), pelvis: +B.pelvis.toFixed(3) };
      }
      return r;
    };
    // measure against the hard ground: loose snow off — both the old float (K.snowFloat) and the SNOW-CONTACT drawn-snow
    // surface (K.snowSurface). The latter was added after this test and bypassed its snowFloat switch, so the test read
    // "snow thickness under the boot on the slope minus on the flat spot" (4–9 cm, random with the spots) as IK error.
    // Feet on the DRAWN snow are checked by tools/eye.mjs (feet on the visible surface) and tools/snow-contact.mjs.
    const sfWas = K.snowFloat, ssWas = K.snowSurface; K.snowFloat = 0; K.snowSurface = false;
    try { out.ikOff = await run(false); out.ikOn = await run(true); }
    finally { K.snowFloat = sfWas; K.snowSurface = ssWas; K.ik = true; }
    const worst = (r) => Math.max(...['across', 'uphill', 'downhill'].flatMap((k) => [r[k].ankle.max, r[k].ball.max]));
    out.maxErrOff = +worst(out.ikOff).toFixed(3); out.maxErrOn = +worst(out.ikOn).toFixed(3); out.pass = out.maxErrOn < 0.05;
    return out;
  }
  async function testWalk(deg = 25) {   // walk across the slope; ankle error on planted frames
    const D = window.DBG, sl = findSlope(deg); if (!sl) return { error: 'no slope' };
    const e = 1, gx = C.getH(sl.x + e, sl.z) - C.getH(sl.x - e, sl.z), gz = C.getH(sl.x, sl.z + e) - C.getH(sl.x, sl.z - e), across = Math.atan2(-gx, -gz) + Math.PI / 2;
    await place(sl.x, sl.z, across); D.cam.yaw = across; await wait(200);
    D.keys.KeyW = true; const rows = []; const t0 = performance.now();
    while (performance.now() - t0 < 1600) { await wait(33); const fe = footErr(); rows.push(fe.filter((f) => f.animH < B.hRest + 0.02)); }
    D.keys.KeyW = false;
    const all = rows.flat(), ref = B.hRest - 0.0;
    return { planted: all.length, ankle: stat([all], 'ankle', all.reduce((a, f) => a + f.ankle, 0) / Math.max(1, all.length)), steps: STATS.steps };
  }
  // walk the pilot into the nearest sizeable boulder and measure hand-to-surface IK error once the contact layer
  // settles into its hold (tools/stand.mjs <label> --eval "INTERACTION.testContact()")
  async function testContact() {
    const D = window.DBG; if (!D) return { error: 'needs #dbg' };
    if (!B.ready || (!CT.ready && !contactReady())) return { error: 'contact layer not ready' };
    const P = C.player;
    let best = null;
    for (const e of (C.Passport && C.Passport.list) || []) {
      if (!e.name || !/boulder|rock/i.test(e.name) || !e.box) continue;
      const sx = e.box.max[0] - e.box.min[0], sy = e.box.max[1] - e.box.min[1], sz = e.box.max[2] - e.box.min[2], size = Math.max(sx, sy, sz);
      if (size < 2.0) continue;
      const cx = (e.box.min[0] + e.box.max[0]) / 2, cz = (e.box.min[2] + e.box.max[2]) / 2, d = Math.hypot(cx - P.x, cz - P.z);
      if (!best || d < best.d) best = { x: cx, z: cz, size, d };
    }
    if (!best) return { error: 'no boulder ≥ 2 m found' };
    // ux,uz points from the boulder OUT to wherever the player already is (so `from` stays clear on that same side);
    // the face must point the other way, back AT the boulder (forward = -sin(face),-cos(face), see contactSense) —
    // i.e. face = atan2(ux, uz), not atan2(-ux,-uz) (that walked the pilot away from the rock, not into it)
    const dx = P.x - best.x, dz = P.z - best.z, dl = Math.hypot(dx, dz) || 1, ux = dx / dl, uz = dz / dl;
    const from = { x: best.x + ux * (best.size * 0.7 + 3.2), z: best.z + uz * (best.size * 0.7 + 3.2) }, fa = Math.atan2(ux, uz);
    await place(from.x, from.z, fa);
    D.keys.KeyW = true;
    const t0 = performance.now();
    while (performance.now() - t0 < 4000 && CT.state !== 'play') await wait(50);
    D.keys.KeyW = false;
    if (CT.state !== 'play') return { error: 'contact never engaged (steered ' + CT.state + ')', wantIntent: CT.wantIntent, playerAt: [+P.x.toFixed(2), +P.z.toFixed(2)], boulderAt: [+best.x.toFixed(2), +best.z.toFixed(2), best.size], sense: CT.sense, ready: CT.ready };
    await wait(1200);   // settle into the held pose (enter clip finished, loop holding)
    const A = C.AV.player, m = CT.meta.clips[A.cur], out = { intent: CT.wantIntent, clip: A.cur, errors: [] };
    if (m && m.contacts) {
      const scale = B.root.getWorldScale(new V3()).x;
      for (const c of m.contacts) {
        if (!c.bone.startsWith('hand')) continue;
        const bone = B.root.getObjectByName(c.bone); if (!bone) continue;
        const wp = wpos(bone, new V3()), hit = contactHit(c); if (!hit) continue;
        const tgt = hit.point.clone().add(hit.normal.clone().multiplyScalar(0.035 * scale));
        out.errors.push({ bone: c.bone, cm: +(wp.distanceTo(tgt) * 100).toFixed(2) });
      }
    }
    out.maxCm = out.errors.length ? Math.max(...out.errors.map((e) => e.cm)) : null;
    out.pass = out.maxCm !== null ? out.maxCm < 3 : null;
    return out;
  }
  // independent self-check: hand-to-VISIBLE-mesh distance, a fresh THREE.Raycaster against the drawn scene from a
  // point safely outside any solid, along the surface normal — NOT the module's own bvhCache/e.geo shortcut, so a
  // bug that makes contactHit() agree with itself (IK reaches its own wrong target) can't hide behind a 0 cm result.
  // Found live: a naive skinned-mesh filter alone still let the ray hit the pilot's OWN rigid attachments (gloves,
  // gear — plain unskinned Meshes parented under the avatar rig sitting right next to the hand) before ever
  // reaching the rock, so every measurement came back "nothing found"; exclude anything under B.root/B.wrap too.
  function isAvatarPart(o) { for (let p = o; p; p = p.parent) if (p === B.root || p === B.wrap) return true; return false; }
  function visibleGap(handWp, normal) {
    try {
      const originOut = handWp.clone().add(normal.clone().multiplyScalar(0.5));
      const rc = new T3.Raycaster(originOut, normal.clone().negate(), 0, 1.2);
      rc.camera = C.camera;   // THREE.Sprite.raycast requires this (glow/fx billboards in the scene); harmless otherwise
      const hits = rc.intersectObjects(C.scene.children, true).filter((h) => !h.object.isSkinnedMesh && !isAvatarPart(h.object) && h.object.visible !== false);
      return hits.length ? +((hits[0].distance - 0.5) * 100).toFixed(2) : null;   // cm: >0 hand hovers off the surface, <0 past/inside it, null = ray found nothing (rare)
    } catch (err) { return null; }
  }
  // like testContact() but walks the pilot into up to `count` DISTINCT nearby solids (different Passport name
  // patterns where possible: procedural rock, scanned rock face, boulder, flat rock, a structure) and reports both
  // metrics per hand — tools/stand.mjs <label> --eval "INTERACTION.testContactSurface()"
  async function testContactSurface(count = 5) {
    const D = window.DBG; if (!D) return { error: 'needs #dbg' };
    if (!B.ready || (!CT.ready && !contactReady())) return { error: 'contact layer not ready' };
    const P = C.player, patterns = [/^rock#/, /^rock_flat/, /^boulder/, /^rock(?!_flat)/i, /kestrel|hab|ruin|st_|wall/i];
    const used = new Set(), targets = [];
    for (const pat of patterns) {
      let best = null;
      for (const e of (C.Passport && C.Passport.list) || []) {
        if (used.has(e.id) || !e.name || !pat.test(e.name) || !e.box) continue;
        const sx = e.box.max[0] - e.box.min[0], sy = e.box.max[1] - e.box.min[1], sz = e.box.max[2] - e.box.min[2], size = Math.max(sx, sy, sz);
        if (size < 2.2) continue;
        const cx = (e.box.min[0] + e.box.max[0]) / 2, cz = (e.box.min[2] + e.box.max[2]) / 2, d = Math.hypot(cx - P.x, cz - P.z);
        if (!best || d < best.d) best = { id: e.id, name: e.name, x: cx, z: cz, size: +size.toFixed(2), d };
      }
      if (best) { used.add(best.id); targets.push(best); }
      if (targets.length >= count) break;
    }
    const out = [];
    for (const t of targets) {
      const dx = P.x - t.x, dz = P.z - t.z, dl = Math.hypot(dx, dz) || 1, ux = dx / dl, uz = dz / dl;
      const from = { x: t.x + ux * (t.size * 0.7 + 3.2), z: t.z + uz * (t.size * 0.7 + 3.2) }, fa = Math.atan2(ux, uz);
      await place(from.x, from.z, fa);
      D.keys.KeyW = true;
      const t0 = performance.now();
      while (performance.now() - t0 < 4000 && CT.state !== 'play') await wait(50);
      D.keys.KeyW = false;
      if (CT.state !== 'play') { out.push({ name: t.name, size: t.size, error: 'never engaged (steered ' + CT.state + ')', wantIntent: CT.wantIntent }); continue; }
      // sample repeatedly through the hold instead of one fixed wait: a loop hold (hand_wall_both_loop) stays pinned
      // indefinitely, but a one-shot clip (vault_1m, step_over) only has hand IK active inside its own brief
      // window+blendOut (e.g. 0.36–0.67 s of a 1.6 s clip) — a single measurement taken later just compares the
      // unconstrained tail of the animation to a stale target and reports a huge, meaningless "error". Track, per
      // hand, the SMALLEST error seen across samples (= how well the IK actually converged at its best moment).
      const A = C.AV.player, best = new Map(); let lastClip = A.cur, lastIntent = CT.wantIntent;
      const t1 = performance.now();
      while (performance.now() - t1 < 1500 && CT.state === 'play') {
        const m = CT.meta.clips[A.cur]; lastClip = A.cur; lastIntent = CT.wantIntent;
        if (m && m.contacts) {
          const scale = B.root.getWorldScale(new V3()).x;
          for (const c of m.contacts) {
            if (!c.bone.startsWith('hand')) continue;
            const bone = B.root.getObjectByName(c.bone); if (!bone) continue;
            const wp = wpos(bone, new V3()), hit = contactHit(c); if (!hit) continue;
            const tgt = hit.point.clone().add(hit.normal.clone().multiplyScalar(0.035 * scale));
            const cm = +(wp.distanceTo(tgt) * 100).toFixed(2), gap = visibleGap(wp, hit.normal);
            const prev = best.get(c.bone);
            if (!prev || cm < prev.targetCm) best.set(c.bone, { bone: c.bone, targetCm: cm, visibleGapCm: gap });
          }
        }
        await wait(70);
      }
      const row = { name: t.name, size: t.size, intent: lastIntent, clip: lastClip, hands: [...best.values()] };
      row.maxTargetCm = row.hands.length ? Math.max(...row.hands.map((h) => h.targetCm)) : null;
      row.maxVisibleGapCm = row.hands.length ? Math.max(...row.hands.map((h) => Math.abs(h.visibleGapCm ?? 99))) : null;
      out.push(row);
      contactExit(); await wait(100);
    }
    return out;
  }

    return { wait, place, testIK, testWalk, testContact, testContactSurface, bind(o) { if ("C" in o) C = o.C; if ("V3" in o) V3 = o.V3; if ("T3" in o) T3 = o.T3; } };
  };
})();
