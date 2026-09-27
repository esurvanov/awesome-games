// Автокрыша TS1: над закрытыми комнатами верхнего занятого этажа; один стиль на участок
// state.lot.roof = {style:'gable'|'hip'|'flat', color, pitch}. Источник следа — world.roofFootprints(state),
// если Мир его дал; иначе считаем сами: «внутренние» клетки этажа L без пола на L+1 → жадные прямоугольники.
import * as THREE from 'three';
import { ctex, mulberry } from './util.js';
import { LEVEL_H } from './lot.js';

const OVER = 0.35;         // свес
const RIDGE_GEO = new THREE.BoxGeometry(0.14, 0.1, 1);
const DEF = { style: 'gable', color: '#8a4b3a', pitch: 0.5 };

// Прямоугольники из маски клеток (жадно: самый широкий ряд вниз, пока ряд целиком занят)
function rects(mask, W, H) {
  const used = new Uint8Array(W * H), out = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!mask[i] || used[i]) continue;
    let w = 0; while (x + w < W && mask[y * W + x + w] && !used[y * W + x + w]) w++;
    let h = 1;
    outer: while (y + h < H) { for (let k = 0; k < w; k++) { const j = (y + h) * W + x + k; if (!mask[j] || used[j]) break outer; } h++; }
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) used[yy * W + xx] = 1;
    out.push({ x, y, w, h });
  }
  return out;
}

// Следы крыши: [{x,y,w,h,level}] — принимаем и {x0,y0,x1,y1} (вершины) от Мира
export function roofFootprints(state, lot, world) {
  if (world?.roofFootprints) {
    try {
      const res = world.roofFootprints(state);
      // формат Мира: {style,color,pitch, levels:[{level, rects:[{x,y,w,h}]}]}; принимаем и плоский массив
      if (Array.isArray(res)) return res.map(r => r.w != null ? r : { x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0, level: r.level || 0 });
      return (res?.levels || []).flatMap(l => l.rects.map(r => ({ ...r, level: l.level })));
    } catch (e) { console.warn('[render] roofFootprints', e); }
  }
  const { w: W, h: H } = state.lot, out = [];
  state.lot.levels.forEach((_, level) => {
    const ind = lot.indoor[level]; if (!ind) return;
    const up = state.lot.levels[level + 1];
    const mask = new Uint8Array(W * H);
    let any = false;
    for (let i = 0; i < W * H; i++) if (ind[i] && !(up && up.floor[i] > 0)) { mask[i] = 1; any = true; }
    if (any) rects(mask, W, H).filter(r => r.w * r.h >= 2).forEach(r => out.push({ ...r, level }));
  });
  return out;
}

function shingles(color) {
  const base = new THREE.Color(color);
  return ctex(128, 128, (x, w, h) => {
    const rnd = mulberry(9);
    x.fillStyle = color; x.fillRect(0, 0, w, h);
    for (let r = 0; r < 8; r++) for (let c = -1; c < 5; c++) {
      x.fillStyle = '#' + base.clone().multiplyScalar(0.82 + rnd() * 0.3).getHexString();
      x.fillRect(c * 32 + (r % 2) * 16 + 1, r * 16 + 1, 30, 14);
    }
    x.fillStyle = 'rgba(0,0,0,.25)'; for (let r = 0; r < 8; r++) x.fillRect(0, r * 16 + 14, w, 2);
  });
}

export function createRoof(scene) {
  const group = new THREE.Group(); group.name = 'roof'; scene.add(group);
  let mat = null, trimMat = new THREE.MeshStandardMaterial({ color: '#e9e2d2', roughness: 0.8, side: THREE.DoubleSide }), key = '';
  const ridgeMat = new THREE.MeshStandardMaterial({ color: '#4a2a22', roughness: 0.9 });
  const gableMat = new THREE.MeshStandardMaterial({ color: '#d8cdb8', roughness: 0.9, side: THREE.DoubleSide });

  // треугольники + uv (u — вдоль конька, v — по скату); p — массив [x,y,z]
  function mesh(tris, m) {
    const pos = [], uv = [];
    for (const t of tris) for (const v of t) { pos.push(v[0], v[1], v[2]); uv.push(v[3] ?? 0, v[4] ?? 0); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const o = new THREE.Mesh(g, m); o.castShadow = true; o.receiveShadow = true; o.raycast = () => {};
    return o;
  }

  // Одна крыша над прямоугольником: конёк вдоль длинной стороны
  function build(r, roof) {
    const y0 = (r.level + 1) * LEVEL_H + 0.02, alongX = r.w >= r.h;
    // локально: L — вдоль конька, S — поперёк; затем переводим в мир
    const L = (alongX ? r.w : r.h) + OVER * 2, S = (alongX ? r.h : r.w) + OVER * 2;
    const cx = r.x + r.w / 2, cz = r.y + r.h / 2, hs = S / 2, hl = L / 2;
    const rise = roof.style === 'flat' ? 0 : Math.min(3.5, hs * (roof.pitch || 0.5));
    const P = (l, y, s, u, v) => alongX ? [cx + l, y0 + y, cz + s, u, v] : [cx + s, y0 + y, cz + l, u, v];
    const g = new THREE.Group();
    const slope = Math.hypot(hs, rise);
    if (roof.style === 'flat') {
      g.add(mesh([[P(-hl, 0.15, -hs, 0, 0), P(hl, 0.15, -hs, L, 0), P(hl, 0.15, hs, L, S)], [P(-hl, 0.15, -hs, 0, 0), P(hl, 0.15, hs, L, S), P(-hl, 0.15, hs, 0, S)]], mat));
      const box = new THREE.Mesh(new THREE.BoxGeometry(alongX ? L : S, 0.3, alongX ? S : L), trimMat); box.position.set(cx, y0 + 0.0, cz); box.castShadow = true; box.raycast = () => {};
      g.add(box); return g;
    }
    const ridge = roof.style === 'hip' ? Math.max(0, hl - hs) : hl;
    const tris = [];
    // два ската
    for (const sg of [-1, 1]) {
      const a = P(-hl, 0, sg * hs, 0, 0), b = P(hl, 0, sg * hs, L, 0), c = P(ridge, rise, 0, hl + ridge, slope), d = P(-ridge, rise, 0, hl - ridge, slope);
      tris.push([a, b, c], [a, c, d]);
    }
    if (roof.style === 'hip') { // торцевые скаты
      for (const sg of [-1, 1]) tris.push([P(sg * hl, 0, -hs, 0, 0), P(sg * hl, 0, hs, S, 0), P(sg * ridge, rise, 0, hs, slope)]);
    }
    g.add(mesh(tris, mat));
    // конёк и рёбра вальм — тёмные брусья, чтобы форма читалась при любом солнце
    const beam = (a, b) => {
      const va = new THREE.Vector3(a[0], a[1], a[2]), vb = new THREE.Vector3(b[0], b[1], b[2]), len = va.distanceTo(vb);
      if (len < 0.01) return;
      const m = new THREE.Mesh(RIDGE_GEO, ridgeMat); m.scale.set(1, 1, len); m.position.copy(va).add(vb).multiplyScalar(0.5); m.lookAt(vb);
      m.castShadow = false; m.raycast = () => {}; g.add(m);
    };
    beam(P(-ridge, rise + 0.03, 0), P(ridge, rise + 0.03, 0));
    if (roof.style === 'hip') for (const sl of [-1, 1]) for (const ss of [-1, 1]) beam(P(sl * ridge, rise + 0.03, 0), P(sl * hl, 0.03, ss * hs));
    if (roof.style === 'gable') { // фронтоны: треугольники стены под свесом
      const gt = [];
      for (const sg of [-1, 1]) { const l = sg * (hl - OVER); gt.push([P(l, 0, -(hs - OVER), 0, 0), P(l, 0, hs - OVER, 0, 0), P(l, rise * (hs - OVER) / hs, 0, 0, 0)]); }
      g.add(mesh(gt, gableMat));
    }
    // карниз: тонкая доска по периметру свеса
    const fas = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), trimMat); m.position.set(x, y0 - 0.05, z); m.castShadow = false; m.raycast = () => {}; g.add(m); };
    const ex = alongX ? L : S, ez = alongX ? S : L;
    fas(ex, 0.06, cx, cz - ez / 2); fas(ex, 0.06, cx, cz + ez / 2);
    if (roof.style === 'hip') { fas(0.06, ez, cx - ex / 2, cz); fas(0.06, ez, cx + ex / 2, cz); }
    return g;
  }

  const R = { group, levels: [] };
  R.rebuild = (state, lot, world) => {
    const roof = { ...DEF, ...(state.lot.roof || {}) };
    const fps = roofFootprints(state, lot, world);
    const k = JSON.stringify([roof, fps]); if (k === key) return; key = k;
    if (!mat || mat.userData.color !== roof.color) {
      mat?.map?.dispose(); mat?.dispose();
      mat = new THREE.MeshStandardMaterial({ map: shingles(roof.color), roughness: 0.85, side: THREE.DoubleSide });
      mat.map.repeat.set(1, 1.6); mat.userData.color = roof.color;
    }
    while (group.children.length) { const c = group.children.pop(); c.traverse(m => m.geometry?.dispose()); }
    R.levels = [];
    for (const r of fps) { const g = build(r, roof); g.userData.level = r.level; group.add(g); R.levels.push(r.level); }
  };
  // видна только в режиме «стены подняты» и когда смотрим на этаж крыши или выше
  R.update = (mode, viewLevel) => { for (const g of group.children) g.visible = mode === 'up' && viewLevel >= g.userData.level; };
  return R;
}
