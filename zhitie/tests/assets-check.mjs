// Проверка ассетов без браузера и без зависимостей: node tests/assets-check.mjs
// Лёгкий GLB-ридер: габарит (по min/max POSITION × мировые матрицы узлов), треугольники, клипы, кости.
// Печатает таблицу и список проблем; код выхода 1, если есть ошибки. Используется в tests/assets.test.mjs.
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_MB = 80;

// ---------- GLB ----------
export function readGLB(file) {
  const b = readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB: ' + file);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  let bin = null; const o = 20 + jsonLen;
  if (o < b.length) { const len = b.readUInt32LE(o); bin = b.subarray(o + 8, o + 8 + len); }
  return { json, bin, bytes: b.length };
}
const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) { const r = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) for (let k = 0; k < 4; k++) r[c * 4 + rr] += a[k * 4 + rr] * b[c * 4 + k]; return r; }
function trs(n) {
  if (n.matrix) return n.matrix.slice();
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}
const xf = (m, p) => [0, 1, 2].map(i => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i]);

export function inspect(file) {
  const { json: g, bytes } = readGLB(file);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let tris = 0; const meshNames = []; let skinned = false;
  const scene = g.scenes?.[g.scene ?? 0];
  const visit = (ni, parent) => {
    const n = g.nodes[ni]; const m = mul(parent, trs(n));
    if (n.mesh != null) {
      const mesh = g.meshes[n.mesh]; meshNames.push(n.name || mesh.name);
      if (n.skin != null) skinned = true;
      for (const p of mesh.primitives) {
        const pos = g.accessors[p.attributes.POSITION];
        const cnt = p.indices != null ? g.accessors[p.indices].count : pos.count;
        if ((p.mode ?? 4) === 4) tris += cnt / 3;
        // скиннированные меши: bind-поза в координатах меша (как в three до анимации)
        const M = n.skin != null ? I4() : m;
        for (const cx of [pos.min[0], pos.max[0]]) for (const cy of [pos.min[1], pos.max[1]]) for (const cz of [pos.min[2], pos.max[2]]) {
          const v = xf(M, [cx, cy, cz]); for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], v[i]); max[i] = Math.max(max[i], v[i]); }
        }
      }
    }
    for (const c of n.children || []) visit(c, m);
  };
  for (const r of scene?.nodes || []) visit(r, I4());
  const clips = (g.animations || []).map(a => {
    let d = 0; for (const s of a.samplers) d = Math.max(d, g.accessors[s.input].max?.[0] ?? 0);
    return { name: a.name, duration: +d.toFixed(2), channels: a.channels.length };
  });
  const r3 = (a) => a.map(v => (isFinite(v) ? +v.toFixed(3) : null));
  return {
    file, bytes, tris: Math.round(tris), meshes: meshNames.length, skinned,
    joints: g.skins?.[0]?.joints.length || 0, jointNames: (g.skins?.[0]?.joints || []).map(j => g.nodes[j].name),
    nodeNames: g.nodes?.map(n => n.name) || [],
    min: r3(min), max: r3(max), size: r3(max.map((v, i) => v - min[i])),
    materials: (g.materials || []).map(m => m.name), textures: (g.images || []).length,
    ext: g.extensionsUsed || [], clips,
  };
}

// ---------- проверки ----------
export async function checkAll() {
  const { MODELS, CHARACTERS, ANIMS, CHILDREN = {}, CHARACTERS_LEGACY = {}, PROPS = {}, SHAPES = {}, MODEL_SHAPE = {}, NEW_KINDS = [], HAIR = {}, OUTFITS = {}, ACCESSORIES = {}, BODY = {} } = await import(pathToFileURL(path.join(ROOT, 'js/render/manifest.js')).href);
  const { CATALOG, kindOf = (id) => id } = await import(pathToFileURL(path.join(ROOT, 'data/catalog.js')).href);
  const errors = [], warns = [], rows = [];
  const credits = existsSync(path.join(ROOT, 'assets/credits.json')) ? JSON.parse(readFileSync(path.join(ROOT, 'assets/credits.json'), 'utf8')) : null;
  const creditFiles = new Set((credits?.files || []).map(f => f.file));
  const eps = 0.011;
  const kindRows = {}; const inspCache = new Map(); const insp = (f) => { if (!inspCache.has(f)) inspCache.set(f, inspect(f)); return inspCache.get(f); };
  const TALL = new Set(['tree', 'streetlight', 'food_stall', 'swing_set', 'fountain', 'hedge', 'fence', 'house', 'building', 'car']);
  for (const k of NEW_KINDS) if (!MODELS[k]) errors.push(`вид ${k}: нет модели MODELS[kind]`);
  for (const def of CATALOG) {
    const kind = def.kind || kindOf(def.id);
    const e = MODELS[def.id] || MODELS[kind];
    const kr = (kindRows[kind] ||= { kind, items: 0, shapes: new Set(), tinted: 0, status: 'ok' }); kr.items++; kr.shapes.add(MODEL_SHAPE[def.id] || (MODELS[def.id] ? def.id : 'kind'));
    if (e?.tint) kr.tinted++;
    if (!e) { errors.push(`${def.id}: нет модели ни по id, ни по kind ${kind}`); kr.status = 'FAIL'; rows.push({ id: def.id, status: 'MISSING' }); continue; }
    const f = path.join(ROOT, e.url);
    if (!existsSync(f)) { errors.push(`${def.id}: нет файла ${e.url}`); rows.push({ id: def.id, status: 'NOFILE' }); continue; }
    const r = insp(f); const s = e.scale || 1;
    let size = r.size.map(v => +(v * s).toFixed(2)); const minY = +(r.min[1] * s).toFixed(3);
    if (Math.abs(Math.sin(e.rotY || 0)) > 0.7) size = [size[2], size[1], size[0]];
    const cx = (r.min[0] + r.max[0]) / 2 * s, cz = (r.min[2] + r.max[2]) / 2 * s;
    const [fw, fd] = def.fp; const st = [];
    if (Math.abs(minY) > 0.005) st.push(`minY=${minY}`);
    if (def.place === 'wall') {
      if (size[0] > 1 + eps) st.push(`ширина ${size[0]} > 1`);
      if (size[1] + (e.yOffset || 0) > 3 + eps) st.push(`выше стены`);
      if (Math.abs(cx) > 0.02) st.push(`не центр x ${cx.toFixed(2)}`);
      if (!['wall-center', 'wall-back'].includes(e.mount)) warns.push(`${def.id}: mount не задан`);
    } else {
      if (!TALL.has(kind) && (size[0] > fw + eps || size[2] > fd + eps)) st.push(`не влезает в fp ${fw}×${fd}: ${size[0]}×${size[2]}`);
      if (Math.abs(cx) > 0.03 || Math.abs(cz) > 0.03) st.push(`не центр ${cx.toFixed(2)},${cz.toFixed(2)}`);
      if (size[0] < fw * 0.2 && size[2] < fd * 0.2) warns.push(`${def.id}: очень мелкий (${size})`);
    }
    if (size[1] > (def.levels ? 4.2 : TALL.has(kind) ? 12 : 2.6) && def.place !== 'wall' && e.mount !== 'ceiling') st.push(`высота ${size[1]}`);
    if (def.levels && Math.abs(size[2] - fd) > 0.02) st.push(`лестница: длина ${size[2]} ≠ ${fd}`);
    if (r.ext.includes('KHR_materials_unlit')) warns.push(`${def.id}: unlit-материалы`);
    if (credits && !creditFiles.has(e.url)) st.push('нет в credits.json');
    if (st.length) { errors.push(`${def.id}: ${st.join('; ')}`); kr.status = 'FAIL'; }
    if (CATALOG.indexOf(def) < 45 || st.length) rows.push({ id: def.id, file: e.url.split('/').pop(), fp: `${fw}×${fd}`, size: size.join('×'), minY, tris: r.tris, kb: Math.round(r.bytes / 1024), status: st.length ? 'FAIL' : 'ok' });
  }
  // библиотека форм
  for (const [k, sh] of Object.entries(SHAPES)) { const f = path.join(ROOT, sh.url); if (!existsSync(f)) { errors.push(`SHAPES.${k}: нет файла`); continue; } if (credits && !creditFiles.has(sh.url)) errors.push(`SHAPES.${k}: нет в credits.json`); }
  const kindTable = Object.values(kindRows).map(k => ({ kind: k.kind, items: k.items, shapes: k.shapes.size, tinted: k.tinted, status: k.status }));
  // персонажи
  const charRows = [];
  const ALLCH = { ...CHARACTERS, ...Object.fromEntries(Object.entries(CHILDREN).map(([k, v]) => [k, v])), ...Object.fromEntries(Object.entries(CHARACTERS_LEGACY).map(([k, v]) => ['legacy:' + k, v])) };
  for (const [k, c] of Object.entries(ALLCH)) {
    const f = path.join(ROOT, c.url);
    if (!existsSync(f)) { errors.push(`character ${k}: нет файла`); continue; }
    const r = inspect(f); const st = [];
    if (!r.skinned) st.push('не скиннирован');
    if (r.joints !== 65) st.push(`костей ${r.joints} (ожидается 65 UAL)`);
    for (const j of ['root', 'pelvis', 'Head', 'hand_l', 'hand_r', 'foot_l']) if (!r.jointNames.includes(j)) st.push(`нет кости ${j}`);
    if (!(r.size[1] > 1.55 && r.size[1] < 2.0)) st.push(`рост ${r.size[1]}`);  // bind-поза без масштаба скелета (у детей тоже)
    if (!k.startsWith('legacy:')) { const ms = new Set(r.materials); for (const need of ['skin', 'hair', 'shoes']) if (!ms.has(need)) st.push(`нет материала ${need}`); if (!(ms.has('dress') || (ms.has('shirt') && ms.has('pants')))) st.push('нет одежды shirt+pants|dress'); }
    if (Math.abs(r.min[1]) > 0.03) st.push(`minY ${r.min[1]}`);
    if (credits && !creditFiles.has(c.url)) st.push('нет в credits.json');
    if (st.length) errors.push(`character ${k}: ${st.join('; ')}`);
    charRows.push({ id: k, file: c.url.split('/').slice(-2).join('/'), height: r.size[1], tris: r.tris, joints: r.joints, textures: r.textures, kb: Math.round(r.bytes / 1024), status: st.length ? 'FAIL' : 'ok' });
  }
  // анимации
  const CONTRACT_ANIMS = ['idle', 'walk', 'run', 'sit', 'sitIdle', 'sitTalk', 'standUp', 'eat', 'drink', 'sleep', 'lieDown', 'getUp', 'talk', 'phone', 'wave', 'laugh', 'angry', 'cry', 'dance', 'cook', 'wash', 'pickup', 'interact', 'repair', 'read', 'watchTV', 'useComputer', 'toilet', 'shower', 'exercise', 'no', 'yes'];
  const clips = new Map(); const animRows = [];
  for (const u of ANIMS.urls || [ANIMS.url]) {
    const f = path.join(ROOT, u); if (!existsSync(f)) { errors.push(`ANIMS: нет файла ${u}`); continue; }
    const r = inspect(f); for (const c of r.clips) clips.set(c.name, c);
    if (credits && !creditFiles.has(u)) errors.push(`ANIMS ${u}: нет в credits.json`);
    // имена каналов должны совпадать с костями персонажа
    const { json } = readGLB(f); const targets = new Set(json.animations.flatMap(a => a.channels.map(ch => json.nodes[ch.target.node].name)));
    for (const [k, c] of Object.entries(CHARACTERS)) { const cj = inspect(path.join(ROOT, c.url)).jointNames; const miss = [...targets].filter(t => !cj.includes(t)); if (miss.length) errors.push(`ANIMS→${k}: кости без пары ${miss.slice(0, 5)}`); }
  }
  for (const n of CONTRACT_ANIMS) {
    const cn = ANIMS.clipMap[n]; const c = cn && clips.get(cn);
    if (!cn) errors.push(`clipMap: нет «${n}»`); else if (!c) errors.push(`clipMap: ${n} → ${cn} нет в glb`);
    animRows.push({ anim: n, clip: cn || '—', dur: c?.duration ?? '—', status: c ? 'ok' : 'FAIL' });
  }
  for (const [n, cn] of Object.entries(ANIMS.clipMap)) if (!CONTRACT_ANIMS.includes(n)) { const c = clips.get(cn); if (!c) errors.push(`clipMap extra: ${n} → ${cn} нет в glb`); animRows.push({ anim: n + ' (доп.)', clip: cn, dur: c?.duration ?? '—', status: c ? 'ok' : 'FAIL' }); }
  for (const [a, b] of Object.entries(ANIMS.fallback || {})) if (!ANIMS.clipMap[b]) errors.push(`fallback ${a} → ${b}: нет в clipMap`);
  // реквизит
  const propRows = []; const joints = inspect(path.join(ROOT, CHARACTERS.male.url)).jointNames;
  for (const [k, pr] of Object.entries(PROPS)) {
    const f = path.join(ROOT, pr.url); if (!existsSync(f)) { errors.push(`prop ${k}: нет файла`); continue; }
    const r = inspect(f); const st = [];
    if (!joints.includes(pr.bone)) st.push(`нет кости ${pr.bone}`);
    if (!(pr.position?.length === 3 && pr.quaternion?.length === 4)) st.push('нет position/quaternion');
    if (Math.max(...r.size) > 2) st.push(`размер ${r.size}`);
    if (credits && !creditFiles.has(pr.url)) st.push('нет в credits.json');
    if (st.length) errors.push(`prop ${k}: ${st.join('; ')}`);
    propRows.push({ id: k, bone: pr.bone, size: r.size.join('×'), tris: r.tris, kb: Math.round(r.bytes / 1024), status: st.length ? 'FAIL' : 'ok' });
  }
  // CAS: наряды / причёски / аксессуары / телосложения
  const casRows = [];
  for (const g of ['m', 'f']) { const n = Object.keys(OUTFITS[g] || {}).length; casRows.push({ what: `наряды ${g}`, count: n, status: n >= 6 ? 'ok' : 'FAIL' }); if (n < 6) errors.push(`OUTFITS.${g}: ${n} < 6`);
    for (const [k, o] of Object.entries(OUTFITS[g] || {})) { const f = path.join(ROOT, o.url); if (!existsSync(f)) { errors.push(`OUTFITS.${g}.${k}: нет файла`); continue; } const r = insp(f); if (r.joints !== 65) errors.push(`OUTFITS.${g}.${k}: костей ${r.joints}`); if (credits && !creditFiles.has(o.url)) errors.push(`OUTFITS.${g}.${k}: нет в credits.json`); }
    const nh = Object.values(HAIR).filter(h => h.gender === g || h.gender === 'u').length; casRows.push({ what: `причёски ${g}`, count: nh, status: nh >= 8 ? 'ok' : 'FAIL' }); if (nh < 8) errors.push(`HAIR ${g}: ${nh} < 8`);
    const na = Object.values(ACCESSORIES).filter(h => h.gender === g).length; casRows.push({ what: `аксессуары ${g}`, count: na, status: na >= 4 ? 'ok' : 'FAIL' }); }
  for (const [k, h] of Object.entries({ ...HAIR, ...ACCESSORIES })) { if (!h.url) continue; if (!existsSync(path.join(ROOT, h.url))) errors.push(`${k}: нет файла ${h.url}`); else if (credits && !creditFiles.has(h.url)) errors.push(`${k}: нет в credits.json`); }
  for (const t of ['slim', 'fit', 'heavy']) if (!BODY[t]) errors.push(`BODY.${t} нет`); else for (const b of Object.keys(BODY[t])) if (!inspect(path.join(ROOT, CHARACTERS.male.url)).jointNames.includes(b)) errors.push(`BODY.${t}: нет кости ${b}`);
  casRows.push({ what: 'телосложения', count: Object.keys(BODY).length, status: Object.keys(BODY).length >= 3 ? 'ok' : 'FAIL' });
  // бюджет и кредиты
  const all = []; const walk = (d) => { for (const x of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, x.name); x.isDirectory() ? walk(p) : x.name.startsWith('.') || all.push(p); } };
  walk(path.join(ROOT, 'assets'));
  const totalMB = all.reduce((s, f) => s + statSync(f).size, 0) / 1048576;
  if (totalMB > BUDGET_MB) errors.push(`assets ${totalMB.toFixed(1)} MB > ${BUDGET_MB} MB`);
  if (!existsSync(path.join(ROOT, 'assets/CREDITS.md'))) errors.push('нет assets/CREDITS.md');
  if (!credits) errors.push('нет assets/credits.json');
  else for (const f of all.filter(f => /\.(glb|gltf|png|jpe?g|ogg|mp3|wav)$/i.test(f))) { const rel = path.relative(ROOT, f); if (!creditFiles.has(rel)) errors.push(`credits.json: нет записи для ${rel}`); }
  for (const c of credits?.files || []) if (/cc-by|by-sa|mixamo/i.test(`${c.license} ${c.source}`) && !/cc0|public domain|mit/i.test(c.license)) warns.push(`лицензия требует внимания: ${c.file} (${c.license})`);
  return { rows, casRows, kindTable, shapes: Object.keys(SHAPES).length, distinctShapes: new Set(Object.values(MODEL_SHAPE)).size, charRows, animRows, propRows, clips: [...clips.keys()], totalMB: +totalMB.toFixed(2), files: all.length, errors, warns };
}

function table(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows.find(r => Object.keys(r).length > 2) || rows[0]);
  const w = keys.map(k => Math.max(k.length, ...rows.map(r => String(r[k] ?? '').length)));
  const line = (vals) => vals.map((v, i) => String(v ?? '').padEnd(w[i])).join('  ');
  return [line(keys), line(w.map(n => '-'.repeat(n))), ...rows.map(r => line(keys.map(k => r[k])))].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await checkAll();
  console.log('МЕБЕЛЬ (база + сбои)\n' + table(r.rows));
  console.log(`\nВИДЫ (kind): ${r.kindTable.length}; предметов ${r.kindTable.reduce((s, k) => s + k.items, 0)}; форм в библиотеке ${r.shapes}; различных моделей у предметов ${r.distinctShapes}\n` + table(r.kindTable));
  console.log('\nЛЮДИ\n' + table(r.charRows));
  console.log('\nРЕКВИЗИТ\n' + table(r.propRows));
  console.log('\nCAS\n' + table(r.casRows));
  console.log('\nАНИМАЦИИ (contract → clip)\n' + table(r.animRows));
  console.log(`\nклипов в glb: ${r.clips.length}; файлов в assets/: ${r.files}; всего ${r.totalMB} MB (бюджет ${BUDGET_MB})`);
  for (const w of r.warns) console.log('WARN', w);
  for (const e of r.errors) console.log('ERR ', e);
  console.log(r.errors.length ? `\n✗ ошибок: ${r.errors.length}` : '\n✓ всё ок');
  process.exit(r.errors.length ? 1 : 0);
}
