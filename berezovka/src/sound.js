// Берёзовка — звук. Записанные сэмплы (assets/sfx/*.mp3, CC0 / PD / CC-BY, см. assets/sfx/credits.json)
// + синтез как запасной вариант, пока файл не загрузился.
// API для index.html: makeSound(env) -> {AU,SFX,audioInit,nBurst,tone,radioTick,update,gate}
//   env.g() -> {player,carS,driving,WX,keys,bear,dog,cat,bellPivot,camera,L,terrainH,onIce,roadDist}

const BASE = new URL('../assets/sfx/', import.meta.url).href;
// variants per sound; file = <name>.mp3 or <name>_<i>.mp3
const BANK = {
  step_snow: ['step_snow_0', 'step_snow_1', 'step_snow_2', 'step_snow_3', 'step_snow_4'],
  step_hard: ['step_hard_0', 'step_hard_1', 'step_hard_2', 'step_hard_3', 'step_hard_4'],
  wind: ['wind'], amb: ['amb'], engine: ['engine'], engine_start: ['engine_start'],
  bell: ['bell'], bark: ['bark_0', 'bark_1', 'bark_2'], roar: ['roar_0', 'roar_1'],
  meow: ['meow_0', 'meow_1', 'meow_2'], boom: ['boom_0', 'boom_1'], launch: ['launch'],
  splash: ['splash'], hit: ['hit', 'hit_1'], pick: ['pick'], quest: ['quest'], fail: ['fail'],
  talk: ['talk'], creak: ['creak'], door: ['door'], ice: ['ice'], radio: ['radio'],
};
const FILES = [...new Set(Object.values(BANK).flat())];
// one-shot "loud" sounds whose loudness must sit in the −18…−12 LUFS band (gate)
const LOUD = ['bell', 'bark_0', 'bark_1', 'bark_2', 'roar_0', 'roar_1', 'boom_0', 'boom_1', 'hit', 'hit_1', 'splash', 'meow_0', 'meow_1', 'meow_2', 'quest', 'engine_start', 'engine'];

const BUF = {}, BYTES = {}, ERR = [];
let decoder = null;
function getDecoder() {
  if (!decoder) { const O = window.OfflineAudioContext || window.webkitOfflineAudioContext; decoder = new O(1, 1, 44100); }
  return decoder;
}
// start fetching at import time; AudioBuffers are context-independent, so decode offline right away
// один повтор: при загрузке сцены сервер/сеть изредка обрывает один из 37 запросов
const load1 = n => fetch(BASE + n + '.mp3')
  .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
  .then(ab => { BYTES[n] = ab.byteLength; return getDecoder().decodeAudioData(ab); })
  .then(b => { BUF[n] = b; });
const LOADED = Promise.all(FILES.map(n => load1(n)
  .catch(() => new Promise(r => setTimeout(r, 400)).then(() => load1(n)))
  .catch(e => { ERR.push(n + ':' + (e && e.message || e)); })));

// Korobeiniki — fallback melody if the recording is missing
const MEL = (() => {
  const n = { A4: 440, B4: 493.9, C5: 523.3, D5: 587.3, E5: 659.3, F5: 698.5, G5: 784, A5: 880 }; const q = 1, e = .5, dq = 1.5, h = 2;
  const a = [['E5', q], ['B4', e], ['C5', e], ['D5', q], ['C5', e], ['B4', e], ['A4', q], ['A4', e], ['C5', e], ['E5', q], ['D5', e], ['C5', e], ['B4', dq], ['C5', e], ['D5', q], ['E5', q], ['C5', q], ['A4', q], ['A4', h],
    [0, e], ['D5', q], ['F5', e], ['A5', q], ['G5', e], ['F5', e], ['E5', dq], ['C5', e], ['E5', q], ['D5', e], ['C5', e], ['B4', q], ['B4', e], ['C5', e], ['D5', q], ['E5', q], ['C5', q], ['A4', q], ['A4', q], [0, q]];
  return a.map(([k, d]) => [k ? n[k] : 0, d]);
})();

export function makeSound(env) {
  const AU = { radioT: 0, radioI: 0, last: {}, test: false, calls: 0 };
  const G = () => env.g();

  function audioInit() {
    if (AU.ctx) return;
    try {
      const C = new (window.AudioContext || window.webkitAudioContext)(); AU.ctx = C;
      AU.master = C.createGain(); AU.master.gain.value = .7; AU.master.connect(C.destination);
      AU.nul = C.createGain(); AU.nul.gain.value = 0; AU.nul.connect(C.destination);
      const nb = C.createBuffer(1, C.sampleRate * 2, C.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++)d[i] = Math.random() * 2 - 1; AU.noise = nb;
      // radio bus: slightly band-limited "car speaker"
      const rf = C.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 1400; rf.Q.value = .35; const rg = C.createGain(); rg.gain.value = .55; rf.connect(rg).connect(AU.master); AU.radio = rf;
      ensureLoops();
    } catch (e) { }
  }
  // looping beds (wind, village ambience, engine) — created as soon as ctx and buffers exist
  function loop(name, gain, dest) {
    const C = AU.ctx, b = BUF[name]; if (!b) return null;
    const s = C.createBufferSource(); s.buffer = b; s.loop = true; s.loopStart = .03; s.loopEnd = b.duration - .03; // skip mp3 padding
    const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 18000;
    const g = C.createGain(); g.gain.value = gain; s.connect(f).connect(g).connect(dest || AU.master); s.start(0, Math.random() * b.duration * .9);
    return { s, f, g };
  }
  function ensureLoops() {
    if (!AU.ctx) return;
    if (!AU.wind) AU.wind = loop('wind', .2);
    if (!AU.amb) AU.amb = loop('amb', .5);
    if (!AU.eng) AU.eng = loop('engine', 0);
  }

  // ---------- synth (fallback + nBurst used directly by the game) ----------
  function nBurst(dur, freq, type, gain, q = 1, when = 0, dest) { if (!AU.ctx) return; const C = AU.ctx, t = C.currentTime + when; const s = C.createBufferSource(); s.buffer = AU.noise; const f = C.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = C.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur); s.connect(f).connect(g).connect(dest || (AU.test ? AU.nul : AU.master)); s.start(t, Math.random() * 1.5); s.stop(t + dur + .05) }
  function tone(freq, dur, type = 'sine', gain = .2, when = 0, glide, dest) { if (!AU.ctx) return; const C = AU.ctx, t = C.currentTime + when; const o = C.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur); const g = C.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + dur); o.connect(g).connect(dest || (AU.test ? AU.nul : AU.master)); o.start(t); o.stop(t + dur + .05) }
  const SYN = {
    step() { nBurst(.09, 2600 + Math.random() * 1800, 'highpass', .07, .7); nBurst(.06, 700, 'bandpass', .05, 1.5) },
    pick() { tone(880, .12, 'triangle', .18); tone(1320, .18, 'triangle', .15, .08) },
    quest() { [523, 659, 784, 1046].forEach((f, i) => tone(f, .35, 'triangle', .14, i * .09)) },
    talk() { tone(420 + Math.random() * 120, .06, 'square', .03) },
    bell() { const b = 196;[[.5, .5, 6], [1, .35, 5], [1.19, .25, 4], [1.5, .2, 3.5], [2, .18, 3], [2.51, .1, 2], [2.66, .08, 2], [3.01, .06, 1.6]].forEach(([m, g, d]) => tone(b * m, d, 'sine', g)) },
    roar() { tone(90, 1.1, 'sawtooth', .18, 0, 55); nBurst(1, 300, 'lowpass', .25, 1) },
    bark() { tone(520, .12, 'sawtooth', .1, 0, 300); tone(480, .12, 'sawtooth', .08, .18, 280) },
    boom() { nBurst(1.4, 160, 'lowpass', .5, .8); nBurst(.8, 2400, 'bandpass', .08, .5, .1) },
    launch() { tone(300, .9, 'sine', .04, 0, 1200); nBurst(.7, 3000, 'highpass', .03, .5) },
    hit() { nBurst(.3, 300, 'lowpass', .4, 1); tone(80, .2, 'square', .1, 0, 40) },
    start() { nBurst(.5, 500, 'lowpass', .2, 1); tone(60, .6, 'sawtooth', .15, 0, 90) },
    splash() { nBurst(.4, 900, 'bandpass', .2, .8) },
    meow() { tone(700, .35, 'triangle', .12, 0, 900); tone(900, .25, 'triangle', .08, .3, 600) },
    fail() { tone(300, .25, 'square', .08, 0, 150) },
    creak() { tone(180, .5, 'sawtooth', .04, 0, 240) }, door() { nBurst(.3, 400, 'lowpass', .2, 1) }, ice() { nBurst(.2, 1800, 'highpass', .03, .5) },
  };

  // ---------- sample playback ----------
  // o: {gain, rate, pos:{x,y,z}, ref (m, full level radius), roll}
  function play(key, o = {}) {
    const C = AU.ctx; if (!C) return false;
    const vs = BANK[key].filter(n => BUF[n]); if (!vs.length) return false;
    let n = vs[Math.floor(Math.random() * vs.length)];
    if (vs.length > 1 && n === AU.last[key]) n = vs[(vs.indexOf(n) + 1) % vs.length]; AU.last[key] = n;
    const s = C.createBufferSource(); s.buffer = BUF[n]; s.playbackRate.value = o.rate || 1;
    const g = C.createGain(); g.gain.value = o.gain == null ? 1 : o.gain;
    let node = s.connect(g);
    if (o.pos) {
      const cp = G().camera.position, d = Math.hypot(o.pos.x - cp.x, o.pos.y - cp.y, o.pos.z - cp.z);
      if (d > (o.max || 600)) return true;                         // out of earshot
      const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = Math.max(700, 18000 * Math.exp(-d / 140)); // air absorption
      const p = C.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = o.ref || 5; p.rolloffFactor = o.roll || 1; p.maxDistance = 10000;
      if (p.positionX) { p.positionX.value = o.pos.x; p.positionY.value = o.pos.y; p.positionZ.value = o.pos.z } else p.setPosition(o.pos.x, o.pos.y, o.pos.z);
      node = node.connect(f).connect(p);
    }
    node.connect(AU.test ? AU.nul : AU.master);
    s.start(C.currentTime + (o.when || 0));
    return true;
  }
  const P = (v, y = 0) => v ? { x: v.x, y: (v.y || 0) + y, z: v.z } : null;
  function bellPos() {
    const e = G();
    if (e.bellPivot && e.bellPivot.getWorldPosition) { const v = e.bellPivot.getWorldPosition(new e.camera.position.constructor()); return P(v) }
    const c = e.L.church; return { x: c[0], y: e.terrainH(c[0], c[1]) + 14, z: c[1] };
  }
  function skyPos() { const e = G(), c = e.L.church; return { x: c[0], y: e.terrainH(c[0], c[1]) + 48, z: c[1] } }
  const R = (a, b) => a + Math.random() * (b - a);

  const REC = {
    step() {
      const p = G().player, e = G(); const hard = e.onIce(p.pos.x, p.pos.z) || e.roadDist(p.pos.x, p.pos.z) <= 0;
      const sp = Math.min(p.spd || 0, 9), run = sp > 5;
      return play(hard ? 'step_hard' : 'step_snow', { gain: (run ? .75 : .55) * (hard ? .9 : 1), rate: (.88 + sp * .03) * R(.95, 1.05) });
    },
    pick() { return play('pick', { gain: .8 }) },
    quest() { return play('quest', { gain: .9 }) },
    talk() { return play('talk', { gain: .35, rate: R(.9, 1.15) }) },
    bell() { return play('bell', { gain: 1.3, pos: bellPos(), ref: 35, roll: .8, max: 2000 }) },
    roar() { const b = G().bear; return play('roar', { gain: 1.2, rate: R(.92, 1.04), pos: b && P(b.pos, 1), ref: 10 }) },
    bark() { const d = G().dog; return play('bark', { gain: 1, rate: R(.95, 1.08), pos: d && P(d.pos, .6), ref: 6 }) },
    boom() { return play('boom', { gain: 1.2, rate: R(.85, 1.1), pos: skyPos(), ref: 90, roll: .7, max: 3000 }) },
    launch() { return play('launch', { gain: .7, rate: R(.9, 1.2), pos: skyPos(), ref: 50, max: 2000 }) },
    hit() { return play('hit', { gain: .9, rate: R(.85, 1.05) }) },
    start() { return play('engine_start', { gain: .8 }) },
    splash() { return play('splash', { gain: .8, rate: R(.9, 1.1) }) },
    meow() { const c = G().cat; return play('meow', { gain: .9, rate: R(.95, 1.1), pos: c && P(c.pos, .3), ref: 4 }) },
    fail() { return play('fail', { gain: .6 }) },
    creak() { return play('creak', { gain: .7, rate: R(.9, 1.1) }) },
    door() { return play('door', { gain: .7 }) },
    ice() { return play('ice', { gain: .5, rate: R(.8, 1.2) }) },
  };
  const SFX = {};
  for (const k of Object.keys(SYN)) SFX[k] = function () { AU.calls++; try { if (!REC[k] || !REC[k]()) SYN[k]() } catch (e) { AU.err = (AU.err || 0) + 1; AU.lastErr = k + ':' + e.message } };

  // ---------- radio: 1927 recording of «Коробушка» (accordion orchestra), synth accordion as fallback ----------
  function radioTick() {
    const C = AU.ctx; if (!C) return; const e = G(), on = e.carS.radio && e.driving;
    if (BUF.radio) {
      if (on && !AU.radioSrc) {
        const s = C.createBufferSource(); s.buffer = BUF.radio; s.loop = true; s.loopStart = .05; s.loopEnd = BUF.radio.duration - .05;
        const g = C.createGain(); g.gain.value = 1.1; s.connect(g).connect(AU.radio); s.start(0, AU.radioI ? 0 : 0); AU.radioSrc = s; AU.radioG = g;
      } else if (!on && AU.radioSrc) { const s = AU.radioSrc; AU.radioG.gain.setTargetAtTime(0, C.currentTime, .05); s.stop(C.currentTime + .3); AU.radioSrc = null }
      return;
    }
    if (!on) return; const bt = .2; if (AU.radioT < C.currentTime) AU.radioT = C.currentTime + .05;
    while (AU.radioT < C.currentTime + .4) {
      const [f, d] = MEL[AU.radioI % MEL.length]; const w = AU.radioT - C.currentTime;
      if (f) { tone(f * 1.003, d * bt * .9, 'sawtooth', .035, w, 0, AU.radio); tone(f * .997, d * bt * .9, 'sawtooth', .035, w, 0, AU.radio); tone(f / 2, d * bt * .9, 'square', .02, w, 0, AU.radio) } // reeds ±5 cents = accordion beating
      const bass = [82.4, 110, 82.4, 110][Math.floor(AU.radioI / 8) % 4]; if (AU.radioI % 2 === 0) { tone(bass, bt * .5, 'sawtooth', .05, w, 0, AU.radio); tone(bass * 2.5, bt * .4, 'sawtooth', .025, w + bt, 0, AU.radio) } // bass-chord "um-pa"
      AU.radioT += d * bt; AU.radioI++;
    }
  }

  // ---------- per-frame ----------
  function update(dt) {
    if (!AU.ctx) return; const C = AU.ctx, t = C.currentTime, e = G();
    ensureLoops();
    // listener = camera
    const cam = e.camera, L = C.listener, cp = cam.position;
    const fw = AU._fw || (AU._fw = new cp.constructor()), up = AU._up || (AU._up = new cp.constructor());
    cam.getWorldDirection(fw); up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    if (L.positionX) { L.positionX.value = cp.x; L.positionY.value = cp.y; L.positionZ.value = cp.z; L.forwardX.value = fw.x; L.forwardY.value = fw.y; L.forwardZ.value = fw.z; L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z }
    else { L.setPosition(cp.x, cp.y, cp.z); L.setOrientation(fw.x, fw.y, fw.z, up.x, up.y, up.z) }
    const storm = e.WX ? e.WX.storm : 0, ws = e.driving ? Math.abs(e.carS.spd) : e.player.spd;
    if (AU.wind) { AU.wind.g.gain.setTargetAtTime(Math.min(1, .16 + ws * .012 + storm * .7), t, .4); AU.wind.f.frequency.setTargetAtTime(1400 + ws * 250 + storm * 6000, t, .4); AU.wind.s.playbackRate.setTargetAtTime(.9 + storm * .25, t, 1) }
    if (AU.amb) AU.amb.g.gain.setTargetAtTime(.55 * (1 - storm * .8) * (e.driving ? .35 : 1), t, .8);
    const en = AU.eng;
    if (en) {
      if (e.driving) {
        const s = Math.abs(e.carS.spd), gear = s < 8 ? s / 8 : s < 16 ? (s - 8) / 8 : s < 24 ? (s - 16) / 8 : (s - 24) / 10;
        const rpm = 38 + gear * 55 + s * 1.2, thr = e.keys.KeyW || e.keys.ArrowUp;
        AU.engRate = Math.min(2.6, Math.max(.75, rpm / 46)); en.s.playbackRate.setTargetAtTime(AU.engRate, t, .06);
        en.f.frequency.setTargetAtTime(1200 + s * 120 + (thr ? 1500 : 0), t, .1);
        en.g.gain.setTargetAtTime(.38 + (thr ? .22 : 0), t, .12);
      } else en.g.gain.setTargetAtTime(0, t, .25);
    }
    radioTick();
  }

  // ---------- gate ----------
  function stats(b) {
    const x = b.getChannelData(0), W = Math.round(b.sampleRate * .05); let pk = 0; const p = [];
    for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > pk) pk = a }
    for (let i = 0; i + W <= Math.max(W, x.length); i += W) { let s = 0; for (let j = i; j < i + W && j < x.length; j++)s += x[j] * x[j]; p.push(s / W) }
    const mx = Math.max(...p); const act = p.filter(q => q > mx * .01);
    return { peak: 20 * Math.log10(pk + 1e-12), loud: -.691 + 10 * Math.log10(act.reduce((a, c) => a + c, 0) / act.length + 1e-12) };
  }
  async function gate() {
    await LOADED;
    for (let i = 0; i < 240 && !AU.ctx; i++) await new Promise(r => setTimeout(r, 500));   // wait for startGame → audioInit
    const out = [], ok = (n, v, band, good) => out.push(`GATE ${n} ${v} ${band} ${good ? 'OK' : 'FAIL'}`);
    const nL = Object.keys(BUF).length;
    ok('sfx_files_decoded', `${nL}/${FILES.length}${ERR.length ? '(' + ERR.join(',') + ')' : ''}`, `=${FILES.length}`, nL === FILES.length && !ERR.length);
    const tot = Object.values(BYTES).reduce((a, b) => a + b, 0), mx = Math.max(...Object.values(BYTES));
    ok('sfx_size_total_MB', (tot / 1048576).toFixed(2), '<=4.00', tot <= 4 * 1048576);
    ok('sfx_size_max_KB', (mx / 1024).toFixed(1), '<=150', mx <= 150 * 1024);
    const MAP = { start: ['engine_start'], step: ['step_snow', 'step_hard'] };
    const miss = Object.keys(SYN).filter(k => !(REC[k] && (MAP[k] || [k]).every(b => BANK[b] && BANK[b].every(n => BUF[n]))));
    const nS = Object.keys(SYN).length;
    ok('sfx_recorded', `${nS - miss.length}/${nS}${miss.length ? '(' + miss.join(',') + ')' : ''}`, `=${nS}`, !miss.length);
    const st = {}; for (const n of FILES) if (BUF[n]) st[n] = stats(BUF[n]);
    const pk = Math.max(...Object.values(st).map(s => s.peak));
    ok('sfx_peak_max_dBFS', pk.toFixed(2), '<=-3.0', pk <= -3.0);
    const lv = LOUD.filter(n => st[n]).map(n => st[n].loud).sort((a, b) => a - b), med = lv[Math.floor(lv.length / 2)];
    ok('sfx_loud_median_LUFSapprox', med.toFixed(1), '-18..-12', med >= -18 && med <= -12);
    ok('sfx_loud_spread_dB', (lv[lv.length - 1] - lv[0]).toFixed(1), '<=6', lv[lv.length - 1] - lv[0] <= 6);
    if (AU.ctx) {  // call every SFX through a muted bus; count exceptions
      AU.test = true; const e0 = AU.err || 0; for (const k of Object.keys(SFX)) SFX[k](); AU.test = false;
      ok('sfx_call_errors', (AU.err || 0) - e0, '=0', (AU.err || 0) === e0);
      ok('sfx_loops_running', ['wind', 'amb', 'eng'].filter(k => AU[k]).length + '/3', '=3', !!(AU.wind && AU.amb && AU.eng));
    } else ok('sfx_call_errors', 'no-ctx', '=0', false);
    window.__gates = (window.__gates || []).concat(out); out.forEach(s => console.log(s));
    if (ERR.length) console.log('sfx load errors', ERR.join(' '));
    return out;
  }

  return { AU, SFX, audioInit, nBurst, tone, radioTick, update, gate, BUF, play };
}
