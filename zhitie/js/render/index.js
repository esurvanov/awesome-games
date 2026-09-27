// 🎥 Рендер «Житьё»: публичный API (docs/CONTRACT.md §5).
// three@0.169.0 через importmap. Рендерер/ACES/тени — по образцу russia/index.html :320-329.
import * as THREE from 'three';
import { createCameraRig } from './camera.js';
import { createEnv } from './env.js';
import { createLot, LEVEL_H } from './lot.js';
import { initPropMats, MAT } from './props.js';
import { waterMat } from './props2.js';
import { createObjects } from './objects.js';
import { createSims, previewSim } from './sims.js';
import { createGhosts } from './ghosts.js';
import { createRoof } from './roof.js';
import { createFire } from './fire.js';
import { createHood } from './hood.js';
import { ZOOMS } from './camera.js';
import { loadManifest } from './assets.js';
import { clamp } from './util.js';

const SPEED_MUL = [0, 1, 1.6, 2.4]; // скорость анимаций при скорости игры 0..3

export async function initRender(canvas, state, bus, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, opts.maxDpr || 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const rig = createCameraRig(canvas, state.lot);
  const env = createEnv(renderer, scene, rig.cam, state.lot);
  initPropMats(env);
  if (opts.assets !== false) await loadManifest(); // assets:false — только процедурные модели (проверка фолбэков)

  let lot = createLot(scene, state), lotRef = state.lot;
  let cutDirty = true, roofDirty = true;
  // Мир нужен только для roofFootprints (если есть); без него крыша считается сама
  const world = opts.world || await import('../world/index.js').catch(() => null);
  const objs = createObjects(scene, state, env, {
    onWallObjects: (l) => { lot.rebuild(l); cutDirty = true; roofDirty = true; },
    onStairs: (l) => { if (state.lot.levels[l]) { lot.rebuild(l); cutDirty = true; } },
  });
  const roof = createRoof(scene);
  const fire = createFire(scene, state);
  const hood = createHood(scene, env);
  let view = 'lot', lotCam = null;
  const LOT_ROOTS = ['lot', 'objects', 'sims', 'roof', 'fire', 'ghosts', 'puddles'];
  const setLotVisible = (v) => { for (const n of LOT_ROOTS) { const o = scene.getObjectByName(n); if (o) o.visible = v; } lot.root.visible = v; if (!v) sims.halo.visible = false; };
  const lotView = () => { const L = state.lot; return { bounds: [-3, -3, L.w + 3, L.h + 6], zooms: [...ZOOMS], dist: 80 }; };
  // Мир может заменить state.lot целиком (loadLot) — пересобираем участок под новый объект
  const relot = () => {
    scene.remove(lot.root); lot = createLot(scene, state); lotRef = state.lot;
    lot.setMode(wallMode); lot.setLevel(level); state.lot.levels.forEach((_, i) => { hashes[i] = lot.hash(i); });
    rig.setView(lotView()); env.setShadowArea(state.lot.w / 2, state.lot.h / 2, Math.max(state.lot.w, state.lot.h) * 0.8 + 4);
    cutDirty = true; roofDirty = true;
  };
  const sims = createSims(scene, state);
  const ghosts = createGhosts(scene, state);
  objs.sync(); sims.sync();

  let level = 0, wallMode = 'cutaway', size = [0, 0], hashT = 0;
  const hashes = state.lot.levels.map((_, i) => lot.hash(i));
  lot.setMode(wallMode);

  const resize = () => {
    const w = canvas.clientWidth || canvas.width || 1, h = canvas.clientHeight || canvas.height || 1;
    if (w === size[0] && h === size[1]) return;
    size = [w, h];
    renderer.setSize(w, h, false); rig.resize(w, h);
    if (opts.post !== false) { if (!env.composer) env.setupPost(w, h); else env.resize(w, h); }
  };
  resize();

  // события
  const off = [];
  const on = (type, fn) => { bus.on(type, fn); off.push(() => bus.off(type, fn)); };
  on('lot:changed', (p = {}) => {
    if (p.kind === 'object') { objs.sync(); return; }
    if (p.kind === 'fire' || p.kind === 'puddle' || p.kind === 'trash') return; // сверяются каждый кадр
    if (p.kind === 'roof') { roofDirty = true; return; }
    lot.rebuild(p.level); state.lot.levels.forEach((_, i) => { hashes[i] = lot.hash(i); }); cutDirty = true; roofDirty = true; objs.sync();
  });
  on('object:added', () => objs.sync());
  on('object:removed', () => objs.sync());
  on('object:changed', () => objs.sync());
  on('sim:added', () => sims.sync());
  on('sim:removed', () => sims.sync());
  on('sim:anim', (p) => sims.onAnim(p));
  on('sim:selected', ({ simId }) => sims.select(simId));
  on('hood:lot', () => { hood.invalidate(); if (view === 'hood') R.showHood(); }); // смена активного участка
  on('hood:movein', () => hood.invalidate());
  on('mode:changed', ({ mode }) => { lot.grid.visible = mode === 'buy' || mode === 'build'; });
  lot.grid.visible = state.mode === 'buy' || state.mode === 'build';

  // пикинг
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  const pick = (cx, cy) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    rig.cam.updateMatrixWorld();
    ray.setFromCamera(ndc, rig.cam);
    if (view === 'hood') return hood.pick(ray) || { kind: 'none' };
    plane.constant = -level * LEVEL_H;
    const p = ray.ray.intersectPlane(plane, hit) ? hit.clone() : new THREE.Vector3();
    const x = Math.floor(p.x), y = Math.floor(p.z);
    const fx = p.x - x, fy = p.z - y;
    // ближайшее ребро клетки и ближайшая вершина — для стройки
    const dmin = Math.min(fy, 1 - fy, fx, 1 - fx);
    const edge = dmin === fy ? { dir: 'h', x, y } : dmin === 1 - fy ? { dir: 'h', x, y: y + 1 } : dmin === fx ? { dir: 'v', x, y } : { dir: 'v', x: x + 1, y };
    const base = { x, y, level, wx: p.x, wz: p.z, edge, corner: { x: Math.round(p.x), y: Math.round(p.z) }, inLot: x >= 0 && y >= 0 && x < state.lot.w && y < state.lot.h };
    const sh = ray.intersectObjects(sims.pickables(), false)[0];
    if (sh) return { ...base, kind: 'sim', id: sh.object.userData.simId };
    const oh = ray.intersectObjects(objs.pickables(), true).find(h => h.object.visible !== false);
    const wh = ray.intersectObjects(lot.wallMeshes(), false)[0];
    if (oh && (!wh || oh.distance <= wh.distance + 0.25)) {
      if (oh.object.userData.ids) return { ...base, kind: 'object', id: oh.object.userData.ids[oh.instanceId] }; // инстанс
      let o = oh.object; while (o && o.userData.objId == null) o = o.parent;
      if (o) return { ...base, kind: 'object', id: o.userData.objId };
    }
    if (wh) { const e = lot.edgeOfInstance(wh.object, wh.instanceId); if (e) return { ...base, kind: 'wall', level: e.level, edge: { dir: e.dir, x: e.x, y: e.y } }; }
    return { ...base, kind: 'tile' };
  };

  const _v = new THREE.Vector3();
  const R = {
    renderer, scene, camera: rig.cam, rig,
    frame(dt = 1 / 60) {
      dt = clamp(dt, 0, 0.1);
      resize();
      if (view === 'hood') { // вид района: только камера, свет и картинка
        rig.update(dt); env.lamps.forEach(l => { l.userData.on = false; });
        env.update(((state.time?.minutes ?? 480) / 60)); fire.update(0); env.render(); return;
      }
      if (state.lot !== lotRef) relot();
      hashT += dt;
      if (hashT > 0.5) { // страховка на случай пропущенного lot:changed
        hashT = 0;
        state.lot.levels.forEach((_, i) => { const h = lot.hash(i); if (h !== hashes[i]) { hashes[i] = h; lot.rebuild(i); cutDirty = true; } });
        roofDirty = true; // roof.rebuild сам сверяет ключ — дёшево, если ничего не изменилось
      }
      objs.sync(); sims.sync();
      rig.update(dt);
      if (rig.changed || cutDirty) { rig.changed = false; cutDirty = false; lot.updateCutaway(rig); objs.applyCutaway(lot); objs.sync(); }
      if (roofDirty) { roofDirty = false; roof.rebuild(state, lot, world); }
      roof.update(wallMode, level);
      env.update(((state.time?.minutes ?? 480) / 60));
      objs.update(dt, rig.target);
      fire.update(dt, rig.target);
      const sp = state.mode && state.mode !== 'live' ? 0 : SPEED_MUL[state.time?.speed ?? 1] ?? 1;
      sims.update(dt, sp, env.nightF);
      ghosts.update(dt);
      env.render();
    },
    pick,
    // ➕ Волна 3: вид района сверху и обратно (плавный перелёт камеры)
    showHood(st = state) {
      if (!hood.build(st)) return false;
      if (view === 'lot') lotCam = { x: rig.goal.x, z: rig.goal.z, zoom: rig.zoomIndex };
      view = 'hood'; setLotVisible(false); hood.root.visible = true; fire.setLevel(-1);
      const e = hood.ext;
      rig.setView({ bounds: hood.bounds, zooms: [e * 0.75, e * 0.45, e * 0.25], dist: e * 1.6 });
      rig.zoomIndex = 0; rig.viewHGoal = rig.zooms[0]; rig.levelY = 0;
      rig.focus(hood.center[0], hood.center[1]);
      env.setShadowArea(hood.center[0], hood.center[1], e * 0.6);
      scene.fog.near = e * 2; scene.fog.far = e * 4;
      return true;
    },
    showLot() {
      if (view === 'lot') return;
      view = 'lot'; hood.root.visible = false; setLotVisible(true); fire.setLevel(level);
      if (state.lot !== lotRef) relot();
      rig.setView(lotView()); env.setShadowArea(state.lot.w / 2, state.lot.h / 2, Math.max(state.lot.w, state.lot.h) * 0.8 + 4);
      scene.fog.near = 110; scene.fog.far = 190;
      const c = lotCam || { x: state.lot.w / 2, z: state.lot.h / 2, zoom: 1 };
      rig.zoomIndex = c.zoom; rig.viewHGoal = rig.zooms[c.zoom]; rig.levelY = level * LEVEL_H;
      rig.focus(c.x, c.z); cutDirty = true;
    },
    get view() { return view; },
    // ➕ 3D-превью для «Создать семью»: {update(look), dispose()}
    previewSim: (canvasEl, look) => previewSim(canvasEl, look),
    rotate(d) { rig.rotate(d); },
    zoom(d) { rig.zoom(d); },
    pan(dx, dy) { rig.pan(dx, dy); },
    focus(x, y, instant) { rig.focus(x, y, instant); },
    setWallMode(m) { if (['up', 'cutaway', 'down'].includes(m)) { wallMode = m; lot.setMode(m); cutDirty = true; } },
    setLevel(l) {
      level = lot.clampLevel(l); lot.setLevel(level); objs.setLevel(level); sims.setLevel(level); fire.setLevel(level);
      rig.levelY = level * LEVEL_H; cutDirty = true;
    },
    setHover(id) { objs.setHover(id); },
    // ➕ спрятать предмет (перенос в Покупке); то же делает setGhost({..., movingId})
    setHidden(id) { objs.setHidden(id); },
    setGhost(g) { objs.setHidden(g?.movingId ?? null); ghosts.setGhost(g); }, setWallGhost: ghosts.setWallGhost, setFloorGhost: ghosts.setFloorGhost,
    // мировые (three) координаты → клиентские пиксели (как у clientX/Y)
    screenPos(wx, wy, wz) {
      _v.set(wx, wy, wz).project(rig.cam);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + (_v.x + 1) / 2 * r.width, y: r.top + (1 - _v.y) / 2 * r.height, visible: _v.z > -1 && _v.z < 1 };
    },
    // ➕ экранная точка над головой жителя (для пузырей)
    simScreenPos(simId, lift = 0.35) { const p = sims.headPos(simId); return p ? R.screenPos(p.x, p.y + lift, p.z) : null; },
    get wallMode() { return wallMode; },
    get level() { return level; },
    get rotation() { return rig.rotIndex; },
    get zoomLevel() { return rig.zoomIndex; },
    snap() { rig.snap(); cutDirty = true; },
    dispose() { off.forEach(f => f()); renderer.dispose(); },
  };
  R.setLevel(0);
  // Прогрев шейдеров: всё, что может появиться позже (огонь, лужи, призраки, подсветка, инстансы, вода),
  // компилируем сразу — убирает разовые пики при первом появлении
  R.prewarm = async () => {
    const warm = new THREE.Group(), box = new THREE.BoxGeometry(0.01, 0.01, 0.01);
    const mats = [...Object.values(MAT).filter(m => m?.isMaterial), waterMat(), new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5, depthWrite: false }),
      new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff', emissiveIntensity: 0.3 }), new THREE.MeshBasicMaterial({ color: '#f00' })];
    for (const m of mats) { const a = new THREE.Mesh(box, m); a.position.set(state.lot.w / 2, -5, state.lot.h / 2); warm.add(a); const im = new THREE.InstancedMesh(box, m, 1); im.position.copy(a.position); warm.add(im); }
    for (const blend of [THREE.NormalBlending, THREE.AdditiveBlending]) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ blending: blend, transparent: true, depthWrite: false })); sp.position.set(0, -5, 0); warm.add(sp); }
    scene.add(warm);
    try { await renderer.compileAsync(scene, rig.cam); } catch (e) { renderer.compile(scene, rig.cam); }
    scene.remove(warm);
  };
  if (opts.prewarm !== false) await R.prewarm();
  return R;
}
