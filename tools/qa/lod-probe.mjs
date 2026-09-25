// dev probe (FIX-LOOK): same trees drawn as near models vs impostors vs hidden → mean colour of tree pixels per LOD
//   node tools/qa/lod-probe.mjs <outdir> [dist=80,140]
import fs from 'node:fs';
import path from 'node:path';
import { openGame, sleep } from './harness.mjs';
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const dists = (process.argv[3] || '70,130').split(',').map(Number);
const H = await openGame({ label: 'lod-probe', quality: 'high' });
try {
  await H.newGame(); await sleep(3000);
  for (const d of dists) {
    await H.page.evaluate((d) => {
      const D = DBG, L = D.FOREST.list; let sx = 0, sz = 0; for (const t of L) { sx += t[0]; sz += t[2]; } const cx = sx / L.length, cz = sz / L.length;
      let best = L[0], bd = 1e9; for (const t of L) { const q = Math.hypot(t[0] - cx, t[2] - cz); if (q < bd) { bd = q; best = t; } }
      const a = 0.9; let x = best[0] + Math.sin(a) * d, z = best[2] + Math.cos(a) * d;
      QA.place(x, z, { look: [best[0], D.groundH(best[0], best[2]) + 6, best[2]], pitch: 0.05 });
      window.__pr = { x, z, t: best };
    }, d);
    for (const mode of ['near', 'imp']) {
      await H.page.evaluate(([mode, d]) => {   // trees closer than d − 25 m are real models in both shots; beyond: models vs impostors
        const D = DBG, V = D.MODCTX.VEG; D.G.pause = false;
        D.FOREST.R = mode === 'near' ? 2000 : Math.max(5, (d - 25) / 0.47);
        for (const m of V._.F.mid || []) m.visible = mode === 'imp';
      }, [mode, d]);
      await sleep(1500);
      await H.page.evaluate(() => { DBG.G.pause = true; });
      await sleep(300);
      await H.page.screenshot({ path: path.join(out, `d${d}_${mode}.png`) });
    }
    await H.page.evaluate(() => { DBG.FOREST.R = DBG.Q.treeNear; for (const m of DBG.MODCTX.VEG._.F.mid || []) m.visible = true; DBG.G.pause = false; });
  }
} finally { await H.close(); }
