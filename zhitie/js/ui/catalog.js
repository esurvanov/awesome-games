// Каталог Покупки на 300+ предметов: по назначению / по комнатам, подкатегории (виды), поиск,
// коллекции, «новинки», сортировка по цене, варианты цвета точками на карточке.
// Сетка постраничная: в DOM только карточки текущей страницы — быстро при любом размере каталога.
import { h, esc, toggle, money, setText } from './dom.js';
import { ico, IC, OBJ_EMOJI, CAT_UI, MOTIVE_UI } from './icons.js';
import { CATALOG, byId, kindOf } from '../../data/catalog.js';
import { COLLECTIONS } from '../../data/catalog-extra.js';

const CAT_COLOR = { seating: '#7aa7e0', surfaces: '#c9a26b', decor: '#d88fb5', electronics: '#8e8cd8', appliances: '#8fc7c2', plumbing: '#79c0e8', lighting: '#f0cf6a', misc: '#a9b6c8' };
const ROOM_UI = { kitchen: ['🍳', 'Кухня'], bathroom: ['🚿', 'Ванная'], bedroom: ['🛏️', 'Спальня'], living: ['🛋️', 'Гостиная'], study: ['💻', 'Кабинет'], outside: ['🌳', 'Улица'], kids: ['🧸', 'Детская'], any: ['✳️', 'Любая'] };
const CARD_W = 99; // ширина карточки + зазор, px — для размера страницы
const MAX_DOTS = 6;

// Базовая запись и её варианты цвета (variantOf → базовый id)
export function groupVariants(list) {
  const groups = new Map();
  for (const d of list) {
    const base = d.variantOf && byId[d.variantOf] ? d.variantOf : d.id;
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(d);
  }
  return groups;
}
// «Новинки» и коллекции — от агента Каталог (isNew, одна collection у предмета; имена — COLLECTIONS)
export const isNew = d => !!d.isNew;
export const COLL_UI = Object.fromEntries(Object.entries(COLLECTIONS || {}).map(([k, v]) => [k, `${v.icon || ''} ${v.name || k}`.trim()]));
export const collectionOf = d => d.collection || null;
const colorOf = d => d.tint || d.color || null;
export const matches = (d, q) => !q || `${d.name} ${d.desc || ''} ${(d.tags || []).join(' ')} ${kindOf(d.id)}`.toLowerCase().includes(q);

export function createCatalogView(ctx, { onChoose, onInfo }) {
  const items = CATALOG.filter(d => d.cat !== 'build' && d.buyable !== false);
  const groups = groupVariants(items);             // base → [варианты]
  const pickedVar = new Map();                     // base → выбранный вариант
  let by = 'func', cat = 'all', sub = null, q = '', sort = 0 /* 0 — как в каталоге, 1 — дешевле, 2 — дороже */, coll = null, page = 0, selId = null;

  const funcCats = ['all', 'new', ...new Set(items.map(d => d.cat))];
  const roomCats = ['all', 'new', ...new Set(items.map(d => d.room || 'any'))];
  const colls = [...new Set(items.map(collectionOf).filter(Boolean))];

  const byBtn = h('button.zh-btn.ct-by', { title: 'По назначению / по комнатам', onclick: () => { by = by === 'func' ? 'room' : 'func'; cat = 'all'; sub = null; page = 0; drawTabs(); draw(); } });
  const tabs = h('div.zh-cats');
  const info = h('div.zh-info');
  const search = h('input.ct-search', { type: 'search', placeholder: '🔍 поиск', 'aria-label': 'Поиск по каталогу' });
  const subs = h('div.ct-subs');
  const sortBtn = h('button.zh-btn.ct-sm', { title: 'Сортировка по цене', onclick: () => { sort = (sort + 1) % 3; page = 0; draw(); } });
  const collBtn = h('button.zh-btn.ct-sm', { title: 'Коллекции', text: '📚', hidden: !colls.length, onclick: () => { coll = coll == null ? colls[0] : null; sub = null; page = 0; draw(); } });
  const grid = h('div.zh-cards.paged');
  const prev = h('button.zh-btn.ct-pg', { text: '‹', title: 'Назад', onclick: () => { page--; draw(); } });
  const next = h('button.zh-btn.ct-pg', { text: '›', title: 'Дальше', onclick: () => { page++; draw(); } });
  const pageN = h('span.ct-pn');
  const el = h('div.zh-catalog', { 'data-ui': 'catalog', hidden: true },
    h('div.zh-cathead', {}, byBtn, tabs, info),
    h('div.ct-row2', {}, search, subs, collBtn, sortBtn),
    h('div.ct-gridrow', {}, prev, grid, h('div.ct-pgbox', {}, next, pageN)));
  search.addEventListener('input', () => { q = search.value.trim().toLowerCase(); page = 0; draw(); });
  search.addEventListener('keydown', e => { if (e.key === 'Escape') { search.value = ''; q = ''; draw(); search.blur(); } e.stopPropagation(); });
  grid.addEventListener('wheel', e => { e.preventDefault(); e.stopPropagation(); page += e.deltaY + e.deltaX > 0 ? 1 : -1; draw(); }, { passive: false });

  function drawTabs() {
    byBtn.innerHTML = by === 'func' ? ico('all', 16) : '🚪';
    byBtn.title = by === 'func' ? 'По назначению (клик — по комнатам)' : 'По комнатам (клик — по назначению)';
    tabs.innerHTML = '';
    for (const c of by === 'func' ? funcCats : roomCats) {
      const label = c === 'new' ? 'Новинки' : by === 'func' ? CAT_UI[c] || c : ROOM_UI[c]?.[1] || c;
      const html = c === 'new' ? '✨' : c === 'all' ? ico('all', 18) : by === 'func' ? ico(IC[c] ? c : 'misc', 18) : ROOM_UI[c]?.[0] || '▫️';
      const b = h('button.zh-btn.tab', { title: label, 'data-cat': c, html, onclick: () => { cat = c; sub = null; coll = null; page = 0; drawTabs(); draw(); ctx.audio.sfx('tab'); } });
      toggle(b, 'on', c === cat);
      tabs.append(b);
    }
  }

  // фильтр → список базовых групп (у группы — выбранный или подходящий вариант)
  function filtered() {
    const out = [];
    for (const [base, vars] of groups) {
      const hit = vars.filter(d =>
        (cat === 'all' || (cat === 'new' ? isNew(d) : by === 'func' ? d.cat === cat : (d.room || 'any') === cat)) &&
        (!sub || kindOf(d.id) === sub) && (!coll || collectionOf(d) === coll) && matches(d, q));
      if (!hit.length) continue;
      const want = pickedVar.get(base);
      out.push({ base, vars, show: hit.find(d => d.id === want) || hit[0] });
    }
    if (sort) out.sort((a, b) => (a.show.price - b.show.price) * (sort === 1 ? 1 : -1));
    return out;
  }

  function drawSubs(list) {
    subs.innerHTML = '';
    if (coll != null) {
      for (const c of colls) { const b = h('button.ct-chip', { text: COLL_UI[c] || c, 'data-coll': c, onclick: () => { coll = c; page = 0; draw(); } }); toggle(b, 'on', c === coll); subs.append(b); }
      return;
    }
    if (cat === 'all' && !q) return;
    const kinds = [...new Set(list.map(g => kindOf(g.show.id)))];
    if (kinds.length < 2 && !sub) return;
    const all = h('button.ct-chip', { text: 'все', onclick: () => { sub = null; page = 0; draw(); } });
    toggle(all, 'on', !sub); subs.append(all);
    for (const k of kinds) {
      // у новых видов нет базового предмета — берём имя первого предмета этого вида
      const nm = byId[k]?.name || list.find(g => kindOf(g.show.id) === k)?.show.name || k;
      const b = h('button.ct-chip', { title: nm, 'data-kind': k, html: `${OBJ_EMOJI[k] || '▫️'} ${esc(nm.split(/[ «·-]/)[0])}`, onclick: () => { sub = k; page = 0; draw(); } });
      toggle(b, 'on', k === sub); subs.append(b);
    }
  }

  const perPage = () => Math.max(3, Math.floor((grid.clientWidth || 520) / CARD_W));
  function card(g) {
    const d = g.show;
    const rat = Object.entries(d.ratings || {}).sort((a, b) => b[1] - a[1]).slice(0, 2)
      .map(([k, v]) => `<span class="rt" title="${esc(MOTIVE_UI[k]?.[0] || k)} ${v}">${ico(MOTIVE_UI[k]?.[1] || 'trait', 11)}<span class="pips">${'<i></i>'.repeat(Math.min(10, v))}</span></span>`).join('');
    const dots = g.vars.length > 1 ? `<span class="vdots">${g.vars.slice(0, MAX_DOTS).map(v => `<i data-var="${esc(v.id)}" class="${v.id === d.id ? 'on' : ''}" style="background:${colorOf(v) || '#bbb'}" title="${esc(v.name)}"></i>`).join('')}${g.vars.length > MAX_DOTS ? `<b>+${g.vars.length - MAX_DOTS}</b>` : ''}</span>` : '';
    const c = h('button.zh-card', {
      'data-def': d.id, 'data-base': g.base, title: d.desc ? `${d.name} — ${d.desc}` : d.name,
      style: { '--sw': colorOf(d) || CAT_COLOR[d.cat] || '#9ab' },
      html: `<span class="sw">${OBJ_EMOJI[d.id] || OBJ_EMOJI[kindOf(d.id)] || '📦'}${isNew(d) ? '<span class="nw">✨</span>' : ''}</span><span class="nm">${esc(d.name)}</span><span class="pr">${money(d.price)}</span><span class="rats">${rat}</span>${dots}`,
    });
    c.addEventListener('click', e => {
      const v = e.target.closest('[data-var]')?.dataset.var;
      if (v) { pickedVar.set(g.base, v); onChoose(v); draw(); return; }  // точка варианта — сразу выбрать его
      onChoose(d.id);
    });
    c.addEventListener('pointerenter', () => onInfo(d));
    c.addEventListener('pointerleave', () => onInfo(selId && byId[selId]));
    toggle(c, 'on', g.vars.some(v => v.id === selId));
    return c;
  }

  function draw() {
    const list = filtered();
    drawSubs(list);
    const pp = perPage(), pages = Math.max(1, Math.ceil(list.length / pp));
    page = Math.max(0, Math.min(page, pages - 1));
    grid.replaceChildren(...list.slice(page * pp, page * pp + pp).map(card));
    if (!list.length) grid.append(h('div.ct-empty', { text: '🔍 ничего' }));
    prev.disabled = page === 0; next.disabled = page >= pages - 1;
    setText(pageN, `${page + 1}/${pages}`);
    sortBtn.textContent = ['§', '§↑', '§↓'][sort];
    toggle(sortBtn, 'on', !!sort); toggle(collBtn, 'on', coll != null);
  }
  drawTabs();
  addEventListener('resize', () => { if (!el.hidden) draw(); });

  return {
    el, info,
    show() { el.hidden = false; requestAnimationFrame(draw); },
    hide() { el.hidden = true; },
    setSelected(id) { selId = id; if (!el.hidden) for (const c of grid.children) if (c.dataset?.base) toggle(c, 'on', groups.get(c.dataset.base)?.some(v => v.id === id)); },
    search(text) { search.value = text; q = text.trim().toLowerCase(); page = 0; draw(); },
    get count() { return items.length; },
    get pageInfo() { return pageN.textContent; },
  };
}
