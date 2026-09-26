// dev driver: node tools/qa/probe-dump.mjs <out.json> <file-with-js-expression> [--quality q] — like probe.mjs, full result to a file
import fs from 'node:fs';
import { openGame } from './harness.mjs';
const [out, jsf] = process.argv.slice(2); const qi = process.argv.indexOf('--quality');
const H = await openGame({ label: 'probe-dump', quality: qi > 0 ? process.argv[qi + 1] : 'high' });
try { await H.newGame(); const r = await H.page.evaluate(fs.readFileSync(jsf, 'utf8')); fs.writeFileSync(out, JSON.stringify({ r, errors: H.errors }, null, 1)); console.log('ok', out, 'errors', H.errors.length); }
finally { await H.close(); }
