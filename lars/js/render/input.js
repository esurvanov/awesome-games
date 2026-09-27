// Ввод: мышь (перетаскивание, колесо), тач (один палец — сдвиг, два — щипок), клавиатура.
// Короткий тап/клик без сдвига — выбор (onTap(sx, sy)).
'use strict';
L.def('render/input', () => {
class Input {
  constructor(canvas, view, { onTap, onKey }) {
    this.cv = canvas; this.v = view; this.onTap = onTap; this.onKey = onKey;
    this.pts = new Map(); this.drag = null; this.pinch = null; this.vel = { x: 0, y: 0 }; this.keys = new Set();
    this.follow = true; // камера следует за игроком, пока её не сдвинули
    canvas.addEventListener('pointerdown', e => this.down(e));
    addEventListener('pointermove', e => this.move(e));
    addEventListener('pointerup', e => this.up(e));
    addEventListener('pointercancel', e => { this.pts.delete(e.pointerId); this.drag = this.pinch = null; });
    canvas.addEventListener('wheel', e => { e.preventDefault(); const k = Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)); this.v.setZoom(this.v.cam.z * k, e.offsetX, e.offsetY); }, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('keydown', e => { if (e.target.closest && e.target.closest('input,textarea')) return; this.keys.add(e.code); if (this.onKey && this.onKey(e)) e.preventDefault(); });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }
  local(e) { const b = this.cv.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; }
  down(e) {
    this.cv.setPointerCapture?.(e.pointerId);
    const p = this.local(e); this.pts.set(e.pointerId, p); this.vel.x = this.vel.y = 0;
    if (this.pts.size === 1) this.drag = { x: p.x, y: p.y, x0: p.x, y0: p.y, moved: false, t: performance.now() };
    if (this.pts.size === 2) {
      const [a, b] = [...this.pts.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: this.v.cam.z, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      if (this.drag) this.drag.moved = true;
    }
  }
  move(e) {
    if (!this.pts.has(e.pointerId)) return;
    const p = this.local(e); this.pts.set(e.pointerId, p);
    const c = this.v.cam;
    if (this.pinch && this.pts.size >= 2) {
      const [a, b] = [...this.pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.v.setZoom(this.pinch.z * d / this.pinch.d, mx, my);
      c.x -= (mx - this.pinch.mx) / c.z; c.y -= (my - this.pinch.my) / c.z; this.pinch.mx = mx; this.pinch.my = my;
      this.v.clampCam(); this.follow = false; return;
    }
    const d = this.drag; if (!d) return;
    const dx = p.x - d.x, dy = p.y - d.y;
    if (!d.moved && Math.hypot(p.x - d.x0, p.y - d.y0) > 6) d.moved = true;
    if (d.moved) { c.x -= dx / c.z; c.y -= dy / c.z; this.vel.x = dx; this.vel.y = dy; this.v.clampCam(); this.follow = false; }
    d.x = p.x; d.y = p.y;
  }
  up(e) {
    if (!this.pts.has(e.pointerId)) return;
    this.pts.delete(e.pointerId);
    if (this.pinch) { if (this.pts.size < 2) this.pinch = null; if (!this.pts.size) this.drag = null; return; }
    const d = this.drag; this.drag = null;
    if (d && !d.moved && performance.now() - d.t < 600 && this.onTap) this.onTap(d.x0, d.y0);
  }
  // плавность: инерция и клавиши
  update(dt) {
    const c = this.v.cam, k = this.keys, sp = 600 / c.z * dt;
    let mx = 0, my = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx--; if (k.has('KeyD') || k.has('ArrowRight')) mx++;
    if (k.has('KeyW') || k.has('ArrowUp')) my--; if (k.has('KeyS') || k.has('ArrowDown')) my++;
    if (mx || my) { c.x += mx * sp; c.y += my * sp; this.follow = false; this.v.clampCam(); }
    if (!this.drag && !this.pinch && (Math.abs(this.vel.x) > 0.3 || Math.abs(this.vel.y) > 0.3)) {
      c.x -= this.vel.x / c.z; c.y -= this.vel.y / c.z; this.vel.x *= 0.88; this.vel.y *= 0.88; this.v.clampCam();
    }
  }
}
return { Input };
});
