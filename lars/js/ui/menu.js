// Меню действий на выбранном человеке / машине / продавце / себе. Карточка: кто это, хорошее и плохое, доверие.
'use strict';
L.def('ui/menu', () => {
const { ic } = L.use('ui/icons');
const { esc, chips, fmt } = L.use('ui/dom');
const { $, clamp } = L.use('core');
const { nextKey, block, sayAction } = L.use('ui/speak');
const { Api } = L.use('ai/api');
const { openKeyCard } = L.use('ui/onboard');

class Menu {
  constructor(game) { this.G = game; this.el = $('menu'); this.tg = null; this.res = null; this.touch = matchMedia('(pointer: coarse)').matches; }
  get open() { return !this.el.hidden; }
  show(tg, sx, sy) {
    this.tg = tg; this.res = null; this.at = [sx, sy];
    this.render();
    this.el.hidden = false;
    const W = innerWidth, H = innerHeight, r = this.el.getBoundingClientRect();
    const x = sx == null ? W / 2 - r.width / 2 : sx + 16, y = sy == null ? H / 2 - r.height / 2 : sy - r.height / 2;
    this.el.style.left = clamp(x, 8, W - r.width - 8) + 'px'; this.el.style.top = clamp(y, 8, H - r.height - 8) + 'px';
    // тач: меню часто открывается тем же касанием, что и «Действие» (fp.js) — палец ещё не оторвался, и
    // браузер после touchend посылает синтетический click в кнопку меню, оказавшуюся под пальцем (finding 6:
    // тап у Лёхи открывал меню и сразу же бил по первой кнопке). Гейт — только на тач (coarse pointer): с
    // мышью/пером клик сразу после открытия — обычное дело, не тот же жест, что открыл меню
    this.guardUntil = this.touch ? performance.now() + 350 : 0;
  }
  hide() { this.el.hidden = true; this.tg = null; this.G.view.sel = null; }
  head(tg) {
    const w = this.G.w, C = w.C;
    let icon = 'user', name = '', sub = '', good = [], bad = [], trust = null, extra = '';
    if (tg.kind === 'self') { const r = w.role; icon = r.icon; name = r.name; sub = `${r.age} · ${r.job}`; extra = this.selfInfo(); }
    else if (tg.kind === 'own') { const c = tg.car; icon = 'car'; name = 'Моя машина'; sub = `${C.CARS.models[c.mi]?.name || ''} · ${c.fuel.toFixed(0)} л · ${w.player.passengers.length + 1}/${c.seats}`; extra = this.ownInfo(); }
    else if (tg.kind === 'seller') {
      const o = tg.seller, d = o.npc && w.npcDefs.get(o.npc);
      icon = d ? d.icon : 'seller'; name = d ? d.name : o.name; sub = d ? `${d.age} · ${d.job}` : 'торгует у дороги';
      if (d) { good = d.good; bad = d.bad; trust = w.trustOf(o.npc); }
      extra = `<div class="gb">${o.goods.slice(0, 8).map(g => ic(w.goods.get(g)?.icon || 'star', 's')).join('')}<span class="dim" style="font-size:11px;margin-left:4px">${o.priceMul === 0 ? 'бесплатно' : o.accepts.map(a => a === 'cash_rub' ? '₽' : a === 'cash_usd' ? '$' : a === 'transfer_rub' ? 'перевод' : a === 'cash_gel' ? '₾' : 'карта').join(' · ')}</span></div>`;
    } else {
      const d = tg.npc && w.npcDefs.get(tg.npc), who = tg.who;
      if (d) { icon = d.icon; name = d.name; sub = `${d.age} · ${d.job}`; good = d.good; bad = d.bad; trust = w.trustOf(tg.npc); }
      else if (who) { icon = tg.ped ? 'walk' : 'user'; name = who.name; sub = `${who.age} · ${who.job}`; good = [who.good]; bad = [who.bad]; trust = w.trustOf(who.key); }
      if (tg.car) extra = `<div class="dim" style="font-size:11px">${ic('car', 's')} ${esc(C.CARS.models[tg.car.mi]?.name || '')} · ${tg.car.n} чел. · ${ic('heart', 's')} ${Math.round(tg.car.ne)}</div>`;
      if (tg.ped) extra = `<div class="dim" style="font-size:11px">${ic(tg.ped.bike ? 'bike' : 'walk', 's')} ${tg.ped.st ? 'ждёт у шлагбаума' : 'идёт к КПП'}</div>`;
    }
    const gb = good.length || bad.length ? `<div class="gb">${good.map(t => `<span class="chip p">${ic('heart')}${esc(t)}</span>`).join('')}${bad.map(t => `<span class="chip n">${ic('alert')}${esc(t)}</span>`).join('')}</div>` : '';
    const tr = trust == null ? '' : `<div class="trust">${ic('handshake', 's')}<div class="bar" style="--v:${(trust + 100) / 2};--col:${trust >= 0 ? 'var(--s-ok)' : 'var(--s-danger)'}"><i></i></div><b>${trust > 0 ? '+' : ''}${Math.round(trust)}</b></div>`;
    return `<div class="mh"><span class="av">${ic(icon)}</span><span class="nm">${esc(name)}</span><button class="btn sq x" data-close style="grid-row:span 2">${ic('close')}</button><span class="sub">${esc(sub)}</span></div>${gb}${tr}${extra}`;
  }
  selfInfo() {
    const w = this.G.w, p = w.player, known = p.knows.size;
    return `<div class="chips"><span class="chip i">${ic('ear')}${known} слухов</span><span class="chip p">${ic('heart')}${w.ledger.helped.length}</span><span class="chip n">${ic('alert')}${w.ledger.harmed.length}</span></div>`;
  }
  ownInfo() {
    const p = this.G.w.player;
    return p.passengers.length ? `<div class="chips">${p.passengers.map(x => `<span class="chip i">${ic(x.icon || 'user')}${esc(x.name)}</span>`).join('')}</div>` : '';
  }
  render() {
    const w = this.G.w, tg = this.tg;
    let body;
    if (this.res) {
      body = `<div class="res">${this.res.out ? block(this.vk, `<q>${esc(this.res.out)}</q>`, this.res.out) : ''}${chips(this.res.chips)}<button class="btn" data-back>${ic('back')}Ещё</button></div>`;
    } else {
      const list = w.actionsFor(tg);
      const far = !w.inReach(tg);
      body = `<div class="acts">${list.map(({ a, why }, i) => `<button class="btn${why ? ' off' : ''}" data-a="${i}" ${why ? 'disabled' : ''}>${ic(a.icon)}<span>${esc(a.label)}</span>${why ? `<small>${esc(why)}</small>` : a.op === 'freeTalk' && !Api.ready() ? `<small class="k">${ic('key', 's')}ключ</small>` : ''}</button>`).join('')}</div>
        ${far ? `<div class="dim" style="font-size:11px;display:flex;gap:4px;align-items:center">${ic('walk', 's')}подойти</div>` : ''}`;
      this.list = list;
    }
    this.el.innerHTML = this.head(tg) + body;
    this.el.querySelector('[data-close]').onclick = () => this.hide();
    this.el.querySelector('[data-back]')?.addEventListener('click', () => { this.res = null; this.render(); });
    this.el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { if (performance.now() < this.guardUntil) return; this.act(this.list[+b.dataset.a].a); });
  }
  act(a) {
    const G = this.G, w = G.w, tg = this.tg;
    if (a.op === 'freeTalk' && !Api.ready()) { this.hide(); openKeyCard(G); return; } // без ключа — предложить ключ
    const run = () => {
      const r = w.doAction(a, tg);
      if (r.ui) { this.hide(); G.openUi(r.ui); return; }
      if (r.walking) { this.hide(); return; }
      this.res = r; this.vk = nextKey('act'); if (this.tg) { this.render(); this.el.hidden = false; sayAction(G, tg, a, r, this.vk); }
      G.afterAction();
    };
    if (!w.inReach(tg)) {
      const q = w.targetPos(tg);
      if (q) { this.hide(); G.toast({ icon: 'walk', text: 'Иду…' }); w.walkTo(q.x, q.y, () => { this.show(tg, ...this.at); run(); }); G.input.follow = true; return; }
    }
    run();
  }
}
return { Menu };
});
