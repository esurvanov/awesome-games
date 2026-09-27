// «Создать семью» (CAS): 1–8 жителей — имя, пол, возраст, кожа/волосы/одежда, вариант тела,
// 25 очков характера (5 черт) + знак зодиака, устремление. Превью — SVG-портрет
// (или R.preview(canvas, look), если Рендер его даст). Готово → семья в state.hood (Мир: addFamily).
import { h, esc, toggle, setText, clamp } from './dom.js';
import { ico, TRAIT_UI } from './icons.js';
import { portraitSvg } from './portrait.js';
import { MONEY } from '../core/tuning.js';
import { ZODIAC, zodiacOf as zodiacKey, SKIN, HAIR } from '../../data/hood.js';
import { OUTFITS, HAIR as HAIR_STYLES, ACCESSORIES, BODY } from '../render/manifest.js';

// Одежда, причёски, аксессуары, фигура — ключи Ассетов (js/render/manifest.js):
// look.outfit, look.hairStyle, look.acc[] (по одному на слот), look.shape ('slim'|'fit'|'heavy'|null — обычная)
const OUTFIT_IC = { casual: '👕', formal: '🤵', sport: '🏃', sleep: '😴', swim: '🩱', dress: '👗' };
const SHAPE_UI = [[null, '🧍', 'обычная'], ['slim', '🥢', 'стройная'], ['fit', '💪', 'спортивная'], ['heavy', '🍩', 'полная']].filter(([k]) => k == null || BODY?.[k]);
const outfitsFor = sex => Object.entries(OUTFITS?.[sex] || {}).filter(([k]) => !k.startsWith('work_'));
const hairsFor = sex => Object.entries(HAIR_STYLES || {}).filter(([, v]) => v.gender === 'u' || v.gender === sex);
const accFor = sex => Object.entries(ACCESSORIES || {}).filter(([, v]) => v.gender === sex);

const MAX_MEMBERS = 8;
const POINTS = 25; // ✅ TS1: 25 очков характера на жителя
const TRAITS = ['neat', 'outgoing', 'active', 'playful', 'nice'];
// палитры кожи и волос — у Писателя (data/hood.js), одежда — своя
const SKINS = SKIN;
const HAIRS = Object.values(HAIR);
const TOPS = ['#4a7fc1', '#6aa35a', '#c1564a', '#e0a33a', '#8e6cc0', '#2f8f8a', '#d27aa6', '#e8e4dc', '#3a3f4a', '#f2c94c'];
const BOTTOMS = ['#2c3e5c', '#3a3a3a', '#6b5a45', '#8b8f96', '#1f4d3a', '#5c2f3a', '#c9b79c', '#243447'];
// варианты тела: модели Ассетов (CHARACTERS/CHILDREN в js/render/manifest.js)
const MODELS = {
  m: { adult: [['male', '🧑'], ['male_b', '🧔'], ['elder', '👴']], child: [['child_m', '👦']] },
  f: { adult: [['female', '👩'], ['female_b', '👗'], ['elder_f', '👵']], child: [['child_f', '👧']] },
};
// Устремления (TS2): ключи — предложение Мозгу (data/wants.js), иконки свои
const ASPIRATIONS = [['romance', '💘', 'Романтика'], ['family', '👪', 'Семья'], ['fortune', '💰', 'Богатство'], ['popularity', '🌟', 'Популярность'], ['knowledge', '🎓', 'Знания'], ['pleasure', '🎉', 'Удовольствия']];
// Знак зодиака — ближайший пресет Писателя (data/hood.js), только для значка
export function zodiacOf(p) { const k = zodiacKey({ neat: 0, outgoing: 0, active: 0, playful: 0, nice: 0, ...p }); return { key: k, name: ZODIAC[k]?.name || '', sign: ZODIAC[k]?.icon || '✨' }; }
export const pointsLeft = p => POINTS - TRAITS.reduce((a, k) => a + (p[k] || 0), 0);

let seq = 0;
function newMember(i = 0) {
  const sex = i % 2 ? 'f' : 'm';
  return {
    key: ++seq, name: '', sex, age: 'adult', model: MODELS[sex].adult[0][0],
    skin: SKINS[(i + 1) % SKINS.length], hair: HAIRS[(i * 3 + 2) % HAIRS.length], top: TOPS[i % TOPS.length], bottom: BOTTOMS[i % BOTTOMS.length],
    personality: { neat: 5, outgoing: 5, active: 5, playful: 5, nice: 5 }, aspiration: ASPIRATIONS[i % ASPIRATIONS.length][0],
    outfit: 'casual', hairStyle: hairsFor(sex)[i % Math.max(1, hairsFor(sex).length)]?.[0] ?? null, acc: [], shape: null,
  };
}
// member → simSpec (формат addSim + zodiac, aspiration)
export function toSpec(m) {
  return {
    name: m.name.trim(), gender: m.sex, age: m.age, aspiration: m.age === 'child' ? 'grow_up' : m.aspiration, zodiac: zodiacOf(m.personality).key,
    personality: { ...m.personality },
    look: { gender: m.sex === 'f' ? 'female' : 'male', body: m.sex === 'f' ? 'female' : 'male', model: m.model, variant: m.model, skin: m.skin, hair: m.hair, top: m.top, shirt: m.top, bottom: m.bottom, pants: m.bottom,
      outfit: m.outfit, hairStyle: m.hairStyle, acc: [...m.acc], shape: m.shape },
  };
}

export function createCas(ctx) {
  const { state, bus, api } = ctx;
  let fam = null, cur = 0;

  const famName = h('input.cs-fam', { type: 'text', placeholder: 'Фамилия', maxlength: 24, 'aria-label': 'Фамилия' });
  const members = h('div.cs-members');
  const preview = h('div.cs-preview');
  const name = h('input.cs-name', { type: 'text', placeholder: 'Имя', maxlength: 20, 'aria-label': 'Имя' });
  const rows = {};
  const row = (id, icon, ...kids) => (rows[id] = h('div.cs-row', { 'data-row': id }, h('span.cs-ri', { html: icon }), ...kids));
  const sw = (list, key) => h('div.cs-sw', {}, list.map(c => h('button.cs-dot', { style: { background: c }, 'data-v': c, title: c, onclick: () => set(key, c) })));
  const pts = h('span.cs-pts'), zod = h('span.cs-zod');
  const traitRows = TRAITS.map(k => {
    const dots = h('span.cs-dots', {}, Array.from({ length: 10 }, (_, i) => h('button.cs-tdot', { 'data-i': i + 1, onclick: () => setTrait(k, i + 1) })));
    return h('div.cs-trait', { 'data-trait': k, title: TRAIT_UI[k][0] }, h('span.ni', { html: ico(TRAIT_UI[k][1], 15) }), h('span.nl', { text: TRAIT_UI[k][0] }),
      h('button.zh-btn.cs-pm', { text: '−', onclick: () => setTrait(k, (cm().personality[k] || 0) - 1) }), dots,
      h('button.zh-btn.cs-pm', { text: '+', onclick: () => setTrait(k, (cm().personality[k] || 0) + 1) }));
  });
  const editor = h('div.cs-edit', {},
    row('name', '✏️', name),
    row('sex', '⚥', h('div.cs-seg', {}, [['m', '♂'], ['f', '♀']].map(([v, t]) => h('button.zh-btn.cs-opt', { 'data-v': v, text: t, onclick: () => setSex(v) }))),
      h('div.cs-seg', {}, [['adult', '🧑'], ['child', '🧒']].map(([v, t]) => h('button.zh-btn.cs-opt', { 'data-v': v, text: t, title: v === 'adult' ? 'Взрослый' : 'Ребёнок', onclick: () => setAge(v) })))),
    row('model', '🧍', h('div.cs-seg.cs-models')),
    row('shape', '⚖️', h('div.cs-seg', {}, SHAPE_UI.map(([v, ic, t]) => h('button.zh-btn.cs-opt', { 'data-v': String(v), title: t, text: ic, onclick: () => set('shape', v) })))),
    row('outfit', '👔', h('div.cs-chips.cs-outfit')),
    row('hstyle', '✂️', h('div.cs-chips.cs-hstyle')),
    row('acc', '🎩', h('div.cs-chips.cs-acc')),
    row('skin', '✋', sw(SKINS, 'skin')),
    row('hair', '💇', sw(HAIRS, 'hair')),
    row('top', '👕', sw(TOPS, 'top')),
    row('bottom', '👖', sw(BOTTOMS, 'bottom')),
    h('div.cs-traits', {}, h('div.cs-th', {}, h('span', { html: ico('trait', 14) }), pts, zod), traitRows),
    row('asp', '🎯', h('div.cs-seg.cs-asp', {}, ASPIRATIONS.map(([v, ic, t]) => h('button.zh-btn.cs-opt', { 'data-v': v, title: t, html: `${ic}`, onclick: () => set('aspiration', v) })))),
  );
  const done = h('button.zh-btn.cs-done', { 'data-act': 'done', html: '✅ Готово', onclick: () => finish() });
  const why = h('span.cs-why'); // причина, почему «Готово» закрыто (Мир: familyError)
  const el = h('div.zh-modal.zh-cas', { 'data-ui': 'cas', hidden: true },
    h('div.md-card.cas', {},
      h('div.md-head', {}, h('span', { text: '👪' }), famName, h('span.cs-money', { text: '' }), why, done, h('button.zh-btn.md-x', { html: ico('close', 14), onclick: () => close() })),
      h('div.cs-body', {}, members, preview, editor)));
  ctx.root.append(el);
  name.addEventListener('input', () => { cm().name = name.value; sync(); });

  const cm = () => fam.members[cur];
  function set(key, v) { cm()[key] = v; ctx.audio.sfx('click'); sync(); }
  function setSex(v) {
    const m = cm(); m.sex = v; m.model = MODELS[v][m.age][0][0];
    // причёска/аксессуары другого пола — сбросить на подходящие
    if (!hairsFor(v).some(([k]) => k === m.hairStyle)) m.hairStyle = hairsFor(v)[0]?.[0] ?? null;
    m.acc = m.acc.filter(a => ACCESSORIES[a]?.gender === v);
    if (!outfitsFor(v).some(([k]) => k === m.outfit)) m.outfit = 'casual';
    ctx.audio.sfx('click'); sync();
  }
  // аксессуар: по одному на слот (глаза, голова, лицо, уши); повторный клик — снять
  function toggleAcc(k) {
    const m = cm(), slot = ACCESSORIES[k]?.slot;
    m.acc = m.acc.includes(k) ? m.acc.filter(a => a !== k) : [...m.acc.filter(a => ACCESSORIES[a]?.slot !== slot), k];
    ctx.audio.sfx('click'); sync();
  }
  function setAge(v) { const m = cm(); m.age = v; m.model = MODELS[m.sex][v][0][0]; ctx.audio.sfx('click'); sync(); }
  function setTrait(k, v) {
    const p = cm().personality, left = pointsLeft(p) + (p[k] || 0);
    p[k] = clamp(v, 0, Math.min(10, left));
    ctx.audio.sfx('tab'); sync();
  }

  function drawMembers() {
    members.innerHTML = '';
    fam.members.forEach((m, i) => {
      const b = h('button.cs-mem', { 'data-i': i, title: m.name || 'без имени', onclick: () => { cur = i; sync(); } });
      b.innerHTML = portraitSvg(lookSim(m), 44) + `<i>${esc(m.name || '…')}</i>` + (fam.members.length > 1 ? '<span class="cs-del" title="Убрать">✕</span>' : '');
      b.querySelector('.cs-del')?.addEventListener('click', e => { e.stopPropagation(); fam.members.splice(i, 1); cur = Math.min(cur, fam.members.length - 1); sync(); });
      toggle(b, 'on', i === cur);
      members.append(b);
    });
    if (fam.members.length < MAX_MEMBERS) members.append(h('button.cs-mem.add', { 'data-act': 'add', title: 'Добавить жителя', text: '➕', onclick: () => { fam.members.push(newMember(fam.members.length)); cur = fam.members.length - 1; ctx.audio.sfx('select'); sync(); } }));
  }
  const lookSim = m => ({ id: m.key, name: m.name, look: toSpec(m).look });

  function sync() {
    const m = cm();
    if (document.activeElement !== name) name.value = m.name;
    drawMembers();
    // превью: 3D от Рендера (previewSim), если есть, иначе крупный портрет
    const pv = api.render.previewSim || api.render.preview;
    if (pv) { if (!preview.firstChild || preview.firstChild.tagName !== 'CANVAS') { preview.innerHTML = ''; preview.append(h('canvas.cs-cv', { width: 320, height: 420 })); } pv.call(api.render, preview.firstChild, { ...toSpec(m).look, age: m.age }); }
    else preview.innerHTML = portraitSvg(lookSim(m), 200) + `<div class="cs-badges"><span>${m.age === 'child' ? '🧒' : m.sex === 'f' ? '♀' : '♂'}</span><span>${zodiacOf(m.personality).sign}</span><span>${ASPIRATIONS.find(a => a[0] === m.aspiration)?.[1] || ''}</span></div>`;
    for (const b of rows.sex.querySelectorAll('.cs-opt')) toggle(b, 'on', b.dataset.v === m.sex || b.dataset.v === m.age);
    const ms = rows.model.querySelector('.cs-models'); ms.innerHTML = '';
    for (const [v, ic] of MODELS[m.sex][m.age]) { const b = h('button.zh-btn.cs-opt', { 'data-v': v, text: ic, onclick: () => set('model', v) }); toggle(b, 'on', v === m.model); ms.append(b); }
    for (const k of ['skin', 'hair', 'top', 'bottom']) for (const d of rows[k].querySelectorAll('.cs-dot')) toggle(d, 'on', d.dataset.v === m[k]);
    for (const b of rows.shape.querySelectorAll('.cs-opt')) toggle(b, 'on', b.dataset.v === String(m.shape));
    // списки зависят от пола — перестраиваем только эти чипы (действие игрока, не таймер)
    const chips = (box, list, isOn, onPick, lab = v => v.label) => {
      box.replaceChildren(...list.map(([k, v]) => { const b = h('button.ct-chip', { 'data-v': k, html: lab(v, k), onclick: () => onPick(k) }); toggle(b, 'on', isOn(k)); return b; }));
    };
    chips(rows.outfit.querySelector('.cs-outfit'), outfitsFor(m.sex), k => k === m.outfit, k => set('outfit', k), (v, k) => `${OUTFIT_IC[k] || '👕'} ${esc(v.label)}`);
    chips(rows.hstyle.querySelector('.cs-hstyle'), hairsFor(m.sex), k => k === m.hairStyle, k => set('hairStyle', k), v => esc(v.label));
    chips(rows.acc.querySelector('.cs-acc'), accFor(m.sex), k => m.acc.includes(k), toggleAcc, v => esc(v.label));
    const left = pointsLeft(m.personality);
    setText(pts, `осталось ${left}`); toggle(pts, 'zero', left === 0);
    const z = zodiacOf(m.personality); setText(zod, `${z.sign} ${z.name}`);
    traitRows.forEach((r, i) => { const v = m.personality[TRAITS[i]] || 0; r.querySelectorAll('.cs-tdot').forEach((d, j) => toggle(d, 'on', j < v)); });
    rows.asp.hidden = m.age === 'child';
    for (const b of rows.asp.querySelectorAll('.cs-opt')) toggle(b, 'on', b.dataset.v === m.aspiration);
    const ok = valid();
    done.disabled = !ok.ok; done.title = ok.reason || 'Создать семью';
    setText(why, ok.ok ? '' : `⚠️ ${ok.reason}`);
    setText(el.querySelector('.cs-money'), `💰 ${fam.funds}`);
  }
  function valid() {
    // правила семьи — у Мира (familyError); свои — запасные
    if (api.world.familyError) { const r = api.world.familyError(specNow()); return r ? { ok: false, reason: r } : { ok: true }; }
    if (!famName.value.trim()) return { ok: false, reason: 'Нужна фамилия' };
    if (!fam.members.some(m => m.age === 'adult')) return { ok: false, reason: 'Нужен хотя бы один взрослый' };
    if (fam.members.some(m => !m.name.trim())) return { ok: false, reason: 'У всех должно быть имя' };
    return { ok: true };
  }
  famName.addEventListener('input', () => sync());

  function open() {
    fam = { funds: MONEY.start, members: [newMember(0)] };
    cur = 0; famName.value = '';
    el.hidden = false; sync();
    famName.focus();
    ctx.audio.sfx('open');
  }
  function close() { el.hidden = true; }
  const specNow = () => ({ name: famName.value.trim(), funds: fam.funds, bio: '', icon: '👪', lotId: null, members: fam.members.map(toSpec), simIds: [] });
  function finish() {
    const v = valid();
    if (!v.ok) { ctx.audio.sfx('error'); ctx.toast(v.reason, '✏️'); return; }
    const spec = specNow();
    let id = api.world.addFamily?.(state, bus, spec);
    if (id == null && api.world.addFamily) { ctx.audio.sfx('error'); ctx.toast(api.world.familyError?.(spec) || 'Не получилось', '✏️'); return; }
    if (id == null && state.hood) { // запасной путь для стенда без Мира
      id = Math.max(0, ...state.hood.families.map(f => +f.id || 0)) + 1;
      state.hood.families.push({ id, ...spec });
    }
    close();
    ctx.audio.sfx('celebrate');
    ctx.toast(`Семья ${spec.name} готова — выбери свободный 🏠`, '👪');
    ctx.openHood?.();
    return id;
  }
  return { open, close, get isOpen() { return !el.hidden; }, finish };
}
