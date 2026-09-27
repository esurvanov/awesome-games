// Очередь действий выбранного сима — иконки вверху слева, текущее первое. Клик — отмена.
import { h, keyedList, toggle, setVar, setAttr } from './dom.js';
import { iconHtml } from './icons.js';

export function createQueue(ctx) {
  const { state, bus, api } = ctx;
  const box = h('div.zh-queue', { 'data-ui': 'queue' });
  ctx.root.append(box);

  const list = keyedList(box, it => it.uid, it => {
    const el = h('button.zh-q', {
      onclick: () => {
        const sim = ctx.sim();
        if (!sim) return;
        api.sim.cancel(state, bus, sim.id, it.uid);
        el.classList.add('cancel');
        ctx.audio.sfx('cancel');
      },
    });
    el.innerHTML = `<svg class="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16"/></svg>${iconHtml(it.icon, 20)}<span class="x">✕</span>`;
    return el;
  }, (el, it) => {
    toggle(el, 'cur', !!it.current);
    toggle(el, 'auto', it.by === 'auto');
    toggle(el, 'cancel', !!(it.cancelled || it.canceled));
    setAttr(el, 'title', `${it.label || it.interaction || ''}${it.current ? '' : ''} · ✕ отменить`);
    setVar(el, '--p', it.current && it.progress != null ? String(Math.max(0, Math.min(1, it.progress))) : '0');
  });

  // Состав очереди: act (текущее) + queue. Если act уже лежит в queue — только помечаем.
  const iconByUid = new Map(); // иконка запоминается, пока пункт в очереди, — act её не несёт
  function items(sim) {
    const q = (sim.queue || []).map(it => ({ ...it }));
    for (const it of q) if (it.icon) iconByUid.set(it.uid, it.icon);
    const act = sim.act;
    if (act) {
      const prog = api.sim.actionProgress ? api.sim.actionProgress(sim) : act.progress ?? (act.dur ? act.t / act.dur : null);
      const i = act.uid != null ? q.findIndex(it => it.uid === act.uid) : -1;
      if (i >= 0) { const [cur] = q.splice(i, 1); q.unshift({ ...cur, current: true, progress: prog, cancelled: act.cancel }); }
      else q.unshift({ uid: act.uid ?? 'act', icon: act.icon || iconByUid.get(act.uid), interaction: act.interaction || act.key, label: act.label, by: act.by, current: true, progress: prog, cancelled: act.cancel });
    }
    return q.slice(0, 8);
  }

  function update() {
    const sim = ctx.sim();
    const show = state.mode === 'live' && sim;
    box.hidden = !show;
    list(show ? items(sim) : []);
  }
  return { update, el: box };
}
