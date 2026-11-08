// Список частей игры. Порядок внутри списка не важен (реестр L выполняет часть при первом L.use),
// важно лишь: l.js — первым (в index.html), main — последним.
'use strict';
(() => {
const FILES = [
  // ── ядро ──
  'js/core.js',
  // ── симуляция: без DOM, работает и в Node ──
  'js/sim/model.js', 'js/sim/sim.js', 'js/sim/run.js',
  // ── содержание: уровни и тексты на двух языках ──
  'js/content/levels.js', 'js/content/text.ru.js', 'js/content/text.en.js',
  // ── поле с потоками ──
  'js/render/board.js',
  // ── интерфейс ──
  'js/ui/i18n.js', 'js/ui/app.js',
  // ── сборка ──
  'js/main.js',
];
globalThis.UPTIME_FILES = FILES;
if (typeof document !== 'undefined' && document.readyState === 'loading')
  for (const f of FILES) document.write(`<script src="${f}"></script>`);
})();
