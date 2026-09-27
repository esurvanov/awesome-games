// Изометрическая камера «как классическая камера Sims 2»: ортографика, ~30° наклон,
// 4 поворота по 90° (твин), 3 зума (твин), пан в пикселях экрана, фокус на точку.
// Математика yaw/pitch/dist адаптирована из орбит-камеры russia/index.html :1150-1166.
import * as THREE from 'three';
import { clamp, damp, PI } from './util.js';

export const ELEV = 30 * PI / 180;          // угол наклона
export const ZOOMS = [30, 17, 9];           // высота кадра в метрах: далеко / средне / близко
const DIST = 80;                            // расстояние камеры от цели (для ортографики — только от клиппинга)

export function createCameraRig(canvas, lot) {
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
  const rig = {
    cam,
    rotIndex: 0, yaw: PI / 4, yawGoal: PI / 4,
    zoomIndex: 1, viewH: ZOOMS[1], viewHGoal: ZOOMS[1],
    target: new THREE.Vector3(lot.w / 2, 0, lot.h / 2), goal: new THREE.Vector3(lot.w / 2, 0, lot.h / 2),
    aspect: 1, heightPx: 1, levelY: 0,
    changed: true, // флаг для пересчёта cutaway
    dist: DIST, zooms: [...ZOOMS], bounds: [-3, -3, lot.w + 3, lot.h + 6],
  };
  // Волна 3: вид района — свои границы, зумы и дальность камеры
  rig.setView = ({ bounds, zooms, dist }) => {
    if (bounds) rig.bounds = bounds;
    if (zooms) { rig.zooms = zooms; rig.zoomIndex = Math.min(rig.zoomIndex, zooms.length - 1); rig.viewHGoal = zooms[rig.zoomIndex]; }
    if (dist) { rig.dist = dist; cam.far = dist * 3 + 200; cam.updateProjectionMatrix(); }
    clampGoal(); rig.changed = true;
  };

  // ось «вперёд» по горизонтали (от камеры к цели) для указанного yaw
  rig.forward = (yaw = rig.yawGoal) => new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  rig.right = (yaw = rig.yaw) => new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

  const clampGoal = () => {
    rig.goal.x = clamp(rig.goal.x, rig.bounds[0], rig.bounds[2]);
    rig.goal.z = clamp(rig.goal.z, rig.bounds[1], rig.bounds[3]);
  };

  rig.rotate = (d) => { d = Math.sign(d) || 1; rig.rotIndex = (rig.rotIndex + d + 4) % 4; rig.yawGoal += d * PI / 2; rig.changed = true; };
  rig.zoom = (d) => { rig.zoomIndex = clamp(rig.zoomIndex + Math.sign(d), 0, rig.zooms.length - 1); rig.viewHGoal = rig.zooms[rig.zoomIndex]; };
  // пан: сдвиг вида на dx,dy пикселей экрана (dx>0 — вид уезжает вправо, dy>0 — вниз)
  rig.pan = (dx, dy) => {
    const wpp = rig.viewHGoal / rig.heightPx;
    const r = rig.right(rig.yawGoal), f = rig.forward(rig.yawGoal);
    rig.goal.addScaledVector(r, dx * wpp).addScaledVector(f, -dy * wpp / Math.sin(ELEV));
    clampGoal(); rig.changed = true;
  };
  rig.focus = (x, z, instant = false) => {
    rig.goal.set(x, 0, z); clampGoal(); rig.changed = true;
    if (instant) rig.target.copy(rig.goal);
  };
  rig.snap = () => { rig.target.copy(rig.goal); rig.yaw = rig.yawGoal; rig.viewH = rig.viewHGoal; rig.update(0); };

  rig.resize = (w, h) => { rig.aspect = w / Math.max(1, h); rig.heightPx = Math.max(1, h); };

  rig.update = (dt) => {
    rig.yaw = damp(rig.yaw, rig.yawGoal, 9, dt);
    if (Math.abs(rig.yaw - rig.yawGoal) < 1e-4) rig.yaw = rig.yawGoal;
    rig.viewH = damp(rig.viewH, rig.viewHGoal, 9, dt);
    rig.target.x = damp(rig.target.x, rig.goal.x, 8, dt);
    rig.target.z = damp(rig.target.z, rig.goal.z, 8, dt);
    rig.target.y = damp(rig.target.y, rig.levelY, 8, dt);
    const ce = Math.cos(ELEV), se = Math.sin(ELEV);
    const D = rig.dist;
    cam.position.set(rig.target.x + Math.sin(rig.yaw) * ce * D, rig.target.y + se * D, rig.target.z + Math.cos(rig.yaw) * ce * D);
    cam.lookAt(rig.target);
    const hh = rig.viewH / 2, hw = hh * rig.aspect;
    cam.left = -hw; cam.right = hw; cam.top = hh; cam.bottom = -hh;
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  };
  return rig;
}
