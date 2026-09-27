/* modules/bench.js — 2-minute frame-rate bench on a fixed route (LOWEND.md). Inert unless the URL has ?bench.
 *
 *   open-world.html?bench=1&q=air     (or bench.html, which frames exactly this)
 *   route: menu 10 s (the idle loop: frames drawn should be ~0) → start → warm-up 8 s → walk 24 s → deep forest 26 s
 *          → by the station fire 20 s → snow close-up 20 s → result card (median fps, 1 % low, frame-time histogram,
 *          render scale, GPU string, verdict «30 кадров ровно / нет»). Same card as JSON: window.BENCH.result, a
 *          postMessage { type: 'eor-bench', result } to the parent frame, and the «копировать» button.
 * No #dbg needed: everything goes through the module ctx and the real menu buttons (works in the published artifact).
 */
(function () {
  'use strict';
  const qs = new URLSearchParams(location.search);
  if (!qs.has('bench')) return;
  const B = window.BENCH = { phase: 'boot', phases: [], result: null, log: [] };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const now = () => performance.now();
  const $ = (id) => document.getElementById(id);
  const pct = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]; };
  const ico = (id, cls) => `<svg class="i ${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#i-${id}"/></svg>`;
  let C = null, cur = null, drive = null;

  /* ------------------------------------------------------------------ HUD pill while running */
  const css = document.createElement('style');
  css.textContent = `
  #benchPill{position:fixed;left:16px;top:16px;z-index:60;display:flex;gap:8px;align-items:center;padding:6px 12px;border-radius:999px;background:var(--panel);border:1px solid var(--line);font:700 13px Tektur,system-ui,sans-serif;color:var(--ink);font-variant-numeric:tabular-nums}
  #benchPill b{display:block;width:90px;height:5px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden}#benchPill b i{display:block;height:100%;background:var(--ice)}
  #benchCard{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;background:rgba(4,8,20,.72);padding:16px;overflow:auto}
  #benchCard .bc{width:100%;max-width:580px;display:flex;flex-direction:column;gap:12px;padding:16px;border-radius:14px;background:rgba(9,15,36,.94);border:1px solid var(--line);font:13px/1.35 Onest,system-ui,sans-serif;color:var(--ink);user-select:text;-webkit-user-select:text}
  #benchCard .vd{display:flex;align-items:center;gap:10px;font:700 20px Tektur,system-ui,sans-serif}
  #benchCard .vd .i{width:26px;height:26px}
  #benchCard .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
  #benchCard .t{padding:8px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08)}
  #benchCard .t .v{font:700 20px Tektur,system-ui,sans-serif;font-variant-numeric:tabular-nums}#benchCard .t .l{color:var(--dim);font-size:11px;display:flex;gap:4px;align-items:center}
  #benchCard .t .l .i{width:12px;height:12px}
  #benchCard .hist{display:flex;align-items:flex-end;gap:4px;height:70px}
  #benchCard .hist div{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:2px;height:100%;font-size:10px;color:var(--dim)}
  #benchCard .hist span{width:100%;border-radius:3px 3px 0 0;min-height:1px}
  #benchCard table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}#benchCard td{padding:3px 4px;border-top:1px solid rgba(255,255,255,.07)}
  #benchCard td .i{width:14px;height:14px;vertical-align:-2px}
  #benchCard .bar{height:6px;border-radius:3px;background:rgba(255,255,255,.1);min-width:60px}#benchCard .bar i{display:block;height:100%;border-radius:3px}
  #benchCard .h{display:flex;align-items:center;gap:6px;color:var(--dim);font:700 11px Tektur,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.06em}
  #benchCard .h .i{width:13px;height:13px}
  #benchCard .gpu{color:var(--dim);font-size:11px;word-break:break-word}
  #benchCard .btns{display:flex;gap:8px}#benchCard button{height:36px;padding:0 14px;border-radius:9px;border:0;cursor:pointer;font:700 13px Tektur,system-ui,sans-serif;display:inline-flex;gap:6px;align-items:center}
  #benchCard button.p{background:var(--ice);color:#04101f}#benchCard button.g{background:rgba(255,255,255,.08);color:var(--ink)}
  @media (max-width:520px){#benchCard .tiles{grid-template-columns:repeat(2,1fr)}}`;
  document.head.appendChild(css);
  const pill = document.createElement('div'); pill.id = 'benchPill';
  const setPill = (label, k) => { pill.innerHTML = `${ico('clock', 'c-ice')}<span>Замер · ${label}</span><b><i style="width:${Math.round(k * 100)}%"></i></b>`; };
  const TOTAL = 10 + 8 + 24 + 26 + 20 + 20;
  let elapsed = 0;

  /* ------------------------------------------------------------------ route helpers (the real player + camera) */
  function teleport(x, z, yaw) {
    const P = C.player, y = C.groundH(x, z);
    P.x = x; P.z = z; P.y = y; P.vx = P.vz = P.vy = 0; if (C.CLIMB) C.CLIMB.t = -1;
    if (C.PH && C.PH.ok && C.PH.ch) { C.PH.ch.setEnabled(true); C.PH.ch.setPosition(x, y + 0.05, z); }
    if (yaw !== undefined) { C.cam.yaw = yaw; P.face = yaw; }
    C.cam.look.set(x, y + 1.75, z); C.cam.boom = C.cam.dist;
  }
  const yawTo = (x, z) => Math.atan2(C.player.x - x, C.player.z - z);
  const turn = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * Math.min(1, k); };
  function keepAlive() {
    const G = C.G;
    while (C.Dialog.active) { C.Dialog.choosing = false; C.Dialog.close(); }
    C.player.hp = C.player.hpMax = 99;
    if (G.pause && $('bResume')) $('bResume').click();
    if (G.ui) { const b = $('bCloseMap'); if (b) b.click(); }
  }
  // walk along waypoints (loops), turning the camera toward the next one; a stuck pilot jumps and sidesteps
  function walker(pts, o = {}) {
    let i = 0, lastP = null, stuckT = 0;
    return (dt) => {
      const P = C.player, w = pts[i % pts.length];
      if (Math.hypot(P.x - w[0], P.z - w[1]) < 2.5) i++;
      C.cam.yaw = turn(C.cam.yaw, yawTo(w[0], w[1]), dt * 2.5);
      C.cam.pitch = o.pitch !== undefined ? o.pitch : 0.22; if (o.dist) { C.cam.dist = o.dist; }
      C.keys.KeyW = true; C.keys.ShiftLeft = !!o.run;
      if (!lastP) lastP = [P.x, P.z];
      stuckT += dt;
      if (stuckT > 1.5) { if (Math.hypot(P.x - lastP[0], P.z - lastP[1]) < 1) { C.pressed.add('Space'); i++; } lastP = [P.x, P.z]; stuckT = 0; }
    };
  }
  const release = () => { for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft']) C.keys[k] = false; };
  function densestForest() {
    const L = (C.FOREST && C.FOREST.list) || []; let best = null, bn = -1;
    for (let i = 0; i < L.length; i += 3) { const t = L[i]; let n = 0; for (const u of L) if ((u[0] - t[0]) ** 2 + (u[2] - t[2]) ** 2 < 400) n++; if (n > bn) { bn = n; best = t; } }
    return best ? { x: best[0] + 2.5, z: best[2] + 2.5, n: bn } : { x: C.POI.crash.x + 40, z: C.POI.crash.z - 40, n: 0 };
  }

  /* ------------------------------------------------------------------ measurement */
  function startPhase(name, label, icon) {
    cur = { name, label, icon, t0: now(), dts: [], rs: [], gpu: [], cpu: [], drawn0: C.LOOP ? C.LOOP.drawn : 0, measure: true };
    B.phases.push(cur); B.phase = name;
  }
  function endPhase() { if (!cur) return; cur.t1 = now(); cur.drawn = (C.LOOP ? C.LOOP.drawn : 0) - cur.drawn0; cur = null; release(); drive = null; }
  async function hold(label, s, k0) {
    const t0 = now();
    while (now() - t0 < s * 1000) { keepAlive(); setPill(label + ' · ' + Math.ceil(s - (now() - t0) / 1000) + ' с', (k0 + (now() - t0) / 1000) / TOTAL); await sleep(250); }
    elapsed = k0 + s;
  }
  let lastT = 0;
  const mod = {
    name: 'bench', order: 999,
    init(ctx) { C = ctx; setTimeout(run, 50); },
    update(dt) {
      const t = now(), d = lastT ? t - lastT : 0; lastT = t;
      if (drive) try { drive(dt); } catch (e) { B.log.push(String(e)); drive = null; }
      if (cur && cur.measure && d > 0 && d < 1000) {
        cur.dts.push(d);
        const L = window.LowEnd && LowEnd.last; if (L) { if (L.gpuMs != null) cur.gpu.push(L.gpuMs); cur.cpu.push(L.cpuMs); }
        cur.rs.push(C.RS ? C.RS.s : 1);
      }
    },
  };
  (window.GameModules = window.GameModules || []).push(mod);

  async function run() {
    document.body.appendChild(pill); setPill('загрузка', 0);
    while (!($('menu') && !$('menu').hidden)) await sleep(250);            // loader done → menu shown
    // 1) menu: the loop should stop after 3 s (nothing drawn → cool laptop)
    startPhase('menu', 'меню', 'home'); cur.measure = false;
    await hold('меню', 10, 0); endPhase();
    // 2) start a new game, warm-up (shaders, packs, first shadow cache)
    const save = (() => { try { return localStorage.getItem('eor-save'); } catch (e) { return null; } })();
    $('bNew').click(); await sleep(900); keepAlive();
    const cx = C.POI.crash.x, cz = C.POI.crash.z;
    teleport(cx - 3, cz + 10, 0.4);
    drive = walker([[cx - 3, cz + 30], [cx + 10, cz + 40]], {});
    startPhase('warm', 'разогрев', 'clock'); cur.measure = false;
    await hold('разогрев', 8, 10); endPhase();
    // 3) walk: open snow and the crash site, 24 s
    teleport(cx - 3, cz + 10, 0.4);
    const sx = C.POI.station.x, sz = C.POI.station.z;
    drive = walker([[cx + 20, cz - 5], [cx + 60, cz - 25], [(cx + sx) / 2, (cz + sz) / 2], [sx - 30, sz + 20]]);
    startPhase('walk', 'прогулка', 'move'); await hold('прогулка', 24, 18); endPhase();
    // 4) deep forest (the heaviest view), 26 s: slow loop between the trees
    const f = densestForest(); teleport(f.x, f.z, 0.8);
    const ring = []; for (let a = 0; a < 6.28; a += 0.8) ring.push([f.x + Math.sin(a) * 12, f.z + Math.cos(a) * 12]);
    drive = walker(ring, { pitch: 0.15 });
    startPhase('forest', 'лес', 'wind'); cur.note = f.n + ' деревьев в 20 м'; await hold('лес', 26, 42); endPhase();
    // 5) station fire / camp, 20 s: stand 5 m from the fire, look around slowly
    const fire = C.WORLD && C.WORLD.stationW ? C.WORLD.stationW(3, 11) : { x: sx, z: sz + 12 };
    teleport(fire.x + 4, fire.z + 3, Math.atan2(4, 3));
    let yaw0 = Math.atan2(4, 3), tt = 0;
    drive = (dt) => { tt += dt; C.cam.yaw = yaw0 + Math.sin(tt * 0.35) * 1.1; C.cam.pitch = 0.2; C.cam.dist = 6; };
    startPhase('camp', 'у костра', 'fire'); await hold('у костра', 20, 68); endPhase();
    // 6) snow close-up: camera low over fresh snow, slow steps (footprints, sparkle), 20 s
    const s0x = cx - 10, s0z = cz + 25; teleport(s0x, s0z, 0);
    const loop = []; for (let a = 0; a < 6.28; a += 1.05) loop.push([s0x + Math.sin(a) * 5, s0z + Math.cos(a) * 5]);
    drive = walker(loop, { pitch: 0.85, dist: 3.2 });
    startPhase('snow', 'снег вблизи', 'target'); await hold('снег вблизи', 20, 88); endPhase();
    release();
    if ($('bPause')) $('bPause').click();   // paused: no autosave, and the loop goes idle behind the card
    await sleep(100);
    try { if (save) localStorage.setItem('eor-save', save); else localStorage.removeItem('eor-save'); } catch (e) { /* the bench must not eat a real save */ }
    finish();
  }

  /* ------------------------------------------------------------------ result */
  function summarise() {
    const play = B.phases.filter((p) => p.measure && p.dts.length);
    const all = [].concat(...play.map((p) => p.dts));
    const Q = C.Q, cap = Q.fpsCap || 0;
    const fpsOf = (a) => (a.length ? 1000 / pct(a, 0.5) : 0), lowOf = (a) => (a.length ? 1000 / pct(a, 0.99) : 0);
    const late = (a) => (a.length ? a.filter((x) => x > 40).length / a.length : 0);
    const edges = [0, 25, 35, 40, 50, 67, Infinity], names = ['>40', '30', '25–30', '20–25', '15–20', '<15'];
    const hist = names.map((n, i) => ({ n, k: all.filter((x) => x >= edges[i] && x < edges[i + 1]).length / Math.max(1, all.length) }));
    const rsAll = [].concat(...play.map((p) => p.rs));
    const gAll = [].concat(...play.map((p) => p.gpu)), cAll = [].concat(...play.map((p) => p.cpu));
    const med = fpsOf(all), low = lowOf(all);
    const ok = med >= 29 && low >= 24 && late(all) <= 0.03;
    const menu = B.phases.find((p) => p.name === 'menu');
    const gpuMs = gAll.length ? pct(gAll, 0.5) : null, cpuMs = cAll.length ? pct(cAll, 0.5) : null;
    return {
      date: new Date().toISOString(), preset: Q.name, fpsCap: cap, gpu: (window.LowEnd && LowEnd.gpuName) || '', dpr: devicePixelRatio,
      canvas: [Math.round(innerWidth * devicePixelRatio), Math.round(innerHeight * devicePixelRatio)], css: [innerWidth, innerHeight],
      fps: +med.toFixed(1), low1: +low.toFixed(1), late40: +(late(all) * 100).toFixed(1), verdict: ok,
      rs: rsAll.length ? { min: +Math.min(...rsAll).toFixed(2), med: +pct(rsAll, 0.5).toFixed(2), last: +rsAll[rsAll.length - 1].toFixed(2) } : null,
      gpuMs: gpuMs != null ? +gpuMs.toFixed(1) : null, cpuMs: cpuMs != null ? +cpuMs.toFixed(1) : null,
      workPerSec: gpuMs != null ? Math.round(gpuMs * med) : null,
      menu: menu ? { drawn: menu.drawn, seconds: +((menu.t1 - menu.t0) / 1000).toFixed(1) } : null,
      hist, phases: play.map((p) => ({ name: p.name, label: p.label, icon: p.icon, note: p.note || '', fps: +fpsOf(p.dts).toFixed(1), low1: +lowOf(p.dts).toFixed(1), late40: +(late(p.dts) * 100).toFixed(1),
        rs: p.rs.length ? +pct(p.rs, 0.5).toFixed(2) : 1, gpuMs: p.gpu.length ? +pct(p.gpu, 0.5).toFixed(1) : null, frames: p.dts.length })),
      lowend: window.LowEnd ? LowEnd.stats() : null,
    };
  }
  function finish() {
    pill.remove();
    const R = B.result = summarise();
    try { parent !== window && parent.postMessage({ type: 'eor-bench', result: R }, '*'); } catch (e) { /* no parent */ }
    const col = (fps) => (fps >= 29 ? 'var(--aur)' : fps >= 24 ? 'var(--amber)' : 'var(--danger)');
    const tile = (icon, v, l, c) => `<div class="t"><div class="v" style="color:${c || 'var(--ink)'}">${v}</div><div class="l">${ico(icon)}${l}</div></div>`;
    const maxH = Math.max(...R.hist.map((h) => h.k), 0.01);
    const hcol = ['var(--ice)', 'var(--aur)', 'var(--amber)', 'var(--amber)', 'var(--danger)', 'var(--danger)'];
    const el = document.createElement('div'); el.id = 'benchCard';
    el.innerHTML = `<div class="bc">
      <div class="vd" style="color:${R.verdict ? 'var(--aur)' : 'var(--danger)'}">${ico(R.verdict ? 'check' : 'cross')}${R.verdict ? '30 кадров ровно' : 'Не 30 кадров ровно'}</div>
      <div class="tiles">
        ${tile('play', R.fps, 'кадров/с (медиана)', col(R.fps))}
        ${tile('target', R.low1, '1% худших', col(R.low1 + 5))}
        ${tile('chip', R.rs ? Math.round(R.rs.med * 100) + '%' : '100%', 'разрешение 3D')}
        ${tile('home', R.menu ? R.menu.drawn : '—', 'кадров в меню за 10 с', R.menu && R.menu.drawn < 120 ? 'var(--aur)' : 'var(--amber)')}
      </div>
      <div class="h">${ico('clock')}время кадра</div>
      <div class="hist">${R.hist.map((h, i) => `<div><span style="height:${Math.max(1, h.k / maxH * 52)}px;background:${hcol[i]}"></span>${Math.round(h.k * 100)}%<br>${h.n}</div>`).join('')}</div>
      <div class="h">${ico('map')}маршрут</div>
      <table>${R.phases.map((p) => `<tr><td>${ico(p.icon, 'c-ice')} ${p.label}</td><td style="color:${col(p.fps)}"><b>${p.fps}</b></td><td class="c-dim">1% ${p.low1}</td>
        <td style="width:34%"><div class="bar"><i style="width:${Math.min(100, p.fps / Math.max(30, R.fpsCap || 60) * 100)}%;background:${col(p.fps)}"></i></div></td><td class="c-dim">${Math.round(p.rs * 100)}%</td></tr>`).join('')}</table>
      <div class="tiles">
        ${tile('clock', R.late40 + '%', 'кадров дольше 40 мс', R.late40 <= 3 ? 'var(--aur)' : 'var(--amber)')}
        ${tile('person', R.cpuMs != null ? R.cpuMs + ' мс' : '—', 'процессор / кадр')}
        ${tile('bolt', R.rs ? Math.round(R.rs.min * 100) + '–' + Math.round(Math.max(...R.phases.map((p) => p.rs)) * 100) + '%' : '—', 'разрешение min–max')}
        ${tile('visor', R.preset, 'профиль' + (R.fpsCap ? ' · ' + R.fpsCap + ' к/с' : ''))}
      </div>
      <div class="gpu">${ico('chip')} ${R.gpu || 'видеокарта скрыта браузером'} · ${R.canvas[0]}×${R.canvas[1]} · ×${R.dpr}</div>
      <div class="btns"><button class="p" id="benchCopy">${ico('book')}Копировать</button><button class="g" id="benchAgain">${ico('play')}Ещё раз</button></div>
    </div>`;
    document.body.appendChild(el);
    $('benchCopy').onclick = () => {
      const txt = JSON.stringify(Object.assign({}, R, { lowend: R.lowend && { state: R.lowend.state, history: R.lowend.history.slice(-12) } }));
      const done = () => { $('benchCopy').lastChild.textContent = 'Скопировано'; };
      try { navigator.clipboard.writeText(txt).then(done, () => fallback(txt)); } catch (e) { fallback(txt); }
      function fallback(t) { const ta = document.createElement('textarea'); ta.value = t; el.querySelector('.bc').appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e2) { /* shown, copy by hand */ } }
    };
    $('benchAgain').onclick = () => location.reload();
    console.log('[bench]', JSON.stringify(R));
  }
})();
