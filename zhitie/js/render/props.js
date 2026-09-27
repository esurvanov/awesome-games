// Процедурные «заглушки» мебели: игра полностью играбельна без glb.
// Локальные координаты: следа fp[0]×fp[1] по центру в начале, «лицо» → +Z, пол y=0.
// Настенные предметы (дверь/окно) стоят в плоскости стены z=−0.5; картина/зеркало — на её поверхности.
// Приём «деталь из примитивов + слияние в один меш» — russia Bld (:378-401) и worldfill Merge.
import * as THREE from 'three';
import { Bld, G, ctex, mulberry, PI } from './util.js';
import { WALL_T, DOOR_TOP, WIN_BOTTOM, WIN_TOP } from './lot.js';
import { BUILD2 } from './props2.js';
import { kindOf } from '../../data/catalog.js';

// Текущий цвет варианта (def.tint) во время сборки — для BUILD2 и основной краски старых билдеров
let TINT = null;
export const tintNow = () => TINT;
// какой цвет палитры считать «основным» у старых видов (перекрашивается def.tint)
const MAIN_KEY = { sofa: 'fabricB', armchair: 'fabricR', dining_chair: 'fabricR', bed_single: 'blanket', bed_double: 'blanket2', counter: 'wood', kitchen_sink: 'wood', dresser: 'wood', bookshelf: 'wood', dining_table: 'woodL', coffee_table: 'wood', computer_desk: 'woodL', fridge: 'white', stove: 'cream', toilet: 'white', bathtub: 'white', bath_sink: 'white', plant: 'leaf', mailbox: 'wood', chess: 'woodD' };

export const C = {
  wood: '#a0714a', woodD: '#6f4a2f', woodL: '#c89a6a', white: '#eef0ec', cream: '#f1ead8', metal: '#9aa0a6', dark: '#2c2f33',
  stone: '#dcd6c9', fabricB: '#6d86a8', fabricR: '#b8664c', sheet: '#f4f1ea', blanket: '#6f9bc4', blanket2: '#c7766a', leaf: '#4f8a3c', pot: '#b5613c',
};

// Общие материалы (создаются один раз). glow/glass/screenOn — «ночные»: env меняет emissiveIntensity.
export const MAT = {};
export function initPropMats(env) {
  MAT.main = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, flatShading: true });
  MAT.glow = new THREE.MeshStandardMaterial({ color: '#fff1d0', emissive: '#ffcf85', emissiveIntensity: 0, roughness: 0.6, side: THREE.DoubleSide });
  MAT.glow.userData.glow = 1.4;
  MAT.glass = new THREE.MeshStandardMaterial({ color: '#a9cfe6', emissive: '#ffc070', emissiveIntensity: 0, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.45 });
  MAT.glass.userData.glow = 0.9;
  MAT.frosted = new THREE.MeshStandardMaterial({ color: '#d8ecf2', roughness: 0.2, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
  MAT.mirror = new THREE.MeshStandardMaterial({ color: '#cfe0ea', roughness: 0.05, metalness: 0.9 });
  MAT.screenOff = new THREE.MeshStandardMaterial({ color: '#15181c', roughness: 0.25 });
  MAT.screenOn = new THREE.MeshStandardMaterial({ color: '#223', emissive: '#7fb8ff', emissiveIntensity: 1.3, roughness: 0.3 });
  MAT.water = new THREE.MeshStandardMaterial({ color: '#8fc8e0', roughness: 0.1, transparent: true, opacity: 0.8 });
  MAT.painting = new THREE.MeshStandardMaterial({ map: birchTexture(), roughness: 0.8 });
  MAT.rug = new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 1 });
  MAT.chess = new THREE.MeshStandardMaterial({ map: ctex(64, 64, (x) => { for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.fillStyle = (i + j) % 2 ? '#3a2a1e' : '#eadbc0'; x.fillRect(i * 8, j * 8, 8, 8); } }, false), roughness: 0.6 });
  env.nightMats.add(MAT.glow); env.nightMats.add(MAT.glass);
}

// Картина «Берёзы» — рисуем на canvas
function birchTexture() {
  return ctex(256, 192, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#a8cbe3'); g.addColorStop(0.6, '#e8efe0'); g.addColorStop(0.61, '#9dbb6a'); g.addColorStop(1, '#6f9444');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    const rnd = mulberry(11);
    for (let i = 0; i < 7; i++) {
      const bx = 20 + i * 34 + rnd() * 10, bw = 6 + rnd() * 5;
      x.fillStyle = '#f4f2ea'; x.fillRect(bx, 10 + rnd() * 20, bw, h);
      x.fillStyle = '#222'; for (let k = 0; k < 9; k++) x.fillRect(bx, 20 + rnd() * h, bw * (0.4 + rnd() * 0.6), 2);
      x.fillStyle = 'rgba(214,190,70,.8)'; for (let k = 0; k < 14; k++) { x.beginPath(); x.arc(bx + (rnd() - 0.5) * 40, 10 + rnd() * 70, 4 + rnd() * 6, 0, 2 * PI); x.fill(); }
    }
  }, false);
}
function rugTexture() {
  return ctex(256, 256, (x, w, h) => {
    x.fillStyle = '#8c2f2b'; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#e2c27a'; x.lineWidth = 8; x.strokeRect(14, 14, w - 28, h - 28);
    x.strokeStyle = '#2f3f66'; x.lineWidth = 6; x.strokeRect(30, 30, w - 60, h - 60);
    x.fillStyle = '#e2c27a'; x.save(); x.translate(w / 2, h / 2); x.rotate(PI / 4); x.fillRect(-50, -50, 100, 100); x.fillStyle = '#2f3f66'; x.fillRect(-30, -30, 60, 60); x.fillStyle = '#c85a3c'; x.fillRect(-12, -12, 24, 24); x.restore();
    const rnd = mulberry(5); x.globalAlpha = 0.12; for (let i = 0; i < 2500; i++) { x.fillStyle = rnd() < 0.5 ? '#000' : '#fff'; x.fillRect(rnd() * w, rnd() * h, 2, 2); }
  }, false);
}

// Высота рабочей поверхности (для предметов place:'surface', напр. телефона)
export const SURFACE_H = { dining_table: 0.77, counter: 0.91, kitchen_sink: 0.91, coffee_table: 0.43, computer_desk: 0.77, dresser: 0.82, chess: 0.72, stereo: 0.62 };

export const legs = (b, w, d, h, r, col, inset = 0.05) => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(G.box(r, h, r), col, sx * (w / 2 - inset), h / 2, sz * (d / 2 - inset));
};

// Каждый билдер: (b: Bld, W, D, extra(mesh-helper)) — в b кладём цветные детали, в extra — особые материалы.
const BUILD = {
  fridge(b, W, D, x) {
    b.add(G.box(0.78, 1.85, 0.68), C.white, 0, 0.925, -0.12);
    b.add(G.box(0.8, 0.02, 0.02), '#b9bdbd', 0, 1.25, 0.23);
    b.add(G.box(0.04, 0.35, 0.04), C.metal, 0.3, 1.55, 0.24); b.add(G.box(0.04, 0.5, 0.04), C.metal, 0.3, 0.85, 0.24);
    b.add(G.box(0.8, 0.06, 0.66), '#cfd3d2', 0, 0.03, -0.12);
  },
  stove(b) {
    b.add(G.box(0.84, 0.86, 0.66), C.cream, 0, 0.43, -0.12);
    b.add(G.box(0.86, 0.04, 0.68), C.dark, 0, 0.88, -0.12);
    for (const [px, pz] of [[-0.2, -0.28], [0.2, -0.28], [-0.2, 0.02], [0.2, 0.02]]) b.add(G.cyl(0.1, 0.1, 0.02, 12), '#555', px, 0.91, pz);
    b.add(G.box(0.6, 0.35, 0.02), '#3a3530', 0, 0.42, 0.22);
    b.add(G.box(0.62, 0.03, 0.04), C.metal, 0, 0.66, 0.23);
    for (let i = 0; i < 4; i++) b.add(G.cyl(0.025, 0.025, 0.03, 8), C.dark, -0.27 + i * 0.18, 0.78, 0.22, PI / 2);
  },
  counter(b) {
    b.add(G.box(0.96, 0.84, 0.62), C.wood, 0, 0.42, -0.14);
    b.add(G.box(1.0, 0.06, 0.7), C.stone, 0, 0.88, -0.12);
    b.add(G.box(0.9, 0.01, 0.01), C.woodD, 0, 0.62, 0.18);
    b.add(G.box(0.01, 0.55, 0.01), C.woodD, 0, 0.3, 0.18);
    b.add(G.box(0.12, 0.02, 0.02), C.metal, -0.2, 0.7, 0.19); b.add(G.box(0.12, 0.02, 0.02), C.metal, 0.2, 0.7, 0.19);
  },
  kitchen_sink(b, W, D, x) {
    BUILD.counter(b);
    b.add(G.box(0.6, 0.02, 0.42), '#6f7478', 0, 0.9, -0.12);
    b.add(G.cyl(0.02, 0.02, 0.3, 8), C.metal, 0, 1.05, -0.38); b.add(G.box(0.03, 0.03, 0.2), C.metal, 0, 1.19, -0.3);
    x(new THREE.PlaneGeometry(0.56, 0.38), MAT.water, 0, 0.905, -0.12, -PI / 2);
  },
  dining_table(b, W, D) {
    b.add(G.box(W - 0.2, 0.06, D - 0.15), C.woodL, 0, 0.74, 0);
    legs(b, W - 0.2, D - 0.15, 0.72, 0.07, C.wood, 0.08);
  },
  dining_chair(b) {
    b.add(G.box(0.46, 0.05, 0.46), C.woodL, 0, 0.46, 0);
    legs(b, 0.46, 0.46, 0.45, 0.05, C.wood, 0.04);
    b.add(G.box(0.46, 0.5, 0.05), C.woodL, 0, 0.73, -0.2);
    b.add(G.box(0.44, 0.04, 0.44), C.fabricR, 0, 0.5, 0.01);
  },
  trash_can(b) {
    b.add(G.cyl(0.19, 0.16, 0.5, 12), '#7d8a90', 0, 0.25, 0);
    b.add(G.cyl(0.21, 0.21, 0.04, 12), '#5d676c', 0, 0.52, 0);
  },
  sofa(b, W) {
    const w = W - 0.1, col = C.fabricB;
    b.add(G.box(w, 0.3, 0.82), '#4c5f7a', 0, 0.2, 0);
    for (const s of [-1, 1]) b.add(G.box(w / 2 - 0.22, 0.14, 0.62), col, s * (w / 4 - 0.02), 0.42, 0.08);
    b.add(G.box(w, 0.55, 0.22), col, 0, 0.6, -0.3);
    for (const s of [-1, 1]) b.add(G.box(0.18, 0.55, 0.82), col, s * (w / 2 - 0.09), 0.4, 0);
    b.add(G.box(0.35, 0.3, 0.1), '#e4c66b', -w / 4, 0.65, -0.16, 0.2, 0, 0.1);
    legs(b, w, 0.8, 0.06, 0.05, C.woodD);
  },
  armchair(b) {
    const col = C.fabricR;
    b.add(G.box(0.86, 0.3, 0.82), '#8e4c38', 0, 0.2, 0);
    b.add(G.box(0.52, 0.14, 0.62), col, 0, 0.42, 0.08);
    b.add(G.box(0.86, 0.6, 0.22), col, 0, 0.62, -0.3);
    for (const s of [-1, 1]) b.add(G.box(0.17, 0.52, 0.82), col, s * 0.345, 0.4, 0);
    legs(b, 0.86, 0.8, 0.06, 0.05, C.woodD);
  },
  coffee_table(b, W) {
    b.add(G.box(W - 0.6, 0.05, 0.62), C.wood, 0, 0.42, 0);
    b.add(G.box(W - 0.7, 0.03, 0.5), C.woodD, 0, 0.15, 0);
    legs(b, W - 0.6, 0.62, 0.4, 0.05, C.woodD, 0.05);
    b.add(G.cyl(0.05, 0.05, 0.1, 10), '#e9e3d5', 0.3, 0.5, 0.05);
    b.add(G.box(0.25, 0.03, 0.18), '#b84c3c', -0.25, 0.46, -0.05, 0, 0.3, 0);
  },
  tv(b, W, D, x) {
    b.add(G.box(0.9, 0.42, 0.45), C.woodD, 0, 0.21, -0.1);
    b.add(G.box(0.86, 0.56, 0.14), '#1f2226', 0, 0.72, -0.12);
    b.add(G.box(0.2, 0.02, 0.2), '#1f2226', 0, 0.43, -0.12);
    x(new THREE.PlaneGeometry(0.78, 0.48), 'screen', 0, 0.72, -0.045);
  },
  stereo(b) {
    b.add(G.box(0.38, 0.6, 0.38), '#2a2c30', 0, 0.3, -0.1);
    for (const s of [-1, 1]) { b.add(G.box(0.2, 0.7, 0.3), C.woodD, s * 0.36, 0.35, -0.12); b.add(G.cyl(0.07, 0.07, 0.02, 12), '#111', s * 0.36, 0.5, 0.035, PI / 2); b.add(G.cyl(0.045, 0.045, 0.02, 12), '#111', s * 0.36, 0.25, 0.035, PI / 2); }
    b.add(G.box(0.3, 0.05, 0.02), '#6fd0ff', 0, 0.48, 0.095);
  },
  bookshelf(b) {
    b.add(G.box(0.92, 1.9, 0.04), C.woodD, 0, 0.95, -0.38);
    for (const s of [-1, 1]) b.add(G.box(0.04, 1.9, 0.38), C.wood, s * 0.44, 0.95, -0.21);
    const rnd = mulberry(3), cols = ['#a33b3b', '#35608f', '#d2a643', '#3f7d4e', '#e7e1d0', '#6b4a8a'];
    for (let i = 0; i < 5; i++) {
      const y = 0.05 + i * 0.44; b.add(G.box(0.86, 0.03, 0.36), C.wood, 0, y, -0.21);
      if (i === 4) break;
      let px = -0.4;
      while (px < 0.36) { const bw = 0.04 + rnd() * 0.05, bh = 0.24 + rnd() * 0.12; b.add(G.box(bw, bh, 0.26), cols[(rnd() * cols.length) | 0], px + bw / 2, y + 0.015 + bh / 2, -0.22); px += bw + 0.005; }
    }
    b.add(G.box(0.92, 0.04, 0.4), C.wood, 0, 1.9, -0.2);
  },
  computer_desk(b, W, D, x) {
    b.add(G.box(W - 0.2, 0.05, 0.6), C.woodL, 0, 0.75, -0.18);
    for (const s of [-1, 1]) b.add(G.box(0.05, 0.73, 0.56), C.wood, s * (W / 2 - 0.13), 0.365, -0.18);
    b.add(G.box(0.55, 0.38, 0.05), '#d9dcdf', 0.1, 1.05, -0.32); b.add(G.box(0.08, 0.2, 0.08), '#bfc3c7', 0.1, 0.87, -0.34);
    b.add(G.box(0.42, 0.02, 0.14), '#e3e5e7', 0.1, 0.785, -0.08);
    b.add(G.box(0.2, 0.45, 0.45), '#cfd2d5', -0.6, 0.225, -0.18);
    // офисный стул спереди
    b.add(G.box(0.46, 0.08, 0.44), '#3a3f4a', 0.1, 0.46, 0.28); b.add(G.box(0.44, 0.45, 0.06), '#3a3f4a', 0.1, 0.75, 0.48);
    b.add(G.cyl(0.03, 0.03, 0.4, 6), C.metal, 0.1, 0.22, 0.28); b.add(G.cyl(0.24, 0.24, 0.03, 5), C.dark, 0.1, 0.03, 0.28);
    x(new THREE.PlaneGeometry(0.5, 0.32), 'screen', 0.1, 1.05, -0.294);
  },
  chess(b, W, D, x) {
    b.add(G.cyl(0.36, 0.36, 0.05, 16), C.woodD, 0, 0.7, 0);
    b.add(G.cyl(0.06, 0.1, 0.68, 8), C.woodD, 0, 0.34, 0); b.add(G.cyl(0.25, 0.25, 0.03, 12), C.woodD, 0, 0.015, 0);
    x(new THREE.PlaneGeometry(0.42, 0.42), MAT.chess, 0, 0.726, 0, -PI / 2);
    const rnd = mulberry(8);
    for (let i = 0; i < 10; i++) b.add(G.cyl(0.015, 0.02, 0.05 + rnd() * 0.04, 6), i % 2 ? '#1c1c1c' : '#f3efe2', (rnd() - 0.5) * 0.38, 0.75, (i % 2 ? -1 : 1) * (0.1 + rnd() * 0.08));
  },
  phone(b) {
    b.add(G.box(0.2, 0.07, 0.16), '#b33a32', 0, 0.035, 0);
    b.add(G.box(0.22, 0.04, 0.05), '#8f2c26', 0, 0.09, -0.02);
  },
  bed_single(b, W, D) { bed(b, W, D, C.blanket, 1); },
  bed_double(b, W, D) { bed(b, W, D, C.blanket2, 2); },
  dresser(b) {
    b.add(G.box(0.9, 0.8, 0.48), C.wood, 0, 0.42, -0.2);
    b.add(G.box(0.94, 0.04, 0.52), C.woodD, 0, 0.83, -0.2);
    for (let i = 0; i < 3; i++) { b.add(G.box(0.84, 0.2, 0.02), C.woodL, 0, 0.18 + i * 0.24, 0.045); b.add(G.sph(0.022, 6, 4), C.metal, 0, 0.18 + i * 0.24, 0.06); }
    legs(b, 0.9, 0.48, 0.04, 0.05, C.woodD);
  },
  mirror(b, W, D, x) {
    const z = -0.5 + WALL_T / 2;
    b.add(G.box(0.62, 1.02, 0.04), C.woodL, 0, 1.45, z + 0.02);
    x(new THREE.PlaneGeometry(0.52, 0.92), MAT.mirror, 0, 1.45, z + 0.045);
  },
  toilet(b) {
    b.add(G.box(0.42, 0.42, 0.18), C.white, 0, 0.62, -0.36);
    b.add(G.cyl(0.14, 0.17, 0.36, 14), C.white, 0, 0.18, -0.08);
    b.add(G.cyl(0.21, 0.19, 0.08, 16), '#f8f8f6', 0, 0.4, -0.02, 0, 0, 0, 1, 1, 1.18);
    b.add(G.box(0.05, 0.02, 0.05), C.metal, 0.12, 0.84, -0.36);
  },
  shower(b, W, D, x) {
    b.add(G.box(0.96, 0.1, 0.96), C.white, 0, 0.05, 0);
    for (const [px, pz] of [[-0.47, -0.47], [0.47, -0.47], [-0.47, 0.47], [0.47, 0.47]]) b.add(G.box(0.04, 2.05, 0.04), C.metal, px, 1.02, pz);
    b.add(G.box(0.98, 0.04, 0.04), C.metal, 0, 2.04, 0.47); b.add(G.box(0.98, 0.04, 0.04), C.metal, 0, 2.04, -0.47);
    b.add(G.cyl(0.02, 0.02, 0.4, 6), C.metal, 0, 1.9, -0.44); b.add(G.cyl(0.09, 0.05, 0.05, 10), C.metal, 0, 1.92, -0.32);
    b.add(G.box(0.9, 1.9, 0.02), '#dfe9ea', 0, 1.0, -0.46);
    x(new THREE.PlaneGeometry(0.92, 1.9), MAT.frosted, -0.47, 1.05, 0, 0, PI / 2);
    x(new THREE.PlaneGeometry(0.92, 1.9), MAT.frosted, 0.47, 1.05, 0, 0, PI / 2);
    x(new THREE.PlaneGeometry(0.6, 1.9), MAT.frosted, -0.16, 1.05, 0.47);
  },
  bathtub(b, W, D, x) {
    b.add(G.box(W - 0.15, 0.55, 0.82), C.white, 0, 0.275, -0.05);
    b.add(G.box(W - 0.35, 0.02, 0.6), '#dfe7ea', 0, 0.56, -0.05);
    b.add(G.cyl(0.02, 0.02, 0.2, 6), C.metal, -(W / 2 - 0.2), 0.66, -0.05); b.add(G.box(0.12, 0.03, 0.03), C.metal, -(W / 2 - 0.25), 0.76, -0.05);
    x(new THREE.PlaneGeometry(W - 0.4, 0.56), MAT.water, 0, 0.5, -0.05, -PI / 2);
  },
  bath_sink(b) {
    b.add(G.cyl(0.09, 0.12, 0.8, 10), C.white, 0, 0.4, -0.25);
    b.add(G.box(0.6, 0.14, 0.45), C.white, 0, 0.84, -0.2);
    b.add(G.box(0.5, 0.02, 0.33), '#cfdde2', 0, 0.915, -0.18);
    b.add(G.cyl(0.02, 0.02, 0.16, 6), C.metal, 0, 0.98, -0.38); b.add(G.box(0.03, 0.03, 0.1), C.metal, 0, 1.05, -0.34);
  },
  floor_lamp(b, W, D, x) {
    b.add(G.cyl(0.18, 0.2, 0.04, 14), C.dark, 0, 0.02, 0);
    b.add(G.cyl(0.02, 0.02, 1.45, 6), '#8c7a5a', 0, 0.74, 0);
    x(new THREE.CylinderGeometry(0.16, 0.26, 0.32, 14, 1, true), MAT.glow, 0, 1.5, 0);
    return { light: [0, 1.4, 0] };
  },
  painting(b, W, D, x) {
    const z = -0.5 + WALL_T / 2;
    b.add(G.box(0.86, 0.66, 0.04), '#8a6a3a', 0, 1.6, z + 0.02);
    x(new THREE.PlaneGeometry(0.76, 0.56), MAT.painting, 0, 1.6, z + 0.042);
  },
  plant(b) {
    b.add(G.cyl(0.2, 0.15, 0.36, 10), C.pot, 0, 0.18, 0);
    b.add(G.cyl(0.18, 0.18, 0.02, 10), '#4a3526', 0, 0.35, 0);
    b.add(G.cyl(0.025, 0.03, 0.5, 6), '#6b4a2e', 0, 0.6, 0);
    const rnd = mulberry(2);
    for (let i = 0; i < 7; i++) b.add(G.sph(0.18, 6, 5), i % 2 ? C.leaf : '#5f9e48', (rnd() - 0.5) * 0.35, 0.85 + rnd() * 0.45, (rnd() - 0.5) * 0.35);
  },
  rug(b, W, D, x) {
    x(new THREE.PlaneGeometry(W - 0.15, D - 0.15), MAT.rug, 0, 0.022, 0, -PI / 2);
  },
  mailbox(b) {
    b.add(G.box(0.07, 1.0, 0.07), '#5a5f64', 0, 0.5, 0);
    b.add(G.box(0.36, 0.3, 0.22), '#3b64a8', 0, 1.1, 0);
    b.add(G.box(0.28, 0.02, 0.02), '#1d2c48', 0, 1.18, 0.115);
  },
  // — Волна 2 —
  stairs(b, W, D) {
    const n = 12, run = D / n, rise = 3 / n, w = 0.92;
    for (let i = 0; i < n; i++) {
      const z = D / 2 - (i + 0.5) * run, top = (i + 1) * rise;
      b.add(G.box(w, 0.06, run + 0.02), C.woodL, 0, top - 0.03, z);          // проступь
      b.add(G.box(w, rise, 0.03), C.cream, 0, top - rise / 2, z + run / 2);  // подступёнок
    }
    // косоуры и перила по уклону
    const len = Math.hypot(D, 3), ang = Math.atan2(3, D);
    for (const sx of [-1, 1]) {
      b.add(G.box(0.06, 0.3, len), C.wood, sx * (w / 2 + 0.03), 1.5 - 0.1, 0, ang);
      b.add(G.box(0.05, 0.05, len), C.woodD, sx * (w / 2 + 0.03), 1.5 + 0.9, 0, ang);
      for (let k = 0; k <= 4; k++) { const z = D / 2 - k * D / 4 - (k === 4 ? 0.05 : 0), y = (D / 2 - z) / D * 3; b.add(G.box(0.04, 0.9, 0.04), C.woodD, sx * (w / 2 + 0.03), y + 0.45, z); }
    }
  },
  exercise_bench(b, W, D) {
    b.add(G.box(0.34, 0.08, 1.2), '#2b2f36', 0, 0.45, 0.1);
    b.add(G.box(0.3, 0.06, 1.1), '#b8322c', 0, 0.52, 0.1);
    for (const z of [-0.35, 0.55]) { b.add(G.box(0.06, 0.45, 0.06), C.metal, 0, 0.22, z); b.add(G.box(0.5, 0.04, 0.06), C.metal, 0, 0.02, z); }
    for (const sx of [-1, 1]) b.add(G.box(0.05, 1.1, 0.05), C.metal, sx * 0.4, 0.55, -0.55);
    b.add(G.cyl(0.02, 0.02, 1.5, 8), '#cfd3d6', 0, 1.1, -0.55, 0, 0, Math.PI / 2);
    for (const sx of [-1, 1]) b.add(G.cyl(0.2, 0.2, 0.06, 14), '#222', sx * 0.62, 1.1, -0.55, 0, 0, Math.PI / 2);
  },
  easel(b, W, D, x) {
    b.add(G.box(0.04, 1.7, 0.04), C.woodL, -0.28, 0.85, 0.05, 0.12, 0, 0.12); b.add(G.box(0.04, 1.7, 0.04), C.woodL, 0.28, 0.85, 0.05, 0.12, 0, -0.12);
    b.add(G.box(0.04, 1.6, 0.04), C.woodL, 0, 0.8, -0.3, -0.25);
    b.add(G.box(0.7, 0.04, 0.08), C.woodL, 0, 0.78, 0.1);
    b.add(G.box(0.62, 0.5, 0.03), '#f4f1ea', 0, 1.08, 0.09, 0.12);
    x(new THREE.PlaneGeometry(0.54, 0.42), MAT.painting, 0, 1.08, 0.11, -0.12);
  },
  smoke_alarm(b) {
    const z = -0.5 + WALL_T / 2;
    b.add(G.cyl(0.09, 0.09, 0.04, 14), '#f2f2ee', 0, 2.65, z + 0.02, Math.PI / 2);
    return { led: [0.04, 2.67, z + 0.045], ledColor: '#ff2a1a' };
  },
  burglar_alarm(b) {
    const z = -0.5 + WALL_T / 2;
    b.add(G.box(0.2, 0.26, 0.05), '#e6e6e2', 0, 1.5, z + 0.025);
    b.add(G.box(0.14, 0.08, 0.01), '#39424c', 0, 1.53, z + 0.055);
    return { led: [0.06, 1.42, z + 0.055], ledColor: '#2aff5a' };
  },
  crib(b) {
    b.add(G.box(0.85, 0.08, 0.6), C.woodL, 0, 0.35, 0);
    b.add(G.box(0.8, 0.1, 0.55), '#f4f1ea', 0, 0.44, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(G.box(0.05, 0.95, 0.05), C.woodL, sx * 0.42, 0.475, sz * 0.28);
    for (const sz of [-1, 1]) { b.add(G.box(0.85, 0.04, 0.04), C.woodL, 0, 0.93, sz * 0.28); for (let i = -3; i <= 3; i++) b.add(G.box(0.02, 0.45, 0.02), C.woodL, i * 0.11, 0.7, sz * 0.28); }
    for (const sx of [-1, 1]) b.add(G.box(0.04, 0.5, 0.6), C.woodL, sx * 0.42, 0.68, 0);
  },
  tombstone(b) {
    b.add(G.box(0.6, 0.12, 0.35), '#8e9296', 0, 0.06, -0.1);
    b.add(G.box(0.46, 0.7, 0.14), '#a6aaae', 0, 0.47, -0.12);
    b.add(G.cyl(0.23, 0.23, 0.14, 16), '#a6aaae', 0, 0.82, -0.12, Math.PI / 2);
    b.add(G.box(0.08, 0.26, 0.02), '#6f7478', 0, 0.55, -0.045); b.add(G.box(0.2, 0.06, 0.02), '#6f7478', 0, 0.6, -0.045);
    b.add(G.box(0.5, 0.04, 0.45), '#4f7a36', 0, 0.02, 0.25);
    for (let i = 0; i < 4; i++) b.add(G.sph(0.04, 6, 4), i % 2 ? '#e8d24a' : '#d8453a', -0.15 + i * 0.1, 0.06, 0.25);
  },
  door(b) {
    const z = -0.5, t = WALL_T + 0.04;
    for (const s of [-1, 1]) b.add(G.box(0.1, DOOR_TOP, t), '#e9e2d2', s * 0.45, DOOR_TOP / 2, z);
    b.add(G.box(1.0, 0.1, t), '#e9e2d2', 0, DOOR_TOP - 0.05, z);
    b.add(G.box(0.8, DOOR_TOP - 0.12, 0.05), C.wood, 0, (DOOR_TOP - 0.12) / 2, z);
    b.add(G.box(0.62, 0.7, 0.06), C.woodL, 0, 1.45, z); b.add(G.box(0.62, 0.7, 0.06), C.woodL, 0, 0.55, z);
    for (const s of [-1, 1]) b.add(G.sph(0.035, 8, 6), '#d8b24a', 0.3, 1.0, z + s * 0.045);
  },
  window(b, W, D, x) {
    const z = -0.5, t = WALL_T + 0.05, h = WIN_TOP - WIN_BOTTOM, cy = (WIN_TOP + WIN_BOTTOM) / 2;
    for (const s of [-1, 1]) b.add(G.box(0.1, h + 0.1, t), '#f4f1ea', s * 0.45, cy, z);
    b.add(G.box(1.0, 0.08, t), '#f4f1ea', 0, WIN_TOP - 0.02, z);
    b.add(G.box(1.04, 0.06, t + 0.08), '#f4f1ea', 0, WIN_BOTTOM, z);
    b.add(G.box(0.04, h, 0.06), '#f4f1ea', 0, cy, z); b.add(G.box(0.8, 0.04, 0.06), '#f4f1ea', 0, cy + 0.15, z);
    x(new THREE.PlaneGeometry(0.8, h - 0.02), MAT.glass, 0, cy, z, 0, 0, 0, true);
  },
};

export function bed(b, W, D, blanket, pillows) {
  const w = W - 0.08, d = D - 0.08;
  b.add(G.box(w, 0.28, d), C.woodD, 0, 0.2, 0);
  b.add(G.box(w - 0.08, 0.18, d - 0.12), C.sheet, 0, 0.42, 0.02);
  b.add(G.box(w - 0.04, 0.07, d * 0.62), blanket, 0, 0.49, d * 0.19);
  b.add(G.box(w - 0.04, 0.2, 0.02), blanket, 0, 0.4, d / 2 - 0.02);
  b.add(G.box(w, 0.85, 0.07), C.wood, 0, 0.45, -d / 2 + 0.03);
  b.add(G.box(w, 0.4, 0.06), C.wood, 0, 0.2, d / 2 - 0.03);
  for (let i = 0; i < pillows; i++) b.add(G.box(pillows === 1 ? 0.6 : 0.72, 0.1, 0.34), '#ffffff', pillows === 1 ? 0 : (i ? 0.42 : -0.42), 0.54, -d / 2 + 0.3);
  legs(b, w, d, 0.08, 0.07, C.woodD, 0.04);
}

// Запасной билдер по категории (для новых id каталога без билдера)
function byCat(b, W, D, def) {
  const col = { seating: C.fabricB, surfaces: C.woodL, decor: '#d6a64a', electronics: '#333', appliances: C.white, plumbing: C.white, lighting: '#ffe3a0', misc: C.wood }[def.cat] || '#aaa';
  const h = { seating: 0.6, surfaces: 0.75, decor: 0.6, electronics: 0.8, appliances: 1.2, plumbing: 0.8, lighting: 1.6, misc: 1.0 }[def.cat] || 0.8;
  b.add(G.box(W - 0.15, h, D - 0.15), col, 0, h / 2, 0);
}

// Собрать группу предмета. Возвращает {group, light?: [x,y,z] локально, screens:[mesh]}.
export function buildProp(def) {
  const W = def.fp?.[0] || 1, D = def.fp?.[1] || 1;
  const b = new Bld(), group = new THREE.Group(), screens = [];
  const extra = (geo, mat, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, noShadow = false) => {
    const m = new THREE.Mesh(geo, mat === 'screen' ? MAT.screenOff : mat);
    m.position.set(px, py, pz); m.rotation.set(rx, ry, rz);
    m.castShadow = !noShadow && mat !== MAT.frosted && mat !== MAT.glass; m.receiveShadow = true;
    if (mat === 'screen') screens.push(m);
    group.add(m); return m;
  };
  // поиск билдера: по id → по виду (kind) → новые виды → по категории
  const kind = def.kind || kindOf(def.id);
  const fn = BUILD[def.id] || BUILD[kind] || BUILD2[def.id] || BUILD2[kind];
  const key = def.tint && MAIN_KEY[kind], saved = key && C[key];
  TINT = def.tint || null; if (key) C[key] = def.tint;
  let info;
  try { info = fn ? fn(b, W, D, extra) || {} : (byCat(b, W, D, def), {}); }
  finally { TINT = null; if (key) C[key] = saved; }
  // текстурные материалы (ковёр/картина) перекрашиваем умножением
  if (def.tint) group.children.forEach(m => { if (m.material === MAT.rug || m.material === MAT.painting) { m.material = m.material.clone(); m.material.color.set(def.tint); } });
  const geo = b.geo();
  if (geo) { const m = new THREE.Mesh(geo, MAT.main); m.castShadow = def.id !== 'rug'; m.receiveShadow = true; group.add(m); }
  return { group, light: info.light, screens, led: info.led, ledColor: info.ledColor, spray: info.spray, street: info.street, kind };
}
