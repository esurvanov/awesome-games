// Адаптивное качество: по времени кадра понижаем/повышаем уровень (плотность пикселей, люди, деревья, свет).
'use strict';
L.def('render/quality', () => {
const { Settings } = L.use('core');

const LEVELS = {
  // 2D: dprMax, agents, trees, glow · 3D: rs — доля разрешения, near/far — рельеф подробно/грубо (м), treeR, carD — подробные машины,
  // carB — машины-коробки, lightD — огни очереди, pplR — люди, pplN — людей максимум, nl — точечных огней, rain — капель
  high: { name: 'high', dprMax: 2, agents: 220, trees: true, glow: true, rs: 1, near: 1400, far: 7000, treeR: 650, carD: 220, carB: 2200, lightD: 6000, pplR: 140, pplN: 220, nl: 8, rain: 1800, aa: true },
  mid: { name: 'mid', dprMax: 1.4, agents: 110, trees: true, glow: true, rs: 0.85, near: 950, far: 5000, treeR: 420, carD: 140, carB: 1600, lightD: 4500, pplR: 100, pplN: 120, nl: 6, rain: 1000, aa: true },
  low: { name: 'low', dprMax: 1, agents: 40, trees: false, glow: false, rs: 0.7, near: 560, far: 3200, treeR: 220, carD: 80, carB: 1000, lightD: 3000, pplR: 60, pplN: 50, nl: 4, rain: 450, aa: false },
};
const ORDER = ['low', 'mid', 'high'];

class Quality {
  constructor() {
    const s = Settings.get('quality');
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    this.auto = s === 'auto' || !LEVELS[s];
    this.set(LEVELS[s] ? s : coarse ? 'mid' : 'high');
    this.acc = 0; this.n = 0; this.t = 0; this.onChange = null; this.cool = 0;
  }
  set(name) { Object.assign(this, LEVELS[name]); this.level = name; }
  // ms — работа кадра (симуляция + отрисовка), dt — реальная длительность кадра
  sample(ms, dt) {
    if (!this.auto) return;
    this.acc += ms; this.n++; this.t += dt; this.cool -= dt;
    if (this.t < 2 || this.cool > 0) return;
    const avg = this.acc / this.n; this.acc = 0; this.n = 0; this.t = 0;
    const i = ORDER.indexOf(this.level);
    if (avg > 20 && i > 0) { this.set(ORDER[i - 1]); this.cool = 3; this.onChange && this.onChange(); }
    else if (avg < 7 && i < ORDER.length - 1) { this.set(ORDER[i + 1]); this.cool = 8; this.onChange && this.onChange(); }
  }
}
return { LEVELS, Quality };
});
