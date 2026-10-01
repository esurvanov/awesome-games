'use strict';
// Вещи: у каждой — масса и объём (ITEMS[id].kg, .l). Места: рюкзак G.inv, лабаз/поленница G.chest, нарты G.sled, тайники s.inv,
// руки G.hand (js/carry.js). Место — {id: штук, wkg: масса дров кг, wl: твёрдый объём дров л}: дрова — штуки (≈ чурка) со своей массой
// (дерево → чурки → руки → рюкзак/нарты/поленница → печь сходятся по кг); взять n поленьев — уходит средняя масса.
// Рюкзак: ≤ packL л укладки и ≤ packMax кг, дров — не больше packWood коротких; выше packKg — перегруз (медленнее, усталость).
const Inv = (() => {
  const LD = () => TUNE.load, r4 = v => Math.round(v * 1e4) / 1e4;
  const isW = id => id === 'wood';
  // ---------- место: масса и объём ----------
  // wn — сколько штук было при последней записи массы: если число дров поменяли мимо Inv (старый код, сценарии тестов),
  // прибавку считаем по номиналу, убыль — по средней (масса не «размазывается» по чужим штукам)
  function sync(c) {
    if (c.wkg == null || c.wn == null || c.wn === (c.wood || 0)) return;
    const d = (c.wood || 0) - c.wn, L = LD();
    if (d > 0) { c.wkg = r4(c.wkg + d * L.woodKg); c.wl = r4((c.wl || 0) + d * L.woodKg / L.rho * 1000); }
    else if (c.wn > 0) { const k = (c.wood || 0) / c.wn; c.wkg = r4(c.wkg * k); c.wl = r4((c.wl || 0) * k); }
    c.wn = c.wood || 0;
  }
  const wkg = c => { sync(c); return (c.wood || 0) > 0 ? (c.wkg != null ? c.wkg : c.wood * LD().woodKg) : 0; };
  const wl = c => { sync(c); return (c.wood || 0) > 0 ? (c.wl != null ? c.wl : wkg(c) / LD().rho * 1000) : 0; };
  function put(c, id, n = 1, kg, l) {
    if (!(n > 0)) return;
    // масса места: пока всё номинальное — не пишем (wkg/wl выводятся из штук); своя масса — пишем
    if (isW(id) && (kg != null || c.wkg != null)) { const m = kg != null ? kg : n * LD().woodKg, v = l != null ? l : m / LD().rho * 1000, m0 = wkg(c), v0 = wl(c); c.wkg = r4(m0 + m); c.wl = r4(v0 + v); c[id] = (c[id] || 0) + n; c.wn = c.wood; check(c, 'put ' + id); return; }
    c[id] = (c[id] || 0) + n; check(c, 'put ' + id);
  }
  // забрать n (сколько есть): {n, kg, l}; дрова — средняя масса места
  function pull(c, id, n = 1) {
    const h = Math.min(n, c[id] || 0); if (!(h > 0)) return { n: 0, kg: 0, l: 0 };
    let kg, l;
    if (isW(id)) { const m = wkg(c), v = wl(c), N = c.wood; kg = m * h / N; l = v * h / N; if (c.wkg != null) c.wkg = r4(m - kg); if (c.wl != null) c.wl = r4(v - l); }
    else { kg = h * (ITEMS[id] ? ITEMS[id].kg : 0); l = h * (ITEMS[id] ? ITEMS[id].l : 0); }
    c[id] -= h;
    if (isW(id) && c.wkg != null) { c.wn = c.wood; if (!c.wood) { c.wkg = 0; c.wl = 0; } }
    check(c, 'pull ' + id);
    return { n: h, kg, l };
  }
  // инвариант мест: счётчик вещи ≥ 0 и конечен, масса дров ≥ 0 и есть только при дровах; нарушение — ошибка в консоль
  // (в тестах — navigator.webdriver: playwright ловит console.error как провал). Возвращает список нарушений.
  const TEST = typeof navigator !== 'undefined' && !!navigator.webdriver;
  function bad(c, tag) {
    const out = [];
    if (!c) return out;
    if (c.wkg != null) sync(c);   // число дров меняли мимо Inv — сперва свести массу
    for (const k in c) { const v = c[k]; if (typeof v === 'number' && (!(v >= 0) || !isFinite(v))) out.push(`${tag}.${k}=${v}`); }
    if ((c.wood || 0) === 0 && (c.wkg || 0) > 1e-3) out.push(`${tag}.wkg=${c.wkg} без дров`);
    return out;
  }
  function places() {
    if (typeof G === 'undefined' || !G) return [];
    const o = [[G.inv, 'inv'], [G.chest, 'chest'], [G.sled, 'sled']];
    (G.stashes || []).forEach((s, i) => o.push([s.inv, 'stash' + i]));
    return o;
  }
  function audit(where) {
    const out = [];
    for (const [c, tag] of places()) out.push(...bad(c, tag));
    const t = G && G.hand && G.hand.t; if (t && (!(t.n > 0) || (t.kg != null && !(t.kg >= 0)))) out.push(`hand.${t.id} n=${t.n} kg=${t.kg}`);
    for (const q of (G && G.loose) || []) if (!(q.n > 0)) out.push(`loose.${q.it} n=${q.n}`);
    if (out.length && TEST) console.error('Inv: ' + (where || 'audit') + ' — ' + out.join(', '));
    return out;
  }
  // после записи в место: проверить именно его (дёшево); полный обход — audit()
  const check = (c, where) => { if (TEST) { const b = bad(c, where); if (b.length) console.error('Inv: ' + b.join(', ') + '\n' + (new Error().stack || '').split('\n').slice(2, 6).join(' | ')); } };
  const move = (a, b, id, n = 1) => { const r = pull(a, id, n); if (r.n) put(b, id, r.n, isW(id) ? r.kg : undefined, isW(id) ? r.l : undefined); return r.n; };
  function kgOf(c) { let s = 0; for (const k in c) if (ITEMS[k] && !isW(k)) s += (c[k] || 0) * ITEMS[k].kg; return s + wkg(c); }
  // объём укладки: вещи по ITEMS.l, дрова — твёрдый объём × bulk (зазоры между поленьями)
  function litOf(c) { let s = 0; for (const k in c) if (ITEMS[k] && !isW(k)) s += (c[k] || 0) * ITEMS[k].l; return s + wl(c) * LD().bulk; }

  // ---------- рюкзак и лабаз (прежний интерфейс) ----------
  // wc — «с лабазом»: считать/брать ещё и из G.chest (герой в избе); дрова в руках (охапка) — тоже свои
  const handWood = () => (typeof Carry !== 'undefined' && G.hand ? Carry.woodN() : 0);
  const handN = id => (G.hand && G.hand.t && G.hand.t.id === id ? G.hand.t.n || 1 : 0);   // вещь в руке (мясо, рыба, шкурка) — тоже своя
  const cnt = (id, wc) => id === 'food' ? FOOD_KEYS.reduce((s, k) => s + cnt(k, wc), 0) : (G.inv[id] || 0) + (wc ? (G.chest[id] || 0) : 0) + (isW(id) ? handWood() : handN(id));
  function takeHand(id, n) { const t = G.hand && G.hand.t; if (!t || t.id !== id || n <= 0) return 0; const k = Math.min(n, t.n || 1); t.n = (t.n || 1) - k; if (t.kg != null) t.kg = Math.max(0, t.kg - k * (ITEMS[id] ? ITEMS[id].kg : 0)); if (t.n <= 0) G.hand.t = null; return k; }
  const has = (id, wc) => cnt(id, wc === undefined ? G.p.inside : wc) > 0;
  function add(id, n = 1, kg, l) { put(G.inv, id, n, kg, l); }
  // сначала руки (дрова), рюкзак, потом лабаз (если wc)
  function take(id, n, wc) {
    if (id === 'food') { if (cnt('food', wc) < n) return false; for (const k of FOOD_KEYS) while (n > 0 && cnt(k, wc) > 0) { take(k, 1, wc); n--; } return true; }
    if (isW(id)) while (n > 0 && handWood() > 0) { Carry.takeWood(); n--; }
    else n -= takeHand(id, n);
    n -= pull(G.inv, id, n).n;
    if (n > 0 && wc) n -= pull(G.chest, id, n).n;
    return n === 0;
  }
  // сначала лабаз, потом рюкзак (chestOnly — только лабаз): стройка, посёлок, печь
  function takeStock(id, n, chestOnly) {
    if (id === 'food') {
      if ((chestOnly ? FOOD_KEYS.reduce((s, k) => s + (G.chest[k] || 0), 0) : cnt('food', true)) < n) return false;
      for (const src of chestOnly ? [G.chest] : [G.chest, G.inv]) for (const k of FOOD_KEYS) while (n > 0 && (src[k] || 0) > 0) { pull(src, k, 1); n--; }
      if (!chestOnly) for (const k of FOOD_KEYS) n -= takeHand(k, n);
      return true;
    }
    n -= pull(G.chest, id, n).n;
    if (!chestOnly && isW(id)) while (n > 0 && handWood() > 0) { Carry.takeWood(); n--; }
    if (!chestOnly && !isW(id)) n -= takeHand(id, n);
    if (n > 0 && !chestOnly) n -= pull(G.inv, id, n).n;
    return n === 0;
  }
  const payStock = cost => { for (const [k, v] of Object.entries(cost)) takeStock(k, v); };
  const canPay = (cost, wc) => Object.entries(cost).every(([k, v]) => cnt(k, wc) >= v);
  function pay(cost, wc) { for (const [k, v] of Object.entries(cost)) take(k, v, wc); }
  // вес на теле: рюкзак + руки (нарты тянутся по снегу — их вес в скорости через Carry.sledMul)
  const handKg = () => (typeof Carry !== 'undefined' ? Carry.kg() : 0);
  function weight() { return Math.round((kgOf(G.inv) + handKg()) * 10) / 10; }
  const capKg = () => LD().packKg;
  const packKg = () => Math.round(kgOf(G.inv) * 10) / 10, packL = () => Math.round(litOf(G.inv));
  // влезет ли в рюкзак: n штук id (дрова — с массой kg, объёмом l твёрдого, длиной len м); why — почему нет
  function fits(id, n = 1, kg, l, len) {
    const L = LD(), it = ITEMS[id] || { kg: 0, l: 0 }, m = isW(id) ? (kg != null ? kg : n * L.woodKg) : n * it.kg;
    const v = isW(id) ? (l != null ? l : m / L.rho * 1000) * L.bulk : n * it.l;
    if (isW(id) && ((G.inv.wood || 0) + n > L.packWood || (len || 0) > L.packWoodLen || m / n > L.packWoodKg + 1e-6)) return { ok: false, why: 'wood' };
    if (litOf(G.inv) + v > L.packL + 1e-6) return { ok: false, why: 'l' };
    if (kgOf(G.inv) + m > L.packMax + 1e-6) return { ok: false, why: 'kg' };
    return { ok: true };
  }
  // миграция старого сейва: «дрова» были числом по 6 кг (Tree.KG) без места — вещи с массой; в рюкзаке — не больше packWood,
  // остальное: в избе — в поленницу, с нартами — на нарты (по ёмкости), иначе — чурками на снег у ног
  function migrate() {
    const L = LD(), K = typeof Tree !== 'undefined' ? Tree.KG : 6;
    G.sled = G.sled || {}; G.loose = G.loose || []; G.carcs = G.carcs || [];
    if (G.itemsV >= 2) return;
    for (const c of [G.inv, G.chest, G.sled].concat((G.stashes || []).map(s => s.inv || (s.inv = {})))) if ((c.wood || 0) > 0 && c.wkg == null) { c.wkg = c.wood * K; c.wl = r4(c.wkg / L.rho * 1000); c.wn = c.wood; }
    if ((G.woodKg || 0) > 0.5) { put(G.inv, 'wood', 1, G.woodKg); } delete G.woodKg;
    const extra = Math.max(0, (G.inv.wood || 0) - L.packWood);
    if (extra) {
      const r = pull(G.inv, 'wood', extra), per = r.kg / r.n, p = G.p;
      let left = r.n;
      if (p.inside || dist2(p, HUT) < 260 * 260) { put(G.chest, 'wood', left, per * left); left = 0; }
      if (left && G.gear.sled) { const k = Math.min(left, Math.floor((L.sledKg - kgOf(G.sled)) / per)); if (k > 0) { put(G.sled, 'wood', k, per * k); left -= k; } }
      for (let i = 0; i < left; i++) {
        const a = i * 2.4, rr = 16 + i * 2.2;
        (G.chunks = G.chunks || []).push({ id: (G.partN = (G.partN || 0) + 1), kind: 'chunk', tk: 0, len: 0.45, diam: 0.14, d0: 0.15, d1: 0.13, vol: +(per / L.rho).toFixed(6), mass: +per.toFixed(3),
          x: Math.round(p.x + Math.cos(a) * rr), y: Math.round(p.y + Math.sin(a) * rr * 0.6 + 6), ang: +(a % 3).toFixed(2), t: G.time });
      }
    }
    G.itemsV = 2;
  }
  return { audit, cnt, has, add, take, takeStock, payStock, canPay, pay, weight, capKg, packKg, packL, fits, migrate, put, pull, move, kgOf, litOf, wkg, wl, isW };
})();
