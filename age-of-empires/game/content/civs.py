"""Civilizations: bonuses (modifiers), team bonuses, the tech tree (unavailable items), starting differences,
bonuses per age, free techs, coats of arms, interface captions and AI preferences.

Values follow Definitive Edition (where a mechanic is missing - the closest approximation). Field format - data.py above CIVS.
Unique units and techs - civ_units.py; coat-of-arms graphics - game/civ_art.py; interface - game/civ_ui.py.

Bonus captions: 'bonus_icons' - [icon], an icon is: ('u', unit) | ('b', building) | ('t', tech) |
('r', resource); the texts come from the locale (civ.<key>.bonus1..., civ.<key>.team, civ.<key>.style, game/i18n.py assembles
'bonus' = [(icon, text)] and 'team_desc'). 'ai' - multipliers of the AI's unit choice weights by base line
(see ai_army.ArmyPlanner.weights).
"""
from ..data import CIVS, TECHS, WORLD_HOOKS, AGE_TECHS

KNIGHTS = ('knight', 'cavalier', 'paladin')
LIGHT = ('scout', 'light_cavalry', 'hussar')
STABLE = LIGHT + KNIGHTS + ('camel_rider', 'heavy_camel_rider')
RANGE = ('archer', 'crossbowman', 'arbalester', 'skirmisher', 'elite_skirmisher', 'cavalry_archer',
         'heavy_cavalry_archer', 'hand_cannoneer')
BARRACKS = ('militia', 'man_at_arms', 'long_swordsman', 'two_handed_swordsman', 'champion', 'spearman', 'pikeman',
            'halberdier', 'huskarl', 'elite_huskarl')
WORKSHOP = ('ram', 'capped_ram', 'siege_ram', 'mangonel', 'onager', 'siege_onager', 'scorpion', 'heavy_scorpion',
            'bombard_cannon')
TC_WORK = ('villager', 'loom', 'wheelbarrow', 'hand_cart', 'town_watch', 'town_patrol') + AGE_TECHS
DOCK_WORK = ('fishing_ship', 'transport_ship', 'galley', 'war_galley', 'galleon', 'fire_galley', 'fire_ship',
             'fast_fire_ship', 'demolition_ship', 'heavy_demolition_ship', 'cannon_galleon', 'gillnets',
             'careening', 'dry_dock', 'shipwright')
WARSHIPS = ('galley', 'war_galley', 'galleon', 'fire_galley', 'fire_ship', 'fast_fire_ship', 'demolition_ship',
            'heavy_demolition_ship', 'cannon_galleon')
SMITH = ('forging', 'iron_casting', 'blast_furnace', 'fletching', 'bodkin_arrow', 'bracer', 'scale_armor',
         'chain_mail', 'plate_mail', 'scale_barding', 'chain_barding', 'plate_barding', 'padded_archer_armor',
         'leather_archer_armor', 'ring_archer_armor')
COUNTERS = ('spearman', 'pikeman', 'halberdier', 'skirmisher', 'elite_skirmisher', 'camel_rider', 'heavy_camel_rider')
FOOT_ARCH = {'cls': 'foot_arch'}
INF = {'cls': 'inf'}


def E(stat, **kw):
    kw['stat'] = stat
    return kw


def step(stat, levels, **f):
    """A "per age" bonus from the final multipliers levels = {age: total}: each age adds the ratio
    to the previous level (effects only accumulate). Returns (effects from the start, {age: [effects]})."""
    start, ages, prev = [], {}, 1.0
    for age in sorted(levels):
        m = levels[age] / prev
        prev = levels[age]
        e = E(stat, mul=m, **f)
        if age == 0:
            start.append(e)
        else:
            ages.setdefault(age, []).append(e)
    return start, ages


def merge(*dicts):
    out = {}
    for d in dicts:
        for k, v in d.items():
            out.setdefault(k, []).extend(v)
    return out


def civ(key, emblem, effects, team, bonus_icons, team_icon, disabled=(), ai=None, **extra):
    CIVS[key] = dict(emblem=emblem, effects=effects, team=team, bonus_icons=bonus_icons, team_icon=team_icon,
                     disabled=tuple(disabled), ai=ai or {}, **extra)


GOLD, SILVER, BLACK = (240, 205, 80), (236, 234, 226), (30, 28, 30)

# ---- Franks: cavalry
civ('franks', dict(field=((38, 72, 168), (38, 72, 168)), charge='lily3', metal=GOLD),
    effects=[E('cost', kind='castle', mul=0.85),
             E('cost', kind=('horse_collar', 'heavy_plow', 'crop_rotation'), mul=0),
             E('gather', src='berries', mul=1.15),
             E('hp', cls='cav', not_cls=('arch',), mul=1.2)],
    team=[E('los', kind=KNIGHTS, add=2)],
    bonus_icons=[('u', 'knight'), ('b', 'castle'),
           ('t', 'heavy_plow'), ('r', 'food')],
    team_icon=('u', 'knight'),
    disabled=('arbalester', 'thumb_ring', 'parthian_tactics', 'camel_rider', 'heavy_camel_rider'),
    ai={'knight': 1.9, 'scout': 1.2, 'archer': 0.6, 'cavalry_archer': 0.6, 'throwing_axeman': 2.2})

# ---- Britons: archers
civ('britons', dict(field=((190, 30, 36), (190, 30, 36)), div='bordure', charge='crown', metal=GOLD),
    effects=[E('gather', src='hunt', mul=1.25)],
    ages={2: [E('rng', cls='foot_arch', not_cls=('gunpowder',), add=1),
              E('cost', kind='town_center', res='wood', mul=0.5)],
          3: [E('rng', cls='foot_arch', not_cls=('gunpowder',), add=1)]},
    team=[E('time', kind=RANGE + ('longbowman', 'elite_longbowman'), mul=1 / 1.2)],
    bonus_icons=[('u', 'archer'), ('b', 'town_center'),
           ('r', 'food')],
    team_icon=('b', 'archery_range'),
    disabled=('paladin', 'camel_rider', 'heavy_camel_rider', 'bombard_cannon', 'parthian_tactics'),
    ai={'archer': 2.2, 'skirmisher': 1.0, 'knight': 0.6, 'cavalry_archer': 0.4, 'longbowman': 3.0})

# ---- Mongols: cavalry archers
civ('mongols', dict(field=((70, 132, 205), (70, 132, 205)), div='chief', charge='bow', metal=GOLD),
    effects=[E('reload', cls='cav_arch', mul=1 / 1.25),
             E('hp', kind=('light_cavalry', 'hussar'), mul=1.3),
             E('gather', src='hunt', mul=1.4)],
    team=[E('los', kind=LIGHT, add=2)],
    bonus_icons=[('u', 'cavalry_archer'),
           ('u', 'light_cavalry'), ('r', 'food')],
    team_icon=('u', 'scout'),
    disabled=('paladin', 'halberdier', 'keep', 'bombard_cannon'),
    ai={'cavalry_archer': 3.0, 'scout': 1.6, 'archer': 0.6, 'mangonel': 1.5, 'militia': 0.5, 'mangudai': 3.2})

# ---- Byzantines: defense and counter units
_s, _a = step('hp', {0: 1.1, 1: 1.2, 2: 1.3, 3: 1.4}, cls='bld')
civ('byzantines', dict(field=((104, 36, 110), (104, 36, 110)), charge='eagle2', metal=GOLD),
    effects=_s + [E('cost', kind=COUNTERS, mul=0.75), E('cost', kind='imperial', mul=0.67),
                  E('atk', kind=('fire_galley', 'fire_ship', 'fast_fire_ship'), mul=1.2)],
    ages=_a, refresh_hp=True,
    team=[E('heal', kind='monk', mul=2)],
    bonus_icons=[('b', 'castle'), ('u', 'spearman'),
           ('t', 'imperial')],
    team_icon=('u', 'monk'),
    disabled=('blast_furnace', 'siege_onager', 'parthian_tactics'),
    ai={'spearman': 1.7, 'skirmisher': 1.7, 'camel_rider': 1.7, 'knight': 0.8, 'monk': 1.5, 'cataphract': 3.0})

# ---- Teutons: infantry and armor
civ('teutons', dict(field=((238, 236, 228), (238, 236, 228)), charge='cross', metal=BLACK),
    effects=[E('cost', kind='farm', mul=0.6), E('cost', kind='murder_holes', mul=0)],
    ages={2: [E('arm_m', cls=('inf', 'cav'), not_cls=('arch',), add=1)],
          3: [E('arm_m', cls=('inf', 'cav'), not_cls=('arch',), add=1)]},
    team=[E('conv_resist', mul=1.5)],
    bonus_icons=[('b', 'farm'), ('u', 'long_swordsman'),
           ('t', 'murder_holes')],
    team_icon=('u', 'monk'),
    disabled=('hussar', 'thumb_ring', 'parthian_tactics', 'camel_rider', 'heavy_camel_rider', 'husbandry',
              'heavy_cavalry_archer'),
    ai={'militia': 1.7, 'knight': 1.3, 'spearman': 1.2, 'archer': 0.6, 'cavalry_archer': 0.3, 'scout': 0.6,
        'teutonic_knight': 3.0})

# ---- Japanese: infantry
civ('japanese', dict(field=((238, 236, 228), (238, 236, 228)), charge='mon', metal=(200, 30, 40)),
    effects=[E('cost', kind=('mill', 'lumber_camp', 'mining_camp'), mul=0.5),
             E('hp', kind='fishing_ship', mul=2), E('arm_p', kind='fishing_ship', add=2)],
    ages={1: [E('reload', cls='inf', mul=1 / 1.33)]},
    team=[E('los', kind=('galley', 'war_galley', 'galleon'), mul=1.5)],
    bonus_icons=[('u', 'man_at_arms'), ('b', 'lumber_camp'),
           ('u', 'fishing_ship')],
    team_icon=('u', 'galley'),
    disabled=('hussar', 'paladin', 'camel_rider', 'heavy_camel_rider', 'siege_ram'),
    ai={'militia': 1.5, 'archer': 1.7, 'knight': 0.7, 'samurai': 2.6})

# ---- Chinese: ranged units and techs
_s, _a = step('cost', {1: 0.9, 2: 0.85, 3: 0.8}, cls='tech')
civ('chinese', dict(field=((200, 36, 30), (200, 36, 30)), charge='dragon', metal=GOLD),
    effects=[E('hp', kind=('demolition_ship', 'heavy_demolition_ship'), mul=1.5)],
    ages=_a, start={'food': -200, 'wood': -50}, start_units={'villager': 3}, pop_extra={'town_center': 10},
    team=[E('farm_food', mul=1.1)],
    bonus_icons=[('u', 'villager'), ('t', 'feudal'),
           ('b', 'town_center')],
    team_icon=('b', 'farm'),
    disabled=('paladin', 'heavy_camel_rider', 'bombard_cannon', 'plate_barding'),
    ai={'archer': 1.8, 'skirmisher': 1.3, 'scorpion': 1.5, 'chu_ko_nu': 3.0})

# ---- Persians: economy and cavalry
_s, _a = step('time', {1: 1 / 1.10, 2: 1 / 1.15, 3: 1 / 1.20}, kind=TC_WORK + DOCK_WORK)
civ('persians', dict(field=((34, 118, 70), (225, 185, 70)), div='fess', charge='sun', metal=GOLD),
    effects=[E('hp', kind=('town_center', 'dock'), mul=2)],
    ages=_a, start={'food': 50, 'wood': 50},
    team=[E('bonus:arch', kind=KNIGHTS, add=2)],
    bonus_icons=[('r', 'wood'), ('b', 'town_center'),
           ('u', 'villager')],
    team_icon=('u', 'knight'),
    disabled=('champion', 'siege_onager', 'siege_ram', 'plate_mail', 'keep'),
    ai={'knight': 1.9, 'camel_rider': 1.2, 'scout': 1.2, 'militia': 0.5, 'war_elephant': 2.4})

# ---- Saracens: camels and the market
civ('saracens', dict(field=((30, 110, 60), (30, 110, 60)), charge='swords', metal=SILVER),
    effects=[E('market_fee', add=-0.25), E('hp', cls='camel', add=10),
             E('reload', kind=('galley', 'war_galley', 'galleon'), mul=0.8)],
    team=[E('bonus:bld', cls='foot_arch', add=2)],
    bonus_icons=[('b', 'market'), ('u', 'camel_rider'),
           ('u', 'galley')],
    team_icon=('u', 'archer'),
    disabled=('paladin', 'halberdier', 'plate_barding'),
    ai={'camel_rider': 2.2, 'archer': 1.5, 'knight': 0.8, 'monk': 1.3, 'mameluke': 2.6})

# ---- Turks: gunpowder
civ('turks', dict(field=((196, 28, 36), (196, 28, 36)), charge='crescent_star', metal=SILVER),
    effects=[E('hp', cls='gunpowder', mul=1.25), E('gather', src='gold', mul=1.2),
             E('cost', kind=('light_cavalry', 'hussar'), mul=0)],
    free={3: ['chemistry']},
    team=[E('time', cls='gunpowder', mul=0.8)],
    bonus_icons=[('u', 'hand_cannoneer'), ('r', 'gold'),
           ('t', 'chemistry'), ('u', 'hussar')],
    team_icon=('u', 'hand_cannoneer'),
    disabled=('pikeman', 'halberdier', 'elite_skirmisher', 'arbalester', 'paladin'),
    ai={'hand_cannoneer': 2.6, 'scout': 1.5, 'cavalry_archer': 1.3, 'bombard_cannon': 2.0, 'spearman': 0.2,
        'skirmisher': 0.3, 'archer': 0.7, 'janissary': 3.0})

# ---- Vikings: infantry and navy
_s, _a = step('hp', {1: 1.1, 2: 1.15, 3: 1.2}, cls='inf')
civ('vikings', dict(field=((232, 190, 60), (232, 190, 60)), div='bend', charge='raven', metal=BLACK),
    effects=[E('cost', kind=WARSHIPS, mul=0.85)],
    ages=_a, refresh_hp=True, free={1: ['wheelbarrow'], 2: ['hand_cart']},
    team=[E('cost', kind='dock', mul=0.85)],
    bonus_icons=[('u', 'militia'), ('t', 'wheelbarrow'),
           ('u', 'galley')],
    team_icon=('b', 'dock'),
    disabled=('paladin', 'hussar', 'camel_rider', 'heavy_camel_rider', 'fire_galley', 'fire_ship', 'fast_fire_ship'),
    ai={'militia': 2.0, 'spearman': 1.2, 'archer': 1.0, 'knight': 0.6, 'berserk': 2.6})

# ---- Goths: infantry hordes
_s, _a = step('cost', {0: 0.8, 1: 0.75, 2: 0.7, 3: 0.65}, cls='inf')
civ('goths', dict(field=((34, 32, 38), (34, 32, 38)), charge='eagle', metal=GOLD),
    effects=_s + [E('bonus:bld', cls='inf', add=1)],
    ages=_a, pop_bonus={3: 10}, banned_at=(('barracks', 'huskarl'),),
    team=[E('time', kind=BARRACKS, mul=1 / 1.2)],
    bonus_icons=[('u', 'militia'), ('b', 'castle'),
           ('b', 'house')],
    team_icon=('b', 'barracks'),
    disabled=('plate_mail', 'guard_tower', 'keep', 'siege_onager', 'ring_archer_armor'),
    ai={'militia': 2.6, 'spearman': 1.6, 'skirmisher': 1.2, 'archer': 0.5, 'knight': 0.5, 'huskarl': 3.0})

# ---- Celts: infantry and siege
civ('celts', dict(field=((40, 120, 60), (40, 120, 60)), div='bordure', charge='triskele', metal=SILVER),
    effects=[E('gather', src='tree', mul=1.15), E('reload', cls='siege', not_cls=('ship',), mul=0.8)],
    ages={1: [E('speed', cls='inf', mul=1.15)]},
    team=[E('time', kind=WORKSHOP, mul=1 / 1.2)],
    bonus_icons=[('u', 'militia'), ('r', 'wood'),
           ('u', 'mangonel')],
    team_icon=('b', 'siege_workshop'),
    disabled=('heavy_cavalry_archer', 'camel_rider', 'heavy_camel_rider', 'hand_cannoneer', 'arbalester',
              'thumb_ring'),
    ai={'militia': 2.2, 'spearman': 1.3, 'mangonel': 2.0, 'ram': 1.5, 'archer': 0.5, 'woad_raider': 2.6})

# ---- Spanish: builders and gunpowder
civ('spanish', dict(field=((225, 185, 60), (190, 30, 36)), div='quarterly', charge='tower',
                               metal=(236, 234, 226)),
    effects=[E('build', kind='villager', mul=1.3), E('cost', kind=SMITH, res='gold', mul=0),
             E('reload', cls='gunpowder', mul=1 / 1.18)],
    team=[E('trade', mul=1.25)],
    bonus_icons=[('u', 'villager'), ('b', 'blacksmith'),
           ('u', 'hand_cannoneer')],
    team_icon=('u', 'trade_cart'),
    disabled=('camel_rider', 'heavy_camel_rider', 'heavy_cavalry_archer', 'parthian_tactics', 'siege_onager'),
    ai={'knight': 1.7, 'hand_cannoneer': 1.5, 'militia': 1.2, 'conquistador': 2.6})

PLAYABLE = [k for k in CIVS if k != 'default']


# ============================================================ mechanics
def team_bonus(w):
    """Team bonuses - for all allies (and yourself); identical civilizations in a team do not stack.
    A civilization's starting units are placed at the town center."""
    from ..world import Unit
    from ..data import TILE
    for p in w.players:
        civs = {q.civ for q in w.players if w.allied(p.id, q.id)}
        for c in sorted(civs):
            p.add_effects(CIVS.get(c, {}).get('team', []))
        w.refresh_hp(p)
        extra = CIVS.get(p.civ, {}).get('start_units', {})
        if extra:
            tc = next((b for b in w.buildings if b.owner == p.id and b.kind == 'town_center'), None)
            if tc is None:
                continue
            cx, cy = tc.tx + tc.w // 2, tc.ty + tc.h // 2
            for kind, n in extra.items():
                for i in range(n):
                    tx, ty = w.nearest_free_tile(cx + (i % 3) - 1, cy + tc.h // 2 + 1 + i // 3)
                    w.units.append(Unit(kind, p.id, (tx + 0.5) * TILE, (ty + 0.5) * TILE, w))


WORLD_HOOKS['init'].append(team_bonus)


def on_age(w, p):
    """A new age: this age's effects, free techs, a population increase."""
    c = CIVS.get(p.civ, {})
    eff = c.get('ages', {}).get(p.age)
    if eff:
        p.add_effects(eff)
        if c.get('refresh_hp') or any(e['stat'] == 'hp' for e in eff):
            w.refresh_hp(p)
    p.pop_bonus += c.get('pop_bonus', {}).get(p.age, 0)
    for t in c.get('free', {}).get(p.age, ()):
        if t in TECHS and t not in p.techs and p.allows(t):
            for b in w.buildings:          # already in the queue - refund the cost
                if b.owner == p.id and ('tech', t) in b.queue:
                    if b.queue[0] == ('tech', t):
                        b.qt = 0.0
                    b.queue.remove(('tech', t))
                    p.refund(p.cost_of('tech', t))
            p.researching.discard(t)
            w.apply_tech(p, t)


def _chain(prev):
    def f(w, p):
        if prev:
            prev(w, p)
        on_age(w, p)
    return f


for _t in AGE_TECHS:
    TECHS[_t]['on_apply'] = _chain(TECHS[_t].get('on_apply'))
