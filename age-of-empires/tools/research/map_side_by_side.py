#!/usr/bin/env python3
"""Лист «DE ↔ наши» для docs/research/07_maps.md: слева превью карт DE (shots/ref/maps/de_*.*),
справа наши обзоры (shots/research_maps/ours_*.png, делает map_overview.py).

  .venv/bin/python tools/research/map_side_by_side.py
  → shots/research_maps/after/side_by_side.png (MAPS_OURS — другая папка обзоров)
"""
import os
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('PYGAME_HIDE_SUPPORT_PROMPT', '1')
import pygame  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
# эталоны DE лежат вне репозитория (.gitignore): в отдельной рабочей копии их нет — берём из основной
REF = os.path.join(ROOT, 'shots/ref/maps')
if not os.path.isdir(REF):
    REF = os.path.abspath(os.path.join(ROOT, '..', '..', '..', 'shots/ref/maps'))
PAIRS = [   # (подпись DE, файл-маска DE, наш тип, подпись нашего)
    ('Arabia', 'arabia', 'arabia', '«Пустошь»'),
    ('Arena', 'arena', 'arena', '«Крепостной двор»'),
    ('Black Forest', 'black_forest', 'black_forest', '«Чаща»'),
    ('Nomad', 'nomad', 'nomad', '«Кочевье»'),
    ('Islands', 'islands', 'islands', '«Архипелаг»'),
    ('Mediterranean', 'mediterranean', 'mediterranean', '«Внутреннее море»'),
]
# наши обзоры (map_overview.py --out …): по умолчанию shots/research_maps/after основной копии
OURS = os.environ.get('MAPS_OURS') or os.path.join(os.path.dirname(os.path.dirname(REF)), 'research_maps', 'after')
CW, CH = 360, 220


def fit(img, w, h):
    iw, ih = img.get_size()
    k = min(w / iw, h / ih)
    return pygame.transform.smoothscale(img, (max(1, int(iw * k)), max(1, int(ih * k))))


def main():
    pygame.init()
    pygame.display.set_mode((1, 1))
    font = pygame.font.SysFont(None, 24)
    seeds = sys.argv[1:] or ['1', '2']
    rows = []
    for lbl, mask, mt, ours in PAIRS:
        de = [os.path.join(REF, f) for f in (f'de_{mask}_mapicons.png', f'fandom_{mask}_minimap.png')]
        if os.path.exists(de[0]):
            rows.append((lbl, de, mt, ours))
    sheet = pygame.Surface((CW * (2 + len(seeds)), (CH + 24) * len(rows)))
    sheet.fill((24, 24, 24))
    for r, (lbl, de, mt, ours) in enumerate(rows):
        y = r * (CH + 24)
        for j, f in enumerate(de):
            if os.path.exists(f):
                im = fit(pygame.image.load(f), CW - 8, CH - 4)
                sheet.blit(im, (CW * j + 4 + (CW - 8 - im.get_width()) // 2, y + 24))
        sheet.blit(font.render('DE ' + lbl + ' · иконка', True, (250, 220, 120)), (6, y + 4))
        sheet.blit(font.render('DE ' + lbl + ' · миникарта', True, (250, 220, 120)), (CW + 6, y + 4))
        for i, s in enumerate(seeds, 1):
            p = os.path.join(OURS, f'ours_{mt}_s{s}.png')
            if os.path.exists(p):
                im = fit(pygame.image.load(p), CW - 8, CH - 4)
                sheet.blit(im, (CW * (i + 1) + 4, y + 24 + (CH - 4 - im.get_height()) // 2))
            sheet.blit(font.render(f'{ours} · seed {s}', True, (220, 220, 220)), (CW * (i + 1) + 6, y + 4))
    out = os.path.join(OURS, 'side_by_side.png')
    pygame.image.save(sheet, out)
    print('сохранено', out, len(rows), 'рядов')


if __name__ == '__main__':
    main()
