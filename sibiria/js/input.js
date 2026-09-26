'use strict';
// Весь ввод мира (SPEC-input): мышь, колесо, тач по #game — один автомат Input.st.
// Экран↔мир — только GFX.screenToWorld / GFX.worldToScreen. Курсор и подсветка считаются в кадре
// от последней точки мыши той же функцией intent(), что даёт приказ по ПКМ.
const Input = (() => {
  const cvs = $('game');
  // пороги §2.2: мышь / палец
  const TH = { click: 5, clickT: 12, cmd: 8, place: 16, placeT: 24, dblMs: 250, dblPx: 4, dblMsT: 300, dblPxT: 12, longBox: 400, edge: 6, edgeSp: 700 };
  // зоны попадания §4: полуширина, верх/низ от точки опоры (мир. px), запас в экранных px (мышь / палец), приоритет
  const HIT = {
    unit: { hw: 14, top: -46, bot: 4, pad: [6, 14], pr: 1 },
    pet: { hw: 15, top: -24, bot: 4, pad: [4, 10], pr: 1 },
    wolf: { hw: 28, top: -34, bot: 6, pad: [8, 16], pr: 2 },
    bear: { hw: 40, top: -52, bot: 8, pad: [8, 16], pr: 2 },
    hare: { hw: 13, top: -20, bot: 4, pad: [10, 18], pr: 2 },
    stack: { hw: 20, top: -30, bot: 6, pad: [6, 12], pr: 3 },
    cockpit: { hw: 160, top: -140, bot: 70, pad: [0, 0], pr: 3 },
    tail: { hw: 110, top: -100, bot: 40, pad: [0, 0], pr: 3 },
    tree: { hw: 33, top: -150, bot: 6, pad: [0, 6], pr: 4 },
    cedar: { hw: 45, top: -150, bot: 6, pad: [0, 6], pr: 4 },
  };
  const buildHit = b => { const B = BUILDS[b.type]; return { hw: B.w / 2, top: -B.h - 20, bot: B.h / 2, pad: [4, 10], pr: 3 }; };

  // ---------- курсоры §3 (17 состояний; запись только при смене) ----------
  const svgCur = (id, fb) => {
    const d = typeof ICON !== 'undefined' && ICON[id], st = d && d[0] === '~';
    const glyph = d ? (st ? `<g transform='translate(15 17) scale(0.6)' fill='none' stroke='#fff' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'><path d='${d.slice(1)}'/></g>`
      : `<g transform='translate(15 17) scale(0.032)'><path d='${d}' fill='#fff' stroke='#10211b' stroke-width='40' stroke-linejoin='round'/></g>`) : '';
    return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><path d='M1 1v15l4-3.6 3 6.6 2.4-1-3-6.4H13z' fill='#fff' stroke='#10211b' stroke-width='1.2' stroke-linejoin='round'/>${glyph}</svg>`)}") 1 1, ${fb}`;
  };
  const CUR = {
    none: 'default', sel: 'pointer', hero: 'pointer', talk: svgCur('talk', 'pointer'), chop: svgCur('axe', 'pointer'), fish: svgCur('rod', 'pointer'),
    build: svgCur('build', 'pointer'), stack: svgCur('fire', 'pointer'), wreck: svgCur('scrap', 'pointer'), attack: svgCur('rifle', 'crosshair'),
    hunt: svgCur('hare', 'pointer'), move: svgCur('pin', 'default'), no: svgCur('close', 'not-allowed'), place: svgCur('ok', 'copy'),
    placeBad: svgCur('close', 'not-allowed'), pan: 'grabbing', box: 'crosshair',
  };
  const ACT = { // приказ → курсор, значок, подсказка
    move: ['move', 'pin', ':pin: идти'], attack: ['attack', 'rifle', ':rifle: в бой'], build: ['build', 'build', ':build: строить'], stack: ['stack', 'fire', ':fire: кучи'],
    chop: ['chop', 'axe', ':axe: рубить'], hunt: ['hunt', 'hare', ':hare: охота'], fish: ['fish', 'rod', ':rod: рыбачить'], wreck: ['wreck', 'scrap', ':scrap: разбирать'],
  };

  let st = 'IDLE', press = null, mouse = null, lastType = 'mouse', curName = '';
  let hover = null, hoverIt = null, heroSel = false, heroGo = null, manualPrev = false;
  let clicks = { n: 0, t: 0, x: 0, y: 0, type: '' }, taps = { t: 0, x: 0, y: 0 };
  let pan = null, inertia = null, arrow = null;
  const touches = new Map(); let pinch = null, tp = null;

  // ---------- слои §2.3 ----------
  function gate() {
    if (state !== 'play' || !G || !G.col) return 'modal';
    if (!UI.modal()) return 'world';
    return UI.kind === 'dialog' ? 'modal' : 'panel';
  }
  const tips = k => { if (typeof Tips !== 'undefined') Tips.did(k); };
  const hint = t => UI.hint(t);

  // ---------- что под точкой экрана §4 ----------
  function pick(sx, sy, touch) {
    const w = GFX.screenToWorld(sx, sy), z = GFX.zoom, ti = touch ? 1 : 0;
    let best = null;
    const test = (k, o, h, y = o.y) => {
      const pad = h.pad[ti] / z;
      if (w.x < o.x - h.hw - pad || w.x > o.x + h.hw + pad || w.y < o.y + h.top - pad || w.y > o.y + h.bot + pad) return;
      if (!best || h.pr < best.pr || (h.pr === best.pr && y > best.y)) best = { k, o, pr: h.pr, y };
    };
    for (const u of G.col.units) if (!u.hidden) test(u.pet || u.type === 'laika' ? 'pet' : 'unit', u, u.pet || u.type === 'laika' ? HIT.pet : HIT.unit);
    if (!G.p.sleeping) test('hero', G.p, HIT.unit);
    for (const n of Npc.list()) test('npc', n.st, HIT.unit);
    for (const f of G.wolves) test('wolf', f, HIT.wolf);
    if (G.bear) test('bear', G.bear, HIT.bear);
    for (const h of G.hares) test('hare', h, HIT.hare);
    if (!best || best.pr > 2) {
      for (const b of G.col.builds) test(b.done ? 'build' : 'site', b, buildHit(b), b.y + BUILDS[b.type].h / 2);
      for (const s of G.stacks) test('stack', s, HIT.stack);
      for (const k of ['cockpit', 'tail']) test('wreck', { x: POI[k].x, y: POI[k].y, key: k }, HIT[k]);
      if (!best) for (const t of treesNear(w.x, w.y + 72, 200)) if (t.wood > 0 && !t.wall) test('tree', t, t.kind === 2 ? HIT.cedar : HIT.tree);
    }
    if (best) return { k: best.k, o: best.o, w };
    const hut = Math.abs(w.x - HUT.x) < 130 && Math.abs(w.y - (HUT.y - 30)) < 110 && !(heroSel && insideHut(w.x, w.y));
    if (w.x < 0 || w.y < 0 || w.x > W || w.y > H || hut) return { k: 'blocked', w };
    return { k: onIce(w.x, w.y) ? 'ice' : 'ground', w };
  }
  const wreckLoot = k => G.wreck[k].some(i => ['scrap', 'can', 'kero', 'tea', 'cable'].includes(i));

  // ---------- намерение: одна функция для курсора и для приказа ----------
  function intent(t) {
    if (!t) return null;
    if (G.col.ghost) return { k: 'place', cur: G.col.ghost.ok ? 'place' : 'placeBad' };
    const us = Colony.selected();
    if (heroSel && !us.length) {
      if (t.k === 'blocked') return { k: 'none', cur: 'no' };
      if (t.k === 'hero') return { k: 'none', cur: 'hero' };
      const far = t.k === 'ground' || t.k === 'ice', o = far ? t.w : t.k === 'wreck' ? { x: t.o.x, y: t.o.y + 60 } : t.o;
      return { k: 'hero', cur: t.k === 'npc' ? 'talk' : 'move', ic: 'pin', label: far ? ':pin: идти' : ':pin: подойти', x: o.x, y: o.y, stop: far ? 4 : 40 };
    }
    if (!us.length) return { k: 'none', cur: t.k === 'unit' || t.k === 'pet' ? 'sel' : t.k === 'hero' ? 'hero' : t.k === 'npc' ? 'talk' : 'none' };
    if (t.k === 'blocked') return { k: 'none', cur: 'no' };
    if (t.k === 'hero') return { k: 'none', cur: 'hero' };
    const any = f => us.some(f), bich = any(u => u.type === 'bich'), evenk = any(u => u.type === 'evenk'), fighter = any(u => UNITS[u.type].dmg);
    let k = 'move';
    if ((t.k === 'wolf' || t.k === 'bear') && fighter) k = 'attack';
    else if (t.k === 'site' && bich) k = 'build';
    else if (t.k === 'stack' && bich && !t.o.lit && t.o.wood < 4) k = 'stack';
    else if (t.k === 'tree' && bich) k = 'chop';
    else if ((t.k === 'tree' || t.k === 'hare') && evenk) k = 'hunt';
    else if (t.k === 'ice' && bich) k = 'fish';
    else if (t.k === 'wreck' && bich && wreckLoot(t.o.key)) k = 'wreck';
    const [cur, ic, label] = ACT[k];
    return { k, cur: t.k === 'unit' || t.k === 'pet' ? 'sel' : t.k === 'npc' ? 'talk' : cur, ic, label };
  }
  // приказ по намерению (ПКМ / тап при выделении)
  function apply(it, t) {
    const us = Colony.selected();
    if (!us.length && !heroSel) return hint(':people: Выдели людей рамкой');
    if (!it || it.k === 'none') { if (t.k === 'blocked') hint(':close: Туда нельзя'); return; }
    if (it.k === 'hero') {
      heroGo = { x: it.x, y: it.y, stop: it.stop, until: now + Math.hypot(it.x - G.p.x, it.y - G.p.y) / 60 + 3 };
      G.col.mark = { x: it.x, y: it.y, t: 0.8 }; hint(it.label); return;
    }
    const w = t.w;
    G.col.mark = { x: w.x, y: w.y, t: 0.8 };
    if (t.k === 'wreck' && us.some(u => u.type === 'bich') && !wreckLoot(t.o.key)) Fx.toast(':scrap: Людям тут больше нечего брать');
    us.forEach((u, i) => {
      const T = UNITS[u.type];
      u.prev = null; u.idleT = 0;
      if (it.k === 'attack' && T.dmg) { u.task = { k: 'attack', o: t.o }; return; }
      if (u.type === 'bich') {
        if (it.k === 'build') { u.task = { k: 'build', b: t.o.id }; return; }
        if (it.k === 'stack') { u.task = { k: 'stack' }; return; }
        if (it.k === 'chop') { u.task = { k: 'chop', ph: 'go', tree: t.o }; return; }
        if (it.k === 'fish') { u.task = { k: 'fish', ph: 'go', x: w.x + (i % 3 - 1) * 26, y: w.y + ((i / 3) | 0) * 22 }; return; }
        if (it.k === 'wreck') { u.task = { k: 'wreck', ph: 'go', w: t.o.key }; return; }
      }
      if (u.type === 'evenk' && (t.k === 'hare' || t.k === 'tree')) { u.task = { k: 'hunt', ph: 'go' }; return; }
      const col = i % 4, row = (i / 4) | 0;
      u.task = { k: 'move', x: w.x + (col - 1.5) * 22, y: w.y + row * 22 };
    });
    hint(it.label);
  }

  // ---------- выделение ----------
  const onScreen = u => { const p = GFX.worldToScreen(u.x, u.y - 14); return p.x > 0 && p.y > 0 && p.x < innerWidth && p.y < innerHeight; };
  function selectSame(u, add) {
    const ids = G.col.units.filter(o => !o.hidden && !o.pet && o.type === u.type && onScreen(o)).map(o => o.id);
    G.col.sel = add ? [...new Set([...G.col.sel, ...ids])] : ids; heroSel = false;
    hint(`${UNITS[u.type].i} ×${ids.length}`); tips('select');
  }
  function inBox(d) {
    const a = GFX.screenToWorld(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1)), b = GFX.screenToWorld(Math.max(d.x0, d.x1), Math.max(d.y0, d.y1)), h = HIT.unit;
    return G.col.units.filter(u => !u.hidden && !u.pet && u.x + h.hw > a.x && u.x - h.hw < b.x && u.y + h.bot > a.y && u.y + h.top < b.y);
  }
  function boxSelect(d) {
    const ids = inBox(d).map(u => u.id);
    G.col.sel = d.shift ? [...new Set([...G.col.sel, ...ids])] : ids;
    if (ids.length) heroSel = false;
    if (G.col.sel.length) tips('select');
  }
  function click(x, y, shift) {
    const t = pick(x, y, false), T = performance.now();
    if (T - clicks.t < TH.dblMs && Math.hypot(x - clicks.x, y - clicks.y) <= TH.dblPx) clicks.n++; else clicks.n = 1;
    clicks.t = T; clicks.x = x; clicks.y = y;
    if (t.k === 'unit' || t.k === 'pet') {
      heroSel = false;
      if (clicks.n >= 2 && t.k === 'unit') return selectSame(t.o, shift);
      const id = t.o.id;
      if (shift) G.col.sel = G.col.sel.includes(id) ? G.col.sel.filter(i => i !== id) : [...G.col.sel, id];
      else G.col.sel = [id];
      tips('select');
    } else if (t.k === 'hero') {
      if (shift && G.col.sel.length) return;
      heroSel = true; G.col.sel = []; hint(':person: Герой · ПКМ — идти');
    } else if (t.k === 'npc') hint(':talk: E — говорить');
    else if (!shift) { G.col.sel = []; heroSel = false; }
  }
  function command(x, y) { const t = pick(x, y, lastType !== 'mouse'); apply(intent(t), t); }

  // ---------- камера: перетаскивание 1:1 и инерция §5 ----------
  function panStart(x, y) { inertia = null; pan = { x, y, s: [{ t: performance.now(), x, y }] }; }
  function panMove(x, y) {
    if (!pan) return;
    GFX.pan(-(x - pan.x) / GFX.zoom, -(y - pan.y) / GFX.zoom); pan.x = x; pan.y = y;
    const T = performance.now(); pan.s.push({ t: T, x, y }); while (pan.s.length > 2 && T - pan.s[0].t > 100) pan.s.shift();
  }
  function panEnd(fling) {
    if (pan && fling) {
      const T = performance.now(), s = pan.s.filter(q => T - q.t <= 100);
      if (s.length >= 2) {
        const a = s[0], b = s[s.length - 1], dt = Math.max(0.016, (b.t - a.t) / 1000), vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
        if (Math.hypot(vx, vy) > 300) inertia = { vx, vy };
      }
    }
    pan = null;
  }

  // ---------- мышь ----------
  function reset() {
    if (tp) clearTimeout(tp.long);
    st = 'IDLE'; press = null; pan = null; tp = null; pinch = null; touches.clear();
  }
  function onDown(e) {
    inertia = null;
    if (e.pointerType !== 'mouse') return touchDown(e);
    lastType = 'mouse'; mouse = { x: e.clientX, y: e.clientY, over: true };
    const g = gate();
    if (g === 'modal') return;
    if (g === 'panel') { if (e.button !== 1) { e.preventDefault(); UI.closePanel(); } return; }
    try { cvs.setPointerCapture(e.pointerId); } catch (_) { /* нет захвата — хватит window */ }
    const x = e.clientX, y = e.clientY;
    if (e.button === 1) { e.preventDefault(); press = null; st = 'PAN'; panStart(x, y); return; }
    if (arrow && e.button === 0 && Math.hypot(x - arrow.x, y - arrow.y) < 26) { GFX.recenter(); return; }
    if (G.col.ghost) {
      if (e.button === 2) { G.col.ghost = null; st = 'IDLE'; return; }
      if (e.button === 0) { st = 'PLACE_PRESS'; press = { x0: x, y0: y, x1: x, y1: y, shift: e.shiftKey }; }
      return;
    }
    if (e.button === 0) { st = 'PRESS'; press = { x0: x, y0: y, x1: x, y1: y, shift: e.shiftKey }; }
    else if (e.button === 2) { st = 'CMD_PRESS'; press = { x0: x, y0: y, x1: x, y1: y }; }
  }
  function onMove(e) {
    if (e.pointerType !== 'mouse') return touchMove(e);
    lastType = 'mouse';
    const x = e.clientX, y = e.clientY, b = e.buttons;
    mouse = { x, y, over: e.target === cvs };
    if (press) { press.x1 = x; press.y1 = y; }
    const far = n => press && Math.hypot(x - press.x0, y - press.y0) >= n;
    const toPan = () => { press = null; st = 'PAN'; panStart(x, y); };
    switch (st) {
      case 'PAN': if (!(b & 4)) { st = 'IDLE'; panEnd(true); } else panMove(x, y); break;
      case 'PRESS': case 'BOX':
        if (b & 4) toPan(); // СКМ поверх рамки — пан, рамка без эффекта
        else if (b & 2) { st = 'IDLE'; press = null; } // ПКМ — отмена рамки, выделение прежнее
        else if (!(b & 1)) { st = 'IDLE'; press = null; }
        else if (st === 'PRESS' && far(TH.click)) st = 'BOX';
        break;
      case 'CMD_PRESS':
        if (b & 4) toPan();
        else if ((b & 1) || !(b & 2) || far(TH.cmd)) { st = 'IDLE'; press = null; }
        break;
      case 'PLACE_PRESS':
        if (b & 4) toPan();
        else if (b & 2) { G.col.ghost = null; st = 'IDLE'; press = null; }
        else if (!(b & 1) || far(TH.place)) { st = 'IDLE'; press = null; }
        break;
      default: if (b & 4 && e.target === cvs && gate() === 'world') toPan();
    }
  }
  function onUp(e) {
    if (e.pointerType !== 'mouse') return touchEnd(e);
    const x = e.clientX, y = e.clientY, d = press ? Math.hypot(x - press.x0, y - press.y0) : 0, p = press;
    switch (st) {
      case 'PAN': if (!(e.buttons & 4)) { st = 'IDLE'; panEnd(true); } return;
      case 'PRESS': if (e.button === 0) { st = 'IDLE'; press = null; if (state === 'play') click(x, y, p.shift); } return;
      case 'BOX': if (e.button === 0) { st = 'IDLE'; press = null; if (state === 'play') boxSelect(p); } return;
      case 'CMD_PRESS': if (e.button === 2) { st = 'IDLE'; press = null; if (d < TH.cmd && gate() === 'world') command(x, y); } return;
      case 'PLACE_PRESS':
        if (e.button === 0) {
          st = 'IDLE'; press = null;
          const g = G.col.ghost; if (!g || d >= TH.place) return;
          const w = GFX.screenToWorld(x, y); g.x = w.x; g.y = w.y; g.touch = false;
          const type = g.type, n = G.col.builds.length; Colony.place();
          if (p.shift && G.col.builds.length > n && !G.col.ghost) { Colony.startPlace(type); if (G.col.ghost) { G.col.ghost.x = w.x; G.col.ghost.y = w.y; G.col.ghost.touch = false; } }
        }
    }
  }
  function onWheel(e) {
    e.preventDefault();
    if (gate() !== 'world') return;
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 800 : 1);
    GFX.setZoom(GFX.zoom * Math.exp(-clamp(dy, -120, 120) * 0.0018), e.clientX, e.clientY);
    tips('zoom');
  }

  // ---------- тач §8 ----------
  function touchDown(e) {
    lastType = 'touch';
    const g = gate();
    if (g === 'modal') return;
    if (g === 'panel') { e.preventDefault(); UI.closePanel(); return; }
    const x = e.clientX, y = e.clientY;
    touches.set(e.pointerId, { x, y });
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      if (tp) clearTimeout(tp.long);
      tp = null; press = null; st = 'PINCH';
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: GFX.zoom }; panStart((a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (touches.size > 2) return;
    const t = pick(x, y, true), it = (G.col.sel.length || heroSel) && !G.col.ghost && t.k !== 'unit' && t.k !== 'pet' && t.k !== 'hero' ? intent(t) : null;
    tp = { id: e.pointerId, x0: x, y0: y, x, y, t, mode: 'press', ic: it && it.k !== 'none' ? it.ic : it && it.cur === 'no' ? 'close' : null };
    st = 'TPRESS';
    if (UI.orderMode && !G.col.ghost) tp.long = setTimeout(() => { if (tp && tp.mode === 'press') { tp.mode = 'box'; tp.ic = null; st = 'BOX'; press = { x0: tp.x0, y0: tp.y0, x1: tp.x, y1: tp.y }; } }, TH.longBox);
  }
  function touchMove(e) {
    const q = touches.get(e.pointerId); if (!q) return;
    lastType = 'touch'; q.x = e.clientX; q.y = e.clientY;
    if (pinch && touches.size >= 2) {
      const [a, b] = [...touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      GFX.setZoom(pinch.z * d / pinch.d, mx, my); panMove(mx, my);
      return;
    }
    if (!tp || tp.id !== e.pointerId) return;
    const x = q.x, y = q.y;
    if (tp.mode === 'press' && Math.hypot(x - tp.x0, y - tp.y0) >= TH.clickT) {
      clearTimeout(tp.long); tp.ic = null;
      if (G.col.ghost) tp.mode = 'ghost';
      else if (UI.orderMode && !['unit', 'pet', 'hero'].includes(tp.t.k)) { tp.mode = 'pan'; st = 'PAN'; panStart(tp.x0, tp.y0); }
      else { tp.mode = 'cancel'; st = 'IDLE'; }
    }
    if (tp.mode === 'ghost') { const g = G.col.ghost, w = GFX.screenToWorld(x, y); if (g) { g.x = w.x; g.y = w.y; g.touch = false; g.ok = Colony.canPlace(g.type, w.x, w.y); } }
    else if (tp.mode === 'pan') panMove(x, y);
    else if (tp.mode === 'box') { press.x1 = x; press.y1 = y; }
    tp.x = x; tp.y = y;
  }
  function touchEnd(e) {
    if (!touches.has(e.pointerId)) return;
    touches.delete(e.pointerId);
    if (pinch) { if (touches.size < 2) { pinch = null; panEnd(e.type === 'pointerup'); st = 'IDLE'; } return; }
    if (!tp || tp.id !== e.pointerId) { if (!touches.size) st = 'IDLE'; return; }
    const m = tp; tp = null; clearTimeout(m.long); st = 'IDLE';
    if (e.type !== 'pointerup' || gate() !== 'world') { pan = null; press = null; return; }
    if (m.mode === 'press') tap(e.clientX, e.clientY);
    else if (m.mode === 'box') { const d = press; press = null; boxSelect(d); }
    else if (m.mode === 'pan') panEnd(true);
  }
  function tap(x, y) {
    const t = pick(x, y, true), T = performance.now();
    if (G.col.ghost) { const g = G.col.ghost; g.x = t.w.x; g.y = t.w.y; g.touch = false; g.ok = Colony.canPlace(g.type, g.x, g.y); return; }
    const dbl = T - taps.t < TH.dblMsT && Math.hypot(x - taps.x, y - taps.y) <= TH.dblPxT;
    taps = { t: dbl ? 0 : T, x, y };
    if (t.k === 'unit' || t.k === 'pet') {
      heroSel = false;
      if (dbl && t.k === 'unit') return selectSame(t.o, false);
      G.col.sel = G.col.sel.includes(t.o.id) ? G.col.sel.filter(i => i !== t.o.id) : [...G.col.sel, t.o.id];
      tips('select');
    } else if (t.k === 'hero') { heroSel = !heroSel; if (heroSel) G.col.sel = []; }
    else if (G.col.sel.length || heroSel) apply(intent(t), t);
    else if (t.k === 'npc') hint(':talk: Подойди и нажми E');
  }
  // тап через зону джойстика: только по человеку или месту стройки, без порога по времени
  function joyTap(e) {
    if (gate() !== 'world') return;
    lastType = 'touch';
    const t = pick(e.clientX, e.clientY, true);
    if (G.col.ghost || t.k === 'unit' || t.k === 'pet') tap(e.clientX, e.clientY);
  }

  // ---------- клавиши: отмена по шагам §2.4 (раньше ui.js) ----------
  addEventListener('keydown', e => {
    if (state !== 'play' || !G || !G.col) return;
    if (e.code === 'Escape') {
      if (['PRESS', 'BOX', 'CMD_PRESS', 'TPRESS'].includes(st)) { reset(); e.stopImmediatePropagation(); return; }
      if (!UI.modal() && !G.col.ghost && !G.col.sel.length && heroSel) { heroSel = false; heroGo = null; e.stopImmediatePropagation(); }
    } else if (e.code === 'KeyB' && G.col.ghost && !UI.modal()) { G.col.ghost = null; st = 'IDLE'; e.stopImmediatePropagation(); }
  });

  // ---------- герой: WASD / джойстик главнее, путь по ПКМ — вторым ----------
  function steer(mx, my) {
    const man = Math.hypot(mx, my) > 0.15;
    if (man && !manualPrev && state === 'play') { heroGo = null; GFX.follow(0.35); } // первое нажатие — камера к герою
    manualPrev = man;
    if (man || !heroGo || state !== 'play' || !G.p || G.p.sleeping) return null;
    const p = G.p, d = Math.hypot(heroGo.x - p.x, heroGo.y - p.y);
    if (d <= heroGo.stop || now > heroGo.until) { heroGo = null; return null; }
    const wp = d > 40 ? Nav.way(p, heroGo.x, heroGo.y) : heroGo, dx = wp.x - p.x, dy = wp.y - p.y, l = Math.hypot(dx, dy) || 1;
    const k = clamp((d - heroGo.stop) / 40 + 0.35, 0.35, 1);
    return { x: dx / l * k, y: dy / l * k };
  }

  // ---------- кадр ----------
  function tick(dt) {
    if (state !== 'play' || !G || !G.col) return;
    if (G.col.sel.length) heroSel = false;
    if (inertia) {
      if (!GFX.free || st === 'PAN' || st === 'PINCH') inertia = null;
      else {
        GFX.pan(-inertia.vx * dt / GFX.zoom, -inertia.vy * dt / GFX.zoom);
        const f = Math.pow(0.98, dt / 0.016); inertia.vx *= f; inertia.vy *= f;
        if (Math.hypot(inertia.vx, inertia.vy) < 20) inertia = null;
      }
    }
    // край экрана: только мышь, не во время рамки/пана, не при панели
    if (mouse && lastType === 'mouse' && gate() === 'world' && Settings.get('edge') && !['PRESS', 'BOX', 'PAN', 'CMD_PRESS'].includes(st)) {
      const m = TH.edge, sp = TH.edgeSp * dt / GFX.zoom;
      let dx = 0, dy = 0;
      if (mouse.x <= m) dx = -1; else if (mouse.x >= innerWidth - 1 - m) dx = 1;
      if (mouse.y <= m) dy = -1; else if (mouse.y >= innerHeight - 1 - m) dy = 1;
      if (dx || dy) GFX.pan(dx * sp, dy * sp);
    }
  }
  // призрак, наведение, курсор — от последней экранной точки при текущей камере
  function sync() {
    if (state !== 'play' || !G || !G.col) return;
    const g = gate(), gh = G.col.ghost;
    if (gh && !gh.touch && mouse && lastType === 'mouse') { const w = GFX.screenToWorld(mouse.x, mouse.y); gh.x = w.x; gh.y = w.y; gh.ok = Colony.canPlace(gh.type, w.x, w.y); }
    if (gh && st === 'IDLE') st = 'PLACE';
    if (!gh && (st === 'PLACE' || st === 'PLACE_PRESS')) st = 'IDLE';
    hover = mouse && mouse.over && lastType === 'mouse' && g === 'world' && st !== 'PAN' && st !== 'BOX' ? pick(mouse.x, mouse.y, false) : null;
    hoverIt = hover ? intent(hover) : null;
    setCursor(st === 'PAN' ? 'pan' : st === 'BOX' ? 'box' : g !== 'world' ? 'none' : gh ? (gh.ok ? 'place' : 'placeBad') : hoverIt ? hoverIt.cur : 'none');
  }
  function setCursor(n) { if (n !== curName) { curName = n; cvs.style.cursor = CUR[n]; } }

  // ---------- отрисовка: подсветка, рамка, значок у пальца, стрелка к герою (из gfx.js одной строкой) ----------
  function draw(cx, o) {
    arrow = null;
    if (state !== 'play' || !G || !G.col) return;
    sync();
    const dpr = o.dpr, now_ = now;
    cx.setTransform(dpr, 0, 0, dpr, (-cam.x + o.shx) * dpr, (-cam.y + o.shy) * dpr);
    cx.lineWidth = 2; cx.textAlign = 'center';
    const ring = (x, y, rx, col) => { cx.strokeStyle = col; cx.beginPath(); cx.ellipse(x, y, rx, rx * 0.4, 0, 0, Math.PI * 2); cx.stroke(); };
    const label = (t, x, y, col = '#fff') => { cx.font = '600 12px "PT Sans", sans-serif'; cx.lineWidth = 3; cx.strokeStyle = 'rgba(10,20,30,0.75)'; cx.strokeText(t, x, y); cx.fillStyle = col; cx.fillText(t, x, y); cx.lineWidth = 2; };
    const rect = (x, y, h, col, dash) => { cx.strokeStyle = col; if (dash) cx.setLineDash([6, 4]); cx.strokeRect(x - h.hw, y + h.top, h.hw * 2, h.bot - h.top); cx.setLineDash([]); };
    if (heroSel) ring(G.p.x, G.p.y, 18, '#ffd27a');
    if (heroGo) { cx.fillStyle = '#ffd27a'; cx.beginPath(); cx.arc(heroGo.x, heroGo.y, 3 + Math.sin(now_ * 6), 0, Math.PI * 2); cx.fill(); }
    const h = hover, it = hoverIt;
    if (h && !G.col.ghost && st !== 'BOX') {
      const red = it && it.k === 'attack', gold = '#ffd27a';
      switch (h.k) {
        case 'unit': ring(h.o.x, h.o.y, 16, '#fff'); label(UNITS[h.o.type].n, h.o.x, h.o.y - 52); break;
        case 'pet': ring(h.o.x, h.o.y, 16, '#fff'); break;
        case 'hero': ring(h.o.x, h.o.y, 18, '#fff'); break;
        case 'npc': ring(h.o.x, h.o.y, 16, '#fff'); label('E — говорить', h.o.x, h.o.y - 60, gold); break;
        case 'wolf': case 'bear': ring(h.o.x, h.o.y, h.k === 'bear' ? 38 : 26, red ? '#e25a4f' : '#fff'); break;
        case 'hare': ring(h.o.x, h.o.y, 14, it && it.k === 'hunt' ? gold : '#fff'); break;
        case 'tree': if (it && (it.k === 'chop' || it.k === 'hunt')) { cx.globalAlpha = 0.22; cx.fillStyle = '#fff'; cx.beginPath(); cx.ellipse(h.o.x, h.o.y - 80, h.o.kind === 2 ? 40 : 30, 70, 0, 0, Math.PI * 2); cx.fill(); cx.globalAlpha = 1; ring(h.o.x, h.o.y, 16, gold); } break;
        case 'site': case 'build': { const B = BUILDS[h.o.type]; cx.strokeStyle = gold; cx.setLineDash([6, 4]); cx.strokeRect(h.o.x - B.w / 2, h.o.y - B.h / 2, B.w, B.h); cx.setLineDash([]); if (h.k === 'site') label(Math.floor((h.o.prog || 0) * 100) + '%', h.o.x, h.o.y - B.h / 2 - 8, gold); break; }
        case 'stack': rect(h.o.x, h.o.y, HIT.stack, gold); break;
        case 'wreck': rect(h.o.x, h.o.y, HIT[h.o.key], gold, 1); break;
        case 'ice': if (it && it.k === 'fish') { cx.strokeStyle = '#8cc3e6'; cx.beginPath(); cx.ellipse(h.w.x, h.w.y, 12, 6, 0, 0, Math.PI * 2); cx.stroke(); } break;
        case 'ground': if (it && (it.k === 'move' || it.k === 'hero')) { cx.fillStyle = gold; cx.beginPath(); cx.arc(h.w.x, h.w.y, 3, 0, Math.PI * 2); cx.fill(); } break;
      }
    }
    if (st === 'BOX' && press) for (const u of inBox(press)) ring(u.x, u.y, 16, '#ffd27a');
    // экранные px
    cx.setTransform(o.rdpr, 0, 0, o.rdpr, 0, 0);
    if (st === 'BOX' && press) {
      const d = press, x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1), w = Math.abs(d.x1 - d.x0), hh = Math.abs(d.y1 - d.y0);
      cx.fillStyle = 'rgba(255,210,122,0.12)'; cx.strokeStyle = '#ffd27a'; cx.lineWidth = 1.5; cx.fillRect(x, y, w, hh); cx.strokeRect(x, y, w, hh);
    }
    if (tp && tp.ic && tp.mode === 'press') {
      const x = tp.x, y = tp.y - 56;
      cx.fillStyle = 'rgba(11,21,32,0.8)'; cx.beginPath(); cx.arc(x, y, 22, 0, Math.PI * 2); cx.fill();
      Icons.draw(cx, tp.ic, x, y, 24, '#ebe6d3');
    }
    // герой за краем при свободной камере — стрелка ➤ к нему (клик — вернуть камеру)
    if (GFX.free) {
      const p = GFX.worldToScreen(G.p.x, G.p.y - 24), Wd = innerWidth, Hd = innerHeight;
      if (p.x < 0 || p.y < 0 || p.x > Wd || p.y > Hd) {
        const a = Math.atan2(p.y - Hd / 2, p.x - Wd / 2), rx = Wd / 2 - 40, ry = Hd / 2 - 40, k = 0.9 / Math.hypot(Math.cos(a) / rx, Math.sin(a) / ry);
        const ax = Wd / 2 + Math.cos(a) * k, ay = Hd / 2 + Math.sin(a) * k; arrow = { x: ax, y: ay };
        cx.save(); cx.translate(ax, ay);
        cx.fillStyle = 'rgba(11,21,32,0.76)'; cx.beginPath(); cx.arc(0, 0, 20, 0, Math.PI * 2); cx.fill();
        cx.rotate(a); cx.fillStyle = '#ffd27a'; cx.beginPath(); cx.moveTo(28, 0); cx.lineTo(19, -6); cx.lineTo(19, 6); cx.closePath(); cx.fill();
        cx.restore();
        Icons.draw(cx, 'person', ax, ay, 18, '#ebe6d3');
      }
    }
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  cvs.addEventListener('contextmenu', e => e.preventDefault());
  cvs.addEventListener('pointerdown', onDown);
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', e => { if (e.pointerType === 'mouse' || touches.has(e.pointerId)) { reset(); } });
  cvs.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('mouseleave', () => { mouse = null; });
  addEventListener('blur', () => { reset(); mouse = null; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });

  return {
    tick, draw, sync, steer, joyTap, pick, intent, gate,
    get st() { return st; }, get hero() { return heroSel; }, set hero(v) { heroSel = !!v; if (v) G.col.sel = []; },
    debug: () => ({ st, cursor: curName, css: cvs.style.cursor, hover: hover && { k: hover.k, x: Math.round(hover.w.x), y: Math.round(hover.w.y) }, intent: hoverIt && hoverIt.k,
      cam: { x: cam.x, y: cam.y, mode: GFX.mode }, hero: heroSel, heroGo: heroGo && { x: heroGo.x, y: heroGo.y }, inertia: !!inertia, touch: tp && { mode: tp.mode, ic: tp.ic }, fingers: touches.size, press: press && Object.assign({}, press) }),
  };
})();
