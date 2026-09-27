// Камера: стрелки/край экрана — пан, колесо и +/- — зум, [ ] — поворот, Home/End — стены, PageUp/PageDown — этаж.
// Маленький пульт камеры внизу справа — для мыши.
import { h, toggle, setText } from './dom.js';
import { ico } from './icons.js';

const PAN_SPEED = 700;    // пикселей экрана в секунду (клавиши и край экрана); R.pan — в пикселях
const EDGE_PX = 8;        // ширина «горячего» края экрана
const WALL_MODES = ['down', 'cutaway', 'up'];
// Пан-клавиши по физическим кодам: WASD работают и в русской раскладке (ЦФЫВ)
const PAN_KEYS = { ArrowLeft: 'L', KeyA: 'L', ArrowRight: 'R', KeyD: 'R', ArrowUp: 'U', KeyW: 'U', ArrowDown: 'D', KeyS: 'D' };
const WALL_LABEL = { down: 'Стены опущены', cutaway: 'Стены в разрезе', up: 'Стены подняты' };
const WALL_ICON = {
  down: '<path d="M3 19h18M5 19v-2h14v2"/>',
  cutaway: '<path d="M3 19h18M5 19V9l7-5v15M12 19v-6h7v6"/>',
  up: '<path d="M3 19h18M5 19V8l7-5 7 5v11"/>',
};
const svg = p => `<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;

export function createCamera(ctx) {
  const { api } = ctx;
  const R = api.render;
  const held = new Set();
  let wall = 'cutaway', wheelAcc = 0, wheelT = 0;
  ctx.level = 0;

  const wallBtn = h('button.zh-btn.cam', { onclick: () => stepWall(1) });
  const lvl = h('span.lvl');
  const el = h('div.zh-cam', { 'data-ui': 'camera' },
    h('button.zh-btn.cam', { title: 'Повернуть (Q / [)', html: ico('rotate', 18), style: { transform: 'scaleX(-1)' }, onclick: () => rotate(-1) }),
    h('button.zh-btn.cam', { title: 'Повернуть (E / ])', html: ico('rotate', 18), onclick: () => rotate(1) }),
    h('button.zh-btn.cam', { title: 'Отдалить (−)', text: '−', onclick: () => zoom(-1) }),
    h('button.zh-btn.cam', { title: 'Приблизить (+)', text: '+', onclick: () => zoom(1) }),
    wallBtn,
    h('button.zh-btn.cam', { title: 'Этаж выше (PageUp)', html: ico('level', 16), onclick: () => setLevel(ctx.level + 1) }, lvl),
    h('button.zh-btn.cam.trip', { title: 'Поехать…', text: '🚗', 'data-act': 'travel', onclick: e => ctx.toggleTravel?.(e.currentTarget) }),
    h('button.zh-btn.cam.map', { title: 'Район', text: '🗺️', 'data-act': 'hood', onclick: () => ctx.openHood?.() }),
    h('button.zh-btn.cam.help', { title: 'Подсказки управления', text: '?', 'data-help': '', onclick: () => ctx.showHints?.(true) }),
  );
  const badge = h('div.zh-lvlbadge');
  ctx.root.append(el, badge);
  syncWall(); syncLevel();
  // поездки и район — только если у Мира есть state.hood
  const syncHood = () => { const on = !!ctx.state.hood; el.querySelector('.trip').hidden = !on; el.querySelector('.map').hidden = !on; };
  syncHood();

  function rotate(d) { R.rotate?.(d); ctx.audio.sfx('click'); }
  function zoom(d) { R.zoom?.(d); }
  // зум к курсору: точка под мышью остаётся на месте (r — во сколько раз меняется кадр)
  function zoomAt(d, x, y) {
    const before = R.rig?.viewHGoal;
    R.zoom?.(d);
    const after = R.rig?.viewHGoal;
    if (!before || !after || before === after) return;
    const k = after / before, f = (1 - k) / k;
    const rc = (R.renderer?.domElement || document.querySelector('canvas'))?.getBoundingClientRect() || { left: 0, top: 0, width: innerWidth, height: innerHeight };
    R.pan?.((x - rc.left - rc.width / 2) * f, (y - rc.top - rc.height / 2) * f);
  }
  function stepWall(d) {
    let i = WALL_MODES.indexOf(wall) + d;
    if (i >= WALL_MODES.length) i = 0; // кнопка крутит по кругу, клавиши упираются
    wall = WALL_MODES[Math.max(0, i)];
    R.setWallMode?.(wall); syncWall(); ctx.audio.sfx('click');
  }
  function setWallKey(d) { wall = WALL_MODES[Math.max(0, Math.min(2, WALL_MODES.indexOf(wall) + d))]; R.setWallMode?.(wall); syncWall(); }
  function syncWall() { wallBtn.innerHTML = svg(WALL_ICON[wall]); wallBtn.title = `${WALL_LABEL[wall]} (Home/End)`; }
  function setLevel(l) {
    const n = ((l % 2) + 2) % 2; // 2 этажа: 0 и 1, кнопка по кругу
    ctx.level = n; R.setLevel?.(n); syncLevel(); ctx.audio.sfx('click');
    ctx.onLevel?.(n);
  }
  // номер этажа на кнопке + подпись над пультом (1 — земля, 2 — второй)
  function syncLevel() { setText(lvl, String(ctx.level + 1)); setText(badge, ctx.level ? `⬆ этаж ${ctx.level + 1}` : '⬇ этаж 1'); }

  return {
    el,
    key(e, down) {
      const k = e.key, c = e.code;
      const pk = PAN_KEYS[c] || PAN_KEYS[k];
      if (pk) { down ? held.add(pk) : held.delete(pk); return true; }
      if (!down) return false;
      if (k === '+' || k === '=' || c === 'Equal' || c === 'NumpadAdd') { zoom(1); return true; }
      if (k === '-' || k === '_' || c === 'Minus' || c === 'NumpadSubtract') { zoom(-1); return true; }
      if (c === 'BracketLeft' || c === 'KeyQ' || k === '[') { rotate(-1); return true; }
      if (c === 'BracketRight' || c === 'KeyE' || k === ']') { rotate(1); return true; }
      if (k === 'Home') { setWallKey(1); return true; }
      if (k === 'End') { setWallKey(-1); return true; }
      if (k === 'PageUp') { if (ctx.level < 1) setLevel(ctx.level + 1); return true; }
      if (k === 'PageDown') { if (ctx.level > 0) setLevel(ctx.level - 1); return true; }
      return false;
    },
    wheel(e) {
      const now = performance.now();
      wheelAcc += e.deltaY;
      // один шаг зума на «щелчок» колеса, тачпад копит до 80
      if (Math.abs(wheelAcc) >= 80 || (now - wheelT > 160 && Math.abs(e.deltaY) >= 4)) {
        zoomAt(wheelAcc < 0 || e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);
        wheelAcc = 0; wheelT = now;
      }
    },
    // перетаскивание правой/средней кнопкой: мир едет за курсором
    drag(dxPx, dyPx) { R.pan?.(-dxPx, -dyPx); },
    update(dt, mouse) {
      let dx = 0, dy = 0;
      if (held.has('L')) dx -= 1;
      if (held.has('R')) dx += 1;
      if (held.has('U')) dy -= 1;
      if (held.has('D')) dy += 1;
      if (mouse?.inside && mouse.overWorld && !mouse.dragging) {
        if (mouse.x <= EDGE_PX) dx -= 1; else if (mouse.x >= innerWidth - EDGE_PX) dx += 1;
        if (mouse.y <= EDGE_PX) dy -= 1; else if (mouse.y >= innerHeight - EDGE_PX) dy += 1;
      }
      if (dx || dy) R.pan?.(dx * PAN_SPEED * dt, dy * PAN_SPEED * dt);
    },
    releaseAll() { held.clear(); },
    syncHood,
    get wallMode() { return wall; },
    get panning() { return held.size > 0; },
  };
}
