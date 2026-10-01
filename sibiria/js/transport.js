'use strict';
// Транспорт (A7): лыжи → упряжка (аренда у стойбища / у деда) и «Буран» (починка на буровой, керосин);
// множитель местности (TERRAIN), быстрый переход между открытыми зонами (время, еда, тепло).
// Состояние: G.veh = { deer: {x, y, face, until} | null, buran: {x, y, face, fixed, fuel} | null }, G.p.ride = null | 'deer' | 'buran'.
const Transport = (() => {
  const T = TUNE.tr;
  function initState() {
    G.veh = G.veh || { deer: null, buran: null };
    if (!G.veh.buran && Zones.obj('buranSpot')) { const s = Zones.obj('buranSpot'); G.veh.buran = { x: s.x, y: s.y, face: 1, fixed: 0, fuel: 0 }; }
  }
  // способ передвижения героя сейчас
  const mode = () => G.p.ride || (G.gear.skis && !G.p.skiOff ? 'ski' : 'walk');
  const BASE = { walk: () => TUNE.hero.speed, ski: () => TUNE.hero.speed, deer: () => T.deer, buran: () => T.buran };
  // скорость способа m на поверхности ter (px/с; 0 — не пройти)
  function speedOn(m, ter) {
    if (m === 'ski' && !ter.ski) m = 'walk';
    return BASE[m]() * ter[m];
  }
  const label = { deer: 'Сесть в нарты :deer:', buran: 'Сесть на «Буран» :sled:' };

  // ---------- что рядом ----------
  function context(p) {
    if (!G.veh) return null;
    if (p.ride) return { k: 'veh', label: p.ride === 'deer' ? 'Слезть с нарт' : 'Заглушить «Буран»' };
    const R = T.rideR * T.rideR, d = G.veh.deer, b = G.veh.buran;
    if (d && dist2(d, p) < R) return { k: 'veh', label: label.deer, o: 'deer' };
    if (b && dist2(b, p) < R) {
      if (!b.fixed) return { k: 'vfix', label: 'Починить «Буран» · :scrap:3 :cable:1' };
      if (Inv.has('kero', false) && b.fuel < T.buranPx * 0.4) return { k: 'vfuel', label: 'Заправить :kero:' };
      if (b.fuel <= 0) return { k: 'vfuel', label: 'Нужен :kero:' };
      return { k: 'veh', label: label.buran, o: 'buran' };
    }
    return null;
  }
  // нарты у чума деда: упряжка в аренду при уважении ≥ 1 (после разговора с дедом в очереди контекста)
  const URK_SLED = { x: POI.chum.x + 80, y: POI.chum.y + 120 };
  function urkContext(p) {
    if (!G.veh || G.veh.deer || !G.urk || G.urk.state === 'away' || (G.urk.respect || 0) < 1 || dist2(URK_SLED, p) > 50 * 50) return null;
    return rentContext({ id: 'urk', x: URK_SLED.x, y: URK_SLED.y, urk: 1 });
  }
  function rentContext(o) {
    if (G.veh.deer) return { k: 'inspect', label: 'Осмотреть :deer:', o: { i: ':deer:', t: 'Упряжка уже у тебя. Олени помнят дорогу домой.' } };
    const cost = o.urk ? T.urkRent : T.deerRent;
    return { k: 'rent', label: 'Упряжка · ' + Object.entries(cost).map(([k, v]) => ITEMS[k].i + v).join(' '), o };
  }
  function act(c) {
    const p = G.p;
    if (c.k === 'veh') { if (p.ride) dismount(); else mount(c.o); return; }
    if (c.k === 'vfix') {
      if (!Inv.canPay(T.fix, false)) return Fx.toast(':close: Не хватает: :scrap:3 :cable:1');
      p.action = { k: 'vfix', t: 0, dur: T.fixT }; return;
    }
    if (c.k === 'vfuel') {
      if (!Inv.take('kero', 1, false)) return Fx.toast(':close: Нужен :kero: · буровая, «Урал», хвост');
      G.veh.buran.fuel += T.buranPx; Fx.toast(':kero: Бак полон · ~' + Math.round(G.veh.buran.fuel / 825) + ' км'); Sound.ok2(); return;
    }
    if (c.k === 'rent') rent(c.o);
  }
  function rent(o) {
    const cost = o.urk ? T.urkRent : T.deerRent;
    if (!Inv.canPay(cost, false)) return Fx.toast(':close: Не хватает: ' + Object.entries(cost).map(([k, v]) => ITEMS[k].i + v).join(' '));
    Inv.pay(cost, false);
    G.veh.deer = { x: o.x + 70, y: o.y + 60, face: 1, until: G.day + T.deerDays };
    Fx.toast(`:deer: Упряжка твоя до утра ${G.day + T.deerDays}-го дня`); Sound.ok2();
  }
  function fixDone() {
    if (!Inv.canPay(T.fix, false)) return;
    Inv.pay(T.fix, false); G.veh.buran.fixed = 1;
    Fx.toast(':sled: «Буран» ожил! Нужен :kero:'); Sound.ok2();
  }
  function mount(kind) {
    const p = G.p, v = G.veh[kind]; if (!v) return;
    p.ride = kind; p.x = v.x; p.y = v.y; p.action = null; Hero.snap();
    Fx.toast(kind === 'deer' ? ':deer: В нартах · E — слезть' : ':sled: «Буран» заведён · E — заглушить'); Sound.pick();
  }
  // слезть: транспорт остаётся на месте; msg — почему (дальше не пройти, бензин кончился)
  function dismount(msg) {
    const p = G.p, v = G.veh[p.ride];
    if (v) { v.x = p.x; v.y = p.y; v.face = p.face; }
    p.ride = null; p.y += 24; Hero.snap(); // сошёл на снег у транспорта (сам транспорт — преграда, js/content/footprints.js)
    if (msg) Fx.toast(msg);
  }
  // шаг движения верхом: транспорт идёт с героем, «Буран» тратит бензин, в запретную местность не въехать
  function moved(ox, oy) {
    const p = G.p; if (!p.ride) return;
    const v = G.veh[p.ride];
    if (!speedOn(p.ride, Zones.terrainAt(p.x, p.y))) { p.x = ox; p.y = oy; dismount(ZONE_TXT.vehStop[v === G.veh.deer ? 'deer' : 'buran']); return; }
    // олени чуют тонкий лёд и воду переката — встают у кромки (въехать нельзя; «Буран» не чует — js/world.js thinIce)
    if (p.ride === 'deer' && (World.onThinIce(p) || Ice.inWater(p.x, p.y)) && !World.onThinIce({ x: ox, y: oy })) {
      p.x = ox; p.y = oy; p.vx = p.vy = 0;
      if (Math.abs(G.time - (p.deerBalk || -99)) > 4) { p.deerBalk = G.time; Fx.toast(':deer: Олени упёрлись — тонкий лёд'); }
      return;
    }
    const d = Math.hypot(p.x - ox, p.y - oy);
    v.x = p.x; v.y = p.y; v.face = p.face;
    if (p.ride === 'buran') { v.fuel = Math.max(0, v.fuel - d); if (v.fuel <= 0) dismount(ZONE_TXT.noFuel); }
  }
  // полночь/шаг: аренда упряжки кончилась — олени уходят
  function tick() {
    const d = G.veh && G.veh.deer;
    if (d && G.day >= d.until && hourOf() >= TUNE.time.wakeAt) {
      if (G.p.ride === 'deer') dismount();
      G.veh.deer = null; Fx.toast(ZONE_TXT.deerGone);
    }
  }

  // ---------- быстрый переход (A7): по карте, между открытыми зонами ----------
  // куда можно: зоны, где герой уже был (и зимовье)
  const open = id => id === 'core' || (G.zoneSeen && G.zoneSeen[id] === 1);
  function why(id) {
    const z = ZONES[id]; if (!z || (!z.core && !z.active)) return 'нет такой зоны';
    if (!open(id)) return 'сначала дойди сам';
    if (Zones.idAt(G.p.x, G.p.y) === id) return 'ты уже здесь';
    if (daylight() < 0.5) return 'ночью не пройти';
    if (stormOn()) return 'пурга';
    if (G.wolves.some(w => dist2(w, G.p) < T.travel.wolfR * T.travel.wolfR)) return 'волки рядом';
    if (G.bear && G.bear.st !== 'gone' && dist2(G.bear, G.p) < T.travel.wolfR * T.travel.wolfR) return 'шатун рядом';
    if (G.p.inside || G.p.sleeping || G.p.action) return 'занят';
    return null;
  }
  // цена перехода: игровые секунды, еда, тепло (сколько бы ушло в пути по целине)
  function cost(id) {
    const z = ZONES[id], c = Zones.camp(z), p = G.p, dist_ = Math.hypot(c.x - p.x, c.y - p.y) * T.travel.wind;
    const sp = speedOn(mode(), TERRAIN.taiga) || TUNE.hero.speed * TERRAIN.taiga.walk;
    const t = Math.min(dist_ / sp, CYCLE * T.travel.maxH / 24);
    const B = TUNE.body, hunger = (B.hunger + B.hungerMove) * Settings.diff().hunger;
    const loss = (B.lossBase + Math.max(0, -temperature() + B.lossFrom) * B.lossPerDeg) * Hero.clothMul() * B.moving * Settings.diff().cold * (p.ride ? 1.15 : 1);
    return { t, food: Math.round(hunger * t * T.travel.foodK), warm: Math.round(loss * t * 0.35), x: c.x, y: c.y, h: t / CYCLE * 24, km: dist_ / 825 };
  }
  function travel(id) {
    const w = why(id); if (w) { Fx.toast(':close: Переход: ' + w); return false; }
    const c = cost(id), p = G.p;
    G.time += c.t;
    G.s.food = Math.max(0, G.s.food - c.food);
    G.s.warm = Math.max(Math.min(G.s.warm, TUNE.tr.travel.warmMin), G.s.warm - c.warm);
    p.x = c.x; p.y = c.y; p.sx = p.x - 30; p.sy = p.y; p.action = null; Hero.snap();
    if (p.ride) { const v = G.veh[p.ride]; v.x = p.x; v.y = p.y; if (p.ride === 'buran') v.fuel = Math.max(1, v.fuel - c.km * 825 / T.travel.wind); }
    // спутники: Вера идёт следом, лайки посёлка — тоже
    if (G.vera && G.vera.state === 'follow') { G.vera.x = p.x - 30; G.vera.y = p.y + 10; }
    if (G.col) for (const u of G.col.units) if (u.pet) { u.x = p.x + 30; u.y = p.y + 10; }
    G.wolves = G.wolves.filter(w0 => dist2(w0, p) < 900 * 900); if (!G.wolves.length) G.pack = null;
    World.reveal(); GFX.recenter();
    Fx.toast(`:timer: В пути ${Math.floor(c.h)} ч ${Math.round(c.h % 1 * 60)} мин · :food: −${c.food} · :warm: −${c.warm}`);
    return true;
  }
  return { initState, mode, speedOn, context, urkContext, rentContext, act, fixDone, mount, dismount, moved, tick, open, why, cost, travel };
})();
