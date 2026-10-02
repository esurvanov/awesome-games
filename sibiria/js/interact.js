'use strict';
// Interact — единый модуль «всё со всем»: события + свойства вещей + таблица правил → отклик.
// Контракт (его используют другие модули, менять нельзя):
//   Interact.emit(kind, ev)  — сообщить о событии; ev = { who, what, x, y, power, ... }
//   Interact.on(kind, fn)    — подписка (fn(ev)); kind '*' — на все события
//   Interact.tick(dt)        — шаг (зовёт game.js update)
// События: bump / push (герой упёрся), hit / fell (топор по дереву), brush (задел на ходу), step (шаг), work (обломки, лунка, стройка, рыба);
//          жесты героя: shake (толчок дерева), kick (пинок сугроба), throw (палка упала), bury (снег на костёр), warm (руки у огня), open (тайник);
//          howl (вой/рык — из audio.js, герой вздрагивает);
//          паспорт R5 (волна 1): gust (Wind — порыв у героя прошёл 8 м/с), touch (герой прошёл сквозь мягкое: провод, вымпел, записка),
//          noise (лязг/хлопок — дверь Ми-8; звери по радиусу — потом);
//          паспорт R5 (волна 3): shed (js/snow.js — шапка снега упала с вещи от удара/толчка/пинка: x, y, target, amount).
// Отклик не пишется парой «кто × что»: у вещи 2–3 свойства (PROPS), правило = событие + свойства → отклик (RULES).
const Interact = (() => {
  const subs = new Map(), I = TUNE.interact;
  function on(kind, fn) { if (!subs.has(kind)) subs.set(kind, []); subs.get(kind).push(fn); }

  // ---------- свойства вещей (13 штук: wood springy snowy hard metal grassy soft ice hot + cloth paper wire fuel) ----------
  // части Ми-8 (js/live.js): blade — согнутая лопасть, door — сдвижная дверь, wire — провода из разлома; pennant — вымпел, note — записка
  const PROPS = {
    blade: ['hard', 'metal', 'snowy'], door: ['hard', 'metal'], wire: ['wire'], pennant: ['cloth'], note: ['paper'],
    barrel: ['hard', 'metal', 'fuel', 'snowy'], crate: ['hard', 'wood', 'snowy'],
    tree: ['wood', 'springy', 'snowy'], dead: ['wood'], tussock: ['grassy', 'springy', 'snowy'],
    rock: ['hard', 'snowy'], log: ['wood', 'snowy'], wall: ['hard', 'wood', 'snowy'], build: ['hard', 'wood', 'snowy'], wreck: ['hard', 'metal', 'snowy'],
    edge: ['soft'], snow: ['soft', 'snowy'], ice: ['ice', 'hard'], water: ['wet'], dig: ['ice', 'snowy'], fish: ['ice'], fire: ['hot'], stash: ['wood', 'snowy'],
  };
  const NONE = [];
  function propsOf(e) {
    if (e.kind === 'step') return PROPS.snow;
    const k = e.obj || e.what || (e.kind === 'hit' || e.kind === 'fell' ? 'tree' : '');
    return k === 'tree' && e.target && e.target.kind === 3 ? PROPS.dead : PROPS[k] || NONE; // гарь: сухой ствол без снега
  }
  // верх препятствия (куда сыпется снег): крона, макушка камня, крыша
  const topY = e => e.y - (e.obj === 'tree' && e.target ? 90 * e.target.s : e.obj === 'rock' && e.target ? 22 * e.target.s : 46);

  // ---------- отклики (только готовые помощники) ----------
  const P = () => G.parts;
  const branchSnow = (t, k) => { if (ArtWorld.fx.branchSnow) ArtWorld.fx.branchSnow(P(), t, k); };
  const nearHero = (e, r) => (e.x - G.p.x) ** 2 + (e.y - G.p.y) ** 2 < r * r;
  function scareRavens(x, y, r) {
    let caw = 0;
    for (const rv of G.ravens || NONE) if (!rv.fly && (rv.x - x) ** 2 + (rv.y - y) ** 2 < r * r) {
      rv.fly = 1; const a = Math.atan2(rv.y - y, rv.x - x) + rnd(-0.6, 0.6); rv.vx = Math.cos(a) * 180; rv.vy = Math.sin(a) * 120; rv.t = rnd(20, 40);
      if (!caw++) Sound.src(rv).tone('sawtooth', 700, 500, 0.15, 0.06);
    }
  }

  const sr = e => { const v = Math.sin((e.x || 0) * 12.9898 + (e.y || 0) * 78.233 + now * 37.7) * 43758.5453; return v - Math.floor(v); }; // «случайное» 0..1 без Math.random
  // ---------- правила: [событие, нужные свойства (все), отклик, условие?] ----------
  const RULES = [
    ['bump', null, e => Sound.thud(e.power, e.P.includes('hard') ? 1 : 0)],
    ['bump', 'springy', e => World.shakeTree(e.target, 0.25 + 0.4 * e.power)],
    ['bump', ['springy', 'snowy'], e => branchSnow(e.target, e.power)],
    ['bump', ['hard', 'snowy'], e => ArtWorld.fx.snowPuff(P(), e.x, topY(e), 0.3 + 0.5 * e.power), e => e.power > 0.35 && !e.inside],
    ['bump', 'metal', e => Sound.tone('triangle', 520, 380, 0.25, 0.08, 0, { lp: 1800 })],
    ['bump', 'hard', e => Fx.shake(I.nudge), e => e.power > I.nudgeP],
    ['push', 'springy', e => World.shakeTree(e.target, 0.15)],
    ['push', 'snowy', e => ArtWorld.fx.snowPuff(P(), e.x, topY(e), 0.1), e => e.t > 1 && !e.inside && Math.random() < 0.5],
    ['brush', 'wood', e => World.shakeTree(e.target, 0.12)],
    ['brush', 'grassy', e => { World.shakeTree(e.target, 0.5); ArtWorld.fx.snowPuff(P(), e.x, e.y - 4, 0.15); }],
    ['step', 'soft', e => ArtWorld.fx.snowPuff(P(), e.x, e.y, e.drift ? 0.5 : 0.3), e => Math.random() < (e.drift ? 0.6 : 0.25)],
    ['hit', 'wood', e => { ArtWorld.fx.chips(P(), e.x, e.y); if (e.who === 'p' || Math.random() < 0.3) Sound.chop(); }],
    ['hit', 'springy', e => World.shakeTree(e.target, 0.35)],
    ['hit', 'snowy', e => { branchSnow(e.target, 0.6 * (e.power || 1)); ArtWorld.fx.snowPuff(P(), e.x, e.y - 4); }],
    ['hit', null, e => scareRavens(e.x, e.y, I.ravenHit)],
    ['fell', 'wood', e => Sound.treeCrack()], // удар ствола о землю (снег, тряска) — анимация падения в gfx.js
    ['fell', null, e => scareRavens(e.x, e.y, I.ravenFell)],
    ['work', 'metal', e => { Sound.hit(); Fx.burst(e.x, e.y - 20, 6, '#ffb347', 120); Fx.burst(e.x, e.y - 14, 4, '#8a949e'); }],
    ['work', 'ice', e => { ArtWorld.fx.snowPuff(P(), e.x, e.y, 0.4); Fx.burst(e.x, e.y, 6, '#dde6ee', 70); }, e => e.what === 'dig'],
    ['work', 'wood', e => { ArtWorld.fx.chips(P(), e.x, e.y); Sound.chop(); }, () => Math.random() < 0.4],
    // жесты героя: отклик вещи в момент касания
    ['shake', 'springy', e => World.shakeTree(e.target, 0.5)],
    ['shake', 'snowy', e => branchSnow(e.target, 0.8)],
    ['shake', null, e => { Sound.thud(0.25, 0); scareRavens(e.x, e.y, I.ravenHit * 1.6); }],
    ['kick', 'soft', e => { ArtWorld.fx.snowPuff(P(), e.x, e.y, 0.9); ArtWorld.fx.snowPuff(P(), e.x + 6, e.y - 6, 0.6); Fx.burst(e.x, e.y - 4, 8, '#f6f9fc', 90); Sound.thud(0.35, 0); }],
    ['throw', 'soft', e => ArtWorld.fx.snowPuff(P(), e.x, e.y, 0.35)],
    // палка о голый лёд — стук и крошка льда, без облака снега; о дерево — глухой удар, ветки вздрогнули; в воду — всплеск
    ['throw', 'ice', e => { Sound.tone('triangle', 1700, 1100, 0.07, 0.05, 0, { lp: 4000 }); Fx.burst(e.x, e.y - 1, 4, '#dde6ee', 50); }],
    ['throw', 'wood', e => { Sound.thud(0.3, 1); World.shakeTree(e.target, 0.3); branchSnow(e.target, 0.25); }, e => e.target && e.target.s],
    ['throw', 'wet', e => { if (typeof Ice !== 'undefined') Ice.splash(e.x, e.y); Sound.splash && Sound.splash(); }],
    // тепло костра снизу: снег с лап ели сорвался (js/fire.js treeSnow)
    ['thaw', 'snowy', e => branchSnow(e.target, 0.7)],
    // шагнул в огонь (упор героя в костёр): искры из-под ног
    ['bump', 'hot', e => { for (let i = 0; i < 4; i++) P().push({ type: 'spark', x: e.x + i * 3 - 4, y: e.y - 6, vx: i * 14 - 20, vy: -90 - i * 15, life: 0.8, max: 1, g: -10 }); }],
    ['throw', null, e => scareRavens(e.x, e.y, 90)],
    ['bury', 'hot', e => { ArtWorld.fx.snowPuff(P(), e.x, e.y - 4, 0.7); for (let i = 0; i < 4; i++) P().push({ type: 'smoke', x: e.x + i * 3 - 5, y: e.y - 14, vx: 6 - i * 3, vy: -30 - i * 6, life: 1.6, max: 1.6 }); if (Sound.hiss) Sound.hiss(); }],
    ['warm', 'hot', e => { for (let i = 0; i < 3; i++) P().push({ type: 'spark', x: e.x + i * 4 - 4, y: e.y - 14, vx: i * 10 - 10, vy: -70 - i * 20, life: 0.9, max: 1, g: -10 }); }],
    ['open', 'snowy', e => ArtWorld.fx.snowPuff(P(), e.x, e.y - 6, 0.3)],
    ['open', 'wood', e => Sound.tone('triangle', 260, 180, 0.14, 0.05)],
    // касание мягкого (паспорт R4): провод шуршит и звякает, ткань хлопает, бумага шуршит — отклик формы в js/live.js
    // (шум — со своим r: Math.random игры не тратится, детерминизм тестов)
    ['touch', 'wire', e => { Sound.burst(0.12, 'bandpass', 2400, 0.05, 3, { r: sr(e) }); Sound.tone('triangle', 1400, 1100, 0.12, 0.02); }, () => Sound.ok()],
    ['touch', 'cloth', e => Sound.burst(0.08, 'bandpass', 700, 0.06, 1.5, { r: sr(e) }), () => Sound.ok()],
    ['touch', 'paper', e => Sound.burst(0.1, 'highpass', 3200, 0.04, 1, { r: sr(e) }), () => Sound.ok()],
    ['bump', 'metal', e => Sound.tone('sine', 110, 80, 0.6, 0.05, 0, { lp: 600 }), e => e.obj === 'blade'], // лопасть: низкий гул «бам»
    // шапка снега упала (js/snow.js): мягкий глухой «пуф», громче — больше снега
    ['shed', null, e => Sound.burst(0.16, 'lowpass', 420, 0.05 + 0.07 * Math.min(1, e.amount || 0), 1, { r: sr(e) }), () => Sound.ok()],
  ];
  const BY = {};
  for (const r of RULES) { if (typeof r[1] === 'string') r[1] = [r[1]]; (BY[r[0]] = BY[r[0]] || []).push(r); }
  function apply(e) {
    const rs = BY[e.kind]; if (!rs || (e.who !== 'p' && !nearHero(e, I.farR))) return; // чужое далеко за кадром — без частиц и звука
    const pr = e.P = propsOf(e);
    for (const r of rs) {
      const need = r[1]; let ok = true;
      if (need) for (let i = 0; i < need.length && ok; i++) ok = pr.includes(need[i]);
      if (ok && (!r[3] || r[3](e))) { if (e.x != null && typeof Sound !== 'undefined' && Sound.at) Sound.at(e.x, e.y, () => r[2](e)); else r[2](e); } // звук отклика — из места события (Sound.at)
    }
  }

  function emit(kind, ev = {}) {
    ev.kind = kind;
    apply(ev);
    for (const fn of subs.get(kind) || NONE) fn(ev);
    for (const fn of subs.get('*') || NONE) fn(ev);
  }
  function tick(dt) {
    if (typeof Wind !== 'undefined') Wind.tick(dt); // порыв у героя → 'gust'
    if (typeof Snow !== 'undefined') Snow.tick(dt); // шапки и наддувы (2 Гц)
  }
  return { on, emit, tick, PROPS, RULES };
})();
