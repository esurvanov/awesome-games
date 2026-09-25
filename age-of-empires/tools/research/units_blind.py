#!/usr/bin/env python3
"""Слепой тест узнаваемости: кропы наших юнитов под случайными номерами (ключ — отдельно).

  .venv/bin/python tools/research/units_blind.py            # → shots/research_units/blind/{tex,sil}/NNN_{1x,3x}.png + листы
Ключ: shots/research_units/blind/_key.json (не открывать до записи догадок).
"""
import json, os, random, sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(__file__))
from units_common import Q, OUT, frame, on_grass

B = os.environ.get('UNITS_BLIND_DIR') or os.path.join(OUT, 'blind')      # другой прогон — другая папка


def sheet(tiles, path, cols=8):
    W = max(t.size[0] for _, t in tiles) + 6
    H = max(t.size[1] for _, t in tiles) + 16
    rows = (len(tiles) + cols - 1) // cols
    out = Image.new('RGB', (cols * W, rows * H), (30, 30, 30))
    d = ImageDraw.Draw(out)
    for i, (n, t) in enumerate(tiles):
        x, y = (i % cols) * W, (i // cols) * H
        out.paste(t, (x + (W - t.size[0]) // 2, y + 14 + (H - 16 - t.size[1])))
        d.text((x + 2, y + 1), n, fill=(255, 255, 0))
    out.save(path)


def main():
    # зерно раскладки номеров: новое на каждый прогон (--seed N), иначе догадки прошлого прогона подсказывают
    seed = int(sys.argv[sys.argv.index('--seed') + 1]) if '--seed' in sys.argv else 20260925
    rnd = random.Random(seed)
    for sub in ('tex', 'sil'):
        os.makedirs(os.path.join(B, sub), exist_ok=True)
    ids_t = rnd.sample(range(100, 1000), len(Q))
    ids_s = rnd.sample(range(100, 1000), len(Q))
    key = {'tex': {}, 'sil': {}}
    tt, ts = [], []
    for qq, it, isl in zip(Q, ids_t, ids_s):
        img, m, ax, ay = frame(qq['set'], qq['anim'], qq['frac'])
        g = on_grass(img)
        g3 = g.resize((g.size[0] * 3, g.size[1] * 3), Image.NEAREST)
        g.save(os.path.join(B, 'tex', f'{it}_1x.png'))
        g3.save(os.path.join(B, 'tex', f'{it}_3x.png'))
        sil = img.copy()
        sil[..., :3] = 0
        sil[..., 3] = np.where((img[..., 3] > 200) | ((img[..., 3] > 40) & (img[..., :3].sum(-1) > 45)), 255, 0)
        s = on_grass(sil, bg=(235, 235, 235))
        s3 = s.resize((s.size[0] * 3, s.size[1] * 3), Image.NEAREST)
        s3.save(os.path.join(B, 'sil', f'{isl}_3x.png'))
        key['tex'][str(it)] = qq['key']
        key['sil'][str(isl)] = qq['key']
        tt.append((str(it), g3, g))
        ts.append((str(isl), s3))
    json.dump(key, open(os.path.join(B, '_key.json'), 'w'), indent=0)
    tt.sort(key=lambda x: x[0]); ts.sort(key=lambda x: x[0])
    for f in os.listdir(B):
        if f.startswith('sheet_'):
            os.remove(os.path.join(B, f))
    for i in range(0, len(tt), 15):
        sheet([(n, t) for n, t, _ in tt[i:i + 15]], os.path.join(B, f'sheet_tex3x_{i // 15}.png'), cols=5)
        sheet(ts[i:i + 15], os.path.join(B, f'sheet_sil_{i // 15}.png'), cols=5)
    for i in range(0, len(tt), 45):
        sheet([(n, t) for n, _, t in tt[i:i + 45]], os.path.join(B, f'sheet_tex1x_{i // 45}.png'), cols=15)
    print(len(Q), 'quanta')


if __name__ == '__main__':
    main()
