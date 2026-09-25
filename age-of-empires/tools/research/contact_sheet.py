#!/usr/bin/env python3
"""Контактный лист картинок (для просмотра референсов): contact_sheet.py out.png cols w img1 img2 ...
Подписывает каждую картинку именем файла."""
import os
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
import pygame  # noqa: E402

out, cols, w = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
files = sys.argv[4:]
pygame.init()
f = pygame.font.SysFont(None, 22)
ims = []
for p in files:
    im = pygame.image.load(p)
    h = int(im.get_height() * w / im.get_width())
    ims.append((os.path.basename(p), pygame.transform.smoothscale(im, (w, h))))
rows = (len(ims) + cols - 1) // cols
rh = max(i.get_height() for _, i in ims) + 4
sheet = pygame.Surface((cols * (w + 4), rows * rh))
sheet.fill((40, 40, 40))
for k, (n, im) in enumerate(ims):
    x, y = (k % cols) * (w + 4), (k // cols) * rh
    sheet.blit(im, (x, y))
    t = f.render(n, True, (255, 255, 0), (0, 0, 0))
    sheet.blit(t, (x + 2, y + 2))
pygame.image.save(sheet, out)
print(out, sheet.get_size())
