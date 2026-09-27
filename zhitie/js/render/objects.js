// Предметы участка: glb из манифеста (кэш + клон + нормализация) или процедурная заглушка.
// Сверка с state.objects каждый кадр (дёшево) — события object:* лишь ускоряют реакцию.
// st.dirty (0..100) → бурый оттенок, st.broken → дымок, st.inUse у ТВ/компьютера → экран светится.
import * as THREE from 'three';
import { byId, kindOf } from '../../data/catalog.js';
import { buildProp, MAT, SURFACE_H } from './props.js';
import { waterTick } from './props2.js';
import { loadGLTF, instantiate, manifest } from './assets.js';
import { wallEdgeOf, LEVEL_H, WALL_T } from './lot.js';
import { ctex, clamp, damp } from './util.js';
import { MAX_LAMPS } from './env.js';

const DIRT = new THREE.Color('#7a5a32');
const WALL_OBJ_Z = { door: -0.5, window: -0.5, painting: -0.5 + WALL_T / 2 + 0.03, mirror: -0.5 + WALL_T / 2 + 0.03 };

const LED_GEO = new THREE.SphereGeometry(0.022, 8, 6);
const CHAR = new THREE.Color('#1c1612');
function babyMesh() {
  const g = new THREE.Group(); g.name = 'baby';
  const bundle = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.2, 3, 8), new THREE.MeshStandardMaterial({ color: '#9fc4e8', roughness: 0.9 }));
  bundle.rotation.set(Math.PI / 2, 0, 0.3); bundle.position.set(0.03, 0.58, 0.02);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshStandardMaterial({ color: '#f1c7a4', roughness: 0.8 }));
  head.position.set(-0.04, 0.6, -0.2);
  g.add(bundle, head); g.traverse(m => { m.castShadow = true; m.raycast = () => {}; }); g.visible = false;
  return g;
}
// Грязная посуда: стопка тарелок; переполненное ведро: мешки
const PLATE_GEO = new THREE.CylinderGeometry(0.13, 0.1, 0.025, 14), PLATE_MAT = new THREE.MeshStandardMaterial({ color: '#e9e4d8', roughness: 0.5 });
const CRUMB_MAT = new THREE.MeshStandardMaterial({ color: '#8a6a3a', roughness: 1 });
function dishes(n, y) {
  const g = new THREE.Group(); g.name = 'dishes';
  for (let i = 0; i < Math.min(4, n); i++) { const p = new THREE.Mesh(PLATE_GEO, PLATE_MAT); p.position.set((i % 2) * 0.22 - 0.1, y + 0.015 + (i > 1 ? 0.03 : 0), (i % 2) * 0.05); g.add(p); const c = new THREE.Mesh(LED_GEO, CRUMB_MAT); c.scale.setScalar(1.6); c.position.set(p.position.x + 0.03, p.position.y + 0.02, p.position.z); g.add(c); }
  g.traverse(m => { m.castShadow = true; m.raycast = () => {}; });
  return g;
}
const PIZZA_GEO = new THREE.BoxGeometry(0.38, 0.05, 0.38), PIZZA_MAT = new THREE.MeshStandardMaterial({ color: '#e6d3a8', roughness: 0.9 });
const BAG_GEO = new THREE.SphereGeometry(0.16, 8, 6), BAG_MAT = new THREE.MeshStandardMaterial({ color: '#2f3336', roughness: 0.4 });
function trashPile(n = 3) {
  const g = new THREE.Group(); g.name = 'trash';
  for (let i = 0; i < n; i++) { const m = new THREE.Mesh(BAG_GEO, BAG_MAT); m.position.set(Math.sin(i * 2.4) * 0.22, 0.12 + (i > 2 ? 0.18 : 0), Math.cos(i * 2.4) * 0.22); m.scale.set(1, 0.8, 1); m.castShadow = true; m.raycast = () => {}; g.add(m); }
  return g;
}

let flameM = null;
const flameMat = () => flameM ||= new THREE.SpriteMaterial({ map: ctex(32, 64, (x, w, h) => { const g = x.createRadialGradient(16, 46, 1, 16, 40, 30); g.addColorStop(0, 'rgba(255,245,200,1)'); g.addColorStop(0.35, 'rgba(255,170,50,.9)'); g.addColorStop(1, 'rgba(220,40,0,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h); }, false), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
let sprayM = null;
const sprayMat = () => sprayM ||= new THREE.SpriteMaterial({ map: smokeTex ||= ctex(64, 64, (x) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); }, false), color: 0xcfeeff, transparent: true, depthWrite: false, opacity: 0.8 });
let smokeTex = null;
const smokeMat = () => new THREE.SpriteMaterial({
  map: smokeTex ||= ctex(64, 64, (x) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); }, false),
  color: 0x55585c, transparent: true, depthWrite: false, opacity: 0.6,
});

// Процедурная или glb-визуализация предмета (группа в локальных осях предмета)
export function makeVisual(defId, onModel) {
  const def = byId[defId] || { id: defId, fp: [1, 1], cat: 'misc' };
  const kind = kindOf(defId), p = buildProp(def);
  // модель: своя по id → модель вида (kind) → процедурная (уже есть)
  let entry = manifest.MODELS?.[defId];
  if (!entry?.url) {
    entry = manifest.MODELS?.[kind];
    const kd = byId[kind];
    // вариант с другим размером следа: вписываем модель вида заново (опорной точке не доверяем)
    if (entry && kd && (kd.fp[0] !== def.fp[0] || kd.fp[1] !== def.fp[1])) entry = { ...entry, scale: undefined };
  }
  if (entry?.url && onModel) {
    loadGLTF(entry.url).then(g => {
      if (!g) return;
      const W = def.fp[0], D = def.fp[1], wallish = def.place === 'wall';
      const m = instantiate(g, entry, { W, D: wallish ? 0.3 : D, maxH: wallish ? 2.4 : 3.5 });
      if (wallish || entry.mount === 'edge') m.position.z = entry.mount === 'wall-back' ? -0.5 + WALL_T / 2 + 0.005 : entry.mount === 'wall-center' ? -0.5 : WALL_OBJ_Z[kind] ?? -0.45;
      if (!entry.mount && (kind === 'painting' || kind === 'mirror')) m.position.y += entry.yOffset == null ? 1.1 : 0;
      if (def.tint && !entry.tint) tintMain(m, def.tint); // у своей модели Ассеты уже перекрасили нужный материал
      onModel(m);
    });
  }
  return p;
}
// Цветовой вариант glb: перекрасить «основной» материал (у меша с наибольшим числом вершин)
function tintMain(model, tint) {
  let best = null, n = -1;
  model.traverse(m => { if (m.isMesh && !Array.isArray(m.material)) { const c = m.geometry.attributes.position.count; if (c > n) { n = c; best = m.material; } } });
  if (!best) return;
  const t = best.clone(); t.color = new THREE.Color(tint);
  model.traverse(m => { if (m.isMesh && m.material === best) m.material = t; });
}

export function createObjects(scene, state, env, hooks = {}) {
  const root = new THREE.Group(); root.name = 'objects'; scene.add(root);
  const recs = new Map();       // id → rec
  const tintCache = new Map();  // uuid материала + ведро грязи → материал
  let level = 0, t = 0;

  const sig = (o) => `${o.def}|${o.x}|${o.y}|${o.rot}|${o.level || 0}`;

  function place(rec, o) {
    const def = byId[o.def] || { fp: [1, 1] }, r = ((o.rot || 0) % 4 + 4) % 4, lv = o.level || 0;
    const W = r & 1 ? def.fp[1] : def.fp[0], D = r & 1 ? def.fp[0] : def.fp[1];
    let y = lv * LEVEL_H;
    if (def.place === 'wall') rec.group.position.set(o.x + 0.5, y, o.y + 0.5);
    else {
      if (def.place === 'surface') { // на стол/стойку под собой
        const under = state.objects.find(u => u !== o && (u.level || 0) === lv && byId[u.def]?.place === 'floor' && covers(u, o.x, o.y));
        y += under ? SURFACE_H[kindOf(under.def)] ?? 0.75 : 0.75;
      }
      rec.group.position.set(o.x + W / 2, y, o.y + D / 2);
    }
    rec.group.rotation.y = r * Math.PI / 2; rec.level = lv;
    // дверь/окно: если стена оказалась с другой стороны тайла — разворачиваем в другое ребро
    if (def.place === 'wall') {
      const e = wallEdgeOf(state.lot, o); rec.edge = e;
      if (e.flip) rec.group.rotation.y += Math.PI;
    } else rec.edge = null;
  }
  const covers = (u, x, y) => {
    const d = byId[u.def], r = (u.rot || 0) & 1, W = r ? d.fp[1] : d.fp[0], D = r ? d.fp[0] : d.fp[1];
    return x >= u.x && x < u.x + W && y >= u.y && y < u.y + D;
  };

  // ── Инстансинг повторяющейся «уличной» мебели: один InstancedMesh на деталь на def ──
  const INST_KINDS = new Set(['tree', 'hedge', 'flowerbed', 'fence', 'park_bench', 'trash_bin_street', 'plant']);
  const insts = new Map(); // def → {src, meshes:[], dirty}
  function instFor(def) {
    let I = insts.get(def);
    if (!I) {
      I = { src: makeVisual(def, (m) => { I.src = m; I.dirty = true; }).group, meshes: [], dirty: true };
      insts.set(def, I);
    }
    return I;
  }
  function rebuildInst(def, I) {
    I.dirty = false;
    I.meshes.forEach(m => { root.remove(m); m.dispose(); }); I.meshes = [];
    const list = [...recs.values()].filter(r => r.inst && r.def === def && r.group.visible);
    if (!list.length) return;
    I.src.updateMatrixWorld(true);
    const parts = []; I.src.traverse(m => { if (m.isMesh && m.visible) parts.push(m); });
    const mw = new THREE.Matrix4();
    for (const part of parts) {
      const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      list.forEach((r, i) => { r.group.updateMatrixWorld(true); im.setMatrixAt(i, mw.multiplyMatrices(r.group.matrixWorld, part.matrixWorld)); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
      im.castShadow = part.castShadow; im.receiveShadow = true; im.userData.ids = list.map(r => r.id);
      root.add(im); I.meshes.push(im);
    }
  }

  function create(o) {
    const group = new THREE.Group(); group.userData.objId = o.id;
    const rec = { id: o.id, def: o.def, kind: kindOf(o.def), group, sig: sig(o), dirty: -1, broken: false, inUse: null, screens: [], light: null, smoke: null, content: null };
    if (INST_KINDS.has(rec.kind)) { // без своего меша: рисует общий InstancedMesh
      rec.inst = true; recs.set(o.id, rec); root.add(group); place(rec, o); instFor(o.def).dirty = true;
      return rec;
    }
    const setContent = (obj, screens = []) => {
      if (rec.content) group.remove(rec.content);
      rec.content = obj; rec.screens = screens; group.add(obj);
      obj.traverse(m => { m.userData.objId = o.id; if (m.isMesh) m.userData.baseMat = m.material; });
      rec.dirty = -1; // перекрасить заново
    };
    const p = makeVisual(o.def, (model) => {
      if (recs.get(o.id) !== rec) return;
      setContent(model, glbSpecials(model, rec));
      if (rec.led) { // светодиод — на лицевую грань glb-коробочки
        model.updateMatrixWorld(true); group.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(model); const inv = group.matrixWorld.clone().invert(); b.applyMatrix4(inv);
        rec.led.position.set(b.max.x - 0.04, (b.min.y + b.max.y) / 2, b.max.z + 0.01);
      }
    });
    setContent(p.group, p.screens);
    rec.light = p.light ? new THREE.Vector3(...p.light) : null;
    if (p.led) { // светодиод датчика/сигнализации — отдельный меш (живёт и поверх glb)
      const led = new THREE.Mesh(LED_GEO, new THREE.MeshBasicMaterial({ color: p.ledColor })); led.position.set(...p.led); led.raycast = () => {};
      led.userData.base = new THREE.Color(p.ledColor); group.add(led); rec.led = led;
    }
    if (p.spray) { // струи фонтана — капли-спрайты по параболе
      rec.spray = Array.from({ length: 14 }, (_, i) => { const sp = new THREE.Sprite(sprayMat()); sp.userData.ph = i / 14; sp.userData.a = i * 2.39; sp.raycast = () => {}; group.add(sp); return sp; });
      rec.sprayAt = new THREE.Vector3(...p.spray);
    }
    if (kindOf(o.def) === 'crib') { rec.baby = babyMesh(); group.add(rec.baby); }
    root.add(group); place(rec, o); recs.set(o.id, rec);
    if (byId[o.def]?.place === 'wall') hooks.onWallObjects?.(o.level || 0);
    if (kindOf(o.def) === 'stairs') hooks.onStairs?.((o.level || 0) + 1);
    return rec;
  }
  // glb: экраны (по имени материала), стекло окон и абажуры — ночное свечение; створка двери 'door'
  const nightClones = new Map();
  function glbSpecials(model, rec) {
    const screens = [];
    model.traverse(m => {
      if (m.name === 'door' && !rec.leaf) rec.leaf = m;
      if (!m.isMesh || Array.isArray(m.material)) return;
      const n = `${m.material.name} ${m.name}`;
      if (/screen|display|monitor/i.test(n)) screens.push(m);
      else if ((rec.kind === 'window' && /glass|pane|window/i.test(n) || /lamp|streetlight|fireplace/.test(rec.kind) && /shade|bulb|lamp|glass/i.test(n)) && !/frame|metal|pole|base/i.test(n)) {
        const k = m.material.uuid;
        if (!nightClones.has(k)) {
          const c = m.material.clone(); c.emissive = new THREE.Color(/shade|bulb|lamp/i.test(n) ? '#ffcf85' : '#ffc070');
          c.userData.glow = /shade|bulb|lamp/i.test(n) ? 1.4 : 0.9; env.nightMats.add(c); nightClones.set(k, c);
        }
        m.material = nightClones.get(k);
      }
    });
    if (rec.leaf) rec.leafRot0 = rec.leaf.rotation.y;
    return screens;
  }

  function remove(rec) {
    if (rec.inst) { const I = insts.get(rec.def); if (I) I.dirty = true; }
    root.remove(rec.group);
    if (rec.smoke) rec.smoke.forEach(s => s.material.dispose());
    recs.delete(rec.id);
    if (rec.edge) hooks.onWallObjects?.(rec.level);
    if (rec.kind === 'stairs') hooks.onStairs?.(rec.level + 1);
  }

  function tintMat(mat, k) {
    const key = mat.uuid + ':' + k;
    if (!tintCache.has(key)) { const n = mat.clone(); n.color = (n.color || new THREE.Color(1, 1, 1)).clone().lerp(DIRT, k * 0.12); tintCache.set(key, n); }
    return tintCache.get(key);
  }
  function burntMat(mat) {
    const key = mat.uuid + ':burnt';
    if (!tintCache.has(key)) { const n = mat.clone(); n.color = (n.color || new THREE.Color(1, 1, 1)).clone().lerp(CHAR, 0.82); n.roughness = 1; tintCache.set(key, n); }
    return tintCache.get(key);
  }
  let hoverId = null;
  function hoverMat(mat) {
    const key = mat.uuid + ':hover';
    if (!tintCache.has(key)) { const n = mat.clone(); n.emissive = new THREE.Color('#59d45a'); n.emissiveIntensity = 0.35; tintCache.set(key, n); }
    return tintCache.get(key);
  }
  function applyState(rec, o) {
    const st = o.st || {};
    const d = clamp(Math.round((st.dirty || 0) / 20), 0, 5); // 6 вёдер 0..100
    const hov = hoverId === o.id, burnt = !!st.burnt;
    if (d !== rec.dirty || hov !== rec.hov || burnt !== rec.burnt) {
      rec.dirty = d; rec.hov = hov; rec.burnt = burnt;
      rec.group.traverse(m => {
        if (!m.isMesh || !m.userData.baseMat) return; const b = m.userData.baseMat;
        if (Array.isArray(b) || b === MAT.glass || b === MAT.glow || b.transparent) { m.material = b; return; }
        m.material = hov ? hoverMat(b) : burnt ? burntMat(b) : d ? tintMat(b, d) : b;
      });
    }
    const broken = !!st.broken;
    if (broken !== rec.broken) {
      rec.broken = broken;
      if (broken) {
        rec.smoke = Array.from({ length: 7 }, (_, i) => { const s = new THREE.Sprite(smokeMat()); s.userData.ph = i / 7; s.raycast = () => {}; rec.group.add(s); return s; });
      } else { rec.smoke?.forEach(s => { rec.group.remove(s); s.material.dispose(); }); rec.smoke = null; }
    }
    if (rec.baby) rec.baby.visible = !!st.baby;
    // грязная посуда (Мозг: st.dishes — число/true) на столах и стойках
    const nd = st.dishes === true ? 1 : +st.dishes || +st.dirtyDishes || 0;
    if (nd !== (rec.nd || 0)) {
      rec.nd = nd; rec.dishes && rec.group.remove(rec.dishes); rec.dishes = null;
      if (nd > 0) { rec.dishes = dishes(nd, SURFACE_H[rec.kind] ?? 0.78); rec.group.add(rec.dishes); }
    }
    // пицца (Мозг: st.pizza — порции) — коробка на столе/стойке
    const pz = +st.pizza || 0;
    if ((pz > 0) !== !!rec.pizza) {
      if (pz > 0) { rec.pizza = new THREE.Mesh(PIZZA_GEO, PIZZA_MAT); rec.pizza.position.set(0.12, (SURFACE_H[rec.kind] ?? 0.78) + 0.03, -0.05); rec.pizza.castShadow = true; rec.pizza.raycast = () => {}; rec.group.add(rec.pizza); }
      else { rec.group.remove(rec.pizza); rec.pizza = null; }
    }
    const full = rec.kind === 'trash_can' && !!(st.full || st.overflow || (st.fill ?? 0) >= 6 || (st.trash ?? 0) >= 100);
    if (full !== !!rec.trash) { if (full) { rec.trash = trashPile(); rec.trash.position.z = 0.35; rec.group.add(rec.trash); } else { rec.group.remove(rec.trash); rec.trash = null; } }
    // камин (Мозг: st.lit) — язычки пламени и свет только когда горит
    if (rec.kind === 'fireplace') {
      const lit = !!st.lit;
      if (lit !== !!rec.fx) {
        if (lit) { rec.fx = Array.from({ length: 5 }, (_, i) => { const sp = new THREE.Sprite(flameMat()); sp.userData.ph = i / 5; sp.raycast = () => {}; rec.group.add(sp); return sp; }); }
        else { rec.fx.forEach(sp => rec.group.remove(sp)); rec.fx = null; }
      }
      rec.lit = lit;
    }
    const on = st.inUse != null;
    if (on !== rec.inUse) { rec.inUse = on; rec.screens.forEach(m => { m.material = on ? MAT.screenOn : MAT.screenOff; m.userData.baseMat = m.material; }); }
  }

  const O = { root, recs };

  O.sync = () => {
    const seen = new Set();
    for (const o of state.objects) {
      seen.add(o.id);
      let rec = recs.get(o.id);
      const s = sig(o);
      if (rec && rec.def !== o.def) { remove(rec); rec = null; }
      if (!rec) rec = create(o);
      else if (rec.sig !== s) {
        const wasWall = !!rec.edge, lv0 = rec.level; rec.sig = s; place(rec, o); if (rec.inst) instFor(rec.def).dirty = true;
        if (wasWall || rec.edge) hooks.onWallObjects?.(o.level || 0);
        if (rec.kind === 'stairs') { hooks.onStairs?.(lv0 + 1); hooks.onStairs?.((o.level || 0) + 1); }
      }
      rec.group.visible = (o.level || 0) <= level && !rec.hiddenByCut && o.id !== hiddenId;
      applyState(rec, o);
    }
    for (const rec of [...recs.values()]) if (!seen.has(rec.id)) remove(rec);
    for (const rec of recs.values()) if (rec.inst && rec.lastVis !== rec.group.visible) { rec.lastVis = rec.group.visible; instFor(rec.def).dirty = true; }
    for (const [def, I] of insts) if (I.dirty) rebuildInst(def, I);
  };

  // Предметы в опущенных стенах (двери/окна/картины) прячем: остаётся проём
  O.applyCutaway = (lot) => {
    for (const [id, rec] of recs) {
      const o = state.objects.find(p => p.id === id);
      rec.hiddenByCut = !!(rec.edge && o && lot.isLowered(o.level || 0, rec.edge));
    }
  };

  O.setLevel = (l) => { level = l; };
  O.setHover = (id) => { hoverId = id ?? null; };
  let hiddenId = null;
  O.setHidden = (id) => { hiddenId = id ?? null; };

  // Лужи: state.lot.puddles = [{x,y,level}] (Мозг) — плоские полупрозрачные пятна
  const puddleMat = new THREE.MeshStandardMaterial({ color: '#7fb7d6', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const puddleGeo = new THREE.CircleGeometry(0.42, 18).rotateX(-Math.PI / 2);
  const puddles = new THREE.Group(); puddles.name = 'puddles'; root.add(puddles);
  let puddleSig = '';
  // Мусор на полу: state.lot.trash = [{x,y,level}] (Мир/Мозг)
  const floorTrash = new THREE.Group(); floorTrash.name = 'floorTrash'; root.add(floorTrash);
  let trashSig = '';
  function syncTrash() {
    const list = state.lot.trash || [], sg = list.map(p => `${p.x},${p.y},${p.level || 0}`).join(';');
    if (sg === trashSig) return; trashSig = sg;
    while (floorTrash.children.length) floorTrash.remove(floorTrash.children[0]);
    list.forEach((p, i) => { const g = trashPile(2 + (i % 2)); g.scale.setScalar(0.7); g.position.set(p.x + 0.5, (p.level || 0) * LEVEL_H, p.y + 0.5); floorTrash.add(g); });
  }
  function syncPuddles() {
    const list = state.lot.puddles || [], sg = list.map(p => `${p.x},${p.y},${p.level || 0}`).join(';');
    if (sg === puddleSig) return; puddleSig = sg;
    while (puddles.children.length) puddles.remove(puddles.children[0]);
    list.forEach((p, i) => {
      const m = new THREE.Mesh(puddleGeo, puddleMat); m.raycast = () => {};
      m.position.set(p.x + 0.5 + Math.sin(i * 7) * 0.1, (p.level || 0) * LEVEL_H + 0.03, p.y + 0.5 + Math.cos(i * 5) * 0.1);
      m.scale.set(1 + (i % 3) * 0.15, 1, 0.8 + (i % 2) * 0.2); m.userData.level = p.level || 0; puddles.add(m);
    });
  }

  // Лампы: пул точечных огней — ближайшие к центру кадра торшеры
  O.update = (dt, focus) => {
    t += dt;
    const lamps = [];
    for (const rec of recs.values()) {
      if (rec.light && rec.group.visible && (rec.kind !== 'fireplace' || rec.lit)) lamps.push(rec);
      if (rec.fx) rec.fx.forEach(sp => { const ph = (t * 1.8 + sp.userData.ph) % 1, k = Math.sin(ph * Math.PI); sp.position.set((sp.userData.ph - 0.4) * 0.3, 0.12 + ph * 0.35, -0.1); sp.scale.set(0.18 * k + 0.05, 0.32 * k + 0.05, 1); });
      if (rec.smoke) rec.smoke.forEach(s => {
        const ph = (t * 0.35 + s.userData.ph) % 1;
        s.position.set(Math.sin(ph * 9 + s.userData.ph * 20) * 0.15, 0.6 + ph * 1.6, Math.cos(ph * 7) * 0.12);
        s.scale.setScalar(0.25 + ph * 0.6); s.material.opacity = 0.55 * Math.sin(ph * Math.PI);
      });
    }
    if (focus) lamps.sort((a, b) => a.group.position.distanceToSquared(focus) - b.group.position.distanceToSquared(focus));
    env.lamps.forEach((l, i) => {
      const rec = lamps[i];
      l.userData.on = !!rec && i < MAX_LAMPS;
      if (rec) l.position.copy(rec.light).applyMatrix4(rec.group.matrixWorld);
    });
    const fire = (state.lot.fires || []).length > 0;
    for (const rec of recs.values()) if (rec.led) {
      const m = rec.led.material;
      if (rec.kind === 'smoke_alarm') m.color.copy(rec.led.userData.base).multiplyScalar(fire ? (Math.sin(t * 20) > 0 ? 1.5 : 0.1) : (t % 1.6 < 0.12 ? 1.4 : 0.15 + 0.2 * (1 - env.lit)));
      else m.color.set(fire ? '#ff2a1a' : '#2aff5a').multiplyScalar(t % 2 < 0.15 ? 1.4 : 0.4);
    }
    syncTrash(); syncPuddles();
    waterTick(t);
    for (const rec of recs.values()) if (rec.spray && rec.group.visible) rec.spray.forEach(sp => {
      const ph = (t * 0.9 + sp.userData.ph) % 1, a = sp.userData.a, r = ph * 0.55;
      sp.position.set(rec.sprayAt.x + Math.cos(a) * r, rec.sprayAt.y + ph * 1.2 - ph * ph * 1.9, rec.sprayAt.z + Math.sin(a) * r);
      sp.scale.setScalar(0.08 + ph * 0.1); sp.material.opacity = 0.7;
    }); puddles.children.forEach(m => { m.visible = m.userData.level <= level; });
    // створка двери (glb-узел 'door') открывается, когда рядом житель
    for (const rec of recs.values()) {
      if (!rec.leaf) continue;
      const p = rec.group.position, near = state.sims.some(s => !s.atWork && (s.level || 0) === rec.level && Math.hypot(s.x - p.x, s.y - p.z) < 1.1);
      rec.leafA = damp(rec.leafA || 0, near ? 1.35 : 0, 6, dt);
      rec.leaf.rotation.y = rec.leafRot0 + rec.leafA;
    }
    MAT.screenOn.emissiveIntensity = 1.1 + Math.sin(t * 13) * 0.12 + Math.sin(t * 3.1) * 0.15;
  };

  // Все видимые меши предметов для пикинга
  O.pickables = () => [...recs.values()].filter(r => r.group.visible && !r.inst).map(r => r.group).concat([...insts.values()].flatMap(I => I.meshes));
  O.stats = () => ({ objects: recs.size, instanced: [...recs.values()].filter(r => r.inst).length, instGroups: insts.size });
  return O;
}
