// Page bootstrap: manifest -> user storage -> asset groups 'boot', 'buildings', 'portraits' (progress bar on the
// canvas; <body data-preload>) -> background prefetch of 'sfx' (<body data-prefetch>) -> dynamic import of the entry
// module (<body data-entry>: ./main.js by default, ./demo.js for the runtime demo). Game modules are imported only after the boot group is in
// memory, so their top-level code may read assets synchronously.
import * as assets from './runtime/assets.js';
import * as storage from './runtime/storage.js';

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d', { alpha: false });

function fit() {
    const host = canvas.parentElement;
    const k = Math.min(host.clientWidth / canvas.width, host.clientHeight / canvas.height);
    canvas.style.width = Math.floor(canvas.width * k) + 'px';
    canvas.style.height = Math.floor(canvas.height * k) + 'px';
}
fit();
window.addEventListener('resize', fit);

function bar(frac, label) {
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#0d0b08';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#d8c9a3';
    ctx.font = '600 34px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('Chronicles of Kingdoms', W / 2, H / 2 - 50);
    const bw = 520, bh = 14, x = (W - bw) / 2, y = H / 2;
    ctx.fillStyle = '#2a241a';
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = '#c9a44a';
    ctx.fillRect(x, y, Math.round(bw * Math.max(0, Math.min(1, frac))), bh);
    ctx.strokeStyle = '#6b5a36';
    ctx.strokeRect(x - 0.5, y - 0.5, bw + 1, bh + 1);
    ctx.fillStyle = '#9c8f74';
    ctx.font = '16px Georgia, serif';
    ctx.fillText(label, W / 2, y + 44);
    ctx.textAlign = 'start';
}

function fail(e) {
    console.error(e);
    if (String(e && e.message || e).startsWith('assets missing')) return;      // the bar already explains it
    bar(1, 'Error: ' + (e && e.message ? e.message : e));
}
window.addEventListener('unhandledrejection', ev => fail(ev.reason));

async function start() {
    bar(0, 'Loading…');
    await assets.init();
    const mode = await storage.init();
    // awaited groups (one progress bar): boot = json/fonts/ui/terrain/nature..., buildings, portraits.
    // Unit sheets are never preloaded as a group (2.3 GB decoded): sprites3d requests them one by one.
    const pre = (document.body.dataset.preload ?? 'boot,buildings,portraits').split(',').filter(Boolean);
    const totals = pre.map(g => assets.group_progress(g)[1]);
    const total = totals.reduce((a, b) => a + b, 0) || 1;
    let before = 0;
    for (let i = 0; i < pre.length; i++) {
        await assets.load_group(pre[i], done => bar((before + done) / total, `Loading ${Math.round(100 * (before + done) / total)}%  (${(total / 1048576).toFixed(0)} MB)`));
        before += totals[i];
    }
    // a preloaded file that failed after all retries would start the game broken (raw text keys, missing art):
    // stop here and offer another attempt instead
    for (let round = 0; assets.failed.size; round++) {
        const lost = Array.from(assets.failed);
        if (round >= 2) {
            bar(1, `Could not load ${lost.length} file(s) (${lost[0]}) - check the connection and reload the page`);
            throw new Error('assets missing: ' + lost.join(', '));
        }
        bar(1, `Loading… retrying ${lost.length} file(s)`);
        await new Promise(r => setTimeout(r, 1500 * (round + 1)));
        await assets.request(lost);
    }
    // background: sound effects (sound.py loads them asynchronously, like its Python loader thread)
    const bg = (document.body.dataset.prefetch ?? 'sfx').split(',').filter(Boolean);
    let chain = Promise.resolve();
    for (const g of bg) chain = chain.then(() => assets.load_group(g));
    chain.catch(e => console.warn('prefetch failed', e));
    window.__boot = { storage: mode, prefetch: chain };
    const entry = document.body.dataset.entry || './main.js';
    await import_with_retry(entry);
}

// The code graph (main.js + ~150 modules) arrives through one dynamic import. Static servers (python http.server in
// particular) sometimes drop a connection under parallel load; a single lost module request would reject the whole
// import. Chromium/Firefox/Safari no longer cache a failed module fetch in the module map, so importing the same URL
// again re-requests only the modules that failed (those already evaluated are reused). Only fetch-level failures are
// retried: a SyntaxError or an exception thrown by module top-level code is a real bug and is reported at once.
function _is_fetch_failure(e) {
    const m = String(e && e.message || e);
    return e instanceof TypeError && /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch/i.test(m);
}

async function import_with_retry(entry, tries = 6) {
    for (let i = 0; ; i++) {
        try {
            return await import(entry);
        } catch (e) {
            if (i + 1 >= tries || !_is_fetch_failure(e)) throw e;
            console.warn(`code import failed (attempt ${i + 1}/${tries}), retrying:`, e && e.message);
            bar(1, `Loading code… retry ${i + 1}`);
            await new Promise(r => setTimeout(r, 250 * 2 ** i));
        }
    }
}
start().catch(fail);
