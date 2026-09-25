"""Map landscapes (like the Arabia biomes in AoE II DE): the same cell layout - a different look.

The world.terrain codes and the world.ground ground types (game/terrain.py GROUNDS) do not change: a landscape only
reassigns the textures of ground types, tree species and minimap colors. The match's landscape is world.theme
(a string; set by the map generator, by default 'grass' - the former temperate look).

  THEMES[key] = dict(
      name    - the caption,
      tex     - {ground type: texture name} (a name from assets/gen/maps/maps.json 'terrain' or from the atlas;
                 not in the dict - the texture of the type itself),
      species - [(species, weight)] of trees (a species from maps.json 'trees' or from the atlas 'nature.trees'),
      conifer - species under which there is a conifer floor (ground type 'pine'),
      mm      - {ground type: minimap color} over MM_BASE,
      water   - None (the world's water does not change).
  of(w) · tree_species(w, tx, ty) · mm_color(w, ground_name) · KEYS · ARABIA_POOL
"""

# AoE II DE minimap colors (dat: the minimap color of ground types and objects; docs/research/07_maps.md section 5)
MM_BASE = {
    'grass': (0, 169, 0), 'grass2': (51, 151, 39), 'grass3': (0, 141, 0),
    'dirt': (243, 170, 92), 'dirt2': (248, 201, 138), 'dirt3': (155, 160, 60),
    'forest': (37, 116, 57), 'pine': (21, 118, 21),
    'sand': (248, 201, 138), 'beach': (232, 196, 120),
    'shallow': (48, 93, 182), 'water': (0, 74, 187), 'rocky': (145, 122, 96),
}
MM_WATER = (0, 74, 187)          # deep water #004ABB
MM_WATER_NEAR = (0, 74, 161)     # by the shore #004AA1
MM_SHALLOW = (48, 93, 182)       # shallows #305DB6
MM_CLIFF = (113, 75, 51)         # cliff #714B33
MM_GOLD = (255, 199, 0)          # #FFC700
MM_STONE = (145, 145, 145)       # #919191
MM_FOOD = (165, 196, 108)        # all food as one dot (berries, fish, sheep, deer, boars) #A5C46C
MM_RELIC = (255, 255, 255)       # relic - white
MM_WOLF = (210, 206, 196)        # predators - a neutral light dot (not food)

_TEMPERATE = (('oak', 5), ('beech', 3), ('deci', 3), ('birch', 2), ('pine', 3), ('fir', 3), ('poplar', 1))

THEMES = {
    'grass': dict(name='grass', tex={}, species=_TEMPERATE, conifer=('pine', 'fir'), mm={}, water=None),
    'desert': dict(
        name='desert',
        tex={'grass': 'desert_sand', 'grass2': 'desert_sand2', 'grass3': 'desert_dunes', 'dirt': 'desert_dirt',
             'dirt2': 'desert_dirt2', 'dirt3': 'desert_scrub', 'forest': 'desert_forest', 'pine': 'desert_forest',
             'sand': 'desert_dunes', 'beach': 'desert_dunes', 'rocky': 'desert_rocky'},
        species=(('palm', 5), ('palm_tall', 2)), conifer=(),
        mm={'grass': (232, 186, 120), 'grass2': (228, 180, 112), 'grass3': (236, 194, 130),
            'dirt': (243, 170, 92), 'dirt2': (248, 201, 138), 'dirt3': (214, 170, 100),
            'forest': (62, 120, 44), 'pine': (62, 120, 44), 'sand': (248, 201, 138), 'beach': (248, 212, 150)},
        water=None),
    'steppe': dict(
        name='steppe',
        tex={'grass': 'steppe_grass', 'grass2': 'steppe_grass2', 'grass3': 'steppe_grass3', 'dirt': 'steppe_dirt',
             'dirt2': 'steppe_dirt2', 'dirt3': 'steppe_grass3', 'forest': 'steppe_forest', 'pine': 'steppe_forest'},
        species=(('acacia', 4), ('oak', 2), ('baobab', 1)), conifer=(),
        mm={'grass': (150, 160, 60), 'grass2': (140, 150, 52), 'grass3': (166, 164, 70),
            'dirt': (214, 168, 96), 'dirt3': (170, 160, 80), 'forest': (60, 110, 40), 'pine': (60, 110, 40)},
        water=None),
    'snow': dict(
        name='snow',
        tex={'grass': 'snow', 'grass2': 'snow2', 'grass3': 'snow_grass', 'dirt': 'snow_dirt', 'dirt2': 'snow_dirt',
             'dirt3': 'snow_grass', 'forest': 'snow_forest', 'pine': 'snow_forest', 'sand': 'snow_dirt',
             'beach': 'snow_dirt', 'rocky': 'snow_rocky'},
        species=(('snow_pine', 4), ('fir_winter', 3), ('winter_tree', 1)), conifer=('snow_pine', 'fir_winter'),
        mm={'grass': (236, 236, 244), 'grass2': (222, 224, 234), 'grass3': (206, 214, 214),
            'dirt': (176, 166, 150), 'dirt2': (190, 182, 168), 'dirt3': (200, 206, 204),
            'forest': (40, 96, 64), 'pine': (40, 96, 64), 'sand': (190, 182, 168), 'beach': (200, 194, 180),
            'rocky': (150, 146, 142)},
        water=None),
    'tropical': dict(
        name='tropical',
        tex={'grass': 'tropic_grass', 'grass2': 'tropic_grass2', 'grass3': 'tropic_grass3', 'dirt': 'tropic_dirt',
             'dirt2': 'tropic_dirt2', 'dirt3': 'tropic_grass3', 'forest': 'tropic_forest', 'pine': 'tropic_forest',
             'beach': 'tropic_beach', 'sand': 'tropic_beach'},
        species=(('tropic', 4), ('palm_tropical', 3), ('palm', 1)), conifer=(),
        mm={'grass': (0, 150, 24), 'grass2': (20, 140, 30), 'grass3': (30, 160, 40), 'dirt': (190, 140, 80),
            'forest': (10, 90, 30), 'pine': (10, 90, 30), 'beach': (240, 214, 150), 'sand': (240, 214, 150)},
        water=None),
    'autumn': dict(
        name='autumn',
        tex={'grass': 'autumn_grass', 'grass2': 'autumn_grass2', 'grass3': 'autumn_grass3',
             'forest': 'autumn_forest', 'pine': 'autumn_forest', 'dirt3': 'autumn_grass3'},
        species=(('oak_aut', 4), ('maple_aut', 3), ('beech_aut', 2), ('poplar_aut', 1), ('pine', 1)),
        conifer=('pine',),
        mm={'grass': (110, 160, 30), 'grass2': (130, 150, 30), 'grass3': (150, 150, 40),
            'forest': (140, 90, 30), 'pine': (60, 100, 40)},
        water=None),
}
KEYS = tuple(THEMES)
ARABIA_POOL = ('grass', 'desert', 'steppe', 'snow', 'tropical', 'autumn')
DEFAULT = 'grass'


def of(w):
    return THEMES.get(getattr(w, 'theme', None) or DEFAULT, THEMES[DEFAULT])


def key_of(w):
    k = getattr(w, 'theme', None) or DEFAULT
    return k if k in THEMES else DEFAULT


def _hash(x, y, s=0):
    h = (x * 73856093) ^ (y * 19349663) ^ (s * 83492791)
    return (h ^ (h >> 13)) & 0x7fffffff


def pick_species(weights, tx, ty):
    """The species on a cell: 7x7 patches of one species with an admixture (like game.terrain.tree_species)."""
    if not weights:
        return None
    rx, ry = tx // 7, ty // 7
    if _hash(tx, ty, 5) % 4 == 0:
        rx, ry = (tx + 3) // 7, (ty + 3) // 7
    tot = sum(v for _, v in weights)
    r = _hash(rx, ry, 1) % tot
    sp = weights[-1][0]
    for n, v in weights:
        if r < v:
            sp = n
            break
        r -= v
    if _hash(tx, ty, 9) % 5 == 0:
        sp = weights[_hash(tx, ty, 11) % len(weights)][0]
    return sp


def tree_species(w, tx, ty, available=None):
    """The tree species of a cell in the match's landscape. available - species that have sprites (None - all)."""
    sp = of(w)['species']
    if available is not None:
        sp = [(n, v) for n, v in sp if n in available]
    return pick_species(tuple(sp), tx, ty)


def is_conifer(w, sp):
    return sp in of(w)['conifer']


def mm_color(w, ground):
    """The minimap color of a cell for the ground type ground (a name) in the match's landscape."""
    return of(w)['mm'].get(ground) or MM_BASE.get(ground, (0, 169, 0))


def forest_mm(w):
    return mm_color(w, 'forest')
