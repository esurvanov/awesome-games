// Мозг бота: выбирает следующую задачу по состоянию игры.
(function () {
  const B = window.BOT, L = B.L;
  const food = wc => FOOD_ORDER.reduce((s, k) => s + cnt(k, true), 0);
  const H = () => hourOf();
  const dayTime = () => H() >= 7 && H() < 17.2;

  B.pick = (txt) => {
    const f = s => txt.findIndex(t => t.includes(s));
    if (f('Остаться') >= 0) return B.colOpt && B.colOpt.noRescue ? f('Остаться') : f('Ждать');
    if (f('Помоги нам') >= 0) return f('Помоги нам');
    if (f('Отдать') >= 0) return f('Отдать');
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
      G.p.x = x; G.p.y = y; G.p.inside = insideHut(x, y); const c = context();
      G.p.x = sx; G.p.y = sy; G.p.inside = si;
      if (c && c.k === who) return { x, y };
    }
    return { x: o.x, y: o.y + (ins ? -32 : 30) };
  }
  function talk(who) {
    const o = who === 'urk' ? G.urk : G.vera;
    B.goTo(o.x, o.y + (insideHut(o.x, o.y) ? -30 : 40), 30, 60);
    for (let k = 0; k < 6; k++) { const c = context(); if (c && c.k === who) break; const sp = spotFor(who, o); B.goTo(sp.x, sp.y, 4, 8); }
    const c = context(); if (!c || c.k !== who) { L('не дотянулся до ' + who + ' ctx ' + (c && c.k)); return false; }
    interact(false); B.tick(); B.tick(); return true;
  }
  B.talk = talk;

  function ensureWood(n, maxDist = 700) { if (cnt('wood', false) < n) B.chop(n, maxDist); }
  function haveInHut(k) { return cnt(k, true); }

  function feedVeraIfNeeded() {
    const v = G.vera; if (v.state !== 'hut') return;
    if (v.food < 2 && food() > 1) { if (!G.p.inside) B.enterHut(); B.wantFeed = true; const f0 = v.food; talk('vera'); B.wantFeed = false; L(`Вера: еда ${f0} → ${v.food}`); }
  }

  function foodRun() {
    // лабаз — бесплатное мясо
    if (!G.labaz) { L('иду к лабазу'); B.goTo(POI.labaz.x - 60, POI.labaz.y + 40, 14); for (let k = 0; k < 5 && !G.labaz; k++) { B.goTo(POI.labaz.x - 42, POI.labaz.y + 18 - k * 6, 6, 10); const c = context(); B.labazCtx = c && c.k; interact(false); B.tick(); } L('лабаз: ' + G.labaz); return; }
    B.huntHares(3, 60, dayTime);
  }

  // ---------- задачи глав ----------
  function ch0() {
    const f = G.flags;
    if (!G.notes.log) { B.readNote('log'); B.readNote('pilot'); return; }
    if (G.wreck.cockpit.length) { B.wreck('cockpit'); return; }
    if (!f.stoveLit) { ensureWood(8, 600); B.enterHut(); B.chestAll(); B.fillStove(secPerLog() * 2); return; }
    if (!G.hut.walls) { ensureWood(6 - (G.chest.wood || 0) > 0 ? 9 : 3, 600); B.enterHut(); B.chestAll(); B.build('walls'); return; }
    if (!G.hut.bench) { ensureWood(8, 600); B.enterHut(); B.chestAll(); B.build('bench'); return; }
    if (!G.hut.door) { ensureWood(8, 600); B.enterHut(); B.chestAll(); B.build('door'); return; }
    // запасы на ночь
    if (cnt('wood', true) < 12) { ensureWood(9, 600); B.enterHut(); B.chestAll(); return; }
    if (!B.snared && cnt('scrap', true) >= 1 && G.hut.bench) { B.enterHut(); B.chestTake('scrap', 1); B.doCraft('snare'); B.snared = 1; }
    if (cnt('snare', false) > 0) { B.goTo(HUT.x + 400, HUT.y + 200, 20); placeKey(); B.wait(2.2); B.goTo(HUT.x + 400, HUT.y - 250, 20); placeKey(); B.wait(2.2); return; }
    // ранний вечер — ждём
    B.enterHut(); B.wait(5);
  }

  function ch1() {
    const f = G.flags, u = G.urk;
    if (!f.metUrk) { if (u.state === 'away') { B.wait(3); return; } talk('urk'); return; }
    if (G.traps.some(t => t.catch)) { for (const t of G.traps.filter(t => t.catch)) { B.goTo(t.x, t.y + 20, 14); const c = context(); if (c && c.k === 'trap') interact(true); B.tick(); } return; }
    if (!f.urkPelts && cnt('hare', true) < 2) { B.huntHares(2 - cnt('hare', true), 120, dayTime); return; }
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
    const c = context(); L('у хвоста ctx=' + (c && c.k) + ' vera=' + G.vera.state);
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
    if (cnt('battery', false) > 0) { B.enterHut(); B.chestAll(); }
    if (G.charge < 100 && haveInHut('battery')) { B.fillStove(); }
    if (!f.tube && !(B.colOpt && B.colOpt.noRescue)) { getTube(); return; }
    if (!has('antenna', true) && !f.radioBuilt && !(B.colOpt && B.colOpt.noRescue)) { B.enterHut(); B.chestAll(); B.doCraft('antenna'); return; }
    if (!f.radioBuilt) { if (G.charge < 100) { B.fillStove(); B.wait(Math.min(20, (100 - G.charge) * 0.6 + 1)); return; } B.enterHut(); B.chestAll(); B.doCraft('radio'); return; }
    // ждём осаду: запас дров и еды
    if (cnt('wood', true) < 24 && H() < 16) { B.chop(10, 600); B.enterHut(); B.chestAll(); return; }
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
    const c = context(); if (c && c.k === 'tube') interact(true); else L('лампа: ctx ' + (c && c.k));
    B.goTo(TUBE_POS.x - 170, TUBE_POS.y, 16, 5);
    B.allowIce = false;
    L(`лампа ${G.flags.tube ? 'взята' : 'НЕТ'}, на льду ${(B.T - t0).toFixed(1)} с, wet ${G.p.wetT.toFixed(0)}`);
  }
  function tradeTube() {
    const pr = price(TRADES[0]);
    if (furTotal() < pr) { B.huntHares(pr - furTotal(), 90, dayTime); return; }
    talk('urk'); buy(TRADES[0]); L('лампа обменом: ' + G.flags.tube);
  }

  function padSpot() {
    for (let r = 0; r <= 200; r += 15) for (let a = 0; a < 6.28; a += 0.4) { const x = POI.mar.x + Math.cos(a) * r, y = POI.mar.y + Math.sin(a) * r; if (Colony.canPlace('pad', x, y)) return { x, y }; }
    return null;
  }
  function buildPad() {
    let pad = G.col.builds.find(b => b.type === 'pad');
    if (!pad) {
      const need = BUILDS.pad.cost.wood;
      for (let k = 0; k < 4 && cnt('wood', true) < need && H() < 16.5; k++) { B.chop(Math.min(12, need - cnt('wood', true) + cnt('wood', false)), 600); if (cnt('wood', true) < need) { B.enterHut(); B.chestAll(); } }
      if (cnt('wood', true) < need) return;
      const sp = padSpot(); if (!sp) { L('площадка: нет места'); B.wait(3); return; }
      Colony.startPlace('pad'); if (!G.col.ghost) { L('площадка: не ставится'); B.wait(3); return; }
      G.col.ghost.x = sp.x; G.col.ghost.y = sp.y; Colony.place();
      pad = G.col.builds.find(b => b.type === 'pad'); L('площадка поставлена: ' + !!pad);
      if (!pad) { B.wait(2); return; }
    }
    B.goTo(pad.x, pad.y + 55, 14);
    const t0 = B.T;
    while (!pad.done && H() < 16.8 && H() >= 7 && B.T - t0 < 90) {
      const c = context();
      if (c && c.k === 'site') { interact(true); B.tick(); } else { B.goTo(pad.x, pad.y + 50, 8, 4); B.tick(); }
      B.survive(); if (G.s.food < 40) B.tryEat(true);
    }
    L(`площадка ${Math.floor(pad.prog * 100)}% за ${(B.T - t0).toFixed(0)} с${pad.done ? ' ✓' : ''}`);
  }
  function ch3() {
    const f = G.flags;
    const stacksOk = () => G.stacks.every(s => s.wood >= 4 || s.lit > 0);
    if (!f.contact) { if (cnt('wood', true) < 24 && H() < 16) { B.chop(10, 600); B.enterHut(); B.chestAll(); return; } B.enterHut(); B.wait(5); return; }
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
        if (cnt('wood', false) < 1) { B.chop(Math.min(8, need), 500); }
        B.goTo(s.x, s.y + 30, 12);
        const c = context(); if (c && c.k === 'stack') { interact(true); B.wait(0.3); } else { B.goTo(s.x, s.y + 10, 8, 4); }
      }
    }
  }
  function goMarWait() {
    B.goTo(POI.mar.x, POI.mar.y, 20);
    // ремонт после медведя
    for (const s of G.stacks) while (s.wood < 4 && !G.heli) { if (cnt('wood', false) < 1) B.chop(4, 450); B.goTo(s.x, s.y + 30, 12); interact(true); B.wait(0.3); }
    B.goTo(POI.mar.x, POI.mar.y + 30, 12);
    B.wait(60, () => !!G.heli || H() >= 12);
    if (G.heli) lightAll();
  }
  function lightAll() {
    L('🚁 гул! поджигаю');
    for (const s of G.stacks) {
      if (s.lit > 0) continue;
      B.goTo(s.x, s.y + 30, 12);
      if (s.wood < 4) { while (s.wood < 4 && cnt('wood', false) > 0) { interact(true); B.wait(0.3); } }
      const c = context(); if (c && c.k === 'stack') { interact(true); B.wait(1.7); }
    }
    B.wait(3);
    L('rescued=' + G.flags.rescued);
    B.wait(8);
  }

  function upkeep() {
    if (G.vera.state === 'follow') return false;
    // стройка, как только хватает ресурсов
    for (const id of ['walls', 'bench', 'door']) {
      if (G.hut[id]) continue;
      const u = HUT_UPG.find(x => x.id === id), needW = u.in.wood || 0;
      if (cnt('scrap', true) < (u.in.scrap || 0)) continue;
      if (cnt('wood', true) < needW + 6) { B.chop(Math.min(12, needW + 6 - cnt('wood', true) + cnt('wood', false)), 600); }
      B.enterHut(); B.chestAll(); B.build(id); return true;
    }
    if ((G.vera.state === 'hut' || G.vera.state === 'dead') && G.wreck.tail.length) { wreckTail(); return true; }
    if (cnt('battery', false) > 0) { B.enterHut(); B.chestAll(); return true; }
    return false;
  }
  B.upkeep = upkeep;
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
        if (G.p.inside) feedVeraIfNeeded();
        if (h >= 15.8 && h < 17.2 && cnt('wood', true) < 10) { B.chop(9, 600); B.enterHut(); B.chestAll(); continue; }
        if (h >= 17.2 || h < 6.9) {
          B.night({
            at19: () => {
              feedVeraIfNeeded();
              if (G.flags.radioBuilt && !G.flags.contact) {
                B.goTo(SPOT.bench.x, SPOT.bench.y + 20, 10);
                B.wait(40, () => H() >= 19.55); radioSession(); B.tick(); L('связь вечером: ' + !!G.flags.contact);
              }
            }
          });
          // утренний сеанс
          if (G.flags.radioBuilt && !G.flags.contact) { B.goTo(SPOT.bench.x, SPOT.bench.y + 20, 10); B.wait(20, () => H() >= 7.55); radioSession(); B.tick(); L('связь утром: ' + !!G.flags.contact); }
          feedVeraIfNeeded();
          continue;
        }
        if (food() < 3 && G.chapter >= 1 && H() < 16) { foodRun(); continue; }
        if (G.s.food < 50) B.tryEat(true);
        if (G.chapter >= 1 && dayTime() && H() < 15 && upkeep()) continue;
        const T0 = B.T;
        [ch0, ch1, ch2, ch3][G.chapter]();
        B.tick();
        if (B.T - T0 < 0.2) B.wait(1);
      } catch (e) {
        if (e instanceof B.Dead) {
          const d = { title: document.getElementById('o-title').textContent, ch: G.chapter, day: G.day, h: hourOf().toFixed(1), cause: G.cause, R: +(B.R / 60).toFixed(1) };
          if (G.flags.rescued || d.title === ENDINGS.C[1] || d.title === ENDINGS.D[1]) { L('КОНЕЦ ' + d.title); break; }
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
