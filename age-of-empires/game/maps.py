"""Карты партии — список и свойства (без pygame и без импорта мира: модуль читают terrain, naval, лобби).

Карты по правилам случайных карт AoE II DE (числа — из скриптов карт DE, docs/research/07_maps.md; имена свои):
  arabia        «Пустошь»        — открытая суша, холмы, пейзаж 1 из нескольких (themes.ARABIA_POOL)
  arena         «Крепостной двор» — у каждого каменная стена с воротами, снаружи лес, центр открыт
  black_forest  «Чаща»           — вся карта — лес, поляны игроков, просеки между ними, дороги союзникам
  nomad         «Кочевье»        — без городского центра: 3 жителя вразброс, вода по краям карты
  islands       «Архипелаг»      — у каждого свой остров, нейтральные островки с золотом и камнем
  mediterranean «Внутреннее море» — море в центре, кольцо суши
Старые типы 'land' (материк с озёрами) и 'coast' (прибрежье) остаются для тестов и старых сохранений.

Генерация — game/mapgen.py (новые карты) и World.gen_map (старые типы).
"""

MAPS = {
    # ключ: имя, вода есть (флот, морской ИИ), старт без центра, описание для лобби
    'arabia': dict(name='Пустошь', water=False, desc='Открытая суша, холмы, мало леса'),
    'arena': dict(name='Крепостной двор', water=False, desc='Стены у каждого, лес снаружи'),
    'black_forest': dict(name='Чаща', water=False, desc='Сплошной лес, просеки'),
    'nomad': dict(name='Кочевье', water=True, nomad=True, desc='Без центра, вода по краям'),
    'islands': dict(name='Архипелаг', water=True, desc='Свой остров у каждого'),
    'mediterranean': dict(name='Внутреннее море', water=True, desc='Море в центре'),
    # прежние типы
    'land': dict(name='Материк', water=False, legacy=True, desc='Материк с озёрами'),
    'coast': dict(name='Прибрежье', water=True, legacy=True, desc='Море в центре (старое)'),
}
LEGACY_SIZES = {2: 96, 3: 110, 4: 120, 5: 136, 6: 136, 7: 152, 8: 152}    # 'land' / 'coast' без лобби (тесты)
LOBBY = ('arabia', 'arena', 'black_forest', 'nomad', 'islands', 'mediterranean')
ALL = tuple(MAPS)
DEFAULT = 'arabia'
NAMES = {k: v['name'] for k, v in MAPS.items()}


def is_water(mt):
    """Есть ли на карте море (морская часть ИИ, доки, рыба)."""
    return MAPS.get(mt, MAPS['land'])['water']


def is_legacy(mt):
    return MAPS.get(mt, {}).get('legacy', False) or mt not in MAPS


def is_nomad(mt):
    return MAPS.get(mt, {}).get('nomad', False)


def name(mt):
    return NAMES.get(mt, mt)
