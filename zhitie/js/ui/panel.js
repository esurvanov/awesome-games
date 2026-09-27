// Панель управления внизу слева: портреты семьи, режимы, деньги, часы и скорость, вкладки.
// Вся разметка строится один раз; frame() только меняет значения на месте.
import { h, setText, setStyle, setVar, toggle, setAttr, keyedList, motiveColor, clockOf, money, clamp } from './dom.js';
import { ico, MOTIVE_UI, SKILL_UI, TRAIT_UI } from './icons.js';
import { portraitSvg } from './portrait.js';
import { createHousePane, createOptionsPane } from './house.js';
import { createWantsPane } from './wants.js';

const MOTIVES = ['hunger', 'comfort', 'hygiene', 'bladder', 'energy', 'fun', 'social', 'room'];
const SKILLS = ['cooking', 'mechanical', 'charisma', 'body', 'logic', 'creativity'];
const TRAITS = ['neat', 'outgoing', 'active', 'playful', 'nice'];
const TABS = [['needs', 'hunger', 'Потребности'], ['wants', 'wants', 'Желания'], ['job', 'job', 'Работа'], ['traits', 'trait', 'Характер'], ['skills', 'skill', 'Навыки'], ['rel', 'rel', 'Отношения'], ['house', 'room', 'Дом'], ['opts', 'gear', 'Настройки']];
const MODES = [['live', 'live', 'Жизнь', 'F1'], ['buy', 'buy', 'Покупка', 'F2'], ['build', 'build', 'Стройка', 'F3']];
const SPEEDS = [[0, 'Пауза', 'P'], [1, 'Обычно', '1'], [2, 'Быстро', '2'], [3, 'Очень быстро', '3']];
// Названия карьер — запасные, если Мозг не отдал своё название (см. careerInfo)
const TRACK_RU = { business: 'Бизнес', entertainment: 'Шоу-бизнес', law: 'Полиция', crime: 'Криминал', medicine: 'Медицина', military: 'Армия', politics: 'Политика', athlete: 'Спорт', science: 'Наука', xtreme: 'Экстрим' };

// Баланс (зарплаты, часы) — у Мозга в js/core/tuning.js; подхватываем, если файл уже есть
let TUNING = null;
import('../core/tuning.js').then(m => { TUNING = m; }).catch(() => {});

// Оценка школьника буквой: gradeLetter(число) от Мозга
let gradeFn = null;
const gradeOf = s => (s.school?.grade != null && gradeFn ? gradeFn(s.school.grade) : null);

export function careerInfo(api, state, sim) {
  const c = sim.career;
  if (!c) return null;
  const fromApi = api.sim.careerInfo?.(state, sim.id);
  if (fromApi) return { track: TRACK_RU[c.track] || c.track, ...fromApi };
  const t = (api.sim.CAREERS || TUNING?.CAREERS)?.[c.track];
  const lv = (t?.levels || (Array.isArray(t) ? t : []))[c.level - 1] || {};
  const hrs = lv.hours || (lv.start != null ? [lv.start, lv.end] : null);
  return { track: t?.name || TRACK_RU[c.track] || c.track, title: lv.title || lv.name || '', pay: lv.pay ?? lv.salary ?? null, hours: hrs };
}

function speedIcon(s) {
  if (s === 0) return ico('pause', 16);
  return `<span class="tri">${ico('play', 14).repeat(s)}</span>`;
}
// Множитель скорости для подписи: из tuning.TIME.speeds (Мозг), иначе номер
const speedLabel = s => (s === 0 ? '⏸ пауза' : `×${TUNING?.TIME?.speeds?.[s] ?? s}`);

export function createPanel(ctx) {
  const { state, bus, api } = ctx;
  gradeFn = api.sim.gradeLetter || null;

  // — портреты семьи —
  const fam = h('div.zh-fam');
  // младенец в кроватке — это предмет (crib, st.baby): показываем портретом без выбора
  const famList = keyedList(fam, s => s.baby ? `b${s.objId}` : s.id, s => {
    const el = h('button.zh-face' + (s.baby ? '.baby' : ''), {
      title: s.name, 'data-sim': s.baby ? null : s.id,
      onclick: () => s.baby ? api.render.focus?.(s.x + 0.5, s.y + 0.5) : ctx.select(s.id, true),
    });
    el.innerHTML = portraitSvg(s, 44) + '<span class="mood"></span><span class="age"></span><span class="badge"></span>';
    return el;
  }, (el, s) => {
    toggle(el, 'kid', s.age === 'child');
    // у школьника вместо значка — оценка (буква от Мозга)
    setText(el.querySelector('.age'), s.baby ? '👶' : s.age === 'child' ? (gradeOf(s) || '🧒') : '');
    if (s.baby) { setAttr(el, 'title', `${s.name} · ${Math.ceil(s.hoursLeft ?? 0)} ч до роста`); setVar(el, '--mood', '#ffd46e'); return; }
    toggle(el, 'on', s.id === ctx.selId);
    // состояние: на работе / спит / умер
    const st = s.dead ? '🕯️' : s.atWork ? '💼' : s.asleep ? '💤' : '';
    setText(el.lastChild, st);
    toggle(el, 'away', !!(s.atWork || s.dead));
    setAttr(el, 'title', s.name + (s.dead ? ' · умер' : s.atWork ? ' · на работе' : s.asleep ? ' · спит' : ''));
    const m = api.sim.mood ? api.sim.mood(s) : 0;
    setVar(el, '--mood', motiveColor(m));
  });

  // — режимы —
  const modeBtns = {};
  const modes = h('div.zh-modes', {}, MODES.map(([m, icon, label, key]) =>
    (modeBtns[m] = h('button.zh-btn.mode', { title: `${label} (${key})`, 'data-mode': m, html: `${ico(icon, 20)}<span class="ml">${label}</span>`, onclick: () => ctx.setMode(m) }))));

  // — деньги —
  const moneyVal = h('span.v');
  const bills = h('span.bills', { hidden: true });
  const moneyBox = h('div.zh-money', { title: 'Деньги семьи' }, moneyVal, bills);
  let shown = state.household.money;

  // — часы и скорость —
  const dow = h('span.dow'), hm = h('span.hm'), dayN = h('span.dn');
  const spx = h('span.spx', { title: 'Скорость времени' });
  const ultra = h('span.ultra', { title: 'Авто-ускорение: все спят или на работе', text: '⚡', hidden: true });
  const party = h('span.party', { hidden: true, title: 'Вечеринка' });
  const clock = h('div.zh-clock', {}, h('span', { html: ico('clock', 14) }), dow, hm, ultra, party, spx, dayN);
  const speedBtns = SPEEDS.map(([s, label, key]) =>
    h('button.zh-btn.spd', { title: `${label} (${key})`, 'data-speed': s, html: speedIcon(s), onclick: () => ctx.setSpeed(s) }));
  const musicBtn = h('button.zh-btn.spd.mus', { title: 'Музыка', onclick: () => { ctx.audio.toggleMusic(); syncMusic(); optsPane?.syncMusic(); } });
  const syncMusic = () => { musicBtn.innerHTML = ico(ctx.audio.musicOn ? 'music' : 'mute', 14); toggle(musicBtn, 'off', !ctx.audio.musicOn); };
  syncMusic();
  const speed = h('div.zh-speed', {}, speedBtns, musicBtn);

  const left = h('div.zh-left', {}, modes, moneyBox, clock, speed);

  // — вкладки —
  let tab = 'needs';
  const tabBtns = {}, panes = {};
  const tabs = h('div.zh-tabs', {}, TABS.map(([id, icon, label]) =>
    (tabBtns[id] = h('button.zh-btn.tab', { title: label, 'data-tab': id, html: ico(icon, 18), onclick: () => setTab(id) }))));
  const tabTitle = h('div.zh-tabtitle');
  const simName = h('span.zh-simname');
  const body = h('div.zh-tabbody');
  const right = h('div.zh-right', {}, h('div.zh-tabhead', {}, tabs, h('div.zh-tabcap', {}, simName, tabTitle)), body);

  function setTab(id) {
    if (tab !== id) ctx.audio.sfx('tab');
    tab = id;
    for (const [k, el] of Object.entries(panes)) el.hidden = k !== id;
    for (const [k, el] of Object.entries(tabBtns)) toggle(el, 'on', k === id);
    setText(tabTitle, TABS.find(t => t[0] === id)[2]);
  }

  // Потребности: 8 полос в две колонки
  const needEls = {};
  panes.needs = h('div.pane.needs', {}, MOTIVES.map(k => {
    const fill = h('i');
    needEls[k] = fill;
    return h('div.need', { title: MOTIVE_UI[k][0], 'data-need': k }, h('span.ni', { html: ico(MOTIVE_UI[k][1], 15) }), h('span.nl', { text: MOTIVE_UI[k][0] }), h('span.bar', {}, fill));
  }));
  // Работа
  const job = { icon: h('span.jicon', { html: ico('job', 26) }), track: h('b'), title: h('span.jt'), lvl: h('span.pips'), pay: h('span.jv'), hrs: h('span.jv'), perf: h('i'), none: h('div.jnone', { html: `${ico('job', 28)}<b>Нет работы</b><span>📰 газета · 💻 компьютер — «Искать работу»</span>` }), school: h('div.jnone', { html: `<span style="font-size:28px">🎒</span><b>Школа · <span class="grade">—</span></b><span>🚌 08:00 · оценка растёт от уроков и настроения</span>` }), box: null };
  for (let i = 0; i < 10; i++) job.lvl.append(h('i'));
  job.box = h('div.jbox', {},
    h('div.jhead', {}, job.icon, h('div', {}, job.track, job.title)),
    h('div.jrow', { title: 'Уровень' }, h('span.ni', { html: ico('skill', 14) }), job.lvl),
    h('div.jrow', { title: 'Зарплата в день' }, h('span.ni', { html: ico('money', 14) }), job.pay, h('span.ni', { html: ico('clock', 14) }), job.hrs),
    h('div.jrow', { title: 'Успехи на работе' }, h('span.ni', { html: ico('trait', 14) }), h('span.bar.center', {}, job.perf)));
  panes.job = h('div.pane.job', {}, job.box, job.none, job.school);
  // Характер: точки 0–10
  const traitEls = {};
  panes.traits = h('div.pane.traits', {}, TRAITS.map(k => {
    const dots = h('span.dots');
    for (let i = 0; i < 10; i++) dots.append(h('i'));
    traitEls[k] = dots;
    return h('div.trait', { title: TRAIT_UI[k][0] }, h('span.ni', { html: ico(TRAIT_UI[k][1], 15) }), h('span.nl', { text: TRAIT_UI[k][0] }), dots);
  }));
  // Навыки: 10 делений с дробным заполнением
  const skillEls = {};
  panes.skills = h('div.pane.skills', {}, SKILLS.map(k => {
    const seg = h('span.segs'), num = h('span.num');
    for (let i = 0; i < 10; i++) seg.append(h('i', {}, h('b')));
    skillEls[k] = { seg, num };
    return h('div.skill', { title: SKILL_UI[k][0] }, h('span.ni', { html: ico(SKILL_UI[k][1], 15) }), h('span.nl', { text: SKILL_UI[k][0] }), seg, num);
  }));
  // Отношения: портрет + полоса −100..100
  const relBox = h('div.rels'), relEmpty = h('div.jnone', { html: `${ico('rel', 28)}<b>Пока ни с кем</b>` });
  panes.rel = h('div.pane.rel', {}, relBox, relEmpty);
  // собеседник: сим на участке или знакомый горожанин (state.brain.townies, ключ townieId)
  const whoIs = id => state.sims.find(s => s.id === id || s.townieId === id) || state.brain?.townies?.find(t => t.id === id) || null;
  const relList = keyedList(relBox, r => r.id, r => {
    const other = whoIs(r.id);
    const el = h('div.relc', { title: other?.name || `#${r.id}` });
    el.innerHTML = portraitSvg(other || { id: r.id }, 30);
    el.append(h('span.rn', { text: other?.name || `#${r.id}` }), h('span.bar.center', {}, h('i')), h('span.rs'));
    return el;
  }, (el, r) => {
    const fill = el.querySelector('.bar i');
    paintCentered(fill, r.v);
    const st = api.sim.relStatus ? api.sim.relStatus(r.v) : r.v >= 70 ? 'crush' : r.v >= 50 ? 'friend' : r.v <= -50 ? 'enemy' : '';
    // романтика: флаг от Мозга (love/romance) сильнее порога
    const icon = r.love ? '💞' : r.romance || st === 'crush' || st === 'love' ? '❤' : { friend: '☺', enemy: '✖' }[st] || '';
    const rs = el.querySelector('.rs');
    setText(rs, icon);
    setAttr(rs, 'title', r.love ? 'Любовь' : icon === '❤' ? 'Влюблённость' : st === 'friend' ? 'Друг' : st === 'enemy' ? 'Враг' : '');
  });
  const wantsPane = createWantsPane(ctx);
  panes.wants = wantsPane.el;
  const house = createHousePane(ctx);
  panes.house = house.el;
  const optsPane = createOptionsPane(ctx);
  panes.opts = optsPane.el;

  for (const p of Object.values(panes)) body.append(p);

  const el = h('div.zh-panel', { 'data-ui': 'panel' }, fam, h('div.zh-main', {}, left, right));
  ctx.root.append(el);
  setTab('needs');

  // Полоса с центром в нуле: −100..100
  function paintCentered(fill, v) {
    v = clamp(v, -100, 100);
    setStyle(fill, 'left', v >= 0 ? '50%' : `${50 + v / 2}%`);
    setStyle(fill, 'width', `${Math.abs(v) / 2}%`);
    setStyle(fill, 'background', motiveColor(v));
  }

  // Плавающая дельта денег
  bus.on('money:changed', ({ delta }) => {
    if (!delta) return;
    moneyBox.querySelectorAll('.zh-delta').forEach(x => x.remove()); // не копим наложения
    const f = h('span.zh-delta' + (delta > 0 ? '.plus' : '.minus'), { text: (delta > 0 ? '+' : '−') + money(Math.abs(delta)) });
    moneyBox.append(f);
    f.addEventListener('animationend', () => f.remove());
  });

  function update(dt) {
    // деньги: число «докручивается» к настоящему
    const target = state.household.money;
    shown += (target - shown) * Math.min(1, dt * 8);
    if (Math.abs(target - shown) < 1) shown = target;
    setText(moneyVal, money(shown));
    toggle(moneyBox, 'low', target < 0);
    // неоплаченные счета — оплата у почтового ящика
    const bl = state.household.bills || [];
    bills.hidden = !bl.length;
    if (bl.length) {
      setText(bills, `🧾${bl.length}`);
      setAttr(bills, 'title', `Счета: ${money(bl.reduce((a, b) => a + (b.amount || 0), 0))} · оплатить у почтового ящика`);
    }
    ultra.hidden = !(state.brain?.ultra && state.mode === 'live');
    // вечеринка: шкала 0..100 → ★☆☆…★★★
    const P = state.brain?.party;
    party.hidden = !P;
    if (P) { const n = (TUNING?.PARTY?.stars || [20, 50, 90]).filter(t => (P.meter ?? 0) >= t).length; setText(party, '🎉' + '★'.repeat(n) + '☆'.repeat(3 - n)); }

    const ck = clockOf(state.time.minutes);
    setText(dow, ck.dow); setText(hm, `${ck.hh}:${ck.mi}`); setText(dayN, `д.${ck.day + 1}`);
    const frozen = state.mode !== 'live';
    toggle(clock, 'frozen', frozen || state.time.speed === 0);
    for (const b of speedBtns) toggle(b, 'on', +b.dataset.speed === state.time.speed);
    setText(spx, frozen ? '⏸' : (state.brain?.ultra ? '⚡' : '') + speedLabel(state.time.speed));
    toggle(spx, 'paused', frozen || state.time.speed === 0);
    toggle(speed, 'frozen', frozen);
    for (const [m, b] of Object.entries(modeBtns)) toggle(b, 'on', m === state.mode);

    famList(ctx.family());
    const sim = ctx.sim();
    toggle(right, 'empty', !sim);
    toggle(right, 'hide', state.mode !== 'live');
    if (tab === 'house') house.update(dt);
    if (tab === 'wants') wantsPane.update();
    if (!sim) return;
    setText(simName, sim.name);

    if (tab === 'needs') for (const k of MOTIVES) {
      const v = clamp(sim.motives?.[k] ?? 0, -100, 100);
      setStyle(needEls[k], 'width', `${((v + 100) / 2).toFixed(1)}%`);
      setStyle(needEls[k], 'background', motiveColor(v));
      toggle(needEls[k].parentNode.parentNode, 'crit', v < -50);
    }
    if (tab === 'job') {
      const kid = sim.age === 'child' || sim.age === 'baby';
      const ci = kid ? null : careerInfo(api, state, sim);
      job.box.hidden = !ci; job.none.hidden = !!ci || kid; job.school.hidden = !kid;
      if (kid) setText(job.school.querySelector('.grade'), gradeOf(sim) || '—');
      if (ci) {
        setText(job.track, ci.track); setText(job.title, ci.title || '');
        [...job.lvl.children].forEach((d, i) => toggle(d, 'on', i < sim.career.level));
        setText(job.pay, ci.pay != null ? `${money(ci.pay)}/д` : '—');
        setText(job.hrs, ci.hours ? `${ci.hours[0]}–${ci.hours[1]}` : '—');
        paintCentered(job.perf, sim.career.perf ?? 0);
      }
    }
    if (tab === 'traits') for (const k of TRAITS) {
      const v = sim.personality?.[k] ?? 0;
      [...traitEls[k].children].forEach((d, i) => toggle(d, 'on', i < Math.round(v)));
    }
    if (tab === 'skills') for (const k of SKILLS) {
      const v = clamp(sim.skills?.[k] ?? 0, 0, 10);
      [...skillEls[k].seg.children].forEach((d, i) => setStyle(d.firstChild, 'width', `${clamp(v - i, 0, 1) * 100}%`));
      setText(skillEls[k].num, Math.floor(v));
    }
    if (tab === 'rel') {
      const rows = Object.entries(sim.rel || {}).map(([id, v]) => {
        const o = typeof v === 'object' && v ? v : { v };
        const key = isNaN(+id) ? id : +id, other = whoIs(key);
        // любовь — у Мозга (isLover), влюблённость — порог отношения
        const love = !!o.love || (api.sim.isLover && other?.id != null ? api.sim.isLover(sim, other) : !!sim.love?.[id]);
        return { id: key, v: +(o.v ?? o.daily ?? o.value ?? 0), love, romance: !!o.romance };
      }).filter(r => r.id !== sim.id && !whoIs(r.id)?.dead).sort((a, b) => b.v - a.v);
      relList(rows);
      relEmpty.hidden = rows.length > 0;
    }
  }

  return { el, update, setTab, get tab() { return tab; }, syncMusic };
}
