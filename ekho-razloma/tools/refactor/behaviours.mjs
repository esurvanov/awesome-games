// Behaviour probes the existing QA does not assert (docs/architecture/migration-plan.ru.html, phase 0):
//   fox befriending + following · stags fleeing · shardling chase and return · snowmobile mount/dismount · save contents
//   node tools/refactor/behaviours.mjs <label>   → stand/refactor/behaviours-<label>.json, exit 1 when a probe fails
import fs from 'node:fs';
import path from 'node:path';
import { openGame, OUT } from '../qa/harness.mjs';

const label = process.argv[2] || 'run';
const H = await openGame({ label: 'behaviours', quality: 'high' });
const results = [];
const probe = async (name, fn) => {
  let r; try { r = await H.page.evaluate(fn); } catch (e) { r = { ok: false, why: 'exception: ' + e.message.slice(0, 200) }; }
  results.push({ name, ...r }); console.log(r.ok ? '✅' : '❌', name, r.ok ? '' : r.why || '', r.info ? JSON.stringify(r.info) : '');
};
try {
  await H.newGame();

  await probe('fox: pet → joins → follows', async () => {
    const D = window.DBG, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    D.teleport(D.fox.x + 3, D.fox.z, 0); await wait(300);
    const it = D.INTER.find((i) => /лис/i.test(String(i.label)));
    if (!it) return { ok: false, why: 'no fox interaction' };
    it.act(); D.Dialog.close && D.Dialog.close(); D.G.ui = null;
    if (!D.fox.joined || D.fox.st !== 'follow') return { ok: false, why: `joined=${D.fox.joined} st=${D.fox.st}` };
    D.teleport(D.fox.x + 14, D.fox.z, 0); await wait(300);
    const d0 = Math.hypot(D.fox.x - D.player.x, D.fox.z - D.player.z); await wait(3500);
    const d1 = Math.hypot(D.fox.x - D.player.x, D.fox.z - D.player.z);
    return { ok: d1 < d0 - 3, why: `distance ${d0.toFixed(1)} → ${d1.toFixed(1)}`, info: { d0: +d0.toFixed(1), d1: +d1.toFixed(1), st: D.fox.st } };
  });

  await probe('stags: close pilot → flee and move away', async () => {
    const D = window.DBG, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const s = D.STAGS[0]; s.st = 'graze'; s.t = 99; const x0 = s.x, z0 = s.z;
    D.teleport(s.x + 16, s.z, 0); await wait(2500);
    const moved = Math.hypot(s.x - x0, s.z - z0);
    return { ok: s.st === 'flee' && moved > 6, why: `st=${s.st} moved=${moved.toFixed(1)}`, info: { st: s.st, moved: +moved.toFixed(1) } };
  });

  await probe('shardling: chase → leash back → idle', async () => {
    const D = window.DBG, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    D.teleport(0, 0, 0); await wait(300);
    const seen = new Set(); const z = D.ZONES[0];
    const e = D.spawnShardling(D.player.x + 14, D.player.z, z); D.G.cleared.length = 0;
    for (let i = 0; i < 30; i++) { await wait(100); seen.add(e.st); }
    D.teleport(D.player.x + 160, D.player.z, 0);
    for (let i = 0; i < 100 && !(seen.has('return') && e.st === 'idle'); i++) { await wait(150); seen.add(e.st); }
    const chased = seen.has('chase'), back = seen.has('return') || e.st === 'idle';
    e.dead = true; D.enemies.length = 0;
    return { ok: chased && back, why: `states: ${[...seen].join(',')}`, info: { states: [...seen] } };
  });

  await probe('snowmobile: mount → riding → dismount', async () => {
    const D = window.DBG, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    D.sk.unlocked = true; D.teleport(D.sk.x + 3, D.sk.z, 0); await wait(300);
    D.mount(); await wait(500);
    const riding = D.G.riding && D.sk.mounted;
    const x0 = D.sk.x, z0 = D.sk.z; D.keys.KeyW = true; await wait(2500); D.keys.KeyW = false;   // drive: hold forward
    const drove = Math.hypot(D.sk.x - x0, D.sk.z - z0), rider = Math.hypot(D.player.x - D.sk.x, D.player.z - D.sk.z);
    if (drove < 5 || rider > 1.5) { D.keys.KeyW = false; window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })); await wait(400); return { ok: false, why: `drove ${drove.toFixed(1)} m, rider ${rider.toFixed(1)} m from the sled`, info: { drove, rider } }; }
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })); await wait(600);
    const off = !D.G.riding && !D.sk.mounted;
    return { ok: riding && off, why: `riding=${riding} dismounted=${off}`, info: { riding, off, drove: +drove.toFixed(1) } };
  });

  await probe('passport: every kind has a family and an agreed role', async () => {
    const D = window.DBG, C = window.CORE; if (!C || !C.roleOf) return { ok: false, why: 'CORE.roleOf missing' };
    const noFam = new Set(), bad = new Set();
    for (const e of D.Passport.list) { if (!e.alive || e.name === 'debris') continue; if (!e.family) noFam.add(e.kind || e.name); const w = C.roleOf(e.name); if (w && w !== e.role) bad.add(e.kind + ':' + e.role + '≠' + w); }
    const drift = D.Passport.drift();
    return { ok: !noFam.size && !bad.size && !drift.length, why: (drift.length ? 'registry drift: ' + drift.join(',') + ' · ' : '') + `no family: ${[...noFam].join(',')} · role mismatch: ${[...bad].join(',')}`, info: { families: C.families.length } };
  });

  await probe('beings: pilot, fox, stags, boss, orm all have a kind and family', async () => {
    const D = window.DBG, b = D.Passport.beings(), cnt = {}; b.forEach((x) => { const k = x.family + '/' + x.kind; cnt[k] = (cnt[k] || 0) + 1; });
    const want = { 'pilot/pilot': 1, 'animal/fox': 1, 'animal/stag': D.STAGS.length, 'animal/raven': 10, 'enemy/golem': 1, 'being/orm': 1 };
    const bad = Object.keys(want).filter((k) => cnt[k] !== want[k]).map((k) => `${k}: ${cnt[k]} (want ${want[k]})`);
    return { ok: !bad.length && b.every((x) => x.family), why: bad.join('; ') || 'a being has no family', info: cnt };
  });

  await probe('environment: blizzard starts, storm rises, fog closes in, sky clock runs', async () => {
    const D = window.DBG, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    D.G.mode = 'play'; D.WX.target = 0; D.WX.storm = 0; const t0 = D.skyU.uTime.value, fog0 = D.scene.fog.near;
    D.WX.t = 0.01; await wait(2500);
    const ok = D.WX.target === 1 && D.WX.storm > 0.1 && D.scene.fog.near < fog0 - 5 && D.skyU.uTime.value > t0 && D.skyU.uStorm.value > 0.1;
    const info = { target: D.WX.target, storm: +D.WX.storm.toFixed(2), fogNear: +D.scene.fog.near.toFixed(1), clock: +(D.skyU.uTime.value - t0).toFixed(1) };
    D.WX.target = 0; D.WX.t = 200;
    return { ok, why: JSON.stringify(info), info };
  });

  await probe('campfire: rest by the fire restores health and sets the checkpoint', async () => {
    const D = window.DBG, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    D.G.mode = 'play'; D.G.stage = Math.max(D.G.stage, 2); D.G.riding = false; D.G.checkpoint = null;
    const it = D.INTER.find((i) => i.label === 'Отдохнуть у огня'); if (!it) return { ok: false, why: 'no rest interaction' };
    const p = it.pos(); D.teleport(p.x + 2, p.z, 0); D.player.hpMax = D.player.hpMax || 5; D.player.hp = 1; await wait(300);
    it.act(); await wait(4000);
    return { ok: D.player.hp === D.player.hpMax && D.G.checkpoint === 'station', why: `hp ${D.player.hp}/${D.player.hpMax} checkpoint=${D.G.checkpoint}`, info: { hp: D.player.hp, cp: D.G.checkpoint } };
  });

  await probe('load save: the fox that had joined is with the pilot again', async () => {
    const D = window.DBG; D.fox.joined = false; D.fox.st = 'wild';
    const s = D.store.get('eor-save', null) || { v: 1, stage: 2, hasTool: true, hasCell: false, parts: [], shards: [], echoes: [], cleared: [], deaths: 0, time: 1, sk: false, bossDead: false, ending: null, cp: 'crash' };
    D.applySave(Object.assign({}, s, { fox: true }));
    const on = D.fox.joined && D.fox.st === 'follow'; D.applySave(Object.assign({}, s, { fox: false }));
    return { ok: on, why: `joined=${D.fox.joined} st=${D.fox.st}`, info: { on } };
  });

  await probe('save: contents have the expected fields', async () => {
    const D = window.DBG; D.G.mode = 'play'; D.save(); const s = D.store.get('eor-save', null);
    const need = ['stage', 'hasTool', 'hasCell', 'parts', 'shards', 'echoes', 'cleared', 'deaths', 'fox', 'time', 'pos', 'sk', 'bossDead', 'ending', 'cp'];
    const miss = s ? need.filter((k) => !(k in s)) : need;
    return { ok: !!s && !miss.length, why: 'missing: ' + miss.join(','), info: { keys: s ? Object.keys(s) : null } };
  });
} finally {
  const errors = H.errors.slice(0, 20);
  fs.mkdirSync(path.join(OUT, 'refactor'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'refactor', `behaviours-${label}.json`), JSON.stringify({ results, errors }, null, 1));
  await H.close();
  const bad = results.filter((r) => !r.ok).length + (errors.length ? 1 : 0);
  console.log(bad ? `❌ ${bad} failing` : '✅ all probes pass', errors.length ? `· ${errors.length} page errors: ${errors[0]}` : '');
  process.exitCode = bad ? 1 : 0;
}
