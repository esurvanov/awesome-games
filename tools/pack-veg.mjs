#!/usr/bin/env node
/* pack-veg.mjs — builds the vegetation asset set used by modules/vegetation.js
 *
 *   node tools/pack-veg.mjs
 *
 * 1. assets/pack/veg_set.js   one GLB (base64 pack) with the geometry of the 7 new conifers, 4 grass tufts and 3 dwarf
 *                             shrubs. Textures are stripped (each tree GLB embedded its own copy of the same atlas/bark):
 *                             every mesh keeps its material name + alpha mode + base colour factor, the textures come
 *                             from the shared files below. Top-level nodes are named after the source asset.
 * 2. assets/veg/*.png|jpg     shared textures: needle atlas, pine/dead bark, tuft cards, shrub leaves, lichen/moss decals,
 *                             7 billboard atlases (4x2 cells, 8 views).
 * 3. assets/pack/rock_namaqualand_boulder_02.js, rock_rock_face_02.js   the scans as-is (textures embedded).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IN2 = path.join(ROOT, 'assets/incoming2'), IN1 = path.join(ROOT, 'assets/incoming/models');
const OUTT = path.join(ROOT, 'assets/veg'), OUTP = path.join(ROOT, 'assets/pack');
fs.mkdirSync(OUTT, { recursive: true });

function readGlb(file) {
  const b = fs.readFileSync(file);
  const jl = b.readUInt32LE(12), json = JSON.parse(b.slice(20, 20 + jl).toString());
  const bo = 20 + jl, bl = b.readUInt32LE(bo);
  return { json, bin: b.slice(bo + 8, bo + 8 + bl) };
}
const pad4 = (n) => (n + 3) & ~3;

const TREES = ['tree_spruce_snowladen', 'tree_spruce_young_dusted', 'tree_spruce_dense_tall', 'tree_fir_windbent', 'tree_spruce_krummholz', 'tree_pine_scots', 'tree_snag_dead'];
const TUFTS = ['veg_tuft_dry_tussock', 'veg_tuft_sedge', 'veg_tuft_seedgrass', 'veg_tuft_frosted'];
const SHRUBS = ['veg_shrub_dwarf_birch', 'veg_shrub_dwarf_willow', 'veg_shrub_crowberry'];
const DECALS = ['veg_decal_lichen_pale', 'veg_decal_moss_olive', 'veg_decal_lichen_orange'];

// ---- merged geometry GLB ----
const out = { asset: { version: '2.0', generator: 'pack-veg.mjs' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
const chunks = []; let off = 0;
function addView(src, bv, target) {
  const data = src.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  const o = { buffer: 0, byteOffset: off, byteLength: data.length }; if (bv.byteStride) o.byteStride = bv.byteStride; if (target) o.target = target;
  chunks.push(data); const p = pad4(data.length) - data.length; if (p) chunks.push(Buffer.alloc(p)); off += pad4(data.length);
  out.bufferViews.push(o); return out.bufferViews.length - 1;
}
const extracted = {};
function extractImage(name, g, texIndex, fname) {
  const t = g.json.textures[texIndex], img = g.json.images[t.source], bv = g.json.bufferViews[img.bufferView];
  const data = g.bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  const ext = img.mimeType === 'image/png' ? '.png' : '.jpg', file = fname + ext;
  fs.writeFileSync(path.join(OUTT, file), data); extracted[file] = data.length; return file;
}
function addAsset(name, file, texNames) {
  const g = readGlb(file), J = g.json;
  const accMap = new Map(), matMap = new Map(), nodeMap = new Map(), bvMap = new Map();
  const acc = (i) => {
    if (accMap.has(i)) return accMap.get(i);
    const a = Object.assign({}, J.accessors[i]), sb = a.bufferView;
    if (!bvMap.has(sb)) bvMap.set(sb, addView(g.bin, J.bufferViews[sb], J.bufferViews[sb].target));
    a.bufferView = bvMap.get(sb);
    out.accessors.push(a); accMap.set(i, out.accessors.length - 1); return out.accessors.length - 1;
  };
  const mat = (i) => {
    if (matMap.has(i)) return matMap.get(i);
    const m = J.materials[i], pbr = m.pbrMetallicRoughness || {}, n = { name: m.name, pbrMetallicRoughness: {}, extras: {} };
    if (pbr.baseColorFactor) n.pbrMetallicRoughness.baseColorFactor = pbr.baseColorFactor;
    n.pbrMetallicRoughness.metallicFactor = 0; n.pbrMetallicRoughness.roughnessFactor = pbr.roughnessFactor != null ? pbr.roughnessFactor : 1;
    if (m.alphaMode) n.alphaMode = m.alphaMode; if (m.alphaCutoff != null) n.alphaCutoff = m.alphaCutoff; if (m.doubleSided) n.doubleSided = true;
    const tt = pbr.baseColorTexture && pbr.baseColorTexture.extensions && pbr.baseColorTexture.extensions.KHR_texture_transform;
    if (tt) n.extras.uvScale = tt.scale || [1, 1];
    if (texNames && texNames[m.name]) n.extras.map = texNames[m.name];
    out.materials.push(n); matMap.set(i, out.materials.length - 1); return out.materials.length - 1;
  };
  const node = (i) => {
    const s = J.nodes[i], n = { name: s.name };
    for (const k of ['translation', 'rotation', 'scale', 'matrix']) if (s[k]) n[k] = s[k];
    if (s.mesh != null) {
      const M = J.meshes[s.mesh];
      out.meshes.push({ name: M.name || s.name, primitives: M.primitives.map((p) => {
        const q = { attributes: {} }; for (const k in p.attributes) if (/^(POSITION|NORMAL|TEXCOORD_0|COLOR_0)$/.test(k)) q.attributes[k] = acc(p.attributes[k]);
        if (p.indices != null) q.indices = acc(p.indices); if (p.material != null) q.material = mat(p.material); if (p.mode != null) q.mode = p.mode; return q; }) });
      n.mesh = out.meshes.length - 1;
    }
    out.nodes.push(n); const id = out.nodes.length - 1; nodeMap.set(i, id);
    if (s.children) n.children = s.children.map(node);
    return id;
  };
  const roots = J.scenes[J.scene || 0].nodes.map(node);
  out.nodes.push({ name, children: roots }); out.scenes[0].nodes.push(out.nodes.length - 1);
  return g;
}

// trees: needles atlas + barks shared, extracted once
for (const t of TREES) {
  const g = addAsset(t, path.join(IN2, 'models', t + '.glb'));
  const J = g.json, bark = J.materials.find((m) => m.name === 'bark'), ndl = J.materials.find((m) => m.name === 'needles');
  const kind = t === 'tree_snag_dead' ? 'dead' : 'pine';
  if (!fs.existsSync(path.join(OUTT, `bark_${kind}_color.jpg`)) || !extracted[`bark_${kind}_color.jpg`]) {
    extractImage(t, g, bark.pbrMetallicRoughness.baseColorTexture.index, `bark_${kind}_color`);
    extractImage(t, g, bark.normalTexture.index, `bark_${kind}_normal`);
  }
  if (!extracted['foliage_atlas.png']) extractImage(t, g, ndl.pbrMetallicRoughness.baseColorTexture.index, 'foliage_atlas');
  fs.copyFileSync(path.join(IN2, 'textures', t + '_billboard.png'), path.join(OUTT, t + '_billboard.png'));
}
for (const t of TUFTS) { const g = addAsset(t, path.join(IN2, 'models', t + '.glb')); extractImage(t, g, 0, t); }
for (const t of SHRUBS) {
  const g = addAsset(t, path.join(IN2, 'models', t + '.glb'));
  const J = g.json, lv = J.materials.find((m) => m.name === 'leaves'), bk = J.materials.find((m) => m.name === 'bark');
  extractImage(t, g, lv.pbrMetallicRoughness.baseColorTexture.index, t + '_leaf');
  if (!extracted['shrub_bark.jpg']) extractImage(t, g, bk.pbrMetallicRoughness.baseColorTexture.index, 'shrub_bark');
}
for (const t of DECALS) { const g = readGlb(path.join(IN2, 'models', t + '.glb')); extractImage(t, g, 0, t); }

const bin = Buffer.concat(chunks); out.buffers.push({ byteLength: bin.length });
let js = Buffer.from(JSON.stringify(out)); const jp = pad4(js.length) - js.length; if (jp) js = Buffer.concat([js, Buffer.alloc(jp, 0x20)]);
const glb = Buffer.alloc(12 + 8 + js.length + 8 + bin.length);
glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
glb.writeUInt32LE(js.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); js.copy(glb, 20);
glb.writeUInt32LE(bin.length, 20 + js.length); glb.writeUInt32LE(0x004e4942, 24 + js.length); bin.copy(glb, 28 + js.length);
const pack = (name, buf) => { fs.writeFileSync(path.join(OUTP, name + '.js'), `(window.__PACK = window.__PACK || {})['${name}'] = '${buf.toString('base64')}';\n`); return Math.round(buf.length / 1024); };
console.log('veg_set.glb', pack('veg_set', glb), 'KB,', out.meshes.length, 'meshes,', out.materials.length, 'materials');
for (const r of ['rock_namaqualand_boulder_02', 'rock_rock_face_02']) console.log(r, pack(r, fs.readFileSync(path.join(IN1, r + '.glb'))), 'KB');
console.log('textures', Object.entries(extracted).map(([k, v]) => `${k} ${Math.round(v / 1024)}K`).join(', '));
