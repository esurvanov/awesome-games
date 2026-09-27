// Процедурный низкополи-человек (запасной вариант без glb): таз, торс, голова, руки с локтями, ноги с коленями.
// Анимации — функции позы по времени; смена анимации = плавное затухание позы к новой цели (damp).
import * as THREE from 'three';
import { G, damp, PI, mulberry } from './util.js';
import { POSTURE, isUpper } from './anims.js';

const HIP_Y = 0.92;
const SKINS = ['#f1c7a4', '#e0ac85', '#c68a62', '#8d5a3b', '#f6d7c0'];
const HAIRS = ['#2b1d14', '#5a3a22', '#a8743c', '#d9b36a', '#1a1a1a', '#8a2f1c'];
const TOPS = ['#c0504d', '#4f7cac', '#5e9e62', '#e0a93a', '#8a5aa8', '#e8e4da', '#2f6f73'];

// sim.look: {gender|body:'m'|'f'|'male'|'female', skin, hair, top|shirt, bottom|pants, shoes} — любые поля можно опустить
// Форма НПС (Мозг: sim.npc) — поверх look
export const NPC_LOOK = {
  maid:    { top: '#f4f1ea', bottom: '#2d3c5c', female: true },
  repair:  { top: '#3f6fb0', bottom: '#35609c', shoes: '#4a3a2a' },          // комбинезон
  fire:    { top: '#e8c22a', bottom: '#e0b820', shoes: '#1c1c1c' },          // + каска
  police:  { top: '#1f2d4d', bottom: '#1a2238', shoes: '#101010' },          // + фуражка
  burglar: { top: '#161618', bottom: '#161618', shoes: '#101010' },          // + маска-полоса
  pizza:   { top: '#d8342c', bottom: '#2b2b2f' },                            // + кепка
  social:  { top: '#3a3f4a', bottom: '#2a2d33', shoes: '#141414' },          // костюм
  reaper:  { top: '#141418', bottom: '#141418', skin: '#b9b4c8', shoes: '#141418' },
};

// sim.look: {gender|body:'m'|'f'|'male'|'female', skin, hair, top|shirt, bottom|pants, shoes} — любые поля можно опустить
export function lookOf(sim) {
  const L = sim.look || {}, N = NPC_LOOK[sim.npc] || {}, r = mulberry((sim.id || 1) * 7919);
  const pick = (a) => a[(r() * a.length) | 0];
  const g = String(L.gender || L.body || L.sex || '').toLowerCase();
  const top = N.top || L.top || L.shirt || pick(TOPS);
  return {
    female: N.female ?? (g.startsWith('f') || g.startsWith('ж') || (!g && r() < 0.5)),
    skin: N.skin || L.skin || pick(SKINS), hair: L.hair || L.hairColor || pick(HAIRS),
    top, shoes: N.shoes || L.shoes || '#3a2c22',
    bottom: N.bottom || L.bottom || L.pants || '#' + new THREE.Color(top).multiplyScalar(0.3).getHexString(),
  };
}

const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, flatShading: true });
const mesh = (geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; return o; };

export function createPerson(sim) {
  const lk = lookOf(sim);
  const M = { skin: mat(lk.skin), hair: mat(lk.hair), top: mat(lk.top), bottom: mat(lk.bottom), shoes: mat(lk.shoes), eye: mat('#1b1b22') };
  const J = {};
  const body = new THREE.Group();
  const hips = J.hips = new THREE.Group(); hips.position.y = HIP_Y; body.add(hips);
  hips.add(mesh(G.box(0.32, 0.16, 0.2), M.bottom, 0, 0.02, 0));
  const spine = J.spine = new THREE.Group(); spine.position.y = 0.08; hips.add(spine);
  spine.add(mesh(G.cyl(lk.female ? 0.15 : 0.17, lk.female ? 0.13 : 0.14, 0.5, 8), M.top, 0, 0.25, 0));
  if (lk.female) spine.add(mesh(G.cyl(0.13, 0.19, 0.3, 8), M.bottom, 0, -0.06, 0)); // юбка
  const neck = J.neck = new THREE.Group(); neck.position.y = 0.52; spine.add(neck);
  neck.add(mesh(G.cyl(0.05, 0.05, 0.08, 6), M.skin, 0, 0.03, 0));
  const head = mesh(G.sph(0.125, 10, 8), M.skin, 0, 0.17, 0); head.scale.set(0.95, 1.05, 1); neck.add(head);
  const cap = mesh(new THREE.SphereGeometry(0.135, 10, 6, 0, PI * 2, 0, PI * 0.55), M.hair, 0, 0.18, -0.01); neck.add(cap);
  if (lk.female) neck.add(mesh(G.box(0.24, 0.26, 0.08), M.hair, 0, 0.1, -0.1));
  for (const s of [-1, 1]) neck.add(mesh(G.sph(0.018, 6, 4), M.eye, s * 0.045, 0.19, 0.115));
  neck.add(mesh(G.box(0.025, 0.04, 0.03), M.skin, 0, 0.15, 0.125));
  for (const [side, s] of [['l', 1], ['r', -1]]) {
    const sh = J[side + 'S'] = new THREE.Group(); sh.position.set(s * 0.215, 0.46, 0); spine.add(sh);
    sh.add(mesh(G.cap(0.055, 0.2, 6), M.top, 0, -0.14, 0));
    const el = J[side + 'E'] = new THREE.Group(); el.position.y = -0.29; sh.add(el);
    el.add(mesh(G.cap(0.045, 0.18, 6), M.skin, 0, -0.12, 0));
    el.add(mesh(G.sph(0.05, 6, 5), M.skin, 0, -0.27, 0));
    const hp = J[side + 'H'] = new THREE.Group(); hp.position.set(s * 0.09, 0, 0); hips.add(hp);
    hp.add(mesh(G.cap(0.075, 0.3, 6), M.bottom, 0, -0.21, 0));
    const kn = J[side + 'K'] = new THREE.Group(); kn.position.y = -0.44; hp.add(kn);
    kn.add(mesh(G.cap(0.06, 0.3, 6), M.bottom, 0, -0.2, 0));
    kn.add(mesh(G.box(0.1, 0.07, 0.22), M.shoes, 0, -0.44, 0.04));
  }
  const pose = basePose('stand'), target = basePose('stand');
  return { body, J, pose, target, posture: 'stand', mats: M, female: lk.female };
}

const ZERO = { y: 0, fz: 0, lean: 0, twist: 0, sway: 0, hX: 0, hY: 0, hZ: 0, lSx: 0, lSz: 0.08, lE: -0.12, rSx: 0, rSz: 0.08, rE: -0.12, lHx: 0, lHz: 0, lK: 0, rHx: 0, rHz: 0, rK: 0, lie: 0 };
export function basePose(posture) {
  const p = { ...ZERO };
  if (posture === 'sit') Object.assign(p, { y: -0.44, fz: -0.06, lHx: -1.57, rHx: -1.57, lK: 1.57, rK: 1.57, lSx: -0.25, rSx: -0.25, lE: -0.6, rE: -0.6 });
  if (posture === 'lie') Object.assign(p, { lie: 1, lSz: 0.12, rSz: 0.12 });
  return p;
}

const s = Math.sin, c = Math.cos, pos = (v) => Math.max(0, v);
// Функции поз: (p — поза от базы осанки, t — время) — меняют p на месте
const POSES = {
  idle(p, t) { p.lean += 0.015 * s(t * 1.6); p.hY = 0.2 * s(t * 0.35) * s(t * 0.13); p.lSx += 0.03 * s(t * 1.1); p.rSx -= 0.03 * s(t * 1.1); p.sway = 0.02 * s(t * 0.5); },
  walk(p, t, k = 1) {
    const w = t * PI * 2 * 0.95 * k, a = 0.5 * k;
    p.lHx = a * s(w); p.rHx = -a * s(w); p.lK = 0.7 * pos(s(w + 1.6)); p.rK = 0.7 * pos(-s(w + 1.6));
    p.lSx = -0.45 * k * s(w); p.rSx = 0.45 * k * s(w); p.lE = p.rE = -0.25 - 0.3 * (k - 1);
    p.y = -0.03 * Math.abs(c(w)); p.twist = 0.06 * s(w); p.lean = 0.04 * k;
  },
  run(p, t) { POSES.walk(p, t, 1.7); p.lean = 0.22; p.lE = p.rE = -1.4; },
  sitIdle(p, t) { p.lean += 0.015 * s(t * 1.6); p.hY = 0.25 * s(t * 0.3); },
  watchTV(p, t) { p.lean = -0.12; p.hX = -0.08; p.lSx = p.rSx = -0.1; p.hY = 0.05 * s(t * 0.2); },
  useComputer(p, t) { p.lean = 0.08; p.lSx = p.rSx = -1.0; p.lE = -0.75 + 0.08 * s(t * 17); p.rE = -0.75 + 0.08 * s(t * 19 + 1); p.lSz = p.rSz = -0.1; p.hX = 0.08; },
  toilet(p, t) { p.lean = 0.2; p.lSx = p.rSx = -0.6; p.lE = p.rE = -1.2; p.lSz = p.rSz = -0.1; p.hX = 0.15 + 0.05 * s(t); },
  sleep(p, t) { p.lean = 0.02 * s(t * 1.2); p.hY = 0.35; p.lSz = 0.12; p.rSz = 0.12; },
  eat(p, t) {
    const ph = (t % 2.4) / 2.4, k = pos(s(ph * PI * 2 - 0.4)) ** 0.7;
    p.rSx = -0.5 - 0.8 * k; p.rE = -0.5 - 1.7 * k; p.rSz = -0.05; p.lSx = -0.7; p.lE = -1.0; p.hX = 0.12 - 0.12 * k; p.lean += 0.08;
  },
  drink(p, t) { const k = pos(s((t % 3) / 3 * PI)); p.rSx = -0.4 - 0.8 * k; p.rE = -0.6 - 1.6 * k; p.hX = -0.25 * k; },
  talk(p, t) {
    p.rSx = -0.55 - 0.3 * s(t * 3.1); p.rE = -1.0 + 0.35 * s(t * 4.3); p.rSz = 0.18;
    p.lSx = -0.35 - 0.25 * s(t * 2.3 + 1); p.lE = -0.8 + 0.2 * s(t * 3.7); p.lSz = 0.15;
    p.hX = 0.08 * s(t * 5.2); p.hY = 0.2 * s(t * 1.3);
  },
  sitTalk(p, t) { POSES.talk(p, t); p.lean = 0.05; },
  phone(p, t) { p.rSx = -0.3; p.rSz = 0.55; p.rE = -2.5; p.hZ = 0.15; p.lSx = -0.25 - 0.2 * s(t * 2); p.lE = -0.9; p.hY = 0.15 * s(t * 0.8); },
  wave(p, t) { p.rSz = 2.5; p.rSx = -0.2; p.rE = -0.35 + 0.45 * s(t * 9); p.sway = 0.04 * s(t * 4.5); p.hZ = -0.1; },
  laugh(p, t) { p.lean = -0.18 + 0.06 * s(t * 15); p.hX = -0.35 + 0.05 * s(t * 15); p.lSx = p.rSx = -0.45; p.lE = p.rE = -1.5; p.lSz = p.rSz = -0.1; },
  angry(p, t) { p.lean = 0.12; p.hX = 0.18; const k = 0.28 * s(t * 11); p.lSx = -0.3 + k; p.rSx = -0.3 - k; p.lE = p.rE = -1.4; p.lSz = p.rSz = 0.3; },
  cry(p, t) { p.hX = 0.5; p.lSx = p.rSx = -1.15; p.lE = p.rE = -2.1; p.lSz = p.rSz = -0.3; p.lean = 0.1 + 0.03 * s(t * 17); p.sway = 0.02 * s(t * 2); },
  dance(p, t) {
    const b = Math.abs(s(t * 5)); p.y = -0.08 * b; p.lK = p.rK = 0.3 * b; p.lHx = p.rHx = -0.15 * b;
    p.lSz = 1.5 + 0.8 * s(t * 2.5); p.rSz = 1.5 - 0.8 * s(t * 2.5); p.lE = p.rE = -0.6; p.twist = 0.35 * s(t * 2.5); p.hX = 0.1 * s(t * 5); p.sway = 0.08 * s(t * 2.5);
  },
  interact(p, t) { p.lean = 0.12; p.hX = 0.3; p.lSx = -1.0 + 0.12 * s(t * 5); p.rSx = -1.0 + 0.2 * s(t * 6); p.lE = -0.6 + 0.2 * s(t * 5); p.rE = -0.6; },
  cook(p, t) { POSES.interact(p, t); p.rSx = -1.1; p.rE = -0.7 + 0.3 * s(t * 7); p.rSz = 0.2 * s(t * 7 + 1.5) - 0.1; },
  wash(p, t) { POSES.interact(p, t); p.lSz = 0.2 * s(t * 10); p.rSz = -0.2 * s(t * 10); p.lE = p.rE = -0.5; },
  repair(p, t) {
    Object.assign(p, { y: -0.46, lHx: -1.57, lK: 1.57, rHx: 0.05, rK: 1.57, lean: 0.35, hX: 0.3 });
    p.rSx = -0.8 + 0.35 * s(t * 8); p.rE = -0.5; p.lSx = -0.9; p.lE = -0.4;
  },
  pickup(p) { Object.assign(p, { lean: 0.85, y: -0.1, lK: 0.4, rK: 0.4, lHx: -0.3, rHx: -0.3, lSx: -0.9, rSx: -0.9, lE: -0.2, rE: -0.2, hX: -0.3 }); },
  read(p, t) { p.lSx = p.rSx = -0.95; p.lE = p.rE = -1.25; p.lSz = p.rSz = -0.12; p.hX = 0.42; p.hY = 0.08 * s(t * 0.7); },
  shower(p, t) { p.lSx = p.rSx = -2.6; p.lE = -1.3 + 0.3 * s(t * 8); p.rE = -1.3 + 0.3 * s(t * 8 + 2); p.hX = -0.2; p.sway = 0.03 * s(t * 3); },
  exercise(p, t) {
    const k = pos(s(t * PI * 2 * 0.9)); p.y = 0.06 * Math.abs(s(t * PI * 2 * 0.9));
    p.lSz = p.rSz = 0.2 + 2.5 * k; p.lE = p.rE = -0.1; p.lHz = 0.3 * k; p.rHz = 0.3 * k;
  },
  no(p, t) { p.hY = 0.45 * s(t * 10); p.lSx = p.rSx = -0.1; },
  yes(p, t) { p.hX = 0.12 + 0.22 * s(t * 9); },
};
POSES.sitEat = POSES.eat; POSES.sitRead = POSES.read; POSES.carry = POSES.walk;
POSES.sit = POSES.sitIdle; POSES.standUp = POSES.idle; POSES.getUp = POSES.idle; POSES.lieDown = POSES.sleep;

// Поставить целевую позу для анимации name в момент t
export function poseFor(P, name, t, posture) {
  P.posture = posture || (isUpper(name) ? P.posture : POSTURE[name]);
  const p = basePose(P.posture);
  (POSES[name] || POSES.idle)(p, t);
  if (P.posture === 'lie') { p.lie = 1; p.y = 0; }
  return p;
}

// Плавно подвести позу и выставить суставы
export function applyPose(P, target, dt) {
  const p = P.pose;
  for (const k in target) p[k] = damp(p[k], target[k], k === 'lie' ? 5 : 11, dt);
  const J = P.J;
  J.hips.position.set(p.sway, HIP_Y + p.y, p.fz); J.hips.rotation.set(0, p.twist * 0.5, p.sway * 2);
  J.spine.rotation.set(p.lean, p.twist * 0.5, 0);
  J.neck.rotation.set(p.hX, p.hY, p.hZ);
  J.lS.rotation.set(p.lSx, 0, p.lSz); J.rS.rotation.set(p.rSx, 0, -p.rSz);
  J.lE.rotation.x = p.lE; J.rE.rotation.x = p.rE;
  J.lH.rotation.set(p.lHx, 0, p.lHz); J.rH.rotation.set(p.rHx, 0, -p.rHz);
  J.lK.rotation.x = p.lK; J.rK.rotation.x = p.rK;
}
