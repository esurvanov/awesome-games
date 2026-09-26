// port of game/playlist.py
// Music from files (0 A.D., assets/audio/music): streaming playback through pygame.mixer.music.
//
// Modes: menu (the theme on a loop) -> match (a peaceful playlist in random order) <-> battle (battle pieces) -> result
// (a short victory or defeat piece, then silence until the menu).
//
// Battle starts when the intensity near the player (Audio.combat) crosses the upper threshold, and stops
// only after the intensity has stayed below the lower threshold for CALM_HOLD seconds and the battle piece
// has played for at least BATTLE_MIN - so the music does not "flicker" from isolated skirmishes.
//
// SDL has only one stream, so changing a piece is a quick fade-out of the old one and a smooth entry of the new one;
// we drive the volume ourselves every frame (pygame's built-in fadeout blocks or conflicts with set_volume).
// The end of a piece is caught in advance by the duration from the manifest, so the next one enters without a pause.
import * as py from '../runtime/py.js';
import { os, random, time } from '../runtime/py.js';

export const BATTLE_ON = 0.9;          // the intensity at which battle music starts
export const BATTLE_OFF = 0.25;        // below - a "lull"
export const CALM_HOLD = 14.0;         // how many seconds of lull are needed to return to peaceful music
export const BATTLE_MIN = 35.0;        // a battle piece plays for at least this many seconds
export const FADE_OUT = 1.6;
export const FADE_IN = 2.2;
export const LEAD = 2.5;               // how many seconds before the end of a piece to start the transition to the next


export class Playlist {
    constructor(items, rnd) {
        this.items = Array.from(items);
        this.rnd = rnd;
        this.queue = [];
        this.last = null;
    }

    next() {
        if (!this.items.length) return null;
        if (!this.queue.length) {
            this.queue = this.items.slice();
            this.rnd.shuffle(this.queue);
            if (this.queue.length > 1 && this.queue[0] === this.last)      // no repeat at the seam of the loops
                this.queue.push(this.queue.shift());
        }
        this.last = this.queue.shift();
        return this.last;
    }
}


/** The same interface as the procedural music.MusicPlayer: enabled, volume, update(mode, dt, intensity),
 *  silence(); plus stinger(victory) and report fields (cur, kind). */
export class TrackPlayer {
    constructor(pg, base_dir, manifest) {
        this.pg = pg;
        this.mm = pg.mixer.music;
        this.dir = base_dir;
        const m = py.get(manifest, 'music', {});
        const files = py.get(manifest, 'files', {});
        const ok = p => os.path.exists(os.path.join(base_dir, p));
        this.dur = {};
        for (const lst of Object.values(m))
            for (const p of lst) this.dur[p] = Number(py.get(py.get(files, p, {}), 'duration', 0) || 0);
        this.title = {};
        for (const p of Object.keys(this.dur)) this.title[p] = py.get(py.get(files, p, {}), 'title', os.path.basename(p));
        const rnd = random.Random();
        this.lists = {};
        for (const k of ['menu', 'peace', 'battle', 'victory', 'defeat'])
            this.lists[k] = new Playlist(py.get(m, k, []).filter(p => ok(p)), rnd);
        this.volume = 0.5;
        this.enabled = true;
        this.mode = null;            // 'menu' | 'play'
        this.kind = null;            // what is playing/should be playing: menu | peace | battle | victory | defeat | None
        this.cur = null;             // the path of the playing piece
        this.pending = null;         // (path, loops) - waits until the old one fades
        this.level = 0.0;            // volume envelope 0..1
        this.target = 0.0;
        this.started = 0.0;
        this.battle_since = 0.0;
        this.calm = 0.0;
        this.hold = false;           // after the end of the match: the result has been played, then silence
        this.log = [];               // (time, event) - for checks
    }

    get ok() {
        return Boolean(this.lists['menu'].items.length || this.lists['peace'].items.length);
    }

    // ---- low level
    /** Request a piece change: the current one fades, then the new one starts. */
    _switch(path, loops = 0) {
        if (path == null) {
            this.pending = null;
            this.target = 0.0;
            return;
        }
        if (this.cur == null || this.level <= 0.001 || !this.mm.get_busy()) {
            this._start(path, loops);
        } else {
            this.pending = [path, loops];
            this.target = 0.0;
        }
    }

    _start(path, loops) {
        try {
            this.mm.load(os.path.join(this.dir, path));
            this.mm.set_volume(0.0);
            this.mm.play(loops);
        } catch (e) {
            this.cur = null;
            return;
        }
        this.cur = path;
        this.pending = null;
        this.level = 0.0;
        this.target = 1.0;
        this.started = time.monotonic();
        this.log.push([py.round(time.monotonic(), 2), 'play ' + py.get(this.title, path, path)]);
    }

    stop() {
        this.pending = null;
        this.target = 0.0;
    }

    // ---- events
    silence() {
        this.stop();
        this.hold = true;
        this.kind = null;
    }

    /** End of the match: a short victory/defeat piece (once), then silence. */
    stinger(win) {
        this.hold = true;
        this.kind = win ? 'victory' : 'defeat';
        const p = this.lists[this.kind].next();
        if (p && this.enabled) this._switch(p, 0);
        else this.stop();
    }

    _choose(kind) {
        this.kind = kind;
        const p = this.lists[kind].next() || (kind === 'battle' ? this.lists['peace'].next() : null);
        this._switch(p, kind === 'menu' ? -1 : 0);
        if (kind === 'battle') {
            this.battle_since = time.monotonic();
            this.calm = 0.0;
        }
    }

    // ---- frame
    update(mode, dt, intensity) {
        const now = time.monotonic();
        if (mode !== this.mode) {
            this.mode = mode;
            this.hold = false;
            this.kind = null;
        }
        if (!this.enabled) {
            if (this.cur != null || this.pending) this.stop();
        } else if (!this.hold) {
            if (this.mode === 'menu') {
                if (this.kind !== 'menu' || (this.cur == null && this.pending == null)) this._choose('menu');
            } else {
                let want = ['peace', 'battle'].includes(this.kind) ? this.kind : 'peace';
                if (intensity >= BATTLE_ON && this.lists['battle'].items.length) {
                    want = 'battle';
                    this.calm = 0.0;
                } else if (this.kind === 'battle') {
                    this.calm = intensity < BATTLE_OFF ? this.calm + dt : 0.0;
                    if (this.calm >= CALM_HOLD && now - this.battle_since >= BATTLE_MIN) want = 'peace';
                }
                if (want !== this.kind) {
                    this._choose(want);
                } else if (this.cur != null && this.pending == null && this.target > 0) {
                    const d = py.get(this.dur, this.cur, 0);
                    if ((d && now - this.started > d - LEAD) || !this.mm.get_busy())
                        this._choose(this.kind);             // the next one from the same list
                } else if (this.cur == null && this.pending == null) {
                    this._choose(this.kind);
                }
            }
        }
        // envelope
        if (this.target > this.level) this.level = Math.min(this.target, this.level + dt / FADE_IN);
        else if (this.target < this.level) this.level = Math.max(this.target, this.level - dt / FADE_OUT);
        if (this.level <= 0.0 && this.target <= 0.0 && this.cur != null) {
            try {
                this.mm.stop();
            } catch (e) { /* ignore */ }
            this.cur = null;
            if (this.pending && this.enabled) this._start(...this.pending);
        }
        if (this.cur != null) {
            try {
                this.mm.set_volume(this.level * this.level * this.volume);
            } catch (e) { /* ignore */ }
        }
    }
}
