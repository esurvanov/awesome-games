#!/usr/bin/env python3
"""Проверка меню и экранов вокруг партии (безоконно, настройки — во временной папке KHRONIKI_HOME):
  1) лобби → параметры мира: игроки/уровни ИИ, режим, ресурсы, население, эпохи, открытая карта, перемирие,
     победа, полное дерево, размер карты; 8 игроков;
  2) правила: перемирие (нельзя нападать до срока), конечная эпоха, сдача, победа по времени, счёт;
  3) статистика и экран достижений (6 вкладок, график населения);
  4) настройки: вкладки, сохранение в settings.json (чужие ключи целы), переназначение клавиш;
  5) сохранение/загрузка: партия с ИИ → сохранить → загрузить → совпадение → ещё 5 минут без ошибок;
     меню F10 (сохранить, загрузить, перезапустить, выйти → достижения), загрузка из главного меню.

  .venv/bin/python tools/menu_test.py [--out shots/menus]
"""
import argparse
import json
import os
import random
import sys
import tempfile
import time

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
HOME = tempfile.mkdtemp(prefix='khroniki_menu_')
os.environ['KHRONIKI_HOME'] = HOME
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

import pygame  # noqa: E402

from game.data import SCREEN_H  # noqa: E402
from game.ui import Game  # noqa: E402
from game.world import World  # noqa: E402
from game.ai import AI  # noqa: E402
from game import keymap, match, savegame, scoring, settings, widgets  # noqa: E402

FAILS = []
OUT = ''


def check(ok, what):
    print(('  ok  ' if ok else '  FAIL') + ' ' + what)
    if not ok:
        FAILS.append(what)


def click(g, pos, button=1):
    pygame.mouse.set_pos(pos)
    g.on_event(pygame.event.Event(pygame.MOUSEBUTTONDOWN, pos=pos, button=button))
    g.on_event(pygame.event.Event(pygame.MOUSEBUTTONUP, pos=pos, button=button))


def key(g, k, uni=''):
    g.on_event(pygame.event.Event(pygame.KEYDOWN, key=k, mod=0, unicode=uni, scancode=0))


def item(g, act, val=None):
    return next(r for r, a, v in g.menu_items() if a == act and (val is None or v == val))


def choose(g, act, val, value):
    """Список лобби: открыть поле и выбрать строку со значением value."""
    click(g, item(g, act, val).center)
    anchor, k, slot, vals, lbls, idx = g.dropdown
    i = vals.index(value)
    click(g, widgets.list_rects(SCREEN_H, anchor, len(lbls))[i][0].center)


def shot(g, name):
    if not OUT:
        return
    if g.state == 'menu':
        g.draw_menu()
    elif g.state == 'stats':
        g.draw_stats()
    else:
        g.draw()
    pygame.image.save(g.screen, os.path.join(OUT, name + '.png'))
    print('  снимок', name)


def run(w, secs, dt=0.1):
    end = w.time + secs
    while w.time < end and w.winner is None:
        w.update(dt)
        w.events.clear()


# ============================================================ 1. лобби → мир
def test_lobby(g):
    print('Лобби → параметры мира')
    g.state = 'menu'
    g.menu_screen = 'setup'
    g.menu_cfg.clear()
    sl = g.slots()
    choose(g, 'nplayers', None, 4)
    check(len(g.active_slots()) == 4, 'игроков 4')
    choose(g, 'player', 1, ('ai', 0))
    choose(g, 'player', 2, ('ai', 5))
    choose(g, 'player', 3, ('closed', None))
    check(len(g.active_slots()) == 3, 'слот 4 закрыт')
    for i, t in ((0, 1), (1, 2), (2, 2)):
        while sl[i]['team'] != t:
            click(g, item(g, 'team', i).center)
    choose(g, 'opt', 'mode', 'dm')
    choose(g, 'opt', 'pop', 75)
    choose(g, 'opt', 'size', 'normal')
    choose(g, 'opt', 'reveal', 'explored')
    choose(g, 'opt', 'start_age', 'feudal')
    choose(g, 'opt', 'end_age', 'castle')
    choose(g, 'opt', 'treaty', 10)
    choose(g, 'opt', 'victory', 'score')
    check(any(a == 'opt' and v == 'victory_score' for _, a, v in g.menu_items()), 'появилось поле «Цель по очкам»')
    choose(g, 'opt', 'victory_score', 6000)
    choose(g, 'opt', 'speed', 2.0)
    click(g, item(g, 'flag', 'all_techs').center)
    click(g, item(g, 'map', 'arabia').center)
    shot(g, 'm01_lobby')
    click(g, item(g, 'play').center)
    check(g.state == 'loading', 'экран загрузки')
    g.finish_loading()
    w = g.world
    check(g.state == 'play' and len(w.players) == 3, 'партия на 3 игрока')
    check([p.team for p in w.players] == [0, 1, 1], 'команды 1 / 2 / 2')
    check([ai.level for ai in w.ais] == [0, 5], 'уровни ИИ: «Легчайший», «Экстрим»')
    check(w.players[0].res['wood'] >= 19000, 'Смертельная схватка: 20000 дерева')
    check(w.pop_limit == 75 and w.max_age == 2, 'население 75, конечная эпоха — замков')
    check(all(p.age == 1 for p in w.players), 'начало в Феодальной эпохе')
    check(all(w.explored), 'карта разведана')
    check(w.treaty_end == 600 and not w.hostile(0, 1), 'перемирие 10 минут: враги пока не враждебны')
    check(w.settings['victory'] == 'score' and w.settings['victory_score'] == 6000, 'победа по очкам 6000')
    check(w.W == match.MAP_SIZE['normal'], f'размер карты «обычная» ({w.W})')
    check(abs(g.speed - 2.0) < 1e-6, 'скорость «быстрая» 2.0')
    std = World(1, 2, [0, 1], civs=[w.players[0].civ, 'random'])
    check(len(w.players[0].banned) <= len(std.players[0].banned), 'полное дерево: запретов не больше')
    w.players[0].age = 2
    ok2, why2 = w.tech_state(w.players[0], 'imperial')
    w.players[0].age = 1
    check(not ok2 and 'Конечная' in why2, 'Имперская заблокирована конечной эпохой')
    saved = json.load(open(os.path.join(HOME, 'settings.json')))
    check(saved.get('lobby', {}).get('opts', {}).get('mode') == 'dm', 'лобби запомнено в settings.json')
    # 8 игроков
    g.state = 'menu'
    g.menu_screen = 'setup'
    choose(g, 'nplayers', None, 8)
    choose(g, 'opt', 'mode', 'rm')
    choose(g, 'opt', 'size', 'auto')
    choose(g, 'opt', 'start_age', 'standard')
    choose(g, 'opt', 'end_age', 'standard')
    choose(g, 'opt', 'treaty', 0)
    for i in range(8):
        while sl[i]['team'] != 0:
            click(g, item(g, 'team', i).center)
    cols = [sl[i]['color'] for i in g.active_slots()]
    check(len(set(cols)) == 8, 'восемь разных цветов')
    shot(g, 'm03_lobby8')
    click(g, item(g, 'play').center)
    g.finish_loading()
    w = g.world
    check(len(w.players) == 8 and w.W == match.MAP_SIZE['large'], f'8 игроков, карта {w.W}')
    check(len({p.team for p in w.players}) == 8, 'все «–»: каждый сам за себя')
    t0 = time.time()
    run(w, 60, 0.1)
    check(True, f'8 игроков: минута игры за {time.time() - t0:.1f} с')


# ============================================================ 2. правила
def test_rules():
    print('Правила партии')
    random.seed(2)
    w = World(1, 2, [0, 1], ai_players=[0, 1], civs=['franks', 'britons'],
              settings=dict(treaty=1, victory='time', victory_time=3))
    w.ais = [AI(w, 0, 1, level=3), AI(w, 1, 1, level=3)]
    check(not w.hostile(0, 1) and not w.hostile(1, 0), 'перемирие: враждебности нет')
    run(w, 61, 0.1)
    check(w.hostile(0, 1), 'после перемирия — враги')
    run(w, 200, 0.1)
    check(w.winner is not None, 'лимит времени: победитель определён по счёту')
    sc = scoring.scores(w)
    check(all(set(s) == {'total', 'military', 'economy', 'technology', 'society'} for s in sc), 'API счёта')
    best = max(range(2), key=lambda i: sc[i]['total'])
    check(w.winner == w.players[best].team, 'победила команда с большим счётом')
    random.seed(3)
    w = World(1, 3, [0, 1, 1], civs=['random'] * 3)
    w.resign(0)
    check(not w.players[0].alive and w.winner == 1, 'сдача: победа соперников')
    w = World(1, 2, [0, 1], settings=dict(start_age='post'))
    vils = sum(1 for u in w.units if u.owner == 0 and u.kind == 'villager')
    check(w.players[0].age == 3 and vils >= 20, f'постимперская: Имперская эпоха, {vils} жителей')
    w = World(1, 2, [0, 1], settings=dict(reveal='all'))
    check(all(w.vis), 'всё видно')


# ============================================================ 3. статистика
def test_stats(g):
    print('Статистика и достижения')
    random.seed(5)
    g.new_game(1, 2, ai_human=True, civs=['franks', 'mongols', 'teutons'], teams=[0, 1, 2],
               levels=[3, 4, 4], settings=dict(resources='medium'))
    w = g.world
    t0 = time.time()
    run(w, 12 * 60, 0.1)
    st = w.stats
    check(len(st[0]['samples']) >= 24, f'отсчётов населения: {len(st[0]["samples"])}')
    check(any(s['age_t'][1] for s in st), 'время Феодальной эпохи записано')
    check(all(s['techs'] > 0 for s in st), 'технологии посчитаны')
    check(any(s['explored'] > 0.05 for s in st[1:]), 'разведка ИИ посчитана')
    check(sum(p.gathered['food'] for p in w.players) > 0, 'собранные ресурсы')
    print(f'    12 минут за {time.time() - t0:.1f} с; счёт', [s['total'] for s in scoring.scores(w)])
    g.open_stats()
    for r, act, val in g.stats_rects():
        if act == 'tab':
            click(g, r.center)
            check(g.stats_tab == val, f'вкладка «{val}»')
            g.draw_stats()
            shot(g, f'm10_stats_{val}')
    key(g, pygame.K_ESCAPE)
    check(g.state == 'menu', 'Esc — из достижений в меню')


# ============================================================ 4. настройки
def test_settings(g):
    print('Настройки')
    g.state = 'menu'
    g.menu_screen = 'main'
    click(g, item(g, 'settings').center)
    check(g.menu_screen == 'settings', 'открыты настройки')
    for tid in ('game', 'graphics', 'interface', 'audio', 'keys'):
        click(g, item(g, 'tab', tid).center)
        check(g.set_tab == tid, f'вкладка {tid}')
        shot(g, f'm20_settings_{tid}')
    click(g, item(g, 'tab', 'interface').center)
    v0 = bool(settings.get('show_hotkeys'))
    click(g, item(g, 'ctl', 'show_hotkeys').center)
    check(bool(settings.get('show_hotkeys')) != v0, 'флажок «буквы клавиш» переключился')
    click(g, item(g, 'ctl', 'player_name').center)
    for _ in range(10):
        key(g, pygame.K_BACKSPACE)
    for ch in 'Тест':
        key(g, pygame.K_a, ch)
    key(g, pygame.K_RETURN)
    check(settings.get('player_name') == 'Тест', 'имя игрока введено')
    click(g, item(g, 'tab', 'audio').center)
    r = item(g, 'ctl', 'voice_vol')
    click(g, (r.x + 12, r.centery))
    check(g.audio.settings['voice_vol'] < 0.1, 'голоса: ползунок к нулю')
    click(g, item(g, 'tab', 'game').center)
    choose_set(g, 'autosave', 5)
    check(settings.get('autosave') == 5, 'автосохранение 5 минут')
    click(g, item(g, 'tab', 'keys').center)
    click(g, item(g, 'key', 'pause').center)
    check(g.key_capture == 'pause', 'ожидание клавиши')
    key(g, pygame.K_k)
    check(keymap.key_for('pause') == pygame.K_k and keymap.matches('pause', pygame.K_k), 'пауза → K')
    check(not keymap.matches('pause', pygame.K_p), 'старая запасная клавиша больше не действует')
    raw = json.load(open(os.path.join(HOME, 'settings.json')))
    check(raw.get('keys', {}).get('pause') == 'k' and raw.get('player_name') == 'Тест', 'записано в файл')
    check('music_vol' in raw and 'voice_vol' in raw, 'ключи звука сохранены рядом')
    settings.reload()
    check(settings.get('autosave') == 5 and keymap.key_for('pause') == pygame.K_k, 'читается заново из файла')
    click(g, item(g, 'keys_reset').center)
    check(keymap.key_for('pause') == pygame.K_F3, 'клавиши по умолчанию')
    settings.put('autosave', 0)
    key(g, pygame.K_ESCAPE)
    check(g.menu_screen == 'main', 'Esc — назад')


def choose_set(g, key_, value):
    click(g, item(g, 'ctl', key_).center)
    anchor, k, vals, lbls, idx = g.set_drop
    click(g, widgets.list_rects(SCREEN_H, anchor, len(lbls))[vals.index(value)][0].center)


# ============================================================ 5. сохранение / загрузка
def fingerprint(w):
    return (round(w.time, 3), len(w.units), len(w.buildings), len(w.nodes), len(w.animals),
            tuple(tuple(int(v) for v in p.res.values()) for p in w.players),
            tuple(sorted(p.techs) and len(p.techs) for p in w.players),
            tuple(p.age for p in w.players), sum(w.explored), round(sum(u.hp for u in w.units), 2),
            # рельеф (game/terrain.py): высоты, уровни, типы земли, обрывы, мелководье
            hash(tuple(tuple(r) for r in w.hz)), bytes(w.elev_map), bytes(w.ground), tuple(w.cliffs),
            tuple(tuple(r) for r in w.terrain))


def test_save_load(g):
    print('Сохранение и загрузка')
    random.seed(9)
    g.new_game(1, 2, ai_human=True, map_type='coast', civs=['britons', 'vikings', 'japanese'], teams=[0, 1, 1],
               levels=[4, 3, 3])
    w = g.world
    run(w, 9 * 60, 0.1)
    w.update(0.05)
    g.groups = {1: [u for u in w.units if u.owner == 0][:5]}
    g.help = 'menu'
    click(g, next(r for r, act, _, _ in g.game_menu_rects()[1] if act == 'save').center)
    check(g.help == 'save', 'F10 → «Сохранить»')
    shot(g, 'm30_save')
    for _ in range(40):
        key(g, pygame.K_BACKSPACE)
    for ch in 'Проверка':
        key(g, pygame.K_a, ch)
    fp = fingerprint(w)
    click(g, next(r for r, act, _ in g.saves_rects() if act == 'do').center)
    slots = savegame.list_slots()
    check(len(slots) == 1 and slots[0][1]['name'] == 'Проверка', 'слот с именем создан')
    check(slots[0][2] is not None and os.path.exists(slots[0][2]), 'миниатюра сохранена')
    check(slots[0][1]['civ'] == 'britons' and slots[0][1]['players'] == 3, 'заголовок: цивилизация, игроки')
    # продолжение без загрузки — эталон
    run(w, 60, 0.1)
    fp_after = fingerprint(w)
    # загрузка из меню F10
    g.help = 'menu'
    click(g, next(r for r, act, _, _ in g.game_menu_rects()[1] if act == 'load').center)
    check(g.help == 'load', 'F10 → «Загрузить»')
    shot(g, 'm31_load')
    click(g, next(r for r, act, _ in g.saves_rects() if act == 'do').center)
    w2 = g.world
    check(w2 is not w and fingerprint(w2) == fp, 'загруженный мир совпадает с сохранённым')
    check(w2.relief == w.relief and w2.hz == w.hz and w2.cliffs == w.cliffs,
          f'рельеф сохранён (холмы до {max(max(r) for r in w2.hz) / 16:.1f} ур., обрывов {len(w2.cliffs)}, '
          f'мелководья {sum(r.count(2) for r in w2.terrain)})')
    check(w2.ais and all(ai.w is w2 for ai in w2.ais), 'ИИ ссылаются на загруженный мир')
    check(all(u.p is w2.players[u.owner] for u in w2.units), 'юниты ссылаются на игроков мира')
    check(1 in g.groups and all(u in w2.units or not u.alive for u in g.groups[1]), 'группы восстановлены')
    run(w2, 60, 0.1)
    check(fingerprint(w2) == fp_after, 'детерминизм: минута после загрузки = минута без неё')
    t0 = time.time()
    try:
        for _ in range(5):
            g.update(0.05)
        run(w2, 5 * 60, 0.1)
        g.draw()
        ok = True
    except Exception as ex:
        import traceback
        traceback.print_exc()
        ok = False
        print('   ', ex)
    check(ok, f'ещё 5 минут после загрузки без ошибок ({time.time() - t0:.1f} с)')
    # переназначенная клавиша работает в игре
    g.help = False
    keymap.set_key('menu', pygame.K_j)
    key(g, pygame.K_F10)
    check(g.help is False, 'F10 после переназначения не открывает меню')
    key(g, pygame.K_j)
    check(g.help == 'menu', 'J — меню игры (переназначено)')
    g.help = False
    keymap.reset()
    # быстрые сохранение/загрузка
    key(g, keymap.key_for('quick_save'))
    check(any(s == 'quicksave' for s, _, _ in savegame.list_slots()), 'F7 — быстрое сохранение')
    t = g.world.time
    run(g.world, 20)
    key(g, keymap.key_for('quick_load'))
    check(abs(g.world.time - t) < 0.01, 'F8 — быстрая загрузка')
    # перезапуск и выход
    g.help = 'menu'
    click(g, next(r for r, act, _, _ in g.game_menu_rects()[1] if act == 'restart').center)
    check(g.help == 'confirm', 'перезапуск спрашивает подтверждение')
    shot(g, 'm32_confirm')
    click(g, g.confirm_rects()[1][0][0].center)
    check(g.state == 'loading', 'перезапуск → загрузка')
    g.finish_loading()
    check(g.state == 'play' and g.world.time < 1, 'новая партия с теми же параметрами')
    g.help = 'menu'
    click(g, next(r for r, act, _, _ in g.game_menu_rects()[1] if act == 'resign').center)
    click(g, g.confirm_rects()[1][0][0].center)
    check(not g.world.players[0].alive, 'сдача')
    g.help = False
    g.gameover_seen = False
    shot(g, 'm33_defeat')
    g.state = 'menu'
    g.menu_screen = 'main'
    click(g, item(g, 'single').center)
    click(g, item(g, 'load_game').center)
    check(g.menu_screen == 'load', 'главное меню → «Загрузить игру»')
    shot(g, 'm34_menu_load')
    sel = next(s for s, m, _ in savegame.list_slots() if m['name'] == 'Проверка')
    click(g, next(r for r, act, v in g.saves_rects() if act == 'slot' and v == sel).center)
    click(g, next(r for r, act, _ in g.saves_rects() if act == 'do').center)
    check(g.state == 'play' and abs(g.world.time - fp[0]) < 0.01, 'загрузка из главного меню')
    # битый файл — сообщение, без падения
    with open(savegame.slot_path('broken'), 'wb') as f:
        f.write(b'not a pickle')
    ok = g.do_load('broken')
    check(ok is False and g.saves_msg, 'битый файл: сообщение вместо падения')


def test_maps_save_load(g):
    """Каждая карта DE: партия идёт, сохранение → загрузка даёт тот же мир и то же продолжение."""
    from game import maps
    print('Карты: сохранение и загрузка')
    for i, mt in enumerate(maps.LOBBY):
        random.seed(40 + i)
        g.new_game(1, 1, ai_human=True, map_type=mt, civs=['franks', 'britons'])
        w = g.world
        run(w, 90, 0.1)

        def extra(w):
            return (getattr(w, 'theme', None), len(getattr(w, 'relics', ()) or ()),
                    sum(1 for b in w.buildings if b.d.get('wall')),
                    sum(1 for a in w.animals if a.kind == 'wolf'))
        fp = fingerprint(w) + extra(w)
        savegame.save_world(w, 'map_' + mt, name=mt)
        run(w, 30, 0.1)
        fp_after = fingerprint(w) + extra(w)
        w2, _, meta = savegame.load_world('map_' + mt)
        ok = fingerprint(w2) + extra(w2) == fp and meta.get('map') == mt
        run(w2, 30, 0.1)
        det = fingerprint(w2) + extra(w2) == fp_after
        check(ok and det, f'{maps.name(mt)} ({mt}, {w.W}², пейзаж {extra(w)[0]}, реликвий {extra(w)[1]}, '
                          f'стен {extra(w)[2]}, волков {extra(w)[3]}): загрузка = сохранение, продолжение совпадает')
        savegame.delete_slot('map_' + mt)


def main():
    global OUT
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default='')
    a = ap.parse_args()
    OUT = a.out
    if OUT:
        os.makedirs(OUT, exist_ok=True)
    random.seed(1)
    g = Game()
    test_rules()
    test_lobby(g)
    test_settings(g)
    test_stats(g)
    test_save_load(g)
    test_maps_save_load(g)
    pygame.quit()
    print('ИТОГ:', 'всё хорошо' if not FAILS else f'{len(FAILS)} ошибок: ' + '; '.join(FAILS))
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
