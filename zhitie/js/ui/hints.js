// Подсказка управления при первом запуске: полоска иконок сверху по центру.
// Гаснет, когда игрок хоть раз подвинул камеру и кликнул по миру; «?» на пульте камеры — показать снова.
import { h, toggle } from './dom.js';

const LS = 'zhitie.hints';
const CHIPS = [
  ['pan', '🖱️', 'тащи — двигать', 'WASD / стрелки'],
  ['zoom', '🖲️', 'колесо — зум', '+ / −'],
  ['click', '👆', 'клик — действия', 'по предмету или жителю'],
  ['speed', '⏯️', '1 2 3 — скорость', 'P — пауза'],
];

export function createHints(ctx) {
  const done = new Set();
  const chips = {};
  const el = h('div.zh-hints', { 'data-ui': 'hints', hidden: true },
    CHIPS.map(([id, ic, text, sub]) => (chips[id] = h('div.zh-hint', { title: sub }, h('span.hi', { text: ic }), h('span.ht', { text }), h('span.ok', { text: '✓' })))),
    h('button.zh-hx', { title: 'Скрыть', text: '✕', onclick: () => hide(true) }));
  ctx.root.append(el);

  let seen = false;
  try { seen = localStorage.getItem(LS) === 'done'; } catch { /* приватный режим */ }

  function show(force) {
    done.clear();
    for (const c of Object.values(chips)) toggle(c, 'did', false);
    el.hidden = false; el.classList.remove('out');
    if (force) ctx.audio.sfx('open');
  }
  function hide(remember) {
    el.classList.add('out');
    setTimeout(() => { el.hidden = true; }, 450);
    if (remember) try { localStorage.setItem(LS, 'done'); } catch { /* приватный режим */ }
  }
  // отметка шага; двинул камеру + кликнул по миру → подсказка больше не нужна
  function mark(id) {
    if (el.hidden || done.has(id)) return;
    done.add(id);
    toggle(chips[id], 'did', true);
    if (done.has('pan') && done.has('click')) setTimeout(() => hide(true), 900);
  }
  if (!seen) show();
  return { show, hide, mark, get visible() { return !el.hidden; } };
}
