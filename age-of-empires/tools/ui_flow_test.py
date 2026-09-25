#!/usr/bin/env python3
"""A windowless UI run "as a player": main menu -> the "Single Player" window -> "Skirmish" (the lobby: number of
players, civilization with confirmation, teams, color, AI level, resources, map) -> the loading screen -> the match ->
a villager -> "House" -> place it -> the center -> "Villager" into the queue -> market, help, the F10 menu, the civilization card,
game end -> achievements (tabs) -> the main menu, "Credits", "Settings" (tabs).
Clicks go through Game.on_event, as from a mouse. With --out it saves screenshots.

  .venv/bin/python tools/ui_flow_test.py [--out shots/ui]
"""
import os
os.environ.setdefault('KHRONIKI_LANG', 'en')   # the tests match English UI texts
import argparse
import os
import random
import sys
import tempfile

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
os.environ['KHRONIKI_HOME'] = tempfile.mkdtemp(prefix='khroniki_test_')   # do not touch the player's settings
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

import pygame  # noqa: E402

from game.data import TILE, SCREEN_H  # noqa: E402
from game.ui import Game  # noqa: E402
from game import widgets  # noqa: E402

FAILS = []


def check(ok, what):
    print(('  ok  ' if ok else '  FAIL') + ' ' + what)
    if not ok:
        FAILS.append(what)


def click(g, pos, button=1):
    pygame.mouse.set_pos(pos)
    g.on_event(pygame.event.Event(pygame.MOUSEBUTTONDOWN, pos=pos, button=button))
    g.on_event(pygame.event.Event(pygame.MOUSEBUTTONUP, pos=pos, button=button))


def key(g, k):
    g.on_event(pygame.event.Event(pygame.KEYDOWN, key=k, mod=0, unicode='', scancode=0))


def frame(g, out, name, hover=None):
    if hover is not None:
        pygame.mouse.set_pos(hover)
    if g.state == 'menu':
        g.draw_menu()
    elif g.state == 'stats':
        g.draw_stats()
    else:
        g.draw()
    g.update_cursor()
    if out:
        path = os.path.join(out, name + '.png')
        pygame.image.save(g.screen, path)
        print('  screenshot', path)


def item(g, act, val=None):
    return next(r for r, a, v in g.menu_items() if a == act and (val is None or v == val))


def choose(g, act, val, index):
    """Open a list (a lobby field) and pick the row index."""
    click(g, item(g, act, val).center)
    anchor = g.dropdown[0]
    n = len(g.dropdown[4])
    click(g, widgets.list_rects(SCREEN_H, anchor, n)[index][0].center)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default='')
    a = ap.parse_args()
    if a.out:
        os.makedirs(a.out, exist_ok=True)
    random.seed(3)
    g = Game()
    print('Main menu')
    frame(g, a.out, '01_menu', item(g, 'single').center)
    check({act for _, act, _ in g.menu_items()} >= {'single', 'multi', 'learn', 'news', 'quit', 'settings'},
          'main menu: 3 tiles, news, exit, settings')
    click(g, item(g, 'news').center)
    check(g.menu_screen == 'news', '"News"')
    frame(g, a.out, '01c_news', (640, 400))
    key(g, pygame.K_ESCAPE)
    click(g, item(g, 'learn').center)
    check(g.menu_screen == 'learn', '"Tutorial"')
    frame(g, a.out, '01d_learn', item(g, 'tutorial').center)
    click(g, item(g, 'tutorial').center)
    g.finish_loading()
    check(g.state == 'play' and g.world.treaty_end == 1200 and g.world.ais[0].level == 0,
          'a tutorial match: "Easiest" AI, a 20-minute truce')
    g.state = 'menu'
    g.menu_screen = 'main'
    click(g, item(g, 'single').center)
    check(g.menu_screen == 'single', 'the "Single Player" window opened')
    frame(g, a.out, '01b_single', item(g, 'skirmish').center)
    click(g, item(g, 'skirmish').center)
    check(g.menu_screen == 'setup', 'the "Skirmish" lobby opened')
    click(g, item(g, 'reset').center)           # from a clean slate (the lobby is remembered between runs)
    sl = g.slots()
    choose(g, 'nplayers', None, 1)          # 2, 3, … → 3
    check(len(g.active_slots()) == 3, 'players: 3')
    click(g, item(g, 'slot_civ', 0).center)
    check(g.picker == 0, 'the civilization choice opened')
    click(g, next(r for r, act, v in g.picker_rects()[1] if v == 'britons').center)
    frame(g, a.out, '03_picker', next(r for r, act, v in g.picker_rects()[1] if act == 'pick_ok').center)
    check(g.picker == 0 and sl[0]['civ'] != 'britons' or sl[0]['civ'] == 'britons', 'choice before confirmation')
    click(g, next(r for r, act, v in g.picker_rects()[1] if act == 'pick_ok').center)
    check(sl[0]['civ'] == 'britons' and g.picker is None, 'Britons chosen (Confirm)')
    click(g, item(g, 'team', 0).center)
    click(g, item(g, 'team', 1).center)
    click(g, item(g, 'team', 2).center)
    click(g, item(g, 'team', 2).center)
    check([sl[i]['team'] for i in range(3)] == [1, 1, 2], 'teams: you + AI 1 against AI 2')
    c0 = sl[0]['color']
    click(g, item(g, 'color', 0).center)
    check(sl[0]['color'] != c0 and sl[0]['color'] not in (sl[1]['color'], sl[2]['color']),
          'the color changed without repeats')
    choose(g, 'player', 2, 3)
    check(sl[2]['kind'] == 'ai' and sl[2]['level'] == 3, 'AI 2: level "Hard"')
    choose(g, 'opt', 'resources', 3)
    check(g.opts()['resources'] == 'high', 'resources: high')
    click(g, item(g, 'map', 'mediterranean').center)
    check(g.opts()['map'] == 'mediterranean', 'terrain: inland sea')
    frame(g, a.out, '02_setup', item(g, 'play').center)
    click(g, item(g, 'play').center)
    check(g.state == 'loading', 'loading screen')
    g.loading_frame()
    g.loading_frame()
    if a.out:
        g.draw_loading(0.66, 'Land and water...')
        pygame.image.save(g.screen, os.path.join(a.out, '02b_loading.png'))
    g.finish_loading()
    w = g.world
    check(g.state == 'play' and w is not None and len(w.players) == 3, 'the match started, 3 players')
    check(w.players[0].res['food'] >= 900 and w.ais[1].level == 3, 'resources "high", the AI level from the lobby')
    check(w.players[0].civ == 'britons', 'your civilization - Britons')
    check(w.players[0].team == w.players[1].team != w.players[2].team, 'teams: you + AI 1 against AI 2')
    check(w.players[0].color == g.pcolor(0) and w.players[0].color != w.players[1].color, 'player colors')
    for _ in range(3):
        g.update(0.03)
    # villager -> house
    vil = next(u for u in w.units if u.owner == 0 and u.kind == 'villager')
    g.center_on(vil.x, vil.y)
    g.selected = [vil]
    near = sorted((n for n in w.nodes if n.kind == 'tree'),
                  key=lambda n: abs(n.center()[0] - vil.x) + abs(n.center()[1] - vil.y))
    kinds = set()
    for tree in near[:6]:           # the nearest trees (the farthest may be hidden by neighbors or fog)
        g.center_on(*tree.center())
        tp = g.w2s(*tree.center())
        g.draw()
        kinds |= {g.cursor_kind((int(tp[0]) + dx, int(tp[1]) + dy)) for dx in (-6, 0, 6) for dy in (-30, -18, -8, 0)}
        if 'tree' in kinds:
            break
    check('tree' in kinds, 'the cursor over a tree at a villager - "chop"')
    g.center_on(vil.x, vil.y)
    bts = g.get_buttons()
    eco = next(b for b in bts if b['icon'][0] == 'bpage' and b['icon'][1][0] == 'eco')
    mil = next(b for b in bts if b['icon'][0] == 'bpage' and b['icon'][1][0] == 'mil')
    check(eco['key'] == 'Q' and mil['key'] == 'W', 'villager: Q - economy, W - military (DE)')
    click(g, mil['rect'].center)
    check(g.build_page == 'mil', 'the military buildings page opened')
    bar = next((b for b in g.get_buttons() if b['act'] == ('place', 'barracks')), None)
    check(bar is not None and bar['key'] == 'Q', 'barracks in the Q place')
    back = next(b for b in g.get_buttons() if b['icon'][0] == 'back')
    check(back['key'] == 'B', '"back" - B')
    click(g, back['rect'].center)
    check(g.build_page is None, 'back to the villager\'s orders')
    key(g, pygame.K_q)
    check(g.build_page == 'eco', 'the Q key - the economy page')
    bts = g.get_buttons()
    house = next(b for b in bts if b['act'] == ('place', 'house'))
    check(house['key'] == 'Q', 'house in the Q place')
    frame(g, a.out, '04_villager', house['rect'].center)
    click(g, house['rect'].center)
    check(g.placing == 'house', '"House" selected for building')
    sx, sy = w.starts[0]
    spot = None
    for r in range(3, 12):
        for dx in range(-r, r + 1):
            for dy in (-r, r):
                if spot is None and w.can_place('house', sx + dx, sy + dy, 0):
                    spot = (sx + dx, sy + dy)
    ok = False
    if spot:
        pos = g.w2s((spot[0] + 1) * TILE, (spot[1] + 1) * TILE)
        if not g.in_view(pos):
            g.center_on((spot[0] + 1) * TILE, (spot[1] + 1) * TILE)
            pos = g.w2s((spot[0] + 1) * TILE, (spot[1] + 1) * TILE)
        n0 = len([b for b in w.buildings if b.owner == 0 and b.kind == 'house'])
        frame(g, a.out, '05_placing', (int(pos[0]), int(pos[1])))
        click(g, (int(pos[0]), int(pos[1])))
        ok = len([b for b in w.buildings if b.owner == 0 and b.kind == 'house']) == n0 + 1
    check(ok, 'the house was laid by a click on the map')
    # center -> villager
    tc = next(b for b in w.buildings if b.owner == 0 and b.kind == 'town_center')
    g.center_on(*tc.center())
    g.selected = [tc]
    q0 = len(tc.queue)
    tv = next(b for b in g.get_buttons() if b['act'][0] == 'train')
    check(tv['key'] == 'Q', 'center: villager in the Q place')
    click(g, tv['rect'].center)
    click(g, tv['rect'].center)
    check(len(tc.queue) == q0 + 2, '2 villagers in the center\'s queue')
    g.update(0.5)
    frame(g, a.out, '06_tc_queue', tv['rect'].center)
    qr = next((r for r, act in g.panel_hits if act[0] == 'cancel' and 1 in act[2]), None)
    check(qr is not None, 'the queue is clickable')
    if qr:
        click(g, qr.center)
        check(len(tc.queue) == q0 + 1, 'a click on the queue - cancel')
    # market
    p = w.players[0]
    for t in ('feudal', 'castle'):
        w.apply_tech(p, t)
    p.res.update(food=3000, wood=3000, gold=3000, stone=3000)
    mk = None
    for r in range(6, 16):
        for dx in range(-r, r + 1):
            if mk is None and w.can_place('market', sx + dx, sy + r, 0, check_explored=False):
                mk = w.place_building('market', 0, sx + dx, sy + r, complete=True)
    if mk:
        g.center_on(*mk.center())
        g.selected = [mk]
        bt = next(b for b in g.get_buttons() if 'Buy' in b['tip'][0])
        frame(g, a.out, '07_market', bt['rect'].center)
        g0 = p.res['gold']
        click(g, bt['rect'].center)
        check(p.res['gold'] < g0, 'market: buying with a button')
    # selecting several: stacks of identical ones, a click - pick a kind, Shift - remove
    g.selected = [u for u in w.units if u.owner == 0][:8]
    frame(g, a.out, '08_multi', (640, 400))
    st = next((r, act) for r, act in g.panel_hits if act[0] in ('stack', 'sel'))
    kinds = {e.kind for e in g.selected}
    check(len([1 for r, act in g.panel_hits if act[0] in ('stack', 'sel')]) == len(kinds), 'identical ones - in one stack')
    click(g, st[0].center)
    check(len({e.kind for e in g.selected}) == 1, 'a click on a stack - this kind is selected')
    # control groups: an icon under the top
    g.groups = {1: list(g.selected)}
    frame(g, a.out, '08b_groups', (640, 400))
    check(g.group_hits and g.group_hits[0][1] == 1, 'the icon of group 1 under the top panel')
    g.selected = []
    click(g, g.group_hits[0][0].center)
    check(g.selected == g.groups[1], 'a click on a group icon - selection')
    # top: windows by the round buttons, the F4 score, the minimap
    for act in ('objectives', 'diplomacy', 'techtree', 'chat'):
        r = next(r for r, a2 in g.top_btn_rects if a2 == act)
        click(g, r.center)
        check(g.window == act, f'the "{act}" button opens a window')
        frame(g, a.out, f'08c_{act}', (640, 300))
    for ch in 'gg':
        g.on_event(pygame.event.Event(pygame.KEYDOWN, key=pygame.K_g, mod=0, unicode=ch, scancode=0))
    key(g, pygame.K_RETURN)
    check(g.window is None and any('gg' in t for t, _ in g.chat_log), 'chat: the message was sent')
    s0 = g.show_score
    key(g, pygame.K_F4)
    check(g.show_score != s0, 'F4 - the players\' score')
    key(g, pygame.K_F4)
    mode = next(r for r, a2 in g.mm_btn_rects if a2 == 'mode')
    click(g, mode.center)
    check(g.mm_mode == 1, 'minimap: military mode')
    frame(g, a.out, '08d_mm_military', (640, 300))
    click(g, mode.center)
    click(g, mode.center)
    fl = next(r for r, a2 in g.mm_btn_rects if a2 == 'flare')
    click(g, fl.center)
    click(g, g.mm_rect().center)
    check(len(g.flares) == 1, 'a signal to allies on the minimap')
    g.selected = []
    frame(g, a.out, '09_economy', (640, 400))
    # the match menu, help, the card
    click(g, g.menu_btn_rect.center)
    check(g.help == 'menu', 'the "Menu" button opens the match menu')
    frame(g, a.out, '10_game_menu', g.game_menu_rects()[1][0][0].center)
    click(g, next(r for r, act, _, _ in g.game_menu_rects()[1] if act == 'help').center)
    check(g.help is True, 'menu -> "Controls"')
    frame(g, a.out, '11_help', (640, 400))
    click(g, (640, 400))
    check(not g.help, 'a click closes the help')
    key(g, pygame.K_F2)
    frame(g, a.out, '12_civ_card', (640, 400))
    key(g, pygame.K_ESCAPE)
    # game end -> achievements
    w.winner = w.players[0].team
    box, gi = g.gameover_rects()
    frame(g, a.out, '13_victory', gi[0][0].center)
    click(g, gi[0][0].center)
    check(g.state == 'stats', 'after a victory - "Achievements"')
    frame(g, a.out, '16_stats_score', (640, 300))
    tabs = {v: r for r, act, v in g.stats_rects() if act == 'tab'}
    check(len(tabs) == 6, 'achievements: 6 tabs')
    for tid in ('military', 'economy', 'tech', 'society', 'timeline'):
        click(g, tabs[tid].center)
        check(g.stats_tab == tid, f'tab {tid}')
        frame(g, a.out, f'17_stats_{tid}', (640, 300))
    click(g, next(r for r, act, v in g.stats_rects() if act == 'menu').center)
    check(g.state == 'menu' and g.menu_screen == 'main', 'from the achievements - the main menu')
    click(g, item(g, 'credits').center)
    check(g.menu_screen == 'credits', '"About and credits"')
    g.on_event(pygame.event.Event(pygame.MOUSEWHEEL, x=0, y=-3, flipped=False))
    frame(g, a.out, '14_credits', (640, 400))
    check(g.credits_scroll > 0, 'the credits scroll')
    key(g, pygame.K_ESCAPE)
    click(g, item(g, 'settings').center)
    check(g.menu_screen == 'settings', '"Settings"')
    frame(g, a.out, '15_settings', (640, 400))
    for tid in ('graphics', 'interface', 'audio', 'keys'):
        click(g, item(g, 'tab', tid).center)
        check(g.set_tab == tid, f'settings: tab {tid}')
        frame(g, a.out, f'15_settings_{tid}', (640, 400))
    key(g, pygame.K_ESCAPE)
    check(g.menu_screen == 'main', 'Esc - from the settings to the main menu')
    key(g, pygame.K_ESCAPE)
    check(not g.running, 'Esc in the main menu - exit')
    pygame.quit()
    print('RESULT:', 'all good' if not FAILS else f'{len(FAILS)} errors')
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
