'use strict';
// Прогон без экрана: целый уровень за один вызов и нагрузочный тест «разгоняем, пока не сломается».
L.def('sim/run', () => {
  const U = L.use('core');
  const { K, clone } = L.use('sim/model');
  const { Sim } = L.use('sim/sim');
  U.runHeadless = function (arch, sc, opts) {
    const sim = new Sim(arch, U.clone(sc));
    if (opts && opts.flags) Object.assign(sim.flags, opts.flags);
    if (opts && opts.each) opts.each(sim);
    while (!sim.done()) { sim.step(); if (opts && opts.onStep) opts.onStep(sim); }
    return sim.result();
  };
  // нагрузочный тест: разгоняем трафик, пока система не сломается
  U.loadTest = function (arch, sc) {
    const s2 = U.clone(sc); s2.incidents = []; s2.dur = 1e9; s2.shape = [[0, 1]]; s2.rps = Math.max(50, sc.rps * 0.3);
    const sim = new Sim(arch, s2); let bad = 0;
    for (let i = 0; i < 3000; i++) {
      sim.sc.rps *= Math.pow(1.04, K.dt); sim.step();
      const tk = sim.tick;
      if (tk.av < 0.99 || tk.p95 > ((sc.goals && sc.goals.p95) || 300) * 2) bad += K.dt; else bad = 0;
      if (bad >= 3) return sim.sc.rps / Math.pow(1.04, 3);
      if (sim.sc.rps > 2e6) break;
    }
    return sim.sc.rps;
  };

  return { runHeadless: U.runHeadless, loadTest: U.loadTest };
});
