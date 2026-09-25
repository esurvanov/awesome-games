#!/usr/bin/env python3
"""Вырезки всех значков нашего HUD для слепого теста узнаваемости (исследование, игру не меняет).
  .venv/bin/python tools/research/ui_icon_dump.py [--out shots/research_ui]
Пишет:
  <out>/items/<кат>__<ключ>.png      — вырезка в родном размере (кнопка с рамкой) — «правда» в имени
  <out>/items/manifest.json         — [{file, cat, key, title}]
  <out>/ctx/*.png                   — кадры, из которых резали (контекст)
Категории: res (ресурсы/население/праздные), age (эмблемы эпох), top (кнопки верха), mm (кнопки миникарты),
  bld (кнопки зданий у жителя), unit (кнопки обучения), tech (кнопки технологий), cmd (приказы, стойки, строи,
  прочие команды), port (портрет выбранного 56 px), stat (значки характеристик), cur (курсоры).
"""
import argparse
import json
import os
import random
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

import pygame  # noqa: E402

from game.ui import Game  # noqa: E402
from game import hud, uiskin as S  # noqa: E402
from game.world import Unit  # noqa: E402
from game.data import UNITS  # noqa: E402

MAN = []


def save(out, surf, rect, cat, key, title):
    r = pygame.Rect(rect).clip(surf.get_rect())
    sub = surf.subsurface(r).copy()
    fn = f'{cat}__{key}.png'.replace('*', '_on').replace('/', '_')
    pygame.image.save(sub, os.path.join(out, 'items', fn))
    MAN.append(dict(file=fn, cat=cat, key=key, title=title))


def grid_crops(g, out, sel, cat_of, tag, page=None):
    g.selected = sel
    if page is not None:
        g.build_page = page
        g._bp_key = tuple(id(e) for e in sel)
    pygame.mouse.set_pos((640, 300))
    g.draw()
    pygame.image.save(g.screen, os.path.join(out, 'ctx', tag + '.png'))
    for bt in g.get_buttons():
        typ, name = bt['icon']
        cat = cat_of(typ, name)
        if cat is None:
            continue
        key = name if isinstance(name, str) else (name[1] if typ == 'bpage' else typ)
        if typ in ('draw',):
            key = tag + '_' + str(bt['tip'][0])
        save(out, g.screen, bt['rect'].inflate(4, 4), cat, f'{tag}.{key}', bt['tip'][0])


def default_cat(typ, name):
    return {'u': 'unit', 't': 'tech', 'b': 'bld', 'bpage': 'cmd', 'ctl': 'cmd', 'stop': 'cmd', 'x': 'cmd',
            'unload': 'cmd', 'next': 'cmd', 'back': 'cmd', 'page': 'cmd', 'draw': 'cmd'}.get(typ)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='shots/research_ui')
    a = ap.parse_args()
    for d in ('items', 'ctx'):
        os.makedirs(os.path.join(a.out, d), exist_ok=True)
    random.seed(5)
    g = Game()
    g.new_game(1, 1, False, ai_human=False, civ='britons')
    w = g.world
    for _ in range(60):
        w.update(0.034)
        w.events.clear()
    p = w.players[0]
    hud.TIP_DELAY = 10 ** 9
    tc = next(b for b in w.buildings if b.owner == 0 and b.kind == 'town_center')
    g.center_on(*tc.center())
    w.update_fog()

    # ---- верх: ресурсы, население, праздные, эпоха, кнопки; миникарта — по кадру «ничего не выбрано»
    g.selected = []
    pygame.mouse.set_pos((640, 300))
    g.draw()
    pygame.image.save(g.screen, os.path.join(a.out, 'ctx', 'none.png'))
    scr = g.screen
    # позиции найдены по кадру 1280×800 (hud.draw_top): значок в левой части ячейки
    for key, cx, title in (('wood', 22, 'Дерево'), ('food', 115, 'Еда'), ('gold', 207, 'Золото'),
                           ('stone', 298, 'Камень'), ('pop', 382, 'Население'), ('idle', 486, 'Праздный житель')):
        save(a.out, scr, (cx - 20, 4, 40, 40), 'res', key, title)
    for i, (key, title, _) in enumerate(hud.TOP_BTNS):
        cx = 1062 + i * 45.5
        save(a.out, scr, (int(cx) - 20, 4, 40, 40), 'top', key, title)
    save(a.out, scr, (985, 0, 46, 60), 'top', 'civ_banner', 'Герб цивилизации')
    for key, (cx, cy) in zip(hud.MM_BTNS, ((938, 643), (1256, 643), (938, 773), (1256, 773))):
        save(a.out, scr, (cx - 18, cy - 18, 36, 36), 'mm', key, key)
    # эпохи: щит с цифрой, как в верхней полосе
    for age in range(4):
        s = pygame.Surface((60, 60))
        s.blit(S.tiled('skin/hud.png', (60, 60), tint=(255, 240, 220)), (0, 0))
        g.screen = s
        g.age_shield(30, 30, age, h=40)
        g.screen = scr
        save(a.out, s, (5, 5, 50, 50), 'age', ['dark', 'feudal', 'castle', 'imperial'][age], f'Эпоха {age}')
    # значки характеристик на пергаменте
    for kind, val in (('hp', '40/40'), ('atk', '6'), ('arm', '1/0'), ('rng', '4'), ('spd', '0.9'), ('work', '1.0'),
                      ('pop', '+5')):
        s = pygame.Surface((40, 30))
        s.blit(S.parchment((40, 30)), (0, 0))
        g.screen = s
        g.ink = True
        g.stat_row(4, 15, kind, '')
        g.ink = False
        g.screen = scr
        save(a.out, s, (0, 3, 30, 24), 'stat', kind, kind)
    # курсоры
    for key, fn in S.CURSOR_FILES.items():
        im = S.image(f'cursors/{fn}.png')
        if im is None:
            continue
        s = pygame.Surface((max(32, im.get_width()) + 8, max(32, im.get_height()) + 8))
        s.fill((96, 120, 60))
        s.blit(im, (4, 4))
        save(a.out, s, s.get_rect(), 'cur', key, key)

    # ---- все здания, эпоха империи, ресурсы
    for r in p.res:
        p.res[r] = 99999
    for age in range(3):                 # кнопка перехода в следующую эпоху в центре города
        p.age = age
        g.cmd_key = None
        grid_crops(g, a.out, [tc], lambda t, n: 'age' if t == 't' and n in ('feudal', 'castle', 'imperial') else None,
                   f'tcage{age}')
    p.age = 3
    kinds = ['barracks', 'archery_range', 'stable', 'siege_workshop', 'castle', 'dock', 'market', 'blacksmith',
             'university', 'monastery', 'mill', 'lumber_camp', 'mining_camp', 'tower']
    blds = {}
    tx0, ty0 = 4, 4
    for i, k in enumerate(kinds):
        try:
            blds[k] = w.place_building(k, 0, tx0 + (i % 5) * 6, ty0 + (i // 5) * 6, complete=True)
        except Exception as e:           # noqa: BLE001
            print('нет', k, e)
    vil = next(u for u in w.units if u.owner == 0 and u.kind == 'villager')
    g.cmd_key = None
    grid_crops(g, a.out, [vil], default_cat, 'vil')
    grid_crops(g, a.out, [vil], default_cat, 'vileco', page='eco')
    grid_crops(g, a.out, [vil], default_cat, 'vilmil', page='mil')
    g.build_page = None
    tc.queue[:] = []
    grid_crops(g, a.out, [tc], default_cat, 'tc')
    for k, b in blds.items():
        if b is None:
            continue
        b.queue[:] = []
        g.cmd_key = None
        grid_crops(g, a.out, [b], default_cat, k)
        g.cmd_page = 1
        bts = g.get_buttons()
        if any(bt['icon'][0] == 'page' for bt in bts):
            grid_crops(g, a.out, [b], default_cat, k + '_p2')
        g.cmd_page = 0
    # армия: один воин и группа (строи)
    army = []
    for k in ('man_at_arms', 'archer', 'knight', 'spearman', 'skirmisher'):
        u = Unit(k, 0, tc.center()[0] + 40 + len(army) * 10, tc.center()[1] + 60, w)
        w.units.append(u)
        army.append(u)
    grid_crops(g, a.out, army[:1], default_cat, 'army1')
    grid_crops(g, a.out, army, default_cat, 'army')
    treb = Unit('trebuchet', 0, tc.center()[0] + 80, tc.center()[1] + 80, w)
    w.units.append(treb)
    grid_crops(g, a.out, [treb], default_cat, 'treb')

    # ---- портреты выбранного (56 px + полоса здоровья)
    port_kinds = ['villager', 'militia', 'man_at_arms', 'long_swordsman', 'champion', 'spearman', 'pikeman',
                  'archer', 'crossbowman', 'skirmisher', 'hand_cannoneer', 'scout', 'light_cavalry', 'knight',
                  'paladin', 'camel_rider', 'cavalry_archer', 'monk', 'ram', 'mangonel', 'scorpion', 'trebuchet',
                  'bombard_cannon', 'trade_cart', 'fishing_ship', 'transport_ship', 'galley', 'fire_galley',
                  'demolition_ship', 'cannon_galleon', 'longbowman', 'huskarl', 'samurai', 'mangudai', 'sheep',
                  'deer', 'boar']
    cx, cy = tc.center()
    for k in port_kinds:
        if k not in UNITS:
            print('нет юнита', k)
            continue
        try:
            if UNITS[k].get('naval'):
                u = Unit(k, 0, cx, cy + 200, w)
            else:
                u = Unit(k, 0, cx + 30, cy + 90, w)
        except Exception:                # noqa: BLE001 — животные создаются иначе
            continue
        w.units.append(u)
        g.selected = [u]
        g.draw()
        box = pygame.Rect(hud.INFO_X - 3, hud.INFO_BOX.y + 27, hud.PORT + 6, hud.PORT + 18)
        save(a.out, g.screen, box, 'port', k, UNITS[k]['name'])
        w.units.remove(u)
    # здания — портрет выбранного
    for k in ('town_center', 'house', 'barracks', 'castle', 'market', 'monastery'):
        b = tc if k == 'town_center' else blds.get(k) or next((b for b in w.buildings if b.owner == 0 and b.kind == k),
                                                            None)
        if b is None:
            continue
        g.selected = [b]
        g.draw()
        box = pygame.Rect(hud.INFO_X - 3, hud.INFO_BOX.y + 27, hud.PORT + 6, hud.PORT + 6)
        save(a.out, g.screen, box, 'portb', k, k)
    # состояния кнопки: обычная / наведение / нажата / недоступна / нет ресурсов
    g.selected = [blds['barracks']]
    g.draw()
    bt = g.get_buttons()[0]
    for st in ('normal', 'hover', 'pressed', 'disabled'):
        g.draw_cmd_button(bt, bt['rect'], st)
        save(a.out, g.screen, bt['rect'].inflate(6, 6), 'state', st, st)
    p.res = {r: 0 for r in p.res}
    g.draw()
    pygame.image.save(g.screen, os.path.join(a.out, 'ctx', 'poor.png'))
    bt = g.get_buttons()[0]
    save(a.out, g.screen, bt['rect'].inflate(6, 6), 'state', 'unaffordable', 'нет ресурсов')
    # подсказка над кнопкой
    pygame.mouse.set_pos(bt['rect'].center)
    hud.TIP_DELAY = 0
    g._tip = (None, 0)
    g.draw()
    g.draw()
    pygame.image.save(g.screen, os.path.join(a.out, 'ctx', 'tooltip.png'))
    with open(os.path.join(a.out, 'items', 'manifest.json'), 'w') as f:
        json.dump(MAN, f, ensure_ascii=False, indent=1)
    print(len(MAN), 'вырезок')
    pygame.quit()


if __name__ == '__main__':
    main()
