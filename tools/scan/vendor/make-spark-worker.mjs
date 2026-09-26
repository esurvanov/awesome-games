#!/usr/bin/env node
// Extracts Spark's inline worker (a string it turns into a blob: URL at runtime) into a same-origin file, so Spark runs
// under the artifact CSP (worker-src falls back to script-src 'self' + CDNs: blob:/data: workers are refused).
// The page installs a Worker shim (tools/scan/scan-splat.js → ScanSplat.shimWorkers) that maps blob:/data: workers here.
//   node tools/scan/vendor/make-spark-worker.mjs [version=2.2.0]
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm'; import { fileURLToPath } from 'node:url';
const v = process.argv[2] || '2.2.0', here = path.dirname(fileURLToPath(import.meta.url));
const src = await (await fetch(`https://cdn.jsdelivr.net/npm/@sparkjsdev/spark@${v}/dist/spark.module.js`)).text();
const m = src.match(/const jsContent = ('(?:[^'\\]|\\.)*');/); if (!m) throw new Error('jsContent not found — Spark changed its worker packaging');
const js = vm.runInNewContext(m[1]);
const out = path.join(here, `spark-worker-${v}.js`);
fs.writeFileSync(out, `/* Spark ${v} (MIT, github.com/sparkjsdev/spark) — inline worker extracted by make-spark-worker.mjs */\n` + js);
console.log('wrote', out, (fs.statSync(out).size / 1024).toFixed(0) + ' KB');
