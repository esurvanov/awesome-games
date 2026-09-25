#!/usr/bin/env python3
"""Безоконные проверки цивилизаций: бонусы (выборочно числа), командный бонус союзнику, уникальные юниты
в замке (характеристики, элита), уникальные технологии, дерево технологий (скрыто в кнопках, ИИ не берёт),
особые приёмы (залп, лечение берсерка, топтание, «Кочевники», «Анархия»).

  .venv/bin/python tools/civ_test.py          # код выхода 0 — всё прошло
"""
import os
import random
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from game.data import TILE, UNITS, TECHS, CIVS  # noqa: E402
from game.world import World, Unit  # noqa: E402

DT = 0.034
FAILS = []


def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what)
    if not cond:
        FAILS.append(what)


def world(civs, n=2, teams=None, seed=1):
    random.seed(seed)
    w = World(1, n, teams, civs=civs)
    w.ais = []
    return w


def age_to(w, p, age):
    for t in ('feudal', 'castle', 'imperial')[p.age:age]:
        w.apply_tech(p, t)


def run(w, sec):
    t = 0.0
    while t < sec:
        w.update(DT)
        w.events.clear()
        t += DT


def castle_for(w, pid):
    """Готовый замок у старта игрока."""
    sx, sy = w.starts[pid]
    for r in range(6, 20):
        for dx in range(-r, r + 1):
            for dy in (-r, r):
                if w.can_place('castle', sx + dx, sy + dy, pid, check_explored=False):
                    return w.place_building('castle', pid, sx + dx, sy + dy, complete=True)
    raise RuntimeError('нет места для замка')


def spawn(w, kind, owner, x, y):
    u = Unit(kind, owner, x, y, w)
    w.units.append(u)
    return u


# ============================================================ бонусы
def test_bonuses():
    print('Бонусы цивилизаций (выборочно):')
    civs = [k for k in CIVS if k != 'default']
    check(len(civs) >= 12, f'цивилизаций {len(civs)} (нужно ≥ 12)')
    w = world(['franks', 'britons'])
    f, b = w.players
    check(f.stat('hp', 'knight', 100) == 120, f'франки: рыцарь 120 ОЗ (есть {f.stat("hp", "knight", 100)})')
    check(f.cost_of('bld', 'castle')['stone'] == 552, f'франки: замок 552 камня (есть {f.cost_of("bld", "castle")})')
    check(sum(f.cost_of('tech', 'heavy_plow').values()) == 0, 'франки: тяжёлый плуг даром')
    check(b.stat('rng', 'archer', 4) == 4, 'британцы: в Тёмные века дальность лучника 4')
    age_to(w, b, 2)
    check(b.stat('rng', 'archer', 4) == 5, f'британцы: в Эпоху замков дальность 5 (есть {b.stat("rng", "archer", 4)})')
    check(b.cost_of('bld', 'town_center')['wood'] == 138, f'британцы: центр 138 дерева (есть {b.cost_of("bld", "town_center")})')
    age_to(w, b, 3)
    check(b.stat('rng', 'crossbowman', 5) == 7, 'британцы: в Имперскую +2 дальность')

    w = world(['mongols', 'byzantines'])
    m, z = w.players
    check(abs(m.stat('reload', 'cavalry_archer', 2.0) - 1.6) < 1e-6, 'монголы: конный лучник перезарядка 1.6 с')
    check(z.cost_of('unit', 'spearman')['food'] == 26, f'византийцы: копейщик 26 еды (есть {z.cost_of("unit", "spearman")})')
    tc = next(b for b in w.buildings if b.owner == 1 and b.kind == 'town_center')
    check(abs(tc.max_hp - 2640) < 1, f'византийцы: центр 2640 ОЗ (есть {tc.max_hp})')
    age_to(w, z, 3)
    check(abs(tc.max_hp - 3360) < 1, f'византийцы: в Имперскую центр 3360 ОЗ (есть {tc.max_hp:.0f})')

    w = world(['teutons', 'japanese'])
    t, j = w.players
    check(t.cost_of('bld', 'farm')['wood'] == 36, 'тевтоны: ферма 36 дерева')
    check(j.cost_of('bld', 'mill')['wood'] == 50, 'японцы: мельница 50 дерева')
    age_to(w, j, 1)
    check(abs(j.stat('reload', 'militia', 2.0) - 2 / 1.33) < 1e-6, 'японцы: пехота с Феодальной бьёт на 33% быстрее')
    age_to(w, t, 2)
    check(t.stat('arm_m', 'knight', 2) == 3, 'тевтоны: в Эпоху замков рыцарь +1 ближн. броня')

    w = world(['chinese', 'persians'])
    c, p = w.players
    vils = sum(1 for u in w.units if u.owner == 0 and u.kind == 'villager')
    check(vils == 6 and c.res['food'] == 0 and c.res['wood'] == 150, f'китайцы: 6 жителей, 0 еды, 150 дерева (есть {vils}, {c.res})')
    w.recount()
    check(c.cap == 15, f'китайцы: центр даёт 15 населения (есть {c.cap})')
    age_to(w, c, 1)
    check(c.cost_of('tech', 'castle')['food'] == 720, f'китайцы: Эпоха замков 720 еды (есть {c.cost_of("tech", "castle")})')
    tc = next(b for b in w.buildings if b.owner == 1 and b.kind == 'town_center')
    check(tc.max_hp == 4800 and p.res['food'] == 250, 'персы: центр 4800 ОЗ, 250 еды на старте')
    age_to(w, p, 1)
    check(abs(p.time_of('unit', 'villager') - 25 / 1.1) < 1e-6, 'персы: центр в Феодальную на 10% быстрее')

    w = world(['saracens', 'turks'])
    s, tk = w.players
    from game import market
    check(abs(market.fee(s) - 0.05) < 1e-9, 'сарацины: сбор рынка 5%')
    check(tk.stat('hp', 'hand_cannoneer', 40) == 50, 'турки: ручная пушка 50 ОЗ')
    age_to(w, tk, 3)
    check('chemistry' in tk.techs, 'турки: Химия даром в Имперскую эпоху')
    check(sum(tk.cost_of('tech', 'hussar').values()) == 0, 'турки: Гусар даром')

    w = world(['vikings', 'goths'])
    v, g = w.players
    age_to(w, v, 1)
    check('wheelbarrow' in v.techs, 'викинги: Тачка даром в Феодальную')
    vm = spawn(w, 'militia', 0, 300, 300)
    check(abs(vm.max_hp - 44) < 1e-6, f'викинги: ополченец 44 ОЗ в Феодальную (есть {vm.max_hp})')
    age_to(w, v, 2)
    check('hand_cart' in v.techs and abs(vm.max_hp - 46) < 1e-6, f'викинги: Тележка даром, пехота +15% (ОЗ {vm.max_hp})')
    check(g.cost_of('unit', 'militia')['food'] == 48, 'готы: ополченец 48 еды')
    age_to(w, g, 3)
    check(g.cost_of('unit', 'militia')['food'] == 39 and g.pop_bonus == 10, 'готы: в Имперскую −35% и +10 населения')

    w = world(['celts', 'spanish'])
    ce, sp = w.players
    check(abs(ce.stat('gather', 'villager', 1.0, 'wood', 'tree') - 1.15) < 1e-6, 'кельты: лесорубы +15%')
    check(sp.cost_of('tech', 'iron_casting').get('gold', 0) == 0, 'испанцы: кузница без золота')
    check(abs(sp.stat('build', 'villager', 1) - 1.3) < 1e-6, 'испанцы: стройка +30%')


def test_team():
    print('Командный бонус:')
    w = world(['franks', 'britons', 'teutons'], n=3, teams=[0, 0, 1])
    a, b, c = w.players
    check(a.stat('los', 'knight', 4) == 6, 'франки: сами получают +2 обзор рыцарям')
    check(b.stat('los', 'knight', 4) == 6, 'союзник франков (британцы): рыцари +2 обзор')
    check(c.stat('los', 'knight', 4) == 4, 'враг франков: без бонуса')
    check(abs(a.time_of('unit', 'archer') - 35 / 1.2) < 1e-6, 'франки получают командный бонус британцев (стрельбище)')
    w = world(['franks', 'franks', 'teutons'], n=3, teams=[0, 0, 1])
    check(w.players[0].stat('los', 'knight', 4) == 6, 'два франка в команде: бонус не складывается')


# ============================================================ уникальное
def test_unique_units():
    print('Уникальные юниты (замок, характеристики, элита):')
    from game.content.civ_units import UNIQUE
    for civ in [k for k in CIVS if k != 'default']:
        other = 'franks' if civ != 'franks' else 'britons'
        w = world([civ, other])
        p = w.players[0]
        age_to(w, p, 2)
        cs = castle_for(w, 0)
        uu = UNIQUE[civ][0]
        ok, why = w.unit_state(p, uu)
        foreign = UNIQUE[other][0]
        check(ok and p.allows(uu, 'castle') and not w.unit_state(p, foreign)[0],
              f'{civ}: {UNITS[uu]["name"]} доступен, чужой {UNITS[foreign]["name"]} — нет')
        check('trebuchet' in cs.d['trains'], f'{civ}: требушет в замке')
        p.res.update(food=5000, wood=5000, gold=5000, stone=5000)
        p.pay(p.cost_of('unit', uu))
        cs.queue.append(('unit', uu))
        run(w, p.time_of('unit', uu) + 0.5)
        u = next((x for x in w.units if x.owner == 0 and x.kind == uu), None)
        d = UNITS[uu]
        check(u is not None and u.atk() >= d['atk'] and u.d['civ'] == civ,
              f'{civ}: обучен {d["name"]} ({d["hp"]} ОЗ, {d["atk"]} атака)')
        ek = 'elite_' + uu
        check(w.tech_state(p, ek)[0] is False, f'{civ}: элита только в Имперскую')
        age_to(w, p, 3)
        check(w.tech_state(p, ek)[0], f'{civ}: элитное улучшение доступно в Имперскую')
        w.apply_tech(p, ek)
        check(u is not None and u.kind == ek and p.current(uu) == ek and UNITS[ek]['hp'] >= d['hp'],
              f'{civ}: элита → {UNITS[ek]["name"]} ({UNITS[ek]["hp"]} ОЗ)')
        # уникальные технологии
        uts = [t for t, x in TECHS.items() if x.get('civ') == civ and not x.get('upgrade')]
        check(len(uts) == 2 and {TECHS[t]['age'] for t in uts} == {2, 3}, f'{civ}: две уник. технологии (III и IV)')
        for t in uts:
            n0 = len(p.effects)
            check(w.tech_state(p, t)[0] and not w.tech_state(w.players[1], t)[0] and t in cs.d['techs'],
                  f'{civ}: {TECHS[t]["name"]} — в замке, только своя')
            w.apply_tech(p, t)
            check(len(p.effects) > n0 or TECHS[t].get('on_apply') or t == 'nomads', f'{civ}: {TECHS[t]["name"]} применена')


def test_utech_numbers():
    print('Уникальные технологии (числа):')
    w = world(['franks', 'chinese'])
    f, c = w.players
    age_to(w, f, 2)
    w.apply_tech(f, 'bearded_axe')
    check(f.stat('rng', 'throwing_axeman', 3) == 4, 'Бородовидный топор: метатели дальность 4')
    age_to(w, c, 3)
    w.apply_tech(c, 'rocketry')
    check(c.stat('atk', 'chu_ko_nu', 8) == 10, 'Ракеты: чо-ко-ну 10 атака')
    w = world(['persians', 'goths'])
    p, g = w.players
    age_to(w, p, 2)
    w.apply_tech(p, 'kamandaran')
    cst = p.cost_of('unit', 'crossbowman')
    check(cst.get('gold', 0) == 0 and cst['wood'] == 70, f'Камандаран: арбалетчик 70 дерева без золота ({cst})')
    age_to(w, g, 2)
    check(not g.allows('huskarl', 'barracks'), 'готы: хускарл в казармах закрыт до Анархии')
    w.apply_tech(g, 'anarchy')
    check(g.allows('huskarl', 'barracks'), 'Анархия: хускарл в казармах')


def test_specials():
    print('Особые приёмы:')
    w = world(['chinese', 'vikings'])
    cx, cy = w.W // 2 * TILE, w.H // 2 * TILE
    ck = spawn(w, 'chu_ko_nu', 0, cx, cy)
    tgt = spawn(w, 'militia', 1, cx + 3 * TILE, cy)
    tgt.hp = tgt.max_hp = 10000
    ck.cmd_attack(tgt)
    n0 = len(w.projectiles)
    for _ in range(40):
        w.update(DT)
        w.events.clear()
        if len(w.projectiles) - n0 >= 3:
            break
    check(len(w.projectiles) - n0 >= 3, f'чо-ко-ну: залп из 3 стрел (снарядов {len(w.projectiles) - n0})')
    bz = spawn(w, 'berserk', 1, cx - 10 * TILE, cy - 10 * TILE)
    bz.hp = 20
    run(w, 3.1)
    check(bz.hp > 21.5, f'берсерк восстанавливает здоровье ({bz.hp:.1f})')
    # топтание слона
    w = world(['persians', 'franks'])
    cx, cy = w.W // 2 * TILE, w.H // 2 * TILE
    el = spawn(w, 'war_elephant', 0, cx, cy)
    a = spawn(w, 'militia', 1, cx + 22, cy)
    b = spawn(w, 'militia', 1, cx + 28, cy + 10)
    hp_b = b.hp
    w.damage(a, el, 0)
    el.face = (1, 0)
    UNITS['war_elephant']['on_attack'](el, w, a, 15)
    check(b.hp < hp_b, f'боевой слон топчет соседей ({hp_b} → {b.hp})')
    tc = next(x for x in w.buildings if x.owner == 1)
    UNITS['war_elephant']['on_attack'](el, w, tc, 15)
    UNITS['cataphract']['on_attack'](el, w, tc, 15)
    check(True, 'топтание по зданию не падает')
    # Кочевники
    w = world(['mongols', 'franks'])
    m = w.players[0]
    sx, sy = w.starts[0]
    h = None
    for dx in range(4, 12):
        if w.can_place('house', sx + dx, sy + 5, 0, check_explored=False):
            h = w.place_building('house', 0, sx + dx, sy + 5, complete=True)
            break
    w.recount()
    cap0 = m.cap
    age_to(w, m, 2)
    w.apply_tech(m, 'nomads')
    w.remove_building(h)
    w.buildings = [x for x in w.buildings if x.alive]
    w.recount()
    check(m.cap == cap0, f'Кочевники: разрушенный дом не уменьшает лимит ({cap0} → {m.cap})')


# ============================================================ дерево технологий
def test_tree_ui_ai():
    print('Дерево технологий: кнопки и ИИ:')
    from game.ui import Game
    from game.ai import AI
    random.seed(4)
    g = Game()
    g.new_game(1, 1, civs=['turks', 'franks'])
    w = g.world
    p = w.players[0]
    age_to(w, p, 3)
    p.res.update(food=9000, wood=9000, gold=9000, stone=9000)
    sx, sy = w.starts[0]
    blds = {}
    for kind in ('barracks', 'stable', 'archery_range', 'castle'):
        for r in range(5, 25):
            spot = next(((sx + dx, sy + dy) for dx in range(-r, r + 1) for dy in (-r, r)
                         if w.can_place(kind, sx + dx, sy + dy, 0, check_explored=False)), None)
            if spot:
                blds[kind] = w.place_building(kind, 0, *spot, complete=True)
                break
    acts = {}
    for kind, b in blds.items():
        g.selected = [b]
        g.cmd_page = 0
        seen = set()
        for _ in range(3):
            for bt in g.get_buttons():
                a = bt['act']
                if a[0] in ('train', 'research'):
                    seen.add(a[2])
            g.cmd_page += 1
        acts[kind] = seen
    check('pikeman' not in acts['barracks'] and 'spearman' in acts['barracks'],
          'турки: в казармах нет Пикинёра (копейщик есть)')
    check('elite_skirmisher' not in acts['archery_range'] and 'arbalester' not in acts['archery_range'],
          'турки: нет Элитного застрельщика и Аркебалиста')
    check('janissary' in acts['castle'] and 'throwing_axeman' not in acts['castle'] and 'trebuchet' in acts['castle'],
          'турки: в замке янычар и требушет, чужих нет')
    check('huskarl' not in acts['barracks'], 'турки: хускарла в казармах нет')
    g.selected = [next(u for u in w.units if u.owner == 0 and u.kind == 'villager')]
    g.cmd_page = 0
    # ИИ за турок с огромным запасом: не берёт недоступное
    ai = AI(w, 0, 2)
    w.ais = [ai]
    w.time = 2000.0         # экономика «достаточна» — ИИ тратит на армию
    for _ in range(int(90 / DT)):
        w.update(DT)
        w.events.clear()
        p.res.update(food=9000, wood=9000, gold=9000, stone=9000)
    queued = {n for b in w.buildings if b.owner == 0 for _, n in b.queue}
    trained = {u.kind for u in w.units if u.owner == 0}
    bad = ({'pikeman', 'halberdier', 'elite_skirmisher', 'arbalester', 'paladin'} & (p.techs | queued | trained))
    check(not bad, f'ИИ-турки не берут недоступное ({sorted(bad)})')
    uniq = {'janissary', 'elite_janissary'} & (trained | queued)
    uts = {'sipahi', 'artillery', 'elite_janissary'} & (p.techs | p.researching)
    check(bool(uniq), f'ИИ обучает уникальный юнит в замке ({sorted(uniq)})')
    check(bool(uts), f'ИИ изучает уникальные технологии ({sorted(uts)})')


def main():
    test_bonuses()
    test_team()
    test_unique_units()
    test_utech_numbers()
    test_specials()
    test_tree_ui_ai()
    print()
    if FAILS:
        print(f'ПРОВАЛЕНО: {len(FAILS)}')
        for f in FAILS:
            print('  -', f)
        sys.exit(1)
    print('Все проверки цивилизаций пройдены.')


if __name__ == '__main__':
    main()
