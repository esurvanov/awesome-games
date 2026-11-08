/* modules/rock-brain-needs.js — what each rock action needs (face width, tilt, contact height, room for the body at each height…), derived once from the clip metadata and the measured body so that there is one source of truth. Moved out of modules/rock-brain.js unchanged. Classic script, loaded BEFORE rock-brain.js: window.createRockBrainNeeds(deps) → { audit, NEED, need, bodyK, bsWait, spec, avail, bind({...}) }. */
(function () {
  'use strict';
  window.createRockBrainNeeds = function (X) {
    const { K, LEGACY, STATS, ACTS, RIM, RC } = X;
    let C, T3, AV, shoulderOf;   // assigned later in the source module: set through bind()
  /* ---------------------------------------------------------------- needs: derived from the clip meta + BODYSPEC */
  const BS = () => { const b = window.BODYSPEC; return b && b.ready ? b : null; };
  const audit = (act, field, old, now) => {
    const f = (v) => JSON.stringify(v, (k, x) => (typeof x === 'number' ? +x.toFixed(3) : x));
    const a = f(old), b2 = f(now); if (a === b2) return;
    let same = false; try { same = Array.isArray(old) ? old.length === now.length && old.every((v, i) => Array.isArray(v) ? v.every((w, j) => Math.abs(w - now[i][j]) < 0.0015) : Math.abs(v - now[i]) < 0.0015) : Math.abs(old - now) < 0.0015; } catch (e) { same = false; }
    if (!same) { STATS.audit.push(act + '.' + field + ': ' + a + ' -> ' + b2); if (K.debug) console.log('rock-brain audit', act, field, a, '->', b2); }
  };
  // the support function of a body part along the horizontal direction u (character frame): an ellipse halfW x halfD, or a sphere
  const supp = (hw, hd, ux, uz) => Math.hypot(hw * ux, hd * uz);
  // where the clip puts a bone (character space, the clip's middle frame), sampled once on a copy of the rig
  const BONE = {};
  function boneOf(clip, bone) {
    const key = clip + ':' + bone; if (BONE[key] !== undefined) return BONE[key];
    BONE[key] = null;
    try {
      const A = AV(), root = A && A.contact && A.contact.root, act = A && A.acts[clip], SU = T3.SkeletonUtils; if (!root || !act || !SU) return null;
      const c2 = SU.clone(root), m2 = new T3.AnimationMixer(c2), a2 = m2.clipAction(act.getClip()); a2.play(); m2.setTime(act.getClip().duration * 0.5);
      c2.position.set(0, 0, 0); c2.rotation.set(0, 0, 0); c2.scale.set(1, 1, 1); c2.updateMatrixWorld(true);
      const b = c2.getObjectByName(bone); if (b) { const v = b.getWorldPosition(new T3.Vector3()); BONE[key] = { p: [v.x, v.y, v.z], q: b.getWorldQuaternion(new T3.Quaternion()) }; }
      m2.stopAllAction();
    } catch (e) { BONE[key] = null; }
    return BONE[key];
  }
  const NEED = {};   // action name -> derived needs (null: cannot be derived yet — no meta / BODYSPEC not measured)
  // body volumes along the direction of the rock, as the clip holds them: [[height, clearance]] — the face must be at least
  // `clearance` away from the stand spot (along the face normal) at that height, or the volume is inside the rock
  function bodyNeeds(clip, face, bs) {
    const fl = Math.hypot(face[0], face[1]) || 1, u = [face[0] / fl, face[1] / fl], parts = [], out = [];
    if (bs.pelvis) parts.push({ bone: 'pelvis', hw: bs.pelvis.halfW, hd: bs.pelvis.halfD, zc: 0 });
    if (bs.chest) { parts.push({ bone: 'spine_02', hw: bs.chest.halfW, hd: bs.chest.halfD, zc: bs.chest.zCenter || 0 }); parts.push({ bone: 'spine_03', hw: bs.chest.halfW, hd: bs.chest.halfD, zc: bs.chest.zCenter || 0 }); }
    if (bs.helmet) parts.push({ bone: 'head', sphere: bs.helmet.r, c: bs.helmet.center });
    parts.push({ bone: 'calf_l', hw: bs.leg.thighR, hd: bs.leg.thighR, zc: 0 }); parts.push({ bone: 'calf_r', hw: bs.leg.thighR, hd: bs.leg.thighR, zc: 0 });   // the knees
    for (const pt of parts) {
      const b = boneOf(clip, pt.bone); if (!b) continue;
      let px = b.p[0], pz = b.p[2], ext;
      if (pt.sphere) { const c = new T3.Vector3(pt.c[0], pt.c[1], pt.c[2]).applyQuaternion(b.q); px += c.x; pz += c.z; ext = px * u[0] + pz * u[1] + pt.sphere; out.push([b.p[1] + c.y, ext]); continue; }
      pz += pt.zc; ext = px * u[0] + pz * u[1] + supp(pt.hw, pt.hd, u[0], u[1]); out.push([b.p[1], ext]);
    }
    return out.map(([h, e]) => [+h.toFixed(3), +Math.max(0, e).toFixed(3)]);
  }
  // the width of the glove across the fingers (BODYSPEC palm: glove box in the hand frame, across = fingerAxis x normal)
  function palmWidth(bs, side) {
    const p = bs.palm && bs.palm[side]; if (!p || !p.gloveBox || !p.fingerAxis || !p.normal) return 2 * bs.arm.foreR;
    const f = p.fingerAxis, n = p.normal, cr = [f[1] * n[2] - f[2] * n[1], f[2] * n[0] - f[0] * n[2], f[0] * n[1] - f[1] * n[0]];
    let i = 0; for (let k = 1; k < 3; k++) if (Math.abs(cr[k]) > Math.abs(cr[i])) i = k;
    return p.gloveBox[1][i] - p.gloveBox[0][i];
  }
  // one action's needs, all from the clip meta (req / heightRange / approach.distance / surface) and BODYSPEC
  function need(name) {
    if (NEED[name] !== undefined) return NEED[name];
    const A = ACTS[name], sp = A && spec(name), bs = BS(), meta = C.AV && C.AV.player && C.AV.player.contactMeta;
    if (!A || !sp || !bs || !meta) return null;   // not cached: tried again once the meta / BODYSPEC are there
    const m = meta.clips[sp.clip], rq = m.req || {}, st = rq.stretch || {}, N = { name, h: rq.h || null, contactTol: st.contact !== undefined ? st.contact : 0.15, spineTol: st.spine !== undefined ? st.spine : 0.2 };
    const hc = sp.contacts.filter((c) => /^hand/.test(c.bone) && c.hold !== false), pc = sp.contacts[0];
    // stand spot tolerance: the arm / the pose absorbs only what the clip's own approach range allows (near: closer than the ideal, far: further)
    const ap = sp.contacts.filter((c) => c.approach && c.approach.distance && /^hand|^upperarm|^spine|^pelvis/.test(c.bone)).map((c) => c.approach.distance);
    N.near = ap.length ? Math.min(...ap.map((d) => d[1] - d[0])) : 0.05; N.far = ap.length ? Math.min(...ap.map((d) => d[2] - d[1])) : 0.05;
    N.lat = N.contactTol;
    if (A.kind === 'wall') {
      const tl = rq.tilt || [-0.15, 0.3];
      // the face tilt the clip covers, plus what the spine may tilt on top (stretch.spine): the spine follows the face by pitchK, so a
      // spine tilt of spineTol absorbs spineTol / |pitchK| of extra face tilt (no spine follow → no widening)
      const ex = A.pitchK ? N.spineTol / Math.abs(A.pitchK) : 0; N.tilt = [tl[0] - ex, tl[1] + ex];
      // facade width the contact needs: the clip's own (req.width), else the body part that leans / touches (BODYSPEC)
      N.minW = rq.width !== undefined ? rq.width : /^hand/.test(pc.bone) ? palmWidth(bs, pc.bone === 'hand_l' ? 'l' : 'r') : /^upperarm/.test(pc.bone) ? 2 * bs.arm.upperR : 2 * (bs.chest ? bs.chest.halfW : 0.2);
      // contact height range over the stand ground (req.h) and the lowest top that still holds the contact patch
      const ch = sp.h; N.topMin = A.hands ? (rq.h ? rq.h[0] : ch) + RIM : ch + (/^upperarm/.test(pc.bone) ? bs.arm.upperR : (bs.chest ? bs.chest.halfW : 0.15));
    } else if (A.kind === 'ledge' || A.kind === 'seat') {
      N.top = rq.h ? rq.h.slice() : null; N.flat = !!rq.flat;
      if (A.kind === 'seat') { N.seatH = sp.h; N.dip = N.top ? [sp.h - N.top[1], sp.h - N.top[0]] : [-0.05, 0.06]; }   // dip > 0: the top is lower than the clip's seat → lower the body
    } else if (A.kind === 'gap') {
      N.gap = rq.gap ? rq.gap.slice() : [0.6, 1.0];
    }
    // body: clearance along the rock direction at the height of each body volume, as the clip holds it
    if (A.kind === 'wall' || A.kind === 'ledge') { const fc = pc.approach && pc.approach.facing ? [pc.approach.facing[0], pc.approach.facing[2]] : [-sp.nL[0], -sp.nL[1]]; N.body = bodyNeeds(sp.clip, fc, bs); }   // facing = the direction of the rock in the clip's frame
    // arm reach: what the clip itself reaches from its shoulder, plus the stretch the clip allows, never beyond the measured arm
    N.reach = {};
    for (const c of hc) {
      const so = shoulderOf(sp.clip, c.bone === 'hand_l' ? 'upperarm_l' : 'upperarm_r'), p = c.surface.point, pl = bs.palm && bs.palm[c.bone === 'hand_l' ? 'l' : 'r'];
      const anat = bs.arm.reach + (pl ? pl.wristToPalm : bs.arm.hand * 0.6);
      const own = so ? Math.hypot(p[0] - so[0], p[1] - so[1], p[2] - so[2]) : 0;
      N.reach[c.bone] = so ? Math.min(own + N.contactTol, anat) : anat;
      N.reach[c.bone + ':own'] = own; N.reach[c.bone + ':anat'] = anat;
    }
    NEED[name] = N; STATS.derived++;
    const L = LEGACY[name] || LEGACY[name.replace(/_[lr]$/, '')];
    if (L) {
      for (const k of ['minW', 'tilt', 'topMin', 'top', 'seatH', 'gap']) if (L[k] !== undefined && N[k] !== undefined && N[k] !== null) audit(name, k, L[k], N[k]);
      if (L.body && N.body) audit(name, 'body', L.body, N.body);
      if (L.dip && N.dip) audit(name, 'dip', L.dip, N.dip);
      if (L.armFar !== undefined) for (const b in N.reach) if (!b.includes(':')) audit(name, 'armFar[' + b + ']', L.armFar, N.reach[b]);
      if (L.reachTol !== undefined && hc.length) audit(name, 'reachTol', L.reachTol, N.contactTol);
    }
    audit(name, 'standTol(near,far,lat)', [0.3, 0.3, 0.3], [N.near, N.far, N.lat]);   // the old acceptance: anywhere within 0.3 m (settleHere) of the plan
    return N;
  }
  // body-wide numbers (stand-spot free radius, probe heights): BODYSPEC, with the old literal only while it is not measured
  function bodyK() {
    const bs = BS(); if (!bs) return null;
    if (K._body && K._bodyFor === bs) return K._body;
    const hip = bs.leg.hipHeight, chestMid = bs.chest ? (bs.chest.y0 + bs.chest.y1) / 2 : 1.25;
    const B = { standR: bs.capsule.radius, standHy: [hip * 0.5, chestMid], scanHy: [bs.chest ? bs.chest.y0 : 1.15, hip * 0.5, hip * 0.25], pathMargin: bs.capsule.radius,
      shoulder: [bs.shoulderHalf - bs.arm.upperR, bs.chest ? bs.chest.y1 : 1.43] };   // the shoulder JOINT: outer half-width minus the arm radius
    K._body = B; K._bodyFor = bs;
    audit('body', 'standR(lean_back,other)', LEGACY._body.standR, [B.standR, B.standR]); audit('body', 'standHy', LEGACY._body.standHy, B.standHy); audit('body', 'scanHy', LEGACY._body.scanHy, B.scanHy);
    audit('body', 'pathMargin', LEGACY._body.pathMargin, B.pathMargin); audit('body', 'shoulderFallback', LEGACY._body.shoulderFallback, B.shoulder);
    return B;
  }
  // BODYSPEC may still be measuring: the derived needs are dropped and re-derived when it is there
  const bsWait = () => { const b = window.BODYSPEC; if (b && b.whenReady && !b.ready && !K._bsHook) { K._bsHook = true; b.whenReady.then(() => { for (const k in NEED) delete NEED[k]; for (const k in BONE) delete BONE[k]; K._body = null; RC.clear(); }); } };
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


    return { audit, NEED, need, bodyK, bsWait, spec, avail, bind(o) { if ("C" in o) C = o.C; if ("T3" in o) T3 = o.T3; if ("AV" in o) AV = o.AV; if ("shoulderOf" in o) shoulderOf = o.shoulderOf; } };
  };
})();
