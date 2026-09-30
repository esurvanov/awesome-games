/* Module "rock-brain" — the ONE owner of what the pilot does at a rock (Passport names rock*, st_rock*, boulder*).
 *
 *  read      the rock around the pilot is read from its DRAWN triangles (Passport e.geo + three-mesh-bvh via
 *            INTERACT.castOn), never from the physics hull: every face the pilot could use within ~3 m gets a vertical
 *            profile (face distance every 0.2 m of height), the top (height, flat, deep), the tilt, the facade width and
 *            roundness, the gap to the next rock. Cached per rock + 25 cm cell of the face.
 *  choose    one vocabulary for the rock and the actions: every action states what it needs in the same words the
 *            reading produces (face at its contact height, width, roundness, tilt, top height / depth, ground to stand
 *            on, room for the body at knee / hip / chest height). Choice = the cheapest action whose needs the reading
 *            meets (walk + turn + how natural it is for what the pilot is doing).
 *  pose      the whole body is fitted: stand spot from the face at the clip's own contact height, body clearance at every
 *            height, spine pitch / roll to the face's tilt, knees for a low top, hands IK'd onto the drawn face. A fit
 *            outside the natural limits rejects the action — it is never played badly.
 *  act       notice (head turns) → brake (speed cap by the distance left) → touch / rest / climb → hold / trace along
 *            the face → release. A decision is kept until the action ends; no new decision within K.hyst s of the last.
 *            Executors only: player.speedCap (braking), C.startClimb (climb), INTERACTION.RK (lean / look / knees),
 *            the contact clips + ANIMLIB ContactLayer / LimbIK (hands), ROCKFEEL (sound / snow / marks; reads .feel).
 *
 * The old rock mechanisms in modules/interaction.js are gone; its generic contact path never acts on a rock while this
 * module is on (window.ROCKBRAIN.K.on). Checks for tools: STATS (decision switches / s, hands in the air, body inside
 * the rock), lastChoice, debug().
 */
(function () {
  let C = null, T3 = null;
  const K = {
    on: true, radius: 4.2, restDelay: 0.9, hyst: 0.6, brakeRange: 3.4, touchSpeed: 2.4, steerSpeed: 1.5, steerTurn: 5, steerMax: 1.6,
    maxMove: 1.0, maxTurn: 3.2, reachTol: 0.16, pitchMax: 0.3, walkTouch: true, climb: true, debug: false,
    armFar: 0.7, pushClimb: 0.8, stepUp: 0.5, sitStill: 1.0, sitTurn: 1.75, walkTouchCool: 0.8, lookHold: 0.3,
    physMove: !/[?&]nophysmove\b/.test(location.search), holdSpeed: 1.2, poseBan: 5,   // physMove: the stand spot is a GOAL for the controller (physics.js setGoal), never a position write (except the squeeze / step-up, whose controller is off)
  };
  const STATS = { frames: 0, scans: 0, reads: 0, rays: 0, fits: 0, choices: 0, starts: 0, switchRate: 0, holdFrames: 0, airFrames: 0, insideFrames: 0,
    handGapCm: null, rejected: {}, acts: {}, climbs: 0, brakes: 0, walkTouchFrames: 0, ms: 0, msMax: 0, err: null };
  const ROCK_RE = /^(st_)?(rock|boulder)/i;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrapA = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  const rej = (k) => { STATS.rejected[k] = (STATS.rejected[k] || 0) + 1; return null; };
  const isRockTag = (t) => !!(t && t.name && ROCK_RE.test(String(t.name)));

  /* ---------------------------------------------------------------- state */
  const S = { state: 'free', t: 0, plan: null, lastEnd: -9, stillT: 0, restMiss: null, pushT: 0, look: null, starts: [], hand: null, arrive: 0,
    phase: null, intoT: 0, awayT: 0, abs: 0, breathT: 0, checkN: 0, gaps: [], wt: { w: 0, side: 1, off: 0, tgt: null, n: null, e: null } };
  const feel = { active: false, plan: null, trace: 0, amp: 0.5, rel: 0, m: null, sidleMul: 1 };

  let _ray = null;
  /* ---------------------------------------------------------------- rocks near the pilot */
  const RC = new Map();   // rock id + 25 cm cell of the face point → reading
  // Passport entries are re-registered (vegetation rebuilds its rocks, quality changes): the count can stay the same while
  // the entries are new — the list is rebuilt when an entry it holds died, when the count changes, or every 2 s
  let LIST = null, LN = -1, LT = -9, NEAR = [];
  function rocks() {
    const L = (C.Passport && C.Passport.list) || [];
    if (!LIST || LN !== L.length || C.T - LT > 2 || LIST.some((e) => e.alive === false)) {
      const nl = L.filter((e) => e && e.alive !== false && e.box && e.geo && e.role !== 'pushable' && e.role !== 'trunk' && ROCK_RE.test(String(e.name || '')));
      if (!LIST || nl.length !== LIST.length || nl.some((e, k) => e !== LIST[k])) RC.clear();   // readings belong to the old entries
      LIST = nl; LN = L.length; LT = C.T;
    }
    return LIST;
  }
  function nearRocks(x, y, z, r) {
    const out = [];
    for (const e of rocks()) {
      if (e.alive === false) continue; const b = e.box;
      if (x < b.min[0] - r || x > b.max[0] + r || z < b.min[2] - r || z > b.max[2] + r || y > b.max[1] + 0.6 || y < b.min[1] - 3) continue;
      out.push(e);
    }
    return out;
  }
  // first hit on the DRAWN triangles of the rocks near the pilot (or of one rock) → {point, normal (toward the origin), distance, e}
  function cast(ox, oy, oz, dx, dy, dz, far, only) {
    const I = window.INTERACT; if (!I || !I.castOn) return null;
    let best = null;
    for (const e of only ? [only] : NEAR) {
      STATS.rays++;
      let h = null; try { h = I.castOn(e, ox, oy, oz, dx, dy, dz, far); } catch (err) { h = null; }
      if (h && (!best || h.distance < best.distance)) { best = h; best.e = e; }
    }
    return best;
  }
  // ground to stand on at (x, z): terrain, or the top of a rock / structure there
  function ground(x, z, yRef) {
    let y = C.groundH(x, z), ny = C.normalY ? C.normalY(x, z) : 1, on = null;
    // from knee height: a ray from above would land on the bulge of a rock overhanging the spot (the spot is still ground)
    const h = cast(x, yRef + 0.75, z, 0, -1, 0, 3.2);
    if (h && h.point.y > y + 0.06) { y = h.point.y; ny = h.normal.y; on = h.e; }
    const PH = C.PH;
    if (PH && PH.ok) {
      const p = PH.P.raycast({ x, y: yRef + 0.75, z }, { x: 0, y: -1, z: 0 }, 3.2, { groups: PH.P.groups.STATIC });
      if (p && !isRockTag(p.tag) && !(p.tag && p.tag.kind === 'terrain') && p.point.y > y + 0.06) { y = p.point.y; ny = p.normal ? p.normal.y : 1; on = 'solid'; }
    }
    return { y, ny, on };
  }

  /* ---------------------------------------------------------------- reading one face */
  const HS = [0.15, 0.35, 0.55, 0.75, 0.95, 1.15, 1.35, 1.55, 1.75, 1.95, 2.2];
  const OUT = 0.8;        // the profile column stands this far out from the face point
  function readFace(e, q, nx, nz) {
    const key = e.id + ':' + Math.round(q.x * 4) + ',' + Math.round(q.z * 4) + ':' + Math.round(Math.atan2(nx, nz) * 4);
    const c = RC.get(key); if (c && C.T - c.at < 20) return c;
    STATS.reads++;
    const ox = q.x + nx * OUT, oz = q.z + nz * OUT, g = ground(ox, oz, q.y).y, tx = -nz, tz = nx;
    // vertical profile: face distance (from the face point's plane) at every height; another rock in front = crowded
    const fd = HS.map((h) => { const hit = cast(ox, g + h, oz, -nx, 0, -nz, OUT + 2.6); return hit && hit.e === e ? hit.distance - OUT : null; });
    let top = -1; for (let i = 0; i < HS.length; i++) if (fd[i] !== null) top = i;
    const r = { at: C.T, key, e, q: { x: q.x, y: q.y, z: q.z }, nx, nz, tx, tz, g, fd, topH: 0, topY: g, topFlat: false, topDeep: false, topPt: null, tall: false, tilt: 0, width: 0, round: 0, gap: 9, lowest: null };
    if (top < 0) { RC.set(key, r); return r; }
    for (let i = 0; i < HS.length; i++) if (fd[i] !== null) { r.lowest = HS[i]; break; }
    r.tall = top === HS.length - 1;
    // top: straight down just inside the rim (and 0.45 m further in: a deep top)
    const rimIn = OUT + fd[top] + 0.28, t1 = cast(ox - nx * rimIn, g + 3.4, oz - nz * rimIn, 0, -1, 0, 3.6, e);
    if (t1) {
      r.topY = t1.point.y; r.topH = t1.point.y - g; r.topPt = { x: t1.point.x, y: t1.point.y, z: t1.point.z }; r.topFlat = t1.normal.y > 0.8;
      const t2 = cast(ox - nx * (rimIn + 0.45), g + 3.4, oz - nz * (rimIn + 0.45), 0, -1, 0, 3.6, e);
      r.topDeep = !!(t2 && t2.normal.y > 0.75 && Math.abs(t2.point.y - t1.point.y) < 0.15);
      const t3 = r.topDeep ? t2 : cast(ox - nx * (rimIn + 0.18), g + 3.4, oz - nz * (rimIn + 0.18), 0, -1, 0, 3.6, e);
      r.topSeat = r.topFlat && !!(t3 && t3.normal.y > 0.8 && Math.abs(t3.point.y - t1.point.y) < 0.08);
      if (r.tall && r.topH < HS[top]) r.topH = HS[top] + 0.1;
    } else r.topH = HS[top] + 0.1;
    // tilt of the face over the chest band: > 0 = the face leans away going up (a ramp), < 0 = overhang
    const a = fdAt(r, 0.95), b = fdAt(r, 1.55);
    if (a !== null && b !== null) r.tilt = Math.atan2(b - a, 0.6); else { const a2 = fdAt(r, 0.35), b2 = fdAt(r, 0.75); if (a2 !== null && b2 !== null) r.tilt = Math.atan2(b2 - a2, 0.4); }
    // facade at hand height: flat width across the face, roundness = how fast it falls away sideways
    const hw = clamp(r.topH - 0.2, 0.35, 1.3), d0h = cast(ox, g + hw, oz, -nx, 0, -nz, OUT + 2.6, e), d0 = d0h ? d0h.distance : null;
    if (d0 !== null) {
      let wl = 0, wr = 0, fall = [];
      for (const side of [1, -1]) {
        for (let s = 0.15; s <= 0.61; s += 0.15) {
          const h = cast(ox + tx * s * side, g + hw, oz + tz * s * side, -nx, 0, -nz, OUT + 2.6, e);
          if (Math.abs(s - 0.3) < 0.01) fall.push(h ? h.distance - d0 : 0.6);
          if (!h || Math.abs(h.distance - d0) > 0.09) break;
          if (side > 0) wl = s; else wr = s;
        }
      }
      r.width = wl + wr + 0.15; r.round = fall.length ? fall.reduce((p, v) => p + v, 0) / fall.length : 0.6;
    }
    // gap to the next rock straight out from the face (a squeeze between two rocks)
    const gp = cast(q.x + nx * 0.03, g + 1.0, q.z + nz * 0.03, nx, 0, nz, 1.8);
    if (gp) r.gap = gp.distance;
    RC.set(key, r); if (RC.size > 600) { const k0 = RC.keys().next().value; RC.delete(k0); }
    return r;
  }
  // face distance (from the face point's plane, + = further in) at height h above the column's ground, interpolated
  function fdAt(r, h) {
    for (let i = 0; i < HS.length - 1; i++) {
      if (h < HS[i] - 1e-6 || h > HS[i + 1] + 1e-6) continue;
      const a = r.fd[i], b = r.fd[i + 1];
      if (a !== null && b !== null) return a + (b - a) * (h - HS[i]) / (HS[i + 1] - HS[i]);
      if (a !== null && h - HS[i] < 0.08) return a; if (b !== null && HS[i + 1] - h < 0.08) return b;
      return null;
    }
    if (h < HS[0] && r.fd[0] !== null) return r.fd[0];
    return null;
  }
  const faceAt = (r, h) => { const d = fdAt(r, h); return d === null ? null : { x: r.q.x - r.nx * d, y: r.g + h, z: r.q.z - r.nz * d, d }; };

  // every face the pilot could use: rays all round (or in a sector) at chest and knee height → readings
  const DIRS = 16;
  function scan(P, sector, reach) {
    STATS.scans++;
    const out = [], seen = new Set();
    for (let k = 0; k < DIRS; k++) {
      const a = k / DIRS * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
      if (sector && dx * sector.x + dz * sector.z < sector.cos) continue;
      for (const hy of [1.15, 0.45, 0.22]) {   // 0.22: a knee-high seat / step is under the 0.45 ray
        const h = cast(P.x, P.y + hy, P.z, dx, 0, dz, reach); if (!h) continue;
        const nl = Math.hypot(h.normal.x, h.normal.z); if (nl < 0.4) continue;
        const nx = h.normal.x / nl, nz = h.normal.z / nl;
        const key = h.e.id + ':' + Math.round(h.point.x * 3) + ',' + Math.round(h.point.z * 3); if (seen.has(key)) break; seen.add(key);
        out.push(readFace(h.e, h.point, nx, nz));
        break;
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------- vocabulary */
  // needs, in the reading's own words:  face: contact height must be on the face · minW / maxRound: facade · tilt: [lo, hi]
  // top: [lo, hi] top height above the ground · flat / deep: the top · body: clearance (m) the body needs from the face at
  // the heights listed, measured from the stand spot along the face normal
  const ACTS = {
    lean_back:       { kind: 'wall', intents: { rest: 0.0 }, minW: 0.45, maxRound: 0.14, tilt: [-0.12, 0.45], topMin: 1.45, body: [[0.4, 0.06], [0.95, 0.07]], pitchK: 0.7, roll: 0 },
    lean_shoulder_r: { kind: 'wall', intents: { rest: 0.18, touch: 0.25 }, minW: 0.25, maxRound: 9, tilt: [-0.2, 0.4], topMin: 1.55, body: [[0.4, 0.28], [0.95, 0.3]], pitchK: 0, roll: 0.08, narrowBonus: 0.2 , relax: true },
    lean_shoulder_l: { kind: 'wall', intents: { rest: 0.18, touch: 0.25 }, minW: 0.25, maxRound: 9, tilt: [-0.2, 0.4], topMin: 1.55, body: [[0.4, 0.28], [0.95, 0.3]], pitchK: 0, roll: -0.08, narrowBonus: 0.2 , relax: true },
    hand_wall_both:  { kind: 'wall', intents: { touch: 0.0, rest: 0.35 }, minW: 0.55, maxRound: 0.1, tilt: [-0.25, 0.8], topMin: 1.45, body: [[0.35, 0.2], [0.9, 0.16], [1.2, 0.2]], pitchK: -0.45, trace: true, hands: true },
    hand_wall_r:     { kind: 'wall', intents: { touch: 0.12, rest: 0.45 }, minW: 0.15, maxRound: 9, tilt: [-0.25, 0.9], topMin: 1.45, body: [[0.35, 0.2], [0.9, 0.16], [1.2, 0.2]], pitchK: -0.4, trace: true, hands: true, narrowBonus: 0.12 , relax: true },
    hand_wall_l:     { kind: 'wall', intents: { touch: 0.12, rest: 0.45 }, minW: 0.15, maxRound: 9, tilt: [-0.25, 0.9], topMin: 1.45, body: [[0.35, 0.2], [0.9, 0.16], [1.2, 0.2]], pitchK: -0.4, trace: true, hands: true, narrowBonus: 0.12 , relax: true },
    lean_hands_ledge:{ kind: 'ledge', intents: { rest: 0.05, touch: 0.05 }, top: [0.6, 1.1], flat: true, deep: false, body: [[0.2, 0.18]], hands: true },
    // a face that leans back like a ramp (tilt > ~25°): one palm braced on it, the lead foot up against its foot
    brace_slope_r:   { kind: 'wall', intents: { touch: 0.15, rest: 0.3 }, minW: 0.2, maxRound: 9, tilt: [0.4, 1.25], topMin: 0.9, body: [[0.35, 0.02], [0.9, 0.1]], pitchK: 0, hands: true },
    brace_slope_l:   { kind: 'wall', intents: { touch: 0.15, rest: 0.3 }, minW: 0.2, maxRound: 9, tilt: [0.4, 1.25], topMin: 0.9, body: [[0.35, 0.02], [0.9, 0.1]], pitchK: 0, hands: true },
    // seats: the clip's own seat height ± what the pelvis offset (RK.dip, ≤ 6 cm) can make up; a top higher than the
    // seat would put the pelvis inside the rock, so the band sits mostly below the seat height
    sit_rock:        { kind: 'seat', intents: { rest: -0.05 }, top: [0.32, 0.49], seatH: 0.431, flat: true, deep: true, enterSpeed: 1.6 },
    sit_rock_high:   { kind: 'seat', intents: { rest: -0.05 }, top: [0.51, 0.66], seatH: 0.601, flat: true, deep: true, enterSpeed: 1.6 },
    squeeze_side:    { kind: 'gap', intents: { pass: 0 }, gap: [0.55, 1.0] },
    climb:           { kind: 'climb', intents: { climb: 0 }, top: [0.3, 2.1], flat: true, deep: true },
  };
  // clip facts from the contact metadata (character space: +Z forward, +X left; point = the contact, averaged over hands)
  const SPEC = {};
  function spec(name) {
    if (SPEC[name] !== undefined) return SPEC[name];
    const A = C.AV && C.AV.player, meta = A && A.contactMeta; if (!meta) return null;
    const loop = meta.clips[name + '_loop'] ? name + '_loop' : meta.clips[name] ? name : null;
    if (!loop || !A.acts[loop]) { SPEC[name] = false; return false; }
    const m = meta.clips[loop], cs = (m.contacts || []).filter((c) => /^hand|^foot|^upperarm|^spine|^pelvis|^thigh/.test(c.bone));
    const hs = cs.filter((c) => /^hand/.test(c.bone)), ps = hs.length ? hs : cs, c0 = ps[0], avg = (i) => ps.length ? ps.reduce((a, c) => a + c.surface.point[i], 0) / ps.length : 0;
    SPEC[name] = {
      name, clip: loop, enter: meta.clips[name + '_in'] && A.acts[name + '_in'] ? name + '_in' : null, exit: meta.clips[name + '_out'] && A.acts[name + '_out'] ? name + '_out' : null,
      contacts: cs, lat: avg(0), h: avg(1), fwd: avg(2), type: c0 ? c0.surface.type : null, nL: c0 ? [c0.surface.normal[0], c0.surface.normal[2]] : [0, -1],
      bone: c0 ? c0.bone : null, loop: m.loop !== false, dur: m.duration || 1,
    };
    return SPEC[name];
  }
  const avail = (name) => name === 'climb' ? !!(K.climb && C.startClimb) : !!spec(name);

  /* ---------------------------------------------------------------- fitting (the whole body) */
  // is the spot free for the body: nothing within `clr` at knee / chest height except the face the action uses
  function standFree(x, y, z, nx, nz, e, clr) {
    for (const hy of [0.5, 1.25]) for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, dx = Math.sin(a), dz = Math.cos(a);
      if (-(dx * nx + dz * nz) > 0.55) continue;   // toward the face in use
      const h = cast(x, y + hy, z, dx, 0, dz, clr); if (h) return false;
    }
    const PH = C.PH; if (PH && PH.ok) {
      const grp = PH.P.groups.TRUNK | PH.P.groups.PROP;
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (PH.P.raycast({ x, y: y + 1.0, z }, { x: Math.sin(a), y: 0, z: Math.cos(a) }, 0.3, { groups: grp })) return false; }
    }
    return true;
  }
  function pathFree(P, x, z, e) {
    const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz); if (d < 0.06) return true;
    const h = cast(P.x, P.y + 0.6, P.z, dx / d, 0, dz / d, d);
    return !h || h.distance > d - 0.3;
  }
  const yawFor = (nx, nz, nL) => wrapA(Math.atan2(nx, nz) - Math.atan2(-nL[0], -nL[1]));
  const axes = (yaw) => ({ fx: -Math.sin(yaw), fz: -Math.cos(yaw), lx: -Math.cos(yaw), lz: Math.sin(yaw) });
  // one candidate: reading r + action name → a plan (stand, yaw, pose, targets, cost) or null
  let RELAX = false;
  function fit(r, name, intent, P) {
    const A = ACTS[name], sp = name === 'climb' ? null : spec(name); if (!A || (name !== 'climb' && !sp)) return null;
    STATS.fits++;
    const pref = A.intents[intent]; if (pref === undefined) return null;
    // the pose solver rejected this action on this rock a moment ago (the body would sit inside it): not the same one again here
    if (S.ban && C.T < S.ban.until && S.ban.name === name && S.ban.e === r.e && Math.hypot(P.x - S.ban.x, P.z - S.ban.z) < 0.9) return rej(name + ':poseBan');
    const narrow = r.width < 0.45 || r.round > 0.12, RX = RELAX && A.relax;   // RELAX: the second pass for a pilot standing at a face that no strict fit served
    if (A.kind === 'wall') {
      if (!RX && r.width < A.minW) return rej(name + ':narrow'); if (!RX && r.round > A.maxRound) return rej(name + ':round');
      const yaw = yawFor(r.nx, r.nz, sp.nL), X = axes(yaw);
      let hdy = 0;
      if (A.hands && r.topPt && r.topH > 0.85 && sp.h > r.topH - 0.1 && sp.h - (r.topH - 0.1) <= 0.3) hdy = (r.topH - 0.1) - sp.h;
      let q = faceAt(r, sp.h + hdy); if (!q) return rej(name + ':noFace');
      let sx = q.x - X.lx * sp.lat - X.fx * sp.fwd, sz = q.z - X.lz * sp.lat - X.fz * sp.fwd;
      let g = ground(sx, sz, P.y);
      if (Math.abs(g.y - r.g) > 0.06) { q = faceAt(r, sp.h + hdy + (g.y - r.g)); if (!q) return rej(name + ':noFace2'); sx = q.x - X.lx * sp.lat - X.fx * sp.fwd; sz = q.z - X.lz * sp.lat - X.fz * sp.fwd; g = ground(sx, sz, P.y); }
      if (g.ny < 0.8) return rej(name + ':steep'); if (g.on === r.e) return rej(name + ':onRock'); if (Math.abs(g.y - P.y) > 0.5) return rej(name + ':level');
      // the face at the contact itself: it goes on above it (not a crest) and leans the way the action allows
      const ch = sp.h + hdy + (g.y - r.g), above = fdAt(r, ch + 0.2), below = fdAt(r, ch - 0.2);
      // palms may sit just under the rim of a chest-high rock (the top is right above them); a back / shoulder needs the face to go on
      const underRim = A.hands && r.topPt && r.topH >= ch + 0.05 && r.topH - ch <= 0.3;
      if (!underRim && (above === null || above - q.d > (A.hands ? (RX ? 0.9 : 0.5) : (RX ? 0.45 : 0.3)))) return rej(name + ':crest');   // palms press onto a dome's side; a back / shoulder needs the face to go on
      const tl = above === null ? (below !== null ? Math.atan2(q.d - below, 0.2) : 0) : below !== null ? Math.atan2(above - below, 0.4) : Math.atan2(above - q.d, 0.2);
      if (tl < A.tilt[0] - (RX ? 0.3 : 0) || tl > A.tilt[1] + (RX ? 0.3 : 0)) return rej(name + ':tilt');
      // the body at every height: the face there must leave the room the body needs (stand → face along the normal)
      const D = (sx - q.x) * r.nx + (sz - q.z) * r.nz, dh = g.y - r.g;
      for (const [h, need] of A.body) { const f = fdAt(r, h + dh); if (f !== null && D + (f - q.d) < need * (RX ? 0.7 : 1)) return rej(name + ':body'); }
      // placement contacts (back / shoulder: no IK) need the face right there, not falling away just above / below
      if (!A.hands) for (const h of [sp.h - 0.25, sp.h + 0.2]) { const f = fdAt(r, h + dh); if (f === null || f - q.d > (RX ? 0.2 : 0.12)) return rej(name + ':falls'); }
      const pitch = clamp(tl * (A.pitchK || 0), -K.pitchMax, K.pitchMax); if (Math.abs(tl * (A.pitchK || 0)) > K.pitchMax + 0.15) return rej(name + ':pitch');
      const pl = { name, intent, e: r.e, r, yaw, sx, sy: g.y, sz, n: { x: r.nx, z: r.nz }, pitch: clamp(pitch + hdy * 0.25, -K.pitchMax, K.pitchMax), roll: A.roll || 0, dip: 0, sp, hdy, point: { x: q.x, y: q.y, z: q.z } };
      if (A.hands) { pl.targets = handTargets(pl, sp, r); if (!pl.targets) return rej(name + ':reach'); } else pl.targets = {};
      return score(pl, P, pref - (narrow && A.narrowBonus ? A.narrowBonus : 0), intent);
    }
    if (A.kind === 'ledge') {
      if (!r.topPt || !r.topFlat || r.topH < A.top[0] || r.topH > A.top[1]) return rej(name + ':top');
      const yaw = Math.atan2(r.nx, r.nz), X = axes(yaw), rim = faceAt(r, Math.max(0.15, r.topH - 0.12)) || faceAt(r, 0.15); if (!rim) return rej(name + ':rim');
      const back = sp.fwd - 0.12, sx = rim.x + r.nx * back - X.lx * sp.lat, sz = rim.z + r.nz * back - X.lz * sp.lat, g = ground(sx, sz, P.y);
      if (g.ny < 0.8 || g.on === r.e || Math.abs(g.y - P.y) > 0.45) return rej(name + ':ground');
      const D = (sx - rim.x) * r.nx + (sz - rim.z) * r.nz; for (const [h, need] of A.body) { const f = fdAt(r, h); if (f !== null && D + (f - rim.d) < need) return rej(name + ':body'); }
      const pl = { name, intent, e: r.e, r, yaw, sx, sy: g.y, sz, n: { x: r.nx, z: r.nz }, pitch: 0, roll: 0, dip: clamp((0.62 - (r.topY - g.y)) * 0.5, 0, 0.1), sp, point: { x: rim.x, y: r.topY, z: rim.z } };
      pl.targets = handTargets(pl, sp, r); if (!pl.targets) return rej(name + ':reach');
      return score(pl, P, pref, intent);
    }
    if (A.kind === 'seat') {
      if (!r.topPt || !r.topSeat || r.topH < A.top[0] || r.topH > A.top[1]) return rej(name + ':top');
      const yaw = Math.atan2(-r.nx, -r.nz), rim = faceAt(r, Math.max(0.15, r.topH - 0.1)); if (!rim) return rej(name + ':rim');
      // the feet stand the clip's own approach distance in front of the seat's front edge (the rim), facing away
      const c0 = sp.contacts[0], off = c0 && c0.approach && c0.approach.distance ? c0.approach.distance[1] : 0.07;
      const sx = rim.x + r.nx * off, sz = rim.z + r.nz * off, g = ground(sx, sz, P.y);
      if (g.ny < 0.8 || g.on === r.e || Math.abs(g.y - P.y) > 0.45) return rej(name + ':ground');
      const topRel = r.topY - g.y, dip = A.seatH - topRel;   // > 0: the top is lower than the clip's seat → lower the body
      if (dip < -0.05 || dip > 0.11) return rej(name + ':seatH');   // lower: the boots sink into the snow skin (≤ 11 cm)
      // only when the pilot already stands with its back or side to the rock (sitting down is not a U-turn)
      if (Math.abs(wrapA(yaw - P.face)) > K.sitTurn) return rej(name + ':facing');
      const pl = { name, intent, e: r.e, r, yaw, sx, sy: g.y, sz, n: { x: r.nx, z: r.nz }, pitch: 0, roll: 0, dip: Math.max(0, dip), sp, targets: {}, point: { x: rim.x, y: r.topY, z: rim.z } };
      return score(pl, P, pref, intent);
    }
    if (A.kind === 'climb') return fitClimb(r, P, P.y);
    return null;
  }
  // where the clip puts a shoulder (character space, the clip's middle frame), sampled once on a copy of the rig
  const SHO = {};
  function shoulderOf(clip, bone) {
    const key = clip + ':' + bone; if (SHO[key] !== undefined) return SHO[key];
    SHO[key] = null;
    try {
      const A = AV(), root = A && A.contact && A.contact.root, act = A && A.acts[clip], SU = T3.SkeletonUtils; if (!root || !act || !SU) return null;
      const c2 = SU.clone(root), m2 = new T3.AnimationMixer(c2), a2 = m2.clipAction(act.getClip()); a2.play(); m2.setTime(act.getClip().duration * 0.5);
      c2.position.set(0, 0, 0); c2.rotation.set(0, 0, 0); c2.scale.set(1, 1, 1); c2.updateMatrixWorld(true);
      const b = c2.getObjectByName(bone); if (b) { const v = b.getWorldPosition(new T3.Vector3()); SHO[key] = [v.x, v.y, v.z]; }
      m2.stopAllAction();
    } catch (e) { SHO[key] = null; }
    return SHO[key];
  }
  function handTargets(pl, sp, r) {
    const out = {}, X = axes(pl.yaw);
    for (const c of sp.contacts) {
      if (!/^hand/.test(c.bone) || c.hold === false) continue;
      const p = c.surface.point, wx = pl.sx + X.lx * p[0] + X.fx * p[2], wz = pl.sz + X.lz * p[0] + X.fz * p[2], wy = pl.sy + p[1] + (pl.hdy || 0);
      let h = null;
      if (c.surface.type === 'ledge_top' || c.surface.type === 'obstacle_top') {
        h = cast(wx, pl.sy + r.topH + 0.45, wz, 0, -1, 0, 1.2, r.e);
        if (!h || h.normal.y < 0.6 || Math.abs(h.point.y - wy) > 0.2) return null;
      } else {
        h = cast(wx + r.nx * 0.35, wy, wz + r.nz * 0.35, -r.nx, 0, -r.nz, 0.35 + 0.6, r.e);
        if (!h || Math.abs(h.distance - 0.35) > K.reachTol || Math.abs(h.normal.y) > 0.8) return null;
      }
      // the arm must reach it from where the shoulder will be (measured on the rig: ≤ 0.58 m the IK lands it, 0.64 m leaves
      // 5 cm, 0.7 m 9 cm): up to K.armFar the hold steps the body in (reachClose), beyond it the action is not taken
      const so = shoulderOf(sp.clip, c.bone === 'hand_l' ? 'upperarm_l' : 'upperarm_r'), sl = so ? so[0] : (c.bone === 'hand_l' ? 0.19 : -0.19), sy = so ? so[1] : 1.43, sf = so ? so[2] : 0.04;
      const shx = pl.sx + X.lx * sl + X.fx * sf, shz = pl.sz + X.lz * sl + X.fz * sf, shy = pl.sy + sy - (pl.dip || 0) + (pl.hdy || 0) * 0.5;
      const reach = Math.hypot(h.point.x - shx, h.point.y - shy, h.point.z - shz); if (reach > K.armFar) { rej('arm:far'); return null; }
      out[c.bone] = { point: h.point.clone(), normal: h.normal.clone().normalize() };
    }
    return out;
  }
  function score(pl, P, pref, intent) {
    if (!standFree(pl.sx, pl.sy, pl.sz, pl.n.x, pl.n.z, pl.e, pl.name === 'lean_back' ? 0.16 : 0.22)) return rej(pl.name + ':cramped');
    if (!pathFree(P, pl.sx, pl.sz, pl.e)) return rej(pl.name + ':path');
    pl.move = Math.hypot(pl.sx - P.x, pl.sz - P.z); pl.turn = Math.abs(wrapA(pl.yaw - P.face));
    if (pl.move > K.maxMove) return rej(pl.name + ':far'); if (pl.turn > K.maxTurn) return rej(pl.name + ':turn');
    pl.cost = pl.move * 1.2 + pl.turn * (intent === 'rest' ? 0.1 : 0.35) + pref + Math.abs(pl.pitch) * 0.8;
    return pl;
  }
  // a climb: a flat, deep, open top 0.45–2.1 m above the feet, straight in along the face
  function fitClimb(r, P, feetY) {
    if (!K.climb || !C.startClimb) return null;
    if (!r.topPt) return rej('climb:top');
    const h = r.topY - feetY; if (h < 0.3 || h > 2.1) return rej('climb:height');
    const low = h <= 0.55;   // a knee-high rock is stepped onto: any walkable top will do, it need not be flat and deep
    if (!low && (!r.topFlat || !r.topDeep)) return rej('climb:top');
    const face = faceAt(r, clamp(h * 0.5, 0.15, 1.2)); if (!face) return rej('climb:face');
    if (Math.hypot(P.x - face.x, P.z - face.z) > (low ? 1.6 : 1.3)) return rej('climb:far');
    const Lx = r.topPt.x - r.nx * 0.2, Lz = r.topPt.z - r.nz * 0.2, top = cast(Lx, r.topY + 0.6, Lz, 0, -1, 0, 1.2, r.e);
    if (!top || top.normal.y < (low ? 0.62 : 0.75)) return rej('climb:land');
    if (cast(Lx, top.point.y + 0.15, Lz, 0, 1, 0, 1.6)) return rej('climb:head');
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; if (cast(Lx, top.point.y + 0.6, Lz, Math.sin(a), 0, Math.cos(a), 0.28)) return rej('climb:room'); }
    const L = { x: Lx, y: top.point.y, z: Lz, h };
    if (climbThrough(P, feetY, L)) return rej('climb:through');
    return { name: 'climb', intent: 'climb', e: r.e, r, L, n: { x: r.nx, z: r.nz }, cost: 0 };
  }
  // the climb moves the root on the game's own curve (open-world.html updateClimb: height by the clip's hands / foot,
  // across by smooth(kL, kS)); sample it and test the body column (knee / pelvis / chest) against the drawn rocks
  function insideRock(x, y, z) {
    const I = window.INTERACT; if (!_ray) _ray = new T3.Ray();
    for (const e of NEAR) {
      const b = e.box; if (x < b.min[0] || x > b.max[0] || z < b.min[2] || z > b.max[2] || y < b.min[1] || y > b.max[1]) continue;
      const g = I && I.bvhGeo ? I.bvhGeo(e) : null; if (!g || !g.boundsTree) continue;
      _ray.origin.set(x, y, z); _ray.direction.set(0, 1, 0);
      let hits = []; try { hits = g.boundsTree.raycast(_ray, T3.DoubleSide) || []; } catch (err) { hits = []; }
      if (hits.length % 2 === 1) return true;
    }
    return false;
  }
  const smooth01 = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function climbThrough(P, feetY, L) {
    const cv = C.CLIMB && C.CLIMB.curve;
    for (let i = 1; i <= 12; i++) {
      const k = i / 12;
      let ku, kf;
      if (cv) { const f = k * cv.N, j = Math.min(cv.N - 1, Math.floor(f)); ku = cv.u[j] + (cv.u[j + 1] - cv.u[j]) * (f - j); kf = smooth01(cv.kL, cv.kS, k); }
      else { ku = smooth01(0.05, 0.6, k); kf = smooth01(0.4, 1, k); }
      const x = P.x + (L.x - P.x) * kf, z = P.z + (L.z - P.z) * kf, y = feetY + (L.y + 0.03 - feetY) * ku;
      for (const hy of [0.55, 0.95, 1.3]) if (insideRock(x, y + hy, z)) return true;
    }
    return false;
  }
  // the best plan for an intent among the faces read around the pilot
  function choose(intent, P, sector, reach, names) {
    const reads = scan(P, sector, reach || 2.4);
    let best = null;
    const list = names || Object.keys(ACTS).filter((n) => ACTS[n].intents[intent] !== undefined && ACTS[n].kind !== 'climb' && ACTS[n].kind !== 'gap');
    for (const r of reads) for (const n of list) { if (!avail(n)) continue; const pl = fit(r, n, intent, P); if (pl && (!best || pl.cost < best.cost)) best = pl; }
    STATS.choices++; S.lastReads = reads.length;
    return best;
  }

  /* ---------------------------------------------------------------- input / helpers */
  function inp() {
    const k = C.keys || {}, ix = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0), iy = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0), y = C.cam ? C.cam.yaw : C.player.face;
    let x = -Math.sin(y) * iy + Math.cos(y) * ix, z = -Math.cos(y) * iy - Math.sin(y) * ix; const l = Math.hypot(x, z); if (l > 1) { x /= l; z /= l; }
    return { x, z, on: !!(ix || iy) };
  }
  const RK = () => window.INTERACTION && window.INTERACTION.RK;
  const AV = () => C.AV && C.AV.player;
  // the stand spot: with K.physMove only physics moves the pilot — the point goes to the controller as a goal (walk there at
  // most vmax m/s, colliding as it goes; refreshed every frame); the yaw is the drawn body's own turn. Off: the old direct write.
  function seat(P, x, z, yaw, vmax) {
    if (yaw !== undefined) { P.face = yaw; P.c.g.rotation.y = yaw; }
    const ch = C.PH && C.PH.ok && C.PH.ch;
    if (K.physMove && ch && ch.setGoal) { ch.setGoal(x, z, vmax || K.holdSpeed); STATS.goals = (STATS.goals || 0) + 1; return; }
    P.x = x; P.z = z; P.c.g.position.x = x; P.c.g.position.z = z; if (ch) ch.setPosition(P.x, P.y, P.z);
  }
  function play(name, once, fade, speed) {
    const A = AV(); if (!A || !A.acts[name]) return false; const f = speed || 1;
    if (once) A.once(name, A.acts[name].getClip().duration / f, fade || 0.15); else A.loop(name, fade || 0.2);
    A.speed(name, f); return true;
  }
  const enterDur = (pl) => { const A = AV(), sp = pl.sp; return A && sp.enter && A.acts[sp.enter] ? A.acts[sp.enter].getClip().duration / (ACTS[pl.name].enterSpeed || 1) : 0.6; };
  function noteStart(pl) {
    const t = C.T; S.starts.push(t); while (S.starts.length && t - S.starts[0] > 1) S.starts.shift();
    STATS.starts++; STATS.switchRate = S.starts.length; STATS.acts[pl.name] = (STATS.acts[pl.name] || 0) + 1;
    S.lastChoice = { name: pl.name, intent: pl.intent, rock: pl.e && pl.e.name, cost: pl.cost !== undefined ? +pl.cost.toFixed(2) : null, move: pl.move !== undefined ? +pl.move.toFixed(2) : null,
      reading: pl.r ? { topH: +pl.r.topH.toFixed(2), flat: pl.r.topFlat, deep: pl.r.topDeep, tall: pl.r.tall, tilt: +pl.r.tilt.toFixed(2), width: +pl.r.width.toFixed(2), round: +pl.r.round.toFixed(2), gap: +pl.r.gap.toFixed(2) } : null };
  }

  /* ---------------------------------------------------------------- the automaton */
  const owns = () => S.state === 'steer' || S.state === 'act' || S.state === 'hold' || S.state === 'squeeze' || S.state === 'stepup';
  const ownsAnim = () => S.state === 'act' || S.state === 'hold' || S.state === 'squeeze';
  function end(push) {
    const P = C.player, pl = S.plan;
    if (S.state === 'squeeze') { squeezeEnd(P, false); return; }
    if (S.state === 'stepup') { PH_off(false); S.state = 'free'; S.su = null; return; }
    if (pl && (S.state === 'act' || S.state === 'hold')) {
      feel.rel = 1;
      const i = inp();
      if (push && !i.on && C.PH && C.PH.ok && pl.n) C.PH.ch.setVelocity(pl.n.x * 1.1, 0, pl.n.z * 1.1);   // push off the face
      const A = AV(); if (A) { A.lock = 0; if (pl.sp && pl.sp.exit) play(pl.sp.exit, true, 0.15); }
    }
    S.state = S.plan ? 'release' : 'free'; S.t = 0; S.plan = null; S.phase = null; S.lastEnd = C.T; S.intoT = 0; S.awayT = 0;
    void P;
  }
  function start(pl, arriveSpeed) {
    S.plan = pl; S.t = 0; S.phase = null; S.arrive = arriveSpeed || 0; S.intoT = 0; S.awayT = 0; S.steerBest = undefined; S.steerStuck = 0; noteStart(pl);
    S.state = pl.move > 0.05 || pl.turn > 0.06 ? 'steer' : 'act';
    if (S.state === 'act') enterAct();
  }
  function enterAct() {
    const pl = S.plan, sp = pl.sp; S.state = 'act'; S.t = 0;
    if (sp.enter) { play(sp.enter, true, 0.15, ACTS[pl.name].enterSpeed); S.phase = 'enter'; } else { play(sp.clip, !sp.loop, 0.2); S.phase = 'main'; }
    feel.amp = clamp(S.arrive / 4, 0.25, 1.2); S.abs = feel.amp; feel.touchAt = C.T;
  }
  function doClimb(c) {
    const P = C.player; if (!c || !C.startClimb) return false;
    try { C.startClimb(c.L, -c.n.x, -c.n.z); } catch (e) { return false; }
    STATS.climbs++; noteStart(c); S.state = 'climb'; S.t = 0; S.plan = null; S.lastEnd = C.T; void P; return true;
  }
  // a knee-high rock: stepped onto in stride (the walk / jog keeps playing, the body rises over the rim, leg IK plants the
  // feet on the top) — never the full climb
  function startStepUp(c) {
    const P = C.player, PH = C.PH, L = c.L; let dx = L.x - P.x, dz = L.z - P.z; const d = Math.hypot(dx, dz) || 1;
    const ex = L.x + dx / d * 0.15, ez = L.z + dz / d * 0.15;   // land a little past the rim
    S.su = { fx: P.x, fy: P.y, fz: P.z, tx: ex, ty: L.y + 0.02, tz: ez, t: 0, dur: clamp((d + 0.15) / 1.4, 0.4, 0.85), yaw: Math.atan2(-dx, -dz) };
    PH.ch.setEnabled(false); S.state = 'stepup'; S.t = 0; STATS.stepUps = (STATS.stepUps || 0) + 1; noteStart({ name: 'step_up', intent: 'step', e: c.e });
  }
  function stepUp(dt, P) {
    const u = S.su, PH = C.PH; u.t += dt; const k = Math.min(1, u.t / u.dur), ku = smooth01(0.08, 0.62, k);
    const x = u.fx + (u.tx - u.fx) * k, z = u.fz + (u.tz - u.fz) * k, y = u.fy + (u.ty - u.fy) * ku, vx = (u.tx - u.fx) / u.dur, vz = (u.tz - u.fz) / u.dur;
    P.x = x; P.y = y; P.z = z; P.face += clamp(wrapA(u.yaw - P.face), -6 * dt, 6 * dt); P.c.g.rotation.y = P.face; P.c.g.position.set(x, y, z);
    PH.ch.setPosition(x, y, z);
    // the controller is off: its output (what the gait / leg IK read next frame) is handed the stride's own speed
    const o = PH.ch.move(0, { x: 0, z: 0 }); if (o && o.velocity) { o.velocity.x = vx; o.velocity.z = vz; o.velocity.y = 0; o.grounded = true; o.sliding = false; }
    P.vx = vx; P.vz = vz; P.vy = 0; P.onGround = true;
    if (k >= 1) { PH.ch.setEnabled(true); PH.ch.setPosition(x, y, z); S.state = 'free'; S.lastEnd = C.T; S.su = null; }
  }
  // what is ahead along the motion (or the input / facing when standing)
  function ahead(P, dir, far) {
    const h = cast(P.x, P.y + 0.9, P.z, dir.x, 0, dir.z, far) || cast(P.x, P.y + 0.45, P.z, dir.x, 0, dir.z, far) || cast(P.x, P.y + 0.2, P.z, dir.x, 0, dir.z, Math.min(far, 2));
    if (!h) return null;
    const nl = Math.hypot(h.normal.x, h.normal.z); if (nl < 0.45) return null;
    return { h, nx: h.normal.x / nl, nz: h.normal.z / nl, dist: h.distance, into: -(h.normal.x * dir.x + h.normal.z * dir.z) / nl };
  }

  function free(dt, P, i, hs) {
    const R = RK(); const cool = C.T - S.lastEnd < K.hyst;
    const vdir = hs > 0.6 ? { x: P.vx / hs, z: P.vz / hs } : i.on ? { x: i.x, z: i.z } : { x: -Math.sin(P.face), z: -Math.cos(P.face) };
    const A = NEAR.length ? ahead(P, vdir, 5.2) : null;
    // jump at a rock face: grab the top in the air (feet = the ground the jump left)
    if (!P.onGround) {
      if (A && A.dist < 1.4 && A.into > 0.5 && C.T - (P.jumpAt || -9) < 1.1 && S.state !== 'climb') {
        const r = readFace(A.h.e, A.h.point, A.nx, A.nz), c = fitClimb(r, P, P.jumpY !== undefined ? Math.min(P.y, P.jumpY) : P.y);
        if (c && c.L.h > K.stepUp + 0.05 && doClimb(c)) return;   // a knee-high top: the jump itself lands on it
      }
      S.state = 'free'; return;
    }
    // Space in front of a rock face: climb it if it has a top to stand on (otherwise the game's jump)
    if (A && A.dist < 1.2 && A.into > 0.55 && C.pressed && C.pressed.has('Space')) {
      const r = readFace(A.h.e, A.h.point, A.nx, A.nz), c = fitClimb(r, P, P.y);
      if (c) { C.pressed.delete('Space'); doClimb(c); return; }
    }
    // pressing into a low rock face (no contact action took it): climb after a short push
    if (A && A.dist < 0.95 && A.into > 0.6 && i.on && hs < 1.4) S.pushT += dt; else S.pushT = 0;
    // (a knee-high rock is stepped onto after a short push; anything taller only after a deliberate push of K.pushClimb s:
    // walking up to a rock and stopping is a touch / rest, never a climb)
    if (A && (S.pushT > K.pushClimb || (S.pushT > 0.12 && A.h.point.y - P.y < 0.5))) {
      const r = readFace(A.h.e, A.h.point, A.nx, A.nz);
      if (S.pushT > K.pushClimb || r.topH <= K.stepUp) { S.pushT = 0; const c = fitClimb(r, P, P.y); if (c) { if (c.L.h <= K.stepUp + 0.05) startStepUp(c); else doClimb(c); return; } }
    }
    // a knee-high rock straight ahead while walking / running at it: stepped onto in stride, no push needed
    if (A && i.on && A.into > 0.5 && A.h.point.y - P.y < 0.55 && A.dist < 0.45 + Math.min(hs, 6) * 0.12 && !(S.stepMiss && C.T < S.stepMiss.until && S.stepMiss.e === A.h.e)) {
      const r = readFace(A.h.e, A.h.point, A.nx, A.nz);
      if (r.topPt && r.topH <= K.stepUp + 0.05 && r.topY - P.y > 0.12) { const c = fitClimb(r, P, P.y); if (c) { startStepUp(c); return; } S.stepMiss = { e: A.h.e, until: C.T + 1 }; }
    }
    // brake before the face, head turned to it
    if (A && A.into > 0.5 && A.dist < K.brakeRange && hs > 1.6) {
      const vmax = clamp(1.2 + (A.dist - 0.8) * 2.8, 1.2, hs); P.speedCap = vmax; STATS.brakes++;
      S.state = 'brake'; S.lookAt = C.T; S.look = { x: A.h.point.x, y: A.h.point.y + 0.2, z: A.h.point.z };
    } else if (A && A.into > 0.3 && A.dist < 5 && hs > 1) { if (S.state !== 'brake' || C.T - S.lookAt > K.lookHold) S.state = 'notice'; S.lookAt = C.T; S.look = { x: A.h.point.x, y: A.h.point.y + 0.3, z: A.h.point.z }; }
    else if ((S.state === 'brake' || S.state === 'notice') && C.T - (S.lookAt || -9) < K.lookHold) { /* keep: the ray grazed off the face for a moment */ }
    else { if (S.state === 'brake' || S.state === 'notice') S.state = 'free'; S.look = null; }
    if (S.look && R) { R.lookOn = true; Object.assign(R.lookPt, S.look); }
    // a gap between two rocks ahead, narrower than walking through with the arms down: side-step through it
    if (i.on && P.onGround && gapAhead(P, vdir, hs)) return;
    if (cool) { STATS.fb_cool = (STATS.fb_cool || 0) + 1; return; }
    STATS.fb_on = (STATS.fb_on || 0) + 1;
    // an action here just let go on its own (palms out of reach, knocked off): not the same spot again for a while
    if (S.missUntil > C.T && S.restMiss && Math.hypot(P.x - S.restMiss.x, P.z - S.restMiss.z) < 0.45) return;
    // arrive at the face (walked or braked into it): a touch, then a hold
    if (A && A.dist < 1.05 && A.into > 0.55 && (hs > 0.4 || i.on) && hs <= K.touchSpeed) {
      const pl = choose('touch', P, { x: vdir.x, z: vdir.z, cos: 0.55 }, 1.6);
      if (pl) { start(pl, Math.max(hs, 1)); return; }
    }
    // trailing a hand along a face while walking past it
    if (K.walkTouch && hs > 0.7 && hs < 4.6 && !(S.wtEnd && C.T - S.wtEnd.t < K.walkTouchCool) && walkTouchPick(P, vdir)) return;
    // standing still next to a rock: rest on it the way the rock allows
    if (S.stillT >= K.restDelay && !i.on) {
      if (S.restMiss && Math.hypot(P.x - S.restMiss.x, P.z - S.restMiss.z) < 0.3) return;
      const names = Object.keys(ACTS).filter((n) => ACTS[n].intents.rest !== undefined && ACTS[n].kind !== 'climb' && ACTS[n].kind !== 'gap' && (ACTS[n].kind !== 'seat' || S.stillT >= K.sitStill));
      let pl = choose('rest', P, null, 1.7, names);
      // nothing fitted strictly while the pilot stands right at a face: the loose pass (a palm or a shoulder on whatever the
      // face is — narrow, bulging, leaning); the palm reach is closed in hold() or the action lets go
      if (!pl) { RELAX = true; try { pl = choose('rest', P, null, 1.2, ['hand_wall_r', 'hand_wall_l', 'lean_shoulder_r', 'lean_shoulder_l']); } finally { RELAX = false; } if (pl) { pl.relaxed = true; STATS.relaxed = (STATS.relaxed || 0) + 1; } }
      if (pl) start(pl, 0.5); else if (S.stillT >= K.sitStill) S.restMiss = { x: P.x, z: P.z };
    }
  }

  function steer(dt, P, i) {
    const pl = S.plan; S.t += dt; P.speedCap = 0;
    if (i.on && (i.x * pl.n.x + i.z * pl.n.z) > 0.35) { end(false); return; }   // the player walks away
    if (S.t > K.steerMax) { end(false); return; }
    const dx = pl.sx - P.x, dz = pl.sz - P.z, d = Math.hypot(dx, dz), dy = wrapA(pl.yaw - P.face);
    if (d > 1.8) { end(false); return; }
    // the body cannot get closer (the collider holds the capsule off the drawn face): act from here if the hands still reach
    if (S.steerBest === undefined || d < S.steerBest - 0.01) { S.steerBest = d; S.steerStuck = 0; } else S.steerStuck += dt;
    if (S.steerStuck > 0.2 && d < 0.3 && Math.abs(dy) < 0.08) {
      if (!settleHere(pl, P)) { rej(pl.name + ':blocked'); end(false); return; }
      seat(P, P.x, P.z, pl.yaw); S.steerBest = undefined; enterAct(); return;
    }
    if (d > 0.012 || Math.abs(dy) > 0.03) {
      const st = Math.min(d, K.steerSpeed * dt), k = d > 1e-4 ? st / d : 0;
      if (K.physMove) seat(P, pl.sx, pl.sz, P.face + clamp(dy, -K.steerTurn * dt, K.steerTurn * dt), K.steerSpeed);
      else seat(P, P.x + dx * k, P.z + dz * k, P.face + clamp(dy, -K.steerTurn * dt, K.steerTurn * dt));
      return;
    }
    seat(P, pl.sx, pl.sz, pl.yaw); S.steerBest = undefined; enterAct();
  }
  // the stand spot becomes where the pilot really is; the hands are re-snapped from there (null: out of reach → no action)
  function settleHere(pl, P) {
    pl.sx = P.x; pl.sz = P.z; pl.sy = P.y;
    if (!ACTS[pl.name].hands) return true;
    const tg = handTargets(pl, pl.sp, pl.r); if (!tg) return false;
    pl.targets = tg; return true;
  }

  function hold(dt, P, i) {
    const pl = S.plan, sp = pl.sp, A = AV(), I = window.INTERACTION, R = RK(); S.t += dt; P.speedCap = 0;
    if (!A || !I) { end(false); return; }
    // clip: enter once, then the loop
    if (S.phase === 'enter' && S.t >= enterDur(pl) - 0.03) { A.lock = 0; S.phase = 'main'; play(sp.clip, !sp.loop, 0.15); S.state = 'hold'; }
    if (S.phase === 'main' && S.state === 'act') S.state = 'hold';
    if (S.phase === 'main' && !sp.loop && S.t > sp.dur) { end(true); return; }
    if (S.phase === 'main' && sp.loop && A.cur !== sp.clip) { A.lock = 0; play(sp.clip, false, 0.15); }
    // input: away from the face ends it; along it traces (hands) or ends it (rest); into it climbs if the rock has a top
    const n = pl.n, t = { x: -n.z, z: n.x }, away = i.on ? i.x * n.x + i.z * n.z : 0, along = i.on ? i.x * t.x + i.z * t.z : 0;
    const back = ACTS[pl.name].kind === 'seat' || pl.name === 'lean_back';   // the body faces away from the rock
    if (i.on && (back ? away > -0.2 : away > 0.35)) { S.awayT += dt; if (S.awayT > 0.1) { end(true); return; } } else S.awayT = 0;
    let moving = false;
    if (i.on && Math.abs(along) > 0.6 && S.phase === 'main') {
      if (ACTS[pl.name].trace) moving = trace(dt, P, pl, Math.sign(along)); else { end(false); return; }
      if (!S.plan) return;
    }
    feel.trace = damp(feel.trace, moving ? 1 : 0, 8, dt);
    // (Space: the game's jump runs first; a jump at the face is grabbed by the airborne branch of free())
    if (i.on && away < -0.6 && ACTS[pl.name].hands) { S.intoT += dt; if (S.intoT > K.pushClimb) { S.intoT = 0; const r = readFace(pl.e, pl.point, n.x, n.z), c = fitClimb(r, P, P.y); if (c) { end(false); doClimb(c); return; } } } else S.intoT = 0;
    if (!moving) {
      const off = Math.hypot(P.x - pl.sx, P.z - pl.sz);
      if (off > 0.35) { end(false); return; }                       // knocked off the spot
      if (off > 0.02) { if ((P.x - pl.sx) * pl.n.x + (P.z - pl.sz) * pl.n.z > 0.015) pl.pullBlocked = true; pl.sx = damp(pl.sx, P.x, 6, dt); pl.sz = damp(pl.sz, P.z, 6, dt); }   // the collider nudged it: follow, no tug of war
      seat(P, pl.sx, pl.sz, pl.yaw);
    }
    // the whole body: spine pitch to the face's tilt + the touch absorbed in the chest, a breath, weight shifting; knees
    // for a low top; the head on the contact (up the face when it is tall)
    S.abs = Math.max(0, S.abs - dt * 3); S.breathT += dt;
    if (R) {
      const absorb = S.t < 0.5 ? -0.12 * S.abs * Math.sin(Math.min(1, S.t / 0.5) * Math.PI) : 0;
      R.pitch = pl.pitch + (pl.pitchAdd || 0) + absorb + 0.018 * Math.sin(S.breathT * 1.7); R.roll = pl.roll + 0.02 * Math.sin(S.breathT * 0.6); R.dip = pl.dip + (S.t < 0.4 ? 0.03 * S.abs * Math.sin(S.t / 0.4 * Math.PI) : 0);
      R.lookOn = true; Object.assign(R.lookPt, back ? { x: P.x + n.x * 4, y: P.y + 1.5, z: P.z + n.z * 4 } : { x: pl.point.x, y: pl.point.y + (pl.r.tall ? 0.9 : 0.1), z: pl.point.z });
    }
    // hands on the drawn face (the clip's contact windows decide when)
    const CT = I.CT, layer = CT && CT.layer, PP = window.POSE, ppH = !!(PP && PP.active('hands'));
    // with the pose pipeline the palms are IK'd after every module decided: the reach error and the checks read the
    // finished pose in its after-hook, and the step-in / let-go decision uses that (one frame old) reading
    if (layer && A.cur && A.acts[A.cur]) { if (I.layerHands) I.layerHands(A.acts[A.cur], (c) => (pl.targets[c.bone] || null), 'rock', 'hands'); else { try { layer.update(A.acts[A.cur], (c) => (pl.targets[c.bone] || null), 1); } catch (e) { /* clip without hand contacts */ } } }
    if (ppH) { PP.after(() => { reachMeasure(pl, A); check(pl, A); }); if (reachAct(dt, P, pl)) return; }
    else { if (reachClose(dt, P, pl, A)) return; check(pl, A); }
    const fp = pl.feel || (pl.feel = { rock: true }); fp.targets = pl.targets; fp.normal = pl.n; fp.point = pl.point;   // one object per action (rock-feel caches by it)
    feel.active = true; feel.plan = fp; feel.m = { w: pl.r.width, ny: Math.sin(pl.r.tilt), flat: pl.r.topFlat && pl.r.topH < 1.6 };
  }
  // palms that the arm does not reach (a face that falls away, a ramp, a bulge under the chest): the body steps in toward
  // the face as far as the collider and the chest allow, then leans the spine to a low target; still short after 0.9 s → the
  // action lets go (never a palm hanging in the air)
  const _w1 = { x: 0, y: 0, z: 0 };
  function bodyRoom(x, y, z, pl) {
    for (const h of [0.35, 0.9, 1.3]) { const hit = cast(x, y + h, z, -pl.n.x, 0, -pl.n.z, 0.6); if (hit && hit.distance < 0.25) return false; }
    return true;
  }
  // reach error of the palms on the pose as drawn: measured (reachMeasure) then acted on (reachAct); reachClose = both at once
  // world point of a hand's contact: the measured palm centre (ANIMLIB.palmSpec ← BODYSPEC.palm_*) → true; else the wrist → false
  const _pq = { q: null };
  function palmAt(bone, name, out) {
    bone.getWorldPosition(out);
    const sp = /^hand_[lr]$/.test(name) && window.ANIMLIB && ANIMLIB.palmSpec ? ANIMLIB.palmSpec('_' + name.slice(-1)) : null; if (!sp) return false;
    const q = bone.getWorldQuaternion(_pq.q || (_pq.q = new T3.Quaternion()));
    out.add(new T3.Vector3(sp.center[0], sp.center[1], sp.center[2]).applyQuaternion(q)); return true;
  }
  function reachClose(dt, P, pl, A) { if (!reachMeasure(pl, A)) { if (S.phase !== 'main' || !ACTS[pl.name].hands) S.reachT = 0; return false; } return reachAct(dt, P, pl); }
  function reachMeasure(pl, A) {
    if (S.phase !== 'main' || !ACTS[pl.name].hands) { pl.reachErr = undefined; return false; }
    const root = A.contact && A.contact.root; if (!root) return false;
    const sc = root.getWorldScale(new T3.Vector3()).x, v = new T3.Vector3();
    let worst = 0, down = 0;
    for (const b in pl.targets) {
      if (!/^hand/.test(b)) continue; const bone = root.getObjectByName(b); if (!bone) continue;
      const t = pl.targets[b], pm = palmAt(bone, b, v), off = pm ? 0 : 0.035 * sc;   // measured palm: its centre on the point; else the wrist 3.5 cm out
      _w1.x = t.point.x + t.normal.x * off - v.x; _w1.y = t.point.y + t.normal.y * off - v.y; _w1.z = t.point.z + t.normal.z * off - v.z;
      const e = Math.hypot(_w1.x, _w1.y, _w1.z); if (e > worst) { worst = e; down = _w1.y; }
    }
    pl.reachErr = worst; pl.reachDown = down; return true;
  }
  function reachAct(dt, P, pl) {
    if (S.phase !== 'main' || !ACTS[pl.name].hands || pl.reachErr === undefined) { S.reachT = 0; return false; }
    const worst = pl.reachErr, down = pl.reachDown;
    if (worst > 0.015) {
      if (!pl.pullBlocked && (pl.pull || 0) < 0.3) {
        const step = Math.min(worst, 0.35 * dt), nx = pl.sx - pl.n.x * step, nz = pl.sz - pl.n.z * step;
        if (bodyRoom(nx, pl.sy, nz, pl)) { pl.sx = nx; pl.sz = nz; pl.pull = (pl.pull || 0) + step; seat(P, nx, nz, pl.yaw, 0.6); } else pl.pullBlocked = true;
      } else if (down < -0.03 && (pl.pitchAdd || 0) > -0.28) pl.pitchAdd = (pl.pitchAdd || 0) - 0.5 * dt;
    }
    S.reachT = worst > 0.045 ? (S.reachT || 0) + dt : 0;
    if (S.reachT > 0.9) { rej(pl.name + ':unreached'); STATS.unreached = (STATS.unreached || 0) + 1; S.restMiss = { x: P.x, z: P.z }; S.missUntil = C.T + 3; end(false); return true; }
    return false;
  }
  // sidle along the face: the stand spot slides, the face is re-read at the new spot, the palms re-snap every frame
  function trace(dt, P, pl, dir) {
    const v = 0.7 * (feel.sidleMul || 1), step = v * dt * dir, t = { x: -pl.n.z, z: pl.n.x };
    const nx = pl.sx + t.x * step, nz = pl.sz + t.z * step, sp = pl.sp, X = axes(pl.yaw);
    const cx = nx + X.lx * sp.lat + X.fx * sp.fwd, cz = nz + X.lz * sp.lat + X.fz * sp.fwd;   // where the contact now falls
    const h = cast(cx + pl.n.x * 0.4, pl.sy + sp.h, cz + pl.n.z * 0.4, -pl.n.x, 0, -pl.n.z, 1.0, pl.e);
    if (!h || Math.abs(h.distance - 0.4) > 0.25 || Math.abs(h.normal.y) > 0.6) { end(false); return false; }
    const nl = Math.hypot(h.normal.x, h.normal.z), n2 = { x: h.normal.x / nl, z: h.normal.z / nl };
    pl.n.x = damp(pl.n.x, n2.x, 10, dt); pl.n.z = damp(pl.n.z, n2.z, 10, dt); const l = Math.hypot(pl.n.x, pl.n.z); pl.n.x /= l; pl.n.z /= l;
    pl.yaw = yawFor(pl.n.x, pl.n.z, sp.nL); const Y = axes(pl.yaw);
    const sx = h.point.x - Y.lx * sp.lat - Y.fx * sp.fwd, sz = h.point.z - Y.lz * sp.lat - Y.fz * sp.fwd, g = ground(sx, sz, P.y);
    if (g.ny < 0.78 || g.on === pl.e || Math.abs(g.y - P.y) > 0.3 || !standFree(sx, g.y, sz, pl.n.x, pl.n.z, pl.e, 0.2)) { end(false); return false; }
    pl.sx = sx; pl.sz = sz; pl.sy = g.y; pl.point = { x: h.point.x, y: h.point.y, z: h.point.z };
    const tg = handTargets(pl, sp, pl.r.e === pl.e ? Object.assign({}, pl.r, { nx: pl.n.x, nz: pl.n.z }) : pl.r);
    if (tg) pl.targets = tg;
    seat(P, sx, sz, pl.yaw, 1.2);
    return true;
  }

  /* ---------------------------------------------------------------- squeeze through a gap */
  // two faces facing each other across the way, 0.55–0.95 m apart at hip / chest height: the pilot turns chest to one of
  // them and side-steps through (squeeze_side_r / _l: lead palm on the front face, the other on the face behind), kept on
  // the gap's midline; the clip pauses when the input stops, runs backwards when it reverses; out of the gap → walk on
  const GAP = { lo: 0.55, hi: 0.95 };
  function sides(x, y, z, px, pz, far) {
    const a = cast(x, y, z, px, 0, pz, far), b = cast(x, y, z, -px, 0, -pz, far);
    if (!a || !b) { if (a || b) rej('gap:ray1'); else rej('gap:ray0'); return null; }
    const na = Math.hypot(a.normal.x, a.normal.z), nb = Math.hypot(b.normal.x, b.normal.z); if (na < 0.35 || nb < 0.35) { rej('gap:flat'); return null; }
    return { a, b, w: a.distance + b.distance, nax: a.normal.x / na, naz: a.normal.z / na, nbx: b.normal.x / nb, nbz: b.normal.z / nb };
  }
  function gapAhead(P, D, hs) {
    if (!avail('squeeze_side_r') || !avail('squeeze_side_l')) { rej('gap:noClip'); return false; }
    STATS.gapTries = (STATS.gapTries || 0) + 1;
    if (S.gapMiss && C.T < S.gapMiss.until && Math.hypot(P.x - S.gapMiss.x, P.z - S.gapMiss.z) < 0.6) return false;
    const px = -D.z, pz = D.x;
    let best = null;
    for (const ahead of [0.35, 0.7]) {
      const qx = P.x + D.x * ahead, qz = P.z + D.z * ahead, g = ground(qx, qz, P.y);
      if (Math.abs(g.y - P.y) > 0.3) { rej('gap:level'); continue; }
      const hi = sides(qx, g.y + 1.1, qz, px, pz, 1.3), lo = sides(qx, g.y + 0.6, qz, px, pz, 1.3); if (!hi || !lo) { if (hi || lo) rej('gap:oneSide'); continue; }
      const w = Math.min(hi.w, lo.w); if (w < GAP.lo || w > GAP.hi) { rej(w < GAP.lo ? 'gap:narrow' : 'gap:wide'); continue; }
      if (hi.nax * hi.nbx + hi.naz * hi.nbz > -0.6) { rej('gap:facing'); continue; }               // the two faces look at each other
      if (Math.abs(hi.nax * D.x + hi.naz * D.z) > 0.5) { rej('gap:axis'); continue; }            // the gap runs the way the pilot goes
      // not a dead end: the way on is open for a body length
      const on = cast(qx, g.y + 1.0, qz, D.x, 0, D.z, 1.2); if (on && on.distance < 0.8) { rej('gap:deadEnd'); continue; }
      best = { ahead, hi, w, g }; break;
    }
    if (!best) return false;
    if (hs > 2.2) { P.speedCap = 1.8; return true; }   // brake into it
    const h = best.hi, F = h.b, fnx = h.nbx, fnz = h.nbz;   // chest to one of the two faces (either works: the clip is mirrored)
    const yaw = Math.atan2(fnx, fnz);   // facing −n: forward (−sin yaw, −cos yaw) = −n
    const X = axes(yaw), rx = -X.lx, rz = -X.lz, name = rx * D.x + rz * D.z >= 0 ? 'squeeze_side_r' : 'squeeze_side_l';
    const sp = spec(name); if (!sp) return false;
    S.sq = { name, sp, D: { x: D.x, z: D.z }, yaw, n: { x: fnx, z: fnz }, eF: F.e, lost: 0, t: 0, phase: sp.enter ? 'enter' : 'main', dir: 1, stuck: 0, gy: best.g.y };
    PH_off(true); S.state = 'squeeze'; S.t = 0; STATS.squeezes = (STATS.squeezes || 0) + 1; noteStart({ name, intent: 'pass', e: F.e });
    if (sp.enter) play(sp.enter, true, 0.2); else play(sp.clip, false, 0.2);
    return true;
  }
  function PH_off(off) { const PH = C.PH; if (!PH || !PH.ok) return; if (off) PH.ch.setEnabled(false); else { PH.ch.setEnabled(true); PH.ch.setPosition(C.player.x, C.player.y, C.player.z); } }
  function heldOut(P, vx, vz) { const o = C.PH.ch.move(0, { x: 0, z: 0 }); if (o && o.velocity) { o.velocity.x = vx; o.velocity.z = vz; o.velocity.y = 0; o.grounded = true; o.sliding = false; } P.vx = vx; P.vz = vz; P.vy = 0; P.onGround = true; }
  function squeeze(dt, P, i) {
    const Q = S.sq, A = AV(), I = window.INTERACTION, R = RK(); S.t += dt; Q.t += dt;
    if (!A || !I) { squeezeEnd(P, false); return; }
    const sp = Q.sp, D = Q.D, along = i.on ? i.x * D.x + i.z * D.z : 0;
    if (Q.phase === 'enter' && Q.t >= (A.acts[sp.enter] ? A.acts[sp.enter].getClip().duration : 0.6) - 0.03) { A.lock = 0; Q.phase = 'main'; play(sp.clip, false, 0.15); }
    // the walls at the body: re-read every frame, the body kept between them (front face at the clip's own distance share)
    const g = ground(P.x, P.z, P.y), sd = sides(P.x, g.y + 1.0, P.z, Q.n.x, Q.n.z, 0.9);
    if (!sd || sd.w > GAP.hi + 0.25) { Q.lost += dt; if (Q.lost > 0.2) { squeezeEnd(P, true); return; } } else Q.lost = 0;
    let x = P.x, z = P.z, y = Math.abs(g.y - P.y) < 0.3 ? damp(P.y, g.y, 12, dt) : P.y;
    if (sd) {
      // sd.a is along +n (behind the pilot: the face at its back), sd.b along −n (the face in front)
      const want = sd.w * 0.48 - sd.b.distance;   // + = move toward the back face (along +n)
      const m = clamp(want, -0.5 * dt, 0.5 * dt); x += Q.n.x * m; z += Q.n.z * m;
      const nb = Math.hypot(sd.b.normal.x, sd.b.normal.z), fx = sd.b.normal.x / nb, fz = sd.b.normal.z / nb; Q.n.x = damp(Q.n.x, fx, 6, dt); Q.n.z = damp(Q.n.z, fz, 6, dt); const l = Math.hypot(Q.n.x, Q.n.z); Q.n.x /= l; Q.n.z /= l;
      Q.yaw = Math.atan2(Q.n.x, Q.n.z); const sg = (D.x * -Q.n.z + D.z * Q.n.x) >= 0 ? 1 : -1; D.x = -Q.n.z * sg; D.z = Q.n.x * sg;   // the way through stays along the faces
    }
    // side-step: the clip's own pace (≈ 0.28 m/s) while the input goes along the gap; paused without it; backwards when reversed
    const dir = along > 0.3 ? 1 : along < -0.3 ? -1 : 0, v = 0.3 * dir;
    let vx = 0, vz = 0;
    if (dir && Q.phase === 'main') {
      const block = cast(x, g.y + 0.9, z, D.x * dir, 0, D.z * dir, 0.35);
      if (!block) { vx = D.x * v; vz = D.z * v; x += vx * dt; z += vz * dt; Q.stuck = 0; } else Q.stuck += dt;
    }
    if (Q.phase === 'main') A.speed(sp.clip, dir === 0 ? 0 : dir);
    if (!i.on) { Q.idleT = (Q.idleT || 0) + dt; if (Q.idleT > 6) { squeezeEnd(P, false); return; } } else Q.idleT = 0;
    P.x = x; P.z = z; P.y = y; P.face += clamp(wrapA(Q.yaw - P.face), -5 * dt, 5 * dt); P.c.g.rotation.y = P.face; P.c.g.position.set(x, y, z);
    C.PH.ch.setPosition(x, y, z); heldOut(P, vx, vz);
    // palms: each on its own face at the clip's contact height (front face straight ahead, the other straight behind)
    const X = axes(P.face), tg = {};
    for (const c of sp.contacts) {
      if (!/^hand/.test(c.bone)) continue; const p = c.surface.point, front = p[2] > 0;
      const ox = x + X.lx * p[0], oz = z + X.lz * p[0], oy = y + p[1], dx = front ? X.fx : -X.fx, dz = front ? X.fz : -X.fz;
      const h = cast(ox, oy, oz, dx, 0, dz, 0.9); if (h && Math.abs(h.normal.y) < 0.7) tg[c.bone] = { point: h.point.clone(), normal: h.normal.clone().normalize() };
    }
    Q.targets = tg;
    const layer = I.CT && I.CT.layer; if (layer && A.cur && A.acts[A.cur]) { if (I.layerHands) I.layerHands(A.acts[A.cur], (c) => tg[c.bone] || null, 'rock-squeeze', 'hands'); else { try { layer.update(A.acts[A.cur], (c) => tg[c.bone] || null, 1); } catch (e) { /* no hand contacts */ } } }
    if (R) { R.lookOn = true; Object.assign(R.lookPt, { x: x + D.x * dir * 2 - Q.n.x * 0.3, y: y + 1.5, z: z + D.z * dir * 2 - Q.n.z * 0.3 }); }
    const fp = Q.feel || (Q.feel = { rock: true }); fp.targets = tg; fp.normal = Q.n; fp.point = tg.hand_r ? tg.hand_r.point : tg.hand_l ? tg.hand_l.point : null;
    if (fp.point) { feel.active = true; feel.plan = fp; feel.trace = dir ? 1 : 0; feel.m = { w: 1, ny: 0, flat: false }; }
    if (Q.stuck > 1.2) { S.gapMiss = { x, z, until: C.T + 4 }; squeezeEnd(P, false); }
  }
  function squeezeEnd(P, out) {
    const Q = S.sq, A = AV(); PH_off(false);
    if (A) { A.lock = 0; if (Q) A.speed(Q.sp.clip, 1); }
    if (out && Q) { P.face = Math.atan2(-Q.D.x, -Q.D.z); P.c.g.rotation.y = P.face; C.PH.ch.setVelocity(Q.D.x * 1.2, 0, Q.D.z * 1.2); }
    S.gapMiss = S.gapMiss && C.T < S.gapMiss.until ? S.gapMiss : { x: P.x, z: P.z, until: C.T + 1.5 };
    S.state = 'release'; S.t = 0; S.sq = null; S.lastEnd = C.T;
  }
  // walking past a face: the near hand trails over it (arm IK over the walk / jog, no clip)
  let limb = { l: null, r: null };
  function walkTouchPick(P, vdir) {
    const Rv = { x: -vdir.z, z: vdir.x };   // right of the motion
    for (const side of [1, -1]) {
      const h = cast(P.x, P.y + 1.15, P.z, Rv.x * side, 0, Rv.z * side, 0.95); if (!h) continue;
      const nl = Math.hypot(h.normal.x, h.normal.z); if (nl < 0.6) continue;
      const nx = h.normal.x / nl, nz = h.normal.z / nl; if (Math.abs(nx * vdir.x + nz * vdir.z) > 0.45) continue;
      if (h.distance < 0.3) continue;
      S.state = 'walktouch'; S.t = 0; const W = S.wt; W.side = side; W.e = h.e; W.w = 0; W.miss = 0; W.feel = null;
      noteStart({ name: 'touch_walk_' + (side > 0 ? 'r' : 'l'), intent: 'walk', e: h.e });
      return true;
    }
    return false;
  }
  function walkTouch(dt, P, i, hs) {
    const W = S.wt, A = AV(), R = RK(); S.t += dt;
    if (i.on && P.onGround && hs > 0.2 && gapAhead(P, { x: P.vx / hs, z: P.vz / hs }, hs)) { if (S.state === 'squeeze') S.wt.w = 0; return; }
    const vdir = hs > 0.3 ? { x: P.vx / hs, z: P.vz / hs } : { x: -Math.sin(P.face), z: -Math.cos(P.face) }, Rv = { x: -vdir.z, z: vdir.x };
    let tgt = null, n = null;
    if (hs > 0.5 && hs < 5 && P.onGround) {
      const h = cast(P.x + vdir.x * 0.12, P.y + 1.12, P.z + vdir.z * 0.12, Rv.x * W.side, 0, Rv.z * W.side, 0.85, W.e);
      if (h && Math.abs(h.normal.y) < 0.6) { n = h.normal.clone().normalize(); tgt = h.point.clone().addScaledVector(n, 0.035); }
    }
    W.miss = tgt ? 0 : W.miss + dt;
    W.w = damp(W.w, tgt ? 1 : 0, tgt ? 5 : 8, dt);
    if (tgt) { W.tgt = tgt; W.n = n; }
    if (W.w < 0.02 && W.miss > 0.25) { S.state = 'free'; S.lastEnd = C.T; S.wtEnd = { t: C.T, e: W.e }; return; }
    if (!A || !A.contact || !W.tgt) return;
    const root = A.contact.root, key = W.side > 0 ? 'r' : 'l';
    if (!limb[key]) try { limb[key] = new window.ANIMLIB.LimbIK(root, 'hand_' + (W.side > 0 ? 'r' : 'l')); } catch (e) { limb[key] = null; }
    const sh = root.getObjectByName('upperarm_' + key); if (!sh || !limb[key]) return;
    const sp = sh.getWorldPosition(new T3.Vector3()), reach = sp.distanceTo(W.tgt), w = W.w * clamp((0.7 - reach) / 0.12, 0, 1);
    if (w > 0.01) {
      const L = limb[key], t = W.tgt.clone(), n = W.n.clone(), PP = window.POSE;
      const sf = t.clone().addScaledVector(n, -0.035);   // the surface point (W.tgt is 3.5 cm out: the old wrist offset)
      if (PP && PP.active('hands')) PP.request({ slot: 'hands', source: 'rock-walktouch', type: 'limbTarget', data: { bone: 'hand_' + key, point: sf, normal: n, weight: w }, apply: () => L.solve(t, w, n, sf) });
      else L.solve(t, w, n, sf);
      STATS.walkTouchFrames++;
    }
    if (R) { R.roll += 0.05 * W.side * W.w; R.lookOn = W.w > 0.3; Object.assign(R.lookPt, { x: W.tgt.x + vdir.x * 1.2, y: W.tgt.y + 0.1, z: W.tgt.z + vdir.z * 1.2 }); }
    const fp = W.feel || (W.feel = { rock: true, targets: {} }); fp.targets = { ['hand_' + key]: { point: W.tgt, normal: W.n } }; fp.normal = { x: W.n.x, z: W.n.z }; fp.point = W.tgt;
    feel.active = w > 0.3; feel.trace = w; feel.plan = fp;
    feel.m = { w: 0.6, ny: 0, flat: false };
    void i;
  }

  /* ---------------------------------------------------------------- checks (for the tools / gallery) */
  const _cp = {};
  function check(pl, A) {
    if ((S.checkN = (S.checkN + 1) % 3) !== 0) return;
    const I = window.INTERACT, g = I && I.bvhGeo ? I.bvhGeo(pl.e) : null, root = A.contact && A.contact.root; if (!g || !g.boundsTree || !root) return;
    STATS.holdFrames++;
    const v = new T3.Vector3();
    let air = false;
    for (const b in pl.targets) {
      const bone = root.getObjectByName(b); if (!bone) continue; const pm = palmAt(bone, b, v);
      const r = g.boundsTree.closestPointToPoint(v, _cp); if (!r) continue;
      const gap = Math.max(0, r.distance - (pm ? 0 : 0.035)); S.gaps.push(gap); if (S.gaps.length > 300) S.gaps.shift();
      if (gap > 0.04) air = true;
      // why a palm misses: IK error to its own target, and how far the target is from the shoulder (arm length ~0.55 m)
      const t = pl.targets[b], sh = root.getObjectByName(b.replace('hand', 'upperarm'));
      if (t && sh) { const s = sh.getWorldPosition(new T3.Vector3()); S.handDiag = S.handDiag || {}; S.handDiag[b] = { gapCm: +(gap * 100).toFixed(1), ikErrCm: +(v.distanceTo(t.point) * 100 - 3.5).toFixed(1), reach: +s.distanceTo(t.point).toFixed(2), act: pl.name, phase: S.phase, clip: A.cur }; }
    }
    if (air) STATS.airFrames++;
    // placement contacts (shoulder / back lean, seat): how far the body part the clip leans on is from the drawn rock
    if (pl.sp && pl.sp.bone && !/^hand/.test(pl.sp.bone)) {
      const bone = root.getObjectByName(pl.sp.bone);
      if (bone) { bone.getWorldPosition(v); const r = g.boundsTree.closestPointToPoint(v, _cp); if (r) { S.handDiag = S.handDiag || {}; S.handDiag.place = { bone: pl.sp.bone, distCm: +(r.distance * 100).toFixed(1), act: pl.name, phase: S.phase }; } }
    }
    if (S.gaps.length) { const s = S.gaps.slice().sort((a, b) => a - b); STATS.handGapCm = +(s[s.length >> 1] * 100).toFixed(1); STATS.handGapP90Cm = +(s[Math.floor(s.length * 0.9)] * 100).toFixed(1); }
    // body inside the rock: an odd number of crossings straight up from the pelvis / chest / head
    if (!_ray) _ray = new T3.Ray();
    for (const b of ['pelvis', 'spine_03', 'head']) {
      const bone = root.getObjectByName(b); if (!bone) continue; bone.getWorldPosition(v);
      _ray.origin.copy(v); _ray.direction.set(0, 1, 0);
      let hits = []; try { hits = g.boundsTree.raycast(_ray, T3.DoubleSide) || []; } catch (e) { hits = []; }
      if (hits.length % 2 === 1) { STATS.insideFrames++; STATS.insideBone = b; break; }
    }
  }

  // PoseRejected (modules/pose-pipeline.js PoseSolver): the body volume stayed inside the drawn rock after the whole
  // compromise (pelvis back → less lean → palms higher): let go, ban that action here for K.poseBan s, choose again
  function onPoseRejected(ev) {
    const pl = S.plan; if (!C || !pl || !(S.state === 'act' || S.state === 'hold')) return;
    const P = C.player; rej(pl.name + ':pose'); STATS.poseRejected = (STATS.poseRejected || 0) + 1;
    S.ban = { name: pl.name, e: pl.e, x: P.x, z: P.z, until: C.T + K.poseBan, part: ev && ev.part };
    end(false);
  }
  /* ---------------------------------------------------------------- per frame */
  function update(dt) {
    if (!K.on || !C || !C.PH || !C.PH.ok || !window.INTERACT) return;
    if (!S.sub && window.POSE && window.POSE.on) { S.sub = true; window.POSE.on('PoseRejected', onPoseRejected); }
    const t0 = performance.now(); STATS.frames++;
    const P = C.player, G = C.G, I = window.INTERACTION;
    P.speedCap = undefined;   // re-set below every frame it applies (braking, steering, holding)
    feel.active = false; feel.rel = Math.max(0, feel.rel - dt * 3);
    // a teleport / respawn / the game moving the pilot: whatever was going on at the old rock is over
    if (S.lastP && Math.hypot(P.x - S.lastP.x, P.z - S.lastP.z) > 2.5 && S.state !== 'free') { if (owns()) end(false); S.state = 'free'; S.lastEnd = -9; }
    S.lastP = S.lastP || { x: 0, z: 0 }; S.lastP.x = P.x; S.lastP.z = P.z;
    const PB = C.physbody;
    const ok = (C.mode === 'play' || C.mode === 'menu') && !G.riding && G.deadT <= 0 && !(P.aimT > 0) && !(PB && PB.owns && PB.owns()) && !(I && I.B && I.B.arms && I.B.arms.mode === 'push');
    if (S.state === 'stepup') { if (ok && S.su) stepUp(dt, P); else { C.PH.ch.setEnabled(true); C.PH.ch.setPosition(P.x, P.y, P.z); S.state = 'free'; S.su = null; } return; }
    if (C.CLIMB && C.CLIMB.t >= 0) { if (owns()) end(false); if (S.state !== 'climb') S.state = 'climb'; return; }
    if (S.state === 'climb') { S.state = 'free'; S.lastEnd = C.T; }
    if (!ok) { if (owns()) end(false); S.state = 'free'; return; }
    NEAR = nearRocks(P.x, P.y, P.z, K.radius);
    if (!NEAR.length && !owns() && S.state !== 'walktouch') { S.state = 'free'; S.stillT = 0; return; }
    const i = inp(), hs = Math.hypot(P.vx, P.vz);
    S.stillT = hs < 0.25 && !i.on && P.onGround ? S.stillT + dt : 0;
    const combat = (C.enemies && C.enemies.some((e) => !e.dead && e.st !== 'idle' && e.st !== 'return')) || (C.boss && C.boss.active && !C.boss.dead);
    if (combat) { if (owns()) end(false); if (S.state !== 'free') S.state = 'free'; return; }
    if (S.state === 'release') { S.t += dt; if (S.t > 0.35) S.state = 'free'; else return; }
    if (S.state === 'steer') steer(dt, P, i);
    else if (S.state === 'act' || S.state === 'hold') { if (!P.onGround) { end(false); } else hold(dt, P, i); }
    else if (S.state === 'walktouch') walkTouch(dt, P, i, hs);
    else if (S.state === 'squeeze') squeeze(dt, P, i);
    else free(dt, P, i, hs);
    const ms = performance.now() - t0; STATS.ms = STATS.ms * 0.95 + ms * 0.05; STATS.msMax = Math.max(STATS.msMax * 0.999, ms);
  }

  window.ROCKBRAIN = {
    K, STATS, ACTS, feel, owns, ownsAnim,
    get state() { return S.state; }, get plan() { return S.plan; }, get lastChoice() { return S.lastChoice || null; },
    // the hand bones this module has on the rock this frame: a hold's IK'd palms (main clip), a walk-touch's trailing hand
    hands() {
      if ((S.state === 'hold') && S.plan && S.plan.targets && S.phase === 'main') return Object.keys(S.plan.targets).filter((b) => /^hand/.test(b));
      if (S.state === 'walktouch' && S.wt.w > 0.6 && S.wt.tgt) return ['hand_' + (S.wt.side > 0 ? 'r' : 'l')];
      return [];
    },
    rockNear: () => NEAR.slice(), rcSize: () => RC.size,
    isRock: (e) => !!(e && ROCK_RE.test(String(e.name || ''))), isRockTag,
    // for tools: read the faces around a point / choose for an intent right now / what an action would do
    read: (x, y, z) => { const P = C.player; NEAR = nearRocks(x, y, z, K.radius); return scan({ x, y, z, face: P.face }, null, 2.4); },
    choose: (intent) => { const P = C.player; NEAR = nearRocks(P.x, P.y, P.z, K.radius); return choose(intent, P, null, 2.4); },
    rest: () => { S.stillT = K.restDelay; S.restMiss = null; S.lastEnd = -9; },
    avail: (n) => avail(n), shoulder: (c, b) => shoulderOf(c, b), spec: (n) => { const s = spec(n); return s ? { clip: s.clip, enter: s.enter, exit: s.exit, h: s.h, fwd: s.fwd, lat: s.lat, bone: s.bone, type: s.type } : s; },
    get stillT() { return S.stillT; },
    stop: () => end(false),
    clearCache: () => RC.clear(),
    debug() {
      const pl = S.plan;
      return { state: S.state, t: +S.t.toFixed(2), near: NEAR.map((e) => e.name), plan: pl ? { name: pl.name, intent: pl.intent, rock: pl.e && pl.e.name, stand: [+pl.sx.toFixed(2), +pl.sz.toFixed(2)], yaw: +pl.yaw.toFixed(2), pitch: +pl.pitch.toFixed(2) } : null,
        lastChoice: S.lastChoice || null, handDiag: S.handDiag || null, stats: Object.assign({}, STATS, { rejected: Object.assign({}, STATS.rejected), acts: Object.assign({}, STATS.acts) }) };
    },
  };
  (window.GameModules = window.GameModules || []).push({
    // order 49: updates run from the highest order down, so this runs right after modules/interaction.js (50) each
    // frame — after its leg IK / lean / arms, before the render: the hand IK here is the last word on the arms
    name: 'rock-brain', order: 49,
    init(ctx) { C = ctx; T3 = ctx.THREE; },
    update(dt) { try { update(dt); } catch (e) { STATS.err = String(e && e.stack || e).slice(0, 400); if (!STATS.errN) console.warn('rock-brain', e); STATS.errN = (STATS.errN || 0) + 1; } },
  });
})();
