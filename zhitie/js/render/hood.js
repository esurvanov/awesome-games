// Волна 3: вид района сверху. state.hood.lots → участки (газон/мостовая), дома (упрощённые слитые меши:
// из snapshot участка, иначе процедурный коттедж по сиду), общественные здания по type, улицы, фонари,
// деревья (InstancedMesh), подписи-значки. Пикинг → {kind:'lot', lotId}.
import * as THREE from 'three';
import { Bld, G, ctex, mulberry, PI } from './util.js';
import { grassTexture, pavedTexture } from './lot.js';
import { MAT } from './props.js';
import { WALLS } from '../../data/catalog.js';

const ICON = { park: '🌳', cafe: '☕', shop: '🛒', gym: '🏋️', library: '📚', museum: '🏛️', res: '🏠' };
const HOUSE_COLS = ['#efe9dc', '#c9d8c0', '#b5654a', '#d8c8a8', '#a8c0d8', '#e8d0a0', '#c8a8a0'];
const ROOF_COLS = ['#8a4b3a', '#5a5f6a', '#3f5a3a', '#7a3a2a', '#4a4a52'];

// подпись-спрайт: значок + имя
function label(text, icon) {
  const t = ctex(512, 128, (x, w, h) => {
    x.fillStyle = 'rgba(20,32,56,.78)'; x.beginPath(); x.roundRect(4, 20, w - 8, h - 40, 40); x.fill();
    x.font = '56px system-ui, sans-serif'; x.textBaseline = 'middle'; x.fillStyle = '#fff';
    x.fillText(icon, 28, h / 2 + 2);
    x.font = 'bold 44px system-ui, sans-serif'; x.fillText(text.length > 16 ? text.slice(0, 15) + '…' : text, 108, h / 2 + 2);
  }, false);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.renderOrder = 10; s.raycast = () => {};
  return s;
}

// Дом из снимка участка: стены (боксы по рёбрам) + двускатная крыша над габаритом стен
function houseFromSnapshot(b, snap, ox, oz) {
  const lot = snap.lot, W = lot.w; let minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9, top = 0;
  lot.levels.forEach((lv, L) => {
    const y = L * 3;
    const col = (t) => (WALLS.find(w => w.id === t) || WALLS[0]).color;
    for (let j = 0; j <= lot.h; j++) for (let i = 0; i < W; i++) { const t = lv.wallH[j * W + i]; if (t) { b.add(G.box(1.15, 3, 0.2), col(t), ox + i + 0.5, y + 1.5, oz + j); minX = Math.min(minX, i); maxX = Math.max(maxX, i + 1); minZ = Math.min(minZ, j); maxZ = Math.max(maxZ, j); top = Math.max(top, L); } }
    for (let j = 0; j < lot.h; j++) for (let i = 0; i <= W; i++) { const t = lv.wallV[j * (W + 1) + i]; if (t) { b.add(G.box(0.2, 3, 1.15), col(t), ox + i, y + 1.5, oz + j + 0.5); minX = Math.min(minX, i); maxX = Math.max(maxX, i); minZ = Math.min(minZ, j); maxZ = Math.max(maxZ, j + 1); top = Math.max(top, L); } }
  });
  if (minX > maxX) return false;
  gable(b, ox + minX, oz + minZ, maxX - minX, maxZ - minZ, (top + 1) * 3, snap.lot.roof?.color || '#8a4b3a');
  return true;
}
// двускатная крыша призмой (конёк вдоль длинной стороны)
function gable(b, x, z, w, d, y0, color) {
  const alongX = w >= d, L = (alongX ? w : d) + 0.6, S = (alongX ? d : w) + 0.6, rise = S * 0.28;
  // два наклонных ската
  const half = S / 2, ang = Math.atan2(rise, half), len = Math.hypot(half, rise);
  for (const sg of [-1, 1]) {
    if (alongX) b.add(G.box(L, 0.14, len), color, x + w / 2, y0 + rise / 2, z + d / 2 + sg * half / 2, sg * ang);
    else b.add(G.box(len, 0.14, L), color, x + w / 2 + sg * half / 2, y0 + rise / 2, z + d / 2, 0, 0, -sg * ang);
  }
  // фронтоны
  for (const sg of [-1, 1]) {
    const p = alongX
      ? [x + w / 2 + sg * (w / 2), y0, z, x + w / 2 + sg * (w / 2), y0, z + d, x + w / 2 + sg * (w / 2), y0 + rise * (d / S), z + d / 2]
      : [x, y0, z + d / 2 + sg * (d / 2), x + w, y0, z + d / 2 + sg * (d / 2), x + w / 2, y0 + rise * (w / S), z + d / 2 + sg * (d / 2)];
    const t = new THREE.BufferGeometry(); t.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); t.computeVertexNormals();
    b.add(t, '#e9e2d2');
  }
}

// Процедурный дом по сиду (участок без снимка)
function cottage(b, lot, rnd, glass) {
  const cx = lot.x + lot.w / 2, cz = lot.y + lot.h * 0.45;
  const w = Math.min(lot.w - 8, 8 + ((rnd() * 6) | 0)), d = Math.min(lot.h - 10, 7 + ((rnd() * 4) | 0)), floors = rnd() < 0.35 ? 2 : 1;
  const col = HOUSE_COLS[(rnd() * HOUSE_COLS.length) | 0], x = cx - w / 2, z = cz - d / 2, H = floors * 3;
  b.add(G.box(w, H, d), col, cx, H / 2, cz);
  b.add(G.box(w + 0.2, 0.25, d + 0.2), '#b8b2a6', cx, 0.12, cz);
  gable(b, x, z, w, d, H, ROOF_COLS[(rnd() * ROOF_COLS.length) | 0]);
  b.add(G.box(1, 2.1, 0.1), '#7a4a2a', cx + (rnd() - 0.5) * (w - 3), 1.05, z + d + 0.05);
  for (let f = 0; f < floors; f++) for (let i = 0; i < Math.floor(w / 2.5); i++) glass.push([x + 1.2 + i * 2.5, f * 3 + 1.6, z + d + 0.06, 0]);
  // дорожка к улице
  b.add(G.box(1.4, 0.03, lot.y + lot.h - (z + d)), '#c9c6bd', cx, 0.03, (z + d + lot.y + lot.h) / 2);
}

// Общественные здания по типу
function community(b, lot, rnd, glass, trees) {
  const cx = lot.x + lot.w / 2, cz = lot.y + lot.h * 0.45, type = lot.type || 'park';
  if (type === 'park') {
    b.add(G.cyl(3.2, 3.4, 0.5, 24), '#c8c2b6', cx, 0.25, cz); b.add(G.cyl(2.9, 2.9, 0.05, 24), '#5fb3d6', cx, 0.48, cz); b.add(G.cyl(0.3, 0.4, 1.8, 10), '#b8b2a6', cx, 0.9, cz);
    b.add(G.box(2, 0.03, lot.h * 0.55), '#d8cdb0', cx, 0.03, lot.y + lot.h * 0.72);
    b.add(G.box(lot.w * 0.7, 0.03, 2), '#d8cdb0', cx, 0.03, cz);
    for (let i = 0; i < 16; i++) trees.push([lot.x + 2 + rnd() * (lot.w - 4), lot.y + 2 + rnd() * (lot.h * 0.7), 0.8 + rnd() * 0.6]);
    for (const s of [-1, 1]) b.add(G.box(2, 0.5, 0.6), '#8a5a32', cx + s * 5, 0.25, cz + 3);
    return;
  }
  const spec = { cafe: [12, 9, 4, '#e8d8b8'], shop: [16, 12, 5, '#dfe2e4'], gym: [16, 12, 6, '#c8d0d8'], library: [16, 12, 7, '#e8e2d2'], museum: [18, 12, 8, '#efe9dc'] }[type] || [14, 10, 5, '#ddd'];
  const [w, d, H, col] = spec, x = cx - w / 2, z = cz - d / 2;
  b.add(G.box(w, H, d), col, cx, H / 2, cz);
  b.add(G.box(w + 0.4, 0.4, d + 0.4), '#8a8f96', cx, H + 0.2, cz);
  for (let i = 0; i < Math.floor(w / 2); i++) glass.push([x + 1 + i * 2, H * 0.45, z + d + 0.06, 1]);
  if (type === 'cafe') { for (let i = 0; i < 8; i++) b.add(G.box(w / 8, 0.08, 2.2), i % 2 ? '#f4f1ea' : '#d8342c', x + (i + 0.5) * w / 8, H * 0.55, z + d + 1, 0.3); for (let i = 0; i < 3; i++) { b.add(G.cyl(0.4, 0.4, 0.05, 12), '#f4f1ea', x + 2 + i * 4, 0.75, z + d + 3); b.add(G.cyl(0.05, 0.05, 0.75, 6), '#333', x + 2 + i * 4, 0.37, z + d + 3); } }
  if (type === 'library' || type === 'museum') { for (let i = 0; i < 6; i++) b.add(G.cyl(0.3, 0.3, H - 0.5, 10), '#f4f1ea', x + 1.5 + i * (w - 3) / 5, (H - 0.5) / 2, z + d + 1.2); b.add(G.box(w, 0.5, 2.6), '#e8e2d2', cx, H - 0.25, z + d + 1.2); }
  if (type === 'gym') b.add(G.box(3, 0.4, 0.4), '#222', cx, H + 1.2, z + d / 2);
  if (type === 'shop') b.add(G.box(w * 0.6, 1.2, 0.2), '#d8342c', cx, H + 0.9, z + d);
  b.add(G.box(w * 0.8, 0.03, lot.y + lot.h - (z + d)), '#c9c6bd', cx, 0.03, (z + d + lot.y + lot.h) / 2);
  for (let i = 0; i < 6; i++) trees.push([lot.x + 1.5 + rnd() * (lot.w - 3), lot.y + 1.5 + rnd() * 3, 0.7 + rnd() * 0.4]);
}

export function createHood(scene, env) {
  const root = new THREE.Group(); root.name = 'hood'; root.visible = false; scene.add(root);
  const mainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true, side: THREE.DoubleSide });
  const H = { root, bounds: [0, 0, 100, 100], picks: [], active: null, key: '', bump: 0 };
  H.invalidate = () => { H.bump++; };

  H.build = (state) => {
    const hood = state.hood; if (!hood?.lots?.length) return false;
    const key = JSON.stringify(hood.lots.map(l => [l.id, l.x, l.y, l.w, l.h, l.familyId, !!l.snapshot])) + hood.activeLotId + H.bump;
    if (key === H.key) return true; H.key = key;
    while (root.children.length) root.remove(root.children[0]);
    H.picks = [];
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (const l of hood.lots) { x0 = Math.min(x0, l.x); z0 = Math.min(z0, l.y); x1 = Math.max(x1, l.x + l.w); z1 = Math.max(z1, l.y + l.h); }
    const pad = 14, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, ext = Math.max(x1 - x0, z1 - z0) + pad * 2;
    H.bounds = [x0 - pad, z0 - pad, x1 + pad, z1 + pad]; H.center = [cx, cz]; H.ext = ext;

    const gt = grassTexture(); gt.repeat.set(ext * 2 / 4, ext * 2 / 4);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(ext * 2, ext * 2), new THREE.MeshStandardMaterial({ map: gt, roughness: 1 }));
    ground.rotation.x = -PI / 2; ground.position.set(cx, -0.01, cz); ground.receiveShadow = true; root.add(ground);

    // улицы: вдоль «передней» стороны каждого ряда участков (y+h) и две поперечные по краям
    const rt = pavedTexture('road'); rt.repeat.set(ext / 2, 3);
    const roadMat = new THREE.MeshStandardMaterial({ map: rt, roughness: 0.9 }), walkMat = new THREE.MeshStandardMaterial({ color: '#c9c6bd', roughness: 0.95 });
    const road = (x, z, w, d) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), roadMat); m.rotation.x = -PI / 2; m.position.set(x, 0.01, z); m.receiveShadow = true; root.add(m); };
    const walk = (x, z, w, d) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), walkMat); m.rotation.x = -PI / 2; m.position.set(x, 0.015, z); m.receiveShadow = true; root.add(m); };
    if (hood.map?.streets?.length) {
      // улицы от Мира: прямоугольники {x,y,w,h} (ряды фасадом к +y и проспект)
      for (const st of hood.map.streets) { road(st.x + st.w / 2, st.y + st.h / 2, st.w, st.h); if (st.w > st.h) walk(st.x + st.w / 2, st.y - 0.8, st.w, 1.6); }
    } else {
      const rows = [...new Set(hood.lots.map(l => l.y + l.h))];
      for (const r of rows) { road(cx, r + 4.8, x1 - x0 + 20, 6.5); walk(cx, r + 0.8, x1 - x0 + 20, 1.6); }
      for (const x of [x0 - 6, x1 + 6]) road(x, cz, 6.5, z1 - z0 + 16);
    }

    const b = new Bld(), glass = [], trees = [], lights = [];
    const rnd0 = mulberry(hood.name ? [...hood.name].reduce((a, c) => a + c.charCodeAt(0), 0) : 7);
    for (const l of hood.lots) {
      const rnd = mulberry((l.id | 0) * 7919 + 13);
      const community_ = l.kind === 'community';
      // участок: плоскость для пикинга + бордюр
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(l.w, l.h), new THREE.MeshStandardMaterial({ color: community_ ? '#9dbb6a' : '#86ad52', roughness: 1, transparent: true, opacity: 0.35, depthWrite: false }));
      plane.rotation.x = -PI / 2; plane.position.set(l.x + l.w / 2, 0.02, l.y + l.h / 2); plane.userData.lotId = l.id; root.add(plane); H.picks.push(plane);
      const border = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[0, 0], [l.w, 0], [l.w, l.h], [0, l.h]].map(([a, c]) => new THREE.Vector3(l.x + a, 0.05, l.y + c))), new THREE.LineBasicMaterial({ color: l.id === hood.activeLotId ? 0x7dff5a : 0xffffff, transparent: true, opacity: l.id === hood.activeLotId ? 1 : 0.35 }));
      root.add(border);
      if (community_) community(b, l, rnd, glass, trees);
      else if (!((l.id === hood.activeLotId ? { lot: state.lot } : l.snapshot)?.lot && houseFromSnapshot(b, l.id === hood.activeLotId ? { lot: state.lot } : l.snapshot, l.x, l.y))) { if (l.familyId != null || rnd() < 0.85) cottage(b, l, rnd, glass); }
      for (let i = 0; i < 3; i++) trees.push([l.x + (i === 0 ? 1.5 : l.w - 1.5), l.y + 2 + rnd() * (l.h - 6), 0.8 + rnd() * 0.5]);
      lights.push([l.x + 1, l.y + l.h + 1.4], [l.x + l.w - 1, l.y + l.h + 1.4]);
      // подпись
      const fam = l.familyId != null && state.hood.families?.find(f => f.id === l.familyId);
      const s = label(fam ? fam.name : l.name || `Участок ${l.id}`, ICON[l.kind === 'community' ? l.type : 'res'] || '🏠');
      const sc = Math.max(10, ext * 0.11); s.scale.set(sc, sc / 4, 1); s.position.set(l.x + l.w / 2, 11, l.y + l.h / 2); root.add(s);
    }
    for (let i = 0; i < 30; i++) trees.push([x0 - 12 + rnd0() * (x1 - x0 + 24), z0 - 12 + rnd0() * 8, 1 + rnd0() * 0.6]);
    const geo = b.geo();
    if (geo) { const m = new THREE.Mesh(geo, mainMat); m.castShadow = true; m.receiveShadow = true; m.raycast = () => {}; root.add(m); }

    // окна: один InstancedMesh со «ночным» стеклом
    const winGeo = new THREE.PlaneGeometry(1, 1.1), win = new THREE.InstancedMesh(winGeo, MAT.glass, Math.max(1, glass.length)), m4 = new THREE.Matrix4();
    glass.forEach(([x, y, z, big], i) => win.setMatrixAt(i, m4.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(big ? 1.4 : 1, big ? 1.6 : 1, 1))));
    win.count = glass.length; win.raycast = () => {}; root.add(win);
    // деревья: крона и ствол — два InstancedMesh
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.2, 2, 6).translate(0, 1, 0), new THREE.MeshStandardMaterial({ color: '#6b4a2e', flatShading: true }), trees.length);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.4, 0).translate(0, 2.8, 0), new THREE.MeshStandardMaterial({ color: '#4f7f36', flatShading: true, roughness: 0.9 }), trees.length);
    trees.forEach(([x, z, s], i) => { m4.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i), new THREE.Vector3(s, s, s)); trunk.setMatrixAt(i, m4); crown.setMatrixAt(i, m4); crown.setColorAt(i, new THREE.Color().setHSL(0.26 + (i % 5) * 0.012, 0.42, 0.3 + (i % 3) * 0.04)); });
    [trunk, crown].forEach(m => { m.castShadow = true; m.receiveShadow = true; m.raycast = () => {}; root.add(m); });
    // фонари вдоль улиц: столб + светящийся фонарь (ночью — через env.nightMats)
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.08, 4, 6).translate(0, 2, 0), new THREE.MeshStandardMaterial({ color: '#2a2d30' }), lights.length);
    const lamp = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 8, 6).translate(0, 4.1, 0), MAT.glow, lights.length);
    lights.forEach(([x, z], i) => { m4.makeTranslation(x, 0, z); pole.setMatrixAt(i, m4); lamp.setMatrixAt(i, m4); });
    [pole, lamp].forEach(m => { m.raycast = () => {}; root.add(m); });
    return true;
  };

  H.pick = (ray) => {
    const h = ray.intersectObjects(H.picks, false)[0];
    return h ? { kind: 'lot', lotId: h.object.userData.lotId, x: h.point.x, y: h.point.z, wx: h.point.x, wz: h.point.z } : null;
  };
  return H;
}
