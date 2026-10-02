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
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })); await wait(600);
    const off = !D.G.riding && !D.sk.mounted;
    return { ok: riding && off, why: `riding=${riding} dismounted=${off}`, info: { riding, off } };
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
