"""Общее для исследования узнаваемости юнитов (docs/research/06_units_recognition.md)."""
import json, os
import numpy as np
from PIL import Image

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
GEN = os.path.join(REPO, 'assets', 'gen')
OUT = os.path.join(REPO, 'shots', 'research_units')
GRASS = (98, 140, 62)
BLUE = (0, 0, 255)            # PLAYER_COLORS[0] (game/data.py)
TA, TB, TD = 0.40, 0.85, 0.30  # как game/sprites3d.recolor

# квант: (ключ, класс, набор, анимация, доля кадра, подпись)
Q = []
def q(key, cls, sset, anim='idle', frac=0.0, label=None):
    Q.append(dict(key=key, cls=cls, set=sset, anim=anim, frac=frac, label=label or key))

for k, s in [('militia', 'militia.caro'), ('man_at_arms', 'man_at_arms.caro'), ('long_swordsman', 'long_swordsman.caro'),
             ('two_handed_swordsman', 'two_handed_swordsman.caro'), ('champion', 'champion.caro'),
             ('spearman', 'spearman.caro'), ('pikeman', 'pikeman.caro'), ('halberdier', 'halberdier.caro')]:
    q(k, 'пехота', s)
for k, s in [('archer', 'archer.caro'), ('crossbowman', 'crossbowman.caro'), ('arbalester', 'arbalester.caro'),
             ('skirmisher', 'skirmisher.caro'), ('elite_skirmisher', 'elite_skirmisher.caro'), ('hand_cannoneer', 'gun')]:
    q(k, 'стрелки', s)
for k, s in [('scout', 'scout.caro'), ('light_cavalry', 'light_cavalry.caro'), ('hussar', 'hussar.caro'),
             ('knight', 'knight.caro'), ('cavalier', 'cavalier.caro'), ('paladin', 'paladin.caro'),
             ('cavalry_archer', 'cavalry_archer.caro'), ('heavy_cavalry_archer', 'heavy_cavalry_archer.caro'),
             ('camel_rider', 'camel'), ('heavy_camel_rider', 'camel_h')]:
    q(k, 'кавалерия', s)
for k, s in [('ram', 'ram_log'), ('capped_ram', 'ram_capped'), ('siege_ram', 'ram_siege'), ('mangonel', 'mangonel'),
             ('onager', 'onager'), ('siege_onager', 'onager_s'), ('scorpion', 'scorpio'), ('heavy_scorpion', 'ballista'),
             ('bombard_cannon', 'bombard'), ('trebuchet', 'treb_packed'), ('trebuchet_up', 'treb_up')]:
    q(k, 'осадные', s)
# корабли: набор берётся из индекса по виду (группа caro) — имена наборов меняются вместе с моделями
for k in ('fishing_ship', 'transport_ship', 'galley', 'war_galley', 'galleon', 'fire_galley', 'demolition_ship',
          'heavy_demolition_ship', 'cannon_galleon'):
    s = '@' + k
    q(k, 'флот', s, 'walk')
for k, s in [('throwing_axeman', 'axe_thrower'), ('elite_throwing_axeman', 'axe_thrower_e'), ('longbowman', 'longbow'),
             ('elite_longbowman', 'longbow_e'), ('mangudai', 'mangudai'), ('elite_mangudai', 'mangudai_e'),
             ('cataphract', 'cataphract'), ('elite_cataphract', 'cataphract_e'), ('teutonic_knight', 'teuton'),
             ('elite_teutonic_knight', 'teuton_e'), ('samurai', 'samurai'), ('elite_samurai', 'samurai_e'),
             ('chu_ko_nu', 'chukonu'), ('elite_chu_ko_nu', 'chukonu_e'), ('war_elephant', 'elephant'),
             ('elite_war_elephant', 'elephant_e'), ('mameluke', 'mameluke'), ('elite_mameluke', 'mameluke_e'),
             ('janissary', 'janissary'), ('elite_janissary', 'janissary_e'), ('berserk', 'berserk'),
             ('elite_berserk', 'berserk_e'), ('huskarl', 'huskarl'), ('elite_huskarl', 'huskarl_e'),
             ('woad_raider', 'woad'), ('elite_woad_raider', 'woad_e'), ('conquistador', 'conquistador'),
             ('elite_conquistador', 'conquistador_e')]:
    q(k, 'уникальные', s)
q('villager_m', 'жители', 'vil_m.caro'); q('villager_f', 'жители', 'vil_f.caro')
for a in ['chop', 'mine', 'farm', 'build', 'forage', 'butcher', 'carry_wood']:
    q('vil_m_' + a, 'жители', 'vil_m.caro', a, 0.45)
for a in ['chop', 'farm', 'build']:
    q('vil_f_' + a, 'жители', 'vil_f.caro', a, 0.45)
q('monk', 'прочие', 'monk.caro'); q('trade_cart', 'прочие', 'trader.byz', 'walk')
q('sheep', 'звери', 'sheep'); q('deer', 'звери', 'deer'); q('boar', 'звери', 'boar')

def _resolve_sets():
    """'@вид' → имя набора группы caro по units/index.json (если индекс уже собран)."""
    try:
        with open(os.path.join(GEN, 'units', 'index.json'), encoding='utf-8') as f:
            units = json.load(f)['units']
    except (OSError, ValueError, KeyError):
        return
    for x in Q:
        if x['set'].startswith('@') and x['set'][1:] in units:
            m = units[x['set'][1:]]
            x['set'] = m.get('caro') or next(iter(m.values()))


_resolve_sets()
GUESS_LIST = [x['key'] for x in Q if x['cls'] != 'жители'] + ['villager_m', 'villager_f', 'fire_ship', 'fast_fire_ship']
FACE = 3  # направление из 16: ≈ к зрителю (вниз-влево), как портреты DE


def index():
    return json.load(open(os.path.join(GEN, 'units', 'index.json'), encoding='utf-8'))


def tinted(rec, color=BLUE):
    im = np.asarray(Image.open(os.path.join(GEN, rec['file'])).convert('RGBA')).astype(np.float32)
    if rec.get('mask') and color is not None:
        m = np.asarray(Image.open(os.path.join(GEN, rec['mask'])).convert('L')).astype(np.float32)[..., None] / 255
        g = (im[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32))[..., None]
        c = np.array(color, np.float32)[None, None]
        t = np.clip(g * np.minimum(255, c * TB + 255 * TD) / 255 + c * TA, 0, 255)
        im[..., :3] = im[..., :3] * (1 - m) + t * m
    return im


_cache = {}
def frame(sname, anim='idle', frac=0.0, d=FACE, color=BLUE, with_mask=False):
    """(RGBA float array, mask array, ax, ay) кадра."""
    ix = index()
    idx = ix['sets']
    if sname.startswith('@'):
        sname = ix['units'][sname[1:]]['caro']
    rec = idx[sname]
    key = (sname, color)
    if key not in _cache:
        m = None
        if rec.get('mask'):
            m = np.asarray(Image.open(os.path.join(GEN, rec['mask'])).convert('L')).astype(np.float32) / 255
        _cache[key] = (tinted(rec, color), m, json.load(open(os.path.join(GEN, rec['meta'])))['frames'])
    sheet, m, fr = _cache[key]
    a = rec['anims'].get(anim) or rec['anims'].get('walk') or rec['anims']['idle']
    nd = rec.get('dirs') or 8
    dd = round(d * nd / 16) % nd
    k = int(a['n'] * frac) % a['n']
    x, y, w, h, ax, ay = fr[a['i0'] + dd * a['n'] + k]
    img = sheet[y:y + h, x:x + w].copy()
    mm = m[y:y + h, x:x + w].copy() if m is not None else np.zeros((h, w), np.float32)
    return img, mm, ax, ay


def on_grass(img, pad=4, bg=GRASS):
    h, w = img.shape[:2]
    out = np.zeros((h + 2 * pad, w + 2 * pad, 3), np.float32)
    out[:] = bg
    a = img[..., 3:4] / 255
    out[pad:pad + h, pad:pad + w] = img[..., :3] * a + out[pad:pad + h, pad:pad + w] * (1 - a)
    return Image.fromarray(out.astype(np.uint8))
