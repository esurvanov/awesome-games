// Связка озвучки с окнами: кто говорит (рассказчик / человек / мама), разбиение текста на реплики,
// кнопка 🔊 и свёрнутый текст в режиме «только голос». Движок — js/audio/voice.js, голоса — js/content/voices.js.
'use strict';
L.def('ui/speak', () => {
const { Voice } = L.use('audio/voice');
const { VOICES } = L.use('content/voices');
const { ic } = L.use('ui/icons');
const { esc } = L.use('ui/dom');
const { personaOf } = L.use('ai/persona');

let n = 0;
const nextKey = p => p + ':' + (++n);
const reg = new Map(); // key → { segs, onFail } — чтобы 🔊 мог повторить реплику
function remember(key, segs, onFail) { reg.set(key, { segs, onFail }); if (reg.size > 400) reg.delete(reg.keys().next().value); }

// ---------- кто говорит ----------
// безымянный: свой голос по хешу (пол, возраст, настроение, акцент) — js/ai/persona.js
function stranger(w, who) {
  const car = who.carId != null && who.carId < 1e6 ? w.queue.cars.find(c => c.id === who.carId) : null;
  return personaOf(w, { kind: 'person', who, car })?.speaker || VOICES.strangers[who.f ? 'f' : 'm'][who.age >= VOICES.strangers.age ? 1 : 0];
}
function person(w, id, who) {
  if (who) return stranger(w, who);
  if (!id) return null;
  if (VOICES.speakers[id]) return id;
  const d = w.npcDefs.get(id);
  if (d) return personaOf(w, { kind: 'person', npc: id }).speaker;
  if (/^c:\d+:\d+$/.test(id)) { const [, c, s] = id.split(':'); return stranger(w, w.person(+c, +s)); }
  return null;
}
const eventSpeaker = (w, ev) => VOICES.events[ev.e.id] || person(w, ev.who ? null : ev.npc, ev.who) || 'man';
function targetSpeaker(w, tg, a) {
  if (tg.kind === 'self' || tg.kind === 'own') return (a && VOICES.actions[a.id]) || 'narrator';
  return personaOf(w, tg)?.speaker || person(w, tg.npc, tg.who) || 'man';
}

// ---------- текст → реплики: «…» после двоеточия (или в начале) — голос говорящего, остальное — рассказчик ----------
function segments(text, speaker, title) {
  const out = [], re = /«([^«»]*)»/g;
  let buf = '', last = 0, m;
  const push = (sp, t) => { t = String(t).replace(/^[\s.,;:!?—–-]+/, '').trim(); if (!/[\p{L}\d]/u.test(t)) return; const p = out[out.length - 1]; if (p && p.speaker === sp) p.text += ' ' + t; else out.push({ speaker: sp, text: t }); };
  while ((m = re.exec(text || ''))) {
    const before = text.slice(last, m.index);
    if (speaker && (/:\s*$/.test(before) || !(buf + before).replace(/[\s.,;:!?—–-]/g, ''))) {
      push('narrator', buf + before); buf = ''; push(speaker, m[1]);
    } else buf += before + m[0];
    last = re.lastIndex;
  }
  push('narrator', buf + (text || '').slice(last));
  if (title && out[0] && out[0].speaker === 'narrator') { const t = title.replace(/[«»]/g, '').trim(); out[0].text = t + (/[.!?…]$/.test(t) ? ' ' : '. ') + out[0].text; }
  return out;
}

// ---------- разметка: текст с кнопкой 🔊 или свёрнутая строка ----------
const short = t => { const w = String(t).replace(/[«»]/g, '').split(/\s+/); return w.length > 7 ? w.slice(0, 7).join(' ') + '…' : w.join(' '); };
// full — готовый HTML полного текста; text — тот же текст строкой; wave — вместо начала текста «голосовое»
function block(key, full, text, wave = false) {
  const m = Voice.mode();
  if (m === 'off' || !key) return full;
  const on = Voice.playing(key) ? ' on' : '';
  if (m === 'both') return `<div class="vt both">${full}<button class="vbtn${on}" data-vplay="${key}" title="Слушать">${ic('volume', 's')}</button></div>`;
  return `<div class="vt vo"><button class="vbtn${on}" data-vplay="${key}" title="Слушать ещё раз">${ic('volume', 's')}</button>` +
    (wave ? '<span class="wave"></span>' : `<span class="vshort">${esc(short(text))}</span>`) +
    `<button class="vbtn" data-vexp title="Текст">${ic('down', 's')}</button><div class="vfull" hidden>${full}</div></div>`;
}
function expand(key) {
  document.querySelectorAll(`[data-vplay="${key}"]`).forEach(b => {
    const vt = b.closest('.vt.vo'); if (!vt) return;
    vt.classList.add('open'); vt.querySelector('.vfull').hidden = false;
  });
}
function speak(key, segs, o = {}) {
  const onFail = () => expand(key);
  remember(key, segs, onFail);
  return Voice.say(segs, { key, onFail, ...o });
}

// ---------- точки озвучки ----------
function sayEvent(game, ev, key) { return speak(key, segments(ev.text, eventSpeaker(game.w, ev), ev.title)); }
function sayOutcome(game, ev, r, key) { return r.out ? speak(key, segments(r.out, eventSpeaker(game.w, ev))) : false; }
function sayAction(game, tg, a, res, key) { return res.out ? speak(key, segments(res.out, targetSpeaker(game.w, tg, a))) : false; }
// телефон: личные — «голосовые» (всегда, когда озвучка включена), групповые чаты — только с галочкой «читать чат вслух»
const isContact = (w, chat) => w.C.PHONE.contacts.some(c => c.id === chat);
function msgVoiced(w, m) { return m.from !== 'me' && Voice.on() && (isContact(w, m.chat) || !!Voice.opt('voiceChat')); }
const msgKey = m => 'pm:' + m.id;
function msgSegs(m) { return [{ speaker: m.chat, text: m.text }]; }
function sayPhone(game, m) {
  if (!msgVoiced(game.w, m)) return false;
  const group = !isContact(game.w, m.chat);
  return speak(msgKey(m), msgSegs(m), { interrupt: false, low: group });
}
function msgBlock(w, m, full) {
  if (!msgVoiced(w, m)) return full;
  remember(msgKey(m), msgSegs(m), () => expand(msgKey(m)));
  return block(msgKey(m), full, m.text, isContact(w, m.chat));
}

// ---------- кнопки (делегирование, один раз) и подсветка того, что звучит ----------
document.addEventListener('click', e => {
  const t = e.target.closest && e.target.closest('[data-vplay],[data-vexp]'); if (!t) return;
  e.stopPropagation();
  if (t.dataset.vexp !== undefined) { const vt = t.closest('.vt'); const f = vt.querySelector('.vfull'); f.hidden = !f.hidden; vt.classList.toggle('open', !f.hidden); return; }
  const k = t.dataset.vplay, r = reg.get(k);
  if (Voice.playing(k)) Voice.stop(); else if (r) Voice.say(r.segs, { key: k, onFail: r.onFail });
});
Voice.listen(v => document.querySelectorAll('[data-vplay]').forEach(b => b.classList.toggle('on', v.playing(b.dataset.vplay))));

return { Voice, speak, nextKey, segments, eventSpeaker, targetSpeaker, block, expand, sayEvent, sayOutcome, sayAction, sayPhone, msgBlock };
});
