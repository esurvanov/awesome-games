// Режиссёр вечера: события из CONTENT.EVENTS по часам и шансу, чудики (их события — EVENTS.by /
// ODDBALLS.event), сообщения в телефон из CONTENT.CHAT: лента до встречи (before), сообщения по ходу
// вечера от реальных гостей (during, автор — гость архетипа arch, который сейчас придёт), ответы игрока
// (meet — ждёт у входа, встретил = быстрое знакомство; guide — идёт к игроку), события (events), итог (after).
// Движок знает только форму effect, не конкретные истории:
//   dur(ч) close[]/flee[] gather(зона | {zone,share}) leave(доля | {share}) lure(доля, уходят с чудиком)
//   arrive(× притока) delay(ч) energy(±0..1) drain(× расхода сил) rapport(± к знакомым) topic price food
//   photo chat(ключ CHAT.events) mood(± настроению) pose/zone argue likes[]/dislikes[]
//   stage{x,z,r} — место музыканта (стоячие места рядом заняты) stop[] — остановить идущие события (id)
//   huddle{block,share,r,pose} — кучка у блока LAYOUT до конца события; leave{share, at:'end'} — уходят в конце (сначала кучка)
'use strict';
L.def('sim/director', () => {
const { clamp, tpl, hhmm } = L.use('core');

class Director {
  constructor(w, opt = {}) {
    this.w = w; this.T = w.T; this.rng = w.rng;
    this.plan = [];        // [{ ev, at, by }] — ещё не начатые
    this.fired = [];       // id сработавших
    this.phone = [];       // все сообщения
    this.inbox = [];       // [{ at, ... }] — запланированные
    this.mid = 1; this.fedBefore = false;
    this.price = 1;
    this.month = opt.month || null;
    const oddIn = new Map(w.list.filter(n => n.oddball).map(n => [n.oddball, n]));
    const taken = new Set();
    for (const e of w.C.EVENTS || []) {
      if (e.month && e.month !== this.month) continue;
      if ((e.excl || []).some(x => taken.has(x))) continue;
      const at = e.at || [w.T.time.start + 1, w.T.time.start + 4];
      // событие чудика: только если он в этом вечере (и не раньше его прихода)
      const byId = e.by || (w.C.ODDBALLS || []).find(o => o.event === e.id)?.id;
      const by = byId && oddIn.get(byId);
      if (by) { this.plan.push({ ev: e, at: Math.max(this.rng.range(at[0], at[1]), by.arrive + 0.05), by, till: at[1] + 0.5 }); taken.add(e.id); continue; }
      if (this.rng.chance(e.chance ?? 1)) { this.plan.push({ ev: e, at: this.rng.range(at[0], at[1]) }); taken.add(e.id); }
    }
    this.plan.sort((a, b) => a.at - b.at);
    this.planChat();
  }

  // ─────────── телефон ───────────
  chatArr(kind) {
    const C = this.w.C.CHAT; if (!C) return [];
    const a = Array.isArray(C) ? C.filter(m => m.kind === kind) : C[kind] || [];
    return a.map(m => typeof m === 'string' ? { text: m } : m);
  }
  // сообщения по ходу вечера: before (19–20), where (20–21), late (после 21:30), during (своё at) — от реальных
  // гостей (arch — подсказка, чей архетип), background — фон без автора
  planChat() {
    const w = this.w, rng = this.rng, T = this.T, h0 = T.time.start, TC = T.chat;
    const used = new Set();
    const author = (m, at, lateOnly) => {
      const fits = p => !p.oddball && !used.has(p.id) && p.leave > at + 0.3 && (!lateOnly || p.arrive >= T.crowd.lateFrom - 0.2);
      const soon = p => p.arrive >= at - 0.05 && p.arrive <= at + 0.8;
      const pools = [
        w.list.filter(p => fits(p) && m.arch && p.archetype === m.arch && soon(p)),
        w.list.filter(p => fits(p) && m.arch && p.archetype === m.arch && (lateOnly ? p.arrive >= at : p.arrive <= at + 1.5)),
        w.list.filter(p => fits(p) && soon(p)),
        lateOnly ? w.list.filter(p => fits(p) && p.arrive >= at) : [],
      ];
      for (const pool of pools) if (pool.length) return rng.pick(pool);
      return null;
    };
    const put = (m, win, kind, lateOnly) => {
      let at = rng.range(win[0], win[1]);
      const n = author(m, at, lateOnly);
      if (!n) return false;
      used.add(n.id);
      if (n.arrive > at) at = Math.min(at, n.arrive - 0.05); else at = Math.max(at, n.arrive + 0.02);
      if (lateOnly) at = Math.max(h0 + 1.5, Math.min(at, n.arrive - 0.35));
      this.inbox.push({ at, kind, n, m });
      return true;
    };
    const slots = [['before', [h0, h0 + 1], TC.before, false], ['where', [h0 + 1, h0 + 2], TC.where, false], ['late', [T.crowd.lateFrom, h0 + 4], TC.late, true]];
    for (const [kind, win, cnt, lateOnly] of slots) {
      const arr = rng.shuffle(this.chatArr(kind).filter(m => !m.stamp));
      let k = rng.int(cnt[0], cnt[1]);
      for (const m of arr) { if (k <= 0) break; if (put(m, m.at || win, kind, lateOnly)) k--; }
    }
    for (const m of this.chatArr('during')) {
      const win = m.at || [h0, h0 + 2];
      if (m.arch || m.options?.length) put(m, win, 'during', false);
      else this.inbox.push({ at: rng.range(win[0], win[1]), kind: 'during', n: null, m });
    }
    for (const m of this.chatArr('background')) { const win = m.at || [h0 + 1, h0 + 5]; this.inbox.push({ at: rng.range(win[0], win[1]), kind: 'background', n: null, m }); }
    this.inbox.sort((a, b) => a.at - b.at);
  }
  // лента до встречи: CHAT.feed (или старые before со stamp)
  feed() { const C = this.w.C.CHAT || {}; return (C.feed || (C.before || []).filter(m => m.stamp)).map(m => typeof m === 'string' ? { text: m } : m); }
  vars(n) {
    const w = this.w, C = w.C.CHAT || {};
    const fake = () => { const N = w.C.NAMES || {}, pool = (this.rng.chance(0.5) ? N.m : N.f) || N.m || []; return pool.length ? this.rng.pick(pool) : ''; };
    return { name: n ? n.name : fake(), me: w.player.name, hour: hhmm(w.hour), time: n ? hhmm(n.arrive) : '', n: C.meetNo ?? '', date: '' };
  }
  send(m, kind, n = null, extra = {}) {
    const w = this.w, C = w.C.CHAT || {};
    const v = { ...this.vars(n), ...extra };
    let text = m.text || '', special = null;
    if (text === '{announce}') { special = 'announce'; text = tpl(C.announce?.text || '', v); }
    else if (text === '{poll}') { special = 'poll'; text = C.poll?.question || ''; }
    else text = tpl(text, v);
    const msg = { id: this.mid++, kind, key: m.id || null, who: m.who || (n ? 'npc' : 'bot'), from: n ? n.name : (m.who === 'org' || m.who === 'bot' ? null : v.name),
      fromId: n ? n.id : null, stamp: m.stamp || null, icon: m.icon || null, text, special,
      poll: special === 'poll' ? C.poll : null,
      options: (m.options || []).map((o, i) => ({ id: o.id ?? i, label: o.label, icon: o.icon || null, ok: !!o.ok, fx: o.fx || null })),
      at: w.hour, answered: null };
    this.phone.push(msg);
    w.bus.emit('chat', { msg });
    return msg;
  }
  // ответ игрока: option — индекс или id варианта
  reply(id, optRef) {
    const w = this.w, msg = this.phone.find(m => m.id === id);
    if (!msg || msg.answered != null || !msg.options.length) return false;
    const o = msg.options.find(x => x.id === optRef) || (typeof optRef === 'number' ? msg.options[optRef] : null) || msg.options[0];
    msg.answered = o.id;
    const fx = o.fx || {}, n = msg.fromId && w.people.get(msg.fromId);
    if (fx.energy) w.addEnergy(fx.energy);                   // шкала 0..1
    if (!n) return true;
    if (fx.rapport) n.rapport = clamp(n.rapport + fx.rapport, -0.3, 1);
    // ok — «иду встречать / объясню»: ещё не пришёл — ждёт у входа (встретил = знакомство), потом идёт к игроку
    const meet = fx.meet || (o.ok && !fx.guide && !n.present), guide = fx.guide || o.ok;
    if (guide) n.comeTo = 'me';
    if (meet && !n.metAtDoor) {
      n.meet = true;
      if (n.present && n.state !== 'talk' && n.plan.kind === 'home') this.goMeet(n);
    } else if (guide && n.present && n.state !== 'talk' && n.plan.kind === 'home') w.brain.relocate(n, { near: w.player, anyZone: true });
    return true;
  }
  // автор ждёт игрока у входа
  goMeet(n) {
    const w = this.w, D = w.LAY.door, sec = this.T.chat.meetWait * this.T.time.realSecPerHour;
    // ждёт внутри, у самой двери (ближайшее к входу стоячее место в зале)
    const ok = w.brain.goTemp(n, 'meet', s => s.kind === 'stand' && s.z > 0.2 && Math.hypot(s.x - D.x, s.z - D.z) < 3, sec, { x: D.x, z: D.z + 0.6 })
      || w.brain.goTemp(n, 'meet', s => s.kind === 'stand' && Math.hypot(s.x - D.x, s.z - D.z) < 3, sec, D);
    if (!ok) n.meet = false;
    return ok;
  }
  quickMeet(n) {
    const w = this.w;
    n.meet = false; n.metAtDoor = true;
    n.rapport = Math.max(n.rapport, this.T.talk.meetBonus);
    w.talk.reveal(n, 'name'); w.talk.reveal(n, 'job');
    w.talk.ladder(n, 1); w.talk.ladder(n, 2);
    w.bus.emit('toast', { icon: 'door', text: `${this.T.text.atDoor}: ${n.name}` });
    if (n.plan.kind === 'meet') n.plan.until = w.t + 3;
  }
  // человек переступил порог: если его ждут у двери — встреча
  onEnter(n) {
    const w = this.w, P = w.player, D = w.LAY.door;
    if (n.meet && !n.metAtDoor && Math.hypot(P.x - D.x, P.z - D.z) <= this.T.chat.doorRadius && !w.talk.cur) this.quickMeet(n);
  }
  onArrive(n) {
    const w = this.w;
    if (n.oddball) {
      const od = w.idx.ODDBALLS[n.oddball];
      if (od?.catch) w.bus.emit('toast', { icon: od.icon, text: od.sign || od.catch });
    }
  }
  // вызывается мозгом после прихода: вместо своего места — к двери ждать игрока
  wantsMeet(n) { return n.meet && !n.metAtDoor; }

  // ─────────── события ───────────
  update(dt) {
    const w = this.w;
    if (!this.fedBefore) { this.fedBefore = true; for (const m of this.feed()) this.send(m, 'feed', null); }
    while (this.inbox.length && this.inbox[0].at <= w.hour) { const it = this.inbox.shift(); this.send(it.m, it.kind, it.n); }
    while (this.plan.length && this.plan[0].at <= w.hour) {
      const p = this.plan.shift();
      if (p.by && !p.by.present) {            // чудик ещё не пришёл / уже ушёл
        if (p.by.state === 'out' && w.hour < p.till) { p.at = Math.max(w.hour + 0.02, p.by.arrive + 0.03); this.plan.push(p); this.plan.sort((a, b) => a.at - b.at); }
        continue;
      }
      this.start(p.ev, p.by || null);
    }
    for (const e of w.events.slice()) if (w.hour >= e.until) this.stop(e);
    // фото: ближе к концу события (все подошли и встали) — снимок; сборка снимает кадр в тот же миг
    for (const e of w.events) if (e.effect.photo && !e.shot && w.hour >= e.t0 + (e.until - e.t0) * 0.7) { e.shot = true; w.score.onPhoto(); }
    // ждущие у входа: игрок подошёл — знакомство на бегу
    const P = w.player;
    for (const n of w.list) if (n.present && n.meet && n.plan.kind === 'meet' && !n.nav && Math.hypot(P.x - n.x, P.z - n.z) < this.T.chat.doorRadius && !w.talk.cur) this.quickMeet(n);
  }
  start(ev, by = null) {
    const w = this.w, fx = ev.effect || {}, rng = this.rng, TE = this.T.events;
    if (w.events.some(e => e.id === ev.id)) return;
    const e = { id: ev.id, title: ev.title, icon: ev.icon, scene: ev.scene || null, t0: w.hour, until: w.hour + Math.max(fx.dur ?? 0.3, TE.minDur), effect: fx, by: by?.id || null };
    w.events.push(e); this.fired.push(ev.id);
    w.score.onEvent(ev);
    w.bus.emit('event', { id: ev.id, on: true, title: ev.title, icon: ev.icon, scene: e.scene, by: e.by, toast: ev.toast || null });
    // всплывашку события (ev.toast || title) рисует интерфейс по 'event' — одна на событие
    if (fx.chat) { const arr = (w.C.CHAT?.events || {})[fx.chat]; if (arr?.length) this.send(rng.pick(arr), 'event'); }
    const live = w.list.filter(n => n.present && n.plan.kind !== 'leave');
    const free = n => n.state !== 'talk';
    const close = fx.close || fx.flee;
    if (close) { for (const z of close) w.closed.add(z); for (const n of live) if (free(n)) this.fleeOne(n, close); }
    if (fx.mood) for (const n of live) n.feel = clamp(n.feel + fx.mood, -1, 1);
    if (fx.energy) { w.addEnergy(fx.energy); for (const n of live) n.energy = clamp(n.energy + fx.energy, 0, 1); }
    if (fx.rapport) for (const n of w.list) if (n.step >= 1) n.rapport = clamp(n.rapport + fx.rapport, -0.3, 1);
    if (fx.price != null) this.price = fx.price;
    if (fx.topic) for (const g of w.groups) g.topic = fx.topic;
    // опоздания: пробка/дождь сдвигают приход, но не через начало пика (кривая вечера — инвариант)
    const pa = this.T.crowd.peak.at[0], pb = this.T.crowd.peak.at[1];
    const shift = (n, d) => {
      if (n.arrive < pa) n.arrive = Math.min(n.arrive + d, pa - 0.05);
      else if (n.arrive > pb) n.arrive = n.arrive + d;
    };
    if (fx.delay) for (const n of w.list) if (n.state === 'out' && !n.oddball) shift(n, fx.delay);
    if (fx.arrive != null && fx.arrive < 1) for (const n of w.list)
      if (n.state === 'out' && !n.oddball && n.arrive < e.until && rng.chance(1 - fx.arrive)) shift(n, Math.min(e.until - n.arrive, TE.arriveMax));
    if (fx.argue) {
      const gs = w.groups.filter(g => g.members.length >= 3);
      if (gs.length) { const g = rng.pick(gs); g.argue = w.t + (e.until - e.t0) * this.T.time.realSecPerHour; e.group = g.id; }
    }
    // уход: доля гостей уходит сейчас (leave.at 'end' — в конце события, первыми — собравшиеся у точки); lure — уводит чудик
    if (fx.leave && fx.leave.at !== 'end') this.goOut(e, typeof fx.leave === 'number' ? fx.leave : fx.leave.share ?? 0.3);
    if (fx.lure) this.goOut(e, fx.lure, by);
    const gz = typeof fx.gather === 'string' ? fx.gather : fx.gather?.zone;
    if (gz && !fx.photo && !(fx.lure && gz === 'street')) {
      const share = typeof fx.gather === 'object' ? fx.gather.share ?? TE.gatherShare : TE.gatherShare;
      const cand = rng.shuffle(live.filter(n => free(n) && n.plan.kind === 'home' && !n.nav && n.seat && w.spotById[n.seat].zone !== gz));
      for (const n of cand.slice(0, Math.round(cand.length * share))) w.brain.relocate(n, { zone: gz });
    }
    if (fx.stop) for (const x of w.events.filter(x => x !== e && fx.stop.includes(x.id))) this.stop(x);
    if (fx.stage) this.takeStage(e, fx.stage);
    if (fx.photo) this.gatherPhoto(e);
    if (fx.huddle) this.huddle(e, fx.huddle);
  }
  // доля гостей уходит; odd — чудик, который уводит (он первый); first — id, кто уходит в первую очередь
  goOut(e, share, odd = null, first = null) {
    const w = this.w, rng = this.rng, pa = this.T.crowd.peak.at[0], pb = this.T.crowd.peak.at[1];
    const live = w.list.filter(n => n.present && n.plan.kind !== 'leave');
    let cand = rng.shuffle(live.filter(n => n.state !== 'talk' && n.leave < this.T.time.end));
    if (first) cand = cand.filter(n => first.has(n.id)).concat(cand.filter(n => !first.has(n.id)));
    if (odd && odd.present) { const i = cand.indexOf(odd); if (i >= 0) cand.splice(i, 1); cand.unshift(odd); }
    const k = Math.round(live.length * share) + (odd ? 1 : 0);
    let lost = 0;
    for (const n of cand.slice(0, k)) {
      if (n.leave > pa) lost++;
      n.leave = w.hour + rng.range(0, 0.04);
      if (n.partner) { const q = w.people.get(n.partner); if (q) { if (q.leave > pa) lost++; q.leave = n.leave; } }
    }
    // кривая вечера — инвариант: ушедшие до конца пика заменяются теми, кто собирался прийти позже
    if (w.hour < pb) {
      const later = w.list.filter(n => n.state === 'out' && !n.oddball && !n.partner && n.arrive > pb).sort((a, b) => a.arrive - b.arrive);
      for (const n of later.slice(0, lost)) { n.arrive = Math.max(w.hour + rng.range(0.05, 0.25), Math.min(n.arrive, pa - 0.2)); n.leave = Math.max(n.leave, pb + 0.3); }
    }
    return e;
  }
  // stage { x, z, r }: место музыканта (его рисует сборка) — стоячие места рядом заняты, пока идёт событие
  takeStage(e, st) {
    const w = this.w, r = st.r ?? 0.8;
    e.stageSpots = [];
    for (const s of w.spots) {
      if (s.kind !== 'stand' || Math.hypot(s.x - st.x, s.z - st.z) >= r) continue;
      const n = s.occ && s.occ !== 'me' && w.people.get(s.occ);
      if (n && n.state !== 'talk') { if (n.home === s.id) w.brain.relocate(n, { anyZone: true }); else w.brain.goHome(n); }
      if (!s.occ) { s.occ = 'stage'; e.stageSpots.push(s); }
    }
  }
  // huddle { block, share, r, pose }: доля гостей встаёт кучкой у блока LAYOUT (колонка → караоке) до конца события
  huddle(e, h) {
    const w = this.w, b = w.LAY.blocks.find(x => x.id === h.block); if (!b) return;
    const c = { x: (b.rect[0] + b.rect[2]) / 2, z: (b.rect[1] + b.rect[3]) / 2 }, r = h.r ?? 2.5;
    const dur = (e.until - e.t0) * this.T.time.realSecPerHour;
    const near = s => s.kind === 'stand' && Math.hypot(s.x - c.x, s.z - c.z) < r;
    e.at = c; e.huddled = new Set();
    const cand = this.rng.shuffle(w.list.filter(n => n.present && n.plan.kind === 'home' && n.state !== 'talk' && !n.nav))
      .sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z));
    const k = Math.max(1, Math.round(cand.length * (h.share ?? 0.25)));
    for (const n of cand) {
      if (e.huddled.size >= k) break;
      n.leftHome = w.t;
      if (w.brain.goTemp(n, 'gather', near, dur, c)) e.huddled.add(n.id);
    }
  }
  gatherPhoto(e) {
    const w = this.w, P = w.LAY.photo, R = this.T.photo.radius;
    const dur = (e.until - e.t0) * this.T.time.realSecPerHour;
    for (const n of w.list) {
      if (!n.present || n.plan.kind === 'leave' || n.state === 'talk') continue;
      if (n.seat && n.state === 'sit' && Math.hypot(n.x - P.x, n.z - P.z) < R) continue;
      n.leave = Math.max(n.leave, e.until + 0.02);
      w.brain.goTemp(n, 'photo', s => s.kind === 'stand' && Math.hypot(s.x - P.x, s.z - P.z) < R, dur);
    }
  }
  fleeOne(n, zones) {
    const w = this.w, B = w.spotById, s = n.seat && B[n.seat], h = n.home && B[n.home];
    if (n.plan.spot && zones.includes(B[n.plan.spot]?.zone)) { w.brain.goHome(n); return; }
    if ((s && zones.includes(s.zone)) || (h && zones.includes(h.zone))) w.brain.relocate(n, { anyZone: true });
  }
  stop(e) {
    const w = this.w;
    w.events = w.events.filter(x => x !== e);
    const close = e.effect.close || e.effect.flee;
    if (close) for (const z of close) if (!w.events.some(x => (x.effect.close || x.effect.flee)?.includes(z))) w.closed.delete(z);
    if (e.effect.price != null && !w.events.some(x => x.effect.price != null)) this.price = 1;
    for (const s of e.stageSpots || []) if (s.occ === 'stage') s.occ = null;
    const lv = e.effect.leave;
    if (lv && lv.at === 'end') this.goOut(e, lv.share ?? 0.3, null, e.huddled);
    w.bus.emit('event', { id: e.id, on: false, title: e.title, icon: e.icon, scene: e.scene, by: e.by });
  }
  topicNow() { for (const e of this.w.events) if (e.effect.topic) return e.effect.topic; return null; }
  drain() { let d = 1; for (const e of this.w.events) if (e.effect.drain) d *= e.effect.drain; return d; }
  food() { for (const e of this.w.events) if (e.effect.food) return { zone: typeof e.effect.gather === 'string' ? e.effect.gather : e.effect.gather?.zone || null }; return null; }
  // поза от события: пение за столом ДР, фото, спорщики
  poseFor(n) {
    const w = this.w; if (!w.events.length) return null;
    for (const e of w.events) {
      const fx = e.effect;
      if (fx.photo && (n.plan.kind === 'photo' || (n.state === 'sit' && Math.hypot(n.x - w.LAY.photo.x, n.z - w.LAY.photo.z) < this.T.photo.radius))) return n.oddball === 'photographer' ? 'photo' : 'wave';   // позируют; снимает фотограф
      if (fx.huddle && e.at && (e.huddled?.has(n.id) || (n.state === 'sit' && Math.hypot(n.x - e.at.x, n.z - e.at.z) < (fx.huddle.r ?? 2.5))) && !n.nav) return fx.huddle.pose || 'sing';
      if (fx.pose && (!fx.zone || (n.seat && w.spotById[n.seat].zone === fx.zone))) return fx.pose;
      if (e.group && n.group === e.group && n.state === 'stand') return 'talk';
    }
    return null;
  }
  // игрок идёт на общее фото; если фото ещё не было и уже поздно — собирает его сам
  playerPhoto() {
    const w = this.w, P = w.LAY.photo;
    if (!w.events.some(e => e.effect.photo)) {
      const ev = (w.C.EVENTS || []).find(e => e.effect?.photo);
      if (!ev || w.hour < this.T.photo.from || this.fired.includes(ev.id)) return false;
      this.plan = this.plan.filter(p => p.ev !== ev);
      this.start(ev, null);
    }
    if (w.talk.cur) w.talk.end('photo');
    w.leaveSeat(); w.player.goal = { kind: 'photo' }; w.player.state = 'walk';
    return w.goPoint(w.player, P.x, P.z);
  }
}

return { Director };
});
