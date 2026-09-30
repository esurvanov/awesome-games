'use strict';
// Процедурный звук: всё синтезируется Web Audio, без файлов.
// Цепочка: эффекты (sfxG) и музыка (musicG, слои day/night/alarm/finale) → общий зал (реверб)
// → master → компрессор → лимитер → out (вкл/выкл) → выход.
// Уровни выверены «слепым аудитом» через OfflineAudioContext: эффекты ≈ −14…−10 dBFS RMS,
// музыка на 8–10 dB тише, мастер не клиппует.
const Sound = {
  ctx: null, on: true, master: null, out: null, noise: null, noise2: null, sfxG: null, musicG: null, _mus: false, _layer: null,
  vol: { music: 0.7, sfx: 0.8 },
  windG: null, windF: null, droneG: null, heartT: 0, crackT: 0, stepT: 0, frostT: 20,
  SFX_K: 2.4, MUS_K: 2.518,
  mood: null, lay: null, mT: 0, mStep: 0,
  // калибровка по аудиту: множитель громкости на эффект; EXT — для прямых Sound.tone/burst из игры
  LV: { chop: 2.691, pick: 1.779, ok2: 2.213, hit: 2.065, bite: 5, splash: 4.842, creak: 2.188, shot: 4, howl: 0.922, growl: 3.4, treeCrack: 2.291, thud: 2.4, step: 4.2, frost: 4.2, heart: 1.035, sting: 1.495, fire: 1.6 },
  EXT: 2.113, _g: null,
  fx(name, fn) { const was = this._g, wn = this._nm; this._g = this.LV[name] || 1; this._nm = name; try { fn(); } finally { this._g = was; this._nm = wn; } },
  gk() { return this._mus ? 1 : this._g != null ? this._g : this.EXT; },

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    // мастер: мягкий компрессор + лимитер, чтобы пачка звуков (пурга + рык + выстрел) не клипповала
    this.out = c.createGain(); this.out.gain.value = this.on ? 1 : 0; this.out.connect(c.destination);
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.1;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 3; comp.attack.value = 0.006; comp.release.value = 0.25;
    comp.connect(lim); lim.connect(this.out);
    this.master = c.createGain(); this.master.gain.value = 0.5; this.master.connect(comp);
    // шум: два разных буфера (левый/правый — шире ветер)
    const mk = () => { const len = c.sampleRate * 2, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; return b; };
    this.noise = mk(); this.noise2 = mk();
    // общий «зал» — короткий реверб тайги (синтетический импульс)
    const ir = c.createBuffer(2, c.sampleRate * 2.4, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < d.length; i++) { const t = i / c.sampleRate; d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 2.6) * (t < 0.01 ? t / 0.01 : 1); } }
    this.verb = c.createConvolver(); this.verb.buffer = ir;
    const vLP = c.createBiquadFilter(); vLP.type = 'lowpass'; vLP.frequency.value = 3000;
    const vG = c.createGain(); vG.gain.value = 0.55;
    this.verb.connect(vLP); vLP.connect(vG); vG.connect(this.master);
    // две шины: эффекты и музыка
    this.sfxG = c.createGain(); this.sfxG.gain.value = this.vol.sfx * this.SFX_K; this.sfxG.connect(this.master);
    this.musicG = c.createGain(); this.musicG.gain.value = this.vol.music * this.MUS_K; this.musicG.connect(this.master);
    const sS = c.createGain(); sS.gain.value = 0.12; this.sfxG.connect(sS); sS.connect(this.verb);
    const mS = c.createGain(); mS.gain.value = 0.4; this.musicG.connect(mS); mS.connect(this.verb);
    // музыкальные слои: плавный кроссфейд между днём, ночью, тревогой и финалом
    this.lay = {};
    for (const k of ['day', 'night', 'alarm', 'finale']) { const g = c.createGain(); g.gain.value = k === 'day' ? 1 : 0; g.connect(this.musicG); this.lay[k] = g; }
    this.layV = { day: 1, night: 0, alarm: 0, finale: 0 };
    this.initWind();
    // дрон напряжения: низкая середина с биением (слышно и на ноутбуке, не только сабом)
    this.droneG = c.createGain(); this.droneG.gain.value = 0;
    const dF = c.createBiquadFilter(); dF.type = 'lowpass'; dF.frequency.value = 320; dF.Q.value = 0.7;
    for (const f of [110, 110.9, 55]) { const o = c.createOscillator(); o.type = f > 60 ? 'sawtooth' : 'sine'; o.frequency.value = f; o.connect(dF); o.start(); }
    dF.connect(this.droneG); this.droneG.connect(this.musicG);
    // треск огня: низкий гул пламени
    const fs = c.createBufferSource(); fs.buffer = this.noise2; fs.loop = true;
    const fF = c.createBiquadFilter(); fF.type = 'lowpass'; fF.frequency.value = 260;
    this.fireG = c.createGain(); this.fireG.gain.value = 0;
    fs.connect(fF); fF.connect(this.fireG); this.fireG.connect(this.sfxG); fs.start();
  },
  initWind() {
    const c = this.ctx;
    const bus = this.windG = c.createGain(); bus.gain.value = 0.05;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400; lp.Q.value = 0.5; // срезаем шипение > 3 кГц
    const pan = this.pan(0);
    bus.connect(lp); lp.connect(pan); pan.connect(this.sfxG);
    if (pan.pan) { const pl = c.createOscillator(), pg = c.createGain(); pl.frequency.value = 0.05; pg.gain.value = 0.5; pl.connect(pg); pg.connect(pan.pan); pl.start(); }
    const src = (buf) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 1.5); return s; };
    // гул: низ
    const lo = c.createBiquadFilter(); lo.type = 'lowpass'; lo.frequency.value = 320;
    const loG = c.createGain(); loG.gain.value = 0.9; src(this.noise).connect(lo); lo.connect(loG); loG.connect(bus);
    // середина: полосовой, частота гуляет
    this.windF = c.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 600; this.windF.Q.value = 0.8;
    const lfo = c.createOscillator(), lfoG = c.createGain(); lfo.frequency.value = 0.09; lfoG.gain.value = 280;
    lfo.connect(lfoG); lfoG.connect(this.windF.frequency); lfo.start();
    const midG = c.createGain(); midG.gain.value = 0.7; src(this.noise2).connect(this.windF); this.windF.connect(midG); midG.connect(bus);
    // свист в щелях — только в пургу
    this.whF = c.createBiquadFilter(); this.whF.type = 'bandpass'; this.whF.frequency.value = 900; this.whF.Q.value = 7;
    const wl = c.createOscillator(), wlg = c.createGain(); wl.frequency.value = 0.13; wlg.gain.value = 220; wl.connect(wlg); wlg.connect(this.whF.frequency); wl.start();
    this.whG = c.createGain(); this.whG.gain.value = 0; src(this.noise).connect(this.whF); this.whF.connect(this.whG); this.whG.connect(bus);
  },
  muteAmb() { if (this.windG) { this.windG.gain.value = 0; this._ambOff = 1; } },
  setVol(music, sfx) {
    this.vol.music = music; this.vol.sfx = sfx;
    if (this.sfxG) { const t = this.ctx.currentTime; this.sfxG.gain.setTargetAtTime(sfx * this.SFX_K, t, 0.05); this.musicG.gain.setTargetAtTime(music * this.MUS_K, t, 0.05); }
  },
  bus() { return this._mus ? (this._layer || this.musicG) : this.sfxG; },
  toggle() { this.on = !this.on; if (this.out) this.out.gain.setTargetAtTime(this.on ? 1 : 0, this.ctx.currentTime, 0.03); return this.on; },
  ok() { return this.ctx && this.on && this.ctx.state === 'running'; },
  rnd(a, b) { return a + Math.random() * (b - a); },
  vary(x, k = 0.08) { return x * (1 + (Math.random() * 2 - 1) * k); },

  // огибающая без щелчков: линейная атака от нуля, экспоненциальный спад, линейный хвост в ноль
  env(g, t, a, peak, d) {
    a = Math.max(0.004, a);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(peak * 0.001, 1e-5), t + a + d); g.gain.linearRampToValueAtTime(0, t + a + d + 0.015);
  },
  pan(p) { const c = this.ctx; if (c.createStereoPanner) { const s = c.createStereoPanner(); s.pan.value = Math.max(-1, Math.min(1, p)); return s; } return c.createGain(); },

  // ---------- звук с местом: одно правило для всех звуков с источником ----------
  // Слушатель — герой (камера его держит). Источник (x, y) мира →
  //   громкость g = 1 / (1 + max(0, d − REF) / 240), REF — «ближняя зона» источника (громкие: вой, выстрел — слышны дальше);
  //   тише 0.004 — не играем; дальше 3600 px — не слышно;
  //   панорама = (x − героя) / 380 (±0.9): слева — влево;
  //   воздух: низкие частоты — дальше, верх гаснет: lp = 16 кГц / (1 + d / 260);
  //   стены: источник и слушатель по разные стороны стены избы — ×0.3 и lp ≤ 700 Гц;
  //   ветер: у слушателя снаружи с 5 м/с дальние звуки тонут в ветре (до −60 % и −40 % верха в пургу).
  REF: { howl: 520, shot: 600, treeCrack: 180, heli: 900 }, _at: null, _atN: null, _nm: null,
  spatial(x, y, name) {
    if (x == null || y == null || typeof G === 'undefined' || !G || !G.p) return null;
    const L = G.p, dx = x - L.x, dy = y - L.y, d = Math.hypot(dx, dy), ref = this.REF[name] || 60;
    if (d > 3600) return { g: 0, pan: 0, lp: 200, d };
    let g = 1 / (1 + Math.max(0, d - ref) / 240), lp = 16000 / (1 + Math.max(0, d - ref * 0.5) / 260);
    const pan = Math.max(-0.9, Math.min(0.9, dx / 380));
    const inL = !!L.inside, inS = typeof insideHut === 'function' && insideHut(x, y);
    if (inL !== inS) { g *= 0.3; lp = Math.min(lp, 700); }
    if (!inL && typeof Wind !== 'undefined') {
      const ms = Wind.ms(L.x, L.y), k = Math.max(0, Math.min(1, (ms - 5) / 13)), m = k * k * (3 - 2 * k) * Math.min(1, d / 260);
      g *= 1 - 0.6 * m; lp *= 1 - 0.4 * m;
    }
    return { g, pan, lp: Math.max(180, lp), d };
  },
  // сыграть fn() «из точки» (x, y): все burst/tone/howl/growl внутри берут громкость, панораму и фильтр от места
  // (правило считается на каждом звуке по его имени — REF громких: вой, выстрел, треск ствола)
  at(x, y, fn, name) {
    const was = this._at, wn = this._atN; this._at = { x, y }; if (name) this._atN = name;
    try { fn(); } finally { this._at = was; this._atN = wn; }
  },
  // Sound.src(o).growl(0.3) — то же, что Sound.at(o.x, o.y, () => Sound.growl(0.3)); src(x, y) — точкой
  src(o, y) {
    const x = typeof o === 'object' && o ? o.x : o, yy = typeof o === 'object' && o ? o.y : y, S = this;
    return new Proxy(S, { get(t, k) { const f = S[k]; return typeof f === 'function' && k !== 'at' && k !== 'src' ? (...a) => S.at(x, yy, () => f.apply(S, a), k) : f; } });
  },
  // место одного звука: vol × g, панорама места (+¼ своей), фильтр воздуха/стен; музыка — без места
  place(vol, pan) {
    const A = this._mus ? null : this._at; if (!A) return { vol, pan, lp: 0 };
    const P = A.P || this.spatial(A.x, A.y, this._atN || this._nm); if (!P) return { vol, pan, lp: 0 };
    return { vol: P.g < 0.004 ? 0 : vol * P.g, pan: Math.max(-1, Math.min(1, P.pan + pan * 0.25)), lp: P.lp < 15000 ? P.lp : 0 };
  },
  out2(node, lp, dest) { if (!lp) { node.connect(dest); return; } const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); f.connect(dest); },
  burst(dur, type, freq, vol, q = 1, opt = {}) {
    if (!this.ok()) return;
    const c = this.ctx, t = c.currentTime + (opt.at || 0), s = c.createBufferSource(); s.buffer = (opt.r != null ? opt.r : Math.random()) < 0.5 ? this.noise : this.noise2; // opt.r — свой случайный 0..1 (живые вещи не тратят Math.random игры)
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (opt.f1) f.frequency.exponentialRampToValueAtTime(opt.f1, t + dur);
    const Q = this.place(vol, opt.pan || 0), g = c.createGain(); this.env(g, t, opt.a || 0.004, Q.vol * this.gk(), dur);
    const p = this.pan(Q.pan);
    s.connect(f); f.connect(g); g.connect(p); this.out2(p, Q.lp, opt.dest || this.bus()); s.start(t, (opt.r != null ? (opt.r * 7.13) % 1 : Math.random()) * 1.5); s.stop(t + (opt.a || 0.004) + dur + 0.05);
  },
  tone(type, f0, f1, dur, vol, pan = 0, opt = {}) {
    if (!this.ok()) return;
    const Q = this.place(vol, pan), c = this.ctx, t = c.currentTime + (opt.at || 0), o = c.createOscillator(), g = c.createGain(), p = this.pan(Q.pan);
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    let node = o;
    if (opt.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opt.lp; o.connect(f); node = f; }
    this.env(g, t, opt.a || 0.008, Q.vol * this.gk(), dur); node.connect(g); g.connect(p); this.out2(p, Q.lp, opt.dest || this.bus()); o.start(t); o.stop(t + (opt.a || 0.008) + dur + 0.05);
  },

  // --- события (уровни — под −14…−10 dBFS RMS на выходе) ---
  chop() {
    // три тембра удара: «звонкий», «глухой», «сырой» + случайная высота
    const k = (Math.random() * 3) | 0, fr = [1100, 750, 900][k] * this.vary(1, 0.12);
    this.burst(0.07, 'bandpass', fr, 0.55, [2.5, 1.5, 2][k]);
    this.tone('triangle', this.vary(190, 0.1), 85, 0.09, 0.42, this.rnd(-0.15, 0.15));
    if (Math.random() < 0.35) this.burst(0.05, 'highpass', 2200, 0.08, 1, { at: 0.03 }); // щепка
  },
  pick() { const f = this.vary(660, 0.03); this.tone('sine', f, f * 1.5, 0.12, 0.26); this.tone('sine', f * 2, f * 3, 0.06, 0.05); },
  ok2() { const k = this.vary(1, 0.02); this.tone('sine', 523 * k, 523 * k, 0.14, 0.25); this.tone('sine', 784 * k, 784 * k, 0.26, 0.25, 0, { at: 0.11 }); this.tone('triangle', 1046 * k, 1046 * k, 0.2, 0.05, 0, { at: 0.11 }); },
  hit() { this.burst(0.12, 'lowpass', this.vary(520, 0.15), 0.85); this.tone('sine', this.vary(130, 0.1), 60, 0.1, 0.35); },
  bite() { this.burst(0.15, 'bandpass', this.vary(1300, 0.12), 0.6, 2.5); this.tone('sawtooth', this.vary(220, 0.1), 110, 0.18, 0.22, 0, { lp: 1600 }); },
  splash() { this.burst(0.5, 'lowpass', 1100, 0.5, 1, { f1: 400, a: 0.01 }); this.burst(0.25, 'bandpass', 1800, 0.12, 3, { at: 0.05 }); this.tone('sine', 300, 120, 0.2, 0.2); },
  creak() { this.tone('triangle', this.vary(900, 0.1), 200, 0.45, 0.28, 0, { lp: 2000, a: 0.03 }); this.tone('sawtooth', 120, 90, 0.4, 0.08, 0, { lp: 500, a: 0.05 }); },
  shot() {
    this.burst(0.3, 'lowpass', 2000, 1.0, 1, { f1: 600 }); this.tone('sine', 110, 40, 0.25, 0.3);
    // эхо по сопкам
    this.burst(0.5, 'lowpass', 700, 0.18, 1, { at: 0.32, a: 0.02, pan: -0.5 }); this.burst(0.6, 'lowpass', 500, 0.1, 1, { at: 0.7, a: 0.03, pan: 0.5 });
  },
  howl(pan = 0, vol = 0.18) {
    if (!this.ok()) return;
    const c = this.ctx, t = c.currentTime, base = this.rnd(280, 340), peakF = base * this.rnd(1.7, 1.95), dur = this.rnd(2.2, 3);
    const one = (t0, b, pk, v, pn, d) => {
      const o = c.createOscillator(), vib = c.createOscillator(), vg = c.createGain(), f = c.createBiquadFilter(), g = c.createGain(), p = this.pan(pn);
      o.type = 'sawtooth'; o.frequency.setValueAtTime(b, t0); o.frequency.linearRampToValueAtTime(pk, t0 + d * 0.35); o.frequency.linearRampToValueAtTime(pk * 0.92, t0 + d * 0.75); o.frequency.linearRampToValueAtTime(b * 1.2, t0 + d);
      vib.frequency.value = this.rnd(4.5, 6); vg.gain.value = 7; vib.connect(vg); vg.connect(o.frequency);
      f.type = 'lowpass'; f.frequency.value = 1300; f.Q.value = 2;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(v, t0 + 0.45); g.gain.linearRampToValueAtTime(v * 0.8, t0 + d * 0.8); g.gain.linearRampToValueAtTime(0, t0 + d);
      o.connect(f); f.connect(g); g.connect(p); this.out2(p, Q.lp, this.bus());
      const vs = c.createGain(); vs.gain.value = 0.5 + 0.3 * (1 - Q.vol / Math.max(1e-6, vol)); g.connect(vs); vs.connect(this.verb); // даль: дальше — больше зала
      o.start(t0); vib.start(t0); o.stop(t0 + d + 0.05); vib.stop(t0 + d + 0.05);
    };
    const Q = this.place(vol, 0), v = Q.vol * 2.6 * this.gk(); if (this._at) pan = Q.pan; // с местом — панорама от места
    one(t, base, peakF, v, pan, dur);
    if (Math.random() < 0.5) one(t + this.rnd(0.6, 1.2), base * 1.19, peakF * 1.12, v * 0.55, Math.max(-1, Math.min(1, pan + this.rnd(-0.5, 0.5) * (this._at ? 0.3 : 1))), dur * 0.85); // подвывает второй
  },
  growl(vol = 0.35) {
    if (!this.ok()) return;
    const Q = this.place(vol, 0), c = this.ctx, t = c.currentTime, d = this.rnd(0.9, 1.3), o = c.createOscillator(), am = c.createOscillator(), amg = c.createGain(), g = c.createGain(), f = c.createBiquadFilter(), g2 = c.createGain(), p = this.pan(Q.pan);
    o.type = 'sawtooth'; o.frequency.setValueAtTime(this.rnd(78, 95), t); o.frequency.linearRampToValueAtTime(this.rnd(65, 75), t + d);
    f.type = 'lowpass'; f.frequency.value = 520; f.Q.value = 3;
    am.frequency.value = this.rnd(22, 30); amg.gain.value = 0.5; am.connect(amg); amg.connect(g2.gain); g2.gain.value = 0.5;
    this.env(g, t, 0.12, Q.vol * 2.2 * this.gk(), d); o.connect(f); f.connect(g2); g2.connect(g); g.connect(p); this.out2(p, Q.lp, this.bus()); // рык — с панорамой места (раньше — всегда по центру)
    o.start(t); am.start(t); o.stop(t + d + 0.2); am.stop(t + d + 0.2);
    this.burst(d, 'bandpass', 350, vol * 1.3, 1.2, { a: 0.1 });
  },
  // вертолёт: непрерывный ротор. heli() зовут раз в ~2 с — ротор держится и сам затухает, если перестали звать
  heli() {
    if (!this.ok()) return; this.rotorOn(); this.heliUntil = this.ctx.currentTime + 2.8;
    const Q = this.place(1.4, 0); this.heliLvl = Math.max(0.15, Q.vol); if (this.rotorP.pan) this.rotorP.pan.setTargetAtTime(Q.pan, this.ctx.currentTime, 0.6); // с местом борта
  },
  rotorOn() {
    if (this.rotorG) return;
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 1.2;
    const am = c.createGain(); am.gain.value = 0.35;
    const blade = c.createOscillator(); blade.type = 'sawtooth'; blade.frequency.value = 11; const bg = c.createGain(); bg.gain.value = 0.65; blade.connect(bg); bg.connect(am.gain);
    const turb = c.createOscillator(); turb.type = 'sawtooth'; turb.frequency.value = 185; const tf = c.createBiquadFilter(); tf.type = 'lowpass'; tf.frequency.value = 600; const tg = c.createGain(); tg.gain.value = 0.05;
    const wh = c.createOscillator(); wh.frequency.value = 1150; const wg = c.createGain(); wg.gain.value = 0.012;
    this.rotorG = c.createGain(); this.rotorG.gain.value = 0; this.rotorP = this.pan(0);
    s.connect(lp); lp.connect(am); am.connect(this.rotorG); turb.connect(tf); tf.connect(tg); tg.connect(this.rotorG); wh.connect(wg); wg.connect(this.rotorG);
    this.rotorG.connect(this.rotorP); this.rotorP.connect(this.sfxG);
    s.start(); blade.start(); turb.start(); wh.start();
    this.rotorBlade = blade;
  },
  // прямое управление ротором (финал): level 0…1.5, pan −1…1
  rotor(level, pan = 0) {
    if (!this.ctx) return; this.rotorOn(); const t = this.ctx.currentTime;
    this.rotorG.gain.setTargetAtTime(level * 1.6, t, 0.15); if (this.rotorP.pan) this.rotorP.pan.setTargetAtTime(pan, t, 0.2);
    this.rotorBlade.frequency.setTargetAtTime(10 + level * 2.5, t, 0.5); this.heliUntil = t + 1e9;
  },
  rotorOff() { if (this.rotorG) { this.rotorG.gain.setTargetAtTime(0, this.ctx.currentTime, 0.8); this.heliUntil = 0; } },
  // глухой удар плечом о ствол/стену/камень: k 0…1 — сила; hard — звонче (камень, металл)
  thud(k = 0.6, hard = 0) {
    this.burst(0.09, 'lowpass', this.vary(hard ? 420 : 260, 0.12), 0.35 + 0.45 * k);
    this.tone('sine', this.vary(hard ? 110 : 80, 0.1), 42, 0.12, 0.22 + 0.25 * k, this.rnd(-0.1, 0.1), { lp: 400 });
  },
  // жесты героя: свист лайке, взмах палкой, шипение углей под снегом
  whistle() { this.tone('sine', 1500, 2100, 0.18, 0.12, 0, { a: 0.01 }); this.tone('sine', 1800, 2500, 0.22, 0.12, 0, { at: 0.24, a: 0.01 }); },
  whoosh() { this.burst(0.2, 'bandpass', this.vary(900, 0.1), 0.18, 2, { f1: 400 }); },
  hiss() { this.burst(0.7, 'highpass', 3000, 0.16, 0.7, { a: 0.02 }); },
  treeCrack() {
    this.burst(0.25, 'bandpass', this.vary(320, 0.15), 0.9, 1); this.burst(0.03, 'bandpass', 1500, 0.1, 1.5, { a: 0.006 });
    this.burst(0.35, 'lowpass', 220, 0.8, 1, { at: 0.18 }); this.tone('sine', 90, 45, 0.4, 0.4, 0, { at: 0.2 });
  },
  // шаги: снег хрустит, лыжи шуршат, лёд щёлкает, пол в избе глухо стучит
  step(surf = 'snow', dk = 0) {
    if (!this.ok()) return;
    const pan = this.rnd(-0.1, 0.1);
    // глубокий снег: глухой «вдох» снега и шорох по одежде; хруст зёрен тише — чем глубже, тем глуше
    if (surf === 'deep') { const k = Math.min(1, (dk - 30) / 90); this.burst(0.26 + 0.2 * k, 'lowpass', this.vary(420 - 160 * k, 0.1), 0.34, 1, { a: 0.05, pan }); this.burst(0.3 + 0.25 * k, 'bandpass', this.vary(1500, 0.12), 0.06 + 0.06 * k, 0.6, { at: 0.04, a: 0.12, pan }); if (k < 0.6) for (let i = 0; i < 3; i++) this.burst(this.rnd(0.006, 0.012), 'bandpass', this.rnd(1100, 2200), 0.1 * (1 - k), 1.4, { at: i * 0.012, pan }); return; }
    if (surf === 'wood') { this.tone('sine', this.vary(120, 0.1), 75, 0.05, 0.06, pan); this.burst(0.04, 'lowpass', 450, 0.05, 1, { pan }); return; }
    if (surf === 'ski') { this.burst(0.28, 'bandpass', this.vary(1400, 0.1), 0.18, 1.2, { f1: 700, a: 0.06, pan }); return; }
    if (surf === 'ice') { this.burst(0.012, 'bandpass', this.vary(2000, 0.15), 0.12, 4, { pan }); this.tone('sine', 180, 140, 0.05, 0.05, pan); return; }
    // хрусть: 5–8 зёрен за ~80 мс + мягкое тело
    const n = 5 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) this.burst(this.rnd(0.006, 0.014), 'bandpass', this.rnd(1100, 2600), this.rnd(0.12, 0.22), 1.4, { at: i * this.rnd(0.008, 0.014), pan });
    this.burst(0.06, 'lowpass', 500, 0.28, 1, { pan });
  },
  frostCrack(pan) { this.burst(0.02, 'bandpass', this.rnd(1400, 2200), 0.25, 3, { pan }); this.burst(0.3, 'lowpass', 300, 0.08, 1, { at: 0.02, pan }); },
  // музыкальные сигналы: 'epoch' | 'death' | 'win' | 'quiet'
  sting(kind) {
    if (!this.ok()) return;
    const N = m => 440 * Math.pow(2, (m - 69) / 12);
    this._mus = true; this._layer = this.musicG;
    try {
      const seq = { win: [[60, 64, 67], [65, 69, 72], [67, 71, 74], [72, 76, 79]], death: [[57, 60, 64], [53, 57, 60], [52, 56, 59]], quiet: [[57, 64, 69], [53, 60, 65]], epoch: [[60, 67], [64, 72]] }[kind] || [[60, 64, 67]];
      const dt = kind === 'epoch' ? 0.18 : 0.9;
      seq.forEach((ch, i) => ch.forEach(m => { this.tone('triangle', N(m), N(m), dt * 2.5, 0.09 * this.LV.sting, 0, { at: i * dt, a: 0.08, lp: 1800 }); }));
    } finally { this._mus = false; this._layer = null; }
  },

  // ---------- музыка ----------
  // Сетка: доля 0.6 с, такт 4 доли, аккорд — 2 такта (ночью 3), фраза — 4 аккорда.
  // Фразы берутся из банка случайно (без повтора подряд) → не бывает вечной петли из 4 аккордов.
  BANK: {
    day: [['Am', 'F', 'C', 'G'], ['Am', 'Em', 'F', 'G'], ['C', 'G', 'Am', 'F'], ['Dm', 'Am', 'Esus', 'Am'], ['F', 'C', 'Dm', 'Am'], ['Am', 'G', 'F', 'Em'], ['C', 'Em', 'F', 'Am']],
    night: [['Am9', 'Fmaj7', 'Dm7', 'Esus'], ['Em', 'Cmaj7', 'Am7', 'Bdim'], ['Dm7', 'Am9', 'Fmaj7', 'Em'], ['Am9', 'Dm7', 'Am9', 'Esus']],
    alarm: [['Am', 'Bb', 'Am', 'E'], ['Dm', 'Eb', 'Dm', 'A'], ['Am', 'Bb', 'Gm', 'E'], ['Em', 'F', 'Em', 'B']],
    finale: [['C', 'G', 'Am', 'F'], ['C', 'F', 'G', 'C'], ['F', 'G', 'Em', 'Am'], ['F', 'G', 'C', 'C']],
  },
  CH: { Am: [57, 60, 64], F: [53, 57, 60], C: [48, 52, 55, 60], G: [55, 59, 62], Em: [52, 55, 59], Dm: [50, 53, 57], Esus: [52, 57, 59], E: [52, 56, 59], Bb: [58, 62, 65], Eb: [51, 55, 58], A: [57, 61, 64], Gm: [55, 58, 62], B: [59, 63, 66],
    Am9: [57, 60, 64, 71], Fmaj7: [53, 57, 60, 64], Dm7: [50, 53, 57, 60], Cmaj7: [48, 52, 55, 59], Am7: [57, 60, 64, 67], Bdim: [59, 62, 65] },
  midi(m) { return 440 * Math.pow(2, (m - 69) / 12); },
  pad(f, dur, vol) {
    if (!this.ok()) return;
    const c = this.ctx, t = c.currentTime, g = c.createGain(), fl = c.createBiquadFilter();
    fl.type = 'lowpass'; fl.frequency.value = 1400; fl.Q.value = 0.5;
    for (const [type, det] of [['triangle', 0], ['sawtooth', 7]]) {
      const o = c.createOscillator(), og = c.createGain(); o.type = type; o.frequency.value = f; o.detune.value = det + this.rnd(-3, 3);
      og.gain.value = type === 'sawtooth' ? 0.25 : 1; o.connect(og); og.connect(fl); o.start(t); o.stop(t + dur + 0.1);
    }
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.3); g.gain.setValueAtTime(vol, t + dur * 0.6); g.gain.linearRampToValueAtTime(0, t + dur);
    fl.connect(g); g.connect(this.bus());
  },
  bell(f, vol, at = 0) { this.tone('sine', f, f, 1.4, vol, this.rnd(-0.4, 0.4), { at, a: 0.005 }); this.tone('sine', f * 2.76, f * 2.76, 0.5, vol * 0.25, 0, { at, a: 0.005 }); },
  flute(f, dur, vol, at = 0) {
    if (!this.ok()) return;
    const c = this.ctx, t = c.currentTime + at, o = c.createOscillator(), v = c.createOscillator(), vg = c.createGain(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = f; v.frequency.value = 5; vg.gain.value = f * 0.006; v.connect(vg); vg.connect(o.frequency);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.09); g.gain.setValueAtTime(vol, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(this.bus()); o.start(t); v.start(t); o.stop(t + dur + 0.05); v.stop(t + dur + 0.05);
    this.burst(0.08, 'bandpass', f * 2, vol * 0.15, 2, { at }); // дыхание
  },
  // варган: пила через плывущий полосовой фильтр — «уэн-уэн»
  vargan(f, vol, at = 0) {
    if (!this.ok()) return;
    const c = this.ctx, t = c.currentTime + at, o = c.createOscillator(), bp = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = f; bp.type = 'bandpass'; bp.Q.value = 6;
    bp.frequency.setValueAtTime(350, t); bp.frequency.exponentialRampToValueAtTime(this.rnd(900, 1300), t + 0.18); bp.frequency.exponentialRampToValueAtTime(450, t + 0.5);
    this.env(g, t, 0.006, vol, 0.55); o.connect(bp); bp.connect(g); g.connect(this.bus()); o.start(t); o.stop(t + 0.65);
  },
  drum(vol, at = 0) { this.tone('sine', 120, 48, 0.35, vol, 0, { at, a: 0.004 }); this.burst(0.05, 'lowpass', 900, vol * 0.3, 1, { at }); },
  music(dt, tension, night) {
    this.mT = (this.mT || 0) - dt; if (this.mT > 0) return;
    this.mT += 0.6; if (this.mT < 0) this.mT = 0.6;
    this.mStep = (this.mStep || 0) + 1;
    this._mus = true; try { this.musicStep(tension, night); } finally { this._mus = false; this._layer = null; }
  },
  // целевые громкости слоёв: день ↔ ночь ↔ тревога (финал перекрывает всё)
  mix(tension, night) {
    const a = Math.max(0, Math.min(1, (tension - 45) / 30)), n = Math.max(0, Math.min(1, night));
    const T = this.mood === 'finale' ? { day: 0, night: 0, alarm: 0, finale: 1 } : this.mood === 'quiet' ? { day: 0, night: 0.6, alarm: 0, finale: 0 }
      : { day: (1 - n) * (1 - a), night: n * (1 - a), alarm: a, finale: 0 };
    const t = this.ctx.currentTime;
    for (const k in T) { this.layV[k] += (T[k] - this.layV[k]) * 0.25; this.lay[k].gain.setTargetAtTime(T[k], t, 2.5); }
  },
  nextPhrase(mood) {
    const B = this.BANK[mood]; let i;
    do i = (Math.random() * B.length) | 0; while (B.length > 1 && i === this.lastPh);
    this.lastPh = i; this.phrase = B[i]; this.phMood = mood;
  },
  musicStep(tension, night) {
    this.mix(tension, night);
    const L = this.layV, beat = this.mStep % 4, s = this.mStep;
    // главный слой определяет гармонию
    const lead = Object.keys(L).reduce((a, b) => L[a] >= L[b] ? a : b);
    const barLen = lead === 'night' ? 12 : 8;
    this.chT = (this.chT || 0) + 1;
    if (!this.phrase || this.chT > barLen * 4 || (lead !== this.phMood && beat === 0 && L[lead] > 0.6)) { this.nextPhrase(lead); this.chT = 1; }
    const ci = Math.min(3, Math.floor((this.chT - 1) / barLen)), newCh = (this.chT - 1) % barLen === 0;
    const ch = this.CH[this.phrase[ci]], F = ch.map(m => this.midi(m));
    const on = k => L[k] > 0.04;
    // ДЕНЬ: мягкий пэд, бас, колокольчики, иногда флейта-мотив
    if (on('day')) {
      this._layer = this.lay.day;
      if (newCh) { for (const f of F.slice(0, 3)) this.pad(f, 5, 0.05); this.tone('triangle', F[0] / 2, F[0] / 2, 4, 0.12, 0, { a: 0.05, lp: 500 }); }
      if (beat === 0 && Math.random() < 0.35) { const f = F[(Math.random() * F.length) | 0] * 2; this.bell(f, 0.05); if (Math.random() < 0.5) this.bell(f * 1.5, 0.025, 0.3); }
      if (newCh && Math.random() < 0.3) { const mel = [0, 1, 2, 1].map(i => F[i % F.length] * 2); mel.forEach((f, i) => this.flute(f, 0.55, 0.06, i * 0.6 + 0.6)); }
    }
    // НОЧЬ: ниже, реже, варган и холодные колокольчики
    if (on('night')) {
      this._layer = this.lay.night;
      if (newCh) { for (const f of F) this.pad(f, 7.4, 0.04); this.tone('sine', F[0] / 2, F[0] / 2, 7, 0.12, 0, { a: 0.4 }); this.tone('triangle', F[0] / 4, F[0] / 4, 6, 0.08, 0, { a: 0.8, lp: 300 }); }
      if (beat === 2 && Math.random() < 0.18) this.bell(F[(Math.random() * F.length) | 0] * 4, 0.03);
      if (beat === 0 && (s % 24) < 8 && Math.random() < 0.5) { const f = F[0] / 2; this.vargan(f, 0.07); this.vargan(f, 0.05, 0.3); }
    }
    // ТРЕВОГА: пульс баса, барабан, диссонанс
    if (on('alarm')) {
      this._layer = this.lay.alarm;
      const k = Math.max(0.4, Math.min(1, (tension - 45) / 45));
      if (newCh) for (const f of F.slice(0, 3)) this.pad(f, 4.8, 0.035);
      this.tone('sawtooth', F[0] / 2, F[0] / 2, 0.25, 0.09 * k, 0, { lp: 600 }); this.tone('sawtooth', F[0] / 2, F[0] / 2, 0.2, 0.06 * k, 0, { lp: 600, at: 0.3 });
      if (beat === 0 || beat === 2) this.drum(0.28 * k);
      if (beat === 3 && Math.random() < 0.4) { this.drum(0.15 * k, 0.15); this.drum(0.18 * k, 0.3); }
      if (beat === 1 && Math.random() < 0.3) this.tone('triangle', F[1] * 2, F[1] * 2 * 1.06, 0.5, 0.04 * k, 0, { lp: 1500 });
    }
    // ФИНАЛ: мажорный подъём, колокола на каждой доле
    if (on('finale')) {
      this._layer = this.lay.finale;
      if (newCh) { for (const f of F) this.pad(f, 5, 0.05); this.tone('triangle', F[0] / 2, F[0] / 2, 4.5, 0.12, 0, { a: 0.05, lp: 500 }); this.flute(F[2] * 2, 1.1, 0.05, 0.6); this.flute(F[1] * 2, 1.1, 0.045, 1.8); }
      if (Math.random() < 0.6) this.bell(F[(beat + (s >> 2)) % F.length] * 2, 0.04);
    }
  },
  setMood(m) { this.mood = m || null; this.chT = 1e9; },

  // ветер → уровни звука (монотонно по м/с): тихий мороз ~0.035, день ~0.07, пурга 0.35–0.55; свист с 9 м/с
  windLevel(ms, inside) {
    const k = Math.max(0, Math.min(1, ms / 18)), sm = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
    const gain = (0.03 + 0.52 * Math.pow(k, 1.3)) * (inside ? 0.35 : 1);
    return (this.wind = { ms, gain, whistle: 0.35 * sm(9, 16, ms), q: 0.9 - 0.4 * sm(8, 15, ms) });
  },
  // --- каждый кадр ---
  frame(dt, o) {
    if (!this.ctx) return;
    if (this.on) this.music(dt, o.tension, o.night);
    const t = this.ctx.currentTime;
    if (!this._ambOff) {
      // ветер — только из единого Wind (js/wind.js) у героя: громкость, «свист» и ширина полосы — от м/с
      const L = this.windLevel(o.ms != null ? o.ms : 4.5 * 0.6, o.inside);
      this.windG.gain.setTargetAtTime(L.gain, t, 0.6);
      this.windF.Q.setTargetAtTime(L.q, t, 1);
      this.whG.gain.setTargetAtTime(L.whistle, t, 1.2);
    }
    this.droneG.gain.setTargetAtTime(Math.max(0, o.tension - 30) / 70 * 0.07, t, 1);
    // огонь: гул + треск (короткие щелчки, без долгих верхов)
    this.fireG.gain.setTargetAtTime((o.fire || 0) * 0.14, t, 0.4);
    if (o.fire > 0) { this.crackT -= dt; if (this.crackT <= 0) { this.crackT = 1 / (3 + o.fire * 6) * (0.4 + Math.random() * 1.2); const cr = () => this.fx('fire', () => this.burst(this.rnd(0.008, 0.02), 'bandpass', this.rnd(1200, 2800), this.rnd(0.12, 0.3) * o.fire, 1.5, { pan: this.rnd(-0.3, 0.3) })); if (o.fireAt) { const P = this.spatial(o.fireAt.x, o.fireAt.y); this._at = P && { P: { g: 1, pan: P.pan, lp: P.lp } }; try { cr(); } finally { this._at = null; } } else cr(); } } // треск — с той стороны, где огонь (громкость уже от расстояния в o.fire)
    // сердцебиение: «тук-тук» с обертоном, слышно и на ноутбуке
    if (o.tension > 55 || o.warm < 20) {
      const bpm = 60 + Math.min(80, Math.max(o.tension - 50, (20 - o.warm) * 3) * 1.6);
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 60 / bpm;
        this.fx('heart', () => {
          this.tone('sine', 62, 45, 0.1, 0.5, 0, { a: 0.006 }); this.tone('triangle', 124, 90, 0.08, 0.3, 0, { lp: 320 });
          this.tone('sine', 56, 42, 0.09, 0.35, 0, { at: 0.24 }); this.tone('triangle', 112, 84, 0.07, 0.2, 0, { at: 0.24, lp: 320 });
        });
      }
    }
    // вертолёт затухает сам
    if (this.rotorG && this.heliUntil < 1e8) this.rotorG.gain.setTargetAtTime(t < this.heliUntil ? (this.heliLvl || 0.8) : 0, t, t < this.heliUntil ? 0.6 : 1.2);
    // шаги — по состоянию игрока (без хуков в game.js)
    const P = typeof G !== 'undefined' && G && G.p;
    if (P && P.moving && !P.blocked && !P.sleeping && !P.action) {
      const dk = typeof Depth !== 'undefined' ? Depth.heroSink : 0; // провал в снег, см (js/depth.js): глубже — глуше и реже, шорох
      const surf = P.inside ? 'wood' : (typeof onIce === 'function' && onIce(P.x, P.y)) ? 'ice' : G.gear && G.gear.skis ? 'ski' : dk > 30 ? 'deep' : 'snow';
      this.stepT -= dt; if (this.stepT <= 0) { this.stepT = (surf === 'ski' ? 0.55 : surf === 'deep' ? 0.42 + dk / 250 : 0.34) * this.rnd(0.92, 1.08); this.step(surf, dk); }
    } else this.stepT = Math.min(this.stepT, 0.08);
    // ночью в лютый мороз трещат деревья
    if (o.night > 0.6 && !o.storm) { this.frostT -= dt; if (this.frostT <= 0) { this.frostT = this.rnd(14, 40); this.frostCrack(this.rnd(-0.9, 0.9)); } }
  },
  // финал/кат-сцены: музыка + ветер + ротор без игрового состояния
  cinema(dt, o = {}) {
    if (!this.ctx) return;
    if (o.mood !== undefined && o.mood !== this.mood) this.setMood(o.mood);
    if (this.on) this.music(dt, 0, o.night || 0);
    const t = this.ctx.currentTime;
    if (!this._ambOff) this.windG.gain.setTargetAtTime(o.wind != null ? o.wind : 0.08, t, 0.5);
    this.droneG.gain.setTargetAtTime(0, t, 1);
    if (o.rotor != null) this.rotor(o.rotor, o.pan || 0);
  },
};
// калибровочный множитель громкости на каждый эффект (см. Sound.LV)
for (const [k, lv] of [['chop'], ['pick'], ['ok2'], ['hit'], ['bite'], ['splash'], ['creak'], ['shot'], ['howl'], ['growl'], ['treeCrack'], ['thud'], ['step'], ['frostCrack', 'frost']]) {
  const f = Sound[k]; Sound[k] = function (...a) { return this.fx(lv || k, () => f.apply(this, a)); };
}
// вой и рык — событие мира: герой вздрагивает (Interact 'howl', js/hero.js)
for (const k of ['howl', 'growl']) {
  const f = Sound[k]; Sound[k] = function (...a) { if (typeof Interact !== 'undefined' && typeof G !== 'undefined' && G && G.p) Interact.emit('howl', { who: k, x: G.p.x, y: G.p.y }); return f.apply(this, a); };
}
