'use strict';
// Depth — глубина снега по миру (см) и проваливание тел: герой, люди, звери (паспорт §4.5 «снег по пояс», docs/design/INTERACTION-PASSPORT.md).
//   📏 1 м ≈ 23 px (PX = 0.23 px/см). Реальные числа: снег в тайге 50–80 см, в наддувах 1.5–2 м; у стволов — приствольная яма;
//      человек без лыж проваливается по колено–пояс; лыжи/снегоступы — в разы меньше; наст держит волка, олень/медведь пробивают.
//   🗺 depthAt(x, y) = сетка 24 px (лениво блоками 16×16, Uint8, ≤ 200 КБ на весь мир ×9) — поверхность зоны (TERRAIN), шум seed,
//      выдув на открытом (мало деревьев в 90 px), река (лёд выдут, береговой надув), натоптанное у избы/чума/лабаза
//      + поверх, без сетки: сугробы G.drifts (эллипсы), приствольные ямы, подветренные наддувы Snow (вещи), проталины у огня
//      и промоин, постройки посёлка, тропы и расчистка (js/trail.js), траншеи и «разгребы» (утоптано, заметает ветром как следы);
//      на льду реки — не глубже ICE см.
//      Ямы на месте глубокого провала (стоял/выбирался) — только рисунок, заметает как колею. Кусков земли не перепекаем.
//   🧍 sink = depth × k × (1 − опора); опора = тело (лапы/копыта) ⊕ наст (свой у вида) ⊕ лыжи 0.88 / снегоступы 0.7.
//      Вход плавный (τ 0.1 с → 95 % за 0.3 с). Скорость людей: f(sink) / f(обычный провал поверхности) — поверхность (TERRAIN.walk)
//      уже учитывает обычную целину; по колено ×0.7 · по пояс ×0.35 · глубже ×0.2, рывками. Звери — по доле длины ноги.
//   🎨 look(o) → обрезка фигуры в gfx.js (ниже линии снега не видно), бровка/валик, траншея (рисунок — art: back/front/trenches).
// Сейв не пишется: поле — из seed; траншеи и память тел — рантайм. Свой поток случайности — Math.random игры не тратит.
const Depth = (() => {
  const C = 24, BS = 16, NX = Math.ceil(W / C), NY = Math.ceil(H / C), BX = Math.ceil(NX / BS), BY = Math.ceil(NY / BS);
  const PX = 0.23, TAU = Math.PI * 2;
  // поверхность → средний снег, см (натоптано у жилья, накатан зимник, выдут голец, стланик — сугробы)
  const BASE = { core: 52, taiga: 66, camp: 22, trail: 10, naled: 34, gar: 56, stlanik: 84, kurum: 44, golets: 28 };
  const low = () => typeof window !== 'undefined' && window.QUALITY === 'low';
  const sm = (a, b, x) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
  const R = mulberry(0x5E7D), rr = (a, b) => a + R() * (b - a);
  // виды тел: sup — опора лап/копыт, crust — сколько наста держит, k — уплотнение, max — предел провала (см), leg — длина ноги (см),
  // rx/ry — полуоси «ямы» вокруг тела на экране (px), tw — ширина траншеи (px), min — нижний предел скорости (баланс угроз)
  const KIND = {
    p: { sup: 0, crust: 0.3, k: 0.82, max: 142, leg: 90, rx: 11, ry: 4.2, tw: 12, min: 0.18, h: 42 },
    n: { sup: 0, crust: 0.3, k: 0.82, max: 142, leg: 90, rx: 11, ry: 4.2, tw: 12, min: 0.18, h: 42 },
    deer: { sup: 0.08, crust: 0.05, k: 0.82, max: 72, leg: 85, rx: 19, ry: 5.5, tw: 15, min: 0.35, h: 44 },
    hare: { sup: 0.82, crust: 0.7, k: 0.6, max: 10, leg: 16, rx: 6, ry: 2.4, tw: 5, min: 0.7, h: 12 },
    wolf: { sup: 0.35, crust: 0.85, k: 0.75, max: 55, leg: 55, rx: 13, ry: 4, tw: 9, min: 0.65, h: 26 },
    bear: { sup: 0.2, crust: 0.1, k: 0.72, max: 85, leg: 70, rx: 20, ry: 6.5, tw: 18, min: 0.5, h: 40 },
    dog: { sup: 0.45, crust: 0.7, k: 0.7, max: 40, leg: 40, rx: 8, ry: 3, tw: 6, min: 0.6, h: 18 },
  };
  // скорость человека по провалу (см): до щиколотки 1 · колено 0.7 · пояс 0.35 · грудь 0.2
  const FH = [[20, 1], [50, 0.7], [100, 0.35], [130, 0.2]];
  const FA = [[0.25, 1], [0.5, 0.78], [1, 0.45], [1.3, 0.3]]; // зверь: доля длины ноги
  function pw(T, v) { if (v <= T[0][0]) return T[0][1]; for (let i = 1; i < T.length; i++) if (v <= T[i][0]) { const a = T[i - 1], b = T[i]; return a[1] + (b[1] - a[1]) * (v - a[0]) / (b[0] - a[0]); } return T[T.length - 1][1]; }
  const fH = s => pw(FH, s);

  // ---------- сетка (статичная часть: из seed) ----------
  let BL = [], gKey = null, gTrees = null, N = null, NCr = null, blocks = 0, buildMs = 0;
  function ensure() {
    if (typeof G === 'undefined' || !G || !G.trees || (typeof window !== 'undefined' && window.DEPTH_OFF)) return false; // DEPTH_OFF — замеры «без снега»
    if (gKey === G.seed && gTrees === G.trees) return true;
    gKey = G.seed; gTrees = G.trees; BL = new Array(BX * BY).fill(null); blocks = 0;
    N = Noise.make(mulberry((G.seed ^ 0x5D3E7A1) | 0)); NCr = Noise.make(mulberry((G.seed ^ 0x13C0A57) | 0));
    TR.length = 0; DG.length = 0; PT.length = 0; CL = null; RUNS.clear(); TB.clear(); LEE.t = -9; ST = new WeakMap(); HS.s = 0; HS.run = ++RUN; STEAM = null;
    return true;
  }
  const OFF = [[-40, -40], [40, -40], [-40, 40], [40, 40]];
  const TL = [];
  // натоптанное у жилья (изба — шире: тропы к лабазу, обломкам, реке)
  const TROD = () => [[HUT.x, HUT.y + 10, 140, 330, 12], [POI.chum.x, POI.chum.y, 90, 220, 20], [POI.labaz.x, POI.labaz.y, 50, 120, 24]];
  function build(bi, bj) {
    const t0 = performance.now(), a = new Uint8Array(BS * BS), x0 = bi * BS * C, y0 = bj * BS * C, cx = x0 + BS * C / 2, cy = y0 + BS * C / 2;
    TL.length = 0; for (const t of Space.trees.near(cx, cy, BS * C * 0.72 + 100)) TL.push(t);
    const tr = TROD();
    for (let j = 0; j < BS; j++) for (let i = 0; i < BS; i++) {
      const x = x0 + i * C + C / 2, y = y0 + j * C + C / 2;
      let b = 0; for (const o of OFF) { const v = BASE[Zones.terrainKey(x + o[0], y + o[1])]; b += v == null ? 60 : v; } b /= 4;
      let d = b + N.fbm(x / 900, y / 900, 3) * 16 + N.n2(x / 170, y / 170) * 7;
      let n = 0; for (const t of TL) { const dx = t.x - x, dy = t.y - y; if (dx * dx + dy * dy < 8100) n++; }
      d -= 12 * Math.max(0, 1 - n / 3); // открытое место — выдуло
      const rx = Math.abs(x - riverX(y));
      if (rx < RW - 6) d = 4 + N.n2(x / 70, y / 70) * 8; // лёд реки выдут ветром: плешины голого льда (< 3 см) и тонкий снег
      else if (rx < RW + 40) d += 22 * (1 - (rx - RW + 6) / 46); // надув у берега
      for (const q of tr) { const dd = Math.hypot(x - q[0], y - q[1]); if (dd < q[3]) d = q[4] + (d - q[4]) * sm(q[2], q[3], dd); }
      a[j * BS + i] = Math.max(0, Math.min(255, Math.round(d)));
    }
    BL[bi + bj * BX] = a; blocks++; buildMs = Math.max(buildMs, performance.now() - t0);
    return a;
  }
  function cell(i, j) {
    i = i < 0 ? 0 : i >= NX ? NX - 1 : i; j = j < 0 ? 0 : j >= NY ? NY - 1 : j;
    const bi = (i / BS) | 0, bj = (j / BS) | 0; const a = BL[bi + bj * BX] || build(bi, bj);
    return a[(j - bj * BS) * BS + (i - bi * BS)];
  }
  function base(x, y) {
    const fx = x / C - 0.5, fy = y / C - 0.5, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const a = cell(i, j), b = cell(i + 1, j), c = cell(i, j + 1), d = cell(i + 1, j + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }

  // ---------- наддувы вещей (js/snow.js): кэш геометрии 2 Гц ----------
  const LEE = { t: -9, L: [] };
  const zP = s => (s < 0.22 ? 0.55 + 0.45 * s / 0.22 : Math.pow(1 - (s - 0.22) / 0.78, 1.4)); // профиль вдоль наноса (как в snow.js)
  let TRD = [];
  function lee() {
    const T = G.time; if (!TRD.length) TRD = TROD();
    if (Math.abs(T - LEE.t) < 0.5) return LEE.L;
    LEE.t = T; LEE.L.length = 0;
    if (typeof Snow === 'undefined') return LEE.L;
    for (const h of Snow.holders) {
      if (!(h.h > 0) || !(h.d > 0.05)) continue;
      const g = Snow.geo(h.id, Wind.at(h.ax, h.ay).dir); if (!g) continue;
      const q = g.lee, cs = Math.cos(Wind.at(h.ax, h.ay).dir), sn = Math.sin(Wind.at(h.ax, h.ay).dir);
      const x0 = h.ax + q.x0, y0 = h.ay + q.y0, x1 = x0 + cs * q.len, y1 = y0 + sn * q.len, hw = q.width / 2 + 4;
      LEE.L.push({ x0, y0, cs, sn, len: q.len, hw, peak: Math.min(150, h.h * 3.2) * h.d, bx0: Math.min(x0, x1) - hw, bx1: Math.max(x0, x1) + hw, by0: Math.min(y0, y1) - hw, by1: Math.max(y0, y1) + hw });
    }
    return LEE.L;
  }

  // ---------- траншеи и разгребы (утоптано; заметает ветром как следы) ----------
  // корзины 32 px: точка траншеи — во всех корзинах, которые задевает её круг ±12 px (запрос — одна корзина)
  const TB = new Map();
  function tbAdd(q) { for (let i = ((q.x - 12) / 32) | 0; i <= ((q.x + 12) / 32) | 0; i++) for (let j = ((q.y - 12) / 32) | 0; j <= ((q.y + 12) / 32) | 0; j++) { const k = i + j * 4096; let a = TB.get(k); if (!a) TB.set(k, a = []); a.push(q); } }
  function tbRebuild() { TB.clear(); for (const q of TR) tbAdd(q); }
  const TR = [], DG = [], PT = [], RUNS = new Map(), TRMAX = 420, TLIFE = 60, PLIFE = 90, FREE = 15, ICE = 10; let RUN = 1, STEAM = null, EXCL = -1;
  const NB = [];
  // глубина снега, см, в точке мира
  function depthAt(x, y) {
    if (!ensure()) return 0;
    if (insideHut(x, y)) return 0;
    let d = base(x, y);
    // сугробы — эллипсы G.drifts (гребень в середине): до +125 см у длинных
    NB.length = 0;
    for (const q of Space.drifts.near(x, y, 150, NB)) {
      const ex = (x - q.x) / q.rx, ey = (y - q.y) / (q.ry * 1.25), e = ex * ex + ey * ey;
      if (e < 1.6) d += (35 + 0.75 * q.rx) * Math.pow(1 - e / 1.6, 1.2);
    }
    // приствольные ямы: под кроной снега мало (ствол дерева, пень — тоже)
    NB.length = 0; let pit = 1;
    for (const t of Space.trees.near(x, y, 34, NB)) {
      const dx = t.x - x, dy = t.y - y, q = dx * dx + dy * dy, Rr = 11 + 12 * (t.s || 1);
      if (q < Rr * Rr) { const k = 0.28 + 0.72 * sm(Rr * 0.25, Rr, Math.sqrt(q)); if (k < pit) pit = k; }
    }
    d *= pit;
    // наддувы у вещей по ветру
    for (const L of lee()) {
      if (x < L.bx0 || x > L.bx1 || y < L.by0 || y > L.by1) continue;
      const dx = x - L.x0, dy = y - L.y0, u = dx * L.cs + dy * L.sn, v = -dx * L.sn + dy * L.cs;
      if (u < 0 || u > L.len || Math.abs(v) > L.hw) continue;
      let tf = 1; for (const q of TRD) { const dd = Math.hypot(x - q[0], y - q[1]); if (dd < q[3]) tf = Math.min(tf, sm(q[2], q[3], dd)); } // у жилья наддув отгребают
      d += L.peak * zP(u / L.len) * (1 - (v / L.hw) ** 2) * tf;
    }
    // проталины: костры (кольцо растёт со временем горения), промоины наледи
    for (const f of G.fires) {
      const r = 26 + 48 * (f.melt || 0), dx = f.x - x, dy = f.y - y, q = dx * dx + dy * dy;
      if (q < r * r) d *= sm(r * 0.35, r, Math.sqrt(q));
    }
    if (!STEAM) STEAM = Zones.OBJS.filter(o => o.type === 'steam');
    for (const o of STEAM) { const dx = o.x - x, dy = o.y - y; if (dx * dx + dy * dy < 55 * 55) d *= sm(18, 55, Math.hypot(dx, dy)); }
    // посёлок: вокруг построек натоптано
    if (G.col && G.col.builds.length) { NB.length = 0; for (const b of Space.builds.near(x, y, 90, NB)) { const B = BUILDS[b.type], ex = Math.abs(x - b.x) - B.w / 2, ey = Math.abs(y - b.y) - B.h / 2; if (ex < 40 && ey < 40) d = Math.min(d, 14 + Math.max(0, Math.max(ex, ey)) * 0.8); } }
    // тропы и расчистка лопатой (js/trail.js): × (1 − 0.85·pack), у края расчистки — отвал
    if (typeof Trail !== 'undefined') d = Trail.depth(d, x, y);
    // траншеи (свежая — утоптано до 0.3 глубины) и разгребы
    const tb = TB.get(((x / 32) | 0) + ((y / 32) | 0) * 4096);
    if (tb) for (let i = tb.length - 1; i >= 0; i--) {
      const q = tb[i], dx = q.x - x, dy = q.y - y; if (dx > 12 || dx < -12 || dy > 12 || dy < -12) continue;
      if (q.run === EXCL && !q.free) continue; // своя колея не держит, пока тело в ней (не отошло на FREE px) — стоя не «всплывает»
      const r = q.w * 0.62; if (dx * dx + dy * dy < r * r) { const k = Math.min(1, q.life / q.max * 1.6); d = Math.min(d, d * (1 - 0.7 * k)); }
    }
    for (const q of DG) { const dx = q.x - x, dy = q.y - y, q2 = dx * dx + dy * dy; if (q2 < q.r * q.r) d *= 1 - 0.78 * q.k * Math.min(1, q.life / 40) * (1 - sm(q.r * 0.55, q.r, Math.sqrt(q2))); }
    // лёд реки: снег сдувает — после всех добавок не глубже ICE см (берег не «затекает» на лёд)
    const rv = Math.abs(x - riverX(y)); if (rv < RW) { const cap = ICE + 240 * sm(RW - 8, RW, rv); if (d > cap) d = cap; }
    return d < 0 ? 0 : d > 230 ? 230 : d;
  }
  // голый лёд (снега < 3 см) — только на нём скользят; под снегом — сцепление
  const bareIce = (x, y) => onIce(x, y) && depthAt(x, y) < 3;
  // наст 0..1 (из seed): на открытом ветер уплотняет; голец — почти всегда
  function crustAt(x, y) {
    if (!ensure()) return 0;
    let c = 0.15 + 0.55 * sm(-0.15, 0.55, NCr.n2(x / 1500, y / 1500));
    if (Zones.terrainKey(x, y) === 'golets') c += 0.3;
    return c > 1 ? 1 : c;
  }
  // провал вида kind в точке, см (gear — опора снаряжения 0..1)
  function sinkAt(x, y, kind = 'p', gear = 0) {
    const K = KIND[kind] || KIND.p, d = depthAt(x, y); if (d <= 0) return 0;
    let sup = 1 - (1 - K.sup) * (1 - crustAt(x, y) * K.crust);
    if (gear) sup = 1 - (1 - sup) * (1 - gear);
    const s = d * K.k * (1 - sup);
    return s > K.max ? K.max : s;
  }
  // обычный провал человека на этой поверхности (под него настроен TERRAIN.walk)
  const refSink = (x, y) => ((BASE[Zones.terrainKey(x, y)] || 60) + 14) * KIND.p.k * 0.94; // + разброс шума: обычная целина — без штрафа
  function mulHuman(s, x, y) { return Math.max(KIND.p.min, Math.min(1, fH(s) / fH(refSink(x, y)))); }
  function mulKind(kind, s, x, y) {
    if (kind === 'p' || kind === 'n') return mulHuman(s, x, y);
    const K = KIND[kind]; return Math.max(K.min, pw(FA, s / K.leg));
  }

  // ---------- герой ----------
  // Провал: вниз — быстро (τ 0.1 с); вверх — только на ходу, ≤ RISE см/с (стоя не всплывает); смена снаряжения, разгреб, телепорт — сразу.
  // Выкарабкивание: с ≥ CLB.from см на заметно мельче (≥ CLB.gap) — разовый подъём CLB.dur с по ходу позы climbOut (js/art-poses.js), только при вводе.
  // Яма: стоял/выбирался глубже PIT0 см — на месте яма (центр, радиус, глубина), заметает как колею. Снег на одежде: провал > 60 см — налёт, тает ~45 с.
  const HS = { s: 0, ph: 0, acc: 0, run: 1, lx: 0, ly: 0, t: -1, spr: 0, moved: 0, lastT: -9, g: 0, gT: -9, digT: -9, stillT: 0, out: -9, snow: 0 };
  const RISE = 110, CLB = { from: 95, gap: 30, dur: 1.2 }, PIT0 = 90; let CL = null;
  const heroGear = () => { const p = G.p; if (p.ride) return 1; if (typeof Transport !== 'undefined' && Transport.mode() === 'ski') return 0.88; return G.gear && G.gear.shoes ? 0.7 : 0; };
  const forcedOut = () => { const p = G.p; return p.inside || p.ride || p.sleeping || (typeof Ice !== 'undefined' && Ice.active()); };
  function heroTarget() {
    const p = G.p;
    if (forcedOut()) return 0;
    const g = heroGear(); if (g >= 1) return 0;
    EXCL = HS.run; const s = sinkAt(p.x, p.y, 'p', g); EXCL = -1; return s;
  }
  // множитель скорости героя (Hero.speed): провал + рывки глубже пояса; выкарабкивается — медленно, без рывков
  function heroMul() {
    const p = G.p; if (!G || p.ride || p.inside || !ensure()) return 1;
    if (CL) return 0.12;
    let m = mulHuman(HS.s, p.x, p.y);
    if (typeof Trail !== 'undefined') { // по тропе — быстрее целины: в тайге до зимника, у жилья ×1.12 (js/trail.js)
      const ter = Zones.terrainAt(p.x, p.y), ski = typeof Transport !== 'undefined' && Transport.mode() === 'ski', cap = Trail.speedCap(p.x, p.y, ski ? (ter.ski || 1) / 1.3 : ter.walk);
      if (cap > 1) m = Math.max(KIND.p.min, Math.min(cap, fH(HS.s) / fH(refSink(p.x, p.y))));
    }
    if (HS.s > 110) m *= (0.45 + 1.1 * Math.max(0, Math.sin(HS.ph))) / 0.8; // по грудь — рывками: выдернул ногу — шаг, увяз — стоит
    return m;
  }
  // верхом (Hero.speed): «Буран» на гусенице вязнет в глубоком меньше, упряжка (олени по брюхо, нарты с грузом) — больше; поверхность (TERRAIN.deer/buran)
  // уже учитывает обычную целину — множитель к ней; по тропе/расчищенному — до ×1.25 (зимник-зона — свой ×1.3 в TERRAIN)
  const RF = { buran: s => 1 - 0.42 * sm(25, 190, s), deer: (s, ld) => 1 - (0.5 + 0.2 * ld) * sm(20, 150, s) };
  function rideMul(kind) {
    const p = G.p, f = RF[kind]; if (!G || !f || !ensure()) return 1;
    const ld = kind === 'deer' && typeof Inv !== 'undefined' ? Math.max(0, Math.min(1.5, Inv.weight() / Math.max(1, Inv.capKg()))) : 0;
    const d = depthAt(p.x, p.y), ref = (BASE[Zones.terrainKey(p.x, p.y)] || 60) + 14;
    let m = Math.max(0.35, Math.min(1, f(d, ld) / f(ref, ld)));
    if (typeof Trail !== 'undefined') m *= 1 + 0.25 * sm(0.25, 0.8, Trail.at(p.x, p.y));
    return m;
  }
  // 0..1: насколько тяжело идти (тепло/еда тратятся быстрее, дыхание чаще)
  // порог — 22 см: по тропе (провал < 22) не выматывает, по целине — заметно; работа лопатой — не меньше 0.6 (пот на морозе)
  const effort = () => { if (!G || !G.p) return 0; const a = G.p.action, w = a && a.k === 'clear' ? 0.6 : 0; return G.p.moving ? Math.max(w, CL ? 1 : sm(22, 120, HS.s)) : w; };
  // яма на месте глубокого провала: одна на место (ближе 12 px — та же, углубляется)
  function pitAt(x, y, s) {
    let q = PT.find(o => (o.x - x) ** 2 + (o.y - y) ** 2 < 144);
    if (!q) { q = { x, y, r: 0, d: 0, life: PLIFE, max: PLIFE }; PT.push(q); if (PT.length > 12) PT.shift(); }
    q.d = Math.max(q.d, s); q.r = 8 + 6 * sm(PIT0, 142, q.d); q.life = PLIFE; q.spr = null;
  }
  function tickHero(dt) {
    if (!ensure() || dt <= 0) return;
    const p = G.p, g = heroGear(), tg = heroTarget(), forced = forcedOut();
    const dx = p.x - HS.lx, dy = p.y - HS.ly, d = Math.hypot(dx, dy); HS.lx = p.x; HS.ly = p.y;
    const jump = d > 60;
    if (g !== HS.g) { HS.g = g; HS.gT = G.time; }
    if (forced || jump || (CL && tg > HS.s + 25)) CL = null; // шагнул обратно в глубокое — выход сорван
    if (CL) { // провал убывает по ходу позы (только на ходу), не сглаживанием
      if (p.moving) {
        CL.t += dt; const e = sm(0.15, 0.95, CL.t / CLB.dur);
        HS.s = Math.min(HS.s, CL.s0 + (Math.min(tg, CL.s0) - CL.s0) * e);
        if (CL.t >= CLB.dur) { CL = null; HS.out = G.time; }
      }
    }
    else if (tg >= HS.s) HS.s += (tg - HS.s) * (1 - Math.exp(-dt / 0.1)); // вниз — быстро
    else if (jump) HS.s = tg;
    else if (forced || G.time - HS.gT < 1 || G.time - HS.digT < 0.5) HS.s += (tg - HS.s) * (1 - Math.exp(-dt / 0.12)); // снаряжение/разгреб — подняло на месте
    else if (p.moving) {
      if (HS.s >= CLB.from && HS.s - tg >= CLB.gap) { CL = { t: 0, s0: HS.s }; pitAt(p.x, p.y, HS.s); } // с глубокого на мелкое — выкарабкивается
      else HS.s = Math.max(tg, HS.s - RISE * dt);
    }
    if (HS.s < 0.05) HS.s = 0;
    // стоит глубоко — яма; снег на одежде
    HS.stillT = !p.moving && !forced && HS.s > PIT0 ? HS.stillT + dt : 0;
    if (HS.stillT > 0.4) pitAt(p.x, p.y, HS.s);
    if (HS.s > 60) HS.snow = Math.max(HS.snow, sm(60, 130, HS.s)); else HS.snow = Math.max(0, HS.snow - dt / 45 * (p.inside ? 3 : 1));
    if (typeof Trail !== 'undefined' && !p.inside && !(typeof Ice !== 'undefined' && Ice.active())) Trail.step(p, p.x, p.y, p.ride ? 'ride' : g >= 0.85 ? 'ski' : g > 0 ? 'shoes' : 'p'); // протаптывает тропу
    if (jump) { HS.run = ++RUN; HS.acc = 0; return; } // рывок/телепорт — не шаг
    if (p.moving && d > 0) {
      HS.ph += dt * TAU * 1.5;
      rec(HS, p.x, p.y, Math.atan2(dy, dx), KIND.p, d, 'p');
      spray(HS, p.x, p.y, dx / (d || 1), dy / (d || 1), d / dt, KIND.p, dt);
    }
    // застрял глубоко — подсказка (раз в 20 с)
    if (HS.s > 110 && p.moving && G.time - HS.lastT > 20) { HS.lastT = G.time; Fx.toast(':frost: Увяз по грудь · E — разгрести'); }
  }
  // ---------- тела ИИ: шаг вслед за движением (World.solid) ----------
  let ST = new WeakMap(), hold = 0;
  function kindOf(o, who, r) { return who === 'a' ? (r <= 6 ? 'hare' : 'deer') : who === 'w' ? 'wolf' : who === 'b' ? 'bear' : who === 'u' ? (o.type === 'laika' ? 'dog' : 'n') : who === 'n' ? 'n' : null; }
  function drag(o, who, r) {
    if (hold || !ensure()) return;
    const kind = o.kind || kindOf(o, who, r); if (!kind) return;
    let st = ST.get(o);
    if (!st) { st = { x: o.x, y: o.y, t: G.time, s: 0, acc: 0, run: ++RUN, kind, spr: 0 }; ST.set(o, st); st.s = sinkAt(o.x, o.y, kind); return; }
    const dt = G.time - st.t; st.t = G.time; st.kind = kind;
    const dx = o.x - st.x, dy = o.y - st.y, d2 = dx * dx + dy * dy;
    if (dt <= 0) return;
    if (d2 > 90 * 90) { st.x = o.x; st.y = o.y; st.run = ++RUN; st.s = sinkAt(o.x, o.y, kind); return; }
    const pd = Math.abs(o.x - G.p.x) + Math.abs(o.y - G.p.y);
    if (pd > 1600) { st.x = o.x; st.y = o.y; return; } // далеко от героя — не считаем
    EXCL = st.run; const tg = sinkAt(o.x, o.y, kind); EXCL = -1; st.s += (tg - st.s) * (1 - Math.exp(-dt / 0.12));
    if (d2 > 1e-4) {
      const m = mulKind(kind, st.s, o.x, o.y);
      if (m < 0.999) { o.x = st.x + dx * m; o.y = st.y + dy * m; }
      const d = Math.sqrt(d2) * m;
      rec(st, o.x, o.y, Math.atan2(dy, dx), KIND[kind], d, kind);
      if (pd < 900) spray(st, o.x, o.y, dx / Math.sqrt(d2), dy / Math.sqrt(d2), d / dt, KIND[kind], dt);
      if (kind !== 'hare' && typeof Trail !== 'undefined') Trail.step(o, o.x, o.y, kind); // люди и звери тоже протаптывают
    }
    st.x = o.x; st.y = o.y;
  }
  // конец шага World.solid: тело встало после упоров — следующий шаг считаем отсюда (иначе провал «откатывает» шаг вдоль преграды и тело дрожит у ствола/огня)
  function settle(o) { const st = ST.get(o); if (st && !hold) { st.x = o.x; st.y = o.y; } }
  // обход глубокого: ИИ выбирает из 5 направлений то, где мельче (цена — провал + отклонение от цели)
  const SA = [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35], SC = new WeakMap();
  function steer(o, dx, dy, kind = 'n') {
    if (!ensure()) return null;
    const l = Math.hypot(dx, dy); if (l < 1e-6) return null;
    const ux = dx / l, uy = dy / l, K = KIND[kind] || KIND.n, look = 34;
    // выбор держится 0.3 с, пока цель в ту же сторону (не дёргается каждый кадр)
    const c = SC.get(o); if (c && G.time - c.t < 0.3 && c.ux * ux + c.uy * uy > 0.97) return c.v;
    let best = 0, bc = 1e9, b0 = 0;
    for (let i = 0; i < SA.length; i++) {
      const a = SA[i], c = Math.cos(a), s = Math.sin(a), vx = ux * c - uy * s, vy = ux * s + uy * c;
      const sk = sinkAt(o.x + vx * look, o.y + vy * look, kind) / K.leg;
      const cost = sk + Math.abs(a) * 0.3;
      if (i === 0) b0 = cost;
      if (cost < bc) { bc = cost; best = i; }
    }
    let v = null;
    if (best !== 0 && b0 - bc >= 0.1) { const a = SA[best], cc = Math.cos(a), s = Math.sin(a); v = { x: ux * cc - uy * s, y: ux * s + uy * cc }; }
    SC.set(o, { t: G.time, ux, uy, v });
    return v;
  }
  // запись траншеи: точка каждые 6 px пути, если провал глубже 22 см (человек) / трети ноги (зверь)
  function rec(st, x, y, a, K, d, kind) {
    const rn = RUNS.get(st.run); if (rn) for (let i = rn.length - 1, n = 0; i >= 0 && n < 12; i--, n++) { const o = rn[i]; if (!o.free && (o.x - x) ** 2 + (o.y - y) ** 2 > FREE * FREE) o.free = true; } // отошёл — колея держит
    const deep = kind === 'hare' ? false : kind === 'p' || kind === 'n' ? st.s > 22 : st.s > Math.max(15, K.leg * 0.3);
    if (!deep) { st.acc = 0; if (st.s < 8) st.run = ++RUN; return; }
    st.acc += d; if (st.acc < 6) return; st.acc = 0;
    // по своей же колее (тот же ран, точка ближе 5 px) — новую не кладём, старую освежаем: колея не двоится полосами
    if (rn) for (const o of rn) if ((o.x - x) ** 2 + (o.y - y) ** 2 < 25) { o.life = o.max; if (st.s > o.d) o.d = st.s; return; }
    const q = { x, y, a, w: K.tw, d: st.s, life: TLIFE, max: TLIFE, run: st.run, k: kind, t: G.time };
    TR.push(q); tbAdd(q); let r = RUNS.get(q.run); if (!r) RUNS.set(q.run, r = []); r.push(q);
    if (TR.length > TRMAX) { const o = TR.shift(), ro = RUNS.get(o.run); if (ro) { ro.shift(); if (!ro.length) RUNS.delete(o.run); } tbRebuild(); }
  }
  // разлёт снега при шаге: комья с бровки, облачко (только high, у камеры)
  function spray(st, x, y, ux, uy, v, K, dt) {
    if (low() || !G.parts || st.s < 18 || v < 8) return;
    st.spr = (st.spr || 0) + dt * Math.min(8, 1.2 + st.s / 22) * Math.min(1.4, v / 90);
    while (st.spr >= 1) {
      st.spr -= 1;
      const side = R() < 0.5 ? -1 : 1, px = -uy * side, py = ux * side, sp = rr(20, 50);
      G.parts.push({ type: 'bit', kind: 'snow', c: R() < 0.6 ? '#f6f9fc' : '#dde6ee', x: x + px * K.rx * 0.8 + ux * 3, y: y + py * K.ry + 1, vx: 0, vy: 0,
        ux: px * sp + ux * rr(10, 30), uy: py * sp * 0.4, uz: rr(30, 60 + st.s * 0.6), gz: 300, z0: rr(1, 4), sz: rr(1.2, 2.6), rot: 0, spin: rr(-8, 8), life: rr(0.5, 0.9), max: 0.9, live: 'snow' });
      if (R() < 0.3) G.parts.push({ type: 'puff', x: x + ux * 6, y: y + 1, h: 4, vx: ux * 8, vy: 0, r0: 3, r1: 8 + st.s / 20, life: 0.6, max: 0.6, live: 'snow' });
    }
  }
  // разгрести снег вокруг себя (E, js/actions.js): каждую секунду — утоптано сильнее
  function dig(x, y, dt) {
    let q = DG.find(o => (o.x - x) ** 2 + (o.y - y) ** 2 < 10 * 10);
    if (!q) { q = { x, y, r: 26, k: 0, life: 90 }; DG.push(q); if (DG.length > 24) DG.shift(); }
    q.k = Math.min(1, q.k + dt / 2.4); q.life = 90; HS.digT = G.time;
    if (!low() && G.parts && R() < dt * 9) { const a = R() * TAU; G.parts.push({ type: 'bit', kind: 'snow', c: '#f6f9fc', x: x + Math.cos(a) * 8, y: y + Math.sin(a) * 3, vx: 0, vy: 0, ux: Math.cos(a) * 40, uy: Math.sin(a) * 15, uz: rr(50, 90), gz: 300, z0: 6, sz: rr(1.6, 3), rot: 0, spin: 4, life: 0.8, max: 0.8, live: 'snow' }); }
    return q.k;
  }
  // шаг: траншеи и разгребы заметает (темп — как следы, Snow.printRate)
  function tick(dt, storm) {
    if (!ensure()) return;
    const k = typeof Snow !== 'undefined' ? Snow.printRate(storm) : storm ? 4 : 1;
    if (typeof Trail !== 'undefined') Trail.tick(dt, storm); // тропы заметает (счётчик FILL — без обхода сетки)
    let n = 0; for (const q of TR) { q.life -= dt * k; if (q.life <= 0) n++; }
    if (n) { let w = 0; for (const q of TR) if (q.life > 0) TR[w++] = q; TR.length = w; for (const [id, r] of RUNS) { let v = 0; for (const q of r) if (q.life > 0) r[v++] = q; r.length = v; if (!v) RUNS.delete(id); } tbRebuild(); }
    for (let i = DG.length - 1; i >= 0; i--) { DG[i].life -= dt * k; if (DG[i].life <= 0) DG.splice(i, 1); }
    for (let i = PT.length - 1; i >= 0; i--) { PT[i].life -= dt * k; if (PT[i].life <= 0) PT.splice(i, 1); }
  }
  // провал тела o сейчас (см): герой — сглаженный, ИИ — из памяти шага, стоящие — по месту
  const LK = new WeakMap();
  function sinkOf(o, kind) {
    if (!G || !ensure()) return 0;
    if (o === G.p) return HS.s;
    const st = ST.get(o); if (st && G.time - st.t < 0.6) return st.s;
    let c = LK.get(o); if (c && c.t === G.time && c.x === o.x && c.y === o.y) return c.s;
    const s = sinkAt(o.x, o.y, kind || (st && st.kind) || 'n'); LK.set(o, { t: G.time, x: o.x, y: o.y, s }); return s;
  }
  // для рисунка: {px — на сколько фигура ниже снега, rx, ry — яма, mode: 'snow'|'water'|'hole', k — вид}
  const LOOK = { px: 0, rx: 0, ry: 0, mode: 'snow', cx: 0, cy: 0, k: 'p', s: 0, v: 0 };
  function look(o, kind) {
    if (o === G.p && typeof Ice !== 'undefined' && Ice.active()) return Ice.look();
    const s = sinkOf(o, kind); const K = KIND[kind] || KIND.p;
    let px = s * PX; if (low()) px = px < 2.5 ? 0 : Math.max(3, Math.round(px / 3) * 3); // low: ступенями; тонкий снег (< 2.5 px) — без воронки, как в high
    LOOK.px = px; LOOK.s = s; LOOK.rx = K.rx * (0.75 + 0.25 * Math.min(1, s / 60)); LOOK.ry = K.ry; LOOK.mode = 'snow'; LOOK.k = kind; LOOK.cx = o.x; LOOK.cy = o.y;
    return LOOK;
  }

  // ---------- рисунок ----------
  // мягкие диски (радиальный спад до нуля — у валика нет контура, «тарелки» нет)
  const DISC = {};
  function disc(k, rgb, core = 0.4) {
    let c = DISC[k]; if (c) return c;
    c = document.createElement('canvas'); c.width = c.height = 48; const g = c.getContext('2d'), gr = g.createRadialGradient(24, 24, 0, 24, 24, 24);
    gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(core, `rgba(${rgb},0.85)`); gr.addColorStop(0.75, `rgba(${rgb},0.3)`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 48, 48); DISC[k] = c; return c;
  }
  const blit = (g, img, x, y, rx, ry, a) => { if (a <= 0.01) return; g.globalAlpha = a; g.drawImage(img, x - rx, y - ry, rx * 2, ry * 2); };
  const W_ = () => disc('w', '244,247,250'), H_ = () => disc('h', '255,255,255', 0.2), S_ = () => disc('s', '104,132,162', 0.3);
  // комья валика по дуге a0..a1 (детерминированы от места), размер — от глубины
  function lumps(g, x, y, rx, ry, a0, a1, deep, k, sd, al, nn, sz = 1) {
    const n = nn || 5 + Math.round(deep * 4), rn = () => (sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296, W = W_(), Hh = H_();
    for (let i = 0; i < n; i++) {
      const a = a0 + (a1 - a0) * (i + 0.5 + (rn() - 0.5) * 0.5) / n, px = x + Math.cos(a) * rx, py = y + Math.sin(a) * ry, rad = (2.2 + 2.4 * deep) * (0.75 + 0.5 * rn()) * sz;
      blit(g, W, px, py, rad * 1.35, rad * 0.8, al * k);
      blit(g, Hh, px - rad * 0.3, py - rad * 0.32, rad * 0.7, rad * 0.36, 0.55 * al * k);
    }
  }
  // валик ямы — спрайт (вид × глубина ступенями × масштаб кадра): 1 drawImage на тело вместо ~40
  const RIM = new Map();
  const scaleOf = g => { const t = g.getTransform ? g.getTransform() : null, s = t ? Math.hypot(t.a, t.b) : 1; return Math.max(1, Math.min(4, Math.pow(2, Math.round(Math.log2(s || 1))))); }; // ≤ ×4: валик и колея мягкие, память — ≤ ~0.2 МБ на спрайт
  function rimSprite(side, rx, ry, deep, S) {
    const qr = Math.round(rx * 2) / 2, qd = Math.round(deep * 6) / 6, key = side + qr + ':' + ry + ':' + qd + '@' + S;
    let e = RIM.get(key); if (e) return e;
    const bx = -(qr * 1.45 + 9), by = -(ry * 1.6 + 9), bw = -2 * bx, bh = ry * 3.4 + 22, c = document.createElement('canvas');
    c.width = Math.ceil(bw * S); c.height = Math.ceil(bh * S); const g = c.getContext('2d'); g.scale(S, S); g.translate(-bx, -by);
    if (side === 'b') {
      blit(g, S_(), 0, -ry * 0.1, qr * 1.15, ry * 1.25, 0.28 + 0.2 * qd);
      lumps(g, 0, -0.4, qr + 0.6, ry + 0.4, Math.PI * 1.08, Math.PI * 1.92, qd, 1, 0x51A3, 0.75);
    } else {
      g.globalAlpha = 0.3; g.strokeStyle = '#5d7a96'; g.lineWidth = 1.6 + 1.2 * qd; g.beginPath(); g.ellipse(0, -1, qr * 0.9, ry * 0.85, 0, 0.2, Math.PI - 0.2); g.stroke();
      blit(g, S_(), 0, ry * 0.9 + 1.2, qr * 1.35, ry * 0.95 + 1.5, 0.22 + 0.12 * qd);
      lumps(g, 0, 0.2, qr + 0.8, ry + 0.9, Math.PI * 0.02, Math.PI * 0.98, qd, 1, 0x7F31, 0.95);
    }
    e = { c, bx, by, bw, bh }; RIM.set(key, e); if (RIM.size > 64) RIM.delete(RIM.keys().next().value);
    return e;
  }
  // валик по размеру ямы (rx/ry меняются плавно — ширина по разносу стоп): спрайт ступенями 1 / 0.5 px, рисуется растянутым до точного
  function rim(g, L, side, k) {
    const qx = Math.max(4, Math.round(L.rx)), qy = Math.max(2, Math.round(L.ry * 2) / 2), e = rimSprite(side, qx, qy, Math.min(1, L.px / 26), scaleOf(g)), sx = L.rx / qx, sy = L.ry / qy;
    g.globalAlpha = k; g.drawImage(e.c, L.cx + e.bx * sx, L.cy + e.by * sy, e.bw * sx, e.bh * sy); g.globalAlpha = 1;
  }
  // воротник у голени (gfx: человек в снегу): полудуга мелких комьев вокруг ноги на линии снега; 'b' — задняя (до ноги), 'f' — передняя
  function collar(g, x, y, rx, side, deep) {
    if (STC) return;
    const S = scaleOf(g), qr = Math.max(1.5, Math.round(rx * 2) / 2), qd = Math.round(Math.min(1, deep) * 3) / 3, key = 'c' + side + qr + ':' + qd + '@' + S;
    let e = RIM.get(key);
    if (!e) {
      const ry = 0.9 + 0.22 * qr, bx = -(qr + 3.5), by = -(ry + 3.5), bw = -2 * bx, bh = -2 * by, c = document.createElement('canvas');
      c.width = Math.ceil(bw * S); c.height = Math.ceil(bh * S); const cg = c.getContext('2d'); cg.scale(S, S); cg.translate(-bx, -by);
      if (side === 'b') lumps(cg, 0, -0.1, qr, ry, Math.PI * 1.08, Math.PI * 1.92, qd, 1, 0x2C17, 0.8, 3, 0.45);
      else { blit(cg, S_(), 0, ry * 0.7, qr * 1.15, ry + 0.6, 0.16 + 0.1 * qd); lumps(cg, 0, 0.15, qr + 0.2, ry + 0.2, Math.PI * 0.06, Math.PI * 0.94, qd, 1, 0x6E41, 0.95, 4, 0.45); }
      e = { c, bx, by, bw, bh }; RIM.set(key, e); if (RIM.size > 64) RIM.delete(RIM.keys().next().value);
    }
    g.drawImage(e.c, x + e.bx, y + e.by, e.bw, e.bh);
  }
  // словарь C (js/style.js): яма — полость тоном тени, бровка — линия туши, валик — бумага; колея — тень с кромками тушью
  const STC = typeof Style !== 'undefined' && Style.flat;
  function backC(g, L) { g.fillStyle = Style.P.shade; g.beginPath(); g.ellipse(L.cx, L.cy - L.ry * 0.1, L.rx * 1.05, L.ry * 1.1, 0, 0, TAU); g.fill(); }
  function frontC(g, L) {
    const x = L.cx, y = L.cy, rx = L.rx + 3, ry = L.ry + 2;
    if (L.px >= 10) { g.fillStyle = Style.P.paper; g.beginPath(); g.ellipse(x, y + 1, rx, ry, 0, 0, Math.PI); g.quadraticCurveTo(x, y - ry * 0.55, x + rx, y + 1); g.fill(); }   // глубоко — валик закрывает тело; мелко — только бровка (тень у ног видна)
    g.strokeStyle = Style.P.ink; g.lineWidth = Style.lw(); g.lineCap = 'round'; g.beginPath(); g.moveTo(x - rx, y + 1); g.quadraticCurveTo(x, y - ry * 0.55, x + rx, y + 1); g.stroke();   // бровка — главный разрыв формы
  }
  // задняя часть ямы (до фигуры): синеватая полость в тени и задний валик
  function back(g, L) {
    if (L.mode !== 'snow') return;
    if (STC) { if (L.px >= 3) backC(g, L); return; }
    rim(g, L, 'b', Math.min(1, L.px / 6));
  }
  // передний валик (после фигуры): тень на теле у среза, комья валика (светлый верх), синеватая тень под валиком
  function front(g, L) {
    const x = L.cx, y = L.cy, rx = L.rx, ry = L.ry;
    if (L.mode === 'water') { // вода: кольцо ряби у тела
      const t = typeof now === 'number' ? now : 0;
      g.strokeStyle = 'rgba(214,232,244,0.75)'; g.lineWidth = 1.1;
      for (let i = 0; i < 2; i++) { const u = (t * 0.9 + i * 0.5) % 1; g.globalAlpha = 0.8 * (1 - u); g.beginPath(); g.ellipse(x, y, rx * (1 + u * 1.3), ry * (1 + u * 1.3), 0, 0, TAU); g.stroke(); }
      g.globalAlpha = 0.9; g.strokeStyle = '#eef6fb'; g.lineWidth = 1.4; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0.1, Math.PI - 0.1); g.stroke();
      g.globalAlpha = 1; return;
    }
    if (L.mode !== 'snow') return;
    if (STC) { if (L.px >= 4) frontC(g, L); return; }
    rim(g, L, 'f', Math.min(1, L.px / 5));
  }
  // печь куска колеи r[a..b] в спрайт (мир → px × S)
  const TSP = new WeakMap();
  function bakeChunk(r, a, b, w, S, dk) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (let k = a; k <= b; k++) { const q = r[k]; x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
    const m = w * 1.6 + 4; x0 = Math.floor(x0 - m); y0 = Math.floor(y0 - m); x1 = Math.ceil(x1 + m); y1 = Math.ceil(y1 + m);
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil((x1 - x0) * S)); c.height = Math.max(1, Math.ceil((y1 - y0) * S));
    const g = c.getContext('2d'); g.scale(S, S); g.translate(-x0, -y0); g.lineCap = 'round'; g.lineJoin = 'round';
      // колея — многоугольник с рваным краем: дальняя (северная) стенка освещена, ближняя — в синей тени; по краям — светлые валики
      const E0 = [], E1 = [];
      for (let k = a; k <= b; k++) {
        const q = r[k]; let nx = -Math.sin(q.a), ny = Math.cos(q.a); if (ny < 0 || (ny === 0 && nx < 0)) { nx = -nx; ny = -ny; } // n — к камере (юг)
        const h = ((q.x * 7.13 + q.y * 3.71) | 0) & 1023, ti = k === 0 || k === r.length - 1 ? 0.55 : k === 1 || k === r.length - 2 ? 0.8 : 1, hw = w * 0.5 * ti * (0.72 + (h & 31) / 60), hn = w * 0.5 * ti * (0.72 + (h >> 5) / 60);
        E0.push(q.x - nx * hw, q.y - ny * hw * 0.8, q.x, q.y); E1.push(q.x + nx * hn, q.y + ny * hn * 0.8, nx, ny);
      }
      const band = (t0, t1) => { g.beginPath(); for (let k = 0; k < E0.length; k += 4) { const x = E1[k] + (E0[k] - E1[k]) * t1, y = E1[k + 1] + (E0[k + 1] - E1[k + 1]) * t1; k ? g.lineTo(x, y) : g.moveTo(x, y); }
        for (let k = E0.length - 4; k >= 0; k -= 4) g.lineTo(E1[k] + (E0[k] - E1[k]) * t0, E1[k + 1] + (E0[k + 1] - E1[k + 1]) * t0); g.closePath(); g.fill(); };
      g.globalAlpha = 0.55; g.fillStyle = '#8ea6be'; band(0, 1);        // дно в тени
      if (dk > 0.02) { g.globalAlpha = 0.5 * dk; g.fillStyle = '#4d6a88'; band(0.12, 0.6); } // глубокая колея — тёмное дно
      g.globalAlpha = 0.5; g.fillStyle = '#c9d7e4'; band(0.62, 1);     // дальняя стенка — на свету
      g.globalAlpha = 0.4; g.fillStyle = '#5f7f9c'; band(0, 0.3);      // ближняя — в тени
      g.globalAlpha = 0.55; g.strokeStyle = '#ffffff'; g.lineWidth = 0.8; g.beginPath(); for (let k = 0; k < E0.length; k += 4) k ? g.lineTo(E0[k], E0[k + 1] - 0.4) : g.moveTo(E0[k], E0[k + 1] - 0.4); g.stroke();
      // валики за краями — комья (через точку): свет сверху, тень под ближним
      const Wd = W_(), Hd = H_(), Sd = S_();
      for (let k = a, m = 0; k <= b; k += 2, m += 8) {
        const q = r[k], nx = E1[m + 2], ny = E1[m + 3], h = ((q.x * 5.1 + q.y * 9.3) | 0) & 1023;
        for (const sd of [-1, 1]) {
          const jj = 0.7 + ((sd < 0 ? h & 31 : h >> 5) / 55), bx = q.x + nx * sd * w * 0.78, by = q.y + ny * sd * w * 0.66, rad = w * 0.36 * jj;
          if (sd > 0) blit(g, Sd, bx, by + rad * 0.6, rad * 1.3, rad * 0.55, 0.2);
          blit(g, Wd, bx, by, rad * 1.3, rad * 0.6, 0.85);
          blit(g, Hd, bx - rad * 0.2, by - rad * 0.22, rad * 0.65, rad * 0.26, 0.5);
        }
      }
    g.globalAlpha = 1;
    return { c, n: b - a, S, x0, y0, bw: x1 - x0, bh: y1 - y0 };
  }
  // яма на месте провала — спрайт (печётся раз на яму × масштаб): валик комьями, светлая бровка, воронка с тёмной стенкой и дном
  function bakePit(q, S) {
    const r = q.r, dk = sm(PIT0 - 10, 142, q.d), m = r * 1.7 + 6, c = document.createElement('canvas');
    c.width = Math.ceil(m * 2 * S); c.height = Math.ceil(m * S); const g = c.getContext('2d'); g.scale(S, S); g.translate(m, m * 0.5);
    const rx = r, ry = r * 0.42, W = W_(), Hh = H_(), Sd = S_();
    blit(g, Sd, 0, ry * 0.5, rx * 1.6, ry * 1.7, 0.3);                                   // синеватая тень от выброса
    lumps(g, 0, -0.5, rx * 1.18, ry * 1.25, Math.PI * 1.02, Math.PI * 1.98, dk, 1, (q.x * 7 + q.y * 13) | 0, 0.9); // задний валик
    g.globalAlpha = 0.9; g.fillStyle = '#b9cadb'; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU); g.fill(); // дальняя стенка на свету
    const gr = g.createLinearGradient(0, -ry, 0, ry); gr.addColorStop(0, 'rgba(120,146,172,0.25)'); gr.addColorStop(0.5, `rgba(78,104,134,${0.55 + 0.3 * dk})`); gr.addColorStop(1, `rgba(52,74,100,${0.7 + 0.25 * dk})`);
    g.fillStyle = gr; g.beginPath(); g.ellipse(0, ry * 0.22, rx * 0.86, ry * 0.78, 0, 0, TAU); g.fill(); // стенка в тени и дно
    g.globalAlpha = 0.9; g.strokeStyle = '#ffffff'; g.lineWidth = 0.9; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, Math.PI * 1.06, Math.PI * 1.94); g.stroke(); // бровка
    g.globalAlpha = 0.45; g.strokeStyle = '#5d7a96'; g.lineWidth = 1.2; g.beginPath(); g.ellipse(0, -0.3, rx * 0.95, ry * 0.9, 0, 0.15, Math.PI - 0.15); g.stroke(); // ближний срез
    lumps(g, 0, 0.6, rx * 1.12, ry * 1.2, Math.PI * 0.04, Math.PI * 0.96, dk, 1, (q.x * 3 + q.y * 5) | 0, 1); // передний валик
    g.globalAlpha = 1; return { c, S, d: q.d, m };
  }
  // траншеи в кадре: тёмная колея (шире и темнее по глубине), светлые валики по краям; ямы; заметает (alpha по жизни). low — линиями
  function trenches(g, view) {
    if (!TR.length && !PT.length && !DG.length) return 0;
    const [x0, y0, x1, y1] = view, lo = low(); let n = 0;
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const q of PT) {
      if (q.x < x0 - 40 || q.x > x1 + 40 || q.y < y0 - 40 || q.y > y1 + 40) continue;
      const al = Math.min(1, q.life / q.max * 1.4); if (al < 0.03) continue;
      if (STC) { const rx = q.r, ry = q.r * 0.42; g.globalAlpha = al; g.fillStyle = Style.P.paper; g.beginPath(); g.ellipse(q.x, q.y + 1, rx * 1.18, ry * 1.3, 0, 0, TAU); g.fill();
        g.fillStyle = Style.P.shade; g.beginPath(); g.ellipse(q.x, q.y, rx, ry, 0, 0, TAU); g.fill();
        g.strokeStyle = Style.P.ink; g.lineWidth = Style.lw(); g.beginPath(); g.ellipse(q.x, q.y, rx, ry, 0, Math.PI * 1.02, Math.PI * 1.98); g.stroke(); n++; continue; }
      if (lo) { const rx = q.r, ry = q.r * 0.42; g.globalAlpha = 0.6 * al; g.fillStyle = '#5f7c99'; g.beginPath(); g.ellipse(q.x, q.y + ry * 0.2, rx * 0.85, ry * 0.8, 0, 0, TAU); g.fill();
        g.globalAlpha = 0.85 * al; g.strokeStyle = '#f4f7fa'; g.lineWidth = 2.4; g.beginPath(); g.ellipse(q.x, q.y, rx * 1.12, ry * 1.2, 0, 0, TAU); g.stroke(); n++; continue; }
      const S = scaleOf(g); let e = TSP.get(q);
      if (!e || e.S !== S || e.d !== q.d) { e = bakePit(q, S); TSP.set(q, e); }
      g.globalAlpha = al; g.drawImage(e.c, q.x - e.m, q.y - e.m * 0.5, e.m * 2, e.m); n++;
    }
    for (const r of RUNS.values()) {
      // ран — кусками по 6 точек (общая прозрачность — по средней жизни), разрыв при скачке > 24 px; только видимые
      for (let a = 0; a < r.length - 1; a += 6) {
        let b = Math.min(r.length - 1, a + 6); const q0 = r[a];
        if (q0.x < x0 - 40 || q0.x > x1 + 40 || q0.y < y0 - 40 || q0.y > y1 + 40) continue;
        for (let k = a + 1; k <= b; k++) if (Math.abs(r[k].x - r[k - 1].x) + Math.abs(r[k].y - r[k - 1].y) > 24) { b = k - 1; break; }
        if (b <= a) continue;
        let life = 0, dd = 0; for (let k = a; k <= b; k++) { life += r[k].life / r[k].max; dd += r[k].d; } life /= b - a + 1; dd /= b - a + 1;
        const al = Math.min(1, life * 1.4) * Math.min(1, dd / 50), w = q0.w * (0.75 + 0.35 * Math.min(1, dd / 70) + 0.25 * sm(70, 140, dd)), dk = Math.round(sm(60, 140, dd) * 4) / 4;
        if (al < 0.03) continue;
        if (STC) { // C: полоса тоном тени, по краям — кромки тушью (нормаль к ходу)
          g.globalAlpha = al; g.strokeStyle = Style.P.shade; g.lineWidth = w * 0.8; g.beginPath(); g.moveTo(q0.x, q0.y); for (let k = a + 1; k <= b; k++) g.lineTo(r[k].x, r[k].y); g.stroke();
          g.strokeStyle = Style.P.ink; g.lineWidth = Style.lw(1.1); g.beginPath();
          for (const sd of [-1, 1]) for (let k = a; k <= b; k++) { const p0 = r[Math.max(a, k - 1)], p1 = r[Math.min(b, k + 1)], dx = p1.x - p0.x, dy = p1.y - p0.y, l = Math.hypot(dx, dy) || 1, ox = -dy / l * w * 0.42 * sd, oy = dx / l * w * 0.36 * sd; k === a ? g.moveTo(r[k].x + ox, r[k].y + oy) : g.lineTo(r[k].x + ox, r[k].y + oy); }
          g.stroke(); n++; continue;
        }
        if (lo) { // low: полоса — две линии (дно, светлый дальний край)
          g.globalAlpha = al * (0.5 + 0.25 * dk); g.strokeStyle = '#7f98b2'; g.lineWidth = w * 0.75; g.beginPath(); g.moveTo(q0.x, q0.y); for (let k = a + 1; k <= b; k++) g.lineTo(r[k].x, r[k].y); g.stroke();
          g.globalAlpha = al * 0.7; g.strokeStyle = '#f4f7fa'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(q0.x, q0.y - w * 0.4); for (let k = a + 1; k <= b; k++) g.lineTo(r[k].x, r[k].y - w * 0.4); g.stroke();
          n++; continue;
        }
        // кусок колеи — спрайт (печётся раз; дальше — прозрачностью по жизни): многоугольник с рваным краем, валики-комья
        const tail = b >= r.length - 2 || a === 0, S = scaleOf(g);
        let e = TSP.get(q0);
        if (!e || e.n !== b - a || e.S !== S || e.tail !== tail || e.dk !== dk) { e = bakeChunk(r, a, b, w, S, dk); e.tail = tail; e.dk = dk; TSP.set(q0, e); }
        g.globalAlpha = al; g.drawImage(e.c, e.x0, e.y0, e.bw, e.bh);
        n++;
      }
    }
    g.globalAlpha = 1;
    // разгребы: кольцо отброшенного снега
    for (const q of DG) if (q.x > x0 - 40 && q.x < x1 + 40 && q.y > y0 - 40 && q.y < y1 + 40) {
      const al = q.k * Math.min(1, q.life / 40);
      if (STC) { g.globalAlpha = al; g.fillStyle = Style.P.shade; g.beginPath(); g.ellipse(q.x, q.y + 1, q.r * 0.7, q.r * 0.26, 0, 0, TAU); g.fill(); g.strokeStyle = Style.P.ink; g.lineWidth = Style.lw(1.1); g.beginPath(); g.ellipse(q.x, q.y, q.r * 0.82, q.r * 0.33, 0, Math.PI, TAU); g.stroke(); g.globalAlpha = 1; continue; }
      g.globalAlpha = 0.35 * al; g.fillStyle = '#8fa7c0'; g.beginPath(); g.ellipse(q.x, q.y + 1, q.r * 0.7, q.r * 0.26, 0, 0, TAU); g.fill();
      g.globalAlpha = 0.6 * al; g.strokeStyle = '#f6f9fc'; g.lineWidth = 3; g.beginPath(); g.ellipse(q.x, q.y, q.r * 0.82, q.r * 0.33, 0, 0, TAU); g.stroke(); g.globalAlpha = 1;
    }
    return n;
  }
  const art = { back, front, trenches, collar };

  function stats() {
    let n = 0; for (const b of BL) if (b) n++;
    return { blocks: n, kb: +(n * BS * BS / 1024).toFixed(1), maxKb: +(BX * BY * BS * BS / 1024).toFixed(0), buildMs: +buildMs.toFixed(2), trench: TR.length, digs: DG.length, pits: PT.length, cell: C };
  }
  return {
    depthAt, crustAt, sinkAt, sinkOf, heroMul, rideMul, tickHero, tick, drag, settle, steer, dig, effort, look, art, stats, KIND, PX, BASE, mulHuman, mulKind,
    get heroSink() { return HS.s; }, get heroSnow() { return HS.snow; }, get climb() { return CL ? Math.min(1, CL.t / CLB.dur) : -1; }, get outT() { return HS.out; },
    brush() { HS.snow *= 0.35; }, bareIce, CLB, get pits() { return PT; }, set hold(v) { hold = v ? 1 : 0; }, get trenchList() { return TR; }, reset() { gKey = null; ensure(); },
  };
})();
