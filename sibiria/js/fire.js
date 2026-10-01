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
  function lightStack(s, sec) { s.lit = sec; s.wood = 0; Fx.toast(':fire: Куча горит'); Sound.ok2(); Fx.burst(s.x, s.y - 20, 20, '#ffb347', 140); }
  // тепло от ближайшего огня (0 — нет); list — свой список огней (прогноз ночи), по умолчанию — горящие сейчас
  function heatAt(p, heat, list = burning()) {
    for (const f of list) { if (!(f.fuel > 0)) continue;
      const r = f.stack ? F.stackHeatR : F.heatR, dd = dist(f, p);
      if (dd < r) heat = Math.max(heat, F.heatBase + F.heatK * (1 - dd / r));
    }
    return heat;
  }
  // расход топлива костра, с/с (тик и прогноз ночи — одна формула)
  const burn = (f, night, storm) => (storm ? F.stormBurn : 1) * (1 + F.nightBurn * night) * (f.burn || (f.burn = Zones.ruleAt(f.x, f.y, 'burn')));
  function tick(dt, night, storm) {
    for (const f of G.fires) if (f.fuel > 0) {
      f.fuel = Math.max(0, f.fuel - dt * burn(f, night, storm));
      if (Math.random() < dt * 7) G.parts.push({ type: 'spark', x: f.x + rnd(-6, 6), y: f.y - 14, vx: rnd(-15, 15), vy: rnd(-80, -40), life: rnd(0.5, 1), max: 1, g: -10 });
      if (Math.random() < dt * 3) G.parts.push({ type: 'smoke', x: f.x, y: f.y - 24, vx: rnd(-6, 6), vy: rnd(-30, -18), life: 2.5, max: 2.5 });
    }
    for (const st of G.stacks) if (st.lit > 0) {
      st.lit = Math.max(0, st.lit - dt);
      if (Math.random() < dt * 14) G.parts.push({ type: 'spark', x: st.x + rnd(-12, 12), y: st.y - 24, vx: rnd(-20, 20), vy: rnd(-120, -60), life: rnd(0.6, 1.2), max: 1.2, g: -10 });
      if (Math.random() < dt * 8) G.parts.push({ type: 'smoke', x: st.x, y: st.y - 40, vx: rnd(-8, 8), vy: rnd(-45, -25), life: 3.5, max: 3.5, big: 1 });
    }
  }
  // на рассвете гаснут забытые далёкие костры
  function dawn() { G.fires = G.fires.filter(f => f.fuel > 0 || dist2(f, G.p) < TUNE.r.fireKeep * TUNE.r.fireKeep); }
  return { fearR, burning, near, protection, lightStack, heatAt, burn, tick, dawn };
})();

// Печь: полено даёт secPerLog() секунд огня (щели и заслонка — дольше); ночью горит быстрее.
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
  function add() {
    if (G.hut.fuel > max() - secPerLog() * S.fullSlack) return Fx.toast(':stove: Печь полна');
    if (!Inv.takeStock('wood', 1)) return Fx.toast(':close: Не хватает: :wood:1 (в руках или в лабазе)');
    G.hut.fuel += secPerLog(); G.flags.stoveLit = 1; Fx.floatText(SPOT.stove.x, SPOT.stove.y - 30, `:fire: +${secPerLog()} с`); Sound.chop();
  }
  // расход печи, с/с (тик и прогноз ночи — одна формула)
  const burn = (night, storm) => (storm && !G.hut.walls ? S.stormDraft : 1) * (1 + S.nightBurn * night);
  function tick(dt, night, storm) {
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
  return { secPerLog, maxLogs, max, add, burn, tick };
})();
