// «Современная одежда» поверх базового тела Quaternius UBC на риге UAL.
// node dress.mjs raw.glb out.glb '<json cfg>'
// raw.glb — результат reskin.mjs (тело целиком + волосы на скелете UAL1).
// Тело режется на материалы по доминирующей кости вершины: skin / shirt / pants / shoes (+ dress с юбкой-конусом),
// одежда слегка «надувается» по нормали, без текстур — чтобы Рендер красил ровно (tint по имени материала).
// cfg: { top:'tee'|'sweater'|'tank', bottom:'jeans'|'shorts'|'none', dress:false|true, colors:{shirt,pants,shoes,dress,hair},
//        child: false|{scale:0.65, head:1.35} }
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup } from '@gltf-transform/functions';
import { mat4 } from 'gl-matrix';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const [,, inP, outP, cfgS] = process.argv; const cfg = JSON.parse(cfgS);
const doc = await io.read(inP); const root = doc.getRoot(); const buf = root.listBuffers()[0];
const node = root.listNodes().find(n => n.getMesh() && n.getSkin());
const skin = node.getSkin(); const J = skin.listJoints().map(j => j.getName());
const IBM = skin.getInverseBindMatrices().getArray();
const jpos = (name) => { const i = J.indexOf(name); const m = mat4.invert(mat4.create(), IBM.slice(i * 16, i * 16 + 16)); return [m[12], m[13], m[14]]; };
const hex = (h) => { const n = parseInt(h.replace('#', ''), 16); const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return [...c, 1]; };
const flat = (name, col, rough = 0.85) => doc.createMaterial(name).setBaseColorFactor(hex(col)).setRoughnessFactor(rough).setMetallicFactor(0);
const C = { shirt: '#3f6fb0', pants: '#2c3a57', shoes: '#e8e6e0', dress: '#b0413e', hair: '#4a2e1a', ...cfg.colors };
const M = { shirt: flat('shirt', C.shirt), pants: flat('pants', C.pants), shoes: flat('shoes', C.shoes, 0.6), dress: flat('dress', C.dress) };

const shL = jpos('upperarm_l'), shR = jpos('upperarm_r'), elL = jpos('lowerarm_l');
const leftSign = Math.sign(shL[0]);
const thighL = jpos('thigh_l'), calfL = jpos('calf_l'), pelvis = jpos('pelvis');
const kneeY = calfL[1];
const armLen = Math.abs(elL[0] - shL[0]);

const top = cfg.dress ? 'dress' : 'shirt';
const TUBES = !cfg.noTubes;
function classify(name, p) {
  if (TUBES) {
    const sh = name.endsWith('_l') ? shL : shR;
    if (/^(thigh|calf)/.test(name) && !cfg.dress && cfg.bottom === 'jeans') return 'hidden';
    if (/^thigh/.test(name) && !cfg.dress && cfg.bottom === 'shorts' && p[1] > kneeY + 0.2) return 'hidden';
    if (/^(upperarm|lowerarm)/.test(name) && cfg.top === 'sweater' && Math.abs(p[0] - sh[0]) > 0.05) return 'hidden';
    if (/^upperarm/.test(name) && cfg.top === 'tee' && Math.abs(p[0] - sh[0]) > 0.03 && Math.abs(p[0] - sh[0]) < armLen * 0.45) return 'hidden';
    const wy = pelvis[1] + (cfg.waist ?? 0.09);
    if (!cfg.dress && ['tee', 'sweater', 'tank'].includes(cfg.top) && /^(spine_01|pelvis|spine_02|spine_03)/.test(name) && p[1] > wy - 0.04 && p[1] < wy + 0.005) return 'hidden';
    if (cfg.dress && /^(spine_01|pelvis)/.test(name) && p[1] < wy + 0.035) return 'hidden';
  }
  if (/^(Head|neck_01)$/.test(name)) return 'skin';
  if (/^(hand|index|middle|ring|pinky|thumb)/.test(name)) return 'skin';
  if (/^(foot|ball)/.test(name)) return cfg.shoes === false ? 'skin' : 'shoes';
  if (/^lowerarm/.test(name)) return cfg.top === 'sweater' ? top : 'skin';
  if (/^upperarm/.test(name)) {
    if (cfg.top === 'tank' || cfg.top === 'none') return 'skin';
    if (cfg.top === 'sweater') return top;
    const sh = name.endsWith('_l') ? shL : shR; // короткий рукав: ~45 % плеча
    return Math.abs(p[0] - sh[0]) > armLen * 0.45 ? 'skin' : top;
  }
  const waistY = pelvis[1] + (cfg.waist ?? 0.09);
  if (/^(spine|clavicle|pelvis)/.test(name) && !cfg.dress) return p[1] > waistY ? (cfg.top === 'none' ? 'skin' : top) : 'pants';
  if (/^(spine|clavicle)/.test(name)) return top;
  if (cfg.dress) { if (/^pelvis/.test(name)) return p[1] > pelvis[1] + 0.04 ? 'dress' : 'hidden'; if (/^thigh/.test(name)) return p[1] > kneeY + 0.06 || (cfg.dressLen ?? 0) < -0.05 ? 'hidden' : 'skin'; if (/^calf/.test(name) && (cfg.dressLen ?? 0) < -0.05 && p[1] > kneeY + (cfg.dressLen ?? 0) + 0.06) return 'hidden'; return 'skin'; }
  if (/^pelvis/.test(name)) return 'pants';
  if (/^thigh/.test(name)) return cfg.bottom === 'briefs' ? (p[1] > pelvis[1] - 0.1 ? 'pants' : 'skin') : cfg.bottom === 'shorts' && p[1] < kneeY + 0.18 ? 'skin' : 'pants';
  if (/^calf/.test(name)) return cfg.bottom === 'shorts' || cfg.bottom === 'briefs' ? 'skin' : 'pants';
  return 'skin';
}
const INFL = { skin: 0, hidden: -0.01, shirt: 0.014, pants: 0.016, shoes: 0.018, dress: 0.016, ...(cfg.infl || {}) };

const mesh = node.getMesh();
const bodyPrim = mesh.listPrimitives().find(p => /superhero/i.test(p.getMaterial()?.getName() || ''));
const P = bodyPrim.getAttribute('POSITION'), N = bodyPrim.getAttribute('NORMAL'), JN = bodyPrim.getAttribute('JOINTS_0'), W = bodyPrim.getAttribute('WEIGHTS_0');
const n = P.getCount(); const cls = new Array(n); const dom = new Array(n); const pos = P.getArray().slice();
const a = [0, 0, 0], nn = [0, 0, 0], j4 = [0, 0, 0, 0], w4 = [0, 0, 0, 0];
for (let i = 0; i < n; i++) {
  P.getElement(i, a); N.getElement(i, nn); JN.getElement(i, j4); W.getElement(i, w4);
  let bi = 0; for (let k = 1; k < 4; k++) if (w4[k] > w4[bi]) bi = k;
  cls[i] = classify(J[j4[bi]], a); dom[i] = J[j4[bi]];
}
// сглаживание ткани (убираем «мышцы» под одеждой): Лаплас по сваренным вершинам, затем надув по нормали
const snapped = new Set(); const canon = new Int32Array(n);
{
  const key = new Map();
  for (let i = 0; i < n; i++) { const k = `${Math.round(pos[i*3]*1e4)},${Math.round(pos[i*3+1]*1e4)},${Math.round(pos[i*3+2]*1e4)}`; if (!key.has(k)) key.set(k, i); canon[i] = key.get(k); }
  const nb = new Map(); const ix0 = bodyPrim.getIndices().getArray();
  const link = (x, y) => { x = canon[x]; y = canon[y]; if (x === y) return; (nb.get(x) || nb.set(x, new Set()).get(x)).add(y); };
  for (let t = 0; t < ix0.length; t += 3) { const [u, v, w] = [ix0[t], ix0[t+1], ix0[t+2]]; link(u, v); link(v, u); link(v, w); link(w, v); link(u, w); link(w, u); }
  // ровные кромки: пояс (shirt|pants) по горизонтали, рукав футболки — по плоскости поперёк руки
  const waistY = pelvis[1] + (cfg.waist ?? 0.09);
  for (const [c, set] of nb) {
    const k = cls[c]; if (k === 'skin' || k === 'shoes' || k === 'hidden') continue;
    let other = null; for (const o of set) if (cls[o] !== k) { other = cls[o]; break; }
    if (!other) continue;
    if ((k === 'shirt' && other === 'pants') || (k === 'pants' && other === 'shirt') || (cfg.top === 'none' && k === 'pants' && other === 'skin' && pos[c*3+1] > pelvis[1] - 0.02)) { pos[c*3+1] = waistY; snapped.add(c); }
    else if (k === top && other === 'skin' && pos[c*3+1] > shL[1] - 0.06 && Math.abs(pos[c*3]) < 0.16) { // ровный круглый ворот
      const nk = jpos('neck_01'); const x = pos[c*3]; pos[c*3+1] = nk[1] - 0.045 + 0.06 * Math.min(1, (x / 0.13) ** 2) - (pos[c*3+2] > nk[2] ? 0.015 : 0); snapped.add(c); }
    else if (k === 'pants' && other === 'skin' && cfg.bottom === 'shorts' && pos[c*3+1] > kneeY) { pos[c*3+1] = kneeY + 0.18; snapped.add(c); }
    else if (k === top && other === 'skin' && cfg.top === 'tee' && Math.abs(pos[c*3]) > Math.abs(shL[0]) + 0.02) {
      const sh = Math.sign(pos[c*3]) === Math.sign(shL[0]) ? shL : shR; pos[c*3] = sh[0] + Math.sign(pos[c*3] - sh[0]) * armLen * 0.45; snapped.add(c);
    }
  }
  const iters = cfg.smooth ?? 6;
  for (let it = 0; it < iters; it++) {
    const np = pos.slice();
    for (const [c, set] of nb) {
      if (cls[c] === 'skin' || cls[c] === 'hidden' || snapped.has(c)) continue;
      let sx = 0, sy = 0, sz = 0; for (const o of set) { sx += pos[o*3]; sy += pos[o*3+1]; sz += pos[o*3+2]; }
      const m = set.size; np[c*3] = pos[c*3] * 0.5 + sx / m * 0.5; np[c*3+1] = pos[c*3+1] * 0.5 + sy / m * 0.5; np[c*3+2] = pos[c*3+2] * 0.5 + sz / m * 0.5;
    }
    pos.set(np);
  }
  for (let i = 0; i < n; i++) { const c = canon[i]; if (c !== i) for (let k = 0; k < 3; k++) pos[i*3+k] = pos[c*3+k]; }
  for (let i = 0; i < n; i++) { N.getElement(i, nn); const d = INFL[cls[canon[i]]] ?? 0; for (let k = 0; k < 3; k++) pos[i*3+k] += nn[k] * d; }
  for (let i = 0; i < n; i++) if (pos[i*3+1] < 0) pos[i*3+1] = 0; // подошва не ниже пола
  // нормали ткани — по сглаженной геометрии (иначе свет рисует «пресс» под футболкой)
  const acc = new Float32Array(n * 3);
  for (let t = 0; t < ix0.length; t += 3) {
    const [u, v, w] = [canon[ix0[t]], canon[ix0[t+1]], canon[ix0[t+2]]];
    const e1 = [0,1,2].map(k => pos[v*3+k] - pos[u*3+k]), e2 = [0,1,2].map(k => pos[w*3+k] - pos[u*3+k]);
    const fx = e1[1]*e2[2]-e1[2]*e2[1], fy = e1[2]*e2[0]-e1[0]*e2[2], fz = e1[0]*e2[1]-e1[1]*e2[0];
    for (const c of [u, v, w]) { acc[c*3] += fx; acc[c*3+1] += fy; acc[c*3+2] += fz; }
  }
  const nor = N.getArray().slice();
  for (let i = 0; i < n; i++) { if (cls[canon[i]] === 'skin') continue; const c = canon[i]; const l = Math.hypot(acc[c*3], acc[c*3+1], acc[c*3+2]) || 1;
    // ориентация как у исходной нормали
    const sgn = (acc[c*3]*nor[i*3] + acc[c*3+1]*nor[i*3+1] + acc[c*3+2]*nor[i*3+2]) < 0 ? -1 : 1;
    for (let k = 0; k < 3; k++) nor[i*3+k] = sgn * acc[c*3+k] / l; }
  N.setArray(nor);
}
P.setArray(pos);
bodyPrim.getMaterial().setName('skin');
const idx = bodyPrim.getIndices().getArray(); const groups = {};
const rank = { hidden: 5, shoes: 4, dress: 3, pants: 3, shirt: 2, skin: 1 };
for (let t = 0; t < idx.length; t += 3) {
  let vs = [idx[t], idx[t + 1], idx[t + 2]]; const free = vs.filter(v => !snapped.has(canon[v])); if (free.length) vs = free;
  const cs = vs.map(v => cls[v]);
  const cnt = {}; for (const c of cs) cnt[c] = (cnt[c] || 0) + 1;
  let g = cs[0]; for (const c of cs) if (cnt[c] > cnt[g] || (cnt[c] === cnt[g] && rank[c] > rank[g])) g = c;
  (groups[g] ||= []).push(idx[t], idx[t + 1], idx[t + 2]);
}
mesh.removePrimitive(bodyPrim);
for (const [g, list] of Object.entries(groups)) {
  if (g === 'hidden') continue; // под юбкой — не рисуем
  const p = doc.createPrimitive().setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(list)).setBuffer(buf))
    .setMaterial(g === 'skin' ? bodyPrim.getMaterial() : M[g]);
  for (const s of bodyPrim.listSemantics()) if (g === 'skin' || s !== 'TEXCOORD_0') p.setAttribute(s, bodyPrim.getAttribute(s));
  mesh.addPrimitive(p);
}


// ===== отдельные объёмы одежды: рукава, штанины, подол — трубки по кольцам вдоль костей (чистые кромки, свободный крой) =====
const acc3 = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm = (a) => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
function measureRing(start, end, t, bones, slab = 0.05, q = 0.85) {
  const ax = sub(end, start), L = Math.hypot(...ax), an = ax.map(v => v / L);
  const ref = Math.abs(an[1]) > 0.7 ? [0, 0, 1] : [0, 1, 0]; const u = norm(cross(an, ref)), v = cross(u, an);
  const c0 = start.map((s0, k) => s0 + ax[k] * t); const pts = [];
  for (let i = 0; i < n; i++) { if (!bones.includes(dom[i])) continue; const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]; const d = sub(p, c0); if (Math.abs(dot(d, an)) > slab) continue; pts.push([dot(d, u), dot(d, v)]); }
  if (pts.length < 6) return null;
  // центр — медиана, радиусы — 90-й перцентиль (без выбросов подмышки/паха)
  const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; }, pct = (a, q) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * q))]; };
  const us = pts.map(q => q[0]), vs = pts.map(q => q[1]); const cu = (pct(us, 0.2) + pct(us, 0.8)) / 2, cv = (pct(vs, 0.2) + pct(vs, 0.8)) / 2;
  const du = pts.map(q => Math.abs(q[0] - cu)), dv = pts.map(q => Math.abs(q[1] - cv)); const ru = pct(du, q), rv = pct(dv, q);
  return { c: c0.map((x, k) => x + u[k] * cu + v[k] * cv), u, v, an, ru, rv };
}
// ориентация граней наружу: знак (u×v)·ось
const flipTube = (rings) => dot(cross(rings[0].u, rings[0].v), sub(rings[1].c, rings[0].c)) < 0;
function tube(rings, mat, N = 14, lipAt = 'end') { // rings: [{c,u,v,ru,rv,w:[[jointIdx,weight]…]}]
  // сгладить радиусы вдоль трубки
  for (let k = 1; k < rings.length - 1; k++) { rings[k].ru2 = (rings[k - 1].ru + 2 * rings[k].ru + rings[k + 1].ru) / 4; rings[k].rv2 = (rings[k - 1].rv + 2 * rings[k].rv + rings[k + 1].rv) / 4; }
  for (const r of rings) { if (r.ru2) { r.ru = r.ru2; r.rv = r.rv2; } }
  const vp = [], vn = [], vj = [], vw = [], ix = [];
  for (const r of rings) for (let s2 = 0; s2 <= N; s2++) { const a = s2 / N * Math.PI * 2, cu = Math.cos(a), sv = Math.sin(a);
    const p = r.c.map((x, k) => x + r.u[k] * cu * r.ru + r.v[k] * sv * r.rv); vp.push(...p); vn.push(...norm(r.u.map((x, k) => x * cu / r.ru + r.v[k] * sv / r.rv)));
    const w = r.w.slice(0, 4); while (w.length < 4) w.push([0, 0]); const tot = w.reduce((q, x) => q + x[1], 0) || 1; vj.push(...w.map(x => x[0])); vw.push(...w.map(x => x[1] / tot)); }
  for (let k = 0; k < rings.length - 1; k++) for (let s2 = 0; s2 < N; s2++) { const q = k * (N + 1) + s2, q2 = q + N + 1; if (flipTube(rings)) ix.push(q, q2, q + 1, q + 1, q2, q2 + 1); else ix.push(q, q + 1, q2, q + 1, q2 + 1, q2); }
  // кромки: утолщённый край (внутреннее кольцо) на обоих концах
  for (const [k, sgn] of (lipAt === 'start' ? [[0, -1]] : [[rings.length - 1, 1]])) { const r = rings[k]; const base = vp.length / 3;
    for (let s2 = 0; s2 <= N; s2++) { const a = s2 / N * Math.PI * 2, cu = Math.cos(a), sv = Math.sin(a); const p = r.c.map((x, kk) => x + r.u[kk] * cu * (r.ru - 0.008) + r.v[kk] * sv * (r.rv - 0.008) - r.an[kk] * sgn * 0.004);
      vp.push(...p); vn.push(...r.an.map(x => x * sgn)); const w = r.w.slice(0, 4); while (w.length < 4) w.push([0, 0]); const tot = w.reduce((q, x) => q + x[1], 0) || 1; vj.push(...w.map(x => x[0])); vw.push(...w.map(x => x[1] / tot)); }
    const ro = k * (N + 1); const fl = flipTube(rings) ? -1 : 1; for (let s2 = 0; s2 < N; s2++) (sgn * fl) > 0 ? ix.push(ro + s2, base + s2, ro + s2 + 1, ro + s2 + 1, base + s2, base + s2 + 1) : ix.push(ro + s2, ro + s2 + 1, base + s2, ro + s2 + 1, base + s2 + 1, base + s2); }
  mesh.addPrimitive(doc.createPrimitive().setMaterial(mat).setAttribute('POSITION', acc3('VEC3', new Float32Array(vp))).setAttribute('NORMAL', acc3('VEC3', new Float32Array(vn)))
    .setAttribute('JOINTS_0', acc3('VEC4', new Uint16Array(vj))).setAttribute('WEIGHTS_0', acc3('VEC4', new Float32Array(vw))).setIndices(acc3('SCALAR', new Uint32Array(ix))));
  mat.setDoubleSided(true);
}
const JI = (nm) => J.indexOf(nm);
function limb(seg, mat, margin, { flare = 0.008, minR = 0 } = {}) { // seg: [{a,b,t0,t1,steps,bones,w:(t)=>weights}]
  const rings = [];
  for (const sg of seg) for (let k = 0; k <= sg.steps; k++) { if (rings.length && k === 0) continue; const t = sg.t0 + (sg.t1 - sg.t0) * k / sg.steps;
    const r = measureRing(jpos(sg.a), jpos(sg.b), Math.min(Math.max(t, 0.02), 0.98), sg.bones) || (rings.length ? { ...rings[rings.length - 1] } : null); if (!r) continue;
    if (t !== Math.min(Math.max(t, 0.02), 0.98)) { const ax = sub(jpos(sg.b), jpos(sg.a)); r.c = r.c.map((x, i) => x + ax[i] * (t - Math.min(Math.max(t, 0.02), 0.98))); }
    rings.push({ ...r, ru: Math.max(minR, r.ru + margin), rv: Math.max(minR, r.rv + margin), w: sg.w(t) }); }
  if (process.env.DBG) console.log('limb', seg[0].a, rings.map(r => [r.c.map(v => v.toFixed(3)).join(','), r.ru.toFixed(3), r.rv.toFixed(3)].join(' ')).join(' | '));
  if (rings.length < 2) return; const last = rings[rings.length - 1]; last.ru += flare; last.rv += flare; tube(rings, mat);
}
const topMat = M[top] || M.shirt;
for (const sd of ['l', 'r']) {
  if (cfg.top === 'tee') limb([{ a: 'upperarm_' + sd, b: 'lowerarm_' + sd, t0: -0.08, t1: 0.52, steps: 5, bones: ['upperarm_' + sd], w: (t) => t < 0.05 ? [[JI('upperarm_' + sd), 0.7], [JI('clavicle_' + sd), 0.3]] : [[JI('upperarm_' + sd), 1]] }], topMat, 0.028, { flare: 0.012 });
  if (cfg.top === 'sweater') limb([{ a: 'upperarm_' + sd, b: 'lowerarm_' + sd, t0: -0.1, t1: 1, steps: 5, bones: ['upperarm_' + sd], w: (t) => t > 0.9 ? [[JI('upperarm_' + sd), 0.5], [JI('lowerarm_' + sd), 0.5]] : [[JI('upperarm_' + sd), 1]] },
    { a: 'lowerarm_' + sd, b: 'hand_' + sd, t0: 0, t1: 1.03, steps: 5, bones: ['lowerarm_' + sd], w: (t) => t < 0.1 ? [[JI('lowerarm_' + sd), 0.7], [JI('upperarm_' + sd), 0.3]] : [[JI('lowerarm_' + sd), 1]] }], topMat, 0.024, { flare: 0.006 });
  const legW = (bone, parent) => (t) => t < 0.08 ? [[JI(bone), 0.6], [JI(parent), 0.4]] : [[JI(bone), 1]];
  if (!cfg.dress && cfg.bottom === 'jeans') limb([{ a: 'thigh_' + sd, b: 'calf_' + sd, t0: -0.08, t1: 1, steps: 7, bones: ['thigh_' + sd], w: legW('thigh_' + sd, 'pelvis') },
    { a: 'calf_' + sd, b: 'foot_' + sd, t0: 0, t1: 0.93, steps: 5, bones: ['calf_' + sd], w: (t) => t < 0.1 ? [[JI('calf_' + sd), 0.6], [JI('thigh_' + sd), 0.4]] : [[JI('calf_' + sd), 1]] }], M.pants, 0.03, { flare: 0.012, minR: 0.065 });
  if (!cfg.dress && cfg.bottom === 'briefs') limb([{ a: 'thigh_' + sd, b: 'calf_' + sd, t0: -0.1, t1: 0.08, steps: 3, bones: ['thigh_' + sd], w: legW('thigh_' + sd, 'pelvis') }], M.pants, 0.012, { flare: 0.004 });
  if (cfg.top === 'tank') limb([{ a: 'upperarm_' + sd, b: 'lowerarm_' + sd, t0: -0.1, t1: 0.08, steps: 3, bones: ['upperarm_' + sd], w: (t) => [[JI('upperarm_' + sd), 0.7], [JI('clavicle_' + sd), 0.3]] }], topMat, 0.016, { flare: 0.004 });
  if (!cfg.dress && cfg.bottom === 'shorts') limb([{ a: 'thigh_' + sd, b: 'calf_' + sd, t0: -0.08, t1: 0.62, steps: 6, bones: ['thigh_' + sd], w: legW('thigh_' + sd, 'pelvis') }], M.pants, 0.032, { flare: 0.014 });
}
// подол футболки/свитера: короткое кольцо на талии поверх стыка shirt|pants
if (!cfg.dress && ['tee', 'sweater', 'tank'].includes(cfg.top)) {
  const wy = pelvis[1] + (cfg.waist ?? 0.09), top3 = wy + 0.16, s0 = [pelvis[0], wy - 0.05, pelvis[2]], s1 = [pelvis[0], top3, pelvis[2]]; const rings = [];
  for (let k = 0; k <= 6; k++) { const t = k / 6; const r = measureRing(s0, s1, t, ['spine_01', 'spine_02', 'spine_03', 'pelvis'], 0.03, 0.9); if (!r) continue; const mg = 0.03 * (1 - t) ** 1.3 - 0.012 * t + 0.004;
    rings.push({ ...r, ru: r.ru + mg, rv: r.rv + mg, w: t < 0.15 ? [[JI('pelvis'), 0.5], [JI('spine_01'), 0.5]] : t < 0.45 ? [[JI('spine_01'), 1]] : t < 0.8 ? [[JI('spine_02'), 1]] : [[JI('spine_03'), 1]] }); }
  if (rings.length > 1) tube(rings, topMat, 18, 'start');
}

// юбка: конус от талии до колена, веса pelvis → thigh_l/r
if (cfg.dress) {
  const yTop = pelvis[1] + (cfg.waist ?? 0.09) + 0.065, yBot = kneeY + (cfg.dressLen ?? 0.02), R = 8, S = 22;
  const ext = (y) => { let rx = 0, rz = 0, cz = 0, c = 0; for (let i = 0; i < n; i++) { if (Math.abs(pos[i * 3 + 1] - y) < 0.03 && Math.abs(pos[i * 3]) < 0.3 && cls[i] !== 'skin' || (Math.abs(pos[i * 3 + 1] - y) < 0.03 && /thigh|pelvis/.test(''))) { rx = Math.max(rx, Math.abs(pos[i * 3])); cz += pos[i * 3 + 2]; c++; } } return { rx, cz: c ? cz / c : pelvis[2] }; };
  const topE = ext(yTop); const rz0 = [];
  let zmin = Infinity, zmax = -Infinity; for (let i = 0; i < n; i++) if (Math.abs(pos[i * 3 + 1] - yTop) < 0.04 && Math.abs(pos[i * 3]) < 0.3) { zmin = Math.min(zmin, pos[i * 3 + 2]); zmax = Math.max(zmax, pos[i * 3 + 2]); }
  let cz = (zmin + zmax) / 2, rz0v = (zmax - zmin) / 2 + 0.012, rx0 = topE.rx + 0.012;
  { const wr = measureRing([pelvis[0], yTop - 0.1, pelvis[2]], [pelvis[0], yTop + 0.1, pelvis[2]], 0.5, ['spine_01', 'pelvis', 'spine_02'], 0.025); if (wr) { rx0 = wr.ru + 0.006; rz0v = wr.rv + 0.006; cz = wr.c[2]; } }
  const hipR = measureRing([pelvis[0], pelvis[1] - 0.15, pelvis[2]], [pelvis[0], pelvis[1] + 0.05, pelvis[2]], 0.5, ['pelvis', 'thigh_l', 'thigh_r'], 0.03);
  const iP = J.indexOf('pelvis'), iL = J.indexOf('thigh_l'), iRt = J.indexOf('thigh_r');
  const vp = [], vn = [], vj = [], vw = [], ix = [];
  for (let r = 0; r <= R; r++) {
    const t = r / R, y = yTop + (yBot - yTop) * t; const hx = (hipR ? hipR.ru : rx0 + 0.04) + 0.025, hz = (hipR ? hipR.rv : rz0v + 0.03) + 0.025;
    const e = Math.min(1, t / 0.35); const rx = t < 0.35 ? rx0 + (hx - rx0) * Math.sin(e * Math.PI / 2) : hx + (t - 0.35) * 0.14, rz = t < 0.35 ? rz0v + (hz - rz0v) * Math.sin(e * Math.PI / 2) : hz + (t - 0.35) * 0.12;
    for (let s = 0; s <= S; s++) {
      const th = (s / S) * Math.PI * 2, x = Math.cos(th) * rx, z = cz + Math.sin(th) * rz;
      vp.push(x, y, z); const nl = Math.hypot(Math.cos(th) / rx, Math.sin(th) / rz); vn.push(Math.cos(th) / rx / nl, 0.15, Math.sin(th) / rz / nl);
      const side = (x * leftSign) / rx; const wl = Math.min(1, Math.max(0, (side + 1) / 2)); const wt = 0.85 * t;
      vj.push(iP, iL, iRt, 0); vw.push(1 - wt, wt * wl, wt * (1 - wl), 0);
    }
  }
  for (let r = 0; r < R; r++) for (let s = 0; s < S; s++) { const q = r * (S + 1) + s, q2 = q + S + 1; ix.push(q, q2, q + 1, q + 1, q2, q2 + 1); }
  // двусторонняя: изнанка
  const base = vp.length / 3; const L = ix.length; for (let i = 0; i < L; i += 3) ix.push(ix[i] , ix[i + 2], ix[i + 1]);
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
  mesh.addPrimitive(doc.createPrimitive().setMaterial(M.dress)
    .setAttribute('POSITION', acc('VEC3', new Float32Array(vp))).setAttribute('NORMAL', acc('VEC3', new Float32Array(vn)))
    .setAttribute('JOINTS_0', acc('VEC4', new Uint16Array(vj))).setAttribute('WEIGHTS_0', acc('VEC4', new Float32Array(vw)))
    .setIndices(acc('SCALAR', new Uint32Array(ix))));
  M.dress.setDoubleSided(true);
}

// волосы и брови: один материал 'hair', плоский цвет поверх текстуры
for (const m of root.listMaterials()) if (/hair/i.test(m.getName())) m.setName('hair').setBaseColorFactor(hex(C.hair));
for (const m of root.listMaterials()) if (/eye/i.test(m.getName())) m.setName('eyes');
if (cfg.skin) for (const m of root.listMaterials()) if (m.getName() === 'skin') m.setBaseColorFactor(hex(cfg.skin));

// ребёнок: всё ×scale через обёртку над костью root, голова крупнее
if (cfg.child) {
  const rootBone = root.listNodes().find(x => x.getName() === 'root');
  const scene = root.listScenes()[0];
  const wrap = doc.createNode('ChildScale').setScale([cfg.child.scale, cfg.child.scale, cfg.child.scale]);
  const parent = rootBone.getParentNode();
  if (parent) { parent.removeChild(rootBone); parent.addChild(wrap); } else { scene.removeChild(rootBone); scene.addChild(wrap); }
  wrap.addChild(rootBone);
  const head = root.listNodes().find(x => x.getName() === 'Head'); head.setScale([cfg.child.head, cfg.child.head, cfg.child.head]);
}
node.setName(cfg.name || 'Character');
for (const acc of root.listAccessors()) if (acc.listParents().every(p => p.propertyType === 'Root')) acc.dispose();
await doc.transform(prune(), dedup());
await io.write(outP, doc);
console.log('ok', outP, Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length / 3])));
