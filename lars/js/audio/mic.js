// Микрофон для «сказать своё»: запись по нажатию (getUserMedia + MediaRecorder) и уровень громкости для индикатора.
// Нужен защищённый контекст: https, localhost или file:// в Chromium (window.isSecureContext). Нет — кнопка скрыта,
// остаётся ввод текстом. Поток держим открытым 20 с после записи (чтобы не спрашивать разрешение на каждую фразу).
'use strict';
L.def('audio/mic', () => {
const MAX_SEC = 20, MIN_SEC = 0.35, IDLE_MS = 20000;
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

const Mic = {
  denied: false, stream: null, rec: null, chunks: [], t0: 0, level: 0, recording: false, starting: false,
  ctx: null, an: null, src: null, raf: 0, idle: 0, onLevel: null, onAuto: null, wantStop: false,
  ok() {
    return !this.denied && typeof window !== 'undefined' && !!window.isSecureContext && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && typeof MediaRecorder !== 'undefined';
  },
  why() {
    if (this.denied) return 'доступ запрещён';
    if (!window.isSecureContext) return 'нужен https или localhost';
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) || typeof MediaRecorder === 'undefined') return 'браузер не умеет';
    return '';
  },
  mime() { for (const t of TYPES) try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) {} return ''; },
  // → true | false (нет доступа)
  async start() {
    if (this.recording || this.starting) return true;
    if (!this.ok()) return false;
    this.starting = true; this.wantStop = false; clearTimeout(this.idle);
    try {
      if (!this.stream || !this.stream.active) this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      this.starting = false;
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) this.denied = true;
      console.warn('mic', e && e.name);
      return false;
    }
    const m = this.mime();
    try { this.rec = new MediaRecorder(this.stream, m ? { mimeType: m } : undefined); } catch (e) { this.starting = false; console.warn('mic rec', e); return false; }
    this.chunks = [];
    this.rec.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.start(250);
    this.t0 = performance.now(); this.recording = true; this.starting = false;
    this.meter();
    this.auto = setTimeout(() => { if (this.recording && this.onAuto) this.onAuto(); }, MAX_SEC * 1000);
    if (this.wantStop) { this.wantStop = false; if (this.onAuto) this.onAuto(); }
    return true;
  },
  meter() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!this.ctx) this.ctx = new AC();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.src = this.ctx.createMediaStreamSource(this.stream);
      this.an = this.ctx.createAnalyser(); this.an.fftSize = 512; this.src.connect(this.an);
    } catch (e) { this.an = null; }
    const buf = new Uint8Array(512);
    const tick = () => {
      if (!this.recording) return;
      if (this.an) { this.an.getByteTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; } this.level = Math.min(1, Math.sqrt(s / buf.length) * 4); }
      if (this.onLevel) this.onLevel(this.level);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  },
  // → Promise<{ blob, sec } | null> (null — слишком коротко или не записывали)
  stop() {
    if (this.starting) { this.wantStop = true; return Promise.resolve(null); }
    if (!this.recording || !this.rec) return Promise.resolve(null);
    const rec = this.rec, sec = (performance.now() - this.t0) / 1000;
    this.recording = false; clearTimeout(this.auto); cancelAnimationFrame(this.raf); this.level = 0; if (this.onLevel) this.onLevel(0);
    try { this.src && this.src.disconnect(); } catch (e) {}
    return new Promise(res => {
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: (rec.mimeType || 'audio/webm').split(';')[0] });
        this.chunks = []; this.rec = null; this.release();
        res(sec < MIN_SEC || !blob.size ? null : { blob, sec });
      };
      try { rec.stop(); } catch (e) { res(null); }
    });
  },
  cancel() { if (this.recording) this.stop(); this.wantStop = this.starting; },
  release() { clearTimeout(this.idle); this.idle = setTimeout(() => { if (!this.recording && this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; } }, IDLE_MS); },
};
return { Mic, MIN_SEC, MAX_SEC };
});
