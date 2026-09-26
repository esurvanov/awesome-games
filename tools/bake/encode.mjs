#!/usr/bin/env node
/* encode.mjs — bake output (tools/bake/out/bake/) → assets/baked/ (what the game ships). See BAKE.md.
 *
 *   node tools/bake/encode.mjs [--in tools/bake/out] [--out assets/baked] [--mode etc1s|uastc] [--q 190]
 *
 * Needs the Basis Universal CLI (`brew install basis_universal` → basisu). Per baked PNG:
 *   <name>.ktx2      KTX2 / Basis Universal (ETC1S by default: lightmaps are smooth; --mode uastc for max quality),
 *                    mipmapped, rows flipped (-y_flip) so row 0 = v 0 = the bake's UV origin (three samples
 *                    compressed textures with flipY = false: uv (u, v) → texel (u·w, v·h) from the first row).
 *   <name>.ktx2.js   the same bytes as a base64 JS pack — .ktx2 is not an artifact-served file type:
 *                    (window.__PACK = window.__PACK || {})['baked/<name>'] = '<base64>'
 * plus
 *   uv2.js           per-corner UV2 of every baked mesh (Uint16 normalised, pairs, exported index order) as one pack
 *                    'baked/uv2'; manifest.json gives each object's byte offset + corner count
 *   treeao.js        per-vertex crown AO + sky visibility of every tree part (Uint8 pairs), pack 'baked/treeao'
 *   basis_wasm.js    the three@0.186.1 Basis transcoder wasm as a pack 'basis_wasm' (CSP: no cross-origin fetch)
 *   manifest.json    everything the runtime needs to find and apply the bakes (BAKE.md §Runtime)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GAME } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const IN = path.resolve(opt('in', path.join(GAME, 'tools', 'bake', 'out')));
const BK = path.join(IN, 'bake');
const OUT = path.resolve(opt('out', path.join(GAME, 'assets', 'baked')));
const MODE = String(opt('mode', 'etc1s'));
const Q = Number(opt('q', 190));
const BASISU = opt('basisu', '/opt/homebrew/bin/basisu');
fs.mkdirSync(OUT, { recursive: true });
const tmp = path.join(IN, 'ktx2'); fs.mkdirSync(tmp, { recursive: true });

const R = JSON.parse(fs.readFileSync(path.join(BK, 'bake.json'), 'utf8'));
const EXP = JSON.parse(fs.readFileSync(path.join(IN, 'export.json'), 'utf8'));
const sizes = {};
const pack = (key, buf, file) => {
  const js = `(window.__PACK=window.__PACK||{})[${JSON.stringify(key)}]='${Buffer.from(buf).toString('base64')}';\n`;
  fs.writeFileSync(path.join(OUT, file), js); sizes[file] = js.length; return file;
};

function ktx2(name, { mode = MODE, linear = true, q = Q } = {}) {
  const src = path.join(BK, 'png', name + '.png'); if (!fs.existsSync(src)) throw new Error('missing ' + src);
  const dst = path.join(tmp, name + '.ktx2');
  const args = ['-ktx2', '-mipmap', '-y_flip', '-file', src, '-output_file', dst];
  if (linear) args.push('-linear');   // values are already gamma-encoded by bake.py; no sRGB transfer flag, the runtime decodes
  if (mode === 'uastc') args.push('-uastc', '-uastc_level', '2', '-uastc_rdo_l', '0.75', '-ktx2_zstandard_level', '18');
  else args.push('-q', String(q), '-comp_level', '2');
  const t0 = Date.now();
  execFileSync(BASISU, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const b = fs.readFileSync(dst); sizes[name + '.ktx2'] = b.length;
  fs.copyFileSync(dst, path.join(OUT, name + '.ktx2'));
  pack('baked/' + name, b, name + '.ktx2.js');
  console.log(`[encode] ${name}.ktx2 ${(b.length / 1024).toFixed(0)} KB (${mode}) ${Date.now() - t0} ms`);
  return name;
}

const man = {
  version: 1, date: R.date, source: { export: EXP.date, blender: R.blender, samples: R.samples },
  encoding: {
    rgb: 'gamma-2.2 of (irradiance / scale): linear = pow(texel.rgb, 2.2) * scale — Cycles "diffuse lighting, no colour" units; three lightMap irradiance = PI * that',
    a: 'moon visibility 0..1 (linear) from static casters',
    uv: 'row 0 = v 0 (KTX2 flipped at encode); terrain / tiles: uv = (worldXZ - origin) / size; objects: uv1 = UV2 sidecar',
    ktx2: MODE, pack: "(window.__PACK)['baked/<file>'] = base64 KTX2",
  },
  env: EXP.env,
  terrain: null, tileAtlas: null, atlases: [], instanced: [], trees: null, files: {},
};
if (R.terrain) { ktx2(R.terrain.file); man.terrain = Object.assign({}, R.terrain, { pack: R.terrain.file + '.ktx2.js' }); }
// R.tiles is always [] (bake.py never fills it — the POI tiles are assembled into ONE atlas, R.tileAtlas); the
// runtime (runtime/baked.js) reads man.tileAtlas, singular, same shape as man.terrain plus a `tiles` cell list.
if (R.tileAtlas) { ktx2(R.tileAtlas.file); man.tileAtlas = Object.assign({}, R.tileAtlas, { pack: R.tileAtlas.file + '.ktx2.js' }); }

// UV2: one Uint16 buffer for atlas objects and instanced geometries
const uvChunks = []; let uvOff = 0;
const addUV = (rel) => {
  // fs.readFileSync's Buffer may be a view into node's internal pool (byteOffset > 0, .buffer bigger than the file):
  // slice on the Buffer view, not .buffer directly, or a small uv2 file silently reads garbage past its own bytes.
  const raw = fs.readFileSync(path.join(BK, rel));
  const f = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const u = new Uint16Array(f.length); for (let i = 0; i < f.length; i++) u[i] = Math.round(Math.min(1, Math.max(0, f[i])) * 65535);
  const e = { offset: uvOff, corners: f.length / 2 }; uvChunks.push(Buffer.from(u.buffer)); uvOff += u.byteLength; return e;
};
for (const a of R.atlases || []) {
  ktx2(a.file);
  man.atlases.push({ file: a.file, pack: a.file + '.ktx2.js', res: a.res, scale: a.scale, objects: a.objects.map((o) => Object.assign({ id: o.id }, addUV(o.uv2))) });
}
for (const g of R.instanced || []) {
  ktx2(g.file, { q: 128 });
  man.instanced.push({ file: g.file, pack: g.file + '.ktx2.js', res: g.res, ids: g.ids, mean: g.mean, uv2: addUV(g.uv2) });
}
if (uvChunks.length) { pack('baked/uv2', Buffer.concat(uvChunks), 'uv2.js'); man.uv2 = { pack: 'uv2.js', key: 'baked/uv2', format: 'Uint16 normalised (u, v) per corner, in the exported index order (use geometry.toNonIndexed())', bytes: uvOff }; }

// tree AO (per vertex, Uint8 × 2: full-sphere AO, upper-hemisphere sky visibility)
if ((R.trees || []).length) {
  const ch = []; let off = 0; man.trees = { pack: 'treeao.js', key: 'baked/treeao', format: 'Uint8 (ao, sky) per vertex, exported vertex order', parts: [] };
  for (const t of R.trees) { const b = fs.readFileSync(path.join(BK, t.file)); man.trees.parts.push({ id: t.id, species: t.species, offset: off, verts: t.verts, meanAO: t.meanAO, meanSky: t.meanSky }); ch.push(b); off += b.length; }
  pack('baked/treeao', Buffer.concat(ch), 'treeao.js');
}

// transcoder wasm (three@0.186.1) as a pack
{
  const w = opt('wasm', path.join(IN, 'basis_transcoder.wasm'));
  if (fs.existsSync(w)) pack('basis_wasm', fs.readFileSync(w), 'basis_wasm.js');
  else console.warn('[encode] no basis_transcoder.wasm at', w, '— fetch it from cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/libs/basis/');
}

man.files = sizes;
const shipped = Object.entries(sizes).filter(([k]) => k.endsWith('.js')).reduce((s, [, v]) => s + v, 0);
const ktx = Object.entries(sizes).filter(([k]) => k.endsWith('.ktx2')).reduce((s, [, v]) => s + v, 0);
man.totals = { packsBytes: shipped, ktx2Bytes: ktx };
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(man, null, 1));
console.log(`[encode] packs ${(shipped / 1e6).toFixed(2)} MB · raw ktx2 ${(ktx / 1e6).toFixed(2)} MB · ${Object.keys(sizes).length} files → ${OUT}`);
