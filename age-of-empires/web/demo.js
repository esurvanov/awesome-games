// Runtime demo (web/demo.html): written the way ported modules are - pygame calls, a Python-style class, the
// main loop through pygame.run_loop. Shows fonts, an atlas sprite with player-color tint (mask + BLEND_RGB_MULT),
// UI skin images, draw.*, a rotated/smoothscaled surface, input events and a sound on click.
import * as pygame from './runtime/pygame.js';
import * as assets from './runtime/assets.js';
import { random, fmt, sorted } from './runtime/py.js';

const SCREEN_W = 1280, SCREEN_H = 800;
const CLICK = 'assets/audio/sfx/click/rally_click_01.opus';
const CASTLE = 'assets/gen/buildings/teut/castle.png', CASTLE_M = 'assets/gen/buildings/teut/castle.m.png';

class Demo {
    constructor() {
        pygame.init();
        pygame.mixer.init();
        pygame.mixer.set_num_channels(16);
        this.screen = pygame.display.set_mode([SCREEN_W, SCREEN_H], pygame.SCALED);
        pygame.display.set_caption('Chronicles of Kingdoms - runtime demo');
        this.clock = new pygame.time.Clock();
        this.fonts = {
            title: new pygame.font.Font('assets/fonts/CormorantSC-Bold.ttf', 54),
            b: new pygame.font.Font('assets/fonts/PTSerif-Bold.ttf', 20),
            m: new pygame.font.Font('assets/fonts/FreeSans.ttf', 15),
        };
        this.fonts.title.bold = true;
        this.running = true;
        this.log = [];
        this.clicks = 0;
        this.sound = null;
        this.castle = null;
        this.t = 0;
        this.rnd = random.Random(7);
        const atlas = assets.read_json('assets/gen/atlas.json');
        const trees = atlas.nature.tree || atlas.nature[Object.keys(atlas.nature).find(k => k.includes('tree'))];
        this.trees = this._flat(trees).slice(0, 6).map(e => [pygame.image.load('assets/gen/' + e.file).convert_alpha(), e]);
        this.parchment = pygame.transform.smoothscale(pygame.image.load('assets/ui/skin/parchment.png'), [360, 250]);
        this.minimap = this._minimap();
        // async (like sprites3d's background preload): the castle sheet and the click sound
        assets.request([CASTLE, CASTLE_M, CLICK]).then(() => {
            this.castle = this._tinted(pygame.image.load(CASTLE), pygame.image.load(CASTLE_M).convert(), [60, 110, 230]);
            this.sound = new pygame.mixer.Sound(CLICK);
        });
    }
    _flat(x) {
        if (Array.isArray(x)) return x.flatMap(v => this._flat(v));
        if (x && x.file) return [x];
        if (x && typeof x === 'object') return Object.values(x).flatMap(v => this._flat(v));
        return [];
    }
    /** sprites3d-style recolor: out = base * (1 - m) + base * color * m (BLEND_RGB_MULT / ADD). */
    _tinted(base, mask, color) {
        const w = base.get_width(), h = base.get_height();
        const inv = new pygame.Surface([w, h]);
        inv.fill([255, 255, 255]);
        inv.blit(mask, [0, 0], null, pygame.BLEND_RGB_SUB);
        const tint = mask.copy();
        tint.fill(color, null, pygame.BLEND_RGB_MULT);
        const out = base.copy();
        out.blit(inv, [0, 0], null, pygame.BLEND_RGB_MULT);
        const t2 = base.copy();
        t2.blit(tint, [0, 0], null, pygame.BLEND_RGB_MULT);
        out.blit(t2, [0, 0], null, pygame.BLEND_RGB_ADD);
        return out;
    }
    _minimap() {
        const W = 48, H = 48, buf = new Uint8Array(W * H * 4);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const o = (y * W + x) * 4, water = Math.hypot(x - 30, y - 18) < 9;
            buf[o] = water ? 30 : 60 + this.rnd.randint(0, 30); buf[o + 1] = water ? 80 : 130 + this.rnd.randint(0, 40);
            buf[o + 2] = water ? 190 : 40; buf[o + 3] = 255;
        }
        const small = pygame.image.frombuffer(buf, [W, H], 'RGBA');
        small.set_at([10, 10], [255, 255, 255]);
        const rot = pygame.transform.rotate(pygame.transform.scale(small, [W * 2, H * 2]), -45);
        return pygame.transform.smoothscale(rot, [220, 110]);
    }
    text(s, pos, font = 'm', color = [240, 235, 220], anchor = 'topleft') {
        const f = this.fonts[font];
        const img = f.render(s, true, color);
        const r = img.get_rect({ [anchor]: pos });
        this.screen.blit(f.render(s, true, [15, 12, 10]), [r.x + 1, r.y + 1]);
        this.screen.blit(img, r);
        return r;
    }
    on_event(e) {
        if (e.type === pygame.QUIT) this.running = false;
        else if (e.type === pygame.MOUSEBUTTONDOWN && e.button === 1) {
            this.clicks++;
            if (this.sound) {
                const k = e.pos[0] / SCREEN_W;
                const ch = this.sound.play();
                if (ch) ch.set_volume(1 - k, k);
                window.__demo.sound_plays++;
            }
        }
        if (e.type === pygame.KEYDOWN || e.type === pygame.MOUSEBUTTONDOWN || e.type === pygame.MOUSEWHEEL) {
            const desc = e.type === pygame.KEYDOWN ? `KEYDOWN ${pygame.key.name(e.key)} mod=${e.mod} '${e.unicode}'`
                : e.type === pygame.MOUSEWHEEL ? `MOUSEWHEEL y=${e.y} precise=${fmt(e.precise_y, '.2f')}` : `MOUSEBUTTONDOWN ${e.button} at ${e.pos}`;
            this.log.push(desc);
            if (this.log.length > 6) this.log.shift();
            window.__demo.last_event = desc;
            window.__demo.kinds[desc.split(' ')[0]] = (window.__demo.kinds[desc.split(' ')[0]] || 0) + 1;
        }
    }
    draw() {
        const scr = this.screen;
        scr.fill([22, 26, 20]);
        for (let i = 0; i < 18; i++) pygame.draw.line(scr, [34, 40, 30], [0, i * 48], [SCREEN_W, i * 48 + 200], 1);
        this.text('Chronicles of Kingdoms', [SCREEN_W / 2, 60], 'title', [236, 216, 160], 'center');
        this.text('Browser runtime demo: Canvas 2D + Web Audio, pygame API', [SCREEN_W / 2, 105], 'b', [200, 190, 160], 'center');
        // parchment panel with shapes
        scr.blit(this.parchment, [40, 150]);
        pygame.draw.rect(scr, [120, 80, 40], [40, 150, 360, 250], 3, 8);
        pygame.draw.circle(scr, [180, 40, 40], [110, 230], 34);
        pygame.draw.circle(scr, [40, 40, 40], [110, 230], 34, 3);
        pygame.draw.ellipse(scr, [60, 120, 60], [170, 200, 120, 60]);
        pygame.draw.polygon(scr, [210, 180, 40], [[320, 190], [370, 280], [270, 280]]);
        pygame.draw.arc(scr, [30, 60, 160], [70, 300, 120, 80], 0, Math.PI, 4);
        pygame.draw.lines(scr, [90, 50, 20], false, [[220, 360], [260, 320], [300, 360], [340, 320]], 3);
        const glass = new pygame.Surface([300, 60], pygame.SRCALPHA);
        glass.fill([0, 0, 0, 120]);
        pygame.draw.rect(glass, [255, 255, 255, 60], [10, 10, 280, 40], 0, 6);
        scr.blit(glass, [70, 330]);
        this.text('SRCALPHA overlay', [220, 360], 'm', [255, 255, 255], 'center');
        // atlas sprites
        this.trees.forEach(([spr, e], i) => scr.blit(spr, [470 + i * 70 - e.ox + 30, 330 - e.oy]));
        if (this.castle) {
            const k = 0.6 + 0.05 * Math.sin(this.t * 2);
            const c = pygame.transform.smoothscale(this.castle, [Math.trunc(this.castle.get_width() * k), Math.trunc(this.castle.get_height() * k)]);
            scr.blit(c, c.get_rect({ midbottom: [640, 700] }));
            this.text('teut castle, tinted blue by its mask (BLEND_RGB_*)', [640, 715], 'm', [220, 220, 220], 'midtop');
        } else this.text('loading castle sheet…', [640, 600], 'm', [180, 180, 180], 'center');
        // minimap
        scr.blit(this.minimap, [1010, 160]);
        pygame.draw.rect(scr, [200, 170, 90], [1008, 158, 224, 114], 1);
        this.text('rotate(-45) + smoothscale', [1120, 280], 'm', [200, 200, 200], 'midtop');
        // input log
        const [mx, my] = pygame.mouse.get_pos();
        this.text(`mouse ${mx},${my}  clicks ${this.clicks}  fps ${fmt(this.clock.get_fps(), '.0f')}`, [40, 440], 'b');
        this.text(this.sound ? 'Click anywhere: plays a 0 A.D. click (panned by x)' : 'loading sound…', [40, 470], 'm', [230, 210, 150]);
        this.log.forEach((s, i) => this.text(s, [40, 500 + i * 20], 'm', [180, 200, 220]));
        const words = sorted(['gold', 'Wood', 'food', 'stone'], w => w.toLowerCase());
        this.text('sorted(): ' + words.join(', '), [40, 640], 'm', [160, 160, 160]);
        // cursor dot
        pygame.draw.circle(scr, [255, 230, 120], [mx, my], 4);
    }
    run() {
        window.__demo = { frames: 0, sound_plays: 0, last_event: null, kinds: {} };
        return pygame.run_loop(() => {
            if (!this.running) return false;
            const dt = Math.min(this.clock.tick(60) / 1000.0, 0.05);
            this.t += dt;
            for (const e of pygame.event.get()) this.on_event(e);
            this.draw();
            pygame.display.flip();
            window.__demo.frames++;
            window.__demo.castle = !!this.castle;
            window.__demo.sound = !!this.sound;
            return true;
        });
    }
}

new Demo().run();
