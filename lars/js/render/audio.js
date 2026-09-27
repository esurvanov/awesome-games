// Звук без файлов (WebAudio): ветер в ущелье (шум, фильтр гуляет), Терек (шум полосой, громче у реки),
// гул моторов очереди (низкий, громче рядом с заведёнными машинами), свой мотор в салоне. Включается первым касанием.
'use strict';
L.def('render/audio', () => {
const { clamp, Settings } = L.use('core');

class Ambience {
  constructor() { this.ctx = null; this.on = Settings.get('sound') !== 0; }
  start() {
    if (this.ctx || !this.on) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC(), sr = ctx.sampleRate;
    // буфер розового шума 4 с
    const buf = ctx.createBuffer(1, sr * 4, sr), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048; d[i] = (b0 + b1 + b2 + w * 0.02) * 0.9; }
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = Math.random(); s.start(0, Math.random() * 3); return s; };
    const master = this.master = ctx.createGain(); master.gain.value = 0.7; master.connect(ctx.destination);
    // ветер
    const wn = noise(), wf = this.windF = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 400; wf.Q.value = 0.7;
    const wg = this.windG = ctx.createGain(); wg.gain.value = 0.05; wn.connect(wf); wf.connect(wg); wg.connect(master);
    // река
    const rn = noise(), rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 900;
    const rh = ctx.createBiquadFilter(); rh.type = 'highpass'; rh.frequency.value = 120;
    const rg = this.riverG = ctx.createGain(); rg.gain.value = 0; rn.connect(rf); rf.connect(rh); rh.connect(rg); rg.connect(master);
    // моторы: два низких пилообразных через фильтр
    const eg = this.engG = ctx.createGain(); eg.gain.value = 0;
    const ef = ctx.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 160; ef.connect(eg); eg.connect(master);
    for (const f of [31, 43.5]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = 0.5; o.connect(g); g.connect(ef); o.start(); }
    this.t = 0;
  }
  // k — параметры кадра: { wind 0..1, river м до реки, engines 0..1, inCar, engineOn, paused }
  update(dt, k) {
    const ctx = this.ctx; if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume?.();
    this.t += dt;
    const now = ctx.currentTime, ramp = (p, v) => p.setTargetAtTime(v, now, 0.4);
    const gust = 0.5 + 0.5 * Math.sin(this.t * 0.23) * Math.sin(this.t * 0.071 + 1);
    const muff = k.inCar ? 0.35 : 1;
    ramp(this.windG.gain, (0.02 + 0.07 * k.wind * gust) * muff);
    ramp(this.windF.frequency, 250 + 500 * gust * k.wind);
    ramp(this.riverG.gain, clamp(1 - k.river / 160, 0, 1) * 0.16 * muff);
    ramp(this.engG.gain, (k.engines * 0.05 + (k.inCar && k.engineOn ? 0.09 : 0)) * (k.paused ? 0.3 : 1));
  }
  toggle() { this.on = !this.on; Settings.set('sound', this.on ? 1 : 0); if (this.master) this.master.gain.value = this.on ? 0.7 : 0; if (this.on) this.start(); return this.on; }
}
return { Ambience };
});
