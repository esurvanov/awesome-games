"""Reference values for web/tests/G8-hud.test.mjs from the Python HUD modules (hud, hud_windows, civ_ui).
Run: KHRONIKI_LANG=en SDL_VIDEODRIVER=dummy .venv/bin/python web/tests/gen_G8-hud_ref.py"""
import json
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
sys.path.insert(0, ROOT)
os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('KHRONIKI_LANG', 'en')

import pygame  # noqa: E402
pygame.init()
import game.data  # noqa: E402,F401
from game.data import BUILDINGS, BUILD_MENU, TECHS, AGE_TECHS  # noqa: E402
from game import hud, hud_windows, civ_ui, world  # noqa: E402


def rt(r):
    return [r.x, r.y, r.w, r.h]


def jsonable(x):
    if isinstance(x, pygame.Rect):
        return rt(x)
    if isinstance(x, (list, tuple)):
        return [jsonable(v) for v in x]
    if isinstance(x, dict):
        return {k: jsonable(v) for k, v in x.items()}
    if callable(x):
        return 'fn'
    if isinstance(x, world.Building):
        return 'bld'
    return x


class FakeWorld:
    def __init__(self, players):
        self.players = players
        self.buildings = []

    def build_age(self, p, kind):
        return BUILDINGS[kind]['age']


class Stub(hud.HudUI):
    def __init__(self, page=0):
        self.cmd_page = page
        self.selected = []
        self._bp_key = None


out = {}
civs = civ_ui.playable() + ['random']
out['playable'] = civ_ui.playable()
out['civ_names'] = {k: civ_ui.civ_name(k) for k in civs}
out['unique_units'] = {k: civ_ui.unique_units(k) for k in civs}
out['unique_techs'] = {k: civ_ui.unique_techs(k) for k in civs}
out['menu_items'] = [[rt(r), a, k] for r, a, k in civ_ui.menu_items()]
out['civ_list'] = hud_windows.civ_list()
out['tt_items'] = {k: jsonable(hud_windows.tt_items(k)) for k in civ_ui.playable()}
out['boxes'] = {k: rt(v) for k, v in hud_windows.BOXES.items()}
out['taunts'] = hud_windows.TAUNTS

# tech tree layout per civilization
tt = {}
for civ in civ_ui.playable()[:4]:
    g = Stub()
    g.tt_civ = civ
    cells, rows, x0, colw = hud_windows.tt_layout(g)
    tt[civ] = [jsonable(cells), jsonable(rows), x0, colw]
out['tt_layout'] = tt

# grid layout: slots, free cells, paging
def item(i, slot=None):
    d = dict(icon=('u', 'u%d' % i), act=('x', i), ok=True, tip=['t%d' % i, {}])
    if slot is not None:
        d['slot'] = slot
    return d


cases = [
    ([item(0), item(1, 3), item(2, 3), item(3)], []),
    ([item(i) for i in range(12)], [item(100), item(101, 4)]),
    ([item(i, i % 4) for i in range(20)], [item(200)]),
    ([item(i) for i in range(30)], [item(300), item(301)]),
]
gl = []
for page in (0, 1, 2, 5):
    for items, fixed in cases:
        gl.append(jsonable(Stub(page).grid_layout(items, fixed)))
out['grid_layout'] = gl

# building slots + tech chains + villager pages for each civilization
bs, chains, vil = {}, {}, {}
for civ in civ_ui.playable():
    p = world.Player(0, civ=civ)
    p.res = {'food': 10000, 'wood': 10000, 'gold': 10000, 'stone': 10000}
    g = Stub()
    g.world = FakeWorld([p])
    for kind in ('barracks', 'archery_range', 'stable', 'blacksmith', 'town_center', 'university', 'monastery',
                 'castle', 'dock', 'mill', 'lumber_camp', 'market', 'siege_workshop'):
        b = world.Building.__new__(world.Building)
        b.kind = kind
        d = BUILDINGS[kind]
        items = []
        for k in d.get('trains', []):
            items.append(dict(act=('train', None, p.current(k))))
        for t in d.get('techs', []):
            if t in TECHS:
                items.append(dict(act=('research', None, t)))
        if kind == 'town_center':
            items += [dict(act=('bell',)), dict(act=('eject', None))]
        chains[civ + ':' + kind] = g.tech_chains(type('B', (), {'kind': kind, 'd': d})(), p)
        bs[civ + ':' + kind] = [it.get('slot', 'none') for it in
                                g.building_slots(type('B', (), {'kind': kind, 'd': d})(), p, items)]
    rows = []
    for page in (None, 'eco', 'mil'):
        g.build_page = page
        g._bp_key = ()
        its = g.villager_items(p)
        rows.append([[it['icon'][0], jsonable(it['icon'][1]), it['act'][0], it['ok'], jsonable(it['tip']), it.get('slot')]
                     for it in its])
    vil[civ] = rows
out['building_slots'] = bs
out['tech_chains'] = chains
out['villager_items'] = vil

os.makedirs(os.path.join(ROOT, 'web', 'tests', 'fixtures'), exist_ok=True)
with open(os.path.join(ROOT, 'web', 'tests', 'fixtures', 'G8-hud_ref.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False)
print('ok', len(json.dumps(out)))
