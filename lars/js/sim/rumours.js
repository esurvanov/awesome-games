// Слухи: доля знающих по участкам очереди (TUNING.rumours.bucket м). Логистический рост внутри участка,
// утечка в соседние, забывание. Подробности об отдельном человеке не храним: при разговоре слух «выпадает»
// с вероятностью, равной доле знающих в его участке (LOD).
'use strict';
L.def('sim/rumours', () => {
const { clamp } = L.use('core');

class Rumours {
  constructor(C, env, road) {
    this.C = C; this.env = env; this.T = C.TUNING.rumours;
    this.list = C.RUMOURS.map(r => ({ ...r, t0: env.clock.parse(r.from), tR: r.revealAt ? env.clock.parse(r.revealAt) : Infinity, on: false, revealed: false }));
    this.byId = new Map(this.list.map(r => [r.id, r]));
    this.B = Math.ceil((road.len + 12000) / this.T.bucket); // с запасом: хвост может уйти за край карты
    this.share = this.list.map(() => new Float32Array(this.B));
  }
  bucket(s) { return clamp(Math.floor(s / this.T.bucket), 0, this.B - 1); }
  // шаг раз в «пачку»: dtH часов; tailS — где хвост; bus — для объявлений
  step(dtH, tailS, bus) {
    const T = this.T, t = this.env.clock.t, B = this.B;
    const tailB = this.bucket(tailS);
    this.list.forEach((r, k) => {
      const a = this.share[k];
      if (!r.on && t >= r.t0) {
        r.on = true;
        const b = r.at === 'kpp' ? 0 : r.at === 'tail' ? tailB : this.bucket(r.at * 1000);
        for (let d = -1; d <= 1; d++) { const j = clamp(b + d, 0, B - 1); a[j] = Math.max(a[j], r.share * (d ? 0.5 : 1)); }
        bus && bus.emit('rumour:start', r);
      }
      if (!r.on) return;
      if (!r.revealed && (t >= r.tR || (r.confirm && this.env.rule(r.confirm)))) { r.revealed = true; bus && bus.emit('rumour:reveal', r); }
      const c = T.contact * r.spread * (r.revealed ? 0.5 : 1);
      const prev = a.slice();
      for (let b = 0; b <= Math.min(B - 1, tailB + 1); b++) {
        let v = prev[b];
        v += c * v * (1 - v) * dtH - T.decay * v * dtH;
        const nb = ((b > 0 ? prev[b - 1] : prev[b]) + (b < B - 1 ? prev[b + 1] : prev[b])) / 2;
        v += T.neighbour * (nb - prev[b]) * dtH * 4;
        a[b] = clamp(v, 0, 0.98);
      }
    });
  }
  at(s) { const b = this.bucket(s); return this.list.map((r, k) => ({ r, v: this.share[k][b] })).filter(x => x.r.on); }
  // суммарное влияние слухов на спокойствие в участке (в час)
  mood(s) { let m = 0; const b = this.bucket(s); this.list.forEach((r, k) => { if (r.on && !r.revealed) m += r.mood * this.share[k][b]; }); return m; }
  // спрос: среднее по очереди × demand слуха
  demand(maxB) {
    const d = {};
    this.list.forEach((r, k) => {
      if (!r.on || !r.demand) return;
      let s = 0; const n = Math.max(1, maxB); for (let b = 0; b < n; b++) s += this.share[k][b]; const avg = s / n;
      for (const key in r.demand) d[key] = (d[key] ?? 1) * (1 + (r.demand[key] - 1) * clamp(avg * 1.5, 0, 1));
    });
    return d;
  }
  // что «слышно» в участке: самый распространённый слух, который игрок ещё не знает (с вероятностью доли)
  hear(s, known, rng) {
    const opts = this.at(s).filter(x => !known.has(x.r.id) && x.v > 0.02).sort((a, b) => b.v - a.v);
    for (const o of opts) if (rng.chance(clamp(o.v * 2.2, 0.15, 0.95))) return o.r;
    return null;
  }
  save() { return { f: this.list.map(r => [r.on ? 1 : 0, r.revealed ? 1 : 0]), s: this.share.map(a => Array.from(a, v => Math.round(v * 1000))) }; }
  load(o) {
    o.f.forEach((f, k) => { if (this.list[k]) { this.list[k].on = !!f[0]; this.list[k].revealed = !!f[1]; } });
    o.s.forEach((arr, k) => { if (this.share[k]) arr.forEach((v, b) => { if (b < this.B) this.share[k][b] = v / 1000; }); });
  }
}
return { Rumours };
});
