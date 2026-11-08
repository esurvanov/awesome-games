/* modules/rock-brain-checks.js — checks for the tools and the gallery (does the pilot's hand reach the drawn face, is the body inside the rock) and the reaction to a pose the pipeline rejected. Moved out of modules/rock-brain.js unchanged. Classic script, loaded BEFORE rock-brain.js: window.createRockBrainChecks(deps) → { check, onPoseRejected, bind({...}) }. */
(function () {
  'use strict';
  window.createRockBrainChecks = function (X) {
    const { S, STATS, palmAt, rej, K, end } = X;
    let _ray = null;   // private copy (was shared in the source module): a scratch ray
    let T3, C;   // assigned later in the source module: set through bind()
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

    return { check, onPoseRejected, bind(o) { if ("T3" in o) T3 = o.T3; if ("C" in o) C = o.C; } };
  };
})();
