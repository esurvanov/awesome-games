#!/usr/bin/env python3
"""Units from animated 0 A.D. models -> sprite sheets assets/gen/units/ (+ units/index.json).

The raw assets are needed (tools/fetch_0ad.py -> assets/0ad_raw/). Skinning and animations - tools/render3d/skin.py,
actors with animations - tools/render3d/animactor.py, rendering - tools/render3d/renderer.py.

  .venv/bin/python tools/build_units.py                         # everything (in parallel, several processes)
  .venv/bin/python tools/build_units.py --only vil_m.britons,sheep --jobs 1
  .venv/bin/python tools/build_units.py --list                  # the set of models and the mapping to unit kinds
  .venv/bin/python tools/build_units.py --sheets shots/units    # contact sheets (tools/unit_sheet.py)

The result (paths relative to assets/gen/):
  units/index.json          - the index: sets (animations, frame counts, duration, step, height),
                              the mapping (unit kind, civilization group) -> set
  units/<set>.png           - a frame sheet RGBA: [animation][direction 0..15][frame]
  units/<set>.m.png         - the player color mask (L8), the same layout
  units/<set>.json          - frame rectangles [x, y, w, h, ax, ay] (ax, ay - the "feet" point in the frame)
Models for portraits/icons (the same adjustments, clothing, extra parts as in the sheets):
  unit_spec(kind, group)                          -> (set name, description)
  posed_parts(kind, group, anim, frac, female)    -> dict(parts, scale, place(d), name, spec)
  render_pose(kind, group, anim, frac, d)         -> a frame Sprite as in the sheet (with R8)
Direction d: the look along the angle d*22.5 deg in world coordinates (0 - +X, 4 - +Y); the count - 'dirs' in the set's entry.
Derived 0 A.D. materials (c) Wildfire Games, CC BY-SA 3.0 (see CREDITS.md).
"""
import argparse
import json
import os
import sys
import time

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(REPO, 'assets', 'gen', 'units')
TILE_PX = 32                    # game.data.TILE: world pixels per cell

# ---------------------------------------------------------------- scale (cells per 0 A.D. unit)
# AoE II DE proportions (docs/research/04_graphics.md, quanta 7, 8, 12): a villager ~ 0.33 of a cell's width tall
# (21 px at a 64 px cell), a knight ~ 0.58 (~ 37 px); it used to be 0.73 and 0.94 - figures 2.2 and 1.6 times larger.
S_INF = 0.122                   # infantry: a 0 A.D. man ~ 4.2 units -> ~ 21 px tall
S_CAV = 0.12                    # cavalry: a knight ~ 1.5 of an infantryman's height (DE: 45-50 px against 31, quantum 12)
S_ANIMAL = 0.12                 # animals: in the same proportions to people as before
S_SIEGE = 0.8                   # siege machines: a length multiplier (a DE ram ~ 1.2 cells)
NDIR = 16                       # look directions, as in DE (quantum 25)
RENDER_VER = 3                  # lighting/scale version: a change rebuilds everything on --resume
FWD = 90.0                      # the 0 A.D. model looks along -Y: rotate so that d=0 looks along +X
MIRROR = True                   # COLLADA is right-handed, the screen is left-handed: without mirroring the shield is in the right hand

# ---------------------------------------------------------------- animations
# (our name, the 0 A.D. animation name, variant choices, frames, 'loop' | 'once' | 'static')
# R9: a living idle (breathing, shifting from foot to foot) - 10 frames per cycle, like DE (for machines and ships - 1 frame)
A_IDLE = ('idle', 'idle', (), 10, 'loop')
# frames per cycle (quanta 26-28): DE - walk 30, attack 30-60, death 30; ours 16-20 - closer to DE with
# a reasonable size (256-color sheets, assets/gen in total <~ 300 MB)
A_WALK = ('walk', 'walk', (), 20, 'loop')
A_DEATH = ('death', 'death', (), 16, 'once')
MELEE = [A_IDLE, A_WALK, ('attack', 'attack_melee', (), 20, 'loop'), A_DEATH]
RANGED = [A_IDLE, A_WALK, ('attack', 'attack_ranged', (), 20, 'loop'), A_DEATH]
MONK = [A_IDLE, A_WALK, ('attack', 'heal', (), 16, 'loop'), A_DEATH]
VIL = [A_IDLE, A_WALK,
       ('carry_wood', 'walk', ('carry_wood',), 16, 'loop'),
       ('carry_stone', 'walk', ('carry_stone',), 16, 'loop'),
       ('carry_gold', 'walk', ('carry_metal',), 16, 'loop'),
       ('carry_food', 'walk', ('carry_food',), 16, 'loop'),
       ('chop', 'gather_tree', (), 16, 'loop'),
       ('mine', 'gather_ore', (), 16, 'loop'),
       ('farm', 'gather_grain', (), 16, 'loop'),
       ('forage', 'gather_fruit', (), 16, 'loop'),
       ('butcher', 'gather_meat', (), 16, 'loop'),
       ('build', 'build', (), 16, 'loop'),
       ('attack', 'attack_slaughter', (), 16, 'loop'),
       A_DEATH]
SIEGE = [('idle', 'idle', (), 1, 'loop'), ('walk', 'walk', (), 12, 'loop'), ('attack', 'attack_ranged', (), 20, 'loop')]
RAM = [('idle', 'idle', (), 1, 'loop'), ('walk', 'walk', (), 12, 'loop'), ('attack', 'attack_melee', (), 16, 'loop')]
CART = [('idle', 'idle', (), 1, 'loop'), ('walk', 'walk', (), 16, 'loop')]
SHIP = [('idle', 'idle', (), 1, 'loop'), ('walk', 'walk', (), 12, 'loop')]
A_RUN = ('run', 'run', (), 16, 'loop')
ANIMAL = {
    'sheep': [A_IDLE, A_WALK, A_RUN, A_DEATH],
    'deer': [A_IDLE, A_WALK, A_RUN, A_DEATH],
    'boar': [A_IDLE, A_WALK, A_RUN, ('attack', 'attack_melee', (), 16, 'loop'), A_DEATH],
    'wolf': [A_IDLE, A_WALK, A_RUN, ('attack', 'attack_melee', (), 16, 'loop'), A_DEATH],
}

# ---------------------------------------------------------------- civilization groups
# building group (game.sprites3d.civ_group) -> unit group -> 0 A.D. units/<...> folders in search order
# Medieval units - from the Millennium A.D. mod (folders units/caro, anglo, norse, rus, byzantines, umayyads),
# missing roles - from 0 A.D. (the last folder of the chain: male civilians, a crossbowman).
BUILD_TO_UNIT = {'caro': 'caro', 'teut': 'caro', 'anglo': 'anglo', 'celt': 'anglo', 'norse': 'norse', 'rus': 'rus',
                 'byz': 'byz', 'hisp': 'caro', 'umay': 'umay', 'han': 'han'}
UGROUPS = {
    'caro': ['caro', 'anglo', 'byzantines', 'britons'],
    'anglo': ['anglo', 'caro', 'norse', 'britons'],
    'norse': ['norse', 'anglo', 'caro', 'germans'],
    'rus': ['rus', 'norse', 'byzantines', 'germans'],
    'byz': ['byzantines', 'caro', 'romans'],
    'umay': ['umayyads', 'byzantines', 'achaemenids'],
    'han': ['han'],
}
# role -> (actor names in a folder in order, a fallback actor outside the chain, animations, scale)
ROLES = {
    'vil_m': (['citizen_male'], 'units/britons/citizen_male.xml', VIL, S_INF),
    'vil_f': (['female_citizen', 'citizen_female'], 'units/caro/female_citizen.xml', VIL, S_INF),
    'sword_b': (['infantry_swordsman_b', 'infantry_swordsman_a'], None, MELEE, S_INF),
    'sword_e': (['infantry_swordsman_e', 'infantry_swordsman_c', 'infantry_swordsman_a'], None, MELEE, S_INF),
    'spear_b': (['infantry_spearman_b'], None, MELEE, S_INF),
    'spear_e': (['infantry_spearman_e', 'infantry_spearman_c', 'infantry_spearman_a', 'infantry_spearman_b'], None,
                MELEE, S_INF),
    'skirm_b': (['infantry_javelinist_b'], 'units/byzantines/infantry_javelinist_b.xml', RANGED, S_INF),
    'skirm_e': (['infantry_javelinist_e', 'infantry_javelinist_a'], 'units/byzantines/infantry_javelinist_e.xml',
                RANGED, S_INF),
    'archer_b': (['infantry_archer_b'], 'units/caro/infantry_archer_b.xml', RANGED, S_INF),
    'archer_e': (['infantry_archer_e', 'infantry_archer_a', 'infantry_archer_b'], 'units/caro/infantry_archer_e.xml',
                 RANGED, S_INF),
    'xbow': (['infantry_crossbowman_b', 'infantry_archer_b'], 'units/caro/infantry_archer_b.xml', RANGED, S_INF),
    'scout': (['cavalry_scout', 'cavalry_javelinist_b_m', 'cavalry_spearman_b_m', 'cavalry_spearman_b'], None, MELEE,
              S_CAV),
    'cav_a': (['cavalry_scout_a', 'cavalry_javelinist_a_m', 'cavalry_spearman_a_m', 'cavalry_spearman_a',
               'cavalry_spearman_b_m', 'cavalry_spearman_b'], None, MELEE, S_CAV),
    'knight': (['cavalry_spearman_c_m', 'cavalry_spearman_e', 'cavalry_spearman_a_m', 'cavalry_spearman_a'], None,
               MELEE, S_CAV),
    'knight_e': (['cavalry_spearman_e_m', 'cavalry_spearman_e', 'cavalry_swordsman_c_m', 'cavalry_spearman_c_m'], None,
                 MELEE, S_CAV),
    'cav_archer': (['cavalry_archer_b_m', 'camelry_archer_b_m'], 'units/caro/cavalry_archer_b_m.xml', RANGED, S_CAV),
    'cav_archer_e': (['cavalry_archer_e_m', 'cavalry_archer_a_m', 'camelry_archer_e_m', 'cavalry_archer_b_m',
                      'camelry_archer_b_m'], 'units/caro/cavalry_archer_e_m.xml', RANGED, S_CAV),
    'monk': (['healer', 'priest', 'healer_b'], 'units/caro/healer.xml', MONK, S_INF),
}
# groups where a role has its own actor outside the folder chain
ROLE_GROUP = {
    ('scout', 'han'): 'units/han/cavalry_spearman_b_m.xml',
    ('cav_a', 'han'): 'units/han/cavalry_spearman_b_m.xml',
    ('monk', 'anglo'): 'units/caro/healer.xml',
    ('monk', 'norse'): 'units/caro/healer.xml',
}
# male civilians: there are none in Millennium A.D. - neutral 0 A.D. peasants with "medieval" headgear
# (a straw hat, a hood, a fur cap, a turban) by group
_HV = 'props/units/helmets/'
VIL_M = {
    'caro': ('units/britons/citizen_male.xml', {'helmet': _HV + 'hele_straw_01.xml'}),
    'anglo': ('units/britons/citizen_male.xml', {'helmet': _HV + 'xion_cloth.xml'}),
    'norse': ('units/germans/citizen_male.xml', {}),
    'rus': ('units/germans/citizen_male.xml', {'helmet': _HV + 'rus_cap_fur.xml',
                                               '#baseTex': 'skeletal/rus/rus_tunic_1_c.png'}),
    'byz': ('units/romans/citizen_male.xml', {}),
    'umay': ('units/achaemenids/citizen_male.xml', {'helmet': _HV + 'achae_kidaris_tied.xml',
                                                    'helmet>#baseTex': '@tex/white'}),
    'han': ('units/han/citizen_male.xml', {}),
}
TRADER = {'umay': 'trader.umay', 'han': 'trader.han'}          # the rest - trader.byz (a cart)

# ---------------------------------------------------------------- ranks (AoE2): the higher the rank, the heavier the kind
# Helmets by the actor folder's culture: 'H:<type>' in an override is replaced by the helmet actor.
_H = 'props/units/helmets/'
HELM = {
    '*': {'cap': _H + 'rus_cap_b.xml', 'nasal': _H + 'norse_helmet.xml', 'heavy': _H + 'caro_cavalry_helmet.xml',
          'great': _H + 'celt_helmet_port.xml', 'crest': _H + 'rome_gallic_type_h_cent.xml',
          'plume': _H + 'rome_apulo_itallic_e1.xml'},
    'umayyads': {'cap': _H + 'achae_kidaris_tied.xml', 'nasal': _H + 'byza_helmet_basic.xml',
                 'heavy': _H + 'byza_helmet.xml', 'great': _H + 'byza_helmet_basic_iron.xml'},
    'byzantines': {'nasal': _H + 'byza_helmet_basic_iron.xml', 'heavy': _H + 'byza_helmet.xml'},
    'han': {'cap': _H + 'han_cap.xml', 'nasal': _H + 'han_advanced_melee_helmet.xml',
            'heavy': _H + 'han_heavy_helmet_b.xml', 'great': _H + 'han_heavy_cavalry_helmet.xml'},
    'rus': {'nasal': _H + 'rus_helmet.xml', 'heavy': _H + 'rus_helmet_c.xml'},
    'norse': {'heavy': _H + 'norse_huscarl_iron.xml'},
}
PLATE = 'skeletal/imp/lorica_segmentata_01_01.png'          # "plate": shiny steel strips
BIGSWORD = ('props/units/weapons/norse_sword.xml', (1.8, 1.8, 1.8))
# "signature" helmets (procmesh): larger than natural so they read at 21 px
KETTLE, KABUTO, GREATHELM, MORION = ('@kettle', 1.35), ('@kabuto', 1.5), ('@greathelm', 1.25), ('@morion', 1.35)
SW = 'biped/infantry/swordsman/'
TWO_H = {'#anim:idle': SW + 'idle_relax_2h.dae', '#anim:walk': 'biped/infantry/spearman/walk_relax.dae',
         '#anim:attack_melee': SW + 'attack_melee_2h_01.dae', 'shield': None, 'shield_arm': None,
         'weapon_R': '@greatsword', 'sheath_L': None}
# ranged units walk (not "jog" stretched to our speed): feet do not slide, the pace is natural
W_RANGED = 'biped/infantry/spearman/walk_relax.dae'
XB = 'biped/infantry/crossbowman/'
NU = 'props/units/weapons/crossbow/han_nu.xml'
XBOW = {'weapon_R': (NU, 2.2), 'weapon_bow': None, '#anim:idle': XB + 'idle_ready_01.dae',
        '#anim:attack_ranged': (XB + 'attack_ranged.dae', 0.8), '#anim:walk': W_RANGED}
PIKE = ('props/units/weapons/spear_long.xml', (2.2, 2.2, 1.5))
SPEAR = ('props/units/weapons/spear_long.xml', (2.2, 2.2, 1.1))
HORSE_ARMOR = 'props/horse/cav_armor_caro.xml'
# a caparison in player color (replaces the former capes/horse armor) + a mask on the muzzle
CAPARISON = {'root': 'props/horse/cav_armor_byzantine_cloth_player.xml', 'root+': 'props/horse/cav_rein_leather.xml',
             'head': 'props/horse/cav_mask_byzantine_cloth_player.xml'}
# R3: a kite shield (man-at-arms), a "heraldic" one (shorter - the long swordsman)
def kite(pattern='bands', k=1.15, pt='shield_arm'):
    """A kite shield with a player-color crest (procmesh '@shield/kite_*') at the point pt."""
    return {pt: ('props/units/shields/byza_kite.xml', k), pt + '>#baseTex': '@shield/kite_' + pattern,
            ('shield' if pt == 'shield_arm' else 'shield_arm'): None}


HEATER_K = (1.15, 1.15, 0.85)
# R5: the shaft in two hands, no shield (the 0 A.D. pikeman animations)
PK = 'biped/infantry/pikeman/'
POLE = {'#anim:idle': PK + 'idle_relax_01.dae', '#anim:walk': PK + 'walk_relax.dae',
        '#anim:attack_melee': PK + 'attack_melee_01.dae', 'shield': None, 'shield_arm': None}
NOSHIELD = {'shield': None, 'shield_arm': None}
SH = 'props/shields/'

# R6: a rider with a sword/sabre (0 A.D. "generic" animations: sword at the ready, an overhead strike; with a shield - *_shield_*)
RCG = 'biped/rider/cavalry/generic/'
SWORD = ('props/units/weapons/caro_infantry_sword.xml', 1.75)
SABRE = ('props/units/weapons/byza_paramerion.xml', 1.8)
CAPE_R = 'props/units/capes/rider/cape_med_player.xml'


def cav_sword(weapon, shield=None, helmet=None, paint=None):
    sh = '_shield' if shield else ''
    ov = {'rider>weapon_R': weapon, 'rider>shield': None, 'rider>shield_arm': None, 'rider>weapon_L': None,
          'rider>#anim:idle': RCG + f'idle{sh}_ready_01.dae',
          'rider>#anim:walk': RCG + f'trot{sh}_ready.dae',
          'rider>#anim:attack_melee': RCG + f'attack_melee{sh}_01.dae'}
    if shield:
        ov.update({'rider>shield_arm': ('props/units/shields/byza_kite.xml', 1.1),
                   'rider>shield_arm>#baseTex': '@shield/kite_' + shield})
    if helmet:
        ov['rider>helmet'] = helmet
    if paint:
        ov['#paint'] = paint
    return ov


# riders' bows are larger (otherwise a cavalry archer differs from a rider only by color)
RIDER_K = {'units/': 1.12}
BOWS = {'props/units/weapons/bow': 1.7, 'props/units/weapons/xion_bow': 1.7, 'props/units/weapons/norse_bow': 1.7}

# R1: the clothing style (tools/render3d/paint.py) by role; for kinds - the '#paint' key in the overrides
PAINT = {
    'vil_f': 'dress', 'vil_m': 'apron', 'monk': 'stole',
}
# R14: villagers' tools are larger (an axe, pick, hoe, hammer, knife, basket) - they read at 21 px
TOOLS = {'props/units/tools/basket': 1.35, 'props/units/tools/': 2.3, 'props/units/weapons/dagger': 2.6,
}

# kind -> (the role chain of actors, overrides)
RANKS = {
    # DE militia: a leather vest, a club/mace in a lowered hand, no shield
    'militia': ('sword_b', dict(NOSHIELD, helmet='H:cap', root=None, sheath_L=None, weapon_R=(
        'props/units/weapons/caro_mace.xml', 2.3), **{'#paint': 'vest'})),
    'man_at_arms': ('sword_b', dict(kite('bands'), helmet='H:nasal', **{'#paint': 'tabard'})),
    'long_swordsman': ('sword_e', dict(kite('chevron', HEATER_K), helmet='H:heavy', weapon_R=BIGSWORD,
                                       **{'#paint': 'surcoat'})),
    'two_handed_swordsman': ('sword_e', dict(TWO_H, helmet='H:great', **{'#paint': 'quarter'})),
    'champion': ('sword_e', dict(TWO_H, helmet='H:crest', **{'#baseTex': PLATE, '#paint': 'surcoat',
                                                              'root+': 'props/units/capes/cape_long_player.xml'})),
    'spearman': ('spear_b', dict(POLE, helmet=KETTLE, weapon_R=SPEAR, **{'#paint': 'gambeson'})),
    'pikeman': ('spear_e', dict(POLE, weapon_R=PIKE, helmet='H:nasal', **{'#paint': 'white'})),
    'halberdier': ('spear_e', dict(POLE, weapon_R=('@halberd', (2.0, 2.0, 1.35)), helmet='H:heavy',
                                   **{'#baseTex': PLATE, '#paint': 'surcoat'})),
    'archer': ('archer_b', {'#anim:walk': W_RANGED, '#paint': 'tabard',
                            'weapon_bow': ('props/units/weapons/norse_bow.xml', 1.4)}),
    'crossbowman': ('xbow', dict(XBOW, helmet=KETTLE, **{'#paint': 'quarter'})),
    'arbalester': ('archer_e', dict(XBOW, helmet='H:heavy', weapon_R=(NU, 2.7), **{'#paint': 'surcoat'})),
    'skirmisher': ('skirm_b', {'#anim:walk': W_RANGED, 'helmet': KETTLE, '#paint': 'tabard',
                               'shield_arm': 'props/units/shields/caro_leather.xml',
                               'shield_arm>#baseTex': SH + 'caro/lenticular/caro_leather_a.png'}),
    'elite_skirmisher': ('skirm_e', {'#anim:walk': W_RANGED, 'helmet': 'H:nasal', '#paint': 'quarter',
                                     'shield_arm': ('props/units/shields/caro_leather.xml', 0.85),
                                     'shield_arm>#baseTex': SH + 'caro/lenticular/lenticular_petal_player_white.png'}),
    # R6: the scout line and knights - a rider with a sword (DE), no lance; R7 - the horse's armor/caparison; R3 - a kite shield
    'scout': ('scout', dict(cav_sword(SWORD, helmet='H:cap', paint='tabard'), **{'#sel': ('tan', 'beige')})),
    'light_cavalry': ('cav_a', dict(cav_sword(SABRE, helmet='H:nasal', paint='surcoat'),
                                    **{'rider>root+': CAPE_R, '#sel': ('black', 'maneless_black')})),
    'hussar': ('cav_a', dict(cav_sword(SABRE, helmet=('H:plume', 1.4), paint='quarter'),
                             **{'root+': 'props/horse/cav_blanket_iber_c.xml', '#sel': ('white', 'gray')})),
    'knight': ('knight', dict(cav_sword(SWORD, shield='diag', helmet='H:heavy', paint='quarter'),
                              **{'root+': HORSE_ARMOR, '#sel': ('brown', 'maneless_brown')})),
    'cavalier': ('knight_e', dict(cav_sword(SWORD, shield='bands', helmet='H:heavy', paint='surcoat'),
                                  **{'root': 'props/horse/cav_armor_byzantine_cloth_white.xml',
                                     'root+': 'props/horse/cav_rein_leather.xml', '#sel': ('gray', 'maneless_gray')})),
    'paladin': ('knight_e', dict(CAPARISON, **cav_sword(SWORD, shield='chevron', helmet=('H:crest', 1.15),
                                                         paint='white'))),
    'cavalry_archer': ('cav_archer', {'#paint': 'surcoat', 'rider>root+': CAPE_R, '#pscale': BOWS}),
    'heavy_cavalry_archer': ('cav_archer_e', {'rider>helmet': 'H:heavy', '#paint': 'quarter',
                                              'root+': HORSE_ARMOR, '#sel': ('gray', 'maneless_gray'),
                                              '#pscale': BOWS}),
}


# camel: a walk instead of a trot (a trot stretched to our speed looked slowed down), the rider sits calmly
CAMEL_WALK = {'#anim:walk': 'quadraped/camel_walk.dae',
              'rider>#anim:walk': 'biped/rider/camelry/archer/idle_relax_01.dae'}


def resolve_override(ov, actor):
    """'H:<type>' -> the helmet of the actor folder's culture."""
    if 'camelry' in actor:
        ov = dict(CAMEL_WALK, **(ov or {}))
    if not ov:
        return ov
    folder = actor.split('/')[1] if actor.count('/') >= 2 else '*'
    hm = dict(HELM['*'], **HELM.get(folder, {}))
    out = {}
    for k, v in ov.items():
        if isinstance(v, str) and v.startswith('H:'):
            v = hm[v[2:]]
        elif isinstance(v, tuple) and isinstance(v[0], str) and v[0].startswith('H:'):
            v = (hm[v[0][2:]], v[1])
        out[k] = v
    return out


# ---------------------------------------------------------------- firearms (procedural props, tools/render3d/procmesh.py)
GUN = {'weapon_R': '@musket', 'weapon_bow': None, 'back': None, 'sheath_L': '@powderhorn',
       '#anim:idle': XB + 'idle_ready_01.dae', '#anim:attack_ranged': (XB + 'attack_ranged.dae', 0.8),
       '#anim:walk': W_RANGED}
JAN_HAT = {'helmet': (_H + 'achae_kidaris_tied.xml', (1.0, 1.0, 1.2)), 'helmet>#baseTex': '@tex/white', 'root': None}
RC = 'biped/rider/cavalry/'
CAV_GUN = {'rider>weapon_R': '@musket', 'rider>weapon_bow': None, 'rider>back': None,
           'rider>sheath_L': '@powderhorn', 'rider>helmet': _H + 'caro_cavalry_helmet.xml',
           'rider>#baseTex': 'skeletal/caro/elite/chainmail_scale1a.png',
           'rider>#anim:attack_ranged': (RC + 'crossbowman/attack_ranged_back.dae', 0.8),
           'rider>#anim:idle': RC + 'crossbowman/idle_relax_01.dae'}
# the difference of elite unique units: a crest/plume in player color (over their own helmet)
PLUME = (_H + 'rome_apulo_itallic_e1.xml', 1.3)
ELITE_INF = {'helmet+': '@plume_player'}
ELITE_CAV = {'rider>helmet+': '@plume_player'}
# camel riders with a sabre: the "generic" rider animations
CAMEL_SWORD = {'rider>weapon_R': ('props/units/weapons/byza_paramerion.xml', 1.5), 'rider>shield': None,
               'rider>#anim:attack_melee': 'biped/rider/cavalry/generic/attack_melee_shield_01.dae',
               # a white turban (DE: for camel riders and mamelukes)
               'rider>helmet': (_H + 'achae_kidaris_tied.xml', (1.2, 1.2, 1.1)), 'rider>helmet>#baseTex': '@tex/white'}

# siege: R12 - beams/wrappings in player color (shares of the model's footprint, see extra_parts)
RAILS = [('box', '@tex/player', (0.14, 0.12, 0.03, 0.22, 0.88, 0.11)),
         ('box', '@tex/player', (0.78, 0.12, 0.03, 0.86, 0.88, 0.11))]
ROPES = [('cyl_y', '@tex/player', (0.12, 0.42, 0.25, 0.3, 0.58, 0.45)),
         ('cyl_y', '@tex/player', (0.7, 0.42, 0.25, 0.88, 0.58, 0.45))]
NOCREW = {'operator_L': None, 'operator_R': None}

# sets outside groups: name -> dict(actor, anims, scale | length, ...)
GLOBAL = {
    'trader.byz': dict(actor='units/byzantines/trader.xml', anims=CART, scale=S_CAV, paint='tabard'),
    'trader.han': dict(actor='units/han/trader.xml', anims=CART, scale=S_CAV, paint='tabard'),
    'trader.umay': dict(actor='units/umayyads/trader.xml', anims=CART, scale=S_CAV, paint='tabard'),
    # hand cannoneer: barrel x1.5, a kettle hat, striped trousers (DE)
    'gun': dict(actor='units/caro/infantry_archer_b.xml', anims=RANGED, scale=S_INF, seed=1, paint='bands',
                override=dict(GUN, weapon_R=('@handcannon', 2.0), helmet=KETTLE)),
    # janissary: a white robe with a sash in player color, a tall white cap, a larger musket
    'janissary': dict(actor='units/umayyads/infantry_archer_b.xml', anims=RANGED, scale=S_INF, seed=9, paint='robe',
                      override=dict(GUN, weapon_R=('@musket', 1.7), **JAN_HAT)),
    'janissary_e': dict(actor='units/umayyads/infantry_archer_e.xml', anims=RANGED, scale=S_INF * 1.03, seed=9,
                        paint='robe', override=dict(GUN, weapon_R=('@musket_dark', 1.7), **JAN_HAT),
                        sel=('scale1a',)),
    # conquistador: a morion, an arquebus, no shield
    'conquistador': dict(actor='units/caro/cavalry_archer_b_m.xml', anims=RANGED, scale=S_CAV, paint='quarter',
                         override=dict(CAV_GUN, **{'rider>weapon_R': ('@musket', 1.7), 'rider>helmet': MORION})),
    'conquistador_e': dict(actor='units/caro/cavalry_archer_b_m.xml', anims=RANGED, scale=S_CAV * 1.03,
                           paint='quarter',
                           override=dict(CAV_GUN, **{'root+': HORSE_ARMOR, 'rider>helmet': MORION,
                                                     'rider>helmet+': '@plume_player',
                                                     'rider>weapon_R': ('@musket', 1.7)})),
    # camel rider: a sabre + a round blue-and-white shield, a turban
    'camel': dict(actor='units/umayyads/camelry_archer_b_m.xml', anims=MELEE, scale=S_CAV, paint='tabard',
                  override=dict(CAMEL_WALK, **CAMEL_SWORD, rider='units/umayyads/cavalry_spearman_b_r.xml',
                                **{'rider>shield_arm': ('props/units/shields/umay_round_b.xml', 1.1),
                                   'rider>shield_arm>#baseTex': SH + 'caro/lenticular/lenticular_chiro_player_white.png'})),
    'camel_h': dict(actor='units/umayyads/camelry_archer_e_m.xml', anims=MELEE, scale=S_CAV * 1.03, paint='surcoat',
                    override=dict(CAMEL_WALK, **CAMEL_SWORD, rider='units/umayyads/cavalry_spearman_e_r.xml',
                                  **{'rider>shield_arm': ('props/units/shields/umay_round_e.xml', 1.15),
                                     'rider>shield_arm>#baseTex': SH + 'caro/lenticular/lenticular_petal_player_white.png'})),
    # mameluke: a white robe and turban, a big sabre, no shield; a light camel
    'mameluke': dict(actor='units/umayyads/camelry_archer_a_m.xml', anims=MELEE, scale=S_CAV * 1.03, paint='robe',
                     override={**CAMEL_WALK, **CAMEL_SWORD, 'rider': 'units/umayyads/cavalry_spearman_a_r.xml',
                               'rider>weapon_R': ('props/units/weapons/byza_paramerion.xml', 1.8),
                               'rider>helmet': (_H + 'achae_kidaris_tied.xml', (1.2, 1.2, 1.3)),
                               'rider>helmet>#baseTex': '@tex/white', 'rider>root': None}),
    # war elephant: a howdah tower with a warrior, a caparison
    'elephant': dict(actor='fauna/elephant_asian.xml', anims=MELEE, scale=0.118, paint='tabard',
                     override={'rider1': 'units/achaemenids/cavalry_archer_b_r.xml',
                               'turret': 'props/units/elephant/howdah_cart_01.xml',
                               'turret+': 'units/achaemenids/cavalry_archer_b_r.xml'}),
    # throwing axeman (Frank): a large axe, striped trousers, a helmet
    'axe_thrower': dict(actor='units/caro/infantry_javelinist_b.xml', anims=RANGED, scale=S_INF, paint='bands',
                        override={'weapon_R': ('props/units/weapons/norse_axe.xml', 2.4), '#anim:walk': W_RANGED,
                                  'ammo': None, 'helmet': 'H:nasal'}),
    # berserk: a bare torso, a sword and a round shield
    'berserk': dict(actor='units/norse/champion_berserker.xml', anims=MELEE, scale=S_INF, paint='bare',
                    override={'weapon_R': ('props/units/weapons/norse_sword.xml', 1.4), '#anim:idle': SW + 'idle_ready_shield_01.dae',
                              '#anim:walk': SW + 'walk_relax_shield.dae',
                              '#anim:attack_melee': SW + 'attack_melee_shield_01.dae',
                              'shield_arm>#baseTex': SH + 'caro/lenticular/lenticular_chiro_player_white.png',
                              'root': None, 'root+': 'props/units/capes/cape_med_pelt.xml'}),
    # huskarl: a huge round blue-and-white shield, a sword, a nasal helmet
    'huskarl': dict(actor='units/norse/champion_huscarl.xml', anims=MELEE, scale=S_INF, seed=2, paint='tabard',
                    override={'weapon_R': ('props/units/weapons/norse_sword.xml', 1.3), 'back': None,
                              'shield_arm': ('props/units/shields/norse_player_colour.xml', 1.45),
                              'shield_arm>#baseTex': SH + 'iron_swirl_white.png',
                              '#anim:idle': SW + 'idle_relax_shield_01.dae', '#anim:walk': SW + 'walk_relax_shield.dae',
                              '#anim:attack_melee': SW + 'attack_melee_shield_01.dae'}),
    # Teutonic knight: a bucket helm, a two-handed sword, a white cloak with a cross in player color
    'teuton': dict(actor='units/caro/champion_infantry.xml', anims=MELEE, scale=S_INF * 1.04, seed=3, paint='white',
                   override=dict(TWO_H, helmet=GREATHELM, root=None,
                                 **{'root+': ('props/units/capes/cape_long_player.xml', 1.0),
                                    'root+>#baseTex': '@tex/linen'})),
    # woad raider: a bare torso, long hair, a sword
    'woad': dict(actor='units/britons/infantry_swordsman_c.xml', anims=MELEE, scale=S_INF, seed=4, paint='bare',
                 override=dict(NOSHIELD, helmet=None, root=None, head='props/units/heads/new/head_celt_fanatic.xml',
                               weapon_R=('props/units/weapons/norse_sword.xml', 1.35), sheath_01_R=None,
                               **{'#anim:idle': SW + 'idle_ready_2h.dae', '#anim:walk': SW + 'walk_ready_2h.dae',
                                  '#anim:attack_melee': SW + 'attack_melee_2h_01.dae'})),
    # samurai: a kabuto with horns, a katana in both hands
    'samurai': dict(actor='units/han/infantry_swordsman_c.xml', anims=MELEE, scale=S_INF, seed=5, paint='surcoat',
                    override=dict(TWO_H, helmet=KABUTO, weapon_R=('@katana', 1.3), root=None)),
    # chu ko nu: a magazine crossbow box
    'chukonu': dict(actor='units/han/infantry_crossbowman_b.xml', anims=RANGED, scale=S_INF, seed=6, paint='tabard',
                    override={'#anim:walk': W_RANGED,
                              'weapon_R': ('props/units/weapons/crossbow/han_liannu.xml', 2.4)}),
    # longbowman: a bow taller than he is, a white tabard with a crest
    'longbow': dict(actor='units/caro/infantry_archer_e.xml', anims=RANGED, scale=S_INF * 1.03, seed=7, paint='white',
                    override={'#anim:walk': W_RANGED, 'weapon_bow': ('props/units/weapons/norse_bow.xml', 2.0),
                              'helmet': None}),
    # mangudai: a fur hat with a plume, a brown horse, leather armor
    'mangudai': dict(actor='units/han/cavalry_archer_b_m.xml', anims=RANGED, scale=S_CAV, seed=8, paint='vest',
                     prop_scale=BOWS,
                     override={'rider>helmet': _H + 'rus_cap_fur.xml', 'rider>helmet+': '@plume_player'}),
    # cataphract: a horse in lamellar armor, a rider in scale, a spear, no shield
    'cataphract': dict(actor='units/byzantines/cavalry_spearman_e_m.xml', anims=MELEE, scale=S_CAV, paint='tabard',
                       override={'root+': 'props/horse/cav_armor_umayyad_lamellar.xml', 'rider>shield_arm': None,
                                 'rider>shield': None}),
    # siege machines: the length fits into length cells
    # rams (R10, R12): blue base beams, a visible log / ram head in front
    'ram_log': dict(actor='structures/germans/siege_ram.xml', anims=RAM, length=1.5,
                    extras=RAILS + [('cyl_y', '@tex/wood', (0.4, -0.16, 0.2, 0.6, 0.35, 0.42))]),
    'ram_capped': dict(actor='structures/celts/siege_ram.xml', anims=RAM, length=1.55,
                       extras=RAILS + [('cyl_y', '@tex/wood', (0.42, 0.05, 0.22, 0.58, 0.35, 0.4)),
                                       ('ram_head', '@tex/steel', (0.36, -0.16, 0.18, 0.64, 0.08, 0.45))]),
    'ram_siege': dict(actor='units/byzantines/siege_ram.xml', anims=RAM, length=1.75,
                      extras=RAILS + [('ram_head', '@tex/steel', (0.36, -0.18, 0.12, 0.64, 0.08, 0.42)),
                                      ('box', '@tex/steel', (0.2, 0.25, 0.6, 0.8, 0.45, 0.75)),
                                      ('box', '@tex/steel', (0.2, 0.6, 0.45, 0.8, 0.75, 0.62))]),
    # mangonel line (DE - a torsion machine with a spoon): an onager frame, larger with rank (R11), wrappings in player color (R12)
    'mangonel': dict(actor='units/romans/siege_onager.xml', anims=SIEGE, length=1.95, extras=ROPES),
    'onager': dict(actor='units/romans/siege_onager.xml', anims=SIEGE, length=2.15, seed=1,
                   extras=ROPES + [('box', '@tex/steel', (0.0, 0.3, 0.0, 1.0, 0.36, 0.1))]),
    'onager_s': dict(actor='units/romans/siege_onager.xml', anims=SIEGE, length=2.45, seed=1,
                     extras=ROPES + [('box', '@tex/steel', (0.0, 0.3, 0.0, 1.0, 0.36, 0.12)),
                                     ('box', '@tex/steel', (0.0, 0.7, 0.0, 1.0, 0.76, 0.12)),
                                     ('box', '@tex/iron', (-0.03, 0.05, 0.0, 1.03, 0.95, 0.05))]),
    'onager_han': dict(actor='units/han/siege_mangonel.xml', anims=SIEGE, length=1.9),
    'onager_han_s': dict(actor='units/han/siege_mangonel.xml', anims=SIEGE, length=2.3),
    # scorpion without a crew (DE - one machine), the heavy one is larger, with steel
    'scorpio': dict(actor='units/romans/siege_scorpio.xml', anims=SIEGE, length=1.2,
                    override=NOCREW, extras=[('box', '@tex/player', (0.0, 0.45, 0.62, 1.0, 0.55, 0.72))]),
    'ballista': dict(actor='units/romans/siege_scorpio.xml', anims=SIEGE, length=1.5, seed=1,
                     override=NOCREW, extras=[('box', '@tex/player', (0.0, 0.45, 0.62, 1.0, 0.55, 0.72)),
                                              ('box', '@tex/steel', (0.05, 0.2, 0.55, 0.95, 0.3, 0.66)),
                                              ('box', '@tex/steel', (0.3, 0.0, 0.5, 0.7, 0.1, 0.62))]),
    'bombard': dict(actor='@bombard', anims=SIEGE, length=1.35),
    # trebuchet (R11): without horses when packed, larger x1.65 (DE ~ 3.3 of an infantryman's height)
    'treb_packed': dict(actor='units/caro/siege_trebuchet_packed.xml', anims=CART, length=3.0,
                        override={'horse_l': None, 'horse_r': None},
                        extras=[('box', '@tex/player', (0.1, 0.35, 0.55, 0.9, 0.42, 0.8))]),
    'treb_up': dict(actor='units/caro/siege_trebuchet.xml', anims=SIEGE, length=3.3,
                    extras=[('box', '@tex/player', (0.3, 0.4, 0.3, 0.7, 0.6, 0.34))]),
    # animals
    'sheep': dict(actor='fauna/sheep1.xml', anims=ANIMAL['sheep'], scale=S_ANIMAL),
    'deer': dict(actor='fauna/deer.xml', anims=ANIMAL['deer'], scale=S_ANIMAL),
    'boar': dict(actor='fauna/boar.xml', anims=ANIMAL['boar'], scale=S_ANIMAL),
    'wolf': dict(actor='fauna/wolf.xml', anims=ANIMAL['wolf'], scale=S_ANIMAL),
}
# elite unique units: the base set + a distinguishing part
for _n in ('axe_thrower', 'berserk', 'huskarl', 'teuton', 'woad', 'samurai', 'chukonu', 'longbow'):
    GLOBAL[_n + '_e'] = dict(GLOBAL[_n], override=dict(GLOBAL[_n].get('override') or {}, **ELITE_INF),
                             scale=GLOBAL[_n]['scale'] * 1.03)
for _n in ('mangudai', 'cataphract', 'mameluke'):
    GLOBAL[_n + '_e'] = dict(GLOBAL[_n], override=dict(GLOBAL[_n].get('override') or {}, **ELITE_CAV),
                             scale=GLOBAL[_n]['scale'] * 1.03)
GLOBAL['elephant_e'] = dict(GLOBAL['elephant'], scale=0.124,
                            override=dict(GLOBAL['elephant']['override'], **{'rider1>helmet': (PLUME[0], 1.8)}))
# ships: a set by the group's "naval style"
SHIP_STYLE = {'caro': 'north', 'anglo': 'north', 'norse': 'north', 'rus': 'north', 'byz': 'med', 'umay': 'med',
              'han': 'han'}
_NS, _BS = 'structures/norse/', 'structures/byzantines/'
SHIPS = {
    # kind: {style: (actor, length in cells[, a refinement from SHIP_X])}. R13: each class has its own silhouette, as in DE -
    # a fisher - a boat with a lateen sail, a transport - under a canopy, a galley -> a dromon -> a tall galleon, a fire ship with a siphon,
    # demolition ships - boats with barrels of gunpowder
    'fishing_ship': {'*': (_BS + 'fishing_boat.xml', 1.25, 'lateen'), 'han': ('structures/han/fishing_ship.xml', 1.25)},
    'transport_ship': {'*': (_NS + 'knarr.xml', 1.8, 'tent'), 'han': ('structures/han/merchant_ship.xml', 1.8)},
    'galley': {'*': (_BS + 'warship_light.xml', 1.9), 'han': ('structures/han/trireme.xml', 1.9)},
    'war_galley': {'*': (_BS + 'dromon_warship.xml', 2.15), 'han': ('structures/han/trireme.xml', 2.15)},
    'galleon': {'*': (_BS + 'merchant_ship.xml', 2.4, 'galleon'), 'han': ('structures/han/towership.xml', 2.4)},
    'fire_galley': {'*': ('structures/iberians/fireship.xml', 1.85, 'siphon'),
                    'han': ('structures/han/fireship.xml', 1.85)},
    'demolition_ship': {'*': ('structures/celts/rowboat.xml', 1.2, 'barrels')},
    'heavy_demolition_ship': {'*': ('structures/germans/ship_scout.xml', 1.55, 'barrels')},
    'cannon_galleon': {'*': ('structures/han/towership.xml', 2.3, 'guns')},
}
# ship refinements: tree edits and extra parts (shares of the footprint, see extra_parts)
SHIP_X = {
    'guns': dict(override={'root+': ('@ship_cannons', (28.8, 18.0, 32.4))}),
    'lateen': dict(override={'sail': None},
                   extras=[('cyl_z', '@tex/wood', (0.47, 0.42, 0.0, 0.53, 0.46, 3.3)),
                           ('sail_lat', '@tex/linen', (0.5, -0.05, 0.45, 0.5, 0.9, 3.3)),
                           ('box', '@tex/player', (0.47, 0.44, 3.0, 0.53, 0.62, 3.3))]),
    'tent': dict(override={'root': None},
                 extras=[('tent', '@tex/linen', (0.12, 0.22, 0.45, 0.88, 0.8, 1.35)),
                         ('box', '@tex/player', (0.1, 0.48, 0.44, 0.9, 0.54, 1.37))]),
    'galleon': dict(extras=[('box', '@tex/wood', (0.25, 0.8, 0.06, 0.75, 0.98, 0.19)),       # the stern superstructure
                            ('box', '@tex/wood', (0.3, 0.02, 0.06, 0.7, 0.14, 0.16)),         # bow
                            ('cyl_z', '@tex/wood', (0.485, 0.2, 0.1, 0.515, 0.22, 0.8)),     # the second mast
                            ('box', '@tex/linen', (0.14, 0.2, 0.36, 0.86, 0.225, 0.74)),
                            ('box', '@tex/player', (0.14, 0.198, 0.5, 0.86, 0.228, 0.58))]),
    'barrels': dict(extras=[('barrels', '@tex/wood', (0.25, 0.25, 0.3, 0.75, 0.75, 0.8)),
                            ('box', '@tex/player', (0.47, 0.46, 0.3, 0.53, 0.54, 1.6))]),
    'siphon': dict(extras=[('siphon', '@tex/bronze', (0.4, -0.12, 0.4, 0.6, 0.25, 0.7)),
                           ('box', '@tex/red', (0.42, 0.05, 0.3, 0.58, 0.25, 0.55))]),
}
SHIP_ALIAS = {'fire_ship': 'fire_galley', 'fast_fire_ship': 'fire_galley'}

# unit kind -> role (by group) or a global set; military lines - RANKS (a separate set for each rank)
KIND_ROLE = {'villager': 'vil_m', 'monk': 'monk', 'trade_cart': 'trader'}
KIND_GLOBAL = {
    'hand_cannoneer': 'gun', 'camel_rider': 'camel', 'heavy_camel_rider': 'camel_h',
    'ram': 'ram_log', 'capped_ram': 'ram_capped', 'siege_ram': 'ram_siege',
    'mangonel': 'mangonel', 'onager': 'onager', 'siege_onager': 'onager_s',
    'scorpion': 'scorpio', 'heavy_scorpion': 'ballista', 'bombard_cannon': 'bombard',
    'trebuchet': 'treb_packed', 'trebuchet_up': 'treb_up',
    'throwing_axeman': 'axe_thrower', 'elite_throwing_axeman': 'axe_thrower_e',
    'longbowman': 'longbow', 'elite_longbowman': 'longbow_e',
    'mangudai': 'mangudai', 'elite_mangudai': 'mangudai_e',
    'cataphract': 'cataphract', 'elite_cataphract': 'cataphract_e',
    'teutonic_knight': 'teuton', 'elite_teutonic_knight': 'teuton_e',
    'samurai': 'samurai', 'elite_samurai': 'samurai_e',
    'chu_ko_nu': 'chukonu', 'elite_chu_ko_nu': 'chukonu_e',
    'war_elephant': 'elephant', 'elite_war_elephant': 'elephant_e',
    'mameluke': 'mameluke', 'elite_mameluke': 'mameluke_e',
    'janissary': 'janissary', 'elite_janissary': 'janissary_e',
    'berserk': 'berserk', 'elite_berserk': 'berserk_e',
    'huskarl': 'huskarl', 'elite_huskarl': 'huskarl_e',
    'woad_raider': 'woad', 'elite_woad_raider': 'woad_e',
    'conquistador': 'conquistador', 'elite_conquistador': 'conquistador_e',
}
# some groups have their own model for a global kind (Han siege)
KIND_GROUP_GLOBAL = {('mangonel', 'han'): 'onager_han', ('onager', 'han'): 'onager_han',
                     ('siege_onager', 'han'): 'onager_han_s'}


def _actor_exists(a):
    from tools.render3d.actor import actor_exists
    return actor_exists(a)


def role_actor(role, group):
    a = ROLE_GROUP.get((role, group))
    if a:
        return a
    names, fb, _, _ = ROLES[role]
    for folder in UGROUPS[group]:           # its own folder matters more than the name order
        for n in names:
            p = f'units/{folder}/{n}.xml'
            if _actor_exists(p):
                return p
    return fb if fb and _actor_exists(fb) else None


def plan():
    """-> (sets: {name: spec}, mapping: {kind: {unit group: set name}})."""
    sets, mapping = {}, {}

    def add_role(role, group, kind=None, ov=None):
        if role == 'trader':
            name = TRADER.get(group, 'trader.byz')
            sets[name] = dict(GLOBAL[name])
            return name
        if role == 'vil_m' and group in VIL_M:
            a, ov = VIL_M[group]
            if not _actor_exists(a):
                a, ov = ROLES['vil_m'][1], {}
            name = f'vil_m.{group}'
            sets[name] = dict(actor=a, anims=VIL, scale=S_INF, override=ov or None, paint='apron', prop_scale=TOOLS)
            return name
        a = role_actor(role, group)
        if a is None:
            return None
        folder = a.split('/')[1]
        name = f'{kind or role}.{folder}'
        if name not in sets:
            _, _, anims, sc = ROLES[role]
            ov = dict(ov or {})
            sel = ov.pop('#sel', ())
            ps = ov.pop('#pscale', None)
            sets[name] = dict(actor=a, anims=anims, scale=sc, override=resolve_override(ov, a), sel=sel,
                              paint=PAINT.get(kind or role, PAINT.get(role, 'tabard')),
                              prop_scale=TOOLS if role == 'vil_f' else ps)
        return name

    for kind, role in KIND_ROLE.items():
        mp = mapping.setdefault(kind, {})
        for g in UGROUPS:
            n = add_role(role, g)
            if n:
                mp[g] = n
        if kind == 'villager':
            mf = mapping.setdefault('villager_f', {})
            for g in UGROUPS:
                n = add_role('vil_f', g)
                if n:
                    mf[g] = n
    for kind, (role, ov) in RANKS.items():
        mp = mapping.setdefault(kind, {})
        for g in UGROUPS:
            n = add_role(role, g, kind, ov)
            if n:
                mp[g] = n
    for kind, sname in KIND_GLOBAL.items():
        sets[sname] = dict(GLOBAL[sname])
        mapping[kind] = {'*': sname}
    for (kind, g), sname in KIND_GROUP_GLOBAL.items():
        sets[sname] = dict(GLOBAL[sname])
        mapping.setdefault(kind, {})[g] = sname
    for kind, st in SHIPS.items():
        mp = mapping.setdefault(kind, {})
        for g in UGROUPS:
            style = SHIP_STYLE[g]
            rec = st.get(style) or st['*']
            actor, ln = rec[:2]
            parts = actor[:-4].split('/')
            name = f'ship.{parts[-2]}.{parts[-1]}' + ('' if abs(ln - 1.8) < 1e-6 else f'_{ln:g}')
            if len(rec) > 2:
                name += '.' + rec[2]
            sets[name] = dict(actor=actor, anims=SHIP, length=ln, ship=True,
                              **SHIP_X.get(rec[2] if len(rec) > 2 else None, {}))
            mp[g] = name
    # the rider is larger than the horse (as in DE: the rider's figure reads above the horse's head)
    for sp in sets.values():
        if any(w in sp['actor'] for w in ('cavalry_', 'camelry_')):
            sp['prop_scale'] = dict(RIDER_K, **(sp.get('prop_scale') or {}))
    for k, v in SHIP_ALIAS.items():
        mapping[k] = mapping[v]
    for a in ('sheep', 'deer', 'boar', 'wolf'):
        sets[a] = dict(GLOBAL[a])
        mapping['animal_' + a] = {'*': a}
    return sets, mapping


# ---------------------------------------------------------------- models for portraits and previews
_PLAN = None


def unit_spec(kind, group='caro', female=False):
    """(set name, description) for a unit kind (as in the game: 'knight', 'villager', 'animal_sheep'...) and a unit
    group (UGROUPS: caro, anglo, norse, rus, byz, umay, han; '*' - any)."""
    global _PLAN
    if _PLAN is None:
        _PLAN = plan()
    sets, mapping = _PLAN
    m = mapping.get('villager_f' if female and kind == 'villager' else kind)
    if not m:
        raise KeyError(kind)
    name = m.get(group) or m.get('*') or m.get('caro') or next(iter(m.values()))
    return name, sets[name]


def posed_parts(kind, group='caro', anim='idle', frac=0.0, female=False):
    """The ready parts of a unit model in a pose: dict(parts - a list[Part] in model coordinates (0 A.D. units, Z up,
    looking along -Y), scale - cells per model unit as in the sprite sheets, name, spec, place(d) - a placement
    matrix for direction d of 16, like the sprites'). anim - our animation name ('idle', 'walk', 'attack',
    'chop', ...), frac - the cycle share 0..1. For portraits: Renderer.build_items(parts, place) -> Renderer.render."""
    from tools.render3d import animactor as aa
    name, spec = unit_spec(kind, group, female)
    rec = next((a for a in spec['anims'] if a[0] == anim), None) or spec['anims'][0]
    tree = spec_tree(spec, rec[1], rec[2])
    if spec.get('ship') and anim == 'walk':
        _calm_sails(tree, spec.get('seed', 0))
    scale = spec_scale(spec)
    return dict(parts=aa.evaluate(tree, frac) + extra_parts(spec), scale=scale, name=name, spec=spec,
                place=lambda d, s=scale: _place(s, d))


def render_pose(kind, group='caro', anim='idle', frac=0.0, d=3, female=False, renderer=None):
    """One frame as in the sheets (with R8): Sprite(rgba, mask, ox, oy). d - a direction of 16 (3 - toward the viewer)."""
    from tools.render3d import Renderer
    pp = posed_parts(kind, group, anim, frac, female)
    r = renderer or _renderer()
    return shoot(r, Renderer.build_items(pp['parts'], pp['place'](d)), pp['spec'])


# ---------------------------------------------------------------- rendering a set
_R = None


def _renderer():
    global _R
    if _R is None:
        from tools.render3d import Renderer
        _R = Renderer(ss=4, shadow_res=1024)
    return _R


def _measure_speed(tree, info, n=24):
    """The speed of the "feet" in the walk animation (0 A.D. units per cycle): vertices at the ground move back at the body's speed."""
    from tools.render3d import skin
    if not tree.mesh:
        return 0.0
    sm = skin.skinned(tree.mesh)
    an = skin.animation(info['file'])
    if sm is None or an is None or an['dur'] <= 0:
        return 0.0
    P = []
    for k in range(n):
        P.append(skin.deform(sm, skin.pose(sm['skel'], an, k / n * an['dur']))['pos'])
    P = np.array(P, np.float64)
    zmin = P[..., 2].min()
    h = P[..., 2].max() - zmin
    vs = []
    for k in range(n):
        a, b = P[k], P[(k + 1) % n]
        c = (a[:, 2] < zmin + 0.06 * h) & (b[:, 2] < zmin + 0.06 * h)
        if c.sum() >= 3:
            vs.append(np.median(b[c, 1] - a[c, 1]))
    if not vs:
        return 0.0
    v = float(np.median(vs))            # per frame step, along +Y (backward)
    return max(0.0, v * n)


def _calm_sails(node, seed):
    """Ships' sails while sailing: the 'move' animation of Byzantine and Han sails in 0 A.D./Millennium folds
    the cloth in our render (the bones do not match) - we take their light 'idle' swaying; Norman ones - as they are."""
    from tools.render3d import animactor as aa
    for _, ch, _ in node.props:
        if 'sail' in ch.actor and 'norse' not in ch.actor and ch.anim:
            idle = aa.build(ch.actor, 'idle', seed=seed)
            ch.anim = idle.anim if idle is not None and idle.anim else None
        _calm_sails(ch, seed)


def _head_top(items):
    """The height of the top of the head above the feet (screen px) by the head parts (props/units/heads/...); 0 - no heads."""
    from tools.render3d import camera
    top = 0.0
    for it in items:
        a = getattr(it.get('part'), 'actor', '') or ''
        if '/heads/' in a and len(it['pos']):
            top = max(top, float(-camera.project(it['pos'])[:, 1].min()))
    return int(round(top))


def _place(scale, d):
    from tools.render3d import camera
    return camera.placement(scale, d * 360.0 / NDIR + FWD, center=(0.0, 0.0), mirror=MIRROR)


def _skip(spec):
    return (lambda a, ap: 'garrison_flag' in a or 'fish_' in ap) if spec.get('ship') else None


# ---------------------------------------------------------------- extra parts of machines and ships (R10, R12, R13)
# spec['extras'] - [(shape, texture, (fx0, fy0, fz0, fx1, fy1, fz1)), ...]: a box/cylinder in shares of the model's footprint
# in the rest pose (x - width, y - length, -y - bow/front, z - height). Shapes: 'box', 'cyl_y' (a cylinder along the length),
# 'ram_head' (a ram's head at the end of a log), 'tent' (a half-cylinder awning along the length), 'sail_lat' (a lateen sail),
# 'barrels' (barrels of gunpowder in rows), 'siphon' (a flamethrower pipe).
_BOUNDS = {}


def spec_bounds(spec):
    from tools.render3d import parts_bounds
    from tools.render3d import animactor as aa
    key = spec_hash(dict(spec, extras=None))
    if key not in _BOUNDS:
        tree = aa.build(spec['actor'], 'idle', seed=spec.get('seed', 0), override=spec.get('override'),
                        skip=_skip(spec), paint=spec.get('paint'))
        _BOUNDS[key] = parts_bounds(aa.evaluate(tree, 0.0))
    return _BOUNDS[key]


def extra_parts(spec):
    """Parts from spec['extras'] (in model coordinates) - added to the frame after evaluate."""
    ex = spec.get('extras')
    if not ex:
        return []
    from tools.render3d import Part, procmesh
    lo, hi = spec_bounds(spec)
    out = []
    for shape, tex, f in ex:
        a = lo + (hi - lo) * np.array(f[:3])
        b = lo + (hi - lo) * np.array(f[3:])
        g = procmesh.shape(shape, a, b)
        mat = 'player_trans_norm_spec.xml' if tex.startswith('@tex/player') else 'no_trans_norm_spec.xml'
        out.append(Part(mesh='@extra', matrix=np.eye(4), textures={'baseTex': tex}, material=mat,
                        actor='@extra:' + shape, geom=g))
    return out


def spec_scale(spec):
    """A set's scale: given (scale) or by the model's length in the rest pose (length, cells)."""
    from tools.render3d import parts_bounds
    from tools.render3d import animactor as aa
    scale = spec.get('scale')
    if scale is None:
        tree = aa.build(spec['actor'], 'idle', seed=spec.get('seed', 0), override=spec.get('override'),
                        skip=_skip(spec), paint=spec.get('paint'))
        lo, hi = parts_bounds(aa.evaluate(tree, 0.0))
        ln = spec['length'] * (1.0 if spec.get('ship') else S_SIEGE)
        scale = ln / max(hi[0] - lo[0], hi[1] - lo[1], 1e-3)
    return scale


def spec_tree(spec, a0, sel=()):
    """A set's ANode tree for the 0 A.D. animation a0 (with the variant choices sel)."""
    from tools.render3d import animactor as aa
    xsel = tuple(spec.get('sel') or ())
    return aa.build(spec['actor'], a0, sel=tuple(sel) + xsel, seed=spec.get('seed', 0),
                    override=spec.get('override'), skip=_skip(spec), paint=spec.get('paint'),
                    prop_scale=spec.get('prop_scale'))


# R8 (docs/research/06_units_recognition.md): DE is lighter and calmer - brightness V ~ 0.52, saturation ~ 0.40,
# lightness ~ 98, few nearly black pixels. Lifting the shadows (gamma) + a brightness multiplier + less saturation.
GRADE = dict(gamma=0.85, gain=1.0, sat=0.8)
GRADE_MACHINE = dict(gamma=0.88, gain=1.05, sat=0.9)      # machines and ships (wood): softer


def grade(rgba, g=None):
    """R8: color correction of a unit frame (a straight alpha, the shadow - black translucent - is not touched)."""
    g = g or GRADE
    a = rgba[..., 3]
    body = a > 0
    if not body.any():
        return rgba
    rgb = rgba[..., :3].astype(np.float32) / 255.0
    rgb = np.power(np.clip(rgb, 0, 1), g['gamma']) * g['gain']
    lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    rgb = lum[..., None] + (rgb - lum[..., None]) * g['sat']
    out = rgba.copy()
    # the shadow on the ground - black pixels with partial alpha: we do not lighten them
    obj = body & ~((rgba[..., :3].max(-1) < 8) & (a < 250))
    out[..., :3] = np.where(obj[..., None], np.clip(rgb * 255.0 + 0.5, 0, 255).astype(np.uint8), rgba[..., :3])
    return out


def shoot(r, items, spec):
    """A set's frame: the render + R8 (for people and animals)."""
    spr = r.render(items, footprint=(0, 0), shadow_scale=0.85, pad=1)
    g = spec.get('grade') or (GRADE_MACHINE if spec.get('ship') or spec.get('length') else GRADE)
    spr.rgba = grade(spr.rgba, g)
    return spr


def render_set(name, spec, out=OUT, verbose=True):
    """Renders a set -> files; returns the index entry."""
    from tools.render3d import Renderer
    from tools.render3d import animactor as aa, procmesh
    r = _renderer()
    t0 = time.time()
    seed = spec.get('seed', 0)
    scale = spec_scale(spec)
    frames = []            # (Sprite, ...) in order: animation -> direction -> frame
    anims = {}
    height = 0
    body = 0               # the top of the head (without a crested helmet, spears, banners) - for the health bar
    for (aname, a0, sel, n, mode) in spec['anims']:
        tree = spec_tree(spec, a0, sel)
        if tree is None:
            print('  ! no actor', spec['actor'])
            return None
        if spec.get('ship') and aname == 'walk':
            _calm_sails(tree, seed)
        info = aa.anim_info(tree, _ACCEPT.get(a0, {a0}))
        found = info['name'] if info else None
        if info is None or found not in _ACCEPT.get(a0, {a0}):
            if spec.get('ship') and aname == 'walk':
                continue        # a ship without oars and sails with an animation - while sailing the same frame as at rest
            if aname in ('idle', 'walk') or aname.startswith('carry_'):
                n = 1           # no animation (a machine, a ship) - one still frame
            else:
                continue
        dur = info['dur'] if info else 1.0
        if info is None:
            n = 1
        rec = {'n': n, 'dur': round(dur, 3), 'loop': mode != 'once', 'i0': len(frames)}
        if info and a0.startswith('attack'):
            rec['event'] = round(info.get('event', 0.5), 3)
        if aname in ('walk', 'run') or aname.startswith('carry_'):
            v = _measure_speed(tree, info) if info else 0.0
            if procmesh.is_proc(spec['actor']):
                v = procmesh.stride(spec['actor'])
            # step: how many world pixels a unit covers per animation cycle
            rec['stride'] = round(v * scale * TILE_PX, 2)
        for d in range(NDIR):
            place = _place(scale, d)
            for k in range(n):
                if n == 1:
                    frac = 0.0
                elif mode == 'once':
                    frac = min(k / (n - 1), 0.999)
                else:
                    frac = k / n
                parts = aa.evaluate(tree, frac) + extra_parts(spec)
                items = Renderer.build_items(parts, place)
                spr = shoot(r, items, spec)
                frames.append(spr)
                if aname == 'idle':
                    ys = np.nonzero(spr.rgba[..., 3] > 160)[0]
                    if len(ys):
                        height = max(height, spr.oy - int(ys.min()))
                    if not spec.get('ship'):        # for ships the oarsman's head is not a "crown" (09 - #25)
                        body = max(body, _head_top(items))
        anims[aname] = rec
    rects, sheet, mask = pack(frames)
    base = os.path.join(out, name)
    os.makedirs(out, exist_ok=True)
    # a 256-color palette (with transparency) - ~ 4 times smaller than RGBA with a nearly indistinguishable picture
    Image.fromarray(sheet).quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(
        base + '.png', optimize=True)
    has_mask = mask.max() > 8
    if has_mask:
        Image.fromarray(mask, 'L').save(base + '.m.png', optimize=True)
    rec = {'file': f'units/{name}.png', 'mask': f'units/{name}.m.png' if has_mask else None,
           'meta': f'units/{name}.json', 'anims': anims, 'h': int(height), 'scale': round(scale, 4),
           'bh': int(body) if body > 0 else int(height), 'dirs': NDIR,
           'actor': spec['actor']}
    # the index entry and the description's fingerprint next to the frames: --resume skips what is already built
    with open(base + '.json', 'w', encoding='utf-8') as f:
        json.dump({'frames': rects, 'rec': rec, 'spec': spec_hash(spec)}, f, separators=(',', ':'))
    if verbose:
        sz = os.path.getsize(base + '.png') + (os.path.getsize(base + '.m.png') if has_mask else 0)
        print(f'  + {name:28s} {len(frames):4d} frames  {sheet.shape[1]}×{sheet.shape[0]}  '
              f'{sz / 1024:6.0f} KB  {time.time() - t0:5.1f} s', flush=True)
    return rec


def spec_hash(spec):
    """A fingerprint of a set's description (actor, overrides, animations, scale) - to know that the sheet is already built."""
    import hashlib
    return hashlib.md5(json.dumps([spec, NDIR, RENDER_VER], sort_keys=True, default=str).encode()).hexdigest()[:16]


def _built(name, spec):
    """The index entry of an already built set with the same description (or None)."""
    base = os.path.join(OUT, name)
    try:
        with open(base + '.json', encoding='utf-8') as f:
            meta = json.load(f)
    except (OSError, ValueError):
        return None
    rec = meta.get('rec')
    if meta.get('spec') != spec_hash(spec) or not rec or not os.path.exists(base + '.png'):
        return None
    return rec


_ACCEPT = {
    'death': {'death'}, 'run': {'run'}, 'walk': {'walk', 'run'}, 'build': {'build', 'gather_tree'},
    'attack_melee': {'attack_melee', 'attack_slaughter', 'attack_ranged'},
    'attack_ranged': {'attack_ranged', 'attack_melee', 'attack_slaughter'},
    'heal': {'heal'},
}


def pack(frames, width=1024):
    """Shelf packing of frames (in the original order) -> (rects [x, y, w, h, ax, ay], RGBA, mask L)."""
    x = y = rowh = 0
    pos = []
    maxw = 0
    for s in frames:
        h, w = s.rgba.shape[:2]
        if x + w > width and x > 0:
            y += rowh
            x = rowh = 0
        pos.append((x, y))
        x += w
        rowh = max(rowh, h)
        maxw = max(maxw, x)
    H = y + rowh
    sheet = np.zeros((max(H, 1), max(maxw, 1), 4), np.uint8)
    mask = np.zeros((max(H, 1), max(maxw, 1)), np.uint8)
    rects = []
    for (px, py), s in zip(pos, frames):
        h, w = s.rgba.shape[:2]
        sheet[py:py + h, px:px + w] = s.rgba
        mask[py:py + h, px:px + w] = s.mask
        rects.append([px, py, w, h, int(s.ox), int(s.oy)])
    return rects, sheet, mask


# ---------------------------------------------------------------- parallel build
def _job(args):
    name, spec = args
    try:
        return name, render_set(name, spec)
    except Exception as e:           # one broken set does not break the build
        import traceback
        traceback.print_exc()
        print('  ! set not built:', name, type(e).__name__, e, flush=True)
        return name, None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--only', default='', help='set names separated by commas (the rest are taken from the index)')
    ap.add_argument('--jobs', type=int, default=max(1, min(6, (os.cpu_count() or 2) - 2)))
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--resume', action='store_true', help='do not rebuild sets whose description has not changed')
    ap.add_argument('--sheets', default='', help='folder for contact sheets')
    a = ap.parse_args()
    sets, mapping = plan()
    if a.list:
        for n, s in sorted(sets.items()):
            print(f'{n:28s} {s["actor"]}')
        for k, m in sorted(mapping.items()):
            print(f'{k:24s} {m}')
        return
    only = [x for x in a.only.split(',') if x]
    todo = [(n, s) for n, s in sets.items() if not only or n in only]
    idx_path = os.path.join(OUT, 'index.json')
    old = {}
    if only and os.path.exists(idx_path):
        with open(idx_path, encoding='utf-8') as f:
            old = json.load(f).get('sets', {})
    t0 = time.time()
    results = {}
    if a.resume:
        rest = []
        for n, sp in todo:
            rec = _built(n, sp)
            if rec is not None:
                results[n] = rec
            else:
                rest.append((n, sp))
        print(f'already built: {len(results)}, to build: {len(rest)}')
        todo = rest
    if a.jobs > 1 and len(todo) > 1:
        import multiprocessing as mp
        ctx = mp.get_context('spawn')
        with ctx.Pool(a.jobs) as pool:
            for name, rec in pool.imap_unordered(_job, sorted(todo, key=lambda x: -len(x[1]['anims']))):
                results[name] = rec
    else:
        for t in todo:
            name, rec = _job(t)
            results[name] = rec
    allsets = dict(old)
    allsets.update({k: v for k, v in results.items() if v})
    used = {n for m in mapping.values() for n in m.values()}
    index = {
        'version': 1,
        'groups': BUILD_TO_UNIT,
        'default': 'caro',
        'sets': {k: v for k, v in allsets.items() if k in used},
        'units': {k: {g: n for g, n in m.items() if n in allsets} for k, m in mapping.items()},
    }
    os.makedirs(OUT, exist_ok=True)
    with open(idx_path, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    # extra files from old builds
    keep = set()
    for v in index['sets'].values():
        keep |= {os.path.basename(v['file']), os.path.basename(v['meta'])}
        if v.get('mask'):
            keep.add(os.path.basename(v['mask']))
    for fn in os.listdir(OUT):
        if fn != 'index.json' and fn not in keep:
            os.remove(os.path.join(OUT, fn))
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print(f'done: {len(index["sets"])} sets, {total / 1e6:.1f} MB, {time.time() - t0:.0f} s')
    if a.sheets:
        from tools.unit_sheet import main as sheet_main
        sheet_main(['--out', a.sheets])


if __name__ == '__main__':
    main()
