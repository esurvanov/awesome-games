#!/usr/bin/env python3
"""Безоконная проверка звука (SDL dummy):
  1) у каждого события/имени, которое может запросить Audio, есть файл в assets/audio (или назван
     процедурный запасной), все файлы манифеста существуют и загружаются;
  2) все типы событий мира (emit(...) в game/) проходят через Audio и дают звук;
  3) «жаркий бой» 6 с реального времени (≈40 ударов, 10 выстрелов, 2 смерти за кадр) — сколько звуков
     каждого вида реально запущено (ограничение частоты: без лавины);
  4) музыка: меню → мирный плейлист → бой (гистерезис) → затишье → мир → пьеса победы.
Запуск: .venv/bin/python tools/audio_check.py [--no-assets]   (--no-assets: как без папки assets/audio —
процедурная замена). Код выхода 1 — если что-то не так."""
import os
import random
import re
import sys
import time

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
sys.path.insert(0, ROOT)

import pygame  # noqa: E402

from game import sound, playlist  # noqa: E402
from game.data import BUILDINGS  # noqa: E402


class P:
    def __init__(self, i, team):
        self.id, self.team = i, team


class W:
    human = 0

    def __init__(self):
        self.players = [P(0, 0), P(1, 1), P(2, 0)]

    def allied(self, a, b):
        return self.players[a].team == self.players[b].team

    def visible_px(self, x, y):
        return x < 2000


class U:
    def __init__(self, kind, owner=0):
        self.kind, self.owner, self.alive = kind, owner, True


class G:
    state = 'play'

    def __init__(self):
        self.world = W()
        self.events = []
        self.selected = []

    def w2s(self, x, y):
        return x - 300, y


def emitted_types():
    types = set()
    for dp, _, fn in os.walk(os.path.join(ROOT, 'game')):
        for f in fn:
            if f.endswith('.py'):
                with open(os.path.join(dp, f), encoding='utf-8') as fh:
                    types |= set(re.findall(r"emit\('(\w+)'", fh.read()))
    return types


SAMPLE_EVENTS = {
    'hit': [('hit', 640, 400, 1, 'long_swordsman', 'militia'), ('hit', 640, 400, 0, 'archer', 'spearman'),
            ('hit', 640, 400, 1, 'pikeman', 'knight'), ('hit', 640, 400, 1, 'mangonel', 'house'),
            ('hit', 640, 400, 1, 'ram', 'castle'), ('hit', 640, 400, 1, 'hand_cannoneer', 'militia'),
            ('hit', 640, 400, 1, 'tower', 'militia'), ('hit', 640, 400, 1, 'villager', 'house'),
            ('hit', 640, 400, 1, 'galley', 'galley'), ('hit', 640, 400, 1, 'boar', 'villager')],
    'death': [('death', 640, 400, 1, k) for k in ('villager', 'militia', 'knight', 'war_elephant', 'camel_rider',
                                                   'galley', 'sheep', 'deer', 'boar', 'ram')],
    'arrow': [('arrow', 640, 400, 1, k) for k in ('archer', 'skirmisher', 'janissary', 'mangonel', 'scorpion',
                                                   'bombard_cannon', 'cannon_galleon', 'tower')],
    'destroy': [('destroy', 640, 400, 1, 'house')],
    'work': [('work', 640, 400, 0, k) for k in ('chop', 'mine', 'farm', 'forage', 'butcher', 'build', 'fish')],
    'place': [('place', 640, 400, 0, 'house')],
    'build_done': [('build_done', 640, 400, 0, k) for k in BUILDINGS],
    'train_done': [('train_done', 640, 400, 0, k) for k in ('villager', 'militia', 'knight', 'monk', 'galley', 'ram')],
    'tech_done': [('tech_done', 640, 400, 0, 'loom')],
    'age_up': [('age_up', 640, 400, 0, 2), ('age_up', 640, 400, 1, 2)],
    'attack_alert': [('attack_alert', 640, 400, 0, 'house'), ('attack_alert', 640, 400, 0, 'villager')],
    'defeat': [('defeat', 640, 400, 1, None), ('defeat', 640, 400, 2, None)],
    'game_over': [('game_over', 0, 0, 0, None)],
    'garrison': [('garrison', 640, 400, 0, 'villager')], 'eject': [('eject', 640, 400, 0, 3)],
    'bell': [('bell', 640, 400, 0, 5)], 'upgrade': [('upgrade', 640, 400, 0, 'guard_tower')],
    'market': [('market', 640, 400, 0, 'buy', 'wood')], 'tribute': [('tribute', 640, 400, 0, 1, 'gold', 100)],
    'trade': [('trade', 640, 400, 0, 'trade_cart', 50)], 'reseed': [('reseed', 640, 400, 0, 'farm')],
    'convert_start': [('convert_start', 640, 400, 0, 'knight')], 'convert': [('convert', 640, 400, 0, 'knight', 1)],
    'pack': [('pack', 640, 400, 0, 'trebuchet', True)], 'blast': [('blast', 640, 400, 1, 'mangonel')],
    'explode': [('explode', 640, 400, 1, 'demolition_ship')], 'board': [('board', 640, 400, 0, 'militia')],
    'unload': [('unload', 640, 400, 0, 'transport_ship')],
    'flare': [('flare', 640, 400, 0, None), ('flare', 640, 400, 2, None)],
}


def fresh(au):
    au.last.clear()
    au.playing.clear()
    pygame.mixer.stop()


def main():
    if '--no-assets' in sys.argv:
        sound.AUDIO_DIR = os.path.join(ROOT, 'assets', 'нет-такой-папки')
    sound.pre_init()
    pygame.init()
    t = time.perf_counter()
    au = sound.Audio()
    t_init = (time.perf_counter() - t) * 1000
    while not au.loaded and time.perf_counter() - t < 20:
        time.sleep(0.02)
    print(f'Audio(): {t_init:.0f} мс в основном потоке; эффекты в фоне за {au.sfx_time:.2f} с, '
          f'{len(au.sfx)} имён, {sum(len(v) for v in au.sfx.values())} звуков; музыка: {type(au.music).__name__}')
    bad = []
    man = au.man
    # ---- 1. файлы и покрытие
    for p in man.get('files', {}):
        if not os.path.exists(os.path.join(sound.AUDIO_DIR, p)):
            bad.append('нет файла ' + p)
    for n in sorted(sound.runtime_names()):
        r = au.resolve(n)
        src = 'файл' if r in man.get('sfx', {}) else 'процедурный' if r in sound.SFX else None
        if r is None:
            bad.append('нет звука для ' + n)
        elif src != 'файл':
            print(f'  {n:<18} → {r} ({src})')
    print(f'имён событий: {len(sound.runtime_names())}; без файла — перечислены выше (если есть)')
    # ---- 2. все типы событий
    g = G()
    types = emitted_types()
    missing = types - set(SAMPLE_EVENTS) - {'select', 'command'}
    if missing:
        bad.append('нет примера события: ' + ', '.join(sorted(missing)))
    for typ in sorted(SAMPLE_EVENTS):
        for ev in SAMPLE_EVENTS[typ]:
            fresh(au)
            before = sum(au.stats.values())
            au.process(g, [ev])
            if typ == 'game_over' and getattr(au.music, 'kind', None) in ('victory', 'defeat'):
                continue                   # итог звучит пьесой музыки
            if sum(au.stats.values()) == before:
                bad.append(f'тишина: {ev}')
    for kind in ['villager', 'militia', 'archer', 'knight', 'war_elephant', 'ram', 'galley', 'monk']:
        g.selected = [U(kind)]
        for cmd in ('move', 'attack', 'gather', 'work', 'garrison'):
            fresh(au)
            before = sum(au.stats.values())
            au.voice(g, 'command', cmd)
            if sum(au.stats.values()) == before:
                bad.append(f'тишина: приказ {cmd} для {kind}')
        fresh(au)
        before = sum(au.stats.values())
        au.voice(g, 'select', kind)
        if sum(au.stats.values()) == before:
            bad.append(f'тишина: выбор {kind}')
    g.selected = []
    for kind in list(BUILDINGS) + ['tree', 'gold', 'stone', 'berries', 'sheep', 'boar']:
        fresh(au)
        before = sum(au.stats.values())
        g.selected = [U(kind)]
        au.voice(g, 'select', kind)
        if sum(au.stats.values()) == before:
            bad.append(f'тишина: выбор {kind}')
    print(f'типы событий в коде: {len(types)} ({", ".join(sorted(types))}); все дали звук: '
          f'{"да" if not [b for b in bad if b.startswith("тишина")] else "нет"}')
    # ---- 3. жаркий бой
    fresh(au)
    au.stats.clear()
    rnd = random.Random(1)
    melee = ['long_swordsman', 'pikeman', 'knight', 'champion']
    frames, fps = 360, 60
    ev_count = 0
    t0 = time.perf_counter()
    for f in range(frames):
        evs = []
        for _ in range(40):
            evs.append(('hit', rnd.uniform(400, 900), rnd.uniform(200, 600), rnd.choice((0, 1)), rnd.choice(melee),
                        rnd.choice(melee)))
        for _ in range(10):
            evs.append(('arrow', rnd.uniform(400, 900), rnd.uniform(200, 600), 1, rnd.choice(('archer', 'crossbowman'))))
            evs.append(('hit', rnd.uniform(400, 900), rnd.uniform(200, 600), 0, 'archer', 'militia'))
        for _ in range(2):
            evs.append(('death', rnd.uniform(400, 900), rnd.uniform(200, 600), rnd.choice((0, 1)),
                        rnd.choice(melee + ['villager'])))
        if f % 30 == 0:
            evs.append(('destroy', 700, 400, 0, 'house'))
            evs.append(('blast', 700, 400, 1, 'mangonel'))
        for _ in range(6):
            evs.append(('work', rnd.uniform(400, 900), rnd.uniform(200, 600), 0, rnd.choice(('chop', 'mine', 'build'))))
        ev_count += len(evs)
        g.events = evs
        au.update(g, 1 / fps)
        time.sleep(max(0.0, t0 + (f + 1) / fps - time.perf_counter()))
    secs = time.perf_counter() - t0
    tot = sum(au.stats.values())
    print(f'\nбой: {ev_count} событий за {secs:.1f} с → {tot} звуков ({tot / secs:.1f}/с)')
    groups = {}
    for n, c in sorted(au.stats.items()):
        groups.setdefault(sound.group_of(n), []).append(f'{n}×{c}')
    for gname, lst in sorted(groups.items()):
        c = sum(int(s.split('×')[1]) for s in lst)
        gap = sound.RULES.get(gname, (0.05, 2))[0]
        print(f'  {gname:<12} {c:>4} ({c / secs:4.1f}/с, предел {1 / gap:4.1f}/с)  {" ".join(lst)}')
        if c / secs > 1 / gap + 0.5:
            bad.append(f'лавина {gname}')
    if tot / secs > 80:
        bad.append('слишком много звуков в секунду')
    print(f'накал боя для музыки: {au.combat:.2f}')
    # ---- 4. музыка (ускоренный гистерезис)
    m = au.music
    if isinstance(m, playlist.TrackPlayer):
        playlist.BATTLE_MIN, playlist.CALM_HOLD = 2.0, 1.0
        playlist.FADE_OUT = playlist.FADE_IN = 0.2
        m.log.clear()
        seq = []

        def run(mode, secs, intensity):
            end = time.perf_counter() + secs
            while time.perf_counter() < end:
                m.update(mode, 1 / 30, intensity)
                time.sleep(1 / 30)
            seq.append((mode, intensity, m.kind, m.title.get(m.cur, None), pygame.mixer.music.get_busy()))

        run('menu', 0.6, 0)
        run('play', 0.6, 0)
        run('play', 0.3, 0.5)              # стычка ниже порога — мир
        run('play', 0.6, 1.2)              # бой
        run('play', 0.5, 0.1)              # затишье, но бой ещё идёт (минимум по времени)
        run('play', 2.5, 0.1)              # затишье выдержано — мир
        m.stinger(True)
        run('play', 0.6, 0)
        for s in seq:
            print(f'  режим {s[0]:<5} накал {s[1]:<4} → {s[2]!s:<8} «{s[3]}» играет={s[4]}')
        kinds = [s[2] for s in seq]
        want = ['menu', 'peace', 'peace', 'battle', 'battle', 'peace', 'victory']
        if kinds != want:
            bad.append(f'музыка: {kinds} ≠ {want}')
    pygame.quit()
    if bad:
        print('\nОШИБКИ:\n  ' + '\n  '.join(bad))
        sys.exit(1)
    print('\nok')


if __name__ == '__main__':
    main()
