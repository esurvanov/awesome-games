// Призраки режимов Покупка/Стройка: след предмета (зелёный/красный) + полупрозрачная модель,
// линия/прямоугольник стен, прямоугольник пола.
import * as THREE from 'three';
import { byId, FLOORS } from '../../data/catalog.js';
import { makeVisual } from './objects.js';
import { wallEdgeOf, LEVEL_H, WALL_H, WALL_T } from './lot.js';

const OK = new THREE.Color('#58e05a'), BAD = new THREE.Color('#ff4b3e');

export function createGhosts(scene, state) {
  const root = new THREE.Group(); root.name = 'ghosts'; scene.add(root);
  const tileMat = new THREE.MeshBasicMaterial({ color: OK, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const modelMat = new THREE.MeshStandardMaterial({ color: OK, emissive: OK, emissiveIntensity: 0.35, transparent: true, opacity: 0.5, depthWrite: false, roughness: 0.6 });
  const wallMat = new THREE.MeshStandardMaterial({ color: OK, emissive: OK, emissiveIntensity: 0.3, transparent: true, opacity: 0.45, depthWrite: false });
  const floorMat = new THREE.MeshBasicMaterial({ color: OK, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const tileGeo = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);
  const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

  const obj = new THREE.Group(), walls = new THREE.Group(), floor = new THREE.Group();
  root.add(obj, walls, floor);
  [obj, walls, floor].forEach(g => { g.visible = false; g.renderOrder = 5; });
  let objKey = '', objModel = null, t = 0;

  const clear = (g) => { while (g.children.length) g.remove(g.children[0]); };
  const noPick = (o) => o.traverse(m => { m.raycast = () => {}; });

  const G = {};
  // {defId, x, y, rot, level, ok}
  G.setGhost = (gh) => {
    if (!gh) { obj.visible = false; return; }
    const def = byId[gh.defId]; if (!def) { obj.visible = false; return; }
    const rot = ((gh.rot || 0) % 4 + 4) % 4, lv = gh.level || 0, ok = gh.ok !== false;
    const key = `${gh.defId}`;
    if (key !== objKey) {
      clear(obj); objKey = key;
      const p = makeVisual(gh.defId, null);
      objModel = p.group;
      objModel.traverse(m => { if (m.isMesh) { m.material = modelMat; m.castShadow = false; } });
      noPick(objModel);
    }
    // пересобрать след
    for (let i = obj.children.length - 1; i >= 0; i--) if (obj.children[i] !== objModel) obj.remove(obj.children[i]);
    const W = rot & 1 ? def.fp[1] : def.fp[0], D = rot & 1 ? def.fp[0] : def.fp[1], y = lv * LEVEL_H;
    if (def.place === 'wall') {
      const e = wallEdgeOf(state.lot, { x: gh.x, y: gh.y, rot, level: lv });
      const strip = new THREE.Mesh(unitBox, tileMat);
      if (e.dir === 'h') { strip.position.set(e.x + 0.5, y, e.y); strip.scale.set(1, 0.06, WALL_T + 0.1); }
      else { strip.position.set(e.x, y, e.y + 0.5); strip.scale.set(WALL_T + 0.1, 0.06, 1); }
      obj.add(strip);
      const tile = new THREE.Mesh(tileGeo, tileMat); tile.position.set(gh.x + 0.5, y + 0.04, gh.y + 0.5); obj.add(tile);
      objModel.position.set(gh.x + 0.5, y, gh.y + 0.5);
    } else {
      for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) { const m = new THREE.Mesh(tileGeo, tileMat); m.position.set(gh.x + i + 0.5, y + 0.04, gh.y + j + 0.5); obj.add(m); }
      objModel.position.set(gh.x + W / 2, y + (def.place === 'surface' ? 0.8 : 0), gh.y + D / 2);
    }
    objModel.rotation.y = rot * Math.PI / 2;
    obj.add(objModel); obj.children.forEach(noPick);
    tileMat.color.copy(ok ? OK : BAD); modelMat.color.copy(ok ? OK : BAD); modelMat.emissive.copy(ok ? OK : BAD);
    obj.visible = true;
  };

  // {x0,y0,x1,y1,level,ok,room?,del?} — вершины сетки. room → прямоугольник; иначе линия по главной оси;
  // одна вершина → столбик-курсор; del → оранжевый (снос)
  const DEL = new THREE.Color('#ff9d2e');
  G.setWallGhost = (gh) => {
    clear(walls);
    if (!gh) { walls.visible = false; return; }
    const lv = gh.level || 0, y = lv * LEVEL_H;
    let { x0, y0, x1, y1 } = gh;
    const edges = [];
    const line = (ax, ay, bx, by) => {
      if (Math.abs(bx - ax) >= Math.abs(by - ay)) { for (let x = Math.min(ax, bx); x < Math.max(ax, bx); x++) edges.push(['h', x, ay]); }
      else for (let yy = Math.min(ay, by); yy < Math.max(ay, by); yy++) edges.push(['v', ax, yy]);
    };
    const rect = !!gh.room;
    if (rect) { line(x0, y0, x1, y0); line(x0, y1, x1, y1); line(x0, y0, x0, y1); line(x1, y0, x1, y1); }
    else line(x0, y0, x1, y1);
    const h = gh.del ? WALL_H + 0.05 : WALL_H;
    for (const [dir, x, yy] of edges) {
      const m = new THREE.Mesh(unitBox, wallMat);
      if (dir === 'h') { m.position.set(x + 0.5, y, yy); m.scale.set(1 + WALL_T, h, WALL_T + 0.04); }
      else { m.position.set(x, y, yy + 0.5); m.scale.set(WALL_T + 0.04, h, 1 + WALL_T); }
      m.raycast = () => {}; walls.add(m);
    }
    if (!edges.length) { // курсор-вершина
      const m = new THREE.Mesh(unitBox, wallMat); m.position.set(x0, y, y0); m.scale.set(0.22, WALL_H * 0.5, 0.22); m.raycast = () => {}; walls.add(m);
    }
    const c = gh.ok === false ? BAD : gh.del ? DEL : OK; wallMat.color.copy(c); wallMat.emissive.copy(c);
    walls.visible = true;
  };

  // {x0,y0,x1,y1,level,ok,floorId?} — клетки, включительно
  G.setFloorGhost = (gh) => {
    clear(floor);
    if (!gh) { floor.visible = false; return; }
    const lv = gh.level || 0, y = lv * LEVEL_H + 0.05;
    const xa = Math.min(gh.x0, gh.x1), xb = Math.max(gh.x0, gh.x1), ya = Math.min(gh.y0, gh.y1), yb = Math.max(gh.y0, gh.y1);
    const n = (xb - xa + 1) * (yb - ya + 1);
    const im = new THREE.InstancedMesh(tileGeo, floorMat, n); let k = 0;
    const m4 = new THREE.Matrix4();
    for (let j = ya; j <= yb; j++) for (let i = xa; i <= xb; i++) im.setMatrixAt(k++, m4.makeTranslation(i + 0.5, y, j + 0.5));
    im.raycast = () => {}; floor.add(im);
    const f = FLOORS.find(f => f.id === gh.floorId);
    floorMat.color.set(gh.ok === false ? BAD : f ? f.color : OK);
    floor.visible = true;
  };

  G.update = (dt) => { t += dt; const k = 0.5 + 0.5 * Math.sin(t * 5); tileMat.opacity = 0.3 + 0.2 * k; modelMat.opacity = 0.45 + 0.1 * k; };
  return G;
}
