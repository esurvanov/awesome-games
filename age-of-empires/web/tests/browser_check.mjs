#!/usr/bin/env node
// Headless Chromium checks: serves the repo root with `python3 -m http.server`, then
//   1) web/tests/runtime.html  - pygame.js pixel/font semantics vs real pygame-ce (fixtures/pygame_ref.json)
//   2) web/demo.html           - boot loader, fonts, atlas sprites, input events, a sound on click; screenshot
//   3) any extra pages given:  node web/tests/browser_check.mjs web/index.html   (fails on console errors)
// Env: PLAYWRIGHT_MODULE=/path/to/node_modules/playwright (auto-detected from ~/.npm/_npx otherwise),
//      SHOT_DIR=<dir for screenshots> (default: os.tmpdir()), PORT (default 8765).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PORT = Number(process.env.PORT || 8765);
const SHOT_DIR = process.env.SHOT_DIR || os.tmpdir();

function findPlaywright() {
    if (process.env.PLAYWRIGHT_MODULE) return process.env.PLAYWRIGHT_MODULE;
    const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
    const alt = path.join(os.homedir(), '.cache', 'ms-playwright');
    const have = new Set([...(fs.existsSync(cache) ? fs.readdirSync(cache) : []), ...(fs.existsSync(alt) ? fs.readdirSync(alt) : [])]);
    const npx = path.join(os.homedir(), '.npm', '_npx');
    const cands = [];
    for (const d of fs.existsSync(npx) ? fs.readdirSync(npx) : []) {
        const pw = path.join(npx, d, 'node_modules', 'playwright');
        const bj = path.join(npx, d, 'node_modules', 'playwright-core', 'browsers.json');
        if (!fs.existsSync(pw) || !fs.existsSync(bj)) continue;
        const rev = JSON.parse(fs.readFileSync(bj, 'utf8')).browsers.find(b => b.name === 'chromium-headless-shell' || b.name === 'chromium');
        if (rev && (have.has(`chromium_headless_shell-${rev.revision}`) || have.has(`chromium-${rev.revision}`))) cands.push(pw);
    }
    if (!cands.length) throw new Error('No playwright with an installed Chromium found; set PLAYWRIGHT_MODULE');
    return cands[cands.length - 1];
}

async function waitServer(url, ms = 8000) {
    const t0 = Date.now();
    for (;;) {
        try { const r = await fetch(url); if (r.ok) return; } catch { /* not yet */ }
        if (Date.now() - t0 > ms) throw new Error('http.server did not start');
        await new Promise(r => setTimeout(r, 150));
    }
}

const require = createRequire(import.meta.url);
const { chromium } = require(findPlaywright());
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
let failed = 0;
try {
    const base = `http://127.0.0.1:${PORT}/`;
    await waitServer(base + 'web/assets_manifest.json');
    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = async (url, fn) => {
        const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        const errors = [];
        // network-level failures are retried by assets.js (python http.server drops connections under load)
        p.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource: net::ERR_/.test(m.text())) errors.push(m.text()); });
        p.on('pageerror', e => errors.push(String(e)));
        await p.goto(base + url);
        try { await fn(p, errors); } finally { await p.close(); }
        if (errors.length) { failed++; console.log(`✖ ${url}: console errors:\n  ` + errors.join('\n  ')); } else console.log(`✔ ${url}: no console errors`);
    };

    await page('web/tests/runtime.html', async p => {
        await p.waitForFunction(() => window.__results, null, { timeout: 60000 });
        const r = await p.evaluate(() => window.__results);
        if (r.error) { failed++; console.log('✖ runtime self-test crashed:', r.error); return; }
        for (const d of r.details) if (!d.ok) console.log(`  ✖ ${d.name}: got ${d.got}, want ${d.want}`);
        console.log(`${r.fail ? '✖' : '✔'} runtime self-test: ${r.pass} passed, ${r.fail} failed (font width |diff| mean ${r.font_width_mean_abs_diff.toFixed(2)}, max ${r.font_width_max_diff})`);
        if (r.fail) failed++;
    });

    await page('web/demo.html', async p => {
        await p.waitForFunction(() => window.__demo && window.__demo.frames > 20 && window.__demo.castle && window.__demo.sound, null, { timeout: 90000 });
        const c = await p.locator('#screen').boundingBox();
        await p.mouse.move(c.x + c.width * 0.75, c.y + c.height * 0.5);
        await p.mouse.down();
        await p.mouse.up();
        await p.keyboard.press('KeyH');
        await p.keyboard.press('F10');
        await p.mouse.wheel(0, -120);
        await p.waitForTimeout(400);
        const st = await p.evaluate(() => ({ ...window.__demo, actx: null }));
        const shot = path.join(SHOT_DIR, 'web_demo.png');
        await p.screenshot({ path: shot });
        const ok = st.sound_plays >= 1 && st.frames > 20 && st.kinds.KEYDOWN >= 2 && st.kinds.MOUSEWHEEL >= 1 && st.kinds.MOUSEBUTTONDOWN >= 2;
        if (!ok) failed++;
        console.log(`${ok ? '✔' : '✖'} demo: ${st.frames} frames, sound plays ${st.sound_plays}, events ${JSON.stringify(st.kinds)}, screenshot ${shot}`);
    });

    // extra pages: wait up to WAIT_MS for window.__results ({pass, fail, details:[{name, ok, got, want}]}) or just run
    for (const extra of process.argv.slice(2)) {
        await page(extra, async p => {
            let r = null;
            try {
                await p.waitForFunction(() => window.__results, null, { timeout: Number(process.env.WAIT_MS || 8000) });
                r = await p.evaluate(() => window.__results);
            } catch { /* page without __results: only console errors count */ }
            await p.screenshot({ path: path.join(SHOT_DIR, path.basename(extra).replace(/[^\w.-]/g, '_') + '.png') });
            if (r) {
                if (r.error) { failed++; console.log(`✖ ${extra} crashed: ${r.error}`); return; }
                for (const d of r.details || []) if (!d.ok) console.log(`  ✖ ${d.name}: got ${d.got}, want ${d.want}`);
                console.log(`${r.fail ? '✖' : '✔'} ${extra}: ${r.pass} passed, ${r.fail} failed`);
                if (r.fail) failed++;
            }
        });
    }
    await browser.close();
} finally {
    server.kill();
}
process.exit(failed ? 1 : 0);
