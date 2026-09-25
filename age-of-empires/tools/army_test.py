#!/usr/bin/env python3
"""Безоконные проверки армии: формула урона, взрыв мангонеля, требушет (свёртка/развёртка, выстрел по зданию),
обращение монахом, улучшение линии у уже обученных юнитов, минимальная дальность, промахи.

  .venv/bin/python tools/army_test.py          # код выхода 0 — всё прошло
"""
import os
import random
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from game.data import TILE  # noqa: E402
from game.world import World, Unit  # noqa: E402
from game import terrain  # noqa: E402

DT = 0.034
FAILS = []


def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what)
    if not cond:
        FAILS.append(what)


def arena(seed=1):
    """Мир 2 игроков, все юниты и животные убраны; центр карты — поле боя."""
    random.seed(seed)
    w = World(1, 2)
    w.units.clear()
    w.animals.clear()
    w.ais = []
    cx, cy = w.W // 2, w.H // 2
    # расчистить поле 24×24 в центре
    for y in range(cy - 12, cy + 12):
        for x in range(cx - 12, cx + 12):
            o = w.occ[y][x]
            if o is not None and not hasattr(o, 'queue'):
                w.occ[y][x] = None
                o.alive = False
            w.terrain[y][x] = 0
    w.nodes = [n for n in w.nodes if n.alive]
    terrain.flatten(w, 0, 0, w.W, w.H)      # ровная земля: урон без поправки за высоту (её проверяет terrain_test)
    return w, cx * TILE, cy * TILE


def put(w, kind, owner, x, y):
    u = Unit(kind, owner, x, y, w)
    w.units.append(u)
    return u


def run(w, sec, until=None):
    t = 0.0
    while t < sec:
        w.update(DT)
        w.events.clear()
        t += DT
        if until and until():
            return True
    return False


def test_damage():
    print('Формула урона (классы брони и бонусы):')
    w, x, y = arena()
    sp = put(w, 'spearman', 0, x, y)
    kn = put(w, 'knight', 1, x + 40, y)
    ar = put(w, 'archer', 0, x, y + 40)
    sk = put(w, 'skirmisher', 1, x + 40, y + 40)
    pk = put(w, 'pikeman', 0, x, y + 80)
    ram = put(w, 'ram', 1, x + 60, y + 80)
    hc = put(w, 'hand_cannoneer', 0, x, y + 120)
    ch = put(w, 'champion', 1, x + 40, y + 120)
    # копейщик по рыцарю: max(0, 3 − 2) + 15 = 16
    check(w.calc_damage(sp, kn, False) == 16, f'копейщик → рыцарь = 16 (есть {w.calc_damage(sp, kn, False)})')
    # рыцарь по копейщику: 10 − 0 = 10
    check(w.calc_damage(kn, sp, False) == 10, f'рыцарь → копейщик = 10 (есть {w.calc_damage(kn, sp, False)})')
    # застрельщик по лучнику: max(0, 2 − 0) + 3 = 5; лучник по застрельщику: max(0, 4 − 3) = 1
    check(w.calc_damage(sk, ar, True) == 5, f'застрельщик → лучник = 5 (есть {w.calc_damage(sk, ar, True)})')
    check(w.calc_damage(ar, sk, True) == 1, f'лучник → застрельщик = 1 (есть {w.calc_damage(ar, sk, True)})')
    # лучник по копейщику: 4 + 3 бонус = 7
    check(w.calc_damage(ar, sp, True) == 7, f'лучник → копейщик = 7 (есть {w.calc_damage(ar, sp, True)})')
    # пикинёр по тарану: max(0, 4 − 0) = 4 (без бонуса)
    check(w.calc_damage(pk, ram, False) == 4, f'пикинёр → таран = 4 (есть {w.calc_damage(pk, ram, False)})')
    # стрела по тарану: max(0, 4 − 180) → минимум 1
    check(w.calc_damage(ar, ram, True) == 1, f'лучник → таран = 1 (есть {w.calc_damage(ar, ram, True)})')
    # ручная пушка по чемпиону: max(0, 17 − 1) + 10 = 26
    check(w.calc_damage(hc, ch, True) == 26, f'ручная пушка → чемпион = 26 (есть {w.calc_damage(hc, ch, True)})')
    tc = next(b for b in w.buildings if b.kind == 'town_center' and b.owner == 0)
    # таран по центру (броня 3/5): max(0, 2 − 3) + 125 = 125
    check(w.calc_damage(ram, tc, False) == 125, f'таран → городской центр = 125 (есть {w.calc_damage(ram, tc, False)})')
    # технология-модификатор бонуса: Парфянская тактика +4 против копейщиков
    ca = put(w, 'cavalry_archer', 1, x + 80, y)
    before = w.calc_damage(ca, sp, True)
    w.apply_tech(w.players[1], 'parthian_tactics')
    after = w.calc_damage(ca, sp, True)
    check(after == before + 4, f'Парфянская тактика: конный лучник → копейщик {before} → {after}')


def test_mangonel():
    print('Мангонель: урон по площади:')
    w, x, y = arena()
    m = put(w, 'mangonel', 0, x - 5 * TILE, y)
    pack = [put(w, 'militia', 1, x + dx, y + dy) for dx, dy in ((0, 0), (10, 4), (-8, 6), (4, -10), (-6, -8))]
    far = put(w, 'militia', 1, x + 3 * TILE, y + 3 * TILE)
    for u in pack + [far]:
        u.state = 'hold'        # стоят на месте (неизвестное состояние — ничего не делают)
    m.cmd_attack(pack[0])
    run(w, 12, until=lambda: sum(1 for u in pack if u.hp < u.max_hp) >= 3)
    hurt = sum(1 for u in pack if u.hp < u.max_hp or not u.alive)
    check(hurt >= 3, f'один выстрел задел {hurt} из {len(pack)} ополченцев в куче')
    check(far.hp == far.max_hp, 'дальний ополченец цел')
    # свои тоже страдают
    w, x, y = arena()
    m = put(w, 'mangonel', 0, x - 5 * TILE, y)
    foe = put(w, 'militia', 1, x, y)
    mine = put(w, 'militia', 0, x + 6, y + 4)
    foe.state = mine.state = 'hold'
    m.cmd_attack(foe)
    run(w, 10, until=lambda: foe.hp < foe.max_hp)
    check(mine.hp < mine.max_hp, 'взрыв задел и своего ополченца (как в оригинале)')
    # минимальная дальность: вплотную не стреляет, а отходит
    w, x, y = arena()
    m = put(w, 'mangonel', 0, x, y)
    foe = put(w, 'militia', 1, x + TILE, y)
    foe.state = 'hold'
    m.cmd_attack(foe)
    run(w, 4)
    check(m.dist_to(foe) > TILE * 1.5 and foe.hp == foe.max_hp,
          f'цель ближе 3 клеток: мангонель отошёл ({m.dist_to(foe) / TILE:.1f} кл.), не стрелял')


def test_trebuchet():
    print('Требушет: свёртка, развёртка, выстрел по зданию:')
    w, x, y = arena()
    tc = next(b for b in w.buildings if b.kind == 'town_center' and b.owner == 1)
    cx, cy = tc.center()
    # ставим требушет в 20 клетках от центра врага, на свободной клетке
    dx, dy = x - cx, y - cy
    d = (dx * dx + dy * dy) ** 0.5
    tx, ty = w.nearest_free_tile(int((cx + dx / d * 20 * TILE) // TILE), int((cy + dy / d * 20 * TILE) // TILE))
    t = put(w, 'trebuchet', 0, (tx + 0.5) * TILE, (ty + 0.5) * TILE)
    check(t.packed, 'обучен свёрнутым')
    t.cmd_attack(tc)
    moved = run(w, 60, until=lambda: not t.packed or t.pack_t > 0)
    check(moved, f'подъехал на дальность и начал развёртку (до цели {t.dist_to(tc) / TILE:.1f} кл.)')
    x0, y0 = t.x, t.y
    run(w, 4.2)
    check(not t.packed, 'развернулся за 4 с')
    hp0 = tc.hp
    run(w, 25, until=lambda: tc.hp < hp0)
    check(tc.hp < hp0, f'попал по городскому центру: {hp0:.0f} → {tc.hp:.0f}')
    check((t.x, t.y) == (x0, y0), 'разложенный не двигается')
    # приказ идти: сначала сворачивается, потом едет
    t.cmd_move(t.x - 3 * TILE, t.y)
    run(w, 1.0)
    check(t.pack_t > 0 and (t.x, t.y) == (x0, y0), 'на приказ «идти» — сворачивается, стоит')
    run(w, 3.5)
    check(t.packed, 'свернулся')
    run(w, 3)
    check((t.x, t.y) != (x0, y0), 'поехал')


def test_monk():
    print('Монах: обращение:')
    w, x, y = arena()
    mk = put(w, 'monk', 0, x, y)
    kn = put(w, 'knight', 1, x + 6 * TILE, y)
    kn.state = 'hold'
    w.recount()
    p0, p1 = w.players[0].pop, w.players[1].pop
    mk.cmd_attack(kn)
    t0 = w.time
    ok = run(w, 20, until=lambda: kn.owner == 0)
    check(ok, f'рыцарь обращён (за {w.time - t0:.1f} с вместе с подходом; владелец {kn.owner})')
    check(w.players[0].pop == p0 + 1 and w.players[1].pop == p1 - 1,
          f'население пересчитано: {p0}→{w.players[0].pop}, {p1}→{w.players[1].pop}')
    check(mk.faith_t > w.time + 50, 'монах восстанавливает веру ~62 с')
    # теперь обращённый рыцарь бьёт бывших своих
    foe = put(w, 'militia', 1, kn.x + 20, kn.y)
    kn.state = 'idle'
    run(w, 6, until=lambda: foe.hp < foe.max_hp)
    check(foe.hp < foe.max_hp, 'обращённый рыцарь атакует бывших союзников')
    # таран без «Искупления грехов» не обращается
    r = put(w, 'ram', 1, x - 3 * TILE, y)
    check(not w.convertible(mk, r), 'таран нельзя обратить без технологии')
    w.apply_tech(w.players[0], 'redemption')
    check(w.convertible(mk, r), 'после «Искупления грехов» — можно')
    # лечение
    kn.hp = 40
    mk2 = put(w, 'monk', 0, kn.x - 30, kn.y)
    mk2.cmd_heal(kn)
    run(w, 5)
    check(kn.hp > 42, f'монах лечит: 40 → {kn.hp:.0f}')


def test_upgrade():
    print('Улучшения линий:')
    w, x, y = arena()
    p = w.players[0]
    units = [put(w, 'militia', 0, x + i * 20, y) for i in range(3)]
    units[0].hp = 20
    for t in ('man_at_arms', 'long_swordsman', 'two_handed_swordsman', 'champion'):
        ok, why = w.tech_state(p, t)
        p.age = 3
        ok, why = w.tech_state(p, t)
        check(ok, f'{t}: можно изучить ({why})')
        w.apply_tech(p, t)
    check(all(u.kind == 'champion' for u in units), 'все ополченцы стали чемпионами')
    check(abs(units[0].hp / units[0].max_hp - 0.5) < 0.01, f'доля здоровья сохранена ({units[0].hp:.0f}/{units[0].max_hp})')
    check(p.current('militia') == 'champion', 'казармы обучают чемпионов')
    # требования: ручная пушка — только с Химией
    ok, why = w.unit_state(p, 'hand_cannoneer')
    check(not ok, f'ручная пушка без Химии — нельзя ({why})')
    w.apply_tech(p, 'chemistry')
    check(w.unit_state(p, 'hand_cannoneer')[0], 'после Химии — можно')
    # кузница: атака пехоты
    a0 = units[1].atk()
    for t in ('forging', 'iron_casting', 'blast_furnace'):
        w.apply_tech(p, t)
    check(units[1].atk() == a0 + 4, f'Ковка+Литьё+Домна: атака {a0} → {units[1].atk()}')
    arc = put(w, 'archer', 0, x, y + 40)
    check(arc.atk() == 4 + 1, f'Химия даёт стрелкам +1 ({arc.atk()})')


def test_accuracy():
    print('Промахи по движущимся и Баллистика:')
    hits = {}
    for lead in (False, True):
        w, x, y = arena(5)
        if lead:
            w.apply_tech(w.players[0], 'ballistics')
        shooters = [put(w, 'crossbowman', 0, x - 5 * TILE, y + i * 16 - 40) for i in range(5)]
        runner = put(w, 'knight', 1, x, y - 6 * TILE)
        runner.max_hp = runner.hp = 10000
        w.apply_tech(w.players[0], 'thumb_ring')    # 100% точность: разница только от упреждения
        n = 0
        for _ in range(4):
            runner.cmd_move(x, y + 6 * TILE)
            for s in shooters:
                s.cmd_attack(runner)
            run(w, 8)
            runner.cmd_move(x, y - 6 * TILE)
            run(w, 8)
        n = 10000 - runner.hp
        hits[lead] = n
    check(hits[True] > hits[False] * 1.3, f'урон по скачущему рыцарю: без Баллистики {hits[False]:.0f}, '
          f'с Баллистикой {hits[True]:.0f}')


def main():
    for t in (test_damage, test_mangonel, test_trebuchet, test_monk, test_upgrade, test_accuracy):
        t()
    print(f'=== провалов: {len(FAILS)}')
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
