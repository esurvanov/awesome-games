// HUD: часы и погода, потребности полосками, кошелёк, скорость времени, мини-карта, путь до КПП, календарь, док.
'use strict';
L.def('ui/hud', () => {
const { ic } = L.use('ui/icons');
const { fmt, esc } = L.use('ui/dom');
const { DAY, fmtDur, $ } = L.use('core');
const { NEED_ICON, NEED_NAME } = L.use('sim/rules');

const NEEDS = ['hunger', 'thirst', 'warmth', 'sleep', 'nerves', 'charge'];
const WX = { clear: 'sun', cloud: 'cloud', drizzle: 'rain', rain: 'rain', storm: 'rain', wind: 'wind' };

class Hud {
  constructor(game) {
    this.G = game; const w = game.w, C = w.C;
    const el = $('hud');
    const days = C.CALENDAR.days.map((d, i) => {
      const rules = C.CALENDAR.rules.filter(r => Math.floor(w.clock.parse(r.from) / DAY) === i && r.id !== 'mobilization');
      return `<div data-d="${i}" title="${esc(d.tag)}"><b>${+d.date.slice(8)}</b><span class="rl">${rules.map(r => ic(r.icon, r.id === 'pedAllowed' || r.id === 'volunteers' ? 'g' : '')).join('')}</span></div>`;
    }).join('');
    el.innerHTML = `
      <div class="tl">
        <div class="plate clock"><span class="dayic" id="h-dayic">${ic('sun', 'l')}</span><span class="t num" id="h-time">00:00</span>
          <span class="w"><span id="h-wx">${ic('sun')}</span><b class="num" id="h-temp">0°</b></span><span class="d" id="h-date"></span></div>
        <div class="plate needs">${NEEDS.map(k => `<div class="need" title="${NEED_NAME[k]}" style="--col:var(--n-${k})">${ic(NEED_ICON[k])}<div class="bar" id="n-${k}" style="--col:var(--n-${k})"><i></i></div><b id="nv-${k}">0</b></div>`).join('')}</div>
      </div>
      <div class="tr">
        <div class="plate wallet" id="h-wallet"></div>
        <div class="plate speed" id="h-speed">
          <button class="btn sq" data-s="0" title="Пауза (пробел)">${ic('pause')}</button>
          <button class="btn sq" data-s="1" title="×1">${ic('play')}</button>
          <button class="btn sq" data-s="2" title="×4">${ic('fast')}</button>
          <button class="btn sq" data-s="3" title="×16">${ic('faster')}</button>
          <button class="btn sq" id="h-save" title="Сохранить">${ic('save')}</button>
          <button class="btn sq" id="h-set" title="Настройки · озвучка">${ic('gear')}</button>
        </div>
        <canvas id="minimap" class="plate"></canvas>
      </div>
      <div class="zoomb"><button class="btn" id="z-in">${ic('zoomIn')}</button><button class="btn" id="z-out">${ic('zoomOut')}</button></div>
      <div class="plate queue">
        <div class="qrow">${ic('barrier')}<div class="track" id="q-track"><i></i><b></b></div>${ic('car')}</div>
        <div class="qstats">
          <span title="до КПП">${ic('flag')}<b id="q-km">0</b></span>
          <span title="машин впереди">${ic('car')}<b id="q-ahead">0</b></span>
          <span title="ждать примерно">${ic('clock')}<b id="q-eta">0</b></span>
          <span title="в очереди людей">${ic('people')}<b id="q-people">0</b></span>
          <span title="пропускают в час">${ic('barrier')}<b id="q-rate">0</b></span>
        </div>
        <div class="cal" id="q-cal">${days}</div>
      </div>
      <div class="plate dock">
        <button class="btn" id="d-map" title="Карта / вид (M)">${ic('map')}<span>Карта</span></button>
        <button class="btn" id="d-me" title="Я">${ic('user')}Я</button>
        <button class="btn" id="d-car" title="Моя машина (C)">${ic('car')}Машина</button>
        <button class="btn" id="d-phone" title="Телефон (P)">${ic('phone')}Телефон<span class="badge" id="d-unread"></span></button>
        <button class="btn" id="d-bag" title="Рюкзак (B)">${ic('bag')}Рюкзак</button>
        <button class="btn" id="d-sleep" title="Спать">${ic('moon')}Сон</button>
        <button class="btn" id="d-set" title="Настройки · озвучка · ключ OpenAI">${ic('gear')}Настройки</button>
      </div>
      <div class="plate sleepbar" id="h-sleep" hidden>${ic('moon')}<span>Сон</span><div class="bar" style="width:120px;--col:var(--n-sleep)"><i id="h-sleepv"></i></div><button class="btn" id="h-wake">${ic('sun')}Встать</button></div>
      <div id="toasts"></div>`;
    el.hidden = false;
    this.el = el; this.t = 0;
    this.refs = {}; for (const k of NEEDS) this.refs[k] = [$('n-' + k), $('nv-' + k)];
    el.querySelectorAll('#h-speed [data-s]').forEach(b => b.onclick = () => game.setSpeed(+b.dataset.s));
    $('h-save').onclick = () => game.save(true);
    $('h-set').onclick = () => game.openSettings();
    $('d-set').onclick = () => game.openSettings();
    $('z-in').onclick = () => game.view.setZoom(game.view.cam.z * 1.6);
    $('z-out').onclick = () => game.view.setZoom(game.view.cam.z / 1.6);
    $('d-map').onclick = () => game.setMode(game.mode === '3d' ? 'map' : '3d');
    $('d-map').hidden = !(game.view3 && game.view3.ok);
    $('d-me').onclick = () => game.openMenu({ kind: 'self' });
    $('d-car').onclick = () => { game.centerOnPlayer(); game.openMenu({ kind: 'own', car: w.pcar }); };
    $('d-phone').onclick = () => game.openPhone();
    $('d-bag').onclick = () => game.openBag();
    $('d-sleep').onclick = () => game.sleep();
    $('h-wake').onclick = () => w.wake('Проснулся');
  }
  mode(m) {
    const b = $('d-map'); if (!b) return;
    b.innerHTML = m === '3d' ? ic('map') + '<span>Карта</span>' : ic('eye') + '<span>Вид</span>';
  }
  update(dt) {
    this.t -= dt; if (this.t > 0) return; this.t = 0.25;
    const G = this.G, w = G.w, p = w.player, env = w.env, lab = w.clock.label();
    $('h-time').textContent = lab.time;
    $('h-date').textContent = lab.date + ' · ' + lab.wd;
    const night = env.night();
    $('h-dayic').innerHTML = ic(night ? 'moon' : 'sun', 'l');
    const wx = WX[env.weather()] || 'sun'; $('h-wx').innerHTML = ic(night && wx === 'sun' ? 'moon' : wx);
    $('h-temp').textContent = Math.round(env.temp()) + '°';
    for (const k of NEEDS) {
      const v = p.needs[k], [bar, num] = this.refs[k];
      bar.style.setProperty('--v', v.toFixed(0)); bar.classList.toggle('low', v < w.T.needs.critical); num.textContent = v.toFixed(0);
    }
    const m = p.money, car = w.pcar;
    $('h-wallet').innerHTML = `<span title="наличные ₽">${ic('cash')}${fmt(m.rub_cash)} ₽</span><span title="карта «Мир» — только в России">${ic('card')}${fmt(m.rub_card)} ₽</span>
      <span title="доллары">${ic('dollar')}${fmt(m.usd)}</span><span title="лари">${ic('cash')}${fmt(m.gel)} ₾</span>
      <span title="бензин">${ic('fuel')}${car ? car.fuel.toFixed(0) : 0} л</span><span title="пассажиры">${ic('people')}${p.passengers.length}</span>`;
    this.el.querySelectorAll('#h-speed [data-s]').forEach(b => b.classList.toggle('on', +b.dataset.s === G.speed));
    // путь до КПП
    const km = w.playerKpp(), ahead = car ? w.queue.ahead(car) : 0, start = Math.max(1, p.startKm * 1000);
    const prog = Math.max(0, Math.min(100, 100 - km / start * 100));
    $('q-track').style.setProperty('--v', prog.toFixed(1));
    $('q-km').textContent = (km / 1000).toFixed(1).replace('.', ',') + ' км';
    $('q-ahead').textContent = fmt(ahead);
    const rate = env.through('car');
    $('q-eta').textContent = '~' + fmtDur(ahead / Math.max(1, rate) * 3600);
    $('q-people').textContent = fmt(w.queue.people);
    $('q-rate').textContent = Math.round(rate) + '/ч';
    const di = env.dayIdx();
    this.el.querySelectorAll('#q-cal > div').forEach(d => { const i = +d.dataset.d; d.classList.toggle('now', i === di); d.classList.toggle('past', i < di); });
    $('d-unread').textContent = w.phone.unread || '';
    $('h-sleep').hidden = !p.sleeping;
    $('h-sleepv').parentElement.style.setProperty('--v', p.needs.sleep.toFixed(0));
  }
}
return { Hud };
});
