// Бот-плейтестер для «Сибири». Загружается в страницу, работает только через игровые функции.
(function () {
  const DT = 0.05;
  const B = window.BOT = { R: 0, T: 0, log: [], chR: {}, chT: {}, dlgN: 0, ate: {}, fires: 0, stuck: 0, hares: [], minWarm: 100, minHp: 100, minFood: 100,
    wolfHits: 0, wolfDmg: 0, bearDmg: 0, frostEv: 0, coldDmg: 0, allowIce: false, deaths: [] };
  class Dead extends Error {}
  B.Dead = Dead;
  // БЛОКЕР (E): вдали от избы сбросить лишний груз некуда (нет ни ящика, ни «выбросить») — герой
  // копит дрова/пушнину/детали и рано или поздно упирается в перегруз (Inv.capKg): рубка (js/actions.js:
  // case 'tree') тогда молча отказывает, а без дров нечем греться. Вес/потолок — в каждой строке лога,
  // чтобы такой перегруз было видно сразу, а не только по симптому «рубка +0».
  const L = m => B.log.push(`[${(B.R / 60).toFixed(1)}m d${G.day} ${hourOf().toFixed(2)}h ch${G.chapter} hp${G.s.hp | 0} w${G.s.warm | 0} f${G.s.food | 0} 🪵${Inv.cnt('wood', false)}/${G.chest.wood || 0} кг${Inv.weight()}/${Inv.capKg()}] ${m}`);
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
    B.R += sl ? dt / TUNE.time.sleepX : dt; B.T += dt;
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
    if (G.bear && G.bear.st !== 'gone' && dist2(G.bear, p) < 80 * 80) { if (p.action) p.action = null; Actions.interact(true); return; }
    const w = Actions.nearest(G.wolves, 58);
    if (w && !(p.inside && G.hut.door)) { p.action = null; Actions.interact(true); B.hitsGiven = (B.hitsGiven || 0) + 1; }
  }

  function wait(sec, cond) { const t0 = B.T; input.mx = input.my = 0; while (B.T - t0 < sec) { if (cond && cond()) return true; tick(); survive(); } return false; }
  B.wait = wait;
  function doAction() { // ждать завершения текущего p.action
    // «взять» (take: наклон → в руке → в сумку) — вещь уже в сумке с первого кадра, поза снимается шагом или E (cx);
    // игрок идёт дальше не дожидаясь — бот тоже (иначе 2.2 с на каждую чурку/зайца/банку)
    input.mx = input.my = 0; let n = 0;
    while (G.p.action && !G.p.action.cx && n++ < 400) tick();
    while (G.p.cd > 0 && n++ < 440) tick();
  }
  B.doAction = doAction;

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
      // снаружи — обход вещей по сетке Nav (подножия Ми-8, домов зон… — js/content/footprints.js), как у ИИ
      // (в избе — тоже: лежанка, печь, верстак, ящик — подножия; через дверь — своим путём выше)
      const viaNav = typeof Nav !== 'undefined' && !!p.inside === insideHut(ax, ay) && Math.hypot(ax - p.x, ay - p.y) > 40;
      if (viaNav) { const q = Nav.way(p, ax, ay); ax = q.x; ay = q.y; }
      const dx = ax - p.x, dy = ay - p.y, dd = Math.hypot(dx, dy) || 1;
      let mx = dx / dd, my = dy / dd;
      // глубокий снег (js/depth.js): как игрок — в обход сугроба, по натоптанному (далеко от цели и не в обходе вещи)
      if (typeof Depth !== 'undefined' && !p.inside && dd > 60 && ax === x && ay === y) { const v = Depth.steer(p, mx, my, 'p'); if (v) { mx = v.x; my = v.y; } }
      if (!B.allowIce) {
        const px = p.x - POI.polynya.x, py = p.y - POI.polynya.y, pd = Math.hypot(px, py);
        if (pd < 160 && Math.hypot(x - POI.polynya.x, y - POI.polynya.y) > 120) {
          const tx = -py / pd, ty = px / pd, s = (tx * mx + ty * my) >= 0 ? 1 : -1;
          mx = tx * s + px / pd * 0.6; my = ty * s + py / pd * 0.6; const l = Math.hypot(mx, my); mx /= l; my /= l;
        }
      }
      // обход избы снаружи
      if (!viaNav && !p.inside && !insideHut(x, y) && Math.abs(p.x - HUT.x) < 150 && p.y > HUT.y - 150 && p.y < HUT.y + 80) {
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
    // цель в подножии вещи (сундук, лежанка, обломки — js/content/footprints.js) — встаём у её края
    if (typeof World !== 'undefined' && World.freeNear) { const f = World.freeNear(x, y, 10); x = f.x; y = f.y; }
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
  function cookedHere() { return !!Fire.near(140) || (G.p.inside && G.hut.fuel > 0); }
  function tryEat(force) {
    const wc = G.p.inside;
    if (G.s.food >= 96) return;
    const k = FOOD_ORDER.find(f => Inv.cnt(f, wc) > 0); if (!k) return;
    if (ITEMS[k].raw && !cookedHere() && G.s.food > 20 && !force) return;
    input.mx = input.my = 0; const f0 = G.s.food; Actions.eat(); { let n = 0; while ((G.p.action || input.auto) && n++ < 400) tick(); } if (G.s.food > f0) B.ate[k] = (B.ate[k] || 0) + 1;   // еда — процесс: достать → съесть
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
  // этап 4: ель валится без дров → лежачий ствол разделать (чурки на снег) → чурки подобрать = дрова
  // охапка (js/carry.js): полна — у избы в поленницу, с нартами — на нарты, иначе мелкое в рюкзак (остальное — в руках, на костёр)
  function deliver() {
    if (!Carry.busy()) return false;
    if (Math.hypot(G.p.x - HUT.x, G.p.y - HUT.y) < 1500) { const q = Carry.PILE(), x = G.p.x, y = G.p.y; goTo(q.x - 26, q.y + 16, 10); Carry.put('pile', []); doAction(); goTo(x, y, 14, 30); }
    else if (Carry.hasSled()) { Carry.put('sled', []); doAction(); }
    else { Carry.stow([]); doAction(); }
    return !Carry.busy();
  }
  B.deliver = deliver;
  function pickChunks(r = 160) {
    for (let k = 0; k < 12; k++) {
      const q = (G.chunks || []).find(c => dist2(c, G.p) < r * r && Tree.isWood(c)); if (!q) return;
      if (Carry.cantTake(q)) { if (!deliver()) return; continue; }
      let c = Actions.context();
      // чурка лежит у ствола (в его подножии не встать) — к ближайшему свободному месту рядом, «Взять» — с 46 px
      if (!c || c.k !== 'chunks') { const f = World.freeNear(q.x, q.y + 8, 10); rawGo(f.x, f.y, 18, 3); c = Actions.context(); }
      if (c && c.k === 'chunks') { Actions.interact(true); doAction(); } else { G.chunks.splice(G.chunks.indexOf(q), 1); }
    }
  }
  // место у лежачего ствола: сбоку от середины оставшейся части, на той стороне, где герой (ствол — преграда, World.solid)
  function logSide(L, side) {
    const q = Actions.logEnd(L, Actions.logK(L) * 0.55), vx = Math.cos(L.a), vy = Math.sin(L.a) * 0.6, l = Math.hypot(vx, vy) || 1;
    let nx = -vy / l, ny = vx / l; if (side == null) side = (G.p.x - q.x) * nx + (G.p.y - q.y) * ny >= 0 ? 1 : -1;
    const f = World.freeNear(q.x + nx * side * 24, q.y + ny * side * 24, 10); return f;
  }
  function buck(L) {
    for (let k = 0; k < 14 && G.logs.includes(L) && L.n > 0; k++) {
      let c = Actions.context();
      if (!c || (c.k !== 'log' && c.k !== 'chunks')) { const q = logSide(L, k % 3 === 2 ? -1 : null); rawGo(q.x, q.y, 10, 4); c = Actions.context(); }
      if (c && (c.k === 'drift' || c.k === 'digout' || c.k === 'tracks' || c.k === 'litter')) { Actions.interact(false); doAction(); c = Actions.context(); }
      if (c && (c.k === 'log' || c.k === 'chunks')) { Actions.interact(true); doAction(); } else { const q = logSide(L, -1); rawGo(q.x, q.y, 8, 3); }
      if (Inv.weight() > Inv.capKg() + 6) break;
    }
    pickChunks();
  }
  B.buck = buck;
  function chopOne(maxDist = 900) {
    const p = G.p;
    const L0 = (G.logs || []).find(L => L.n > 0 && dist2(L, p) < 500 * 500);
    if (L0) { const w0 = Inv.cnt('wood', false), q = logSide(L0); goTo(q.x, q.y, 14, 30); buck(L0); if (Inv.cnt('wood', false) > w0) return true; }
    let best = null, bd = maxDist * maxDist;
    for (const t of treesNear(p.x, p.y, maxDist)) if (t.wood > 0 && !t.wall && !onIce(t.x, t.y)) { const d = dist2(t, p); if (d < bd && Math.hypot(t.x - HUT.x, t.y - HUT.y) > 150 && !(G.col && G.col.builds.some(b => dist2(b, t) < (BUILDS[b.type].w / 2 + 50) ** 2)) && !G.stacks.some(s => dist2(s, t) < 70 * 70)) { bd = d; best = t; } }
    if (!best) { L('нет деревьев рядом'); return false; }
    const a = Math.atan2(p.y - best.y, p.x - best.x);
    // БЛОКЕР (D): дальний поиск (см. plan.js warmUp) ищет за 1600+ px — за фиксированные 40 с туда
    // пешком (тем более в мороз/с перегрузом) не успеть, и «дерево нашлось» превращалось в тот же
    // «не смог», просто на маршруте; время в пути даём по факту расстояния до найденного дерева.
    goTo(best.x + Math.cos(a) * 30, best.y + Math.sin(a) * 30, 12, 40 + Math.sqrt(bd) / 100);
    for (let k = 0; k < 10 && best.wood > 0; k++) {
      const c = Actions.context();
      if (!c) { rawGo(best.x, best.y, 30, 5); continue; }
      if (c.k === 'amulet' || c.k === 'trap' || c.k === 'chunks') { Actions.interact(true); doAction(); continue; }
      if (c.k === 'drift' || c.k === 'digout' || c.k === 'tracks' || c.k === 'litter') { Actions.interact(false); doAction(); continue; } // сугроб/след под ногами перекрывает «Рубить» — пнуть/прочитать и дальше
      if (c.k === 'log') { buck(c.o); return Inv.cnt('wood', false) > 0; } // рядом лежит сваленный ствол — он тоже дрова (и перехватывает «Рубить»)
      if (c.k === 'tree' && c.o !== best) best = c.o; // под рукой другое дерево — рубим его
      else if (c.k !== 'tree') { const rr = World.trunkR(best) + 14; rawGo(best.x + Math.cos(a) * rr, best.y + Math.sin(a) * rr, 8, 3); const c2 = Actions.context(); if (!c2 || c2.k !== 'tree') continue; best = c2.o; }
      Actions.interact(true); doAction();
      if (Inv.weight() > Inv.capKg() + 6) return true;
    }
    const L = (G.logs || []).find(L => L.n > 0 && Math.hypot(L.x - best.x, L.y - best.y) < 2);
    if (best.wood <= 0 && L) buck(L);
    return Inv.cnt('wood', false) > 0;
  }
  // тайник в поле («Оставить здесь»): лишний груз — не бесконечная рубка, свалить и продолжить налегке.
  // Держим при себе немного еды/дров/силков — только явный балласт (пушнина, лишние дрова) уходит в тайник.
  function stashDrop(keep = { meat: 2, fish: 2, dried: 2, can: 1, stew: 1, honey: 1, wood: 3, snare: 2, trap: 1 }) {
    const s = Actions.stashKey();
    if (!s) { L('тайник: не вышло'); return false; }
    let moved = 0;
    for (const k in G.inv) { const n = (G.inv[k] || 0) - (keep[k] || 0); if (n > 0) { s.inv[k] = (s.inv[k] || 0) + n; G.inv[k] -= n; moved += n; } }
    L(`тайник: оставил ${moved} шт, вес ${Inv.weight()}/${Inv.capKg()}`);
    return moved > 0;
  }
  B.stashDrop = stashDrop;
  function chop(n, maxDist) {
    // БЛОКЕР (E): вдали от избы (глава VII — метеостанция за тысячи px) сбросить лишний груз было
    // некуда — герой либо гонял домой через весь мир, либо просто терпел перегруз до Inv.capKg + 6,
    // где рубка (js/actions.js: case 'tree') молча отказывает. Теперь рядом с избой — в ящик, вдали —
    // в тайник на месте (js/actions.js: Actions.stashKey); лес отрастает сам (World.tickRegrow), но не
    // мгновенно — перегруз всё равно надо куда-то девать по пути.
    const dumpIfNeeded = () => {
      if (Inv.weight() <= Inv.capKg() + 2) return;
      if (G.p.inside) return;
      if (Math.hypot(G.p.x - HUT.x, G.p.y - HUT.y) < 1500) { enterHut(); chestAll(); L('перегруз → в ящик'); }
      else if (!onIce(G.p.x, G.p.y)) stashDrop();
    };
    dumpIfNeeded();
    const t0 = B.T, w0 = Inv.cnt('wood', false); let g = 0;
    while (Inv.cnt('wood', false) < n && g++ < n * 4) { if (!chopOne(maxDist)) break; dumpIfNeeded(); }
    B.chopTime = (B.chopTime || 0) + B.T - t0; L(`рубка +${Inv.cnt('wood', false) - w0} за ${(B.T - t0).toFixed(0)} с`); }
  B.chop = chop;
  function warmUp() {
    input.mx = input.my = 0;
    const st = Actions.nearest(G.stacks, 80); if (st) rawGo(st.x + (G.p.x < st.x ? -110 : 110), st.y + 40, 12, 3);
    let f = Actions.nearest(G.fires, 130, f => f.fuel > 0);
    if (!f) {
      const f0 = Actions.nearest(G.fires, 70, f => f.fuel <= 0);
      if (f0 && Inv.cnt('wood', false) >= 2) { Actions.fireKey(); f = f0; }
      else {
        if (Inv.cnt('wood', false) < 3) chop(3, 500);
        if (onIce(G.p.x + G.p.face * 30, G.p.y) || onIce(G.p.x, G.p.y)) { G.p.face *= -1; }
        if (onIce(G.p.x + G.p.face * 30, G.p.y)) rawGo(G.p.x + (G.p.x < riverX(G.p.y) ? -140 : 140), G.p.y, 10, 5);
        if (Inv.cnt('wood', false) >= 3) { Actions.fireKey(); B.fires++; f = Actions.nearest(G.fires, 130, f => f.fuel > 0); }
      }
    }
    if (!f) { L('не смог развести огонь'); return; }
    rawGo(f.x + 40, f.y, 10, 4);
    const t0 = B.T;
    while (G.s.warm < Hero.maxWarm() - 4 && B.T - t0 < 40) {
      tick();
      if (f.fuel <= 1) { if (Inv.cnt('wood', false) >= 2) { rawGo(f.x + 30, f.y, 10, 3); Actions.fireKey(); } else break; }
      if (G.s.food < 75) tryEat();
    }
    B.warmT = (B.warmT || 0) + B.T - t0;
  }
  B.warmUp = warmUp;

  // ---------- взаимодействия ----------
  function readNote(id) { const n = NOTES[id]; goTo(n.x, n.y + 20, 16); rawGo(n.x, n.y + 10, 8, 5); const c = Actions.context(); if (c && c.k === 'note') Actions.interact(false); tick(); }
  B.readNote = readNote;
  function wreck(w, maxN = 99) {
    goTo(POI[w].x, POI[w].y + 95, 14);
    let n = 0;
    while (G.wreck[w].length && n < maxN) {
      const c = Actions.context();
      if (!c || c.k !== 'wreck') { rawGo(POI[w].x + 20, POI[w].y + 80, 10, 4); const c2 = Actions.context(); if (!c2 || c2.k !== 'wreck') { L('wreck ctx ' + (c2 && c2.k)); break; } }
      Actions.interact(true); doAction(); n++;
      survive();
    }
    L(`разобрал ${w}: ${n} шт`);
  }
  B.wreck = wreck;
  function chestAll(keep = {}) {
    if (!G.p.inside) { if (Carry.busy()) deliver(); enterHut(); }
    goTo(SPOT.chest.x - 10, SPOT.chest.y, 10);
    for (const k in G.inv) { const n = (G.inv[k] || 0) - (keep[k] || 0); if (n > 0) { G.chest[k] = (G.chest[k] || 0) + n; G.inv[k] -= n; } }
    B.R += 2;
  }
  function chestTake(k, n) { goTo(SPOT.chest.x - 10, SPOT.chest.y, 10); const a = Math.min(n, G.chest[k] || 0); G.chest[k] = (G.chest[k] || 0) - a; Inv.add(k, a); return a; }
  B.chestAll = chestAll; B.chestTake = chestTake;
  function fillStove(target) {
    if (!G.p.inside) enterHut();
    goTo(SPOT.stove.x + 20, SPOT.stove.y + 20, 10);
    target = target == null ? Stove.secPerLog() * 5.5 : target;
    let g = 0;
    while (G.hut.fuel < target && g++ < 10 && Inv.cnt('wood', true) > 0) { const f0 = G.hut.fuel; Stove.add(); if (G.hut.fuel === f0) break; }
  }
  B.fillStove = fillStove;
  function build(id) { if (!G.p.inside) enterHut(); goTo(SPOT.bench.x, SPOT.bench.y + 20, 10); const ok = Actions.buildHut(HUT_UPG.find(u => u.id === id)); L(`стройка ${id}: ${ok}`); return ok; }
  function doCraft(id) { if (!G.p.inside) enterHut(); goTo(SPOT.bench.x, SPOT.bench.y + 20, 10); const r = RECIPES.find(r => r.id === id); const st = Actions.recipeState(r); const ok = Actions.craft(r); if (ok) doAction(); L(`крафт ${id}: ${ok ? 'ok' : st}`); return ok; }
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
      if (!insideHut(x, y) || (World.blocked && World.blocked(x, y, 10)) || x < HUT_IN.x0 + 11 || x > HUT_IN.x1 - 11 || y < HUT_IN.y0 + 11 || y > HUT_IN.y1 - 11) continue;
      G.p.x = x; G.p.y = y; G.p.inside = true; const c = Actions.context(); if (c && c.k === 'bed') best = { x, y };
    }
    G.p.x = sx; G.p.y = sy; G.p.inside = si; return best;
  }
  B.bedSpot = bedSpot;
  function trySleepNow() {
    const bs = bedSpot(); if (!bs) return false;
    goTo(bs.x, bs.y, 4, 10);
    const c = Actions.context(); if (c && c.k === 'bed') Actions.interact(false);
    for (let k = 0; k < 120 && !G.p.sleeping && Actions.busy(); k++) tick(); // идёт к лежанке и ложится
    return G.p.sleeping;
  }
  function night(opts = {}) {
    L('ночёвка: иду в избу');
    if (Inv.cnt('wood', true) + Inv.cnt('wood', false) < 7) { chop(8, 700); }
    enterHut();
    chestAll({ wood: 0 });
    fillStove(Stove.secPerLog() * 5.6);
    // БЛОКЕР (D/E): если дверь сломана к вечеру, ни ожидание 19:00, ни попытка уснуть её не чинят —
    // а без двери шатун/волки достают героя «изнутри» избы весь остаток ночи без единого шанса на защиту.
    // Печь заправляем первой (иначе в главах II–III, где дрова на счету, дверь съедала топливо ночи);
    // с главы V, когда посёлок уже сам справляется с обороной, — про запас в 15 полен сверх двери.
    if (G.chapter >= 4 && !G.hut.door && Inv.canPay({ wood: 19, scrap: 1 }, true)) build('door');
    while (!(hourOf() >= 19 || hourOf() < 6)) { tick(); if (G.hut.fuel < Stove.secPerLog() * 2) fillStove(); if (G.s.food < 60) tryEat(); if (opts.during) opts.during(); }
    if (opts.at19) opts.at19();
    fillStove(Stove.secPerLog() * 5.6);
    if (G.s.food < 80) { tryEat(); tryEat(); }
    let awake = 0, sleeps = 0;
    while (!(hourOf() >= 7 && hourOf() < 12)) {
      if (!G.p.sleeping) {
        if (G.hut.fuel < Stove.secPerLog() * 3) fillStove(Stove.secPerLog() * 5.6);
        // БЛОКЕР (D/E): раньше сон пробовали ДО проверки шатуна — если тот ещё дальше bearSleepR (450),
        // trySleepNow() успевал усыпить героя, а дальше «изнутри» избы шатуна встречает уже не bearDefense()
        // (с факелом), а голый reflex() спящего — по сути никак. Шатуна встречаем первым, сон — потом.
        if (G.bear && G.bear.st !== 'flee' && G.bear.st !== 'fleeHurt' && G.bear.st !== 'gone' && G.bear.st !== 'wander' && dist2(G.bear, HUT) < 900 * 900) { bearDefense(); continue; }
        if (hourOf() >= 19 || hourOf() < 6) { if (trySleepNow()) { sleeps++; continue; } }
        if (!B.noBed && !G.bear) { B.noBed = 1; L('❌ не могу лечь: кровать недоступна (ctx ' + (Actions.context() || {}).k + ')'); }
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
      // ниже 40 hp — одна оплеуха (−50) добивает; лучше отступить за дверь и переждать, чем ловить вторую
      if (G.s.hp < 40 && G.hut.door) { if (!G.p.inside) enterHut(); break; }
      if (G.p.torch < 10 && G.p.inside && G.hut.fuel > 0 && Inv.cnt('wood', true) > 0) { if (Actions.craft(RECIPES.find(r => r.id === 'torch'))) doAction(); B.torches = (B.torches || 0) + 1; }
      if (G.p.torch > 0) { const b = G.bear; if (dist2(b, G.p) > 70 * 70) goTo(b.x, b.y, 60, 1.5); else { input.mx = input.my = 0; tick(); } }
      else { if (!G.p.inside) enterHut(); wait(1); }
      if (G.hut.fuel < Stove.secPerLog() * 2 && G.p.inside) fillStove();
    }
    wait(1);
    L('🐻 шатун: ' + (G.bear ? G.bear.st + ' hp' + G.bear.hp.toFixed(1) : 'ушёл/убит'));
    if (!G.p.inside) enterHut();
  }
  B.bearDefense = bearDefense;

  // ---------- зайцы ----------
  function huntHares(n, maxT = 120, cond) {
    if (G.p.inside || Math.hypot(G.p.x - HUT.x, G.p.y - HUT.y) < 200) goTo(HUT.x, HUT.y + 260, 20);
    const t0 = B.T, start = Inv.cnt('hare', false) + (G.chest.hare || 0); let got = 0;
    while (got < n && B.T - t0 < maxT) {
      if (cond && !cond()) break;
      let h = null, bd = 1e12;
      for (const x of G.hares) { const d = dist2(x, G.p) + (onIce(x.x, x.y) ? 1e5 : 0); if (d < bd) { bd = d; h = x; } }
      if (!h) { wait(1); continue; }
      const t1 = B.T;
      while (G.hares.includes(h) && B.T - t1 < 25) {
        if (dist2(h, G.p) < 48 * 48) { const c = Actions.context(); if (c && c.k === 'hare') { input.mx = input.my = 0; Actions.interact(true); doAction(); break; } }
        const dx = h.x - G.p.x, dy = h.y - G.p.y, d = Math.hypot(dx, dy) || 1;
        input.mx = dx / d; input.my = dy / d; tick(); survive();
        if (Math.hypot(G.p.x - POI.polynya.x, G.p.y - POI.polynya.y) < 150) break;
      }
      const now = Inv.cnt('hare', false) + (G.chest.hare || 0);
      if (now > start + got) { got = now - start; B.hares.push(+(B.T - t0).toFixed(1)); }
    }
    input.mx = input.my = 0;
    L(`зайцы: +${got} за ${(B.T - t0).toFixed(0)} с`);
    return got;
  }
  B.huntHares = huntHares;
})();
