'use strict';
// Модель мира: константы, каталог блоков, допустимые связи, стоимость, очередь (Erlang C), сценарий трафика.
// Ни DOM, ни экрана: часть работает и в браузере, и в Node.
L.def('sim/model', () => {
  const U = L.use('core');
  const SZ = { S: 1, M: 2, L: 4 };
  const K = U.K = {
    dt: 0.5,
    compCap: 300, compSq: 40, compBase: 18, threads: 200,
    podCapPerCpu: 600, podStart: 6,
    dbCap: 1000, dbSq: 22, dbBase: 6, dbConn: 100,
    workerCap: 120, extLat: 60,
    netBase: 30, cdnHit: 12, storageLat: 25, lbLat: 2, wafLat: 3, hop: 8, inproc: 1,
    crossRegion: 80, crossCloud: 20, farUser: 120,
    checkDelay: 2, nodeBoot: 20, vmBoot: 25, ctrBoot: 6,
    overWait: 650, rhoMax: 0.95,
    detectMon: 2, detectBlind: 20, dnsDetect: 10,
    grpCost: 60,
  };
  U.SZ = SZ;
  const WAF_BLOCK = { off: 0, low: 0.45, mid: 0.78, high: 0.94 };
  const WAF_FP = { off: 0, low: 0, mid: 0.002, high: 0.05 };
  const RL_BLOCK = { off: 0, loose: 0.6, strict: 0.9 };
  const RL_FP = { off: 0, loose: 0, strict: 0.04 };
  const TTL_F = { s: 0.35, m: 0.85, h: 0.97 };
  const MEM_COST = { 1: 25, 4: 80, 16: 260 };
  const TEST_CATCH = { none: 0, unit: 0.3, int: 0.65, full: 0.9 };
  const TEST_COST = { none: 0, unit: 20, int: 60, full: 160 };
  const LOG_COST = { debug: 0.25, info: 0.04, error: 0.01 };
  const NODE_CPU = { S: 4, M: 8, L: 16 };
  U.NODE_CPU = NODE_CPU;

  // узлы, которые сами обслуживают запросы (мощность, очередь, вызовы дальше)
  const SVC = { compute: 1, deploy: 1, mod: 1 };
  U.SVC = SVC;

  // ---------- допустимые связи ----------
  U.LINKS = {
    users: ['dns', 'cdn', 'waf', 'lb', 'ingress', 'compute', 'wsgw'],
    dns: ['cdn', 'waf', 'lb', 'ingress'],
    cdn: ['waf', 'lb', 'ingress', 'compute', 'storage'],
    waf: ['cdn', 'lb', 'ingress', 'compute'],
    lb: ['compute', 'deploy', 'storage', 'wsgw', 'mod'],
    ingress: ['deploy', 'compute', 'storage'],
    compute: ['compute', 'deploy', 'cache', 'db', 'queue', 'broker', 'storage', 'ext', 'vpn'],
    deploy: ['deploy', 'compute', 'cache', 'db', 'queue', 'broker', 'ext', 'vpn'],
    mod: ['mod', 'cache', 'db', 'queue', 'broker', 'ext'],
    cache: ['db', 'ext'],
    queue: ['worker'],
    broker: ['worker'],
    vpn: ['ext'],
    wsgw: ['broker'],
    worker: [], db: [], storage: [], ext: [], monitor: [], logs: [], tracing: [], vault: [], tests: [], nodes: [], saga: [],
  };

  U.DEFAULTS = {
    users: {},
    dns: { failover: true, ttl: 'short' },
    cdn: { ttl: 'long', api: false },
    waf: { sens: 'mid', rl: 'off' },
    lb: { checks: true, tls: 'auto' },
    ingress: { tls: 'auto' },
    compute: { size: 'S', n: 1, auto: false, min: 1, max: 6, tgt: 65, pool: 10, kind: 'vm', timeout: 3, retries: 0, backoff: true, breaker: false, state: 'shared', conf: 'env', logsTo: 'stdout', rollout: 'all' },
    deploy: { cpu: 0.5, n: 3, hpa: false, min: 2, max: 12, ready: true, strategy: 'rolling', limit: true, spread: true, pdb: false, rollout: 'all', timeout: 3, batch: false },
    mod: { grp: 'A', w: 1 },
    cache: { mem: 4, ttl: 'm', replica: false },
    db: { size: 'S', rep: 0, mz: false, pub: false, xr: 'none' },
    queue: {},
    broker: { parts: 3 },
    worker: { n: 2, auto: false, max: 10 },
    storage: {},
    ext: { cap: 1000, lat: 60, priv: false },
    vpn: { tunnels: 1 },
    wsgw: { n: 1, size: 'S', backoff: false, drain: false },
    monitor: {}, logs: { level: 'info' }, tracing: { sample: 10 }, vault: {}, tests: { suite: 'none' },
    nodes: { count: 3, size: 'M', ca: false },
    saga: {},
  };
  U.ZONED = { compute: 1, cache: 1, db: 1, worker: 1, deploy: 1, wsgw: 1 };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  U.clone = clone;
  U.eopt = (e) => e[2] || {};
  U.children = (arch, id) => arch.edges.filter((e) => e[0] === id).map((e) => e[1]);
  U.edge = (arch, a, b) => arch.edges.find((e) => e[0] === a && e[1] === b);
  U.canLink = function (arch, a, b) {
    if (a === b) return false;
    const na = arch.nodes.find((n) => n.id === a), nb = arch.nodes.find((n) => n.id === b);
    if (!na || !nb) return false;
    if (!(U.LINKS[na.type] || []).includes(nb.type)) return false;
    if (arch.edges.some((e) => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a))) return false;
    const seen = new Set([b]); const st = [b];
    while (st.length) { const x = st.pop(); if (x === a) return false; for (const y of U.children(arch, x)) if (!seen.has(y)) { seen.add(y); st.push(y); } }
    return true;
  };
  const grpOf = (n) => (n && n.type === 'mod' ? n.cfg.grp : null);
  U.groupsUsed = (arch) => [...new Set(arch.nodes.filter((n) => n.type === 'mod').map((n) => n.cfg.grp))].sort();
  U.groupCfg = (arch, g) => Object.assign({ n: 2, bulkhead: false }, (arch.groups || {})[g] || {});
  // чем больше модулей в одном процессе, тем больше ему нужно памяти — машина дороже, а мощность та же
  U.groupSize = (arch, g) => { const m = arch.nodes.filter((n) => n.type === 'mod' && n.cfg.grp === g).length; return m <= 3 ? 'S' : m <= 5 ? 'M' : 'L'; };

  // ---------- стоимость ($ в месяц) ----------
  function instCost(n) { return 40 * SZ[n.cfg.size] * (n.cfg.kind === 'ctr' ? 1.3 : 1); }
  U.nodeCost = function (n, rt, arch) {
    const c = n.cfg;
    switch (n.type) {
      case 'dns': return 20;
      case 'cdn': return 40 + (rt ? rt.rps * 0.03 : 0);
      case 'waf': return 50 + (c.rl !== 'off' ? 10 : 0);
      case 'lb': return 25 + (c.tls === 'auto' ? 5 : 0);
      case 'ingress': return 30 + (c.tls === 'auto' ? 5 : 0);
      case 'compute': return instCost(n) * (rt ? rt.live + rt.boot.length : (c.auto ? c.min : c.n));
      case 'deploy': {
        if (arch && arch.nodes.some((x) => x.type === 'nodes')) return 0; // платим за узлы кластера
        const pods = rt ? rt.pods.length : (c.hpa ? c.min : c.n);
        return pods * c.cpu * 80;
      }
      case 'nodes': return 70 + (rt ? rt.list.filter((x) => !x.gone).length : c.count) * NODE_CPU[c.size] * 30;
      case 'cache': return MEM_COST[c.mem] * (c.replica ? 2 : 1);
      case 'db': return 100 * SZ[c.size] * (1 + c.rep) * (c.mz ? 2 : 1) * (c.xr !== 'none' ? 2 : 1);
      case 'queue': return 15;
      case 'broker': return 60 + 5 * c.parts;
      case 'worker': return 30 * (rt ? rt.live + rt.boot.length : c.n);
      case 'storage': return 10 + (rt ? rt.rps * 0.004 : 0);
      case 'vpn': return 40 * c.tunnels;
      case 'wsgw': return 60 * SZ[c.size] * (rt ? rt.live : c.n);
      case 'monitor': return 40;
      case 'logs': return 15 + (rt ? rt.sysRps * LOG_COST[c.level] : 0);
      case 'tracing': return 20 + (rt ? rt.sysRps * 0.004 * c.sample : 0);
      case 'vault': return 30;
      case 'tests': return TEST_COST[c.suite];
      case 'saga': return 40;
      default: return 0;
    }
  };
  U.groupCost = function (arch, sc) {
    const over = sc && sc.grpCost != null ? sc.grpCost : K.grpCost;
    return U.groupsUsed(arch).reduce((s, g) => { const gc = U.groupCfg(arch, g); return s + over + gc.n * 40 * SZ[U.groupSize(arch, g)]; }, 0);
  };
  U.archCost = function (arch, sc) { return arch.nodes.reduce((s, n) => s + U.nodeCost(n, null, arch), 0) + U.groupCost(arch, sc); };

  // ---------- очередь к серверам (Erlang C) ----------
  function ewait(c, rho) {
    if (c < 1 || rho <= 0) return 0;
    c = Math.min(60, Math.max(1, Math.round(c)));
    rho = Math.min(rho, 0.995);
    const a = c * rho; let term = 1, sum = 1;
    for (let k = 1; k < c; k++) { term *= a / k; sum += term; }
    const pc = term * a / c / (1 - rho);
    return (pc / (sum + pc)) / (c * (1 - rho));
  }
  U.ewait = ewait;

  // ---------- сценарий ----------
  function lerpPts(pts, t) {
    if (!pts || !pts.length) return 1;
    if (t <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const [t0, v0] = pts[i - 1], [t1, v1] = pts[i]; return v0 + (v1 - v0) * (t - t0) / Math.max(1e-9, t1 - t0); }
    return pts[pts.length - 1][1];
  }
  U.lerpPts = lerpPts;
  function spikeMul(inc, t) {
    if (t < inc.at) return 1;
    const ramp = inc.ramp || 1, end = inc.at + (inc.dur || 1e9);
    if (t < inc.at + ramp) return 1 + (inc.mul - 1) * (t - inc.at) / ramp;
    if (t < end) return inc.mul;
    if (t < end + 3) return inc.mul + (1 - inc.mul) * (t - end) / 3;
    return 1;
  }
  U.trafficAt = function (sc, t, extra) {
    let r = sc.rps * lerpPts(sc.shape, t);
    for (const inc of (sc.incidents || []).concat(extra || [])) if (inc.type === 'spike') r *= spikeMul(inc, t);
    return r * (sc.churn || 1);
  };
  U.botsAt = function (sc, t, extra) {
    let b = 0;
    for (const inc of (sc.incidents || []).concat(extra || [])) if (inc.type === 'bots' && t >= inc.at && t < inc.at + (inc.dur || 1e9)) b += inc.rps * Math.min(1, (t - inc.at) / 3);
    return b;
  };
  U.incActive = (inc, t) => t >= inc.at && t < inc.at + (inc.dur || 1e9);

  return { K, SZ, SVC, NODE_CPU, WAF_BLOCK, WAF_FP, RL_BLOCK, RL_FP, TTL_F, MEM_COST, TEST_CATCH, TEST_COST, LOG_COST, clone, ewait, lerpPts, grpOf };
});
