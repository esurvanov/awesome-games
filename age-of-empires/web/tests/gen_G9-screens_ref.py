"""Reference fixture for web/tests/G9-screens.test.mjs: runs the pure-logic parts of game/menu.py, screens.py,
lobby.py, settings_ui.py, saves_ui.py, playlist.py on a mock game object (the same mock the JS test builds) and dumps
JSON into web/tests/fixtures/G9-screens_ref.json.
  .venv/bin/python web/tests/gen_G9-screens_ref.py"""
import json
import os
import random
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, ROOT)
os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
os.environ['KHRONIKI_HOME'] = tempfile.mkdtemp()
os.environ['KHRONIKI_LANG'] = 'en'

import pygame  # noqa: E402
import game.data  # noqa: E402,F401
from game import i18n  # noqa: E402
i18n.set_language('en', persist=False)
from game import menu, screens, lobby, settings_ui, saves_ui, playlist  # noqa: E402
from game import settings as gsettings  # noqa: E402


class Font:
    def __init__(self, k):
        self.k = k

    def size(self, t):
        return (len(t) * self.k, 16)


FONTS = {'h': Font(12), 'l': Font(9), 'btn': Font(8), 's': Font(6), 'm': Font(7), 'b': Font(8), 'bs': Font(7),
         'xl': Font(14)}


class Audio:
    def __init__(self):
        self.clicks = 0
        self.settings = {'music': True, 'sfx': True, 'music_vol': 0.8, 'sfx_vol': 0.8, 'voice_vol': 0.8}

    def click(self):
        self.clicks += 1


class Mock(screens.ScreensUI, menu.MenuUI, lobby.LobbyUI):
    def __init__(self):
        self.menu_cfg = {}
        self.audio = Audio()
        self.fonts = FONTS
        self.state = 'menu'
        self.help = False
        self.world = None
        self.loaded = None
        self.running = True

    def begin_loading(self, args):
        self.loaded = args


def rects(lst):
    out = []
    for it in lst:
        it = list(it)
        r = it[0]
        out.append([[r.x, r.y, r.w, r.h]] + [list(v) if isinstance(v, tuple) else v for v in it[1:]])
    return out


ref = {}

# ---- playlist
pl = playlist.Playlist(['a', 'b', 'c', 'd', 'e'], random.Random(5))
ref['playlist_seq'] = [pl.next() for _ in range(17)]


class Music:
    def __init__(self):
        self.calls = []
        self.busy = False

    def load(self, p):
        self.calls.append(['load', p])

    def set_volume(self, v):
        self.calls.append(['vol', round(v, 6)])

    def play(self, loops=0):
        self.calls.append(['play', loops])
        self.busy = True

    def stop(self):
        self.calls.append(['stop'])
        self.busy = False

    def get_busy(self):
        return self.busy


class PG:
    class mixer:
        music = None


PG.mixer.music = Music()
man = json.load(open(os.path.join(ROOT, 'assets', 'audio', 'manifest.json'), encoding='utf-8'))
tp = playlist.TrackPlayer(PG, 'assets/audio', man)
shared = random.Random(1)
for v in tp.lists.values():
    v.rnd = shared
ref['tp_dur'] = tp.dur
ref['tp_title'] = tp.title
ref['tp_lists'] = {k: v.items for k, v in tp.lists.items()}
ref['tp_ok'] = tp.ok
trace = []
script = [('menu', 0.05, 0.0)] * 30 + [('play', 0.05, 0.0)] * 60 + [('play', 0.05, 1.2)] * 40 + \
    [('play', 0.05, 0.1)] * 30
for i, (mode, dt, inten) in enumerate(script):
    tp.update(mode, dt, inten)
    trace.append([tp.kind, tp.cur, round(tp.level, 6), round(tp.target, 6), list(tp.pending) if tp.pending else None])
    if i == 100:
        tp.stinger(True)
ref['tp_trace'] = trace
ref['tp_calls'] = PG.mixer.music.calls

# ---- lobby
g = Mock()
ref['de_colors'] = lobby.de_colors()
ref['default_slots'] = lobby.default_slots()
ref['setup_rects0'] = rects(g.setup_rects())
ref['setting_rows0'] = g.setting_rows()
ov = {}
for key in ['map', 'ai_all', 'player', 'nplayers', 'mode', 'resources', 'speed', 'treaty']:
    vals, lbls, idx = g.option_values(key)
    ov[key] = [[list(v) if isinstance(v, tuple) else v for v in vals], lbls, idx]
ref['option_values0'] = ov
seq = [('color', 1), ('color', 1), ('team', 1), ('team', 0), ('flag', 'lock_speed'), ('map', 'arena')]
for act, val in seq:
    g.lobby_action(act, val)
g.apply_choice('nplayers', None, 5)
g.apply_choice('player', 3, ('ai', 4))
g.apply_choice('ai_all', None, 3)
g.apply_choice('player', 2, ('closed', None))
g.apply_choice('mode', None, 'dm')
g.apply_choice('treaty', None, 10)
g.lobby_action('opt', 'speed')
ref['dropdown'] = [[g.dropdown[0].x, g.dropdown[0].y, g.dropdown[0].w, g.dropdown[0].h]] + \
    [list(x) if isinstance(x, tuple) else x for x in g.dropdown[1:]]
g.dropdown = None
ref['slots1'] = g.slots()
ref['opts1'] = g.opts()
ref['active1'] = g.active_slots()
ref['teams_ok1'] = g.teams_ok()
ref['ai_all1'] = g.ai_level_all()
ref['setup_rects1'] = rects(g.setup_rects())
ref['flags_y1'] = g.flags_y()
g.lobby_action('play', None)
ref['loaded'] = g.loaded
g.lobby_action('reset', None)
ref['slots_reset'] = g.slots()

# ---- screens
ref['clock'] = [screens._clock(t) for t in (None, 0, 5.7, 59, 61, 3599, 3600, 3725.2, 86399)]
ref['tips'] = screens.TIPS
ref['stats_rects'] = rects(g.stats_rects())
box, items = g.game_menu_rects()
ref['game_menu_rects'] = [[box.x, box.y, box.w, box.h], rects(items)]
box, items = g.gameover_rects()
ref['gameover_rects'] = [[box.x, box.y, box.w, box.h], rects(items)]
box, items = g.confirm_rects()
ref['confirm_rects'] = [[box.x, box.y, box.w, box.h], rects(items)]


class P:
    id = 0
    gathered = {'food': 123.7, 'wood': 55.2}


st = {'kills': 4, 'losses': 2, 'razed': 1, 'bld_lost': 0, 'converted': 0, 'army_max': 12, 'trib_sent': 10.5,
      'trib_recv': 0.0, 'trade': 44.9, 'age_t': [0, 300.5, None, 0], 'techs': 7, 'explored': 0.4567, 'castles': 1,
      'vil_max': 30, 'pop_max': 50, 'samples': [[0, 4], [30, 7], [60, 12], [400, 30]]}
sc = {'military': 1, 'economy': 2, 'technology': 3, 'society': 4, 'total': 10}
cols = {}
for tab in ('score', 'military', 'economy', 'tech', 'society', 'timeline'):
    cols[tab] = [[lbl, ic, fn(None, P(), st, sc), fmt] for lbl, ic, fn, fmt in screens.stat_columns(tab)]
ref['stat_columns'] = cols
ref['pop_at'] = [screens.ScreensUI._pop_at(st, t) for t in (-1, 0, 29, 30, 100, 1000)]
# overlay: menu actions without a world
g.help = 'menu'
g.game_menu_action('resume')
ref['help_after_resume'] = g.help

# ---- settings_ui
g.state = 'menu'
sr = {}
for tab in ('game', 'graphics', 'interface', 'audio', 'keys'):
    g.set_tab = tab
    sr[tab] = rects(g.settings_rects())
ref['settings_rects'] = sr
g.set_tab = 'game'
ref['row_of'] = [list(g.row_of(k)) for k in ('game_speed', 'scroll_speed', 'nope')]
ref['lbl'] = [settings_ui._lbl(x) for x in ('settings.off', 'match.val.speed.1.5', '30', 'English')]
g.settings_action('ctl', 'game_speed')
d = g.set_drop
ref['set_drop'] = [[d[0].x, d[0].y, d[0].w, d[0].h], d[1], d[2], d[3], d[4]]
g.set_drop = None
g.settings_action('ctl', 'scroll_speed', (1000, 200))
ref['scroll_speed'] = gsettings.get('scroll_speed')
g.settings_event(pygame.event.Event(pygame.MOUSEMOTION, pos=(1100, 200), rel=(0, 0), buttons=(1, 0, 0)))
ref['scroll_speed2'] = gsettings.get('scroll_speed')
g.set_tab = 'audio'
g.settings_action('ctl', 'music_vol', (1150, 300))
ref['music_vol'] = g.audio.settings['music_vol']
g.set_tab = 'interface'
g.settings_action('ctl', 'player_name')
for ch in 'Ann':
    g.settings_event(pygame.event.Event(pygame.KEYDOWN, key=ord(ch.lower()), unicode=ch, mod=0))
g.settings_event(pygame.event.Event(pygame.KEYDOWN, key=pygame.K_BACKSPACE, unicode='', mod=0))
ref['player_name'] = gsettings.get('player_name')
g.settings_action('done', None)
ref['after_done'] = [g.menu_screen, g.set_tab]

# ---- saves_ui
g.saves_mode = 'load'
g.saves_list = [('s%d' % i, {'name': 'n%d' % i}, None) for i in range(9)]
g.saves_scroll = 60
ref['saves_rects_load'] = rects(g.saves_rects())
g.saves_mode = 'save'
g.saves_scroll = 0
ref['saves_rects_save'] = rects(g.saves_rects())
g.saves_action('slot', 's3')
ref['save_name'] = g.save_name
ref['saves_clock'] = [saves_ui._clock(t) for t in (0, 75.5, 4000)]

# ---- menu
g.menu_screen = 'main'
ref['main_rects'] = rects(g.main_rects())
ref['single_rects'] = rects(g.single_rects())
ref['learn_rects'] = rects(g.learn_rects())
ref['wrap'] = menu._wrap(FONTS['m'], 'The quick brown fox jumps over the lazy dog, again and again and again.', 120)
ref['credits'] = g.credits_lines()
seq = []
for act in ('single', 'skirmish', 'back', 'back', 'learn', 'back', 'news', 'credits', 'back', 'multi'):
    g.menu_action(act, None)
    seq.append(g.menu_screen)
ref['menu_seq'] = seq
g.start_tutorial()
ref['tutorial'] = g.loaded

json.dump(ref, open(os.path.join(ROOT, 'web', 'tests', 'fixtures', 'G9-screens_ref.json'), 'w'), ensure_ascii=False,
          indent=0)
print('ok')
