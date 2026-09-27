// Склейка модулей «Житьё» (docs/CONTRACT.md §6).
import { createBus } from './core/events.js';
import { createState, save, load } from './core/state.js';
import * as world from './world/index.js';
import * as sim from './sim/index.js';
import { initRender } from './render/index.js';
import { initUI, frame as uiFrame } from './ui/index.js';

const bus = createBus();
const fresh = !new URLSearchParams(location.search).has('continue');
const state = (!fresh && load()) || createState();

if (!state.objects.length) {
  sim.seed(state, Date.now());
  const { spawn } = world.loadStartLot(state, bus);
  const at = { x: spawn.x + 0.5, y: spawn.y + 0.5 };
  sim.addSim(state, bus, { name: 'Вера', look: { body: 'female', skin: '#e0b48f', hair: '#5a3620', shirt: '#4a7fc1' }, x: at.x, y: at.y,
    personality: { neat: 6, outgoing: 7, active: 4, playful: 5, nice: 3 }, career: { track: 'business', level: 1, perf: 0, missed: 0 } });
  sim.addSim(state, bus, { name: 'Олег', look: { body: 'male', skin: '#c99672', hair: '#2b2118', shirt: '#6aa35a' }, x: at.x + 1, y: at.y,
    personality: { neat: 3, outgoing: 4, active: 7, playful: 7, nice: 4 }, career: null });
}

// Район «Берёзовая Роща»: стартовый дом становится участком res1, остальные семьи — «за кадром»
world.setSimFactory?.((st, b, spec) => sim.addSim(st, b, spec));
if (!state.hood) world.createHood?.(state, { adopt: true });

const canvas = document.getElementById('view');
const render = await initRender(canvas, state, bus);
initUI(document.getElementById('ui'), state, bus, { world, sim, render });
render.focus(state.sims[0]?.x ?? state.lot.w / 2, state.sims[0]?.y ?? state.lot.h / 2);

// Отладочный доступ из консоли и Playwright
Object.assign(window, { zhitie: { state, bus, world, sim, render } });

// Автосохранение — переключатель во вкладке «Настройки» (UI хранит в localStorage['zhitie.settings'])
let autosave = true;
try { autosave = JSON.parse(localStorage.getItem('zhitie.settings'))?.autosave ?? true; } catch {}
bus.on('settings:changed', s => { if (s && 'autosave' in s) autosave = !!s.autosave; });

let last = performance.now();
let sinceSave = 0;
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state.mode === 'live') sim.tick(state, bus, world, dt);
  uiFrame(dt);
  render.frame(dt);
  if ((sinceSave += dt) > 30) { sinceSave = 0; if (autosave) save(state); }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
