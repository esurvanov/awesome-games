// Диалоги-вопросы (CONTRACT §8): bus 'dialog' → модальная карточка, время на паузе,
// ответ → sim.answer(state, bus, id, key). Несколько диалогов — очередью, по одному.
import { h, esc } from './dom.js';
import { iconHtml } from './icons.js';
import { portraitSvg } from './portrait.js';

export function createDialogs(ctx) {
  const { state, bus, api } = ctx;
  const queue = [];
  let cur = null, resumeSpeed = null;

  const card = h('div.zh-dlg', { role: 'dialog' });
  const wrap = h('div.zh-dlgwrap', { 'data-ui': 'dialog', hidden: true }, card);
  ctx.root.append(wrap);

  bus.on('dialog', d => {
    if (!d || d.id == null || queue.some(q => q.id === d.id) || cur?.id === d.id) return;
    queue.push(d);
    if (!cur) next();
  });

  function next() {
    cur = queue.shift() || null;
    if (!cur) {
      wrap.hidden = true;
      // вернуть скорость, которая была до первого диалога
      if (resumeSpeed != null) { const s = resumeSpeed; resumeSpeed = null; if (s > 0 && state.time.speed === 0) ctx.setSpeed(s, true); }
      return;
    }
    if (resumeSpeed == null) { resumeSpeed = state.time.speed; if (state.time.speed !== 0) ctx.setSpeed(0, true); }
    ctx.closePie?.();
    const sim = cur.simId != null ? state.sims.find(s => s.id === cur.simId) : null;
    const opts = cur.options?.length ? cur.options : [{ key: 'ok', label: 'Хорошо' }];
    // вид карточки: chance — карта шанса, newspaper — газета, letter — письмо (иначе обычный вопрос)
    const kind = ['chance', 'newspaper', 'letter', 'job'].includes(cur.kind) ? cur.kind : '';
    card.className = 'zh-dlg' + (kind ? ' ' + kind : '');
    const KIND_IC = { chance: '🎲', newspaper: '📰', letter: '✉️', job: '💼' };
    card.innerHTML = `
      ${kind ? `<div class="dk">${KIND_IC[kind]}${cur.title ? ` <b>${esc(cur.title)}</b>` : ''}</div>` : cur.title ? `<div class="dk"><b>${esc(cur.title)}</b></div>` : ''}
      <div class="dh">${sim ? `<span class="dp">${portraitSvg(sim, 40)}</span>` : ''}<span class="di">${iconHtml(cur.icon || 'bell', 30)}</span></div>
      <div class="dt">${esc(cur.text || '')}</div>
      <div class="do">${opts.map((o, i) => `<button class="zh-btn dbtn${i === 0 ? ' main' : ''}" data-key="${esc(o.key)}">${i < 9 ? `<kbd>${i + 1}</kbd>` : ''}${esc(o.label)}</button>`).join('')}</div>
      ${queue.length ? `<div class="dq">+${queue.length}</div>` : ''}`;
    card.querySelectorAll('.dbtn').forEach(b => b.addEventListener('click', () => answer(b.dataset.key)));
    wrap.hidden = false;
    card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop');
    ctx.audio.sfx('dialog');
  }

  function answer(key) {
    if (!cur) return;
    const d = cur;
    try { api.sim.answer?.(state, bus, d.id, key); } catch (e) { console.warn('[ui] answer', e); }
    ctx.audio.sfx('click');
    next();
  }

  return {
    get open() { return !!cur; },
    get pending() { return queue.length + (cur ? 1 : 0); },
    // клавиши 1..9 / Enter — ответ, пока карточка открыта
    key(e) {
      if (!cur) return false;
      const opts = cur.options?.length ? cur.options : [{ key: 'ok' }];
      if (e.key === 'Enter') { answer(opts[0].key); return true; }
      const n = +e.key;
      if (n >= 1 && n <= opts.length) { answer(opts[n - 1].key); return true; }
      return true; // остальные клавиши глотаем — модалка
    },
    answer,
  };
}
