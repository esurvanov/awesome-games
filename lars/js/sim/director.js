// Режиссёр ритма: выбирает события из данных, чередуя тяжёлые и лёгкие сцены.
// forced-события (объявления правил, КПП) идут сразу; остальные — по таймеру gap с учётом «напряжения».
'use strict';
L.def('sim/director', () => {
const { check } = L.use('sim/rules');

class Director {
  constructor(C, w) {
    this.C = C; this.w = w; this.T = C.TUNING.director;
    this.fired = {};        // id → игровое время последнего срабатывания
    this.next = 0; this.lightStreak = 99; this.tension = 0; this.log = [];
    this.pending = null;     // карточка, ждущая, пока закроется предыдущая
  }
  start(t) { this.next = t + this.T.firstDelay * 60; }
  eligible(e, t) {
    const last = this.fired[e.id];
    if (last != null) { if (e.once !== false) return false; if (t - last < (e.cooldown || 12) * 3600) return false; }
    if (e.npc && e.npc !== 'near' && !this.w.npcPresent(e.npc)) return false;
    return !check(e.when, this.w, { roll: false });
  }
  // вызывается раз в игровую минуту; вернёт событие, которое надо показать
  tick(t, busy) {
    const w = this.w;
    this.tension = Math.max(0, this.tension - this.T.tensionDecay / 60);
    if (busy) return null;
    for (const e of this.C.EVENTS) if (e.forced && this.eligible(e, t)) return this.fire(e, t);
    if (t < this.next) return null;
    const needLight = this.lightStreak < this.T.heavyRest;
    const cands = this.C.EVENTS.filter(e => !e.forced && this.eligible(e, t) && (!needLight || e.weight !== 'heavy'));
    // chance проверяется здесь, один раз на выбор
    const pool = cands.filter(e => e.when?.chance == null || w.rng.chance(e.when.chance));
    const [g0, g1] = this.T.gap;
    this.next = t + w.rng.range(g0, g1) * 60;
    if (!pool.length) return null;
    const e = w.rng.weighted(pool, e => (e.weight === 'heavy' ? 1.2 + this.lightStreak * 0.3 : 1) * (e.npc && e.npc !== 'near' ? 1.4 : 1));
    return e ? this.fire(e, t) : null;
  }
  fire(e, t) {
    this.fired[e.id] = t;
    if (e.weight === 'heavy') { this.lightStreak = 0; this.tension += 1; } else this.lightStreak++;
    this.log.push([Math.round(t), e.id]);
    return e;
  }
  save() { return { fired: this.fired, next: this.next, ls: this.lightStreak, tn: this.tension, log: this.log.slice(-60) }; }
  load(o) { Object.assign(this, { fired: o.fired, next: o.next, lightStreak: o.ls, tension: o.tn, log: o.log || [] }); }
}
return { Director };
});
