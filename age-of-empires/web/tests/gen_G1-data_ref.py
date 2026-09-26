"""Reference values for web/tests/G1-data.test.mjs (run: KHRONIKI_LANG=en .venv/bin/python web/tests/gen_G1-data_ref.py).

Dumps the content-extended data tables (functions -> '<fn>', tuples -> lists, sets -> sorted lists, int keys ->
strings, dict key order kept), i18n / themes / maps / keymap / data helper results."""
import json
import os
import sys
import tempfile

os.environ['KHRONIKI_LANG'] = 'en'
os.environ['KHRONIKI_HOME'] = tempfile.mkdtemp()
os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
sys.path.insert(0, ROOT)

import pygame  # noqa: E402
pygame.init()
from game import data, i18n, themes, maps, keymap  # noqa: E402
from game.content import civs, civ_units, _uni  # noqa: E402


def norm(v):
    if callable(v):
        return '<fn>'
    if isinstance(v, dict):
        return [[str(k), norm(x)] for k, x in v.items()]
    if isinstance(v, (set, frozenset)):
        return sorted(norm(x) for x in v)
    if isinstance(v, (list, tuple)):
        return [norm(x) for x in v]
    if isinstance(v, float) and v == int(v):
        return int(v)
    return v


out = {}
for name in ('UNITS', 'BUILDINGS', 'TECHS', 'CIVS', 'NODE_DEFS', 'ANIMALS', 'BUILD_MENU', 'AGE_REQ', 'RES_NAME',
             'COLOR_NAMES', 'PLAYER_NAMES', 'AGE_NAMES', 'DIFF_NAMES', 'MAP_SIZES', 'WORLD_HOOKS'):
    out[name] = norm(getattr(data, name))
out['WORLD_HOOKS_n'] = {k: len(v) for k, v in data.WORLD_HOOKS.items()}
out['UNIQUE'] = norm(civ_units.UNIQUE)
out['UTECHS'] = norm(civ_units.UTECHS)
out['PLAYABLE'] = civs.PLAYABLE
out['PENDING'] = _uni.PENDING
out['MAPS'] = norm(maps.MAPS)
out['MAP_NAMES'] = norm(maps.NAMES)
out['maps_fn'] = [[mt, maps.is_water(mt), maps.is_legacy(mt), maps.is_nomad(mt), maps.name(mt)]
                  for mt in list(maps.MAPS) + ['nope']]
out['shade'] = [list(data.shade(c, d)) for c in ((10, 20, 30), (250, 5, 128, 77)) for d in (-40, 0, 13, 300)]
out['dist'] = [data.dist_point_rect(*a) for a in ((0, 0, 3, 4, 2, 2), (5, 5, 0, 0, 10, 10), (20, 3, 0, 0, 10, 10),
                                                  (-7.5, 30.25, 1, 2, 3, 4), (3, -9, 0, 0, 10, 10))]
out['iso'] = [list(data.to_iso(100, 37.5)), list(data.to_iso(3, 4, 10, 2.5)), list(data.from_iso(100, 50)),
              list(data.from_iso(7, 9, 3))]
out['cost_add'] = data.cost_add({'food': 5, 'gold': 1}, {'wood': 3, 'food': 2})
out['hash'] = [themes._hash(x, y, s) for x in (0, 1, 7, 99, 219, 12345) for y in (0, 3, 150, 218) for s in (0, 1, 5, 9, 11)]
out['hash_neg'] = [themes._hash(-3, 5, 1), themes._hash(4, -100, 9), themes._hash(-1, -1, -1)]
out['species'] = {}
for key, th in themes.THEMES.items():
    out['species'][key] = [themes.pick_species(tuple(th['species']), tx, ty) for ty in range(0, 60, 3) for tx in range(0, 60, 2)]
out['species_empty'] = themes.pick_species((), 3, 4)


class W:
    theme = 'snow'


out['tree_species_avail'] = [themes.tree_species(W, tx, 7, available={'fir_winter', 'winter_tree'}) for tx in range(40)]
out['mm'] = [list(themes.mm_color(W, g)) for g in ('grass', 'water', 'nope', 'forest')]
out['match_code'] = [i18n.match_code(x) for x in (None, '', 'ru_RU.UTF-8', 'pt', 'PT_br', 'zh_TW', 'de-AT', 'en@euro',
                                                  'xx', 'it_IT', 'ja_JP', 'fr')]
out['t'] = [i18n.t('unit.knight.name'), i18n.t('no.such.key'), i18n.t('menu.version', v='0.9.1'),
            i18n.name_of('tech', 'loom'), i18n.desc_of('building', 'castle'), i18n.has('unit.knight.name'),
            i18n.has('x.y'), i18n.player_name()]
fmt_keys = [k for k, v in i18n.load('en').items() if '{' in v][:40]
out['t_fmt'] = [[k, i18n.t(k, n=3, name='Bob', v='x', a=1, b=2, x=5, count=7)] for k in fmt_keys]
out['keymap'] = [[a, keymap.key_for(a), keymap.default_code(a), keymap.name_for(a), keymap.label(a),
                  keymap.pretty(keymap.name_for(a))] for a, _, _, _ in keymap.ACTIONS]
out['matches'] = [keymap.matches('pause', pygame.K_p), keymap.matches('pause', pygame.K_F3),
                  keymap.matches('speed_up', pygame.K_KP_PLUS), keymap.matches('speed_up', pygame.K_a)]
keymap.set_key('pause', pygame.K_F4)
out['after_set'] = [keymap.name_for('pause'), keymap.name_for('score'), keymap.translate(pygame.K_F4),
                    keymap.translate(pygame.K_F3), keymap.translate(pygame.K_p), keymap.translate(pygame.K_a),
                    keymap.matches('pause', pygame.K_p)]
keymap.reset()
out['after_reset'] = keymap.name_for('pause')
json.dump(out, open(os.path.join(ROOT, 'web', 'tests', 'fixtures', 'G1-data_ref.json'), 'w'), ensure_ascii=False)
print('ok')
