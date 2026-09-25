#!/usr/bin/env python3
"""Значки интерфейса «по словарю DE» (docs/research/05_ui_recognition.md): переназначенные и составленные
из портретов технологий 0 A.D. (CC BY-SA 3.0, Wildfire Games) и нарисованные процедурно (свои) —
→ assets/ui/portraits/de/<имя>.png (128×128), курсоры → assets/ui/cursors/de_*.png.

Вызывается из tools/build_ui_assets.py (или отдельно: .venv/bin/python tools/ui_icon_art.py [--sheet FILE]).

Приёмы:
  blacken(имя)   — предмет 0 A.D. на чистом чёрном фоне (DE, правило 2): фон портретов 0 A.D. — общий
                   сине-серый градиент; его модель — медиана по всем портретам технологий, маска предмета —
                   отличие пикселя от фона;
  cutout(имя)    — предмет с прозрачным фоном (для составных значков, курсоров, значков характеристик);
  процедурно     — книги, клетчатая ткань, хомут, чаша, луч, литера, кран, бойница, короны, гербы эпох,
                   свиток с галочкой, шестерня, рог, строи, восьмиугольная рамка стоек, валун.
Рисунок — в 4× и уменьшение (мягкие края).
"""
import argparse
import math
import os
import sys

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RAW = os.path.join(ROOT, 'assets', '0ad_raw')
if not os.path.isdir(RAW):
    alt = os.path.abspath(os.path.join(ROOT, '..', '..', '..', 'assets', '0ad_raw'))
    RAW = alt if os.path.isdir(alt) else RAW
PORT = os.path.join(RAW, 'public', 'art', 'textures', 'ui', 'session', 'portraits')
TECH = os.path.join(PORT, 'technologies')
CURSORS = os.path.join(RAW, 'public', 'art', 'textures', 'cursors')
OUT = os.path.join(ROOT, 'assets', 'ui', 'portraits', 'de')
CUR_OUT = os.path.join(ROOT, 'assets', 'ui', 'cursors')
FONTS = os.path.join(ROOT, 'assets', 'fonts')
N = 128
K = 4                     # сверхвыборка процедурного рисунка
B = N * K

_bg = None


# ================================================================ портреты 0 A.D.
def src(name, sub=TECH):
    return Image.open(os.path.join(sub, name + '.png')).convert('RGBA').resize((N, N), Image.LANCZOS)


def bg_model():
    """Фон портретов технологий 0 A.D. (медиана по всем) — (N, N, 3) float."""
    global _bg
    if _bg is None:
        fs = sorted(f for f in os.listdir(TECH) if f.endswith('.png'))
        arr = np.stack([np.asarray(Image.open(os.path.join(TECH, f)).convert('RGB').resize((N, N)), np.float32)
                        for f in fs])
        _bg = np.median(arr, axis=0)
    return _bg


def fg_alpha(img, lo=16.0, hi=46.0):
    """Маска предмета: насколько пиксель отличается от общего фона 0 A.D."""
    a = np.asarray(img.convert('RGB'), np.float32)
    d = np.sqrt(((a - bg_model()) ** 2).sum(-1))
    m = np.clip((d - lo) / (hi - lo), 0, 1)
    m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))
                   .filter(ImageFilter.GaussianBlur(0.7)), np.float32) / 255
    return m


def blacken(name, k=1.0):
    """Предмет на чистом чёрном (DE) — фон 0 A.D. затемняется до #000."""
    img = src(name)
    a = np.asarray(img.convert('RGB'), np.float32)
    m = fg_alpha(img)[..., None]
    out = a * m + a * (1 - m) * (1 - k) * 0.25
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGB').convert('RGBA')


def cutout(name, lo=16.0, hi=46.0, crop=True):
    img = src(name)
    m = fg_alpha(img, lo, hi)
    out = np.asarray(img, np.uint8).copy()
    out[..., 3] = (m * 255).astype(np.uint8)
    im = Image.fromarray(out, 'RGBA')
    if crop:
        bb = im.getchannel('A').point(lambda v: 255 if v > 30 else 0).getbbox()
        if bb:
            im = im.crop(bb)
    return im


def tint_gold(img, region=None, strength=1.0):
    """Серые (ненасыщенные) светлые части → золото (руда, монета). region — (x0, y0, x1, y1) в долях."""
    a = np.asarray(img.convert('RGBA'), np.float32)
    rgb = a[..., :3]
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1)
    L = rgb @ np.array([0.3, 0.59, 0.11], np.float32)
    w = np.clip((0.32 - sat) / 0.2, 0, 1) * np.clip((L - 40) / 60, 0, 1) * strength
    if region:
        h, wd = L.shape
        x0, y0, x1, y1 = region
        m = np.zeros_like(L)
        m[int(y0 * h):int(y1 * h), int(x0 * wd):int(x1 * wd)] = 1
        m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4)),
                       np.float32) / 255
        w = w * m
    gold = np.stack([L * 1.25 + 30, L * 1.0 + 8, L * 0.35], -1)
    out = rgb * (1 - w[..., None]) + gold * w[..., None]
    a[..., :3] = np.clip(out, 0, 255)
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def paste_fit(base, im, box, rot=0.0):
    """Вписать im (RGBA) в прямоугольник box базового значка (доли 0..1), с поворотом rot°."""
    if rot:
        im = im.rotate(rot, resample=Image.BICUBIC, expand=True)
    W, H = base.size
    x0, y0, x1, y1 = box[0] * W, box[1] * H, box[2] * W, box[3] * H
    k = min((x1 - x0) / im.width, (y1 - y0) / im.height)
    im2 = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    base.alpha_composite(im2, (round((x0 + x1 - im2.width) / 2), round((y0 + y1 - im2.height) / 2)))
    return base


def drop_shadow(im, r=3, off=(2, 3), alpha=170):
    """Тень под вырезанным предметом (для наложения на узор)."""
    sh = Image.new('RGBA', (im.width + 4 * r, im.height + 4 * r), (0, 0, 0, 0))
    a = im.getchannel('A').point(lambda v: v * alpha // 255)
    blk = Image.new('RGBA', im.size, (0, 0, 0, 255))
    blk.putalpha(a)
    sh.alpha_composite(blk, (2 * r + off[0], 2 * r + off[1]))
    sh = sh.filter(ImageFilter.GaussianBlur(r))
    sh.alpha_composite(im, (2 * r, 2 * r))
    return sh


# ================================================================ процедурный рисунок
def canvas(bg=(0, 0, 0, 255)):
    return Image.new('RGBA', (B, B), bg)


def done(im):
    return im.resize((N, N), Image.LANCZOS)


def P(x, y):
    return (x * B, y * B)


def radial(size, inner, outer, center=(0.5, 0.5), r=0.7):
    h = w = size
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt((xx / w - center[0]) ** 2 + (yy / h - center[1]) ** 2) / r
    t = np.clip(d, 0, 1)[..., None]
    c = np.array(inner, np.float32) * (1 - t) + np.array(outer, np.float32) * t
    return Image.fromarray(np.dstack([c, np.full((h, w), 255, np.float32)]).astype(np.uint8), 'RGBA')


def vgrad(d, box, top, bot):
    x0, y0, x1, y1 = [int(v) for v in box]
    for y in range(y0, y1 + 1):
        t = (y - y0) / max(1, y1 - y0)
        d.line([(x0, y), (x1, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,))


def shade_poly(im, pts, top, bot, outline=None, width=0):
    """Многоугольник с вертикальным градиентом (объём)."""
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).polygon(pts, fill=255)
    ys = [p[1] for p in pts]
    g = Image.new('RGBA', im.size, (0, 0, 0, 0))
    vgrad(ImageDraw.Draw(g), (0, min(ys), im.size[0], max(ys)), top, bot)
    im.paste(g, (0, 0), mask)
    if outline:
        ImageDraw.Draw(im).polygon(pts, outline=outline, width=width)


def font(sz, kind='serif'):
    fn = {'serif': 'PTSerif-Bold.ttf', 'title': 'CormorantSC-Bold.ttf'}[kind]
    for p in (os.path.join(FONTS, fn), os.path.join(FONTS, 'LinBiolinum_RBah.ttf')):
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()


# ---------------------------------------------------------------- здания
def books():
    """Университет DE: стопка книг."""
    im = canvas()
    d = ImageDraw.Draw(im)
    specs = [(0.12, 0.66, 0.9, 0.84, (150, 40, 30)), (0.18, 0.5, 0.84, 0.66, (60, 80, 140)),
             (0.1, 0.34, 0.78, 0.5, (120, 70, 30))]
    for i, (x0, y0, x1, y1, col) in enumerate(specs):
        sk = 0.035 * (1 if i % 2 else -1)
        # страницы (торец)
        pg = [P(x0 + 0.03, y0 + 0.02), P(x1 - 0.02 + sk, y0 + 0.02), P(x1 - 0.02 + sk, y1 - 0.02), P(x0 + 0.03, y1 - 0.02)]
        shade_poly(im, pg, (250, 240, 214), (196, 178, 140))
        for k in range(1, 6):
            yy = y0 + 0.02 + (y1 - y0 - 0.04) * k / 6
            d.line([P(x0 + 0.05, yy), P(x1 - 0.03 + sk, yy)], fill=(170, 150, 110), width=K)
        # переплёт: верх, корешок слева
        cov = [P(x0, y0), P(x1 + sk, y0), P(x1 + sk, y0 + 0.035), P(x0, y0 + 0.035)]
        shade_poly(im, cov, tuple(min(255, c + 60) for c in col), col)
        cov2 = [P(x0, y1 - 0.03), P(x1 + sk, y1 - 0.03), P(x1 + sk, y1), P(x0, y1)]
        shade_poly(im, cov2, col, tuple(c // 2 for c in col))
        sp = [P(x0 - 0.02, y0), P(x0 + 0.05, y0), P(x0 + 0.05, y1), P(x0 - 0.02, y1)]
        shade_poly(im, sp, tuple(min(255, c + 40) for c in col), tuple(c // 2 for c in col))
        for yy in (y0 + (y1 - y0) * 0.3, y0 + (y1 - y0) * 0.7):
            d.line([P(x0 - 0.02, yy), P(x0 + 0.05, yy)], fill=(230, 190, 90), width=2 * K)
    return done(im)


def lumber_camp():
    """Лесопилка DE: топор, вбитый в бревно."""
    im = canvas()
    d = ImageDraw.Draw(im)
    # бревно по диагонали снизу-слева
    log = [P(0.0, 0.62), P(0.78, 0.44), P(0.86, 0.72), P(0.06, 0.98)]
    shade_poly(im, log, (170, 120, 70), (84, 52, 26))
    for i in range(7):                                     # кора
        t = i / 7
        d.line([P(0.02 + 0.76 * t, 0.66 - 0.18 * t + 0.02), P(0.06 + 0.78 * t, 0.9 - 0.2 * t)],
               fill=(70, 44, 22), width=2 * K)
    # торец
    cx, cy = P(0.82, 0.58)
    d.ellipse((cx - 0.075 * B, cy - 0.15 * B, cx + 0.075 * B, cy + 0.15 * B), fill=(214, 172, 110),
              outline=(96, 60, 30), width=2 * K)
    for r in (0.05, 0.028):
        d.ellipse((cx - r * B * 0.5, cy - r * B, cx + r * B * 0.5, cy + r * B), outline=(160, 116, 64), width=K)
    ax = cutout('wood_axe')
    ax = ax.rotate(-18, resample=Image.BICUBIC, expand=True)
    paste_fit(im, drop_shadow(ax.resize((ax.width * K, ax.height * K), Image.LANCZOS), r=3 * K), (0.1, 0.0, 0.84, 0.76))
    return done(im)


def pair_on_sky():
    """Городской центр DE: пара жителей на фоне неба."""
    from tools.build_portraits import sky_grass
    bg = sky_grass(B, horizon=0.7, seed=11)
    fg = cutout('population', lo=12, hi=40)
    paste_fit(bg, fg.resize((fg.width * K, fg.height * K), Image.LANCZOS), (0.0, 0.04, 1.0, 1.04))
    return done(bg)


# ---------------------------------------------------------------- технологии
def tartan():
    """Ткачество DE: клетчатая ткань (зелёно-красная шотландка) с объёмной складкой."""
    im = canvas((40, 80, 40, 255))
    a = np.zeros((B, B, 3), np.float32)
    yy, xx = np.mgrid[0:B, 0:B]
    u = (xx + yy * 0.35) % (B / 3.2)
    v = (yy - xx * 0.2) % (B / 3.2)
    base = np.array([46, 96, 52], np.float32)
    a[:] = base
    for band, col, w in ((0.0, (170, 40, 36), 0.18), (0.45, (36, 44, 90), 0.12), (0.72, (220, 200, 80), 0.035)):
        mu = (np.abs(u / (B / 3.2) - band) < w)
        mv = (np.abs(v / (B / 3.2) - band) < w)
        c = np.array(col, np.float32)
        a[mu] = a[mu] * 0.45 + c * 0.55
        a[mv] = a[mv] * 0.45 + c * 0.55
    fold = 0.75 + 0.35 * np.sin((xx / B * 2.2 + yy / B * 0.8) * math.pi)
    a = a * fold[..., None]
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGB').convert('RGBA')
    return done(im)


def horse_collar():
    """Хомут DE: мягкий кожаный хомут (уже вверху, шире внизу) и две металлические клещи с шишками."""
    im = canvas()
    d = ImageDraw.Draw(im)

    def ring(k):
        pts = []
        for i in range(60):
            a = i / 60 * 2 * math.pi
            rx = (0.26 + 0.1 * (1 + math.cos(a)) / 2) * k       # внизу (cos>0 → низ) шире
            ry = 0.38 * k
            pts.append(P(0.5 + math.sin(a) * rx, 0.52 + math.cos(a) * ry))
        return pts
    shade_poly(im, ring(1.12), (150, 96, 50), (70, 40, 18))
    shade_poly(im, ring(0.72), (20, 12, 6), (0, 0, 0))
    for i in range(14):                                         # стёжка подушки
        a = i / 14 * 2 * math.pi
        for k in (0.8, 1.04):
            rx = (0.26 + 0.1 * (1 + math.cos(a)) / 2) * k
            x, y = 0.5 + math.sin(a) * rx, 0.52 + math.cos(a) * 0.38 * k
            d.ellipse((x * B - K * 3, y * B - K * 3, x * B + K * 3, y * B + K * 3), fill=(210, 170, 110))
    for side in (-1, 1):                                        # клещи
        pts = [P(0.5 + side * 0.2, 0.02), P(0.5 + side * 0.27, 0.02), P(0.5 + side * 0.42, 0.62),
               P(0.5 + side * 0.34, 0.66)]
        shade_poly(im, pts, (236, 232, 226), (120, 116, 112))
        d.ellipse(((0.5 + side * 0.235) * B - 0.055 * B, -0.02 * B, (0.5 + side * 0.235) * B + 0.055 * B,
                   0.09 * B), fill=(226, 190, 96), outline=(120, 90, 30), width=K)
    return done(im)


def chalice():
    """Святость DE: золотая чаша."""
    im = radial(B, (60, 40, 10), (0, 0, 0), (0.5, 0.45), 0.6)
    gold = ((255, 232, 140), (150, 100, 20))
    shade_poly(im, [P(0.24, 0.16), P(0.76, 0.16), P(0.66, 0.46), P(0.56, 0.54), P(0.44, 0.54), P(0.34, 0.46)], *gold)
    d = ImageDraw.Draw(im)
    d.ellipse((0.24 * B, 0.12 * B, 0.76 * B, 0.21 * B), fill=(120, 20, 30), outline=(255, 230, 150), width=2 * K)
    shade_poly(im, [P(0.46, 0.54), P(0.54, 0.54), P(0.53, 0.76), P(0.47, 0.76)], *gold)
    d.ellipse((0.43 * B, 0.6 * B, 0.57 * B, 0.68 * B), fill=(230, 190, 80))
    shade_poly(im, [P(0.47, 0.76), P(0.53, 0.76), P(0.7, 0.88), P(0.3, 0.88)], *gold)
    d.ellipse((0.3 * B, 0.85 * B, 0.7 * B, 0.92 * B), fill=(170, 120, 30))
    for x, y in ((0.4, 0.3), (0.5, 0.33), (0.6, 0.3)):
        d.ellipse((x * B - 0.025 * B, y * B - 0.025 * B, x * B + 0.025 * B, y * B + 0.025 * B), fill=(60, 120, 220))
    d.line([P(0.32, 0.2), P(0.4, 0.44)], fill=(255, 250, 220), width=3 * K)
    return done(im)


def sunbeam():
    """Искупление грехов (DE: луч света сверху)."""
    a = np.zeros((B, B, 3), np.float32)
    yy, xx = np.mgrid[0:B, 0:B].astype(np.float32) / B
    ang = np.arctan2(xx - 0.5, yy + 0.25)
    rays = 0.5 + 0.5 * np.cos(ang * 22)
    fall = np.clip(1 - np.abs(xx - 0.5) * 1.6 - yy * 0.3, 0, 1)
    glow = np.exp(-((xx - 0.5) ** 2 + (yy - 0.05) ** 2) / 0.05)
    v = np.clip(fall * (0.35 + 0.65 * rays) + glow, 0, 1.3)
    a[..., 0] = 255 * v
    a[..., 1] = 225 * v
    a[..., 2] = 120 * v
    horizon = yy > 0.8
    a[horizon] = a[horizon] * 0.3 + np.array([80, 50, 20]) * 0.7
    return done(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGB').convert('RGBA'))


def open_book(glow=True):
    """Озарение DE: раскрытая книга, над ней свет."""
    im = radial(B, (255, 240, 180), (0, 0, 0), (0.5, 0.25), 0.55) if glow else canvas()
    for side in (-1, 1):
        pts = [P(0.5, 0.52), P(0.5 + 0.44 * side, 0.44), P(0.5 + 0.44 * side, 0.8), P(0.5, 0.88)]
        shade_poly(im, pts, (255, 248, 226), (200, 180, 140))
    d = ImageDraw.Draw(im)
    for side in (-1, 1):
        for k in range(6):
            y = 0.54 + k * 0.045
            d.line([P(0.5 + 0.06 * side, y + 0.03), P(0.5 + 0.38 * side, y - 0.02)], fill=(120, 100, 80), width=K)
    d.line([P(0.5, 0.52), P(0.5, 0.88)], fill=(90, 60, 30), width=2 * K)
    d.polygon([P(0.04, 0.8), P(0.5, 0.9), P(0.96, 0.8), P(0.96, 0.84), P(0.5, 0.94), P(0.04, 0.84)], fill=(110, 40, 30))
    return done(im)


def block_printing():
    """Книгопечатание DE: литера «А» на синем деревянном блоке."""
    im = canvas()
    shade_poly(im, [P(0.14, 0.3), P(0.72, 0.3), P(0.86, 0.16), P(0.28, 0.16)], (110, 150, 230), (70, 110, 200))
    shade_poly(im, [P(0.72, 0.3), P(0.86, 0.16), P(0.86, 0.74), P(0.72, 0.88)], (40, 70, 150), (20, 40, 100))
    shade_poly(im, [P(0.14, 0.3), P(0.72, 0.3), P(0.72, 0.88), P(0.14, 0.88)], (80, 120, 210), (40, 70, 160))
    d = ImageDraw.Draw(im)
    f = font(int(B * 0.55))
    d.text((0.43 * B + 6 * K, 0.6 * B + 6 * K), 'A', font=f, fill=(20, 30, 70), anchor='mm')
    d.text((0.43 * B, 0.6 * B), 'A', font=f, fill=(250, 214, 110), anchor='mm')
    return done(im)


def crane():
    """Подъёмный кран DE: деревянный кран с колесом."""
    im = radial(B, (90, 70, 40), (10, 8, 4), (0.5, 0.4), 0.8)
    d = ImageDraw.Draw(im)
    wood, dk = (200, 150, 80), (90, 60, 30)
    w = 4 * K
    d.line([P(0.3, 0.95), P(0.42, 0.12)], fill=wood, width=w)
    d.line([P(0.62, 0.95), P(0.44, 0.12)], fill=wood, width=w)
    d.line([P(0.42, 0.14), P(0.92, 0.3)], fill=wood, width=w)
    d.line([P(0.34, 0.7), P(0.58, 0.7)], fill=dk, width=3 * K)
    d.line([P(0.9, 0.3), P(0.9, 0.62)], fill=(230, 220, 190), width=K * 2)
    d.rectangle((0.84 * B, 0.62 * B, 0.96 * B, 0.72 * B), fill=(150, 150, 160))
    cx, cy, r = 0.3 * B, 0.66 * B, 0.2 * B
    d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=wood, width=3 * K)
    for i in range(8):
        a = i * math.pi / 4
        d.line([(cx, cy), (cx + math.cos(a) * r, cy + math.sin(a) * r)], fill=dk, width=2 * K)
    return done(im)


def arrowslit():
    """Бойницы DE: стрела вылетает из щели в каменной стене."""
    im = canvas()
    d = ImageDraw.Draw(im)
    rng = np.random.default_rng(3)
    rows = 6
    for r in range(rows):
        y0, y1 = r / rows, (r + 1) / rows
        off = 0.5 * (r % 2)
        for c in range(-1, 4):
            x0, x1 = (c + off) / 3, (c + off + 1) / 3
            g = int(rng.integers(120, 170))
            d.rectangle((x0 * B + K * 2, y0 * B + K * 2, x1 * B - K * 2, y1 * B - K * 2), fill=(g, g - 6, g - 16))
    d.rectangle((0.44 * B, 0.12 * B, 0.56 * B, 0.88 * B), fill=(10, 8, 6))
    ar = cutout('arrow')
    ar = ar.rotate(-35, resample=Image.BICUBIC, expand=True)
    paste_fit(im, drop_shadow(ar.resize((ar.width * K, ar.height * K), Image.LANCZOS), r=3 * K), (0.2, 0.18, 1.0, 0.98))
    return done(im)


def crown(silver=False):
    """Уникальная технология DE: корона (серебряная — эпоха замков, золотая — имперская)."""
    im = canvas()
    if silver:
        hi, lo, gem = (250, 250, 255), (120, 124, 140), (60, 90, 220)
    else:
        hi, lo, gem = (255, 236, 130), (170, 110, 20), (200, 30, 40)
    pts = [P(0.12, 0.72), P(0.12, 0.32), P(0.3, 0.52), P(0.5, 0.2), P(0.7, 0.52), P(0.88, 0.32), P(0.88, 0.72)]
    shade_poly(im, pts, hi, lo)
    d = ImageDraw.Draw(im)
    shade_poly(im, [P(0.1, 0.66), P(0.9, 0.66), P(0.9, 0.84), P(0.1, 0.84)], hi, lo)
    for x, y in ((0.12, 0.3), (0.5, 0.18), (0.88, 0.3)):
        r = 0.05
        d.ellipse(((x - r) * B, (y - r) * B, (x + r) * B, (y + r) * B), fill=hi, outline=lo, width=K)
    for x in (0.28, 0.5, 0.72):
        r = 0.045
        d.ellipse(((x - r) * B, (0.75 - r) * B, (x + r) * B, (0.75 + r) * B), fill=gem, outline=(255, 255, 255), width=K)
    d.line([P(0.16, 0.68), P(0.84, 0.68)], fill=(255, 255, 255), width=K)
    return done(im)


def age_emblem(age):
    """Гербы эпох в духе DE (свой рисунок): 0 — круглый щит, 1 — каплевидный чёрно-красный «II»,
    2 — геральдический сине-красный с башней «III», 3 — четверочастный с короной «IV»."""
    im = Image.new('RGBA', (B, B), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    gold_hi, gold_lo = (255, 232, 150), (150, 100, 30)
    if age == 0:
        cx, cy, r = 0.5 * B, 0.5 * B, 0.44 * B
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=gold_lo)
        r2 = r * 0.9
        rad = radial(B, (230, 140, 50), (140, 60, 20), (0.42, 0.4), 0.5)
        m = Image.new('L', (B, B), 0)
        ImageDraw.Draw(m).ellipse((cx - r2, cy - r2, cx + r2, cy + r2), fill=255)
        im.paste(rad, (0, 0), m)
        for i in range(8):
            a = i * math.pi / 4
            d.line([(cx, cy), (cx + math.cos(a) * r2, cy + math.sin(a) * r2)], fill=(110, 50, 20), width=2 * K)
        rb = r * 0.24
        d.ellipse((cx - rb, cy - rb, cx + rb, cy + rb), fill=(200, 200, 210), outline=(80, 80, 90), width=2 * K)
        return done(im)
    if age == 1:                           # каплевидный (миндалевидный)
        outline = [P(0.5, 0.04), P(0.84, 0.16), P(0.82, 0.5), P(0.5, 0.97), P(0.18, 0.5), P(0.16, 0.16)]
    else:                                  # геральдический «испанский»
        outline = [P(0.12, 0.06), P(0.88, 0.06), P(0.88, 0.56), P(0.5, 0.96), P(0.12, 0.56)]
    d.polygon(outline, fill=gold_lo)
    cx = sum(p[0] for p in outline) / len(outline)
    cy = sum(p[1] for p in outline) / len(outline)
    inner = [(cx + (x - cx) * 0.88, cy + (y - cy) * 0.88) for x, y in outline]
    field = Image.new('RGBA', (B, B), (0, 0, 0, 0))
    fd = ImageDraw.Draw(field)
    if age == 1:
        fd.rectangle((0, 0, B // 2, B), fill=(24, 22, 26))
        fd.rectangle((B // 2, 0, B, B), fill=(170, 30, 30))
    elif age == 2:
        fd.rectangle((0, 0, B // 2, B), fill=(40, 70, 170))
        fd.rectangle((B // 2, 0, B, B), fill=(170, 30, 30))
    else:
        fd.rectangle((0, 0, B // 2, B // 2), fill=(30, 110, 50))
        fd.rectangle((B // 2, 0, B, B // 2), fill=(170, 30, 30))
        fd.rectangle((0, B // 2, B // 2, B), fill=(170, 30, 30))
        fd.rectangle((B // 2, B // 2, B, B), fill=(30, 110, 50))
    m = Image.new('L', (B, B), 0)
    ImageDraw.Draw(m).polygon(inner, fill=255)
    im.paste(field, (0, 0), m)
    lit = radial(B, (255, 255, 255), (0, 0, 0), (0.35, 0.25), 0.8)
    lit_a = Image.new('L', (B, B), 0)
    ImageDraw.Draw(lit_a).polygon(inner, fill=60)
    lit.putalpha(lit_a)
    im.alpha_composite(lit)
    d = ImageDraw.Draw(im)
    d.polygon(outline, outline=gold_hi, width=3 * K)
    if age == 2:                           # башня
        tw = [P(0.38, 0.62), P(0.62, 0.62), P(0.62, 0.3), P(0.38, 0.3)]
        d.polygon(tw, fill=(236, 226, 200))
        for x in (0.38, 0.46, 0.54):
            d.rectangle((x * B, 0.24 * B, (x + 0.06) * B, 0.3 * B), fill=(236, 226, 200))
        d.rectangle((0.47 * B, 0.48 * B, 0.53 * B, 0.62 * B), fill=(40, 30, 20))
    if age == 3:                           # корона
        c = crown(False).resize((int(B * 0.42), int(B * 0.42)), Image.LANCZOS)
        cm = c.convert('RGB').convert('L').point(lambda v: 255 if v > 20 else 0)
        c.putalpha(cm)
        im.alpha_composite(c, (int(B * 0.29), int(B * 0.14)))
    num = ['I', 'II', 'III', 'IV'][age]
    f = font(int(B * (0.3 if age < 3 else 0.26)))
    ty = 0.72 if age != 1 else 0.66
    d.text((0.5 * B + 3 * K, ty * B + 3 * K), num, font=f, fill=(0, 0, 0), anchor='mm')
    d.text((0.5 * B, ty * B), num, font=f, fill=(255, 236, 170), anchor='mm', stroke_width=K, stroke_fill=(90, 60, 10))
    return done(im)


def age_button(age):
    """Кнопка перехода в эпоху DE: герб эпохи на чёрном."""
    bg = Image.new('RGBA', (N, N), (0, 0, 0, 255))
    e = age_emblem(age)
    bg.alpha_composite(e.resize((int(N * 0.92), int(N * 0.92)), Image.LANCZOS), (int(N * 0.04), int(N * 0.04)))
    return bg


# ---------------------------------------------------------------- верхние кнопки (прозрачный фон)
def scroll_check():
    """Цели DE: свиток с красной галочкой."""
    im = Image.new('RGBA', (B, B), (0, 0, 0, 0))
    shade_poly(im, [P(0.2, 0.18), P(0.8, 0.18), P(0.8, 0.84), P(0.2, 0.84)], (250, 238, 206), (206, 180, 130))
    d = ImageDraw.Draw(im)
    for y in (0.15, 0.84):
        d.rounded_rectangle((0.12 * B, (y - 0.06) * B, 0.88 * B, (y + 0.06) * B), radius=int(0.06 * B),
                            fill=(180, 140, 80), outline=(90, 60, 30), width=2 * K)
    for k in range(4):
        y = 0.32 + k * 0.1
        d.line([P(0.28, y), P(0.56, y)], fill=(120, 100, 70), width=2 * K)
    d.line([P(0.52, 0.52), P(0.64, 0.68), P(0.9, 0.24)], fill=(210, 30, 30), width=9 * K, joint='curve')
    return done(im)


def gear():
    """Древо технологий DE: металлическая шестерня."""
    im = Image.new('RGBA', (B, B), (0, 0, 0, 0))
    cx = cy = B / 2
    teeth = 10
    pts = []
    for i in range(teeth * 4):
        a = i / (teeth * 4) * 2 * math.pi
        r = 0.46 if (i % 4) in (1, 2) else 0.36
        pts.append((cx + math.cos(a) * r * B, cy + math.sin(a) * r * B))
    shade_poly(im, pts, (230, 232, 240), (110, 112, 124), outline=(50, 50, 60), width=2 * K)
    d = ImageDraw.Draw(im)
    for r, col in ((0.24, (90, 92, 104)), (0.2, (190, 192, 204)), (0.08, (40, 40, 48))):
        d.ellipse((cx - r * B, cy - r * B, cx + r * B, cy + r * B), fill=col)
    return done(im)


def horn():
    """Чат DE: золотой рог."""
    im = Image.new('RGBA', (B, B), (0, 0, 0, 0))
    pts_top, pts_bot = [], []
    for i in range(41):
        t = i / 40
        x = 0.14 + 0.72 * t
        y = 0.72 - 0.5 * t + 0.35 * t * t
        w = 0.03 + 0.2 * t ** 2
        pts_top.append(P(x, y - w))
        pts_bot.append(P(x, y + w))
    shade_poly(im, pts_top + pts_bot[::-1], (255, 236, 150), (160, 104, 24), outline=(90, 60, 10), width=2 * K)
    d = ImageDraw.Draw(im)
    x, y, w = 0.86, 0.72 - 0.5 + 0.35, 0.23
    d.ellipse(((x - 0.05) * B, (y - w) * B, (x + 0.05) * B, (y + w) * B), fill=(80, 50, 10), outline=(255, 230, 140),
              width=2 * K)
    for t in (0.3, 0.6):
        xx = 0.14 + 0.72 * t
        yy = 0.72 - 0.5 * t + 0.35 * t * t
        ww = 0.03 + 0.2 * t ** 2
        d.line([P(xx, yy - ww), P(xx, yy + ww)], fill=(120, 80, 20), width=3 * K)
    return done(im)


def wreath_handshake():
    """Дипломатия DE: лавровый венок с рукопожатием."""
    im = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    paste_fit(im, cutout('laurel_wreath'), (0.0, 0.0, 1.0, 1.0))
    paste_fit(im, cutout('handshake'), (0.22, 0.26, 0.78, 0.74))
    return im


# ---------------------------------------------------------------- приказы, стойки, строи
def octagon(active=False):
    """Рамка стойки DE: восьмиугольник (включённая — зелёная). Центр прозрачный."""
    im = Image.new('RGBA', (B, B), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = 0.29
    pts = [P(c, 0.02), P(1 - c, 0.02), P(0.98, c), P(0.98, 1 - c), P(1 - c, 0.98), P(c, 0.98), P(0.02, 1 - c), P(0.02, c)]
    col = (90, 220, 90) if active else (200, 190, 160)
    d.polygon(pts, outline=(0, 0, 0), width=10 * K)
    d.polygon(pts, outline=col, width=4 * K)
    # углы вне восьмиугольника — чёрные (как в DE)
    m = Image.new('L', (B, B), 255)
    ImageDraw.Draw(m).polygon(pts, fill=0)
    blk = Image.new('RGBA', (B, B), (0, 0, 0, 255))
    im = Image.composite(blk, im, m)
    return done(im)


def formation(name, active=False):
    """Строй DE: белые шары на чёрном + красная «крыша»-треугольник сверху; выбранный — зелёные шары."""
    im = canvas()
    d = ImageDraw.Draw(im)
    d.polygon([P(0.5, 0.06), P(0.66, 0.2), P(0.34, 0.2)], fill=(220, 30, 30))
    pts = {'line': [(x, y) for y in (0.46, 0.66) for x in (0.14, 0.32, 0.5, 0.68, 0.86)],
           'box': [(x, y) for x in (0.22, 0.5, 0.78) for y in (0.36, 0.58, 0.8) if (x, y) != (0.5, 0.58)],
           'staggered': [(0.16, 0.42), (0.5, 0.42), (0.84, 0.42), (0.33, 0.66), (0.67, 0.66), (0.16, 0.88),
                         (0.5, 0.88), (0.84, 0.88)],
           'flank': [(x, y) for y in (0.46, 0.68) for x in (0.1, 0.26, 0.74, 0.9)]}[name]
    col = (110, 235, 110) if active else (245, 245, 245)
    r = 0.065
    for x, y in pts:
        d.ellipse(((x - r) * B, (y - r) * B, (x + r) * B, (y + r) * B), fill=col)
        d.ellipse(((x - r * 0.45) * B, (y - r * 0.6) * B, (x - r * 0.05) * B, (y - r * 0.2) * B), fill=(255, 255, 255))
    if name == 'box':
        rr = 0.07
        d.ellipse(((0.5 - rr) * B, (0.58 - rr) * B, (0.5 + rr) * B, (0.58 + rr) * B), fill=(240, 200, 110))
    return done(im)


def sword_in_ground():
    """Стойка «не атаковать» DE: меч, воткнутый в землю."""
    im = canvas()
    d = ImageDraw.Draw(im)
    d.ellipse((0.1 * B, 0.74 * B, 0.9 * B, 0.98 * B), fill=(96, 70, 40))
    d.ellipse((0.2 * B, 0.78 * B, 0.8 * B, 0.94 * B), fill=(70, 110, 40))
    shade_poly(im, [P(0.46, 0.3), P(0.54, 0.3), P(0.53, 0.86), P(0.47, 0.86)], (240, 240, 250), (140, 140, 156))
    d.line([P(0.5, 0.3), P(0.5, 0.86)], fill=(255, 255, 255), width=K)
    shade_poly(im, [P(0.26, 0.25), P(0.74, 0.25), P(0.74, 0.31), P(0.26, 0.31)], (240, 200, 100), (150, 100, 30))
    shade_poly(im, [P(0.465, 0.06), P(0.535, 0.06), P(0.535, 0.25), P(0.465, 0.25)], (140, 90, 50), (80, 50, 24))
    d.ellipse((0.44 * B, 0.02 * B, 0.56 * B, 0.1 * B), fill=(230, 190, 90))
    return done(im)


def stance_aggressive():
    """Агрессивная стойка DE: кулак с оружием."""
    im = canvas()
    paste_fit(im, cutout('fist_spear').resize((N * K // 1, N * K // 1)), (0.06, 0.06, 0.94, 0.94))
    return done(im)


def stance_defensive():
    """Оборонительная стойка DE: щит поверх скрещённых мечей."""
    im = canvas()
    sw = cutout('sword_cross')
    paste_fit(im, sw.resize((sw.width * K, sw.height * K), Image.LANCZOS), (0.02, 0.02, 0.98, 0.98))
    sh = cutout('shields_generic_silver')
    paste_fit(im, drop_shadow(sh.resize((sh.width * K, sh.height * K), Image.LANCZOS), r=4 * K), (0.2, 0.2, 0.8, 0.86))
    return done(im)


def boulder_on_grass():
    """Атака по земле DE: валун падает на траву."""
    im = radial(B, (120, 170, 220), (40, 70, 120), (0.5, 0.0), 1.0)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0.62 * B, B, B), fill=(70, 120, 40))
    d.ellipse((0.2 * B, 0.66 * B, 0.8 * B, 0.84 * B), fill=(60, 44, 24))
    shade_poly(im, [P(0.36, 0.28), P(0.6, 0.22), P(0.72, 0.4), P(0.66, 0.62), P(0.42, 0.66), P(0.3, 0.48)],
               (190, 186, 176), (90, 86, 80))
    for k in range(3):
        y = 0.1 + k * 0.05
        d.line([P(0.22 - k * 0.04, y), P(0.36, 0.3 + k * 0.04)], fill=(230, 230, 230), width=2 * K)
    return done(im)


# ---------------------------------------------------------------- составные из 0 A.D.
def overlay(bgname, fgname, box=(0.08, 0.08, 0.92, 0.92), rot=0.0):
    base = src(bgname)
    fg = cutout(fgname)
    return paste_fit(base, drop_shadow(fg), box, rot)


def thumb_ring():
    """Кольцо лучника DE: рука с крупным золотым кольцом на большом пальце."""
    im = blacken('fist')
    d = ImageDraw.Draw(im)
    for w, col in ((9, (90, 60, 10)), (6, (255, 214, 90)), (2, (255, 246, 190))):
        d.ellipse((0.14 * N, 0.36 * N, 0.44 * N, 0.58 * N), outline=col, width=w)
    return im


def ballistics():
    """Баллистика DE: ядро летит по дуге в стену (пунктир траектории)."""
    im = radial(B, (80, 110, 150), (20, 30, 50), (0.3, 0.2), 1.0)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0.84 * B, B, B), fill=(70, 110, 40))
    for r in range(5):                                      # стена справа
        y0 = 0.3 + r * 0.11
        for c in range(2):
            x0 = 0.7 + ((c + 0.5 * (r % 2)) % 2) * 0.15
            g = 150 + 12 * ((r + c) % 3)
            d.rectangle((x0 * B, y0 * B, (x0 + 0.14) * B, (y0 + 0.1) * B), fill=(g, g - 6, g - 18), outline=(60, 56, 50))
    pts = []
    for i in range(13):
        t = i / 12
        pts.append((0.08 + 0.58 * t, 0.8 - 0.9 * t + 0.62 * t * t))
    for a, b in zip(pts[::2], pts[1::2]):
        d.line([P(*a), P(*b)], fill=(255, 240, 200), width=3 * K)
    x, y = pts[-1]
    r = 0.075
    d.ellipse(((x - r) * B, (y - r) * B, (x + r) * B, (y + r) * B), fill=(50, 50, 56), outline=(20, 20, 24), width=K)
    d.ellipse(((x - r * 0.5) * B, (y - r * 0.6) * B, (x - r * 0.05) * B, (y - r * 0.15) * B), fill=(150, 150, 160))
    return done(im)


def build_page(kind):
    """Кнопка жителя DE: «экономические» — молот и монеты, «военные» — молот и меч."""
    im = canvas()
    if kind == 'eco':
        c = cutout('coins')
        paste_fit(im, c.resize((c.width * K, c.height * K), Image.LANCZOS), (0.02, 0.3, 0.7, 0.98))
    else:
        c = cutout('sword')
        paste_fit(im, c.resize((c.width * K, c.height * K), Image.LANCZOS), (0.0, 0.0, 1.0, 1.0), rot=0)
    h = cutout('work')
    paste_fit(im, drop_shadow(h.resize((h.width * K, h.height * K), Image.LANCZOS), r=3 * K), (0.3, 0.0, 1.0, 0.8))
    return done(im)


def molten_pot():
    """Литьё железа DE: тигель с раскалённым металлом."""
    im = blacken('metal_pot')
    glow = radial(N, (255, 170, 40), (0, 0, 0), (0.5, 0.3), 0.35)
    im = ImageChops.add(im.convert('RGB'), glow.convert('RGB')).convert('RGBA')
    d = ImageDraw.Draw(im)
    d.ellipse((0.3 * N, 0.2 * N, 0.7 * N, 0.32 * N), fill=(255, 190, 60), outline=(255, 240, 160))
    return im


def stat_icon(name):
    """Значок характеристики: предмет на прозрачном фоне."""
    c = cutout(name)
    im = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    return paste_fit(im, c, (0.02, 0.02, 0.98, 0.98))


# ================================================================ курсоры
# DE (docs/research/08_cursor.md): курсор действия — один предмет без стрелки; рабочий конец (лезвие, боёк,
# остриё) в верхнем-левом углу, там же точка прицела (1, 1) и белый уголок-метка. Рисунок на холсте CD = 64
# с тёмной обводкой, уменьшение до CS = 32 (мягкие края); процедурные предметы — на 128 (4×).
CS = 32
CD = 64
GP = 128            # холст процедурного предмета


def _dark_outline(im, r=2, alpha=235):
    """Тёмная обводка по контуру (DE): расширенная маска под предметом."""
    a = im.getchannel('A').point(lambda v: 255 if v > 60 else 0).filter(ImageFilter.MaxFilter(2 * r + 1))
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    out.paste(Image.new('RGBA', im.size, (24, 16, 8, alpha)), (0, 0), a)
    out.alpha_composite(im)
    return out


def _tip_marker(im):
    """Белый уголок в точке прицела (как у DE) — на готовом курсоре CS."""
    d = ImageDraw.Draw(im)
    d.polygon([(0, 0), (7, 0), (0, 7)], fill=(30, 22, 12, 255))
    d.polygon([(0, 0), (5, 0), (0, 5)], fill=(255, 255, 255, 255))


def _crop_alpha(t, thr=30):
    bb = t.getchannel('A').point(lambda v: 255 if v > thr else 0).getbbox()
    return t.crop(bb) if bb else t


def _no_shadow(im):
    """Убрать нарисованную в портрете 0 A.D. тень под предметом (тёмные малонасыщенные пиксели → прозрачные),
    замкнуть дыры маски (металл похож на фон) и поднять почти чёрный металл до стали (на 32 px иначе пятно)."""
    a = np.asarray(im.convert('RGBA'), np.float32)
    rgb = a[..., :3]
    chroma = rgb.max(-1) - rgb.min(-1)                                    # абсолютная насыщенность
    L = rgb @ np.array([0.3, 0.59, 0.11], np.float32)
    grey = chroma < 36
    keep = np.where(grey, np.clip((L - 52) / 28, 0, 1), np.clip((L - 16) / 16, 0, 1))
    al = a[..., 3] * keep
    m = Image.fromarray(np.where(al < 90, 0, 255).astype(np.uint8))
    m = m.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(7))
    a[..., 3] = np.maximum(np.where(al < 90, 0, al), np.asarray(m, np.float32))
    lift = np.clip((85 - L) / 85, 0, 1) * grey * 70
    a[..., :3] = rgb + lift[..., None]
    return _crop_alpha(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA'))


def cursor(tool, rot=0.0, mirror=False, box=(0.05, 0.05, 0.97, 0.97), extra=None, marker=True, outline=2):
    """Курсор DE: предмет (имя портрета 0 A.D. или RGBA), отражённый/повёрнутый так, чтобы рабочий конец был ↖,
    прижат к верхнему-левому углу box (доли холста CD), обводка, уменьшение до CS, уголок-метка."""
    t = _no_shadow(cutout(tool)) if isinstance(tool, str) else tool
    if mirror:
        t = ImageOps.mirror(t)
    if rot:
        t = t.rotate(rot, resample=Image.BICUBIC, expand=True)
    t = _crop_alpha(t)
    im = Image.new('RGBA', (CD, CD), (0, 0, 0, 0))
    x0, y0, x1, y1 = [v * CD for v in box]
    k = min((x1 - x0) / t.width, (y1 - y0) / t.height)
    t2 = t.resize((max(1, round(t.width * k)), max(1, round(t.height * k))), Image.LANCZOS)
    im.alpha_composite(t2, (round(x0), round(y0)))
    a = np.asarray(im).copy()
    a[..., 3] = np.where(a[..., 3] < 48, 0, a[..., 3])                    # пыль после поворота/уменьшения
    im = Image.fromarray(a, 'RGBA')
    if extra:
        extra(im)
    if outline:
        im = _dark_outline(im, outline)
    out = im.resize((CS, CS), Image.LANCZOS)
    if marker:
        _tip_marker(out)
    return out


def _glyph():
    return Image.new('RGBA', (GP, GP), (0, 0, 0, 0))


def _g(x, y):
    return (x * GP, y * GP)


def _red_arrow(d, cx, y0, y1, w=0.16, up=True):
    """Красная стрелка DE (вверх при up, иначе вниз), координаты — доли холста GP."""
    hy = y0 if up else y1
    ty = y1 if up else y0
    col, edge = (225, 40, 20), (90, 10, 5)
    d.polygon([_g(cx - w, hy + (0.55 * (ty - hy))), _g(cx + w, hy + 0.55 * (ty - hy)), _g(cx, hy)],
              fill=col, outline=edge, width=K)
    d.rectangle((*_g(cx - w * 0.42, min(hy + 0.5 * (ty - hy), ty)), *_g(cx + w * 0.42, max(hy + 0.5 * (ty - hy), ty))),
                fill=col, outline=edge, width=K)


def nuggets(gold=True):
    """Самородки (золото) / камни (серые) у кирки — рисуются в extra на холсте CD, слева-снизу."""
    top, bot, edge = ((255, 226, 110), (170, 110, 20), (110, 70, 10)) if gold else \
        ((205, 205, 210), (95, 95, 102), (50, 50, 55))

    def draw(im):
        d = ImageDraw.Draw(im)
        for (x, y, r) in ((0.16, 0.86, 0.13), (0.34, 0.9, 0.11), (0.24, 0.74, 0.1), (0.08, 0.7, 0.08)):
            d.ellipse(((x - r) * CD, (y - r * 0.8) * CD, (x + r) * CD, (y + r * 0.8) * CD), fill=bot, outline=edge)
            d.ellipse(((x - r * 0.55) * CD, (y - r * 0.6) * CD, (x + r * 0.25) * CD, (y + r * 0.05) * CD), fill=top)
    return draw


def drop_arrow(im):
    """Зелёная стрелка вниз над корзиной (сдать ресурс) — на холсте CD."""
    d = ImageDraw.Draw(im)
    col, edge = (90, 220, 90), (20, 70, 20)
    d.rectangle((0.66 * CD, 0.02 * CD, 0.78 * CD, 0.24 * CD), fill=col, outline=edge)
    d.polygon([(0.56 * CD, 0.24 * CD), (0.88 * CD, 0.24 * CD), (0.72 * CD, 0.42 * CD)], fill=col, outline=edge)


def rope_coil(im):
    """Моток каната у молота (ремонт DE) — на холсте CD, справа-снизу."""
    d = ImageDraw.Draw(im)
    for i, (x, y) in enumerate(((0.62, 0.86), (0.76, 0.8), (0.88, 0.88), (0.7, 0.94))):
        d.ellipse(((x - 0.12) * CD, (y - 0.07) * CD, (x + 0.12) * CD, (y + 0.07) * CD),
                  fill=(206, 168, 96), outline=(96, 66, 24), width=1)
        d.line([((x - 0.1) * CD, (y - 0.02) * CD), ((x + 0.1) * CD, (y + 0.02) * CD)], fill=(150, 110, 50), width=1)


def hammer_tool():
    """Молот 0 A.D. (курсор action-build) как предмет."""
    return Image.open(os.path.join(CURSORS, 'action-build.png')).convert('RGBA')


def sword_tool(name='action-attack'):
    """Меч 0 A.D. (64×64, рисунок 23×23): вырезаем рамку — предмет займёт весь курсор."""
    return _crop_alpha(Image.open(os.path.join(CURSORS, name + '.png')).convert('RGBA'))


def flag_glyph():
    """Флаг точки сбора DE: древко из угла вниз-вправо, бело-синее полотнище."""
    im = _glyph()
    d = ImageDraw.Draw(im)
    top, base = (0.06, 0.06), (0.3, 0.96)
    # полотнище (два клина: белый и синий)
    fx = [top, (0.9, 0.16), (0.72, 0.36), (0.18, 0.42)]
    d.polygon([_g(*p) for p in fx], fill=(244, 244, 240), outline=(60, 60, 70), width=K)
    d.polygon([_g(*p) for p in (top, (0.9, 0.16), (0.6, 0.2), (0.12, 0.24))], fill=(50, 92, 210))
    d.polygon([_g(*p) for p in ((0.12, 0.24), (0.6, 0.2), (0.9, 0.16), (0.72, 0.36), (0.18, 0.42))],
              fill=(244, 244, 240))
    d.polygon([_g(*p) for p in fx], outline=(60, 60, 70), width=K)
    d.line([_g(*top), _g(*base)], fill=(96, 62, 24), width=5 * K)
    d.line([_g(*top), _g(*base)], fill=(160, 112, 52), width=2 * K)
    d.ellipse((*_g(base[0] - 0.06, base[1] - 0.05), *_g(base[0] + 0.06, base[1] + 0.03)), fill=(70, 46, 16))
    return im


def plank_glyph(up=True):
    """Сходни корабля DE: доска наискось + красная стрелка (на борт — вверх, выгрузить — вниз)."""
    im = _glyph()
    d = ImageDraw.Draw(im)
    pl = [(0.5, 0.06), (0.68, 0.14), (0.98, 0.9), (0.8, 0.98)]
    d.polygon([_g(*p) for p in pl], fill=(170, 118, 60), outline=(70, 40, 12), width=K)
    for t in (0.25, 0.5, 0.75):
        a = (pl[0][0] + (pl[3][0] - pl[0][0]) * t, pl[0][1] + (pl[3][1] - pl[0][1]) * t)
        b = (pl[1][0] + (pl[2][0] - pl[1][0]) * t, pl[1][1] + (pl[2][1] - pl[1][1]) * t)
        d.line([_g(*a), _g(*b)], fill=(110, 70, 28), width=K)
    _red_arrow(d, 0.26, 0.3, 0.92, w=0.2, up=up)
    return im


def boots_glyph():
    """Следовать: сапоги 0 A.D. с красной стрелкой вперёд."""
    b = _no_shadow(cutout('leather_boots'))
    im = _glyph()
    paste_fit(im, b, (0.22, 0.06, 1.0, 0.98))
    d = ImageDraw.Draw(im)
    _red_arrow(d, 0.12, 0.08, 0.6, w=0.12, up=True)
    return im


def horn_glyph():
    """Сигнал: рог (как «чат» DE), раструбом в верхний-левый угол."""
    h = horn().rotate(180, resample=Image.BICUBIC).rotate(38, resample=Image.BICUBIC, expand=True)
    return _crop_alpha(h)


def hands_tool():
    """Лечение DE: только сложенные ладони — красный крест 0 A.D. убираем по цвету."""
    im = _no_shadow(cutout('healing_rate'))
    a = np.asarray(im, np.int32)
    red = (a[..., 0] > 120) & (a[..., 1] < 100) & (a[..., 2] < 100)
    m = np.asarray(Image.fromarray((red * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(7)), bool)
    h, w = m.shape
    m[:int(h * 0.42), :] = False
    m[:, :int(w * 0.5)] = False                                            # крест — справа-снизу
    a[m, 3] = 0
    im = Image.fromarray(a.astype(np.uint8), 'RGBA')
    return _crop_alpha(im.crop((0, 0, int(im.width * 0.74), im.height)))


# ================================================================ рамки панелей по культурам
SKIN_OUT = os.path.join(ROOT, 'assets', 'ui', 'skin')
T = 256


def _fbm(seed, size=T, octaves=5, base=4):
    """Бесшовный шум (сумма октав периодической интерполяции) 0..1."""
    rng = np.random.default_rng(seed)
    out = np.zeros((size, size), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        n = base * 2 ** o
        g = rng.random((n, n)).astype(np.float32)
        g = np.tile(g, (3, 3))
        im = Image.fromarray((g * 255).astype(np.uint8)).resize((size * 3, size * 3), Image.BICUBIC)
        a = np.asarray(im, np.float32)[size:2 * size, size:2 * size] / 255
        out += a * amp
        tot += amp
        amp *= 0.55
    out /= tot
    return (out - out.min()) / max(1e-6, out.max() - out.min())


def _rgb(a):
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGB')


def tex_iron():
    """Центральная Европа: тёмные железные листы с заклёпками."""
    n = _fbm(11)
    base = np.array([66, 70, 76], np.float32)
    a = base[None, None] * (0.78 + 0.4 * n[..., None])
    yy, xx = np.mgrid[0:T, 0:T]
    seam = (yy % 64 < 2) | (xx % 128 < 2)
    a[seam] *= 0.45
    a[(yy % 64 == 2) | (xx % 128 == 2)] *= 1.35
    im = _rgb(a)
    d = ImageDraw.Draw(im)
    for y in range(0, T, 64):
        for x in range(8, T, 32):
            for yy0 in (y + 7, y + 57):
                d.ellipse((x - 3, yy0 - 3, x + 3, yy0 + 3), fill=(30, 32, 36))
                d.ellipse((x - 3, yy0 - 4, x + 2, yy0 + 1), fill=(150, 156, 166))
    return im


def tex_marble():
    """Средиземноморье: тёплый серый мрамор с прожилками."""
    n = _fbm(21, octaves=6)
    v = np.abs(np.sin((n * 9 + np.linspace(0, 6, T)[None, :]) * math.pi))
    base = np.array([104, 96, 84], np.float32)
    a = base * (0.85 + 0.25 * n[..., None]) - (1 - v[..., None]) ** 8 * 30
    yy, xx = np.mgrid[0:T, 0:T]
    a[(yy % 128 < 2)] *= 0.6
    return _rgb(a)


def tex_sandstone():
    """Ближний Восток: песчаник, кладка крупными блоками."""
    n = _fbm(31)
    base = np.array([122, 94, 62], np.float32)
    a = base * (0.78 + 0.34 * n[..., None])
    yy, xx = np.mgrid[0:T, 0:T]
    row = yy // 32
    joint = (yy % 32 < 2) | (((xx + (row % 2) * 48) % 96) < 2)
    a[joint] *= 0.55
    return _rgb(a)


def tex_lacquer():
    """Азия: красный лак по дереву, тонкая текстура волокон."""
    n = _fbm(41, octaves=4, base=2)
    yy, xx = np.mgrid[0:T, 0:T].astype(np.float32)
    grain = 0.5 + 0.5 * np.sin((yy / T * 40 + n * 6) * math.pi)
    base = np.array([112, 30, 22], np.float32)
    a = base * (0.72 + 0.22 * grain[..., None] + 0.18 * n[..., None])
    return _rgb(a)


def trim(kind):
    """Кант (лента 256×12, повторяется по горизонтали) — у каждой культуры свой орнамент."""
    W, H = T * K, 12 * K
    im = Image.new('RGBA', (W, H), (0, 0, 0, 255))
    d = ImageDraw.Draw(im)
    if kind == 'iron':                       # цепь
        d.rectangle((0, 0, W, H), fill=(30, 32, 36))
        for x in range(0, W, 16 * K):
            d.ellipse((x + K, 2 * K, x + 15 * K, 10 * K), outline=(170, 176, 186), width=2 * K)
            d.line([(x + 12 * K, 6 * K), (x + 20 * K, 6 * K)], fill=(120, 126, 136), width=3 * K)
    elif kind == 'marble':                   # мозаика: золото и лазурь
        d.rectangle((0, 0, W, H), fill=(60, 40, 20))
        for i, x in enumerate(range(0, W, 8 * K)):
            col = (230, 190, 90) if i % 2 else (40, 80, 170)
            d.rectangle((x + K, 2 * K, x + 7 * K, 10 * K), fill=col)
    elif kind == 'sandstone':                # изразцы: бирюза и белое
        d.rectangle((0, 0, W, H), fill=(30, 60, 80))
        for x in range(0, W, 12 * K):
            d.polygon([(x + 6 * K, K), (x + 11 * K, 6 * K), (x + 6 * K, 11 * K), (x + K, 6 * K)], fill=(60, 170, 190))
            d.ellipse((x + 4 * K, 4 * K, x + 8 * K, 8 * K), fill=(240, 236, 220))
    elif kind == 'lacquer':                  # золотой меандр на чёрном
        d.rectangle((0, 0, W, H), fill=(16, 10, 8))
        g = (220, 170, 70)
        for x in range(0, W, 12 * K):
            d.line([(x + K, 10 * K), (x + K, 2 * K), (x + 9 * K, 2 * K), (x + 9 * K, 7 * K), (x + 5 * K, 7 * K),
                    (x + 5 * K, 10 * K), (x + 13 * K, 10 * K)], fill=g, width=K + 1)
    else:                                    # запад: витой золотой шнур
        d.rectangle((0, 0, W, H), fill=(40, 26, 10))
        for x in range(0, W, 8 * K):
            d.line([(x, 10 * K), (x + 8 * K, 2 * K)], fill=(236, 196, 110), width=3 * K)
            d.line([(x + K, 11 * K), (x + 9 * K, 3 * K)], fill=(120, 80, 30), width=K)
    return im.resize((T, 12), Image.LANCZOS)


def parchment_flat():
    """Ровный светлый пергамент (DE) — бесшовная плитка."""
    n = _fbm(51, octaves=6, base=3)
    base = np.array([222, 204, 164], np.float32)
    a = base * (0.93 + 0.1 * n[..., None])
    return _rgb(a)


def build_skins():
    os.makedirs(SKIN_OUT, exist_ok=True)
    made = []
    for name, fn in (('culture_iron', tex_iron), ('culture_marble', tex_marble), ('culture_sandstone', tex_sandstone),
                     ('culture_lacquer', tex_lacquer), ('parchment_flat', parchment_flat)):
        p = os.path.join(SKIN_OUT, name + '.png')
        fn().save(p, optimize=True)
        made.append(p)
    for kind in ('west', 'iron', 'marble', 'sandstone', 'lacquer'):
        p = os.path.join(SKIN_OUT, f'trim_{kind}.png')
        trim(kind).save(p, optimize=True)
        made.append(p)
    return made


# ================================================================ сборка
def recipes():
    """имя файла → функция без аргументов, возвращающая PIL RGBA 128×128."""
    R = {}

    def bl(n):
        return lambda: blacken(n)

    # здания-символы
    R.update({'barracks': bl('sword_cross'), 'stable': bl('horseshoe_metal'), 'siege_workshop': bl('engineering'),
              'dock': bl('anchor'), 'mining_camp': bl('mining_pickax'), 'market': bl('scales'),
              'lumber_camp': lumber_camp, 'university': books, 'town_center': pair_on_sky})
    # технологии: хозяйство
    R.update({'loom': tartan, 'wheelbarrow': bl('wheelbarrow_empty'), 'hand_cart': bl('handcart_empty'),
              'double_bit': bl('wood_axe'), 'bow_saw': bl('wood_saw_bow'), 'two_man_saw': bl('wood_saw_two_man'),
              'gold_mining': lambda: tint_gold(blacken('mining_metal'), (0.0, 0.35, 1.0, 1.0)),
              'gold_shaft': lambda: tint_gold(blacken('mining_metal_02'), (0.0, 0.35, 1.0, 1.0)),
              'stone_mining': bl('mining_stone'), 'stone_shaft': bl('mining_stone_02'),
              'horse_collar': horse_collar, 'heavy_plow': bl('plow'), 'crop_rotation': bl('crop_rotation'),
              'coinage': lambda: tint_gold(blacken('political_face')), 'caravan': bl('trade_caravan'),
              'guilds': bl('calipers'), 'town_watch': bl('sentries'), 'town_patrol': bl('signal_fires'),
              'gillnets': bl('fishing_net'), 'careening': bl('ship_cladding'), 'dry_dock': bl('trihemiolia'),
              'shipwright': bl('armor_ship_bronze'), 'supplies': bl('grain_bag')})
    # кузница
    R.update({'forging': bl('metalworker'), 'iron_casting': molten_pot, 'blast_furnace': bl('incendiary_weapons'),
              'fletching': bl('fletching'), 'bodkin_arrow': bl('arrow'), 'bracer': bl('armor_greaves'),
              'scale_armor': bl('armor_plates_swords'),
              'chain_mail': lambda: overlay('armor_chain', 'sword_cross', (0.1, 0.1, 0.9, 0.9)),
              'plate_mail': bl('armor_plates_iron_swords'),
              'scale_barding': bl('armor_plates_cavalry'),
              'chain_barding': lambda: overlay('armor_chain', 'horseshoe_metal', (0.18, 0.14, 0.82, 0.86)),
              'plate_barding': bl('armor_plates_silver_cavalry'),
              'padded_archer_armor': bl('armor_leather_arrow'), 'leather_archer_armor': bl('armor_plates_ranged'),
              'ring_archer_armor': lambda: overlay('armor_chain', 'arrow', (0.06, 0.06, 0.94, 0.94))})
    # армия, монастырь, университет
    R.update({'thumb_ring': thumb_ring, 'parthian_tactics': bl('horse_rider'), 'bloodlines': bl('horse_trainer'),
              'husbandry': bl('husbandry_horses'), 'squires': bl('fist_spear'), 'arson': bl('fist_spear_fire'),
              'sanctity': chalice, 'fervor': bl('spy_trader'), 'atonement': bl('high_priest'),
              'redemption': sunbeam, 'block_printing': block_printing, 'illumination': open_book,
              'ballistics': ballistics, 'chemistry': bl('vial_poison'), 'siege_engineers': bl('siege_ram'),
              'masonry': bl('masonry_rubble'), 'architecture': bl('architecture'),
              'fortified_wall': bl('crenelations'), 'murder_holes': bl('murder_holes'), 'arrowslits': arrowslit,
              'treadmill_crane': crane})
    R.update({'crown_silver': lambda: crown(True), 'crown_gold': lambda: crown(False),
              'build_eco': lambda: build_page('eco'), 'build_mil': lambda: build_page('mil')})
    for a in range(4):
        R[f'age_{a}'] = (lambda a=a: age_emblem(a))
        R[f'age_btn_{a}'] = (lambda a=a: age_button(a))
    # верх
    R.update({'top_objectives': scroll_check, 'top_chat': horn, 'top_diplomacy': wreath_handshake,
              'top_techtree': gear})
    # характеристики
    R.update({'stat_atk': lambda: stat_icon('sword'), 'stat_arm': lambda: stat_icon('armor_cuirass_empire'),
              'stat_rng': lambda: stat_icon('archery_tradition'), 'stat_spd': lambda: stat_icon('leather_boots')})
    # армия
    R.update({'oct': lambda: octagon(False), 'oct_on': lambda: octagon(True),
              'stance_aggressive': stance_aggressive, 'stance_defensive': stance_defensive,
              'stance_no_attack': sword_in_ground, 'aground': boulder_on_grass})
    for f in ('line', 'box', 'staggered', 'flank'):
        R[f'form_{f}'] = (lambda f=f: formation(f))
        R[f'form_{f}_on'] = (lambda f=f: formation(f, True))
    return R


CURSOR_RECIPES = {
    # добыча: инструмент, рабочий конец ↖ (DE)
    'de_tree': lambda: cursor('wood_axe', rot=8),                                  # топор: лезвие ↖
    'de_gold': lambda: cursor('mining_pickax', mirror=True, box=(0.16, 0.04, 0.98, 0.9), extra=nuggets(True)),
    'de_stone': lambda: cursor('mining_pickax', mirror=True, box=(0.16, 0.04, 0.98, 0.9), extra=nuggets(False)),
    'de_berries': lambda: cursor('gather_basket'),                                 # корзина с плодами
    'de_farm': lambda: cursor('sickle_2'),                                         # серп: лезвие ↖
    'de_meat': lambda: cursor('spear', rot=42),                                    # охотничье копьё: остриё ↖
    'de_fish': lambda: cursor('fishing_net'),
    'de_drop': lambda: cursor('gather_basket_empty', box=(0.05, 0.3, 0.97, 0.97), extra=drop_arrow),
    'de_heal': lambda: cursor(hands_tool()),                                       # только ладони
    # ремонт: молот + канат (отличается от «строить»)
    'de_repair': lambda: cursor(hammer_tool(), box=(0.05, 0.05, 0.86, 0.86), extra=rope_coil, outline=1),
    # меч 0 A.D. во весь курсор (рисунок 23 px из 64 — иначе крошка), остриё ↖
    'de_attack': lambda: cursor(sword_tool('action-attack'), outline=1),
    'de_amove': lambda: cursor(sword_tool('action-attack-move'), outline=1),
    # режимы и состояния без аналога в 0 A.D.
    'de_flare': lambda: cursor(horn_glyph()),
    'de_rally': lambda: cursor(flag_glyph(), outline=1),
    'de_board': lambda: cursor(plank_glyph(True), outline=1),
    'de_unload': lambda: cursor(plank_glyph(False), outline=1),
    'de_follow': lambda: cursor(boots_glyph(), outline=1),
}


def build(sheet_path=None):
    if not os.path.isdir(TECH):
        print('нет портретов 0 A.D.:', TECH)
        return []
    os.makedirs(OUT, exist_ok=True)
    made = []
    for name, fn in recipes().items():
        im = fn()
        if im.size != (N, N):
            im = im.resize((N, N), Image.LANCZOS)
        path = os.path.join(OUT, name + '.png')
        opaque = im.getchannel('A').getextrema()[0] == 255
        (im.convert('RGB') if opaque else im).save(path, optimize=True)
        made.append(path)
    made += build_skins()
    os.makedirs(CUR_OUT, exist_ok=True)
    for name, fn in CURSOR_RECIPES.items():
        path = os.path.join(CUR_OUT, name + '.png')
        fn().save(path, optimize=True)
        made.append(path)
    print(f'значки DE: {len(made)} файлов → {os.path.relpath(OUT, ROOT)}')
    if sheet_path:
        sheet(made, sheet_path)
    return made


def sheet(paths, out, cell=80):
    cols = 12
    rows = (len(paths) + cols - 1) // cols
    sh = Image.new('RGB', (cols * (cell + 6), rows * (cell + 18)), (72, 64, 52))
    d = ImageDraw.Draw(sh)
    f = font(11)
    for i, p in enumerate(paths):
        im = Image.open(p).convert('RGBA')
        x, y = (i % cols) * (cell + 6) + 3, (i // cols) * (cell + 18) + 2
        k = cell / max(im.size)
        im = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS)
        sh.paste(im, (x, y), im)
        d.text((x, y + cell + 1), os.path.basename(p)[:-4][:15], fill=(255, 230, 140), font=f)
    sh.save(out)
    print('лист:', out)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--sheet', default='')
    a = ap.parse_args()
    sys.path.insert(0, ROOT)
    build(a.sheet or None)
