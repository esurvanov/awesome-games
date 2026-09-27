// Жители: glb-персонаж (манифест CHARACTERS + ANIMS UAL, SkeletonUtils.clone) или процедурный человек.
// sim.x/y — float тайловые координаты: тайл (i,j) = мир [i,i+1]×[j,j+1], центр = i+0.5 → мир X = sim.x, Z = sim.y.
// sim.facing — радианы как three rotation.y (0 → +Z). Нимб-кольцо над выбранным (цвет по настроению).
// Аниматор glb — порт makeAnimator (game/open-world.html :2255) и actor/setAct (russia :528-534).
import * as THREE from 'three';
import { manifest, loadGLTF, instantiate } from './assets.js';
import { resolveClip, ONCE, POSTURE, isUpper } from './anims.js';
import { createPerson, poseFor, applyPose, lookOf } from './person.js';
import { LEVEL_H, stairHeight } from './lot.js';
import { byId, kindOf } from '../../data/catalog.js';
import { damp, moodOf, moodColor, PI } from './util.js';

const SIM_H = 1.75, LIE_Z = 1.42, GLB_LIE_Z = 0.45;
const simSig = (s) => `${s.npc || ''}|${!!s.ghost}|${s.age || ''}|${JSON.stringify(s.look || {})}`;
const angDamp = (a, b, k, dt) => { let d = ((b - a + PI) % (2 * PI) + 2 * PI) % (2 * PI) - PI; return a + d * (1 - Math.exp(-k * dt)); };

// Кэш клипов из ANIMS (url или url[])
let clipsP = null;
function loadClips() {
  if (clipsP) return clipsP;
  const A = manifest.ANIMS; const urls = A ? [].concat(A.urls || A.url || []) : [];
  clipsP = Promise.all(urls.map(loadGLTF)).then(gs => gs.flatMap(g => g?.animations || []));
  return clipsP;
}

function makeAnimator(root, clips) {
  const mixer = new THREE.AnimationMixer(root), acts = new Map();
  const clipMap = manifest.ANIMS?.clipMap || {};
  const get = (name) => {
    if (!acts.has(name)) { const r = resolveClip(name, clips, clipMap, manifest.ANIMS?.fallback || {}); acts.set(name, r ? mixer.clipAction(r.clip) : null); }
    return acts.get(name);
  };
  let cur = null;
  return {
    mixer,
    play(name, once = ONCE.has(name), fade = 0.25) {
      const a = get(name); if (!a) return;
      if (a === cur && !once) return;
      a.reset(); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = once; a.setEffectiveWeight(1); a.play();
      if (cur && cur !== a) a.crossFadeFrom(cur, fade, false);
      cur = a;
    },
    speed(s) { if (cur) cur.setEffectiveTimeScale(s); },
    update(dt) { mixer.update(dt); },
  };
}

// Одежда glb: у Quaternius одна «крестьянская» текстура на рубаху/штаны/обувь (отдельные примитивы).
// Раскладываем примитивы материала из tintable по высоте (T-поза): верх → рубаха, середина → штаны,
// низ → обувь; текстуру снимаем, красим цветом из look. Волосы — look.hair, кожа — look.skin (MI_Regular_*).
function dressGLB(model, entry, lk) {
  const tint = new Set(entry.tintable || []), cloth = [];
  model.updateMatrixWorld(true);
  const H = new THREE.Box3().setFromObject(model, true).max.y || 1.8;
  const plain = (m, col) => { const n = m.material.clone(); n.map = null; n.color = new THREE.Color(col); n.roughness = 0.85; n.metalness = 0; m.material = n; return n; };
  // волна 2: одежда размечена именами материалов shirt/pants/dress/shoes/hair/skin — красим по имени
  const BY_NAME = { shirt: lk.top, dress: lk.top, pants: lk.bottom, shoes: lk.shoes, hair: lk.hair, skin: lk.skin };
  let named = false;
  model.traverse(m => {
    if (!m.isMesh || Array.isArray(m.material)) return;
    const k = (m.material.name || '').toLowerCase().replace(/[^a-z].*$/, '');
    if (BY_NAME[k]) { named = true; const n = m.material.clone(); n.color = new THREE.Color(BY_NAME[k]); if (k === 'skin' && n.map) n.color.multiplyScalar(1.25); else n.map = null; m.material = n; }
  });
  if (named) { model.traverse(m => { if (m.isMesh) [].concat(m.material).forEach(addRim); }); return; }
  // волна 1 (крестьяне): одна ткань на рубаху/штаны/обувь — раскладка по высоте
  model.traverse(m => {
    if (!m.isMesh || Array.isArray(m.material)) return;
    const name = m.material.name || '';
    if (tint.has(name) && /hair/i.test(name)) plain(m, lk.hair);
    else if (tint.has(name)) cloth.push(m);
    else if (/regular|superhero|skin|body/i.test(name)) { const n = m.material.clone(); n.color = new THREE.Color(lk.skin).multiplyScalar(1.15); m.material = n; }
  });
  for (const m of cloth) {
    const b = new THREE.Box3().setFromObject(m, true), cy = (b.min.y + b.max.y) / 2 / H;
    const n = plain(m, cy > 0.52 ? lk.top : b.max.y / H > 0.32 ? lk.bottom : lk.shoes);
    // рукава во весь размах (T-поза) содержат кисти: концы по оси размаха красим цветом кожи
    if ((b.max.x - b.min.x) / H > 0.8) {
      const g = m.geometry = m.geometry.clone(), pos = g.attributes.position;
      g.computeBoundingBox(); const bb = g.boundingBox, ext = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
      const ax = ext.x >= ext.y && ext.x >= ext.z ? 'x' : ext.y >= ext.z ? 'y' : 'z', half = ext[ax] / 2;
      const cloth3 = new THREE.Color(lk.top), skin = new THREE.Color(lk.skin), col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const v = ax === 'x' ? pos.getX(i) : ax === 'y' ? pos.getY(i) : pos.getZ(i);
        (Math.abs(v - c[ax]) / half > 0.78 ? skin : cloth3).toArray(col, i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); n.vertexColors = true; n.color.set('#ffffff');
    }
  }
  model.traverse(m => { if (m.isMesh) [].concat(m.material).forEach(addRim); });
}

// Смерть: всё тело — тёмный балахон с лёгким фиолетовым свечением
function darkRobe(model) {
  model.traverse(m => { if (!m.isMesh) return; const n = [].concat(m.material).map(x => { const c = x.clone(); c.map = null; c.color = new THREE.Color('#18161e'); c.emissive = new THREE.Color('#2a1640'); c.emissiveIntensity = 0.6; return c; }); m.material = Array.isArray(m.material) ? n : n[0]; });
}
// Призрак: полупрозрачный бело-зелёный
const GHOST_MAT = new THREE.MeshStandardMaterial({ color: '#d8ffe8', emissive: '#7dffb0', emissiveIntensity: 0.6, transparent: true, opacity: 0.45, depthWrite: false });
function ghostify(obj) { obj.traverse(m => { if (m.isMesh && m.visible !== false && !m.userData.proxy) { m.material = GHOST_MAT; m.castShadow = false; } }); }

// Мелкий реквизит НПС: следует за головой/кистью (не привязан к кости — оси костей UAL разные)
const PM = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o });
function npcProps(npc) {
  const out = [], add = (mesh, at, dy = 0) => { mesh.traverse(m => { m.castShadow = true; m.raycast = () => {}; }); out.push({ mesh, at, dy }); };
  if (npc === 'fire') { const g = new THREE.Group(); const d = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), PM('#c8302a')); const b = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 16), PM('#c8302a')); b.position.set(0, 0, -0.03); g.add(d, b); add(g, 'head', -0.1, 'helmet'); }
  if (npc === 'police') { const g = new THREE.Group(); const c = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.08, 14), PM('#1a2440')); const v = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.015, 0.1), PM('#0c0c10')); v.position.set(0, -0.035, 0.12); const s = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.01), PM('#e0c040', { metalness: 0.6 })); s.position.set(0, 0.0, 0.14); g.add(c, v, s); add(g, 'head', -0.06); }
  if (npc === 'pizza') { const g = new THREE.Group(); const c = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), PM('#d8342c')); const v = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.015, 0.12), PM('#d8342c')); v.position.set(0, 0, 0.13); g.add(c, v); add(g, 'head', -0.08, 'cap');
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.36), PM('#e9d8b0')); add(box, 'hand', 0.0, 'pizza_box'); }
  if (npc === 'burglar') { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.05, 16, 1, true), PM('#050505', { side: THREE.DoubleSide })); add(m, 'head', -0.17); }
  if (npc === 'maid') { const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.02), PM('#f7f7f2')); add(m, 'head', -0.02); }
  if (npc === 'reaper') {
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.42, 10), PM('#18161e', { emissive: '#2a1640', emissiveIntensity: 0.6 })); add(hood, 'head', -0.08);
    const g = new THREE.Group(); const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.9, 6), PM('#3a2a1e')); pole.position.y = 0.5;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.015), PM('#c8ccd6', { metalness: 0.8, roughness: 0.25, emissive: '#6a5aa0', emissiveIntensity: 0.3 })); blade.position.set(0.24, 1.42, 0); blade.rotation.z = -0.35;
    g.add(pole, blade); add(g, 'hand', 0, 'scythe');
  }
  return out;
}

// Реквизит Ассетов (PROPS): дочерний объект кости; заменяет одноимённый процедурный
const PROP_REPLACES = { helmet: 'helmet', cap: 'cap', pizza_box: 'pizza_box', scythe: 'scythe' };
function attachProps(rec, sim, model) {
  const P = manifest.PROPS || {};
  for (const [name, e] of Object.entries(P)) {
    if (!sim.npc || e.npc !== sim.npc || !e.url) continue;
    loadGLTF(e.url).then(g => {
      if (!g || rec.glb?.model !== model) return;
      let bone = null; model.traverse(o => { if (!bone && o.isBone && o.name === e.bone) bone = o; });
      if (!bone) return;
      const obj = g.scene.clone(true); obj.traverse(m => { if (m.isMesh) { m.castShadow = true; m.raycast = () => {}; } });
      if (e.position) obj.position.fromArray(e.position); if (e.quaternion) obj.quaternion.fromArray(e.quaternion);
      bone.add(obj);
      // процедурный дубль больше не нужен
      rec.props = rec.props.filter(p => { if (p.name === PROP_REPLACES[name]) { p.mesh.parent?.remove(p.mesh); return false; } return true; });
    });
  }
}

// Мягкий контровой свет (френель) — жители читаются на любом полу в любое время суток
export const RIM = { value: new THREE.Color("#cfe0ff").multiplyScalar(0.16) };
function addRim(mat) {
  if (!mat || mat.userData.rim || !mat.isMeshStandardMaterial) return;
  mat.userData.rim = true;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = RIM;
    sh.fragmentShader = 'uniform vec3 uRim;\n' + sh.fragmentShader.replace('#include <opaque_fragment>',
      'outgoingLight += uRim * pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 2.2) + diffuseColor.rgb * uRim * 0.35;\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => 'rim';
  mat.needsUpdate = true;
}

// ── Персонаж из ассетов (волна 3: CAS) ──
// Тело: look.outfit → OUTFITS[пол][стиль] (лысое тело + одежда); НПС — рабочая форма; ребёнок — CHILDREN;
// иначе CHARACTERS (как раньше). Причёска look.hairStyle и аксессуары look.acc[] — меши на кости 'Head';
// телосложение look.shape → BODY (масштабы костей). Цвета — по именам материалов (dressGLB).
const NPC_OUTFIT = { maid: 'work_maid', repair: 'work_repair', fire: 'work_fire', police: 'work_police' };
function pickBase(sim, lk) {
  const L = sim.look || {}, g = lk.female ? 'f' : 'm';
  const child = sim.age === 'child' && Object.keys(manifest.CHILDREN || {}).length;
  if (!child && manifest.OUTFITS) {
    const key = L.outfit || NPC_OUTFIT[sim.npc];
    const o = key && (manifest.OUTFITS[g]?.[key] || manifest.OUTFITS[g === 'f' ? 'm' : 'f']?.[key]);
    if (o?.url) return { entry: { height: lk.female ? 1.8 : 1.81, tintable: ['shirt', 'pants', 'dress', 'shoes', 'hair', 'skin'], ...o }, child: false, bald: true };
  }
  const C = (child ? manifest.CHILDREN : manifest.CHARACTERS) || {}, keys = Object.keys(C); if (!keys.length) return null;
  const want = L.model || L.character;
  const sexOf = (k) => C[k].sex || (/fem|wom|girl/i.test(k) ? 'f' : 'm');
  const isF = (k) => /^f/i.test(sexOf(k));
  const elder = !child && (sim.npc === 'reaper' || /old|elder|стар/i.test(String(L.age || sim.age || '')));
  let pool = keys.filter(k => isF(k) === lk.female && /elder|old/i.test(k) === elder);
  if (!pool.length) pool = keys.filter(k => isF(k) === lk.female);
  const v = L.variant ?? L.style;
  const byV = typeof v === 'string' ? pool.find(k => k.endsWith('_' + v)) || (v === 'a' ? pool.find(k => !/_/.test(k)) : null) : null;
  const key = (want && C[want] && want) || byV || pool[(Number.isFinite(+v) && v !== null && v !== '' ? +v : (sim.id || 0)) % Math.max(1, pool.length)] || keys[0];
  return C[key]?.url ? { entry: C[key], child: !!child, bald: false } : null;
}
export async function loadCharacter(sim) {
  const lk = lookOf(sim), base = pickBase(sim, lk); if (!base) return null;
  const L = sim.look || {};
  const [g, extra] = await Promise.all([loadGLTF(base.entry.url), loadClips()]);
  if (!g) return null;
  const clips = [...(g.animations || []), ...extra];
  if (!clips.length) return null; // без клипов процедурный человек выглядит лучше статуи
  const model = instantiate(g, base.entry, { height: base.entry.height || SIM_H });
  // телосложение: масштаб костей один раз (в клипах нет каналов масштаба)
  const body = L.shape && manifest.BODY?.[L.shape];
  if (body) model.traverse(o => { if (o.isBone && body[o.name]) o.scale.set(...body[o.name]); });
  dressGLB(model, base.entry, lk);
  // причёска и аксессуары — на кость головы
  const head = model.getObjectByName('Head');
  const style = L.hairStyle || (base.bald ? (lk.female ? 'bob_f' : 'buzz_m') : null);
  const parts = [];
  if (style && manifest.HAIR?.[style]) parts.push([manifest.HAIR[style], { hair: lk.hair }]);
  for (const a of [].concat(L.acc || [])) if (manifest.ACCESSORIES?.[a]) parts.push([manifest.ACCESSORIES[a], { hair: lk.hair, accColor: L.accColor || '#3a3f4a' }]);
  if (head && parts.length) {
    if (L.hairStyle && !base.bald) model.traverse(m => { if (m.isMesh && /^hair/i.test(m.material?.name || '') && m.geometry.boundingSphere?.radius > 0.05) m.visible = false; });
    await Promise.all(parts.map(async ([e, cols]) => {
      if (!e.url) return;
      const hg = await loadGLTF(e.url); if (!hg) return;
      const mesh = hg.scene.clone(true);
      mesh.traverse(m => { if (!m.isMesh) return; m.castShadow = true; const k = (m.material.name || '').replace(/[^a-zA-Z].*$/, ''); const c = cols[k] || cols[e.tint]; if (c && (k === e.tint || cols[k])) { m.material = m.material.clone(); m.material.color = new THREE.Color(c); } addRim(m.material); });
      head.add(mesh);
    }));
  }
  return { model, clips, child: base.child };
}

// ➕ Живое 3D-превью для «Создать семью»: своя сцена и рендерер на переданном canvas.
// R.previewSim(canvas, look) → {update(look), dispose()}; вращается, играет idle.
export function previewSim(canvas, look = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  cam.position.set(0, 1.25, 4.6); cam.lookAt(0, 0.95, 0);
  scene.add(new THREE.HemisphereLight(0xeef4ff, 0x8a7a6a, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(2, 3, 3); scene.add(key);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.7, 32), new THREE.MeshStandardMaterial({ color: '#dfe8d8', roughness: 1 }));
  disc.rotation.x = -Math.PI / 2; scene.add(disc);
  const holder = new THREE.Group(); scene.add(holder);
  let mixer = null, cur = null, raf = 0, last = performance.now(), gen = 0, dead = false;
  const show = (lk) => {
    const my = ++gen;
    const sim = { id: 1, look: lk, age: lk.age === 'child' || lk.child ? 'child' : 'adult' };
    // сразу — процедурный человек, glb подменит
    const person = createPerson(sim); applyPose(person, poseFor(person, 'idle', 0), 1);
    holder.clear(); holder.add(person.body); cur = { person }; mixer = null;
    loadCharacter(sim).then(res => {
      if (!res || my !== gen || dead) return;
      holder.clear(); holder.add(res.model);
      mixer = new THREE.AnimationMixer(res.model.userData.src);
      const r = resolveClip('idle', res.clips, manifest.ANIMS?.clipMap || {}); if (r) mixer.clipAction(r.clip).play();
      cur = null;
    });
  };
  const loop = (now) => {
    if (dead) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio())) { renderer.setSize(w, h, false); cam.aspect = w / Math.max(1, h); cam.updateProjectionMatrix(); }
    holder.rotation.y += dt * 0.5;
    mixer?.update(dt);
    if (cur?.person) applyPose(cur.person, poseFor(cur.person, 'idle', now / 1000), dt);
    renderer.render(scene, cam);
    raf = requestAnimationFrame(loop);
  };
  show(look); raf = requestAnimationFrame(loop);
  return {
    update(lk) { show(lk || {}); },
    dispose() { dead = true; cancelAnimationFrame(raf); renderer.dispose(); },
  };
}

export function createSims(scene, state) {
  const root = new THREE.Group(); root.name = 'sims'; scene.add(root);
  const recs = new Map();
  let level = 0, selected = null, t = 0;

  // нимб: кольцо + мягкое свечение
  const haloMat = new THREE.MeshStandardMaterial({ color: '#5cff3a', emissive: '#5cff3a', emissiveIntensity: 1.4, roughness: 0.3 });
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.032, 8, 28), haloMat);
  halo.rotation.x = PI / 2; halo.visible = false; halo.raycast = () => {};
  scene.add(halo);

  function create(sim) {
    const group = new THREE.Group(); group.userData.simId = sim.id;
    const wrap = new THREE.Group(); group.add(wrap);        // поза «лёжа» применяется к wrap
    const person = createPerson(sim);
    Object.values(person.mats).forEach(addRim);
    wrap.add(person.body);
    // невидимый цилиндр для пикинга (крупнее тела — удобнее попадать)
    const proxy = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.9, 8), new THREE.MeshBasicMaterial());
    proxy.position.y = 0.95; proxy.visible = false; proxy.userData.simId = sim.id; proxy.userData.proxy = true; group.add(proxy);
    const rec = { id: sim.id, group, wrap, person, proxy, glb: null, anim: null, animT: 0, once: null, last: new THREE.Vector3(sim.x, 0, sim.y), speed: 0, facing: sim.facing || 0, lie: 0, posture: 'stand' };
    rec.sig = simSig(sim);
    rec.props = npcProps(sim.npc); rec.props.forEach(p => root.add(p.mesh));
    if (sim.ghost) ghostify(person.body);
    root.add(group); recs.set(sim.id, rec);
    group.position.set(sim.x, (sim.level || 0) * LEVEL_H, sim.y);
    tryGLB(rec, sim);
    return rec;
  }

  // glb-персонаж, если Ассеты его дали
  function tryGLB(rec, sim) {
    loadCharacter(sim).then(res => {
      if (!res || recs.get(rec.id) !== rec) return;
      const { model, clips, child } = res;
      if (sim.npc === 'reaper') darkRobe(model);
      if (sim.ghost) ghostify(model);
      const anim = makeAnimator(model.userData.src, clips);
      rec.wrap.remove(rec.person.body); rec.wrap.add(model);
      rec.glb = { model, anim }; rec.anim = null; rec.clip = null; rec.glbChild = !!child; // перезапустить текущую анимацию
      attachProps(rec, sim, model);
    });
  }

  const S = { root, recs, halo };
  S.setLevel = (l) => { level = l; };
  S.select = (id) => { selected = id; };
  S.selected = () => selected;

  // событие sim:anim — перезапуск (для once-анимаций вроде wave/yes)
  S.onAnim = ({ simId, anim, once }) => { const r = recs.get(simId); if (r) { r.anim = null; r.once = once ? anim : null; r.animT = 0; } };

  const drop = (r) => { root.remove(r.group); r.props?.forEach(p => root.remove(p.mesh)); recs.delete(r.id); };
  S.sync = () => {
    const seen = new Set();
    for (const sim of state.sims) {
      seen.add(sim.id);
      const r = recs.get(sim.id);
      if (r && r.sig !== simSig(sim)) drop(r);   // сменился вид (НПС/призрак/возраст) — пересобрать
      if (!recs.has(sim.id)) create(sim);
    }
    for (const [id, r] of recs) if (!seen.has(id)) drop(r);
  };

  // Высота «лежанки» под жителем: кровать → матрас, иначе пол (сон на полу, смерть)
  const BED_H = { bed_single: 0.45, bed_double: 0.45, sofa: 0.42, bathtub: 0.3 };
  function lieHeight(sim) {
    const x = Math.floor(sim.x), y = Math.floor(sim.y), lv = sim.level || 0;
    for (const o of state.objects) {
      const h = BED_H[kindOf(o.def)] ?? (/bed/.test(kindOf(o.def)) ? 0.45 : null); if (h == null || (o.level || 0) !== lv) continue;
      const d = byId[o.def], r = (o.rot || 0) & 1, W = r ? d.fp[1] : d.fp[0], D = r ? d.fp[0] : d.fp[1];
      if (x >= o.x && x < o.x + W && y >= o.y && y < o.y + D) return h;
    }
    return 0.02;
  }

  // mul — множитель скорости игры (0 = пауза)
  S.update = (dt, mul, nightF = 0) => {
    t += dt;
    const adt = dt * mul;
    for (const sim of state.sims) {
      const r = recs.get(sim.id); if (!r || !Number.isFinite(sim.x) || !Number.isFinite(sim.y)) continue;
      const lv = sim.level || 0, g = r.group;
      // на работе — не виден; младенец живёт в кроватке (предмет crib); призрак — только ночью
      g.visible = lv <= level && !sim.atWork && sim.age !== 'baby' && (!sim.ghost || nightF > 0.3);
      r.props.forEach(p => { p.mesh.visible = g.visible; });
      if (!g.visible) continue;
      g.scale.setScalar(sim.age === 'child' && !r.glbChild ? 0.65 : 1); // glb-дети уже уменьшены Ассетами
      // позиция: сглаживаем мелкие шаги Мозга, телепорт — мгновенно; высота — лестница/парение
      const tx = sim.x, tz = sim.y;
      // sim.z (Мозг) — абсолютная высота в метрах (плавно на лестнице); иначе — сами по лестнице/этажу
      let ty = Number.isFinite(sim.z) ? sim.z : stairY(sim) ?? lv * LEVEL_H;
      if (sim.npc === 'reaper' || sim.ghost) ty += 0.15 + Math.sin(t * 1.7 + sim.id) * 0.06;
      const jump = Math.hypot(tx - g.position.x, tz - g.position.z) > 2;
      if (jump) g.position.set(tx, ty, tz);
      else { g.position.x = damp(g.position.x, tx, 18, dt); g.position.z = damp(g.position.z, tz, 18, dt); g.position.y = damp(g.position.y, ty, 10, dt); }
      if (dt > 0) { const v = Math.hypot(tx - r.last.x, tz - r.last.z) / dt; r.speed = damp(r.speed, jump ? 0 : v, 6, dt); }
      r.last.set(tx, 0, tz);
      r.facing = angDamp(r.facing, Number.isFinite(sim.facing) ? sim.facing : r.facing, 10, dt);
      g.rotation.y = r.facing;

      // имя анимации: once из события держим до следующего sim:anim (просьба Мозга)
      let name = sim.dead ? 'sleep' : (r.once || sim.anim || 'idle');
      // поза: sim.posture от Мозга главнее, иначе — из имени анимации
      r.posture = sim.dead ? 'lie' : sim.posture || (isUpper(name) ? r.posture : POSTURE[name]) || 'stand';
      // glb: «верхняя» анимация сидя/лёжа → сидячий/лежачий клип (у UAL нет «есть сидя»)
      const clip = !isUpper(name) ? name : r.posture === 'sit' ? (/eat|drink/.test(name) ? 'sitEat' : name === 'read' ? 'sitRead' : /talk|phone|laugh|angry|no|yes/.test(name) ? 'sitTalk' : 'sitIdle') : r.posture === 'lie' ? 'sleep' : name;
      if (name !== r.anim || clip !== r.clip) { if (name !== r.anim) r.animT = 0; r.anim = name; r.clip = clip; if (r.glb) r.glb.anim.play(clip, ONCE.has(clip) || (!!r.once && clip === name)); }
      r.animT += adt;
      if (r.posture === 'lie') r.lieH = lieHeight(sim);

      // лежать: процедурный — поворот всего тела; glb-клипы Lie_* уже лёжа — только поднять на кровать
      r.lie = damp(r.lie, r.posture === 'lie' ? 1 : 0, 5, dt);
      const lh = r.lieH ?? 0.5;
      if (r.glb) { r.wrap.rotation.x = 0; r.wrap.position.set(0, lh * r.lie, GLB_LIE_Z * r.lie); }
      else { r.wrap.rotation.x = -PI / 2 * r.lie; r.wrap.position.set(0, (lh + 0.14) * r.lie, LIE_Z * r.lie); }

      if (r.glb) {
        const walkK = name === 'walk' ? Math.min(1.8, Math.max(0.6, r.speed / 1.3)) : name === 'run' ? Math.min(1.5, Math.max(0.8, r.speed / 3)) : 1;
        r.glb.anim.speed(walkK); r.glb.anim.update(sim.dead ? 0 : adt);
      } else {
        const P = r.person;
        const tt = name === 'walk' || name === 'run' ? (r.phase = (r.phase || 0) + adt * Math.min(1.8, Math.max(0.6, r.speed / 1.3))) : r.animT;
        const target = poseFor(P, name, sim.dead ? 0 : tt, r.posture);
        if (mul > 0 || sim.dead) applyPose(P, target, dt);
      }
    }
    updateProps();
    // нимб над выбранным
    const r = recs.get(selected), sim = state.sims.find(s => s.id === selected);
    halo.visible = !!(r && sim && r.group.visible);
    if (halo.visible) {
      const p = S.headPos(selected, halo.position);
      halo.position.y = p.y + 0.38 + Math.sin(t * 2.2) * 0.04;
      halo.rotation.z = t * 1.2;
      moodColor(moodOf(sim), haloMat.color); haloMat.emissive.copy(haloMat.color);
    }
  };

  // реквизит НПС: следует за макушкой / правой кистью
  const _p = new THREE.Vector3();
  function updateProps() {
    for (const r of recs.values()) {
      if (!r.props.length || !r.group.visible) continue;
      for (const p of r.props) {
        if (p.at === 'head') { S.headPos(r.id, _p); _p.y += p.dy * r.group.scale.y; }
        else if (!handPos(r, _p)) continue;
        p.mesh.position.copy(_p); p.mesh.rotation.y = r.group.rotation.y; p.mesh.scale.setScalar(r.group.scale.y);
      }
    }
  }
  function handPos(r, out) {
    if (r.glb) { const b = r.glb.hand ||= findBone(r.glb.model, /hand_r$|righthand|hand\.r/i); if (!b) return false; b.getWorldPosition(out); return true; }
    r.person.J.rE.localToWorld(out.set(0, -0.27, 0)); return true;
  }
  const findBone = (m, re) => { let h = null; m.traverse(o => { if (!h && o.isBone && re.test(o.name)) h = o; }); return h; };

  // Лестница: высота по доле пути вдоль пролёта (Мозг может дать sim.z — тогда главнее)
  function stairY(sim) {
    const lv = sim.level || 0;
    for (const o of state.objects) {
      if (kindOf(o.def) !== 'stairs') continue;
      const L = o.level || 0; if (lv !== L && lv !== L + 1) continue;
      const h = stairHeight(o, sim.x, sim.y); if (h == null) continue;
      return L * LEVEL_H + h;
    }
    return null;
  }

  // Мировая точка макушки жителя (для нимба и пузырей UI): кость головы glb или сустав шеи процедурного
  const _h = new THREE.Vector3();
  S.headPos = (id, out = new THREE.Vector3()) => {
    const r = recs.get(id); if (!r) return null;
    const bone = r.glb ? (r.glb.head ||= findHead(r.glb.model)) : r.person.J.neck;
    if (bone) {
      bone.updateWorldMatrix(true, false); bone.getWorldPosition(_h);
      out.copy(_h); out.y += r.glb ? 0.2 : 0.3; // от шеи/основания головы до макушки
      if (r.lie > 0.5) out.y -= 0.12;
      return out;
    }
    return out.copy(r.group.position).setY(r.group.position.y + SIM_H);
  };
  const findHead = (m) => { let h = null; m.traverse(o => { if (!h && o.isBone && /^head$/i.test(o.name)) h = o; }); if (!h) m.traverse(o => { if (!h && o.isBone && /head/i.test(o.name)) h = o; }); return h; };

  S.pickables = () => [...recs.values()].filter(r => r.group.visible).map(r => r.proxy);
  return S;
}
