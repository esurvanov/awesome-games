// Итог пути: «Что ты отдал / Что ты получил», кому помог и кого задел, цифры, слухи — правда или нет.
'use strict';
L.def('ui/end', () => {
const { ic } = L.use('ui/icons');
const { esc, Modal, fmt } = L.use('ui/dom');
const { fmtDur } = L.use('core');

function showEnd(game, s) {
  const w = game.w;
  const item = (x, icon) => `<span class="chip ${icon === 'heart' ? 'p' : icon === 'alert' ? 'n' : 'i'}">${ic(x.icon || icon)}${esc(x.text)}</span>`;
  const gave = [
    ...s.gave.map(x => item(x, 'gift')),
    s.spent.rub_cash + s.spent.rub_card ? `<span class="chip n">${ic('cash')}${fmt(s.spent.rub_cash + s.spent.rub_card)} ₽</span>` : '',
    s.spent.usd ? `<span class="chip n">${ic('dollar')}$${fmt(s.spent.usd)}</span>` : '',
    `<span class="chip n">${ic('clock')}${fmtDur(s.waited)}</span>`,
  ].join('');
  const got = [
    ...s.got.map(x => item(x, 'star')),
    s.talks ? `<span class="chip i">${ic('mic')}${s.talks} разг.</span>` : '',
    s.earned.rub_cash ? `<span class="chip p">${ic('cash')}${fmt(s.earned.rub_cash)} ₽</span>` : '',
    ...Object.entries(s.trust).filter(([, v]) => v >= 20).map(([id, v]) => `<span class="chip p">${ic('handshake')}${esc(w.nameOf(id))} +${Math.round(v)}</span>`),
  ].join('');
  const helped = s.helped.map(x => item(x, 'heart')).join('') || '<span class="dim">—</span>';
  const harmed = s.harmed.map(x => item(x, 'alert')).join('') || '<span class="dim">—</span>';
  const rum = s.rumours.map(r => `<span class="chip ${r.truth === 'true' ? 'p' : r.truth === 'false' ? 'n' : 'i'}">${ic(r.truth === 'true' ? 'check' : r.truth === 'false' ? 'close' : 'alert')}${esc(r.text)}</span>`).join('');
  const html = `<div class="plate card end" id="end">
    <div class="hd"><span class="big">${ic(s.end?.icon || 'flag', 'l')}</span><div><h2>${esc(s.end?.title || 'Конец')}</h2><div class="who">${w.clock.label(s.end?.t ?? w.clock.t).date} · ${w.clock.label(s.end?.t ?? w.clock.t).time}</div></div></div>
    <div class="stats">
      <div class="stat">${ic('clock')}<b>${Math.round(s.waited / 3600)}</b><span>часов</span></div>
      <div class="stat">${ic('car')}<b>${fmt(s.startAhead)}</b><span>машин было впереди</span></div>
      <div class="stat">${ic('heart')}<b>${s.helped.length}</b><span>помог</span></div>
      <div class="stat">${ic('ear')}<b>${s.rumours.length}</b><span>слухов</span></div>
    </div>
    <div class="two">
      <div class="col gave"><h3>${ic('gift')}Что ты отдал</h3><div class="chips">${gave}</div></div>
      <div class="col got"><h3>${ic('star')}Что ты получил</h3><div class="chips">${got || '<span class="dim">—</span>'}</div></div>
    </div>
    <div class="two">
      <div class="col"><h3>${ic('heart')}Кому помог</h3><div class="chips">${helped}</div></div>
      <div class="col"><h3>${ic('alert')}Кого задел</h3><div class="chips">${harmed}</div></div>
    </div>
    ${rum ? `<div class="col"><h3>${ic('ear')}Слухи</h3><div class="chips">${rum}</div></div>` : ''}
    <div class="btns"><button class="btn acc" data-again>${ic('play')}Заново</button></div></div>`;
  Modal.closeAll();
  Modal.show(html, el => el.querySelector('[data-again]').onclick = () => game.restart(), 'end');
}
return { showEnd };
});
