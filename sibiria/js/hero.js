'use strict';
// Герой: навыки, производные параметры (скорость, одежда, предел тепла) и движение (лёд, пурга, следы, нарты).
const Hero = (() => {
  const H = TUNE.hero;
  function lvl(k) { const x = G.skills[k]; let l = 1; for (let i = 1; i < LV.length; i++) if (x >= LV[i]) l = i + 1; return l; }
  function xp(k, n = 1) {
    const b = lvl(k); G.skills[k] += n; const a = lvl(k);
    if (a > b) { Fx.toast(`${SKILLS[k].i} ${SKILLS[k].n} · ур. ${a}`); Sound.ok2(); Fx.floatText(G.p.x, G.p.y - 60, `${SKILLS[k].i} ${a}`); }
  }
  const chopTime = () => (G.gear.saw ? H.chopSaw : H.chop) * (1 - H.chopSkill * (lvl('chop') - 1));
  const clothMul = () => G.gear.kukhl ? TUNE.cloth.kukhl : G.gear.dokha ? TUNE.cloth.dokha : G.gear.hat ? TUNE.cloth.hat : 1;
  const maxWarm = () => 100 - TUNE.body.frostWarm * G.s.frost;
  // скорость: способ (пешком / лыжи / упряжка / «Буран») × местность (TERRAIN, A7) × волокуша × перегруз × пурга × озноб × вывих
  function speed() {
    const p = G.p, m = Transport.mode(), ter = Zones.terrainAt(p.x, p.y);
    let s = Transport.speedOn(m, ter) || H.speed * ter.walk;
    if (!p.ride) {
      if (G.gear.sled) s *= H.sled;
      if (Inv.weight() > Inv.capKg()) s *= H.over;
      if (G.s.warm < H.coldBelow) s *= H.cold;
      if (p.sprainT > 0) s *= TUNE.zone.sprain;
    }
    if (stormOn() && !p.inside) s *= H.storm;
    return s;
  }
  // шаг движения: разгон/скольжение по льду, снос пургой, следы, нарты следом; перегруз — сообщение
  function move(dt, storm) {
    const p = G.p;
    if (!p.sleeping) {
      let mx = input.mx, my = input.my;
      const len = Math.hypot(mx, my); if (len > 1) { mx /= len; my /= len; }
      p.moving = len > 0.15;
      if (!p.moving && onIce(p.x, p.y) && Math.hypot(p.vx || 0, p.vy || 0) > 8) { p.vx *= 1 - Math.min(1, dt * H.iceGrip); p.vy *= 1 - Math.min(1, dt * H.iceGrip); p.x += p.vx * dt; p.y += p.vy * dt; }
      else if (!p.moving) { p.vx = p.vy = 0; }
      if (p.moving) {
        if (p.action) p.action = null;
        let sp = speed();
        const k = onIce(p.x, p.y) ? H.iceGrip : H.grip;
        p.vx = (p.vx || 0) + (mx * sp - (p.vx || 0)) * Math.min(1, dt * k); p.vy = (p.vy || 0) + (my * sp - (p.vy || 0)) * Math.min(1, dt * k);
        const ox = p.x, oy = p.y;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (storm && !p.inside) { p.x += H.stormDrift * dt; }
        if (p.ride) Transport.moved(ox, oy);
        if (Math.abs(mx) > 0.1) p.face = Math.sign(mx);
        p.step += dt * 12;
      }
      World.solid(p, 10, 'p');
      if (Math.hypot(p.x - p.lx, p.y - p.ly) > 20) {
        const a = Math.atan2(p.y - p.ly, p.x - p.lx);
        if (!p.inside && Math.random() < 0.25) ArtWorld.fx.snowPuff(G.parts, p.x, p.y, 0.3);
        if (!p.inside && !p.ride) Fx.print(p.x + Math.cos(a + 1.57) * (G.prints.length % 2 ? 4 : -4), p.y + Math.sin(a + 1.57) * (G.prints.length % 2 ? 4 : -4), a, 'p');
        p.lx = p.x; p.ly = p.y;
      }
      // нарты тянутся следом
      const sdx = p.x - p.sx, sdy = p.y - p.sy, sd = Math.hypot(sdx, sdy);
      if (sd > 34) { p.sx = p.x - sdx / sd * 34; p.sy = p.y - sdy / sd * 34; }
    } else p.moving = false;
    p.inside = insideHut(p.x, p.y);
  }
  // перегруз: один раз при переходе через предел
  function tickLoad() {
    const p = G.p, over = Inv.weight() > Inv.capKg();
    if (over && !p.overW) Fx.toast(`:weight: Перегруз ${Inv.weight()}/${Inv.capKg()} кг — медленно · лабаз или тайник`);
    p.overW = over;
  }
  return { lvl, xp, chopTime, clothMul, maxWarm, speed, move, tickLoad };
})();
