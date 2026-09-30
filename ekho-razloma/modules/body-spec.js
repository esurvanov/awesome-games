/* Module "body-spec" — BodySpec: the ONE source of the pilot's body measures (ARCH-INTERACT.md, step 2).
 *
 *  measure   once the pilot model is loaded, every drawn vertex of its skinned suit (and any rigid mesh hung under a
 *            bone, e.g. a helmet) is given to its dominant bone and expressed in that bone's frame, rotation only, world
 *            metres — so the numbers do not depend on the pose the mixer happens to hold. Per bone: the spread of its
 *            vertices around the bone → joint axis gives the segment's radius; the helmet is the sphere around the head
 *            bone's vertices; palm = the glove vertices on the palm side (hand local +Y, ANIMLIB.PALM).
 *  export    window.BODYSPEC (frozen once measured; { ready:false } before) and ctx.bodySpec. All lengths in world
 *            metres at the game scale (the pilot is fitted to 1.90 m by prepModel). debugDraw() / debugHide() show the
 *            measured volumes over the pilot (semi-transparent), following the bones every frame.
 *
 * Reads only: ctx.AV.player (mixer root), bone world matrices, vertex positions. Writes nothing to the scene except
 * the debug overlay while it is on.
 */
(function () {
  let C = null, T3 = null, SPEC = null, tries = 0;
  const STUB = { ready: false, err: null, whenReady: null };
  let resolveReady = null; STUB.whenReady = new Promise((r) => { resolveReady = r; });
  window.BODYSPEC = STUB;
  STUB.tries = () => tries; STUB.measureNow = () => measure();   // diagnostics while not ready

  const pct = (arr, p) => { if (!arr.length) return 0; const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))]; };
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

  function measure() {
    const A = C.AV && C.AV.player; if (!A || !A.mixer) return null;
    const root = A.mixer.getRoot(); if (!root) return null;
    root.updateMatrixWorld(true);
    const bones = {}; root.traverse((o) => { if (o.isBone) bones[o.name.toLowerCase()] = o; });   // the rig names its head bone 'Head'
    if (!bones.head || !bones.pelvis || !bones.hand_l || !bones.foot_l || !bones.neck_01) return null;
    const V = T3.Vector3, Q = T3.Quaternion;
    const bw = {}; for (const n in bones) { const b = bones[n], p = new V(), q = new Q(), s = new V(); b.matrixWorld.decompose(p, q, s); bw[n] = { p, qi: q.clone().invert() }; }
    const rel = (n, w) => w.clone().sub(bw[n].p).applyQuaternion(bw[n].qi);   // world point → bone frame (rotation only, world metres)
    const qc = root.getWorldQuaternion(new Q()).invert();                    // character frame: +X left, +Z forward (ANIMLIB)
    // every drawn vertex, world space, with its dominant skin bone
    const VS = [], box = new T3.Box3(), v = new V(); let nSkin = 0, nRigid = 0;
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position || o.visible === false) return;
      const pos = o.geometry.attributes.position, N = pos.count, step = N > 60000 ? 2 : 1;
      if (o.isSkinnedMesh && o.skeleton && o.geometry.attributes.skinIndex) {
        const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight, sb = o.skeleton.bones;
        for (let i = 0; i < N; i += step) {
          let best = 0, bi = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > best) { best = w; bi = si.getComponent(i, k); } }
          const b = sb[bi], bn = b && b.name.toLowerCase(); if (!b || !bones[bn]) continue;
          o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld); box.expandByPoint(v); VS.push([v.clone(), bn, best]); nSkin++;
        }
      } else {   // a rigid mesh under a bone (helmet, visor, gear): all its vertices belong to that bone
        let p = o.parent; while (p && !p.isBone) p = p.parent; const pn = p && p.name.toLowerCase(); if (!p || !bones[pn]) return;
        for (let i = 0; i < N; i += step) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); box.expandByPoint(v); VS.push([v.clone(), pn]); nRigid++; }
      }
    });
    if (VS.length < 200) return null;
    const jointD = (a, b) => (bones[a] && bones[b] ? bw[a].p.distanceTo(bw[b].p) : 0);
    const axisOf = (n, to) => (bones[to] ? rel(n, bw[to].p) : null);
    // skin weights only split off the head (helmet) and the hands (glove = hand + finger bones); the rest of the suit is
    // given to the NEAREST body segment geometrically — dominant weights put collar / sleeve-root vertices on the wrong
    // bone and made every limb look twice as fat (first measurement)
    const SEGS = [['pelvis', 'pelvis', 'spine_02'], ['chest', 'spine_02', 'neck_01']];
    for (const s of ['l', 'r']) SEGS.push(['upperarm_' + s, 'upperarm_' + s, 'lowerarm_' + s], ['lowerarm_' + s, 'lowerarm_' + s, 'hand_' + s],
      ['thigh_' + s, 'thigh_' + s, 'calf_' + s], ['calf_' + s, 'calf_' + s, 'foot_' + s], ['foot_' + s, 'foot_' + s, 'ball_' + s]);
    const segs = SEGS.filter(([, a, b]) => bones[a] && bones[b]).map(([k, a, b]) => { const A0 = bw[a].p, D = bw[b].p.clone().sub(A0), L = D.length(); return { k, a, A0, u: D.divideScalar(L || 1), L, d: [], off: [] }; });
    const handOf = (bn) => { const m = /^(hand|index|middle|pinky|ring|thumb)_.*?([lr])$/.exec(bn) || /^(hand)_([lr])$/.exec(bn); return m ? 'hand_' + m[2] : null; };
    const head = [], hands = { hand_l: [], hand_r: [] }, body = [], tmp = new V();
    for (const [w, bn] of VS) { if (bn === 'head') head.push(w); else { const h = handOf(bn); if (h) hands[h].push(w); else body.push(w); } }
    // nearest SURFACE, not nearest axis: a vertex goes to the segment with the smallest (distance to axis − its radius);
    // radii start from rough proportions and are re-estimated 3 times (a torso vertex is farther from the spine than an
    // arm vertex is from the arm, so nearest-axis gave the torso to the arms)
    const R0 = { pelvis: 0.16, chest: 0.17, upperarm: 0.07, lowerarm: 0.06, thigh: 0.09, calf: 0.07, foot: 0.06 };
    for (const S of segs) S.r = R0[S.k.replace(/_[lr]$/, '')] || 0.08;
    for (let it = 0; it < 4; it++) {
      for (const S of segs) { S.d = []; S.off = []; }
      for (const w of body) {
        let best = null, bs = 1e9, bd = 0, bt = 0;
        for (const S of segs) { tmp.copy(w).sub(S.A0); const t = clamp01(tmp.dot(S.u) / (S.L || 1)); const d = tmp.sub(S.u.clone().multiplyScalar(t * S.L)).length(); if (d - S.r < bs) { bs = d - S.r; best = S; bd = d; bt = t; } }
        if (best && bt > 0.12 && bt < 0.88) { best.d.push(bd); if (it === 3 && (best.k === 'chest' || best.k === 'pelvis')) best.off.push(w.clone().sub(best.A0).sub(best.u.clone().multiplyScalar(bt * best.L)).applyQuaternion(qc)); }
      }
      for (const S of segs) if (S.d.length > 30) S.r = pct(S.d, 0.6);
    }
    const SG = {}; for (const S of segs) SG[S.k] = S;
    // strongly weighted vertices of a bone set (dominant weight ≥ 0.6): the suit part that really moves with that bone
    const strong = (names, minW = 0.6) => VS.filter(([, bn, wt]) => wt >= minW && names.includes(bn)).map(([w]) => w);
    function limbR(a, b) {   // radius of the limb from its own strongly weighted vertices, around the joint axis, 15–85 % of its length
      if (!bones[a] || !bones[b]) return 0; const A0 = bw[a].p, D = bw[b].p.clone().sub(A0), Lx = D.length(), u = D.divideScalar(Lx || 1), d = [];
      for (const w of strong([a])) { const o = w.clone().sub(A0), t = o.dot(u); if (t < 0.15 * Lx || t > 0.85 * Lx) continue; d.push(o.sub(u.clone().multiplyScalar(t)).length()); }
      return d.length > 20 ? pct(d, 0.9) : 0;
    }
    const segR0 = (k) => (SG[k] && SG[k].d.length ? pct(SG[k].d, 0.85) : 0);
    const L = { upperarm: { r: limbR('upperarm_l', 'lowerarm_l') }, lowerarm: { r: limbR('lowerarm_l', 'hand_l') }, thigh: { r: segR0('thigh_l') }, calf: { r: segR0('calf_l') } };
    const R = { upperarm: { r: limbR('upperarm_r', 'lowerarm_r') }, lowerarm: { r: limbR('lowerarm_r', 'hand_r') }, thigh: { r: segR0('thigh_r') }, calf: { r: segR0('calf_r') } };
    // helmet: the head's own vertices above the neck joint (the collar ring is weighted to the head too) → box centre, p95 radius
    const neckY = bw.neck_01.p.y, hb = new T3.Box3(); const hp = head.filter((w) => w.y > neckY + 0.06); for (const w of hp) hb.expandByPoint(w);
    const hcW = hb.getCenter(new V()), hd = hp.map((w) => w.distanceTo(hcW)), hc = rel('head', hcW);
    const helmet = { center: [r3(hc.x), r3(hc.y), r3(hc.z)], r: r3(pct(hd, 0.95)), rMax: r3(pct(hd, 1)), size: hb.getSize(new V()).toArray().map(r3), n: hp.length };
    function torso(k, from, to) {
      const S = SG[k]; if (!S || !S.d.length) return null; const a = bw[from].p, b = bw[to].p;
      return { r: r3(pct(S.d, 0.85)), rMax: r3(pct(S.d, 0.99)), halfW: r3(pct(S.off.map((o) => Math.abs(o.x)), 0.97)), halfD: r3(pct(S.off.map((o) => Math.abs(o.z)), 0.97)),
        y0: r3(a.y - box.min.y), y1: r3(b.y - box.min.y), n: S.d.length };
    }
    // the chest by its own height band, inside the shoulder joints (the arm segments grab the torso sides otherwise)
    function band(y0, y1, from) {
      const a = bw[from].p, sx = Math.abs(rel0(bw.upperarm_l.p).x) - 0.02, ox = [], oz = [];
      for (const w of body) { if (w.y < y0 || w.y > y1) continue; const o = rel0(w); if (Math.abs(o.x) > sx) continue; ox.push(Math.abs(o.x)); oz.push(Math.abs(o.z)); }
      void a; return ox.length > 50 ? { halfW: r3(pct(ox, 0.97)), halfD: r3(pct(oz, 0.97)), r: r3(Math.hypot(pct(ox, 0.9), pct(oz, 0.9)) / Math.SQRT2 * 1.1), n: ox.length } : null;
    }
    function rel0(w) { return w.clone().sub(bw.pelvis.p).applyQuaternion(qc); }   // character frame around the pelvis axis
    // chest: only the vertices weighted to spine_02 / spine_03 (no arms, no collar), character frame around the spine axis
    const chest0 = torso('chest', 'spine_02', 'neck_01');
    // (this rig weights the chest softly: spine_02 has no vertex ≥ 0.6, spine_03 24 of 1050 — dominant bone, any weight;
    // the clavicle vertices count only inside the shoulder joints, the rest is the shoulder cap)
    const shX = Math.abs(bw.upperarm_l.p.clone().sub(bw.spine_02.p).applyQuaternion(qc).x);
    const CW = strong(['spine_02', 'spine_03', 'clavicle_l', 'clavicle_r'], 0).filter((w) => Math.abs(w.clone().sub(bw.spine_02.p).applyQuaternion(qc).x) < shX), ax0 = bw.spine_02.p, cx = [], cz = [], cr = [];
    for (const w of CW) { const o = w.clone().sub(ax0).applyQuaternion(qc); cx.push(Math.abs(o.x)); cz.push(o.z); }
    const zMid = (pct(cz, 0.97) + pct(cz, 0.03)) / 2;
    for (let i = 0; i < cx.length; i++) cr.push(Math.hypot(cx[i], cz[i] - zMid));
    const chest = chest0 && CW.length > 50 ? Object.assign(chest0, { halfW: r3(pct(cx, 0.97)), halfD: r3((pct(cz, 0.97) - pct(cz, 0.03)) / 2), zCenter: r3(zMid), r: r3(pct(cr, 0.85)), rMax: r3(pct(cr, 0.99)), n: CW.length }) : chest0;
    const pelvis = torso('pelvis', 'pelvis', 'spine_02');
    const cloud = { hand_l: hands.hand_l.map((w) => rel('hand_l', w)), hand_r: hands.hand_r.map((w) => rel('hand_r', w)),
      foot_l: [], foot_r: [] };
    for (const s of ['l', 'r']) for (const [w, bn] of VS) if (bn === 'foot_' + s || bn === 'ball_' + s) cloud['foot_' + s].push(rel('foot_' + s, w));
    // palm: the glove vertices weighted to the hand bone (≥ 0.6), hand local frame. Palm side = local +Y (ANIMLIB.PALM,
    // measured on this rig). Centre = the clips' authored palm point (60 % wrist → middle_01) moved out to the glove skin
    // on the +Y side; the normal is the mean of the skin normals there — checked against +Y, not assumed
    function palm(s) {
      const n = 'hand_' + s; if (!bones['middle_01_' + s]) return null;
      // this rig has no vertex weighted to the hand bone: the glove is weighted to the forearm (+ thumbs) — the glove =
      // forearm / hand / finger vertices past the wrist joint along the forearm → wrist axis
      const la = bw['lowerarm_' + s].p, fu = bw[n].p.clone().sub(la), fl = fu.length(); fu.divideScalar(fl || 1);
      // (past the wrist only the thumbs were found: the glove body sits around the wrist joint, weighted to the forearm)
      const hp0 = bw[n].p, P = VS.filter(([w, bn]) => (bn === 'lowerarm_' + s || bn === n || handOf(bn) === n) && w.distanceTo(hp0) < 0.16 && w.clone().sub(la).dot(fu) > fl - 0.05).map(([w]) => rel(n, w));
      if (P.length < 50) return null;
      // palm plane: principal axes of the glove cloud — the hand is flat, the smallest-spread axis is the palm normal;
      // fingers curl toward the palm, so the distal third of the glove leans to the palm side (the sign)
      const mc = new V(); for (const p of P) mc.add(p); mc.divideScalar(P.length);
      const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const p of P) { const d = [p.x - mc.x, p.y - mc.y, p.z - mc.z]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += d[i] * d[j]; }
      const ev = (M) => { let v0 = new V(1, 0.3, 0.2).normalize(); const inv = new T3.Matrix3().set(...M.flat()).invert(); for (let k = 0; k < 40; k++) v0 = v0.applyMatrix3(inv).normalize(); return v0; };   // inverse power iteration → smallest eigenvector
      const nn = ev(cov);
      const f = axisOf(n, 'middle_01_' + s) ? axisOf(n, 'middle_01_' + s).normalize() : new V(0, 1, 0);
      const proj = P.map((p) => p.clone().sub(mc).dot(f)), pMax = pct(proj, 0.97), dist = P.filter((p, i) => proj[i] > pMax * 0.4);
      const dc = new V(); for (const p of dist) dc.add(p); dc.divideScalar(dist.length || 1); if (dc.sub(mc).dot(nn) < 0) nn.negate();
      const al = P.map((p) => p.clone().sub(mc).dot(nn)), skin = pct(al.filter((x) => x > 0), 0.95), back = pct(al.filter((x) => x < 0).map((x) => -x), 0.95);
      const nx = nn.x, ny = nn.y, nz = nn.z, sk = al.filter((x) => x > 0);
      const cS = mc.clone().add(nn.clone().multiplyScalar(skin));
      const pa = (window.ANIMLIB && ANIMLIB.PALM && ANIMLIB.PALM['_' + s]) || [0, 1, 0], palmAxisDeg = Math.acos(Math.max(-1, Math.min(1, nn.dot(new V(...pa).normalize())))) * 180 / Math.PI;
      return { center: [r3(cS.x), r3(cS.y), r3(cS.z)], normal: [r3(nx), r3(ny), r3(nz)], vsANIMLIB_PALM_deg: r3(palmAxisDeg), fingerAxis: [r3(f.x), r3(f.y), r3(f.z)],
        wristToPalm: r3(cS.length()), palmSkinOverBone: r3(skin), thickness: r3(skin + back), n: P.length, nSkin: sk.length, gloveBox: (() => { const b = new T3.Box3(); for (const q of P) b.expandByPoint(q); return [b.min.toArray().map(r3), b.max.toArray().map(r3)]; })() };
    }
    function boot(s) {
      const n = 'foot_' + s, pts = (cloud[n] || []).concat((cloud['ball_' + s] || []).map((p) => p.clone().applyQuaternion(bw['ball_' + s].qi.clone().invert()).add(bw['ball_' + s].p).sub(bw[n].p).applyQuaternion(bw[n].qi)));
      if (!pts.length) return null;
      const ankleY = bw[n].p.y - box.min.y;   // the sole touches box.min in the bind / idle stance
      const wy = pts.map((p) => p.clone().applyQuaternion(bw[n].qi.clone().invert()).y + bw[n].p.y - box.min.y);
      return { ankleHeight: r3(ankleY), soleBelowAnkle: r3(ankleY - pct(wy, 0.01)), n: pts.length };
    }
    const height = box.max.y - box.min.y;
    const shoulderW = jointD('upperarm_l', 'upperarm_r') + (L.upperarm.r + R.upperarm.r);
    const spec = {
      ready: true, measuredAt: new Date().toISOString(), scale: r3(root.getWorldScale(new V()).x),
      height: r3(height), verts: { skinned: nSkin, rigid: nRigid },
      helmet,
      shoulderWidth: r3(shoulderW), shoulderHalf: r3(shoulderW / 2),
      chest, pelvis,
      arm: { upper: r3(jointD('upperarm_l', 'lowerarm_l')), fore: r3(jointD('lowerarm_l', 'hand_l')), hand: r3(jointD('hand_l', 'middle_01_l') || 0),
        reach: r3(jointD('upperarm_l', 'lowerarm_l') + jointD('lowerarm_l', 'hand_l')),
        upperR: r3((L.upperarm.r + R.upperarm.r) / 2), foreR: r3((L.lowerarm.r + R.lowerarm.r) / 2) },
      leg: { thigh: r3(jointD('thigh_l', 'calf_l')), shin: r3(jointD('calf_l', 'foot_l')), thighR: r3((L.thigh.r + R.thigh.r) / 2), shinR: r3((L.calf.r + R.calf.r) / 2),
        hipHeight: r3(bw.thigh_l.p.y - box.min.y) },
      palm: { l: palm('l'), r: palm('r') },
      boot: { l: boot('l'), r: boot('r') },
      suitOverBone: r3((L.upperarm.r + R.upperarm.r + L.thigh.r + R.thigh.r) / 4),
    };
    // recommended physics capsule: the widest of the torso cross-sections (+2 cm) — the vertical body, arms down
    const torsoR = Math.max(chest ? Math.max(chest.halfW, chest.halfD) : 0, pelvis ? Math.max(pelvis.halfW, pelvis.halfD) : 0);   // the widest torso half-size
    spec.capsule = { radius: r3(torsoR + 0.02), slimRadius: r3(Math.max(chest ? chest.halfD : 0, pelvis ? pelvis.halfD : 0) + 0.02), height: r3(height) };
    return spec;
  }


  /* ---------------------------------------------------------------- palm by contact (the clips' own wall / ledge) */
  // The palm is measured where it is USED: each contact clip is posed on the pilot's own mixer at the middle of its
  // contact window, the clip's authored surface (point + normal, character space, ANIMLIB meta) is the wall, and the
  // skinned glove vertices nearest to that plane are the palm contact. Result in the hand bone frame (and the forearm
  // frame): centre of the contact patch, the wall normal, the bone → contact thickness, the clip's own gap to its wall.
  function palmContact() {
    const A = C.AV && C.AV.player, meta = A && A.contactMeta; if (!A || !A.mixer || !meta || !A.acts) return null;
    const mixer = A.mixer, root = mixer.getRoot(), V = T3.Vector3, Q = T3.Quaternion;
    const saved = []; for (const k in A.acts) { const a = A.acts[k]; saved.push([a, a.isRunning(), a.time, a.getEffectiveWeight(), a.getEffectiveTimeScale()]); }
    const bones = {}; root.traverse((o) => { if (o.isBone) bones[o.name.toLowerCase()] = o; });
    const handOf = (bn) => { const m = /^(hand|index|middle|pinky|ring|thumb)_.*?([lr])$/.exec(bn); return m ? 'hand_' + m[2] : null; };
    const rows = [];
    try {
      for (const name of ['hand_wall_r_loop', 'hand_wall_l_loop', 'hand_wall_both_loop', 'lean_hands_ledge_loop']) {
        const cm = meta.clips[name], act = A.acts[name]; if (!cm || !act) continue;
        for (const k in A.acts) A.acts[k].stop();
        act.reset(); act.play(); act.setEffectiveWeight(1); act.setEffectiveTimeScale(0);
        for (const c of cm.contacts) {
          if (!/^hand_[lr]$/.test(c.bone)) continue;
          act.time = (c.window[0] + c.window[1]) / 2; mixer.update(0); root.updateMatrixWorld(true);
          const s = c.bone.slice(-1), hb = bones['hand_' + s], lb = bones['lowerarm_' + s];
          const P0 = root.localToWorld(new V(...c.surface.point)), N = new V(...c.surface.normal).transformDirection(root.matrixWorld);   // N: out of the wall, toward the pilot
          const hp = hb.getWorldPosition(new V()), hq = hb.getWorldQuaternion(new Q()), hqi = hq.clone().invert(), lq = lb.getWorldQuaternion(new Q()).invert(), lp = lb.getWorldPosition(new V());
          // the glove, skinned now: forearm / hand / finger vertices within 16 cm of the wrist
          const G = [], v = new V();
          root.traverse((o) => {
            if (!o.isSkinnedMesh || !o.geometry.attributes.skinIndex) return;
            const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight, sb = o.skeleton.bones, N0 = si.count;
            for (let i = 0; i < N0; i++) {
              let best = 0, bi = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > best) { best = w; bi = si.getComponent(i, k); } }
              const bn = sb[bi] && sb[bi].name.toLowerCase(); if (!(bn === 'lowerarm_' + s || bn === 'hand_' + s || handOf(bn) === 'hand_' + s)) continue;
              o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld); if (v.distanceTo(hp) < 0.16) G.push(v.clone());
            }
          });
          if (G.length < 50) continue;
          const d = G.map((w) => w.clone().sub(P0).dot(N)), dMin = Math.min(...d);
          const patch = G.filter((w, i) => d[i] < dMin + 0.008), cc = new V(); for (const w of patch) cc.add(w); cc.divideScalar(patch.length);
          const cWall = cc.clone().sub(N.clone().multiplyScalar(cc.clone().sub(P0).dot(N) - dMin));   // on the contact plane
          const inHand = cWall.clone().sub(hp).applyQuaternion(hqi), nHand = N.clone().negate().applyQuaternion(hqi);   // palm normal = INTO the wall (the way the palm faces)
          const inFore = cWall.clone().sub(lp).applyQuaternion(lq), nFore = N.clone().negate().applyQuaternion(lq);
          rows.push({ clip: name, side: s, patchN: patch.length, gloveN: G.length, clipGapCm: +(dMin * 100).toFixed(1),
            centerHand: inHand.toArray().map(r3), normalHand: nHand.toArray().map(r3), centerFore: inFore.toArray().map(r3), normalFore: nFore.toArray().map(r3),
            boneToContact: r3(hp.clone().sub(P0).dot(N) - dMin), wristToCenter: r3(inHand.length()) });
        }
      }
    } finally {
      for (const [a, run, t, w, ts] of saved) { a.stop(); if (run) { a.play(); a.time = t; a.setEffectiveWeight(w); a.setEffectiveTimeScale(ts); } }
      mixer.update(0); root.updateMatrixWorld(true);
    }
    const side = (s) => {
      const R = rows.filter((r) => r.side === s); if (!R.length) return null;
      const W = R.filter((r) => /hand_wall/.test(r.clip)), use = W.length ? W : R;   // walls define the palm; the ledge is the check
      const avg = (k) => [0, 1, 2].map((i) => r3(use.reduce((a, r) => a + r[k][i], 0) / use.length));
      const n = new V(...avg('normalHand')).normalize(), nf = new V(...avg('normalFore')).normalize();
      const spread = Math.max(...R.map((r) => Math.acos(Math.max(-1, Math.min(1, new V(...r.normalHand).dot(n)))) * 180 / Math.PI));
      return { center: avg('centerHand'), normal: n.toArray().map(r3), centerFore: avg('centerFore'), normalFore: nf.toArray().map(r3),
        boneToContact: r3(use.reduce((a, r) => a + r.boneToContact, 0) / use.length), normalSpreadDeg: r3(spread), clips: R };
    };
    return { l: side('l'), r: side('r') };
  }

  /* ---------------------------------------------------------------- debug overlay */
  const DBG = { on: false, g: null, parts: [] }, HOLD = { name: null, t: 0 };
  function debugBuild() {
    if (!SPEC || !SPEC.ready) return false;
    const A = C.AV.player, root = A.mixer.getRoot(), bones = {}; root.traverse((o) => { if (o.isBone) bones[o.name.toLowerCase()] = o; });
    const mat = (c) => new T3.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35, depthWrite: false, depthTest: false });
    const g = new T3.Group(); g.name = 'bodyspec_debug'; g.renderOrder = 999; C.scene.add(g);
    const parts = [];
    const sph = (bone, off, r, c) => { const m = new T3.Mesh(new T3.SphereGeometry(r, 20, 14), mat(c)); m.renderOrder = 999; g.add(m); parts.push({ m, bone: bones[bone], off: new T3.Vector3(...off) }); };
    const cap = (from, to, r, c) => { if (!bones[from] || !bones[to]) return; const L = bones[from].getWorldPosition(new T3.Vector3()).distanceTo(bones[to].getWorldPosition(new T3.Vector3()));
      const m = new T3.Mesh(new T3.CapsuleGeometry(r, Math.max(0.01, L), 6, 14), mat(c)); m.renderOrder = 999; g.add(m); parts.push({ m, a: bones[from], b: bones[to], r }); };
    sph('head', SPEC.helmet.center, SPEC.helmet.r, 0xff3344);
    if (SPEC.chest) cap('spine_02', 'neck_01', SPEC.chest.r, 0x33aaff);
    if (SPEC.pelvis) cap('pelvis', 'spine_02', SPEC.pelvis.r, 0x33ffaa);
    for (const s of ['l', 'r']) {
      cap('upperarm_' + s, 'lowerarm_' + s, SPEC.arm.upperR, 0xffaa33); cap('lowerarm_' + s, 'hand_' + s, SPEC.arm.foreR, 0xffaa33);
      cap('thigh_' + s, 'calf_' + s, SPEC.leg.thighR, 0xaa66ff); cap('calf_' + s, 'foot_' + s, SPEC.leg.shinR, 0xaa66ff);
      const p = SPEC['palm_' + s] || SPEC.palm[s]; if (p) { sph('hand_' + s, p.center, 0.015, 0xffff33);
        const ar = new T3.ArrowHelper(new T3.Vector3(0, 1, 0), new T3.Vector3(), 0.12, 0x00ff66, 0.035, 0.02); ar.traverse((o) => { if (o.material) { o.material.depthTest = false; o.renderOrder = 1000; } });
        g.add(ar); parts.push({ arrow: ar, bone: bones['hand_' + s], off: new T3.Vector3(...p.center), dir: new T3.Vector3(...p.normal) }); }
    }
    DBG.g = g; DBG.parts = parts; return true;
  }
  const _a = () => new T3.Vector3();
  function debugUpdate() {
    if (!DBG.on || !DBG.g) return;
    const pa = _a(), pb = _a(), q = new T3.Quaternion(), up = new T3.Vector3(0, 1, 0);   // capsules: built at the joint distance, placed between the joints
    for (const P of DBG.parts) {
      if (P.arrow) { P.bone.getWorldPosition(pa); P.bone.getWorldQuaternion(q); P.arrow.position.copy(P.off).applyQuaternion(q).add(pa); P.arrow.setDirection(P.dir.clone().applyQuaternion(q)); continue; }
      if (P.bone) { P.bone.getWorldPosition(pa); P.bone.getWorldQuaternion(q); P.m.position.copy(P.off).applyQuaternion(q).add(pa); continue; }
      if (!P.a || !P.b) { P.m.visible = false; continue; }
      P.a.getWorldPosition(pa); P.b.getWorldPosition(pb); const d = pb.clone().sub(pa), L = d.length();
      P.m.position.copy(pa).add(pb).multiplyScalar(0.5); P.m.quaternion.setFromUnitVectors(up, d.divideScalar(L || 1));
    }
  }

  function publish(spec) {
    try { const pc = palmContact(); if (pc) { spec.palm_l = pc.l; spec.palm_r = pc.r; spec.palmBy = 'contact clips (hand_wall_*, lean_hands_ledge)'; } } catch (e) { spec.palmErr = String(e && e.message); }
    SPEC = Object.freeze(Object.assign(spec, {
      debugDraw() { if (!DBG.g && !debugBuild()) return false; DBG.on = true; DBG.g.visible = true; return true; },
      debugHide() { DBG.on = false; if (DBG.g) DBG.g.visible = false; },
      palmOnly(on) { for (const P of DBG.parts) { const isPalm = !!P.arrow || (P.m && P.m.geometry && P.m.geometry.parameters && P.m.geometry.parameters.radius === 0.015); if (P.m) P.m.visible = !on || isPalm; } },
      // tools: hold one contact clip's pose (re-applied after the mixer every frame) → screenshots of the palm on its wall
      holdClip(name, t) { HOLD.name = name; HOLD.t = t; }, release() { HOLD.name = null; },
      palmContact: () => palmContact(),
      whenReady: STUB.whenReady,
    }));
    window.BODYSPEC = SPEC; resolveReady(SPEC);
  }

  (window.GameModules = window.GameModules || []).push({
    name: 'body-spec', order: 40,
    init(ctx) { C = ctx; T3 = ctx.THREE; Object.defineProperty(ctx, 'bodySpec', { get: () => window.BODYSPEC, configurable: true }); },
    update() {
      if (!SPEC && tries < 600) {
        tries++;
        if (tries % 10 === 0 || tries === 1) {
          try { const A = C.AV && C.AV.player; const s = A && (A.contactMeta || tries > 300) ? measure() : null; if (s) publish(s); } catch (e) { STUB.err = String(e && e.message); if (tries > 300) tries = 600; }
        }
      }
      if (HOLD.name && C.AV && C.AV.player && C.AV.player.acts[HOLD.name]) { const A = C.AV.player, a = A.acts[HOLD.name]; for (const k in A.acts) if (A.acts[k] !== a) A.acts[k].stop(); a.play(); a.setEffectiveWeight(1); a.setEffectiveTimeScale(0); a.time = HOLD.t; A.mixer.update(0); }
      debugUpdate();
    },
  });
})();
