// Процедурные клипы поверх UAL: node anims2.mjs in.glb out.glb
// База — существующий клип (ноги/корпус), руки ставятся 2-звенной IK к целям в пространстве персонажа,
// плюс аддитивные наклоны корпуса/головы. Все клипы зациклены по длительности базы.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup } from '@gltf-transform/functions';
import { quat, vec3, mat4 } from 'gl-matrix';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const [,, inP, outP] = process.argv;
const doc = await io.read(inP); const root = doc.getRoot(); const buf = root.listBuffers()[0];
const nodes = root.listNodes(); const byName = Object.fromEntries(nodes.map(n => [n.getName(), n]));
const order = []; { const seen = new Set(); const visit = (n) => { if (seen.has(n)) return; const p = n.getParentNode(); if (p) visit(p); seen.add(n); order.push(n); }; nodes.forEach(visit); }
const clipByName = (nm) => root.listAnimations().find(a => a.getName() === nm);
// удалить прошлые процедурные версии (перезапуск)
const PROC = ['Wave_Loop', 'Laugh_Loop', 'Cry_Loop', 'Read_Loop', 'Exercise_Loop', 'Shower_Loop', 'Sit_Eat_Loop', 'Sit_Read_Loop'];
for (const a of root.listAnimations()) if (PROC.includes(a.getName())) { a.listChannels().forEach(c => c.dispose()); a.listSamplers().forEach(s => s.dispose()); a.dispose(); }

function sampler(s, t) {
  const inp = s.getInput().getArray(), out = s.getOutput().getArray(), w = s.getOutput().getElementSize();
  const T = inp[inp.length - 1]; t = Math.min(t, T);
  let i = 0; while (i < inp.length - 2 && inp[i + 1] < t) i++;
  const t0 = inp[i], t1 = inp[Math.min(i + 1, inp.length - 1)]; const f = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
  const a = out.slice(i * w, i * w + w), b = out.slice(Math.min(i + 1, inp.length - 1) * w, Math.min(i + 1, inp.length - 1) * w + w);
  if (w === 4) { const q = quat.create(); quat.slerp(q, a, b, f); return q; }
  return a.map((v, k) => v + (b[k] - v) * f);
}
function pose(anim, t) { // local TRS per node + world matrices
  const L = new Map(); for (const n of nodes) L.set(n, { t: [...n.getTranslation()], r: [...n.getRotation()], s: [...n.getScale()] });
  for (const c of anim.listChannels()) { const n = c.getTargetNode(), p = c.getTargetPath(); const v = sampler(c.getSampler(), t); L.get(n)[p === 'translation' ? 't' : p === 'rotation' ? 'r' : 's'] = [...v]; }
  return L;
}
function fk(L) {
  const W = new Map();
  for (const n of order) { const l = L.get(n); const m = mat4.fromRotationTranslationScale(mat4.create(), l.r, l.t, l.s); const p = n.getParentNode(); W.set(n, p && W.has(p) ? mat4.multiply(mat4.create(), W.get(p), m) : m); }
  return W;
}
const posOf = (W, nm) => mat4.getTranslation(vec3.create(), W.get(byName[nm]));
const rotOf = (W, nm) => { const m = W.get(byName[nm]); const s = mat4.getScaling(vec3.create(), m); const r = mat4.create(); for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) r[i * 4 + k] = m[i * 4 + k] / s[i]; return quat.normalize(quat.create(), mat4.getRotation(quat.create(), r)); };
const between = (a, b) => { const q = quat.create(); quat.rotationTo(q, vec3.normalize(vec3.create(), a), vec3.normalize(vec3.create(), b)); return q; };
function setWorldRot(L, W, nm, q) { // локальный = parent^-1 * q
  const n = byName[nm]; const pq = rotOf(W, n.getParentNode().getName()); const inv = quat.invert(quat.create(), pq);
  L.get(n).r = [...quat.normalize(quat.create(), quat.multiply(quat.create(), inv, q))];
}
function ik(L, side, target, pole) {
  let W = fk(L);
  const S = posOf(W, 'upperarm_' + side), E = posOf(W, 'lowerarm_' + side), H = posOf(W, 'hand_' + side);
  const l1 = vec3.distance(S, E), l2 = vec3.distance(E, H);
  const dvec = vec3.sub(vec3.create(), target, S); let d = vec3.length(dvec); d = Math.min(d, (l1 + l2) * 0.999); const dir = vec3.normalize(vec3.create(), dvec);
  const Tg = vec3.scaleAndAdd(vec3.create(), S, dir, d);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const p = vec3.scaleAndAdd(vec3.create(), pole, dir, -vec3.dot(pole, dir)); vec3.normalize(p, p);
  const E2 = vec3.add(vec3.create(), vec3.scaleAndAdd(vec3.create(), S, dir, a), vec3.scale(vec3.create(), p, h));
  const q1 = between(vec3.sub(vec3.create(), E, S), vec3.sub(vec3.create(), E2, S));
  setWorldRot(L, W, 'upperarm_' + side, quat.multiply(quat.create(), q1, rotOf(W, 'upperarm_' + side)));
  W = fk(L);
  const E3 = posOf(W, 'lowerarm_' + side), H3 = posOf(W, 'hand_' + side);
  const q2 = between(vec3.sub(vec3.create(), H3, E3), vec3.sub(vec3.create(), Tg, E3));
  setWorldRot(L, W, 'lowerarm_' + side, quat.multiply(quat.create(), q2, rotOf(W, 'lowerarm_' + side)));
}
function tilt(L, nm, axis, deg) { const W = fk(L); const q = quat.setAxisAngle(quat.create(), axis, deg * Math.PI / 180); setWorldRot(L, W, nm, quat.multiply(quat.create(), q, rotOf(W, nm))); }

// оси персонажа: лицо +Z, «лево» — сторона hand_l
const W0 = fk(pose(clipByName('Idle_Loop'), 0));
const LEFT = Math.sign(posOf(W0, 'hand_l')[0]) || 1; // +1 если левая рука в +X
const side = (s) => (s === 'l' ? LEFT : -LEFT);
const X = [1, 0, 0], Z = [0, 0, 1];
const add = (...v) => v.reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]);

function make(name, baseName, fn, { fps = 30, bones }) {
  const base = clipByName(baseName); if (!base) throw new Error('no base ' + baseName);
  let T = 0; for (const s of base.listSamplers()) T = Math.max(T, s.getInput().getMax([])[0]);
  const N = Math.round(T * fps); const times = new Float32Array(N + 1);
  const outs = new Map(bones.map(b => [b, { r: new Float32Array((N + 1) * 4), t: new Float32Array((N + 1) * 3) }]));
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * T; times[i] = t; const L = pose(base, t); fn(L, t / T, t);
    for (const b of bones) { const l = L.get(byName[b]); outs.get(b).r.set(l.r, i * 4); outs.get(b).t.set(l.t, i * 3); }
  }
  const a = doc.createAnimation(name); const inAcc = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buf);
  const own = new Set(bones.map(b => byName[b]));
  for (const c of base.listChannels()) { // остальные каналы — общие аксессоры базы
    if (own.has(c.getTargetNode()) && (c.getTargetPath() === 'rotation' || (c.getTargetPath() === 'translation' && c.getTargetNode().getName() === 'pelvis'))) continue;
    const s = c.getSampler(); const ns = doc.createAnimationSampler().setInput(s.getInput()).setOutput(s.getOutput()).setInterpolation(s.getInterpolation());
    a.addSampler(ns).addChannel(doc.createAnimationChannel().setTargetNode(c.getTargetNode()).setTargetPath(c.getTargetPath()).setSampler(ns));
  }
  for (const b of bones) {
    const s = doc.createAnimationSampler().setInput(inAcc).setOutput(doc.createAccessor().setType('VEC4').setArray(outs.get(b).r).setBuffer(buf)).setInterpolation('LINEAR');
    a.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(byName[b]).setTargetPath('rotation').setSampler(s));
    if (b === 'pelvis') { const s2 = doc.createAnimationSampler().setInput(inAcc).setOutput(doc.createAccessor().setType('VEC3').setArray(outs.get(b).t).setBuffer(buf)).setInterpolation('LINEAR');
      a.addSampler(s2).addChannel(doc.createAnimationChannel().setTargetNode(byName[b]).setTargetPath('translation').setSampler(s2)); }
  }
  console.log('clip', name, 'base', baseName, T.toFixed(2) + 's');
}
const ARM = (s) => ['upperarm_' + s, 'lowerarm_' + s];
const TAU = Math.PI * 2;
const sh = (L, s) => posOf(fk(L), 'upperarm_' + s);
const headP = (L) => posOf(fk(L), 'Head');

// Помахать: правая рука вверх-вбок, кисть качается
make('Wave_Loop', 'Idle_Loop', (L, u) => {
  const S = sh(L, 'r'); const sw = Math.sin(u * TAU * 4) * 0.12;
  ik(L, 'r', add(S, [side('r') * (0.22 + sw), 0.42, 0.12]), [side('r'), -1, -0.2]);
}, { bones: ARM('r') });
// Смех: руки к животу, корпус откидывается и трясётся
make('Laugh_Loop', 'Idle_Loop', (L, u) => {
  const b = Math.sin(u * TAU * 8);
  tilt(L, 'spine_02', X, -8 + b * 4); tilt(L, 'Head', X, -12 + b * 3);
  const P = posOf(fk(L), 'spine_01');
  for (const s of ['l', 'r']) ik(L, s, add(P, [side(s) * 0.1, 0.02, 0.2]), [side(s), -0.5, -1]);
}, { bones: ['spine_02', 'Head', ...ARM('l'), ...ARM('r')] });
// Плач: сутулится (база Zombie_Idle_Loop), ладони к лицу, всхлипы
make('Cry_Loop', 'Zombie_Idle_Loop', (L, u) => {
  const b = Math.sin(u * TAU * 3); tilt(L, 'spine_03', X, 4 + b * 3); tilt(L, 'Head', X, 18);
  const H = headP(L);
  for (const s of ['l', 'r']) ik(L, s, add(H, [side(s) * 0.05, 0.02 + b * 0.01, 0.13]), [side(s) * 0.6, -1, 0]);
}, { bones: ['spine_03', 'Head', ...ARM('l'), ...ARM('r')] });
// Чтение стоя: книга перед грудью, голова опущена
make('Read_Loop', 'Idle_Loop', (L, u) => {
  tilt(L, 'Head', X, 22 + Math.sin(u * TAU * 2) * 2);
  const C = posOf(fk(L), 'spine_03');
  for (const s of ['l', 'r']) ik(L, s, add(C, [side(s) * 0.11, -0.12, 0.32]), [side(s), -1, 0]);
}, { bones: ['Head', ...ARM('l'), ...ARM('r')] });
// Чтение сидя
make('Sit_Read_Loop', 'Sitting_Idle_Loop', (L, u) => {
  tilt(L, 'Head', X, 24);
  const C = posOf(fk(L), 'spine_03');
  for (const s of ['l', 'r']) ik(L, s, add(C, [side(s) * 0.11, -0.15, 0.3]), [side(s), -1, 0]);
}, { bones: ['Head', ...ARM('l'), ...ARM('r')] });
// Прыжки «звёздочкой»
make('Exercise_Loop', 'Idle_Loop', (L, u) => {
  const k = (1 - Math.cos(u * TAU * 3)) / 2; // 3 прыжка за цикл базы
  const pl = L.get(byName.pelvis); pl.t = [pl.t[0], pl.t[1] + Math.sin(k * Math.PI) * 0.06, pl.t[2]];
  tilt(L, 'thigh_l', Z, LEFT * 12 * k); tilt(L, 'thigh_r', Z, -LEFT * 12 * k);
  for (const s of ['l', 'r']) { const S = sh(L, s); ik(L, s, add(S, [side(s) * (0.3 - 0.12 * k), -0.5 + 1.05 * k, 0.05]), [side(s), -0.3, -1]); }
}, { bones: ['pelvis', 'thigh_l', 'thigh_r', ...ARM('l'), ...ARM('r')] });
// Душ: трёт голову двумя руками
make('Shower_Loop', 'Idle_Loop', (L, u) => {
  const H = headP(L);
  for (const s of ['l', 'r']) { const ph = u * TAU * 4 + (s === 'l' ? 0 : Math.PI);
    ik(L, s, add(H, [side(s) * (0.1 + Math.cos(ph) * 0.03), 0.12 + Math.sin(ph) * 0.04, 0.02]), [side(s), -0.2, -0.3]); }
  tilt(L, 'Head', X, -8);
}, { bones: ['Head', ...ARM('l'), ...ARM('r')] });
// Еда сидя: правая рука «тарелка → рот», левая на столе
make('Sit_Eat_Loop', 'Sitting_Idle_Loop', (L, u) => {
  const C = posOf(fk(L), 'spine_03'); const H = headP(L);
  const k = Math.max(0, Math.sin(u * TAU * 2)) ** 0.7; // 2 ложки за цикл
  const plate = add(C, [side('r') * 0.12, -0.3, 0.38]), mouth = add(H, [side('r') * 0.03, -0.09, 0.1]);
  ik(L, 'r', plate.map((v, i) => v + (mouth[i] - v) * k), [side('r'), -1, -0.3]);
  ik(L, 'l', add(C, [side('l') * 0.2, -0.32, 0.36]), [side('l'), -1, 0]);
  tilt(L, 'Head', X, 10 - k * 8);
}, { bones: ['Head', ...ARM('l'), ...ARM('r')] });

for (const acc of root.listAccessors()) if (acc.listParents().every(p => p.propertyType === 'Root')) acc.dispose();
await doc.transform(prune({ keepLeaves: true }), dedup());
await io.write(outP, doc);
console.log('ok', root.listAnimations().length, 'clips');
