// Решения людей в зале: приход, выбор места (зона архетипа, соседи, общие темы), бар, курилка,
// переезд к компании, отлучка в туалет (редко: короткий поход к двери WC и назад), уход; группы разговора: объединение соседей, потолок размера (большой стол →
// параллельные разговоры), слияние, распад, очередь говорящего, тема группы. Позы и повороты.
'use strict';
L.def('sim/brain', () => {
const { clamp, RNG } = L.use('core');

const TEMP = { bar: 1, smoke: 1, gather: 1, photo: 1, meet: 1, wc: 1 };
// туалет: первая мысль «сходить» через WC_SEC реальных секунд, идут не все (WC_P), у двери — WC_STAY с
const WC_SEC = [150, 700], WC_P = 0.3, WC_STAY = [4, 9];

class Brain {
  constructor(w) {
    this.w = w; this.T = w.T; this.rng = w.rng;
    this.wcRng = new RNG(((w.seed ?? 1) ^ 0x5c7a11) >>> 0 || 1);   // свой ГСЧ: отлучки в туалет не сдвигают остальной вечер
    this.gid = 1; this.gTick = 0;
  }
  init() {
    const w = this.w;
    // пришедшие до начала — уже сидят на местах
    for (const n of w.list) if (n.arrive <= w.hour) {
      this.spawn(n);
      const s = this.chooseSpot(n);
      if (s) { this.reserve(n, s); n.home = s.id; n.x = s.x; n.z = s.z; this.settle(n, s); }
    }
    for (const n of w.list) {
      n.drink = w.idx.MOODS[n.mood]?.drink ?? 1;
      n.barAt = w.t + this.rng.range(...this.T.needs.barSec) * 0.6 / n.drink;
      n.smokeAt = w.t + this.rng.range(...this.T.needs.smokeSec) * 0.5;
      n.wcAt = w.t + this.wcRng.range(...WC_SEC);
    }
  }

  // ─────────── приход / уход ───────────
  spawn(n) {
    const S = this.w.LAY.spawn;
    n.present = true; n.state = 'walk'; n.x = S.x + this.rng.range(-0.8, 0.8); n.z = S.z + this.rng.range(-0.3, 0.3);
    n.aloneSince = this.w.t; n.think = this.rng.range(1, 4);
    this.w.bus.emit('arrive', { id: n.id });
    this.w.dir.onArrive(n);
  }
  arrive(n) {
    this.spawn(n);
    n.plan = { kind: 'home' };
    if (this.w.dir.wantsMeet(n) && this.w.dir.goMeet(n)) return;
    const s = this.partnerSpot(n) || this.chooseSpot(n);
    if (s) { this.reserve(n, s); n.home = s.id; n.plan = { kind: 'home' }; this.w.goSpot(n, s); }
    else { n.plan = { kind: 'home' }; this.wanderStand(n); }
  }
  leave(n) {
    this.unsettle(n); this.releaseAll(n);
    n.plan = { kind: 'leave' }; n.state = 'walk';
    const S = this.w.LAY.spawn;
    this.w.goPoint(n, S.x + this.rng.range(-0.6, 0.6), S.z);
  }
  gone(n) {
    n.present = false; n.state = 'gone'; n.nav = null; n.speaking = false;
    this.w.bus.emit('leave', { id: n.id });
  }

  // ─────────── места ───────────
  reserve(n, s) { s.occ = n.id; }
  release(s, n) { if (s && s.occ === n.id) s.occ = null; }
  releaseAll(n) {
    const B = this.w.spotById;
    if (n.seat) this.release(B[n.seat], n);
    if (n.home) this.release(B[n.home], n);
    if (n.plan?.spot) this.release(B[n.plan.spot], n);
    n.seat = null; n.home = null;
  }
  allowed(n, zone) {
    const a = this.w.idx.ARCHETYPES[n.archetype];
    return !this.w.closed.has(zone) && (!a?.zones?.length || a.zones.includes(zone));
  }
  // лучшее свободное место: зона архетипа, соседи (общительность), общие темы, «иди ко мне» из чата
  chooseSpot(n, opt = {}) {
    const w = this.w, a = w.idx.ARCHETYPES[n.archetype] || {}, zones = a.zones || [];
    const soc = n.traits.social, P = w.player;
    let best = null, bs = -1e9;
    for (const s of w.spots) {
      if (s.occ || w.closed.has(s.zone)) continue;
      if (s.standKind === 'smoke' || s.standKind === 'door' || s.standKind === 'wc') continue;
      if (opt.zone && s.zone !== opt.zone) continue;
      const zi = zones.indexOf(s.zone);
      let sc = zi >= 0 ? 2 + 0.4 * (zones.length - zi) : (opt.anyZone ? 0 : -3);
      if (s.kind === 'seat') sc += 0.4; else if (s.zone !== 'bar' && s.zone !== 'street') sc -= 0.3;
      // веранда стартует пустой, и бонус «к людям» её никогда не выбирает: свежий воздух тянет своих (кто любит веранду, курящие), к ночи — меньше
      if (s.zone === 'veranda') sc += (zi >= 0 ? 1.4 : 0) + (n.smoker ? 0.9 : 0) - (w.hour > 23 ? 1.2 : 0);
      let near = 0, full = 0;
      for (const o of s.nb) {
        if (!o.occ || o.occ === 'me') continue;
        const m = w.people.get(o.occ); if (!m) continue;
        near++;
        for (const t of m.topics) if (n.topics.includes(t)) sc += 0.35;
        if (n.ties[m.id]) sc += 1.5;
        const g = m.group != null ? this.groupById(m.group) : null;
        if (g && g.members.length >= this.cap(g)) full++;
      }
      sc += near * (soc - 0.35) * 1.3 - full * 0.4;
      if (opt.near) sc -= Math.hypot(s.x - opt.near.x, s.z - opt.near.z) * 1.2;
      if (n.comeTo === 'me') sc -= Math.hypot(s.x - P.x, s.z - P.z) * 1.5;
      sc += this.rng.next() * 0.9;
      if (sc > bs) { bs = sc; best = s; }
    }
    if (!best && !opt.anyZone) return this.chooseSpot(n, { ...opt, zone: null, anyZone: true });
    return best;
  }
  // пара приходит вместе: второй садится рядом с местом первого
  partnerSpot(n) {
    const w = this.w, q = n.partner && w.people.get(n.partner), hs = q && q.home && w.spotById[q.home];
    if (!hs) return null;
    for (const s of hs.nb) if (!s.occ && !w.closed.has(s.zone)) return s;
    return null;
  }
  // занять место/встать на точку
  settle(n, s) {
    n.seat = s.id; n.x = s.x; n.z = s.z; n.rot = s.face;
    n.state = s.kind === 'seat' ? 'sit' : 'stand';
    n.settledAt = this.w.t;
    if (n.plan.kind === 'home' || n.plan.kind === 'bar' || n.plan.kind === 'smoke') this.tryJoin(n);
  }
  unsettle(n) {
    if (n.group != null) this.leaveGroup(n);
    n.state = 'walk'; n.speaking = false;
  }
  wanderStand(n) {
    const s = this.chooseSpot(n, { anyZone: true });
    if (s) { this.reserve(n, s); n.home = s.id; this.w.goSpot(n, s); }
  }
  // временный выход (бар, курилка, событие): своё место держится
  goTemp(n, kind, filter, stay, near = null, rng = this.rng) {
    const w = this.w, c = near || n;
    let best = null, bd = 1e9;
    for (const s of w.spots) {
      if (s.occ || w.closed.has(s.zone) || !filter(s)) continue;
      const d = Math.hypot(s.x - c.x, s.z - c.z) + rng.next() * (near ? 0.3 : 2);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) return false;
    this.unsettle(n);
    if (n.seat && n.seat !== n.home) this.release(w.spotById[n.seat], n);
    n.seat = null;
    this.reserve(n, best);
    n.plan = { kind, spot: best.id, until: w.t + stay, left: w.t };
    w.goSpot(n, best);
    return true;
  }
  goHome(n) {
    const w = this.w, B = w.spotById;
    if (n.plan.spot) this.release(B[n.plan.spot], n);
    if (n.seat && n.seat !== n.home) this.release(B[n.seat], n);
    this.unsettle(n); n.seat = null;
    const h = n.home && B[n.home];
    n.plan = { kind: 'home' };
    if (h && h.occ === n.id && !w.closed.has(h.zone) && w.t - (n.leftHome ?? w.t) < this.T.needs.holdSec) { w.goSpot(n, h); return; }
    if (h) this.release(h, n);
    n.home = null;
    const s = this.chooseSpot(n);
    if (s) { this.reserve(n, s); n.home = s.id; w.goSpot(n, s); }
  }
  relocate(n, opt = {}) {
    const w = this.w, s = this.chooseSpot(n, opt);
    if (!s || s.id === n.seat) return false;
    this.unsettle(n); this.releaseAll(n);
    this.reserve(n, s); n.home = s.id; n.plan = { kind: 'home' };
    w.goSpot(n, s);
    return true;
  }
  // подсесть к конкретному человеку (после «познакомить» или по зову из чата)
  joinTo(n, m) {
    const w = this.w, ms = m.seat && w.spotById[m.seat];
    if (!ms || !n.present || n.state === 'talk') return false;
    let best = null, bd = 1e9;
    for (const s of ms.nb) if (!s.occ && !w.closed.has(s.zone)) { const d = Math.hypot(s.x - n.x, s.z - n.z); if (d < bd) { bd = d; best = s; } }
    if (!best) return false;
    this.unsettle(n); this.releaseAll(n);
    this.reserve(n, best); n.home = best.id; n.plan = { kind: 'home' };
    w.goSpot(n, best);
    return true;
  }

  // ─────────── каждый шаг ───────────
  update(dt) {
    const w = this.w, T = this.T;
    for (const n of w.list) {
      if (!n.present) { if (n.state === 'out' && n.arrive <= w.hour) this.arrive(n); continue; }
      if (n.state === 'talk') { this.poseTalk(n); continue; }
      if (n.nav) {
        const z0 = n.z;
        const r = w.move(n, dt, T.walk.speed * (0.85 + 0.3 * n.traits.pace));
        if (z0 < 0 && n.z >= 0 && n.plan.kind !== 'leave') w.dir.onEnter(n);
        n.pose = r === 'wait' ? 'stand' : 'walk'; n.speaking = false;
        if (r === 'done' || r === 'fail') this.arrived(n, r);
        continue;
      }
      n.think -= dt;
      if (n.think <= 0) { n.think = this.rng.range(2.5, 6); this.think(n); }
      this.pose(n);
    }
    this.gTick -= dt;
    if (this.gTick <= 0) { this.gTick = 0.5; this.groupTick(0.5); }
  }
  arrived(n, r) {
    const w = this.w, B = w.spotById;
    if (n.plan.kind === 'leave') { this.gone(n); return; }
    const sid = TEMP[n.plan.kind] ? n.plan.spot : n.home;
    const s = sid && B[sid];
    if (s && s.occ === n.id && r === 'done') {
      this.settle(n, s);
      if (n.plan.kind === 'bar') { n.prop = n.oddball ? n.prop : 'beer'; n.barAt = w.t + this.rng.range(...this.T.needs.barSec) / (n.drink || 1); }
      if (n.plan.kind === 'smoke') { n.prop = 'cigarette'; n.smokeAt = w.t + this.rng.range(...this.T.needs.smokeSec); }
      if (n.comeTo === 'me') n.comeTo = null;
    } else {
      // место заняли/недостижимо — выбрать другое
      n.state = 'stand';
      if (TEMP[n.plan.kind]) this.goHome(n); else this.relocate(n, { anyZone: true }) || (n.think = 1);
    }
  }
  think(n) {
    const w = this.w, T = this.T, N = T.needs, rng = this.rng, k = n.plan.kind;
    if (w.hour >= n.leave && k !== 'photo') { this.leave(n); return; }
    if (TEMP[k]) {
      if (w.t >= n.plan.until) { if (n.prop === 'cigarette') n.prop = null; if (k === 'meet') n.meet = false; this.goHome(n); }
      return;
    }
    if (!n.seat) { this.goHome(n); return; }
    if (n.prop === 'beer' && rng.chance(0.08)) n.prop = null;
    const s = w.spotById[n.seat];
    if (w.closed.has(s.zone)) { this.relocate(n); return; }
    if (w.t >= n.barAt && s.zone !== 'bar') {
      n.leftHome = w.t;
      if (this.goTemp(n, 'bar', x => x.standKind === 'bar' || x.zone === 'bar', rng.range(...N.barStay))) return;
      n.barAt = w.t + 30;
    }
    if (n.smoker && w.t >= n.smokeAt && s.zone !== 'street') {
      n.leftHome = w.t;
      if (this.goTemp(n, 'smoke', x => x.standKind === 'smoke' || (x.zone === 'street' && x.kind === 'stand'), rng.range(...N.smokeStay))) return;
      n.smokeAt = w.t + 40;
    }
    // в туалет: редко, не посреди своей реплики и не когда к нему идёт игрок; своё место держится
    if (w.t >= (n.wcAt ?? Infinity) && !n.speaking && w.player.goal?.id !== n.id) {
      const wr = this.wcRng;
      n.wcAt = w.t + wr.range(...WC_SEC) * 1.5;
      if (wr.chance(WC_P)) {
        n.leftHome = w.t;
        if (this.goTemp(n, 'wc', x => x.standKind === 'wc', wr.range(...WC_STAY), null, wr)) return;
      }
    }
    if (n.group == null) {
      this.tryJoin(n);
      if (n.group == null && w.t - n.aloneSince > rng.range(...N.lonelySec) && rng.chance(0.3 + 0.6 * n.traits.social)) {
        n.aloneSince = w.t; this.relocate(n); return;
      }
    } else if (rng.chance(N.wander * (0.5 + n.traits.pace))) { this.relocate(n, { anyZone: rng.chance(0.3) }); return; }
  }

  // ─────────── группы ───────────
  center(g) {
    let x = 0, z = 0; for (const id of g.members) { const n = this.w.people.get(id); x += n.x; z += n.z; }
    return { x: x / g.members.length, z: z / g.members.length };
  }
  groupById(id) { for (const g of this.w.groups) if (g.id === id) return g; return null; }
  cap(g) {
    let c = this.T.group.max;
    for (const id of g.members) { const a = this.w.idx.ARCHETYPES[this.w.people.get(id).archetype]; if (a?.group) c = Math.min(c, Math.max(2, a.group[1] + 1)); }
    return c;
  }
  wantsGroup(n) { const a = this.w.idx.ARCHETYPES[n.archetype]; return !a?.group || a.group[1] >= 2 || n.oddball; }
  settled(m) {
    return !!(m && m.present && !m.nav && m.seat && (m.state === 'sit' || m.state === 'stand' || m.state === 'talk')
      && (m.plan.kind === 'home' || m.plan.kind === 'bar' || m.plan.kind === 'smoke'));
  }
  tryJoin(n) {
    const w = this.w, s = n.seat && w.spotById[n.seat];
    if (!s || n.group != null || !this.wantsGroup(n)) return;
    let bestG = null, bs = -1e9, lone = null;
    for (const o of s.nb) {
      if (!o.occ || o.occ === 'me' || o.occ === n.id) continue;
      const m = w.people.get(o.occ);
      if (!this.settled(m) || m.seat !== o.id) continue;
      if (m.group != null) {
        const g = this.groupById(m.group);
        if (!g || g.members.length >= this.cap(g)) continue;
        // круг разговора — на расстоянии голоса: за длинным столом получаются параллельные разговоры
        const c = this.center(g);
        if (Math.hypot(c.x - s.x, c.z - s.z) > this.T.group.reach) continue;
        let sc = this.rng.next();
        for (const id of g.members) { const q = w.people.get(id); for (const t of q.topics) if (n.topics.includes(t)) sc += 0.5; if (n.ties[id]) sc += 1; }
        if (sc > bs) { bs = sc; bestG = g; }
      } else if (this.wantsGroup(m)) lone = lone || m;
    }
    const pj = this.T.group.joinChance * (0.5 + n.traits.social);
    if (bestG && this.rng.chance(pj)) this.joinGroup(n, bestG);
    else if (lone && this.rng.chance(pj)) {
      const g = { id: this.gid++, members: [], topic: null, speaker: null, spkT: 0, topicT: 0, argue: 0, born: w.t };
      w.groups.push(g); this.joinGroup(lone, g); this.joinGroup(n, g); this.pickTopic(g);
    }
  }
  joinGroup(n, g) {
    if (n.group != null) this.leaveGroup(n);
    g.members.push(n.id); n.group = g.id;
    for (const id of g.members) if (id !== n.id) { const m = this.w.people.get(id); n.ties[id] = (n.ties[id] || 0) + 0.01; m.ties[n.id] = (m.ties[n.id] || 0) + 0.01; }
  }
  leaveGroup(n) {
    const w = this.w, g = this.groupById(n.group);
    n.group = null; n.speaking = false; n.aloneSince = w.t;
    if (!g) return;
    g.members = g.members.filter(id => id !== n.id);
    if (g.speaker === n.id) g.speaker = null;
    if (g.members.length < 2) {
      for (const id of g.members) { const m = w.people.get(id); m.group = null; m.speaking = false; m.aloneSince = w.t; }
      g.members = []; w.groups = w.groups.filter(x => x !== g);
    }
  }
  pickTopic(g) {
    const w = this.w, ev = w.dir.topicNow();
    if (ev) { g.topic = ev; return; }
    const cnt = {};
    for (const id of g.members) for (const t of w.people.get(id).topics) cnt[t] = (cnt[t] || 0) + 1;
    const arr = Object.keys(cnt);
    g.topic = arr.length ? this.rng.weighted(arr, t => cnt[t] * cnt[t]) : null;
    g.topicT = this.rng.range(...this.T.group.topicSec);
  }
  groupTick(dt) {
    const w = this.w, T = this.T, rng = this.rng;
    for (const g of w.groups.slice()) {
      if (!g.members.length) continue;
      // связи крепнут
      for (const a of g.members) { const n = w.people.get(a); for (const b of g.members) if (a !== b) n.ties[b] = Math.min(1, (n.ties[b] || 0) + dt / 600); }
      g.topicT -= dt; if (g.topicT <= 0) this.pickTopic(g);
      g.spkT -= dt * (g.argue > w.t ? 2.5 : 1);
      if (g.spkT <= 0 || g.speaker == null) {
        const cand = g.members.filter(id => w.people.get(id).state !== 'talk');
        const prev = g.speaker;
        g.speaker = cand.length ? rng.weighted(cand, id => (id === prev ? 0.2 : 0.3 + w.people.get(id).traits.social)) : null;
        g.spkT = rng.range(...T.group.speakSec);
        for (const id of g.members) { const n = w.people.get(id); n.laugh = rng.chance(0.15 + 0.2 * (n.feel || 0)) ? 1.2 : 0; }
      }
      // слияние соседних групп
      if (rng.chance(T.group.mergeChance)) {
        const n = w.people.get(rng.pick(g.members)), s = n.seat && w.spotById[n.seat];
        if (s) for (const o of s.nb) {
          const m = o.occ && o.occ !== 'me' && w.people.get(o.occ);
          if (!m || m.group == null || m.group === g.id) continue;
          const h = this.groupById(m.group);
          const cg = this.center(g), ch = h && this.center(h);
          if (h && h.members.length + g.members.length <= Math.min(this.cap(g), this.cap(h)) && Math.hypot(cg.x - ch.x, cg.z - ch.z) < this.T.group.reach) {
            for (const id of h.members.slice()) { const q = w.people.get(id); q.group = null; this.joinGroup(q, g); }
            h.members = []; w.groups = w.groups.filter(x => x !== h);
            break;
          }
        }
      }
    }
    // говорящие и лица к центру группы
    for (const g of w.groups) {
      let cx = 0, cz = 0;
      for (const id of g.members) { const n = w.people.get(id); cx += n.x; cz += n.z; }
      cx /= g.members.length; cz /= g.members.length; g.x = cx; g.z = cz;
      for (const id of g.members) {
        const n = w.people.get(id);
        if (n.state === 'talk') continue;
        n.speaking = g.speaker === id;
        if (n.state === 'stand') n.rot = Math.atan2(cx - n.x, cz - n.z);
        n.feel = clamp((n.feel || 0) + dt * 0.004, -1, 1);
      }
    }
    for (const n of w.list) if (n.present && n.group == null && n.state !== 'talk') n.speaking = false;
  }

  // ─────────── позы ───────────
  pose(n) {
    const w = this.w, s = n.seat && w.spotById[n.seat], ev = w.dir.poseFor(n);
    if (n.laugh > 0) n.laugh -= 1 / 30;
    if (ev) { n.pose = ev; return; }
    if (n.state === 'sit') { n.pose = s?.sofa ? 'sitSofa' : 'sit'; return; }
    if (n.plan.kind === 'bar' && !n.speaking) { n.pose = 'drink'; return; }
    if (n.speaking) { n.pose = n.laugh > 0 ? 'laugh' : 'talk'; return; }
    if (n.laugh > 0) { n.pose = 'laugh'; return; }
    const ap = w.idx.ARCHETYPES[n.archetype]?.pose;
    if (n.group == null && (ap === 'phone' || ap === 'drink') && n.plan.kind === 'home') { n.pose = ap; return; }
    if (n.group == null && w.t - n.aloneSince > 12 && n.plan.kind !== 'smoke') { n.pose = 'phone'; return; }
    n.pose = 'stand';
  }
  poseTalk(n) {
    const w = this.w, P = w.player, s = n.seat && w.spotById[n.seat];
    const sit = n.state === 'talk' && n.seat && Math.hypot(s.x - n.x, s.z - n.z) < 0.05 && s.kind === 'seat';
    if (!sit) n.rot = Math.atan2(P.x - n.x, P.z - n.z);
    n.pose = sit ? (s.sofa ? 'sitSofa' : 'sit') : (n.speaking ? 'talk' : 'stand');
  }
}

return { Brain };
});
