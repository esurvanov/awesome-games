// Спокойная генеративная музыка по режимам. Своя, не «в копию»: жизнь — пентатоника с колокольчиками,
// покупка — лёгкий джаз (септаккорды, свинг, щёточки), стройка — «нью-эйдж» арпеджио фортепиано.
import { E } from './engine.js';

const hz = m => 440 * 2 ** ((m - 69) / 12); // midi → Гц

const STYLES = {
  live: { bpm: 84, swing: 0, chords: [[48, 60, 64, 67], [45, 57, 60, 64], [41, 57, 60, 65], [43, 55, 59, 62]], scale: [72, 74, 76, 79, 81, 84], mel: 0.35 },
  buy: { bpm: 104, swing: 0.18, chords: [[41, 57, 60, 64], [38, 57, 60, 65], [43, 58, 62, 65], [36, 58, 64, 67]], scale: [69, 72, 74, 76, 77, 79, 81], mel: 0.22 },
  build: { bpm: 72, swing: 0, chords: [[45, 60, 64, 71], [41, 60, 64, 69], [48, 60, 67, 74], [43, 59, 62, 67]], scale: [72, 76, 79, 83, 84, 88], mel: 0.15 },
};

let mode = 'live', next = 0, step = 0, on = true, last = 72, bus = null, vol = 0.55;

function note(type, m, at, dur, vol, verb = 0.4, cutoff = 1800) {
  const c = E.ctx, o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
  o.type = type; o.frequency.value = hz(m); f.type = 'lowpass'; f.frequency.value = cutoff;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(f); f.connect(g); g.connect(bus);
  if (verb) { const v = c.createGain(); v.gain.value = verb; g.connect(v); v.connect(E.verb); }
  o.start(at); o.stop(at + dur + 0.05);
}
// мягкий пэд: медленная атака
function pad(m, at, dur, vol) {
  const c = E.ctx, o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
  o.type = 'triangle'; o.frequency.value = hz(m); o.detune.value = (Math.random() - 0.5) * 8;
  f.type = 'lowpass'; f.frequency.value = 900;
  g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(vol, at + dur * 0.3); g.gain.linearRampToValueAtTime(0.0001, at + dur);
  o.connect(f); f.connect(g); g.connect(bus); o.start(at); o.stop(at + dur + 0.05);
}
function brush(at, vol) {
  const c = E.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = E.noise; f.type = 'highpass'; f.frequency.value = 6000;
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
  s.connect(f); f.connect(g); g.connect(bus); s.start(at, Math.random() * 0.5); s.stop(at + 0.15);
}

// Один «восьмой» шаг стиля
function play(st, at, eighth) {
  const bar = Math.floor(step / 8), pos = step % 8, ch = st.chords[bar % st.chords.length];
  if (mode === 'live') {
    if (pos === 0) { for (const m of ch.slice(1)) pad(m, at, eighth * 8.4, 0.022); note('sine', ch[0], at, eighth * 3.5, 0.06, 0); }
    if (pos === 4) note('sine', ch[0] + 7, at, eighth * 3, 0.04, 0);
  } else if (mode === 'buy') {
    // шагающий бас четвертями, аккорд-«стабы» на слабые доли, щёточки
    if (pos % 2 === 0) { const walk = [0, 7, 12, 10][pos / 2]; note('triangle', ch[0] + walk, at, eighth * 1.8, 0.07, 0, 700); }
    if (pos === 3 || pos === 7) for (const m of ch.slice(1)) { note('sine', m, at, eighth * 1.5, 0.022, 0.2, 2400); note('triangle', m + 12, at, eighth * 0.8, 0.006, 0.1); }
    if (pos % 2 === 1) brush(at, 0.02); else if (pos === 2 || pos === 6) brush(at, 0.035);
  } else {
    // арпеджио вверх-вниз по аккорду, как фортепиано с педалью
    const arp = [...ch.slice(1), ch[1] + 12, ch[2] + 12, ch[3] + 12, ch[2] + 12, ch[1] + 12];
    note('triangle', arp[pos], at, eighth * 5, 0.035, 0.55, 2600);
    note('sine', arp[pos] + 12, at, eighth * 2, 0.008, 0.3);
    if (pos === 0) { note('sine', ch[0], at, eighth * 8, 0.06, 0.3); pad(ch[0] + 12, at, eighth * 8, 0.015); }
  }
  // мелодия: случайное блуждание по гамме, мягко
  if (Math.random() < st.mel && pos !== 7) {
    const sc = st.scale; let i = sc.indexOf(last); if (i < 0) i = 2;
    i = Math.max(0, Math.min(sc.length - 1, i + [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)]));
    last = sc[i];
    note(mode === 'build' ? 'triangle' : 'sine', last, at, eighth * (mode === 'buy' ? 1.4 : 3), mode === 'buy' ? 0.03 : 0.035, 0.5, 3000);
  }
}

export const Music = {
  get on() { return on; },
  setOn(v) { on = v; if (E.ctx) E.musicG.gain.setTargetAtTime(v ? vol : 0, E.ctx.currentTime, 0.4); },
  get vol() { return vol; },
  setVol(v) { vol = v; if (E.ctx && on) E.musicG.gain.setTargetAtTime(v, E.ctx.currentTime, 0.1); },
  setMode(m) {
    if (!STYLES[m] || m === mode) return;
    mode = m; step = 0;
    // короткое затухание и возврат — «переход» между темами
    if (E.ctx && on) { const t = E.ctx.currentTime; E.musicG.gain.setTargetAtTime(0.0, t, 0.15); E.musicG.gain.setTargetAtTime(vol, t + 0.6, 0.5); next = t + 0.7; }
  },
  frame() {
    if (!E.ok() || !on) return;
    if (!bus) { bus = E.ctx.createGain(); bus.gain.value = 1; bus.connect(E.musicG); E.musicG.gain.setTargetAtTime(vol, E.ctx.currentTime, 1.5); }
    const st = STYLES[mode], eighth = 30 / st.bpm, now = E.ctx.currentTime;
    if (next < now) next = now + 0.05;
    // планируем на 0.3 с вперёд — таймеры кадров не влияют на ритм
    while (next < now + 0.3) {
      const sw = step % 2 === 1 ? st.swing * eighth : 0;
      play(st, next + sw, eighth);
      next += eighth; step++;
    }
  },
};
