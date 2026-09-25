"""Цивилизации: бонусы (модификаторы), командные бонусы, дерево технологий (недоступное), стартовые отличия,
бонусы по эпохам, бесплатные технологии, гербы, подписи для интерфейса и предпочтения ИИ.

Значения — по Definitive Edition (где механики нет — ближайшее приближение). Формат полей — data.py над CIVS.
Уникальные юниты и технологии — civ_units.py; графика гербов — game/civ_art.py; интерфейс — game/civ_ui.py.

Подписи бонусов: 'bonus' — [(значок, текст)], значок: ('u', юнит) | ('b', здание) | ('t', технология) |
('r', ресурс). 'ai' — множители весов выбора юнитов ИИ по базовой линии (см. ai_army.ArmyPlanner.weights).
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
    """Бонус «по эпохам» из итоговых множителей levels = {эпоха: итог}: каждая эпоха добавляет отношение
    к предыдущему уровню (эффекты только копятся). Возвращает (эффекты с начала, {эпоха: [эффекты]})."""
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


def civ(key, name, emblem, style, effects, team, bonus, team_desc, disabled=(), ai=None, **extra):
    CIVS[key] = dict(name=name, emblem=emblem, style=style, effects=effects, team=team, bonus=bonus,
                     team_desc=team_desc, disabled=tuple(disabled), ai=ai or {}, **extra)


GOLD, SILVER, BLACK = (240, 205, 80), (236, 234, 226), (30, 28, 30)

# ---- Франки: конница
civ('franks', 'Франки', dict(field=((38, 72, 168), (38, 72, 168)), charge='lily3', metal=GOLD), 'Конница',
    effects=[E('cost', kind='castle', mul=0.85),
             E('cost', kind=('horse_collar', 'heavy_plow', 'crop_rotation'), mul=0),
             E('gather', src='berries', mul=1.15),
             E('hp', cls='cav', not_cls=('arch',), mul=1.2)],
    team=[E('los', kind=KNIGHTS, add=2)],
    bonus=[(('u', 'knight'), 'Конница +20% ОЗ'), (('b', 'castle'), 'Замки −15%'),
           (('t', 'heavy_plow'), 'Улучшения ферм даром'), (('r', 'food'), 'Ягоды +15%')],
    team_desc=(('u', 'knight'), 'Рыцари +2 обзор'),
    disabled=('arbalester', 'thumb_ring', 'parthian_tactics', 'camel_rider', 'heavy_camel_rider'),
    ai={'knight': 1.9, 'scout': 1.2, 'archer': 0.6, 'cavalry_archer': 0.6, 'throwing_axeman': 2.2})

# ---- Британцы: лучники
civ('britons', 'Британцы', dict(field=((190, 30, 36), (190, 30, 36)), div='bordure', charge='crown', metal=GOLD),
    'Лучники',
    effects=[E('gather', src='hunt', mul=1.25)],
    ages={2: [E('rng', cls='foot_arch', not_cls=('gunpowder',), add=1),
              E('cost', kind='town_center', res='wood', mul=0.5)],
          3: [E('rng', cls='foot_arch', not_cls=('gunpowder',), add=1)]},
    team=[E('time', kind=RANGE + ('longbowman', 'elite_longbowman'), mul=1 / 1.2)],
    bonus=[(('u', 'archer'), 'Лучники +1/+2 дальность (III/IV)'), (('b', 'town_center'), 'Центр −50% дерева (III)'),
           (('r', 'food'), 'Охота и овцы +25%')],
    team_desc=(('b', 'archery_range'), 'Стрельбище +20% быстрее'),
    disabled=('paladin', 'camel_rider', 'heavy_camel_rider', 'bombard_cannon', 'parthian_tactics'),
    ai={'archer': 2.2, 'skirmisher': 1.0, 'knight': 0.6, 'cavalry_archer': 0.4, 'longbowman': 3.0})

# ---- Монголы: конные лучники
civ('mongols', 'Монголы', dict(field=((70, 132, 205), (70, 132, 205)), div='chief', charge='bow', metal=GOLD),
    'Конные лучники',
    effects=[E('reload', cls='cav_arch', mul=1 / 1.25),
             E('hp', kind=('light_cavalry', 'hussar'), mul=1.3),
             E('gather', src='hunt', mul=1.4)],
    team=[E('los', kind=LIGHT, add=2)],
    bonus=[(('u', 'cavalry_archer'), 'Конные лучники +25% скорострельность'),
           (('u', 'light_cavalry'), 'Лёгкая конница +30% ОЗ'), (('r', 'food'), 'Охота +40%')],
    team_desc=(('u', 'scout'), 'Разведчики +2 обзор'),
    disabled=('paladin', 'halberdier', 'keep', 'bombard_cannon'),
    ai={'cavalry_archer': 3.0, 'scout': 1.6, 'archer': 0.6, 'mangonel': 1.5, 'militia': 0.5, 'mangudai': 3.2})

# ---- Византийцы: оборона и контр-юниты
_s, _a = step('hp', {0: 1.1, 1: 1.2, 2: 1.3, 3: 1.4}, cls='bld')
civ('byzantines', 'Византийцы', dict(field=((104, 36, 110), (104, 36, 110)), charge='eagle2', metal=GOLD),
    'Оборона',
    effects=_s + [E('cost', kind=COUNTERS, mul=0.75), E('cost', kind='imperial', mul=0.67),
                  E('atk', kind=('fire_galley', 'fire_ship', 'fast_fire_ship'), mul=1.2)],
    ages=_a, refresh_hp=True,
    team=[E('heal', kind='monk', mul=2)],
    bonus=[(('b', 'castle'), 'Здания +10…40% ОЗ по эпохам'), (('u', 'spearman'), 'Копейщики, застрельщики, верблюды −25%'),
           (('t', 'imperial'), 'Имперская эпоха −33%')],
    team_desc=(('u', 'monk'), 'Монахи лечат ×2'),
    disabled=('blast_furnace', 'siege_onager', 'parthian_tactics'),
    ai={'spearman': 1.7, 'skirmisher': 1.7, 'camel_rider': 1.7, 'knight': 0.8, 'monk': 1.5, 'cataphract': 3.0})

# ---- Тевтоны: пехота и броня
civ('teutons', 'Тевтоны', dict(field=((238, 236, 228), (238, 236, 228)), charge='cross', metal=BLACK), 'Пехота',
    effects=[E('cost', kind='farm', mul=0.6), E('cost', kind='murder_holes', mul=0)],
    ages={2: [E('arm_m', cls=('inf', 'cav'), not_cls=('arch',), add=1)],
          3: [E('arm_m', cls=('inf', 'cav'), not_cls=('arch',), add=1)]},
    team=[E('conv_resist', mul=1.5)],
    bonus=[(('b', 'farm'), 'Фермы −40%'), (('u', 'long_swordsman'), 'Пехота и конница +1/+2 ближн. броня (III/IV)'),
           (('t', 'murder_holes'), 'Бойницы даром')],
    team_desc=(('u', 'monk'), 'Войска труднее обратить'),
    disabled=('hussar', 'thumb_ring', 'parthian_tactics', 'camel_rider', 'heavy_camel_rider', 'husbandry',
              'heavy_cavalry_archer'),
    ai={'militia': 1.7, 'knight': 1.3, 'spearman': 1.2, 'archer': 0.6, 'cavalry_archer': 0.3, 'scout': 0.6,
        'teutonic_knight': 3.0})

# ---- Японцы: пехота
civ('japanese', 'Японцы', dict(field=((238, 236, 228), (238, 236, 228)), charge='mon', metal=(200, 30, 40)),
    'Пехота',
    effects=[E('cost', kind=('mill', 'lumber_camp', 'mining_camp'), mul=0.5),
             E('hp', kind='fishing_ship', mul=2), E('arm_p', kind='fishing_ship', add=2)],
    ages={1: [E('reload', cls='inf', mul=1 / 1.33)]},
    team=[E('los', kind=('galley', 'war_galley', 'galleon'), mul=1.5)],
    bonus=[(('u', 'man_at_arms'), 'Пехота бьёт на 33% быстрее (II)'), (('b', 'lumber_camp'), 'Склады −50%'),
           (('u', 'fishing_ship'), 'Рыбаки ×2 ОЗ')],
    team_desc=(('u', 'galley'), 'Галеры +50% обзор'),
    disabled=('hussar', 'paladin', 'camel_rider', 'heavy_camel_rider', 'siege_ram'),
    ai={'militia': 1.5, 'archer': 1.7, 'knight': 0.7, 'samurai': 2.6})

# ---- Китайцы: стрелки и технологии
_s, _a = step('cost', {1: 0.9, 2: 0.85, 3: 0.8}, cls='tech')
civ('chinese', 'Китайцы', dict(field=((200, 36, 30), (200, 36, 30)), charge='dragon', metal=GOLD), 'Стрелки',
    effects=[E('hp', kind=('demolition_ship', 'heavy_demolition_ship'), mul=1.5)],
    ages=_a, start={'food': -200, 'wood': -50}, start_units={'villager': 3}, pop_extra={'town_center': 10},
    team=[E('farm_food', mul=1.1)],
    bonus=[(('u', 'villager'), '+3 жителя, −200 еды −50 дерева'), (('t', 'feudal'), 'Технологии −10/15/20%'),
           (('b', 'town_center'), 'Центр +10 населения')],
    team_desc=(('b', 'farm'), 'Фермы +10% еды'),
    disabled=('paladin', 'heavy_camel_rider', 'bombard_cannon', 'plate_barding'),
    ai={'archer': 1.8, 'skirmisher': 1.3, 'scorpion': 1.5, 'chu_ko_nu': 3.0})

# ---- Персы: экономика и конница
_s, _a = step('time', {1: 1 / 1.10, 2: 1 / 1.15, 3: 1 / 1.20}, kind=TC_WORK + DOCK_WORK)
civ('persians', 'Персы', dict(field=((34, 118, 70), (225, 185, 70)), div='fess', charge='sun', metal=GOLD),
    'Конница',
    effects=[E('hp', kind=('town_center', 'dock'), mul=2)],
    ages=_a, start={'food': 50, 'wood': 50},
    team=[E('bonus:arch', kind=KNIGHTS, add=2)],
    bonus=[(('r', 'wood'), '+50 еды, +50 дерева'), (('b', 'town_center'), 'Центр и док ×2 ОЗ'),
           (('u', 'villager'), 'Центр и док +10/15/20% быстрее')],
    team_desc=(('u', 'knight'), 'Рыцари +2 против стрелков'),
    disabled=('champion', 'siege_onager', 'siege_ram', 'plate_mail', 'keep'),
    ai={'knight': 1.9, 'camel_rider': 1.2, 'scout': 1.2, 'militia': 0.5, 'war_elephant': 2.4})

# ---- Сарацины: верблюды и рынок
civ('saracens', 'Сарацины', dict(field=((30, 110, 60), (30, 110, 60)), charge='swords', metal=SILVER),
    'Верблюды',
    effects=[E('market_fee', add=-0.25), E('hp', cls='camel', add=10),
             E('reload', kind=('galley', 'war_galley', 'galleon'), mul=0.8)],
    team=[E('bonus:bld', cls='foot_arch', add=2)],
    bonus=[(('b', 'market'), 'Сбор рынка 5%'), (('u', 'camel_rider'), 'Верблюды +10 ОЗ'),
           (('u', 'galley'), 'Галеры +25% скорострельность')],
    team_desc=(('u', 'archer'), 'Лучники +2 против зданий'),
    disabled=('paladin', 'halberdier', 'plate_barding'),
    ai={'camel_rider': 2.2, 'archer': 1.5, 'knight': 0.8, 'monk': 1.3, 'mameluke': 2.6})

# ---- Турки: порох
civ('turks', 'Турки', dict(field=((196, 28, 36), (196, 28, 36)), charge='crescent_star', metal=SILVER), 'Порох',
    effects=[E('hp', cls='gunpowder', mul=1.25), E('gather', src='gold', mul=1.2),
             E('cost', kind=('light_cavalry', 'hussar'), mul=0)],
    free={3: ['chemistry']},
    team=[E('time', cls='gunpowder', mul=0.8)],
    bonus=[(('u', 'hand_cannoneer'), 'Порох +25% ОЗ'), (('r', 'gold'), 'Золото +20%'),
           (('t', 'chemistry'), 'Химия даром (IV)'), (('u', 'hussar'), 'Лёгкая конница даром')],
    team_desc=(('u', 'hand_cannoneer'), 'Порох обучается на 25% быстрее'),
    disabled=('pikeman', 'halberdier', 'elite_skirmisher', 'arbalester', 'paladin'),
    ai={'hand_cannoneer': 2.6, 'scout': 1.5, 'cavalry_archer': 1.3, 'bombard_cannon': 2.0, 'spearman': 0.2,
        'skirmisher': 0.3, 'archer': 0.7, 'janissary': 3.0})

# ---- Викинги: пехота и флот
_s, _a = step('hp', {1: 1.1, 2: 1.15, 3: 1.2}, cls='inf')
civ('vikings', 'Викинги', dict(field=((232, 190, 60), (232, 190, 60)), div='bend', charge='raven', metal=BLACK),
    'Пехота',
    effects=[E('cost', kind=WARSHIPS, mul=0.85)],
    ages=_a, refresh_hp=True, free={1: ['wheelbarrow'], 2: ['hand_cart']},
    team=[E('cost', kind='dock', mul=0.85)],
    bonus=[(('u', 'militia'), 'Пехота +10/15/20% ОЗ'), (('t', 'wheelbarrow'), 'Тачка и тележка даром'),
           (('u', 'galley'), 'Боевые корабли −15%')],
    team_desc=(('b', 'dock'), 'Доки −15%'),
    disabled=('paladin', 'hussar', 'camel_rider', 'heavy_camel_rider', 'fire_galley', 'fire_ship', 'fast_fire_ship'),
    ai={'militia': 2.0, 'spearman': 1.2, 'archer': 1.0, 'knight': 0.6, 'berserk': 2.6})

# ---- Готы: орды пехоты
_s, _a = step('cost', {0: 0.8, 1: 0.75, 2: 0.7, 3: 0.65}, cls='inf')
civ('goths', 'Готы', dict(field=((34, 32, 38), (34, 32, 38)), charge='eagle', metal=GOLD), 'Пехота',
    effects=_s + [E('bonus:bld', cls='inf', add=1)],
    ages=_a, pop_bonus={3: 10}, banned_at=(('barracks', 'huskarl'),),
    team=[E('time', kind=BARRACKS, mul=1 / 1.2)],
    bonus=[(('u', 'militia'), 'Пехота −20…35% по эпохам'), (('b', 'castle'), 'Пехота +1 против зданий'),
           (('b', 'house'), '+10 населения (IV)')],
    team_desc=(('b', 'barracks'), 'Казармы +20% быстрее'),
    disabled=('plate_mail', 'guard_tower', 'keep', 'siege_onager', 'ring_archer_armor'),
    ai={'militia': 2.6, 'spearman': 1.6, 'skirmisher': 1.2, 'archer': 0.5, 'knight': 0.5, 'huskarl': 3.0})

# ---- Кельты: пехота и осада
civ('celts', 'Кельты', dict(field=((40, 120, 60), (40, 120, 60)), div='bordure', charge='triskele', metal=SILVER),
    'Осада',
    effects=[E('gather', src='tree', mul=1.15), E('reload', cls='siege', not_cls=('ship',), mul=0.8)],
    ages={1: [E('speed', cls='inf', mul=1.15)]},
    team=[E('time', kind=WORKSHOP, mul=1 / 1.2)],
    bonus=[(('u', 'militia'), 'Пехота +15% скорость (II)'), (('r', 'wood'), 'Лесорубы +15%'),
           (('u', 'mangonel'), 'Осада стреляет на 25% быстрее')],
    team_desc=(('b', 'siege_workshop'), 'Мастерская +20% быстрее'),
    disabled=('heavy_cavalry_archer', 'camel_rider', 'heavy_camel_rider', 'hand_cannoneer', 'arbalester',
              'thumb_ring'),
    ai={'militia': 2.2, 'spearman': 1.3, 'mangonel': 2.0, 'ram': 1.5, 'archer': 0.5, 'woad_raider': 2.6})

# ---- Испанцы: строители и порох
civ('spanish', 'Испанцы', dict(field=((225, 185, 60), (190, 30, 36)), div='quarterly', charge='tower',
                               metal=(236, 234, 226)), 'Порох',
    effects=[E('build', kind='villager', mul=1.3), E('cost', kind=SMITH, res='gold', mul=0),
             E('reload', cls='gunpowder', mul=1 / 1.18)],
    team=[E('trade', mul=1.25)],
    bonus=[(('u', 'villager'), 'Стройка +30%'), (('b', 'blacksmith'), 'Кузница без золота'),
           (('u', 'hand_cannoneer'), 'Порох +18% скорострельность')],
    team_desc=(('u', 'trade_cart'), 'Торговля +25% золота'),
    disabled=('camel_rider', 'heavy_camel_rider', 'heavy_cavalry_archer', 'parthian_tactics', 'siege_onager'),
    ai={'knight': 1.7, 'hand_cannoneer': 1.5, 'militia': 1.2, 'conquistador': 2.6})

PLAYABLE = [k for k in CIVS if k != 'default']


# ============================================================ механика
def team_bonus(w):
    """Командные бонусы — всем союзникам (и себе); одинаковые цивилизации в команде не складываются.
    Стартовые юниты цивилизации — у городского центра."""
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
    """Новая эпоха: эффекты этой эпохи, бесплатные технологии, прибавка к населению."""
    c = CIVS.get(p.civ, {})
    eff = c.get('ages', {}).get(p.age)
    if eff:
        p.add_effects(eff)
        if c.get('refresh_hp') or any(e['stat'] == 'hp' for e in eff):
            w.refresh_hp(p)
    p.pop_bonus += c.get('pop_bonus', {}).get(p.age, 0)
    for t in c.get('free', {}).get(p.age, ()):
        if t in TECHS and t not in p.techs and p.allows(t):
            for b in w.buildings:          # уже в очереди — вернуть цену
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
