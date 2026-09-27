// Ядро «Ларса»: утилиты, RNG с сидом, шина событий, мировые часы и календарь, фиксированный шаг, сохранение.
// Ничего не знает о сюжете: календарь и правила приходят из js/content/calendar.js.
'use strict';
L.def('core', () => {

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const $ = id => document.getElementById(id);

// ---------- RNG: mulberry32, состояние — одно 32-битное число (сохраняется) ----------
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
  // взвешенный выбор: items[i] с весом w(items[i])
  weighted(items, w) {
    let sum = 0; for (const it of items) sum += Math.max(0, w(it));
    if (sum <= 0) return null;
    let r = this.next() * sum;
    for (const it of items) { r -= Math.max(0, w(it)); if (r <= 0) return it; }
    return items[items.length - 1];
  }
}
// детерминированный хеш → [0,1) (для «характера» людей без хранения)
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
  emit(type, data) { const a = this.m.get(type); if (a) for (const f of a.slice()) f(data); }
}

// ---------- мировые часы ----------
// t — игровые секунды от calendar.start (полночь первого дня). Масштаб: TIME.realToGame игровых секунд
// на реальную секунду при ×1 (60 → 1 игровой час ≈ 1 реальная минута).
const HOUR = 3600, DAY = 86400;
class Clock {
  constructor(cal) {
    this.cal = cal;
    this.t = 0;
    const [y, m, d] = cal.start.split('-').map(Number);
    this.y = y; this.m = m; this.d = d;
  }
  get dayIndex() { return Math.floor(this.t / DAY); }
  get hour() { return (this.t % DAY) / HOUR; }
  // календарный день (данные) для текущего момента; за пределами — последний
  get day() { const a = this.cal.days; return a[clamp(this.dayIndex, 0, a.length - 1)]; }
  dayAt(t) { const a = this.cal.days; return a[clamp(Math.floor(t / DAY), 0, a.length - 1)]; }
  date(t = this.t) { const dt = new Date(Date.UTC(this.y, this.m - 1, this.d) + Math.floor(t / DAY) * 864e5); return { d: dt.getUTCDate(), m: dt.getUTCMonth() + 1, y: dt.getUTCFullYear(), wd: dt.getUTCDay() }; }
  label(t = this.t) {
    const { d, m } = this.date(t), h = Math.floor((t % DAY) / HOUR), mi = Math.floor((t % HOUR) / 60);
    return { date: `${d} ${MONTHS[m - 1]}`, time: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`, wd: WD[this.date(t).wd] };
  }
  get over() { return this.t >= this.cal.days.length * DAY; }
  // момент из строки «YYYY-MM-DD HH:MM» → t
  parse(s) {
    const [ds, hs = '0:0'] = s.split(' ');
    const [y, m, d] = ds.split('-').map(Number), [h, mi] = hs.split(':').map(Number);
    return (Date.UTC(y, m - 1, d) - Date.UTC(this.y, this.m - 1, this.d)) / 1000 + h * HOUR + (mi || 0) * 60;
  }
}
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

// ---------- фиксированный шаг ----------
// Один rAF-цикл. update(dtGame) вызывается фиксированными шагами STEP игровых секунд;
// render(alpha, dtReal) — раз в кадр. scale() — текущий множитель времени (0 = пауза).
class Loop {
  constructor({ step, realToGame, maxSteps, update, render, scale }) {
    Object.assign(this, { step, realToGame, maxSteps, update, render, scale });
    this.acc = 0; this.last = 0; this.running = false; this.frame = this.frame.bind(this);
    this.fps = 60; this.ms = 0; this.simMs = 0; this.steps = 0;
  }
  start() { if (this.running) return; this.running = true; this.last = performance.now(); requestAnimationFrame(this.frame); }
  stop() { this.running = false; }
  frame(now) {
    if (!this.running) return;
    const dtReal = Math.max(0, Math.min(0.1, (now - this.last) / 1000)); this.last = now;
    const a = performance.now();
    this.acc += dtReal * this.realToGame * this.scale();
    let n = 0; const s0 = performance.now();
    while (this.acc >= this.step && n < this.maxSteps) { this.update(this.step); this.acc -= this.step; n++; }
    this.simMs = performance.now() - s0; this.steps = n;
    if (n >= this.maxSteps) this.acc = Math.min(this.acc, this.step); // не догоняем бесконечно: время просто замедляется
    this.render(this.acc / this.step, dtReal);
    this.ms = this.ms * 0.9 + (performance.now() - a) * 0.1;
    if (dtReal > 0) this.fps = this.fps * 0.9 + (1 / dtReal) * 0.1;
    requestAnimationFrame(this.frame);
  }
}

// ---------- сохранение ----------
const SAVE_KEY = 'lars-save-v1';
const Save = {
  has() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } },
  write(obj) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(obj)); return true; } catch (e) { console.warn('save failed', e); return false; } },
  read() { try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
  clear() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} },
};
const Settings = (() => {
  const DEF = { quality: 'auto', sound: 1 };
  let v = { ...DEF };
  try { Object.assign(v, JSON.parse(localStorage.getItem('lars-settings') || '{}')); } catch (e) {}
  return { get: k => v[k], set(k, x) { v[k] = x; try { localStorage.setItem('lars-settings', JSON.stringify(v)); } catch (e) {} } };
})();

// ---------- форматирование ----------
const CUR = { rub_cash: '₽', rub_card: '₽', usd: '$', gel: '₾' };
function money(n, cur = 'rub_cash') {
  const s = Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return cur === 'usd' ? '$' + s : s + ' ' + CUR[cur];
}
function fmtKm(m) { return m >= 1000 ? (m / 1000).toFixed(1).replace('.', ',') + ' км' : Math.round(m) + ' м'; }
function fmtDur(sec) { const h = Math.floor(sec / HOUR), m = Math.floor((sec % HOUR) / 60); return h >= 24 ? `${Math.floor(h / 24)} д ${h % 24} ч` : h ? `${h} ч ${m} мин` : `${m} мин`; }
// «{name} сказал» → подстановка
function tpl(s, vars) { return s ? s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '') : ''; }
return { HOUR, DAY, clamp, lerp, smooth, $, RNG, hash01, Bus, Clock, Loop, Save, Settings, CUR, money, fmtKm, fmtDur, tpl };
});
