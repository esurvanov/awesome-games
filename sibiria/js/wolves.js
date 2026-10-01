'use strict';
// Волки: разведчик, стая (кружит у огня, выпады по одному), осада избы, вожак; удары героя.
const Wolves = (() => {
  const WF = TUNE.wolf;
  function at(a, d, extra) {
    const p = G.p;
    const w = { x: clamp(p.x + Math.cos(a) * d, 60, W - 60), y: clamp(p.y + Math.sin(a) * d, 60, H - 60), vx: 0, vy: 0, hp: WF.hp, cd: 0, t: 0,
      face: 1, step: 0, dir: Math.random() < 0.5 ? -1 : 1, st: 'circle', ang: 0, pr: 0 };
    Object.assign(w, extra); w.ang = Math.atan2(w.y - p.y, w.x - p.x);
    G.wolves.push(w); return w;
  }
  function spawnScout() { at(G.D.dir, rnd(WF.scoutD[0], WF.scoutD[1]), { st: 'scout', t: rnd(WF.scoutT[0], WF.scoutT[1]) }); }
  function spawnPack(n, siege) {
    const a0 = G.D.dir || Math.random() * 6.28;
    G.pack = { R: WF.packR, lungeT: 4, protT: 0, hurt: 0, killed: 0, leader: siege, leaderHurt: 0 };
    for (let i = 0; i < n; i++) at(a0 + (i - n / 2) * 0.35, rnd(WF.packD[0], WF.packD[1]), {});
    if (siege) at(a0, WF.leaderD, { hp: WF.leaderHp, leader: 1 });
  }
  function retreatAll() { for (const w of G.wolves) { w.st = 'retreat'; } if (G.pack) G.pack.retreat = 1; G.pack = null; }

  // удар героя
  function hit(w) {
    const p = G.p, dmg = (p.torch > 0 ? 2 : 1) + 0.5 * (Hero.lvl('hunt') - 1);
    w.hp -= dmg; p.swing = 0.25; p.cd = 0.4; p.face = Math.sign(w.x - p.x) || p.face;
    // отлёт телом: скорость от удара гаснет за ~0,4 с (≈ 32 px), без скачка
    const a = Math.atan2(w.y - p.y, w.x - p.x); w.kx = Math.cos(a) * 260; w.ky = Math.sin(a) * 260;
    w.st = 'flee'; w.t = 1.2; ArtWorld.fx.blood(G.parts, w.x, w.y, G.decals = G.decals || []); Sound.hit();
    if (G.pack) { if (!w.hurt) { w.hurt = 1; G.pack.hurt++; } if (w.leader) G.pack.leaderHurt += dmg; }
    if (w.leader && G.pack && G.pack.leaderHurt >= WF.leaderBeat && G.urk.wolfQuest) G.flags.leaderDone = 1;
    if (w.hp <= 0) {
      // убит: тело валится и скользит по снегу (туша, js/carry.js) — шкура и мясо только разделкой
      G.wolves.splice(G.wolves.indexOf(w), 1); G.stats.wolves++; Hero.xp('hunt', 2); Carry.carcass(w.leader ? 'wolfLeader' : 'wolf', w.x, w.y, w.kx * 0.8, w.ky * 0.8);
      Fx.burst(w.x, w.y - 10, 10, '#7d858f', 100);
      if (G.pack) G.pack.killed++;
      if (w.leader) { G.flags.leaderDone = 1; Fx.toast(':wolf: Вожак убит — стая уходит'); retreatAll(); }
    }
  }

  function tick(dt, night) {
    const p = G.p, pk = G.pack, prot = Fire.protection(), dawn = night < 0.4;
    if (pk) {
      pk.R = Math.max(WF.packRmin, pk.R - 10 * dt); pk.lungeT -= dt;
      pk.protT = prot ? pk.protT + dt : 0;
      if (dawn || (!pk.leader && (pk.hurt >= 2 || pk.killed >= 1)) || pk.protT > WF.protGiveUp || (pk.leader && pk.leaderHurt >= WF.leaderBeat)) retreatAll();
    }
    let lunging = G.wolves.some(w => w.st === 'lunge' || w.st === 'crouch');
    // осада: волки скребут дверь при холодной печи
    if (p.inside && G.hut.door && G.hut.fuel <= 0 && G.wolves.some(w => Math.hypot(w.x - HUT.x, w.y - (HUT_IN.y1 + 20)) < 70)) {
      G.hut.doorHp -= dt * WF.doorDmg;
      if (G.hut.doorHp <= 0) { G.hut.door = 0; G.hut.doorHp = 100; Fx.toast(':door: Дверь выломали!'); Fx.shake(10); }
    }
    for (let i = G.wolves.length - 1; i >= 0; i--) {
      const w = G.wolves[i];
      w.cd = Math.max(0, w.cd - dt); w.t -= dt;
      let tx = w.x, ty = w.y, sp = 0, direct = false;
      const dp = dist(w, p), ap = Math.atan2(w.y - p.y, w.x - p.x);
      const ws = stormOn(), wdx = ws ? Math.cos(Wind.dir()) : 0, wdy = ws ? Math.sin(Wind.dir()) : 0;
      if (dawn && w.st !== 'retreat') w.st = 'retreat';
      switch (w.st) {
        case 'scout': {
          const a = ap + 0.3 * w.dir * dt * 3; tx = p.x + Math.cos(a) * 420; ty = p.y + Math.sin(a) * 420; sp = 95;
          // пурга: разведчик идёт по ветру (запах несёт от героя) и, выдохшись, ложится в снег, а не бросается
          if (ws) { tx = w.x + wdx * 120; ty = w.y + wdy * 120; sp = 60; if (w.t <= 0) { w.st = 'lie'; w.t = 8 + (i % 3) * 3; } break; }
          if (w.t <= 0) { const prt = Fire.protection(); if (!prt && Math.random() < 0.4) { w.st = 'crouch'; w.t = 0.6; Sound.src(w).growl(0.15); } else w.st = 'retreat'; }
          break;
        }
        case 'circle': {
          // люди посёлка — добыча, если ближе героя (или герой под защитой огня)
          let prey = null, pd = WF.preyR * WF.preyR;
          for (const u of Space.units.near(w.x, w.y, WF.preyR)) { const d = dist2(u, w); if (!u.hidden && d < pd && (prot || d < dist2(p, w))) { pd = d; prey = u; } }
          if (prey) {
            tx = prey.x; ty = prey.y; sp = 150;
            if (dist2(prey, w) < 28 * 28 && w.cd <= 0) { prey.hp -= WF.biteUnit * Settings.diff().wolf; w.cd = WF.biteCd; w.st = 'flee'; w.t = 0.6; Sound.src(prey).bite(); Fx.burst(prey.x, prey.y - 12, 8, '#c0392b'); }
            break;
          }
          const c = prot || p, R = prot ? prot.r + 50 : (pk ? pk.R : 220);
          w.ang = Math.atan2(w.y - c.y, w.x - c.x) + 0.4 * w.dir * dt * 2;
          tx = c.x + Math.cos(w.ang) * R; ty = c.y + Math.sin(w.ang) * R; sp = 110;
          if (!prot && !lunging && pk && pk.lungeT <= 0 && dp < 320) {
            w.st = 'crouch'; w.t = 0.6; lunging = true; pk.lungeT = rnd(2, 3.5); Sound.src(w).growl(0.12);
          }
          if (!pk && !prot) { w.st = 'crouch'; w.t = 0.6; }
          break;
        }
        case 'crouch': w.face = Math.sign(p.x - w.x) || w.face; if (w.t <= 0) { w.st = 'lunge'; w.t = 1; const a = Math.atan2(p.y - w.y, p.x - w.x); w.lx = Math.cos(a) * 190; w.ly = Math.sin(a) * 190; } break;
        case 'lunge':
          direct = true; w.vx = w.lx; w.vy = w.ly;
          if (w.t <= 0 || prot) { w.st = 'circle'; break; }
          if (dp < 30 && w.cd <= 0 && !(p.inside && G.hut.door) && !(p.iT > 0)) {
            p.iT = 1.1;
            G.s.hp -= WF.bite * Settings.diff().wolf; G.s.warm = Math.max(0, G.s.warm - WF.biteWarm); w.cd = WF.biteCd; G.cause = 'wolf'; G.hurt = 1; Fx.shake(9);
            p.x += Math.cos(ap + Math.PI) * 18; p.y += Math.sin(ap + Math.PI) * 18; World.solid(p, 10, 'p'); p.action = null; Sound.bite(); // отброс — не сквозь стволы/стены
            ArtWorld.fx.blood(G.parts, p.x, p.y, G.decals = G.decals || []); w.st = 'flee'; w.t = 0.8;
            if (p.sleeping) Actions.wake(false, ':wolf: Волк!');
          }
          break;
        case 'flee': tx = w.x + Math.cos(ap) * 100; ty = w.y + Math.sin(ap) * 100; sp = 170; if (w.t <= 0) w.st = G.pack ? 'circle' : 'retreat'; break;
        case 'lie': sp = 0; w.vx *= 0.8; w.vy *= 0.8; if (w.t <= 0 || dp < 160 || !ws) w.st = 'retreat'; break; // лежит, мордой в хвост; спугнули/стихло — уходит
        case 'retreat': tx = w.x + (ws ? wdx : Math.cos(ap)) * 100; ty = w.y + (ws ? wdy : Math.sin(ap)) * 100; sp = ws ? 120 : 170; // в пургу уходят по ветру
          if (dp > WF.goneR) { G.wolves.splice(i, 1); continue; } break;
      }
      if (!direct) {
        if (sp > 0 && (tx - w.x) ** 2 + (ty - w.y) ** 2 > 40 * 40) { const q = Nav.way(w, tx, ty); if (q.x !== tx || q.y !== ty) { const l0 = Math.hypot(tx - w.x, ty - w.y), l1 = Math.hypot(q.x - w.x, q.y - w.y) || 1; tx = w.x + (q.x - w.x) / l1 * l0; ty = w.y + (q.y - w.y) / l1 * l0; } }
        let vx = tx - w.x, vy = ty - w.y; const l = Math.hypot(vx, vy) || 1;
        vx = vx / l * Math.min(sp, l * 4); vy = vy / l * Math.min(sp, l * 4);
        for (const f of Fire.burning()) {
          const r = Fire.fearR(f), dx = w.x - f.x, dy = w.y - f.y, dd = Math.hypot(dx, dy);
          if (dd < r && dd > 0.1) { const k = (r - dd) * 3; vx += dx / dd * k; vy += dy / dd * k; }
        }
        const TR = TUNE.fire.torchR;
        if (p.torch > 0 && dp < TR && dp > 0.1) { vx += (w.x - p.x) / dp * (TR - dp) * 3; vy += (w.y - p.y) / dp * (TR - dp) * 3; }
        w.vx += (vx - w.vx) * Math.min(1, dt * 5); w.vy += (vy - w.vy) * Math.min(1, dt * 5);
      }
      if (w.kx || w.ky) { const e = Math.exp(-dt * 8); w.x += w.kx * dt; w.y += w.ky * dt; w.kx *= e; w.ky *= e; if (Math.hypot(w.kx, w.ky) < 6) { w.kx = 0; w.ky = 0; } }   // отлёт от удара
      w.x += w.vx * dt; w.y += w.vy * dt; World.solid(w, 12, 'w');
      if (Math.abs(w.vx) > 5) w.face = Math.sign(w.vx);
      const spd = Math.hypot(w.vx, w.vy); w.step += dt * spd * 0.08;
      if (spd > 20) { w.pr += dt; if (w.pr > 0.3) { w.pr = 0; Fx.print(w.x, w.y, Math.atan2(w.vy, w.vx), 'w'); } }
    }
  }
  return { at, spawnScout, spawnPack, retreatAll, hit, tick };
})();
