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
//     z0, z1 (участок ствола, м класса) · w, b (мутовка и ветвь — у лапника) · fz (м, высота отрыва над снегом) · pin: 1 — ветвь подмята, лежит под стволом }
//   лапник: (fx, fy) — точка крепления на стволе, (x, y) — центр, ang — куда смотрит от основания (основание = центр − 0.45·длины по ang);
//   L.hits — номер удара по стволу (ГСЧ разлёта, в сейве)
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
  // мутовки ниже вершины (их обрубают — по мутовке от комля); L.lm[i] — какие ветви i-й мутовки уже срублены (биты по порядку в w.br)
  const limbW = (S, L) => S.wh.filter(w => w.z < L.zt && w.z > L.hc);
  function lmOf(S, L) {
    const lw = limbW(S, L);
    if (!L.lm || L.lm.length !== lw.length) {   // старый сейв: доля L.cut — целые мутовки от комля
      const n = Math.floor(lw.length * (L.cut || (L.lim ? 1 : 0)) + 1e-6); L.lm = lw.map((w, i) => (i < n ? (1 << w.br.length) - 1 : 0));
    }
    return L.lm;
  }
  const isCut = (L, i, j) => !!((L.lm[i] >> j) & 1);
  // доля срубленных ветвей (L.cut — для старых проверок и подписей: 1 — обрублено всё)
  function cutFrac(S, L) { const lw = limbW(S, L), lm = lmOf(S, L); let a = 0, n = 0; lw.forEach((w, i) => { for (let j = 0; j < w.br.length; j++) { n++; if (isCut(L, i, j)) a++; } }); return n ? a / n : 1; }
  // мутовка обрублена целиком — пеньки сучьев видны; нижняя необрубленная — ствол лежит на ней (LIFT)
  const limbedN = (S, L) => { const lm = lmOf(S, L), lw = limbW(S, L); let n = 0; while (n < lw.length && lm[n] === (1 << lw[n].br.length) - 1) n++; return n; };
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
    const lw = limbW(S, L), lm = o.zt == null ? null : lmOf(S, L);
    for (let i = 0; i < lw.length; i++) lw[i].br.forEach((b, j) => { if (!lm || !isCut(L, i, j)) out.push(bough(S, k, lw[i], b)); });   // лапник (хвоя) или голая ветвь/сухой сук
    if (!L.top) out.push(piece(S, k, 'top', L.zt, S.H, true));
    const zTop = L.top ? L.zTop : L.zt, n = Math.max(0, Math.round((zTop - L.hc) / L.cl));
    for (let i = n - 1; i >= 0; i--) out.push(piece(S, k, i ? 'chunk' : 'butt', L.hc + i * L.cl, i === n - 1 ? zTop : L.hc + (i + 1) * L.cl, false));
    return out;
  }
  const massOf = list => list.reduce((a, p) => a + (p.fixed ? 0 : p.mass), 0);
  // точка ствола (класс z) → мир px
  const alongPx = (L, z) => { const d = (z - L.hc) * L.k * M; return { x: L.x + Math.cos(L.a) * d, y: L.y + Math.sin(L.a) * d * 0.6 }; };
  // ---------- куда ложатся отделённые части (метры по земле: X → мир x/M, Y → мир y/(0.6·M)) ----------
  // ГСЧ удара: своя на ствол и номер удара (L.hits — в сейве), без общего Math.random: каждое дерево и удар — свой разлёт
  function hitRng(L) {
    L.hits = (L.hits || 0) + 1; const id = L.id != null ? L.id | 0 : (Math.imul(L.x | 0, 73856093) ^ Math.imul(L.y | 0, 19349663));
    return rng(Math.imul(id ^ 0x2c1b3c6d, 2654435761) ^ Math.imul(L.hits, 0x27d4eb2f) ^ ((L.sk | 0) * 131));
  }
  // направление удара по земле (ед.): от героя к месту на стволе; героя нет — случайная сторона поперёк оси
  function strike(L, gx, gy, r) {
    const p = typeof G !== 'undefined' && G.p;
    if (p) { const dx = (gx - p.x) / M, dy = (gy - p.y) / (0.6 * M), l = Math.hypot(dx, dy); if (l > 0.05) return [dx / l, dy / l]; }
    const sd = r() < 0.5 ? 1 : -1; return [-Math.sin(L.a) * sd, Math.cos(L.a) * sd];
  }
  // не внутрь стоящих стволов (и героя — для катящихся чурок): выталкиваем центр части из их круга (px мира)
  function clear(x, y, rad, hero) {
    const T = typeof G !== 'undefined' && G.trees || [], tr = typeof World !== 'undefined' && World.trunkR ? World.trunkR : t => 4 + 8 * (t.s || 1);
    const ob = []; for (const t of T) if (t.wood > 0 && Math.abs(t.x - x) < 30 && Math.abs(t.y - y) < 30) ob.push([t.x, t.y, tr(t)]);
    if (hero && typeof G !== 'undefined' && G.p) ob.push([G.p.x, G.p.y, 7]);
    for (let it = 0; it < 3; it++) for (const [ox, oy, orr] of ob) { const dx = x - ox, dy = y - oy, d = Math.hypot(dx, dy), m = orr + rad; if (d < m) { const ux = d > 0.01 ? dx / d : 0, uy = d > 0.01 ? dy / d : 1; x = ox + ux * m; y = oy + uy * m; } }
    return [Math.round(x), Math.round(y)];
  }
  // чурка/комель/вершина: отделяется в месте реза [za, zb] на оси ствола, падает с высоты оси и откатывается поперёк (недалеко),
  // в сторону от удара чаще; поворачивается, пока катится. Вершина — у конца ствола, почти на месте.
  function place(L, p, za, zb, r, s) {
    const { S, k } = of(L), zc = (za + zb) / 2, q = alongPx(L, zc), ea = [Math.cos(L.a), Math.sin(L.a)], n = [-ea[1], ea[0]];
    const rc = (p.d0 + p.d1) / 4 || p.diam / 2, hAx = rz(S, L.hc) * k, sn = Math.sign(s[0] * n[0] + s[1] * n[1]) || 1, side = r() < 0.72 ? sn : -sn;
    let lat, du, da;
    if (p.kind === 'top') { lat = side * (0.05 + 0.3 * r()); du = (r() - 0.3) * 0.3; da = (r() - 0.5) * 0.5; }
    else {   // катится: путь ~ высота падения + толчок, короткая чурка разворачивается сильнее
      lat = side * (rc * 0.6 + hAx * 0.3 + (0.04 + 0.65 * r() * r()) * (1 - 0.4 * Math.min(1, p.mass / 120)));
      du = (r() - 0.3) * 0.4; da = (r() - 0.5) * (p.len < 0.7 ? 1.6 : 0.7);
    }
    const X = ea[0] * du + n[0] * lat, Y = ea[1] * du + n[1] * lat;
    p.fx = Math.round(q.x); p.fy = Math.round(q.y); p.fz = +hAx.toFixed(2);
    [p.x, p.y] = clear(q.x + X * M, q.y + 0.6 * Y * M, rc * M, 1);
    p.ang = +(L.a + da).toFixed(3);
  }
  function push(p) {
    G.chunks = G.chunks || []; p.id = (G.partN = (G.partN || 0) + 1); p.t = G.time; if (p.src == null && SRC != null) p.src = SRC; G.chunks.push(p);
    // лапник, заметённый с головой, сверх 320 частей — уходит (дрова не уходят никогда)
    if (G.chunks.length > 320) { const i = G.chunks.findIndex(q => (q.kind === 'bough' || q.kind === 'branch') && G.time - q.t > CYCLE * 0.75); if (i >= 0) G.chunks.splice(i, 1); }
    return p;
  }
  // ---------- обрубка: по мутовке от комля к вершине. Герой — по одну сторону ствола (hs ±1 к нормали); рубит ветви, что торчат вверх
  // и на дальнюю сторону (топор — не к ногам); ветви своей стороны — перейти; подмятые стволом (pin) — только после переката (L.roll);
  // вершину — отдельным ударом, когда ветвей не осталось. 'buck' — чурку с конца. ----------
  let SRC = null;
  // геометрия ветви на лежащем стволе (поза «лежит» с перекатом): A — крепление, D — ось ветви (м, от комля), tipZ — высота кончика
  function brGeo(S, k, L, X, w, b) {
    pose(S, k, Object.assign({}, X, { ox: 0, oy: 0, gs: 0, grd: 0, lag: 0 }));
    const r0 = rz(S, w.z); tf(Math.cos(b.az) * r0, Math.sin(b.az) * r0, w.z, w.z); const A = [TX, TY, TZ];
    const T1 = brPt(S, b, w.z, 1); tf(T1[0], T1[1], T1[2], w.z); const D = [TX - A[0], TY - A[1], TZ - A[2]];
    return { A, D, tipZ: TZ, Lb: b.len * k, hl: Math.hypot(D[0], D[1]) };
  }
  function brCls(S, k, L, X, w, b) {
    const g = brGeo(S, k, L, X, w, b), n = [-Math.sin(L.a), Math.cos(L.a)];
    if ((g.tipZ < 0.02 && g.A[2] < (X.pw + (X.lift || 0)) * k) || g.D[2] < -0.5 * g.Lb) return { c: 'pin', sd: Math.sign(g.D[0] * n[0] + g.D[1] * n[1]) || 1, g };
    if (g.D[2] > 0.55 * g.Lb || g.hl < 0.3 * g.Lb) return { c: 'up', sd: 0, g };
    return { c: 'side', sd: Math.sign(g.D[0] * n[0] + g.D[1] * n[1]) || 1, g };
  }
  // можно ли срубить с героем на стороне hs; после двух перекатов подмятые достаются топором (ствол уже не повернуть удобнее)
  const canCut = (L, cl, hs) => cl.c === 'up' || (cl.c === 'side' && cl.sd !== hs) || (cl.c === 'pin' && (L.rn || 0) >= 2 && cl.sd !== hs);
  // план обрубки: {i, z} — мутовка (от комля) | {side} — эту сторону всю прошёл, перейти | {roll: 1} — остались подмятые | {top: 1} — ветвей нет
  const PLAN = new WeakMap();
  function limbPlan(L, hs) {
    ensure(L); const { S, k } = of(L), lw = limbW(S, L), lm = lmOf(S, L), key = lm.join(',') + '|' + (L.roll || 0) + '|' + hs + '|' + (L.rn || 0) + '|' + L.a;
    const ca = PLAN.get(L); if (ca && ca.key === key) return ca.r;
    const X = logOpts(S, k, L, LIE_P).po; let other = null, pinned = 0, r = null;
    for (let i = 0; i < lw.length && !r; i++) lw[i].br.forEach((b, j) => {
      if (r || isCut(L, i, j)) return; const cl = brCls(S, k, L, X, lw[i], b);
      if (canCut(L, cl, hs)) r = { i, z: lw[i].z }; else if (canCut(L, cl, -hs)) { if (other == null) other = { side: -hs, i, z: lw[i].z }; } else pinned++;
    });
    if (!r) r = other || (pinned ? { roll: 1 } : { top: 1 });
    PLAN.set(L, { key, r }); return r;
  }
  // для проверок (tests/tree-check.js): состояние каждой ветви на лежащем стволе — мутовка i, ветвь j, класс (pin/up/side), сторона, срублена ли
  function limbState(L) {
    ensure(L); const { S, k } = of(L), lw = limbW(S, L), X = logOpts(S, k, L, LIE_P).po, out = []; lmOf(S, L);
    lw.forEach((w, i) => w.br.forEach((b, j) => { const cl = brCls(S, k, L, X, w, b); out.push({ i, j, c: cl.c, sd: cl.sd, cut: isCut(L, i, j) }); }));
    return out;
  }
  function split(L, op, hs) {
    ensure(L); SRC = L.id; const { S, k } = of(L), out = [];
    if (op === 'limb') {
      if (!hs) hs = L.ls || (typeof G !== 'undefined' && G.p ? (Math.sign((G.p.x - L.x) / M * -Math.sin(L.a) + (G.p.y - L.y) / (0.6 * M) * Math.cos(L.a)) || 1) : 1);
      const pl = limbPlan(L, hs); if (pl.i == null || pl.side) return out;
      const lw = limbW(S, L), w = lw[pl.i], X = logOpts(S, k, L, LIE_P).po, r = hitRng(L), wp = alongPx(L, w.z), s = strike(L, wp.x, wp.y, r);
      let n = 0;
      w.br.forEach((b, j) => {
        if (isCut(L, pl.i, j)) return; const cl = brCls(S, k, L, X, w, b); if (!canCut(L, cl, hs)) return;
        const p = bough(S, k, w, b), g = boughRest(S, k, L, w, b, r, s, cl);
        Object.assign(p, g, { dl: +(n++ * 0.07).toFixed(2) });   // dl — задержка: ветви отделяются по одной
        L.lm[pl.i] |= 1 << j; out.push(push(p));
      });
      L.cut = +cutFrac(S, L).toFixed(4); delete L.lim; PLAN.delete(L);
      return out;
    }
    if (op === 'top') {   // вершина — когда ветвей не осталось
      if (L.top || cutFrac(S, L) < 1) return out;
      const r = hitRng(L), wp = alongPx(L, L.zt), s = strike(L, wp.x, wp.y, r), p = piece(S, k, 'top', L.zt, S.H, true);
      place(L, p, L.zt, S.H, r, s); out.push(push(p)); L.top = 1; L.zTop = L.zt; L.cut = 1; return out;
    }
    if (op === 'buck') {
      if (!L.top || L.n <= 0) return out;
      let p; const r = hitRng(L), z0 = L.n <= 1 ? L.hc : Math.max(L.hc, L.zTop - L.cl), wp = alongPx(L, z0), s = strike(L, wp.x, wp.y, r);
      if (L.n <= 1) { p = piece(S, k, 'butt', L.hc, L.zTop, false); place(L, p, L.hc, L.zTop, r, s); L.zTop = L.hc; L.n = 0; }
      else { p = piece(S, k, 'chunk', z0, L.zTop, false); place(L, p, z0, L.zTop, r, s); L.zTop = z0; L.n--; }
      out.push(push(p));
      // последний рез отделяет и комель: остаток ствола — тоже часть, которую можно взять (сам по себе — не катится, лишь сползает)
      if (L.n === 1) { const q = piece(S, k, 'butt', L.hc, L.zTop, false); place(L, q, L.hc, L.zTop, r, [-s[0], -s[1]]); L.zTop = L.hc; L.n = 0; out.push(push(q)); }
    }
    return out;
  }
  // где работает топор (класс z): обрубка — мутовка по плану (или середина ствола — перекатить), вершина, раскряжёвка — место реза
  function workZ(L, hs) {
    ensure(L); const { S } = of(L);
    if (cutFrac(S, L) < 1) { const pl = limbPlan(L, hs || 1); return pl.z != null ? pl.z : pl.roll ? (L.hc + L.zt) / 2 : L.zt; }
    if (!L.top) return L.zt;
    return L.n <= 1 ? (L.hc + L.zTop) / 2 : L.zTop - L.cl;
  }
  // где ляжет обрубленная ветвь: отделяется у ствола в месте крепления и оседает под своим весом (не летит):
  // торчала вбок — ложится туда же, основание соскальзывает; вверх — валится через ствол на сторону удара; подмятая — где была.
  // Ветви ели растут к вершине — лёжа смотрят к ней; основания — вразброс вдоль ствола (±0.25 м), не «звездой» из одной точки.
  // Форма «лежит» считается здесь один раз (az — высоты оси, см) и хранится в части.
  function boughRest(S, k, L, w, b, r, s, cl) {
    const { A, D, Lb, hl } = cl.g, ea = [Math.cos(L.a), Math.sin(L.a)], n = [-ea[1], ea[0]], rL = rz(S, w.z) * k;
    const sn = Math.sign(s[0] * n[0] + s[1] * n[1]) || 1, rot = (v, f) => [v[0] * Math.cos(f) - v[1] * Math.sin(f), v[0] * Math.sin(f) + v[1] * Math.cos(f)];
    let dir, base = [A[0], A[1]], push = (0.04 + 0.16 * r()) / (1 + brMass(S, b, k) / 6);
    if (cl.c === 'up') { const sd = r() < 0.72 ? sn : -sn; dir = rot([n[0] * sd, n[1] * sd], (r() - 0.5) * 0.9); base = [A[0] + n[0] * sd * rL * (0.6 + 0.6 * r()), A[1] + n[1] * sd * rL * (0.6 + 0.6 * r())]; }
    else if (cl.c === 'side') { dir = rot([D[0] / (hl || 1), D[1] / (hl || 1)], (r() - 0.5) * 0.5); const sl = Math.min(0.25, Math.max(0, A[2]) * 0.3 * r()); base = [A[0] + dir[0] * sl, A[1] + dir[1] * sl]; }
    else { dir = hl > 0.15 * Lb ? [D[0] / hl, D[1] / hl] : [n[0] * cl.sd, n[1] * cl.sd]; push *= 0.2; }
    const tw = 0.45 + 0.35 * r(); dir = [dir[0] + ea[0] * tw, dir[1] + ea[1] * tw]; { const l = Math.hypot(dir[0], dir[1]) || 1; dir = [dir[0] / l, dir[1] / l]; }   // к вершине
    const sp = (r() - 0.5) * 0.5;   // вдоль ствола ±0.25 м
    base = [base[0] + ea[0] * sp + s[0] * push, base[1] + ea[1] * sp + s[1] * push];
    const h = Lb * 0.45, ca = [base[0] + dir[0] * h, base[1] + dir[1] * h], q = alongPx(L, L.hc);
    const [x, y] = clear(q.x + ca[0] * M, q.y + 0.6 * ca[1] * M, Lb * 0.12 * M);
    // ось «лежит»: основание у снега, середина приподнята боковыми побегами (10–25 см, у коротких — ниже), кончик в снегу
    const mid = 10 + 15 * r() * clamp(Lb / 0.9, 0.4, 1);
    const az = [2 + Math.round(2 * r()), Math.round(mid * (0.62 + 0.15 * r())), Math.round(mid), Math.round(mid * (0.45 + 0.2 * r())), -Math.round(2 + 3 * r())];
    const dl = Math.hypot(D[0], D[1], D[2]) || 1;
    return { fx: Math.round(q.x + A[0] * M), fy: Math.round(q.y + 0.6 * A[1] * M), fz: +Math.max(0, A[2]).toFixed(2), x, y, ang: +Math.atan2(dir[1], dir[0]).toFixed(3),
      az, ss: r() < 0.5 ? 1 : -1, tl: +((r() - 0.5) * 0.5).toFixed(2), d0: [+(D[0] / dl).toFixed(2), +(D[1] / dl).toFixed(2), +(D[2] / dl).toFixed(2)], ...(cl.c === 'pin' ? { pin: 1 } : {}) };
  }
  // дрова — чурка, комель, вершина (своя масса и объём; подбор — js/carry.js, руки → рюкзак/нарты/поленница); лапник — не дрова
  const isWood = p => !p.kind || p.kind === 'chunk' || p.kind === 'butt' || p.kind === 'top';
  const take = p => ({ kg: p.mass != null ? p.mass : KG, l: p.vol != null ? p.vol * 1000 : KG / 0.79 });
  // сколько дров даст дерево (для отчёта/баланса)
  function woodOf(t) { const L = ensure({ x: t.x, y: t.y, s: t.s, kind: t.kind, v: t.v }); return massOf(parts(L).filter(isWood)) / KG; }

  // ================= ПРОЕКЦИЯ И ПОЗА =================
  // словарь C (js/style.js): одно солнце на всю игру; 2 тона, тушь — контуром силуэта (Style.inked/figure), без градиентов и бликов
  // гибрид — только одно солнце словаря (LD); плоский C (Style.flat) — 2 тона и тушь
  const SC = typeof Style !== 'undefined' && Style.flat, SP = SC ? Style.P : null;
  const LD = typeof Style !== 'undefined' && Style.on ? Style.SUN : (() => { const v = [-0.6, -0.38, 0.7], l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })();
  const VW = [0, 0.8, 0.6];
  let R = [1, 0, 0, 0, 1, 0, 0, 0, 1], PZ = 0, PW = 0, PXo = 0, PYo = 0, KS = 1, OX = 0, OY = 0, BX = 0, BY = 0, BH = 1, GRD = 0, LIFT = 0, LZ0 = 0, LZ1 = 1, LH = 1;
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
    PZ = o.pz || 0; PW = o.pw != null ? o.pw : PZ; PXo = o.px || 0; PYo = o.py || 0; KS = k; OX = o.ox || 0; OY = o.oy || 0; BH = S.H;   // px/py — точка поворота сдвинута от оси (кромка недоруба, класс)
    const lg = o.lag || 0; BX = (o.bend ? o.bend[0] : 0) - Math.cos(a) * lg; BY = (o.bend ? o.bend[1] : 0) - Math.sin(a) * lg;
    GRD = o.grd ? 1 : 0; LIFT = o.lift || 0; LZ0 = o.lz0 || 0; LZ1 = LZ0 + 0.7; LH = S.H;
    SK0 = o.sink ? o.sink[0] : 1e9; SK1 = o.sink ? o.sink[1] : -1e9; SKD = o.sink ? o.sink[2] : 0;
    VIB = o.vib || 0; VT = o.t || 0; GS = o.gs || 0; GT = 0; FLAT = o.flat || 0; SNOW = o.snow != null ? o.snow : 1; ZADD = 0; ALPHA = o.al != null ? o.al : 1;
  }
  function tf(x, y, z, za) {
    const q = za / BH, b = q * q; x += BX * b - PXo; y += BY * b - PYo; z -= PZ;
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
      path(g, n / 2); g.fillStyle = SC ? SP.ink : tone(P.ndl, bri * 0.42 + 0.05); g.fill();
    };
    if (!under) curtain();
    // лапа
    const O = outline(lq ? 4 : mid ? 6 : 9); let n = 0;
    for (const [t, s] of O) { const j = s ? 0.8 + 0.35 * hh(b.sd, n) : 1; pt(t, s * j, 0); BUF[n * 2] = SX; BUF[n * 2 + 1] = SY; n++; }
    path(g, n);
    if (SC) g.fillStyle = !under && bri > 0.5 ? SP.pine : SP.ink;   // C: лапа — свет (хвоя) или тень (тушь)
    else if (lq || mid) g.fillStyle = tone(P.ndl, 0.18 + 0.55 * bri);
    else { pt(0.05, 0, 0); const x0 = SX, y0 = SY; pt(1, 0, 0); const gr = g.createLinearGradient(x0, y0, SX, SY); gr.addColorStop(0, tone(P.ndl, 0.06 + 0.2 * bri)); gr.addColorStop(0.5, tone(P.ndl, 0.22 + 0.45 * bri)); gr.addColorStop(1, tone(P.ndl, 0.32 + 0.62 * bri)); g.fillStyle = gr; }
    g.fill();
    if (under) curtain();
    // побеги «ёлочкой»: тёмные щели между боковыми веточками и светлые верхушки (C — нет: мелкая деталь внутри силуэта)
    if (!lq && !SC) {
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
      const a0 = g.globalAlpha; g.globalAlpha = a0 * (SC ? 1 : Math.min(1, sk * 1.4));
      band(th * 0.35); g.fillStyle = SC ? SP.shade : '#9fb5cb'; g.fill();
      band(th); g.fillStyle = SC ? SP.paper : lq ? '#eef3f8' : '#f3f7fb'; g.fill();
      if (!lq && !mid && !SC) { g.fillStyle = 'rgba(255,255,255,0.9)'; ZADD = th * 1.15; pt(0.35, 0.25, 0); const ax = SX, ay = SY; pt(0.62, 0.2, 0); ZADD = 0; GT = 0; g.lineWidth = Math.max(0.5, th * M * 0.9) * sc; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.moveTo(ax, ay); g.lineTo(SX, SY); g.stroke(); }
      g.globalAlpha = a0; GT = 0;
    }
  }
  // голая ветвь (берёза, сухостой): сужающаяся линия, боковые прутья, у берёзы — свисающие веточки; снег — тонкой линией сверху
  function drawBare(g, S, b, wz, lq, sc) {
    const P = S.P, w0 = Math.max(0.5, b.db * KS * M) * sc;
    g.strokeStyle = SC ? SP.ink : b.dead ? '#4d443c' : P.twig; g.lineCap = 'round';
    let px, py; for (let i = 0; i <= 4; i++) { const q = brPt(S, b, wz, i / 4); GT = i / 4 * b.len; tf(q[0], q[1], q[2], wz); if (i) { g.lineWidth = w0 * (1 - i / 5); g.beginPath(); g.moveTo(px, py); g.lineTo(SX, SY); g.stroke(); } px = SX; py = SY; }
    GT = 0; if (lq) return;
    const sub = (t0, da, l) => { const q = brPt(S, b, wz, t0), az = b.az + da; GT = t0 * b.len; tf(q[0], q[1], q[2], wz); const x0 = SX, y0 = SY;
      tf(q[0] + Math.cos(az) * l * 0.7, q[1] + Math.sin(az) * l * 0.7, q[2] + l * (P.burnt ? 0.5 : 0.35), wz); g.moveTo(x0, y0); g.lineTo(SX, SY);
      if (!P.burnt) { const ex = SX, ey = SY; tf(q[0] + Math.cos(az) * l * 0.9, q[1] + Math.sin(az) * l * 0.9, q[2] + l * 0.05, wz); g.moveTo(ex, ey); g.lineTo(SX, SY); } };
    g.lineWidth = Math.max(0.35, w0 * 0.35); g.beginPath();
    for (let i = 0; i < (P.burnt || b.dead ? 1 : SC ? 2 : 4); i++) sub(0.3 + i * 0.17, (i % 2 ? 0.7 : -0.7) * (0.6 + hh(b.sd, i)), b.len * (0.35 - i * 0.05));
    g.stroke();
    if (!P.burnt && !b.dead && !SC) {   // берёза: тонкие свисающие веточки (C — нет: крона берёзы — только линии ветвей) (повислая) — тёмная «вуаль» кроны
      g.lineWidth = Math.max(0.3, w0 * 0.16); g.strokeStyle = SC ? SP.ink : 'rgba(58,36,28,0.55)'; g.beginPath();
      for (let i = 0; i < 6; i++) { const t0 = 0.35 + i * 0.11, q = brPt(S, b, wz, t0), l = b.len * (0.22 + 0.2 * hh(b.sd, i + 20)), sd = (hh(b.sd, i + 40) - 0.5) * 0.3;
        GT = t0 * b.len; tf(q[0], q[1], q[2], wz); g.moveTo(SX, SY); tf(q[0] + Math.cos(b.az + sd) * l * 0.25, q[1] + Math.sin(b.az + sd) * l * 0.25, q[2] - l, wz); g.lineTo(SX, SY); }
      g.stroke(); GT = 0;
    } GT = 0;
    if (SNOW > 0.05) { const q0 = brPt(S, b, wz, 0.05), q1 = brPt(S, b, wz, 0.55); ZADD = b.db * KS * 0.6; tf(q0[0], q0[1], q0[2], wz); const x0 = SX, y0 = SY; tf(q1[0], q1[1], q1[2], wz); ZADD = 0;
      const u = rot(q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]); if (Math.abs(u[2]) / (Math.hypot(u[0], u[1], u[2]) || 1) < 0.75) { g.strokeStyle = SC ? SP.paper : '#f3f7fb'; g.lineWidth = w0 * 0.55 * SNOW; g.beginPath(); g.moveTo(x0, y0); g.lineTo(SX, SY); g.stroke(); } }
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
    if (SC) segC(g, S, ax, ay, bx, by, px, py, wa, wb, ne, ao);
    else {
    if (lq) g.fillStyle = tone(P, br(nf) * 0.85);
    else {
      const mx = (ax + bx) / 2, my = (ay + by) / 2, w = (wa + wb) / 2 + 0.01, gr = g.createLinearGradient(mx + px * w, my + py * w, mx - px * w, my - py * w);
      gr.addColorStop(0, tone(P, br(ne) * 0.9)); gr.addColorStop(0.28, tone(P, br(nrm([ne[0] + nf[0], ne[1] + nf[1], ne[2] + nf[2]])))); gr.addColorStop(0.5, tone(P, br(nf)));
      gr.addColorStop(0.75, tone(P, br(nrm([nf[0] - ne[0], nf[1] - ne[1], nf[2] - ne[2]])) * 0.9)); gr.addColorStop(1, tone(P, br([-ne[0], -ne[1], -ne[2]]) * 0.7)); g.fillStyle = gr;
    }
    g.fill();
    }
    if (lq || wa < 0.6) return;
    // кора: трещины (ель, кедр, сухостой) или чечевички (берёза) — только на видимой стороне (C — только берёза: пятна тушью)
    const birch = S.P.bare && !S.P.burnt; g.lineCap = 'round';
    if (SC && !birch) { if (stubs) stubsAt(g, S, za, zb, sc, stubs); return; }
    g.strokeStyle = SC ? SP.ink : birch ? 'rgba(25,22,20,0.85)' : 'rgba(18,12,8,0.7)'; g.lineWidth = Math.max(0.5 * sc, (birch ? 0.03 : 0.011) * M * KS); g.beginPath();
    for (const m of S.marks) {
      if (m.z < za || m.z >= zb) continue; const d = rot(Math.cos(m.ph), Math.sin(m.ph), 0); if (dot(d, VW) < 0.15) continue;
      const r = rz(S, m.z) * 1.01;
      if (birch) { const d2 = m.ph + 0.5 / Math.max(0.3, r * 30); tf(Math.cos(m.ph) * r, Math.sin(m.ph) * r, m.z, m.z); g.moveTo(SX, SY); tf(Math.cos(d2) * r, Math.sin(d2) * r, m.z + 0.01, m.z); g.lineTo(SX, SY); }
      else { tf(Math.cos(m.ph) * r, Math.sin(m.ph) * r, m.z, m.z); g.moveTo(SX, SY); const z1 = Math.min(zb, m.z + m.l); tf(Math.cos(m.ph + 0.05) * rz(S, z1), Math.sin(m.ph + 0.05) * rz(S, z1), z1, z1); g.lineTo(SX, SY); }
    }
    g.stroke();
    if (stubs) stubsAt(g, S, za, zb, sc, stubs);
  }
  // пеньки обрубленных сучьев: светлый срез на коре
  function stubsAt(g, S, za, zb, sc, stubs) {
    for (const w of S.wh) { if (w.z < za || w.z >= zb || !stubs(w)) continue; for (const b of w.br) { const d = rot(Math.cos(b.az), Math.sin(b.az), 0); if (dot(d, VW) < 0) continue; const r = rz(S, w.z) * 1.08; tf(Math.cos(b.az) * r, Math.sin(b.az) * r, w.z, w.z); g.fillStyle = SC ? SP.ink : '#3a2618'; g.beginPath(); g.arc(SX, SY, Math.max(0.5, b.db * KS * M * 0.75) * sc, 0, TAU); g.fill(); g.fillStyle = SC ? SP.ochre : '#c79a62'; g.beginPath(); g.arc(SX, SY, Math.max(0.35, b.db * KS * M * 0.45) * sc, 0, TAU); g.fill(); } }
  }
  // C: ствол — тон тени, освещённая половина (к солнцу) — тон света; кора берёзы — пятна тушью
  function segC(g, S, ax, ay, bx, by, px, py, wa, wb, ne, ao) {
    const M_ = S.P.burnt ? 'burnt' : S.P.bare ? 'birch' : 'bark', lt = Style.MAT[M_], sg = dot(ne, LD) >= 0 ? 1 : -1;
    g.fillStyle = SP[lt[1]]; g.fill();
    if (S.P.bare) { g.strokeStyle = SP.ink; g.lineWidth = Math.max(0.6, Math.min(wa * 0.5, Style.INK * 0.5)); g.stroke(); }   // голое дерево — без контура силуэта: кромка ствола своей линией
    if (ao > 0.55) { g.fillStyle = SP[lt[0]]; g.beginPath(); g.moveTo(ax + px * wa * sg, ay + py * wa * sg); g.lineTo(bx + px * wb * sg, by + py * wb * sg); g.lineTo(bx - px * wb * sg * 0.15, by - py * wb * sg * 0.15); g.lineTo(ax - px * wa * sg * 0.15, ay - py * wa * sg * 0.15); g.closePath(); g.fill(); }
  }
  // торец: плоскость сечения (local XY → мир) — эллипс точной проекции, годовые кольца, кора по краю; snow — снег поверх
  function drawDisc(g, S, z, snow, fresh, lq) {
    tf(0, 0, z, z); const cx = SX, cy = SY, r = rz(S, z) * KS * M, e1 = pj(rot(1, 0, 0)), e2 = pj(rot(0, 1, 0));
    if (r < 0.3) return;
    g.save(); g.transform(e1[0] * r, e1[1] * r, e2[0] * r, e2[1] * r, cx, cy);
    const W = WOOD[S.kind] || WOOD[0];
    if (SC) {   // C: торец — охра (свежий) / дерево, кольцо коры и одно годовое — тушью
      g.fillStyle = SP.ink; g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill();
      g.fillStyle = fresh ? SP.ochre : SP.wood; g.beginPath(); g.arc(0, 0, 0.84, 0, TAU); g.fill();
      if (!lq) { g.strokeStyle = SP.wood; g.lineWidth = 0.07; g.beginPath(); g.arc(0.03, 0.02, 0.45, 0, TAU); g.stroke(); }
      if (snow > 0.25) { g.fillStyle = SP.paper; g.beginPath(); g.ellipse(-0.08, -0.06, 0.8, 0.72, 0.3, 0, TAU); g.fill(); }
      g.restore(); return;
    }
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
  // ---------- рубка стоящего: подруб, задний рез, недоруб (состояние t.cut — js/actions.js) ----------
  // c = { d — куда валится (рад по земле), nq — глубина подруба (доля Ø, ≤ 1/3), bq — заднего реза (доля Ø, с обратной стороны) }
  // подруб: горизонтальное дно на высоте z + наклонная верхняя грань (раскрытие ≈55°) со стороны d; задний рез — щель на BK выше,
  // с обратной стороны; между ними — недоруб (петля), он и ведёт дерево.
  const OPEN = Math.tan(0.96), BK = 0.04;   // tan раскрытия подруба; задний рез выше подруба, м
  function notchGeo(S, c, z) {
    const r = rz(S, z), c0 = r * (1 - 2 * clamp(c.nq || 0, 0, 0.45)), cb = r * (1 - 2 * clamp(c.bq || 0, 0, 0.95));
    return { r, c0, cb, a0: Math.acos(clamp(c0 / r, -1, 1)), ab: Math.acos(clamp(cb / r, -1, 1)) };
  }
  // видимая (передняя к камере) часть дуги поверхности [f0, f1] — n точек
  function frontArc(f0, f1, n) { const out = []; for (let i = 0; i <= n; i++) { const f = f0 + (f1 - f0) * i / n; if (Math.sin(f) > -0.06) out.push(f); } return out; }
  const WOODC = { cut: '#e9c88f', top: '#a8814f', crease: '#3a2414', kerf: '#1d120b', fiber: '#f3dcae' };
  function drawNotch(g, S, c, z) {
    const { r, c0, cb, a0, ab } = notchGeo(S, c, z), d = c.d, n = lowLOD() ? 5 : 10, cs = Math.cos(d), sn = Math.sin(d);
    const P = (f, zz) => tf(Math.cos(f) * r, Math.sin(f) * r, zz, zz), zt = f => z + Math.max(0, r * Math.cos(f - d) - c0) * OPEN;
    const lw = Math.max(0.5, r * KS * M * 0.09);
    if (c.nq > 0.004) {
      const fr = frontArc(d - a0, d + a0, n);
      if (fr.length > 1) {
        // полоса коры, вынутая клином: вырезаем из холста (за ней — то, что видно в выемку: дно, верхняя грань или снег за стволом)
        const strip = () => { g.beginPath(); P(fr[0], z); g.moveTo(SX, SY); for (const f of fr) { P(f, z); g.lineTo(SX, SY); } for (let i = fr.length - 1; i >= 0; i--) { P(fr[i], zt(fr[i]) + 0.002); g.lineTo(SX, SY); } g.closePath(); };
        g.save(); strip(); g.globalCompositeOperation = 'destination-out'; g.fill(); g.globalCompositeOperation = 'source-over'; g.clip();
        // дно (горизонтальный рез) — свежая древесина: сегмент круга за хордой
        const seg = (zf) => { g.beginPath(); tf(cs * c0 - sn * r * Math.sin(a0), sn * c0 + cs * r * Math.sin(a0), z, z); g.moveTo(SX, SY); for (let i = 0; i <= n; i++) { const f = d + a0 - 2 * a0 * i / n; P(f, zf(f)); g.lineTo(SX, SY); } g.closePath(); };
        seg(() => z); g.fillStyle = SC ? SP.ochre : WOODC.cut; g.fill();
        // верхняя грань смотрит вниз-наружу: видна, только если подруб к камере
        const nz = 1 / Math.hypot(OPEN, 1), vis = (sn * OPEN * 0.8 - 0.6) * nz;
        if (vis > -0.25) { seg(zt); g.fillStyle = SC ? SP.ink : WOODC.top; g.globalAlpha *= clamp(0.55 + vis, 0.3, 1); g.fill(); g.globalAlpha = 1; }
        // вершина клина (хорда) — тёмная складка; за ней недоруб: волокна тянутся, когда задний рез близко
        g.strokeStyle = SC ? SP.ink : WOODC.crease; g.lineWidth = lw; g.beginPath();
        tf(cs * c0 - sn * r * Math.sin(a0), sn * c0 + cs * r * Math.sin(a0), z, z); g.moveTo(SX, SY); tf(cs * c0 + sn * r * Math.sin(a0), sn * c0 - cs * r * Math.sin(a0), z, z); g.lineTo(SX, SY); g.stroke();
        g.restore();
      }
    }
    // задний рез: щель на BK выше подруба с обратной стороны (видна её передняя часть)
    if (c.bq > 0.004) {
      const zb = z + BK / KS, fb = frontArc(d + Math.PI - ab, d + Math.PI + ab, n);
      if (fb.length > 1) {
        g.strokeStyle = SC ? SP.ink : WOODC.kerf; g.lineWidth = lw * 1.1; g.lineCap = 'round'; g.beginPath(); P(fb[0], zb); g.moveTo(SX, SY); for (const f of fb) { P(f, zb); g.lineTo(SX, SY); } g.stroke();
        if (!SC) { g.strokeStyle = 'rgba(243,220,174,0.85)'; g.lineWidth = lw * 0.5; g.beginPath(); P(fb[0], zb - 0.006 / KS); g.moveTo(SX, SY); for (const f of fb) { P(f, zb - 0.006 / KS); g.lineTo(SX, SY); } g.stroke(); }
      }
    }
    void cb;
  }
  // пень после валки: уступ (подруб ниже, задний рез выше), «борода» недоруба — рваные волокна, у «кресла» — расколотая плаха
  function drawStumpTop(g, S, c, z, snow, seed) {
    const { r, c0, cb } = notchGeo(S, c, z), d = c.d, n = lowLOD() ? 6 : 12, zb = z + BK / KS, cs = Math.cos(d), sn = Math.sin(d);
    const at = (s, v, zz) => tf(cs * s - sn * v, sn * s + cs * v, zz, zz);   // s — вдоль d, v — поперёк
    const sw = Math.sqrt(Math.max(0, r * r - cb * cb));
    // задняя площадка (выше на BK): бок коры и торец-сегмент
    if (c.bq > 0.02) {
      const fb = frontArc(d + Math.PI - Math.acos(clamp(cb / r, -1, 1)), d + Math.PI + Math.acos(clamp(cb / r, -1, 1)), n);
      if (fb.length > 1) { g.beginPath(); tf(Math.cos(fb[0]) * r, Math.sin(fb[0]) * r, z, z); g.moveTo(SX, SY); for (const f of fb) { tf(Math.cos(f) * r, Math.sin(f) * r, zb, zb); g.lineTo(SX, SY); } for (let i = fb.length - 1; i >= 0; i--) { tf(Math.cos(fb[i]) * r, Math.sin(fb[i]) * r, z, z); g.lineTo(SX, SY); } g.closePath(); g.fillStyle = SC ? SP.ink : tone(S.P.bark, 0.3); g.fill(); }
      g.beginPath(); at(-cb, sw, zb); g.moveTo(SX, SY); for (let i = 0; i <= n; i++) { const f = d + Math.PI - Math.acos(clamp(cb / r, -1, 1)) + 2 * Math.acos(clamp(cb / r, -1, 1)) * i / n; tf(Math.cos(f) * r, Math.sin(f) * r, zb, zb); g.lineTo(SX, SY); } g.closePath();
      g.fillStyle = SC ? SP.ochre : '#d9b47c'; g.fill();
    }
    // «борода» недоруба: волокна вырваны и отогнуты в сторону падения
    const hs = Math.max(0.01, c0 + cb), R_ = rng(seed | 0), nf = lowLOD() ? 4 : 9;
    g.strokeStyle = SC ? SP.paper : WOODC.fiber; g.lineCap = 'round'; g.lineWidth = Math.max(0.5, r * KS * M * 0.07);
    g.beginPath();
    for (let i = 0; i < nf; i++) {
      const v = (R_() * 2 - 1) * Math.sqrt(Math.max(0, r * r - c0 * c0)) * 0.9, s0 = c0 - R_() * hs, h = (0.015 + 0.035 * R_()) / KS;
      at(s0, v, z + 0.002); g.moveTo(SX, SY); at(s0 + h * 0.8, v + (R_() - 0.5) * h * 0.4, z + h); g.lineTo(SX, SY);
    }
    g.stroke();
    // «барберское кресло»: плаха откололась вдоль и торчит с обратной стороны
    if (c.bc) {
      const hh2 = 0.55 / KS, w2 = r * 0.7;
      g.beginPath(); at(-r * 0.95, -w2, zb); g.moveTo(SX, SY); at(-r * 0.95, -w2 * 0.6, zb + hh2); g.lineTo(SX, SY); at(-r * 0.7, 0, zb + hh2 * 1.12); g.lineTo(SX, SY); at(-r * 0.95, w2 * 0.5, zb + hh2 * 0.9); g.lineTo(SX, SY); at(-r * 0.95, w2, zb); g.lineTo(SX, SY); g.closePath();
      g.fillStyle = SC ? SP.ochre : '#cfa56b'; g.fill(); g.strokeStyle = SC ? SP.ink : tone(S.P.bark, 0.25); g.lineWidth = Math.max(0.5, r * KS * M * 0.1); g.stroke();
    }
    // снег ложится поверх
    if (snow > 0.05) { tf(0, 0, zb, zb); const rr = r * KS * M; g.globalAlpha *= Math.min(1, snow * 1.3); g.fillStyle = SC ? SP.paper : '#f2f6fa'; g.beginPath(); g.ellipse(SX, SY - rr * 0.1, rr * 0.95, rr * 0.5, 0, 0, TAU); g.fill(); g.globalAlpha = 1; }
  }
  // щепа на снегу у ствола: летит из зарубки конусом по ходу удара и остаётся лежать (заметает за полсуток)
  function drawChips(g, t, c) {
    if (!c || !(c.h > 0)) return;
    const age = (typeof G !== 'undefined' ? G.time : 0) - (c.t || 0), cover = clamp(age / (CYCLE * 0.5), 0, 1); if (cover >= 1) return;
    const { k } = of(t), n = Math.min(lowLOD() ? 14 : 36, c.h * 3), R_ = rng(Math.imul(t.x | 0, 7919) ^ (t.y | 0) * 104729), a0 = g.globalAlpha;
    const nN = c.nN || Math.round((c.N || 12) * 0.6);
    for (let i = 0; i < n; i++) {
      const back = i % 3 === 2 && c.h > nN, dir = (back ? c.d + Math.PI : c.d) + (R_() - 0.5) * 1.2, dd = (0.25 + 1.1 * R_() * R_()) * Math.min(1.3, 0.8 + k * 0.3);
      const x = t.x + Math.cos(dir) * dd * M, y = t.y + Math.sin(dir) * dd * M * 0.6 + 1, s = (0.04 + 0.06 * R_()) * M, rot = R_() * 3;
      g.globalAlpha = a0 * (1 - sm(0.2 + 0.6 * R_(), 1, cover)); if (g.globalAlpha <= 0.01) continue;
      g.fillStyle = SC ? SP.ochre : i % 4 ? '#e3c590' : '#bf9560'; g.save(); g.translate(x, y); g.rotate(rot); g.fillRect(-s / 2, -s * 0.18, s, s * 0.36); g.restore();
    }
    g.globalAlpha = a0;
  }
  const lowLOD = () => low();
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
    if (o.notch && (o.notch.nq > 0 || o.notch.bq > 0)) el(ND + 0.002, 3, o.notch, HC / KS);   // подруб/задний рез — поверх своего куска ствола
    // вершина: снежный комок на верхушке (стоит)
    const sub = EL.slice(0, ELN).sort((a, b) => a.d - b.d);
    for (const e of sub) {
      switch (e.ty) {
        case 0: drawSeg(g, S, e.a, e.b, lq, sc, o.stubs); break;
        case 1: if (S.P.bare || e.a.dead) drawBare(g, S, e.a, e.b.z, lq, sc); else drawBough(g, S, lq ? scaleW(e.a) : e.a, e.b.z, lq, sc); break;
        case 2: drawDisc(g, S, e.a[0], o.dsnow || 0, e.a[2], lq); break;
        case 3: drawNotch(g, S, e.a, e.b); break;
      }
    }
    if (z1 >= S.H - 0.01 && !S.P.bare && SNOW > 0.2) { tf(0, 0, S.H - 0.04, S.H); const up = rot(0, 0, 1)[2]; if (up > 0.6) { g.fillStyle = SC ? SP.paper : '#f3f7fb'; g.beginPath(); g.ellipse(SX, SY + 0.02 * M * KS, 0.06 * M * KS, 0.05 * M * KS, 0, 0, TAU); g.fill(); } }
  }
  // слабый пресет: половина ветвей, оставшиеся шире — силуэт кроны тот же
  const WIDE = new WeakMap(); const scaleW = b => { let c = WIDE.get(b); if (!c) { c = Object.assign({}, b, { fw: b.fw * 1.45 }); WIDE.set(b, c); } return c; };

  // ================= ГОТОВЫЕ СЦЕНЫ =================
  const W_ = () => (typeof ArtWorld !== 'undefined' ? ArtWorld : null);
  // спрайт стоящего (класс; опора 0,0 — комель на снегу): тень, воронка у ствола, модель в покое со снегом
  function paintSprite(g, kind, si, v) {
    const S = spec(kind, si, v), s = TS[si], A = W_();
    if (SC) {   // C: в спрайте только дерево с контуром; тень — по одному правилу в GFX (shadowsC)
      pose(S, 1, { snow: 1 }); const sc = g.getTransform().a;
      Style.inked(g, c => render(c, S, { sc: 1 / Math.max(0.5, sc), lq: low() }), S.P.bare ? 0 : Style.inkFor(sc, false)); return;
    }
    if (A) { A.shadow(g, 0, 0, (kind === 2 ? 24 : kind === 1 || kind === 3 ? 14 : 19) * s, 5.5 * s, 0.4); A.trunkWell(g, s, v, kind === 2 ? 1.3 : kind === 3 ? 0.9 : 1, kind === 2 ? 6311 : kind === 3 ? 7129 : 4401); }
    pose(S, 1, { snow: 1 }); render(g, S, { sc: 1 / Math.max(0.5, g.getTransform().a), lq: low() });   // sc — 1 px устройства в px спрайта
  }
  // воронка у ствола (для живого рисунка: то же, что в спрайте)
  function wellSprite(kind, si, v) {
    const A = W_(), s = TS[si]; if (!A) return null;
    return A.sprite('twell' + kind + si + v, 90, 30, g => { g.translate(45, 18); A.shadow(g, 0, 0, (kind === 2 ? 24 : kind === 1 || kind === 3 ? 14 : 19) * s, 5.5 * s, 0.4); A.trunkWell(g, s, v, kind === 2 ? 1.3 : kind === 3 ? 0.9 : 1, kind === 2 ? 6311 : kind === 3 ? 7129 : 4401); });
  }
  // снег на ветвях стоящего: стряхнули — меньше, нарастает за ~2 мин (память рендера)
  // рубится (t.cut) — снег в состоянии дерева (сейв): sn на момент st (G.time), нарастает так же
  const SN = new WeakMap(), SNOW_T = 120;
  const clk = () => (typeof now === 'number' ? now : 0), gt = () => (typeof G !== 'undefined' && G ? G.time : 0);
  const snowOf = t => {
    if (t.cut && t.cut.st != null) return Math.min(1, t.cut.sn + (gt() - t.cut.st) / SNOW_T);
    const e = SN.get(t); if (!e) return 1; const v = Math.min(1, e.v + (clk() - e.t) / SNOW_T); if (v >= 1) { SN.delete(t); return 1; } return v;
  };
  // стряхнуть: доля снега k от того, что ещё лежит (первый удар — много, дальше по остатку); вернёт, сколько упало (0..1)
  function shook(t, p, k) {
    const v = snowOf(t), dv = k != null ? v * k : Math.min(v, 0.3 * (p || 1)), v1 = Math.max(0, v - dv);
    if (t.cut) { t.cut.sn = +v1.toFixed(3); t.cut.st = +gt().toFixed(2); } else SN.set(t, { v: v1, t: clk() });
    return dv;
  }
  // живой: движется, рубится (подруб/задний рез) или стряхнут снег
  const live = (t, notch) => t.shake > 0 || (notch && (notch.nq > 0 || notch.bq > 0)) || SN.has(t) || (t.cut && snowOf(t) < 1);
  // стоящее дерево живьём: bend — изгиб вершины (px), notch — t.cut. Дрожь от удара — затухает (World.shakeTree):
  // ствол ходит на своей частоте (~2 Гц), ветви мельче и быстрее. Не движется — картинка не перерисовывается (ключ состояния)
  function drawStanding(g, t, o) {
    const { S, k } = of(t), wl = SC ? null : wellSprite(S.kind, S.si, S.v), dpr = g.getTransform().a;
    if (wl) { const s = wl._s || 1; g.drawImage(wl, t.x - 45 * k, t.y - 18 * k, 90 * k, 30 * k); void s; }
    if (o.notch) drawChips(g, t, o.notch);
    const sh = t.shake > 0.004 ? t.shake : 0, tt = clk(), bend = Math.abs(o.bend || 0) < 0.6 ? 0 : o.bend;
    const bx = (bend || 0) / M / k + (sh ? Math.sin(tt * 13.5) * sh * 0.42 + Math.sin(tt * 29) * sh * 0.06 : 0);
    const R0 = crownPx(S, k) + 26, Hp = S.H * k * M + 26, sn = snowOf(t), c = o.notch;
    const ver = sh || bend ? (sh > 0 ? 2 : 1) : 'v' + (c ? [c.h, c.nq, c.bq].join(',') : '') + '|' + sn.toFixed(2) + '|' + low();
    viaCanvas(g, t, t.x - R0, t.y - Hp, R0 * 2, Hp + R0 * 0.75 + 8, ver, (cv, s) => {
      pose(S, k, { ox: t.x, oy: t.y, bend: [bx, sh ? Math.cos(tt * 11) * sh * 0.12 : 0], vib: sh * 0.22, t: tt, snow: sn });
      render(cv, S, { notch: c, sc: 1 / s, lq: low() });
      if (SC && !S.P.bare) Style.outlineCanvas(cv.canvas, Style.inkFor(s, true));
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
    const { S, k } = of(t), wl = SC ? null : wellSprite(S.kind, S.si, S.v), dpr = g.getTransform().a;
    if (wl) g.drawImage(wl, t.x - 45 * k, t.y - 18 * k, 90 * k, 30 * k);
    const c = t.cut && t.cut.d != null && (t.cut.nq > 0 || t.cut.bq > 0) ? t.cut : null;
    if (c) drawChips(g, t, c);
    pose(S, k, { ox: t.x, oy: t.y, snow: 1 }); const hz = HC / k;
    // срез: свежий — подруб и задний рез уступом, недоруб — рваной бородой (рубили по-настоящему); иначе — ровный торец
    const paint = gg => { render(gg, S, { z0: 0, z1: hz, has: () => false, discs: [[hz, 1, snow < 0.5]], dsnow: c ? snow * 0.6 : snow, sc: 1 / Math.max(0.5, dpr), lq: low() }); if (c) { pose(S, k, { ox: t.x, oy: t.y, snow: 1 }); drawStumpTop(gg, S, c, hz, snow, (t.x * 31 + t.y) | 0); } };
    if (SC) { const r = rz(S, 0) * k * M + 3, ht = hz * k * M + (c && c.bc ? 0.6 * M : 0); Style.cast(g, t.x, t.y, ht, r * 2.2); Style.figure(g, t.x - r - 2, t.y - ht - r - 2, r * 2 + 4, ht + r * 2 + 4, paint, { snap: false, cache: t, every: 1e9, ver: Math.round(snow * 10) + (c ? 'c' : '') }); } else paint(g);
    if (snow < 0.5 && !c) { tf(0, 0, hz, hz); const r = rz(S, hz) * k * M; g.strokeStyle = SC ? SP.ochre : '#efd8a8'; g.lineWidth = Math.max(0.5, r * 0.15); g.beginPath(); g.moveTo(SX - r * 0.7, SY - r * 0.1); g.lineTo(SX - r * 0.2, SY - r * 0.5); g.moveTo(SX + r * 0.1, SY - r * 0.05); g.lineTo(SX + r * 0.4, SY - r * 0.55); g.stroke(); }   // недопил — щепа торчит
  }
  // ---------- ствол на земле / в падении ----------
  // o: {x, y, a, kind, s, v | sk, k, hc, zTop, top, cut, ...}, P — поза валки (GFX.fallPose): th, lag (px), roll, ph
  // P.bz — комель подпрыгнул (м): ствол лежит на кроне, поднята только комлевая часть; o.pc — ось на кромке недоруба (м, в падении);
  // o.roll — перекат ствола (сейв); ветви — по одной (o.lm, js/tree3d.js lmOf)
  function logOpts(S, k, o, P) {
    const lie = Math.pow(Math.sin(P.th), 2), hc = o.hc != null ? o.hc : HC / k, rb = rz(S, hc);
    const lw = o.zt != null ? limbW(S, o) : [], lm = o.zt != null ? lmOf(S, o) : null, wi = new Map(lw.map((w, i) => [w, i]));
    const cutB = (w, b) => { const i = wi.get(w); return i != null && lm && isCut(o, i, w.br.indexOf(b)); };
    const anyCut = w => { const i = wi.get(w); return i != null && lm && lm[i] > 0; }, allCut = w => { const i = wi.get(w); return i != null && lm && lm[i] === (1 << w.br.length) - 1; };
    const zTop = o.zTop != null ? o.zTop : S.H, lowest = S.wh.find(w => !allCut(w) && w.z > hc && w.z <= zTop);
    const bz = P.bz || 0, Lr = Math.max(1, (zTop - hc) * k), pc = (o.pc || 0) * (1 - lie * lie) / k;
    const pw = lerp(hc, rb, lie * lie) + bz / k;
    return {
      po: { gs: 0.5 * lie * lie, flat: 0.85 * lie * lie, th: P.th + (bz ? Math.atan(bz / Lr) : 0), a: o.a, roll: (P.roll || 0) + (o.roll || 0), lag: (P.lag || 0) / M / k, pz: hc, pw, px: Math.cos(o.a) * pc, py: Math.sin(o.a) * pc,
        ox: o.x, oy: o.y, grd: P.th > 0.3, lift: lowest ? 0.3 * lie : 0, lz0: lowest ? lowest.z : 0, sink: o.sink, snow: o.snowN != null ? o.snowN : 1 },
      ro: { aok: 0.35, aoz: lowest ? lowest.z : 1e9, z0: hc, z1: zTop, has: (w, b) => w.z <= zTop && !(b && cutB(w, b)), stubs: anyCut, discs: [[hc, -1, 1]].concat(zTop < S.H - 0.01 ? [[zTop, 1, 1]] : []), dsnow: o.dsnow || 0 },
    };
  }
  // кэш лежачих: та же картинка, пока состояние не изменилось (ключ), иначе — перепечь
  const LC = new WeakMap(); let lcBudget = 2;
  function drawLog(g, o, P) {
    const { S, k } = of(o), X = logOpts(S, k, o, P), dpr = g.getTransform().a;
    const still = P.ph === 3 && !low() ? 1 : P.ph === 3 ? 1 : 0;
    if (still) {
      const key = [o.cut || 0, o.lm ? o.lm.join('.') : '', (o.roll || 0).toFixed(3), o.zTop, o.snowN && o.snowN.toFixed(1), o.dsnow && o.dsnow.toFixed(1), dpr.toFixed(2), o.sink ? o.sink.join(',') : ''].join('|');
      let c = LC.get(o);
      if (!c || c.key !== key) { if (lcBudget > 0 || !c) { lcBudget--; c = bakeLog(S, k, o, X, dpr, key); if (c) LC.set(o, c); } }
      if (c) { g.drawImage(c.cv, o.x + c.x0, o.y + c.y0, c.w, c.h); return; }
    }
    const Rt = S.H * k * M + crownPx(S, k) + 20;
    viaCanvas(g, o, o.x - Rt, o.y - Rt, Rt * 2, Rt * 1.75, 1, (c, s) => {
      if (SC) { pose(S, k, X.po); render(c, S, Object.assign({ sc: 1 / s }, X.ro)); Style.outlineCanvas(c.canvas, Style.inkFor(s, true)); c.globalCompositeOperation = 'destination-over'; shadowLog(c, S, k, o, X, P); c.globalCompositeOperation = 'source-over'; sinkFx(c, S, k, o, X); return; }
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
    if (SC) { pose(S, k, Object.assign({}, X.po, { ox: 0, oy: 0 })); render(g, S, Object.assign({ sc: 1 / dpr }, X.ro)); Style.outlineCanvas(cv, Style.inkFor(dpr, true)); g.globalCompositeOperation = 'destination-over'; shadowLog(g, S, k, oo, X, LIE_P); g.globalCompositeOperation = 'source-over'; sinkFx(g, S, k, oo, X); return { cv, key, x0, y0, w: x1 - x0, h: y1 - y0 }; }
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
      if (SC) { g.globalAlpha = a0 * (lie > 0.6 ? 1 : 0); g.fillStyle = SP.shade; g.beginPath(); g.ellipse(cx + Style.SHV.x * 8, cy + Style.SHV.y * 8 + 2, rc * 0.9, rc * 0.38, 0, 0, TAU); g.fill(); continue; }   // C: сплошной тон тени, сдвиг по солнцу
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
  const settleT = p => 0.4 + 0.3 * hh((p.id || 0) | 0, 5);   // ветвь оседает 0.4–0.7 с
  function drawPart(g, p, time) {
    const busy = p.kind === 'bough' || p.kind === 'branch' ? settleT(p) + 0.05 : 0.6;
    if (!p.sk || time - p.t - (p.dl || 0) < busy || p.rk) return drawPart0(g, p, time);   // rk — сгребают: движется, живьём
    const ver = Math.round(snowAge(p, time) * 10) + '|' + Math.round(clamp((time - p.t) / (CYCLE * 0.75), 0, 1) * 20) + '|' + low() + (p.kind === 'pile' ? '|' + p.n : ''), r = (p.kind === 'pile' ? 1.3 : p.len) * M * 0.75 + 12;
    viaCanvas(g, p, p.x - r, p.y - r * 0.85, r * 2, r * 1.6, ver, c => drawPart0(c, p, time), 3);
  }
  function drawPart0(g, p, time) {
    const dpr = g.getTransform().a, sc = 1 / Math.max(0.5, dpr);
    if (p.kind === 'bough' || p.kind === 'branch') return drawBoughPart(g, p, time, sc);
    if (p.kind === 'pile') return drawPile(g, p, time, sc);
    if (!p.sk) { const A = W_(); if (A) A.chunk(g, p.x, p.y, p.a || 0); return; }   // старый сейв: чурка без формы
    const { S } = of(p), k = p.k, len = (p.z1 - p.z0) * k, e = p.fx != null ? clamp((time - p.t) / 0.45, 0, 1) : 1, ke = 1 - (1 - e) * (1 - e);
    const cx = p.fx != null ? lerp(p.fx, p.x, ke) : p.x, cy = p.fx != null ? lerp(p.fy, p.y, ke) - 4 * Math.sin(Math.PI * Math.min(1, e * 1.6)) * (1 - e) : p.y;
    const a = p.ang, ca = Math.cos(a), sa = Math.sin(a), h = len / 2 * M, ox = cx - ca * h, oy = cy - sa * h * 0.6;
    const rr = (rz(S, p.z0) + rz(S, p.z1)) / 2, roll = (p.id || 0) * 1.7 + (1 - ke) * 6;
    const A = W_();
    if (SC) { g.fillStyle = SP.shade; g.beginPath(); g.ellipse(cx + Style.SHV.x * 4, cy + 1.5 + Style.SHV.y * 4, Math.max(4, len * M * 0.55), Math.max(2, rr * k * M * 1.3), a * 0.6, 0, TAU); g.fill(); }   // C: тень сплошным тоном
    else if (A) A.shadow(g, cx + 1, cy + 1.5, Math.max(4, len * M * 0.55), Math.max(2, rr * k * M * 1.6), 0.3);
    const R_ = len * M * 0.6 + rr * k * M * 2 + (p.kind === 'top' ? S.H * k * M * 0.5 : 0) + 6, box = (gg, fn) => (SC ? Style.figure(gg, cx - R_, cy - R_, R_ * 2, R_ * 2, fn, { snap: false }) : fn(gg));
    if (p.kind === 'top') {
      pose(S, k, { th: Math.PI / 2, a, roll, pz: p.z0, pw: rr, ox, oy, grd: 1, lift: 0.12, lz0: p.z0, gs: 0.4, flat: 0.85, snow: snowAge(p, time) });
      return box(g, gg => render(gg, S, { z0: p.z0, z1: S.H, discs: [[p.z0, -1, 1]], sc }));
    }
    pose(S, k, { th: Math.PI / 2, a, roll, pz: p.z0, pw: rr, ox, oy });
    const sn = snowAge(p, time);
    box(g, gg => render(gg, S, { aok: 0, z0: p.z0, z1: p.z1, has: () => false, stubs: () => true, discs: [[p.z0, -1, 1], [p.z1, 1, 1]], dsnow: sn * 0.6, sc }));
    if (sn > 0.05) { g.globalAlpha *= Math.min(1, sn * 1.5); g.fillStyle = SC ? SP.paper : '#f3f7fb'; tf(0, 0, p.z0 + 0.02, p.z0); const x0 = SX, y0 = SY; tf(0, 0, p.z1 - 0.02, p.z1); g.lineCap = 'round'; g.strokeStyle = '#f3f7fb'; g.lineWidth = Math.max(0.8, rr * k * M * 0.9); g.beginPath(); g.moveTo(x0, y0 - rr * k * M * 0.75); g.lineTo(SX, SY - rr * k * M * 0.75); g.stroke(); g.globalAlpha = 1; }
  }
  const snowAge = (p, time) => clamp((time - p.t) / (CYCLE * 0.6), 0, 0.85);
  // ---------- лапник на снегу: своя форма «лежит» (считается один раз — boughRest, хранится в части: az, ss, tl) ----------
  // ось — 5 точек (az, см над снегом): основание у снега, середина приподнята боковыми побегами, кончик в снегу;
  // боковые побеги «домиком»: от оси вверх-вбок 20–40° и дугой к снегу; нижние (занавес) уходят в снег — срез линией снега;
  // снег сверху — с одной стороны (ss). Лёгкий пресет — меньше побегов, без «ёлочки».
  const zAx = (az, u) => { const x = clamp(u, 0, 1) * 4, i = Math.min(3, x | 0), f = x - i; return (az[i] + (az[i + 1] - az[i]) * f) / 100; };
  const defAz = p => { const h = hh((p.id || 1) | 0, 11), m = 10 + 14 * h; return [3, Math.round(m * 0.7), Math.round(m), Math.round(m * 0.5), -3]; };
  const SH_ = [];
  // o: { bx, by — основание (px мира), ang — куда (рад по земле), len (м), az (см), ss, tl, snow, el — подъём оси (оседает), ke — доля формы «лежит», bz — основание над снегом (м) }
  function drawLying(g, S, b, o, sc, lq) {
    const P = S.P, e = [Math.cos(o.ang), Math.sin(o.ang)], n = [-e[1], e[0]], L = o.len, ce = Math.cos(o.el || 0), se = Math.sin(o.el || 0), ke = o.ke == null ? 1 : o.ke;
    const axZ = u => (o.bz || 0) * (1 - u * 0.6) + u * L * se + zAx(o.az, u) * ke, cv = (o.tl || 0) * 0.12 * L;
    const AX = u => { const sl = Math.sin(Math.PI * u) * cv; return [e[0] * u * L * ce + n[0] * sl, e[1] * u * L * ce + n[1] * sl, axZ(u)]; };
    const PX = (x, y, z) => { SX = o.bx + x * M; SY = o.by + (0.6 * y - z) * M; };
    const np = lq ? 4 : 7, fw = (P.fw || 0.36) * 1.15, sn = o.snow || 0, sd0 = (b.sd || 1) | 0;
    SH_.length = 0;
    for (let j = 0; j < np; j++) {
      const u = 0.1 + j / (np - 1) * 0.82, rt = AX(u), env = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.08)), 0.65) * (1 - 0.35 * u), ls = L * fw * env + 0.02;
      for (const s of [1, -1]) {
        const be = 1.12 + (hh(sd0, j * 2 + (s > 0 ? 1 : 0)) - 0.5) * 0.35, ga = 0.35 + 0.35 * hh(sd0, j * 2 + 40 + (s > 0 ? 1 : 0)), hd = [e[0] * Math.cos(be) + n[0] * s * Math.sin(be), e[1] * Math.cos(be) + n[1] * s * Math.sin(be)];
        SH_.push({ u, s, rt, ls: ls * (j % 2 ? 0.85 : 1), hd, up: !(j % 2), tg: Math.tan(ga) * ke + (1 - ke) * 0.1, d: 0.8 * (rt[1] + hd[1] * ls * 0.5) + 0.6 * rt[2], lit: 0.5 + 0.5 * (-0.35 * s * (n[0] * LD[0] + n[1] * LD[1]) + 0.94 * LD[2]) });
      }
    }
    const col = (k2, alt) => (SC ? (alt ? SP.ink : SP.pine) : tone(P.ndl, k2));
    // занавес — нижние веточки уходят в снег: тёмное под побегами (видно, что ветвь объёмная, а не плёнка)
    if (!lq) {
      g.fillStyle = col(0.06, 1); g.beginPath();
      for (const q of SH_) { if (q.rt[2] < 0.02) continue; const r = q.rt, z0 = r[2];
        PX(r[0], r[1], z0 * 0.85); g.moveTo(SX, SY); PX(r[0] + q.hd[0] * q.ls * 0.42, r[1] + q.hd[1] * q.ls * 0.42, 0); g.lineTo(SX, SY); PX(r[0] + q.hd[0] * q.ls * 0.12 - q.hd[1] * q.s * 0.03, r[1] + q.hd[1] * q.ls * 0.12 + q.hd[0] * q.s * 0.03, 0); g.lineTo(SX, SY); g.closePath(); }
      g.fill();
    }
    // ось (побег-стебель) — один элемент с глубиной своей середины
    const am = AX(0.5); SH_.push({ ax: 1, d: 0.8 * am[1] + 0.6 * am[2] - 0.001 });
    SH_.sort((a, q) => a.d - q.d);
    const NS = lq ? 4 : 6, lw = Math.max(0.35 * sc, 0.012 * M);
    for (const q of SH_) {
      if (q.ax) {   // стебель: коричневый, тонкий, к кончику тоньше
        g.strokeStyle = SC ? SP.ink : '#4a3122'; g.lineCap = 'round';
        let px = 0, py = 0; for (let i = 0; i <= 4; i++) { const a = AX(i / 4); PX(a[0], a[1], Math.max(0, a[2])); if (i) { g.lineWidth = Math.max(0.4 * sc, (b.db || 0.02) * M * (1 - i / 5)); g.beginPath(); g.moveTo(px, py); g.lineTo(SX, SY); g.stroke(); } px = SX; py = SY; }
        continue;
      }
      const r = q.rt; if (r[2] < -0.01) continue;
      // центральная линия побега: подъём γ у оси, дальше дугой к снегу; уходит под снег — режем по линии снега
      // верхний ярус — вверх-вбок и лежит на нижних (кончик над снегом), нижний — дугой в снег (срез линией снега)
      const zE = q.up ? Math.max(0.03, r[2] * 0.35) : -0.03, zt = t => r[2] + (zE - r[2]) * Math.pow(t, q.up ? 1.5 : 1.7) + q.ls * q.tg * t * (1 - t) * (q.up ? 0.9 : 0.6);
      let tEnd = 1; for (let i = 1; i <= 8; i++) { const t = i / 8; if (zt(t) < 0) { const t0 = (i - 1) / 8, z0 = zt(t0), z1 = zt(t); tEnd = t0 + (t - t0) * z0 / ((z0 - z1) || 1); break; } }
      if (tEnd < 0.12) continue;
      const pp = [-q.hd[1], q.hd[0]], wd = t => (0.035 + 0.08 * q.ls) * (1 - 0.6 * t) * (t < 0.08 ? 0.5 + t / 0.16 : 1), pt = (t, sgn) => { const w = wd(t) * sgn; PX(r[0] + q.hd[0] * q.ls * t + pp[0] * w, r[1] + q.hd[1] * q.ls * t + pp[1] * w, Math.max(0, zt(t) + Math.abs(w) * 0.25)); };
      const NZ = NS * 2, zz = i => (i % 2 && i < NZ ? 1 : 0.55);   // край побега зубцами (пучки хвои), не гладкий лист
      g.beginPath(); for (let i = 0; i <= NZ; i++) { const t = tEnd * i / NZ; pt(t, zz(i)); if (i) g.lineTo(SX, SY); else g.moveTo(SX, SY); }
      for (let i = NZ; i >= 0; i--) { pt(tEnd * i / NZ, -zz(i + 1)); g.lineTo(SX, SY); }
      g.closePath(); g.fillStyle = col(q.up ? 0.16 + 0.55 * q.lit * q.lit : 0.08 + 0.3 * q.lit * q.lit, !q.up || q.lit < 0.5); g.fill();
      if (!lq && !SC) {   // «ёлочка»: тёмная жилка и светлые кончики хвоинок
        g.strokeStyle = tone(P.ndl, 0.05 + 0.1 * q.lit); g.lineWidth = lw; g.beginPath(); pt(0, 0); g.moveTo(SX, SY); pt(tEnd * 0.9, 0); g.lineTo(SX, SY);
        for (let i = 1; i < 4; i++) { const t = tEnd * i / 4; pt(t, 0); const x0 = SX, y0 = SY; pt(t + 0.08, 1); g.moveTo(x0, y0); g.lineTo(SX, SY); pt(t, 0); pt(t + 0.08, -1); g.moveTo(x0, y0); g.lineTo(SX, SY); }
        g.stroke();
      }
      // уходит в снег — белая губа снега у места входа
      if (tEnd < 0.98 && !lq) { pt(tEnd, 0); g.fillStyle = SC ? SP.paper : '#eef3f8'; g.beginPath(); g.ellipse(SX, SY + 0.3, Math.max(0.6, wd(tEnd) * M * 1.4), Math.max(0.4, wd(tEnd) * M * 0.6), o.ang * 0.6, 0, TAU); g.fill(); }
    }
    // снег сверху — с одной стороны оси (куда мело), комьями
    if (sn > 0.04) {
      g.globalAlpha *= Math.min(1, sn * 1.6); g.fillStyle = SC ? SP.paper : '#f3f7fb';
      for (let i = 0; i < (lq ? 3 : 6); i++) { const u = 0.12 + i * (lq ? 0.25 : 0.13), a = AX(u), r0 = (0.03 + 0.04 * hh(sd0, i + 70)) * (0.6 + 0.6 * sn) * (1 - 0.4 * u);
        PX(a[0] + n[0] * o.ss * 0.035, a[1] + n[1] * o.ss * 0.035, Math.max(0, a[2]) + 0.025); g.beginPath(); g.ellipse(SX, SY, r0 * M * 1.3, r0 * M * 0.7, o.ang * 0.6, 0, TAU); g.fill(); }
      g.globalAlpha = 1;
    }
  }
  // форма лежащей ветви числами (проверки): середина оси и кончик (см), доля точек побегов над снегом
  function boughShape(p) {
    const { S } = of(p), w = S.wh[p.w], b = w && w.br.find(q => q.j === p.b); if (!b) return null;
    const az = p.az || defAz(p), L = b.len * p.k, fw = (S.P.fw || 0.36) * 1.15, sd0 = (b.sd || 1) | 0; let up = 0, n = 0;
    for (let j = 0; j < 7; j++) {
      const u = 0.1 + j / 6 * 0.82, z0 = zAx(az, u), ls = L * fw * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.08)), 0.65) * (1 - 0.35 * u) + 0.02;
      for (const s of [1, -1]) { const tg = Math.tan(0.35 + 0.35 * hh(sd0, j * 2 + 40 + (s > 0 ? 1 : 0))), U = !(j % 2), l2 = ls * (U ? 1 : 0.85), zE = U ? Math.max(0.03, z0 * 0.35) : -0.03;
        for (let i = 0; i <= 8; i++) { const t = i / 8, z = z0 + (zE - z0) * Math.pow(t, U ? 1.5 : 1.7) + l2 * tg * t * (1 - t) * (U ? 0.9 : 0.6); n++; if (z > 0.005) up++; } }
    }
    return { mid: az[2], tip: az[4], base: az[0], above: up / n, bare: !!(S.P.bare || b.dead) };
  }
  // голая ветвь / сухой сук лёжа: стебель по оси «лежит», боковые прутья вверх-вбок, снег — линией сверху
  function drawLyingBare(g, S, b, o, sc) {
    const e = [Math.cos(o.ang), Math.sin(o.ang)], n = [-e[1], e[0]], L = o.len, ce = Math.cos(o.el || 0), se = Math.sin(o.el || 0), ke = o.ke == null ? 1 : o.ke;
    const AX = u => [e[0] * u * L * ce, e[1] * u * L * ce, Math.max(0, (o.bz || 0) * (1 - u * 0.6) + u * L * se + zAx(o.az, u) * ke * 0.6)];
    const PX = a => { SX = o.bx + a[0] * M; SY = o.by + (0.6 * a[1] - a[2]) * M; };
    g.strokeStyle = SC ? SP.ink : b.dead ? '#4d443c' : S.P.twig || '#4a3127'; g.lineCap = 'round'; const w0 = Math.max(0.5 * sc, (b.db || 0.02) * M);
    let px, py; for (let i = 0; i <= 4; i++) { PX(AX(i / 4)); if (i) { g.lineWidth = w0 * (1 - i / 5); g.beginPath(); g.moveTo(px, py); g.lineTo(SX, SY); g.stroke(); } px = SX; py = SY; }
    g.lineWidth = Math.max(0.35 * sc, w0 * 0.4); g.beginPath();
    for (let i = 0; i < 3; i++) { const u = 0.3 + i * 0.2, a = AX(u), s = i % 2 ? 1 : -1, l = L * (0.3 - i * 0.06); PX(a); g.moveTo(SX, SY); PX([a[0] + (e[0] * 0.6 + n[0] * s * 0.8) * l, a[1] + (e[1] * 0.6 + n[1] * s * 0.8) * l, a[2] + l * 0.25]); g.lineTo(SX, SY); }
    g.stroke();
    if ((o.snow || 0) > 0.05) { g.strokeStyle = SC ? SP.paper : '#f3f7fb'; g.lineWidth = w0 * 0.6 * Math.min(1, o.snow * 1.5); g.beginPath(); const a0 = AX(0.05); PX([a0[0], a0[1], a0[2] + 0.015]); g.moveTo(SX, SY); const a1 = AX(0.6); PX([a1[0], a1[1], a1[2] + 0.015]); g.lineTo(SX, SY); g.stroke(); }
  }
  // часть-ветвь: отделилась в месте роста и оседает вниз под своим весом — основание опускается, ось поворачивается вокруг него к снегу,
  // кончик касается снега и чуть отскакивает (settleT); дальше лежит своей формой (запечённый спрайт — drawPart)
  function drawBoughPart(g, p, time, sc) {
    const { S } = of(p), k = p.k, w = S.wh[p.w], b = w && w.br.find(q => q.j === p.b); if (!b) return;
    const bury = clamp((time - p.t) / (CYCLE * 0.75), 0, 1); if (bury >= 1) return;
    const len = b.len * k, T = settleT(p), e = clamp((time - p.t - (p.dl || 0)) / T, 0, 1), ca = Math.cos(p.ang), sa = Math.sin(p.ang), half = len * 0.45 * M;
    const rx = p.x - ca * half, ry = p.y - sa * half * 0.6;   // основание лёжа (px)
    const o = { bx: rx, by: ry, ang: p.ang, len, az: p.az || defAz(p), ss: p.ss || 1, tl: p.tl || 0, el: 0, ke: 1, bz: 0, snow: snowAge(p, time) };
    if (e < 1 && p.fx != null) {
      const d0 = p.d0 || [ca, sa, 0.35], g0 = Math.atan2(d0[1], d0[0]), el0 = Math.asin(clamp(d0[2], -0.9, 0.95));
      const kb = sm(0, 0.55, e), kr = e < 0.8 ? (e / 0.8) * (e / 0.8) : 1, bo = e > 0.8 ? 0.07 * Math.sin((e - 0.8) / 0.2 * Math.PI) : 0;
      let da = p.ang - g0; da = Math.atan2(Math.sin(da), Math.cos(da));
      o.bx = lerp(p.fx, rx, kb); o.by = lerp(p.fy, ry, kb); o.bz = (p.fz || 0.3) * (1 - kb) * (1 - kb);
      o.ang = g0 + da * sm(0, 0.85, e); o.el = el0 * (1 - kr) + bo; o.ke = kr; o.snow *= 0;
    }
    const A = W_(), a0 = g.globalAlpha, fade = 1 - sm(0.75, 1, bury); g.globalAlpha = a0 * fade;
    if (e >= 1) { if (SC) { g.fillStyle = SP.shade; g.beginPath(); g.ellipse(p.x + 2, p.y + 2, len * M * 0.5, len * M * 0.2, p.ang * 0.6, 0, TAU); g.fill(); } else if (A) A.shadow(g, p.x + 1, p.y + 2, len * M * 0.55, len * M * 0.26, 0.22); }
    const L_ = len * M + 10, paint = gg => { if (S.P.bare || b.dead) drawLyingBare(gg, S, b, o, sc); else drawLying(gg, S, b, o, sc, low()); };
    if (SC) Style.figure(g, o.bx - L_, o.by - L_, L_ * 2, L_ * 2, paint, { snap: false }); else paint(g);
    if (bury > 0.3) { g.globalAlpha = a0 * fade * sm(0.3, 0.75, bury); g.fillStyle = SC ? SP.paper : '#eef3f8'; g.beginPath(); g.ellipse(p.x, p.y - 1, len * M * 0.5, len * M * 0.2, p.ang * 0.6, 0, TAU); g.fill(); }
    g.globalAlpha = a0;
  }
  // куча лапника (сгребли): ветви внахлёст, выше к середине; масса — сумма сгребённых
  function drawPile(g, p, time, sc) {
    const { S } = of(p), k = p.k || 1, bury = clamp((time - (p.t || 0)) / (CYCLE * 0.75), 0, 1); if (bury >= 1) return;
    const live = []; for (const w of S.wh) for (const b of w.br) if (!b.dead && w.z > S.H * 0.25 && w.z < S.H * 0.7) live.push(b);
    if (!live.length) return;
    const n = clamp(Math.round(2 + Math.sqrt(p.mass || 1) * 1.7), 2, lowLOD() ? 6 : 11), id = (p.id || 1) | 0, sn = snowAge(p, time), A = W_(), a0 = g.globalAlpha;
    g.globalAlpha = a0 * (1 - sm(0.75, 1, bury));
    const R0 = (0.35 + 0.05 * n) * M;
    if (SC) { g.fillStyle = SP.shade; g.beginPath(); g.ellipse(p.x + 2, p.y + 2, R0 * 1.1, R0 * 0.45, 0, 0, TAU); g.fill(); } else if (A) A.shadow(g, p.x + 1, p.y + 2, R0 * 1.2, R0 * 0.5, 0.28);
    for (let i = 0; i < n; i++) {
      const b = live[(i * 7 + id) % live.length], len = clamp(b.len * k, 0.5, 1.1), ang = (p.ang || 0) + (hh(id, i) - 0.5) * 2.4 + (i % 2) * Math.PI, rr = (0.12 + 0.18 * hh(id, i + 20)) * (1 - i / (n + 2));
      const cx = p.x + Math.cos(ang + 1.9) * rr * M, cy = p.y + Math.sin(ang + 1.9) * rr * M * 0.6, z = 2 + i * 2.2;
      const o = { bx: cx - Math.cos(ang) * len * 0.45 * M, by: cy - Math.sin(ang) * len * 0.45 * M * 0.6, ang, len, az: [z + 2, z + 12, z + 15, z + 8, Math.max(-2, z - 6)], ss: i % 2 ? 1 : -1, tl: hh(id, i + 9) - 0.5, ke: 1, snow: i === n - 1 ? sn : sn * 0.4 };
      if (S.P.bare) drawLyingBare(g, S, b, o, sc); else drawLying(g, S, b, o, sc, low() || i < n - 4);
    }
    g.globalAlpha = a0;
  }
  function frame() { lcBudget = 2; FR++; }

  // ---------- падение: стержень на шарнире θ'' = (3g / 2L)·sin θ (L — высота над резом, м) ----------
  // безразмерно: время в τ = √(2L / 3g), θ'' = sin θ от θ0 (недоруб отпустил) без начальной скорости; таблица θ(u), u = t / T
  const FALL = (() => {
    const th0 = 0.08, dt = 1e-4; let th = th0, w = 0, t = 0; const pts = [[0, th0]];
    while (th < Math.PI / 2) { w += Math.sin(th) * dt; th += w * dt; t += dt; pts.push([t, Math.min(th, Math.PI / 2)]); }
    const N = 128, TB = []; for (let i = 0, j = 0; i <= N; i++) { const tt = t * i / N; while (j < pts.length - 2 && pts[j + 1][0] < tt) j++; TB.push(pts[j][1]); }
    TB[N] = Math.PI / 2;
    const at = u => { const x = clamp(u, 0, 1) * N, i = Math.min(N - 1, x | 0); return TB[i] + (TB[i + 1] - TB[i]) * (x - i); };
    const uAt = a => { for (let i = 0; i < N; i++) if (TB[i + 1] >= a) return (i + (a - TB[i]) / ((TB[i + 1] - TB[i]) || 1)) / N; return 1; };
    const tau = L => Math.sqrt(2 * L / (3 * 9.81));
    return { th0, Tn: t, wn: w, at, uAt, tau, T: L => t * tau(L), tip: L => w / tau(L) * L, ub: uAt(1.22) };   // ub — недоруб рвётся на ~70°
  })();

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
    paintSprite, drawStanding, drawStump, drawLog, drawPart, live, shook, snowOf, frame, iceImpact, varOf, jit, MODEL, FALL, notchGeo, OPEN, BK, limbPlan, limbState, boughShape, cutFrac: L => { ensure(L); return cutFrac(of(L).S, L); }, drawChips,
    get stats() { return { specs: SPECS.size }; }, LD,   // свет модели — то же солнце, что у теней (Style.SUN)
  };
})();
