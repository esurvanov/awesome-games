// Счёт вечера: знакомства по ступеням, контакты, «договорились», сведённые пары (× NEEDS.value), общее
// фото, «Альбом легенд» (чудики на ступени ≥ 3 — ODDBALLS.album, события, пары), звание
// (CONTENT.TITLES или TUNING.titles), сообщения «после» (CHAT.after с условиями need), итог для 'end'.
'use strict';
L.def('sim/score', () => {
const { tpl, hhmm } = L.use('core');

class Score {
  constructor(w) {
    this.w = w; this.T = w.T;
    this.met = 0; this.contacts = 0; this.deals = 0; this.common = 0; this.hello = 0;
    this.pairs = [];          // [{ a, b, why, need, at }]
    this.photo = false; this.photoWith = []; this.photoAll = []; this.selfies = 0;
    this.photoEv = false;      // общее фото вообще было (с игроком или без)
    this.album = [];          // [{ kind:'oddball'|'event'|'pair', id, title, icon, at }]
    this.seen = new Set();
    this.log = [];            // [{ at, kind, id, step }]
  }
  update() {}
  onLadder(n, step) {
    const w = this.w;
    if (step === 1) this.hello++;
    if (step === 2) this.met++;
    if (step === 3) this.common++;
    if (step === 4) this.contacts++;
    if (step === 5) this.deals++;
    this.log.push({ at: +w.hour.toFixed(2), kind: 'step', id: n.id, step });
    if (step === 3 && n.oddball) {
      const od = w.idx.ODDBALLS[n.oddball];
      if (od) this.addAlbum('oddball', od.id, od.album?.title || od.title, od.album?.icon || od.icon);
    }
  }
  onPair(a, b, why, need) {
    const value = need ? this.w.idx.NEEDS[need]?.value ?? 1 : 1;
    this.pairs.push({ a: a.id, b: b.id, why, need: need || null, value, at: +this.w.hour.toFixed(2) });
    this.addAlbum('pair', `${a.id}+${b.id}`, `${a.name} + ${b.name}`, 'heart');
  }
  onSelfie() { this.selfies++; }
  onEvent(ev) { this.addAlbum('event', ev.id, ev.title, ev.icon); }
  addAlbum(kind, id, title, icon) {
    const k = kind + ':' + id; if (this.seen.has(k)) return;
    this.seen.add(k); this.album.push({ kind, id, title, icon, at: hhmm(this.w.hour) });
  }
  // снимок общего фото: игрок и люди в радиусе
  onPhoto() {
    const w = this.w, P = w.LAY.photo, R = this.T.photo.radius, me = w.player;
    const on = [];
    for (const n of w.list) if (n.present && Math.hypot(n.x - P.x, n.z - P.z) < R + 1) on.push(n.id);
    this.photoAll = on; this.photoEv = true;
    if (Math.hypot(me.x - P.x, me.z - P.z) < R + 0.5) {
      this.photo = true; this.photoWith = on.filter(id => w.people.get(id).step >= 2);
      w.bus.emit('toast', { icon: 'camera', text: this.T.text.photo });
    }
    w.bus.emit('photo', { on: on.slice(), me: this.photo });   // сборка снимает кадр для итога
  }
  points() {
    const S = this.T.score;
    const odd = this.album.filter(a => a.kind === 'oddball').length;
    const pairs = this.pairs.reduce((s, p) => s + S.pair * (p.value || 1), 0);
    return Math.round(this.met * S.met + this.contacts * S.contact + this.deals * S.deal + pairs + (this.photo ? S.photo : 0) + odd * S.oddball);
  }
  stats() {
    return { met: this.met, hello: this.hello, common: this.common, contacts: this.contacts, deals: this.deals, pairs: this.pairs.length,
      photo: this.photo ? 1 : 0, oddballs: this.album.filter(a => a.kind === 'oddball').length,
      events: this.album.filter(a => a.kind === 'event').length, points: this.points() };
  }
  // звание: последнее из списка, чьи условия выполнены (need: { met, contacts, deals, pairs, photo, oddballs, points })
  title() {
    const list = this.w.C.TITLES || this.T.titles || [];
    const st = this.stats();
    let best = null;
    for (const t of list) if (Object.entries(t.need || {}).every(([k, v]) => (st[k] ?? 0) >= v)) best = t;
    return best ? { id: best.id, title: best.title, icon: best.icon } : null;
  }
  // сообщения «после»: личные (CHAT.after) — от контактов, need 'deal'|'pair' — только если это было с автором;
  // общий чат наутро (CHAT.afterFeed) — need: 'photo' (игрок на фото) | 'photoEv' (фото было) | 'met' | 'lonely'
  // (ни с кем не познакомился) | 'oddball' | 'pair' | 'friend' | id события, которое было; '!x' — «не x»
  afterChat() {
    const w = this.w, rng = w.rng, T = this.T.chat;
    const friends = w.list.filter(n => n.step >= 4), deals = w.list.filter(n => n.step >= 5);
    const paired = new Set(this.pairs.flatMap(p => [p.a, p.b]));
    const odd = this.album.find(a => a.kind === 'oddball');
    const has = { friend: friends.length, pair: this.pairs.length, photo: this.photo, photoEv: this.photoEv, deal: deals.length, oddball: !!odd,
      met: this.met > 0, lonely: this.met === 0 };
    const fits = need => { if (!need) return true; const neg = need[0] === '!', k = neg ? need.slice(1) : need; const v = k in has ? !!has[k] : w.dir.fired.includes(k); return neg ? !v : v; };
    const p = this.pairs.length ? rng.pick(this.pairs) : null, A = p && w.people.get(p.a), B = p && w.people.get(p.b);
    const v = n => ({ name: n?.name || '', friend: n?.name || (friends[0]?.name ?? ''), a: A?.name || '', b: B?.name || '', odd: odd?.title || '', n: w.list.length, me: w.player.name });
    const personal = [];
    const pool = w.dir.chatArr('after');
    for (const n of rng.shuffle(friends.slice())) {
      if (personal.length >= T.after) break;
      const cand = pool.filter(m => !m.need || (m.need === 'deal' && n.step >= 5) || (m.need === 'pair' && paired.has(n.id)) || (m.need === 'friend'));
      if (!cand.length) continue;
      const fresh = cand.filter(m => !personal.some(x => x.id && x.id === m.id));   // одинаковые «спасибо» — не подряд
      const m = rng.pick(fresh.length ? fresh : cand);
      personal.push({ id: m.id || null, kind: 'after', who: 'npc', from: n.name, fromId: n.id, text: tpl(m.text || '', v(n)) });
    }
    const feed = [];
    for (const m of w.dir.chatArr('afterFeed')) {
      if (!fits(m.need)) continue;
      feed.push({ fit: !!m.need, id: m.id || null, kind: 'afterFeed', who: m.who || 'npc', from: null, fromId: null, text: tpl(m.text || '', v(friends.length ? rng.pick(friends) : null)) });
    }
    // сначала — то, что про этот вечер (с условием), потом общие
    const sp = rng.shuffle(feed.filter(m => m.fit)).concat(rng.shuffle(feed.filter(m => !m.fit))).slice(0, T.afterFeed);
    return personal.concat(sp.map(({ fit, ...m }) => m));
  }
  summary() {
    const w = this.w;
    const people = w.list.filter(n => n.step >= 1).sort((a, b) => b.step - a.step || b.rapport - a.rapport).map(n => ({
      id: n.id, name: n.known.name ? n.name : null, job: n.known.job ? n.job : null, role: n.known.job ? n.role : null, step: n.step,
      rapport: +n.rapport.toFixed(2), need: n.known.need ? n.need : null, offer: n.known.need ? n.offer : null,
      topics: n.known.topics ? n.topics.slice() : [], mind: n.known.mind ? n.mind : null, oddball: n.oddball,
      seed: n.seed, lookHints: n.lookHints, look: n.look,
    }));
    return {
      ...this.stats(), title: this.title(), album: this.album.slice(), pairList: this.pairs.slice(),
      photoWith: this.photoWith.slice(), photoEv: this.photoEv, photoN: this.photoAll.length + (this.photo ? 1 : 0), people, chat: this.afterChat(), energy: +w.player.energy.toFixed(2),
      talks: w.talk.log.length, crowd: w.list.length, seed: w.seed, selfies: this.selfies,
    };
  }
}

return { Score };
});
