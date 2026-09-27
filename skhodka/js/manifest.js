// Список частей игры. Каждая часть правит только свою секцию. Порядок внутри секций не важен
// (реестр L выполняет часть при первом L.use), важно лишь: l.js — первым (в index.html), main — последним.
'use strict';
(() => {
const FILES = [
  // ── ядро ──
  'js/core.js',
  // ── содержание (агент «сценарий») ──
  'js/content/layout.js',
  'js/content/topics.js',
  'js/content/needs.js',
  'js/content/roles.js',
  'js/content/minds.js',
  'js/content/moods.js',
  'js/content/archetypes.js',
  'js/content/oddballs.js',
  'js/content/cards.js',
  'js/content/lines.js',
  'js/content/events.js',
  'js/content/chat.js',
  'js/content/names.js',
  'js/content/tuning.js',
  'js/content/index.js',
  // ── симуляция (агент «симуляция») ──
  'js/sim/fixture.js', 'js/sim/nav.js', 'js/sim/crowd.js', 'js/sim/brain.js', 'js/sim/talk.js',
  'js/sim/director.js', 'js/sim/score.js', 'js/sim/world.js',
  // ── зал (агент «сцена») ──
  'js/render/quality.js', 'js/render/textures.js', 'js/render/props.js', 'js/render/camera.js', 'js/render/scene.js',
  // ── люди (агент «люди») ──
  'js/render/looks.js',
  'js/render/people.js',
  // ── интерфейс (агент «интерфейс») ──
  'js/ui/icons.js', 'js/ui/dom.js', 'js/ui/talk.js', 'js/ui/hud.js', 'js/ui/phone.js', 'js/ui/screens.js', 'js/ui/ui.js',
  // ── сборка ──
  'js/main.js',
];
globalThis.SKHODKA_FILES = FILES;
if (typeof document !== 'undefined' && document.readyState === 'loading')
  for (const f of FILES) document.write(`<script src="${f}"></script>`);
})();
