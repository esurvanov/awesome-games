# python3 montage.py out.jpg label1=img1 label2=img2 ...   (stacks strips vertically with a label column)
import sys
from PIL import Image, ImageDraw
out = sys.argv[1]; items = [a.split('=', 1) for a in sys.argv[2:]]
ims = [(l, Image.open(p).convert('RGB')) for l, p in items]
W = max(i.width for _, i in ims) + 150; H = sum(i.height for _, i in ims)
M = Image.new('RGB', (W, H), (240, 242, 245)); d = ImageDraw.Draw(M); y = 0
for l, i in ims:
    M.paste(i, (150, y)); d.text((6, y + 8), l.replace('_', ' ').replace(' ', '\n', 2), fill=(20, 20, 20)); y += i.height
M.save(out, quality=85)
