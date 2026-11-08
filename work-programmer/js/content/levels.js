'use strict';
// Уровни: только механика (трафик, аварии, цели, стартовая схема). Тексты — в content/text.ru.js / text.en.js.
L.def('content/levels', () => {
  const U = L.use('core');
  L.use('sim/model');
  L.use('sim/run');

  let uid = 0;
  const N = (type, x, y, cfg, loc, id) => {
    const l = typeof loc === 'string' ? { zone: loc } : (loc || {});
    return Object.assign({ id: id || type + '_' + (++uid), type, x, y, zone: l.zone || 'A', region: l.region || 'R1', cloud: l.cloud || 'C1', cfg: Object.assign(U.clone(U.DEFAULTS[type]), cfg || {}) });
  };
  U.newNode = N;
  const X = (c) => 90 + c * 210, Y = (r) => 260 + r * 140;
  const users = () => N('users', X(0), Y(0), {}, 'A', 'users');
  const start = (nodes, edges, groups) => ({ nodes: [users()].concat(nodes || []), edges: edges || [], groups: groups || {} });
  const E = (a, b, o) => (o ? [a, b, o] : [a, b]);

  // группы: от простого к очень сложному
  U.TIERS = [
    { id: 1, key: 'basics', dots: 1 },
    { id: 2, key: 'load', dots: 2 },
    { id: 3, key: 'observe', dots: 3 },
    { id: 4, key: 'platform', dots: 4 },
    { id: 5, key: 'arch', dots: 5 },
  ];

  const LV = [];
  const add = (lv) => LV.push(Object.assign({ dur: 120, shape: [[0, 1]], mix: { rd: 1 }, data: false }, lv));

  // ================= 1. ОСНОВЫ =================
  add({ id: 'intro', tier: 1, tutorial: true, instantBoot: true, rps: 100, incidents: [{ type: 'spike', at: 20, dur: 999, mul: 4, ramp: 1 }],
    goals: { avail: 97, p95: 400, budget: 200 }, palette: ['compute'] });
  add({ id: 'hello', tier: 1, rps: 120, goals: { avail: 99, p95: 300, budget: 100 }, objective: { type: 'maxUtil', v: 0.8 }, palette: ['compute'] });
  add({ id: 'two', tier: 1, rps: 300, shape: [[0, 1], [120, 2.3]], incidents: [{ type: 'crash', at: 50, dur: 25, k: 1 }],
    goals: { avail: 99.5, p95: 250, budget: 300 }, objective: { type: 'incAvail', v: 99.5 }, palette: ['compute', 'lb'] });
  add({ id: 'files', tier: 1, rps: 600, mix: { st: 0.65, rd: 0.35 }, goals: { avail: 99.5, p95: 200, budget: 160 }, objective: { type: 'maxUtil', v: 0.75 }, palette: ['compute', 'lb', 'storage'] });
  add({ id: 'far', tier: 1, rps: 500, mix: { st: 0.6, rd: 0.4 }, far: 1, farMs: 170, apiCache: 1, goals: { avail: 99.5, p95: 120, budget: 200 }, objective: { type: 'maxUtil', v: 0.7 }, palette: ['compute', 'lb', 'storage', 'cdn'] });
  add({ id: 'readheavy', tier: 1, rps: 2600, mix: { rd: 0.92, wr: 0.08 }, data: true, repeat: 0.97, ws: 2, goals: { avail: 99.5, p95: 120, budget: 750 }, objective: { type: 'cacheHit', v: 0.85 }, palette: ['compute', 'lb', 'cache', 'db'] });
  add({ id: 'feed', tier: 1, rps: 1800, mix: { rd: 0.85, wr: 0.15 }, data: true, repeat: 0.08, ws: 60, goals: { avail: 99.5, p95: 150, budget: 1050 }, objective: { type: 'maxUtil', v: 0.85 }, palette: ['compute', 'lb', 'cache', 'db'] });
  add({ id: 'cachegone', tier: 1, rps: 2400, mix: { rd: 0.9, wr: 0.1 }, data: true, repeat: 0.95, ws: 2, incidents: [{ type: 'cacheLoss', at: 50, dur: 40 }],
    goals: { avail: 99.5, p95: 250, budget: 800 }, objective: { type: 'incAvail', v: 99.5 }, palette: ['compute', 'lb', 'cache', 'db'] });

  // ================= 2. НАГРУЗКА И НАДЁЖНОСТЬ =================
  add({ id: 'launch', tier: 2, rps: 400, incidents: [{ type: 'spike', at: 30, dur: 999, mul: 4, ramp: 1 }], goals: { avail: 99.5, p95: 250, budget: 420 }, objective: { type: 'incAvail', v: 99.5 }, palette: ['compute', 'lb'] });
  add({ id: 'grow', tier: 2, rps: 200, shape: [[0, 1], [30, 1.3], [60, 2], [90, 3.4], [120, 6]], goals: { avail: 99.5, p95: 250, budget: 230 }, objective: { type: 'maxUtil', v: 0.9 }, palette: ['compute', 'lb'] });
  add({ id: 'conns', tier: 2, rps: 1400, shape: [[0, 0.8], [40, 1], [120, 1.1]], mix: { rd: 0.8, wr: 0.2 }, data: true, repeat: 0.9, ws: 2,
    goals: { avail: 99.5, p95: 250, budget: 600 }, objective: { type: 'conn' }, palette: ['compute', 'lb', 'cache', 'db'],
    start: () => start([N('lb', X(1), Y(0), {}, 'A', 'lb'), N('compute', X(2), Y(0), { auto: true, min: 5, max: 14, pool: 20 }, 'A', 'app'), N('cache', X(3), Y(0), { mem: 4, ttl: 'h' }, 'A', 'cache'), N('db', X(4), Y(0), {}, 'A', 'db')],
      [E('users', 'lb'), E('lb', 'app'), E('app', 'cache'), E('cache', 'db')]) });
  add({ id: 'nowait', tier: 2, rps: 600, mix: { rd: 0.5, wr: 0.5 }, data: true, repeat: 0.6, ws: 2, sideMs: 450,
    goals: { avail: 99.5, p95: 250, budget: 600 }, objective: { type: 'queueAge', v: 10 }, palette: ['compute', 'lb', 'cache', 'db', 'queue', 'worker'] });
  // брокер: каждое событие нужно трём системам; параллельность ограничена разделами
  add({ id: 'broker', tier: 2, rps: 800, mix: { rd: 0.4, wr: 0.6 }, data: true, repeat: 0.5, ws: 2, fanout: 3,
    goals: { avail: 99.5, p95: 250, budget: 1100, lag: 10, missed: 0.01 }, objective: { type: 'noIdle' }, palette: ['compute', 'lb', 'db', 'queue', 'broker', 'worker'],
    start: () => start([
      N('lb', X(1), Y(0), {}, 'A', 'lb'), N('compute', X(2), Y(0), { n: 4 }, 'A', 'app'), N('db', X(3), Y(-1), { size: 'M' }, 'A', 'db'),
      N('queue', X(3), Y(1), {}, 'A', 'q'),
      N('worker', X(4), Y(0), { n: 2 }, 'A', 'mail'), N('worker', X(4), Y(1), { n: 2 }, 'A', 'stats'), N('worker', X(4), Y(2), { n: 2 }, 'A', 'stock'),
    ], [E('users', 'lb'), E('lb', 'app'), E('app', 'db'), E('app', 'q'), E('q', 'mail'), E('q', 'stats'), E('q', 'stock')]) });
  // ретраи и таймауты: медленный платёжный провайдер не должен ронять каталог
  add({ id: 'retry', tier: 2, rps: 600, mix: { rd: 0.7, wr: 0.3 }, data: true, repeat: 0.7, ws: 2,
    incidents: [{ type: 'extSlow', at: 40, dur: 40, lat: 80, cap: 0.5 }],
    goals: { avail: 88, p95: 300, budget: 420 }, objective: { type: 'incAvail', v: 65 }, palette: ['compute', 'lb', 'cache', 'db'],
    start: () => start([
      N('lb', X(1), Y(0), {}, 'A', 'lb'), N('compute', X(2), Y(0), { n: 4, timeout: 10, retries: 3, backoff: false }, 'A', 'app'),
      N('db', X(3), Y(-1), { size: 'M' }, 'A', 'db'), N('ext', X(3), Y(1), { cap: 400, lat: 60 }, 'A', 'pay'),
    ], [E('users', 'lb'), E('lb', 'app'), E('app', 'db'), E('app', 'pay', { on: 'wr' })]) });
  add({ id: 'zone', tier: 2, rps: 800, mix: { rd: 0.75, wr: 0.25 }, data: true, repeat: 0.6, ws: 2, incidents: [{ type: 'zone', zone: 'B', at: 60, dur: 50 }],
    goals: { avail: 98, p95: 250, budget: 900 }, objective: { type: 'incAvail', v: 94 }, palette: ['compute', 'lb', 'cache', 'db', 'monitor'],
    start: () => start([N('lb', X(1), Y(0), {}, 'A', 'lb'), N('compute', X(2), Y(0), { n: 4 }, 'B', 'app'), N('db', X(3), Y(0), { size: 'M' }, 'B', 'db')], [E('users', 'lb'), E('lb', 'app'), E('app', 'db')]) });
  add({ id: 'health', tier: 2, rps: 700, incidents: [{ type: 'hang', node: 'p2', at: 35, dur: 20 }, { type: 'hang', node: 'p2', at: 85, dur: 20 }],
    goals: { avail: 98, p95: 250, budget: 320 }, objective: { type: 'incAvail', v: 93 }, palette: ['compute', 'lb', 'monitor'],
    start: () => start([N('lb', X(1), Y(0), { checks: false }, 'A', 'lb'), N('compute', X(2.2), Y(-0.6), { n: 3 }, 'A', 'p1'), N('compute', X(2.2), Y(0.6), { n: 3 }, 'A', 'p2')], [E('users', 'lb'), E('lb', 'p1'), E('lb', 'p2')]) });
  add({ id: 'cfo', tier: 2, rps: 1500, mix: { rd: 0.88, wr: 0.12 }, data: true, repeat: 0.92, ws: 2,
    goals: { avail: 99.5, p95: 200, budget: 650 }, objective: { type: 'noReplica' }, palette: ['compute', 'lb', 'cache', 'db'],
    start: () => start([N('lb', X(1), Y(0), {}, 'A', 'lb'), N('compute', X(2), Y(0), { size: 'L', n: 8 }, 'A', 'app'), N('cache', X(3), Y(-0.5), { mem: 16, ttl: 's' }, 'A', 'cache'), N('db', X(4), Y(0), { size: 'L', rep: 3 }, 'A', 'db')],
      [E('users', 'lb'), E('lb', 'app'), E('app', 'cache'), E('cache', 'db')]) });

  // ================= 3. НАБЛЮДАЕМОСТЬ И КАЧЕСТВО =================
  // без мониторинга загрузка узлов скрыта: какой из трёх пулов тонет?
  add({ id: 'monitoring', tier: 3, rps: 1500, fog: ['metrics'],
    goals: { avail: 99.5, p95: 250, budget: 450 }, objective: { type: 'has', node: 'monitor' }, palette: ['compute', 'lb', 'monitor'],
    start: () => start([N('lb', X(1), Y(0), {}, 'A', 'lb'), N('compute', X(2.3), Y(-1), { n: 3 }, 'A', 'pa'), N('compute', X(2.3), Y(0), { n: 1 }, 'A', 'pb'), N('compute', X(2.3), Y(1), { n: 3 }, 'A', 'pc')],
      [E('users', 'lb'), E('lb', 'pa'), E('lb', 'pb'), E('lb', 'pc')]) });
  // без логов не видно, какой сервис сломан; откатывать нужно его
  add({ id: 'logging', tier: 3, rps: 600, fog: ['logs'], incidents: [{ type: 'badDeploy', node: 'stock', at: 30, dur: 999, err: 0.6 }],
    goals: { avail: 94, p95: 300, budget: 820 }, objective: { type: 'cfg', node: 'logs', key: 'level', val: 'info' }, palette: ['compute', 'lb', 'logs', 'monitor'],
    start: () => start([
      N('lb', X(1), Y(0), {}, 'A', 'lb'), N('compute', X(2), Y(0), { n: 3 }, 'A', 'gw'),
      N('compute', X(3.2), Y(-1.5), { n: 3 }, 'A', 'cart'), N('compute', X(3.2), Y(-0.5), { n: 3 }, 'A', 'price'), N('compute', X(3.2), Y(0.5), { n: 3 }, 'A', 'stock'), N('compute', X(3.2), Y(1.5), { n: 3 }, 'A', 'reco'),
    ], [E('users', 'lb'), E('lb', 'gw'), E('gw', 'cart'), E('gw', 'price'), E('gw', 'stock'), E('gw', 'reco')]) });
  // без трейсинга не видно, где теряется время: какой из партнёров медленный?
  add({ id: 'tracing', tier: 3, rps: 400, mix: { rd: 1 }, repeat: 0.99, ws: 2, fog: ['traces'],
    goals: { avail: 99.5, p95: 400, budget: 540 }, objective: { type: 'has', node: 'tracing' }, palette: ['compute', 'lb', 'cache', 'tracing', 'monitor'],
    start: () => start([
      N('lb', X(1), Y(0), {}, 'A', 'lb'), N('compute', X(2), Y(0), { n: 2 }, 'A', 'gw'),
      N('compute', X(3), Y(-1.2), { n: 2 }, 'A', 'sa'), N('compute', X(3), Y(0), { n: 2 }, 'A', 'sb'), N('compute', X(3), Y(1.2), { n: 2 }, 'A', 'sc'),
      N('ext', X(4.2), Y(-1.2), { cap: 3000, lat: 40 }, 'A', 'xa'), N('ext', X(4.2), Y(0), { cap: 3000, lat: 50 }, 'A', 'xb'), N('ext', X(4.2), Y(1.2), { cap: 3000, lat: 380 }, 'A', 'xc'),
    ], [E('users', 'lb'), E('lb', 'gw'), E('gw', 'sa'), E('gw', 'sb'), E('gw', 'sc'), E('sa', 'xa'), E('sb', 'xb'), E('sc', 'xc')]) });
  // нагрузочный тест до запуска показывает скрытое узкое место
  add({ id: 'loadtest', tier: 3, rps: 900, mix: { rd: 0.85, wr: 0.15 }, data: true, repeat: 0.9, ws: 2, loadTest: true,
    incidents: [{ type: 'spike', at: 30, dur: 999, mul: 4, ramp: 25 }],
    goals: { avail: 99, p95: 300, budget: 1200 }, objective: { type: 'flag', flag: 'loadtested' }, palette: ['compute', 'lb', 'cache', 'db'],
    start: () => start([N('lb', X(1), Y(0), {}, 'A', 'lb'), N('compute', X(2), Y(0), { auto: true, min: 4, max: 20, kind: 'ctr' }, 'A', 'app'), N('db', X(3), Y(0), {}, 'A', 'db')], [E('users', 'lb'), E('lb', 'app'), E('app', 'db')]) });
  // плохой релиз: тесты ловят часть ошибок, канарейка с мониторингом — остальное
  add({ id: 'testing', tier: 3, rps: 700, incidents: [{ type: 'badDeploy', node: 'app', at: 40, dur: 999, err: 0.5 }],
    goals: { avail: 99, p95: 250, budget: 300 }, objective: { type: 'has', node: 'tests' }, palette: ['compute', 'lb', 'tests', 'monitor'],
    start: () => start([N('lb', X(1), Y(0), {}, 'A', 'lb'), N('compute', X(2), Y(0), { n: 4 }, 'A', 'app')], [E('users', 'lb'), E('lb', 'app')]) });

  // ================= 4. ПЛАТФОРМА =================
  // 12 factor: состояние вне процесса, конфиг в окружении, логи — потоком
  add({ id: 'twelve', tier: 4, rps: 300, shape: [[0, 1], [120, 4]], mix: { rd: 0.8, wr: 0.2 }, data: true, repeat: 0.6, ws: 2, stateful: 0.6,
    incidents: [{ type: 'cfgChange', at: 50 }, { type: 'diskFull', at: 85, dur: 25 }],
    goals: { avail: 99, p95: 250, budget: 520 }, objective: { type: 'cfg', node: 'compute', key: 'auto', val: true }, palette: ['compute', 'lb', 'cache', 'db'],
    start: () => start([N('lb', X(1), Y(0), {}, 'A', 'lb'), N('compute', X(2), Y(0), { n: 2, state: 'local', conf: 'baked', logsTo: 'file' }, 'A', 'app'), N('db', X(3), Y(0), { size: 'M' }, 'A', 'db')],
      [E('users', 'lb'), E('lb', 'app'), E('app', 'db')]) });
  // Kubernetes: обновление версии без простоя
  add({ id: 'k8s1', tier: 4, rps: 800, incidents: [{ type: 'rollout', at: 40 }, { type: 'rollout', at: 85 }],
    goals: { avail: 99.5, p95: 250, budget: 260 }, objective: { type: 'cfg', node: 'deploy', key: 'ready', val: true }, palette: ['ingress', 'deploy'],
    start: () => start([N('ingress', X(1), Y(0), {}, 'A', 'ing'), N('deploy', X(2), Y(0), { n: 4, ready: false, strategy: 'recreate' }, 'A', 'api')], [E('users', 'ing'), E('ing', 'api')]) });
  // Kubernetes: автомасштаб подов упирается в размер кластера
  add({ id: 'k8s2', tier: 4, rps: 600, shape: [[0, 1], [30, 2.5], [70, 6], [100, 8], [120, 8]],
    goals: { avail: 99.5, p95: 250, budget: 520 }, objective: { type: 'cfg', node: 'nodes', key: 'ca', val: true }, palette: ['ingress', 'deploy', 'nodes'],
    start: () => start([N('ingress', X(1), Y(0), {}, 'A', 'ing'), N('deploy', X(2), Y(0), { n: 4, cpu: 1 }, 'A', 'api'), N('nodes', X(2), Y(-1.4), { count: 2, size: 'S' }, 'A', 'pool')], [E('users', 'ing'), E('ing', 'api')]) });
  // Kubernetes: отказ узла и плановое обслуживание
  add({ id: 'k8s3', tier: 4, rps: 2600, incidents: [{ type: 'nodeFail', at: 35, dur: 40 }, { type: 'drain', at: 85, dur: 30 }],
    goals: { avail: 99.5, p95: 250, budget: 900 }, objective: { type: 'cfg', node: 'deploy', key: 'pdb', val: true }, palette: ['ingress', 'deploy', 'nodes', 'monitor'],
    start: () => start([N('ingress', X(1), Y(0), {}, 'A', 'ing'), N('deploy', X(2), Y(0), { n: 6, cpu: 1, spread: false }, 'A', 'api'), N('nodes', X(2), Y(-1.4), { count: 3, size: 'M' }, 'A', 'pool')], [E('users', 'ing'), E('ing', 'api')]) });
  // Kubernetes: шумный сосед без лимитов
  add({ id: 'k8s4', tier: 4, rps: 1500, incidents: [{ type: 'noisy', at: 40, dur: 50 }],
    goals: { avail: 99.5, p95: 250, budget: 600 }, objective: { type: 'cfg', node: 'deploy', key: 'limit', val: true }, palette: ['ingress', 'deploy', 'nodes'],
    start: () => start([N('ingress', X(1), Y(0), {}, 'A', 'ing'), N('deploy', X(2), Y(0), { n: 6, cpu: 0.5 }, 'A', 'api'), N('deploy', X(2), Y(1.3), { n: 3, cpu: 1, batch: true, limit: false }, 'A', 'reports'), N('nodes', X(2), Y(-1.4), { count: 3, size: 'S' }, 'A', 'pool')],
      [E('users', 'ing'), E('ing', 'api')]) });
  // веб-сокеты: держать соединения, разносить сообщения между экземплярами, не устроить лавину
  add({ id: 'sockets', tier: 4, rps: 0, sock: { users: 30000, rate: 0.1, bcast: 0.8 }, incidents: [{ type: 'wsRestart', at: 60 }],
    goals: { avail: 97, p95: 250, budget: 520 }, objective: { type: 'cfg', node: 'wsgw', key: 'drain', val: true }, palette: ['lb', 'wsgw', 'broker'],
    start: () => start([N('lb', X(1), Y(0), {}, 'A', 'lb'), N('wsgw', X(2), Y(0), { n: 1 }, 'A', 'gw')], [E('users', 'lb'), E('lb', 'gw')]) });
  add({ id: 'certs', tier: 4, rps: 800, mix: { rd: 0.8, wr: 0.2 }, data: true, repeat: 0.6, ws: 2, incidents: [{ type: 'certExpire', at: 50 }],
    goals: { avail: 99.5, p95: 250, budget: 500 }, objective: { type: 'cfg', node: 'lb', key: 'tls', val: 'auto' }, palette: ['compute', 'lb', 'db', 'monitor'],
    start: () => start([N('lb', X(1), Y(0), { tls: 'manual' }, 'A', 'lb'), N('compute', X(2), Y(0), { n: 4 }, 'A', 'app'), N('db', X(3), Y(0), { size: 'M' }, 'A', 'db')], [E('users', 'lb'), E('lb', 'app'), E('app', 'db')]) });
  add({ id: 'security', tier: 4, rps: 600, mix: { rd: 0.8, wr: 0.2 }, data: true, repeat: 0.6, ws: 2, sec: ['waf', 'vault', 'dbPrivate', 'tls'],
    incidents: [{ type: 'bots', at: 25, dur: 999, rps: 2500 }, { type: 'leak', at: 55 }, { type: 'scan', at: 85 }],
    goals: { avail: 99, p95: 250, budget: 700, sec: 1 }, objective: { type: 'bots', v: 0.9 }, palette: ['compute', 'lb', 'db', 'waf', 'vault'],
    start: () => start([N('lb', X(1), Y(0), {}, 'A', 'lb'), N('compute', X(2), Y(0), { n: 4 }, 'A', 'app'), N('db', X(3), Y(0), { size: 'M', pub: true }, 'A', 'db')], [E('users', 'lb'), E('lb', 'app'), E('app', 'db')]) });
  add({ id: 'vpn', tier: 4, rps: 700, mix: { rd: 0.6, wr: 0.4 }, data: true, repeat: 0.6, ws: 2, sec: ['vpn'], incidents: [{ type: 'vpnDown', at: 60, dur: 40 }],
    goals: { avail: 99, p95: 350, budget: 600, sec: 1 }, objective: { type: 'cfg', node: 'vpn', key: 'tunnels', val: 2 }, palette: ['compute', 'lb', 'db', 'vpn'],
    start: () => start([N('lb', X(1), Y(0), {}, 'A', 'lb'), N('compute', X(2), Y(0), { n: 3 }, 'A', 'app'), N('db', X(3), Y(-1), { size: 'M' }, 'A', 'db'), N('ext', X(4), Y(1), { cap: 1200, lat: 40, priv: true }, 'A', 'erp')],
      [E('users', 'lb'), E('lb', 'app'), E('app', 'db'), E('app', 'erp', { on: 'wr' })]) });
  const R2 = { region: 'R2' };
  add({ id: 'multiregion', tier: 4, rps: 1000, mix: { rd: 0.8, wr: 0.2 }, data: true, repeat: 0.6, ws: 2, geo: { R1: 0.5, R2: 0.5 },
    incidents: [{ type: 'region', region: 'R1', at: 60, dur: 40 }],
    goals: { avail: 90, p95: 400, budget: 1400 }, objective: { type: 'lost', v: 0 }, palette: ['dns', 'compute', 'lb', 'cache', 'db', 'monitor'],
    start: () => start([N('lb', X(1), Y(0), {}, 'A', 'lb'), N('compute', X(2), Y(0), { n: 4 }, 'A', 'app'), N('db', X(3), Y(0), { size: 'M' }, 'A', 'db')], [E('users', 'lb'), E('lb', 'app'), E('app', 'db')]) });
  add({ id: 'multicloud', tier: 4, rps: 1000, mix: { rd: 0.8, wr: 0.2 }, data: true, repeat: 0.6, ws: 2, geo: { R1: 0.5, R2: 0.5 },
    incidents: [{ type: 'cloud', cloud: 'C1', at: 55, dur: 45 }],
    goals: { avail: 88, p95: 350, budget: 1700 }, objective: { type: 'egress', v: 300 }, palette: ['dns', 'compute', 'lb', 'cache', 'db'],
    start: () => start([
      N('dns', X(1), Y(0), {}, 'A', 'dns'),
      N('lb', X(2), Y(-1), {}, { region: 'R1' }, 'lb1'), N('compute', X(3), Y(-1), { n: 3 }, { region: 'R1' }, 'app1'),
      N('lb', X(2), Y(1), {}, R2, 'lb2'), N('compute', X(3), Y(1), { n: 3 }, R2, 'app2'),
      N('db', X(4), Y(0), { size: 'M', xr: 'async' }, { region: 'R1' }, 'db'),
    ], [E('users', 'dns'), E('dns', 'lb1'), E('dns', 'lb2'), E('lb1', 'app1'), E('lb2', 'app2'), E('app1', 'db'), E('app2', 'db')]) });

  // ================= 5. АРХИТЕКТУРА =================
  // модули: w — работа на запрос; группы — процессы (сервисы) или агрегаты
  const M = (id, x, y, grp, extra) => N('mod', x, y, Object.assign({ grp, w: 1 }, extra || {}), 'A', id);
  const shop = (g) => [
    M('catalog', X(2), Y(-1.5), g[0]), M('cart', X(2), Y(-0.5), g[1]), M('checkout', X(2), Y(0.5), g[2]),
    M('stock', X(3.3), Y(0), g[3]), M('pay', X(3.3), Y(1), g[4]), M('reports', X(2), Y(1.6), g[5], { w: 4 }),
  ];
  const shopEdges = () => [E('users', 'lb'), E('lb', 'catalog'), E('lb', 'cart'), E('lb', 'checkout'), E('lb', 'reports'), E('checkout', 'stock', { need: 'reply' }), E('checkout', 'pay', { need: 'reply' })];
  const shopShare = { catalog: 0.57, cart: 0.25, checkout: 0.15, reports: 0.03 };
  // небольшой стартап, а нарезано на шесть сервисов: склеить в монолит
  add({ id: 'monolith', tier: 5, rps: 200, opShare: shopShare, groupNoun: 'svc',
    goals: { avail: 99.5, p95: 150, budget: 450 }, objective: { type: 'maxGroups', v: 1 }, palette: ['mod'],
    start: () => start([N('lb', X(1), Y(0), {}, 'A', 'lb')].concat(shop(['A', 'B', 'C', 'D', 'E', 'F'])), shopEdges(),
      { A: { n: 2 }, B: { n: 2 }, C: { n: 2 }, D: { n: 2 }, E: { n: 2 }, F: { n: 2 } }) });
  // модульный монолит: переборки внутри процесса и никаких общих таблиц
  add({ id: 'modular', tier: 5, rps: 900, opShare: shopShare, groupNoun: 'svc',
    incidents: [{ type: 'heavy', node: 'reports', at: 30, dur: 40, mul: 8 }, { type: 'migration', node: 'cart', at: 90 }],
    goals: { avail: 98.5, p95: 280, budget: 800 }, objective: { type: 'noShared' }, palette: ['mod'],
    start: () => {
      const a = start([N('lb', X(1), Y(0), {}, 'A', 'lb')].concat(shop(['A', 'A', 'A', 'A', 'A', 'A'])), shopEdges(), { A: { n: 4 } });
      a.edges.push(E('cart', 'checkout', { k: 'db' }), E('reports', 'cart', { k: 'db' }));
      return a;
    } });
  // распил по-умному: вынести только горячий модуль
  add({ id: 'strangler', tier: 5, rps: 1500, opShare: { catalog: 0.2, search: 0.5, cart: 0.15, checkout: 0.15 }, groupNoun: 'svc',
    goals: { avail: 99.5, p95: 250, budget: 1000 }, objective: { type: 'maxGroups', v: 2 }, palette: ['mod'],
    start: () => start([N('lb', X(1), Y(0), {}, 'A', 'lb'),
      M('catalog', X(2), Y(-1.5), 'A'), M('search', X(2), Y(-0.5), 'A', { w: 2 }), M('cart', X(2), Y(0.5), 'A'), M('checkout', X(2), Y(1.5), 'A'),
      M('stock', X(3.3), Y(0.5), 'A'), M('pay', X(3.3), Y(1.5), 'A')],
    [E('users', 'lb'), E('lb', 'catalog'), E('lb', 'search'), E('lb', 'cart'), E('lb', 'checkout'), E('checkout', 'stock', { need: 'reply' }), E('checkout', 'pay', { need: 'reply' })], { A: { n: 5 } }) });
  // распределённый монолит: всё синхронно и на общей базе
  add({ id: 'distmono', tier: 5, rps: 700, opShare: { orders: 0.6, profile: 0.4 }, groupNoun: 'svc',
    incidents: [{ type: 'groupDown', node: 'notify', at: 35, dur: 30 }, { type: 'migration', node: 'orders', at: 85 }],
    goals: { avail: 99, p95: 250, budget: 1000, lag: 60 }, objective: { type: 'noShared' }, palette: ['mod'],
    start: () => start([N('lb', X(1), Y(0), {}, 'A', 'lb'),
      M('orders', X(2), Y(-0.6), 'A'), M('profile', X(2), Y(0.8), 'B'), M('billing', X(3.2), Y(-1.2), 'C'), M('notify', X(3.2), Y(0), 'D'), M('stats', X(3.2), Y(1.2), 'E')],
    [E('users', 'lb'), E('lb', 'orders'), E('lb', 'profile'), E('orders', 'billing', { need: 'must' }), E('orders', 'notify', { need: 'fyi' }), E('orders', 'stats', { need: 'fyi' }), E('profile', 'notify', { need: 'fyi' }),
      E('orders', 'profile', { k: 'db' }), E('billing', 'stats', { k: 'db' })],
    { A: { n: 2 }, B: { n: 2 }, C: { n: 2 }, D: { n: 3 }, E: { n: 2 } }) });
  // микросервисный ад: сервис на каждую функцию
  add({ id: 'mshell', tier: 5, rps: 600, opShare: { web: 1 }, groupNoun: 'svc',
    incidents: [{ type: 'groupDown', node: 'avatar', at: 40, dur: 25 }, { type: 'groupDown', node: 'tz', at: 80, dur: 25 }],
    goals: { avail: 99, p95: 200, budget: 1200 }, objective: { type: 'maxGroups', v: 4 }, palette: ['mod'],
    start: () => {
      const ids = ['web', 'auth', 'user', 'avatar', 'tz', 'feed', 'post', 'like', 'comment', 'media', 'search', 'rank'];
      const nodes = [N('lb', X(1), Y(0), {}, 'A', 'lb')];
      ids.forEach((id, i) => nodes.push(M(id, X(2 + Math.floor(i / 4) * 1.15), Y(-1.5 + (i % 4)), String.fromCharCode(65 + i), { w: 0.5 })));
      const e = [E('users', 'lb'), E('lb', 'web'), E('web', 'auth', { need: 'reply' }), E('auth', 'user', { need: 'reply' }), E('user', 'avatar', { need: 'fyi' }), E('user', 'tz', { need: 'fyi' }),
        E('web', 'feed', { need: 'reply' }), E('feed', 'post', { need: 'reply' }), E('post', 'like', { need: 'reply' }), E('post', 'comment', { need: 'reply' }), E('post', 'media', { need: 'reply' }), E('feed', 'rank', { need: 'reply' }), E('rank', 'search', { need: 'reply' })];
      const groups = {}; ids.forEach((id, i) => (groups[String.fromCharCode(65 + i)] = { n: 2 }));
      return { nodes: [users()].concat(nodes), edges: e, groups };
    } });
  // DDD-стратегия: границы по болтливости, ACL на стыке контекстов
  add({ id: 'dddstrat', tier: 5, rps: 500, opShare: { sales: 0.6, support: 0.4 }, groupNoun: 'ctx',
    incidents: [{ type: 'contract', node: 'customer', at: 60, dur: 30 }],
    goals: { avail: 99, p95: 200, budget: 900 }, objective: { type: 'maxGroups', v: 3 }, palette: ['mod'],
    start: () => start([N('lb', X(1), Y(0), {}, 'A', 'lb'),
      M('sales', X(2), Y(-1), 'A'), M('pricing', X(3), Y(-1.6), 'B'), M('quote', X(3), Y(-0.6), 'A'),
      M('support', X(2), Y(1), 'C'), M('ticket', X(3), Y(0.6), 'B'), M('kb', X(3), Y(1.6), 'C'), M('customer', X(4.2), Y(0), 'D')],
    [E('users', 'lb'), E('lb', 'sales'), E('lb', 'support'),
      E('sales', 'pricing', { need: 'reply', n: 6 }), E('sales', 'quote', { need: 'reply', n: 4 }), E('quote', 'pricing', { need: 'reply', n: 5 }),
      E('support', 'ticket', { need: 'reply', n: 6 }), E('support', 'kb', { need: 'reply', n: 4 }), E('ticket', 'kb', { need: 'reply', n: 3 }),
      E('sales', 'customer', { need: 'reply' }), E('support', 'customer', { need: 'reply' })],
    { A: { n: 2 }, B: { n: 2 }, C: { n: 2 }, D: { n: 2 } }) });
  // DDD-тактика: агрегат — граница согласованности, а не «всё вместе»
  add({ id: 'dddtact', tier: 5, rps: 400, opShare: { order: 1 }, groupNoun: 'agg', grpCost: 10, conflict: 0.03,
    goals: { avail: 99.5, p95: 200, budget: 600, inv: 1 }, objective: { type: 'maxGroups', v: 3 }, palette: ['mod'],
    start: () => start([N('lb', X(1), Y(0), {}, 'A', 'lb'),
      M('order', X(2), Y(-0.5), 'A'), M('line', X(3), Y(-1.3), 'B'), M('product', X(3), Y(0), 'A', { hot: true }), M('stock', X(3), Y(1.3), 'A')],
    [E('users', 'lb'), E('lb', 'order'), E('order', 'line', { need: 'inv' }), E('order', 'product', { need: 'reply' }), E('order', 'stock', { need: 'must' })],
    { A: { n: 3 }, B: { n: 2 } }) });
  // команды и события: кому нужен ответ, кому — просто знать
  add({ id: 'cmdevt', tier: 5, rps: 500, opShare: { orders: 1 }, groupNoun: 'svc',
    incidents: [{ type: 'groupDown', node: 'stats', at: 35, dur: 25 }, { type: 'addConsumer', edge: ['orders', 'loyalty'], at: 75 }],
    goals: { avail: 99, p95: 200, budget: 900, lag: 30 }, objective: { type: 'has', node: 'mod' }, palette: ['mod'],
    start: () => start([N('lb', X(1), Y(0), {}, 'A', 'lb'),
      M('orders', X(2), Y(0), 'A'), M('pay', X(3.2), Y(-1.5), 'B'), M('mail', X(3.2), Y(-0.5), 'C'), M('stats', X(3.2), Y(0.5), 'D'), M('loyalty', X(3.2), Y(1.5), 'E')],
    [E('users', 'lb'), E('lb', 'orders'), E('orders', 'pay', { need: 'must' }), E('orders', 'mail', { need: 'fyi' }), E('orders', 'stats', { need: 'fyi' }), E('orders', 'loyalty', { need: 'fyi' })],
    { A: { n: 2 }, B: { n: 2 }, C: { n: 1 }, D: { n: 1 }, E: { n: 1 } }) });
  // процессы: сага с компенсацией
  add({ id: 'saga', tier: 5, rps: 400, opShare: { orders: 1 }, groupNoun: 'svc', reserveBefore: true,
    incidents: [{ type: 'groupDown', node: 'pay', at: 45, dur: 30 }],
    goals: { avail: 99, p95: 250, budget: 900, hanging: 5, lag: 45 }, objective: { type: 'has', node: 'saga' }, palette: ['mod', 'saga'],
    start: () => start([N('lb', X(1), Y(0), {}, 'A', 'lb'),
      M('orders', X(2), Y(0), 'A'), M('stock', X(3), Y(-1), 'B', { reserve: true }), M('pay', X(4), Y(0), 'C', { decline: 0.05 }), M('ship', X(5), Y(1), 'D')],
    [E('users', 'lb'), E('lb', 'orders'), E('orders', 'stock', { need: 'must' }), E('stock', 'pay', { need: 'must' }), E('pay', 'ship', { need: 'must' })],
    { A: { n: 2 }, B: { n: 2 }, C: { n: 2 }, D: { n: 1 } }) });
  add({ id: 'friday', tier: 5, rps: 700, mix: { st: 0.3, rd: 0.5, wr: 0.2 }, data: true, repeat: 0.85, ws: 2, far: 0.4, farMs: 140, apiCache: 0.6, sideMs: 300,
    incidents: [{ type: 'spike', at: 25, dur: 999, mul: 2.5, ramp: 15 }, { type: 'bots', at: 45, dur: 999, rps: 2500 }, { type: 'zone', zone: 'B', at: 75, dur: 35 }],
    goals: { avail: 98.5, p95: 250, budget: 2000 }, objective: { type: 'monitor' }, palette: ['cdn', 'waf', 'lb', 'compute', 'cache', 'db', 'queue', 'worker', 'storage', 'monitor'] });

  // тир → порядковые номера
  U.LEVELS = LV;
  LV.forEach((l, i) => { l.n = i; l.tierIdx = LV.filter((x) => x.tier === l.tier).indexOf(l) + 1; });
  U.levelById = (id) => LV.find((l) => l.id === id);
  U.startArch = (lv) => (lv.start ? lv.start() : start());

  // когда открывается настройка (id уровня)
  const FROM = {
    compute: { n: 'intro', size: 'two', auto: 'launch', min: 'launch', max: 'launch', kind: 'launch', tgt: 'grow', pool: 'conns', zone: 'zone', timeout: 'retry', retries: 'retry', backoff: 'retry', breaker: 'retry', state: 'twelve', conf: 'twelve', logsTo: 'twelve', rollout: 'testing' },
    cache: { mem: 'readheavy', ttl: 'readheavy', replica: 'cachegone', zone: 'zone' },
    db: { size: 'conns', rep: 'feed', mz: 'zone', zone: 'zone', pub: 'security', xr: 'multiregion' },
    cdn: { ttl: 'far', api: 'far' },
    lb: { checks: 'health', tls: 'certs' },
    worker: { n: 'nowait', auto: 'broker', max: 'broker', zone: 'zone' },
  };
  const idx = (id) => LV.findIndex((l) => l.id === id);
  U.ctlOpen = function (type, key, lv) {
    if (!lv || lv.id === 'daily' || lv.id === 'surv' || lv.id === 'sandbox') return true;
    const f = FROM[type] && FROM[type][key];
    if (!f) return true;
    return idx(lv.id) >= idx(f);
  };
  U.newBlocks = function (lv) {
    const li = idx(lv.id); if (li < 0) return [];
    const seen = new Set(); LV.slice(0, li).forEach((l) => l.palette.forEach((t) => seen.add(t)));
    return lv.palette.filter((t) => !seen.has(t));
  };

  // ---------- задача дня ----------
  U.dailyScenario = function (dateKey) {
    const seed = parseInt(dateKey.replace(/-/g, ''), 10);
    const rnd = U.rng(seed);
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const kinds = [
      { k: 'shop', mix: { st: 0.35, rd: 0.5, wr: 0.15 }, repeat: 0.8, apiCache: 0.6 },
      { k: 'chat', mix: { rd: 0.55, wr: 0.45 }, repeat: 0.3, sideMs: 250 },
      { k: 'news', mix: { st: 0.4, rd: 0.58, wr: 0.02 }, repeat: 0.95, apiCache: 0.9 },
      { k: 'social', mix: { rd: 0.8, wr: 0.2 }, repeat: 0.15, ws: 40 },
      { k: 'video', mix: { st: 0.7, rd: 0.28, wr: 0.02 }, repeat: 0.85, apiCache: 0.5 },
    ];
    const k = pick(kinds);
    const rps = Math.round((300 + rnd() * 1500) / 50) * 50;
    const pool = [
      () => ({ type: 'spike', mul: +(2 + rnd() * 2).toFixed(1), ramp: pick([1, 10, 30]), dur: 999 }),
      () => ({ type: 'zone', zone: 'B', dur: 40 }),
      () => ({ type: 'cacheLoss', dur: 35 }),
      () => ({ type: 'bots', rps: Math.round(rps * (2 + rnd() * 3)), dur: 999 }),
      () => ({ type: 'crash', k: 2, dur: 30 }),
    ];
    const incidents = []; const used = new Set();
    while (incidents.length < 2) { const i = Math.floor(rnd() * pool.length); if (used.has(i)) continue; used.add(i); incidents.push(pool[i]()); }
    incidents[0].at = 25 + Math.round(rnd() * 15); incidents[1].at = 65 + Math.round(rnd() * 20);
    const far = rnd() < 0.4 ? 0.5 : 0;
    const sc = {
      id: 'daily', kind: k.k, rps, shape: [[0, 1]], mix: k.mix, data: true, repeat: k.repeat, ws: k.ws || 2, apiCache: k.apiCache || 0, sideMs: k.sideMs || 0,
      far, farMs: far ? 150 : 0, incidents, dur: 120, palette: U.ORDER.filter((t) => U.SVC[t] !== undefined || ['cdn', 'waf', 'lb', 'cache', 'db', 'queue', 'worker', 'storage', 'monitor'].includes(t)).filter((t) => t !== 'deploy' && t !== 'mod'), seed,
      goals: { avail: 99, p95: 300, budget: 1000 }, objective: { type: 'monitor' },
    };
    const ref = U.refArch(sc);
    const r = U.runHeadless(ref, sc);
    sc.goals.budget = Math.ceil(r.cost * 1.3 / 10) * 10;
    sc.goals.p95 = Math.max(200, Math.ceil(r.p95 * 1.25 / 10) * 10);
    sc.goals.avail = r.avail >= 99.5 ? 99.5 : r.avail >= 99 ? 99 : Math.floor(r.avail * 2) / 2;
    return sc;
  };

  // эталонная схема: бюджет задачи дня
  U.refArch = function (sc) {
    const peak = sc.rps * Math.max(...sc.shape.map((p) => p[1])) * (sc.incidents || []).reduce((m, i) => m * (i.type === 'spike' ? i.mul : 1), 1);
    const nodes = [users()]; const edges = [];
    let prev = 'users'; let x = 230;
    const addN = (n) => { nodes.push(n); return n.id; };
    if ((sc.mix.st || 0) > 0 || sc.far) { const c = addN(N('cdn', x, 260, { ttl: 'long', api: (sc.apiCache || 0) > 0.3 }, 'A', 'r_cdn')); edges.push([prev, c]); prev = c; x += 150; }
    if ((sc.incidents || []).some((i) => i.type === 'bots')) { const w = addN(N('waf', x, 260, { sens: 'mid', rl: 'loose' }, 'A', 'r_waf')); edges.push([prev, w]); prev = w; x += 150; }
    const lb = addN(N('lb', x, 260, {}, 'A', 'r_lb')); edges.push([prev, lb]); x += 160;
    if ((sc.mix.st || 0) > 0) { const s = addN(N('storage', x, 420, {}, 'A', 'r_st')); edges.push([lb, s]); }
    const units = peak * ((sc.mix.rd || 0) + (sc.mix.wr || 0) * 1.5);
    const per = Math.max(2, Math.ceil(units / 600 / 0.6));
    const zone = (sc.incidents || []).some((i) => i.type === 'zone');
    const pools = zone ? ['A', 'B'] : ['A'];
    const db = N('db', x + 360, 260, { size: 'M', rep: (sc.repeat || 0) < 0.4 ? 2 : 0, mz: zone }, 'A', 'r_db');
    const cache = (sc.repeat || 0) >= 0.4 ? N('cache', x + 180, 160, { mem: 4, ttl: 'h', replica: true }, 'A', 'r_cache') : null;
    const q = sc.sideMs ? N('queue', x + 180, 420, {}, 'A', 'r_q') : null;
    pools.forEach((z, i) => {
      const id = addN(N('compute', x, 200 + i * 140, { size: 'M', kind: 'ctr', auto: true, min: zone ? per : Math.ceil(per * 0.8), max: per * 3, pool: 10 }, z, 'r_app' + z));
      edges.push([lb, id]);
      if (cache) edges.push([id, cache.id]); else edges.push([id, db.id]);
      if (cache) edges.push([id, db.id]);
      if (q) edges.push([id, q.id]);
    });
    if (cache) { nodes.push(cache); edges.push([cache.id, db.id]); }
    nodes.push(db);
    if (q) { nodes.push(q); const w = addN(N('worker', x + 360, 420, { n: 3, auto: true, max: 20 }, 'A', 'r_w')); edges.push([q.id, w]); }
    nodes.push(N('monitor', x + 360, 80, {}, 'A', 'r_mon'));
    const seen = new Set();
    return { nodes, edges: edges.filter((e) => { const k = e.join('>'); if (seen.has(k)) return false; seen.add(k); return true; }), groups: {} };
  };

  // порядок блоков в палитре
  U.ORDER = ['dns', 'cdn', 'waf', 'lb', 'ingress', 'compute', 'deploy', 'mod', 'wsgw', 'cache', 'db', 'storage', 'queue', 'broker', 'worker', 'ext', 'vpn', 'nodes', 'saga', 'monitor', 'logs', 'tracing', 'tests', 'vault'];
  U.GROUP_OF = { users: 'net', dns: 'net', cdn: 'net', waf: 'net', lb: 'route', ingress: 'route', compute: 'comp', deploy: 'comp', mod: 'comp', wsgw: 'comp', nodes: 'comp', cache: 'data', db: 'data', storage: 'data', queue: 'async', broker: 'async', worker: 'async', saga: 'async', ext: 'x', vpn: 'net', monitor: 'obs', logs: 'obs', tracing: 'obs', tests: 'obs', vault: 'obs' };
  U.SANDBOX_PALETTE = ['dns', 'cdn', 'waf', 'lb', 'compute', 'cache', 'db', 'storage', 'queue', 'broker', 'worker', 'monitor', 'logs', 'tracing'];
  return { LEVELS: U.LEVELS, TIERS: U.TIERS };
});
