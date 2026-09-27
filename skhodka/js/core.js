// Ядро «Сходки»: утилиты, RNG с сидом, шина событий, фиксированный шаг, настройки.
// Ничего не знает ни о зале, ни о людях. Работает и в браузере, и в Node (тесты симуляции).
'use strict';
L.def('core', () => {

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const $ = id => document.getElementById(id);

// ---------- RNG: mulberry32 ----------
class RNG {
  constructor(seed = 1) { this.s = seed >>> 0 || 1; }
  next() {
    let t = (this.s = (this.s + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + this.next() * (b - a); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
  // взвешенный выбор: items[i] с весом w(items[i])
  weighted(items, w = it => it.weight ?? 1) {
    let sum = 0; for (const it of items) sum += Math.max(0, w(it));
    if (sum <= 0) return null;
    let r = this.next() * sum;
    for (const it of items) { r -= Math.max(0, w(it)); if (r <= 0) return it; }
    return items[items.length - 1];
  }
}
// детерминированный хеш → [0,1)
function hash01(a, b = 0) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------- шина событий ----------
class Bus {
  constructor() { this.m = new Map(); }
  on(type, f) { if (!this.m.has(type)) this.m.set(type, []); this.m.get(type).push(f); return () => this.off(type, f); }
  off(type, f) { const a = this.m.get(type); if (a) { const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); } }
  emit(type, data) { const a = this.m.get(type); if (a) for (const f of a.slice()) f(data); const s = this.m.get('*'); if (s) for (const f of s.slice()) f(type, data); }
}

// ---------- фиксированный шаг ----------
// update(dt) — фиксированными шагами step реальных секунд × scale(); render(alpha, dtReal) — раз в кадр.
class Loop {
  constructor({ step = 1 / 30, maxSteps = 8, update, render, scale = () => 1 }) {
    Object.assign(this, { step, maxSteps, update, render, scale });
    this.acc = 0; this.last = 0; this.running = false; this.frame = this.frame.bind(this);
    this.fps = 60; this.ms = 0;
  }
  start() { if (this.running) return; this.running = true; this.last = performance.now(); requestAnimationFrame(this.frame); }
  stop() { this.running = false; }
  frame(now) {
    if (!this.running) return;
    const dtReal = Math.max(0, Math.min(0.1, (now - this.last) / 1000)); this.last = now;
    const a = performance.now();
    this.acc += dtReal * this.scale();
    let n = 0;
    while (this.acc >= this.step && n < this.maxSteps) { this.update(this.step); this.acc -= this.step; n++; }
    if (n >= this.maxSteps) this.acc = Math.min(this.acc, this.step);
    this.render(this.acc / this.step, dtReal);
    this.ms = this.ms * 0.9 + (performance.now() - a) * 0.1;
    if (dtReal > 0) this.fps = this.fps * 0.9 + (1 / dtReal) * 0.1;
    requestAnimationFrame(this.frame);
  }
}

// ---------- настройки (localStorage может быть недоступен) ----------
const Settings = (() => {
  const KEY = 'skhodka-settings', DEF = { quality: 'auto', sound: 1 };
  let v = { ...DEF };
  try { Object.assign(v, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  return { get: k => v[k], set(k, x) { v[k] = x; try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} } };
})();

// «{name} сказал» → подстановка
function tpl(s, vars) { return s ? s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '') : ''; }
// часы игры (19.5 → «19:30»; 24.25 → «00:15»)
function hhmm(h) { const m = Math.floor(h * 60 + 1e-6); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }

return { clamp, lerp, smooth, $, RNG, hash01, Bus, Loop, Settings, tpl, hhmm };
});
