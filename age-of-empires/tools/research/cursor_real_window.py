#!/usr/bin/env python3
"""Замер курсора в НАСТОЯЩЕМ окне (macOS, Retina): для каждого состояния ставим курсор, ведём мышь в известную
точку, снимаем экран вместе с курсором (`screencapture -C`) и меряем: физический размер курсора и куда
на самом деле легла точка прицела относительно нарисованного маркера. Игру не меняет.
  .venv/bin/python tools/research/cursor_real_window.py [--out shots/research_cursor/real]
Требуется разрешение «Запись экрана» для терминала (иначе курсор в снимке не появится).
"""
import argparse
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
os.environ.pop('SDL_VIDEODRIVER', None)

import numpy as np  # noqa: E402
import pygame  # noqa: E402
from PIL import Image  # noqa: E402

from game import uiskin  # noqa: E402
from game.data import SCREEN_W, SCREEN_H  # noqa: E402

MARK = (640, 400)                # точка, куда ставим мышь (логические px окна)
BG = (40, 110, 40)
MAGENTA = (255, 0, 255)


def capture(path):
    subprocess.run(['screencapture', '-C', '-x', '-t', 'png', path], check=True)


def find_marker(arr):
    """Магентовый квадрат 20×20 в логических px в (100,100) → (x, y, масштаб) снимка."""
    m = (arr[..., 0] > 240) & (arr[..., 1] < 20) & (arr[..., 2] > 240)
    ys, xs = np.nonzero(m)
    if len(xs) == 0:
        return None
    # квадрат — самая плотная область; берём рамку всех магентовых пикселей близ левого верха
    x0, x1 = xs.min(), xs.max()
    # два маркера: (100,100) и (1180,700) — разделим по x
    left = xs < (x0 + x1) / 2
    lx0, ly0, lx1 = xs[left].min(), ys[left].min(), xs[left].max()
    rx0 = xs[~left].min()
    scale = (rx0 - lx0) / (1180 - 100)
    return int(lx0), int(ly0), float(scale), int(lx1 - lx0 + 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join('shots', 'research_cursor', 'real'))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    pygame.init()
    screen = pygame.display.set_mode((SCREEN_W, SCREEN_H), pygame.SCALED)
    pygame.display.set_caption('cursor probe')
    win = pygame.display.get_window_size() if hasattr(pygame.display, 'get_window_size') else None
    info = dict(window_size=win, desktop_sizes=[tuple(s) for s in pygame.display.get_desktop_sizes()],
                sdl=pygame.version.SDL, pygame=pygame.version.ver)
    try:
        import pygame._sdl2.video as v
        w = v.Window.from_display_module()
        info['window_size_pts'] = tuple(w.size)
        r = v.Renderer.from_window(w) if hasattr(v.Renderer, 'from_window') else None
        if r is not None:
            info['renderer_logical'] = tuple(r.logical_size)
            info['renderer_output'] = tuple(r.get_viewport().size) if hasattr(r, 'get_viewport') else None
    except Exception as e:  # noqa
        info['sdl2_err'] = repr(e)
    cur = uiskin.Cursors()

    def draw():
        screen.fill(BG)
        pygame.draw.rect(screen, MAGENTA, (100, 100, 20, 20))
        pygame.draw.rect(screen, MAGENTA, (1180, 700, 20, 20))
        # тонкий крест в точке MARK (жёлтый), чтобы видеть её и глазами
        pygame.draw.line(screen, (255, 255, 0), (MARK[0] - 40, MARK[1]), (MARK[0] + 40, MARK[1]), 1)
        pygame.draw.line(screen, (255, 255, 0), (MARK[0], MARK[1] - 40), (MARK[0], MARK[1] + 40), 1)
        pygame.display.flip()

    def settle(t=0.35):
        end = time.time() + t
        while time.time() < end:
            pygame.event.pump()
            draw()
            time.sleep(0.03)

    settle(1.0)
    # базовый снимок: мышь далеко от MARK
    pygame.mouse.set_pos((300, 650))
    settle()
    base_p = os.path.join(args.out, '_base.png')
    capture(base_p)
    base = np.asarray(Image.open(base_p).convert('RGB')).astype(int)
    mk = find_marker(base)
    info['marker'] = mk
    print('маркер', mk, 'снимок', base.shape)
    if mk is None:
        print('маркер не найден — окно не видно?')
        return
    mx, my, scale, msz = mk
    ox, oy = mx - 100 * scale, my - 100 * scale         # начало окна в снимке
    ex, ey = ox + MARK[0] * scale, oy + MARK[1] * scale  # ожидаемое место точки прицела (физ. px)
    info['expected_phys'] = (ex, ey)
    res = {}
    states = ['arrow', 'attack', 'build', 'repair', 'garrison', 'heal', 'tree', 'gold', 'stone', 'berries',
              'farm', 'meat', 'fish', 'drop', 'rally', 'no']
    for st in states:
        cur.set(st)
        pygame.mouse.set_pos(MARK)
        settle()
        p = os.path.join(args.out, f'{st}.png')
        capture(p)
        img = np.asarray(Image.open(p).convert('RGB')).astype(int)
        R = int(120 * scale)
        y0, y1 = int(ey) - R, int(ey) + R
        x0, x1 = int(ex) - R, int(ex) + R
        d = np.abs(img[y0:y1, x0:x1] - base[y0:y1, x0:x1]).sum(-1)
        m = d > 60
        # убрать след жёлтого креста/маркера (они одинаковы в обоих снимках) — они и так вычтены
        ys, xs = np.nonzero(m)
        if len(xs) == 0:
            res[st] = dict(found=False)
            print(st, 'курсор не найден в снимке')
            continue
        bx0, by0, bx1, by1 = xs.min() + x0, ys.min() + y0, xs.max() + x0, ys.max() + y0
        s = xs + ys
        i = s.argmin()
        tip = (int(xs[i] + x0), int(ys[i] + y0))
        # обрезок ×1 для контакт-листа
        crop = Image.open(p).convert('RGB').crop((bx0 - 4, by0 - 4, bx1 + 5, by1 + 5))
        crop.save(os.path.join(args.out, f'{st}_crop.png'))
        r = dict(found=True, bbox_phys=[int(bx0), int(by0), int(bx1), int(by1)],
                 size_phys=[int(bx1 - bx0 + 1), int(by1 - by0 + 1)],
                 size_logical=[round((bx1 - bx0 + 1) / scale, 1), round((by1 - by0 + 1) / scale, 1)],
                 tip_phys=tip, tip_err_logical=[round((tip[0] - ex) / scale, 1), round((tip[1] - ey) / scale, 1)],
                 bbox_origin_err_logical=[round((bx0 - ex) / scale, 1), round((by0 - ey) / scale, 1)])
        res[st] = r
        print(f'{st:8} размер физ={r["size_phys"]} лог={r["size_logical"]} '
              f'левый-верх рамки − точка мыши = {r["bbox_origin_err_logical"]} лог.px; крайняя точка (min x+y) − мышь = {r["tip_err_logical"]}')
    info['results'] = res
    info['scale'] = scale
    with open(os.path.join(args.out, 'real.json'), 'w') as f:
        json.dump(info, f, indent=1, ensure_ascii=False)
    print(json.dumps({k: v for k, v in info.items() if k != 'results'}, ensure_ascii=False))
    pygame.quit()


if __name__ == '__main__':
    main()
