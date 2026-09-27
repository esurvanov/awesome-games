// Волна 3: процедурные заглушки для новых видов (CONTRACT §9) — всё видно до прихода моделей Ассетов.
// Соглашения как в props.js: след W×D по центру, «лицо» → +Z, пол y=0. T(c) — основной цвет (def.tint, если задан).
import * as THREE from 'three';
import { Bld, G, mulberry, PI } from './util.js';
import { MAT, C, legs, bed, tintNow } from './props.js';
import { WALL_T } from './lot.js';

const T = (c) => tintNow() || c;
const zw = -0.5 + WALL_T / 2; // поверхность стены за тайлом

// Вода с рябью (фонтан, бассейн, джакузи): анимация сдвигом uv в objects.update
let waterTex = null;
export function waterMat() {
  if (MAT.fountainWater) return MAT.fountainWater;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), rnd = mulberry(4);
  x.fillStyle = '#5fb3d6'; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 90; i++) { x.strokeStyle = `rgba(255,255,255,${0.15 + rnd() * 0.3})`; x.lineWidth = 1 + rnd() * 2; x.beginPath(); const px = rnd() * 128, py = rnd() * 128; x.ellipse(px, py, 6 + rnd() * 14, 2 + rnd() * 4, 0, 0, PI * 2); x.stroke(); }
  waterTex = new THREE.CanvasTexture(c); waterTex.colorSpace = THREE.SRGBColorSpace; waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  MAT.fountainWater = new THREE.MeshStandardMaterial({ map: waterTex, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.88, emissive: '#1d5f80', emissiveIntensity: 0.25 });
  return MAT.fountainWater;
}
export const waterTick = (t) => { if (waterTex) { waterTex.offset.set(t * 0.03, t * 0.05); } };

const books = (b, w, y, z, seed) => {
  const rnd = mulberry(seed), cols = ['#a33b3b', '#35608f', '#d2a643', '#3f7d4e', '#e7e1d0', '#6b4a8a'];
  let px = -w / 2 + 0.03;
  while (px < w / 2 - 0.06) { const bw = 0.04 + rnd() * 0.05, bh = 0.22 + rnd() * 0.12; b.add(G.box(bw, bh, 0.24), cols[(rnd() * 6) | 0], px + bw / 2, y + bh / 2, z); px += bw + 0.005; }
};

export const BUILD2 = {
  fireplace(b, W, D, x) {
    const w = W - 0.1;
    b.add(G.box(w, 1.1, 0.5), T('#a8a29a'), 0, 0.55, -0.25);
    b.add(G.box(w * 0.55, 0.6, 0.3), '#1c1a18', 0, 0.35, -0.12);
    b.add(G.box(w + 0.1, 0.08, 0.6), '#7a5a3a', 0, 1.14, -0.22);
    b.add(G.box(w * 0.3, 1.9, 0.4), T('#a8a29a'), 0, 2.1, -0.3);
    for (let i = 0; i < 3; i++) b.add(G.cyl(0.04, 0.04, 0.35, 6), '#5a3a22', (i - 1) * 0.1, 0.1, -0.1, 0, 0, PI / 2);
    x(new THREE.PlaneGeometry(0.35, 0.3), MAT.glow, 0, 0.25, -0.02);
    return { light: [0, 0.4, 0.25] };
  },
  piano(b, W) {
    b.add(G.box(W - 0.15, 1.2, 0.5), T('#1e1b1a'), 0, 0.6, -0.2);
    b.add(G.box(W - 0.2, 0.05, 0.25), '#1e1b1a', 0, 0.72, 0.13);
    b.add(G.box(W - 0.3, 0.03, 0.16), '#f4f1ea', 0, 0.76, 0.15);
    for (let i = 0; i < 14; i++) if (i % 7 !== 2 && i % 7 !== 6) b.add(G.box(0.03, 0.02, 0.09), '#111', -(W - 0.3) / 2 + 0.05 + i * (W - 0.4) / 14, 0.785, 0.12);
    b.add(G.box(0.8, 0.45, 0.35), '#2a2420', 0, 0.225, 0.45);
  },
  guitar(b) {
    b.add(G.box(0.3, 0.04, 0.3), '#333', 0, 0.02, 0); b.add(G.cyl(0.015, 0.015, 0.5, 6), '#333', 0, 0.27, -0.05);
    b.add(G.cyl(0.18, 0.18, 0.08, 16), T('#c07a36'), 0, 0.45, 0, PI / 2); b.add(G.cyl(0.14, 0.14, 0.08, 16), T('#c07a36'), 0, 0.7, 0, PI / 2);
    b.add(G.cyl(0.05, 0.05, 0.085, 12), '#222', 0, 0.6, 0.005, PI / 2); b.add(G.box(0.05, 0.55, 0.03), '#3a2616', 0, 1.05, 0);
  },
  telescope(b) {
    for (let i = 0; i < 3; i++) { const a = i * PI * 2 / 3; b.add(G.box(0.03, 1.2, 0.03), '#444', Math.sin(a) * 0.2, 0.58, Math.cos(a) * 0.2, Math.cos(a) * 0.2, 0, -Math.sin(a) * 0.2); }
    b.add(G.cyl(0.07, 0.09, 0.9, 12), T('#e8e6e0'), 0, 1.3, 0.05, 1.0);
  },
  aquarium(b, W, D, x) {
    b.add(G.box(W - 0.1, 0.7, 0.5), '#3a2a1e', 0, 0.35, -0.15);
    x(new THREE.BoxGeometry(W - 0.15, 0.55, 0.45), waterMat(), 0, 0.98, -0.15);
    const rnd = mulberry(6);
    for (let i = 0; i < 5; i++) b.add(G.box(0.07, 0.04, 0.02), ['#ff8a2a', '#ffd23a', '#3ad0ff'][i % 3], (rnd() - 0.5) * (W - 0.4), 0.85 + rnd() * 0.3, -0.15 + (rnd() - 0.5) * 0.2);
    b.add(G.box(W - 0.1, 0.05, 0.5), '#222', 0, 1.28, -0.15);
    return { glass: true };
  },
  pool_table(b, W, D) {
    const w = W - 0.2, d = D - 0.2;
    b.add(G.box(w, 0.12, d), '#5a3a22', 0, 0.74, 0);
    b.add(G.box(w - 0.2, 0.02, d - 0.2), T('#2f7a45'), 0, 0.81, 0);
    for (const s of [-1, 1]) { b.add(G.box(w, 0.06, 0.1), '#4a2e1a', 0, 0.83, s * (d / 2 - 0.05)); b.add(G.box(0.1, 0.06, d), '#4a2e1a', s * (w / 2 - 0.05), 0.83, 0); }
    legs(b, w, d, 0.7, 0.12, '#4a2e1a', 0.1);
    const cols = ['#fff', '#e8c22a', '#2a4ab0', '#c8302a', '#6a2a8a', '#111'];
    cols.forEach((c, i) => b.add(G.sph(0.03, 8, 6), c, -0.3 + (i % 3) * 0.07, 0.85, -0.1 + ((i / 3) | 0) * 0.07));
  },
  dartboard(b) {
    const z = zw + 0.02;
    b.add(G.cyl(0.24, 0.24, 0.04, 20), '#1c1c1c', 0, 1.6, z, PI / 2);
    b.add(G.cyl(0.18, 0.18, 0.042, 20), T('#c8302a'), 0, 1.6, z + 0.001, PI / 2);
    b.add(G.cyl(0.12, 0.12, 0.044, 20), '#e8dcc0', 0, 1.6, z + 0.002, PI / 2);
    b.add(G.cyl(0.03, 0.03, 0.046, 12), '#2f7a45', 0, 1.6, z + 0.003, PI / 2);
  },
  video_game(b, W, D, x) {
    b.add(G.box(0.8, 0.45, 0.4), '#3a3f4a', 0, 0.225, -0.15);
    b.add(G.box(0.3, 0.06, 0.2), T('#2a2a30'), 0, 0.48, -0.15);
    b.add(G.box(0.14, 0.03, 0.08), '#222', 0.2, 0.47, 0.05);
    b.add(G.box(0.8, 0.5, 0.08), '#1f2226', 0, 0.8, -0.28);
    x(new THREE.PlaneGeometry(0.72, 0.42), 'screen', 0, 0.8, -0.235);
  },
  pinball(b, W, D, x) {
    b.add(G.box(0.62, 0.3, 1.1), T('#b83a8a'), 0, 0.95, 0, -0.1);
    legs(b, 0.55, 1.0, 0.85, 0.05, '#222', 0.05);
    b.add(G.box(0.62, 0.7, 0.12), T('#b83a8a'), 0, 1.4, -0.5);
    x(new THREE.PlaneGeometry(0.54, 0.5), 'screen', 0, 1.42, -0.435);
  },
  treadmill(b, W, D) {
    b.add(G.box(0.7, 0.15, D - 0.3), '#2a2d33', 0, 0.075, 0.1);
    b.add(G.box(0.55, 0.02, D - 0.4), '#111', 0, 0.16, 0.1);
    for (const s of [-1, 1]) b.add(G.box(0.05, 1.2, 0.05), '#8a8f96', s * 0.32, 0.6, -D / 2 + 0.3);
    b.add(G.box(0.7, 0.25, 0.1), T('#3a3f4a'), 0, 1.25, -D / 2 + 0.3, 0.4);
  },
  hot_tub(b, W, D, x) {
    b.add(G.box(W - 0.1, 0.8, D - 0.1), T('#8a6a4a'), 0, 0.4, 0);
    x(new THREE.PlaneGeometry(W - 0.4, D - 0.4), waterMat(), 0, 0.72, 0, -PI / 2);
    return { water: true };
  },
  grill(b) {
    b.add(G.sph(0.3, 14, 8), T('#1c1c1c'), 0, 0.85, 0, 0, 0, 0, 1, 0.6, 1);
    for (let i = 0; i < 3; i++) { const a = i * PI * 2 / 3; b.add(G.cyl(0.02, 0.02, 0.8, 6), '#333', Math.sin(a) * 0.2, 0.4, Math.cos(a) * 0.2); }
    b.add(G.cyl(0.29, 0.29, 0.02, 16), '#777', 0, 0.87, 0);
  },
  coffee_maker(b) {
    b.add(G.box(0.22, 0.32, 0.22), T('#2a2a2e'), 0, 0.16, 0); b.add(G.cyl(0.07, 0.08, 0.14, 12), '#8fb0c0', 0, 0.09, 0.07); b.add(G.box(0.2, 0.03, 0.12), '#555', 0, 0.02, 0.05);
  },
  microwave(b, W, D, x) {
    b.add(G.box(0.5, 0.3, 0.36), T('#e8e8e4'), 0, 0.15, 0);
    b.add(G.box(0.32, 0.22, 0.01), '#1c1c20', -0.06, 0.15, 0.181); b.add(G.box(0.08, 0.2, 0.01), '#444', 0.18, 0.15, 0.181);
  },
  dishwasher(b) {
    b.add(G.box(0.96, 0.84, 0.62), T('#dfe2e4'), 0, 0.42, -0.14);
    b.add(G.box(1.0, 0.06, 0.7), C.stone, 0, 0.88, -0.12);
    b.add(G.box(0.7, 0.04, 0.03), '#888', 0, 0.75, 0.18);
  },
  washing_machine(b) {
    b.add(G.box(0.62, 0.86, 0.6), T('#f2f2ee'), 0, 0.43, -0.1);
    b.add(G.cyl(0.2, 0.2, 0.03, 20), '#9fb8c8', 0, 0.42, 0.21, PI / 2); b.add(G.cyl(0.15, 0.15, 0.035, 20), '#2a3a48', 0, 0.42, 0.215, PI / 2);
    b.add(G.box(0.5, 0.08, 0.02), '#ccc', 0, 0.78, 0.2);
  },
  toy_box(b) {
    b.add(G.box(0.8, 0.45, 0.5), T('#d8453a'), 0, 0.225, 0); b.add(G.box(0.84, 0.06, 0.54), '#f2c230', 0, 0.48, 0);
    b.add(G.sph(0.08, 8, 6), '#3a8ad8', 0.2, 0.58, 0); b.add(G.box(0.12, 0.12, 0.12), '#4ab84a', -0.2, 0.57, 0.05);
  },
  dollhouse(b) {
    b.add(G.box(0.8, 0.5, 0.5), '#e9d8b0', 0, 0.25, -0.1);
    b.add(G.box(0.7, 0.5, 0.4), T('#f2b8c8'), 0, 0.75, -0.12);
    b.add(G.cone(0.52, 0.35, 4), '#c85a3c', 0, 1.18, -0.12, 0, PI / 4, 0, 1, 1, 0.7);
    for (const sx of [-1, 1]) b.add(G.box(0.12, 0.12, 0.01), '#9fc4e8', sx * 0.18, 0.8, 0.085);
  },
  kids_bed(b, W, D) { bed(b, W, D, T('#f2a03a'), 1); },
  bunk_bed(b, W, D) {
    bed(b, W, D, T('#3a8ad8'), 1);
    const w = W - 0.08, d = D - 0.08;
    b.add(G.box(w, 0.2, d), C.woodD, 0, 1.3, 0); b.add(G.box(w - 0.08, 0.15, d - 0.12), C.sheet, 0, 1.47, 0.02);
    b.add(G.box(w - 0.04, 0.06, d * 0.6), '#d8453a', 0, 1.56, d * 0.2);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(G.box(0.07, 1.9, 0.07), C.wood, sx * (w / 2 - 0.03), 0.95, sz * (d / 2 - 0.03));
    for (let i = 0; i < 4; i++) b.add(G.box(0.04, 0.03, 0.3), C.wood, w / 2, 0.5 + i * 0.3, d / 2 - 0.3);
  },
  wardrobe(b, W) {
    b.add(G.box(W - 0.1, 2.0, 0.58), T(C.wood), 0, 1.0, -0.2);
    b.add(G.box(0.01, 1.9, 0.01), C.woodD, 0, 1.0, 0.095);
    for (const s of [-1, 1]) b.add(G.box(0.02, 0.2, 0.02), C.metal, s * 0.06, 1.05, 0.1);
  },
  desk_lamp(b, W, D, x) {
    b.add(G.cyl(0.08, 0.09, 0.03, 12), '#333', 0, 0.015, 0); b.add(G.cyl(0.012, 0.012, 0.35, 6), '#333', 0, 0.2, 0);
    x(new THREE.CylinderGeometry(0.06, 0.12, 0.13, 12, 1, true), MAT.glow, 0, 0.4, 0.03);
    return { light: [0, 0.35, 0.05] };
  },
  ceiling_lamp(b, W, D, x) {
    b.add(G.cyl(0.08, 0.08, 0.03, 10), '#e8e2d2', 0, 2.97, 0); b.add(G.cyl(0.008, 0.008, 0.5, 4), '#333', 0, 2.72, 0);
    x(new THREE.SphereGeometry(0.18, 12, 8, 0, PI * 2, 0, PI / 2), MAT.glow, 0, 2.47, 0, PI);
    return { light: [0, 2.3, 0] };
  },
  sculpture(b) {
    b.add(G.box(0.5, 0.8, 0.5), '#e8e4dc', 0, 0.4, 0);
    b.add(G.tor(0.2, 0.06, 8, 18), T('#b8862a'), 0, 1.1, 0); b.add(G.sph(0.1, 10, 8), T('#b8862a'), 0, 1.35, 0);
  },
  clock(b, W, D, x) {
    b.add(G.box(0.45, 2.0, 0.3), T('#5a3a22'), 0, 1.0, -0.3);
    b.add(G.cyl(0.16, 0.16, 0.02, 20), '#f4efe0', 0, 1.6, -0.14, PI / 2);
    b.add(G.box(0.01, 0.12, 0.01), '#111', 0, 1.64, -0.125); b.add(G.box(0.09, 0.01, 0.01), '#111', 0.04, 1.6, -0.125);
    b.add(G.cyl(0.05, 0.05, 0.01, 12), '#d8b24a', 0, 0.9, -0.14, PI / 2);
  },
  flower_vase(b) {
    b.add(G.cyl(0.07, 0.05, 0.22, 10), T('#3a6ab0'), 0, 0.11, 0);
    const rnd = mulberry(12);
    for (let i = 0; i < 6; i++) { const a = i; b.add(G.cyl(0.005, 0.005, 0.2, 4), '#3a7a2a', Math.sin(a) * 0.03, 0.3, Math.cos(a) * 0.03); b.add(G.sph(0.035, 6, 4), ['#e84a5a', '#f2d23a', '#f4f4f4'][i % 3], Math.sin(a) * 0.06, 0.4 + rnd() * 0.05, Math.cos(a) * 0.06); }
  },
  pool(b, W, D, x) {
    b.add(G.box(W, 0.06, 0.2), '#e8e4dc', 0, 0.03, -D / 2 + 0.1); b.add(G.box(W, 0.06, 0.2), '#e8e4dc', 0, 0.03, D / 2 - 0.1);
    b.add(G.box(0.2, 0.06, D), '#e8e4dc', -W / 2 + 0.1, 0.03, 0); b.add(G.box(0.2, 0.06, D), '#e8e4dc', W / 2 - 0.1, 0.03, 0);
    x(new THREE.PlaneGeometry(W - 0.4, D - 0.4), waterMat(), 0, 0.035, 0, -PI / 2);
    for (const s of [-1, 1]) b.add(G.box(0.03, 0.6, 0.03), '#ccc', W / 2 - 0.4 + s * 0.15, 0.3, D / 2 - 0.25);
    return { water: true };
  },
  park_bench(b, W) {
    const w = W - 0.2;
    for (let i = 0; i < 3; i++) b.add(G.box(w, 0.04, 0.1), T('#8a5a32'), 0, 0.45, -0.12 + i * 0.12);
    for (let i = 0; i < 2; i++) b.add(G.box(w, 0.1, 0.03), T('#8a5a32'), 0, 0.65 + i * 0.14, -0.22, -0.15);
    for (const s of [-1, 1]) { b.add(G.box(0.05, 0.45, 0.4), '#2a2d30', s * (w / 2 - 0.1), 0.225, -0.02); b.add(G.box(0.05, 0.45, 0.04), '#2a2d30', s * (w / 2 - 0.1), 0.65, -0.24, -0.15); }
  },
  fountain(b, W, D, x) {
    const r = Math.min(W, D) / 2 - 0.1;
    b.add(G.cyl(r, r + 0.05, 0.45, 24), T('#c8c2b6'), 0, 0.225, 0);
    x(new THREE.CircleGeometry(r - 0.12, 24), waterMat(), 0, 0.42, 0, -PI / 2);
    b.add(G.cyl(0.14, 0.2, 1.1, 10), '#b8b2a6', 0, 0.55, 0);
    b.add(G.cyl(r * 0.45, r * 0.3, 0.18, 18), '#c8c2b6', 0, 1.15, 0);
    x(new THREE.CircleGeometry(r * 0.4, 18), waterMat(), 0, 1.245, 0, -PI / 2);
    b.add(G.cyl(0.06, 0.08, 0.5, 8), '#b8b2a6', 0, 1.45, 0);
    return { spray: [0, 1.75, 0], water: true };
  },
  food_stall(b, W, D) {
    const w = W - 0.1, d = D - 0.1;
    b.add(G.box(w, 1.0, d * 0.5), '#e9e2d2', 0, 0.5, -d * 0.1);
    b.add(G.box(w + 0.05, 0.05, d * 0.55), '#8a5a32', 0, 1.02, -d * 0.1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(G.box(0.05, 2.3, 0.05), '#8a5a32', sx * (w / 2 - 0.03), 1.15, sz * (d / 2 - 0.03));
    const n = Math.max(4, Math.round(w * 4));
    for (let i = 0; i < n; i++) b.add(G.box(w / n, 0.06, d + 0.3), i % 2 ? '#f4f1ea' : T('#d8342c'), -w / 2 + (i + 0.5) * w / n, 2.35, 0.1, 0.18);
  },
  cash_register(b) {
    b.add(G.box(0.96, 0.95, 0.6), '#8a5a32', 0, 0.475, -0.1);
    b.add(G.box(0.4, 0.18, 0.35), T('#3a3f4a'), 0, 1.04, -0.15); b.add(G.box(0.3, 0.14, 0.03), '#6fd0ff', 0, 1.18, -0.3, -0.4);
  },
  shelf_shop(b, W) {
    const w = W - 0.08, rnd = mulberry((W * 97) | 0), cols = ['#d8453a', '#f2c230', '#3a8ad8', '#4ab84a', '#f4f1ea', '#e87a2a'];
    b.add(G.box(w, 1.8, 0.05), '#dcdcd8', 0, 0.9, -0.38);
    for (const s of [-1, 1]) b.add(G.box(0.04, 1.8, 0.45), '#bfc3c7', s * (w / 2 - 0.02), 0.9, -0.18);
    for (let i = 0; i < 4; i++) {
      const y = 0.1 + i * 0.45; b.add(G.box(w, 0.03, 0.42), T('#bfc3c7'), 0, y, -0.17);
      for (let k = 0; k < Math.floor(w / 0.16); k++) { const h = 0.12 + rnd() * 0.2; b.add(G.box(0.12, h, 0.2), cols[(rnd() * 6) | 0], -w / 2 + 0.1 + k * 0.16, y + 0.015 + h / 2, -0.15); }
    }
  },
  cafe_table(b, W, D, x) {
    b.add(G.cyl(0.38, 0.38, 0.04, 18), T('#f4f1ea'), 0, 0.74, 0); b.add(G.cyl(0.04, 0.04, 0.72, 8), '#333', 0, 0.36, 0); b.add(G.cyl(0.25, 0.25, 0.03, 12), '#333', 0, 0.015, 0);
    b.add(G.cyl(0.06, 0.05, 0.08, 10), '#e9e4d8', 0.1, 0.8, 0.05);
  },
  gym_machine(b, W, D) {
    for (const sx of [-1, 1]) b.add(G.box(0.06, 2.0, 0.06), '#555a60', sx * 0.4, 1.0, -D / 2 + 0.2);
    b.add(G.box(0.86, 0.06, 0.06), '#555a60', 0, 2.0, -D / 2 + 0.2);
    for (let i = 0; i < 8; i++) b.add(G.box(0.3, 0.04, 0.15), '#222', 0, 0.2 + i * 0.05, -D / 2 + 0.2);
    b.add(G.box(0.45, 0.1, 0.6), T('#b8322c'), 0, 0.5, 0.1); b.add(G.box(0.45, 0.6, 0.1), T('#b8322c'), 0, 0.85, -0.2);
  },
  library_shelf(b, W) {
    const w = W - 0.08;
    b.add(G.box(w, 2.2, 0.04), T(C.woodD), 0, 1.1, -0.38);
    for (const s of [-1, 1]) b.add(G.box(0.04, 2.2, 0.38), T(C.woodD), s * (w / 2 - 0.02), 1.1, -0.21);
    for (let i = 0; i < 5; i++) { const y = 0.05 + i * 0.43; b.add(G.box(w, 0.03, 0.36), T(C.woodD), 0, y, -0.21); if (i < 5) books(b, w, y + 0.015, -0.22, 20 + i); }
  },
  museum_exhibit(b, W, D, x) {
    b.add(G.box(0.7, 0.9, 0.7), '#2a2d33', 0, 0.45, 0);
    b.add(G.sph(0.18, 10, 8), T('#c8a040'), 0, 1.1, 0, 0, 0, 0, 1, 1.4, 1);
    x(new THREE.BoxGeometry(0.66, 0.66, 0.66), MAT.frosted, 0, 1.23, 0);
  },
  swing_set(b, W, D) {
    const w = W - 0.2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(G.box(0.07, 2.3, 0.07), T('#c8302a'), sx * w / 2, 1.1, sz * 0.4, sz * 0.2);
    b.add(G.cyl(0.04, 0.04, w, 8), T('#c8302a'), 0, 2.2, 0, 0, 0, PI / 2);
    for (const sx of [-0.25, 0.25]) { for (const dx of [-0.18, 0.18]) b.add(G.box(0.01, 1.7, 0.01), '#555', sx * w + dx, 1.35, 0); b.add(G.box(0.42, 0.04, 0.18), '#3a3a3a', sx * w, 0.5, 0); }
  },
  sandbox(b, W, D) {
    const w = W - 0.1, d = D - 0.1;
    for (const s of [-1, 1]) { b.add(G.box(w, 0.25, 0.1), T('#a0714a'), 0, 0.125, s * (d / 2 - 0.05)); b.add(G.box(0.1, 0.25, d), T('#a0714a'), s * (w / 2 - 0.05), 0.125, 0); }
    b.add(G.box(w - 0.2, 0.15, d - 0.2), '#e9d59a', 0, 0.075, 0);
    b.add(G.cone(0.12, 0.15, 8), '#d8453a', 0.2, 0.22, 0.1); b.add(G.cyl(0.06, 0.05, 0.1, 8), '#3a8ad8', -0.2, 0.2, -0.1);
  },
  trash_bin_street(b) {
    b.add(G.cyl(0.24, 0.22, 0.85, 12), T('#3f6a3a'), 0, 0.425, 0); b.add(G.cyl(0.26, 0.26, 0.05, 12), '#2d4a2a', 0, 0.87, 0);
  },
  streetlight(b, W, D, x) {
    b.add(G.cyl(0.12, 0.14, 0.2, 8), '#2a2d30', 0, 0.1, 0); b.add(G.cyl(0.05, 0.06, 3.4, 8), T('#2a2d30'), 0, 1.8, 0);
    b.add(G.box(0.05, 0.05, 0.5), T('#2a2d30'), 0, 3.45, 0.22);
    x(new THREE.CylinderGeometry(0.1, 0.18, 0.2, 10), MAT.glow, 0, 3.35, 0.45);
    return { light: [0, 3.1, 0.45], street: true };
  },
  hedge(b, W, D) { b.add(G.box(W - 0.05, 0.9, Math.min(D, 0.7)), T('#3f6e32'), 0, 0.45, 0); b.add(G.box(W - 0.15, 0.1, Math.min(D, 0.7) - 0.1), '#4f8a3c', 0, 0.94, 0); },
  tree(b, W, D) {
    const s = Math.max(1, Math.min(W, D)) * 0.9, rnd = mulberry((W * 31 + D) | 0);
    b.add(G.cyl(0.1 * s, 0.14 * s, 1.6 * s, 7), '#6b4a2e', 0, 0.8 * s, 0);
    b.add(G.sph(0.9 * s, 9, 7), T('#4f7f36'), 0, 2.1 * s, 0); b.add(G.sph(0.6 * s, 8, 6), T('#5f9140'), 0.35 * s, 2.6 * s, -0.2 * s); b.add(G.sph(0.55 * s, 8, 6), T('#4a7a30'), -0.4 * s, 2.3 * s, 0.25 * s + rnd() * 0.01);
  },
  flowerbed(b, W, D) {
    b.add(G.box(W - 0.1, 0.18, D - 0.1), '#5a3f2a', 0, 0.09, 0);
    const rnd = mulberry((W * 13 + D) | 0), n = Math.round((W * D) * 10), cols = [T('#e84a5a'), '#f2d23a', '#f4f4f4', '#b84ae8'];
    for (let i = 0; i < n; i++) { const px = (rnd() - 0.5) * (W - 0.3), pz = (rnd() - 0.5) * (D - 0.3); b.add(G.cyl(0.01, 0.01, 0.2, 4), '#3a7a2a', px, 0.28, pz); b.add(G.sph(0.05, 6, 4), cols[i % 4], px, 0.4, pz); }
  },
  fence(b, W) {
    const w = W;
    for (let i = 0; i <= w; i++) b.add(G.box(0.08, 0.9, 0.08), T('#f4f1ea'), -w / 2 + i, 0.45, 0);
    for (const y of [0.3, 0.7]) b.add(G.box(w, 0.07, 0.04), T('#f4f1ea'), 0, y, 0);
    for (let i = 0; i < w * 5; i++) b.add(G.box(0.07, 0.8, 0.02), T('#f4f1ea'), -w / 2 + 0.1 + i * 0.2, 0.42, 0.03);
  },
};
