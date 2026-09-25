(() => { const B = BOT, out = [];
  const fresh = () => { newGame(); state = 'play'; input.mx = input.my = 0; B.wolfHits = 0; B.wolfDmg = 0; B.bearDmg = 0; };
  const runFor = (sec, opts = {}) => { const t0 = B.T; let dead = null; const spawns = { n: 0 }; let prevW = 0;
    try { while (B.T - t0 < sec) { B.tick(); if (G.wolves.length > prevW) spawns.n += G.wolves.length - prevW; prevW = G.wolves.length; if (opts.each) opts.each(); } } catch (e) { dead = e.message; state = 'play'; }
    return { t: +(B.T - t0).toFixed(1), dead, hp: +G.s.hp.toFixed(0), warm: +G.s.warm.toFixed(0), spawns: spawns.n, bites: B.wolfHits, frost: G.s.frost }; };
  // 1. холод: стоим на улице без огня
  for (const [day, hr, cloth] of [[1, 12, ''], [1, 22, ''], [3, 22, ''], [5, 12, ''], [5, 22, ''], [5, 22, 'kukhl']]) {
    fresh(); G.time = tAt(day, hr); G.day = day; G.lastDawn = day; G.p.x = 1000; G.p.y = 2800; G.s.warm = 100; if (cloth) G.gear[cloth] = 1;
    G.D.budget = 0; G.D.phase = 'relax'; G.D.calmT = 1e9; // без волков
    const T = temperature(); const r = runFor(200, { each: () => { if (G.s.warm <= 0 && !r0) r0 = B.T; } }); var r0;
    out.push(`холод d${day} ${hr}:00 ${cloth || 'без одежды'} T=${T}: смерть через ${r.t} с (${r.dead})`);
  }
  // 2. волки: ночь на улице у костра / без, по главам
  for (const ch of [0, 1, 2, 3]) for (const fire of [false, true]) {
    fresh(); G.chapter = ch; G.day = ch + 1; G.time = tAt(G.day, 19.5); G.lastDawn = G.day; G.p.x = 1100; G.p.y = 2900; G.s.warm = 100; G.s.food = 100;
    G.gear.kukhl = 1; // чтобы не мёрзнуть
    G.inv.wood = 40; G.D.budget = 0; G.D.phase = 'build'; G.fired.E5 = 1;
    if (fire) { fireKey(); }
    const r = runFor(135, { each: () => { if (fire) { const f = nearest(G.fires, 100); if (f && f.fuel < 20) fireKey(); } if (G.s.warm < 60 && !fire) G.s.warm = 60; /* изолируем волков от холода */ } });
    out.push(`волки гл.${ch + 1} ${fire ? 'у костра' : 'без огня'} 19:30→07:00 (135 с): появилось ${r.spawns}, укусов ${r.bites}, hp ${r.hp}, ${r.dead || 'жив'}`);
  }
  // 3. стая без боя, сразу в лоб (стоим, не бьём)
  fresh(); G.chapter = 2; G.day = 3; G.time = tAt(3, 22); G.p.x = 1100; G.p.y = 2900; G.gear.kukhl = 1; G.D.phase = 'relax'; G.D.calmT = 1e9; G.fired.E5 = 1;
  spawnPack(4, false); const saveReflex = B.tick;
  let t0 = B.T, firstBite = null, dead = null;
  try { while (B.T - t0 < 120) { G.s.warm = 80; update(0.05); B.T += 0.05; if (G.s.hp < 100 && firstBite === null) firstBite = B.T - t0; if (state !== 'play') { dead = G.cause; break; } } } catch (e) {}
  out.push(`стая 4 волка, игрок пассивен: первый укус ${firstBite && firstBite.toFixed(1)} с, смерть ${dead ? (B.T - t0).toFixed(1) + ' с' : 'нет'}, hp ${G.s.hp.toFixed(0)}, волков ${G.wolves.length}`);
  state = 'play';
  // 3b. стая, игрок бьёт
  fresh(); G.chapter = 2; G.day = 3; G.time = tAt(3, 22); G.p.x = 1100; G.p.y = 2900; G.gear.kukhl = 1; G.D.phase = 'relax'; G.D.calmT = 1e9; G.fired.E5 = 1;
  spawnPack(4, false); let r = runFor(120, { each: () => { G.s.warm = 80; } });
  out.push(`стая 4, игрок бьёт: укусов ${r.bites}, hp ${r.hp}, убито ${G.stats.wolves}, осталось ${G.wolves.length}, ${r.dead || 'жив'}`);
  // 3c. осада дня 3 с вожаком, игрок в поле с факелами? без
  fresh(); G.chapter = 2; G.day = 3; G.time = tAt(3, 21.01); G.p.x = 1100; G.p.y = 2900; G.gear.kukhl = 1; G.D.phase = 'relax'; G.D.calmT = 1e9;
  r = runFor(120, { each: () => { G.s.warm = 80; } });
  out.push(`осада д3 (4+вожак) в поле, бьёт: укусов ${r.bites}, hp ${r.hp}, убито ${G.stats.wolves}, ${r.dead || 'жив'}`);
  // 3d. осада: в избе без двери, печь горит
  fresh(); G.chapter = 2; G.day = 3; G.time = tAt(3, 20.9); G.hut.fuel = 300; G.p.x = HUT.x; G.p.y = HUT.y; G.D.phase = 'relax'; G.D.calmT = 1e9;
  r = runFor(90, {});
  out.push(`осада в избе без двери, печь горит: укусов ${r.bites}, hp ${r.hp}, ${r.dead || 'жив'}`);
  fresh(); G.chapter = 2; G.day = 3; G.time = tAt(3, 20.9); G.hut.fuel = 0; G.p.x = HUT.x; G.p.y = HUT.y; G.D.phase = 'relax'; G.D.calmT = 1e9;
  r = runFor(90, {});
  out.push(`осада в избе без двери, печь холодная: укусов ${r.bites}, hp ${r.hp}, warm ${r.warm}, ${r.dead || 'жив'}`);
  // 4. медведь: гл. IV ночь, игрок у куч
  for (const resp of [0, 2]) for (const torch of [false, true]) {
    fresh(); G.chapter = 3; G.day = 5; G.time = tAt(5, 21); G.p.x = POI.mar.x; G.p.y = POI.mar.y; G.gear.kukhl = 1; G.urk.respect = resp; G.D.phase = 'relax'; G.D.calmT = 1e9; G.fired.E6 = 1;
    let hitsTaken = 0, prevHp = 100, spawned = null;
    r = runFor(100, { each: () => { G.s.warm = 80; if (G.bear && spawned === null) { spawned = B.T; G.bear.x = G.p.x + 300; G.bear.y = G.p.y; } if (torch && G.p.torch <= 0) G.p.torch = 60; if (G.s.hp < prevHp - 20) hitsTaken++; prevHp = G.s.hp; } });
    out.push(`медведь resp=${resp} ${torch ? 'с факелом' : 'без факела'}: ударов ${hitsTaken}, hp ${r.hp}, bear ${G.bear ? G.bear.st + ' hp' + G.bear.hp : (G.flags.bearDead ? 'убит' : 'ушёл')}, ${r.dead || 'жив'}`);
  }
  return out.join('\n'); })()
