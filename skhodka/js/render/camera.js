// Камера зала: вид сверху-сбоку вдоль длинной стены (от витрины вглубь), мягко следует за игроком.
// Мышь: тянуть левой — сдвиг по залу, правой (или с Shift) — поворот/наклон, колесо — масштаб.
// Палец: один — сдвиг, два — щипок (масштаб) + поворот. Ограничения мягкие: во время жеста можно чуть
// выйти за край, после отпускания цель плавно возвращается в пределы. dragged — «это был жест, не клик».
// focus(p) — наезд на разговор и возврат; peek(p) — на 2–3 с показать место события (не в разговоре); free(…) — точный отладочный ракурс (dev/scene.html, скриншоты).
// Ракурс разговора подбирается с проверкой видимости: из набора углов (поворот × наклон) берётся тот, откуда
// лучи к голове и груди собеседника и игрока не упираются в людей, мебель, стены; камера — в зале (для веранды —
// снаружи), не за стеклом фасада. Пока идёт разговор, раз в секунду ракурс перепроверяется (с запасом, без
// рысканья), если игрок сам не двигал камеру. Кадр сдвигается (setViewOffset), чтобы пара была в свободной от
// панелей полосе экрана (band — доли высоты сверху/снизу; ставит интерфейс, иначе — по форме экрана).
'use strict';
L.def('render/camera', () => {
const { clamp, lerp } = L.use('core');
const { LAYOUT } = L.use('content/layout');

// пределы: цель (x,z) в зале/на веранде, дистанция, наклон (рад от горизонта), поворот от оси зала
const LIM = { x0: 0.5, x1: LAYOUT.size.w - 0.5, z0: -4.5, z1: LAYOUT.size.d - 0.5, d0: 3.2, d1: 24, p0: 0.32, p1: 1.42, y0: -1.7, y1: 1.7 };
const HOME = { x: 4.9, z: LAYOUT.size.d / 2 - 0.2, yaw: 0.12, pitch: 1.0, dist: 14 };

// ── проверка видимости: препятствия из плана зала (коробки [x0,z0,x1,z1,y0,y1]) + люди из sight() ──
const Hh = LAYOUT.size.h;
const HALL = LAYOUT.hall || LAYOUT.walls.map(w => w.a);
let BOXES = null;
function boxes() {
  if (BOXES) return BOXES;
  const B = [], th = 0.06;
  for (const w of LAYOUT.walls) {
    if (w.kind === 'door') continue;
    const x0 = Math.min(w.a[0], w.b[0]), x1 = Math.max(w.a[0], w.b[0]), z0 = Math.min(w.a[1], w.b[1]), z1 = Math.max(w.a[1], w.b[1]);
    B.push([x0 - th, z0 - th, x1 + th, z1 + th, 0, w.kind === 'glass' ? 2.75 : Hh]);   // стекло витрины — с рамами, как стена
  }
  for (const b of LAYOUT.blocks) {
    const [x0, z0, x1, z1] = b.rect;
    if (b.kind === 'counter') B.push([x0, z0, x1, z1, 0, 1.15]);
    else if (b.kind === 'backbar') B.push([x0, z0, x1, z1, 0, 1.1]);
    else if (b.kind === 'stage') B.push([x0, z0, x1, z1, 0, 0.25]);
    else if (b.kind === 'column' && b.id !== 'lamp-post') B.push([x0, z0, x1, z1, 0, Hh]);
    else if (b.kind === 'speaker') B.push([x0, z0, x1, z1, 1.2, 1.85]);
    else if (b.kind === 'plant') { const k = (x1 - x0) * 0.2; B.push([x0 + k, z0 + k, x1 - k, z1 - k, 0, (z0 + z1) / 2 > 0 ? 1.9 : b.id.startsWith('thuja') ? 1.8 : 0.9]); }
    else if (b.kind === 'sofa') {
      B.push([x0, z0, x1, z1, 0, 0.5]);
      // спинка — со стороны ближней стены
      const alongZ = z1 - z0 > x1 - x0;
      const onWall = x => LAYOUT.walls.some(w => w.a[0] === w.b[0] && Math.abs(w.a[0] - x) < 0.05);
      if (alongZ) { const bx = onWall(x0) ? x0 : x1 - 0.18; B.push([bx, z0, bx + 0.18, z1, 0, 0.98]); }
      else B.push([x0, z0 < 0.2 ? z0 : z1 - 0.18, x1, (z0 < 0.2 ? z0 : z1 - 0.18) + 0.18, 0, 0.98]);
    }
  }
  for (const t of LAYOUT.tables) {
    if (t.top === 'bar') { for (const s of t.seats) B.push([s.x - 0.2, s.z - 0.2, s.x + 0.2, s.z + 0.2, 0, 0.8]); continue; }
    const h = t.top === 'terrace' ? 0.72 : 0.75;
    B.push([t.x - t.w / 2, t.z - t.d / 2, t.x + t.w / 2, t.z + t.d / 2, h - 0.1, h + 0.03]);
    for (const s of t.seats) {
      if (s.kind === 'armchair') B.push([s.x - 0.28, s.z - 0.28, s.x + 0.28, s.z + 0.28, 0, 0.84]);
      else if (s.kind === 'chair') B.push([s.x - 0.22, s.z - 0.22, s.x + 0.22, s.z + 0.22, 0, 0.95]);
    }
  }
  return (BOXES = B);
}
// отрезок o→t (3D) пересекает коробку? (метод пластин)
function hitBox(o, t, b) {
  let t0 = 0, t1 = 1;
  for (let a = 0; a < 3; a++) {
    const lo = a === 0 ? b[0] : a === 1 ? b[4] : b[1], hi = a === 0 ? b[2] : a === 1 ? b[5] : b[3], d = t[a] - o[a];
    if (Math.abs(d) < 1e-9) { if (o[a] < lo || o[a] > hi) return false; continue; }
    let u = (lo - o[a]) / d, v = (hi - o[a]) / d; if (u > v) { const w = u; u = v; v = w; }
    if (u > t0) t0 = u; if (v < t1) t1 = v; if (t0 > t1) return false;
  }
  return t1 > 0 && t0 < 0.985;
}
const inside = (p, b, m = 0.04) => p[0] > b[0] - m && p[0] < b[2] + m && p[2] > b[1] - m && p[2] < b[3] + m && p[1] > b[4] - m && p[1] < b[5] + m;
// доля видимых точек (голова, грудь) у собеседника (вес 2) и игрока (вес 1)
function sight(c, S) {
  const st = boxes(), o = [c.x, c.y, c.z];
  const pb = q => [q.x - q.r, q.z - q.r, q.x + q.r, q.z + q.r, 0, q.top];
  const ppl = [...S.blockers, { ...S.a, r: 0.2 }, { ...S.b, r: 0.2 }].map(pb);
  const own = [ppl.length - 2, ppl.length - 1];
  let sum = 0, W = 0;
  [[S.a, 2, own[0]], [S.b, 1, own[1]]].forEach(([q, w, me]) => {
    for (const [dy, k] of [[0.14, 0.6], [0.5, 0.4]]) {
      const t = [q.x, q.top - dy, q.z];
      let ok = true;
      for (const b of st) if (!inside(t, b) && hitBox(o, t, b)) { ok = false; break; }
      if (ok) for (let i = 0; i < ppl.length; i++) if (i !== me && !inside(t, ppl[i], 0) && hitBox(o, t, ppl[i])) { ok = false; break; }
      sum += ok ? w * k : 0; W += w * k;
    }
  });
  return sum / W;
}
function inPoly(x, z, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
const camPos = (x, z, yaw, pitch, dist) => ({ x: x - Math.sin(yaw) * Math.cos(pitch) * dist, y: 0.8 + Math.sin(pitch) * dist, z: z - Math.cos(yaw) * Math.cos(pitch) * dist });
// камера разговора: в зале (не за стеной, не за стеклом, не в служебной зоне за стойкой) с запасом 0.3 м; для веранды — снаружи перед фасадом
function camOk(c, out) {
  if (out) return c.z < -0.3 && c.z > -9 && c.x > -1.5 && c.x < LAYOUT.size.w + 1.5;
  const m = 0.3;
  for (const [dx, dz] of [[0, 0], [m, 0], [-m, 0], [0, m], [0, -m]]) if (!inPoly(c.x + dx, c.z + dz, HALL)) return false;
  return !STAFF.some(P => inPoly(c.x, c.z, P));
}
const STAFF = LAYOUT.blocks.filter(b => b.kind === 'staff' && b.poly).map(b => b.poly);
const angDiff = (a, b) => { let d = (a - b) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };
// насколько собеседник повернут лицом к камере: −1..1
const facing = (a, c) => { const dx = c.x - a.x, dz = c.z - a.z, l = Math.hypot(dx, dz) || 1; return (Math.sin(a.rot) * dx + Math.cos(a.rot) * dz) / l; };

class CamCtl {
  constructor(camera, dom) {
    this.cam = camera; this.dom = dom;
    this.goal = { ...HOME }; this.cur = { ...HOME };
    this.saved = null; this.anchor = null; this.userT = 99; this.fixed = null;
    this.dragged = false; this.active = false;
    this.ptr = new Map(); this.attach();
  }
  // ── ввод ──
  attach() {
    const d = this.dom;
    if (!d || !d.addEventListener) return;
    d.style.touchAction = 'none';
    d.addEventListener('contextmenu', e => e.preventDefault());
    d.addEventListener('pointerdown', e => {
      this.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, sh: e.shiftKey });
      this.move = 0; this.dragged = false; this.active = true;
      try { d.setPointerCapture(e.pointerId); } catch (_) {}
    });
    d.addEventListener('pointermove', e => {
      const p = this.ptr.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (this.ptr.size === 1) {
        this.move += Math.abs(dx) + Math.abs(dy);
        if (this.move > 6) { this.dragged = true; this.userT = 0; }
        if (this.dragged) { if (p.b === 2 || p.sh || e.shiftKey) this.rotate(dx, dy); else this.pan(dx, dy); }
      } else if (this.ptr.size === 2) {
        const [a, b] = [...this.ptr.values()], o = a === p ? b : a;
        const d0 = Math.hypot(p.x - o.x, p.y - o.y), d1 = Math.hypot(e.clientX - o.x, e.clientY - o.y);
        const a0 = Math.atan2(p.y - o.y, p.x - o.x), a1 = Math.atan2(e.clientY - o.y, e.clientX - o.x);
        if (d1 > 1) this.zoom(d0 / d1);
        let da = a1 - a0; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
        this.goal.yaw += da * 0.5; this.goal.pitch = clamp(this.goal.pitch + dy * 0.002, LIM.p0 - 0.1, LIM.p1);
        this.dragged = true; this.userT = 0;
      }
      p.x = e.clientX; p.y = e.clientY;
    });
    const up = e => { this.ptr.delete(e.pointerId); if (!this.ptr.size) { this.active = false; this.settle(); } };
    d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up);
    d.addEventListener('wheel', e => { e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.0012)); this.userT = 0; clearTimeout(this.wt); this.wt = setTimeout(() => this.settle(), 250); }, { passive: false });
  }
  pan(dx, dy) {
    // «тащим пол»: вправо по экрану — зал едет вправо, вверх — камера отходит назад
    const g = this.goal, k = g.dist * 0.0016, s = Math.sin(g.yaw), c = Math.cos(g.yaw);
    g.x += (c * dx + s * dy * 1.4) * k; g.z += (-s * dx + c * dy * 1.4) * k;
    this.soft();
  }
  rotate(dx, dy) { const g = this.goal; g.yaw -= dx * 0.005; g.pitch = clamp(g.pitch + dy * 0.004, LIM.p0 - 0.1, LIM.p1 + 0.05); this.soft(); }
  zoom(f) { const g = this.goal; g.dist = clamp(g.dist * f, LIM.d0 * 0.85, LIM.d1 * 1.1); }
  // мягкий край во время жеста (можно заступить на 1 м / 0.25 рад)
  soft() { const g = this.goal; g.x = clamp(g.x, LIM.x0 - 1, LIM.x1 + 1); g.z = clamp(g.z, LIM.z0 - 1, LIM.z1 + 1); if (!this.saved) g.yaw = clamp(g.yaw, LIM.y0 - 0.25, LIM.y1 + 0.25); }
  // после жеста — строго в пределы (текущее положение доплывёт само)
  settle() { const g = this.goal; g.x = clamp(g.x, LIM.x0, LIM.x1); g.z = clamp(g.z, LIM.z0, LIM.z1); if (!this.saved) g.yaw = clamp(g.yaw, LIM.y0, LIM.y1); g.pitch = clamp(g.pitch, LIM.p0, LIM.p1); g.dist = clamp(g.dist, LIM.d0, LIM.d1); }
  // ── управление из игры ──
  follow(p) { this.anchor = p ? { x: p.x, z: p.z } : null; }
  focus(p) {
    if (p) {
      if (this.peekSaved) this.endPeek(true);   // показ события прерывается разговором
      if (!this.saved) this.saved = { ...this.goal };
      this.focusP = p; this.focusAge = 0; this.recheckT = 0.6;
      const v = this.choose(p, true);
      Object.assign(this.goal, { x: v.x, z: v.z, pitch: v.pitch, dist: v.dist, yaw: v.yaw });
      this.settle();
    } else {
      this.focusP = null; this.lastVis = null;
      if (this.saved) { Object.assign(this.goal, this.saved); this.saved = null; }
    }
  }
  // ── подбор ракурса разговора ──
  // p: { x, z, sight?() → { a, b, blockers[] } }  a/b — { x, z, top, rot } собеседник и игрок, blockers — { x, z, r, top }
  choose(p, fresh) {
    const S = p.sight ? p.sight() : null;
    const cx = S ? (S.a.x + S.b.x) / 2 : p.x, cz = S ? (S.a.z + S.b.z) / 2 : p.z;
    const out = cz < -0.2;   // веранда: камера снаружи
    const dist = this.cam.aspect < 1 ? 5.6 : 6.5, cur = this.goal;   // телефон вертикально: угол шире — ближе
    const yaws = [cur.yaw, HOME.yaw];
    for (let i = -8; i < 8; i++) yaws.push(i * Math.PI / 8 + 0.06);
    let best = null;
    for (const pitch of [0.72, 0.92, 1.15]) for (const yaw of yaws) {
      const c = camPos(cx, cz, yaw, pitch, dist);
      if (!camOk(c, out)) continue;
      const vis = S ? sight(c, S) : 1;
      let sc = vis * 4 - Math.abs(angDiff(yaw, fresh ? cur.yaw : this.goal.yaw)) * 0.35 - (pitch - 0.72) * 0.8;
      if (S && S.a.rot != null) sc += 0.35 * facing(S.a, c);
      if (!best || sc > best.sc) best = { x: cx, z: cz, yaw, pitch, dist, vis, sc };
    }
    // ни одного ракурса в зале (не должно случаться) — прежняя логика: сверху круто
    if (!best) best = { x: cx, z: cz, yaw: cur.yaw, pitch: LIM.p1, dist, vis: 0, sc: 0 };
    this.lastVis = +best.vis.toFixed(2);
    return best;
  }
  // во время разговора: если текущий ракурс заметно хуже лучшего — переехать (запас против рысканья)
  recheck() {
    const p = this.focusP, S = p.sight ? p.sight() : null; if (!S) return;
    const g = this.goal, c = camPos(g.x, g.z, g.yaw, g.pitch, g.dist), now = sight(c, S);
    this.lastVis = +now.toFixed(2);
    if (now >= 0.85) return;
    const v = this.choose(p, false);
    if (v.vis > now + 0.2) Object.assign(this.goal, { x: v.x, z: v.z, pitch: v.pitch, dist: v.dist, yaw: v.yaw });
    else this.lastVis = +now.toFixed(2);
  }
  // короткий показ места события (караоке, саксофон): 2–3 с на точку и обратно; в разговоре — не мешаем
  peek(p, sec = 2.8) {
    if (!p || this.saved || this.fixed || this.active) return false;
    if (!this.peekSaved) this.peekSaved = { ...this.goal };
    this.peekT = sec; this.peekAge = 0;
    Object.assign(this.goal, { x: p.x, z: p.z - 0.4, dist: Math.min(this.goal.dist, 9.5), pitch: 0.85 });
    this.settle();
    return true;
  }
  endPeek(restore) { if (restore && this.peekSaved) Object.assign(this.goal, this.peekSaved); this.peekSaved = null; this.peekT = 0; }
  home() { Object.assign(this.goal, HOME); this.saved = null; this.focusP = null; this.endPeek(false); }
  free(v) { this.fixed = v; }   // { pos:[x,y,z], look:[x,y,z], fov } | null
  update(dt) {
    const cam = this.cam;
    if (this.fixed) {
      const f = this.fixed; if (cam.view && cam.view.enabled) { cam.clearViewOffset(); this.oy = this.ox = 0; }
      cam.position.set(...f.pos); cam.lookAt(...f.look);
      if (f.fov && cam.fov !== f.fov) { cam.fov = f.fov; cam.updateProjectionMatrix(); }
      return;
    }
    // телефон вертикально: шире угол по вертикали, чтобы зал (10 м поперёк) влезал по ширине
    const fov = cam.aspect < 1 ? Math.min(74, 50 + (1 - cam.aspect) * 44) : 50;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    this.userT += dt;
    if (this.peekSaved) {
      this.peekAge += dt; this.peekT -= dt;
      // игрок сам взял камеру — показ отменяется без возврата; время вышло — назад к игроку
      if (this.userT < this.peekAge) this.endPeek(false); else if (this.peekT <= 0) this.endPeek(true);
    }
    if (this.focusP) {
      this.focusAge += dt;
      // перепроверка ракурса — только пока игрок сам не трогал камеру с начала разговора
      if ((this.recheckT -= dt) <= 0) { this.recheckT = 1; if (this.userT >= this.focusAge && !this.active) this.recheck(); }
    }
    // сдвиг кадра: пара — посередине свободной от панелей полосы
    const band = this.band || (cam.aspect < 1 ? [0.07, 0.52, 0, 1] : [0.08, 0.66, 0, 1]), on = !!this.focusP;
    const oyGoal = on ? clamp(0.5 - (band[0] + band[1]) / 2, 0, 0.3) : 0, oxGoal = on ? clamp(0.5 - ((band[2] ?? 0) + (band[3] ?? 1)) / 2, 0, 0.2) : 0;
    const kv = 1 - Math.exp(-dt * 5);
    this.oy = lerp(this.oy || 0, oyGoal, kv); this.ox = lerp(this.ox || 0, oxGoal, kv);
    if (Math.abs(this.oy) + Math.abs(this.ox) < 1e-3 && !on) { if (cam.view && cam.view.enabled) cam.clearViewOffset(); }
    else cam.setViewOffset(1, 1, this.ox, this.oy, 1, 1);
    // следование: пока игрок не трогал камеру 4 с и нет наезда — цель тянется к игроку (наполовину, чтобы зал оставался в кадре)
    if (this.anchor && !this.saved && !this.peekSaved && this.userT > 4 && !this.active) {
      const g = this.goal, k = 1 - Math.exp(-dt * 0.8);
      g.x = lerp(g.x, clamp(lerp(HOME.x, this.anchor.x, 0.55), LIM.x0, LIM.x1), k);
      // телефон вертикально: кадр выше по залу — иначе треть экрана занимает улица перед витриной
      const dz = this.cam.aspect < 1 ? 2 : 0;
      g.z = lerp(g.z, clamp(lerp(HOME.z, this.anchor.z, 0.6) - 0.5 + dz, LIM.z0, LIM.z1), k);
    }
    const c = this.cur, g = this.goal, k = 1 - Math.exp(-dt * 7);
    for (const key of ['x', 'z', 'yaw', 'pitch', 'dist']) c[key] = lerp(c[key], g[key], k);
    const cp = Math.cos(c.pitch);
    cam.position.set(c.x - Math.sin(c.yaw) * cp * c.dist, 0.8 + Math.sin(c.pitch) * c.dist, c.z - Math.cos(c.yaw) * cp * c.dist);
    cam.lookAt(c.x, 0.8, c.z);
  }
}
return { CamCtl, HOME, LIM, sightOf: sight, camPos };
});
