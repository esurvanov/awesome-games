// Участок: трава, тротуар/улица у стороны y=h, граница, полы по типам (1 меш на тип на этаж),
// стены на рёбрах (InstancedMesh единичных коробок) с проёмами под двери/окна и режимами up/cutaway/down.
import * as THREE from 'three';
import { FLOORS, WALLS, byId, kindOf } from '../../data/catalog.js';
import { Bld, G, ctex, mulberry, clamp } from './util.js';

export const WALL_H = 3, WALL_T = 0.15, LOW_CUT = 0.4, LOW_DOWN = 0.28, LEVEL_H = 3;
export const DOOR_TOP = 2.2, WIN_BOTTOM = 0.9, WIN_TOP = 2.1;

// Ребро, в котором стоит настенный предмет (дверь/окно/картина/зеркало).
// Соглашение Рендера: предмет в тайле (x,y) висит на «задней» стене своего тайла —
// rot0 → wallH(x,y); rot1 → wallV(x,y); rot2 → wallH(x,y+1); rot3 → wallV(x+1,y).
// Если там стены нет, а на противоположном ребре есть — берём противоположное.
export function wallEdgeOf(lot, o) {
  const { x, y } = o, r = ((o.rot || 0) % 4 + 4) % 4, lv = lot.levels[o.level || 0];
  const cand = [
    [{ dir: 'h', x, y }, { dir: 'h', x, y: y + 1 }],
    [{ dir: 'v', x, y }, { dir: 'v', x: x + 1, y }],
    [{ dir: 'h', x, y: y + 1 }, { dir: 'h', x, y }],
    [{ dir: 'v', x: x + 1, y }, { dir: 'v', x, y }],
  ][r];
  const has = e => lv && edgeWall(lot, lv, e.dir, e.x, e.y) > 0;
  return !has(cand[0]) && has(cand[1]) ? { ...cand[1], flip: true } : { ...cand[0], flip: false };
}

export function edgeWall(lot, lv, dir, x, y) {
  const { w, h } = lot;
  if (dir === 'h') return x >= 0 && x < w && y >= 0 && y <= h ? lv.wallH[y * w + x] | 0 : 0;
  return x >= 0 && x <= w && y >= 0 && y < h ? lv.wallV[y * (w + 1) + x] | 0 : 0;
}
// Клетки лестницы (fp 1×4 с поворотом)
export function stairTiles(o) {
  const r = (o.rot || 0) & 1, w = r ? 4 : 1, d = r ? 1 : 4, out = [];
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) out.push([o.x + i, o.y + j]);
  return out;
}
// Высота над полом этажа на лестнице: 0 у нижнего входа («лицо» rot) → LEVEL_H у верхнего края. null — не на лестнице
export function stairHeight(o, x, z) {
  const r = ((o.rot || 0) % 4 + 4) % 4, W = r & 1 ? 4 : 1, D = r & 1 ? 1 : 4;
  if (x < o.x || x > o.x + W || z < o.y || z > o.y + D) return null;
  const t = [(o.y + D - z) / D, (o.x + W - x) / W, (z - o.y) / D, (x - o.x) / W][r]; // доля пути от нижнего входа
  return Math.max(0, Math.min(1, t)) * LEVEL_H;
}
export const edgeKey = (level, dir, x, y) => `${level}:${dir}:${x}:${y}`;

// --- текстуры полов/травы (canvas, без файлов — приём russia ctex) ---
function floorTexture(f) {
  const base = new THREE.Color(f.color);
  const hex = (c, k) => '#' + c.clone().multiplyScalar(k).getHexString();
  return ctex(128, 128, (x, w, h) => {
    const rnd = mulberry(f.id * 97);
    // узор: f.pattern (волна 3: каталог полов) или по id
    const pat = f.pattern || ['parquet', 'tile', 'carpet', 'lino'][((f.id - 1) % 4 + 4) % 4];
    x.fillStyle = f.color; x.fillRect(0, 0, w, h);
    if (/parquet|wood|plank|паркет|дерев/i.test(pat)) { // паркет: доски
      for (let i = 0; i < 4; i++) {
        const off = (i % 2) * 48;
        for (let j = -1; j < 2; j++) { x.fillStyle = hex(base, 0.86 + rnd() * 0.24); x.fillRect(i * 32 + 1, off + j * 96 + 1, 30, 94); }
      }
      x.globalAlpha = 0.12; for (let i = 0; i < 180; i++) { x.fillStyle = rnd() < 0.5 ? '#3a2410' : '#fff0d8'; x.fillRect(rnd() * w, rnd() * h, 1, 6 + rnd() * 14); }
    } else if (/tile|stone|marble|плит|камен|мрам/i.test(pat)) { // плитка: 2×2 на тайл, швы
      x.fillStyle = hex(base, 0.78); x.fillRect(0, 0, w, h);
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { x.fillStyle = hex(base, 0.97 + rnd() * 0.06); x.fillRect(i * 64 + 2, j * 64 + 2, 60, 60); }
    } else if (/carpet|rug|ковр/i.test(pat)) { // ковролин: ворс
      for (let i = 0; i < 2500; i++) { x.fillStyle = hex(base, 0.85 + rnd() * 0.3); x.fillRect(rnd() * w, rnd() * h, 2, 2); }
    } else { // линолеум: шахматка
      x.fillStyle = hex(base, 0.82); x.fillRect(0, 0, 64, 64); x.fillRect(64, 64, 64, 64);
      x.globalAlpha = 0.08; for (let i = 0; i < 400; i++) { x.fillStyle = '#000'; x.fillRect(rnd() * w, rnd() * h, 2, 2); }
    }
    x.globalAlpha = 1; x.strokeStyle = 'rgba(0,0,0,.12)'; x.lineWidth = 2; x.strokeRect(0, 0, w, h);
  });
}
export function grassTexture() {
  return ctex(256, 256, (x, w, h) => {
    const rnd = mulberry(7);
    x.fillStyle = '#6f9a45'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { // пятна
      const g = x.createRadialGradient(0, 0, 0, 0, 0, 30 + rnd() * 40); const c = rnd() < 0.5 ? '120,165,70' : '92,135,58';
      g.addColorStop(0, `rgba(${c},.35)`); g.addColorStop(1, `rgba(${c},0)`);
      x.save(); x.translate(rnd() * w, rnd() * h); x.fillStyle = g; x.fillRect(-70, -70, 140, 140); x.restore();
    }
    for (let i = 0; i < 5000; i++) { const v = rnd(); x.fillStyle = v < 0.5 ? 'rgba(60,95,35,.35)' : 'rgba(150,190,90,.3)'; x.fillRect(rnd() * w, rnd() * h, 1, 2 + rnd() * 2); }
  });
}
export function pavedTexture(kind) {
  return ctex(128, 128, (x, w, h) => {
    const rnd = mulberry(kind === 'walk' ? 3 : 5);
    x.fillStyle = kind === 'walk' ? '#c9c6bd' : '#5d6167'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) { const v = rnd(); x.fillStyle = v < 0.5 ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.07)'; x.fillRect(rnd() * w, rnd() * h, 2, 2); }
    if (kind === 'walk') { x.strokeStyle = 'rgba(0,0,0,.18)'; x.lineWidth = 2; x.strokeRect(0, 0, w, h); }
  });
}

// Единичная коробка стены: x,z ∈ [−.5,.5], y ∈ [0,1]; верхняя грань темнее (срез стены, как в TS1).
function wallUnitGeo() {
  const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed(); g.translate(0, 0.5, 0);
  const n = g.attributes.normal, col = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) { const k = n.getY(i) > 0.5 ? 0.42 : n.getY(i) < -0.5 ? 0.3 : 1; col.set([k, k, k], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function createLot(scene, state) {
  const lot = state.lot, W = lot.w, H = lot.h;
  const root = new THREE.Group(); root.name = 'lot'; scene.add(root);
  const levelGroups = lot.levels.map((_, i) => { const g = new THREE.Group(); g.name = 'level' + i; root.add(g); return g; });

  // --- окружение: трава, тротуар, улица, деревья (статично) ---
  const grassTex = grassTexture(); grassTex.repeat.set(60, 60);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(W / 2, 0, H / 2); ground.receiveShadow = true; ground.name = 'ground';
  root.add(ground);
  // тротуар и улица вдоль y=h (+Z) — сторона, где стоит камера по умолчанию
  const walkTex = pavedTexture('walk'); walkTex.repeat.set(W + 60, 1);
  const walk = new THREE.Mesh(new THREE.PlaneGeometry(W + 60, 1.6), new THREE.MeshStandardMaterial({ map: walkTex, roughness: 0.95 }));
  walk.rotation.x = -Math.PI / 2; walk.position.set(W / 2, 0.012, H + 0.8); walk.receiveShadow = true; root.add(walk);
  const roadTex = pavedTexture('road'); roadTex.repeat.set((W + 60) / 2, 3);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(W + 60, 6.5), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.9 }));
  road.rotation.x = -Math.PI / 2; road.position.set(W / 2, 0.008, H + 1.6 + 3.25); road.receiveShadow = true; root.add(road);
  {
    const b = new Bld();
    b.add(G.box(W + 60, 0.12, 0.14), '#b8b4aa', W / 2, 0.06, H + 1.6); // бордюр
    for (let x = -30; x < W + 30; x += 3) b.add(G.box(1.4, 0.01, 0.14), '#e8e2c8', x + 0.7, 0.015, H + 4.85); // разметка
    b.add(G.box(W + 60, 0.06, 1.4), '#c3c0b6', W / 2, 0.03, H + 8.8); // дальний тротуар
    // деревья и кусты вокруг участка
    const rnd = mulberry(42);
    const tree = (x, z, s) => {
      b.add(G.cyl(0.12 * s, 0.16 * s, 1.4 * s, 7), '#6b4a2e', x, 0.7 * s, z);
      if (rnd() < 0.5) { b.add(G.sph(1.0 * s, 9, 7), '#4f7f36', x, 1.9 * s, z); b.add(G.sph(0.7 * s, 8, 6), '#5f9140', x + 0.4 * s, 2.4 * s, z - 0.2 * s); }
      else { b.add(G.cone(1.0 * s, 2.2 * s, 8), '#3f6e3a', x, 2.2 * s, z); b.add(G.cone(0.75 * s, 1.6 * s, 8), '#4b7d42', x, 3.0 * s, z); }
    };
    for (let i = 0; i < 26; i++) {
      const side = i % 3; let x, z;
      if (side === 0) { x = -2 - rnd() * 8; z = rnd() * (H + 1); }
      else if (side === 1) { x = W + 2 + rnd() * 8; z = rnd() * (H + 1); }
      else { x = rnd() * (W + 16) - 8; z = -2 - rnd() * 8; }
      tree(x, z, 0.8 + rnd() * 0.6);
    }
    for (let i = 0; i < 10; i++) { const x = rnd() * (W + 20) - 10; tree(x, H + 10.5 + rnd() * 4, 0.9 + rnd() * 0.5); }
    const deco = new THREE.Mesh(b.geo(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
    deco.castShadow = true; deco.receiveShadow = true; root.add(deco);
  }
  // граница участка — тонкая светлая линия
  {
    const pts = [[0, 0], [W, 0], [W, H], [0, H], [0, 0]].map(([x, z]) => new THREE.Vector3(x, 0.03, z));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xf2f6e6, transparent: true, opacity: 0.35 }));
    root.add(line);
  }
  // сетка тайлов (видна в режимах покупки/стройки)
  const grid = (() => {
    const p = [];
    for (let i = 0; i <= W; i++) p.push(i, 0, 0, i, 0, H);
    for (let j = 0; j <= H; j++) p.push(0, 0, j, W, 0, j);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false }));
    l.position.y = 0.035; l.visible = false; l.renderOrder = 2; root.add(l); return l;
  })();

  // --- материалы полов/стен ---
  const floorMats = new Map();
  const floorMat = (id) => {
    if (!floorMats.has(id)) {
      const f = FLOORS.find(f => f.id === id) || { id, color: '#bbbbbb' };
      floorMats.set(id, new THREE.MeshStandardMaterial({ map: floorTexture(f), roughness: /tile|stone|marble/i.test(f.pattern || (f.id === 2 ? 'tile' : '')) ? 0.55 : 0.85, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    }
    return floorMats.get(id);
  };
  const wallColor = (id) => new THREE.Color((WALLS.find(w => w.id === id) || WALLS[0]).color);
  const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const unit = wallUnitGeo();

  const L = {
    root, ground, grid, levelGroups,
    walls: [],          // по этажу: {mesh, segs:[{dir,x,y,y0,y1,key}]}
    floors: [],         // по этажу: [mesh]
    indoor: [],         // по этажу: Uint8Array w*h — «внутри» (пол или замкнуто стенами)
    lowered: new Set(), // ключи рёбер, опущенных сейчас
    mode: 'up', level: 0,
  };

  // Тайлы внутри: пол ≠ 0 или недостижимы снаружи участка без пересечения стен (flood fill).
  function computeIndoor(lv) {
    const out = new Uint8Array(W * H), seen = new Uint8Array(W * H), q = [];
    const push = (x, y) => { const i = y * W + x; if (!seen[i]) { seen[i] = 1; q.push(i); } };
    for (let x = 0; x < W; x++) { if (!edgeWall(lot, lv, 'h', x, 0)) push(x, 0); if (!edgeWall(lot, lv, 'h', x, H)) push(x, H - 1); }
    for (let y = 0; y < H; y++) { if (!edgeWall(lot, lv, 'v', 0, y)) push(0, y); if (!edgeWall(lot, lv, 'v', W, y)) push(W - 1, y); }
    while (q.length) {
      const i = q.pop(), x = i % W, y = (i / W) | 0;
      if (x > 0 && !edgeWall(lot, lv, 'v', x, y)) push(x - 1, y);
      if (x < W - 1 && !edgeWall(lot, lv, 'v', x + 1, y)) push(x + 1, y);
      if (y > 0 && !edgeWall(lot, lv, 'h', x, y)) push(x, y - 1);
      if (y < H - 1 && !edgeWall(lot, lv, 'h', x, y + 1)) push(x, y + 1);
    }
    for (let i = 0; i < W * H; i++) out[i] = (lv.floor[i] | 0) > 0 || !seen[i] ? 1 : 0;
    return out;
  }

  // Проём в полу этажа над лестницей (лестница стоит на level−1)
  function stairHoles(level) {
    const out = new Set(); if (level < 1) return out;
    for (const o of state.objects) if (kindOf(o.def) === 'stairs' && (o.level || 0) === level - 1)
      for (const [x, y] of stairTiles(o)) out.add(y * W + x);
    return out;
  }

  function buildFloors(level) {
    const lv = lot.levels[level], g = levelGroups[level], y = level * LEVEL_H + 0.015;
    (L.floors[level] || []).forEach(m => { g.remove(m); m.geometry.dispose(); });
    const byType = new Map(), hole = stairHoles(level);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const id = lv.floor[j * W + i] | 0; if (!id || hole.has(j * W + i)) continue;
      (byType.get(id) || byType.set(id, []).get(id)).push(i, j);
    }
    const meshes = [];
    for (const [id, tiles] of byType) {
      const n = tiles.length / 2, pos = new Float32Array(n * 18), nor = new Float32Array(n * 18), uv = new Float32Array(n * 12);
      for (let k = 0; k < n; k++) {
        const x = tiles[k * 2], z = tiles[k * 2 + 1];
        const q = [x, z, x, z + 1, x + 1, z + 1, x, z, x + 1, z + 1, x + 1, z];
        for (let v = 0; v < 6; v++) {
          pos.set([q[v * 2], y, q[v * 2 + 1]], k * 18 + v * 3); nor.set([0, 1, 0], k * 18 + v * 3);
          uv.set([q[v * 2], -q[v * 2 + 1]], k * 12 + v * 2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const m = new THREE.Mesh(geo, floorMat(id)); m.receiveShadow = true; m.userData.floor = { level, id };
      if (level > 0) m.castShadow = true;
      g.add(m); meshes.push(m);
    }
    L.floors[level] = meshes;
  }

  // проёмы: ключ ребра → 'door'|'window'
  function openingsFor(level) {
    const map = new Map();
    for (const o of state.objects) {
      if ((o.level || 0) !== level) continue;
      const d = byId[o.def]; if (!d || d.place !== 'wall' || (kindOf(o.def) !== 'door' && kindOf(o.def) !== 'window' && !d.portal)) continue;
      const e = wallEdgeOf(lot, o); map.set(edgeKey(level, e.dir, e.x, e.y), kindOf(o.def) === 'window' ? 'window' : 'door');
    }
    return map;
  }

  function buildWalls(level) {
    const lv = lot.levels[level], g = levelGroups[level];
    const old = L.walls[level]; if (old) { g.remove(old.mesh); old.mesh.dispose(); }
    const open = openingsFor(level), segs = [];
    const add = (dir, x, y, t) => {
      const key = edgeKey(level, dir, x, y), op = open.get(key), c = wallColor(t);
      const ranges = op === 'door' ? [[DOOR_TOP, WALL_H]] : op === 'window' ? [[0, WIN_BOTTOM], [WIN_TOP, WALL_H]] : [[0, WALL_H]];
      for (const [y0, y1] of ranges) segs.push({ dir, x, y, y0, y1, key, c, level });
    };
    for (let y = 0; y <= H; y++) for (let x = 0; x < W; x++) { const t = lv.wallH[y * W + x] | 0; if (t) add('h', x, y, t); }
    for (let y = 0; y < H; y++) for (let x = 0; x <= W; x++) { const t = lv.wallV[y * (W + 1) + x] | 0; if (t) add('v', x, y, t); }
    const mesh = new THREE.InstancedMesh(unit, wallMat, Math.max(1, segs.length));
    mesh.count = segs.length; mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'walls' + level;
    segs.forEach((s, i) => mesh.setColorAt(i, s.c));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.userData.segs = segs;
    g.add(mesh);
    L.walls[level] = { mesh, segs };
    L.indoor[level] = computeIndoor(lv);
    applyWallHeights(level);
  }

  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  function applyWallHeights(level) {
    const wl = L.walls[level]; if (!wl) return;
    const base = level * LEVEL_H, len = 1 + WALL_T;
    wl.segs.forEach((s, i) => {
      let top = s.y1;
      if (L.lowered.has(s.key)) top = Math.min(top, L.mode === 'down' ? LOW_DOWN : LOW_CUT);
      const h = Math.max(0, top - s.y0);
      if (h <= 0.001) { _m.makeScale(0, 0, 0); wl.mesh.setMatrixAt(i, _m); return; }
      if (s.dir === 'h') { _p.set(s.x + 0.5, base + s.y0, s.y); _s.set(len, h, WALL_T); }
      else { _p.set(s.x, base + s.y0, s.y + 0.5); _s.set(WALL_T, h, len); }
      _m.compose(_p, _q, _s); wl.mesh.setMatrixAt(i, _m);
    });
    wl.mesh.instanceMatrix.needsUpdate = true;
    wl.mesh.computeBoundingSphere(); wl.mesh.computeBoundingBox?.();
  }

  // Какие рёбра опускать. cutaway: стена смотрит наружной стороной на камеру, за ней — «внутри»,
  // и её прямой пролёт (run) хоть одним ребром ближе к камере, чем фокус + запас — целым пролётом,
  // чтобы не было «зубцов» посреди стены. down: все.
  const MARGIN = 12; // ≈ «весь дом»: как TS1, но дальние постройки на большом участке не режем
  L.updateCutaway = (rig) => {
    L.lowered.clear();
    if (L.mode === 'up') { lot.levels.forEach((_, l) => applyWallHeights(l)); return; }
    const f = rig.forward(), fx = f.x, fz = f.z, tx = rig.goal.x, tz = rig.goal.z;
    lot.levels.forEach((lv, level) => {
      const wl = L.walls[level]; if (!wl) return;
      if (L.mode === 'down') { for (const s of wl.segs) L.lowered.add(s.key); return; }
      const ind = L.indoor[level], inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && ind[y * W + x] === 1;
      const info = (dir, x, y) => {
        if (dir === 'h') return { far: Math.abs(fz) > 0.05 && (fz > 0 ? inside(x, y) : inside(x, y - 1)), ahead: (x + 0.5 - tx) * fx + (y - tz) * fz };
        return { far: Math.abs(fx) > 0.05 && (fx > 0 ? inside(x, y) : inside(x - 1, y)), ahead: (x - tx) * fx + (y + 0.5 - tz) * fz };
      };
      // пролёты: h — по x при фиксированном y; v — по y при фиксированном x
      const runs = (dir, outer, inner, has) => {
        for (let o = 0; o <= outer; o++) {
          let run = [];
          const flush = () => {
            if (run.length && Math.min(...run.map(e => e.ahead)) < MARGIN) for (const e of run) if (e.far) L.lowered.add(e.key);
            run = [];
          };
          for (let i = 0; i <= inner; i++) {
            const [x, y] = dir === 'h' ? [i, o] : [o, i];
            if (i < inner && has(x, y)) run.push({ ...info(dir, x, y), key: edgeKey(level, dir, x, y) }); else flush();
          }
        }
      };
      runs('h', H, W, (x, y) => edgeWall(lot, lv, 'h', x, y) > 0);
      runs('v', W, H, (x, y) => edgeWall(lot, lv, 'v', x, y) > 0);
    });
    lot.levels.forEach((_, l) => applyWallHeights(l));
  };

  L.setMode = (m) => { L.mode = m; };
  L.setLevel = (lvl) => { L.level = lvl; levelGroups.forEach((g, i) => { g.visible = i <= lvl; }); grid.position.y = lvl * LEVEL_H + 0.035; };
  L.rebuild = (level) => {
    const ls = level == null ? lot.levels.map((_, i) => i) : [level];
    for (const l of ls) { buildFloors(l); buildWalls(l); }
  };
  L.edgeOfInstance = (mesh, id) => { const s = mesh.userData.segs?.[id]; return s ? { dir: s.dir, x: s.x, y: s.y, level: s.level } : null; };
  L.isLowered = (level, e) => L.lowered.has(edgeKey(level, e.dir, e.x, e.y));
  L.wallMeshes = () => L.walls.filter((w, i) => w && i <= L.level).map(w => w.mesh);
  // дешёвый хэш стен/полов — страховка, если кто-то забыл послать lot:changed
  L.hash = (level) => {
    const lv = lot.levels[level]; let h = 0;
    for (const arr of [lv.floor, lv.wallH, lv.wallV]) for (let i = 0; i < arr.length; i++) h = (Math.imul(h, 31) + (arr[i] | 0) + i * (arr[i] ? 7 : 0)) | 0;
    return h;
  };
  L.clampLevel = (l) => clamp(l | 0, 0, lot.levels.length - 1);

  L.rebuild();
  L.setLevel(0);
  return L;
}
