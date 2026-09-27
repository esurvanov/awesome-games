// Строки интерфейса от Писателя (data/text/ui.js, CONTRACT §9). Пока файла нет — короткий запас.
// Имена экспортов берём гибко: TIPS/tips, LOADING/JOKES/loading, HINTS/hints (по ключу режима).
const FALLBACK = {
  tips: ['1 2 3 — скорость, P — пауза', 'Тащи мышью — двигать вид', 'Клик по предмету — что с ним сделать'],
  jokes: ['Взбиваем подушки…', 'Сортируем носки по цвету…', 'Уговариваем кота слезть со стола…'],
  hints: {},
};
let T = { ...FALLBACK };
const pickArr = (m, re) => { for (const [k, v] of Object.entries(m)) if (re.test(k) && Array.isArray(v) && v.length) return v.map(x => (typeof x === 'string' ? x : x?.text ?? '')).filter(Boolean); return null; };

export const textsReady = import('../../data/text/ui.js').then(m => {
  const src = { ...m, ...(m.default || {}) };
  T = {
    tips: pickArr(src, /^tips?$|tip/i) || FALLBACK.tips,
    jokes: pickArr(src, /load|joke/i) || FALLBACK.jokes,
    hints: src.HINTS || src.hints || {},
  };
}).catch(() => {});

export const tips = () => T.tips;
export const jokes = () => T.jokes;
export const tipOfDay = day => T.tips[((day % T.tips.length) + T.tips.length) % T.tips.length];
// Подсказка в духе TS1 по ключу (buy, build, hood, cas, …) — строка или null
export const hint = key => { const v = T.hints[key]; return Array.isArray(v) ? v[Math.floor(Math.random() * v.length)] : v || null; };
