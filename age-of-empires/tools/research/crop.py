#!/usr/bin/env python3
"""Вырезать и увеличить область картинки: crop.py in.png out.png x y w h [scale]"""
import os
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
import pygame  # noqa: E402

src, out, x, y, w, h = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:7])
k = float(sys.argv[7]) if len(sys.argv) > 7 else 1.0
im = pygame.image.load(src).subsurface((x, y, w, h))
pygame.image.save(pygame.transform.smoothscale(im, (int(w * k), int(h * k))), out)
