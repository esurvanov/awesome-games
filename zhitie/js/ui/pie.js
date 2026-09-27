// Круговое меню: голова выбранного сима в центре, пункты разлетаются по кругу.
// Недоступные — серые, причина во всплывашке. Голова «смотрит» на пункт под курсором.
// Подменю: label вида 'Вызвать…/Мастер' → пункт «Вызвать…», при наведении — дуга дочерних пунктов.
import { h, esc, clamp } from './dom.js';
import { iconHtml } from './icons.js';
import { portraitSvg } from './portrait.js';

const SUB_GAP = 22;        // зазор между пунктом-группой и столбиком подменю, px
const SUB_STEP = 40;       // шаг между пунктами подменю, px
const ICON_R = 17;         // половина круга-иконки пункта (якорь подписи)
const SUB_CLOSE_MS = 280;  // задержка сворачивания подменю после ухода курсора

export function layoutPie(n, cx, cy, vw, vh) {
  const r = n <= 1 ? 70 : clamp(62 + n * 9, 78, 150);
  const m = r + 110; // запас под подписи
  const x = clamp(cx, Math.min(m, vw / 2), Math.max(vw - m, vw / 2));
  const y = clamp(cy, Math.min(r + 40, vh / 2), Math.max(vh - r - 40, vh / 2));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    pts.push(pointAt(a, r));
  }
  return { x, y, r, pts };
}

// точка на окружности + якорь подписи: слева — вправо, справа — влево, сверху/снизу — по центру
function pointAt(a, r) {
  const dx = Math.cos(a) * r, dy = Math.sin(a) * r;
  return { a, dx, dy, side: Math.abs(dx) < r * 0.3 ? 'c' : dx < 0 ? 'l' : 'r' };
}

// Группировка по «/»: [{key,label,...}] → верхний уровень [{item} | {group, label, kids}]
export function groupItems(items) {
  const out = [], groups = new Map();
  for (const it of items) {
    const i = String(it.label).indexOf('/');
    if (i < 0) { out.push({ item: it }); continue; }
    const head = it.label.slice(0, i).trim(), tail = it.label.slice(i + 1).trim();
    let g = groups.get(head);
    if (!g) { g = { group: true, label: head, kids: [] }; groups.set(head, g); out.push(g); }
    g.kids.push({ ...it, label: tail });
  }
  return out;
}

// Общение: у каждого соц. действия есть category (Мозг), порядок меню — SOCIAL_CATEGORIES.
// Длинный список → подменю «Категория…/Действие»; короткий (≤ min) — плоский.
export function groupSocials(items, order = [], min = 9) {
  if (items.length < min || items.some(i => String(i.label).includes('/')) || !items.some(i => i.category)) return items;
  const rank = c => { const i = order.indexOf(c); return i < 0 ? order.length : i; };
  return items.map((it, i) => ({ it, i }))
    .sort((a, b) => rank(a.it.category) - rank(b.it.category) || a.i - b.i)
    .map(({ it }) => (it.category ? { ...it, label: `${it.category}…/${it.label}` } : it));
}

// Подменю наружу от пункта-группы p (ширина кнопки группы headW): столбики до SUB_ROWS пунктов,
// длинный список (общение ~15) — в несколько столбиков. Справа/слева — рядом с кнопкой, сверху/снизу — дальше от центра.
const SUB_ROWS = 7, SUB_COL_W = 200;
export function layoutSub(n, p, headW) {
  const cols = Math.ceil(n / SUB_ROWS), rows = Math.ceil(n / cols);
  return Array.from({ length: n }, (_, i) => {
    const c = Math.floor(i / rows), r = i % rows, k = r - (rows - 1) / 2;
    if (p.side === 'r') return { dx: p.dx + headW + SUB_GAP + c * SUB_COL_W, dy: p.dy + k * SUB_STEP, side: 'r' };
    if (p.side === 'l') return { dx: p.dx - headW - SUB_GAP - c * SUB_COL_W, dy: p.dy + k * SUB_STEP, side: 'l' };
    const dir = p.dy < 0 ? -1 : 1;
    return { dx: p.dx + (c - (cols - 1) / 2) * SUB_COL_W, dy: p.dy + dir * (r + 1) * SUB_STEP, side: 'c' };
  });
}
// не даём подменю уехать за край экрана: сдвиг всей группы точек
export function fitSub(pts, cx, cy, vw, vh, pad = 24) {
  const xs = pts.map(q => cx + q.dx + (q.side === 'r' ? 190 : q.side === 'l' ? -190 : 0)), ys = pts.map(q => cy + q.dy);
  const sx = Math.min(0, vw - pad - Math.max(...xs, cx)) + Math.max(0, pad - Math.min(...xs, cx));
  const sy = Math.min(0, vh - pad - Math.max(...ys)) + Math.max(0, pad - Math.min(...ys));
  return pts.map(q => ({ ...q, dx: q.dx + sx, dy: q.dy + sy }));
}

export function createPie(ctx) {
  const { state, bus, api } = ctx;
  let el = null, openAt = 0;

  function close(sound = true) {
    if (!el) return;
    const old = el; el = null;
    old.classList.remove('open'); old.classList.add('closing');
    setTimeout(() => old.remove(), 160);
    if (sound) ctx.audio.sfx('close');
  }

  // target: {kind, id?, x, y, level}; items: [{key,label,icon,disabled,reason}]
  function open(clientX, clientY, sim, target, items, caption = '') {
    close(false);
    const top = groupItems(items);
    const L = layoutPie(top.length, clientX, clientY, innerWidth, innerHeight);
    el = h('div.zh-pie', { 'data-ui': 'pie', style: { left: `${L.x}px`, top: `${L.y}px` } });
    const hub = h('div.hub', { html: portraitSvg(sim, 58) });
    el.append(hub);
    if (caption) el.append(h('div.cap', { text: caption }));
    if (!items.length) el.append(h('div.none', { text: 'Нечего делать' }));
    const eyes = hub.querySelector('.eyes');
    const look = (dx, dy) => {
      const d = Math.hypot(dx, dy) || 1;
      eyes.style.setProperty('--ex', `${(dx / d * 1.6).toFixed(2)}px`);
      eyes.style.setProperty('--ey', `${(dy / d * 1.2).toFixed(2)}px`);
      hub.style.setProperty('--tilt', `${(dx / d * 8).toFixed(1)}deg`);
    };

    // кнопка пункта (обычного или дочернего)
    const makeItem = (it, p, i, cls = '') => {
      const btn = h('button.item.' + p.side + (it.disabled ? '.dis' : '') + cls, {
        style: { '--dx': `${p.dx.toFixed(1)}px`, '--dy': `${p.dy.toFixed(1)}px`, transitionDelay: `${i * 18}ms` },
        'data-key': it.key,
        html: `<span class="ii">${iconHtml(it.icon, 16)}</span><span class="il">${esc(it.label)}</span>${it.disabled && it.reason ? `<span class="why">${esc(it.reason)}</span>` : ''}`,
      });
      btn.title = it.disabled ? (it.reason || 'Недоступно') : it.label;
      btn.addEventListener('pointerenter', () => { look(p.dx, p.dy); ctx.audio.sfx('hover'); });
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (it.disabled) { ctx.audio.sfx('error'); btn.classList.remove('shake'); void btn.offsetWidth; btn.classList.add('shake'); return; }
        api.sim.enqueue(state, bus, sim.id, target, it.key);
        ctx.audio.sfx('enqueue');
        close(false);
      });
      return btn;
    };

    // подменю: одно открытое за раз; сворачивается, когда курсор ушёл с группы и её дуги
    let sub = null, subTimer = 0;
    const closeSub = () => {
      if (!sub) return;
      sub.btns.forEach(b => b.remove()); sub.head.classList.remove('on');
      el?.classList.remove('dimmed'); sub = null;
    };
    const keepSub = () => clearTimeout(subTimer);
    const leaveSub = () => { clearTimeout(subTimer); subTimer = setTimeout(closeSub, SUB_CLOSE_MS); };
    const openSub = (g, p, head) => {
      keepSub();
      if (sub?.head === head) return;
      closeSub();
      const pts = fitSub(layoutSub(g.kids.length, p, head.offsetWidth), L.x, L.y, innerWidth, innerHeight);
      const btns = g.kids.map((k, i) => {
        const b = makeItem(k, pts[i], i, '.sub');
        b.style.setProperty('--fx', `${p.dx.toFixed(1)}px`); b.style.setProperty('--fy', `${p.dy.toFixed(1)}px`);
        b.addEventListener('pointerenter', keepSub); b.addEventListener('pointerleave', leaveSub);
        el.append(b);
        return b;
      });
      sub = { head, btns };
      head.classList.add('on'); el.classList.add('dimmed');
      requestAnimationFrame(() => btns.forEach(b => b.classList.add('in')));
      ctx.audio.sfx('open');
    };

    top.forEach((t, i) => {
      const p = L.pts[i];
      if (!t.group) { const b = makeItem(t.item, p, i); b.addEventListener('pointerenter', () => sub && leaveSub()); el.append(b); return; }
      const allDis = t.kids.every(k => k.disabled);
      const head = h('button.item.grp.' + p.side + (allDis ? '.dis' : ''), {
        style: { '--dx': `${p.dx.toFixed(1)}px`, '--dy': `${p.dy.toFixed(1)}px`, transitionDelay: `${i * 18}ms` },
        'data-group': t.label,
        html: `<span class="ii">${iconHtml(t.kids[0].icon, 16)}</span><span class="il">${esc(t.label)}</span><span class="more">›</span>`,
      });
      head.addEventListener('pointerenter', () => { look(p.dx, p.dy); openSub(t, p, head); });
      head.addEventListener('pointerleave', leaveSub);
      head.addEventListener('click', e => { e.stopPropagation(); sub?.head === head ? closeSub() : openSub(t, p, head); });
      el.append(head);
    });
    ctx.root.append(el);
    openAt = performance.now();
    // пункты разлетаются из центра на следующем кадре
    requestAnimationFrame(() => el && el.classList.add('open'));
    ctx.audio.sfx('open');
  }

  return {
    open, close,
    get isOpen() { return !!el; },
    get openedAt() { return openAt; },
    contains: node => !!el && el.contains(node),
  };
}
