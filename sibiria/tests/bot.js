// Бот-плейтестер для «Сибири». Загружается в страницу, работает только через игровые функции.
(function () {
  const DT = 0.05;
  const B = window.BOT = { R: 0, T: 0, log: [], chR: {}, chT: {}, dlgN: 0, ate: {}, fires: 0, stuck: 0, hares: [], minWarm: 100, minHp: 100, minFood: 100,
    wolfHits: 0, wolfDmg: 0, bearDmg: 0, frostEv: 0, coldDmg: 0, allowIce: false, deaths: [] };
  class Dead extends Error {}
  B.Dead = Dead;
  const L = m => B.log.push(`[${(B.R / 60).toFixed(1)}m d${G.day} ${hourOf().toFixed(2)}h ch${G.chapter} hp${G.s.hp | 0} w${G.s.warm | 0} f${G.s.food | 0} 🪵${cnt('wood', false)}/${G.chest.wood || 0}] ${m}`);
  B.L = L;
  let lastCh = 0;
  const $$ = s => document.querySelector(s);
  const vis = id => !document.getElementById(id).hidden;

  function dlgOpts() { return [...document.querySelectorAll('#dlg-opts .opt')]; }
  B.pick = null; // (texts, node) => index
  function handleModal() {
    for (let k = 0; k < 20 && UI.modal(); k++) {
      if (vis('note')) { $$('#note').click(); continue; }
      if (vis('panel')) { $$('#panel-close').click(); continue; }
      if (vis('dialog')) {
        if (!dlgOpts().length) $$('#dialog').click();
        const os = dlgOpts(); if (!os.length) break;
        const txt = os.map(o => o.textContent);
        let i = B.pick ? B.pick(txt, $$('#dlg-text').textContent) : 0; if (i == null || i < 0 || i >= os.length) i = 0;
        B.dlgN++; B.dlgLog = (B.dlgLog || []); B.dlgLog.push($$('#dlg-name').textContent + ': ' + $$('#dlg-text').textContent.slice(0, 50) + ' → ' + txt[i]);
        os[i].click(); continue;
      }
      break;
    }
  }
  B.handleModal = handleModal;

  function tick(dt = DT) {
    if (state !== 'play') throw new Dead(state);
    handleModal();
    const sl = G.p.sleeping, hp0 = G.s.hp, fr0 = G.s.frost;
    update(dt);
    B.R += sl ? dt / SLEEP_X : dt; B.T += dt;
    if (G.s.hp < hp0 - 0.001) {
      const d = hp0 - G.s.hp;
      if (d > 5 && G.cause === 'wolf') { B.wolfHits++; B.wolfDmg += d; L(`🐺 укус −${d.toFixed(0)}`); }
      else if (d > 20 && G.cause === 'bear') { B.bearDmg += d; L(`🐻 удар −${d.toFixed(0)}`); }
      else if (G.s.warm <= 0) B.coldDmg += d;
    }
    if (G.s.frost > fr0) { B.frostEv++; L('обморожение ' + G.s.frost); }
    B.minWarm = Math.min(B.minWarm, G.s.warm); B.minHp = Math.min(B.minHp, G.s.hp); B.minFood = Math.min(B.minFood, G.s.food);
    if (G.chapter !== lastCh) { B.chR[lastCh] = B.R; B.chT[lastCh] = B.T; L('=== ГЛАВА ' + CHAPTERS[G.chapter].num); lastCh = G.chapter; }
    if (state !== 'play') throw new Dead(state + ':' + (G.cause || ''));
    reflex();
  }
  B.tick = tick;

  function reflex() {
    const p = G.p;
    if (p.sleeping || p.cd > 0 || UI.modal()) return;
    if (G.bear && G.bear.st !== 'gone' && dist2(G.bear, p) < 80 * 80) { if (p.action) p.action = null; interact(true); return; }
    const w = nearest(G.wolves, 58);
    if (w && !(p.inside && G.hut.door)) { p.action = null; interact(true); B.hitsGiven = (B.hitsGiven || 0) + 1; }
  }

  function wait(sec, cond) { const t0 = B.T; input.mx = input.my = 0; while (B.T - t0 < sec) { if (cond && cond()) return true; tick(); survive(); } return false; }
  B.wait = wait;
  function doAction() { // ждать завершения текущего p.action
    input.mx = input.my = 0; let n = 0;
    while (G.p.action && n++ < 400) tick();
    while (G.p.cd > 0 && n++ < 440) tick();
  }

  // ---------- ходьба ----------
  function rawGo(x, y, tol = 14, maxT = 150) {
    let t = 0, chk = 0, cx = G.p.x, cy = G.p.y, detour = 0, dside = 1, fails = 0;
    for (;;) {
      const p = G.p, d = Math.hypot(x - p.x, y - p.y);
      if (d < tol) { input.mx = input.my = 0; return true; }
      // изнутри избы наружу — сначала к двери (и строго вниз через проём)
      let ax = x, ay = y;
      const inDoor = Math.abs(p.x - HUT.x) < 22 && p.y > HUT_IN.y1 - 30 && p.y < HUT_IN.y1 + 26;
      if ((p.inside || inDoor) && !insideHut(x, y)) { if (Math.abs(p.x - HUT.x) > 8 && !inDoor) { ax = HUT.x; ay = HUT_IN.y1 - 25; } else { ax = HUT.x; ay = HUT_IN.y1 + 60; } }
      const dx = ax - p.x, dy = ay - p.y, dd = Math.hypot(dx, dy) || 1;
      let mx = dx / dd, my = dy / dd;
      if (!B.allowIce) {
        const px = p.x - POI.polynya.x, py = p.y - POI.polynya.y, pd = Math.hypot(px, py);
        if (pd < 160 && Math.hypot(x - POI.polynya.x, y - POI.polynya.y) > 120) {
          const tx = -py / pd, ty = px / pd, s = (tx * mx + ty * my) >= 0 ? 1 : -1;
          mx = tx * s + px / pd * 0.6; my = ty * s + py / pd * 0.6; const l = Math.hypot(mx, my); mx /= l; my /= l;
        }
      }
      // обход избы снаружи
      if (!p.inside && !insideHut(x, y) && Math.abs(p.x - HUT.x) < 150 && p.y > HUT.y - 150 && p.y < HUT.y + 80) {
        const nx = p.x + mx * 40, ny = p.y + my * 40;
        if (Math.abs(nx - HUT.x) < 125 && ny > HUT.y - 125 && ny < HUT.y + 65) { const s = p.x < HUT.x ? -1 : 1; mx = s; my = 0.2 * Math.sign(dy); }
      }
      if (detour > 0) { const a = dside * Math.PI / 2 * 0.9; const c = Math.cos(a), s = Math.sin(a); [mx, my] = [mx * c - my * s, mx * s + my * c]; detour -= DT; }
      input.mx = mx; input.my = my;
      tick(); survive();
      t += DT; chk += DT;
      if (chk >= 0.8) {
        if (Math.hypot(G.p.x - cx, G.p.y - cy) < 25) { detour = 0.4 + Math.random() * 0.8; dside = Math.random() < 0.5 ? 1 : -1; B.stuck++; fails++; }
        cx = G.p.x; cy = G.p.y; chk = 0;
      }
      if (t > maxT) { L(`goTo timeout → ${x | 0},${y | 0} at ${G.p.x | 0},${G.p.y | 0}`); input.mx = input.my = 0; return false; }
    }
  }
  const DOOR_OUT = () => ({ x: HUT.x, y: HUT_IN.y1 + 48 });
  function goTo(x, y, tol = 14, maxT = 150) {
    const tIn = insideHut(x, y);
    if (G.p.inside && !tIn) { rawGo(HUT.x, HUT.y + 5, 10); rawGo(DOOR_OUT().x, DOOR_OUT().y, 10); }
    else if (!G.p.inside && tIn) { rawGo(DOOR_OUT().x, DOOR_OUT().y + 10, 12); rawGo(HUT.x, HUT.y + 5, 10); }
    return rawGo(x, y, tol, maxT);
  }
  B.goTo = goTo;
  const enterHut = () => goTo(HUT.x, HUT.y, 10);
  B.enterHut = enterHut;

  // ---------- выживание ----------
  B.warmThr = 35;
  function cookedHere() { return !!nearFire(140) || (G.p.inside && G.hut.fuel > 0); }
  function tryEat(force) {
    const wc = G.p.inside;
    if (G.s.food >= 96) return;
    const k = FOOD_ORDER.find(f => cnt(f, wc) > 0); if (!k) return;
    if (ITEMS[k].raw && !cookedHere() && G.s.food > 20 && !force) return;
    input.mx = input.my = 0; eat(); B.ate[k] = (B.ate[k] || 0) + 1;
  }
  B.tryEat = tryEat;
  let inS = false;
  function survive() {
    if (inS || G.p.sleeping) return; inS = true;
    try {
      if (G.s.food < 45) tryEat();
      if (!G.p.inside && G.s.warm < B.warmThr) warmUp();
    } finally { inS = false; }
  }
  B.survive = survive;
  function chopOne(maxDist = 900) {
    const p = G.p;
    let best = null, bd = maxDist * maxDist;
    for (const t of treesNear(p.x, p.y, maxDist)) if (t.wood > 0 && !t.wall && !onIce(t.x, t.y)) { const d = dist2(t, p); if (d < bd && Math.hypot(t.x - HUT.x, t.y - HUT.y) > 150 && !(G.col && G.col.builds.some(b => dist2(b, t) < (BUILDS[b.type].w / 2 + 50) ** 2)) && !G.stacks.some(s => dist2(s, t) < 70 * 70)) { bd = d; best = t; } }
    if (!best) { L('нет деревьев рядом'); return false; }
    const a = Math.atan2(p.y - best.y, p.x - best.x);
    goTo(best.x + Math.cos(a) * 30, best.y + Math.sin(a) * 30, 12, 40);
    for (let k = 0; k < 6 && best.wood > 0; k++) {
      const c = context();
      if (!c) { rawGo(best.x, best.y, 30, 5); continue; }
      if (c.k === 'amulet' || c.k === 'trap') { interact(true); tick(); continue; }
      if (c.k !== 'tree' && c.k !== 'hare') { rawGo(best.x + 20, best.y + 20, 8, 3); continue; }
      const w0 = cnt('wood', false);
      interact(true); doAction();
      if (weight() > capKg() + 6) return true;
      if (cnt('wood', false) > w0) return true;
    }
    return cnt('wood', false) > 0;
  }
  function chop(n, maxDist) {
    if (weight() > capKg() + 2 && !G.p.inside) { enterHut(); chestAll(); L('перегруз → в ящик'); }
    const t0 = B.T, w0 = cnt('wood', false); let g = 0; while (cnt('wood', false) < n && g++ < n * 4) { if (!chopOne(maxDist)) break; } B.chopTime = (B.chopTime || 0) + B.T - t0; L(`рубка +${cnt('wood', false) - w0} за ${(B.T - t0).toFixed(0)} с`); }
  B.chop = chop;
  function warmUp() {
    input.mx = input.my = 0;
    const st = nearest(G.stacks, 80); if (st) rawGo(st.x + (G.p.x < st.x ? -110 : 110), st.y + 40, 12, 3);
    let f = nearest(G.fires, 130, f => f.fuel > 0);
    if (!f) {
      const f0 = nearest(G.fires, 70, f => f.fuel <= 0);
      if (f0 && cnt('wood', false) >= 2) { fireKey(); f = f0; }
      else {
        if (cnt('wood', false) < 3) chop(3, 500);
        if (onIce(G.p.x + G.p.face * 30, G.p.y) || onIce(G.p.x, G.p.y)) { G.p.face *= -1; }
        if (onIce(G.p.x + G.p.face * 30, G.p.y)) rawGo(G.p.x + (G.p.x < riverX(G.p.y) ? -140 : 140), G.p.y, 10, 5);
        if (cnt('wood', false) >= 3) { fireKey(); B.fires++; f = nearest(G.fires, 130, f => f.fuel > 0); }
      }
    }
    if (!f) { L('не смог развести огонь'); return; }
    rawGo(f.x + 40, f.y, 10, 4);
    const t0 = B.T;
    while (G.s.warm < maxWarm() - 4 && B.T - t0 < 40) {
      tick();
      if (f.fuel <= 1) { if (cnt('wood', false) >= 2) { rawGo(f.x + 30, f.y, 10, 3); fireKey(); } else break; }
      if (G.s.food < 75) tryEat();
    }
    B.warmT = (B.warmT || 0) + B.T - t0;
  }
  B.warmUp = warmUp;

  // ---------- взаимодействия ----------
  function readNote(id) { const n = NOTES[id]; goTo(n.x, n.y + 20, 16); rawGo(n.x, n.y + 10, 8, 5); const c = context(); if (c && c.k === 'note') interact(false); tick(); }
  B.readNote = readNote;
  function wreck(w, maxN = 99) {
    goTo(POI[w].x, POI[w].y + 95, 14);
    let n = 0;
    while (G.wreck[w].length && n < maxN) {
      const c = context();
      if (!c || c.k !== 'wreck') { rawGo(POI[w].x + 20, POI[w].y + 80, 10, 4); const c2 = context(); if (!c2 || c2.k !== 'wreck') { L('wreck ctx ' + (c2 && c2.k)); break; } }
      interact(true); doAction(); n++;
      survive();
    }
    L(`разобрал ${w}: ${n} шт`);
  }
  B.wreck = wreck;
  function chestAll(keep = {}) {
    if (!G.p.inside) enterHut();
    goTo(SPOT.chest.x - 10, SPOT.chest.y, 10);
    for (const k in G.inv) { const n = (G.inv[k] || 0) - (keep[k] || 0); if (n > 0) { G.chest[k] = (G.chest[k] || 0) + n; G.inv[k] -= n; } }
    B.R += 2;
  }
  function chestTake(k, n) { goTo(SPOT.chest.x - 10, SPOT.chest.y, 10); const a = Math.min(n, G.chest[k] || 0); G.chest[k] = (G.chest[k] || 0) - a; add(k, a); return a; }
  B.chestAll = chestAll; B.chestTake = chestTake;
  function fillStove(target) {
    if (!G.p.inside) enterHut();
    goTo(SPOT.stove.x + 20, SPOT.stove.y + 20, 10);
    target = target == null ? secPerLog() * 5.5 : target;
    let g = 0;
    while (G.hut.fuel < target && g++ < 10 && cnt('wood', true) > 0) { const f0 = G.hut.fuel; stoveAdd(); if (G.hut.fuel === f0) break; }
  }
  B.fillStove = fillStove;
  function build(id) { if (!G.p.inside) enterHut(); goTo(SPOT.bench.x, SPOT.bench.y + 20, 10); const ok = buildHut(HUT_UPG.find(u => u.id === id)); L(`стройка ${id}: ${ok}`); return ok; }
  function doCraft(id) { if (!G.p.inside) enterHut(); goTo(SPOT.bench.x, SPOT.bench.y + 20, 10); const r = RECIPES.find(r => r.id === id); const st = recipeState(r); const ok = craft(r); L(`крафт ${id}: ${ok ? 'ok' : st}`); return ok; }
  B.build = build; B.doCraft = doCraft;

  // ночь: к 18:00 в избе, печь полна, сон с 19:00
  function hoursUntil(h) { const c = hourOf(); return ((h - c + 24) % 24); }
  B.hoursUntil = hoursUntil;
  function bedSpot() {
    // ищем точку, где контекст = кровать
    const sx = G.p.x, sy = G.p.y, si = G.p.inside;
    let best = null;
    for (let r = 0; r <= 46 && !best; r += 4) for (let a = 0; a < 6.28 && !best; a += 0.4) {
      const x = SPOT.bed.x + Math.cos(a) * r, y = SPOT.bed.y + Math.sin(a) * r;
      if (!insideHut(x, y) || x < HUT_IN.x0 + 11 || x > HUT_IN.x1 - 11 || y < HUT_IN.y0 + 11 || y > HUT_IN.y1 - 11) continue;
      G.p.x = x; G.p.y = y; G.p.inside = true; const c = context(); if (c && c.k === 'bed') best = { x, y };
    }
    G.p.x = sx; G.p.y = sy; G.p.inside = si; return best;
  }
  B.bedSpot = bedSpot;
  function trySleepNow() {
    const bs = bedSpot(); if (!bs) return false;
    goTo(bs.x, bs.y, 4, 10);
    const c = context(); if (c && c.k === 'bed') interact(false);
    return G.p.sleeping;
  }
  function night(opts = {}) {
    L('ночёвка: иду в избу');
    if (cnt('wood', true) + cnt('wood', false) < 7) { chop(8, 700); }
    enterHut();
    chestAll({ wood: 0 });
    fillStove(secPerLog() * 5.6);
    while (!(hourOf() >= 19 || hourOf() < 6)) { tick(); if (G.hut.fuel < secPerLog() * 2) fillStove(); if (G.s.food < 60) tryEat(); if (opts.during) opts.during(); }
    if (opts.at19) opts.at19();
    fillStove(secPerLog() * 5.6);
    if (G.s.food < 80) { tryEat(); tryEat(); }
    let awake = 0, sleeps = 0;
    while (!(hourOf() >= 7 && hourOf() < 12)) {
      if (!G.p.sleeping) {
        if (G.hut.fuel < secPerLog() * 3) fillStove(secPerLog() * 5.6);
        if (hourOf() >= 19 || hourOf() < 6) { if (trySleepNow()) { sleeps++; continue; } }
        if (G.bear && dist2(G.bear, HUT) < 600 * 600) { bearDefense(); continue; }
        if (!B.noBed && !G.bear) { B.noBed = 1; L('❌ не могу лечь: кровать недоступна (ctx ' + (context() || {}).k + ')'); }
        if (G.s.food < 60) tryEat();
        const t0 = B.T; wait(2); awake += B.T - t0;
        if (opts.wake) opts.wake();
      } else tick();
    }
    if (awake > 5) { L(`ночь без сна: ${awake.toFixed(0)} с`); B.awakeNight = (B.awakeNight || 0) + awake; }
    L('утро');
  }
  B.night = night;
  // шатун у избы: факел из печи и выйти навстречу (рефлекс бьёт в радиусе 80)
  function bearDefense() {
    const t0 = B.T; B.bearMet = (B.bearMet || 0) + 1; L('🐻 шатун у избы — факел и на выход');
    while (G.bear && B.T - t0 < 60 && G.bear.st !== 'flee' && G.bear.st !== 'fleeHurt') {
      if (G.p.torch < 10 && G.p.inside && G.hut.fuel > 0 && cnt('wood', true) > 0) { craft(RECIPES.find(r => r.id === 'torch')); B.torches = (B.torches || 0) + 1; }
      if (G.p.torch > 0) { const b = G.bear; if (dist2(b, G.p) > 70 * 70) goTo(b.x, b.y, 60, 1.5); else { input.mx = input.my = 0; tick(); } }
      else { if (!G.p.inside) enterHut(); wait(1); }
      if (G.hut.fuel < secPerLog() * 2 && G.p.inside) fillStove();
    }
    wait(1);
    L('🐻 шатун: ' + (G.bear ? G.bear.st + ' hp' + G.bear.hp.toFixed(1) : 'ушёл/убит'));
    if (!G.p.inside) enterHut();
  }
  B.bearDefense = bearDefense;

  // ---------- зайцы ----------
  function huntHares(n, maxT = 120, cond) {
    if (G.p.inside || Math.hypot(G.p.x - HUT.x, G.p.y - HUT.y) < 200) goTo(HUT.x, HUT.y + 260, 20);
    const t0 = B.T, start = cnt('hare', false) + (G.chest.hare || 0); let got = 0;
    while (got < n && B.T - t0 < maxT) {
      if (cond && !cond()) break;
      let h = null, bd = 1e12;
      for (const x of G.hares) { const d = dist2(x, G.p) + (onIce(x.x, x.y) ? 1e5 : 0); if (d < bd) { bd = d; h = x; } }
      if (!h) { wait(1); continue; }
      const t1 = B.T;
      while (G.hares.includes(h) && B.T - t1 < 25) {
        if (dist2(h, G.p) < 48 * 48) { const c = context(); if (c && c.k === 'hare') { input.mx = input.my = 0; interact(true); tick(); break; } }
        const dx = h.x - G.p.x, dy = h.y - G.p.y, d = Math.hypot(dx, dy) || 1;
        input.mx = dx / d; input.my = dy / d; tick(); survive();
        if (Math.hypot(G.p.x - POI.polynya.x, G.p.y - POI.polynya.y) < 150) break;
      }
      const now = cnt('hare', false) + (G.chest.hare || 0);
      if (now > start + got) { got = now - start; B.hares.push(+(B.T - t0).toFixed(1)); }
    }
    input.mx = input.my = 0;
    L(`зайцы: +${got} за ${(B.T - t0).toFixed(0)} с`);
    return got;
  }
  B.huntHares = huntHares;
})();
