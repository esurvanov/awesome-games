// Карточки событий: заголовок, 1–3 предложения, выборы с видимыми последствиями до и после выбора.
'use strict';
L.def('ui/cards', () => {
const { ic } = L.use('ui/icons');
const { esc, chips, Modal, fmt } = L.use('ui/dom');
const { NEED_ICON } = L.use('sim/rules');
const { priceLabel, buyPrice } = L.use('sim/rules');
const { tpl } = L.use('core');
const { nextKey, block, sayEvent, sayOutcome } = L.use('ui/speak');

// предпросмотр fx → чипы (без применения)
function preview(fx, w, ev) {
  const out = []; if (!fx) return out;
  const add = (icon, text, tone) => out.push({ icon, text, tone });
  if (fx.buy) add(fx.buy.good === 'escort' ? 'dollar' : 'cash', '−' + priceLabel(fx, w), -1);
  if (fx.money) for (const k in fx.money) { const v = fx.money[k]; add(k === 'usd' ? 'dollar' : 'cash', (v > 0 ? '+' : '−') + (k === 'usd' ? '$' + fmt(Math.abs(v)) : fmt(Math.abs(v)) + ' ₽'), v > 0 ? 1 : -1); }
  if (fx.needs) for (const k in fx.needs) { const v = fx.needs[k]; add(NEED_ICON[k], (v > 0 ? '+' : '−') + Math.abs(v), v > 0 ? 1 : -1); }
  if (fx.items) for (const k in fx.items) { const v = fx.items[k], g = w.goods.get(k); add(g?.icon || 'bag', (v > 0 ? '+' : '−') + Math.abs(v), v > 0 ? 1 : -1); }
  if (fx.fuel) add('fuel', (fx.fuel > 0 ? '+' : '−') + Math.abs(fx.fuel) + ' л', fx.fuel > 0 ? 1 : -1);
  if (fx.trust) for (const k in fx.trust) { const v = fx.trust[k]; const id = k === 'npc' || k === 'target' ? ev?.npc : k; add('handshake', (w.nameOf(id) || '') + ' ' + (v > 0 ? '+' : '−') + Math.abs(v), v > 0 ? 1 : -1); }
  if (fx.places) add('car', (fx.places > 0 ? '+' : '−') + Math.abs(fx.places) + ' место', fx.places > 0 ? 1 : -1);
  if (fx.advance) add('arrowUp', '+' + fx.advance + ' км', 1);
  if (fx.passenger) add('user', '+пассажир', 1);
  if (fx.time) add('clock', fx.time + ' мин', 0);
  if (fx.helped) add('heart', tpl(fx.helped, ev?.vars || {}), 1);
  if (fx.harmed) add('alert', tpl(fx.harmed, ev?.vars || {}), -1);
  if (fx.rumour) add('ear', 'слух', 0);
  if (fx.risk) add('alert', 'риск ' + Math.round(fx.risk.p * 100) + '%', -1);
  if (fx.end) add('flag', 'конец пути', 0);
  if (fx.gave) for (const g of fx.gave) add('gift', g, -1);
  return out;
}

function showEvent(game, ev) {
  const w = game.w, e = ev.e;
  const who = ev.who ? `${esc(ev.who.name)}, ${ev.who.age}` : ev.npc && w.npcDefs.has(ev.npc) ? esc(w.npcDefs.get(ev.npc).name) : '';
  const opts = e.choices.map(ch => ({ ch, why: w.choiceBlock(ch, ev) }));
  const vk = nextKey('ev'); let spoken = false;
  const html = `<div class="plate card" data-ev="${esc(e.id)}">
    <div class="hd"><span class="big ${e.weight === 'heavy' ? 'heavy' : ''}">${ic(e.icon, 'l')}</span><div><h2>${esc(ev.title)}</h2>${who ? `<div class="who">${ic('user', 's')} ${who}</div>` : ''}</div></div>
    ${block(vk, `<p>${esc(ev.text)}</p>`, ev.text)}
    <div class="choices">${opts.map((o, i) => {
      const lb = tpl(o.ch.label, { price: priceLabel(o.ch.fx, w) });
      return `<button class="btn choice${o.why ? ' off' : ''}" data-i="${i}" ${o.why ? 'disabled' : ''}>${ic(o.ch.icon || 'check')}<span class="lb">${esc(lb)}</span>${o.why ? `<span class="why">${esc(o.why)}</span>` : chips(preview(o.ch.fx, w, ev))}</button>`;
    }).join('')}</div></div>`;
  Modal.show(html, el => {
    if (!spoken) { spoken = true; sayEvent(game, ev, vk); } // карточка перерисовывается из-под телефона — не повторяем
    el.querySelectorAll('[data-i]').forEach(b => b.onclick = () => {
      const o = opts[+b.dataset.i]; if (o.why) return;
      const r = w.choose(ev, o.ch);
      outcome(game, ev, o.ch, r);
    });
  }, 'event');
}

function outcome(game, ev, ch, r) {
  const e = ev.e, vk = nextKey('out');
  const html = `<div class="plate card">
    <div class="hd"><span class="big">${ic(r.risky ? 'alert' : ch.icon || e.icon, 'l')}</span><div><h2>${esc(ev.title)}</h2><div class="who">${esc(tpl(ch.label, { price: '' }))}</div></div></div>
    ${r.out ? block(vk, `<p><q>${esc(r.out)}</q></p>`, r.out) : ''}
    ${chips(r.chips)}
    <button class="btn acc" data-ok>${ic('check')}Дальше</button></div>`;
  let spoken = false;
  Modal.replace(html, el => {
    if (!spoken) { spoken = true; sayOutcome(game, ev, r, vk); }
    el.querySelector('[data-ok]').onclick = () => {
    Modal.close();
    if (r.event) { const nx = game.w.C.EVENTS.find(x => x.id === r.event); if (nx) showEvent(game, game.w.prepareEvent(nx)); }
    game.afterAction();
  }; });
}
return { preview, showEvent };
});
