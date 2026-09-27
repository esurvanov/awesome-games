// Интерфейс «Житьё» (docs/CONTRACT.md §5): DOM-слой поверх канваса и весь ввод мыши/клавиатуры.
// Панель, очередь, круговое меню, пузыри, покупка, стройка, камера, звук.
import { h, clamp } from './dom.js';
import { createPanel } from './panel.js';
import { createQueue } from './queue.js';
import { createPie, groupSocials } from './pie.js';
import { createBubbles } from './bubbles.js';
import { createBuy } from './buy.js';
import { createBuild } from './build.js';
import { createCamera } from './camera.js';
import { createDialogs } from './dialogs.js';
import { createEvents, npcName } from './events.js';
import { createHints } from './hints.js';
import { createHood } from './hood.js';
import { createCas } from './cas.js';
import { showLoading, hideLoading } from './loading.js';
import { hint } from './texts.js';

// Экран загрузки — сразу при импорте модуля, раньше чем Рендер начнёт грузить модели (?noload — без него)
if (typeof document !== 'undefined' && !new URLSearchParams(location.search).has('noload')) showLoading();
import { byId } from '../../data/catalog.js';
import { audio } from '../audio/index.js';

const CLICK_PX = 6;       // сдвиг мыши, после которого клик считается перетаскиванием
const NPC_TIP_SEC = 0.12; // как часто пикать под курсором в «Жизни» (подпись НПС)
const LS_SETTINGS = 'zhitie.settings';
function loadSettings() { try { return JSON.parse(localStorage.getItem(LS_SETTINGS)) || {}; } catch { return {}; } }
let ui = null;

export function initUI(root, state, bus, api) {
  root.classList.add('zh-root');
  const ctx = {
    state, bus, api, root, audio,
    selId: null, level: 0,
    // семья: не НПС, не чужие, живые (умершие уходят из портретов)
    household: () => state.sims.filter(s => !s.npc && s.household !== false && !s.visitor && !s.dead),
    // + младенцы в кроватках (предмет crib со st.baby) — только для портретов
    family: () => [...ctx.household(), ...state.objects.filter(o => o.st?.baby).map(o => ({ baby: true, objId: o.id, x: o.x, y: o.y, age: 'baby', name: o.st.baby.name || 'Малыш', hoursLeft: o.st.baby.hoursLeft, look: o.st.baby.look || { skin: '#f1c9a5', shirt: '#f3d5e4' } }))],
    // настройки интерфейса; автосохранение читает оркестратор (localStorage zhitie.settings / событие settings:changed)
    settings: { edgeScroll: true, autosave: true, ...loadSettings() },
    setSetting(k, v) {
      ctx.settings[k] = v;
      try { localStorage.setItem(LS_SETTINGS, JSON.stringify(ctx.settings)); } catch { /* приватный режим */ }
      bus.emit('settings:changed', { ...ctx.settings });
    },
    sim: () => state.sims.find(s => s.id === ctx.selId) || null,
  };
  const debug = { speedClicks: 0, modeClicks: 0, pies: 0 };

  // — подсказка у курсора (цена, причина отказа) —
  const tipEl = h('div.zh-tip', { hidden: true });
  root.append(tipEl);
  const mouse = { x: 0, y: 0, inside: false, overWorld: false, dragging: false, moved: false, ev: null };
  ctx.tip = (text, cls = '', html = false) => {
    if (!text) { tipEl.hidden = true; return; }
    tipEl.hidden = false;
    tipEl.className = 'zh-tip' + (cls ? ' ' + cls : '');
    if (html || /<svg/.test(text)) tipEl.innerHTML = text; else tipEl.textContent = text;
    tipEl.style.transform = `translate(${mouse.x + 16}px, ${mouse.y + 18}px)`;
  };

  ctx.select = (id, focusIfSame) => {
    const s = state.sims.find(x => x.id === id);
    if (!s || s.npc || s.household === false) return; // НПС не выбираются
    if (ctx.selId === id) { if (focusIfSame) api.render.focus?.(s.x, s.y); return; }
    ctx.selId = id;
    bus.emit('sim:selected', { simId: id });
    audio.sfx('select');
    ui?.pie.close(false);
  };
  ctx.setMode = m => {
    debug.modeClicks++;
    if (m === state.mode) return;
    const prev = state.mode;
    ui.pie.close(false);
    if (prev === 'buy') ui.buy.exit();
    if (prev === 'build') ui.build.exit();
    state.mode = m;
    if (m === 'buy') ui.buy.enter();
    if (m === 'build') ui.build.enter();
    ctx.tip(null);
    root.dataset.mode = m;
    // подсказка в духе TS1 при первом входе в режим (тексты Писателя)
    if (!ctx.hinted?.[m]) { (ctx.hinted ||= {})[m] = true; const t = hint(m); if (t) ctx.toast?.(t, m === 'buy' ? '🛋️' : m === 'build' ? '🔨' : '💡'); }
    bus.emit('mode:changed', { mode: m });
    audio.setMode(m);
    audio.sfx('mode');
  };
  let lastSpeed = state.time.speed || 1;
  // silent — вызов от диалога (пауза/возврат), не от игрока
  ctx.setSpeed = (s, silent = false) => {
    if (!silent) {
      debug.speedClicks++;
      if (ui?.dialogs.open) return; // пока открыт вопрос, время стоит
    }
    s = clamp(s | 0, 0, 3);
    if (s > 0) lastSpeed = s;
    if (api.sim.setSpeed) api.sim.setSpeed(state, bus, s); else state.time.speed = s; // запасной путь для стенда
    if (!silent) audio.sfx('speed');
  };

  const panel = createPanel(ctx);
  ctx.panelMain = panel.el.querySelector('.zh-main');
  const queue = createQueue(ctx);
  const pie = createPie(ctx);
  const bubbles = createBubbles(ctx);
  const buy = createBuy(ctx);
  const build = createBuild(ctx);
  const camera = createCamera(ctx);
  const dialogs = createDialogs(ctx);
  ctx.toast = bubbles.toast;
  ctx.closePie = () => pie.close(false);
  ctx.panelSyncMusic = panel.syncMusic;
  const events = createEvents(ctx);
  const hints = createHints(ctx);
  ctx.showHints = force => hints.show(force);
  const hood = createHood(ctx);
  const cas = createCas(ctx);
  ctx.openHood = () => { hood.hideTravel(); hood.open(); };
  ctx.openCas = () => cas.open();
  ctx.toggleTravel = anchor => hood.toggleTravel(anchor);
  // после смены участка: выбрать первого жителя, камеру к нему
  ctx.afterLotChange = () => {
    const s = ctx.household()[0];
    ctx.selId = null;
    if (s) { ctx.select(s.id, false); api.render.focus?.(s.x, s.y, true); }
    camera.syncHood();
  };
  bus.on('lot:loaded', () => ctx.afterLotChange());
  bus.on('hood:lot', () => ctx.afterLotChange());
  bus.on('hood:movein', () => setTimeout(() => ctx.afterLotChange(), 0));
  ui = { ctx, panel, queue, pie, bubbles, buy, build, camera, dialogs, events, hints, hood, cas, debug };
  root.dataset.mode = state.mode;
  if (state.mode === 'buy') buy.enter();
  if (state.mode === 'build') build.enter();
  audio.setMode(state.mode);

  // старт: загрузка гаснет → карта района (если Мир завёл state.hood; ?play — сразу в игру)
  hideLoading();
  if (state.hood?.families?.length && !new URLSearchParams(location.search).has('play')) hood.open();
  camera.syncHood();

  const first = ctx.household()[0];
  if (first) { ctx.selId = first.id; bus.emit('sim:selected', { simId: first.id }); }

  // — звук от событий —
  bus.on('sfx', ({ name }) => audio.sfx(name));
  // скорость может поменять и Мозг (авто-ускорение, будильник) — запоминаем последнюю ненулевую для P
  bus.on('time:speed', ({ speed }) => { if (speed > 0) lastSpeed = speed; });
  bus.on('money:changed', ({ delta, reason }) => { if (delta > 0 && reason !== 'move' && state.mode === 'live') audio.sfx('coin'); });
  bus.on('sim:removed', ({ id }) => { if (ctx.selId === id) ctx.selId = ctx.household()[0]?.id ?? null; });
  bus.on('sim:added', () => { if (ctx.selId == null) ctx.selId = ctx.household()[0]?.id ?? null; });

  // — ввод —
  const isUi = t => t instanceof Node && t !== root && root.contains(t);
  const pick = (x, y) => { try { return api.render.pick(x, y) || null; } catch (e) { console.warn('[ui] pick', e); return null; } };
  let down = null;       // {x, y, btn, buildDrag, moved, pan}
  let hoverDirty = true;
  // курсор над миром: рука при перетаскивании, «палец» над кликабельным
  const canvasEl = () => api.render.renderer?.domElement || document.querySelector('canvas');
  const setCursor = c => { const cv = canvasEl(); if (cv && cv.style.cursor !== c) cv.style.cursor = c; };
  // левая кнопка тянет камеру везде, кроме стройки (там она рисует стены и пол)
  const leftPans = () => state.mode !== 'build';

  // первый жест пользователя включает звук
  const unlock = () => audio.unlock();
  addEventListener('pointerdown', unlock, { capture: true });
  addEventListener('keydown', unlock, { capture: true });

  addEventListener('pointerdown', e => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (pie.isOpen && !pie.contains(e.target)) {
      pie.close();
      if (!isUi(e.target)) { down = { consumed: true }; return; }
    }
    if (isUi(e.target)) return;
    down = { x: e.clientX, y: e.clientY, btn: e.button, buildDrag: false, moved: false, pan: false };
    if (e.button === 0 && state.mode === 'build') down.buildDrag = build.down(pick(e.clientX, e.clientY), e);
    if (e.button === 1 || e.button === 2) { mouse.dragging = true; down.pan = true; setCursor('grabbing'); }
  });
  addEventListener('pointermove', e => {
    const dx = e.clientX - mouse.x, dy = e.clientY - mouse.y;
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.inside = true; mouse.ev = e;
    mouse.overWorld = !isUi(e.target);
    if (down && !down.consumed) {
      if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_PX) {
        down.moved = true;
        // левая кнопка: сдвиг за порог — это пан, клика не будет; догоняем пройденное
        if (down.btn === 0 && leftPans()) { down.pan = true; mouse.dragging = true; setCursor('grabbing'); camera.drag(e.clientX - down.x - dx, e.clientY - down.y - dy); }
      }
      if (down.pan) { camera.drag(dx, dy); hints.mark('pan'); }
    }
    if (!tipEl.hidden) tipEl.style.transform = `translate(${mouse.x + 16}px, ${mouse.y + 18}px)`;
    hoverDirty = true;
  });
  addEventListener('pointerup', e => {
    const d = down; down = null; mouse.dragging = false;
    if (d?.pan) { setCursor(''); hoverDirty = true; }
    // кнопки интерфейса не держат фокус: клавиши (пробел, стрелки) всегда идут в игру
    const a = document.activeElement;
    if (a && a !== document.body && root.contains(a) && !(a instanceof HTMLInputElement && (a.type === 'text' || a.type === 'search'))) a.blur();
    if (!d || d.consumed || d.btn !== 0) return;
    const p = () => pick(e.clientX, e.clientY);
    if (state.mode === 'build') { if (d.buildDrag || !d.moved) build.up(p(), e); return; }
    if (d.moved) return;
    if (hood.isOpen) { hood.clickAt(e.clientX, e.clientY); return; } // район: клик по участку в 3D
    if (state.mode === 'buy') { buy.click(p(), e); return; }
    const pk = p();
    // клик по члену семьи — выбрать его (Shift+клик — меню общения с ним)
    const s = pk?.kind === 'sim' ? state.sims.find(x => x.id === pk.id) : null;
    if (s && s.id !== ctx.selId && ctx.household().includes(s) && !e.shiftKey) { ctx.select(s.id, false); hints.mark('click'); return; }
    openPie(e.clientX, e.clientY, pk);
  });
  document.addEventListener('mouseleave', () => { mouse.inside = false; });
  document.addEventListener('mouseout', e => { if (!e.relatedTarget) mouse.inside = false; });
  addEventListener('blur', () => { camera.releaseAll(); mouse.inside = false; });
  addEventListener('contextmenu', e => { if (!isUi(e.target)) e.preventDefault(); });
  addEventListener('wheel', e => { if (!isUi(e.target)) { e.preventDefault(); camera.wheel(e); hints.mark('zoom'); } }, { passive: false });

  function openPie(x, y, p) {
    const sim = ctx.sim();
    if (!sim || !p) return;
    let target, caption = '';
    if (p.kind === 'sim') { target = { kind: 'sim', id: p.id }; caption = state.sims.find(s => s.id === p.id)?.name || ''; }
    else if (p.kind === 'object') { target = { kind: 'object', id: p.id }; const o = state.objects.find(x => x.id === p.id); caption = byId[o?.def]?.name || ''; }
    else target = { kind: 'tile', x: Math.floor(p.x), y: Math.floor(p.y), level: p.level ?? ctx.level };
    let items = [];
    try { items = api.sim.interactionsFor(state, sim.id, target) || []; } catch (e) { console.warn('[ui] interactionsFor', e); }
    if (target.kind === 'sim') items = groupSocials(items, api.sim.SOCIAL_CATEGORIES || []); // ~50 соц. действий → подменю по категориям
    // клик по полу: если Мозг ничего не дал — «Идти сюда» (ключ Мозга 'go_here')
    if (target.kind === 'tile' && !items.length) items = [{ key: 'go_here', label: 'Идти сюда', icon: 'walk' }];
    debug.pies++;
    hints.mark('click');
    pie.open(x, y, sim, target, items, caption);
  }

  addEventListener('keydown', e => {
    if ((e.target instanceof HTMLInputElement && (e.target.type === 'text' || e.target.type === 'search')) || e.target instanceof HTMLTextAreaElement) return;
    const k = e.key, c = e.code;
    // сфокусированная кнопка не должна «нажиматься» пробелом/Enter — это клавиши игры
    if ((k === ' ' || k === 'Enter') && e.target instanceof HTMLButtonElement && !dialogs.open) { e.preventDefault(); e.target.blur(); }
    if (e.target instanceof HTMLInputElement) e.target.blur(); // ползунок настроек не перехватывает стрелки
    if (dialogs.open) { if (dialogs.key(e)) e.preventDefault(); return; } // модальный вопрос
    if (cas.isOpen) { if (k === 'Escape') cas.close(); return; }
    if (hood.isOpen) { if (k === 'Escape') hood.close(); else if (camera.key(e, true)) e.preventDefault(); return; } // на карте района — только камера
    if (k === 'Shift' || k === 'Control') { hoverDirty = true; mouse.ev = e; return; }
    if (k === 'F1' || k === 'F2' || k === 'F3') { e.preventDefault(); ctx.setMode(['live', 'buy', 'build'][+k[1] - 1]); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (camera.key(e, true)) { e.preventDefault(); if (camera.panning) hints.mark('pan'); return; }
    // скорость — по физическим клавишам (работает в любой раскладке)
    if (c === 'KeyP' || k === 'p' || k === 'P' || k === 'з' || k === 'З') { ctx.setSpeed(state.time.speed ? 0 : lastSpeed); hints.mark('speed'); return; }
    const dig = /^(Digit|Numpad)([0-3])$/.exec(c)?.[2] ?? (/^[0-3]$/.test(k) ? k : null);
    if (dig != null) { ctx.setSpeed(+dig); hints.mark('speed'); return; }
    if (k === ' ') {
      e.preventDefault();
      const hs = ctx.household();
      if (hs.length) { const i = hs.findIndex(s => s.id === ctx.selId); ctx.select(hs[(i + 1) % hs.length].id, false); }
      return;
    }
    if (k === 'Escape') {
      if (pie.isOpen) pie.close();
      else if (state.mode === 'buy') buy.escape();
      else if (state.mode === 'build') build.escape();
      return;
    }
    if (k === 'Delete' || k === 'Backspace') {
      if (state.mode === 'buy') buy.del();
      else if (state.mode === 'build') buildDel();
      return;
    }
    if (k === ',' || k === '<' || k === 'б' || k === 'Б') { rotateObj(-1); return; }
    if (k === '.' || k === '>' || k === 'ю' || k === 'Ю') { rotateObj(1); return; }
  });
  addEventListener('keyup', e => {
    if (e.key === 'Shift' || e.key === 'Control') { hoverDirty = true; mouse.ev = e; }
    camera.key(e, false);
  });
  function rotateObj(d) { if (state.mode === 'buy') buy.rotate(d); else if (state.mode === 'build') build.rotate(d); }
  // Delete в стройке: убрать дверь/окно под курсором
  function buildDel() {
    const p = pick(mouse.x, mouse.y);
    if (p?.kind !== 'object') return;
    const o = state.objects.find(x => x.id === p.id);
    if (o && byId[o.def]?.cat === 'build') { api.world.removeObject(state, bus, o.id); audio.sfx('wallDel'); }
  }

  // — наблюдатель навыков: рост целого уровня → «динь» —
  const skillSeen = new Map();
  ui.watchSkills = () => {
    if (ctx.skillEvents) return; // Мозг шлёт skill:up — звук там
    for (const s of ctx.household()) {
      const lv = Object.values(s.skills || {}).reduce((a, v) => a + Math.floor(v), 0);
      const was = skillSeen.get(s.id);
      if (was != null && lv > was) audio.sfx('skill');
      skillSeen.set(s.id, lv);
    }
  };

  // «Жизнь»: подсветка кликабельного, курсор-«палец», подпись НПС (пик не чаще NPC_TIP_SEC)
  let npcT = 0, npcShown = false, hovered = null;
  ui.npcTip = dt => {
    if (state.mode !== 'live') { if (hovered != null) { api.render.setHover?.(null); hovered = null; } return; }
    npcT -= dt;
    if (npcT > 0 || !hoverDirty || down?.pan) return;
    npcT = NPC_TIP_SEC; hoverDirty = false;
    const p = mouse.overWorld && !pie.isOpen ? pick(mouse.x, mouse.y) : null;
    const s = p?.kind === 'sim' ? state.sims.find(x => x.id === p.id) : null;
    const obj = p?.kind === 'object' ? p.id : null;
    if (obj !== hovered) { api.render.setHover?.(obj); hovered = obj; }
    setCursor(s || obj != null ? 'pointer' : '');
    const t = npcName(s) || (s && ctx.household().includes(s) && s.id !== ctx.selId ? `👆 ${s.name}` : null);
    if (t) { ctx.tip(t); npcShown = true; } else if (npcShown) { ctx.tip(null); npcShown = false; }
  };
  ui.hover = () => {
    if (!hoverDirty || state.mode === 'live' || down?.pan) return;
    setCursor(state.mode === 'build' ? 'crosshair' : '');
    hoverDirty = false;
    if (!mouse.overWorld) { ctx.tip(null); if (state.mode === 'buy') buy.hover(null); return; }
    const p = pick(mouse.x, mouse.y);
    if (state.mode === 'buy') buy.hover(p);
    else build.hover(p, mouse.ev);
  };
  ui.mouse = mouse;
  return ui;
}

export function frame(dt) {
  if (!ui) return;
  const { ctx } = ui;
  if (!ctx.sim() && ctx.household().length) ctx.selId = ctx.household()[0].id;
  ui.panel.update(dt);
  ui.queue.update();
  ui.bubbles.update(dt);
  ui.camera.update(dt, ctx.settings.edgeScroll ? ui.mouse : null);
  if (!ui.hood.isOpen) { ui.hover(); ui.npcTip(dt); }
  else { if (ui.hood.is3D && ui.mouse.overWorld && !ui.mouse.dragging) ui.hood.hoverAt(ui.mouse.x, ui.mouse.y, dt); ui.hood.update(); }
  ui.events.update();
  ui.watchSkills();
  audio.frame(dt);
}
