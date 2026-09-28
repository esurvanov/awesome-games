#!/usr/bin/env node
/* extract_clips.mjs — cut named animation clips (+ the bare node hierarchy they drive) out of a packed model into a small
 * clip-only pack (same format as assets/pack/*.js, meta in gltf extras.animlib — see pack.py). No meshes, skins, textures.
 *
 *   node tools/anim/extract_clips.mjs <in pack.js> <out pack.js> <pack name> <meta.json> Clip1[=newName] Clip2 ...
 *
 * Used for anim_pilot_fall (PHYSBODY.md): UAL1 Standard fall / knock-back / get-up clips of the pilot rig, loaded at
 * runtime without re-parsing the 5.6 MB textured pilot.
 */
import fs from 'node:fs';
import vm from 'node:vm';

const [inp, outp, name, metap, ...want] = process.argv.slice(2);
if (!want.length) { console.error('usage: extract_clips.mjs <in.js> <out.js> <name> <meta.json> Clip[=new] ...'); process.exit(1); }
const sb = { window: {} }; vm.runInNewContext(fs.readFileSync(inp, 'utf8'), sb);
const b64 = Object.values(sb.window.__PACK)[0], glb = Buffer.from(b64, 'base64');
const jl = glb.readUInt32LE(12), j = JSON.parse(glb.subarray(20, 20 + jl).toString()), bin0 = glb.subarray(20 + jl + 8);

const pick = want.map((w) => { const [src, dst] = w.split('='); const a = j.animations.find((x) => x.name === src); if (!a) throw new Error('no clip ' + src); return { a, dst: dst || src }; });
// accessors used by the picked clips → one new tightly packed buffer
const accMap = new Map(), views = [], accs = [], chunks = []; let off = 0;
const useAcc = (i) => {
  if (accMap.has(i)) return accMap.get(i);
  const A = j.accessors[i], V = j.bufferViews[A.bufferView];
  const comp = { 5126: 4, 5123: 2, 5125: 4, 5121: 1 }[A.componentType], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[A.type];
  const bytes = A.count * n * comp, start = (V.byteOffset || 0) + (A.byteOffset || 0);
  if (V.byteStride && V.byteStride !== n * comp) throw new Error('strided accessor');
  chunks.push(bin0.subarray(start, start + bytes)); const pad = (4 - (bytes % 4)) % 4; if (pad) chunks.push(Buffer.alloc(pad));
  views.push({ buffer: 0, byteOffset: off, byteLength: bytes }); off += bytes + pad;
  const na = Object.assign({}, A, { bufferView: views.length - 1 }); delete na.byteOffset; accs.push(na);
  accMap.set(i, accs.length - 1); return accs.length - 1;
};
const animations = pick.map(({ a, dst }) => ({ name: dst, channels: a.channels.map((c) => ({ sampler: c.sampler, target: c.target })),
  samplers: a.samplers.map((s) => ({ input: useAcc(s.input), output: useAcc(s.output), interpolation: s.interpolation })) }));
const nodes = j.nodes.map((n) => { const o = Object.assign({}, n); delete o.mesh; delete o.skin; return o; });
const bin = Buffer.concat(chunks);
const out = { asset: { version: '2.0', generator: 'tools/anim/extract_clips.mjs' }, scene: 0, scenes: j.scenes, nodes, animations, accessors: accs, bufferViews: views, buffers: [{ byteLength: bin.length }],
  extras: { animlib: JSON.parse(fs.readFileSync(metap, 'utf8')) } };
let js = Buffer.from(JSON.stringify(out)); if (js.length % 4) js = Buffer.concat([js, Buffer.alloc(4 - (js.length % 4), 0x20)]);
const total = 12 + 8 + js.length + 8 + bin.length;
const head = Buffer.alloc(12); head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004E4942, 4);
const glbOut = Buffer.concat([head, jh, js, bh, bin]);
fs.writeFileSync(outp, `(window.__PACK = window.__PACK || {})['${name}'] = '${glbOut.toString('base64')}';\n`);
console.log(outp, glbOut.length, 'bytes glb,', animations.map((a) => a.name).join(', '));
