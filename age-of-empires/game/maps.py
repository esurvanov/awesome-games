"""The match's maps - the list and properties (no pygame and no world import: the module is read by terrain, naval, the lobby).

Maps by the rules of AoE II DE random maps (numbers from the DE map scripts, docs/research/07_maps.md; own names):
  arabia        "Wasteland"      - open land, hills, a landscape 1 of several (themes.ARABIA_POOL)
  arena         "Walled Court"   - everyone has a stone wall with a gate, forest outside, an open center
  black_forest  "Thicket"        - the whole map is forest, player clearings, lanes between them, roads to allies
  nomad         "Nomad"          - no town center: 3 scattered villagers, water along the map edges
  islands       "Archipelago"    - everyone has an island, neutral islets with gold and stone
  mediterranean "Inland Sea"     - a sea in the center, a ring of land
The old types 'land' (a continent with lakes) and 'coast' remain for tests and old saves.

Generation - game/mapgen.py (new maps) and World.gen_map (old types).
"""

MAPS = {
    # key: there is water (navy, naval AI), the start has no center; the name and description for the lobby come from the locale (map.<key>.*)
    'arabia': dict(water=False),
    'arena': dict(water=False),
    'black_forest': dict(water=False),
    'nomad': dict(water=True, nomad=True),
    'islands': dict(water=True),
    'mediterranean': dict(water=True),
    # the former types
    'land': dict(water=False, legacy=True),
    'coast': dict(water=True, legacy=True),
}
LEGACY_SIZES = {2: 96, 3: 110, 4: 120, 5: 136, 6: 136, 7: 152, 8: 152}    # 'land' / 'coast' without a lobby (tests)
LOBBY = ('arabia', 'arena', 'black_forest', 'nomad', 'islands', 'mediterranean')
ALL = tuple(MAPS)
DEFAULT = 'arabia'
NAMES = {k: k for k in MAPS}        # filled in by i18n.relabel()


def is_water(mt):
    """Whether the map has a sea (the naval part of the AI, docks, fish)."""
    return MAPS.get(mt, MAPS['land'])['water']


def is_legacy(mt):
    return MAPS.get(mt, {}).get('legacy', False) or mt not in MAPS


def is_nomad(mt):
    return MAPS.get(mt, {}).get('nomad', False)


def name(mt):
    return NAMES.get(mt, mt)


from . import i18n as _i18n     # noqa: E402  - map names in the player's language (and on language change)
_i18n.relabel()
