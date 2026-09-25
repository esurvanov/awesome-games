"""Акторы 0 A.D. с анимацией: выбор вариантов по «состоянию» (как в движке: имя анимации + набор выборов),
дерево пропов, поза в момент времени → список Part с готовой (деформированной скиннингом) геометрией.

  tree = build('units/britons/infantry_spearman_b.xml', 'walk', seed=0)            # дерево ANode
  tree = build('units/britons/citizen_male.xml', 'walk', sel={'carry_wood'})       # походка с ношей
  tree = build('units/britons/citizen_male.xml', 'gather_tree')                    # вариант gather_tree
  parts = evaluate(tree, 0.25)                    # доля цикла 0..1 (у всех узлов одна фаза: всадник ↔ конь)
  anim_info(tree)                                 # {'dur', 'event', 'file', ...} анимации корня

Как в 0 A.D.: из каждой группы берётся вариант, имя которого (своё или корня файла variants/…) есть в наборе
выборов (имя анимации + sel); иначе — взвешенно по frequency. Анимации вариантов сливаются, одноимённые
у более позднего варианта заменяют прежние. Пропы с пустым actor снимают проп с точки. У каждого пропа
анимация с тем же именем (если есть) — лук натягивается вместе с рукой, всадник играет свою рысь на коне.
"""
import random
from dataclasses import dataclass, field

import numpy as np

from . import assets, paint as _paint, procmesh, skin
from .actor import Part, _actor_root, _variant_file

# чем заменить анимацию, если у актора нет нужной (по порядку)
FALLBACK = {
    'run': ['walk'],
    'walk': ['run', 'idle'],
    'attack_melee': ['attack_slaughter', 'attack_ranged', 'attack_capture', 'idle'],
    'attack_ranged': ['attack_melee', 'attack_slaughter', 'idle'],
    'attack_slaughter': ['attack_melee', 'idle'],
    'death': ['idle'],
    'build': ['gather_tree', 'idle'],
    'heal': ['idle'],
}
SKIP_POINTS = {'projectile', 'loaded-projectile', 'decals'}


@dataclass
class ANode:
    actor: str
    mesh: str
    textures: dict
    material: str
    anim: dict = None                   # {'file', 'name', 'speed', 'event', 'load', 'id'}
    props: list = field(default_factory=list)       # [(attachpoint, ANode, scale)]
    color: tuple = None                 # <color> варианта: цвет объекта (волосы, шерсть) для objectcolor
    paint: str = None                   # стиль перекраски одежды тела (tools/render3d/paint.py)


def _eff(v):
    """Имя и частота варианта с учётом цепочки файлов-основ (атрибуты ближнего элемента важнее)."""
    name = v.get('name')
    freq = v.get('frequency')
    f = v.get('file')
    guard = 0
    while f and (name is None or freq is None) and guard < 6:
        guard += 1
        base = _variant_file(f)
        if base is None:
            break
        name = name if name is not None else base.get('name')
        freq = freq if freq is not None else base.get('frequency')
        f = base.get('file')
    return (name or '').strip().lower(), float(freq or 0)


def _choose(root, sel, seed, depth):
    out = []
    for gi, g in enumerate(root.findall('group')):
        vs = g.findall('variant')
        if not vs:
            continue
        eff = [_eff(v) for v in vs]
        chosen = None
        for want in sel:
            for v, (n, _) in zip(vs, eff):
                if n and n == want:
                    chosen = v
                    break
            if chosen is not None:
                break
        if chosen is None:
            w = [f for _, f in eff]
            if sum(w) <= 0:
                chosen = vs[0]
            else:
                r = random.Random(seed * 1009 + depth * 97 + gi * 13)
                chosen = r.choices(vs, weights=w)[0]
        out.append(chosen)
    return out


def _merge(acc, v):
    f = v.get('file')
    if f:
        base = _variant_file(f)
        if base is not None:
            _merge(acc, base)
    m = v.find('mesh')
    if m is not None and (m.text or '').strip():
        acc['mesh'] = m.text.strip()
    tx = v.find('textures')
    if tx is not None:
        for t in tx.findall('texture'):
            acc['textures'][t.get('name')] = t.get('file')
    pr = v.find('props')
    if pr is not None:
        for p in pr.findall('prop'):
            ap = p.get('attachpoint')
            a = p.get('actor') or ''
            acc['props'] = [x for x in acc['props'] if x[1] != ap] if not a else acc['props']
            if a:
                acc['props'].append((a, ap))
    c = v.find('color')
    if c is not None and (c.text or '').strip():
        try:
            acc['color'] = tuple(int(float(x)) for x in c.text.split()[:3])
        except ValueError:
            pass
    an = v.find('animations')
    if an is not None:
        new = []
        for a in an.findall('animation'):
            new.append({'file': a.get('file') or '', 'name': (a.get('name') or '').lower(),
                        'speed': float(a.get('speed') or 100), 'event': float(a.get('event') or 0.5),
                        'load': float(a.get('load') or 0), 'id': a.get('id') or '',
                        'frequency': float(a.get('frequency') or 1)})
        names = {a['name'] for a in new}
        acc['anims'] = [a for a in acc['anims'] if a['name'] not in names] + new


def pick_anim(anims, name, pick=0):
    """Анимация по имени (с запасными именами). pick — номер среди одноимённых (или id)."""
    for nm in [name] + FALLBACK.get(name, []):
        lst = [a for a in anims if a['name'] == nm]
        if lst:
            if isinstance(pick, str):
                hit = [a for a in lst if a['id'] == pick]
                if hit:
                    return hit[0]
                pick = 0
            if name == 'idle' and pick == 0:
                return max(lst, key=lambda a: a['frequency'])
            return lst[pick % len(lst)]
    return None


def _proc_node(actor, anim):
    """Процедурный проп ('@musket', '@bombard'…, tools/render3d/procmesh.py) → ANode с деталями на 'root'."""
    parts = procmesh.ACTORS.get(actor)
    if parts is None:
        return None
    a = anim.lower()
    pa = {'file': '', 'name': a, 'speed': 100, 'event': 0.35, 'load': 0, 'id': '', 'frequency': 1,
          'proc': True, 'dur': procmesh.DUR.get(a, 1.0)}
    moving = actor in procmesh.ANIMATED          # у ручного оружия своих движений нет — анимацию задаёт тело
    node = ANode(actor=actor, mesh=None, textures={}, material='no_trans_norm_spec.xml',
                 anim=dict(pa) if moving else None)
    for m, tex in parts:
        # '@tex/player…' — ткань цвета игрока (маска — альфа текстуры, как у 0 A.D.)
        mat = 'player_trans_norm_spec.xml' if tex.startswith('@tex/player') else 'no_trans_norm_spec.xml'
        node.props.append(('root', ANode(actor=actor, mesh=m, textures={'baseTex': tex},
                                         material=mat, anim=dict(pa) if moving else None), 1.0))
    return node


def _sub_override(override, ap):
    """Часть override для пропа в точке ap: ключи 'ap>…' без префикса."""
    if not override:
        return None
    pre = ap + '>'
    sub = {k[len(pre):]: v for k, v in override.items() if k.startswith(pre)}
    return sub or None


def build(actor, anim='idle', sel=(), seed=0, depth=0, skip=None, pick=0, prop_scale=None, override=None,
          paint=None):
    """Актор → дерево ANode для анимации anim. sel — дополнительные выборы вариантов (carry_wood…).
    skip(actor, attachpoint) → True — пропустить проп.

    override — правки дерева (ключи этого уровня; 'rider>…' — для пропа в точке rider и глубже):
      'weapon_R': актор | None | (актор, масштаб)  — заменить/снять проп (масштаб — число или (sx, sy, sz));
      'weapon_R+': актор | (актор, масштаб)        — добавить ещё один проп в точку, не снимая прежних;
      '#baseTex': файл                               — заменить текстуру меша;
      '#mesh': файл                                  — заменить меш;
      '#anim:walk': файл .dae                        — своя анимация для состояния (walk, idle, attack_ranged…);
      '#color': (r, g, b)                            — цвет объекта (objectcolor);
      '#paint': стиль | None                         — перекраска одежды тела (paint.py) для этого узла и ниже.
    paint — стиль перекраски одежды тел людей по умолчанию (paint.STYLES), наследуется пропами.
    Актор-строка '@…' — процедурный проп (procmesh)."""
    if depth > 8:
        return None
    if procmesh.is_proc(actor):
        return _proc_node(actor, anim)
    root = _actor_root(actor)
    if root is None:
        return None
    selections = [anim.lower()] + [s.lower() for s in sel]
    acc = {'mesh': None, 'textures': {}, 'props': [], 'anims': [], 'color': None}
    chosen = _choose(root, selections, seed, depth)
    for v in chosen:
        _merge(acc, v)
    # как в движке: имена выбранных вариантов передаются пропам (плащ берёт тот же набор анимаций, что тело)
    sub = list(sel) + [n for n in (_eff(v)[0] for v in chosen) if n and n not in selections]
    scales = {}
    if override:
        for key, a in override.items():
            if '>' in key or key.startswith('#'):
                continue
            k = 1.0
            if isinstance(a, tuple):
                a, k = a
            if key.endswith('+'):
                ap = key[:-1]
            else:
                ap = key
                acc['props'] = [x for x in acc['props'] if x[1] != ap]
            if a:
                acc['props'].append((a, ap))
                scales[(a, ap)] = k
        for key, v in override.items():
            if key == '#baseTex':
                acc['textures']['baseTex'] = v
            elif key == '#mesh':
                acc['mesh'] = v
            elif key == '#color':
                acc['color'] = tuple(v)
    mat_el = root.find('material')
    material = (mat_el.text or '').strip() if mat_el is not None else 'default.xml'
    an = pick_anim(acc['anims'], anim.lower(), pick)
    f = (override or {}).get('#anim:' + anim.lower())
    if f:
        ev = None
        if isinstance(f, tuple):          # (файл, момент выстрела/удара в доле цикла)
            f, ev = f
        an = dict(an or {'speed': 100, 'event': 0.5, 'load': 0, 'id': '', 'frequency': 1}, file=f, name=anim.lower())
        if ev is not None:
            an['event'] = ev
    if override and '#paint' in override:
        paint = override['#paint']
    node = ANode(actor=actor, mesh=acc['mesh'], textures=acc['textures'], material=material,
                 anim=an, color=acc['color'])
    if paint and _paint.applies(acc['mesh'], material) and acc['textures'].get('baseTex'):
        node.paint = paint
    for pa, ap in acc['props']:
        if pa.startswith('particle/') or ap in SKIP_POINTS or 'blood' in pa or (skip and skip(pa, ap)):
            continue
        k = scales.get((pa, ap), 1.0)
        for pre, kk in (prop_scale or {}).items():
            if pa.startswith(pre):
                k = kk
                break
        ch = build(pa, anim, sub, seed, depth + 1, skip, pick, prop_scale, _sub_override(override, ap), paint)
        if ch is not None:
            node.props.append((ap, ch, k))
    return node


def anim_info(node, want=None):
    """Анимация, задающая длительность цикла: первая в дереве (корень, затем пропы) с именем из want
    (например, у верблюда нет атаки, а у всадника есть); без want или если такой нет — корня/первого пропа."""
    def walk(n, ok):
        if n.anim and (ok is None or n.anim['name'] in ok):
            if n.anim.get('proc'):
                return dict(n.anim)
            if skin.animation(n.anim['file']) is not None:
                return dict(n.anim, dur=skin.animation(n.anim['file'])['dur'])
        for _, ch, _ in n.props:
            r = walk(ch, ok)
            if r:
                return r
        return None
    return (walk(node, set(want)) if want else None) or walk(node, None)


def evaluate(node, frac, matrix=None, rest=False, _out=None):
    """Поза дерева в доле цикла frac (0..1) → list[Part] с геометрией (Part.geom) в координатах модели корня."""
    out = [] if _out is None else _out
    matrix = np.eye(4) if matrix is None else matrix
    geom, points = None, {}
    if node.mesh and procmesh.is_proc(node.mesh):
        geom = procmesh.mesh(node.mesh, node.anim['name'] if node.anim and not rest else None, frac)
    elif node.mesh:
        sm = skin.skinned(node.mesh)
        if sm is not None:
            an = None if rest or not node.anim else skin.animation(node.anim['file'])
            t = frac * an['dur'] if an is not None else 0.0
            W = skin.pose(sm['skel'], an, t)
            geom = skin.deform(sm, W)
            points = skin.prop_points(sm['skel'], W)
        else:
            m = assets.mesh(node.mesh)
            if m is not None:
                geom = m
                points = dict(m['props'])
                # статичный меш с собственным скелетом без скина (стрелы, некоторые пропы) — точки из позы
                if node.anim and not rest:
                    an = skin.animation(node.anim['file'])
                    if an is not None:
                        W = skin.world(an['names'], an['parent'], skin.sample_local(an, frac * an['dur']))
                        for i, n in enumerate(an['names']):
                            if n.startswith('prop-') or n.startswith('prop_'):
                                points[n[5:]] = skin.orthonormal(W[i])
    if geom is not None and node.paint:
        # одежда тела: исходная часть (R2) + узор стиля с новой развёрткой (paint.py)
        tx = node.textures
        for g, role in _paint.split(node.mesh, node.paint, geom):
            base = _paint.orig_key(tx['baseTex']) if role == 'orig' else _paint.cloth_key(node.paint)
            out.append(Part(mesh=node.mesh, matrix=matrix, textures=dict(tx, baseTex=base),
                            material=node.material, actor=node.actor, geom=g))
    elif geom is not None:
        out.append(Part(mesh=node.mesh, matrix=matrix, textures=_textures(node), material=node.material,
                        actor=node.actor, geom=geom))
    for ap, ch, k in node.props:
        if ap == 'root':
            pm = np.eye(4)
        else:
            pm = points.get(ap)
            if pm is None:
                continue
        if isinstance(k, tuple):
            pm = pm @ np.diag([k[0], k[1], k[2], 1.0])
        elif k != 1.0:
            pm = pm @ np.diag([k, k, k, 1.0])
        evaluate(ch, frac, matrix @ pm, rest, out)
    return out


def _textures(node):
    """objectcolor: базовая текстура × mix(цвет объекта, 1, alpha) — как шейдер 0 A.D. (USE_OBJECTCOLOR)."""
    tx = node.textures
    base = tx.get('baseTex')
    if not base or 'objectcolor' not in node.material:
        return tx
    col = node.color or (150, 120, 80)
    key = f'@oc|{base}|{col[0]},{col[1]},{col[2]}'
    if key not in assets.GENERATED:
        def gen(base=base, col=col):
            a = assets.texture(base)
            if a is None:
                return None
            f = a[..., 3:4].astype(np.float32) / 255.0
            c = np.array(col, np.float32)[None, None] / 255.0
            rgb = a[..., :3].astype(np.float32) * (c * (1 - f) + f)
            out = np.empty_like(a)
            out[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
            out[..., 3] = 255
            return out
        assets.GENERATED[key] = gen
    return dict(tx, baseTex=key)
