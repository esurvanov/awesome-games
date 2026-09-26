// Loader hooks behind stub_loader.mjs (see there).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'web', 'src') + path.sep;

function _resolve(specifier, context, next, r) {
    try {
        return r();
    } catch (e) {
        if (e.code !== 'ERR_MODULE_NOT_FOUND' || !context.parentURL) throw e;
        const file = fileURLToPath(new URL(specifier, context.parentURL));
        if (!file.startsWith(SRC) || !file.endsWith('.js')) throw e;
        return { url: pathToFileURL(file).href + '?stub', shortCircuit: true };
    }
}

export function loadSync(url, context, next) {
    if (!url.endsWith('?stub')) return next(url, context);
    const file = fileURLToPath(url.slice(0, -5));
    const rel = path.relative(SRC, file).replace(/\.js$/, '');
    const py = path.join(ROOT, 'game', rel === 'content/__init__' ? 'content/__init__' : rel) + '.py';
    const src = fs.existsSync(py) ? fs.readFileSync(py, 'utf8') : '';
    const names = new Map();
    for (const line of src.split('\n')) {
        let m = /^(?:async\s+)?def\s+(\w+)/.exec(line) || /^class\s+(\w+)/.exec(line);
        if (m) { names.set(m[1], 'fn'); continue; }
        m = /^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(?::[^=]+)?=(?!=)/.exec(line);
        if (m) for (const n of m[1].split(',').map(s => s.trim())) if (!names.has(n)) names.set(n, 'val');
    }
    let out = `// AUTO STUB for ${rel} (not ported yet)\n`;
    for (const [n, kind] of names) {
        out += kind === 'fn'
            ? `export function ${n}() { throw new Error('${rel}.${n} is not ported yet (stub)'); }\n`
            : `export let ${n} = undefined;\n`;
    }
    return { format: 'module', source: out, shortCircuit: true };
}

export function resolveSync(specifier, context, next) { return _resolve(specifier, context, next, () => next(specifier, context)); }
// async variants for module.register() (older node)
export async function resolve(specifier, context, next) {
    try { return await next(specifier, context); } catch (e) { return _resolve(specifier, context, next, () => { throw e; }); }
}
export async function load(url, context, next) { return loadSync(url, context, next); }
