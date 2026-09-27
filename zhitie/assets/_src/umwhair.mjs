// Причёски из Quaternius Ultimate Modular Women (CC0): вырезать примитивы материалов Hair_*, перевести в мировую bind-позу,
// вписать в габарит головы UBC и сохранить в локальных координатах кости Head (как остальные HAIR).
import { NodeIO, Document } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { prune, dedup, weld } from '@gltf-transform/functions';
import { mat4, vec3 } from 'gl-matrix'; import fs from 'fs';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const [,, OUT, BODY_F, ...SRC] = process.argv;
// голова UBC
async function ubcHead(file) { const d = await io.read(file); const skin = d.getRoot().listSkins()[0]; const J = skin.listJoints().map(j => j.getName()); const IBM = skin.getInverseBindMatrices().getArray(); const iH = J.indexOf('Head');
  const headW = mat4.invert(mat4.create(), IBM.slice(iH * 16, iH * 16 + 16)); const mn = [9, 9, 9], mx = [-9, -9, -9];
  for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) { if (p.getMaterial()?.getName() !== 'skin') continue; const P = p.getAttribute('POSITION'), Jn = p.getAttribute('JOINTS_0'), W = p.getAttribute('WEIGHTS_0'); const a = [], j = [], w = [];
    for (let i = 0; i < P.getCount(); i++) { Jn.getElement(i, j); W.getElement(i, w); let hw = 0; for (let k = 0; k < 4; k++) if (j[k] === iH) hw += w[k]; if (hw < 0.6) continue; P.getElement(i, a); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], a[k]); mx[k] = Math.max(mx[k], a[k]); } } }
  return { inv: mat4.invert(mat4.create(), headW), mn, mx }; }
const H = await ubcHead(BODY_F);
function worldMats(root) { const W = new Map(); const get = (n) => { if (W.has(n)) return W.get(n); const p = n.getParentNode(); const w = mat4.multiply(mat4.create(), p ? get(p) : mat4.create(), n.getMatrix()); W.set(n, w); return w; }; for (const n of root.listNodes()) get(n); return W; }
const meta = {};
for (const src of SRC) {
  const name = src.split('/').pop().replace('.gltf', ''); const d = await io.read(src); const R = d.getRoot(); const W = worldMats(R);
  const skinNode = R.listNodes().find(n => n.getSkin()); const skin = skinNode.getSkin(); const J = skin.listJoints(); const IBM = skin.getInverseBindMatrices().getArray();
  const headIdx = J.findIndex(j => /head/i.test(j.getName())); const bindM = mat4.multiply(mat4.create(), W.get(J[headIdx]), IBM.slice(headIdx * 16, headIdx * 16 + 16));
  const hairPts = [], hairTris = []; const headMn = [9, 9, 9], headMx = [-9, -9, -9]; let hairMat = null;
  for (const n of R.listNodes().filter(n => n.getMesh())) for (const p of n.getMesh().listPrimitives()) {
    const mn = p.getMaterial()?.getName() || ''; const P = p.getAttribute('POSITION'); const Jn = p.getAttribute('JOINTS_0'), Wt = p.getAttribute('WEIGHTS_0'); const a = [], j = [], w = [];
    if (mn === 'Skin') { for (let i = 0; i < P.getCount(); i++) { Jn.getElement(i, j); Wt.getElement(i, w); let hw = 0; for (let k = 0; k < 4; k++) if (j[k] === headIdx) hw += w[k]; if (hw < 0.6) continue; P.getElement(i, a); const v = vec3.transformMat4([], a, bindM); for (let k = 0; k < 3; k++) { headMn[k] = Math.min(headMn[k], v[k]); headMx[k] = Math.max(headMx[k], v[k]); } } }
    if (/^Hair/i.test(mn)) { hairMat = mn; const base = hairPts.length; for (let i = 0; i < P.getCount(); i++) { P.getElement(i, a); hairPts.push(vec3.transformMat4([], a, bindM)); } const idx = p.getIndices().getArray(); for (const x of idx) hairTris.push(base + x); }
  }
  if (!hairPts.length) { console.log(name, 'no hair'); continue; }
  // оси источника: вверх = Y? определить по размаху головы
  const ext = headMx.map((v, i) => v - headMn[i]); const up = 1;
  console.log(name, 'head ext', ext.map(v => v.toFixed(3)), 'up axis', up, 'hair verts', hairPts.length);
  // перевод в систему UBC: ось up → Y; фронт определить по тому, куда уходят волосы (назад)
  const c = headMn.map((v, i) => (v + headMx[i]) / 2); const axes = [0, 1, 2].filter(i => i !== up);
  const hc = hairPts.reduce((s, p) => s.map((x, i) => x + p[i] / hairPts.length), [0, 0, 0]);
  let fwdAxis = axes.reduce((a, b) => Math.abs(hc[a] - c[a]) / ext[a] > Math.abs(hc[b] - c[b]) / ext[b] ? a : b); let sideAxis = axes.find(i => i !== fwdAxis);
  let fwdSign = hc[fwdAxis] < c[fwdAxis] ? 1 : -1; if (process.env.FWD) { fwdAxis = +process.env.FWD.split(',')[0]; fwdSign = +process.env.FWD.split(',')[1]; sideAxis = axes.find(i => i !== fwdAxis); } console.log(name, 'fwd', fwdAxis, fwdSign, 'side', sideAxis);
  const upSign = 1;
  const tc = H.mn.map((v, i) => (v + H.mx[i]) / 2), te = H.mx.map((v, i) => (v - H.mn[i]) / 2);
  const sx = te[0] / (ext[sideAxis] / 2), sy = te[1] / (ext[up] / 2), sz = te[2] / (ext[fwdAxis] / 2);
  const map = (p) => [tc[0] + (p[sideAxis] - c[sideAxis]) * sx * 1.02, tc[1] + (p[up] - c[up]) * sy * upSign * 1.02, tc[2] + (p[fwdAxis] - c[fwdAxis]) * fwdSign * sz * 1.02];
  // зеркальность: если (side,up,fwd) даёт левую систему — отзеркалить x
  const det = (() => { const e = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; e[0][sideAxis] = 1; e[1][up] = upSign; e[2][fwdAxis] = fwdSign; return e[0][0] * (e[1][1] * e[2][2] - e[1][2] * e[2][1]) - e[0][1] * (e[1][0] * e[2][2] - e[1][2] * e[2][0]) + e[0][2] * (e[1][0] * e[2][1] - e[1][1] * e[2][0]); })();
  const pts = hairPts.map(p => { const q = map(p); if (det < 0) q[0] = 2 * tc[0] - q[0]; return vec3.transformMat4([], q, H.inv); });
  const tris = det < 0 ? hairTris.map((v, i, a) => i % 3 === 1 ? a[i + 1] : i % 3 === 2 ? a[i - 1] : v) : hairTris;
  // гладкие нормали по сваренным вершинам
  const key = new Map(), canon = pts.map((p, i) => { const k = p.map(v => Math.round(v * 2e4)).join(); if (!key.has(k)) key.set(k, i); return key.get(k); });
  const nrm = pts.map(() => [0, 0, 0]); for (let t = 0; t < tris.length; t += 3) { const [a, b, cc] = [tris[t], tris[t + 1], tris[t + 2]]; const n = vec3.cross([], vec3.sub([], pts[b], pts[a]), vec3.sub([], pts[cc], pts[a])); for (const v of [a, b, cc]) vec3.add(nrm[canon[v]], nrm[canon[v]], n); }
  const doc = new Document(); const buf = doc.createBuffer(); const acc = (t, arr) => doc.createAccessor().setType(t).setArray(arr).setBuffer(buf);
  const m = doc.createMaterial('hair').setBaseColorFactor([0.1, 0.05, 0.025, 1]).setRoughnessFactor(0.7).setMetallicFactor(0);
  const prim = doc.createPrimitive().setMaterial(m).setAttribute('POSITION', acc('VEC3', new Float32Array(pts.flat()))).setAttribute('NORMAL', acc('VEC3', new Float32Array(pts.map((_, i) => vec3.normalize([], nrm[canon[i]])).flat()))).setIndices(acc('SCALAR', new Uint32Array(tris)));
  doc.createScene(name).addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  const G2 = process.env.GENDER || 'f'; const key2 = (G2 === 'f' ? 'umw_' : 'umm_') + name.toLowerCase(); await io.write(`${OUT}/hair/${key2}.glb`, doc); meta[key2] = { file: `hair/${key2}.glb`, src: (G2 === 'f' ? 'Quaternius Ultimate Modular Women (' : 'Quaternius Ultimate Modular Men (') + name + ')', gender: G2 };
}
const mf = `${OUT}/_umw.json`; const prev = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf)) : {}; fs.writeFileSync(mf, JSON.stringify({ ...prev, ...meta }, null, 1)); console.log(Object.keys(meta));
