// Общие помощники рендера: примитивы с вертекс-цветами, слияние, canvas-текстуры.
// Портировано из /Users/egurvanov/python/russia/index.html (P/mergeGeos/Bld :378-401, ctex :333-376).
import * as THREE from 'three';

export const V3 = THREE.Vector3;
export const PI = Math.PI, TAU = PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// экспоненциальное сглаживание, не зависящее от fps
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));

// Примитивы
export const G = {
  box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
  cyl: (a, b, h, s = 12) => new THREE.CylinderGeometry(a, b, h, s),
  cone: (r, h, s = 12) => new THREE.ConeGeometry(r, h, s),
  sph: (r, a = 12, b = 8) => new THREE.SphereGeometry(r, a, b),
  tor: (r, t, a = 8, b = 20) => new THREE.TorusGeometry(r, t, a, b),
  cap: (r, l, s = 8) => new THREE.CapsuleGeometry(r, l, 3, s),
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new V3(), _s = new V3();

// Геометрия в позиции/повороте/масштабе + вертекс-цвет (russia P()).
export function P(geo, col, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  _e.set(rx, ry, rz); _q.setFromEuler(_e); _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz)); g.applyMatrix4(_m);
  const c = new THREE.Color(col), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

// Слияние списка неиндексированных геометрий (position/normal/color [+uv]).
export function mergeGeos(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const withUv = list.every(g => g.attributes.uv);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = withUv ? new Float32Array(n * 2) : null;
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
    if (uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count; g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  return geo;
}

// Строитель: add(...) копит детали, geo() — одна геометрия.
export class Bld {
  constructor() { this.l = []; }
  add(geo, col, ...a) { this.l.push(P(geo, col, ...a)); return this; }
  geo() { return this.l.length ? mergeGeos(this.l) : null; }
}

// Canvas-текстуры (russia ctex)
export function ctex(w, h, draw, rep = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// детерминированный ГПСЧ (worldfill.js mulberry, /Users/egurvanov/python/game/worldfill.js:47)
export function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Настроение из мотивов (−100..100). Локальная копия: Рендер не импортирует Мозг.
export function moodOf(sim) {
  const m = sim?.motives; if (!m) return 0;
  const v = Object.values(m).filter(x => typeof x === 'number');
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

// Цвет нимба по настроению: красный (−100) → белый (0) → зелёный (+100)
const RED = new THREE.Color('#ff4a3a'), WHITE = new THREE.Color('#f4fff0'), GREEN = new THREE.Color('#5cff3a');
export function moodColor(mood, out = new THREE.Color()) {
  const t = clamp(mood / 100, -1, 1);
  return t >= 0 ? out.copy(WHITE).lerp(GREEN, sstep(0, 0.35, t)) : out.copy(WHITE).lerp(RED, sstep(0, 0.6, -t));
}
