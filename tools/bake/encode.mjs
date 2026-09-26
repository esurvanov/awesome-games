#!/usr/bin/env node
/* encode.mjs — bake output (tools/bake/out/bake/) → assets/baked/ (what the game ships). See BAKE.md.
 *
 *   node tools/bake/encode.mjs [--in tools/bake/out] [--out assets/baked]
 *
 * INT-LIGHT (2026-09-26): dropped KTX2/Basis Universal entirely — under the artifact CSP, the CDN Basis
 * transcoder's own Emscripten glue calls eval()/new Function() somewhere in its startup path, which
 * script-src blocks ('wasm-unsafe-eval' only covers WebAssembly.instantiate, not eval); BAKED.ready never
 * became true (see BAKE.md §A/B, INT-LIGHT.md). Every baked PNG now ships as a PLAIN PNG — an ordinary
 * artifact-served file type, loaded by modules/baked.js with a normal THREE.TextureLoader, same as any other
 * texture in this game (sky.jpg, packs, …): no fetch-to-blob, no worker, no wasm.
 *
 * Per baked target:
 *   <name>.png       the bake.py PNG, copied byte-for-byte (already 8-bit sRGB-curve RGBA — see §Encoding
 *                     in BAKE.md). Loaded with texture.flipY = false in modules/baked.js — bake.py writes
 *                     rows in the same "row 0 = v 0" convention the world-space UV math below assumes, so
 *                     the runtime must NOT apply three's normal flipY=true reversal (that's a `.flipY = false`
 *                     on the loaded Texture, not anything this script needs to do to the file).
 * plus (unchanged from the KTX2-era pipeline — neither is an artifact-served file type, so both still ship as
 * base64 JS sidecars, just as BAKE.md's brief for this task specifies):
 *   uv2.js            per-corner UV2 of every baked mesh (Uint16 normalised, pairs, exported index order),
 *                      pack 'baked/uv2'; manifest.json gives each object's byte offset + corner count
 *   treeao.js         per-vertex crown AO + sky visibility of every tree part (Uint8 pairs), pack 'baked/treeao'
 *   manifest.json     everything the runtime needs to find and apply the bakes (BAKE.md §Runtime)
 *
 * basis_wasm.js / *.ktx2 / *.ktx2.js are no longer produced; any left over from an older bake are removed
 * from --out on each run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { GAME } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const IN = path.resolve(opt('in', path.join(GAME, 'tools', 'bake', 'out')));
const BK = path.join(IN, 'bake');
const OUT = path.resolve(opt('out', path.join(GAME, 'assets', 'baked')));
fs.mkdirSync(OUT, { recursive: true });

// clean any stale KTX2-era output so a re-run never ships both formats at once
for (const f of fs.readdirSync(OUT)) if (/\.ktx2(\.js)?$/.test(f) || f === 'basis_wasm.js') fs.rmSync(path.join(OUT, f));

const R = JSON.parse(fs.readFileSync(path.join(BK, 'bake.json'), 'utf8'));
const EXP = JSON.parse(fs.readFileSync(path.join(IN, 'export.json'), 'utf8'));
const sizes = {};
const pack = (key, buf, file) => {
  const js = `(window.__PACK=window.__PACK||{})[${JSON.stringify(key)}]='${Buffer.from(buf).toString('base64')}';\n`;
  fs.writeFileSync(path.join(OUT, file), js); sizes[file] = js.length; return file;
};

function png(name) {
  const src = path.join(BK, 'png', name + '.png'); if (!fs.existsSync(src)) throw new Error('missing ' + src);
  const dst = path.join(OUT, name + '.png');
  fs.copyFileSync(src, dst); sizes[name + '.png'] = fs.statSync(dst).size;
  console.log(`[encode] ${name}.png ${(sizes[name + '.png'] / 1024).toFixed(0)} KB`);
  return name;
}

const man = {
  version: 2, date: R.date, source: { export: EXP.date, blender: R.blender, samples: R.samples },
  encoding: {
    rgb: 'gamma-2.2 of (irradiance / scale): linear = pow(texel.rgb, 2.2) * scale — Cycles "diffuse lighting, no colour" units; three lightMap irradiance = PI * that',
    a: 'moon visibility 0..1 (linear) from static casters',
    uv: 'row 0 = v 0 — plain PNG loaded with texture.flipY = false (modules/baked.js); terrain / tiles: uv = (worldXZ - origin) / size; objects: uv1 = UV2 sidecar',
    pack: 'plain PNG per file: assets/baked/<file>.png (no KTX2/Basis/WASM) — UV2 and tree AO stay base64 JS packs (not an artifact-served file type)',
  },
  env: EXP.env,
  terrain: null, tileAtlas: null, atlases: [], instanced: [], trees: null, files: {},
};
if (R.terrain) { png(R.terrain.file); man.terrain = Object.assign({}, R.terrain); }
// R.tiles is always [] (bake.py never fills it — the POI tiles are assembled into ONE atlas, R.tileAtlas); the
// runtime (modules/baked.js) reads man.tileAtlas, singular, same shape as man.terrain plus a `tiles` cell list.
if (R.tileAtlas) { png(R.tileAtlas.file); man.tileAtlas = Object.assign({}, R.tileAtlas); }

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
  png(a.file);
  man.atlases.push({ file: a.file, res: a.res, scale: a.scale, objects: a.objects.map((o) => Object.assign({ id: o.id }, addUV(o.uv2))) });
}
for (const g of R.instanced || []) {
  png(g.file);
  man.instanced.push({ file: g.file, res: g.res, ids: g.ids, mean: g.mean, uv2: addUV(g.uv2) });
}
if (uvChunks.length) { pack('baked/uv2', Buffer.concat(uvChunks), 'uv2.js'); man.uv2 = { pack: 'uv2.js', key: 'baked/uv2', format: 'Uint16 normalised (u, v) per corner, in the exported index order (use geometry.toNonIndexed())', bytes: uvOff }; }

// tree AO (per vertex, Uint8 × 2: full-sphere AO, upper-hemisphere sky visibility)
if ((R.trees || []).length) {
  const ch = []; let off = 0; man.trees = { pack: 'treeao.js', key: 'baked/treeao', format: 'Uint8 (ao, sky) per vertex, exported vertex order', parts: [] };
  for (const t of R.trees) { const b = fs.readFileSync(path.join(BK, t.file)); man.trees.parts.push({ id: t.id, species: t.species, offset: off, verts: t.verts, meanAO: t.meanAO, meanSky: t.meanSky }); ch.push(b); off += b.length; }
  pack('baked/treeao', Buffer.concat(ch), 'treeao.js');
}

man.files = sizes;
const shipped = Object.entries(sizes).filter(([k]) => k.endsWith('.js')).reduce((s, [, v]) => s + v, 0);
const png_ = Object.entries(sizes).filter(([k]) => k.endsWith('.png')).reduce((s, [, v]) => s + v, 0);
man.totals = { packsBytes: shipped, pngBytes: png_ };
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(man, null, 1));
console.log(`[encode] packs ${(shipped / 1e6).toFixed(2)} MB · png ${(png_ / 1e6).toFixed(2)} MB · ${Object.keys(sizes).length} files → ${OUT}`);
