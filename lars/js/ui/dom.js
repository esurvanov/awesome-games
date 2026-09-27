// Мелочи DOM: экранирование, чипы последствий, модальное окно, тосты.
'use strict';
L.def('ui/dom', () => {
const { ic } = L.use('ui/icons');
const { $ } = L.use('core');

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const chip = c => `<span class="chip ${c.tone > 0 ? 'p' : c.tone < 0 ? 'n' : 'i'}">${ic(c.icon || 'star')}${esc(c.text)}</span>`;
const chips = list => `<div class="chips">${(list || []).map(chip).join('')}</div>`;
const fmt = n => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// одно модальное окно за раз; стек — чтобы карточка события не терялась за телефоном
const Modal = {
  stack: [], el: null,
  get open() { return !!this.stack.length; },
  show(html, mount, key = '') {
    this.el ||= $('modal');
    this.stack.push({ html, mount, key });
    this.render();
  },
  replace(html, mount) { this.stack.pop(); this.show(html, mount); },
  render() {
    this.el ||= $('modal');
    const top = this.stack[this.stack.length - 1];
    if (!top) { this.el.hidden = true; this.el.innerHTML = ''; return; }
    this.el.hidden = false; this.el.innerHTML = top.html; this.el.dataset.key = top.key;
    top.mount && top.mount(this.el);
  },
  close() { this.stack.pop(); this.render(); },
  closeAll() { this.stack.length = 0; this.render(); },
  top() { return this.stack[this.stack.length - 1]?.key || ''; },
};

function toast(t) {
  const box = $('toasts'); if (!box) return;
  const el = document.createElement('div');
  el.className = 'plate toast' + (t.big ? ' big' : '') + (t.tone > 0 ? ' p' : t.tone < 0 ? ' n' : '');
  el.innerHTML = ic(t.icon || 'star') + '<span>' + esc(t.text) + '</span>';
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), t.big ? 4200 : 2600);
}
return { esc, chip, chips, fmt, Modal, toast };
});
