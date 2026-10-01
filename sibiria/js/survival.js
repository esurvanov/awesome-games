'use strict';
// Выживание: тепло тела (мороз, изба, огонь, одежда), голод, усталость, здоровье, обморожение, закалка, пар изо рта.
// Формулы — в air/rates/tireRate/body: ими же считает прогноз ночи (forecast, окно «До утра»), чтобы прогноз и жизнь не расходились.
const Survival = (() => {
  const B = TUNE.body, TI = TUNE.tire;
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
  // потеря тепла и голод в секунду; tire — усталость (вымотанный мёрзнет быстрее)
  function rates(p, T, night, sleeping, tire = G.s.tire || 0) {
    const eff = typeof Depth !== 'undefined' ? Depth.effort() : 0;
    let loss = (B.lossBase + Math.max(0, -T + B.lossFrom) * B.lossPerDeg) * Hero.clothMul() * (1 - B.coldSkill * (Hero.lvl('cold') - 1)) * Settings.diff().cold;
    if (!p.inside) loss *= 1 + B.nightLoss * night; // ночной мороз
    if (p.moving || eff > 0) loss *= B.moving * (1 + 0.5 * eff); // по пояс в снегу или с лопатой — выдыхается, потеет, мёрзнет
    if (onIce(p.x, p.y)) loss *= B.ice;
    if (p.wetT > 0) loss *= B.wet;
    if (p.teaT > 0) loss *= B.tea;
    loss *= 1 + TI.coldLoss * smooth(TI.coldFrom, 100, tire);
    if (p.doze) loss *= TI.dozeLoss; // уснул в снегу
    const hunger = (sleeping ? B.hungerSleep : (B.hunger + (p.moving || eff > 0 ? B.hungerMove * (1 + 0.5 * eff) : 0)) * (T < B.deepFrost ? B.hungerDeep : 1)) * Settings.diff().hunger;
    return { loss, hunger };
  }
  // усталость в секунду (+ рост, − отдых). s — {warm, food, frost, awake}; c — {sleeping, doze, fuel, moving, eff, over, rest (0/1/2 — restLevel), tea}
  function tireRate(s, c) {
    // дрожь — телесная (в реальных с): чем холоднее, тем быстрее выматывает; обморожение — сверху
    const shiver = TI.shiver * clamp((TI.shiverFrom - s.warm) / TI.shiverFrom, 0, 1) + TI.frost * (s.frost || 0);
    const hungry = 1 + TI.hungry * clamp((TI.hungryBelow - s.food) / TI.hungryBelow, 0, 1), diff = Settings.diff().tire || 1;
    if (c.sleeping) {
      const rest = c.doze || s.warm < TI.sleepWarm ? 0 : (c.fuel > 0 ? TI.sleep : TI.sleepCold) / HOUR;
      return shiver * hungry * diff - rest;
    }
    let up = 0;
    if (!(c.tea > 0)) { // чай: пока греет — не устаёшь
      const aw = (s.awake || 0) / HOUR;
      const warmRest = c.rest && s.warm > TI.restWarm;
      let h = TI.awake * (aw > TI.awakeFrom ? 1 + (aw - TI.awakeFrom) / TI.awakeK : 1) * (warmRest && c.rest < 2 ? TI.fireAwake : 1); // у огня стоя — бодрствование медленнее
      if (c.moving) h += (TI.walk + TI.snow * (c.eff || 0)) * (c.over ? TI.over : 1) + (c.sled || 0) * TUNE.load.sledTire * (1 + (c.eff || 0)); // нарты: +4/ч на 100 кг, по целине — больше
      up = (h / HOUR + shiver) * hungry * diff;
    }
    return up - (c.rest >= 2 && s.warm > TI.restWarm ? TI.rest / HOUR : 0); // восстановление — только сидя/в тёплой избе
  }
  // счётчик бодрствования (игровые с): во сне тает
  const awakeStep = (s, sleeping, dt) => { s.awake = sleeping ? Math.max(0, (s.awake || 0) - TI.awakeSleep * dt) : (s.awake || 0) + dt; };
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
  // работа руками (удар топором, рез, лунка, обломки) — +усталость за каждый удар; подписка — один раз
  let subbed = false;
  function sub() {
    if (subbed || typeof Interact === 'undefined') return; subbed = true;
    const add = () => { if (G && G.s) G.s.tire = Math.min(100, (G.s.tire || 0) + TI.hit * (Settings.diff().tire || 1)); };
    Interact.on('hit', e => { if (e.who === 'p') add(); });
    Interact.on('work', e => { if (e.who === 'p' && (e.what === 'buck' || e.what === 'dig' || e.what === 'wreck')) add(); });
  }
  // отдых: 2 — сидит на пне или стоит без дела в тёплой избе (печь горит) — силы восстанавливаются;
  // 1 — греет руки / стоит у огня — только бодрствование медленнее (TI.fireAwake); 0 — нет. Одна функция для игры и прогноза
  function restLevel(p, heat, fuel) {
    if (p.moving) return 0;
    const k = p.action ? p.action.k : null;
    if (k === 'rest' || (!k && p.inside && fuel > 0)) return 2;
    return k === 'warm' || (!k && heat > 0) ? 1 : 0;
  }
  function tick(dt, night) {
    const p = G.p, s = G.s;
    sub();
    if (s.tire == null) s.tire = 0;
    const { T, heat } = air(p, G.time, G.hut.fuel);
    const r = rates(p, T, night, p.sleeping || p.doze);
    const cause = body(s, heat, r, dt, Hero.maxWarm()); if (cause) G.cause = cause;
    const sl = p.sleeping || !!p.doze;
    s.tire = clamp(s.tire + tireRate(s, { sleeping: sl, doze: p.doze, fuel: p.inside ? G.hut.fuel : 0, moving: p.moving || !!(p.action && p.action.k === 'clear'),
      eff: typeof Depth !== 'undefined' ? Depth.effort() : 0, over: Inv.weight() > Inv.capKg(), sled: Carry.sledKg() / 100, rest: restLevel(p, heat, G.hut.fuel), tea: p.teaT }) * dt, 0, 100);
    awakeStep(s, p.sleeping, dt);
    dozeTick(dt, heat);
    if (s.warm < B.frostBelow) { G.frostAcc += dt; if (G.frostAcc > B.frostT && s.frost < B.frostMax) { G.frostAcc = 0; s.frost++; Fx.toast(':frost: Обморожение · макс. тепло −10'); } } else G.frostAcc = 0;
    if (s.warm < B.hardenBelow && heat === 0 && !p.inside) { G.coldAcc += dt; if (G.coldAcc > B.hardenT) { G.coldAcc = 0; Hero.xp('cold'); } }
    G.hurt = Math.max(0, (G.hurt || 0) - dt * 2); G.shake = Math.max(0, (G.shake || 0) - dt * 30);
    // дыхание на морозе
    if (!p.inside && T < -10) { p.br += dt; if (p.br > (p.moving ? 0.9 : 1.6)) { p.br = 0; breath(p.x + p.face * 6, p.y - 34, p.face, T); } }
  }
  // ---------- засыпание на морозе ----------
  // Силы на нуле (tire ≥ 90), тепло < 30, на улице без огня, стоит без дела > 4 с → края темнеют, «Не спи — замёрзнешь!»;
  // ещё 6 с без хода → уснул в снегу: тепло уходит ×1.5, голод сонный, отдыха нет. Будит удар сразу или ход, удержанный 1.2 с
  // (тяжело встать — но игрок за клавиатурой выберется). Не в избе, не у огня, не во сне. Промотку Z останавливает.
  const inputOn = () => Math.hypot(input.mx, input.my) > 0.15;
  function dozeCan(p, heat) {
    return G.s.tire >= TI.doze && G.s.warm < TI.dozeWarm && !p.inside && !p.sleeping && !p.ride && !p.ko && !(heat > 0) && !(typeof Ice !== 'undefined' && Ice.active());
  }
  function dozeTick(dt, heat) {
    const p = G.p;
    if (p.ko || p.sleeping) { p.doze = 0; p.stillT = 0; p.dozeWarn = 0; return; }
    if (p.doze) {
      p.cd = Math.max(p.cd || 0, 0.3); p.action = null;
      p.dozeHold = inputOn() ? (p.dozeHold || 0) + dt : 0;
      if (G.hurt > 0.5 || p.dozeHold >= TI.dozeWake) { p.doze = 0; p.stillT = 0; p.dozeWarn = 0; p.dozeHold = 0; Fx.toast(':sleep: Очнулся — вставай, к огню!'); if (typeof Hero !== 'undefined') Hero.snap(); }
      return;
    }
    if (!dozeCan(p, heat) || p.moving || p.action || inputOn()) { p.stillT = 0; p.dozeWarn = 0; return; }
    p.stillT = (p.stillT || 0) + dt;
    if (p.stillT > TI.dozeStill && !p.dozeWarn) {
      p.dozeWarn = 1; Fx.toast(':sleep: Не спи — замёрзнешь!');
      if (typeof Actions !== 'undefined' && Actions.skipping()) Actions.skipStop();
    }
    if (p.stillT > TI.dozeStill + TI.dozeT) { p.doze = 1; p.dozeHold = 0; Fx.toast(':sleep: Уснул в снегу…'); }
  }
  // 0..1 — насколько темнеют края (предупреждение и сон в снегу)
  const dozeFx = () => { const p = G.p; return p.doze ? 1 : p.dozeWarn ? clamp((p.stillT - TI.dozeStill) / TI.dozeT, 0.25, 0.9) : 0; };
  // прогноз до утра (окно «До утра»): те же формулы шагом HOUR/60 по копиям тепла, еды, сил, печи и костров. Герой стоит.
  // sleeping — на лежанке (сонный голод; погасшая печь будит → прогноз до этого часа). Итог: {to, warm, food, hp, tire,
  // coldAt, hungryAt, fuelAt, deadAt, cause, wakeAt}: *At — игровое время события (null — не случится)
  function forecast(sleeping) {
    const p = G.p, hero = { x: p.x, y: p.y, inside: p.inside, moving: false, teaT: p.teaT || 0, wetT: p.wetT || 0 }, DT = HOUR / 60;
    const to = G.time + ((TUNE.time.wakeAt - hourOf() + 24) % 24) * HOUR;
    const s = { warm: G.s.warm, food: G.s.food, hp: G.s.hp, tire: G.s.tire || 0, awake: G.s.awake || 0, frost: G.s.frost };
    const mine = new Set(G.fires), fires = Fire.burning().map(f => Object.assign({}, f, { own: mine.has(f) })); // own — костёр (горит по Fire.burn), куча — 1 с/с
    let fuel = G.hut.fuel, acc = G.frostAcc, t = G.time;
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
      const c = body(s, heat, rates(hero, T, night, sleeping, s.tire), DT, 100 - B.frostWarm * s.frost);
      s.tire = clamp(s.tire + tireRate(s, { sleeping, fuel: p.inside ? fuel : 0, rest: restLevel(hero, heat, fuel), tea: hero.teaT }) * DT, 0, 100);
      hero.teaT = Math.max(0, hero.teaT - DT); hero.wetT = Math.max(0, hero.wetT - DT);
      awakeStep(s, sleeping, DT);
      if (s.warm < B.frostBelow) { acc += DT; if (acc > B.frostT && s.frost < B.frostMax) { acc = 0; s.frost++; } } else acc = 0;
      if (s.warm <= 0 && o.coldAt == null) o.coldAt = t;
      if (s.food <= 0 && o.hungryAt == null) o.hungryAt = t;
      if (c) o.cause = c;
      if (s.hp <= 0) { o.deadAt = t; break; }
      t += DT;
    }
    return Object.assign(o, { warm: s.warm, food: s.food, tire: s.tire, hp: Math.max(0, s.hp), at: t });
  }
  return { tick, air, rates, tireRate, restLevel, body, forecast, dozeFx };
})();
