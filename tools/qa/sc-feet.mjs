// dev: eye.mjs's feet-on-surface check against any page (e.g. the before-build tree): node tools/qa/sc-feet.mjs <label> [page]
import path from 'node:path';
import fs from 'node:fs';
import { openGame, OUT } from './harness.mjs';
import { injectViews, runFeet } from '../eye.mjs';
const label = process.argv[2] || 'sc-feet', page = process.argv[3];
const log = (...a) => console.log('[sc-feet]', ...a);
const H = await openGame({ label: 'sc-feet ' + label, quality: 'high', page, log });
try {
  await H.newGame(); await injectViews(H);
  const dir = path.join(OUT, label, 'feet'); const r = await runFeet(H, dir, log);
  fs.writeFileSync(path.join(OUT, label, 'feet.json'), JSON.stringify(r, null, 1)); log('errors', H.errors.length);
} finally { await H.close(); }
