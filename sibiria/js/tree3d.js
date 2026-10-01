'use strict';
// Tree — объёмная модель дерева (ель, кедр, берёза, сухостой). Одна модель на всё: стоит, качается, зарубка, падение
// (поворот вокруг пня), лежит (нижние ветви подмяты о снег), обрубка (ветви отделяются), раскряжёвка (чурки с торцами).
//   ствол — сужающийся цилиндр r(z) = R0·(1 − z/H)^0.75 (объём = 0.4·π·R0²·H — ель), кора, торцы с годовыми кольцами;
//   мутовки ветвей — каждая ветвь 3D: азимут, наклон, длина, провис, лапник (плоскость) + свисающие веточки («занавес»),
//   снег сверху по мировой вертикали (осыпается, когда плоскость лапы наклонилась); вершина.
// Камера: X вправо, Y к камере (юг), Z вверх; экран = (X, 0.6·Y − Z)·M, M = 23 px/м (как у ствола Actions.logEnd).
// Свет — сверху-слева (как у рига героя). Глубина для порядка рисования: 0.8·Y + 0.6·Z.
// Размер: класс спрайта (вид, ступень si, вариант v) — форма; дерево — класс × k (k = s/ступень · разброс ±7 %).
// Стоящие в покое — запечённый спрайт этой же модели (ArtWorld.treeSprite), движущиеся — живая модель.
//
// КОНТРАКТ ЧАСТЕЙ (для инвентаря/переноски): всё, что отделено от дерева, лежит в G.chunks (сейв как есть):
//   { id, kind: 'butt' (комель) | 'chunk' (чурка) | 'top' (вершина с мелкими ветвями) | 'bough' (ветвь с хвоей) | 'branch' (голая ветвь, сухой сук), src — id ствола, tk — вид дерева, sk — класс формы, k — масштаб,
//     len (м), diam (м, средний; d0/d1 — у торцов), vol (м³ твёрдого тела), mass (кг), bulk (м³ габарит, у лапника),
//     x, y (px мира, центр), ang (рад, направление оси по земле), t (G.time появления), fx, fy (откуда отлетела — анимация),
//     z0, z1 (участок ствола, м класса) · w, b (мутовка и ветвь — у лапника) }
//   Tree.parts(o) — из чего состоит дерево/ствол сейчас (то, что ещё не отделено); Tree.split(L, 'limb'|'buck') — отделить;
//   Tree.whole(L) — масса и объём всего сваленного дерева; сумма частей = целое (пень — отдельно, остаётся в земле).
//   Tree.take(part) — масса и объём части (кг, л); KG — прежнее «полено» 6 кг (единица печи и прогнозов).
const Tree = (() => {
  const M = 23, TAU = Math.PI * 2, CH = 0.45, KG = 6, HC = 0.35;   // KG — прежнее «полено» 6 кг (единица печи/прогнозов; дрова теперь — чурки со своей массой)
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * t;
  const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const low = () => typeof window !== 'undefined' && window.QUALITY === 'low';
  const rng = a => { a >>>= 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  const hh = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 2654435761) ^ Math.imul(b + 0x7f4a7c15, 2246822519); h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
  const hex = c => { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  // палитра — 32 ступени света
  function ramp(st) {
    const out = [];
    for (let i = 0; i < 32; i++) {
      const t = i / 31; let j = 0; while (j < st.length - 2 && st[j + 1][0] < t) j++;
      const k = clamp((t - st[j][0]) / (st[j + 1][0] - st[j][0] || 1), 0, 1), a = hex(st[j][1]), b = hex(st[j + 1][1]);
      out.push(`rgb(${Math.round(lerp(a[0], b[0], k))},${Math.round(lerp(a[1], b[1], k))},${Math.round(lerp(a[2], b[2], k))})`);
    }
    return out;
  }
  const tone = (R, k) => R[clamp(Math.round(k * 31), 0, 31)];
  // виды: hpx — высота при s = 1 (px), hd — H/D, cb — низ кроны (доля H), step — шаг мутовок (м), nb — ветвей в мутовке,
  // rc — длина нижней ветви (доля H), el0/el1 — наклон ветви внизу/вверху, sag/up — провис и подъём кончика, fw/cw — ширина лапы
  // и занавеса (доля длины), rho — плотность сырой мёрзлой древесины (кг/м³), fol — хвоя (кг на м^1.7 длины ветви), dtop — Ø вершины (м)
  const KP = {
    0: { hpx: 112, hd: 26, cb: 0.15, step: 0.4, nb: 5, rc: 0.29, el0: -0.4, el1: 0.15, sag: 0.24, up: 0.2, fw: 0.36, cw: 0.26, rho: 790, fol: 0.5, dtop: 0.06, grow: 0.22,
      ndl: ramp([[0, '#06120d'], [0.3, '#0e241b'], [0.55, '#183b2c'], [0.78, '#28563d'], [1, '#4f8565']]),
      bark: ramp([[0, '#1e130c'], [0.4, '#432c1d'], [0.7, '#64462f'], [1, '#8f7057']]) },
    2: { hpx: 92, hd: 22, cb: 0.16, step: 0.46, nb: 6, rc: 0.4, el0: -0.3, el1: 0.42, sag: 0.16, up: 0.3, fw: 0.44, cw: 0.16, rho: 750, fol: 0.6, dtop: 0.06, grow: 0.17,
      ndl: ramp([[0, '#08140c'], [0.3, '#112a19'], [0.55, '#1f4227'], [0.78, '#355e35'], [1, '#62874f']]),
      bark: ramp([[0, '#1d1814'], [0.4, '#40362e'], [0.7, '#62564b'], [1, '#8d8072']]) },
    1: { hpx: 95, hd: 32, cb: 0.28, step: 0.36, nb: 5, rc: 0.3, el0: 0.5, el1: 0.9, sag: 0.1, up: -0.05, fw: 0, cw: 0, rho: 930, fol: 0.22, dtop: 0.04, grow: 0.3, bare: 1,
      twig: '#4a3127', bark: ramp([[0, '#3c3733'], [0.35, '#a9a49b'], [0.7, '#dcd7cd'], [1, '#f4f1ea']]) },
    3: { hpx: 112, hd: 22, cb: 0.3, step: 0.6, nb: 3, rc: 0.15, el0: 0.35, el1: 0.6, sag: 0.02, up: 0, fw: 0, cw: 0, rho: 450, fol: 0.03, dtop: 0.05, grow: 0.2, bare: 1, burnt: 1,
      twig: '#141110', bark: ramp([[0, '#0b0908'], [0.45, '#1d1816'], [0.75, '#2f2724'], [1, '#4a403a']]) },
  };
  const WOOD = { 0: ramp([[0, '#8a6038'], [0.5, '#c4945c'], [1, '#e6c08a']]), 2: ramp([[0, '#86603c'], [0.5, '#c29766'], [1, '#e2c296']]), 1: ramp([[0, '#9b8462'], [0.5, '#d3bd92'], [1, '#efe0bf']]), 3: ramp([[0, '#5a4430'], [0.5, '#8c6c4a'], [1, '#b08e69']]) };
  const TS = [0.8, 0.95, 1.1, 1.25, 1.4];
  const siOf = s => clamp(Math.round((s - 0.8) / 0.15), 0, 4);
  // вариант и разброс — как в gfx.js (treeV, tjit): спрайт и модель — одно и то же дерево
  const varOf = t => t.kind === 0 && !t.wall ? (t.v + ((((t.x * 73856093) ^ (t.y * 19349663)) >>> 0) % 3)) % 3 : (t.v | 0);
  const jit = t => { const h = Math.imul(Math.imul(t.x | 0, 73856093) ^ Math.imul(t.y | 0, 19349663), 1) >>> 0, m = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; return 0.93 + ((m >>> 1) & 15) / 15 * 0.14; };
  const MODEL = { 0: 1, 2: 1, 1: 1, 3: 1 };   // виды, которые рисует модель (стоящие — тоже)

  // ---------- форма (класс): размеры в метрах ----------
  const SPECS = new Map();
  function spec(kind, si, v) {
    kind = KP[kind] ? kind : 0; si = clamp(si | 0, 0, 4); v = v | 0;
    const key = kind * 100 + si * 10 + v; let S = SPECS.get(key); if (S) return S;
    const P = KP[kind], r = rng(9001 + key * 7919), s = TS[si];
    const H = P.hpx * s / M, R0 = H / P.hd / 2, hb = Math.max(P.cb * H, HC + 0.12), yaw = v * 2.17 + kind * 0.7;
    const wh = []; let z = hb + r() * P.step * 0.4, wi = 0;
    while (z < H - 0.2) {
      const u = (z - hb) / (H - hb), lb = P.rc * H * Math.pow(Math.max(0.04, 1 - u), 0.92), nb = Math.max(2, P.nb - (r() < 0.35 ? 1 : 0) - (u > 0.75 ? 1 : 0));
      const br = [], a0 = r() * TAU;
      for (let j = 0; j < nb; j++) {
        if (u < 0.2 && r() < 0.12) continue;   // внизу кроны часть ветвей отмерла
        const len = Math.max(0.1, lb * (0.78 + r() * 0.44) * (u < 0.08 ? 0.75 : 1));   // нижняя мутовка — короче (затенена, отмирает)
        const az = yaw + a0 + j / nb * TAU + (r() - 0.5) * 0.8;
        // внизу кроны часть ветвей — сухие сучья без хвои (затенены); чаще со стороны камеры — комель и зарубка видны
        const dead = !P.bare && u < 0.16 && (Math.sin(az) > 0.25 || r() < 0.3) ? 1 : 0;
        br.push({ az, dead, len: dead ? len * 0.55 : len, el: lerp(P.el0, P.el1, u) + (r() - 0.5) * 0.25, sag: P.sag * (0.7 + r() * 0.6), up: P.up * (0.5 + r()),
          fw: P.fw * (0.8 + r() * 0.4), cw: P.cw * (0.6 + r() * 0.8), tw: (r() - 0.5) * 0.5, db: 0.006 + 0.03 * len, sd: (r() * 1e9) | 0, j });
      }
      wh.push({ z, br, i: wi++ });
      z += P.step * (0.75 + r() * 0.5) * (1 - 0.3 * u);
    }
    const marks = []; for (let i = 0; i < (P.bare && !P.burnt ? 46 : 30); i++) marks.push({ z: Math.pow(r(), 1.3) * H * 0.92, ph: r() * TAU, l: 0.05 + r() * 0.18 });
    S = { key, kind, si, v, H, R0, hb, yaw, wh, marks, P, age: Math.max(4, Math.round(H / P.grow)) };
    SPECS.set(key, S); return S;
  }
  const rz = (S, z) => S.R0 * Math.pow(Math.max(0, 1 - z / S.H), 0.75);
  // объём ствола на участке (класс, м³): ∫π r² dz
  const stemV = (S, z0, z1) => Math.PI * S.R0 * S.R0 * S.H / 2.5 * (Math.pow(Math.max(0, 1 - z0 / S.H), 2.5) - Math.pow(Math.max(0, 1 - z1 / S.H), 2.5));
  // ветвь: древесина (конус) и хвоя — в физических единицах при масштабе k
  const brWoodV = (b, k) => Math.PI * b.db * b.db / 4 * b.len / 3 * k * k * k;
  const brFol = (S, b, k) => b.dead ? 0 : S.P.fol * Math.pow(b.len * k, 1.7);
  const brMass = (S, b, k) => brWoodV(b, k) * S.P.rho + brFol(S, b, k);
  const brVol = (S, b, k) => brWoodV(b, k) + brFol(S, b, k) / 950;   // хвоя ~950 кг/м³

  // ---------- дерево мира → форма и масштаб ----------
  function of(o) {
    if (o.sk != null) return { S: SPECS.get(o.sk) || spec((o.sk / 100) | 0, ((o.sk / 10) | 0) % 10, o.sk % 10), k: o.k || 1 };
    const si = siOf(o.s || 1), S = spec(o.kind | 0, si, varOf(o));
    return { S, k: (o.s || 1) / TS[si] * jit(o) };
  }
  // реальные размеры стоящего дерева (м, кг)
  function size(t) {
    const { S, k } = of(t), H = S.H * k, D = S.R0 * 2 * k;
    let m = stemV(S, 0, S.H) * k * k * k * S.P.rho, mb = 0; for (const w of S.wh) for (const b of w.br) mb += brMass(S, b, k);
    return { H, D, stem: stemV(S, 0, S.H) * k * k * k, mass: m + mb, stemMass: m, crownMass: mb, age: S.age };
  }

  // ---------- ствол: план разделки ----------
  // L (G.logs) получает: sk, k, hc — высота реза (класс), zt — где отрезать вершину, cl — длина чурки (класс), zTop — конец ствола
  function ensure(L) {
    if (L.sk != null && L.zt != null) return L;
    let S, k;
    if (L.sk != null) ({ S, k } = of(L));
    else { const si = siOf(L.s || 1); S = spec(L.kind | 0, si, varOf({ kind: L.kind, wall: 0, v: L.v || 0, x: L.x, y: L.y })); k = (L.s || 1) / TS[si] * jit(L); }
    L.sk = S.key; L.k = +k.toFixed(4);
    const hc = HC / k, zt = clamp(S.H * (1 - Math.pow(Math.min(1, S.P.dtop / (2 * S.R0 * k)), 1 / 0.75)), hc + CH / k, S.H - 0.3 / k);
    const n = Math.max(1, Math.round((zt - hc) * k / CH));
    L.hc = +hc.toFixed(4); L.zt = +zt.toFixed(4); L.cl = +((zt - hc) / n).toFixed(5);
    if (L.zTop == null) {   // старый сейв: доля, что осталась
      const old = L.n0 ? L.n / L.n0 : 1; L.top = L.cut >= 1 || L.lim ? 1 : 0; L.zTop = L.top ? hc + (zt - hc) * old : S.H;
      L.n0 = n; L.n = L.top ? Math.max(0, Math.round((L.zTop - hc) / L.cl)) : n; if (L.top) L.zTop = hc + L.n * L.cl;
    }
    if (L.m0 == null) L.m0 = +whole(L).mass.toFixed(3);
    return L;
  }
  // мутовки ниже вершины (их обрубают), по третям
  const limbW = (S, L) => S.wh.filter(w => w.z < L.zt && w.z > L.hc);
  const limbedN = (S, L) => Math.floor(limbW(S, L).length * (L.cut || (L.lim ? 1 : 0)) + 1e-6);
  // целое сваленное дерево (без пня): ствол hc..H + все ветви
  function whole(L) {
    const { S, k } = of(L), k3 = k * k * k; let vol = stemV(S, L.hc, S.H) * k3, mass = vol * S.P.rho;
    for (const w of S.wh) if (w.z > L.hc) for (const b of w.br) { vol += brVol(S, b, k); mass += brMass(S, b, k); }
    return { vol, mass };
  }
  // часть: участок ствола [z0, z1] (+ ветви мутовок внутри, если br) — объём и масса
  function piece(S, k, kind, z0, z1, br) {
    const k3 = k * k * k, sv = stemV(S, z0, z1) * k3; let vol = sv, mass = sv * S.P.rho;
    if (br) for (const w of S.wh) if (w.z >= z0 && w.z < z1) for (const b of w.br) { vol += brVol(S, b, k); mass += brMass(S, b, k); }
    const d0 = 2 * rz(S, z0) * k, d1 = 2 * rz(S, z1) * k;
    return { kind, tk: S.kind, sk: S.key, k, len: +((z1 - z0) * k).toFixed(3), diam: +((d0 + d1) / 2).toFixed(3), d0: +d0.toFixed(3), d1: +d1.toFixed(3), vol: +vol.toFixed(6), mass: +mass.toFixed(4), z0: +z0.toFixed(4), z1: +z1.toFixed(4) };
  }
  function bough(S, k, w, b) {
    const len = b.len * k;
    return { kind: S.P.bare || b.dead ? 'branch' : 'bough', tk: S.kind, sk: S.key, k, len: +len.toFixed(3), diam: +(b.db * k).toFixed(3), vol: +brVol(S, b, k).toFixed(6), mass: +brMass(S, b, k).toFixed(4),
      bulk: +(len * Math.max(0.05, 2 * b.fw * len * 0.6) * Math.max(0.06, (b.cw + 0.1) * len * 0.5)).toFixed(4), w: w.i, b: b.j };
  }
  // из чего состоит сейчас: стоящее дерево — весь план (пень отдельно, fixed), ствол — то, что ещё не отделено
  function parts(o) {
    const L = o.zt != null ? o : ensure(Object.assign({ x: o.x, y: o.y, s: o.s, kind: o.kind, v: o.v }, {}));
    const { S, k } = of(L), out = [];
    if (o.zt == null) out.push(Object.assign(piece(S, k, 'stump', 0, L.hc, false), { fixed: 1 }));
    const lw = limbW(S, L), ln = o.zt == null ? 0 : limbedN(S, L);
    for (let i = ln; i < lw.length; i++) for (const b of lw[i].br) out.push(bough(S, k, lw[i], b));   // лапник (хвоя) или голая ветвь/сухой сук
    if (!L.top) out.push(piece(S, k, 'top', L.zt, S.H, true));
    const zTop = L.top ? L.zTop : L.zt, n = Math.max(0, Math.round((zTop - L.hc) / L.cl));
    for (let i = n - 1; i >= 0; i--) out.push(piece(S, k, i ? 'chunk' : 'butt', L.hc + i * L.cl, i === n - 1 ? zTop : L.hc + (i + 1) * L.cl, false));
    return out;
  }
  const massOf = list => list.reduce((a, p) => a + (p.fixed ? 0 : p.mass), 0);
  // точка ствола (класс z) → мир px
  const alongPx = (L, z) => { const d = (z - L.hc) * L.k * M; return { x: L.x + Math.cos(L.a) * d, y: L.y + Math.sin(L.a) * d * 0.6 }; };
  const rnd = (a, b) => a + Math.random() * (b - a);
  function place(L, p, z, side) {
    const q = alongPx(L, z), nx = -Math.sin(L.a) * 0.6, ny = Math.cos(L.a), nl = Math.hypot(nx, ny) || 1, sd = side * (7 + p.diam * M * 0.9 + rnd(0, 4));
    p.fx = Math.round(q.x); p.fy = Math.round(q.y); p.x = Math.round(q.x + nx / nl * sd + rnd(-2, 2)); p.y = Math.round(q.y + ny / nl * sd * 0.6 + rnd(-1, 1) + 2);
    p.ang = +(L.a + rnd(-0.5, 0.5)).toFixed(3);
  }
  function push(p) {
    G.chunks = G.chunks || []; p.id = (G.partN = (G.partN || 0) + 1); p.t = G.time; if (p.src == null && SRC != null) p.src = SRC; G.chunks.push(p);
    // лапник, заметённый с головой, сверх 320 частей — уходит (дрова не уходят никогда)
    if (G.chunks.length > 320) { const i = G.chunks.findIndex(q => (q.kind === 'bough' || q.kind === 'branch') && G.time - q.t > CYCLE * 0.75); if (i >= 0) G.chunks.splice(i, 1); }
    return p;
  }
  // отделить: 'limb' — следующая треть мутовок (ветви — лапником на снег), на последней — и вершину; 'buck' — чурку с конца
  let SRC = null;
  function split(L, op) {
    ensure(L); SRC = L.id; const { S, k } = of(L), out = [];
    if (op === 'limb') {
      const lw = limbW(S, L), c0 = L.cut || 0, c1 = c0 + 1 / 3 > 0.99 ? 1 : +(c0 + 1 / 3).toFixed(3);
      const i0 = Math.floor(lw.length * c0 + 1e-6), i1 = Math.floor(lw.length * c1 + 1e-6);
      const P = { th: Math.PI / 2, a: L.a, roll: L.f ? L.f.r || 0 : 0, lag: 0 };
      for (let i = i0; i < i1; i++) {
        const w = lw[i];
        for (const b of w.br) {
          const p = bough(S, k, w, b), g = boughRest(S, k, L, w, b, P);
          Object.assign(p, g, { dl: +((i - i0) * 0.12 + b.j * 0.03).toFixed(2) });   // dl — задержка: ветви падают по одной
          out.push(push(p));
        }
      }
      L.cut = c1; delete L.lim;
      if (c1 >= 1 && !L.top) { const p = piece(S, k, 'top', L.zt, S.H, true); place(L, p, (L.zt + S.H) / 2, Math.random() < 0.5 ? 1 : -1); p.fx = p.x; p.fy = p.y; out.push(push(p)); L.top = 1; L.zTop = L.zt; }
      return out;
    }
    if (op === 'buck') {
      if (!L.top || L.n <= 0) return out;
      let p;
      if (L.n <= 1) { p = piece(S, k, 'butt', L.hc, L.zTop, false); place(L, p, (L.hc + L.zTop) / 2, (G.chunks || []).length % 2 ? 1 : -1); L.zTop = L.hc; L.n = 0; }
      else { const z0 = Math.max(L.hc, L.zTop - L.cl); p = piece(S, k, 'chunk', z0, L.zTop, false); place(L, p, (z0 + L.zTop) / 2, (G.chunks || []).length % 2 ? 1 : -1); L.zTop = z0; L.n--; }
      out.push(push(p));
      // последний рез отделяет и комель: остаток ствола — тоже часть, которую можно взять
      if (L.n === 1) { const q = piece(S, k, 'butt', L.hc, L.zTop, false); place(L, q, (L.hc + L.zTop) / 2, -Math.sign(p.y - p.fy || 1)); L.zTop = L.hc; L.n = 0; out.push(push(q)); }
    }
    return out;
  }
  // где работает топор (класс z): обрубка — середина текущей трети мутовок, раскряжёвка — место реза
  function workZ(L) {
    ensure(L); const { S } = of(L);
    if ((L.cut || 0) < 1) { const lw = limbW(S, L), c0 = L.cut || 0, i0 = Math.floor(lw.length * c0 + 1e-6), i1 = Math.max(i0 + 1, Math.floor(lw.length * Math.min(1, c0 + 1 / 3) + 1e-6)); const a = lw[i0], b = lw[Math.min(lw.length - 1, i1 - 1)]; return a && b ? (a.z + b.z) / 2 : (L.hc + L.zt) / 2; }
    return L.n <= 1 ? (L.hc + L.zTop) / 2 : L.zTop - L.cl;
  }
  // где ляжет обрубленная ветвь: от места на стволе в сторону, куда она торчала (по позе «лежит»)
  function boughRest(S, k, L, w, b, P) {
    pose(S, k, { th: P.th, a: L.a, roll: P.roll, pz: L.hc, pw: rz(S, L.hc), ox: 0, oy: 0 });
    const r0 = rz(S, w.z); tf(Math.cos(b.az) * r0, Math.sin(b.az) * r0, w.z, w.z); const x0 = TX, y0 = TY, z0 = TZ;
    const P1 = brPt(S, b, w.z, 0.7); tf(P1[0], P1[1], P1[2], w.z); const dx = TX - x0, dy = TY - y0, dl = Math.hypot(dx, dy) || 1;
    const q = alongPx(L, w.z), ang = Math.atan2(dy, dx), half = b.len * k * 0.8;   // отброшена в сторону от ствола
    return { fx: Math.round(q.x + x0 * M), fy: Math.round(q.y + 0.6 * y0 * M), fz: +Math.max(0, z0).toFixed(2),
      x: Math.round(q.x + x0 * M + dx / dl * half * M + rnd(-2, 2)), y: Math.round(q.y + 0.6 * (y0 + dy / dl * half) * M + rnd(-1, 1)), ang: +ang.toFixed(3) };
  }
  // дрова — чурка, комель, вершина (своя масса и объём; подбор — js/carry.js, руки → рюкзак/нарты/поленница); лапник — не дрова
  const isWood = p => !p.kind || p.kind === 'chunk' || p.kind === 'butt' || p.kind === 'top';
  const take = p => ({ kg: p.mass != null ? p.mass : KG, l: p.vol != null ? p.vol * 1000 : KG / 0.79 });
  // сколько дров даст дерево (для отчёта/баланса)
  function woodOf(t) { const L = ensure({ x: t.x, y: t.y, s: t.s, kind: t.kind, v: t.v }); return massOf(parts(L).filter(isWood)) / KG; }

  // ================= ПРОЕКЦИЯ И ПОЗА =================
  const LD = (() => { const v = [-0.6, -0.38, 0.7], l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })();
  const VW = [0, 0.8, 0.6];
  let R = [1, 0, 0, 0, 1, 0, 0, 0, 1], PZ = 0, PW = 0, KS = 1, OX = 0, OY = 0, BX = 0, BY = 0, BH = 1, GRD = 0, LIFT = 0, LZ0 = 0, LZ1 = 1, LH = 1;
  let AOK = 0.62, AOZ = 0, SK0 = 1e9, SK1 = -1e9, SKD = 0, ZADD = 0, VIB = 0, VT = 0, SNOW = 1, ALPHA = 1, GS = 0, GT = 0, FLAT = 0;   // FLAT — лапы ложатся плашмя (лежит: побеги поворачиваются под своим весом); GS — провис под своим весом в мировой вертикали (лежит), GT — расстояние по ветви
  let TX = 0, TY = 0, TZ = 0, SX = 0, SY = 0;
  // поза: th — угол от вертикали, a — куда падает (по земле), roll — поворот вокруг ствола, lag — отставание кроны (м на вершине),
  // pz — точка поворота (класс z), pw — её высота после поворота, bend — изгиб [x, y] (м на вершине), ox/oy — опора (px мира)
  function pose(S, k, o) {
    const th = o.th || 0, a = o.a || 0, ps = o.roll || 0, c = Math.cos(th), s = Math.sin(th), kx = -Math.sin(a), ky = Math.cos(a), cp = Math.cos(ps), sp = Math.sin(ps);
    // Rk(θ) по оси (kx, ky, 0)
    const r00 = c + kx * kx * (1 - c), r01 = kx * ky * (1 - c), r02 = ky * s, r10 = kx * ky * (1 - c), r11 = c + ky * ky * (1 - c), r12 = -kx * s, r20 = -ky * s, r21 = kx * s, r22 = c;
    // × Rz(ψ)
    R = [r00 * cp + r01 * sp, -r00 * sp + r01 * cp, r02, r10 * cp + r11 * sp, -r10 * sp + r11 * cp, r12, r20 * cp + r21 * sp, -r20 * sp + r21 * cp, r22];
    PZ = o.pz || 0; PW = o.pw != null ? o.pw : PZ; KS = k; OX = o.ox || 0; OY = o.oy || 0; BH = S.H;
    const lg = o.lag || 0; BX = (o.bend ? o.bend[0] : 0) - Math.cos(a) * lg; BY = (o.bend ? o.bend[1] : 0) - Math.sin(a) * lg;
    GRD = o.grd ? 1 : 0; LIFT = o.lift || 0; LZ0 = o.lz0 || 0; LZ1 = LZ0 + 0.7; LH = S.H;
    SK0 = o.sink ? o.sink[0] : 1e9; SK1 = o.sink ? o.sink[1] : -1e9; SKD = o.sink ? o.sink[2] : 0;
    VIB = o.vib || 0; VT = o.t || 0; GS = o.gs || 0; GT = 0; FLAT = o.flat || 0; SNOW = o.snow != null ? o.snow : 1; ZADD = 0; ALPHA = o.al != null ? o.al : 1;
  }
  function tf(x, y, z, za) {
    const q = za / BH, b = q * q; x += BX * b; y += BY * b; z -= PZ;
    let X = R[0] * x + R[1] * y + R[2] * z, Y = R[3] * x + R[4] * y + R[5] * z, Z = R[6] * x + R[7] * y + R[8] * z + PW;
    if (LIFT) Z += LIFT * sm(LZ0 - 0.3, LZ1, za) * (1 - 0.55 * za / LH);
    if (GT) Z -= GS * GT * GT;
    X *= KS; Y *= KS; Z *= KS;
    if (za > SK0 && za < SK1) Z -= SKD;
    if (GRD && Z < 0.03) Z = 0.03 + (Z - 0.03) * 0.13;
    Z += ZADD;
    TX = X; TY = Y; TZ = Z; SX = OX + X * M; SY = OY + (0.6 * Y - Z) * M;
  }
  const rot = (x, y, z) => [R[0] * x + R[1] * y + R[2] * z, R[3] * x + R[4] * y + R[5] * z, R[6] * x + R[7] * y + R[8] * z];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const nrm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const pj = v => [v[0], 0.6 * v[1] - v[2]];

  // точка оси ветви (класс): t 0..1
  function brPt(S, b, wz, t) {
    const r0 = rz(S, wz), ca = Math.cos(b.az), sa = Math.sin(b.az), hd = b.len * t * Math.cos(b.el);
    const vib = VIB ? VIB * Math.sin(VT * 11 + (b.sd % 97)) * t * t : 0;
    return [ca * (r0 + hd), sa * (r0 + hd), wz + b.len * (t * Math.sin(b.el) - b.sag * t * t + b.up * t * t * t) + vib];
  }
  // половина ширины лапы на t (класс)
  const fwAt = (b, t) => b.fw * b.len * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.65) * (1 - 0.4 * t) + 0.004;

  // ================= РИСУНОК =================
  const BUF = new Float32Array(512);
  function path(g, n) { g.beginPath(); g.moveTo(BUF[0], BUF[1]); for (let i = 1; i < n; i++) g.lineTo(BUF[i * 2], BUF[i * 2 + 1]); g.closePath(); }
  // контур лапы (t, доля ширины): зубцы — боковые побеги, отогнуты к кончику
  const OUT = {}; function outline(n) {
    if (OUT[n]) return OUT[n]; const o = [[0.02, 0]];
    for (let i = 1; i <= n; i++) { const t = i / (n + 0.4); o.push([t - 0.5 / n, 0.34]); o.push([t, 1]); }
    o.push([1, 0]);
    for (let i = n; i >= 1; i--) { const t = i / (n + 0.4); o.push([t, -1]); o.push([t - 0.5 / n, -0.34]); }
    return (OUT[n] = o);
  }
  // ветвь с лапником: занавес (свисающие веточки), лапа, «ёлочка» побегов, снег сверху
  function drawBough(g, S, b, wz, lq0, sc) {
    // детализация по размеру лапы на экране (px устройства): мелкая — как в слабом пресете, средняя — без градиента и бликов
    const dl = b.len * KS * M / sc, lq = lq0 || dl < 26, mid = !lq && dl < 64;
    const P = S.P, ca = Math.cos(b.az), sa = Math.sin(b.az), cs = Math.cos(b.tw), sn = Math.sin(b.tw);
    let sdx = -sa * cs, sdy = ca * cs, sdz = sn;   // поперёк лапы (с закруткой)
    if (FLAT) {   // лежит: лапа поворачивается вокруг своей оси к горизонтали (нормаль — к мировому верху)
      const a0 = brPt(S, b, wz, 0.4), a1 = brPt(S, b, wz, 0.6), Tl = nrm([a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]]), Sl = [sdx, sdy, sdz];
      const Nw = rot(...cross(Tl, Sl)), TN = rot(...cross(Tl, cross(Tl, Sl))), f = Math.atan2(TN[2], Nw[2]) * FLAT, c = Math.cos(f), s2 = Math.sin(f), TS_ = cross(Tl, Sl);
      sdx = Sl[0] * c + TS_[0] * s2; sdy = Sl[1] * c + TS_[1] * s2; sdz = Sl[2] * c + TS_[2] * s2;
    }
    const pt = (t, s, d) => { const q = brPt(S, b, wz, t), w = fwAt(b, t) * s; GT = t * b.len; tf(q[0] + sdx * w, q[1] + sdy * w, q[2] + sdz * w - 0.3 * Math.abs(w) - (d || 0), wz); };
    // нормаль лапы (мир) и свет
    const q0 = brPt(S, b, wz, 0.45), q1 = brPt(S, b, wz, 0.55), T = nrm([q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]]);
    let N = nrm(rot(...cross(T, [sdx, sdy, sdz]))); const up = N[2]; let under = 0;
    if (dot(N, VW) < 0) { N = [-N[0], -N[1], -N[2]]; under = 1; }
    const lit = 0.5 + 0.5 * dot(N, LD), bri = (0.22 + 0.78 * lit * lit) * (under ? 0.7 : 1);
    // занавес — ниже лапы; рисуем раньше, если смотрим сверху
    const curtain = () => {
      if (!b.cw || lq) return; let n = 0; const cl = b.cw * b.len;
      for (let i = 0; i <= 6; i++) { const t = 0.1 + i / 6 * 0.82; pt(t, 0, 0); BUF[n++] = SX; BUF[n++] = SY; }
      for (let i = 6; i >= 0; i--) { const t = 0.1 + i / 6 * 0.82 + 0.03, d = cl * Math.sin(Math.PI * (t - 0.06) / 0.9) * (0.55 + 0.45 * hh(b.sd, i)); pt(t, (hh(b.sd, i + 9) - 0.5) * 0.5, d); BUF[n++] = SX; BUF[n++] = SY; }
      path(g, n / 2); g.fillStyle = tone(P.ndl, bri * 0.42 + 0.05); g.fill();
    };
    if (!under) curtain();
    // лапа
    const O = outline(lq ? 4 : mid ? 6 : 9); let n = 0;
    for (const [t, s] of O) { const j = s ? 0.8 + 0.35 * hh(b.sd, n) : 1; pt(t, s * j, 0); BUF[n * 2] = SX; BUF[n * 2 + 1] = SY; n++; }
    path(g, n);
    if (lq || mid) g.fillStyle = tone(P.ndl, 0.18 + 0.55 * bri);
    else { pt(0.05, 0, 0); const x0 = SX, y0 = SY; pt(1, 0, 0); const gr = g.createLinearGradient(x0, y0, SX, SY); gr.addColorStop(0, tone(P.ndl, 0.06 + 0.2 * bri)); gr.addColorStop(0.5, tone(P.ndl, 0.22 + 0.45 * bri)); gr.addColorStop(1, tone(P.ndl, 0.32 + 0.62 * bri)); g.fillStyle = gr; }
    g.fill();
    if (under) curtain();
    // побеги «ёлочкой»: тёмные щели между боковыми веточками и светлые верхушки
    if (!lq) {
      const lw = Math.max(0.35, b.len * KS * M * 0.022) * sc;
      g.lineWidth = lw; g.lineCap = 'round';
      g.strokeStyle = tone(P.ndl, 0.04 + 0.12 * bri); g.beginPath();
      for (let i = 0; i < 6; i++) { const t = 0.16 + i * 0.13; for (const sg of [1, -1]) { pt(t, 0, 0); g.moveTo(SX, SY); pt(t + 0.08, sg * 0.82, 0); g.lineTo(SX, SY); } }
      g.stroke();
      if (!under && !mid) { g.strokeStyle = tone(P.ndl, 0.4 + 0.6 * bri); g.lineWidth = lw * 0.8; g.beginPath(); for (let i = 0; i < 5; i++) { const t = 0.22 + i * 0.15, sg = i % 2 ? 1 : -1; pt(t, sg * 0.3, 0); g.moveTo(SX, SY); pt(t + 0.07, sg * 0.75, 0); g.lineTo(SX, SY); } g.stroke(); }
    }
    // снег сверху — по мировой вертикали; лапа наклонилась (up мал) — снега нет
    GT = 0;
    const sk = SNOW * sm(0.25, 0.65, up) * (under ? 0 : 1);
    if (sk > 0.03) {
      // снег комьями вдоль лапы: перехваты между комьями, края лапы — зелёные
      const th = 0.045 * b.len * KS * (0.5 + 0.5 * SNOW), wk = 0.2 + 0.32 * SNOW, NS = 8;
      const lump = i => (i === 0 || i === NS ? 0.15 : i % 2 ? 1 : 0.42) * (0.75 + 0.4 * hh(b.sd, i + 30));
      const band = dz => { let m = 0; ZADD = dz; for (let i = 0; i <= NS; i++) { pt(0.14 + i / NS * 0.74, wk * lump(i) + 0.08, 0); BUF[m++] = SX; BUF[m++] = SY; }
        for (let i = NS; i >= 0; i--) { pt(0.16 + i / NS * 0.74, -wk * lump(i) * 0.85 + 0.08, 0); BUF[m++] = SX; BUF[m++] = SY; } ZADD = 0; path(g, m / 2); };
      const a0 = g.globalAlpha; g.globalAlpha = a0 * Math.min(1, sk * 1.4);
      band(th * 0.35); g.fillStyle = '#9fb5cb'; g.fill();
      band(th); g.fillStyle = lq ? '#eef3f8' : '#f3f7fb'; g.fill();
      if (!lq && !mid) { g.fillStyle = 'rgba(255,255,255,0.9)'; ZADD = th * 1.15; pt(0.35, 0.25, 0); const ax = SX, ay = SY; pt(0.62, 0.2, 0); ZADD = 0; GT = 0; g.lineWidth = Math.max(0.5, th * M * 0.9) * sc; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.moveTo(ax, ay); g.lineTo(SX, SY); g.stroke(); }
      g.globalAlpha = a0; GT = 0;
    }
  }
  // голая ветвь (берёза, сухостой): сужающаяся линия, боковые прутья, у берёзы — свисающие веточки; снег — тонкой линией сверху
  function drawBare(g, S, b, wz, lq, sc) {
    const P = S.P, w0 = Math.max(0.5, b.db * KS * M) * sc;
    g.strokeStyle = b.dead ? '#4d443c' : P.twig; g.lineCap = 'round';
    let px, py; for (let i = 0; i <= 4; i++) { const q = brPt(S, b, wz, i / 4); GT = i / 4 * b.len; tf(q[0], q[1], q[2], wz); if (i) { g.lineWidth = w0 * (1 - i / 5); g.beginPath(); g.moveTo(px, py); g.lineTo(SX, SY); g.stroke(); } px = SX; py = SY; }
    GT = 0; if (lq) return;
    const sub = (t0, da, l) => { const q = brPt(S, b, wz, t0), az = b.az + da; GT = t0 * b.len; tf(q[0], q[1], q[2], wz); const x0 = SX, y0 = SY;
      tf(q[0] + Math.cos(az) * l * 0.7, q[1] + Math.sin(az) * l * 0.7, q[2] + l * (P.burnt ? 0.5 : 0.35), wz); g.moveTo(x0, y0); g.lineTo(SX, SY);
      if (!P.burnt) { const ex = SX, ey = SY; tf(q[0] + Math.cos(az) * l * 0.9, q[1] + Math.sin(az) * l * 0.9, q[2] + l * 0.05, wz); g.moveTo(ex, ey); g.lineTo(SX, SY); } };
    g.lineWidth = Math.max(0.35, w0 * 0.35); g.beginPath();
    for (let i = 0; i < (P.burnt || b.dead ? 1 : 4); i++) sub(0.3 + i * 0.17, (i % 2 ? 0.7 : -0.7) * (0.6 + hh(b.sd, i)), b.len * (0.35 - i * 0.05));
    g.stroke();
    if (!P.burnt && !b.dead) {   // берёза: тонкие свисающие веточки (повислая) — тёмная «вуаль» кроны
      g.lineWidth = Math.max(0.3, w0 * 0.16); g.strokeStyle = 'rgba(58,36,28,0.55)'; g.beginPath();
      for (let i = 0; i < 6; i++) { const t0 = 0.35 + i * 0.11, q = brPt(S, b, wz, t0), l = b.len * (0.22 + 0.2 * hh(b.sd, i + 20)), sd = (hh(b.sd, i + 40) - 0.5) * 0.3;
        GT = t0 * b.len; tf(q[0], q[1], q[2], wz); g.moveTo(SX, SY); tf(q[0] + Math.cos(b.az + sd) * l * 0.25, q[1] + Math.sin(b.az + sd) * l * 0.25, q[2] - l, wz); g.lineTo(SX, SY); }
      g.stroke(); GT = 0;
    } GT = 0;
    if (SNOW > 0.05) { const q0 = brPt(S, b, wz, 0.05), q1 = brPt(S, b, wz, 0.55); ZADD = b.db * KS * 0.6; tf(q0[0], q0[1], q0[2], wz); const x0 = SX, y0 = SY; tf(q1[0], q1[1], q1[2], wz); ZADD = 0;
      const u = rot(q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]); if (Math.abs(u[2]) / (Math.hypot(u[0], u[1], u[2]) || 1) < 0.75) { g.strokeStyle = '#f3f7fb'; g.lineWidth = w0 * 0.55 * SNOW; g.beginPath(); g.moveTo(x0, y0); g.lineTo(SX, SY); g.stroke(); } }
  }
  // участок ствола: силуэт цилиндра, свет поперёк (градиент), кора, пеньки сучьев
  function drawSeg(g, S, za, zb, lq, sc, stubs) {
    tf(0, 0, za, za); const A = [TX, TY, TZ], ax = SX, ay = SY; tf(0, 0, zb, zb); const B = [TX, TY, TZ], bx = SX, by = SY;
    const ra = rz(S, za) * KS, rb = Math.max(rz(S, zb) * KS, 0.004);
    const a = nrm([B[0] - A[0], B[1] - A[1], B[2] - A[2]]), h = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], e1 = nrm(cross(a, h)), e2 = cross(a, e1);
    let sx = bx - ax, sy = by - ay; const sl = Math.hypot(sx, sy); if (sl < 1e-3) { sx = 0; sy = -1; } else { sx /= sl; sy /= sl; }
    const px = -sy, py = sx, P1 = pj(e1), P2 = pj(e2), c1 = P1[0] * px + P1[1] * py, c2 = P2[0] * px + P2[1] * py, ext = Math.hypot(c1, c2) * M;
    const wa = ra * ext, wb = rb * ext;
    g.beginPath(); g.moveTo(ax + px * wa, ay + py * wa); g.lineTo(bx + px * wb, by + py * wb); g.lineTo(bx - px * wb, by - py * wb); g.lineTo(ax - px * wa, ay - py * wa); g.closePath();
    const ne = nrm([e1[0] * c1 + e2[0] * c2, e1[1] * c1 + e2[1] * c2, e1[2] * c1 + e2[2] * c2]), av = dot(a, VW), nf = nrm([VW[0] - a[0] * av, VW[1] - a[1] * av, VW[2] - a[2] * av]);
    // внутри кроны ствол в тени ветвей (обрубленный/без кроны — на свету)
    const ao = AOK && !S.P.bare ? 1 - AOK * sm(AOZ - 0.2, AOZ + 0.5, (za + zb) / 2) : 1;
    const br = n => (0.15 + 0.85 * (0.5 + 0.5 * dot(n, LD))) * ao, P = S.P.bark;
    if (lq) g.fillStyle = tone(P, br(nf) * 0.85);
    else {
      const mx = (ax + bx) / 2, my = (ay + by) / 2, w = (wa + wb) / 2 + 0.01, gr = g.createLinearGradient(mx + px * w, my + py * w, mx - px * w, my - py * w);
      gr.addColorStop(0, tone(P, br(ne) * 0.9)); gr.addColorStop(0.28, tone(P, br(nrm([ne[0] + nf[0], ne[1] + nf[1], ne[2] + nf[2]])))); gr.addColorStop(0.5, tone(P, br(nf)));
      gr.addColorStop(0.75, tone(P, br(nrm([nf[0] - ne[0], nf[1] - ne[1], nf[2] - ne[2]])) * 0.9)); gr.addColorStop(1, tone(P, br([-ne[0], -ne[1], -ne[2]]) * 0.7)); g.fillStyle = gr;
    }
    g.fill();
    if (lq || wa < 0.6) return;
    // кора: трещины (ель, кедр, сухостой) или чечевички (берёза) — только на видимой стороне
    const birch = S.P.bare && !S.P.burnt; g.lineCap = 'round';
    g.strokeStyle = birch ? 'rgba(25,22,20,0.85)' : 'rgba(18,12,8,0.7)'; g.lineWidth = Math.max(0.5 * sc, (birch ? 0.03 : 0.011) * M * KS); g.beginPath();
    for (const m of S.marks) {
      if (m.z < za || m.z >= zb) continue; const d = rot(Math.cos(m.ph), Math.sin(m.ph), 0); if (dot(d, VW) < 0.15) continue;
      const r = rz(S, m.z) * 1.01;
      if (birch) { const d2 = m.ph + 0.5 / Math.max(0.3, r * 30); tf(Math.cos(m.ph) * r, Math.sin(m.ph) * r, m.z, m.z); g.moveTo(SX, SY); tf(Math.cos(d2) * r, Math.sin(d2) * r, m.z + 0.01, m.z); g.lineTo(SX, SY); }
      else { tf(Math.cos(m.ph) * r, Math.sin(m.ph) * r, m.z, m.z); g.moveTo(SX, SY); const z1 = Math.min(zb, m.z + m.l); tf(Math.cos(m.ph + 0.05) * rz(S, z1), Math.sin(m.ph + 0.05) * rz(S, z1), z1, z1); g.lineTo(SX, SY); }
    }
    g.stroke();
    // пеньки обрубленных сучьев: светлый срез на коре
    if (stubs) for (const w of S.wh) { if (w.z < za || w.z >= zb || !stubs(w)) continue; for (const b of w.br) { const d = rot(Math.cos(b.az), Math.sin(b.az), 0); if (dot(d, VW) < 0) continue; const r = rz(S, w.z) * 1.08; tf(Math.cos(b.az) * r, Math.sin(b.az) * r, w.z, w.z); g.fillStyle = '#3a2618'; g.beginPath(); g.arc(SX, SY, Math.max(0.5, b.db * KS * M * 0.75) * sc, 0, TAU); g.fill(); g.fillStyle = '#c79a62'; g.beginPath(); g.arc(SX, SY, Math.max(0.35, b.db * KS * M * 0.45) * sc, 0, TAU); g.fill(); } }
  }
  // торец: плоскость сечения (local XY → мир) — эллипс точной проекции, годовые кольца, кора по краю; snow — снег поверх
  function drawDisc(g, S, z, snow, fresh, lq) {
    tf(0, 0, z, z); const cx = SX, cy = SY, r = rz(S, z) * KS * M, e1 = pj(rot(1, 0, 0)), e2 = pj(rot(0, 1, 0));
    if (r < 0.3) return;
    g.save(); g.transform(e1[0] * r, e1[1] * r, e2[0] * r, e2[1] * r, cx, cy);
    const W = WOOD[S.kind] || WOOD[0];
    g.fillStyle = tone(S.P.bark, 0.25); g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill();
    g.fillStyle = tone(W, fresh ? 0.75 : 0.5); g.beginPath(); g.arc(0, 0, 0.88, 0, TAU); g.fill();
    if (!lq) {
      const n = clamp(Math.round(S.age * rz(S, z) / S.R0 / 2.2), 2, 9); g.strokeStyle = tone(W, 0.18); g.lineWidth = 0.035;
      for (let i = 1; i <= n; i++) { g.beginPath(); g.arc(0.03, 0.02, 0.86 * i / (n + 0.6), 0, TAU); g.stroke(); }
      g.fillStyle = tone(W, 0.05); g.beginPath(); g.arc(0.03, 0.02, 0.07, 0, TAU); g.fill();
      if (fresh) { g.strokeStyle = 'rgba(70,40,15,0.45)'; g.lineWidth = 0.05; g.beginPath(); g.moveTo(-0.6, 0.15); g.lineTo(0.55, 0.32); g.stroke(); }   // трещина-усушка
    }
    if (snow > 0.02) { g.globalAlpha *= Math.min(1, snow * 1.4); g.fillStyle = '#f2f6fa'; g.beginPath(); g.ellipse(-0.08, -0.06, 0.8, 0.72, 0.3, 0, TAU); g.fill(); }
    g.restore();
  }
  // зарубка: клин из ствола со стороны sd (±1 по X мира), глубина q (доля диаметра), высота HC
  function drawNotch(g, S, q, sd, z) {
    const r = rz(S, z), d = r - 2 * r * q, f0 = Math.acos(clamp(d / r, -1, 1)), N = 7, dir = Math.atan2(0, sd);
    const P = (f, zz, rr) => tf(Math.cos(dir + f) * rr, Math.sin(dir + f) * rr, zz, zz);
    const cy = Math.cos(f0) * r;   // хорда
    const face = (top, col) => { g.beginPath(); P(-f0, z, r); g.moveTo(SX, SY);
      for (let i = 0; i <= N; i++) { const f = -f0 + 2 * f0 * i / N, rr = r; P(f, top ? z + (Math.cos(f) * rr - d) * 1.0 : z, rr * 1.01); g.lineTo(SX, SY); }
      P(f0, z, r); g.lineTo(SX, SY); g.closePath(); g.fillStyle = col; g.fill(); };
    if (q <= 0.01) return;
    // выемка на силуэте: клин вынут — за ним снег; дно (горизонтальный рез) светлое, верхняя грань — в тени
    const ht = (r - d) * 1.0;
    g.beginPath(); tf(sd * r * 1.08, 0, z + ht, z); g.moveTo(SX, SY); tf(sd * d, 0, z + 0.004, z); g.lineTo(SX, SY); tf(sd * r * 1.08, 0, z - 0.004, z); g.lineTo(SX, SY); g.closePath(); g.fillStyle = '#dfe7ef'; g.fill();
    face(0, '#e8c48e');   // верхняя грань смотрит вниз — сверху не видна
    g.strokeStyle = '#2a1a10'; g.lineWidth = Math.max(0.4, r * KS * M * 0.07); g.beginPath(); tf(sd * r * 1.04, 0, z + ht, z); g.moveTo(SX, SY); tf(sd * d, 0, z + 0.004, z); g.lineTo(SX, SY); g.stroke();
    void cy;
  }
  // ---------- сборка кадра дерева: элементы по глубине ----------
  // o: z0/z1 — участок ствола; has(w, b) — ветвь на месте; stubs(w) — у мутовки пеньки; discs [[z, outward ±1, fresh]]; notch {q, sd}
  const EL = []; let ELN = 0, ND = 0;
  function el(d, ty, a, b) { let e = EL[ELN]; if (!e) e = EL[ELN] = { d: 0, ty: 0, a: null, b: null }; ELN++; e.d = d; e.ty = ty; e.a = a; e.b = b; }
  function render(g, S, o) {
    const lq = o.lq != null ? o.lq : low(), sc = o.sc || 1, z0 = o.z0 || 0, z1 = o.z1 != null ? o.z1 : S.H;
    AOK = o.aok != null ? o.aok : 0.62; AOZ = o.aoz != null ? o.aoz : S.hb;   // ствол в тени кроны выше AOZ (обрубленный — на свету)
    ELN = 0;
    // ствол — кусками между мутовками
    const zs = [z0]; for (const w of S.wh) if (w.z > z0 + 0.05 && w.z < z1 - 0.05) zs.push(w.z); zs.push(z1);
    for (let i = 0; i < zs.length - 1; i++) { let za = zs[i], zb = zs[i + 1]; const n = Math.ceil((zb - za) / 0.7); for (let j = 0; j < n; j++) { const a = za + (zb - za) * j / n, b = za + (zb - za) * (j + 1) / n; tf(0, 0, (a + b) / 2, (a + b) / 2); el(0.8 * TY + 0.6 * TZ, 0, a, b); if (o.notch && HC / KS >= a && HC / KS < b) ND = 0.8 * TY + 0.6 * TZ; } }
    // ветви
    for (const w of S.wh) {
      if (w.z < z0 || w.z > z1) continue;
      for (let j = 0; j < w.br.length; j++) {
        const b = w.br[j]; if (o.has && !o.has(w, b)) continue; if (lq && !S.P.bare && j % 2 && w.br.length > 3) continue;
        const q = brPt(S, b, w.z, 0.5); tf(q[0], q[1], q[2], w.z); el(0.8 * TY + 0.6 * TZ, 1, b, w);
      }
    }
    if (o.discs) for (const dd of o.discs) { const n = rot(0, 0, dd[1]); if (dot(n, VW) <= 0.02) continue; tf(0, 0, dd[0], dd[0]); el(0.8 * TY + 0.6 * TZ + 0.002, 2, dd, null); }
    if (o.notch && o.notch.q > 0) el(ND + 0.002, 3, o.notch, HC / KS);   // зарубка — поверх своего куска ствола
    // вершина: снежный комок на верхушке (стоит)
    const sub = EL.slice(0, ELN).sort((a, b) => a.d - b.d);
    for (const e of sub) {
      switch (e.ty) {
        case 0: drawSeg(g, S, e.a, e.b, lq, sc, o.stubs); break;
        case 1: if (S.P.bare || e.a.dead) drawBare(g, S, e.a, e.b.z, lq, sc); else drawBough(g, S, lq ? scaleW(e.a) : e.a, e.b.z, lq, sc); break;
        case 2: drawDisc(g, S, e.a[0], o.dsnow || 0, e.a[2], lq); break;
        case 3: drawNotch(g, S, e.a.q, e.a.sd, e.b); break;
      }
    }
    if (z1 >= S.H - 0.01 && !S.P.bare && SNOW > 0.2) { tf(0, 0, S.H - 0.04, S.H); const up = rot(0, 0, 1)[2]; if (up > 0.6) { g.fillStyle = '#f3f7fb'; g.beginPath(); g.ellipse(SX, SY + 0.02 * M * KS, 0.06 * M * KS, 0.05 * M * KS, 0, 0, TAU); g.fill(); } }
  }
  // слабый пресет: половина ветвей, оставшиеся шире — силуэт кроны тот же
  const WIDE = new WeakMap(); const scaleW = b => { let c = WIDE.get(b); if (!c) { c = Object.assign({}, b, { fw: b.fw * 1.45 }); WIDE.set(b, c); } return c; };

  // ================= ГОТОВЫЕ СЦЕНЫ =================
  const W_ = () => (typeof ArtWorld !== 'undefined' ? ArtWorld : null);
  // спрайт стоящего (класс; опора 0,0 — комель на снегу): тень, воронка у ствола, модель в покое со снегом
  function paintSprite(g, kind, si, v) {
    const S = spec(kind, si, v), s = TS[si], A = W_();
    if (A) { A.shadow(g, 0, 0, (kind === 2 ? 24 : kind === 1 || kind === 3 ? 14 : 19) * s, 5.5 * s, 0.4); A.trunkWell(g, s, v, kind === 2 ? 1.3 : kind === 3 ? 0.9 : 1, kind === 2 ? 6311 : kind === 3 ? 7129 : 4401); }
    pose(S, 1, { snow: 1 }); render(g, S, { sc: 1 / Math.max(0.5, g.getTransform().a), lq: low() });   // sc — 1 px устройства в px спрайта
  }
  // воронка у ствола (для живого рисунка: то же, что в спрайте)
  function wellSprite(kind, si, v) {
    const A = W_(), s = TS[si]; if (!A) return null;
    return A.sprite('twell' + kind + si + v, 90, 30, g => { g.translate(45, 18); A.shadow(g, 0, 0, (kind === 2 ? 24 : kind === 1 || kind === 3 ? 14 : 19) * s, 5.5 * s, 0.4); A.trunkWell(g, s, v, kind === 2 ? 1.3 : kind === 3 ? 0.9 : 1, kind === 2 ? 6311 : kind === 3 ? 7129 : 4401); });
  }
  // снег на ветвях стоящего: стряхнули — меньше, нарастает за ~2 мин (память рендера)
  const SN = new WeakMap();
  const snowOf = t => { const e = SN.get(t); if (!e) return 1; const v = Math.min(1, e.v + ((typeof now === 'number' ? now : 0) - e.t) / 120); if (v >= 1) { SN.delete(t); return 1; } return v; };
  function shook(t, p) { const v = snowOf(t); SN.set(t, { v: Math.max(0, v - 0.3 * (p || 1)), t: typeof now === 'number' ? now : 0 }); }
  // живой: движется, рубится (зарубка) или стряхнут снег
  const live = (t, notch) => t.shake > 0 || (notch && notch.q > 0) || SN.has(t);
  // стоящее дерево живьём: bendPx — изгиб вершины (px), notch {q, sd}
  function drawStanding(g, t, o) {
    const { S, k } = of(t), wl = wellSprite(S.kind, S.si, S.v), dpr = g.getTransform().a;
    if (wl) { const s = wl._s || 1; g.drawImage(wl, t.x - 45 * k, t.y - 18 * k, 90 * k, 30 * k); void s; }
    const sh = t.shake > 0 ? t.shake : 0, tt = typeof now === 'number' ? now : 0;
    const bx = (o.bend || 0) / M / k + (sh ? Math.sin(tt * 38) * sh * 0.5 : 0);
    const R0 = crownPx(S, k) + 26, Hp = S.H * k * M + 26;
    viaCanvas(g, t, t.x - R0, t.y - Hp, R0 * 2, Hp + R0 * 0.75 + 8, sh > 0 ? 2 : 1, (c, s) => {
      pose(S, k, { ox: t.x, oy: t.y, bend: [bx, sh ? Math.cos(tt * 31) * sh * 0.15 : 0], vib: sh * 0.25, t: tt, snow: snowOf(t) });
      render(c, S, { notch: o.notch, sc: 1 / s, lq: low() });
    });
    void dpr;
  }
  // живой рисунок — в свой холст пониженной плотности (≤ 2 px устройства на px мира; слабый пресет — 1.2), качание — 30 Гц:
  // заливка крупных лап на плотном экране дорога, а в движении разница не видна
  const LV = new WeakMap(); let FR = 0;
  const crownPx = (S, k) => { let r = 0; for (const w of S.wh) for (const b of w.br) r = Math.max(r, b.len); return (r + S.R0) * k * M; };
  function viaCanvas(g, key, x0, y0, w, h, every, paint, cap) {
    const dpr = g.getTransform().a, s = Math.min(dpr, cap || (low() ? 1.2 : 2)), W = Math.ceil(w * s), H = Math.ceil(h * s);
    if (W < 1 || H < 1 || W > 3000 || H > 3000) return;
    let e = LV.get(key); if (!e) { e = { cv: document.createElement('canvas'), f: -9, s: 0 }; LV.set(key, e); }
    if (e.cv.width !== W || e.cv.height !== H) { e.cv.width = W; e.cv.height = H; e.f = -9; }
    if ((typeof every === 'number' ? FR - e.f >= every : e.v !== every) || e.s !== s || e.x0 !== x0 || e.y0 !== y0) {
      const c = e.cv.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H); c.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
      paint(c, s); e.f = FR; e.s = s; e.x0 = x0; e.y0 = y0; e.v = every;
    }
    g.drawImage(e.cv, x0, y0, w, h);
  }
  // пень: ствол 0..HC, свежий торец (снег нарастает), без ветвей
  function drawStump(g, t, snow) {
    const { S, k } = of(t), wl = wellSprite(S.kind, S.si, S.v), dpr = g.getTransform().a;
    if (wl) g.drawImage(wl, t.x - 45 * k, t.y - 18 * k, 90 * k, 30 * k);
    pose(S, k, { ox: t.x, oy: t.y, snow: 1 }); const hz = HC / k;
    render(g, S, { z0: 0, z1: hz, has: () => false, discs: [[hz, 1, snow < 0.5]], dsnow: snow, sc: 1 / Math.max(0.5, dpr), lq: low() });
    if (snow < 0.5) { tf(0, 0, hz, hz); const r = rz(S, hz) * k * M; g.strokeStyle = '#efd8a8'; g.lineWidth = Math.max(0.5, r * 0.15); g.beginPath(); g.moveTo(SX - r * 0.7, SY - r * 0.1); g.lineTo(SX - r * 0.2, SY - r * 0.5); g.moveTo(SX + r * 0.1, SY - r * 0.05); g.lineTo(SX + r * 0.4, SY - r * 0.55); g.stroke(); }   // недопил — щепа торчит
  }
  // ---------- ствол на земле / в падении ----------
  // o: {x, y, a, kind, s, v | sk, k, hc, zTop, top, cut, ...}, P — поза валки (GFX.fallPose): th, lag (px), roll, ph
  function logOpts(S, k, o, P) {
    const lie = Math.pow(Math.sin(P.th), 2), hc = o.hc != null ? o.hc : HC / k, rb = rz(S, hc);
    const lw = o.zt != null ? limbW(S, o) : [], ln = o.zt != null ? limbedN(S, o) : 0, lim = new Set(lw.slice(0, ln));
    const zTop = o.zTop != null ? o.zTop : S.H, lowest = S.wh.find(w => !lim.has(w) && w.z > hc && w.z <= zTop);
    const pw = lerp(hc, rb, lie * lie) + (P.ph >= 2 ? 0 : 0);
    return {
      po: { gs: 0.5 * lie * lie, flat: 0.85 * lie * lie, th: P.th, a: o.a, roll: P.roll || 0, lag: (P.lag || 0) / M / k, pz: hc, pw, ox: o.x, oy: o.y, grd: P.th > 0.3, lift: lowest ? 0.3 * lie : 0, lz0: lowest ? lowest.z : 0, sink: o.sink, snow: o.snowN != null ? o.snowN : 1 },
      ro: { aok: 0.35, aoz: lowest ? lowest.z : 1e9, z0: hc, z1: zTop, has: w => !lim.has(w) && w.z <= zTop, stubs: w => lim.has(w), discs: [[hc, -1, 1]].concat(zTop < S.H - 0.01 ? [[zTop, 1, 1]] : []), dsnow: o.dsnow || 0 },
    };
  }
  // кэш лежачих: та же картинка, пока состояние не изменилось (ключ), иначе — перепечь
  const LC = new WeakMap(); let lcBudget = 2;
  function drawLog(g, o, P) {
    const { S, k } = of(o), X = logOpts(S, k, o, P), dpr = g.getTransform().a;
    const still = P.ph === 3 && !low() ? 1 : P.ph === 3 ? 1 : 0;
    if (still) {
      const key = [o.cut || 0, o.zTop, o.snowN && o.snowN.toFixed(1), o.dsnow && o.dsnow.toFixed(1), dpr.toFixed(2), o.sink ? o.sink.join(',') : ''].join('|');
      let c = LC.get(o);
      if (!c || c.key !== key) { if (lcBudget > 0 || !c) { lcBudget--; c = bakeLog(S, k, o, X, dpr, key); if (c) LC.set(o, c); } }
      if (c) { g.drawImage(c.cv, o.x + c.x0, o.y + c.y0, c.w, c.h); return; }
    }
    const Rt = S.H * k * M + crownPx(S, k) + 20;
    viaCanvas(g, o, o.x - Rt, o.y - Rt, Rt * 2, Rt * 1.75, 1, (c, s) => {
      shadowLog(c, S, k, o, X, P);
      pose(S, k, X.po); render(c, S, Object.assign({ sc: 1 / s }, X.ro));
      sinkFx(c, S, k, o, X);
    });
  }
  function bakeLog(S, k, o, X, dpr, key) {
    // рамка: концы ствола и кончики ветвей
    pose(S, k, Object.assign({}, X.po, { ox: 0, oy: 0 }));
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; const add = () => { if (SX < x0) x0 = SX; if (SX > x1) x1 = SX; if (SY < y0) y0 = SY; if (SY > y1) y1 = SY; };
    tf(0, 0, X.ro.z0, X.ro.z0); add(); tf(0, 0, X.ro.z1, X.ro.z1); add();
    for (const w of S.wh) for (const b of w.br) for (const t of [0.5, 1]) { const q = brPt(S, b, w.z, t); tf(q[0], q[1], q[2], w.z); add(); }
    const m = 8; x0 -= m; y0 -= m; x1 += m; y1 += m + 4;
    const W = Math.ceil((x1 - x0) * dpr), H = Math.ceil((y1 - y0) * dpr); if (W > 2600 || H > 2600 || W < 1 || H < 1) return null;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
    const o0 = { x: 0, y: 0 }, oo = Object.assign({}, o, o0);
    shadowLog(g, S, k, oo, X, LIE_P);
    pose(S, k, Object.assign({}, X.po, { ox: 0, oy: 0 })); render(g, S, Object.assign({ sc: 1 / dpr }, X.ro));
    sinkFx(g, S, k, oo, X);
    return { cv, key, x0, y0, w: x1 - x0, h: y1 - y0 };
  }
  const LIE_P = { th: Math.PI / 2, lag: 0, roll: 0, ph: 3 };
  // тень на снегу вдоль ствола и кроны (лежит/почти лёг)
  function shadowLog(g, S, k, o, X, P) {
    const lie = Math.pow(Math.sin(P.th), 2); if (lie < 0.3) return; const A = W_(); if (!A) return;
    const zc = X.ro.z1, n = 6, a0 = g.globalAlpha;
    for (let i = 0; i <= n; i++) {
      const z = X.ro.z0 + (zc - X.ro.z0) * i / n, d = (z - X.ro.z0) * k * M, cx = o.x + Math.cos(o.a) * d, cy = o.y + Math.sin(o.a) * d * 0.6;
      let rc = rz(S, z) * k * M * 2 + 2; for (const w of S.wh) if (Math.abs(w.z - z) < 0.5 && X.ro.has(w)) { for (const b of w.br) rc = Math.max(rc, b.len * k * M * 0.55); }
      g.globalAlpha = a0 * lie; A.shadow(g, cx + 2, cy + 3, rc, rc * 0.42, 0.22);
    }
    g.globalAlpha = a0;
  }
  // ствол в полынье: шуга и вода по линии проваленного участка
  function sinkFx(g, S, k, o, X) {
    if (!o.sink) return; const [z0, z1] = o.sink;
    for (let z = z0; z <= z1; z += 0.18) {
      const d = (z - X.ro.z0) * k * M, cx = o.x + Math.cos(o.a) * d, cy = o.y + Math.sin(o.a) * d * 0.6, r = Math.max(2.5, rz(S, z) * k * M * 2.2) + 2;
      g.fillStyle = 'rgba(36,55,70,0.55)'; g.beginPath(); g.ellipse(cx, cy + 0.5, r * 1.1, r * 0.45, o.a * 0.6, 0, TAU); g.fill();
      for (let i = 0; i < 3; i++) { const u = hh((z * 100) | 0, i), v = hh((z * 100) | 0, i + 7); g.fillStyle = i % 2 ? '#c9d7e2' : '#e6eef4'; g.beginPath(); g.ellipse(cx + (u - 0.5) * r * 2, cy + (v - 0.5) * r * 0.6, 1.2 + u * 1.6, 0.6 + v * 0.6, u * 3, 0, TAU); g.fill(); }
    }
  }
  // ---------- отделённые части на снегу ----------
  // чурка/комель/вершина: лежит по ang, катится от места реза (fx, fy) 0.45 с; лапник — падает с ветвью 0.55 с с задержкой dl
  // лёг — своя картинка (перепечь, когда подсыпало снега); летит/катится — живьём
  function drawPart(g, p, time) {
    if (!p.sk || time - p.t - (p.dl || 0) < 0.6) return drawPart0(g, p, time);
    const ver = Math.round(snowAge(p, time) * 10) + '|' + Math.round(clamp((time - p.t) / (CYCLE * 0.75), 0, 1) * 20), r = p.len * M * 0.75 + 12;
    viaCanvas(g, p, p.x - r, p.y - r * 0.85, r * 2, r * 1.6, ver, c => drawPart0(c, p, time), 3);
  }
  function drawPart0(g, p, time) {
    const dpr = g.getTransform().a, sc = 1 / Math.max(0.5, dpr);
    if (p.kind === 'bough' || p.kind === 'branch') return drawBoughPart(g, p, time, sc);
    if (!p.sk) { const A = W_(); if (A) A.chunk(g, p.x, p.y, p.a || 0); return; }   // старый сейв: чурка без формы
    const { S } = of(p), k = p.k, len = (p.z1 - p.z0) * k, e = p.fx != null ? clamp((time - p.t) / 0.45, 0, 1) : 1, ke = 1 - (1 - e) * (1 - e);
    const cx = p.fx != null ? lerp(p.fx, p.x, ke) : p.x, cy = p.fx != null ? lerp(p.fy, p.y, ke) - 4 * Math.sin(Math.PI * Math.min(1, e * 1.6)) * (1 - e) : p.y;
    const a = p.ang, ca = Math.cos(a), sa = Math.sin(a), h = len / 2 * M, ox = cx - ca * h, oy = cy - sa * h * 0.6;
    const rr = (rz(S, p.z0) + rz(S, p.z1)) / 2, roll = (p.id || 0) * 1.7 + (1 - ke) * 6;
    const A = W_(); if (A) A.shadow(g, cx + 1, cy + 1.5, Math.max(4, len * M * 0.55), Math.max(2, rr * k * M * 1.6), 0.3);
    if (p.kind === 'top') {
      pose(S, k, { th: Math.PI / 2, a, roll, pz: p.z0, pw: rr, ox, oy, grd: 1, lift: 0.12, lz0: p.z0, gs: 0.4, flat: 0.85, snow: snowAge(p, time) });
      return render(g, S, { z0: p.z0, z1: S.H, discs: [[p.z0, -1, 1]], sc });
    }
    pose(S, k, { th: Math.PI / 2, a, roll, pz: p.z0, pw: rr, ox, oy });
    const sn = snowAge(p, time);
    render(g, S, { aok: 0, z0: p.z0, z1: p.z1, has: () => false, stubs: () => true, discs: [[p.z0, -1, 1], [p.z1, 1, 1]], dsnow: sn * 0.6, sc });
    if (sn > 0.05) { g.globalAlpha *= Math.min(1, sn * 1.5); g.fillStyle = '#f3f7fb'; tf(0, 0, p.z0 + 0.02, p.z0); const x0 = SX, y0 = SY; tf(0, 0, p.z1 - 0.02, p.z1); g.lineCap = 'round'; g.strokeStyle = '#f3f7fb'; g.lineWidth = Math.max(0.8, rr * k * M * 0.9); g.beginPath(); g.moveTo(x0, y0 - rr * k * M * 0.75); g.lineTo(SX, SY - rr * k * M * 0.75); g.stroke(); g.globalAlpha = 1; }
  }
  const snowAge = (p, time) => clamp((time - p.t) / (CYCLE * 0.6), 0, 0.85);
  function drawBoughPart(g, p, time, sc) {
    const { S } = of(p), k = p.k, w = S.wh[p.w], b = w && w.br.find(q => q.j === p.b); if (!b) return;
    const e = clamp((time - p.t - (p.dl || 0)) / 0.55, 0, 1), ke = e * e;
    const bury = clamp((time - p.t) / (CYCLE * 0.75), 0, 1); if (bury >= 1) return;
    const half = b.len * k * 0.45 * M, ca = Math.cos(p.ang), sa = Math.sin(p.ang);
    let bx = p.x - ca * half, by = p.y - sa * half * 0.6, lift = 0, tw = 0;
    if (e < 1 && p.fx != null) { bx = lerp(p.fx, bx, ke); by = lerp(p.fy, by, ke); lift = (p.fz || 0.3) * (1 - ke); tw = (1 - e) * 0.9; }
    const A = W_(), a0 = g.globalAlpha, fade = 1 - sm(0.75, 1, bury); g.globalAlpha = a0 * fade;
    if (A && e >= 1) A.shadow(g, p.x + 1, p.y + 1.5, b.len * k * M * 0.55, b.len * k * M * 0.22, 0.2);
    // ветвь целиком поворачиваем: её азимут → ang, основание — в (bx, by)
    pose(S, k, { roll: p.ang - b.az, pz: w.z, pw: lift / k + 0.02, ox: bx - Math.cos(p.ang) * rz(S, w.z) * k * M, oy: by - Math.sin(p.ang) * rz(S, w.z) * k * M * 0.6, grd: 1, gs: 0.25, flat: 1, snow: snowAge(p, time) });
    if (tw) { const c = Math.cos(tw), s = Math.sin(tw), r = R; R = [r[0], r[1] * c - r[2] * s, r[1] * s + r[2] * c, r[3], r[4] * c - r[5] * s, r[4] * s + r[5] * c, r[6], r[7] * c - r[8] * s, r[7] * s + r[8] * c]; }
    if (S.P.bare || b.dead) drawBare(g, S, b, w.z, low(), sc); else drawBough(g, S, b, w.z, low(), sc);
    if (bury > 0.3) { g.globalAlpha = a0 * fade * sm(0.3, 0.75, bury); g.fillStyle = '#eef3f8'; g.beginPath(); g.ellipse(p.x, p.y - 1, b.len * k * M * 0.5, b.len * k * M * 0.2, p.ang * 0.6, 0, TAU); g.fill(); }
    g.globalAlpha = a0;
  }
  function frame() { lcBudget = 2; FR++; }

  // ---------- дерево × лёд ----------
  // нагрузка удара ствола на лёд (Н) по окнам ~1.5 м: Σ dm·v²/(2δ), v = ω·r (маятник вокруг пня), δ — смятие (ствол 0.15 м, крона 0.4 м)
  // прочность на пролом: P = A·h² (кгс, h в см; A ≈ 12 — пролом, «правило Голда»)
  function iceImpact(L, thick) {
    ensure(L); const { S, k } = of(L), k3 = k * k * k, hc = L.hc, H = S.H, n = 40, dz = (H - hc) / n;
    let I = 0, Mg = 0; const seg = [];
    for (let i = 0; i < n; i++) {
      const z = hc + (i + 0.5) * dz; let m = stemV(S, z - dz / 2, z + dz / 2) * k3 * S.P.rho, mc = 0;
      for (const w of S.wh) if (w.z >= z - dz / 2 && w.z < z + dz / 2) for (const b of w.br) mc += brMass(S, b, k);
      const r = (z - hc) * k; I += (m + mc) * r * r; Mg += (m + mc) * 9.81 * r; seg.push({ z, m, mc, r });
    }
    const w2 = 2 * Mg / (I || 1), out = [];
    for (const q of seg) { const p = alongPx(L, q.z), h = thick(p.x, p.y); if (h == null) continue; const v2 = w2 * q.r * q.r; q.F = q.m * v2 / (2 * 0.15) + q.mc * v2 / (2 * 0.4); q.h = h; q.p = p; }
    const win = Math.max(2, Math.round(1.5 / (dz * k)));
    for (let i = 0; i + win <= seg.length; i++) {
      let F = 0, h = 1e9, on = 0; for (let j = i; j < i + win; j++) { const q = seg[j]; if (q.F == null) continue; F += q.F; h = Math.min(h, q.h); on++; }
      if (!on) continue; const cap = 12 * Math.pow(h * 100, 2) * 9.81; out.push({ z0: seg[i].z, z1: seg[i + win - 1].z, F, cap, h, brk: F > cap });
    }
    return { w: Math.sqrt(w2), win: out };
  }

  return {
    M, KG, CH, HC, KP, TS, workZ, spec, of, size, ensure, whole, parts, split, take, isWood, woodOf, massOf, rz, stemV,
    paintSprite, drawStanding, drawStump, drawLog, drawPart, live, shook, snowOf, frame, iceImpact, varOf, jit, MODEL,
    get stats() { return { specs: SPECS.size }; },
  };
})();
