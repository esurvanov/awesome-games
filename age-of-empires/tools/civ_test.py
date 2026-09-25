#!/usr/bin/env python3
"""Windowless civilization checks: bonuses (numbers selectively), a team bonus to an ally, unique units
in the castle (stats, elite), unique techs, the tech tree (hidden in the buttons, the AI does not take them),
special tricks (a volley, the berserk's healing, trampling, "Nomads", "Anarchy").

  .venv/bin/python tools/civ_test.py          # exit code 0 - everything passed
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
    """A ready castle at the player's start."""
    sx, sy = w.starts[pid]
    for r in range(6, 20):
        for dx in range(-r, r + 1):
            for dy in (-r, r):
                if w.can_place('castle', sx + dx, sy + dy, pid, check_explored=False):
                    return w.place_building('castle', pid, sx + dx, sy + dy, complete=True)
    raise RuntimeError('no room for a castle')


def spawn(w, kind, owner, x, y):
    u = Unit(kind, owner, x, y, w)
    w.units.append(u)
    return u


# ============================================================ bonuses
def test_bonuses():
    print('Civilization bonuses (selectively):')
    civs = [k for k in CIVS if k != 'default']
    check(len(civs) >= 12, f'civilizations {len(civs)} (>= 12 needed)')
    w = world(['franks', 'britons'])
    f, b = w.players
    check(f.stat('hp', 'knight', 100) == 120, f'Franks: knight 120 HP (was {f.stat("hp", "knight", 100)})')
    check(f.cost_of('bld', 'castle')['stone'] == 552, f'Franks: castle 552 stone (was {f.cost_of("bld", "castle")})')
    check(sum(f.cost_of('tech', 'heavy_plow').values()) == 0, 'Franks: Heavy Plow for free')
    check(b.stat('rng', 'archer', 4) == 4, 'Britons: in the Dark Age the archer range is 4')
    age_to(w, b, 2)
    check(b.stat('rng', 'archer', 4) == 5, f'Britons: in the Castle Age range 5 (was {b.stat("rng", "archer", 4)})')
    check(b.cost_of('bld', 'town_center')['wood'] == 138, f'Britons: center 138 wood (was {b.cost_of("bld", "town_center")})')
    age_to(w, b, 3)
    check(b.stat('rng', 'crossbowman', 5) == 7, 'Britons: in the Imperial Age +2 range')

    w = world(['mongols', 'byzantines'])
    m, z = w.players
    check(abs(m.stat('reload', 'cavalry_archer', 2.0) - 1.6) < 1e-6, 'Mongols: cavalry archer reload 1.6 s')
    check(z.cost_of('unit', 'spearman')['food'] == 26, f'Byzantines: spearman 26 food (was {z.cost_of("unit", "spearman")})')
    tc = next(b for b in w.buildings if b.owner == 1 and b.kind == 'town_center')
    check(abs(tc.max_hp - 2640) < 1, f'Byzantines: center 2640 HP (was {tc.max_hp})')
    age_to(w, z, 3)
    check(abs(tc.max_hp - 3360) < 1, f'Byzantines: in the Imperial Age center 3360 HP (was {tc.max_hp:.0f})')

    w = world(['teutons', 'japanese'])
    t, j = w.players
    check(t.cost_of('bld', 'farm')['wood'] == 36, 'Teutons: farm 36 wood')
    check(j.cost_of('bld', 'mill')['wood'] == 50, 'Japanese: mill 50 wood')
    age_to(w, j, 1)
    check(abs(j.stat('reload', 'militia', 2.0) - 2 / 1.33) < 1e-6, 'Japanese: infantry from the Feudal Age hits faster by 33%')
    age_to(w, t, 2)
    check(t.stat('arm_m', 'knight', 2) == 3, 'Teutons: in the Castle Age knight +1 melee armor')

    w = world(['chinese', 'persians'])
    c, p = w.players
    vils = sum(1 for u in w.units if u.owner == 0 and u.kind == 'villager')
    check(vils == 6 and c.res['food'] == 0 and c.res['wood'] == 150, f'Chinese: 6 villagers, 0 food, 150 wood (was {vils}, {c.res})')
    w.recount()
    check(c.cap == 15, f'Chinese: the center gives 15 population (was {c.cap})')
    age_to(w, c, 1)
    check(c.cost_of('tech', 'castle')['food'] == 720, f'Chinese: Castle Age 720 food (was {c.cost_of("tech", "castle")})')
    tc = next(b for b in w.buildings if b.owner == 1 and b.kind == 'town_center')
    check(tc.max_hp == 4800 and p.res['food'] == 250, 'Persians: center 4800 HP, 250 food at the start')
    age_to(w, p, 1)
    check(abs(p.time_of('unit', 'villager') - 25 / 1.1) < 1e-6, 'Persians: the center in the Feudal Age is faster by 10%')

    w = world(['saracens', 'turks'])
    s, tk = w.players
    from game import market
    check(abs(market.fee(s) - 0.05) < 1e-9, 'Saracens: market fee 5%')
    check(tk.stat('hp', 'hand_cannoneer', 40) == 50, 'Turks: hand cannoneer 50 HP')
    age_to(w, tk, 3)
    check('chemistry' in tk.techs, 'Turks: Chemistry for free in the Imperial Age')
    check(sum(tk.cost_of('tech', 'hussar').values()) == 0, 'Turks: Hussar for free')

    w = world(['vikings', 'goths'])
    v, g = w.players
    age_to(w, v, 1)
    check('wheelbarrow' in v.techs, 'Vikings: Wheelbarrow for free in the Feudal Age')
    vm = spawn(w, 'militia', 0, 300, 300)
    check(abs(vm.max_hp - 44) < 1e-6, f'Vikings: militia 44 HP in the Feudal Age (was {vm.max_hp})')
    age_to(w, v, 2)
    check('hand_cart' in v.techs and abs(vm.max_hp - 46) < 1e-6, f'Vikings: Hand Cart for free, infantry +15% (HP {vm.max_hp})')
    check(g.cost_of('unit', 'militia')['food'] == 48, 'Goths: militia 48 food')
    age_to(w, g, 3)
    check(g.cost_of('unit', 'militia')['food'] == 39 and g.pop_bonus == 10, 'Goths: in the Imperial Age -35% and +10 population')

    w = world(['celts', 'spanish'])
    ce, sp = w.players
    check(abs(ce.stat('gather', 'villager', 1.0, 'wood', 'tree') - 1.15) < 1e-6, 'Celts: lumberjacks +15%')
    check(sp.cost_of('tech', 'iron_casting').get('gold', 0) == 0, 'Spanish: the blacksmith without gold')
    check(abs(sp.stat('build', 'villager', 1) - 1.3) < 1e-6, 'Spanish: construction +30%')


def test_team():
    print('Team bonus:')
    w = world(['franks', 'britons', 'teutons'], n=3, teams=[0, 0, 1])
    a, b, c = w.players
    check(a.stat('los', 'knight', 4) == 6, 'Franks: they themselves get +2 line of sight for knights')
    check(b.stat('los', 'knight', 4) == 6, 'a Frankish ally (Britons): knights +2 line of sight')
    check(c.stat('los', 'knight', 4) == 4, 'an enemy of the Franks: no bonus')
    check(abs(a.time_of('unit', 'archer') - 35 / 1.2) < 1e-6, 'the Franks get the team bonus of the Britons (archery range)')
    w = world(['franks', 'franks', 'teutons'], n=3, teams=[0, 0, 1])
    check(w.players[0].stat('los', 'knight', 4) == 6, 'two Franks in a team: the bonus does not stack')


# ============================================================ unique
def test_unique_units():
    print('Unique units (castle, stats, elite):')
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
              f'{civ}: {UNITS[uu]["name"]} available, a foreign {UNITS[foreign]["name"]} - no')
        check('trebuchet' in cs.d['trains'], f'{civ}: a trebuchet in the castle')
        p.res.update(food=5000, wood=5000, gold=5000, stone=5000)
        p.pay(p.cost_of('unit', uu))
        cs.queue.append(('unit', uu))
        run(w, p.time_of('unit', uu) + 0.5)
        u = next((x for x in w.units if x.owner == 0 and x.kind == uu), None)
        d = UNITS[uu]
        check(u is not None and u.atk() >= d['atk'] and u.d['civ'] == civ,
              f'{civ}: trained {d["name"]} ({d["hp"]} HP, {d["atk"]} attack)')
        ek = 'elite_' + uu
        check(w.tech_state(p, ek)[0] is False, f'{civ}: the elite only in the Imperial Age')
        age_to(w, p, 3)
        check(w.tech_state(p, ek)[0], f'{civ}: the elite upgrade is available in the Imperial Age')
        w.apply_tech(p, ek)
        check(u is not None and u.kind == ek and p.current(uu) == ek and UNITS[ek]['hp'] >= d['hp'],
              f'{civ}: elite -> {UNITS[ek]["name"]} ({UNITS[ek]["hp"]} HP)')
        # unique techs
        uts = [t for t, x in TECHS.items() if x.get('civ') == civ and not x.get('upgrade')]
        check(len(uts) == 2 and {TECHS[t]['age'] for t in uts} == {2, 3}, f'{civ}: two unique techs (III and IV)')
        for t in uts:
            n0 = len(p.effects)
            check(w.tech_state(p, t)[0] and not w.tech_state(w.players[1], t)[0] and t in cs.d['techs'],
                  f'{civ}: {TECHS[t]["name"]} - in the castle, only its own')
            w.apply_tech(p, t)
            check(len(p.effects) > n0 or TECHS[t].get('on_apply') or t == 'nomads', f'{civ}: {TECHS[t]["name"]} applied')


def test_utech_numbers():
    print('Unique techs (numbers):')
    w = world(['franks', 'chinese'])
    f, c = w.players
    age_to(w, f, 2)
    w.apply_tech(f, 'bearded_axe')
    check(f.stat('rng', 'throwing_axeman', 3) == 4, 'Bearded Axe: throwing axemen range 4')
    age_to(w, c, 3)
    w.apply_tech(c, 'rocketry')
    check(c.stat('atk', 'chu_ko_nu', 8) == 10, 'Rocketry: chu ko nu 10 attack')
    w = world(['persians', 'goths'])
    p, g = w.players
    age_to(w, p, 2)
    w.apply_tech(p, 'kamandaran')
    cst = p.cost_of('unit', 'crossbowman')
    check(cst.get('gold', 0) == 0 and cst['wood'] == 70, f'Kamandaran: crossbowman 70 wood without gold ({cst})')
    age_to(w, g, 2)
    check(not g.allows('huskarl', 'barracks'), 'Goths: the huskarl in the barracks is closed until Anarchy')
    w.apply_tech(g, 'anarchy')
    check(g.allows('huskarl', 'barracks'), 'Anarchy: the huskarl in the barracks')


def test_specials():
    print('Special tricks:')
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
    check(len(w.projectiles) - n0 >= 3, f'chu ko nu: a volley of 3 arrows (projectiles {len(w.projectiles) - n0})')
    bz = spawn(w, 'berserk', 1, cx - 10 * TILE, cy - 10 * TILE)
    bz.hp = 20
    run(w, 3.1)
    check(bz.hp > 21.5, f'the berserk restores health ({bz.hp:.1f})')
    # elephant trampling
    w = world(['persians', 'franks'])
    cx, cy = w.W // 2 * TILE, w.H // 2 * TILE
    el = spawn(w, 'war_elephant', 0, cx, cy)
    a = spawn(w, 'militia', 1, cx + 22, cy)
    b = spawn(w, 'militia', 1, cx + 28, cy + 10)
    hp_b = b.hp
    w.damage(a, el, 0)
    el.face = (1, 0)
    UNITS['war_elephant']['on_attack'](el, w, a, 15)
    check(b.hp < hp_b, f'the war elephant tramples neighbors ({hp_b} → {b.hp})')
    tc = next(x for x in w.buildings if x.owner == 1)
    UNITS['war_elephant']['on_attack'](el, w, tc, 15)
    UNITS['cataphract']['on_attack'](el, w, tc, 15)
    check(True, 'trampling a building does not fall')
    # Nomads
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
    check(m.cap == cap0, f'Nomads: a destroyed house does not reduce the cap ({cap0} → {m.cap})')


# ============================================================ tech tree
def test_tree_ui_ai():
    print('Tech tree: buttons and the AI:')
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
          'Turks: no Pikeman in the barracks (the spearman is there)')
    check('elite_skirmisher' not in acts['archery_range'] and 'arbalester' not in acts['archery_range'],
          'Turks: no Elite Skirmisher and Arbalester')
    check('janissary' in acts['castle'] and 'throwing_axeman' not in acts['castle'] and 'trebuchet' in acts['castle'],
          'Turks: the castle has the janissary and the trebuchet, no foreign ones')
    check('huskarl' not in acts['barracks'], 'Turks: no huskarl in the barracks')
    g.selected = [next(u for u in w.units if u.owner == 0 and u.kind == 'villager')]
    g.cmd_page = 0
    # the Turks' AI with a huge reserve: it does not take the unavailable
    ai = AI(w, 0, 2)
    w.ais = [ai]
    w.time = 2000.0         # the economy is "sufficient" - the AI spends on the army
    for _ in range(int(90 / DT)):
        w.update(DT)
        w.events.clear()
        p.res.update(food=9000, wood=9000, gold=9000, stone=9000)
    queued = {n for b in w.buildings if b.owner == 0 for _, n in b.queue}
    trained = {u.kind for u in w.units if u.owner == 0}
    bad = ({'pikeman', 'halberdier', 'elite_skirmisher', 'arbalester', 'paladin'} & (p.techs | queued | trained))
    check(not bad, f'the Turkish AI does not take the unavailable ({sorted(bad)})')
    uniq = {'janissary', 'elite_janissary'} & (trained | queued)
    uts = {'sipahi', 'artillery', 'elite_janissary'} & (p.techs | p.researching)
    check(bool(uniq), f'the AI trains a unique unit in the castle ({sorted(uniq)})')
    check(bool(uts), f'the AI researches unique techs ({sorted(uts)})')


def main():
    test_bonuses()
    test_team()
    test_unique_units()
    test_utech_numbers()
    test_specials()
    test_tree_ui_ai()
    print()
    if FAILS:
        print(f'FAILED: {len(FAILS)}')
        for f in FAILS:
            print('  -', f)
        sys.exit(1)
    print('All civilization checks passed.')


if __name__ == '__main__':
    main()
