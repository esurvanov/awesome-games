"""Армия: классы брони и бонусы базовых юнитов из data.py (правила оригинала, значения DE).

Формат (см. World.calc_damage):
  'cls'   — основной класс ('inf', 'arch', 'cav', 'siege', 'monk', 'vil'); по нему фильтруются технологии;
  'ac'    — дополнительные классы брони: 'spear', 'skirm', 'cav_arch', 'camel', 'gunpowder', 'ram', 'light_cav'…
            (фильтры технологий cls/not_cls проверяют и их);
  'bonus' — {класс цели: +урон}; 'carm' — {класс: броня против бонуса этого класса};
  'dtype' — 'melee' | 'pierce' (по умолчанию: ближний бой — melee, выстрел — pierce);
  'acc'   — точность (0…1), 'minr' — мин. дальность (клетки), 'blast' — радиус взрыва (клетки),
  'pierce' — снаряд пробивает строй, 'shot' — вид снаряда, 'bld_only' — атакует только здания,
  'pack'  — секунды на свёртку/развёртку (требушет), 'look_up' — вид для отрисовки в разложенном виде,
  'monk'  — монах (обращает и лечит), 'req' — нужные технологии, 'bar_h' — высота полоски здоровья.
"""
from ..data import UNITS, TECHS

MILITIA_LINE = ('militia', 'man_at_arms', 'long_swordsman', 'two_handed_swordsman', 'champion')

UNITS['militia'].update(desc='Пехота, дёшево, быстро', line='militia')
UNITS['spearman'].update(ac=('spear',), bonus={'cav': 15}, desc='+15 против конницы', line='spearman')
UNITS['archer'].update(ac=('foot_arch',), bonus={'spear': 3}, acc=0.8, desc='Стрелок, 80% точность',
                       line='archer')
UNITS['skirmisher'].update(ac=('skirm', 'foot_arch'), bonus={'arch': 3, 'spear': 3}, acc=0.9, shot='javelin',
                           desc='+3 против стрелков', line='skirmisher')
UNITS['scout'].update(ac=('light_cav',), desc='Разведка, быстрый', line='scout')
UNITS['knight'].update(desc='Тяжёлая конница', line='knight')
UNITS['ram'].update(ac=('ram',), bonus={'bld': 125, 'siege': 40}, bld_only=True, bar_h=34,
                    desc='Только здания, стрелы не берут', line='ram')

# «Имперская эпоха» в оригинале не даёт атаку войскам — убираем упрощение из data.py
TECHS['imperial'].pop('effects', None)
TECHS['imperial']['desc'] = 'Лучшие улучшения и осада'
