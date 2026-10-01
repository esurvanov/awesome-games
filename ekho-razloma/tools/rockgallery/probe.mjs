// scratch probe (not part of the gallery): ?rocklab, run cards "spot:side:scen;..." , print judge + page expressions per card
import fs from 'node:fs'; import path from 'node:path';
import { openGame, ROOT } from '../qa/harness.mjs';
const [cards, pre, ...exprs] = process.argv.slice(2);
const H = await openGame({ label: 'probe', quality: 'high', size: [960, 600], dpr: 1, query: '?rocklab', lock: process.env.NOLOCK ? false : undefined, cold: !!process.env.NOLOCK });
await H.newGame();
for (const f of ['tools/interact/page.js', 'tools/rockgallery/page.js']) await H.page.evaluate(fs.readFileSync(path.join(ROOT, f), 'utf8'));
await H.page.exposeFunction('__nodeShot', async (name) => { await H.page.screenshot({ path: path.join(ROOT, 'tools/rockgallery/out/probe', name + '.jpg'), type: 'jpeg', quality: 72 }); return name; });
fs.mkdirSync(path.join(ROOT, 'tools/rockgallery/out/probe'), { recursive: true });
await H.page.evaluate(async () => { for (let i = 0; i < 240 && !(window.ROCKLAB && (ROCKLAB.ready || ROCKLAB.err)); i++) await RG.wait(250); RG.useLab(); });
await H.page.evaluate(() => RG.spots());
if (pre && pre !== '-') await H.page.evaluate(pre);
for (const c of (cards || '').split(';').filter(Boolean)) {
  const [spot, side, scen] = c.split(':');
  await H.page.evaluate(() => { if (window.POSE) POSE.reset(); });
  const r = await H.page.evaluate((a, b, cc) => RG.card(a, +b, cc, 'probe_' + a.replace(/\W/g, '') + '_' + b + '_' + cc), spot, side, scen);
  if (!r.judge) { console.log(c, 'ERR', JSON.stringify(r).slice(0, 300)); continue; } const j = r.judge; if (process.env.TRUTH) console.log(JSON.stringify(r.truth)); console.log(c, 'acts', (r.actions||[]).join('+'), 'pen', j.penCm, JSON.stringify(j.penByPart), 'air', j.airS, 'touch', j.touchS, 'inside', j.insideS);
  for (const e of exprs) { try { console.log('   ', e, '=>', JSON.stringify(await H.page.evaluate(e))); } catch (err) { console.log(e, 'ERR', err.message); } }
}
if (!cards) for (const e of exprs) console.log(e, '=>', JSON.stringify(await H.page.evaluate(e)));
await H.close();
