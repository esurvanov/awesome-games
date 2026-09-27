// «Житьёвский» — своя тарабарщина. Синтез слогов: пила на высоте голоса → два полосовых
// фильтра-форманты (гласная) + короткий шумовой всплеск (согласная). Контур высоты по фразе.
import { E } from './engine.js';

// Форманты F1/F2 (Гц) — усреднённые гласные
const VOWELS = { а: [800, 1250], э: [520, 1850], и: [300, 2250], о: [520, 880], у: [330, 780], ы: [380, 1550] };
const VK = Object.keys(VOWELS);
// Согласные: тип фильтра, частота, длительность
const CONS = {
  с: ['highpass', 5200, 0.07], ш: ['bandpass', 2600, 0.07], ф: ['highpass', 3500, 0.05],
  к: ['bandpass', 1800, 0.018], т: ['bandpass', 3200, 0.015], п: ['lowpass', 500, 0.015],
  б: ['lowpass', 350, 0.02], д: ['lowpass', 900, 0.02], л: null, м: null, н: null, р: null,
};
const CK = Object.keys(CONS);

// Псевдослучайность от зерна — у каждой реплики свой, но воспроизводимый «текст»
function rng(seed) { let s = (seed * 2654435761) >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296; }

// Параметры голоса сима: base — высота (Гц), fs — сдвиг формант (голос «тоньше»)
export function voiceOf(sim, h01) {
  const female = (sim?.look?.body || sim?.look?.gender) === 'female';
  const base = female ? 195 + h01 * 60 : 100 + h01 * 45;
  return { base, fs: female ? 1.14 : 1.0 };
}

// Сгенерировать строку-«слова» (для отладки и пузыря) и сыграть её
export function speak({ base = 150, fs = 1, seed = Math.random() * 1e9, syllables, mood = 0, pan = 0 } = {}) {
  const r = rng(Math.floor(seed));
  const n = syllables || 2 + Math.floor(r() * 4);
  const text = [];
  if (!E.ok()) return text;
  const c = E.ctx, t0 = c.currentTime + 0.02;
  const out = c.createGain(); out.gain.value = 1;
  const p = c.createStereoPanner ? c.createStereoPanner() : null;
  if (p) { p.pan.value = Math.max(-0.8, Math.min(0.8, pan)); out.connect(p); p.connect(E.voiceG); } else out.connect(E.voiceG);

  const question = r() < 0.3;
  const moodK = 1 + mood / 400; // в хорошем настроении — чуть выше
  let t = t0;
  for (let i = 0; i < n; i++) {
    const vk = VK[Math.floor(r() * VK.length)], [F1, F2] = VOWELS[vk];
    const ck = r() < 0.75 ? CK[Math.floor(r() * CK.length)] : '';
    text.push(ck + vk);
    // согласная — шумовой всплеск
    const cons = ck && CONS[ck];
    if (cons) E.burst(cons[2], cons[0], cons[1] * (0.9 + r() * 0.2), 0.16, { q: 1.5, at: t - c.currentTime, out });
    const cd = cons ? cons[2] * 0.7 : 0.015;
    const vs = t + cd, dur = 0.09 + r() * 0.08 + (i === n - 1 ? 0.07 : 0);
    // контур: плавное снижение по фразе, в вопросе — подъём в конце
    const k = i / Math.max(1, n - 1);
    const f0 = base * moodK * (1.08 - 0.16 * k + (question && i === n - 1 ? 0.35 : 0)) * (0.96 + r() * 0.08);
    const f1 = f0 * (question && i === n - 1 ? 1.18 : 0.94);
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, vs); o.frequency.linearRampToValueAtTime(f1, vs + dur);
    // вибрато
    const vib = c.createOscillator(), vg = c.createGain(); vib.frequency.value = 5.5; vg.gain.value = f0 * 0.012;
    vib.connect(vg); vg.connect(o.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, vs);
    g.gain.exponentialRampToValueAtTime(0.5, vs + 0.018);
    g.gain.setValueAtTime(0.5, vs + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, vs + dur);
    // носовые/плавные — глухой тёплый тон перед гласной
    if (ck && !cons) {
      const nas = c.createBiquadFilter(); nas.type = 'lowpass'; nas.frequency.value = 400;
      const ng = c.createGain(); ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.3, t + 0.02); ng.gain.exponentialRampToValueAtTime(0.0001, vs + 0.02);
      o.connect(nas); nas.connect(ng); ng.connect(out);
    }
    for (const [F, q, amp] of [[F1 * fs, 7, 1], [F2 * fs, 10, 0.55], [2700 * fs, 12, 0.18]]) {
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = F; bp.Q.value = q;
      const a = c.createGain(); a.gain.value = amp;
      o.connect(bp); bp.connect(a); a.connect(g);
    }
    g.connect(out);
    const st = cons ? vs : t;
    o.start(st); vib.start(st); o.stop(vs + dur + 0.03); vib.stop(vs + dur + 0.03);
    t = vs + dur + (r() < 0.2 ? 0.08 : 0.01); // иногда пауза между «словами»
  }
  return text;
}
