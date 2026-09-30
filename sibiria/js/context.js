'use strict';
// Ctx — общая сводка «где герой и что вокруг». Один источник для реплик (barks.js), тостов событий (content/events.js,
// director.js), склейки тостов (ui.js), рендера (gfx.js: снег в избе, свет, позы против ветра) и звука (audio.js — место).
// Раньше каждый проверял свой один признак («ночь → к огню», «день 1 ночь → далеко воют») и не знал, что герой у горящей печи
// или что стая в десяти метрах. Теперь признак выбирается из сводки.
//
//   Ctx.now()          → сводка на этот момент (кэш: пока не сдвинулись время игры и герой)
//     .inside            в избе;   .stove — печь горит;  .byStove — в избе у горящей печи
//     .fire              ближайший горящий огонь снаружи {x, y, d} | null; .atFire — греется у огня (d < heatR)
//     .warmSrc           'stove' | 'fire' | null — у чего греется;  .shelter — в тепле (у печи / у огня)
//     .h .phase          час и часть суток: 'night' | 'dawn' | 'morning' | 'day' | 'evening' | 'dusk'
//     .night .daylight   0..1;  .dark — темно (daylight < 0.3)
//     .storm .stormSoon  пурга идёт / небо сереет (до пурги ≤ omenT);  .weather — 'storm' | 'grey' | 'calm'
//     .wind              { ms, dir, gust, bf } у героя;  .temp — °C
//     .wolf .bear .deer .hare   ближайший зверь {o, x, y, d} | null;  .wolves — сколько волков ближе 600
//     .light             0..1 — свет у героя от реальных источников (день, огонь, печь, факел, окно, луна слабо)
//     .wet .cold .freezing .frost   мокрый / зябнет (тепло < 30) / замерзает (< 20) / обморожение 0..1
//     .onIce .inWater    на льду реки / в промоине, полынье
//     .people .nearNpc   люди рядом (≤ 200: посёлок + зоны), ближайший NPC {id, d} | null
//     .zone .terrain     id зоны и местность под ногами
//   Ctx.dist(x, y)       → расстояние от героя (px; 10 px ≈ 1 м — масштаб подписей «м»)
//   Ctx.near(d)          → 'here' (< 60) | 'close' (< 250) | 'near' (< 700) | 'far'
//   Ctx.howl(d, many)    → строка тоста о вое по дистанции до стаи (d в px; null — стаи нет, воют далеко)
//   Ctx.howlSrc(R)       → откуда слышен вой {x, y, d}: ближайший волк или точка за R px (d = null)
//   Ctx.reset()          → сбросить кэш (тесты)
const Ctx = (() => {
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  let C = null, kG = null, kT = NaN, kX = NaN, kY = NaN, kF = NaN, kN = NaN;
  const ok = () => typeof G !== 'undefined' && G && G.p;
  function nearest(list, p, R) { let b = null, bd = R * R; for (const o of list || []) { if (!o) continue; const d = (o.x - p.x) ** 2 + (o.y - p.y) ** 2; if (d < bd) { bd = d; b = o; } } return b ? { o: b, x: b.x, y: b.y, d: Math.sqrt(bd) } : null; }
  function phaseOf(h) { return h < 5 ? 'night' : h < 7.5 ? 'dawn' : h < 11 ? 'morning' : h < 16 ? 'day' : h < 18.5 ? 'evening' : h < 20.5 ? 'dusk' : 'night'; }
  function build() {
    const p = G.p, s = G.s || {}, T = typeof TUNE !== 'undefined' ? TUNE : {};
    const inside = !!p.inside, stove = !!(G.hut && G.hut.fuel > 0);
    const sR = (T.life && T.life.stoveR) || 64;
    const byStove = inside && stove && typeof SPOT !== 'undefined' && (SPOT.stove.x - p.x) ** 2 + (SPOT.stove.y - p.y) ** 2 < (sR * 2.2) ** 2;
    let fire = null;
    if (typeof Fire !== 'undefined' && G.fires) { const f = nearest(Fire.burning(), p, 900); if (f) fire = { x: f.x, y: f.y, d: f.d, o: f.o }; }
    const heatR = (T.fire && T.fire.heatR) || 140, atFire = !inside && !!fire && fire.d < heatR;
    const h = typeof hourOf === 'function' ? hourOf() : 12, dl = typeof daylight === 'function' ? daylight(h) : 1;
    const storm = typeof stormOn === 'function' ? stormOn() : false;
    const S = G.storm, omen = (T.storm && T.storm.omenT) || 40, stormSoon = !storm && !!(S && G.time < S.a && G.time > S.a - omen * 1.5);
    let wind = { ms: 0, dir: 0, gust: 0, bf: 0 };
    if (typeof Wind !== 'undefined') { const w = Wind.at(p.x, p.y); wind = { ms: w.ms, dir: w.dir, gust: w.gust, bf: Wind.beaufort(w.ms) }; }
    const wolf = nearest(G.wolves, p, 5000);
    let wolves = 0; for (const w of G.wolves || []) if ((w.x - p.x) ** 2 + (w.y - p.y) ** 2 < 600 * 600) wolves++;
    const bear = G.bear ? nearest([G.bear], p, 1e5) : null;
    // свет у героя: день, огонь по расстоянию (мягкий спад), печь в избе, факел, окно избы снаружи ночью, луна — слабо
    const lit = [dl, 0.08 * (1 - dl) * (storm ? 0.3 : 1)];
    if (fire) lit.push(sm(420, 60, fire.d));
    if (inside && stove) lit.push(0.85);
    if (p.torch > 0) lit.push(0.8);
    if (!inside && stove && typeof HUT !== 'undefined') { const d = Math.hypot(HUT.x - p.x, HUT.y + 60 - p.y); lit.push(0.5 * sm(260, 60, d)); }
    const light = Math.min(1, Math.max(...lit));
    let people = 0, nearNpc = null;
    if (typeof Npc !== 'undefined' && Npc.list) for (const n of Npc.list()) { const st = n.st; if (!st) continue; const d = Math.hypot(st.x - p.x, st.y - p.y); if (d < 200) people++; if (!nearNpc || d < nearNpc.d) nearNpc = { id: n.id, d }; }
    if (G.col) for (const u of G.col.units) if (!u.hidden && u.type !== 'laika' && (u.x - p.x) ** 2 + (u.y - p.y) ** 2 < 200 * 200) people++;
    const onI = !inside && typeof onIce === 'function' && onIce(p.x, p.y);
    let inWater = false;
    if (!inside && typeof POI !== 'undefined' && POI.polynya && Math.hypot(p.x - POI.polynya.x, p.y - POI.polynya.y) < 34) inWater = true;
    if (!inside && typeof Zones !== 'undefined' && Zones.OBJS) for (const o of Zones.OBJS) if (o.type === 'steam' && (o.x - p.x) ** 2 + (o.y - p.y) ** 2 < 30 * 30) inWater = true;
    const warm = s.warm == null ? 100 : s.warm;
    return {
      inside, stove, byStove, fire, atFire, warmSrc: byStove || (inside && stove) ? 'stove' : atFire ? 'fire' : null,
      shelter: (inside && stove) || atFire,
      h, phase: phaseOf(h), night: 1 - dl, daylight: dl, dark: dl < 0.3,
      storm, stormSoon, weather: storm ? 'storm' : stormSoon ? 'grey' : 'calm', wind,
      temp: typeof temperature === 'function' ? temperature() : -20,
      wolf, wolves, bear, deer: nearest(G.deer, p, 3000), hare: nearest(G.hares, p, 1500),
      light, wet: p.wetT > 0, cold: warm < 30, freezing: warm < 20, frost: Math.max(0, Math.min(1, (30 - warm) / 30)),
      onIce: onI, inWater, people, nearNpc,
      zone: typeof Zones !== 'undefined' && Zones.idAt ? Zones.idAt(p.x, p.y) : null,
      terrain: typeof Zones !== 'undefined' && Zones.terrainKey ? Zones.terrainKey(p.x, p.y) : null,
    };
  }
  function now() {
    if (!ok()) return null;
    const p = G.p, f = G.hut ? G.hut.fuel > 0 : 0, n = (G.wolves ? G.wolves.length : 0) + (G.bear ? 100 : 0);
    if (C && G === kG && G.time === kT && p.x === kX && p.y === kY && f === kF && n === kN) return C;
    kG = G; kT = G.time; kX = p.x; kY = p.y; kF = f; kN = n;
    return (C = build());
  }
  const dist = (x, y) => (ok() ? Math.hypot(x - G.p.x, y - G.p.y) : Infinity);
  const near = d => (d < 60 ? 'here' : d < 250 ? 'close' : d < 700 ? 'near' : 'far');
  // вой — по дистанции до стаи: в десяти метрах «далеко воют» не скажешь
  function howl(d, many) {
    const k = d == null ? 'far' : near(d);
    return {
      here: ':wolf: Волки рядом! Вой над ухом',
      close: many ? ':wolf: Воют совсем близко. Стая' : ':wolf: Воет совсем близко',
      near: many ? ':wolf: Воют близко. Много' : ':wolf: Вой. Близко',
      far: many ? ':wolf: Далеко воют. Много' : ':wolf: Далеко воет волк',
    }[k];
  }
  // откуда слышен вой: ближайший волк; нет волков — точка вдали по направлению директора угроз (или северо-запад), R px
  function howlSrc(R = 1400) {
    if (!ok()) return { x: 0, y: 0, d: null };
    const p = G.p, w = nearest(G.wolves, p, 5000);
    if (w) return { x: w.x, y: w.y, d: w.d };
    const a = G.D && G.D.dir != null && G.D.dir !== 0 ? G.D.dir : -2.6;
    return { x: p.x + Math.cos(a) * R, y: p.y + Math.sin(a) * R, d: null };
  }
  function reset() { C = null; kG = null; }
  return { now, dist, near, howl, howlSrc, reset, phaseOf };
})();
