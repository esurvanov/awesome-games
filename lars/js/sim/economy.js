// Экономика: продавцы у дороги, живые цены, оплата разными способами, спрос от толпы и слухов.
// Цена = base (в ₽ по курсу дня) × день (кривая m[] | prices) × правила × слухи × спрос у продавца × наценка
//        × доверие × рост по часам × вечер. Бесплатные точки (priceMul 0) — волонтёры.
'use strict';
L.def('sim/economy', () => {
const { clamp, DAY, HOUR } = L.use('core');

const PAY = {
  cash_rub: { wallet: 'rub_cash', label: 'наличные ₽', icon: 'cash' },
  transfer_rub: { wallet: 'rub_card', label: 'перевод', icon: 'card', phone: true },
  card_mir: { wallet: 'rub_card', label: 'карта', icon: 'card' },
  cash_usd: { wallet: 'usd', label: 'доллары', icon: 'dollar' },
  cash_gel: { wallet: 'gel', label: 'лари', icon: 'cash' },
};

class Economy {
  constructor(C, env, road, rng) {
    this.C = C; this.env = env; this.road = road; this.rng = rng; this.E = C.TUNING.econ;
    this.goods = new Map(C.GOODS.map(g => [g.id, g]));
    this.sellers = [];
    this.rumourDemand = {}; // id|cat → множитель (обновляет мир из слухов)
    this.history = {};      // good → [цены по часам у ближайшего к игроку продавца]
  }
  build(npcById) {
    const C = this.C, R = this.rng, st = C.ROUTE.stalls;
    // именные
    for (const p of C.PEOPLE) if (p.kind === 'seller') this.add({
      id: p.id, npc: p.id, name: p.name, s: p.place.s * 1000, side: p.place.side || 1, goods: p.sells, priceMul: p.priceMul ?? 1,
      accepts: p.accepts || ['cash_rub'], stock: p.stock || {}, hourly: p.hourly || 0, evening: p.evening || null,
      from: p.from ? this.env.clock.parse(p.from) : 0, icon: p.icon,
    });
    // безымянные: у посёлков и вдоль дороги
    let k = 0;
    const mk = s => {
      const goods = st.goods.filter(() => R.chance(0.55)); if (goods.length < 2) goods.push('water', 'snack');
      this.add({ id: 'st' + (k++), npc: null, name: R.pick(['Ларёк', 'Местные', 'С багажника', 'Бабушка', 'Кафе']), s, side: R.chance(0.5) ? 1 : -1,
        goods: [...new Set(goods)], priceMul: R.range(st.priceMul[0], st.priceMul[1]), accepts: st.accepts, stock: {}, hourly: R.chance(0.3) ? 0.02 : 0, evening: null, from: 0, icon: 'seller' });
    };
    for (const pl of C.ROUTE.places) if (pl.kind === 'village') for (let i = 0; i < st.perVillage; i++) mk(pl.s * 1000 + R.range(-350, 350));
    const L = this.road.len;
    for (let s = 600; s < L; s += 1000 / Math.max(0.01, st.perKmRoad)) mk(s + R.range(-200, 200));
    this.sellers.sort((a, b) => a.s - b.s);
  }
  add(o) {
    o.demand = {}; o.stock0 = {}; o.sold = 0; o.earned = 0;
    for (const g of o.goods) { const n = o.stock[g] ?? (this.goods.get(g)?.service ? 999 : 40); o.stock[g] = n; o.stock0[g] = n; o.demand[g] = 1; }
    const p = this.road.at(o.s, o.side * 11); o.x = p.x; o.y = p.y;
    this.sellers.push(o);
  }
  active(sel, t = this.env.clock.t) { return t >= sel.from; }
  // ближайший (по s) активный продавец, продающий good (или любой)
  nearest(s, good = null, maxD = 3000) {
    let best = null, bd = maxD;
    for (const o of this.sellers) {
      const d = Math.abs(o.s - s); if (d >= bd) continue;
      if (!this.active(o)) continue;
      if (good && (!o.goods.includes(good) || o.stock[good] <= 0)) continue;
      best = o; bd = d;
    }
    return best;
  }
  baseRub(g, t) { const r = this.env.rates(t); return g.cur === 'USD' ? g.base * r.usd : g.cur === 'GEL' ? g.base * r.gel : g.base; }
  // рыночная цена товара «вообще» (без продавца) — для событий
  market(goodId, t = this.env.clock.t) {
    const g = this.goods.get(goodId); if (!g) return 0;
    return this.round(this.baseRub(g, t) * this.env.dayMul(g, t) * this.env.ruleDemand(g) * this.rumourMul(g));
  }
  rumourMul(g) { return (this.rumourDemand[g.id] ?? 1) * (this.rumourDemand[g.cat] ?? 1) * (this.rumourDemand['*'] ?? 1); }
  price(sel, goodId, trust = 0, t = this.env.clock.t) {
    const g = this.goods.get(goodId); if (!g || !sel) return 0;
    if (sel.priceMul === 0) return 0;
    const h = (t % DAY) / HOUR;
    let p = this.baseRub(g, t) * this.env.dayMul(g, t) * this.env.ruleDemand(g) * this.rumourMul(g) * (sel.demand[goodId] || 1) * sel.priceMul;
    if (sel.npc) p *= 1 - clamp(trust, -100, 100) * this.E.trustPrice;
    if (sel.hourly && (g.cat === 'food' || g.cat === 'drink')) p *= Math.min(1.35, 1 + sel.hourly * Math.max(0, h - 6)); // растёт с утра, к вечеру ≈ ×1,35
    if (sel.evening && h >= sel.evening.from) p *= sel.evening.mul;
    return this.round(p);
  }
  round(p) { return p < 1000 ? Math.max(10, Math.round(p / 10) * 10) : Math.round(p / 100) * 100; }
  // способы оплаты суммы rub у продавца (accepts ∩ pay товара)
  payOptions(player, sel, goodId, rub) {
    const g = this.goods.get(goodId), r = this.env.rates(), out = [];
    const methods = (g?.pay || ['cash_rub']).filter(m => !sel || sel.accepts.includes(m));
    if (rub === 0) return [{ method: 'free', ok: true, cost: {}, label: 'бесплатно' }];
    for (const m of methods) {
      const P = PAY[m]; if (!P) continue;
      let amount = rub, cur = P.wallet, why = '';
      if (m === 'cash_usd') amount = Math.ceil(rub / (r.usd * (1 - this.E.spread)));
      if (m === 'cash_gel') amount = Math.ceil(rub / (r.gel * r.gelStreet));
      let ok = (player.money[cur] || 0) >= amount;
      if (!ok) why = 'мало';
      if (P.phone && player.needs.charge < 3) { ok = false; why = 'телефон сел'; }
      if (P.phone && this.world && !this.world.signal()) { ok = false; why = 'нет сети'; }
      out.push({ method: m, cur, amount, ok, why, label: P.label, icon: P.icon });
    }
    return out;
  }
  // обмен $ → ₽ у продавца (с рук, хуже официального)
  usdRate() { const r = this.env.rates(); return Math.floor(r.usd * (1 - this.E.spread)); }
  // продажа (любой покупатель): спрос растёт, склад убывает
  sold(sel, goodId, n = 1, rub = 0) {
    if (!sel.stock[goodId] && sel.stock[goodId] !== 0) return;
    const g = this.goods.get(goodId);
    if (!g?.service) sel.stock[goodId] = Math.max(0, sel.stock[goodId] - n);
    sel.demand[goodId] = Math.min(this.E.demandMax, (sel.demand[goodId] || 1) + this.E.demandUp * n);
    sel.sold += n; sel.earned += rub;
  }
  // раз в «пачку» (dtH часов): спрос возвращается к 1 + толпа, склад пополняется
  relax(dtH, crowdAt) {
    const E = this.E;
    for (const o of this.sellers) {
      const crowd = crowdAt(o.s); // 0..1
      for (const g of o.goods) {
        const target = 1 + crowd * E.crowdDemand;
        o.demand[g] += (target - o.demand[g]) * Math.min(1, E.demandDecay * dtH);
        if (o.stock[g] < o.stock0[g]) o.stock[g] = Math.min(o.stock0[g], o.stock[g] + E.restock * dtH * (o.stock0[g] > 100 ? 3 : 1));
      }
    }
  }
}
return { PAY, Economy };
});
