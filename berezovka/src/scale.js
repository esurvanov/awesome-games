// Реальные размеры моделей + посадка на землю + ворота масштаба.
// REAL[name] = {h|len: целевое, b:[мин,макс] по той же оси, h2:[мин,макс] вторичная высота (для len-моделей),
//               len2:[мин,макс] вторичная длина (для h-моделей), bld: здание (цоколь на склоне)}
// Политика: если размер из вызова уже в полосе — оставляем замысел вызова; иначе ставим целевое.
// Вторичную ось доводим неравномерным растяжением не более чем на ±STRETCH; остаток — в отчёт (FAIL-вороты не ставим, пишем MISMATCH).
import * as THREE from 'three';
const V3 = THREE.Vector3;

export const REAL = {
  // люди и звери (высота в полный рост)
  player:    {h: 1.80, b: [1.75, 1.85]},
  grandma:   {h: 1.60, b: [1.55, 1.65]},
  grandpa:   {h: 1.75, b: [1.68, 1.82]},
  priest:    {h: 1.82, b: [1.72, 1.88]},
  shopwoman: {h: 1.66, b: [1.58, 1.72]},
  bear:      {len: 2.2, b: [1.9, 2.5]},     // бурый медведь, длина тела
  cat_alt:   {h: 0.40, b: [0.35, 0.48]},    // кот до макушки
  dog:       {h: 0.80, b: [0.70, 0.90]},    // хаски до макушки (холка 0.55)
  animal_stag:{len: 2.4, b: [2.1, 2.6]},    // благородный олень, длина с головой
  // транспорт
  car:       {len: 4.10, b: [4.05, 4.15], h2: [1.40, 1.45]},  // ВАЗ-2101/2106
  bus:       {len: 7.20, b: [7.0, 7.5], h2: [2.7, 3.1]},      // ПАЗ-3205
  tractor:   {len: 4.00, b: [3.8, 4.3], h2: [2.5, 2.9]},      // МТЗ-80
  // постройки
  house1:    {len: 8.5, b: [7, 10], h2: [5, 7], bld: 1},       // изба: длина / конёк
  house2:    {len: 8.5, b: [7, 10], h2: [5, 7], bld: 1},
  house3:    {len: 8.5, b: [7, 10], h2: [5, 7], bld: 1},
  banya:     {h: 3.5, b: [3.0, 4.0], bld: 1},
  garage:    {len: 7.4, b: [7.2, 7.5], h2: [2.5, 3.0], bld: 1},    // бокс в ряду; высота ≥2.5 даёт ворота ≥2.1
  church:    {h: 24, b: [18, 30], bld: 1},
  apartment: {h: 15, b: [14, 15.5], len2: [60, 90], bld: 1},   // хрущёвка 5 эт.
  shop:      {h: 3.2, b: [2.8, 3.8], bld: 1},                   // ларёк/магазинчик
  gasstation:{h: 5.5, b: [4.5, 6.5], bld: 1},                   // навес АЗС
  statue:    {h: 6.5, b: [5.0, 8.0], bld: 1},                   // Ленин с постаментом
  // мелкая архитектура
  well:      {h: 2.5, b: [2.2, 2.8]},
  streetlamp:{h: 7.0, b: [6.0, 8.0]},
  powerpole: {h: 8.5, b: [8.0, 9.0]},
  fence:     {h: 1.4, b: [1.2, 1.6]},
  snowman:   {h: 1.6, b: [1.3, 1.9]},
  playground:{h: 3.0, b: [2.5, 3.5]},
  swing:     {h: 2.3, b: [2.0, 2.6]},
  woodpile:  {len: 2.2, b: [1.8, 2.6]},
  samovar:   {h: 0.40, b: [0.32, 0.55]},
  // предметы-награды
  log:       {len: 0.45, b: [0.30, 0.55]},   // полено
  battery:   {len: 0.28, b: [0.24, 0.32]},   // аккумулятор 55 А·ч
  canister:  {h: 0.47, b: [0.40, 0.50]},     // канистра 20 л
  // деревья
  spruce:    {h: 9, b: [6, 12]},
  pine:      {h: 12, b: [8, 20]},
  birch:     {h: 9, b: [6, 14]},
  bush:      {h: 1.3, b: [0.8, 2.0]},
};
const STRETCH = 0.2;

// размер по оси записи: 'h' → y, 'len' → max(x,z)
const dimOf = (sz, ax) => ax === 'h' ? sz.y : Math.max(sz.x, sz.z);
const inB = (v, b) => v >= b[0] - 1e-6 && v <= b[1] + 1e-6;

// Вызывается из model() сразу после выставления масштаба по o.h/o.len/o.s.
// inner — группа со scale; measure() — функция замера bbox обёртки.
export function fitReal(name, o, inner, measure) {
  const r = REAL[name];
  if (!r || o.keepSize || o.h === 1 || o.len === 1) return null; // единичная нормировка для инстансов: размер задаёт матрица
  const ax = r.h !== undefined ? 'h' : 'len', tgt = r[ax];
  let sz = measure().getSize(new V3());
  const v = dimOf(sz, ax);
  // допустимый множитель масштаба по основной оси
  let lo = r.b[0] / v, hi = r.b[1] / v, note = '';
  if (r.h2) { // и по вторичной высоте — если полосы пересекаются, обе выполняются без искажения
    const l2 = r.h2[0] / sz.y, h2 = r.h2[1] / sz.y;
    if (Math.max(lo, l2) <= Math.min(hi, h2)) { lo = Math.max(lo, l2); hi = Math.min(hi, h2) }
  }
  const k = (1 >= lo - 1e-9 && 1 <= hi + 1e-9) ? 1 : Math.min(Math.max(tgt / v, lo), hi); // замысел вызова, если он в полосе
  if (k !== 1) { inner.scale.multiplyScalar(k); sz = measure().getSize(new V3()) }
  if (r.h2 && !inB(sz.y, r.h2)) { // пропорция модели не даёт обе величины — тянем по Y не более ±STRETCH
    const want = Math.min(Math.max(sz.y, r.h2[0]), r.h2[1]);
    const ky = Math.min(Math.max(want / sz.y, 1 - STRETCH), 1 + STRETCH);
    inner.scale.y *= ky; note = 'Y×' + ky.toFixed(2);
  }
  return note;
}

// ---- журнал для ворот ----
export const LOG = {models: new Map(), placed: [], items: []};
export function logModel(name, w, note) {
  const r = REAL[name];
  if (!r || LOG.models.has(name)) return;
  LOG.models.set(name, {size: w.userData.size.clone(), note, sections: w.userData.sections || 1});
}

// Прямоугольник «пятна» модели: bbox вершин в нижних 0.5 м (без свесов крыши), в координатах обёртки.
export function baseRect(w, lowY = 0.5) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, n = 0;
  const v = new V3();
  w.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(w.matrixWorld).invert();
  const m2 = new THREE.Matrix4();
  w.traverse(m => {
    if (!m.isMesh || m.isSkinnedMesh || !m.visible) return;
    const pa = m.geometry.attributes.position; m2.multiplyMatrices(inv, m.matrixWorld);
    const step = Math.max(1, Math.floor(pa.count / 20000));
    for (let i = 0; i < pa.count; i += step) {
      v.fromBufferAttribute(pa, i).applyMatrix4(m2);
      if (v.y > lowY) continue;
      n++; if (v.x < x0) x0 = v.x; if (v.x > x1) x1 = v.x; if (v.z < z0) z0 = v.z; if (v.z > z1) z1 = v.z;
    }
  });
  if (n < 3) { const s = w.userData.size; return {x0: -s.x / 2, x1: s.x / 2, z0: -s.z / 2, z1: s.z / 2} }
  return {x0, x1, z0, z1};
}

// Точки пятна 3×3 в мире (угол поворота rot вокруг Y, как у three: x' = x c + z s, z' = -x s + z c)
export function footPts(x, z, rot, R) {
  const c = Math.cos(rot), s = Math.sin(rot), pts = [];
  for (const u of [R.x0, (R.x0 + R.x1) / 2, R.x1]) for (const t of [R.z0, (R.z0 + R.z1) / 2, R.z1])
    pts.push([x + u * c + t * s, z - u * s + t * c]);
  return pts;
}

let plinthMat = null;
// Посадка: возвращает {y, plinth(Mesh|null), gap}. y — высота низа модели.
// Здания: низ на (макс земли − 0.15), видимый зазор до минимума закрыт цоколем.
// Прочее: низ на минимум земли по пятну (ничего не висит, верхний край чуть утоплен).
export function groundFit(name, w, x, z, rot, terrainH, reg, dy = 0) {
  const R = baseRect(w);
  const hs = footPts(x, z, rot, R).map(p => terrainH(p[0], p[1]));
  const mn = Math.min(...hs), mx = Math.max(...hs);
  const bld = REAL[name] && REAL[name].bld;
  let y = mn, plinth = null;
  if (bld && mx - mn > 0.15) {
    y = mx - 0.15;
    if (!plinthMat) { plinthMat = new THREE.MeshStandardMaterial({color: 0x8c8882, roughness: .95}); reg && reg(plinthMat) }
    const ix = Math.max(0.25, (R.x1 - R.x0) * .04), iz = Math.max(0.25, (R.z1 - R.z0) * .04), wx = (R.x1 - R.x0) - 2 * ix, wz = (R.z1 - R.z0) - 2 * iz; // утоплен под стены: верх не торчит плитой
    const top = y + dy + 0.02, bot = mn - 0.4;
    plinth = new THREE.Mesh(new THREE.BoxGeometry(wx, top - bot, wz), plinthMat);
    const cx = (R.x0 + R.x1) / 2, cz = (R.z0 + R.z1) / 2, c = Math.cos(rot), s = Math.sin(rot);
    plinth.position.set(x + cx * c + cz * s, (top + bot) / 2, z - cx * s + cz * c);
    plinth.rotation.y = rot; plinth.castShadow = true; plinth.receiveShadow = true;
  }
  // зазор «низ модели – земля» по точкам пятна, не закрытый цоколем
  const gap = plinth ? 0 : Math.max(0, ...hs.map(h => y - h));
  return {y, plinth, gap, span: mx - mn, R};
}

// Предмет на земле: позиция и наклон по нормали склона
export function groundItem(g, x, z, terrainH, yaw) {
  const e = 0.4, hx = terrainH(x + e, z) - terrainH(x - e, z), hz = terrainH(x, z + e) - terrainH(x, z - e);
  const n = new V3(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), n);
  g.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), yaw));
  g.position.set(x, terrainH(x, z) - 0.03, z);
}

// Высота самой низкой вершины объекта над землёй под ней (для ворот «не висит»)
export function hoverOf(obj, terrainH) {
  obj.updateMatrixWorld(true);
  let best = 1e9; const v = new V3();
  obj.traverse(m => {
    if (!m.isMesh || !m.visible) return;
    const pa = m.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pa.count / 4000));
    for (let i = 0; i < pa.count; i += step) {
      v.fromBufferAttribute(pa, i).applyMatrix4(m.matrixWorld);
      const d = v.y - terrainH(v.x, v.z); if (d < best) best = d;
    }
  });
  return best;
}

let scheduled = false;
export function scheduleGates(terrainH) {
  if (scheduled) return; scheduled = true;
  setTimeout(() => runGates(terrainH), 0);
}
export function runGates(terrainH) {
  const out = [];
  const g = (n, v, b, ok) => out.push(`GATE ${n} ${v} ${b} ${ok ? 'OK' : 'FAIL'}`);
  for (const [name, m] of LOG.models) {
    const r = REAL[name], ax = r.h !== undefined ? 'h' : 'len', v = dimOf(m.size, ax);
    const one = ax === 'len' && m.sections > 1 ? v : v;
    g(`scale.${name}.${ax}`, one.toFixed(2) + 'm', `[${r.b[0]},${r.b[1]}]`, inB(one, r.b));
    if (r.h2) g(`scale.${name}.h2`, m.size.y.toFixed(2) + 'm' + (m.note ? '(' + m.note + ')' : ''), `[${r.h2[0]},${r.h2[1]}]`, inB(+m.size.y.toFixed(2), r.h2));
    if (r.len2 && m.sections > 1) { const L = Math.max(m.size.x, m.size.z); g(`scale.${name}.len`, L.toFixed(1) + 'm(×' + m.sections + ')', `[${r.len2[0]},${r.len2[1]}]`, inB(L, r.len2)) }
  }
  let worst = 0, wn = '-', pl = 0;
  LOG.placed.forEach(p => { if (p.plinth) pl++; if (p.gap > worst) { worst = p.gap; wn = p.name + '@' + p.x.toFixed(0) + ',' + p.z.toFixed(0) } });
  g('ground.maxGap', worst.toFixed(3) + 'm(' + wn + ',' + LOG.placed.length + 'obj,' + pl + 'plinth)', '[0,0.15]', worst <= 0.15);
  let iw = -1e9, iwn = '-', ilo = 1e9;
  LOG.items.forEach(it => { const h = hoverOf(it.g, terrainH); if (h < ilo) ilo = h; if (h > iw) { iw = h; iwn = it.id } });
  g('items.maxHover', iw.toFixed(3) + 'm(' + iwn + ',' + LOG.items.length + ')', '[-0.1,0.1]', iw <= 0.1 && iw >= -0.1);
  g('items.minHover', ilo.toFixed(3) + 'm', '[-0.1,0.1]', ilo >= -0.1);
  window.__gates = (window.__gates || []).concat(out);
  out.forEach(s => console.log(s));
}
