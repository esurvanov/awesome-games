// Builds one normalized GLB per catalog id into <out>/<id>.glb
// Normalization: meters, base at y=0, footprint center at x=z=0, front faces +Z.
// Wall items: mirror/painting -> back plane at z=0 (model extends to +Z); door/window -> centered on z=0.
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, prune, dedup, getBounds, flatten, join, weld } from '@gltf-transform/functions';
import fs from 'fs';
import sharp from 'sharp';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const OUT = process.argv[2] || 'out';
const ONLY = process.argv[3] ? process.argv[3].split(',') : null;
fs.mkdirSync(OUT, { recursive: true });
const KDIR = 'kfk/Models/GLTF format/';
const K = 2.05; // Kenney Furniture Kit units -> meters
const D2R = Math.PI / 180;

// ---------- procedural helpers ----------
function mat(doc, name, rgb, opts = {}) {
  const m = doc.createMaterial(name).setBaseColorFactor([...rgb, opts.alpha ?? 1]).setRoughnessFactor(opts.rough ?? 0.8).setMetallicFactor(opts.metal ?? 0);
  if (opts.alpha != null && opts.alpha < 1) m.setAlphaMode('BLEND');
  return m;
}
function prim(doc, pos, nor, idx, material, uv) {
  const buf = doc.getRoot().listBuffers()[0] || doc.createBuffer();
  const p = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buf))
    .setMaterial(material);
  if (uv) p.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buf));
  return p;
}
// geometry accumulators: {pos, nor, idx, uv}
function G() { return { pos: [], nor: [], idx: [], uv: [] }; }
function addBox(g, cx, cy, cz, w, h, d) { // center x/z, bottom y
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy, y1 = cy + h, z0 = cz - d / 2, z1 = cz + d / 2;
  const faces = [
    [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
    [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
    [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
    [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
    [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
    [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
  ];
  for (const [n, vs] of faces) {
    const b = g.pos.length / 3;
    for (const v of vs) { g.pos.push(...v); g.nor.push(...n); }
    g.uv.push(0, 1, 1, 1, 1, 0, 0, 0);
    g.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
}
function addCyl(g, cx, cy, cz, r0, r1, h, n = 12) { // frustum, bottom radius r0, top r1
  const b = g.pos.length / 3; const slope = (r0 - r1) / h;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const l = Math.hypot(1, slope);
    g.pos.push(cx + c * r0, cy, cz + s * r0, cx + c * r1, cy + h, cz + s * r1);
    g.nor.push(c / l, slope / l, s / l, c / l, slope / l, s / l); g.uv.push(i / n, 1, i / n, 0);
  }
  for (let i = 0; i < n; i++) { const a = b + i * 2; g.idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  // top cap
  const t = g.pos.length / 3; g.pos.push(cx, cy + h, cz); g.nor.push(0, 1, 0); g.uv.push(0.5, 0.5);
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; g.pos.push(cx + Math.cos(a) * r1, cy + h, cz + Math.sin(a) * r1); g.nor.push(0, 1, 0); g.uv.push(0.5, 0.5); }
  for (let i = 0; i < n; i++) g.idx.push(t, t + 2 + i, t + 1 + i);
}
function addSphere(g, cx, cy, cz, r, n = 8) {
  const b = g.pos.length / 3;
  for (let i = 0; i <= n; i++) { const th = (i / n) * Math.PI; for (let j = 0; j <= n; j++) { const ph = (j / n) * Math.PI * 2; const x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph); g.pos.push(cx + x * r, cy + y * r, cz + z * r); g.nor.push(x, y, z); g.uv.push(j / n, i / n); } }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const a = b + i * (n + 1) + j, c = a + n + 1; g.idx.push(a, a + 1, c, a + 1, c + 1, c); }
}
function meshNode(doc, name, parts) { // parts: [[geom, material]]
  const mesh = doc.createMesh(name);
  for (const [g, m] of parts) if (g.idx.length) mesh.addPrimitive(prim(doc, g.pos, g.nor, g.idx, m, g.uv));
  return doc.createNode(name).setMesh(mesh);
}

// ---------- procedural models (built directly in meters, front +Z) ----------
async function birchTexture() {
  const W = 320, H = 240; let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
  s += `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9cc3e6"/><stop offset="1" stop-color="#e8f0e0"/></linearGradient></defs>`;
  s += `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  s += `<rect y="${H * 0.62}" width="${W}" height="${H * 0.38}" fill="#7fa650"/>`;
  s += `<ellipse cx="${W * 0.5}" cy="${H * 0.64}" rx="${W * 0.7}" ry="${H * 0.08}" fill="#6a9442"/>`;
  const trees = [[40, 9], [78, 7], [120, 10], [175, 8], [215, 11], [262, 7], [295, 9]];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const [x, w] of trees) {
    s += `<ellipse cx="${x}" cy="${H * 0.28}" rx="${w * 3.2}" ry="${H * 0.2}" fill="#9ab84a" opacity="0.85"/>`;
  }
  for (const [x, w] of trees) {
    s += `<rect x="${x - w / 2}" y="0" width="${w}" height="${H * 0.72}" fill="#f4f1ea"/>`;
    for (let k = 0; k < 9; k++) { const y = rnd() * H * 0.7; s += `<rect x="${x - w / 2 + (rnd() < 0.5 ? 0 : w * 0.4)}" y="${y}" width="${w * (0.4 + rnd() * 0.5)}" height="${2 + rnd() * 3}" fill="#2b2b2b"/>`; }
  }
  for (let k = 0; k < 40; k++) s += `<circle cx="${rnd() * W}" cy="${rnd() * H * 0.5}" r="${3 + rnd() * 6}" fill="${rnd() < 0.5 ? '#c9d65a' : '#8fb040'}" opacity="0.8"/>`;
  s += `</svg>`;
  return sharp(Buffer.from(s)).jpeg({ quality: 82 }).toBuffer();
}

const PROC = {
  async painting(doc) { // 0.9 x 0.7 frame, 4 cm deep, back at z=0
    const frame = mat(doc, 'frameWood', [0.45, 0.28, 0.14]);
    const canvas = mat(doc, 'canvas', [1, 1, 1], { rough: 0.9 });
    const tex = doc.createTexture('birches').setImage(await birchTexture()).setMimeType('image/jpeg');
    canvas.setBaseColorTexture(tex);
    const W = 0.9, H = 0.7, D = 0.04, t = 0.06; const g = G();
    addBox(g, 0, 0, D / 2, W, t, D); addBox(g, 0, H - t, D / 2, W, t, D);
    addBox(g, -W / 2 + t / 2, t, D / 2, t, H - 2 * t, D); addBox(g, W / 2 - t / 2, t, D / 2, t, H - 2 * t, D);
    const c = G(); // canvas quad, front at z=D*0.6
    const z = D * 0.6, x0 = -W / 2 + t, x1 = W / 2 - t, y0 = t, y1 = H - t;
    c.pos.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z); c.nor.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1); c.uv.push(0, 1, 1, 1, 1, 0, 0, 0); c.idx.push(0, 1, 2, 0, 2, 3);
    const back = G(); addBox(back, 0, t, 0.005, W - 2 * t, H - 2 * t, 0.01);
    return meshNode(doc, 'painting', [[g, frame], [c, canvas], [back, frame]]);
  },
  async phone(doc) { // retro desk phone ~ 0.22 x 0.12 x 0.18
    const body = mat(doc, 'phoneRed', [0.62, 0.12, 0.1], { rough: 0.4 });
    const dark = mat(doc, 'phoneDark', [0.08, 0.08, 0.08], { rough: 0.5 });
    const dial = mat(doc, 'phoneDial', [0.92, 0.9, 0.85], { rough: 0.5 });
    const g = G(); addBox(g, 0, 0, 0, 0.2, 0.025, 0.17); addCyl(g, 0, 0.025, 0, 0.1, 0.075, 0.06, 16);
    addBox(g, -0.07, 0.085, -0.01, 0.035, 0.03, 0.05); addBox(g, 0.07, 0.085, -0.01, 0.035, 0.03, 0.05);
    const h = G(); addBox(h, 0, 0.115, -0.01, 0.2, 0.025, 0.045); addBox(h, -0.085, 0.095, -0.01, 0.05, 0.035, 0.055); addBox(h, 0.085, 0.095, -0.01, 0.05, 0.035, 0.055);
    const d = G(); addCyl(d, 0, 0.083, 0.045, 0.035, 0.035, 0.008, 16);
    const cord = G(); addCyl(cord, -0.1, 0.02, 0.05, 0.006, 0.006, 0.08, 6);
    return meshNode(doc, 'phone', [[g, body], [h, body], [d, dial], [cord, dark]]);
  },
  async chess(doc) { // table 0.8 x 0.72 with chessboard + pieces
    const wood = mat(doc, 'wood', [0.62, 0.4, 0.22]);
    const woodDark = mat(doc, 'woodDark', [0.35, 0.2, 0.1]);
    const light = mat(doc, 'boardLight', [0.93, 0.86, 0.7]);
    const darkSq = mat(doc, 'boardDark', [0.3, 0.18, 0.1]);
    const white = mat(doc, 'pieceWhite', [0.95, 0.93, 0.88], { rough: 0.4 });
    const black = mat(doc, 'pieceBlack', [0.1, 0.1, 0.1], { rough: 0.4 });
    const T = G(); const top = 0.72, S = 0.8, lt = 0.05;
    addBox(T, 0, top - 0.04, 0, S, 0.04, S);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(T, sx * (S / 2 - 0.06), 0, sz * (S / 2 - 0.06), lt, top - 0.04, lt);
    const apron = G(); addBox(apron, 0, top - 0.12, 0, S - 0.08, 0.08, S - 0.08);
    const L = G(), Dk = G(); const B = 0.56, q = B / 8, y0 = top;
    const frameB = G(); addBox(frameB, 0, y0, 0, B + 0.04, 0.01, B + 0.04);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) addBox((i + j) % 2 ? Dk : L, -B / 2 + q * (i + 0.5), y0 + 0.01, -B / 2 + q * (j + 0.5), q, 0.004, q);
    const Wp = G(), Bp = G(); const yb = y0 + 0.014;
    const piece = (g, x, z, tall) => { addCyl(g, x, yb, z, q * 0.32, q * 0.18, tall * 0.8, 8); addSphere(g, x, yb + tall * 0.85, z, q * 0.17, 5); };
    for (let i = 0; i < 8; i++) {
      const x = -B / 2 + q * (i + 0.5);
      piece(Wp, x, B / 2 - q * 1.5, 0.035); piece(Bp, x, -B / 2 + q * 1.5, 0.035);
      const tall = [0.05, 0.055, 0.06, 0.075, 0.08, 0.06, 0.055, 0.05][i];
      piece(Wp, x, B / 2 - q * 0.5, tall); piece(Bp, x, -B / 2 + q * 0.5, tall);
    }
    return meshNode(doc, 'chess', [[T, wood], [apron, woodDark], [frameB, woodDark], [L, light], [Dk, darkSq], [Wp, white], [Bp, black]]);
  },
  async exercise_bench(doc) { // скамья для жима вдоль Z (голова к −Z), стойки со штангой у изголовья; 1×2
    const pad = mat(doc, 'pad', [0.15, 0.15, 0.17], { rough: 0.6 }), steel = mat(doc, 'steel', [0.55, 0.57, 0.6], { metal: 0.7, rough: 0.35 }), plate = mat(doc, 'plates', [0.06, 0.06, 0.07], { rough: 0.5 });
    const P = G(), S = G(), W = G();
    addBox(P, 0, 0.42, 0.1, 0.3, 0.07, 1.25);                 // подушка
    addBox(S, 0, 0.0, 0.1, 0.06, 0.42, 1.1); addBox(S, 0, 0, 0.62, 0.5, 0.04, 0.06); addBox(S, 0, 0, -0.42, 0.6, 0.04, 0.06);
    for (const x of [-0.26, 0.26]) { addBox(S, x, 0, -0.62, 0.05, 1.0, 0.05); addBox(S, x, 0.95, -0.58, 0.05, 0.08, 0.12); addBox(S, x, 0, -0.62, 0.05, 0.04, 0.3); }
    addCyl(S, -0.47, 1.02, -0.58, 0.014, 0.014, 0.001, 8); // заглушка (не видна)
    const bar = G(); // гриф вдоль X: собираем как боксы
    addBox(bar, 0, 1.01, -0.58, 0.94, 0.028, 0.028);
    for (const x of [-0.4, -0.36, 0.36, 0.4]) addBox(W, x, 0.86, -0.58, 0.03, 0.32, 0.32);
    return meshNode(doc, 'exercise_bench', [[P, pad], [S, steel], [bar, steel], [W, plate]]);
  },
  async easel(doc) { // мольберт-тренога с холстом, холст лицом к +Z (художник стоит перед ним, со стороны +Z)
    const wood = mat(doc, 'wood', [0.62, 0.42, 0.24]), canvasM = mat(doc, 'canvas', [1, 1, 1], { rough: 0.9 });
    canvasM.setBaseColorTexture(doc.createTexture('easelCanvas').setImage(await birchTexture()).setMimeType('image/jpeg'));
    const Wd = G();
    const leg = (x0, z0, x1, z1) => { const n = 6, h = 1.7; for (let i = 0; i < n; i++) { const t = i / n; addBox(Wd, x0 + (x1 - x0) * (t + 0.5 / n), h * t, z0 + (z1 - z0) * (t + 0.5 / n), 0.04, h / n + 0.01, 0.04); } };
    leg(-0.32, 0.12, -0.05, -0.02); leg(0.32, 0.12, 0.05, -0.02); leg(0, -0.4, 0, -0.06);
    addBox(Wd, 0, 0.72, 0.05, 0.7, 0.04, 0.07);               // полочка
    const C = G(); addBox(C, 0, 0.76, 0.07, 0.62, 0.5, 0.025); // холст
    const face = G(); const z = 0.07 + 0.0126; face.pos.push(-0.3, 0.77, z, 0.3, 0.77, z, 0.3, 1.25, z, -0.3, 1.25, z); face.nor.push(0,0,1,0,0,1,0,0,1,0,0,1); face.uv.push(0,1,1,1,1,0,0,0); face.idx.push(0,1,2,0,2,3);
    return meshNode(doc, 'easel', [[Wd, wood], [C, wood], [face, canvasM]]);
  },
  async smoke_alarm(doc) { // диск Ø14 см на стене, задник в z=0
    const w = mat(doc, 'plasticWhite', [0.93, 0.93, 0.9], { rough: 0.5 }), led = mat(doc, 'ledRed', [0.9, 0.05, 0.05], { rough: 0.3 });
    led.setEmissiveFactor([1, 0.1, 0.1]);
    const g = G(); addCyl(g, 0, 0, 0, 0.07, 0.06, 0.035, 20); const l = G(); addCyl(l, 0.03, 0.035, 0, 0.006, 0.006, 0.003, 6);
    const n = meshNode(doc, 'smoke_alarm', [[g, w], [l, led]]);
    n.setRotation([Math.sin(Math.PI / 4), 0, 0, Math.cos(Math.PI / 4)]); // ось диска → +Z
    return n;
  },
  async burglar_alarm(doc) { // пульт сигнализации 0.16×0.22, задник в z=0
    const w = mat(doc, 'plasticGrey', [0.8, 0.8, 0.78], { rough: 0.5 }), scr = mat(doc, 'screen', [0.1, 0.25, 0.15], { rough: 0.2 }), btn = mat(doc, 'buttons', [0.25, 0.25, 0.27]), led = mat(doc, 'ledGreen', [0.1, 0.9, 0.2]);
    scr.setEmissiveFactor([0.05, 0.3, 0.12]); led.setEmissiveFactor([0.1, 1, 0.2]);
    const g = G(); addBox(g, 0, 0, 0.02, 0.16, 0.22, 0.04);
    const s = G(); addBox(s, 0, 0.14, 0.041, 0.12, 0.05, 0.004);
    const b = G(); for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) addBox(b, -0.04 + c * 0.04, 0.02 + r * 0.028, 0.041, 0.028, 0.02, 0.006);
    const l = G(); addBox(l, 0.06, 0.2, 0.041, 0.012, 0.008, 0.004);
    return meshNode(doc, 'burglar_alarm', [[g, w], [s, scr], [b, btn], [l, led]]);
  },
  async crib(doc) { // детская кроватка 0.95×0.6×0.95, решётки
    const wood = mat(doc, 'wood', [0.93, 0.88, 0.8]), mat2 = mat(doc, 'mattress', [0.62, 0.78, 0.92]), blanket = mat(doc, 'blanket', [0.95, 0.72, 0.78]);
    const W = G(), L = 0.95, D = 0.6, H = 0.95;
    for (const x of [-L / 2 + 0.025, L / 2 - 0.025]) for (const z of [-D / 2 + 0.025, D / 2 - 0.025]) addBox(W, x, 0, z, 0.05, H, 0.05);
    for (const y of [0.3, H - 0.04]) { addBox(W, 0, y, -D / 2 + 0.025, L, 0.04, 0.035); addBox(W, 0, y, D / 2 - 0.025, L, 0.04, 0.035); addBox(W, -L / 2 + 0.025, y, 0, 0.035, 0.04, D); addBox(W, L / 2 - 0.025, y, 0, 0.035, 0.04, D); }
    for (let i = 1; i < 12; i++) { const x = -L / 2 + i * L / 12; addBox(W, x, 0.3, -D / 2 + 0.025, 0.02, H - 0.34, 0.02); addBox(W, x, 0.3, D / 2 - 0.025, 0.02, H - 0.34, 0.02); }
    for (let i = 1; i < 7; i++) { const z = -D / 2 + i * D / 7; addBox(W, -L / 2 + 0.025, 0.3, z, 0.02, H - 0.34, 0.02); addBox(W, L / 2 - 0.025, 0.3, z, 0.02, H - 0.34, 0.02); }
    const M = G(); addBox(M, 0, 0.3, 0, L - 0.08, 0.1, D - 0.08);
    const B = G(); addBox(B, 0.12, 0.4, 0, L * 0.5, 0.03, D - 0.1);
    return meshNode(doc, 'crib', [[W, wood], [M, mat2], [B, blanket]]);
  },
  async tombstone(doc) { // надгробная плита с полукруглым верхом и цоколем, лицо в +Z
    const stone = mat(doc, 'stone', [0.52, 0.53, 0.55], { rough: 0.95 }), dark = mat(doc, 'stoneDark', [0.3, 0.31, 0.33], { rough: 0.9 }), grass = mat(doc, 'soil', [0.33, 0.25, 0.17], { rough: 1 });
    const g = G(); addBox(g, 0, 0, 0, 0.7, 0.12, 0.34);   // цоколь
    addBox(g, 0, 0.12, -0.02, 0.56, 0.52, 0.14);          // плита
    const top = G(); // полукруг: цилиндр вдоль Z
    { const b = top.pos.length / 3, n = 12, r = 0.28, y0 = 0.64, z0 = -0.09, z1 = 0.05; for (let i = 0; i <= n; i++) { const a = Math.PI * i / n, x = Math.cos(a) * r, y = y0 + Math.sin(a) * r; top.pos.push(x, y, z0, x, y, z1); top.nor.push(Math.cos(a), Math.sin(a), 0, Math.cos(a), Math.sin(a), 0); top.uv.push(0, 0, 0, 0); }
      for (let i = 0; i < n; i++) { const a = b + i * 2; top.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      for (const [z, nz] of [[z1, 1], [z0, -1]]) { const c = top.pos.length / 3; top.pos.push(0, y0, z); top.nor.push(0, 0, nz); top.uv.push(0, 0); for (let i = 0; i <= n; i++) { const a = Math.PI * i / n; top.pos.push(Math.cos(a) * r, y0 + Math.sin(a) * r, z); top.nor.push(0, 0, nz); top.uv.push(0, 0); } for (let i = 0; i < n; i++) nz > 0 ? top.idx.push(c, c + 1 + i, c + 2 + i) : top.idx.push(c, c + 2 + i, c + 1 + i); } }
    const plaque = G(); addBox(plaque, 0, 0.36, 0.052, 0.36, 0.26, 0.006);
    const mound = G(); addBox(mound, 0, 0, 0.36, 0.6, 0.05, 0.4);
    return meshNode(doc, 'tombstone', [[g, stone], [top, stone], [plaque, dark], [mound, grass]]);
  },
  async stairs(doc) { // прямой марш 1×4: низ у +Z (лицо rot=0), верх у −Z на высоте 3 м; 15 ступеней, сплошные (ходибельные)
    const wood = mat(doc, 'woodStairs', [0.6, 0.4, 0.23]), side = mat(doc, 'stringer', [0.9, 0.88, 0.84]), rail = mat(doc, 'rail', [0.35, 0.22, 0.12]);
    const T = G(), S = G(), R = G(); const N = 15, rise = 3 / N, run = 4 / N, W = 0.96;
    for (let i = 0; i < N; i++) { const zc = 2 - run * (i + 0.5); addBox(T, 0, 0, zc, W - 0.08, rise * (i + 1), run); }
    for (const x of [-(W / 2 - 0.02), W / 2 - 0.02]) for (let i = 0; i < N; i++) { const zc = 2 - run * (i + 0.5); addBox(S, x, 0, zc, 0.04, rise * (i + 1) + 0.05, run); }
    // перила по стороне +X: стойки на каждой 3-й ступени + наклонный поручень из сегментов
    const rx = W / 2 - 0.02;
    for (let i = 0; i < N; i += 3) { const zc = 2 - run * (i + 0.5); addBox(R, rx, rise * (i + 1), zc, 0.035, 0.9, 0.035); }
    for (let i = 0; i < N; i++) { const zc = 2 - run * (i + 0.5); addBox(R, rx, rise * (i + 1) + 0.88, zc, 0.05, 0.05, run + 0.005); }
    return meshNode(doc, 'stairs', [[T, wood], [S, side], [R, rail]]);
  },
};

// ---------- recipes ----------
// parts: {k: kenneyName | pp: polyPizzaId | proc: name, at:[x,y,z] (source units), ry: deg, s: scale mult, keep: [nodeNames]}
// ry: whole-model yaw (deg) applied before normalization so the front faces +Z.
// scale: fixed uniform scale (default K for Kenney, 1 for proc); h: target height (m) overrides scale; clamp to fp*0.98 always.
const R = {
  fridge:       { parts: [{ k: 'kitchenFridgeLarge' }] },
  stove:        { parts: [{ k: 'kitchenStove' }] },
  counter:      { parts: [{ k: 'kitchenCabinetDrawer' }] },
  kitchen_sink: { parts: [{ k: 'kitchenSink' }] },
  dining_table: { parts: [{ k: 'table' }] },
  dining_chair: { parts: [{ k: 'chairCushion' }], scale: 2.2 },
  trash_can:    { parts: [{ k: 'trashcan' }], h: 0.6 },
  sofa:         { parts: [{ k: 'loungeSofa' }] },
  armchair:     { parts: [{ k: 'loungeChair' }] },
  coffee_table: { parts: [{ k: 'tableCoffee' }] },
  tv:           { parts: [{ k: 'sideTable' }, { k: 'televisionVintage', at: [0.06, 0.38, 0.02] }, { k: 'televisionAntenna', at: [0.265, 0.65, -0.12] }] },
  stereo:       { parts: [{ k: 'sideTable' }, { k: 'radio', at: [0.11, 0.38, -0.06] }, { k: 'speakerSmall', at: [0.0, 0.38, -0.17] }, { k: 'speakerSmall', at: [0.38, 0.38, -0.17] }] },
  bookshelf:    { parts: [{ k: 'bookcaseOpen' }, { k: 'books', at: [0.03, 0.13, -0.05] }, { k: 'books', at: [0.21, 0.13, -0.05] }, { k: 'books', at: [0.05, 0.37, -0.05] }, { k: 'books', at: [0.2, 0.61, -0.05] }, { k: 'books', at: [0.03, 0.61, -0.05] }, { k: 'books', at: [0.22, 0.37, -0.05] }] },
  computer_desk:{ parts: [{ k: 'desk' }, { k: 'computerScreen', at: [0.17, 0.38, -0.33] }, { k: 'computerKeyboard', at: [0.22, 0.38, -0.12] }, { k: 'computerMouse', at: [0.56, 0.38, -0.12] }] },
  chess:        { parts: [{ proc: 'chess' }], scale: 1 },
  phone:        { parts: [{ proc: 'phone' }], scale: 1, surface: true },
  bed_single:   { parts: [{ k: 'bedSingle' }] },
  bed_double:   { parts: [{ k: 'bedDouble' }] },
  dresser:      { parts: [{ k: 'cabinetBedDrawer' }], h: 0.9 },
  mirror:       { parts: [{ k: 'bathroomMirror' }], wall: 'back', yOffset: 1.0 },
  toilet:       { parts: [{ k: 'toilet' }] },
  shower:       { parts: [{ k: 'shower' }] },
  bathtub:      { parts: [{ k: 'bathtub' }] },
  bath_sink:    { parts: [{ k: 'bathroomSink' }], h: 0.9 },
  floor_lamp:   { parts: [{ k: 'lampRoundFloor' }] },
  painting:     { parts: [{ proc: 'painting' }], scale: 1, wall: 'back', yOffset: 1.3 },
  plant:        { parts: [{ k: 'pottedPlant' }] },
  rug:          { parts: [{ k: 'rugRectangle' }], stretch: true },
  mailbox:      { parts: [{ pp: '2olZ0G8iur' }], h: 1.2 },
  door:         { parts: [{ k: 'doorway' }], wall: 'center', fitWH: [0.98, 2.2] },
  window:       { parts: [{ k: 'wallWindow', keep: ['window'] }], wall: 'center', fitWH: [0.96, 1.2], yOffset: 0.9 },
  // — Волна 2 (процедурные) —
  exercise_bench:{ parts: [{ proc: 'exercise_bench' }], scale: 1 },
  easel:        { parts: [{ proc: 'easel' }], scale: 1 },
  smoke_alarm:  { parts: [{ proc: 'smoke_alarm' }], scale: 1, wall: 'back', yOffset: 2.3 },
  burglar_alarm:{ parts: [{ proc: 'burglar_alarm' }], scale: 1, wall: 'back', yOffset: 1.5 },
  crib:         { parts: [{ proc: 'crib' }], scale: 1 },
  tombstone:    { parts: [{ proc: 'tombstone' }], scale: 1 },
  stairs:       { parts: [{ proc: 'stairs' }], scale: 1, exact: true },
};
export const RECIPES = R;
const ROT = JSON.parse(fs.existsSync('rot.json') ? fs.readFileSync('rot.json') : '{}');

async function loadPart(doc, part) {
  if (part.proc) { const n = await PROC[part.proc](doc); return [n]; }
  const file = part.k ? KDIR + part.k + '.glb' : 'pp/' + part.pp + '.glb';
  const src = await io.read(file);
  const map = mergeDocuments(doc, src);
  const sScene = src.getRoot().listScenes()[0];
  let roots = sScene.listChildren().map(n => map.get(n));
  if (part.keep) { // keep only named subtrees
    const found = []; for (const r of roots) r.traverse(n => { if (part.keep.includes(n.getName())) found.push(n); });
    for (const f of found) { const p = f.getParentNode(); if (p) p.removeChild(f); }
    // bake parent transform: parents at identity assumed except translation, compose world matrix
    roots = found;
  }
  for (const s of doc.getRoot().listScenes().slice(1)) s.dispose();
  return roots;
}

async function build(id) {
  const r = R[id];
  const doc = new Document(); doc.createBuffer(); const scene = doc.createScene(id);
  const rot = doc.createNode('rot'); const outer = doc.createNode(id).addChild(rot); scene.addChild(outer);
  let kenney = false;
  for (const part of r.parts) {
    if (part.k) kenney = true;
    const g = doc.createNode(part.k || part.pp || part.proc).setTranslation(part.at || [0, 0, 0]);
    if (part.ry) g.setRotation([0, Math.sin(part.ry * D2R / 2), 0, Math.cos(part.ry * D2R / 2)]);
    if (part.s) g.setScale([part.s, part.s, part.s]);
    for (const n of await loadPart(doc, part)) g.addChild(n);
    rot.addChild(g);
  }
  const ry = (ROT[id] ?? r.ry ?? 0) * D2R;
  rot.setRotation([0, Math.sin(ry / 2), 0, Math.cos(ry / 2)]);
  const b = getBounds(scene); const size = b.max.map((v, i) => v - b.min[i]);
  const def = CAT[id]; const fp = def.fp;
  let s = r.scale ?? (kenney || r.parts[0].pp ? K : 1);
  if (r.h) s = r.h / size[1];
  let sv;
  if (r.fitWH) { const sw = r.fitWH[0] / size[0], sh = r.fitWH[1] / size[1]; sv = [sw, sh, (sw + sh) / 2]; }
  else if (r.stretch) sv = [fp[0] * 0.95 / size[0], 1.5, fp[1] * 0.95 / size[2]];
  else {
    if (!r.wall && !r.surface && !r.exact) s = Math.min(s, fp[0] * 0.98 / size[0], fp[1] * 0.98 / size[2]);
    if (r.wall) s = Math.min(s, 0.98 / size[0]);
    sv = [s, s, s];
  }
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  let tz = -cz * sv[2];
  if (r.wall === 'back') tz = -b.min[2] * sv[2];
  outer.setScale(sv).setTranslation([-cx * sv[0], -b.min[1] * sv[1], tz]);
  for (const m of doc.getRoot().listMaterials()) {
    m.setExtension('KHR_materials_unlit', null);
    if (!m.getBaseColorTexture()) { m.setMetallicFactor(0); m.setRoughnessFactor(/glass/i.test(m.getName()) ? 0.2 : 0.75); }
  }
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'KHR_materials_unlit') e.dispose();
  const b0 = doc.getRoot().listBuffers()[0]; for (const a of doc.getRoot().listAccessors()) a.setBuffer(b0); doc.getRoot().listBuffers().slice(1).forEach(x => x.dispose());
  await doc.transform(prune(), dedup());
  const fb = getBounds(scene);
  const file = `${OUT}/${id}.glb`;
  await io.write(file, doc);
  const out = { id, file, scale: +sv[0].toFixed(3), size: fb.max.map((v, i) => +(v - fb.min[i]).toFixed(3)), min: fb.min.map(v => +v.toFixed(3)), bytes: fs.statSync(file).size, yOffset: r.yOffset || 0, wall: r.wall || null, surface: !!r.surface };
  console.log(JSON.stringify(out));
  return out;
}

const { CATALOG } = await import(process.env.CATALOG || '/Users/egurvanov/python/sims/data/catalog.js');
const CAT = Object.fromEntries(CATALOG.map(d => [d.id, d]));
const results = [];
for (const id of Object.keys(R)) if (!ONLY || ONLY.includes(id)) results.push(await build(id));
const missing = CATALOG.map(d => d.id).filter(id => !R[id]);
if (missing.length) console.log('MISSING', missing);
fs.writeFileSync(`${OUT}/_build.json`, JSON.stringify(results, null, 1));
