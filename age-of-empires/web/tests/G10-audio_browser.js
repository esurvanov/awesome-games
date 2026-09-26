// Browser checks for group G10 (sound, synth, music) on Web Audio.
// node web/tests/browser_check.mjs web/tests/G10-audio.html
import * as pygame from '../runtime/pygame.js';
import * as assets from '../runtime/assets.js';
import * as storage from '../runtime/storage.js';
import * as py from '../runtime/py.js';

const results = { pass: 0, fail: 0, details: [] };
function check(name, ok, got = '', want = '') {
    results[ok ? 'pass' : 'fail']++;
    results.details.push({ name, ok, got: String(got), want: String(want) });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
    await assets.init();
    await storage.init();
    await assets.load_group('boot');
    await import('../src/_data_init.js');
    const S = await import('../src/synth.js');
    const sound = await import('../src/sound.js');
    const music = await import('../src/music.js');
    // playlist (G9) may not be ported yet: a TrackPlayer without files -> the procedural MusicPlayer is used
    py.register_modules({ playlist: { TrackPlayer: class { get ok() { return false; } } } });
    sound.pre_init();
    pygame.init();
    const scr = pygame.display.set_mode([1280, 800]);
    const a = new sound.Audio();
    check('Audio.ok', a.ok, a.ok, true);
    check('SR = browser rate', S.SR === pygame.mixer.get_init()[0], S.SR, pygame.mixer.get_init()[0]);
    check('procedural music player', a.music instanceof music.MusicPlayer, a.music && a.music.constructor.name, 'MusicPlayer');
    // WAV from synth -> Sound
    // all loops (menu + 4 pieces) render in async steps from the constructor's prefetch; the page keeps ticking
    const names = ['menu', ...a.music.order];
    const t2 = performance.now();
    let ticks = 0, gap = 0, last = performance.now();
    while (!names.every(n => Object.hasOwn(a.music.ready, n)) && performance.now() - t2 < 240000) {
        await sleep(16);
        const now = performance.now();
        gap = Math.max(gap, now - last);
        last = now;
        ticks++;
    }
    check('all loops rendered', names.every(n => a.music.ready[n] != null), Object.keys(a.music.ready), names);
    check('frames kept running while rendering', ticks > 20 && gap < 3000, `${ticks} ticks, longest step ${gap.toFixed(0)} ms, ${((performance.now() - t2) / 1000).toFixed(1)} s`, '>20 ticks, steps < 3 s');
    const snd = new pygame.mixer.Sound(sound.wav_bytes(sound.render_sfx('hit_melee', 1), 2));
    check('procedural Sound length', Math.abs(snd.get_length() - 0.4) < 0.2, snd.get_length(), '~0.4');
    const t0 = performance.now();
    while (!a.loaded && performance.now() - t0 < 60000) await sleep(100);
    check('effects loaded', a.loaded, a.loaded, true);
    check('recorded effects', Object.keys(a.sfx).length >= 100, Object.keys(a.sfx).length, '>=100');
    check('resolve fallback', a.resolve(['sel_ship']) != null, a.resolve(['sel_ship']), 'a name');
    const ch = a.play('click', 0.8);
    check('play click', ch != null, ch, 'Channel');
    check('rate limit', a.play('click', 0.8) == null, 'second click within 30 ms', 'null');
    // popup drawing and a slider drag
    a.draw_icon(scr, 790, 14);
    a.handle(new pygame.event.Event(pygame.MOUSEBUTTONDOWN, { pos: [800, 20], button: 1 }));
    check('popup open', a.popup, a.popup, true);
    a.draw_popup(scr);
    const [, rows] = a._pop_layout();
    const tr = rows.music[1];
    a.handle(new pygame.event.Event(pygame.MOUSEBUTTONDOWN, { pos: [tr.x + Math.trunc(tr.w * 0.25), tr.centery], button: 1 }));
    a.handle(new pygame.event.Event(pygame.MOUSEBUTTONUP, { pos: [tr.x + Math.trunc(tr.w * 0.25), tr.centery], button: 1 }));
    check('music slider', Math.abs(a.settings.music_vol - 0.25) < 0.01, a.settings.music_vol, 0.25);
    const saved = JSON.parse(storage.read_text(sound.SETTINGS));
    check('settings saved', Math.abs(saved.music_vol - 0.25) < 0.01, saved.music_vol, 0.25);
    a.draw_popup(scr);
    pygame.display.flip();
    // music player: drive the menu mode until the loop renders and starts (async steps, frames keep running)
    a.settings.music = true; a.music.enabled = true;
    const t1 = performance.now();
    let frames = 0;
    while (a.music.cur !== 'menu' && performance.now() - t1 < 120000) {
        a.update({ state: 'menu', world: null }, 0.016);
        frames++;
        await sleep(16);
    }
    check('menu music started', a.music.cur === 'menu', a.music.cur, 'menu');

    const [cb] = a.music.chs[a.music.pair];
    check('music channel busy', cb.get_busy(), cb.get_busy(), true);
}

main().catch(e => { console.error(e); results.fail++; results.details.push({ name: 'exception', ok: false, got: String(e.stack || e), want: '' }); })
    .finally(() => {
        window.__results = results;
        document.getElementById('out').textContent = JSON.stringify(results, null, 1);
    });
