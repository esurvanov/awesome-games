// Деньги: зарплата, амортизация в полночь, счета раз в 3 дня (✅ TS1: 3 % амортизированной стоимости).
import { MONEY } from '../core/tuning.js';
import { byId } from '../../data/catalog.js';
import { dayOf, notify, nextUid } from './util.js';

export function addMoney(state, bus, delta, reason) {
  const h = state.household;
  h.money = Math.round(h.money + delta);
  bus.emit('money:changed', { money: h.money, delta: Math.round(delta), reason });
}

// Текущая стоимость предмета хранится в obj.st.value (Мозг владеет st)
export function objValue(obj) {
  const def = byId[obj.def];
  if (!def) return 0;
  if (obj.st.value == null) obj.st.value = def.price;
  return obj.st.value;
}

export function depreciate(state) {
  const D = MONEY.depr;
  for (const o of state.objects) {
    const def = byId[o.def];
    if (!def || def.depr === 'none') continue;
    const v = objValue(o);
    if (def.depr === 'art') o.st.value = Math.min(def.price * D.artCap, v + def.price * D.artPerDay);
    else if (!o.st.deprFirst) { o.st.value = v * (1 - (D.first[def.depr] ?? 0.15)); o.st.deprFirst = true; }
    else o.st.value = Math.max(def.price * D.floor, v - def.price * D.perDay);
    o.st.value = Math.round(o.st.value * 100) / 100;
  }
}

export function billAmount(state) {
  let sum = 0;
  for (const o of state.objects) if (byId[o.def]?.bill) sum += objValue(o);
  return Math.round(sum * MONEY.billRate);
}

// Вызывается в полночь: амортизация, счета, коллектор
export function midnight(state, bus) {
  const day = dayOf(state.time.minutes);
  depreciate(state);
  const h = state.household;
  if (day - h.lastBillDay >= MONEY.billEveryDays) {
    h.lastBillDay = day;
    const amount = billAmount(state);
    if (amount > 0) {
      h.bills.push({ id: nextUid(state), amount, day });
      notify(bus, `Пришли счета: §${amount}. Оплатить у почтового ящика.`, '✉️');
      bus.emit('sfx', { name: 'mail' });
    }
  }
  for (const b of [...h.bills]) {
    if (day - b.day >= MONEY.repoAfterDays) {
      const take = Math.round(b.amount * (1 + MONEY.repoPenalty));
      h.bills.splice(h.bills.indexOf(b), 1);
      addMoney(state, bus, -take, 'repo');
      notify(bus, `Коллектор взыскал §${take} по неоплаченному счёту`, '🧾');
      bus.emit('want', { e: { kind: 'event', what: 'repo' } });
    }
  }
}

export function payBills(state, bus) {
  const h = state.household;
  const total = h.bills.reduce((s, b) => s + b.amount, 0);
  if (!total || h.money < total) return false;
  h.bills = [];
  addMoney(state, bus, -total, 'bills');
  notify(bus, `Счета оплачены: §${total}`, '💸');
  return true;
}
