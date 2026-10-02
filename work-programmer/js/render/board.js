'use strict';
// Поле: потоки по трубам. Толщина трубы — объём, цвет — справляется ли получатель, пунктир — асинхронно.
// Блоки — баки: уровень заливки показывает загрузку. Модули одной группы обведены общей подложкой.
L.def('render/board', () => {
  const U = L.use('core');
  L.use('sim/model');
  L.use('ui/i18n');
  const NS = 'http://www.w3.org/2000/svg';
  const WX = 72, WY = 30;
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const HULL = ['#2e90fa', '#7a5af8', '#0e9384', '#f79009', '#ee46bc', '#16b364', '#6172f3', '#ef6820', '#06aed4', '#d444f1', '#875bf7', '#669f2a'];

  class Board {
    constructor(host, opts) {
      this.host = host; this.o = opts;
      this.arch = { nodes: [], edges: [], groups: {} };
      this.view = { x: 0, y: 0, k: 1 };
      this.sel = null; this.fog = [];
      this.svg = el('svg', { class: 'board' }, host);
      this.defs = el('defs', {}, this.svg);
      this.world = el('g', {}, this.svg);
      this.gHull = el('g', { class: 'hulls' }, this.world);
      this.gEdges = el('g', {}, this.world);
      this.gDots = el('g', { class: 'dots' }, this.world);
      this.gNodes = el('g', {}, this.world);
      this.tmp = el('path', { class: 'pipe tmp', d: '' }, this.world);
      this.nodeEls = {}; this.edgeEls = []; this.dots = []; this.phase = 0;
      this.ptrs = new Map();
      this.bind();
    }
    editable() { return this.o.canEdit(); }
    setArch(arch, keepView) { this.arch = arch; this.render(); if (!keepView) this.fit(); }
    node(id) { return this.arch.nodes.find((n) => n.id === id); }
    setFog(f) { this.fog = f || []; }
    fogged(kind) { const need = { metrics: 'monitor', logs: 'logs', traces: 'tracing' }[kind]; return this.fog.includes(kind) && !this.arch.nodes.some((n) => n.type === need); }

    // ---------- отрисовка ----------
    render() {
      this.gNodes.textContent = ''; this.gEdges.textContent = ''; this.defs.textContent = ''; this.nodeEls = {}; this.edgeEls = [];
      for (const e of this.arch.edges) {
        const o = U.eopt(e);
        const a = this.node(e[0]), b = this.node(e[1]);
        if (!a || !b) continue;
        const kind = this.edgeKind(a, b, o);
        const g = el('g', { class: 'eg idle k-' + kind, 'data-e': e[0] + '>' + e[1] }, this.gEdges);
        const hit = el('path', { class: 'ehit' }, g);
        const cas = el('path', { class: 'casing', 'stroke-width': 8 }, g);
        const p = el('path', { class: 'pipe', 'stroke-width': 3 }, g);
        const lab = el('text', { class: 'elab' }, g);
        g.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); this.select({ kind: 'edge', id: e[0] + '>' + e[1] }); });
        this.edgeEls.push({ e, g, p, cas, hit, lab, kind });
      }
      for (const n of this.arch.nodes) this.renderNode(n);
      this.layoutEdges(); this.renderHulls();
      this.applySel(); this.applyView();
    }
    edgeKind(a, b, o) {
      if (o.k === 'db') return 'db';
      if (o.k === 'cmd') return 'cmd';
      if (o.k === 'evt') return 'evt';
      if (b.type === 'queue' || a.type === 'queue') return 'cmd';
      if (b.type === 'broker' || a.type === 'broker') return 'evt';
      if (b.type === 'wsgw' || a.type === 'wsgw') return 'ws';
      return 'sync';
    }
    renderNode(n) {
      const grp = U.GROUP_OF[n.type] || 'x';
      const util = U.SVC[n.type] || ['db', 'queue', 'broker', 'worker', 'wsgw', 'ext', 'vpn'].includes(n.type);
      const g = el('g', { class: `node t-${n.type} g-${grp}${util ? '' : ' nou'}`, 'data-id': n.id }, this.gNodes);
      const ring = el('rect', { class: 'ring', x: -WX - 6, y: -WY - 6, width: WX * 2 + 12, height: WY * 2 + 12, rx: 18 }, g);
      const cid = 'clip-' + n.id.replace(/[^\w-]/g, '_');
      const cp = el('clipPath', { id: cid }, this.defs); el('rect', { x: -WX, y: -WY, width: WX * 2, height: WY * 2, rx: 14 }, cp);
      el('rect', { class: 'nb', x: -WX, y: -WY, width: WX * 2, height: WY * 2, rx: 14 }, g);
      const liq = el('rect', { class: 'liq', x: -WX, y: WY, width: WX * 2, height: 0, 'clip-path': `url(#${cid})` }, g);
      el('rect', { class: 'nbo', x: -WX, y: -WY, width: WX * 2, height: WY * 2, rx: 14 }, g);
      el('use', { href: '#c-' + n.type, x: -WX + 10, y: -11, width: 22, height: 22, class: 'ni' }, g);
      const label = el('text', { class: 'nl', x: -WX + 40, y: -2 }, g); label.textContent = U.compName(n.type);
      if (U.compName(n.type).length > 11) label.classList.add('long');
      const sub = el('text', { class: 'ns', x: -WX + 40, y: 14 }, g);
      const badge = el('g', { class: 'bd' }, g);
      const br = el('rect', { x: WX - 26, y: -WY - 10, width: 30, height: 20, rx: 10 }, badge);
      const bt = el('text', { x: WX - 11, y: -WY + 4 }, badge);
      const tag = el('text', { class: 'zt', x: -WX + 4, y: -WY - 7 }, g);
      const lat = el('g', { class: 'latb' }, g); el('rect', { x: -30, y: WY + 6, width: 60, height: 18, rx: 9 }, lat); const latT = el('text', { x: 0, y: WY + 19 }, lat);
      const err = el('g', { class: 'errb' }, g); el('circle', { cx: -WX + 2, cy: -WY + 2, r: 11 }, err); const errT = el('text', { x: -WX + 2, y: -WY + 6 }, err); errT.textContent = '!';
      const h = el('circle', { class: 'handle', cx: WX + 7, cy: 0, r: 8 }, g);
      lat.style.display = 'none'; err.style.display = 'none';
      // в уровнях с несколькими сервисами подписываем их собственными именами (cart, stock…)
      const named = !n.id.includes('_') && n.id !== n.type && ['mod', 'compute', 'deploy', 'ext', 'worker'].includes(n.type) && n.id.length <= 11;
      if (named) { label.textContent = n.id; label.classList.remove('long'); }
      this.nodeEls[n.id] = { g, liq, sub, badge, br, bt, tag, ring, h, lat, latT, err };
      this.placeNode(n); this.updateStatic(n);
      g.addEventListener('pointerdown', (ev) => this.onNodeDown(ev, n));
      h.addEventListener('pointerdown', (ev) => this.onHandleDown(ev, n));
    }
    placeNode(n) { this.nodeEls[n.id].g.setAttribute('transform', `translate(${n.x},${n.y})`); }
    updateStatic(n) {
      const r = this.nodeEls[n.id]; if (!r) return;
      const c = n.cfg; let b = '', sub = '';
      const loc = [];
      const show = (k) => this.o.showLoc && this.o.showLoc(k);
      if (show('zone') && U.ZONED[n.type]) loc.push(n.zone);
      if (show('region') && n.type !== 'users' && n.type !== 'dns') loc.push(U.optLabel('region', n.region));
      if (show('cloud') && n.type !== 'users' && n.type !== 'dns') loc.push(U.optLabel('cloud', n.cloud));
      r.tag.textContent = loc.join(' · ');
      const ru = U.lang() === 'ru';
      switch (n.type) {
        case 'compute': b = c.auto ? `${c.min}–${c.max}` : `×${c.n}`; sub = `${c.size}${c.kind === 'ctr' ? ' · ctr' : ''}`; break;
        case 'deploy': b = c.hpa ? `${c.min}–${c.max}` : `×${c.n}`; sub = `${c.cpu} CPU${c.batch ? ' · batch' : ''}`; break;
        case 'worker': b = c.auto ? `${c.n}–${c.max}` : `×${c.n}`; break;
        case 'wsgw': b = `×${c.n}`; sub = c.size; break;
        case 'nodes': b = `×${c.count}`; sub = `${U.NODE_CPU[c.size]} CPU`; break;
        case 'db': if (c.rep) b = `+${c.rep}`; sub = `${c.size}${c.mz ? ' · 2z' : ''}${c.xr !== 'none' ? ' · ⇄' : ''}${c.pub ? ' · 🌐' : ''}`; break;
        case 'cache': sub = `${c.mem} GB${c.replica ? ' · ×2' : ''}`; break;
        case 'broker': sub = `${c.parts} ${ru ? 'разд.' : 'parts'}`; break;
        case 'lb': sub = (c.checks ? '✓ ' : '✗ ') + 'TLS ' + U.optLabel('tls', c.tls); break;
        case 'ingress': sub = 'TLS ' + U.optLabel('tls', c.tls); break;
        case 'waf': sub = U.optLabel('sens', c.sens); break;
        case 'cdn': sub = U.optLabel('ttl', c.ttl); break;
        case 'vpn': b = `×${c.tunnels}`; break;
        case 'ext': sub = this.fog.includes('traces') ? '' : `${c.lat} ms`; break;
        case 'logs': sub = c.level; break;
        case 'tracing': sub = c.sample + '%'; break;
        case 'tests': sub = U.optLabel('suite', c.suite); break;
        case 'mod': { const gc = U.groupCfg(this.arch, c.grp); sub = `${c.grp} · ×${gc.n}${c.hot ? ' · 🔥' : ''}`; break; }
        default: break;
      }
      this.setBadge(r, b); r._staticSub = sub; r.sub.textContent = sub; r._sub = null;
    }
    setBadge(r, txt) {
      if (r._b === txt) return; r._b = txt;
      r.badge.style.display = txt ? '' : 'none'; r.bt.textContent = txt;
      const w = Math.max(22, txt.length * 7.5 + 12); r.br.setAttribute('width', w); r.br.setAttribute('x', WX - w + 4); r.bt.setAttribute('x', WX - w / 2 + 4);
    }
    edgePath(a, b) {
      const x1 = a.x + WX + 6, y1 = a.y, x2 = b.x - WX - 4, y2 = b.y;
      const dx = Math.max(40, Math.abs(x2 - x1) / 2);
      return [x1, y1, x1 + dx, y1, x2 - dx, y2, x2, y2];
    }
    layoutEdges() {
      for (const r of this.edgeEls) {
        const a = this.node(r.e[0]), b = this.node(r.e[1]); if (!a || !b) continue;
        const c = r.c = this.edgePath(a, b);
        const d = `M${c[0]},${c[1]} C${c[2]},${c[3]} ${c[4]},${c[5]} ${c[6]},${c[7]}`;
        r.p.setAttribute('d', d); r.cas.setAttribute('d', d); r.hit.setAttribute('d', d);
        const o = U.eopt(r.e);
        const [mx, my] = bez(c, 0.5);
        r.lab.setAttribute('x', mx); r.lab.setAttribute('y', my - 10);
        r.lab.textContent = [o.n > 1 ? '×' + o.n : '', o.acl ? 'ACL' : '', o.on === 'wr' ? '✎' : ''].filter(Boolean).join(' ');
      }
    }
    renderHulls() {
      this.gHull.textContent = '';
      const groups = U.groupsUsed(this.arch); if (!groups.length) return;
      const noun = this.o.groupNoun ? this.o.groupNoun() : '';
      groups.forEach((g) => {
        const ms = this.arch.nodes.filter((n) => n.type === 'mod' && n.cfg.grp === g);
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        ms.forEach((n) => { x0 = Math.min(x0, n.x - WX); y0 = Math.min(y0, n.y - WY); x1 = Math.max(x1, n.x + WX); y1 = Math.max(y1, n.y + WY); });
        const pad = 14; const col = HULL[U.LETTERS.indexOf(g) % HULL.length];
        el('rect', { class: 'hull', x: x0 - pad, y: y0 - pad - 16, width: x1 - x0 + pad * 2, height: y1 - y0 + pad * 2 + 16, rx: 20, style: `--hc:${col}` }, this.gHull);
        const gc = U.groupCfg(this.arch, g);
        const t = el('text', { class: 'hullt', x: x0 - pad + 12, y: y0 - pad + 1, style: `--hc:${col}` }, this.gHull); t.textContent = `${noun} ${g} · ×${gc.n}${gc.bulkhead ? ' · ▦' : ''}`;
      });
    }
    applyView() { const v = this.view; this.world.setAttribute('transform', `translate(${v.x},${v.y}) scale(${v.k})`); }
    fit() {
      const r = this.svg.getBoundingClientRect(); if (!r.width) return;
      const ns = this.arch.nodes; if (!ns.length) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      ns.forEach((n) => { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); });
      const pad = 130; const w = x1 - x0 + pad * 2, h = y1 - y0 + pad * 2;
      const k = Math.max(0.4, Math.min(1, r.width / Math.max(w, 520), r.height / Math.max(h, 360)));
      this.view = { k, x: r.width / 2 - ((x0 + x1) / 2) * k, y: r.height / 2 - ((y0 + y1) / 2) * k };
      this.applyView();
    }
    zoom(f, cx, cy) {
      const r = this.svg.getBoundingClientRect(); const v = this.view;
      cx = cx == null ? r.width / 2 : cx; cy = cy == null ? r.height / 2 : cy;
      const k = Math.max(0.3, Math.min(2.2, v.k * f));
      v.x = cx - (cx - v.x) * (k / v.k); v.y = cy - (cy - v.y) * (k / v.k); v.k = k; this.applyView();
    }
    toWorld(cx, cy) { const r = this.svg.getBoundingClientRect(); return { x: (cx - r.left - this.view.x) / this.view.k, y: (cy - r.top - this.view.y) / this.view.k }; }
    centerWorld() { const r = this.svg.getBoundingClientRect(); return this.toWorld(r.left + r.width / 2, r.top + r.height / 2); }

    select(s) { this.sel = s; this.applySel(); this.o.onSelect(s); }
    applySel() {
      for (const id in this.nodeEls) this.nodeEls[id].g.classList.toggle('sel', !!this.sel && this.sel.kind === 'node' && this.sel.id === id);
      for (const r of this.edgeEls) r.g.classList.toggle('sel', !!this.sel && this.sel.kind === 'edge' && this.sel.id === r.e[0] + '>' + r.e[1]);
      this.svg.classList.toggle('editable', this.editable());
    }

    // ---------- живые данные ----------
    live(sim, dtReal) {
      const ns = sim ? sim.nodeStats : {}; const ef = sim ? sim.edgeRate : {};
      const fogM = this.fogged('metrics'), fogT = this.fogged('traces'), fogL = this.fogged('logs');
      for (const n of this.arch.nodes) {
        const r = this.nodeEls[n.id]; if (!r) continue;
        const s = ns[n.id];
        let u = s ? s.util || 0 : 0;
        if (n.type === 'cache' && s && s.hit != null) u = s.dead ? 1 : 0;
        const show = sim && !fogM;
        const h = show ? Math.min(1, u) * WY * 2 : 0;
        r.liq.setAttribute('y', WY - h); r.liq.setAttribute('height', h);
        const st = !s || !sim ? '' : fogM ? 'fog' : (s.dead || s.cert) ? 'down' : u > 0.95 ? 'hot' : u > 0.75 ? 'warm' : s.in > 0 ? 'ok' : '';
        if (r._st !== st) { r.g.classList.remove('down', 'hot', 'warm', 'ok', 'fog'); if (st) r.g.classList.add(st); r._st = st; }
        if (sim && s) {
          if ((n.type === 'compute' || n.type === 'worker' || n.type === 'deploy') && !fogM) this.setBadge(r, `${s.live || 0}${s.boot ? '+' + s.boot : ''}${s.pending ? ' ⧗' + s.pending : ''}`);
          let sub = r._staticSub;
          if (fogM && (U.SVC[n.type] || n.type === 'db')) sub = '?';
          else if (n.type === 'cache') sub = s.dead ? '—' : `${Math.round((s.hit || 0) * 100)}% hit`;
          else if (n.type === 'cdn') sub = `${Math.round((s.hit || 0) * 100)}% edge`;
          else if (n.type === 'queue' || n.type === 'broker') sub = s.age > 0.5 ? `⏱ ${U.fmtAge(s.age)}` : r._staticSub;
          else if (n.type === 'db' && s.connMax && s.conn > s.connMax * 0.8) sub = `⇄ ${Math.round(s.conn)}/${s.connMax}`;
          else if (n.type === 'wsgw') sub = `${U.fmtNum(s.conns || 0)} / ${U.fmtNum(s.want || 0)}`;
          else if (U.SVC[n.type] || n.type === 'db' || n.type === 'worker') sub = `${Math.round(u * 100)}%` + (s.chAge > 1 ? ` · ⏱${U.fmtAge(s.chAge)}` : '');
          if (r._sub !== sub) { r.sub.textContent = sub; r._sub = sub; }
          // задержка узла: в уровнях про трейсинг видна только с трейсингом
          const traced = this.fog.includes('traces') ? !fogT : true;
          const showLat = traced && (n.type === 'ext' || (this.fog.includes('traces') && U.SVC[n.type]));
          const lt = showLat && s.lat ? '+' + Math.round(s.lat) + ' ms' : '';
          r.lat.style.display = lt ? '' : 'none'; if (lt && r.latT.textContent !== lt) r.latT.textContent = lt;
          r.err.style.display = this.fog.includes('logs') && !fogL && s.errSrc > 0.5 ? '' : 'none';
        } else { r.lat.style.display = 'none'; r.err.style.display = 'none'; }
      }
      for (const r of this.edgeEls) {
        if (!r.c) continue;
        const rate = sim ? (ef[r.e[0] + '>' + r.e[1]] || 0) : 0;
        const tgt = ns[r.e[1]];
        const w = !sim ? 3 : rate > 0.5 ? Math.min(16, 3 + 2.2 * Math.log2(1 + rate / 40)) : 2;
        const tu = tgt ? (tgt.util || 0) : 0;
        const st = !sim ? 'idle' : r.kind === 'db' ? 'shared' : rate <= 0.5 ? 'idle' : fogM ? 'ok' : (tgt && (tgt.dead || tgt.cert)) ? 'hot' : tu > 0.95 ? 'hot' : tu > 0.75 ? 'warm' : 'ok';
        if (r._w !== w) { r.p.setAttribute('stroke-width', w); r.cas.setAttribute('stroke-width', w + 5); r._w = w; }
        if (r._st !== st) { r.g.classList.remove('idle', 'ok', 'warm', 'hot', 'shared'); r.g.classList.add(st); r._st = st; }
        r.rate = rate; r.w = w; r.st = st; r.jam = st === 'hot';
      }
      this.animateDots(sim, dtReal);
    }
    clearLive() {
      for (const n of this.arch.nodes) { const r = this.nodeEls[n.id]; if (!r) continue; r.g.classList.remove('down', 'hot', 'warm', 'ok', 'fog'); r._st = ''; r.liq.setAttribute('height', 0); this.updateStatic(n); r.lat.style.display = 'none'; r.err.style.display = 'none'; }
      for (const r of this.edgeEls) { r.g.classList.remove('ok', 'warm', 'hot', 'shared'); r.g.classList.add('idle'); r._st = 'idle'; r.p.setAttribute('stroke-width', 3); r.cas.setAttribute('stroke-width', 8); r._w = 3; }
      this.gDots.textContent = ''; this.dots = [];
    }
    animateDots(sim, dtReal) {
      if (!sim) { if (this.dots.length) { this.gDots.textContent = ''; this.dots = []; } return; }
      this.phase += (dtReal || 0.016);
      let i = 0;
      for (const r of this.edgeEls) {
        if (!r.c || !(r.rate > 0.5) || r.kind === 'db') continue;
        const k = Math.min(10, Math.ceil(Math.log2(1 + r.rate / 25)));
        const speed = r.jam ? 0.18 : r.st === 'warm' ? 0.45 : 0.75;
        for (let j = 0; j < k; j++) {
          let d = this.dots[i];
          if (!d) d = this.dots[i] = el('circle', {}, this.gDots);
          let tt = ((this.phase * speed) + j / k + (r.e[0].length % 7) * 0.13) % 1;
          if (r.jam) tt = 0.55 + 0.42 * Math.pow(tt, 0.35); // затор: всё копится у входа получателя
          const [x, y] = bez(r.c, tt);
          d.setAttribute('cx', x.toFixed(1)); d.setAttribute('cy', y.toFixed(1));
          d.setAttribute('r', Math.max(1.6, r.w * (r.kind === 'evt' || r.kind === 'cmd' ? 0.42 : 0.3)).toFixed(1));
          const cls = 'dot k-' + r.kind + (r.jam ? ' jam' : '');
          if (d._c !== cls) { d.setAttribute('class', cls); d._c = cls; }
          d.style.display = '';
          i++;
        }
      }
      for (; i < this.dots.length; i++) this.dots[i].style.display = 'none';
    }

    // ---------- ввод ----------
    bind() {
      const svg = this.svg;
      svg.addEventListener('pointerdown', (ev) => {
        this.ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (this.ptrs.size === 2) { this.drag = { kind: 'pinch', d: pdist(this.ptrs), k: this.view.k }; return; }
        if (ev.target === svg) { if (this.pending) this.disarm(); this.select(null); this.drag = { kind: 'pan', x: ev.clientX, y: ev.clientY, vx: this.view.x, vy: this.view.y }; svg.setPointerCapture(ev.pointerId); }
      });
      const up = (ev) => {
        this.ptrs.delete(ev.pointerId);
        const d = this.drag; this.drag = null; if (!d) return;
        if (d.kind === 'node' && d.moved) { this.o.onChange('move'); this.renderHulls(); }
        if (d.kind === 'link') {
          const t0 = this.hitNode(ev.clientX, ev.clientY);
          if ((!t0 || t0.id === d.n.id) && Math.hypot(ev.clientX - d.cx, ev.clientY - d.cy) < 8) { this.tmp.setAttribute('d', ''); return; }
          this.disarm();
          const t = this.hitNode(ev.clientX, ev.clientY);
          if (t && t.id !== d.n.id) {
            if (U.canLink(this.arch, d.n.id, t.id)) { this.arch.edges.push([d.n.id, t.id]); this.render(); this.o.onChange('link'); }
            else this.o.onToast(linkWhy(this.arch, d.n, t));
          }
        }
      };
      svg.addEventListener('pointermove', (ev) => {
        if (this.ptrs.has(ev.pointerId)) this.ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        const d = this.drag; if (!d) return;
        if (ev.pointerType === 'mouse' && ev.buttons === 0 && d.kind !== 'pinch') { up(ev); return; }
        if (d.kind === 'pinch' && this.ptrs.size === 2) { const nd = pdist(this.ptrs); const f = (d.k * nd / d.d) / this.view.k; const c = pmid(this.ptrs), r = svg.getBoundingClientRect(); this.zoom(f, c.x - r.left, c.y - r.top); return; }
        if (d.kind === 'pan') { this.view.x = d.vx + ev.clientX - d.x; this.view.y = d.vy + ev.clientY - d.y; this.applyView(); }
        if (d.kind === 'node') {
          const p = this.toWorld(ev.clientX, ev.clientY);
          if (!d.moved && Math.hypot(ev.clientX - d.cx, ev.clientY - d.cy) < 4) return;
          d.moved = true; d.n.x = Math.round(p.x - d.ox); d.n.y = Math.round(p.y - d.oy); this.placeNode(d.n); this.layoutEdges();
          if (d.n.type === 'mod') this.renderHulls();
        }
        if (d.kind === 'link') {
          const p = this.toWorld(ev.clientX, ev.clientY);
          const c = this.edgePath(d.n, { x: p.x + WX + 4, y: p.y });
          this.tmp.setAttribute('d', `M${c[0]},${c[1]} C${c[2]},${c[3]} ${c[4]},${c[5]} ${p.x},${p.y}`);
          const t = this.hitNode(ev.clientX, ev.clientY);
          for (const id in this.nodeEls) this.nodeEls[id].g.classList.toggle('drop', !!t && t.id === id && U.canLink(this.arch, d.n.id, id));
        }
      });
      svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
      svg.addEventListener('wheel', (ev) => { ev.preventDefault(); const r = svg.getBoundingClientRect(); this.zoom(Math.exp(-ev.deltaY * 0.0015), ev.clientX - r.left, ev.clientY - r.top); }, { passive: false });
    }
    hitNode(cx, cy) { const p = this.toWorld(cx, cy); return this.arch.nodes.find((n) => Math.abs(n.x - p.x) <= WX + 8 && Math.abs(n.y - p.y) <= WY + 8); }
    onNodeDown(ev, n) {
      ev.stopPropagation();
      if (this.pending) { this.drag = null; this.tryPending(n); return; }
      this.ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      this.select({ kind: 'node', id: n.id });
      if (!this.editable()) return;
      const p = this.toWorld(ev.clientX, ev.clientY);
      this.drag = { kind: 'node', n, ox: p.x - n.x, oy: p.y - n.y, cx: ev.clientX, cy: ev.clientY };
      this.svg.setPointerCapture(ev.pointerId);
    }
    onHandleDown(ev, n) {
      ev.stopPropagation();
      if (!this.editable()) return;
      this.ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this.pending && this.pending.id === n.id) { this.disarm(); return; }
      if (this.pending) this.disarm();
      this.armLink(n);
      this.drag = { kind: 'link', n, cx: ev.clientX, cy: ev.clientY };
      this.svg.setPointerCapture(ev.pointerId);
    }
    armLink(n) {
      this.pending = n; this.svg.classList.add('linking');
      const r = this.nodeEls[n.id]; if (r) r.g.classList.add('src');
      for (const m of this.arch.nodes) { const e = this.nodeEls[m.id]; if (e) e.g.classList.toggle('drop', U.canLink(this.arch, n.id, m.id)); }
    }
    disarm() { this.pending = null; this.svg.classList.remove('linking'); this.tmp.setAttribute('d', ''); for (const id in this.nodeEls) this.nodeEls[id].g.classList.remove('src', 'drop'); }
    tryPending(n) {
      const a = this.pending; this.disarm();
      if (!a || a.id === n.id) return;
      if (U.canLink(this.arch, a.id, n.id)) { this.arch.edges.push([a.id, n.id]); this.render(); this.o.onChange('link'); }
      else this.o.onToast(linkWhy(this.arch, a, n));
    }
  }

  function linkWhy(arch, a, b) {
    if (!(U.LINKS[a.type] || []).includes(b.type)) {
      const ok = (U.LINKS[a.type] || []).map((t) => U.compName(t)).join(', ');
      return ok ? `${U.compName(a.type)} → ${ok}` : `${U.compName(a.type)} ✕`;
    }
    return '✕';
  }
  function bez(c, t) { const m = 1 - t; return [m * m * m * c[0] + 3 * m * m * t * c[2] + 3 * m * t * t * c[4] + t * t * t * c[6], m * m * m * c[1] + 3 * m * m * t * c[3] + 3 * m * t * t * c[5] + t * t * t * c[7]]; }
  function pdist(m) { const [a, b] = [...m.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; }
  function pmid(m) { const [a, b] = [...m.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  U.fmtNum = (r) => (r >= 1e6 ? (r / 1e6).toFixed(1) + 'M' : r >= 1e3 ? (r / 1e3).toFixed(1) + 'k' : String(Math.round(r)));
  U.fmtRps = (r) => U.fmtNum(r) + ' rps';
  U.fmtAge = (a) => (a >= 60 ? Math.round(a / 60) + (U.lang() === 'ru' ? ' мин' : ' min') : Math.round(a) + (U.lang() === 'ru' ? ' с' : ' s'));
  U.Board = Board;
  return { Board };
});
