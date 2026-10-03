// A short visual walk through the game for a human (or a model) to look at: node tools/refactor/playthrough.mjs <label>
// Teleports between the places the refactor touched and saves a screenshot of each → stand/refactor/shots-<label>/NN-name.jpg
import fs from 'node:fs';
import path from 'node:path';
import { openGame, sleep, OUT } from '../qa/harness.mjs';
const label = process.argv[2] || 'run', dir = path.join(OUT, 'refactor', 'shots-' + label); fs.mkdirSync(dir, { recursive: true });
const H = await openGame({ label: 'playthrough', quality: 'high', cold: true, size: [1280, 720] });
let n = 0; const shot = async (name) => { const f = path.join(dir, String(++n).padStart(2, '0') + '-' + name + '.jpg'); await H.page.screenshot({ path: f, type: 'jpeg', quality: 72 }); console.log('shot', f.replace(OUT, 'stand')); };
const ev = (fn, ...a) => H.page.evaluate(fn, ...a);
try {
  await H.newGame(); await sleep(1500); await shot('start');
  // 1 take the cutter from the crate (real interaction)
  await ev(() => { const D = DBG, c = D.WORLD.crate.position; D.teleport(c.x + 2, c.z + 2, 0); }); await sleep(800);
  await ev(() => { const D = DBG, it = D.INTER.find((i) => /контейнер/i.test(String(i.label))); if (it) it.act(); D.Dialog.close && D.Dialog.close(); D.G.ui = null; }); await sleep(1200); await shot('crate-opened');
  // 2 Orm at the station
  await ev(() => { const D = DBG, o = D.MODCTX.orm.pos; D.teleport(o.x + 3, o.z + 3, 0); }); await sleep(1500); await shot('orm-station');
  // 3 the fox
  await ev(() => { const D = DBG; D.teleport(D.fox.x + 3, D.fox.z + 1, 0); }); await sleep(1500); await shot('fox');
  // 4 stags
  await ev(() => { const D = DBG, s = D.STAGS[0]; D.teleport(s.x + 30, s.z, 0); }); await sleep(1500); await shot('stags-near');
  await ev(() => { const D = DBG, s = D.STAGS[0]; D.teleport(s.x + 14, s.z, 0); }); await sleep(2500); await shot('stags-fleeing');
  // 5 camp fire
  await ev(() => { const D = DBG, it = D.INTER.find((i) => i.label === 'Отдохнуть у огня'), p = it.pos(); D.teleport(p.x + 3, p.z, 0); }); await sleep(2000); await shot('campfire');
  // 6 snowmobile ride
  await ev(() => { const D = DBG; D.sk.unlocked = true; D.teleport(D.sk.x + 3, D.sk.z, 0); }); await sleep(800);
  await ev(() => { DBG.mount(); DBG.keys.KeyW = true; }); await sleep(1800); await shot('snowmobile'); await ev(() => { DBG.keys.KeyW = false; window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })); }); await sleep(600);
  // 7 blizzard
  await ev(() => { const D = DBG; D.WX.target = 1; D.WX.t = 200; }); await sleep(9000); await shot('blizzard'); await ev(() => { DBG.WX.target = 0; DBG.WX.storm = 0; });
  // 8 a shardling fight
  await ev(() => { const D = DBG; D.teleport(0, 0, 0); D.spawnShardling(D.player.x + 10, D.player.z, D.ZONES[0]); }); await sleep(2500); await shot('shardling');
  // 9 the rift / boss arena and the kestrel
  await ev(() => { const D = DBG; D.teleport(D.POI.rift.x + 40, D.POI.rift.z, 0); }); await sleep(2500); await shot('rift');
  await ev(() => { const D = DBG, k = D.WORLD.kestrel.g.position; D.teleport(k.x + 18, k.z + 8, 0); }); await sleep(2000); await shot('kestrel');
  console.log('errors', H.errors.length ? H.errors.slice(0, 5) : 'none');
} finally { await H.close(); }
