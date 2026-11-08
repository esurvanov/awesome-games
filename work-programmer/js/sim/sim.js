'use strict';
// Движок «Аптайма»: симуляция потока.
// Трафик — это потоки (rps), разбитые на сегменты {класс, rps, задержка, стек вызовов}.
// Состояние каждого узла (загрузка, доля обслуженного, ожидание) считается по нагрузке прошлого тика,
// поэтому порядок обхода не важен и вызовы по цепочке сервисов (A → B → C и обратно) работают естественно.
L.def('sim/sim', () => {
  const U = L.use('core');
  const { K, SZ, SVC, NODE_CPU, WAF_BLOCK, WAF_FP, RL_BLOCK, RL_FP, TTL_F, MEM_COST, TEST_CATCH, TEST_COST, LOG_COST, clone, ewait, lerpPts, grpOf } = L.use('sim/model');
  // ---------- симуляция ----------
  class Sim {
    constructor(arch, sc) {
      this.sc = sc; this.t = 0; this.extra = []; this.events = []; this.rt = {}; this.grt = {};
      this.arch = { nodes: [], edges: [], groups: {} };
      this.flags = {}; this.carry = {}; this.mch = {};
      this.setArch(arch, true);
      this.S = {
        time: 0, att: 0, ok: 0, cost: 0, hist: new Float64Array(1201),
        bots: 0, botsOrigin: 0, botsBlocked: 0, fp: 0,
        fail: {}, maxUtil: {}, utilSum: {}, nodeTicks: 0,
        cacheReads: 0, cacheHits: 0, queueMaxAge: 0, lagMax: 0, staticComp: 0, compUnits: 0,
        connMax: 0, timeline: [], incLost: 0, incAtt: 0, pAll: {}, pAllW: 0, pSlow: {}, pSlowW: 0,
        inv: 0, hanging: 0, compensated: 0, lost: 0, missed: 0, delivered: 0, egress: 0, insecure: 0, breach: 0,
        deployCost: U.archCost(arch, sc),
      };
      this.S.sec1 = { att: 0, ok: 0, segs: [], cost: 0, n: 0, rps: 0 };
      this.nodeStats = {}; this.edgeRate = {};
    }

    setArch(arch, initial) {
      const old = this.rt; const rt = {};
      for (const n of arch.nodes) {
        const prev = old[n.id];
        if (n.type === 'compute' || n.type === 'worker' || n.type === 'wsgw') {
          if (prev) {
            const r = prev;
            if (!n.cfg.auto) {
              const want = n.cfg.n, have = r.live + r.boot.length;
              if (want > have) for (let i = have; i < want; i++) r.boot.push(this.t + (initial || this.sc.instantBoot ? 0 : this.bootTime(n)));
              else if (want < have) { r.boot = r.boot.slice(0, Math.max(0, want - r.live)); r.live = Math.min(r.live, want); }
            } else {
              const min = n.type === 'worker' ? n.cfg.n : n.cfg.min;
              if (r.live + r.boot.length < min) for (let i = r.live + r.boot.length; i < min; i++) r.boot.push(this.t + this.bootTime(n));
              if (r.live > n.cfg.max) r.live = n.cfg.max;
            }
            rt[n.id] = r;
          } else {
            const cnt = n.type === 'compute' && n.cfg.auto ? n.cfg.min : n.cfg.n;
            rt[n.id] = this.freshRt({ live: initial ? cnt : 0, boot: initial ? [] : Array.from({ length: cnt }, () => this.t + (this.sc.instantBoot ? 0 : this.bootTime(n))), restore: [], low: 0, conns: initial ? -1 : 0 });
          }
        } else if (n.type === 'deploy') {
          rt[n.id] = prev || this.freshRt({ pods: [], ver: 1 });
          if (!prev) { const cnt = n.cfg.hpa ? n.cfg.min : n.cfg.n; for (let i = 0; i < cnt; i++) rt[n.id].pods.push({ node: -1, ready: initial ? -1 : null, ver: 1 }); }
        } else if (n.type === 'nodes') {
          if (prev) {
            const r = prev; const alive = r.list.filter((x) => !x.gone);
            for (let i = alive.length; i < n.cfg.count; i++) r.list.push({ cpu: NODE_CPU[n.cfg.size], up: true, bootAt: this.t + K.nodeBoot });
            if (alive.length > n.cfg.count) alive.slice(n.cfg.count).forEach((x) => (x.gone = true));
            r.list.forEach((x) => { if (!x.gone) x.cpu = NODE_CPU[n.cfg.size]; });
            rt[n.id] = r;
          } else rt[n.id] = this.freshRt({ list: Array.from({ length: n.cfg.count }, () => ({ cpu: NODE_CPU[n.cfg.size], up: true, bootAt: 0 })), lastAdd: -99 });
        } else {
          rt[n.id] = prev || this.freshRt({ backlog: 0, failUntil: -1, wasDown: false, groups: {}, Lw: 0, Lr: 0, LwN: 0, LrN: 0 });
        }
      }
      const g0 = this.grt || {}; this.grt = {};
      for (const g of U.groupsUsed(arch)) this.grt[g] = g0[g] || { L: 0, Ln: 0, errUntil: -1, err: 0, downUntil: -1 };
      this.rt = rt;
      this.arch = clone(arch); if (!this.arch.groups) this.arch.groups = {};
      this.has = {};
      for (const n of this.arch.nodes) this.has[n.type] = (this.has[n.type] || 0) + 1;
      this.hasMon = !!this.has.monitor;
      this.byId = {}; this.arch.nodes.forEach((n) => (this.byId[n.id] = n));
      this.kids = {}; this.arch.nodes.forEach((n) => (this.kids[n.id] = []));
      this.arch.edges.forEach((e) => { if (this.kids[e[0]]) this.kids[e[0]].push(e); });
    }
    freshRt(o) { return Object.assign({ L: 0, Ln: 0, rps: 0, rpsN: 0, p: 0, fails: 0, inn: 0, hold: 0, holdAcc: 0, holdW: 0, unhealthySince: -1, latAcc: 0, latW: 0, lat: 0, errSrc: 0, retryR: 0, retryB: 1, retryRp: 0, retryBp: 1 }, o); }
    bootTime(n) { return n.cfg && n.cfg.kind === 'ctr' ? K.ctrBoot : K.vmBoot; }
    node(id) { return this.byId[id]; }
    allInc() { return (this.sc.incidents || []).concat(this.extra); }
    active(type, pred) { return this.allInc().find((i) => i.type === type && U.incActive(i, this.t) && (!pred || pred(i))); }
    detect() { return this.hasMon ? K.detectMon : K.detectBlind; }
    locDown(n) {
      if (!n) return false;
      const z = n.zone || 'A', r = n.region || 'R1', c = n.cloud || 'C1';
      return !!this.active('zone', (i) => i.zone === z) || !!this.active('region', (i) => i.region === r) || !!this.active('cloud', (i) => i.cloud === c);
    }
    priceMul() { let m = 1; for (const i of this.allInc()) if (i.type === 'price' && this.t >= i.at) m *= i.mul; return m; }
    anyIncident() { return this.allInc().some((i) => U.incActive(i, this.t) && i.type !== 'price'); }
    lateAt(a, b) { const inc = this.allInc().find((i) => i.type === 'addConsumer' && i.edge[0] === a && i.edge[1] === b); return inc ? inc.at : 0; }

    // ---------- аварии ----------
    fireIncidents() {
      const t = this.t;
      for (const inc of this.allInc()) {
        if (inc.type === 'certExpire' && !inc._warned && this.hasMon && t >= inc.at - 25) { inc._warned = true; this.events.push({ t, inc, seenAt: t, warn: true }); }
        if (inc._fired || t < inc.at) continue;
        inc._fired = true;
        this.events.push({ t, inc, seenAt: t + (inc.type === 'certExpire' ? 0 : this.detect()) });
        if (inc.type === 'crash') {
          const pools = this.arch.nodes.filter((n) => n.type === 'compute' && !this.locDown(n) && this.rt[n.id].live > 0).sort((a, b) => this.rt[b.id].live - this.rt[a.id].live);
          const tgt = pools[0];
          if (tgt) { const r = this.rt[tgt.id]; const k = Math.min(inc.k || 1, r.live); r.live -= k; inc._target = tgt.id; if (!tgt.cfg.auto) r.restore.push({ at: t + (inc.dur || 20), k }); }
        }
        if (inc.type === 'hang') {
          const tgt = this.node(inc.node) || this.arch.nodes.filter((n) => n.type === 'compute')[1] || this.arch.nodes.find((n) => n.type === 'compute');
          if (tgt) inc._target = tgt.id;
        }
        if (inc.type === 'wsRestart') for (const n of this.arch.nodes) if (n.type === 'wsgw') { const r = this.rt[n.id]; r.conns = n.cfg.drain ? r.conns * 0.97 : 0; }
        if (inc.type === 'rollout') for (const n of this.arch.nodes) if (n.type === 'deploy' && !n.cfg.batch && (!inc.node || inc.node === n.id)) this.startRollout(n);
        if (inc.type === 'nodeFail' || inc.type === 'drain') this.nodeIncident(inc);
        if (inc.type === 'migration') {
          // общая база: все группы, делящие таблицы, переключаются разом
          const src = this.node(inc.node); const gs = new Set([grpOf(src)]);
          let grew = true;
          while (grew) {
            grew = false;
            for (const e of this.arch.edges) if (U.eopt(e).k === 'db') {
              const ga = grpOf(this.node(e[0])), gb = grpOf(this.node(e[1]));
              if (gs.has(ga) !== gs.has(gb)) { gs.add(ga); gs.add(gb); grew = true; }
            }
          }
          const shared = this.arch.edges.some((e) => U.eopt(e).k === 'db' && (e[0] === inc.node || e[1] === inc.node));
          if (gs.size > 1 || shared) for (const g of gs) if (this.grt[g]) this.grt[g].downUntil = t + 8;
          inc._groups = [...gs];
        }
        if (inc.type === 'addConsumer') {
          const e = U.edge(this.arch, inc.edge[0], inc.edge[1]);
          const k = e ? (U.eopt(e).k || 'sync') : 'sync';
          if (e && k !== 'evt') { const g = grpOf(this.node(inc.edge[0])); if (this.grt[g]) { this.grt[g].errUntil = t + 8; this.grt[g].err = 0.4; } }
        }
        if (inc.type === 'leak' && !this.has.vault) this.breach(inc);
        if (inc.type === 'scan' && this.arch.nodes.some((n) => n.type === 'db' && n.cfg.pub)) this.breach(inc);
        if (inc.type === 'region' || inc.type === 'cloud') {
          // асинхронная репликация теряет последние записи
          for (const n of this.arch.nodes) if (n.type === 'db' && this.locDown(n) && n.cfg.xr === 'async') this.S.lost += (this.lastWrites || 0) * 1.5;
        }
      }
      for (const n of this.arch.nodes) if (n.type === 'compute') this.rt[n.id].hung = this.allInc().some((i) => i.type === 'hang' && i._target === n.id && U.incActive(i, t));
    }
    breach(inc) { this.S.breach++; inc._breach = true; this.breachUntil = this.t + 15; }

    // ---------- Kubernetes ----------
    cluster() { const n = this.arch.nodes.find((x) => x.type === 'nodes'); return n ? this.rt[n.id] : null; }
    startRollout(n) {
      const r = this.rt[n.id]; r.ver++;
      if (n.cfg.strategy === 'recreate') r.pods = r.pods.map(() => ({ node: -1, ready: null, ver: r.ver }));
      else { r.rolling = true; r.dropped = 0; }
    }
    podsOn(i) { return this.arch.nodes.filter((n) => n.type === 'deploy').reduce((a, n) => a + this.rt[n.id].pods.filter((p) => p.node === i).length, 0); }
    nodeIncident(inc) {
      const cl = this.cluster(); if (!cl) return;
      const live = cl.list.map((x, i) => i).filter((i) => cl.list[i].up && !cl.list[i].gone);
      live.sort((a, b) => this.podsOn(b) - this.podsOn(a));
      const i = live[0]; if (i == null) return;
      inc._node = i;
      if (inc.type === 'nodeFail') {
        cl.list[i].up = false; cl.list[i].backAt = this.t + (inc.dur || 30);
        for (const n of this.arch.nodes) if (n.type === 'deploy') this.rt[n.id].pods.forEach((p) => { if (p.node === i) { p.node = -1; p.ready = null; } });
      } else {
        inc._queue = cl.list.map((x, k) => k).filter((k) => cl.list[k].up && !cl.list[k].gone);
        inc._next = this.t;
      }
    }
    k8sTick() {
      const t = this.t, dt = K.dt;
      const cl = this.cluster();
      const deploys = this.arch.nodes.filter((n) => n.type === 'deploy');
      if (!deploys.length) return;
      if (cl) cl.list.forEach((x) => { if (!x.up && x.backAt && t >= x.backAt) { x.up = true; x.backAt = 0; } if (x.cordon && x.backAt && t >= x.backAt) { x.cordon = false; x.backAt = 0; } });
      // обновление узлов по очереди: каждый закрывается на 20 с, поды выселяются (с PDB — по одному)
      for (const inc of this.allInc()) if (inc.type === 'drain' && inc._queue && inc._queue.length && t >= inc._next && cl) {
        const i = inc._queue.shift(); inc._next = t + 4;
        cl.list[i].cordon = true; cl.list[i].backAt = t + 20;
        for (const n of deploys) {
          const r = this.rt[n.id];
          if (n.cfg.pdb) r.drainQ = (r.drainQ || []).concat(r.pods.filter((p) => p.node === i));
          else r.pods.forEach((p) => { if (p.node === i) { p.node = -1; p.ready = null; } });
        }
      }
      for (const n of deploys) {
        const r = this.rt[n.id]; const c = n.cfg;
        if (r.drainQ && r.drainQ.length && (!r.lastEvict || t - r.lastEvict >= K.podStart)) {
          const ready = r.pods.filter((p) => p.node >= 0 && p.ready != null && p.ready <= t).length;
          if (ready >= r.pods.length) { const p = r.drainQ.shift(); if (p.node >= 0) { p.node = -1; p.ready = null; } r.lastEvict = t; }
        }
        let want = c.n;
        if (c.hpa) {
          const cap = c.cpu * K.podCapPerCpu;
          want = Math.max(c.min, Math.min(c.max, Math.ceil(r.L / (cap * 0.6)) || c.min));
          const cur = r.pods.filter((p) => !p.surge).length;
          if (want < cur) { r.low = (r.low || 0) + dt; if (r.low < 15) want = cur; else r.low = 10; } else r.low = 0;
        }
        const base = r.pods.filter((p) => !p.surge);
        if (base.length < want) for (let i = base.length; i < want; i++) r.pods.push({ node: -1, ready: null, ver: r.ver });
        if (base.length > want && !r.rolling) r.pods.splice(want);
        if (r.rolling) {
          const old = r.pods.filter((p) => p.ver < r.ver);
          if (!old.length) { r.rolling = false; r.pods.forEach((p) => delete p.surge); }
          else {
            const surge = Math.max(1, Math.ceil(want * 0.25));
            const fresh = r.pods.filter((p) => p.ver === r.ver);
            const isReady = (p) => p.node >= 0 && p.ready != null && p.ready <= t;
            const inflight = fresh.filter((p) => !isReady(p)).length;
            if (inflight < surge && fresh.length < want) r.pods.push({ node: -1, ready: null, ver: r.ver, surge: true });
            // старый под уходит, когда новый готов (с проверкой готовности) или сразу (без неё)
            const ready = c.ready ? fresh.filter(isReady).length : fresh.filter((p) => p.node >= 0).length;
            if (ready - (r.dropped || 0) > 0) { r.pods.splice(r.pods.indexOf(old[0]), 1); r.dropped = (r.dropped || 0) + 1; }
          }
        }
      }
      if (cl) {
        const used = cl.list.map(() => 0);
        for (const n of deploys) for (const p of this.rt[n.id].pods) if (p.node >= 0) used[p.node] += n.cfg.cpu;
        let pending = 0;
        for (const n of deploys) {
          const r = this.rt[n.id];
          for (const p of r.pods) {
            if (p.node >= 0) continue;
            const ok = cl.list.map((x, i) => i).filter((i) => cl.list[i].up && !cl.list[i].gone && !cl.list[i].cordon && t >= cl.list[i].bootAt && cl.list[i].cpu - used[i] >= n.cfg.cpu - 1e-9);
            if (!ok.length) { pending++; continue; }
            const mine = (i) => r.pods.filter((q) => q.node === i).length;
            ok.sort((a, b) => (n.cfg.spread ? (mine(a) - mine(b)) || (used[a] - used[b]) : (used[b] - used[a]) || a - b));
            p.node = ok[0]; used[ok[0]] += n.cfg.cpu; p.ready = p.ready === -1 ? -1 : t + K.podStart;
          }
        }
        const nn = this.arch.nodes.find((x) => x.type === 'nodes');
        if (pending && nn.cfg.ca && t - cl.lastAdd >= 10 && cl.list.filter((x) => !x.gone).length < 20) { cl.list.push({ cpu: NODE_CPU[nn.cfg.size], up: true, bootAt: t + K.nodeBoot }); cl.lastAdd = t; }
        this.pending = pending; cl.used = used;
      } else {
        for (const n of deploys) for (const p of this.rt[n.id].pods) if (p.node < 0) { p.node = 0; p.ready = p.ready === -1 ? -1 : t + K.podStart; }
      }
      this.throttle = {};
      if (cl && this.active('noisy')) {
        const batchNodes = new Set();
        for (const n of deploys) if (n.cfg.batch && !n.cfg.limit) this.rt[n.id].pods.forEach((p) => p.node >= 0 && batchNodes.add(p.node));
        for (const n of deploys) if (!n.cfg.batch) this.throttle[n.id] = this.rt[n.id].pods.map((p) => (batchNodes.has(p.node) ? 0.35 : 1));
      }
    }

    isDown(n) {
      if (SVC[n.type] || n.type === 'wsgw') return !(this.svc[n.id] && this.svc[n.id].alive);
      if (n.type === 'db') return this.locDown(n) && !n.cfg.mz && n.cfg.xr === 'none';
      return this.locDown(n);
    }

    scale() {
      const dt = K.dt;
      for (const n of this.arch.nodes) {
        if (n.type !== 'compute' && n.type !== 'worker' && n.type !== 'wsgw') continue;
        const r = this.rt[n.id];
        r.boot = r.boot.filter((at) => { if (at <= this.t) { r.live++; return false; } return true; });
        r.restore = r.restore.filter((x) => { if (x.at <= this.t) { r.live += x.k; return false; } return true; });
        if (!n.cfg.auto || this.locDown(n)) continue;
        let need, min; const max = n.cfg.max;
        if (n.type === 'compute') { min = n.cfg.min; need = Math.ceil(r.L / (K.compCap * SZ[n.cfg.size] * (n.cfg.tgt || 65) / 100)); }
        else { min = n.cfg.n; need = Math.ceil((r.L * 1.15 + (r.backlogQ || 0) / 25) / K.workerCap); }
        need = Math.max(min, Math.min(max, need || 0));
        const total = r.live + r.boot.length;
        if (need > total) for (let i = total; i < need; i++) r.boot.push(this.t + this.bootTime(n));
        if (need < r.live) { r.low += dt; if (r.low >= 15) { r.live = Math.max(need, r.live - 1); r.low = 11; } } else r.low = 0;
      }
    }

    mkState(L, cap, c, sq, extra) {
      const rho = cap > 0 ? L / cap : (L > 0 ? 99 : 0);
      const f = cap <= 0 ? 0 : rho <= K.rhoMax ? 1 : K.rhoMax / rho;
      const wait = cap <= 0 ? 0 : ewait(c, Math.min(rho, K.rhoMax)) * sq + (rho > K.rhoMax ? K.overWait : 0);
      return Object.assign({ alive: cap > 0, util: Math.min(rho, 9), f, wait, cap, c }, extra || {});
    }

    // ---------- состояние узлов на этот тик (по нагрузке прошлого) ----------
    svcState() {
      const t = this.t; const st = {};
      const debug = this.arch.nodes.some((n) => n.type === 'logs' && n.cfg.level === 'debug');
      const testsN = this.arch.nodes.find((n) => n.type === 'tests');
      const catchP = testsN ? TEST_CATCH[testsN.cfg.suite] : 0;
      const breachDown = this.breachUntil && t < this.breachUntil;
      const bug = (n) => {
        const inc = this.active('badDeploy', (i) => i.node === n.id);
        if (!inc) return 0;
        const r = this.rt[n.id];
        if (r.rolledBack && t >= r.rolledBack) return 0;
        let e = (inc.err || 0.5) * (1 - catchP);
        if (n.cfg.rollout === 'canary') { e *= 0.1; if (this.hasMon && t >= inc.at + 5) return 0; }
        return e;
      };
      for (const n of this.arch.nodes) {
        const r = this.rt[n.id];
        if (n.type === 'compute') {
          let alive = this.locDown(n) || breachDown ? 0 : r.live;
          let why = this.locDown(n) ? 'zone' : breachDown ? 'breach' : 'dead';
          const cfgInc = this.active('cfgChange');
          if (cfgInc && t < cfgInc.at + (n.cfg.conf === 'baked' ? 25 : 3)) { if (n.cfg.conf === 'baked') { alive = 0; why = 'rebuild'; } else alive = Math.ceil(alive / 2); }
          if (this.active('diskFull') && n.cfg.logsTo === 'file') { alive = 0; why = 'disk'; }
          if (r.restartUntil && t < r.restartUntil) alive = Math.floor(alive / 2);
          const cpu = alive * K.compCap * SZ[n.cfg.size];
          const thr = alive * K.threads * SZ[n.cfg.size] / (0.03 + Math.min(r.hold, n.cfg.timeout));
          st[n.id] = this.mkState(r.L * (debug ? 1.15 : 1), Math.min(cpu, thr), alive, K.compSq, { why, thrBound: thr < cpu, err: bug(n), hung: r.hung });
        } else if (n.type === 'deploy') {
          const thr = this.throttle && this.throttle[n.id];
          let serving = 0, notReady = 0, cap = 0;
          r.pods.forEach((p, i) => {
            if (p.node < 0) return;
            const ok = p.ready != null && p.ready <= t;
            if (ok) { serving++; cap += n.cfg.cpu * K.podCapPerCpu * (thr ? thr[i] : 1); } else if (!n.cfg.ready) notReady++;
          });
          if (this.locDown(n) || breachDown) { serving = 0; cap = 0; notReady = 0; }
          const total = serving + notReady;
          const thrCap = serving * K.threads * n.cfg.cpu * 2 / (0.03 + Math.min(r.hold, n.cfg.timeout));
          st[n.id] = this.mkState(r.L * (debug ? 1.15 : 1), Math.min(cap, thrCap), Math.max(1, serving), K.compSq, { why: 'dead', err: bug(n), notReady: total ? notReady / total : 0, pods: r.pods.length, ready: serving, pending: r.pods.filter((p) => p.node < 0).length, thrBound: thrCap < cap });
          st[n.id].alive = total > 0;
        } else if (n.type === 'ext') {
          const slow = this.active('extSlow', (i) => !i.node || i.node === n.id);
          const cap = (n.cfg.cap || 1000) * (slow ? (slow.cap || 1) : 1);
          st[n.id] = this.mkState(r.L * (1 + r.retryRp * r.p * r.retryBp), cap, 1, 0, { lat: (n.cfg.lat || K.extLat) * (slow ? slow.lat : 1) });
          st[n.id].alive = cap > 0;
        } else if (n.type === 'vpn') {
          const tun = Math.max(0, n.cfg.tunnels - (this.active('vpnDown') ? 1 : 0));
          st[n.id] = this.mkState(r.L, tun * 1500, tun, 0);
        } else if (n.type === 'db') {
          st[n.id] = this.dbState(n);
        }
      }
      for (const g in this.grt) {
        const gr = this.grt[g]; const gc = U.groupCfg(this.arch, g);
        const members = this.arch.nodes.filter((n) => n.type === 'mod' && n.cfg.grp === g);
        const downInc = this.active('groupDown', (i) => members.some((m) => m.id === i.node));
        const down = gr.downUntil > t || !!downInc || members.some((m) => this.locDown(m)) || breachDown;
        const lock = members.length > 1 && members.some((m) => m.cfg.hot);
        const n = down ? 0 : gc.n;
        const cap = n * K.compCap * (lock ? 0.35 : 1);
        const heavy = this.active('heavy', (i) => members.some((m) => m.id === i.node));
        const err = gr.errUntil > t ? gr.err : 0;
        const s = this.mkState(gr.L, cap, lock ? 1 : n, K.compSq, { why: downInc ? 'crash' : gr.downUntil > t ? 'redeploy' : 'dead', err });
        s.heavy = heavy ? heavy.mul : 1; s.members = members.length; s.lock = lock;
        if (gc.bulkhead && members.length > 1) {
          s.mod = {};
          // каждому модулю — его обычная доля (по средней нагрузке без аварий) с запасом
          const tot = members.reduce((a, m) => a + (this.rt[m.id].Lavg || 0), 0) || 1;
          for (const m of members) {
            const share = Math.min(1, Math.max(0.08, ((this.rt[m.id].Lavg || 0) / tot) * 1.25));
            s.mod[m.id] = this.mkState(this.rt[m.id].L, cap * share, Math.max(1, Math.round(n * share)), K.compSq, { why: s.why, err, heavy: s.heavy });
          }
        }
        st['grp:' + g] = s;
      }
      for (const n of this.arch.nodes) if (n.type === 'mod') { const gs = st['grp:' + n.cfg.grp]; st[n.id] = gs && gs.mod ? gs.mod[n.id] : gs; }
      return st;
    }
    dbState(n) {
      const r = this.rt[n.id]; const t = this.t;
      let demand = 0;
      for (const m of this.arch.nodes) {
        let hold = 0;
        if (m.type === 'compute') hold = (this.locDown(m) ? 0 : this.rt[m.id].live) * m.cfg.pool;
        else if (m.type === 'deploy') hold = this.rt[m.id].pods.filter((p) => p.node >= 0).length * 10;
        if (!hold) continue;
        const reach = this.kids[m.id].some((e) => e[1] === n.id || (this.byId[e[1]] && this.byId[e[1]].type === 'cache' && this.kids[e[1]].some((e2) => e2[1] === n.id)));
        if (reach) demand += hold;
      }
      const maxC = K.dbConn * SZ[n.cfg.size] * (1 + n.cfg.rep);
      const ratio = demand / maxC; this.S && (this.S.connMax = Math.max(this.S.connMax, ratio));
      let capF = 1, connWait = 0, connFail = 0;
      if (ratio > 1) { capF = 1 / (1 + 0.6 * (ratio - 1)); connWait = 45 * (ratio - 1); connFail = Math.min(0.6, Math.max(0, (ratio - 1.6) * 0.35)); }
      const down = this.locDown(n);
      if (down && !r.wasDown) { r.wasDown = true; r.failUntil = t + (n.cfg.xr === 'async' ? 15 : n.cfg.xr === 'sync' ? 5 : 4); }
      if (!down) r.wasDown = false;
      const dead = down && !n.cfg.mz && n.cfg.xr === 'none';
      const failover = t < r.failUntil ? (n.cfg.xr !== 'none' ? 1 : 0.3) : 0;
      const nodes = 1 + n.cfg.rep; const capE = K.dbCap * SZ[n.cfg.size] * capF;
      const loadP = r.Lw + r.Lr / nodes, loadR = r.Lr / nodes;
      const rhoP = loadP / capE, rhoR = n.cfg.rep ? loadR / capE : 0;
      return {
        alive: !dead, dead, demand, maxC, connWait, connFail, failover, nodes,
        fP: rhoP <= K.rhoMax ? 1 : K.rhoMax / rhoP, fR: rhoR <= K.rhoMax ? 1 : K.rhoMax / rhoR,
        wP: ewait(1, Math.min(rhoP, K.rhoMax)) * K.dbSq + (rhoP > K.rhoMax ? K.overWait : 0),
        wR: ewait(1, Math.min(rhoR, K.rhoMax)) * K.dbSq + (rhoR > K.rhoMax ? K.overWait : 0),
        util: Math.max(rhoP, rhoR),
      };
    }

    // ---------- шаг ----------
    step() {
      const dt = K.dt, sc = this.sc, S = this.S;
      this.t += dt; const t = this.t;
      this.fireIncidents(); this.scale(); this.k8sTick();
      const st = this.svc = this.svcState();
      const ns = {}; this.arch.nodes.forEach((n) => (ns[n.id] = { in: 0, util: 0, served: 0, drop: 0 }));
      const ef = {}; const tick = { att: 0, ok: 0, segs: [] };
      const goalP95 = (sc.goals && sc.goals.p95) || 300;
      const self = this;
      const chIn = Object.assign({}, this.carry); this.carry = {};
      const W = [];
      let writes = 0; let egressN = 0;

      const finish = (seg, ok, reason) => {
        if (seg.r <= 0) return;
        let lat = seg.l; const parts = Object.assign({}, seg.p);
        if (seg.far && !seg.edge) { lat += sc.farMs || 0; parts.dist = (parts.dist || 0) + (sc.farMs || 0); }
        if (ok && seg.stk) for (const fr of seg.stk) if (fr.dl && lat > fr.dl) { ok = false; reason = 'timeout'; lat = fr.dl; break; }
        if (seg.stk) for (const fr of seg.stk) { const r = self.rt[fr.id]; if (!r) continue; const h = Math.min(lat, fr.dl || 1e9) - fr.l0; r.holdAcc += seg.r * Math.max(0, h); r.holdW += seg.r; }
        if (seg.c === 'bt') return;
        if (seg.res && !ok) { if (self.has.saga) S.compensated += seg.r * dt; else S.hanging += seg.r * dt; }
        if (ok) {
          tick.ok += seg.r; tick.segs.push([lat, seg.r]);
          S.hist[Math.min(1200, Math.round(lat / 5))] += seg.r * dt;
          S.pAllW += seg.r * dt; for (const k in parts) S.pAll[k] = (S.pAll[k] || 0) + seg.r * dt * parts[k];
          if (lat > goalP95) { S.pSlowW += seg.r * dt; for (const k in parts) S.pSlow[k] = (S.pSlow[k] || 0) + seg.r * dt * parts[k]; }
        } else {
          S.fail[reason] = (S.fail[reason] || 0) + seg.r * dt;
          if (seg.src && self.rt[seg.src]) self.rt[seg.src].errSrc += seg.r;
        }
      };
      const fork = (seg, r, addL, part, extra) => {
        const p = Object.assign({}, seg.p); if (part && addL) p[part] = (p[part] || 0) + addL;
        return Object.assign({}, seg, { r, l: seg.l + (addL || 0), p }, extra || {});
      };
      const send = (from, to, seg, addL, part) => {
        if (seg.r <= 1e-9) return;
        if ((seg.h || 0) > 60) { finish(seg, false, 'loop'); return; }
        ef[from + '>' + to] = (ef[from + '>' + to] || 0) + seg.r;
        W.push([to, fork(seg, seg.r, addL || 0, part || 'base', { h: (seg.h || 0) + 1 })]);
      };
      const cont = (seg) => {
        if (seg.k && seg.k.length) { const [nx, ...rest] = seg.k; send(nx.from, nx.to, Object.assign({}, seg, { k: rest, mul: nx.m || 1, inp: !!nx.inp }), nx.add, nx.part); }
        else finish(seg, true);
      };
      const fail = (seg, reason, src) => finish(src ? Object.assign({}, seg, { src }) : seg, false, reason);
      const locLat = (a, b) => ((a.region || 'R1') !== (b.region || 'R1') ? K.crossRegion : 0) + ((a.cloud || 'C1') !== (b.cloud || 'C1') ? K.crossCloud : 0);
      const kidsOf = (id) => this.kids[id].map((e) => [this.byId[e[1]], U.eopt(e)]).filter((x) => x[0]);

      // ---- вход ----
      const R = U.trafficAt(sc, t, this.extra), B = U.botsAt(sc, t, this.extra);
      const mix = sc.mix || { rd: 1 };
      const geo = sc.geo || { R1: 1 };
      const multiGeo = Object.keys(geo).length > 1;
      const users = this.arch.nodes.find((n) => n.type === 'users');
      for (const c of ['st', 'rd', 'wr']) {
        const r = R * (mix[c] || 0); if (!r) continue;
        tick.att += r;
        for (const g in geo) {
          const rg = r * geo[g]; if (!rg) continue;
          const far = sc.far || 0;
          const mk = (rr, isFar) => ({ c, r: rr, l: K.netBase, far: isFar, g, p: { base: K.netBase }, h: 0 });
          for (const s of (far > 0 ? [mk(rg * far, true), mk(rg * (1 - far), false)] : [mk(rg, false)])) if (s.r > 0) { if (users) W.push([users.id, s]); else fail(s, 'noEntry'); }
        }
      }
      if (B > 0) { S.bots += B * dt; if (users) W.push([users.id, { c: 'bt', r: B, l: K.netBase, p: {}, g: Object.keys(geo)[0], h: 0 }]); }

      const proc = {};
      proc.users = (n, seg) => {
        const ch = kidsOf(n.id).map((x) => x[0]).filter((c) => c.type !== 'wsgw' || false);
        const http = ch.filter((c) => c.type !== 'wsgw');
        if (!http.length) return fail(seg, 'noEntry');
        const up = http.filter((c) => !this.locDown(c));
        const tg = up.length ? up : http;
        tg.forEach((c) => send(n.id, c.id, fork(seg, seg.r / tg.length), multiGeo && (c.region || 'R1') !== seg.g ? K.farUser : 0, 'dist'));
      };
      proc.dns = (n, seg) => {
        ns[n.id].in += seg.r;
        const ch = kidsOf(n.id).map((x) => x[0]);
        if (!ch.length) return fail(seg, 'noTarget');
        const home = ch.filter((c) => (c.region || 'R1') === seg.g);
        const pick = home.length ? home : ch;
        const up = pick.filter((c) => !this.locDown(c));
        if (up.length) { up.forEach((c) => send(n.id, c.id, fork(seg, seg.r / up.length), home.length ? 0 : K.farUser, 'dist')); return; }
        const others = ch.filter((c) => !this.locDown(c));
        if (!n.cfg.failover || !others.length) return fail(seg, 'dns', n.id);
        const inc = this.allInc().filter((i) => (i.type === 'region' || i.type === 'cloud' || i.type === 'zone') && i._fired && U.incActive(i, t)).sort((a, b) => b.at - a.at)[0];
        const since = inc ? t - inc.at : 0;
        const ttl = n.cfg.ttl === 'short' ? 5 : 60;
        const moved = Math.max(0, Math.min(1, (since - K.dnsDetect) / ttl));
        if (moved < 1) fail(fork(seg, seg.r * (1 - moved)), 'dns', n.id);
        if (moved > 0) others.forEach((c) => send(n.id, c.id, fork(seg, seg.r * moved / others.length), K.farUser, 'dist'));
      };
      const routeEdge = (n, seg, add) => {
        const ch = kidsOf(n.id).map((x) => x[0]);
        const stor = ch.filter((c) => c.type === 'storage'), other = ch.filter((c) => c.type !== 'storage');
        let tg = seg.c === 'st' && stor.length ? stor : other;
        if (!tg.length) tg = seg.c === 'st' ? other : [];
        if (!tg.length) return fail(seg, ch.length ? 'noTarget' : 'noEntry');
        tg.forEach((c) => send(n.id, c.id, fork(seg, seg.r / tg.length), add));
      };
      proc.cdn = (n, seg) => {
        const hs = n.cfg.ttl === 'long' ? 0.98 : 0.75;
        const hr = n.cfg.api ? (sc.apiCache || 0) * (n.cfg.ttl === 'long' ? 0.93 : 0.45) : 0;
        const h = seg.c === 'st' ? hs : seg.c === 'rd' ? hr : 0;
        ns[n.id].in += seg.r; this.rt[n.id].rpsN += seg.r;
        if (h > 0) { finish(fork(seg, seg.r * h, K.cdnHit - K.netBase, 'base', { edge: true }), true); ns[n.id].served += seg.r * h; }
        if (h < 1) routeEdge(n, fork(seg, seg.r * (1 - h)), 5);
      };
      proc.waf = (n, seg) => {
        const bb = 1 - (1 - WAF_BLOCK[n.cfg.sens]) * (1 - RL_BLOCK[n.cfg.rl]);
        const fp = 1 - (1 - WAF_FP[n.cfg.sens]) * (1 - RL_FP[n.cfg.rl]);
        ns[n.id].in += seg.r;
        const blk = seg.c === 'bt' ? bb : fp;
        if (seg.c === 'bt') { S.botsBlocked += seg.r * blk * dt; ns[n.id].drop += seg.r * blk; }
        else if (blk > 0) { S.fp += seg.r * blk * dt; fail(fork(seg, seg.r * blk), 'fp', n.id); }
        routeEdge(n, fork(seg, seg.r * (1 - blk)), K.wafLat);
      };
      const certBad = (n) => n.cfg.tls === 'manual' && this.allInc().some((i) => i.type === 'certExpire' && t >= i.at) && !this.rt[n.id].renewed;
      proc.lb = proc.ingress = (n, seg) => {
        ns[n.id].in += seg.r; this.rt[n.id].rpsN += seg.r;
        if (certBad(n)) return fail(seg, 'cert', n.id);
        const ch = kidsOf(n.id).map((x) => x[0]);
        const stor = ch.filter((c) => c.type === 'storage'), comp = ch.filter((c) => c.type !== 'storage' && c.type !== 'wsgw');
        let tg = seg.c === 'st' && stor.length ? stor : comp;
        if (!tg.length) tg = stor;
        if (!tg.length) return fail(seg, 'noTarget');
        const checks = n.type === 'ingress' || n.cfg.checks;
        const hc = {};
        for (const c of comp) {
          const down = this.isDown(c) || (c.type === 'compute' && this.rt[c.id].hung);
          const r = this.rt[c.id];
          if (down) { if (r.unhealthySince < 0) r.unhealthySince = t; } else r.unhealthySince = -1;
          hc[c.id] = { down, excluded: down && checks && t - r.unhealthySince >= K.checkDelay };
        }
        if (tg !== stor) tg = tg.filter((c) => !hc[c.id].excluded);
        if (!tg.length) return fail(seg, 'zone');
        const share = sc.opShare && tg.every((c) => sc.opShare[c.id] != null) ? (c) => sc.opShare[c.id] / tg.reduce((a, x) => a + sc.opShare[x.id], 0) : () => 1 / tg.length;
        for (const c of tg) {
          const part = fork(seg, seg.r * share(c));
          if (c.type !== 'storage' && hc[c.id].down) { ef[n.id + '>' + c.id] = (ef[n.id + '>' + c.id] || 0) + part.r; fail(part, checks ? 'detect' : 'noChecks', c.id); }
          else send(n.id, c.id, part, K.lbLat);
        }
      };
      proc.storage = (n, seg) => { ns[n.id].in += seg.r; this.rt[n.id].rpsN += seg.r; ns[n.id].served += seg.r; cont(fork(seg, seg.r, K.storageLat, 'base')); };

      // ---- сервис: сервер, под, модуль ----
      proc.compute = proc.deploy = proc.mod = (n, seg) => {
        const s = st[n.id]; const r = this.rt[n.id];
        const kids = kidsOf(n.id);
        const hasQ = kids.some(([c]) => c.type === 'queue' || c.type === 'broker');
        const inline = !hasQ && (sc.sideMs || 0) > 0 && n.type !== 'mod';
        const heavy = n.type === 'mod' && this.active('heavy', (i) => i.node === n.id) ? this.active('heavy', (i) => i.node === n.id).mul : 1;
        const u = (n.type === 'mod' ? (n.cfg.w || 1) : seg.c === 'st' ? 4 : seg.c === 'wr' ? 1.5 + (inline ? 2 : 0) : 1) * heavy * (seg.mul || 1);
        ns[n.id].in += seg.r; r.rpsN += seg.r; r.inn += seg.r; r.Ln += seg.r * u;
        if (n.type === 'mod') this.grt[n.cfg.grp].Ln += seg.r * u;
        if (seg.c === 'bt') S.botsOrigin += seg.r * dt;
        if (n.type !== 'mod' && seg.c === 'st') S.staticComp += seg.r * 4 * dt;
        S.compUnits += seg.r * u * dt;
        if (!s || !s.alive || s.hung) { r.fails += seg.r; return fail(seg, s && s.hung ? 'hung' : (s && s.why) || 'dead', n.id); }
        let g0 = seg;
        if (s.err > 0) { fail(fork(g0, g0.r * s.err), 'bug', n.id); r.fails += g0.r * s.err; g0 = fork(g0, g0.r * (1 - s.err)); }
        if (s.notReady > 0) { fail(fork(g0, g0.r * s.notReady), 'notReady', n.id); r.fails += g0.r * s.notReady; g0 = fork(g0, g0.r * (1 - s.notReady)); }
        const sessOk = n.cfg.state === 'shared' && kids.some(([c]) => c.type === 'cache');
        if (n.type === 'compute' && !sessOk && sc.stateful && s.c > 1 && g0.c !== 'bt') {
          const lost = sc.stateful * (1 - 1 / s.c); fail(fork(g0, g0.r * lost), 'session', n.id); g0 = fork(g0, g0.r * (1 - lost));
        }
        if (s.f < 1) { const why = s.thrBound ? 'threads' : (r.boot && r.boot.length) || (s.pending > 0) ? 'scaleLag' : 'computeSat'; fail(fork(g0, g0.r * (1 - s.f)), why, n.id); r.fails += g0.r * (1 - s.f); }
        let g;
        if (seg.inp) { g = fork(g0, g0.r * s.f, 2, 'base'); r.latAcc += g.r * 2; r.latW += g.r; }
        else {
          g = fork(g0, g0.r * s.f, K.compBase, 'base');
          g = fork(g, g.r, s.wait, s.wait > 300 ? 'over' : 'cq');
          r.latAcc += g.r * (K.compBase + s.wait); r.latW += g.r;
        }
        if (n.type !== 'mod' && seg.c === 'st') return cont(fork(g, g.r, 10, 'base'));
        const frame = { id: n.id, l0: g.l, dl: n.cfg.timeout ? g.l + n.cfg.timeout * 1000 : 0 };
        const stk = (g.stk || []).concat([frame]);
        const plan = [];
        const cache = kids.find(([c]) => c.type === 'cache'); const db = kids.find(([c]) => c.type === 'db');
        const svcKids = kids.filter(([c]) => SVC[c.type] || c.type === 'ext' || c.type === 'vpn');
        if (seg.c === 'wr') {
          writes += g.r;
          for (const [c] of kids) if (c.type === 'queue' || c.type === 'broker') { chIn[c.id] = (chIn[c.id] || 0) + g.r; ef[n.id + '>' + c.id] = (ef[n.id + '>' + c.id] || 0) + g.r; }
          if (inline) g = fork(g, g.r, sc.sideMs, 'side');
          if (db) { plan.push({ from: n.id, to: db[0].id, add: locLat(n, db[0]), part: 'dist' }); if ((n.cloud || 'C1') !== (db[0].cloud || 'C1')) egressN += g.r; }
          else if (cache) plan.push({ from: n.id, to: cache[0].id, add: 0 });
          else if (sc.data && n.type !== 'mod' && !svcKids.length) return fail(Object.assign({}, g, { stk }), 'noDb', n.id);
        } else if (seg.c !== 'st') {
          if (cache) plan.push({ from: n.id, to: cache[0].id, add: locLat(n, cache[0]), part: 'dist' });
          else if (db) { const local = db[0].cfg.xr !== 'none'; plan.push({ from: n.id, to: db[0].id, add: local ? 0 : locLat(n, db[0]), part: 'dist' }); if (!local && (n.cloud || 'C1') !== (db[0].cloud || 'C1')) egressN += g.r; }
          else if (sc.data && n.type !== 'mod' && !svcKids.length && seg.c !== 'bt') return fail(Object.assign({}, g, { stk }), 'noDb', n.id);
        }
        let res = g.res; let evtOnce = false;
        for (const [c, o] of svcKids) {
          const k = o.k || 'sync';
          if (k === 'db') continue;
          if (o.on && o.on !== seg.c) continue;
          const late = this.lateAt(n.id, c.id); if (late && t < late) continue;
          if (o.need === 'inv' && (k !== 'sync' || grpOf(c) !== grpOf(n))) S.inv += g.r * (sc.conflict || 0.02) * dt;
          if (k === 'cmd' || k === 'evt') {
            if (o.need === 'reply') return fail(Object.assign({}, g, { stk }), 'needReply', n.id);
            const key = 'm:' + n.id + '>' + c.id;
            chIn[key] = (chIn[key] || 0) + g.r;
            ef[n.id + '>' + c.id] = (ef[n.id + '>' + c.id] || 0) + g.r;
            if (k === 'cmd' || !evtOnce) { r.Ln += g.r * 0.05; if (n.type === 'mod') this.grt[n.cfg.grp].Ln += g.r * 0.05; evtOnce = evtOnce || k === 'evt'; }
            continue;
          }
          if (n.type === 'mod' && c.type === 'mod' && grpOf(c) !== grpOf(n) && !o.acl && this.active('contract', (i) => i.node === c.id)) return fail(Object.assign({}, g, { stk }), 'contract', c.id);
          if (n.cfg.breaker && this.rt[c.id] && this.rt[c.id].p > 0.5) {
            if (cache) { ef[n.id + '>' + cache[0].id] = (ef[n.id + '>' + cache[0].id] || 0) + g.r; continue; }
            return fail(Object.assign({}, g, { stk }), 'breaker', c.id);
          }
          let m = o.n || 1;
          let add = K.hop * m;
          const inp = n.type === 'mod' && c.type === 'mod' && grpOf(c) === grpOf(n);
          if (inp) { add = K.inproc * m; m = 1; }
          if (o.acl) add += 2;
          add += locLat(n, c);
          if ((n.cloud || 'C1') !== (c.cloud || 'C1')) egressN += g.r * m;
          if (c.type === 'ext' && c.cfg.priv) S.insecure += g.r * dt;
          if (n.cfg.retries && this.rt[c.id]) { const cr = this.rt[c.id]; cr.retryR = Math.max(cr.retryR, n.cfg.retries); cr.retryB = Math.min(cr.retryB, n.cfg.backoff ? 0.3 : 1); }
          plan.push({ from: n.id, to: c.id, add, part: add > 20 ? 'dist' : 'hop', m, inp });
        }
        if (n.type === 'mod' && n.cfg.reserve) res = true;
        if (n.type === 'mod' && n.cfg.decline) {
          const d = n.cfg.decline;
          if (res) { if (this.has.saga) S.compensated += g.r * d * dt; else S.hanging += g.r * d * dt; }
          finish(fork(Object.assign({}, g, { stk }), g.r * d), true);
          g = fork(g, g.r * (1 - d));
        }
        cont(Object.assign({}, g, { stk, res, k: plan.concat(g.k || []) }));
      };
      proc.ext = (n, seg) => {
        const r = this.rt[n.id]; const s = st[n.id];
        ns[n.id].in += seg.r; r.rpsN += seg.r; r.inn += seg.r; r.Ln += seg.r;
        if (s.f < 1) { r.fails += seg.r * (1 - s.f); fail(fork(seg, seg.r * (1 - s.f)), 'extSat', n.id); }
        const g = fork(seg, seg.r * s.f, s.lat, 'ext');
        r.latAcc += g.r * s.lat; r.latW += g.r;
        cont(g);
      };
      proc.vpn = (n, seg) => {
        const r = this.rt[n.id]; const s = st[n.id];
        ns[n.id].in += seg.r; r.rpsN += seg.r; r.Ln += seg.r;
        if (!s.alive) { r.fails += seg.r; return fail(seg, 'vpn', n.id); }
        if (s.f < 1) fail(fork(seg, seg.r * (1 - s.f)), 'vpn', n.id);
        const ext = kidsOf(n.id).map((x) => x[0])[0];
        if (!ext) return fail(seg, 'noTarget');
        send(n.id, ext.id, fork(seg, seg.r * s.f), 5, 'hop');
      };
      proc.cache = (n, seg) => {
        const dead = (this.active('cacheLoss') || this.locDown(n)) && !n.cfg.replica;
        const down = kidsOf(n.id).map((x) => x[0]).find((c) => c.type === 'db' || c.type === 'ext');
        const h = dead ? 0 : (sc.repeat || 0) * Math.min(1, n.cfg.mem / (sc.ws || 1)) * TTL_F[n.cfg.ttl];
        ns[n.id].in += seg.r; this.rt[n.id].rpsN += seg.r; ns[n.id].dead = dead;
        if (seg.c === 'rd') {
          S.cacheReads += seg.r * dt; S.cacheHits += seg.r * h * dt;
          ns[n.id].hitR = (ns[n.id].hitR || 0) + seg.r * h; ns[n.id].rdR = (ns[n.id].rdR || 0) + seg.r;
          if (h > 0) cont(fork(seg, seg.r * h, 2, 'base'));
        }
        const miss = seg.c === 'rd' ? seg.r * (1 - h) : seg.r;
        if (miss <= 0) return;
        if (down) send(n.id, down.id, fork(seg, miss), 2); else fail(fork(seg, miss), 'noDb', n.id);
      };
      proc.db = (n, seg) => {
        const s = st[n.id]; const r = this.rt[n.id];
        ns[n.id].in += seg.r; r.rpsN += seg.r; r.inn += seg.r;
        if (s.dead) { r.fails += seg.r; return fail(seg, 'dbZone', n.id); }
        if (seg.c === 'wr') r.LwN += seg.r * 2; else r.LrN += seg.r;
        const syncXr = n.cfg.xr === 'sync' && seg.c === 'wr' ? K.crossRegion : 0;
        const parts = seg.c === 'wr' ? [[1, s.fP, s.wP + syncXr]] : [[1 / s.nodes, s.fP, s.wP], [(s.nodes - 1) / s.nodes, s.fR, s.wR]];
        const okF = (1 - s.connFail) * (1 - s.failover);
        for (const [share, f, w] of parts) {
          if (share <= 0) continue;
          const r0 = seg.r * share;
          if (f < 1) { fail(fork(seg, r0 * (1 - f)), 'dbSat', n.id); r.fails += r0 * (1 - f); }
          const okR = r0 * f;
          if (s.connFail > 0) fail(fork(seg, okR * s.connFail), 'dbConn', n.id);
          const fo = seg.c === 'wr' || n.cfg.xr === 'none' ? s.failover : 0;
          if (fo > 0) fail(fork(seg, okR * (1 - s.connFail) * fo), 'dbFailover', n.id);
          let g = fork(seg, okR * (1 - s.connFail) * (1 - fo), K.dbBase, 'base'); g = fork(g, g.r, w, 'dq'); if (s.connWait) g = fork(g, g.r, s.connWait, 'conn');
          r.latAcc += g.r * (K.dbBase + w + s.connWait); r.latW += g.r;
          cont(g);
        }
        ns[n.id].served += seg.r * okF;
        void okF;
      };
      const passThrough = (n, seg) => { ns[n.id].in += seg.r; cont(seg); };

      let guard = 0;
      while (W.length && guard++ < 300000) {
        const [id, seg] = W.pop(); const n = this.byId[id];
        if (!n) { fail(seg, 'noTarget'); continue; }
        (proc[n.type] || passThrough)(n, seg);
      }

      this.channels(chIn, ns, ef);
      this.wsTick(tick, ns, ef, st);

      // ---- итоги тика ----
      let sysRps = 0;
      for (const n of this.arch.nodes) {
        const r = this.rt[n.id];
        if (SVC[n.type]) sysRps += r.rpsN;
        r.L = n.type === 'db' ? r.LwN + r.LrN : r.Ln; r.Ln = 0; r.rps = r.rpsN; r.rpsN = 0;
        if (n.type === 'db') { r.Lw = r.LwN; r.Lr = r.LrN; r.LwN = 0; r.LrN = 0; }
        r.p = r.inn > 0 ? Math.min(1, r.fails / r.inn) : r.p * 0.5; r.fails = 0; r.inn = 0;
        r.hold = r.holdW > 0 ? 0.5 * r.hold + 0.5 * (r.holdAcc / r.holdW) / 1000 : r.hold * 0.5; r.holdAcc = 0; r.holdW = 0;
        if (r.latW > 0) r.lat = r.latAcc / r.latW; r.latAcc = 0; r.latW = 0;
        r.retryRp = r.retryR; r.retryBp = r.retryB; r.retryR = 0; r.retryB = 1;
        const x = ns[n.id] || (ns[n.id] = {});
        x.lat = r.lat; x.errSrc = r.errSrc; r.errSrc = 0; x.p = r.p;
        const s = st[n.id];
        if (s && SVC[n.type]) {
          x.util = s.util; x.dead = !s.alive || !!s.hung;
          x.live = n.type === 'deploy' ? s.ready : n.type === 'mod' ? (s.alive ? U.groupCfg(this.arch, n.cfg.grp).n : 0) : s.c;
          x.boot = n.type === 'compute' ? r.boot.length : n.type === 'deploy' ? Math.max(0, s.pods - s.ready - s.pending) : 0;
          x.pending = s.pending || 0; x.pods = s.pods;
          if (s.alive) this.trackUtil(n.id, s.util);
        }
        if (n.type === 'db' && s) { x.util = s.util; x.dead = s.dead; x.conn = s.demand; x.connMax = s.maxC; this.trackUtil(n.id, s.util); }
        if ((n.type === 'ext' || n.type === 'vpn') && s) { x.util = s.util; x.dead = !s.alive; }
        if (n.type === 'cache' && x.rdR) x.hit = x.hitR / x.rdR;
        if (n.type === 'cdn' && x.in) x.hit = x.served / x.in;
        if (n.type === 'lb' || n.type === 'ingress') x.cert = certBad(n);
      }
      for (const n of this.arch.nodes) if (n.type === 'logs' || n.type === 'tracing') this.rt[n.id].sysRps = sysRps;
      for (const g in this.grt) { const gr = this.grt[g]; gr.L = gr.Ln; gr.Ln = 0; }
      for (const n of this.arch.nodes) if (n.type === 'mod') { const r = this.rt[n.id]; if (!this.active('heavy', (i) => i.node === n.id)) r.Lavg = r.Lavg == null ? r.L : r.Lavg * 0.9 + r.L * 0.1; }
      this.lastWrites = writes;

      let cost = U.groupCost(this.arch, sc);
      for (const n of this.arch.nodes) cost += U.nodeCost(n, this.rt[n.id], this.arch);
      // трафик между облаками стоит денег
      const egress = egressN;
      cost += egress * 0.25; S.egress += egress * dt;
      cost *= this.priceMul();
      this.costNow = cost;
      S.cost += cost * dt; S.time += dt;
      S.att += tick.att * dt; S.ok += tick.ok * dt;
      if (this.anyIncident()) { S.incAtt += tick.att * dt; S.incLost += (tick.att - tick.ok) * dt; }
      S.nodeTicks++;
      for (const id in ns) S.utilSum[id] = (S.utilSum[id] || 0) + (ns[id].util || 0);
      this.nodeStats = ns; this.edgeRate = ef;
      this.tick = { att: tick.att, ok: tick.ok, av: tick.att ? tick.ok / tick.att : 1, p95: p95of(tick.segs), rps: R + (sc.sock ? sc.sock.users * (sc.sock.rate || 0.2) * lerpPts(sc.sock.shape, t) : 0), bots: B, cost };
      const sec = S.sec1; sec.att += tick.att; sec.ok += tick.ok; sec.segs.push(...tick.segs); sec.cost += cost; sec.n++; sec.rps += this.tick.rps;
      if (Math.abs(t - Math.round(t)) < 1e-6 && sec.n >= 2) {
        S.timeline.push({ t: Math.round(t), av: sec.att ? sec.ok / sec.att : 1, p95: p95of(sec.segs), cost: sec.cost / sec.n, rps: sec.rps / sec.n });
        S.sec1 = { att: 0, ok: 0, segs: [], cost: 0, n: 0, rps: 0 };
      }
    }

    // очереди (сообщение — одному обработчику), брокеры (каждой группе — всё), асинхронные связи модулей
    channels(chIn, ns, ef) {
      const S = this.S, dt = K.dt, sc = this.sc;
      for (const n of this.arch.nodes) {
        if (n.type !== 'queue' && n.type !== 'broker') continue;
        const r = this.rt[n.id]; const inRate = chIn[n.id] || 0;
        const ws = this.kids[n.id].map((e) => this.byId[e[1]]).filter((c) => c && c.type === 'worker');
        ns[n.id].in = inRate; r.rpsN += inRate;
        let maxAge = 0, util = 0;
        if (n.type === 'queue') {
          let drain = 0;
          ws.forEach((w) => {
            const wr = this.rt[w.id]; wr.Ln = inRate / ws.length; wr.backlogQ = r.backlog;
            const a = this.locDown(w) ? 0 : wr.live; drain += a * K.workerCap;
            Object.assign(ns[w.id], { live: a, boot: wr.boot.length, util: a ? Math.min(1, (inRate / ws.length) / (a * K.workerCap)) : (inRate ? 1 : 0) });
            ef[n.id + '>' + w.id] = Math.min(inRate / ws.length, a * K.workerCap);
          });
          r.backlog = Math.min(5e5, Math.max(0, r.backlog + (inRate - drain) * dt));
          maxAge = r.backlog <= 1 ? 0 : (drain > 0 ? r.backlog / drain : (r.age || 0) + dt);
          util = drain ? Math.min(1, inRate / drain) : (inRate ? 1 : 0);
          if (sc.fanout) { S.missed += inRate * (ws.length ? Math.max(0, sc.fanout - 1) / sc.fanout : 1) * dt; S.delivered += inRate * dt; }
        } else {
          const P = n.cfg.parts; const groups = r.groups || (r.groups = {});
          ws.forEach((w) => {
            const wr = this.rt[w.id]; const a = this.locDown(w) ? 0 : wr.live;
            const par = Math.min(a, P);
            let drain = par * K.workerCap;
            if (sc.skew && par > 0) drain = Math.min(drain, K.workerCap / Math.max(sc.skew, 1 / par));
            const gq = groups[w.id] || (groups[w.id] = { backlog: 0, age: 0 });
            gq.backlog = Math.min(5e5, Math.max(0, gq.backlog + (inRate - drain) * dt));
            gq.age = gq.backlog <= 1 ? 0 : (drain > 0 ? gq.backlog / drain : gq.age + dt);
            wr.Ln = inRate; wr.backlogQ = gq.backlog;
            maxAge = Math.max(maxAge, gq.age);
            Object.assign(ns[w.id], { live: a, boot: wr.boot.length, idle: Math.max(0, a - P), util: drain ? Math.min(1, inRate / drain) : (inRate ? 1 : 0), age: gq.age });
            util = Math.max(util, ns[w.id].util);
            ef[n.id + '>' + w.id] = Math.min(inRate, drain);
          });
          if (sc.fanout) { S.missed += inRate * Math.max(0, sc.fanout - ws.length) / sc.fanout * dt; S.delivered += inRate * dt; }
          r.backlog = Object.values(groups).reduce((a, g) => a + g.backlog, 0);
        }
        r.age = maxAge; Object.assign(ns[n.id], { age: maxAge, backlog: r.backlog, util });
        S.queueMaxAge = Math.max(S.queueMaxAge, maxAge); S.lagMax = Math.max(S.lagMax, maxAge);
      }
      for (const key in chIn) if (key.startsWith('m:')) this.mch[key] = this.mch[key] || { backlog: 0, age: 0 };
      for (const key in this.mch) {
        const [a, b] = key.slice(2).split('>'); const nb = this.byId[b]; const ch = this.mch[key];
        if (!nb || !this.byId[a]) { delete this.mch[key]; continue; }
        const inRate = chIn[key] || 0;
        const s = this.svc[b]; const w = nb.cfg.w || 1;
        const used = nb.type === 'mod' ? this.grt[nb.cfg.grp].Ln : this.rt[b].Ln;
        const free = s && s.alive ? Math.max(0, s.cap * 0.95 - used) / w : 0;
        const drain = Math.min(free, inRate + ch.backlog / dt);
        ch.backlog = Math.min(5e5, Math.max(0, ch.backlog + (inRate - drain) * dt));
        ch.age = ch.backlog <= 1 ? 0 : (drain > 0 ? ch.backlog / Math.max(drain, 1) : ch.age + dt);
        S.lagMax = Math.max(S.lagMax, ch.age);
        if (nb.type === 'mod') this.grt[nb.cfg.grp].Ln += drain * w;
        this.rt[b].Ln += drain * w;
        ns[b].in += drain; ns[b].async = (ns[b].async || 0) + drain; ns[b].chAge = Math.max(ns[b].chAge || 0, ch.age);
        if (nb.cfg.decline && sc.reserveBefore) { if (this.has.saga) S.compensated += drain * nb.cfg.decline * dt; else S.hanging += drain * nb.cfg.decline * dt; }
        if (drain > 0) for (const e of this.kids[b]) { const o = U.eopt(e); const c = this.byId[e[1]]; if (c && c.type === 'mod' && (o.k === 'cmd' || o.k === 'evt')) { const k2 = 'm:' + b + '>' + c.id; this.carry[k2] = (this.carry[k2] || 0) + drain * (nb.cfg.decline ? 1 - nb.cfg.decline : 1); ef[b + '>' + c.id] = (ef[b + '>' + c.id] || 0) + drain; } }
      }
    }

    // веб-сокеты: держим соединения, переподключаемся после рестарта, раздаём сообщения
    wsTick(tick, ns, ef, st) {
      const sc = this.sc; if (!sc.sock) return;
      const t = this.t, dt = K.dt, S = this.S;
      const gws = this.arch.nodes.filter((n) => n.type === 'wsgw');
      const C = sc.sock.users * lerpPts(sc.sock.shape, t);
      const rate = sc.sock.rate || 0.2;
      const att = C * rate;
      tick.att += att; S.ws = S.ws || { connSum: 0, wantSum: 0 };
      if (!gws.length) { S.fail.noEntry = (S.fail.noEntry || 0) + att * dt; return; }
      let okMsgs = 0;
      for (const n of gws) {
        const r = this.rt[n.id]; const want = C / gws.length;
        const a = this.locDown(n) ? 0 : r.live;
        const limit = a * 10000 * SZ[n.cfg.size];
        const cpu = a * K.compCap * SZ[n.cfg.size];
        if (r.conns < 0) r.conns = Math.min(want, limit);
        r.conns = Math.min(r.conns, limit);
        const msgLoad = r.conns * rate * 0.1;
        const deficit = Math.max(0, Math.min(want, limit) - r.conns);
        let attempts = deficit / (n.cfg.backoff ? 12 : 1);
        const hsCost = 1;
        const free = Math.max(0, cpu * 0.95 - msgLoad);
        if (!n.cfg.backoff && attempts * hsCost > free) attempts *= 3; // без паузы клиенты стучатся снова и снова
        // лавина: сервер тратит силы на рукопожатия, которые не успевают, — полезных всё меньше
        const goodput = attempts * hsCost > free ? Math.min(1, 2 * free / (attempts * hsCost)) : 1;
        const accepted = Math.min(attempts, free / hsCost * goodput);
        r.conns = Math.min(Math.min(want, limit), r.conns + accepted * dt);
        const s = this.mkState(msgLoad + attempts * hsCost, cpu, Math.max(1, a), K.compSq);
        st[n.id] = s; s.alive = a > 0;
        const backplane = this.kids[n.id].some((e) => this.byId[e[1]] && this.byId[e[1]].type === 'broker');
        const bc = sc.sock.bcast || 0;
        const deliver = a > 1 && !backplane ? 1 - bc * (1 - 1 / a) : 1;
        const sent = r.conns * rate;
        const ok = sent * s.f * deliver;
        okMsgs += ok;
        const lat = 20 + s.wait;
        tick.segs.push([lat, ok]); S.hist[Math.min(1200, Math.round(lat / 5))] += ok * dt;
        S.pAllW += ok * dt; S.pAll.base = (S.pAll.base || 0) + ok * dt * 20; S.pAll.cq = (S.pAll.cq || 0) + ok * dt * s.wait;
        const add = (k, v) => { if (v > 0) S.fail[k] = (S.fail[k] || 0) + v * dt; };
        add('disconnected', (want - r.conns) * rate); add('wsSat', sent * (1 - s.f)); add('backplane', sent * s.f * (1 - deliver));
        Object.assign(ns[n.id], { in: sent, util: s.util, live: a, conns: r.conns, want, dead: a === 0 });
        this.trackUtil(n.id, s.util);
        S.ws.connSum += r.conns * dt; S.ws.wantSum += want * dt;
        for (const e of this.kids[n.id]) { if (this.byId[e[1]] && this.byId[e[1]].type === 'broker') { ef[n.id + '>' + e[1]] = sent * bc; ns[e[1]].in += sent * bc; } }
        for (const m of this.arch.nodes) for (const e of this.kids[m.id]) if (e[1] === n.id) ef[m.id + '>' + n.id] = (ef[m.id + '>' + n.id] || 0) + sent;
      }
      tick.ok += okMsgs;
      const users = this.arch.nodes.find((x) => x.type === 'users');
      if (users) for (const e of this.kids[users.id]) { const c = this.byId[e[1]]; if (c && c.type !== 'wsgw' && !ef[users.id + '>' + c.id]) ef[users.id + '>' + c.id] = att; }
    }

    trackUtil(id, u) { this.S.maxUtil[id] = Math.max(this.S.maxUtil[id] || 0, u); }
    done() { return this.t >= (this.sc.dur || 120) - 1e-9; }

    secChecks() {
      const list = this.sc.sec || []; const a = this.arch; const res = {};
      for (const k of list) {
        if (k === 'vault') res[k] = a.nodes.some((n) => n.type === 'vault');
        if (k === 'dbPrivate') res[k] = a.nodes.filter((n) => n.type === 'db').every((n) => !n.cfg.pub);
        if (k === 'waf') res[k] = a.nodes.some((n) => n.type === 'waf' && n.cfg.sens !== 'off');
        if (k === 'tls') res[k] = a.nodes.filter((n) => n.type === 'lb' || n.type === 'ingress').every((n) => n.cfg.tls !== 'none');
        if (k === 'vpn') res[k] = !this.S.insecure;
      }
      return res;
    }

    result() {
      const S = this.S, sc = this.sc, g = sc.goals || {};
      const avail = S.att ? (S.ok / S.att) * 100 : 100;
      const p95 = histP95(S.hist);
      const cost = S.time ? S.cost / S.time : 0;
      const pass = { avail: avail >= g.avail - 1e-9, p95: p95 <= g.p95, cost: cost <= g.budget };
      if (g.queueAge) pass.queue = S.queueMaxAge <= g.queueAge && this.arch.nodes.some((n) => n.type === 'queue' || n.type === 'broker');
      if (g.lag != null) pass.lag = S.lagMax <= g.lag;
      if (g.inv != null) pass.inv = S.inv <= g.inv;
      if (g.hanging != null) pass.hanging = S.hanging <= g.hanging;
      if (g.lost != null) pass.lost = S.lost <= g.lost;
      if (g.missed != null) pass.missed = (S.delivered ? S.missed / S.delivered : 0) <= g.missed;
      const checks = this.secChecks(); const ck = Object.values(checks);
      const secFrac = ck.length ? ck.filter(Boolean).length / ck.length : 1;
      if (g.sec != null) pass.sec = secFrac >= g.sec && !S.breach;
      const rel = pass.avail ? 30 : Math.max(0, 30 * (1 - (g.avail - avail) / 5));
      const perf = pass.p95 ? 25 : Math.max(0, 25 * (1 - (p95 - g.p95) / g.p95));
      const cs = pass.cost ? 20 : Math.max(0, 20 * (1 - (cost - g.budget) / g.budget));
      let sec = 15 * secFrac;
      if (S.bots > 0) sec *= S.botsBlocked / S.bots;
      if (S.breach) sec = 0;
      const fpRate = S.att ? S.fp / S.att : 0;
      sec = Math.max(0, sec - 15 * Math.min(1, fpRate * 20));
      const obj = sc.objective ? this.evalObjective(sc.objective) : { ok: true, val: null };
      const relF = rel / 30;
      if (avail < g.avail - 5) obj.ok = false;
      const objPts = obj.ok ? 10 * relF : 0;
      const score = Math.round(rel + perf * relF + cs * relF + sec * relF + objPts);
      const allPass = Object.values(pass).every(Boolean);
      const cheap = cost <= g.budget * 0.8;
      const stars = allPass ? 1 + (obj.ok ? 1 : 0) + (obj.ok && cheap ? 1 : 0) : 0;
      return {
        avail, p95, cost, pass, allPass, stars, score, cheap,
        parts: { rel, perf: perf * relF, cost: cs * relF, sec: sec * relF, obj: objPts }, obj,
        bots: S.bots, botsBlocked: S.botsBlocked, fpRate,
        cacheHit: S.cacheReads ? S.cacheHits / S.cacheReads : null,
        queueMaxAge: S.queueMaxAge, lagMax: S.lagMax, inv: S.inv, hanging: S.hanging, compensated: S.compensated, lost: S.lost,
        missed: S.delivered ? S.missed / S.delivered : 0, egress: S.time ? S.egress / S.time : 0, secFrac, secChecks: checks, breach: S.breach,
        maxUtil: S.maxUtil, fail: S.fail, slow: S.pSlow, timeline: S.timeline, events: this.events,
        att: S.att, ok: S.ok, staticShare: S.compUnits ? S.staticComp / S.compUnits : 0,
        botsOriginShare: S.bots ? S.botsOrigin / S.bots : 0, connMax: S.connMax, hasMon: this.hasMon,
        path: avgParts(S.pAll, S.pAllW), pathSlow: S.pSlowW ? avgParts(S.pSlow, S.pSlowW) : null, slowShare: S.pAllW ? S.pSlowW / S.pAllW : 0,
        avgUtil: this.avgUtil(), arch: this.arch, incAvail: S.incAtt ? 100 * (1 - S.incLost / S.incAtt) : null,
        groups: U.groupsUsed(this.arch).length, flags: this.flags,
      };
    }
    avgUtil() { const out = {}; for (const id in this.S.utilSum) out[id] = this.S.utilSum[id] / Math.max(1, this.S.nodeTicks); return out; }
    evalObjective(o) {
      const S = this.S, a = this.arch;
      const has = (t) => a.nodes.some((n) => n.type === t);
      switch (o.type) {
        case 'maxUtil': { const v = Math.max(0, ...a.nodes.filter((n) => SVC[n.type] || n.type === 'db').map((n) => S.maxUtil[n.id] || 0)); return { ok: v <= o.v, val: v }; }
        case 'cacheHit': { const v = S.cacheReads ? S.cacheHits / S.cacheReads : 0; return { ok: v >= o.v, val: v }; }
        case 'queueAge': return { ok: S.queueMaxAge <= o.v && a.nodes.some((n) => n.type === 'queue' || n.type === 'broker'), val: S.queueMaxAge };
        case 'lag': return { ok: S.lagMax <= o.v, val: S.lagMax };
        case 'bots': { const v = S.bots ? S.botsBlocked / S.bots : 1; return { ok: v >= o.v, val: v }; }
        case 'monitor': return { ok: this.hasMon, val: this.hasMon ? 1 : 0 };
        case 'has': return { ok: has(o.node), val: has(o.node) ? 1 : 0 };
        case 'incAvail': { const v = S.incAtt ? 100 * (1 - S.incLost / S.incAtt) : 100; return { ok: v >= o.v, val: v }; }
        case 'noReplica': { const v = a.nodes.filter((n) => n.type === 'db').reduce((x, n) => x + n.cfg.rep, 0); return { ok: v === 0, val: v }; }
        case 'conn': return { ok: S.connMax <= 1, val: S.connMax };
        case 'maxGroups': { const v = U.groupsUsed(a).length; return { ok: v <= o.v, val: v }; }
        case 'noIdle': { const v = a.nodes.filter((n) => n.type === 'worker').reduce((x, w) => x + ((this.nodeStats[w.id] && this.nodeStats[w.id].idle) || 0), 0); return { ok: v === 0, val: v }; }
        case 'cfg': { const ns = a.nodes.filter((n) => n.type === o.node); const ok = ns.length > 0 && ns.every((n) => n.cfg[o.key] === o.val); return { ok, val: ok ? 1 : 0 }; }
        case 'flag': return { ok: !!this.flags[o.flag], val: this.flags[o.flag] ? 1 : 0 };
        case 'noShared': { const v = a.edges.filter((e) => U.eopt(e).k === 'db').length; return { ok: v === 0, val: v }; }
        case 'egress': { const v = S.time ? S.egress / S.time : 0; return { ok: v <= o.v, val: v }; }
        case 'lost': return { ok: S.lost <= (o.v || 0), val: S.lost };
        case 'sec': { const ck = Object.values(this.secChecks()); const v = ck.length ? ck.filter(Boolean).length / ck.length : 1; return { ok: v >= (o.v || 1) && !S.breach, val: v }; }
        default: return { ok: true, val: null };
      }
    }
  }
  U.Sim = Sim;

  function avgParts(sum, w) { const o = {}; for (const k in sum) o[k] = w ? sum[k] / w : 0; return o; }
  function p95of(segs) {
    if (!segs.length) return 0;
    const a = segs.slice().sort((x, y) => x[0] - y[0]);
    const tot = a.reduce((s, x) => s + x[1], 0); let acc = 0;
    for (const [l, r] of a) { acc += r; if (acc >= tot * 0.95) return l; }
    return a[a.length - 1][0];
  }
  function histP95(h) {
    let tot = 0; for (let i = 0; i < h.length; i++) tot += h[i];
    if (!tot) return 0; let acc = 0;
    for (let i = 0; i < h.length; i++) { acc += h[i]; if (acc >= tot * 0.95) return i * 5; }
    return 6000;
  }
  U.histP95 = histP95;

  return { Sim, histP95 };
});
