#!/usr/bin/env python3
"""Снимки нашего HUD для сверки с AoE2 DE (исследование, игру не меняет).
  .venv/bin/python tools/research/hud_shots.py [--out shots/ref/hud/ours] [--minutes 6]
Кадры: none (ничего не выбрано), vil (житель), vil_eco / vil_mil (страницы зданий), tc (центр с очередью),
barracks, multi (стопки), mil (военный юнит), tip (подсказка), окна: w_objectives, w_chat, w_diplomacy,
w_techtree; collapsed (свёрнутая инфо-панель).
"""
import argparse
import os
import random
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

import pygame  # noqa: E402

from game.ui import Game  # noqa: E402
from game import hud  # noqa: E402
from game.world import Unit  # noqa: E402


def snap(g, out, name, sel, mouse=(640, 300)):
    g.selected = sel
    pygame.mouse.set_pos(mouse)
    g.draw()
    p = os.path.join(out, name + '.png')
    pygame.image.save(g.screen, p)
    print('сохранено', p)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='shots/ref/hud/ours')
    ap.add_argument('--minutes', type=float, default=8)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    random.seed(3)
    g = Game()
    g.new_game(1, 1, False, ai_human=True)
    w = g.world
    while w.time < a.minutes * 60 and w.winner is None:
        w.update(0.034)
        w.events.clear()
    w.update_fog()
    p = w.players[0]
    tc = next(b for b in w.buildings if b.owner == 0 and b.kind == 'town_center')
    g.center_on(*tc.center())
    snap(g, a.out, 'none', [])
    vil = next(u for u in w.units if u.owner == 0 and u.kind == 'villager')
    hud.TIP_DELAY = 0
    g.groups = {1: [u for u in w.units if u.owner == 0 and u.cls != 'vil'][:5],
                2: [u for u in w.units if u.owner == 0 and u.cls == 'vil'][:4]}
    snap(g, a.out, 'vil', [vil])
    g.build_page = 'eco'
    g._bp_key = tuple(id(e) for e in [vil])
    snap(g, a.out, 'vil_eco', [vil])
    g.build_page = 'mil'
    snap(g, a.out, 'vil_mil', [vil])
    g.build_page = None
    for r in p.res:
        p.res[r] += 2000
    tc.queue[:] = [('unit', 'villager')] * 6
    snap(g, a.out, 'tc', [tc])
    if p.age == 0:
        q = list(tc.queue)
        tc.queue[:] = [('tech', 'feudal')]
        tc.qt = 55
        snap(g, a.out, 'ageup', [tc])
        tc.queue[:] = q
        tc.qt = 0
    bar = next((b for b in w.buildings if b.owner == 0 and b.kind == 'barracks' and b.complete), None)
    if bar:
        g.center_on(*bar.center())
        snap(g, a.out, 'barracks', [bar])
    units = [u for u in w.units if u.owner == 0 and isinstance(u, Unit)]
    snap(g, a.out, 'multi', units[:30])
    mil = [u for u in units if u.cls != 'vil']
    if mil:
        snap(g, a.out, 'mil', [mil[0]])
    g.center_on(*tc.center())
    g.selected = [vil]
    bts = g.get_buttons()
    g.build_page = 'eco'
    bts = g.get_buttons()
    snap(g, a.out, 'tip', [vil], bts[3]['rect'].center if len(bts) > 3 else (640, 300))
    g.build_page = None
    for win in ('objectives', 'chat', 'diplomacy', 'techtree'):
        g.window = win
        snap(g, a.out, 'w_' + win, [], (640, 700))
    g.window = None
    g.info_collapsed = True
    g._panel_bg = None
    snap(g, a.out, 'collapsed', [vil])
    pygame.quit()


if __name__ == '__main__':
    main()
