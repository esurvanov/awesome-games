// In-browser checks of pygame.js against real pygame-ce values (fixtures/pygame_ref.json, gen_pygame_ref.py).
// Open web/tests/runtime.html (served from the repo root); results land in window.__results and on the page.
import * as pygame from '../runtime/pygame.js';
import * as assets from '../runtime/assets.js';
import * as storage from '../runtime/storage.js';

const results = { pass: 0, fail: 0, details: [] };
function check(name, got, want, tol = 0) {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    let ok = g === w;
    if (!ok && tol && Array.isArray(got) && Array.isArray(want)) ok = got.length === want.length && got.every((v, i) => (Array.isArray(v) ? JSON.stringify(v) === JSON.stringify(want[i]) : Math.abs(v - want[i]) <= tol));
    if (!ok && tol && typeof got === 'number') ok = Math.abs(got - want) <= tol;
    results[ok ? 'pass' : 'fail']++;
    results.details.push({ name, ok, got: g, want: w });
}

async function main() {
    const ref = await (await fetch(new URL('./fixtures/pygame_ref.json', import.meta.url))).json();
    await assets.init();
    await storage.init();
    await assets.request(assets.listdir('assets/fonts').filter(f => f.endsWith('.ttf')).map(f => 'assets/fonts/' + f));
    pygame.init();
    const scr = pygame.display.set_mode([320, 200]);

    // ---- fonts: metrics exact, widths within hinting tolerance
    let wsum = 0, wn = 0, wmax = 0;
    for (const [key, v] of Object.entries(ref.fonts)) {
        const f = new pygame.font.Font(v.file, v.size);
        check(`font ${key} metrics`, [f.get_height(), f.get_ascent(), f.get_descent(), f.get_linesize()], [v.height, v.ascent, v.descent, v.linesize]);
        check(`font ${key} render size`, f.render('Villager', true, [255, 255, 255]).get_size(), v.render, 3);
        check(`font ${key} empty render`, f.render('', true, [255, 255, 255]).get_size(), v.empty);
        for (const [s, w] of Object.entries(v.widths)) {
            const got = f.size(s)[0];
            const d = Math.abs(got - w);
            wsum += d; wn++; wmax = Math.max(wmax, d);
            check(`font ${key} width '${s}'`, got, w, Math.max(2, Math.ceil(w * 0.05)));
        }
    }
    results.font_width_mean_abs_diff = wsum / wn;
    results.font_width_max_diff = wmax;

    // ---- transform sizes (exact)
    const s = new pygame.Surface([100, 50], pygame.SRCALPHA);
    for (const [a, size] of Object.entries(ref.rotate)) check(`rotate ${a}`, pygame.transform.rotate(s, Number(a)).get_size(), size);
    for (const [k, size] of Object.entries(ref.rotozoom)) {
        const [a, z] = k.split(':').map(Number);
        check(`rotozoom ${k}`, pygame.transform.rotozoom(s, a, z).get_size(), size);
    }

    // ---- pixel semantics (±2 for premultiplied-alpha rounding)
    const P = ref.pixels, px = (surf, pos = [0, 0]) => surf.get_at(pos);
    let a, o, w, b, p, t;
    a = new pygame.Surface([4, 4], pygame.SRCALPHA); a.fill([255, 0, 0, 255]); a.fill([0, 0, 255, 100]); check('fill replaces', px(a), P.fill_replace, 2);
    o = new pygame.Surface([4, 4]); o.fill([10, 20, 30, 40]); check('fill opaque ignores alpha', px(o), P.fill_opaque_alpha);
    o = new pygame.Surface([4, 4]); o.fill([0, 0, 0]); w = new pygame.Surface([4, 4], pygame.SRCALPHA); w.fill([255, 255, 255, 128]); o.blit(w, [0, 0]); check('blit alpha', px(o), P.blit_alpha, 2);
    o = new pygame.Surface([4, 4]); o.fill([0, 0, 0]); w = new pygame.Surface([4, 4]); w.fill([200, 100, 50]); w.set_alpha(64); o.blit(w, [0, 0]); check('blit set_alpha', px(o), P.blit_set_alpha, 2);
    o = new pygame.Surface([4, 4]); o.fill([200, 100, 50]); o.fill([128, 128, 128], null, pygame.BLEND_RGB_MULT); check('fill BLEND_RGB_MULT', px(o), P.fill_rgb_mult, 1);
    a = new pygame.Surface([4, 4], pygame.SRCALPHA); a.fill([10, 10, 10, 77]); a.fill([100, 0, 0], null, pygame.BLEND_RGB_ADD); check('fill BLEND_RGB_ADD keeps alpha', px(a), P.fill_rgb_add_alpha, 3);
    a = new pygame.Surface([4, 4], pygame.SRCALPHA); a.fill([100, 150, 200, 200]); a.fill([255, 255, 255, 128], null, pygame.BLEND_RGBA_MULT); check('fill BLEND_RGBA_MULT', px(a), P.fill_rgba_mult, 3);
    a = new pygame.Surface([4, 4], pygame.SRCALPHA); a.fill([0, 0, 0, 255]); b = new pygame.Surface([4, 4], pygame.SRCALPHA); b.fill([0, 0, 0, 130]); a.blit(b, [0, 0], null, pygame.BLEND_RGBA_SUB); check('blit BLEND_RGBA_SUB', px(a), P.blit_rgba_sub, 2);
    o = new pygame.Surface([4, 4]); o.fill([250, 20, 20]); b = new pygame.Surface([4, 4]); b.fill([10, 30, 5]); o.blit(b, [0, 0], null, pygame.BLEND_RGB_SUB); check('blit BLEND_RGB_SUB', px(o), P.blit_rgb_sub);
    o = new pygame.Surface([4, 4]); o.fill([100, 100, 100]); b = new pygame.Surface([4, 4], pygame.SRCALPHA); b.fill([50, 60, 70, 10]); o.blit(b, [0, 0], null, pygame.BLEND_RGB_ADD); check('blit BLEND_RGB_ADD ignores src alpha', px(o), P.blit_rgb_add_srcalpha, 30);
    a = new pygame.Surface([4, 4], pygame.SRCALPHA); a.fill([200, 200, 200, 200]); b = new pygame.Surface([4, 4], pygame.SRCALPHA); b.fill([100, 250, 50, 90]); a.blit(b, [0, 0], null, pygame.BLEND_RGBA_MIN); check('blit BLEND_RGBA_MIN', px(a), P.blit_rgba_min, 3);
    a = new pygame.Surface([4, 4], pygame.SRCALPHA); a.fill([200, 100, 50, 180]); check('grayscale', px(pygame.transform.grayscale(a)), P.grayscale, 2);
    p = new pygame.Surface([10, 10], pygame.SRCALPHA); p.subsurface([2, 3, 4, 4]).fill([9, 8, 7, 255]); check('subsurface writes parent', [px(p, [2, 3]), px(p, [5, 6]), px(p, [6, 6]), px(p, [1, 3])], P.sub_parent);
    p = new pygame.Surface([10, 10]); p.set_clip([0, 0, 5, 5]); p.fill([255, 255, 255]); check('clip limits fill', [px(p, [4, 4]), px(p, [5, 5])], P.clip_fill);
    b = new pygame.Surface([20, 20], pygame.SRCALPHA); pygame.draw.rect(b, [255, 0, 0], [3, 4, 5, 6]); b.set_at([15, 2], [0, 0, 0, 50]);
    check('get_bounding_rect', [...b.get_bounding_rect()], P.bounding);
    check('get_bounding_rect(min_alpha=128)', [...b.get_bounding_rect(128)], P.bounding_128);
    check('mask count', pygame.mask.from_surface(b, 127).count(), P.mask_count);
    t = new pygame.Surface([50, 50], pygame.SRCALPHA);
    check('draw.circle rect', [...pygame.draw.circle(t, [255, 255, 255], [20, 20], 7)], P.draw_circle);
    check('draw.rect rect', [...pygame.draw.rect(t, [255, 255, 255], [5, 6, 10, 12], 2)], P.draw_rect);
    t = new pygame.Surface([10, 10], pygame.SRCALPHA); t.fill([255, 0, 0, 255]); pygame.draw.rect(t, [0, 255, 0, 60], [0, 0, 5, 5]); check('draw replaces on SRCALPHA', px(t, [2, 2]), P.draw_replace, 3);
    t = new pygame.Surface([10, 10]); pygame.draw.circle(t, [255, 255, 255, 30], [5, 5], 4); check('draw ignores alpha on opaque', px(t, [5, 5]), P.draw_opaque_alpha);
    const ck = new pygame.Surface([4, 4]); ck.fill([255, 0, 255]); ck.set_at([1, 1], [10, 20, 30]); ck.set_colorkey([255, 0, 255]);
    const d = new pygame.Surface([4, 4]); d.fill([1, 2, 3]); d.blit(ck, [0, 0]); check('colorkey', [px(d, [0, 0]), px(d, [1, 1])], P.colorkey);
    const fb = pygame.image.frombuffer(new Uint8Array([1, 2, 3, 4, 5, 6]), [2, 1], 'RGB'); check('frombuffer RGB', [px(fb, [1, 0]), fb.get_flags() & pygame.SRCALPHA], P.frombuffer_rgb);
    const cv = new pygame.Surface([2, 2], pygame.SRCALPHA); cv.fill([50, 60, 70, 10]); check('convert drops alpha (composited on black here)', px(cv.convert())[3], P.convert_alpha_drop[3]);

    // ---- runtime-only behaviours
    const sp = new pygame.Surface([8, 8], pygame.SRCALPHA);
    const arr = pygame.surfarray.pixels3d(sp); arr.set(200, 3, 4, 0);
    const al = pygame.surfarray.pixels_alpha(sp); al.set(255, 3, 4);
    check('surfarray view write -> get_at', px(sp, [3, 4]), [200, 0, 0, 255]);
    sp.fill([0, 0, 0, 0], [0, 0, 2, 2]);                  // canvas op after pixel writes flushes them
    check('pixel writes survive canvas ops', px(sp, [3, 4]), [200, 0, 0, 255]);
    const src = new pygame.Surface([6, 6], pygame.SRCALPHA); src.fill([0, 0, 0, 0]); src.fill([1, 2, 3, 255], [2, 2, 2, 2]);
    const dst = new pygame.Surface([6, 6], pygame.SRCALPHA); dst.blit(src.subsurface([2, 2, 3, 3]), [0, 0]);
    check('blit from subsurface', [px(dst, [0, 0]), px(dst, [2, 2])], [[1, 2, 3, 255], [0, 0, 0, 0]]);
    const bl = new pygame.Surface([6, 6]); bl.fill([9, 9, 9]); const r = bl.blit(src, [-3, 4]);
    check('blit clipping returns clipped rect', [...r], [0, 4, 3, 2]);
    const area = new pygame.Surface([6, 6]); area.blit(src, [1, 1], [2, 2, 1, 1]); check('blit area', px(area, [1, 1]), [1, 2, 3, 255]);
    storage.write_text('home/test/x.json', '{"a": 1}');
    check('storage sync read-after-write', JSON.parse(storage.read_text('home/test/x.json')).a, 1);
    check('os.listdir via storage', (await import('../runtime/py.js')).os.listdir('home/test'), ['x.json']);
    storage.remove('home/test/x.json');
    await storage.flush();
    // ---- Sound from WAV bytes + channels
    pygame.mixer.init();
    pygame.mixer.set_num_channels(4);
    const n = 4410, wav = new Uint8Array(44 + n * 4), dv = new DataView(wav.buffer);
    const W = (o, s) => [...s].forEach((c, i) => { wav[o + i] = c.charCodeAt(0); });
    W(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); W(8, 'WAVE'); W(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
    dv.setUint16(22, 2, true); dv.setUint32(24, 44100, true); dv.setUint32(28, 44100 * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
    W(36, 'data'); dv.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) { const v = Math.round(8000 * Math.sin(i / 10)); dv.setInt16(44 + i * 4, v, true); dv.setInt16(46 + i * 4, v, true); }
    const snd = new pygame.mixer.Sound(wav);
    check('Sound(wav bytes) length', Math.round(snd.get_length() * 100) / 100, 0.1);
    pygame.mixer.set_reserved(1);
    const ch = pygame.mixer.find_channel(false);
    check('find_channel skips reserved', ch._id, 1);
    check('get_init', pygame.mixer.get_init().length, 3);
    scr.fill([0, 40, 0]);
    pygame.display.flip();
}

main().then(() => {
    window.__results = results;
    document.body.insertAdjacentHTML('beforeend', `<pre>${results.pass} passed, ${results.fail} failed\n` + results.details.filter(d => !d.ok).map(d => `FAIL ${d.name}: got ${d.got} want ${d.want}`).join('\n') + '</pre>');
}).catch(e => { console.error(e); window.__results = { error: String(e && e.stack || e) }; });
