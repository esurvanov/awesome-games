// node tests/levels.test.js [id…] — на каждом уровне наивная схема проваливается, эталонная проходит (★★ и выше).
'use strict';
const U = require('./load.js');

let uid = 0;
// узлы: [type, cfg, loc, id]; loc — зона 'A'/'B' или {region, cloud, zone}
function A(nodes, edges, groups) {
  return { nodes: [U.newNode('users', 90, 260, {}, 'A', 'users')].concat(nodes.map(([t, c, l, id]) => U.newNode(t, 0, 0, c, l || 'A', id || t + ++uid))), edges, groups: groups || {} };
}
const chain = (...ids) => ids.slice(1).map((x, i) => [ids[i], x]);
// взять стартовую схему уровня и поправить
function tweak(id, fn) { const a = U.startArch(U.levelById(id)); fn(a, (nid) => a.nodes.find((n) => n.id === nid)); return a; }
const setEdge = (a, from, to, o) => { const e = a.edges.find((x) => x[0] === from && x[1] === to); e[2] = Object.assign({}, e[2] || {}, o); };

const CASES = {
  intro: { naive: A([['compute', { n: 1 }, 'A', 'c']], chain('users', 'c')), ref: A([['compute', { n: 3 }, 'A', 'c']], chain('users', 'c')) },
  hello: { naive: A([], []), ref: A([['compute', { n: 1 }, 'A', 'c']], chain('users', 'c')) },
  two: { naive: A([['compute', { n: 1, size: 'L' }, 'A', 'c']], chain('users', 'c')), ref: A([['lb', {}, 'A', 'lb'], ['compute', { n: 5 }, 'A', 'c']], chain('users', 'lb', 'c')) },
  files: { naive: A([['lb', {}, 'A', 'lb'], ['compute', { n: 9 }, 'A', 'c']], chain('users', 'lb', 'c')), ref: A([['lb', {}, 'A', 'lb'], ['compute', { n: 2 }, 'A', 'c'], ['storage', {}, 'A', 's']], [['users', 'lb'], ['lb', 'c'], ['lb', 's']]) },
  far: { naive: A([['lb', {}, 'A', 'lb'], ['compute', { n: 2 }, 'A', 'c'], ['storage', {}, 'A', 's']], [['users', 'lb'], ['lb', 'c'], ['lb', 's']]), ref: A([['cdn', { ttl: 'long', api: true }, 'A', 'cdn'], ['lb', {}, 'A', 'lb'], ['compute', { n: 2 }, 'A', 'c'], ['storage', {}, 'A', 's']], [['users', 'cdn'], ['cdn', 'lb'], ['lb', 'c'], ['lb', 's']]) },
  readheavy: { naive: A([['lb', {}, 'A', 'lb'], ['compute', { n: 6, size: 'M' }, 'A', 'c'], ['db', { size: 'L' }, 'A', 'd']], chain('users', 'lb', 'c', 'd')), ref: A([['lb', {}, 'A', 'lb'], ['compute', { n: 6, size: 'M' }, 'A', 'c'], ['cache', { mem: 4, ttl: 'h' }, 'A', 'k'], ['db', { size: 'S' }, 'A', 'd']], chain('users', 'lb', 'c', 'k', 'd')) },
  feed: { naive: A([['lb', {}, 'A', 'lb'], ['compute', { n: 5, size: 'M' }, 'A', 'c'], ['cache', { mem: 16, ttl: 'h' }, 'A', 'k'], ['db', { size: 'M' }, 'A', 'd']], chain('users', 'lb', 'c', 'k', 'd')), ref: A([['lb', {}, 'A', 'lb'], ['compute', { n: 4, size: 'M' }, 'A', 'c'], ['db', { size: 'M', rep: 2 }, 'A', 'd']], chain('users', 'lb', 'c', 'd')) },
  cachegone: { naive: A([['lb', {}, 'A', 'lb'], ['compute', { n: 6, size: 'M' }, 'A', 'c'], ['cache', { mem: 4, ttl: 'h' }, 'A', 'k'], ['db', { size: 'S' }, 'A', 'd']], chain('users', 'lb', 'c', 'k', 'd')), ref: A([['lb', {}, 'A', 'lb'], ['compute', { n: 6, size: 'M' }, 'A', 'c'], ['cache', { mem: 4, ttl: 'h', replica: true }, 'A', 'k'], ['db', { size: 'S' }, 'A', 'd']], chain('users', 'lb', 'c', 'k', 'd')) },
  launch: { naive: A([['lb', {}, 'A', 'lb'], ['compute', { auto: true, min: 2, max: 10 }, 'A', 'c']], chain('users', 'lb', 'c')), ref: A([['lb', {}, 'A', 'lb'], ['compute', { n: 8 }, 'A', 'c']], chain('users', 'lb', 'c')) },
  grow: { naive: A([['lb', {}, 'A', 'lb'], ['compute', { n: 6 }, 'A', 'c']], chain('users', 'lb', 'c')), ref: A([['lb', {}, 'A', 'lb'], ['compute', { auto: true, min: 2, max: 8, tgt: 50 }, 'A', 'c']], chain('users', 'lb', 'c')),
    ref2: A([['lb', {}, 'A', 'lb'], ['compute', { auto: true, min: 2, max: 8, kind: 'ctr' }, 'A', 'c']], chain('users', 'lb', 'c')) },
  conns: { ref: tweak('conns', (a, n) => (n('app').cfg.pool = 10)) },
  nowait: { naive: A([['lb', {}, 'A', 'lb'], ['compute', { n: 6 }, 'A', 'c'], ['cache', { mem: 4, ttl: 'h' }, 'A', 'k'], ['db', { size: 'S' }, 'A', 'd']], chain('users', 'lb', 'c', 'k', 'd')),
    ref: A([['lb', {}, 'A', 'lb'], ['compute', { n: 4 }, 'A', 'c'], ['cache', { mem: 4, ttl: 'h' }, 'A', 'k'], ['db', { size: 'S' }, 'A', 'd'], ['queue', {}, 'A', 'q'], ['worker', { n: 3 }, 'A', 'w']], [['users', 'lb'], ['lb', 'c'], ['c', 'k'], ['k', 'd'], ['c', 'q'], ['q', 'w']]) },
  broker: {
    naive2: tweak('broker', (a, n) => { n('q').type = 'broker'; n('q').cfg = { parts: 3 }; ['mail', 'stats', 'stock'].forEach((w) => (n(w).cfg.n = 5)); }),
    ref: tweak('broker', (a, n) => { n('q').type = 'broker'; n('q').cfg = { parts: 5 }; ['mail', 'stats', 'stock'].forEach((w) => (n(w).cfg.n = 5)); }),
  },
  retry: { ref: tweak('retry', (a, n) => Object.assign(n('app').cfg, { timeout: 1, retries: 0 })), ref2: tweak('retry', (a, n) => Object.assign(n('app').cfg, { timeout: 1, retries: 2, backoff: true })) },
  zone: { naive: A([['lb', {}, 'A', 'lb'], ['compute', { n: 3 }, 'A', 'a'], ['compute', { n: 3 }, 'B', 'b'], ['db', { size: 'M' }, 'B', 'd']], [['users', 'lb'], ['lb', 'a'], ['lb', 'b'], ['a', 'd'], ['b', 'd']]),
    ref: A([['lb', {}, 'A', 'lb'], ['compute', { n: 4 }, 'A', 'a'], ['compute', { n: 4 }, 'B', 'b'], ['db', { size: 'M', mz: true }, 'B', 'd'], ['monitor', {}, 'A', 'm']], [['users', 'lb'], ['lb', 'a'], ['lb', 'b'], ['a', 'd'], ['b', 'd']]) },
  health: { ref: tweak('health', (a, n) => { n('lb').cfg.checks = true; n('p1').cfg.n = 4; }) },
  cfo: { ref: A([['lb', {}, 'A', 'lb'], ['compute', { n: 4, size: 'M' }, 'A', 'c'], ['cache', { mem: 4, ttl: 'h' }, 'A', 'k'], ['db', { size: 'S' }, 'A', 'd']], chain('users', 'lb', 'c', 'k', 'd')) },

  monitoring: { naive2: tweak('monitoring', (a, n) => ['pa', 'pb', 'pc'].forEach((p) => (n(p).cfg.n += 2))),
    ref: tweak('monitoring', (a, n) => { n('pb').cfg.n = 3; a.nodes.push(U.newNode('monitor', 0, 0, {}, 'A', 'mon')); }) },
  logging: {
    naive2: tweak('logging', (a) => a.nodes.push(U.newNode('logs', 0, 0, { level: 'debug' }, 'A', 'logs'))),
    ref: tweak('logging', (a) => a.nodes.push(U.newNode('logs', 0, 0, { level: 'info' }, 'A', 'logs'))),
    act: (sim) => { if (sim.t >= 36 && !sim.rt.stock.rolledBack) sim.rt.stock.rolledBack = sim.t + 5; },
  },
  tracing: {
    naive2: tweak('tracing', (a) => { for (const [s, x] of [['sa', 'xa'], ['sb', 'xb'], ['sc', 'xc']]) { a.edges = a.edges.filter((e) => !(e[0] === s && e[1] === x)); a.nodes.push(U.newNode('cache', 0, 0, { mem: 4, ttl: 'h' }, 'A', 'k' + s)); a.edges.push([s, 'k' + s], ['k' + s, x]); } }),
    ref: tweak('tracing', (a) => { a.edges = a.edges.filter((e) => !(e[0] === 'sc' && e[1] === 'xc')); a.nodes.push(U.newNode('cache', 0, 0, { mem: 4, ttl: 'h' }, 'A', 'kc'), U.newNode('tracing', 0, 0, { sample: 10 }, 'A', 'tr')); a.edges.push(['sc', 'kc'], ['kc', 'xc']); }),
  },
  loadtest: { ref: tweak('loadtest', (a, n) => { n('db').cfg.size = 'M'; a.nodes.push(U.newNode('cache', 0, 0, { mem: 4, ttl: 'h' }, 'A', 'k')); a.edges = a.edges.filter((e) => e[0] !== 'app'); a.edges.push(['app', 'k'], ['k', 'db'], ['app', 'db']); }), flags: { loadtested: true } },
  testing: { naive2: tweak('testing', (a) => a.nodes.push(U.newNode('tests', 0, 0, { suite: 'full' }, 'A', 't'))),
    ref: tweak('testing', (a, n) => { n('app').cfg.rollout = 'canary'; a.nodes.push(U.newNode('tests', 0, 0, { suite: 'unit' }, 'A', 't'), U.newNode('monitor', 0, 0, {}, 'A', 'm')); }) },

  twelve: {
    naive2: tweak('twelve', (a, n) => Object.assign(n('app').cfg, { auto: true, min: 2, max: 8 })),
    ref: tweak('twelve', (a, n) => { Object.assign(n('app').cfg, { auto: true, min: 2, max: 8, state: 'shared', conf: 'env', logsTo: 'stdout', kind: 'ctr' }); a.nodes.push(U.newNode('cache', 0, 0, { mem: 1, ttl: 'h' }, 'A', 'sess')); a.edges.push(['app', 'sess'], ['sess', 'db']); }),
  },
  k8s1: { naive2: tweak('k8s1', (a, n) => (n('api').cfg.strategy = 'rolling')), ref: tweak('k8s1', (a, n) => Object.assign(n('api').cfg, { ready: true, strategy: 'rolling' })) },
  k8s2: { naive2: tweak('k8s2', (a, n) => Object.assign(n('api').cfg, { hpa: true, min: 2, max: 12 })), ref: tweak('k8s2', (a, n) => { Object.assign(n('api').cfg, { hpa: true, min: 2, max: 12 }); n('pool').cfg.ca = true; }) },
  k8s3: { naive2: tweak('k8s3', (a, n) => (n('api').cfg.spread = true)), ref: tweak('k8s3', (a, n) => Object.assign(n('api').cfg, { spread: true, pdb: true, n: 8 })) },
  k8s4: { ref: tweak('k8s4', (a, n) => (n('reports').cfg.limit = true)) },
  sockets: {
    naive2: tweak('sockets', (a, n) => { n('gw').cfg.n = 4; a.nodes.push(U.newNode('broker', 0, 0, {}, 'A', 'bus')); a.edges.push(['gw', 'bus']); }),
    ref: tweak('sockets', (a, n) => { Object.assign(n('gw').cfg, { n: 4, backoff: true, drain: true }); a.nodes.push(U.newNode('broker', 0, 0, {}, 'A', 'bus')); a.edges.push(['gw', 'bus']); }),
  },
  certs: { ref: tweak('certs', (a, n) => (n('lb').cfg.tls = 'auto')) },
  security: {
    naive2: tweak('security', (a) => { a.nodes.push(U.newNode('waf', 0, 0, { sens: 'mid', rl: 'loose' }, 'A', 'waf')); a.edges = a.edges.filter((e) => e[0] !== 'users'); a.edges.push(['users', 'waf'], ['waf', 'lb']); }),
    ref: tweak('security', (a, n) => { n('db').cfg.pub = false; a.nodes.push(U.newNode('waf', 0, 0, { sens: 'mid', rl: 'loose' }, 'A', 'waf'), U.newNode('vault', 0, 0, {}, 'A', 'v')); a.edges = a.edges.filter((e) => e[0] !== 'users'); a.edges.push(['users', 'waf'], ['waf', 'lb']); }),
  },
  vpn: {
    naive2: tweak('vpn', (a) => { a.edges = a.edges.filter((e) => !(e[0] === 'app' && e[1] === 'erp')); a.nodes.push(U.newNode('vpn', 0, 0, { tunnels: 1 }, 'A', 'v')); a.edges.push(['app', 'v', { on: 'wr' }], ['v', 'erp']); }),
    ref: tweak('vpn', (a) => { a.edges = a.edges.filter((e) => !(e[0] === 'app' && e[1] === 'erp')); a.nodes.push(U.newNode('vpn', 0, 0, { tunnels: 2 }, 'A', 'v')); a.edges.push(['app', 'v', { on: 'wr' }], ['v', 'erp']); }),
  },
  multiregion: {
    ref2: A([['dns', {}, 'A', 'dns'], ['lb', {}, { region: 'R1' }, 'lb1'], ['compute', { n: 4 }, { region: 'R1' }, 'a1'], ['lb', {}, { region: 'R2' }, 'lb2'], ['compute', { n: 4 }, { region: 'R2', zone: 'A' }, 'a2'], ['db', { size: 'M', xr: 'async' }, { region: 'R1' }, 'db']],
      [['users', 'dns'], ['dns', 'lb1'], ['dns', 'lb2'], ['lb1', 'a1'], ['lb2', 'a2'], ['a1', 'db'], ['a2', 'db']]),
    ref: A([['dns', {}, 'A', 'dns'], ['lb', {}, { region: 'R1' }, 'lb1'], ['compute', { n: 4 }, { region: 'R1' }, 'a1'], ['lb', {}, { region: 'R2' }, 'lb2'], ['compute', { n: 4 }, { region: 'R2', zone: 'A' }, 'a2'], ['db', { size: 'M', xr: 'sync' }, { region: 'R1' }, 'db']],
      [['users', 'dns'], ['dns', 'lb1'], ['dns', 'lb2'], ['lb1', 'a1'], ['lb2', 'a2'], ['a1', 'db'], ['a2', 'db']]),
  },
  multicloud: {
    naive2: tweak('multicloud', (a, n) => { for (const id of ['lb2', 'app2']) n(id).cloud = 'C2'; n('db').cfg.xr = 'none'; n('app1').cfg.n = 5; n('app2').cfg.n = 5; }),
    ref: tweak('multicloud', (a, n) => { for (const id of ['lb2', 'app2']) n(id).cloud = 'C2'; n('app1').cfg.n = 5; n('app2').cfg.n = 5; }),
  },

  monolith: { ref: tweak('monolith', (a) => { a.nodes.forEach((x) => x.type === 'mod' && (x.cfg.grp = 'A')); a.groups = { A: { n: 2 } }; }) },
  modular: {
    naive2: tweak('modular', (a) => (a.groups.A.bulkhead = true)),
    ref: tweak('modular', (a) => { a.groups.A.bulkhead = true; a.edges = a.edges.filter((e) => !(e[2] && e[2].k === 'db')); }),
  },
  strangler: {
    naive2: tweak('strangler', (a) => (a.groups.A.n = 10)),
    ref: tweak('strangler', (a, n) => { n('search').cfg.grp = 'B'; a.groups = { A: { n: 5 }, B: { n: 6 } }; }),
  },
  distmono: {
    ref: tweak('distmono', (a) => { setEdge(a, 'orders', 'notify', { k: 'evt' }); setEdge(a, 'orders', 'stats', { k: 'evt' }); setEdge(a, 'profile', 'notify', { k: 'evt' }); setEdge(a, 'orders', 'billing', { k: 'cmd' });
      a.edges = a.edges.filter((e) => !(e[2] && e[2].k === 'db')); }),
  },
  mshell: {
    naive2: tweak('mshell', (a) => { for (const x of a.nodes) if (x.type === 'mod') x.cfg.grp = 'A'; a.groups = { A: { n: 8 } }; }),
    ref: tweak('mshell', (a) => {
      const G = { web: 'A', auth: 'A', user: 'A', avatar: 'D', tz: 'D', feed: 'B', post: 'B', like: 'B', comment: 'B', media: 'B', rank: 'C', search: 'C' };
      for (const x of a.nodes) if (x.type === 'mod') x.cfg.grp = G[x.id];
      setEdge(a, 'user', 'avatar', { k: 'evt' }); setEdge(a, 'user', 'tz', { k: 'evt' });
      a.groups = { A: { n: 4 }, B: { n: 6 }, C: { n: 3 }, D: { n: 3 } };
    }),
  },
  dddstrat: {
    naive2: tweak('dddstrat', (a, n) => { n('pricing').cfg.grp = 'A'; n('ticket').cfg.grp = 'C'; a.groups = { A: { n: 5 }, C: { n: 4 }, D: { n: 2 } }; }),
    ref: tweak('dddstrat', (a, n) => { n('pricing').cfg.grp = 'A'; n('ticket').cfg.grp = 'C'; a.groups = { A: { n: 5 }, C: { n: 4 }, D: { n: 2 } }; setEdge(a, 'sales', 'customer', { acl: true }); setEdge(a, 'support', 'customer', { acl: true }); a.groups.D.n = 3; }),
  },
  dddtact: {
    naive2: tweak('dddtact', (a, n) => { n('product').cfg.grp = 'C'; n('stock').cfg.grp = 'D'; a.groups = { A: { n: 3 }, B: { n: 2 }, C: { n: 2 }, D: { n: 2 } }; }),
    ref: tweak('dddtact', (a, n) => { n('line').cfg.grp = 'A'; n('product').cfg.grp = 'B'; n('stock').cfg.grp = 'C'; setEdge(a, 'order', 'stock', { k: 'evt' }); a.groups = { A: { n: 4 }, B: { n: 2 }, C: { n: 2 } }; }),
  },
  cmdevt: {
    naive2: tweak('cmdevt', (a) => { for (const t of ['pay', 'mail', 'stats', 'loyalty']) setEdge(a, 'orders', t, { k: 'cmd' }); a.groups = { A: { n: 2 }, B: { n: 2 }, C: { n: 2 }, D: { n: 2 }, E: { n: 2 } }; }),
    ref: tweak('cmdevt', (a) => { setEdge(a, 'orders', 'pay', { k: 'cmd' }); for (const t of ['mail', 'stats', 'loyalty']) setEdge(a, 'orders', t, { k: 'evt' }); a.groups = { A: { n: 3 }, B: { n: 2 }, C: { n: 2 }, D: { n: 2 }, E: { n: 2 } }; }),
  },
  saga: {
    naive2: tweak('saga', (a) => { setEdge(a, 'orders', 'stock', { k: 'cmd' }); setEdge(a, 'stock', 'pay', { k: 'cmd' }); setEdge(a, 'pay', 'ship', { k: 'cmd' }); }),
    ref: tweak('saga', (a) => { setEdge(a, 'orders', 'stock', { k: 'cmd' }); setEdge(a, 'stock', 'pay', { k: 'cmd' }); setEdge(a, 'pay', 'ship', { k: 'cmd' }); a.nodes.push(U.newNode('saga', 0, 0, {}, 'A', 'sg')); }),
  },
  friday: { naive: A([['lb', {}, 'A', 'lb'], ['compute', { auto: true, min: 3, max: 12 }, 'A', 'c'], ['db', { size: 'M' }, 'A', 'd']], chain('users', 'lb', 'c', 'd')) },
};

const only = process.argv.slice(2);
let bad = 0;
const f = (r) => `av ${r.avail.toFixed(2).padStart(6)} p95 ${String(r.p95).padStart(4)} $${String(Math.round(r.cost)).padStart(5)} ★${r.stars} obj ${r.obj.ok ? '✓' : '✗'}${r.obj.val !== null && r.obj.val !== undefined ? ' ' + (+r.obj.val).toFixed(2) : ''}${Object.entries(r.pass).filter(([, v]) => !v).map(([k]) => ' ✗' + k).join('')}`;
const fails = (r) => Object.entries(r.fail).filter(([, v]) => v / r.att > 0.0005).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ':' + (100 * v / r.att).toFixed(1) + '%').join(' ');
const extra = (r) => [r.lagMax > 0.5 ? 'lag ' + r.lagMax.toFixed(0) : '', r.inv > 0.01 ? 'inv ' + r.inv.toFixed(1) : '', r.hanging > 0.01 ? 'hang ' + r.hanging.toFixed(0) : '', r.lost > 0 ? 'lost ' + r.lost.toFixed(0) : '', r.missed > 0 ? 'missed ' + (r.missed * 100).toFixed(0) + '%' : '', r.egress > 1 ? 'egress ' + r.egress.toFixed(0) : '', r.breach ? 'BREACH' : '', r.secFrac < 1 ? 'sec ' + r.secFrac.toFixed(2) : ''].filter(Boolean).join(' ');
for (const lv of U.LEVELS) {
  if (only.length && !only.includes(lv.id)) continue;
  const c = CASES[lv.id] || {};
  const run = (a) => U.runHeadless(a, lv, { flags: c.flags, onStep: c.act });
  const naive = c.naive || U.startArch(lv);
  const ref = c.ref || U.refArch(lv);
  const rn = U.runHeadless(naive, lv);
  const rn2 = c.naive2 ? U.runHeadless(c.naive2, lv) : null;
  const rr = run(ref);
  const r2 = c.ref2 ? run(c.ref2) : null;
  const ok = !rn.allPass && (!rn2 || !rn2.allPass) && rr.allPass && rr.stars >= 2 && (!r2 || r2.allPass);
  if (!ok) bad++;
  const g = lv.goals;
  console.log(`${ok ? 'OK ' : 'BAD'} ${String(lv.n).padStart(2)} T${lv.tier} ${lv.id.padEnd(11)} goals ${g.avail}/${g.p95}/$${g.budget}${g.lag != null ? ' lag≤' + g.lag : ''}${g.inv != null ? ' inv≤' + g.inv : ''}${g.hanging != null ? ' hang≤' + g.hanging : ''}${g.sec != null ? ' sec' : ''}${g.missed != null ? ' miss≤' + g.missed : ''}`);
  console.log(`      naive ${f(rn)}  ${fails(rn)} ${extra(rn)}`);
  if (rn2) console.log(`      naiv2 ${f(rn2)}  ${fails(rn2)} ${extra(rn2)}`);
  console.log(`      ref   ${f(rr)}  ${fails(rr)} ${extra(rr)}`);
  if (r2) console.log(`      ref2  ${f(r2)}  ${fails(r2)} ${extra(r2)}`);
}
if (!only.length) for (const d of ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06']) {
  const sc = U.dailyScenario(d);
  const r = U.runHeadless(U.refArch(sc), sc);
  if (!r.allPass) bad++;
  console.log(`${r.allPass ? 'OK ' : 'BAD'} daily ${d} ${sc.kind} ${sc.rps}rps → ${f(r)}`);
}
console.log(bad ? `\n${bad} проблем` : '\nвсё сходится');
process.exit(bad ? 1 : 0);
