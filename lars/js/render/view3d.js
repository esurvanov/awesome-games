// 3D-вид от первого лица поверх той же симуляции (WebGL, без библиотек).
// Читает мир: машины по s/полосе (плавное «подкатывание» рядом с камерой), люди у машин (без состояния — из хеша
// и времени, как на карте), пешие, продавцы, огни; среду — солнце по восходу/закату дня, погоду, луну, снег.
// LOD: рельеф ближний/дальний, машины подробно / коробкой / только огнями, люди — только рядом, деревья — кусками.
// Отдаёт наружу: цели под прицелом (для меню), препятствия (для ходьбы), высоту земли.
// Точность: мир в 13–25 км от нуля, а float32 там держит ~1 мм — поэтому всё, что уходит в GPU, считается
// относительно камеры в double (инстансы — сразу «минус камера», куски — от своего начала + uOff).
// Глубина: ближняя плоскость 0,2 м пешком и 0,45 м из салона; салон — отдельным проходом со своей глубиной.
'use strict';
L.def('render/view3d', () => {
const { clamp, lerp, smooth, hash01, DAY, HOUR } = L.use('core');
const { LANE_OFF } = L.use('sim/world');
const { createGL, M4, hex } = L.use('render/gl');
const SH = L.use('render/shaders');
const { MAT, BODY, carMesh, carBox, interiorMesh, personMesh, treeMesh, bikeMesh, h01 } = L.use('render/geo');
const { Terrain, TCH, TSTEP, TPRE } = L.use('render/terrain');
const { Scene, makeAtlas, makeAsphalt } = L.use('render/scene');

const BODIES = Object.keys(BODY);
const TREES = ['pine', 'leaf', 'birch', 'shrub'];
const lin = h => { const c = hex(h); return [c[0] * c[0], c[1] * c[1], c[2] * c[2]]; };
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const mixv = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const COATS = ['#27313f', '#3c4a5c', '#2f4d3a', '#4a4a4a', '#1f2226', '#6b3b2a', '#7a2f2f', '#8a6a3a', '#3d6e8f', '#c9b48a', '#5a3d5c', '#2d4f82', '#6f7446', '#b85a2a'];
const PANTS = ['#1f2226', '#2d3a4a', '#3c4a5c', '#4a4a4a', '#4a3f33', '#2a2d33', '#394a63'];
const HAIR = ['#2a1f18', '#4a3426', '#1a1a1a', '#8a6a3a', '#b9b2a5', '#7a2f2f', '#2d4f82', '#3a3a3a', '#6b4a33'];
const SKIN = [0.84, 0.8, 0.74, 0.88, 0.7];

// растущий Float32-буфер
class FB { constructor(n = 1024) { this.a = new Float32Array(n); this.n = 0; } reset() { this.n = 0; } push(...v) { if (this.n + v.length > this.a.length) { const b = new Float32Array(Math.max(this.a.length * 2, this.n + v.length)); b.set(this.a); this.a = b; } for (let i = 0; i < v.length; i++) this.a[this.n++] = v[i]; } }

class View3D {
  constructor(canvas, world, quality) {
    this.cv = canvas; this.w = world; this.q = quality;
    this.G = createGL(canvas, { antialias: quality.aa !== false });
    this.ok = !!this.G;
    if (!this.ok) return;
    this.gl = this.G.gl;
    this.cam = { x: 0, y: 2, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 72 * Math.PI / 180 };
    this.time = 0; this.rs = 1; this.dtAcc = 0; this.dtN = 0; this.dtT = 0;
    this.vis = new Map(); // id машины → видимое положение и скорость (см. carPose)
    this.pst = new Map(); // люди у машин: seed → состояние (стоит / идёт / садится / в машине), см. gatherPeople
    this.pedV = new Map(); this.walkV = new Map(); // видимое положение пеших (идут с человеческой скоростью)
    this.rate = 0; this.lastClock = null; this.dG = 0; // игровых секунд на реальную (×1 ≈ 60)
    this.targets = []; this.near = []; this.flash = false; this.inCarView = false;
    this.stats = { tris: 0, draws: 0, cars: 0, ppl: 0, chunks: 0 };
    this.VP = new Float32Array(16); this.V = new Float32Array(16); this.Pm = new Float32Array(16); this.IVP = new Float32Array(16); this.Mid = M4.ident(new Float32Array(16)); this.Mtmp = new Float32Array(16);
    this.VPi = new Float32Array(16); this.Pi = new Float32Array(16); this.pcTmp = {};
    const t0 = performance.now();
    this.build();
    this.buildMs = performance.now() - t0;
    this.resize();
  }
  // ─────────── сборка ───────────
  build() {
    const G = this.G, gl = this.gl, w = this.w, C = w.C;
    this.T = new Terrain(w.road, C.ROUTE);
    this.sc = new Scene(w, this.T);
    this.sc.atlas = makeAtlas();
    this.sc.build();
    this.atlasTex = G.texture(this.sc.atlas.cv, { repeat: false });
    this.roadTex = G.texture(makeAsphalt(), { repeat: true });
    this.plateRect = this.sc.atlas.rects.plate;
    // программы
    this.P = {
      ter: G.program(SH.TERRAIN_V, SH.TERRAIN_F, 'terrain'), st: G.program(SH.STATIC_V, SH.STATIC_F, 'static'),
      inst: G.program(SH.INST_V, SH.INST_F, 'inst'), ppl: G.program(SH.PERSON_V, SH.PERSON_F, 'person'),
      wat: G.program(SH.WATER_V, SH.WATER_F, 'water'), sky: G.program(SH.SKY_V, SH.SKY_F, 'sky'),
      glow: G.program(SH.GLOW_V, SH.GLOW_F, 'glow'), blob: G.program(SH.BLOB_V, SH.BLOB_F, 'blob'),
      rain: G.program(SH.RAIN_V, SH.RAIN_F, 'rain'), line: G.program(SH.LINE_V, SH.LINE_F, 'line'),
    };
    // куски рельефа: дальний LOD, дорога и река — сразу; ближний и деревья — по мере приближения
    const T = this.T, nC = T.nChunks;
    this.chunks = [];
    for (let k = 0; k < nC; k++) {
      const far = T.buildChunk(k, 1), road = T.buildRoad(k), riv = T.buildRiver(k);
      const bb = far.bb, cx = (bb[0] + bb[3]) / 2, cy = (bb[1] + bb[4]) / 2, cz = (bb[2] + bb[5]) / 2;
      const r = Math.hypot(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]) / 2;
      const deco = this.sc.chunks.get(k), org = far.org;
      this.chunks.push({ k, org, far: this.upTer(far), road: this.upRoad(road), riv: this.upRiv(riv), near: null, trees: null, deco: deco ? this.upMesh(deco.arrays(org)) : null, cx, cy, cz, r, s0: far.s0, s1: far.s1 });
    }
    const ro = (x, y, z) => [Math.round(x), Math.round(y), Math.round(z)];
    this.sellers = this.sc.sellers.map(o => ({ ...o, gm: this.upMesh(o.mesh.arrays(ro(o.x, o.g, o.z))) }));
    this.cond = this.sc.cond.map(o => ({ ...o, gm: this.upMesh(o.mesh.arrays(ro(o.x, 0, o.z))) }));
    this.peaks = this.upMesh(this.sc.peaks.arrays());
    this.wires = { b: G.buffer(this.sc.wires), n: this.sc.wires.length / 3 };
    // инстансные сетки
    this.cars = {}; for (const b of BODIES) this.cars[b] = this.upMesh(carMesh(b, true).arrays());
    this.carBoxM = this.upMesh(carBox().arrays());
    this.personM = this.upMesh(personMesh().arrays());
    this.treeM = {}; for (const k of TREES) this.treeM[k] = this.upMesh(treeMesh(k).arrays());
    this.bikeM = { bike: this.upMesh(bikeMesh('bike').arrays()), scooter: this.upMesh(bikeMesh('scooter').arrays()) };
    this.interior = null; this.interiorKey = '';
    // квад и треугольник
    this.quadB = G.buffer(new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]));
    this.triB = G.buffer(new Float32Array([-1, -1, 3, -1, -1, 3]));
    // капли дождя (сиды)
    const RN = 2400, rs = new Float32Array(RN * 3); for (let i = 0; i < RN * 3; i++) rs[i] = h01(i, 77);
    this.rainB = G.buffer(rs); this.rainN = RN;
    // динамические буферы
    this.dyn = {}; for (const k of [...BODIES, 'box', 'ppl', 'glow', 'blob', 'bike', 'scooter']) this.dyn[k] = { fb: new FB(4096), buf: G.dyn() };
    // статичные коллайдеры по ячейкам 64 м
    this.cgrid = new Map();
    for (const c of this.sc.colliders) { const k = Math.floor(c.x / 64) + ',' + Math.floor(c.z / 64); if (!this.cgrid.has(k)) this.cgrid.set(k, []); this.cgrid.get(k).push(c); }
    this.buildQueue = [];
  }
  upMesh(a) {
    const G = this.G;
    return { n: a.n, pos: G.buffer(a.pos), nrm: G.buffer(a.nrm), col: G.buffer(a.col), uv: G.buffer(a.uv), org: a.org || [0, 0, 0] };
  }
  upTer(c) { const G = this.G, gl = this.gl; return { pos: G.buffer(c.pos), col: G.buffer(c.col), idx: G.buffer(c.idx, gl.ELEMENT_ARRAY_BUFFER), n: c.n }; }
  upRoad(c) { const G = this.G, gl = this.gl; return { pos: G.buffer(c.pos), col: G.buffer(c.col), uv: G.buffer(c.uv), idx: G.buffer(c.idx, gl.ELEMENT_ARRAY_BUFFER), n: c.n }; }
  upRiv(c) { const G = this.G, gl = this.gl; return c.n ? { pos: G.buffer(c.pos), uv: G.buffer(c.uv), idx: G.buffer(c.idx, gl.ELEMENT_ARRAY_BUFFER), n: c.n } : null; }
  ensureNear(ch) {
    if (!ch.near) ch.near = this.upTer(this.T.buildChunk(ch.k, 0));
  }
  ensureTrees(ch) {
    if (ch.trees) return;
    const tr = this.T.trees(ch.k, (x, z) => this.sc.occupied(x, z)), out = {};
    for (const kind of TREES) {
      const a = tr[kind], n = a.length / 8; if (!n) continue;
      const f = new Float32Array(n * 12);
      const [ox, oy, oz] = ch.org; // от начала куска (точность float32)
      for (let i = 0; i < n; i++) { const o = i * 8, p = i * 12, sc = a[o + 3], r = a[o + 4]; f.set([a[o] - ox, a[o + 1] - oy, a[o + 2] - oz, sc, Math.sin(r), Math.cos(r), sc, sc, a[o + 5], a[o + 6], a[o + 7], 16], p); }
      out[kind] = { b: this.G.buffer(f), n };
    }
    ch.trees = out;
  }
  resize() {
    if (!this.ok) return;
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.dprMax || 1.5), k = dpr * (this.q.rs || 1) * this.rs;
    const W = this.cv.clientWidth || innerWidth, H = this.cv.clientHeight || innerHeight;
    const w = Math.max(64, Math.round(W * k)), h = Math.max(64, Math.round(H * k));
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    this.W = W; this.H = H;
  }
  // адаптивное разрешение: по времени кадра (реальному)
  adapt(dt) {
    this.dtAcc += dt; this.dtN++; this.dtT += dt;
    if (this.dtT < 1.2) return;
    const avg = this.dtAcc / this.dtN; this.dtAcc = 0; this.dtN = 0; this.dtT = 0;
    const old = this.rs;
    if (avg > 0.036 && this.rs > 0.5) this.rs = Math.max(0.5, this.rs - 0.1);
    else if (avg < 0.022 && this.rs < 1) this.rs = Math.min(1, this.rs + 0.05);
    if (old !== this.rs) this.resize();
  }

  // ─────────── среда → свет, небо, туман ───────────
  envParams() {
    const w = this.w, env = w.env, cal = w.C.CALENDAR, t = w.clock.t, d = env.day(), h = (t % DAY) / HOUR, [sr, ss] = d.sun, gz = cal.gorge || { morning: 0, evening: 0 };
    const skyK = smooth(sr - 0.6, sr + 0.5, h) * (1 - smooth(ss - 0.4, ss + 0.6, h));
    const sunK = smooth(sr + gz.morning - 0.4, sr + gz.morning + 0.4, h) * (1 - smooth(ss - gz.evening - 0.4, ss - gz.evening + 0.4, h));
    const wx = d.weather, cloud = { clear: 0.12, wind: 0.35, cloud: 0.7, drizzle: 0.85, rain: 0.95, storm: 1 }[wx] ?? 0.3;
    const dayF = (h - sr) / (ss - sr);
    const el = (dayF >= 0 && dayF <= 1 ? Math.sin(Math.PI * dayF) : -Math.sin(Math.PI * Math.min(1, Math.abs(dayF < 0 ? dayF : dayF - 1) * 0.9))) * 46 * Math.PI / 180;
    const az = (90 + 180 * dayF) * Math.PI / 180;
    const sun = [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
    const low = 1 - smooth(4, 22, el * 180 / Math.PI); // низкое солнце — тёплое
    const tw = smooth(-0.6, 0.2, h - sr) * (1 - smooth(-0.2, 0.9, h - sr)) + smooth(-0.9, 0.2, h - ss) * (1 - smooth(0.2, 1.0, h - ss)); // сумерки
    const over = smooth(0.5, 1, cloud);
    let zen = mixv(lin('#0c1630'), lin('#3f7fc8'), skyK); zen = mixv(zen, mul(lin('#8f989f'), skyK * 0.9 + 0.02), over);
    let hor = mixv(lin('#1d2c4f'), lin('#b9d0e4'), skyK); hor = mixv(hor, lin('#e89a5c'), tw * 0.8 * (1 - over)); hor = mixv(hor, mul(lin('#a9b0b6'), skyK * 0.9 + 0.03), over);
    const sunCol = mul(mixv([1.0, 0.93, 0.8], [1.0, 0.55, 0.28], low), 1.55 * sunK * (1 - cloud * 0.75) * smooth(-2, 3, el * 180 / Math.PI));
    const moon = d.moon || 0;
    const skyCol = mixv(mul([0.05, 0.065, 0.12], 1 + moon * 2), mixv([0.2, 0.25, 0.33], [0.3, 0.31, 0.33], over), skyK);
    const gndCol = mixv([0.022, 0.024, 0.032], mixv([0.09, 0.08, 0.06], [0.1, 0.1, 0.095], over), skyK);
    const fogBase = { clear: 0.00016, wind: 0.00022, cloud: 0.00045, drizzle: 0.0007, rain: 0.0011, storm: 0.0016 }[wx] ?? 0.0003;
    const fogCol = mixv(mixv(lin('#141d33'), lin('#9fb2c4'), skyK), mul(lin('#9aa1a6'), skyK * 0.85 + 0.03), over);
    const haze = mul(mixv([1, 0.9, 0.7], [1, 0.55, 0.3], low), sunK * (1 - cloud * 0.7) * 0.3);
    const snowY = (d.snow ?? 3000) - 1115;
    const wet = { rain: 1, storm: 1, drizzle: 0.65 }[wx] ?? 0;
    const rain = { rain: 1, storm: 1, drizzle: 0.35 }[wx] ?? 0;
    const night = 1 - skyK;
    this.env = { skyK, sunK, sun, sunCol, skyCol, gndCol, zen, hor, fogCol, fogD: fogBase * (1 + night * 0.3), haze, stars: night * (1 - cloud * 0.95) * (1 - moon * 0.6), cloud, snowY, wet, rain, snow: wx === 'storm' ? 1 : 0, night, expo: 1.05 + night * 2.6, wind: wx === 'wind' || wx === 'storm' ? 1 : 0.35, temp: env.temp() };
    return this.env;
  }
  setCommon(p) {
    const gl = this.gl, e = this.env, u = p.u;
    gl.uniformMatrix4fv(u.uVP, false, this.VP);
    if (u.uCam) gl.uniform3f(u.uCam, this.cam.x, this.cam.y, this.cam.z); // только для рисунка шума (мировые координаты)
    if (u.uOff) gl.uniform3f(u.uOff, 0, 0, 0);
    if (u.uPull) gl.uniform1f(u.uPull, 0);
    if (u.uSunDir) gl.uniform3fv(u.uSunDir, e.sun);
    if (u.uSunCol) gl.uniform3fv(u.uSunCol, e.sunCol);
    if (u.uSkyCol) gl.uniform3fv(u.uSkyCol, e.skyCol);
    if (u.uGndCol) gl.uniform3fv(u.uGndCol, e.gndCol);
    if (u.uFogCol) gl.uniform3fv(u.uFogCol, e.fogCol);
    if (u.uHazeCol) gl.uniform3fv(u.uHazeCol, e.haze);
    if (u.uFogD) gl.uniform1f(u.uFogD, e.fogD);
    if (u.uExpo) gl.uniform1f(u.uExpo, e.expo);
    if (u.uCamDir) gl.uniform3fv(u.uCamDir, this.fwd);
    if (u.uFlash) gl.uniform1f(u.uFlash, this.flash ? 1 : 0);
    if (u.uNight) gl.uniform1f(u.uNight, e.night);
    if (u.uWet) gl.uniform1f(u.uWet, e.wet);
    if (u.uTime) gl.uniform1f(u.uTime, this.time);
    if (u.uNL) { gl.uniform1f(u.uNL, this.nl); if (this.nl) { gl.uniform4fv(u.uLP, this.LP); gl.uniform3fv(u.uLC, this.LC); } }
  }
  use(p) { this.G.resetAttrs(); this.gl.useProgram(p.p); this.setCommon(p); this.cur = p; }
  // сдвиг «начало сетки − камера» (double на CPU → малое float32) и начало для мировых координат шума
  setOff(p, o) { const c = this.cam, gl = this.gl; gl.uniform3f(p.u.uOff, o[0] - c.x, o[1] - c.y, o[2] - c.z); if (p.u.uOrg) gl.uniform3f(p.u.uOrg, o[0], o[1], o[2]); }
  // матрица static-сетки: перенос в начало сетки относительно камеры
  modelAt(o) { const M = M4.ident(this.Mtmp), c = this.cam; M[12] = o[0] - c.x; M[13] = o[1] - c.y; M[14] = o[2] - c.z; return M; }
  // камера в салоне — из позы своей машины этого же кадра (без запаздывания на кадр)
  carCam(pose, sleeping) {
    const cam = this.cam, B = pose.B, sx = pose.sx, sz = pose.sz, rx = -pose.fz, rz = pose.fx;
    cam.x = pose.x + rx * -0.37 * sx + pose.fx * -0.42 * sz; cam.z = pose.z + rz * -0.37 * sx + pose.fz * -0.42 * sz; cam.y = pose.y + B.belt + 0.36 + (sleeping ? -0.12 : 0);
  }
  // поза своей машины (та же, что уйдёт в салон и в gather)
  pcarPoseOf(c) {
    const w = this.w, CARS = w.C.CARS, m = CARS.models[c.mi] || CARS.models[0], body = m.body || 'sedan', B = BODY[body], pose = this.carPose(c, this.pcTmp, true);
    return { x: pose.x, y: pose.gy, z: pose.y, fx: pose.fx, fz: pose.fz, body, col: c.color || '#8e969f', sx: m.w / B.w, sz: m.l / B.l, B, vs: pose.vs };
  }
  bindMesh(p, m) {
    const G = this.G, gl = this.gl;
    G.attr(p.a.aPos, m.pos, 3); G.attr(p.a.aNrm, m.nrm, 4, gl.BYTE, true); G.attr(p.a.aCol, m.col, 4, gl.UNSIGNED_BYTE, true); G.attr(p.a.aUV, m.uv, 2, gl.UNSIGNED_SHORT, true);
  }
  // ─────────── кадр ───────────
  draw(dt) {
    if (!this.ok) return;
    const gl = this.gl, G = this.G, w = this.w, q = this.q, cam = this.cam;
    this.time += dt;
    this.adapt(dt);
    // темп игрового времени (×1 ≈ 60 игр. с/с): от него — скорость «подкатывания» и поведение людей
    const ct = w.clock.t; this.dG = this.lastClock == null ? 0 : Math.max(0, ct - this.lastClock); this.lastClock = ct;
    if (this.dG > 1800) this.dG = 0; // перемотка (сон, сцена) — не темп
    if (dt > 0) this.rate += (this.dG / dt - this.rate) * Math.min(1, dt * 2.5);
    const e = this.envParams();
    // в салоне: сначала поза своей машины этого кадра, от неё камера (иначе торпедо на кадр впереди глаза)
    if (this.inCarView && w.pcar) { this.pcarPose = this.pcarPoseOf(w.pcar); this.carCam(this.pcarPose, w.player.sleeping); }
    // матрицы (ближняя плоскость как можно дальше — точность глубины вдали; салон — отдельным проходом)
    const aspect = this.cv.width / this.cv.height;
    M4.perspective(this.Pm, cam.fov, aspect, this.inCarView ? 0.45 : 0.2, 40000);
    M4.viewYawPitch(this.V, cam.yaw, cam.pitch, cam.roll);
    M4.mul(this.VP, this.Pm, this.V); M4.invert(this.IVP, this.VP);
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    this.fwd = [sy * cp, sp, -cy * cp]; this.right = [cy, 0, sy]; this.up = [-sy * sp, cp, cy * sp];
    this.cosCull = Math.cos(Math.atan(Math.tan(cam.fov / 2) * Math.hypot(1, aspect)) + 0.25);
    this.sCam = this.T.ground(cam.x, cam.z).i;
    const camS = this.T.sOf(this.sCam);
    this.camS = camS;
    // динамика
    this.gather(camS);
    this.pickLights();
    // проход
    gl.viewport(0, 0, this.cv.width, this.cv.height);
    const fc = e.fogCol; gl.clearColor(Math.sqrt(1 - Math.exp(-fc[0] * e.expo)), Math.sqrt(1 - Math.exp(-fc[1] * e.expo)), Math.sqrt(1 - Math.exp(-fc[2] * e.expo)), 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    this.stats.draws = 0; this.stats.chunks = 0;
    this.drawTerrain();
    this.drawStatic();
    this.drawTrees();
    this.drawInstances();
    this.drawPeople();
    this.drawWater();
    this.drawWires();
    this.drawSky();
    this.drawBlobs();
    this.drawGlows();
    this.drawRain();
    this.drawInterior(aspect);
    G.resetAttrs();
  }
  // салон своей машины: своя глубина (0,1–8 м; ближе 0,1 — подголовник за глазом), поверх мира — он всегда ближе всего
  drawInterior(aspect) {
    if (!this.inCarView || !this.pcarPose) return;
    const gl = this.gl, p = this.P.st, pc = this.pcarPose, key = pc.body + pc.col, cam = this.cam;
    if (this.interiorKey !== key) { this.interior = this.upMesh(interiorMesh(pc.body, pc.col).arrays()); this.interiorKey = key; }
    gl.clear(gl.DEPTH_BUFFER_BIT);
    M4.perspective(this.Pi, cam.fov, aspect, 0.1, 8); M4.mul(this.VPi, this.Pi, this.V);
    const VP = this.VP; this.VP = this.VPi; this.use(p); this.VP = VP;
    gl.uniform1f(p.u.uRoadMode, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlasTex); gl.uniform1i(p.u.uAtlas, 0);
    M4.model(this.Mtmp, pc.x - cam.x, pc.y - cam.y, pc.z - cam.z, pc.fx, pc.fz);
    for (let i = 0; i < 3; i++) { this.Mtmp[i] *= pc.sx; this.Mtmp[8 + i] *= pc.sz; }
    gl.uniformMatrix4fv(p.u.uModel, false, this.Mtmp);
    this.bindMesh(p, this.interior); gl.drawArrays(gl.TRIANGLES, 0, this.interior.n); this.stats.draws++;
  }
  visible(x, y, z, r) {
    const dx = x - this.cam.x, dy = y - this.cam.y, dz = z - this.cam.z, d = Math.hypot(dx, dy, dz);
    if (d < r) return d;
    const f = this.fwd; if ((dx * f[0] + dy * f[1] + dz * f[2]) / d < this.cosCull - r / d * 1.2) return -1;
    return d;
  }
  drawTerrain() {
    const gl = this.gl, G = this.G, p = this.P.ter, q = this.q, e = this.env;
    this.use(p);
    gl.uniform1f(p.u.uSnowY, e.snowY); gl.uniform1f(p.u.uDetail, q.level === 'low' ? 0 : 1); gl.uniform3fv(p.u.uRock, hex(this.w.C.ROUTE.palette.granite)); gl.uniform3fv(p.u.uSnow, hex(this.w.C.ROUTE.palette.snow));
    let built = 0;
    for (const ch of this.chunks) {
      const d = this.visible(ch.cx, ch.cy, ch.cz, ch.r); if (d < 0) continue;
      const dd = d - ch.r;
      if (dd > q.far) continue;
      let m = ch.far;
      if (dd < q.near) { if (!ch.near && (built < 2 || dd < 200)) { this.ensureNear(ch); built++; } if (ch.near) m = ch.near; }
      this.setOff(p, ch.org);
      G.attr(p.a.aPos, m.pos, 3); G.attr(p.a.aCol, m.col, 4, gl.UNSIGNED_BYTE, true);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.idx); gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_SHORT, 0);
      this.stats.draws++; this.stats.chunks++;
    }
  }
  drawStatic() {
    const gl = this.gl, G = this.G, p = this.P.st, q = this.q;
    this.use(p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlasTex); gl.uniform1i(p.u.uAtlas, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.roadTex); gl.uniform1i(p.u.uRoad, 1);
    // дорога
    gl.uniform1f(p.u.uRoadMode, 1); gl.uniform1f(p.u.uPull, 6e-7);
    if (p.a.aNrm >= 0) { gl.disableVertexAttribArray(p.a.aNrm); gl.vertexAttrib4f(p.a.aNrm, 0, 1, 0, 0); }
    for (const ch of this.chunks) {
      const d = this.visible(ch.cx, ch.cy, ch.cz, ch.r); if (d < 0 || d - ch.r > Math.min(q.far * 0.6, q.near * 1.6)) continue;
      const m = ch.road;
      gl.uniformMatrix4fv(p.u.uModel, false, this.modelAt(ch.org));
      G.attr(p.a.aPos, m.pos, 3); G.attr(p.a.aCol, m.col, 4, gl.UNSIGNED_BYTE, true); G.attr(p.a.aUV, m.uv, 2);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.idx); gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_SHORT, 0); this.stats.draws++;
    }
    gl.uniform1f(p.u.uRoadMode, 0); gl.uniform1f(p.u.uPull, 0);
    const drawM = m => { gl.uniformMatrix4fv(p.u.uModel, false, this.modelAt(m.org)); this.bindMesh(p, m); gl.drawArrays(gl.TRIANGLES, 0, m.n); this.stats.draws++; };
    for (const ch of this.chunks) {
      if (!ch.deco) continue;
      const d = this.visible(ch.cx, ch.cy, ch.cz, ch.r); if (d < 0 || d - ch.r > q.near * 1.4) continue;
      drawM(ch.deco);
    }
    const E = this.w.econ;
    for (const s of this.sellers) { if (!E.active(s.o)) continue; const d = this.visible(s.x, s.g, s.z, 6); if (d < 0 || d > q.near) continue; drawM(s.gm); }
    for (const c of this.cond) { if (!this.w.env.rule(c.rule)) continue; const d = this.visible(c.x, 0, c.z, 20); if (d < 0 || d > q.near) continue; drawM(c.gm); }
    // дальние вершины: туман слабее
    gl.uniform1f(p.u.uFogD, this.env.fogD * 0.22);
    drawM(this.peaks);
  }
  drawTrees() {
    const gl = this.gl, G = this.G, p = this.P.inst, q = this.q;
    this.use(p);
    gl.uniform1f(p.u.uWind, this.env.wind);
    let built = 0;
    for (const ch of this.chunks) {
      const d = this.visible(ch.cx, ch.cy, ch.cz, ch.r); if (d < 0 || d - ch.r > q.treeR) continue;
      if (!ch.trees) { if (built > 0 && d - ch.r > 120) continue; this.ensureTrees(ch); built++; }
      this.setOff(p, ch.org);
      for (const kind of TREES) {
        const t = ch.trees[kind]; if (!t) continue;
        this.bindMesh(p, this.treeM[kind]);
        G.attr(p.a.iP, t.b, 4, gl.FLOAT, false, 48, 0, 1); G.attr(p.a.iD, t.b, 4, gl.FLOAT, false, 48, 16, 1); G.attr(p.a.iC, t.b, 4, gl.FLOAT, false, 48, 32, 1);
        G.drawArraysInstanced(gl.TRIANGLES, 0, this.treeM[kind].n, t.n); this.stats.draws++;
      }
    }
  }
  instDraw(p, mesh, dyn) {
    const gl = this.gl, G = this.G, n = dyn.fb.n / 12; if (!n) return;
    G.upload(dyn.buf, dyn.fb.a, dyn.fb.n);
    this.bindMesh(p, mesh);
    G.attr(p.a.iP, dyn.buf.b, 4, gl.FLOAT, false, 48, 0, 1); G.attr(p.a.iD, dyn.buf.b, 4, gl.FLOAT, false, 48, 16, 1); G.attr(p.a.iC, dyn.buf.b, 4, gl.FLOAT, false, 48, 32, 1);
    G.drawArraysInstanced(gl.TRIANGLES, 0, mesh.n, n); this.stats.draws++;
  }
  drawInstances() {
    const gl = this.gl, p = this.P.inst;
    this.use(p);
    gl.uniform1f(p.u.uWind, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlasTex); gl.uniform1i(p.u.uAtlas, 0);
    gl.uniform4fv(p.u.uPlate, this.plateRect);
    for (const b of BODIES) this.instDraw(p, this.cars[b], this.dyn[b]);
    this.instDraw(p, this.carBoxM, this.dyn.box);
    this.instDraw(p, this.bikeM.bike, this.dyn.bike);
    this.instDraw(p, this.bikeM.scooter, this.dyn.scooter);
  }
  drawPeople() {
    const gl = this.gl, G = this.G, p = this.P.ppl, d = this.dyn.ppl, n = d.fb.n / 20; if (!n) return;
    this.use(p);
    G.upload(d.buf, d.fb.a, d.fb.n);
    this.bindMesh(p, this.personM);
    for (const [nm, off] of [['iP', 0], ['iA', 16], ['iC1', 32], ['iC2', 48], ['iC3', 64]]) G.attr(p.a[nm], d.buf.b, 4, gl.FLOAT, false, 80, off, 1);
    G.drawArraysInstanced(gl.TRIANGLES, 0, this.personM.n, n); this.stats.draws++;
  }
  drawWater() {
    const gl = this.gl, G = this.G, p = this.P.wat, q = this.q;
    this.use(p); gl.uniform3fv(p.u.uWater, hex(this.w.C.ROUTE.palette.river));
    for (const ch of this.chunks) {
      if (!ch.riv) continue;
      const d = this.visible(ch.cx, ch.cy, ch.cz, ch.r); if (d < 0 || d - ch.r > Math.min(q.far * 0.5, q.near * 1.6)) continue;
      this.setOff(p, ch.org);
      G.attr(p.a.aPos, ch.riv.pos, 3); G.attr(p.a.aUV, ch.riv.uv, 2);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ch.riv.idx); gl.drawElements(gl.TRIANGLES, ch.riv.n, gl.UNSIGNED_SHORT, 0); this.stats.draws++;
    }
  }
  drawWires() {
    const gl = this.gl, G = this.G, p = this.P.line; if (!this.wires.n) return;
    this.use(p); gl.uniform3f(p.u.uLineC, 0.05, 0.05, 0.055); this.setOff(p, [0, 0, 0]);
    G.attr(p.a.aPos, this.wires.b, 3); gl.drawArrays(gl.LINES, 0, this.wires.n); this.stats.draws++;
  }
  drawSky() {
    const gl = this.gl, G = this.G, p = this.P.sky, e = this.env, u = p.u;
    G.resetAttrs(); gl.useProgram(p.p);
    gl.depthMask(false);
    gl.uniformMatrix4fv(u.uInvVP, false, this.IVP);
    gl.uniform3fv(u.uSunDir, e.sun); gl.uniform3fv(u.uZen, e.zen); gl.uniform3fv(u.uHor, e.hor); gl.uniform3fv(u.uSunCol, e.sunCol); gl.uniform3fv(u.uHazeCol, e.haze); gl.uniform3fv(u.uFogCol, e.fogCol);
    gl.uniform1f(u.uStars, e.stars); gl.uniform1f(u.uCloud, e.cloud); gl.uniform1f(u.uTime, this.time); gl.uniform1f(u.uExpo, e.expo);
    gl.uniform1f(u.uSidereal, (this.w.clock.t / 86164) * Math.PI * 2);
    G.attr(p.a.aPos, this.triB, 2); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
  }
  drawBlobs() {
    const gl = this.gl, G = this.G, p = this.P.blob, d = this.dyn.blob, n = d.fb.n / 8; if (!n) return;
    this.use(p); G.upload(d.buf, d.fb.a, d.fb.n);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ZERO, gl.SRC_COLOR); gl.depthMask(false);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -2);
    G.attr(p.a.aQ, this.quadB, 2); G.attr(p.a.iP, d.buf.b, 4, gl.FLOAT, false, 32, 0, 1); G.attr(p.a.iD, d.buf.b, 4, gl.FLOAT, false, 32, 16, 1);
    G.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    gl.disable(gl.POLYGON_OFFSET_FILL); gl.depthMask(true); gl.disable(gl.BLEND);
  }
  drawGlows() {
    const gl = this.gl, G = this.G, p = this.P.glow, d = this.dyn.glow, n = d.fb.n / 8; if (!n) return;
    this.use(p); G.upload(d.buf, d.fb.a, d.fb.n);
    gl.uniform3fv(p.u.uRight, this.right); gl.uniform3fv(p.u.uUp, this.up); gl.uniform1f(p.u.uPx, 2 * Math.tan(this.cam.fov / 2) / this.cv.height);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
    G.attr(p.a.aQ, this.quadB, 2); G.attr(p.a.iP, d.buf.b, 4, gl.FLOAT, false, 32, 0, 1); G.attr(p.a.iC, d.buf.b, 4, gl.FLOAT, false, 32, 16, 1);
    G.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    gl.depthMask(true); gl.disable(gl.BLEND);
  }
  drawRain() {
    const e = this.env; if (!e.rain) return;
    const gl = this.gl, G = this.G, p = this.P.rain, n = Math.min(this.rainN, Math.round(this.q.rain * e.rain));
    this.use(p);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
    gl.uniform3fv(p.u.uRight, this.right); gl.uniform2f(p.u.uWindV, e.wind * 1.5, 0.8);
    const md = x => ((x % 26) + 26) % 26; gl.uniform3f(p.u.uCamB, md(this.cam.x), md(this.cam.y), md(this.cam.z));
    const L = e.night ? 0.25 : 0.5;
    const pass = (snow, cnt) => {
      gl.uniform1f(p.u.uSnow, snow); gl.uniform1f(p.u.uRainA, snow ? 0.9 : 0.35); gl.uniform3f(p.u.uRainC, L + 0.1, L + 0.12, L + 0.15);
      G.attr(p.a.aQ, this.quadB, 2); G.attr(p.a.iS, this.rainB, 3, gl.FLOAT, false, 12, 0, 1);
      G.drawArraysInstanced(gl.TRIANGLES, 0, 6, cnt);
    };
    pass(0, n); if (e.snow) pass(1, Math.round(n * 0.4));
    gl.depthMask(true); gl.disable(gl.BLEND);
  }

  // ─────────── точечные огни: ближайшие к камере ───────────
  pickLights() {
    const e = this.env, N = this.q.nl || 6; this.nl = 0;
    if (!this.LP) { this.LP = new Float32Array(32); this.LC = new Float32Array(24); }
    if (e.night < 0.25) return;
    const c = this.cam, cand = this.lightCand; // из gather
    for (const l of this.sc.lights) { const d = Math.hypot(l.x - c.x, l.z - c.z); if (d < l.r * 2.5 + 30) cand.push({ x: l.x, y: l.y, z: l.z, c: l.c, r: l.r, k: d / l.r }); }
    cand.sort((a, b) => a.k - b.k);
    const k = e.night;
    for (let i = 0; i < Math.min(N, cand.length); i++) {
      const l = cand[i];
      this.LP.set([l.x - c.x, l.y - c.y, l.z - c.z, l.r], i * 4);
      this.LC.set([l.c[0] * k * (l.i || 1), l.c[1] * k * (l.i || 1), l.c[2] * k * (l.i || 1)], i * 3);
      this.nl++;
    }
  }

  // ─────────── мир → инстансы ───────────
  // Видимое положение машины догоняет симуляцию плавно: разгон и торможение с ограниченным ускорением (без рывка
  // «стоп → 7 м/с → стоп»); на ×4/×16 — во столько же раз быстрее. Перед стартом — реакция водителя, а если кто-то
  // из машины стоит снаружи и садится — ждём, пока дойдёт до двери (v.board считает carPeople).
  // v: s, o — видимое положение · vel — скорость · pend/go — «сейчас поедет» и когда · rest — сколько игровых секунд
  // стоит · brk — до какого времени горят стоп-сигналы · lod — подробная модель (с гистерезисом) · board — садятся
  carPose(c, out, smoothIt) {
    let v = this.vis.get(c.id);
    const target = c.s, to = LANE_OFF[c.lane] ?? 0, t = this.time;
    if (!v) { v = { s: target, o: to, t, vel: 0, pend: 0, go: 0, rest: 1e9, brk: 0, board: 0, lod: -1 }; this.vis.set(c.id, v); }
    const dt = Math.min(0.1, Math.max(0, t - v.t)); v.t = t;
    const D = target - v.s, aD = Math.abs(D);
    if (smoothIt) {
      const k = clamp(this.rate / 60, 1, 16), vmax = 7 * k, acc = 3.2 * k;
      if (aD > Math.max(45, vmax * 3)) { v.s = target; v.vel = 0; v.pend = 0; } // сильно отстала (прыжок очереди) — сразу
      else if (aD > 0.004) {
        if (!v.pend && v.vel === 0 && aD > 0.05) { v.pend = 1; v.go = t + (k > 1.5 ? 0 : 0.2 + hash01(c.id, 91) * 0.6); } // реакция
        let vd = Math.min(vmax, Math.sqrt(2 * acc * aD));
        if (v.pend) { if (t < v.go || (v.board > 0 && t < v.go + 3 && aD < 25)) vd = 0; else v.pend = 0; }
        if (vd >= v.vel) v.vel = Math.min(vd, v.vel + acc * dt);
        else { v.vel = Math.max(vd, v.vel - acc * 2 * dt); v.brk = t + 0.6; }
        const step = Math.min(aD, v.vel * dt);
        v.s += Math.sign(D) * step;
        if (aD - step <= 0.004) { v.s = target; v.vel = 0; v.pend = 0; v.brk = t + 1.2; }
      } else { v.s = target; v.vel = 0; v.pend = 0; }
      v.o += clamp(to - v.o, -1.5 * k * dt, 1.5 * k * dt);
    } else { v.s = target; v.o = to; v.vel = 0; v.pend = 0; }
    if (dt > 0) { if (v.vel === 0 && !v.pend && Math.abs(target - v.s) < 0.004) v.rest += this.dG; else v.rest = 0; }
    const q = this.T.at(v.s, v.o, out);
    out.fx = -q.ny; out.fz = q.nx; out.moving = v.vel > 0.02; out.vs = v.s; out.gy = this.T.surf(v.s, v.o); out.v = v;
    return out;
  }
  // в GPU всё уходит относительно камеры (double → малые float32): pose.x − cam.x и т. д.
  gather(camS) {
    const w = this.w, Q = w.queue, a = Q.cars, q = this.q, e = this.env, cam = this.cam, CARS = w.C.CARS, t = this.time;
    for (const k in this.dyn) this.dyn[k].fb.reset();
    this.lightCand = []; this.targets.length = 0; this.near.length = 0;
    const glow = this.dyn.glow.fb, blob = this.dyn.blob.fb, night = e.night, pose = this._pose || (this._pose = {});
    const R = Math.max(q.carB, night > 0.2 ? q.lightD : 0), s0 = camS - R, s1 = camS + R;
    const pc = w.pcar, cx = cam.x, cy = cam.y, cz = cam.z, blobR = Math.min(q.carB, 260);
    let nCar = 0, engN = 0;
    this.pcarPose = null;
    for (let i = Q.lowerBound(s0); i < a.length && a[i].s <= s1; i++) {
      const c = a[i], m = CARS.models[c.mi] || CARS.models[0];
      const near = Math.abs(c.s - camS) < 700;
      this.carPose(c, pose, near);
      const v = pose.v, y = pose.gy, dx = pose.x - cx, dz = pose.y - cz, d = Math.hypot(dx, dz), ry = y - cy;
      const col = c.color ? hex(c.color) : hex(CARS.colors[c.ci]?.hex || '#999999');
      const hh = hash01(c.id, 3), body = m.body || 'sedan', B = BODY[body];
      // стоп-сигналы: тормозит / держит тормоз перед стартом / только что встал (+ редкие случайные на 7 с)
      const tail = night > 0.3 && (c.eng || c.pl || hh < 0.55) ? 1 : 0, brake = v.brk > t || v.pend || (tail && (hash01(c.id, Math.floor(t / 7)) < 0.08)) ? 2 : 0;
      const head = night > 0.3 && c.eng && hh < 0.3 ? 4 : 0, lug = (m.seats >= 7 || hash01(c.id, 5) < 0.18) ? 8 : 0;
      const flags = tail + brake + head + lug;
      const isMine = c === pc;
      if (c.eng && d < 80 && !isMine) engN++;
      if (isMine) this.pcarPose = { x: pose.x, y, z: pose.y, fx: pose.fx, fz: pose.fz, body, col: c.color || '#8e969f', sx: m.w / B.w, sz: m.l / B.l, B, vs: pose.vs };
      const vis = this.visible(pose.x, y + 1, pose.y, 4);
      // подробная модель / коробка — с гистерезисом ±12 м (не мигает на границе)
      const det = v.lod === 1 ? d < q.carD + 12 : v.lod === 0 ? d < q.carD - 12 : d < q.carD; v.lod = det ? 1 : 0;
      if (vis >= 0 && !(isMine && this.inCarView)) {
        if (det) { this.dyn[body].fb.push(dx, ry, dz, 1, pose.fx, pose.fz, m.w / B.w, m.l / B.l, col[0], col[1], col[2], flags); nCar++; }
        else if (d < q.carB) { this.dyn.box.fb.push(dx, ry, dz, (B.roof / 1.42), pose.fx, pose.fz, m.w / 1.76, m.l / 4.4, col[0], col[1], col[2], flags & 3); nCar++; }
      }
      if (d < blobR && vis >= 0) blob.push(dx, ry + 0.02, dz, 0.8 * clamp((blobR - d) / 60, 0, 1), pose.fx, pose.fz, m.w / 2 + 0.5, m.l / 2 + 0.6); // мягкая тень, гаснет к краю дальности
      // огни: стоп-сигналы лентой, фары
      if (tail && vis >= 0) {
        const hl = m.l / 2 + 0.05, bx = pose.x - pose.fx * hl, bz = pose.y - pose.fz * hl, rx = -pose.fz, rz = pose.fx, ty = y + (B.trunk - 0.22);
        const I = brake ? 2.2 : 1.0;
        if (d < 900) { for (const s of [-1, 1]) glow.push(bx + rx * s * (m.w / 2 - 0.25) - cx, ty - cy, bz + rz * s * (m.w / 2 - 0.25) - cz, 0.22, 1, 0.1, 0.05, I * 1.5); }
        else glow.push(bx - cx, ty - cy, bz - cz, 0.35, 1, 0.12, 0.06, I * 2.2);
        if (d < 320) glow.push(bx - pose.fx * 1.3 - cx, ry + 0.03, bz - pose.fz * 1.3 - cz, 2.0, 0.9, 0.08, 0.04, 10 + I * 0.35); // пятно на асфальте
        if (e.wet > 0.2 && d < 400) glow.push(bx - pose.fx * 0.8 - cx, ry + 0.04, bz - pose.fz * 0.8 - cz, 1.2, 1, 0.1, 0.05, 20 + I * 0.5);
        if (d < 60 && !isMine) this.lightCand.push({ x: bx - pose.fx * 0.9, y: ty - 0.2, z: bz - pose.fz * 0.9, c: [1, 0.06, 0.03], r: brake ? 6 : 4, k: d / 7, i: (brake ? 0.9 : 0.45) * (this.inCarView && d < 9 ? 0.3 : 1) });
      }
      if (head && vis >= 0 && d < 1500) {
        const hl = m.l / 2, fx = pose.x + pose.fx * hl, fz = pose.y + pose.fz * hl, rx = -pose.fz, rz = pose.fx, hy = y + B.hood - 0.24;
        for (const s of [-1, 1]) glow.push(fx + rx * s * (m.w / 2 - 0.3) - cx, hy - cy, fz + rz * s * (m.w / 2 - 0.3) - cz, 0.3, 1, 0.95, 0.8, 1.6);
        if (d < 300) glow.push(fx + pose.fx * 5 - cx, ry + 0.03, fz + pose.fz * 5 - cz, 4.5, 1, 0.93, 0.75, 10.5);
        if (d < 80) this.lightCand.push({ x: fx + pose.fx * 3, y: hy + 0.4, z: fz + pose.fz * 3, c: [1, 0.93, 0.78], r: 16, k: d / 16, i: 1.2 });
      }
      // цели: машины рядом
      if (d < 30 && !(isMine && this.inCarView)) {
        const tg = c.pl ? { kind: 'own', car: c } : { kind: 'car', car: c, npc: c.npc || 'c:' + c.id + ':0', who: c.npc ? null : w.person(c.id, 0) };
        this.targets.push({ box: 1, x: pose.x, y, z: pose.y, fx: pose.fx, fz: pose.fz, a: m.w / 2, b: m.l / 2, h: B.roof, tg, name: c.pl ? 'Моя машина' : (c.npc ? w.nameOf(c.npc) : CARS.models[c.mi]?.name || 'машина'), icon: c.pl ? 'car' : body === 'van' ? 'van' : 'car' });
        this.near.push({ box: 1, x: pose.x, z: pose.y, fx: pose.fx, fz: pose.fz, a: m.w / 2 + 0.1, b: m.l / 2 + 0.1, car: c });
      }
    }
    this.stats.cars = nCar; this.engNear = Math.min(1, engN / 6);
    // очистка видимых положений
    if (this.vis.size > 4000) { const ids = new Set(); for (let i = Q.lowerBound(camS - 800); i < a.length && a[i].s <= camS + 800; i++) ids.add(a[i].id); for (const k of this.vis.keys()) if (!ids.has(k)) this.vis.delete(k); }
    this.gatherPeople(camS);
    this.gatherStatic();
  }
  // x, y, z — мир (double); в буфер — относительно камеры
  person(x, y, z, fx, fz, pose, ph, seed, tg = null, name = '', icon = 'user', o = {}) {
    // фактическое положение на экране — targetPos()/inReach() должны мерить дистанцию от него, а не
    // домысливать «у своей машины»: гуляющие пассажиры отходят от машины на десятки метров (finding 13)
    if (tg) tg.pos = { x, y: z };
    const fb = this.dyn.ppl.fb, kid = o.kid ? 1 : 0, cam = this.cam;
    const coat = hex(o.coat || COATS[Math.floor(hash01(seed, 11) * COATS.length)]), pants = hex(PANTS[Math.floor(hash01(seed, 12) * PANTS.length)]);
    const hat = hash01(seed, 14) < (this.env.temp < 12 ? 0.55 : 0.2), hair = hex(hat ? ['#7a2f2f', '#2d4f82', '#333333', '#6f7446', '#c9b48a'][Math.floor(hash01(seed, 15) * 5)] : HAIR[Math.floor(hash01(seed, 13) * HAIR.length)]);
    const skin = SKIN[Math.floor(hash01(seed, 16) * SKIN.length)], hgt = (kid ? 0.62 : 0.93 + hash01(seed, 17) * 0.14);
    const bag = hash01(seed, 18) < 0.4 ? 1 : 0;
    fb.push(x - cam.x, y - cam.y, z - cam.z, hgt, fx, fz, pose, ph, coat[0], coat[1], coat[2], bag, pants[0], pants[1], pants[2], skin, hair[0], hair[1], hair[2], kid);
    this.dyn.blob.fb.push(x - cam.x, y + 0.03 - cam.y, z - cam.z, 0.55, fx, fz, 0.42 * hgt, 0.42 * hgt);
    const d = Math.hypot(x - cam.x, z - cam.z);
    if (tg && d < 25) this.targets.push({ cyl: 1, x, y, z, r: 0.38, h: 1.75 * hgt, tg, name, icon });
    if (d < 12) this.near.push({ x, z, r: 0.3 });
    this.stats.ppl++;
  }
  // ─── люди ───
  // У машин: у каждого своя точка в координатах дороги (s, смещение) — стоит на месте, а не едет вместе с машиной.
  // Машина собралась ехать: водитель идёт к двери и садится — машина ждёт; пассажиры и гуляющие догоняют
  // пешком; отстал далеко и не в кадре — переносим к машине. На ×4/×16 пешком не ходят: сразу в машине или у неё.
  // Выходят, когда машина постояла (игровое время). Пешие к КПП и именные пешие идут за симуляцией с человеческой
  // скоростью (симуляция в 60 раз быстрее жизни).
  gatherPeople(camS) {
    const w = this.w, Q = w.queue, a = Q.cars, q = this.q, e = this.env, cam = this.cam, T = this.T, R = q.pplR, pp = this._pp || (this._pp = {});
    this.stats.ppl = 0;
    const maxN = q.pplN, night = e.night > 0.5, cold = e.temp < 10, t = this.time, fast = this.rate > 90;
    const dtR = Math.min(0.1, Math.max(0, t - (this.pplT ?? t))); this.pplT = t;
    const hidden = (x, y, z) => Math.hypot(x - cam.x, z - cam.z) > 70 || this.visible(x, y + 1, z, 1.2) < 0;
    const X = { share: lerp(0.4, 0.17, smooth(0.3, 0.7, e.night)), cold, night, fast, t, dtR, hidden, pp };
    // продавцы — раньше очереди из людей и без общего лимита на самого продавца (только на декоративную
    // очередь покупателей у прилавка): у КПП пешие иначе съедают весь бюджет maxN первыми, и лоток остаётся
    // видимым, но без продавца — прицел бьёт в пустоту (finding 7, 3-spatial.md причина 3)
    for (const s of this.sellers) {
      const o = s.o; if (!w.econ.active(o) || Math.hypot(s.x - cam.x, s.z - cam.z) > R * 1.6) continue;
      const npc = o.npc && w.npcDefs.get(o.npc);
      const bx = s.x - s.fx * 0.45, bz = s.z - s.fz * 0.45;
      this.person(bx, s.g, bz, s.fx, s.fz, 6, o.s % 7, (o.s | 0) + 5, { kind: 'seller', seller: o, npc: o.npc }, npc ? npc.name : o.name, npc ? npc.icon : 'seller', { coat: npc ? (o.priceMul === 0 ? '#2d6fb3' : '#6b3b2a') : null });
      if (this.stats.ppl < maxN) {
        const n = Math.min(9, Math.round(((o.demand[o.goods[0]] || 1) - 1) * 12 + (o.priceMul === 0 ? 5 : 2)) - (night ? 1 : 0));
        for (let k = 0; k < n; k++) {
          const dist = 1.7 + k * 0.75, lat = (hash01(k, o.s | 0) - 0.5) * 1.6 + (k % 2 ? 0.4 : -0.4);
          const x = s.x + s.fx * dist + (-s.fz) * lat, z = s.z + s.fz * dist + s.fx * lat, gg = this.T.ground(x, z, this.sCam).h;
          const pose = k === 0 ? 5 : cold && night ? 4 : hash01(k, 3 + (o.s | 0)) < 0.4 ? 2 : 0;
          const who = w.person(900000 + (o.s | 0) + k, 0);
          this.person(x, gg, z, -s.fx, -s.fz, pose, k * 3.3, (o.s | 0) * 13 + k, { kind: 'person', who }, who.name, 'user');
        }
      }
      if (e.night > 0.3) { this.dyn.glow.fb.push(s.lamp[0] - cam.x, s.lamp[1] - cam.y, s.lamp[2] - cam.z, 0.35, 1, 0.85, 0.55, 3.0); this.dyn.glow.fb.push(s.x - cam.x, s.g + 0.05 - cam.y, s.z - cam.z, 5, 1, 0.75, 0.45, 12); this.lightCand.push({ x: s.lamp[0], y: s.lamp[1], z: s.lamp[2], c: [1, 0.78, 0.45], r: 11, k: Math.hypot(s.x - cam.x, s.z - cam.z) / 11, i: 1.5 }); }
    }
    // машины от камеры наружу: при лимите людей отпадают дальние, а не «те, что дальше по s»
    let lo = Q.lowerBound(camS) - 1, hi = lo + 1;
    while (this.stats.ppl < maxN) {
      const okL = lo >= 0 && a[lo].s >= camS - R, okH = hi < a.length && a[hi].s <= camS + R;
      if (!okL && !okH) break;
      const c = okL && (!okH || camS - a[lo].s <= a[hi].s - camS) ? a[lo--] : a[hi++];
      if (!c.pl) this.carPeople(c, X);
    }
    if (this.pst.size > 3000) for (const [k, st] of this.pst) if (st.t < t - 20) this.pst.delete(k);
    // пешие к КПП
    for (const pd of Q.peds) {
      let pv = this.pedV.get(pd.id);
      if (!pv) { if (Math.abs(pd.s - camS) > R * 1.5) continue; pv = { s: pd.s, t }; this.pedV.set(pd.id, pv); }
      pv.t = t;
      const D = pd.s - pv.s; let walking = Math.abs(D) > 0.05;
      if (walking) {
        T.at(pv.s, pd.lat, pp);
        if (Math.abs(D) > 35 && hidden(pp.x, T.roadH(pv.s), pp.y)) { pv.s = pd.s; walking = pd.st === 0 && !fast; }
        else pv.s += Math.sign(D) * Math.min(Math.abs(D), (pd.bike ? 1.5 : 1.3) * dtR);
      }
      if (Math.abs(pv.s - camS) > R * 1.5 || this.stats.ppl >= maxN) continue;
      const wob = walking ? Math.sin(t * 0.3 + pd.ph) * 0.4 : 0;
      T.at(pv.s, pd.lat + wob, pp);
      const g = T.surf(pv.s, pd.lat + wob), sg = Math.sign(D) || -1, fx = pp.ny * sg, fz = -pp.nx * sg; // по ходу
      const pose = walking ? (pd.bike ? 7 : 1) : (cold ? (hash01(pd.id, 3) < 0.5 ? 4 : 2) : hash01(pd.id, 3) < 0.4 ? 2 : 0);
      const tg = { kind: 'person', ped: pd, who: w.pedPerson(pd) };
      const sx = walking ? fx : pp.ny * 0.3 + pp.nx, sz = walking ? fz : -pp.nx * 0.3 + pp.ny;
      this.person(pp.x, g, pp.y, sx, sz, pose, pd.ph * 10, 1e6 + pd.id, tg, tg.who.name, pd.bike ? 'bike' : 'walk');
      if (pd.bike) { const kind = hash01(pd.id, 9) < 0.35 ? 'scooter' : 'bike'; this.dyn[kind].fb.push(pp.x + pp.nx * 0.5 - cam.x, g - cam.y, pp.y + pp.ny * 0.5 - cam.z, 1, walking ? fx : pp.ny, walking ? fz : -pp.nx, 1, 1, 0.6, 0.2, 0.15, 0); }
    }
    if (this.pedV.size > 600) for (const [k, pv] of this.pedV) if (pv.t < t - 20) this.pedV.delete(k);
    // именные пешие: держатся рядом с игроком — видимое положение догоняет шагом
    for (const id in w.npcs) {
      const d = w.npcDefs.get(id); if (!d || d.kind !== 'walker' || !w.npcPresent(id) || w.npcs[id].passenger) continue;
      const p = w.npcPos(id); if (!p) continue;
      let wv = this.walkV.get(id); if (!wv) { wv = { s: p.s }; this.walkV.set(id, wv); }
      const lat = w.npcs[id].lat ?? 0, D = p.s - wv.s; let moving = Math.abs(D) > 0.15;
      if (moving) {
        T.at(wv.s, lat, pp);
        if (Math.abs(D) > 40 && hidden(pp.x, T.roadH(wv.s), pp.y)) { wv.s = p.s; moving = false; }
        else wv.s += Math.sign(D) * Math.min(Math.abs(D), 1.5 * dtR);
      }
      if (Math.abs(wv.s - camS) > R * 1.5) continue;
      T.at(wv.s, lat, pp);
      const g = T.surf(wv.s, lat), sg = Math.sign(D) || 1;
      this.person(pp.x, g, pp.y, moving ? pp.ny * sg : -pp.nx, moving ? -pp.nx * sg : -pp.ny, moving ? 1 : 5, 3, id.length * 97, { kind: 'person', npc: id }, d.name, d.icon, { coat: '#3d6e8f' });
      if (d.id === 'soslan') this.dyn.scooter.fb.push(pp.x - pp.nx * 0.8 - cam.x, g - cam.y, pp.y - pp.ny * 0.8 - cam.z, 1, pp.ny, -pp.nx, 1.6, 1.6, 0.2, 0.2, 0.2, 0);
    }
  }
  // люди одной машины. st.m: 0 — в машине, 1 — стоит, 2 — идёт к своей точке, 3 — идёт к двери (садится)
  carPeople(c, X) {
    const w = this.w, T = this.T, v = this.vis.get(c.id), pp = X.pp, t = X.t; if (!v) return;
    const cs = v.s, co = v.o, side = c.lane ? 1 : -1, moving = v.vel > 0.02 || v.pend || Math.abs(c.s - v.s) > 0.05;
    const pairAll = c.n >= 2 && hash01(c.id, 21) <= X.share && hash01(c.id, 22) <= X.share && hash01(c.id, 31) < 0.62 && hash01(c.id, 32) < 0.62;
    let board = 0;
    for (let k = 0; k < Math.min(2, c.n); k++) {
      const seed = c.id * 8 + k + 1, hh = hash01(c.id, k + 21), npcK = !!(c.npc && k === 0), want = hh <= X.share || npcK;
      let st = this.pst.get(seed);
      if (!st && !want) continue;
      const mode = hash01(c.id, k + 31), wander = !npcK && mode >= 0.62, boarder = k === 0 && !wander; // садится водитель, пассажир догоняет пешком
      const reach = (mode - 0.55) * 170 * (hash01(c.id, 41) < 0.5 ? -1 : 1);
      // своя точка у машины (стоящие) или конец «прогулки» (гуляющие)
      const spot = st => {
        if (wander) return [cs + (st.leg ? reach : reach * 0.08), side * (4.9 + hash01(c.id, k) * 1.4)];
        const s1 = cs + (k - 0.5) * 1.7 + (hash01(c.id, k + 41) - 0.5) * 2;
        return [s1, st.pose === 3 ? co + side * 3.2 : co + side * (2.05 + k * 0.55 + hash01(c.id, k + 43) * 0.6)];
      };
      const door = () => [cs + (k === 0 ? -0.35 : 0.75), co + side * 1.15];
      const stand = st => { // поза стоящего — выбирается, когда вышел (не меняется разом у всех на закате)
        const r = hash01(c.id, k + 51);
        st.pose = wander ? (hash01(seed, 7) < 0.5 ? 0 : 2) : X.cold && X.night ? (r < 0.35 ? 4 : r < 0.55 ? 2 : r < 0.7 ? 8 : r < 0.85 ? 0 : 5) : (r < 0.28 ? 0 : r < 0.48 ? 2 : r < 0.68 ? 5 : r < 0.8 ? 8 : r < 0.92 ? 3 : 4);
        if (pairAll && !wander && (st.pose === 3 || st.pose === 4)) st.pose = 5;
      };
      if (!st) {
        st = { m: 0, s: cs, o: co, t, pose: 0, leg: hash01(seed, 3) < 0.5 ? 1 : 0, until: 0, fx: 0, fz: 1 };
        this.pst.set(seed, st);
        if (!moving || !(boarder || X.fast)) { stand(st); [st.s, st.o] = spot(st); st.m = 1; st.until = t + hash01(seed, 4) * 5; }
      }
      st.t = t;
      const need = boarder ? 90 + hash01(c.id, k + 71) * 300 : 20 + hash01(c.id, k + 71) * 100; // игровых секунд стоянки
      let tgt = null, spd = 1.3 + hash01(seed, 5) * 0.35;
      if (st.m === 0) { // в машине: выйти, когда машина постояла
        if (want && !moving && v.rest > need) {
          stand(st);
          if (X.fast) { [st.s, st.o] = spot(st); st.m = 1; } else { [st.s, st.o] = door(); st.m = 2; }
          st.until = t + 2 + hash01(seed, 6) * 4;
        }
      }
      if (st.m === 1) { // стоит
        const [ts, to] = spot(st);
        if (!want || (!wander && v.pend && boarder)) st.m = X.fast ? 0 : 3;
        else if (X.fast && moving) st.m = 0;
        else if (wander && t > st.until) { st.leg ^= 1; st.m = 2; }
        else if (Math.hypot(ts - st.s, to - st.o) > 0.8) st.m = 2;
      }
      if (st.m === 2) { // идёт к своей точке (догоняет машину / гуляет)
        const [ts, to] = spot(st), lag = Math.hypot(ts - st.s, to - st.o);
        if (!want || (!wander && v.pend && boarder && lag < 12)) st.m = X.fast ? 0 : 3;
        else if (X.fast || (lag > 30 && X.hidden(...this.worldOf(st.s, st.o)))) { if (moving) st.m = 0; else { [st.s, st.o] = spot(st); st.m = 1; } }
        else if (lag < 0.12) { st.s = ts; st.o = to; st.m = 1; st.until = t + 2 + hash01(seed, 6) * 4; }
        else { tgt = [ts, to]; if (lag > 6) spd *= 1.45; }
      }
      if (st.m === 3) { // к двери и в машину
        const [ts, to] = door(), lag = Math.hypot(ts - st.s, to - st.o);
        if (X.fast || lag < 0.3 || (lag > 30 && X.hidden(...this.worldOf(st.s, st.o)))) st.m = 0;
        else { tgt = [ts, to]; spd = 1.6; board++; }
      }
      if (st.m === 0) continue;
      // шаг
      T.at(st.s, st.o, pp); const x0 = pp.x, z0 = pp.y;
      if (tgt) {
        const ds = tgt[0] - st.s, dd = tgt[1] - st.o, l = Math.hypot(ds, dd), step = Math.min(l, spd * X.dtR);
        if (l > 1e-6) { st.s += ds / l * step; st.o += dd / l * step; }
        T.at(st.s, st.o, pp);
        const mx = pp.x - x0, mz = pp.y - z0, ml = Math.hypot(mx, mz);
        if (ml > 1e-4) { st.fx = mx / ml; st.fz = mz / ml; }
        else if (l > 1e-6) { st.fx = (pp.ny * ds - pp.nx * dd) / l; st.fz = (-pp.nx * ds - pp.ny * dd) / l; }
      }
      let fx = st.fx, fz = st.fz, pose = tgt ? 1 : st.pose;
      if (!tgt && !wander) {
        // стоит: лицом к машине / к дороге, пара — друг к другу
        const ang = Math.atan2(-side * pp.ny, -side * pp.nx) + (hash01(c.id, k + 61) - 0.5) * 2.2;
        fx = Math.cos(ang); fz = Math.sin(ang);
        if (pairAll) { const sg = k === 0 ? 1 : -1; fx = pp.ny * sg; fz = -pp.nx * sg; }
      }
      const g = T.surf(st.s, st.o);
      const tg = c.npc && k === 0 ? { kind: 'car', npc: c.npc, car: c } : { kind: 'person', who: w.person(c.id, k + 1), car: c };
      const name = c.npc && k === 0 ? w.nameOf(c.npc) : w.whoNames['c:' + c.id + ':' + (k + 1)] || w.person(c.id, k + 1).name;
      this.person(pp.x, g, pp.y, fx, fz, pose, hash01(c.id, k + 21) * 40 + k, seed, tg, name, c.npc && k === 0 ? (w.npcDefs.get(c.npc)?.icon || 'user') : 'user', { kid: k === 1 && hash01(c.id, 71) < 0.15 });
    }
    v.board = board;
  }
  worldOf(s, o) { const p = this.T.at(s, o, this._wo || (this._wo = {})); return [p.x, p.h, p.y]; }
  // статичные огни (КПП, АЗС, окна) — спрайты и пятна
  gatherStatic() {
    const e = this.env; if (e.night < 0.2) return;
    const fb = this.dyn.glow.fb, cam = this.cam, k = e.night;
    for (const l of this.sc.lights) {
      const d = Math.hypot(l.x - cam.x, l.z - cam.z); if (d > 9000) continue;
      if (this.visible(l.x, l.y, l.z, 30) < 0) continue;
      const big = l.big ? 1.6 : 1;
      fb.push(l.x - cam.x, l.y - cam.y, l.z - cam.z, l.kind === 'house' ? 0.3 : 0.6 * big, l.c[0], l.c[1], l.c[2], (l.kind === 'kpp' ? 4 : 2.2) * k);
      if (l.pool && d < 1500) fb.push(l.x - cam.x, this.T.ground(l.x, l.z, this.sCam).h + 0.05 - cam.y, l.z - cam.z, l.pool, l.c[0], l.c[1], l.c[2], 10 + (l.kind === 'kpp' ? 3 : 1.2) * k);
    }
    if (this.flash) fb.push(this.fwd[0] * 3, -1.5, this.fwd[2] * 3, 0.01, 0, 0, 0, 0);
  }

  // ─────────── прицел: цель по лучу из центра экрана ───────────
  pick(maxD = 6) {
    const c = this.cam, f = this.fwd; let best = null, bd = maxD;
    for (const t of this.targets) {
      let d = -1;
      if (t.cyl) {
        // луч против вертикального цилиндра
        const ox = c.x - t.x, oz = c.z - t.z, A = f[0] * f[0] + f[2] * f[2], B = 2 * (ox * f[0] + oz * f[2]), C = ox * ox + oz * oz - t.r * t.r, D = B * B - 4 * A * C;
        if (D < 0 || A < 1e-6) continue;
        const k = (-B - Math.sqrt(D)) / (2 * A), k2 = (-B + Math.sqrt(D)) / (2 * A);
        for (const kk of [k, k2]) { if (kk < 0) continue; const y = c.y + f[1] * kk; if (y >= t.y && y <= t.y + t.h) { d = kk; break; } }
        if (d < 0) { // торцы: попадание сверху (смотрим вниз на ребёнка)
          if (f[1] < -0.05) { const kk = (t.y + t.h - c.y) / f[1]; const x = c.x + f[0] * kk - t.x, z = c.z + f[2] * kk - t.z; if (kk > 0 && x * x + z * z < t.r * t.r) d = kk; }
        }
      } else if (t.box) {
        const ox = c.x - t.x, oy = c.y - t.y, oz = c.z - t.z;
        const lx = -ox * t.fz + oz * t.fx, lz = ox * t.fx + oz * t.fz, dx = -f[0] * t.fz + f[2] * t.fx, dz = f[0] * t.fx + f[2] * t.fz;
        let t0 = 0, t1 = 1e9;
        for (const [o, dd, lo, hi] of [[lx, dx, -t.a, t.a], [oy, f[1], 0, t.h], [lz, dz, -t.b, t.b]]) {
          if (Math.abs(dd) < 1e-8) { if (o < lo || o > hi) { t0 = 2e9; break; } continue; }
          let a1 = (lo - o) / dd, a2 = (hi - o) / dd; if (a1 > a2) [a1, a2] = [a2, a1];
          t0 = Math.max(t0, a1); t1 = Math.min(t1, a2);
        }
        if (t0 <= t1 && t0 < 1e9) d = t0;
      }
      if (d >= 0 && d < bd) { bd = d; best = t; }
    }
    return best ? { ...best, dist: bd } : null;
  }
  // ─────────── препятствия для ходьбы: вытолкнуть круг (x, z, r) ───────────
  collide(x, z, r) {
    const push = (px, pz) => { x += px; z += pz; };
    for (const o of this.near) {
      if (o.box) {
        const dx = x - o.x, dz = z - o.z, lx = -dx * o.fz + dz * o.fx, lz = dx * o.fx + dz * o.fz;
        const cx = clamp(lx, -o.a, o.a), cz = clamp(lz, -o.b, o.b), ex = lx - cx, ez = lz - cz, d = Math.hypot(ex, ez);
        if (d < r) {
          let nx, nz, k;
          if (d > 1e-5) { nx = ex / d; nz = ez / d; k = r - d; } else { const px = o.a - Math.abs(lx), pz = o.b - Math.abs(lz); if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; k = px + r; } else { nx = 0; nz = Math.sign(lz) || 1; k = pz + r; } }
          push((-nx * o.fz + nz * o.fx) * k, (nx * o.fx + nz * o.fz) * k);
        }
      } else { const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz), rr = o.r + r; if (d < rr && d > 1e-4) push(dx / d * (rr - d), dz / d * (rr - d)); }
    }
    const gx = Math.floor(x / 64), gz = Math.floor(z / 64);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const L2 = this.cgrid.get((gx + a) + ',' + (gz + b)); if (!L2) continue;
      for (const o of L2) {
        if (o.r) { const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz), rr = o.r + r; if (d < rr && d > 1e-4) push(dx / d * (rr - d), dz / d * (rr - d)); }
        else {
          const dx = x - o.x, dz = z - o.z, lx = -dx * o.fz + dz * o.fx, lz = dx * o.fx + dz * o.fz;
          const cx = clamp(lx, -o.a, o.a), cz = clamp(lz, -o.b, o.b), ex = lx - cx, ez = lz - cz, d = Math.hypot(ex, ez);
          if (d < r) {
            let nx, nz, k; if (d > 1e-5) { nx = ex / d; nz = ez / d; k = r - d; } else { const px = o.a - Math.abs(lx), pz = o.b - Math.abs(lz); if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; k = px + r; } else { nx = 0; nz = Math.sign(lz) || 1; k = pz + r; } }
            push((-nx * o.fz + nz * o.fx) * k, (nx * o.fx + nz * o.fz) * k);
          }
        }
      }
    }
    return [x, z];
  }
}
return { View3D };
});
