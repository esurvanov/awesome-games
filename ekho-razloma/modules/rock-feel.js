/* Module "rock-feel" — what makes a rock contact feel like THIS rock (rocks only: rock*, boulder*).
 *
 * Reads what modules/rock-brain.js is doing (ROCKBRAIN.feel: the hand points, the face normal, trace / release / impact)
 * and dresses it; it never decides anything. Sound goes out on the interaction module's audio context (INTERACTION.AU).
 *   material   snowy / icy (near the lake or the sea ice) / rough, measured on the spot: rays along the face give the
 *              spread of the surface (rough scan vs smooth), the tilt and the facade width give the shape word
 *   touch      palm slap by material (dry rock thud · muffled snow thump · ice squeak), snow / dust falls from the
 *              shoulders, palm marks stay on the face for a while (dark print on a snowy face, pale glove print on dark rock)
 *   hold       breath steam from the helmet, the palms shift their weight a little
 *   trace      scrape loop by surface (grit · snow hiss · ice squeal), a streak behind every palm, flakes fall from it;
 *              rough faces slow the sidle, ice makes it faster and jerky
 *   release    exhale + the palms peel off with a short rasp
 * K.on = false restores the previous behaviour. Cost: a few rays every 0.4 s while holding, nothing otherwise.
 */
(function () {
  let C = null, T3 = null;
  const K = { on: true, marks: true, steam: true, sound: true };
  const S = { touches: 0, marks: 0, steam: 0, scrape: 0, mat: null, why: '' };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const I = () => window.INTERACTION;

  /* ---------------------------------------------------------------- material */
  // near the lake or the open sea ice: the rock is glazed (spray freezes on it)
  function icy(x, z) {
    if (!C) return false;
    const L = C.POI && C.POI.lake;
    if (L && L.h !== undefined) { const d = Math.hypot(x - L.x, z - L.z); if (d < 48.5 + 9) return true; }
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (C.getH(x + Math.cos(a) * 9, z + Math.sin(a) * 9) <= 0.1) return true; }
    return false;
  }
  // roughness of the face in front of the pilot: five rays across the face at chest height, spread of the hit distance
  // (cm) and of the hit normals (rad). Smooth procedural basalt < 2.5 cm, scanned crags well above.
  function measure(pl) {
    const P = C.player, PH = C.PH; if (!PH.ok || !pl || !pl.normal) return null;
    const n = pl.normal, tx = -n.z, tz = n.x, ds = [], ns = [];
    for (const s of [-0.5, -0.25, 0, 0.25, 0.5]) {
      const h = PH.P.raycast({ x: P.x + tx * s + n.x * 0.7, y: P.y + 1.15, z: P.z + tz * s + n.z * 0.7 }, { x: -n.x, y: 0, z: -n.z }, 1.4, { groups: PH.P.groups.STATIC });
      if (h) { ds.push(h.distance); if (h.normal) ns.push(Math.atan2(h.normal.x * tx + h.normal.z * tz, h.normal.x * n.x + h.normal.z * n.z)); }
    }
    S.hits = ds.length;
    if (ds.length < 3) return null;
    const mean = ds.reduce((a, b) => a + b, 0) / ds.length, sd = Math.sqrt(ds.reduce((a, b) => a + (b - mean) ** 2, 0) / ds.length) * 100;
    const nm = ns.reduce((a, b) => a + b, 0) / ns.length, nsd = Math.sqrt(ns.reduce((a, b) => a + (b - nm) ** 2, 0) / ns.length);
    return { rough: sd > 1.6 || nsd > 0.12, sdCm: +sd.toFixed(2), nsd: +nsd.toFixed(3), curve: Math.abs(nm) };
  }
  let mat = null, matT = 0, matPl = null;
  function material(pl, dt) {
    matT -= dt;
    if (mat && matPl === pl && matT > 0) return mat;
    matT = 0.5; matPl = pl;
    const F = window.ROCKBRAIN && window.ROCKBRAIN.feel, m = (F && F.m) || {}, me = measure(pl) || { rough: true, sdCm: 0, nsd: 0, curve: 0 }, P = C.player;
    const ice = !!(m.ice || icy(P.x, P.z)), snow = !!(m.flat || Math.abs(m.ny || 0) > 0.3);
    const w = m.w || 0.6, ny = Math.abs(m.ny || 0);
    mat = { ice, snow, rough: me.rough && !ice, sdCm: me.sdCm, nsd: me.nsd, shape: w < 0.7 ? 'narrow' : me.nsd > 0.16 ? 'round' : 'wide', tilt: ny > 0.25 ? 'leaning' : 'sheer', w: +w.toFixed(2) };
    if (K.force) Object.assign(mat, K.force);   // test switch: pretend the rock is icy / snowy / smooth
    S.mat = mat; return mat;
  }

  /* ---------------------------------------------------------------- sound (own nodes on the interaction audio context) */
  const AU = () => I().AU;
  const ok = () => { const a = AU(); return K.sound && a && a.ac && a.ac.state === 'running' && !(C.Sound && C.Sound.muted); };
  function env(g, t, a, peak, dur) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
  function nz(t, dur, peak, type, f, q, f2) {
    const a = AU(), ac = a.ac, s = ac.createBufferSource(); s.buffer = a.nb;
    const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q || 0.8; if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ac.createGain(); env(g, t, 0.003, peak, dur); s.connect(fl); fl.connect(g); g.connect(a.out); s.start(t, Math.random() * 0.8); s.stop(t + dur + 0.05);
  }
  function tone(type, f, t, dur, peak, f2) {
    const a = AU(), ac = a.ac, o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ac.createGain(); env(g, t, 0.003, peak, dur); o.connect(g); g.connect(a.out); o.start(t); o.stop(t + dur + 0.05);
  }
  function slap(m, k) {   // a gloved palm hitting the face
    S.slaps = (S.slaps || 0) + 1; S.lastSlap = m.ice ? 'ice' : m.snow ? 'snow' : m.rough ? 'rough' : 'rock';
    if (!ok()) return; const t = AU().ac.currentTime;
    if (m.ice) { nz(t, 0.02, 0.09 * k, 'highpass', 3500, 1); tone('sine', rnd(2600, 3400), t, 0.09, 0.02 * k, rnd(1800, 2200)); nz(t, 0.06, 0.05 * k, 'lowpass', 600, 1); }
    else if (m.snow) { nz(t, 0.11, 0.09 * k, 'lowpass', 700, 0.7, 260); nz(t + 0.02, 0.09, 0.035 * k, 'bandpass', rnd(2200, 3600), 1.5); }
    else { nz(t, 0.05, 0.10 * k, 'bandpass', rnd(700, 1100), 1.1); tone('sine', 110, t, 0.09, 0.09 * k, 60); if (m.rough) nz(t + 0.012, 0.05, 0.03 * k, 'highpass', 4500, 1); }
  }
  function rasp(m, k) {   // the palms peel off
    if (!ok()) return; const t = AU().ac.currentTime;
    if (m.ice) nz(t, 0.16, 0.05 * k, 'bandpass', 3800, 3, 2400); else nz(t, 0.2, 0.05 * k, 'bandpass', m.snow ? 1500 : 900, 0.9, m.snow ? 700 : 500);
  }
  // one shared scrape loop (its own gain / filter, so the game's slide scrape is left alone)
  let sc = null;
  function scrapeNodes() {
    const a = AU(); if (sc || !a || !a.ac) return sc;
    try {
      const ac = a.ac, s = ac.createBufferSource(); s.buffer = a.nb; s.loop = true; s.playbackRate.value = 0.9;
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.2; const g = ac.createGain(); g.gain.value = 0;
      s.connect(f); f.connect(g); g.connect(a.out); s.start(); sc = { f, g };
    } catch (e) { sc = null; }
    return sc;
  }
  function scrape(level, m) {
    if (level > (S.scrapeMax || 0)) { S.scrapeMax = +level.toFixed(2); S.scrapeKind = m.ice ? 'ice' : m.snow ? 'snow' : m.rough ? 'rough' : 'rock'; }
    const n = scrapeNodes(); if (!n || !ok()) { if (n && AU().ac) n.g.gain.setTargetAtTime(0, AU().ac.currentTime, 0.05); return; }
    const t = AU().ac.currentTime;
    const f = m.ice ? 3400 : m.snow ? 1500 : m.rough ? 1100 : 1900, q = m.ice ? 4 : m.snow ? 0.7 : 1.6, gmax = m.ice ? 0.05 : m.snow ? 0.045 : m.rough ? 0.09 : 0.05;
    n.f.frequency.setTargetAtTime(f * (0.85 + 0.3 * level), t, 0.05); n.f.Q.setTargetAtTime(q, t, 0.05); n.g.gain.setTargetAtTime(level * gmax, t, 0.05);
  }

  /* ---------------------------------------------------------------- palm marks (a small pool of soft decals on the face) */
  const pool = []; let pi = 0, geo = null, TEX = null;
  // soft-edged alpha textures (a hard quad reads as a sticker): a glove print (palm + four fingers) and a smear
  function textures() {
    if (TEX) return TEX;
    const mk = (draw) => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d'); draw(g); const t = new T3.CanvasTexture(cv); t.needsUpdate = true; return t; };
    const blob = (g, x, y, rx, ry, a) => { g.save(); g.translate(x, y); g.scale(rx, ry); const r = g.createRadialGradient(0, 0, 0, 0, 0, 1); r.addColorStop(0, 'rgba(255,255,255,' + a + ')'); r.addColorStop(0.55, 'rgba(255,255,255,' + a * 0.55 + ')'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.beginPath(); g.arc(0, 0, 1, 0, 7); g.fill(); g.restore(); };
    TEX = {
      print: mk((g) => { blob(g, 32, 40, 17, 18, 0.9); for (const [x, y, ry] of [[17, 17, 9], [27, 11, 11], [38, 11, 11], [48, 17, 9]]) blob(g, x, y, 5.5, ry, 0.85); }),
      smear: mk((g) => { blob(g, 32, 32, 9, 30, 0.8); blob(g, 30, 44, 6, 16, 0.5); }),
    };
    return TEX;
  }
  function markMesh() {
    if (!geo) geo = new T3.PlaneGeometry(1, 1);
    if (pool.length < 48) {
      const mt = new T3.MeshBasicMaterial({ color: 0x222630, map: textures().print, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: true });
      const me = new T3.Mesh(geo, mt); me.visible = false; me.renderOrder = 4; me.frustumCulled = false; C.scene.add(me); const o = { me, age: 99, life: 12, op: 0 }; pool.push(o); return o;
    }
    const o = pool[pi++ % pool.length]; return o;
  }
  // a mark of size w×h on the face at point p with normal n
  function mark(p, n, w, h, m, streak, up) {
    if (!K.marks || !C.scene) return;
    const o = markMesh(), me = o.me, snowyFace = m.snow;
    me.material.map = streak ? textures().smear : textures().print; me.material.needsUpdate = true;
    me.material.color.setHex(m.ice ? 0xb4c6d8 : snowyFace ? 0x0a0c10 : 0xaab4c6);
    o.op = m.ice ? 0.45 : snowyFace ? 0.6 : 0.5; o.age = 0; o.life = streak ? 7 : 14;
    me.position.set(p.x + n.x * 0.012, p.y + n.y * 0.012, p.z + n.z * 0.012);
    me.lookAt(p.x + n.x, p.y + n.y, p.z + n.z); me.rotateZ(up ? up : rnd(-0.4, 0.4)); me.scale.set(w, h, 1); me.material.opacity = o.op; me.visible = true; S.marks++;
  }
  function fadeMarks(dt) {
    for (const o of pool) { if (!o.me.visible) continue; o.age += dt; const k = o.age / o.life; if (k >= 1) { o.me.visible = false; continue; } o.me.material.opacity = o.op * (k < 0.08 ? k / 0.08 : 1 - (k - 0.08) / 0.92); }
  }

  /* ---------------------------------------------------------------- per-frame */
  const E = { prevPlay: false, prevRel: 0, steamT: 0, mark: 0, lastMark: null, lastState: 'idle', handSide: null };
  // particles are additive and fade with life: dim colours, small sizes (bright large ones read as glowing cotton balls)
  const flakes = (x, y, z, n, snowy, spread) => { for (let i = 0; i < n; i++) C.emit(x + rnd(-spread, spread), y, z + rnd(-spread, spread), rnd(-0.12, 0.12), rnd(-0.25, 0.05), rnd(-0.12, 0.12), rnd(0.9, 1.5), snowy ? 0x8d97a6 : 0x6f7076, snowy ? 0.075 : 0.05, 1.2, 2.2); };

  function update(dt) {
    if (!K.on) return;
    // the contact itself is modules/rock-brain.js's; this reads what it is doing (ROCKBRAIN.feel) and dresses it
    const R = window.ROCKBRAIN && window.ROCKBRAIN.feel; if (!R || !C.PH || !C.PH.ok) return;
    const P = C.player;
    const pl = R.active ? R.plan : null, playing = !!pl;
    fadeMarks(dt);
    // -- touch: the contact clip just started
    if (playing && !E.prevPlay) {
      const m = material(pl, 9); const k = clamp(R.amp || 0.5, 0.3, 1.3); S.touches++;
      slap(m, k);
      for (const b in pl.targets) {
        if (!/^hand/.test(b)) continue; const t = pl.targets[b];
        mark(t.point, t.normal, 0.2, 0.25, m, false);
        flakes(t.point.x + t.normal.x * 0.05, t.point.y + 0.05, t.point.z + t.normal.z * 0.05, m.snow ? 7 : 3, m.snow, 0.1);
      }
      // what the impact shakes loose from the shoulders and the helmet
      flakes(P.x, P.y + 1.55, P.z, m.snow ? 9 : 3, m.snow, 0.28);
      E.steamT = 1.2; E.lastMark = null;
    }
    // -- hold / trace
    let level = 0;
    if (playing) {
      const m = material(pl, dt);
      R.sidleMul = m.ice ? 1.35 : m.rough ? 0.7 : m.snow ? 0.9 : 1.0;
      if (R.trace > 0.2) {
        level = clamp(R.trace, 0, 1);
        // a streak behind each palm every ~0.13 m of travel
        const tg = pl.targets, hb = tg.hand_l || tg.hand_r;
        if (hb) {
          const lp = E.lastMark;
          if (!lp || Math.hypot(hb.point.x - lp.x, hb.point.z - lp.z) > 0.13) {
            for (const b in tg) if (/^hand/.test(b)) { const t = tg[b], dx = lp ? hb.point.x - lp.x : 0, dz = lp ? hb.point.z - lp.z : 0; mark(t.point, t.normal, 0.1, 0.3, m, true, Math.PI / 2 + Math.atan2(dz, dx) * 0.0); flakes(t.point.x, t.point.y, t.point.z, m.snow ? 2 : 1, m.snow, 0.05); }
            E.lastMark = { x: hb.point.x, z: hb.point.z };
          }
        }
      }
      // breath steam from the helmet: a slow puff while holding
      E.steamT -= dt;
      if (K.steam && E.steamT <= 0) {
        E.steamT = rnd(2.6, 3.6); S.steam++;
        const F = { x: -Math.sin(P.face), z: -Math.cos(P.face) };
        for (let i = 0; i < 6; i++) C.emit(P.x + F.x * 0.36, P.y + 1.42, P.z + F.z * 0.36, F.x * rnd(0.15, 0.4) + rnd(-0.08, 0.08), rnd(0.12, 0.3), F.z * rnd(0.15, 0.4) + rnd(-0.08, 0.08), rnd(1.2, 1.9), 0x56606e, 0.11, 0.9, -0.12);
      }
    } else { R.sidleMul = 1; }
    scrape(level, mat || { ice: false, snow: false, rough: true });
    // -- release: the palms peel off
    if (R.rel > 0.95 && E.prevRel <= 0.95) {
      const m = mat || { snow: false, ice: false, rough: true }; rasp(m, 1);
      for (let i = 0; i < 6; i++) C.emit(P.x, P.y + 0.08, P.z, rnd(-0.6, 0.6), rnd(0.4, 1.0), rnd(-0.6, 0.6), rnd(0.4, 0.7), 0x8d97a6, 0.12, 3, 2.5);
      const F = { x: -Math.sin(P.face), z: -Math.cos(P.face) };
      for (let i = 0; i < 6; i++) C.emit(P.x - F.x * 0.36, P.y + 1.42, P.z - F.z * 0.36, -F.x * rnd(0.15, 0.4), rnd(0.12, 0.3), -F.z * rnd(0.15, 0.4), rnd(1.2, 1.9), 0x56606e, 0.11, 0.9, -0.12);   // the exhale after letting go
      mat = null;
    }
    E.prevRel = R.rel || 0; E.prevPlay = playing;
  }

  window.ROCKFEEL = { K, S, icy, measure, get mat() { return mat; }, pool };
  (window.GameModules = window.GameModules || []).push({
    name: 'rock-feel', order: 55,
    init(ctx) { C = ctx; T3 = ctx.THREE; },
    update(dt) { try { update(dt); } catch (e) { S.err = String(e && e.message || e); if (!S.errN) console.warn('rock-feel', e); S.errN = (S.errN || 0) + 1; } },
  });
})();
