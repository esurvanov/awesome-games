#!/usr/bin/env python3
"""compose.py — image work for tools/look-gate.mjs (Pillow).

    python3 tools/look/compose.py <job.json>

job = { "out": dir, "W": 900, "H": 600, "refs": [{id, crop:[x0,y0,x1,y1]}], "subjects": [{name, shots:[..], refs:[ids], motions:[..], mrefs:[ids]}],
        "accepted": dir|null }
Writes  <out>/ref/<id>.jpg           reference cropped to the game aspect around the given box, resized to W×H
        <out>/<subject>.pair.jpg      the reviewer's sheet: game shots (left column) | crop-matched photos (right), labelled
        <out>/<subject>.vs.jpg        accepted (left) | current (right) per shot, when an accepted run exists
        <out>/<motion>.strip.jpg      motion frames in a 4-column grid with time labels
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

job = json.load(open(sys.argv[1]))
OUT, W, H = job['out'], job.get('W', 900), job.get('H', 600)
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
REF = os.path.join(ROOT, 'references', 'img')
os.makedirs(os.path.join(OUT, 'ref'), exist_ok=True)
try:
    FONT = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 22)
    SMALL = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 16)
except Exception:
    FONT = SMALL = ImageFont.load_default()


def crop_to_aspect(im, box):
    w, h = im.size
    x0, y0, x1, y1 = box or [0, 0, 1, 1]
    x0, x1, y0, y1 = x0 * w, x1 * w, y0 * h, y1 * h
    bw, bh, a = x1 - x0, y1 - y0, W / H
    if bw / bh > a:   # too wide → shrink width around the centre
        cx = (x0 + x1) / 2; bw = bh * a; x0, x1 = cx - bw / 2, cx + bw / 2
    else:
        cy = (y0 + y1) / 2; bh = bw / a; y0, y1 = cy - bh / 2, cy + bh / 2
    return im.crop((round(x0), round(y0), round(x1), round(y1))).resize((W, H), Image.LANCZOS)


def label(img, text, sub=None, color=(255, 214, 90)):
    d = ImageDraw.Draw(img)
    tw = d.textlength(text, font=FONT) + 16
    d.rectangle([0, 0, tw, 32], fill=(0, 0, 0))
    d.text((8, 4), text, font=FONT, fill=color)
    if sub:
        sw = d.textlength(sub, font=SMALL) + 12
        d.rectangle([0, img.height - 26, sw, img.height], fill=(0, 0, 0))
        d.text((6, img.height - 23), sub, font=SMALL, fill=(220, 225, 235))
    return img


def load_fit(p):
    im = Image.open(p).convert('RGB')
    if im.size != (W, H):
        im = crop_to_aspect(im, None)
    return im


refs = {}
for r in job['refs']:
    p = os.path.join(OUT, 'ref', r['id'] + '.jpg')
    crop_to_aspect(Image.open(os.path.join(REF, r['id'] + '.jpg')).convert('RGB'), r.get('crop')).save(p, quality=88)
    refs[r['id']] = p


def grid(tiles, cols, path):
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * W + (cols - 1) * 6, rows * H + (rows - 1) * 6), (10, 12, 20))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * (W + 6), (i // cols) * (H + 6)))
    sheet.save(path, quality=86)


for s in job['subjects']:
    for m in s.get('motions', []):
        fd = os.path.join(OUT, 'motion', m)
        if not os.path.isdir(fd):
            continue
        meta = json.load(open(os.path.join(fd, 'frames.json')))
        fr = [label(Image.open(os.path.join(fd, f['file'])).convert('RGB').resize((W // 2, H // 2)), '%.2f s' % f['t']) for f in meta['frames']]
        if not fr:
            continue
        cols, tw, th = 4, W // 2, H // 2
        rows = (len(fr) + cols - 1) // cols
        sheet = Image.new('RGB', (cols * tw + (cols - 1) * 4, rows * th + (rows - 1) * 4), (10, 12, 20))
        for i, t in enumerate(fr):
            sheet.paste(t, ((i % cols) * (tw + 4), (i // cols) * (th + 4)))
        sheet.save(os.path.join(OUT, m + '.strip.jpg'), quality=86)


for s in job['subjects']:
    left = [label(load_fit(os.path.join(OUT, sh + '.png')), 'GAME · ' + sh) for sh in s['shots'] if os.path.exists(os.path.join(OUT, sh + '.png'))]
    right = [label(Image.open(refs[i]).convert('RGB'), 'PHOTO · ' + i, color=(140, 220, 255)) for i in s['refs'] if i in refs]
    tiles = left + right
    if tiles:
        grid(tiles, 2, os.path.join(OUT, s['name'] + '.pair.jpg'))
    acc = job.get('accepted')
    if acc:
        vt = []
        for sh in s['shots']:
            a, c = os.path.join(acc, sh + '.png'), os.path.join(OUT, sh + '.png')
            if os.path.exists(a) and os.path.exists(c):
                vt += [label(load_fit(a), 'ACCEPTED · ' + sh, color=(160, 160, 160)), label(load_fit(c), 'NOW · ' + sh)]
        for m in s.get('motions', []):
            a, c = os.path.join(acc, m + '.strip.jpg'), os.path.join(OUT, m + '.strip.jpg')
            if os.path.exists(a) and os.path.exists(c):
                vt += [label(load_fit(a), 'ACCEPTED · ' + m, color=(160, 160, 160)), label(load_fit(c), 'NOW · ' + m)]
        if vt:
            grid(vt, 2, os.path.join(OUT, s['name'] + '.vs.jpg'))
print('composed', len(job['subjects']), 'subjects')
