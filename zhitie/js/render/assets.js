// Загрузка манифеста Ассетов и glb: кэш, клонирование, нормализация под след предмета.
// Нормализация — порт model() из russia/index.html :498-513 (масштаб по размеру, центр, опора в пол, tint)
// и prepModel() из game/open-world.html :2233 (рост персонажа, тени).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export const manifest = { MODELS: {}, CHARACTERS: {}, ANIMS: null, ok: false };

// manifest.js пишет агент Ассетов; если его ещё нет — работаем на процедурных заглушках.
export async function loadManifest() {
  try {
    const m = await import('./manifest.js');
    // все экспорты манифеста (CHILDREN, PROPS, OUTFITS, HAIR, ACCESSORIES, BODY, SHAPES, HOOD…)
    Object.assign(manifest, m, { MODELS: m.MODELS || {}, CHARACTERS: m.CHARACTERS || {}, ANIMS: m.ANIMS || null, ok: true });
  } catch (e) {
    console.info('[render] manifest.js не найден — процедурные модели', e?.message || e);
  }
  return manifest;
}

const loader = new GLTFLoader();
const cache = new Map();   // url → Promise<gltf|null>
const ready = new Map();   // url → gltf (для синхронного доступа)

// Относительные url манифеста — от корня сайта (= две папки выше js/render/), не от страницы
const SITE_ROOT = new URL('../../', import.meta.url);
const resolveUrl = (u) => (/^(https?:|\/|data:|blob:)/.test(u) ? u : new URL(u, SITE_ROOT).href);

export function loadGLTF(url) {
  if (!url) return Promise.resolve(null);
  if (!cache.has(url)) {
    cache.set(url, loader.loadAsync(resolveUrl(url)).then(g => { ready.set(url, g); return g; })
      .catch(e => { console.warn('[render] не загрузился', url, e?.message || e); return null; }));
  }
  return cache.get(url);
}
export const gltfReady = (url) => ready.get(url) || null;

const isSkinned = (o) => { let s = false; o.traverse(m => { if (m.isSkinnedMesh) s = true; }); return s; };
const box = (o) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o, true); };

// tint манифеста: {имяМатериала: цвет} — перекрасить эти материалы; строка-цвет — только «основной» материал
// (у меша с наибольшим числом вершин), чтобы металл/стекло не красились
function applyTint(src, tint) {
  if (!tint) return;
  if (typeof tint === 'string' || typeof tint === 'number') {
    let best = null, n = -1;
    src.traverse(m => { if (m.isMesh && !Array.isArray(m.material)) { const c = m.geometry.attributes.position.count; if (c > n) { n = c; best = m.material; } } });
    if (!best) return;
    const t = best.clone(); t.color = new THREE.Color(tint);
    src.traverse(m => { if (m.isMesh && m.material === best) m.material = t; });
    return;
  }
  src.traverse(m => {
    if (!m.isMesh) return;
    const mats = [].concat(m.material).map(mt => { if (!tint[mt.name]) return mt; const n = mt.clone(); n.color = new THREE.Color(tint[mt.name]); return n; });
    m.material = Array.isArray(m.material) ? mats : mats[0];
  });
}

// Починка материалов библиотек (Kenney nature и др.): glTF без metallicFactor = металл 1.0 → без карты окружения
// меш чёрный (баг «чёрная ель»). Листва Kenney — бирюзовая: сдвигаем оттенок к зелёному. Кэш — один клон на материал.
const fixed = new WeakMap();
const _hsl = {};
function fixMaterial(mt) {
  if (!mt || fixed.has(mt)) return fixed.get(mt) || mt;
  let out = mt;
  const metal = mt.metalness >= 0.9 && !mt.metalnessMap, leaf = /leaf|leaves|листв/i.test(mt.name || '');
  if (metal || leaf) {
    out = mt.clone();
    if (metal) { out.metalness = 0; out.roughness = Math.max(out.roughness ?? 0.8, 0.7); }
    if (leaf && out.color) { out.color.getHSL(_hsl); if (_hsl.h > 0.36 && _hsl.h < 0.55) out.color.setHSL(0.27 + (_hsl.h - 0.45) * 0.3, Math.min(0.55, _hsl.s), Math.min(0.42, _hsl.l)); }
  }
  fixed.set(mt, out); return out;
}

// Клон glb, вписанный в прямоугольник W×D (метры, локальные оси предмета), опора в пол, центр в 0.
// entry: {url, scale?, rotY?, yOffset?, tint?}. opt.height — вписать по высоте (персонажи).
export function instantiate(gltf, entry = {}, opt = {}) {
  const src = isSkinned(gltf.scene) ? SkeletonUtils.clone(gltf.scene) : gltf.scene.clone(true);
  const inner = new THREE.Group(); inner.add(src); inner.rotation.y = entry.rotY || 0;
  const wrap = new THREE.Group(); wrap.add(inner);
  let b = box(wrap); const sz = b.getSize(new THREE.Vector3());
  let s = entry.scale;
  if (!s) {
    if (opt.height) s = opt.height / Math.max(1e-4, sz.y);
    else s = Math.min((opt.W || 1) * 0.96 / Math.max(1e-4, sz.x), (opt.D || 1) * 0.96 / Math.max(1e-4, sz.z));
    if (opt.maxH && sz.y * s > opt.maxH) s = opt.maxH / sz.y;
  }
  inner.scale.setScalar(s);
  if (entry.scale === 1 && entry.mount) {
    // модель уже нормализована Ассетами (центр следа в 0, опора y=0) — доверяем её опорной точке
    inner.position.set(0, entry.yOffset || 0, 0);
  } else {
    b = box(wrap); const c = b.getCenter(new THREE.Vector3());
    inner.position.set(-c.x, -b.min.y + (entry.yOffset || 0), -c.z);
  }
  src.traverse(m => {
    if (!m.isMesh) return;
    m.castShadow = true; m.receiveShadow = true;
    if (m.isSkinnedMesh) m.frustumCulled = false;
    m.material = [].concat(m.material).map(fixMaterial).reduce((a, x, i, arr) => arr.length > 1 ? arr : x, null);
  });
  applyTint(src, entry.tint);
  wrap.userData = { src, inner, gltf, size: box(wrap).getSize(new THREE.Vector3()) };
  return wrap;
}
