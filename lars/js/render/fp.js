// Игрок от первого лица: ходьба (WASD / стик), взгляд (мышь с захватом указателя / перетаскивание пальцем),
// бег, покачивание головы, столкновения (машины, дома, лотки, люди, скалы, Терек), посадка в свою машину и вид
// из салона, прицел → подсказка «кто это» → E / кнопка открывает то же меню действий, что и на карте.
'use strict';
L.def('render/fp', () => {
const { clamp, $ } = L.use('core');
const { LANE_OFF } = L.use('sim/world');
const { ic } = L.use('ui/icons');
const { esc } = L.use('ui/dom');

const WALK = 2.1, RUN = 5.2, EYE = 1.62, R = 0.32;

class FP {
  constructor(game, view, canvas) {
    this.G = game; this.v = view; this.cv = canvas;
    this.yaw = 0; this.pitch = -0.04; this.bob = 0; this.speed = 0; this.vy = 0; this.eyeY = null;
    this.look = null; this.stick = null; this.run = false; this.target = null; this.lookSens = 0.0023;
    this.touch = matchMedia('(pointer: coarse)').matches;
    this.mount();
    const w = game.w, p = w.player;
    this.syncFromCar(true);
  }
  mount() {
    const el = document.createElement('div'); el.id = 'fp'; el.className = 'fp';
    el.innerHTML = `<div class="xh"></div>
      <div class="plate fpp" id="fp-prompt" hidden><span id="fp-ic"></span><b id="fp-nm"></b><kbd>E</kbd></div>
      <div class="fph" id="fp-hint" hidden>${ic('eye', 's')}клик — осмотреться</div>
      <div class="plate fpc" id="fp-car" hidden>${ic('car', 's')}<i id="fp-arr">${ic('up', 's')}</i><b id="fp-cd" class="num"></b></div>
      <div class="stick" id="fp-stick"><i></i></div>
      <div class="tbs" id="fp-tbs">
        <button class="btn tb" id="fp-act" title="Действие (E)">${ic('hands')}</button>
        <button class="btn tb" id="fp-carb" title="Сесть / выйти (F)">${ic('car')}</button>
        <button class="btn tb" id="fp-run" title="Бег (Shift)">${ic('walk')}</button>
        <button class="btn tb" id="fp-lamp" title="Фонарик (L)">${ic('bolt')}</button>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
    const cv = this.cv;
    cv.addEventListener('click', () => { if (!this.touch && !this.G.menuOpen() && document.pointerLockElement !== cv) cv.requestPointerLock?.(); });
    document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement === cv) this.hintOff = true; this.hint(); });
    addEventListener('mousemove', e => {
      if (document.pointerLockElement === cv) { this.turn(e.movementX, e.movementY); }
    });
    // перетаскивание: мышь без захвата / палец (правая часть экрана — взгляд, левая — стик)
    cv.addEventListener('pointerdown', e => {
      if (this.G.mode !== '3d') return;
      const left = this.touch && e.clientX < innerWidth * 0.45;
      if (left && !this.stick) { this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: 0, y: 0 }; this.drawStick(); }
      else if (!this.look && (this.touch || document.pointerLockElement !== cv)) this.look = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
      cv.setPointerCapture?.(e.pointerId);
    });
    cv.addEventListener('pointermove', e => {
      if (this.stick && e.pointerId === this.stick.id) { this.stick.x = clamp((e.clientX - this.stick.x0) / 50, -1, 1); this.stick.y = clamp((e.clientY - this.stick.y0) / 50, -1, 1); this.drawStick(); }
      else if (this.look && e.pointerId === this.look.id) { const dx = e.clientX - this.look.x, dy = e.clientY - this.look.y; this.look.moved += Math.abs(dx) + Math.abs(dy); this.turn(dx * (this.touch ? 1.5 : 1.2), dy * (this.touch ? 1.5 : 1.2)); this.look.x = e.clientX; this.look.y = e.clientY; }
    });
    const up = e => {
      if (this.stick && e.pointerId === this.stick.id) { this.stick = null; this.drawStick(); }
      if (this.look && e.pointerId === this.look.id) { const L2 = this.look; this.look = null; if (this.touch && L2.moved < 12 && performance.now() - L2.t < 350) this.interact(); }
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    const tap = (id, f) => { const b = $(id); b.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); f(); }); };
    tap('fp-act', () => this.interact());
    tap('fp-carb', () => this.toggleCar());
    tap('fp-run', () => { this.run = !this.run; $('fp-run').classList.toggle('on', this.run); });
    tap('fp-lamp', () => this.toggleLamp());
    this.hint();
  }
  hint() { const h = $('fp-hint'); if (h) h.hidden = this.hintOff || this.touch || document.pointerLockElement === this.cv || this.G.mode !== '3d' || this.G.menuOpen(); }
  drawStick() {
    const s = $('fp-stick'); if (!s) return;
    s.classList.toggle('on', !!this.stick);
    if (this.stick) { s.style.left = (this.stick.x0 - 50) + 'px'; s.style.top = (this.stick.y0 - 50) + 'px'; s.firstChild.style.transform = `translate(${this.stick.x * 32}px, ${this.stick.y * 32}px)`; }
    else { s.style.left = ''; s.style.top = ''; s.firstChild.style.transform = ''; }
  }
  turn(dx, dy) {
    this.yaw += dx * this.lookSens; this.pitch = clamp(this.pitch - dy * this.lookSens, -1.35, 1.35);
  }
  show(on) { this.el.hidden = !on; if (!on && document.pointerLockElement === this.cv) document.exitPointerLock?.(); this.hint(); }
  // вид: в машине — с места водителя
  syncFromCar(face) {
    const w = this.G.w, pc = w.pcar; if (!pc) return;
    const q = w.road.at(pc.s, LANE_OFF[pc.lane] ?? 0), fx = -q.ny, fz = q.nx;
    if (face) { this.yaw = Math.atan2(fx, -fz); this.pitch = -0.06; }
  }
  toggleLamp() { this.v.flash = !this.v.flash; $('fp-lamp').classList.toggle('on', this.v.flash); this.G.toast({ icon: 'bolt', text: this.v.flash ? 'Фонарик' : 'Фонарик выкл.' }); }
  toggleCar() {
    const G = this.G, w = G.w, p = w.player, pc = w.pcar; if (!pc) return;
    if (p.inCar) { this.leave(); return; }
    const pose = this.v.pcarPose, d = pose ? Math.hypot(pose.x - p.x, pose.z - p.y) : 1e9;
    if (d < 4.5) { w.enterCar(); if (p.sleeping) return; this.syncFromCar(true); G.toast({ icon: 'car', text: 'В машине' }); }
    else G.toast({ icon: 'car', text: 'Машина в ' + Math.round(d) + ' м', tone: -1 });
  }
  leave() {
    const w = this.G.w, p = w.player, pc = w.pcar; if (!pc) return;
    if (p.sleeping) w.wake('Проснулся');
    const pose = this.v.pcarPose;
    const s = pose ? pose.vs ?? pc.s : pc.s, lane = LANE_OFF[pc.lane] ?? 0;
    // водительская дверь — слева по ходу (на восток от оси), дальше в сторону обочины, если занято
    const q = w.road.at(s, lane + 1.75);
    p.inCar = false; p.x = q.x; p.y = q.y; p.tx = p.ty = null;
    this.eyeY = null;
  }
  interact() {
    const G = this.G; if (G.menuOpen()) return;
    const t = this.target;
    if (!t) { if (G.w.player.inCar) G.openMenu({ kind: 'own', car: G.w.pcar }); return; }
    if (t.tg.kind === 'own' && !G.w.player.inCar && t.dist < 4.5) { this.toggleCar(); return; }
    if (document.pointerLockElement === this.cv) document.exitPointerLock?.();
    G.openMenu(t.tg);
  }
  key(e) {
    const k = e.code;
    if (k === 'KeyE') { this.interact(); return true; }
    if (k === 'KeyF') { this.toggleCar(); return true; }
    if (k === 'KeyL') { this.toggleLamp(); return true; }
    return false;
  }
  update(dt) {
    const G = this.G, w = G.w, p = w.player, v = this.v, keys = G.input.keys, cam = v.cam, busy = G.menuOpen();
    if (busy && document.pointerLockElement === this.cv) document.exitPointerLock?.();
    this.hint();
    v.inCarView = !!(p.inCar && w.pcar);
    if (v.inCarView) {
      const pose = v.pcarPose;
      if (pose) {
        // черновая камера для прицела; точную (по позе машины этого же кадра) ставит view3d.draw — без тряски торпедо
        v.carCam(pose, p.sleeping);
        if (p.sleeping) { this.pitch += (-0.35 - this.pitch) * Math.min(1, dt * 2); }
      } else { const q = w.road.at(w.pcar.s, LANE_OFF[w.pcar.lane]); cam.x = q.x; cam.z = q.y; cam.y = v.T.roadH(w.pcar.s) + 1.2; }
      this.speed = 0; this.eyeY = null;
      if (!busy && !p.sleeping && (keys.has('KeyW') || keys.has('KeyS') || keys.has('KeyA') || keys.has('KeyD')) && this.tryLeaveHint !== true) { this.tryLeaveHint = true; G.toast({ icon: 'walk', text: 'Выйти — F' }); }
    } else {
      // движение
      let mx = 0, mz = 0;
      if (!busy) {
        if (keys.has('KeyW') || keys.has('ArrowUp')) mz += 1; if (keys.has('KeyS') || keys.has('ArrowDown')) mz -= 1;
        if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1; if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
        if (this.stick) { mx += this.stick.x; mz -= this.stick.y; }
        if (keys.has('ArrowLeft') && !keys.has('KeyA')) { mx += 1; this.yaw -= dt * 1.8; } // стрелки — поворот
        if (keys.has('ArrowRight') && !keys.has('KeyD')) { mx -= 1; this.yaw += dt * 1.8; }
      }
      const l = Math.hypot(mx, mz);
      const running = this.run || keys.has('ShiftLeft') || keys.has('ShiftRight') || (this.stick && Math.hypot(this.stick.x, this.stick.y) > 0.95);
      const sp = l > 0.05 ? (running ? RUN : WALK) * Math.min(1, l) : 0;
      this.speed += (sp - this.speed) * Math.min(1, dt * 8);
      if (l > 0.05) {
        if (p.tx != null) { p.tx = p.ty = null; p.then = null; }
        if (p.sleeping) w.wake('Проснулся');
        const fx = Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = Math.sin(this.yaw);
        const dx = (fx * mz + rx * mx) / l * this.speed * dt, dz = (fz * mz + rz * mx) / l * this.speed * dt;
        this.moveTo(p.x + dx, p.y + dz);
      } else this.moveTo(p.x, p.y);
      // глаза: земля + рост + покачивание
      const g = v.T.ground(p.x, p.y, v.sCam), roadU = Math.abs(g.u), onRoad = roadU < 8.6;
      const gy = onRoad ? Math.max(g.h, v.T.roadH(v.T.sOf(g.i)) + (roadU < 4.3 ? 0.08 : roadU < 6.9 ? 0.02 : -0.3 * (roadU - 6.9) / 1.7)) : g.h;
      this.bob += this.speed * dt * 2.3;
      const by = Math.sin(this.bob * 2) * 0.035 * Math.min(1, this.speed / 2), target = gy + EYE + by;
      this.eyeY = this.eyeY == null ? target : this.eyeY + (target - this.eyeY) * Math.min(1, dt * 12);
      cam.x = p.x; cam.z = p.y; cam.y = this.eyeY;
    }
    cam.yaw = this.yaw; cam.pitch = this.pitch; cam.roll = v.inCarView ? 0 : Math.sin(this.bob) * 0.006 * Math.min(1, this.speed / 2);
    // прицел
    this.target = busy ? null : v.pick(v.inCarView ? 10 : 5.5);
    this.prompt();
    this.carMarker();
  }
  // шаг с проверкой: препятствия (v.collide — машины, дома, лотки), затем «можно ли тут стоять» — одна
  // проверка на реку/мосты/склоны/КПП/хвост (road.walkable), общая с авто-подходом и кликом по карте
  // (audit 3-spatial.md, причина 1). Если игрок уже стоит не там (ловушка — finding 9), не блокируем шаг: даём
  // уйти в любую сторону, а гейт снова включается, как только текущая точка опять проходима.
  moveTo(nx, nz) {
    const w = this.G.w, p = w.player, v = this.v, road = w.road;
    let [x, z] = v.collide(nx, nz, R);
    if (road.walkable(p.x, p.y) && !road.walkable(x, z)) { // скользим вдоль осей — как раньше
      if (road.walkable(x, p.y)) z = p.y; else if (road.walkable(p.x, z)) x = p.x; else { x = p.x; z = p.y; }
    }
    p.x = x; p.y = z;
  }
  prompt() {
    const t = this.target, el = $('fp-prompt');
    if (!t || this.G.mode !== '3d') { el.hidden = true; $('fp-act').classList.remove('acc'); return; }
    el.hidden = false; $('fp-act').classList.add('acc');
    const own = t.tg.kind === 'own' && !this.G.w.player.inCar;
    const key = t.name + (own ? '1' : '0');
    if (this.lastKey !== key) { this.lastKey = key; $('fp-ic').innerHTML = ic(own ? 'door' : t.icon || 'user'); $('fp-nm').textContent = own ? 'Сесть в машину' : t.name; }
  }
  // стрелка к своей машине, когда вышел
  carMarker() {
    const w = this.G.w, p = w.player, el = $('fp-car'), pose = this.v.pcarPose;
    if (p.inCar || !pose) { el.hidden = true; return; }
    const dx = pose.x - p.x, dz = pose.z - p.y, d = Math.hypot(dx, dz);
    if (d < 6) { el.hidden = true; return; }
    el.hidden = false;
    const a = Math.atan2(dx, -dz) - this.yaw;
    $('fp-arr').style.transform = `rotate(${a}rad)`;
    $('fp-cd').textContent = d > 1000 ? (d / 1000).toFixed(1).replace('.', ',') + ' км' : Math.round(d) + ' м';
    el.classList.toggle('warn', d > w.T.player.leaveCar * 0.8);
  }
}
return { FP };
});
