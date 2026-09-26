// Node test environment for ported modules (no browser): loads the manifest and every text asset (json/md/txt)
// from disk into runtime/assets.js, registers font metrics (so pygame.font.Font sizes work for layout math),
// and leaves storage.js in memory mode. Images/audio are unavailable in node - test drawing in the browser
// (web/tests/browser_check.mjs <page>).
//   import { setup } from './node_env.mjs'; await setup();
//   const data = await import('../src/_data_init.js');     // data + content registered + relabel, like `import game.data`
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as assets from '../runtime/assets.js';
import * as storage from '../runtime/storage.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let done = false;
export async function setup() {
    if (done) return;
    done = true;
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'assets_manifest.json'), 'utf8'));
    await assets.init(manifest);
    for (const p of Object.keys(manifest.files)) {
        if (/\.(json|md|txt)$/.test(p)) assets._put_text(p, fs.readFileSync(path.join(ROOT, p), 'utf8'));
        else if (/\.ttf$/.test(p)) {
            const b = fs.readFileSync(path.join(ROOT, p));
            const m = assets.ttf_metrics(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
            assets._put_font(p, { family: 'node', ...m });
        }
    }
    await storage.init();
}
export { ROOT };
