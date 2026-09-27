// Кто перед игроком: имя, возраст, пол, занятие, хорошее и плохое, откуда (местный / грузин), настроение и голос.
// Одинаково для озвучки (speak.js), свободного разговора (prompt.js) и пробы голосов в настройках.
// Безымянные — детерминированно из ключа человека: один и тот же человек всегда звучит и ведёт себя одинаково.
// DOM не трогает (работает и в Node).
'use strict';
L.def('ai/persona', () => {
const { VOICES } = L.use('content/voices');
const { CONTENT } = L.use('content/index');

// строка → [0,1) (FNV-1a + перемешивание)
function h01(s, salt = '') {
  let h = 0x811c9dc5; s = String(s) + '|' + salt;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
const pick = (arr, key, salt) => arr[Math.floor(h01(key, salt) * arr.length) % arr.length];

// откуда человек: 'os' — местный (номера 15, продавцы у дороги), 'ge' — грузин едет домой, '' — из России
function originOf(key, { car = null, stall = false } = {}) {
  if (stall) return 'os';
  const regions = CONTENT.CARS.regions;
  if (car && regions[car.reg] === '15') return 'os';
  if (h01(key, 'origin') < VOICES.origins.ge.share) return 'ge';
  return '';
}

const cache = new Map(); // key → голос безымянного (один объект — чтобы реплики склеивались)
// голос безымянного: пул по полу/возрасту, подача — по хешу, акцент — по происхождению
function strangerVoice(key, f, age, origin = '', role = '') {
  const ck = key + '|' + origin + '|' + role;
  if (cache.has(ck)) return cache.get(ck);
  const P = VOICES.pool[f ? 'f' : 'm'], old = age >= VOICES.strangers.age;
  const voice = pick(old ? P.old : P.young, key, 'voice'), mood = pick(VOICES.moods, key, 'mood');
  const o = VOICES.origins[origin];
  const say = `${f ? 'Женщина' : 'Мужчина'} ${age} лет${role ? ', ' + role : ', в очереди на границе'}. ${mood.say}${o ? ' ' + o.say : ''} Русская разговорная речь.`;
  const sp = { voice, say, mood: mood.id, origin };
  cache.set(ck, sp); if (cache.size > 500) cache.delete(cache.keys().next().value);
  return sp;
}

// карточка человека по цели меню / прицела (tg: { kind, npc?, who?, car?, ped?, seller? })
function personaOf(w, tg) {
  if (!tg) return null;
  const sel = tg.seller || null;
  const npcId = (sel && sel.npc) || (tg.npc && w.npcDefs.has(tg.npc) ? tg.npc : null);
  if (npcId) {
    const d = w.npcDefs.get(npcId), st = w.npcs[npcId] || {};
    const f = /[ая]$/i.test(d.name) && !/^(Лёха|Гена)$/.test(d.name);
    return { kind: 'named', key: npcId, trustKey: npcId, id: npcId, def: d, name: d.name, age: d.age, f, job: d.job, good: d.good || [], bad: d.bad || [],
      seller: sel || (d.kind === 'seller' ? w.econ.sellers.find(o => o.npc === npcId) : null), car: w.npcCar ? w.npcCar(npcId) : null, st,
      origin: /осетин|местн/i.test(VOICES.speakers[npcId]?.say || '') ? 'os' : '', speaker: VOICES.speakers[npcId] ? npcId : strangerVoice(npcId, f, d.age) };
  }
  if (sel) { // безымянный продавец: «Бабушка», «Местные», «Кафе»…
    const key = 's:' + sel.id, granny = /Бабушк/.test(sel.name);
    const f = granny || h01(key, 'f') < 0.45, age = granny ? 68 + Math.floor(h01(key, 'a') * 12) : 24 + Math.floor(h01(key, 'a') * 40);
    w.whoNames[key] = sel.name;
    return { kind: 'stall', key, trustKey: key, name: sel.name, age, f, job: 'торгует у дороги (' + sel.name.toLowerCase() + ')', good: ['свежая выпечка', 'сдачу даёт'], bad: ['цены по ситуации'],
      seller: sel, car: null, origin: 'os', speaker: strangerVoice(key, f, age, 'os', f ? 'торгует у дороги, местная жительница' : 'торгует у дороги, местный житель') };
  }
  const who = tg.who; if (!who) return null;
  const car = tg.car || null, origin = originOf(who.key, { car });
  return { kind: 'stranger', key: who.key, trustKey: who.key, name: who.name, age: who.age, f: !!who.f, job: who.job, good: [who.good], bad: [who.bad],
    seller: null, car, ped: tg.ped || who.ped || null, origin, speaker: strangerVoice(who.key, !!who.f, who.age, origin) };
}

// голос с эмоцией текущей реплики (свободный разговор)
function withEmotion(speaker, emotion) {
  const e = VOICES.emotions[emotion]; if (!e) return speaker;
  const base = typeof speaker === 'object' ? speaker : VOICES.speakers[speaker]; if (!base) return speaker;
  const ck = (typeof speaker === 'object' ? speaker.voice + speaker.say : speaker) + '|' + emotion;
  if (cache.has(ck)) return cache.get(ck);
  const sp = { voice: base.voice, say: base.say + ' Сейчас: ' + e + '.' };
  cache.set(ck, sp); return sp;
}
return { h01, originOf, strangerVoice, personaOf, withEmotion };
});
