// dev driver: node tools/qa/probe.mjs "<js expression evaluated after new game>" ...
import { openGame, sleep } from './harness.mjs';
const H = await openGame({ label: 'probe', quality: 'high' });
try {
  await H.newGame();
  for (const ex of process.argv.slice(2)) {
    const t0 = Date.now();
    try { const r = await H.page.evaluate(ex); console.log('>>', ex.slice(0, 80), `(${Date.now() - t0} ms)\n`, String(JSON.stringify(r, null, 1)).slice(0, 6000)); }
    catch (e) { console.log('!!', ex.slice(0, 80), e.message.slice(0, 800)); }
  }
  console.log('errors', H.errors.slice(0, 10));
} finally { await H.close(); }
