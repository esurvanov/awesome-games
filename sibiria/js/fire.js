'use strict';
// Огонь: костры, сигнальные кучи, вышки посёлка (защита от волков, тепло) и печь в избе.
const Fire = (() => {
  const F = TUNE.fire;
  const fearR = f => f.stack ? F.fear.stack : f.tower ? F.fear.tower : f.fuel > F.fear.bigFuel ? F.fear.big : F.fear.small;
  function burning() {
    const out = [];
    for (const f of G.fires) if (f.fuel > 0) out.push(f);
    for (const s of G.stacks) if (s.lit > 0) out.push({ x: s.x, y: s.y, fuel: s.lit, stack: 1 });
    if (G.col) for (const b of G.col.builds) if (b.done && b.type === 'tower' && b.fuel > 0) out.push({ x: b.x, y: b.y, fuel: b.fuel, tower: 1 });
    return out;
  }
  function near(r) { for (const f of burning()) if (dist2(f, G.p) < r * r) return f; return null; }
  // круг, в котором герой под защитой огня (волки кружат снаружи); null — не защищён
  function protection() {
    const p = G.p;
    if (p.inside && G.hut.fuel > 0) return { x: HUT.x, y: HUT.y - 30, r: F.hutProtectR };
    if (p.inside && G.hut.door) return null;
    for (const f of burning()) { const r = fearR(f); if (dist2(f, p) < r * r) return { x: f.x, y: f.y, r }; }
    if (p.torch > 0) return { x: p.x, y: p.y, r: F.torchR };
    return null;
  }
  // поджиг кучи: поленья остаются и горят (сгорают к концу s.lit), пламя разгорается плавно (s.fl)
  function lightStack(s, sec) { s.lit = sec; s.lit0 = sec; s.fl = s.fl || 0; Fx.toast(':fire: Куча горит'); Sound.ok2(); Fx.burst(s.x, s.y - 20, 12, '#ffb347', 90); }
  // видимый огонь 0..1 идёт к цели с конечной скоростью: разгорается за ~2,5 с, гаснет за ~2 с (ни кадра скачком)
  const FL_UP = 0.4, FL_DN = 0.5;
  const toward = (v, tg, dt) => v + clamp(tg - v, -dt * FL_DN, dt * FL_UP);
  // тепло от ближайшего огня (0 — нет); list — свой список огней (прогноз ночи), по умолчанию — горящие сейчас
  function heatAt(p, heat, list = burning()) {
    for (const f of list) { if (!(f.fuel > 0)) continue;
      const r = f.stack ? F.stackHeatR : F.heatR, dd = dist(f, p);
      if (dd < r) heat = Math.max(heat, F.heatBase + F.heatK * (1 - dd / r));
    }
    return heat;
  }
  // расход топлива костра, с/с (тик и прогноз ночи — одна формула); на льду лужа под костром гасит быстрее
  const burn = (f, night, storm) => (storm ? F.stormBurn : 1) * (1 + F.nightBurn * night) * (f.burn || (f.burn = Zones.ruleAt(f.x, f.y, 'burn'))) * (1 + F.iceThaw.wet * (f.thaw || 0));
  const R = mulberry(0xF12E), rr = (a, b) => a + R() * (b - a); // свой поток: Math.random игры не тратим
  function tick(dt, night, storm) {
    for (const f of G.fires) {
      // видимое пламя (процесс разжигания/засыпания: f.sn — сколько горстей снега): разгорается/гаснет плавно
      const tg = f.fuel > 0 ? 1 - (f.sn || 0) : 0;
      f.fl = f.fl == null ? tg : toward(f.fl, tg, dt);
      // проталина: кольцо растёт со временем горения (t0 — впервые разгорелся; складывают — ещё не тает; потух — кольцо остаётся); рисунок и Depth читают f.melt
      if (f.t0 == null && f.fuel > 0) f.t0 = G.time;
      if (f.fuel > 0) f.t1 = null; else if (f.t1 == null) f.t1 = G.time;
      f.melt = f.t0 == null ? 0 : clamp(((f.fuel > 0 ? G.time : f.t1) - f.t0) / 150, 0, 1);
      if (typeof Ice !== 'undefined') Ice.fireTick(f, dt); // на льду — протаивает лужу, насквозь — уходит под воду (js/ice.js)
      if (!(f.fuel > 0)) { if (f.fl > 0.05 && Math.random() < dt * 2) G.parts.push({ type: 'smoke', x: f.x, y: f.y - 12, vx: rnd(-6, 6), vy: rnd(-26, -14), life: 2.2, max: 2.2 }); continue; }
      f.fuel = Math.max(0, f.fuel - dt * burn(f, night, storm));
      treeSnow(f, dt);
      if (Math.random() < dt * 7) G.parts.push({ type: 'spark', x: f.x + rnd(-6, 6), y: f.y - 14, vx: rnd(-15, 15), vy: rnd(-80, -40), life: rnd(0.5, 1), max: 1, g: -10 });
      if (Math.random() < dt * 3) G.parts.push({ type: 'smoke', x: f.x, y: f.y - 24, vx: rnd(-6, 6), vy: rnd(-30, -18), life: 2.5, max: 2.5 });
    }
    for (let i = G.fires.length - 1; i >= 0; i--) if (G.fires[i].sunk) G.fires.splice(i, 1); // провалился под лёд
    for (const st of G.stacks) {
      st.fl = st.fl == null ? (st.lit > 0 ? 1 : 0) : toward(st.fl, st.lit > 0 ? 1 : 0, dt);
      if (!(st.lit > 0)) continue;
      st.lit = Math.max(0, st.lit - dt);
      st.wood = Math.min(st.wood, Math.ceil(4 * st.lit / (st.lit0 || st.lit || 1) - 1e-6));   // клеть прогорает венец за венцом, к концу — зола
      if (Math.random() < dt * 14) G.parts.push({ type: 'spark', x: st.x + rnd(-12, 12), y: st.y - 24, vx: rnd(-20, 20), vy: rnd(-120, -60), life: rnd(0.6, 1.2), max: 1.2, g: -10 });
      if (Math.random() < dt * 8) G.parts.push({ type: 'smoke', x: st.x, y: st.y - 40, vx: rnd(-8, 8), vy: rnd(-45, -25), life: 3.5, max: 3.5, big: 1 });
    }
  }
  // снег с ели над костром: тепло копится в кроне → ком снега срывается (дрожь ветвей, снег вниз), падает в огонь — шипит, иногда гасит слабый
  // память — рантайм (WeakMap), в сейв не идёт; хвойные (ель, кедр) — снег на лапах, берёза и сухостой — нет
  const TH = new WeakMap(), NT = [];
  function treeSnow(f, dt) {
    const T = F.treeSnow; NT.length = 0;
    for (const t of treesNear(f.x, f.y, T.r + T.rk * 1.5, NT)) {
      if (!(t.wood > 0) || (t.kind !== 0 && t.kind !== 2) || t.stage === 1) continue;
      const cr = T.r + T.rk * (t.s || 1), d = Math.hypot(t.x - f.x, (t.y - f.y) * 1.4); if (d > cr) continue; // крона над огнём
      let q = TH.get(t); if (!q) TH.set(t, q = { h: 0, n: 0, next: rr(T.first[0], T.first[1]) });
      if (q.n >= T.max) continue;
      q.h += dt * (1 - d / cr * 0.6);
      if (q.h < q.next) continue;
      q.h = 0; q.n++; q.next = rr(T.next[0], T.next[1]);
      if (typeof World !== 'undefined') World.shakeTree(t, 0.6);
      if (typeof Interact !== 'undefined') Interact.emit('thaw', { who: 'f', obj: 'tree', target: t, x: t.x, y: t.y });
      // ком падает в огонь: шипит, пар; слабый костёр — бывает, гаснет
      f.fuel = Math.max(0, f.fuel - T.fuelHit); f.hiss = G.time;
      for (let i = 0; i < 5; i++) G.parts.push({ type: 'steam', x: f.x + rr(-8, 8), y: f.y - rr(6, 14), vx: rr(-6, 6), vy: -rr(14, 26), life: rr(1.2, 2), max: 2 });
      if (typeof Sound !== 'undefined' && Sound.hiss && dist2(f, G.p) < 500 * 500) Sound.hiss();
      if (f.fuel > 0 && f.fuel < T.outFuel && R() < T.outP) { f.fuel = 0; if (dist2(f, G.p) < 400 * 400) Fx.toast(':frost: Снег с ели загасил костёр'); }
    }
  }
  // кто сколько держится от огня (px сверх своего радиуса): герой — почти вплотную, звери — дальше; верхом — упряжка шарахается
  function keepR(o, who, r) {
    const K = F.keep;
    if (o === G.p) return o.ride === 'deer' ? K.ride : o.ride === 'buran' ? K.buran : K.p;
    if (who === 'a') return r <= 6 ? K.hare : K.deer;
    if (who === 'u') return o.type === 'laika' ? K.dog : K.n;
    return K[who] || K.n;
  }
  // ожог: герой шагнул в костёр — больно, отдёрнулся (раз в burnCd с; от огня не умирают сразу: не ниже burnFloor)
  let burnT = -99;
  function burnHero(f) {
    const p = G.p; if (Math.abs(G.time - burnT) < F.burnCd || p.ride) return false;
    burnT = G.time;
    G.s.hp = Math.max(Math.min(G.s.hp, F.burnFloor), G.s.hp - F.burnDmg); G.hurt = Math.max(G.hurt || 0, 0.6);
    const a = Math.atan2(p.y - f.y, p.x - f.x); p.x += Math.cos(a) * 8; p.y += Math.sin(a) * 8; p.vx = p.vy = 0; // отдёрнулся
    if (typeof Hero !== 'undefined') Hero.play('flinch', { react: 1 });
    Fx.toast(':fire: Обжёгся! В огонь не лезь'); if (Sound.hiss) Sound.hiss();
    for (let i = 0; i < 6; i++) G.parts.push({ type: 'spark', x: f.x + rr(-6, 6), y: f.y - 8, vx: rr(-40, 40), vy: rr(-110, -50), life: rr(0.5, 0.9), max: 1, g: -10 });
    return true;
  }
  // на рассвете гаснут забытые далёкие костры
  function dawn() { G.fires = G.fires.filter(f => f.fuel > 0 || dist2(f, G.p) < TUNE.r.fireKeep * TUNE.r.fireKeep); }
  return { fearR, burning, near, protection, lightStack, heatAt, burn, tick, dawn, toward, keepR, burnHero, treeSnow };
})();

// Печь: полено даёт secPerLog() игровых секунд огня (1,25–2,25 игр. ч) (щели и заслонка — дольше); ночью горит быстрее.
const Stove = (() => {
  const S = TUNE.stove;
  const secPerLog = () => G.hut.damper ? S.secPerLog.damper : G.hut.walls ? S.secPerLog.walls : S.secPerLog.base;
  // Вместимость печи в поленьях. Инвариант (исправление): в утеплённой избе (щели заделаны) полная печь
  // держит самую длинную ночь сна — от TUNE.time.sleepFrom до TUNE.time.wakeAt при ночной тяге,
  // даже если «полна» сработала на пол-полена раньше. Без щелей изба продувается — ночь не держит (так задумано).
  function maxLogs() {
    if (!G.hut.walls) return S.maxLogs;
    const T = TUNE.time, night = (24 - T.sleepFrom + T.wakeAt) * CYCLE / 24;
    return Math.max(S.maxLogs, Math.ceil(night * (1 + S.nightBurn) / secPerLog() + S.fullSlack));
  }
  const max = () => secPerLog() * maxLogs();
  // подбросить полено: сначала из лабаза, потом из рюкзака (исправление: раньше — из рюкзака)
  const room = () => !(G.hut.fuel > max() - secPerLog() * S.fullSlack);
  function add() {
    if (!room()) { Fx.toast(':stove: Печь полна'); return false; }
    if (!Inv.takeStock('wood', 1)) { Fx.toast(':close: Не хватает: :wood:1 (в руках или в лабазе)'); return false; }
    G.hut.fuel += secPerLog(); G.flags.stoveLit = 1; Fx.floatText(SPOT.stove.x, SPOT.stove.y - 30, ':fire: +' + gameDur(secPerLog())); Sound.chop();
    return true;
  }
  // расход печи, с/с (тик и прогноз ночи — одна формула)
  const burn = (night, storm) => (storm && !G.hut.walls ? S.stormDraft : 1) * (1 + S.nightBurn * night);
  function tick(dt, night, storm) {
    // огонь в топке (рисование, перепись): разгорается/гаснет плавно, как у костра
    G.hut.fl = G.hut.fl == null ? (G.hut.fuel > 0 ? 1 : 0) : Fire.toward(G.hut.fl, G.hut.fuel > 0 ? 1 : 0, dt);
    if (!(G.hut.fuel > 0)) return;
    const p = G.p;
    G.hut.fuel = Math.max(0, G.hut.fuel - dt * burn(night, storm));
    if (Math.random() < dt * 3) G.parts.push({ type: 'smoke', x: HUT.x - 70 + rnd(-2, 2), y: HUT.y - 150, vx: rnd(-5, 5), vy: rnd(-30, -20), life: 3, max: 3 });
    // аккумулятор заряжается у горящей печи (в руках в избе или в лабазе)
    const battHere = p.inside ? Inv.cnt('battery', true) > 0 : (G.chest.battery || 0) > 0;
    if (battHere && G.charge < 100 && !G.flags.radioBuilt) {
      G.charge = Math.min(100, G.charge + dt * 100 / S.chargeT);
      if (G.charge >= 100) Fx.toast(':battery: Аккумулятор заряжен');
    }
  }
  return { secPerLog, maxLogs, max, add, room, burn, tick };
})();
