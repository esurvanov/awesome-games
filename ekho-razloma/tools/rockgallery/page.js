/* tools/rockgallery/page.js — in-page side of the rock gallery (window.RG). Injected by run.mjs after tools/interact/page.js.
 *
 *  RG.spots()            the test places: one flat-ground instance per rock kind + a gap between two rocks + a rock on a slope
 *  RG.card(spotId, side, scen, shotPrefix)   one scenario from one side: drives the pilot, fixes a camera that sees pilot + rock,
 *                        takes ~6 timed frames (window.__nodeShot) and returns the automatic checks
 *
 * JUDGE (ARCH-INTERACT.md step 1): every pass / fail number here is measured on what is DRAWN — the pilot's skinned vertices
 * (after skinning, the whole suit: helmet, shoulders, forearms, gloves, boots) against the rocks' drawn triangles
 * (three-mesh-bvh closestPointToPoint + ray parity for inside / outside) — never on what a module says about itself:
 *   penetration   deepest skin vertex inside a rock, per body part (head / torso / arm / hand / leg / foot), and how long
 *   hands         per glove, every sample while it is < 0.4 m from a rock: touching (≤ 3 cm) · reaching but not touching
 *                 ("air": the hand is raised or forward of the chest, 3–40 cm off) · hanging near it
 *   idle near     standing (< 0.3 m/s) with the chest < 0.6 m from a rock and no skin vertex within 3 cm, longest stretch
 *   jerks         the drawn root: a step not explained by its own speed (teleport > 0.2 m), accelerations > 45 m/s²;
 *                 the head vs the root: a jump > 0.1 m in one sample (a pose snap)
 *   clips         changes of the playing clip per second
 *   truth         (new) BODYCONTACT numbers per card: worstInsideCm + part, palm / fingers / forearm gap of the hands the action
 *                 puts on the rock, torso gap by action (expect touch / avoid) — judge.* keeps the old coarse fields
 *   contact       any skin vertex within 3 cm of a rock for ≥ 0.3 s (the judge's own, not the module's state)
 * The decision (ROCKBRAIN / INTERACTION.CT) is read ONLY to caption the frames (action names), never for a verdict.
 * Frames: fixed side cameras (lab) + one frame from the game camera the player sees.
 */
(function () {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const base = (n) => String(n || '').replace(/#\d+$/, '');
  const T = () => DBG.THREE;
  const ROCK = /^(st_)?(rock|boulder)/i;
  const RG = window.RG = { wait };
  const kindKey = (e) => base(e.name) + '|' + (e.geo ? e.geo.vn : 0);
  const center = (e) => { const b = e.box; return { x: (b.min[0] + b.max[0]) / 2, z: (b.min[2] + b.max[2]) / 2 }; };
  const rad = (e) => { const b = e.box; return Math.hypot(b.max[0] - b.min[0], b.max[2] - b.min[2]) / 2; };
  const height = (e) => e.box.max[1] - e.box.min[1];
  const rocks = () => DBG.Passport.list.filter((e) => e.alive && e.role === 'solid' && e.box && e.geo && ROCK.test(base(e.name)));

  // ground spread around a footprint: max − min terrain height on two rings (flat = small), and the lowest point (sea = < 0.6)
  function groundSpread(c, r) {
    let lo = Infinity, hi = -Infinity;
    for (const rr of [r + 1.5, r + 4]) for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, h = DBG.getH(c.x + Math.sin(a) * rr, c.z + Math.cos(a) * rr); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    return { spread: hi - lo, lo };
  }
  const inMap = (c) => Math.hypot(c.x, c.z) < 380;

  /* ---------------------------------------------------------------- places */
  const KINDS = ['boulder|2845', 'rock_flat|2521', 'rock_outcrop|4648', 'rock|2515', 'rock|4648', 'rock|4716'];
  let SPOTS = null;
  // ?rocklab: the test ground's copies (modules/rock-lab.js) replace the places found on the island
  RG.useLab = function () { if (!window.ROCKLAB || !ROCKLAB.ready) return false; SPOTS = ROCKLAB.spots.slice(); return true; };
  RG.spots = function () {
    if (SPOTS) return SPOTS.map(({ id, label, kind, size, h, spread, x, z, scens }) => ({ id, label, kind, size, h, spread, x, z, scens: scens || [] }));
    const all = rocks(), out = [];
    for (const k of KINDS) {
      const list = all.filter((e) => kindKey(e) === k); if (!list.length) { out.push({ id: k, label: k, kind: k, missing: true }); continue; }
      const scored = list.map((e) => { const c = center(e), g = groundSpread(c, rad(e)); return { e, c, g }; })
        .filter((s) => inMap(s.c) && s.g.lo > 0.6);
      scored.sort((a, b) => a.g.spread - b.g.spread);
      // flattest third, then the mid-size one of those (a representative instance, not the smallest pebble)
      const flat = (scored.length ? scored : list.map((e) => ({ e, c: center(e), g: groundSpread(center(e), rad(e)) }))).slice(0, Math.max(1, Math.ceil(scored.length / 3)));
      flat.sort((a, b) => rad(a.e) - rad(b.e)); const s = flat[Math.floor(flat.length / 2)];
      out.push({ id: k, label: k.split('|')[0] + ' ' + height(s.e).toFixed(1) + ' м', kind: k, e: s.e, x: s.c.x, z: s.c.z, r: rad(s.e), size: +(rad(s.e) * 2).toFixed(1), h: +height(s.e).toFixed(2), spread: +s.g.spread.toFixed(2), ang0: 0 });
    }
    // gap: two rocks ≥ 1.2 m tall, 0.55–1.3 m apart (closest box faces), on dry ground
    const tall = all.filter((e) => height(e) > 1.2 && inMap(center(e)));
    let gap = null; const gaps = [];
    for (let i = 0; i < tall.length; i++) for (let j = i + 1; j < tall.length; j++) {
      const a = tall[i].box, b = tall[j].box;
      const dx = Math.max(0, a.min[0] - b.max[0], b.min[0] - a.max[0]), dz = Math.max(0, a.min[2] - b.max[2], b.min[2] - a.max[2]), d = Math.hypot(dx, dz);
      if (d < 0.55 || d > 1.3) continue;
      const ca = center(tall[i]), cb = center(tall[j]), m = { x: (ca.x + cb.x) / 2, z: (ca.z + cb.z) / 2 };
      if (DBG.getH(m.x, m.z) < 0.6 || groundSpread(m, 1).spread > 1.5) continue;
      // a tree crown next to the gap hides it from every camera: prefer gaps with the nearest trunk farthest away
      let tree = 99; for (const t of DBG.Passport.list) if (t.alive && t.role === 'trunk' && t.trunk) tree = Math.min(tree, Math.hypot(t.trunk.x - m.x, t.trunk.z - m.z));
      const ax = Math.atan2(cb.x - ca.x, cb.z - ca.z);   // the pair's axis; the gap runs across it
      gaps.push({ tree, id: 'gap', label: 'щель ' + d.toFixed(1) + ' м', kind: kindKey(tall[i]) + ' + ' + kindKey(tall[j]), e: tall[i], e2: tall[j], x: m.x, z: m.z, r: Math.max(rad(tall[i]), rad(tall[j])), size: +d.toFixed(2), h: +Math.min(height(tall[i]), height(tall[j])).toFixed(2), spread: 0, ang0: ax + Math.PI / 2 });
    }
    gaps.sort((a, b) => b.tree - a.tree); gap = gaps[0] || null;
    if (gap) { delete gap.tree; out.push(gap); }
    // slope: a rock ≥ 1 m tall whose surrounding ground rises 1.5–4 m across the rings
    const sl = all.map((e) => ({ e, c: center(e) })).filter((s) => height(s.e) > 1 && inMap(s.c) && DBG.getH(s.c.x, s.c.z) > 0.6)
      .map((s) => ({ ...s, g: groundSpread(s.c, rad(s.e)) })).filter((s) => s.g.spread > 1.5 && s.g.spread < 4).sort((a, b) => a.g.spread - b.g.spread);
    if (sl.length) { const s = sl[Math.floor(sl.length / 2)]; out.push({ id: 'slope', label: 'на склоне ' + height(s.e).toFixed(1) + ' м', kind: kindKey(s.e), e: s.e, x: s.c.x, z: s.c.z, r: rad(s.e), size: +(rad(s.e) * 2).toFixed(1), h: +height(s.e).toFixed(2), spread: +s.g.spread.toFixed(2), ang0: 0 }); }
    SPOTS = out;
    return RG.spots();
  };

  /* ---------------------------------------------------------------- measuring (independent of the interaction code) */
  let SKIN = null;
  function skin() {
    if (SKIN) return SKIN;
    const root = INTERACTION.B.root; SKIN = {};
    const meshes = []; root.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
    const sub = (name) => { const b = root.getObjectByName(name), s = new Set(); if (b) b.traverse((o) => { if (o.isBone) s.add(o); }); return s; };
    for (const eff of ['hand_l', 'hand_r', 'foot_l', 'foot_r']) {
      const bones = sub(eff), list = [];
      for (const m of meshes) {
        const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight; if (!si) continue;
        const idx = new Set(); m.skeleton.bones.forEach((b, k) => { if (bones.has(b)) idx.add(k); });
        for (let i = 0; i < si.count; i++) { let w = 0; for (let c = 0; c < 4; c++) if (idx.has(si.getComponent(i, c))) w += sw.getComponent(i, c); if (w >= 0.6) list.push([m, i]); }
      }
      const step = Math.max(1, Math.floor(list.length / 40)); SKIN[eff] = list.filter((_, k) => k % step === 0);
    }
    return SKIN;
  }
  const BODY = ['pelvis', 'spine_02', 'spine_03', 'neck_01', 'head', 'upperarm_l', 'upperarm_r', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r'];
  let NEAR = [];
  function nearRocks(x, z, R) {
    NEAR = [];
    for (const e of rocks()) { const c = center(e); if (Math.hypot(c.x - x, c.z - z) - rad(e) > R) continue; const g = window.INTERACT && INTERACT.bvhGeo(e); if (g && g.boundsTree) NEAR.push({ e, g }); }
    return NEAR.length;
  }
  const _t = {}; let _ray = null;
  // signed distance of a world point to the nearest drawn rock: > 0 outside, < 0 inside (parity of an upward ray)
  function sdist(p) {
    const THREE = T(); if (!_ray) _ray = new THREE.Ray();
    let best = Infinity, inside = false;
    for (const n of NEAR) {
      const b = n.e.box; if (p.x < b.min[0] - 0.6 || p.x > b.max[0] + 0.6 || p.z < b.min[2] - 0.6 || p.z > b.max[2] + 0.6 || p.y > b.max[1] + 0.6) continue;
      const r = n.g.boundsTree.closestPointToPoint(p, _t); if (!r) continue;
      if (r.distance < Math.abs(best)) {
        _ray.origin.copy(p); _ray.direction.set(0, 1, 0);
        let hits = []; try { hits = n.g.boundsTree.raycast(_ray, THREE.DoubleSide) || []; } catch (err) { hits = []; }
        inside = hits.length % 2 === 1; best = inside ? -r.distance : r.distance;
      }
    }
    return best;
  }
  function effGap(eff) {
    const THREE = T(), v = new THREE.Vector3(); let min = Infinity;
    // nearest drawn rock, or the ground itself (a slope brace puts the palm on the snow, not on the rock)
    for (const [m, i] of skin()[eff] || []) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); const d = Math.min(sdist(v), Math.max(0, v.y - DBG.getH(v.x, v.z))); if (d < min) min = d; }
    return min;
  }
  function bodyInside() {
    const THREE = T(), root = INTERACTION.B.root, v = new THREE.Vector3(); let worst = 0, part = null;
    for (const n of BODY) { const b = root.getObjectByName(n); if (!b) continue; b.getWorldPosition(v); const d = sdist(v); if (d < worst) { worst = d; part = n; } }
    return { depth: -worst, part };
  }

  /* ---------------------------------------------------------------- judge: the whole drawn body */
  const PART = (n) => /head|neck/.test(n) ? 'head' : /hand|thumb|index|middle|ring|pinky/.test(n) ? 'hand' : /lowerarm|upperarm|clavicle/.test(n) ? 'arm'
    : /foot|ball|toe/.test(n) ? 'foot' : /thigh|calf/.test(n) ? 'leg' : 'torso';
  let BODYV = null;   // [[mesh, vertexIndex, part]] ~1400 skin vertices, spread over the whole suit
  function bodyVerts() {
    if (BODYV) return BODYV;
    const root = INTERACTION.B.root, all = [];
    root.traverse((m) => {
      if (!m.isSkinnedMesh || !m.visible) return;
      const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight; if (!si) return;
      for (let i = 0; i < si.count; i++) { let bw = -1, bi = 0; for (let c = 0; c < 4; c++) { const w = sw.getComponent(i, c); if (w > bw) { bw = w; bi = si.getComponent(i, c); } }
        all.push([m, i, PART(String(m.skeleton.bones[bi] && m.skeleton.bones[bi].name || ''))]); }
    });
    const step = Math.max(1, Math.floor(all.length / 1400)); BODYV = all.filter((_, k) => k % step === 0);
    return BODYV;
  }
  // the body against the near rocks — ONE truth: BODYCONTACT (modules/body-spec.js), signed distance of the DRAWN skinned suit
  // (no shrink coefficients) to the rocks' drawn triangles. Returns the new per-part result (res) and the old coarse shape
  // ({deep, gap} by head / torso / arm / hand / leg / foot, metres) so report.mjs / summ.mjs keep working.
  const OLDPART = { helmet: 'head', neck: 'head', chest: 'torso', pelvis: 'torso', shoulder: 'torso', upperarm: 'arm', forearm: 'arm', palm: 'hand', handback: 'hand', fingers: 'hand', thigh: 'leg', shin: 'leg', boot: 'foot' };
  function bodyScan() {
    const out = { deep: {}, gap: {}, res: null };
    if (!window.BODYCONTACT) { out.err = 'no BODYCONTACT'; return out; }
    const res = BODYCONTACT.measure(NEAR, { root: INTERACTION.B.root, margin: 0.6 }); if (!res) return out; out.res = res;
    for (const k in res.parts) {
      const m = res.parts[k].minSignedCm; if (m == null) continue; const part = OLDPART[k.replace(/_[lr]$/, '')] || 'torso';
      if (m < 0) { if (-m / 100 > (out.deep[part] || 0)) out.deep[part] = -m / 100; }
      else if (out.gap[part] === undefined || m / 100 < out.gap[part]) out.gap[part] = m / 100;
    }
    return out;
  }
  // what the torso should do for an action: touch (back / shoulder / seat / squeeze) · avoid (hands carry the contact) · null
  const TORSO_TOUCH = /lean_back|lean_shoulder|sit_rock|squeeze_side|seat/, TORSO_AVOID = /hand_wall|lean_hands|touch_walk|brace_slope/;
  const med = (a) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.floor((b.length - 1) / 2)]; };
  // one glove: distance to the drawn rock only (the ground does not count here), and whether it is raised / forward
  function gloveState(eff) {
    const THREE = T(), v = new THREE.Vector3(), root = INTERACTION.B.root, P = DBG.player; let min = Infinity, cx = 0, cy = 0, cz = 0, n = 0;
    for (const [m, i] of skin()[eff] || []) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); cx += v.x; cy += v.y; cz += v.z; n++; const d = sdist(v); if (d < min) min = d; }
    if (!n) return null; cx /= n; cy /= n; cz /= n;
    const pel = root.getObjectByName('pelvis'), pp = new THREE.Vector3(); if (pel) pel.getWorldPosition(pp); else pp.set(P.x, P.y + 1, P.z);
    const fx = -Math.sin(P.face), fz = -Math.cos(P.face), fwd = (cx - pp.x) * fx + (cz - pp.z) * fz;
    return { gap: min, raised: cy > pp.y + 0.05 || fwd > 0.28 };
  }
  function drawnRoot() { const THREE = T(), v = new THREE.Vector3(), h = new THREE.Vector3(), root = INTERACTION.B.root; root.getWorldPosition(v); const hb = root.getObjectByName('head'); if (hb) hb.getWorldPosition(h); else h.copy(v); return { r: v, h }; }

  /* ---------------------------------------------------------------- the decision, as the game sees it */
  function decision() {
    const RB = window.ROCKBRAIN, CT = INTERACTION.CT, RK = INTERACTION.RK, A = DBG.AV && DBG.AV.player;
    const climbing = DBG.CLIMB && DBG.CLIMB.t >= 0;
    let state, action, src;
    if (RB) {
      src = 'rockbrain';
      state = typeof RB.state === 'string' ? RB.state : RB.state && (RB.state.name || RB.state.st) || '';
      const lc = RB.plan || RB.lastChoice; action = RB.state === 'free' || RB.state === 'release' ? '' : lc ? (typeof lc === 'string' ? lc : lc.action || lc.name || lc.id || '') : '';
    } else {
      src = 'legacy';
      state = (CT ? CT.state : '') + (RK && RK.st && RK.st !== 'none' ? '/' + RK.st : '');
      action = CT && CT.plan ? CT.plan.name || CT.plan.clip : '';
    }
    if (climbing) { state = 'climb'; action = action || 'climb'; }
    // hands the current decision puts on the rock (legacy: the plan's targets while the clip plays)
    let hands = [];
    if (RB) { if (RB.hands) hands = RB.hands(); else { const pl = RB.plan; if (pl && RB.state === 'hold' && pl.targets && pl.sp && A && A.cur === pl.sp.clip) hands = Object.keys(pl.targets).filter((b) => /^hand/.test(b)); } }
    // legacy: only while the plan's own main clip is what the avatar plays (not its enter clip, not the idle/jog before it)
    else if (CT && CT.plan && CT.state === 'play' && CT.phase === 'main' && CT.plan.targets && A && A.cur === CT.plan.clip) hands = Object.keys(CT.plan.targets).filter((b) => /^hand/.test(b));
    return { state, action: action || '', clip: A ? A.cur || '' : '', hands, src };
  }

  /* ---------------------------------------------------------------- camera: sees pilot + rock, never inside a solid */
  function clearLine(a, b) {
    const PH = DBG.PH; const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.hypot(dx, dy, dz);
    if (PH && PH.ok) { const h = PH.P.raycast(a, { x: dx / d, y: dy / d, z: dz / d }, d, { groups: PH.P.groups.STATIC | PH.P.groups.TRUNK | PH.P.groups.PROP }); if (h && h.distance < d - 0.3) return h.distance / d; }
    for (const n of NEAR) {   // drawn rocks too (hull colliders are smaller than some drawn overhangs)
      const THREE = T(); if (!_ray) _ray = new THREE.Ray(); _ray.origin.set(a.x, a.y, a.z); _ray.direction.set(dx / d, dy / d, dz / d);
      let h = null; try { h = n.g.boundsTree.raycastFirst(_ray, THREE.DoubleSide); } catch (err) { h = null; }
      if (h && h.distance < d - 0.3) return h.distance / d;
    }
    return 1;
  }
  let TRUNKS = [];
  function nearTrunks(x, z, R) { TRUNKS = DBG.Passport.list.filter((e) => e.alive && e.role === 'trunk' && e.trunk && Math.hypot(e.trunk.x - x, e.trunk.z - z) < R).map((e) => e.trunk); }
  function pickCamera(pc, ang) {
    nearTrunks(pc.x, pc.z, 16);
    // pc: the contact point on the rock face; ang: the side the pilot comes from (world). Candidates: around the approach,
    // biased to the open side; each must see pc and the pilot's start line, stay above ground, and not sit inside a rock
    const cands = [];
    // profile view first (the contact is seen from the side), then more from the front / behind; 5 m out, ~1.4 m above the chest
    const mid = { x: pc.x + Math.sin(ang) * 1.2, z: pc.z + Math.cos(ang) * 1.2 };   // between the rock face and where the pilot stands
    for (const off of [1.35, -1.35, 1.0, -1.0, 1.8, -1.8, 0.6, -0.6]) for (const dist of [5, 6.5, 4]) {
      const a = ang + off, cx = mid.x + Math.sin(a) * dist, cz = mid.z + Math.cos(a) * dist, gy = DBG.getH(cx, cz), cy = Math.max(pc.y + 1.4, gy + 1.6);
      const cam = { x: cx, y: cy, z: cz }, look = { x: mid.x, y: pc.y - 0.1, z: mid.z };
      const k1 = clearLine(cam, look), k2 = clearLine(cam, { x: pc.x + Math.sin(ang) * 2.5, y: pc.y + 0.2, z: pc.z + Math.cos(ang) * 2.5 });
      const inside = sdist(new (T().Vector3)(cx, cy, cz)) < 0.4;
      // tree crowns are not in the physics (only trunks): keep the camera and its line of sight ≥ 2.4 m from any trunk axis
      let tree = 0; for (const t of TRUNKS) { const ux = look.x - cx, uz = look.z - cz, L = Math.hypot(ux, uz) || 1, k = Math.max(0, Math.min(1, ((t.x - cx) * ux + (t.z - cz) * uz) / (L * L)));
        const d = Math.hypot(cx + ux * k - t.x, cz + uz * k - t.z); if (d < 3.5) tree = Math.max(tree, 1 - d / 3.5); }
      cands.push({ cam, look, score: (inside ? -5 : 0) - tree * 3 + k1 * 2 + k2 - Math.abs(Math.abs(off) - 1.35) * 0.3 - Math.abs(dist - 5) * 0.08 });
    }
    cands.sort((a, b) => b.score - a.score); return cands[0];
  }

  // close-up: 2.4–3 m from the pilot's chest, from the open side (profile first), clear line to the chest and the hands
  function closeCamera(ang) {
    const P = DBG.player, chest = { x: P.x, y: P.y + 1.1, z: P.z }; nearTrunks(P.x, P.z, 10);
    let best = null;
    for (const off of [1.45, -1.45, 1.1, -1.1, 1.9, -1.9, 0.7, -0.7, 2.4, -2.4]) for (const dist of [2.7, 2.4, 3.1]) {
      const a = ang + off, cx = P.x + Math.sin(a) * dist, cz = P.z + Math.cos(a) * dist, gy = DBG.getH(cx, cz), cy = Math.max(P.y + 1.55, gy + 1.2);
      const cam = { x: cx, y: cy, z: cz }, k = clearLine(cam, chest), inside = sdist(new (T().Vector3)(cx, cy, cz)) < 0.3;
      let tree = 0; for (const t of TRUNKS) { const d = Math.hypot(cx - t.x, cz - t.z); if (d < 1.6) tree = Math.max(tree, 1 - d / 1.6); }
      const sc = (inside ? -5 : 0) + k * 3 - tree * 2 - Math.abs(Math.abs(off) - 1.45) * 0.25 - Math.abs(dist - 2.7) * 0.2;
      if (!best || sc > best.sc) best = { sc, cam, look: { x: P.x, y: P.y + 1.0, z: P.z } };
    }
    return best;
  }
  let LABN = null;   // the contact face normal of the card being run on the lab (null: island places)
  /* lab cameras (open ground, nothing in the way): fixed, set up from the contact face before the pilot moves.
   *  profile   along the face, 4.6 m out, 1.4 m over the ground, aimed 2 m off the face: the face edge-on, the pilot's
   *            whole approach and the hands on the face in one fixed frame
   *  gap       from the far end of the corridor, looking back at the pilot walking in (both walls in frame)
   *  over      above and to the side (45°), 7 m — the rock and the pilot from above
   *  close     2.6 m from the pilot along the face (profile), chest height */
  const hz = (v, ang) => { let x = v ? v.x : Math.sin(ang), z = v ? v.z : Math.cos(ang); const l = Math.hypot(x, z); if (l < 0.3) { x = Math.sin(ang); z = Math.cos(ang); return { x, z }; } return { x: x / l, z: z / l }; };
  const rotH = (d, a) => ({ x: d.x * Math.cos(a) + d.z * Math.sin(a), z: -d.x * Math.sin(a) + d.z * Math.cos(a) });
  function freeCam(cam, looks) { if (sdist(new (T().Vector3)(cam.x, cam.y, cam.z)) < 0.4) return false; for (const l of looks) if (clearLine(cam, l) < 0.999) return false; return true; }
  const MOON = { x: 0.77, z: 0.56 };   // open-world.html MOON_DIR (the moon in the sky texture): cameras look away from it
  // the drop scenario: from the side, framing the top and the landing ground beyond the edge
  function dropCamera(S, ang) {
    const u = { x: Math.sin(ang), z: Math.cos(ang) }, t = { x: u.z, z: -u.x }, m = { x: S.x + u.x * (S.r * 0.6 + 1), z: S.z + u.z * (S.r * 0.6 + 1) }, g = DBG.getH(m.x, m.z);
    const look = { x: m.x, y: g + 1.0, z: m.z }, sg0 = (t.x * MOON.x + t.z * MOON.z) > 0 ? 1 : -1;
    for (const dist of [6.5, 8, 5]) for (const sg of [sg0, -sg0]) { const x = m.x + t.x * sg * dist, z = m.z + t.z * sg * dist, cam = { x, y: Math.max(DBG.getH(x, z) + 1.8, g + 1.6), z }; if (freeCam(cam, [look])) return { cam, look, view: 'drop' }; }
    return null;
  }
  function labCamera(S, pc, n, ang) {
    const u = { x: Math.sin(ang), z: Math.cos(ang) };   // from the rock towards the pilot's start
    if (S.id === 'gap' && Math.abs(Math.sin(ang - (S.ang0 || 0))) < 0.5) {
      const g = DBG.getH(S.x, S.z);
      for (const back of [5.5, 7, 8.5, 4.5]) for (const hy of [1.7, 2.6]) { const cam = { x: S.x - u.x * back, y: g + hy, z: S.z - u.z * back }, look = { x: S.x + u.x * 1.2, y: g + 0.9, z: S.z + u.z * 1.2 };
        if (freeCam(cam, [look])) return { cam, look, view: 'gap' }; }
      return { cam: { x: S.x - u.x * 3, y: g + 5, z: S.z - u.z * 3 }, look: { x: S.x + u.x, y: g + 0.8, z: S.z + u.z }, view: 'gap-high' };
    }
    const nh = hz(n, ang), t = { x: nh.z, z: -nh.x }, L = { x: pc.x + nh.x * 2, z: pc.z + nh.z * 2 }, gl = DBG.getH(L.x, L.z), look = { x: L.x, y: gl + 0.9, z: L.z };
    const face = { x: pc.x + nh.x * 0.4, y: pc.y, z: pc.z + nh.z * 0.4 }, start = { x: pc.x + nh.x * 4, y: gl + 1, z: pc.z + nh.z * 4 };
    // the side that looks away from the moon first (no glare in the frame)
    const mx = MOON.x, mz = MOON.z;
    const sgs = (t.x * mx + t.z * mz) > 0 ? [1, -1] : [-1, 1];   // camera on the moon's side looks away from it
    for (const tilt of [0, 0.2, 0.4, 0.6]) for (const sg of sgs) {
      const d0 = { x: t.x * sg, z: t.z * sg }, d = rotH(d0, sg * tilt), cx = L.x + d.x * 4.6, cz = L.z + d.z * 4.6;   // tilt: turn out towards the open side
      const dd = { x: d0.x * Math.cos(tilt) + nh.x * Math.sin(tilt), z: d0.z * Math.cos(tilt) + nh.z * Math.sin(tilt) }, ex = L.x + dd.x * 4.6, ez = L.z + dd.z * 4.6;
      for (const [x, z] of [[ex, ez], [cx, cz]]) { const cam = { x, y: Math.max(DBG.getH(x, z) + 1.4, gl + 1.2), z }; if (freeCam(cam, [look, face, start])) return { cam, look, view: 'profile' }; }
    }
    return null;
  }
  // taken at the end of the card: frames the contact point AND wherever the pilot ended up
  function overCamera(S, pc, n, ang) {
    const P = DBG.player, nh = hz(n, ang), m = { x: (pc.x + nh.x * 1.2 + P.x) / 2, z: (pc.z + nh.z * 1.2 + P.z) / 2 }, sep = Math.hypot(P.x - pc.x, P.z - pc.z);
    const g = DBG.getH(m.x, m.z), look = { x: m.x, y: g + 0.6, z: m.z }, D = Math.max(5.5, sep * 0.9 + 3), H = D * 0.75;
    for (const a of [0.8, -0.8, 0.4, -0.4, 1.2, -1.2, 0]) { const d = rotH(nh, a), cam = { x: look.x + d.x * D, y: g + H, z: look.z + d.z * D }; if (freeCam(cam, [look, { x: P.x, y: P.y + 1, z: P.z }])) return { cam, look }; }
    return { cam: { x: look.x + nh.x * D, y: g + H + 1.5, z: look.z + nh.z * D }, look };
  }
  function labClose(n, ang) {
    const P = DBG.player, nh = hz(n, ang), t = { x: nh.z, z: -nh.x }, chest = { x: P.x, y: P.y + 1.0, z: P.z };
    for (const out of [0.3, 0.8, 1.3]) for (const sg of [1, -1]) { const x = P.x + t.x * sg * (window.RG_CLOSE || 2.6) + nh.x * out, z = P.z + t.z * sg * (window.RG_CLOSE || 2.6) + nh.z * out, cam = { x, y: Math.max(P.y + (window.RG_CLOSE ? 1.1 : 1.3), DBG.getH(x, z) + 1.0), z };
      if (freeCam(cam, [chest])) return { cam, look: chest }; }
    return null;
  }
  async function shotFrom(c, name) {
    if (!c) return false; const keep = DBG.camOv; DBG.camOv = { pos: [c.cam.x, c.cam.y, c.cam.z], look: [c.look.x, c.look.y, c.look.z] };
    await wait(60); if (window.__nodeShot) await window.__nodeShot(name); DBG.camOv = keep; return true;
  }
  // the frame the player sees: the game's own camera (no override)
  async function gameShot(name) { const keep = DBG.camOv; DBG.camOv = null; await wait(90); if (window.__nodeShot) await window.__nodeShot(name); DBG.camOv = keep; return true; }
  async function closeShot(name, ang) {
    if (LABN) return shotFrom(labClose(LABN, ang) || closeCamera(ang), name);
    const c = closeCamera(ang), keep = DBG.camOv; if (!c) return false;
    DBG.camOv = { pos: [c.cam.x, c.cam.y, c.cam.z], look: [c.look.x, c.look.y, c.look.z] };
    await wait(60); if (window.__nodeShot) await window.__nodeShot(name);
    DBG.camOv = keep; return true;
  }

  /* ---------------------------------------------------------------- scenarios */
  // keys: WASD relative to the game camera's yaw (cam.yaw = the approach facing; the shot camera is DBG.camOv, separate)
  const SCEN = {
    walk:  { dist: 4.5, ms: 6500, shots: [300, 1400, 2400, 3400, 4800, 6300] },
    run:   { dist: 12,  ms: 6000, shots: [200, 900, 1500, 2100, 3200, 5800] },
    along: { dist: 4.5, ms: 7500, shots: [500, 2200, 3200, 4200, 5600, 7300] },
    holdw: { dist: 4.5, ms: 6500, shots: [300, 1500, 2600, 3700, 5000, 6300] },
    jump:  { dist: 5.5, ms: 5500, shots: [200, 900, 1300, 1800, 2800, 5300] },
    // seats only: walk up, turn the back to the rock, stand still
    sit:   { dist: 3.0, ms: 7500, shots: [300, 1500, 2700, 3900, 5500, 7300] },
    // drop only: start on the flat top, walk off the edge towards the side
    down:  { dist: 0,   ms: 5000, shots: [200, 900, 1600, 2400, 3400, 4800] },
  };
  RG.SCEN = Object.keys(SCEN);
  // measuring self-check: the middle of each spot's rock must read as inside (< 0), a point 1 m above its top as outside
  RG.selfTest = function () {
    RG.spots(); const THREE = T();
    return SPOTS.filter((s) => s.e).map((s) => { nearRocks(s.x, s.z, s.r + 2); const b = s.e.box, m = new THREE.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
      return { id: s.id, rocks: NEAR.length, midCm: Math.round(sdist(m) * 100), aboveCm: Math.round(sdist(m.clone().setY(b.max[1] + 1)) * 100) }; });
  };
  // per-card truth numbers from BODYCONTACT (see body-spec.js): everything in cm, negative = inside the rock
  function truthOf(J) {
    const r1 = (x) => x == null ? null : +x.toFixed(1), min = (a) => a.length ? Math.min(...a) : null;
    const deepest = (skip) => { let w = { part: null, cm: 0 }; for (const k in J.allDeep) { if (skip(k)) continue; if (J.allDeep[k] > w.cm) w = { part: k, cm: J.allDeep[k] }; } return w; };
    const body = deepest((k) => /^boot/.test(k)), boot = deepest((k) => !/^boot/.test(k));
    const acts = {}, all = { palm: [], fingers: [], fore: [], torso: [] };
    for (const [name, A] of Object.entries(J.acts)) {
      const expect = TORSO_TOUCH.test(name) ? 'touch' : TORSO_AVOID.test(name) ? 'avoid' : null;
      acts[name] = { n: A.n, expect, palmMed: r1(med(A.palm)), palmMin: r1(min(A.palm)), fingersMed: r1(med(A.fingers)), fingersMin: r1(min(A.fingers)),
        foreMed: r1(med(A.fore)), foreMin: r1(min(A.fore)), torsoMed: r1(med(A.torso)), torsoMin: r1(min(A.torso)), torsoMax: r1(A.torso.length ? Math.max(...A.torso) : null) };
      for (const k of Object.keys(all)) all[k].push(...A[k]);
    }
    return { worstInsideCm: r1(body.cm), worstInsidePart: body.part, bootInsideCm: r1(boot.cm), bootInsidePart: boot.part,
      insideOver1: body.cm > 1, anyInsideOver1: Math.max(body.cm, boot.cm) > 1,
      palmGapMedCm: r1(med(all.palm)), palmGapMinCm: r1(min(all.palm)), fingersGapMedCm: r1(med(all.fingers)), fingersGapMinCm: r1(min(all.fingers)),
      forearmGapMedCm: r1(med(all.fore)), forearmGapMinCm: r1(min(all.fore)), torsoGapMedCm: r1(med(all.torso)), torsoGapMinCm: r1(min(all.torso)),
      measureMs: J.bcN ? { mean: +(J.bcMs / J.bcN).toFixed(2), max: +J.bcMax.toFixed(2), n: J.bcN } : null,
      byPart: Object.fromEntries(Object.entries(J.allDeep).map(([k, d]) => [k, r1(d)])), byAction: acts, samples: Object.values(J.acts).reduce((a, A) => a + A.n, 0) };
  }
  // one BODYCONTACT sample while an action is in its contact phase: per action, palm / fingers / forearm gaps of the hands the
  // decision puts on the rock (cm, negative = inside) and the torso gap (chest / pelvis / shoulder) when the action cares
  function bcSample(J, res, d) {
    const A = J.acts[d.action] = J.acts[d.action] || { n: 0, palm: [], fingers: [], fore: [], torso: [], upper: [] };
    A.n++;
    for (const h of d.hands) { const s = /_([lr])$/.exec(h); if (!s) continue; const P = res.parts['palm_' + s[1]], F = res.parts['fingers_' + s[1]], R = res.parts['forearm_' + s[1]];
      if (P && P.minSignedCm != null) A.palm.push(P.minSignedCm); if (F && F.minSignedCm != null) A.fingers.push(F.minSignedCm); if (R && R.minSignedCm != null) A.fore.push(R.minSignedCm); }
    const t = BODYCONTACT.gap(res, ['chest', 'pelvis', 'shoulder']); if (t) A.torso.push(t.cm);
  }

  RG.card = async function (spotId, side, scen, shotPrefix) {
    RG.spots(); const S = SPOTS.find((s) => s.id === spotId); if (!S || S.missing) return { error: 'no spot ' + spotId };
    const sc = SCEN[scen]; if (!sc) return { error: 'no scenario ' + scen };
    const P = DBG.player, K = DBG.keys, CT = INTERACTION.CT, ang = (S.ang0 || 0) + side * Math.PI / 2;
    for (const k of Object.keys(K)) K[k] = false;
    const across = S.id === 'gap' && Math.abs(Math.sin(ang - (S.ang0 || 0))) > 0.5;   // lab gap: from the side = at one rock's outer face
    const R = (S.id === 'gap' ? (across && S.rAcross ? S.rAcross : 1.2) : S.r) + sc.dist;
    const sx = S.x + Math.sin(ang) * R, sz = S.z + Math.cos(ang) * R, face = ang;   // forward (−sin face, −cos face) = toward the centre
    if (scen === 'down' && S.e) {   // on the flat top, facing out over the side's edge
      const top = window.INTERACT.castOn(S.e, S.x, S.e.box.max[1] + 1, S.z, 0, -1, 0, 4), fo = ang + Math.PI;
      DBG.teleport(S.x, S.z, fo, top ? top.point.y + 0.05 : undefined); P.face = fo; P.c.g.rotation.y = fo; DBG.cam.yaw = fo;
    } else { DBG.teleport(sx, sz, face); P.face = face; P.c.g.rotation.y = face; DBG.cam.yaw = face; }
    if (CT) { CT.state = 'idle'; CT.pick = null; CT.plan = null; CT.sense = null; CT.wantIntent = 'none'; CT.senseT = 0.3; }
    await wait(900);
    const rec0 = {};
    nearRocks(S.x, S.z, S.r + 6);
    // contact point: the first drawn rock along the approach line at chest height
    let pc = { x: S.x, y: DBG.getH(S.x, S.z) + 1, z: S.z };
    { const THREE = T(); let best = null;
      // chest, knee, then aimed at the rock's middle (a low rock on lower ground is under a level chest ray)
      const my = S.e ? (S.e.box.min[1] + S.e.box.max[1]) / 2 : P.y + 0.8;
      for (const [oy, ty] of [[1, null], [0.5, null], [0.9, my]]) {
        const o = new THREE.Vector3(P.x, P.y + oy, P.z), d = ty == null ? new THREE.Vector3(-Math.sin(face), 0, -Math.cos(face)) : new THREE.Vector3(S.x - P.x, ty - o.y, S.z - P.z).normalize();
        for (const n of NEAR) { const r = new THREE.Ray(o, d); let h = null; try { h = n.g.boundsTree.raycastFirst(r, THREE.DoubleSide); } catch (err) { h = null; } if (h && (!best || h.distance < best.distance)) best = h; }
        if (best) break;
      }
      if (best) pc = { x: best.point.x, y: Math.max(best.point.y, DBG.getH(best.point.x, best.point.z) + 0.9), z: best.point.z };
      if (best && best.face) { const nn = best.face.normal.clone(); if (nn.x * Math.sin(face) + nn.z * Math.cos(face) < 0) nn.negate(); rec0.n = { x: nn.x, z: nn.z }; } }
    rec0.pc = !!(pc.x !== S.x); skin(); effGap('hand_l');   // build the skin sets before the clock starts
    LABN = S.lab ? (rec0.n || { x: Math.sin(ang), z: Math.cos(ang) }) : null;
    const cam = (S.lab && scen === 'down' && dropCamera(S, ang)) || (S.lab && labCamera(S, pc, rec0.n, ang)) || pickCamera(pc, ang); rec0.view = cam.view || 'auto';
    DBG.camOv = { pos: [cam.cam.x, cam.cam.y, cam.cam.z], look: [cam.look.x, cam.look.y, cam.look.z] };
    await wait(250);

    const J = { n: 0, touchT: 0, airT: 0, hangT: 0, contactT: 0, contRun: 0, insideT: 0, deep: {}, allDeep: {}, acts: {}, idleRun: 0, idleMax: 0, teleports: 0, tlog: [], jerks: 0, snaps: 0, prev: null, pv: null, gameDone: false };
    const rec = { spot: spotId, side, scen, ang: +ang.toFixed(2), shots: [], samples: 0, sigChanges: 0, clipChanges: 0, flips: 0, actions: {}, handT: 0, handAirT: 0, handGaps: [], insideMax: 0, insidePart: null, footInside: 0, reachedContact: false, climbed: false, minDist: Infinity, src: '' };
    const t0 = performance.now(); let lastSig = null, lastClip = null, hist = [], shotI = 0, alongPh = 0, jumped = false, lastJ = 0;
    while (true) {
      const t = performance.now() - t0; if (t > sc.ms) break;
      // lab: the pilot walked past / over the rock (> r + 1.2 beyond its centre along the approach) → no more input
      if (S.lab && !rec.passed && (P.x - S.x) * Math.sin(ang) + (P.z - S.z) * Math.cos(ang) < -((S.id === 'gap' ? 3 : S.r) + 1.2)) { rec.passed = Math.round(t); }
      if (rec.passed) { for (const k of Object.keys(K)) K[k] = false; }
      // input
      if (rec.passed) { /* stopped */ }
      else if (scen === 'walk') { K.KeyW = t < 4200 && !(rec.reachedContact && t > 400); }
      else if (scen === 'run') { K.ShiftLeft = t < 4200; K.KeyW = t < 4200 && !(rec.reachedContact && t > 400 && Math.hypot(P.vx, P.vz) < 1); }
      else if (scen === 'holdw') { K.KeyW = t < 5600; }
      else if (scen === 'along') {
        if (alongPh === 0) { K.KeyW = true; if (rec.reachedContact || t > 2600) { alongPh = 1; rec.alongAt = Math.round(t); } }
        const ta = t - (rec.alongAt || 1e9);
        if (alongPh === 1) { K.KeyW = false; K.KeyA = ta > 200 && ta < 1900; K.KeyD = ta > 2600 && ta < 4300; }
      } else if (scen === 'sit') {
        if (!rec.sitPh) { K.KeyW = true; if (sdist(new (T().Vector3)(P.x, P.y + 0.6, P.z)) < 0.75 || t > 2600) { rec.sitPh = 1; rec.sitAt = t; } }
        else { const ts = t - rec.sitAt; K.KeyW = false; K.KeyS = ts < 260; }
      } else if (scen === 'down') { K.KeyW = t > 300 && t < 1500;   // off the edge and a step or two beyond, still in frame
      } else if (scen === 'jump') { K.ShiftLeft = t < 1500; K.KeyW = t < 2600; if (!jumped && t > 850) { DBG.pressed.add('Space'); jumped = true; } }
      // sample
      const d = decision(), sig = d.state + '|' + d.action; rec.src = d.src; rec.samples++;
      if (lastSig !== null && sig !== lastSig) { rec.sigChanges++; if (hist.length && hist[hist.length - 1].sig === sig && t - hist[hist.length - 1].t < 700) rec.flips++; hist.push({ sig: lastSig, t }); if (hist.length > 6) hist.shift(); }
      if (lastClip !== null && d.clip !== lastClip) rec.clipChanges++;
      lastSig = sig; lastClip = d.clip;
      if (d.action) rec.actions[d.action] = (rec.actions[d.action] || 0) + 1;
      if (/play|hold|touch|lean|rest|brace|climb/.test(d.state) && d.action) rec.reachedContact = true;
      if (d.state === 'climb') rec.climbed = true;
      if (rec.samples % 2 === 0) {
        for (const h of d.hands) { const g = effGap(h); if (!isFinite(g)) continue; rec.handT++; rec.handGaps.push(+(g * 100).toFixed(1)); if (g > 0.06) rec.handAirT++; }
        const bi = bodyInside(); if (bi.depth > rec.insideMax) { rec.insideMax = bi.depth; rec.insidePart = bi.part; }
        for (const f of ['foot_l', 'foot_r']) { const g = effGap(f); if (g < -0.05) rec.footInside++; }
        const ds = sdist(new (T().Vector3)(P.x, P.y + 1, P.z)); if (ds < rec.minDist) rec.minDist = ds;
      }
      // JUDGE — only the drawn body and the drawn rocks
      // game time, not wall time: a screenshot stalls the page, the game then advances ≤ 0.05 s per frame
      { const gt = DBG.G.time, dtj = J.gt === undefined ? 0 : gt - J.gt; J.gt = gt; lastJ = t; J.n++;
        const dr = drawnRoot();
        if (J.prev && dtj > 0.004) {
          const vx = (dr.r.x - J.prev.r.x) / dtj, vy = (dr.r.y - J.prev.r.y) / dtj, vz = (dr.r.z - J.prev.r.z) / dtj, step = Math.hypot(dr.r.x - J.prev.r.x, dr.r.z - J.prev.r.z);
          // a step the body's own speed (+ the controller's 60 m/s² acceleration) cannot explain = a teleport / snap
          const exp = (J.pv ? Math.hypot(J.pv.x, J.pv.z) : 0) * dtj + 30 * dtj * dtj;
          if (step - exp > 0.12) { J.teleports++; if (J.tlog.length < 8) J.tlog.push({ t: Math.round(t), cm: Math.round(step * 100), expCm: Math.round(exp * 100), dtMs: Math.round(dtj * 1000), st: d.state, act: d.action, clip: d.clip }); }
          else if (J.pv && Math.hypot(vx - J.pv.x, vy - J.pv.y, vz - J.pv.z) / dtj > 45) J.jerks++;
          const hx = dr.h.x - dr.r.x, hy = dr.h.y - dr.r.y, hz2 = dr.h.z - dr.r.z, px = J.prev.h.x - J.prev.r.x, py = J.prev.h.y - J.prev.r.y, pz = J.prev.h.z - J.prev.r.z;
          if (Math.hypot(hx - px, hy - py, hz2 - pz) > 0.1) J.snaps++;
          J.pv = { x: vx, y: vy, z: vz };
        }
        J.prev = { r: dr.r.clone(), h: dr.h.clone() };
        let touching = false;
        for (const eff of ['hand_l', 'hand_r']) { const g = gloveState(eff); if (!g || !isFinite(g.gap) || g.gap > 0.4) continue;
          if (g.gap <= 0.03) { J.touchT += dtj; touching = true; } else if (g.raised) J.airT += dtj; else J.hangT += dtj; }
        if (J.n % 3 === 0) {
          const bs = bodyScan(); J.last = bs; if (bs.err) J.err = bs.err;
          if (bs.res) { J.bcN = (J.bcN || 0) + 1; J.bcMs = (J.bcMs || 0) + bs.res.ms; J.bcMax = Math.max(J.bcMax || 0, bs.res.ms); }
          if (bs.res && /play|hold|touch|lean|rest|brace|climb/.test(d.state) && d.action) bcSample(J, bs.res, d);
          if (bs.res) for (const k in bs.res.parts) { const m = bs.res.parts[k].minSignedCm; if (m != null && m < 0 && -m > (J.allDeep[k] || 0)) J.allDeep[k] = -m; }
          let inNow = false; for (const [part, d] of Object.entries(bs.deep)) { if (d > (J.deep[part] || 0)) J.deep[part] = d; if (part !== 'foot' && d > 0.02) inNow = true; }
          if (inNow) J.insideT += dtj * 3;
          J.anyTouch = Object.values(bs.gap).some((g) => g <= 0.03) || Object.entries(bs.deep).some(([pt, d]) => pt !== 'foot' && d > 0);
        }
        const inContact = touching || J.anyTouch;
        J.contRun = inContact ? J.contRun + dtj : 0; if (inContact) J.contactT += dtj;
        const chest = sdist(new (T().Vector3)(P.x, P.y + 1.1, P.z)), still = Math.hypot(P.vx, P.vz) < 0.3;
        J.idleRun = still && chest < 0.6 && !inContact ? J.idleRun + dtj : 0; if (J.idleRun > J.idleMax) J.idleMax = J.idleRun;
        // the player's own view, once, half a second into the first judged contact
        if (!J.gameDone && J.contRun > 0.5) { J.gameDone = true; const name = shotPrefix + '_p'; if (await gameShot(name)) rec.shots.push({ f: name + '.jpg', t: Math.round(t), st: d.state, act: d.action, clip: d.clip, game: true }); }
      }
      // close-up: once, 0.7 s into the first contact (hands on the rock, a lean, a seat) — the contact seen from ~2.7 m
      if (!rec.closeDone) {
        if (J.contRun > 0.7) {
          rec.closeDone = true; const name = shotPrefix + '_c';
          if (await closeShot(name, ang)) rec.shots.push({ f: name + '.jpg', t: Math.round(t), st: d.state, act: d.action, clip: d.clip, close: true });
          continue;
        }
      }
      // frames
      if (shotI < sc.shots.length && t >= sc.shots[shotI]) {
        const name = shotPrefix + '_' + shotI; rec.shots.push({ f: name + '.jpg', t: Math.round(t), st: d.state, act: d.action, clip: d.clip });
        shotI++; if (window.__nodeShot) await window.__nodeShot(name);
      } else await wait(50);
    }
    if (!J.gameDone) { const name = shotPrefix + '_p'; if (await gameShot(name)) rec.shots.push({ f: name + '.jpg', t: Math.round(sc.ms), st: 'end', act: '', clip: '', game: true }); }
    if (!rec.closeDone) { const name = shotPrefix + '_c'; if (await closeShot(name, ang)) rec.shots.push({ f: name + '.jpg', t: Math.round(sc.ms), st: 'end', act: '', clip: '', close: true }); }
    const over = S.lab ? overCamera(S, pc, rec0.n, ang) : null;
    if (over) { const name = shotPrefix + '_o'; if (await shotFrom(over, name)) rec.shots.push({ f: name + '.jpg', t: Math.round(sc.ms), st: 'end', act: '', clip: '', over: true }); }
    for (const k of Object.keys(K)) K[k] = false;
    const secs = sc.ms / 1000, gs = rec.handGaps.slice().sort((a, b) => a - b);
    const out = {
      spot: rec.spot, side: rec.side, scen: rec.scen, ang: rec.ang, src: rec.src, shots: rec.shots,
      actions: Object.entries(rec.actions).sort((a, b) => b[1] - a[1]).map(([k]) => k),
      changesPerS: +(rec.sigChanges / secs).toFixed(2), clipChangesPerS: +(rec.clipChanges / secs).toFixed(2), flips: rec.flips,
      contact: rec.reachedContact, climbed: rec.climbed, onTop: P.y - DBG.getH(P.x, P.z) > 0.35 && sdist(new (T().Vector3)(P.x, P.y - 0.1, P.z)) < 0.25,
      handAirPct: rec.handT ? Math.round(rec.handAirT / rec.handT * 100) : null, handGapMedCm: gs.length ? gs[Math.floor(gs.length / 2)] : null,
      insideCm: +(rec.insideMax * 100).toFixed(1), insidePart: rec.insidePart, footInside: rec.footInside, minDistCm: isFinite(rec.minDist) ? +(rec.minDist * 100).toFixed(0) : null,
      cam: DBG.camOv, pcHit: rec0.pc, view: rec0.view,
      truth: truthOf(J),
      // JUDGE (drawn body vs drawn rock) — the verdict numbers
      judge: {
        contact: J.contactT >= 0.3, contactS: +J.contactT.toFixed(2),
        penCm: +(Math.max(0, ...Object.entries(J.deep).filter(([pt]) => pt !== 'foot').map(([, d]) => d)) * 100).toFixed(1),
        penPart: (Object.entries(J.deep).filter(([pt]) => pt !== 'foot').sort((a, b) => b[1] - a[1])[0] || [null])[0],
        penByPart: Object.fromEntries(Object.entries(J.deep).map(([pt, d]) => [pt, +(d * 100).toFixed(1)])),
        footPenCm: +((J.deep.foot || 0) * 100).toFixed(1), insideS: +J.insideT.toFixed(2),
        touchS: +J.touchT.toFixed(2), airS: +J.airT.toFixed(2), hangS: +J.hangT.toFixed(2), idleNearS: +J.idleMax.toFixed(2),
        bodyContactErr: J.err || null,
        teleports: J.teleports, teleLog: J.tlog, jerks: J.jerks, snaps: J.snaps, clipsPerS: +(rec.clipChanges / secs).toFixed(2),
      },
    };
    DBG.camOv = null; LABN = null;
    return out;
  };
})();
