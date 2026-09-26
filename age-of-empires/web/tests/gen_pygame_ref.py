"""Reference values from real pygame-ce for web/tests/runtime.html (run: .venv/bin/python web/tests/gen_pygame_ref.py)."""
import json
import math
import os

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('PYGAME_HIDE_SUPPORT_PROMPT', '1')
import pygame

pygame.init()
pygame.display.set_mode((64, 64))
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
out = {'pygame': pygame.version.ver}

# ---- fonts: height/ascent/descent/linesize and string widths
fonts = {}
for fn, size in [('PTSerif-Bold.ttf', 15), ('PTSerif-Bold.ttf', 21), ('FreeSans.ttf', 12), ('FreeSans.ttf', 14),
                 ('CormorantSC-Bold.ttf', 29), ('CormorantSC-Bold.ttf', 74), ('LinBiolinum_RBah.ttf', 13)]:
    f = pygame.font.Font(os.path.join(ROOT, 'assets', 'fonts', fn), size)
    strs = ['Villager', 'Wood: 1,250', 'Castle Age', 'Жители', 'Hello, world!', 'Ä']
    fonts[f'{fn}:{size}'] = {'file': 'assets/fonts/' + fn, 'size': size, 'height': f.get_height(),
                             'ascent': f.get_ascent(), 'descent': f.get_descent(), 'linesize': f.get_linesize(),
                             'widths': {s: f.size(s)[0] for s in strs}, 'render': list(f.render('Villager', True, (255, 255, 255)).get_size()),
                             'empty': list(f.render('', True, (255, 255, 255)).get_size())}
out['fonts'] = fonts

# ---- transform sizes
s = pygame.Surface((100, 50), pygame.SRCALPHA)
out['rotate'] = {str(a): list(pygame.transform.rotate(s, a).get_size()) for a in (0, 45, -45, 90, 30, 180, 270, 13.5)}
out['rotozoom'] = {f'{a}:{k}': list(pygame.transform.rotozoom(s, a, k).get_size()) for a, k in ((0, 0.5), (0, 0.37), (0, 1.3), (30, 1.0), (45, 0.5))}

# ---- pixel semantics
def px(surf, pos=(0, 0)):
    return list(surf.get_at(pos))

r = {}
a = pygame.Surface((4, 4), pygame.SRCALPHA)
a.fill((255, 0, 0, 255)); a.fill((0, 0, 255, 100)); r['fill_replace'] = px(a)
o = pygame.Surface((4, 4)); o.fill((10, 20, 30, 40)); r['fill_opaque_alpha'] = px(o)
o = pygame.Surface((4, 4)); o.fill((0, 0, 0)); w = pygame.Surface((4, 4), pygame.SRCALPHA); w.fill((255, 255, 255, 128)); o.blit(w, (0, 0)); r['blit_alpha'] = px(o)
o = pygame.Surface((4, 4)); o.fill((0, 0, 0)); w = pygame.Surface((4, 4)); w.fill((200, 100, 50)); w.set_alpha(64); o.blit(w, (0, 0)); r['blit_set_alpha'] = px(o)
o = pygame.Surface((4, 4)); o.fill((200, 100, 50)); o.fill((128, 128, 128), special_flags=pygame.BLEND_RGB_MULT); r['fill_rgb_mult'] = px(o)
a = pygame.Surface((4, 4), pygame.SRCALPHA); a.fill((10, 10, 10, 77)); a.fill((100, 0, 0), special_flags=pygame.BLEND_RGB_ADD); r['fill_rgb_add_alpha'] = px(a)
a = pygame.Surface((4, 4), pygame.SRCALPHA); a.fill((100, 150, 200, 200)); a.fill((255, 255, 255, 128), special_flags=pygame.BLEND_RGBA_MULT); r['fill_rgba_mult'] = px(a)
a = pygame.Surface((4, 4), pygame.SRCALPHA); a.fill((0, 0, 0, 255)); b = pygame.Surface((4, 4), pygame.SRCALPHA); b.fill((0, 0, 0, 130)); a.blit(b, (0, 0), special_flags=pygame.BLEND_RGBA_SUB); r['blit_rgba_sub'] = px(a)
o = pygame.Surface((4, 4)); o.fill((250, 20, 20)); b = pygame.Surface((4, 4)); b.fill((10, 30, 5)); o.blit(b, (0, 0), special_flags=pygame.BLEND_RGB_SUB); r['blit_rgb_sub'] = px(o)
o = pygame.Surface((4, 4)); o.fill((100, 100, 100)); b = pygame.Surface((4, 4), pygame.SRCALPHA); b.fill((50, 60, 70, 10)); o.blit(b, (0, 0), special_flags=pygame.BLEND_RGB_ADD); r['blit_rgb_add_srcalpha'] = px(o)
a = pygame.Surface((4, 4), pygame.SRCALPHA); a.fill((200, 200, 200, 200)); m = pygame.Surface((4, 4), pygame.SRCALPHA); m.fill((100, 250, 50, 90)); a.blit(m, (0, 0), special_flags=pygame.BLEND_RGBA_MIN); r['blit_rgba_min'] = px(a)
g = pygame.Surface((4, 4), pygame.SRCALPHA); g.fill((200, 100, 50, 180)); r['grayscale'] = px(pygame.transform.grayscale(g))
# subsurface writes go to the parent; clip limits fill
p = pygame.Surface((10, 10), pygame.SRCALPHA); sub = p.subsurface((2, 3, 4, 4)); sub.fill((9, 8, 7, 255)); r['sub_parent'] = [px(p, (2, 3)), px(p, (5, 6)), px(p, (6, 6)), px(p, (1, 3))]
p = pygame.Surface((10, 10)); p.set_clip((0, 0, 5, 5)); p.fill((255, 255, 255)); r['clip_fill'] = [px(p, (4, 4)), px(p, (5, 5))]
# bounding rect
b = pygame.Surface((20, 20), pygame.SRCALPHA); pygame.draw.rect(b, (255, 0, 0), (3, 4, 5, 6)); b.set_at((15, 2), (0, 0, 0, 50))
r['bounding'] = list(b.get_bounding_rect()); r['bounding_128'] = list(b.get_bounding_rect(min_alpha=128))
# draw returns
t = pygame.Surface((50, 50), pygame.SRCALPHA)
r['draw_circle'] = list(pygame.draw.circle(t, (255, 255, 255), (20, 20), 7))
r['draw_rect'] = list(pygame.draw.rect(t, (255, 255, 255), (5, 6, 10, 12), 2))
# draw.rect on SRCALPHA with a translucent color replaces pixels
t = pygame.Surface((10, 10), pygame.SRCALPHA); t.fill((255, 0, 0, 255)); pygame.draw.rect(t, (0, 255, 0, 60), (0, 0, 5, 5)); r['draw_replace'] = px(t, (2, 2))
t = pygame.Surface((10, 10)); pygame.draw.circle(t, (255, 255, 255, 30), (5, 5), 4); r['draw_opaque_alpha'] = px(t, (5, 5))
# colorkey
ck = pygame.Surface((4, 4)); ck.fill((255, 0, 255)); ck.set_at((1, 1), (10, 20, 30)); ck.set_colorkey((255, 0, 255))
d = pygame.Surface((4, 4)); d.fill((1, 2, 3)); d.blit(ck, (0, 0)); r['colorkey'] = [px(d, (0, 0)), px(d, (1, 1))]
# mask
mk = pygame.mask.from_surface(b, 127); r['mask_count'] = mk.count()
# frombuffer RGB
fb = pygame.image.frombuffer(bytes([1, 2, 3, 4, 5, 6]), (2, 1), 'RGB'); r['frombuffer_rgb'] = [px(fb, (1, 0)), fb.get_flags() & pygame.SRCALPHA]
# convert on SRCALPHA drops alpha
cv = pygame.Surface((2, 2), pygame.SRCALPHA); cv.fill((50, 60, 70, 10)); r['convert_alpha_drop'] = px(cv.convert())
out['pixels'] = r
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'pygame_ref.json')
with open(path, 'w') as fh:
    json.dump(out, fh, ensure_ascii=False, indent=1)
print('wrote', path, pygame.version.ver)
