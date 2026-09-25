"""Music from files (0 A.D., assets/audio/music): streaming playback through pygame.mixer.music.

Modes: menu (the theme on a loop) -> match (a peaceful playlist in random order) <-> battle (battle pieces) -> result
(a short victory or defeat piece, then silence until the menu).

Battle starts when the intensity near the player (Audio.combat) crosses the upper threshold, and stops
only after the intensity has stayed below the lower threshold for CALM_HOLD seconds and the battle piece
has played for at least BATTLE_MIN - so the music does not "flicker" from isolated skirmishes.

SDL has only one stream, so changing a piece is a quick fade-out of the old one and a smooth entry of the new one;
we drive the volume ourselves every frame (pygame's built-in fadeout blocks or conflicts with set_volume).
The end of a piece is caught in advance by the duration from the manifest, so the next one enters without a pause."""
import os
import random
import time

BATTLE_ON = 0.9          # the intensity at which battle music starts
BATTLE_OFF = 0.25        # below - a "lull"
CALM_HOLD = 14.0         # how many seconds of lull are needed to return to peaceful music
BATTLE_MIN = 35.0        # a battle piece plays for at least this many seconds
FADE_OUT = 1.6
FADE_IN = 2.2
LEAD = 2.5               # how many seconds before the end of a piece to start the transition to the next


class Playlist:
    def __init__(self, items, rnd):
        self.items = list(items)
        self.rnd = rnd
        self.queue = []
        self.last = None

    def next(self):
        if not self.items:
            return None
        if not self.queue:
            self.queue = self.items[:]
            self.rnd.shuffle(self.queue)
            if len(self.queue) > 1 and self.queue[0] == self.last:     # no repeat at the seam of the loops
                self.queue.append(self.queue.pop(0))
        self.last = self.queue.pop(0)
        return self.last


class TrackPlayer:
    """The same interface as the procedural music.MusicPlayer: enabled, volume, update(mode, dt, intensity),
    silence(); plus stinger(victory) and report fields (cur, kind)."""

    def __init__(self, pg, base_dir, manifest):
        self.pg = pg
        self.mm = pg.mixer.music
        self.dir = base_dir
        m = manifest.get('music', {})
        files = manifest.get('files', {})
        ok = lambda p: os.path.exists(os.path.join(base_dir, p))       # noqa: E731
        self.dur = {p: float(files.get(p, {}).get('duration', 0) or 0) for lst in m.values() for p in lst}
        self.title = {p: files.get(p, {}).get('title', os.path.basename(p)) for p in self.dur}
        rnd = random.Random()
        self.lists = {k: Playlist([p for p in m.get(k, []) if ok(p)], rnd) for k in
                      ('menu', 'peace', 'battle', 'victory', 'defeat')}
        self.volume = 0.5
        self.enabled = True
        self.mode = None            # 'menu' | 'play'
        self.kind = None            # what is playing/should be playing: menu | peace | battle | victory | defeat | None
        self.cur = None             # the path of the playing piece
        self.pending = None         # (path, loops) - waits until the old one fades
        self.level = 0.0            # volume envelope 0..1
        self.target = 0.0
        self.started = 0.0
        self.battle_since = 0.0
        self.calm = 0.0
        self.hold = False           # after the end of the match: the result has been played, then silence
        self.log = []               # (time, event) - for checks

    @property
    def ok(self):
        return bool(self.lists['menu'].items or self.lists['peace'].items)

    # ---- low level
    def _switch(self, path, loops=0):
        """Request a piece change: the current one fades, then the new one starts."""
        if path is None:
            self.pending = None
            self.target = 0.0
            return
        if self.cur is None or self.level <= 0.001 or not self.mm.get_busy():
            self._start(path, loops)
        else:
            self.pending = (path, loops)
            self.target = 0.0

    def _start(self, path, loops):
        try:
            self.mm.load(os.path.join(self.dir, path))
            self.mm.set_volume(0.0)
            self.mm.play(loops=loops)
        except Exception:
            self.cur = None
            return
        self.cur = path
        self.pending = None
        self.level = 0.0
        self.target = 1.0
        self.started = time.monotonic()
        self.log.append((round(time.monotonic(), 2), 'play ' + self.title.get(path, path)))

    def stop(self):
        self.pending = None
        self.target = 0.0

    # ---- events
    def silence(self):
        self.stop()
        self.hold = True
        self.kind = None

    def stinger(self, win):
        """End of the match: a short victory/defeat piece (once), then silence."""
        self.hold = True
        self.kind = 'victory' if win else 'defeat'
        p = self.lists[self.kind].next()
        if p and self.enabled:
            self._switch(p, 0)
        else:
            self.stop()

    def _choose(self, kind):
        self.kind = kind
        p = self.lists[kind].next() or (self.lists['peace'].next() if kind == 'battle' else None)
        self._switch(p, -1 if kind == 'menu' else 0)
        if kind == 'battle':
            self.battle_since = time.monotonic()
            self.calm = 0.0

    # ---- frame
    def update(self, mode, dt, intensity):
        now = time.monotonic()
        if mode != self.mode:
            self.mode = mode
            self.hold = False
            self.kind = None
        if not self.enabled:
            if self.cur is not None or self.pending:
                self.stop()
        elif not self.hold:
            if self.mode == 'menu':
                if self.kind != 'menu' or (self.cur is None and self.pending is None):
                    self._choose('menu')
            else:
                want = self.kind if self.kind in ('peace', 'battle') else 'peace'
                if intensity >= BATTLE_ON and self.lists['battle'].items:
                    want = 'battle'
                    self.calm = 0.0
                elif self.kind == 'battle':
                    self.calm = self.calm + dt if intensity < BATTLE_OFF else 0.0
                    if self.calm >= CALM_HOLD and now - self.battle_since >= BATTLE_MIN:
                        want = 'peace'
                if want != self.kind:
                    self._choose(want)
                elif self.cur is not None and self.pending is None and self.target > 0:
                    d = self.dur.get(self.cur, 0)
                    if (d and now - self.started > d - LEAD) or not self.mm.get_busy():
                        self._choose(self.kind)             # the next one from the same list
                elif self.cur is None and self.pending is None:
                    self._choose(self.kind)
        # envelope
        if self.target > self.level:
            self.level = min(self.target, self.level + dt / FADE_IN)
        elif self.target < self.level:
            self.level = max(self.target, self.level - dt / FADE_OUT)
        if self.level <= 0.0 and self.target <= 0.0 and self.cur is not None:
            try:
                self.mm.stop()
            except Exception:
                pass
            self.cur = None
            if self.pending and self.enabled:
                self._start(*self.pending)
        if self.cur is not None:
            try:
                self.mm.set_volume(self.level * self.level * self.volume)
            except Exception:
                pass
