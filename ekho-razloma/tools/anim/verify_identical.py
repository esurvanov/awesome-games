"""Byte-level check that every clip NOT in the re-posed list is unchanged between two anim packs (.js pack or .glb):
same channels (node name, path), same sampler times + values bytes, same extras, same meta entry.
python3 verify_identical.py <old pack> <new pack>   (stdlib only)"""
import sys, json, struct, re, base64

def read(path):
    b = open(path, 'rb').read()
    if b[:4] != b'glTF':
        m = re.search(rb"= '([^']+)'", b); b = base64.b64decode(m.group(1))
    l = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + l]); o = 20 + l
    bl = struct.unpack('<I', b[o:o + 4])[0]; return j, b[o + 8:o + 8 + bl]

def acc_bytes(j, b, i):
    a = j['accessors'][i]; v = j['bufferViews'][a['bufferView']]; off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']] * 4 * a['count']; return (a['type'], a['count'], b[off:off + n])

def clip_sig(j, b, an):
    names = [n['name'] for n in j['nodes']]; ch = []
    for c in an['channels']:
        s = an['samplers'][c['sampler']]
        ch.append((names[c['target']['node']], c['target']['path'], s.get('interpolation'), acc_bytes(j, b, s['input']), acc_bytes(j, b, s['output'])))
    return (json.dumps(an.get('extras'), sort_keys=True), ch)

jo, bo = read(sys.argv[1]); jn, bn = read(sys.argv[2])
assert [n['name'] for n in jo['nodes']] == [n['name'] for n in jn['nodes']], 'node list differs'
assert [json.dumps({k: v for k, v in n.items() if k != 'children'}, sort_keys=True) for n in jo['nodes']] == [json.dumps({k: v for k, v in n.items() if k != 'children'}, sort_keys=True) for n in jn['nodes']], 'node transforms differ'
mo = jo['extras']['animlib']['clips']; mn = jn['extras']['animlib']['clips']
oa = {a['name']: a for a in jo['animations']}; na = {a['name']: a for a in jn['animations']}
assert list(oa) == list(na), 'clip list / order differs'
changed, same = [], 0
for n in oa:
    a = clip_sig(jo, bo, oa[n]) == clip_sig(jn, bn, na[n]); m = json.dumps(mo[n], sort_keys=True) == json.dumps(mn[n], sort_keys=True)
    if a and m: same += 1
    else: changed.append((n, 'tracks' if not a else '', 'meta' if not m else ''))
print('identical clips: %d of %d' % (same, len(oa)))
for c in changed: print('  changed', *c)
other_o = {k: v for k, v in jo['extras']['animlib'].items() if k != 'clips'}; other_n = {k: v for k, v in jn['extras']['animlib'].items() if k != 'clips'}
print('meta outside clips changed:', sorted(k for k in set(other_o) | set(other_n) if json.dumps(other_o.get(k), sort_keys=True) != json.dumps(other_n.get(k), sort_keys=True)))
