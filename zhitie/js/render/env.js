// Свет и день/ночь. Порт updateEnv/sunEl из russia/index.html :1055-1081 (солнце/луна, hemi,
// экспозиция, окна/фонари загораются), пост-обработка — russia :1228-1249 (bloom + OutputPass, без grade).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { lerp, sstep, PI, V3 } from './util.js';

export const MAX_LAMPS = 6;   // фиксированный пул точечных ламп: число огней не меняется → нет перекомпиляции шейдеров

// Высота солнца по часу: день 6..20 (в russia был 8..17 — зима), ночь — отрицательная.
function sunEl(t) {
  return (t >= 6 && t <= 20) ? 0.95 * Math.sin(PI * (t - 6) / 14) : -0.4 * Math.sin(PI * (((t - 20) + 24) % 24) / 10);
}

const COL = {
  dSky: new THREE.Color(0xa9cde6), sSky: new THREE.Color(0xf0b58c), nSky: new THREE.Color(0x0e1830),
};

export function createEnv(renderer, scene, cam, lot) {
  const cx = lot.w / 2, cz = lot.h / 2, R = Math.max(lot.w, lot.h) * 0.8 + 4;
  scene.background = new THREE.Color(COL.dSky);
  scene.fog = new THREE.Fog(COL.dSky, 110, 190);

  const hemi = new THREE.HemisphereLight(0xdbe8ff, 0x7a8a5a, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 200 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
  sun.target.position.set(cx, 0, cz);
  scene.add(sun, sun.target);

  // Пул ламп (торшеры) — позиции задаёт objects.js
  const lamps = [];
  for (let i = 0; i < MAX_LAMPS; i++) {
    const l = new THREE.PointLight(0xffc27a, 0, 7, 1.6); l.position.set(-100, -100, -100); scene.add(l); lamps.push(l);
  }

  // центр/радиус теневой карты: участок или (волна 3) весь район
  let scx = cx, scz = cz;
  const setShadowArea = (x, z, r) => { scx = x; scz = z; Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, far: r * 4 + 100 }); sun.shadow.camera.updateProjectionMatrix(); sun.target.position.set(x, 0, z); };
  const env = { setShadowArea, hemi, sun, lamps, nightF: 0, dayK: 1, lit: 0, nightMats: new Set(), composer: null, bloom: null };

  // Пост: bloom по ночам даёт ореол ламп и окон
  env.setupPost = (w, h) => {
    try {
      const pr = renderer.getPixelRatio();
      const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: 4 });
      const composer = new EffectComposer(renderer, rt);
      composer.addPass(new RenderPass(scene, cam));
      env.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.4, 1.0);
      composer.addPass(env.bloom);
      composer.addPass(new OutputPass());
      env.composer = composer;
    } catch (e) { console.warn('[render] пост выключен', e); env.composer = null; }
  };
  env.resize = (w, h) => { env.composer?.setSize(w, h); };
  // bloom нужен только когда горят лампы/окна; днём — прямой рендер с MSAA холста (дешевле в разы)
  env.render = () => { env.composer && env.lit > 0.04 ? env.composer.render() : renderer.render(scene, cam); };

  const _c = new THREE.Color();
  env.update = (hours) => {
    const t = ((hours % 24) + 24) % 24;
    const el = sunEl(t), az = (t - 13) / 14 * PI;
    const sd = new V3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el) * 0.6 + 0.4).normalize();
    const nightF = sstep(0.03, -0.14, el), dayK = sstep(-0.06, 0.22, el), sunset = sstep(0.3, 0.02, el) * (1 - nightF);
    env.nightF = nightF; env.dayK = dayK;

    _c.copy(COL.dSky).lerp(COL.sSky, sunset * 0.7).lerp(COL.nSky, nightF);
    scene.background.copy(_c); scene.fog.color.copy(_c);

    if (el > -0.02) {
      sun.position.set(scx, 0, scz).addScaledVector(sd, 80 + sun.shadow.camera.right);
      sun.color.setRGB(1, lerp(0.66, 0.96, sstep(0, 0.35, el)), lerp(0.45, 0.9, sstep(0, 0.35, el)));
      sun.intensity = 2.7 * sstep(-0.02, 0.14, el);
    } else { // луна
      const md = new V3(-sd.x, Math.abs(sd.y) + 0.6, -sd.z).normalize();
      sun.position.set(scx, 0, scz).addScaledVector(md, 80 + sun.shadow.camera.right);
      sun.color.setRGB(0.55, 0.66, 1); sun.intensity = 0.55 * nightF;
    }
    hemi.intensity = lerp(0.55, 1.0, dayK);
    hemi.color.setRGB(lerp(0.42, 0.86, dayK), lerp(0.5, 0.91, dayK), lerp(0.8, 1, dayK));
    hemi.groundColor.setRGB(lerp(0.16, 0.5, dayK), lerp(0.18, 0.52, dayK), lerp(0.26, 0.4, dayK));
    renderer.toneMappingExposure = lerp(1.3, 1.0, dayK);

    const lit = sstep(0.1, 0.6, nightF) * 0.85 + sunset * 0.25; // вечером свет уже включают
    env.lit = lit;
    for (const m of env.nightMats) m.emissiveIntensity = lit * (m.userData.glow || 1);
    for (const l of lamps) l.intensity = l.userData.on ? lit * 9 : 0;
    if (env.bloom) { env.bloom.threshold = lerp(0.75, 1.6, dayK); env.bloom.strength = lerp(0.55, 0.18, dayK); }
  };
  return env;
}
