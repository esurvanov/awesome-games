// Фасад звука «Житьё»: эффекты, голоса симов, музыка по режимам, петли (огонь, пищалка).
// Старт — по первому жесту игрока. Громкости хранятся в localStorage.
import { E, SFX, LOOPS } from './engine.js';
import { speak, voiceOf } from './voice.js';
import { Music } from './music.js';

const LS = 'zhitie.audio';
function loadPrefs() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } }
function savePrefs(p) { try { localStorage.setItem(LS, JSON.stringify(p)); } catch { /* приватный режим */ } }

const prefs = { music: true, sound: true, musicVol: 0.55, sfxVol: 0.8, ...loadPrefs() };
E.on = prefs.sound;
E.setSfxVol(prefs.sfxVol);
Music.setVol(prefs.musicVol);
Music.setOn(prefs.music);
const loops = new Map(); // имя → {left}

export const audio = {
  get ready() { return !!E.ctx && E.ctx.state === 'running'; },
  get musicOn() { return Music.on; },
  get soundOn() { return E.on; },
  get musicVol() { return Music.vol; },
  get sfxVol() { return E.sfxVol; },
  // вызвать из обработчика жеста (pointerdown/keydown) — браузеры не дают стартовать раньше
  unlock() { E.init(); if (E.ctx) { E.setSfxVol(E.sfxVol); Music.setOn(Music.on); } },
  sfx(name) { SFX[name]?.(); },
  speak(sim, opts = {}) { return speak({ ...voiceOf(sim, opts.h01 ?? 0.5), ...opts }); },
  setMode(m) { Music.setMode(m); },
  toggleMusic() { Music.setOn(!Music.on); prefs.music = Music.on; savePrefs(prefs); return Music.on; },
  toggleSound() { E.setOn(!E.on); prefs.sound = E.on; savePrefs(prefs); return E.on; },
  setMusicVol(v) { Music.setVol(v); prefs.musicVol = v; savePrefs(prefs); },
  setSfxVol(v) { E.setSfxVol(v); prefs.sfxVol = v; savePrefs(prefs); },
  // петля: loop('fire', true) — треск, пока огонь; loop('smoke', true) — пищалка
  loop(name, on) { if (on && !loops.has(name)) loops.set(name, { left: 0 }); if (!on) loops.delete(name); },
  get loops() { return [...loops.keys()]; },
  frame(dt = 1 / 60) {
    Music.frame();
    for (const [name, l] of loops) {
      l.left -= dt;
      if (l.left > 0) continue;
      const L = LOOPS[name]; if (!L) continue;
      l.left = L.every[0] + Math.random() * (L.every[1] - L.every[0]);
      SFX[L.play]?.();
    }
  },
};
export { SFX };
