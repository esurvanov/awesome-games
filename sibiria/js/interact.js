'use strict';
// Interact — единый модуль «всё со всем»: события + свойства вещей + таблица правил → отклик.
// Контракт (его используют другие модули, менять нельзя):
//   Interact.emit(kind, ev)  — сообщить о событии; ev = { who, what, x, y, power, ... }
//   Interact.on(kind, fn)    — подписка (fn(ev)); kind '*' — на все события
//   Interact.tick(dt)        — шаг (зовёт game.js update)
// События: bump / push (герой упёрся), hit / fell (топор по дереву), brush (задел на ходу), step (шаг), work (обломки, лунка, стройка, рыба);
//          жесты героя: shake (толчок дерева), kick (пинок сугроба), throw (палка упала), bury (снег на костёр), warm (руки у огня), open (тайник);
//          howl (вой/рык — из audio.js, герой вздрагивает).
// Отклик не пишется парой «кто × что»: у вещи 2–3 свойства (PROPS), правило = событие + свойства → отклик (RULES).
const Interact = (() => {
  const subs = new Map(), I = TUNE.interact;
  function on(kind, fn) { if (!subs.has(kind)) subs.set(kind, []); subs.get(kind).push(fn); }

  // ---------- свойства вещей (9 штук: wood springy snowy hard metal grassy soft ice hot) ----------
  const PROPS = {
    tree: ['wood', 'springy', 'snowy'], dead: ['wood'], tussock: ['grassy', 'springy', 'snowy'],
    rock: ['hard', 'snowy'], wall: ['hard', 'wood', 'snowy'], build: ['hard', 'wood', 'snowy'], wreck: ['hard', 'metal', 'snowy'],
    edge: ['soft'], snow: ['soft', 'snowy'], dig: ['ice', 'snowy'], fish: ['ice'], fire: ['hot'], stash: ['wood', 'snowy'],
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
      if (!caw++) Sound.tone('sawtooth', 700, 500, 0.15, 0.06);
    }
  }

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
    ['throw', null, e => scareRavens(e.x, e.y, 90)],
    ['bury', 'hot', e => { ArtWorld.fx.snowPuff(P(), e.x, e.y - 4, 0.7); for (let i = 0; i < 4; i++) P().push({ type: 'smoke', x: e.x + i * 3 - 5, y: e.y - 14, vx: 6 - i * 3, vy: -30 - i * 6, life: 1.6, max: 1.6 }); if (Sound.hiss) Sound.hiss(); }],
    ['warm', 'hot', e => { for (let i = 0; i < 3; i++) P().push({ type: 'spark', x: e.x + i * 4 - 4, y: e.y - 14, vx: i * 10 - 10, vy: -70 - i * 20, life: 0.9, max: 1, g: -10 }); }],
    ['open', 'snowy', e => ArtWorld.fx.snowPuff(P(), e.x, e.y - 6, 0.3)],
    ['open', 'wood', e => Sound.tone('triangle', 260, 180, 0.14, 0.05)],
  ];
  const BY = {};
  for (const r of RULES) { if (typeof r[1] === 'string') r[1] = [r[1]]; (BY[r[0]] = BY[r[0]] || []).push(r); }
  function apply(e) {
    const rs = BY[e.kind]; if (!rs || (e.who !== 'p' && !nearHero(e, I.farR))) return; // чужое далеко за кадром — без частиц и звука
    const pr = e.P = propsOf(e);
    for (const r of rs) {
      const need = r[1]; let ok = true;
      if (need) for (let i = 0; i < need.length && ok; i++) ok = pr.includes(need[i]);
      if (ok && (!r[3] || r[3](e))) r[2](e);
    }
  }

  function emit(kind, ev = {}) {
    ev.kind = kind;
    apply(ev);
    for (const fn of subs.get(kind) || NONE) fn(ev);
    for (const fn of subs.get('*') || NONE) fn(ev);
  }
  function tick(dt) {
  }
  return { on, emit, tick, PROPS, RULES };
})();
