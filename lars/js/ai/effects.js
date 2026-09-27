// Эффекты свободного разговора: модель предлагает, движок решает. Каждый эффект проверяется по белому списку и по
// состоянию мира (что человек реально продаёт и почём, что знает, есть ли место, стоит ли прямо перед тобой…).
// Сразу применяются: доверие (±15 за реплику), слух, отметка «помог / задел», конец разговора.
// Только после подтверждения игрока: покупка, подарок, долг, просьба о помощи, обмен местами, пропустить, подвезти —
// через те же операции мира, что и меню действий (buy, give, shiftPlaces, doAction). DOM не трогает.
'use strict';
L.def('ai/effects', () => {
const { clamp } = L.use('core');
const { NEED_ICON } = L.use('sim/rules');
const { abilities } = L.use('ai/prompt');

const fmt = n => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const TRUST_MAX = 15;
// цель для операций мира: доверие и имя — по ключу человека
const target = (tg, per) => ({ ...tg, npc: per.trustKey, who: tg.who || null });
const note = s => String(s || '').replace(/[«»"<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
const dayOf = w => Math.floor(w.clock.t / 86400);
const actionById = (w, id) => w.C.ACTIONS.find(a => a.id === id);

// out — ответ модели; → { chips, offers, end, dropped }
function judge(w, per, tg, out) {
  const ab = abilities(w, per), res = { chips: [], offers: [], end: false, dropped: [] };
  const seen = new Set(), list = Array.isArray(out && out.effects) ? out.effects.slice(0, 5) : [];
  const drop = (e, why) => res.dropped.push((e && e.type) + ': ' + why);
  for (const e of list) {
    if (!e || typeof e.type !== 'string') { drop(e, 'нет типа'); continue; }
    if (seen.has(e.type)) { drop(e, 'повтор'); continue; }
    seen.add(e.type);
    const o = offer(w, per, ab, e);
    if (o && o.why) { drop(e, o.why); continue; }
    switch (e.type) {
      case 'trust': {
        const v = clamp(Math.round(+e.value || 0), -TRUST_MAX, TRUST_MAX); if (!v) break;
        w.addTrust(per.trustKey, v); res.chips.push({ icon: 'handshake', text: per.name + ' ' + (v > 0 ? '+' : '−') + Math.abs(v), tone: v > 0 ? 1 : -1 });
        break;
      }
      case 'rumour': {
        const r = ab.rumours.find(x => x.id === e.rumour); if (!r) { drop(e, 'не знает'); break; }
        if (w.learn(r.id)) res.chips.push({ icon: r.icon || 'ear', text: r.text, tone: 0, rumour: r.id });
        break;
      }
      case 'helped': case 'harmed': {
        const s = note(e.note); if (!s) { drop(e, 'пусто'); break; }
        const text = per.name + ' — ' + s;
        w.ledgerAdd(e.type, text, e.type === 'helped' ? 'heart' : 'alert');
        res.chips.push({ icon: e.type === 'helped' ? 'heart' : 'alert', text: (e.type === 'helped' ? 'помог: ' : 'задел: ') + s, tone: e.type === 'helped' ? 1 : -1 });
        break;
      }
      case 'end': res.end = true; break;
      default:
        if (o) { if (res.offers.length < 3) res.offers.push(o); } else drop(e, 'не из списка');
    }
  }
  return res;
}

// предложение, требующее подтверждения: { type, label, icon, chips, … } | { why } | null (не предложение)
function offer(w, per, ab, e) {
  const p = w.player, sel = per.seller, g = e.good ? w.goods.get(e.good) : null;
  switch (e.type) {
    case 'sell': {
      if (!sel || !(ab.sell || ab.free)) return { why: 'не продаёт' };
      if (!g || !sel.goods.includes(e.good)) return { why: 'нет товара' };
      if (!g.service && (sel.stock[e.good] ?? 0) < 1) return { why: 'кончилось' };
      const mkt = w.econ.price(sel, e.good, w.trustOf(sel.npc));
      const price = mkt === 0 ? 0 : w.econ.round(clamp(+e.value || mkt, mkt * 0.7, mkt * 1.3));
      return { type: 'sell', good: e.good, price, icon: 'cart', label: (price ? 'Купить' : 'Взять') + ' «' + g.name + '»' + (price ? ' · ' + fmt(price) + ' ₽' : ''),
        chips: [price ? { icon: 'cash', text: '−' + fmt(price) + ' ₽', tone: -1 } : { icon: 'heart', text: 'даром', tone: 1 }, { icon: g.icon, text: '+1', tone: 1 }] };
    }
    case 'give': {
      if (ab.trust < 0) return { why: 'не доверяет' };
      if (!g || !ab.gifts.includes(e.good)) return { why: 'нечего дать' };
      if (p.flags['ai:gift:' + per.key] === dayOf(w)) return { why: 'уже дарил сегодня' };
      return { type: 'give', good: e.good, icon: 'gift', label: 'Взять «' + g.name + '»', chips: [{ icon: g.icon, text: '+1', tone: 1 }] };
    }
    case 'lend': {
      if (!ab.lend) return { why: 'мало доверия' };
      if (p.flags['ai:lend:' + per.key]) return { why: 'уже одалживал' };
      const v = clamp(Math.round((+e.value || 500) / 100) * 100, 100, 1000);
      return { type: 'lend', value: v, icon: 'wallet', label: 'Взять в долг ' + fmt(v) + ' ₽', chips: [{ icon: 'cash', text: '+' + fmt(v) + ' ₽', tone: 1 }] };
    }
    case 'ask_help': {
      if (g && (p.items[e.good] || 0) > 0) return { type: 'ask_help', good: e.good, note: note(e.note), icon: 'gift', label: 'Дать «' + g.name + '»', chips: [{ icon: g.icon, text: '−1', tone: -1 }, { icon: 'heart', text: 'помочь', tone: 1 }] };
      const v = clamp(Math.round((+e.value || 0) / 100) * 100, 0, 2000);
      if (v > 0 && p.money.rub_cash >= v) return { type: 'ask_help', good: 'money', value: v, note: note(e.note), icon: 'cash', label: 'Дать ' + fmt(v) + ' ₽', chips: [{ icon: 'cash', text: '−' + fmt(v) + ' ₽', tone: -1 }, { icon: 'heart', text: 'помочь', tone: 1 }] };
      return { why: 'нечем помочь' };
    }
    case 'swap': {
      if (!ab.swap) return { why: 'не впереди' };
      const price = Math.round(clamp(+e.value || ab.swapPrice, ab.swapPrice * 0.5, ab.swapPrice * 1.5) / 100) * 100;
      if (p.money.rub_cash < price) return { why: 'мало денег' };
      return { type: 'swap', price, icon: 'swap', label: 'Поменяться · ' + fmt(price) + ' ₽', chips: [{ icon: 'cash', text: '−' + fmt(price) + ' ₽', tone: -1 }, { icon: 'car', text: '+1 место', tone: 1 }] };
    }
    case 'let_ahead':
      if (!ab.letAhead) return { why: 'не позади' };
      return { type: 'let_ahead', icon: 'arrowUp', label: 'Пропустить вперёд', chips: [{ icon: 'car', text: '−1 место', tone: -1 }, { icon: 'handshake', text: '+12', tone: 1 }] };
    case 'lift':
      if (!ab.lift) return { why: 'нельзя подвезти' };
      return { type: 'lift', icon: 'car', label: 'Подвезти', chips: [{ icon: 'user', text: '+пассажир', tone: 1 }] };
  }
  return null;
}

// игрок согласился → { chips, out?, fail? } (перепроверка: мир мог измениться)
function accept(w, per, tg, o) {
  const again = offer(w, per, abilities(w, per), { type: o.type, good: o.good === 'money' ? null : o.good, value: o.price ?? o.value, note: o.note });
  if (!again || again.why) return { chips: [], out: again?.why || 'уже нельзя', fail: true };
  const p = w.player, T = target(tg, per), chips = [];
  switch (o.type) {
    case 'sell': {
      const sel = per.seller, opts = w.econ.payOptions(p, sel, o.good, o.price).filter(x => x.ok);
      if (!opts.length) return { chips, out: 'Не хватает денег', fail: true };
      const r = w.buy(sel, o.good, opts[0]); if (!r) return { chips, out: 'Не вышло', fail: true };
      return { chips: r.chips, out: r.out };
    }
    case 'give': {
      const g = w.goods.get(o.good), sel = per.seller;
      if (g.service && g.use) for (const k in g.use.needs) { w.addNeed(k, g.use.needs[k]); chips.push({ icon: NEED_ICON[k], text: '+' + g.use.needs[k], tone: 1 }); }
      else { w.addItem(o.good, 1); chips.push({ icon: g.icon, text: '+1 ' + g.name.toLowerCase(), tone: 1 }); if (sel && sel.stock[o.good] != null) sel.stock[o.good] = Math.max(0, sel.stock[o.good] - 1); }
      p.flags['ai:gift:' + per.key] = dayOf(w);
      w.ledgerAdd('got', g.name + ' от ' + per.name, 'gift');
      return { chips };
    }
    case 'lend': {
      w.addMoney('rub_cash', o.value); p.flags['ai:lend:' + per.key] = 1;
      w.ledgerAdd('got', fmt(o.value) + ' ₽ в долг от ' + per.name, 'wallet');
      return { chips: [{ icon: 'cash', text: '+' + fmt(o.value) + ' ₽', tone: 1 }] };
    }
    case 'ask_help': {
      const r = o.good === 'money' ? w.give(T, 'money', o.value) : w.give(T, o.good, 1);
      return r ? { chips: r.chips, out: r.out } : { chips, out: 'Нечего дать', fail: true };
    }
    case 'swap': {
      w.addMoney('rub_cash', -o.price); chips.push({ icon: 'cash', text: '−' + fmt(o.price) + ' ₽', tone: -1 });
      const k = w.shiftPlaces(1); chips.push({ icon: 'car', text: '+' + k + ' место', tone: 1 });
      w.addTrust(per.trustKey, 3); w.ledgerAdd('gave', fmt(o.price) + ' ₽ за место (' + per.name + ')');
      return { chips };
    }
    case 'let_ahead': { const r = w.doAction(actionById(w, 'letAhead'), T); return { chips: r.chips }; }
    case 'lift': { const r = w.doAction(actionById(w, 'lift'), T); return r.chips.length ? { chips: r.chips } : { chips, out: 'Не вышло', fail: true }; }
  }
  return { chips, fail: true };
}
return { judge, offer, accept, TRUST_MAX };
});
