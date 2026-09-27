// Район (CONTRACT §9): экран-карта участков, карточка семьи → «Играть», «Заселить», книга семей,
// поездки на общественные участки и «Домой». Данные — state.hood (Мир), переходы — world.loadLot/moveIn.
import { h, esc, money, toggle, setText } from './dom.js';
import { ico } from './icons.js';
import { portraitSvg } from './portrait.js';
import { tipOfDay, textsReady } from './texts.js';

export const LOT_ICON = { park: '🌳', cafe: '☕', shop: '🛒', gym: '🏋️', library: '📚', museum: '🏛️', res: '🏠' };
export const LOT_TYPE = { park: 'Парк', cafe: 'Кафе', shop: 'Магазин', gym: 'Спортзал', library: 'Библиотека', museum: 'Музей' };
const short = (s, n = 110) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

// Раскладка участков на карте: координаты района → проценты экрана карты (с полями)
export function mapLayout(lots) {
  if (!lots.length) return [];
  const x0 = Math.min(...lots.map(l => l.x)), y0 = Math.min(...lots.map(l => l.y));
  const x1 = Math.max(...lots.map(l => l.x + (l.w || 1))), y1 = Math.max(...lots.map(l => l.y + (l.h || 1)));
  const W = x1 - x0 || 1, H = y1 - y0 || 1;
  return lots.map(l => ({ lot: l, left: 6 + ((l.x - x0) / W) * 88, top: 8 + ((l.y - y0) / H) * 80, w: Math.max(7, ((l.w || 1) / W) * 88), hh: Math.max(8, ((l.h || 1) / H) * 80) }));
}

export function createHood(ctx) {
  const { state, bus, api } = ctx;
  const hood = () => state.hood;
  let sel = null, resume = null;

  // — экран района —
  const map = h('div.hd-map');
  const card = h('div.hd-card', { hidden: true });
  const tip = h('div.hd-tip');
  const title = h('b.hd-name');
  // 3D-район Рендера под нами: свой слой — только рамки выбранного/наведённого участка
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'hd-outl');
  const polySel = document.createElementNS(NS, 'polygon'), polyHov = document.createElementNS(NS, 'polygon');
  polySel.setAttribute('class', 'sel'); polyHov.setAttribute('class', 'hov'); svg.append(polyHov, polySel);
  const listBtn = h('button.zh-btn.hd-act', { 'data-act': 'list', title: 'Список участков', html: '☰<span>Список</span>', onclick: () => { toggle(el, 'list', !el.classList.contains('list')); ctx.audio.sfx('click'); } });
  let is3D = false, hovId = null, hoverT = 0;
  const el = h('div.zh-hood', { 'data-ui': 'hood', hidden: true },
    svg,
    h('div.hd-top', {}, h('span.hd-ic', { text: '🗺️' }), title, tip, listBtn,
      h('button.zh-btn.hd-act', { 'data-act': 'book', html: `📖<span>Книга</span>`, title: 'Семейная книга', onclick: () => openBook() }),
      h('button.zh-btn.hd-act', { 'data-act': 'cas', html: `➕<span>Семья</span>`, title: 'Создать семью', onclick: () => ctx.openCas?.() }),
      h('button.zh-btn.hd-act.close', { 'data-act': 'back', html: ico('close', 16), title: 'Вернуться в игру', onclick: () => close() })),
    map, card);
  ctx.root.append(el);

  // — книга семей —
  const bookBody = h('div.bk-grid');
  let bookTab = 'fam';
  const bookTabs = {};
  const book = h('div.zh-modal', { 'data-ui': 'book', hidden: true },
    h('div.md-card.wide', {},
      h('div.md-head', {}, h('span', { text: '📖' }), h('b', { text: 'Семейная книга' }),
        ...[['fam', '👪 Семьи'], ['town', '🙋 Горожане']].map(([k, t]) => (bookTabs[k] = h('button.zh-btn.md-tab', { text: t, onclick: () => { bookTab = k; fillBook(); } }))),
        h('button.zh-btn.md-x', { html: ico('close', 14), onclick: () => { book.hidden = true; } })),
      bookBody));
  ctx.root.append(book);

  // — выбор семьи для заселения —
  const pickBody = h('div.bk-grid');
  const pickFam = h('div.zh-modal', { 'data-ui': 'movein', hidden: true },
    h('div.md-card', {}, h('div.md-head', {}, h('span', { text: '🚚' }), h('b', { text: 'Кто заселяется?' }), h('button.zh-btn.md-x', { html: ico('close', 14), onclick: () => { pickFam.hidden = true; } })), pickBody));
  ctx.root.append(pickFam);

  const famOf = id => hood()?.families?.find(f => f.id === id);
  const lotOf = id => hood()?.lots?.find(l => l.id === id);
  const faces = (members, n = 4, size = 26) => members.slice(0, n).map(m => `<span class="hd-face">${portraitSvg({ ...m, id: m.id ?? m.name }, size)}</span>`).join('') + (members.length > n ? `<span class="hd-more">+${members.length - n}</span>` : '');

  function render() {
    const H = hood();
    setText(title, H?.name || 'Район');
    textsReady.then(() => setText(tip, '💡 ' + tipOfDay(H?.day ?? Math.floor(state.time.minutes / 1440))));
    map.innerHTML = '';
    for (const L of mapLayout(H?.lots || [])) {
      const l = L.lot, fam = l.familyId != null ? famOf(l.familyId) : null;
      const kind = l.kind === 'community' ? l.type : 'res';
      const b = h('button.hd-lot.' + (l.kind === 'community' ? 'com' : fam ? 'fam' : 'free'), {
        'data-lot': l.id, title: l.name || '',
        style: { left: `${L.left}%`, top: `${L.top}%`, width: `${L.w}%`, height: `${L.hh}%` },
        html: `<span class="lt-ic">${LOT_ICON[kind] || '🏠'}</span>
          ${fam ? `<span class="lt-faces">${faces(fam.members || [], 3, 22)}</span><span class="lt-name">${esc(fam.name)}</span>`
            : l.kind === 'community' ? `<span class="lt-name">${esc(l.name || LOT_TYPE[l.type] || '')}</span>`
            : `<span class="lt-name">${money(l.price || 0)}</span>`}
          ${l.id === H.activeLotId ? '<span class="lt-here">📍</span>' : ''}`,
        onclick: () => select(l.id),
      });
      toggle(b, 'on', l.id === sel);
      map.append(b);
    }
    renderCard();
  }

  function select(lotId) { sel = lotId; ctx.audio.sfx('click'); api.render.setHoodSelect?.(lotId); render(); }

  // — 3D: клик/наведение по участку через пик Рендера ({kind:'lot', lotId}) —
  const pickLot = (x, y) => { try { const p = api.render.pick(x, y); return p?.kind === 'lot' ? p.lotId : null; } catch { return null; } };
  function clickAt(x, y) { const id = pickLot(x, y); if (id != null) select(id); else if (sel != null) { sel = null; render(); } }
  // всплывашка у курсора: значок, название/семья, портреты
  function hoverAt(x, y, dt) {
    hoverT -= dt; if (hoverT > 0) return; hoverT = 0.1;
    const id = pickLot(x, y);
    if (id === hovId) return;
    hovId = id; api.render.setHoodHover?.(id);
    const l = id != null ? lotOf(id) : null;
    if (!l) { ctx.tip(null); return; }
    const fam = l.familyId != null ? famOf(l.familyId) : null;
    const ic = LOT_ICON[l.kind === 'community' ? l.type : 'res'] || '🏠';
    ctx.tip(fam ? `${ic} <b>${esc(fam.name)}</b> <span class="tp-faces">${faces(fam.members || [], 5, 22)}</span>`
      : l.kind === 'community' ? `${ic} ${esc(l.name || LOT_TYPE[l.type] || '')}` : `${ic} ${esc(l.name || '')} · ${money(l.price || 0)}`, 'hood', true);
  }
  // рамка участка на экране: 4 угла прямоугольника через screenPos
  function outline(poly, id) {
    const l = id != null ? lotOf(id) : null;
    if (!l || !api.render.screenPos) { poly.setAttribute('points', ''); return; }
    const pts = [[l.x, l.y], [l.x + l.w, l.y], [l.x + l.w, l.y + l.h], [l.x, l.y + l.h]].map(([a, b]) => api.render.screenPos(a, 0.1, b));
    poly.setAttribute('points', pts.map(p => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(' '));
  }

  function renderCard() {
    const l = sel != null ? lotOf(sel) : null;
    card.hidden = !l;
    if (!l) return;
    const fam = l.familyId != null ? famOf(l.familyId) : null;
    if (l.kind === 'community') {
      card.innerHTML = `<div class="hc-head"><span class="hc-ic">${LOT_ICON[l.type] || '🏙️'}</span><b>${esc(l.name || LOT_TYPE[l.type] || '')}</b></div>
        <div class="hc-row">🚗 поездка из игры — меню «Поехать»</div>`;
      return;
    }
    if (!fam) {
      card.innerHTML = `<div class="hc-head"><span class="hc-ic">🏠</span><b>${esc(l.name || 'Свободный участок')}</b></div>
        <div class="hc-row big">${money(l.price || 0)}</div>`;
      const free = (hood()?.families || []).filter(f => f.lotId == null);
      card.append(h('button.zh-btn.hc-play', { 'data-act': 'movein', html: `🚚 Заселить`, disabled: !free.length, onclick: () => openMoveIn(l.id) }));
      return;
    }
    const m = fam.members || [];
    card.innerHTML = `<div class="hc-head"><span class="hc-ic">🏠</span><b>${esc(fam.name)}</b></div>
      <div class="hc-mem">${m.map(x => `<span class="hc-m" title="${esc(x.name)}">${portraitSvg({ ...x, id: x.id ?? x.name }, 40)}<i>${esc(x.name)}</i></span>`).join('')}</div>
      <div class="hc-row"><span class="hc-money">${money(fam.funds ?? 0)}</span><span>👥 ${m.length}</span></div>
      ${fam.bio ? `<div class="hc-bio">${esc(short(fam.bio))}</div>` : ''}`;
    card.append(h('div.hc-btns', {},
      h('button.zh-btn.hc-play', { 'data-act': 'play', html: `▶ Играть`, onclick: () => play(fam) }),
      api.world.evict ? h('button.zh-btn.hc-evict', { 'data-act': 'evict', title: 'Выселить: дом продаётся, семья — в книгу', html: '🚚', onclick: () => evict(fam) }) : null));
  }

  // — переходы —
  // переход на участок; bring — id жителей, которые едут с игроком (поездка), Мир сам снимет снимок текущего
  function goLot(lotId, bring = [], after = true) {
    if (hood()?.activeLotId !== lotId) api.world.loadLot?.(state, bus, lotId, { bring });
    if (after) ctx.afterLotChange?.();
  }
  function play(fam) {
    ctx.audio.sfx('select');
    goLot(fam.lotId, [], false);
    close(true);
  }
  function evict(fam) {
    if (!api.world.evict(state, bus, fam.id)) { ctx.audio.sfx('error'); return; }
    ctx.audio.sfx('kaching'); render();
  }
  function openMoveIn(lotId) {
    pickBody.innerHTML = '';
    const price = lotOf(lotId)?.price || 0;
    for (const f of (hood()?.families || []).filter(x => x.lotId == null)) {
      const poor = (f.funds ?? 0) < price; // не хватает — карточка серая, клик покажет причину Мира
      pickBody.append(h('button.bk-card' + (poor ? '.poor' : ''), { 'data-fam': f.id, title: poor ? `Нужно ${money(price)}` : '', onclick: () => {
        pickFam.hidden = true;
        const ok = api.world.moveIn ? api.world.moveIn(state, bus, f.id, lotId) : null;
        if (ok === false || ok?.ok === false) { ctx.audio.sfx('error'); ctx.toast(ok?.reason || 'Не получилось заселиться', '🚚'); return; }
        ctx.audio.sfx('kaching');
        // Мир делает новый дом активным — сразу играем за переехавших
        if (hood()?.activeLotId === lotId) close(true); else { sel = lotId; render(); }
      } }, h('span.bk-faces', { html: faces(f.members || [], 4, 30) }), h('b', { text: f.name }), h('span.bk-sub', { text: `${money(f.funds ?? 0)} · 👥 ${(f.members || []).length}` })));
    }
    pickFam.hidden = false;
  }

  function fillBook() {
    for (const [k, b] of Object.entries(bookTabs)) toggle(b, 'on', k === bookTab);
    bookBody.innerHTML = '';
    const H = hood();
    if (bookTab === 'fam') {
      for (const f of H?.families || []) {
        const l = f.lotId != null ? lotOf(f.lotId) : null;
        bookBody.append(h('div.bk-card', {}, h('span.bk-faces', { html: faces(f.members || [], 5, 30) }), h('b', { text: f.name }),
          h('span.bk-sub', { text: `${l ? '🏠 ' + (l.name || '') : '🧳 без дома'} · ${money(f.funds ?? 0)}` }),
          f.bio ? h('span.bk-bio', { text: short(f.bio, 90) }) : null));
      }
    } else {
      for (const t of H?.townies || []) {
        bookBody.append(h('div.bk-card.tw', {}, h('span.bk-faces', { html: portraitSvg({ ...t, id: t.id ?? t.name }, 34) }), h('b', { text: t.name }),
          t.bio ? h('span.bk-bio', { text: short(t.bio, 70) }) : null));
      }
    }
    if (!bookBody.children.length) bookBody.append(h('div.bk-empty', { text: '— пусто —' }));
  }
  function openBook() { book.hidden = false; fillBook(); ctx.audio.sfx('open'); }

  function open() {
    if (!hood()) return false;
    if (resume == null) { resume = state.time.speed; ctx.setSpeed(0, true); }
    ctx.closePie?.();
    sel = hood().activeLotId ?? null;
    // 3D-город Рендера; если его нет (стенд) — 2D-список на весь экран
    is3D = !!api.render.showHood && api.render.showHood(state) !== false;
    toggle(el, 'd3', is3D); toggle(el, 'list', !is3D); listBtn.hidden = !is3D;
    hovId = null;
    ctx.root.classList.add('in-hood'); // панель жизни и очередь прячем — на карте они не нужны
    el.hidden = false; render();
    ctx.audio.sfx('mode');
    return true;
  }
  function close(played = false) {
    if (el.hidden) return;
    el.hidden = true; book.hidden = true; pickFam.hidden = true;
    ctx.tip(null); hovId = null; api.render.setHoodHover?.(null);
    ctx.root.classList.remove('in-hood');
    if (api.render.showLot) api.render.showLot(); else api.render.showHood?.(false);
    // камера и выбор — после возврата вида участка (showLot восстанавливает старую камеру)
    if (played) ctx.afterLotChange?.();
    if (resume != null) { const s = resume || 1; resume = null; ctx.setSpeed(played ? Math.max(1, s) : s, true); }
  }

  // — поездки: 🚗 меню общественных участков + «Домой» —
  const travel = h('div.zh-travel', { 'data-ui': 'travel', hidden: true });
  ctx.root.append(travel);
  // дом играющей семьи: household.familyId (Мир), иначе — семья, чьи жители сейчас с нами
  function homeLotId() {
    const H = hood(), fid = state.household?.familyId;
    const f = (fid != null && H?.families?.find(x => x.id === fid)) || H?.families?.find(x => x.lotId != null && x.members?.some(m => ctx.household().some(s => s.name === m.name)));
    return f?.lotId ?? H?.homeLotId ?? null;
  }
  function toggleTravel(anchor) {
    if (!travel.hidden) { travel.hidden = true; return; }
    const H = hood(); if (!H) return;
    const here = lotOf(H.activeLotId);
    travel.innerHTML = '';
    if (here?.kind === 'community') travel.append(h('button.zh-btn.tr-item.home', { 'data-lot': 'home', html: '🏠 <span>Домой</span>', onclick: () => go(null) }));
    for (const l of (H.lots || []).filter(x => x.kind === 'community' && x.id !== H.activeLotId)) {
      travel.append(h('button.zh-btn.tr-item', { 'data-lot': l.id, html: `${LOT_ICON[l.type] || '🏙️'} <span>${esc(l.name || LOT_TYPE[l.type] || '')}</span>`, onclick: () => go(l.id) }));
    }
    const r = anchor?.getBoundingClientRect();
    if (r) { travel.style.right = `${Math.max(8, innerWidth - r.right)}px`; travel.style.bottom = `${innerHeight - r.top + 8}px`; }
    travel.hidden = false;
  }
  // поездка: у Мозга своя механика (семья уезжает на машине), иначе — прямой переход участка
  function go(lotId) {
    travel.hidden = true;
    const bring = ctx.household().map(s => s.id);
    if (lotId == null) {
      if (api.sim.goHome) api.sim.goHome(state, bus); else { const home = homeLotId(); if (home != null) goLot(home, bring); }
    } else if (api.sim.travel) api.sim.travel(state, bus, lotId);
    else goLot(lotId, bring);
    ctx.audio.sfx('mode');
  }

  return {
    open, close, openBook, select, go, toggleTravel, clickAt, hoverAt,
    // каждый кадр, пока открыт: рамки участков следуют за камерой
    update() { if (el.hidden || !is3D) return; outline(polySel, sel); outline(polyHov, hovId !== sel ? hovId : null); },
    get is3D() { return is3D; },
    get isOpen() { return !el.hidden; },
    get activeLot() { return lotOf(hood()?.activeLotId); },
    hideTravel() { travel.hidden = true; },
    travelEl: travel,
  };
}
