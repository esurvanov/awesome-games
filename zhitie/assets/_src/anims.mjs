// Build assets/anims/ual_anims.glb: UAL1+UAL2 skeleton + selected clips (+ derived clips), no mesh.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, prune, dedup, resample } from '@gltf-transform/functions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const [,, out] = process.argv;
const K1 = ['Idle_Loop','Walk_Loop','Walk_Formal_Loop','Jog_Fwd_Loop','Sprint_Loop','Sitting_Enter','Sitting_Idle_Loop','Sitting_Talking_Loop','Sitting_Exit','Idle_Talking_Loop','Dance_Loop','Interact','PickUp_Table','Fixing_Kneeling','Crouch_Idle_Loop','Hit_Head','Spell_Simple_Idle_Loop'];
const K2 = ['Consume','Yes','Idle_No_Loop','Idle_FoldArms_Loop','Idle_TalkingPhone_Loop','LayToIdle','Idle_Lantern_Loop','Walk_Carry_Loop','Farm_Watering','Idle_Rail_Call','Chest_Open','Zombie_Idle_Loop'];
const kill = (a) => { a.listChannels().forEach(c => c.dispose()); a.listSamplers().forEach(x => x.dispose()); a.dispose(); };
const doc = await io.read('rig/UAL1.glb'); const root = doc.getRoot();
for (const n of root.listNodes()) if (n.getMesh()) { n.getMesh().dispose(); n.setMesh(null); n.setSkin(null); }
for (const a of root.listAnimations()) if (!K1.includes(a.getName())) kill(a);
const d2 = await io.read('rig/UAL2.glb');
for (const a of d2.getRoot().listAnimations()) if (!K2.includes(a.getName())) kill(a);
const m2 = mergeDocuments(doc, d2); const ualNodes = new Set(d2.getRoot().listNodes().map(n => m2.get(n)));
const target = {}; for (const n of root.listNodes()) if (!ualNodes.has(n)) target[n.getName()] = n;
for (const a of d2.getRoot().listAnimations().map(x => m2.get(x))) for (const c of a.listChannels()) { const t = c.getTargetNode(); if (t && ualNodes.has(t)) { const nt = target[t.getName()]; nt ? c.setTargetNode(nt) : c.dispose(); } }
for (const s of root.listScenes().slice(1)) { s.listChildren().forEach(c => c.dispose()); s.dispose(); }
for (const n of ualNodes) n?.dispose();
for (const s of root.listSkins()) s.dispose();
const buf = root.listBuffers()[0];
// derived clips from LayToIdle
const lay = root.listAnimations().find(a => a.getName() === 'LayToIdle');
function derive(name, fn) {
  const a = doc.createAnimation(name);
  for (const c of lay.listChannels()) {
    const s = c.getSampler(); const inp = s.getInput().getArray(); const outp = s.getOutput().getArray(); const w = s.getOutput().getElementSize();
    const [ni, no] = fn(inp, outp, w);
    const smp = doc.createAnimationSampler().setInput(doc.createAccessor().setType('SCALAR').setArray(ni).setBuffer(buf)).setOutput(doc.createAccessor().setType(s.getOutput().getType()).setArray(no).setBuffer(buf)).setInterpolation(s.getInterpolation());
    a.addSampler(smp).addChannel(doc.createAnimationChannel().setTargetNode(c.getTargetNode()).setTargetPath(c.getTargetPath()).setSampler(smp));
  }
}
// Lie_Idle_Loop: hold first frame of LayToIdle for 2 s
derive('Lie_Idle_Loop', (inp, outp, w) => [new Float32Array([0, 2]), new Float32Array([...outp.slice(0, w), ...outp.slice(0, w)])]);
// Lie_Down: LayToIdle reversed in time
derive('Lie_Down', (inp, outp, w) => { const n = inp.length, T = inp[n - 1]; const ni = new Float32Array(n), no = new Float32Array(outp.length); for (let i = 0; i < n; i++) { ni[i] = T - inp[n - 1 - i]; no.set(outp.slice((n - 1 - i) * w, (n - i) * w), i * w); } return [ni, no]; });
// drop channels that never leave the node's rest value (saves ~half the size, pose unchanged)
let dropped = 0;
for (const a of root.listAnimations()) for (const c of a.listChannels()) {
  const n = c.getTargetNode(), path = c.getTargetPath(); const o = c.getSampler().getOutput().getArray(); const w = c.getSampler().getOutput().getElementSize();
  const rest = path === 'rotation' ? n.getRotation() : path === 'translation' ? n.getTranslation() : n.getScale();
  let same = true; for (let i = 0; i < o.length && same; i += w) for (let k = 0; k < w; k++) if (Math.abs(o[i + k] - rest[k]) > 2e-4 && !(path === 'rotation' && Math.abs(o[i + k] + rest[k]) < 2e-4 && Math.abs(o[i] + rest[0]) < 2e-4)) { same = false; break; }
  if (same) { c.getSampler().dispose(); c.dispose(); dropped++; }
}
console.log('dropped static channels', dropped);
const b0 = root.listBuffers()[0]; for (const acc of root.listAccessors()) acc.setBuffer(b0); root.listBuffers().slice(1).forEach(b => b.dispose());
await doc.transform(resample({ tolerance: 1e-4 }), prune({ keepLeaves: true }), dedup());
{ let k = 0; for (const a of root.listAccessors()) { const ps = a.listParents(); if (ps.every(p => p.propertyType === "Root")) { a.dispose(); k++; } } console.log("orphans", k, [...new Set(root.listAccessors()[0].listParents().map(p=>p.propertyType))]); }
await io.write(out, doc);
console.log('ok', root.listAnimations().map(a => a.getName()).join(' '));
