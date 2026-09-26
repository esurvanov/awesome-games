#!/usr/bin/env node
// End-to-end check of the browser build in headless Chromium, the way a player goes through it:
//   load the page -> assets -> main menu -> Single Player -> Skirmish lobby -> Start Game (Wasteland/arabia, 1 AI)
//   -> select villagers, build a house, queue villagers at the Town Center, send villagers to food
//   -> the match runs 3+ game minutes (frame time is measured) -> tech tree (F5) -> save -> load
//   -> settings: switch the language to Russian and back -> quit to the achievements screen -> main menu.
// Every step asserts the game state (window.__game, set by web/main.js); the run fails on any console error or page
// exception. Screenshots go to $SHOT_DIR (default: <tmp>/khroniki-e2e) - compare them with docs/screenshots/*.jpg.
//
//   node web/tests/e2e.mjs                 env: PORT (default 8766), SHOT_DIR, PLAYWRIGHT_MODULE, HEADED=1, GPU=1
//
// The page is served from the repository root by `python3 -m http.server` (any static server works the same).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PORT = Number(process.env.PORT || 8766);
const SHOT_DIR = process.env.SHOT_DIR || path.join(os.tmpdir(), 'khroniki-e2e');
fs.mkdirSync(SHOT_DIR, { recursive: true });

function findPlaywright() {
    if (process.env.PLAYWRIGHT_MODULE) return process.env.PLAYWRIGHT_MODULE;
    const have = new Set();
    for (const c of [path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'), path.join(os.homedir(), '.cache', 'ms-playwright')]) {
        if (fs.existsSync(c)) for (const d of fs.readdirSync(c)) have.add(d);
    }
    const npx = path.join(os.homedir(), '.npm', '_npx');
    const cands = [];
    for (const d of fs.existsSync(npx) ? fs.readdirSync(npx) : []) {
        const pw = path.join(npx, d, 'node_modules', 'playwright');
        const bj = path.join(npx, d, 'node_modules', 'playwright-core', 'browsers.json');
        if (!fs.existsSync(pw) || !fs.existsSync(bj)) continue;
        const rev = JSON.parse(fs.readFileSync(bj, 'utf8')).browsers.find(b => b.name === 'chromium-headless-shell' || b.name === 'chromium');
        if (rev && (have.has(`chromium_headless_shell-${rev.revision}`) || have.has(`chromium-${rev.revision}`))) cands.push(pw);
    }
    if (!cands.length) throw new Error('No playwright with an installed Chromium found (npx playwright install chromium); or set PLAYWRIGHT_MODULE');
    return cands[cands.length - 1];
}

async function waitServer(url, ms = 10000) {
    const t0 = Date.now();
    for (;;) {
        try { const r = await fetch(url); if (r.ok) return; } catch { /* not yet */ }
        if (Date.now() - t0 > ms) throw new Error('the static server did not start');
        await new Promise(r => setTimeout(r, 150));
    }
}

const require = createRequire(import.meta.url);
const { chromium } = require(findPlaywright());
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
const errors = [];
const report = [];
let failed = false;
const step = (name, ok, detail = '') => {
    report.push(`${ok ? '✔' : '✖'} ${name}${detail ? ': ' + detail : ''}`);
    console.log(report[report.length - 1]);
    if (!ok) failed = true;
    return ok;
};

let browser;
try {
    await waitServer(`http://127.0.0.1:${PORT}/web/assets_manifest.json`);
    // GPU=1: the full Chromium with GPU raster (Metal/ANGLE) - realistic frame times; default: the headless shell
    // (software raster, SwiftShader)
    const args = ['--autoplay-policy=no-user-gesture-required'];
    browser = await chromium.launch(process.env.GPU
        ? { channel: 'chromium', headless: !process.env.HEADED, args: [...args, '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])] }
        : { headless: !process.env.HEADED, args });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    // resource-level network failures are retried by runtime/assets.js (python's http.server drops connections
    // under load); everything else printed as an error, and every uncaught exception, fails the run
    page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource: (net::ERR_|the server responded with a status)/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + (e.stack || e)));
    page.on('response', r => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });

    const ev = (fn, arg) => page.evaluate(fn, arg);
    const shot = async name => { const f = path.join(SHOT_DIR, name + '.png'); await page.screenshot({ path: f }); return f; };
    const wait = ms => page.waitForTimeout(ms);
    const click = async (x, y, button = 'left') => { await page.mouse.click(x, y, { button }); await wait(350); };
    const key = async k => { await page.keyboard.press(k); await wait(400); };
    const until = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout, polling: 250 });
    const state = () => ev(() => window.__game && window.__game.state);

    // 1. boot + main menu
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:${PORT}/web/`);
    await until(() => window.__game && window.__game.state === 'menu' && window.__game.menu_screen === 'main', null, 240000);
    await wait(1500);
    step('boot: assets loaded, main menu', true, `${((Date.now() - t0) / 1000).toFixed(1)} s, ${await shot('01_menu')}`);

    // 2. Single Player -> Skirmish lobby
    await click(200, 280);
    step('Single Player dialog', await ev(() => window.__game.menu_screen) === 'single');
    await click(505, 472);
    step('skirmish lobby', await ev(() => window.__game.menu_screen) === 'setup', await shot('02_lobby'));

    // 3. Start Game -> loading -> play
    await click(655, 750);
    await until(() => window.__game.state === 'play', null, 180000);
    await wait(1500);
    const start = await ev(() => { const w = window.__game.world; return { map: w.map_type, n: w.players.length, civ: w.players[0].civ, ais: w.ais.length }; });
    step('match started', start.map === 'arabia' && start.n === 2 && start.ais === 1, `${JSON.stringify(start)} ${await shot('03_play')}`);

    // 4. select the villagers with a box drag (real mouse input)
    const vils = await ev(() => { const g = window.__game; return g.world.units.filter(u => u.owner === 0 && u.kind === 'villager').map(u => g.w2s(u.x, u.y)); });
    const xs = vils.map(p => p[0]), ys = vils.map(p => p[1]);
    await page.mouse.move(Math.min(...xs) - 25, Math.min(...ys) - 40);
    await page.mouse.down();
    await page.mouse.move(Math.max(...xs) + 25, Math.max(...ys) + 20, { steps: 8 });
    await page.mouse.up();
    await wait(300);
    const nsel = await ev(() => window.__game.selected.filter(u => u.kind === 'villager').length);
    step('box-select villagers', nsel === vils.length, `${nsel}/${vils.length}`);

    // 5. build a house: the economy page button, the house button, a free spot near the Town Center
    const btn = (icon0, icon1) => ev(([a, b]) => {
        const r = window.__game.get_buttons().find(x => x.icon && x.icon[0] === a && (b == null || JSON.stringify(x.icon[1]).includes(b)));
        return r && r.rect ? [r.rect.x + r.rect.w / 2, r.rect.y + r.rect.h / 2] : null;
    }, [icon0, icon1]);
    const eco = await btn('bpage', 'eco');
    if (step('economy build page button', !!eco)) await click(...eco);
    const house = await btn('b', 'house');
    if (step('house button', !!house)) await click(...house);
    const spot = await ev(() => {
        const g = window.__game, w = g.world, T = 32;
        const tc = w.buildings.find(b => b.owner === 0 && b.kind === 'town_center');
        for (let r = 4; r < 10; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
            const tx = tc.tx + dx, ty = tc.ty + dy;
            if (!w.can_place('house', tx, ty, 0)) continue;
            const s = g.w2s((tx + 1) * T, (ty + 1) * T);
            if (s[0] > 150 && s[0] < 1130 && s[1] > 100 && s[1] < 590 && g.place_tile(s)[0] === tx && g.place_tile(s)[1] === ty) return s;
        }
        return null;
    });
    if (step('free spot for the house', !!spot)) await click(Math.round(spot[0]), Math.round(spot[1]));
    await wait(800);
    const hs = await ev(() => { const w = window.__game.world; return { house: w.buildings.some(b => b.owner === 0 && b.kind === 'house'), builders: w.units.filter(u => u.owner === 0 && u.state === 'build').length }; });
    step('house foundation laid, villagers building', hs.house && hs.builders > 0, JSON.stringify(hs));

    // 6. select the Town Center and queue 3 villagers
    const tcs = await ev(() => { const g = window.__game, w = g.world; const tc = w.buildings.find(b => b.owner === 0 && b.kind === 'town_center'); const c = tc.center(); return g.w2s(c[0], c[1]); });
    await click(Math.round(tcs[0]), Math.round(tcs[1]) - 20);
    step('Town Center selected', await ev(() => window.__game.selected.length === 1 && window.__game.selected[0].kind === 'town_center'));
    const vb = await btn('u', 'villager');
    if (step('villager button', !!vb)) for (let i = 0; i < 3; i++) await click(...vb);
    const q = await ev(() => window.__game.world.buildings.find(b => b.owner === 0 && b.kind === 'town_center').queue.length);
    step('villagers queued', q >= 2, `queue ${q}`);
    await shot('04_orders');

    // 7. let the match run 3+ game minutes; send new villagers to food on the way; measure the frame time
    await ev(() => window.__pygame.loop_stats.reset());
    await until(() => window.__game.world.time > 100, null, 180000);
    const food = await ev(() => {
        const g = window.__game, w = g.world;
        const idle = w.units.filter(u => u.owner === 0 && u.kind === 'villager' && u.state === 'idle');
        const tc = w.buildings.find(b => b.owner === 0 && b.kind === 'town_center');
        const [cx, cy] = tc.center();
        const tgt = w.animals.filter(a => a.kind === 'sheep' && a.owner === 0).sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))[0]
            || w.nodes.filter(n => n.kind === 'berries').sort((a, b) => Math.hypot(a.tx * 32 - cx, a.ty * 32 - cy) - Math.hypot(b.tx * 32 - cx, b.ty * 32 - cy))[0];
        if (!idle.length || !tgt) return null;
        g.selected = idle;
        const p = tgt.tx != null ? [(tgt.tx + 0.5) * 32, (tgt.ty + 0.5) * 32] : [tgt.x, tgt.y];
        return { n: idle.length, pos: g.w2s(p[0], p[1]) };
    });
    if (food) {
        await click(Math.round(food.pos[0]), Math.round(food.pos[1]) - 6, 'right');
        await wait(1500);
    }
    const gathering = await ev(() => window.__game.world.units.filter(u => u.owner === 0 && u.kind === 'villager' && u.state === 'gather').length);
    step('villagers gathering', gathering > 0, `${gathering} gathering`);
    await until(() => window.__game.world.time > 190, null, 240000);
    const perf = await ev(() => { const s = window.__pygame.loop_stats; return { mean: +s.mean_ms.toFixed(2), max: +s.max_ms.toFixed(1), frames: s.frames, slow: s.slow }; });
    const mid = await ev(() => { const w = window.__game.world; const c = pid => w.units.filter(u => u.owner === pid).length; return { t: Math.round(w.time), mine: c(0), ai: c(1), ai_blds: w.buildings.filter(b => b.owner === 1).length }; });
    step('3+ game minutes played', mid.t > 180 && mid.ai > 5 && mid.ai_blds > 3, `${JSON.stringify(mid)} ${await shot('05_3min')}`);
    step('frame time', perf.mean < 33, `mean ${perf.mean} ms, max ${perf.max} ms, ${perf.slow} of ${perf.frames} frames over 50 ms`);

    // 8. tech tree
    await key('F5');
    step('tech tree (F5)', await ev(() => window.__game.window) === 'techtree', await shot('06_techtree'));
    await key('F5');

    // 9. save through the game menu
    await key('F10');
    step('game menu (F10)', await ev(() => window.__game.help) === 'menu', await shot('07_menu'));
    await click(653, 198);
    step('save dialog', await ev(() => window.__game.saves_mode) === 'save', await shot('08_save_dialog'));
    await click(524, 683);
    await wait(1200);
    const saved = await ev(() => ({ slots: window.__py.modules.savegame.list_slots().length, t: window.__game.world.time, help: window.__game.help }));
    step('game saved', saved.slots >= 1 && !saved.help, JSON.stringify(saved));
    await wait(3000);

    // 10. load it back
    await key('F10');
    await click(653, 248);
    step('load dialog', await ev(() => window.__game.saves_mode) === 'load', await shot('09_load_dialog'));
    await click(524, 683);
    await until(() => window.__game.state === 'play' && !window.__game.help, null, 60000);
    await wait(1000);
    const loaded = await ev(t => { const w = window.__game.world; return { t: w.time, dt: w.time - t, units: w.units.length }; }, saved.t);
    step('game loaded', loaded.dt < 5 && loaded.dt > -1 && loaded.units > 5, `${JSON.stringify(loaded)} ${await shot('10_loaded')}`);

    // 11. settings: language -> Russian -> English
    await key('F10');
    await click(653, 498);
    await click(840, 217);
    await click(686, 272);
    await wait(500);
    const ru = await ev(() => window.__py.modules.i18n.current());
    step('language switched to Russian', ru === 'ru', await shot('11_settings_ru'));
    await click(840, 217);
    await click(686, 248);
    const en = await ev(() => window.__py.modules.i18n.current());
    step('language back to English', en === 'en');
    await click(949, 670);

    // 12. quit -> achievements -> main menu
    if (await ev(() => window.__game.help) !== 'menu') await key('F10');
    await click(653, 598);
    await click(530, 417);
    await until(() => window.__game.state === 'stats', null, 20000);
    step('achievements screen', true, await shot('12_stats'));
    await click(1104, 755);
    await until(() => window.__game.state === 'menu', null, 20000);
    await wait(800);
    step('back in the main menu', await state() === 'menu', await shot('13_menu_again'));
} catch (e) {
    step('flow', false, String(e && e.stack || e));
} finally {
    if (browser) await browser.close();
    server.kill();
}
step('no console errors', errors.length === 0, errors.slice(0, 10).join('\n  '));
console.log(`\nscreenshots: ${SHOT_DIR}`);
process.exit(failed ? 1 : 0);
