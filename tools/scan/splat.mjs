#!/usr/bin/env node
/* tools/scan/splat.mjs — Gaussian splat scans (Scaniverse .spz / .ply, 3DGS .ply, antimatter .splat) → compact game asset.
 *
 *   node tools/scan/splat.mjs <file.spz|.ply|.splat> [options]      (import.mjs calls this for splat files)
 *
 * Steps: decode → level (RANSAC ground plane → +Y) or --up axis → crop (auto: the object standing on the plane + a rim of
 * ground) → floaters (opacity, oversize, isolated voxels) → scale (--height / --scale; Scaniverse is metric) → base y=0 →
 * budget (--max, keeps the most visible splats) → SH truncation (--sh) → delight (normal = shortest splat axis, same
 * order-1 fit as the mesh path) + night grade from style.js → SPZ v2 (gzip) → base64 JS chunks.
 *
 * Output: <out>/<name>/<name>.spz.<i>.js (chunks ≤ --chunk MB, key '<name>#<i>'), <name>.json (count, bytes, bounds, chunks).
 * Load: tools/scan/scan-splat.js → ScanSplat.load(name, base) → Uint8Array (SPZ) → Spark SplatMesh({ fileBytes }) or
 *       ScanSplat.decodeSpz() for any other renderer. Viewer / benchmark: tools/scan/splat-test.html, splat-bench.mjs.
 *
 * Options
 *   --out DIR  --name N  --role R (rock|wood|ice|snow|masonry|metal|prop)
 *   --up auto|y|-y|x|-x|z|-z   auto (default) = RANSAC on near-horizontal planes (≤ --max-tilt 8°; raise it for unaligned 3DGS/COLMAP captures): base = the lowest well-supported plane, levelled to it only when it is a clear floor (≥ 5 % of splats);  y = keep file axes (after the 3DGS/COLMAP flip, see --frame)
 *   --frame colmap|rub         source convention: colmap = 3DGS/Postshot/Scaniverse PLY (y down, z forward; default for .ply),
 *                              rub = three.js/SPZ convention (default for .spz / .splat)
 *   --base plane|lowest        base height: the detected plane (default) or the lowest splats (when the plane found is a rim)
 *   --yaw DEG  --height M | --scale S
 *   --crop auto|off|R          auto: radius around the object from the above-ground splats + drop what is under the base
 *                              (turntable stand, table); off: keep everything (a scene); R: radius in file units
 *   --cut-ground               drop the ground-plane splats (object only)
 *   --min-alpha A (0.04)  --max N (default 400000)  --sh 0..3 (default 0: daylight view-dependence is not wanted at night)
 *   --delight-dir K (0.7)  --tint K (1)  --chunk MB (4)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const FLAGS = new Set(['cut-ground', 'force', 'no-ktx2']);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (FLAGS.has(k) ? true : argv[i + 1]) : d; };
const input = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !FLAGS.has(argv[i - 1].slice(2))));
if (!input) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); process.exit(1); }
const log = (...a) => console.log('[splat]', ...a);
const T0 = Date.now(); const lap = (() => { let t = Date.now(); return (k) => { const d = Date.now() - t; t = Date.now(); META.steps[k] = d; }; })();
const META = { steps: {} };
const SH_DIM = [0, 3, 8, 15], C0 = 0.28209479177387814;

/* ------------------------------------------------------------------ decode */
// common in-memory layout: pos Float32 N*3, lscale (log) N*3, rot (x,y,z,w) N*4, alpha (0..1) N, dc N*3, sh N*dim*3 (coef-major)
function decodePly(buf) {
  const he = buf.indexOf('end_header\n'); const head = buf.subarray(0, he).toString('latin1'); let off = he + 11;
  if (!/binary_little_endian/.test(head)) throw new Error('only binary little-endian PLY');
  if (/element chunk/.test(head)) throw new Error('SuperSplat compressed PLY: export the plain PLY or SPZ instead');
  const n = +head.match(/element vertex (\d+)/)[1];
  const props = [...head.split('element vertex')[1].matchAll(/property (\w+) (\w+)/g)].map((m) => [m[1], m[2]]);
  const size = { float: 4, double: 8, uchar: 1, int: 4, uint: 4, short: 2, ushort: 2, char: 1 };
  const offs = {}; let stride = 0; for (const [t, name] of props) { offs[name] = [stride, t]; stride += size[t]; }
  const dv = new DataView(buf.buffer, buf.byteOffset + off, n * stride);
  const rd = (i, name) => { const [o, t] = offs[name]; const p = i * stride + o; return t === 'float' ? dv.getFloat32(p, true) : t === 'double' ? dv.getFloat64(p, true) : t === 'uchar' ? dv.getUint8(p) : dv.getInt32(p, true); };
  const nRest = props.filter(([, k]) => k.startsWith('f_rest_')).length; const deg = [0, 9, 24, 45].indexOf(nRest); const dim = SH_DIM[Math.max(0, deg)];
  const S = alloc(n, dim);
  const hasCol = !offs.f_dc_0 && offs.red;
  for (let i = 0; i < n; i++) {
    S.pos[i * 3] = rd(i, 'x'); S.pos[i * 3 + 1] = rd(i, 'y'); S.pos[i * 3 + 2] = rd(i, 'z');
    for (let c = 0; c < 3; c++) {
      S.lscale[i * 3 + c] = offs['scale_' + c] ? rd(i, 'scale_' + c) : Math.log(0.01);
      S.dc[i * 3 + c] = hasCol ? (rd(i, ['red', 'green', 'blue'][c]) / 255 - 0.5) / C0 : rd(i, 'f_dc_' + c);
      for (let j = 0; j < dim; j++) S.sh[(i * dim + j) * 3 + c] = rd(i, 'f_rest_' + (c * dim + j));   // PLY is channel-major
    }
    const w = offs.rot_0 ? rd(i, 'rot_0') : 1, x = offs.rot_1 ? rd(i, 'rot_1') : 0, y = offs.rot_2 ? rd(i, 'rot_2') : 0, z = offs.rot_3 ? rd(i, 'rot_3') : 0;
    const l = Math.hypot(w, x, y, z) || 1; S.rot.set([x / l, y / l, z / l, w / l], i * 4);
    S.alpha[i] = offs.opacity ? 1 / (1 + Math.exp(-rd(i, 'opacity'))) : 1;
  }
  return S;
}
function decodeSpz(buf) {
  const b = zlib.gunzipSync(buf); const dv = new DataView(b.buffer, b.byteOffset, b.length);
  if (dv.getUint32(0, true) !== 0x5053474e) throw new Error('not an SPZ file');
  const ver = dv.getUint32(4, true), n = dv.getUint32(8, true), deg = b[12], fb = b[13]; const dim = SH_DIM[deg]; let o = 16;
  const S = alloc(n, dim);
  if (ver === 1) { for (let i = 0; i < n * 3; i++) S.pos[i] = f16(dv.getUint16(o + i * 2, true)); o += n * 6; }
  else { const sc = 1 / (1 << fb); for (let i = 0; i < n * 3; i++) { let v = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16); if (v & 0x800000) v |= 0xff000000; S.pos[i] = v * sc; o += 3; } }
  for (let i = 0; i < n; i++) S.alpha[i] = b[o + i] / 255; o += n;
  for (let i = 0; i < n * 3; i++) S.dc[i] = (b[o + i] / 255 - 0.5) / 0.15; o += n * 3;
  for (let i = 0; i < n * 3; i++) S.lscale[i] = b[o + i] / 16 - 10; o += n * 3;
  if (ver >= 3) {   // smallest-three: 2 bits index of the largest, 3 × (1 sign + 9 bits)
    for (let i = 0; i < n; i++) {
      let comp = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24); o += 4; const iL = comp >>> 30; const q = [0, 0, 0, 0]; let sum = 0;
      for (let k = 3; k >= 0; k--) { if (k === iL) continue; const mag = comp & 511, neg = (comp >>> 9) & 1; comp >>>= 10; q[k] = Math.SQRT1_2 * mag / 511 * (neg ? -1 : 1); sum += q[k] * q[k]; }
      q[iL] = Math.sqrt(Math.max(0, 1 - sum)); S.rot.set(q, i * 4);
    }
  } else {
    for (let i = 0; i < n; i++) { const x = b[o] / 127.5 - 1, y = b[o + 1] / 127.5 - 1, z = b[o + 2] / 127.5 - 1; o += 3; S.rot.set([x, y, z, Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z))], i * 4); }
  }
  for (let i = 0; i < n * dim * 3; i++) S.sh[i] = (b[o + i] - 128) / 128;
  return S;
}
function decodeSplat(buf) {   // antimatter15 .splat: 32 B = pos f32×3, scale f32×3, rgba u8, rot u8×4 (w,x,y,z)
  const n = Math.floor(buf.length / 32), dv = new DataView(buf.buffer, buf.byteOffset, buf.length); const S = alloc(n, 0);
  for (let i = 0; i < n; i++) {
    const p = i * 32; for (let c = 0; c < 3; c++) { S.pos[i * 3 + c] = dv.getFloat32(p + c * 4, true); S.lscale[i * 3 + c] = Math.log(Math.max(1e-7, dv.getFloat32(p + 12 + c * 4, true))); S.dc[i * 3 + c] = (buf[p + 24 + c] / 255 - 0.5) / C0; }
    S.alpha[i] = buf[p + 27] / 255; const w = buf[p + 28] / 128 - 1, x = buf[p + 29] / 128 - 1, y = buf[p + 30] / 128 - 1, z = buf[p + 31] / 128 - 1; const l = Math.hypot(w, x, y, z) || 1;
    S.rot.set([x / l, y / l, z / l, w / l], i * 4);
  }
  return S;
}
function f16(h) { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023; return e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? (f ? NaN : s * Infinity) : s * 2 ** (e - 15) * (1 + f / 1024); }
function alloc(n, dim) { return { n, dim, pos: new Float32Array(n * 3), lscale: new Float32Array(n * 3), rot: new Float32Array(n * 4), alpha: new Float32Array(n), dc: new Float32Array(n * 3), sh: new Float32Array(n * dim * 3) }; }
function select(S, keep) {   // keep: array of indices
  const T = alloc(keep.length, S.dim), d3 = S.dim * 3;
  keep.forEach((i, k) => { T.pos.set(S.pos.subarray(i * 3, i * 3 + 3), k * 3); T.lscale.set(S.lscale.subarray(i * 3, i * 3 + 3), k * 3); T.rot.set(S.rot.subarray(i * 4, i * 4 + 4), k * 4);
    T.alpha[k] = S.alpha[i]; T.dc.set(S.dc.subarray(i * 3, i * 3 + 3), k * 3); if (d3) T.sh.set(S.sh.subarray(i * d3, i * d3 + d3), k * d3); });
  return T;
}

/* ------------------------------------------------------------------ encode SPZ v2 (positions 24-bit fixed, 12 fractional bits) */
function encodeSpz(S, deg) {
  const n = S.n, dim = SH_DIM[deg], fb = 12; const size = 16 + n * (9 + 1 + 3 + 3 + 3 + dim * 3); const b = Buffer.alloc(size); let o = 16;
  b.writeUInt32LE(0x5053474e, 0); b.writeUInt32LE(2, 4); b.writeUInt32LE(n, 8); b[12] = deg; b[13] = fb; b[14] = 0; b[15] = 0;
  const u8 = (v) => Math.max(0, Math.min(255, Math.round(v)));
  for (let i = 0; i < n * 3; i++) { const v = Math.round(S.pos[i] * (1 << fb)) & 0xffffff; b[o++] = v & 255; b[o++] = (v >> 8) & 255; b[o++] = (v >> 16) & 255; }
  for (let i = 0; i < n; i++) b[o++] = u8(S.alpha[i] * 255);
  for (let i = 0; i < n * 3; i++) b[o++] = u8(S.dc[i] * 0.15 * 255 + 127.5);
  for (let i = 0; i < n * 3; i++) b[o++] = u8((S.lscale[i] + 10) * 16);
  for (let i = 0; i < n; i++) { const q = S.rot.subarray(i * 4, i * 4 + 4); const s = q[3] < 0 ? -127.5 : 127.5; for (let c = 0; c < 3; c++) b[o++] = u8(q[c] * s + 127.5); }
  for (let i = 0; i < n; i++) for (let j = 0; j < dim; j++) for (let c = 0; c < 3; c++) b[o++] = u8(S.sh[(i * S.dim + j) * 3 + c] * 128 + 128);
  return zlib.gzipSync(b, { level: 9 });
}

/* ------------------------------------------------------------------ geometry helpers */
const quatMul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
function quatFromTo(u, v) { const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2]; if (d < -0.999999) { const ax = Math.abs(u[0]) < 0.9 ? [0, -u[2], u[1]] : [-u[1], u[0], 0]; const l = Math.hypot(...ax); return [ax[0] / l, ax[1] / l, ax[2] / l, 0]; }
  const c = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const q = [c[0], c[1], c[2], 1 + d]; const l = Math.hypot(...q); return q.map((x) => x / l); }
function quatMat(q) { const [x, y, z, w] = q; return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]; }
function rotateAll(S, q) {   // rotate positions and splat orientations; SH (degree ≥ 1) would need a rotation too → truncated before
  const m = quatMat(q);
  for (let i = 0; i < S.n; i++) { const x = S.pos[i * 3], y = S.pos[i * 3 + 1], z = S.pos[i * 3 + 2];
    S.pos[i * 3] = m[0] * x + m[1] * y + m[2] * z; S.pos[i * 3 + 1] = m[3] * x + m[4] * y + m[5] * z; S.pos[i * 3 + 2] = m[6] * x + m[7] * y + m[8] * z;
    S.rot.set(quatMul(q, S.rot.subarray(i * 4, i * 4 + 4)), i * 4); }
}
const pct = (arr, p) => { const a = Float32Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))]; };
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/* ------------------------------------------------------------------ style.js (read only) */
function readStyle() { const ctx = { window: {}, Math }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, 'style.js'), 'utf8'), ctx); return ctx.window.STYLE; }
const STYLE = readStyle(); const M = STYLE.materials;
const GRADE = { rock: M.rock_basalt.grade, masonry: { desat: M.rock_basalt.grade.desat * 0.8, mul: M.rock_basalt.grade.mul }, wood: { desat: 0.35, mul: M.bark.lin },
  ice: { desat: 0.5, mul: [0.72, 0.85, 1] }, snow: { desat: 0.6, mul: [0.77, 0.85, 1] }, metal: { desat: 0.45, mul: [0.8, 0.85, 1] }, prop: { desat: 0.4, mul: M.rock_basalt.grade.mul.map((x) => x * 1.15) } };
const TARGET = { rock: 0.16, masonry: 0.18, wood: 0.12, ice: 0.35, snow: 0.55, metal: 0.1, prop: 0.15 };
const GUESS = [[/ice|лёд|лед/i, 'ice'], [/rock|boulder|stone/i, 'rock'], [/snow|снег/i, 'snow'], [/brick|wall|ruin|concrete|masonry/i, 'masonry'], [/tire|tyre|scrap|metal/i, 'metal'], [/stump|log|root|bark|wood|crate|pallet|branch/i, 'wood']];

/* ------------------------------------------------------------------ main */
const file = path.resolve(input), ext = path.extname(file).toLowerCase(), base = path.parse(file).name;
const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'splat';
const name = opt('name') || 'splat_' + slug(base);
const role = opt('role') || (GUESS.find(([re]) => re.test(base)) || [0, 'prop'])[1];
const OUT = path.resolve(opt('out', path.join(ROOT, 'assets/incoming4/scan'))), dir = path.join(OUT, name);
const buf = fs.readFileSync(file);
let S = ext === '.spz' ? decodeSpz(buf) : ext === '.splat' ? decodeSplat(buf) : decodePly(buf);
Object.assign(META, { name, role, source: path.basename(file), countIn: S.n, bytesIn: buf.length, shIn: SH_DIM.indexOf(S.dim) });
log(name, `${S.n} splats, SH ${META.shIn} ← ${path.basename(file)} (${(buf.length / 1e6).toFixed(1)} MB)`); lap('decode');

// 0. SH: rotating SH coefficients is not implemented → truncate before any rotation (default 0 anyway)
const deg = Math.min(Number(opt('sh', 0)), META.shIn);
if (deg < META.shIn) { const d = SH_DIM[deg], T = new Float32Array(S.n * d * 3); for (let i = 0; i < S.n; i++) T.set(S.sh.subarray(i * S.dim * 3, i * S.dim * 3 + d * 3), i * d * 3); S.sh = T; S.dim = d; }
// 1. frame: 3DGS / COLMAP PLY is x right, y down, z forward → rotate 180° about X into three.js (y up, z back)
const frame = opt('frame', ext === '.ply' ? 'colmap' : 'rub');
if (frame === 'colmap') rotateAll(S, [1, 0, 0, 0]);
// 2. opacity / size floaters
{ const minA = Number(opt('min-alpha', 0.04)); const smax = new Float32Array(S.n); for (let i = 0; i < S.n; i++) smax[i] = Math.max(S.lscale[i * 3], S.lscale[i * 3 + 1], S.lscale[i * 3 + 2]);
  const big = pct(smax, 0.999) ; const keep = []; for (let i = 0; i < S.n; i++) if (S.alpha[i] >= minA && smax[i] <= big) keep.push(i);
  META.removedAlphaSize = S.n - keep.length; S = select(S, keep); }
// 3. level: RANSAC ground plane (dominant plane among opaque splats) → +Y, object above it
const up = String(opt('up', 'auto'));
let plane = null;
if (up === 'auto') {
  const R = rng(7); const cand = []; for (let i = 0; i < S.n; i++) if (S.alpha[i] > 0.5) cand.push(i);
  const sample = Array.from({ length: Math.min(30000, cand.length) }, () => cand[Math.floor(R() * cand.length)]);
  const P = (i) => [S.pos[i * 3], S.pos[i * 3 + 1], S.pos[i * 3 + 2]];
  const ext_ = Math.hypot(...[0, 1, 2].map((c) => pct(sample.map((i) => S.pos[i * 3 + c]), 0.95) - pct(sample.map((i) => S.pos[i * 3 + c]), 0.05)));
  const thr = ext_ * 0.006; let best = { cnt: 0, n: [0, 1, 0], d: 0 }; const cands = []; const maxTilt = Number(opt('max-tilt', 8)) * Math.PI / 180;
  for (let it = 0; it < 400; it++) {
    const [a, b, c] = [0, 1, 2].map(() => P(sample[Math.floor(R() * sample.length)]));
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...nrm); if (l < 1e-9) continue;
    const nn = nrm.map((x) => x / l), d = -(nn[0] * a[0] + nn[1] * a[1] + nn[2] * a[2]);
    if (Math.abs(nn[1]) < Math.cos(maxTilt)) continue;   // phone scans are gravity-aligned: only near-horizontal planes
    let cnt = 0; for (const i of sample) if (Math.abs(nn[0] * S.pos[i * 3] + nn[1] * S.pos[i * 3 + 1] + nn[2] * S.pos[i * 3 + 2] + d) < thr) cnt++;
    if (nn[1] < 0) { nn[0] = -nn[0]; nn[1] = -nn[1]; nn[2] = -nn[2]; }
    cands.push({ cnt, n: nn, d: -(nn[0] * a[0] + nn[1] * a[1] + nn[2] * a[2]) });
    if (cnt > best.cnt) best = cands.at(-1);
  }
  // several horizontal planes (stand top, pot rim, soil): the object stands on the LOWEST well-supported one
  const strong = opt('base') === 'lowest' ? [] : cands.filter((c) => c.cnt >= sample.length * 0.01);
  if (strong.length) best = strong.reduce((m, c) => (-c.d / c.n[1] < -m.d / m.n[1] - thr * 2 ? c : m));
  // a weak plane only gives the base height; the file's up (gravity from the phone IMU) is kept unless the plane is a clear floor
  if (best.cnt < sample.length * 0.05) best = { cnt: best.cnt, n: [0, 1, 0], d: best.d / best.n[1] * 1, weak: true };
  if (best.cnt < sample.length * 0.01 || opt('base') === 'lowest') {   // no floor in the capture (turntable / hand-held object): keep the file's up, base = lowest 0.5 %
    best = { cnt: 0, n: [0, 1, 0], d: -pct(sample.map((i) => S.pos[i * 3 + 1]), 0.005) };
  }
  // orient: the side with more (non-plane) mass is "up"
  let above = 0, below = 0; for (const i of sample) { const s = best.n[0] * S.pos[i * 3] + best.n[1] * S.pos[i * 3 + 1] + best.n[2] * S.pos[i * 3 + 2] + best.d; if (s > thr * 3) above++; else if (s < -thr * 3) below++; }
  if (below > above) { best.n = best.n.map((x) => -x); best.d = -best.d; }
  plane = { normal: best.n.map((x) => +x.toFixed(4)), inlierShare: +(best.cnt / sample.length).toFixed(3), levelled: !best.weak };
  rotateAll(S, quatFromTo(best.n, [0, 1, 0]));
  // plane height after rotation = -d
  const h0 = -best.d; for (let i = 0; i < S.n; i++) S.pos[i * 3 + 1] -= h0;
  META.level = plane; log('level: plane', plane);
} else if (up !== 'y') {
  const ax = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[up.replace(/[+-]/, '')].map((x) => (up.startsWith('-') ? -x : x));
  rotateAll(S, quatFromTo(ax, [0, 1, 0]));
}
if (Number(opt('yaw', 0))) { const a = Number(opt('yaw')) * Math.PI / 360; rotateAll(S, [0, Math.sin(a), 0, Math.cos(a)]); }
lap('level');
// 4. crop around the object standing on the plane (x/z centre = median of the above-ground splats)
{ const hasPlane = !!plane; const aboveI = []; const gy = hasPlane ? 0 : pct(S.pos.filter((_, k) => k % 3 === 1), 0.02);
  const thr = 0.01 * Math.hypot(pct(S.pos.filter((_, k) => k % 3 === 0), 0.95) - pct(S.pos.filter((_, k) => k % 3 === 0), 0.05), pct(S.pos.filter((_, k) => k % 3 === 2), 0.95) - pct(S.pos.filter((_, k) => k % 3 === 2), 0.05));
  for (let i = 0; i < S.n; i++) if (S.pos[i * 3 + 1] > gy + thr * 2 && S.alpha[i] > 0.3) aboveI.push(i);
  const cx = pct(aboveI.map((i) => S.pos[i * 3]), 0.5), cz = pct(aboveI.map((i) => S.pos[i * 3 + 2]), 0.5);
  const rad = aboveI.map((i) => Math.hypot(S.pos[i * 3] - cx, S.pos[i * 3 + 2] - cz));
  // object radius = where the above-ground density falls off: 80th percentile of the distances of the densest half
  const r80 = pct(rad, 0.6), top = pct(aboveI.map((i) => S.pos[i * 3 + 1]).filter((_, k) => rad[k] < r80 * 1.5), 0.995);
  const crop = opt('crop', 'auto'); const Rc = crop === 'off' ? Infinity : crop === 'auto' ? r80 * 1.6 : Number(crop) / Number(opt('scale', 1));
  const cutG = !!opt('cut-ground');
  const keep = []; for (let i = 0; i < S.n; i++) { const x = S.pos[i * 3] - cx, y = S.pos[i * 3 + 1] - gy, z = S.pos[i * 3 + 2] - cz;
    if (crop === 'off' ? (!cutG || y >= thr * 1.5) : Math.hypot(x, z) <= Rc && y >= (cutG ? thr * 1.5 : -thr * 4) && y <= top * 1.08 + thr) keep.push(i); }
  META.crop = { radius: +Rc.toFixed(3), removed: S.n - keep.length, cutGround: cutG };
  S = select(S, keep); for (let i = 0; i < S.n; i++) { S.pos[i * 3] -= cx; S.pos[i * 3 + 1] -= gy; S.pos[i * 3 + 2] -= cz; }
  META.objectTop = top - gy; }
// 5. isolated floaters: voxel grid, drop splats whose 3×3×3 neighbourhood holds < 4 splats
{ let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < S.n; i++) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], S.pos[i * 3 + c]); hi[c] = Math.max(hi[c], S.pos[i * 3 + c]); }
  const vs = Math.max(...hi.map((h, c) => h - lo[c])) / 96; const key = (i) => [0, 1, 2].map((c) => Math.floor((S.pos[i * 3 + c] - lo[c]) / vs));
  const grid = new Map(); const K = new Array(S.n);
  for (let i = 0; i < S.n; i++) { const k = key(i); K[i] = k; const h = k.join(','); grid.set(h, (grid.get(h) || 0) + 1); }
  const keep = []; for (let i = 0; i < S.n; i++) { const [a, b, c] = K[i]; let cnt = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) cnt += grid.get(`${a + dx},${b + dy},${c + dz}`) || 0;
    if (cnt >= 4) keep.push(i); }
  META.removedIsolated = S.n - keep.length; S = select(S, keep); }
lap('clean');
// 6. scale: --height = object height (top of the above-ground splats); Scaniverse is metric → default 1
let s = Number(opt('scale', 1)); if (opt('height')) s = Number(opt('height')) / META.objectTop;
if (s !== 1) { for (let i = 0; i < S.n * 3; i++) S.pos[i] *= s; const ls = Math.log(s); for (let i = 0; i < S.n * 3; i++) S.lscale[i] += ls; }
META.scaleApplied = +s.toFixed(5);
// 7. budget: keep the most visible splats (opacity × projected area)
const max = Number(opt('max', 400000));
if (S.n > max) { const imp = new Float32Array(S.n); for (let i = 0; i < S.n; i++) imp[i] = S.alpha[i] * Math.exp((S.lscale[i * 3] + S.lscale[i * 3 + 1] + S.lscale[i * 3 + 2]) * 2 / 3);
  const idx = Array.from(imp.keys()).sort((a, b) => imp[b] - imp[a]).slice(0, max).sort((a, b) => a - b); META.removedBudget = S.n - idx.length; S = select(S, idx); }
lap('scale_budget');
// 8. delight: normal = the splat's shortest axis (flat splats hug the surface), oriented away from the object's axis;
//    robust fit lum ≈ c0 + c·n over opaque flat splats, divide it out (strength --delight-dir); then exposure + night grade
{ const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4), toS = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
  const N = new Float32Array(S.n * 3), flat = new Uint8Array(S.n); const cy = META.objectTop * s * 0.5;
  for (let i = 0; i < S.n; i++) { const ls = S.lscale.subarray(i * 3, i * 3 + 3); let k = 0; if (ls[1] < ls[k]) k = 1; if (ls[2] < ls[k]) k = 2;
    const m = quatMat(S.rot.subarray(i * 4, i * 4 + 4)); let n = [m[k], m[3 + k], m[6 + k]];
    const out = [S.pos[i * 3], S.pos[i * 3 + 1] - cy, S.pos[i * 3 + 2]]; if (S.pos[i * 3 + 1] < 0.02 * cy) { out[0] = 0; out[1] = 1; out[2] = 0; }
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = n.map((x) => -x); N.set(n, i * 3);
    const mid = ls[0] + ls[1] + ls[2] - Math.min(...ls) - Math.max(...ls); flat[i] = S.alpha[i] > 0.6 && mid - ls[k] > 1.0 ? 1 : 0; }
  const rgb = (i) => [0, 1, 2].map((c) => toLin(Math.max(0, Math.min(1, 0.5 + C0 * S.dc[i * 3 + c]))));
  const lumOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const R = rng(3); const idx = []; for (let i = 0; i < S.n; i++) if (flat[i] && R() < 60000 / S.n * 3) idx.push(i);
  let coef = [0, 0, 0, 0];
  if (idx.length > 200) { let w = idx.map(() => 1);
    for (let it = 0; it < 4; it++) { const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], bb = [0, 0, 0, 0];
      idx.forEach((i, k) => { const row = [1, N[i * 3], N[i * 3 + 1], N[i * 3 + 2]], L = lumOf(rgb(i)); for (let a = 0; a < 4; a++) { bb[a] += w[k] * row[a] * L; for (let c = 0; c < 4; c++) A[a][c] += w[k] * row[a] * row[c]; } });
      coef = solve4(A, bb); const res = idx.map((i) => lumOf(rgb(i)) - (coef[0] + coef[1] * N[i * 3] + coef[2] * N[i * 3 + 1] + coef[3] * N[i * 3 + 2]));
      const mad = pct(res.map(Math.abs), 0.5) * 1.4826 + 1e-6; w = res.map((r) => 1 / Math.max(1, Math.abs(r) / (2 * mad))); } }
  const kDir = Number(opt('delight-dir', 0.7)); const c0 = Math.max(coef[0], 1e-4);
  const corr = (f) => { const xs = idx.map((i) => lumOf(f(i))), ys = idx.map((i) => (coef[1] * N[i * 3] + coef[2] * N[i * 3 + 1] + coef[3] * N[i * 3 + 2])); const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length; let sxy = 0, sxx = 0, syy = 0; xs.forEach((x, k) => { sxy += (x - mx) * (ys[k] - my); sxx += (x - mx) ** 2; syy += (ys[k] - my) ** 2; }); return +(sxy / Math.sqrt(sxx * syy + 1e-12)).toFixed(3); };
  const shade = (i) => { const S_ = (coef[0] + coef[1] * N[i * 3] + coef[2] * N[i * 3 + 1] + coef[3] * N[i * 3 + 2]) / c0; return 1 + (Math.min(2, Math.max(0.35, S_)) - 1) * kDir; };
  const delit = (i) => rgb(i).map((v) => v / shade(i));
  const before = idx.length > 200 ? corr(rgb) : null, after = idx.length > 200 ? corr(delit) : null;
  const lums = []; for (let i = 0; i < S.n; i += 7) lums.push(lumOf(delit(i))); const med = pct(lums, 0.5);
  const g = GRADE[role], tint = Number(opt('tint', 1)), desat = g.desat * tint, mul = g.mul.map((x) => 1 + (x - 1) * tint);
  const expo = (TARGET[role] / Math.max(med, 1e-4)) ** 0.6;
  for (let i = 0; i < S.n; i++) { const c = delit(i).map((v) => v * expo); const l = lumOf(c);
    for (let k = 0; k < 3; k++) { const v = (c[k] + (l - c[k]) * desat) * mul[k]; S.dc[i * 3 + k] = (toS(Math.max(0, Math.min(1, v))) - 0.5) / C0; } }
  META.delight = { flatSplatsUsed: idx.length, dirStrength: +(Math.hypot(coef[1], coef[2], coef[3]) / c0).toFixed(3), lightDir: [coef[1], coef[2], coef[3]].map((x) => +(x / (Math.hypot(coef[1], coef[2], coef[3]) || 1)).toFixed(3)),
    corrShadingBefore: before, corrShadingAfter: after, strength: kDir, exposure: +expo.toFixed(3), grade: { desat, mul } };
  log('delight', META.delight); }
lap('delight');
function solve4(A, b) { const M_ = A.map((r, i) => [...r, b[i]]); for (let c = 0; c < 4; c++) { let p = c; for (let r = c + 1; r < 4; r++) if (Math.abs(M_[r][c]) > Math.abs(M_[p][c])) p = r; [M_[c], M_[p]] = [M_[p], M_[c]]; const d = M_[c][c] || 1e-12;
  for (let r = 0; r < 4; r++) if (r !== c) { const f = M_[r][c] / d; for (let k = c; k < 5; k++) M_[r][k] -= f * M_[c][k]; } } return M_.map((r, i) => r[4] / (r[i] || 1e-12)); }

// 9. bounds, encode, chunk
let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < S.n; i++) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], S.pos[i * 3 + c]); hi[c] = Math.max(hi[c], S.pos[i * 3 + c]); }
const spz = encodeSpz(S, deg); lap('encode');
fs.mkdirSync(dir, { recursive: true }); for (const f of fs.readdirSync(dir)) if (/\.(js|json)$/.test(f)) fs.rmSync(path.join(dir, f));
const CH = Math.floor(Number(opt('chunk', 4)) * 1024 * 1024 / 4) * 3;   // base64 of CH bytes = --chunk MB
const b64 = spz.toString('base64'); const chunks = [];
const nCh = Math.ceil(spz.length / CH);
for (let i = 0, k = 0; i < spz.length; i += CH, k++) { const f = `${name}.spz.${k}.js`;   // chunk 0 also carries the chunk count
  fs.writeFileSync(path.join(dir, f), `(window.__PACK=window.__PACK||{})['${name}#${k}']='${spz.subarray(i, i + CH).toString('base64')}';` + (k === 0 ? `window.__PACK['${name}#count']=${nCh};` : '') + '\n'); chunks.push(f); }
Object.assign(META, { kind: 'splat', format: 'spz-v2', count: S.n, sh: deg, bytes: { spz: spz.length, packTotal: chunks.reduce((a, f) => a + fs.statSync(path.join(dir, f)).size, 0), perSplat: +(spz.length / S.n).toFixed(2) },
  chunks, bounds: { min: lo.map((x) => +x.toFixed(3)), max: hi.map((x) => +x.toFixed(3)) }, size: hi.map((h, c) => +(h - lo[c]).toFixed(3)),
  gpuBytesEstimate: { spark: S.n * 16, threeNative: S.n * 48 }, seconds: +((Date.now() - T0) / 1000).toFixed(1),
  usage: `ScanSplat.load('${name}', '<dir>/', (spz) => scene.add(new SplatMesh({ fileBytes: spz })))  — see SCAN.md` });
fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(META, null, 1));
log(`→ ${path.relative(ROOT, dir)}  ${S.n} splats  SPZ ${(spz.length / 1e6).toFixed(2)} MB (${META.bytes.perSplat} B/splat), ${chunks.length} chunk(s)  ${META.size.join('×')} m  ${META.seconds}s`);
