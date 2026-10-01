'use strict';
// Директор угроз (по мотивам Left 4 Dead): напряжение → бюджет → «предвестник» → разведчик или стая.
// Параметры глав — CHAPTERS[i].threat {rate, peak, wolves, storm}; числа — TUNE.director.
// Темп — игровой: бюджет и передышка идут в игровом времени (K = TUNE.time.k), а предвестник и бой — телесные, в реальных с
// (бюджет в них копится как при k = 1). Их длительность ×(K − 1) — пустые паузы без бюджета: перед воем (omenT > omenAt)
// и после боя (padT). Весь цикл ровно ×K, появления в те же игровые часы — разведчиков и стай за ночь как при часе 20 с.
const Director = (() => {
  const D0 = TUNE.director, K = TUNE.time.k;
  // «далеко от укрытия»: изба или готовое укрытие посёлка дальше TUNE.r.farHome (на большой карте — не «от избы»)
  function farFromShelter() {
    const p = G.p, R2 = TUNE.r.farHome * TUNE.r.farHome;
    if ((p.x - HUT.x) ** 2 + (p.y - HUT.y) ** 2 <= R2) return false;
    return !G.col || !G.col.builds.some(b => b.done && BUILDS[b.type].shelter && (p.x - b.x) ** 2 + (p.y - b.y) ** 2 <= R2);
  }
  function tick(dt, night, storm) {
    const D = G.D, ch = CHAPTERS[G.chapter].threat, s = G.s, p = G.p, W8 = D0.w;
    const near = G.wolves.filter(w => dist2(w, p) < D0.wolfR * D0.wolfR).length;
    const bearNear = G.bear && dist2(G.bear, p) < D0.bearR * D0.bearR ? W8.bear : 0;
    D.tension = clamp(W8.warm * (100 - s.warm) + W8.hp * (100 - s.hp) + W8.food * (100 - s.food) + (night > 0.6 ? W8.night : 0) + (storm ? W8.storm : 0)
      + (farFromShelter() ? W8.far : 0) + W8.wolf * near + bearNear, 0, 100);
    const pre = D.omenT > 0 && D.omenAt > 0, tel = D.phase === 'peak' || (D.omenT > 0 && !pre), pad = pre || (D.phase === 'relax' && D.padT > 0);
    if (D.phase === 'peak') D.telT = (D.telT || 0) + dt; // бой — телесный, реальные с (вой уже оплачен паузой до него)
    if (D.phase === 'relax' && D.padT > 0) D.padT -= dt;
    if (!pad) D.budget = Math.min(D0.budgetMax, D.budget + ch.rate / (tel ? 1 : K) * (1 - D.tension / 100) * dt);
    if (s.hp < D0.mercyHp && D.phase !== 'relax') relax(D0.mercyCalm);
    const isNight = night > 0.55;
    if (!isNight) { D.queued = null; D.omenT = 0; D.omenAt = 0; }
    switch (D.phase) {
      case 'build':
        if (!isNight || (p.sleeping && G.hut.door)) break;
        // задание деда «вожак»: вожак приходит сам, пока не отогнан
        if (G.urk.wolfQuest && !G.flags.leaderDone && !G.pack && !storm && G.fired.E5 && D.budget >= D0.cost.pack && !D.queued) {
          D.dir = Math.random() * Math.PI * 2; howlFrom(D.dir, TUNE.wolf.leaderD, 0.22); Fx.toast(':wolf: Вожак с рваным ухом близко'); Wolves.spawnPack(3, true); D.budget -= D0.cost.pack; D.phase = 'peak'; break;
        }
        if (!D.queued) D.queued = pick(ch, storm);
        if (D.queued && D.omenT === 0) { D.dir = Math.random() * Math.PI * 2; D.omenAt = D.queued === 'pack' ? D0.omenPack : D0.omenScout; D.omenT = D.omenAt * K; if (K === 1) { omen(D.queued); D.omenAt = 0; } }
        else if (D.queued && D.omenT > 0) {
          D.omenT -= dt;
          if (D.omenAt > 0 && D.omenT <= D.omenAt) { omen(D.queued); D.omenAt = 0; } // вой — за omenAt реальных с до прихода
          if (D.omenT <= 0) {
            D.omenT = 0;
            if (D.tension < ch.peak + 10) {
              if (D.queued === 'pack') Wolves.spawnPack(clamp(ch.wolves - G.mercy, 2, 5), false); else Wolves.spawnScout();
              D.budget -= D0.cost[D.queued]; D.last = D.queued; D.phase = 'peak';
            }
            D.queued = null;
          }
        }
        break;
      case 'peak': if (G.wolves.length === 0 || D.tension > D0.peakOut) { relax(rnd(D0.calm[0], D0.calm[1])); } break;
      case 'relax': D.calmT -= dt; if (D.calmT <= 0) D.phase = 'build'; break;
    }
  }
  // передышка: calm (прежние с) ×K + пустая пауза за телесную часть
  function relax(calm) { const D = G.D; D.padT = (K - 1) * (D.telT || 0); D.phase = 'relax'; D.calmT = calm * K + D.padT; D.telT = 0; }
  function pick(ch, storm) {
    const D = G.D, max = ch.wolves - G.mercy, C = D0.cost;
    if (storm) return D.budget >= C.scout ? 'scout' : null;
    if (D.budget >= C.pack && max >= 2 && D.last !== 'pack') return 'pack';
    if (D.budget >= C.scout && D.last !== 'scout') return 'scout';
    if (D.budget >= C.pack && max >= 2) return 'pack';
    return null;
  }
  // вой с места: громкость и панорама — от точки на расстоянии d по направлению a (Sound.at)
  function howlFrom(a, d, vol) { const p = G.p; Sound.at(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, () => Sound.howl(0, vol)); }
  function omen(type) {
    const p = G.p, a = G.D.dir;
    if (type === 'pack') {
      const D = (TUNE.wolf.packD[0] + TUNE.wolf.packD[1]) / 2; howlFrom(a, D, 0.2); Fx.toast(Ctx.howl(D, true)); // фраза — по дистанции, откуда придёт стая
      for (let i = -6; i < 6; i++) Fx.print(p.x + Math.cos(a) * 180 + Math.cos(a + 1.57) * i * 26, p.y + Math.sin(a) * 180 + Math.sin(a + 1.57) * i * 26, a + 1.57, 'w');
    }
  }
  return { tick, pick, omen, farFromShelter };
})();
