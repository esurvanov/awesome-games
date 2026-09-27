// Мок-окружение для проверки интерфейса без Рендера и Мозга:
// 2D-изометрия на canvas (pick/screenPos/ghost), простой «мозг» (очередь, время, потребности).
// Мир — настоящий js/world/index.js.
import { byId, FLOORS, WALLS } from '../data/catalog.js';

const MOTIVES = ['hunger', 'comfort', 'hygiene', 'bladder', 'energy', 'fun', 'social', 'room'];

// ───────── Рендер-мок: изометрия 2:1 ─────────
export function createMockRender(canvas, state) {
  const g = canvas.getContext('2d');
  let TW = 44, TH = 22, ox = 0, oy = 0, level = 0, wallMode = 'cutaway';
  let ghost = null, wallGhost = null, floorGhost = null, selId = null;
  const fit = () => {
    canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio;
    canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
  };
  fit(); addEventListener('resize', fit);
  // центр участка — в центре экрана
  const centre = (x, y) => { ox = innerWidth / 2 - (x - y) * TW / 2; oy = innerHeight / 2 - 60 - (x + y) * TH / 2; };
  centre(state.lot.w / 2, state.lot.h / 2);
  const S = (x, y, z = 0) => ({ x: ox + (x - y) * TW / 2, y: oy + (x + y) * TH / 2 - z * TH * 0.9 });
  const inv = (sx, sy) => { const a = (sx - ox) / (TW / 2), b = (sy - oy) / (TH / 2); return { x: (a + b) / 2, y: (b - a) / 2 }; };
  const L = () => state.lot.levels[level];
  const rectOf = o => { const d = byId[o.def], [w, h] = d.fp, odd = o.rot % 2; return { x: o.x, y: o.y, w: odd ? h : w, h: odd ? w : h }; };

  function poly(pts, fill, stroke) {
    g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.stroke(); }
  }
  const tileQuad = (x, y, w = 1, h = 1) => [S(x, y), S(x + w, y), S(x + w, y + h), S(x, y + h)];

  function frame() {
    const { w, h } = state.lot;
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    const bg = g.createLinearGradient(0, 0, 0, innerHeight); bg.addColorStop(0, '#9fc9e8'); bg.addColorStop(1, '#cfe6c9');
    g.fillStyle = bg; g.fillRect(0, 0, innerWidth, innerHeight);
    // трава и полы
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const f = L().floor[y * w + x];
      const col = f ? FLOORS.find(k => k.id === f)?.color : ((x + y) % 2 ? '#7fb55c' : '#78ad56');
      poly(tileQuad(x, y), col, f ? 'rgba(0,0,0,.08)' : null);
    }
    if (floorGhost) poly(tileQuad(floorGhost.x0, floorGhost.y0, floorGhost.x1 - floorGhost.x0 + 1, floorGhost.y1 - floorGhost.y0 + 1), floorGhost.ok ? 'rgba(120,230,140,.45)' : 'rgba(255,90,90,.45)', '#fff');
    // стены (низкие в режиме cutaway)
    const wh = wallMode === 'down' ? 0.25 : wallMode === 'cutaway' ? 1.2 : 2.6;
    const wall = (x0, y0, x1, y1, t, col) => poly([S(x0, y0), S(x1, y1), S(x1, y1, wh), S(x0, y0, wh)], col || WALLS.find(k => k.id === t)?.color || '#eee', 'rgba(0,0,0,.25)');
    for (let y = 0; y <= h; y++) for (let x = 0; x < w; x++) { const t = L().wallH[y * w + x]; if (t) wall(x, y, x + 1, y, t); }
    for (let y = 0; y < h; y++) for (let x = 0; x <= w; x++) { const t = L().wallV[y * (w + 1) + x]; if (t) wall(x, y, x, y + 1, t); }
    if (wallGhost) {
      const c = wallGhost.del ? 'rgba(255,90,90,.7)' : wallGhost.ok ? 'rgba(120,230,255,.7)' : 'rgba(255,90,90,.7)';
      const { x0, y0, x1, y1 } = wallGhost;
      if (wallGhost.room) { wall(x0, y0, x1, y0, 0, c); wall(x1, y0, x1, y1, 0, c); wall(x0, y1, x1, y1, 0, c); wall(x0, y0, x0, y1, 0, c); }
      else if (x0 === x1 && y0 === y1) { const p = S(x0, y0); g.fillStyle = c; g.beginPath(); g.arc(p.x, p.y, 5, 0, 7); g.fill(); }
      else wall(x0, y0, x1, y1, 0, c);
    }
    // предметы и симы в порядке глубины
    const items = [
      ...state.objects.filter(o => (o.level || 0) === level).map(o => ({ o, d: rectOf(o).x + rectOf(o).y })),
      ...state.sims.map(s => ({ s, d: s.x + s.y })),
    ];
    if (ghost) items.push({ o: { def: ghost.defId, x: ghost.x, y: ghost.y, rot: ghost.rot }, ghost, d: ghost.x + ghost.y + 0.01 });
    items.sort((a, b) => a.d - b.d);
    for (const it of items) {
      if (it.o) {
        const d = byId[it.o.def], r = rectOf(it.o);
        if (d.place === 'wall') {
          const p = S(r.x + 0.5, r.y + 0.5, 0.9); g.globalAlpha = it.ghost ? 0.75 : 1;
          g.font = '18px system-ui'; g.textAlign = 'center'; g.fillText(EMO[d.id] || '▪', p.x, p.y);
          if (it.ghost) { g.strokeStyle = it.ghost.ok ? '#6f6' : '#f55'; g.lineWidth = 2; g.strokeRect(p.x - 12, p.y - 18, 24, 24); g.lineWidth = 1; }
          g.globalAlpha = 1; continue;
        }
        const hgt = d.id === 'rug' ? 0.05 : 0.55;
        const base = tileQuad(r.x + 0.08, r.y + 0.08, r.w - 0.16, r.h - 0.16);
        const top = base.map(p => ({ x: p.x, y: p.y - hgt * TH * 0.9 }));
        const col = it.ghost ? (it.ghost.ok ? 'rgba(130,240,150,.6)' : 'rgba(255,100,100,.6)') : '#e8dcc8';
        poly([base[1], base[2], top[2], top[1]], it.ghost ? col : '#b9ad99');
        poly([base[2], base[3], top[3], top[2]], it.ghost ? col : '#cfc3ae');
        poly(top, col, 'rgba(0,0,0,.2)');
        const c = S(r.x + r.w / 2, r.y + r.h / 2, hgt);
        g.font = '16px system-ui'; g.textAlign = 'center'; g.fillText(EMO[d.id] || '▪', c.x, c.y + 5);
      } else {
        const s = it.s, p = S(s.x, s.y);
        g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(p.x, p.y, 9, 4.5, 0, 0, 7); g.fill();
        g.fillStyle = s.look?.shirt || '#48c'; g.fillRect(p.x - 6, p.y - 30, 12, 26);
        g.fillStyle = s.look?.skin || '#eb9'; g.beginPath(); g.arc(p.x, p.y - 36, 7, 0, 7); g.fill();
        if (s.id === selId) { g.strokeStyle = '#7CFC6A'; g.lineWidth = 3; g.beginPath(); g.ellipse(p.x, p.y - 54, 8, 3.5, 0, 0, 7); g.stroke(); g.lineWidth = 1; }
      }
    }
  }

  const R = {
    frame, S,
    pick(cx, cy) {
      // симы — по экранному расстоянию до тела
      for (const s of state.sims) { const p = S(s.x, s.y); if (Math.abs(cx - p.x) < 10 && cy < p.y + 2 && cy > p.y - 44) return { kind: 'sim', id: s.id, x: Math.floor(s.x), y: Math.floor(s.y), level }; }
      const w = inv(cx, cy);
      const x = Math.floor(w.x), y = Math.floor(w.y);
      if (x < 0 || y < 0 || x >= state.lot.w || y >= state.lot.h) return null;
      const base = { x, y, level, wx: w.x, wy: w.y };
      // ближайшее ребро со стеной
      const fx = w.x - x, fy = w.y - y;
      const cands = [['h', x, y, fy], ['h', x, y + 1, 1 - fy], ['v', x, y, fx], ['v', x + 1, y, 1 - fx]].sort((a, b) => a[3] - b[3]);
      const has = ([dir, ex, ey]) => dir === 'h' ? L().wallH[ey * state.lot.w + ex] : L().wallV[ey * (state.lot.w + 1) + ex];
      const e = cands.find(c => c[3] < 0.5 && has(c));
      if (e) base.edge = { dir: e[0], x: e[1], y: e[2] };
      for (const o of state.objects) {
        if ((o.level || 0) !== level || byId[o.def].place === 'wall') continue;
        const r = rectOf(o);
        if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return { ...base, kind: 'object', id: o.id };
      }
      if (e && e[3] < 0.2) return { ...base, kind: 'wall' };
      return { ...base, kind: 'tile' };
    },
    rotate() {}, zoom(d) { const k = d > 0 ? 1.25 : 0.8; TW = Math.max(22, Math.min(88, TW * k)); TH = TW / 2; centre(state.lot.w / 2, state.lot.h / 2); },
    pan(dx, dy) { ox -= dx; oy -= dy; }, // пиксели, как у настоящего Рендера
    focus(x, y) { centre(x, y); },
    setWallMode(m) { wallMode = m; }, setLevel(l) { level = l; },
    setGhost(v) { ghost = v; }, setWallGhost(v) { wallGhost = v; }, setFloorGhost(v) { floorGhost = v; },
    select(id) { selId = id; },
  };
  // screenPos: мир (X вправо, Y вверх, Z = тайловый y) → экран
  R.screenPos = (X, Y, Z) => S(X, Z, Y);
  return R;
}

const EMO = {
  fridge: '🧊', stove: '🍳', counter: '🗄️', kitchen_sink: '🚰', dining_table: '🍽️', dining_chair: '🪑', trash_can: '🗑️',
  sofa: '🛋️', armchair: '💺', coffee_table: '☕', tv: '📺', stereo: '📻', bookshelf: '📚', computer_desk: '💻', chess: '♟️', phone: '☎️',
  bed_single: '🛏️', bed_double: '🛏️', dresser: '🧺', mirror: '🪞', toilet: '🚽', shower: '🚿', bathtub: '🛁', bath_sink: '🧼',
  floor_lamp: '💡', painting: '🖼️', plant: '🪴', rug: '🟫', mailbox: '📬', door: '🚪', window: '🪟',
};

// ───────── Мозг-мок ─────────
let uid = 1;
const OBJ_ACTIONS = {
  fridge: [['snack', 'Перекусить', '🥪'], ['cook_meal', 'Приготовить ужин', '🍲'], ['grab', 'Взять газировку', '🥤']],
  sofa: [['sit', 'Сесть', '🪑'], ['nap', 'Вздремнуть', '😴']], tv: [['watch', 'Смотреть ТВ', '📺'], ['off', 'Выключить', '⏻']],
  bed_double: [['sleep', 'Спать', '🛏️'], ['nap', 'Вздремнуть', '😴'], ['make', 'Заправить', '🧺']],
  bookshelf: [['read', 'Почитать', '📚'], ['study_cooking', 'Учить кулинарию', '📖'], ['study_mechanical', 'Учить механику', '🔧']],
  computer_desk: [['play', 'Играть', '🎮'], ['find_job', 'Искать работу', '💼']],
  phone: [['call_repair', 'Вызвать…/Мастера', '🔧'], ['call_maid', 'Вызвать…/Горничную', '🧹'], ['call_pizza', 'Вызвать…/Пиццу', '🍕'], ['call_friend', 'Позвонить знакомому', '☎️']],
};
const SOCIALS = [['talk', 'Поболтать', '💬'], ['joke', 'Пошутить', '😄'], ['hug', 'Обнять', '🤗', 30], ['kiss', 'Поцеловать', '💋', 70], ['compliment', 'Похвалить', '👍'], ['tease', 'Подразнить', '😜']];

export function createMockSim() {
  const sim = {
    MOTIVES,
    addSim(state, bus, spec) {
      const id = state.nextId++;
      state.sims.push({
        id, name: spec.name, look: spec.look, x: spec.x, y: spec.y, level: 0, facing: 0,
        motives: Object.fromEntries(MOTIVES.map((k, i) => [k, spec.motives?.[k] ?? 60 - i * 17])),
        personality: spec.personality, skills: spec.skills || { cooking: 2.4, mechanical: 0.6, charisma: 4.2, body: 1, logic: 6.8, creativity: 3 },
        career: spec.career ?? null, rel: {}, queue: [], act: null, anim: 'idle', animTarget: null, bubble: null, path: null,
      });
      bus.emit('sim:added', { id });
      return id;
    },
    interactionsFor(state, simId, t) {
      if (t.kind === 'tile') return [{ key: 'go_here', label: 'Идти сюда', icon: '🚶' }];
      if (t.kind === 'sim') {
        if (t.id === simId) return [];
        const me = state.sims.find(s => s.id === simId), rel = me.rel[t.id] ?? 0;
        return SOCIALS.map(([key, label, icon, need]) => need && rel < need ? { key, label, icon, disabled: true, reason: `Нужна дружба ${need}+` } : { key, label, icon });
      }
      const o = state.objects.find(x => x.id === t.id);
      const list = OBJ_ACTIONS[o?.def] || [['use', 'Использовать', '🖐️']];
      const out = list.map(([key, label, icon]) => ({ key, label, icon }));
      if (o?.def === 'computer_desk') out[1] = { ...out[1], disabled: true, reason: 'Плохое настроение' };
      return out;
    },
    enqueue(state, bus, simId, target, key) {
      const s = state.sims.find(x => x.id === simId);
      const src = [...Object.values(OBJ_ACTIONS).flat(), ...SOCIALS, ['go_here', 'Идти сюда', '🚶'], ['use', 'Использовать', '🖐️']].find(a => a[0] === key);
      s.queue.push({ uid: uid++, objId: target.id ?? null, target, interaction: key, by: 'user', icon: src?.[2] || '❔', label: src?.[1] });
    },
    cancel(state, bus, simId, u) {
      const s = state.sims.find(x => x.id === simId);
      if (s.act?.uid === u) { s.act.cancel = true; return true; }
      s.queue = s.queue.filter(i => i.uid !== u);
      return true;
    },
    mood: s => MOTIVES.reduce((a, k) => a + s.motives[k], 0) / 8,
    answers: [],
    lockWant(state, bus, simId, wantId) { const s = state.sims.find(x => x.id === simId); for (const w of s.wants || []) w.locked = w.id === wantId ? !w.locked : false; },
    gradeLetter: g => (g >= 80 ? 'A' : g >= 65 ? 'B' : g >= 50 ? 'C' : 'D'),
    answer(state, bus, id, key) { sim.answers.push({ id, key }); },
    setSpeed(state, bus, v) { if (state.time.speed !== v) { state.time.speed = v; bus.emit('time:speed', { speed: v }); } },
    actionProgress: s => (s.act ? Math.min(1, s.act.t / s.act.dur) : 0),
    // Упрощённый тик: время, потребности, очередь
    tick(state, bus, world, dt) {
      const mul = [0, 1, 3, 10][state.time.speed];
      const before = Math.floor(state.time.minutes / 60);
      state.time.minutes += dt * mul;
      if (Math.floor(state.time.minutes / 60) !== before) bus.emit('time:hour', { hour: Math.floor(state.time.minutes / 60) % 24 });
      for (const s of state.sims) {
        for (const k of MOTIVES) if (k !== 'room') s.motives[k] = Math.max(-100, s.motives[k] - dt * mul * 0.05);
        if (!s.act && s.queue.length) { const it = s.queue[0]; s.act = { uid: it.uid, key: it.interaction, by: it.by, t: 0, dur: 20, cancel: false }; }
        if (s.act) {
          s.act.t += dt * mul * (s.act.cancel ? 6 : 1);
          if (s.act.t >= s.act.dur) { s.queue = s.queue.filter(i => i.uid !== s.act.uid); s.act = null; }
        }
      }
    },
  };
  return sim;
}

// ───────── Волна 3: мок района и расширения каталога ─────────
const TINTS = [['#c0474a', 'красный'], ['#4a7fc1', 'синий'], ['#6aa35a', 'зелёный'], ['#e0a33a', 'горчичный'], ['#8e6cc0', 'сиреневый'], ['#3a3f4a', 'графит'], ['#e8e4dc', 'молочный'], ['#b08a52', 'орех']];
// ~300 предметов: к каждому базовому — 8 цветовых вариантов (как будет у агента Каталог)
export function mockCatalogExtra(CATALOG, byId) {
  if (CATALOG.length > 200) return;
  const bases = CATALOG.filter(d => d.cat !== 'build' && d.buyable !== false && !d.variantOf);
  bases.forEach((b, bi) => TINTS.forEach(([tint, cn], i) => {
    const d = { ...b, id: `${b.id}_v${i}`, name: `${b.name} · ${cn}`, variantOf: b.id, kind: b.kind ?? b.id, tint, price: Math.round(b.price * (1 + i * 0.15)),
      desc: `${cn} вариант`, tags: [cn], isNew: i === 7, collection: bi % 5 === 0 ? 'Дачный уют' : bi % 7 === 0 ? 'Хай-тек' : undefined };
    CATALOG.push(d); byId[d.id] = d;
  }));
}

export function mockHood(state, sim, bus) {
  const fams = [
    { id: 1, name: 'Ивановы', bio: 'Вера мечтает о карьере, Олег — о рыбалке. Дом — полная чаша, счёт — пустой.', funds: state.household.money, lotId: 1, members: state.sims.filter(s => !s.npc).map(s => ({ name: s.name, look: s.look, id: s.id })) },
    { id: 2, name: 'Кузнецовы', bio: 'Молодожёны. Спорят, кто моет посуду.', funds: 14200, lotId: 2, members: [{ name: 'Аня', look: { body: 'female', skin: '#f1c9a5', shirt: '#c1564a', hair: '#1f1b1a' } }, { name: 'Дима', look: { body: 'male', skin: '#d9a57f', shirt: '#2f8f8a', hair: '#3b2a1e' } }] },
    { id: 3, name: 'Петровы', bio: 'Бабушка, папа и трое внуков. Громко.', funds: 8400, lotId: 3, members: ['Галина', 'Сергей', 'Маша', 'Коля', 'Лиза'].map((n, i) => ({ name: n, look: { body: i % 2 ? 'male' : 'female', skin: '#e8b894', shirt: TINTS[i][0] } })) },
    { id: 4, name: 'Смирновы', bio: 'Только приехали. Ищут дом.', funds: 20000, lotId: null, members: [{ name: 'Олег', look: { body: 'male', skin: '#c99672', shirt: '#6aa35a' } }] },
  ];
  const lots = [
    ...[0, 1, 2, 3, 4, 5].map(i => ({ id: i + 1, name: ['Липовая, 1', 'Липовая, 3', 'Липовая, 5', 'Садовая, 2', 'Садовая, 4', 'Садовая, 6'][i], kind: 'res', x: (i % 3) * 3, y: Math.floor(i / 3) * 3, w: 2, h: 2, price: 12000 + i * 3000, familyId: fams.find(f => f.lotId === i + 1)?.id ?? null })),
    ...[['park', 'Парк «Берёзки»'], ['cafe', 'Кафе «Пышка»'], ['shop', 'Магазин «Всё»'], ['gym', 'Спортзал «Сила»'], ['library', 'Библиотека']].map(([type, name], i) => ({ id: 10 + i, name, kind: 'community', type, x: i * 2, y: 7, w: 1.6, h: 1.6, price: 0, familyId: null })),
  ];
  state.hood = { name: 'Берёзовка', lots, families: fams, townies: ['Нина', 'Паша', 'Рома', 'Катя', 'Зина', 'Лёва'].map((n, i) => ({ id: 100 + i, name: n, bio: 'Живёт через дорогу, всё про всех знает.', look: { body: i % 2 ? 'male' : 'female', skin: '#e8b894', shirt: TINTS[i][0] } })), activeLotId: 1, day: 0 };
  // мок-Мир: переходы между участками
  return {
    saveActiveLot() {},
    loadLot(st, b, lotId) {
      st.hood.activeLotId = lotId;
      const l = st.hood.lots.find(x => x.id === lotId);
      if (l.kind === 'res') {
        const f = st.hood.families.find(x => x.lotId === lotId);
        if (f && f.id !== 1) { st.sims = st.sims.filter(s => s.npc); f.members.forEach((m, i) => sim.addSim(st, b, { ...m, x: 12.5 + i, y: 20.5 })); st.household.money = f.funds; }
      }
      b.emit('lot:loaded', { lotId });
    },
    moveIn(st, b, famId, lotId) {
      const f = st.hood.families.find(x => x.id === famId), l = st.hood.lots.find(x => x.id === lotId);
      if (!f || !l || l.familyId != null) return { ok: false, reason: 'Участок занят' };
      f.lotId = lotId; l.familyId = famId; f.funds -= l.price;
      return { ok: true };
    },
  };
}
