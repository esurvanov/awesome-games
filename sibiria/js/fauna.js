'use strict';
// Живность без угрозы: зайцы, вороны, олени деда; ловушки героя (улов — на рассвете).
const Fauna = (() => {
  const F = TUNE.fauna;
  // заяц: на старте — где угодно; потом — у героя (квадрат ±TUNE.r.hareSpawn, не ближе hareMinR), чтобы
  // выбитые вокруг героя восполнялись там же, а не размазывались по всему миру
  function spawnHare(any) {
    const R = TUNE.r.hareSpawn;
    for (let k = 0; k < 30; k++) {
      const x = any ? rnd(120, W - 120) : rnd(Math.max(120, G.p.x - R), Math.min(W - 120, G.p.x + R));
      const y = any ? rnd(120, H - 120) : rnd(Math.max(120, G.p.y - R), Math.min(H - 120, G.p.y + R));
      if (!any && Math.hypot(x - G.p.x, y - G.p.y) < F.hareMinR) continue;
      if (Math.hypot(x - HUT.x, y - HUT.y) < 300) continue;
      G.hares.push({ x, y, vx: 0, vy: 0, t: rnd(0.5, 2), face: 1, hop: 0, pr: 0 });
      return;
    }
  }
  function perchRaven(rv) {
    let t = null;
    for (let i = 0; i < 12 && !(t && t.wood > 0 && t.kind !== 1); i++) t = G.trees[(Math.random() * G.trees.length) | 0];
    if (!t || t.wood <= 0 || t.kind === 1) { rv.fly = 1; rv.t = 5; return; }
    rv.x = t.x + rnd(-6, 6); rv.y = t.y; rv.z = 100 * t.s * 0.95; rv.fly = 0; rv.vx = rv.vy = 0;
  }
  function hares(dt0) {
    const p = G.p, dt = dt0;
    for (let i = 0; i < G.hares.length; i++) {
      const h = G.hares[i], dt = Space.lodDt(h, dt0, i); if (!dt) continue;
      const dd = dist(h, p);
      h.t -= dt;
      if (dd < F.hareScare * (p.ride === 'buran' ? TUNE.tr.scare : 1)) {
        if (h.t <= 0) {
          const a = Math.atan2(h.y - p.y, h.x - p.x) + rnd(-1, 1), sp = F.hareRun - F.hareRunSkill * (Hero.lvl('hunt') - 1);
          h.vx = Math.cos(a) * sp; h.vy = Math.sin(a) * sp; h.t = rnd(0.3, 0.6);
        }
      } else if (h.t <= 0) {
        if (Math.random() < 0.5) { h.vx = h.vy = 0; } else { const a = Math.random() * 6.28; h.vx = Math.cos(a) * 40; h.vy = Math.sin(a) * 40; }
        h.t = rnd(1, 3);
      }
      h.x = clamp(h.x + h.vx * dt, 60, W - 60); h.y = clamp(h.y + h.vy * dt, 60, H - 60);
      if (Math.abs(h.x - HUT.x) < 140 && Math.abs(h.y - HUT.y) < 120) { h.vx *= -1; h.vy *= -1; }
      if (Math.abs(h.vx) > 1) h.face = Math.sign(h.vx);
      const moving = Math.hypot(h.vx, h.vy) > 1;
      h.hop += dt * (moving ? 14 : 0);
      if (moving) { h.pr += dt; if (h.pr > 0.35) { h.pr = 0; if (dd < TUNE.r.awake) Fx.print(h.x, h.y, Math.atan2(h.vy, h.vx), 'h'); } }
    }
    if (G.hares.length < WORLD.count('haresMin') && Math.random() < dt * F.hareRespawn * WORLD.area * Zones.rule('spawn')) spawnHare(false);
  }
  function living(dt0) {
    const p = G.p;
    for (let i = 0; i < G.ravens.length; i++) {
      const rv = G.ravens[i], dt = Space.lodDt(rv, dt0, i); if (!dt) continue;
      if (!rv.fly) {
        if (dist2(rv, p) < 130 * 130 || G.wolves.some(w => dist2(w, rv) < 100 * 100)) {
          rv.fly = 1; const a = Math.atan2(rv.y - p.y, rv.x - p.x) + rnd(-0.6, 0.6); rv.vx = Math.cos(a) * 180; rv.vy = Math.sin(a) * 120; rv.t = rnd(20, 40);
          if (Math.random() < 0.5) Sound.tone('sawtooth', 700, 500, 0.15, 0.06);
        }
      } else { rv.x += rv.vx * dt; rv.y += rv.vy * dt; rv.z += 60 * dt; rv.t -= dt; if (rv.t <= 0) perchRaven(rv); }
    }
    for (let i = 0; i < G.deer.length; i++) {
      const d = G.deer[i], dt = Space.lodDt(d, dt0, i); if (!dt) continue;
      d.t -= dt; const dp = dist(d, p);
      if (dp < 140) { const a = Math.atan2(d.y - p.y, d.x - p.x); d.vx = Math.cos(a) * 150; d.vy = Math.sin(a) * 150; d.t = 1; }
      else if (d.t <= 0) {
        // дом стада: у чума деда или у своего якоря (стойбище)
        const hx = d.hx != null ? d.hx : POI.chum.x + 200, hy = d.hy != null ? d.hy : POI.chum.y + 40;
        d.t = rnd(2, 5); if (Math.random() < 0.6 || Math.hypot(d.x - hx, d.y - hy + 40) > 280) { const a = Math.atan2(hy - d.y, hx - d.x) + rnd(-1.2, 1.2); d.vx = Math.cos(a) * 30; d.vy = Math.sin(a) * 30; } else d.vx = d.vy = 0;
      }
      d.x = clamp(d.x + d.vx * dt, 60, W - 60); d.y = clamp(d.y + d.vy * dt, 60, H - 60);
      if (Math.abs(d.vx) > 2) d.face = Math.sign(d.vx);
    }
  }
  // рассвет: улов в ловушках, простоявших ≥ trapT с (капкан в кедраче — соболь)
  function dawnTraps() {
    const T = TUNE.traps;
    for (const t of G.traps) if (!t.catch && G.time - t.t > T.minT) {
      const r = Math.random();
      if (t.kind === 'trap' && World.inCedar(t.x, t.y)) t.catch = r < T.sable ? 'sable' : r < T.wpeltTo ? 'wpelt' : null;
      else t.catch = r < (t.kind === 'trap' ? T.trapHare : T.snareHare) ? 'hare' : null;
    }
    if (G.traps.some(t => t.catch)) Fx.toast(':trap: В ловушках добыча');
  }
  return { spawnHare, perchRaven, hares, living, dawnTraps };
})();
