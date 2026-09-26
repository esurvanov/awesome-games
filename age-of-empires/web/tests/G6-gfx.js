// G6 browser check: procedural sprites vs pygame-ce (size / bounding box / coverage / mean color from
// fixtures/G6-gfx_ref.json, made by gen_G6-gfx_ref.py), 0 A.D. atlas sprites (sprites3d, sprites_extra), unit
// sheets on demand, terrain relief vs Python, map icon, menu tiles. The top canvas shows our sprites, the one below
// the Python PNGs at the same places.
//   node web/tests/browser_check.mjs web/tests/G6-gfx.html     (WAIT_MS=120000)
import * as py from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import * as assets from '../runtime/assets.js';
import * as storage from '../runtime/storage.js';

const details = [];
let pass = 0, fail = 0;
function ok(name, cond, got = '', want = '') {
    details.push({ name, ok: !!cond, got: String(got), want: String(want) });
    if (cond) pass++; else fail++;
}
async function check(name, fn) {
    try { const r = await fn(); if (r !== false) ok(name, true); } catch (e) { ok(name, false, e && e.stack || e, 'no exception'); }
}

function stats(s) {
    const [w, h] = s.get_size();
    const bb = s.get_bounding_rect();
    const d = pygame.image.tobytes(s, 'RGBA');
    const alpha = !!(s.get_flags() & pygame.SRCALPHA);
    let n = 0; const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) {
        if (alpha && d[i + 3] < 128) continue;
        n++; sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2];
    }
    return { size: [w, h], bbox: [bb.x, bb.y, bb.w, bb.h], opaque: n, mean: sum.map(v => (n ? v / n : 0)) };
}

try {
    await assets.init();
    await storage.init();
    await assets.load_group('boot');
    await assets.load_group('buildings');
    pygame.init();
    const scr = pygame.display.set_mode([1280, 800]);
    scr.fill([60, 90, 50]);
    // _all.js imports every module; while other groups are still porting, register the ones that exist
    await import('../src/_data_init.js');
    const names = ['civ_art', 'data', 'defense', 'gfx', 'i18n', 'keymap', 'map_assets', 'map_icons', 'mapgen', 'maps', 'market',
        'match', 'menu_art', 'naval', 'naval_gfx', 'orders', 'relics', 'savegame', 'scoring', 'settings', 'sprites3d',
        'sprites_extra', 'stats', 'terrain', 'terrain_gfx', 'themes', 'uiskin', 'uiskin_map', 'wallgfx', 'world'];
    const reg = {};
    for (const n of names) {
        reg[n] = await import(`../src/${n}.js`);
    }
    for (const n of ['_army_art', '_uni']) reg['content.' + n] = await import(`../src/content/${n}.js`);
    py.register_modules(reg);
    const { modules } = py;
    const { data, gfx, naval_gfx, wallgfx, civ_art, sprites3d, sprites_extra, terrain_gfx, map_icons, menu_art } = modules;
    const REF = await (await fetch('./fixtures/G6-gfx_ref.json')).json();
    const refcv = document.getElementById('ref').getContext('2d');
    const ourcv = document.getElementById('ours').getContext('2d');

    // ------------------------------------------------ procedural sprites vs pygame
    const made = {};
    const BLD = ['house', 'mill', 'lumber_camp', 'mining_camp', 'town_center', 'barracks', 'blacksmith', 'archery_range',
        'stable', 'tower', 'siege_workshop', 'castle'];
    for (const kind of BLD) {
        await check('make_building_sprite ' + kind, () => {
            const [s, ox, oy] = gfx.make_building_sprite(kind, [200, 40, 40]);
            made['bld_' + kind] = s;
            ok('building origin ' + kind, py.eq([ox, oy], REF.draw_stats['bld_' + kind].o), [ox, oy], REF.draw_stats['bld_' + kind].o);
        });
    }
    for (const seed of [0, 1, 2, 5]) await check('make_tree ' + seed, () => { made['tree_' + seed] = gfx.make_tree(seed); });
    await check('make_rocks', () => { made.rocks = gfx.make_rocks([150, 150, 156], 3, true); });
    await check('make_bush', () => { made.bush = gfx.make_bush(4); });
    for (const kind of ['villager', 'militia', 'spearman', 'archer', 'skirmisher', 'scout', 'knight', 'ram']) {
        await check('draw_unit ' + kind, () => {
            const s = new pygame.Surface([60, 60], pygame.SRCALPHA);
            gfx.draw_unit(s, kind, [40, 90, 200], 30, 50, [1.0, 0.2], 0.7, 0.2, 1.4, kind === 'villager' ? 'wood' : null, true);
            made['unit_' + kind] = s;
        });
    }
    for (const kind of ['sheep', 'deer', 'wolf', 'boar']) {
        await check('draw_animal ' + kind, () => {
            const s = new pygame.Surface([50, 40], pygame.SRCALPHA);
            gfx.draw_animal(s, kind, 25, 32, [-1.0, 0.0], 1.1, true, false, [255, 0, 0], 1.3);
            made['animal_' + kind] = s;
        });
    }
    await check('draw_farm', () => {
        const s = new pygame.Surface([200, 120], pygame.SRCALPHA);
        gfx.draw_farm(s, 100, 10, 3, 1, 0.6);
        made.farm = s;
    });
    for (const kind of ['fishing_ship', 'transport_ship', 'galley', 'war_galley', 'fire_ship', 'galleon', 'demolition_ship',
        'cannon_galleon', 'boat']) {
        await check('draw_ship ' + kind, () => {
            const s = new pygame.Surface([110, 90], pygame.SRCALPHA);
            naval_gfx.draw_ship(s, kind, [40, 90, 200], 55, 60, [0.8, 0.3], 1.0, 0.0, 1.0, 'food', true);
            made['ship_' + kind] = s;
        });
    }
    for (const [kind, v] of [['shore_fish', 0], ['deep_fish', 3]]) await check('make_fish ' + kind, () => { made['fish_' + kind] = naval_gfx.make_fish(kind, v); });
    for (const mask of [0, 1 | 4, 2 | 8, 1 | 2, 16 | 64, 0xff]) {
        for (const kind of ['palisade_wall', 'stone_wall']) {
            await check(`piece_sprite ${kind} ${mask}`, () => { made[`wall_${kind}_${mask}`] = wallgfx.piece_sprite(kind, [40, 90, 200], mask)[0]; });
        }
    }
    for (const kind of ['palisade_gate', 'gate']) {
        if (!data.BUILDINGS[kind]) continue;
        for (const horiz of [true, false]) {
            for (const op of [false, true]) {
                await check(`gate_sprite ${kind} ${horiz} ${op}`, () => { made[`gate_${kind}_${+horiz}${+op}`] = wallgfx.gate_sprite(kind, [40, 90, 200], horiz, op)[0]; });
            }
        }
    }
    for (const [k, v] of Object.entries(data.CIVS)) {
        if (v && v.emblem) await check('emblem ' + k, () => { made['emblem_' + k] = civ_art.emblem(k, v.emblem, 48, 56); });
    }
    for (const kind of ['longbowman', 'throwing_axeman', 'teutonic_knight', 'samurai', 'chu_ko_nu', 'war_elephant', 'mameluke',
        'janissary', 'berserk', 'huskarl', 'woad_raider', 'conquistador', 'mangudai', 'cataphract']) {
        if (!data.UNITS[kind] || typeof data.UNITS[kind].art !== 'function') continue;
        await check('civ art ' + kind, () => {
            const s = new pygame.Surface([80, 80], pygame.SRCALPHA);
            gfx.draw_unit(s, kind, [200, 40, 40], 40, 70, [-1.0, 0.2], 0.3, 0.25, 1.4, null, true);
            made['civ_' + kind] = s;
        });
    }
    // compare + contact sheet (ours on the screen, Python's below)
    let x = 4, y = 4, rowh = 0;
    const imgs = [];
    for (const [name, want] of Object.entries(REF.draw_stats)) {
        const s = made[name];
        if (!s) { ok('made ' + name, false, 'missing', 'sprite'); continue; }
        const got = stats(s);
        const [w, h] = got.size;
        const bbd = Math.max(...got.bbox.map((v, i) => Math.abs(v - want.bbox[i])));
        const cov = Math.abs(got.opaque - want.opaque) <= 25 ? 0 : Math.abs(got.opaque - want.opaque) / Math.max(1, want.opaque);   // tiny sprites: AA edges
        const md = Math.max(...got.mean.map((v, i) => Math.abs(v - want.mean[i])));
        ok(`${name}: size`, py.eq(got.size, want.size), got.size, want.size);
        ok(`${name}: bbox (±3)`, bbd <= 3, got.bbox, want.bbox);
        ok(`${name}: coverage (±12%)`, cov <= 0.12, got.opaque, want.opaque);
        ok(`${name}: mean color (±14)`, md <= 14, got.mean.map(v => v.toFixed(0)), want.mean.map(v => v.toFixed(0)));
        if (x + w > 1276) { x = 4; y += rowh + 4; rowh = 0; }
        {
            const cv = document.createElement('canvas');
            cv.width = w; cv.height = h;
            cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pygame.image.tobytes(s, 'RGBA')), w, h), 0, 0);
            ourcv.drawImage(cv, x, y);
            imgs.push([name, x, y]);
        }
        x += w + 4; rowh = Math.max(rowh, h);
    }
    await Promise.all(imgs.map(async ([name, ix, iy]) => {
        const im = new Image();
        im.src = `./fixtures/G6/${name}.png`;
        await im.decode();
        refcv.drawImage(im, ix, iy);
    }));

    // ------------------------------------------------ sprites3d (0 A.D. atlas)
    await check('sprites3d.available', () => sprites3d.available() === true);
    await check('sprites3d buildings tinted/stages/variants/dock dirs', () => {
        let bx = 20;
        for (const kind of ['town_center', 'house', 'castle', 'barracks', 'dock', 'wonder', 'market']) {
            const r = sprites3d.building(kind, 'britons', [255, 0, 0]);
            if (r == null) continue;
            const [s, ox, oy] = r;
            if (!(s.get_width() > 10 && s.get_bounding_rect().w > 10)) throw new Error('empty ' + kind);
            scr.blit(pygame.transform.rotozoom(s, 0, 0.35), [bx, 560]);
            bx += Math.trunc(s.get_width() * 0.35) + 4;
            sprites3d.building(kind, 'franks', [0, 0, 255], 1);
        }
        sprites3d.building('house', 'teutons', [0, 0, 255], null, 2);
        sprites3d.building('dock', 'britons', [0, 0, 255], null, 0, [1, 0]);
        return sprites3d.building('house', 'britons', [255, 0, 0]) === sprites3d.building('house', 'britons', [255, 0, 0]);
    });
    await check('sprites3d nature: tree (greener), node stages, animal, farm, cliff, icon_rec', () => {
        let nx = 700;
        const items = [sprites3d.tree(5, 7, 0), sprites3d.tree(40, 3, 2), sprites3d.node('gold', 1, 0), sprites3d.node('gold', 1, 2),
            sprites3d.node('stone', 0, 1), sprites3d.animal('sheep', 0, [1, 1], [255, 0, 0]), sprites3d.farm(3), sprites3d.cliff(2),
            sprites3d.icon_rec('tree'), sprites3d.icon_rec('berries')];
        for (const it of items) {
            if (it == null) continue;
            scr.blit(it[0], [nx, 700 - it[2]]);
            nx += Math.min(80, it[0].get_width());
        }
        return items.filter(i => i != null).length >= 6;
    });
    await check('sprites3d walls: wall_piece / wall_build / gate', () => {
        const dirs = modules.defense.DIR8;
        const a = sprites3d.wall_piece('stone_wall', 'britons', [0, 0, 255], 1 | 4, dirs);
        const b = sprites3d.wall_piece('palisade_wall', 'franks', [0, 0, 255], 16 | 64 | 1, dirs);
        const c = sprites3d.wall_build('stone_wall', 'britons', 'fndn');
        const g = sprites3d.gate('gate', 'britons', [0, 0, 255], true, false);
        if (a) scr.blit(a[0], [1100, 700 - a[2]]);
        if (b) scr.blit(b[0], [1160, 700 - b[2]]);
        return a != null && b != null && c != null;
    });
    await check('sprites3d.terrain_tile', () => sprites3d.terrain_tile('grass') != null);

    // unit sheets on demand
    await check('unit sheet: placeholder, request, pump, recolor, hit flash', async () => {
        const us = sprites3d.unit_set('knight', 'franks');
        if (!us) throw new Error('no knight set');
        const i = us.index('idle', us.face(1, 0), 0);
        const [p0] = us.frame(i, [255, 0, 0]);
        ok('frame before the sheet arrives is the 1x1 placeholder', p0 === sprites3d._blank(), p0.get_size(), '[1,1]');
        ok('preload_pending counts the download', sprites3d.preload_pending() >= 1, sprites3d.preload_pending(), '>= 1');
        await assets.request(sprites3d.sheet_paths('knight', 'franks'));
        await new Promise(r => setTimeout(r, 50));
        sprites3d.pump(1.0);
        ok('pump made the sheet ready', us.sheet != null, us.sheet, 'Surface');
        const [f, ax, ay] = us.frame(i, [255, 0, 0]);
        const [fb] = us.frame(i, [0, 0, 255]);
        const [fw] = us.frame(i, [255, 255, 255]);
        const [fn] = us.frame(i, null);
        ok('recolored frame', f.get_width() > 4 && f.get_bounding_rect().w > 4, f.get_size(), 'a unit');
        ok('frame cached', us.frame(i, [255, 0, 0])[0] === f, '', '');
        scr.blit(f, [300 - ax, 790 - ay]); scr.blit(fb, [340 - ax, 790 - ay]); scr.blit(fw, [380 - ax, 790 - ay]); scr.blit(fn, [420 - ax, 790 - ay]);
        // the knight's red cloth: some reddish pixels in the red frame, bluish in the blue one
        const cnt = (s, pred) => { const d = pygame.image.tobytes(s, 'RGBA'); let n = 0; for (let k = 0; k < d.length; k += 4) if (d[k + 3] > 200 && pred(d[k], d[k + 1], d[k + 2])) n++; return n; };
        ok('player color red', cnt(f, (r, g, b) => r > g + 40 && r > b + 40) > 10, cnt(f, (r, g, b) => r > g + 40 && r > b + 40), '> 10');
        ok('player color blue', cnt(fb, (r, g, b) => b > r + 40 && b > g + 20) > 10, cnt(fb, (r, g, b) => b > r + 40 && b > g + 20), '> 10');
        sprites3d.request('archer', 'britons');
        await sprites3d._pre_thread[0];
        sprites3d.pump(1.0);
        return sprites3d.unit_set('archer', 'britons').sheet != null && sprites3d.preload_pending() === 0;
    });

    // ------------------------------------------------ sprites_extra
    await check('sprites_extra decals', () => {
        const se = sprites_extra;
        const fr = [se.fish('shore_fish', 1, 0.3), se.fish('deep_fish', 2, 1.1, 120), se.ripple(0.4), se.carcass('deer', 0.5, 1, 0),
            se.stump(12, 40, 200), se.rubble(3, 'house'), se.rubble(2, 'castle', 100), se.flame(0.3), se.smoke(0.9, 0.2, 90),
            se.blast(0.1), se.projectile('arrow', 1, -1), se.projectile('stone', 1, 0, 0.7)];
        let ex = 480;
        for (const f of fr) { se.blit(scr, f, ex, 780); ex += 40; }
        ok('blast over', se.blast(99) === null, se.blast(99), 'null');
        return fr.filter(f => f != null).length >= 8;
    });

    // ------------------------------------------------ terrain_gfx: relief vs Python, textured ground
    await check('Relief.apply vs Python (gradient surface)', () => {
        const f = REF.fake_world;
        const w = { W: f.W, H: f.H, terrain: f.terrain, ground: Uint8Array.from(f.ground), elev_map: Uint8Array.from(f.elev_map), hz: f.hz, relief: true };
        const R = REF.relief;
        const surf = new pygame.Surface([R.tw, R.th]);
        const v = pygame.surfarray.pixels3d(surf);
        for (let xx = 0; xx < R.tw; xx++) for (let yy = 0; yy < R.th; yy++) {
            const o = v.offset + xx * v.strides[0] + yy * v.strides[1];
            v.data[o] = (xx * 7 + yy * 3) % 256; v.data[o + 1] = (xx * 2 + yy * 5) % 256; v.data[o + 2] = (xx ^ yy) % 256;
        }
        const rel = new terrain_gfx.Relief(w, R.ox, R.tw, R.th);
        rel.apply(surf);
        const a = pygame.surfarray.array3d(surf);
        const want = REF.relief_apply;
        let bad = 0, tot = 0;
        [0, 37, 101, Math.floor(R.th / 2), R.th - 1].forEach((yy, ri) => {
            const row = want.rows[ri];
            for (let xx = 0; xx < R.tw; xx++) for (let c = 0; c < 3; c++) {
                tot++;
                if (Math.abs(a.get(xx, yy, c) - row[xx * 3 + c]) > 2) bad++;
            }
        });
        ok('relief rows within ±2 (≥ 99%)', bad <= tot * 0.01, `${bad}/${tot} off`, '≤ 1%');
        const fog = new pygame.Surface([Math.floor(R.tw / 8), Math.floor(R.th / 8)], pygame.SRCALPHA);
        fog.fill([0, 0, 0, 200]);
        terrain_gfx.warp_fog(fog, rel.fog_rows(Math.floor(R.tw / 8), Math.floor(R.th / 8), 8));
        return true;
    });
    await check('load_tiles + paint_ground + decorate + WaterFX on the fake world', () => {
        const f = REF.fake_world;
        const w = { W: f.W, H: f.H, terrain: f.terrain, ground: Uint8Array.from(f.ground), elev_map: Uint8Array.from(f.elev_map), hz: f.hz, relief: true };
        const tiles = terrain_gfx.load_tiles(n => sprites3d.terrain_tile(n));
        if (!tiles) throw new Error('no tiles');
        const ox = w.H * data.HW;
        const big = new pygame.Surface([(w.W + w.H) * data.HW, (w.W + w.H) * data.HH]);
        big.fill([40, 100, 170]);
        terrain_gfx.paint_ground(big, w, ox, tiles);
        const dist = naval_gfx.shore_dist(w);
        naval_gfx.decorate(big, w, dist, ox, py.random.Random(5));
        new terrain_gfx.Relief(w, ox, big.get_width(), big.get_height()).apply(big);
        const fx = new naval_gfx.WaterFX(w, ox, dist);
        fx.draw(big, 0, 0, 0, big.get_width(), big.get_height(), 1.3);
        scr.blit(pygame.transform.smoothscale(big, [300, 150]), [960, 520]);
        return true;
    });

    // ------------------------------------------------ map icon, menu tiles
    await check('map_icons._draw(_world(arabia))', () => {
        const s = map_icons._draw(map_icons._world('arabia'), 96);
        scr.blit(s, [860, 520]);
        return s.get_width() === 96;
    });
    await check('menu_art.preload + tile_art', async () => {
        await menu_art.preload();
        let mx = 860;
        for (const k of ['single', 'multi', 'learn', 'load']) {
            const s = menu_art.tile_art(k, [100, 70]);
            scr.blit(s, [mx, 620]);
            mx += 104;
            ok('tile_art cached ' + k, menu_art.tile_art(k, [100, 70]) === s, '', 'same surface');
        }
        return true;
    });
    pygame.display.flip();
    window.__results = { pass, fail, details };
} catch (e) {
    console.error(e);
    window.__results = { pass, fail: fail + 1, details, error: String(e && e.stack || e) };
}
