'use strict';
// Дополнительные позы людей: мелкая возня героя, ходьба по ситуации, реакции, новые действия.
// Регистрируются в ArtPeople.register(name, { fn(o, t, a, ph, sp, H), dur, loop, loco, free }); H — помощники рига.
// Координаты рига: x — вперёд по взгляду, y вверх — минус; стопы y≈−2. Таз P.hy — в «сырой» шкале поз (стоя −17.2),
// на экране H.hipY(P.hy) ≈ −20 (ноги ≈48 % роста); плечо ≈(0.5, −33) = таз − H.SHO; голова — H.head().
// o.target {x,y} (в тех же координатах) — куда тянутся руки/топор/нога; без него — значения по умолчанию у каждой позы.
(function () {
  if (typeof ArtPeople === 'undefined' || !ArtPeople.register) return;
  const AP = ArtPeople, H = AP.H, P = H.P, PI = Math.PI;
  const { lerp, sm, clamp, seg, shoulder, handA, handR } = H;
  const sin = Math.sin, cos = Math.cos, hyp = Math.hypot;
  const SH = H.SHO, HY = H.hipY, hip = H.hip;   // плечо над тазом; таз на экране из «сырой» шкалы; таз текущей позы на экране
  const R = (name, spec) => AP.register(name, spec);

  // ---------- помощники ----------
  // огибающая: нарастание a0→a1, спад a2→a3
  const env = (a, a0, a1, a2, a3) => sm((a - a0) / (a1 - a0)) * (1 - sm((a - a2) / (a3 - a2)));
  const bump = (a, a0, a1) => (a > a0 && a < a1 ? sin(PI * (a - a0) / (a1 - a0)) : 0);
  // ключи [[a, v], ...] с плавным переходом между соседними
  function key(a, K) {
    if (a <= K[0][0]) return K[0][1];
    for (let i = 1; i < K.length; i++) if (a <= K[i][0]) return lerp(K[i - 1][1], K[i][1], sm((a - K[i - 1][0]) / (K[i][0] - K[i - 1][0])));
    return K[K.length - 1][1];
  }
  const R0 = H.REST[0], R1 = H.REST[1], RR = H.RR;   // кисти в покое относительно плеча (как idle: рука почти прямая, варежка у бедра); RR — плечо→кисть в покое
  // кисть i к точке (dx,dy) от плеча с весом w (0 — покой)
  function hand(i, dx, dy, w) { const r = i ? R1 : R0; handR(i, lerp(r[0], dx, w), lerp(r[1], dy, w)); }
  // кисть i к абсолютной точке с весом w
  function handAt(i, x, y, w) { hand(i, x - P.sx, y - P.sy, w); }
  function body(lean, hy, hx) { P.lean = lean; P.hy = hy; if (hx != null) P.hx = hx; shoulder(); }
  // точка у головы: fw — вперёд по взгляду, up — вверх от центра головы (рот ≈ (3.5, −2.3))
  // голова стала меньше (этап 3): смещения от центра — в долях прежней головы (×0.65)
  function headPt(fw, up) {
    const [cx, cy, ang] = H.head(); fw *= 0.65; up *= 0.65;
    return [cx + cos(ang) * fw + sin(ang) * up, cy + sin(ang) * fw - cos(ang) * up];
  }
  // топор/пила/удочка за поясом на спине, когда обе руки заняты
  // в виде спереди (к камере) инструмент за спиной не виден — не рисуем, иначе ляжет поперёк лица / торчит над головой
  function stow(o, loco) {
    const k = o.tool; if (k !== 'axe' && k !== 'saw' && k !== 'rod') return;
    if (H.belt && H.belt(k)) return;   // варианты героя: топор за поясом у бедра (место считает рендер от итоговой позы)
    const vf = H.view() === 1 ? o.vy || 0 : 0;
    if (vf > (loco ? 0.3 : 0.7)) return;   // работа почти лицом к камере: топорище торчало бы над головой
    const c = cos(P.lean), s = sin(P.lean);
    P.tk = k; P.tox = P.hx - c * 4.2 - s * 1.5; P.toy = hip() - s * 4.2 + c * 1.5; P.ta = -PI / 2 + P.lean - (k === 'rod' ? 0.55 : 0.32); P.two = 0;
  }
  const tgt = (o, x, y) => (o.target && isFinite(o.target.x) && isFinite(o.target.y) ? o.target : { x, y });
  // присед с наклоном: k 0 — стоя с наклоном, 1 — на корточках
  const bx = k => -2.2 * k, by = k => lerp(-16.6, -7.6, k), bl = k => lerp(0.3, 0.74, k);
  function bendK(T, d, k0) {
    for (let k = k0 || 0; k < 1; k += 0.03) { const l = bl(k); if (hyp(T.x - bx(k) - sin(l) * SH, T.y - HY(by(k)) + cos(l) * SH) <= d) return k; }
    return 1;
  }
  // поза от покоя (w=0) к приседу k (w=1)
  function bend(k, w) { body(lerp(0.04, bl(k), w), lerp(-17.2, by(k), w), lerp(0, bx(k), w)); }
  // наименьший наклон, при котором плечо достаёт до T (не дальше d)
  function reachLean(T, hx, hy, l0, d) {
    for (let l = l0; l < 1.1; l += 0.03) if (hyp(T.x - hx - sin(l) * SH, T.y - HY(hy) + cos(l) * SH) <= d) return l;
    return 1.1;
  }
  // руки обнимают корпус (скрещены на груди)
  function hug(w, j) { hand(0, 5.4 + (j || 0), 6, w); hand(1, 5.9, 5.1 - (j || 0) * 0.6, w); P.hl0 = lerp(6.6, 2.4, w); P.hl1 = lerp(6.6, 2.2, w); }
  const seedOf = o => o.seed || 0;

  // ================= мелкая возня (разовые) =================
  R('stamp', { dur: 1.2, fn(o, t, a) {
    H.idle(o, t); stow(o);
    const w = env(a, 0, 0.12, 0.86, 1);
    let dip = 0, sh = 0;
    for (const [a0, a1, i] of [[0.08, 0.36, 0], [0.37, 0.63, 1], [0.64, 0.9, 0]]) {
      if (a < a0 || a > a1) continue;
      const u = (a - a0) / (a1 - a0), lift = u < 0.55 ? sm(u / 0.55) * 3.4 : u < 0.72 ? 3.4 * (1 - ((u - 0.55) / 0.17) ** 2) : 0;
      dip = bump(u, 0.7, 1); sh = (i ? 0.7 : -0.7) * sm(u / 0.4) * (1 - sm((u - 0.8) / 0.2));
      if (i) { P.f1y = -2 - lift; P.f1x += lift * 0.2; P.f1a = lift * 0.07; } else { P.f0y = -2 - lift; P.f0x += lift * 0.2; P.f0a = lift * 0.07; }
    }
    body(0.04 + 0.1 * w + dip * 0.03, -17.2 + dip * 0.9 + 0.3 * w, sh);
    hug(w, 0.3 * dip); P.tilt = 0.18 * w + 0.06 * dip; P.hb = dip * 0.9;
  } });

  R('rubHands', { dur: 1.4, fn(o, t, a) {
    H.idle(o, t); stow(o);
    const w = env(a, 0, 0.2, 0.8, 1), r = env(a, 0.18, 0.26, 0.74, 0.82), q = sin(t * 17);
    body(0.04 + 0.1 * w, -17.2 - 0.35 * w + 0.15 * r * Math.abs(q));
    hand(0, 6.2 + 1.4 * q * r, 6.6 + 0.4 * cos(t * 17) * r, w); hand(1, 6.8 - 1.4 * q * r, 6.1, w);
    P.hl0 = lerp(6.6, 1.8, w); P.hl1 = lerp(6.6, 1.6, w);
    P.tilt = 0.24 * w; P.hb = 0.25 * q * r;
  } });

  R('blowHands', { dur: 1.2, fn(o, t, a) {
    H.idle(o, t); stow(o);
    const w = env(a, 0, 0.22, 0.82, 1), blow = bump(a, 0.3, 0.5) + bump(a, 0.56, 0.78), inh = bump(a, 0.16, 0.32) + bump(a, 0.48, 0.58);
    body(0.07 * w - 0.03 * blow, -17.2 - 0.3 * w - 0.45 * inh);
    P.tilt = 0.1 * w - 0.05 * inh; P.br = inh - blow;
    const M = headPt(5.2, -2.3);
    handAt(0, M[0] + 0.4, M[1] + 0.9, w); handAt(1, M[0] + 1.3, M[1] + 2, w);
    P.hl0 = lerp(6.6, 1.5, w); P.hl1 = lerp(6.6, 1.5, w);
    P.mouth = blow > 0.15 ? 0.5 + 0.4 * blow : 0; P.eyes = blow > 0.4 ? 1 : 0; P.hb = -0.4 * inh;
  } });

  R('adjustPack', { dur: 1.0, fn(o, t, a) {
    H.idle(o, t); stow(o);
    const w = env(a, 0, 0.2, 0.75, 1), shrug = bump(a, 0.3, 0.56), drop = bump(a, 0.56, 0.78);
    body(0.04 - 0.06 * shrug + 0.05 * drop, -17.2 - 1.1 * shrug + 0.45 * drop);
    hand(0, 3.2, 3.2 + 3 * bump(a, 0.28, 0.48) + 1.8 * bump(a, 0.5, 0.66), w); P.hl0 = lerp(6.6, 4, w);
    hand(1, R1[0] - 0.4, R1[1] - 0.6 - 1.4 * shrug, 1);
    P.tilt = -0.06 * shrug + 0.12 * drop; P.hb = -shrug * 0.8 + drop * 0.5;
  } });

  R('lookAround', { dur: 2.0, fn(o, t, a) {
    H.idle(o, t); stow(o);
    P.tilt = key(a, [[0, 0], [0.12, -0.3], [0.3, -0.26], [0.42, 0.24], [0.54, 0.2], [0.64, -0.12], [0.86, -0.1], [1, 0]]);
    body(key(a, [[0, 0.04], [0.12, -0.04], [0.3, -0.03], [0.42, 0.11], [0.54, 0.1], [0.64, 0.09], [0.86, 0.08], [1, 0.04]]), -17.2 - 0.3 * env(a, 0.55, 0.65, 0.85, 0.95),
      key(a, [[0, 0], [0.3, -0.7], [0.5, 0.6], [0.86, 0.4], [1, 0]]));
    const w = env(a, 0.52, 0.64, 0.84, 0.96), E = headPt(4.6, 2.6);
    handAt(0, E[0], E[1], w); P.hl0 = lerp(6.6, 3, w);
    hand(1, R1[0] - 0.6, R1[1] - 0.4, 1);
    P.hb = 0.4 * sin(a * PI * 3);
  } });

  R('brushSnow', { dur: 1.0, fn(o, t, a) {
    H.idle(o, t); stow(o);
    const w = env(a, 0, 0.18, 0.8, 1), s = seg(a, 0.18, 0.8) * 3, u = s % 1, st = s >= 3 ? 1 : u;
    body(0.07 * w, -17.2);
    P.tilt = 0.34 * w;
    let dx, dy;
    if (st < 0.55) { const e = sm(st / 0.55); dx = lerp(2.2, 5.6, e); dy = lerp(0.2, 6, e); }
    else { const e = sm((st - 0.55) / 0.45); dx = lerp(5.6, 2.2, e); dy = lerp(6, 0.2, e) - 1.4 * sin(e * PI); }
    hand(0, dx, dy, w); P.hl0 = lerp(6.6, 2, w);
    P.hb = 0.3 * sin(s * PI * 2) * w;
  } });

  R('stretch', { dur: 1.4, fn(o, t, a) {
    H.idle(o, t); stow(o);
    // руки вверх через перёд и назад за голову — и обратно тем же путём (без полного оборота плеча)
    const s = env(a, 0.2, 0.45, 0.6, 0.86), K = [[0, 1.46], [0.35, -1.65], [0.6, -2.35], [0.8, -1.3], [1, 1.46]];
    const tr = 0.03 * sin(t * 31) * env(a, 0.4, 0.45, 0.58, 0.62), rr = 12.2 + 1.7 * s;   // на подъёме/спуске локоть согнут, в растяжке — прямые руки
    P.f0y = P.f1y = -2 - 1.1 * s; P.f0a = P.f1a = 0.45 * s;
    body(0.04 - 0.17 * s, -17.2 - 1.1 * s);
    handA(0, key(a, K) + tr, lerp(RR, rr, env(a, 0, 0.15, 0.85, 1))); handA(1, key(clamp(a - 0.04, 0, 1), K) - tr, lerp(RR, rr, env(a, 0.04, 0.19, 0.89, 1)));
    P.hl0 = P.hl1 = 6.6 + 1.5 * s;
    P.tilt = -0.36 * s; P.eyes = s > 0.5 ? 1 : 0; P.mouth = 0.45 * env(a, 0.35, 0.45, 0.55, 0.65); P.br = s;
  } });

  R('wipeNose', { dur: 0.8, fn(o, t, a) {
    H.idle(o, t); stow(o);
    const w = env(a, 0, 0.25, 0.62, 0.92), u = sm(seg(a, 0.25, 0.55)), sn = bump(a, 0.58, 0.86);
    P.tilt = 0.14 * bump(a, 0.18, 0.58) - 0.16 * sn;
    body(0.06 * w + 0.02 * sn, -17.2 - 0.3 * sn);
    const N = headPt(5, -1);
    handAt(0, lerp(N[0] - 2.6, N[0] + 3.4, u), lerp(N[1] + 1.8, N[1] - 0.2, u), w); P.hl0 = lerp(6.6, 2, w);
    P.eyes = u > 0.1 && u < 0.95 ? 1 : 0; P.hb = -0.4 * sn;
  } });

  R('shiver', { loop: true, fn(o, t) {
    const fr = clamp(o.frost == null ? 0.5 : o.frost, 0, 1), A = 0.35 + 0.9 * fr, s0 = seedOf(o);
    const j = sin(t * 47), j2 = sin(t * 53 + 1), shud = Math.pow(Math.max(0, sin(t * 2.3 + s0)), 24);
    P.f0x = 0.7; P.f1x = -0.9; P.br = sin(t * 2.6);
    body(0.18 + 0.02 * j * A + 0.03 * shud, -16.4 + 0.22 * j2 * A - shud * 0.5, 0.2 * j * A);
    hug(1, 0.35 * j2 * A); stow(o);
    P.tilt = 0.28 + 0.03 * j * A - 0.05 * shud; P.hb = 0.35 * j2 * A + shud * 0.4;
    P.mouth = fr > 0.4 && sin(t * 29) > 0.3 ? 0.25 : 0; P.eyes = shud > 0.5 ? 1 : 0;
  } });

  R('yawn', { dur: 1.6, fn(o, t, a) {
    H.idle(o, t); stow(o);
    const wu = env(a, 0.1, 0.38, 0.62, 0.86), hb = env(a, 0.14, 0.4, 0.6, 0.8), nod = bump(a, 0.76, 1);
    P.tilt = -0.46 * hb + 0.18 * nod;
    body(0.04 - 0.1 * hb + 0.03 * nod, -17.2 - 0.6 * hb);
    handA(0, lerp(1.46, -1.9, wu), lerp(RR, 13.6, wu)); P.hl0 = 6.6 + wu;
    hand(1, 1.5, 10.2, hb);
    P.mouth = env(a, 0.2, 0.34, 0.62, 0.76); P.eyes = hb > 0.3 || (nod > 0.3 && nod < 0.8) ? 1 : 0; P.br = hb; P.hb = 0.5 * nod;
  } });

  // ================= ходьба по ситуации (циклы) =================
  // шаг тот же, что у walk (stride), иначе ноги скользят относительно пройденного пути
  const St = sp => H.stride('walk', sp);

  // глубокий снег: высокие колени, сильный наклон, руки широко для равновесия
  R('trudge', { loop: true, loco: true, free: true, fn(o, t, a, ph, sp) {
    H.gait(ph, St(sp), 0, 1.35, 8);   // колено и бедро в переносе на 35 % выше нормы — ногу вытаскивают из снега
    const c2 = cos(2 * ph);
    // стопа проваливается в снег с задержкой после постановки (до ≈1 px) и выдёргивается в начале переноса — без скачка
    let sink = 0;   // опорная стопа уходит в снег — таз оседает вместе с ней (иначе нога выпрямляется в струну)
    // фигура в снегу на sk px (gfx sunk): переносную стопу вытаскивают из лунки — подъём не меньше глубины провала (до бедра горизонтально), колено высоко
    const sk = H.sink ? H.sink() : 0, up = Math.min(13, sk + 1.2) * (1 - 0.5 * Math.min(1, Math.abs(o.vy || 0)));   // к камере/от камеры подъём уходит в глубину — вдвое меньше
    for (let i = 0; i < 2; i++) {
      const st = i ? P.st1 : P.st0, u = i ? P.u1 : P.u0, q = i ? P.q1 : P.q0;
      const dk = st === 1 ? sm((u - 0.1) / 0.45) : 1 - sm(q / 0.45);
      const kz = 0.8 * (1 - Math.min(1, Math.abs(o.vy || 0))) ** 3;   // к камере/от камеры провал не читается (стопа уходит в глубину) — только боком
      if (i) P.f1y += kz * dk; else P.f0y += kz * dk;
      sink = Math.max(sink, kz * dk);
      if (st !== 1 && up > 2.5) { const e = Math.sin(Math.PI * Math.min(1, q / 0.85)) ** 1.6, fy = -2 - up * e; if (i) P.f1y = Math.min(P.f1y, fy); else P.f0y = Math.min(P.f0y, fy); }
    }
    body(0.3 + 0.03 * c2, P.hy + sink / H.LEN.KL, 0.4);   // колени согнуты в снегу (KB 8°) — таз ниже от самой походки
    // руки шире (hl) и согнуты сильнее — для равновесия, мах с запаздыванием; на скорости (целина ≈115 px/с) — к рукам бега, но шире
    const r = 0.85 * H.runW();
    P.hl0 = P.hl1 = 8.8; H.swingArms(ph - 0.4, 0.26 + 0.06 * sp, 0.4, 0.3, 0.06, r, 0.85);
    P.hl0 = Math.max(P.hl0, 7.2); P.hl1 = Math.max(P.hl1, 7.2);
    P.tilt = -0.1 - 0.02 * c2; P.hb = 1.3 * cos(2 * ph + 0.9); P.mouth = 0.2 + 0.2 * Math.max(0, c2);   // голова гасит кивок корпуса
  } });

  // пурга: ближнее предплечье перед лицом, сгорблен, навстречу ветру
  R('shield', { loop: true, loco: true, fn(o, t, a, ph, sp) {
    H.gait(ph, St(sp), 0, 0.95, 6);
    // порывы: корпус то наваливается на ветер, то его отжимает назад; сбоку — шатает (крен и таз вбок), голова пригибается на ударе
    const sd = seedOf(o), gw = clamp(o.gust || 0, 0, 1), g1 = sin(t * 1.7) * sin(t * 0.63 + sd) + 0.35 * sin(t * 4.3 + sd * 2), g2 = sin(t * 1.13 + sd) * sin(t * 2.9 + 1) + 0.3 * sin(t * 5.1);
    const gk = 1 + gw;
    const sn = sin(ph), gust = 0.07 * gk * g1, r = H.runW();
    body(0.27 + 0.04 * r + gust + 0.02 * cos(2 * ph), P.hy);   // бегом против ветра — ещё ниже к ветру
    P.roll += 0.05 * gk * g2; P.hlat += 0.5 * gk * g2;
    P.tilt = 0.3 - 0.6 * gust - 0.015 * cos(2 * ph);
    const F = headPt(6.2, 0.4);
    // ближняя рука прикрывает лицо — стоя/шагом всё время; бегом — эпизодами в порыв (≈1–2 с, g1 на подъёме), иначе работает как у бега.
    // Шагом в затишье (g1 на пике — корпус проваливается вперёд) на миг опускается к груди и снова вверх
    const gs = sin(t * 1.7) * sin(t * 0.63 + sd), ep = sm((gs + 0.3 * gw - 0.45) / 0.3), cover = lerp(1 - sm((g1 - 0.85) / 0.3), ep, r);
    H.swingArms(ph - 0.35, 0.22, 0.25, 0.25, 0.04, r, 0.9); const rx = P.h0x, ry = P.h0y, rh = P.hl0;
    if (r < 1) { H.armFK(0, 0.32, 1.2); P.h0x = lerp(P.h0x, rx, r); P.h0y = lerp(P.h0y, ry, r); }
    P.h0x = lerp(P.h0x, F[0] + 0.4 * sin(t * 13), cover); P.h0y = lerp(P.h0y, F[1] + 0.3 * sin(t * 11) + 0.4 * cos(2 * ph), cover); P.hl0 = lerp(lerp(4.5, rh, r), 1, cover);
    P.cover = cover;   // доля «рука у лица» (для проверок)
    P.hl1 = lerp(5.5, P.hl1, r);   // дальняя рука — маятник шага, на скорости — рука бега
    stow(o, 1); P.eyes = 1; P.hb = 0.5 * cos(2 * ph + 0.9);
  } });

  // вымотан/голоден: голова свешена, ноги волочатся, руки висят
  R('tired', { loop: true, loco: true, free: true, fn(o, t, a, ph, sp) {
    H.gait(ph, St(sp), 0, 0.75, 2);   // ноги поднимает ниже нормы — волочит; колени чуть подогнуты
    const sn = sin(ph), c2 = cos(2 * ph);
    body(0.24 + 0.03 * c2, P.hy);
    // руки висят и болтаются; на скорости — вялые руки бега: мах короче, локоть всё равно согнут (иначе бег не читается)
    P.hl0 = P.hl1 = 6; H.swingArms(ph, 0.1, 0.12, 0, 0.03, 0.8 * H.runW(), 0.65);
    P.tilt = 0.5 + 0.02 * sin(2 * ph + 1) + 0.05 * sin(t * 0.7); P.hb = 1.2 * cos(2 * ph + 1.5);
    P.eyes = sin(t * 0.9 + seedOf(o)) > 0.75 ? 1 : 0; P.mouth = 0.25;
  } });

  // мёрзнет: руки обнимают корпус, короткий скованный шаг
  R('cold', { loop: true, loco: true, fn(o, t, a, ph, sp) {
    const fr = clamp(o.frost == null ? 0.5 : o.frost, 0, 1);
    H.gait(ph, St(sp), 0, 0.8);   // скованный шаг: колено в переносе ниже нормы
    const j = sin(t * 45) * (0.15 + 0.3 * fr);
    body(0.14 + 0.02 * cos(2 * ph), P.hy, j);
    // руки обнимают корпус; бегом — прижаты, но работают коротким махом бега (обнять себя на бегу нельзя)
    const r = H.runW();
    H.swingArms(ph - 0.35, 0, 0, 0, 0, 1, 0.55); const q = [P.h0x, P.h0y, P.h1x, P.h1y, P.hl0, P.hl1];
    hug(1, 0.3 * sin(2 * ph) + j); stow(o, 1);
    if (r > 0) { const w = 0.85 * r; P.h0x = lerp(P.h0x, q[0], w); P.h0y = lerp(P.h0y, q[1] + j * 0.3, w); P.h1x = lerp(P.h1x, q[2], w); P.h1y = lerp(P.h1y, q[3], w); P.hl0 = lerp(P.hl0, q[4] - 1, w); P.hl1 = lerp(P.hl1, q[5] - 1, w); }
    P.tilt = 0.22 + j * 0.1; P.hb = 0.4 * cos(2 * ph + 0.9) + j;
    P.mouth = fr > 0.5 && sin(t * 29) > 0.4 ? 0.25 : 0;
  } });

  // ================= реакции (разовые) =================
  R('slip', { dur: 0.7, free: true, fn(o, t, a) {
    const sl = sm(seg(a, 0, 0.24)), rec = sm(seg(a, 0.42, 0.85)), dr = sl * (1 - rec);
    P.f0x = lerp(lerp(1.3, 7.8, sl), 1.6, rec); P.f0y = -2 - 3 * bump(a, 0.42, 0.85); P.f0a = -0.35 * dr;
    P.f1x = lerp(-1.6, -3.4, dr); P.f1y = -2; P.f1a = 0;
    body(0.04 - 0.36 * dr + 0.16 * bump(a, 0.5, 0.85), -17.2 + 3 * dr, -1.6 * dr);
    const fl = env(a, 0.04, 0.14, 0.6, 0.88), q = a * 40;
    handA(0, lerp(1.46, -1.1 + 0.9 * sin(q), fl), RR); handA(1, lerp(1.65, -2.3 + 0.9 * sin(q + 2), fl), RR);
    P.hl0 = P.hl1 = 6.6 + 3 * fl;
    P.tilt = -0.32 * dr + 0.12 * bump(a, 0.5, 0.85); P.mouth = 0.7 * dr; P.hb = -dr;
  } });

  R('flinch', { dur: 0.5, free: true, fn(o, t, a) {
    const j = a < 0.1 ? sm(a / 0.1) : 1 - sm((a - 0.25) / 0.75);
    P.f1x = -1.6 - 1.8 * sm(seg(a, 0.02, 0.2)) * (1 - sm(seg(a, 0.6, 0.92))); P.f1y = -2 - 2 * (bump(a, 0.02, 0.2) + bump(a, 0.6, 0.92));
    body(0.04 - 0.22 * j, -17.2 + 0.8 * j, -1.3 * j);
    hand(0, 6.2, -0.5, j); hand(1, 5, 0.8, j * 0.9); P.hl0 = lerp(6.6, 3, j);
    P.tilt = -0.26 * j + 0.05 * sin(a * 18) * (1 - j); P.mouth = 0.6 * j; P.hb = -1.2 * j;
  } });

  R('stagger', { dur: 0.5, free: true, fn(o, t, a) {
    const j = a < 0.08 ? sm(a / 0.08) : 1 - sm((a - 0.15) / 0.85);
    P.f0x = lerp(lerp(1.3, -2.8, sm(seg(a, 0.04, 0.3))), 1.3, sm(seg(a, 0.55, 0.9))); P.f0y = -2 - 2.2 * (bump(a, 0.04, 0.3) + bump(a, 0.55, 0.9));
    body(0.04 - 0.26 * j, -17.2 + 0.6 * j, -1.5 * j);
    hand(0, 7, 5, 0.8 * j); hand(1, 6.5, 6, 0.8 * j);
    P.tilt = -0.5 * j; P.eyes = j > 0.5 ? 1 : 0; P.hb = -j; P.mouth = 0.4 * j;
  } });

  // отпрыгнул (отскок, Shift): толчок с присевших ног → короткий полёт назад-вбок, корпус откинут, руки в стороны → приземление в присед
  R('dodge', { dur: 0.45, free: true, fn(o, t, a) {
    const push = bump(a, 0, 0.18), air = env(a, 0.1, 0.22, 0.5, 0.62), land = bump(a, 0.5, 0.95), j = Math.max(air, 0.6 * land);
    P.f0x = lerp(1.3, -3.2, air) + 0.8 * land; P.f0y = -2 - 3.2 * air; P.f0a = -0.25 * air;
    P.f1x = lerp(-1.6, -5.4, air) - 0.6 * land; P.f1y = -2 - 2.4 * air;
    body(0.04 - 0.3 * air + 0.22 * land + 0.1 * push, -17.2 + 3.2 * push + 2.2 * air + 3.6 * land, -2.4 * air + 0.6 * land);
    P.oy = -3.4 * air;
    hand(0, 7.5, -2.5, 0.9 * j); hand(1, 6.2, -4, 0.85 * j); P.hl0 = lerp(6.6, 8.2, air); P.hl1 = lerp(6.6, 4.4, air);
    P.tilt = -0.3 * air + 0.18 * land; P.mouth = 0.5 * air; P.hb = -air + 0.6 * land; P.eyes = 0;
  } });

  // взять чурку: наклон → касание (a 0.34 — с земли в руку) → к груди → закинуть на рюкзак через плечо → руки в покой
  R('takeChunk', { dur: 1.0, fn(o, t, a) {
    stow(o);
    const T = tgt(o, 8, -2), k = bendK(T, 12.6, 0), dn = a < 0.3 ? sm(a / 0.3) : a < 0.38 ? 1 : 1 - sm(seg(a, 0.38, 0.6));
    bend(k, dn); P.f0x = lerp(1.6, 2.6, dn); P.f1x = lerp(-1.6, -2.4, dn);
    const E = [P.sx + 6.5, P.sy + 4], UP = [P.sx + 1.5, P.sy - 9], BK = [P.hx - 5, P.sy - 6.5], rx = P.sx + R0[0], ry = P.sy + R0[1];
    let x, y, lat = 3;
    if (a < 0.3) { const e = sm(a / 0.3); x = lerp(rx, T.x, e); y = lerp(ry, T.y, e); lat = lerp(6.6, 3, e); }
    else if (a < 0.38) { x = T.x; y = T.y; }
    else if (a < 0.6) { const e = sm(seg(a, 0.38, 0.6)); x = lerp(T.x, E[0], e); y = lerp(T.y, E[1], e); }
    else if (a < 0.74) { const e = sm(seg(a, 0.6, 0.74)); x = lerp(E[0], UP[0], e); y = lerp(E[1], UP[1], e); }   // вверх к плечу
    else if (a < 0.84) { const e = sm(seg(a, 0.74, 0.84)); x = lerp(UP[0], BK[0], e); y = lerp(UP[1], BK[1], e); lat = lerp(3, 6.5, e); }   // за голову — на рюкзак
    else { const e = sm(seg(a, 0.84, 1)); x = lerp(BK[0], rx, e); y = lerp(BK[1], ry, e); lat = lerp(6.5, 6.6, e); }
    P.h0x = x; P.h0y = y; P.hl0 = lat;
    const two = env(a, 0.34, 0.42, 0.56, 0.66);   // вторая рука помогает поднять
    handAt(1, lerp(lerp(P.sx + R1[0], P.hx + 5.5, dn), x - 1.6, two), lerp(lerp(P.sy + R1[1], hip() - 1.5, dn), y + 1, two), 1); P.hl1 = lerp(lerp(6.6, 4, dn), 3, two);
    if (a > 0.34 && a < 0.84 && o.item) P.held = [o.item, x - 0.3, y - 0.4, a < 0.6 ? -0.2 : lerp(-0.2, -1.4, seg(a, 0.6, 0.84))];
    P.tilt = 0.3 * dn - 0.12 * bump(a, 0.6, 0.86); P.hb = 0.3 * bump(a, 0.34, 0.6) + 0.25 * bump(a, 0.66, 0.86);
  } });

  // ================= ноша (js/carry.js): взять в охапку, положить, рюкзак — снять/развязать/внутрь/приторочить/затянуть/надеть =================
  // o.load = Carry.art(): { mode, n — частей в руках, w — толщины, k — вещь (вид рисунка), kg — масса того, с чем работа, pk — рюкзак, кг };
  // охапка у груди — P.lo/P.lon (рисует ArtPeople); снятый рюкзак — P.pko (ArtPeople drawPackOff: низ x,y, наклон, клапан, слой)
  const CH = () => [P.sx + 7, P.sy + 5.4];
  // вид части в руке (o.load.ks — виды частей охапки): чурка/комель — чурка, ветка/лапник/вершинка — своим рисунком
  const partK = (L, i) => { const k = L && L.ks && L.ks[i]; return k === 'bough' || k === 'branch' || k === 'top' ? k : 'chunk'; };
  // масса: dk — глубина приседа (0 — банка … 1 — от 12 кг), hv — тяжесть (спина прямая, пауза-рывок, противовес; с 2 кг, полная к ~14),
  // tw — вторая рука (с ~1,5 кг); усталость (o.tire) усиливает. Непрерывно, без ступенек.
  const KG = o => Math.max(0, (o.load && o.load.kg) || 0), TI = o => clamp(o.tire || 0, 0, 1);
  const dep = o => clamp(sm(clamp(KG(o) / 12, 0, 1)) * (1 + 0.3 * TI(o)), 0, 1);
  const hvy = o => clamp(sm(clamp((KG(o) - 2) / 12, 0, 1)) * (1 + 0.4 * TI(o)), 0, 1);
  const twoH = o => sm(clamp((KG(o) - 1) / 2.5, 0, 1));
  // касание позже задуманного (Carry: лёгкая вещь — короткий процесс, но до касания ≥ 0,3 с): до касания поза растянута, после — сжата
  const warp = (o, a) => { const L = o.load, c = L && L.c, c0 = L && L.c0; if (!c || !c0 || Math.abs(c - c0) < 1e-3) return a; return a < c ? a * c0 / c : c0 + (a - c) * (1 - c0) / (1 - c); };
  // рюкзак (снять/надеть): своя шкала — 5 кг легко, 25+ кг — тяжело (присед, упор на колено, рывок)
  const depPk = o => clamp(sm(clamp((KG(o) - 3) / 24, 0, 1)) * (1 + 0.3 * TI(o)), 0, 1);
  const hvPk = o => clamp(sm(clamp((KG(o) - 8) / 20, 0, 1)) * (1 + 0.4 * TI(o)), 0, 1);
  // к горловине/клапану снятого рюкзака: наклон корпусом, ноги чуть согнуты (не присед); dn — доля
  function leanTo(Tp, dn, d) {
    const cap = lerp(0.22, 0.8, clamp((Tp[1] + 27) / 9, 0, 1)), l = Math.min(cap, reachLean(Tp, 0, -17.2, 0.04, d || 13.6)), kb = clamp((l - 0.45) / 0.35, 0, 1);   // высоко — не клонится (руки тянутся сами)
    body(lerp(0.04, l, dn), -17.2 + (0.6 + 1.8 * kb) * dn, -0.8 * kb * dn); P.f0x = lerp(1.3, 2.2, dn); P.f1x = lerp(-1.6, -2.6, dn);
  }
  // дальняя рука держит охапку у груди (n частей), иначе — вес/помощь
  function hugLoad(n) { const C = CH(); if (n > 0) { handAt(1, C[0] - 1.6, C[1] + 1.8, 1); P.hl1 = 2.6; P.lo = [C[0], C[1] + 0.6, 0]; P.lon = n; return true; } return false; }
  // занята ли дальняя рука ношей (охапка — у груди, вещь — в кулаке у груди): тогда с рюкзаком работает одна ближняя
  function farHold(L, n) { if (hugLoad(n)) return true; if (L && L.k && !L.n) { const C = CH(); handAt(1, C[0] - 1, C[1] + 0.5, 1); P.hl1 = 3; P.held2 = [L.k, P.h1x + 0.2, P.h1y - 0.8, -0.3]; return true; } return false; }
  // присед по массе: k — не меньше, чем нужно достать T, и глубже от массы; спина прямее у тяжёлого
  // лёгкое — наклон корпусом почти без приседа; тяжелее — присед глубже, спина прямее (наклон добирает только недостающее)
  function liftBend(o, T, reach, dn) {
    const d = dep(o), hv = hvy(o), k0 = T.y > -16 ? bendK(T, reach, 0) : 0, k = k0 * (0.35 + 0.65 * d) + (1 - k0) * 0.6 * d;
    const hy = by(k), hx = bx(k), l = Math.max(bl(k) - 0.26 * hv, Math.min(1.15, reachLean(T, hx, hy, 0.04, reach)) - 0.26 * hv * (1 - d));
    body(lerp(0.04, l, dn), lerp(-17.2, hy, dn), lerp(0, hx, dn)); return k;
  }
  // наклон → взять (0.34 — касание, вещь уже в руках) → тяжёлое: держит, рывок, выпрямился с противовесом → к груди → держит
  R('pickKeep', { dur: 1.0, own: true, fn(o, t, a) {
    a = warp(o, a);
    stow(o);
    const L = o.load, T = tgt(o, 8, -2), hv = hvy(o), tw = twoH(o), g1 = 0.4 + 0.14 * hv, r1 = Math.min(0.9, 0.66 + 0.14 * hv);
    const dn = a < 0.3 ? sm(a / 0.3) : a < g1 ? 1 : 1 - sm(seg(a, g1, r1));
    liftBend(o, T, 12.6, dn);
    const jerk = bump(a, g1 - 0.05, g1 + 0.09) * hv, back = sm(seg(a, g1, r1)) * hv;   // рывок: таз чуть ниже и вверх; потом — корпус назад (противовес)
    if (hv > 0) body(P.lean - 0.12 * back + 0.05 * jerk, P.hy + 1.1 * jerk, P.hx - 0.7 * back);
    P.f0x = lerp(1.6, 2.6 + 0.9 * hv, dn); P.f1x = lerp(-1.6, -2.4 - 0.9 * hv, dn);
    const C = CH(), rx = P.sx + R0[0], ry = P.sy + R0[1];
    let x, y;
    if (a < 0.3) { const e = sm(a / 0.3); x = lerp(rx, T.x, e); y = lerp(ry, T.y, e); }
    else if (a < g1) { x = T.x; y = T.y + 0.4 * jerk; }
    else if (a < r1) { const e = sm(seg(a, g1, r1)); x = lerp(T.x, C[0] + 0.5, e); y = lerp(T.y, C[1] - 2.2, e); }
    else { x = C[0] + 0.5; y = C[1] - 2.2; }
    P.h0x = x; P.h0y = y; P.hl0 = 3;
    const got = a >= 0.34, n = L ? L.n : 0, moving = got && a < r1 && n > 0;
    if (!hugLoad(moving ? n - 1 : n)) { const two = Math.max(env(a, 0.34, 0.42, 0.6, 0.7), env(a, 0.24, 0.32, r1 - 0.04, r1 + 0.06) * tw) * Math.max(tw, 0.35 * (1 - hv)); handAt(1, lerp(lerp(P.sx + R1[0], P.hx + 5.5, dn), x - 1.6, two), lerp(lerp(P.sy + R1[1], hip() - 1.5, dn), y + 1, two), 1); P.hl1 = lerp(lerp(6.6, 4, dn), 3, two); }
    if (moving) P.held = [partK(L, n - 1), x - 0.3, y - 0.2, -0.15];
    else if (got && L && L.k && !n) P.held = [L.k, x - 0.3, y + (L.k === 'hare' ? 0.6 : -0.6), L.k === 'hare' ? PI / 2 - 0.15 : -0.3];
    P.tilt = 0.3 * dn * (1 - 0.4 * hv) - 0.12 * jerk; P.hb = 0.3 * bump(a, 0.34, 0.6) + 0.6 * jerk;
  } });
  // положить из рук: от груди → присед к T (тяжёлое — глубже, медленнее опускает) → отпустил (0.55) → выпрямился
  R('putKeep', { dur: 0.75, own: true, fn(o, t, a) {
    a = warp(o, a);
    stow(o);
    const L = o.load, T = tgt(o, 9, -3), hv = hvy(o), dn = env(a, 0, 0.4, 0.62, 0.95);
    liftBend(o, T, 12.4, dn); P.f0x = 2.6 + 0.8 * hv; P.f1x = -2.4 - 0.8 * hv;
    const C = CH(), rx = P.sx + R0[0], ry = P.sy + R0[1], before = a < 0.55;
    let x, y;
    if (a < 0.5) { const e = sm(a / 0.5), e2 = lerp(e, e * e, hv); x = lerp(C[0] + 0.5, T.x, e); y = lerp(C[1] - 2.2, T.y, e2); }   // тяжёлое — опускает, придерживая
    else if (a < 0.6) { x = T.x; y = T.y; }
    else { const e = sm(seg(a, 0.6, 1)); x = lerp(T.x, L && L.n ? C[0] + 0.5 : rx, e); y = lerp(T.y, L && L.n ? C[1] - 2.2 : ry, e); }
    P.h0x = x; P.h0y = y; P.hl0 = 3;
    const n = L ? L.n : 0, moving = before && n > 0;
    if (!hugLoad(moving ? n - 1 : n)) { const tw = twoH(o) * env(a, 0, 0.2, 0.55, 0.7); handAt(1, lerp(lerp(P.sx + R1[0], P.hx + 5.5, dn), x - 1.6, tw), lerp(lerp(P.sy + R1[1], hip() - 1.5, dn), y + 1, tw), 1); P.hl1 = lerp(lerp(6.6, 4, dn), 3, tw); }
    if (moving) P.held = [partK(L, n - 1), x - 0.3, y - 0.2, -0.15];
    else if (before && L && L.k) P.held = [L.k, x - 0.3, y + (L.k === 'hare' ? 0.6 : -0.5), L.k === 'hare' ? PI / 2 - 0.15 : -0.3];
    P.tilt = 0.3 * dn; P.hb = 0.3 * bump(a, 0.45, 0.65);
  } });

  // ---------- рюкзак снят: стоит на снегу перед героем (низ — T), лямками от него; поза ведёт P.pko ----------
  const PKT = o => tgt(o, 15, -1.8);
  const topOf = (B, rot, Hb) => [B[0] + Hb * sin(rot), B[1] - Hb * cos(rot)];   // ручка (верх клапана) при наклоне rot
  const pko = (B, rot, o2) => (P.pko = Object.assign({ x: B[0], y: B[1], rot, open: 0, st: 0, z: 1, gnd: 0, f: 1 }, o2));
  // на спине: низ у таза за спиной (как рисует рюкзак на спине)
  const onBack = g => [P.hx - 3.1 - g.d, hip() + 0.3];
  // снять: пряжки (пояс, грудь) → ближняя лямка с плеча → рюкзак на дальней лямке перекинут вперёд под ближней рукой → опустил на снег
  // перед собой (тяжёлый — присев с прямой спиной, опускает медленнее) → 0.84 стоит → выпрямился. Ноша — в дальней руке у груди.
  R('packDoff', { dur: 1.0, own: true, fn(o, t, a) {
    a = warp(o, a);
    H.idle(o, t); stow(o);
    const L = o.load, n = L ? L.n : 0, g = H.pack(), T = PKT(o), hv = hvPk(o), dk = depPk(o), Hb = g.Hb + 2.2;
    const shrug = bump(a, 0.18, 0.4);
    if (a < 0.34) {
      // пряжки и лямка: обе (свободные) руки к поясу → ближняя к лямке на груди; плечо уходит назад
      body(0.04 - 0.06 * shrug, -17.2 - 0.5 * shrug); P.hb = -shrug * 0.6; P.tilt = -0.05 * shrug;
      const busy1 = farHold(L, n), e1 = sm(seg(a, 0, 0.16)), e2 = sm(seg(a, 0.16, 0.32));
      handAt(0, lerp(lerp(P.sx + R0[0], P.hx + 4.2, e1), P.sx + 2.4, e2), lerp(lerp(P.sy + R0[1], hip() - 1, e1), P.sy + 2.2, e2), 1); P.hl0 = lerp(6.6, 3, e1);
      if (!busy1) { handAt(1, lerp(P.sx + R1[0], P.hx + 3.6, e1 * (1 - e2)), lerp(P.sy + R1[1], hip() - 0.6, e1 * (1 - e2)), 1); P.hl1 = lerp(6.6, 3, e1 * (1 - e2)); }
      return;
    }
    // рюкзак в руке: 0.34–0.6 с плеча вперёд по дуге под ближней рукой, 0.6–0.84 вниз на снег, дальше стоит
    const Bb = onBack(g), Bm = [T.x - 3, hip() + 2.5], e = sm(seg(a, 0.34, 0.6)), f = sm(seg(a, 0.6, 0.84));
    let B, rot;
    if (a < 0.6) { B = [lerp(Bb[0], Bm[0], e), lerp(Bb[1], Bm[1], e) + 3 * sin(PI * e)]; rot = -0.35 * sin(PI * e) + 0.15 * e; }
    else { const fy = lerp(f, f * f, hv); B = [lerp(Bm[0], T.x, f), lerp(Bm[1], T.y, fy)]; rot = lerp(0.15, 0, f); }   // тяжёлый — опускает, придерживая
    if (a >= 0.84) { B = [T.x, T.y]; rot = 0; }
    const Tp = topOf(B, rot, Hb), lowDn = env(a, 0.56, 0.8, 0.88, 1.08);
    leanTo([Tp[0], Tp[1] + 1], lowDn, 13.2);
    if (dk > 0.02) body(P.lean - 0.22 * dk * lowDn, P.hy + 5 * dk * lowDn, P.hx - 1.4 * dk * lowDn);   // присед, спина прямая
    if (a < 0.6) body(P.lean - 0.06 * bump(a, 0.34, 0.6), P.hy);
    const busy1 = farHold(L, n);
    pko(B, rot, { z: e > 0.45 ? 1 : 0, st: 1 - sm(seg(a, 0.42, 0.62)), gnd: a >= 0.84 ? 1 : 0, keep: 1 });
    const rel = a >= 0.86 ? sm(seg(a, 0.86, 1)) : 0;
    handAt(0, lerp(Tp[0] + 0.6, P.sx + R0[0], rel), lerp(Tp[1] + 0.4, P.sy + R0[1], rel), 1); P.hl0 = 2.6;
    if (!busy1) { const w2 = env(a, 0.6, 0.7, 0.86, 1); handAt(1, lerp(P.sx + R1[0], Tp[0] - 1.2, w2), lerp(P.sy + R1[1], Tp[1] + 0.8, w2), 1); P.hl1 = lerp(6.6, 3, w2); }
    P.tilt = 0.18 * lowDn; P.hb = 0.4 * bump(a, 0.78, 0.9) * (0.4 + hv);
  } });
  // развязать: наклон к горловине, ближняя рука откидывает клапан от себя, дальняя (свободна) ослабляет шнур
  R('packOpen', { dur: 0.5, own: true, fn(o, t, a) {
    a = warp(o, a);
    H.idle(o, t); stow(o);
    const L = o.load, n = L ? L.n : 0, g = H.pack(), T = PKT(o), O = [T.x, T.y - g.Hb], dn = env(a, -0.3, 0.2, 0.85, 1.3), op = sm(seg(a, 0.15, 0.7));
    leanTo([O[0], O[1] - 1.5], dn);
    const busy1 = farHold(L, n);
    pko([T.x, T.y], 0, { open: op, gnd: 1, keep: 1 });
    handAt(0, lerp(O[0] - g.d * 0.6, O[0] + g.d + 2, op), O[1] - 2.2 - 2.5 * sin(PI * op), 1); P.hl0 = 2.4;
    if (!busy1) { handAt(1, O[0] - 1.2 + 0.6 * sin(a * 40) * env(a, 0.4, 0.5, 0.8, 0.95), O[1] - 0.8, env(a, 0, 0.3, 0.85, 1)); P.hl1 = 3.4; }
    P.tilt = 0.25 * dn;
  } });
  // затянуть: клапан на место, шнур и ремни клапана — рывками вниз
  R('packTie', { dur: 0.5, own: true, fn(o, t, a) {
    a = warp(o, a);
    H.idle(o, t); stow(o);
    const L = o.load, n = L ? L.n : 0, g = H.pack(), T = PKT(o), O = [T.x, T.y - g.Hb], dn = env(a, -0.3, 0.15, 0.8, 1.15);
    const op = 1 - sm(seg(a, 0, 0.45)), tug = bump(a, 0.5, 0.68) + bump(a, 0.7, 0.88);
    leanTo([O[0], O[1] - 1.5], dn);
    const busy1 = farHold(L, n);
    pko([T.x, T.y], 0, { open: op, gnd: 1, keep: 1 });
    handAt(0, lerp(O[0] + g.d + 2, O[0] - g.d * 0.4, 1 - op), O[1] - 2.4 - 2.5 * sin(PI * op) + 1.6 * tug, 1); P.hl0 = 2.4;
    if (!busy1) { handAt(1, O[0] + 0.8, O[1] - 1.2 + 1.4 * tug, env(a, 0.1, 0.4, 0.85, 1)); P.hl1 = 3.4; }
    P.tilt = 0.25 * dn; P.hb = 0.3 * tug;
  } });
  // внутрь: вещь от груди — над горловиной — вниз в горловину (рука уходит внутрь), 0.55 отпустил — рука наверх и к груди/в покой.
  // Что ниже кромки, закрыт рюкзаком (он рисуется поверх вещи): вещь уходит внутрь, а не за спину. Тяжёлое — двумя руками, ниже наклон.
  R('packIn', { dur: 0.7, own: true, fn(o, t, a) {
    a = warp(o, a);
    H.idle(o, t); stow(o);
    const L = o.load, n = L ? L.n : 0, g = H.pack(), T = PKT(o), O = [T.x, T.y - g.Hb], C0 = CH(), hv = hvy(o), tw = twoH(o);
    const more = n > 1, dn = env(a, -0.1, 0.3, 0.75, 1.1);
    leanTo([O[0], O[1] - 1], dn); if (hv > 0) body(P.lean - 0.1 * hv * dn, P.hy + 2.5 * hv * dn, P.hx - 0.8 * hv * dn);
    pko([T.x, T.y], 0, { open: 1, gnd: 1, keep: 1 });
    const C = CH(), rx = P.sx + R0[0], ry = P.sy + R0[1], AB = [O[0] - 0.4, O[1] - 5.5], IN = [O[0] + 0.2, O[1] + 3];
    let x, y;
    if (a < 0.24) { const e = sm(a / 0.24); x = lerp(C[0] + 0.5, AB[0], e); y = lerp(C[1] - 2, AB[1], e); }
    else if (a < 0.5) { const e = sm(seg(a, 0.24, 0.5)); x = lerp(AB[0], IN[0], e); y = lerp(AB[1], IN[1], e); }
    else if (a < 0.58) { x = IN[0]; y = IN[1]; }
    else if (a < 0.78) { const e = sm(seg(a, 0.58, 0.78)); x = lerp(IN[0], AB[0] + 0.6, e); y = lerp(IN[1], AB[1] + 1.5, e); }
    else { const e = sm(seg(a, 0.78, 1)); x = lerp(AB[0] + 0.6, more ? C[0] + 0.5 : rx, e); y = lerp(AB[1] + 1.5, more ? C[1] - 2.2 : ry, e); }
    P.h0x = x; P.h0y = y; P.hl0 = 2.2; void C0;
    const before = a < 0.55, isT = L && L.k && !n, movP = before && n > 0;
    if (!hugLoad(movP ? n - 1 : n)) { const w2 = tw * env(a, 0, 0.12, 0.5, 0.62); handAt(1, lerp(P.sx + R1[0], x - 1.4, w2), lerp(P.sy + R1[1], y + 0.8, w2), 1); P.hl1 = lerp(6.6, 3, w2); }
    if (before) P.held = isT ? [L.k, x - 0.3, y - 0.3, -0.3 - 1.1 * sm(seg(a, 0.2, 0.45))] : n ? ['chunk', x, y + 0.3, -0.15 - 1.3 * sm(seg(a, 0.18, 0.45))] : null;   // чурка — торцом вниз в горловину
    P.tilt = 0.3 * dn; P.hb = 0.2 * bump(a, 0.45, 0.62);
  } });
  // приторочить снаружи: чурку поперёк (торцом к взгляду) обеими руками — на клапан (0.5 — легла), ближняя рука тянет ремень клапана
  // через неё к пряжке (два рывка), дальняя прижимает; потом — к груди (ещё есть) или в покой
  R('packLash', { dur: 1.1, own: true, fn(o, t, a) {
    a = warp(o, a);
    H.idle(o, t); stow(o);
    const L = o.load, n = L ? L.n : 0, g = H.pack(), T = PKT(o), CR = 1.6;
    const lt = [T.x, T.y - g.Hb - 2.2 - (H.look() && H.look().packType === 'frame' ? 2.6 : 0)], ON = [lt[0], lt[1] - CR];
    const dn = env(a, -0.2, 0.3, 0.85, 1.15), more = n > 1;
    leanTo([ON[0], ON[1]], dn);
    pko([T.x, T.y], 0, { gnd: 1, keep: 1 });
    const C = CH(), rx = P.sx + R0[0], ry = P.sy + R0[1], tug = bump(a, 0.58, 0.7) + bump(a, 0.72, 0.84);
    let x, y;
    if (a < 0.4) { const e = sm(a / 0.4); x = lerp(C[0] + 0.5, ON[0] - 0.5, e); y = lerp(C[1] - 2.2, ON[1] - 1.2, e); }
    else if (a < 0.52) { const e = sm(seg(a, 0.4, 0.52)); x = ON[0] - 0.5; y = lerp(ON[1] - 1.2, ON[1], e); }
    else if (a < 0.88) { const e = sm(seg(a, 0.52, 0.62)); x = lerp(ON[0] - 0.5, ON[0] + g.d + 0.5, e) - 1.6 * tug; y = lerp(ON[1], lt[1] + 0.6, e) - 2.4 * (1 - Math.abs(2 * e - 1)) + 1.2 * tug; }
    else { const e = sm(seg(a, 0.88, 1)); x = lerp(ON[0] + g.d - 1, more ? C[0] + 0.5 : rx, e); y = lerp(lt[1] + 0.6, more ? C[1] - 2.2 : ry, e); }
    P.h0x = x; P.h0y = y; P.hl0 = 2.2;
    const before = a < 0.5, movP = before && n > 0;
    if (!hugLoad(movP ? n - 1 : n)) { const w2 = env(a, 0, 0.15, 0.82, 0.95); handAt(1, lerp(P.sx + R1[0], before ? x - 0.6 : ON[0] - 1, w2), lerp(P.sy + R1[1], before ? y + 0.6 : ON[1] + 0.3, w2), 1); P.hl1 = lerp(6.6, 3, w2); }
    if (before && n > 0) P.held = ['chunkE', x + 0.5, y, 0];
    P.tilt = 0.28 * dn; P.hb = 0.3 * tug;
  } });
  // надеть: наклон/присед к рюкзаку, ручка → поднял на бедро (тяжёлый — упор на колено, пауза) → дальняя рука в лямку, рюкзак
  // перекинут за спину (0.84 — сел на спину) → ближняя рука в лямку, подкинул плечами, пряжки. Ноша — в дальней руке.
  R('packDon', { dur: 1.2, own: true, fn(o, t, a) {
    a = warp(o, a);
    H.idle(o, t); stow(o);
    const L = o.load, n = L ? L.n : 0, g = H.pack(), T = PKT(o), hv = hvPk(o), dk = depPk(o), Hb = g.Hb + 2.2;
    const kp = 0.2 + 0.12 * hv, k1 = 0.42 + 0.12 * hv;   // kp — поднял на бедро, k1 — пауза на колене кончилась
    const knee = env(a, kp - 0.04, kp + 0.04, k1, k1 + 0.08) * hv;   // упор на колено: ближняя нога вперёд-вверх
    const Bk = [T.x - 4, hip() + 5 - 3 * knee], Bb = onBack(g), e1 = sm(seg(a, 0.08, kp)), e2 = sm(seg(a, k1, 0.84));
    let B, rot;
    if (a < kp) { B = [lerp(T.x, Bk[0], e1), lerp(T.y, Bk[1], e1)]; rot = -0.1 * e1; }
    else if (a < k1) { B = [Bk[0], Bk[1]]; rot = -0.1; }
    else { B = [lerp(Bk[0], Bb[0], e2), lerp(Bk[1], Bb[1], e2) - 3 * sin(PI * e2) * (1 + hv)]; rot = -0.1 + (0.1 + 0.35 * (1 + 0.6 * hv)) * sin(PI * e2); }   // закинул: дуга вверх-назад
    const Tp = topOf(B, rot, Hb), dn = env(a, -0.1, 0.1, kp, k1 + 0.14);
    leanTo([Tp[0], Tp[1] + 1], dn, 13.2);
    if (dk > 0.02) body(P.lean - 0.22 * dk * dn, P.hy + 5 * dk * dn, P.hx - 1.4 * dk * dn);
    if (knee > 0) { P.f0x += 3.2 * knee; P.f0y = -2 - 3.6 * knee; P.f0a = 0.3 * knee; }
    const hitch = bump(a, 0.8, 0.94);
    if (a >= 0.84) body(P.lean - 0.04 * hitch, P.hy - 1.4 * hitch);
    const busy1 = farHold(L, n);
    if (a < 0.84) {
      pko(B, rot, { z: e2 > 0.5 ? 0 : 1, st: sm(seg(a, k1 + 0.04, 0.8)), gnd: a < 0.08 ? 1 : 0, keep: 1 });
      // ближняя рука: ручка (поднять) → лямка (перекинуть: точка лямки на спинке, ~¾ высоты)
      const cs = cos(rot), sn = sin(rot), v = Hb * 0.72, SP = [B[0] + g.d * cs + v * sn, B[1] + g.d * sn - v * cs], s2 = sm(seg(a, k1 - 0.06, k1 + 0.1));
      handAt(0, lerp(Tp[0] + 0.6, SP[0], s2), lerp(Tp[1] + 0.6, SP[1], s2), 1); P.hl0 = 2.6;
      if (!busy1) { const w2 = env(a, 0.04, 0.14, k1 + 0.1, 0.7); handAt(1, lerp(P.sx + R1[0], lerp(B[0] + 1, P.sx + 1.5, e2), w2), lerp(P.sy + R1[1], lerp(B[1] - 4, P.sy + 1.5, e2), w2), 1); P.hl1 = lerp(6.6, 3.2, w2); }
    } else {
      // на спине: ближняя рука — в лямку (из-за спины вперёд к груди), подкинул плечами, пряжка на поясе
      const e3 = sm(seg(a, 0.84, 0.94)), e4 = sm(seg(a, 0.92, 1));
      handAt(0, lerp(lerp(P.hx - 3, P.sx + 2.4, e3), P.hx + 4.2, e4), lerp(lerp(hip() - 6, P.sy + 2.4, e3), hip() - 1, e4), 1); P.hl0 = 3;
      if (!busy1) { handAt(1, lerp(P.sx + 1.6, P.hx + 3.6, e4), lerp(P.sy + 2, hip() - 0.6, e4), 1); P.hl1 = 3; }
    }
    P.tilt = 0.2 * dn - 0.08 * hitch; P.hb = -0.8 * hitch + 0.4 * knee;
  } });
  // мелочь — в поясной карман рюкзака у ближнего бедра (рюкзак не снимает): рука с вещью к карману, внутрь (0.55), застегнул
  R('packPut', { dur: 0.7, own: true, fn(o, t, a) {
    a = warp(o, a);
    H.idle(o, t); stow(o);
    const L = o.load, PB = [P.hx + 3.6, hip() + 0.6], rx = P.sx + R0[0], ry = P.sy + R0[1];
    let x, y;
    if (a < 0.35) { const e = sm(a / 0.35); x = lerp(rx + 1.5, PB[0] + 0.6, e); y = lerp(ry - 1, PB[1] - 2.2, e); }
    else if (a < 0.55) { const e = sm(seg(a, 0.35, 0.55)); x = PB[0] + 0.6 - 0.4 * e; y = lerp(PB[1] - 2.2, PB[1], e); }
    else if (a < 0.72) { x = PB[0] + 0.2 + 1.4 * sm(seg(a, 0.56, 0.7)); y = PB[1] - 0.6; }   // молния
    else { const e = sm(seg(a, 0.72, 1)); x = lerp(PB[0] + 1.6, rx, e); y = lerp(PB[1] - 0.6, ry, e); }
    P.h0x = x; P.h0y = y; P.hl0 = lerp(6.6, 3.4, env(a, 0, 0.3, 0.75, 1));
    farHold(L && L.n ? L : null, L ? L.n : 0) || handAt(1, P.sx + R1[0], P.sy + R1[1], 1);
    if (a < 0.55 && L && L.k) P.held = [L.k, x - 0.2, y - 0.4, -0.3];
    body(0.08 * env(a, 0, 0.3, 0.75, 1), -17.2); P.tilt = 0.22 * env(a, 0, 0.3, 0.75, 1);
  } });
  // достать из поясного кармана (еда): рука к карману (0.45), взял (0.55), к груди
  R('packGet', { dur: 0.9, own: true, fn(o, t, a) {
    a = warp(o, a);
    H.idle(o, t); stow(o);
    const L = o.load, C = CH(), PB = [P.hx + 3.6, hip() + 0.6], rx = P.sx + R0[0], ry = P.sy + R0[1];
    let x, y;
    if (a < 0.4) { const e = sm(a / 0.4); x = lerp(rx, PB[0] + 0.6, e); y = lerp(ry, PB[1] - 1.6, e); }
    else if (a < 0.58) { x = PB[0] + 0.4 + 0.3 * sin(a * 60); y = PB[1] - 0.4; }
    else { const e = sm(seg(a, 0.58, 1)); x = lerp(PB[0] + 0.6, C[0] + 0.5, e); y = lerp(PB[1] - 0.6, C[1] - 2, e); }
    P.h0x = x; P.h0y = y; P.hl0 = 3.4;
    handAt(1, P.sx + R1[0], P.sy + R1[1], 1);
    if (a >= 0.55 && L) P.held = L.k ? [L.k, x - 0.3, y - 0.5, -0.3] : L.n ? ['chunk', x - 0.3, y - 0.2, -0.2] : null;
    body(0.08 * env(a, 0, 0.3, 0.6, 0.9), -17.2); P.tilt = 0.22 * env(a, 0, 0.3, 0.6, 0.9);
  } });
  // (прежнее «затянуть лямки» — для совместимости сейвов со старым шагом)
  R('packClose', { dur: 0.6, own: true, fn(o, t, a) {
    H.idle(o, t); stow(o);
    const L = o.load, w = env(a, 0, 0.25, 0.7, 1), pull = bump(a, 0.25, 0.7);
    body(0.04 + 0.04 * pull, -17.2 - 0.8 * pull);
    hand(0, 2.6, 5.5 + 3 * pull, w); P.hl0 = lerp(6.6, 3.6, w);
    if (!(L && hugLoad(L.n))) { hand(1, 2.2, 5.2 + 3 * pull, w); P.hl1 = lerp(6.6, 3.2, w); }
    P.hb = -0.6 * pull; P.tilt = 0.05 * pull;
  } });
  // ================= длинное (js/carry.js): поднять на плечо, снять/сбросить; не лезет — жест =================
  // P.lng — ствол для рига: R [fx, y, lat] — хват (доля u от вершинки), phi — наклон (+ комель ниже), psi — вбок, pins — кисти на стволе
  // [[рука, доля]], w/wb — концы в мире до касания и доля перехода от них. Длина — o.load.lg.len (м) × 23 ед.
  const M23 = H.M23 || 23, RB = H.RB || 1.6, TH0 = 0.33;
  const holdU = Lr => 0.6 + Math.min(0.4 * Lr - 1, 9.5) / Lr;   // доля хвата держащей руки на плече (впереди плеча) — как у рига в ходу
  const shoulderR = (sd, u, phi, psi) => { const S = [P.sx + 0.3, P.sy - RB, sd * 3.1], c = cos(phi), d = [c * cos(psi), sin(phi), c * sin(psi)], k = (0.6 - u); return [S[0] - d[0] * k, S[1] - d[1] * k, S[2] - d[2] * k, d]; };
  const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
  // стопы переступают, пока корпус идёт в мире на D (ступени по h): опорная стоит в мире, переносимая — шагом с подъёмом
  function shuffle(D, Dt) {
    const n = Math.max(1, Math.round(Dt / 9)), h = Dt / n || 1;
    for (let i = 0; i < 2; i++) {
      const off = i ? 0 : h, k = (D + off) / (2 * h), fl = Math.floor(k), fr = k - fl, e = sm((fr - 0.55) / 0.45), W = (fl + e) * 2 * h - off;
      const x = (i ? -1.6 : 1.6) + W - D, up = bump(fr, 0.55, 1) * 2.4 * (Dt > 0.5 ? 1 : 0);
      if (i) { P.f1x = x; P.f1y = -2 - up; P.f1a = up * 0.05; } else { P.f0x = x; P.f0y = -2 - up; P.f0a = up * 0.05; }
    }
  }
  R('liftLong', { dur: 3, own: true, fn(o, t, a) {
    a = warp(o, a);
    H.idle(o, t); stow(o);
    const L = o.load || {}, lg = L.lg || { len: 1.5, kind: 'top' }, lf = L.lf || {}, sd = H.lside ? H.lside() : -1, hold = sd < 0 ? 1 : 0, Lr = Math.max(8, lg.len * M23), c = lf.c || L.c || 0.16;
    const hv = clamp((lg.kg || 2) / 20, 0, 1), uh = holdU(Lr);
    if (lf.simple) {
      // короткое лёгкое: присел к середине → встал, ствол поперёк у пояса → закинул на плечо (поворот к ходу) → рука вперёд
      const eA = sm(seg(a, 0, c)), eB = sm(seg(a, c, 0.5)), eC = sm(seg(a, 0.5, 0.8)), eD = sm(seg(a, 0.8, 1)), dn = a < c ? eA : 1 - eB;
      liftBend(Object.assign({}, o, { load: Object.assign({}, L, { kg: 12 }) }), { x: 7.5, y: -2.6 }, 12, dn);   // присел (спина прямая), не наклон
      const ps0 = sd < 0 ? -PI / 2 : PI / 2, Rg = [7.5, -2.4, 0], Rw = [7, -22, 0];
      if (a < c) { const T = [8, -2]; handAt(0, lerp(P.sx + R0[0], T[0] + 0.4, eA), lerp(P.sy + R0[1], T[1], eA), 1); handAt(1, lerp(P.sx + R1[0], T[0] - 0.4, eA), lerp(P.sy + R1[1], T[1], eA), 1); P.hl0 = lerp(6.6, 2.6, eA); P.hl1 = lerp(6.6, 2.6, eA); P.tilt = 0.3 * dn; return; }
      const SR = shoulderR(sd, 0.5, TH0 * eC, ps0 * (1 - eC)), Rm = a < 0.5 ? lerp3(Rg, Rw, eB) : lerp3(Rw, SR, eC);
      if (a >= 0.5) Rm[1] -= 3 * bump(a, 0.5, 0.8);   // дуга вверх через грудь
      body(P.lean - 0.06 * bump(a, 0.5, 0.8), P.hy + 1.2 * bump(a, 0.55, 0.75)); P.hb = 0.5 * bump(a, 0.5, 0.8);
      const free = a > 0.8 ? 1 - hold : -1, pins = [[hold, lerp(0.62, uh, eD)]]; if (a <= 0.86) pins.push([1 - hold, 0.38]);
      if (free >= 0) { handAt(free, P.sx + (free ? R1 : R0)[0], P.sy + (free ? R1 : R0)[1], 1); if (free) P.hl1 = 6.6; else P.hl0 = 6.6; }
      P.lng = { lg, R: Rm, phi: TH0 * eC, psi: ps0 * (1 - eC), u: 0.5, pins, w: lf.w, wb: sm(seg(a, c, c + 0.14)) };
      P.tilt = 0.3 * dn - 0.1 * eC; return;
    }
    // длинное: та же геометрия, что у процесса (Carry.liftGeo) — путь корпуса, хват, наклон
    const Gc = typeof Carry !== 'undefined' && Carry.liftGeo ? Carry.liftGeo(a, lg.len) : null; if (!Gc) return;
    const sq = Object.assign({}, o, { load: Object.assign({}, L, { kg: Math.max(lg.kg || 0, 12) }) });   // с земли длинное — в присед (спина прямая)
    const Dn = lf.D != null ? lf.D : Gc.D, Dt = typeof Carry !== 'undefined' ? Carry.liftGeo(0.62, lg.len).D : Gc.D;
    const eA = sm(seg(a, 0, c)), eB = sm(seg(a, c, 0.36)), eD = sm(seg(a, 0.62, 0.74)), eE = sm(seg(a, 0.74, 0.88)), eF = sm(seg(a, 0.88, 1));
    if (a < c) {   // присел к вершинке на снегу, обе руки к концу
      const T = { x: 8, y: -2 }; liftBend(sq, T, 12.6, eA);
      handAt(0, lerp(P.sx + R0[0], T.x + 0.4, eA), lerp(P.sy + R0[1], T.y, eA), 1); handAt(1, lerp(P.sx + R1[0], T.x - 0.6, eA), lerp(P.sy + R1[1], T.y, eA), 1);
      P.hl0 = lerp(6.6, 1.6, eA); P.hl1 = lerp(6.6, 1.6, eA); P.tilt = 0.3 * eA; return;
    }
    const gx = 7 + (Gc.D - Dn), stand = a < 0.36 ? eB : 1;
    // корпус: из приседа — встал с наклоном к хвату (тяжёлое — спина прямее, колени), перехваты — шагом, комель оторвал — откинулся,
    // плечо под ствол — присел и выпрямился
    const Rg = [gx, Gc.gy, 0], dip = bump(a, 0.74, 0.9);
    if (a < 0.36) liftBend(sq, { x: gx + 2.5, y: Gc.gy - 1 }, 11.5, 1);   // корпус ровно настолько, чтобы рука была на конце: встаёт вместе с ним
    if (a >= 0.36) body(lerp(0.2, 0.06, eD) - 0.08 * hv * eD + 0.04 * dip, -17.2 + 0.8 * hv * eD + 2.6 * dip, -0.6 * eD);
    if (a > c) shuffle(Math.max(0, Dn), Math.max(Dt, 0.01));
    // ствол: хват у пояса → к плечу (комель вперёд-вниз), лат — к своему плечу
    const SR = shoulderR(sd, Gc.u, TH0, 0), Rm = a < 0.74 ? Rg : lerp3([7, -24, 0], SR, eE), phi = a < 0.74 ? Gc.phi : lerp(0, TH0, eE);
    if (a >= 0.74) Rm[1] -= 2.5 * bump(a, 0.74, 0.88);
    // кисти: по обе стороны хвата, перехватывают по очереди (сдвиг ±); в конце держащая — вперёд, вторая отпускает
    const sl = 0.025 * sin(3 * PI * Gc.eC), uB = Math.max(0.01, Gc.u - 0.05 + sl), uF = Math.max(uB + 0.08, Gc.u + 0.05 + sl), pins = [[hold, a < 0.88 ? uF : lerp(uF, uh, eF)]];
    if (a < 0.92) pins.push([1 - hold, uB]); else { const f = 1 - hold; handAt(f, P.sx + (f ? R1 : R0)[0], P.sy + (f ? R1 : R0)[1], 1); if (f) P.hl1 = 6.6; else P.hl0 = 6.6; }
    P.lng = { lg, R: Rm, phi, psi: 0, u: Gc.u, pins, w: lf.w, wb: sm(seg(a, c, c + 0.12)) };
    P.tilt = 0.25 * (1 - stand) - 0.08 * eD; P.hb = 0.4 * bump(a, 0.2, 0.36) * (0.5 + hv) + 0.5 * dip;
  } });
  // снять с плеча: опустить передний конец → ствол сходит с плеча, обе руки ведут его вниз → лёг рядом (0.62) → выпрямился.
  // сбросить (fast): повёл плечом — ствол падает сам (0.42 — удар). Где лёг — там его и оставит процесс (концы рига на снегу)
  R('putLong', { dur: 1.2, own: true, fn(o, t, a) {
    a = warp(o, a);
    H.idle(o, t); stow(o);
    const L = o.load || {}, lg = L.lg || { len: 1.5 }, lf = L.lf || {}, sd = H.lside ? H.lside() : -1, hold = sd < 0 ? 1 : 0, Lr = Math.max(8, lg.len * M23), uh = holdU(Lr), c = lf.c || 0.62;
    if (lf.fast) {
      const e = clamp(a / c, 0, 1), f = e * e, sh = bump(a, 0, 0.3);
      body(0.04 + 0.06 * sh, -17.2 - 0.6 * sh); P.hb = -0.8 * sh; P.tilt = -0.1 * sh;
      if (a < c && L.top) { const S0 = shoulderR(sd, 0.6, TH0, 0), G0 = [-2, -1.5, sd * 10]; P.lng = { lg, R: lerp3(S0, G0, f), phi: lerp(TH0, -0.04, f), psi: 0, u: 0.6, pins: a < 0.08 ? [[hold, uh]] : [] }; }
      return;
    }
    const e1 = sm(seg(a, 0, 0.35)), e2 = sm(seg(a, 0.35, c)), up = sm(seg(a, c, 1)), dn = a < c ? sm(seg(a, 0.2, c)) : 1 - up;
    const Gp = [3, -1.5, sd * 9];   // лёг рядом: точка равновесия у ног сбоку, вершинка — назад, комель — вперёд
    liftBend(o, { x: 6, y: -4 }, 12.6, dn * 0.85);
    if (a < c && L.top) {
      const S0 = shoulderR(sd, 0.6, lerp(TH0, 0.8, e1), 0), R0_ = [S0[0], S0[1], S0[2]], Rm = lerp3(R0_, Gp, e2), phi = lerp(lerp(TH0, 0.8, e1), 0, e2);
      P.lng = { lg, R: Rm, phi, psi: 0, u: 0.6, pins: a > 0.45 ? [] : a > 0.2 ? [[hold, uh], [1 - hold, 0.45]] : [[hold, uh]] };   // у самого снега — отпустил
      if (a <= 0.2) { const f = 1 - hold; handAt(f, P.sx + (f ? R1 : R0)[0], P.sy + (f ? R1 : R0)[1], 1); }
    }
    P.tilt = 0.25 * dn; P.hb = 0.3 * bump(a, 0.55, 0.7);
  } });
  // не лезет: повёл плечами, качнул головой — вещь осталась в руках (ноша рисуется как есть)
  R('noFit', { dur: 0.7, fn(o, t, a) {
    H.idle(o, t);
    const sh = bump(a, 0, 0.45), nod = sin(a * PI * 4) * (1 - a);
    P.hb = -0.9 * sh; P.tilt = 0.12 * nod; body(P.lean + 0.03 * sh, P.hy - 0.5 * sh);
  } });

  // разделка: на корточках у туши, дальняя рука держит/оттягивает шкуру, ближняя — нож, короткие резы
  R('butcher', { loop: true, dur: 1.0, fn(o, t) {
    const T = tgt(o, 9, -2), s0 = seedOf(o), k = bendK(T, 12.6, 0.6), br = sin(t * 1.6 + s0), u = (t * 1.1 + s0) % 1, cut = sin(u * PI * 2);
    bend(k, 1); P.f0x = 2.8; P.f1x = -2.6; P.f1a = 0.3; P.br = br;
    body(P.lean + 0.02 * br + 0.03 * cut, P.hy + 0.15 * br);
    handAt(0, T.x + 1.5 + 2.6 * cut, T.y - 1 - 0.6 * Math.abs(cut), 1); P.hl0 = 2.6;
    handAt(1, T.x - 3.2, T.y - 1.5 - 1.4 * Math.max(0, -cut), 1); P.hl1 = 3.2;
    P.held = ['knife', P.h0x, P.h0y, 0.5 + 0.35 * cut];
    P.tilt = 0.32 + 0.05 * sin(t * 0.5 + s0); P.hb = 0.15 * br; stow(o);
  } });

  // ================= рубка: варианты =================
  // топор: лезвие (точка искр) = кисть + (16−c, 4) вдоль топорища; c — насколько кисть съехала к топору.
  // Решаем удар так, чтобы лезвие легло в T: к близкому стволу кисти перехватывают ближе к обуху.
  function chopAim(T, lean, hx, hy) {
    const sx = hx + sin(lean) * SH, sy = HY(hy) - cos(lean) * SH, dx = T.x - sx, dy = T.y - sy;
    const D = clamp(hyp(dx, dy), 8, 28.6), r = clamp(D * 0.5, 8.5, 11);
    const cq = cos(0.85), L = clamp(-r * cq + Math.sqrt(Math.max(0, r * r * cq * cq - r * r + D * D)), 10.6, 16.5);
    const c = 16 - Math.sqrt(L * L - 16), off = Math.atan2(4, 16 - c);
    const d = Math.acos(clamp((D * D - r * r - L * L) / (2 * r * L), -1, 1));
    return { b: Math.atan2(dy, dx) - Math.atan2(L * sin(d), r + L * cos(d)), r, k: d - off, c };
  }
  // кисть на угле b, радиус r, наклон топорища ta = b + k, перехват c (0 — за конец)
  function axe(b, r, k, c) {
    handA(0, b, r); P.hl0 = P.hl1 = 1.5; P.tk = 'axe'; P.ta = b + k; P.two = 1; P.gap = -3.6 + (c || 0);
    if (c > 0.05) { P.tox = P.h0x - cos(P.ta) * c; P.toy = P.h0y - sin(P.ta) * c; }
  }
  // косой удар (все варианты рубки): wu — замах 0..1, st — шаг 0..1, k — размах (устал/замёрз — меньше).
  // Таз: назад на замахе, вперёд с шагом (до body); кисти наискось через тело, разворот корпуса, передняя стопа — шагом (после axe)
  const obHx = (wu, st, k) => (-0.7 * wu + 0.9 * st * (1 - wu)) * k;
  function oblique(wu, st, k) { const lt = (3.2 * wu - 1.6 * st * (1 - wu)) * k; P.hl0 += lt; P.hl1 -= lt; P.tw = (-0.24 * wu + 0.2 * st * (1 - wu)) * k; P.f0x += 1.8 * st * k; }

  // устал: медленный замах, тяжёлое падение, пауза с одышкой
  R('chopHeavy', { dur: 1.2, fn(o, t, a) {
    const T = tgt(o, 11, -10), REST = 0.95, UP = -2.3;
    const hit = chopAim(T, 0.42, 0.3, -15.6);
    let b, h;
    // удар в a = 0.62 (Hero IMPACT.chopHeavy): падение 0.52→0.62 (≈0.12 с), стоп-кадр ≈55 мс, лёгкий отскок, пауза с одышкой
    if (a < 0.48) { b = lerp(REST, UP, sm(a / 0.48)); h = 0; }
    else if (a < 0.52) { b = UP + 0.05 * sin((a - 0.48) * 90); h = 0; }
    else if (a < 0.62) { const e = Math.pow((a - 0.52) / 0.1, 1.6); b = lerp(UP, hit.b, e); h = e; }
    else if (a < 0.86) { b = hit.b + 0.06 * sin(seg(a, 0.665, 0.72) * PI); h = 1; }
    else { const e = sm((a - 0.86) / 0.14); b = lerp(hit.b, REST, e); h = 1 - e; }
    const w = clamp((REST - b) / (REST - UP), 0, 1), pause = env(a, 0.66, 0.72, 0.84, 0.92), imp = env(a, 0.6, 0.63, 0.67, 0.78);
    const st = a < 0.5 ? 0 : a < 0.62 ? sm((a - 0.5) / 0.12) : a < 0.86 ? 1 : 1 - sm((a - 0.86) / 0.14);
    P.f0x = 4.2; P.f1x = -3.8; P.f1a = -0.1; P.br = sin(t * 7) * pause;
    body(lerp(lerp(0.42, -0.08, w), 0.42, h) + 0.08 * pause + 0.04 * imp, -15.6 + (1 - w) * 0.6 - 0.9 * w + 0.4 * pause + 0.15 * P.br + 0.3 * imp, 0.3 + obHx(w, st, 0.7));
    axe(b, lerp(11, hit.r, h), lerp(0.1, hit.k, h), hit.c * h); oblique(w, st, 0.7);
    P.tilt = lerp(0.3, -0.12, w) + 0.12 * pause; P.mouth = 0.3 + 0.5 * pause; P.hb = 0.5 * P.br;
    if (a >= 0.52 && a < 0.63) P.trail = [lerp(UP, b, 0.35), b, lerp(11, hit.r, h) + 17];
    if (a >= 0.62 && a < 0.69) P.spark = 1;
  } });

  // окоченел: короткий скованный замах, топор остаётся в стволе, трясёт руками, выдёргивает
  R('chopCold', { dur: 1.0, fn(o, t, a) {
    const T = tgt(o, 11, -10), REST = 0.95, UP = -1.5, L0 = 0.3, HY = -16.2;
    const hit = chopAim(T, L0, 0, HY);
    let b, h;
    // удар в a = 0.37 (Hero IMPACT.chopCold): падение 0.27→0.37 (≈0.1 с), дальше топор стоит в стволе (стоп-кадр)
    if (a < 0.27) { b = lerp(REST, UP, sm(a / 0.27)); h = 0; }
    else if (a < 0.37) { const e = Math.pow((a - 0.27) / 0.1, 1.6); b = lerp(UP, hit.b, e); h = e; }
    else if (a < 0.86) { b = hit.b; h = 1; }
    else { const e = sm((a - 0.86) / 0.14); b = lerp(hit.b, REST, e); h = 1 - e; }
    const w = clamp((REST - b) / (REST - UP), 0, 1), st = a < 0.25 ? 0 : a < 0.37 ? sm((a - 0.25) / 0.12) : a < 0.86 ? 1 : 1 - sm((a - 0.86) / 0.14);
    P.f0x = 3.8; P.f1x = -3.2;
    body(lerp(L0, 0.02, w) + 0.04 * bump(a, 0.8, 0.9), HY + 0.4 * w, obHx(w, st, 0.55));
    axe(b, lerp(11, hit.r, h), lerp(0.1, hit.k, h), hit.c * h); oblique(w, st, 0.55);
    const off = env(a, 0.42, 0.5, 0.72, 0.82);   // руки отпустили топорище
    if (off > 0) {
      const hx0 = P.h0x, hy0 = P.h0y; if (P.tox === null) { P.tox = hx0; P.toy = hy0; } P.two = 0;
      const sh = sin(t * 38) * 1.3 * env(a, 0.48, 0.52, 0.68, 0.74);
      body(P.lean - 0.2 * off, P.hy - 0.4 * off, -0.6 * off);
      P.h0x = lerp(hx0, P.sx + 3.4 + sh, off); P.h0y = lerp(hy0, P.sy + 4.2 + sh * 0.8, off);
      P.h1x = lerp(hx0 - cos(P.ta) * 3.6, P.sx + 2.4 - sh, off); P.h1y = lerp(hy0 - sin(P.ta) * 3.6, P.sy + 5 - sh * 0.6, off);
      P.hl0 = P.hl1 = 2.5; P.eyes = 1; P.mouth = 0.4 * off;
    }
    P.tilt = lerp(0.24, -0.1, w) + 0.12 * off; P.hb = 0.3 * sin(t * 38) * off;
    if (a >= 0.27 && a < 0.38) P.trail = [lerp(UP, b, 0.35), b, lerp(11, hit.r, h) + 17];
    if (a >= 0.37 && a < 0.43) P.spark = 1;
    if (a >= 0.86 && a < 0.9) P.spark = 1;
  } });

  // пурга: сгорблен, короткий низкий боковой мах из-за бедра
  R('chopLow', { dur: 0.9, fn(o, t, a) {
    const T = tgt(o, 11, -10), REST = 1.15, BACK = 2.55, L0 = 0.46, HY = -15.8;
    const hit = chopAim(T, L0, 0.2, HY);
    let b, h;
    if (a < 0.34) { b = lerp(REST, BACK, sm(a / 0.34)); h = 0; }
    else if (a < 0.45) { const e = ((a - 0.34) / 0.11) ** 2; b = lerp(BACK, hit.b, e); h = e; }
    else if (a < 0.56) { b = hit.b + 0.08 * sin(seg(a, 0.45, 0.56) * PI); h = 1; }
    else { const e = sm((a - 0.56) / 0.44); b = lerp(hit.b, REST, e); h = 1 - e; }
    const w = clamp((b - REST) / (BACK - REST), 0, 1), gust = 0.03 * sin(t * 2.1), st = a < 0.32 ? 0 : a < 0.45 ? sm((a - 0.32) / 0.13) : a < 0.6 ? 1 : 1 - sm((a - 0.6) / 0.4);
    P.f0x = 4.8; P.f1x = -4.2; P.f1a = -0.1;
    body(L0 - 0.06 * w + 0.05 * h + gust, HY + 0.4 * w, 0.2 - 0.6 * w + obHx(w, st, 0.5));
    axe(b, lerp(11, hit.r, h), lerp(0.1 + 0.55 * w, hit.k, h), hit.c * h); oblique(w, st, 0.5);   // на замахе топор назад горизонтально, не в снег
    P.tilt = 0.12 - 0.08 * h; P.eyes = 1; P.hb = 0.4 * h;
    if (a >= 0.34 && a < 0.46) P.trail = [lerp(BACK, b, 0.4), b, lerp(11, hit.r, h) + 17];
    if (a >= 0.44 && a < 0.5) P.spark = 1;
  } });

  // ================= прочие действия =================
  R('shakeTree', { dur: 1.2, fn(o, t, a) {
    const T = tgt(o, 8, -14);
    const w = env(a, 0, 0.15, 0.86, 1), s = seg(a, 0.15, 0.86), q = sin(s * PI * 6) * env(a, 0.14, 0.2, 0.8, 0.86);
    P.f0x = 3; P.f1x = -4.2; P.f1a = -0.15;
    const L = reachLean(T, 0.3, -16.3, 0.12, 12.2);
    body(lerp(0.04, L + 0.07 * q, w), lerp(-17.2, -16.3 + 0.3 * q, w), 0.3 * w + 0.7 * q * w);
    handAt(0, T.x + 1.2 * q - 0.4, T.y - 1.2, w); handAt(1, T.x + 1.2 * q + 0.4, T.y + 1.4, w);
    P.hl0 = lerp(6.6, 3, w); P.hl1 = lerp(6.6, 3, w); stow(o);
    P.tilt = lerp(0, -0.55 - L * 0.5, w); P.mouth = 0.4 * Math.abs(q); P.hb = 0.5 * q;
  } });

  // вытоптать площадку у ствола: шаг за шагом по кругу — колено высоко (вытащить ногу из снега), стопа с силой вниз,
  // корпус оседает на каждом шаге, руки в стороны для равновесия (цикл — два шага; само тело ведёт действие, js/actions.js trample)
  R('trample', { loop: true, dur: 1.24, fn(o, t, a) {
    H.idle(o, t); stow(o);
    let dip = 0, sh = 0;
    for (let i = 0; i < 2; i++) {
      const u = (((a - i * 0.5) % 1) + 1) % 1 * 2; if (u > 1) continue;
      const lift = u < 0.5 ? sm(u / 0.5) * 7 : u < 0.78 ? 7 * (1 - sm((u - 0.5) / 0.28)) : 0, fwd = sin(Math.min(1, u / 0.78) * PI) * 1.6;
      dip = Math.max(dip, bump(u, 0.74, 1)); sh = (i ? 0.6 : -0.6) * sm(u / 0.3) * (1 - sm((u - 0.8) / 0.2));
      if (i) { P.f1y = -2 - lift; P.f1x = -1.6 + fwd; P.f1a = lift * 0.06; } else { P.f0y = -2 - lift; P.f0x = 1.3 + fwd; P.f0a = lift * 0.06; }
    }
    body(0.12 + 0.06 * dip, -17.2 + 1.3 * dip, sh);
    hand(0, 5.5, 7 + 1.2 * dip, 0.7); hand(1, 4.5, 7.6 + 1.2 * dip, 0.7); P.hl0 = 7.2; P.hl1 = 7.4;
    P.tilt = 0.14 + 0.08 * dip; P.hb = 1.1 * dip; P.mouth = 0.25 + 0.2 * dip;
  } });
  // перекатить ствол: присел, обе руки под ствол, два толчка от себя (u ≈ 0.3 и 0.8 действия); вдох — выдох
  R('rollLog', { dur: 2.4, fn(o, t, a) {
    const T = tgt(o, 9, -3), k = bendK(T, 12.4, 0.35), p1 = bump(a, 0.12, 0.45), p2 = bump(a, 0.6, 0.95), push = Math.max(p1, p2), w = env(a, 0, 0.1, 0.92, 1);
    bend(k, w); P.f0x = 3.6 + 0.8 * push; P.f1x = -3.6 - 0.6 * push; P.f1a = -0.15;
    body(P.lean + 0.12 * push, P.hy + 0.6 * push, P.hx + 1.6 * push);
    handAt(0, T.x + 1.2 * push - 0.3, T.y - 0.8, w); handAt(1, T.x + 1.2 * push + 0.6, T.y + 0.4, w);
    P.hl0 = lerp(6.6, 2.6, w); P.hl1 = lerp(6.6, 2.2, w); stow(o);
    P.tilt = lerp(0, 0.35, w) - 0.15 * push; P.mouth = 0.5 * push; P.hb = 0.6 * push;
  } });
  // отход от падающей ели: шаг назад-вбок, корпус развёрнут к дереву, ближняя рука вперёд — закрыться (ходьба, своя голова-плечи)
  R('backoff', { loop: true, loco: true, fn(o, t, a, ph, sp) {
    H.gait(ph, St(sp) * 0.8, 0, 1.15, 6);
    body(-0.06 + 0.02 * cos(2 * ph), P.hy + 0.3, 0.2);
    hand(0, 6.6, 1.8, 0.85); P.hl0 = 4.6; H.swingArms(ph, 0.18, 0.2, 0.2, 0.02, 0, 0.7); hand(0, 6.6, 1.8, 0.85);
    P.tw = -0.2; P.tilt = -0.3; P.eyes = 1; P.mouth = 0.4;
  } });

  R('kick', { dur: 0.6, free: true, fn(o, t, a) {
    const T = tgt(o, 10, -4);
    const wd = sm(seg(a, 0, 0.3)), st = a < 0.3 ? 0 : a < 0.42 ? ((a - 0.3) / 0.12) ** 2 : a < 0.5 ? 1 : 1 - sm((a - 0.5) / 0.35);
    const back = a < 0.42 ? wd : 0, ret = sm(seg(a, 0.5, 0.85));
    if (a < 0.3) { P.f0x = lerp(1.3, -3.5, wd); P.f0y = lerp(-2, -6.5, wd); P.f0a = 0.3 * wd; }
    else if (a < 0.5) { P.f0x = lerp(-3.5, T.x, st); P.f0y = lerp(-6.5, T.y, st); P.f0a = lerp(0.3, -0.1, st); }
    else { P.f0x = lerp(T.x, 1.3, ret); P.f0y = lerp(T.y, -2, ret) - 3 * sin(ret * PI); P.f0a = lerp(-0.1, 0, ret); }
    P.f1x = -1.8;
    const k = a < 0.3 ? 0 : st;
    body(0.04 + 0.1 * back - 0.26 * k, -17.2 + 0.7 * k + 0.3 * back, -0.8 * Math.max(back, k));
    handA(0, lerp(1.46, 2.4, k) - 0.4 * back, 12); handA(1, lerp(1.65, 0.5, k) + 0.3 * back, 12);
    P.hl0 = P.hl1 = 6.6 + 2 * k;
    P.tilt = 0.25 * Math.max(back, k); P.mouth = 0.5 * (a > 0.38 && a < 0.55 ? 1 : 0); P.hb = 0.6 * k;
  } });

  R('throw', { dur: 0.7, fn(o, t, a) {
    stow(o);
    // бросок с согнутым локтем: кисть перед грудью к уху и за голову (замах), через верх вперёд (выброс ≈0.55 — метка броска),
    // доводка вниз-вперёд и обратно тем же путём, без полного оборота плеча
    const TX = [[0, R0[0]], [0.16, 5.2], [0.26, 5.2], [0.35, -1], [0.45, -5], [0.51, 1.2], [0.58, 7.6], [0.78, 7.4], [1, R0[0]]];
    const TY = [[0, R0[1]], [0.16, 4.6], [0.26, -3.2], [0.35, -8.6], [0.45, -7.2], [0.51, -9.6], [0.58, -6.6], [0.78, 4.4], [1, R0[1]]];
    const dx = key(a, TX), dy = key(a, TY);
    const wd = env(a, 0, 0.35, 0.45, 0.55), fo = env(a, 0.45, 0.6, 0.78, 1), stp = sm(seg(a, 0.28, 0.5));
    P.f0x = lerp(1.3, 5, stp); P.f0y = -2 - 2.2 * bump(a, 0.28, 0.5); P.f1x = -2.2;
    body(0.04 - 0.16 * wd + 0.36 * fo, -17.2 + 0.4 * fo, -1 * wd + 1.6 * fo);
    handR(0, dx, dy); P.hl0 = 6.6;
    // дальняя рука: вперёд-вверх на замахе, одним плавным ходом вниз-назад на выбросе (без двух наложенных огибающих)
    const fo1 = env(a, 0.42, 0.68, 0.78, 1), b1 = key(a, [[0, 1.65], [0.35, -0.35], [0.45, -0.35], [0.7, 2.1], [0.8, 2.1], [1, 1.65]]);
    handA(1, b1, lerp(RR, 11.2, Math.max(wd, fo1))); P.hl1 = 5;
    P.tilt = -0.14 * wd + 0.1 * fo; P.mouth = 0.5 * bump(a, 0.48, 0.66);
    if (a >= 0.45 && a < 0.6) P.trail = [Math.atan2(-7.2, -5), Math.atan2(dy, dx), 11];
  } });

  R('scoop', { dur: 1.0, fn(o, t, a) {
    stow(o);
    const T = tgt(o, 8, -3), k = bendK(T, 12.6, 0.25), dn = env(a, 0, 0.3, 0.46, 0.7);
    bend(k, dn); P.f0x = 2.6; P.f1x = -2.4;
    const rx = P.sx + R0[0], ry = P.sy + R0[1], Q = [P.sx + cos(-0.55) * 12.4, P.sy + sin(-0.55) * 12.4];
    let x, y;
    if (a < 0.3) { const e = sm(a / 0.3); x = lerp(rx, T.x + 1, e); y = lerp(ry, T.y - 0.4, e); }
    else if (a < 0.45) { const e = sm((a - 0.3) / 0.15); x = lerp(T.x + 1, T.x - 2.6, e); y = lerp(T.y - 0.4, T.y - 1.6, e); }
    else if (a < 0.68) { const e = sm((a - 0.45) / 0.23); x = lerp(T.x - 2.6, Q[0], e); y = lerp(T.y - 1.6, Q[1], e); }
    else { const e = sm((a - 0.68) / 0.32); x = lerp(Q[0], rx, e); y = lerp(Q[1], ry, e); }
    P.h0x = x; P.h0y = y; P.h1x = x + 0.9; P.h1y = y + 0.6; P.hl0 = P.hl1 = 2.5;
    P.tilt = 0.3 * dn - 0.12 * bump(a, 0.5, 0.8); P.mouth = 0.3 * bump(a, 0.55, 0.72); P.hb = 0.5 * bump(a, 0.55, 0.75);
  } });

  // ---------- лопата: одна таблица ключей на тело, руки и черенок (кисти стоят на черенке по построению) ----------
  // ключ: [фаза, совок x, y (риг), угол черенка (0 — вперёд, + — вниз), наклон корпуса, таз, сдвиг таза, стопа ближняя, дальняя, поворот к отвалу 0..1]
  //   0–0.25 толчок вниз-вперёд (ногами), 0.25–0.4 подъём кома (вес — корпус назад), 0.4–0.6 поворот корпуса и шаг к отвалу,
  //   0.6–0.7 бросок (совок вверх-вбок), 0.7–1 возврат. Нижняя кисть — на 12.5 от совка, верхняя (ручка) — на 22; кисть дальше досягаемости
  //   (13 от плеча) — совок подтягивается к телу по той же прямой (кисть с черенка не сходит). Ком на совке — 0.3–0.65 (o.kg — вес).
  const SHK = [
    [0.00, 19, -6, 0.95, 0.50, -16.2, 0.4, 3.6, -3.4, 0],
    [0.25, 23, -2, 1.05, 0.72, -14.6, 1.0, 5.4, -4.2, 0],
    [0.40, 19, -11, 0.55, 0.38, -16.0, 0.2, 4.4, -4.0, 0.25],
    [0.60, 17, -15, 0.25, 0.30, -16.6, -0.4, 3.0, -1.2, 1],
    [0.68, 19, -19, -0.15, 0.34, -16.6, 0.2, 3.0, -1.2, 1],
    [0.76, 18, -12, 0.45, 0.40, -16.4, 0.3, 3.4, -2.6, 0.6],
    [1.00, 19, -6, 0.95, 0.50, -16.2, 0.4, 3.6, -3.4, 0],
  ];
  const SH_L = 12.5, SH_U = 22, SH_R = 13;
  function shovelKey(a) {
    let k = 1; while (k < SHK.length - 1 && SHK[k][0] < a) k++;
    const A0 = SHK[k - 1], B0 = SHK[k], e = sm((a - A0[0]) / (B0[0] - A0[0] || 1)), out = [];
    for (let i = 1; i < A0.length; i++) out.push(lerp(A0[i], B0[i], e));
    return out;
  }
  // руки на черенок: совок (bx, by), угол th → кисти; side — поворот к отвалу (вглубь кадра: обе кисти и черенок в одной плоскости hl)
  function shovelHands(bx, by, th, kg, tw, side) {
    const c = cos(th), s = sin(th), G0 = SH_U - SH_L;
    let x1 = bx - c * SH_L, y1 = by - s * SH_L;
    // обе кисти — в досягаемости плеча (SH_R): сдвиг пары вдоль черенка на t (интервалы для нижней и верхней кисти, ближайший к 0)
    const px = P.sx - x1, py = P.sy - y1, pr = px * c + py * s, q2 = Math.max(0, px * px + py * py - pr * pr);
    const span = r => Math.sqrt(Math.max(0, SH_R * SH_R - q2)), h = span();
    const lo = Math.max(pr - h, pr - h + G0), hi = Math.min(pr + h, pr + h + G0);   // нижняя: |t − pr| ≤ h; верхняя (t − G0): |t − G0 − pr| ≤ h
    const t = lo <= hi ? Math.min(hi, Math.max(lo, 0)) : pr + G0 / 2;
    x1 += c * t; y1 += s * t;
    const x0 = x1 - c * G0, y0 = y1 - s * G0;
    handAt(0, x0, y0, 1); handAt(1, x1, y1, 1);
    const hl = 2.4 + side * 2.2 * tw; P.hl0 = hl; P.hl1 = -hl;   // дальняя рука рисуется с lat −hl1: обе кисти — в одной плоскости черенка
    P.held = ['shovel', x0 + c * 5, y0 + s * 5, th, kg];
  }
  R('shovelThrow', { dur: 1.8, fn(o, t, a) {
    stow(o);
    const k = shovelKey(a), side = o.side || 1, kg = a > 0.3 && a < 0.65 ? (o.kg == null ? 3 : o.kg) : 0, load = kg > 0 ? Math.min(1, kg / 7) : 0;
    P.f0x = k[6]; P.f1x = k[7]; P.f1a = -0.1 * k[8];
    body(k[3] - 0.06 * load, k[4] + 0.4 * load, k[5]);   // ком тяжелее — корпус назад, ниже
    shovelHands(k[0], k[1], k[2], kg, k[8], side);
    P.tilt = 0.18 - 0.1 * k[8] + 0.1 * bump(a, 0.1, 0.3); P.mouth = 0.35 * bump(a, 0.58, 0.72); P.hb = 0.5 * bump(a, 0.6, 0.75) + 0.3 * bump(a, 0.15, 0.3);
    P.hlat = (P.hlat || 0) + 0.8 * side * k[8];   // поворот корпуса к отвалу (таз и корпус вбок)
  } });
  // толкает снег лопатой на ходу: шаг как у ходьбы, корпус вперёд, совок по снегу перед собой
  R('shovelPush', { loop: true, loco: true, fn(o, t, a, ph, sp) {
    H.gait(ph, St(sp), 0, 0.95, 5);
    const c2 = cos(2 * ph);
    body(0.42 + 0.02 * c2, P.hy, 0.6);
    shovelHands(21 + 0.6 * c2, -3 + 0.4 * c2, 0.85, 0, 0, 1);
    P.tilt = 0.1; P.hb = 0.6 * cos(2 * ph + 0.9); stow(o, 1);
  } });

  function warm(o, t, cold) {
    const T = tgt(o, 10, -8), s0 = seedOf(o), j = cold ? sin(t * 45) * (0.25 + 0.3 * clamp(o.frost || 0.5, 0, 1)) : 0;
    P.f0x = 2.8; P.f1x = -2.8; P.br = sin(t * 1.7 + s0);
    body((cold ? 0.36 : 0.2) + 0.012 * P.br, (cold ? -14.4 : -15.6) + 0.15 * P.br, (cold ? 0.4 : -0.3) + 0.3 * j);
    // ладони над огнём, на уровне пояса-груди (не в угли): точка выше огня, дальше — по досягаемости
    const ax = T.x - (cold ? 1 : 2), ay = Math.min(T.y - (cold ? 4 : 5.5), P.sy + (cold ? 9 : 8)), dx = ax - P.sx, dy = ay - P.sy, d = hyp(dx, dy) || 1, r = Math.min(d, 12.4);
    const bx0 = P.sx + dx / d * r, by0 = P.sy + dy / d * r;
    const rub = Math.pow(Math.max(0, sin(t * (cold ? 1.3 : 0.8) + s0)), cold ? 2 : 4), q = sin(t * 16);
    P.h0x = bx0 - 0.4 + 1.2 * q * rub + j * 0.4; P.h0y = by0 - 1.4 + 0.3 * sin(t * 2.3);
    P.h1x = bx0 + 0.4 - 1.2 * q * rub; P.h1y = by0 + 1.2 - 0.3 * sin(t * 2.3);
    P.hl0 = P.hl1 = 3; stow(o);
    P.tilt = (cold ? 0.32 : 0.15) + 0.05 * sin(t * 0.4 + s0) + j * 0.05; P.hb = 0.2 * P.br + j;
    P.eyes = cold ? (sin(t * 0.7 + s0) > 0.6 ? 1 : 0) : (sin(t * 0.5 + s0) > 0.85 ? 1 : 0);
  }
  R('warmHands', { loop: true, fn(o, t) { warm(o, t, false); } });
  R('warmHandsCold', { loop: true, fn(o, t) { warm(o, t, true); } });

  // присел у следов: ладонь в снегу, голова вниз, изредка наклоняет голову
  R('crouch', { loop: true, fn(o, t) {
    const T = tgt(o, 8, -2.5), s0 = seedOf(o), k = bendK(T, 12.6, 0.55), br = sin(t * 1.6 + s0);
    bend(k, 1); P.f0x = 2.6; P.f1x = -2.4; P.f1a = 0.3; P.br = br;
    body(P.lean + 0.015 * br, P.hy + 0.15 * br);
    handAt(0, T.x + 1.4 * sin(t * 0.7 + s0), T.y - 0.4 - 1.2 * Math.max(0, sin(t * 1.3 + s0)), 1); P.hl0 = 3;
    handAt(1, P.hx + 6.5, hip() - 2.5, 1); P.hl1 = 4;
    P.tilt = 0.3 + 0.2 * Math.pow(sin(t * 0.37 + s0), 3); P.hb = 0.2 * br; stow(o);
  } });

  // гладит собаку: присед, медленные поглаживания
  R('pet', { loop: true, fn(o, t) {
    const T = tgt(o, 11, -8), s0 = seedOf(o), k = bendK(T, 12, 0.3), br = sin(t * 1.5 + s0), u = (t / 1.8 + s0) % 1;
    bend(k, 1); P.f0x = 2.6; P.f1x = -2.4; P.f1a = 0.2; P.br = br;
    body(P.lean + 0.02 * br + 0.03 * sin(u * PI * 2), P.hy + 0.1 * br);
    let x, y;
    if (u < 0.6) { const e = sm(u / 0.6); x = lerp(T.x - 1.5, T.x + 3, e); y = lerp(T.y - 1.4, T.y - 0.4, e); }
    else { const e = sm((u - 0.6) / 0.4); x = lerp(T.x + 3, T.x - 1.5, e); y = lerp(T.y - 0.4, T.y - 1.4, e) - 2 * sin(e * PI); }
    handAt(0, x, y, 1); P.hl0 = 3;
    handAt(1, P.hx + 6.5, hip() - 2.8, 1); P.hl1 = 4;
    P.tilt = 0.22 + 0.06 * sin(t * 0.6 + s0); P.hb = 0.2 * br; stow(o);
  } });

  R('call', { dur: 1.0, fn(o, t, a) {
    H.idle(o, t); stow(o);
    const w = env(a, 0, 0.2, 0.8, 1), sh = env(a, 0.3, 0.38, 0.7, 0.8), inh = bump(a, 0.12, 0.32);
    body(0.04 + 0.16 * sh - 0.05 * inh, -17.2 - 0.3 * sh - 0.3 * inh, 0.5 * sh);
    P.tilt = -0.14 * sh;
    const M = headPt(4.8, -1.6);
    handAt(0, M[0] + 0.6, M[1], w); P.hl0 = lerp(6.6, 4.5, w);
    handAt(1, P.hx + 1.8, hip() - 1.5, w); P.hl1 = lerp(6.6, 5.5, w);
    P.mouth = sh * (0.75 + 0.25 * sin(t * 20)); P.br = inh - 0.5 * sh; P.hb = -0.3 * inh + 0.2 * sh * sin(t * 20);
  } });

  function lift(o, t, a, heavy) {
    stow(o);
    const T = tgt(o, 8, -2), k = Math.min(1, bendK(T, 12.6, 0) + (heavy ? 0.15 : 0));
    const A1 = heavy ? 0.33 : 0.45, G1 = heavy ? 0.42 : 0.52, S1 = heavy ? 0.6 : G1, UP1 = heavy ? 0.95 : 0.88;
    const dn = a < A1 ? sm(a / A1) : a < S1 ? 1 : 1 - sm((a - S1) / (UP1 - S1));
    const strain = heavy ? env(a, 0.4, 0.46, 0.8, 0.95) : 0, j = strain * sin(t * 40) * 0.25;
    P.f0x = heavy ? 3 : 2.4; P.f1x = heavy ? -3 : -2.2;
    bend(k, dn); body(P.lean - (heavy ? 0.07 : 0.03) * bump(a, UP1 - 0.2, 1) + j * 0.02, P.hy - (heavy ? 0.3 : 0) * seg(a, G1, S1), P.hx + j * 0.2);
    const cx = P.sx + (heavy ? 6 : 5), cy = P.sy + (heavy ? 9 : 6.5), rx = P.sx + R0[0], ry = P.sy + R0[1];
    let x, y;
    if (a < A1) { const e = sm(a / A1); x = lerp(rx, T.x, e); y = lerp(ry, T.y, e); }
    else if (a < G1) { x = T.x; y = T.y; }
    else { const e = sm(seg(a, G1, UP1)); x = lerp(T.x, cx, e); y = lerp(T.y, cy, e); }
    P.h0x = x + j; P.h0y = y;
    if (heavy) { P.h1x = x - 2.2 - j; P.h1y = y + 0.3; P.hl0 = P.hl1 = 4; }
    else { const e = seg(a, G1, UP1); handR(1, lerp(R1[0], 5.8, e), lerp(R1[1], 7.5, e)); P.hl0 = 3; P.hl1 = lerp(6.6, 3, e); }
    P.tilt = 0.34 * dn - 0.1 * strain; P.mouth = heavy ? 0.5 * strain : 0; P.eyes = strain > 0.5 ? 1 : 0; P.hb = 0.4 * j + 0.4 * bump(a, S1, UP1);
  }
  R('pickUp', { dur: 0.9, fn(o, t, a) { lift(o, t, a, false); } });
  R('pickUpHeavy', { dur: 1.3, fn(o, t, a) { lift(o, t, a, true); } });

  // тянуться вперёд, взяться, потянуть на себя (крышка/дверь)
  R('open', { dur: 0.9, fn(o, t, a) {
    stow(o);
    const T = tgt(o, 12, -12), stp = sm(seg(a, 0, 0.25)) * (1 - sm(seg(a, 0.82, 1))), HX = 1.6 * stp;
    P.f0x = lerp(1.3, 4.2, stp); P.f0y = -2 - 2 * (bump(a, 0, 0.25) + bump(a, 0.82, 1)); P.f1x = -2;
    const L = reachLean(T, 1.6, -16.8, 0.08, 12.4), w = env(a, 0, 0.35, 0.8, 1), pull = sm(seg(a, 0.45, 0.8));
    body(lerp(0.04, L - 0.28 * pull, w), lerp(-17.2, -16.8, w), HX - 0.8 * pull);
    handAt(0, T.x - 6 * pull, T.y - 4 * pull, w); P.hl0 = lerp(6.6, 4, w);
    handR(1, lerp(R1[0], -3, pull * w), lerp(R1[1], 12.4, pull * w));
    P.tilt = 0.2 * w - 0.12 * pull; P.mouth = 0.3 * bump(a, 0.45, 0.7); P.hb = -0.4 * bump(a, 0.45, 0.6);
  } });

  // сидит на бревне, ссутулившись, локти на коленях; изредка голова падает и вздёргивается
  R('rest', { loop: true, fn(o, t) {
    H.sit(o, t);
    const s0 = seedOf(o), br = sin(t * 1.2 + s0), dp = Math.pow(Math.max(0, sin(t * 0.42 + s0)), 6);
    body(0.4 + 0.02 * br + 0.06 * dp, P.hy + 0.2 * br);
    handAt(0, P.hx + 8.2 + 0.3 * sin(t * 0.8), hip() + 0.8, 1); handAt(1, P.hx + 7.6, hip() + 1.3, 1);
    P.hl0 = P.hl1 = 2.5; P.br = br;
    P.tilt = 0.24 + 0.4 * dp; P.eyes = dp > 0.45 ? 1 : 0; P.hb = 0.3 * br + 0.5 * dp; stow(o);
  } });

  // ================= работа у предметов (циклы по t, разовые по a) =================
  // факел в дальней руке, пока ближняя занята разговором
  function holdTorch(o) { if (o.tool !== 'torch') return; handR(1, 4, 9); P.hl1 = 6.2; P.tk = 'torch'; P.ta = -1.1; P.tox = P.h1x; P.toy = P.h1y; P.tlat = -P.hl1; }   // пламя впереди груди, не перед лицом

  // разбирает обшивку: хват за кромку, откинулся и тянет, рывок, перехват
  R('pry', { dur: 1.1, loop: true, fn(o, t) {
    const T = tgt(o, 11, -14), s0 = seedOf(o), u = (t / 1.1 + s0 * 0.37) % 1;
    const grip = 1 - sm(seg(u, 0, 0.16)) * (1 - sm(seg(u, 0.84, 1))), pull = sm(seg(u, 0.16, 0.52)) * (1 - sm(seg(u, 0.84, 1)));
    const jerk = bump(u, 0.52, 0.64), str = env(u, 0.3, 0.4, 0.78, 0.86), tr = sin(t * 41) * str;
    // кромка поддаётся: кисти едут к себе на 2.6 и чуть вниз; перехват — руки отпускают и хватают выше
    const ex = T.x - 2.6 * pull - 1.1 * jerk, ey = T.y + 0.6 * pull - 1.6 * bump(u, 0.86, 1);
    // присел и откинулся на прямых руках: таз ставим так, чтобы плечо было на длину руки от кромки
    const ln = lerp(0.3, -0.3, pull) - 0.1 * jerk + 0.01 * tr, HYr = lerp(-15.6, -11.8, pull) + 0.4 * jerk, SY = HY(HYr) - cos(ln) * SH;
    const RR = lerp(11, 12.9, pull), dy = clamp(ey - SY, -RR + 0.5, RR - 0.5), HX = clamp(ex - Math.sqrt(RR * RR - dy * dy) - sin(ln) * SH, -2.5, 3.5);
    body(ln, HYr, HX);
    P.f0x = HX + 5.2 + 1.5 * pull; P.f1x = HX - 4.6 - 0.8 * pull; P.f1a = -0.15 * pull; P.f0a = 0.05;
    // хват широкий (лист): со спины и в анфас кисти видны по бокам корпуса
    P.h0x = ex - 0.3 + 0.2 * tr; P.h0y = ey - 1.1; P.h1x = ex + 0.4; P.h1y = ey + 1.2 - 0.2 * tr; P.hl0 = 7.6; P.hl1 = 7.2;
    stow(o);
    P.tilt = lerp(0.3, -0.18, pull) - 0.1 * jerk; P.mouth = 0.55 * str + 0.3 * jerk; P.eyes = jerk > 0.4 ? 1 : 0; P.hb = -0.8 * jerk + 0.3 * tr;
  } });

  // подкладывает в печь: присел, взял полено сбоку, затолкал в топку, прикрыл дверцу
  R('feedStove', { dur: 1.0, fn(o, t, a) {
    const T = tgt(o, 10, -8), k = bendK(T, 12.4, 0.45), dn = env(a, 0, 0.16, 0.86, 1);
    bend(k, dn); P.f0x = 3; P.f1x = -2.6; P.f1a = 0.25 * dn;
    const W = [P.hx + 1.5, -3.5], F = [T.x, T.y], Fi = [T.x + 3.2, T.y + 0.3];   // поленница сбоку у ноги, устье, глубже
    let x, y, lat = 3;
    if (a < 0.16) { const e = sm(a / 0.16); x = lerp(P.sx + R0[0], W[0], e); y = lerp(P.sy + R0[1], W[1], e); lat = lerp(6.6, 8.5, e); }
    else if (a < 0.26) { x = W[0]; y = W[1]; lat = 8.5; }
    else if (a < 0.5) { const e = sm(seg(a, 0.26, 0.5)); x = lerp(W[0], F[0], e); y = lerp(W[1], F[1], e) - 3 * sin(e * PI); lat = lerp(8.5, 2, e); }
    else if (a < 0.62) { const e = sm(seg(a, 0.5, 0.62)); x = lerp(F[0], Fi[0], e); y = lerp(F[1], Fi[1], e); lat = 2; }
    else if (a < 0.72) { const e = sm(seg(a, 0.62, 0.72)); x = lerp(Fi[0], F[0] - 3, e); y = lerp(Fi[1], F[1] - 1, e); lat = lerp(2, 5, e); }
    else if (a < 0.84) { const e = seg(a, 0.72, 0.84), p = sin(e * PI); x = F[0] - 3 + 3.6 * p; y = F[1] - 1.5; lat = lerp(5, 1, sm(e * 2)); }   // толчок по дверце
    else { const e = sm(seg(a, 0.84, 1)); x = lerp(F[0] - 3, P.sx + R0[0], e); y = lerp(F[1] - 1.5, P.sy + R0[1], e); lat = lerp(1, 6.6, e); }
    P.h0x = x; P.h0y = y; P.hl0 = lat;
    const two = a > 0.2 && a < 0.62;   // полено — двумя руками
    if (two) { P.h1x = x - 2.4; P.h1y = y + 0.4; P.hl1 = lat - 1; }
    else { handAt(1, P.hx + 5.5, hip() - 1.5, dn); P.hl1 = lerp(6.6, 4, dn); }   // опора на колено
    if (a > 0.2 && a < 0.6) P.held = ['log', x - 1.2, y, -0.15 + 0.2 * seg(a, 0.26, 0.5)];
    stow(o);
    P.tilt = 0.28 * dn + 0.1 * bump(a, 0.45, 0.65); P.hb = 0.4 * bump(a, 0.5, 0.62) + 0.3 * bump(a, 0.72, 0.84);
    P.eyes = a > 0.5 && a < 0.62 ? 1 : 0;
  } });

  // у верстака: ближняя рука постукивает молотком, дальняя держит заготовку и скоблит; голова вниз
  R('craft', { dur: 1.3, loop: true, fn(o, t) {
    const T = tgt(o, 10, -14), s0 = seedOf(o), u = (t / 1.3 + s0 * 0.21) % 1, br = sin(t * 1.6 + s0);
    P.f0x = 2.8; P.f1x = -2.8; P.br = br;
    body(clamp(reachLean(T, 1, -16.8, 0.14, 12.6), 0.14, 0.34) + 0.015 * br, -16.8 + 0.1 * br, 1);   // почти прямо, наклон — головой
    // 0..0.5 — два удара молотком, 0.5..1 — дальняя рука скоблит, молоток лежит у заготовки
    const v = (u * 4) % 1, tap = u < 0.5 ? (v < 0.6 ? sm(v / 0.6) : (1 - seg(v, 0.6, 0.74)) ** 2) : 0, shv = u >= 0.5 ? sin(seg(u, 0.5, 1) * PI * 2) : 0;
    const hx = T.x - 5, hy = T.y - 2.6 - 3.4 * tap;
    P.h0x = hx; P.h0y = hy; P.hl0 = 2.2;
    P.tk = 'hammer'; P.ta = 0.08 - 0.9 * tap;   // удар — рукоять горизонтально, боёк вниз
    P.h1x = T.x + 2.4 + 2.2 * shv; P.h1y = T.y + 0.4 - 0.4 * Math.abs(shv); P.hl1 = 2.6;
    P.tilt = 0.42 + 0.05 * sin(t * 0.7 + s0); P.hb = 0.25 * tap + 0.1 * br;
  } });

  // роется в сундуке: наклон, кисти копаются внутри, изредка достаёт что-то и разглядывает
  R('rummage', { dur: 1.2, loop: true, fn(o, t) {
    const T = tgt(o, 9, -6), s0 = seedOf(o), c = t / 1.2 + s0 * 0.29, u = c % 1, look = Math.floor(c) % 3 === 2 ? env(u, 0.15, 0.35, 0.72, 0.92) : 0;
    const k = bendK(T, 12.4, 0.05), br = sin(t * 1.4 + s0);
    P.f0x = 3; P.f1x = -3; P.br = br;
    bend(k, 1 - 0.6 * look); body(P.lean + 0.015 * br, P.hy, P.hx);
    const q = u * PI * 2;
    handAt(0, T.x + 1.4 * cos(q), T.y + 1.1 * sin(q) - 0.6, 1); P.hl0 = 2.5 + 1.2 * sin(q + 1);
    handAt(1, T.x - 0.6 + 1.3 * cos(q + PI), T.y + 1 * sin(q + PI), 1); P.hl1 = 2.4 + 1.2 * cos(q);
    if (look > 0) { const E = headPt(9.5, -4.5); P.h0x = lerp(P.h0x, E[0], look); P.h0y = lerp(P.h0y, E[1], look); P.hl0 = lerp(P.hl0, 1.5, look); }   // на вытянутой руке перед лицом, не у рта
    P.tilt = lerp(0.35, -0.05, look) + 0.05 * sin(t * 0.9); P.hb = 0.2 * sin(q * 2) * (1 - look);
    P.eyes = 0; stow(o);
  } });

  // слушает собеседника: переступает, кивает, изредка жест дальней рукой; рот закрыт
  R('listen', { dur: 3, loop: true, fn(o, t) {
    H.idle(o, t); const s0 = seedOf(o);
    const sw = sin(t * 0.55 + s0), nod = Math.pow(Math.max(0, sin(t * 1.9 + s0 * 2)), 10) * (sin(t * 0.37 + s0) > -0.2 ? 1 : 0);
    const gw = env((t * 0.16 + s0 * 0.13) % 1, 0.62, 0.7, 0.82, 0.9);
    P.f0x = 1.6 + 0.4 * sw; P.f1x = -1.9 + 0.4 * sw;
    body(0.05 + 0.02 * sw + 0.03 * nod, -17.2 + 0.25 * Math.abs(sw), 0.5 * sw);
    hand(0, R0[0], R0[1] - 0.3, 1); hand(1, 5.8 + 0.8 * sin(t * 2.1), 6.4 + 0.6 * cos(t * 1.7), gw); P.hl1 = lerp(6.6, 4.5, gw);
    P.tilt = 0.06 + 0.16 * nod + 0.05 * sin(t * 0.43 + s0); P.hb = 0.4 * nod;
    P.mouth = 0; stow(o); holdTorch(o);
  } });

  // герой говорит: спокойнее, чем talk у NPC; рот двигается фразами, жест ближней рукой
  R('talkHero', { dur: 2, loop: true, fn(o, t) {
    H.idle(o, t); const s0 = seedOf(o), gt = t * 1.6;
    const ph = sin(t * 0.8 + s0) > -0.55, gw = sm(clamp(sin(t * 0.9 + s0 + 1) * 1.8 + 0.5, 0, 1));
    body(0.06 + 0.02 * sin(t * 1.1), -17.2 + 0.1 * sin(t * 1.9));
    hand(0, 5.6 + 1.6 * sin(gt), 6.8 + 1.8 * cos(gt * 1.2), gw); P.hl0 = lerp(6.6, 4.8, gw);
    hand(1, -1.1, 12, 1);
    P.tilt = 0.04 * sin(t * 3.1) + 0.03; P.mouth = ph ? (sin(t * 11) > 0 ? 0.7 : 0.2) : 0; P.hb = 0.15 * sin(t * 3.1);
    stow(o); holdTorch(o);
  } });

  // ================= действия в мире: лист, предмет в руке, еда, лежанка, мороз =================
  // точка чтения: лист у груди двумя руками, взгляд вниз (одна формула для read / pickPaper / putDown — стыкуются без скачка)
  const RD = () => [P.sx + 6.4, P.sy + 7.2];
  function holdPaper(u, br) {   // u 0..1 — вес «держит у груди»
    const [x, y] = RD(), yy = y - 0.3 * (br || 0);
    return [x, yy, u];
  }
  // поднять/положить лист: u — 0 стоит и читает, 1 — присел и кисть у земли (T); paper — лист в руке
  function paperAt(o, t, u, paper) {
    stow(o);
    const T = tgt(o, 8, -2), k = bendK(T, 12.6, 0.1), br = sin(t * 1.6 + seedOf(o));
    bend(k, u); body(lerp(0.12 + 0.01 * br, P.lean, u), P.hy, P.hx);
    P.f0x = lerp(1.6, 2.6, u); P.f1x = lerp(-1.4, -2.4, u); P.f1a = 0.25 * u;
    const [rx, ry] = holdPaper(1, br), g = sm(clamp((u - 0.55) / 0.45, 0, 1));
    const x = lerp(rx, T.x, g), y = lerp(ry, T.y, g);
    P.h0x = x + 0.4; P.h0y = y - 0.4; P.hl0 = lerp(2.4, 3.2, g);
    const w1 = 1 - sm(clamp((u - 0.2) / 0.5, 0, 1));   // дальняя рука держит лист у груди, у земли — опора на колено
    handAt(1, lerp(P.hx + 5.5, x - 0.8, w1), lerp(hip() - 1.5, y + 0.9, w1), 1); P.hl1 = lerp(4, 1.2, w1);
    if (paper) P.held = ['paper', x - 0.2, y - 1.4 * (1 - g), lerp(-1.25, -0.2, g)];
    P.tilt = lerp(0.46, 0.34, u) + 0.03 * br; P.hb = 0.15 * br; P.br = br;
  }
  R('readNote', { loop: true, fn(o, t) { paperAt(o, t, 0, true); P.eyes = sin(t * 0.8 + seedOf(o)) > 0.93 ? 1 : 0; } });
  // наклон → взять лист с земли → к груди (0.45 — пальцы на листе)
  R('pickPaper', { dur: 1.2, fn(o, t, a) { const u = a < 0.4 ? sm(a / 0.4) : a < 0.48 ? 1 : 1 - sm(seg(a, 0.48, 1)); paperAt(o, t, u, a > 0.42); } });
  // от груди → положить лист обратно (0.6 — отпустил) → выпрямиться
  R('putDown', { dur: 1.0, fn(o, t, a) { const u = a < 0.5 ? sm(a / 0.5) : a < 0.6 ? 1 : 1 - sm(seg(a, 0.6, 1)); paperAt(o, t, u, a < 0.58); } });

  // осмотр: присел вполоборота, руки на коленях, голова к вещи; изредка ближняя рука показывает на неё
  R('inspect', { loop: true, fn(o, t) {
    stow(o);
    const T = tgt(o, 14, -10), s0 = seedOf(o), br = sin(t * 1.5 + s0), low = clamp((T.y + 18) / 16, 0, 1);
    bend(0.3 + 0.35 * low, 1); P.f0x = 2.8; P.f1x = -2.6; P.f1a = 0.2; P.br = br;
    body(P.lean + 0.015 * br, P.hy + 0.12 * br);
    const pt = env((t * 0.23 + s0 * 0.1) % 1, 0.55, 0.65, 0.85, 0.95);
    handAt(0, lerp(P.hx + 6.4, P.sx + 9, pt), lerp(hip() - 1.2, P.sy + 3 - 4 * (1 - low), pt), 1); P.hl0 = lerp(3.6, 3, pt);
    handAt(1, P.hx + 5.8, hip() - 0.6, 1); P.hl1 = 4;
    P.tilt = 0.12 + 0.3 * low + 0.05 * sin(t * 0.5 + s0); P.hb = 0.2 * br;
  } });

  // подобрал вещь: наклон к ней → рассмотрел в руке (≈1 с) → за спину в сумку → руки в покой. o.item — что в руке
  R('takeItem', { dur: 2.2, fn(o, t, a) {
    stow(o);
    const T = tgt(o, 8, -2), low = T.y > -14, k = low ? bendK(T, 12.6, 0) : 0, it = o.item || 'can';
    const dn = low ? (a < 0.2 ? sm(a / 0.2) : a < 0.26 ? 1 : 1 - sm(seg(a, 0.26, 0.42))) : 0;
    bend(k, dn); P.f0x = lerp(1.6, 2.4, dn); P.f1x = lerp(-1.6, -2.2, dn);
    const E = [P.sx + 8.2, P.sy + 1.5], BK = [P.hx - 3.4, hip() - 7], rx = P.sx + R0[0], ry = P.sy + R0[1];
    let x, y, lat = 3, hold = a > 0.22 && a < 0.84;
    if (a < 0.2) { const e = sm(a / 0.2); x = lerp(rx, T.x, e); y = lerp(ry, T.y, e); lat = lerp(6.6, 3, e); }
    else if (a < 0.26) { x = T.x; y = T.y; }
    else if (a < 0.44) { const e = sm(seg(a, 0.26, 0.44)); x = lerp(T.x, E[0], e); y = lerp(T.y, E[1], e); }
    else if (a < 0.7) { const q = seg(a, 0.44, 0.7); x = E[0] + 0.5 * sin(q * PI * 2); y = E[1] - 0.6 * sin(q * PI); }   // рассматривает, чуть поворачивает
    else if (a < 0.86) { const e = sm(seg(a, 0.7, 0.86)); x = lerp(E[0], BK[0], e); y = lerp(E[1], BK[1], e) - 3 * sin(e * PI); lat = lerp(3, 7.5, e); }   // за спину, в сумку
    else { const e = sm(seg(a, 0.86, 1)); x = lerp(BK[0], rx, e); y = lerp(BK[1], ry, e); lat = lerp(7.5, 6.6, e); }
    P.h0x = x; P.h0y = y; P.hl0 = lat;
    handAt(1, low ? lerp(P.sx + R1[0], P.hx + 5.5, dn) : P.sx + R1[0], low ? lerp(P.sy + R1[1], hip() - 1.5, dn) : P.sy + R1[1], 1); P.hl1 = lerp(6.6, 4, dn);
    if (hold) P.held = [it, x - 0.3, y + (it === 'hare' ? 0.6 : -0.6), it === 'hare' ? PI / 2 - 0.15 : -0.3];
    const look = env(a, 0.4, 0.48, 0.66, 0.72);
    P.tilt = 0.3 * dn + look * 0.05 - 0.08 * bump(a, 0.72, 0.86); P.hb = 0.3 * bump(a, 0.26, 0.44) + 0.2 * bump(a, 0.74, 0.86);
    P.mouth = 0.2 * look;
  } });

  // положить в ящик/на полку: наклон к T, кисть внутрь, отпустил, выпрямился
  R('place', { dur: 0.9, fn(o, t, a) {
    stow(o);
    const T = tgt(o, 9, -6), k = bendK(T, 12.4, 0), dn = env(a, 0, 0.35, 0.62, 0.95);
    bend(k, dn); P.f0x = 2.6; P.f1x = -2.4;
    const rx = P.sx + R0[0], ry = P.sy + R0[1], e = sm(seg(a, 0, 0.4)) * (1 - sm(seg(a, 0.6, 0.95)));
    P.h0x = lerp(rx, T.x, e); P.h0y = lerp(ry, T.y, e); P.hl0 = lerp(6.6, 3, e);
    handAt(1, lerp(P.sx + R1[0], P.hx + 5.5, dn), lerp(P.sy + R1[1], hip() - 1.5, dn), 1); P.hl1 = lerp(6.6, 4, dn);
    if (a < 0.5 && o.item) P.held = [o.item, P.h0x - 0.3, P.h0y - 0.5, -0.2];
    P.tilt = 0.3 * dn; P.hb = 0.3 * bump(a, 0.4, 0.6);
  } });

  // еда: дальняя рука держит банку/миску у груди, ближняя — ложкой ко рту (2 захода); кусок/рыбу — обеими руками ко рту
  R('eat', { dur: 1.8, fn(o, t, a) {
    H.idle(o, t); stow(o);
    const it = o.item || 'can', spoon = it === 'can' || it === 'bowl' || it === 'jar', s0 = seedOf(o);
    const w = env(a, 0, 0.14, 0.88, 1), M = headPt(4.4, -2.4), B0 = [P.sx + 6.2, P.sy + 8.2];
    const cyc = seg(a, 0.14, 0.88) * 2, u = cyc % 1, to = cyc >= 2 ? 0 : (u < 0.45 ? sm(u / 0.45) : u < 0.6 ? 1 : 1 - sm(seg(u, 0.6, 1)));
    const chew = a > 0.3 && a < 0.95 ? 0.35 + 0.35 * sin(t * 13) : 0;
    body(0.1 * w + 0.04 * to, -17.2 - 0.2 * w);
    P.f0x = 1.6; P.f1x = -1.6;
    if (spoon) {
      handAt(1, B0[0] - 0.6, B0[1] + 0.8, w); P.hl1 = lerp(6.6, 1.4, w);
      P.held2 = [it === 'can' && a > 0.8 ? 'canE' : it, P.h1x + 0.2, P.h1y - 1.2, 0];
      const x = lerp(B0[0] + 0.4, M[0], to), y = lerp(B0[1] - 1.8, M[1] + 0.4, to);
      handAt(0, x, y, w); P.hl0 = lerp(6.6, 2.4, w);
      P.held = ['spoon', P.h0x - 0.6, P.h0y - 0.4, lerp(-0.2, -0.75, to)];   // ложка — предметом в руке (топор остаётся за спиной)
    } else {
      const x = lerp(B0[0], M[0] + 0.8, to), y = lerp(B0[1] - 1, M[1] + 1, to);
      handAt(0, x, y, w); handAt(1, x - 1.4, y + 0.9, w); P.hl0 = lerp(6.6, 2.4, w); P.hl1 = lerp(6.6, 1.2, w);
      P.held = [it, x + 0.3, y - 0.8, -0.35];
    }
    P.tilt = 0.26 * w - 0.14 * to + 0.02 * sin(t * 2 + s0); P.mouth = to > 0.8 ? 0.5 : chew * w; P.hb = 0.2 * to;
  } });

  // лечь на лежанку / встать: присел на край → откинулся на бок (поворот вокруг таза, как dead) — u 0 стоит, 1 лежит
  function lie(o, t, u) {
    stow(o);
    const c = sm(clamp(u / 0.45, 0, 1)) * (1 - sm(clamp((u - 0.55) / 0.4, 0, 1))), e = sm(clamp((u - 0.35) / 0.65, 0, 1)), FC_ = H.face();
    bend(0.75, c);
    P.f0x = lerp(lerp(1.3, 3, c), 0.8, e); P.f1x = lerp(lerp(-1.6, -2.4, c), -0.2, e);
    P.f0y = P.f1y = -2 + 0.4 * e; P.f0a = P.f1a = -0.45 * e;
    body(lerp(P.lean, -0.04, e), lerp(P.hy, -17.2, e), lerp(P.hx, 0, e));
    handAt(0, lerp(P.hx + 5.5, P.sx + 3, e), lerp(hip() - 1.5, P.sy + 9, e), c + e > 0.01 ? 1 : 0); P.hl0 = lerp(4, 2, e);
    handAt(1, lerp(P.hx + 5.2, P.sx - 2, e), lerp(hip() - 1, P.sy + 11, e), c + e > 0.01 ? 1 : 0); P.hl1 = 4;
    P.tilt = lerp(0.2 * c, -0.25, e); P.eyes = e > 0.9 ? 1 : 0; P.br = sin(t * 1.5);
    P.rot = -FC_ * PI / 2 * e; P.pvx = 0; P.pvy = -19.8; P.oy = 10.5 * e; P.ox = -FC_ * 4 * e;
  }
  R('lieDown', { dur: 1.4, sag: true, fn(o, t, a) { lie(o, t, a); } });
  R('getUp', { dur: 1.4, sag: true, fn(o, t, a) { lie(o, t, 1 - a); } });

  // замерзает: обнял себя, ноги подкашиваются (на колени), заваливается набок и замирает
  R('freezeFall', { dur: 2.4, sag: true, fn(o, t, a) {
    stow(o);
    const kn = sm(seg(a, 0.08, 0.5)), e = sm(seg(a, 0.5, 0.86)), bn = a > 0.86 && a < 0.95 ? sin(seg(a, 0.86, 0.95) * PI) * 0.06 : 0, FC_ = H.face();
    const j = sin(t * 47) * 0.4 * (1 - e);
    bend(0.9, kn); body(P.lean + 0.02 * j, P.hy, P.hx + 0.2 * j);
    P.f0x = lerp(lerp(1.3, 3.2, kn), 0.8, e); P.f1x = lerp(lerp(-1.6, -2.6, kn), -0.2, e); P.f0y = P.f1y = -2 + 0.4 * e; P.f0a = P.f1a = -0.4 * e;
    hug(1, 0.3 * j);
    P.tilt = 0.3 + 0.1 * kn - 0.3 * e; P.eyes = a > 0.7 ? 1 : 0; P.mouth = 0.25 * (1 - e) * (sin(t * 29) > 0.3 ? 1 : 0);
    P.rot = -FC_ * (PI / 2 * e - bn); P.pvx = 0; P.pvy = -19.8; P.oy = 15.3 * e; P.ox = -FC_ * 2 * e; P.hb = j;
  } });
  // ================= погода: против ветра (выбор — gfx.js по Ctx/Wind; o.wind −1 ветер в спину … +1 в лицо, o.gust 0..1) =================
  // стоит в пурге: наклон навстречу ветру ∝ силе и порыву, ближняя рука прикрывает лицо, дальняя придерживает капюшон; ноги шире
  R('braceWind', { loop: true, fn(o, t) {
    H.idle(o, t); const s0 = seedOf(o), w = clamp(o.wind == null ? 1 : o.wind, -1, 1), gu = clamp(o.gust || 0, 0, 1);
    const sway = 0.04 * sin(t * 1.9 + s0) * (0.5 + gu);
    P.f0x = 3.2; P.f1x = -3.4;
    body(clamp(0.05 + 0.2 * w * (0.6 + 0.4 * gu), -0.12, 0.3) + sway, -16.9 + 0.3 * gu, 0.6 * w);
    const F = headPt(6, 0.6);
    const face = w > -0.3 ? 1 : 0.35;   // ветер в спину — лицо не прикрывает, руки у груди
    P.h0x = lerp(P.sx + 1.4, F[0] + 0.3 * sin(t * 12), face); P.h0y = lerp(P.sy + 12, F[1] + 0.3 * sin(t * 10), face); P.hl0 = lerp(6.6, 1, face);
    hand(1, 4.8, 3.8 + 0.4 * sin(t * 3 + s0), 1); P.hl1 = 3.2;
    P.tilt = 0.28 * Math.max(0, w) + 0.12 + 0.03 * sin(t * 1.3); P.eyes = w > 0.2 ? 1 : 0; P.hb = 0.3 * sway;
    stow(o, 1);
  } });
  // идёт по ветру (ветер в спину): прямо, чуть откинут, голова в плечи, руки близко к телу, шаг короче — не рвёт вперёд
  R('windBack', { loop: true, loco: true, fn(o, t, a, ph, sp) {
    H.gait(ph, St(sp), 0, 0.85);
    const gu = clamp(o.gust || 0, 0, 1), r = H.runW();
    body(0.02 + 0.07 * r - 0.05 * gu + 0.02 * cos(2 * ph), P.hy + 0.3);   // бегом по ветру — лёгкий наклон вперёд, порыв выпрямляет
    // руки ближе к телу, но мах по скорости: шагом — маятник чуть короче обычного, на скорости — руки бега
    P.hl0 = P.hl1 = 5.8; H.swingArms(ph - 0.35, 0.22, 0.35, 0.22, 0.05, r, 0.9);
    P.tilt = 0.24 + 0.03 * sin(2 * ph); P.hb = 0.4 * cos(2 * ph + 0.9);
    stow(o, 1);
  } });

  // ================= глубокий снег и полынья (js/depth.js, js/ice.js): ниже линии снега/воды фигуру обрезает gfx.js =================
  // по пояс и глубже: «плывёт» — наклон вперёд, руки гребком над снегом по очереди (ноги как trudge, их не видно)
  R('wade', { loop: true, loco: true, free: true, fn(o, t, a, ph, sp) {
    AP.POSE.trudge.fn(o, t, a, ph, sp, H);
    const sn = sin(ph), c = cos(ph);
    body(0.4 + 0.05 * cos(2 * ph), P.hy + 0.5, P.hx + 0.5);
    handR(0, 7 + 3.6 * sn, -1 - 3.4 * Math.max(0, c)); handR(1, 6.5 - 3.6 * sn, -0.5 - 3.4 * Math.max(0, -c));
    P.hl0 = P.hl1 = 9.6; P.mouth = 0.45 + 0.3 * Math.max(0, cos(2 * ph)); P.tilt = -0.1; P.br = 0.8;
  } });
  // лёд проломился: руки вскинуты, откинулся, рот открыт (провал рисует обрезка)
  R('iceFall', { dur: 0.5, sag: true, fn(o, t, a) {
    H.idle(o, t); const e = sm(a / 0.35);
    body(0.04 - 0.16 * e, -17.2 + 1.2 * e);
    handR(0, lerp(R0[0], 4.5, e), lerp(R0[1], -13.5, e)); handR(1, lerp(R1[0], -3.5, e), lerp(R1[1], -12.5, e)); P.hl0 = P.hl1 = 8.5;
    P.mouth = e; P.tilt = -0.22 * e; P.eyes = 0;
  } });
  // в воде по грудь: холодовой шок — судорожно хватает воздух, руки бьют по воде перед собой
  R('iceSlap', { loop: true, dur: 0.8, fn(o, t, a) {
    H.idle(o, t); const w = sin(a * PI * 2), w2 = sin(a * PI * 2 + PI);
    body(0.14 + 0.04 * w, -17.2 + 0.5 * w);
    handR(0, 8 + 2 * w, 1 + 5 * Math.max(0, w)); handR(1, 6 + 2 * w2, 2 + 5 * Math.max(0, w2)); P.hl0 = P.hl1 = 9;
    P.mouth = 0.55 + 0.35 * Math.max(0, sin(t * 6)); P.tilt = -0.18; P.br = 1;
  } });
  // хватается за кромку: грудью к льду, руки вперёд на лёд, подтягивается
  R('iceGrab', { loop: true, dur: 0.8, fn(o, t, a) {
    H.idle(o, t); const w = sin(a * PI * 2);
    body(0.55 + 0.06 * w, -17.2 + 0.4 * w, 1.5);
    handR(0, 12.5 + 0.8 * w, 2.5 + 0.6 * w); handR(1, 11.5 - 0.8 * w, 3.2); P.hl0 = P.hl1 = 7;
    P.mouth = 0.4 + 0.3 * Math.max(0, w); P.tilt = -0.25;
  } });
  // ползком от полыньи: лежит грудью на льду (поворот вокруг таза вперёд), руки вперёд по очереди, ноги толкаются
  R('iceCrawl', { loop: true, dur: 0.8, sag: true, fn(o, t, a) {
    H.idle(o, t); const FC_ = H.face(), w = sin(a * PI * 2), w2 = sin(a * PI * 2 + PI);
    body(0.02, -17.2);
    handR(0, 2 + 3 * Math.max(0, w), -13.5 - 2 * w); handR(1, 1 + 3 * Math.max(0, w2), -13 - 2 * w2); P.hl0 = P.hl1 = 5;
    P.f0x = 1.3 + 2 * w; P.f1x = -1.6 + 2 * w2; P.f0y = -2 - 1.2 * Math.max(0, w); P.f1y = -2 - 1.2 * Math.max(0, w2);
    P.tilt = -0.35; P.mouth = 0.35;
    P.rot = FC_ * (PI / 2 - 0.08); P.pvx = 0; P.pvy = -19.8; P.oy = 15.5 + 0.5 * w; P.ox = FC_ * 1.5 * w;
  } });
  // откатывается от полыньи: лёжа, руки прижаты, корпус перекатывается (подскок и крен)
  R('iceRoll', { dur: 0.9, sag: true, fn(o, t, a) {
    H.idle(o, t); const FC_ = H.face(), r = Math.abs(sin(a * PI * 2));
    body(0.02, -17.2); hug(1);
    P.f0x = 0.6; P.f1x = -0.4; P.f0y = P.f1y = -2;
    P.tilt = 0.3 * sin(a * PI * 4); P.eyes = r > 0.6 ? 1 : 0;
    P.rot = FC_ * (PI / 2 - 0.1 - 0.25 * r); P.pvx = 0; P.pvy = -19.8; P.oy = 15.5 - 2.2 * r; P.ox = FC_ * 2 * sin(a * PI * 2);
  } });
  // с живота — на четвереньки (руки в снег, колени на снегу), потом встаёт; a 0 — лёжа, 1 — стоит
  R('iceUp', { dur: 1.2, fn(o, t, a) {
    H.idle(o, t); const k = sm(seg(a, 0, 0.4)), e = sm(seg(a, 0.45, 1)), FC_ = H.face();
    body(lerp(1.3, 0.06, e), lerp(-8.8, -17.2, e), lerp(-3, 0, e));
    const gx = P.sx + 2, gy = -2.6;
    handAt(0, lerp(gx + 1, P.sx + R0[0], e), lerp(gy, P.sy + R0[1], e), 1); handAt(1, lerp(gx - 1.2, P.sx + R1[0], e), lerp(gy + 0.5, P.sy + R1[1], e), 1);
    P.hl0 = 6; P.hl1 = 6;
    P.f0x = lerp(-5.5, 1.3, e); P.f1x = lerp(-7.5, -1.6, e); P.f0y = P.f1y = -2; P.f0a = P.f1a = lerp(-0.6, 0, e);
    const pr = 1 - k; if (pr > 0.01) { P.rot = FC_ * PI / 2 * pr * 0.85; P.pvx = 0; P.pvy = -19.8; P.oy = 13 * pr; }
    P.tilt = -0.2 * (1 - e); P.mouth = 0.3; P.br = 1 - e;
  } });
  // выкарабкивается из глубокого снега (Depth.climb, js/depth.js): упор руками в бровку впереди, корпус вперёд, ближнее колено высоко — шаг наверх,
  // задняя нога толкает; тело поднимает убывающий провал (o.deep, см), к концу — выпрямился, руки отпустил
  R('climbOut', { dur: 1.2, fn(o, t, a) {
    H.idle(o, t); stow(o, 1);
    const rim = -(o.deep || 0) * 0.23 - 0.6;   // бровка в координатах рига: фигура опущена на провал
    const rc = sm(seg(a, 0, 0.22)), up = sm(seg(a, 0.35, 0.95)), rel = sm(seg(a, 0.7, 0.98)), w = rc * (1 - rel);
    body(lerp(0.08, 0.62, rc) - 0.5 * up, -17.2 + 2.4 * rc * (1 - up), 1.4 * rc * (1 - up));
    handAt(0, lerp(P.sx + R0[0], 10.5, w), lerp(P.sy + R0[1], rim, w), 1); handAt(1, lerp(P.sx + R1[0], 8.2, w), lerp(P.sy + R1[1], rim + 0.5, w), 1);
    P.hl0 = P.hl1 = lerp(6.6, 8.6, w);
    const kn = bump(a, 0.12, 0.8), pl = sm(seg(a, 0.2, 0.5)) * (1 - sm(seg(a, 0.75, 1)));
    P.f0x = lerp(1.3, 5.6, pl); P.f0y = -2 - 9 * kn; P.f0a = -0.3 * kn;          // колено высоко — стопа на бровку
    P.f1x = lerp(-1.6, -4.6, bump(a, 0.25, 0.95)); P.f1a = 0.5 * bump(a, 0.3, 0.9); // задняя толкает носком
    P.tilt = -0.18 * w; P.mouth = 0.35 + 0.3 * bump(a, 0.3, 0.8); P.br = 1; P.hb = 0.6 * sin(a * PI * 3);
  } });
})();
