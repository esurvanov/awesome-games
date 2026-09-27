// Экран загрузки: появляется сразу при импорте интерфейса (раньше, чем Рендер грузит модели),
// крутит шутки Писателя, прячется из initUI. Модалка без кнопок — только иконка, полоска и строка.
import { h, setText } from './dom.js';
import { jokes, tips, textsReady } from './texts.js';

const JOKE_SEC = 2.2; // смена шутки, с
let el = null, timer = 0, i = 0;

export function showLoading(root = document.getElementById('ui')) {
  if (el || !root) return;
  root.classList.add('zh-root');
  const line = h('div.ld-line'), tip = h('div.ld-tip');
  el = h('div.zh-loading', { 'data-ui': 'loading' },
    h('div.ld-card', {},
      h('div.ld-logo', {}, h('span.ld-house', { text: '🏡' }), h('b', { text: 'Житьё' })),
      h('div.ld-bar', {}, h('i')),
      line, tip));
  root.append(el);
  const next = () => { const J = jokes(); setText(line, J[i++ % J.length]); };
  i = Math.floor(Math.random() * 100);
  next();
  textsReady.then(() => { next(); const T = tips(); setText(tip, '💡 ' + T[Math.floor(Math.random() * T.length)]); });
  timer = setInterval(next, JOKE_SEC * 1000);
}

export function hideLoading() {
  if (!el) return;
  clearInterval(timer);
  const old = el; el = null;
  old.classList.add('out');
  setTimeout(() => old.remove(), 500);
}
export const loadingVisible = () => !!el;
