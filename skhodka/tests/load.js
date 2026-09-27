// Загрузка частей без браузера: core + content + sim + чистые данные вида (render/looks, ui/icons) по js/manifest.js. import { load } from './load.js'
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function load() {
  const ctx = { console, Math, Date, JSON, Map, Set, Array, Object, Number, String, Boolean, Error, performance, setTimeout, clearTimeout };
  ctx.globalThis = ctx; vm.createContext(ctx);
  const run = f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  run('js/l.js'); run('js/manifest.js');
  for (const f of ctx.SKHODKA_FILES) if (/js\/(core|content\/|sim\/|render\/looks|ui\/icons)/.test(f)) run(f);
  return ctx.L;
}
