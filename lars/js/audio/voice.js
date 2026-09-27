// Озвучка через OpenAI (по желанию; без ключа игра полностью текстовая). POST /v1/audio/speech прямо из браузера,
// ключ — только в localStorage игрока. Очередь: одна реплика за раз, новая карточка перебивает старую, Esc — тишина.
// Кэш: память + IndexedDB (ключ — хеш модели, голоса, подсказки и текста) — одну и ту же строку не оплачиваем дважды.
// Ошибки мягкие: 401 — «неверный ключ» один раз и выключаемся, 429 — пауза, нет сети — просто остаётся текст.
'use strict';
L.def('audio/voice', () => {
const { Settings } = L.use('core');
const { VOICES } = L.use('content/voices');

const API = 'https://api.openai.com/v1';
const DEF = { voiceMode: 'off', voiceKey: '', voiceModel: 'gpt-4o-mini-tts', voiceVol: 0.9, voiceSpeed: 1, voiceChat: 0 };
const opt = k => { const v = Settings.get(k); return v == null ? DEF[k] : v; };

// ---------- текст для синтеза ----------
function clean(t) {
  return String(t || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\$\s?(\d[\d\s]*)/g, '$1 долларов').replace(/\s?₽/g, ' рублей').replace(/\s?₾/g, ' лари')
    .replace(/[«»]/g, '').replace(/\s+/g, ' ').trim();
}
// ---------- хеш (cyrb53 ×2) — ключ кэша ----------
function h53(s, seed = 0) {
  let a = 0xdeadbeef ^ seed, b = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (b >>> 0).toString(16).padStart(8, '0') + (a >>> 0).toString(16).padStart(8, '0');
}

// ---------- IndexedDB (по возможности; любая ошибка = «нет в кэше») ----------
let dbp = null;
function db() {
  if (dbp) return dbp;
  return (dbp = new Promise(res => {
    const t = setTimeout(() => res(null), 2000);
    try {
      const r = indexedDB.open('lars-voice', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('clips');
      r.onsuccess = () => { clearTimeout(t); res(r.result); };
      r.onerror = r.onblocked = () => { clearTimeout(t); res(null); };
    } catch (e) { clearTimeout(t); res(null); }
  }));
}
const idb = (mode, f) => db().then(d => d && new Promise(res => {
  try { const q = f(d.transaction('clips', mode).objectStore('clips')); q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null); }
  catch (e) { res(null); }
}));
const idbGet = k => idb('readonly', s => s.get(k));
const idbPut = (k, buf) => idb('readwrite', s => s.put(buf, k));

// ---------- голос для говорящего ----------
function resolve(speaker, model) {
  const M = VOICES.models[model] || VOICES.models['gpt-4o-mini-tts'];
  // speaker — id из VOICES.speakers или готовый { voice, say } (безымянные люди, эмоция ответа — js/ai/persona.js)
  const sp = speaker && typeof speaker === 'object' && speaker.voice ? speaker : VOICES.speakers[speaker] || VOICES.speakers.narrator;
  let voice = sp.voice;
  if (!M.voices.includes(voice)) voice = VOICES.fallback[voice] || M.voices[0];
  return { voice, instructions: M.instructions ? sp.say : '', sendSpeed: !!M.speed };
}

class Err extends Error { constructor(kind) { super(kind); this.kind = kind; } }

const Voice = {
  stats: { req: 0, hit: 0, played: 0, chars: 0, bodies: [] }, // для тестов и отладки
  toast: t => console.warn(t.text),
  keyBad: false, verified: '', backoff: 0, backoffMs: 0,
  mem: new Map(), inflight: new Map(),
  q: [], cur: null, gen: 0, busy: false, subs: [],
  A: null, _end: null, _wake: null,

  opt, clean, resolve,
  // режим для окон: 'off' | 'both' | 'voice' (без ключа — всегда 'off')
  mode() { const m = opt('voiceMode'); return m === 'off' || !opt('voiceKey') || this.keyBad ? 'off' : m; },
  on() { return this.mode() !== 'off'; },
  set(k, v) { Settings.set(k, v); if (k === 'voiceKey') { this.keyBad = false; this.verified = ''; this.backoff = 0; } if (k === 'voiceVol' && this.A) this.A.volume = +v; this.emit(); },
  listen(f) { this.subs.push(f); },
  emit() { for (const f of this.subs) try { f(this); } catch (e) { console.warn(e); } },
  playing(key) { return !!this.cur && this.cur.key === key; },

  // segs — [{ speaker, text }]; o — { key, interrupt = true, low (только если тихо), onFail }
  say(segs, o = {}) {
    if (!this.on()) return false;
    segs = (segs || []).map(s => ({ speaker: s.speaker || 'narrator', text: clean(s.text) })).filter(s => /[\p{L}\d]/u.test(s.text));
    if (!segs.length) return false;
    const u = { key: o.key || 'u' + Math.random().toString(36).slice(2), segs, onFail: o.onFail };
    if (o.low && (this.cur || this.q.length)) return false;
    if (o.interrupt !== false) { this.q.length = 0; this.cut(); }
    else if (this.q.length >= 4) return false;
    this.q.push(u); this.pump();
    return true;
  },
  toggle(key, segs, onFail) { if (this.playing(key)) { this.stop(); return false; } return this.say(segs, { key, onFail }); },
  stop() { this.q.length = 0; this.cut(); this.emit(); },
  cut() { this.gen++; this.cur = null; if (this._wake) { this._wake(null); this._wake = null; } if (this.A) { try { this.A.pause(); } catch (e) {} } if (this._end) this._end(false); },

  async pump() {
    if (this.busy) return; this.busy = true;
    try {
      while (this.q.length) {
        const u = this.q.shift(), g = this.gen; this.cur = u; this.emit();
        const cutP = new Promise(r => this._wake = r); // перебили — не ждём чужой запрос
        const ps = u.segs.map(s => this.clip(s)); ps.forEach(p => p.catch(() => {}));
        let failed = false;
        for (const p of ps) {
          let blob = null; try { blob = await Promise.race([p, cutP]); } catch (e) { failed = true; break; }
          if (g !== this.gen) break;
          const ok = await this.play(blob);
          if (g !== this.gen) break;
          if (!ok) { failed = true; break; }
        }
        if (g === this.gen) { this.cur = null; if (failed && u.onFail) u.onFail(); }
        this.emit();
      }
    } finally { this.busy = false; }
  },

  play(blob) {
    return new Promise(res => {
      const A = this.A ||= new Audio();
      const url = URL.createObjectURL(blob);
      let done = false, to = 0;
      const fin = ok => { if (done) return; done = true; clearTimeout(to); this._end = null; A.onended = A.onerror = null; setTimeout(() => URL.revokeObjectURL(url), 1000); res(ok); };
      this._end = fin;
      A.onended = () => { this.stats.played++; fin(true); }; A.onerror = () => fin(false);
      A.src = url; A.volume = Math.max(0, Math.min(1, +opt('voiceVol')));
      const rate = resolve('narrator', opt('voiceModel')).sendSpeed ? 1 : +opt('voiceSpeed') || 1;
      A.defaultPlaybackRate = A.playbackRate = rate;
      // страховка: если «ended» не придёт — по длине клипа (или 30 с)
      A.onloadedmetadata = () => { if (isFinite(A.duration)) { clearTimeout(to); to = setTimeout(() => fin(true), (A.duration / rate) * 1000 + 1500); } };
      to = setTimeout(() => fin(true), 30000);
      const p = A.play(); if (p && p.catch) p.catch(() => fin(false)); // автозапуск запрещён — остаётся текст
    });
  },

  // аудио одной реплики: память → IndexedDB → OpenAI
  async clip(seg) {
    const model = opt('voiceModel'), r = resolve(seg.speaker, model), speed = +opt('voiceSpeed') || 1;
    const body = { model, voice: r.voice, input: seg.text, response_format: 'mp3' };
    if (r.instructions) body.instructions = r.instructions;
    if (r.sendSpeed && speed !== 1) body.speed = speed;
    const sig = [model, r.voice, r.instructions, body.speed || 1, seg.text].join('\u0001');
    const k = 'v1:' + h53(sig) + h53(sig, 7) + ':' + seg.text.length;
    if (this.mem.has(k)) { this.stats.hit++; return this.mem.get(k); }
    if (this.inflight.has(k)) return this.inflight.get(k);
    const job = (async () => {
      const buf = await idbGet(k);
      if (buf) { this.stats.hit++; return this.keep(k, new Blob([buf], { type: 'audio/mpeg' })); }
      if (this.keyBad) throw new Err('key');
      if (Date.now() < this.backoff) throw new Err('busy');
      if (navigator.onLine === false) throw new Err('net');
      this.stats.req++; this.stats.chars += seg.text.length; this.stats.bodies.push(body); if (this.stats.bodies.length > 50) this.stats.bodies.shift();
      let res;
      try {
        res = await fetch(API + '/audio/speech', { method: 'POST', headers: { Authorization: 'Bearer ' + opt('voiceKey'), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } catch (e) { this.netFail(); throw new Err('net'); }
      if (res.status === 401) { this.badKey(); throw new Err('key'); }
      if (res.status === 429) { this.limit(res); throw new Err('busy'); }
      if (!res.ok) throw new Err('http ' + res.status);
      const ab = await res.arrayBuffer();
      this.backoffMs = 0;
      idbPut(k, ab);
      return this.keep(k, new Blob([ab], { type: 'audio/mpeg' }));
    })();
    this.inflight.set(k, job);
    try { return await job; } finally { this.inflight.delete(k); }
  },
  keep(k, blob) { this.mem.set(k, blob); if (this.mem.size > 300) this.mem.delete(this.mem.keys().next().value); return blob; },
  badKey() { if (this.keyBad) return; this.keyBad = true; this.stop(); this.toast({ icon: 'key', text: 'Озвучка: неверный ключ', tone: -1 }); this.emit(); },
  limit(res) {
    const ra = +(res.headers.get('retry-after') || 0);
    this.backoffMs = Math.min(120000, Math.max(ra * 1000, this.backoffMs ? this.backoffMs * 2 : 8000));
    this.backoff = Date.now() + this.backoffMs;
    this.toast({ icon: 'clock', text: 'Озвучка: лимит OpenAI, пауза ' + Math.round(this.backoffMs / 1000) + ' с', tone: -1 });
  },
  // сетевая ошибка: офлайн — молча; но ответ 401 без CORS-заголовков тоже выглядит как сетевая ошибка → проверим ключ
  netFail() {
    const key = opt('voiceKey'); if (!key || this.verified === key) return;
    this.verified = key;
    this.check(key).then(r => { if (r === 'bad' && opt('voiceKey') === key) this.badKey(); });
  },
  // проверка ключа: список моделей — бесплатно. → 'ok' | 'bad' | 'net'
  async check(key = opt('voiceKey')) {
    if (!key) return 'bad';
    try {
      const r = await fetch(API + '/models', { headers: { Authorization: 'Bearer ' + key } });
      if (r.ok) { if (key === opt('voiceKey')) { this.keyBad = false; this.verified = key; this.emit(); } return 'ok'; }
      return r.status === 401 || r.status === 403 ? 'bad' : 'net';
    } catch (e) { return 'net'; }
  },
};
return { Voice };
});
