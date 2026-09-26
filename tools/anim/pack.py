"""GLB + meta.json -> assets pack JS (same format as assets/pack/*.js). Meta is embedded in the glTF root `extras.animlib`
(three: gltf.parser.json.extras.animlib) so one script tag carries clips + contact/gait metadata.
python3 pack.py <in.glb> <meta.json> <out.js> <pack name>"""
import sys, json, struct, base64
glb, metap, outp, name = sys.argv[1:5]
b = open(glb, 'rb').read(); l = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + l]); rest = b[20 + l:]
j.setdefault('extras', {})['animlib'] = json.load(open(metap))
js = json.dumps(j, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + len(rest)) + struct.pack('<II', len(js), 0x4E4F534A) + js + rest
open(outp, 'w').write("(window.__PACK = window.__PACK || {})['%s'] = '%s';\n" % (name, base64.b64encode(out).decode()))
print(outp, len(out), 'bytes glb')
