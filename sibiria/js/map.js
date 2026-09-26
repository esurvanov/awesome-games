'use strict';
// Большая карта мира (A9): «геологическая схема» на бумаге, туман 3 состояния, зоны с названиями,
// отметки игрока, цель, люди; клик по зоне — быстрый переход (Transport.travel).
// Слои (снизу вверх): бумага → [набросок: русло, границы зон, лес штрихом] → [съёмка: заливки и штриховка зон,
// знаки объектов] → названия, места, люди, герой, отметки → рамка (роза, линейка, «открыто»).
// Подложки 1024² печёт bake() раз на мир (seed); туман — маска NX×NY клеток, растянутая со сглаживанием (мягкий край).
const WorldMap = (() => {
  const S = 1024, K = S / Math.max(W, H);
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const PAPER = mk(S, S), SKETCH = mk(S, S), FULL = mk(S, S), TMP = mk(S, S);
  const INK = '#2b2f3a', PEN = 'rgba(58,47,34,.55)', VIOLET = '#4e3f94', RED = '#b8392d';
  // условные знаки зон (A9): заливка и штриховка
  const STY = {
    naled: { fill: 'rgba(140,195,230,.35)', hatch: 'waves', c: '#3f6f9a' },
    gar: { fill: 'rgba(43,47,58,.16)', hatch: 'diag', c: '#2b2f3a' },
    kurum: { fill: 'rgba(108,113,120,.2)', hatch: 'circles', c: '#5d626b' },
    golets: { fill: 'rgba(138,106,69,.16)', hatch: 'contour', c: '#8a5a2b' },
    drill: { fill: 'rgba(184,57,45,.08)', hatch: null, c: RED },
    meteo: { fill: 'rgba(63,111,122,.1)', hatch: null, c: '#3f6f7a' },
    zimnik: { fill: 'rgba(143,124,92,.1)', hatch: null, c: '#6d6453' },
    stoibishe: { fill: 'rgba(199,154,98,.14)', hatch: 'dots', c: '#8a6a45' },
  };
  let bakedFor = null;
  function pattern(g, kind, c) {
    const p = mk(16, 16), q = p.getContext('2d');
    q.strokeStyle = c; q.fillStyle = c; q.lineWidth = 1;
    if (kind === 'diag') { q.beginPath(); q.moveTo(0, 16); q.lineTo(16, 0); q.moveTo(-4, 4); q.lineTo(4, -4); q.moveTo(12, 20); q.lineTo(20, 12); q.stroke(); }
    else if (kind === 'waves') { q.beginPath(); q.moveTo(1, 8); q.quadraticCurveTo(4.5, 4, 8, 8); q.quadraticCurveTo(11.5, 12, 15, 8); q.stroke(); }
    else if (kind === 'circles') { q.beginPath(); q.arc(5, 5, 2.2, 0, 7); q.moveTo(15, 12); q.arc(12.5, 12, 2.5, 0, 7); q.stroke(); }
    else if (kind === 'dots') { q.fillRect(3, 3, 1.6, 1.6); q.fillRect(11, 10, 1.6, 1.6); }
    else if (kind === 'contour') { q.beginPath(); q.moveTo(0, 5); q.quadraticCurveTo(8, 2, 16, 5); q.moveTo(0, 13); q.quadraticCurveTo(8, 10, 16, 13); q.stroke(); }
    return g.createPattern(p, 'repeat');
  }
  // ---------- подложки: раз на мир ----------
  function bake() {
    if (bakedFor === G.seed && Zones.built === G.seed) return;
    bakedFor = G.seed;
    const r = mulberry(G.seed ^ 0x3A9);
    // бумага: крафт, волокна, миллиметровка
    let g = PAPER.getContext('2d');
    g.fillStyle = '#ece2c9'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) { g.fillStyle = r() < 0.5 ? 'rgba(143,124,92,.07)' : 'rgba(255,250,235,.25)'; g.fillRect(r() * S, r() * S, 1 + r() * 30, 1); }
    g.strokeStyle = 'rgba(184,57,45,.08)'; g.lineWidth = 1; g.beginPath();
    for (let v = 0; v <= S; v += S / 54) { g.moveTo(v, 0); g.lineTo(v, S); g.moveTo(0, v); g.lineTo(S, v); } g.stroke();
    g.strokeStyle = 'rgba(184,57,45,.16)'; g.beginPath();
    for (let v = 0; v <= S; v += S / 13.1) { g.moveTo(v, 0); g.lineTo(v, S); g.moveTo(0, v); g.lineTo(S, v); } g.stroke(); // сетка ≈ 1 км
    const C = Zones.C * K, NX = Zones.NX, NY = Zones.NY;
    // набросок: лес штрихом-«галочкой», русло, границы зон карандашом
    g = SKETCH.getContext('2d'); g.clearRect(0, 0, S, S);
    g.strokeStyle = 'rgba(47,90,58,.6)'; g.lineWidth = 0.9; g.beginPath();
    for (const t of G.trees) if (!t.wall && t.kind !== 3 && ((t.x * 7 + t.y) % 2) === 0) { const x = t.x * K, y = t.y * K; g.moveTo(x - 1.6, y - 1.4); g.lineTo(x, y); g.lineTo(x + 2.4, y - 2.6); }
    g.stroke();
    g.strokeStyle = 'rgba(43,47,58,.55)'; g.beginPath();
    for (const t of G.trees) if (t.kind === 3 && ((t.x + t.y) & 1)) { const x = t.x * K, y = t.y * K; g.moveTo(x, y); g.lineTo(x, y - 3); }
    g.stroke();
    river(g, PEN, 2.2);
    g.strokeStyle = PEN; g.lineWidth = 1; g.setLineDash([3, 2]); g.beginPath();
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const k = j * NX + i, z = Zones.zid(k);
      if (i + 1 < NX && Zones.zid(k + 1) !== z) { g.moveTo((i + 1) * C, j * C); g.lineTo((i + 1) * C, (j + 1) * C); }
      if (j + 1 < NY && Zones.zid(k + NX) !== z) { g.moveTo(i * C, (j + 1) * C); g.lineTo((i + 1) * C, (j + 1) * C); }
    }
    g.stroke(); g.setLineDash([]);
    // съёмка: заливки и штриховки зон, марь, зимник, знаки объектов
    g = FULL.getContext('2d'); g.clearRect(0, 0, S, S);
    g.drawImage(SKETCH, 0, 0);
    for (const z of Zones.ACT) {
      const st = STY[z.id]; if (!st) continue;
      const P = new Path2D(), zi = Zones.IDS.indexOf(z.id) + 1;
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) if (Zones.zid(j * NX + i) === zi) P.rect(i * C - 0.3, j * C - 0.3, C + 0.6, C + 0.6);
      g.fillStyle = st.fill; g.fill(P);
      if (st.hatch) { g.save(); g.globalAlpha = 0.55; g.fillStyle = pattern(g, st.hatch, st.c); g.fill(P); g.restore(); }
    }
    g.fillStyle = 'rgba(138,106,69,.25)'; for (let i = 0; i < 90; i++) { const a = r() * 6.28, d = Math.sqrt(r()) * POI.mar.r; g.fillRect((POI.mar.x + Math.cos(a) * d) * K, (POI.mar.y + Math.sin(a) * d) * K, 1.4, 1.4); }
    river(g, '#3f6f9a', 2.6);
    if (ZONES.zimnik.active) { // зимник: пунктир с вешками вдоль реки
      g.strokeStyle = '#6d6453'; g.lineWidth = 1.4; g.setLineDash([5, 4]); g.beginPath();
      for (let y = WORLD.oy + WORLD.BASE + 250; y <= H; y += 40) g.lineTo((riverX(y) + 40) * K, y * K);
      g.stroke(); g.setLineDash([]);
    }
    for (const q of G.rocks || []) { g.strokeStyle = 'rgba(93,98,107,.7)'; g.beginPath(); g.arc(q.x * K, q.y * K, 1.6 * q.s, 0, 7); g.stroke(); }
    for (const o of Zones.OBJS) if (o.type !== 'spot' && o.type !== 'steam') { g.fillStyle = INK; g.fillRect(o.x * K - 1.2, o.y * K - 1.2, 2.4, 2.4); }
  }
  function river(g, c, w) { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); for (let y = 0; y <= H; y += 40) g.lineTo(riverX(y) * K, y * K); g.stroke(); }

  // ---------- туман: маска клеток (1 — набросок и выше, 2 — съёмка) ----------
  const F = World.FOG, MA = mk(F.nx, F.ny), MB = mk(F.nx, F.ny);
  let fogSig = -1;
  function masks() {
    let sig = 0; for (let i = 0; i < G.fog.length; i++) sig = (sig * 3 + G.fog[i]) | 0;
    if (sig === fogSig) return false; fogSig = sig;
    const a = MA.getContext('2d').createImageData(F.nx, F.ny), b = MB.getContext('2d').createImageData(F.nx, F.ny);
    for (let i = 0; i < G.fog.length; i++) { const v = G.fog[i]; a.data[i * 4 + 3] = v >= 1 ? 255 : 0; b.data[i * 4 + 3] = v >= 2 ? 255 : 0; }
    MA.getContext('2d').putImageData(a, 0, 0); MB.getContext('2d').putImageData(b, 0, 0);
    return true;
  }
  const COMP = mk(S, S);
  function compose() {
    if (!masks() && COMP._ok) return;
    COMP._ok = true;
    const g = COMP.getContext('2d'), t = TMP.getContext('2d');
    g.globalCompositeOperation = 'source-over'; g.drawImage(PAPER, 0, 0);
    const fs = F.cell * K; // клетка тумана в px подложки
    for (const [layer, mask] of [[SKETCH, MA], [FULL, MB]]) {
      t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, S, S); t.drawImage(layer, 0, 0);
      t.globalCompositeOperation = 'destination-in'; t.imageSmoothingEnabled = true; t.drawImage(mask, 0, 0, F.nx * fs, F.ny * fs);
      g.drawImage(TMP, 0, 0);
    }
    t.globalCompositeOperation = 'source-over';
  }
  const fogAt = (x, y) => { const i = (x / F.cell) | 0, j = (y / F.cell) | 0; return i < 0 || j < 0 || i >= F.nx || j >= F.ny ? 0 : G.fog[j * F.nx + i]; };
  const opened = () => { let n = 0; for (const v of G.fog) if (v) n++; return Math.round(n / G.fog.length * 100); };

  // ---------- экран ----------
  const cv = $('map-cv'), cx = cv.getContext('2d');
  let tool = null, sel = null, view = { s: 1, ox: 0, oy: 0, px: 0 }, t0 = 0;
  const MARKS = { warn: ':alarm:', wolf: ':wolf:', fish: ':fish:', wood: ':wood:' };
  function size() {
    const box = cv.parentElement.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
    const px = Math.max(120, Math.floor(Math.min(box.width, box.height)));
    cv.style.width = cv.style.height = px + 'px';
    if (cv.width !== Math.round(px * d)) { cv.width = cv.height = Math.round(px * d); }
    view = { d, px, k: px / Math.max(W, H) };
  }
  const toW = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; };
  function draw() {
    if (!G) return;
    bake(); compose(); size();
    const { d, px, k } = view, T = now;
    cx.setTransform(1, 0, 0, 1, 0, 0); cx.imageSmoothingEnabled = true;
    cx.drawImage(COMP, 0, 0, cv.width, cv.height);
    cx.setTransform(d, 0, 0, d, 0, 0);
    const X = x => x * k, Y = y => y * k;
    // участок зимовья — рамкой, места — значками, как знаю
    cx.strokeStyle = 'rgba(78,63,148,.35)'; cx.setLineDash([2, 3]); cx.strokeRect(X(WORLD.ox), Y(WORLD.oy), WORLD.BASE * k, WORLD.BASE * k); cx.setLineDash([]);
    for (const id in POI) if (G.known[id] && id !== 'labaz') Icons.draw(cx, POI[id].ic, X(POI[id].x), Y(POI[id].y), 14, INK);
    // зоны: знак и имя (пройдена/отснята), «?» — видел край
    cx.textAlign = 'center'; cx.textBaseline = 'middle';
    for (const z of Zones.ACT) {
      const seen = G.zoneSeen[z.id], fx = fogAt(z.x, z.y), x = X(z.x), y = Y(z.y);
      if (!seen && !fx) { if (fogAt(z.x + z.r * 0.7, z.y) || fogAt(z.x - z.r * 0.7, z.y) || fogAt(z.x, z.y + z.r * 0.7) || fogAt(z.x, z.y - z.r * 0.7)) { cx.font = '20px "Neucha", cursive'; cx.fillStyle = VIOLET; cx.fillText('?', x, y); } continue; }
      if (!seen) { cx.font = '20px "Neucha", cursive'; cx.fillStyle = VIOLET; cx.fillText('?', x, y); continue; }
      const on = sel === z.id, open = Transport.open(z.id);
      Icons.draw(cx, z.ic, x, y - 12, 18, on ? RED : INK);
      cx.font = `${on ? 700 : 400} 15px "Neucha", "PT Sans", cursive`; cx.fillStyle = on ? RED : VIOLET;
      cx.fillText(z.n, x, y + 8);
      if (open) { cx.fillStyle = 'rgba(63,122,42,.9)'; cx.beginPath(); cx.arc(x + cx.measureText(z.n).width / 2 + 7, y + 8, 3, 0, 7); cx.fill(); }
    }
    // ориентиры зон (объекты с mark): жильё, вышки, фактория — значок и подпись, как увидел
    cx.font = '11px "Neucha", "PT Sans", cursive'; cx.fillStyle = INK;
    for (const o of Zones.OBJS) {
      if (!o.mark || !Zones.here(o) || !(fogAt(o.x, o.y) || G.zoneSeen[o.zone] === 1)) continue;
      const x = X(o.x), y = Y(o.y);
      Icons.draw(cx, o.mark[0], x, y, 11, INK, 'rgba(236,226,201,.85)');
      cx.fillText(o.mark[1], x, y + 11);
    }
    // открытые промысловые участки — флажок
    if (G.plots) for (const id in G.plots) { const o = Zones.OBJS.find(q => q.type === 'plot' && q.zone === id); if (o) Icons.draw(cx, ':epoch:', X(o.x), Y(o.y), 12, RED, 'rgba(236,226,201,.9)'); }
    // отметки игрока
    for (const m of G.marks) Icons.draw(cx, MARKS[m.k] || ':pin:', X(m.x), Y(m.y), 14, RED, 'rgba(236,226,201,.9)');
    // транспорт, люди, цель, герой
    if (G.veh) { const v = G.veh; if (v.buran && (v.buran.fixed || fogAt(v.buran.x, v.buran.y) === 2) && G.p.ride !== 'buran') Icons.draw(cx, 'sled', X(v.buran.x), Y(v.buran.y), 12, INK); if (v.deer && G.p.ride !== 'deer') Icons.draw(cx, 'deer', X(v.deer.x), Y(v.deer.y), 12, INK); }
    for (const s of G.stashes || []) Icons.draw(cx, 'pack', X(s.x), Y(s.y), 12, INK);
    // люди: дед — охра, Вера — бирюза, люди зон — чернила (только в открытых местах карты)
    for (const n of Npc.list()) { if (n.rec.zone !== 'core' && !fogAt(n.st.x, n.st.y)) continue; cx.fillStyle = n.id === 'urk' ? '#8a6a45' : n.id === 'vera' ? '#3f6f7a' : '#4e3f94'; cx.fillRect(X(n.st.x) - 2, Y(n.st.y) - 2, 4, 4); }
    if (G.col) { cx.fillStyle = 'rgba(43,47,58,.7)'; for (const u of G.col.units) if (!u.hidden) cx.fillRect(X(u.x) - 1, Y(u.y) - 1, 2, 2); }
    const tg = Story.goalTarget();
    if (tg) { cx.strokeStyle = RED; cx.lineWidth = 2; cx.globalAlpha = 0.5 + 0.5 * Math.sin(T * 5); cx.beginPath(); cx.arc(X(tg.x), Y(tg.y), 6, 0, 7); cx.stroke(); cx.globalAlpha = 1; }
    const p = G.p, a = Math.hypot(p.vx || 0, p.vy || 0) > 5 ? Math.atan2(p.vy, p.vx) : (p.face < 0 ? Math.PI : 0);
    cx.save(); cx.translate(X(p.x), Y(p.y)); cx.rotate(a);
    cx.fillStyle = RED; cx.strokeStyle = '#fff6e6'; cx.lineWidth = 1.5; cx.beginPath(); cx.moveTo(9, 0); cx.lineTo(-6, -6); cx.lineTo(-3, 0); cx.lineTo(-6, 6); cx.closePath(); cx.stroke(); cx.fill();
    cx.restore();
    // рамка: роза ветров, линейка 1 км
    rose(22 + 14, 22 + 14);
    const km = 825 * k, bx = 16, by = px - 18;
    cx.fillStyle = INK; cx.fillRect(bx, by, km, 3); cx.fillStyle = '#ece2c9'; cx.fillRect(bx + km / 2, by + 0.8, km / 2 - 0.8, 1.4);
    cx.font = '11px "PT Mono", monospace'; cx.textAlign = 'left'; cx.fillStyle = INK; cx.fillText('0', bx - 2, by - 7); cx.fillText('1 км', bx + km - 8, by - 7);
    $('map-open').innerHTML = icx(':pin: Открыто ' + opened() + ' %', 's');
  }
  function rose(x, y) {
    cx.save(); cx.translate(x, y);
    cx.strokeStyle = INK; cx.fillStyle = INK; cx.lineWidth = 1;
    cx.beginPath(); cx.arc(0, 0, 12, 0, 7); cx.stroke();
    cx.beginPath(); cx.moveTo(0, -16); cx.lineTo(4, 0); cx.lineTo(0, 3); cx.lineTo(-4, 0); cx.closePath(); cx.fill();
    cx.fillStyle = '#ece2c9'; cx.beginPath(); cx.moveTo(0, 16); cx.lineTo(4, 0); cx.lineTo(-4, 0); cx.closePath(); cx.fill(); cx.stroke();
    cx.fillStyle = INK; cx.font = '700 11px "PT Sans", sans-serif'; cx.textAlign = 'center'; cx.fillText('С', 0, -22);
    cx.font = '12px "Neucha", cursive'; cx.fillStyle = VIOLET; cx.textAlign = 'left'; cx.fillText('скл. 1993: куда хочет', 20, 4);
    cx.restore();
  }
  // подсказка зоны: правило + переход
  function tip(id) {
    const el = $('map-tip'); sel = id;
    if (!id) { el.hidden = true; return; }
    const z = ZONES[id], w = Transport.why(id), c = Transport.cost(id);
    const rules = { naled: ':frost: мокро · :skis: ✖', gar: ':fire: сушняк · бурелом', kurum: ':skis: ✖ · вывих', golets: ':frost: ×1,5 · :pin: съёмка', drill: ':kero: :cable: · :sled: «Буран»', meteo: ':storm: прогноз · :pin: мачта', zimnik: ':sled: ×1,3 по льду', stoibishe: ':deer: упряжка', core: ':hut: изба' }[id] || '';
    el.innerHTML = `<div class="mt-h">${ic(z.ic)}<b>${icx(z.n)}</b></div><div class="mt-r">${icx(rules, 's')}</div>`
      + `<div class="mt-r">${icx(`:timer: ${Math.floor(c.h)} ч ${Math.round(c.h % 1 * 60)} мин · :food: −${c.food} · :warm: −${c.warm}`, 's')}</div>`
      + (w ? `<div class="mt-r dim">${icx(':close: ' + w, 's')}</div>` : `<button class="btn pri" id="map-go">${ic('play', 's')}Идти</button>`);
    el.hidden = false;
    const go = $('map-go'); if (go) go.onclick = () => { if (Transport.travel(id)) UI.closePanel(); };
  }
  function click(e) {
    const w = toW(e);
    if (tool) {
      const i = G.marks.findIndex(m => Math.hypot(m.x - w.x, m.y - w.y) < 250);
      if (i >= 0) G.marks.splice(i, 1); else { G.marks.push({ x: Math.round(w.x), y: Math.round(w.y), k: tool }); if (G.marks.length > 24) G.marks.shift(); }
      draw(); return;
    }
    const z = Zones.at(w.x, w.y), id = z ? z.id : null;
    tip(id && (G.zoneSeen[id] || id === 'core') ? id : null); draw();
  }
  let hold = null;
  cv.addEventListener('pointerdown', e => { e.preventDefault(); const pt = { clientX: e.clientX, clientY: e.clientY }; clearTimeout(hold); hold = setTimeout(() => { hold = 'done'; const was = tool; tool = tool || 'warn'; click(pt); tool = was; }, 550); });
  cv.addEventListener('pointerup', e => { if (hold === 'done') { hold = null; return; } clearTimeout(hold); hold = null; click(e); });
  cv.addEventListener('pointerleave', () => { if (hold !== 'done') clearTimeout(hold); });
  // панель пометок
  $('map-marks').innerHTML = Object.entries(MARKS).map(([k, i]) => `<button class="tab" data-k="${k}" title="Пометка">${ic(i.slice(1, -1))}</button>`).join('');
  $('map-marks').addEventListener('click', e => { const b = e.target.closest('.tab'); if (!b) return; tool = tool === b.dataset.k ? null : b.dataset.k; for (const x of $('map-marks').children) x.classList.toggle('on', x.dataset.k === tool); });
  $('map-close').onclick = () => UI.closePanel();
  function open() { $('bigmap').hidden = false; tool = null; for (const x of $('map-marks').children) x.classList.remove('on'); tip(null); t0 = 0; COMP._ok = false; draw(); }
  function close() { $('bigmap').hidden = true; tip(null); }
  function tick(dt) { t0 -= dt; if (t0 <= 0) { t0 = 0.2; draw(); } }
  addEventListener('resize', () => { if (!$('bigmap').hidden) draw(); });
  return { open, close, tick, draw, bake, get sel() { return sel; }, select: tip, opened };
})();
