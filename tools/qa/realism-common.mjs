/* realism-common.mjs — shared by realism.mjs (CLI + collisions) and realism-rules.mjs (kept apart: the CLI entry
 * awaits a dynamic import of the rules module, a static import cycle through it would deadlock on top-level await). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SIZES = JSON.parse(fs.readFileSync(path.join(HERE, 'sizes.json'), 'utf8'));

export async function injectRealism(H) {
  if (!(await H.page.evaluate(() => !!window.QAV))) await H.page.evaluate(fs.readFileSync(path.join(HERE, 'qa-views.js'), 'utf8'));
  if (!(await H.page.evaluate(() => !!(window.QR && window.QR.__v)))) await H.page.evaluate(fs.readFileSync(path.join(HERE, 'realism-page.js'), 'utf8'));
}

