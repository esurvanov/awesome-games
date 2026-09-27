// Вкладка «Желания»: 4 желания + 3 страха (иконки, подсказка — текст), замок на одном желании,
// шкала устремления. Данные — у Мозга: sim.wants / sim.fears / sim.aspiration(+meter), замок — sim.lockWant.
import { h, setText, setStyle, setAttr, toggle, keyedList, motiveColor, clamp, esc } from './dom.js';
import { iconHtml, OBJ_EMOJI } from './icons.js';

const WANT_SLOTS = 4, FEAR_SLOTS = 3;
export const ASP_UI = { romance: ['💘', 'Романтика'], family: ['👪', 'Семья'], fortune: ['💰', 'Богатство'], popularity: ['🌟', 'Популярность'], knowledge: ['🎓', 'Знания'], pleasure: ['🎉', 'Удовольствия'], grow_up: ['🧸', 'Вырасти'] };

// Мозг (волна 3): sim.wants = {asp, meter −100..100, list:[{id, done}]}, тексты — api.sim.WANTS
const EVENT_IC = { baby: '👶', travel: '🚗', painting: '🎨', homework: '📚', grade: '🅰️', party: '🎉', wedding: '💍', fire: '🔥', burglar: '🦹', death: '🕯️', fired: '📉' };
export function wantIcon(w) {
  const m = w?.match || {};
  switch (m.kind) {
    case 'skill': return m.skill || 'skill';
    case 'buy': case 'use': return OBJ_EMOJI[m.objKind] || (m.kind === 'buy' ? '🛒' : '🖐️');
    case 'money': return '💰';
    case 'social': return m.key === 'kiss' || m.key === 'romantic_kiss' ? '💋' : m.key === 'propose' ? '💍' : '💬';
    case 'career': return '💼';
    case 'motive': return m.motive || '✨';
    case 'event': return EVENT_IC[m.what] || '⭐';
    default: return w?.type === 'fear' ? '⚡' : '✨';
  }
}
export const LEVEL_UI = { platinum: ['💎', 'Платина'], gold: ['🥇', 'Золото'], green: ['🟢', 'Норма'], red: ['🔴', 'Плохо'], failure: ['💀', 'Провал'] };
// список желаний/страхов сима в едином виде
export function wantsOf(api, sim, type) {
  const W = sim.wants;
  if (Array.isArray(sim[type === 'want' ? 'wants' : 'fears'])) return sim[type === 'want' ? 'wants' : 'fears']; // старый/мок формат
  if (!W?.list) return [];
  const byId = api.sim.WANTS ? (api._wantById ||= Object.fromEntries(api.sim.WANTS.map(w => [w.id, w]))) : {};
  return W.list.map(it => ({ it, w: byId[it.id] })).filter(x => (x.w?.type || 'want') === type)
    .map(({ it, w }) => ({ id: it.id, done: it.done, locked: it.locked || W.locked === it.id, icon: wantIcon(w), text: w?.label || it.id, points: w ? (type === 'fear' ? -w.pts : w.pts) : null }));
}

// Шкала устремления: Мозг может дать −100..100 или 0..1 — приводим к −100..100
export function aspMeter(sim) {
  if (typeof sim.wants?.meter === 'number') return clamp(sim.wants.meter, -100, 100);
  const a = sim.aspiration;
  let v = sim.aspMeter ?? sim.aspirationMeter ?? (typeof a === 'object' ? a?.meter ?? a?.score : null) ?? 0;
  if (Math.abs(v) <= 1 && v !== 0 && !Number.isInteger(v)) v *= 100;
  return clamp(v, -100, 100);
}
export const aspKind = sim => sim.wants?.asp || (typeof sim.aspiration === 'object' ? sim.aspiration?.kind : sim.aspiration) || null;
const text = w => w.text || w.label || w.name || w.key || '';

export function createWantsPane(ctx) {
  const { state, bus, api } = ctx;
  const aspIc = h('span.ws-aic'), aspName = h('span.ws-an'), meterFill = h('i'), meterVal = h('span.ws-av');
  const wantsBox = h('div.ws-slots.want'), fearsBox = h('div.ws-slots.fear');
  const el = h('div.pane.wants', {},
    h('div.ws-asp', {}, aspIc, h('span.ws-meter', {}, meterFill), meterVal, aspName),
    h('div.ws-cols', {},
      h('div.ws-col', {}, h('span.ws-h', { text: '✨' }), wantsBox),
      h('div.ws-col', {}, h('span.ws-h', { text: '⚡' }), fearsBox)));

  const slot = cls => keyedList(cls, w => w.id ?? w.key ?? w.slot, w => {
    const b = h('button.ws-slot', { 'data-want': w.id ?? '' });
    b.innerHTML = `<span class="wi"></span><span class="wp"></span><span class="lk">🔒</span>`;
    b.addEventListener('click', () => {
      if (w.empty || !cls.classList.contains('want')) return;
      const sim = ctx.sim();
      if (!api.sim.lockWant || !sim) { ctx.audio.sfx('error'); return; }
      // повторный клик по закреплённому — снять замок (wantId = null)
      const cur = sim.wants?.locked ?? (Array.isArray(sim.wants) ? sim.wants.find(x => x.locked)?.id : null);
      const ok = api.sim.lockWant(state, bus, sim.id, cur === w.id ? null : w.id);
      ctx.audio.sfx(ok === false ? 'error' : 'click');
    });
    return b;
  }, (b, w) => {
    toggle(b, 'empty', !!w.empty);
    toggle(b, 'done', !!w.done);
    toggle(b, 'locked', !!w.locked);
    b.firstChild.innerHTML = w.empty ? '' : iconHtml(w.icon || '✨', 22);
    setText(b.children[1], w.empty || w.points == null ? '' : `${w.points > 0 ? '+' : ''}${w.points}`);
    setAttr(b, 'title', w.empty ? '' : `${text(w)}${w.locked ? ' · 🔒' : cls.classList.contains('want') && api.sim.lockWant ? ' · клик — закрепить' : ''}`);
  });
  const wantsList = slot(wantsBox), fearsList = slot(fearsBox);
  const pad = (arr, n, pre) => { const a = (arr || []).slice(0, n); while (a.length < n) a.push({ id: `${pre}${a.length}`, empty: true }); return a; };

  return {
    el,
    update() {
      const sim = ctx.sim();
      if (!sim) return;
      const kind = aspKind(sim), A = api.sim.ASPIRATIONS?.[kind];
      const ui = A ? [A.icon, A.name] : ASP_UI[kind] || ['🎯', 'Устремление'];
      setText(aspIc, ui[0]);
      const lvl = api.sim.aspirationLevel?.(sim);
      setText(aspName, lvl && LEVEL_UI[lvl] ? `${ui[1]} · ${LEVEL_UI[lvl][0]}` : ui[1]);
      const v = aspMeter(sim);
      // вертикальная шкала: снизу красное, сверху зелёное — как у TS2
      setStyle(meterFill, 'height', `${((v + 100) / 2).toFixed(1)}%`);
      setStyle(meterFill, 'background', motiveColor(v));
      setText(meterVal, `${Math.round(v)}`);
      wantsList(pad(wantsOf(api, sim, 'want'), WANT_SLOTS, 'w'));
      fearsList(pad(wantsOf(api, sim, 'fear'), FEAR_SLOTS, 'f'));
    },
  };
}
