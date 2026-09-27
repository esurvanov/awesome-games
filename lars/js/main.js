// Вход: стартовый экран → мир → один rAF-цикл (фиксированный шаг симуляции + кадр отрисовки) → HUD и окна.
'use strict';
L.def('main', () => {
const { CONTENT } = L.use('content/index');
const { World } = L.use('sim/world');
const { Loop, Save, Settings, $, clamp, fmtKm } = L.use('core');
const { View } = L.use('render/view');
const { Minimap } = L.use('render/minimap');
const { Input } = L.use('render/input');
const { Quality } = L.use('render/quality');
const { View3D } = L.use('render/view3d');
const { FP } = L.use('render/fp');
const { Ambience } = L.use('render/audio');
const { mountSprite, ic } = L.use('ui/icons');
const { Modal, toast, esc, chips } = L.use('ui/dom');
const { Hud } = L.use('ui/hud');
const { Menu } = L.use('ui/menu');
const { showEvent } = L.use('ui/cards');
const { openPhone } = L.use('ui/phone');
const { openBag, openShop, openExchange, openGive } = L.use('ui/bag');
const { showEnd } = L.use('ui/end');
const { openSettings } = L.use('ui/settings');
const { Voice, sayPhone } = L.use('ui/speak');
const { openTalk, installPTT } = L.use('ui/talk');
const { startCard } = L.use('ui/onboard');

mountSprite();
if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('has-touch');
const T = CONTENT.TUNING;

const G = {
  w: null, view: null, mini: null, input: null, hud: null, menu: null, loop: null, q: new Quality(),
  speed: 1, pending: [], saveT: 0, ended: false, mode: 'map', view3: null, fp: null,
  // ─── время ───
  setSpeed(i) { this.speed = clamp(i, 0, T.time.scales.length - 1); },
  // «одни часы»: раньше ходьба двигала игрока в РЕАЛЬНЫХ м/с независимо от множителя времени — 300 м стоили
  // 0,7 игрового часа на ×1 и 11 ч на ×16 (те же реальные секунды ходьбы, но разное игровое время за них).
  // Пока игрок реально идёт пешком (не за рулём), держим время как на ×1 — так стоимость шага в игровых
  // часах не зависит от того, что было выставлено на спидометре, и не бывает бесплатной на паузе.
  isWalking() {
    const w = this.w; if (!w || !w.player || w.player.inCar) return false;
    if (w.player.tx != null) return true; // идёт к точке (клик по карте, «В машину», меню)
    if (this.mode === '3d' && this.input) {
      const k = this.input.keys;
      if (k.has('KeyW') || k.has('KeyA') || k.has('KeyS') || k.has('KeyD') || k.has('ArrowUp') || k.has('ArrowDown') || k.has('ArrowLeft') || k.has('ArrowRight')) return true;
      if (this.fp && this.fp.stick && (Math.abs(this.fp.stick.x) > 0.05 || Math.abs(this.fp.stick.y) > 0.05)) return true;
    }
    return false;
  },
  scale() {
    const w = this.w; if (!w || this.ended) return 0;
    const base = T.time.scales[this.speed];
    if (Modal.open || this.menu.open) return T.time.sceneScale;
    if (w.player.sleeping) return T.time.sleepScale;
    if (this.isWalking()) return 1;
    if (!base) return 0;
    return base;
  },
  // ─── окна ───
  menuOpen() { return Modal.open || (this.menu && this.menu.open); },
  // ─── режим: 3D от первого лица ⇄ карта сверху ───
  setMode(m) {
    if (m === '3d' && !(this.view3 && this.view3.ok)) m = 'map';
    this.mode = m; Settings.set('mode', m);
    document.body.classList.toggle('fpv', m === '3d'); document.body.classList.toggle('mapv', m === 'map');
    $('view').hidden = m !== 'map'; if (this.view3) this.view3.cv.hidden = m !== '3d';
    if (this.fp) this.fp.show(m === '3d');
    if (m === 'map') { this.input.follow = true; this.view.resize(); } else this.view3.resize();
    this.hud && this.hud.mode(m);
  },
  openMenu(tg, sx, sy) { this.view.sel = tg.kind === 'self' || tg.kind === 'own' ? null : tg; this.menu.show(tg, sx, sy); },
  openUi(ui) {
    if (ui.kind === 'shop') openShop(this, ui.seller, ui.only, null, ui.time);
    else if (ui.kind === 'exchange') openExchange(this, ui.seller, null, ui.time);
    else if (ui.kind === 'give') openGive(this, ui.tg, ui.time);
    else if (ui.kind === 'phone') this.openPhone();
    else if (ui.kind === 'bag') this.openBag();
    else if (ui.kind === 'talk') openTalk(this, ui.tg);
  },
  openPhone() { this.menu.hide(); openPhone(this); },
  openBag() { this.menu.hide(); openBag(this); },
  openSettings() { this.menu?.hide(); openSettings(this); },
  sleep() {
    const w = this.w; if (!w.player.inCar) { this.toast({ icon: 'car', text: 'Спать — в машине', tone: -1 }); return; }
    w.player.sleeping = !w.player.sleeping; if (!w.player.sleeping) w.wake('Проснулся');
  },
  centerOnPlayer() { this.input.follow = true; if (this.mode === '3d' && this.fp) this.fp.syncFromCar(this.w.player.inCar); },
  toast(t) { toast(t); },
  toastChips(list, out) { for (const c of (list || []).slice(0, 3)) toast(c); if (out) toast({ icon: 'chat', text: out }); },
  afterAction() { if (this.w.ended && !this.ended) this.finish(); this.flushEvents(); },
  flushEvents() { if (!Modal.open && this.pending.length && !this.ended) showEvent(this, this.pending.shift()); },
  finish() { this.ended = true; this.menu.hide(); Save.clear(); showEnd(this, this.w.summary()); },
  save(manual) {
    if (!this.w || this.ended) return;
    const ok = Save.write(this.w.save());
    if (manual) toast({ icon: 'save', text: ok ? 'Сохранено' : 'Не сохранилось', tone: ok ? 1 : -1 });
  },
  restart() { Save.clear(); location.reload(); },

  // ─── запуск ───
  begin(world) {
    const w = this.w = world;
    w.busy = () => Modal.open || this.pending.length > 0;
    const cv = $('view'), gcv = $('gl');
    this.view = new View(cv, w, this.q);
    try { this.view3 = new View3D(gcv, w, this.q); } catch (e) { console.warn('3D недоступно', e); this.view3 = null; }
    this.q.onChange = () => { this.view.resize(); this.view3 && this.view3.resize(); };
    this.hud = new Hud(this);
    this.mini = new Minimap($('minimap'), w, this.view);
    this.menu = new Menu(this);
    this.input = new Input(cv, this.view, { onTap: (x, y) => this.tap(x, y), onKey: e => this.key(e) });
    addEventListener('resize', () => { this.view.resize(); this.view3 && this.view3.resize(); });
    if (this.view3 && this.view3.ok) this.fp = new FP(this, this.view3, gcv);
    this.audio = new Ambience();
    const wake = () => this.audio.start(); addEventListener('pointerdown', wake); addEventListener('keydown', wake);
    // озвучка: тосты ошибок, приглушить ветер и моторы, пока говорят
    Voice.toast = t => toast(t);
    Voice.listen(v => { const a = this.audio; if (a && a.master && a.on) a.master.gain.setTargetAtTime(v.cur ? 0.25 : 0.7, a.ctx.currentTime, 0.15); });
    this.setMode(this.view3 && this.view3.ok ? (Settings.get('mode') || '3d') : 'map');
    installPTT(this); // V — сказать своё (живой разговор, только с ключом OpenAI)
    w.bus.on('event', ev => { this.pending.push(ev); this.flushEvents(); });
    w.bus.on('toast', t => { if (!this.ended) toast(t); });
    w.bus.on('end', () => this.finish());
    w.bus.on('phone', m => { if (!this.ended) sayPhone(this, m); if (m.from !== 'me' && m.from !== 'chat') toast({ icon: 'phone', text: (CONTENT.PHONE.contacts.find(c => c.id === m.chat)?.name || '') + ': ' + m.text }); });
    w.bus.on('rumour:learn', r => { if (!this.ended) toast({ icon: 'ear', text: r.text }); });
    addEventListener('visibilitychange', () => { if (document.hidden) this.save(false); });
    // камера — на игроке
    const p = w.player; this.view.cam.x = p.x; this.view.cam.y = p.y; this.view.cam.z = 3.2;
    this.loop = new Loop({
      step: T.time.step, realToGame: T.time.realToGame, maxSteps: T.time.maxSteps,
      scale: () => this.scale(),
      update: dt => { if (!w.ended) w.step(dt); },
      render: (a, dt) => this.frame(dt),
    });
    this.loop.start();
    window.LARS = this; this.Modal = Modal; // для тестов и отладки
  },
  frame(dt) {
    const w = this.w, t0 = performance.now();
    w.frame(dt);
    const p = w.player, c = this.view.cam;
    if (this.mode === '3d') {
      this.fp.update(dt); this.view3.draw(dt); c.x = p.x; c.y = p.y;
      if (this.audio.ctx) { const v = this.view3, T = v.T, g = T.ground(v.cam.x, v.cam.z, v.sCam); this.audio.update(dt, { wind: v.env.wind, river: Math.abs(g.o - T.RIV[g.i] - T.DEV[g.i]), engines: v.engNear || 0, inCar: p.inCar, engineOn: !!p.flags.engine, paused: !this.speed }); }
    } else {
      if (this.audio.ctx) this.audio.update(dt, { wind: 0.2, river: 1e3, engines: 0, inCar: false, engineOn: false, paused: true });
      this.input.update(dt);
      if (this.input.follow && p) { const k = 1 - Math.exp(-dt * 4); c.x += (p.x - c.x) * k; c.y += (p.y - c.y) * k; }
      this.view.draw(dt);
    }
    document.body.classList.toggle('sleeping', !!p.sleeping);
    this.mini.draw(dt);
    this.hud.update(dt);
    if (w.ended && !this.ended) this.finish();
    this.flushEvents();
    this.saveT += dt; if (this.saveT > 60) { this.saveT = 0; this.save(false); }
    this.q.sample(performance.now() - t0 + this.loop.simMs, dt);
  },
  tap(sx, sy) {
    if (this.ended) return;
    const tg = this.view.pick(sx, sy), w = this.w;
    if (tg.kind === 'ground') {
      this.menu.hide();
      if (!w.player.inCar) {
        // клик по карте — тоже через road.walkable(): не пускаем прямиком в реку/КПП насквозь/пустой хвост
        // (finding 1, 9, 10, 16), а обрезаем до ближайшей проходимой точки на пути к клику
        const q = w.road.walkableTarget(w.player.x, w.player.y, tg.pos.x, tg.pos.y);
        if (q) { w.walkTo(q.x, q.y); this.input.follow = true; }
        else this.toast({ icon: 'walk', text: 'Туда не пройти', tone: -1 });
      }
      return;
    }
    this.openMenu(tg, sx, sy);
  },
  key(e) {
    if (!this.w) return false;
    if (e.code === 'Escape') { if (Voice.cur) Voice.stop(); if (Modal.open && Modal.top() !== 'event' && Modal.top() !== 'end') Modal.close(); else this.menu.hide(); return true; }
    if (Modal.open) return false;
    const k = e.code;
    if (k === 'KeyM') { this.setMode(this.mode === '3d' ? 'map' : '3d'); return true; }
    if (k === 'KeyN' && this.audio) { const on = this.audio.toggle(); toast({ icon: on ? 'music' : 'close', text: on ? 'Звук' : 'Без звука' }); return true; }
    if (this.mode === '3d' && this.fp && this.fp.key(e)) return true;
    if (this.mode === '3d' && k === 'KeyZ') { this.sleep(); return true; }
    if (k === 'Space') { this.setSpeed(this.speed ? 0 : 1); return true; }
    if (k.startsWith('Digit') && +k.slice(5) >= 1 && +k.slice(5) <= 4) { this.setSpeed(+k.slice(5) - 1); return true; }
    if (k === 'KeyP') { this.openPhone(); return true; }
    if (k === 'KeyB') { this.openBag(); return true; }
    if (k === 'KeyC') { this.centerOnPlayer(); return true; }
    if (k === 'Equal' || k === 'NumpadAdd') { this.view.setZoom(this.view.cam.z * 1.4); return true; }
    if (k === 'Minus' || k === 'NumpadSubtract') { this.view.setZoom(this.view.cam.z / 1.4); return true; }
    return false;
  },
};

// ─── стартовый экран ───
function startScreen() {
  const role = CONTENT.ROLES[0], has = Save.has();
  const el = $('start');
  el.innerHTML = `<div class="plate start">
    <h1>ЛАРС</h1>
    <div class="date">${ic('clock')}21–30 сентября 2022</div>
    <div class="role"><span class="av">${ic(role.icon, 'l')}</span><b>${esc(role.name)}, ${role.age} · ${esc(role.job)}</b><span class="dim">${esc(role.blurb)}</span></div>
    <div class="btns">${has ? `<button class="btn acc" id="st-cont">${ic('play')}Продолжить</button>` : ''}<button class="btn ${has ? '' : 'acc'}" id="st-new">${ic('car')}${has ? 'Заново' : 'В очередь'}</button><button class="btn" id="st-set">${ic('gear')}Настройки</button></div>
    <div class="keys"><span>${ic('walk', 's')}WASD · Shift</span><span>${ic('eye', 's')}мышь</span><span>${ic('target', 's')}E — действие</span><span>${ic('car', 's')}F — машина</span><span>${ic('map', 's')}M — карта</span><span>${ic('bolt', 's')}L — фонарик</span><span>${ic('mic', 's')}V — сказать своё</span><span>${ic('pause', 's')}пробел</span></div>
    <div class="loading" id="st-load" hidden>${ic('clock', 's')} мир живёт с 21 сентября…</div>
  </div>`;
  const go = load => {
    $('st-load').hidden = false; el.querySelectorAll('button').forEach(b => b.disabled = true);
    setTimeout(() => {
      let w = null;
      if (load) { try { w = World.load(CONTENT, Save.read()); } catch (e) { console.warn('save broken', e); w = null; } }
      if (!w) { w = new World(CONTENT); w.init(role.id); }
      el.hidden = true;
      G.begin(w);
      toast({ icon: 'flag', text: fmtKm(w.playerKpp()) + ' до КПП', big: true });
    }, 30);
  };
  $('st-new').onclick = () => { Save.clear(); go(false); };
  if (has) $('st-cont').onclick = () => go(true);
  $('st-set').onclick = () => G.openSettings();
  startCard(el.querySelector('.start')); // ключ OpenAI: голоса + живой разговор (или «без голоса» — больше не спросим)
}
startScreen();
window.LARS_START = { G, World, CONTENT };
});
