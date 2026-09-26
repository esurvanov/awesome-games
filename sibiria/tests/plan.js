// Мозг бота: выбирает следующую задачу по состоянию игры.
(function () {
  const B = window.BOT, L = B.L;
  const food = wc => FOOD_ORDER.reduce((s, k) => s + Inv.cnt(k, true), 0);
  const H = () => hourOf();
  const dayTime = () => H() >= 7 && H() < 17.2;

  B.pick = (txt) => {
    const f = s => txt.findIndex(t => t.includes(s));
    if (f('Остаться') >= 0) return B.colOpt && B.colOpt.noRescue ? f('Остаться') : f('Ждать');
    if (f('Помоги нам') >= 0) return f('Помоги нам');
    if (f('Отдать') >= 0) return f('Отдать');
    // главы V–VI: не ввязываемся в необязательные «на потом» квесты (кабель мачты, сэвэки Уялан) —
    // кроме главы VII, где кабель на мачту обязателен для рации (SPEC-world §9, tamara_mast)
    if (G.chapter !== 6 && f('Потом') >= 0) return f('Потом');
    if (f('Участок') >= 0) return f('Участок');
    if (f('метеостанции') >= 0) return f('метеостанции');
    if (B.wantGift && f('Подарить') >= 0) { B.wantGift = false; return f('Подарить'); }
    if (B.wantFeed && f('Накормить') >= 0) { B.wantFeed = false; return f('Накормить'); }
    if (f('Помогу') >= 0) return f('Помогу');
    if (f('Меняться') >= 0) return txt.length - 1; // «Пока/Спасибо»
    return 0;
  };

  function spotFor(who, o) {
    const sx = G.p.x, sy = G.p.y, si = G.p.inside, ins = insideHut(o.x, o.y);
    for (let r = 30; r <= 62; r += 8) for (let a = 0; a < 6.28; a += 0.3) {
      const x = o.x + Math.cos(a) * r, y = o.y + Math.sin(a) * r;
      if (ins && (!insideHut(x, y) || x < HUT_IN.x0 + 11 || x > HUT_IN.x1 - 11 || y < HUT_IN.y0 + 11 || y > HUT_IN.y1 - 11)) continue;
      G.p.x = x; G.p.y = y; G.p.inside = insideHut(x, y); const c = Actions.context();
      G.p.x = sx; G.p.y = sy; G.p.inside = si;
      if (c && c.k === who) return { x, y };
    }
    return { x: o.x, y: o.y + (ins ? -32 : 30) };
  }
  function talk(who) {
    // БЛОКЕР (D/E): раньше тут были захардкожены только Уркачан и Вера — talk('mikhalych'/'uyalan'/'tamara'/…)
    // тянул героя к Вере у избы вместо человека зоны. Npc.state(id) — тот же G.urk/G.vera по slot, плюс G.npcs[id].
    const o = Npc.state(who);
    B.goTo(o.x, o.y + (insideHut(o.x, o.y) ? -30 : 40), 30, 60);
    for (let k = 0; k < 6; k++) { const c = Actions.context(); if (c && c.k === who) break; const sp = spotFor(who, o); B.goTo(sp.x, sp.y, 4, 8); }
    const c = Actions.context(); if (!c || c.k !== who) { L('не дотянулся до ' + who + ' ctx ' + (c && c.k)); return false; }
    Actions.interact(false); B.tick(); B.tick(); return true;
  }
  B.talk = talk;

  function ensureWood(n, maxDist = 700) { if (Inv.cnt('wood', false) < n) B.chop(n, maxDist); }
  function haveInHut(k) { return Inv.cnt(k, true); }

  function feedVeraIfNeeded() {
    const v = G.vera; if (v.state !== 'hut') return;
    if (v.food < 2 && food() > 1) { if (!G.p.inside) B.enterHut(); B.wantFeed = true; const f0 = v.food; talk('vera'); B.wantFeed = false; L(`Вера: еда ${f0} → ${v.food}`); }
  }

  function foodRun() {
    // лабаз — бесплатное мясо
    if (!G.labaz) { L('иду к лабазу'); B.goTo(POI.labaz.x - 60, POI.labaz.y + 40, 14); for (let k = 0; k < 5 && !G.labaz; k++) { B.goTo(POI.labaz.x - 42, POI.labaz.y + 18 - k * 6, 6, 10); const c = Actions.context(); B.labazCtx = c && c.k; Actions.interact(false); B.tick(); } L('лабаз: ' + G.labaz); return; }
    B.huntHares(3, 60, dayTime);
  }

  // ---------- задачи глав ----------
  function ch0() {
    const f = G.flags;
    if (!G.notes.log) { B.readNote('log'); B.readNote('pilot'); return; }
    if (G.wreck.cockpit.length) { B.wreck('cockpit'); return; }
    if (!f.stoveLit) { ensureWood(8, 600); B.enterHut(); B.chestAll(); B.fillStove(Stove.secPerLog() * 2); return; }
    if (!G.hut.walls) { ensureWood(6 - (G.chest.wood || 0) > 0 ? 9 : 3, 600); B.enterHut(); B.chestAll(); B.build('walls'); return; }
    if (!G.hut.bench) { ensureWood(8, 600); B.enterHut(); B.chestAll(); B.build('bench'); return; }
    if (!G.hut.door) { ensureWood(8, 600); B.enterHut(); B.chestAll(); B.build('door'); return; }
    // запасы на ночь
    if (Inv.cnt('wood', true) < 12) { ensureWood(9, 600); B.enterHut(); B.chestAll(); return; }
    if (!B.snared && Inv.cnt('scrap', true) >= 1 && G.hut.bench) { B.enterHut(); B.chestTake('scrap', 1); B.doCraft('snare'); B.snared = 1; }
    if (Inv.cnt('snare', false) > 0) { B.goTo(HUT.x + 400, HUT.y + 200, 20); Actions.placeKey(); B.wait(2.2); B.goTo(HUT.x + 400, HUT.y - 250, 20); Actions.placeKey(); B.wait(2.2); return; }
    // ранний вечер — ждём
    B.enterHut(); B.wait(5);
  }

  function ch1() {
    const f = G.flags, u = G.urk;
    if (!f.metUrk) { if (u.state === 'away') { B.wait(3); return; } talk('urk'); return; }
    if (G.traps.some(t => t.catch)) { for (const t of G.traps.filter(t => t.catch)) { B.goTo(t.x, t.y + 20, 14); const c = Actions.context(); if (c && c.k === 'trap') Actions.interact(true); B.tick(); } return; }
    if (!f.urkPelts && Inv.cnt('hare', true) < 2) { B.huntHares(2 - Inv.cnt('hare', true), 120, dayTime); return; }
    if (!f.urkPelts) { if (G.p.inside || (G.chest.hare || 0) > 0) { B.enterHut(); B.chestTake('hare', 5); }
      B.chestTake && 0; B.wantGift = true; talk('urk'); B.tick();
      if (f.urkPelts && G.urk.respect < 2 && food() > 0) { B.wantGift = true; talk('urk'); }
      return; }
    if (G.vera.state === 'follow') { escortVera(); return; }
    if (G.vera.state === 'tail') {
      // сначала разбираем хвост с дальней от Веры стороны, потом берём Веру
      if (G.wreck.tail.length && !B.tailTried) { B.tailTried = 1; wreckTail(); return; }
      B.goTo(G.vera.x, G.vera.y + 40, 20); B.wait(1); if (G.vera.state === 'tail') talk('vera'); return;
    }
  }
  function wreckTail() {
    const t = POI.tail; B.goTo(t.x + 70, t.y + 70, 14);
    const c = Actions.context(); L('у хвоста ctx=' + (c && c.k) + ' vera=' + G.vera.state);
    B.wreck('tail');
  }
  function escortVera() {
    L('веду Веру');
    const t0 = B.T;
    const route = [{ x: HUT.x, y: HUT_IN.y1 + 60 }, { x: HUT.x, y: HUT.y + 5 }, { x: SPOT.veraBed.x + 30, y: SPOT.veraBed.y }];
    for (const wpt of route) {
      for (let g = 0; g < 200 && G.vera.state === 'follow'; g++) {
        if (dist(G.vera, G.p) > 180) { if (dist(G.vera, G.p) > 260) B.goTo(G.vera.x, G.vera.y + 30, 80, 8); else B.wait(0.5); continue; }
        const dx = wpt.x - G.p.x, dy = wpt.y - G.p.y, d = Math.hypot(dx, dy);
        if (d < 15) break;
        B.goTo(G.p.x + dx / d * Math.min(d, 120), G.p.y + dy / d * Math.min(d, 120), 12, 6);
      }
    }
    for (let g = 0; g < 60 && G.vera.state === 'follow'; g++) B.wait(0.5);
    L(`Вера: ${G.vera.state} за ${(B.T - t0).toFixed(0)} с`);
  }

  function ch2() {
    const f = G.flags;
    // АКБ заряжается в ящике при горящей печи
    if (Inv.cnt('battery', false) > 0) { B.enterHut(); B.chestAll(); }
    if (G.charge < 100 && haveInHut('battery')) { B.fillStove(); }
    if (!f.tube && !(B.colOpt && B.colOpt.noRescue)) { getTube(); return; }
    if (!Inv.has('antenna', true) && !f.radioBuilt && !(B.colOpt && B.colOpt.noRescue)) { B.enterHut(); B.chestAll(); B.doCraft('antenna'); return; }
    if (!f.radioBuilt) { if (G.charge < 100) { B.fillStove(); B.wait(Math.min(20, (100 - G.charge) * 0.6 + 1)); return; } B.enterHut(); B.chestAll(); B.doCraft('radio'); return; }
    // ждём осаду: запас дров и еды
    if (Inv.cnt('wood', true) < 24 && H() < 16) { B.chop(10, 600); B.enterHut(); B.chestAll(); return; }
    if (food() < 6 && H() < 15) { foodRun(); return; }
    B.enterHut(); B.wait(5);
  }

  function getTube() {
    if (B.tubeByTrade) { tradeTube(); return; }
    L('иду к перекату за лампой');
    B.goTo(TUBE_POS.x - 160, TUBE_POS.y, 16);
    B.allowIce = true;
    const t0 = B.T;
    B.goTo(TUBE_POS.x - 20, TUBE_POS.y, 10, 5);
    const c = Actions.context(); if (c && c.k === 'tube') Actions.interact(true); else L('лампа: ctx ' + (c && c.k));
    B.goTo(TUBE_POS.x - 170, TUBE_POS.y, 16, 5);
    B.allowIce = false;
    L(`лампа ${G.flags.tube ? 'взята' : 'НЕТ'}, на льду ${(B.T - t0).toFixed(1)} с, wet ${G.p.wetT.toFixed(0)}`);
  }
  function tradeTube() {
    const pr = Npc.price(NPCS.urk.trade.goods[0]);
    if (Npc.furTotal() < pr) { B.huntHares(pr - Npc.furTotal(), 90, dayTime); return; }
    talk('urk'); Npc.buy(NPCS.urk.trade.goods[0]); L('лампа обменом: ' + G.flags.tube);
  }

  function padSpot() {
    for (let r = 0; r <= 200; r += 15) for (let a = 0; a < 6.28; a += 0.4) { const x = POI.mar.x + Math.cos(a) * r, y = POI.mar.y + Math.sin(a) * r; if (Colony.canPlace('pad', x, y)) return { x, y }; }
    return null;
  }
  function buildPad() {
    let pad = G.col.builds.find(b => b.type === 'pad');
    if (!pad) {
      const need = BUILDS.pad.cost.wood;
      for (let k = 0; k < 4 && Inv.cnt('wood', true) < need && H() < 16.5; k++) { B.chop(Math.min(12, need - Inv.cnt('wood', true) + Inv.cnt('wood', false)), 600); if (Inv.cnt('wood', true) < need) { B.enterHut(); B.chestAll(); } }
      if (Inv.cnt('wood', true) < need) return;
      const sp = padSpot(); if (!sp) { L('площадка: нет места'); B.wait(3); return; }
      Colony.startPlace('pad'); if (!G.col.ghost) { L('площадка: не ставится'); B.wait(3); return; }
      G.col.ghost.x = sp.x; G.col.ghost.y = sp.y; Colony.place();
      pad = G.col.builds.find(b => b.type === 'pad'); L('площадка поставлена: ' + !!pad);
      if (!pad) { B.wait(2); return; }
    }
    B.goTo(pad.x, pad.y + 55, 14);
    const t0 = B.T;
    while (!pad.done && H() < 16.8 && H() >= 7 && B.T - t0 < 90) {
      const c = Actions.context();
      if (c && c.k === 'site') { Actions.interact(true); B.tick(); } else { B.goTo(pad.x, pad.y + 50, 8, 4); B.tick(); }
      B.survive(); if (G.s.food < 40) B.tryEat(true);
    }
    L(`площадка ${Math.floor(pad.prog * 100)}% за ${(B.T - t0).toFixed(0)} с${pad.done ? ' ✓' : ''}`);
  }
  function ch3() {
    const f = G.flags;
    const stacksOk = () => G.stacks.every(s => s.wood >= 4 || s.lit > 0);
    if (!f.contact) { if (Inv.cnt('wood', true) < 24 && H() < 16) { B.chop(10, 600); B.enterHut(); B.chestAll(); return; } B.enterHut(); B.wait(5); return; }
    if (!padDone() && H() < 16.5 && H() >= 7 && !G.heli) { buildPad(); return; }
    if (!stacksOk() && H() < 15.5 && !G.heli) { buildStacks(); return; }
    if (f.contact && !G.heli && H() < 9 && H() >= 7) { goMarWait(); return; }
    if (G.heli) { lightAll(); return; }
    B.enterHut(); B.wait(5);
  }
  function buildStacks() {
    const need = G.stacks.reduce((s, x) => s + Math.max(0, 4 - x.wood), 0);
    L('кучи: нужно ' + need);
    B.goTo(POI.mar.x, POI.mar.y + 320, 20);
    for (const s of G.stacks) {
      while (s.wood < 4 && H() < 16.5) {
        if (Inv.cnt('wood', false) < 1) { B.chop(Math.min(8, need), 500); }
        B.goTo(s.x, s.y + 30, 12);
        const c = Actions.context(); if (c && c.k === 'stack') { Actions.interact(true); B.wait(0.3); } else { B.goTo(s.x, s.y + 10, 8, 4); }
      }
    }
  }
  function goMarWait() {
    B.goTo(POI.mar.x, POI.mar.y, 20);
    // ремонт после медведя
    for (const s of G.stacks) while (s.wood < 4 && !G.heli) { if (Inv.cnt('wood', false) < 1) B.chop(4, 450); B.goTo(s.x, s.y + 30, 12); Actions.interact(true); B.wait(0.3); }
    B.goTo(POI.mar.x, POI.mar.y + 30, 12);
    B.wait(60, () => !!G.heli || H() >= 12);
    if (G.heli) lightAll();
  }
  function lightAll() {
    L('🚁 гул! поджигаю');
    for (const s of G.stacks) {
      if (s.lit > 0) continue;
      B.goTo(s.x, s.y + 30, 12);
      if (s.wood < 4) { while (s.wood < 4 && Inv.cnt('wood', false) > 0) { Actions.interact(true); B.wait(0.3); } }
      const c = Actions.context(); if (c && c.k === 'stack') { Actions.interact(true); B.wait(1.7); }
    }
    B.wait(3);
    L('rescued=' + G.flags.rescued);
    B.wait(8);
  }

  function upkeep() {
    if (G.vera.state === 'follow') return false;
    // стройка, как только хватает ресурсов — но не тащить героя чинить дверь/щели через полмира:
    // с главы V это делаем рядом с избой отдельно (см. B.run), а col.js поверх upkeep() ведёт торг
    // и подкормку посёлка — это должно работать независимо от того, где сейчас герой
    const nearHut2 = Math.hypot(G.p.x - HUT.x, G.p.y - HUT.y) < 1200;
    for (const id of nearHut2 ? ['walls', 'bench', 'door'] : []) {
      if (G.hut[id]) continue;
      const u = HUT_UPG.find(x => x.id === id), needW = u.in.wood || 0;
      if (Inv.cnt('scrap', true) < (u.in.scrap || 0)) continue;
      if (Inv.cnt('wood', true) < needW + 6) { B.chop(Math.min(12, needW + 6 - Inv.cnt('wood', true) + Inv.cnt('wood', false)), 600); }
      B.enterHut(); B.chestAll(); B.build(id); return true;
    }
    if ((G.vera.state === 'hut' || G.vera.state === 'dead') && G.wreck.tail.length) { wreckTail(); return true; }
    if (Inv.cnt('battery', false) > 0) { B.enterHut(); B.chestAll(); return true; }
    return false;
  }
  B.upkeep = upkeep;

  // ---------- главы V–VII: посёлок / экспедиция (SPEC-world §9) ----------
  // переход в зону: первый раз — пешком (открывает Transport.open), дальше — быстрый переход
  // Transport.travel (A7: время/еда/тепло по-честному, как в самой игре); иначе — идти своими ногами.
  function zoneGo(id, tol = 260, maxT = 700) {
    if (Zones.idAt(G.p.x, G.p.y) === id) return true;
    if (!Transport.why(id) && Transport.travel(id)) return true;
    const c = Zones.camp(ZONES[id]);
    return B.goTo(c.x, c.y, tol, maxT);
  }
  B.zoneGo = zoneGo;
  // БЛОКЕР (D/E): у построек зон (буровая и т.п.) chopOne() иногда не может дотянуться до дерева рядом —
  // warmUp(), вызываемый из survive() на каждом тике (goTo/huntHares), молча не разводит огонь на этом
  // месте снова и снова, тепло идёт к нулю без единой попытки отойти. Раньше это лечилось только внутри
  // campNight(); теперь — и в самом warmUp(), для любого места и времени с главы V.
  const oWarmUp = B.warmUp; let warmFails = 0;
  B.warmUp = function () {
    // мёртвая зона: рядом с избой новый костёр не разжечь (fireKey отказывает «слишком близко»), а до
    // печи ещё не дошли — герой на подходе домой мог часами мёрзнуть без единой удачной попытки согреться.
    const homeDist = Math.hypot(G.p.x - HUT.x, G.p.y - HUT.y);
    if (G.chapter >= 4 && !G.p.inside && homeDist < 500) { warmFails = 0; B.enterHut(); return; }
    const w0 = G.s.warm;
    oWarmUp();
    if (G.chapter < 4 || G.p.inside || G.s.warm > w0 + 0.5) { warmFails = 0; return; }
    // не помогло — считаем подряд идущие провалы (даже если warmUp() зовут из разных мест: survive(),
    // campNight()…): 2 подряд без толку — идём греться туда, где это реально быстро.
    // БЛОКЕР (E): «туда, где реально быстро» раньше означало всегда избу — а в главе VII (метеостанция
    // за тысячи px от избы) это верная смерть в дороге по морозу без единого шанса согреться: герой
    // умирал «в чистом поле» на полпути домой, так и не дойдя. Далеко от избы — не идём домой, а просто
    // рубим шире (локальный лес у долгой стоянки выбивается — деревья не отрастают, TUNE/js/world.js).
    // БЛОКЕР (D): тот же голод по дровам бьёт и у избы — посёлок (col.js: bichs рубят на прокорм) сам
    // выедает лес в 700–1300 px за 10–12 игровых дней (лог: «лес у (…) кончился → …»); герой упирается
    // в ту же стену на подходе к зонам главы V. Радиус со временем только растёт (fails, не сбрасывается
    // при неудаче) — рано или поздно долетаем до ещё не тронутого леса, а не топчемся на том же пятне.
    // рядом с избой мороз убивает быстро (десятки секунд от полного тепла до 0, TUNE.body.coldDmg) —
    // ждать вторую подряд неудачу здесь не время терять: изба рядом и дешева, отступаем сразу.
    if (homeDist < 1500) { warmFails = 0; B.enterHut(); return; }
    warmFails++;
    if (warmFails >= 2) {
      const r = Math.min(4500, 1500 + 900 * (warmFails - 1));
      B.chop(3, r);
      if (Inv.cnt('wood', false) >= 3) warmFails = 0;
      return;
    }
    B.goTo(G.p.x + rnd(-400, 400), G.p.y + rnd(-400, 400), 20, 25);
  };
  // обыск объекта зоны (буровая, метеостанция…) — как разбор обломков: подойти, E, пока не кончится
  function zoneLoot(id, maxN = 99) {
    const o = Zones.obj(id); if (!o) return 0;
    const r = (o.solid || 30) + 40;
    B.goTo(o.x, o.y + r - 10, 16, 400);
    let n = 0;
    for (; n < maxN; n++) {
      let c = Actions.context();
      if (!c || c.k !== 'loot') { B.goTo(o.x + 15, o.y + r - 25, 8, 6); c = Actions.context(); if (!c || c.k !== 'loot') break; }
      Actions.interact(true);
      B.wait(6, () => !G.p.action);
      B.survive();
    }
    L(`обыскал ${id}: ${n} шт`);
    return n;
  }
  B.zoneLoot = zoneLoot;
  // БЛОКЕР (D/E): мясо от охоты на зайцев — это и добыча для quest'а, и приоритетная еда героя разом
  // (FOOD_ORDER); survive()/tryEat() в тех же тиках съедают его раньше, чем счётчик доходит до нужного n —
  // ch4()/ensureKero() крутили huntHares в бесконечном цикле, ни разу не добравшись до буровой.
  // Лечим складом: излишки сразу в лабаз (там их герой не ест, wc=false вне избы), нужное количество
  // забираем с запасом прямо перед выходом к NPC.
  function ensureMeat(n) {
    // не заходим в избу за добавкой: герой мог быть уже далеко (буровая/стойбище/метео) — второй поход
    // туда-обратно топит главу V. Охотимся прямо на месте (зайцы есть везде — радиус спавна вокруг героя),
    // с запасом на то, что часть мяса survive() съест по дороге.
    let guard = 0;
    while (Inv.cnt('meat', false) < n && guard++ < 6) B.huntHares(3, 90, () => true);
    return Inv.cnt('meat', false) >= n;
  }
  B.ensureMeat = ensureMeat;
  // керосин для Тамары: хвост Ми-8 (уже разобран в главе II) → сам дом метеостанции (там же и кабель на
  // мачту) → иначе Михалыч, буровая: мясо ×3 → :kero:×2.
  // БЛОКЕР (E): раньше сразу после хвоста шёл Михалыч на буровую — крюк через весь мир и обратно
  // (метео на юго-западе, буровая на юго-востоке), хотя герой уже стоит у метеостанции и в её же доме
  // лежит керосин (js/content/zones.js: meteoHouse.loot). Обыскиваем дом раньше похода к Михалычу.
  function ensureKero(n) {
    if (Inv.cnt('kero', false) >= n) return true;
    if (G.wreck.tail.length) wreckTail();
    if (Inv.cnt('kero', false) >= n) return true;
    if (Zones.idAt(G.p.x, G.p.y) === 'meteo' && (G.loot.meteoHouse || []).length) {
      zoneLoot('meteoHouse', 10);
      if (Inv.cnt('kero', false) >= n) return true;
    }
    if (!G.flags.mikhMeatDone) {
      if (!ensureMeat(3)) return false;
      zoneGo('drill'); talk('mikhalych'); return false;
    }
    return Inv.cnt('kero', false) >= n;
  }
  // ночь вдали от избы (буровая/стойбище/метеостанция) — без сна, у костра
  function campNight() {
    L('ночь у костра — далеко от избы');
    const t0 = B.T;
    // проверить еду ДО того, как навалится холод — двойной кризис (и без еды, и без тепла разом) хуже,
    // чем два по отдельности: warmUp() тоже требует ходить/рубить, а на это уходит еда
    if (Inv.cnt('food', false) === 0 && G.s.food < 60) B.huntHares(2, 60, () => true);
    while (!(hourOf() >= 7 && hourOf() < 12) && B.T - t0 < 500) {
      // БЛОКЕР (D/E): у campNight() свой цикл, он не отдаёт ход общему циклу B.run — bearAware()
      // там просто не успевал сработать, пока герой торчал тут все ночные часы вслепую.
      if (bearAware()) continue;
      // реагируем раньше (60, не 45) — эскалацию «отойти / идти в избу» ведёт сам B.warmUp() (см. выше)
      if (G.s.warm < 60) B.warmUp();
      if (G.s.food < 40 && Inv.cnt('food', false) === 0) B.huntHares(2, 40, () => true);
      if (G.s.food < 55) B.tryEat(true);
      B.wait(3);
    }
  }
  B.campNight = campNight;
  // БЛОКЕР (D/E): вдали от избы у героя нет ни факела под рукой, ни печи — а рефлекс bot.js бьёт шатуна
  // врукопашную (getHit ~50) на любом расстоянии ≤80. В поле от шатуна лучше уходить, а не драться.
  function bearAware() {
    const b = G.bear; if (!b || b.st === 'gone' || b.st === 'flee' || b.st === 'fleeHurt') return false;
    const d = Math.hypot(b.x - G.p.x, b.y - G.p.y);
    if (d > 500 || G.p.torch > 0) return false;
    // огонь рядом (от warmUp/ночёвки) — факел безопаснее голых рук: 2× урон + шатун от него отпрянет (Bear.hit)
    if (Fire.near(TUNE.fire.heatR) && Inv.cnt('wood', false) >= 1) { Actions.craft(RECIPES.find(r => r.id === 'torch')); return false; }
    if (d > 260) {
      const a = Math.atan2(G.p.y - b.y, G.p.x - b.x);
      input.mx = Math.cos(a); input.my = Math.sin(a);
      B.tick(); B.survive();
      return true;
    }
    return false;
  }
  B.bearAware = bearAware;

  // V «Промысел»: три участка — буровая (Михалыч), стойбище (Уялан), метеостанция (Тамара);
  // эпоху «Посёлок» и постройки продолжает вести col.js (общая логика по TUNE/BUILDS/EPOCHS)
  function ch4() {
    const f = G.flags, plots = G.plots || {};
    if (B.dbg) L(`ch4 dbg: plots=${JSON.stringify(plots)} mikhMeatDone=${!!f.mikhMeatDone} meat=${Inv.cnt('meat',false)} chestMeat=${G.chest.meat||0} pos=${G.p.x|0},${G.p.y|0} zone=${Zones.idAt(G.p.x,G.p.y)}`);
    // БЛОКЕР (D/E): к главе V мороз днём уже за −40° (TUNE.temp), а поход по зонам без избы —
    // долгие часы вне тепла. Дешёвая ушанка (:hare:×3, холод −15%) резко снижает обморожение
    // и накопленную «усталость» тепла к вечернему бою с шатуном у избы.
    if (!G.gear.hat && !G.gear.dokha && !G.gear.kukhl && Inv.cnt('hare', true) >= 3) { B.enterHut(); B.doCraft('hat'); }
    // к 20-му дню мороз днём уже за −55°: одна ушанка не спасает — доха (:wolf:×2 :hare:×2, холод −30%)
    // почти всегда есть с чего сшить (шкуры волков от ночных стычек и стаи в главах II–III)
    if (!G.gear.dokha && !G.gear.kukhl && G.day >= 10 && Inv.cnt('wpelt', true) >= 2 && Inv.cnt('hare', true) >= 2) { B.enterHut(); B.doCraft('dokha'); }
    ensureSled();
    if (!plots.drill) {
      if (!f.mikhMeatDone) {
        if (!ensureMeat(3)) return;
        zoneGo('drill'); talk('mikhalych'); return;
      }
      zoneGo('drill'); talk('mikhalych'); return;
    }
    if (!plots.stoibishe) { zoneGo('stoibishe'); talk('uyalan'); return; }
    if (!plots.meteo) {
      if (!f.tamaraKero) { if (!ensureKero(2)) return; zoneGo('meteo'); talk('tamara'); return; }
      zoneGo('meteo'); talk('tamara'); return;
    }
    if (Inv.cnt('wood', true) < 12) { B.chop(9, 700); B.enterHut(); B.chestAll(); return; }
    B.enterHut(); B.wait(5);
  }

  // VI «Зимовка»: запас в лабазе (дрова/еда) — дальше сама переживёт большую пургу и закроется концовкой D
  function ch5() {
    const need = STORY.winter;
    const foodChest = () => FOOD_KEYS.reduce((s, k) => s + (G.chest[k] || 0), 0);
    if ((G.chest.wood || 0) < need.wood + 10) { B.chop(12, 700); B.enterHut(); B.chestAll(); return; }
    if (foodChest() < need.food + 4) { foodRun(); B.enterHut(); B.chestAll(); return; }
    B.enterHut(); B.wait(5);
  }

  // БЛОКЕР (D/E): в поле выбросить лишний груз некуда (нет ни склада, ни «выбросить») — за несколько
  // суток похода/разъездов по зонам копятся дрова/пушнина/детали, и герой рано или поздно упирается в
  // Inv.capKg: рубка (js/actions.js: case 'tree') тогда молча отказывает — без дров нечем греться,
  // замерзает насмерть («рубка +0», хотя лес рядом есть). Нарты (+20 кг, RECIPES.sled) — обычные сборы
  // в дальний поход/промысел; без флага-защёлки — G.gear.sled сам не откатывается чекпоинтом, условие
  // само гаснет, когда сшиты. Общая для V (ch4, разъезды по зонам) и VII (ch6, поход к метеостанции).
  function ensureSled() {
    if (G.gear.sled || Math.hypot(G.p.x - HUT.x, G.p.y - HUT.y) >= 2000) return;
    if (!G.p.inside) B.enterHut();
    if (!Inv.canPay(RECIPES.find(r => r.id === 'sled').in, true)) { B.chop(6, 700); B.enterHut(); B.chestAll(); return; }
    B.doCraft('sled');
  }

  // VII «Экспедиция»: припасы в рюкзаке, Вера, дойти до метеостанции, керосин + кабель Тамаре, сеанс, борт у мачты
  function ch6() {
    const f = G.flags;
    if (!f.expArrived) ensureSled();
    // БЛОКЕР (E): герой уходит на несколько суток к метеостанции, а в ящике избы часто уже лежит
    // керосин и кабель (хвост Ми-8, глава II) — забытые дома, они потом оборачивались крюком на
    // буровую ради того же керосина (см. ensureKero). Собираем со склада, пока изба рядом.
    // Флаг-защёлку на боте (B.*) намеренно не ставим: после смерти игра откатывается к чекпоинту
    // главы (склад полон снова), а флаг на боте — нет, «один раз и хватит» тут просто теряет запас
    // при повторной жизни. Условие само перестаёт быть верным, когда склад опустел — этого достаточно.
    if (!f.expArrived && (G.chest.kero || G.chest.cable) && Math.hypot(G.p.x - HUT.x, G.p.y - HUT.y) < 2000) {
      if (!G.p.inside) B.enterHut();
      const k = G.chest.kero ? B.chestTake('kero', G.chest.kero) : 0, c = G.chest.cable ? B.chestTake('cable', G.chest.cable) : 0;
      L(`в поход со склада: керосин +${k}, кабель +${c}`);
    }
    if (!f.veraDead && G.vera.state === 'hut' && !f.expArrived) talk('vera');
    if (!f.expArrived) {
      // та же ловушка, что и с мясом Михалычу: survive() съедает добытое раньше, чем наберётся 4 —
      // «Припасы ×4» — это цель HUD (flags.expPacked), не шлагбаум движка: набирать их до упора перед
      // выходом бессмысленно — survive() съедает добытое быстрее, чем накопится запас (та же ловушка,
      // что и с мясом Михалычу), и герой навсегда застревал у избы. Просто трогаемся — еда добудется
      // по дороге и на месте, как и в главе V.
      if (Inv.cnt('food', false) + Inv.cnt('honey', false) < 2) { B.huntHares(2, 60, () => true); return; }
      zoneGo('meteo'); return;
    }
    // БЛОКЕР (E): у Тамары герой торчит сутками (сеанс, потом борт) — местный лес (в радиусе, где вообще
    // что-то происходит: дом/мачта/будка) быстро выбивается и не отрастает (js/world.js), а «клиренсы»
    // вокруг построек зоны (Zones: o.clear) и так режут ближайшие деревья. У Тамары есть печь — есть и
    // запас дров в доме (js/content/zones.js: meteoHouse.loot); подбираем часть сразу, не весь стог разом
    // (не раздувать вес), остальное — резерв на потом (см. ниже, в ожидании борта).
    if (f.expArrived && (G.loot.meteoHouse || []).length > 6) zoneLoot('meteoHouse', G.loot.meteoHouse.length - 6);
    if (!f.tamaraKero) { if (!ensureKero(2)) return; talk('tamara'); return; }
    if (!f.mastFixed) {
      if (Inv.cnt('cable', false) < 2) { zoneLoot('meteoHouse', 4); return; }
      talk('tamara'); return;
    }
    if (!f.expCalled) { talk('tamara'); B.wait(5); return; }
    if (!f.expRescued) {
      // БЛОКЕР (E): борт садится, только если герой физически в зоне метеостанции ровно в окне 9–12ч
      // (js/content/events.js: expHeli). Пока ждём борт — дрова/зайцы уводили героя за 1000+ px от
      // мачты (радиус зоны), и он спокойно пропускал окно на день, а то и на несколько — до самой
      // смерти от голода/холода в ожидании. Держимся в зоне; если унесло — сперва возвращаемся.
      if (Zones.idAt(G.p.x, G.p.y) !== 'meteo') { zoneGo('meteo'); return; }
      if (Inv.cnt('food', false) + Inv.cnt('honey', false) < 2) { B.huntHares(2, 60, () => Zones.idAt(G.p.x, G.p.y) === 'meteo'); return; }
      if (Inv.cnt('wood', false) < 3) {
        // сперва — резерв из дома Тамары (надёжнее, чем гонять по выбитому лесу), потом уже топор,
        // сперва рядом (500), потом шире (1600) — локальный лес у долгой стоянки не бесконечен.
        if ((G.loot.meteoHouse || []).length) zoneLoot('meteoHouse', 3);
        if (Inv.cnt('wood', false) < 3) B.chop(4, 500);
        if (Inv.cnt('wood', false) < 3) B.chop(4, 1600);
        return;
      }
      B.wait(10); return;
    }
    B.wait(5);
  }

  // ---------- главный цикл ----------
  B.run = function (limitReal = 60 * 60) {
    if (B.fixBed) { SPOT.veraBed.x = HUT.x + 20; SPOT.veraBed.y = HUT.y; L('what-if: кровать Веры сдвинута'); }
    const res = { deaths: [] };
    let guard = 0;
    while (guard++ < 40000) {
      try {
        if (state === 'over') break;
        if (B.R > limitReal) { L('лимит времени'); break; }
        const h = H();
        const farHut = G.chapter >= 4 && Math.hypot(G.p.x - HUT.x, G.p.y - HUT.y) > 900;
        // БЛОКЕР: bearAware() (голое бегство) — только вдали от избы, где bearDefense() (факел от печи)
        // недостижим. У избы шатуна обязан встречать night()/bearDefense() ниже — он и с факелом, и умеет
        // затащить героя внутрь; bearAware() тут раньше перехватывал цикл и не давал до него дойти.
        if (farHut && bearAware()) continue;
        // БЛОКЕР (D/E): выключив upkeep() с главы V (не тащить героя домой из-за двери через полмира),
        // мы заодно оставили дверь сломанной навсегда — а без двери шатун бьёт «изнутри» избы (bear.js:
        // !(p.inside && G.hut.door) не спасает), причём именно в вечернем ожидании 19:00 (night(), bot.js:246)
        // защиты вообще нет. Чиним дверь только когда и так рядом с избой — не отдельный поход.
        if (G.chapter >= 4 && !farHut && !G.hut.door && Inv.canPay({ wood: 4, scrap: 1 }, true)) { B.enterHut(); B.chestAll(); B.build('door'); }
        if (G.p.inside) feedVeraIfNeeded();
        if (!farHut && h >= 15.8 && h < 17.2 && Inv.cnt('wood', true) < 10) { B.chop(9, 600); B.enterHut(); B.chestAll(); continue; }
        if (h >= 17.2 || h < 6.9) {
          if (farHut) { campNight(); continue; }
          B.night({
            at19: () => {
              feedVeraIfNeeded();
              if (G.flags.radioBuilt && !G.flags.contact) {
                B.goTo(SPOT.bench.x, SPOT.bench.y + 20, 10);
                B.wait(40, () => H() >= 19.55); Actions.radioSession(); B.tick(); L('связь вечером: ' + !!G.flags.contact);
              }
            }
          });
          // утренний сеанс
          if (G.flags.radioBuilt && !G.flags.contact) { B.goTo(SPOT.bench.x, SPOT.bench.y + 20, 10); B.wait(20, () => H() >= 7.55); Actions.radioSession(); B.tick(); L('связь утром: ' + !!G.flags.contact); }
          feedVeraIfNeeded();
          continue;
        }
        // БЛОКЕР (D/E): food() — общий склад (рюкзак+лабаз); с главы V его же ест посёлок (10+ человек),
        // поэтому «меньше 3» почти всегда истинно и foodRun() навсегда перехватывает цикл, не давая
        // дойти до ch4/ch5/ch6. С главы V меряем голод самого героя (G.s.food), а не общий склад.
        if (G.chapter < 4 && food() < 3 && H() < 16) { foodRun(); continue; }
        if (G.chapter >= 4 && G.s.food < 15 && H() < 16) { B.huntHares(2, 60, () => true); continue; }
        if (G.s.food < 50) B.tryEat(true);
        // БЛОКЕР (существовал и до этой правки): тут всегда звался «голый» upkeep() — локальная функция
        // этого файла, а не B.upkeep. col.js оборачивает именно B.upkeep (торг у фактории, экстренная
        // охота/рубка — tests/col.js:226-227), но тот код никогда не вызывался: без правки посёлок никогда
        // не торгует, из-за чего железо (:scrap:) для эпох II–III взять неоткуда, кроме находок героя.
        if (G.chapter >= 1 && dayTime() && H() < 15 && B.upkeep()) continue;
        const T0 = B.T;
        [ch0, ch1, ch2, ch3, ch4, ch5, ch6][G.chapter]();
        B.tick();
        if (B.T - T0 < 0.2) B.wait(1);
      } catch (e) {
        if (e instanceof B.Dead) {
          const d = { title: document.getElementById('o-title').textContent, ch: G.chapter, day: G.day, h: hourOf().toFixed(1), cause: G.cause, R: +(B.R / 60).toFixed(1) };
          if (G.flags.rescued || [ENDINGS.C, ENDINGS.D, ENDINGS.E].some(e => d.title === e[1])) { L('КОНЕЦ ' + d.title); break; }
          res.deaths.push(d); L('СМЕРТЬ ' + JSON.stringify(d));
          if (state === 'over' && !document.getElementById('o-retry').hidden && res.deaths.length < 6) { document.getElementById('o-retry').click(); input.mx = input.my = 0; continue; }
          break;
        }
        L('ERR ' + e.message + ' ' + e.stack.split('\n').slice(0, 3).join(' | ')); break;
      }
    }
    res.ending = document.getElementById('over').hidden ? null : document.getElementById('o-title').textContent;
    return res;
  };
})();
