// Рюкзак (вещи и деньги), лавка продавца (цены живые, стрелка — к «нормальной» цене), обмен $, «дать».
'use strict';
L.def('ui/bag', () => {
const { ic } = L.use('ui/icons');
const { esc, chips, Modal, fmt } = L.use('ui/dom');
const { NEED_ICON } = L.use('sim/rules');

const close = el => el.querySelectorAll('[data-close]').forEach(b => b.onclick = () => Modal.close());
const xbtn = `<button class="btn sq x" data-close>${ic('close')}</button>`;

function openBag(game, msg = null) {
  const w = game.w, p = w.player;
  const items = Object.entries(p.items).filter(([, n]) => n > 0);
  const cells = items.map(([id, n]) => {
    const g = w.goods.get(id); if (!g) return '';
    const use = g.use ? `<button class="btn" data-use="${id}">${ic('check', 's')}</button>` : '';
    const eff = g.use ? Object.entries(g.use.needs).map(([k, v]) => ic(NEED_ICON[k], 's')).join('') : '';
    return `<div class="cell">${ic(g.icon)}<span class="n">${n}${g.keep && p.charges[id] && g.charges < 99 ? '·' + p.charges[id] : ''}</span><span>${esc(g.name)}</span><span class="dim">${eff}</span>${use}</div>`;
  }).join('');
  const m = p.money;
  const html = `<div class="plate card"><div class="hd"><span class="big">${ic('bag', 'l')}</span><h2>Рюкзак</h2>${xbtn}</div>
    <div class="stats"><div class="stat">${ic('cash')}<b>${fmt(m.rub_cash)}</b><span>₽ наличные</span></div><div class="stat">${ic('card')}<b>${fmt(m.rub_card)}</b><span>₽ «Мир»</span></div>
      <div class="stat">${ic('dollar')}<b>${fmt(m.usd)}</b><span>$</span></div><div class="stat">${ic('cash')}<b>${fmt(m.gel)}</b><span>₾</span></div></div>
    <div class="grid">${cells || '<div class="dim">пусто</div>'}</div>${msg ? chips(msg) : ''}</div>`;
  Modal.show(html, el => {
    close(el);
    el.querySelectorAll('[data-use]').forEach(b => b.onclick = () => { const r = w.useItem(b.dataset.use); Modal.close(); openBag(game, r?.chips); });
  }, 'bag');
}

function openShop(game, sel, only = null, msg = null, time = 0) {
  const w = game.w, p = w.player, E = w.econ, trust = w.trustOf(sel.npc), d = sel.npc && w.npcDefs.get(sel.npc);
  const goods = sel.goods.filter(g => !only || g === only).map(id => w.goods.get(id)).filter(Boolean);
  const rows = goods.map(g => {
    const price = E.price(sel, g.id, trust), base = E.baseRub(g, w.clock.t), k = price / Math.max(1, base);
    const st = sel.stock[g.id] ?? 0, st0 = sel.stock0[g.id] || 1;
    const opts = E.payOptions(p, sel, g.id, price);
    const trend = price === 0 ? '<span class="dn">0</span>' : k > 1.15 ? `<span class="up">×${k.toFixed(1).replace('.', ',')}</span>` : '';
    return `<div class="row">${ic(g.icon)}<div><b>${esc(g.name)}</b><div class="bar stock" style="--v:${Math.min(100, st / st0 * 100)};--col:var(--c8);height:4px;margin-top:3px"><i></i></div></div>
      <div class="pr">${price ? fmt(price) + ' ₽' : ic('heart', 's')}<div class="trd">${trend}</div></div>
      <div class="pays">${st < 1 ? '<span class="dim">нет</span>' : opts.map((o, i) => `<button class="btn${o.ok ? '' : ' off'}" data-g="${g.id}" data-o="${i}" ${o.ok ? '' : 'disabled'} title="${esc(o.label)}${o.why ? ' — ' + esc(o.why) : ''}">${ic(o.icon || 'heart', 's')}${o.method === 'free' ? 'взять' : o.cur === 'usd' ? '$' + o.amount : o.cur === 'gel' ? o.amount + '₾' : o.method === 'transfer_rub' ? 'перевод' : '₽'}</button>`).join('')}</div></div>`;
  }).join('');
  const html = `<div class="plate card"><div class="hd"><span class="big">${ic(d ? d.icon : 'seller', 'l')}</span><div><h2>${esc(d ? d.name : sel.name)}</h2>
      <div class="who">${ic('cash', 's')} ${fmt(p.money.rub_cash)} ₽ · ${ic('dollar', 's')} ${fmt(p.money.usd)}${sel.priceMul === 0 ? ' · бесплатно' : ''}</div></div>${xbtn}</div>
    <div class="rows">${rows}</div>${msg ? chips(msg) : ''}</div>`;
  Modal.show(html, el => {
    close(el);
    el.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
      const g = b.dataset.g, price = E.price(sel, g, trust), o = E.payOptions(p, sel, g, price)[+b.dataset.o];
      const r = w.buy(sel, g, o);
      // время самой сделки списываем тут, в момент реальной покупки (F15) — открытие лавки само по себе бесплатно
      if (r && r.out === '' && time) { w.skipTime(time); r.chips.push({ icon: 'clock', text: time + ' мин', tone: 0 }); }
      Modal.close(); openShop(game, sel, only, r ? [...r.chips, ...(r.out ? [{ icon: 'alert', text: r.out, tone: -1 }] : [])] : null, time);
      game.afterAction();
    });
  }, 'shop');
}

function openExchange(game, sel, msg = null, time = 0) {
  const w = game.w, rate = w.econ.usdRate(), off = w.env.rates().usd;
  const amounts = [50, 100, 200, 500];
  const html = `<div class="plate card"><div class="hd"><span class="big">${ic('dollar', 'l')}</span><div><h2>Обмен с рук</h2><div class="who">1 $ = <b class="num">${rate}</b> ₽ · ЦБ ${off.toFixed(2).replace('.', ',')}</div></div>${xbtn}</div>
    <div class="btns">${amounts.map(a => `<button class="btn${w.player.money.usd >= a ? '' : ' off'}" data-u="${a}" ${w.player.money.usd >= a ? '' : 'disabled'}>${ic('dollar', 's')}${a} → ${fmt(a * rate)} ₽</button>`).join('')}</div>${msg ? chips(msg) : ''}</div>`;
  Modal.show(html, el => { close(el); el.querySelectorAll('[data-u]').forEach(b => b.onclick = () => {
    const r = w.exchange(sel, +b.dataset.u);
    if (r && time) w.skipTime(time);
    Modal.close(); openExchange(game, sel, r?.chips, time);
  }); }, 'shop');
}

function openGive(game, tg, time = 0) {
  const w = game.w, p = w.player;
  const items = Object.entries(p.items).filter(([id, n]) => n > 0 && w.goods.get(id));
  const name = tg.who?.name || w.nameOf(tg.npc) || '';
  const html = `<div class="plate card"><div class="hd"><span class="big">${ic('gift', 'l')}</span><div><h2>Дать</h2><div class="who">${ic('user', 's')} ${esc(name)}</div></div>${xbtn}</div>
    <div class="grid">${items.map(([id, n]) => { const g = w.goods.get(id); return `<button class="btn cell" data-i="${id}">${ic(g.icon)}<span class="n">${n}</span><span>${esc(g.name)}</span></button>`; }).join('')}
    ${[500, 1000, 5000].map(v => `<button class="btn cell${p.money.rub_cash >= v ? '' : ' off'}" data-m="${v}" ${p.money.rub_cash >= v ? '' : 'disabled'}>${ic('cash')}<span>${fmt(v)} ₽</span></button>`).join('')}</div></div>`;
  Modal.show(html, el => {
    close(el);
    const done = r => { if (r && time) w.skipTime(time); Modal.close(); if (r) game.toastChips(r.chips, r.out); game.afterAction(); };
    el.querySelectorAll('[data-i]').forEach(b => b.onclick = () => done(w.give(tg, b.dataset.i)));
    el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => done(w.give(tg, 'money', +b.dataset.m)));
  }, 'give');
}
return { openBag, openShop, openExchange, openGive };
});
