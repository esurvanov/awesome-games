// Очередь: тысячи машин на ~25 км, пешеходы, КПП. Разреженное движение: КПП пропускает столько-то в час
// (календарь × правила), хвост растёт прибытием; машины подтягиваются рывками (зазор > jerk — поехали).
// Ряды — по ROUTE.lanes: в одном ряду машина идёт за предыдущей, в двухрядной зоне выбирает ряд, где свободнее.
// Машина хранит усреднённые потребности своих людей (LOD: отдельные люди появляются только рядом с камерой).
'use strict';
L.def('sim/queue', () => {
const { clamp } = L.use('core');

class Queue {
  constructor(C, road, env, rng) {
    this.C = C; this.T = C.TUNING.queue; this.road = road; this.env = env; this.rng = rng;
    this.laneZones = (C.ROUTE.lanes || [{ from: 0, to: 99, n: 1 }]).map(z => ({ a: z.from * 1000, b: z.to * 1000, n: z.n }));
    this.lanes = Math.max(...this.laneZones.map(z => z.n));
    this.spacing = this.T.carLen + this.T.gap;
    this.gateS = 25;                 // м: шлагбаум КПП
    this.barrierS = 140;             // м: «последний шлагбаум» для пеших
    this.cars = [];                  // по возрастанию s (голова у КПП — первая)
    this.peds = [];
    this.nextId = 1;
    this.accCar = 0; this.accArr = 0; this.accPed = 0; this.accPedArr = 0;
    this.passed = { cars: 0, people: 0, peds: 0 };
    this.tick = 0;
    this.focusS = 0;                 // где камера/игрок — там подробнее (LOD)
    this.lastS = new Float64Array(this.lanes);
    this.onPass = null; this.onOvertake = null;
    this.stallLost = 0;
  }
  lanesAt(s) { for (const z of this.laneZones) if (s >= z.a && s < z.b) return z.n; return 1; }
  spawnCar(s = null, opt = {}) {
    const R = this.rng, CARS = this.C.CARS, [n0, n1] = this.T.peoplePerCar;
    if (s == null) s = Math.max(this.gateS, this.tailS + this.spacing + R.range(0, 3));
    const mi = opt.model != null && opt.model >= 0 ? opt.model : this.pickModel(), m = CARS.models[mi];
    const car = {
      id: this.nextId++, s, lane: opt.lane ?? 0, mv: 0, mi, ci: opt.color ?? this.pickColor(), color: opt.colorHex || null,
      n: opt.n ?? R.int(n0, Math.min(n1, m.seats)), seats: opt.seats ?? m.seats,
      hu: R.range(55, 90), th: R.range(55, 90), wa: R.range(60, 90), ne: R.range(40, 75),
      fuel: R.range(5, 40), eng: 0, npc: opt.npc || null, pl: 0, stall: 0, reg: R.int(0, CARS.regions.length - 1),
    };
    this.insert(car);
    return car;
  }
  pickModel() { const M = this.C.CARS.models; return this.rng.weighted(M.map((_, i) => i), i => M[i].share ?? 1); }
  pickColor() { const C = this.C.CARS.colors; return this.rng.weighted(C.map((_, i) => i), i => C[i].share ?? 1); }
  insert(car) { const a = this.cars; let i = a.length; while (i > 0 && a[i - 1].s > car.s) i--; a.splice(i, 0, car); }
  ahead(car) { const i = this.cars.indexOf(car); return i < 0 ? 0 : i; }
  lowerBound(s) { const a = this.cars; let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m].s < s) lo = m + 1; else hi = m; } return lo; }
  countBetween(s0, s1) { return this.lowerBound(s1) - this.lowerBound(s0); }
  get tailS() { return this.cars.length ? this.cars[this.cars.length - 1].s : this.gateS - this.spacing; }
  get people() { let p = 0; for (const c of this.cars) p += c.n; return p + this.peds.length; }

  step(dt) {
    const T = this.T, env = this.env, a = this.cars;
    this.tick++;
    // 1) КПП: пропуск машин (первая, стоящая у шлагбаума)
    this.accCar += env.through('car') * dt / 3600;
    while (this.accCar >= 1 && a.length) {
      let k = -1;
      for (let i = 0; i < Math.min(a.length, this.lanes + 2); i++) if (a[i].s <= this.gateS + 1 && !a[i].stall && !a[i].hold) { k = i; break; }
      if (k < 0) { this.accCar = Math.min(this.accCar, 1.5); break; }
      const car = a.splice(k, 1)[0];
      this.accCar -= 1; this.passed.cars++; this.passed.people += car.n;
      if (this.onPass) this.onPass(car);
    }
    // 2) прибытие в хвост
    this.accArr += env.arrive('car') * dt / 3600;
    while (this.accArr >= 1) { this.accArr -= 1; this.spawnCar(); }
    // 3) подтягивание рывками (дальние от фокуса — реже, крупным шагом: LOD)
    const lastS = this.lastS; lastS.fill(-1);
    const coarse = 4, doFar = this.tick % coarse === 0, fs = this.focusS, far = 3000;
    const creep = T.creep * dt / 60, jerk = T.jerk, sp = this.spacing;
    let prevS = -1, stalled = null, stallLimit = 0;
    for (let i = 0; i < a.length; i++) {
      const c = a[i];
      let limit;
      if (this.lanesAt(c.s) > 1) {
        if (!c.l2) { // въехал в двухрядную зону — в ряд, где свободнее
          let best = 0; for (let l = 1; l < this.lanes; l++) if (lastS[l] < lastS[best]) best = l;
          c.lane = best; c.l2 = 1;
        }
        limit = lastS[c.lane] < 0 ? this.gateS : lastS[c.lane] + sp;
      } else {
        c.l2 = 0; c.lane = 0;
        limit = prevS < 0 ? this.gateS : prevS + sp;
      }
      const isFar = Math.abs(c.s - fs) > far;
      if (c.stall) { stalled = c; stallLimit = limit; }
      else if (!isFar || doFar) {
        if (c.s - limit > (limit === this.gateS ? 0.3 : jerk)) c.mv = 1;
        if (c.mv) { const ns = c.s - creep * (isFar ? coarse : 1); if (ns <= limit) { c.s = limit; c.mv = 0; } else c.s = ns; }
      }
      if (c.s < limit - 0.01 && limit !== this.gateS) c.s = limit; // не наезжать
      lastS[c.lane] = Math.max(lastS[c.lane], c.s); prevS = Math.max(prevS, c.s);
    }
    // 4) порядок по s (почти отсортировано — вставками)
    for (let i = 1; i < a.length; i++) {
      const c = a[i]; if (a[i - 1].s <= c.s) continue;
      let j = i - 1; while (j >= 0 && a[j].s > c.s) { a[j + 1] = a[j]; j--; } a[j + 1] = c;
    }
    // 5) брошенная машина: задние объезжают по встречке и встают в зазор
    if (stalled && stalled.s - stallLimit > T.stallGap) {
      const i = a.indexOf(stalled), fol = a[i + 1];
      if (fol && !fol.pl) {
        fol.s = stallLimit; fol.lane = stalled.lane; fol.l2 = stalled.l2; fol.mv = 0; this.stallLost++;
        this.resort();
        if (stalled.pl && this.onOvertake) this.onOvertake(fol);
      }
    }
    this.stepPeds(dt);
  }
  resort() { this.cars.sort((x, y) => x.s - y.s); }
  stepPeds(dt) {
    const env = this.env, R = this.rng, p = this.peds;
    this.accPedArr += env.arrive('ped') * dt / 3600;
    while (this.accPedArr >= 1) {
      this.accPedArr -= 1;
      // пешие высаживаются за блокпостом (~9 км) или у хвоста — что ближе к КПП
      const s0 = Math.min(this.road.len - 20, Math.max(600, Math.min(this.tailS, 9000) + R.range(-300, 300)));
      p.push({ id: this.nextId++, s: s0, lat: R.range(4.6, 7.2) * (R.chance(0.5) ? 1 : -1), st: 0, bike: R.chance(0.2) ? 1 : 0, ph: R.next() * 6.28 });
    }
    const walk = 70 * dt / 60; // ~4,2 км/ч
    let waiting = 0;
    for (const q of p) {
      if (q.st === 0) { q.s -= walk * (q.bike ? 2.5 : 1); const stop = this.barrierS + waiting * 0.7; if (q.s <= stop) { q.st = 1; q.s = stop; } }
      if (q.st === 1) waiting++;
    }
    const wheels = env.wheelsOnly(), ban = env.rule('pedBan');
    this.accPed += env.through('ped') * dt / 3600;
    for (let i = 0; i < p.length && this.accPed >= 1; i++) {
      const q = p[i]; if (q.st !== 1) continue;
      if (ban || (wheels && !q.bike)) continue;
      p.splice(i, 1); i--; this.accPed -= 1; this.passed.peds++; this.passed.people++;
    }
    this.accPed = Math.min(this.accPed, 3);
    if (ban && waiting > 0 && R.chance(dt / 400)) { const i = p.findIndex(q => q.st === 1); if (i >= 0) p.splice(i, 1); }
    if (wheels && waiting && R.chance(dt / 900)) { const q = p.find(q => q.st === 1 && !q.bike); if (q) q.bike = 1; }
  }
  // переставить машину на n мест (+ вперёд, − назад) — обменом местами с соседом по очереди
  shift(car, n) {
    const a = this.cars, i = a.indexOf(car), j = clamp(i - n, 0, a.length - 1); if (i < 0 || j === i) return 0;
    const o = a[j];
    [car.s, o.s] = [o.s, car.s]; [car.lane, o.lane] = [o.lane, car.lane]; [car.l2, o.l2] = [o.l2, car.l2];
    car.mv = o.mv = 0;
    this.resort();
    return Math.abs(i - j);
  }
  // объезд: машина переносится на km вперёд (встаёт в очередь там)
  jump(car, km) { car.s = Math.max(this.gateS, car.s - km * 1000) - 0.5; car.mv = 0; this.resort(); }
}
return { Queue };
});
