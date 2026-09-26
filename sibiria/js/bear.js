'use strict';
// Шатун (глава IV): выходит ночью, ворошит сигнальные кучи, идёт набегом на посёлок и избу, охотится на героя.
// Дед (уважение ≥ TUNE.bear.urkRespect) стреляет в него — раз за ночь.
const Bear = (() => {
  const B = TUNE.bear;
  // «ночь» шатуна: вечер и утро после него — одна ночь (номер дня вечера)
  const nightKey = (h = hourOf()) => h < 12 ? G.day - 1 : G.day;
  // передышка: эту ночь шатун не выходит (глава IV началась ночью — после осады)
  function respite() { if (1 - daylight() > B.respiteDark) G.bearNight = nightKey(); }

  function hit(b) {
    const p = G.p; p.swing = 0.25; p.cd = 0.45;
    if (p.torch > 0 && b.stunCd <= 0) { b.st = 'stun'; b.t = 1; b.stunCd = 4; Fx.toast(':fire: Шатун отпрянул'); }
    b.hp -= (p.torch > 0 ? 1.5 : 1) + 0.15 * (Hero.lvl('hunt') - 1); Fx.burst(b.x, b.y - 20, 10, '#6b4f3a'); // шкура толстая: подранить можно, добить — трудно Sound.hit();
    if (b.hp <= 0) { Fx.corpse('bear', b.x, b.y); G.bear = null; G.flags.bearDead = 1; Inv.add('meat', 4); Hero.xp('hunt', 5); Fx.toast(':bear: Шатун повержен'); Sound.ok2(); }
  }

  function tick(dt, h, night) {
    const p = G.p;
    const nk = nightKey(h);
    if (!G.bear && G.chapter >= B.chapter && !G.flags.bearDead && night > 0.6 && G.bearNight !== nk) {
      G.bearNight = nk;
      const a = Math.random() * 6.28;
      const hp = G.flags.bearWounded ? B.hpWounded : B.hp;
      G.bear = { x: POI.mar.x + Math.cos(a) * 420, y: POI.mar.y + Math.sin(a) * 420, hp, hp0: hp, st: 'wander', t: 3, face: 1, step: 0, cd: 0, stunCd: 0, pr: 0, tgt: 0, raid: 0 };
      Sound.treeCrack(); setTimeout(() => Sound.growl(0.2), 1500);
      Fx.toast(':bear: Треск в тайге. Шатун вышел');
    }
    const b = G.bear; if (!b) return;
    b.t -= dt; b.cd = Math.max(0, b.cd - dt); b.stunCd = Math.max(0, b.stunCd - dt);
    const dp = dist(b, p), ap = Math.atan2(p.y - b.y, p.x - b.x);
    let tx = b.x, ty = b.y, sp = 0, direct = false;
    if (night < 0.3 && b.st !== 'flee') { b.st = 'flee'; b.t = 8; }
    switch (b.st) {
      case 'wander': {
        // ночь шатуна: одна куча на мари, потом — к посёлку и избе (ломает постройки, дверь, ворует еду)
        if (b.raid) { const q = raid(b, dt); tx = q.x; ty = q.y; sp = 75; }
        else {
          const s = G.stacks[b.tgt % 3]; tx = s.x; ty = s.y; sp = 60;
          if (dist(b, s) < 30) {
            if (s.wood > 0 && !s.lit && dist(p, s) > 200 && b.t <= 0 && s.bearN !== G.bearNight) { s.wood--; s.bearN = G.bearNight; Fx.toast(':bear: Шатун разворошил кучу'); b.t = 5; }
            if (b.t <= 0) { b.tgt++; b.t = 4; b.raid = 1; }
          }
        }
        if (dp < B.huntR && !(p.inside && G.hut.door)) { b.st = 'hunt'; Sound.growl(0.35); }
        break;
      }
      case 'hunt':
        tx = p.x; ty = p.y; sp = 120;
        if (p.inside && G.hut.door) { b.st = 'wander'; break; }
        if (dp < 75 && b.cd <= 0) { b.st = 'windup'; b.t = 0.65; Sound.growl(0.3); }
        else if (dp > 150 && dp < 300 && b.cd <= 0 && Math.random() < dt * 0.5) { b.st = 'charge'; b.t = 1.5; b.lx = Math.cos(ap) * 200; b.ly = Math.sin(ap) * 200; }
        else if (dp > 650) b.st = 'wander';
        break;
      case 'fleeHurt': tx = b.x - Math.cos(ap) * 100; ty = b.y - Math.sin(ap) * 100; sp = 130; if (b.t <= 0 || dp > 900) { G.bear = null; return; } break;
      case 'windup':
        b.face = Math.sign(p.x - b.x) || b.face;
        if (b.t <= 0) {
          if (dp < 88 && !(p.iT > 0)) {
            p.iT = 1.1; G.s.hp -= B.swipe * Settings.diff().wolf; G.cause = 'bear'; G.hurt = 1; Fx.shake(18); p.x += Math.cos(ap) * 50; p.y += Math.sin(ap) * 50; p.action = null; Sound.bite();
            Fx.burst(p.x, p.y - 16, 16, '#c0392b');
          }
          b.st = 'hunt'; b.cd = 1.1;
        }
        break;
      case 'charge': direct = true; b.vx = b.lx; b.vy = b.ly; if (b.t <= 0) b.st = 'hunt'; if (dp < 40 && b.cd <= 0) { b.st = 'windup'; b.t = 0.3; } break;
      case 'stun': if (b.t <= 0) b.st = 'hunt'; break;
      case 'flee': tx = b.x - Math.cos(ap) * 100; ty = b.y - Math.sin(ap) * 100; sp = 150; if (b.t <= 0 || dp > 1000) { G.bear = null; return; } break;
    }
    // подранок уходит до следующей ночи
    if (b.hp <= b.hp0 * B.hurtFlee && b.st !== 'fleeHurt' && b.st !== 'flee') { b.st = 'fleeHurt'; b.t = 10; G.flags.bearWounded = 1; Fx.toast(':bear: Шатун уходит, огрызаясь · вернётся'); Sound.growl(0.4); }
    // дед стреляет — раз за ночь (исправление: раньше — раз за игру)
    if (G.urk.respect >= B.urkRespect && G.flags.urkShotN !== G.bearNight && (b.st === 'hunt' || b.st === 'windup' || b.st === 'charge') && dp < B.urkR) {
      G.flags.urkShot = 1; G.flags.urkShotN = G.bearNight; G.flags.bearWounded = 1; b.hp -= B.urkDmg; b.st = 'flee'; b.t = 6; Sound.shot(); Fx.shake(6);
      Fx.toast(':rifle: Уркачан выстрелил! Шатун ушёл');
    }
    if (!direct) {
      if (sp > 0 && (tx - b.x) ** 2 + (ty - b.y) ** 2 > 50 * 50) { const q = Nav.way(b, tx, ty); if (q.x !== tx || q.y !== ty) { const l0 = Math.hypot(tx - b.x, ty - b.y), l1 = Math.hypot(q.x - b.x, q.y - b.y) || 1; tx = b.x + (q.x - b.x) / l1 * l0; ty = b.y + (q.y - b.y) / l1 * l0; } }
      let vx = tx - b.x, vy = ty - b.y; const l = Math.hypot(vx, vy) || 1;
      b.vx = vx / l * Math.min(sp, l * 4); b.vy = vy / l * Math.min(sp, l * 4);
    }
    if (b.st === 'windup' || b.st === 'stun') { b.vx = 0; b.vy = 0; }
    b.x += b.vx * dt; b.y += b.vy * dt; World.solid(b, Math.abs(b.x - HUT.x) < 160 && Math.abs(b.y - HUT.y) < 160 ? 11 : 20, 'b');
    if (Math.abs(b.vx) > 5) b.face = Math.sign(b.vx);
    const spd = Math.hypot(b.vx, b.vy); b.step += dt * spd * 0.05;
    if (spd > 20) { b.pr += dt; if (b.pr > 0.45) { b.pr = 0; Fx.print(b.x, b.y, Math.atan2(b.vy, b.vx), 'b'); } }
    if (World.onThinIce(b)) {
      G.bear = null; G.flags.bearDead = 1; Sound.splash(); Sound.growl(0.4); Fx.shake(12);
      Fx.burst(b.x, b.y, 30, '#9fd0ee', 180); Fx.toast(':frost: Шатун ушёл под лёд!');
    }
  }

  // набег шатуна: цель — постройка посёлка (коптильня первой) или дверь избы; возвращает точку, куда идти
  function raid(b, dt) {
    const p = G.p;
    if (p.sleeping && dist2(b, HUT) < B.wakeR * B.wakeR) Actions.wake(false, ':bear: Шатун у избы!');
    let bl = b.rid ? G.col.builds.find(q => q.id === b.rid && q.done) : null;
    if (!bl && !b.rHut) {
      const list = G.col.builds.filter(q => q.done && !BUILDS[q.type].flat && q.type !== 'tower');
      list.sort((a, c) => (a.type === 'smoke' ? -1e7 : 0) + dist2(a, b) - (c.type === 'smoke' ? -1e7 : 0) - dist2(c, b));
      bl = list[0] || null; b.rid = bl ? bl.id : 0; b.rHut = !bl;
    }
    if (bl) {
      const Bd = BUILDS[bl.type], pt = { x: bl.x, y: bl.y + Bd.h / 2 + 18 };
      if (dist2(b, pt) < 36 * 36 && b.t <= 0) {
        b.t = 1.2; bl.hp = (bl.hp == null ? TUNE.colony.buildHp : bl.hp) - B.buildDmg; Fx.shake(4); Sound.hit();
        if (bl.bearN !== G.bearNight) { bl.bearN = G.bearNight; Fx.toast(`:bear: Шатун ломает: ${Bd.i} ${Bd.n}!`); Sound.growl(0.35); }
        if (bl.type === 'smoke') { let n = 0; for (const k of FOOD_KEYS) while (n < 2 && (G.chest[k] || 0) > 0) { G.chest[k]--; n++; } }
        for (const u of G.col.units) if (!u.hidden && dist2(u, b) < 60 * 60) { u.hp -= B.unitDmg; Fx.burst(u.x, u.y - 12, 8, '#c0392b'); }
        if (bl.hp <= 0) {
          G.col.builds.splice(G.col.builds.indexOf(bl), 1); b.rid = 0; b.rHut = 1;
          for (const u of G.col.units) if (u.hidden && dist2(u, bl) < 90 * 90) { u.hidden = false; u.x = bl.x; u.y = bl.y + Bd.h / 2 + 20; }
          Fx.toast(`:bear: ${Bd.i} ${Bd.n} разломан`); Sound.treeCrack(); for (let i = 0; i < 4; i++) ArtWorld.fx.chips(G.parts, bl.x + rnd(-20, 20), bl.y + rnd(-10, 10));
        }
      }
      return pt;
    }
    // изба: дверь держит ~20 с, потом шатун внутри
    const door = { x: HUT.x, y: HUT_IN.y1 + 34 };
    if (dist2(b, door) < 40 * 40) {
      if (G.hut.door) {
        G.hut.doorHp -= dt * B.doorDmg;
        if (!b.doorSaid) { b.doorSaid = 1; Fx.toast(':bear: Шатун ломится в дверь!'); Sound.growl(0.4); Fx.shake(6); }
        if (G.hut.doorHp <= 0) { G.hut.door = 0; G.hut.doorHp = 100; Fx.toast(':door: Шатун выломал дверь!'); Fx.shake(12); Sound.treeCrack(); }
      } else if (p.inside) { b.st = 'hunt'; }
      else if (b.t <= 0 && Inv.cnt('food', true) - Inv.cnt('food', false) > 0) {
        let n = 0; for (const k of FOOD_KEYS) while (n < 3 && (G.chest[k] || 0) > 0) { G.chest[k]--; n++; }
        Fx.toast(':bear: Шатун ворует еду из избы!'); b.t = 10; Sound.growl(0.3);
      }
    }
    return door;
  }
  return { nightKey, respite, hit, tick, raid };
})();
