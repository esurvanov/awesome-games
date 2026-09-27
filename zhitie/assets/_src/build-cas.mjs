// CAS: причёски и аксессуары как статичные меши в локальных координатах кости Head.
// node build-cas.mjs <outDir> <body_m.glb> <body_f.glb>
// Всё строится в bind-мире (T-поза, лицо +Z), затем переводится обратной матрицей кости Head →
// Рендер: head = model.getObjectByName('Head'); head.add(mesh) (position 0, quaternion identity).
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup } from '@gltf-transform/functions';
import { mat4, vec3 } from 'gl-matrix';
import fs from 'fs';
import { mat, G, box, cyl, sphere, meshNode } from './geo.mjs';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const [,, OUT = 'cas', BM, BF] = process.argv; fs.mkdirSync(`${OUT}/hair`, { recursive: true }); fs.mkdirSync(`${OUT}/acc`, { recursive: true });

async function measure(file) {
  const d = await io.read(file); const skin = d.getRoot().listSkins()[0]; const J = skin.listJoints().map(j => j.getName());
  const IBM = skin.getInverseBindMatrices().getArray(); const iH = J.indexOf('Head');
  const headW = mat4.invert(mat4.create(), IBM.slice(iH * 16, iH * 16 + 16));
  const mn = [9, 9, 9], mx = [-9, -9, -9]; const eyes = [];
  for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const nm = p.getMaterial()?.getName(); const P = p.getAttribute('POSITION'), Jn = p.getAttribute('JOINTS_0'), W = p.getAttribute('WEIGHTS_0'); const a = [], j = [], w = [];
    for (let i = 0; i < P.getCount(); i++) { P.getElement(i, a);
      if (nm === 'eyes') { eyes.push([...a]); continue; }
      if (nm !== 'skin') continue; Jn.getElement(i, j); W.getElement(i, w); let hw = 0; for (let k = 0; k < 4; k++) if (j[k] === iH) hw += w[k]; if (hw < 0.6) continue;
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], a[k]); mx[k] = Math.max(mx[k], a[k]); } }
  }
  const c = mn.map((v, k) => (v + mx[k]) / 2), e = mn.map((v, k) => (mx[k] - v) / 2);
  const eL = eyes.filter(p => p[0] > c[0]), eR = eyes.filter(p => p[0] <= c[0]); const avg = (L) => L.reduce((s, p) => s.map((v, k) => v + p[k] / L.length), [0, 0, 0]);
  return { headW, inv: mat4.invert(mat4.create(), headW), c, e, top: mx[1], eyeL: avg(eL), eyeR: avg(eR), zFront: mx[2] };
}
const HM = await measure(BM), HF = await measure(BF);

// перевод геометрии мира → локальные координаты Head
function toLocal(g, inv) {
  const out = { pos: [], nor: [], idx: g.idx.slice(), uv: g.uv.slice() }; const n3 = mat4.transpose(mat4.create(), mat4.invert(mat4.create(), inv));
  for (let i = 0; i < g.pos.length; i += 3) { const p = vec3.transformMat4([], g.pos.slice(i, i + 3), inv); out.pos.push(...p);
    const nn = [g.nor[i], g.nor[i + 1], g.nor[i + 2], 0]; const r = [0, 1, 2].map(k => n3[k] * nn[0] + n3[4 + k] * nn[1] + n3[8 + k] * nn[2]); const l = Math.hypot(...r) || 1; out.nor.push(...r.map(v => v / l)); }
  return out;
}
async function write(dir, name, parts, H) {
  const doc = new Document(); doc.createBuffer(); const mats = {};
  const P = parts.map(([g, col, opt = {}]) => [toLocal(g, H.inv), mats[opt.name || col] ||= mat(doc, opt.name || 'acc', col, opt)]);
  doc.createScene(name).addChild(meshNode(doc, name, P));
  await doc.transform(dedup(), prune()); await io.write(`${OUT}/${dir}/${name}.glb`, doc); return `${dir}/${name}.glb`;
}
// оболочка-эллипсоид вокруг головы с вырезом лица
function shell(g, H, { sc = 1.1, low = -0.1, face = 0.45, back = null, dy = 0.015 } = {}) {
  const [cx, cy, cz] = H.c, [ex, ey, ez] = H.e; const tmp = G(); sphere(tmp, cx, cy + dy, cz - 0.008, ex * sc, ey * sc, ez * sc, 22, 16);
  const keep = (i) => { const x = tmp.pos[i * 3], y = tmp.pos[i * 3 + 1], z = tmp.pos[i * 3 + 2]; const lowY = back != null && z < cz ? cy + back * ey : cy + low * ey;
    if (y < lowY) return false; if (z > cz + 0.2 * ez && y < cy + face * ey) return false; return true; };
  const b = g.pos.length / 3; g.pos.push(...tmp.pos); g.nor.push(...tmp.nor); g.uv.push(...tmp.uv);
  for (let t = 0; t < tmp.idx.length; t += 3) { const [a, c2, d] = [tmp.idx[t], tmp.idx[t + 1], tmp.idx[t + 2]]; if (keep(a) && keep(c2) && keep(d)) g.idx.push(b + a, b + c2, b + d); }
  // изнанка (видна снизу/сбоку)
  const L = g.idx.length; for (let t = L - 3; t >= 0 && t >= L - (tmp.idx.length); t -= 3) {}
}
const HAIRC = '#5a3a22';
// ===== причёски из прядей-«клоков»: сплюснутые сужающиеся трубки вдоль траекторий (объём + бороздки) =====
const V = { add: (a, b) => a.map((x, i) => x + b[i]), sub: (a, b) => a.map((x, i) => x - b[i]), mul: (a, k) => a.map(x => x * k), dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm: (a) => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); } };
function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
// точка на «черепе» (эллипсоид головы ×k) по направлению
const onHead = (H, d, k = 1) => [H.c[0] + d[0] * H.e[0] * k, H.c[1] + 0.012 + d[1] * H.e[1] * k, H.c[2] - 0.006 + d[2] * H.e[2] * k];
function pushOut(H, p, k) { const q = [(p[0] - H.c[0]) / (H.e[0] * k), (p[1] - H.c[1] - 0.012) / (H.e[1] * k), (p[2] - H.c[2] + 0.006) / (H.e[2] * k)]; const l = Math.hypot(...q); return l >= 1 ? p : onHead(H, q.map(x => x / l), k); }
function strandTube(g, pts, H, w0, w1, th0, th1, sides = 6) {
  const b = g.pos.length / 3; const n = pts.length;
  for (let i = 0; i < n; i++) { const T = V.norm(V.sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)])); let N = V.norm(V.sub(pts[i], H.c)); N = V.norm(V.sub(N, V.mul(T, V.dot(N, T)))); const B = V.cross(T, N);
    const f = i / (n - 1), w = w0 + (w1 - w0) * f, t = th0 + (th1 - th0) * f;
    for (let k = 0; k <= sides; k++) { const a = k / sides * Math.PI * 2; const off = V.add(V.mul(B, Math.cos(a) * w), V.mul(N, Math.sin(a) * t)); g.pos.push(...V.add(pts[i], off)); g.nor.push(...V.norm(V.add(V.mul(B, Math.cos(a) / Math.max(w, 1e-4)), V.mul(N, Math.sin(a) / Math.max(t, 1e-4))))); g.uv.push(k / sides, f); } }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < sides; k++) { const q = b + i * (sides + 1) + k, q2 = q + sides + 1; g.idx.push(q, q2, q + 1, q + 1, q2, q2 + 1); }
}
// траектория: старт на скальпе, шаги по полю направлений flow(p, i), не заходя внутрь головы
function path(H, start, flow, len, steps, k = 1.06, hug = 0.9, noFace = false) { const pts = [start]; let p = start; for (let i = 1; i <= steps; i++) { let d = V.norm(flow(p, i / steps));
    const nrm = V.norm([(p[0] - H.c[0]) / H.e[0], (p[1] - H.c[1]) / H.e[1], (p[2] - H.c[2]) / H.e[2]]); const out = V.dot(d, nrm); if (out > 0 && p[1] > H.c[1] - H.e[1] * 0.6) d = V.norm(V.sub(d, V.mul(nrm, out * hug)));
    p = pushOut(H, V.add(p, V.mul(d, len / steps)), k);
    if (!noFace && p[2] > H.c[2] + H.e[2] * 0.15 && Math.abs(p[0] - H.c[0]) < H.e[0] * 1.08 && p[1] < H.c[1] + H.e[1] * 0.5) p = [H.c[0] + Math.sign(p[0] - H.c[0] || 1) * H.e[0] * 1.1, p[1], Math.min(p[2], H.c[2] + H.e[2] * 0.35)];
    pts.push(p); } return pts; }
const dirOf = (th, ph) => [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];   // th от макушки, ph: 0=+x, π/2=+z (лицо)
const inFace = (d) => d[2] > 0.25 && d[1] < 0.62;
function cap(g, H, sc = 1.03) { shell(g, H, { sc, low: -0.1, face: 0.5, dy: 0.004 }); }
function hairStyle(H, o) { // o: {count, thMax, len, steps, w, t, flow(p,f,d), seed, capSc, extra(g)}
  const g = G(); cap(g, H, o.capSc ?? 1.035); const r = rng(o.seed || 7);
  for (let i = 0; i < o.count; i++) { const th = Math.acos(1 - r() * (1 - Math.cos(o.thMax))), ph = r() * Math.PI * 2; const d = dirOf(th, ph); if (inFace(d) && !o.fringe) continue; if (o.skip && o.skip(d)) continue;
    const L = o.len * (0.75 + r() * 0.5); const st = onHead(H, d, 1.02); const pts = path(H, st, (p, f) => o.flow(p, f, d, r), L, o.steps || 4, o.k || 1.05, o.hug ?? 0.9);
    strandTube(g, pts, H, o.w * (0.8 + r() * 0.4), o.w * (o.tip ?? 0.25), o.t, o.t * 0.5); }
  if (o.extra) o.extra(g, r);
  return [[g, HAIRC, { name: 'hair', rough: 0.85 }]];
}
const back = [0, -0.15, -1], down = [0, -1, 0];
const PROC_HAIR = {
  short_messy: (H) => hairStyle(H, { count: 120, thMax: 1.7, len: 0.07, w: 0.04, t: 0.011, seed: 3, flow: (p, f, d, r) => V.add(back, [(r() - 0.5) * 1.2, 0.3, 0]) }),
  quiff: (H) => hairStyle(H, { count: 120, thMax: 1.7, len: 0.08, w: 0.04, t: 0.012, seed: 5, fringe: true, skip: (d) => d[2] > 0.35 && d[1] < 0.72, hug: 0.6, flow: (p, f, d) => d[2] > 0.2 ? [0, 0.7, 0.45] : back }),
  side_swept: (H) => hairStyle(H, { count: 130, thMax: 1.75, len: 0.1, w: 0.04, t: 0.01, seed: 9, fringe: true, skip: (d) => d[2] > 0.4 && d[1] < 0.68, hug: 1, flow: () => [1, -0.35, -0.1] }),
  spiky: (H) => hairStyle(H, { count: 90, thMax: 1.5, len: 0.05, w: 0.032, t: 0.014, tip: 0.05, seed: 11, hug: 0, flow: (p, f, d) => V.add(d, [0, 0.5, -0.3]) }),
  slick_back: (H) => hairStyle(H, { count: 130, thMax: 1.75, len: 0.13, w: 0.04, t: 0.008, seed: 13, k: 1.04, hug: 1, flow: () => [0, 0.1, -1] }),
  man_bun: (H) => hairStyle(H, { count: 120, thMax: 1.8, len: 0.12, w: 0.038, t: 0.008, seed: 15, k: 1.04, hug: 1, flow: (p) => V.sub(onHead(H, V.norm([0, 0.75, -0.66]), 1.1), p), extra: (g) => { const c = onHead(H, V.norm([0, 0.75, -0.66]), 1.2); for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; sphere(g, c[0] + Math.cos(a) * 0.022, c[1] + Math.sin(a) * 0.014, c[2] - 0.01, 0.03, 0.026, 0.026, 8, 6); } sphere(g, c[0], c[1], c[2] - 0.015, 0.035, 0.032, 0.03, 10, 7); } }),
  mohawk: (H) => { const out = hairStyle(H, { count: 70, thMax: 1.6, len: 0.08, w: 0.034, t: 0.014, tip: 0.05, seed: 17, hug: 0, skip: (d) => Math.abs(d[0]) > 0.2, flow: (p, f, d) => V.add([0, 1, -0.3], V.mul(d, 0.5)) }); out[0][0].idx = out[0][0].idx; const sd = G(); shell(sd, H, { sc: 1.02, low: -0.1, face: 0.6, dy: 0.002 }); out.push([sd, '#2b2118', { name: 'hairShaved', rough: 1 }]); return out; },
  afro: (H) => hairStyle(H, { count: 0, thMax: 1, len: 0, w: 0, t: 0, capSc: 1.06, extra: (g, r) => { for (let i = 0; i < 170; i++) { const th = Math.acos(1 - r() * 1.8), ph = r() * Math.PI * 2, d = dirOf(th, ph); if (inFace(d)) continue; const p = onHead(H, d, 1.22 + r() * 0.1); sphere(g, p[0], p[1], p[2], 0.032, 0.032, 0.032, 7, 5); } } }),
  curly: (H) => hairStyle(H, { count: 0, thMax: 1, len: 0, w: 0, t: 0, extra: (g, r) => { for (let i = 0; i < 170; i++) { const th = Math.acos(1 - r() * 1.7), ph = r() * Math.PI * 2, d = dirOf(th, ph); if (inFace(d)) continue; const p = onHead(H, d, 1.08 + r() * 0.05);
    const pts = []; for (let k = 0; k < 6; k++) { const a = k * 1.4 + i; pts.push(V.add(p, [Math.cos(a) * 0.01, -k * 0.007, Math.sin(a) * 0.01])); } strandTube(g, pts, H, 0.014, 0.009, 0.012, 0.009, 5); } } }),
  pixie: (H) => hairStyle(H, { count: 130, thMax: 1.7, len: 0.08, w: 0.038, t: 0.009, seed: 21, fringe: true, skip: (d) => d[2] > 0.35 && d[1] < 0.66, hug: 1, flow: () => [0.6, -0.5, 0.25] }),
  bob: (H) => hairStyle(H, { count: 170, thMax: 1.95, len: 0.2, steps: 7, w: 0.042, t: 0.01, tip: 0.8, seed: 23, hug: 1, k: 1.06, flow: (p, f, d) => f < 0.4 ? [d[0] * 0.3, -1, -0.35] : down, extra: (g) => fringe(g, H, 0.045) }),
  long_wavy: (H) => hairStyle(H, { count: 170, thMax: 1.95, len: 0.42, steps: 10, w: 0.045, t: 0.011, tip: 0.5, seed: 25, k: 1.07, hug: 1, flow: (p, f, d) => f < 0.3 ? [d[0] * 0.3, -1, -0.45] : V.add(down, [Math.sin(f * 14 + d[0] * 9) * 0.25, 0, -0.25]), extra: (g) => fringe(g, H, 0.06, true) }),
  ponytail: (H) => hairStyle(H, { count: 130, thMax: 1.9, len: 0.14, steps: 5, w: 0.036, t: 0.008, seed: 27, k: 1.04, hug: 1, flow: (p) => V.sub(onHead(H, V.norm([0, 0.1, -1]), 1.05), p), extra: (g, r) => { const c = onHead(H, V.norm([0, 0.1, -1]), 1.12); sphere(g, c[0], c[1], c[2], 0.03, 0.03, 0.025, 8, 6);
    for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; const st = V.add(c, [Math.cos(a) * 0.015, Math.sin(a) * 0.012, -0.01]); const pts = []; for (let k = 0; k <= 7; k++) pts.push(V.add(st, [Math.sin(k * 0.6 + i) * 0.012, -k * 0.045, -0.035 * Math.sin(k / 7 * Math.PI * 0.6) - k * 0.004])); strandTube(g, pts, H, 0.022, 0.006, 0.012, 0.006); } } }),
  bun: (H) => hairStyle(H, { count: 130, thMax: 1.9, len: 0.14, steps: 5, w: 0.036, t: 0.008, seed: 29, k: 1.04, hug: 1, flow: (p) => V.sub(onHead(H, V.norm([0, 0.85, -0.5]), 1.05), p), extra: (g) => { const c = onHead(H, V.norm([0, 0.85, -0.5]), 1.28); for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; sphere(g, c[0] + Math.cos(a) * 0.03, c[1] + Math.sin(a) * 0.02, c[2] + Math.sin(a) * 0.02, 0.03, 0.026, 0.028, 8, 6); } sphere(g, c[0], c[1] + 0.01, c[2], 0.045, 0.04, 0.043, 10, 7); } }),
  braid: (H) => hairStyle(H, { count: 130, thMax: 1.9, len: 0.14, steps: 5, w: 0.036, t: 0.008, seed: 31, k: 1.04, hug: 1, flow: (p) => V.sub(onHead(H, V.norm([0, -0.1, -1]), 1.05), p), extra: (g) => { const c = onHead(H, V.norm([0, -0.1, -1]), 1.1); for (let i = 0; i < 10; i++) { const s2 = i % 2 ? 1 : -1; sphere(g, c[0] + s2 * 0.012, c[1] - i * 0.032, c[2] - 0.02 - i * 0.004, 0.026 - i * 0.0012, 0.022, 0.022, 8, 6); } } }),
  side_long: (H) => hairStyle(H, { count: 170, thMax: 1.95, len: 0.36, steps: 9, w: 0.045, t: 0.011, tip: 0.5, seed: 33, k: 1.07, hug: 1, flow: (p, f, d) => f < 0.3 ? [0.5 + d[0] * 0.3, -1, -0.3] : V.add(down, [0.1, 0, -0.2]), extra: (g) => fringe(g, H, 0.06, false, 1) }),
};
// чёлка: ряд прядей от линии роста волос вниз по лбу
function fringe(g, H, len, split = false, side = 0) { for (let i = 0; i < 11; i++) { const u = (i / 10 - 0.5) * 1.5; if (split && Math.abs(u) < 0.12) continue; const d = V.norm([Math.sin(u) * 0.95, 0.62, Math.cos(u) * 0.8]);
  const st = onHead(H, d, 1.03); const dir = split ? [Math.sign(u) * 0.8, -1, 0.15] : side ? [1, -0.6, 0.1] : [u * 0.3, -1, 0.35]; const pts = path(H, st, () => dir, len, 4, 1.05, 1, true); strandTube(g, pts, H, 0.03, 0.012, 0.009, 0.005); } }
const HAIR_SETS = { m: ['short_messy', 'quiff', 'side_swept', 'spiky', 'slick_back', 'man_bun', 'mohawk', 'afro', 'curly'], f: ['bun', 'braid', 'curly', 'afro'] };
const UBC = { parted: 'Hair_SimpleParted', long: 'Hair_Long', buns: 'Hair_Buns', buzzed: 'Hair_Buzzed', buzzed_f: 'Hair_BuzzedFemale' };
// UBC-причёски: из raw-ресков (bind-мир UAL) → Head-локально, без скина
async function ubcHair(name, file, H) {
  const d = await io.read(file); const prims = [];
  for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) { if (!/hair/i.test(p.getMaterial()?.getName() || '')) continue; prims.push(p); }
  const doc = new Document(); doc.createBuffer(); const mesh = doc.createMesh(name); const buf = doc.getRoot().listBuffers()[0];
  const hm = mat(doc, 'hair', HAIRC, { rough: 0.8 });
  const tex = prims[0]?.getMaterial()?.getBaseColorTexture(); if (tex) hm.setBaseColorTexture(doc.createTexture('hairTex').setImage(tex.getImage()).setMimeType(tex.getMimeType()));
  const n3 = mat4.transpose(mat4.create(), mat4.invert(mat4.create(), H.inv));
  for (const p of prims) { const P = p.getAttribute('POSITION'), N = p.getAttribute('NORMAL'), UV = p.getAttribute('TEXCOORD_0'); const pos = [], nor = [], a = [], nn = [];
    for (let i = 0; i < P.getCount(); i++) { P.getElement(i, a); pos.push(...vec3.transformMat4([], a, H.inv)); N.getElement(i, nn); const r = [0, 1, 2].map(k => n3[k] * nn[0] + n3[4 + k] * nn[1] + n3[8 + k] * nn[2]); const l = Math.hypot(...r) || 1; nor.push(...r.map(v => v / l)); }
    const acc = (t, arr) => doc.createAccessor().setType(t).setArray(arr).setBuffer(buf);
    const q = doc.createPrimitive().setMaterial(hm).setAttribute('POSITION', acc('VEC3', new Float32Array(pos))).setAttribute('NORMAL', acc('VEC3', new Float32Array(nor))).setIndices(acc('SCALAR', new Uint32Array(p.getIndices().getArray())));
    if (UV) q.setAttribute('TEXCOORD_0', acc('VEC2', UV.getArray().slice())); mesh.addPrimitive(q); }
  doc.createScene(name).addChild(doc.createNode(name).setMesh(mesh)); await doc.transform(dedup(), prune()); await io.write(`${OUT}/hair/${name}.glb`, doc); return `hair/${name}.glb`;
}
const META = { hair: {}, acc: {} };
for (const [k, f] of Object.entries(UBC)) if (fs.existsSync(`rig/rawhair_${f}.glb`)) META.hair[k] = { file: await ubcHair(k, `rig/rawhair_${f}.glb`, HM), src: 'Quaternius UBC ' + f, gender: /buns|long|_f/.test(k) ? 'f' : 'u' };
for (const [g, H] of [['m', HM], ['f', HF]]) for (const k of HAIR_SETS[g]) META.hair[`${k}_${g}`] = { file: await write('hair', `${k}_${g}`, PROC_HAIR[k](H), H), src: 'процедурная (пряди)', gender: g };
if (fs.existsSync('rig/rawhair_Hair_Beard.glb')) META.acc.beard = { file: (await ubcHair('beard', 'rig/rawhair_Hair_Beard.glb', HM)).replace('hair/', 'hair/'), src: 'Quaternius UBC Hair_Beard', gender: 'm', slot: 'face' };
// аксессуары
function glassesParts(H, dark) { const g = G(), l = G(); const z = H.zFront + 0.012; const ey = (H.eyeL[1] + H.eyeR[1]) / 2;
  for (const E of [H.eyeL, H.eyeR]) { for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; box(g, E[0] + Math.cos(a) * 0.024, ey + Math.sin(a) * 0.02 - 0.003, z, 0.01, 0.006, 0.005); } cyl(l, E[0], ey, z - 0.002, 0.022, 0.022, 0.003, 14, 'z'); }
  box(g, H.c[0], ey + 0.008, z, Math.abs(H.eyeL[0] - H.eyeR[0]) - 0.04, 0.005, 0.005);
  for (const s of [1, -1]) { const x = H.c[0] + s * (H.e[0] * 1.02); box(g, x, ey + 0.005, (z + H.c[2] - H.e[2] * 0.2) / 2, 0.005, 0.005, z - (H.c[2] - H.e[2] * 0.2)); }
  return [[g, dark ? '#111111' : '#3a3a3a', { name: 'frame', metal: 0.5, rough: 0.3 }], [l, dark ? '#101820' : '#dfeff5', { name: 'lens', alpha: dark ? 0.85 : 0.25, rough: 0.05 }]]; }
const ACC = {
  glasses: (H) => glassesParts(H, false), sunglasses: (H) => glassesParts(H, true),
  cap: (H) => { const s = G(), v = G(); const [cx, cy, cz] = H.c, [ex, ey, ez] = H.e; sphere(s, cx, cy + ey * 0.35, cz, ex * 1.14, ey * 0.85, ez * 1.14, 16, 8, true); box(v, cx, cy + ey * 0.33, cz + ez * 1.35, ex * 1.5, 0.008, ez * 0.9); return [[s, '#2c5aa0', { name: 'accColor' }], [v, '#1f3f73', { name: 'accDark' }]]; },
  beanie: (H) => { const s = G(), b = G(); const [cx, cy, cz] = H.c, [ex, ey, ez] = H.e; sphere(s, cx, cy + ey * 0.25, cz - 0.005, ex * 1.13, ey * 1.0, ez * 1.13, 16, 8, true); cyl(b, cx, cy + ey * 0.2, cz - 0.005, ex * 1.16, ex * 1.16, ey * 0.3, 16); sphere(s, cx, cy + ey * 1.3, cz, ex * 0.25); return [[s, '#b0302a', { name: 'accColor', rough: 1 }], [b, '#8a2420', { name: 'accDark', rough: 1 }]]; },
  straw_hat: (H) => { const s = G(), b = G(); const [cx, cy, cz] = H.c, [ex, ey, ez] = H.e; cyl(s, cx, cy + ey * 0.45, cz, ex * 1.12, ex * 1.0, ey * 0.75, 16); cyl(s, cx, cy + ey * 0.45, cz, ex * 2.3, ex * 2.3, 0.012, 20); cyl(b, cx, cy + ey * 0.47, cz, ex * 1.13, ex * 1.12, ey * 0.2, 16); return [[s, '#e3c77a', { name: 'accColor', rough: 1 }], [b, '#8a2a2a', { name: 'accDark' }]]; },
  top_hat: (H) => { const s = G(), b = G(); const [cx, cy, cz] = H.c, [ex, ey, ez] = H.e; cyl(s, cx, cy + ey * 0.55, cz, ex * 1.05, ex * 1.1, ey * 1.6, 16); cyl(s, cx, cy + ey * 0.55, cz, ex * 1.7, ex * 1.7, 0.012, 20); cyl(b, cx, cy + ey * 0.6, cz, ex * 1.06, ex * 1.06, ey * 0.25, 16); return [[s, '#151515', { name: 'accColor', rough: 0.5 }], [b, '#6a1a1a', { name: 'accDark' }]]; },
  headband: (H) => { const b = G(); const [cx, cy, cz] = H.c, [ex, ey, ez] = H.e; cyl(b, cx, cy + ey * 0.35, cz - 0.004, ex * 1.12, ex * 1.12, ey * 0.2, 18, 'y', false); return [[b, '#e0457a', { name: 'accColor', ds: true }]]; },
  moustache: (H) => { const m = G(); const [cx, cy, cz] = H.c; const y = (H.eyeL[1] + H.eyeR[1]) / 2 - 0.058; for (const s of [-1, 1]) sphere(m, cx + s * 0.02, y, H.zFront - 0.004, 0.024, 0.009, 0.01, 8, 5); return [[m, HAIRC, { name: 'hair', rough: 0.95 }]]; },
  earrings: (H) => { const e = G(); const [cx, cy, cz] = H.c, [ex] = H.e; for (const s of [-1, 1]) sphere(e, cx + s * ex * 1.0, cy - 0.03, cz, 0.008); return [[e, '#d4a83a', { name: 'gold', metal: 0.9, rough: 0.2 }]]; },
};
for (const [k, fn] of Object.entries(ACC)) for (const [g, H] of [['m', HM], ['f', HF]]) META.acc[`${k}_${g}`] = { file: await write('acc', `${k}_${g}`, fn(H), H), src: 'процедурная', gender: g, slot: /glass/.test(k) ? 'eyes' : /moust|beard/.test(k) ? 'face' : /ear/.test(k) ? 'ears' : 'head' };
fs.writeFileSync(`${OUT}/_cas.json`, JSON.stringify(META, null, 1));
console.log('hair', Object.keys(META.hair).length, 'acc', Object.keys(META.acc).length, JSON.stringify({ m: { c: HM.c, e: HM.e }, f: { c: HF.c, e: HF.e } }));
