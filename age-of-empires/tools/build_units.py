#!/usr/bin/env python3
"""Юниты из анимированных моделей 0 A.D. → листы спрайтов assets/gen/units/ (+ units/index.json).

Нужны сырые ассеты (tools/fetch_0ad.py → assets/0ad_raw/). Скиннинг и анимации — tools/render3d/skin.py,
акторы с анимациями — tools/render3d/animactor.py, рендер — tools/render3d/renderer.py.

  .venv/bin/python tools/build_units.py                         # всё (параллельно, несколько процессов)
  .venv/bin/python tools/build_units.py --only vil_m.britons,sheep --jobs 1
  .venv/bin/python tools/build_units.py --list                  # набор моделей и сопоставление видам юнитов
  .venv/bin/python tools/build_units.py --sheets shots/units    # контактные листы (tools/unit_sheet.py)

Результат (пути относительно assets/gen/):
  units/index.json          — индекс: наборы (анимации, число кадров, длительность, шаг, высота),
                              сопоставление (вид юнита, группа цивилизаций) → набор
  units/<набор>.png         — лист кадров RGBA: [анимация][направление 0..15][кадр]
  units/<набор>.m.png       — маска цвета игрока (L8), та же раскладка
  units/<набор>.json        — прямоугольники кадров [x, y, w, h, ax, ay] (ax, ay — точка «ног» в кадре)
Модели для портретов/значков (те же правки, одежда, доп. детали, что в листах):
  unit_spec(kind, group)                          → (имя набора, описание)
  posed_parts(kind, group, anim, frac, female)    → dict(parts, scale, place(d), name, spec)
  render_pose(kind, group, anim, frac, d)         → Sprite кадра как в листе (с R8)
Направление d: взгляд вдоль угла d·22.5° в координатах мира (0 — +X, 4 — +Y); число — 'dirs' в записи набора.
Производные материалы 0 A.D. © Wildfire Games, CC BY-SA 3.0 (см. CREDITS.md).
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
TILE_PX = 32                    # game.data.TILE: пикселей мира на клетку

# ---------------------------------------------------------------- масштаб (клеток на единицу 0 A.D.)
# Пропорции AoE II DE (docs/research/04_graphics.md, кванты 7, 8, 12): житель ≈ 0.33 ширины клетки ростом
# (21 px при клетке 64 px), рыцарь ≈ 0.58 (≈ 37 px); раньше было 0.73 и 0.94 — фигурки в 2.2 и 1.6 раза крупнее.
S_INF = 0.122                   # пехота: человек 0 A.D. ≈ 4.2 ед. → ≈ 21 px ростом
S_CAV = 0.12                    # конница: рыцарь ≈ 1.5 роста пехотинца (DE: 45–50 px против 31, квант 12)
S_ANIMAL = 0.12                 # звери: в тех же пропорциях к людям, что и раньше
S_SIEGE = 0.8                   # осадные машины: множитель длины (таран DE ≈ 1.2 клетки)
NDIR = 16                       # направлений взгляда, как в DE (квант 25)
RENDER_VER = 3                  # версия освещения/масштаба: смена пересобирает всё при --resume
FWD = 90.0                      # модель 0 A.D. смотрит вдоль −Y: поворот, чтобы d=0 смотрело вдоль +X
MIRROR = True                   # COLLADA правая система, экран — левая: без отражения щит в правой руке

# ---------------------------------------------------------------- анимации
# (наше имя, имя анимации 0 A.D., выборы вариантов, кадров, 'loop' | 'once' | 'static')
# R9: живой покой (дыхание, переминание) — 10 кадров на цикл, как у DE (у машин и кораблей — 1 кадр)
A_IDLE = ('idle', 'idle', (), 10, 'loop')
# кадров на цикл (квант 26–28): DE — ходьба 30, атака 30–60, смерть 30; у нас 16–20 — ближе к DE при
# разумном объёме (листы 256 цветов, всего assets/gen ≲ 300 МБ)
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

# ---------------------------------------------------------------- группы цивилизаций
# группа зданий (game.sprites3d.civ_group) → группа юнитов → папки units/<…> 0 A.D. по порядку поиска
# Средневековые юниты — из мода Millennium A.D. (папки units/caro, anglo, norse, rus, byzantines, umayyads),
# недостающие роли — из 0 A.D. (последняя папка цепочки: мирные жители-мужчины, арбалетчик).
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
# роль → (имена акторов в папке по порядку, запасной актор вне цепочки, анимации, масштаб)
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
# группы, где у роли свой актор вне цепочки папок
ROLE_GROUP = {
    ('scout', 'han'): 'units/han/cavalry_spearman_b_m.xml',
    ('cav_a', 'han'): 'units/han/cavalry_spearman_b_m.xml',
    ('monk', 'anglo'): 'units/caro/healer.xml',
    ('monk', 'norse'): 'units/caro/healer.xml',
}
# мирные жители-мужчины: в Millennium A.D. их нет — нейтральные крестьяне 0 A.D. с «средневековыми» головными
# уборами (соломенная шляпа, капюшон, меховая шапка, тюрбан) по группе
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
TRADER = {'umay': 'trader.umay', 'han': 'trader.han'}          # остальные — trader.byz (повозка)

# ---------------------------------------------------------------- ранги (AoE2): чем выше ранг, тем тяжелее вид
# Шлемы по культуре папки актора: 'H:<тип>' в override заменяется на актор шлема.
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
PLATE = 'skeletal/imp/lorica_segmentata_01_01.png'          # «латы»: блестящие стальные полосы
BIGSWORD = ('props/units/weapons/norse_sword.xml', (1.8, 1.8, 1.8))
# шлемы-«подписи» (procmesh): крупнее натуральных, чтобы читались в 21 px
KETTLE, KABUTO, GREATHELM, MORION = ('@kettle', 1.35), ('@kabuto', 1.5), ('@greathelm', 1.25), ('@morion', 1.35)
SW = 'biped/infantry/swordsman/'
TWO_H = {'#anim:idle': SW + 'idle_relax_2h.dae', '#anim:walk': 'biped/infantry/spearman/walk_relax.dae',
         '#anim:attack_melee': SW + 'attack_melee_2h_01.dae', 'shield': None, 'shield_arm': None,
         'weapon_R': '@greatsword', 'sheath_L': None}
# стрелки идут шагом (а не бегом «трусцой», растянутым до нашей скорости): ноги не скользят, темп естественный
W_RANGED = 'biped/infantry/spearman/walk_relax.dae'
XB = 'biped/infantry/crossbowman/'
NU = 'props/units/weapons/crossbow/han_nu.xml'
XBOW = {'weapon_R': (NU, 2.2), 'weapon_bow': None, '#anim:idle': XB + 'idle_ready_01.dae',
        '#anim:attack_ranged': (XB + 'attack_ranged.dae', 0.8), '#anim:walk': W_RANGED}
PIKE = ('props/units/weapons/spear_long.xml', (2.2, 2.2, 1.5))
SPEAR = ('props/units/weapons/spear_long.xml', (2.2, 2.2, 1.1))
HORSE_ARMOR = 'props/horse/cav_armor_caro.xml'
# попона цвета игрока (заменяет прежние накидки/броню коня) + маска на морду
CAPARISON = {'root': 'props/horse/cav_armor_byzantine_cloth_player.xml', 'root+': 'props/horse/cav_rein_leather.xml',
             'head': 'props/horse/cav_mask_byzantine_cloth_player.xml'}
# R3: каплевидный щит (латник), «гербовый» (короче — длинный мечник)
def kite(pattern='bands', k=1.15, pt='shield_arm'):
    """Каплевидный щит с гербом цвета игрока (procmesh '@shield/kite_*') на точке pt."""
    return {pt: ('props/units/shields/byza_kite.xml', k), pt + '>#baseTex': '@shield/kite_' + pattern,
            ('shield' if pt == 'shield_arm' else 'shield_arm'): None}


HEATER_K = (1.15, 1.15, 0.85)
# R5: древко двумя руками, без щита (анимации пикинёра 0 A.D.)
PK = 'biped/infantry/pikeman/'
POLE = {'#anim:idle': PK + 'idle_relax_01.dae', '#anim:walk': PK + 'walk_relax.dae',
        '#anim:attack_melee': PK + 'attack_melee_01.dae', 'shield': None, 'shield_arm': None}
NOSHIELD = {'shield': None, 'shield_arm': None}
SH = 'props/shields/'

# R6: всадник с мечом/саблей (анимации «generic» 0 A.D.: меч наготове, удар сверху; со щитом — *_shield_*)
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


# луки всадников крупнее (иначе конный лучник ≠ всадник только по цвету)
RIDER_K = {'units/': 1.12}
BOWS = {'props/units/weapons/bow': 1.7, 'props/units/weapons/xion_bow': 1.7, 'props/units/weapons/norse_bow': 1.7}

# R1: стиль одежды (tools/render3d/paint.py) по роли; у видов — ключ '#paint' в правках
PAINT = {
    'vil_f': 'dress', 'vil_m': 'apron', 'monk': 'stole',
}
# R14: инструменты жителей крупнее (топор, кирка, мотыга, молоток, нож, корзина) — читаются в 21 px
TOOLS = {'props/units/tools/basket': 1.35, 'props/units/tools/': 2.3, 'props/units/weapons/dagger': 2.6,
}

# вид → (роль-цепочка акторов, правки)
RANKS = {
    # ополченец DE: кожаный жилет, дубина/булава в опущенной руке, без щита
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
    # R6: скаут-линия и рыцари — всадник с мечом (DE), без копья; R7 — броня/попона коня; R3 — каплевидный щит
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


# верблюд: шаг вместо рыси (рысь, растянутая до нашей скорости, выглядела замедленной), всадник сидит спокойно
CAMEL_WALK = {'#anim:walk': 'quadraped/camel_walk.dae',
              'rider>#anim:walk': 'biped/rider/camelry/archer/idle_relax_01.dae'}


def resolve_override(ov, actor):
    """'H:<тип>' → шлем культуры папки актора."""
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


# ---------------------------------------------------------------- огнестрел (процедурные пропы, tools/render3d/procmesh.py)
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
# отличие элитных уникальных юнитов: гребень/плюмаж цвета игрока (поверх своего шлема)
PLUME = (_H + 'rome_apulo_itallic_e1.xml', 1.3)
ELITE_INF = {'helmet+': '@plume_player'}
ELITE_CAV = {'rider>helmet+': '@plume_player'}
# верблюжьи всадники с саблей: анимации всадника «generic»
CAMEL_SWORD = {'rider>weapon_R': ('props/units/weapons/byza_paramerion.xml', 1.5), 'rider>shield': None,
               'rider>#anim:attack_melee': 'biped/rider/cavalry/generic/attack_melee_shield_01.dae',
               # белый тюрбан (DE: у верблюжьих всадников и мамлюков)
               'rider>helmet': (_H + 'achae_kidaris_tied.xml', (1.2, 1.2, 1.1)), 'rider>helmet>#baseTex': '@tex/white'}

# осадные: R12 — брусья/обмотки цвета игрока (доли габарита модели, см. extra_parts)
RAILS = [('box', '@tex/player', (0.14, 0.12, 0.03, 0.22, 0.88, 0.11)),
         ('box', '@tex/player', (0.78, 0.12, 0.03, 0.86, 0.88, 0.11))]
ROPES = [('cyl_y', '@tex/player', (0.12, 0.42, 0.25, 0.3, 0.58, 0.45)),
         ('cyl_y', '@tex/player', (0.7, 0.42, 0.25, 0.88, 0.58, 0.45))]
NOCREW = {'operator_L': None, 'operator_R': None}

# наборы вне групп: имя → dict(actor, anims, scale | length, …)
GLOBAL = {
    'trader.byz': dict(actor='units/byzantines/trader.xml', anims=CART, scale=S_CAV, paint='tabard'),
    'trader.han': dict(actor='units/han/trader.xml', anims=CART, scale=S_CAV, paint='tabard'),
    'trader.umay': dict(actor='units/umayyads/trader.xml', anims=CART, scale=S_CAV, paint='tabard'),
    # ручница: ствол ×1.5, шапель, полосатые штаны (DE)
    'gun': dict(actor='units/caro/infantry_archer_b.xml', anims=RANGED, scale=S_INF, seed=1, paint='bands',
                override=dict(GUN, weapon_R=('@handcannon', 2.0), helmet=KETTLE)),
    # янычар: белый халат с кушаком цвета игрока, высокая белая шапка, мушкет крупнее
    'janissary': dict(actor='units/umayyads/infantry_archer_b.xml', anims=RANGED, scale=S_INF, seed=9, paint='robe',
                      override=dict(GUN, weapon_R=('@musket', 1.7), **JAN_HAT)),
    'janissary_e': dict(actor='units/umayyads/infantry_archer_e.xml', anims=RANGED, scale=S_INF * 1.03, seed=9,
                        paint='robe', override=dict(GUN, weapon_R=('@musket_dark', 1.7), **JAN_HAT),
                        sel=('scale1a',)),
    # конкистадор: морион, аркебуза, без щита
    'conquistador': dict(actor='units/caro/cavalry_archer_b_m.xml', anims=RANGED, scale=S_CAV, paint='quarter',
                         override=dict(CAV_GUN, **{'rider>weapon_R': ('@musket', 1.7), 'rider>helmet': MORION})),
    'conquistador_e': dict(actor='units/caro/cavalry_archer_b_m.xml', anims=RANGED, scale=S_CAV * 1.03,
                           paint='quarter',
                           override=dict(CAV_GUN, **{'root+': HORSE_ARMOR, 'rider>helmet': MORION,
                                                     'rider>helmet+': '@plume_player',
                                                     'rider>weapon_R': ('@musket', 1.7)})),
    # верблюжий всадник: сабля + круглый щит сине-белый, тюрбан
    'camel': dict(actor='units/umayyads/camelry_archer_b_m.xml', anims=MELEE, scale=S_CAV, paint='tabard',
                  override=dict(CAMEL_WALK, **CAMEL_SWORD, rider='units/umayyads/cavalry_spearman_b_r.xml',
                                **{'rider>shield_arm': ('props/units/shields/umay_round_b.xml', 1.1),
                                   'rider>shield_arm>#baseTex': SH + 'caro/lenticular/lenticular_chiro_player_white.png'})),
    'camel_h': dict(actor='units/umayyads/camelry_archer_e_m.xml', anims=MELEE, scale=S_CAV * 1.03, paint='surcoat',
                    override=dict(CAMEL_WALK, **CAMEL_SWORD, rider='units/umayyads/cavalry_spearman_e_r.xml',
                                  **{'rider>shield_arm': ('props/units/shields/umay_round_e.xml', 1.15),
                                     'rider>shield_arm>#baseTex': SH + 'caro/lenticular/lenticular_petal_player_white.png'})),
    # мамлюк: белый халат и тюрбан, большая сабля, без щита; верблюд светлый
    'mameluke': dict(actor='units/umayyads/camelry_archer_a_m.xml', anims=MELEE, scale=S_CAV * 1.03, paint='robe',
                     override={**CAMEL_WALK, **CAMEL_SWORD, 'rider': 'units/umayyads/cavalry_spearman_a_r.xml',
                               'rider>weapon_R': ('props/units/weapons/byza_paramerion.xml', 1.8),
                               'rider>helmet': (_H + 'achae_kidaris_tied.xml', (1.2, 1.2, 1.3)),
                               'rider>helmet>#baseTex': '@tex/white', 'rider>root': None}),
    # боевой слон: башенка-хауда с воином, попона
    'elephant': dict(actor='fauna/elephant_asian.xml', anims=MELEE, scale=0.118, paint='tabard',
                     override={'rider1': 'units/achaemenids/cavalry_archer_b_r.xml',
                               'turret': 'props/units/elephant/howdah_cart_01.xml',
                               'turret+': 'units/achaemenids/cavalry_archer_b_r.xml'}),
    # метатель топоров (франк): крупный топор, полосатые штаны, шлем
    'axe_thrower': dict(actor='units/caro/infantry_javelinist_b.xml', anims=RANGED, scale=S_INF, paint='bands',
                        override={'weapon_R': ('props/units/weapons/norse_axe.xml', 2.4), '#anim:walk': W_RANGED,
                                  'ammo': None, 'helmet': 'H:nasal'}),
    # берсерк: голый торс, меч и круглый щит
    'berserk': dict(actor='units/norse/champion_berserker.xml', anims=MELEE, scale=S_INF, paint='bare',
                    override={'weapon_R': ('props/units/weapons/norse_sword.xml', 1.4), '#anim:idle': SW + 'idle_ready_shield_01.dae',
                              '#anim:walk': SW + 'walk_relax_shield.dae',
                              '#anim:attack_melee': SW + 'attack_melee_shield_01.dae',
                              'shield_arm>#baseTex': SH + 'caro/lenticular/lenticular_chiro_player_white.png',
                              'root': None, 'root+': 'props/units/capes/cape_med_pelt.xml'}),
    # хускарл: огромный круглый щит сине-белый, меч, наносный шлем
    'huskarl': dict(actor='units/norse/champion_huscarl.xml', anims=MELEE, scale=S_INF, seed=2, paint='tabard',
                    override={'weapon_R': ('props/units/weapons/norse_sword.xml', 1.3), 'back': None,
                              'shield_arm': ('props/units/shields/norse_player_colour.xml', 1.45),
                              'shield_arm>#baseTex': SH + 'iron_swirl_white.png',
                              '#anim:idle': SW + 'idle_relax_shield_01.dae', '#anim:walk': SW + 'walk_relax_shield.dae',
                              '#anim:attack_melee': SW + 'attack_melee_shield_01.dae'}),
    # тевтонский рыцарь: ведёрный шлем, двуручный меч, белый плащ с крестом цвета игрока
    'teuton': dict(actor='units/caro/champion_infantry.xml', anims=MELEE, scale=S_INF * 1.04, seed=3, paint='white',
                   override=dict(TWO_H, helmet=GREATHELM, root=None,
                                 **{'root+': ('props/units/capes/cape_long_player.xml', 1.0),
                                    'root+>#baseTex': '@tex/linen'})),
    # вайдовый налётчик: голый торс, длинные волосы, меч
    'woad': dict(actor='units/britons/infantry_swordsman_c.xml', anims=MELEE, scale=S_INF, seed=4, paint='bare',
                 override=dict(NOSHIELD, helmet=None, root=None, head='props/units/heads/new/head_celt_fanatic.xml',
                               weapon_R=('props/units/weapons/norse_sword.xml', 1.35), sheath_01_R=None,
                               **{'#anim:idle': SW + 'idle_ready_2h.dae', '#anim:walk': SW + 'walk_ready_2h.dae',
                                  '#anim:attack_melee': SW + 'attack_melee_2h_01.dae'})),
    # самурай: кабуто с рогами, катана двумя руками
    'samurai': dict(actor='units/han/infantry_swordsman_c.xml', anims=MELEE, scale=S_INF, seed=5, paint='surcoat',
                    override=dict(TWO_H, helmet=KABUTO, weapon_R=('@katana', 1.3), root=None)),
    # чу-ко-ну: магазинный арбалет-коробка
    'chukonu': dict(actor='units/han/infantry_crossbowman_b.xml', anims=RANGED, scale=S_INF, seed=6, paint='tabard',
                    override={'#anim:walk': W_RANGED,
                              'weapon_R': ('props/units/weapons/crossbow/han_liannu.xml', 2.4)}),
    # длинный лучник: лук выше роста, белый табард с гербом
    'longbow': dict(actor='units/caro/infantry_archer_e.xml', anims=RANGED, scale=S_INF * 1.03, seed=7, paint='white',
                    override={'#anim:walk': W_RANGED, 'weapon_bow': ('props/units/weapons/norse_bow.xml', 2.0),
                              'helmet': None}),
    # мангудай: меховая шапка с плюмажем, бурый конь, кожаный доспех
    'mangudai': dict(actor='units/han/cavalry_archer_b_m.xml', anims=RANGED, scale=S_CAV, seed=8, paint='vest',
                     prop_scale=BOWS,
                     override={'rider>helmet': _H + 'rus_cap_fur.xml', 'rider>helmet+': '@plume_player'}),
    # катафракт: конь в ламеллярной броне, всадник в чешуе, копьё, без щита
    'cataphract': dict(actor='units/byzantines/cavalry_spearman_e_m.xml', anims=MELEE, scale=S_CAV, paint='tabard',
                       override={'root+': 'props/horse/cav_armor_umayyad_lamellar.xml', 'rider>shield_arm': None,
                                 'rider>shield': None}),
    # осадные машины: длина вписывается в length клеток
    # тараны (R10, R12): синие брусья основания, видимое бревно / голова барана спереди
    'ram_log': dict(actor='structures/germans/siege_ram.xml', anims=RAM, length=1.5,
                    extras=RAILS + [('cyl_y', '@tex/wood', (0.4, -0.16, 0.2, 0.6, 0.35, 0.42))]),
    'ram_capped': dict(actor='structures/celts/siege_ram.xml', anims=RAM, length=1.55,
                       extras=RAILS + [('cyl_y', '@tex/wood', (0.42, 0.05, 0.22, 0.58, 0.35, 0.4)),
                                       ('ram_head', '@tex/steel', (0.36, -0.16, 0.18, 0.64, 0.08, 0.45))]),
    'ram_siege': dict(actor='units/byzantines/siege_ram.xml', anims=RAM, length=1.75,
                      extras=RAILS + [('ram_head', '@tex/steel', (0.36, -0.18, 0.12, 0.64, 0.08, 0.42)),
                                      ('box', '@tex/steel', (0.2, 0.25, 0.6, 0.8, 0.45, 0.75)),
                                      ('box', '@tex/steel', (0.2, 0.6, 0.45, 0.8, 0.75, 0.62))]),
    # мангонель-линия (DE — торсион с ложкой): рама онагра, крупнее с рангом (R11), обмотки цвета игрока (R12)
    'mangonel': dict(actor='units/romans/siege_onager.xml', anims=SIEGE, length=1.95, extras=ROPES),
    'onager': dict(actor='units/romans/siege_onager.xml', anims=SIEGE, length=2.15, seed=1,
                   extras=ROPES + [('box', '@tex/steel', (0.0, 0.3, 0.0, 1.0, 0.36, 0.1))]),
    'onager_s': dict(actor='units/romans/siege_onager.xml', anims=SIEGE, length=2.45, seed=1,
                     extras=ROPES + [('box', '@tex/steel', (0.0, 0.3, 0.0, 1.0, 0.36, 0.12)),
                                     ('box', '@tex/steel', (0.0, 0.7, 0.0, 1.0, 0.76, 0.12)),
                                     ('box', '@tex/iron', (-0.03, 0.05, 0.0, 1.03, 0.95, 0.05))]),
    'onager_han': dict(actor='units/han/siege_mangonel.xml', anims=SIEGE, length=1.9),
    'onager_han_s': dict(actor='units/han/siege_mangonel.xml', anims=SIEGE, length=2.3),
    # скорпион без расчёта (DE — машина одна), тяжёлый — крупнее, со сталью
    'scorpio': dict(actor='units/romans/siege_scorpio.xml', anims=SIEGE, length=1.2,
                    override=NOCREW, extras=[('box', '@tex/player', (0.0, 0.45, 0.62, 1.0, 0.55, 0.72))]),
    'ballista': dict(actor='units/romans/siege_scorpio.xml', anims=SIEGE, length=1.5, seed=1,
                     override=NOCREW, extras=[('box', '@tex/player', (0.0, 0.45, 0.62, 1.0, 0.55, 0.72)),
                                              ('box', '@tex/steel', (0.05, 0.2, 0.55, 0.95, 0.3, 0.66)),
                                              ('box', '@tex/steel', (0.3, 0.0, 0.5, 0.7, 0.1, 0.62))]),
    'bombard': dict(actor='@bombard', anims=SIEGE, length=1.35),
    # требушет (R11): без лошадей в сложенном виде, крупнее ×1.65 (DE ≈ 3.3 роста пехотинца)
    'treb_packed': dict(actor='units/caro/siege_trebuchet_packed.xml', anims=CART, length=3.0,
                        override={'horse_l': None, 'horse_r': None},
                        extras=[('box', '@tex/player', (0.1, 0.35, 0.55, 0.9, 0.42, 0.8))]),
    'treb_up': dict(actor='units/caro/siege_trebuchet.xml', anims=SIEGE, length=3.3,
                    extras=[('box', '@tex/player', (0.3, 0.4, 0.3, 0.7, 0.6, 0.34))]),
    # животные
    'sheep': dict(actor='fauna/sheep1.xml', anims=ANIMAL['sheep'], scale=S_ANIMAL),
    'deer': dict(actor='fauna/deer.xml', anims=ANIMAL['deer'], scale=S_ANIMAL),
    'boar': dict(actor='fauna/boar.xml', anims=ANIMAL['boar'], scale=S_ANIMAL),
    'wolf': dict(actor='fauna/wolf.xml', anims=ANIMAL['wolf'], scale=S_ANIMAL),
}
# элитные уникальные юниты: базовый набор + отличительная деталь
for _n in ('axe_thrower', 'berserk', 'huskarl', 'teuton', 'woad', 'samurai', 'chukonu', 'longbow'):
    GLOBAL[_n + '_e'] = dict(GLOBAL[_n], override=dict(GLOBAL[_n].get('override') or {}, **ELITE_INF),
                             scale=GLOBAL[_n]['scale'] * 1.03)
for _n in ('mangudai', 'cataphract', 'mameluke'):
    GLOBAL[_n + '_e'] = dict(GLOBAL[_n], override=dict(GLOBAL[_n].get('override') or {}, **ELITE_CAV),
                             scale=GLOBAL[_n]['scale'] * 1.03)
GLOBAL['elephant_e'] = dict(GLOBAL['elephant'], scale=0.124,
                            override=dict(GLOBAL['elephant']['override'], **{'rider1>helmet': (PLUME[0], 1.8)}))
# корабли: набор по «морскому стилю» группы
SHIP_STYLE = {'caro': 'north', 'anglo': 'north', 'norse': 'north', 'rus': 'north', 'byz': 'med', 'umay': 'med',
              'han': 'han'}
_NS, _BS = 'structures/norse/', 'structures/byzantines/'
SHIPS = {
    # вид: {стиль: (актор, длина в клетках[, доработка из SHIP_X])}. R13: у каждого класса свой силуэт, как в DE —
    # рыбак — лодка с косым парусом, транспорт — под тентом, галера → дромон → высокий галеон, брандер с сифоном,
    # подрывные — лодки с бочками пороха
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
# доработки кораблей: правки дерева и доп. детали (доли габарита, см. extra_parts)
SHIP_X = {
    'guns': dict(override={'root+': ('@ship_cannons', (28.8, 18.0, 32.4))}),
    'lateen': dict(override={'sail': None},
                   extras=[('cyl_z', '@tex/wood', (0.47, 0.42, 0.0, 0.53, 0.46, 3.3)),
                           ('sail_lat', '@tex/linen', (0.5, -0.05, 0.45, 0.5, 0.9, 3.3)),
                           ('box', '@tex/player', (0.47, 0.44, 3.0, 0.53, 0.62, 3.3))]),
    'tent': dict(override={'root': None},
                 extras=[('tent', '@tex/linen', (0.12, 0.22, 0.45, 0.88, 0.8, 1.35)),
                         ('box', '@tex/player', (0.1, 0.48, 0.44, 0.9, 0.54, 1.37))]),
    'galleon': dict(extras=[('box', '@tex/wood', (0.25, 0.8, 0.06, 0.75, 0.98, 0.19)),       # кормовая надстройка
                            ('box', '@tex/wood', (0.3, 0.02, 0.06, 0.7, 0.14, 0.16)),         # носовая
                            ('cyl_z', '@tex/wood', (0.485, 0.2, 0.1, 0.515, 0.22, 0.8)),     # вторая мачта
                            ('box', '@tex/linen', (0.14, 0.2, 0.36, 0.86, 0.225, 0.74)),
                            ('box', '@tex/player', (0.14, 0.198, 0.5, 0.86, 0.228, 0.58))]),
    'barrels': dict(extras=[('barrels', '@tex/wood', (0.25, 0.25, 0.3, 0.75, 0.75, 0.8)),
                            ('box', '@tex/player', (0.47, 0.46, 0.3, 0.53, 0.54, 1.6))]),
    'siphon': dict(extras=[('siphon', '@tex/bronze', (0.4, -0.12, 0.4, 0.6, 0.25, 0.7)),
                           ('box', '@tex/red', (0.42, 0.05, 0.3, 0.58, 0.25, 0.55))]),
}
SHIP_ALIAS = {'fire_ship': 'fire_galley', 'fast_fire_ship': 'fire_galley'}

# вид юнита → роль (по группам) или глобальный набор; военные линии — RANKS (свой набор на каждый ранг)
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
# у некоторых групп своя модель для глобального вида (осада Хань)
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
    for folder in UGROUPS[group]:           # своя папка важнее порядка имён
        for n in names:
            p = f'units/{folder}/{n}.xml'
            if _actor_exists(p):
                return p
    return fb if fb and _actor_exists(fb) else None


def plan():
    """→ (sets: {имя: spec}, mapping: {вид: {группа юнитов: имя набора}})."""
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
    # всадник крупнее коня (как у DE: фигура всадника читается над головой коня)
    for sp in sets.values():
        if any(w in sp['actor'] for w in ('cavalry_', 'camelry_')):
            sp['prop_scale'] = dict(RIDER_K, **(sp.get('prop_scale') or {}))
    for k, v in SHIP_ALIAS.items():
        mapping[k] = mapping[v]
    for a in ('sheep', 'deer', 'boar', 'wolf'):
        sets[a] = dict(GLOBAL[a])
        mapping['animal_' + a] = {'*': a}
    return sets, mapping


# ---------------------------------------------------------------- модели для портретов и превью
_PLAN = None


def unit_spec(kind, group='caro', female=False):
    """(имя набора, описание) для вида юнита (как в игре: 'knight', 'villager', 'animal_sheep'…) и группы
    юнитов (UGROUPS: caro, anglo, norse, rus, byz, umay, han; '*' — любая)."""
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
    """Готовые детали модели юнита в позе: dict(parts — list[Part] в координатах модели (ед. 0 A.D., Z вверх,
    взгляд вдоль −Y), scale — клеток на единицу модели как в листах спрайтов, name, spec, place(d) — матрица
    размещения для направления d из 16, как у спрайтов). anim — наше имя анимации ('idle', 'walk', 'attack',
    'chop', …), frac — доля цикла 0..1. Для портретов: Renderer.build_items(parts, place) → Renderer.render."""
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
    """Один кадр как в листах (с R8): Sprite(rgba, mask, ox, oy). d — направление из 16 (3 — к зрителю)."""
    from tools.render3d import Renderer
    pp = posed_parts(kind, group, anim, frac, female)
    r = renderer or _renderer()
    return shoot(r, Renderer.build_items(pp['parts'], pp['place'](d)), pp['spec'])


# ---------------------------------------------------------------- рендер набора
_R = None


def _renderer():
    global _R
    if _R is None:
        from tools.render3d import Renderer
        _R = Renderer(ss=4, shadow_res=1024)
    return _R


def _measure_speed(tree, info, n=24):
    """Скорость «ног» в анимации ходьбы (ед. 0 A.D. за цикл): вершины у земли движутся назад со скоростью тела."""
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
    v = float(np.median(vs))            # за шаг кадра, вдоль +Y (назад)
    return max(0.0, v * n)


def _calm_sails(node, seed):
    """Паруса кораблей в пути: анимация 'move' у византийских и ханьских парусов 0 A.D./Millennium сворачивает
    полотнище в нашем рендере (кости не совпадают) — берём их лёгкое колыхание 'idle'; норманнские — как есть."""
    from tools.render3d import animactor as aa
    for _, ch, _ in node.props:
        if 'sail' in ch.actor and 'norse' not in ch.actor and ch.anim:
            idle = aa.build(ch.actor, 'idle', seed=seed)
            ch.anim = idle.anim if idle is not None and idle.anim else None
        _calm_sails(ch, seed)


def _head_top(items):
    """Высота верха головы над ногами (px экрана) по деталям-головам (props/units/heads/…); 0 — голов нет."""
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


# ---------------------------------------------------------------- доп. детали машин и кораблей (R10, R12, R13)
# spec['extras'] — [(форма, текстура, (fx0, fy0, fz0, fx1, fy1, fz1)), …]: коробка/цилиндр в долях габарита модели
# в позе покоя (x — ширина, y — длина, −y — нос/перёд, z — высота). Формы: 'box', 'cyl_y' (цилиндр вдоль длины),
# 'ram_head' (голова барана на конце бревна), 'tent' (полуцилиндр-тент вдоль длины), 'sail_lat' (косой парус),
# 'barrels' (бочки пороха рядами), 'siphon' (огнемётная труба).
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
    """Детали из spec['extras'] (в координатах модели) — добавляются к кадру после evaluate."""
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
    """Масштаб набора: задан (scale) или по длине модели в позе покоя (length, клеток)."""
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
    """Дерево ANode набора для анимации 0 A.D. a0 (с выборами вариантов sel)."""
    from tools.render3d import animactor as aa
    xsel = tuple(spec.get('sel') or ())
    return aa.build(spec['actor'], a0, sel=tuple(sel) + xsel, seed=spec.get('seed', 0),
                    override=spec.get('override'), skip=_skip(spec), paint=spec.get('paint'),
                    prop_scale=spec.get('prop_scale'))


# R8 (docs/research/06_units_recognition.md): DE светлее и спокойнее — яркость V ≈ 0.52, насыщенность ≈ 0.40,
# светлота ≈ 98, почти чёрных пикселей мало. Подъём теней (гамма) + множитель яркости + меньше насыщенности.
GRADE = dict(gamma=0.85, gain=1.0, sat=0.8)
GRADE_MACHINE = dict(gamma=0.88, gain=1.05, sat=0.9)      # машины и корабли (дерево): мягче


def grade(rgba, g=None):
    """R8: цветокоррекция кадра юнита (прямой альфа, тень — чёрная полупрозрачная — не трогается)."""
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
    # тень на земле — чёрные пиксели с неполной альфой: их не высветляем
    obj = body & ~((rgba[..., :3].max(-1) < 8) & (a < 250))
    out[..., :3] = np.where(obj[..., None], np.clip(rgb * 255.0 + 0.5, 0, 255).astype(np.uint8), rgba[..., :3])
    return out


def shoot(r, items, spec):
    """Кадр набора: рендер + R8 (для людей и зверей)."""
    spr = r.render(items, footprint=(0, 0), shadow_scale=0.85, pad=1)
    g = spec.get('grade') or (GRADE_MACHINE if spec.get('ship') or spec.get('length') else GRADE)
    spr.rgba = grade(spr.rgba, g)
    return spr


def render_set(name, spec, out=OUT, verbose=True):
    """Рендерит набор → файлы; возвращает запись индекса."""
    from tools.render3d import Renderer
    from tools.render3d import animactor as aa, procmesh
    r = _renderer()
    t0 = time.time()
    seed = spec.get('seed', 0)
    scale = spec_scale(spec)
    frames = []            # (Sprite, ...) по порядку: анимация → направление → кадр
    anims = {}
    height = 0
    body = 0               # верх головы (без шлема с гребнем, копий, знамён) — для полоски здоровья
    for (aname, a0, sel, n, mode) in spec['anims']:
        tree = spec_tree(spec, a0, sel)
        if tree is None:
            print('  ! нет актора', spec['actor'])
            return None
        if spec.get('ship') and aname == 'walk':
            _calm_sails(tree, seed)
        info = aa.anim_info(tree, _ACCEPT.get(a0, {a0}))
        found = info['name'] if info else None
        if info is None or found not in _ACCEPT.get(a0, {a0}):
            if spec.get('ship') and aname == 'walk':
                continue        # корабль без вёсел и парусов с анимацией — в пути тот же кадр, что в покое
            if aname in ('idle', 'walk') or aname.startswith('carry_'):
                n = 1           # нет анимации (машина, корабль) — один неподвижный кадр
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
            # шаг: сколько пикселей мира проходит юнит за цикл анимации
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
                    body = max(body, _head_top(items))
        anims[aname] = rec
    rects, sheet, mask = pack(frames)
    base = os.path.join(out, name)
    os.makedirs(out, exist_ok=True)
    # палитра 256 цветов (с прозрачностью) — в ~4 раза меньше RGBA при почти неотличимой картинке
    Image.fromarray(sheet).quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(
        base + '.png', optimize=True)
    has_mask = mask.max() > 8
    if has_mask:
        Image.fromarray(mask, 'L').save(base + '.m.png', optimize=True)
    rec = {'file': f'units/{name}.png', 'mask': f'units/{name}.m.png' if has_mask else None,
           'meta': f'units/{name}.json', 'anims': anims, 'h': int(height), 'scale': round(scale, 4),
           'bh': int(body) if body > 0 else int(height), 'dirs': NDIR,
           'actor': spec['actor']}
    # запись индекса и отпечаток описания рядом с кадрами: --resume пропускает уже собранное
    with open(base + '.json', 'w', encoding='utf-8') as f:
        json.dump({'frames': rects, 'rec': rec, 'spec': spec_hash(spec)}, f, separators=(',', ':'))
    if verbose:
        sz = os.path.getsize(base + '.png') + (os.path.getsize(base + '.m.png') if has_mask else 0)
        print(f'  + {name:28s} {len(frames):4d} кадров  {sheet.shape[1]}×{sheet.shape[0]}  '
              f'{sz / 1024:6.0f} КБ  {time.time() - t0:5.1f} с', flush=True)
    return rec


def spec_hash(spec):
    """Отпечаток описания набора (актор, правки, анимации, масштаб) — чтобы узнать, что лист уже собран."""
    import hashlib
    return hashlib.md5(json.dumps([spec, NDIR, RENDER_VER], sort_keys=True, default=str).encode()).hexdigest()[:16]


def _built(name, spec):
    """Запись индекса уже собранного набора с тем же описанием (или None)."""
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
    """Полочная упаковка кадров (в исходном порядке) → (rects [x, y, w, h, ax, ay], RGBA, маска L)."""
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


# ---------------------------------------------------------------- параллельная сборка
def _job(args):
    name, spec = args
    try:
        return name, render_set(name, spec)
    except Exception as e:           # один сломанный набор не валит сборку
        import traceback
        traceback.print_exc()
        print('  ! набор не собран:', name, type(e).__name__, e, flush=True)
        return name, None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--only', default='', help='имена наборов через запятую (остальные берутся из индекса)')
    ap.add_argument('--jobs', type=int, default=max(1, min(6, (os.cpu_count() or 2) - 2)))
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--resume', action='store_true', help='не пересобирать наборы, чьё описание не менялось')
    ap.add_argument('--sheets', default='', help='папка для контактных листов')
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
        print(f'уже собрано: {len(results)}, собрать: {len(rest)}')
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
    # лишние файлы от старых сборок
    keep = set()
    for v in index['sets'].values():
        keep |= {os.path.basename(v['file']), os.path.basename(v['meta'])}
        if v.get('mask'):
            keep.add(os.path.basename(v['mask']))
    for fn in os.listdir(OUT):
        if fn != 'index.json' and fn not in keep:
            os.remove(os.path.join(OUT, fn))
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print(f'готово: {len(index["sets"])} наборов, {total / 1e6:.1f} МБ, {time.time() - t0:.0f} с')
    if a.sheets:
        from tools.unit_sheet import main as sheet_main
        sheet_main(['--out', a.sheets])


if __name__ == '__main__':
    main()
