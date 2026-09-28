/* qa-page.js — in-page QA library (window.QA), injected by tools/qa/harness.mjs into open-world.html#dbg.
 * Everything here only reads the game through window.DBG / DBG.MODCTX and drives it through the same inputs a player
 * uses (DBG.keys / DBG.pressed / teleport). Sections:
 *   basics · actors (visual forward, soles) · recorder (per-frame motion samples + thumbnails + pixel stats)
 *   · analysis (facing, foot sliding, continuity, black frames) · GPU passes (visible surface height map, ID pass:
 *   back faces / primitives / untextured area) · placed-object float/bury check · camera-in-geometry · inventory.
 */
(() => {
  if (window.QA && window.QA.__v) return;
  const D = window.DBG, T = D.THREE, C = D.MODCTX, R = D.renderer;
  const QA = window.QA = { __v: 1 };
  const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
  const _v = V(), _w = V();
  const median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
  const pct = (a, p) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
  const r3 = (x) => (x == null || !Number.isFinite(x) ? x : Math.round(x * 1000) / 1000);
  QA.median = median; QA.pct = pct;
  QA.wait = (ms) => new Promise((r) => setTimeout(r, ms));
  QA.frames = (n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  QA.closeDialogs = () => { let n = 0; while (D.Dialog.active && n++ < 40) { D.Dialog.choosing = false; D.Dialog.close(); } };
  QA.visibleChain = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  QA.surfCPU = (x, z) => D.groundH(x, z) + (C.snowDepthAt ? C.snowDepthAt(x, z) : 0);
  QA.pause = (on) => { D.G.pause = !!on; };
  const P = D.player;

  /* ------------------------------------------------------------------ placing the player + real camera */
  // teleport the pilot, face `look` (a point) and put the real over-the-shoulder camera behind him
  QA.place = (x, z, o = {}) => {
    QA.closeDialogs(); D.camOv = null;
    const lk = o.look || null;
    let yaw = o.yaw; if (yaw === undefined && lk) yaw = Math.atan2(x - lk[0], z - lk[2]);
    if (yaw === undefined) yaw = D.cam.yaw;
    D.teleport(x, z, yaw, o.y !== undefined ? o.y : o.onTop ? undefined : D.groundH(x, z));   // ground unless asked to stand on top of a solid
    P.face = yaw; P.vx = P.vz = 0;
    D.cam.dist = o.dist || 7.5; D.cam.boom = D.cam.dist; D.cam.pitch = o.pitch !== undefined ? o.pitch : 0.28;
    return { x, z, yaw };
  };
  QA.keys = (list, on) => { for (const k of [].concat(list)) D.keys[k] = !!on; };
  QA.release = () => { for (const k in D.keys) D.keys[k] = false; };

  /* ------------------------------------------------------------------ actors */
  const bonesOf = (root) => { const m = {}; root.traverse((o) => { if (o.isBone && !m[o.name]) m[o.name] = o; }); return m; };
  const skinnedOf = (root) => { const a = []; root.traverse((o) => { if (o.isSkinnedMesh && QA.visibleChain(o)) a.push(o); }); return a; };
  const wpos = (o, out = V()) => { o.updateWorldMatrix(true, false); return out.setFromMatrixPosition(o.matrixWorld); };
  // foot vertex sets: lowest leaf bones (bottom 25 % of the skeleton, no IK/target/tail helpers) + parent + grandparent;
  // of the vertices mostly weighted to those bones, the lowest 35 % in the current pose (≤ 70 per foot)
  function footSets(root) {
    const skins = skinnedOf(root); if (!skins.length) return [];
    root.updateMatrixWorld(true);
    const bones = []; root.traverse((o) => { if (o.isBone) bones.push(o); });
    if (!bones.length) return [];
    const ys = bones.map((b) => wpos(b).y), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const leaves = bones.filter((b, i) => !b.children.some((c) => c.isBone) && !/ik|target|tail|pole|weapon|rock|horn|antler|eye|jaw|brow/i.test(b.name) && ys[i] < y0 + (y1 - y0) * 0.25);
    const sets = [];
    for (const leaf of leaves) {
      const group = new Set([leaf]); if (leaf.parent && leaf.parent.isBone) { group.add(leaf.parent); if (leaf.parent.parent && leaf.parent.parent.isBone && /foot|ankle|hoof|paw|hand/i.test(leaf.parent.parent.name)) group.add(leaf.parent.parent); }
      const verts = [];
      for (const sm of skins) {
        const g = sm.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight; if (!si || !sw) continue;
        const idx = new Set(); sm.skeleton.bones.forEach((b, k) => { if (group.has(b)) idx.add(k); });
        if (!idx.size) continue;
        const n = g.attributes.position.count, cand = [];
        for (let i = 0; i < n; i++) { let w = 0; for (let c = 0; c < 4; c++) if (idx.has(si.getComponent(i, c))) w += sw.getComponent(i, c); if (w > 0.5) cand.push(i); }
        const pts = cand.map((i) => { sm.getVertexPosition(i, _v); sm.localToWorld(_v); return { i, y: _v.y }; }).sort((a, b) => a.y - b.y);
        const keep = pts.slice(0, Math.max(6, Math.ceil(pts.length * 0.35)));
        const step = Math.max(1, Math.floor(keep.length / 70));
        for (let k = 0; k < keep.length; k += step) verts.push({ sm, i: keep[k].i });
      }
      if (verts.length) sets.push({ bone: leaf.name, verts });
    }
    return sets;
  }
  // current sole of a foot set: lowest vertex (world) + mean of the lowest 3
  function sole(set) {
    let best = null;
    for (const { sm, i } of set.verts) { sm.getVertexPosition(i, _v); sm.localToWorld(_v); if (!best || _v.y < best.y) best = { x: _v.x, y: _v.y, z: _v.z }; }
    return best;
  }
  const horiz = (v) => { const l = Math.hypot(v.x, v.z); return l > 1e-6 ? { x: v.x / l, z: v.z / l } : null; };
  // visual forward (world XZ unit) from the drawn skeleton / emitters, never from the game's yaw bookkeeping
  const FWD = {
    biped(bn, L, Rr, toesL, heelL, toesR, heelR) {
      return () => {
        const out = {};
        if (bn[L] && bn[Rr]) { const r = wpos(bn[Rr], V()).sub(wpos(bn[L], V())); out.hips = horiz({ x: r.z, z: -r.x }); }   // up × right
        if (toesL && bn[toesL] && bn[heelL] && bn[toesR] && bn[heelR]) { const a = wpos(bn[toesL], V()).sub(wpos(bn[heelL], V())).add(wpos(bn[toesR], V()).sub(wpos(bn[heelR], V()))); out.toes = horiz(a); }
        const f = out.hips || out.toes; return f ? { x: f.x, z: f.z, src: out } : null;
      };
    },
    quad(bn, head, hip) { return () => (bn[head] && bn[hip] ? horiz(wpos(bn[head], V()).sub(wpos(bn[hip], V()))) : null); },
  };
  // the actor list: { id, kind, g (moves), fwd(), feet[], rootBone, anim }
  QA.actors = (opts = {}) => {
    const out = [];
    const add = (id, kind, g, fwd, root, anim, extra) => { if (!g) return; const bn = root ? bonesOf(root) : {}; out.push(Object.assign({ id, kind, g, fwd, root, anim, bn, feet: root && opts.feet !== false ? footSets(root) : [] }, extra || {})); };
    // pilot: glTF root = the skinned model under player.c.g
    if (D.AV.player) {
      const root = D.AV.player.mixer.getRoot(), bn = bonesOf(root);
      add('player', 'player', D.player.c.g, FWD.biped(bn, 'thigh_l', 'thigh_r', 'ball_l', 'foot_l', 'ball_r', 'foot_r'), root, D.AV.player, { pelvis: bn.pelvis });
    }
    D.STAGS.forEach((s, k) => { const root = s.A.mixer.getRoot(), bn = bonesOf(root); add('stag' + k, 'stag', s.g, FWD.quad(bn, 'Head', 'Hip'), root, s.A, { pelvis: bn.Hip, st: () => s.st }); });
    if (D.fox.anim) { const root = D.fox.anim.mixer.getRoot(), bn = bonesOf(root); add('fox', 'fox', D.fox.g, FWD.quad(bn, 'b_Head_05', 'b_Hip_01'), root, D.fox.anim, { pelvis: bn.b_Hip_01, st: () => D.fox.st }); }
    D.enemies.forEach((e, k) => { if (e.dead) return; const root = e.anim ? e.anim.mixer.getRoot() : e.g;
      add('shardling' + k, 'shardling', e.g, () => (e.eye ? horiz(wpos(e.eye, V()).sub(wpos(e.g, V()))) : null), root, e.anim, { st: () => e.st, feet: [] }); });
    const B = D.boss; if (B && B.g && B.g.visible && B.active) {
      const bn = {}; B.g.traverse((o) => { if (o.isSkinnedMesh) for (const b of o.skeleton.bones) if (!bn[b.name]) bn[b.name] = b; });
      const f = FWD.biped(bn, 'hipL', 'hipR'), g = () => { const a = f(); if (a || !bn.jaws || !bn.head) return a; return horiz(wpos(bn.jaws, V()).sub(wpos(bn.head, V()))); };
      add('boss', 'boss', B.g, g, B.g, null, { pelvis: bn.hip, st: () => B.st });
      out[out.length - 1].bn = bn;
    }
    // snowmobile: headlight glows (warm white) minus the tail light (red) — the model's own emitters
    { const sk = D.sk, heads = [], tails = [];
      sk.g.traverse((o) => { if (!o.isSprite || !QA.visibleChain(o)) return; const c = o.material.color; if (c.r > 0 && c.g / c.r < 0.35 && c.b / c.r < 0.35) tails.push(o); else if (c.r > 0 && c.g / c.r > 0.8 && c.b / c.r > 0.6 && c.b / c.r < 0.95) heads.push(o); });
      add('snowmobile', 'vehicle', sk.g, () => { if (!heads.length || !tails.length) return null; const h = V(), t = V(); heads.forEach((o) => h.add(wpos(o, V()))); h.multiplyScalar(1 / heads.length); tails.forEach((o) => t.add(wpos(o, V()))); t.multiplyScalar(1 / tails.length); return horiz(h.sub(t)); }, null, null, { feet: [] }); }
    if (opts.only) return out.filter((a) => opts.only.some((p) => a.id === p || a.kind === p || a.id.startsWith(p)));
    return out;
  };

  /* ------------------------------------------------------------------ frame grab (final image, same frame) */
  const grabC = document.createElement('canvas'), grabG = grabC.getContext('2d', { willReadFrequently: true });
  QA.pixelStats = (w = 96, h = 54) => {
    const cv = R.domElement; grabC.width = w; grabC.height = h; grabG.drawImage(cv, 0, 0, w, h);
    const d = grabG.getImageData(0, 0, w, h).data; let s = 0, dark = 0, zero = 0; const hist = new Array(16).fill(0), grid = [];
    for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; s += l; if (l < 3) dark++; if (d[i] + d[i + 1] + d[i + 2] === 0) zero++; hist[Math.min(15, l >> 4)]++; }
    for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 5; gx++) { const o = ((Math.floor((gy + 0.5) / 5 * h)) * w + Math.floor((gx + 0.5) / 5 * w)) * 4; grid.push(Math.round(0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2])); }
    const n = d.length / 4, c = ((h >> 1) * w + (w >> 1)) * 4;
    return { mean: +(s / n).toFixed(1), dark: +(dark / n).toFixed(3), zero: +(zero / n).toFixed(4), center: Math.round(0.2126 * d[c] + 0.7152 * d[c + 1] + 0.0722 * d[c + 2]), grid, hist: hist.map((x) => +(x / n).toFixed(3)) };
  };
  // full-resolution copy of the final frame (for area / flat-colour tests), grabbed in a rAF after the game renders
  QA.grabFull = (scale = 0.5) => new Promise((res) => requestAnimationFrame(() => {
    const cv = R.domElement, w = Math.round(cv.width * scale), h = Math.round(cv.height * scale); const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(cv, 0, 0, w, h); res({ w, h, data: g.getImageData(0, 0, w, h).data });
  }));
  QA.frameStats = () => new Promise((r) => requestAnimationFrame(() => r(QA.pixelStats(192, 108))));

  /* ------------------------------------------------------------------ recorder */
  // per-frame samples of the chosen actors (+ camera, pixel stats) and every `every`-th frame a thumbnail
  QA.startRec = (spec = {}) => {
    const actors = spec.actors || QA.actors({ only: spec.only });
    const rec = QA._rec = { t0: performance.now(), frames: [], thumbs: [], actors: actors.map((a) => ({ id: a.id, kind: a.kind, feet: a.feet.map((f) => f.bone) })), on: true, every: spec.every || 5, k: 0,
      tw: spec.tw || 320, th: spec.th || 183 };
    const tc = document.createElement('canvas'); tc.width = rec.tw; tc.height = rec.th; const tg = tc.getContext('2d');
    const tick = (ts) => {
      if (!rec.on) return; requestAnimationFrame(tick);
      // the frame's own timestamp (the one the game steps its dt from), not the moment this callback runs: callback
      // jitter of a few ms made 10 m/s motions read as 15–19 m/s
      const t = ((ts || performance.now()) - rec.t0) / 1000, cam = D.camera.position;
      const f = { t: +t.toFixed(4), cam: [r3(cam.x), r3(cam.y), r3(cam.z)], look: [r3(D.cam.look.x), r3(D.cam.look.y), r3(D.cam.look.z)], a: {}, px: spec.pixels === false ? null : QA.pixelStats(64, 36),
        climb: D.CLIMB.t >= 0 ? +D.CLIMB.t.toFixed(3) : -1, riding: !!D.G.riding, onGround: !!P.onGround, keys: Object.keys(D.keys).filter((k) => D.keys[k]).join('+') };
      for (const a of actors) {
        if (!a.g.parent) continue;
        const p = wpos(a.g, V()), fw = a.fwd ? a.fwd() : null, s = { p: [r3(p.x), r3(p.y), r3(p.z)], f: fw ? [r3(fw.x), r3(fw.z)] : null, vis: QA.visibleChain(a.g) };
        if (fw && fw.src) s.fs = { hips: fw.src.hips ? [r3(fw.src.hips.x), r3(fw.src.hips.z)] : null, toes: fw.src.toes ? [r3(fw.src.toes.x), r3(fw.src.toes.z)] : null };
        if (a.pelvis) { const q = wpos(a.pelvis, V()); s.pel = [r3(q.x), r3(q.y), r3(q.z)]; }
        if (a.feet.length && (!spec.feetNear || p.distanceTo(D.camera.position) < spec.feetNear)) s.ft = a.feet.map((fs) => { const q = sole(fs); return q ? [r3(q.x), r3(q.y), r3(q.z), r3(QA.surfCPU(q.x, q.z))] : null; });
        if (a.anim && a.anim.cur && a.anim.acts[a.anim.cur]) { const act = a.anim.acts[a.anim.cur]; s.an = [a.anim.cur, r3(act.getEffectiveTimeScale()), r3(act.getClip().duration)]; }
        if (a.st) s.st = a.st();
        f.a[a.id] = s;
      }
      rec.frames.push(f);
      if (spec.thumbs !== false && rec.k++ % rec.every === 0 && rec.thumbs.length < (spec.maxThumbs || 24)) { tg.drawImage(R.domElement, 0, 0, rec.tw, rec.th); rec.thumbs.push({ t: f.t, url: tc.toDataURL('image/webp', 0.82) }); }
    };
    requestAnimationFrame(tick);
    return rec.actors;
  };
  QA.stopRec = () => { const r = QA._rec; if (r) r.on = false; return r; };

  /* ------------------------------------------------------------------ motion analysis */
  // facing vs motion: velocity from the group's world position (central difference over ~0.1 s)
  QA.analyzeFacing = (rec, id, o = {}) => {
    const F = rec.frames.filter((f) => f.a[id] && f.a[id].vis !== false), minSpeed = o.minSpeed || 0.5, out = { id, samples: 0, bad: 0, backward: 0, dots: [] };
    const series = [];
    for (let i = 0; i < F.length; i++) {
      let j0 = i, j1 = i; while (j0 > 0 && F[i].t - F[j0].t < 0.05) j0--; while (j1 < F.length - 1 && F[j1].t - F[i].t < 0.05) j1++;
      const a = F[j0].a[id].p, b = F[j1].a[id].p, dt = F[j1].t - F[j0].t; if (dt <= 0) continue;
      const vx = (b[0] - a[0]) / dt, vz = (b[2] - a[2]) / dt, sp = Math.hypot(vx, vz), fw = F[i].a[id].f;
      if (sp > 40) continue;   // teleport / respawn, not motion
      if (sp < minSpeed || !fw) { series.push({ t: F[i].t, sp: r3(sp), dot: null }); continue; }
      const dot = (fw[0] * vx + fw[1] * vz) / sp; out.samples++; out.dots.push(dot); if (dot < 0.7) out.bad++; if (dot < -0.3) out.backward++;
      series.push({ t: F[i].t, sp: r3(sp), dot: r3(dot), st: F[i].a[id].st });
    }
    out.minDot = out.dots.length ? r3(Math.min(...out.dots)) : null; out.medDot = r3(median(out.dots)); out.badFrac = out.samples ? r3(out.bad / out.samples) : null;
    out.maxSpeed = r3(Math.max(0, ...series.map((s) => s.sp)));
    // longest run of consecutive bad samples (seconds)
    let run = 0, best = 0, prevT = null; for (const s of series) { if (s.dot !== null && s.dot < 0.7) { run += prevT === null ? 0 : s.t - prevT; best = Math.max(best, run); } else run = 0; prevT = s.t; }
    out.worstRunS = r3(best);
    out.pass = out.samples === 0 ? null : out.badFrac <= 0.05 && out.worstRunS < 0.25;
    delete out.dots; out.series = series.filter((_, k) => k % 3 === 0).slice(0, 120);
    return out;
  };
  // foot sliding: stance spans of each foot (sole close to its lowest height over the take, small vertical speed);
  // drift = world displacement of the planted sole; ratio = body travel ÷ sole sweep in body space (1 = no slide)
  QA.analyzeFeet = (rec, id) => {
    const F = rec.frames.filter((f) => f.a[id] && f.a[id].ft), out = { id, steps: 0, steady: 0 };
    if (F.length < 10) return Object.assign(out, { pass: null, note: 'no foot samples' });
    const nf = F[0].a[id].ft.length, spans = [];
    // body speed per frame (for the steady-state filter)
    const bs = F.map((f, i) => { const j = Math.max(0, i - 3), k = Math.min(F.length - 1, i + 3), a = F[j].a[id].p, b = F[k].a[id].p, dt = F[k].t - F[j].t; return dt > 0 ? Math.hypot(b[0] - a[0], b[2] - a[2]) / dt : 0; });
    const vMed = median(bs.filter((v) => v > 0.4)) || 0;
    for (let k = 0; k < nf; k++) {
      // sole height above the actor's root (the root rides on the physics ground, so terrain relief cancels), relative
      // to its own minimum within ±0.35 s
      const h = F.map((f) => { const s = f.a[id].ft[k]; return s ? s[1] - f.a[id].p[1] : null; });
      const hr = h.map((v, i) => { if (v === null) return null; let m = Infinity; for (let j = i; j >= 0 && F[i].t - F[j].t < 0.35; j--) if (h[j] !== null && h[j] < m) m = h[j]; for (let j = i; j < F.length && F[j].t - F[i].t < 0.35; j++) if (h[j] !== null && h[j] < m) m = h[j]; return v - m; });
      let span = null;
      const close = (i) => {
        if (!span || i - span.i0 < 3) { span = null; return; }
        const i1 = i - 1, a = F[span.i0].a[id], b = F[i1].a[id], fa = a.ft[k], fb = b.ft[k], dur = F[i1].t - F[span.i0].t;
        const drift = Math.hypot(fb[0] - fa[0], fb[2] - fa[2]), travel = Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]);
        const sweep = Math.hypot((fb[0] - b.p[0]) - (fa[0] - a.p[0]), (fb[2] - b.p[2]) - (fa[2] - a.p[2])), v = travel / Math.max(dur, 1e-3);
        if (v > 0.4) spans.push({ foot: k, t: F[span.i0].t, dur, drift, travel, ratio: sweep > 0.02 ? travel / sweep : null, steady: vMed > 0 && v > vMed * 0.75 && v < vMed * 1.25 });
        span = null;
      };
      for (let i = 1; i < F.length; i++) {
        const s = F[i].a[id].ft[k], s0 = F[i - 1].a[id].ft[k]; if (!s || !s0 || hr[i] === null) { close(i); continue; }
        const dt = F[i].t - F[i - 1].t, vy = dt > 0 ? (s[1] - s0[1]) / dt : 0;
        const vyr = dt > 0 ? vy - (F[i].a[id].p[1] - F[i - 1].a[id].p[1]) / dt : 0;
        if (hr[i] < 0.05 && Math.abs(vyr) < 0.6) { if (!span) span = { i0: i }; } else close(i);
      }
      close(F.length);
    }
    const st = spans.filter((s) => s.steady), use = st.length >= 2 ? st : spans;
    out.steps = spans.length; out.steady = st.length; out.speed = r3(vMed);
    out.medDrift = r3(median(use.map((s) => s.drift))); out.p90Drift = r3(pct(use.map((s) => s.drift), 0.9)); out.medRatio = r3(median(use.map((s) => s.ratio).filter((x) => x !== null)));
    out.allMedDrift = r3(median(spans.map((s) => s.drift))); out.worst = spans.slice().sort((a, b) => b.drift - a.drift).slice(0, 3).map((s) => ({ t: r3(s.t), foot: s.foot, drift: r3(s.drift), dur: r3(s.dur) }));
    const an = F.map((f) => f.a[id].an).filter(Boolean); out.clips = [...new Set(an.map((a) => a[0] + '×' + a[1].toFixed(2)))].slice(0, 6);
    out.pass = use.length < 2 ? null : out.medDrift <= 0.08 && (out.medRatio === null || (out.medRatio >= 0.75 && out.medRatio <= 1.33));
    return out;
  };
  // continuity: frame-to-frame jump of the pelvis / hips (teleporting climbs, snaps at clip ends)
  QA.analyzeContinuity = (rec, id, maxLocal = 6) => {
    // local = pelvis motion relative to the actor root (model snapping at clip ends / climb start); root = the actor
    // itself (teleport-like jumps > 30 m/s)
    const F = rec.frames.filter((f) => f.a[id] && f.a[id].p); let worst = { v: 0 }, root = { v: 0 };
    for (let i = 1; i < F.length; i++) {
      const A = F[i - 1].a[id], B = F[i].a[id], dt = Math.max(F[i].t - F[i - 1].t, 1 / 60); if (F[i].t - F[i - 1].t <= 0) continue;
      const rd = Math.hypot(B.p[0] - A.p[0], B.p[1] - A.p[1], B.p[2] - A.p[2]); if (rd / dt > root.v) root = { v: r3(rd / dt), d: r3(rd), t: F[i].t };
      if (A.pel && B.pel) { const lx = (B.pel[0] - B.p[0]) - (A.pel[0] - A.p[0]), ly = (B.pel[1] - B.p[1]) - (A.pel[1] - A.p[1]), lz = (B.pel[2] - B.p[2]) - (A.pel[2] - A.p[2]), d = Math.hypot(lx, ly, lz);
        if (d / dt > worst.v) worst = { v: r3(d / dt), d: r3(d), t: F[i].t, climb: F[i].climb, clip: B.an ? B.an[0] : null }; }
    }
    return { id, maxLocalPelvisSpeed: worst.v, at: worst, maxRootSpeed: root.v, rootAt: root, pass: worst.v <= maxLocal && root.v <= 30 };
  };
  QA.analyzePixels = (rec) => {
    const px = rec.frames.map((f) => f.px).filter(Boolean), means = px.map((p) => p.mean), med = median(means) || 0;
    const black = px.map((p, i) => ({ i, t: rec.frames[i].t, p })).filter(({ p }) => p.dark > 0.85 || p.mean < Math.max(2, med * 0.25) || p.zero > 0.02);
    return { frames: px.length, medianLuma: r3(med), minLuma: r3(Math.min(...means)), maxZero: r3(Math.max(0, ...px.map((p) => p.zero))), blackFrames: black.length, first: black.slice(0, 5).map((b) => ({ t: b.t, mean: b.p.mean, zero: b.p.zero, dark: b.p.dark })), pass: black.length === 0 };
  };

  /* ------------------------------------------------------------------ GPU helpers */
  const withRenderState = (fn) => {
    const rt0 = R.getRenderTarget(), ac = R.autoClear, sa = R.shadowMap.autoUpdate, bg = D.scene.background, ov = D.scene.overrideMaterial, xr = R.xr.enabled;
    R.shadowMap.autoUpdate = false;
    try { return fn(); } finally { R.setRenderTarget(rt0); R.autoClear = ac; R.shadowMap.autoUpdate = sa; D.scene.background = bg; D.scene.overrideMaterial = ov; R.xr.enabled = xr; }
  };
  const isFx = (o) => o.isSprite || o.isPoints || o.isLine || o.isLineSegments;
  const matsOf = (o) => (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []);
  const isTransparentNoDepth = (o) => matsOf(o).every((m) => m.transparent && m.depthWrite === false);
  QA.actorGroups = () => [D.player.c.g, D.fox.g, D.sk.g, ...D.STAGS.map((s) => s.g), ...D.enemies.map((e) => e.g), D.boss.g, C.orm && C.orm.g].filter(Boolean);
  const GROUND_CLUTTER = /^(veg_(tuft|grass|shrub|decal|leaf|leaves|twig|moss|lichen|clutter)|wf_clutter)|snow_?(fall|flake)|breath|crack|footprint|atm_/i;
  // visible-surface height map (top-down orthographic render of the real scene, actors + clutter hidden)
  let hmRT = null, hmCopy = null, hmQuad = null, hmMat = null;
  QA.heightMap = (cx, cz, size, res, topY, depth = 60) => withRenderState(() => {
    if (!hmRT || hmRT.width !== res) {
      hmRT = new T.WebGLRenderTarget(res, res, { depthBuffer: true }); hmRT.depthTexture = new T.DepthTexture(res, res, T.FloatType);
      hmCopy = new T.WebGLRenderTarget(res, res, { type: T.FloatType, format: T.RGBAFormat });
      hmMat = new T.ShaderMaterial({ uniforms: { tD: { value: null } }, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
        fragmentShader: 'uniform sampler2D tD; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tD, vUv).r, 0., 0., 1.); }', depthTest: false, depthWrite: false });
      hmQuad = new T.Mesh(new T.PlaneGeometry(2, 2), hmMat); hmQuad.frustumCulled = false;
    }
    const oc = new T.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0.0, depth);
    oc.position.set(cx, topY, cz); oc.up.set(0, 0, -1); oc.lookAt(cx, topY - 1, cz); oc.updateMatrixWorld(true);
    const hidden = [];
    const hide = (o) => { if (o && o.visible) { o.visible = false; hidden.push(o); } };
    QA.actorGroups().forEach(hide);
    D.scene.traverse((o) => { if (!o.visible) return; if (isFx(o) || ((o.isMesh || o.isInstancedMesh || o.isBatchedMesh) && (isTransparentNoDepth(o) || GROUND_CLUTTER.test(o.name) || matsOf(o).some((m) => m.alphaTest > 0 || m.alphaToCoverage) || /needle|leaf|leaves|foliage|crown/i.test(o.name)))) hide(o); });
    try {
      D.scene.background = null; R.setRenderTarget(hmRT); R.setClearColor(0x000000, 0); R.clear(); R.render(D.scene, oc);
      hmMat.uniforms.tD.value = hmRT.depthTexture; R.setRenderTarget(hmCopy); R.render(hmQuad, oc);
      const buf = new Float32Array(res * res * 4); R.readRenderTargetPixels(hmCopy, 0, 0, res, res, buf);
      const h = new Float32Array(res * res); for (let i = 0; i < res * res; i++) { const d = buf[i * 4]; h[i] = d >= 0.99999 ? NaN : topY - d * depth; }
      return { cx, cz, size, res, h, at(x, z) { const i = Math.floor((x - (cx - size / 2)) / size * res), j = Math.floor(((cz + size / 2) - z) / size * res); if (i < 0 || j < 0 || i >= res || j >= res) return NaN; return h[j * res + i]; } };
    } finally { for (const o of hidden) o.visible = true; }
  });
  // feet on the visible surface: clearance of every foot's lowest vertices (negative = inside the snow/rock)
  QA.feetOnSurface = (actors, o = {}) => {
    const res = [];
    for (const a of actors) {
      if (!a.feet.length || !a.g.parent || !QA.visibleChain(a.g)) continue;
      // camera top just above the soles and the snow under them: overhangs (branches, arches, the pilot's own body) are
      // not the ground, and the visible snow surface must never be clipped away (else the sea plane under the island shows)
      const c = wpos(a.g, V()), soles = a.feet.map(sole).filter(Boolean), surfTop = Math.max(...soles.map((q) => QA.surfCPU(q.x, q.z)), -1e9);
      const top = Math.max(soles.length ? Math.min(...soles.map((q) => q.y)) : c.y, surfTop) + 0.45, size = o.size || (a.kind === 'stag' || a.kind === 'boss' ? 7 : 4);
      const hm = QA.heightMap(c.x, c.z, size, o.res || 256, top, 40), feet = [];
      for (const fs of a.feet) {
        let minC = Infinity, at = null;
        for (const { sm, i } of fs.verts) { sm.getVertexPosition(i, _v); sm.localToWorld(_v); const s = hm.at(_v.x, _v.z); if (!Number.isFinite(s)) continue; const cl = _v.y - s; if (cl < minC) { minC = cl; at = [r3(_v.x), r3(_v.y), r3(_v.z), r3(s)]; } }
        const q = sole(fs);
        const cpu = q ? QA.surfCPU(q.x, q.z) : null, sane = at && cpu !== null && Math.abs(at[3] - cpu) < 1.5;   // GPU surface far from the heightfield = a clipped / missing surface, not a measurement
        feet.push({ bone: fs.bone, clearance: Number.isFinite(minC) && sane ? r3(minC) : null, at, soleY: q ? r3(q.y) : null, cpuSurf: q ? r3(cpu) : null, invalid: !sane || undefined });
      }
      // grounded feet = the lowest half (a walking biped has one foot in the air)
      const sorted = feet.filter((f) => f.clearance !== null).sort((x, y) => x.clearance - y.clearance), grounded = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
      const worst = grounded.reduce((w, f) => (Math.abs(f.clearance) > Math.abs(w) ? f.clearance : w), 0);
      res.push({ id: a.id, kind: a.kind, feet, worst: r3(worst), pass: grounded.length ? grounded.every((f) => Math.abs(f.clearance) <= (o.tol || 0.05)) : null, pos: [r3(c.x), r3(c.y), r3(c.z)], state: a.st ? a.st() : undefined });
    }
    return res;
  };

  /* ------------------------------------------------------------------ ID pass (what is visible on screen, per object) */
  let idRT = null; const idU = { value: new T.Vector3() }, modeU = { value: 0 };
  // ShaderMaterial (uniformsNeedUpdate is honoured per draw only for ShaderMaterial); standard chunks keep skinning,
  // instancing, batching and morphs exact
  const idMat = new T.ShaderMaterial({ side: T.DoubleSide, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    uniforms: { qaId: idU, qaMode: modeU },
    vertexShader: `#include <common>
#include <batching_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
void main() {
#include <batching_vertex>
#include <skinbase_vertex>
#include <begin_vertex>
#include <morphtarget_vertex>
#include <skinning_vertex>
#include <project_vertex>
}`,
    fragmentShader: `uniform vec3 qaId; uniform float qaMode; void main() { if (qaMode > .5 && gl_FrontFacing) discard; gl_FragColor = vec4(qaId, 1.); }` });
  let idList = [];
  idMat.onBeforeRender = (r, s, c, g, obj) => { const k = obj.userData.__qaId || 0; idU.value.set((k & 255) / 255, ((k >> 8) & 255) / 255, ((k >> 16) & 255) / 255); idMat.uniformsNeedUpdate = true; };
  // subset: array of objects. mode 'back' → only back-facing fragments; 'all' → any fragment. Depth-tested against the
  // real scene rendered first from the same camera, so only what the eye would see counts.
  QA.idPass = (subset, mode = 'all', scale = 0.5) => withRenderState(() => {
    const cv = R.domElement, w = Math.max(64, Math.round(cv.width * scale)), h = Math.max(36, Math.round(cv.height * scale));
    if (!idRT || idRT.width !== w || idRT.height !== h) { if (idRT) idRT.dispose(); idRT = new T.WebGLRenderTarget(w, h, { depthBuffer: true }); }
    const cam = D.camera; cam.updateMatrixWorld(true);
    R.setRenderTarget(idRT); R.setClearColor(0x000000, 0); R.clear(); R.render(D.scene, cam);
    idList = subset; subset.forEach((o, i) => { o.userData.__qaId = i + 1; o.layers.enable(29); });
    const layers0 = cam.layers.mask; cam.layers.set(29);
    const bg = D.scene.background; D.scene.background = null; D.scene.overrideMaterial = idMat; modeU.value = mode === 'back' ? 1 : 0;
    R.autoClear = false; R.clearColor();
    try { R.render(D.scene, cam); } finally { cam.layers.mask = layers0; subset.forEach((o) => { o.layers.disable(29); delete o.userData.__qaId; }); D.scene.background = bg; }
    const buf = new Uint8Array(w * h * 4); R.readRenderTargetPixels(idRT, 0, 0, w, h, buf);
    const counts = new Map(), boxes = new Map();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, k = buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16); if (!k || buf[o + 3] === 0) continue;
      counts.set(k, (counts.get(k) || 0) + 1); const b = boxes.get(k) || [x, y, x, y]; if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; boxes.set(k, b); }
    const out = []; for (const [k, n] of counts) { const obj = subset[k - 1]; if (obj) out.push({ obj, px: n, frac: n / (w * h), box: boxes.get(k) }); }
    out.sort((a, b) => b.px - a.px);
    return { w, h, list: out, buf };
  });

  /* ------------------------------------------------------------------ faithful back-face mask (real materials) */
  // pass A: the scene as drawn → linear depth D1. pass B: only opaque candidates, every material forced to BackSide
  // (real shaders: skinning, wind, displacement stay exact) → D3. A pixel shows a back face when D3 ≤ D1 (+eps):
  //   D3 < D1  → a culled back face lies in front of what is drawn: an open mesh seen from behind (see-through hole)
  //   D3 ≈ D1  → the drawn surface IS a back face (DoubleSide material seen from its back side)
  let dRT = null, dCopy = null;
  const depthPass = (w, h, prep) => {
    if (!dRT || dRT.width !== w || dRT.height !== h) { if (dRT) { dRT.dispose(); dCopy.dispose(); } dRT = new T.WebGLRenderTarget(w, h, { depthBuffer: true }); dRT.depthTexture = new T.DepthTexture(w, h, T.FloatType); dCopy = new T.WebGLRenderTarget(w, h, { type: T.FloatType, format: T.RGBAFormat }); }
    if (!hmMat) QA.heightMap(0, 0, 1, 8, 1, 1);   // builds the depth-copy quad
    const cam = D.camera, restore = prep ? prep() : null;
    try { R.setRenderTarget(dRT); R.setClearColor(0x000000, 0); R.clear(); R.render(D.scene, cam); } finally { if (restore) restore(); }
    hmMat.uniforms.tD.value = dRT.depthTexture; R.setRenderTarget(dCopy); R.render(hmQuad, cam);
    const buf = new Float32Array(w * h * 4); R.readRenderTargetPixels(dCopy, 0, 0, w, h, buf);
    const n = cam.near, f = cam.far, out = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) { const d = buf[i * 4]; out[i] = d >= 0.999999 ? Infinity : 2 * n * f / (f + n - (d * 2 - 1) * (f - n)); }
    return out;
  };
  QA.backfaceCandidates = () => QA.drawables((o) => { const ms = matsOf(o); if (!ms.length || QA.intentional(o) || GROUND_CLUTTER.test(o.name)) return false;
    return ms.every((m) => !m.transparent && !(m.alphaTest > 0) && !m.alphaToCoverage && !m.alphaHash && m.side !== T.BackSide && m.colorWrite !== false && m.depthWrite !== false); });
  QA.backfaceMask = (scale = 0.5) => withRenderState(() => {
    const cv = R.domElement, w = Math.max(64, Math.round(cv.width * scale)), h = Math.max(36, Math.round(cv.height * scale));
    const D1 = depthPass(w, h, null), cand = new Set(QA.backfaceCandidates()), dsMats = new Set();
    const D3 = depthPass(w, h, () => {
      const hidden = [], sides = new Map();
      D.scene.traverse((o) => { if (!(o.isMesh || o.isInstancedMesh || o.isBatchedMesh || o.isSprite || o.isPoints || o.isLine || o.isLineSegments) || !o.visible) return;
        if (cand.has(o)) { for (const m of matsOf(o)) if (!sides.has(m)) { sides.set(m, m.side); if (m.side === T.DoubleSide) dsMats.add(m); m.side = T.BackSide; } }
        else { o.visible = false; hidden.push(o); } });
      return () => { for (const o of hidden) o.visible = true; for (const [m, sd] of sides) m.side = sd; };
    });
    const raw = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) { const a = D1[i], b = D3[i]; if (!Number.isFinite(b)) continue; const eps = Math.max(0.01, a * 0.0008);
      if (b < a - eps) raw[i] = 1; else if (Math.abs(b - a) <= eps) raw[i] = 2; }
    // 3×3 erosion: silhouette edges (1–2 px where front and back faces meet) are not visible back faces
    const mask = new Uint8Array(w * h); let holes = 0, dsBack = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (!raw[i]) continue; let ok = true;
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (!raw[i + dy * w + dx]) { ok = false; break; }
      if (ok) { mask[i] = raw[i]; if (raw[i] === 1) holes++; else dsBack++; } }
    return { w, h, mask, holes, dsBack, cand: [...cand], D1 };
  });
  /* ------------------------------------------------------------------ object facts (shared by inventory + passes) */
  const PRIM = /^(Box|Cylinder|Cone|Octahedron|Icosahedron|Tetrahedron|Dodecahedron|Sphere|Torus|TorusKnot|Capsule|Circle|Ring|Extrude|Lathe|Shape)Geometry$/;
  QA.ownerOf = (o) => { for (let p = o; p; p = p.parent) { if (p.userData && p.userData.owner) return p.userData.owner; if (p.userData && p.userData.struct) return 'structures'; } return nameOwner(o.name) || 'unknown'; };
  const nameOwner = (n) => (/^veg_|^bark$|^needles$/.test(n) ? 'vegetation' : /^wf_/.test(n) ? 'worldfill' : /^tr_|terrain/.test(n) ? 'terrain' : /^atm|^env_|mountain/.test(n) ? 'atmosphere' : null);
  QA.sourceOf = (o) => {
    const g = o.geometry;
    for (let p = o; p; p = p.parent) if (p.userData && p.userData.qaSource) return p.userData.qaSource;   // explicit STYLE.tag wins
    if (g && g.userData) { if (g.userData.source) return 'pack:' + g.userData.source; const mu = g.userData.mergedUserData; if (mu && mu.length) { const s = [...new Set(mu.map((u) => u && u.source).filter(Boolean))]; if (s.length) return 'pack:' + s.join('+'); } }
    for (let p = o; p; p = p.parent) if (p.userData && p.userData.source) return 'pack:' + p.userData.source;
    if (g && PRIM.test(g.type)) return 'primitive:' + g.type.replace('Geometry', '');
    if (o.isSprite) return 'sprite';
    return 'generated';
  };
  // colour-carrying texture: `map`, or any custom sampler uniform (ShaderMaterial / onBeforeCompile injections, e.g. the
  // terrain's triplanar snow). Environment, shadow, normal/roughness/AO style maps do not give a surface its colour.
  const NOT_ALBEDO = /^(envMap|envMapRotation|dfgLUT|.*[Ss]hadow.*|ltc_\d|transmissionSamplerMap|normalMap|bumpMap|roughnessMap|metalnessMap|aoMap|lightMap|displacementMap|alphaMap|specularMap|clearcoat.*|sheen.*|iridescence.*|anisotropyMap|thicknessMap|tDepth|tNormal|.*DepthTexture)$/;
  const texU = (U) => U && Object.entries(U).some(([k, u]) => !NOT_ALBEDO.test(k) && u && u.value && (u.value.isTexture || u.value.isRenderTarget || (Array.isArray(u.value) && u.value.some((x) => x && x.isTexture))));
  QA.textured = (o) => matsOf(o).some((m) => m.map || m.emissiveMap || (m.isShaderMaterial && texU(m.uniforms)) || texU((R.properties.get(m) || {}).uniforms));
  QA.intentional = (o) => {
    if (o.userData && o.userData.qaIntentional) return String(o.userData.qaIntentional);
    if (isFx(o)) return 'fx';
    const ms = matsOf(o);
    if (ms.length && ms.every((m) => m.isMeshBasicMaterial && (m.transparent || m.blending === T.AdditiveBlending || m.toneMapped === false || Math.max(m.color.r, m.color.g, m.color.b) > 1.01))) return 'emitter';   // unlit + HDR colour = a light source
    if (/beam|ring|halo|glow|helper|debug|collider|shaft|aurora/i.test(o.name)) return 'name';
    if (o === D.WORLD.beacon) return 'beam';
    if (ms.length && ms.every((m) => m.isShaderMaterial) && QA.isPrimitive(o)) return 'shader';   // sky dome, cloud discs: custom-shaded shapes
    return null;
  };
  QA.isPrimitive = (o) => !!(o.geometry && PRIM.test(o.geometry.type));
  QA.passportIndex = () => {
    const byObj = new Map(), byName = {};
    for (const e of D.Passport.list) { if (e.obj) byObj.set(e.obj, e.role); const base = String(e.name).replace(/#\d+$/, ''); byName[base] = byName[base] || new Set(); byName[base].add(e.role); }
    return { roleOf(o) { for (let p = o; p; p = p.parent) if (byObj.has(p)) return byObj.get(p); const s = byName[o.name]; return s ? [...s].join('+') : null; } };
  };
  QA.drawables = (filter) => { const a = []; D.scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh || o.isBatchedMesh || o.isSkinnedMesh) && QA.visibleChain(o) && (!filter || filter(o))) a.push(o); }); return a; };
  // readable name: own name, else the Passport entry that registered it (or an ancestor), else the type
  let ppName = null;
  const passName = (o) => { if (!ppName) { ppName = new Map(); for (const e of D.Passport.list) if (e.obj) ppName.set(e.obj, e.name); } for (let p = o; p; p = p.parent) if (ppName.has(p)) return ppName.get(p); return null; };
  QA.label = (o) => { const path = []; for (let p = o; p && p !== D.scene && path.length < 4; p = p.parent) path.unshift(p.name || p.type); const s = path.join('/'); if (o.name) return s; const pn = passName(o); return pn ? pn + ':' + s : s; };

  /* ------------------------------------------------------------------ per-view checks */
  QA.viewChecks = async (o = {}) => {
    const out = {};
    const bm = QA.backfaceMask(0.5), total = bm.w * bm.h;
    // attribution: ID pass (back-facing fragments, override material) counted only inside the faithful mask
    const bf = QA.idPass(bm.cand.filter((m) => !matsOf(m).some((x) => x.isShaderMaterial)), 'back', 0.5), per = new Map();
    for (let i = 0; i < total; i++) { if (!bm.mask[i]) continue; const k = bf.buf[i * 4] | (bf.buf[i * 4 + 1] << 8) | (bf.buf[i * 4 + 2] << 16); const key = k || 0; const e = per.get(key) || { hole: 0, ds: 0 }; if (bm.mask[i] === 1) e.hole++; else e.ds++; per.set(key, e); }
    const idObjs = bm.cand.filter((m) => !matsOf(m).some((x) => x.isShaderMaterial));
    // "the drawn surface is a back face" is only possible for double-sided materials: drop it elsewhere (thin shells)
    for (const [k, e] of per) { const obj = k ? idObjs[k - 1] : null; if (!obj || !matsOf(obj).some((m) => m.side === T.DoubleSide)) { e.ds = 0; } if (!e.hole && !e.ds) per.delete(k); }
    for (let i = 0; i < total; i++) if (bm.mask[i] === 2) { const k = bf.buf[i * 4] | (bf.buf[i * 4 + 1] << 8) | (bf.buf[i * 4 + 2] << 16); if (!per.has(k)) bm.mask[i] = 0; }
    let holes = 0, ds = 0; for (const e of per.values()) { holes += e.hole; ds += e.ds; } bm.holes = holes; bm.dsBack = ds;
    out.backfaces = { px: bm.holes + bm.dsBack, holes: bm.holes, dsBack: bm.dsBack, frac: r3((bm.holes + bm.dsBack) / total),
      top: [...per.entries()].map(([k, e]) => { const obj = k ? idObjs[k - 1] : null; return { name: obj ? QA.label(obj) : '(custom shader / unattributed)', owner: obj ? QA.ownerOf(obj) : '', source: obj ? QA.sourceOf(obj) : '', hole: e.hole, ds: e.ds, px: e.hole + e.ds, side: obj ? matsOf(obj).map((m) => ['front', 'back', 'double'][m.side]).join('/') : '' }; })
        .sort((a, b) => b.px - a.px).slice(0, 10) };
    // FAIL: see-through holes (open meshes seen from behind — the black/missing triangles). Back side of a double-sided
    // sheet is lit correctly by three (normals flipped), so it is only a warning (inside-out models, thin shells)
    out.backfaces.pass = bm.holes / total <= 0.0005 ? (bm.dsBack / total > 0.005 ? 'warn' : true) : false;
    // view blocked: share of the frame covered by geometry closer than 1.2 m (camera inside a tree crown, a wall…)
    { let n = 0, n3 = 0; for (let i = 0; i < total; i++) { if (bm.D1[i] < 1.2) n++; if (bm.D1[i] < 3) n3++; } out.nearCover = r3(n / total); out.nearCover3 = r3(n3 / total); }
    if (o.magenta) out.backfaces.mask = QA.maskPng({ w: bm.w, h: bm.h, buf: (() => { const b = new Uint8Array(total * 4); for (let i = 0; i < total; i++) if (bm.mask[i]) { b[i * 4] = 1; } return b; })() }, [255, 0, 255]);
    const overrideOk = (m) => !matsOf(m).some((x) => x.isShaderMaterial || x.side === T.BackSide);
    const prims = QA.drawables((m) => QA.isPrimitive(m) && !QA.intentional(m) && overrideOk(m)), pp = QA.idPass(prims, 'all', 0.5);
    out.primitives = { visible: pp.list.filter((x) => x.px >= 4).map((x) => ({ name: QA.label(x.obj), owner: QA.ownerOf(x.obj), geo: x.obj.geometry.type, px: x.px, frac: r3(x.frac) })) };
    const untex = QA.drawables((m) => !QA.textured(m) && !QA.intentional(m) && overrideOk(m)), up = QA.idPass(untex, 'all', 0.5);
    const frame = await QA.grabFull(0.5);
    out.untextured = [];
    for (const x of up.list) {
      if (x.frac < (o.untexMin || 0.004)) continue;
      // luma spread of the final image inside this object's pixels (ID buffer is bottom-up, frame top-down)
      const kk = untex.indexOf(x.obj) + 1, L = []; for (let y = 0; y < up.h; y += 2) for (let xx = 0; xx < up.w; xx += 2) { const q = (y * up.w + xx) * 4; const k = up.buf[q] | (up.buf[q + 1] << 8) | (up.buf[q + 2] << 16); if (k !== kk) continue;
        const fy = Math.min(frame.h - 1, Math.round((up.h - 1 - y) * frame.h / up.h)), fx = Math.min(frame.w - 1, Math.round(xx * frame.w / up.w)), f = (fy * frame.w + fx) * 4; L.push(0.2126 * frame.data[f] + 0.7152 * frame.data[f + 1] + 0.0722 * frame.data[f + 2]); }
      const m = L.reduce((s, v) => s + v, 0) / Math.max(1, L.length), sd = Math.sqrt(L.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, L.length));
      out.untextured.push({ name: QA.label(x.obj), owner: QA.ownerOf(x.obj), source: QA.sourceOf(x.obj), frac: r3(x.frac), lumaMean: +m.toFixed(1), lumaSd: +sd.toFixed(1), flat: sd < 4, mat: matsOf(x.obj).map((mm) => mm.type + (mm.name ? ':' + mm.name : '')).join(',') });
    }
    // final-image stats (black / NaN)
    { const d = frame.data, n = d.length / 4; let s = 0, dark = 0, zero = 0; const hist = new Array(16).fill(0);
      for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; s += l; if (l < 3) dark++; if (d[i] + d[i + 1] + d[i + 2] === 0) zero++; hist[Math.min(15, l >> 4)]++; }
      out.pixels = { mean: +(s / n).toFixed(1), dark: r3(dark / n), zero: +(zero / n).toFixed(4), hist: hist.map((x) => r3(x / n)), pass: !(dark / n > 0.85 || s / n < 3 || zero / n > 0.002) }; }
    // near-black pixels of the final image, attributed to objects (black grass / shrubs / triangles)
    { const all = QA.drawables((m) => overrideOk(m) && !isFx(m)), ap = QA.idPass(all, 'all', 0.5), per = new Map(), size = new Map(); let dark = 0;
      for (let y = 0; y < ap.h; y++) for (let x = 0; x < ap.w; x++) { const q = (y * ap.w + x) * 4, k = ap.buf[q] | (ap.buf[q + 1] << 8) | (ap.buf[q + 2] << 16); size.set(k, (size.get(k) || 0) + 1);
        const fy = Math.min(frame.h - 1, Math.round((ap.h - 1 - y) * frame.h / ap.h)), fx = Math.min(frame.w - 1, Math.round(x * frame.w / ap.w)), f = (fy * frame.w + fx) * 4;
        const l = 0.2126 * frame.data[f] + 0.7152 * frame.data[f + 1] + 0.0722 * frame.data[f + 2]; if (l < 6) { dark++; per.set(k, (per.get(k) || 0) + 1); } }
      out.dark = { px: dark, frac: r3(dark / (ap.w * ap.h)), top: [...per.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => { const obj = k ? all[k - 1] : null;
        return { name: obj ? QA.label(obj) : '(sky / custom shader)', owner: obj ? QA.ownerOf(obj) : '', px: n, ofObject: r3(n / (size.get(k) || 1)) }; }) }; }
    out.camera = QA.cameraCheck(); out.camera.nearCover = out.nearCover; out.camera.nearCover3 = out.nearCover3; if (out.nearCover > 0.2 || out.nearCover3 > 0.3) { out.camera.pass = false; out.camera.blockedView = true; }   // a wall / tree crown in the lens
    return out;
  };
  // mask PNG (data URL) of an ID pass: coloured where any id is present, transparent elsewhere
  QA.maskPng = (pass, rgb) => { const c = document.createElement('canvas'); c.width = pass.w; c.height = pass.h; const g = c.getContext('2d'), im = g.createImageData(pass.w, pass.h);
    for (let y = 0; y < pass.h; y++) for (let x = 0; x < pass.w; x++) { const s = (y * pass.w + x) * 4, t = ((pass.h - 1 - y) * pass.w + x) * 4; if (pass.buf[s] | pass.buf[s + 1] | pass.buf[s + 2]) { im.data[t] = rgb[0]; im.data[t + 1] = rgb[1]; im.data[t + 2] = rgb[2]; im.data[t + 3] = 255; } }
    g.putImageData(im, 0, 0); return c.toDataURL('image/png'); };

  /* ------------------------------------------------------------------ camera inside geometry */
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0.7, 0.7, 0], [-0.7, 0.7, 0], [0, 0.7, 0.7], [0, 0.7, -0.7], [0.7, -0.7, 0], [-0.7, -0.7, 0], [0, -0.7, 0.7], [0, -0.7, -0.7]];
  QA.cameraCheck = (pos, look) => {
    const c = pos ? V(pos[0], pos[1], pos[2]) : D.camera.position.clone(), lk = look ? V(look[0], look[1], look[2]) : D.cam.look.clone();
    const out = { underground: false, blocked: null, nearest: null, inside: false };
    const surf = QA.surfCPU(c.x, c.z); out.aboveGround = r3(c.y - surf); out.underground = c.y < surf - 0.02;
    if (D.PH && D.PH.ok) {
      const d = V().subVectors(c, lk), L = d.length();
      if (L > 0.05) { const h = D.PH.P.raycast(lk, d.clone().normalize(), L, { groups: D.PH.P.groups.STATIC | D.PH.P.groups.TRUNK }); if (h && h.distance < L - 0.15) out.blocked = { by: h.tag && (h.tag.name || h.tag.kind), at: r3(h.distance), of: r3(L) }; }
    }
    // drawn meshes within 4 m: nearest surface and back-face-first hits (inside a closed mesh)
    const near = QA.drawables((o) => { if (QA.intentional(o) || GROUND_CLUTTER.test(o.name) || o.isBatchedMesh) return false; const g = o.geometry; if (!g) return false; if (!g.boundingSphere) g.computeBoundingSphere();
      if (o.isInstancedMesh) return false; _w.copy(g.boundingSphere.center).applyMatrix4(o.matrixWorld); const s = o.matrixWorld.getMaxScaleOnAxis(); return _w.distanceTo(c) < g.boundingSphere.radius * s + 4; })
      .filter((o) => !QA.actorGroups().some((a) => { for (let p = o; p; p = p.parent) if (p === a) return true; return false; }));
    const sides = near.map((o) => matsOf(o).map((m) => [m, m.side])).flat(); sides.forEach(([m]) => (m.side = T.DoubleSide));
    let backFirst = 0, hits = 0, nearest = null;
    try {
      const rc = new T.Raycaster(); rc.far = 4;
      for (const d of DIRS) { rc.set(c, V(d[0], d[1], d[2]).normalize()); const h = rc.intersectObjects(near, false)[0]; if (!h) continue; hits++;
        if (!nearest || h.distance < nearest.d) nearest = { d: r3(h.distance), name: QA.label(h.object) };
        if (h.face) { const n = h.face.normal.clone().transformDirection(h.object.matrixWorld); if (n.dot(rc.ray.direction) > 0.05) backFirst++; } }
    } finally { sides.forEach(([m, s]) => (m.side = s)); }
    out.nearest = nearest; out.inside = hits >= 6 && backFirst / hits > 0.6; out.backFirst = backFirst; out.hits = hits;
    out.pass = !out.underground && !out.inside && !(nearest && nearest.d < D.camera.near * 1.5) && !out.blocked;
    return out;
  };

  /* ------------------------------------------------------------------ placed objects: floating / buried */
  QA.placedCheck = () => {
    const rows = [], PH = D.PH, ok = PH && PH.ok, G = ok ? PH.P.groups : null;
    const surf = QA.surfCPU;
    for (const e of D.Passport.list) {
      if (!e.alive || e.role === 'passable' || e.role === 'trigger') continue;
      let minY, maxY, cells = [];
      if (e.role === 'trunk' && e.trunk) {
        const t = e.trunk, base = t.y0 + 0.6, s = surf(t.x, t.z); rows.push({ name: e.name, role: e.role, kind: String(e.name).replace(/#\d+$/, ''), float: r3(base - s), buried: 0, pos: [r3(t.x), r3(base), r3(t.z)] }); continue;
      }
      let verts = null;
      if (e.role === 'pushable' && e.obj) { const b = new T.Box3().setFromObject(e.obj, true); if (b.isEmpty()) continue; verts = []; for (const x of [b.min.x, (b.min.x + b.max.x) / 2, b.max.x]) for (const z of [b.min.z, (b.min.z + b.max.z) / 2, b.max.z]) verts.push(x, b.min.y, z); verts.push(0, b.max.y, 0); }
      else if (e.geo) verts = e.geo.v;
      if (!verts || verts.length < 9) continue;
      const n = verts.length / 3; minY = Infinity; maxY = -Infinity; let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < n; i++) { const x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2]; if (y < minY) minY = y; if (y > maxY) maxY = y; if (e.role !== 'pushable' || y === minY) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; } }
      // lowest vertex per 3×3 footprint cell
      const cell = {}, top = {};
      for (let i = 0; i < n; i++) { const x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2]; const ci = Math.min(2, Math.floor((x - x0) / Math.max(1e-3, x1 - x0) * 3)), cj = Math.min(2, Math.floor((z - z0) / Math.max(1e-3, z1 - z0) * 3)), k = ci * 3 + cj;
        if (!cell[k] || y < cell[k][1]) cell[k] = [x, y, z]; if (top[k] === undefined || y > top[k]) top[k] = y; }
      cells = Object.entries(cell);
      const gaps = [], bur = [];
      for (const [k, [x, y, z]] of cells) {
        const s = surf(x, z); let g = y - s;
        if (ok && g > 0.1) { const h = PH.P.raycast({ x, y: y - 0.02, z }, { x: 0, y: -1, z: 0 }, 6, { groups: G.STATIC | G.PROP }); if (h) g = Math.min(g, h.distance + 0.02); }
        gaps.push(g);
        // share of this footprint column (its lowest → highest vertex) that lies under the local surface
        const colH = top[k] - y; if (colH > 0.02) bur.push(Math.min(1, Math.max(0, (s - y) / colH)));
      }
      const minGap = Math.min(...gaps), maxGap = Math.max(...gaps), height = Math.max(0.01, maxY - minY), buried = bur.length ? bur.reduce((a, b) => a + b, 0) / bur.length : 0;
      rows.push({ name: e.name, role: e.role, kind: String(e.name).replace(/#\d+$/, ''), float: r3(minGap), cornerGap: r3(maxGap), buried: r3(Math.max(0, buried)), height: r3(height), pos: [r3((x0 + x1) / 2), r3(minY), r3((z0 + z1) / 2)] });
    }
    const floating = rows.filter((r) => r.float > 0.1), buried = rows.filter((r) => r.buried > 0.3);
    const byKind = (list) => { const m = {}; for (const r of list) { const k = r.kind; m[k] = m[k] || { kind: k, n: 0, worst: null }; m[k].n++; if (!m[k].worst || (r.float > 0.1 ? r.float > m[k].worst.float : r.buried > m[k].worst.buried)) m[k].worst = r; } return Object.values(m).sort((a, b) => b.n - a.n); };
    return { checked: rows.length, floating: floating.length, buried: buried.length, floatingByKind: byKind(floating), buriedByKind: byKind(buried), pass: floating.length === 0 && buried.length === 0 };
  };

  /* ------------------------------------------------------------------ texture-unit budget (TEXUNITS.md) */
  // every compiled program: active sampler uniforms (total = what three allocates units for; vertex = samplers the
  // vertex shader alone keeps active, measured by linking it with a trivial fragment shader; fragment = the rest +
  // shared names) → which materials/meshes use it. FAIL when total > MAX_TEXTURE_IMAGE_UNITS (three warns "Trying to
  // use N texture units" and the draw goes wrong) or a stage exceeds its own limit.
  const _vsCache = new Map();
  QA.texUnits = () => {
    const gl = R.getContext();
    const lim = { frag: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS), vert: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS), comb: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) };
    const ST = new Set(['SAMPLER_2D', 'SAMPLER_3D', 'SAMPLER_CUBE', 'SAMPLER_2D_SHADOW', 'SAMPLER_2D_ARRAY', 'SAMPLER_2D_ARRAY_SHADOW', 'SAMPLER_CUBE_SHADOW',
      'INT_SAMPLER_2D', 'INT_SAMPLER_3D', 'INT_SAMPLER_CUBE', 'INT_SAMPLER_2D_ARRAY', 'UNSIGNED_INT_SAMPLER_2D', 'UNSIGNED_INT_SAMPLER_3D', 'UNSIGNED_INT_SAMPLER_CUBE', 'UNSIGNED_INT_SAMPLER_2D_ARRAY'].map((k) => gl[k]));
    const samplers = (prog) => { const out = []; const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(prog, i); if (u && ST.has(u.type)) out.push({ name: u.name.replace(/\[0\]$/, ''), size: u.size }); } return out; };
    const vertSet = (prog) => {
      const sh = gl.getAttachedShaders(prog) || []; const vs = sh.find((s) => gl.getShaderParameter(s, gl.SHADER_TYPE) === gl.VERTEX_SHADER); if (!vs) return new Set();
      if (_vsCache.has(vs)) return _vsCache.get(vs);
      const fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, '#version 300 es\nprecision highp float;\nout vec4 qaO;\nvoid main(){ qaO = vec4(1.0); }'); gl.compileShader(fs);
      const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
      const s = new Set(gl.getProgramParameter(p, gl.LINK_STATUS) ? samplers(p).map((x) => x.name) : []);
      gl.deleteProgram(p); gl.deleteShader(fs); _vsCache.set(vs, s); return s;
    };
    // program → users (material name · mesh name); a material can own several programs (depth, shadow, variants)
    const users = new Map();
    const note = (m, o, kind) => { if (!m) return; const pr = R.properties.get(m); const list = pr && pr.programs ? [...pr.programs.values()] : pr && pr.currentProgram ? [pr.currentProgram] : [];
      for (const p of list) { if (!p || !p.program) continue; let u = users.get(p.program); if (!u) users.set(p.program, (u = new Map()));
        const k = (m.name || m.type) + (kind ? ' (' + kind + ')' : ''); if (!u.has(k)) u.set(k, new Set()); if (u.get(k).size < 4) u.get(k).add(o.name || o.type); } };
    D.scene.traverse((o) => { for (const m of [].concat(o.material || [])) note(m, o); note(o.customDepthMaterial, o, 'depth'); note(o.customDistanceMaterial, o, 'distance'); });
    const progs = [];
    for (const p of R.info.programs || []) {
      if (!p || !p.program) continue;
      const s = samplers(p.program), total = s.reduce((a, x) => a + x.size, 0);
      const V = vertSet(p.program), fsrc = (() => { const sh = (gl.getAttachedShaders(p.program) || []).find((x) => gl.getShaderParameter(x, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER); return sh ? gl.getShaderSource(sh) || '' : ''; })();
      let vert = 0, frag = 0; for (const x of s) { const inV = V.has(x.name), inF = !inV || new RegExp('\\b' + x.name.replace(/[.[\]]/g, '\\$&') + '\\b').test(fsrc); if (inV) vert += x.size; if (inF) frag += x.size; }
      const u = users.get(p.program), mats = u ? [...u.entries()].map(([k, v]) => k + ' ← ' + [...v].join(', ')) : [];
      progs.push({ id: p.id, name: p.name, total, vert, frag, over: total > lim.frag || frag > lim.frag || vert > lim.vert, samplers: s.map((x) => x.name + (x.size > 1 ? '[' + x.size + ']' : '') + (V.has(x.name) ? ' (v)' : '')), materials: mats });
    }
    progs.sort((a, b) => b.total - a.total);
    return { limits: lim, programs: progs.length, over: progs.filter((p) => p.over), top: progs.slice(0, 12), all: progs,
      runtime: (C.texBudget && C.texBudget.report) ? C.texBudget.report() : null };
  };

  /* ------------------------------------------------------------------ inventory */
  QA.inventory = () => {
    const pp = QA.passportIndex(), rows = [];
    D.scene.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh || o.isBatchedMesh || o.isSprite || o.isPoints || o.isLine)) return;
      const vis = QA.visibleChain(o), g = o.geometry, ms = matsOf(o);
      let tris = 0; if (g) { const idx = g.index; tris = idx ? idx.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0); if (o.isPoints) tris = 0; }
      let inst = 1; if (o.isInstancedMesh) inst = o.count; if (o.isBatchedMesh) inst = o._instanceInfo ? o._instanceInfo.filter((x) => x && x.active !== false && x.visible !== false).length : (o.instanceCount || 0);
      let box = null; try { if (o.isInstancedMesh) { o.computeBoundingBox(); box = o.boundingBox.clone().applyMatrix4(o.matrixWorld); } else if (o.isBatchedMesh) { o.computeBoundingBox && o.computeBoundingBox(); box = o.boundingBox ? o.boundingBox.clone().applyMatrix4(o.matrixWorld) : null; } else if (g) { if (!g.boundingBox) g.computeBoundingBox(); box = g.boundingBox.clone().applyMatrix4(o.matrixWorld); } } catch (e) { box = null; }
      rows.push({ name: o.name || '', path: QA.label(o), type: o.isSkinnedMesh ? 'SkinnedMesh' : o.isInstancedMesh ? 'InstancedMesh' : o.isBatchedMesh ? 'BatchedMesh' : o.type, owner: QA.ownerOf(o), source: QA.sourceOf(o),
        geo: g ? g.type : null, tris: Math.round(tris), instances: inst, trisTotal: Math.round(tris * Math.max(1, inst)), mat: [...new Set(ms.map((m) => m.type))].join(','), matNames: ms.map((m) => m.name).filter(Boolean).join(','),
        textured: QA.textured(o), vertexColors: ms.some((m) => m.vertexColors), side: [...new Set(ms.map((m) => ['front', 'back', 'double'][m.side]))].join(','), transparent: ms.some((m) => m.transparent),
        castShadow: !!o.castShadow, receiveShadow: !!o.receiveShadow, frustumCulled: !!o.frustumCulled, visible: vis,
        box: box && isFinite(box.min.x) ? [box.min.toArray().map(r3), box.max.toArray().map(r3)] : null, passport: pp.roleOf(o), intentional: QA.intentional(o), primitive: QA.isPrimitive(o) });
    });
    return rows;
  };
})();
(() => { const QA = window.QA;
  QA.idPng = (pass) => { const c = document.createElement('canvas'); c.width = pass.w; c.height = pass.h; const g = c.getContext('2d'), im = g.createImageData(pass.w, pass.h);
    for (let y = 0; y < pass.h; y++) for (let x = 0; x < pass.w; x++) { const s = (y * pass.w + x) * 4, t = ((pass.h - 1 - y) * pass.w + x) * 4, k = pass.buf[s] | (pass.buf[s + 1] << 8) | (pass.buf[s + 2] << 16);
      if (k) { const h = Math.imul(k, 2654435761) >>> 0; im.data[t] = 60 + (h & 191); im.data[t + 1] = 60 + ((h >> 8) & 191); im.data[t + 2] = 60 + ((h >> 16) & 191); im.data[t + 3] = 255; } }
    g.putImageData(im, 0, 0); return c.toDataURL('image/png'); };
})();
