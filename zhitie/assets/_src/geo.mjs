// Общие помощники процедурной геометрии для build-lib.mjs / build-cas.mjs (gltf-transform).
import sharp from 'sharp';
export const srgb = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); };
export function mat(doc, name, hex, o = {}) {
  const m = doc.createMaterial(name).setBaseColorFactor([...srgb(hex), o.alpha ?? 1]).setRoughnessFactor(o.rough ?? 0.75).setMetallicFactor(o.metal ?? 0);
  if (o.alpha != null && o.alpha < 1) m.setAlphaMode('BLEND');
  if (o.emissive) m.setEmissiveFactor(srgb(o.emissive));
  if (o.ds) m.setDoubleSided(true);
  return m;
}
export const G = () => ({ pos: [], nor: [], idx: [], uv: [] });
export function box(g, cx, y0, cz, w, h, d) { // центр x/z, низ y0
  const x0 = cx - w / 2, x1 = cx + w / 2, y1 = y0 + h, z0 = cz - d / 2, z1 = cz + d / 2;
  for (const [n, vs] of [[[1,0,0],[[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1]]],[[-1,0,0],[[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]]],[[0,1,0],[[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0]]],[[0,-1,0],[[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]]],[[0,0,1],[[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]]],[[0,0,-1],[[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0]]]]) {
    const b = g.pos.length / 3; for (const v of vs) { g.pos.push(...v); g.nor.push(...n); } g.uv.push(0, 1, 1, 1, 1, 0, 0, 0); g.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
}
// цилиндр/конус; axis 'y' (по умолчанию), 'x' или 'z'; (cx,cy,cz) — центр основания
export function cyl(g, cx, cy, cz, r0, r1, h, n = 12, axis = 'y', caps = true) {
  const P = (a, b, c) => axis === 'y' ? [a, b, c] : axis === 'x' ? [b, a, c] : [a, c, b];
  const b = g.pos.length / 3, sl = (r0 - r1) / h;
  for (let i = 0; i <= n; i++) { const t = i / n * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    const p0 = P(c * r0, 0, s * r0), p1 = P(c * r1, h, s * r1), nn = P(c, sl, s), l = Math.hypot(...nn);
    g.pos.push(cx + p0[0], cy + p0[1], cz + p0[2], cx + p1[0], cy + p1[1], cz + p1[2]); g.nor.push(...nn.map(v => v / l), ...nn.map(v => v / l)); g.uv.push(i / n, 1, i / n, 0); }
  for (let i = 0; i < n; i++) { const a = b + i * 2; g.idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  if (!caps) return;
  for (const [yy, r, sg] of [[0, r0, -1], [h, r1, 1]]) { if (r <= 0) continue; const c0 = g.pos.length / 3; const pc = P(0, yy, 0); g.pos.push(cx + pc[0], cy + pc[1], cz + pc[2]); g.nor.push(...P(0, sg, 0)); g.uv.push(0.5, 0.5);
    for (let i = 0; i <= n; i++) { const t = i / n * Math.PI * 2; const p = P(Math.cos(t) * r, yy, Math.sin(t) * r); g.pos.push(cx + p[0], cy + p[1], cz + p[2]); g.nor.push(...P(0, sg, 0)); g.uv.push(0.5 + Math.cos(t) / 2, 0.5 + Math.sin(t) / 2); }
    for (let i = 0; i < n; i++) sg > 0 ? g.idx.push(c0, c0 + 2 + i, c0 + 1 + i) : g.idx.push(c0, c0 + 1 + i, c0 + 2 + i); }
}
export function sphere(g, cx, cy, cz, rx, ry = rx, rz = rx, n = 10, m = 7, half = false) {
  const b = g.pos.length / 3; const M = m;
  for (let i = 0; i <= M; i++) { const th = half ? (i / M) * Math.PI / 2 : (i / M) * Math.PI; for (let j = 0; j <= n; j++) { const ph = j / n * Math.PI * 2;
    const y = Math.cos(th), r = Math.sin(th), x = r * Math.cos(ph), z = r * Math.sin(ph);
    g.pos.push(cx + x * rx, cy + y * ry, cz + z * rz); const l = Math.hypot(x / rx, y / ry, z / rz); g.nor.push(x / rx / l, y / ry / l, z / rz / l); g.uv.push(j / n, i / M); } }
  for (let i = 0; i < M; i++) for (let j = 0; j < n; j++) { const a = b + i * (n + 1) + j, c = a + n + 1; g.idx.push(a, a + 1, c, a + 1, c + 1, c); }
}
export function quad(g, pts, n) { const b = g.pos.length / 3; for (const p of pts) { g.pos.push(...p); g.nor.push(...n); } g.uv.push(0, 1, 1, 1, 1, 0, 0, 0); g.idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
export function meshNode(doc, name, parts) {
  const buf = doc.getRoot().listBuffers()[0] || doc.createBuffer(); const mesh = doc.createMesh(name);
  const acc = (t, a) => doc.createAccessor().setType(t).setArray(a).setBuffer(buf);
  for (const [g, m] of parts) if (g.idx.length) {
    const big = g.pos.length / 3 > 65000;
    const p = doc.createPrimitive().setMaterial(m).setAttribute('POSITION', acc('VEC3', new Float32Array(g.pos))).setAttribute('NORMAL', acc('VEC3', new Float32Array(g.nor))).setIndices(acc('SCALAR', big ? new Uint32Array(g.idx) : new Uint16Array(g.idx)));
    if (m.getBaseColorTexture()) p.setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(g.uv)));
    mesh.addPrimitive(p);
  }
  return doc.createNode(name).setMesh(mesh);
}
// картины: простые SVG-сюжеты → JPEG
export async function paintingTex(kind = 'birch') {
  const W = 320, H = 240; let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
  let seed = { birch: 7, sea: 3, abstract: 11, still: 5, portrait: 9, sunset: 13 }[kind] || 1; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  if (kind === 'sea') { s += `<rect width="${W}" height="${H*0.5}" fill="#9fcbe8"/><rect y="${H*0.5}" width="${W}" height="${H*0.5}" fill="#2f6f9f"/>`; for (let i = 0; i < 14; i++) s += `<path d="M${r()*W} ${H*0.55+r()*H*0.4} q10 -6 20 0" stroke="#dcefff" stroke-width="2" fill="none"/>`; s += `<circle cx="${W*0.78}" cy="${H*0.2}" r="18" fill="#fff4b0"/><path d="M60 ${H*0.5} l40 -30 l0 30 z" fill="#fff"/><rect x="58" y="${H*0.5}" width="46" height="8" fill="#7a4a2a"/>`; }
  else if (kind === 'abstract') { s += `<rect width="${W}" height="${H}" fill="#f2ede0"/>`; for (let i = 0; i < 9; i++) { const c = ['#d6452f','#2f5fa6','#f2c230','#1d1d1d','#3f8f5a'][i % 5]; s += r() < 0.5 ? `<rect x="${r()*W*0.8}" y="${r()*H*0.8}" width="${30+r()*90}" height="${20+r()*70}" fill="${c}"/>` : `<circle cx="${r()*W}" cy="${r()*H}" r="${10+r()*40}" fill="${c}"/>`; } }
  else if (kind === 'still') { s += `<rect width="${W}" height="${H}" fill="#3b2f2a"/><rect y="${H*0.7}" width="${W}" height="${H*0.3}" fill="#7a5a3a"/><path d="M130 180 q30 -120 60 0 z" fill="#5c7fa6"/>`; for (let i = 0; i < 5; i++) s += `<circle cx="${90+i*35}" cy="${185-(i%2)*8}" r="16" fill="${['#c0392b','#e6b422','#6aa84f','#e67e22','#8e44ad'][i]}"/>`; }
  else if (kind === 'portrait') { s += `<rect width="${W}" height="${H}" fill="#2e3b2f"/><ellipse cx="${W/2}" cy="${H*0.95}" rx="90" ry="70" fill="#3a3550"/><ellipse cx="${W/2}" cy="${H*0.45}" rx="42" ry="54" fill="#e2b89a"/><path d="M${W/2-46} ${H*0.4} q46 -70 92 0 q-10 -40 -46 -42 q-36 2 -46 42z" fill="#4a2f1d"/><circle cx="${W/2-15}" cy="${H*0.44}" r="4" fill="#222"/><circle cx="${W/2+15}" cy="${H*0.44}" r="4" fill="#222"/><path d="M${W/2-12} ${H*0.58} q12 8 24 0" stroke="#8a3a2a" stroke-width="3" fill="none"/>`; }
  else if (kind === 'sunset') { s += `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2a6a"/><stop offset="0.6" stop-color="#f08a4b"/><stop offset="1" stop-color="#f7d36b"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/><circle cx="${W/2}" cy="${H*0.7}" r="34" fill="#ffe28a"/><path d="M0 ${H*0.78} L60 ${H*0.6} L120 ${H*0.75} L200 ${H*0.55} L${W} ${H*0.8} L${W} ${H} L0 ${H}z" fill="#2a2140"/>`; }
  else if (kind === 'cat') { s += `<rect width="${W}" height="${H}" fill="#f2d24a"/><ellipse cx="${W/2}" cy="${H*0.72}" rx="70" ry="55" fill="#e07a2a"/><circle cx="${W/2}" cy="${H*0.4}" r="48" fill="#e07a2a"/><path d="M${W/2-44} ${H*0.3} l8 -40 l24 26z M${W/2+44} ${H*0.3} l-8 -40 l-24 26z" fill="#e07a2a"/><circle cx="${W/2-17}" cy="${H*0.38}" r="7" fill="#222"/><circle cx="${W/2+17}" cy="${H*0.38}" r="7" fill="#222"/><path d="M${W/2-6} ${H*0.47} l6 6 l6 -6z" fill="#c0392b"/><text x="${W/2}" y="${H*0.97}" font-size="26" text-anchor="middle" font-family="sans-serif" font-weight="bold" fill="#222">МЯУ!</text>`; }
  else if (kind === 'carpet') { s += `<rect width="${W}" height="${H}" fill="#7a1f2b"/><rect x="14" y="14" width="${W-28}" height="${H-28}" fill="none" stroke="#e8c26a" stroke-width="8"/><rect x="30" y="30" width="${W-60}" height="${H-60}" fill="#9a2a35" stroke="#1d3b5a" stroke-width="6"/>`; for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) s += `<path d="M${60+i*50} ${60+j*60} l20 -22 l20 22 l-20 22z" fill="${(i+j)%2?'#e8c26a':'#1d3b5a'}"/>`; s += `<circle cx="${W/2}" cy="${H/2}" r="34" fill="#e8c26a"/><circle cx="${W/2}" cy="${H/2}" r="20" fill="#1d3b5a"/>`; }
  else { s += `<rect width="${W}" height="${H}" fill="#a9cbe6"/><rect y="${H*0.62}" width="${W}" height="${H*0.38}" fill="#7fa650"/>`; for (const [x, w] of [[40,9],[78,7],[120,10],[175,8],[215,11],[262,7],[295,9]]) { s += `<ellipse cx="${x}" cy="${H*0.28}" rx="${w*3.2}" ry="${H*0.2}" fill="#9ab84a" opacity="0.85"/><rect x="${x-w/2}" y="0" width="${w}" height="${H*0.72}" fill="#f4f1ea"/>`; for (let k = 0; k < 8; k++) s += `<rect x="${x-w/2}" y="${r()*H*0.7}" width="${w*0.6}" height="3" fill="#2b2b2b"/>`; } }
  s += '</svg>';
  return sharp(Buffer.from(s)).jpeg({ quality: 82 }).toBuffer();
}
