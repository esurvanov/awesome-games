// Aim the camera at a few living things and take a close screenshot of each: node tools/refactor/lookat.mjs <label>
// → stand/refactor/look-<label>/NN-name.jpg  (the walk-through shots do not frame the animals; this one does)
import fs from 'node:fs';
import path from 'node:path';
import { openGame, sleep, OUT } from '../qa/harness.mjs';
const label = process.argv[2] || 'run', dir = path.join(OUT, 'refactor', 'look-' + label); fs.mkdirSync(dir, { recursive: true });
const H = await openGame({ label: 'lookat', quality: 'high', cold: true, size: [1280, 720] });
let n = 0;
const look = async (name, get, dist = 7, delay = 250) => {
  const t = await H.page.evaluate(get); if (!t) { console.log('skip', name); return; }
  await H.page.evaluate((t, dist) => { const D = DBG; D.G.mode = 'play'; QA.place(t.x + dist, t.z, { look: [t.x, t.y, t.z], dist: 4.5, pitch: 0.18 }); }, t, dist);
  await sleep(delay); const f = path.join(dir, String(++n).padStart(2, '0') + '-' + name + '.jpg');
  await H.page.screenshot({ path: f, type: 'jpeg', quality: 80 }); console.log('shot', name, JSON.stringify(t));
};
try {
  await H.newGame(); await sleep(1500);
  await look('stag-a', () => { const s = DBG.STAGS[0]; return { x: s.x, y: DBG.groundH(s.x, s.z) + 1, z: s.z }; }, 9, 200);
  await look('stag-b', () => { const s = DBG.STAGS[3]; return { x: s.x, y: DBG.groundH(s.x, s.z) + 1, z: s.z }; }, 9, 200);
  await look('fox', () => { const f = DBG.fox; return { x: f.x, y: DBG.groundH(f.x, f.z) + 0.3, z: f.z }; }, 3.5, 600);
  await look('raven', () => { const R = window.WorldFill && WorldFill.ravens; const r = R && R[0]; return r ? { x: r.pos.x, y: r.pos.y, z: r.pos.z } : null; }, 8, 600);
  await look('orm', () => { const o = DBG.MODCTX.orm.pos; return { x: o.x, y: o.y + 1.2, z: o.z }; }, 4, 600);
  await look('kestrel', () => { const k = DBG.WORLD.kestrel.g.position; return { x: k.x, y: k.y + 2, z: k.z }; }, 22, 800);
  await look('guardian', () => { const b = DBG.boss; return { x: b.x, y: DBG.getH(b.x, b.z) + 4, z: b.z }; }, 26, 800);
  await look('spire', () => { const s = DBG.WORLD.spires[0]; return { x: s.altar.x, y: DBG.groundH(s.altar.x, s.altar.z) + 6, z: s.altar.z }; }, 24, 800);
  await look('echo-stone', () => { const e = DBG.WORLD.echoes[0]; const p = e.eg.getWorldPosition(new DBG.THREE.Vector3()); return { x: p.x, y: p.y, z: p.z }; }, 6, 600);
  await look('shard', () => { const k = DBG.WORLD.shards[0]; return { x: k.x, y: DBG.groundH(k.x, k.z) + 1, z: k.z }; }, 6, 600);
  await look('snowcat-camp', () => { const e = DBG.Passport.list.find((q) => /^st_snowcat/.test(q.name)); const c = e && e.circles[0]; return c ? { x: c.x, y: DBG.groundH(c.x, c.z) + 1, z: c.z } : null; }, 10, 600);
  console.log('errors', H.errors.length ? H.errors.slice(0, 5) : 'none');
} finally { await H.close(); }
