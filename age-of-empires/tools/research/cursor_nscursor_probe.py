#!/usr/bin/env python3
"""Настоящее окно на macOS: что именно macOS получает от SDL для каждого курсора — размер NSImage в пунктах,
пиксельный размер представления, hotSpot, и коэффициент Retina окна (backingScaleFactor). Отсюда физический
размер курсора на экране = пункты × backingScaleFactor. Не требует разрешения «Запись экрана».
  PYTHONPATH=<pyobjc> .venv/bin/python tools/research/cursor_nscursor_probe.py
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
os.environ.pop('SDL_VIDEODRIVER', None)

import pygame  # noqa: E402
from AppKit import NSCursor, NSApp, NSScreen  # noqa: E402

from game import uiskin  # noqa: E402
from game.data import SCREEN_W, SCREEN_H  # noqa: E402


def main():
    pygame.init()
    screen = pygame.display.set_mode((SCREEN_W, SCREEN_H), pygame.SCALED)
    info = dict(pygame=pygame.version.ver, sdl=pygame.version.SDL,
                surface=screen.get_size(), window_size=pygame.display.get_window_size(),
                desktop=[tuple(s) for s in pygame.display.get_desktop_sizes()])
    scr = NSScreen.mainScreen()
    info['screen_backing_scale'] = float(scr.backingScaleFactor())
    info['screen_frame_pts'] = [float(v) for v in (scr.frame().size.width, scr.frame().size.height)]
    try:
        import pygame._sdl2.video as v
        win = v.Window.from_display_module()
        info['sdl_window_pts'] = tuple(win.size)
        try:
            r = v.Renderer.from_window(win)
            info['renderer_logical'] = tuple(r.logical_size)
            info['renderer_scale'] = tuple(r.scale)
        except Exception as e:  # noqa
            info['renderer_err'] = repr(e)
    except Exception as e:  # noqa
        info['sdl2_err'] = repr(e)
    wins = NSApp.windows() if NSApp else []
    if wins:
        w0 = wins[0]
        info['nswindow_backing_scale'] = float(w0.backingScaleFactor())
        fr = w0.contentView().frame().size
        bb = w0.contentView().convertRectToBacking_(w0.contentView().bounds()).size
        info['nswindow_content_pts'] = [float(fr.width), float(fr.height)]
        info['nswindow_content_px'] = [float(bb.width), float(bb.height)]
    cur = uiskin.Cursors()
    res = {}
    for st in ['arrow', 'attack', 'build', 'repair', 'garrison', 'heal', 'tree', 'gold', 'stone', 'berries',
               'farm', 'meat', 'fish', 'drop', 'rally', 'no']:
        cur.set(st)
        pygame.mouse.set_pos((640, 400))
        end = time.time() + 0.25
        while time.time() < end:
            pygame.event.pump()
            screen.fill((40, 110, 40))
            pygame.display.flip()
            time.sleep(0.03)
        c = NSCursor.currentCursor()
        img = c.image()
        sz = img.size()
        reps = [(int(r.pixelsWide()), int(r.pixelsHigh())) for r in img.representations()]
        hs = c.hotSpot()
        res[st] = dict(image_pts=[float(sz.width), float(sz.height)], reps_px=reps, hotspot_pts=[float(hs.x), float(hs.y)],
                       on_screen_px=[float(sz.width) * info['screen_backing_scale'], float(sz.height) * info['screen_backing_scale']])
        print(f"{st:8} NSImage {res[st]['image_pts']} pt, bitmap {reps} px, hotSpot {res[st]['hotspot_pts']} pt → на экране {res[st]['on_screen_px']} физ.px")
    info['cursors'] = res
    out = os.path.join('shots', 'research_cursor', 'nscursor.json')
    with open(out, 'w') as f:
        json.dump(info, f, indent=1, ensure_ascii=False)
    print(json.dumps({k: v for k, v in info.items() if k != 'cursors'}, ensure_ascii=False))
    pygame.quit()


if __name__ == '__main__':
    main()
