"""Saving and loading a match (F10 -> "Save" / "Load", "Single Player" -> "Load Game").

The file format `~/.cache/khroniki/saves/<slot>.sav` - two consecutively written pickles:
  1) a header (dict): name, date, civ, time, map, players, version - readable without loading the world
     (the list of slots);
  2) the body: {'world': World, 'random': the random state, 'serial': Node.serial, 'ui': {camera, speed...}}.
Next to it lies a thumbnail `<slot>.png` (a screenshot at the moment of saving).

The world is a graph of objects (units <-> buildings <-> players <-> AI <-> world); pickle saves it entirely with all
the cross references. The static tables (UNITS, BUILDINGS, TECHS, CIVS...) that objects refer to
(u.d, a player's effects, content functions) are not written to the file: they are replaced by an "address" in a table
(persistent_id) and taken from the current tables on load. pygame surfaces and modules are not saved
(replaced by None) - the drawing caches rebuild themselves.
"""
import io
import os
import pickle
import random
import time
import types

from . import data

SAVE_DIR = os.path.join(os.environ.get('KHRONIKI_HOME') or os.path.join(os.path.expanduser('~'), '.cache', 'khroniki'),
                        'saves')
VERSION = 1
AUTOSAVE = 'autosave'

_REG = None          # id(table object) -> address
_KEEP = []           # the objects themselves (so that ids are not reused)


def _tables():
    names = ('UNITS', 'BUILDINGS', 'TECHS', 'CIVS', 'NODE_DEFS', 'ANIMALS', 'WORLD_HOOKS', 'AGE_REQ',
             'START_RES', 'RES_NAME', 'RES_COLOR', 'BUILDING_ARMOR')
    return {n: getattr(data, n) for n in names if hasattr(data, n)}


def _registry():
    """All dicts/lists/functions inside the static data.py tables - with an address (table name, keys...)."""
    global _REG
    if _REG is not None:
        return _REG
    reg = {}
    keep = []

    def walk(obj, path, depth):
        if depth > 7:
            return
        if isinstance(obj, (dict, list, tuple, set, frozenset)) or callable(obj):
            if id(obj) in reg:
                return
            if not isinstance(obj, tuple) or depth > 0:
                reg[id(obj)] = path
                keep.append(obj)
        if isinstance(obj, dict):
            for k, v in obj.items():
                if isinstance(k, (str, int, tuple)):
                    walk(v, path + (('k', k),), depth + 1)
        elif isinstance(obj, (list, tuple)):
            for i, v in enumerate(obj):
                walk(v, path + (('i', i),), depth + 1)

    for n, t in _tables().items():
        walk(t, (n,), 0)
    _REG = reg
    _KEEP[:] = keep
    return reg


def _resolve(path):
    obj = _tables()[path[0]]
    for how, k in path[1:]:
        obj = obj[k]
    return obj


class _Pickler(pickle.Pickler):
    def persistent_id(self, obj):
        if isinstance(obj, (str, int, float, bool)) or obj is None:
            return None
        p = _registry().get(id(obj))
        if p is not None:
            return ('T', p)
        mod = type(obj).__module__ or ''
        if mod.startswith('pygame'):
            return ('N',)           # surfaces, fonts, sounds - not saved
        if isinstance(obj, types.ModuleType):
            return ('M', obj.__name__)
        if isinstance(obj, types.FunctionType) and obj.__name__ == '<lambda>':
            return ('N',)
        return None


class _Unpickler(pickle.Unpickler):
    def persistent_load(self, pid):
        if pid[0] == 'T':
            return _resolve(pid[1])
        if pid[0] == 'M':
            import importlib
            return importlib.import_module(pid[1])
        return None


def dumps(obj):
    buf = io.BytesIO()
    _Pickler(buf, protocol=pickle.HIGHEST_PROTOCOL).dump(obj)
    return buf.getvalue()


def loads(b):
    return _Unpickler(io.BytesIO(b)).load()


# ============================================================ slots
def slot_path(slot, ext='.sav'):
    safe = ''.join(c if c.isalnum() or c in '-_' else '_' for c in str(slot))[:40] or 'save'
    return os.path.join(SAVE_DIR, safe + ext)


def meta_of(world, name):
    from .civ_ui import civ_name
    p = world.players[world.human]
    return {'name': name, 'date': time.strftime('%Y-%m-%d %H:%M'), 'stamp': time.time(),
            'civ': p.civ, 'civ_name': civ_name(p.civ), 'time': world.time, 'map': world.map_type,
            'players': len(world.players), 'size': world.W, 'version': VERSION}


def save_world(world, slot, name=None, ui=None, thumb=None):
    """Write a match to a slot. ui - a dict of the interface state (camera, speed...);
    thumb - a pygame.Surface for the thumbnail. Returns the file path."""
    from .world import Node
    os.makedirs(SAVE_DIR, exist_ok=True)
    body = {'world': world, 'random': random.getstate(), 'serial': Node.serial, 'ui': ui or {}}
    blob = dumps(body)
    path = slot_path(slot)
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f:
        pickle.dump(meta_of(world, name or str(slot)), f, protocol=pickle.HIGHEST_PROTOCOL)
        f.write(blob)
    os.replace(tmp, path)
    if thumb is not None:
        try:
            import pygame
            sm = pygame.transform.smoothscale(thumb, (240, 150))
            pygame.image.save(sm, slot_path(slot, '.png'))
        except Exception:
            pass
    return path


def load_world(slot):
    """(world, ui dict, header). Also restores the random state."""
    from .world import Node
    with open(slot_path(slot), 'rb') as f:
        meta = pickle.load(f)
        body = _Unpickler(f).load()
    random.setstate(body['random'])
    Node.serial = max(Node.serial, body.get('serial', 0))
    w = body['world']
    return w, body.get('ui', {}), meta


def list_slots():
    """[(slot, header, thumbnail path or None)] - newest on top."""
    out = []
    try:
        names = os.listdir(SAVE_DIR)
    except OSError:
        return out
    for fn in names:
        if not fn.endswith('.sav'):
            continue
        slot = fn[:-4]
        try:
            with open(os.path.join(SAVE_DIR, fn), 'rb') as f:
                meta = pickle.load(f)
        except Exception:
            continue
        th = slot_path(slot, '.png')
        out.append((slot, meta, th if os.path.exists(th) else None))
    out.sort(key=lambda s: -s[1].get('stamp', 0))
    return out


def delete_slot(slot):
    for ext in ('.sav', '.png'):
        try:
            os.remove(slot_path(slot, ext))
        except OSError:
            pass


def new_slot_name():
    return time.strftime('save_%Y%m%d_%H%M%S')
