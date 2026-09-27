// Язык данных: условия (when/need/tgt) и эффекты (fx) — общие для событий, действий и ответов в телефоне.
// Схема описана в шапке js/content/events.js. Здесь — исполнение.
'use strict';
L.def('sim/rules', () => {
const { tpl, money: fmtMoney } = L.use('core');

const NEED_ICON = { hunger: 'food', thirst: 'water', warmth: 'fire', sleep: 'moon', nerves: 'heart', charge: 'battery' };
const NEED_NAME = { hunger: 'сытость', thirst: 'вода', warmth: 'тепло', sleep: 'сон', nerves: 'спокойствие', charge: 'заряд' };

// '>=5' | '<30' | 5 → (v) => bool
function cmp(spec, v) {
  if (typeof spec === 'number') return v >= spec;
  if (typeof spec === 'boolean') return !!v === spec;
  const m = /^(>=|<=|>|<|==|!=)?\s*(-?[\d.]+)$/.exec(String(spec)); if (!m) return true;
  const x = +m[2];
  switch (m[1]) { case '>': return v > x; case '<': return v < x; case '<=': return v <= x; case '==': return v === x; case '!=': return v !== x; default: return v >= x; }
}
const arr = x => Array.isArray(x) ? x : [x];
function inRange(v, [a, b]) { return a <= b ? v >= a && v <= b : v >= a || v <= b; }

// check(cond, w, ctx) → '' (ок) | причина (коротко, для серой кнопки)
function check(c, w, ctx = {}) {
  if (!c) return '';
  const p = w.player;
  if (c.days) { const d = w.clock.date().d; if (!inRange(d, c.days)) return 'не сегодня'; }
  if (c.hours && !inRange(w.clock.hour, c.hours)) return 'не сейчас';
  if (c.rule) for (const r of arr(c.rule)) { const neg = r[0] === '!', id = neg ? r.slice(1) : r; if (w.env.rule(id) === neg) return 'правило'; }
  if (c.flag) for (const f of arr(c.flag)) { const neg = f[0] === '!', id = neg ? f.slice(1) : f; if (!!p.flags[id] === neg) return ''+(neg ? 'уже' : 'нет'); }
  if (c.need) for (const k in c.need) if (!cmp(c.need[k], p.needs[k])) return k === 'charge' ? 'телефон сел' : 'нет сил';
  if (c.money) for (const k in c.money) if (!cmp(c.money[k], p.money[k] || 0)) return 'мало денег';
  if (c.item) {
    if (typeof c.item === 'string') { if (!(p.items[c.item] > 0)) return 'нет ' + (w.econ.goods.get(c.item)?.name || c.item); }
    else for (const k in c.item) if (!cmp(c.item[k], p.items[k] || 0)) return 'нет: ' + (w.econ.goods.get(k)?.name || k);
  }
  if (c.kpp && !inRange(w.playerKpp() / 1000, c.kpp)) return 'не здесь';
  if (c.near && !w.isNear(c.near)) return 'далеко';
  if (c.inCar != null && !!p.inCar !== c.inCar) return c.inCar ? 'не в машине' : 'в машине';
  if (c.weather && !arr(c.weather).includes(w.env.weather())) return 'погода';
  if (c.night != null && w.env.night() !== c.night) return c.night ? 'днём' : 'ночью';
  if (c.trust) for (const k in c.trust) if (!cmp(c.trust[k], w.trustOf(k === 'npc' ? ctx.npc : k))) return 'мало доверия';
  if (c.fuel != null && !cmp(c.fuel, w.playerCar()?.fuel ?? 0)) return 'нет бензина';
  if (c.passengers != null && !cmp(c.passengers, p.passengers.length)) return 'нет мест';
  if (c.rumour && !p.knows.has(c.rumour)) return 'не слышал';
  if (c.role && w.role.id !== c.role) return 'не ты';
  if (c.chance != null && ctx.roll && !w.rng.chance(c.chance)) return 'повезёт позже';
  return '';
}

// Что fx «требует», чтобы кнопка была честной: отнимаемые деньги/вещи/топливо
function fxNeeds(fx, w) {
  if (!fx) return '';
  const p = w.player;
  if (fx.money) for (const k in fx.money) if (fx.money[k] < 0 && (p.money[k] || 0) < -fx.money[k]) return 'мало денег';
  if (fx.items) for (const k in fx.items) if (fx.items[k] < 0 && (p.items[k] || 0) < -fx.items[k]) return 'нет: ' + (w.econ.goods.get(k)?.name || k);
  if (fx.buy) { const pr = buyPrice(fx.buy, w); const cur = fx.buy.good === 'escort' ? 'usd' : 'rub_cash'; const need = cur === 'usd' ? Math.ceil(pr / w.env.rates().usd) : pr; if ((p.money[cur] || 0) < need) return 'мало денег'; }
  if (fx.fuel < 0 && (w.playerCar()?.fuel ?? 0) < -fx.fuel) return 'нет бензина';
  if (fx.passenger && p.passengers.length >= (w.playerCar()?.seats ?? 1) - 1) return 'нет мест';
  return '';
}
function buyPrice(b, w) { return Math.round(w.econ.market(b.good) * (b.qty || 1) * (b.mul ?? 1) / 100) * 100 || w.econ.market(b.good); }
function priceLabel(fx, w) {
  if (!fx?.buy) return '';
  const pr = buyPrice(fx.buy, w);
  return fx.buy.good === 'escort' ? '$' + Math.ceil(pr / w.env.rates().usd) : fmtMoney(pr);
}

// apply(fx, w, ctx) → { chips: [{icon, text, tone}], out?, end?, event? }
function apply(fx, w, ctx = {}) {
  const res = { chips: [] }; if (!fx) return res;
  const p = w.player, chip = (icon, text, tone = 0) => res.chips.push({ icon, text, tone });
  const vars = ctx.vars || {};
  if (fx.risk && w.rng.chance(fx.risk.p)) { const r = apply(fx.risk.fx, w, ctx); r.out = fx.risk.out; r.risky = true; return r; }
  if (fx.buy) {
    const pr = buyPrice(fx.buy, w);
    if (fx.buy.good === 'escort') { const usd = Math.ceil(pr / w.env.rates().usd); w.addMoney('usd', -usd); chip('dollar', '−$' + usd, -1); }
    else { w.addMoney('rub_cash', -pr); chip('cash', '−' + fmtMoney(pr), -1); }
  }
  if (fx.money) for (const k in fx.money) { const v = fx.money[k]; if (!v) continue; w.addMoney(k, v); chip(k === 'usd' ? 'dollar' : k === 'rub_card' ? 'card' : 'cash', (v > 0 ? '+' : '−') + fmtMoney(Math.abs(v), k), v > 0 ? 1 : -1); }
  if (fx.needs) for (const k in fx.needs) { const v = fx.needs[k]; if (!v) continue; w.addNeed(k, v); chip(NEED_ICON[k], (v > 0 ? '+' : '−') + Math.abs(v), v > 0 ? 1 : -1); }
  if (fx.items) for (const k in fx.items) { const v = fx.items[k]; if (!v) continue; w.addItem(k, v); const g = w.econ.goods.get(k); chip(g?.icon || 'bag', (v > 0 ? '+' : '−') + Math.abs(v) + ' ' + (g?.name || k).toLowerCase(), v > 0 ? 1 : -1); }
  if (fx.fuel) { const c = w.playerCar(); if (c) { c.fuel = Math.max(0, Math.min(w.role.car?.tank || 60, c.fuel + fx.fuel)); chip('fuel', (fx.fuel > 0 ? '+' : '−') + Math.abs(fx.fuel) + ' л', fx.fuel > 0 ? 1 : -1); } }
  if (fx.trust) for (const k in fx.trust) {
    const id = k === 'npc' || k === 'target' ? ctx.npc : k; if (!id) continue;
    const v = fx.trust[k]; w.addTrust(id, v);
    chip('handshake', (w.nameOf(id) || '') + ' ' + (v > 0 ? '+' : '−') + Math.abs(v), v > 0 ? 1 : -1);
  }
  if (fx.flag) for (const k in fx.flag) p.flags[k] = fx.flag[k];
  if (fx.rumour && !p.knows.has(fx.rumour)) { w.learn(fx.rumour); chip('ear', 'слух', 0); }
  if (fx.places) { const n = w.shiftPlaces(fx.places); if (n) chip('car', (n > 0 ? '+' : '−') + Math.abs(n) + ' место', n > 0 ? 1 : -1); }
  if (fx.advance) { const km = w.advance(fx.advance); chip('arrowUp', '+' + km.toFixed(1).replace('.', ',') + ' км', 1); }
  if (fx.passenger) { const id = fx.passenger === 'npc' ? ctx.npc : fx.passenger; if (w.addPassenger(id || ctx.who)) chip('user', '+пассажир', 1); }
  if (fx.msg) w.phoneMsg(fx.msg.chat, tpl(fx.msg.text, { ...vars, km: (w.playerKpp() / 1000).toFixed(1) }), 'me');
  if (fx.time) { w.skipTime(fx.time); chip('clock', fx.time + ' мин', 0); }
  if (fx.helped) { const s = tpl(fx.helped, vars); w.ledgerAdd('helped', s, ctx.icon); chip('heart', 'помог: ' + s, 1); }
  if (fx.harmed) { const s = tpl(fx.harmed, vars); w.ledgerAdd('harmed', s, ctx.icon); chip('alert', 'задел: ' + s, -1); }
  if (fx.gave) for (const s of fx.gave) w.ledgerAdd('gave', tpl(s, vars));
  if (fx.got) for (const s of fx.got) w.ledgerAdd('got', tpl(s, vars));
  if (fx.end) res.end = fx.end;
  if (fx.event) res.event = fx.event;
  return res;
}
return { NEED_ICON, NEED_NAME, check, fxNeeds, buyPrice, priceLabel, apply };
});
