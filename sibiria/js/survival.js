'use strict';
// Выживание: тепло тела (мороз, изба, огонь, одежда), голод, здоровье, обморожение, закалка, пар изо рта.
const Survival = (() => {
  const B = TUNE.body;
  function tick(dt, night) {
    const p = G.p, s = G.s, S = TUNE.stove;
    let T = temperature() * Zones.rule('cold'), heat = 0;
    // изба держит тепло, пока горит печь; холодная изба — почти улица
    if (p.inside) {
      if (G.hut.fuel > 0) { T += G.hut.walls ? S.insideLit.walls : S.insideLit.base; heat = G.hut.damper ? S.heat.damper : G.hut.walls ? S.heat.walls : S.heat.base; }
      else T += G.hut.walls ? S.insideCold.walls : S.insideCold.base;
    }
    heat = Fire.heatAt(p, heat);
    let loss = (B.lossBase + Math.max(0, -T + B.lossFrom) * B.lossPerDeg) * Hero.clothMul() * (1 - B.coldSkill * (Hero.lvl('cold') - 1)) * Settings.diff().cold;
    if (!p.inside) loss *= 1 + B.nightLoss * night; // ночной мороз
    if (p.moving) loss *= B.moving * (1 + 0.5 * (typeof Depth !== 'undefined' ? Depth.effort() : 0)); // по пояс в снегу — выдыхается, потеет, мёрзнет if (onIce(p.x, p.y)) loss *= B.ice; if (p.wetT > 0) loss *= B.wet; if (p.teaT > 0) loss *= B.tea;
    s.warm = clamp(s.warm + (heat - loss) * dt, 0, Hero.maxWarm());
    if (s.warm < B.frostBelow) { G.frostAcc += dt; if (G.frostAcc > B.frostT && s.frost < B.frostMax) { G.frostAcc = 0; s.frost++; Fx.toast(':frost: Обморожение · макс. тепло −10'); } } else G.frostAcc = 0;
    if (s.warm < B.hardenBelow && heat === 0 && !p.inside) { G.coldAcc += dt; if (G.coldAcc > B.hardenT) { G.coldAcc = 0; Hero.xp('cold'); } }
    const hunger = (p.sleeping ? B.hungerSleep : (B.hunger + (p.moving ? B.hungerMove * (1 + 0.5 * (typeof Depth !== 'undefined' ? Depth.effort() : 0)) : 0)) * (T < B.deepFrost ? B.hungerDeep : 1)) * Settings.diff().hunger;
    s.food = clamp(s.food - hunger * dt, 0, 100);
    if (s.warm <= 0) { s.hp -= B.coldDmg * dt; G.cause = 'cold'; }
    if (s.food <= 0) { s.hp -= B.foodDmg * dt; if (s.warm > 0) G.cause = 'food'; }
    if (s.warm > B.regenWarm && s.food > B.regenFood) s.hp = Math.min(100, s.hp + B.regen * dt);
    G.hurt = Math.max(0, (G.hurt || 0) - dt * 2); G.shake = Math.max(0, (G.shake || 0) - dt * 30);
    // дыхание на морозе
    if (!p.inside && T < -10) { p.br += dt; if (p.br > (p.moving ? 0.9 : 1.6)) { p.br = 0; breath(p.x + p.face * 6, p.y - 34, p.face, T); } }
  }
  return { tick };
})();
