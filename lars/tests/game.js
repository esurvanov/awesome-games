// Загрузка частей игры в Node (без браузера) через тот же реестр L, что и в index.html.
//   import { loadGame } from './game.js'; const L = loadGame(); const { World } = L.use('sim/world');
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const JS = new URL('../js/', import.meta.url).pathname;
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : []; });

export function loadGame() {
  if (globalThis.L) return globalThis.L;
  vm.runInThisContext(readFileSync(join(JS, 'l.js'), 'utf8'), { filename: 'js/l.js' });
  for (const f of walk(JS)) if (!f.endsWith('/l.js')) vm.runInThisContext(readFileSync(f, 'utf8'), { filename: f });
  return globalThis.L;
}
