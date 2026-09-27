// Реквизит НПС: node build-props.mjs <outDir> <character.glb>
// Процедурные модели (метры) + точки крепления к костям, посчитанные по bind-позе персонажа UAL.
// Ручные (hand_r): origin = центр ладони; +Y — вдоль предплечья к локтю (опущенная рука → черенок вертикален).
// Носимые перед собой (pizza_box, plate, book): +Y — вдоль оси «указательный→мизинец» (в Walk_Carry_Loop ладони смотрят друг на друга, большие пальцы вверх), центр смещён от ладони внутрь.
// Головные (Head): origin = низ шапки/каски, +Y — вверх, козырёк в +Z (лицо).
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup } from '@gltf-transform/functions';
import { mat4, quat, vec3 } from 'gl-matrix';
import fs from 'fs';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const [,, OUT = 'props', CHAR] = process.argv; fs.mkdirSync(OUT, { recursive: true });

// ---------- геометрия ----------
const G = () => ({ pos: [], nor: [], idx: [] });
function box(g, cx, cy, cz, w, h, d) {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  for (const [n, vs] of [[[1,0,0],[[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1]]],[[-1,0,0],[[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]]],[[0,1,0],[[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0]]],[[0,-1,0],[[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]]],[[0,0,1],[[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]]],[[0,0,-1],[[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0]]]]) {
    const b = g.pos.length / 3; for (const v of vs) { g.pos.push(...v); g.nor.push(...n); } g.idx.push(b, b+1, b+2, b, b+2, b+3); }
}
function cyl(g, cx, cy, cz, r0, r1, h, n = 12, axis = 'y') { // центр основания (cx,cy,cz), вдоль оси
  const P = (a, b, c) => axis === 'y' ? [a, b, c] : axis === 'x' ? [b, a, c] : [a, c, b];
  const b = g.pos.length / 3;
  for (let i = 0; i <= n; i++) { const t = i / n * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    const p0 = P(c * r0, 0, s * r0), p1 = P(c * r1, h, s * r1), nn = P(c, (r0 - r1) / h, s);
    g.pos.push(cx + p0[0], cy + p0[1], cz + p0[2], cx + p1[0], cy + p1[1], cz + p1[2]); const l = Math.hypot(...nn); g.nor.push(...nn.map(v => v / l), ...nn.map(v => v / l)); }
  for (let i = 0; i < n; i++) { const a = b + i * 2; g.idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  for (const [yy, r, sg] of [[0, r0, -1], [h, r1, 1]]) { const c0 = g.pos.length / 3; const pc = P(0, yy, 0); g.pos.push(cx + pc[0], cy + pc[1], cz + pc[2]); g.nor.push(...P(0, sg, 0));
    for (let i = 0; i <= n; i++) { const t = i / n * Math.PI * 2; const p = P(Math.cos(t) * r, yy, Math.sin(t) * r); g.pos.push(cx + p[0], cy + p[1], cz + p[2]); g.nor.push(...P(0, sg, 0)); }
    for (let i = 0; i < n; i++) sg > 0 ? g.idx.push(c0, c0 + 2 + i, c0 + 1 + i) : g.idx.push(c0, c0 + 1 + i, c0 + 2 + i); }
}
function dome(g, cx, cy, cz, rx, ry, rz, n = 14, m = 6, full = false) { // полусфера (или сфера) над cy
  const b = g.pos.length / 3; const M = full ? m * 2 : m;
  for (let i = 0; i <= M; i++) { const th = (i / m) * Math.PI / 2; for (let j = 0; j <= n; j++) { const ph = j / n * Math.PI * 2;
    const x = Math.cos(th) * Math.cos(ph), y = Math.sin(th), z = Math.cos(th) * Math.sin(ph);
    const yy = full ? Math.cos((i / M) * Math.PI) : y, rr = full ? Math.sin((i / M) * Math.PI) : Math.cos(th);
    const X = rr * Math.cos(ph), Z = rr * Math.sin(ph);
    g.pos.push(cx + X * rx, cy + yy * ry, cz + Z * rz); const l = Math.hypot(X / rx, yy / ry, Z / rz); g.nor.push(X / rx / l, yy / ry / l, Z / rz / l); } }
  for (let i = 0; i < M; i++) for (let j = 0; j < n; j++) { const a = b + i * (n + 1) + j, c = a + n + 1; full ? g.idx.push(a, c, a + 1, a + 1, c, c + 1) : g.idx.push(a, a + 1, c, a + 1, c + 1, c); }
}
function write(name, parts) {
  const doc = new Document(); const buf = doc.createBuffer(); const mesh = doc.createMesh(name);
  const mats = {};
  for (const [g, col, opt = {}] of parts) {
    const key = col + JSON.stringify(opt);
    const m = mats[key] ||= doc.createMaterial(opt.name || 'prop').setBaseColorFactor([...hex(col), 1]).setRoughnessFactor(opt.rough ?? 0.7).setMetallicFactor(opt.metal ?? 0).setDoubleSided(!!opt.ds);
    const acc = (t, a) => doc.createAccessor().setType(t).setArray(a).setBuffer(buf);
    mesh.addPrimitive(doc.createPrimitive().setMaterial(m).setAttribute('POSITION', acc('VEC3', new Float32Array(g.pos))).setAttribute('NORMAL', acc('VEC3', new Float32Array(g.nor))).setIndices(acc('SCALAR', new Uint16Array(g.idx))));
  }
  doc.createScene(name).addChild(doc.createNode(name).setMesh(mesh));
  return doc.transform(dedup(), prune()).then(() => io.write(`${OUT}/${name}.glb`, doc));
}
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); };

// ---------- модели ----------
const P = {};
P.scythe = () => { const pole = G(), blade = G(), grip = G();
  cyl(pole, 0, -0.55, 0, 0.018, 0.016, 1.65, 8);
  cyl(grip, 0, 0.35, 0, 0.012, 0.012, 0.16, 6, 'z'); grip.pos = grip.pos.map((v, i) => i % 3 === 2 ? v - 0.02 : v);
  // лезвие: дуга из отрезков в плоскости XZ у верхнего конца, к +Z
  for (let k = 0; k < 8; k++) { const a0 = k / 8, w = 0.06 * (1 - a0) + 0.012; box(blade, 0, 1.08 - a0 * a0 * 0.12, 0.05 + a0 * 0.62, 0.008, w, 0.09); }
  return [[pole, '#6b4a2b'], [grip, '#6b4a2b'], [blade, '#b8bec6', { metal: 0.6, rough: 0.35 }]]; };
P.mop = () => { const pole = G(), head = G(), str = G();
  cyl(pole, 0, -0.72, 0, 0.014, 0.014, 1.2, 8); box(head, 0, -0.74, 0, 0.1, 0.04, 0.05);
  for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; cyl(str, Math.cos(a) * 0.035, -0.92, Math.sin(a) * 0.02, 0.012, 0.01, 0.18, 5); }
  return [[pole, '#3d7fc1'], [head, '#2b2b2b'], [str, '#e6e0cf', { rough: 1 }]]; };
P.wrench = () => { const h = G(), j = G(); box(h, 0, -0.08, 0, 0.022, 0.26, 0.012); box(j, 0, -0.23, 0, 0.06, 0.05, 0.014); box(j, 0.018, -0.27, 0, 0.02, 0.05, 0.014); box(j, -0.018, -0.27, 0, 0.02, 0.05, 0.014);
  return [[h, '#9aa3ad', { metal: 0.7, rough: 0.35 }], [j, '#9aa3ad', { metal: 0.7, rough: 0.35 }]]; };
P.extinguisher = () => { const body = G(), top = G(), hose = G(), hnd = G();
  cyl(body, 0, -0.52, 0, 0.075, 0.075, 0.44, 14); dome(body, 0, -0.08, 0, 0.075, 0.04, 0.075, 14, 4);
  cyl(top, 0, -0.06, 0, 0.02, 0.02, 0.05, 8); box(hnd, 0, 0.0, 0, 0.02, 0.02, 0.12);
  cyl(hose, 0, -0.03, 0.02, 0.01, 0.008, 0.18, 6, 'z');
  return [[body, '#c42a22', { rough: 0.35 }], [top, '#2b2b2b'], [hnd, '#2b2b2b'], [hose, '#1d1d1d']]; };
P.trash_bag = () => { const bag = G(), knot = G(); dome(bag, 0, -0.33, 0, 0.19, 0.24, 0.16, 12, 5, true); cyl(knot, 0, -0.1, 0, 0.03, 0.012, 0.1, 6);
  return [[bag, '#1f2226', { rough: 0.4 }], [knot, '#1f2226', { rough: 0.4 }]]; };
P.pizza_box = () => { const b = G(), logo = G(); box(b, 0, 0.025, 0, 0.36, 0.05, 0.36); box(logo, 0, 0.0505 + 0.0005, 0, 0.16, 0.001, 0.16);
  return [[b, '#d8b98a'], [logo, '#c0392b']]; };
P.plate = () => { const p = G(), food = G(); cyl(p, 0, 0, 0, 0.11, 0.13, 0.02, 18); cyl(food, 0.02, 0.02, -0.01, 0.05, 0.03, 0.012, 8); cyl(food, -0.04, 0.02, 0.03, 0.025, 0.02, 0.01, 6);
  return [[p, '#f2f0ea', { rough: 0.3 }], [food, '#7a5230']]; };
P.helmet = () => { const s = G(), brim = G(), badge = G(); dome(s, 0, 0.0, 0, 0.125, 0.13, 0.14, 16, 6); cyl(brim, 0, -0.005, -0.02, 0.15, 0.17, 0.012, 16); box(badge, 0, 0.07, 0.125, 0.06, 0.07, 0.015);
  return [[s, '#c42a22', { rough: 0.3 }], [brim, '#b02520', { rough: 0.3 }], [badge, '#e8c547', { metal: 0.5 }]]; };
P.cap = () => { const s = G(), v = G(), btn = G(); dome(s, 0, 0.0, 0, 0.11, 0.09, 0.12, 16, 5); box(v, 0, 0.004, 0.15, 0.17, 0.008, 0.1); cyl(btn, 0, 0.088, 0, 0.012, 0.01, 0.01, 6);
  return [[s, '#2c5aa0'], [v, '#1f3f73'], [btn, '#1f3f73']]; };
P.book = () => { const c = G(), pg = G(); box(c, 0, 0, 0, 0.16, 0.03, 0.22); box(pg, 0.004, 0, 0, 0.152, 0.024, 0.212);
  return [[c, '#7a2e2e'], [pg, '#f1ead8']]; };

// ---------- крепления по bind-позе персонажа ----------
const cd = await io.read(CHAR); const skin = cd.getRoot().listSkins()[0]; const J = skin.listJoints().map(j => j.getName());
const IBM = skin.getInverseBindMatrices().getArray();
const Wm = (nm) => { const i = J.indexOf(nm); return mat4.invert(mat4.create(), IBM.slice(i * 16, i * 16 + 16)); };
const jp = (nm) => mat4.getTranslation(vec3.create(), Wm(nm));
const jr = (nm) => mat4.getRotation(quat.create(), Wm(nm));
function attach(bone, worldPos, worldRot) { // → локально к кости
  const inv = mat4.invert(mat4.create(), Wm(bone)); const p = vec3.transformMat4(vec3.create(), worldPos, inv);
  const q = quat.multiply(quat.create(), quat.invert(quat.create(), jr(bone)), worldRot);
  return { bone, position: [...p].map(v => +v.toFixed(4)), quaternion: [...quat.normalize(q, q)].map(v => +v.toFixed(4)) };
}
const rotTo = (a, b) => quat.rotationTo(quat.create(), vec3.normalize(vec3.create(), a), vec3.normalize(vec3.create(), b));
const hand = jp('hand_r'), mid = jp('middle_01_r'), idx = jp('index_01_r'), pky = jp('pinky_01_r'), th = jp('thumb_02_r');
const palm = vec3.lerp(vec3.create(), hand, mid, 0.6);
const up = vec3.sub(vec3.create(), hand, mid); // к локтю
const across = vec3.sub(vec3.create(), idx, pky);
let pn = vec3.cross(vec3.create(), up, across); vec3.normalize(pn, pn);
const tdir = vec3.sub(vec3.create(), th, palm); if (vec3.dot(pn, tdir) < 0) vec3.negate(pn, pn); // нормаль в сторону ладони (где большой палец)
// ручной хват: +Y вдоль предплечья, +Z — в сторону большого пальца
const gripRot = (() => { const q1 = rotTo([0, 1, 0], up); const z1 = vec3.transformQuat(vec3.create(), [0, 0, 1], q1); const zt = vec3.sub(vec3.create(), across, vec3.scale(vec3.create(), vec3.normalize(vec3.create(), up), vec3.dot(across, vec3.normalize(vec3.create(), up)))); const q2 = rotTo(z1, zt); return quat.multiply(quat.create(), q2, q1); })();
const gripPos = vec3.scaleAndAdd(vec3.create(), palm, pn, 0.025);
const carryRot = rotTo([0, 1, 0], across); const carryAt = (off) => vec3.scaleAndAdd(vec3.create(), palm, pn, off);
// голова: верх черепа по вершинам с весом Head
const mp = cd.getRoot().listMeshes()[0].listPrimitives().find(p => p.getMaterial()?.getName() === 'skin');
const Pa = mp.getAttribute('POSITION'), Ja = mp.getAttribute('JOINTS_0'), Wa = mp.getAttribute('WEIGHTS_0'); const iH = J.indexOf('Head');
let top = -1, mnx = 9, mxx = -9, mnz = 9, mxz = -9; const a = [], j4 = [], w4 = [];
for (let i = 0; i < Pa.getCount(); i++) { Ja.getElement(i, j4); Wa.getElement(i, w4); let w = 0; for (let k = 0; k < 4; k++) if (j4[k] === iH) w += w4[k]; if (w < 0.6) continue; Pa.getElement(i, a); top = Math.max(top, a[1]); mnx = Math.min(mnx, a[0]); mxx = Math.max(mxx, a[0]); mnz = Math.min(mnz, a[2]); mxz = Math.max(mxz, a[2]); }
const headBase = [(mnx + mxx) / 2, top - 0.055, (mnz + mxz) / 2 - 0.005];
// носимое перед собой: ориентация по реальной позе Walk_Carry_Loop (t=0): предмет горизонтален, центр между ладонями
const ad = await io.read(process.argv[4] || '/Users/egurvanov/python/sims/assets/anims/ual_anims.glb'); const ar = ad.getRoot();
function poseW(clipName) {
  const an = ar.listAnimations().find(a => a.getName() === clipName); const L = new Map();
  for (const n of ar.listNodes()) L.set(n, { t: n.getTranslation(), r: n.getRotation(), s: n.getScale() });
  for (const c of an.listChannels()) { const o = c.getSampler().getOutput(); const v = o.getElement(0, []); const e = L.get(c.getTargetNode()); L.set(c.getTargetNode(), { ...e, [c.getTargetPath()[0]]: v }); }
  const W = new Map(); const get = (n) => { if (W.has(n)) return W.get(n); const e = L.get(n); const m = mat4.fromRotationTranslationScale(mat4.create(), e.r, e.t, e.s); const p = n.getParentNode(); const w = p ? mat4.multiply(mat4.create(), get(p), m) : m; W.set(n, w); return w; };
  return (nm) => get(ar.listNodes().find(n => n.getName() === nm));
}
const Wc = poseW('Walk_Carry_Loop');
const hr = Wc('hand_r'), hl = Wc('hand_l'), mr = Wc('middle_01_r'), ml = Wc('middle_01_l');
const pr = vec3.lerp(vec3.create(), mat4.getTranslation(vec3.create(), hr), mat4.getTranslation(vec3.create(), mr), 0.6);
const pl = vec3.lerp(vec3.create(), mat4.getTranslation(vec3.create(), hl), mat4.getTranslation(vec3.create(), ml), 0.6);
const cmid = vec3.lerp(vec3.create(), pr, pl, 0.5);
function carryAttach(dy) { // локально к hand_r в позе переноски
  const inv = mat4.invert(mat4.create(), hr); const p = vec3.transformMat4(vec3.create(), [cmid[0], cmid[1] + dy, cmid[2]], inv);
  const hq = mat4.getRotation(quat.create(), hr); const q = quat.invert(quat.create(), quat.normalize(hq, hq));
  return { bone: 'hand_r', position: [...p].map(v => +v.toFixed(4)), quaternion: [...quat.normalize(q, q)].map(v => +v.toFixed(4)) };
}
const ATT = {
  scythe: attach('hand_r', gripPos, gripRot), mop: attach('hand_r', gripPos, gripRot), wrench: attach('hand_r', gripPos, gripRot),
  extinguisher: attach('hand_r', gripPos, gripRot), trash_bag: attach('hand_r', gripPos, gripRot),
  pizza_box: carryAttach(-0.03), plate: carryAttach(-0.02), book: attach('hand_r', carryAt(0.09), carryRot),
  helmet: attach('Head', headBase, quat.create()), cap: attach('Head', [headBase[0], headBase[1] + 0.01, headBase[2]], quat.create()),
};
for (const [k, f] of Object.entries(P)) await write(k, f());
fs.writeFileSync(`${OUT}/_attach.json`, JSON.stringify(ATT, null, 1));
console.log(JSON.stringify({ headTop: top, headBase, palm: [...palm] }));
