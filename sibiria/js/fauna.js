'use strict';
// Живность без угрозы: зайцы, вороны, олени деда; ловушки героя (улов — на рассвете).
const Fauna = (() => {
  const F = TUNE.fauna;
  const POSES = ['sit', 'scratch', 'gnaw', 'sniff', 'lie', 'sit'];
  const hareDiff = (a, b) => (Math.abs((a.sz || 0) - (b.sz || 0)) > 0.02) + ((a.coat | 0) !== (b.coat | 0)) + (a.pose !== b.pose) + (a.face !== b.face);
  const hq = (x, y) => { let h = Math.imul((x * 8 | 0) ^ 0x2C1B3C6D, 0x297A2D39) ^ Math.imul((y * 8 | 0) + 0x5BD1E995, 0x1B873593); h ^= h >>> 15; h = Math.imul(h, 0x85EBCA6B); return (h ^ h >>> 13) >>> 0; };
  // заяц: на старте — где угодно; потом — у героя (квадрат ±TUNE.r.hareSpawn, не ближе hareMinR), чтобы
  // выбитые вокруг героя восполнялись там же, а не размазывались по всему миру
  function spawnHare(any) {
    const R = TUNE.r.hareSpawn;
    for (let k = 0; k < 30; k++) {
      const x = any ? rnd(120, W - 120) : rnd(Math.max(120, G.p.x - R), Math.min(W - 120, G.p.x + R));
      const y = any ? rnd(120, H - 120) : rnd(Math.max(120, G.p.y - R), Math.min(H - 120, G.p.y + R));
      if (!any && Math.hypot(x - G.p.x, y - G.p.y) < F.hareMinR) continue;
      if (Math.hypot(x - HUT.x, y - HUT.y) < 300) continue;
      if (World.blocked(x, y, 6)) continue; // не внутри ствола/глыбы/вещи
      const q = hq(x, y); // вид — из хэша места (Math.random игры не тратим): рост, окрас, начальная поза
      const h = { x, y, vx: 0, vy: 0, t: rnd(0.5, 2), face: q & 1 ? 1 : -1, hop: 0, pr: 0, sz: +(0.5 + ((q >>> 3) & 15) / 15 * 0.14).toFixed(3), coat: (q >>> 8) & 3, pose: POSES[(q >>> 12) % POSES.length], pt: 1 + ((q >>> 16) & 7) * 0.5 };
      // сосед ближе 120 px — хотя бы 2 отличия из (рост, окрас, поза, зеркало): иначе сдвигаем окрас и позу (tests/variety.js)
      for (const o of G.hares) if ((o.x - x) ** 2 + (o.y - y) ** 2 < 120 * 120 && hareDiff(o, h) < 2) { h.coat = (o.coat + 1 + (q & 1)) & 3; h.pose = POSES[(POSES.indexOf(o.pose) + 1) % 5]; }
      G.hares.push(h);
      return;
    }
  }
  // новая поза на месте: из хэша, но не такая, чтобы с соседом ближе 120 px осталось < 2 отличий (tests/variety.js)
  const NBH = [];
  function freshPose(h, q) {
    NBH.length = 0; const nb = Space.hares.near(h.x, h.y, 140, NBH).filter(o => o !== h && (o.x - h.x) ** 2 + (o.y - h.y) ** 2 < 120 * 120);
    const k0 = q % POSES.length, pose0 = h.pose;
    for (let k = 0; k < POSES.length; k++) { h.pose = POSES[(k0 + k) % POSES.length]; if (nb.every(o => hareDiff(o, h) >= 2)) return h.pose; }
    h.pose = pose0; return POSES[k0];
  }
  function perchRaven(rv) {
    let t = null;
    for (let i = 0; i < 12 && !(t && t.wood > 0 && t.kind !== 1); i++) t = G.trees[(Math.random() * G.trees.length) | 0];
    if (!t || t.wood <= 0 || t.kind === 1) { rv.fly = 1; rv.t = 5; return; }
    rv.x = t.x + rnd(-6, 6); rv.y = t.y; rv.z = 100 * t.s * 0.95; rv.fly = 0; rv.vx = rv.vy = 0;
  }
  function hares(dt0) {
    const p = G.p, dt = dt0, storm = stormOn();
    // испуг — сразу, по дистанции и скорости героя: стоящего подпускает ближе (×0.6), бегущего/на лыжах — дальше (до ×1.2)
    const ps = Math.hypot(p.vx || 0, p.vy || 0), scareR = F.hareScare * (p.ride === 'buran' ? TUNE.tr.scare : 1) * (0.6 + 0.4 * clamp(ps / TUNE.hero.speed, 0, 1.5));
    for (let i = 0; i < G.hares.length; i++) {
      const h = G.hares[i], dt = Space.lodDt(h, dt0, i); if (!dt) continue;
      const dd = dist(h, p);
      h.t -= dt;
      // пурга (Ctx/погода): заяц прячется — к ближайшей ели и ложится в снег под ней (h.hid); спугнуть можно только вплотную
      if (storm && dd >= scareR * 0.5) {
        if (!h.hideAt) { const t = Space.nearest(Space.trees, h.x, h.y, 240, q => q.wood > 0 && q.kind === 0 && q.stage !== 1); h.hideAt = t ? { x: t.x + (h.x < t.x ? -9 : 9), y: t.y + 5 } : { x: h.x, y: h.y }; }
        const dx = h.hideAt.x - h.x, dy = h.hideAt.y - h.y, d = Math.hypot(dx, dy);
        if (d > 6) { h.vx = dx / d * 75; h.vy = dy / d * 75; h.hid = 0; } else { h.vx = h.vy = 0; h.hid = 1; h.pose = 'lie'; h.pt = 3; }
        h.flee = 0; h.t = Math.max(h.t, 0.3);
      } else if (h.hid || h.hideAt) { if (!storm || dd < scareR * 0.5) { h.hid = 0; h.hideAt = null; } }
      if (storm && dd >= scareR * 0.5) { /* прячется — выше */ }
      else if (dd < scareR) {
        // первый испуг: заяц замирает (прижался, уши торчком) на 0.5–1.6 с, затем срывается; дальше — зигзаг каждые 0.3–0.6 с.
        // Без этого окна заяц (150 px/с) уходит от героя по целине (≈115 px/с) всегда — ловля руками почти невозможна.
        if (!h.flee && !h.freeze) { h.freeze = 1; h.t = rnd(0.5, 1.6); h.vx = h.vy = 0; h.pose = 'alert'; }
        if (h.t <= 0) {
          h.freeze = 0;
          const a = Math.atan2(h.y - p.y, h.x - p.x) + rnd(-1, 1), sp = F.hareRun - F.hareRunSkill * (Hero.lvl('hunt') - 1);
          h.vx = Math.cos(a) * sp; h.vy = Math.sin(a) * sp; h.t = rnd(0.3, 0.6); h.flee = 1;
        }
      } else if (h.freeze && !h.flee) { h.freeze = 0; } // герой отошёл, пока заяц замер — успокоился
      else if (h.flee && dd > scareR * 1.25) { h.flee = 0; h.vx = h.vy = 0; h.t = rnd(0.6, 1.5); h.pose = 'alert'; h.pt = 1.5; }
      else if (h.flee) { /* ещё бежит, пока не оторвался */ if (h.t <= 0) h.t = rnd(0.3, 0.6); }
      else if (h.t <= 0) {
        if (Math.random() < 0.5) { h.vx = h.vy = 0; h.pt = 0; } else { const a = Math.random() * 6.28; h.vx = Math.cos(a) * 40; h.vy = Math.sin(a) * 40; }
        h.t = rnd(1, 3);
      }
      h.x = clamp(h.x + h.vx * dt, 60, W - 60); h.y = clamp(h.y + h.vy * dt, 60, H - 60);
      World.solid(h, 5, 'a'); // стволы, глыбы, вещи — в обход (шаг вдоль преграды — World.solid)
      // стены избы держит World.solid (обход реальных стен); в открытую дверь (без двери) внутрь не заходит — назад и от избы
      if (insideHut(h.x, h.y)) { h.x -= h.vx * dt; h.y -= h.vy * dt; h.vx *= -1; h.vy *= -1; }
      if (Math.abs(h.vx) > 1) h.face = Math.sign(h.vx);
      const moving = Math.hypot(h.vx, h.vy) > 1;
      // поза на месте: насторожился (герой рядом) · сидит · чешется · грызёт · нюхает · лежит — сменяются сами
      if (!moving) {
        if (dd < scareR * 1.7) h.pose = 'alert';
        else if ((h.pt -= dt) <= 0) { const q = hq(h.x, h.y + G.time * 7); h.pose = freshPose(h, q); h.pt = 2 + ((q >>> 5) & 7) * 0.6; }
      }
      h.hop += dt * (moving ? 14 : 0);
      if (moving) { h.pr += dt; if (h.pr > 0.35) { h.pr = 0; if (dd < TUNE.r.awake) Fx.print(h.x, h.y, Math.atan2(h.vy, h.vx), 'h'); } }
    }
    if (G.hares.length < WORLD.count('haresMin') && Math.random() < dt * F.hareRespawn * WORLD.area * Zones.rule('spawn')) spawnHare(false);
  }
  function living(dt0) {
    const p = G.p;
    for (let i = 0; i < G.ravens.length; i++) {
      const rv = G.ravens[i], dt = Space.lodDt(rv, dt0, i); if (!dt) continue;
      const rs = stormOn(); // пурга: вороны не летают — сидят нахохлившись; взлетают только если подойти вплотную
      if (!rv.fly) {
        if (rs ? dist2(rv, p) < 40 * 40 : dist2(rv, p) < 130 * 130 || G.wolves.some(w => dist2(w, rv) < 100 * 100)) {
          rv.fly = 1; const a = Math.atan2(rv.y - p.y, rv.x - p.x) + rnd(-0.6, 0.6); rv.vx = Math.cos(a) * 180; rv.vy = Math.sin(a) * 120; rv.t = rnd(20, 40);
          if (Math.random() < 0.5) Sound.src(rv).tone('sawtooth', 700, 500, 0.15, 0.06);
        }
      } else { rv.x += rv.vx * dt; rv.y += rv.vy * dt; rv.z += 60 * dt; rv.t -= rs ? dt * 8 : dt; if (rv.t <= 0) perchRaven(rv); } // в пургу садятся почти сразу
    }
    // пурга: олени сбиваются в кучу (к середине своих в радиусе 400) и стоят хвостом к ветру
    const ds = stormOn(), wd = ds ? Wind.dir() : 0;
    for (let i = 0; i < G.deer.length; i++) {
      const d = G.deer[i], dt = Space.lodDt(d, dt0, i); if (!dt) continue;
      d.t -= dt; const dp = dist(d, p);
      if (ds && dp >= 90) {
        let mx = 0, my = 0, n = 0; for (const o of G.deer) if ((o.x - d.x) ** 2 + (o.y - d.y) ** 2 < 400 * 400) { mx += o.x; my += o.y; n++; }
        mx /= n; my /= n; const dx = mx - d.x, dy = my - d.y, l = Math.hypot(dx, dy);
        if (l > 22) { d.vx = dx / l * 45; d.vy = dy / l * 45; } else { d.vx = d.vy = 0; d.face = Math.cos(wd) >= 0 ? 1 : -1; } // морда по ветру — хвост к ветру
        d.t = 0.5; d.huddle = 1;
      } else if (dp < 140) { const a = Math.atan2(d.y - p.y, d.x - p.x); d.vx = Math.cos(a) * 150; d.vy = Math.sin(a) * 150; d.t = 1; }
      else if (d.t <= 0) {
        // дом стада: у чума деда или у своего якоря (стойбище)
        const hx = d.hx != null ? d.hx : POI.chum.x + 200, hy = d.hy != null ? d.hy : POI.chum.y + 40;
        d.t = rnd(2, 5); if (Math.random() < 0.6 || Math.hypot(d.x - hx, d.y - hy + 40) > 280) { const a = Math.atan2(hy - d.y, hx - d.x) + rnd(-1.2, 1.2); d.vx = Math.cos(a) * 30; d.vy = Math.sin(a) * 30;
          if (typeof Depth !== 'undefined') { const v = Depth.steer(d, d.vx, d.vy, 'deer'); if (v) { d.vx = v.x * 30; d.vy = v.y * 30; } } } // по натоптанному — в обход сугробов
        else d.vx = d.vy = 0;
      }
      d.x = clamp(d.x + d.vx * dt, 60, W - 60); d.y = clamp(d.y + d.vy * dt, 60, H - 60);
      World.solid(d, 12, 'a');
      if (Math.abs(d.vx) > 2) d.face = Math.sign(d.vx);
      if (!ds) d.huddle = 0;
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
  return { spawnHare, perchRaven, hares, living, dawnTraps, POSES, hareDiff };
})();
