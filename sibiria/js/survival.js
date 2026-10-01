'use strict';
// Выживание: тепло тела (мороз, изба, огонь, одежда), голод, здоровье, обморожение, закалка, пар изо рта.
// Формулы — в air/rates/body: ими же считает прогноз ночи (forecast, окно «До утра»), чтобы прогноз и жизнь не расходились.
const Survival = (() => {
  const B = TUNE.body;
  // воздух у героя (°, с поправкой на избу) и тепло печи/огня; t — время, fuel — печь, fires — огни (прогноз — свои)
  function air(p, t, fuel, fires) {
    const S = TUNE.stove;
    let T = temperature(t) * Zones.rule('cold'), heat = 0;
    // изба держит тепло, пока горит печь; холодная изба — почти улица
    if (p.inside) {
      if (fuel > 0) { T += G.hut.walls ? S.insideLit.walls : S.insideLit.base; heat = G.hut.damper ? S.heat.damper : G.hut.walls ? S.heat.walls : S.heat.base; }
      else T += G.hut.walls ? S.insideCold.walls : S.insideCold.base;
    }
    return { T, heat: Fire.heatAt(p, heat, fires) };
  }
  // потеря тепла и голод в секунду
  function rates(p, T, night, sleeping) {
    const eff = typeof Depth !== 'undefined' ? Depth.effort() : 0;
    let loss = (B.lossBase + Math.max(0, -T + B.lossFrom) * B.lossPerDeg) * Hero.clothMul() * (1 - B.coldSkill * (Hero.lvl('cold') - 1)) * Settings.diff().cold;
    if (!p.inside) loss *= 1 + B.nightLoss * night; // ночной мороз
    if (p.moving) loss *= B.moving * (1 + 0.5 * eff); // по пояс в снегу — выдыхается, потеет, мёрзнет if (onIce(p.x, p.y)) loss *= B.ice; if (p.wetT > 0) loss *= B.wet; if (p.teaT > 0) loss *= B.tea;
    const hunger = (sleeping ? B.hungerSleep : (B.hunger + (p.moving ? B.hungerMove * (1 + 0.5 * eff) : 0)) * (T < B.deepFrost ? B.hungerDeep : 1)) * Settings.diff().hunger;
    return { loss, hunger };
  }
  // тело за шаг dt: тепло, еда, урон от холода/голода, восстановление; вернёт причину урона (или null)
  function body(s, heat, r, dt, maxWarm) {
    let cause = null;
    s.warm = clamp(s.warm + (heat - r.loss) * dt, 0, maxWarm);
    s.food = clamp(s.food - r.hunger * dt, 0, 100);
    if (s.warm <= 0) { s.hp -= B.coldDmg * dt; cause = 'cold'; }
    if (s.food <= 0) { s.hp -= B.foodDmg * dt; if (s.warm > 0) cause = 'food'; }
    if (s.warm > B.regenWarm && s.food > B.regenFood) s.hp = Math.min(100, s.hp + B.regen * dt);
    return cause;
  }
  function tick(dt, night) {
    const p = G.p, s = G.s;
    const { T, heat } = air(p, G.time, G.hut.fuel);
    const r = rates(p, T, night, p.sleeping);
    const cause = body(s, heat, r, dt, Hero.maxWarm()); if (cause) G.cause = cause;
    if (s.warm < B.frostBelow) { G.frostAcc += dt; if (G.frostAcc > B.frostT && s.frost < B.frostMax) { G.frostAcc = 0; s.frost++; Fx.toast(':frost: Обморожение · макс. тепло −10'); } } else G.frostAcc = 0;
    if (s.warm < B.hardenBelow && heat === 0 && !p.inside) { G.coldAcc += dt; if (G.coldAcc > B.hardenT) { G.coldAcc = 0; Hero.xp('cold'); } }
    G.hurt = Math.max(0, (G.hurt || 0) - dt * 2); G.shake = Math.max(0, (G.shake || 0) - dt * 30);
    // дыхание на морозе
    if (!p.inside && T < -10) { p.br += dt; if (p.br > (p.moving ? 0.9 : 1.6)) { p.br = 0; breath(p.x + p.face * 6, p.y - 34, p.face, T); } }
  }
  // прогноз до утра (окно «До утра»): те же формулы шагом 1 с по копиям тепла, еды, печи и костров. Герой стоит.
  // sleeping — на лежанке (сонный голод; погасшая печь будит → прогноз до этого часа). Итог: {to, warm, food, hp,
  // coldAt, hungryAt, fuelAt, deadAt, cause, wakeAt}: *At — игровое время события (null — не случится)
  function forecast(sleeping) {
    const p = G.p, hero = { x: p.x, y: p.y, inside: p.inside, moving: false }, DT = 1;
    const to = G.time + ((TUNE.time.wakeAt - hourOf() + 24) % 24) * CYCLE / 24;
    const s = { warm: G.s.warm, food: G.s.food, hp: G.s.hp };
    const mine = new Set(G.fires), fires = Fire.burning().map(f => Object.assign({}, f, { own: mine.has(f) })); // own — костёр (горит по Fire.burn), куча — 1 с/с
    let fuel = G.hut.fuel, frost = G.s.frost, acc = G.frostAcc, t = G.time;
    const o = { to, coldAt: null, hungryAt: null, fuelAt: null, deadAt: null, wakeAt: null, cause: null };
    const heatSrc = () => (p.inside ? fuel > 0 : false) || Fire.heatAt(hero, 0, fires) > 0;
    const hadHeat = heatSrc();
    while (t < to) {
      const h = hourOf(t), night = 1 - daylight(h), storm = stormOn(t);
      if (fuel > 0) { fuel = Math.max(0, fuel - DT * Stove.burn(night, storm)); if (fuel <= 0 && p.inside && o.fuelAt == null) o.fuelAt = t; }
      for (const f of fires) if (f.fuel > 0 && !f.tower) f.fuel = Math.max(0, f.fuel - DT * (f.own ? Fire.burn(f, night, storm) : 1));
      if (!p.inside && hadHeat && o.fuelAt == null && !heatSrc()) o.fuelAt = t;
      if (sleeping && fuel <= 0) { o.wakeAt = t; break; } // печь погасла — разбудит
      const { T, heat } = air(hero, t, fuel, fires);
      const c = body(s, heat, rates(hero, T, night, sleeping), DT, 100 - B.frostWarm * frost);
      if (s.warm < B.frostBelow) { acc += DT; if (acc > B.frostT && frost < B.frostMax) { acc = 0; frost++; } } else acc = 0;
      if (s.warm <= 0 && o.coldAt == null) o.coldAt = t;
      if (s.food <= 0 && o.hungryAt == null) o.hungryAt = t;
      if (c) o.cause = c;
      if (s.hp <= 0) { o.deadAt = t; break; }
      t += DT;
    }
    return Object.assign(o, { warm: s.warm, food: s.food, hp: Math.max(0, s.hp), at: t });
  }
  return { tick, air, rates, body, forecast };
})();
