'use strict';
// Посёлок по мотивам Age of Empires: люди с циклом «добыть → склад → снова»,
// стройка с убывающей отдачей строителей, эпохи с условием «2 здания + цена»,
// улучшения-модификаторы, фактория с плавающим курсом, набат, вышки.
// Выработка — в игровом времени (K = TUNE.time.k): работа у дерева/лунки/обломков длится ×K, а путь (телесный, скорость
// ходьбы прежняя) копится в u.lag ×(K − 1) и доплачивается следующей работой — добыча за игровые сутки и на единицу еды как при часе 20 с.
// Охота: выстрел телесный (заяц бегает), поэтому после него — передышка u.pause = (K − 1)·выстрел + lag.
const Colony = (() => {
  const C0 = TUNE.colony, K = TUNE.time.k;
  const workDone = (u, time) => u.t >= time * K + (u.lag || 0); // готова ли единица работы
  const walked = (u, dt) => { u.lag = (u.lag || 0) + (K - 1) * dt; };
  const byId = id => G.col.units.find(u => u.id === id);
  const bById = id => G.col.builds.find(b => b.id === id);
  const carryN = u => Object.values(u.carry).reduce((a, b) => a + b, 0);

  function init() {
    G.col = { ep: 0, epT: 0, units: [], builds: [], queue: [], techs: {}, research: null, prices: Object.assign({}, MARKET),
      rub: C0.rub0, alarm: false, eatT: C0.eatT0, sel: [], nextId: 1, ghost: null, mark: null, proj: [], barkT: 0 };
    G.amulets = 0;
  }

  // ---------- модификаторы (как в AoE: прибавка + множитель) ----------
  function mod(k) {
    const add = k === 'hp' || k === 'dmg';
    let a = 0, m = 1;
    for (const id in G.col.techs) { const v = TECHS[id].mod[k]; if (v !== undefined) { if (add) a += v; else m *= v; } }
    if (k === 'dmg' && G.col.ep >= 3) a += 1;
    return add ? a : m;
  }
  const doneCount = type => G.col.builds.filter(b => b.done && b.type === type).length;
  const popCap = () => C0.popBase + C0.popPerBalok * doneCount('balok');
  const pop = () => G.col.units.filter(u => !u.pet).length + G.col.queue.length;

  // ---------- точки сдачи и укрытия ----------
  const HUT_DROP = () => ({ x: HUT.x, y: HUT_IN.y1 + 28 });
  function drops(res) {
    const out = [HUT_DROP()];
    for (const b of G.col.builds) { const B = BUILDS[b.type]; if (b.done && B.drop && B.drop.includes(res)) out.push({ x: b.x, y: b.y + B.h / 2 + 14 }); }
    return out;
  }
  function shelters() {
    const out = [HUT_DROP()];
    for (const b of G.col.builds) if (b.done && BUILDS[b.type].shelter) out.push({ x: b.x, y: b.y + BUILDS[b.type].h / 2 + 12 });
    return out;
  }
  const nearestOf = (list, o) => Space.nearest(list, o.x, o.y);

  // ---------- люди ----------
  function spawn(type, extra = {}) {
    const T = UNITS[type], d = HUT_DROP();
    const u = Object.assign({ id: G.col.nextId++, type, x: d.x + rnd(-20, 20), y: d.y + rnd(0, 20), hp: T.hp + mod('hp'), face: 1, step: 0,
      task: { k: 'idle' }, carry: {}, t: 0, cd: 0, hidden: false, prev: null, idleT: 0 }, extra);
    G.col.units.push(u); return u;
  }
  // нанятый приходит своими ногами: появляется за краем видимого (≥ 820 px от героя и избы, по проходимому месту) и идёт к избе
  function arrive(type) {
    const d = HUT_DROP(), p = G.p; let at = null;
    for (let i = 0; i < 16 && !at; i++) {
      const a = Math.PI / 2 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.39, q = { x: clamp(d.x + Math.cos(a) * 900, 80, W - 80), y: clamp(d.y + Math.sin(a) * 900, 80, H - 80) };
      if ((Math.abs(q.x - p.x) > 820 || Math.abs(q.y - p.y) > 560) && !World.blocked(q.x, q.y, 10) && !onIce(q.x, q.y)) at = q;
    }
    at = at || { x: clamp(d.x, 80, W - 80), y: clamp(d.y + 900, 80, H - 80) };
    const u = spawn(type, { x: at.x, y: at.y }); u.task = { k: 'move', x: d.x + rnd(-20, 20), y: d.y + rnd(0, 20), arrive: 1 };
    return u;
  }
  // шаг к цели с обходом избы/построек/обломков (Nav) и выталкиванием из стен
  function go(u, x, y, sp, dt, stop = 4) {
    const D = Math.hypot(x - u.x, y - u.y);
    if (D <= stop) return true;
    const wp = D > 40 ? Nav.way(u, x, y) : { x, y }, fin = wp.x === x && wp.y === y;
    let dx = wp.x - u.x, dy = wp.y - u.y; const d = Math.hypot(dx, dy) || 1e-3;
    const s = Math.min(fin ? d - stop : d, sp * dt);
    if (D > 70 && fin && typeof Depth !== 'undefined') { const v = Depth.steer(u, dx, dy, u.type === 'laika' ? 'dog' : 'n'); if (v) { dx = v.x * d; dy = v.y * d; } } // по натоптанному (js/depth.js)
    u.x += dx / d * s; u.y += dy / d * s;
    World.solid(u, 7, 'u');
    if (Math.abs(dx) > 1) u.face = Math.sign(dx);
    u.step += dt * 10;
    if (Math.random() < dt * 3 && !u.hidden) Fx.print(u.x, u.y, Math.atan2(dy, dx), u.type === 'laika' ? 'w' : 'p');
    return fin && Math.hypot(x - u.x, y - u.y) <= stop + 0.5;
  }
  // разгрузка у склада — по одной вещи (дрова — в поленницу/дровяник со своей массой номинала), 0,35 с на штуку; true — пусто
  function deposit(u, dt) {
    u.working = 'drop'; u.t = (u.t || 0) + dt;
    if (u.t < 0.35) return false;
    u.t = 0; const k = Object.keys(u.carry)[0]; if (!k) return true;
    Inv.put(G.chest, k, 1); if (k === 'scrap') G.stats.scrap++;
    if (--u.carry[k] <= 0) delete u.carry[k];
    if (Math.random() < 0.5) Sound.src(u).chop();
    return !Object.keys(u.carry).length;
  }
  function threats() {
    const out = G.wolves.slice(); if (G.bear) out.push(G.bear); return out;
  }
  function threatNear(o, r) { let best = null, bd = r * r; for (const t of threats()) { const d = dist2(t, o); if (d < bd) { bd = d; best = t; } } return best; }
  function damage(t, dmg) {
    if (t === G.bear) {
      t.hp -= dmg * C0.bearDmgK; if (t.st === 'wander') { t.st = 'hunt'; }
      if (t.hp <= 0) { Fx.corpse('bear', t.x, t.y); G.bear = null; G.flags.bearDead = 1; G.chest.meat = (G.chest.meat || 0) + 4; Fx.toast(':bear: Посёлок завалил шатуна'); Sound.ok2(); }
      return;
    }
    t.hp -= dmg; t.st = 'flee'; t.t = 0.8;
    if (G.pack && !t.hurt) { t.hurt = 1; G.pack.hurt++; }
    if (t.leader && G.pack) { G.pack.leaderHurt += dmg; if (G.pack.leaderHurt >= TUNE.wolf.leaderBeat && G.urk.wolfQuest) G.flags.leaderDone = 1; }
    if (t.hp <= 0) {
      Fx.corpse(t.leader ? 'wolfLeader' : 'wolf', t.x, t.y); G.wolves.splice(G.wolves.indexOf(t), 1); G.stats.wolves++;
      G.chest.wpelt = (G.chest.wpelt || 0) + 1; G.chest.meat = (G.chest.meat || 0) + 2;
      if (G.pack) G.pack.killed++;
      if (t.leader) { G.flags.leaderDone = 1; Fx.toast(':wolf: Вожак убит — стая уходит'); Wolves.retreatAll(); }
    }
  }
  function fight(u, th, dt, sp) {
    const T = UNITS[u.type], d = dist(u, th), dmg = T.dmg + mod('dmg');
    if (T.melee) {
      if (d > 26) go(u, th.x, th.y, sp * 1.1, dt, 20);
      else if (u.cd <= 0) { u.cd = C0.meleeCd; damage(th, dmg); Sound.src(u).bite(); u.face = Math.sign(th.x - u.x) || u.face; }
    } else {
      if (d > T.rng) go(u, th.x, th.y, sp, dt, T.rng - 10);
      else if (u.cd <= 0) {
        u.cd = C0.rangedCd; u.face = Math.sign(th.x - u.x) || u.face;
        G.col.proj.push({ x: u.x, y: u.y - 22, tx: th.x, ty: th.y - 14, t: 0 });
        if (Math.random() < C0.rangedHit) damage(th, dmg);
        Sound.hit();
      }
    }
  }

  const TREE_R = 26;
  function findTree(o, r = C0.treeR) {
    let best = -1, bd = r * r;
    for (const t of treesNear(o.x, o.y, r)) if (t.wood > 0 && !t.wall) { const d = dist2(t, o); if (d < bd) { bd = d; best = t; } }
    return best === -1 ? null : best;
  }
  function findHare(o, r = C0.hareR) { return Space.nearest(Space.hares, o.x, o.y, r, Actions.liveHare); }
  const WRECK_OK = ['scrap', 'can', 'kero', 'tea', 'cable'];

  // Цикл сбора: go → work → drop → go
  function gather(u, dt, sp) {
    const t = u.task, cap = Math.round((t.k === 'hunt' ? C0.carry.hunt : t.k === 'fish' ? C0.carry.fish : C0.carry.other) * mod('carry'));
    if (u.pause > 0) { u.pause -= dt; return; } // передышка охотника (игровой темп)
    if (carryN(u) >= cap) t.ph = 'drop';
    if (t.ph === 'drop') {
      walked(u, dt);
      const res = Object.keys(u.carry)[0] || 'wood', d = nearestOf(drops(res), u);
      if (go(u, d.x, d.y, sp, dt, 8)) { if (deposit(u, dt)) { u.t = 0; t.ph = 'go'; if (t.stop) { u.task = { k: 'idle' }; } } } else u.t = 0;
      return;
    }
    let src = null, reach = 24, time = 2, yieldFn;
    if (t.k === 'chop') {
      let tree = t.tree && t.tree.wood > 0 ? t.tree : null;
      if (!tree) { tree = findTree(t.near || u); t.tree = tree; }
      if (!tree) { t.stop = 1; t.ph = carryN(u) ? 'drop' : 'go'; if (!carryN(u)) u.task = { k: 'idle' }; return; }
      src = tree; reach = TREE_R; time = C0.chopT / mod('chop') / (nearWoodshed(tree) ? C0.woodshedK : 1);
      yieldFn = () => { tree.wood--; chopHit(u, tree); u.carry.wood = (u.carry.wood || 0) + 1; t.near = { x: tree.x, y: tree.y }; };
    } else if (t.k === 'fish') {
      src = { x: t.x, y: t.y }; reach = 6; time = C0.fishT / mod('fish');
      yieldFn = () => { if (Math.random() < C0.fishP) u.carry.fish = (u.carry.fish || 0) + 1; };
      if (!G.holes.some(h => dist2(h, src) < 30 * 30)) G.holes.push({ x: t.x + 14, y: t.y + 4, fish: 3 });
    } else if (t.k === 'wreck') {
      const P = POI[t.w]; src = { x: P.x + (u.id % 5 - 2) * 20, y: P.y + 70 }; reach = 8; time = C0.wreckT;
      yieldFn = () => {
        const pool = G.wreck[t.w], i = pool.findIndex(k => WRECK_OK.includes(k));
        if (i < 0) { t.stop = 1; t.ph = 'drop'; if (!G.fired['wreckEmpty' + t.w]) { G.fired['wreckEmpty' + t.w] = 1; Fx.toast(':heli: Остальное в обломках — только сам'); } return; }
        const k = pool.splice(i, 1)[0]; u.carry[k] = (u.carry[k] || 0) + 1; Interact.emit('work', { who: u, what: 'wreck', x: u.x + u.face * 14, y: u.y });
        if (k !== 'scrap' || carryN(u) >= 2) t.ph = 'drop';
      };
    } else if (t.k === 'hunt') {
      const h = findHare(u);
      if (!h) { if (carryN(u)) t.ph = 'drop'; else { walked(u, dt); go(u, HUT.x + Math.cos(u.id) * 300, HUT.y + Math.sin(u.id) * 300, sp * 0.5, dt); } return; }
      src = h; reach = UNITS[u.type].rng || 30; time = C0.huntT;
      yieldFn = () => {
        G.col.proj.push({ x: u.x, y: u.y - 22, tx: h.x, ty: h.y - 6, t: 0 });
        if (Math.random() < C0.huntP && G.hares.includes(h)) { G.hares.splice(G.hares.indexOf(h), 1); u.carry.meat = (u.carry.meat || 0) + 2; u.carry.hare = (u.carry.hare || 0) + 1; G.stats.hares++; }
      };
    }
    if (dist(u, src) > reach) { t.ph = 'go'; u.t = 0; walked(u, dt); go(u, src.x, src.y, sp, dt, reach - 2); return; }
    t.ph = 'work'; u.working = t.k; u.face = Math.sign(src.x - u.x) || u.face;
    u.t += dt;
    const hunt = t.k === 'hunt';
    if (hunt ? u.t >= time : workDone(u, time)) { u.t = 0; if (hunt) u.pause = (K - 1) * time + (u.lag || 0); u.lag = 0; yieldFn(); }
  }
  // удар топора человека посёлка: отклик — правила Interact (как у героя; звук — через раз)
  function chopHit(u, tree) {
    if (tree.wood <= 0) World.felled(tree);
    Interact.emit('hit', { who: u, target: tree, x: tree.x, y: tree.y, power: 0.8 });
    if (tree.wood <= 0) Interact.emit('fell', { who: u, target: tree, x: tree.x, y: tree.y, dir: Math.atan2(tree.y - u.y, tree.x - u.x) });
  }
  // сигнальные кучи: рубит у мари и складывает в кучу по 4
  function stackWork(u, dt, sp) {
    const t = u.task, open = G.stacks.filter(s => !s.lit && s.wood < 4);
    if (!open.length || G.flags.rescued) { if (u.carry.wood) { t.k = 'chop'; t.ph = 'drop'; t.stop = 1; } else u.task = { k: 'idle' }; return; }
    const s = nearestOf(open, u);
    if ((u.carry.wood || 0) > 0) {
      walked(u, dt);
      if (go(u, s.x, s.y + 24, sp, dt, 10)) { const n = Math.min(u.carry.wood, 4 - s.wood); s.wood += n; u.carry.wood -= n; if (!u.carry.wood) delete u.carry.wood; Sound.src(s).chop(); Fx.floatText(s.x, s.y - 30, `:fire: ${s.wood}/4`); }
      return;
    }
    let tree = t.tree && t.tree.wood > 0 ? t.tree : null;
    if (!tree) { tree = findTree(s, C0.treeR); t.tree = tree; }
    if (!tree) { u.task = { k: 'idle' }; return; }
    if (dist(u, tree) > TREE_R) { u.t = 0; walked(u, dt); go(u, tree.x, tree.y, sp, dt, TREE_R - 2); return; }
    u.working = 'chop'; u.face = Math.sign(tree.x - u.x) || u.face;
    u.t += dt;
    if (workDone(u, C0.chopT / mod('chop'))) { u.t = 0; u.lag = 0; tree.wood--; chopHit(u, tree); u.carry.wood = (u.carry.wood || 0) + 1; if (u.carry.wood >= Math.min(3, 4 - s.wood) || tree.wood <= 0) t.tree = null; }
  }
  const units = cost => { const out = []; for (const [k, v] of Object.entries(cost)) for (let i = 0; i < v; i++) out.push(k); return out; };
  const nearWoodshed = o => G.col.builds.some(b => b.done && b.type === 'woodshed' && dist2(b, o) < C0.woodshedR * C0.woodshedR);

  function uUpdate(u, dt, h, storm) {
    const T = UNITS[u.type];
    u.cd = Math.max(0, u.cd - dt); u.working = null;
    let sp = T.sp * mod('speed') * (storm ? C0.stormSpeed : 1);
    // укрытие: ночь, пурга, набат
    const mustHide = u.pet ? (G.p.inside || G.p.sleeping) : (G.col.alarm || h >= C0.hideFrom || h < C0.hideTo || storm);
    if (mustHide && u.task.k !== 'shelter') { u.prev = u.task.k === 'idle' ? null : u.task; u.task = { k: 'shelter' }; }
    if (u.task.fear) u.task.fear = Math.max(0, u.task.fear - dt) || (threatNear(u, C0.fearR) ? 5 : 0);
    if (!mustHide && u.task.k === 'shelter' && !u.task.manual && !u.task.fear) { u.hidden = false; u.task = u.prev || { k: 'idle' }; u.prev = null; }
    if (u.hidden) { u.hp = Math.min(T.hp + mod('hp'), u.hp + dt * C0.heal); return; }
    // оборона
    if (T.dmg) {
      const th = threatNear(u.pet ? G.p : u.task.k === 'guard' ? { x: HUT.x, y: HUT.y } : u, (T.rng || 40) + (u.task.k === 'guard' && !u.pet ? C0.guardR : C0.petR));
      if (th) { fight(u, th, dt, sp); return; }
    } else if (threatNear(u, C0.fleeR) && u.task.k !== 'shelter') {
      const s = nearestOf(shelters(), u); if (go(u, s.x, s.y, sp * 1.2, dt, 6)) { u.prev = u.task; u.task = { k: 'shelter', fear: 20 }; u.hidden = true; } return;
    }
    const t = u.task;
    switch (t.k) {
      case 'idle':
        if (u.pet) { u.task = { k: 'guard' }; break; }
        u.idleT += dt;
        if (u.idleT > 3) {
          u.idleT = 0;
          if (u.type === 'evenk') u.task = { k: 'hunt', ph: 'go' };
          else if (u.type === 'bich') {
            const site = G.col.builds.find(b => !b.done && (dist2(b, u) < TUNE.r.siteSeek * TUNE.r.siteSeek || BUILDS[b.type].onMar));
            if (site) u.task = { k: 'build', b: site.id };
            else if (padNeed()) u.task = { k: 'tramp', i: 0, e: u.id % 2 };   // площадку на мари — утоптать на снегоступах (стройки — раньше)
            else if (G.flags.contact && !G.flags.rescued && G.stacks.some(s => !s.lit && s.wood < 4)) u.task = { k: 'stack' };
          }
          else if (u.type === 'strelok' || u.type === 'laika') u.task = { k: 'guard' };
        }
        break;
      case 'move': if (go(u, t.x, t.y, sp, dt, 3)) u.task = { k: 'idle' }; break;
      // атаковать цель по ПКМ: держится за этого зверя, пока он жив и в мире
      case 'attack': if (T.dmg && threats().includes(t.o)) fight(u, t.o, dt, sp); else u.task = { k: 'idle' }; break;
      case 'guard': {
        if (!u.pet) { const a = now * 0.15 + u.id * 1.7, gx = HUT.x + Math.cos(a) * 190, gy = HUT.y - 20 + Math.sin(a) * 140; go(u, gx, gy, sp * 0.6, dt, 6); break; }
        const tx = G.p.x - G.p.face * 40 + (u.id % 3 - 1) * 26, ty = G.p.y + 20 + (u.id % 2) * 16;
        if (dist2(u, G.p) > TUNE.r.petLeash * TUNE.r.petLeash) { u.x = tx; u.y = ty; }
        go(u, tx, ty, dist2(u, G.p) > 200 * 200 ? sp * 1.3 : sp, dt, 8);
        u.hidden = G.p.inside && !u.pet ? false : false;
        break;
      }
      case 'shelter': { const s = nearestOf(shelters(), u); if (go(u, s.x, s.y, sp * 1.1, dt, 6)) u.hidden = true; break; }
      case 'build': {
        const b = bById(t.b); if (!b || b.done) { u.task = { k: 'idle' }; break; }
        const R = BUILDS[b.type].w / 2 + 12;
        if (dist(u, b) > R) { u.t = 0; go(u, b.x, b.y, sp, dt, R - 4); } else { u.working = 'build'; u.t = (u.t || 0) + dt; u.face = Math.sign(b.x - u.x) || u.face; if (Math.random() < dt * 2) Sound.src(u).chop(); }
        break;
      }
      case 'chop': case 'fish': case 'wreck': case 'hunt': gather(u, dt, sp); break;
      case 'stack': stackWork(u, dt, sp); break;
      // площадка: ходит дорожками поперёк (шаг 18 px), по очереди от края к краю
      case 'tramp': { const b = padSite(); if (!b || !padNeed() || G.col.builds.some(q => !q.done && !BUILDS[q.type].onMar)) { u.task = { k: 'idle' }; break; }
        const B = BUILDS.pad, n = Math.floor(B.h / 18), lane = (t.i + u.id * 3) % n, y = b.y - B.h / 2 + 9 + lane * 18, x = b.x + (t.e ? B.w / 2 - 8 : -B.w / 2 + 8);
        if (go(u, x, y, sp * 0.7, dt, 4)) { t.e = 1 - t.e; t.i++; } break; }
    }
  }

  // ---------- главный апдейт ----------
  function update(dt, h, storm) {
    const C = G.col, p = G.p;
    // найм
    if (C.queue.length) {
      const q = C.queue[0]; q.t -= dt;
      if (q.t <= 0) { C.queue.shift(); const u = arrive(q.type); Fx.toast(`${UNITS[q.type].i} ${UNITS[q.type].n} идёт в посёлок`); Sound.pick(); if (q.type === 'bich') u.idleT = 3; }
    }
    // эпоха
    if (C.epT > 0) { C.epT -= dt; if (C.epT <= 0) { C.epT = 0; C.ep++; UI.epoch(C.ep); if (Sound.sting) Sound.sting('epoch'); else Sound.ok2(); } }
    // исследование
    if (C.research) { C.research.t -= dt; if (C.research.t <= 0) { const id = C.research.id; C.techs[id] = 1; C.research = null; Fx.toast(`${TECHS[id].i} ${TECHS[id].n} :ok:`); Sound.ok2(); if (id === 'vatnik') for (const u of C.units) u.hp += 15; } }
    // люди
    for (let i = C.units.length - 1; i >= 0; i--) {
      const u = C.units[i], udt = u.pet ? dt : Space.lodDt(u, dt, i);
      if (udt) uUpdate(u, udt, h, storm);
      if (u.hp <= 0) {
        C.units.splice(i, 1); C.sel = C.sel.filter(id => id !== u.id);
        Fx.toast(`:hp: ${u.pet ? 'Пурга погибла' : UNITS[u.type].n + ' погиб'}`); Fx.burst(u.x, u.y - 10, 12, '#c0392b');
        // погиб последний строитель — стройка встанет, скажем об этом
        const site = u.task.k === 'build' ? bById(u.task.b) : null;
        if (site && !site.done && !C.units.some(o => o.task.k === 'build' && o.task.b === site.id))
          setTimeout(() => Fx.toast(`:build: ${BUILDS[site.type].i} стоит без строителей · :bich: или E`), 1200);
      }
    }
    // стройка: 3n/(n+2) — второй и следующие строители дают всё меньше; герой — один строитель
    const builders = new Map();
    for (const u of C.units) if (u.working === 'build') builders.set(u.task.b, (builders.get(u.task.b) || 0) + 1);
    for (const b of C.builds) if (!b.done) {
      let n = builders.get(b.id) || 0;
      if (p.buildT > 0 && p.buildB === b.id) n++;
      // материалы уходят по ходу (поленница худеет по одному полену, пока растёт стройка): нечем — стройка стоит
      if (n > 0) { const U = units(BUILDS[b.type].cost), paid = b.paid == null ? U.length : b.paid, nx = Math.min(1, b.prog + 3 * n / (n + 2) / BUILDS[b.type].t * dt);
        while (b.paid != null && b.paid < U.length && b.paid < Math.ceil(nx * U.length - 1e-9)) { if (!Inv.takeStock(U[b.paid], 1)) break; b.paid++; }
        const cap = b.paid == null || b.paid >= U.length ? 1 : b.paid / U.length;
        if (cap <= b.prog && b.paid != null && b.paid < U.length) { if (!b.short) { b.short = 1; Fx.toast(`:build: ${BUILDS[b.type].i} стоит · не хватает ${ITEMS[U[b.paid]] ? ITEMS[U[b.paid]].i : ':food:'}`); } }
        else { b.short = 0; b.prog = Math.min(nx, cap); if (b.prog >= 1) finish(b); } void paid; }
    }
    p.buildT = Math.max(0, (p.buildT || 0) - dt);
    // содержание: раз в минуту каждый ест
    C.eatT -= dt;
    if (C.eatT <= 0) {
      C.eatT = C0.eatEvery; let hungry = 0;
      for (const u of C.units) if (!u.pet) { if (!Inv.takeStock('food', 1, true)) { u.hp -= C0.hungerHp; hungry++; } }
      if (hungry) Fx.toast(`:food: Людям нечего есть (${hungry})`);
    }
    // здания
    for (const b of C.builds) if (b.done) {
      b.t = (b.t || 0) + dt;
      if (b.type === 'labaz2' && b.t > C0.furT) { b.t = 0; const k = World.inCedar(b.x, b.y) && Math.random() < C0.furSable ? 'sable' : 'hare'; G.chest[k] = (G.chest[k] || 0) + 1; Fx.floatText(b.x, b.y - 40, '+' + ITEMS[k].i); }
      if (b.type === 'smoke' && b.t > C0.smokeT) { b.t = 0; const k = (G.chest.meat || 0) > 0 ? 'meat' : (G.chest.fish || 0) > 0 ? 'fish' : null; if (k) { G.chest[k]--; G.chest.dried = (G.chest.dried || 0) + 1; } if (Math.random() < 0.5) G.parts.push({ type: 'smoke', x: b.x + 10, y: b.y - 50, vx: rnd(-5, 5), vy: -25, life: 3, max: 3 }); }
      if (b.type === 'tower') {
        b.fuel = Math.max(0, (b.fuel || 0) - dt);
        if (b.fuel <= 0 && (G.chest.wood || 0) > 0 && (1 - daylight(h)) > 0.3) { Inv.pull(G.chest, 'wood', 1); b.fuel = C0.towerFuel; }
        b.cd = Math.max(0, (b.cd || 0) - dt);
        const th = threatNear(b, C0.towerR);
        if (th && b.cd <= 0) { b.cd = C0.towerCd; G.col.proj.push({ x: b.x, y: b.y - 70, tx: th.x, ty: th.y - 14, t: 0 }); if (Math.random() < C0.towerHit) damage(th, 1 + mod('dmg')); }
      }
    }
    for (let i = C.proj.length - 1; i >= 0; i--) { C.proj[i].t += dt * 3; if (C.proj[i].t >= 1) C.proj.splice(i, 1); }
    if (C.mark) { C.mark.t -= dt; if (C.mark.t <= 0) C.mark = null; }
    // лайка чует волков
    C.barkT -= dt;
    const pet = C.units.find(u => u.pet);
    if (pet && C.barkT <= 0) {
      const w = G.wolves.find(w => dist2(w, p) < TUNE.r.hutWolves * TUNE.r.hutWolves && w.st !== 'retreat');
      if (w) { C.barkT = C0.barkT; pet.barkUntil = now + 2; Fx.toast(':dog: Пурга лает — волки ' + dirName(w)); Sound.src(pet).bite(); }
    }
    // призрак стройки на таче — перед героем
    if (C.ghost && C.ghost.touch) { C.ghost.x = p.x + p.face * 90; C.ghost.y = p.y - 10; C.ghost.ok = canPlace(C.ghost.type, C.ghost.x, C.ghost.y); }
  }
  // площадку подновлять: вертолёт ещё ждут (связь есть, не улетели, не позже последнего борта) и утоптано < 80 %
  const padNeed = () => G.flags.contact && !G.flags.rescued && G.day <= STORY.heliLastDay && padSite() && padK() < 0.8;
  function dirName(o) {
    const a = Math.atan2(o.y - G.p.y, o.x - G.p.x) * 180 / Math.PI;
    return ['с востока', 'с юго-востока', 'с юга', 'с юго-запада', 'с запада', 'с северо-запада', 'с севера', 'с северо-востока'][((Math.round(a / 45) % 8) + 8) % 8];
  }
  function finish(b) {
    b.done = 1; b.prog = 1; Fx.toast(`${BUILDS[b.type].i} ${BUILDS[b.type].n} готов`); Sound.ok2();
    for (const u of G.col.units) if (u.task.k === 'build' && u.task.b === b.id) {
      u.task = b.type === 'woodshed' ? { k: 'chop', ph: 'go', near: { x: b.x, y: b.y } } : { k: 'idle' };
    }
    if (b.type === 'tower') b.fuel = C0.towerFuel;
    b.hp = C0.buildHp;
    if (b.type === 'pad') { G.known.mar = 1; Fx.toast(':pad: Вешки стоят · утопчи площадку :boots:'); for (const u of G.col.units) if (u.task.k === 'idle' && u.type === 'bich' && G.flags.contact) u.task = { k: 'stack' }; }
  }

  // ---------- размещение ----------
  function canPlace(type, x, y) {
    const B = BUILDS[type], r = Math.max(B.w, B.h) / 2;
    if (x < 80 || y < 80 || x > W - 80 || y > H - 80) return false;
    if (B.onMar && Math.hypot(x - POI.mar.x, y - POI.mar.y) > POI.mar.r - 60) return false;
    if (B.onMar && G.col.builds.some(b => b.type === type)) return false;
    if (Math.abs(x - riverX(y)) < RW + r) return false;
    if (Math.abs(x - HUT.x) < 130 + r && Math.abs(y - (HUT.y - 30)) < 110 + r) return false;
    for (const t of treesNear(x, y, r + 20)) if (t.wood > 0 && dist2(t, { x, y }) < (r + 8) ** 2) return false;
    for (const b of Space.builds.near(x, y, r + 60)) { const R = Math.max(BUILDS[b.type].w, BUILDS[b.type].h) / 2; if (dist2(b, { x, y }) < (r + R + 10) ** 2) return false; }
    for (const c of World.COLL) if (dist2(c, { x, y }) < (c.r + r + 20) ** 2) return false;
    if (!B.flat) for (const s of G.stacks) if (dist2(s, { x, y }) < (r + 40) ** 2) return false;   // площадка — кучи по краям можно
    return true;
  }
  function startPlace(type) {
    const B = BUILDS[type];
    if (B.ep > G.col.ep) return Fx.toast(`:close: Нужна эпоха ${EPOCHS[B.ep].n}`);
    if (B.needContact && !G.flags.contact) return Fx.toast(':pad: Сначала связь по рации — пилот скажет, где садиться');
    if (B.onMar && G.col.builds.some(b => b.type === type)) return Fx.toast(':pad: Площадка уже есть');
    if (!Inv.canPay(B.cost, true)) return Fx.toast(':close: Не хватает ресурсов');
    const onMar = B.onMar && Math.hypot(G.p.x - POI.mar.x, G.p.y - POI.mar.y) > POI.mar.r;
    G.col.ghost = onMar ? { type, x: POI.mar.x, y: POI.mar.y, ok: false, touch: false } : { type, x: G.p.x + 100, y: G.p.y, ok: false, touch: UI.isTouch };
    if (onMar) Fx.toast(':pad: Площадка — только на мари (северо-запад)');
    Fx.toast(UI.isTouch ? ':build: Тапни место и жми «Построить»' : ':build: ЛКМ — построить · ПКМ — отмена');
  }
  function place() {
    const g = G.col.ghost; if (!g) return;
    g.ok = canPlace(g.type, g.x, g.y);
    if (!g.ok) return Fx.toast(':close: Здесь не построить');
    const B = BUILDS[g.type]; if (!Inv.canPay(B.cost, true)) { G.col.ghost = null; return Fx.toast(':close: Не хватает ресурсов'); }
    // материалы не исчезают при разметке — уходят со склада по ходу стройки (paid — сколько штук уже взято)
    const b = { id: G.col.nextId++, type: g.type, x: Math.round(g.x), y: Math.round(g.y), prog: 0, done: 0, t0: G.time, paid: 0 };   // t0: разметка проступает (js/art-world.js construct)
    G.col.builds.push(b); G.col.ghost = null; Sound.hit();
    // ближайшие свободные бичи — на стройку
    // идущие наниматься (arrive) — тоже свободны: сразу на стройку
    const idle = G.col.units.filter(u => u.type === 'bich' && (u.task.k === 'idle' || u.task.arrive || G.col.sel.includes(u.id))).sort((a, c) => dist2(a, b) - dist2(c, b)).slice(0, 3);
    for (const u of idle) u.task = { k: 'build', b: b.id };
    Fx.toast(`${B.i} Стройка · ${idle.length ? ':bich: ' + idle.length : 'помогай сам (E)'}`);
  }

  // ---------- найм, эпохи, улучшения ----------
  function unitState(type) {
    const T = UNITS[type];
    if (T.ep > G.col.ep) return 'ep';
    if (pop() >= popCap()) return 'pop';
    if (G.col.queue.length >= C0.queueMax) return 'queue';
    if (!World.nearHut()) return 'station';
    if (!Inv.canPay(T.cost, true)) return 'cost';
    return 'ok';
  }
  function hire(type) { if (unitState(type) !== 'ok') return false; Inv.payStock(UNITS[type].cost); G.col.queue.push({ type, t: UNITS[type].t }); Sound.pick(); return true; }
  function epochState() {
    const C = G.col, E = EPOCHS[C.ep + 1];
    if (!E) return 'max';
    if (C.epT > 0) return 'busy';
    if (E.any && E.any.filter(t => doneCount(t)).length < E.need) return 'req';
    if (E.all && !E.all.every(t => doneCount(t))) return 'req';
    if (!World.nearHut()) return 'station';
    if (!Inv.canPay(E.cost, true)) return 'cost';
    return 'ok';
  }
  function advance() { if (epochState() !== 'ok') return false; const E = EPOCHS[G.col.ep + 1]; Inv.payStock(E.cost); G.col.epT = E.t; Fx.toast(`:epoch: Переход: ${E.n}`); Sound.ok2(); return true; }
  function techState(id) {
    const T = TECHS[id];
    if (G.col.techs[id]) return 'owned';
    if (T.ep > G.col.ep) return 'ep';
    if (!doneCount('forge')) return 'forge';
    if (G.col.research) return 'busy';
    if (!Inv.canPay(T.cost, true)) return 'cost';
    return 'ok';
  }
  function research(id) { if (techState(id) !== 'ok') return false; Inv.payStock(TECHS[id].cost); G.col.research = { id, t: TECHS[id].t }; Sound.pick(); return true; }

  // ---------- фактория ----------
  const nearMarket = () => G.col.builds.some(b => b.done && b.type === 'market' && dist2(b, G.p) < C0.marketR * C0.marketR);
  const fee = () => G.urk.respect >= C0.feeRespect ? C0.feeFriend : C0.fee;
  const sellPrice = k => Math.max(1, Math.floor(G.col.prices[k] * (1 - fee())));
  const buyPrice = k => Math.ceil(G.col.prices[k]);
  function sell(k) {
    if (!nearMarket() || Inv.cnt(k, true) <= 0) return false;
    Inv.takeStock(k, 1); G.col.rub += sellPrice(k); G.col.prices[k] = Math.max(1, G.col.prices[k] * C0.sellDecay); Sound.pick(); return true;
  }
  function buy(k) {
    if (!nearMarket() || G.col.rub < buyPrice(k)) return false;
    G.col.rub -= buyPrice(k); Inv.put(G.chest, k, 1); G.col.prices[k] *= C0.buyRise; Sound.pick(); return true;
  }
  function newDay() { for (const k in G.col.prices) G.col.prices[k] *= C0.inflation; }

  // ---------- набат ----------
  function alarm() {
    G.col.alarm = !G.col.alarm;
    Fx.toast(G.col.alarm ? ':alarm: Набат! Все в укрытие' : ':alarm: Отбой — по местам');
    Sound.tone('triangle', 880, 860, 0.6, 0.25); setTimeout(() => Sound.tone('triangle', 880, 860, 0.6, 0.2), 300);
  }

  // ---------- выделение и приказы ----------
  function selected() { return G.col.sel.map(byId).filter(u => u && !u.hidden); }
  function setTaskAll(k) {
    for (const u of selected()) {
      if (k === 'chop' && u.type === 'bich') u.task = { k: 'chop', ph: 'go', near: { x: u.x, y: u.y } };
      else if (k === 'guard' && UNITS[u.type].dmg) u.task = { k: 'guard' };
      else if (k === 'home') { u.prev = null; u.task = { k: 'shelter', manual: 1 }; }
      else if (k === 'stop') u.task = { k: 'idle' };
      else if (k === 'hunt' && u.type === 'evenk') u.task = { k: 'hunt', ph: 'go' };
    }
  }
  function selectIdle() {
    const idle = G.col.units.filter(u => !u.pet && !u.hidden && u.task.k === 'idle');
    G.col.sel = idle.map(u => u.id);
    Fx.toast(idle.length ? `:sleep: Бездельников: ${idle.length}` : ':sleep: Все при деле');
  }

  // ввод мышью / тачем — js/input.js (единый автомат, SPEC-input)

  return {
    init, update, mod, popCap, pop, spawn, drops, shelters, canPlace, startPlace, place, hire, unitState, advance, epochState,
    research, techState, sell, buy, sellPrice, buyPrice, nearMarket, newDay, alarm, selected, setTaskAll, selectIdle,
    doneCount, carryN,
  };
})();
