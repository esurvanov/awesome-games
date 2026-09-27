// Огонь: state.lot.fires = [{x, y, level, power 0..1}] (Мозг). Языки пламени (аддитивные спрайты),
// дым, мерцающий оранжевый свет из фиксированного пула (без перекомпиляции шейдеров).
// Спрайты/частицы — приём particles pool из game/open-world.html :961-1000.
import * as THREE from 'three';
import { ctex } from './util.js';
import { LEVEL_H } from './lot.js';

const MAX_FIRE_LIGHTS = 3, FLAMES = 7, SMOKE = 6;

export function createFire(scene, state) {
  const root = new THREE.Group(); root.name = 'fire'; scene.add(root);
  const flameTex = ctex(64, 128, (x, w, h) => {
    const g = x.createRadialGradient(32, 90, 2, 32, 80, 60);
    g.addColorStop(0, 'rgba(255,250,200,1)'); g.addColorStop(0.25, 'rgba(255,190,60,.95)'); g.addColorStop(0.6, 'rgba(255,90,20,.6)'); g.addColorStop(1, 'rgba(200,30,0,0)');
    x.fillStyle = g; x.beginPath(); x.moveTo(32, 0); x.quadraticCurveTo(64, 70, 50, 120); x.lineTo(14, 120); x.quadraticCurveTo(0, 70, 32, 0); x.fill();
  }, false);
  const smokeTex = ctex(64, 64, (x) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,.8)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); }, false);
  const flameMat = new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xffffff });
  const lights = Array.from({ length: MAX_FIRE_LIGHTS }, () => { const l = new THREE.PointLight(0xff8a2a, 0, 8, 1.5); l.position.set(-100, -100, -100); scene.add(l); return l; });

  const fires = new Map(); // key → {group, flames, smoke, f}
  let t = 0, viewLevel = 0;
  const key = (f) => `${f.x},${f.y},${f.level || 0}`;

  function make(f) {
    const g = new THREE.Group(); g.position.set(f.x + 0.5, (f.level || 0) * LEVEL_H, f.y + 0.5);
    const flames = Array.from({ length: FLAMES }, (_, i) => { const s = new THREE.Sprite(flameMat); s.userData.ph = i / FLAMES; s.userData.dx = Math.sin(i * 2.3) * 0.28; s.userData.dz = Math.cos(i * 1.7) * 0.28; s.raycast = () => {}; g.add(s); return s; });
    const smoke = Array.from({ length: SMOKE }, (_, i) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0x3a3a3c, transparent: true, depthWrite: false })); s.userData.ph = i / SMOKE; s.raycast = () => {}; g.add(s); return s; });
    root.add(g);
    return { group: g, flames, smoke, f };
  }

  const F = {};
  F.setLevel = (l) => { viewLevel = l; };
  F.update = (dt, focus) => {
    t += dt;
    const list = state.lot.fires || [], seen = new Set();
    for (const f of list) { const k = key(f); seen.add(k); const r = fires.get(k); if (r) r.f = f; else fires.set(k, make(f)); }
    for (const [k, r] of fires) if (!seen.has(k)) { root.remove(r.group); r.smoke.forEach(s => s.material.dispose()); fires.delete(k); }
    const act = [...fires.values()].filter(r => (r.f.level || 0) <= viewLevel);
    for (const r of fires.values()) {
      r.group.visible = (r.f.level || 0) <= viewLevel;
      const p = 0.35 + 0.65 * Math.max(0, Math.min(1, r.f.power ?? 1));
      r.flames.forEach((s, i) => {
        const ph = (t * 1.6 + s.userData.ph) % 1;
        s.position.set(s.userData.dx * (1 - ph * 0.5), 0.05 + ph * 1.1 * p, s.userData.dz * (1 - ph * 0.5));
        const k = Math.sin(ph * Math.PI); s.scale.set(0.65 * p * k + 0.12, 1.15 * p * k + 0.12, 1);
      });
      r.smoke.forEach(s => {
        const ph = (t * 0.3 + s.userData.ph) % 1;
        s.position.set(Math.sin(ph * 6 + s.userData.ph * 9) * 0.3, 1.0 * p + ph * 2.4, Math.cos(ph * 5) * 0.25);
        s.scale.setScalar(0.5 + ph * 1.2); s.material.opacity = 0.55 * Math.sin(ph * Math.PI) * p;
      });
    }
    if (focus) act.sort((a, b) => a.group.position.distanceToSquared(focus) - b.group.position.distanceToSquared(focus));
    lights.forEach((l, i) => {
      const r = act[i];
      if (!r) { l.intensity = 0; return; }
      l.position.copy(r.group.position); l.position.y += 0.8;
      l.intensity = (6 + Math.sin(t * 17 + i) * 1.5 + Math.sin(t * 7.3) * 1.2) * (0.4 + 0.6 * (r.f.power ?? 1));
    });
  };
  F.count = () => fires.size;
  return F;
}
