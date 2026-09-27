// Мир вечера: часы, люди, игрок, места, группы, события, счёт. Собирает части sim/* и отдаёт наружу
// API из docs/plan.md: new World(CONTENT, { seed, profile }), step(dt), act(a), bus, view().
// DOM и THREE не трогает — работает и в Node (tests/sim.js).
'use strict';
L.def('sim/world', () => {
const { RNG, Bus, clamp } = L.use('core');
const { Nav, buildSpots } = L.use('sim/nav');
const { makeCrowd } = L.use('sim/crowd');
const { Brain } = L.use('sim/brain');
const { Talk } = L.use('sim/talk');
const { Director } = L.use('sim/director');
const { Score } = L.use('sim/score');

// числа по умолчанию; CONTENT.TUNING перекрывает любые из них (глубокое слияние)
const DEFAULTS = {
  seed: 1,
  time: { realSecPerHour: 180, start: 19, end: 25 },
  // кривая вечера: early — сколько сидят к 19:00; peak — коридор числа людей в часы пика; after — потолок
  // после караоке; last — досидят до закрытия; walkOut — ч на дорогу к выходу (уходящий ещё «в зале»)
  crowd: { total: 34, early: [2, 3], late: [3, 5], lateFrom: 21.6, oddballs: [1, 2], peak: { at: [21, 22], n: [20, 25] },
    after: { at: 23.5, max: 17 }, last: [3, 6], walkOut: 0.12, male: 0.6, smokers: 0.2, age: [22, 44], topics: [3, 5] },
  nav: { radius: 0.2, budget: 1, cache: 200 },
  walk: { speed: 1.05, player: 1.7 },
  group: { max: 6, reach: 1.9, joinChance: 0.8, speakSec: [2, 6], topicSec: [40, 100], mergeChance: 0.04 },
  needs: { barSec: [140, 320], barStay: [15, 35], smokeSec: [180, 420], smokeStay: [35, 70], lonelySec: [20, 50], holdSec: 150, wander: 0.015 },
  // силы игрока 0..1: разговор тратит, еда/пиво и улица восстанавливают
  energy: { start: 0.8, max: 1, say: 0.03, bad: 0.02, outside: 0.004, food: 0.004, low: 0.12 },
  // разговор; симпатия (rapport) −0.3..1
  talk: {
    near: 1.6, seatNear: 2.4, replySec: [0.6, 1.2], hand: [3, 4],
    good: 1.2, bad: -0.8, warmGood: 0.13, warmMeh: 0.03, warmBad: -0.12, startWarm: 0.06, gate: 0.3,
    reveal: { name: 0.04, job: 0.2, topics: 0.34, mind: 0.48, need: 0.6 },
    talked: 0.28, contact: 0.5, deal: 0.7, meetBonus: 0.34, selfie: 0.05,   // пороги ступеней; бонус встречи у входа
    pairMax: 2,                // скольких знакомых можно «свести» с одним человеком
    patience: [7, 15], failStreak: 3, failWarm: -0.12, coldSec: 90, guess: 0.3, airTopic: 0.8,
    cost: { listen: 0.5, wait: 0.3, argue: 1.5, joke: 1.2 },
    w: { mindLike: 2, mindHate: -2.5, moodLike: 1, moodHate: -1.5, topic: 1.4, offTopic: -0.3, likeTopic: 1, hateTopic: -2,
      repeat: -1, reuse: -1.5, oddLike: 2.5, oddTopic: 1, event: 0.8, pace: -0.7, group: 0.6, tired: -1, noise: 0.5, notIt: -0.6 },
  },
  events: { gatherShare: 0.25, minDur: 0.02, arriveMax: 0.4 },
  menu: [
    { id: 'beer',  title: 'Пиво',  icon: 'beer',  energy: 0.15, wait: 5,  prop: 'beer' },
    { id: 'rolls', title: 'Роллы', icon: 'sushi', energy: 0.28, wait: 25, prop: null },
    { id: 'tea',   title: 'Чай',   icon: 'tea',   energy: 0.1,  wait: 10, prop: 'cup' },
  ],
  chat: { doorRadius: 3, meetWait: 0.35, before: [2, 3], where: [2, 4], late: [1, 3], after: 6, afterFeed: 5 },
  photo: { radius: 4, from: 23.8 },
  score: { met: 1, contact: 3, deal: 5, pair: 4, photo: 3, oddball: 2 },
  titles: [],
  text: {
    noEnergy: 'Нет сил', busy: 'Не до тебя', contact: 'Контакт!', deal: 'Договорились!', pair: 'Познакомил!',
    pairFail: 'Не зашло', pairFar: 'Оба рядом?', pairKnown: 'Уже знакомы', pairNone: 'Не с кем', order: 'Заказ', served: 'Принесли',
    atDoor: 'Встретил у входа', photo: 'На фото!', seatBusy: 'Занято', far: 'Далеко', selfie: 'Селфи!',
  },
};
// TUNING из содержания — в той же шкале, что и движок (силы, симпатия, пороги — 0..1); здесь только
// синоним ключа: talk.cards (так в content/tuning) = talk.hand. Шкалу проверяет tests/content.js.
function normalize(T0) {
  const T = JSON.parse(JSON.stringify(T0 || {}));
  const t = T.talk;
  if (t && t.cards && !t.hand) t.hand = t.cards;
  return T;
}
function merge(a, b) {
  if (b === undefined) return a;
  if (Array.isArray(a) || Array.isArray(b) || typeof a !== 'object' || typeof b !== 'object' || !a || !b) return b;
  const o = { ...a }; for (const k of Object.keys(b)) o[k] = merge(a[k], b[k]); return o;
}

class World {
  constructor(C, opt = {}) {
    this.C = C;
    this.T = merge(DEFAULTS, normalize(C.TUNING));
    this.LAY = C.LAYOUT;
    this.seed = opt.seed ?? this.T.seed;
    this.rng = new RNG(this.seed);
    this.bus = new Bus();
    this.hour = this.T.time.start; this.t = 0; this.over = false; this.stepN = 0;
    this.idx = {};
    for (const k of ['ROLES', 'MINDS', 'MOODS', 'ARCHETYPES', 'ODDBALLS', 'NEEDS', 'TOPICS', 'CARDS', 'EVENTS'])
      this.idx[k] = Object.fromEntries((C[k] || []).map(x => [x.id, x]));
    this.nav = new Nav(this.LAY, { radius: this.T.nav.radius, budget: this.T.nav.budget, cacheMax: this.T.nav.cache });
    const sp = buildSpots(this.LAY, this.nav);
    this.spots = sp.spots; this.spotById = sp.byId;
    this.closed = new Set();          // зоны, закрытые событием (дождь → веранда)
    this.events = [];                 // активные события [{ id, title, icon, scene, until, effect }]
    this.groups = [];
    this.people = new Map();
    for (const p of makeCrowd(C, this.T, this.rng)) this.people.set(p.id, p);
    this.list = [...this.people.values()];
    this.player = this.makePlayer(opt.profile || {});
    this.brain = new Brain(this);
    this.talk = new Talk(this);
    this.dir = new Director(this, opt);
    this.score = new Score(this);
    this.brain.init();
    this.viewBuf = [];
    this.perf = { ms: 0, max: 0 };
  }

  makePlayer(pr) {
    const C = this.C, T = this.T;
    const role = this.idx.ROLES[pr.role] || (C.ROLES || [])[0] || { id: 'guest', title: '' };
    const topics = (pr.topics && pr.topics.length ? pr.topics : (role.topics || []).slice(0, 3)).slice(0, 3);
    return {
      id: 'me', me: true, name: pr.name || 'Я', look: pr.look || null, role: role.id, job: role.title || '',
      topics, need: pr.need ?? (role.needs || [])[0] ?? null, offer: pr.offer ?? (role.offers || [])[0] ?? null,
      x: this.LAY.door.x, z: this.LAY.door.z + 1.0, rot: 0, pose: 'stand', prop: null, speaking: false,
      energy: T.energy.start, state: 'stand', nav: null, goal: null, seat: null, orders: [], lastEnergy: T.energy.start,
    };
  }

  // ─────────── шаг ───────────
  step(dt) {
    if (this.over) return;
    const a = performance.now();
    this.t += dt; this.stepN++;
    this.hour += dt / this.T.time.realSecPerHour;
    this.nav.resetBudget();
    this.dir.update(dt);
    this.brain.update(dt);
    this.updatePlayer(dt);
    this.talk.update(dt);
    this.score.update(dt);
    if (this.hour >= this.T.time.end) this.finish();
    const ms = performance.now() - a;
    this.perf.ms = this.perf.ms * 0.98 + ms * 0.02; if (ms > this.perf.max) this.perf.max = ms;
  }

  finish() {
    if (this.over) return;
    if (this.talk.cur) this.talk.end('closing');
    this.over = true;
    const summary = this.score.summary();
    this.bus.emit('end', { summary });
  }

  // ─────────── ходьба (общая для людей и игрока) ───────────
  // цель: клетка сетки goal + точная конечная точка (fx,fz) — например, само сиденье
  go(ent, goal, fx = null, fz = null) {
    ent.nav = { goal, fx, fz, pts: null, i: 0, stuck: 0 };
  }
  // 'done' — пришёл, 'walk' — идёт, 'wait' — ждёт путь, 'fail' — недостижимо
  move(ent, dt, speed) {
    const n = ent.nav;
    if (!n) return 'done';
    if (!n.pts) {
      const p = this.nav.path(ent.x, ent.z, n.goal);
      if (p === null) { ent.pose = 'stand'; return 'wait'; }
      if (p === false) { ent.nav = null; return 'fail'; }
      n.pts = p;
      if (n.fx != null) { n.pts.push({ x: n.fx, z: n.fz, last: true }); }
      n.i = 0;
    }
    let left = speed * dt;
    while (left > 0 && n.i < n.pts.length) {
      const q = n.pts[n.i], dx = q.x - ent.x, dz = q.z - ent.z, d = Math.hypot(dx, dz);
      if (d > 1e-4) ent.rot = Math.atan2(dx, dz);
      ent.finalLeg = !!q.last;
      if (d <= left) { ent.x = q.x; ent.z = q.z; left -= d; n.i++; }
      else { ent.x += dx / d * left; ent.z += dz / d * left; left = 0; }
    }
    if (n.i >= n.pts.length) { ent.nav = null; ent.finalLeg = false; return 'done'; }
    return 'walk';
  }
  goSpot(ent, spot) { this.go(ent, spot.approach, spot.x, spot.z); }
  goPoint(ent, x, z) {
    const c = this.nav.walkable(x, z) ? this.nav.cell(x, z) : this.nav.nearestFree(x, z, 10);
    if (c < 0) return false;
    this.go(ent, c, null, null); return true;
  }

  zoneOf(x, z) {
    const zn = this.LAY.zoneAt(x, z);
    if (zn) return zn;
    let best = null, bd = 1e9;
    for (const Z of this.LAY.zones) {
      const r = Z.rect, dx = Math.max(r[0] - x, 0, x - r[2]), dz = Math.max(r[1] - z, 0, z - r[3]), d = dx + dz;
      if (d < bd) { bd = d; best = Z.id; }
    }
    return best;
  }

  // ─────────── игрок ───────────
  updatePlayer(dt) {
    const P = this.player, T = this.T;
    if (P.nav) {
      const r = this.move(P, dt, T.walk.speed * 0 + T.walk.player);
      if (r === 'walk') P.pose = 'walk';
      if (r === 'done' || r === 'fail') {
        P.pose = 'stand'; P.state = 'stand';
        if (P.goal?.kind === 'sit') {
          const s = this.spotById[P.goal.seat];
          if (s && s.occ === 'me') { P.x = s.x; P.z = s.z; P.rot = s.face; P.seat = s.id; P.state = 'sit'; P.pose = s.sofa ? 'sitSofa' : 'sit'; }
          P.goal = null;
        } else if (P.goal?.kind === 'walk' || P.goal?.kind === 'photo') P.goal = null;
      }
    }
    if (P.goal?.kind === 'approach') this.approachTick();
    // заказы
    for (let i = P.orders.length - 1; i >= 0; i--) {
      const o = P.orders[i];
      if (this.t >= o.at) {
        P.orders.splice(i, 1);
        this.addEnergy(o.item.energy || 0);
        if (o.item.prop) { P.prop = o.item.prop; P.propUntil = this.t + 60; }
        this.bus.emit('toast', { icon: o.item.icon, text: `${T.text.served}: ${o.item.title}` });
      }
    }
    if (P.prop && P.propUntil && this.t > P.propUntil) P.prop = null;
    // улица/веранда восстанавливают силы
    const zn = this.zoneOf(P.x, P.z);
    if ((zn === 'street' || zn === 'veranda') && !this.talk.cur) this.addEnergy(T.energy.outside * dt);
    const food = this.dir.food();                       // угощение за общим столом
    if (food && (!food.zone || zn === food.zone)) this.addEnergy(T.energy.food * dt);
    if (Math.abs(P.energy - P.lastEnergy) >= 0.01) { P.lastEnergy = P.energy; this.bus.emit('energy', { v: +P.energy.toFixed(2) }); }
    if (P.state === 'talk' && this.talk.cur) {
      const n = this.people.get(this.talk.cur.id);
      if (n) P.rot = Math.atan2(n.x - P.x, n.z - P.z);
      P.pose = P.seat ? (this.spotById[P.seat].sofa ? 'sitSofa' : 'sit') : (P.speaking ? 'talk' : 'stand');
    }
  }
  addEnergy(v) { const P = this.player; P.energy = clamp(P.energy + v, 0, this.T.energy.max); }
  leaveSeat() {
    const P = this.player;
    if (P.seat) { const s = this.spotById[P.seat]; if (s && s.occ === 'me') s.occ = null; P.seat = null; }
    if (P.goal?.kind === 'sit') { const s = this.spotById[P.goal.seat]; if (s && s.occ === 'me' && P.seat !== s.id) s.occ = null; }
  }
  approachTick() {
    const P = this.player, g = P.goal, n = this.people.get(g.id), T = this.T;
    if (!n || !n.present || n.state === 'gone') { P.goal = null; P.nav = null; return; }
    const d = Math.hypot(n.x - P.x, n.z - P.z);
    const near = P.seat ? T.talk.seatNear : T.talk.near;
    // дошёл до клетки подхода, а человек в глубине дивана/у стены — разговор всё равно начинается
    const reached = !P.nav && g.tx !== 1e9 && d <= T.talk.seatNear + 0.4;
    if (d <= near || reached) { P.nav = null; P.goal = null; if (!P.seat) P.pose = 'stand'; this.talk.start(n); return; }
    if (P.seat) { this.leaveSeat(); P.state = 'stand'; }
    if (!P.nav || Math.hypot(n.x - g.tx, n.z - g.tz) > 0.8) {
      g.tx = n.x; g.tz = n.z;
      const s = n.seat && this.spotById[n.seat];
      const c = s && n.state !== 'walk' && s.kind === 'seat' ? s.approach : this.nav.nearestFree(n.x, n.z, 8);
      if (c >= 0) this.go(P, c, null, null);
    }
  }

  // ─────────── действия игрока ───────────
  act(a) {
    if (this.over || !a) return false;
    const P = this.player, T = this.T;
    switch (a.type) {
      case 'walk': {
        if (this.talk.cur) this.talk.end('walk');
        this.leaveSeat(); P.state = 'walk'; P.goal = { kind: 'walk' };
        return this.goPoint(P, a.x, a.z);
      }
      case 'approach': {
        const n = this.people.get(a.id);
        if (!n || !n.present) return false;
        if (this.talk.cur?.id === a.id) return true;
        // обиделся недавно — сразу сказать, а не вести через весь зал
        if (n.cold > this.t) { this.bus.emit('toast', { icon: 'clock', text: T.text.busy }); return false; }
        if (this.talk.cur) this.talk.end('switch');
        P.goal = { kind: 'approach', id: a.id, tx: 1e9, tz: 1e9 };
        this.approachTick();
        return true;
      }
      case 'say': return this.talk.say(a.card);
      case 'introduce': return this.talk.introduce(a.a, a.b);
      case 'endTalk': if (this.talk.cur) this.talk.end('bye'); return true;
      case 'order': {
        const item = (T.menu || []).find(m => m.id === a.item) || (T.menu || [])[0];
        if (!item) return false;
        const atBar = this.zoneOf(P.x, P.z) === 'bar';
        P.orders.push({ item, at: this.t + (item.wait || 5) * (atBar ? 0.4 : 1) });
        this.bus.emit('toast', { icon: item.icon, text: `${T.text.order}: ${item.title}` });
        return true;
      }
      case 'sit': {
        const s = this.spotById[a.seat];
        if (!s || s.kind !== 'seat') return false;
        if (s.occ && s.occ !== 'me') { this.bus.emit('toast', { icon: 'chair', text: T.text.seatBusy }); return false; }
        if (this.talk.cur) this.talk.end('walk');
        this.leaveSeat();
        s.occ = 'me'; P.goal = { kind: 'sit', seat: s.id }; P.state = 'walk';
        this.goSpot(P, s);
        return true;
      }
      case 'photo': return this.dir.playerPhoto();
      case 'reply': return this.dir.reply(a.msg, a.option);
    }
    return false;
  }

  // ─────────── снимок для отрисовки ───────────
  view() {
    const out = this.viewBuf; let k = 0;
    const put = (e, extra) => {
      let o = out[k]; if (!o) o = out[k] = {};
      o.id = e.id; o.x = e.x; o.z = e.z; o.rot = e.rot; o.pose = e.pose; o.mood = e.feel ?? 0.3;
      o.speaking = !!e.speaking; o.look = e.look; o.prop = e.prop; o.known = e.step ?? 0;
      o.lookHints = e.lookHints || null; o.seed = e.seed ?? 0; o.me = !!e.me; o.oddball = e.oddball || null; o.group = e.group ?? null;
      k++;
    };
    for (const n of this.list) if (n.present) put(n);
    put(this.player);
    out.length = k;
    return out;
  }
  present() { let n = 0; for (const p of this.list) if (p.present) n++; return n; }
}

return { World, DEFAULTS };
});
