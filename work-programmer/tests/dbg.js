// node tests/dbg.js <level> [naive|naive2|ref|ref2] — загрузка узлов по ходу забега
'use strict';
const path = require('path');
const src = require('fs').readFileSync(path.join(__dirname, 'levels.test.js'), 'utf8');
const m = new (require('module'))(); m.paths = module.paths;
// забираем CASES из теста, не запуская его
const U = require('./load.js');
const code = src.split('const only =')[0] + '\nmodule.exports = { CASES };';
m.filename = path.join(__dirname, 'x.js'); m._compile(code.replace("require('./load.js')", 'globalThis.U'), m.filename);
const { CASES } = m.exports;
const [id, which = 'ref'] = process.argv.slice(2);
const lv = U.levelById(id); const c = CASES[id] || {};
const arch = c[which] || (which === 'naive' ? U.startArch(lv) : U.refArch(lv));
const sim = new U.Sim(arch, U.clone(lv)); Object.assign(sim.flags, c.flags || {});
const marks = [10, 30, 45, 60, 75, 90, 110];
while (!sim.done()) {
  sim.step(); if (c.act) c.act(sim);
  if (marks.some((x) => Math.abs(sim.t - x) < 0.01)) {
    const ns = sim.nodeStats;
    const row = sim.arch.nodes.filter((n) => n.type !== 'users').map((n) => `${n.id}:${(ns[n.id].util || 0).toFixed(2)}${ns[n.id].live != null ? '/' + ns[n.id].live : ''}${ns[n.id].lat ? ' ' + Math.round(ns[n.id].lat) + 'ms' : ''}`).join('  ');
    const grp = Object.entries(sim.grt).map(([g, x]) => `${g}=${Math.round(x.L)}`).join(' ');
    console.log(`t=${sim.t} av ${(sim.tick.av * 100).toFixed(1)} p95 ${sim.tick.p95}  ${row}  ${grp}`);
  }
}
const r = sim.result();
console.log('ИТОГ av', r.avail.toFixed(2), 'p95', r.p95, '$' + Math.round(r.cost), JSON.stringify(Object.fromEntries(Object.entries(r.fail).map(([k, v]) => [k, +(100 * v / r.att).toFixed(2)]))), 'lag', r.lagMax.toFixed(1));
