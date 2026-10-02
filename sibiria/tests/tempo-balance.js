#!/usr/bin/env node
// Темп k=3 (CYCLE 1440) против k=1 (CYCLE 480, до замедления) на одном коде: страница k=1 — та же игра, data.js с CYCLE = 480.
//   cd tests && node tempo-balance.js
//   1. директор угроз: разведчиков и стай за игровую ночь (19:00→07:00) у костра — как при k=1 (±25 %, сумма по сидам, по главам)
//   2. посёлок: выработка за игровые сутки и на единицу съеденной еды — как при k=1 (±15 %)
//   3. отдых: стоя у костра ночь — силы не растут; на пне и в тёплой избе — растут; прогноз ночи Z считает так же
// Детерминированно: Math.random = mulberry(сид). Главный цикл на паузе (модалка), шаги — update(dt) вручную.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = process.env.SIBIR_ROOT || path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg' };
// /k1/… и /k3/… — одни файлы; у /k1/js/data.js темп прежний
const server = http.createServer((q, r) => {
  const m = /^\/(k1|k3)(\/[^?]*)/.exec(q.url); if (!m) { r.writeHead(404); return r.end(); }
  const f = path.join(ROOT, decodeURIComponent(m[2] === '/' ? '/index.html' : m[2]));
  fs.readFile(f, (e, buf) => {
    if (e) { r.writeHead(404); return r.end(); }
    if (m[1] === 'k1' && m[2] === '/js/data.js') buf = Buffer.from(String(buf).replace(/CYCLE = 1440\b/, 'CYCLE = 480'));
    r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); r.end(buf);
  });
});

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8], CHS = [0, 1, 2, 3];
// ---------- в странице ----------
function page(SEEDS, CHS) {
  UI.dialog = () => {}; UI.card = () => {}; UI.chapter = () => {}; Story.tick = () => {}; Bear.tick = () => {};
  const res = { k: HOUR / 20, wolves: {}, col: null, rest: null };
  function fresh(day, h, seed, ch) {
    Math.random = mulberry(seed); newGame(); state = 'play'; G.chapter = ch;
    G.time = tAt(day, h); G.day = dayOf(); G.lastDawn = G.day; G.storm = null; G.s.food = 100; G.s.warm = 90; G.s.hp = 100; input.mx = input.my = 0;
    Weather.newDay = () => { G.aurora = 0; }; // без пург: меряем директор, а не погоду
  }
  const field = () => { const p = G.p; p.x = HUT.x + 1400; p.y = HUT.y + 600; p.lx = p.x; p.ly = p.y; p.sx = p.x - 30; p.sy = p.y; Hero.snap(); };
  const untilMorning = (fn, dt = 0.05) => { const d0 = G.day; let n = 0; while (state === 'play' && !(G.day > d0 && hourOf() >= 7) && n++ < 1e6) { fn && fn(); update(dt); } };
  // 1. волки: ночь у костра, тело держим ровным (директор смотрит на напряжение — оно одно при обоих k)
  const sc0 = Wolves.spawnScout, pk0 = Wolves.spawnPack; let cnt = null;
  Wolves.spawnScout = () => { cnt.scout++; return sc0(); }; Wolves.spawnPack = (n, s) => { cnt.pack++; cnt.wolves += n; return pk0(n, s); };
  for (const ch of CHS) {
    const r = res.wolves[ch] = { scout: 0, pack: 0, wolves: 0 };
    for (const seed of SEEDS) {
      fresh(ch + 2, 19, seed, ch); field(); G.gear.kukhl = 1; G.fired.E5 = 1;
      Object.assign(G.D, { phase: 'build', budget: TUNE.director.budgetMax, calmT: 0, queued: null, omenT: 0, last: null });
      G.fires.push({ x: G.p.x + 40, y: G.p.y, fuel: 1e7 }); cnt = r;
      untilMorning(() => { G.s.hp = 100; G.s.warm = Math.max(G.s.warm, 80); G.s.food = 100; });
    }
  }
  Wolves.spawnScout = sc0; Wolves.spawnPack = pk0;
  // 2. посёлок: 2 бича рубят, 1 рыбачит, эвенк охотится; сутки 07:00→07:00. Едят сушёное из склада.
  {
    const C = res.col = { wood: 0, fish: 0, meat: 0, hare: 0, eaten: 0 };
    for (const seed of [3, 7]) {
      fresh(5, 7, seed, 3); Director.tick = () => {}; G.p.x = HUT.x + 40; G.p.y = HUT_IN.y1 + 90; G.p.inside = false;
      G.chest = { dried: 500 }; const rx = riverX(HUT.y + 200);
      const us = [Colony.spawn('bich'), Colony.spawn('bich'), Colony.spawn('bich'), Colony.spawn('evenk')];
      us[0].task = { k: 'chop', ph: 'go', near: { x: us[0].x, y: us[0].y } }; us[1].task = { k: 'chop', ph: 'go', near: { x: us[1].x, y: us[1].y } };
      us[2].task = { k: 'fish', ph: 'go', x: rx, y: HUT.y + 200 }; us[3].task = { k: 'hunt', ph: 'go' };
      untilMorning(() => { G.s.hp = 100; G.s.warm = 90; G.s.food = 100; G.wolves.length = 0; });
      for (const k of ['wood', 'fish', 'meat', 'hare']) C[k] += G.chest[k] || 0;
      C.eaten += 500 - (G.chest.dried || 0);
    }
    C.out = C.wood + C.fish + C.meat; C.perFood = C.out / C.eaten;
  }
  // 3. отдых (только темп k): сидит / стоит у костра / тёплая изба; прогноз ночи у костра против прожитой ночи
  {
    Director.tick = () => {}; const R = res.rest = {};
    const fire = () => G.fires.push({ x: G.p.x + 40, y: G.p.y, fuel: 1e7 });
    const hour = () => { for (let i = 0; i < HOUR / 0.05; i++) update(0.05); };
    fresh(2, 19, 5, 1); field(); fire(); G.gear.kukhl = 1; G.s.tire = 50; G.s.warm = 90;
    const fc = Survival.forecast(false); untilMorning(); R.fireNight = { t0: 50, t1: G.s.tire, fc: fc.tire, warm: G.s.warm, alive: state === 'play' };
    fresh(2, 21, 5, 1); field(); G.gear.kukhl = 1; G.s.tire = 50; G.s.warm = 90;
    const tr = G.trees.filter(t => t.wood > 0 && !t.wall).sort((a, b) => dist2(a, G.p) - dist2(b, G.p))[0]; tr.wood = 0;
    G.p.x = tr.x + 2; G.p.y = tr.y + 3; Hero.snap(); fire(); G.p.action = { k: 'rest', t: 0, dur: 1e6, pose: 'rest', loop: 1, o: tr, fb: 'sit' };
    hour(); R.stump = { t1: G.s.tire, warm: G.s.warm, act: G.p.action && G.p.action.k };
    fresh(2, 21, 5, 1); field(); fire(); G.s.tire = 50; G.s.warm = 90; const f0 = G.fires[G.fires.length - 1];
    G.p.action = { k: 'warm', t: 0, dur: 1e6, pose: 'warmHands', loop: 1, tg: f0, th: -8, o: f0, fl: 0 };
    hour(); R.warmHands = { t1: G.s.tire };
    fresh(2, 21, 5, 1); Object.assign(G.hut, { walls: 1, door: 1, fuel: 1e5 }); G.flags.stoveLit = 1;
    G.p.x = SPOT.stove.x + 20; G.p.y = SPOT.stove.y + 30; G.p.lx = G.p.x; G.p.ly = G.p.y; G.s.tire = 50; G.s.warm = 90; update(0.05);
    const fh = Survival.forecast(false); untilMorning(); R.hutNight = { t1: G.s.tire, fc: fh.tire, inside: G.p.inside };
    if (Survival.restLevel) R.lvl = { stand: Survival.restLevel({ moving: false, inside: false }, 5, 0), hut: Survival.restLevel({ moving: false, inside: true }, 8, 100),
      sit: Survival.restLevel({ moving: false, action: { k: 'rest' } }, 0, 0), walk: Survival.restLevel({ moving: true, inside: true }, 8, 100) };
  }
  return res;
}

(async () => {
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const out = [], errs = [], ok = (c, w) => { out.push((c ? 'ok   ' : 'FAIL ') + w); return c; };
  const R = {};
  try {
    await Promise.all(['k1', 'k3'].map(async k => {
      const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
      pg.on('pageerror', e => errs.push(`PAGEERR ${k} ${e.message}`));
      await pg.route(u => !u.href.startsWith(base), r => r.abort());
      await pg.goto(`${base}/${k}/index.html`, { waitUntil: 'domcontentloaded' });
      await pg.waitForFunction(() => typeof UI !== 'undefined' && typeof Survival !== 'undefined');
      await pg.evaluate(() => { localStorage.clear(); UI.openChest(); });
      R[k] = await pg.evaluate(`(${page})(${JSON.stringify(SEEDS)}, ${JSON.stringify(CHS)})`);
    }));
    const A = R.k1, B = R.k3, near = (a, b, rel) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * rel);
    ok(A.k === 1 && B.k === 3, `⏱ темп: k=${A.k} и k=${B.k}`);
    // 1. волки
    let s1 = 0, s3 = 0;
    for (const ch of CHS) {
      const a = A.wolves[ch], c = B.wolves[ch]; s1 += a.scout + a.pack; s3 += c.scout + c.pack;
      ok(near(c.scout, a.scout, 0.25) && near(c.pack, a.pack, 0.25),
        `🐺 гл.${ch + 1}, ${SEEDS.length} ночей у костра: разведчиков ${c.scout} (k=1: ${a.scout}), стай ${c.pack} (k=1: ${a.pack}), волков в стаях ${c.wolves} (${a.wolves})`);
    }
    ok(near(s3, s1, 0.15), `🐺 всего появлений за ${SEEDS.length * CHS.length} ночей: ${s3} (k=1: ${s1})`);
    // 2. посёлок
    const ca = A.col, cb = B.col;
    ok(cb.eaten === ca.eaten, `🍖 посёлок съел за сутки ${cb.eaten} (k=1: ${ca.eaten})`);
    ok(near(cb.perFood, ca.perFood, 0.15), `🪵 выработка на единицу еды ${cb.perFood.toFixed(2)} (k=1: ${ca.perFood.toFixed(2)}) · дрова ${cb.wood}/${ca.wood}, рыба ${cb.fish}/${ca.fish}, мясо ${cb.meat}/${ca.meat}`);
    // 3. отдых (k=3)
    const r = B.rest;
    ok(r.lvl && r.lvl.stand === 1 && r.lvl.hut === 2 && r.lvl.sit === 2 && r.lvl.walk === 0, `🪑 уровни отдыха: ${JSON.stringify(r.lvl)}`);
    ok(r.fireNight.alive && r.fireNight.t1 >= 50 && r.fireNight.warm > 40, `🔥 ночь стоя у костра: силы ${100 - r.fireNight.t0} → ${(100 - r.fireNight.t1).toFixed(1)} (не растут)`);
    ok(Math.abs(r.fireNight.fc - r.fireNight.t1) < 2, `🔮 прогноз Z у костра: силы ${(100 - r.fireNight.fc).toFixed(1)} · прожито ${(100 - r.fireNight.t1).toFixed(1)}`);
    ok(r.stump.act === 'rest' && r.stump.t1 < 50, `🪵 час на пне у огня: силы 50 → ${(100 - r.stump.t1).toFixed(1)}`);
    ok(r.warmHands.t1 > 50.5 && r.warmHands.t1 < 51.5, `🙌 час греет руки у огня: силы 50 → ${(100 - r.warmHands.t1).toFixed(1)} (бодрствование ×0.5)`);
    ok(r.hutNight.inside && r.hutNight.t1 < 40, `🏠 ночь стоя в тёплой избе: силы 50 → ${(100 - r.hutNight.t1).toFixed(1)}`);
    ok(Math.abs(r.hutNight.fc - r.hutNight.t1) < 2, `🔮 прогноз Z в избе: силы ${(100 - r.hutNight.fc).toFixed(1)} · прожито ${(100 - r.hutNight.t1).toFixed(1)}`);
  } catch (e) { out.push('FAIL ERR ' + e.message.split('\n')[0]); }
  finally { await b.close().catch(() => {}); server.close(); }
  for (const l of out) console.log(l);
  for (const e of errs.slice(0, 5)) console.log(e);
  const bad = out.filter(l => l.startsWith('FAIL')).length + errs.length;
  console.log(bad ? `\nFAIL: tempo-balance · провалов ${bad}` : '\nOK: tempo-balance · волки, посёлок, отдых — как при k=1');
  process.exit(bad ? 1 : 0);
})();
