// Режим «Покупка»: каталог внизу (вкладки категорий, карточки), призрак за мышью,
// поворот , . — клик ставит, Shift — ставить ещё, клик по предмету — взять и перенести, Delete — продать.
import { h, esc, toggle, money } from './dom.js';
import { ico, IC, OBJ_EMOJI, CAT_UI, MOTIVE_UI } from './icons.js';
import { byId } from '../../data/catalog.js';
import { createCatalogView } from './catalog.js';

// Цвет плашки карточки по категории

// Пик по ребру стены → x, y, rot для настенных (двери, окна, картины, зеркала).
// Мир: (x,y,rot) висит на ребре ЗА спиной клетки (x,y) и смотрит в неё:
// r0 → wallH(x,y), r1 → wallV(x,y), r2 → wallH(x,y+1), r3 → wallV(x+1,y).
// Сторону выбираем по положению курсора (wx/wz от Рендера), `,`/`.` — переворот.
export function wallSpot(p, flip = 0) {
  const e = p?.edge;
  if (!e) return null;
  const cx = p.wx ?? p.x + 0.5, cy = p.wz ?? p.wy ?? p.y + 0.5;
  if (e.dir === 'h') {
    const south = (cy >= e.y) !== !!(flip & 1); // курсор южнее ребра → предмет в клетке (x, y) лицом на +y
    return south ? { x: e.x, y: e.y, rot: 0 } : { x: e.x, y: e.y - 1, rot: 2 };
  }
  const east = (cx >= e.x) !== !!(flip & 1);
  return east ? { x: e.x, y: e.y, rot: 1 } : { x: e.x - 1, y: e.y, rot: 3 };
}

export function spotFor(def, p, rot) {
  if (!p) return null;
  if (def.place === 'wall') return wallSpot(p, rot);
  if (p.kind === 'wall' && !p.edge) return null;
  return { x: Math.floor(p.x), y: Math.floor(p.y), rot };
}

export function createBuy(ctx) {
  const { state, bus, api } = ctx;
  let sel = null, hover = null, lastPick = null;

  // — каталог (постраничный, поиск, варианты цвета) —
  const view = createCatalogView(ctx, { onChoose: id => choose(id, true), onInfo: d => showInfo(d) });
  const el = view.el, info = view.info;
  ctx.panelMain.append(el);
  function showInfo(d) {
    if (!d) { info.innerHTML = `<span class="hint">${ico('hand', 14)} взять · <kbd>,</kbd><kbd>.</kbd> ${ico('rotate', 14)} · <kbd>Del</kbd> продать</span>`; return; }
    const r = Object.entries(d.ratings || {}).map(([k, v]) => `<span class="ir">${ico(MOTIVE_UI[k]?.[1] || 'trait', 13)}${v}</span>`).join('');
    info.innerHTML = `<b>${esc(d.name)}</b><span class="ip">${money(d.price)}</span>${r}`;
  }
  showInfo(null);

  // keep — выбор варианта той же группы не снимает выбор
  function choose(defId, keep = false) {
    cancelMove();
    if (sel?.defId === defId && !keep) { clearSel(); return; }
    sel = { defId, rot: sel?.rot ?? 0 };
    view.setSelected(defId);
    showInfo(byId[defId]);
    ctx.audio.sfx('click');
    refresh();
  }
  function clearSel() {
    sel = null;
    view.setSelected(null);
    api.render.setGhost(null);
    api.render.setHidden?.(null); // перенос окончен — оригинал снова виден
    ctx.tip(null);
    showInfo(null);
  }
  // Перенос: предмет стоит на месте, пока не поставлен — отмена просто снимает выбор
  function cancelMove() { if (sel?.moving) clearSel(); }

  function evaluate(p) {
    if (!sel) return null;
    const def = byId[sel.defId];
    const spot = spotFor(def, p, sel.rot);
    const level = ctx.level;
    if (!spot) return { ok: false, reason: def.place === 'wall' ? 'Нужна стена' : 'Сюда нельзя' };
    // перенос: сам предмет не мешает и денег не стоит
    const opts = sel.moving ? { free: true, ignoreId: sel.moving.id } : undefined;
    const res = api.world.canPlace(state, sel.defId, spot.x, spot.y, spot.rot, level, opts) || { ok: false };
    const cost = sel.moving ? 0 : def.price;
    if (res.ok && cost > state.household.money) return { ...spot, level, ok: false, reason: 'Не хватает денег' };
    return { ...spot, level, ok: !!res.ok, reason: res.reason };
  }

  function refresh() {
    const p = lastPick;
    if (!sel) { api.render.setGhost(null); return; }
    const ev = evaluate(p);
    hover = ev;
    if (!ev || ev.x == null) { api.render.setGhost(null); ctx.tip(ev?.reason || null, 'bad'); return; }
    api.render.setGhost({ defId: sel.defId, x: ev.x, y: ev.y, rot: ev.rot, level: ev.level, ok: ev.ok, movingId: sel.moving?.id });
    const price = sel.moving ? '' : money(byId[sel.defId].price);
    ctx.tip(ev.ok ? price || '✓' : (ev.reason || 'Сюда нельзя'), ev.ok ? '' : 'bad');
  }

  return {
    el,
    enter() { view.show(); showInfo(null); },
    exit() { cancelMove(); clearSel(); api.render.setHover?.(null); view.hide(); },
    hover(p) {
      lastPick = p;
      // подсветка предмета, который возьмёт клик (при выбранной карточке — нет)
      api.render.setHover?.(!sel && p?.kind === 'object' ? p.id : null);
      if (sel) refresh(); else ctx.tip(p?.kind === 'object' ? `${ico('hand', 12)} взять` : null, '', true); },
    click(p, e) {
      lastPick = p;
      if (sel) {
        const ev = evaluate(p);
        if (!ev?.ok) { ctx.audio.sfx('error'); return; }
        if (sel.moving) {
          const r = api.world.moveObject(state, bus, sel.moving.id, ev.x, ev.y, ev.rot, ev.level);
          if (!r?.ok) { ctx.audio.sfx('error'); ctx.tip(r?.reason || 'Сюда нельзя', 'bad'); return; }
          ctx.audio.sfx('place'); clearSel(); return;
        }
        const id = api.world.placeObject(state, bus, sel.defId, ev.x, ev.y, ev.rot, ev.level);
        if (id == null) { ctx.audio.sfx('error'); return; }
        ctx.audio.sfx('kaching');
        if (!e.shiftKey) clearSel(); else refresh();
        return;
      }
      // взять существующий предмет
      if (p?.kind === 'object') {
        const o = state.objects.find(x => x.id === p.id);
        if (!o || !byId[o.def] || byId[o.def].cat === 'build') return;
        sel = { defId: o.def, rot: o.rot || 0, moving: { id: o.id } };
        api.render.setHover?.(null);
        api.render.setHidden?.(o.id);
        showInfo(byId[o.def]);
        ctx.audio.sfx('pickup');
        refresh();
      }
    },
    rotate(d) { if (!sel) return; sel.rot = (sel.rot + d + 4) % 4; ctx.audio.sfx('rotate'); refresh(); },
    // Delete: продать взятый предмет или предмет под курсором
    del() {
      if (sel?.moving) { api.world.removeObject(state, bus, sel.moving.id); clearSel(); ctx.audio.sfx('kaching'); return true; }
      if (lastPick?.kind === 'object') {
        const o = state.objects.find(x => x.id === lastPick.id);
        if (o && byId[o.def]?.cat !== 'build') { api.world.removeObject(state, bus, o.id); ctx.audio.sfx('kaching'); return true; }
      }
      return false;
    },
    escape() { if (sel?.moving) { cancelMove(); return true; } if (sel) { clearSel(); return true; } return false; },
    get selected() { return sel; },
    choose, view,
  };
}
