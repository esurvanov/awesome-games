"""Reference values for web/tests/G7-uicore.test.mjs: pure-logic outputs of uiskin_map, uiskin, widgets, controls, ui.
Run: SDL_VIDEODRIVER=dummy .venv/bin/python web/tests/gen_G7-uicore_ref.py"""
import json, math, os, sys
os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('KHRONIKI_LANG', 'en')
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
sys.path.insert(0, ROOT)
import pygame
pygame.init()
from game import data  # noqa  (registers content)
from game import uiskin_map as M, uiskin as S, widgets, controls, ui

out = {}
out['map'] = {k: (sorted(v.items()) if isinstance(v, dict) else list(v)) for k, v in vars(M).items()
              if k.isupper() and isinstance(v, (dict, list, tuple))}
out['map'] = json.loads(json.dumps(out['map']))
civs = [None, 'britons', 'franks', 'teutons', 'byzantines', 'persians', 'chinese', 'mongols', 'japanese', 'spanish']
pp = []
for civ in civs:
    for name in sorted(data.UNITS) + list(M.GAIA_PORTRAITS):
        pp.append(['u', name, civ, S.portrait_path('u', name, civ)])
    for name in sorted(data.BUILDINGS):
        pp.append(['b', name, civ, S.portrait_path('b', name, civ)])
    for name in sorted(data.TECHS):
        pp.append(['t', name, civ, S.portrait_path('t', name, civ)])
    for name in list(M.GAIA_PORTRAITS) + ['nope']:
        pp.append(['n', name, civ, S.portrait_path('n', name, civ)])
    for a in range(4):
        pp.append(['age', a, civ, S.portrait_path('age', a, civ)])
out['portrait_path'] = pp
out['unique_age'] = S._unique_age()
out['cursor_files'] = S.CURSOR_FILES
out['culture'] = {c: S.culture(c)['key'] for c in civs + ['nope']}
out['civ_group'] = {str(c): S.civ_group(c) for c in civs}
out['line_roots'] = controls._line_roots()
out['list_rects'] = [[list(r), i] for r, i in widgets.list_rects(800, (100, 700, 80, 24), 5)] + \
    [[list(r), i] for r, i in widgets.list_rects(800, (100, 100, 200, 30), 3, 30)]
out['qface'] = [[fx, fy, ui._qface(fx, fy)] for fx in (-1, -0.7, -0.2, 0.0001, 0.3, 1) for fy in (-1, -0.5, 0, 0.4, 1)]
out['dirs8'] = ui._DIRS8
fonts = S.game_fonts()
out['font_sizes'] = {k: [S._font_info[id(f)][0], S._font_info[id(f)][1], S._font_info[id(f)][2]] for k, f in fonts.items()}


class G(controls.ControlsUI):
    pass
g = G()
out['line_of'] = {k: g.line_of(k) for k in sorted(data.UNITS)}
out['common'] = [controls.ControlsUI.common([], 'x', 1)]
json.dump(out, open(os.path.join(ROOT, 'web', 'tests', 'fixtures', 'G7-uicore.json'), 'w'), indent=0, default=list)
print('ok', len(pp))
