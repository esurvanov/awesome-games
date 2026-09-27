// Режим «Стройка»: стены (тяни линию; Shift — комната; Ctrl — снос), пол (тяни прямоугольник),
// двери и окна в ребро стены. Превью — через render.setWallGhost / setFloorGhost / setGhost, цена у курсора.
import { h, esc, toggle, money } from './dom.js';
import { ico } from './icons.js';
import { WALLS, FLOORS, byId } from '../../data/catalog.js';
import { wallSpot } from './buy.js';

const TOOLS = [
  ['wall', 'wall', 'Стена · Shift — комната'],
  ['wallDel', 'wallDel', 'Снести стену (или Ctrl)'],
  ['floor', 'floor', 'Пол'],
  ['door', 'door', 'Дверь'],
  ['window', 'window', 'Окно'],
  ['stairs', 'stairs', 'Лестница · , . поворот'],
  ['roof', 'roof', 'Крыша'],
];
// Предметные инструменты: ставятся как покупка (призрак + canPlace + placeObject)
const OBJ_TOOLS = new Set(['door', 'window', 'stairs']);
// Крыша (CONTRACT §8): стиль, цвет, скат — один на участок
const ROOF_STYLES = [['gable', 'Двускатная'], ['hip', 'Вальмовая'], ['flat', 'Плоская']];
const ROOF_COLORS = ['#8a4b3a', '#5b6470', '#3f5d3a', '#7a5a8c', '#b08a52'];
const ROOF_PITCH = [[0.3, 'Пологий'], [0.5, 'Средний'], [0.8, 'Крутой']];

// Точка на полу из пика: Рендер даёт дробные wx/wz (three X/Z = тайловые x/y)
const fy = p => p.wz ?? p.wy;
// Вершина сетки (для стен) и клетка (для пола)
export const vertexOf = p => p.corner ? { x: p.corner.x, y: p.corner.y } : { x: Math.round(p.wx ?? p.x), y: Math.round(fy(p) ?? p.y) };
export const tileOf = p => ({ x: Math.floor(p.wx ?? p.x), y: Math.floor(fy(p) ?? p.y) });

// Линия стены: только горизонталь или вертикаль — по большему смещению
export function wallLine(a, b) {
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? { x0: a.x, y0: a.y, x1: b.x, y1: a.y } : { x0: a.x, y0: a.y, x1: a.x, y1: b.y };
}
export const segCount = (g, room) => room ? 2 * (Math.abs(g.x1 - g.x0) + Math.abs(g.y1 - g.y0)) : Math.abs(g.x1 - g.x0) + Math.abs(g.y1 - g.y0);
export function rectOf(a, b) { return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }; }
export const tileCount = r => (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);

export function createBuild(ctx) {
  const { state, bus, api } = ctx;
  let tool = 'wall', floorId = FLOORS[0].id, wallType = WALLS[0].id, rot = 0, drag = null, lastPick = null;
  const wallPriceOf = () => WALLS.find(w => w.id === wallType).price;

  const toolBtns = {};
  const tools = h('div.zh-tools', {}, TOOLS.map(([id, icon, label]) =>
    (toolBtns[id] = h('button.zh-btn.tool', { title: label, 'data-tool': id, html: ico(icon, 22), onclick: () => setTool(id) }))));
  const swBtns = {};
  const swatches = h('div.zh-swatches', {}, FLOORS.map(f =>
    (swBtns[f.id] = h('button.zh-sw', { title: `${f.name} · ${money(f.price)}/клетка`, style: { background: f.color }, onclick: () => { floorId = f.id; setTool('floor'); syncSw(); } }))));
  const wallBtns = {};
  const wallSw = h('div.zh-swatches', {}, WALLS.map(w =>
    (wallBtns[w.id] = h('button.zh-sw.wall', { title: `${w.name} · ${money(w.price)}/секция`, style: { background: w.color }, onclick: () => { wallType = w.id; setTool('wall'); syncSw(); } }))));
  const info = h('div.zh-info');
  const matLbl = h('span.lbl.mat');
  const matRow = h('div.zh-buildrow', {}, matLbl, h('span.lbl', { html: ico('wall', 14) }), wallSw, h('span.sep'), h('span.lbl', { html: ico('floor', 14) }), swatches);
  for (const box of [wallSw, swatches]) box.addEventListener('wheel', e => { e.preventDefault(); e.stopPropagation(); box.scrollLeft += e.deltaY + e.deltaX; }, { passive: false });
  // крыша: стиль · цвет · скат → world.setRoof
  const roofBtns = [];
  const roofBtn = (k, v, html, title, cls = '') => {
    const b = h('button.zh-btn' + cls, { title, html, 'data-roof': `${k}:${v}`, style: k === 'color' ? { background: v } : null, onclick: () => setRoof(k, v) });
    roofBtns.push([b, k, v]); return b;
  };
  const roofRow = h('div.zh-buildrow.roofrow', { hidden: true },
    h('span.lbl', { html: ico('roof', 14) }),
    h('div.zh-roof', {}, ROOF_STYLES.map(([v, t]) => roofBtn('style', v, ico(v, 18), t))), h('span.sep'),
    h('div.zh-roof', {}, ROOF_COLORS.map(c => roofBtn('color', c, '', c, '.zh-sw.roof'))), h('span.sep'),
    h('div.zh-roof', {}, ROOF_PITCH.map(([v, t], i) => roofBtn('pitch', v, `<b>${'▲'.repeat(i + 1)}</b>`, `${t} скат`))));
  const el = h('div.zh-buildbar', { 'data-ui': 'build', hidden: true }, h('div.zh-cathead', {}, tools, info), matRow, roofRow);
  function roofNow() { return state.lot.roof || { style: 'gable', color: ROOF_COLORS[0], pitch: 0.5 }; }
  function syncRoof() {
    const r = roofNow();
    for (const [b, k, v] of roofBtns) { toggle(b, 'on', r[k] === v); b.disabled = !api.world.setRoof; }
  }
  function setRoof(k, v) {
    if (!api.world.setRoof) { ctx.audio.sfx('error'); return; }
    api.world.setRoof(state, bus, { ...roofNow(), [k]: v });
    syncRoof(); ctx.audio.sfx('click');
  }
  ctx.panelMain.append(el);

  function syncSw() {
    for (const [id, b] of Object.entries(swBtns)) toggle(b, 'on', +id === floorId);
    for (const [id, b] of Object.entries(wallBtns)) toggle(b, 'on', +id === wallType);
  }
  function setTool(t) {
    clearGhosts();
    tool = t; drag = null;
    for (const [k, b] of Object.entries(toolBtns)) toggle(b, 'on', k === t);
    // 30+ материалов: показываем только нужную палитру, она листается колесом
    swatches.hidden = t !== 'floor'; wallSw.hidden = t !== 'wall';
    matRow.querySelectorAll('.lbl:not(.mat), .sep').forEach(x => { x.hidden = true; });
    matLbl.innerHTML = ico(t === 'floor' ? 'floor' : 'wall', 14); matLbl.hidden = !(t === 'floor' || t === 'wall');
    matRow.hidden = t === 'roof'; roofRow.hidden = t !== 'roof';
    if (t === 'roof') syncRoof();
    const hints = {
      wall: `${money(wallPriceOf())}/секция · тяни · <kbd>Shift</kbd> комната`, wallDel: 'тяни по стене — снести',
      floor: `${esc(FLOORS.find(f => f.id === floorId).name)} · тяни прямоугольник`, door: `${money(byId.door.price)} · клик в стену · <kbd>,</kbd><kbd>.</kbd>`, window: `${money(byId.window.price)} · клик в стену`,
      stairs: `${money(byId.stairs.price)} · <kbd>,</kbd><kbd>.</kbd> поворот · этаж ${ctx.level + 1}→${ctx.level + 2}`,
      roof: api.world.setRoof ? 'одна крыша на участок' : 'крыша — ждёт Мир',
    };
    info.innerHTML = `<span class="hint">${hints[t]}</span>`;
    ctx.audio.sfx('click');
  }
  function clearGhosts() { api.render.setWallGhost(null); api.render.setFloorGhost(null); api.render.setGhost(null); ctx.tip(null); }
  syncSw(); setTool('wall');

  // Эффективный инструмент с учётом модификаторов
  const effTool = e => (tool === 'wall' && e?.ctrlKey ? 'wallDel' : tool);

  function preview(p, e) {
    const level = ctx.level;
    const t = effTool(e);
    if (t === 'roof') return null;
    if (OBJ_TOOLS.has(t)) {
      const s = p && (t === 'stairs' ? { ...tileOf(p), rot } : wallSpot(p, rot));
      if (!s) { api.render.setGhost(null); ctx.tip(t === 'stairs' ? null : 'Нужна стена', 'bad'); return null; }
      const r = api.world.canPlace(state, t, s.x, s.y, s.rot, level) || {};
      const ok = !!r.ok && byId[t].price <= state.household.money;
      api.render.setGhost({ defId: t, ...s, level, ok });
      ctx.tip(ok ? money(byId[t].price) : (r.reason || 'Не хватает денег'), ok ? '' : 'bad');
      return { ...s, level, ok };
    }
    if (!drag) {
      if (!p) return null;
      // до нажатия — показываем точку привязки
      if (t === 'floor') { const c = tileOf(p); api.render.setFloorGhost({ ...c, x0: c.x, y0: c.y, x1: c.x, y1: c.y, level, floorId, ok: true }); ctx.tip(money(FLOORS.find(f => f.id === floorId).price), ''); }
      else { const v = vertexOf(p); api.render.setWallGhost({ x0: v.x, y0: v.y, x1: v.x, y1: v.y, level, ok: true, del: t === 'wallDel' }); ctx.tip(null); }
      return null;
    }
    if (!p) return drag.g;
    if (t === 'floor') {
      const r = rectOf(drag.a, tileOf(p));
      const cost = tileCount(r) * FLOORS.find(f => f.id === floorId).price;
      const ok = cost <= state.household.money;
      api.render.setFloorGhost({ ...r, level, floorId, ok });
      ctx.tip(`${money(cost)}`, ok ? '' : 'bad');
      return (drag.g = { ...r, cost, ok });
    }
    const b = vertexOf(p);
    const room = t === 'wall' && e?.shiftKey;
    const g = room ? { x0: drag.a.x, y0: drag.a.y, x1: b.x, y1: b.y } : wallLine(drag.a, b);
    const n = segCount(g, room);
    const del = t === 'wallDel';
    const cost = del ? 0 : n * wallPriceOf();
    const ok = n > 0 && cost <= state.household.money;
    api.render.setWallGhost({ ...g, level, ok, del, room });
    ctx.tip(n ? (del ? `${ico('trash', 12)} ${n}` : money(cost)) : null, ok ? '' : 'bad', true);
    return (drag.g = { ...g, cost, ok, room, del });
  }

  return {
    el,
    enter() { el.hidden = false; setTool(tool); },
    exit() { drag = null; clearGhosts(); el.hidden = true; },
    hover(p, e) { lastPick = p; preview(p, e); },
    down(p, e) {
      const t = effTool(e);
      if (!p || OBJ_TOOLS.has(t) || t === 'roof') return false;
      drag = { a: t === 'floor' ? tileOf(p) : vertexOf(p), g: null };
      preview(p, e);
      return true; // перетаскивание — наше
    },
    up(p, e) {
      const t = effTool(e);
      const level = ctx.level;
      if (t === 'roof') return;
      if (OBJ_TOOLS.has(t)) {
        const s = preview(p, e);
        if (!s?.ok) { ctx.audio.sfx('error'); return; }
        const id = api.world.placeObject(state, bus, t, s.x, s.y, s.rot, level);
        ctx.audio.sfx(id != null ? 'kaching' : 'error');
        preview(p, e);
        return;
      }
      if (!drag) return;
      const g = preview(p, e) || drag.g;
      drag = null;
      clearGhosts();
      if (!g || (g.x0 === g.x1 && g.y0 === g.y1)) return; // клик без протяжки — ничего
      if (!g.ok && !g.del) { ctx.audio.sfx('error'); return; }
      if (t === 'floor') { api.world.paintFloor(state, bus, g.x0, g.y0, g.x1, g.y1, floorId, level); ctx.audio.sfx('floor'); }
      else if (g.del) { api.world.removeWall(state, bus, g.x0, g.y0, g.x1, g.y1, level); ctx.audio.sfx('wallDel'); }
      else if (g.room) { api.world.buildRoom(state, bus, Math.min(g.x0, g.x1), Math.min(g.y0, g.y1), Math.max(g.x0, g.x1), Math.max(g.y0, g.y1), level, wallType); ctx.audio.sfx('wall'); }
      else { api.world.buildWall(state, bus, g.x0, g.y0, g.x1, g.y1, level, wallType); ctx.audio.sfx('wall'); }
      preview(p, e);
    },
    rotate(d) { rot = (rot + d + 4) % 4; ctx.audio.sfx('rotate'); preview(lastPick); },
    escape() { if (drag) { drag = null; clearGhosts(); return true; } return false; },
    setTool,
    get tool() { return tool; },
    get dragging() { return !!drag; },
  };
}
