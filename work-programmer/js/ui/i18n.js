'use strict';
// Язык, перевод и схема настроек блоков.
L.def('ui/i18n', () => {
  const U = L.use('core');
  L.use('content/text.ru');
  L.use('content/text.en');
  let lang = 'ru';
  try { lang = localStorage.getItem('uptime.lang') || ((navigator.language || 'ru').slice(0, 2) === 'ru' ? 'ru' : 'en'); } catch (e) { lang = 'ru'; }
  if (!U.TXT[lang]) lang = 'ru';
  U.lang = () => lang;
  U.setLang = (l) => { lang = U.TXT[l] ? l : 'ru'; try { localStorage.setItem('uptime.lang', lang); } catch (e) { /* ок */ } document.documentElement.lang = lang; };
  const T = () => U.TXT[lang] || U.TXT.ru;
  const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
  // t('ui.start'), t('comp.cdn.0'), с подстановкой {v}
  U.t = (path, vars) => {
    let o = T(); for (const k of path.split('.')) { if (o == null) break; o = o[k]; }
    if (o == null) { let r = U.TXT.ru; for (const k of path.split('.')) { if (r == null) break; r = r[k]; } o = r; }
    return o == null ? path : (typeof o === 'string' ? fill(o, vars) : o);
  };
  U.ui = (k, v) => U.t('ui.' + k, v);
  U.compName = (type) => U.t('comp.' + type)[0];
  U.compShort = (type) => U.t('comp.' + type)[1];
  U.compLike = (type) => U.t('comp.' + type)[2];
  U.compTrap = (type) => U.t('comp.' + type)[3];
  U.lvT = (lv) => {
    if (lv.id === 'daily') { const d = T().daily; return { title: d[lv.kind], story: fill(d.story, { v: lv.rps }), teach: d.teach }; }
    return (T().levels || {})[lv.id] || U.TXT.ru.levels[lv.id] || {};
  };
  U.incName = (i) => U.t('inc.' + i.type, { mul: i.mul, zone: i.zone, region: i.region ? U.t('opt.region.' + i.region) : '', cloud: i.cloud ? U.t('opt.cloud.' + i.cloud) : '', pct: i.mul ? Math.round((i.mul - 1) * 100) : '' });

  // ---------- схема настроек ----------
  const seg = (key, opts) => ({ key, kind: 'seg', opts });
  const step = (key, min, max) => ({ key, kind: 'step', min, max });
  const tog = (key) => ({ key, kind: 'tog' });
  const SIZE = seg('size', ['S', 'M', 'L']);
  U.CTL = {
    users: [], monitor: [], vault: [], saga: [], queue: [], storage: [], ext: [],
    dns: [tog('failover'), seg('ttl', ['short', 'long'])],
    cdn: [seg('ttl', ['short', 'long']), tog('api')],
    waf: [seg('sens', ['off', 'low', 'mid', 'high']), seg('rl', ['off', 'loose', 'strict'])],
    lb: [tog('checks'), seg('tls', ['none', 'manual', 'auto'])],
    ingress: [seg('tls', ['manual', 'auto'])],
    compute: [seg('kind', ['vm', 'ctr']), SIZE, step('n', 1, 30), tog('auto'), step('min', 1, 30), step('max', 1, 40), seg('tgt', [50, 65, 80]), seg('pool', [10, 20, 40]),
      seg('timeout', [1, 3, 10]), seg('retries', [0, 1, 3]), tog('backoff'), tog('breaker'), seg('state', ['local', 'shared']), seg('conf', ['baked', 'env']), seg('logsTo', ['file', 'stdout']), seg('rollout', ['all', 'canary'])],
    deploy: [seg('cpu', [0.25, 0.5, 1]), step('n', 1, 30), tog('hpa'), step('min', 1, 30), step('max', 1, 40), tog('ready'), seg('strategy', ['recreate', 'rolling']), tog('limit'), tog('spread'), tog('pdb'), seg('rollout', ['all', 'canary'])],
    mod: [],
    cache: [seg('mem', [1, 4, 16]), seg('ttl', ['s', 'm', 'h']), tog('replica')],
    db: [SIZE, step('rep', 0, 5), tog('mz'), tog('pub'), seg('xr', ['none', 'async', 'sync'])],
    broker: [step('parts', 1, 12)],
    worker: [step('n', 1, 30), tog('auto'), step('max', 1, 40)],
    vpn: [seg('tunnels', [1, 2])],
    wsgw: [step('n', 1, 12), SIZE, tog('backoff'), tog('drain')],
    logs: [seg('level', ['debug', 'info', 'error'])],
    tracing: [seg('sample', [1, 10, 100])],
    tests: [seg('suite', ['none', 'unit', 'int', 'full'])],
    nodes: [step('count', 1, 12), SIZE, tog('ca')],
  };
  // подпись варианта: из словаря или само значение
  U.optLabel = (key, v) => {
    const o = U.t('opt.' + key);
    if (o && typeof o === 'object' && o[v] != null) return o[v];
    if (key === 'cpu') return v + ' CPU';
    if (key === 'tgt') return v + '%';
    if (key === 'size' && false) return v;
    return String(v);
  };
  U.ctlLabel = (type, key) => {
    if (type === 'worker' && key === 'n') return U.t('ctl.workersN');
    if (type === 'worker' && key === 'auto') return U.t('ctl.autoWorkers');
    if (type === 'wsgw' && key === 'n') return U.t('ctl.wsN');
    if (type === 'nodes' && key === 'size') return U.t('ctl.cpuNode');
    if (type === 'dns' && key === 'ttl') return U.t('ctl.ttlDns');
    return U.t('ctl.' + key);
  };
  U.LETTERS = 'ABCDEFGHIJKL'.split('');
  return U;
});
