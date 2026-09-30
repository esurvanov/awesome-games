'use strict';
// ArtZones — рисунок 8 зон «Сибири 2.0» (A4): земля зоны в кусках снега, горелый сухостой, глыбы,
// уникальные объекты (бочка, балок, берлога, тур, буровая, метеостанция, «Урал», фактория, стойбище),
// транспорт (упряжка, «Буран»), бурелом. Стиль и приёмы — как в art-world.js: вид сверху 3/4,
// палитра-24 (PAL), статика — в кэше ArtWorld.sprite (масштаб rdpr × ступень зума), живое — поверх.
const ArtZones = (() => {
  const TAU = Math.PI * 2, W_ = ArtWorld;
  const { sprite, el, rr, poly, line, lg, rg, shadow } = W_;
  const SN = '#f6f9fc', SN2 = '#dde6ee', SN3 = '#b6c9df', INK = '#27394a', STONE = '#6c7178';
  const CHAR = '#2a2522', CHAR2 = '#191614', CHAR3 = '#4a3f38';
  const snowCap = (g, x, y, rx, ry) => { el(g, x, y, rx, ry, SN); el(g, x - rx * 0.25, y - ry * 0.3, rx * 0.55, ry * 0.5, '#ffffff'); };

  // ================= горелый сухостой (вид дерева 3) =================
  // кэш 110×170, опора (55,160) — как у ели; s — ступень размера, v — вариант (наклон, высота, сучья)
  function paintBurnt(g, s, v) {
    const r = W_.rng(71 + v * 13 + Math.round(s * 10)), hgt = (v ? 118 : 132) * s, lean = (v ? 0.06 : -0.04);
    shadow(g, 0, 1, 16 * s, 4.4 * s, 0.4);
    g.save(); g.transform(1, 0, -lean, 1, 0, 0);
    // ствол: сужается, обломанная верхушка
    const w0 = 5 * s, w1 = 1.6 * s;
    g.fillStyle = CHAR; g.beginPath(); g.moveTo(-w0, 0); g.lineTo(-w1, -hgt); g.lineTo(-w1 * 0.2, -hgt - 7 * s); g.lineTo(w1 * 0.6, -hgt + 2 * s); g.lineTo(w1, -hgt + 5 * s); g.lineTo(w0, 0); g.closePath(); g.fill();
    g.fillStyle = CHAR2; g.beginPath(); g.moveTo(w0 * 0.2, 0); g.lineTo(w1 * 0.3, -hgt + 3 * s); g.lineTo(w1, -hgt + 5 * s); g.lineTo(w0, 0); g.fill();
    g.fillStyle = CHAR3; g.beginPath(); g.moveTo(-w0 * 0.85, 0); g.lineTo(-w1 * 0.9, -hgt * 0.9); g.lineTo(-w1 * 0.4, -hgt * 0.9); g.lineTo(-w0 * 0.45, 0); g.fill();
    // трещины угля — светлые насечки
    g.fillStyle = 'rgba(108,113,120,0.55)';
    for (let k = 0; k < 9; k++) { const yy = -r() * hgt * 0.85, ww = (w0 - (w0 - w1) * (-yy / hgt)); g.fillRect(-ww * 0.7 + r() * ww, yy, ww * 0.5, 0.9 * s); }
    // обломки сучьев вверх, со снегом
    g.lineCap = 'round';
    for (let k = 0; k < 5; k++) {
      const y0 = -hgt * (0.35 + r() * 0.55), side = k % 2 ? 1 : -1, L = (6 + r() * 12) * s, ang = 0.5 + r() * 0.6;
      const x1 = side * (w1 + Math.cos(ang) * L), y1 = y0 - Math.sin(ang) * L;
      line(g, CHAR, 1.6 * s, side * w1, y0, x1, y1);
      el(g, x1 - side * 1.2 * s, y1 - 0.8 * s, 2.4 * s, 1 * s, SN);
    }
    el(g, 0, -hgt - 1 * s, 2.2 * s, 1.2 * s, SN);
    g.restore();
    // снег у комля, обугленная кора в снегу
    if (W_.trunkWell) W_.trunkWell(g, s, v, 0.9, 7129); // воронка-наддув, как у ели
    if (W_.rootsInSnow) W_.rootsInSnow(g, s, 4.6, [[-1, 9, CHAR], [1, 8, CHAR3]]); // обугленные корни уходят под снег
  }

  // ================= глыба =================
  const ROCK = [
    [[-22, 0], [-24, -10], [-14, -22], [2, -26], [16, -20], [24, -8], [20, 0]],
    [[-18, 0], [-20, -14], [-6, -24], [10, -22], [20, -12], [18, 0]],
    [[-26, 0], [-22, -12], [-10, -18], [6, -20], [22, -14], [26, -2]],
  ];
  function paintRock(g, v) {
    const P = ROCK[v % 3];
    shadow(g, 2, 1, 28, 7, 0.4);
    el(g, 0, 0, 22, 2.6, 'rgba(39,57,74,0.3)'); // AO: плотная кромка у снега
    poly(g, '#4e535d', ...P.flat());
    // светлая грань (свет с юго-запада) и тёмная северо-восточная
    g.save(); g.beginPath(); g.moveTo(P[0][0], P[0][1]); for (const [x, y] of P) g.lineTo(x, y); g.closePath(); g.clip();
    g.fillStyle = lg(g, -24, -20, 20, 0, [[0, '#9aa0a8'], [0.5, STONE], [1, '#3c4048']]); g.fillRect(-30, -30, 60, 32);
    g.strokeStyle = 'rgba(39,57,74,0.45)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-6, -24); g.lineTo(-2, -12); g.lineTo(8, -6); g.moveTo(-14, -8); g.lineTo(-4, -2); g.stroke();
    el(g, -6, -8, 5, 2, 'rgba(111,142,168,0.35)'); // лишайник
    g.restore();
    // снежная шапка
    const top = P.reduce((a, b) => (b[1] < a[1] ? b : a));
    g.fillStyle = lg(g, 0, top[1] - 4, 0, top[1] + 8, [[0, '#ffffff'], [1, SN2]]);
    g.beginPath(); g.ellipse(top[0] - 2, top[1] + 3, 15, 5.5, -0.1, 0, TAU); g.fill();
    el(g, -18, 0.5, 8, 2, SN); el(g, 14, 1, 6, 1.6, SN2);
  }
  function rock(g, q) {
    const S = sprite('rock' + q.v, 60, 36, g2 => { g2.translate(30, 30); paintRock(g2, q.v); });
    const k = q.s; g.drawImage(S, q.x - 30 * k, q.y - 30 * k, 60 * k, 36 * k);
  }

  // ================= земля зон: печётся в кусках снега (gfx bakeStatic) =================
  const TINT = {
    naled: [159, 208, 238, 0.5], gar: [80, 84, 92, 0.28], kurum: [108, 113, 120, 0.18], golets: [182, 201, 223, 0.35],
    drill: [111, 104, 92, 0.1], meteo: [182, 201, 223, 0.12], zimnik: [182, 201, 223, 0.1], stoibishe: [199, 154, 98, 0.1],
  };
  const BLOB = {};
  function blob(id) {
    if (BLOB[id]) return BLOB[id];
    const [r, g0, b, a] = TINT[id], c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${r},${g0},${b},${a})`); gr.addColorStop(0.6, `rgba(${r},${g0},${b},${a * 0.6})`); gr.addColorStop(1, `rgba(${r},${g0},${b},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return (BLOB[id] = c);
  }
  // g — в мировых координатах (bakeStatic), область X..X+w × Y..Y+h (полоса куска)
  function bakeGround(g, X, Y, w, h, seed) {
    if (!Zones.built) return;
    const C = Zones.C, i0 = Math.max(0, Math.floor(X / C) - 1), i1 = Math.min(Zones.NX - 1, Math.floor((X + w) / C) + 1);
    const j0 = Math.max(0, Math.floor(Y / C) - 1), j1 = Math.min(Zones.NY - 1, Math.floor((Y + h) / C) + 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * Zones.NX + i, zi = Zones.zid(k); if (!zi) continue;
      const id = Zones.IDS[zi - 1]; if (id === 'core') continue;
      const s = Zones.str(k) / 255, cx = i * C + C / 2, cy = j * C + C / 2;
      if (s > 0.02) { g.globalAlpha = s; g.drawImage(blob(id), cx - C, cy - C, C * 2, C * 2); g.globalAlpha = 1; }
      const r = W_.rng((k * 2654435761) ^ seed), ter = Zones.TKEYS[Zones.ter(k)];
      DETAIL[id] && DETAIL[id](g, cx - C / 2, cy - C / 2, C, s, r, ter);
    }
  }
  const DETAIL = {
    naled(g, x, y, C, s, r) {
      if (s < 0.3 || r() < 0.35) return;
      // натёки льда: голубые линзы с бликом, трещины
      for (let n = 0, m = r() < 0.4 ? 2 : 1; n < m; n++) {
        const px = x + r() * C, py = y + r() * C, rx = 10 + r() * 34, ry = rx * (0.3 + r() * 0.2);
        el(g, px, py, rx, ry, 'rgba(159,208,238,0.55)'); el(g, px - rx * 0.2, py - ry * 0.3, rx * 0.6, ry * 0.35, 'rgba(246,249,252,0.7)');
        if (r() < 0.5) line(g, 'rgba(111,142,168,0.5)', 0.8, px - rx * 0.6, py, px + rx * 0.2, py + ry * 0.5, px + rx * 0.7, py - ry * 0.2);
      }
    },
    gar(g, x, y, C, s, r) {
      if (s < 0.2) return;
      g.fillStyle = 'rgba(42,37,34,0.55)';
      for (let n = 0; n < 7; n++) g.fillRect(x + r() * C, y + r() * C, 1 + r() * 2.5, 1 + r());
      if (r() < 0.45) { // валежник
        const px = x + r() * C, py = y + r() * C, a = (r() - 0.5) * 1.2, L = 16 + r() * 22;
        line(g, CHAR, 2.2, px, py, px + Math.cos(a) * L, py + Math.sin(a) * L * 0.5); line(g, SN, 1, px + 2, py - 1.4, px + Math.cos(a) * L * 0.8, py + Math.sin(a) * L * 0.4 - 1.4);
      }
    },
    kurum(g, x, y, C, s, r) {
      if (s < 0.2) return;
      for (let n = 0; n < 4; n++) {
        const px = x + r() * C, py = y + r() * C, rx = 3 + r() * 6;
        el(g, px + 1, py + 1, rx, rx * 0.5, 'rgba(39,57,74,0.25)'); el(g, px, py, rx, rx * 0.55, r() < 0.5 ? STONE : '#888e96'); el(g, px - 0.5, py - rx * 0.25, rx * 0.7, rx * 0.25, SN);
      }
    },
    golets(g, x, y, C, s, r, ter) {
      if (ter === 'stlanik') { // стланик: низкие «лапы» кедра под снегом
        if (s < 0.1) return;
        for (let n = 0; n < 3; n++) {
          const px = x + r() * C, py = y + r() * C, rx = 10 + r() * 12;
          el(g, px + 2, py + 2, rx, rx * 0.4, 'rgba(39,57,74,0.22)');
          el(g, px, py, rx, rx * 0.42, '#1c4034'); el(g, px - rx * 0.3, py - rx * 0.12, rx * 0.5, rx * 0.22, '#2f5a3a');
          el(g, px + rx * 0.1, py - rx * 0.18, rx * 0.75, rx * 0.2, SN);
        }
        return;
      }
      // голец: заструги ветра и выдутый камень
      g.strokeStyle = 'rgba(246,249,252,0.9)'; g.lineWidth = 1.4; g.beginPath();
      for (let n = 0; n < 3; n++) { const px = x + r() * C, py = y + r() * C, L = 18 + r() * 30; g.moveTo(px, py); g.quadraticCurveTo(px + L / 2, py - 3, px + L, py + 1); }
      g.stroke();
      g.strokeStyle = 'rgba(111,142,168,0.35)'; g.lineWidth = 1; g.beginPath();
      for (let n = 0; n < 2; n++) { const px = x + r() * C, py = y + r() * C + 2, L = 14 + r() * 24; g.moveTo(px, py); g.quadraticCurveTo(px + L / 2, py - 2, px + L, py + 1); }
      g.stroke();
      if (r() < 0.35) { const px = x + r() * C, py = y + r() * C; el(g, px, py, 6, 2.6, STONE); el(g, px - 1, py - 1, 4, 1.2, '#888e96'); }
    },
    drill(g, x, y, C, s, r, ter) {
      if (ter !== 'camp') return;
      // пятна солярки и следы
      if (r() < 0.35) el(g, x + r() * C, y + r() * C, 8 + r() * 10, 3 + r() * 3, 'rgba(39,57,74,0.2)');
      if (r() < 0.5) { const px = x + r() * C, py = y + r() * C; el(g, px, py, 3, 1.4, 'rgba(111,142,168,0.3)'); el(g, px + 7, py + 4, 3, 1.4, 'rgba(111,142,168,0.3)'); }
    },
    meteo(g, x, y, C, s, r, ter) {
      if (ter !== 'camp' || r() < 0.5) return;
      const px = x + r() * C, py = y + r() * C; el(g, px, py, 3, 1.4, 'rgba(111,142,168,0.3)'); el(g, px + 7, py + 4, 3, 1.4, 'rgba(111,142,168,0.3)'); // следы
    },
    stoibishe(g, x, y, C, s, r, ter) {
      if (s < 0.3) return;
      // натоптано оленями: парные следы, копанки ягеля
      g.fillStyle = 'rgba(111,142,168,0.35)';
      for (let n = 0; n < (ter === 'camp' ? 6 : 3); n++) { const px = x + r() * C, py = y + r() * C; g.fillRect(px, py, 1.6, 2.4); g.fillRect(px + 2.4, py, 1.6, 2.4); }
      if (r() < 0.25) { const px = x + r() * C, py = y + r() * C; el(g, px, py, 7, 3, 'rgba(111,142,168,0.28)'); el(g, px, py - 0.5, 4, 1.4, 'rgba(111,104,92,0.35)'); }
    },
  };

  // ================= объекты зон =================
  // [w, h, ax, ay, paint]: статика в кэше; опора (ax, ay)
  const OBJ = {
    iceBarrel: [48, 40, 24, 30, g => {
      el(g, 0, 0, 22, 7, 'rgba(159,208,238,0.7)'); el(g, -4, -1.5, 12, 3, 'rgba(246,249,252,0.8)');
      g.save(); g.rotate(-0.35);
      rr(g, -7, -20, 14, 20, 3, '#7c241c'); g.fillStyle = '#b8392d'; g.fillRect(-7, -20, 5, 20); g.fillStyle = '#4e1a14'; g.fillRect(-7, -13, 14, 1.6); g.fillRect(-7, -6, 14, 1.6);
      el(g, 0, -20, 7, 2.4, '#b6c9df'); el(g, -0.6, -20.4, 6, 1.8, SN);
      g.restore();
      el(g, 0, 0.5, 12, 3, 'rgba(159,208,238,0.9)'); el(g, 4, -0.4, 6, 1.4, '#ffffff');
    }],
    burntBalok: [130, 100, 65, 80, g => {
      shadow(g, 0, 2, 60, 12, 0.4);
      // стены: чёрные брёвна, правый угол обвалился
      for (let k = 0; k < 6; k++) { const yy = -8 - k * 8, w = k > 3 ? 70 - (k - 3) * 22 : 96; rr(g, -48, yy - 7, w, 7.4, 3.6, k % 2 ? CHAR : CHAR3); el(g, -48 + w, yy - 3.3, 3.6, 3.6, '#352b25'); }
      g.fillStyle = CHAR2; g.fillRect(-40, -44, 16, 26); // проём двери
      g.fillStyle = 'rgba(255,106,26,0.12)'; g.fillRect(-39, -30, 14, 10);
      // провалившаяся крыша: две балки и лист жести
      line(g, CHAR, 4, -50, -56, 10, -70); line(g, CHAR, 4, -20, -58, 40, -32);
      g.save(); g.translate(22, -40); g.rotate(0.35); rr(g, -16, -6, 32, 12, 1, '#6c7178'); g.fillStyle = '#4e535d'; for (let x = -14; x < 16; x += 5) g.fillRect(x, -6, 1.2, 12); rr(g, -16, -7.5, 32, 3, 1.5, SN); g.restore();
      // снег и табличка
      rr(g, -50, -58, 50, 5, 2.5, SN); el(g, 40, -4, 16, 4, SN); el(g, -44, 2, 18, 4, SN2);
      rr(g, 10, -24, 24, 10, 1, '#b8392d'); g.fillStyle = '#f6f9fc'; g.fillRect(13, -21, 18, 1.4); g.fillRect(13, -18, 12, 1.4);
    }],
    den: [150, 100, 75, 76, g => {
      shadow(g, 0, 2, 70, 14, 0.42);
      // тёмный зев под глыбами
      el(g, 4, -10, 22, 13, '#10271f'); el(g, 4, -8, 16, 8, '#0b120e');
      for (const [x, y, sc, v] of [[-38, 0, 1.4, 0], [44, 2, 1.3, 1], [2, -22, 1.6, 2], [-20, -30, 1.1, 1], [30, -30, 1.1, 0]]) {
        g.save(); g.translate(x, y); g.scale(sc, sc); paintRock(g, v); g.restore();
      }
      // кости и клочья шерсти у входа
      line(g, '#e3d5b6', 2, -8, 6, 4, 9); el(g, -9, 6, 2, 1.6, '#e3d5b6'); el(g, 5, 9, 2, 1.6, '#e3d5b6');
      el(g, 18, 4, 4, 2, '#5b3d27'); el(g, 20, 3.4, 2.4, 1, '#8a6a45');
    }],
    gurii: [90, 130, 45, 118, g => {
      g.scale(1.45, 1.45); // ориентир гольца — крупнее
      shadow(g, 3, 1, 24, 6, 0.45);
      // сложенные камни конусом
      const rows = [[-18, 0, 36], [-14, -9, 28], [-10, -17, 20], [-6, -24, 12]];
      for (const [x, y, w] of rows) for (let k = 0; k < w; k += 7) { el(g, x + k + 3.5, y - 4, 4.4, 4.2, k % 14 ? STONE : '#888e96'); el(g, x + k + 2.6, y - 6, 2.6, 1.4, '#9aa0a8'); }
      line(g, '#5b3d27', 2.4, 0, -28, 0, -66); line(g, '#8a6a45', 0.9, -0.6, -29, -0.6, -65);
      // трёхгранная пирамидка-визир и флажок
      poly(g, '#8a6a45', -6, -52, 6, -52, 0, -70);
      g.fillStyle = '#b8392d'; g.beginPath(); g.moveTo(0, -66); g.lineTo(13, -62); g.lineTo(0, -58); g.fill();
      el(g, -2, -30, 9, 3, SN); el(g, -6, -18, 6, 2, SN); el(g, -12, 1, 12, 3, SN);
    }],
    rig: [150, 250, 75, 236, g => {
      shadow(g, 10, 2, 62, 14, 0.42);
      // ноги вышки (сужаются кверху), раскосы
      g.lineCap = 'round';
      const top = -210, legs = [[-40, 0, -8], [40, 0, 8], [-26, -14, -5], [26, -14, 5]];
      for (const [x, y, tx] of legs) line(g, y ? '#4e535d' : STONE, y ? 3 : 3.6, x, y, tx, top);
      g.strokeStyle = '#4e535d'; g.lineWidth = 1.4; g.beginPath();
      for (let k = 0; k < 7; k++) {
        const t0 = k / 7, t1 = (k + 1) / 7, xa = -40 + 32 * t0, xb = -40 + 32 * t1, ya = top * t0, yb = top * t1;
        g.moveTo(xa, ya); g.lineTo(-xb, yb); g.moveTo(-xa, ya); g.lineTo(xb, yb); g.moveTo(xa, ya); g.lineTo(-xa, ya);
      }
      g.stroke();
      // рабочая площадка и будка бурильщика
      rr(g, -48, -30, 96, 8, 1, '#5b3d27'); g.fillStyle = '#3a2618'; g.fillRect(-48, -24, 96, 2);
      rr(g, 22, -58, 34, 28, 2, '#3f6f7a'); g.fillStyle = '#2f5561'; g.fillRect(44, -58, 12, 28); rr(g, 26, -52, 10, 8, 1, '#a4bad1');
      rr(g, 20, -61, 38, 4, 2, SN);
      // кронблок наверху, красная полоса, трос
      rr(g, -12, top - 10, 24, 12, 2, '#b8392d'); g.fillStyle = '#7c241c'; g.fillRect(2, top - 10, 10, 12);
      line(g, '#27394a', 0.9, 0, top, 0, -30);
      rr(g, -14, top - 13, 28, 4, 2, SN);
      for (let k = 1; k < 7; k += 2) { const t = k / 7; el(g, -40 + 32 * t, top * t - 1, 3.4, 1.2, SN); el(g, 40 - 32 * t, top * t - 1, 3.4, 1.2, SN); }
      el(g, -30, 2, 18, 4, SN); el(g, 30, 3, 16, 3.4, SN2);
    }],
    balokSkid: [110, 90, 55, 70, g => {
      shadow(g, 4, 2, 52, 11, 0.42);
      // сани-полозья
      g.lineCap = 'round'; line(g, '#27394a', 3, -48, 0, 44, 0); line(g, '#27394a', 3, 44, 0, 50, -6); line(g, '#27394a', 2.4, -44, -4, 40, -4);
      // корпус: жесть бирюзой №17, крыша дугой, окно, дверь, труба
      rr(g, -44, -50, 88, 46, 3, '#3f6f7a'); g.fillStyle = '#2f5561'; g.fillRect(14, -50, 30, 46);
      g.fillStyle = 'rgba(16,39,31,0.25)'; for (let x = -40; x < 44; x += 8) g.fillRect(x, -48, 1, 42);
      g.fillStyle = '#6c7178'; g.beginPath(); g.moveTo(-46, -50); g.quadraticCurveTo(0, -64, 46, -50); g.lineTo(46, -48); g.lineTo(-46, -48); g.fill();
      g.fillStyle = SN; g.beginPath(); g.moveTo(-46, -51); g.quadraticCurveTo(0, -66, 46, -51); g.quadraticCurveTo(0, -58, -46, -51); g.fill();
      rr(g, -32, -40, 18, 14, 1, '#27394a'); // окно (свет — поверх)
      rr(g, 20, -40, 16, 36, 1, '#2f3542'); el(g, 32, -22, 1.4, 1.4, '#ffd27a');
      rr(g, -20, -72, 5, 16, 1, '#4e535d'); rr(g, -21.5, -74, 8, 3, 1, '#27394a');
      rr(g, 18, -4, 20, 4, 1, '#5b3d27'); // ступенька
      el(g, -36, 2, 14, 3, SN); el(g, 40, 4, 10, 2.6, SN2);
    }],
    barrels: [90, 50, 45, 40, g => {
      shadow(g, 0, 2, 40, 8, 0.35);
      const B = (x, y, c, c2) => { rr(g, x - 7, y - 20, 14, 20, 3, c2); g.fillStyle = c; g.fillRect(x - 7, y - 20, 5, 20); g.fillStyle = 'rgba(16,39,31,0.5)'; g.fillRect(x - 7, y - 13, 14, 1.5); g.fillRect(x - 7, y - 6, 14, 1.5); el(g, x, y - 20, 7, 2.4, '#b6c9df'); el(g, x - 0.6, y - 20.5, 6, 1.8, SN); };
      B(-24, -4, '#b8392d', '#7c241c'); B(-8, -8, '#2f5a3a', '#1c4034'); B(8, -4, '#b8392d', '#7c241c');
      // лежачая бочка
      g.save(); g.translate(28, 0); rr(g, -12, -12, 24, 12, 5, '#1c4034'); g.fillStyle = '#2f5a3a'; g.fillRect(-12, -12, 24, 4); el(g, 12, -6, 3, 6, '#10271f'); rr(g, -10, -14, 20, 3, 1.5, SN); g.restore();
      el(g, -16, 1, 14, 3, SN); el(g, 20, 2, 12, 2.6, SN2);
    }],
    kern: [70, 44, 35, 34, g => {
      shadow(g, 0, 2, 32, 7, 0.35);
      for (const [x, y] of [[-16, -2], [12, 0], [-2, -14]]) {
        rr(g, x - 13, y - 10, 26, 10, 1, '#8a6a45'); g.fillStyle = '#5b3d27'; g.fillRect(x - 13, y - 2, 26, 2);
        for (let k = 0; k < 4; k++) rr(g, x - 11 + k * 6, y - 9, 5, 6, 2.5, k % 2 ? '#888e96' : STONE);
        rr(g, x - 13, y - 11.5, 26, 2.4, 1.2, SN);
      }
    }],
    meteoHouse: [170, 140, 85, 110, g => {
      shadow(g, 6, 2, 76, 14, 0.42);
      // сруб
      for (let k = 0; k < 7; k++) { const yy = -6 - k * 8; rr(g, -64, yy - 7.4, 128, 7.6, 3.8, k % 2 ? '#5b3d27' : '#76593a'); el(g, -64, yy - 3.6, 3.8, 3.8, '#c79a62'); el(g, 64, yy - 3.6, 3.8, 3.8, '#c79a62'); }
      // крыша
      g.fillStyle = '#4e535d'; g.beginPath(); g.moveTo(-74, -60); g.lineTo(-40, -96); g.lineTo(40, -96); g.lineTo(74, -60); g.closePath(); g.fill();
      g.fillStyle = lg(g, 0, -100, 0, -60, [[0, '#ffffff'], [1, SN2]]); g.beginPath(); g.moveTo(-72, -62); g.lineTo(-40, -97); g.lineTo(40, -97); g.lineTo(72, -62); g.quadraticCurveTo(0, -72, -72, -62); g.fill();
      rr(g, 30, -112, 8, 18, 1, '#6c7178'); rr(g, 29, -114, 10, 3, 1, SN);
      // окна (свет — поверх), дверь, вывеска
      for (const x of [-46, -16]) { rr(g, x, -44, 18, 16, 1, '#27394a'); g.fillStyle = '#c79a62'; g.fillRect(x + 8, -44, 1.6, 16); g.fillRect(x, -37, 18, 1.6); }
      rr(g, 20, -48, 20, 42, 1, '#3a2618'); g.fillStyle = '#5b3d27'; g.fillRect(22, -46, 16, 38); el(g, 36, -26, 1.4, 1.4, '#ffd27a');
      line(g, '#8a6a45', 3, 44, -10, 36, -30); // лопата подпирает дверь
      rr(g, -18, -58, 36, 9, 1, '#e3d5b6'); g.fillStyle = '#27394a'; g.fillRect(-14, -55, 28, 1.4); g.fillRect(-10, -52, 20, 1.2);
      el(g, -50, 2, 24, 4, SN); el(g, 50, 3, 20, 4, SN2);
    }],
    mast: [70, 220, 35, 210, g => {
      shadow(g, 6, 1, 16, 4, 0.4);
      // растяжки
      g.strokeStyle = 'rgba(39,57,74,0.6)'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(0, -150); g.lineTo(-30, 4); g.moveTo(0, -150); g.lineTo(30, 4); g.moveTo(0, -100); g.lineTo(-22, 6); g.stroke();
      rr(g, -2.6, -200, 5.2, 200, 1, '#888e96'); g.fillStyle = '#4e535d'; g.fillRect(0.6, -200, 2, 200);
      g.fillStyle = '#b8392d'; for (let y = -200; y < -20; y += 36) g.fillRect(-2.6, y, 5.2, 12);
      for (let y = -180; y < -10; y += 12) line(g, '#4e535d', 1, -5, y, 5, y); // перекладины
      el(g, -1, -12, 4, 1.4, SN); el(g, -10, 2, 10, 3, SN);
    }],
    booth: [44, 80, 22, 70, g => {
      shadow(g, 2, 1, 16, 4, 0.38);
      for (const x of [-10, 10]) line(g, '#8a6a45', 2.2, x, 0, x, -36);
      rr(g, -14, -60, 28, 26, 1, '#f6f9fc'); g.fillStyle = SN3; for (let y = -57; y < -36; y += 4) g.fillRect(-12, y, 24, 1.2); g.fillRect(4, -60, 10, 26);
      poly(g, '#dde6ee', -17, -60, 0, -68, 17, -60); rr(g, -16, -65, 32, 4, 2, '#ffffff');
      el(g, -2, 1, 12, 3, SN);
    }],
    journal: [28, 26, 14, 20, g => {
      shadow(g, 0, 1, 10, 3, 0.3);
      rr(g, -9, -12, 18, 12, 1, '#5b3d27'); g.fillStyle = '#3a2618'; g.fillRect(-9, -3, 18, 3); // ящик
      g.save(); g.translate(0, -13); g.rotate(-0.1); rr(g, -7, -5, 14, 9, 1, '#3f6f7a'); g.fillStyle = '#e3d5b6'; g.fillRect(-6, -4, 12, 7); g.fillStyle = '#27394a'; g.fillRect(-4.5, -2.5, 8, 0.8); g.fillRect(-4.5, -0.5, 6, 0.8); g.restore();
      el(g, -5, -17, 3, 1, SN);
    }],
    ural: [180, 110, 90, 86, g => {
      shadow(g, 4, 2, 84, 14, 0.44);
      // колёса
      for (const x of [-60, -10, 26, 58]) { el(g, x, -4, 11, 9, '#27394a'); el(g, x, -4, 5, 4, '#4e535d'); el(g, x - 2, -12, 7, 2, SN); }
      // рама и цистерна
      rr(g, -74, -22, 146, 10, 2, '#1c4034');
      rr(g, -40, -54, 108, 34, 16, '#888e96'); g.fillStyle = lg(g, 0, -54, 0, -20, [[0, '#b6c9df'], [0.5, '#888e96'], [1, '#4e535d']]); g.beginPath(); g.roundRect(-40, -54, 108, 34, 16); g.fill();
      g.fillStyle = '#4e535d'; for (const x of [-10, 26]) g.fillRect(x, -54, 2, 34);
      rr(g, 6, -60, 14, 6, 2, '#6c7178'); rr(g, -40, -57, 108, 6, 3, SN);
      g.fillStyle = '#b8392d'; g.fillRect(-30, -36, 30, 5); g.fillStyle = '#f6f9fc'; g.fillRect(-27, -35, 24, 1.4);
      // кабина
      rr(g, -78, -58, 36, 38, 4, '#2f5a3a'); g.fillStyle = '#1c4034'; g.fillRect(-56, -58, 14, 38);
      rr(g, -74, -52, 18, 12, 2, '#a4bad1'); g.fillStyle = 'rgba(246,249,252,0.5)'; g.fillRect(-72, -51, 4, 10);
      rr(g, -80, -30, 12, 8, 2, '#27394a'); // бампер
      rr(g, -79, -62, 38, 6, 3, SN);
      el(g, -66, -20, 5, 3, '#ffd27a'); // фара (мёртвая)
      el(g, 70, 4, 18, 4, SN); el(g, -84, 3, 12, 3, SN2);
    }],
    factory: [180, 140, 90, 110, g => {
      shadow(g, 6, 2, 80, 14, 0.42);
      for (let k = 0; k < 7; k++) { const yy = -6 - k * 8; rr(g, -70, yy - 7.4, 140, 7.6, 3.8, k % 2 ? '#645240' : '#8a6a45'); el(g, 70, yy - 3.6, 3.8, 3.8, '#c79a62'); }
      g.fillStyle = '#5b3d27'; g.beginPath(); g.moveTo(-80, -58); g.lineTo(0, -98); g.lineTo(80, -58); g.closePath(); g.fill();
      g.fillStyle = lg(g, 0, -100, 0, -58, [[0, '#ffffff'], [1, SN2]]); g.beginPath(); g.moveTo(-78, -60); g.lineTo(0, -99); g.lineTo(78, -60); g.quadraticCurveTo(0, -70, -78, -60); g.fill();
      rr(g, -40, -104, 8, 20, 1, '#6c7178'); // труба
      rr(g, -50, -46, 20, 16, 1, '#27394a'); g.fillStyle = '#8a6a45'; g.fillRect(-41, -46, 1.6, 16);
      rr(g, -10, -50, 24, 44, 1, '#3a2618'); g.fillStyle = '#5b3d27'; g.fillRect(-8, -48, 20, 40); el(g, 9, -28, 1.4, 1.4, '#ffd27a');
      // вывеска «ФАКТОРИЯ» — штрихами
      rr(g, -46, -70, 92, 12, 1, '#e3d5b6'); g.fillStyle = '#b8392d'; for (let k = 0; k < 8; k++) g.fillRect(-40 + k * 10.5, -67, 7, 6);
      // весы у входа
      rr(g, 28, -18, 22, 4, 1, '#6c7178'); line(g, '#4e535d', 2, 39, -18, 39, -30); rr(g, 30, -34, 18, 3, 1, '#888e96');
      el(g, -60, 2, 22, 4, SN); el(g, 60, 3, 18, 4, SN2);
    }],
    // избушка Кочениных: низкий сруб, плоская крыша в снегу, поленница и шкура на стене
    lodge: [120, 96, 60, 78, g => {
      shadow(g, 4, 2, 54, 11, 0.42);
      for (let k = 0; k < 5; k++) { const yy = -6 - k * 8; rr(g, -46, yy - 7.4, 92, 7.6, 3.8, k % 2 ? '#5b3d27' : '#76593a'); el(g, -46, yy - 3.6, 3.6, 3.6, '#c79a62'); el(g, 46, yy - 3.6, 3.6, 3.6, '#c79a62'); }
      g.fillStyle = '#473930'; g.beginPath(); g.moveTo(-54, -44); g.lineTo(-36, -62); g.lineTo(36, -62); g.lineTo(54, -44); g.closePath(); g.fill();
      g.fillStyle = lg(g, 0, -64, 0, -44, [[0, '#ffffff'], [1, SN2]]); g.beginPath(); g.moveTo(-52, -46); g.lineTo(-36, -63); g.lineTo(36, -63); g.lineTo(52, -46); g.quadraticCurveTo(0, -54, -52, -46); g.fill();
      rr(g, 22, -76, 6, 16, 1, '#6c7178'); rr(g, 21, -78, 8, 3, 1, SN);
      rr(g, -34, -36, 16, 13, 1, '#27394a'); g.fillStyle = '#c79a62'; g.fillRect(-27, -36, 1.4, 13);
      rr(g, 4, -40, 16, 34, 1, '#3a2618'); el(g, 17, -22, 1.2, 1.2, '#ffd27a');
      // шкура соболя на гвозде и поленница
      g.fillStyle = '#5b3d27'; g.beginPath(); g.moveTo(-6, -38); g.lineTo(-2, -38); g.lineTo(0, -24); g.lineTo(-8, -24); g.fill();
      for (let k = 0; k < 3; k++) for (let j = 0; j < 4 - k; j++) el(g, 36 + j * 5 + k * 2.5, -4 - k * 5, 2.6, 2.6, j % 2 ? '#c79a62' : '#8a6a45');
      el(g, -34, 2, 16, 3.4, SN); el(g, 40, 3, 12, 3, SN2);
    }],
    // заимка староверов: сруб с тесовой крышей, ограда из жердей, восьмиконечный крест над воротами
    zaimka: [200, 150, 100, 116, g => {
      shadow(g, 4, 2, 90, 16, 0.4);
      // сруб стоит на земле; ограда — впереди, ниже опоры
      for (let k = 0; k < 7; k++) { const yy = -6 - k * 8; rr(g, -44, yy - 7.4, 88, 7.6, 3.8, k % 2 ? '#645240' : '#8a6a45'); el(g, -44, yy - 3.6, 3.8, 3.8, '#c79a62'); el(g, 44, yy - 3.6, 3.8, 3.8, '#c79a62'); }
      g.fillStyle = '#5b3d27'; g.beginPath(); g.moveTo(-54, -62); g.lineTo(0, -92); g.lineTo(54, -62); g.closePath(); g.fill();
      g.fillStyle = lg(g, 0, -94, 0, -62, [[0, '#ffffff'], [1, SN2]]); g.beginPath(); g.moveTo(-52, -64); g.lineTo(0, -93); g.lineTo(52, -64); g.quadraticCurveTo(0, -72, -52, -64); g.fill();
      rr(g, 20, -100, 7, 18, 1, '#6c7178');
      rr(g, -30, -46, 16, 14, 1, '#27394a'); g.fillStyle = '#c79a62'; g.fillRect(-23, -46, 1.4, 14); g.fillRect(-30, -40, 16, 1.4);
      rr(g, 8, -50, 18, 44, 1, '#3a2618'); el(g, 23, -28, 1.3, 1.3, '#ffd27a');
      g.lineCap = 'round';
      for (const x of [-96, -76, -56, 56, 76, 96]) line(g, '#5b3d27', 2.6, x, 26, x, 4);
      for (const y of [18, 10]) { line(g, '#8a6a45', 2, -98, y, -48, y + 1); line(g, '#8a6a45', 2, 48, y + 1, 98, y); }
      // ворота с восьмиконечным крестом
      line(g, '#5b3d27', 3, -40, 26, -40, -8); line(g, '#5b3d27', 3, 40, 26, 40, -8); line(g, '#5b3d27', 3, -42, -6, 42, -6);
      line(g, '#3a2618', 2, 0, -6, 0, -32); line(g, '#3a2618', 1.6, -7, -22, 7, -22); line(g, '#3a2618', 1.2, -4, -27, 4, -27); line(g, '#3a2618', 1.2, -4, -14, 4, -18);
      el(g, -70, 27, 26, 3.6, SN); el(g, 72, 28, 24, 3.4, SN2); rr(g, -98, 3, 50, 2.4, 1.2, SN); rr(g, 48, 3, 50, 2.4, 1.2, SN);
    }],
    // вешка почты: полосатый столб, жестяной ящик, флажок
    post: [44, 96, 22, 88, g => {
      shadow(g, 2, 1, 12, 3, 0.36);
      rr(g, -2.4, -78, 4.8, 78, 1, '#e3d5b6'); g.fillStyle = '#b8392d'; for (let y = -78; y < -4; y += 16) g.fillRect(-2.4, y, 4.8, 8);
      rr(g, -11, -58, 22, 15, 2, '#3f6f7a'); g.fillStyle = '#2f5561'; g.fillRect(-11, -50, 22, 7); rr(g, -8, -55, 16, 2, 1, '#27394a');
      g.fillStyle = '#ffd27a'; g.fillRect(-4, -47, 8, 2);
      g.fillStyle = '#b8392d'; g.beginPath(); g.moveTo(2, -78); g.lineTo(16, -74); g.lineTo(2, -70); g.fill();
      rr(g, -12, -60, 24, 3, 1.5, SN); el(g, 0, 1, 10, 3, SN);
    }],
    // склад Толяна: брезент горбом под снегом, торчат бочка и ящик
    stash: [110, 60, 55, 44, g => {
      shadow(g, 0, 2, 48, 9, 0.35);
      g.fillStyle = '#5d6b52'; g.beginPath(); g.moveTo(-46, 0); g.quadraticCurveTo(-30, -38, 0, -36); g.quadraticCurveTo(34, -36, 46, 0); g.closePath(); g.fill();
      g.fillStyle = '#3a4a36'; g.beginPath(); g.moveTo(10, -34); g.quadraticCurveTo(34, -34, 46, 0); g.lineTo(26, 0); g.fill();
      line(g, '#3a2618', 1.2, -30, -24, 30, -24); line(g, '#3a2618', 1.2, -40, -10, 40, -10);
      g.fillStyle = SN; g.beginPath(); g.moveTo(-36, -24); g.quadraticCurveTo(-20, -44, 4, -40); g.quadraticCurveTo(30, -40, 38, -22); g.quadraticCurveTo(0, -30, -36, -24); g.fill();
      rr(g, -44, -14, 12, 14, 2, '#7c241c'); g.fillStyle = '#b8392d'; g.fillRect(-44, -14, 4, 14);
      rr(g, 30, -12, 16, 12, 1, '#8a6a45'); g.fillStyle = '#5b3d27'; g.fillRect(30, -6, 16, 1.4);
      el(g, -10, 2, 30, 3.6, SN2);
    }],
    // промысловый участок: кол с жестяной биркой (люди — поверх, когда открыт)
    plot: [40, 60, 20, 52, g => {
      shadow(g, 1, 1, 8, 2.4, 0.34);
      line(g, '#5b3d27', 3, 0, 0, 0, -44);
      rr(g, -10, -44, 20, 12, 1, '#e3d5b6'); g.fillStyle = '#27394a'; g.fillRect(-7, -41, 14, 1.4); g.fillRect(-7, -37, 10, 1.4);
      rr(g, -11, -46, 22, 3, 1.5, SN); el(g, 0, 1, 8, 2.4, SN);
    }],
    rodPole: [60, 130, 30, 120, g => {
      shadow(g, 2, 1, 12, 3.4, 0.38);
      line(g, '#5b3d27', 3.6, 0, 0, 0, -110); line(g, '#8a6a45', 1.2, -1, -1, -1, -108);
      for (const y of [-40, -64, -86]) { el(g, 0, y, 5, 3.4, '#e3d5b6'); el(g, -2, y - 2, 1.6, 1.4, '#3a2618'); el(g, 2, y - 2, 1.6, 1.4, '#3a2618'); } // черепа
      rr(g, -4, -112, 8, 4, 2, SN);
      el(g, -2, 1, 10, 3, SN);
    }],
  };
  const lit = new Set(['balokSkid', 'meteoHouse', 'factory', 'lodge', 'zaimka']);
  const WIN = { balokSkid: [[-32, -40, 18, 14]], meteoHouse: [[-46, -44, 18, 16], [-16, -44, 18, 16]], factory: [[-50, -46, 20, 16]], lodge: [[-34, -36, 16, 13]], zaimka: [[-30, -46, 16, 14]] };
  // «спот» без записи в NPCS — статист (напарники вахты): облик o.look
  const SPOT_LOOK = { vakhta2: 'vakhta', vakhta3: 'bich' };
  // люди на открытом участке: работа по кругу (рубят, строят, стоят)
  const CREW_ANIM = ['chop', 'build', 'idle'];
  const REG = {}; // живые объекты рисунка (флюгер, ленты, пар) по id
  // объект зоны o (Zones.OBJS) — по опоре; env — ENV рендера
  function obj(g, o, env) {
    const E = env, night = E.night || 0;
    if (o.type === 'chum') { g.drawImage(W_.spr('chum'), o.x - 65, o.y - 120, 130, 140); if (o.light) E.light(o.x, o.y - 10, 100, 'w', 0.6); return; }
    if (o.type === 'sleds') { W_.sled(g, o.x - 20, o.y, 3, 1); W_.sled(g, o.x + 26, o.y + 16, 0, -1); return; }
    if (o.type === 'steam') return; // земля: steamGround
    if (o.type === 'spot') {
      if (!o.npc || typeof NPCS !== 'undefined' && NPCS[o.npc]) return; // настоящий персонаж — рисует исполнитель NPC
      const look = ArtPeople.LOOKS[o.look || SPOT_LOOK[o.npc]] || ArtPeople.LOOKS.bich, face = G && G.p ? (Math.sign(G.p.x - o.x) || 1) : 1;
      ArtPeople.draw(g, { key: o, x: o.x, y: o.y, face, t: E.now, anim: 'idle', look, tool: 'none', seed: o.x | 0 }, E);
      return;
    }
    if (o.need && typeof Zones !== 'undefined' && !Zones.here(o)) return; // объект по условию — ещё не открыт
    const D = OBJ[o.type]; if (!D) return;
    const [w, h, ax, ay, paint] = D;
    g.drawImage(sprite('z' + o.type, w, h, g2 => { g2.translate(ax, ay); paint(g2); }), o.x - ax, o.y - ay, w, h);
    // живое поверх: окна ночью, флюгер, ленты, дым
    if (lit.has(o.type)) {
      for (const [x, y, ww, hh] of WIN[o.type]) {
        g.fillStyle = `rgba(255,${190 - night * 20},${90},${0.25 + night * 0.7})`; g.fillRect(o.x + x + 1, o.y + y + 1, ww - 2, hh - 2);
        if (night > 0.3) E.glow(o.x + x + ww / 2, o.y + y + hh / 2, 0.6);
      }
      E.light(o.x, o.y - 20, 150, 'w', 0.55);
      if (o.type !== 'balokSkid' || true) wispAt(g, o, E);
    }
    if (o.type === 'mast') {
      const t = E.now * (2.5 + (E.wind || 1)), x = o.x, y = o.y - 204;
      line(g, '#27394a', 1.4, x, y + 6, x, y - 2);
      for (let k = 0; k < 3; k++) { const a = t + k * TAU / 3, cxx = x + Math.cos(a) * 7, cyy = y - 2 + Math.sin(a) * 2.4; line(g, '#27394a', 1, x, y - 2, cxx, cyy); el(g, cxx, cyy, 2.2, 1.6, '#b8392d'); }
      const va = Math.sin(E.now * 0.7) * 0.4; line(g, '#27394a', 1.6, x, y + 10, x + Math.cos(va) * 14, y + 10 + Math.sin(va) * 3); poly(g, '#27394a', x + Math.cos(va) * 14, y + 10 + Math.sin(va) * 3, x + Math.cos(va) * 10, y + 6, x + Math.cos(va) * 10, y + 14);
      if (night > 0.3 && E.now % 1.6 < 0.8) E.glow(x, o.y - 196, 0.5);
    }
    if (o.type === 'plot') {
      // открытый участок: двое за работой (облики — ZONES[zone].plot.crew), костерок между ними
      const P = ZONES[o.zone] && ZONES[o.zone].plot;
      if (P && G && G.plots && G.plots[o.zone]) {
        const crew = P.crew || ['bich'];
        for (let k = 0; k < crew.length; k++) {
          const x = o.x - 34 + k * 68, y = o.y + 18 + k * 6, an = CREW_ANIM[(k + Math.floor(E.now / 6)) % CREW_ANIM.length];
          ArtPeople.draw(g, { key: o.id + k, x, y, face: k ? -1 : 1, t: E.now, anim: an, animT: (E.now * 0.8 + k * 0.4) % 1, look: crew[k], tool: an === 'chop' ? 'axe' : 'none', seed: 11 + k }, E);
        }
        E.light(o.x, o.y + 14, 90, 'w', 0.4);
      }
    }
    if (o.type === 'rodPole') {
      const t = E.now, cols = ['#b8392d', '#3f6f7a', '#ffd27a', '#e3d5b6'];
      for (let k = 0; k < 4; k++) {
        const y0 = o.y - 104 + k * 6, wv = Math.sin(t * 3 + k) * 3 * (E.wind || 1) * 0.6;
        g.strokeStyle = cols[k]; g.lineWidth = 2; g.beginPath(); g.moveTo(o.x + 1, y0); g.quadraticCurveTo(o.x + 10, y0 + 4 + wv, o.x + 18 + wv, y0 + 12); g.stroke();
      }
      el(g, o.x - 4, o.y - 100 + Math.sin(t * 2) * 1.2, 2.2, 2.6, '#f8bc63');
    }
  }
  function wispAt(g, o, E) {
    const ch = { meteoHouse: [34, -114], factory: [-36, -106], balokSkid: [-17, -74], lodge: [25, -80], zaimka: [23, -104] }[o.type]; if (!ch) return;
    const x = o.x + ch[0], y = o.y + ch[1];
    if (state === 'play' && typeof FX !== 'undefined' && !UI.modal()) FX.emit('zs' + o.id, 2, (parts, r) => parts.push({ type: 'smoke', x, y, vx: (r() - 0.5) * 8, vy: -18 - r() * 8, life: 2.6, max: 2.6 }));
  }
  // промоина с паром (слой земли)
  function steamGround(g, o, E) {
    el(g, o.x, o.y, 30, 12, 'rgba(159,208,238,0.9)');
    el(g, o.x, o.y, 22, 8, '#3f6f7a'); el(g, o.x + 3, o.y + 1.5, 16, 5, '#27394a');
    el(g, o.x - 8, o.y - 3, 7, 1.4, 'rgba(246,249,252,0.5)');
    g.strokeStyle = '#f6f9fc'; g.lineWidth = 1.4; g.beginPath(); g.ellipse(o.x, o.y, 23, 8.6, 0, Math.PI * 1.05, Math.PI * 1.9); g.stroke();
    if (state === 'play' && typeof FX !== 'undefined' && !UI.modal()) FX.emit('st' + o.id, 2.5, (parts, r) => parts.push({ type: 'breath', x: o.x + (r() - 0.5) * 30, y: o.y - 4, vx: (r() - 0.5) * 6 + 4, vy: -8 - r() * 8, life: 2.2, max: 2.2 }));
  }
  // бурелом: упавший горелый ствол (слой земли)
  function fallenLog(g, f) {
    const ex = f.x + Math.cos(f.a) * f.len, ey = f.y + Math.sin(f.a) * f.len * 0.6;
    g.lineCap = 'round';
    line(g, 'rgba(39,57,74,0.28)', 9, f.x + 2, f.y + 3, ex + 2, ey + 3);
    line(g, CHAR, 7, f.x, f.y, ex, ey); line(g, CHAR3, 2, f.x - 1, f.y - 2, ex - 1, ey - 2);
    for (let k = 1; k < 4; k++) { const t = k / 4, x = f.x + (ex - f.x) * t, y = f.y + (ey - f.y) * t; line(g, CHAR, 1.6, x, y, x + 6, y - 7); }
    el(g, (f.x + ex) / 2, (f.y + ey) / 2 - 3, f.len * 0.3, 1.8, SN);
  }

  // ================= транспорт =================
  // «Буран»: снегоход 3/4 сбоку, нос по face; broken — в снегу, без фары
  function paintBuran(g, broken) {
    shadow(g, 0, 2, 34, 7, 0.4);
    g.lineCap = 'round';
    line(g, '#27394a', 3, -30, 0, 22, 0); line(g, '#27394a', 2.6, 22, 0, 28, -5);           // лыжа
    rr(g, -30, -8, 30, 7, 2, '#27394a'); g.fillStyle = '#4e535d'; for (let x = -28; x < 0; x += 4) g.fillRect(x, -7, 2, 5); // гусеница
    g.fillStyle = '#b8392d'; g.beginPath(); g.moveTo(-30, -8); g.lineTo(-28, -18); g.lineTo(6, -21); g.quadraticCurveTo(22, -20, 26, -9); g.lineTo(20, -4); g.lineTo(-30, -4); g.fill();
    g.fillStyle = '#7c241c'; g.fillRect(-30, -9, 52, 4);
    rr(g, -24, -25, 22, 6, 2.4, '#2f3542'); rr(g, -24, -26, 22, 2, 1, '#4e535d');                // сиденье
    poly(g, '#3f6f7a', 6, -21, 12, -31, 17, -30, 14, -20); poly(g, 'rgba(246,249,252,0.5)', 8, -22, 12, -29, 13.4, -28.6, 11, -21.5);
    line(g, '#27394a', 1.6, 2, -22, 0, -28); line(g, '#27394a', 1.6, 0, -28, -4, -28);              // руль
    el(g, 23, -13, 2.6, 2, broken ? '#6c7178' : '#ffd27a');
    g.fillStyle = '#f6f9fc'; g.fillRect(-14, -16, 10, 1.6); g.fillRect(-14, -13.4, 6, 1.4);         // надпись «БУРАН» штрихом
    if (broken) { el(g, -12, -27, 12, 2.4, SN); el(g, 8, -21.5, 8, 1.8, SN); el(g, -26, 1, 10, 2.4, SN); el(g, 18, 1.4, 8, 2, SN2); }
  }
  function buran(g, v, env, riding) {
    const S = sprite('buran' + (v.fixed ? 1 : 0), 76, 44, g2 => { g2.translate(38, 36); paintBuran(g2, !v.fixed); });
    g.save(); g.translate(v.x, v.y); g.scale(v.face < 0 ? -1 : 1, 1); g.drawImage(S, -38, -36, 76, 44); g.restore();
    if (riding && v.fixed) {
      env.light(v.x + (v.face || 1) * 60, v.y - 4, 150, 'w', 0.5 * (env.night || 0) + 0.1);
      if (state === 'play' && !UI.modal()) FX.emit('buran', 6, (parts, r) => parts.push({ type: 'smoke', x: v.x - (v.face || 1) * 30, y: v.y - 8, vx: -(v.face || 1) * (10 + r() * 10), vy: -6 - r() * 6, life: 1.2, max: 1.2 }));
    }
  }
  // упряжка: две важенки в постромках, нарты сзади; d — {x, y, face}; ключи анимации оленей — в REG
  function deerSled(g, d, env) {
    const f = d.face || 1, R = REG.deer || (REG.deer = [{ ph: 1 }, { ph: 3.4 }]);
    for (let k = 0; k < 2; k++) {
      const a = R[k]; a.x = d.x + f * (46 + k * 4); a.y = d.y + (k ? -9 : 7); a.face = f;
    }
    // постромки
    g.strokeStyle = '#3a2618'; g.lineWidth = 1; g.beginPath();
    for (const a of R) { g.moveTo(d.x + f * 20, d.y - 8); g.lineTo(a.x - f * 10, a.y - 12); } g.stroke();
    // дальний олень — раньше нарт, ближний — после
    ArtAnimals.deer(g, R[1], env);
    W_.sled(g, d.x, d.y, 0, f);
    ArtAnimals.deer(g, R[0], env);
  }

  // зимник: колея по речному льду и вешки (поверх слоя реки, gfx drawRiver); y0..y1 — видимая полоса
  function zimnikRoad(g, y0, y1) {
    const z = ZONES.zimnik; if (!z.active) return;
    const ys = Math.max(y0, WORLD.oy + WORLD.BASE + 250); if (ys >= y1) return;
    for (const [d, c, w] of [[-20, 'rgba(111,142,168,0.45)', 5], [20, 'rgba(111,142,168,0.45)', 5], [-17, 'rgba(246,249,252,0.6)', 1.2], [23, 'rgba(246,249,252,0.6)', 1.2]]) {
      g.strokeStyle = c; g.lineWidth = w; g.beginPath(); for (let y = ys; y <= y1 + 16; y += 16) g.lineTo(riverX(y) + d, y); g.stroke();
    }
    for (let v = Math.ceil(ys / 192) * 192; v < y1 + 30; v += 192) {
      const vx = riverX(v) + 54; el(g, vx, v + 1, 4, 1.4, 'rgba(39,57,74,0.25)'); line(g, '#5b3d27', 2, vx, v, vx + 1, v - 20); el(g, vx + 1, v - 20, 2.6, 1.3, '#b8392d');
    }
  }
  return { zimnikRoad, paintBurnt, rock, bakeGround, obj, steamGround, fallenLog, buran, deerSled, OBJ };
})();
