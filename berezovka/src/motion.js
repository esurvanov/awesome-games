// «Берёзовка» — ДВИЖЕНИЕ. Принцип наименьшего действия: скорость меняется с конечным ускорением,
// поворот — с конечной угловой скоростью (на ходу — дугой), темп клипа = скорость / длина шага клипа.
// Чистая логика (человек, машина) не зависит от three.js и тестируется отдельно; анимационная часть — ниже.
import * as THREE from 'three';

export const G = 9.81;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const wrapA = a => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) };

/* ================= ЧЕЛОВЕК ================= */
export const HUMAN = {
  walk: 1.5, run: 4.0, sprint: 5.5,      // м/с (снег)
  acc: 3.0, accIce: 1.0,                 // разгон, м/с²
  dec: 5.5, decIce: 1.4,                 // торможение, м/с²
  grip: 30, gripIce: 1.6,                // как быстро вектор скорости догоняет направление тела, м/с²
  turnStand: 2.4,                        // разворот на месте, рад/с (ворота ≤ 3)
  turnMove: 5.0, latAcc: 4.5,            // на ходу: ω ≤ min(turnMove, latAcc/v) → дуга радиуса v²/latAcc
  angAcc: 14,                            // угловое ускорение, рад/с²
  jumpH: 0.47                            // высота прыжка, м
};
export const jumpV = (h = HUMAN.jumpH) => Math.sqrt(2 * G * h);

// s: {h, spd, w, vx, vz}; inp: {x, z (желаемое направление в мире, |.|≤1), gait:'walk'|'run'|'sprint'}; ice: bool
export function humanStep(s, inp, dt, ice) {
  const H = HUMAN, mag = Math.min(1, Math.hypot(inp.x, inp.z));
  let vt = 0, diff = 0;
  if (mag > .05) {
    diff = wrapA(Math.atan2(inp.x, inp.z) - s.h);
    // чем больше нужно повернуть, тем ниже целевая скорость: сначала тормозим, потом поворачиваем
    const k = clamp((Math.cos(diff) + .25) / 1.25, 0, 1);
    vt = mag * H[inp.gait || 'run'] * k;
  }
  // угловая скорость
  const wMove = Math.min(H.turnMove, H.latAcc / Math.max(s.spd, .1));
  const wMax = H.turnStand + (wMove - H.turnStand) * clamp((s.spd - .5) / 1, 0, 1);
  const wT = mag > .05 ? clamp(diff * 7, -wMax, wMax) : 0;
  s.w = s.w + clamp(wT - s.w, -H.angAcc * dt, H.angAcc * dt);
  s.w = clamp(s.w, -wMax, wMax);
  s.h = wrapA(s.h + s.w * dt);
  // скорость: разгон/торможение с ограниченным ускорением, плавный подход к цели
  const acc = ice ? H.accIce : H.acc, dec = ice ? H.decIce : H.dec;
  const a = clamp((vt - s.spd) * 3.5, -dec, acc);
  s.spd = Math.max(0, s.spd + a * dt);
  // вектор скорости догоняет направление тела (на льду — медленно: занос)
  const dx = Math.sin(s.h) * s.spd - s.vx, dz = Math.cos(s.h) * s.spd - s.vz, dl = Math.hypot(dx, dz);
  const gmax = (ice ? H.gripIce : H.grip) * dt;
  if (dl > gmax) { s.vx += dx / dl * gmax; s.vz += dz / dl * gmax } else { s.vx += dx; s.vz += dz }
  return s;
}

/* ================= «КОПЕЙКА» (ВАЗ-2101) ================= */
export const CAR = {
  m: 1000, P: 40000,                 // масса, кг; мощность на колёсах, Вт
  muDrive: .22,                      // сцепление при разгоне (снег, задний привод) → тяга до μ·m·g
  cdA: .43 * 1.85, rho: 1.3, crr: .025,
  vMax: 140 / 3.6, vRev: 6,
  brake: 7.0, brakeIce: 1.2,         // торможение, м/с²
  engBrake: .45,                     // торможение двигателем при отпущенном газе, м/с²
  wb: 2.42, track: 1.32, hcg: .55,
  steerMax: .6, steerV: 11, steerRate: 1.6, steerBack: 2.6,  // руль: δ(v)=steerMax/(1+(v/steerV)²)
  latMu: .62, latMuIce: .12,         // боковое сцепление, g
  k: 17000, c: 1500, arb: 1.6,       // пружина и амортизатор на колесо, стабилизатор (множитель крена)
  Ip: 1500, Ir: 420
};
export const steerLimit = v => CAR.steerMax / (1 + (v / CAR.steerV) ** 2);

// c: {x,z,h,vx,vz,steer, y,vy,pitch,wp,roll,wr, ax,al}; inp: {thr:-1..1, st:-1..1, hb}; env: {ice, ground(x,z)}
export function carStep(c, inp, dt, env) {
  const C = CAR, fx = Math.sin(c.h), fz = Math.cos(c.h), rx = Math.cos(c.h), rz = -Math.sin(c.h);
  const vOld = [c.vx, c.vz];
  let along = c.vx * fx + c.vz * fz;
  const sp = Math.hypot(c.vx, c.vz);
  // продольная сила
  let F = 0;
  const drag = .5 * C.rho * C.cdA * along * Math.abs(along) + C.crr * C.m * G * Math.sign(along) * Math.min(1, Math.abs(along) / .5);
  if (inp.thr > 0) {
    if (along < -.3) F = -C.m * (env.ice ? C.brakeIce : C.brake) * Math.sign(along);         // тормоз при заднем ходе
    else F = Math.min(C.muDrive * (env.ice ? .45 : 1) * C.m * G, C.P / Math.max(along, 1)) * inp.thr;
  } else if (inp.thr < 0) {
    if (along > .3) F = -C.m * (env.ice ? C.brakeIce : C.brake);
    else F = -C.m * 2.2 * (along > -C.vRev ? 1 : 0);
  } else F = -C.m * C.engBrake * Math.sign(along) * Math.min(1, Math.abs(along) / 1.5);
  let aL = (F - drag) / C.m;
  let nAlong = along + aL * dt;
  if (inp.thr < 0 && along > .3 && nAlong < 0) nAlong = 0;
  if (inp.thr > 0 && along < -.3 && nAlong > 0) nAlong = 0;
  if (inp.thr === 0 && Math.abs(nAlong) < .15) nAlong = 0;
  nAlong = clamp(nAlong, -C.vRev, C.vMax);
  const lat = c.vx * rx + c.vz * rz;
  // руль: угол колёс ограничен и зависит от скорости, крутится с конечной скоростью
  const lim = steerLimit(Math.abs(nAlong)), tgt = inp.st * lim;
  const rate = Math.abs(tgt) < Math.abs(c.steer) ? C.steerBack : C.steerRate;
  c.steer += clamp(tgt - c.steer, -rate * dt, rate * dt);
  // рыскание: кинематика велосипеда, ограниченная боковым сцеплением
  const mu = inp.hb ? C.latMu * .35 : env.ice ? C.latMuIce : C.latMu;
  let r = nAlong * Math.tan(c.steer) / C.wb;
  const rLim = mu * G / Math.max(Math.abs(nAlong), 1) * 1.15;
  r = clamp(r, -rLim, rLim);
  c.h += r * dt;
  // новое направление; боковая скорость гасится сцеплением (на льду и ручнике — занос)
  const f2x = Math.sin(c.h), f2z = Math.cos(c.h), r2x = Math.cos(c.h), r2z = -Math.sin(c.h);
  let latN = (c.vx * r2x + c.vz * r2z);
  const along2 = nAlong;
  const latNew = latN - Math.sign(latN) * Math.min(Math.abs(latN), mu * G * dt * 1.6);
  c.vx = f2x * along2 + r2x * latNew; c.vz = f2z * along2 + r2z * latNew;
  // ускорение в осях кузова (для подвески)
  const ax = (c.vx - vOld[0]) / dt, az = (c.vz - vOld[1]) / dt;
  c.al = clamp(ax * f2x + az * f2z, -30, 30);
  c.ax = clamp(ax * r2x + az * r2z, -30, 30);
  c.x += c.vx * dt; c.z += c.vz * dt;
  c.r = r; c.lat = latNew; c.spd = along2;
  if (env.ground) suspStep(c, dt, env.ground);
  return c;
}

// 4 точки-пружины: колёса (±track/2, ±wb/2); кузов — 3 степени свободы (подъём, тангаж, крен)
const CORN = [[-1, 1], [1, 1], [-1, -1], [1, -1]];
export function suspStep(c, dt, ground, sub = 3) {
  const C = CAR, hs = Math.sin(c.h), hc = Math.cos(c.h);
  c.gnd = c.gnd || [0, 0, 0, 0]; c.comp = c.comp || [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const lx = CORN[i][0] * C.track / 2, lz = CORN[i][1] * C.wb / 2;
    c.gnd[i] = ground(c.x + hc * lx + hs * lz, c.z - hs * lx + hc * lz);
  }
  if (c.y === undefined || !isFinite(c.y) || Math.abs(c.y - (c.gnd[0] + c.gnd[3]) / 2) > 2) {
    c.y = (c.gnd[0] + c.gnd[1] + c.gnd[2] + c.gnd[3]) / 4; c.vy = 0;
    c.pitch = Math.atan2((c.gnd[2] + c.gnd[3]) - (c.gnd[0] + c.gnd[1]), 2 * C.wb); c.roll = Math.atan2((c.gnd[1] + c.gnd[3]) - (c.gnd[0] + c.gnd[2]), 2 * C.track); c.wp = c.wr = 0;
  }
  const s0 = C.m * G / (4 * C.k), h = dt / sub;
  for (let n = 0; n < sub; n++) {
    let Fy = -C.m * G, Tp = -C.m * c.al * C.hcg, Tr = C.m * c.ax * C.hcg;
    for (let i = 0; i < 4; i++) {
      const lx = CORN[i][0] * C.track / 2, lz = CORN[i][1] * C.wb / 2;
      const hcI = c.y - lz * Math.sin(c.pitch) + lx * Math.sin(c.roll);
      const vI = c.vy - lz * c.wp * Math.cos(c.pitch) + lx * c.wr * Math.cos(c.roll);
      const comp = c.gnd[i] - hcI; c.comp[i] = comp;
      let Fi = C.k * (comp + s0) - C.c * vI;
      if (comp + s0 < 0) Fi = 0;              // колесо оторвалось
      if (comp > .09) Fi += (comp - .09) * C.k * 12 - C.c * 3 * Math.min(0, vI); // отбойник
      Fi = Math.max(0, Fi);
      Fy += Fi; Tp += -lz * Fi; Tr += lx * Fi * C.arb;
      // стабилизатор: гасит крен без влияния на подъём
    }
    c.vy += Fy / C.m * h; c.wp += Tp / C.Ip * h; c.wr += (Tr - C.c * .0 * c.wr) / C.Ir * h;
    c.y += c.vy * h; c.pitch += c.wp * h; c.roll += c.wr * h;
    c.pitch = clamp(c.pitch, -.5, .5); c.roll = clamp(c.roll, -.5, .5);
  }
}

// удар о препятствие: n — нормаль (от препятствия), гасим нормальную скорость, отражаем чуть-чуть
export function carImpact(c, nx, nz, e = .15, fr = .75) {
  const vn = c.vx * nx + c.vz * nz; if (vn >= 0) return 0;
  const tx = c.vx - vn * nx, tz = c.vz - vn * nz;
  c.vx = tx * fr - vn * e * nx; c.vz = tz * fr - vn * e * nz;
  c.vy += Math.min(1.2, -vn * .08);
  return -vn;
}

/* ================= АНИМАЦИЯ: калибровка шага по кости стопы ================= */
const _v = new THREE.Vector3();
const clipOf = act => act.getClip();
function feetOf(a) {
  if (a._feet) return a._feet;
  const bones = []; a.root.traverse(o => { if (o.isBone) bones.push(o) });
  let feet = bones.filter(b => /foot|paw|hoof/i.test(b.name) && !/toe|end|ik|pole|target/i.test(b.name));
  if (feet.length < 2) {
    // концевые кости ног у самой земли (олень: Frontleg_L002 …)
    a.root.updateMatrixWorld(true);
    const Hm = a.root.userData.size ? a.root.userData.size.y : 1.5;
    feet = bones.filter(b => /leg/i.test(b.name) && !/ik|pole|target/i.test(b.name) && !b.children.some(c => c.isBone)
      && a.root.worldToLocal(b.getWorldPosition(_v.clone())).y < Hm * .1);
  }
  if (feet.length < 2) {
    // нет явных имён — берём кости-листья, самые низкие в позе покоя
    a.root.updateMatrixWorld(true);
    const leaves = bones.filter(b => !b.children.some(c => c.isBone));
    leaves.sort((p, q) => a.root.worldToLocal(p.getWorldPosition(_v.clone())).y - a.root.worldToLocal(q.getWorldPosition(_v.clone())).y);
    feet = leaves.slice(0, 4);
  }
  return a._feet = feet;
}
// снимает траектории стоп в системе координат корня актёра (+Z — вперёд)
function sampleClip(a, key, N = 120) {
  const act = a.acts[key]; if (!act) return null;
  const clip = clipOf(act), dur = clip.duration, feet = feetOf(a);
  const prevCur = a.cur;
  const was = a.mixer._actions.filter(x => x.isRunning()).map(x => [x, x.time, x.getEffectiveWeight(), x.timeScale]);
  a.mixer.stopAllAction();
  const saveP = a.root.position.clone(), saveR = a.root.rotation.clone(), par = a.root.parent;
  a.root.position.set(0, 0, 0); a.root.rotation.set(0, 0, 0);
  act.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
  const tr = feet.map(() => []);
  for (let i = 0; i <= N; i++) {
    act.time = dur * i / N; a.mixer.update(0); a.root.updateMatrixWorld(true);
    feet.forEach((f, j) => { f.getWorldPosition(_v); a.root.worldToLocal(_v); tr[j].push([_v.x, _v.y, _v.z]) });
  }
  a.mixer.stopAllAction(); a.root.position.copy(saveP); a.root.rotation.copy(saveR);
  a.cur = null; was.forEach(([x, t, w, ts]) => { x.play(); x.time = t; x.setEffectiveWeight(w); x.timeScale = ts });
  a.cur = prevCur; if (!a.cur && a.acts.idle) { a.acts.idle.play(); a.cur = a.acts.idle }
  a.mixer.update(0);
  return { dur, N, tr };
}
// стопа в опоре: высота в пределах tol от минимума этой стопы
function contacts(y, tol) { const mn = Math.min(...y); return y.map(v => v < mn + tol) }
export function calibrate(a, key, tol = .02) {
  const S = sampleClip(a, key); if (!S) return null;
  const { dur, N, tr } = S, dtau = dur / N;
  const vs = [];
  tr.forEach(t => {
    const c = contacts(t.map(p => p[1]), tol);
    for (let i = 0; i < N; i++) if (c[i] && c[i + 1]) vs.push(-(t[i + 1][2] - t[i][2]) / dtau);
  });
  vs.sort((p, q) => p - q);
  const vMed = Math.max(.05, vs.length ? vs[Math.floor(vs.length / 2)] : 1);
  // «естественная» скорость клипа: та, при которой опорные стопы меньше всего скользят (размах за шаг → min)
  const cal = { key, dur, v0: vMed, S, tol };
  let best = vMed, bs = 1e9;
  for (let i = 0; i <= 80; i++) { const v = vMed * (.4 + 2.2 * i / 80), s = slipPerStep(cal, v, 1); if (s < bs) { bs = s; best = v } }
  let lo = best * .97, hi = best * 1.03;
  for (let i = 0; i < 30; i++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (slipPerStep(cal, m1, 1) < slipPerStep(cal, m2, 1)) hi = m2; else lo = m1 }
  cal.v0 = (lo + hi) / 2; cal.vMed = vMed; cal.step = cal.v0 * dur / 2; cal.slip = slipPerStep(cal, cal.v0, 1);
  (a.cal = a.cal || {})[key] = cal;
  return cal;
}
// скольжение стопы, м за шаг: мир. положение опорной стопы = v·t + z(ts·t); размах за фазу опоры
export function slipPerStep(cal, v, ts) {
  const { S, tol } = cal, { dur, N, tr } = S, dtau = dur / N;
  let worst = 0;
  tr.forEach(t => {
    const c = contacts(t.map(p => p[1]), tol);
    // фазы опоры (циклически)
    let i0 = c.findIndex(x => !x); if (i0 < 0) i0 = 0;
    let run = [];
    const flush = () => {
      if (run.length > 1) {
        const w = run.map(({ i, k }) => [t[i][0], v * (k * dtau) / ts + t[i][2]]);
        const xs = w.map(p => p[0]), zs = w.map(p => p[1]);
        worst = Math.max(worst, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)))
      }
      run = [];
    };
    for (let k = 0; k <= N; k++) {
      const i = (i0 + k) % N;
      if (c[i]) run.push({ i, k: k }); else flush();
    }
    flush();
  });
  return worst;
}

// выбор клипа и темпа: ts = v / v0 (стопа не скользит); порог шаг/бег — по скорости
export function gaitPlay(a, spd, dt, o = {}) {
  if (!a.mixer) return;
  const cw = a.cal && a.cal.walk, cr = a.cal && a.cal.run;
  const vSw = o.vSwitch || a.vSwitch || 2.4;
  let k = spd < (o.idleBelow || .12) ? 'idle' : ((spd < vSw && a.acts.walk) || !a.acts.run) ? 'walk' : 'run';
  if (!a.acts[k]) k = a.acts.walk ? 'walk' : 'idle';
  playAct(a, k, o.fade || .25);
  if (a.cur) {
    const cal = k === 'walk' ? cw : k === 'run' ? cr : null;
    a.cur.timeScale = cal ? clamp(spd / cal.v0, .3, 2.2) : 1;
  }
  a.mixer.update(dt);
}
export function playAct(a, k, fade = .25) {
  const n = a.acts[k] || a.acts.idle; if (!n || a.cur === n) return;
  n.reset().setEffectiveWeight(1).play();
  if (a.cur) a.cur.crossFadeTo(n, fade, false); a.cur = n;
}

/* ================= ЖИВЫЕ NPC: взгляд, переминание ================= */
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _ax = new THREE.Vector3();
export function findBone(a, re) { let b = null; a.root.traverse(o => { if (!b && o.isBone && re.test(o.name)) b = o }); return b }
// поворот кости вокруг мировой вертикали (после mixer.update — аддитивно поверх клипа)
export function yawBone(b, ang, pitch = 0) {
  if (!b || (!ang && !pitch)) return;
  b.parent.getWorldQuaternion(_q).invert();
  _ax.set(0, 1, 0).applyQuaternion(_q).normalize();
  _q2.setFromAxisAngle(_ax, ang); b.quaternion.premultiply(_q2);
  if (pitch) { b.getWorldQuaternion(_q2); _ax.set(1, 0, 0).applyQuaternion(_q2); _ax.applyQuaternion(_q).normalize(); _q2.setFromAxisAngle(_ax, pitch); b.quaternion.premultiply(_q2) }
}

/* ================= ПРОЦЕДУРНАЯ ПОХОДКА ДЛЯ СТАТИЧНЫХ МОДЕЛЕЙ (медведь, кот) =================
   Модель без костей: вершины ног (ниже legTop) поворачиваются вокруг «бёдер», голова кивает, хвост качается.
   Фаза опоры: стопа движется назад линейно; частота шага f = v·β / (2·L·sinA) → стопа не скользит. */
export function makeQuad(wrap, o = {}) {
  const sz = wrap.userData.size, H = sz.y, Lz = sz.z;
  wrap.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(wrap.matrixWorld).invert();
  const meshes = [];
  wrap.traverse(m => { if (m.isMesh && m.visible && !m.userData._quad) meshes.push(m) });
  const parts = [];
  const legTop = (o.legTop || .42) * H;
  meshes.forEach(m => {
    const geo = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const nm = new THREE.Mesh(geo, m.material); nm.castShadow = true; nm.receiveShadow = true; nm.userData._quad = 1;
    m.visible = false; wrap.add(nm);
    parts.push({ mesh: nm, base: Float32Array.from(geo.attributes.position.array) });
  });
  // сегментация: ноги (4 группы), голова, хвост
  let zs = [], n = 0;
  parts.forEach(p => { const b = p.base; for (let i = 0; i < b.length; i += 3) if (b[i + 1] < legTop * .8) { zs.push(b[i + 2]); n++ } });
  zs.sort((a, b) => a - b); const zMid = zs.length ? zs[Math.floor(zs.length / 2)] : 0;
  const acc = [0, 1, 2, 3].map(() => ({ x: 0, z: 0, n: 0 }));
  const legOf = (x, z) => (z > zMid ? 0 : 2) + (x > 0 ? 1 : 0);          // 0 ЛП,1 ПП,2 ЛЗ,3 ПЗ
  parts.forEach(p => { const b = p.base; for (let i = 0; i < b.length; i += 3) if (b[i + 1] < legTop * .8) { const g = acc[legOf(b[i], b[i + 2])]; g.x += b[i]; g.z += b[i + 2]; g.n++ } });
  const hips = acc.map(g => g.n ? { x: g.x / g.n, z: g.z / g.n } : { x: 0, z: 0 });
  const headZ = (o.headZ !== undefined ? o.headZ : .3) * Lz / 2, tailZ = (o.tailZ !== undefined ? o.tailZ : -.75) * Lz / 2;
  const neckY = (o.neckY || .6) * H;
  parts.forEach(p => {
    const b = p.base, cnt = b.length / 3; p.leg = new Int8Array(cnt); p.wl = new Float32Array(cnt); p.wh = new Float32Array(cnt); p.wt = new Float32Array(cnt);
    for (let i = 0; i < cnt; i++) {
      const x = b[i * 3], y = b[i * 3 + 1], z = b[i * 3 + 2];
      p.leg[i] = legOf(x, z);
      p.wl[i] = sstep(legTop, legTop * .55, y);
      p.wh[i] = y > legTop * .9 ? sstep(headZ, headZ + Lz * .12, z) : 0;
      p.wt[i] = o.tail ? sstep(tailZ, tailZ - Lz * .08, z) * sstep(legTop * .8, legTop, y) : 0;
    }
  });
  const legLen = legTop * .9;
  const q = { wrap, parts, hips, legTop, legLen, headZ, neckY, tailZ, H, Lz, phase: Math.random(), amp: 0, spd: 0,
    A: o.A || .42, duty: o.duty || .62, lift: (o.lift || .12) * legTop, bob: o.bob || .025, roll: o.roll || .05, nod: o.nod || .07,
    offs: o.offs || [.5, 0, .25, .75], gallop: [0, .12, .55, .67], vGallop: o.vGallop || 5, vis: true };
  return q;
}
// частота шага для скорости v при амплитуде A — без скольжения
export const quadFreq = (q, v, A = q.A) => v * q.duty / (2 * q.legLen * Math.sin(A));
export function quadSlip(q, v, A = q.A) {
  // стопа в опоре: x = L·sin(θ), θ линейно от +A до −A за duty/f; мир. сдвиг = v·t − (L sinA − L sinθ)
  const f = quadFreq(q, v, A), Ts = q.duty / f, N = 40; let mn = 1e9, mx = -1e9;
  for (let i = 0; i <= N; i++) { const t = Ts * i / N, th = A * (1 - 2 * i / N); const w = v * t + q.legLen * Math.sin(th); mn = Math.min(mn, w); mx = Math.max(mx, w) }
  return mx - mn;
}
export function updateQuad(q, v, dt, o = {}) {
  const gal = v > q.vGallop;
  q.spd = v;
  const A = gal ? q.A * 1.35 : q.A * clamp(.35 + v / 1.2, .35, 1);
  let f = v > .02 ? quadFreq(q, v, A) : 0;
  if (gal) f = Math.min(f, o.fMax || 2.6);                         // галоп: фаза полёта, ноги не обязаны «держать» землю
  q.phase = (q.phase + f * dt) % 1;
  q.amp += ((v > .05 ? 1 : 0) - q.amp) * Math.min(1, dt * 6);
  const offs = gal ? q.gallop : q.offs, beta = gal ? .4 : q.duty;
  const th = [0, 0, 0, 0], lift = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const p = (q.phase + offs[k]) % 1;
    if (p < beta) th[k] = A * (1 - 2 * p / beta);
    else { const s = (p - beta) / (1 - beta); th[k] = -A + 2 * A * sstep(0, 1, s); lift[k] = Math.sin(Math.PI * s) * q.lift * (gal ? 1.6 : 1) }
    th[k] *= q.amp; lift[k] *= q.amp;
  }
  const ph2 = q.phase * Math.PI * 2;
  const nod = (gal ? Math.sin(ph2) * q.nod * 2 : Math.sin(ph2 * 2) * q.nod) * q.amp + (o.headPitch || 0);
  const tailA = o.tail !== undefined ? o.tail : 0;
  const cs = th.map(Math.cos), sn = th.map(Math.sin);
  const cn = Math.cos(nod), snn = Math.sin(nod), ct = Math.cos(tailA), st = Math.sin(tailA);
  for (const p of q.parts) {
    const b = p.base, a = p.mesh.geometry.attributes.position, arr = a.array, cnt = b.length / 3;
    for (let i = 0; i < cnt; i++) {
      let x = b[i * 3], y = b[i * 3 + 1], z = b[i * 3 + 2];
      const wl = p.wl[i];
      if (wl > 0) {
        const k = p.leg[i], hp = q.hips[k], dy = y - q.legTop, dz = z - hp.z;
        const c = 1 + (cs[k] - 1) * wl, s = sn[k] * wl;
        // поворот вокруг оси X через бедро (θ>0 — нога вперёд)
        const ny = q.legTop + dy * c - dz * s, nz = hp.z + dz * c + dy * s;
        y = ny + lift[k] * wl; z = nz;
      }
      const wh = p.wh[i];
      if (wh > 0) { const dy = y - q.neckY, dz = z - q.headZ, c = 1 + (cn - 1) * wh, s = snn * wh; y = q.neckY + dy * c - dz * s; z = q.headZ + dz * c + dy * s }
      const wt = p.wt[i];
      if (wt > 0 && tailA) { const dx = x, dy = y - q.legTop, c = 1 + (ct - 1) * wt, s = st * wt; x = dx * c - dy * s; y = q.legTop + dx * s + dy * c }
      arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z;
    }
    a.needsUpdate = true; p.mesh.geometry.computeVertexNormals();
  }
  // корпус: подъём дважды за цикл (каждая пара ног), покачивание с боку на бок, тангаж на галопе
  const body = q.wrap;
  body.position.y = (gal ? Math.abs(Math.sin(ph2)) * q.bob * 3 : (1 - Math.cos(ph2 * 2)) * .5 * q.bob) * q.amp;
  body.rotation.z = Math.sin(ph2) * q.roll * q.amp * (gal ? .3 : 1);
  body.rotation.x = (gal ? Math.sin(ph2 + .8) * .08 : 0) * q.amp;
}

/* ================= ВОРОТА ================= */
export function gate(name, val, lo, hi, unit = '') {
  const ok = val >= lo && val <= hi;
  const s = `GATE ${name} ${(+val).toFixed(3)}${unit} [${lo}..${hi}] ${ok ? 'OK' : 'FAIL'}`;
  window.__gates = (window.__gates || []).concat(s);
  return s;
}
// установившаяся скорость и макс. угловая скорость разворота на месте
export function simHuman() {
  const r = {};
  for (const g of ['walk', 'run', 'sprint']) {
    const s = { h: 0, spd: 0, w: 0, vx: 0, vz: 0 }; let t = 0, t90 = -1;
    const vt = HUMAN[g];
    for (let i = 0; i < 600; i++) { humanStep(s, { x: 0, z: 1, gait: g }, 1 / 60, false); t += 1 / 60; if (t90 < 0 && s.spd > .9 * vt) t90 = t }
    r[g] = s.spd; r[g + '_t90'] = t90;
  }
  // разворот на месте на 180°
  { const s = { h: 0, spd: 0, w: 0, vx: 0, vz: 0 }; let wm = 0, t = 0;
    for (let i = 0; i < 300; i++) { humanStep(s, { x: 0, z: -1, gait: 'run' }, 1 / 60, false); t += 1 / 60; if (s.spd < .3) wm = Math.max(wm, Math.abs(s.w)) }
    r.turnStand = wm; }
  // на бегу 90° — радиус дуги
  { const s = { h: 0, spd: 4, w: 0, vx: 0, vz: 4 }; let wm = 0;
    for (let i = 0; i < 120; i++) { humanStep(s, { x: 1, z: 0, gait: 'run' }, 1 / 60, false); wm = Math.max(wm, Math.abs(s.w) * s.spd) }
    r.runLatAcc = wm; }
  // прыжок
  { let y = 0, vy = jumpV(), mx = 0; for (let i = 0; i < 200; i++) { vy -= G / 120; y += vy / 120; mx = Math.max(mx, y); if (y < 0) break } r.jump = mx }
  return r;
}
export function simCar() {
  const c = { x: 0, z: 0, h: 0, vx: 0, vz: 0, steer: 0, al: 0, ax: 0 }, env = { ice: false }, dt = 1 / 60;
  let t = 0, t100 = -1, vmax = 0;
  for (let i = 0; i < 60 * 150; i++) { carStep(c, { thr: 1, st: 0 }, dt, env); t += dt; const v = c.vx * Math.sin(c.h) + c.vz * Math.cos(c.h); if (t100 < 0 && v >= 100 / 3.6) t100 = t; vmax = Math.max(vmax, v) }
  // торможение со 100 км/ч
  c.vx = 0; c.vz = 100 / 3.6; c.h = 0; t = 0; let d = 0;
  while (c.vz > .01 && t < 30) { const z0 = c.z; carStep(c, { thr: -1, st: 0 }, dt, env); t += dt; d += c.z - z0 }
  const brake = (100 / 3.6) / t;
  // сухая масса/инерция подвески: крен при повороте 30 км/ч на полном руле
  const s = { x: 0, z: 0, h: 0, vx: 0, vz: 30 / 3.6, steer: 0, al: 0, ax: 0 }; let rollMax = 0, pitchBrake = 0;
  for (let i = 0; i < 240; i++) { carStep(s, { thr: .3, st: 1 }, dt, { ice: false, ground: () => 0 }); rollMax = Math.max(rollMax, Math.abs(s.roll || 0)) }
  const b = { x: 0, z: 0, h: 0, vx: 0, vz: 20, steer: 0, al: 0, ax: 0 };
  for (let i = 0; i < 30; i++) carStep(b, { thr: 0, st: 0 }, dt, { ice: false, ground: () => 0 });
  for (let i = 0; i < 90; i++) { carStep(b, { thr: -1, st: 0 }, dt, { ice: false, ground: () => 0 }); pitchBrake = Math.max(pitchBrake, b.pitch) }
  return { t100, vmax: vmax * 3.6, brake, brakeDist: d, rollDeg: rollMax * 180 / Math.PI, pitchBrakeDeg: pitchBrake * 180 / Math.PI, steer0: steerLimit(0), steer100: steerLimit(100 / 3.6) };
}
