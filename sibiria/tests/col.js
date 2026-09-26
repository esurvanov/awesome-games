// Посёлок-менеджер для бота: работает поверх story-бота (bot.js+plan.js).
// Хук на каждый тик (без движения игрока): найм/эпохи — только у избы, стройка — в радиусе 900 от игрока.
// Движение (торг у фактории) — через обёртку upkeep().
(function () {
  const B = window.BOT, L = B.L;
  const C = () => G.col;
  const M = B.col = { series: [], ev: [], gath: {}, workT: {}, allT: {}, deaths: [], hires: {}, eaten: 0, hungryEv: 0, epAt: {}, built: {}, trades: [], tech: {},
    unitMin: 0, towerShots: 0, alarmOn: 0, wolfBitesUnits: 0 };
  const opt = B.colOpt = Object.assign({ on: true, alarm: true, tower: true, trade: true, chestWood: true, hunt: true, bootWood: true, noRescue: false, maxPop: 99, story: true, noStory: false }, B.colOpt || {});
  const EV = m => { M.ev.push(`[${(B.T / 60).toFixed(1)}m d${G.day} ${hourOf().toFixed(1)}h] ${m}`); L('🏘 ' + m); };
  const food = () => Inv.cnt('food', true);
  const pop = () => Colony.pop();
  const bichs = () => C().units.filter(u => u.type === 'bich');

  // ---------- места ----------
  function findSpot(type, cx, cy, rmin = 60, rmax = 700) {
    for (let r = rmin; r <= rmax; r += 20) for (let a = 0; a < 6.28; a += 0.25) {
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (Colony.canPlace(type, x, y)) return { x, y };
    }
    return null;
  }
  function forestCenter() {
    let best = null, bn = -1;
    for (let r = 200; r <= 1300; r += 70) for (let a = 0; a < 6.28; a += 0.3) {
      const x = HUT.x + Math.cos(a) * r, y = HUT.y + Math.sin(a) * r;
      if (onIce(x, y) || Math.abs(x - riverX(y)) < 200) continue;
      const n = treesNear(x, y, 220).filter(t => t.wood > 0 && !t.wall).length;
      const sc = n - r / 60; if (n >= 6 && sc > bn) { bn = sc; best = { x, y }; }
    }
    return best;
  }
  const fishSpot = i => { const y = HUT.y + 40 + (i % 4) * 30, x = riverX(y) + ((i / 4 | 0) - 0.5) * 40; return { x, y }; };
  const spotFor = {
    woodshed: () => { const f = M.forest || (M.forest = forestCenter()); return findSpot('woodshed', f.x, f.y, 0, 400); },
    smoke: () => findSpot('smoke', (HUT.x + riverX(HUT.y)) / 2 + 40, HUT.y + 60),
    balok: () => findSpot('balok', HUT.x - 60, HUT.y + 170),
    forge: () => findSpot('forge', HUT.x + 60, HUT.y + 190),
    tower: () => findSpot('tower', HUT.x, HUT.y + 230),
    market: () => findSpot('market', HUT.x - 20, HUT.y + 200),
    labaz2: () => findSpot('labaz2', POI.cedar.x - 150, POI.cedar.y + 150, 0, 300),
  };
  function tryBuild(type) {
    const Bd = BUILDS[type];
    if (Bd.ep > C().ep || !Inv.canPay(Bd.cost, true)) return false;
    if (C().builds.some(b => !b.done)) return false; // по одной стройке
    const s = spotFor[type](); if (!s) { EV('нет места для ' + type); return false; }
    if (dist(s, G.p) > 900 && !opt.farBuild) return false;
    C().ghost = { type, x: s.x, y: s.y, ok: true };
    const n0 = C().builds.length; Colony.place();
    if (C().builds.length > n0) {
      const b = C().builds[C().builds.length - 1];
      // назначаем 2 бичей строить (как выделение + ПКМ)
      const bs = bichs().filter(u => u.task.k !== 'build').sort((a, c) => dist2(a, b) - dist2(c, b)).slice(0, type === 'labaz2' ? 2 : 2);
      for (const u of bs) { u.task = { k: 'build', b: b.id }; u.prev = null; if (u.hidden) u.prev = { k: 'build', b: b.id }; }
      M.built[type] = (M.built[type] || []); M.built[type].push({ placed: +(B.T / 60).toFixed(1) });
      EV(`стройка ${Bd.i}${type} (${bs.length} бичей) склад ${JSON.stringify(Bd.cost)}`); return true;
    }
    C().ghost = null; return false;
  }

  // ---------- план ----------
  function nextBuild() {
    const c = C(), dc = t => c.builds.filter(b => b.type === t).length;
    const cap = Colony.popCap();
    if (!dc('woodshed')) return 'woodshed';
    if (M.forest && dc('woodshed') < 3 && !c.builds.some(b => b.type === 'woodshed' && dist2(b, M.forest) < 450 * 450)) return 'woodshed';
    if (!dc('labaz2') && (dist(G.p, POI.cedar) < 1000 || opt.farBuild)) return 'labaz2';
    if (!dc('smoke')) return 'smoke';
    if (pop() >= cap - 1 && dc('balok') < 3) return 'balok';
    if (c.ep >= 1) {
      if (!dc('forge')) return 'forge';
      if (!dc('tower') && opt.tower) return 'tower';
      if (!dc('market')) return 'market';
    }
    if (c.ep >= 2 && !dc('labaz2')) return 'labaz2';
    return null;
  }
  // сколько еды держать в резерве (1 мин на человека + 2 игроку)
  const reserve = () => pop() + 1;

  function assign() {
    if (!M.forestT || B.T - M.forestT > 40) { M.forestT = B.T; const f = forestCenter(); if (f && (!M.forest || treesNear(M.forest.x, M.forest.y, 300).filter(t => t.wood > 0 && !t.wall).length < 6)) { if (M.forest) EV(`лес у (${M.forest.x|0},${M.forest.y|0}) кончился → (${f.x|0},${f.y|0}), ${(Math.hypot(f.x-HUT.x,f.y-HUT.y))|0} px от избы`); M.forest = f; } }
    // брошенная стройка (без строителей) — двое бичей
    for (const st of C().builds.filter(b => !b.done && b.type !== 'pad')) {
      if (bichs().some(u => (u.task.k === 'build' && u.task.b === st.id) || (u.prev && u.prev.k === 'build' && u.prev.b === st.id))) continue;
      for (const u of bichs().filter(u => !u.hidden && ['chop', 'fish', 'idle', 'move'].includes(u.task.k)).slice(0, 2)) u.task = { k: 'build', b: st.id };
    }
    // глава IV: площадка — трое строят днём
    const pad = C().builds.find(b => b.type === 'pad' && !b.done);
    if (pad) {
      const onPad = bichs().filter(u => (u.task.k === 'build' && u.task.b === pad.id) || (u.prev && u.prev.k === 'build' && u.prev.b === pad.id)).length;
      const free = bichs().filter(u => !u.hidden && ['chop', 'fish', 'idle', 'move', 'stack'].includes(u.task.k)).sort((a, c) => dist2(a, pad) - dist2(c, pad));
      for (let i = onPad; i < 3 && free.length; i++) { const u = free.shift(); u.task = { k: 'build', b: pad.id }; M.padBuilders = (M.padBuilders || 0) + 1; }
    }
    // глава IV: двое носят дрова в сигнальные кучи
    if (G.flags.contact && !G.flags.rescued && G.stacks.some(s => !s.lit && s.wood < 4)) {
      const onStack = bichs().filter(u => u.task.k === 'stack' || (u.prev && u.prev.k === 'stack')).length;
      const free = bichs().filter(u => !u.hidden && ['chop', 'fish', 'idle', 'move'].includes(u.task.k));
      for (let i = onStack; i < 2 && free.length; i++) { const u = free.shift(); u.task = { k: 'stack' }; M.stackers = (M.stackers || 0) + 1; }
    }
    const bs = bichs().filter(u => !u.hidden && u.task.k !== 'shelter' && u.task.k !== 'build' && u.task.k !== 'stack');
    const p = pop(), f = food();
    let wantFish = f < 8 * p ? Math.ceil(bs.length * 0.65) : Math.ceil(bs.length * 0.45);
    if (opt.fishFrac != null) wantFish = Math.round(bs.length * opt.fishFrac);
    const fishers = bs.filter(u => u.task.k === 'fish'), others = bs.filter(u => u.task.k !== 'fish');
    let i = 0;
    for (const u of fishers) { if (fishers.length - i > wantFish) { u.task = { k: 'chop', ph: 'go', near: M.forest || forestCenter() }; } i++; }
    let nf = Math.min(fishers.length, wantFish);
    for (const u of others) {
      if (u.task.k === 'chop' && nf >= wantFish) { if (M.forest && u.task.near && dist2(u.task.near, M.forest) > 500 * 500 && u.task.ph !== 'drop') u.task = { k: 'chop', ph: 'go', near: M.forest }; continue; }
      if (nf < wantFish) { const s = fishSpot(u.id); u.task = { k: 'fish', ph: 'go', x: s.x, y: s.y }; nf++; continue; }
      if (u.task.k === 'idle' || u.task.k === 'move') u.task = { k: 'chop', ph: 'go', near: M.forest || (M.forest = forestCenter()) };
    }
    // бичи, у которых prev=idle и они в укрытии, выйдут idle — подберём на след. тике
  }

  function passive() {
    const c = C();
    if (!opt.on || !c) return;
    // набат: волки/медведь рядом с людьми днём
    if (opt.alarm) {
      const th = G.wolves.concat(G.bear ? [G.bear] : []);
      const danger = th.some(w => c.units.some(u => !u.pet && !u.hidden && dist2(u, w) < 380 * 380) || dist2(w, HUT) < 600 * 600);
      if (danger && !c.alarm) { Colony.alarm(); M.alarmOn++; EV('🔔 набат'); }
      if (!danger && c.alarm) Colony.alarm();
    }
    // исследования (кузня; позиция не нужна)
    if (!c.research) {
      for (const id of ['vatnik', 'saw2', 'nets', 'sled2']) {
        if (Colony.techState(id) !== 'ok') continue;
        const T = TECHS[id];
        if (T.cost.scrap && Inv.cnt('scrap', true) - T.cost.scrap < scrapNeed()) continue;
        if (T.cost.hare && Inv.cnt('hare', true) - T.cost.hare < 1) continue;
        Colony.research(id); M.tech[id] = +(B.T / 60).toFixed(1); EV('🔨 изучаю ' + id); break;
      }
    }
    // стройка
    const nb = G.flags.contact && !G.col.builds.some(b => b.type === 'pad') ? null : nextBuild(); // дрова — на площадку
    if (nb && Inv.canPay(BUILDS[nb].cost, true)) {
      const w = Inv.cnt('wood', true) - BUILDS[nb].cost.wood;
      if (w >= (opt.woodKeep ?? 10)) tryBuild(nb);
    }
    // у избы: эпоха, найм
    if (World.nearHut()) {
      const es = Colony.epochState();
      if (es === 'ok') { const E = EPOCHS[c.ep + 1]; if (food() - (E.cost.food || 0) >= 0) { Colony.advance(); M.epAt[c.ep + 1] = { start: +(B.T / 60).toFixed(1), day: G.day, h: +hourOf().toFixed(1) }; EV('📜 эпоха → ' + (c.ep + 1)); } }
      else if (es !== 'busy' && es !== 'max') M.epBlock = es;
      const want = (t) => Colony.unitState(t) === 'ok' && food() - UNITS[t].cost.food >= reserve() && c.epT <= 0;
      const nB = bichs().length + c.queue.filter(q => q.type === 'bich').length;
      const capStage = (opt.caps || [5, 7, 10, 12])[c.ep]; const epFoodShort = Colony.epochState() === 'cost' && EPOCHS[c.ep + 1] && food() < (EPOCHS[c.ep + 1].cost.food || 0);
      if (pop() < Math.min(opt.maxPop, capStage) && !epFoodShort) {
        if (c.ep >= 1 && !c.units.some(u => u.type === 'evenk') && !c.queue.length && Inv.cnt('hare', true) >= 2 && want('evenk')) { Colony.hire('evenk'); M.hires.evenk = (M.hires.evenk || 0) + 1; EV('найм 🏹'); }
        else if (want('bich') && nB < 12) { Colony.hire('bich'); M.hires.bich = (M.hires.bich || 0) + 1; EV(`найм 🧔 (еда ${food()}, люд ${pop()}/${Colony.popCap()})`); }
      }
    }
  }
  function scrapNeed() { const c = C(); let n = 0; if (c.ep < 2) n += 3; if (c.ep < 3) n += 4; if (!C().builds.some(b => b.type === 'forge')) n += 2; if (!C().builds.some(b => b.type === 'tower')) n += 1; if (!C().builds.some(b => b.type === 'labaz2')) n += 1; return n; }

  // ---------- метрики ----------
  let acc = 0, lastIds = new Set(), minuteAcc = 0, lastEat = 60;
  const lastCarry = new Map();
  function metrics(dt) {
    const c = C(); if (!c) return;
    for (const u of c.units) {
      const n = Colony.carryN(u), k = u.task.k, key = u.type + ':' + (k === 'shelter' ? (u.prev && u.prev.k) || 'idle' : k);
      const prev = lastCarry.get(u.id);
      if (prev != null && n > prev) { const kk = u.type + ':' + k; M.gath[kk] = (M.gath[kk] || 0) + n - prev; }
      lastCarry.set(u.id, n);
      if (!u.pet) { M.allT[key] = (M.allT[key] || 0) + dt; if (!u.hidden && u.task.k !== 'shelter') M.workT[u.type + ':' + k] = (M.workT[u.type + ':' + k] || 0) + dt; M.unitMin += dt / 60; }
    }
    const ids = new Set(c.units.map(u => u.id));
    for (const id of lastIds) if (!ids.has(id)) {
      const th = G.wolves.length ? 'wolf' : G.bear ? 'bear' : 'hunger/other';
      M.deaths.push({ id, t: +(B.T / 60).toFixed(1), day: G.day, h: +hourOf().toFixed(1), near: th, alarm: c.alarm });
      EV(`💀 погиб юнит ${id} (${th})`);
    }
    lastIds = ids;
    if (c.eatT > lastEat) { M.eaten += c.units.length; }
    lastEat = c.eatT;
    for (const b of c.builds) if (b.done && M.built[b.type] && !b._m) { b._m = 1; const r = M.built[b.type].find(x => x.done == null); if (r) r.done = +(B.T / 60).toFixed(1); }
    acc += dt;
    if (acc >= 30) {
      acc = 0;
      M.series.push({ m: +(B.T / 60).toFixed(1), d: G.day, h: +hourOf().toFixed(1), ep: c.ep, pop: pop(), cap: Colony.popCap(), food: food(), wood: Inv.cnt('wood', true), scrap: Inv.cnt('scrap', true), rub: c.rub,
        hp: Math.round(c.units.reduce((s, u) => s + (u.pet ? 0 : u.hp), 0)), tasks: c.units.map(u => u.hidden ? 'H' : u.task.k[0]).join(''), wolves: G.wolves.length });
    }
  }

  // ---------- хук на tick ----------
  let inHook = false, hk = 0;
  // bot.js вызывает tick() через замыкание — перехват через update: подменяем глобальный update
  const oUpdate = window.update;
  window.update = function (dt) { oUpdate(dt); if (inHook || !G.col || state !== 'play') return; inHook = true; try { metrics(dt); if ((hk += dt) >= 1) { hk = 0; if (opt.on) { passive(); assign(); } } } finally { inHook = false; } };

  // ---------- рубка из склада вместо топора ----------
  const oChop = B.chop;
  B.chop = function (n, maxDist) {
    if (opt.chestWood && (G.chest.wood || 0) >= n + 12 && Math.hypot(G.p.x - HUT.x, G.p.y - HUT.y) < 700) {
      B.enterHut(); const got = B.chestTake('wood', n - Inv.cnt('wood', false)); M.chestWood = (M.chestWood || 0) + got; L(`🪵 со склада +${got}`); return;
    }
    return oChop(n, maxDist);
  };

  // ---------- торг у фактории ----------
  function tradeRun() {
    const mk = C().builds.find(b => b.done && b.type === 'market'); if (!mk || !opt.trade) return false;
    if (B.lastTrade && B.T - B.lastTrade < 90) return false;
    const wantScrap = Math.max(0, scrapNeed() - Inv.cnt('scrap', true));
    const woodSurplus = Inv.cnt('wood', true) - (opt.woodFloor ?? 40);
    if (!wantScrap && woodSurplus < 20 && Inv.cnt('hare', true) < 6 && !(food() < reserve() + 4 && C().rub >= 6)) return false;
    B.lastTrade = B.T;
    B.goTo(mk.x, mk.y + BUILDS.market.h / 2 + 30, 14, 60);
    if (!Colony.nearMarket()) { EV('торг: не у фактории'); return false; }
    // продать ровно столько дров из склада, чтобы хватило на железо
    let sold = 0, bought = 0, rub0 = C().rub;
    while (Inv.cnt('wood', true) > (opt.woodFloor ?? 40) && (C().rub < wantScrap * Colony.buyPrice('scrap') || sold < woodSurplus / 2) && sold < 80) { if (!Colony.sell('wood')) break; sold++; }
    let sh = 0; while (Inv.cnt('hare', true) > 3 && sh < 30) { if (!Colony.sell('hare')) break; sh++; } M.soldHare = (M.soldHare || 0) + sh;
    while (wantScrap > bought && C().rub >= Colony.buyPrice('scrap')) { Colony.buy('scrap'); bought++; }
    let fb = 0;
    while (food() < reserve() + 4 && C().rub >= Colony.buyPrice('meat') && fb < 10) { Colony.buy('meat'); fb++; }
    M.trades.push({ t: +(B.T / 60).toFixed(1), d: G.day, soldWood: sold, scrap: bought, meat: fb, rub0, rub: C().rub, pw: +C().prices.wood.toFixed(2), ps: +C().prices.scrap.toFixed(1) });
    EV(`торг: −🪵${sold} +⚙️${bought} +🍖${fb} ₽${rub0}→${C().rub}`);
    return true;
  }
  const oUpkeep = B.upkeep;
  B.upkeep = function () { if (tradeRun()) return true; if (bootFood()) return true; if (bootWood()) return true; return oUpkeep(); };
  function woodGoal() {
    const c = C(); let g = 0; const nb = nextBuild(); if (nb) g = BUILDS[nb].cost.wood || 0;
    const E = EPOCHS[c.ep + 1]; if (E && E.cost.wood && Colony.epochState() !== 'busy') g = Math.max(g, E.cost.wood);
    return g;
  }
  function bootWood() {
    if (!opt.bootWood || G.chapter >= 6 || !(hourOf() >= 7.2 && hourOf() < 15)) return false;
    if (B.lastBootW && B.T - B.lastBootW < 30) return false;
    const need = woodGoal() + 4 - Inv.cnt('wood', true); if (need <= 0) return false;
    B.lastBootW = B.T; const w0 = Inv.cnt('wood', true);
    const sv = opt.chestWood; opt.chestWood = false; B.chop(Math.min(12, need), 600); opt.chestWood = sv; B.enterHut(); B.chestAll();
    M.bootWood = (M.bootWood || 0) + Inv.cnt('wood', true) - w0; EV(`рубка ради посёлка: 🪵 ${w0}→${Inv.cnt('wood', true)}`); return true;
  }
  const oCraft = B.doCraft;
  B.doCraft = function (id) { if (id === 'radio' && opt.noRescue) { if (!M.noRadio) { M.noRadio = 1; EV('рацию не собираю (режим без спасения)'); }
    // упор в посёлок: вместо рации — дрова и еда на склад
    if (hourOf() >= 7.2 && hourOf() < 16) { if (food() < reserve() + 6) { B.huntHares(4, 45, () => hourOf() < 16); } else { const sv = opt.chestWood; opt.chestWood = false; B.chop(12, 600); opt.chestWood = sv; } B.enterHut(); B.chestAll(); }
    else B.wait(5);
    return false; } return oCraft(id); };
  function bootFood() {
    if (!opt.hunt || G.chapter >= 6 || !(hourOf() >= 7.2 && hourOf() < 15)) return false;
    if (B.lastBoot && B.T - B.lastBoot < 45) return false;
    if (food() >= reserve() + 4 || (pop() >= 4 && C().units.filter(u => u.task.k === 'fish').length >= 2)) return false;
    B.lastBoot = B.T; const f0 = food();
    B.huntHares(4, 45, () => hourOf() < 15); B.enterHut(); B.chestAll();
    M.bootHunt = (M.bootHunt || 0) + food() - f0; EV(`охота ради посёлка: еда ${f0}→${food()}`); return true;
  }
  B.tradeRun = tradeRun;
})();
