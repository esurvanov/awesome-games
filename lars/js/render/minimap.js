// Мини-карта маршрута: вся очередь одной полосой (цвет — плотность), КПП, посёлки, игрок, рамка камеры.
// Клик/тап — перенести камеру.
'use strict';
L.def('render/minimap', () => {
const { clamp } = L.use('core');

class Minimap {
  constructor(canvas, world, view) {
    this.cv = canvas; this.g = canvas.getContext('2d'); this.w = world; this.view = view;
    const r = world.road; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let i = 0; i < r.n; i += 10) { x0 = Math.min(x0, r.X[i]); x1 = Math.max(x1, r.X[i]); y0 = Math.min(y0, r.Y[i]); y1 = Math.max(y1, r.Y[i]); }
    this.bb = { x0: x0 - 400, x1: x1 + 400, y0: y0 - 300, y1: y1 + 300 };
    this.t = 0; this.dens = null;
    canvas.addEventListener('pointerdown', e => { e.stopPropagation(); const b = canvas.getBoundingClientRect(); this.jump(e.clientX - b.left, e.clientY - b.top); });
  }
  fit() {
    const W = this.cv.clientWidth, H = this.cv.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.cv.width !== Math.round(W * dpr)) { this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr); }
    const bb = this.bb, k = Math.min(W / (bb.x1 - bb.x0), H / (bb.y1 - bb.y0));
    this.k = k; this.ox = W / 2 - (bb.x0 + bb.x1) / 2 * k; this.oy = H / 2 - (bb.y0 + bb.y1) / 2 * k; this.dpr = dpr;
  }
  jump(sx, sy) {
    const x = (sx - this.ox) / this.k, y = (sy - this.oy) / this.k;
    const pr = this.w.road.project(x, y), q = this.w.road.at(pr.s, 0);
    this.view.cam.x = q.x; this.view.cam.y = q.y; this.view.clampCam();
  }
  draw(dt) {
    this.fit();
    const g = this.g, w = this.w, r = w.road, k = this.k, dpr = this.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.cv.width, this.cv.height);
    const X = x => x * k + this.ox, Y = y => y * k + this.oy;
    // дорога
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = 'rgba(154,163,154,0.35)'; g.lineWidth = 3; g.beginPath();
    for (let i = 0; i < r.n; i += 8) i ? g.lineTo(X(r.X[i]), Y(r.Y[i])) : g.moveTo(X(r.X[i]), Y(r.Y[i])); g.stroke();
    // очередь: плотность по 250 м (пересчёт раз в полсекунды)
    this.t -= dt;
    if (this.t <= 0 || !this.dens) {
      this.t = 0.5; const B = 250, n = Math.ceil(r.len / B), d = new Float32Array(n), Q = w.queue;
      for (const c of Q.cars) { const b = Math.floor(c.s / B); if (b < n) d[b]++; }
      this.dens = d; this.cap = B / Q.spacing * 1.5;
    }
    const B = 250;
    for (let b = 0; b < this.dens.length; b++) {
      const v = this.dens[b] / this.cap; if (v < 0.02) continue;
      const i0 = r.idx(b * B), i1 = r.idx((b + 1) * B);
      g.strokeStyle = v > 0.8 ? '#e25a4f' : v > 0.5 ? '#f0923e' : '#e8d36a'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(X(r.X[i0]), Y(r.Y[i0])); g.lineTo(X(r.X[i1]), Y(r.Y[i1])); g.stroke();
    }
    // посёлки
    for (const pl of w.C.ROUTE.places) {
      if (!['village', 'checkpoint', 'police'].includes(pl.kind)) continue;
      const q = r.at(pl.s * 1000, 0);
      g.fillStyle = pl.kind === 'checkpoint' ? '#e8f1ff' : pl.kind === 'police' ? '#8cc3e6' : '#b6a88c';
      g.fillRect(X(q.x) - 2, Y(q.y) - 2, 4, 4);
    }
    // рамка камеры
    const v = this.view.view; if (v) { g.strokeStyle = 'rgba(235,230,211,0.8)'; g.lineWidth = 1; g.strokeRect(X(v.x0), Y(v.y0), Math.max(3, (v.x1 - v.x0) * k), Math.max(3, (v.y1 - v.y0) * k)); }
    // игрок
    const p = w.player; if (p) { g.fillStyle = '#ffd27a'; g.beginPath(); g.arc(X(p.x), Y(p.y), 4, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#1a0f06'; g.lineWidth = 1.5; g.stroke(); }
    // хвост за краем карты
    if (w.queue.tailS > r.len) { g.fillStyle = '#e25a4f'; g.font = '700 10px system-ui'; g.textAlign = 'center'; g.fillText('+' + ((w.queue.tailS - r.len) / 1000).toFixed(1).replace('.', ',') + ' км', X(r.X[r.n - 1]), Y(r.Y[r.n - 1]) - 8); g.textAlign = 'left'; }
  }
}
return { Minimap };
});
