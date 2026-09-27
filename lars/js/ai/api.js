// OpenAI для живого разговора: распознавание речи (/v1/audio/transcriptions), ответ человека (/v1/chat/completions
// со строгим JSON), список моделей (/v1/models). Ключ — тот же, что у озвучки (localStorage игрока), запросы идут
// прямо из браузера. Счётчик расходов за сессию и мягкий лимит. Ошибки — ApiErr с kind:
// 'nokey' | 'key' (401) | 'busy' (429) | 'net' | 'timeout' | 'http' | 'parse' | 'refusal'. Игру не блокирует.
'use strict';
L.def('ai/api', () => {
const { Settings } = L.use('core');
const { Voice } = L.use('audio/voice');

const API = 'https://api.openai.com/v1';
const DEF = { talkModel: '', sttModel: 'gpt-4o-mini-transcribe', talkCap: 80 };
const opt = k => { const v = Settings.get(k); return v == null || v === '' ? DEF[k] : v; };
// быстрые недорогие модели — в порядке предпочтения (берётся первая, что есть на ключе)
const PREFER = ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4.1-nano', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4o', 'gpt-4.1', 'gpt-5'];
const FALLBACK_MODEL = 'gpt-4o-mini';
const STT = ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1'];
const NOT_CHAT = /(audio|realtime|transcribe|tts|image|dall|whisper|embedding|moderation|search|instruct|codex|babbage|davinci|computer|deep-research|-pro\b)/i;

class ApiErr extends Error { constructor(kind, msg = '') { super(kind + (msg ? ': ' + msg : '')); this.kind = kind; this.detail = msg; } }

const isReasoning = m => /^(o\d|gpt-5)/i.test(m);
function chatModels(ids) {
  const list = ids.filter(id => /^(gpt-|o\d|chatgpt)/i.test(id) && !NOT_CHAT.test(id));
  const rank = id => { const i = PREFER.indexOf(id); return i < 0 ? 100 + (/mini|nano/.test(id) ? 0 : 50) : i; };
  return list.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

const Api = {
  usage: { chat: 0, stt: 0, sttSec: 0, tokIn: 0, tokOut: 0, fail: 0 }, // за сессию (страница)
  capOk: false,           // игрок согласился продолжить после мягкого лимита
  ids: null,              // модели на ключе (кэш сессии)
  fix: new Map(),         // модель → что пришлось убрать из запроса (reasoning_effort, temperature, …)
  subs: [],
  opt, DEF, STT, chatModels,
  key() { return Voice.opt('voiceKey') || ''; },
  ready() { return !!this.key() && !Voice.keyBad; },
  listen(f) { this.subs.push(f); },
  emit() { for (const f of this.subs) try { f(this); } catch (e) { console.warn(e); } },
  // всего платных запросов за сессию (разговор + распознавание + озвучка)
  spent() { return this.usage.chat + this.usage.stt + (Voice.stats.req || 0); },
  cap() { return Math.max(5, +opt('talkCap') || DEF.talkCap); },
  overCap() { return !this.capOk && this.spent() >= this.cap(); },

  async fetch(path, init, ms) {
    const key = this.key(); if (!key) throw new ApiErr('nokey');
    if (navigator.onLine === false) throw new ApiErr('net');
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), ms);
    let r;
    try { r = await fetch(API + path, { ...init, headers: { Authorization: 'Bearer ' + key, ...(init.headers || {}) }, signal: ac.signal }); }
    catch (e) { clearTimeout(to); this.usage.fail++; throw new ApiErr(ac.signal.aborted ? 'timeout' : 'net'); }
    clearTimeout(to);
    if (r.status === 401) { this.usage.fail++; Voice.badKey(); throw new ApiErr('key'); }
    if (r.status === 429) { this.usage.fail++; throw new ApiErr('busy'); }
    return r;
  },
  // модели на ключе → id[]; null — не удалось
  async models(force = false) {
    if (this.ids && !force) return this.ids;
    try {
      const r = await this.fetch('/models', { method: 'GET' }, 12000);
      if (!r.ok) return null;
      const j = await r.json();
      this.ids = (j.data || []).map(m => m.id).filter(Boolean);
      this.emit();
      return this.ids;
    } catch (e) { return null; }
  },
  // модель для разговора: выбранная в настройках → лучшая из доступных → запасная
  async model() {
    const m = Settings.get('talkModel'); if (m) return m;
    const ids = await this.models();
    const c = ids && chatModels(ids);
    return (c && c[0]) || FALLBACK_MODEL;
  },

  // ответ человека: messages → разобранный JSON. schema — JSON Schema ответа (strict)
  async chat(messages, schema, { model, ms = 25000, maxTokens = 400 } = {}) {
    model = model || await this.model();
    const fx = this.fix.get(model) || new Set();
    for (let attempt = 0; attempt < 4; attempt++) {
      const body = { model, messages };
      if (!fx.has('schema')) body.response_format = { type: 'json_schema', json_schema: { name: 'npc_turn', strict: true, schema } };
      else body.response_format = { type: 'json_object' };
      if (fx.has('max_tokens')) body.max_tokens = maxTokens; else body.max_completion_tokens = isReasoning(model) ? maxTokens + 1200 : maxTokens;
      if (isReasoning(model)) { if (!fx.has('reasoning_effort')) body.reasoning_effort = /^gpt-5/.test(model) ? 'minimal' : 'low'; }
      else if (!fx.has('temperature')) body.temperature = 0.85;
      this.usage.chat++; this.emit();
      const r = await this.fetch('/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, ms);
      if (r.status === 400) {
        // модель не знает параметра — убираем его и пробуем ещё раз (запоминаем для этой модели)
        const t = await r.text().catch(() => '');
        const bad = /reasoning_effort/.test(t) ? 'reasoning_effort' : /temperature/.test(t) ? 'temperature' : /max_completion_tokens/.test(t) ? 'max_tokens'
          : /response_format|json_schema/.test(t) ? 'schema' : null;
        if (bad && !fx.has(bad)) { fx.add(bad); this.fix.set(model, fx); continue; }
        this.usage.fail++; throw new ApiErr('http', '400 ' + t.slice(0, 160));
      }
      if (!r.ok) { this.usage.fail++; throw new ApiErr('http', String(r.status)); }
      let j; try { j = await r.json(); } catch (e) { this.usage.fail++; throw new ApiErr('parse', 'body'); }
      if (j.usage) { this.usage.tokIn += j.usage.prompt_tokens || 0; this.usage.tokOut += j.usage.completion_tokens || 0; }
      this.emit();
      const msg = j.choices && j.choices[0] && j.choices[0].message;
      if (msg && msg.refusal) throw new ApiErr('refusal', msg.refusal);
      const txt = msg && typeof msg.content === 'string' ? msg.content.trim() : '';
      try { const o = JSON.parse(txt.replace(/^```(?:json)?\s*|\s*```$/g, '')); if (o && typeof o === 'object') return o; } catch (e) {}
      this.usage.fail++; throw new ApiErr('parse', txt.slice(0, 80));
    }
    throw new ApiErr('http', 'retries');
  },

  // речь → текст. blob — запись, sec — длительность (для счётчика), prompt — подсказка словаря (имена)
  async transcribe(blob, { sec = 0, prompt = '', ms = 30000 } = {}) {
    const type = (blob.type || 'audio/webm').split(';')[0], ext = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' }[type] || 'webm';
    const fd = new FormData();
    fd.append('file', blob, 'speech.' + ext);
    fd.append('model', opt('sttModel'));
    fd.append('language', 'ru');
    fd.append('response_format', 'json');
    if (prompt) fd.append('prompt', prompt);
    this.usage.stt++; this.usage.sttSec += sec; this.emit();
    const r = await this.fetch('/audio/transcriptions', { method: 'POST', body: fd }, ms);
    if (!r.ok) { this.usage.fail++; throw new ApiErr('http', String(r.status)); }
    let j; try { j = await r.json(); } catch (e) { throw new ApiErr('parse', 'stt'); }
    return String(j.text || '').trim();
  },
};
return { Api, ApiErr, chatModels };
});
