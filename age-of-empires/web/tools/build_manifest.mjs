#!/usr/bin/env node
// Builds web/assets_manifest.json: every shipped file under assets/ (except the *_raw sources) plus the root
// CREDITS.md, keyed by its path relative to the repository root. PNG entries carry [size, w, h, alpha];
// other files carry [size]. Also records the git answers menu.py asks for (version line, news), because the
// browser has no git.  Run from anywhere:  node web/tools/build_manifest.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SKIP_DIRS = new Set(['0ad_raw', 'millenniumad_raw']);
const SKIP_FILES = new Set(['.DS_Store']);

function walk(dir, out) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name.startsWith('.') || SKIP_FILES.has(ent.name)) continue;
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            if (!SKIP_DIRS.has(ent.name)) walk(p, out);
        } else if (ent.isFile()) out.push(p);
    }
    return out;
}

function pngInfo(file) {
    // IHDR: width, height, color type; alpha = color type 4/6 or a tRNS chunk before IDAT
    const fd = fs.openSync(file, 'r');
    try {
        const head = Buffer.alloc(33);
        fs.readSync(fd, head, 0, 33, 0);
        const w = head.readUInt32BE(16), h = head.readUInt32BE(20), ct = head[25];
        let alpha = ct === 4 || ct === 6;
        if (!alpha) {
            let pos = 33;
            const hdr = Buffer.alloc(8);
            for (;;) {
                if (fs.readSync(fd, hdr, 0, 8, pos) < 8) break;
                const len = hdr.readUInt32BE(0), type = hdr.toString('latin1', 4, 8);
                if (type === 'tRNS') { alpha = true; break; }
                if (type === 'IDAT' || type === 'IEND') break;
                pos += 12 + len;
            }
        }
        return [w, h, alpha ? 1 : 0];
    } finally {
        fs.closeSync(fd);
    }
}

function git(args) {
    try {
        return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return '';
    }
}

const files = {};
const list = walk(path.join(ROOT, 'assets'), []);
const credits = path.join(ROOT, 'CREDITS.md');
if (fs.existsSync(credits)) list.push(credits);
list.sort();
let total = 0, decoded = 0;
for (const f of list) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    const size = fs.statSync(f).size;
    total += size;
    if (rel.endsWith('.png')) {
        const [w, h, a] = pngInfo(f);
        decoded += w * h * 4;
        files[rel] = [size, w, h, a];
    } else {
        files[rel] = [size];
    }
}

// menu.py: _git(...) answers, keyed by the argument list joined with a space
const GIT_QUERIES = [
    ['rev-list', '--count', 'HEAD'],
    ['log', '-1', '--format=%cd', '--date=short'],
    ['log', '--no-merges', '--format=%cd|%s', '--date=short', '-14'],
];
const gitAnswers = {};
for (const q of GIT_QUERIES) gitAnswers[q.join(' ')] = git(q);

const manifest = { version: 1, generated: new Date().toISOString(), files, git: gitAnswers };
const out = path.join(ROOT, 'web', 'assets_manifest.json');
fs.writeFileSync(out, JSON.stringify(manifest));
console.log(`manifest: ${list.length} files, ${(total / 1048576).toFixed(1)} MB on disk, `
    + `${(decoded / 1048576).toFixed(0)} MB decoded images -> ${path.relative(ROOT, out)}`);
