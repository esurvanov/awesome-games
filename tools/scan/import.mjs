#!/usr/bin/env node
/* tools/scan/import.mjs — Scaniverse (or any photogrammetry) exports → game-ready assets, one command.
 *
 *   node tools/scan/import.mjs <folder|file> [options]
 *
 * Mesh files (.glb .gltf .obj .usdz .fbx .stl, mesh .ply) → Blender (scan_blender.py): clean, ground cut, closed shell,
 *   LOD0/1/2, bake albedo/normal/AO from the high-res scan, delight, night grade, GLB → KTX2 variant → base64 packs.
 * Splat files (.spz, gaussian .ply, .splat) → tools/scan/splat.mjs (same options where they apply).
 *
 * Output per asset: <out>/<name>/{<name>.js (JPG pack), <name>_ktx2.js (KTX2 pack), <name>.json, thumb.jpg, thumb_src.jpg}
 *   + <out>/index.json. Default <out> = assets/incoming4/scan. Packs follow MODULES.md: copy <name>.js to assets/pack/ and
 *   ctx.loadPacked('<name>', ASSET, cb); build the LOD with tools/scan/scan-lod.js (ScanLOD.fromGLTF).
 *
 * Options
 *   --out DIR            output root (default assets/incoming4/scan)
 *   --name N             asset name (single file only; default scan_<file base>)
 *   --role R             rock|wood|ice|snow|masonry|metal|prop (default: guessed from the file name)
 *   --tris a,b,c         LOD triangle budgets (default 5000,1500,300)
 *   --tex N              texture size (default 1024; 512 is enough for objects under ~0.6 m)
 *   --height M | --scale S    real size (Scaniverse is metric already: leave both out)
 *   --up AXIS            which axis of the file points to the sky if the scan lies on its side: y (default) -y x -x z -z
 *   --yaw DEG            turn around the vertical axis
 *   --cut-ground V       auto (default) | off | metres above the lowest point
 *   --remesh voxel|none  closed shell via voxel remesh (default) or decimate the scan as is (thin parts: crates, tyres)
 *   --delight-ao K       0..1 how much baked cavity darkening to remove (default 0.6)
 *   --delight-dir K      0..1 how much of the fitted sun/sky gradient to remove (default 1)
 *   --tint K             0..1 strength of the night grade from style.js (default 1)
 *   --no-ktx2            skip the KTX2 variant;  --ktx2-normal uastc  sharper normal map in KTX2 (≈3.5× bigger than ETC1S)
 *   --texture FILE       colour texture for an OBJ whose .mtl is missing (auto: image with the same name / the only image)
 *   --jpeg-q N           JPG quality inside the pack (default 82)
 *   --force              rebuild even if the output is newer than the input
 * Tools: Blender 4.2 LTS ($BLENDER | tools/scan/.bin/Blender.app | /Applications/Blender.app | PATH) and basisu
 *   ($BASISU | tools/scan/.bin/basisu | PATH). tools/scan/setup.sh fetches/builds both.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const FLAGS = new Set(['no-ktx2', 'force']);
const inputArg = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !FLAGS.has(argv[i - 1].slice(2))));
if (!inputArg) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); process.exit(1); }
const OUT = path.resolve(opt('out', path.join(ROOT, 'assets/incoming4/scan')));
const WORK = path.resolve(process.env.SCAN_WORK || path.join(HERE, '.work'));
const log = (...a) => console.log('[scan]', ...a);

/* ------------------------------------------------------------------ tools */
function findTool(envName, cands) {
  if (process.env[envName] && fs.existsSync(process.env[envName])) return process.env[envName];
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  const w = spawnSync('which', [cands.at(-1) ? path.basename(cands.at(-1)) : ''], { encoding: 'utf8' });
  return w.status === 0 ? w.stdout.trim() : null;
}
const BLENDER = findTool('BLENDER', [path.join(HERE, '.bin/Blender.app/Contents/MacOS/Blender'), '/Applications/Blender.app/Contents/MacOS/Blender', 'blender']);
const BASISU = findTool('BASISU', [path.join(HERE, '.bin/basisu'), 'basisu']);

/* ------------------------------------------------------------------ style.js (read only) → role presets */
function readStyle() {
  const ctx = { window: {}, Math }; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'style.js'), 'utf8'), ctx);
  return ctx.window.STYLE;
}
const STYLE = readStyle();
const lin = STYLE.lin, M = STYLE.materials;
const norm3 = (v) => { const m = Math.max(...v); return v.map((x) => +(x / m).toFixed(3)); };
// target = median linear albedo luminance before the grade; grade = desaturate + multiply (applied to albedo, linear)
const ROLES = {
  rock: { targetLum: 0.16, grade: M.rock_basalt.grade, roughness: M.rock_basalt.roughness, metalness: 0, density: 2600, from: 'STYLE.materials.rock_basalt.grade' },
  masonry: { targetLum: 0.18, grade: { desat: M.rock_basalt.grade.desat * 0.8, mul: M.rock_basalt.grade.mul }, roughness: 0.92, metalness: 0, density: 2000, from: 'rock_basalt.grade (desat ×0.8)' },
  wood: { targetLum: 0.12, grade: { desat: 0.35, mul: M.bark.lin }, roughness: M.bark.roughness, metalness: 0, density: 550, from: 'STYLE.materials.bark.lin' },
  ice: { targetLum: 0.35, grade: { desat: 0.5, mul: norm3(M.snow.lin.packedTint) }, roughness: 0.25, metalness: 0, density: 917, from: 'STYLE.materials.snow.lin.packedTint (normalised)' },
  snow: { targetLum: 0.55, grade: { desat: 0.6, mul: norm3(M.snow.lin.onObjects) }, roughness: M.snow_on_objects.roughness, metalness: 0, density: 350, from: 'STYLE.materials.snow.lin.onObjects (normalised)' },
  metal: { targetLum: 0.1, grade: { desat: 0.45, mul: norm3(lin(M.metal_dark.color)) }, roughness: 0.6, metalness: 0.4, density: 1200, from: 'STYLE.materials.metal_dark (normalised); tyres/scrap are mixed → metalness .4' },
  prop: { targetLum: 0.15, grade: { desat: 0.4, mul: M.rock_basalt.grade.mul.map((x) => +(x * 1.15).toFixed(3)) }, roughness: 0.85, metalness: 0, density: 600, from: 'rock_basalt.grade.mul ×1.15' },
};
const GUESS = [[/ice|lyod|лёд|лед/i, 'ice'], [/rock|boulder|stone|pebble|cliff|камень|валун/i, 'rock'], [/snow|sneg|снег|footprint|след/i, 'snow'], [/brick|wall|masonry|ruin|concrete|block|stena|кирпич|стен/i, 'masonry'],
  [/tire|tyre|scrap|metal|shina|barrel|can\b|шин|металл/i, 'metal'], [/stump|log|root|bark|wood|crate|pallet|plank|branch|twig|snag|пень|бревн|корн|кора|ящик|поддон/i, 'wood']];
const guessRole = (n) => (GUESS.find(([re]) => re.test(n)) || [0, 'rock'])[1];
const PUSHABLE = /crate|pallet|tire|tyre|barrel|can\b|scrap|bucket|ящик|поддон|шин|бочк/i;

function passportFor(role, name, m) {
  const [sx, sy, sz] = m.size, foot = Math.max(sx, sz);
  if (role === 'snow' || (sy < 0.25 && foot > 0.8)) return { role: 'passable', why: 'low (< 25 cm) and wide: walk over it', opts: {} };
  const mass = Math.round((m.volume || 0) * ROLES[role].density * (PUSHABLE.test(name) ? 0.2 : 1));
  if (PUSHABLE.test(name) && m.radius < 1.0) return { role: 'pushable', why: 'small hollow prop', opts: { mass: Math.max(5, mass) } };
  return { role: 'solid', why: m.radius > 1.2 ? 'large: exact trimesh' : 'static', opts: { name, shape: 'mesh', cell: m.radius > 1.2 ? 0.08 : 0.04 }, massIfDynamic: mass };
}

/* ------------------------------------------------------------------ inputs */
const MESH_EXT = ['.glb', '.gltf', '.obj', '.usdz', '.usdc', '.usd', '.fbx', '.stl', '.ply'];
const SPLAT_EXT = ['.spz', '.splat', '.ksplat', '.ply'];
function isGaussianPly(f) {
  const fd = fs.openSync(f, 'r'), b = Buffer.alloc(4096); fs.readSync(fd, b, 0, 4096, 0); fs.closeSync(fd);
  const h = b.toString('latin1'); return /property \w+ (f_dc_0|scale_0|packed_position)/.test(h) || /element chunk/.test(h);
}
function collect(p) {
  const st = fs.statSync(p); if (st.isFile()) return [p];
  const out = [];
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const f = path.join(p, e.name);
    if (e.isDirectory()) out.push(...collect(f)); else if (MESH_EXT.includes(path.extname(f).toLowerCase()) || SPLAT_EXT.includes(path.extname(f).toLowerCase())) out.push(f);
  }
  // one asset per stem: prefer glb > gltf > obj > usdz > fbx > ply > stl
  const rank = (f) => MESH_EXT.indexOf(path.extname(f).toLowerCase());
  const by = new Map();
  for (const f of out) { const k = path.join(path.dirname(f), path.parse(f).name); const o = by.get(k); if (!o || rank(f) < rank(o)) by.set(k, f); }
  return [...by.values()];
}
const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'scan';

const ext = (f) => path.extname(f).toLowerCase();
const IMG = /\.(jpe?g|png|tiff?|exr|webp|tga)$/i;
// OBJ without a (readable) .mtl texture: use the image next to it (same stem first, else the only image in the folder)
function objLoneTexture(file) {
  if (ext(file) !== '.obj') return null;
  const dir = path.dirname(file), txt = fs.readFileSync(file, 'latin1').slice(0, 20000);
  const lib = (txt.match(/^mtllib\s+(.+)$/m) || [])[1];
  if (lib && fs.existsSync(path.join(dir, lib.trim())) && /map_Kd/.test(fs.readFileSync(path.join(dir, lib.trim()), 'latin1'))) return null;
  const imgs = fs.readdirSync(dir).filter((f) => IMG.test(f)); const stem = path.parse(file).name;
  return (imgs.find((f) => path.parse(f).name === stem) && path.join(dir, imgs.find((f) => path.parse(f).name === stem))) || (imgs.length === 1 ? path.join(dir, imgs[0]) : null);
}

/* ------------------------------------------------------------------ GLB helpers */
function readGlb(buf) {
  const jl = buf.readUInt32LE(12), json = JSON.parse(buf.subarray(20, 20 + jl).toString('utf8'));
  const bo = 20 + jl, bl = buf.readUInt32LE(bo); return { json, bin: buf.subarray(bo + 8, bo + 8 + bl) };
}
function writeGlb(json, bin) {
  const pad = (b, c) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, c)]);
  const j = pad(Buffer.from(JSON.stringify(json)), 0x20), bb = pad(bin, 0);
  const h = Buffer.alloc(12); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + j.length + 8 + bb.length, 8);
  const ch = (len, type) => { const c = Buffer.alloc(8); c.writeUInt32LE(len, 0); c.writeUInt32LE(type, 4); return c; };
  return Buffer.concat([h, ch(j.length, 0x4e4f534a), j, ch(bb.length, 0x004e4942), bb]);
}
// replace every image with its KTX2 file (KHR_texture_basisu, required): images named albedo / normal / orm by Blender
function ktx2Glb(glbBuf, ktx) {
  const { json, bin } = readGlb(glbBuf); const imgViews = new Set(json.images.map((i) => i.bufferView));
  const parts = []; let off = 0; const remap = new Map();
  json.bufferViews.forEach((v, i) => {
    if (imgViews.has(i)) return;
    const d = bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength); const padn = (4 - (off % 4)) % 4;
    if (padn) { parts.push(Buffer.alloc(padn)); off += padn; }
    remap.set(i, { ...v, byteOffset: off }); parts.push(d); off += d.length;
  });
  const views = [], idx = new Map();
  json.bufferViews.forEach((v, i) => { if (remap.has(i)) { idx.set(i, views.length); views.push(remap.get(i)); } });
  json.images = json.images.map((im) => {
    const d = ktx[im.name]; if (!d) throw new Error('no ktx2 for image ' + im.name);
    const padn = (4 - (off % 4)) % 4; if (padn) { parts.push(Buffer.alloc(padn)); off += padn; }
    views.push({ buffer: 0, byteOffset: off, byteLength: d.length }); parts.push(d); off += d.length;
    return { name: im.name, mimeType: 'image/ktx2', bufferView: views.length - 1 };
  });
  for (const a of json.accessors || []) if (a.bufferView !== undefined) a.bufferView = idx.get(a.bufferView);
  json.bufferViews = views;
  for (const t of json.textures) { t.extensions = { ...(t.extensions || {}), KHR_texture_basisu: { source: t.source } }; delete t.source; }
  json.extensionsUsed = [...new Set([...(json.extensionsUsed || []), 'KHR_texture_basisu'])];
  json.extensionsRequired = [...new Set([...(json.extensionsRequired || []), 'KHR_texture_basisu'])];
  const nb = Buffer.concat(parts); json.buffers = [{ byteLength: nb.length }];
  return writeGlb(json, nb);
}
function glbImageBytes(glbBuf) {
  const { json } = readGlb(glbBuf); const o = {};
  for (const im of json.images || []) o[im.name] = json.bufferViews[im.bufferView].byteLength; return o;
}
const packJs = (key, buf) => `(window.__PACK=window.__PACK||{})['${key}']='${buf.toString('base64')}';\n`;

/* ------------------------------------------------------------------ one mesh asset */
function importMesh(file, nameOverride) {
  const base = path.parse(file).name, name = nameOverride || 'scan_' + slug(base);
  const role = opt('role') || guessRole(base), R = ROLES[role]; if (!R) throw new Error('unknown role ' + role);
  const dir = path.join(OUT, name), work = path.join(WORK, name);
  const metaPath = path.join(dir, name + '.json');
  if (!opt('force') && fs.existsSync(metaPath) && fs.statSync(metaPath).mtimeMs > fs.statSync(file).mtimeMs) { log(name, 'up to date (use --force)'); return JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
  fs.mkdirSync(dir, { recursive: true }); fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
  const tint = Number(opt('tint', 1)), g = R.grade;
  const job = {
    input: path.resolve(file), work, name, role, pylib: process.env.SCAN_PYLIB || path.join(HERE, '.bin/pylib'),
    tris: String(opt('tris', '5000,1500,300')).split(',').map(Number), tex: Number(opt('tex', 0)) || 1024,
    up: opt('up', 'y'), yaw: Number(opt('yaw', 0)), height: opt('height') ? Number(opt('height')) : null, scale: Number(opt('scale', 1)),
    cutGround: opt('cut-ground', 'auto'), remesh: opt('remesh', 'voxel'),
    delight: { ao: Number(opt('delight-ao', 0.6)), dir: Number(opt('delight-dir', 1)), expo: 0.75 },
    targetLum: R.targetLum, grade: { desat: g.desat * tint, mul: g.mul.map((x) => 1 + (x - 1) * tint) }, roughness: R.roughness, metalness: R.metalness,
    // thumbnail rig = the game's night light (style.js palette, linear)
    moonCol: lin(STYLE.palette.moon), hemiSky: lin(STYLE.palette.hemiSky), fog: lin(STYLE.palette.fog), moonI: STYLE.atmosphere.clear_aurora.moon, hemiI: STYLE.atmosphere.clear_aurora.hemi,
  };
  job.texture = opt('texture') ? path.resolve(opt('texture')) : objLoneTexture(file);
  if (job.texture) log(`  texture ${path.basename(job.texture)} (no usable .mtl)`);
  job.jpegQ = Number(opt('jpeg-q', 82));
  const jobPath = path.join(work, 'job.json'); fs.writeFileSync(jobPath, JSON.stringify(job, null, 1));
  if (!BLENDER) throw new Error('Blender not found: run tools/scan/setup.sh or set BLENDER=');
  log(name, `role ${role} ←`, path.relative(process.cwd(), file));
  const t0 = Date.now();
  const r = spawnSync(BLENDER, ['-b', '--factory-startup', '-noaudio', '-P', path.join(HERE, 'scan_blender.py'), '--', jobPath], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const bl = (r.stdout || '') + (r.stderr || ''); fs.writeFileSync(path.join(work, 'blender.log'), bl);
  for (const l of bl.split('\n')) if (l.startsWith('[scan_blender]')) log('  ' + l.slice(15));
  if (r.status !== 0 || !fs.existsSync(path.join(work, name + '.glb'))) { console.error(bl.split('\n').filter((l) => /Error|Traceback|File "/.test(l)).slice(-12).join('\n')); throw new Error('blender failed for ' + file); }
  const bm = JSON.parse(fs.readFileSync(path.join(work, 'blender_meta.json'), 'utf8'));
  let glb = fs.readFileSync(path.join(work, name + '.glb'));
  // KTX2: ETC1S for every map (normal: -normal_map; --ktx2-normal uastc = UASTC+RDO+zstd, ~3.5x bigger); mipmaps
  let ktxGlb = null, ktxBytes = null;
  if (!opt('no-ktx2')) {
    if (!BASISU) log('  basisu not found: KTX2 variant skipped (tools/scan/setup.sh)');
    else {
      const tk = Date.now(), k = {};
      const enc = (src, dst, args) => { execFileSync(BASISU, [src, '-output_file', dst, '-ktx2', '-mipmap', ...args], { stdio: 'pipe' }); return fs.readFileSync(dst); };
      for (const im of readGlb(glb).json.images) {
        const src = path.join(work, im.name + '.png'), dst = path.join(work, im.name + '.ktx2');
        k[im.name] = /^normal/.test(im.name) ? enc(src, dst, opt('ktx2-normal') === 'uastc' ? ['-uastc', '-uastc_rdo_l', '2.0', '-normal_map', '-linear', '-ktx2_zstandard_level', '18'] : ['-normal_map', '-linear', '-quality', '100', '-effort', '5'])
          : /^orm/.test(im.name) ? enc(src, dst, ['-linear', '-quality', '80', '-effort', '4']) : enc(src, dst, ['-quality', '90', '-effort', '4']);
      }
      ktxGlb = ktx2Glb(glb, k); ktxBytes = Object.fromEntries(Object.entries(k).map(([n, b]) => [n, b.length]));
      log(`  ktx2 ${((Date.now() - tk) / 1000).toFixed(1)}s`, ktxBytes);
    }
  }
  // suggested Passport role goes into the pack too (userData.scan.passportRole → ScanLOD.passport)
  const pp = passportFor(role, name, { size: bm.size, radius: bm.radius, volume: bm.volume });
  const stamp = (buf) => { const { json, bin } = readGlb(buf); for (const n of json.nodes || []) if (n.extras && n.extras.scan) {
    const sc = JSON.parse(n.extras.scan); sc.passportRole = pp.role; sc.passportOpts = pp.opts; n.extras.scan = JSON.stringify(sc); } return writeGlb(json, bin); };
  glb = stamp(glb); if (ktxGlb) ktxGlb = stamp(ktxGlb);
  for (const f of fs.readdirSync(dir)) if (/\.(js|jpg|json)$/.test(f)) fs.rmSync(path.join(dir, f));
  fs.writeFileSync(path.join(dir, name + '.js'), packJs(name, glb));
  if (ktxGlb) fs.writeFileSync(path.join(dir, name + '_ktx2.js'), packJs(name + '_ktx2', ktxGlb));
  for (const t of ['thumb.jpg', 'thumb_src.jpg', 'thumb_lod2.jpg']) if (fs.existsSync(path.join(work, t))) fs.copyFileSync(path.join(work, t), path.join(dir, t));
  const meta = {
    name, role, source: path.basename(file), created: new Date().toISOString(), seconds: +((Date.now() - t0) / 1000).toFixed(1),
    size: bm.size, bounds: bm.bounds, radius: bm.radius, volume: bm.volume, lods: bm.lods, lodDist: bm.lodDist, highTris: bm.highTris, highTrisIn: bm.highTrisIn,
    texture: { sizes: bm.texSizes, uv: bm.uv, jpgBytes: glbImageBytes(glb), ktx2Bytes: ktxBytes },
    bytes: { glb: glb.length, pack: fs.statSync(path.join(dir, name + '.js')).size, glbKtx2: ktxGlb ? ktxGlb.length : null, packKtx2: ktxGlb ? fs.statSync(path.join(dir, name + '_ktx2.js')).size : null },
    passport: null, clean: { groundCutAt: bm.groundCutAt ?? null, groundProbe: bm.groundProbe, islandsRemoved: bm.islandsRemoved, voxel: bm.voxel, scaleApplied: bm.scaleApplied },
    delight: bm.delight, gradeFrom: R.from, roughness: R.roughness, metalness: R.metalness, bakeDevice: bm.bakeDevice, steps: bm.steps,
    usage: `copy ${name}.js → assets/pack/; ctx.loadPacked('${name}', ctx.ASSET, (g) => { const lod = ScanLOD.fromGLTF(g, ctx.THREE); lod.position.set(x, ctx.groundH(x, z), z); ctx.scene.add(lod); ctx.Passport.register(lod.levels[0].object, '<role>', {...}); })`,
  };
  meta.passport = pp;
  meta.usage = meta.usage.replace('<role>', meta.passport.role);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 1));
  log(`  → ${path.relative(ROOT, dir)}  pack ${(meta.bytes.pack / 1024).toFixed(0)} KB (ktx2 ${meta.bytes.packKtx2 ? (meta.bytes.packKtx2 / 1024).toFixed(0) + ' KB' : '—'})  tris ${bm.lods.map((l) => l.tris).join('/')}  ${bm.size.join('×')} m  passport ${meta.passport.role}  ${meta.seconds}s`);
  return meta;
}

/* ------------------------------------------------------------------ main */
const files = collect(path.resolve(inputArg));
if (!files.length) { console.error('no scan files in', inputArg); process.exit(1); }
log(`${files.length} file(s) · Blender ${BLENDER ? 'ok' : 'MISSING'} · basisu ${BASISU ? 'ok' : 'missing'} · out ${path.relative(ROOT, OUT) || OUT}`);
const results = [];
for (const f of files) {
  const ext = path.extname(f).toLowerCase();
  const splat = ['.spz', '.splat', '.ksplat'].includes(ext) || (ext === '.ply' && isGaussianPly(f));
  try {
    if (splat) {
      const pass = argv.filter((a) => a !== inputArg);
      const r = spawnSync(process.execPath, [path.join(HERE, 'splat.mjs'), f, ...pass], { stdio: 'inherit' });
      if (r.status !== 0) throw new Error('splat.mjs failed');
      results.push({ name: 'splat_' + slug(path.parse(f).name), kind: 'splat', source: path.basename(f) });
    } else results.push({ kind: 'mesh', ...importMesh(f, files.length === 1 ? opt('name') : null) });
  } catch (e) { console.error('[scan] FAILED', f, e.message); results.push({ source: path.basename(f), error: e.message }); }
}
// index.json: merge with what is already there
const idxPath = path.join(OUT, 'index.json'); let idx = {};
try { idx = JSON.parse(fs.readFileSync(idxPath, 'utf8')); } catch {}
for (const r of results) if (r.name) {
  const m = r.kind === 'splat' ? (() => { try { return JSON.parse(fs.readFileSync(path.join(OUT, r.name, r.name + '.json'), 'utf8')); } catch { return {}; } })() : r;
  idx[r.name] = r.kind === 'splat' ? { kind: 'splat', count: m.count, bytes: m.bytes, size: m.size, source: m.source }
    : { kind: 'mesh', role: r.role, size: r.size, tris: r.lods.map((l) => l.tris), pack: r.bytes.pack, packKtx2: r.bytes.packKtx2, passport: r.passport.role, source: r.source };
}
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(idxPath, JSON.stringify(idx, null, 1));
const bad = results.filter((r) => r.error).length;
log(`done: ${results.length - bad} ok, ${bad} failed → ${path.relative(ROOT, idxPath)}`);
process.exit(bad ? 2 : 0);
