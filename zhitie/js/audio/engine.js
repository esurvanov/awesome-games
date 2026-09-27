// Процедурный звук на Web Audio — без файлов. Стиль портирован из sibiria/js/audio.js
// (env/tone/burst), звуки свои: клики, «дзынь» кассы, колокольчик уведомления, ding навыка.

export const E = {
  ctx: null, master: null, sfxG: null, musicG: null, voiceG: null, noise: null, verb: null,
  on: true, sfxVol: 0.8,
  ok() { return !!this.ctx && this.on && this.ctx.state === 'running'; },

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.on ? 0.9 : 0;
    // лёгкий компрессор, чтобы наложения не хрипели
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(c.destination);
    this.sfxG = c.createGain(); this.sfxG.gain.value = this.sfxVol ?? 0.8; this.sfxG.connect(this.master);
    this.voiceG = c.createGain(); this.voiceG.gain.value = 0.7 * (this.sfxVol ?? 0.8); this.voiceG.connect(this.master);
    this.musicG = c.createGain(); this.musicG.gain.value = 0.0; this.musicG.connect(this.master);
    // «эхо-зал»: задержка с обратной связью — мягкий хвост для музыки и колокольчиков
    const dl = c.createDelay(1), fb = c.createGain(), lp = c.createBiquadFilter(), wet = c.createGain();
    dl.delayTime.value = 0.33; fb.gain.value = 0.38; lp.type = 'lowpass'; lp.frequency.value = 2200; wet.gain.value = 0.35;
    dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(wet); wet.connect(this.master);
    this.verb = dl;
    const len = c.sampleRate, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
  },
  setSfxVol(v) { this.sfxVol = v; if (this.ctx) { this.sfxG.gain.value = v; this.voiceG.gain.value = 0.7 * v; } },
  setOn(v) { this.on = v; if (this.master) this.master.gain.setTargetAtTime(v ? 0.9 : 0, this.ctx.currentTime, 0.05); },

  // экспоненциальная огибающая
  env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  },
  tone(type, f0, f1, dur, vol, { at = 0, out = this.sfxG, verb = 0, attack = 0.008 } = {}) {
    if (!this.ok()) return;
    const c = this.ctx, t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    this.env(g, t, attack, vol, dur);
    o.connect(g); g.connect(out);
    if (verb) { const v = c.createGain(); v.gain.value = verb; g.connect(v); v.connect(this.verb); }
    o.start(t); o.stop(t + attack + dur + 0.05);
  },
  burst(dur, type, freq, vol, { q = 1, at = 0, out = this.sfxG } = {}) {
    if (!this.ok()) return;
    const c = this.ctx, t = c.currentTime + at, s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); this.env(g, t, 0.004, vol, dur);
    s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  },
  // колокольчик: основной тон + негармонический обертон
  bell(f, vol, at = 0, dur = 1.2) {
    this.tone('sine', f, f, dur, vol, { at, verb: 0.5 });
    this.tone('sine', f * 2.76, f * 2.76, dur * 0.4, vol * 0.25, { at, verb: 0.3 });
  },
};

// Именованные эффекты (событие шины 'sfx' {name} → SFX[name]())
export const SFX = {
  click: () => E.tone('sine', 1250, 900, 0.04, 0.07),
  tab: () => E.tone('triangle', 700, 820, 0.05, 0.06),
  hover: () => E.tone('sine', 1800, 1800, 0.02, 0.018),
  open: () => { E.tone('sine', 660, 880, 0.08, 0.06); E.tone('sine', 990, 990, 0.1, 0.05, { at: 0.05 }); },
  close: () => E.tone('sine', 880, 600, 0.07, 0.05),
  select: () => { E.tone('triangle', 523, 523, 0.08, 0.07); E.tone('triangle', 784, 784, 0.12, 0.06, { at: 0.06 }); },
  enqueue: () => { E.tone('sine', 587, 587, 0.07, 0.07); E.tone('sine', 880, 880, 0.12, 0.06, { at: 0.07 }); },
  cancel: () => { E.tone('sine', 700, 420, 0.12, 0.06); },
  error: () => { E.tone('square', 220, 220, 0.08, 0.035); E.tone('square', 175, 175, 0.12, 0.035, { at: 0.1 }); },
  // касса: металлический звон + два ярких тона + «ящик»
  kaching: () => {
    E.burst(0.05, 'bandpass', 3200, 0.25, { q: 3 });
    E.tone('triangle', 1319, 1319, 0.12, 0.09, { at: 0.03 });
    E.bell(1760, 0.08, 0.1, 0.7);
    E.bell(2637, 0.05, 0.14, 0.9);
    E.burst(0.09, 'lowpass', 400, 0.18, { at: 0.2 });
  },
  coin: () => { for (const [i, f] of [988, 1319, 1568].entries()) E.bell(f, 0.05, i * 0.07, 0.5); },
  chime: () => { E.bell(784, 0.06, 0, 1); E.bell(1175, 0.05, 0.12, 1.2); },
  skill: () => {
    E.tone('triangle', 523, 1047, 0.35, 0.07, { verb: 0.4 });
    for (const [i, f] of [1319, 1568, 2093].entries()) E.bell(f, 0.04, 0.3 + i * 0.08, 0.6);
  },
  place: () => { E.burst(0.08, 'lowpass', 350, 0.4); E.tone('sine', 140, 70, 0.12, 0.12); },
  pickup: () => { E.tone('sine', 300, 520, 0.1, 0.07); E.burst(0.05, 'bandpass', 1200, 0.1, { q: 2 }); },
  rotate: () => E.tone('triangle', 900, 1100, 0.05, 0.05),
  wall: () => { E.burst(0.07, 'bandpass', 700, 0.35, { q: 1.5 }); E.tone('sine', 180, 120, 0.08, 0.08); },
  wallDel: () => { E.burst(0.2, 'lowpass', 600, 0.35); E.tone('sine', 160, 60, 0.2, 0.1); },
  floor: () => { E.burst(0.18, 'bandpass', 2400, 0.12, { q: 0.7 }); },
  mode: () => { E.burst(0.25, 'bandpass', 900, 0.08, { q: 0.8 }); E.tone('sine', 440, 660, 0.18, 0.05); },
  speed: () => E.tone('sine', 1000, 1300, 0.04, 0.06),
  // — волна 2 —
  dialog: () => { E.bell(660, 0.05, 0, 0.6); E.bell(990, 0.05, 0.1, 0.8); },
  smoke: () => { E.tone('square', 3150, 3150, 0.12, 0.03); },          // пищалка датчика дыма
  burglar: () => { for (let i = 0; i < 6; i++) E.tone('sawtooth', i % 2 ? 700 : 1000, i % 2 ? 1000 : 700, 0.32, 0.05, { at: i * 0.33 }); },
  babyCry: () => { for (let i = 0; i < 3; i++) { E.tone('sawtooth', 520, 680, 0.18, 0.03, { at: i * 0.45 }); E.tone('sawtooth', 680, 430, 0.22, 0.03, { at: i * 0.45 + 0.18 }); } },
  doorbell: () => { E.bell(784, 0.08, 0, 1.0); E.bell(622, 0.08, 0.45, 1.3); },
  phone: () => { for (let r = 0; r < 2; r++) for (let i = 0; i < 10; i++) E.tone('square', i % 2 ? 1300 : 1000, i % 2 ? 1300 : 1000, 0.04, 0.02, { at: r * 0.9 + i * 0.045 }); },
  pizza: () => { for (const [i, f] of [523, 659, 784, 1047].entries()) E.tone('triangle', f, f, 0.12, 0.06, { at: i * 0.1 }); },
  zap: () => { E.burst(0.25, 'highpass', 3000, 0.25); E.tone('sawtooth', 90, 60, 0.25, 0.08); E.tone('square', 1800, 200, 0.2, 0.03); },
  clank: () => { for (let i = 0; i < 3; i++) { E.tone('triangle', 1400 + i * 230, 1300, 0.08, 0.05, { at: i * 0.16 }); E.burst(0.04, 'bandpass', 2600, 0.15, { q: 6, at: i * 0.16 }); } },
  clean: () => { for (let i = 0; i < 4; i++) E.burst(0.1, 'bandpass', 3000 + (i % 2) * 900, 0.08, { q: 1.2, at: i * 0.12 }); },
  crackle: () => { E.burst(0.02 + Math.random() * 0.03, 'highpass', 1500 + Math.random() * 2500, 0.07 + Math.random() * 0.08); },
  reaper: () => { E.tone('sine', 110, 55, 2.2, 0.12, { verb: 0.6 }); E.tone('sawtooth', 146.8, 138, 1.8, 0.025, { verb: 0.5 }); E.bell(233, 0.05, 0.3, 2.2); },
  sad: () => { for (const [i, f] of [392, 349, 311, 294].entries()) E.tone('triangle', f, f, 0.5, 0.05, { at: i * 0.35, verb: 0.5 }); },
  celebrate: () => { for (const [i, f] of [523, 659, 784, 1047, 1319].entries()) E.bell(f, 0.05, i * 0.08, 0.7); E.burst(0.3, 'highpass', 5000, 0.08, { at: 0.4 }); },
};

// Петли (огонь, пищалка) — тикают из audio.frame, не таймерами
export const LOOPS = { fire: { every: [0.03, 0.14], play: 'crackle' }, smoke: { every: [0.55, 0.55], play: 'smoke' } };
