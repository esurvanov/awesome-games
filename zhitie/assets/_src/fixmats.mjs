// Пост-обработка всех GLB в папках: metallicFactor по умолчанию (1) → 0 (или 0.4 для «металлических» имён),
// бирюзовая листва (Kenney Nature) → зелёная. node fixmats.mjs dir...
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import fs from 'fs'; import path from 'path';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const toS = (v) => v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055, toL = (v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
function hsv(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; } return [h, mx ? d / mx : 0, mx]; }
function rgb(h, s, v) { const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c; const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]; return [r + m, g + m, b + m]; }
let files = 0, mats = 0, leaves = 0;
for (const dir of process.argv.slice(2)) for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.glb'))) {
  const p = path.join(dir, f); const doc = await io.read(p); let ch = false;
  for (const m of doc.getRoot().listMaterials()) {
    if (!m.getMetallicRoughnessTexture() && m.getMetallicFactor() > 0.95) { m.setMetallicFactor(/metal|steel|chrome|iron/i.test(m.getName()) ? 0.4 : 0); if (m.getRoughnessFactor() > 0.95) m.setRoughnessFactor(0.8); ch = true; mats++; }
    if (/leaf|leafs|leaves|grass|plant|bush|hedge/i.test(m.getName()) && !m.getBaseColorTexture()) {
      const c = m.getBaseColorFactor(); const [h, s, v] = hsv(toS(c[0]), toS(c[1]), toS(c[2]));
      if (h > 140 && h < 200) { const [r, g, b] = rgb(h - 50, Math.min(1, s * 1.05), v); m.setBaseColorFactor([toL(r), toL(g), toL(b), c[3]]); ch = true; leaves++; } }
  }
  if (ch) { await io.write(p, doc); files++; }
}
console.log('files', files, 'materials metal→0', mats, 'leaves recoloured', leaves);
