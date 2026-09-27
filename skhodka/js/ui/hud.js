// HUD в зале: часы и ход вечера, силы, счётчики, телефон, пауза; лента тостов; подписи над людьми;
// кнопки действий внизу слева: заказ (меню бара) и общее фото (когда его собирают).
'use strict';
L.def('ui/hud', () => {
const { ic } = L.use('ui/icons');
const { esc, dots, unit } = L.use('ui/dom');
const { hhmm, clamp } = L.use('core');
const { nameOf, isKnown } = L.use('ui/talk');

class Hud {
  constructor(ui) {
    this.ui = ui; this.el = ui.root.querySelector('.hud'); this.energy = 1; this.shown = {};
    this.el.innerHTML = `
      <div class="plate h-time" title="Время">${ic('clock', 's')}<b class="num" data-clock>19:00</b>
        <span class="bar t"><i data-eve></i></span></div>
      <div class="plate h-en" title="Силы">${ic('bolt', 's')}<span class="bar e"><i data-en></i></span></div>
      <div class="plate h-sc">
        <span class="c-blue" title="Знакомства">${ic('wave', 's')}<b class="num" data-met>0</b></span>
        <span class="c-pink" title="Контакты">${ic('phone', 's')}<b class="num" data-con>0</b></span>
        <span class="c-yellow" title="Пары">${ic('link', 's')}<b class="num" data-pair>0</b></span>
      </div>
      <div class="h-btns">
        <button class="btn sq" data-phone title="Телефон">${ic('phone')}<i class="bdg num" hidden data-bdg></i></button>
        <button class="btn sq" data-pause title="Пауза">${ic('pause')}</button>
      </div>`;
    const q = s => this.el.querySelector(s);
    this.$ = { clock: q('[data-clock]'), eve: q('[data-eve]'), en: q('[data-en]'), met: q('[data-met]'), con: q('[data-con]'), pair: q('[data-pair]'), bdg: q('[data-bdg]'), enBox: q('.h-en') };
    q('[data-phone]').onclick = () => ui.phone.toggle();
    q('[data-pause]').onclick = () => ui.setPaused(true);
  }
  set(k, v) { if (this.shown[k] !== v) { this.shown[k] = v; this.$[k].textContent = v; if (k !== 'clock') bump(this.$[k]); } }
  badge(n) { this.$.bdg.hidden = !n; this.$.bdg.textContent = n > 9 ? '9+' : n; }
  update() {
    const ui = this.ui, w = ui.world; if (!w) return;
    const h = w.hour ?? 19;
    this.set('clock', hhmm(h));
    this.$.eve.style.width = clamp((h - 19) / 6, 0, 1) * 100 + '%';
    const e = w.player && w.player.energy != null ? unit(w.player.energy) : this.energy;
    this.$.en.style.width = e * 100 + '%';
    this.$.enBox.classList.toggle('low', e < 0.25);
    const n = ui.counts();
    this.set('met', n.met); this.set('con', n.contacts); this.set('pair', n.pairs);
  }
}
function bump(el) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }

// ───────── тосты ─────────
function toast(ui, t) {
  const box = ui.root.querySelector('.toasts');
  // та же надпись уже висит — не повторяем, только продлеваем
  for (const o of box.children) if (o._t === t.text && !o.classList.contains('out')) { o._until = Date.now() + (t.ms || 2800); return; }
  const el = document.createElement('div'); el._t = t.text; el._until = Date.now() + (t.ms || 2800);
  el.className = 'toast ' + (t.tone || '');
  el.innerHTML = ic(t.icon || 'star', 's') + '<span>' + esc(t.text) + '</span>';
  box.appendChild(el);
  while (box.children.length > (innerWidth < 640 ? 2 : 3)) box.firstChild.remove();
  const gone = () => { if (Date.now() < el._until) return setTimeout(gone, el._until - Date.now()); el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  setTimeout(gone, t.ms || 2800);
}

// ───────── подписи над людьми ─────────
// Раскладка без наложений. Порядок важности: собеседник → зовут → знакомые рядом с игроком → остальные (ближние к
// камере раньше). Каждой подписи — первое свободное место из списка SLOTS: прямо над головой, выше на ряд-два
// (с тонкой ножкой к голове), чуть вбок. Места нет — подпись прячется (собеседник — никогда). Не лезут под
// панели интерфейса и на головы тех, кто говорит с игроком. Дальний план — компактно (имя мельче, без ступеней).
// Без дрожания: подпись сначала пробует своё прошлое место; показ — после паузы свободы, размер — с запасом.
const SLOTS = [[0, 0], [0, 1], [-1, 1], [1, 1], [0, 2], [-1, 2], [1, 2], [0, 3]];   // [вбок, в полширины · ряд вверх]
const ROWS = [3, 3, 2, 1];            // сколько рядов вверх можно подниматься: по важности 0..3
const PPM_CMP = 44, PPM_FULL = 56;    // пикселей на метр у головы: меньше — компактно, больше — полностью
const SHOW_DELAY = 0.3;               // с свободного места до показа (кроме собеседника и зовущих)
class Tags {
  constructor(ui) { this.ui = ui; this.el = ui.root.querySelector('.tags'); this.pool = new Map(); this.boxT = 0; this.boxes = []; }
  // прямоугольники панелей интерфейса (обновляются 4 раза в секунду)
  uiBoxes(dt) {
    if ((this.boxT -= dt) > 0) return this.boxes;
    this.boxT = 0.25;
    const out = [];
    for (const e of this.ui.root.querySelectorAll('.hud .plate, .hud .h-btns, .talk, .pcard, .acts .a-row, .acts .a-menu, .phone')) {
      const r = e.getBoundingClientRect(); if (r.width > 0 && r.height > 0) out.push({ l: r.left - 3, t: r.top - 3, r: r.right + 3, b: r.bottom + 3, e });
    }
    // камере разговора — свободная полоса экрана по высоте: между верхними плашками и панелью разговора
    const ctl = this.ui.scene && this.ui.scene.ctl, VH = innerHeight || 1;
    if (ctl) {
      const talk = out.find(q => q.e.classList.contains('talk')), top = out.filter(q => q.e.closest('.hud')).reduce((m, q) => Math.max(m, q.b), 0);
      // справа может стоять карточка собеседника — пару сдвигаем левее
      const VW = innerWidth || 1, card = out.find(q => q.e.classList.contains('pcard') && q.l > VW * 0.5);
      ctl.band = talk ? [top / VH, Math.max(top / VH + 0.2, talk.t / VH), 0, card ? Math.max(0.6, card.l / VW) : 1] : null;
    }
    return (this.boxes = out);
  }
  update(dt = 1 / 60) {
    const ui = this.ui, sc = ui.scene, w = ui.world;
    if (!sc || !sc.toScreen || !w || ui.screenOn) { this.el.hidden = true; return; }
    this.el.hidden = false;
    dt = Math.min(dt || 0, 0.1);
    const P = w.player || {}, talkId = ui.talk.id, pp = ui.people;
    const list = [], heads = [];
    const VW = innerWidth, VH = innerHeight;
    for (const p of ui.allPeople()) {
      if (!ui.here(p) || p.x == null) continue;
      // зовёт игрока: ответил в чате «иду встречать / объясню» — идёт к нему или ждёт у входа
      const calling = !!(p.calling || p.comeTo === 'me' || p.meet) && !p.metAtDoor && (p.step | 0) < 2;
      const step = p.step | 0, talk = p.id === talkId;
      if (step < 1 && !calling && !talk) continue;
      // над головой 3D-фигуры (она плавно догоняет симуляцию), иначе — по позе
      const a = pp && pp.anchor ? pp.anchor(p.id) : null;
      const ax = a ? a.x : p.x, ay = a ? a.y : (p.pose === 'sit' || p.pose === 'sitSofa' ? 1.55 : 2.05), az = a ? a.z : p.z;
      const s = sc.toScreen(ax, ay, az);
      if (!s || !s.visible) continue;
      const s1 = sc.toScreen(ax, ay - 1, az), ppm = Math.max(1, s1.y - s.y);
      const dMe = Math.hypot(p.x - (P.x ?? p.x), p.z - (P.z ?? p.z));
      const tier = talk ? 0 : calling ? 1 : dMe < 3 ? 2 : 3;
      list.push({ p, s: { x: s.x, y: s.y }, calling, step, talk, tier, ppm, dMe });
    }
    // головы собеседника и игрока — под ними подписей других нет
    if (talkId != null && pp && pp.anchor) for (const id of [talkId, 'me']) {
      const a = pp.anchor(id); if (!a) continue;
      const s = sc.toScreen(a.x, a.y, a.z), s1 = sc.toScreen(a.x, a.y - 0.75, a.z), hw = Math.max(10, (s1.y - s.y) * 0.3);
      if (s.visible) heads.push({ l: s.x - hw, t: s.y, r: s.x + hw, b: s1.y, me: id === 'me' });
    }
    for (const o of list) o.t = this.tag(o.p);
    // важнее — раньше; внутри ступени — кто уже показан (держит место), потом ближние к камере
    list.sort((a, b) => a.tier - b.tier || (b.t._on ? 1 : 0) - (a.t._on ? 1 : 0) || b.ppm - a.ppm);
    const placed = [], boxes = this.uiBoxes(dt), seen = new Set();
    const free = (r, tier) => {
      if (r.l < 2 || r.r > VW - 2 || r.t < 2 || r.b > VH - 2) return false;
      for (const q of placed) if (r.l < q.r && q.l < r.r && r.t < q.b && q.t < r.b) return false;
      if (tier > 0) for (const q of boxes) if (r.l < q.r && q.l < r.r && r.t < q.b && q.t < r.b) return false;
      for (const q of heads) if ((tier > 0 || q.me) && r.l < q.r && q.l < r.r && r.t < q.b && q.t < r.b) return false;   // собеседник — не на лице игрока
      return true;
    };
    const k = 1 - Math.exp(-dt * 14);
    for (const o of list) {
      const { p, s, t, tier } = o;
      seen.add(p.id);
      // размер: дальний план — компактно (с запасом, чтобы не мигало); собеседник и зовущие — всегда полностью
      const kz = tier === 2 ? 0.8 : 1;   // знакомые рядом с игроком — полностью чуть дальше
      const cmp = tier > 1 && (t._cmp ? o.ppm < PPM_FULL * kz : o.ppm < PPM_CMP * kz);
      this.fill(t, o, cmp);
      const wd = t._w, ht = t._h, rows = cmp ? Math.min(1, ROWS[tier]) : ROWS[tier];
      const rect = i => { const [sx, row] = SLOTS[i], x = s.x + sx * (wd / 2 + 3), y = s.y - row * (ht + 3); return { l: x - wd / 2, t: y - ht, r: x + wd / 2, b: y, x, y }; };
      let got = -1;
      const order = t._on && t._slot >= 0 ? [t._slot, ...SLOTS.keys()] : SLOTS.keys();
      for (const i of order) { if (SLOTS[i][1] > rows) continue; if (free(rect(i), tier)) { got = i; break; } }
      if (got < 0 && tier === 0) got = 0;   // собеседник — всегда над головой
      if (got >= 0) {
        const r = rect(got); placed.push(r);
        // показ — после паузы свободы (собеседник и зовущие — сразу)
        if (!t._on) { t._wait = (t._wait || 0) + dt; if (tier <= 1 || t._wait >= SHOW_DELAY || t._fresh) { t._on = true; t._fresh = false; t._ox = r.x - s.x; t._oy = s.y - r.y; } }
        t._slot = got; t._tx = r.x - s.x; t._ty = s.y - r.y;
      } else { if (t._on) t._on = false; t._wait = 0; t._slot = -1; }
      t.classList.toggle('off', !t._on);
      if (!t._on) continue;
      t._ox += (t._tx - t._ox) * k; t._oy += (t._ty - t._oy) * k;
      const x = s.x + t._ox, y = s.y - t._oy;
      t.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
      // ножка: от низа подписи к голове
      const L = Math.hypot(t._ox, t._oy), leg = L > 5 ? Math.round(L) + '|' + Math.round(Math.atan2(t._ox, t._oy) * 57.3) : '';
      if (leg !== t._leg) {
        t._leg = leg; t.classList.toggle('leg', !!leg);
        if (leg) { const [l, ag] = leg.split('|'); t.style.setProperty('--l', l + 'px'); t.style.setProperty('--a', ag + 'deg'); }
      }
    }
    for (const [id, t] of this.pool) if (!seen.has(id)) {
      if (!ui.npc(id)) { t.remove(); this.pool.delete(id); }
      else { t.hidden = true; t._on = false; t._wait = 0; t._fresh = true; }
    }
  }
  tag(p) {
    let t = this.pool.get(p.id);
    if (!t) {
      t = document.createElement('button'); t.className = 'tag off'; t._on = false; t._slot = -1; t._fresh = true;
      t.onclick = () => this.ui.act({ type: 'approach', id: p.id });
      this.el.appendChild(t); this.pool.set(p.id, t);
    }
    if (t.hidden) t.hidden = false;
    return t;
  }
  // содержимое и размер подписи (перемеряется только когда что-то поменялось)
  fill(t, { p, step, calling, talk }, cmp) {
    const key = `${step}|${calling}|${isKnown(p, 'name')}|${talk}|${cmp}`;
    if (t._k === key) return;
    t._k = key; t._cmp = cmp;
    const known = step >= 1;
    t.className = 'tag' + (calling ? ' call' : '') + (talk ? ' tg-talk' : '') + (known ? '' : ' mini') + (cmp ? ' cmp' : '') + (t._on ? '' : ' off') + (t._leg ? ' leg' : '');
    t.innerHTML = (calling ? `<span class="tw">${ic('wave', 's')}</span>` : '') + (known ? `<b>${esc(nameOf(p))}</b>${cmp ? '' : dots(step)}` : '');
    t._w = t.offsetWidth || 60; t._h = t.offsetHeight || 20;
  }
}
// ───────── действия: заказ, общее фото ─────────
class Acts {
  constructor(ui) {
    this.ui = ui; this.el = ui.root.querySelector('.acts'); this.open = false; this.photoOn = null;
    this.el.innerHTML = `<div class="a-menu plate" hidden></div>
      <div class="a-row"><button class="btn sq big" data-order title="Заказать">${ic('beer')}</button>
      <button class="btn sq big acc" data-photo title="На общее фото" hidden>${ic('camera')}</button></div>`;
    this.M = this.el.querySelector('.a-menu'); this.P = this.el.querySelector('[data-photo]');
    this.el.querySelector('[data-order]').onclick = () => this.toggle();
    this.P.onclick = () => { ui.act({ type: 'photo' }); };
  }
  toggle(on = !this.open) {
    this.open = on; this.M.hidden = !on;
    if (!on) return;
    const menu = this.ui.world?.T?.menu || [];
    this.M.innerHTML = menu.map(m => `<button class="a-it" data-it="${esc(m.id)}">${ic(m.icon || 'beer')}<span>${esc(m.title)}</span>
      <span class="bar e"><i style="width:${Math.round(clamp(m.energy || 0, 0, 0.4) / 0.4 * 100)}%"></i></span></button>`).join('');
    this.M.querySelectorAll('[data-it]').forEach(b => b.onclick = () => { this.ui.act({ type: 'order', item: b.dataset.it }); this.toggle(false); });
  }
  update() {
    const w = this.ui.world; if (!w) return;
    const T = w.T || {}, ph = (w.events || []).some(e => e.effect && e.effect.photo);
    const on = ph || (w.hour >= (T.photo?.from ?? 23.8) && !(w.score && w.score.photo) && !(w.dir && w.dir.fired.includes('photo')));
    if (on !== this.photoOn) { this.photoOn = on; this.P.hidden = !on; this.P.classList.toggle('pulse', ph); }
  }
}
return { Hud, Tags, Acts, toast };
});
