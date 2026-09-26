'use strict';
// Инвентарь: рюкзак G.inv + лабаз в избе G.chest.
const Inv = (() => {
  // wc — «с лабазом»: считать/брать ещё и из G.chest (герой в избе)
  const cnt = (id, wc) => id === 'food' ? FOOD_KEYS.reduce((s, k) => s + cnt(k, wc), 0) : (G.inv[id] || 0) + (wc ? (G.chest[id] || 0) : 0);
  const has = (id, wc) => cnt(id, wc === undefined ? G.p.inside : wc) > 0;
  function add(id, n = 1) { G.inv[id] = (G.inv[id] || 0) + n; }
  // сначала рюкзак, потом лабаз (если wc)
  function take(id, n, wc) {
    if (id === 'food') { if (cnt('food', wc) < n) return false; for (const k of FOOD_KEYS) while (n > 0 && cnt(k, wc) > 0) { take(k, 1, wc); n--; } return true; }
    const a = Math.min(n, G.inv[id] || 0); G.inv[id] = (G.inv[id] || 0) - a; n -= a;
    if (n > 0 && wc) { const b = Math.min(n, G.chest[id] || 0); G.chest[id] -= b; n -= b; }
    return n === 0;
  }
  // сначала лабаз, потом рюкзак (chestOnly — только лабаз): стройка, посёлок, печь
  function takeStock(id, n, chestOnly) {
    if (id === 'food') {
      if ((chestOnly ? FOOD_KEYS.reduce((s, k) => s + (G.chest[k] || 0), 0) : cnt('food', true)) < n) return false;
      for (const src of chestOnly ? [G.chest] : [G.chest, G.inv]) for (const k of FOOD_KEYS) while (n > 0 && (src[k] || 0) > 0) { src[k]--; n--; }
      return true;
    }
    const a = Math.min(n, G.chest[id] || 0); G.chest[id] = (G.chest[id] || 0) - a; n -= a;
    if (n > 0 && !chestOnly) { const b = Math.min(n, G.inv[id] || 0); G.inv[id] = (G.inv[id] || 0) - b; n -= b; }
    return n === 0;
  }
  const payStock = cost => { for (const [k, v] of Object.entries(cost)) takeStock(k, v); };
  const canPay = (cost, wc) => Object.entries(cost).every(([k, v]) => cnt(k, wc) >= v);
  function pay(cost, wc) { for (const [k, v] of Object.entries(cost)) take(k, v, wc); }
  function weight() { let s = 0; for (const k in G.inv) s += (G.inv[k] || 0) * (ITEMS[k] ? ITEMS[k].kg : 0); return Math.round(s * 10) / 10; }
  const capKg = () => TUNE.hero.capKg + (G.gear.sled ? TUNE.hero.sledKg : 0);
  return { cnt, has, add, take, takeStock, payStock, canPay, pay, weight, capKg };
})();
