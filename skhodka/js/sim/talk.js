// Разговор игрока: подход → приветствие → ходы-карты (рука из CONTENT.CARDS) → реакция собеседника по
// складу (MINDS.likes/dislikes), настроению (MOODS), темам роли и шкалам (traits). Симпатия npc.rapport
// (−0.3..1) раскрывает карточку: имя → работа → интересы → склад → что ищет (порог — MINDS.gate);
// ступени знакомства 0..5: видел, поздоровался, поговорили, общая тема, контакт, договорились.
// У закрытых — порог открытости, у всех — утомление (MINDS.battery). «Познакомить с…» — сведение двух
// людей с совпавшими нуждой↔предложением или общей темой → 'pair'.
// Реплики: LINES[тема] → LINES[стиль] → LINES.any, без повторов, пока не прошли все; свои строки у чудиков
// (ODDBALLS.lines/catch), первой фразы архетипа (ARCHETYPES.first), нужд (NEEDS.seekLines/offerLines),
// открытости (MOODS.openLines).
'use strict';
L.def('sim/talk', () => {
const { clamp, tpl } = L.use('core');

const FIELDS = ['name', 'job', 'topics', 'mind', 'need'];
const STEP = { SEEN: 0, HELLO: 1, TALKED: 2, COMMON: 3, CONTACT: 4, DEAL: 5 };
const DRINKS = { beer: 1, cup: 1, wine: 1, glass: 1 };

class Talk {
  constructor(w) {
    this.w = w; this.T = w.T; this.rng = w.rng;
    this.cur = null;          // текущий разговор
    this.log = [];            // [{ id, result, turns, step }]
    this.pairs = new Set();   // 'a|b'
    this.decks = new Map();   // колоды реплик без повторов
    this.hasHello = (w.C.CARDS || []).some(k => this.action(k) === 'hello');
  }

  // ─────────── начало / конец ───────────
  start(n) {
    const w = this.w, T = this.T.talk, P = w.player;
    if (this.cur) this.end('switch');
    if (!n.present || n.plan.kind === 'leave' || n.state === 'gone') return false;
    if (n.cold > w.t) { w.bus.emit('toast', { icon: 'clock', text: this.T.text.busy }); return false; }
    const patience = this.rng.range(...T.patience) * (n.battery ?? 1) * (0.6 + 0.5 * n.traits.social + 0.3 * n.energy);
    this.cur = { id: n.id, turns: 0, last: null, used: new Set(), streak: 0, fatigue: 0, patience, pending: null, offer: [], t0: w.t, opened: false, hits: new Set() };
    n.talkPrev = { state: n.state };
    n.nav = null; n.state = 'talk'; n.talks++;
    if (!n.warmInit) { n.warmInit = true; n.rapport = clamp(n.rapport + T.startWarm + 0.18 * (n.traits.open - 0.5) + 0.08 * (n.energy - 0.5), -0.1, 0.5); }
    P.state = 'talk'; P.nav = null;
    w.bus.emit('talk:start', { id: n.id });
    if (!this.hasHello && n.step < STEP.HELLO) this.hello(n, null);
    this.offerCards(n);
    return true;
  }
  hello(n, card) {
    this.ladder(n, STEP.HELLO);
    if (n.rapport >= this.thr(n, 'name')) this.reveal(n, 'name');
    const od = n.oddball && this.w.idx.ODDBALLS[n.oddball], a = this.w.idx.ARCHETYPES[n.archetype];
    const first = !n.greeted && (od?.catch || a?.first);
    n.greeted = true;
    if (first) this.say1(n, first, 'hello'); else this.line(n, card, 'hello');
  }
  end(result) {
    const c = this.cur; if (!c) return;
    const w = this.w, n = w.people.get(c.id), P = w.player;
    this.cur = null;
    P.state = P.seat ? 'sit' : 'stand'; P.speaking = false;
    if (n) {
      n.speaking = false; n.talkPrev = null;
      if (n.present && n.state === 'talk') {
        const s = n.seat && w.spotById[n.seat];
        if (s && Math.hypot(s.x - n.x, s.z - n.z) < 0.05) { n.state = s.kind === 'seat' ? 'sit' : 'stand'; n.rot = s.face; if (n.group == null) w.brain.tryJoin(n); }
        else { n.state = 'walk'; n.nav = null; w.brain.goHome(n); }
      }
      n.think = 1;
    }
    this.log.push({ id: c.id, result, turns: c.turns, step: n?.step ?? 0 });
    w.bus.emit('talk:end', { id: c.id, result, step: n?.step ?? 0, rapport: +(n?.rapport ?? 0).toFixed(2) });
  }

  moodOf(n) { return this.w.idx.MOODS[n.mood] || { energy: 0.6, likes: [], dislikes: [], likeTopics: [], hateTopics: [] }; }
  mindOf(n) { return this.w.idx.MINDS[n.mind] || { likes: [], dislikes: [] }; }
  // порог раскрытия поля: доверчивые раскрываются раньше; нужду — по MINDS.gate
  thr(n, f) {
    const base = f === 'need' ? (this.mindOf(n).gate ?? this.T.talk.reveal.need) : this.T.talk.reveal[f];
    return base * (1.25 - 0.5 * n.traits.trust);
  }
  contactThr(n) { return this.T.talk.contact + (0.5 - n.traits.trust) * 0.16; }
  gate(n) { return (1 - n.traits.open) * this.T.talk.gate; }

  // ─────────── карты ───────────
  action(card) { return card.act || card.do || (card.when === 'contact' || card.when === 'deal' ? card.when : null); }
  // кого из знакомых игрока можно свести с n (лучший кандидат)
  pairable(n) {
    const w = this.w; let best = null, bs = 0;
    for (const m of w.list) {
      if (m === n || !m.present || m.step < STEP.TALKED || this.pairs.has(this.key(n.id, m.id))) continue;
      if ([...this.pairs].filter(p => p.split('|').includes(m.id)).length >= this.T.talk.pairMax) continue;
      let s = 0;
      if ((n.need && n.need === m.offer) || (m.need && m.need === n.offer)) s += 3;
      for (const t of n.topics) if (m.topics.includes(t)) s += 1;
      if (s > bs) { bs = s; best = m; }
    }
    return best;
  }
  when(card, n) {
    const w = this.w, c = this.cur, wh = card.when, act = this.action(card), P = w.player;
    if (act === 'hello' && n.step >= STEP.HELLO) return false;
    if (act !== 'hello' && this.hasHello && n.step < STEP.HELLO) return false;
    if (act === 'contact' && n.step >= STEP.CONTACT) return false;
    if (act === 'deal' && (n.step >= STEP.DEAL || n.step < STEP.CONTACT)) return false;
    if (act === 'photo' && n.selfie) return false;
    if (!wh) return true;
    if (typeof wh === 'string') switch (wh) {
      case 'first': return n.step === STEP.SEEN || (!this.hasHello && c.turns === 0);
      case 'greeted': return n.step >= STEP.HELLO;
      case 'talked': return n.step >= STEP.TALKED;
      case 'warm': return n.rapport >= this.T.talk.talked;
      case 'cold': return n.rapport < this.T.talk.talked;
      case 'common': return n.step >= STEP.COMMON;
      case 'contact': return n.step >= STEP.TALKED && n.step < STEP.CONTACT;   // можно просить контакт
      case 'deal': return n.step === STEP.CONTACT;                             // контакт есть — можно договориться
      case 'need': return n.known.need;
      case 'known': return n.known.topics;
      case 'pairable': return !!this.pairable(n);
      case 'late': return w.hour >= 23;
      case 'bar': return w.zoneOf(n.x, n.z) === 'bar' || w.zoneOf(P.x, P.z) === 'bar' || !!DRINKS[P.prop];
      case 'tired': return c.fatigue > 0.6 || n.energy < 0.3;
      case 'group': { const g = n.group != null && w.brain.groupById(n.group); return !!g && g.members.length >= 3; }
      case 'alone': return n.group == null;
      case 'oddball': return !!n.oddball;
      case 'event': return w.events.length > 0;
      default: return true;
    }
    const inR = (v, r) => !r || (v >= r[0] && v <= r[1]);
    return inR(n.step, wh.step) && inR(n.rapport, wh.warm) && inR(w.hour, wh.hour) && inR(c.turns, wh.turn)
      && (!wh.field || n.known[wh.field]) && (!wh.zone || w.zoneOf(n.x, n.z) === wh.zone) && (!wh.event || w.events.some(e => e.id === wh.event));
  }
  // темы, которые игрок «знает» в этом разговоре: свои, раскрытые у собеседника, угаданные, «в воздухе»
  knownTopics(n) {
    const s = new Set(this.w.player.topics);
    if (n.known.topics) for (const t of n.topics) s.add(t);
    for (const t of this.cur.hits) s.add(t);
    const air = this.w.dir.topicNow(); if (air) s.add(air);
    return s;
  }
  resolveTopic(card, n) {
    const t = card.topic, w = this.w, P = w.player;
    if (!t) return null;
    if (t === 'their' || t === '*') {
      if (n.known.topics || this.rng.chance(0.35)) return this.rng.pick(n.topics);
      const T = w.C.TOPICS || []; return T.length ? this.rng.weighted(T).id : null;
    }
    if (t === 'mine') return P.topics.length ? this.rng.pick(P.topics) : null;
    if (t === 'event') return w.dir.topicNow();
    return t;
  }
  offerCards(n) {
    const c = this.cur, T = this.T.talk, rng = this.rng, w = this.w;
    const known = this.knownTopics(n);
    const pool = (w.C.CARDS || []).filter(k => this.when(k, n) && !(c.last && c.last.id === k.id));
    const special = pool.filter(k => { const a = this.action(k); return a && a !== 'bye'; });
    const bye = pool.filter(k => this.action(k) === 'bye');
    const fixedTopic = k => k.topic && k.topic !== 'their' && k.topic !== 'mine' && k.topic !== '*' && k.topic !== 'event';
    const topical = pool.filter(k => !this.action(k) && k.topic && (!fixedTopic(k) || known.has(k.topic)));
    const guess = pool.filter(k => !this.action(k) && fixedTopic(k) && !known.has(k.topic));
    const plain = pool.filter(k => !this.action(k) && !k.topic);
    const H = T.hand, want = Array.isArray(H) ? rng.int(H[0], H[1]) : H;
    const pick = [];
    const hello = special.filter(k => this.action(k) === 'hello');
    if (hello.length) pick.push(rng.pick(hello));
    else {
      // особые действия: контакт/договор — когда близко к порогу; свести, селфи — изредка
      for (const k of rng.shuffle(special.slice())) {
        const a = this.action(k);
        const near = a === 'contact' ? n.rapport >= this.contactThr(n) - 0.12 : a === 'deal' ? n.rapport >= this.T.talk.deal - 0.12 : rng.chance(0.35);
        if (near || rng.chance(0.2)) { pick.push(k); break; }
      }
      if (topical.length) pick.push(rng.pick(topical));
      if (guess.length && rng.chance(T.guess)) pick.push(rng.pick(guess));
    }
    const rest = rng.shuffle(plain.concat(topical).filter(k => !pick.includes(k)));
    const styles = new Set(pick.map(k => k.style));
    for (const k of rest) { if (pick.length >= want) break; if (styles.has(k.style)) continue; pick.push(k); styles.add(k.style); }
    for (const k of rest) { if (pick.length >= want) break; if (!pick.includes(k)) pick.push(k); }
    const hand = pick.slice(0, want);
    if (bye.length && n.step >= STEP.HELLO) hand.push(bye[0]);
    c.offer = hand.map((k, i) => {
      const topic = this.resolveTopic(k, n), tt = topic && w.idx.TOPICS[topic];
      return { id: k.id, key: `${k.id}#${i}`, style: k.style, icon: k.icon, topic, topicTitle: tt?.title || '', topicIcon: tt?.icon || null,
        label: tpl(k.label, { topic: tt?.title || '', name: n.known.name ? n.name : '', me: w.player.name }), act: this.action(k), do: this.action(k), cost: k.cost };
    });
    w.bus.emit('talk:cards', { cards: c.offer });
  }

  // ─────────── ход игрока ───────────
  // цена реплики: база × стиль × событие × усталость вечера (после E.lateFrom растёт на E.late в час)
  // × долгий разговор (после E.longFrom ходов с одним человеком — +E.long за ход: пора сменить собеседника)
  cost(card) {
    const T = this.T, E = T.energy, base = card.cost != null ? card.cost : E.say * (T.talk.cost[card.style] ?? 1);
    if (!(base > 0)) return base;
    const late = 1 + (E.late || 0) * Math.max(0, this.w.hour - (E.lateFrom ?? 25));
    const long = 1 + (E.long || 0) * Math.max(0, (this.cur?.turns ?? 0) - (E.longFrom ?? 99));
    return base * this.w.dir.drain() * late * long;
  }
  say(cardRef) {
    const c = this.cur, w = this.w, P = w.player, T = this.T;
    if (!c || c.pending) return false;
    const ref = typeof cardRef === 'object' && cardRef ? (cardRef.key || cardRef.id) : cardRef;
    const card = c.offer.find(k => k.key === ref) || c.offer.find(k => k.id === ref) || (typeof ref === 'number' ? c.offer[ref] : null);
    if (!card) return false;
    const n = w.people.get(c.id);
    if (card.act === 'bye') { w.bus.emit('talk:line', { who: 'me', text: card.label, mood: 'me' }); this.end('bye'); return true; }
    const cost = this.cost(card);
    if (cost > 0 && P.energy < cost && card.style !== 'wait' && card.style !== 'listen') { w.bus.emit('toast', { icon: 'battery', text: T.text.noEnergy }); return false; }
    w.addEnergy(-cost);
    P.speaking = true;
    w.bus.emit('talk:line', { who: 'me', text: card.label, mood: 'me' });
    if (card.act === 'introduce') {
      const m = this.pairable(n);
      if (!m) w.bus.emit('toast', { icon: 'users', text: T.text.pairNone }); else this.introduce(n.id, m.id, true);
      P.speaking = false;
      if (this.cur) this.offerCards(n);
      return true;
    }
    c.pending = { card, at: w.t + this.rng.range(...T.talk.replySec) };
    w.bus.emit('talk:cards', { cards: [] });
    return true;
  }
  // оценка карты для этого человека: > good — хорошо, < bad — плохо
  score(n, card) {
    const W = this.T.talk.w, mind = this.mindOf(n), mood = this.moodOf(n), c = this.cur, w = this.w;
    let s = 0;
    const st = card.style;
    if (mind.likes?.includes(st)) s += W.mindLike;
    if (mind.dislikes?.includes(st)) s += W.mindHate;
    if (mood.likes?.includes(st)) s += W.moodLike;
    if (mood.dislikes?.includes(st)) s += W.moodHate;
    const od = n.oddball && w.idx.ODDBALLS[n.oddball];
    if (card.topic) {
      s += n.topics.includes(card.topic) ? W.topic : W.offTopic;
      if (mood.likeTopics?.includes(card.topic)) s += W.likeTopic;
      if (mood.hateTopics?.includes(card.topic)) s += W.hateTopic;
      if (w.dir.topicNow() === card.topic) s += W.event * this.T.talk.airTopic;
      if (!n.it && w.idx.TOPICS[card.topic]?.kind === 'work') s += W.notIt;
      if (od?.befriend?.topic === card.topic) s += W.oddTopic;
    }
    if (od?.befriend?.likes?.includes(st)) s += W.oddLike;
    for (const e of w.events) { if (e.effect.likes?.includes(st)) s += W.event; if (e.effect.dislikes?.includes(st)) s -= W.event; }
    if (n.traits.pace > 0.7 && (st === 'wait' || st === 'listen')) s += W.pace;
    if (n.traits.pace < 0.3 && (st === 'argue' || st === 'joke')) s += W.pace;
    if (st === 'invite' && n.group != null && n.traits.group > 0.6) s += W.group;
    if (c.last && c.last.style === st) s += W.repeat;
    if (c.used.has(card.id)) s += W.reuse;
    if (c.fatigue > 0.7) s += W.tired;
    if (w.player.energy < this.T.energy.low) s += W.tired;
    s += this.rng.range(-W.noise, W.noise);
    return s;
  }
  update(dt) {
    const c = this.cur, w = this.w; if (!c) return;
    const n = w.people.get(c.id);
    if (!n || !n.present) { this.end('left'); return; }
    if (n.speaking && w.t > (n.speakUntil || 0)) n.speaking = false;
    if (w.hour >= n.leave + 0.15 && !c.pending) { this.line(n, null, 'leave'); this.end('left'); return; }
    if (c.pending && w.t >= c.pending.at) { const p = c.pending; c.pending = null; w.player.speaking = false; this.resolve(n, p.card); }
  }
  resolve(n, card) {
    const c = this.cur, w = this.w, T = this.T.talk, TT = this.T;
    c.turns++;
    const act = card.act;
    let react;
    if (act === 'contact') { react = this.tryContact(n); this.line(n, card, react); }
    else if (act === 'deal') { react = this.tryDeal(n); this.line(n, card, react); }
    else if (act === 'photo') { react = this.selfie(n); this.line(n, card, react); }
    else {
      const s = this.score(n, card);
      react = s >= T.good ? 'good' : s <= T.bad ? 'bad' : 'meh';
      let dw = react === 'good' ? T.warmGood + clamp(s - T.good, 0, 3) * 0.02 : react === 'meh' ? T.warmMeh : T.warmBad;
      if (react === 'good' && n.rapport < this.gate(n)) dw *= 0.6;       // закрытый раскрывается медленно
      n.rapport = clamp(n.rapport + dw, -0.3, 1);
      if (react === 'good') { c.streak = 0; n.feel = clamp(n.feel + 0.08, -1, 1); }
      else if (react === 'bad') { c.streak++; n.feel = clamp(n.feel - 0.1, -1, 1); w.addEnergy(-TT.energy.bad); }
      if (act === 'hello') { if (react === 'bad') { this.ladder(n, STEP.HELLO); this.line(n, card, 'bad'); } else this.hello(n, card); }
      else if (react === 'good' && card.topic && n.topics.includes(card.topic)) {
        c.hits.add(card.topic);
        if (n.step >= STEP.TALKED && n.step < STEP.COMMON) { n.commonTopic = card.topic; this.ladder(n, STEP.COMMON); this.line(n, card, 'reveal'); }
        else this.line(n, card, react);
      } else this.line(n, card, react);
    }
    n.energy = clamp(n.energy - 0.01, 0, 1);
    c.fatigue += (react === 'good' ? 0.7 : react === 'bad' ? 1.4 : 1) / c.patience;
    c.last = card; c.used.add(card.id);
    if (!c.opened && n.rapport >= this.gate(n) + 0.15 && n.traits.open < 0.45) { c.opened = true; this.line(n, card, 'open'); }
    // раскрытие карточки: по одному полю за ход
    for (const f of FIELDS) if (!n.known[f] && n.rapport >= this.thr(n, f)) { this.reveal(n, f); if (f === 'need') this.needLine(n); break; }
    if (n.rapport >= T.talked && n.step >= STEP.HELLO) this.ladder(n, STEP.TALKED);
    // срыв / усталость
    if (c.streak >= T.failStreak || n.rapport <= T.failWarm) {
      n.cold = w.t + T.coldSec; this.line(n, card, 'leave'); this.end('fail'); return;
    }
    if (c.fatigue >= 1) { n.cold = w.t + T.coldSec * 0.5; this.line(n, card, 'leave'); this.end('tired'); return; }
    this.offerCards(n);
  }
  tryContact(n) {
    const w = this.w, T = this.T;
    if (n.step >= STEP.CONTACT) return 'meh';
    if (n.step >= STEP.TALKED && n.rapport >= this.contactThr(n)) {
      this.ladder(n, STEP.CONTACT);
      for (const f of ['name', 'job']) if (!n.known[f]) this.reveal(n, f);
      n.rapport = clamp(n.rapport + 0.05, -0.3, 1);
      w.bus.emit('toast', { icon: 'phone', text: `${T.text.contact} ${n.name}`, tone: 's4' });
      return 'contact';
    }
    n.rapport -= 0.04; return 'meh';
  }
  // «договорились»: есть что дать друг другу (нужда ↔ предложение) или общая тема
  dealWhy(n) {
    const P = this.w.player;
    if (n.need && n.need === P.offer) return 'need';
    if (n.offer && n.offer === P.need) return 'offer';
    if (n.topics.some(t => P.topics.includes(t))) return 'topic';
    return null;
  }
  tryDeal(n) {
    const w = this.w, T = this.T;
    if (n.step === STEP.CONTACT && n.rapport >= T.talk.deal && this.dealWhy(n)) {
      this.ladder(n, STEP.DEAL);
      if (!n.known.need) this.reveal(n, 'need');
      w.bus.emit('toast', { icon: 'handshake', text: `${T.text.deal} ${n.name}`, tone: 's5' });
      return 'deal';
    }
    n.rapport -= 0.03; return 'meh';
  }
  selfie(n) {
    if (n.selfie) return 'meh';
    n.selfie = true; n.rapport = clamp(n.rapport + this.T.talk.selfie, -0.3, 1);
    this.w.score.onSelfie(n);
    this.w.bus.emit('toast', { icon: 'camera', text: this.T.text.selfie });
    return 'good';
  }
  reveal(n, f) {
    if (n.known[f]) return;
    n.known[f] = true;
    if (f === 'job') n.known.role = true;
    this.w.bus.emit('reveal', { id: n.id, field: f });
  }
  ladder(n, step) {
    if (n.step >= step) return;
    n.step = step;
    this.w.bus.emit('ladder', { id: n.id, step });
    this.w.score.onLadder(n, step);
  }
  // ─────────── реплики ───────────
  draw(key, arr) {
    let d = this.decks.get(key);
    if (!d || d.src !== arr) { d = { src: arr, order: this.rng.shuffle(arr.map((_, i) => i)), i: 0 }; this.decks.set(key, d); }
    if (d.i >= d.order.length) { d.order = this.rng.shuffle(d.order); d.i = 0; }
    return arr[d.order[d.i++]];
  }
  vars(n, topic) {
    const w = this.w, tt = topic && w.idx.TOPICS[topic], need = n.need && w.idx.NEEDS[n.need];
    return { name: n.name, job: n.job, topic: tt?.title || '', me: w.player.name, need: need?.seek?.title || '', other: this.other || '' };
  }
  say1(n, text, react, topic) {
    const w = this.w;
    n.speaking = true; n.speakUntil = w.t + 2;
    w.bus.emit('talk:line', { who: n.id, text: tpl(text, this.vars(n, topic || n.commonTopic || n.topics[0])), mood: react });
  }
  // LINES[тема]?.[реакция] → LINES[стиль] → LINES[склад.talk] → LINES.any; у чудиков — свои строки
  line(n, card, react) {
    const w = this.w, LN = w.C.LINES || {};
    let arr = null, key = null;
    const topic = card?.topic || (react === 'reveal' ? n.commonTopic : null) || n.commonTopic || n.topics[0];
    if (n.oddball && (react === 'good' || react === 'meh') && this.rng.chance(0.6)) {
      const L0 = w.idx.ODDBALLS[n.oddball]?.lines; arr = Array.isArray(L0) ? L0 : L0?.[react]; key = 'odd:' + n.oddball;
    }
    if (react === 'open' && !arr?.length) { arr = this.moodOf(n).openLines; key = 'open:' + n.mood; }
    if (!arr?.length && card?.topic) { arr = LN[card.topic]?.[react]; key = card.topic + ':' + react; }
    if (!arr?.length && card?.style) { arr = LN[card.style]?.[react]; key = card.style + ':' + react; }
    const talk = this.mindOf(n).talk;
    if (!arr?.length && talk && LN[talk]) { arr = LN[talk][react]; key = talk + ':' + react; }
    if (!arr?.length) { arr = LN.any?.[react] || LN.default?.[react]; key = 'any:' + react; }
    if (!arr?.length) return;
    this.say1(n, this.draw(key, arr), react, topic);
  }
  needLine(n) {
    const N = n.need && this.w.idx.NEEDS[n.need], O = n.offer && this.w.idx.NEEDS[n.offer];
    const arr = (N?.seekLines?.length ? N.seekLines : null) || O?.offerLines;
    if (arr?.length) this.say1(n, this.draw('need:' + (N ? n.need : n.offer), arr), 'reveal');
  }

  // ─────────── «познакомить с…» ───────────
  key(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }
  introduce(aId, bId, fromCard = false) {
    const w = this.w, T = this.T, P = w.player;
    const a = w.people.get(aId), b = w.people.get(bId);
    if (!a || !b || a === b || !a.present || !b.present) return false;
    const key = this.key(aId, bId);
    if (this.pairs.has(key)) { w.bus.emit('toast', { icon: 'users', text: T.text.pairKnown }); return false; }
    if (a.step < STEP.TALKED || b.step < STEP.TALKED) return false;
    const cnt = x => { let k = 0; for (const p of this.pairs) if (p.split('|').includes(x)) k++; return k; };
    if (cnt(aId) >= T.talk.pairMax || cnt(bId) >= T.talk.pairMax) { w.bus.emit('toast', { icon: 'users', text: T.text.pairKnown }); return false; }
    const near = x => this.cur?.id === x.id || Math.hypot(x.x - P.x, x.z - P.z) < 3.5;
    if (!near(a) && !near(b)) { w.bus.emit('toast', { icon: 'walk', text: T.text.pairFar }); return false; }
    if (!fromCard) {
      const cost = T.energy.say * w.dir.drain();
      if (P.energy < cost) { w.bus.emit('toast', { icon: 'battery', text: T.text.noEnergy }); return false; }
      w.addEnergy(-cost);
    }
    let why = null;
    if (a.need && a.need === b.offer) why = 'need';
    else if (b.need && b.need === a.offer) why = 'need';
    else if (a.topics.some(t => b.topics.includes(t))) why = 'topic';
    if ((a.ties[b.id] || 0) > 0.3 && why !== 'need') { w.bus.emit('toast', { icon: 'users', text: T.text.pairKnown }); return false; }
    // общая тема — не гарантия: заходит чаще у общительных
    if (why === 'topic' && !this.rng.chance(0.35 + 0.4 * (a.traits.social + b.traits.social) / 2)) why = null;
    if (!why) {
      a.rapport -= 0.05; b.rapport -= 0.05;
      w.bus.emit('toast', { icon: 'meh', text: T.text.pairFail });
      return false;
    }
    this.pairs.add(key);
    a.ties[b.id] = b.ties[a.id] = 1;
    a.rapport = clamp(a.rapport + 0.08, -0.3, 1); b.rapport = clamp(b.rapport + 0.08, -0.3, 1);
    const topic = why === 'topic' ? a.topics.find(t => b.topics.includes(t)) : null;
    const need = why === 'need' ? (a.need && a.need === b.offer ? a.need : b.need) : null;
    // тот, кто не в разговоре с игроком и общительнее, идёт к другому
    const mover = this.cur?.id === b.id ? a : this.cur?.id === a.id ? b : (a.traits.social >= b.traits.social ? a : b);
    const host = mover === a ? b : a;
    if (mover.state !== 'talk') w.brain.joinTo(mover, host);
    w.bus.emit('pair', { a: aId, b: bId, why, topic, need, deal: need ? w.idx.NEEDS[need]?.deal || null : null });
    const cn = this.cur && (this.cur.id === aId ? a : this.cur.id === bId ? b : null);
    if (cn) { this.other = (cn === a ? b : a).name; this.line(cn, topic ? { topic } : null, 'good'); this.other = ''; }
    w.bus.emit('toast', { icon: 'link', text: `${a.name} + ${b.name}`, tone: 'pair' });
    w.score.onPair(a, b, why, need);
    return true;
  }
}

return { Talk, STEP, FIELDS };
});
