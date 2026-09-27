// Вписывает сгенерированный блок SHAPES/KIND_SHAPES/HOOD в js/render/manifest.js между маркерами.
import fs from 'fs';
const [,, libJson, manifest] = process.argv;
const L = JSON.parse(fs.readFileSync(libJson));
const PREF = [/^carpet$/, /^carpetBlue$/, /fabric|cushion|pad$|seat|felt|cloth|blanket|chairSeat/i, /^wood$/, /^woodDark$/, /colormap/, /lacquer|toyWood|vase|frame|box|binGreen|hydrant|guitarBody|tube/i];
const NOT = /glass|metal|steel|brass|gold|screen|display|water|keys|fire|coal|glow|lamp|dial|hands|chain/i;
const lines = [];
for (const r of L) {
  const cand = r.mats.filter(m => !NOT.test(m));
  let tint = null; for (const re of PREF) { tint = cand.find(m => re.test(m)); if (tint) break; } tint ??= cand[0] ?? null;
  const o = { url: `assets/models/lib/${r.key}.glb`, size: r.size, kinds: r.kinds, group: r.group, tint, tintable: cand };
  if (r.wall) o.wall = r.wall; if (r.yOffset) o.yOffset = r.yOffset; if (r.surface) o.surface = true; if (r.ceiling) o.ceiling = true;
  lines.push(`  ${JSON.stringify(r.key)}: ${JSON.stringify(o)},`);
}
const kindShapes = {}; for (const r of L) for (const k of r.kinds) (kindShapes[k] ||= []).push(r.key);
const hood = { trees: [], bushes: [], flowers: [], fences: [], cars: [], houses: [], buildings: [], street: [], park: [], decor: [] };
for (const r of L) { if (r.group === 'furn') continue; const k = r.kinds[0];
  const cat = k === 'tree' ? 'trees' : k === 'hedge' ? 'bushes' : k === 'flowerbed' ? 'flowers' : k === 'fence' ? 'fences' : k === 'car' ? 'cars' : k === 'house' ? 'houses' : k === 'building' ? 'buildings'
    : ['streetlight', 'trash_bin_street', 'mailbox'].includes(k) || /^rd_/.test(r.key) ? 'street' : ['park_bench', 'fountain', 'swing_set', 'sandbox', 'food_stall', 'sculpture', 'pool', 'hot_tub', 'grill'].includes(k) ? 'park' : 'decor';
  hood[cat].push(r.key); }
const block = `// <gen:shapes> — СГЕНЕРИРОВАНО assets/_src/gen-manifest.mjs из assets/models/lib/_lib.json, руками не править
export const SHAPES = {\n${lines.join('\n')}\n};
export const KIND_SHAPES = ${JSON.stringify(kindShapes)};
export const HOOD = ${JSON.stringify(hood)};
// </gen:shapes>`;
let s = fs.readFileSync(manifest, 'utf8');
const a = s.indexOf('// <gen:shapes>'), b = s.indexOf('// </gen:shapes>');
s = a >= 0 ? s.slice(0, a) + block + s.slice(b + '// </gen:shapes>'.length) : s + '\n' + block + '\n';
fs.writeFileSync(manifest, s);
console.log('shapes', L.length, 'kinds', Object.keys(kindShapes).length, Object.fromEntries(Object.entries(hood).map(([k, v]) => [k, v.length])));
