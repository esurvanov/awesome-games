'use strict';
// Зоны мира: карта зон, поверхность, правила, опасности, объекты (данные — js/content/zones.js).
// Карта зон — сетка 64 px: номер зоны, «глубина» (0..255, мягкая граница в рисунке) и поверхность (TERRAIN).
// Считается от якорей (ручной скелет A3) + шум simplex от G.seed (Zones.build — в начале World.gen). В сейв не идёт.
const Zones = (() => {
  const C = 64, NX = Math.ceil(W / C), NY = Math.ceil(H / C), NC = NX * NY;
  const ZID = new Uint8Array(NC), STR = new Uint8Array(NC), TER = new Uint8Array(NC);
  const IDS = Object.keys(ZONES), TKEYS = Object.keys(TERRAIN), TI = {}; TKEYS.forEach((k, i) => { TI[k] = i; });
  const CORE_I = IDS.indexOf('core') + 1;
  const inCore = (x, y) => x >= WORLD.ox && x < WORLD.ox + WORLD.BASE && y >= WORLD.oy && y < WORLD.oy + WORLD.BASE;
  // якоря и активность — от размера мира (не от seed)
  const CEN = { x: W / 2, y: H / 2 };
  for (const id of IDS) {
    const z = ZONES[id]; z.id = id;
    if (z.core) { z.x = WORLD.ox + WORLD.BASE / 2; z.y = WORLD.oy + WORLD.BASE / 2; continue; }
    const a = z.at(CEN); z.x = Math.round(a.x); z.y = Math.round(a.y);
    z.active = z.x - z.r > 150 && z.x + z.r < W - 150 && z.y - z.r > 150 && z.y + z.r < H - 150 ? 1 : 0;
  }
  const ACT = IDS.filter(id => ZONES[id].active && !ZONES[id].core).map(id => ZONES[id]);
  // объекты зон: абсолютные координаты; осмотр — в INSPECT, преграды — в World.COLL
  const OBJS = [], BY_ID = {};
  for (const z of ACT) for (const o0 of z.objects || []) {
    const o = Object.assign({ zone: z.id }, o0, { x: z.x + o0.dx, y: z.y + o0.dy });
    if (o.camp) (z.camps = z.camps || []).push({ x: o.x, y: o.y, r: o.camp });
    // записка зоны — обычная записка (NOTES): лист на снегу, «Прочитать», счёт в итоговом акте
    if (o.type === 'note') { NOTES[o.id] = { i: ':log:', x: o.x, y: o.y, t: o.t, zone: z.id }; BY_ID[o.id] = o; continue; }
    OBJS.push(o); BY_ID[o.id] = o;
    if (o.t && !o.loot && !o.survey && !o.rent) INSPECT.push({ id: o.id, i: z.ic, x: o.x, y: o.y + 8, t: o.t, zone: 1 });
    if (o.solid) World.COLL.push({ x: o.x, y: o.y - 6, r: o.solid });
  }
  // объект с условием (need) — есть в мире только после него
  const here = o => !o.need || !!(G && Story.get(o.need));
  // стоянка для быстрого перехода: южнее якоря, не в постройке
  const camp = z => z.core ? { x: HUT.x, y: HUT_IN.y1 + 70 } : { x: z.x + (z.id === 'zimnik' ? 130 : 0), y: z.y + (z.id === 'golets' ? 150 : 200) };

  let built = null, meanDens = 1;
  function terr(z, x, y, d) {
    if (z.camps) for (const c of z.camps) if ((x - c.x) ** 2 + (y - c.y) ** 2 < c.r * c.r) return 'camp'; // у жилья натоптано
    if (z.id === 'golets') return d < 0.55 ? 'golets' : 'stlanik';
    if (z.id === 'zimnik' && Math.abs(x - riverX(y)) < RW) return 'trail';
    if (z.camp && Math.hypot(x - z.x, y - z.y) < z.camp) return 'camp';
    return z.terrain;
  }
  // расстояние точки до зоны в долях радиуса (< 1 — внутри); зимник — ещё и коридор вдоль реки южнее участка
  function zd(z, x, y) {
    let d = Math.hypot(x - z.x, y - z.y) / z.r;
    if (z.id === 'zimnik' && y > WORLD.oy + WORLD.BASE + 250) d = Math.min(d, Math.abs(x - riverX(y)) / 320 + 0.2);
    return d;
  }
  function build(seed) {
    if (built === seed) return; built = seed;
    const N = Noise.make(mulberry((seed ^ 0x2F6B5) | 0));
    let dsum = 0;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const k = j * NX + i, x = i * C + C / 2, y = j * C + C / 2;
      if (inCore(x, y)) { ZID[k] = CORE_I; STR[k] = 0; TER[k] = TI.core; dsum += 1; continue; }
      let best = null, bd = 1;
      if (ACT.length) {
        const nz = N.fbm(x / 1100, y / 1100, 3) * 0.26;
        for (const z of ACT) { const d = zd(z, x, y) + nz; if (d < bd) { bd = d; best = z; } }
      }
      if (!best) { ZID[k] = 0; STR[k] = 0; TER[k] = TI.taiga; dsum += 1; continue; }
      ZID[k] = IDS.indexOf(best.id) + 1; STR[k] = Math.round(clamp((1 - bd) / 0.28, 0, 1) * 255);
      TER[k] = TI[terr(best, x, y, bd)];
      dsum += best.trees && STR[k] > 89 ? best.trees.dens : 1;
    }
    meanDens = dsum / NC;
  }
  const cellOf = (x, y) => { const i = (x / C) | 0, j = (y / C) | 0; return x < 0 || y < 0 || i >= NX || j >= NY ? -1 : j * NX + i; };
  // зона точки (ядро — ZONES.core; ничья тайга — null)
  function at(x, y) {
    if (built === null) return inCore(x, y) ? ZONES.core : null;
    const k = cellOf(x, y); return k < 0 || !ZID[k] ? null : ZONES[IDS[ZID[k] - 1]];
  }
  const idAt = (x, y) => { const z = at(x, y); return z ? z.id : null; };
  const strength = (x, y) => { const k = cellOf(x, y); return k < 0 || built === null ? 0 : STR[k] / 255; };
  const terrainKey = (x, y) => { if (built === null) return inCore(x, y) ? 'core' : 'taiga'; const k = cellOf(x, y); return k < 0 ? 'taiga' : TKEYS[TER[k]]; };
  const terrainAt = (x, y) => TERRAIN[terrainKey(x, y)];
  // правило k зоны в точке / у героя (1 — как в ядре)
  function ruleAt(x, y, k) { const z = at(x, y), v = z && z.rules && z.rules[k]; return typeof v === 'number' ? v : 1; }
  function rule(k) { return G && G.p ? ruleAt(G.p.x, G.p.y, k) : 1; }
  // лес зоны: {dens, kind} (null — как в тайге); у мягкой границы — тайга
  function treeAt(x, y) { const z = at(x, y); return z && z.trees && strength(x, y) > 0.35 ? z.trees : null; }

  // ---------- состояние в G ----------
  function initState() {
    G.zoneSeen = G.zoneSeen || { core: 1 };
    G.loot = G.loot || {};
    for (const o of OBJS) if (o.loot && !G.loot[o.id]) G.loot[o.id] = [...o.loot];
    G.fallen = G.fallen || [];
    G.marks = G.marks || [];
    if (G.zoneCur === undefined) G.zoneCur = 'core';
  }

  // ---------- что рядом (для Actions.context) ----------
  // точка «съёмки»: объект зоны (тур, мачта) или вышка посёлка ('b' + id постройки)
  function surveyPoint(id) {
    if (BY_ID[id]) return BY_ID[id];
    const b = G.col && id && id[0] === 'b' ? G.col.builds.find(q => 'b' + q.id === id && q.done && q.type === 'tower') : null;
    return b ? { id, x: b.x, y: b.y, zone: 'core', survey: 1 } : null;
  }
  function context(p) {
    if (built === null) return null;
    // вышка посёлка — тоже «съёмка» (A9: сопка/вышка)
    if (G.col) for (const b of G.col.builds) if (b.done && b.type === 'tower' && dist2(b, p) < 50 * 50) return { k: 'survey', label: 'Съёмка с вышки :pin:', o: { id: 'b' + b.id } };
    const z = at(p.x, p.y); if (!z || z.core) return null;
    for (const o of OBJS) {
      if (o.zone !== z.id || !here(o)) continue;
      const r = (o.solid || 16) + 44; if (dist2(o, p) > r * r) continue;
      if (o.survey) return { k: 'survey', label: 'Съёмка :pin:', o };
      if (o.forecast) return { k: 'forecast', label: 'Журнал :log:', o };
      if (o.rent === 'deer') return Transport.rentContext(o);
      if (o.loot) { const n = (G.loot[o.id] || []).length; if (n) return { k: 'loot', label: `Обыскать · ${n}`, o }; }
    }
    return null;
  }
  // «съёмка»: клетки тумана в радиусе — «отснято» (2); места и зоны в радиусе — на карте
  function survey(x, y, R = TUNE.zone.surveyR) {
    const F = World.FOG, c = F.cell;
    const i0 = Math.max(0, ((x - R) / c) | 0), i1 = Math.min(F.nx - 1, ((x + R) / c) | 0), j0 = Math.max(0, ((y - R) / c) | 0), j1 = Math.min(F.ny - 1, ((y + R) / c) | 0);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if ((i * c + c / 2 - x) ** 2 + (j * c + c / 2 - y) ** 2 < R * R) G.fog[j * F.nx + i] = 2;
    for (const k in POI) if (Math.hypot(POI[k].x - x, POI[k].y - y) < R) G.known[k] = 1;
    for (const zz of ACT) if (Math.hypot(zz.x - x, zz.y - y) < R + zz.r * 0.5 && !G.zoneSeen[zz.id]) G.zoneSeen[zz.id] = 2; // видна с высоты
  }
  // прогноз (метеостанция): когда пурга
  function forecast() {
    const s = G.storm && G.storm.b > G.time ? G.storm : null;
    if (s && s.a <= G.time) return ':storm: Журнал: пурга идёт сейчас · сиди в тепле';
    if (s) {
      const f = TUNE.time.startH / 24 + s.a / CYCLE, d = 1 + Math.floor(f) === G.day ? 'сегодня' : 'завтра', h = (f % 1) * 24;
      return `:storm: Журнал: пурга ${d} к ${String(Math.floor(h)).padStart(2, '0')}:00`;
    }
    return ':day: Журнал: до завтра пурги не ждать';
  }

  // ---------- промысловые участки (A5, вариант «в»): посёлок эпохи ≥ II открывает участок в зоне ----------
  // ZONES[id].plot: {n, npc, need(g) → причина|null, cost (из лабаза), yield (утром в лабаз), rub, crew (облики людей)}.
  // Состояние: G.plots[id] = {day} — день открытия. Открывает персонаж зоны (его меню → Zones.plotOpen).
  const plotOf = id => ZONES[id] && ZONES[id].active ? ZONES[id].plot : null;
  const plotIds = () => ACT.filter(z => z.plot).map(z => z.id);
  // почему не открыть (null — можно)
  function plotWhy(id) {
    const P = plotOf(id); if (!P) return 'участка тут нет';
    if (G.plots && G.plots[id]) return 'участок уже работает';
    if (!G.col || G.col.ep < 1) return 'нужен посёлок эпохи II «Заимка»';
    const w = P.need && P.need(G); if (w) return w;
    if (!Inv.canPay(P.cost, true)) return 'в лабазе не хватает: ' + Object.entries(P.cost).map(([k, v]) => (k === 'food' ? ':food:' : ITEMS[k].i) + v).join(' ');
    return null;
  }
  // пункт меню «участок» у персонажа зоны: виден с эпохи II, пока участок не открыт
  const plotShow = id => !!plotOf(id) && !!G.col && G.col.ep >= 1 && !(G.plots && G.plots[id]);
  function plotOpen(id) {
    if (plotWhy(id)) return false;
    const P = plotOf(id); Inv.payStock(P.cost);
    (G.plots = G.plots || {})[id] = { day: G.day };
    Fx.toast(ZONE_TXT.plotOpen + ' · ' + ZONES[id].ic + ' ' + P.n); Sound.ok2();
    return true;
  }
  // рассвет: каждый открытый участок сдаёт добычу в лабаз (рубли — в кассу посёлка)
  function plotDawn() {
    if (!G.plots) return;
    const got = {}; let rub = 0;
    for (const id in G.plots) {
      const P = plotOf(id); if (!P || G.plots[id].day >= G.day) continue;
      for (const [k, v] of Object.entries(P.yield)) { G.chest[k] = (G.chest[k] || 0) + v; got[k] = (got[k] || 0) + v; }
      if (P.rub && G.col) { G.col.rub += P.rub; rub += P.rub; }
      if (P.forecast && G.storm && G.storm.b > G.time) G.flags.forecast = G.day; // метеопост сам шлёт прогноз
    }
    const parts = Object.entries(got).map(([k, v]) => ITEMS[k].i + v).concat(rub ? [':coins:' + rub] : []);
    if (parts.length) Fx.toast(ZONE_TXT.plotYield + ' ' + parts.join(' '));
  }

  // ---------- вход в зону и опасности (шаг update) ----------
  function tick(dt) {
    if (built === null) return;
    const p = G.p, T = TUNE.zone, z = at(p.x, p.y), id = z ? z.id : null;
    if (id !== G.zoneCur) {
      G.zoneCur = id;
      if (z && !z.core) {
        if (G.zoneSeen[id] !== 1) { G.zoneSeen[id] = 1; Fx.toast(z.ic + ' ' + z.desc); }
        UI.zone({ ic: z.ic, n: z.n });
      } else if (!z) UI.zone({ ic: ':tree:', n: 'Тайга' });
    }
    const tk = terrainKey(p.x, p.y), ter = TERRAIN[tk];
    // лыжи: где не идут — сняты (скорость пешком), вышел — снова на лыжах
    if (G.gear.skis && !p.ride) { const off = ter.ski === 0 ? 1 : 0; if (off !== (p.skiOff || 0)) { p.skiOff = off; Fx.toast(off ? ZONE_TXT.noSki : ZONE_TXT.skiOn); } }
    p.sprainT = Math.max(0, (p.sprainT || 0) - dt);
    if (p.inside || p.sleeping) return;
    // голец: ветер сносит (и стоя)
    if (tk === 'golets') { p.x += T.windX * dt * (stormOn() ? 2 : 1); World.solid(p, 10, 'p'); }
    // гарь: сухостой падает рядом (предупреждение → удар)
    if (id === 'gar') tickFall(dt, T); else if (G.fall) G.fall = null;
    if (!p.moving) return;
    // наледь: вода под снегом; промоины — сразу
    if (ter.wet && !(p.wetT > 0)) {
      let hit = Math.random() < dt * T.wetP;
      for (const o of OBJS) if (o.type === 'steam' && o.zone === id && dist2(o, p) < 44 * 44) hit = true;
      if (hit) { p.wetT = T.wetT; Fx.toast(ZONE_TXT.wet); Sound.splash(); ArtWorld.fx.splash(G.parts, p.x, p.y + 4); }
    }
    // курумник: вывих
    if (tk === 'kurum' && !p.ride && p.sprainT <= 0 && Math.random() < dt * T.sprainP) {
      p.sprainT = T.sprainT; G.s.hp = Math.max(1, G.s.hp - 3); G.hurt = 0.6; Fx.shake(4); Fx.toast(ZONE_TXT.sprain);
    }
  }
  function tickFall(dt, T) {
    const p = G.p;
    if (!G.fall) {
      G.fallT = (G.fallT == null ? rnd(T.fallEvery[0], T.fallEvery[1]) : G.fallT) - dt * (stormOn() ? 2 : 1);
      if (G.fallT > 0) return;
      G.fallT = rnd(T.fallEvery[0], T.fallEvery[1]);
      const t = Space.nearest(Space.trees, p.x, p.y, 260, q => q.kind === 3 && q.wood > 0 && !q.wall);
      if (!t) return;
      G.fall = { x: t.x, y: t.y, t: T.fallWarn, a: +(Math.atan2(p.y - t.y, p.x - t.x) + rnd(-0.5, 0.5)).toFixed(2), tree: World.TREE_I.get(t) };
      World.shakeTree(t, T.fallWarn); Sound.treeCrack(); Fx.toast(ZONE_TXT.fallWarn);
      return;
    }
    const f = G.fall; f.t -= dt; if (f.t > 0) return;
    G.fall = null;
    const t = G.trees[f.tree]; if (t) { t.wood = 0; World.felled(t); }
    const len = 110, ex = f.x + Math.cos(f.a) * len, ey = f.y + Math.sin(f.a) * len * 0.6;
    G.fallen.push({ x: f.x, y: f.y, a: f.a, len }); if (G.fallen.length > 24) G.fallen.shift();
    Fx.shake(6); Sound.hit(); ArtWorld.fx.snowPuff(G.parts, ex, ey, 1); ArtWorld.fx.snowPuff(G.parts, (f.x + ex) / 2, (f.y + ey) / 2, 1);
    // удар — по отрезку ствола
    const vx = ex - f.x, vy = ey - f.y, k = clamp(((p.x - f.x) * vx + (p.y - f.y) * vy) / (vx * vx + vy * vy), 0, 1);
    if (Math.hypot(p.x - f.x - vx * k, p.y - f.y - vy * k) < T.fallR) { G.s.hp -= T.fallDmg; G.hurt = 1; Fx.toast(ZONE_TXT.fallHit); }
  }

  return { C, NX, NY, IDS, ACT, OBJS, obj: id => BY_ID[id], surveyPoint, build, at, idAt, rule, ruleAt, strength, terrainKey, terrainAt, treeAt, cellOf,
    zid: k => ZID[k], str: k => STR[k], ter: k => TER[k], TKEYS,
    get meanDens() { return meanDens; }, get built() { return built; }, camp, initState, context, survey, forecast, tick, inCore,
    here, plotIds, plotOf, plotWhy, plotShow, plotOpen, plotDawn };
})();
