#!/usr/bin/env node
/* pack-rocks.mjs — Poly Haven CC0 rock scans -> game-ready LOD packs (offline only)
 *
 * Usage
 *   NTOOL=<dir with node_modules: meshoptimizer, sharp>  node tools/pack-rocks.mjs [--only <id>] [--cache <dir>] [--preview <dir>]
 *   (NTOOL defaults to the session scratch ntool dir; --cache/--preview default to <scratch>/rocks/{cache,preview})
 *
 * Output: assets/pack/rock_ph_<id>.js   = (window.__PACK = window.__PACK || {})['rock_ph_<id>'] = '<base64 GLB>';
 *   GLB: metres, Y up, centred on X/Z (bbox centre), lowest vertex at y=0, real-world scan scale.
 *   Nodes LOD0 / LOD1 / LOD2 (scene-root children, identity), one shared material 'rock_ph_<id>':
 *     baseColor 1024² JPEG (scan albedo x mix(1, AO, 0.8), in linear light), normal 1024² JPEG q92-94 (re-baked for LOD0),
 *     metallicRoughness (roughness in G, B=0) 512² JPEG — or no texture + roughnessFactor 0.9 when the scan's map is flat
 *     (std < 0.04; true for all three current scans). JPEG quality steps down until the base64 pack is <= 1.6 MB.
 *   Preview sheets + report.json + raw .glb copies go to --preview.
 *   No extensions, no occlusionTexture, no tangents (three.js derivative tangent frame).
 *
 * Steps
 *   1. Download (cached) <id> glTF 2k (+ .bin, diff/nor_gl/arm 2k JPEGs) and api.polyhaven.com/info/<id> (authors, CC0).
 *   2. Re-centre. Simplify with meshoptimizer simplifyWithAttributes (normals + UVs weighted; Blender glTF export splits
 *      vertices at UV seams with bit-identical positions, which meshopt detects as seams and keeps crack-free).
 *      Kept vertices keep their original UVs; LOD normals are recomputed (area-weighted, welded by position).
 *   3. Normal re-bake by UV correspondence (simplification keeps the UV parametrisation), at 2048² then box-down to 1024²:
 *      a. rasterise HIGH triangles in UV space; per texel: object-space normal = decode(original map texel) in the
 *         high triangle's tangent frame (interpolated high normal N);
 *      b. flood-fill that object-space normal image so LOD0 texels just outside the high islands get a value;
 *      c. rasterise LOD0 triangles in UV space; per texel: encode the object-space normal in LOD0's frame.
 *      Tangent frame = exactly three.js getTangentFrame() (normalmap_pars_fragment) evaluated with the triangle's
 *      edge vectors as the "screen derivatives": T = N x (e1*du2 - e2*du1), B = N x (e1*dv2 - e2*dv1), both scaled by
 *      1/sqrt(max(|T|²,|B|²)); GLTFLoader negates normalScale.y for derivative tangents, so the matrix columns are
 *      (T, -B, N). Encoding solves m = M^-1 n and normalises m (normalize(M·k·m) == n for any k>0, so this is exact).
 *      Self-test: bake HIGH against itself (must return the original map up to 8-bit noise).
 *      Result + albedo are flood-filled past island edges (whole atlas -> ≥8 texels of dilation).
 *   4. Preview (--preview): orthographic software renders (screen-space derivative tangent frame, a literal port of the
 *      three.js shader, i.e. independent of the bake code path) + texture strip, written as PNG contact sheet.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = '/private/tmp/claude-501/-Users-egurvanov-python-game/3ac62e05-9ef3-4c31-b5ce-81ea763a04f5/scratchpad';
const NTOOL = process.env.NTOOL || path.join(SCRATCH, 'ntool');
const req = createRequire(path.join(NTOOL, 'package.json'));
const sharp = req('sharp');
const { MeshoptSimplifier } = await import(pathToFileURL(path.join(NTOOL, 'node_modules/meshoptimizer/index.js')).href);
await MeshoptSimplifier.ready;

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const CACHE = arg('--cache', path.join(SCRATCH, 'rocks/cache'));
const PREVIEW = arg('--preview', path.join(SCRATCH, 'rocks/preview'));
const ONLY = arg('--only', null);
const OUTP = path.join(ROOT, 'assets/pack');

const ROCKS = [
  { id: 'rock_09', lod: [4500, 1350, 380] },
  { id: 'rock_07', lod: [4500, 1350, 380] },
  { id: 'namaqualand_boulder_06', lod: [4800, 1450, 420] },
];
const BAKE = 2048, OUT = 1024, ROUGH = 512;
const AO_STRENGTH = 0.8, ROUGH_FLAT_STD = 0.04, PACK_MAX = 1.6e6;

// ---------------------------------------------------------------- download
async function fetchCached(url, file, json = false) {
  if (!fs.existsSync(file)) {
    const r = await fetch(url, { headers: { 'User-Agent': 'game-pack-rocks/1.0' } });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  const b = fs.readFileSync(file);
  return json ? JSON.parse(b.toString()) : b;
}
async function download(id) {
  const dir = path.join(CACHE, id);
  const info = await fetchCached(`https://api.polyhaven.com/info/${id}`, path.join(dir, 'info.json'), true);
  const files = await fetchCached(`https://api.polyhaven.com/files/${id}`, path.join(dir, 'files.json'), true);
  const g = files.gltf['2k'].gltf;
  const gltf = await fetchCached(g.url, path.join(dir, id + '.gltf'), true);
  const inc = {};
  for (const [rel, f] of Object.entries(g.include)) inc[rel] = await fetchCached(f.url, path.join(dir, rel));
  return { info, gltf, inc };
}

// ---------------------------------------------------------------- glTF read
function readAccessor(gltf, inc, ai) {
  const a = gltf.accessors[ai], bv = gltf.bufferViews[a.bufferView];
  const buf = inc[gltf.buffers[bv.buffer].uri];
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
  const stride = bv.byteStride || n * T.BYTES_PER_ELEMENT;
  const out = new T(a.count * n), off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const dv = new DataView(buf.buffer, buf.byteOffset);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) {
    const o = off + i * stride + k * T.BYTES_PER_ELEMENT;
    out[i * n + k] = T === Float32Array ? dv.getFloat32(o, true) : T === Uint32Array ? dv.getUint32(o, true) : T === Uint16Array ? dv.getUint16(o, true) : dv.getUint8(o);
  }
  return out;
}
function loadHigh(gltf, inc) {
  if (gltf.meshes.length !== 1 || gltf.meshes[0].primitives.length !== 1) throw new Error('expected one primitive');
  const nd = gltf.nodes.find((n) => n.mesh === 0);
  if (nd.matrix || nd.rotation || nd.scale || nd.translation) throw new Error('node transform not supported');
  const pr = gltf.meshes[0].primitives[0];
  const pos = readAccessor(gltf, inc, pr.attributes.POSITION);
  const nrm = readAccessor(gltf, inc, pr.attributes.NORMAL);
  const uv = readAccessor(gltf, inc, pr.attributes.TEXCOORD_0);
  const idx = Uint32Array.from(readAccessor(gltf, inc, pr.indices));
  const imgOf = (t) => inc[gltf.images[gltf.textures[t.index].source].uri];
  const m = gltf.materials[pr.material];
  return { pos, nrm, uv, idx, img: { nor: imgOf(m.normalTexture), diff: imgOf(m.pbrMetallicRoughness.baseColorTexture), arm: imgOf(m.pbrMetallicRoughness.metallicRoughnessTexture) } };
}
function recentre(pos) {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i + k]); mx[k] = Math.max(mx[k], pos[i + k]); }
  const s = [-(mn[0] + mx[0]) / 2, -mn[1], -(mn[2] + mx[2]) / 2];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) pos[i + k] += s[k];
  return [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
}

// ---------------------------------------------------------------- LODs
function simplify(high, targetTris) {
  const nv = high.pos.length / 3, attr = new Float32Array(nv * 5);
  for (let i = 0; i < nv; i++) { attr.set(high.nrm.subarray(i * 3, i * 3 + 3), i * 5); attr[i * 5 + 3] = high.uv[i * 2]; attr[i * 5 + 4] = high.uv[i * 2 + 1]; }
  const [ix, err] = MeshoptSimplifier.simplifyWithAttributes(high.idx, high.pos, 3, attr, 5, [0.5, 0.5, 0.5, 1.5, 1.5], null, targetTris * 3, 1.0, []);
  // compact: keep original vertex data of retained vertices
  const map = new Int32Array(nv).fill(-1); let c = 0;
  const idx = new Uint32Array(ix.length);
  for (let i = 0; i < ix.length; i++) { if (map[ix[i]] < 0) map[ix[i]] = c++; idx[i] = map[ix[i]]; }
  const pos = new Float32Array(c * 3), uv = new Float32Array(c * 2);
  for (let v = 0; v < nv; v++) if (map[v] >= 0) { pos.set(high.pos.subarray(v * 3, v * 3 + 3), map[v] * 3); uv.set(high.uv.subarray(v * 2, v * 2 + 2), map[v] * 2); }
  const m = { pos, uv, idx, nrm: smoothNormals(pos, idx), err };
  return m;
}
function smoothNormals(pos, idx) {
  const nv = pos.length / 3, key = new Map(), grp = new Int32Array(nv);
  for (let v = 0; v < nv; v++) { const k = pos[v * 3] + ',' + pos[v * 3 + 1] + ',' + pos[v * 3 + 2]; if (!key.has(k)) key.set(k, key.size); grp[v] = key.get(k); }
  const acc = new Float64Array(key.size * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    const n = cross(e1, e2); // |n| = 2*area -> area weighted
    for (const v of [idx[t], idx[t + 1], idx[t + 2]]) for (let k = 0; k < 3; k++) acc[grp[v] * 3 + k] += n[k];
  }
  const out = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) { const g = grp[v] * 3, l = Math.hypot(acc[g], acc[g + 1], acc[g + 2]) || 1; for (let k = 0; k < 3; k++) out[v * 3 + k] = acc[g + k] / l; }
  return out;
}
function checkSeams(m) { // open boundary edge count, by welded positions (cracks would show up as new open edges)
  const nv = m.pos.length / 3, key = new Map(), grp = new Int32Array(nv);
  for (let v = 0; v < nv; v++) { const k = m.pos[v * 3] + ',' + m.pos[v * 3 + 1] + ',' + m.pos[v * 3 + 2]; if (!key.has(k)) key.set(k, key.size); grp[v] = key.get(k); }
  const e = new Map();
  for (let t = 0; t < m.idx.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = grp[m.idx[t + k]], b = grp[m.idx[t + (k + 1) % 3]], kk = a < b ? a + '_' + b : b + '_' + a;
    e.set(kk, (e.get(kk) || 0) + 1);
  }
  let open = 0; for (const c of e.values()) if (c === 1) open++;
  return open;
}

// ---------------------------------------------------------------- math
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

// three.js getTangentFrame with triangle edges as screen derivatives (front-facing => positive Jacobian).
// Returns matrix columns [T*s, -B*s, N] (the -B is GLTFLoader's normalScale.y = -1).
function frameCols(gu, gv, N) {
  const T = cross(N, gu), B = cross(N, gv);
  const det = Math.max(dot(T, T), dot(B, B)), s = det === 0 ? 0 : 1 / Math.sqrt(det);
  return [[T[0] * s, T[1] * s, T[2] * s], [-B[0] * s, -B[1] * s, -B[2] * s], N];
}
function triGrads(m, t) {
  const a = m.idx[t], b = m.idx[t + 1], c = m.idx[t + 2], P = m.pos, U = m.uv;
  const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
  const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
  const du1 = U[b * 2] - U[a * 2], du2 = U[c * 2] - U[a * 2], dv1 = U[b * 2 + 1] - U[a * 2 + 1], dv2 = U[c * 2 + 1] - U[a * 2 + 1];
  return { gu: [e1[0] * du2 - e2[0] * du1, e1[1] * du2 - e2[1] * du1, e1[2] * du2 - e2[2] * du1], gv: [e1[0] * dv2 - e2[0] * dv1, e1[1] * dv2 - e2[1] * dv1, e1[2] * dv2 - e2[2] * dv1] };
}
function solve3(c0, c1, c2, n) { // [c0 c1 c2] x = n
  const d = dot(c0, cross(c1, c2));
  if (Math.abs(d) < 1e-12) return null;
  return [dot(n, cross(c1, c2)) / d, dot(c0, cross(n, c2)) / d, dot(c0, cross(c1, n)) / d];
}

// rasterise triangle t of mesh m into UV space of a WxW image; cb(texelIndex, b0, b1, b2)
function rasterUV(m, t, W, cb) {
  const a = m.idx[t], b = m.idx[t + 1], c = m.idx[t + 2], U = m.uv;
  const x0 = U[a * 2] * W, y0 = U[a * 2 + 1] * W, x1 = U[b * 2] * W, y1 = U[b * 2 + 1] * W, x2 = U[c * 2] * W, y2 = U[c * 2 + 1] * W;
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(area) < 1e-12) return;
  const minx = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxx = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
  const miny = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxy = Math.min(W - 1, Math.ceil(Math.max(y0, y1, y2)));
  const eps = -1e-7;
  for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
    const px = x + 0.5, py = y + 0.5;
    const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
    const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
    const w2 = 1 - w0 - w1;
    if (w0 >= eps && w1 >= eps && w2 >= eps) cb(y * W + x, w0, w1, w2);
  }
}
function interpN(m, t, w0, w1, w2) {
  const a = m.idx[t] * 3, b = m.idx[t + 1] * 3, c = m.idx[t + 2] * 3, N = m.nrm;
  return norm([N[a] * w0 + N[b] * w1 + N[c] * w2, N[a + 1] * w0 + N[b + 1] * w1 + N[c + 1] * w2, N[a + 2] * w0 + N[b + 2] * w1 + N[c + 2] * w2]);
}

// multi-source BFS flood fill of an image with C float channels, from texels where mask=1
function floodFill(img, mask, W, C) {
  const src = new Int32Array(W * W).fill(-1), q = new Int32Array(W * W); let h = 0, tl = 0;
  for (let i = 0; i < W * W; i++) if (mask[i]) { src[i] = i; q[tl++] = i; }
  if (!tl) return;
  while (h < tl) {
    const i = q[h++], x = i % W, y = (i / W) | 0;
    const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < W - 1 ? i + W : -1];
    for (const j of nb) if (j >= 0 && src[j] < 0) { src[j] = src[i]; q[tl++] = j; }
  }
  for (let i = 0; i < W * W; i++) if (!mask[i]) for (let k = 0; k < C; k++) img[i * C + k] = img[src[i] * C + k];
}
function boxDown(img, W, C, f) { // f x f box filter
  const w = W / f, out = new Float32Array(w * w * C);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) for (let k = 0; k < C; k++) {
    let s = 0; for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += img[((y * f + j) * W + x * f + i) * C + k];
    out[(y * w + x) * C + k] = s / (f * f);
  }
  return out;
}
async function loadRaw(buf, W) {
  const { data, info } = await sharp(buf).resize(W, W, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== W || info.channels !== 3) throw new Error('bad image');
  return data;
}

// ---------------------------------------------------------------- bake
// decodes the original map on `src` mesh -> object-space normal image; encodes it in `dst` frames.
function bakeObjectNormals(src, norMap, W) {
  const obj = new Float32Array(W * W * 3), mask = new Uint8Array(W * W), orig = new Float32Array(W * W * 3);
  for (let t = 0; t < src.idx.length; t += 3) {
    const { gu, gv } = triGrads(src, t);
    rasterUV(src, t, W, (i, w0, w1, w2) => {
      const N = interpN(src, t, w0, w1, w2), [c0, c1, c2] = frameCols(gu, gv, N);
      const mx = norMap[i * 3] / 127.5 - 1, my = norMap[i * 3 + 1] / 127.5 - 1, mz = norMap[i * 3 + 2] / 127.5 - 1;
      const n = norm([c0[0] * mx + c1[0] * my + c2[0] * mz, c0[1] * mx + c1[1] * my + c2[1] * mz, c0[2] * mx + c1[2] * my + c2[2] * mz]);
      obj.set(n, i * 3); mask[i] = 1;
    });
  }
  for (let i = 0; i < W * W; i++) orig.set(norm([norMap[i * 3] / 127.5 - 1, norMap[i * 3 + 1] / 127.5 - 1, norMap[i * 3 + 2] / 127.5 - 1]), i * 3);
  return { obj, mask, orig };
}
function encodeTangent(dst, obj, W) {
  const out = new Float32Array(W * W * 3), mask = new Uint8Array(W * W); let neg = 0, cnt = 0;
  for (let t = 0; t < dst.idx.length; t += 3) {
    const { gu, gv } = triGrads(dst, t);
    rasterUV(dst, t, W, (i, w0, w1, w2) => {
      const N = interpN(dst, t, w0, w1, w2), [c0, c1, c2] = frameCols(gu, gv, N);
      let m = solve3(c0, c1, c2, [obj[i * 3], obj[i * 3 + 1], obj[i * 3 + 2]]);
      m = m ? norm(m) : [0, 0, 1];
      if (m[2] < 0) neg++;
      cnt += mask[i] ? 0 : 1;
      out.set(m, i * 3); mask[i] = 1;
    });
  }
  return { out, mask, neg, cnt };
}
const angleStats = (a, b, mask, W) => {
  let s = 0, n = 0; const hist = [];
  for (let i = 0; i < W * W; i++) if (mask[i]) {
    const d = Math.acos(Math.max(-1, Math.min(1, dot(norm([a[i * 3], a[i * 3 + 1], a[i * 3 + 2]]), [b[i * 3], b[i * 3 + 1], b[i * 3 + 2]])))) * 180 / Math.PI;
    s += d; n++; hist.push(d);
  }
  hist.sort((x, y) => x - y);
  return { mean: s / n, p50: hist[(n * 0.5) | 0], p95: hist[(n * 0.95) | 0], n };
};

// ---------------------------------------------------------------- GLB
function buildGlb(name, lods, images, mat, extras) {
  const chunks = []; let off = 0;
  const json = { asset: { version: '2.0', generator: 'tools/pack-rocks.mjs', extras }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], textures: [], images: [], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }], accessors: [], bufferViews: [], buffers: [] };
  const view = (buf, target) => {
    const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; }
    json.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: b.length, ...(target ? { target } : {}) });
    chunks.push(b); off += b.length; return json.bufferViews.length - 1;
  };
  const acc = (arr, type, ct, target, mm) => {
    const n = { VEC3: 3, VEC2: 2, SCALAR: 1 }[type], a = { bufferView: view(arr, target), componentType: ct, count: arr.length / n, type };
    if (mm) { a.min = [0, 1, 2].map((k) => Math.min(...Array.from({ length: a.count }, (_, i) => arr[i * 3 + k]))); a.max = [0, 1, 2].map((k) => Math.max(...Array.from({ length: a.count }, (_, i) => arr[i * 3 + k]))); }
    json.accessors.push(a); return json.accessors.length - 1;
  };
  for (const im of images) { json.images.push({ name: im.name, mimeType: im.mime, bufferView: view(im.data) }); json.textures.push({ sampler: 0, source: json.images.length - 1 }); }
  json.materials.push(mat);
  lods.forEach((m, li) => {
    const idx = m.pos.length / 3 < 65536 ? Uint16Array.from(m.idx) : m.idx;
    const prim = { attributes: { POSITION: acc(m.pos, 'VEC3', 5126, 34962, true), NORMAL: acc(m.nrm, 'VEC3', 5126, 34962), TEXCOORD_0: acc(m.uv, 'VEC2', 5126, 34962) }, indices: acc(idx, 'SCALAR', idx instanceof Uint16Array ? 5123 : 5125, 34963), material: 0 };
    json.meshes.push({ name: `${name}_LOD${li}`, primitives: [prim] });
    json.nodes.push({ name: `LOD${li}`, mesh: li }); json.scenes[0].nodes.push(li);
  });
  const bin = Buffer.concat(chunks); const binP = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  json.buffers.push({ byteLength: binP.length });
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const glb = Buffer.alloc(12 + 8 + js.length + 8 + binP.length);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(js.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); js.copy(glb, 20);
  glb.writeUInt32LE(binP.length, 20 + js.length); glb.writeUInt32LE(0x004e4942, 24 + js.length); binP.copy(glb, 28 + js.length);
  return glb;
}

// ---------------------------------------------------------------- preview renderer (independent tangent frame path)
// Orthographic, screen y up, literal port of three.js getTangentFrame with per-triangle screen derivatives of
// view-space position and uv, mapN.y *= -1 (GLTFLoader), Lambert. tex: {nor:Uint8 WxW*3, W, alb?:Uint8}
function render(m, tex, opt) {
  const S = opt.size, img = new Float32Array(S * S * 3).fill(opt.bg ?? 0.12), zb = new Float32Array(S * S).fill(-Infinity);
  const cy = Math.cos(opt.yaw), sy = Math.sin(opt.yaw), cp = Math.cos(opt.pitch), sp = Math.sin(opt.pitch);
  const toView = (x, y, z) => { const x1 = cy * x + sy * z, z1 = -sy * x + cy * z; return [x1, cp * y - sp * z1, sp * y + cp * z1]; };
  const nv = m.pos.length / 3, V = new Float32Array(nv * 3), NV = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const q = toView(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]); q[0] -= opt.fit[0]; q[1] -= opt.fit[1]; V.set(q, v * 3);
    NV.set(toView(m.nrm[v * 3], m.nrm[v * 3 + 1], m.nrm[v * 3 + 2]), v * 3);
  }
  const sc = S * 0.92 / opt.fit[2], L = norm(opt.light);
  const sample = (u, v) => { // bilinear, repeat
    const W = tex.W, x = u * W - 0.5, y = v * W - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const r = [0, 0, 0, 0, 0, 0];
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const w = (i ? fx : 1 - fx) * (j ? fy : 1 - fy), xi = ((x0 + i) % W + W) % W, yi = ((y0 + j) % W + W) % W, o = (yi * W + xi) * 3;
      for (let k = 0; k < 3; k++) { r[k] += w * tex.nor[o + k]; if (tex.alb) r[3 + k] += w * tex.alb[o + k]; }
    }
    return r;
  };
  for (let t = 0; t < m.idx.length; t += 3) {
    const ids = [m.idx[t], m.idx[t + 1], m.idx[t + 2]];
    const p = ids.map((v) => [V[v * 3] * sc + S / 2, V[v * 3 + 1] * sc + S / 2, V[v * 3 + 2]]);
    const area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
    if (area <= 0) continue; // back face (CCW = front, y up)
    // screen derivatives: d(attr)/dx, d(attr)/dy for linear attr over the triangle
    const grad = (f0, f1, f2) => [((f1 - f0) * (p[2][1] - p[0][1]) - (f2 - f0) * (p[1][1] - p[0][1])) / area, ((f2 - f0) * (p[1][0] - p[0][0]) - (f1 - f0) * (p[2][0] - p[0][0])) / area];
    const q0 = [0, 0, 0], q1 = [0, 0, 0];
    for (let k = 0; k < 3; k++) { const g = grad(V[ids[0] * 3 + k], V[ids[1] * 3 + k], V[ids[2] * 3 + k]); q0[k] = g[0]; q1[k] = g[1]; }
    const gU = grad(m.uv[ids[0] * 2], m.uv[ids[1] * 2], m.uv[ids[2] * 2]), gV = grad(m.uv[ids[0] * 2 + 1], m.uv[ids[1] * 2 + 1], m.uv[ids[2] * 2 + 1]);
    const st0 = [gU[0], gV[0]], st1 = [gU[1], gV[1]];
    const minx = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0]))), maxx = Math.min(S - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])));
    const miny = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1]))), maxy = Math.min(S - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])));
    for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((p[1][0] - px) * (p[2][1] - py) - (p[2][0] - px) * (p[1][1] - py)) / area;
      const w1 = ((p[2][0] - px) * (p[0][1] - py) - (p[0][0] - px) * (p[2][1] - py)) / area, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * p[0][2] + w1 * p[1][2] + w2 * p[2][2];
      const pi = (S - 1 - y) * S + x; if (z <= zb[pi]) continue; zb[pi] = z;
      let N = norm([0, 1, 2].map((k) => w0 * NV[ids[0] * 3 + k] + w1 * NV[ids[1] * 3 + k] + w2 * NV[ids[2] * 3 + k]));
      const u = w0 * m.uv[ids[0] * 2] + w1 * m.uv[ids[1] * 2] + w2 * m.uv[ids[2] * 2], v = w0 * m.uv[ids[0] * 2 + 1] + w1 * m.uv[ids[1] * 2 + 1] + w2 * m.uv[ids[2] * 2 + 1];
      const s = tex ? sample(u, v) : null;
      if (tex && tex.nor) {
        const q1perp = cross(q1, N), q0perp = cross(N, q0);
        const T = [0, 1, 2].map((k) => q1perp[k] * st0[0] + q0perp[k] * st1[0]), B = [0, 1, 2].map((k) => q1perp[k] * st0[1] + q0perp[k] * st1[1]);
        const det = Math.max(dot(T, T), dot(B, B)), scl = det === 0 ? 0 : 1 / Math.sqrt(det);
        const mx = s[0] / 127.5 - 1, my = -(s[1] / 127.5 - 1), mz = s[2] / 127.5 - 1;
        N = norm([0, 1, 2].map((k) => T[k] * scl * mx + B[k] * scl * my + N[k] * mz));
      }
      const d = Math.max(0, dot(N, L)) * 0.8 + 0.06;
      for (let k = 0; k < 3; k++) img[pi * 3 + k] = tex && tex.alb && opt.albedo ? s2l(s[3 + k] / 255) * d * 2.5 : d * 0.45;
    }
  }
  const out = Buffer.alloc(S * S * 3);
  for (let i = 0; i < S * S * 3; i++) out[i] = Math.round(Math.max(0, Math.min(1, l2s(img[i]))) * 255);
  return out;
}
const tris = (m) => m.idx.length / 3;

// ---------------------------------------------------------------- main
fs.mkdirSync(PREVIEW, { recursive: true });
const report = [];
for (const R of ROCKS) {
  if (ONLY && R.id !== ONLY) continue;
  const name = 'rock_ph_' + R.id, t0 = Date.now();
  const { info, gltf, inc } = await download(R.id);
  const high = loadHigh(gltf, inc);
  const size = recentre(high.pos);
  const lods = R.lod.map((n) => simplify(high, n));
  const openHigh = checkSeams(high), openLod = lods.map(checkSeams);

  // textures at bake resolution
  const nor2 = await loadRaw(high.img.nor, BAKE), diff2 = await loadRaw(high.img.diff, BAKE), arm2 = await loadRaw(high.img.arm, BAKE);

  // normal bake
  const hi = bakeObjectNormals(high, nor2, BAKE);
  const self = encodeTangent(high, hi.obj, BAKE);
  const selfErr = angleStats(self.out, hi.orig, self.mask, BAKE);
  const objF = Float32Array.from(hi.obj); floodFill(objF, hi.mask, BAKE, 3);
  const lo = encodeTangent(lods[0], objF, BAKE);
  const lodDiff = angleStats(lo.out, hi.orig, lo.mask, BAKE);
  const outsideHigh = (() => { let n = 0; for (let i = 0; i < BAKE * BAKE; i++) if (lo.mask[i] && !hi.mask[i]) n++; return n; })();
  floodFill(lo.out, lo.mask, BAKE, 3);
  const nOut = boxDown(lo.out, BAKE, 3, BAKE / OUT);
  const norBytes = Buffer.alloc(OUT * OUT * 3);
  for (let i = 0; i < OUT * OUT; i++) { const n = norm([nOut[i * 3], nOut[i * 3 + 1], nOut[i * 3 + 2]]); for (let k = 0; k < 3; k++) norBytes[i * 3 + k] = Math.round((n[k] * 0.5 + 0.5) * 255); }

  // albedo x AO (linear), roughness stats, mask = union of high and LOD0 coverage
  const cov = new Uint8Array(BAKE * BAKE); for (let i = 0; i < cov.length; i++) cov[i] = hi.mask[i] | lo.mask[i];
  const alb = new Float32Array(BAKE * BAKE * 3); const meanS = [0, 0, 0], meanA = [0, 0, 0]; let nc = 0, rs = 0, rs2 = 0;
  for (let i = 0; i < BAKE * BAKE; i++) {
    const ao = arm2[i * 3] / 255, f = 1 - AO_STRENGTH * (1 - ao);
    for (let k = 0; k < 3; k++) alb[i * 3 + k] = s2l(diff2[i * 3 + k] / 255) * f;
    if (cov[i]) { nc++; for (let k = 0; k < 3; k++) { meanS[k] += diff2[i * 3 + k]; meanA[k] += l2s(alb[i * 3 + k]) * 255; } const r = arm2[i * 3 + 1] / 255; rs += r; rs2 += r * r; }
  }
  floodFill(alb, cov, BAKE, 3);
  const aOut = boxDown(alb, BAKE, 3, BAKE / OUT), albBytes = Buffer.alloc(OUT * OUT * 3);
  for (let i = 0; i < aOut.length; i++) albBytes[i] = Math.round(l2s(aOut[i]) * 255);
  const rMean = rs / nc, rStd = Math.sqrt(Math.max(0, rs2 / nc - rMean * rMean));
  const roughFlat = rStd < ROUGH_FLAT_STD;

  const jpg = (buf, W, q) => sharp(buf, { raw: { width: W, height: W, channels: 3 } }).jpeg({ quality: q, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer();
  // texture qualities: step down (normal q>=92 first, then albedo) until the base64 pack fits PACK_MAX
  let roughImg = null;
  if (!roughFlat) {
    const r2 = Buffer.alloc(ROUGH * ROUGH * 3), rf = new Float32Array(BAKE * BAKE * 3);
    for (let i = 0; i < BAKE * BAKE; i++) { const r = arm2[i * 3 + 1]; rf[i * 3] = r; rf[i * 3 + 1] = r; rf[i * 3 + 2] = 0; }
    floodFill(rf, cov, BAKE, 3); const rd = boxDown(rf, BAKE, 3, BAKE / ROUGH);
    for (let i = 0; i < rd.length; i++) r2[i] = Math.round(rd[i]);
    roughImg = { name: name + '_rough', mime: 'image/jpeg', data: await jpg(r2, ROUGH, 85) };
  }
  const mat = { name, doubleSided: false, normalTexture: { index: 1 }, pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: roughFlat ? 0.9 : 1, ...(roughFlat ? {} : { metallicRoughnessTexture: { index: 2 } }) } };
  const extras = { source: `https://polyhaven.com/a/${R.id}`, license: 'CC0', authors: info.authors, sizeM: size.map((v) => +v.toFixed(3)) };
  const QS = [[86, 94], [86, 93], [86, 92], [82, 92], [78, 92], [74, 92]];
  let glb, images, packStr, q;
  for (q of QS) {
    images = [{ name: name + '_albedo', mime: 'image/jpeg', data: await jpg(albBytes, OUT, q[0]) }, { name: name + '_normal', mime: 'image/jpeg', data: await jpg(norBytes, OUT, q[1]) }];
    if (roughImg) images.push(roughImg);
    glb = buildGlb(name, lods, images, mat, extras);
    packStr = `(window.__PACK = window.__PACK || {})['${name}'] = '${glb.toString('base64')}';\n`;
    if (packStr.length <= PACK_MAX) break;
  }
  fs.writeFileSync(path.join(OUTP, name + '.js'), packStr);
  fs.writeFileSync(path.join(PREVIEW, name + '.glb'), glb);

  // ---- preview sheet
  const T = 256, P = +arg('--psize', 320), dec = async (b, W) => (await sharp(b).resize(W, W).removeAlpha().raw().toBuffer());
  const origNor1k = await loadRaw(high.img.nor, OUT);
  const shipNor = await sharp(images[1].data).raw().toBuffer(), shipAlb = await sharp(images[0].data).raw().toBuffer(); // what the GLB carries
  const fitOf = (yaw, pitch) => { // centre + extent of HIGH in this view
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), mn = [1e9, 1e9], mx = [-1e9, -1e9];
    for (let v = 0; v < high.pos.length; v += 3) { const x = high.pos[v], y = high.pos[v + 1], z = high.pos[v + 2], x1 = cy * x + sy * z, z1 = -sy * x + cy * z, q = [x1, cp * y - sp * z1];
      for (let k = 0; k < 2; k++) { mn[k] = Math.min(mn[k], q[k]); mx[k] = Math.max(mx[k], q[k]); } }
    return [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, Math.max(mx[0] - mn[0], mx[1] - mn[1])];
  };
  const views = [{ yaw: 0.6, pitch: 0.35 }, { yaw: 2.6, pitch: 0.2 }];
  const renders = [];
  for (const vw of views) {
    const o = { size: P, fit: fitOf(vw.yaw, vw.pitch), light: [-0.5, 0.7, 0.6], ...vw };
    renders.push(['HIGH + orig map', render(high, { nor: origNor1k, W: OUT }, o)]);
    renders.push(['LOD0 + REBAKED', render(lods[0], { nor: shipNor, W: OUT }, o)]);
    renders.push(['LOD0 + orig map', render(lods[0], { nor: origNor1k, W: OUT }, o)]);
    renders.push(['LOD0 no map', render(lods[0], null, o)]);
    renders.push(['LOD2 + rebaked', render(lods[2], { nor: shipNor, W: OUT }, o)]);
    renders.push(['LOD0 albedo', render(lods[0], { nor: shipNor, alb: shipAlb, W: OUT }, { ...o, albedo: true })]);
  }
  // quantitative: shading difference vs HIGH (view 0)
  const shadeDiff = (a, b) => { let s = 0, n = 0; for (let i = 0; i < a.length; i += 3) if (a[i] !== b[i] || a[i] > 40) { s += Math.abs(a[i] - b[i]); n++; } return +(s / n).toFixed(2); };
  const sd = { baked: shadeDiff(renders[0][1], renders[1][1]), origOnLod0: shadeDiff(renders[0][1], renders[2][1]), noMap: shadeDiff(renders[0][1], renders[3][1]) };
  const strip = [['albedo x AO', await dec(await jpg(albBytes, OUT, 86), T)], ['orig normal', await dec(high.img.nor, T)], ['rebaked normal', await dec(await jpg(norBytes, OUT, 94), T)]];
  const W = Math.max(6 * P, 3 * (T + 8)), H = 24 + T + 2 * (P + 18);
  const comp = [];
  const lbl = (txt, x, y) => ({ input: Buffer.from(`<svg width="${P}" height="18"><text x="4" y="13" font-family="Helvetica" font-size="13" fill="#ddd">${txt}</text></svg>`), left: x, top: y });
  comp.push({ input: Buffer.from(`<svg width="${W}" height="22"><text x="6" y="16" font-family="Helvetica" font-size="15" fill="#fff">${name}  ${size.map((v) => v.toFixed(2)).join(' x ')} m   LOD ${lods.map(tris).join('/')} tris   self-test ${selfErr.mean.toFixed(2)}°   rebaked-vs-orig ${lodDiff.mean.toFixed(2)}°   shade diff vs HIGH: baked ${sd.baked} / orig ${sd.origOnLod0} / none ${sd.noMap}</text></svg>`), left: 0, top: 0 });
  strip.forEach(([t, b], i) => { comp.push({ input: b, raw: { width: T, height: T, channels: 3 }, left: i * (T + 8), top: 24 }); comp.push(lbl(t, i * (T + 8), 24 + T - 18)); });
  renders.forEach(([t, b], i) => { const x = (i % 6) * P, y = 24 + T + ((i / 6) | 0) * (P + 18); comp.push({ input: b, raw: { width: P, height: P, channels: 3 }, left: x, top: y + 18 }); comp.push(lbl(t, x, y)); });
  await sharp({ create: { width: W, height: H, channels: 3, background: '#202020' } }).composite(comp).png().toFile(path.join(PREVIEW, name + '_sheet.png'));

  const r = {
    name, sizeM: size.map((v) => +v.toFixed(3)), dims_api_mm: info.dimensions.map((v) => +v.toFixed(0)), authors: info.authors,
    tris: { high: tris(high), lod: lods.map(tris) }, verts: lods.map((m) => m.pos.length / 3), simplifyErr: lods.map((m) => +m.err.toFixed(4)),
    openEdges: { high: openHigh, lod: openLod },
    selfTestDeg: { mean: +selfErr.mean.toFixed(3), p95: +selfErr.p95.toFixed(3) }, lod0VsOrigDeg: { mean: +lodDiff.mean.toFixed(2), p50: +lodDiff.p50.toFixed(2), p95: +lodDiff.p95.toFixed(2) },
    lod0TexelsOutsideHighIslands: outsideHigh, negZ: lo.neg, shadeDiffVsHigh: sd,
    albedoMeanSRGB: meanS.map((v) => Math.round(v / nc)), albedoAOMeanSRGB: meanA.map((v) => Math.round(v / nc)),
    roughness: { mean: +rMean.toFixed(3), std: +rStd.toFixed(3), texture: !roughFlat },
    jpegQ: { albedo: q[0], normal: q[1] }, bytes: { glb: glb.length, pack: packStr.length, images: images.map((i) => i.data.length) }, sec: (Date.now() - t0) / 1000,
  };
  console.log(JSON.stringify(r));
  report.push(r);
}
fs.writeFileSync(path.join(PREVIEW, 'report.json'), JSON.stringify(report, null, 1));
process.exit(0);
