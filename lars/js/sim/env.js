// Среда: температура, свет, погода, действующие правила календаря, курсы, дневные множители цен.
'use strict';
L.def('sim/env', () => {
const { clamp, lerp, smooth, DAY, HOUR } = L.use('core');

class Env {
  constructor(C, clock) {
    this.C = C; this.clock = clock; this.cal = C.CALENDAR;
    this.rules = this.cal.rules.map(r => ({ ...r, t0: clock.parse(r.from), t1: r.to ? clock.parse(r.to) : Infinity }));
    this.active = new Set(); this._ruleT = -1;
  }
  day(t = this.clock.t) { return this.clock.dayAt(t); }
  dayIdx(t = this.clock.t) { return clamp(Math.floor(t / DAY), 0, this.cal.days.length - 1); }
  // температура: минимум в 5:00, максимум в 15:00 (косинус), между днями — плавно
  temp(t = this.clock.t) {
    const h = (t % DAY) / HOUR, d = this.day(t), dn = this.day(t + DAY), dp = this.day(t - DAY);
    if (h < 5) { const k = (h + 9) / 14; return lerp(dp.temp[1], d.temp[0], (1 - Math.cos(Math.PI * k)) / 2); }
    if (h < 15) { const k = (h - 5) / 10; return lerp(d.temp[0], d.temp[1], (1 - Math.cos(Math.PI * k)) / 2); }
    const k = (h - 15) / 14; return lerp(d.temp[1], dn.temp[0], (1 - Math.cos(Math.PI * k)) / 2);
  }
  // 0 — ночь, 1 — день: небо светлеет у восхода, прямое солнце в ущелье — позже/раньше (CALENDAR.gorge)
  light(t = this.clock.t) {
    const h = (t % DAY) / HOUR, d = this.day(t), [sr, ss] = d.sun, g = this.cal.gorge || { morning: 0, evening: 0 };
    const sky = smooth(sr - 0.6, sr + 0.4, h) * (1 - smooth(ss - 0.3, ss + 0.6, h));
    const sun = smooth(sr + g.morning - 0.4, sr + g.morning + 0.4, h) * (1 - smooth(ss - g.evening - 0.4, ss - g.evening + 0.4, h));
    let l = 0.55 * sky + 0.45 * sun;
    const w = d.weather;
    if (w === 'rain' || w === 'storm') l *= 0.75; else if (w === 'cloud' || w === 'drizzle') l *= 0.88;
    return Math.max(l, (d.moon || 0) * 0.12);
  }
  night(t) { return this.light(t) < 0.3; }
  weather(t) { return this.day(t).weather; }
  // правила: пересчёт раз в игровую минуту; события 'rule' на шине при входе
  updateRules(bus) {
    const t = this.clock.t;
    if (Math.abs(t - this._ruleT) < 60) return;
    this._ruleT = t;
    for (const r of this.rules) {
      const on = t >= r.t0 && t < r.t1;
      if (on && !this.active.has(r.id)) { this.active.add(r.id); bus && bus.emit('rule', r); }
      else if (!on && this.active.has(r.id)) this.active.delete(r.id);
    }
  }
  rule(id) { return this.active.has(id); }
  // произведение множителей правил для ключа (through.car, arrive.ped …)
  ruleMul(group, key) {
    let m = 1;
    for (const r of this.rules) if (this.active.has(r.id) && r.fx[group] && r.fx[group][key] != null) m *= r.fx[group][key];
    return m;
  }
  ruleMood() { let m = 0; for (const r of this.rules) if (this.active.has(r.id) && r.fx.mood) m += r.fx.mood; return m; }
  ruleDemand(good) {
    let m = 1;
    for (const r of this.rules) if (this.active.has(r.id) && r.fx.demand) {
      const d = r.fx.demand; if (d[good.id] != null) m *= d[good.id]; else if (d[good.cat] != null) m *= d[good.cat];
    }
    return m;
  }
  wheelsOnly() { for (const r of this.rules) if (this.active.has(r.id) && r.fx.wheels) return true; return false; }
  // КПП: машин / пешеходов в час сейчас
  through(kind, t = this.clock.t) {
    const h = Math.floor((t % DAY) / HOUR);
    return this.day(t).through[kind] * this.cal.hourlyThrough[h] * this.ruleMul('through', kind);
  }
  arrive(kind, t = this.clock.t) {
    const h = Math.floor((t % DAY) / HOUR);
    return this.day(t).arrive[kind] * this.cal.hourly[h] * this.ruleMul('arrive', kind);
  }
  rates(t) { return this.day(t).rates; }
  // дневной множитель товара: своя кривая m[] (плавно между днями) или prices дня
  dayMul(good, t = this.clock.t) {
    if (good.m) {
      const f = clamp(t / DAY - 0.5, 0, good.m.length - 1), i = Math.floor(f), k = f - i;
      return lerp(good.m[i], good.m[Math.min(good.m.length - 1, i + 1)], k);
    }
    const p = this.day(t).prices;
    if (typeof p === 'number') return p;
    return p[good.id] ?? p[good.cat] ?? p['*'] ?? 1;
  }
}
return { Env };
});
