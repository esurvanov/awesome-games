// Автомат тела героя (Hero.pose / Hero.sync, js/hero.js): каждое состояние × каждое событие, инварианты каждый кадр 1.5 с после события.
//   (a) нет ходьбы/бега без ввода движения (кроме верхом)
//   (b) под вводом движения — не дольше commit позы не-ходьба
//   (c) animT конечен и в [0,1]; нет NaN
//   (d) тело никем не занято (нет действия, разовой позы, сна, нарт, панели, скольжения) → ровно walk при вводе, иначе idle; разовая поза не дольше своей длительности
//   (e) face / vy конечны; нарисована та же поза, что решил автомат
// В браузере (страница игры; начинает новую партию в памяти, чекпоинт не пишет — после проверки перезагрузить страницу):
//   (0,eval)(await (await fetch('tests/body-check.js')).text()); BodyCheck.run()
// Playwright (как tests/run.js):  cd tests && node body-check.js
var BodyCheck = (() => {
  if (typeof window === 'undefined') return null;
  const DT = 1 / 60, SEC = 1.5, COMMIT_MAX = 0.3; // commit сверху ограничен здесь, а не автоматом: проверка не верит проверяемому
  const LOCO = a => ['walk', 'run', 'limp', 'carry'].includes(a) || !!(ArtPeople.POSE[a] && ArtPeople.POSE[a].loco);
  let hold = 0, drawn = null;
  const P = () => G.p;
  function base() {
    const p = P(); UI.closePanel(); p.ride = null; p.sleeping = false; p.action = null; p.swing = 0; G.hurt = 0; p.torch = 0; p.cd = 0;
    p.x = POI.cockpit.x + 60; p.y = POI.cockpit.y + 120; p.face = 1; p.moving = false; Hero.snap(); hold = 0;
    if (G.veh && G.veh.buran) G.veh.buran.x = -9999; // оставленный «Буран» не перехватывает E
    G.wolves = []; G.bear = null; G.s.hp = G.s.food = G.s.warm = 100; G.hut.fuel = 900; input.act = false;
    Hero.bodyReset();
  }
  const ice = () => { for (let k = 0; k < 400; k++) { const y = POI.polynya.y + 600 + k * 7, x = riverX(y) + ((k % 5) - 2) * 12; if (Depth.bareIce(x, y)) return { x, y }; } const y = POI.polynya.y + 600; return { x: riverX(y), y }; }; // голый лёд (скользят только по нему)
  function nearTree() {
    const p = P(), t = G.trees.filter(t => t.wood > 0 && !t.wall && !onIce(t.x + 30, t.y)).sort((a, b) => dist2(a, p) - dist2(b, p))[0];
    t.wood = 9; p.x = t.x + 30; p.y = t.y; p.face = -1; Hero.snap(); return t;
  }
  function mountable() { const v = G.veh.buran || (G.veh.buran = { x: 0, y: 0, face: 1, fixed: 1, fuel: 0 }); v.x = P().x; v.y = P().y; v.fixed = 1; v.fuel = 500; return v; }
  const openDlg = () => UI.dialog({ who: 'radio', t: '…ш-ш-ш…', opts: [{ t: 'ok' }] });
  // исходные состояния: как в них попасть и сколько с до события
  const STATES = {
    idle: [() => {}, 0.3],
    walk: [() => { hold = 1; }, 0.3],
    act: [() => { P().action = { k: 'bctest', t: 0, dur: 1, pose: 'craft', loop: 1, fb: 'build' }; }, 0.3],
    chop: [() => { nearTree(); Actions.interact(); }, 0.4],
    // рубка по-настоящему (js/actions.js): вытаптывает площадку по кругу, перекатывает ствол, отходит от падающей ели
    trample: [() => { const t = nearTree(), p = P(); p.action = { k: 'trample', t: 0, dur: 6, o: t, pose: 'trample', loop: 1, per: 1.24, fb: 'trudge', a0: Math.atan2((p.y - t.y - 3) / 0.7, p.x - t.x), R: 30, x0: p.x, y0: p.y, st: 0, dir: 1 }; }, 0.4],
    roll: [() => { const t = nearTree(), p = P(); t.wood = 0; World.felled(t); const L = Actions.fell(t); delete L.f; L.a = 0; p.x = L.x + 30; p.y = L.y + 16; Hero.snap(); p.action = { k: 'roll', t: 0, dur: 2.4, o: L, pose: 'rollLog', fb: 'pry', tg: { x: L.x + 30, y: L.y + 5 }, th: -4, r0: 0, r1: 1.5, x0: L.x, y0: L.y, sx: 0, sy: -2 }; }, 0.4],
    backoff: [() => { const p = P(); p.backoff = now + 3; Actions.walkTo(p.x + 70, p.y + 20, 3, () => {}); }, 0.2],
    gesture: [() => Hero.play('lookAround'), 0.1],
    react: [() => Hero.play('pickUp', { react: 1, tg: { x: P().x + 20, y: P().y } }), 0.1],
    hurt: [() => { G.hurt = 1; }, 0.05],
    panel: [openDlg, 0.3],
    sleep: [() => { const p = P(); p.x = SPOT.bed.x; p.y = SPOT.bed.y + 4; p.sleeping = true; Hero.snap(); }, 0.3],
    ride: [() => { mountable(); Transport.mount('buran'); }, 0.3],
    glide: [() => { const p = P(), q = ice(); p.x = q.x; p.y = q.y; Hero.snap(); p.vx = 170; }, 0.1],
  };
  const EVENTS = {
    moveDown: () => { hold = 1; },
    moveUp: () => { hold = 0; },
    ePress: () => Actions.interact(),
    actionEnd: () => { const a = P().action; if (a) a.t = Math.max(a.t, a.dur - 1e-6); },
    actionCancel: () => { P().action = null; },
    snap: () => { P().x += 26; },                  // рывок без пометки (как отскок волка/шатуна)
    teleport: () => { P().x += 60; P().y += 30; },
    bump: () => { const p = P(); Interact.emit('bump', { who: 'p', x: p.x + 10, y: p.y, obj: 'none', target: null, power: 0.8, nx: -1, ny: 0, inside: p.inside }); },
    howl: () => Interact.emit('howl', { who: 'howl', x: P().x, y: P().y }),
    hurt: () => { G.hurt = 1; },
    panelOpen: openDlg,
    panelClose: () => UI.closePanel(),
    glideStart: () => { const p = P(), q = ice(); if (!Depth.bareIce(p.x, p.y)) { p.x = q.x; p.y = q.y; } p.vx = 170; },
    glideStop: () => { P().vx = P().vy = 0; },
    mount: () => { if (!P().ride) { mountable(); Transport.mount('buran'); } },
    dismount: () => { if (P().ride) Transport.dismount(); },
    sleep: () => { const p = P(); p.sleeping = true; p.action = null; Hero.snap(); },
    wake: () => { if (P().sleeping) Actions.wake(false, 'проверка'); },
    dodge: () => { P().dashCd = 0; Hero.dodge(); },   // отскок (Shift): рывок и поза dodge
  };
  // кадр как в игре: ввод (в панели — нулевой, как syncMove), шаг мира или «дыхание» панели, время, рисование
  function frame(render) {
    const k = !!UI.kind; input.mx = k ? 0 : hold; input.my = 0; state = 'play'; G.wolves = [];
    if (k) Game.visual(DT); else update(DT);
    now += DT; drawn = null;
    if (render) { GFX.lookAt(P().x, P().y); GFX.render(DT, null); }
    return Hero.pose();
  }
  function check(b, ctx, render) {
    const p = P(), B = Hero.body, inp = Math.hypot(input.mx, input.my) > 0.15, f = [];
    if (LOCO(b.anim) && !inp && b.st !== 'ride') f.push('a: ' + b.anim + ' без ввода');
    if (inp && !['walk', 'ride', 'sleep'].includes(b.st)) { ctx.busy += DT; const c = Math.min(B.one ? B.one.commit : 0, COMMIT_MAX); if (ctx.busy > c + 2.5 * DT) f.push('b: ' + b.st + '/' + b.anim + ' под вводом ' + ctx.busy.toFixed(2) + ' с'); } else ctx.busy = 0;
    if (!Number.isFinite(b.animT) || b.animT < 0 || b.animT > 1) f.push('c: animT ' + b.animT);
    if (!Number.isFinite(b.speed)) f.push('c: speed ' + b.speed);
    if (!p.action && !p.sleeping && !p.ride && !B.one && !UI.kind && !B.glide && b.st !== (inp ? 'walk' : 'idle')) f.push('d: ' + b.st + ' вместо ' + (inp ? 'walk' : 'idle'));
    if (B.one && now - B.one.t0 > B.one.dur + 1.5 * DT) f.push('d: разовая ' + B.one.k + ' дольше длительности');
    if (!Number.isFinite(p.face) || !p.face || !Number.isFinite(b.vy) || Math.abs(b.vy) > 1) f.push('e: face/vy ' + p.face + '/' + b.vy);
    if (render && drawn && drawn !== b.anim) f.push('e: нарисовано ' + drawn + ', автомат ' + b.anim);
    return f;
  }
  function run(o = {}) {
    const render = o.render !== false, keep = { cp: SaveGame.checkpoint, rnd: Math.random, draw: ArtPeople.draw, toast: Fx.toast };
    SaveGame.checkpoint = () => {}; Math.random = mulberry(o.seed || 7); Fx.toast = () => {};
    ArtPeople.draw = function (g, d) { if (d && d.key === G.p) drawn = d.anim; return keep.draw.apply(this, arguments); };
    const fails = [], seen = new Set(), from = {}; let pairs = 0;
    try {
      newGame(); state = 'play'; G.time = tAt(1, 14); Hero.bodyReset();
      for (const sk in STATES) for (const ek in EVENTS) {
        base(); const [setup, pre] = STATES[sk]; setup();
        for (let t = 0; t < pre; t += DT) frame(render);
        const st0 = Hero.pose().st; (from[sk] = from[sk] || {})[st0] = 1; EVENTS[ek](); pairs++;
        const ctx = { busy: 0 }, key = sk + ' × ' + ek;
        for (let t = 0; t < SEC; t += DT) {
          const b = frame(render), f = check(b, ctx, render);
          for (const m of f) { const id = key + ' ' + m.slice(0, 2); if (!seen.has(id)) { seen.add(id); fails.push({ state: sk, from: st0, event: ek, at: +t.toFixed(2), msg: m }); } }
        }
      }
    } finally { SaveGame.checkpoint = keep.cp; Math.random = keep.rnd; ArtPeople.draw = keep.draw; Fx.toast = keep.toast; hold = 0; input.mx = input.my = 0; }
    const res = { pairs, frames: pairs * Math.round(SEC / DT), fails: fails.length, from: Object.fromEntries(Object.entries(from).map(([k, v]) => [k, Object.keys(v).join('|')])), list: fails.slice(0, 40) };
    if (typeof console !== 'undefined') console.log('BodyCheck', res.pairs, 'пар,', res.fails, 'провалов', res.list);
    return res;
  }
  return { run, STATES, EVENTS };
})();

if (typeof window === 'undefined' && typeof require === 'function') {
  const { chromium } = require('playwright'), path = require('path'), fs = require('fs');
  (async () => {
    const b = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const pg = await b.newPage({ viewport: { width: 1280, height: 800 } }), errs = [];
      pg.on('pageerror', e => errs.push(e.message));
      await pg.goto('file://' + path.resolve(__dirname, '../index.html'), { waitUntil: 'domcontentloaded' });
      await pg.waitForTimeout(800);
      await pg.evaluate(src => (0, eval)(src), fs.readFileSync(__filename, 'utf8'));
      const r = await pg.evaluate(() => BodyCheck.run());
      console.log(JSON.stringify(r, null, 1)); if (errs.length) console.log(errs.join('\n'));
      process.exitCode = r.fails || errs.length ? 1 : 0;
    } finally { await b.close(); }
  })();
}
