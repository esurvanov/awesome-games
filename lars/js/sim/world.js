// Мир: сборка всех систем симуляции, игрок, именные люди, телефон, итоги, сохранение.
// DOM не трогает — работает и в Node (tests/sim-queue.js).
'use strict';
L.def('sim/world', () => {
const { RNG, Bus, Clock, clamp, hash01, tpl, DAY, HOUR } = L.use('core');
const { Road } = L.use('sim/road');
const { Env } = L.use('sim/env');
const { Queue } = L.use('sim/queue');
const { Economy } = L.use('sim/economy');
const { Rumours } = L.use('sim/rumours');
const { Director } = L.use('sim/director');
const { check, apply, fxNeeds, NEED_ICON } = L.use('sim/rules');

const LANE_OFF = [-1.9, 1.9, -5.4, 5.4];

class World {
  constructor(C, opt = {}) {
    this.C = C; this.T = C.TUNING;
    this.bus = new Bus();
    this.rng = new RNG(opt.seed ?? C.TUNING.seed);
    this.clock = new Clock(C.CALENDAR);
    this.env = new Env(C, this.clock);
    this.road = new Road(C.ROUTE);
    this.queue = new Queue(C, this.road, this.env, this.rng);
    this.econ = new Economy(C, this.env, this.road, this.rng); this.econ.world = this;
    this.rum = new Rumours(C, this.env, this.road);
    this.dir = new Director(C, this);
    this.goods = this.econ.goods;
    this.npcDefs = new Map(C.PEOPLE.map(p => [p.id, p]));
    this.npcs = {};           // id → состояние (доверие, где)
    this.trustMap = {};       // безымянные: 'c:carId:seat' → доверие
    this.whoNames = {};       // ключ безымянного → имя (для подписей)
    this.talks = {};          // свободный разговор: ключ человека → { n, h: [{ r: 'me'|'npc', t, e }] } (js/ui/talk.js)
    this.phone = { msgs: [], nextId: 1, unread: 0, nextChatter: 0 };
    this.ledger = { helped: [], harmed: [], gave: [], got: [], spent: { rub_cash: 0, rub_card: 0, usd: 0, gel: 0 }, earned: { rub_cash: 0, rub_card: 0, usd: 0, gel: 0 }, placesLost: 0, placesGiven: 0, placesGained: 0 };
    this.stats = { hist: [], price: {} };
    this.player = null; this.role = null; this.ended = null;
    this.stepN = 0; this.lastMin = -1; this.lastHour = -1;
    this.sellerIdx = null;
    this.queue.onPass = car => this.onPass(car);
    this.queue.onOvertake = car => { this.ledger.placesLost++; this.bus.emit('toast', { icon: 'car', text: 'Объехали: −1 место', tone: -1 }); };
    this.bus.on('rumour:reveal', r => this.onReveal(r));
    this.bus.on('rule', r => this.bus.emit('toast', { icon: r.icon, text: r.label, tone: 0, big: true }));
  }

  // ─────────── старт ───────────
  init(roleId) {
    const C = this.C, Q = this.queue, R = this.rng;
    this.role = C.ROLES.find(r => r.id === roleId) || C.ROLES[0];
    this.clock.t = this.clock.parse(C.CALENDAR.worldStart);
    this.econ.build();
    // стартовая очередь
    for (let i = 0; i < this.T.queue.startCars; i++) Q.spawnCar();
    for (let i = 0; i < this.T.queue.pedStart; i++) Q.peds.push({ id: Q.nextId++, s: R.range(200, 4000), lat: R.range(4.5, 7.5) * (R.chance(0.5) ? 1 : -1), st: 0, bike: 0, ph: R.next() * 6.28 });
    // предпрогон: мир живёт сам до входа роли (крупный шаг)
    const t1 = this.clock.parse(this.role.start);
    this.fastForward(t1, 120);
    this.spawnPlayer();
    this.dir.start(this.clock.t);
    this.deliverPhone(true);
    this.bus.emit('ready');
  }
  fastForward(t1, dt) {
    while (this.clock.t < t1) this.step(Math.min(dt, t1 - this.clock.t), true);
  }
  spawnPlayer() {
    const r = this.role, Q = this.queue;
    const car = Q.spawnCar(null, { model: this.C.CARS.models.findIndex(m => m.name === r.car.model), colorHex: r.car.color, n: 1, seats: r.car.seats });
    car.pl = 1; car.fuel = r.car.fuel; car.hu = car.th = car.wa = car.ne = 50;
    this.player = {
      carId: car.id, inCar: true, x: 0, y: 0, tx: null, ty: null, then: null, sleeping: false,
      needs: { ...r.needs }, money: { ...r.money }, items: { ...r.items }, charges: {},
      flags: {}, knows: new Set(), passengers: [], startT: this.clock.t, startAhead: Q.ahead(car), startKm: car.s / 1000,
    };
    this.pcar = car;
    // именные люди
    for (const p of this.C.PEOPLE) {
      const st = this.npcs[p.id] = { id: p.id, trust: p.trust || 0, from: p.from ? this.clock.parse(p.from) : 0, passenger: false };
      for (const k of p.knows || []) st.knows = (st.knows || []).concat(k);
      if (p.kind === 'driver') {
        // занять машину рядом с игроком: n впереди (−) / позади (+) в той же полосе
        const same = Q.cars.filter(c => c.lane === car.lane), i = same.indexOf(car), j = clamp(i - p.place.car, 0, same.length - 1);
        let host = same[j];
        if (host === car) { host = Q.spawnCar(car.s + Q.spacing * (p.place.car < 0 ? 1 : -1) * Math.abs(p.place.car), { lane: car.lane }); }
        host.npc = p.id; if (p.car) { host.mi = Math.max(0, this.C.CARS.models.findIndex(m => m.name === p.car.model)); host.color = p.car.color; host.seats = p.car.seats; }
        st.carId = host.id;
      } else if (p.kind === 'walker') {
        st.s = car.s + (p.place.near || 30); st.lat = 6.5; st.home = st.s - car.s;
      }
    }
    this.syncPlayerPos();
  }

  // ─────────── шаг симуляции (фиксированный) ───────────
  step(dt, coarse = false) {
    const env = this.env, Q = this.queue;
    this.clock.t += dt; this.stepN++;
    env.updateRules(coarse ? null : this.bus);
    if (this.pcar) Q.focusS = this.pcar.s;
    const prevS = this.pcar ? this.pcar.s : 0;
    Q.step(dt);
    if (this.player && !this.ended) this.stepPlayer(dt, prevS);
    // «пачка»: дальние люди, экономика, слухи
    const every = coarse ? 1 : this.T.lod.farEvery;
    if (this.stepN % every === 0) this.farTick(dt * every);
    const min = Math.floor(this.clock.t / 60);
    if (!coarse && min !== this.lastMin) { this.lastMin = min; this.minuteTick(); }
    const hr = Math.floor(this.clock.t / HOUR);
    if (hr !== this.lastHour) { this.lastHour = hr; this.hourTick(); }
  }
  farTick(dtS) {
    const h = dtS / 3600, N = this.T.needs, env = this.env, Q = this.queue, R = this.rng, E = this.T.econ;
    const temp = env.temp(), mood = env.day().mood * 0.5 + env.ruleMood() * 0.5;
    // индекс ближайших продавцов по участкам 250 м
    const B = 250, nb = Math.ceil((this.road.len + 15000) / B);
    if (!this.sellerIdx || this.stepN % (this.T.lod.farEvery * 12) === 0) {
      this.sellerIdx = new Array(nb);
      for (let b = 0; b < nb; b++) this.sellerIdx[b] = this.econ.nearest(Math.min(b * B + B / 2, this.road.len), null, 2500);
    }
    this.rum.step(h, Q.tailS, this.bus);
    this.econ.rumourDemand = this.rum.demand(this.rum.bucket(Q.tailS) + 1);
    const warmT = this.T.needs.warmTarget;
    for (const c of Q.cars) {
      if (c.pl) continue;
      c.hu -= N.hunger * h; c.th -= N.thirst * h;
      const feels = temp + N.warm.car + (c.eng ? N.warm.engine : 0);
      const target = clamp((feels - warmT[0]) / (warmT[1] - warmT[0]) * 100, 0, 100);
      c.wa += clamp(target - c.wa, -N.warm.rate * h, N.warm.rate * h);
      if (c.eng) { c.fuel -= N.engineFuel * h; if (c.fuel <= 0 || c.wa > 75) c.eng = 0; } else if (c.wa < 40 && c.fuel > 2) c.eng = 1;
      const low = (c.hu < 25) + (c.th < 25) + (c.wa < 25);
      c.ne += (N.nervesBase + mood + this.rum.mood(c.s) - low * N.nervesLow) * h;
      // покупки у ближайшего продавца (сделки дальних людей двигают цены)
      if ((c.hu < 45 || c.th < 45 || c.fuel < 2) && R.chance(E.buyChance)) {
        const sel = this.sellerIdx[Math.min(nb - 1, Math.floor(c.s / B))];
        if (sel) {
          const want = c.fuel < 2 && sel.goods.includes('fuel') ? 'fuel' : c.th < c.hu ? (sel.goods.includes('water') ? 'water' : sel.goods.includes('tea') ? 'tea' : null) : (['pie', 'meal', 'snack', 'bread'].find(x => sel.goods.includes(x)) || null);
          if (want && sel.stock[want] >= 1) {
            this.econ.sold(sel, want, 1, this.econ.price(sel, want));
            if (want === 'fuel') c.fuel += 10; else if (want === 'water' || want === 'tea') c.th += 40; else c.hu += 40;
          }
        }
      }
      c.hu = clamp(c.hu, 0, 100); c.th = clamp(c.th, 0, 100); c.wa = clamp(c.wa, 0, 100); c.ne = clamp(c.ne, 0, 100);
    }
    const dens = s => clamp(Q.countBetween(s - 300, s + 300) / (600 / Q.spacing * Q.lanes / 2), 0, 1);
    this.econ.relax(h, dens);
  }
  minuteTick() {
    if (!this.player || this.ended) return;
    this.deliverPhone(false);
    const busy = this.busy && this.busy();
    const e = this.dir.tick(this.clock.t, busy);
    if (e) this.bus.emit('event', this.prepareEvent(e));
    // КПП: машина игрока у шлагбаума держится, пока не пройден последний разговор
    if (this.pcar) this.pcar.hold = this.pcar.s < 200 && !this.dir.fired['dog_question'] ? 1 : 0;
    if (this.clock.over && !this.ended) this.end({ id: 'time', title: 'Календарь кончился', icon: 'clock' });
  }
  hourTick() {
    const Q = this.queue;
    this.stats.hist.push([Math.round(this.clock.t), Q.cars.length, Q.people, Math.round(Q.tailS), Q.passed.cars]);
    for (const g of ['water', 'meal', 'fuel', 'bike']) (this.stats.price[g] ||= []).push(this.econ.market(g));
  }

  // ─────────── игрок ───────────
  playerCar() { return this.pcar && this.queue.cars.includes(this.pcar) ? this.pcar : null; }
  syncPlayerPos() {
    const p = this.player; if (!p) return;
    if (p.inCar && this.pcar) { const q = this.road.at(this.pcar.s, LANE_OFF[this.pcar.lane]); p.x = q.x; p.y = q.y; }
  }
  playerS() { return this.player.inCar && this.pcar ? this.pcar.s : this.road.project(this.player.x, this.player.y).s; }
  playerKpp() { return this.pcar ? Math.max(0, this.pcar.s - this.queue.gateS) : 0; }
  stepPlayer(dt, prevS) {
    const p = this.player, N = this.T.needs, h = dt / 3600, car = this.pcar, env = this.env, n = p.needs;
    n.hunger -= N.hunger * h; n.thirst -= N.thirst * h;
    n.sleep += p.sleeping ? N.sleepGain * h : -N.sleep * h;
    n.charge -= N.charge * h;
    if (car && p.flags.engine) {
      if (p.inCar) n.charge += N.engineCharge * h;
      car.fuel -= N.engineFuel * h;
      if (car.fuel <= 0) { car.fuel = 0; p.flags.engine = 0; car.eng = 0; this.bus.emit('toast', { icon: 'fuel', text: 'Бензин кончился', tone: -1 }); }
    }
    // тепло: «ощущаемая» температура → цель
    const W = N.warm, w = env.weather();
    let feels = env.temp() + (p.inCar ? W.car : W.walk) + (p.inCar && p.flags.engine ? W.engine : 0) + (p.items.blanket > 0 ? W.blanket : 0);
    if (w === 'rain' || w === 'storm') feels += W.rain; if (w === 'wind') feels += W.fog;
    const target = clamp((feels - N.warmTarget[0]) / (N.warmTarget[1] - N.warmTarget[0]) * 100, 0, 100);
    n.warmth += clamp(target - n.warmth, -W.rate * h, W.rate * h);
    // спокойствие
    let low = 0; for (const k of ['hunger', 'thirst', 'warmth', 'sleep']) if (n[k] < 25) low++;
    let rm = 0; for (const id of p.knows) { const r = this.rum.byId.get(id); if (r && !r.revealed) rm += r.mood * 0.35; }
    const mood = (env.day().mood + env.ruleMood()) * this.T.needs.moodK + rm;
    n.nerves += (N.nervesBase + mood - low * N.nervesLow) * h + (car ? Math.max(0, prevS - car.s) / 1000 * 3 : 0);
    for (const k in n) n[k] = clamp(n[k], 0, 100);
    if (p.sleeping && (n.sleep >= 99)) this.wake('Выспался');
    if (!p.sleeping && n.sleep <= 0) { p.sleeping = true; this.bus.emit('toast', { icon: 'moon', text: 'Уснул сам', tone: -1 }); }
    // машина без водителя стоит
    if (car) {
      const d = Math.hypot(p.x - this.road.at(car.s, LANE_OFF[car.lane]).x, p.y - this.road.at(car.s, LANE_OFF[car.lane]).y);
      car.stall = !p.inCar && d > this.T.player.leaveCar ? 1 : 0;
      car.eng = p.flags.engine ? 1 : 0;
    }
    this.syncPlayerPos();
    // пассажиры тратят и твои силы: их нужды — поверх (упрощённо: чуть тревожнее и теплее)
  }
  wake(why) { if (!this.player.sleeping) return; this.player.sleeping = false; this.bus.emit('toast', { icon: 'sun', text: why, tone: 1 }); }
  // игрок идёт пешком (вызывает рендер-кадр с реальным dt)
  frame(dtReal) {
    const p = this.player; if (!p || p.tx == null) return;
    const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy), v = this.T.player.walk * dtReal;
    if (d <= v) { p.x = p.tx; p.y = p.ty; p.tx = p.ty = null; const f = p.then; p.then = null; if (f) f(); }
    else { p.x += dx / d * v; p.y += dy / d * v; }
  }
  walkTo(x, y, then = null) {
    const p = this.player; if (p.sleeping) this.wake('Проснулся');
    if (p.inCar) { p.inCar = false; this.syncPlayerPos(); const q = this.road.at(this.pcar.s, LANE_OFF[this.pcar.lane] + (this.pcar.lane ? 3 : -3)); p.x = q.x; p.y = q.y; }
    p.tx = x; p.ty = y; p.then = then;
  }
  enterCar() { const p = this.player; if (!this.pcar) return; p.tx = p.ty = null; p.inCar = true; this.syncPlayerPos(); }
  addNeed(k, v) { const n = this.player.needs; n[k] = clamp(n[k] + v, 0, 100); }
  addMoney(k, v) { const m = this.player.money; m[k] = Math.max(0, (m[k] || 0) + v); if (v < 0) this.ledger.spent[k] += -v; else this.ledger.earned[k] += v; }
  addItem(k, v) {
    const it = this.player.items; it[k] = Math.max(0, (it[k] || 0) + v); if (!it[k]) delete it[k];
    const g = this.goods.get(k); if (v > 0 && g?.keep && !this.player.charges[k]) this.player.charges[k] = g.charges || 1;
  }
  trustOf(id) { if (!id) return 0; if (this.npcs[id]) return this.npcs[id].trust; return this.trustMap[id] || 0; }
  addTrust(id, v) { if (!id) return; if (this.npcs[id]) this.npcs[id].trust = clamp(this.npcs[id].trust + v, -100, 100); else this.trustMap[id] = clamp((this.trustMap[id] || 0) + v, -100, 100); }
  nameOf(id) { if (!id) return ''; if (this.npcDefs.has(id)) return this.npcDefs.get(id).name; if (this.whoNames[id]) return this.whoNames[id]; if (id.startsWith('c:')) { const [, c, s] = id.split(':'); return this.person(+c, +s).name; } return ''; }
  learn(id) {
    const p = this.player; if (p.knows.has(id)) return false;
    p.knows.add(id); const r = this.rum.byId.get(id);
    if (r) this.bus.emit('rumour:learn', r);
    return true;
  }
  shiftPlaces(n) {
    const car = this.pcar; if (!car) return 0;
    const k = this.queue.shift(car, n);
    if (n < 0) this.ledger.placesGiven += -k; else this.ledger.placesGained += k;
    return n < 0 ? -Math.abs(k) : Math.abs(k);
  }
  advance(km) { const car = this.pcar; if (!car) return 0; const s0 = car.s; this.queue.jump(car, km); this.ledger.placesGained += 0; return (s0 - car.s) / 1000; }
  skipTime(min) {
    const steps = Math.round(min * 60 / this.T.time.step);
    for (let i = 0; i < steps && !this.ended; i++) this.step(this.T.time.step);
  }
  addPassenger(who) {
    const p = this.player, car = this.pcar; if (!car || p.passengers.length >= car.seats - 1) return false;
    let entry;
    if (typeof who === 'string' && this.npcs[who]) { this.npcs[who].passenger = true; entry = { id: who, name: this.nameOf(who), icon: this.npcDefs.get(who).icon }; }
    else if (who && who.ped) { const i = this.queue.peds.indexOf(who.ped); if (i >= 0) this.queue.peds.splice(i, 1); entry = { id: who.key, name: who.name, icon: 'user' }; }
    else if (who) entry = { id: who.key, name: who.name, icon: 'user' };
    else return false;
    if (p.passengers.some(x => x.id === entry.id)) return false;
    p.passengers.push(entry); car.n++;
    this.ledgerAdd('helped', entry.name + ' — место в машине', 'car');
    return true;
  }
  ledgerAdd(kind, text, icon) { const l = this.ledger[kind]; if (!l.some(x => x.text === text)) l.push({ text, icon, t: Math.round(this.clock.t) }); }

  // ─────────── люди ───────────
  // безымянный человек из машины: детерминированно из id машины и места
  person(carId, seat = 0) {
    const N = this.C.NAMES, k = carId * 8 + seat;
    const f = hash01(k, 1) < 0.35, names = f ? N.f : N.m;
    const name = names[Math.floor(hash01(k, 2) * names.length)];
    const age = 19 + Math.floor(hash01(k, 3) * 40);
    const tr = N.traits[Math.floor(hash01(k, 4) * N.traits.length)];
    const job = N.jobs[Math.floor(hash01(k, 5) * N.jobs.length)];
    this.whoNames['c:' + carId + ':' + seat] = name;
    return { key: 'c:' + carId + ':' + seat, name, age, job, good: tr.good, bad: tr.bad, f, carId, seat };
  }
  pedPerson(ped) { const q = this.person(1e6 + ped.id, 0); q.key = 'p:' + ped.id; q.ped = ped; this.whoNames[q.key] = q.name; return q; }
  npcPresent(id) {
    const st = this.npcs[id], d = this.npcDefs.get(id); if (!st || !d) return false;
    if (this.clock.t < st.from) return false;
    if (d.kind === 'driver') return this.queue.cars.some(c => c.id === st.carId);
    return true;
  }
  npcCar(id) { const st = this.npcs[id]; return st?.carId ? this.queue.cars.find(c => c.id === st.carId) : null; }
  npcPos(id) {
    const d = this.npcDefs.get(id), st = this.npcs[id]; if (!d || !st) return null;
    if (st.passenger) return this.pcar ? this.road.at(this.pcar.s, LANE_OFF[this.pcar.lane]) : null;
    if (d.kind === 'seller') { const s = this.econ.sellers.find(o => o.npc === id); return s ? { x: s.x, y: s.y, s: s.s } : null; }
    if (d.kind === 'driver') { const c = this.npcCar(id); return c ? { ...this.road.at(c.s, LANE_OFF[c.lane]), s: c.s } : null; }
    if (d.kind === 'walker') {
      // пешие держатся рядом с игроком, пока он в очереди
      if (this.pcar) { st.s += (this.pcar.s + st.home - st.s) * 0.02; }
      return { ...this.road.at(st.s, st.lat), s: st.s };
    }
    return null;
  }
  // случайный незнакомец рядом (для npc: 'near')
  nearStranger() {
    const car = this.pcar; if (!car) return null;
    const i = this.queue.cars.indexOf(car), a = this.queue.cars;
    const cands = [];
    for (let k = Math.max(0, i - 8); k < Math.min(a.length, i + 8); k++) if (a[k] !== car && !a[k].npc) cands.push(a[k]);
    if (!cands.length) return null;
    const c = this.rng.pick(cands); return this.person(c.id, this.rng.int(0, Math.max(0, c.n - 1)));
  }
  isNear(spec) {
    const p = this.player, R = 140;
    if (spec === 'seller') { const s = this.econ.nearest(this.playerS(), null, R); return !!s; }
    const [kind, id] = spec.split(':');
    if (kind === 'place') { const pl = this.C.ROUTE.places.find(x => x.id === id); return pl ? Math.abs(this.playerS() - pl.s * 1000) < 450 : false; }
    if (kind === 'npc') { const q = this.npcPos(id); return q ? Math.hypot(q.x - p.x, q.y - p.y) < R && this.npcPresent(id) : false; }
    return false;
  }

  // ─────────── события ───────────
  prepareEvent(e) {
    let npc = null, who = null;
    if (e.npc === 'near') who = this.nearStranger();
    else if (e.npc) npc = e.npc;
    const vars = { km: (this.playerKpp() / 1000).toFixed(1).replace('.', ',') };
    if (who) Object.assign(vars, { name: who.name, age: who.age, job: who.job });
    if (npc) { const d = this.npcDefs.get(npc); Object.assign(vars, { name: d.name, age: d.age, job: d.job }); }
    if (who) npc = who.key;
    if (this.player.sleeping) this.wake('Разбудили');
    return { e, npc, who, vars, text: tpl(e.text, vars), title: tpl(e.title, vars) };
  }
  // доступность варианта: '' или причина
  choiceBlock(ch, ctx) { return check(ch.need, this, ctx) || fxNeeds(ch.fx, this); }
  choose(ev, ch) {
    const ctx = { npc: ev.npc, who: ev.who, vars: ev.vars, icon: ev.e.icon };
    const r = apply(ch.fx, this, ctx);
    r.out = tpl(r.out ?? ch.out ?? '', ev.vars);
    this.bus.emit('chosen', { ev, ch, r });
    if (r.end) this.end(r.end);
    return r;
  }

  // ─────────── действия ───────────
  actionsFor(tg) {
    const out = [];
    for (const a of this.C.ACTIONS) {
      if (a.target !== tg.kind) continue;
      let why = check(a.when, this, { npc: tg.npc });
      if (!why && a.tgt) why = this.tgtCheck(a.tgt, tg);
      if (!why && a.fx) why = fxNeeds(a.fx, this);
      if (!why && a.op === 'shop' && a.arg && !tg.seller?.goods.includes(a.arg)) continue;
      if (a.target === 'seller' && tg.seller && !this.econ.active(tg.seller)) why = 'закрыто';
      if (why === 'правило' || why === 'уже') continue;
      out.push({ a, why });
    }
    return out;
  }
  tgtCheck(t, tg) {
    const p = this.player, car = this.pcar;
    if (t.ped && !tg.ped && !(tg.npc && this.npcDefs.get(tg.npc)?.kind === 'walker')) return 'не пешком';
    if (t.seats && (!car || p.passengers.length >= car.seats - 1)) return 'нет мест';
    if (t.named && !(tg.npc && this.npcDefs.has(tg.npc))) return 'не знаком';
    if (t.trustMin != null && this.trustOf(tg.npc) < t.trustMin) return 'мало доверия';
    if ((t.ahead || t.behind) && tg.car && car) {
      const a = this.queue.cars.filter(c => c.lane === car.lane), i = a.indexOf(car), j = a.indexOf(tg.car);
      if (t.ahead && j !== i - 1) return 'не впереди';
      if (t.behind && j !== i + 1) return 'не позади';
    }
    return '';
  }
  targetPos(tg) {
    if (tg.seller) return { x: tg.seller.x, y: tg.seller.y };
    if (tg.car) return this.road.at(tg.car.s, LANE_OFF[tg.car.lane] + (tg.car.lane ? 2.6 : -2.6));
    if (tg.npc && this.npcDefs.has(tg.npc)) return this.npcPos(tg.npc);
    if (tg.ped) return this.road.at(tg.ped.s, tg.ped.lat);
    if (tg.pos) return tg.pos;
    return null;
  }
  inReach(tg) {
    if (tg.kind === 'self' || tg.kind === 'own') return true;
    const q = this.targetPos(tg); if (!q) return true;
    const p = this.player; const d = Math.hypot(q.x - p.x, q.y - p.y);
    return d <= this.T.player.reach + (p.inCar ? 12 : 0);
  }
  // выполнить действие: { chips, out, ui?, end? }
  doAction(a, tg, arg) {
    const p = this.player, car = this.pcar, R = this.rng, chips = [];
    const res = { chips, out: '' };
    const ctx = { npc: tg.npc, who: tg.who, vars: { name: tg.who?.name || this.nameOf(tg.npc) }, icon: a.icon };
    const say = t => res.out = t;
    switch (a.op) {
      case 'shop': res.ui = { kind: 'shop', seller: tg.seller, only: a.arg || null }; return res;
      case 'exchange': res.ui = { kind: 'exchange', seller: tg.seller }; return res;
      case 'give': res.ui = { kind: 'give', tg }; return res;
      case 'phone': res.ui = { kind: 'phone' }; return res;
      case 'backpack': res.ui = { kind: 'bag' }; return res;
      case 'freeTalk': res.ui = { kind: 'talk', tg }; return res;
      case 'talk': {
        const d = tg.npc && this.npcDefs.get(tg.npc), tr = this.trustOf(tg.npc);
        if (d) { const L = d.lines; const pool = tr < 0 ? L.low : tr >= 30 && L.high ? L.high : L.hi; say('«' + R.pick(pool) + '»'); }
        else if (tg.who) say(`«Я ${tg.who.job}. ${R.pick(['Третьи сутки тут.', 'Жена ждёт в Тбилиси.', 'Главное — не глушить мотор.', 'Ничего, прорвёмся.', 'Кто бы знал, что так будет.'])}»`);
        this.addTrust(tg.npc, 3); chips.push({ icon: 'handshake', text: (this.nameOf(tg.npc) || '') + ' +3', tone: 1 });
        this.addNeed('nerves', 3); chips.push({ icon: 'heart', text: '+3', tone: 1 });
        if (R.chance(0.35)) this.hearFrom(tg, chips);
        break;
      }
      case 'news': if (!this.hearFrom(tg, chips)) say('«Ничего нового. Стоим»'); break;
      case 'lift': {
        const who = tg.npc && this.npcDefs.has(tg.npc) ? tg.npc : tg.who;
        if (this.addPassenger(who)) { chips.push({ icon: 'user', text: '+пассажир', tone: 1 }); this.addTrust(tg.npc, 25); this.addNeed('nerves', 4); say('«Спасибо! Правда спасибо»'); }
        break;
      }
      case 'swapAhead': {
        const price = Math.max(1000, Math.round(this.econ.market('seat') * 0.5 / 100) * 100);
        if (p.money.rub_cash < price) { say('«Место — ' + price.toLocaleString('ru') + ' ₽. Нет? Стой»'); break; }
        if (this.trustOf(tg.npc) < -10) { say('«Нет»'); break; }
        this.addMoney('rub_cash', -price); chips.push({ icon: 'cash', text: '−' + price.toLocaleString('ru') + ' ₽', tone: -1 });
        const k = this.shiftPlaces(1); chips.push({ icon: 'car', text: '+' + k + ' место', tone: 1 });
        this.ledgerAdd('gave', price.toLocaleString('ru') + ' ₽ за место');
        break;
      }
      case 'letAhead': {
        const k = this.shiftPlaces(-1); chips.push({ icon: 'car', text: '−' + Math.abs(k) + ' место', tone: -1 });
        this.addTrust(tg.npc, 12); chips.push({ icon: 'handshake', text: (this.nameOf(tg.npc) || '') + ' +12', tone: 1 });
        this.ledgerAdd('helped', (this.nameOf(tg.npc) || 'сосед') + ' — пропустил', 'arrowUp');
        break;
      }
      case 'push': this.addTrust(tg.npc, 8); this.addNeed('warmth', 6); this.addNeed('nerves', 3); this.ledgerAdd('helped', (this.nameOf(tg.npc) || 'сосед') + ' — подтолкнул', 'hands');
        chips.push({ icon: 'handshake', text: '+8', tone: 1 }, { icon: 'fire', text: '+6', tone: 1 }); say('Машина завелась с толкача'); break;
      case 'askCharge':
        if (this.trustOf(tg.npc) >= 0 && R.chance(0.7)) { this.addNeed('charge', 30); chips.push({ icon: 'battery', text: '+30', tone: 1 }); say('«Давай, у меня прикуриватель»'); }
        else { this.addNeed('nerves', -2); chips.push({ icon: 'heart', text: '−2', tone: -1 }); say('«Самому надо»'); }
        break;
      case 'honk': this.addTrust(tg.npc, -6); this.addNeed('nerves', 2); chips.push({ icon: 'handshake', text: '−6', tone: -1 }); say('Сзади ответили тем же'); break;
      case 'sleep': p.sleeping = true; say('Глаза закрываются'); break;
      case 'engine': p.flags.engine = a.arg; if (car) car.eng = a.arg; if (a.arg && car && car.fuel <= 0) { p.flags.engine = 0; say('Бензина нет'); } break;
      case 'toCar': { const q = this.road.at(car.s, LANE_OFF[car.lane]); this.walkTo(q.x, q.y, () => this.enterCar()); res.walking = true; return res; }
      case 'leaveCar': { const q = this.road.at(car.s, LANE_OFF[car.lane] + (car.lane ? 3.2 : -3.2)); p.inCar = false; p.x = q.x; p.y = q.y; break; }
      case 'refuel': this.addItem('fuel', -1); car.fuel = Math.min(this.role.car.tank, car.fuel + 10); chips.push({ icon: 'fuel', text: '+10 л', tone: 1 }); break;
      case 'callHome': this.addNeed('charge', -6); this.addNeed('nerves', 9); chips.push({ icon: 'battery', text: '−6', tone: -1 }, { icon: 'heart', text: '+9', tone: 1 }); say('«Ты поел? Только честно»'); break;
      case 'rest': this.addNeed('nerves', 4); this.addNeed('sleep', 2); chips.push({ icon: 'heart', text: '+4', tone: 1 }); break;
    }
    if (a.fx) { const r = apply(a.fx, this, ctx); chips.push(...r.chips); }
    if (a.time) { this.skipTime(a.time); chips.push({ icon: 'clock', text: a.time + ' мин', tone: 0 }); }
    return res;
  }
  hearFrom(tg, chips) {
    const s = tg.car ? tg.car.s : tg.seller ? tg.seller.s : this.playerS();
    const r = this.rum.hear(s, this.player.knows, this.rng);
    if (!r) return false;
    this.learn(r.id); chips.push({ icon: r.icon, text: r.text, tone: 0, rumour: r.id });
    return true;
  }
  // покупка у продавца
  buy(sel, goodId, opt) {
    const p = this.player, g = this.goods.get(goodId), rub = this.econ.price(sel, goodId, this.trustOf(sel.npc));
    if (opt.method !== 'free') {
      if ((p.money[opt.cur] || 0) < opt.amount) return null;
      this.addMoney(opt.cur, -opt.amount);
      if (opt.method === 'transfer_rub') this.addNeed('charge', -1);
    } else {
      // бесплатно — не больше одного в час на товар
      const key = 'free:' + sel.id + ':' + goodId, last = p.flags[key] || -1e9;
      if (this.clock.t - last < 3600) return { chips: [], out: 'Уже брал. Другим тоже нужно' };
      p.flags[key] = this.clock.t;
    }
    if ((sel.stock[goodId] ?? 0) < 1) return { chips: [], out: 'Кончилось' };
    this.econ.sold(sel, goodId, 1, rub);
    const chips = [];
    if (opt.method !== 'free') chips.push({ icon: opt.cur === 'usd' ? 'dollar' : 'cash', text: '−' + (opt.cur === 'usd' ? '$' + opt.amount : opt.amount.toLocaleString('ru') + ' ₽'), tone: -1 });
    if (g.service) { for (const k in g.use.needs) { this.addNeed(k, g.use.needs[k]); chips.push({ icon: NEED_ICON[k], text: '+' + g.use.needs[k], tone: 1 }); } }
    else { this.addItem(goodId, 1); chips.push({ icon: g.icon, text: '+1 ' + g.name.toLowerCase(), tone: 1 }); }
    if (sel.npc) this.addTrust(sel.npc, rub ? 1 : 2);
    if (!rub) this.ledgerAdd('got', g.name + ' от ' + (sel.npc ? this.nameOf(sel.npc) : 'волонтёров'));
    this.bus.emit('bought', { sel, goodId, rub });
    return { chips, out: '' };
  }
  exchange(sel, usd) {
    const rate = this.econ.usdRate(), p = this.player; if (p.money.usd < usd) return null;
    this.addMoney('usd', -usd); this.addMoney('rub_cash', usd * rate);
    return { chips: [{ icon: 'dollar', text: '−$' + usd, tone: -1 }, { icon: 'cash', text: '+' + (usd * rate).toLocaleString('ru') + ' ₽', tone: 1 }], out: 'Курс ' + rate + ' ₽ за $' };
  }
  useItem(id) {
    const g = this.goods.get(id), p = this.player; if (!g?.use || !(p.items[id] > 0)) return null;
    const chips = [];
    for (const k in g.use.needs) { this.addNeed(k, g.use.needs[k]); chips.push({ icon: NEED_ICON[k], text: '+' + g.use.needs[k], tone: 1 }); }
    if (g.keep) { p.charges[id] = (p.charges[id] ?? g.charges ?? 1) - 1; if (p.charges[id] <= 0) { this.addItem(id, -1); delete p.charges[id]; if (p.items[id] > 0) p.charges[id] = g.charges; } }
    else this.addItem(id, -1);
    return { chips };
  }
  give(tg, id, n = 1) {
    const p = this.player; const chips = [];
    if (id === 'money') { if (p.money.rub_cash < n) return null; this.addMoney('rub_cash', -n); chips.push({ icon: 'cash', text: '−' + n.toLocaleString('ru') + ' ₽', tone: -1 }); }
    else { if (!(p.items[id] > 0)) return null; this.addItem(id, -1); chips.push({ icon: this.goods.get(id).icon, text: '−1 ' + this.goods.get(id).name.toLowerCase(), tone: -1 }); }
    const name = tg.who?.name || this.nameOf(tg.npc) || 'сосед';
    const tr = id === 'money' ? Math.min(20, Math.round(n / 100)) : 10;
    this.addTrust(tg.npc, tr); chips.push({ icon: 'handshake', text: name + ' +' + tr, tone: 1 });
    this.addNeed('nerves', 3);
    if (tg.car) { tg.car.hu = Math.min(100, tg.car.hu + 15); tg.car.ne = Math.min(100, tg.car.ne + 8); }
    this.ledgerAdd('helped', name, 'gift'); this.ledgerAdd('gave', (id === 'money' ? n.toLocaleString('ru') + ' ₽' : this.goods.get(id).name) + ' → ' + name);
    return { chips, out: '«Спасибо»' };
  }

  // ─────────── телефон ───────────
  phoneMsg(chat, text, from = null, extra = {}) {
    const m = { id: this.phone.nextId++, chat, from, text, t: Math.round(this.clock.t), read: from === 'me', ...extra };
    this.phone.msgs.push(m); if (!m.read) this.phone.unread++;
    this.bus.emit('phone', m);
    return m;
  }
  signal() { const s = this.playerS() / 1000; for (const z of this.C.ROUTE.signal || []) if (s >= z.from && s < z.to) return z.level; return 1; }
  chatAvailable(ch) { return !ch.from || this.clock.t >= this.clock.parse(ch.from); }
  deliverPhone(initial) {
    const P = this.C.PHONE, t = this.clock.t, p = this.player; if (!p) return;
    if (p.needs.charge <= 0 || !this.signal()) return; // телефон сел или нет сети — сообщения ждут
    this._deliv ||= new Set();
    const mine = new Set([...(this.role.contacts || []), ...P.chats.map(c => c.id)]);
    P.messages.forEach((m, i) => {
      if (this._deliv.has(i) || !mine.has(m.chat)) return;
      if (t >= this.clock.parse(m.at)) { this._deliv.add(i); this.phoneMsg(m.chat, m.text, m.from || m.chat, { replies: m.replies || null, src: i }); }
    });
    if (initial) { this.phone.nextChatter = t + 20 * 60; return; }
    // фоновые реплики
    if (t >= this.phone.nextChatter) {
      this.phone.nextChatter = t + this.rng.range(35, 90) * 60;
      const pool = P.chatter.filter(c => this.chatAvailable(P.chats.find(x => x.id === c.chat) || {}) && !check(c.when, this));
      if (pool.length) { const c = this.rng.pick(pool); this.phoneMsg(c.chat, tpl(c.text, { km: (this.playerKpp() / 1000).toFixed(1).replace('.', ',') }), 'chat'); }
    }
    // слухи участка всплывают в чате
    const rch = P.chats.find(c => c.rumours);
    if (rch) for (const x of this.rum.at(this.playerS())) {
      if (x.v >= this.T.rumours.chatShare && !p.knows.has(x.r.id)) { this.learn(x.r.id); this.phoneMsg(rch.id, x.r.text, 'chat', { rumour: x.r.id }); break; }
    }
  }
  onReveal(r) {
    if (!this.player || !this.player.knows.has(r.id)) return;
    const mark = r.truth === 'true' ? '✅' : r.truth === 'false' ? '❌' : '🟡';
    if (r.reveal) this.phoneMsg(this.C.PHONE.chats.find(c => c.rumours)?.id || 'lars', mark + ' ' + r.reveal, 'chat', { rumour: r.id, reveal: true });
  }
  reply(m, k) {
    if (m.replied != null || !m.replies) return null;
    m.replied = k; const rp = m.replies[k];
    this.phoneMsg(m.chat, rp.label, 'me');
    return apply(rp.fx, this, {});
  }

  // ─────────── проход КПП и конец ───────────
  onPass(car) {
    if (car.pl && !this.ended) {
      this.end({ id: 'car', title: 'Через КПП на своей машине', icon: 'car' });
    }
    if (car.npc) this.npcs[car.npc] && (this.npcs[car.npc].passed = true);
  }
  end(e) {
    if (this.ended) return;
    const p = this.player;
    this.ended = { ...e, t: Math.round(this.clock.t) };
    if (e.id === 'car') this.ledgerAdd('got', 'штамп в паспорте');
    for (const x of p.passengers) this.ledgerAdd('got', x.name + ' — попутчик');
    this.bus.emit('end', this.summary());
  }
  summary() {
    const p = this.player, L = this.ledger, Q = this.queue, t = this.clock.t;
    const knew = [...p.knows].map(id => this.rum.byId.get(id)).filter(Boolean);
    return {
      end: this.ended, waited: t - p.startT, startAhead: p.startAhead, startKm: p.startKm,
      helped: L.helped, harmed: L.harmed, gave: L.gave, got: L.got, spent: L.spent, earned: L.earned,
      placesLost: L.placesLost, placesGiven: L.placesGiven, placesGained: L.placesGained, talks: L.talks || 0,
      rumours: knew.map(r => ({ id: r.id, text: r.text, truth: r.truth, icon: r.icon })),
      needs: { ...p.needs }, money: { ...p.money }, passengers: p.passengers.slice(),
      passed: { ...Q.passed }, trust: Object.fromEntries(Object.entries(this.npcs).map(([k, v]) => [k, v.trust])),
    };
  }

  // ─────────── сохранение ───────────
  save() {
    const Q = this.queue, p = this.player;
    return {
      v: 1, t: this.clock.t, rng: this.rng.s, role: this.role.id, stepN: this.stepN,
      q: { id: Q.nextId, acc: [Q.accCar, Q.accArr, Q.accPed, Q.accPedArr], passed: Q.passed, lost: Q.stallLost,
        cars: Q.cars.map(c => [c.id, +c.s.toFixed(2), c.lane, c.mi, c.ci, c.n, c.seats, c.hu | 0, c.th | 0, c.wa | 0, c.ne | 0, +c.fuel.toFixed(1), c.eng, c.npc, c.pl, c.stall, c.reg, c.color, c.mv]),
        peds: Q.peds.map(q => [q.id, +q.s.toFixed(1), +q.lat.toFixed(1), q.st, q.bike]) },
      sellers: this.econ.sellers.map(o => [o.id, o.stock, o.demand, o.sold, o.earned]),
      rum: this.rum.save(), dir: this.dir.save(), rules: [...this.env.active],
      player: { ...p, knows: [...p.knows] }, npcs: this.npcs, trust: this.trustMap,
      phone: { ...this.phone, deliv: [...(this._deliv || [])] }, ledger: this.ledger, stats: this.stats, ended: this.ended, talks: this.talks,
    };
  }
  static load(C, o) {
    const w = new World(C, { seed: 1 });
    w.role = C.ROLES.find(r => r.id === o.role) || C.ROLES[0];
    w.clock.t = o.t; w.rng.s = o.rng; w.stepN = o.stepN;
    w.econ.build();
    const Q = w.queue; Q.nextId = o.q.id; [Q.accCar, Q.accArr, Q.accPed, Q.accPedArr] = o.q.acc; Q.passed = o.q.passed; Q.stallLost = o.q.lost;
    Q.cars = o.q.cars.map(a => ({ id: a[0], s: a[1], lane: a[2], mi: a[3], ci: a[4], n: a[5], seats: a[6], hu: a[7], th: a[8], wa: a[9], ne: a[10], fuel: a[11], eng: a[12], npc: a[13], pl: a[14], stall: a[15], reg: a[16], color: a[17], mv: a[18] }));
    Q.peds = o.q.peds.map(a => ({ id: a[0], s: a[1], lat: a[2], st: a[3], bike: a[4], ph: (a[0] * 0.77) % 6.28 }));
    const byId = new Map(w.econ.sellers.map(s => [s.id, s]));
    for (const [id, stock, demand, sold, earned] of o.sellers) { const s = byId.get(id); if (s) Object.assign(s, { stock, demand, sold, earned }); }
    w.rum.load(o.rum); w.dir.load(o.dir);
    w.env.active = new Set(o.rules); w.env._ruleT = w.clock.t;
    w.player = { ...o.player, knows: new Set(o.player.knows) };
    w.pcar = Q.cars.find(c => c.pl) || null;
    w.npcs = o.npcs; w.trustMap = o.trust;
    w.phone = { msgs: o.phone.msgs, nextId: o.phone.nextId, unread: o.phone.unread, nextChatter: o.phone.nextChatter };
    w._deliv = new Set(o.phone.deliv);
    w.ledger = o.ledger; w.stats = o.stats; w.ended = o.ended; w.talks = o.talks || {};
    w.lastMin = Math.floor(w.clock.t / 60); w.lastHour = Math.floor(w.clock.t / HOUR);
    w.syncPlayerPos();
    return w;
  }
}
return { LANE_OFF, World };
});
