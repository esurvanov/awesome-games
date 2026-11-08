'use strict';
// Экраны «Аптайма»: главная, группы уровней, брифинг, игра, итоги, выживание, песочница, справочник.
L.def('ui/app', () => {
  const U = L.use('core');
  L.use('ui/i18n');
  L.use('sim/run');
  L.use('content/levels');
  L.use('render/board');
  const app = document.getElementById('app');
  const ic = (id, cls) => `<svg class="ic ${cls || ''}" aria-hidden="true"><use href="#${id}"/></svg>`;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ui = U.ui;
  const money = (v) => '$' + (v >= 10000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v).toLocaleString(U.lang() === 'ru' ? 'ru-RU' : 'en-US'));
  const pct = (v, d = 1) => (v >= 99.995 ? '100' : v.toFixed(d)) + '%';
  const ms = (v) => Math.round(v) + (U.lang() === 'ru' ? ' мс' : ' ms');
  const RATE = { 1: 4, 2: 8, 4: 16 };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  // ---------- хранилище ----------
  const KEY = 'uptime.v2';
  let store = { lv: {}, surv: { best: 0 }, daily: {}, ach: {}, slots: [null, null, null], draft: {} };
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) store = Object.assign(store, s); } catch (e) { /* без сохранений */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* ок */ } };
  function unlock(id) {
    if (store.ach[id]) return; store.ach[id] = Date.now(); save();
    const a = U.t('ach.' + id); if (Array.isArray(a)) toast(ui('achGot', { v: a[0] }), 'i-trophy', 'gold');
  }
  const ACH = { first: 'i-play', hit90: 'i-cache', three: 'i-star', allch: 'i-trophy', tier5: 'i-grid', surv7: 'i-fire', surv30: 'i-fire', daily: 'i-dice', million: 'i-up', waste: 'i-coin' };

  function toast(text, icon, kind) {
    const box = document.getElementById('toasts');
    const t = document.createElement('div'); t.className = 'toast ' + (kind || '');
    t.innerHTML = `${icon ? ic(icon) : ''}<span>${esc(text)}</span>`;
    box.appendChild(t);
    setTimeout(() => t.classList.add('out'), 3200); setTimeout(() => t.remove(), 3700);
  }

  let game = null;
  function show(html, cls) { stopGame(); app.className = cls || ''; app.innerHTML = html; window.scrollTo(0, 0); }
  const passed = (l) => ((store.lv[l.id] || {}).stars || 0) > 0;
  const totalStars = () => U.LEVELS.reduce((a, l) => a + ((store.lv[l.id] || {}).stars || 0), 0);
  // первый уровень каждой группы открыт всегда, дальше — по порядку
  function unlocked(l) { const ls = U.LEVELS.filter((x) => x.tier === l.tier); const i = ls.indexOf(l); return i === 0 || passed(ls[i - 1]) || passed(l); }
  const nextLevel = () => U.LEVELS.find((l) => !passed(l) && unlocked(l)) || U.LEVELS[U.LEVELS.length - 1];
  const tierName = (id) => U.t('tiers.' + U.TIERS.find((t) => t.id === id).key)[0];
  const backBtn = () => `<button class="iconbtn back" aria-label="←">${ic('i-back')}</button>`;
  const bindBack = (fn) => { const b = app.querySelector('.back'); if (b) b.onclick = fn; };
  const langBtn = () => `<button class="lang">${ic('i-globe')} ${esc(ui('lang'))}</button>`;
  const bindLang = (redraw) => { const b = app.querySelector('.lang'); if (b) b.onclick = () => { U.setLang(U.lang() === 'ru' ? 'en' : 'ru'); document.title = ui('appName'); redraw(); }; };

  // ---------- главная ----------
  function heroFlow() {
    // маленькая живая схема: люди → сервер → база, по трубам бегут запросы
    return `<svg class="heroflow" viewBox="0 0 520 120" aria-hidden="true">
      <path class="hf-pipe" d="M110 60 C150 60 170 60 210 60"/><path class="hf-pipe hot" d="M330 60 C370 60 390 60 430 60"/>
      ${[0, 1, 2, 3].map((i) => `<circle class="hf-dot" r="4" cx="-60"><animateMotion dur="1.6s" begin="${i * 0.4}s" repeatCount="indefinite" path="M110 60 C150 60 170 60 210 60"/></circle>`).join('')}
      ${[0, 1, 2, 3, 4, 5].map((i) => `<circle class="hf-dot hot" r="4" cx="-60"><animateMotion dur="2.4s" begin="${i * 0.4}s" repeatCount="indefinite" keyPoints="0;0.85;0.95" keyTimes="0;0.5;1" calcMode="linear" path="M330 60 C370 60 390 60 430 60"/></circle>`).join('')}
      <g class="hf-node"><rect x="10" y="32" width="100" height="56" rx="14"/><use href="#c-users" x="26" y="48" width="24" height="24"/><text x="58" y="66">users</text></g>
      <g class="hf-node"><rect x="210" y="32" width="120" height="56" rx="14"/><rect class="hf-liq" x="211" y="50" width="118" height="37" rx="13"/><use href="#c-compute" x="226" y="48" width="24" height="24"/><text x="258" y="66">api</text></g>
      <g class="hf-node"><rect x="430" y="32" width="80" height="56" rx="14"/><use href="#c-db" x="446" y="48" width="24" height="24"/><text x="476" y="66">db</text></g>
    </svg>`;
  }
  function home() {
    const nx = nextLevel(); const first = !passed(U.LEVELS[0]);
    const st = totalStars(), max = U.LEVELS.length * 3;
    show(`
      <div class="page simple">
        <div class="topright">${langBtn()}</div>
        <div class="hero">
          <div class="mark">${ic('c-monitor')}</div>
          <h1>${esc(ui('appName'))}</h1>
          <p>${esc(ui('tagline'))}</p>
          ${heroFlow()}
          <button class="btn primary huge play">${ic('i-play')} ${esc(first ? ui('start') : ui('play'))}</button>
          <small>${first ? esc(ui('firstNote')) : `${esc(tierName(nx.tier))} · ${esc(U.lvT(nx).title)} · ${ic('i-star', 'st')} ${st}/${max}`}</small>
        </div>
        <div class="links"><button data-go="levels">${ic('i-map')} ${esc(ui('levels'))}</button><button data-go="more">${ic('i-grid')} ${esc(ui('more'))}</button></div>
      </div>`, 'scr-home');
    app.querySelector('.play').onclick = () => brief(nx);
    app.querySelector('[data-go=levels]').onclick = levels;
    app.querySelector('[data-go=more]').onclick = moreModal;
    bindLang(home);
  }
  function moreModal() {
    const ach = Object.keys(ACH).map((id) => { const a = U.t('ach.' + id); return `<span class="achip ${store.ach[id] ? 'on' : ''}" title="${esc(a[0] + ' — ' + a[1])}">${ic(ACH[id])}</span>`; }).join('');
    const m = modal(`
      <div class="bhead"><b>${esc(ui('more'))}</b><button class="iconbtn x">${ic('i-x')}</button></div>
      <div class="more">
        <button data-go="daily">${ic('i-dice')}<b>${esc(ui('daily'))}</b><small>${esc(ui('dailyNote'))}</small></button>
        <button data-go="survival">${ic('i-fire')}<b>${esc(ui('survival'))}</b><small>${esc(ui('survivalNote'))}</small></button>
        <button data-go="sandbox">${ic('i-flask')}<b>${esc(ui('sandbox'))}</b><small>${esc(ui('sandboxNote'))}</small></button>
        <button data-go="learn">${ic('i-book')}<b>${esc(ui('learn'))}</b><small>${esc(ui('learnNote'))}</small></button>
      </div>
      <div class="achrow"><small>${ic('i-trophy')} ${Object.keys(store.ach).length}/${Object.keys(ACH).length}</small>${ach}</div>`);
    m.querySelector('.x').onclick = closeModal;
    m.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => { closeModal(); ({ daily: openDaily, survival: survivalSetup, sandbox: () => startGame({ mode: 'sandbox' }), learn })[b.dataset.go](); });
  }

  // ---------- уровни по группам ----------
  function levels() {
    const html = U.TIERS.map((tr) => {
      const [name, desc] = U.t('tiers.' + tr.key);
      const ls = U.LEVELS.filter((l) => l.tier === tr.id);
      const got = ls.reduce((a, l) => a + ((store.lv[l.id] || {}).stars || 0), 0);
      return `<section class="tier t${tr.id}"><div class="th"><span class="dots">${[1, 2, 3, 4, 5].map((k) => `<i class="${k <= tr.dots ? 'on' : ''}"></i>`).join('')}</span><div><h3>${esc(name)}</h3><small>${esc(desc)}</small></div><span class="tst">${ic('i-star', 'st')} ${got}/${ls.length * 3}</span></div>
        <div class="lvgrid">${ls.map((l) => {
          const s = (store.lv[l.id] || {}).stars || 0; const open = unlocked(l); const tx = U.lvT(l);
          return `<button class="lv ${open ? '' : 'locked'} ${s ? 'done' : ''}" data-id="${l.id}" ${open ? '' : 'disabled'}>
            <span class="ln">${l.tutorial ? ic('i-book') : l.tierIdx}</span><b>${esc(tx.title)}</b>
            <span class="stars">${open ? [1, 2, 3].map((k) => ic('i-star', k <= s ? 'on' : '')).join('') : ic('i-lock')}</span><small>${esc(tx.teach)}</small></button>`;
        }).join('')}</div></section>`;
    }).join('');
    show(`<div class="page"><div class="head">${backBtn()}<h2>${esc(ui('levels'))}</h2>${langBtn()}</div>${html}</div>`, 'scr-levels');
    bindBack(home); bindLang(levels);
    app.querySelectorAll('.lv[data-id]').forEach((b) => b.onclick = () => brief(U.levelById(b.dataset.id)));
  }

  function modal(html, cls) {
    closeModal();
    const m = document.createElement('div'); m.className = 'modal ' + (cls || '');
    m.innerHTML = `<div class="sheet">${html}</div>`;
    document.body.appendChild(m);
    m.addEventListener('pointerdown', (e) => { if (e.target === m && !m.classList.contains('sticky')) closeModal(); });
    return m;
  }
  function closeModal() { document.querySelectorAll('.modal').forEach((m) => m.remove()); }

  // ---------- брифинг: история, одна строка цели, вопрос; ответ = старт ----------
  function goalLine(g) {
    const parts = [[ 'i-check', ui('goalAvail', { v: g.avail }) ], [ 'i-clock', ui('goalP95', { v: g.p95 }) ], [ 'i-coin', ui('goalBudget', { v: money(g.budget) }) ]];
    if (g.queueAge) parts.push(['i-queue', ui('goalQueue', { v: g.queueAge })]);
    if (g.lag != null) parts.push(['i-queue', ui('goalLag', { v: g.lag })]);
    if (g.inv != null) parts.push(['i-shield', ui('goalInv')]);
    if (g.hanging != null) parts.push(['i-link', ui('goalHang')]);
    if (g.sec != null) parts.push(['i-shield', ui('goalSec')]);
    if (g.missed != null) parts.push(['i-bars', ui('goalMissed')]);
    if (g.lost != null) parts.push(['i-db', ui('goalLost')]);
    return `<div class="goal1">${parts.map(([i, t]) => `<span>${ic(i)}${esc(t)}</span>`).join('')}</div>`;
  }
  function brief(lv, daily) {
    const tx = U.lvT(lv);
    const fresh = daily ? [] : U.newBlocks(lv);
    const incs = (lv.incidents || []).slice(0, 2);
    const pr = tx.predict;
    const start = (pred) => { closeModal(); startGame({ mode: daily ? 'daily' : 'level', lv, pred }); };
    const tag = daily ? ui('daily') : lv.tutorial ? ui('tutorial') : `${tierName(lv.tier)} · ${lv.tierIdx}`;
    const m = modal(`
      <div class="bhead"><small class="tag">${esc(tag)}</small><button class="iconbtn x">${ic('i-x')}</button></div>
      <h2>${esc(tx.title)}</h2>
      <p class="story">${esc(tx.story)}</p>
      ${goalLine(lv.goals)}
      ${incs.map((i) => `<div class="warn1">${ic(INC_IC[i.type] || 'i-warn')}<span>${esc(ui('soon', { at: i.at, name: U.incName(i) }))}</span></div>`).join('')}
      ${fresh.length ? `<div class="newb">${fresh.slice(0, 3).map((t) => `<div class="nbk g-${U.GROUP_OF[t]}">${ic('c-' + t)}<div><small>${esc(ui('newBlock'))}</small><b>${esc(U.compName(t))}</b><span>${esc(U.compShort(t))}</span></div></div>`).join('')}</div>` : ''}
      ${pr ? `<div class="predict"><p>${esc(pr[0])}</p><div class="popts">${pr[1].map((o, i) => `<button data-o="${i}">${esc(o)}</button>`).join('')}</div><small>${esc(ui('answerToStart'))}</small></div>`
        : `<div class="actions"><button class="btn primary huge go">${ic('i-play')} ${esc(ui('go'))}</button></div>`}`);
    m.querySelector('.x').onclick = closeModal;
    m.querySelectorAll('.popts button').forEach((b) => b.onclick = () => start(+b.dataset.o));
    const go = m.querySelector('.go'); if (go) go.onclick = () => start(null);
  }
  const INC_IC = { spike: 'i-up', crash: 'i-x', hang: 'i-pause', zone: 'i-zone', region: 'i-globe', cloud: 'i-globe', cacheLoss: 'i-cache', bots: 'i-bot', price: 'i-coin', extSlow: 'i-clock',
    vpnDown: 'i-link', certExpire: 'i-shield', badDeploy: 'i-warn', rollout: 'i-retry', nodeFail: 'i-x', drain: 'i-retry', noisy: 'i-cpu', wsRestart: 'i-retry', cfgChange: 'i-retry', diskFull: 'i-db',
    leak: 'i-shield', scan: 'i-eye', groupDown: 'i-x', contract: 'i-link', migration: 'i-db', addConsumer: 'i-plus', heavy: 'i-cpu' };

  // ---------- задача дня ----------
  function openDaily() { const sc = U.dailyScenario(today()); sc.tier = 0; brief(sc, true); }

  // ---------- выживание ----------
  const DIFF = { easy: { k: 'diffEasy', cash: 600, g: 0.05, dir: 0.6 }, norm: { k: 'diffNorm', cash: 400, g: 0.07, dir: 0.9 }, hard: { k: 'diffHard', cash: 250, g: 0.1, dir: 1.25 } };
  function survivalSetup() {
    const m = modal(`
      <div class="bhead"><small class="tag">${esc(ui('survival'))}</small><button class="iconbtn x">${ic('i-x')}</button></div>
      <h2>${esc(ui('survTitle'))}</h2>
      <div class="chain">
        <div>${ic('i-up')}<b>${esc(ui('survGrow'))}</b><small>${esc(ui('survGrowNote'))}</small></div><i>→</i>
        <div>${ic('i-coin')}<b>${esc(ui('survRev'))}</b><small>${esc(ui('survRevNote'))}</small></div><i>→</i>
        <div>${ic('i-fire')}<b>${esc(ui('survInc'))}</b><small>${esc(ui('survIncNote'))}</small></div><i>→</i>
        <div>${ic('i-x')}<b>${esc(ui('survEnd'))}</b><small>${esc(ui('survEndNote'))}</small></div>
      </div>
      <div class="diffs">${Object.entries(DIFF).map(([k, d]) => `<button class="diff" data-k="${k}"><b>${esc(ui(d.k))}</b><small>${money(d.cash)} · ${esc(ui('growthPerDay', { v: Math.round(d.g * 100) }))}</small></button>`).join('')}</div>`);
    m.querySelector('.x').onclick = closeModal;
    m.querySelectorAll('.diff').forEach((b) => b.onclick = () => { closeModal(); startGame({ mode: 'survival', diff: b.dataset.k }); });
  }
  const survivalScenario = () => ({ id: 'surv', rps: 300, shape: [[0, 1]], mix: { st: 0.2, rd: 0.6, wr: 0.2 }, data: true, repeat: 0.8, ws: 2, apiCache: 0.5, far: 0.2, farMs: 120, sideMs: 150,
    dur: Infinity, goals: { avail: 99, p95: 300 }, incidents: [], palette: U.SANDBOX_PALETTE.slice(), churn: 1 });
  const survivalArch = () => ({ nodes: [U.newNode('users', 90, 260, {}, 'A', 'users'), U.newNode('lb', 300, 260, {}, 'A', 'lb'), U.newNode('compute', 510, 200, { n: 3 }, 'A', 'app'), U.newNode('storage', 510, 360, {}, 'A', 'files'), U.newNode('db', 720, 200, {}, 'A', 'db')],
    edges: [['users', 'lb'], ['lb', 'app'], ['lb', 'files'], ['app', 'db']], groups: {} });

  // ---------- песочница ----------
  const PRESETS = {
    read: { mix: { rd: 0.9, wr: 0.1 }, repeat: 0.9, ws: 2, sideMs: 0, far: 0 },
    files: { mix: { st: 0.6, rd: 0.35, wr: 0.05 }, repeat: 0.8, ws: 2, sideMs: 0, far: 0 },
    write: { mix: { rd: 0.4, wr: 0.6 }, repeat: 0.5, ws: 2, sideMs: 300, far: 0 },
    personal: { mix: { rd: 0.85, wr: 0.15 }, repeat: 0.1, ws: 60, sideMs: 0, far: 0 },
    far: { mix: { st: 0.4, rd: 0.5, wr: 0.1 }, repeat: 0.8, ws: 2, sideMs: 0, far: 1, farMs: 170 },
  };
  const sandboxScenario = (p) => Object.assign({ id: 'sandbox', rps: 500, shape: [[0, 1]], data: true, apiCache: 0.7, farMs: 170, dur: Infinity, goals: { avail: 99, p95: 300 }, incidents: [], palette: U.SANDBOX_PALETTE.slice(), preset: p || 'read' }, U.clone(PRESETS[p || 'read']));

  // ---------- игра ----------
  function locsOf(sc, mode) {
    if (mode === 'sandbox' || mode === 'survival') return ['zone'];
    const inc = sc.incidents || []; const l = [];
    if (inc.some((i) => i.type === 'zone') || sc.id === 'zone' || sc.id === 'friday') l.push('zone');
    if (sc.geo) l.push('region');
    if (inc.some((i) => i.type === 'cloud')) l.push('cloud');
    return l;
  }
  function startGame(opt) {
    const mode = opt.mode; let sc, arch;
    if (mode === 'level' || mode === 'daily') { sc = opt.lv; const key = mode === 'daily' ? 'daily:' + today() : sc.id; arch = store.draft[key] ? U.clone(store.draft[key]) : U.startArch(sc); }
    else if (mode === 'survival') { sc = survivalScenario(); arch = survivalArch(); }
    else { sc = sandboxScenario(); arch = store.draft.sandbox ? U.clone(store.draft.sandbox) : { nodes: [U.newNode('users', 90, 260, {}, 'A', 'users')], edges: [], groups: {} }; }
    if (!arch.groups) arch.groups = {};
    const tx = mode === 'level' || mode === 'daily' ? U.lvT(sc) : {};
    const title = mode === 'survival' ? ui('survival') : mode === 'sandbox' ? ui('sandbox') : tx.title;
    const sub = mode === 'level' ? (sc.tutorial ? ui('tutorial') : `${tierName(sc.tier)} · ${sc.tierIdx}`) : mode === 'daily' ? ui('daily') : mode === 'survival' ? ui(DIFF[opt.diff].k) : '';
    show(`
      <div class="game">
        <div class="gbar">
          ${backBtn()}
          <div class="gtitle"><small>${esc(sub)}</small><b>${esc(title)}</b></div>
          <div class="hud"></div>
          <div class="ctl">
            <button class="iconbtn pp" title="${esc(ui('pause'))}">${ic('i-pause')}</button>
            <div class="speeds"><button data-s="1" class="on">1×</button><button data-s="2">2×</button><button data-s="4">4×</button></div>
            ${mode === 'sandbox' || mode === 'survival' ? `<button class="iconbtn stop">${ic('i-x')}</button>` : ''}
          </div>
          <div class="tl"><i class="tlp"></i><div class="tlm"></div></div>
        </div>
        <div class="gmain">
          <aside class="palette"></aside>
          <div class="stage">
            <div class="host"></div>
            <div class="zoom"><button class="iconbtn zi">${ic('i-plus')}</button><button class="iconbtn zo">${ic('i-minus')}</button><button class="iconbtn zf">${ic('i-fit')}</button></div>
            <div class="state"></div>
            <div class="hintbox" hidden></div>
            ${mode === 'sandbox' ? sandboxPanel() : ''}
            ${sc.loadTest ? `<button class="btn ltest">${ic('i-target')} ${esc(ui('loadTest'))}</button>` : ''}
            <button class="btn primary deploy">${ic('i-play')} ${esc(ui('launch'))}</button>
          </div>
          <aside class="insp" hidden></aside>
        </div>
      </div>`, 'scr-game');
    const root = app.querySelector('.game');
    game = { mode, sc, lv: opt.lv, arch, root, state: 'edit', speed: 1, acc: 0, last: performance.now(), sim: null, shown: new Set(), diff: opt.diff, pred: opt.pred, hintN: 0, flags: {},
      locs: locsOf(sc, mode), key: mode === 'daily' ? 'daily:' + today() : mode === 'level' ? sc.id : 'sandbox' };
    game.board = new U.Board(root.querySelector('.host'), {
      canEdit: () => game && game.state !== 'run',
      onSelect: (s) => inspector(s),
      onChange: () => { saveDraft(); inspectorRefresh(); hud(); },
      onToast: (t) => toast(t, 'i-link', 'warn'),
      showLoc: (k) => game && game.locs.includes(k),
      groupNoun: () => ui(sc.groupNoun === 'agg' ? 'groupAgg' : sc.groupNoun === 'ctx' ? 'groupCtx' : 'groupSvc'),
    });
    game.board.setFog(sc.fog);
    requestAnimationFrame(() => game && game.board.setArch(game.arch));
    buildPalette(); hud(); timelineMarks();
    bindBack(() => { if (mode === 'survival' && game.sim) { finishSurvival(ui('survQuit')); return; } mode === 'level' ? levels() : home(); });
    root.querySelector('.deploy').onclick = deploy;
    root.querySelector('.pp').onclick = togglePause;
    root.querySelectorAll('.speeds button').forEach((b) => b.onclick = () => { game.speed = +b.dataset.s; root.querySelectorAll('.speeds button').forEach((x) => x.classList.toggle('on', x === b)); });
    const stop = root.querySelector('.stop'); if (stop) stop.onclick = () => { if (mode === 'survival' && game.sim) finishSurvival(ui('survQuit')); else toEdit(); };
    root.querySelector('.zi').onclick = () => game.board.zoom(1.2);
    root.querySelector('.zo').onclick = () => game.board.zoom(1 / 1.2);
    root.querySelector('.zf').onclick = () => game.board.fit();
    const lt = root.querySelector('.ltest'); if (lt) lt.onclick = runLoadTest;
    if (mode === 'sandbox') bindSandbox();
    setStateUI();
    if (sc.tutorial) { game.arch = U.startArch(sc); requestAnimationFrame(() => game && game.board.setArch(game.arch)); coachStart(); }
    game.raf = requestAnimationFrame(frame);
  }
  function stopGame() { if (game) { cancelAnimationFrame(game.raf); if (game.coach) game.coach.el.remove(); game = null; } closeModal(); }
  function saveDraft() { if (!game) return; store.draft[game.key] = U.clone(game.arch); save(); }

  function runLoadTest() {
    if (game.state === 'run') return;
    toast(ui('loadTestNote'), 'i-target');
    setTimeout(() => { if (!game) return; const lim = U.loadTest(game.arch, game.sc); game.flags.loadtested = true; toast(ui('loadTestDone', { v: U.fmtRps(lim) }), 'i-target', 'gold'); }, 50);
  }

  function buildPalette() {
    const pal = game.root.querySelector('.palette');
    const allowed = game.sc.palette || U.SANDBOX_PALETTE;
    const items = U.ORDER.filter((t) => allowed.includes(t) && t !== 'mod');
    const lv = game.lv && U.lvT(game.lv);
    pal.innerHTML = items.map((t) => `<button class="pi g-${U.GROUP_OF[t]}" data-t="${t}" title="${esc(U.compShort(t))}">${ic('c-' + t)}<span>${esc(U.compName(t))}</span></button>`).join('')
      + (lv && lv.hints ? `<button class="hintbtn">${ic('i-bulb')}<span>${esc(ui('hint'))} <em>0/3</em></span></button>` : '');
    pal.querySelectorAll('.pi').forEach((b) => { b.addEventListener('pointerdown', (ev) => paletteDrag(ev, b.dataset.t)); b.addEventListener('click', () => paletteTap(b.dataset.t)); });
    const hb = pal.querySelector('.hintbtn'); if (hb) hb.onclick = nextHint;
  }
  function nextHint() {
    const hs = U.lvT(game.lv).hints; if (game.hintN < hs.length) game.hintN++;
    const box = game.root.querySelector('.hintbox');
    const lab = [ui('hintQ'), ui('hintDir'), ui('hintSol')];
    box.hidden = false;
    box.innerHTML = `<button class="iconbtn hx">${ic('i-x')}</button>` + hs.slice(0, game.hintN).map((h, i) => `<div class="hrow">${ic(i === 2 ? 'i-check' : i === 1 ? 'i-next' : 'i-bulb')}<div><small>${esc(lab[i])}</small><span>${esc(h)}</span></div></div>`).join('');
    box.querySelector('.hx').onclick = () => (box.hidden = true);
    const em = game.root.querySelector('.hintbtn em'); if (em) em.textContent = `${game.hintN}/3`;
  }
  // клик по блоку палитры ставит его всегда; перетаскивание — только если указатель сдвинулся
  function paletteTap(type) {
    if (game.dragged) { game.dragged = false; return; }
    if (game.state === 'run') { toast(ui('pauseToEdit'), 'i-pause', 'warn'); return; }
    const c = game.board.centerWorld(); addNode(type, c.x, c.y, true);
  }
  function paletteDrag(ev, type) {
    if (game.state === 'run' || ev.button > 0) return;
    const sx = ev.clientX, sy = ev.clientY; let ghost = null;
    const up = (e) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      if (!ghost) return;
      ghost.remove(); game.dragged = true; setTimeout(() => { if (game) game.dragged = false; }, 400);
      const r = game.root.querySelector('.stage').getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) { const p = game.board.toWorld(e.clientX, e.clientY); addNode(type, p.x, p.y); }
    };
    const move = (e) => {
      if (e.pointerType === 'mouse' && e.buttons === 0) { up(e); return; }
      if (!ghost && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) { ghost = document.createElement('div'); ghost.className = 'dragghost g-' + U.GROUP_OF[type]; ghost.innerHTML = ic('c-' + type); document.body.appendChild(ghost); }
      if (ghost) { ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px'; }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }
  function addNode(type, x, y, avoid) {
    if (avoid) {
      const ns = game.arch.nodes; x = Math.max(...ns.map((n) => n.x)) + 210; y = ns.length ? ns.reduce((a, n) => a + n.y, 0) / ns.length : y;
      let k = 0; while (ns.some((n) => Math.abs(n.x - x) < 150 && Math.abs(n.y - y) < 80) && k < 20) { y += 100; k++; }
    }
    const n = U.newNode(type, Math.round(x), Math.round(y), {}, 'A', type + '_' + Date.now().toString(36));
    game.arch.nodes.push(n);
    game.board.render(); if (avoid) game.board.fit();
    saveDraft(); hud();
  }

  // ---------- инспектор ----------
  function inspector(sel) {
    const box = game.root.querySelector('.insp');
    const was = !box.hidden;
    if (!sel) { box.hidden = true; box.innerHTML = ''; game.sel = null; refitIfHidden(); return; }
    game.sel = sel; box.hidden = false; inspectorRefresh(true);
    if (!was) refitIfHidden();
  }
  // панель справа сужает поле: если часть схемы ушла за край — подогнать вид
  function refitIfHidden() {
    requestAnimationFrame(() => {
      if (!game) return; const b = game.board; const r = b.svg.getBoundingClientRect();
      const out = b.arch.nodes.some((n) => { const x = n.x * b.view.k + b.view.x, y = n.y * b.view.k + b.view.y; return x < 40 || x > r.width - 40 || y < 30 || y > r.height - 30; });
      if (out) b.fit();
    });
  }
  const lvForCtl = () => (game.mode === 'level' ? game.lv : null);
  function visibleCtl(n, c) {
    if ((n.type === 'compute') && c.key === 'n') return !n.cfg.auto;
    if (n.type === 'compute' && ['min', 'max', 'tgt'].includes(c.key)) return n.cfg.auto;
    if (n.type === 'deploy' && c.key === 'n') return !n.cfg.hpa;
    if (n.type === 'deploy' && ['min', 'max'].includes(c.key)) return n.cfg.hpa;
    if (n.type === 'worker' && c.key === 'max') return n.cfg.auto;
    if (n.type === 'compute' && c.key === 'backoff') return n.cfg.retries > 0;
    return U.ctlOpen(n.type, c.key, lvForCtl());
  }
  function inspectorRefresh(full) {
    if (!game || !game.sel) return;
    const box = game.root.querySelector('.insp'); const sel = game.sel;
    const lock = game.state === 'run';
    if (sel.kind === 'edge') { edgeInspector(box, sel, lock); return; }
    const n = game.board.node(sel.id); if (!n) { inspector(null); return; }
    if (full || !box.querySelector('.ilive')) {
      const ctl = (U.CTL[n.type] || []).filter((c) => visibleCtl(n, c)).map((c) => ctlHtml(n, c, lock)).join('');
      const locs = game.locs.filter((k) => (k === 'zone' ? U.ZONED[n.type] : !['users', 'dns', 'monitor', 'logs', 'tracing', 'tests', 'vault', 'saga', 'nodes', 'mod'].includes(n.type)))
        .map((k) => ctlHtml(n, { key: k, kind: 'seg', opts: k === 'zone' ? ['A', 'B'] : k === 'region' ? ['R1', 'R2'] : ['C1', 'C2'], loc: true }, lock)).join('');
      const actions = nodeActions(n);
      box.innerHTML = `<div class="ih g-${U.GROUP_OF[n.type] || 'x'}">${ic('c-' + n.type)}<b>${esc(n.type === 'mod' ? n.id : U.compName(n.type))}</b><button class="iconbtn ix">${ic('i-x')}</button></div>
        <div class="ilike">${esc(n.type === 'mod' ? U.compShort('mod') : U.compShort(n.type))}</div>
        <div class="ilive"></div>
        ${n.type === 'mod' ? groupHtml(n, lock) : ''}
        <div class="ictl">${ctl}${locs}</div>
        ${actions}
        ${n.type === 'mod' ? '' : `<div class="icost">${ic('i-coin')}<span>${money(U.nodeCost(n, null, game.arch))}${esc(ui('perMonth'))}</span></div>`}
        ${U.compTrap(n.type) ? `<div class="itrap">${ic('i-warn')}<span>${esc(U.compTrap(n.type))}</span></div>` : ''}
        ${n.type !== 'users' && n.type !== 'mod' && !lock ? `<button class="btn danger del">${ic('i-trash')} ${esc(ui('remove'))}</button>` : ''}
        ${lock ? `<div class="ilock">${ic('i-pause')} ${esc(ui('pauseToEdit'))}</div>` : ''}`;
      box.querySelector('.ix').onclick = () => game.board.select(null);
      const del = box.querySelector('.del');
      if (del) del.onclick = () => { game.arch.nodes = game.arch.nodes.filter((x) => x.id !== n.id); game.arch.edges = game.arch.edges.filter((e) => e[0] !== n.id && e[1] !== n.id); game.board.render(); game.board.select(null); saveDraft(); hud(); };
      box.querySelectorAll('[data-k]').forEach((elx) => {
        const k = elx.dataset.k; const c = (U.CTL[n.type] || []).find((x) => x.key === k) || { key: k, kind: 'seg', loc: true };
        if (elx.dataset.kind === 'seg') elx.querySelectorAll('button').forEach((b) => b.onclick = () => setCfg(n, c, b.dataset.v, elx.dataset.loc));
        if (elx.dataset.kind === 'tog') elx.querySelector('button').onclick = () => setCfg(n, c, !n.cfg[k]);
        if (elx.dataset.kind === 'step') { elx.querySelector('.dec').onclick = () => setCfg(n, c, n.cfg[k] - 1); elx.querySelector('.inc').onclick = () => setCfg(n, c, n.cfg[k] + 1); }
      });
      bindGroup(box, n);
      box.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => doAction(n, b.dataset.act));
    }
    liveBox(n, box.querySelector('.ilive'));
  }
  function ctlHtml(n, c, lock) {
    const v = c.loc ? n[c.key] : n.cfg[c.key]; const dis = lock ? 'disabled' : '';
    const label = c.loc ? U.t('ctl.' + c.key) : U.ctlLabel(n.type, c.key);
    if (c.kind === 'seg') return `<div class="c" data-k="${c.key}" data-kind="seg" ${c.loc ? 'data-loc="1"' : ''}><label>${esc(label)}</label><div class="seg">${c.opts.map((o) => `<button data-v="${o}" class="${String(o) === String(v) ? 'on' : ''}" ${dis}>${esc(c.loc && c.key !== 'zone' ? U.optLabel(c.key, o) : U.optLabel(c.key, o))}</button>`).join('')}</div></div>`;
    if (c.kind === 'tog') return `<div class="c row" data-k="${c.key}" data-kind="tog"><label>${esc(label)}</label><button class="tog ${v ? 'on' : ''}" ${dis}><i></i></button></div>`;
    return `<div class="c row" data-k="${c.key}" data-kind="step"><label>${esc(label)}</label><div class="step"><button class="dec" ${dis}>${ic('i-minus')}</button><b>${v}</b><button class="inc" ${dis}>${ic('i-plus')}</button></div></div>`;
  }
  function setCfg(n, c, v, isLoc) {
    if (game.state === 'run') return;
    if (c.kind === 'seg' || isLoc) { const o = (c.opts || []).find((x) => String(x) === String(v)); v = o != null ? o : v; }
    if (c.kind === 'step') v = Math.max(c.min, Math.min(c.max, v));
    if (isLoc || c.loc) n[c.key] = v; else n.cfg[c.key] = v;
    if (n.type === 'compute' || n.type === 'deploy') { if (n.cfg.min > n.cfg.max) n.cfg.max = n.cfg.min; if ((c.key === 'auto' || c.key === 'hpa') && v) n.cfg.min = Math.max(1, Math.min(n.cfg.n, n.cfg.max)); }
    if (n.type === 'worker' && n.cfg.max < n.cfg.n) n.cfg.max = n.cfg.n;
    game.board.updateStatic(n); game.board.layoutEdges();
    inspectorRefresh(true); saveDraft(); hud();
  }
  // группы модулей: сервис / агрегат / контекст
  function groupHtml(n, lock) {
    const dis = lock ? 'disabled' : '';
    const gc = U.groupCfg(game.arch, n.cfg.grp);
    const showBulk = U.ctlOpen('mod', 'bulkhead', lvForCtl()) && (game.lv && ['modular', 'strangler', 'distmono', 'mshell', 'dddstrat', 'dddtact', 'cmdevt', 'saga'].includes(game.lv.id));
    const noun = game.board.o.groupNoun();
    return `<div class="grpbox">
      <div class="c"><label>${esc(noun)}</label><div class="seg letters">${U.LETTERS.map((L) => `<button data-g="${L}" class="${L === n.cfg.grp ? 'on' : ''}" ${dis}>${L}</button>`).join('')}</div></div>
      <div class="c row"><label>${esc(ui('instances'))}</label><div class="step"><button class="gdec" ${dis}>${ic('i-minus')}</button><b>${gc.n}</b><button class="ginc" ${dis}>${ic('i-plus')}</button></div></div>
      ${showBulk ? `<div class="c row"><label>${esc(ui('bulkhead'))}</label><button class="tog gbulk ${gc.bulkhead ? 'on' : ''}" ${dis}><i></i></button></div>` : ''}
      <small class="gsize">${esc(ui('size', { v: U.groupSize(game.arch, n.cfg.grp) }))}</small>
    </div>`;
  }
  function bindGroup(box, n) {
    const gb = box.querySelector('.grpbox'); if (!gb || game.state === 'run') return;
    const setG = (fn) => { const g = n.cfg.grp; game.arch.groups[g] = Object.assign(U.groupCfg(game.arch, g), game.arch.groups[g] || {}); fn(game.arch.groups[g]); refreshArch(); };
    gb.querySelectorAll('[data-g]').forEach((b) => b.onclick = () => {
      const to = b.dataset.g; if (!game.arch.groups[to]) game.arch.groups[to] = { n: U.groupCfg(game.arch, n.cfg.grp).n };
      n.cfg.grp = to; refreshArch();
    });
    gb.querySelector('.gdec').onclick = () => setG((g) => (g.n = Math.max(1, g.n - 1)));
    gb.querySelector('.ginc').onclick = () => setG((g) => (g.n = Math.min(16, g.n + 1)));
    const bk = gb.querySelector('.gbulk'); if (bk) bk.onclick = () => setG((g) => (g.bulkhead = !g.bulkhead));
  }
  function refreshArch() { game.arch.nodes.forEach((x) => game.board.updateStatic(x)); game.board.renderHulls(); inspectorRefresh(true); saveDraft(); hud(); }
  function nodeActions(n) {
    if (game.state !== 'pause' || !game.sim) return '';
    const incs = game.sim.allInc();
    const out = [];
    if ((n.type === 'compute' || n.type === 'deploy') && incs.some((i) => i.type === 'badDeploy')) out.push(['rollback', 'i-retry', ui('rollback')]);
    if ((n.type === 'lb' || n.type === 'ingress') && n.cfg.tls === 'manual' && incs.some((i) => i.type === 'certExpire') && !game.sim.rt[n.id].renewed) out.push(['renew', 'i-shield', ui('renew')]);
    return out.length ? `<div class="iact">${out.map(([a, i, t]) => `<button class="btn" data-act="${a}">${ic(i)} ${esc(t)}</button>`).join('')}</div>` : '';
  }
  function doAction(n, act) {
    const sim = game.sim; if (!sim) return; const r = sim.rt[n.id];
    if (act === 'rollback') {
      const bad = sim.allInc().some((i) => i.type === 'badDeploy' && i.node === n.id);
      if (bad) r.rolledBack = sim.t + 5; else r.restartUntil = sim.t + 5;
      toast(ui('rolledBack', { v: n.id }), 'i-retry');
    }
    if (act === 'renew') { r.renewed = true; toast(ui('renewed'), 'i-shield', 'gold'); }
    inspectorRefresh(true);
  }
  function edgeInspector(box, sel, lock) {
    const [a, b] = sel.id.split('>'); const na = game.board.node(a), nb = game.board.node(b);
    const e = game.arch.edges.find((x) => x[0] === a && x[1] === b);
    if (!na || !nb || !e) { inspector(null); return; }
    const o = U.eopt(e);
    const modEdge = na.type === 'mod' && nb.type === 'mod';
    const kinds = modEdge ? ['sync', 'cmd', 'evt'].concat(o.k === 'db' ? ['db'] : []) : [];
    const cur = o.k || 'sync';
    const cross = modEdge && na.cfg.grp !== nb.cfg.grp;
    const showAcl = modEdge && game.lv && (game.lv.incidents || []).some((i) => i.type === 'contract');
    const dis = lock ? 'disabled' : '';
    box.innerHTML = `<div class="ih">${ic('i-link')}<b>${esc(ui('link'))}</b><button class="iconbtn ix">${ic('i-x')}</button></div>
      <div class="ilink">${ic('c-' + na.type)}<span>${esc(na.type === 'mod' ? na.id : U.compName(na.type))}</span><i>→</i>${ic('c-' + nb.type)}<span>${esc(nb.type === 'mod' ? nb.id : U.compName(nb.type))}</span></div>
      ${o.need ? `<div class="ineed">${ic('i-target')}<span>${esc(ui('need'))}: <b>${esc(U.t('need.' + o.need))}</b></span></div>` : ''}
      ${kinds.length ? `<div class="c"><label>${esc(ui('kind'))}</label><div class="seg kinds">${kinds.map((k) => `<button data-k="${k}" class="${k === cur ? 'on' : ''}" ${dis}>${esc(U.t('edgeKind.' + k))}</button>`).join('')}</div></div>` : ''}
      ${showAcl && cross ? `<div class="c row"><label>${esc(ui('acl'))}</label><button class="tog acl ${o.acl ? 'on' : ''}" ${dis}><i></i></button></div>` : ''}
      ${lock || o.need ? '' : `<button class="btn danger del">${ic('i-trash')} ${esc(ui('removeLink'))}</button>`}`;
    box.querySelector('.ix').onclick = () => game.board.select(null);
    const setO = (patch) => { e[2] = Object.assign({}, e[2] || {}, patch); game.board.render(); game.board.select({ kind: 'edge', id: sel.id }); saveDraft(); };
    box.querySelectorAll('.kinds button').forEach((x) => x.onclick = () => { if (!lock) setO({ k: x.dataset.k }); });
    const acl = box.querySelector('.acl'); if (acl) acl.onclick = () => { if (!lock) setO({ acl: !o.acl }); };
    const d = box.querySelector('.del'); if (d) d.onclick = () => { game.arch.edges = game.arch.edges.filter((x) => x !== e); game.board.render(); game.board.select(null); saveDraft(); };
  }
  function liveBox(n, box) {
    if (!box) return;
    const s = game.sim && game.sim.nodeStats[n.id];
    if (!s) { box.innerHTML = ''; return; }
    const fogM = game.board.fogged('metrics');
    const meter = (label, v) => `<div class="m"><label>${esc(label)}</label><div class="mb"><i class="${v > 0.95 ? 'hot' : v > 0.75 ? 'warm' : ''}" style="width:${Math.min(100, v * 100)}%"></i></div><b>${Math.round(v * 100)}%</b></div>`;
    const cells = []; const kv = [];
    if (!fogM && (U.SVC[n.type] || ['db', 'worker', 'queue', 'broker', 'wsgw', 'ext', 'vpn'].includes(n.type))) cells.push(meter(ui('load'), s.util || 0));
    if (n.type === 'cache' || n.type === 'cdn') cells.push(meter(n.type === 'cdn' ? ui('fromEdge') : ui('hits'), s.hit || 0));
    if (!fogM && s.live != null) kv.push([ui('works'), `${s.live}${s.boot ? ` + ${s.boot} ${ui('booting')}` : ''}${s.pending ? ` · ${s.pending} ${ui('pending')}` : ''}`]);
    if (s.connMax) kv.push([ui('connections'), `${Math.round(s.conn)} / ${s.connMax}`]);
    if (n.type === 'queue' || n.type === 'broker') kv.push([ui('inQueue'), Math.round(s.backlog || 0).toLocaleString()], [ui('waiting'), U.fmtAge(s.age || 0)]);
    if (s.chAge > 1) kv.push([ui('lagLabel'), U.fmtAge(s.chAge)]);
    if (n.type === 'wsgw') kv.push([ui('connections'), `${U.fmtNum(s.conns || 0)} / ${U.fmtNum(s.want || 0)}`]);
    if (s.dead) kv.push([ui('status'), ui('down')]);
    if (!fogM && s.drop > 0.5) kv.push([ui('notKeeping'), U.fmtRps(s.drop)]);
    const traced = !(game.sc.fog || []).includes('traces') || !game.board.fogged('traces');
    if (traced && s.lat && (U.SVC[n.type] || n.type === 'ext' || n.type === 'db')) kv.push([ui('latency'), ms(s.lat)]);
    if ((game.sc.fog || []).includes('logs') && !game.board.fogged('logs') && s.errSrc > 0.5) kv.push([ui('errors'), U.fmtRps(s.errSrc)]);
    box.innerHTML = cells.join('') + (kv.length ? `<div class="kv">${kv.map(([a, b]) => `<span>${esc(a)}</span><b>${esc(b)}</b>`).join('')}</div>` : '');
  }

  // ---------- HUD ----------
  function hud() {
    if (!game) return;
    const box = game.root.querySelector('.hud'); const g = game.sc.goals || {};
    const sim = game.sim; const S = sim && sim.S;
    const runAv = S && S.att ? (100 * S.ok) / S.att : null;
    const tick = sim && sim.tick;
    const cost = sim ? sim.costNow || 0 : U.archCost(game.arch, game.sc);
    const tiles = []; const cls = (ok) => (ok == null ? '' : ok ? 'good' : 'bad');
    if (game.mode === 'survival' && game.surv) {
      const sv = game.surv;
      tiles.push(['i-coin', ui('cash'), money(sv.cash), cls(sv.cash > 50)], ['i-fire', ui('day'), String(sv.day), ''], ['i-check', ui('today'), sv.att ? pct((100 * sv.ok) / sv.att) : '—', sv.att ? cls(sv.ok / sv.att >= 0.97) : '']);
    } else {
      tiles.push(['i-check', ui('answered'), runAv == null ? '—' : pct(runAv, 2), runAv == null ? '' : cls(runAv >= g.avail)]);
      tiles.push(['i-clock', ui('wait'), tick && tick.ok > 0 ? ms(tick.p95) : '—', tick && tick.ok > 0 ? cls(tick.p95 <= g.p95) : '']);
      tiles.push(['i-coin', ui('moneyMo'), money(cost), g.budget ? cls(cost <= g.budget) : '']);
      if (game.mode === 'sandbox') tiles.push(['i-up', ui('rps'), tick ? U.fmtRps(tick.rps + (tick.bots || 0)) : U.fmtRps(U.trafficAt(game.sc, 0)), '']);
      if (game.mode === 'sandbox' && game.limit) tiles.push(['i-target', ui('limit'), U.fmtRps(game.limit), '']);
    }
    const html = tiles.map(([i, l, v, c]) => `<div class="ht ${c}">${ic(i)}<div><small>${esc(l)}</small><b>${esc(v)}</b></div></div>`).join('');
    if (box._h !== html) { box.innerHTML = html; box._h = html; }
    const dur = game.sc.dur; const tlp = game.root.querySelector('.tlp');
    if (isFinite(dur)) tlp.style.width = `${sim ? (100 * sim.t) / dur : 0}%`;
    else if (game.mode === 'survival' && game.surv) tlp.style.width = `${(100 * (sim.t - game.surv.dayStart)) / game.surv.dayLen}%`;
    else tlp.style.width = '0%';
  }
  function timelineMarks() {
    const box = game.root.querySelector('.tlm'); const dur = game.sc.dur;
    if (!isFinite(dur)) { box.innerHTML = ''; return; }
    box.innerHTML = (game.sc.incidents || []).map((i) => `<span style="left:${(100 * i.at) / dur}%" title="${esc(U.incName(i))}">${ic(INC_IC[i.type] || 'i-warn')}</span>`).join('');
  }
  function setStateUI() {
    const r = game.root; const st = game.state;
    r.classList.toggle('running', st === 'run'); r.classList.toggle('paused', st === 'pause'); r.classList.toggle('editing', st === 'edit');
    r.querySelector('.deploy').hidden = st !== 'edit';
    const lt = r.querySelector('.ltest'); if (lt) lt.hidden = st !== 'edit';
    r.querySelector('.pp').innerHTML = st === 'run' ? ic('i-pause') : ic('i-play');
    r.querySelector('.pp').disabled = st === 'edit' || st === 'done';
    const s = r.querySelector('.state');
    s.innerHTML = st === 'pause' ? `${ic('i-pause')}<span>${esc(ui('paused'))}</span>` : st === 'edit' ? `${ic('i-link')}<span>${esc(ui('linkHint'))}</span>` : '';
    s.hidden = st === 'run' || !s.innerHTML;
    game.board.applySel(); inspectorRefresh(true);
  }

  // ---------- запуск ----------
  function deploy() {
    const a = game.arch; const users = a.nodes.find((n) => n.type === 'users');
    if (users && !U.children(a, users.id).length) { toast(U.t('cause.noEntry')[1], 'i-warn', 'warn'); return; }
    const sc = U.clone(game.sc); sc.incidents = (game.sc.incidents || []).map((i) => Object.assign({}, i));
    game.sim = new U.Sim(game.arch, sc); Object.assign(game.sim.flags, game.flags);
    game.limit = null; game.shown = new Set();
    if (game.mode === 'survival') { const d = DIFF[game.diff]; game.surv = { cash: d.cash, day: 1, dayStart: 0, dayLen: 20, att: 0, ok: 0, cost: 0, peak: 0, bad: 0, hist: [], d }; }
    game.state = 'run'; game.acc = 0; game.board.clearLive(); setStateUI();
  }
  function togglePause() {
    if (!game.sim) return;
    if (game.state === 'run') game.state = 'pause';
    else if (game.state === 'pause') { game.sim.setArch(game.arch); game.state = 'run'; }
    setStateUI();
  }
  function toEdit() { game.sim = null; game.state = 'edit'; game.board.clearLive(); game.surv = null; setStateUI(); hud(); }

  function frame(ts) {
    if (!game) return;
    const dtR = Math.min(0.1, (ts - game.last) / 1000); game.last = ts;
    if (game.state === 'run' && game.sim) {
      game.acc += dtR * RATE[game.speed]; let k = 0;
      while (game.acc >= U.K.dt && k < 80) {
        game.sim.step(); game.acc -= U.K.dt; k++; afterStep();
        if (!game || game.state !== 'run') break;
        if (game.sim.done()) { finishLevel(); return; }
      }
    }
    if (!game) return;
    game.board.live(game.sim && game.state !== 'edit' ? game.sim : null, game.state === 'run' ? dtR * Math.sqrt(game.speed) : 0);
    hud(); coachTick();
    if (game.sel && game.sim && ts - (game.lastInsp || 0) > 250) { game.lastInsp = ts; inspectorRefresh(false); }
    game.raf = requestAnimationFrame(frame);
  }
  function afterStep() {
    const sim = game.sim; const t = sim.t;
    for (const ev of sim.events) {
      if (game.shown.has(ev) || ev.seenAt > t) continue;
      game.shown.add(ev);
      if (ev.warn) { toast(ui('warnCert'), 'i-shield', 'warn'); continue; }
      toast(U.incName(ev.inc) + (ev.seenAt - ev.t > 5 ? ' · ' + ui('notice') : ''), INC_IC[ev.inc.type] || 'i-warn', 'bad');
    }
    const tk = sim.tick;
    if (tk.cost >= 10000 && tk.rps < 500) unlock('waste');
    if (game.mode === 'sandbox') sandboxStep(tk);
    if (game.mode === 'survival') survivalStep(tk);
  }

  // ---------- итоги ----------
  function finishLevel() {
    if (game.coach) { game.coach.el.remove(); game.coach = null; }
    const res = game.sim.result(); const sc = game.sim.sc;
    game.state = 'done'; setStateUI();
    if (game.mode === 'level') {
      const prev = store.lv[sc.id] || {};
      store.lv[sc.id] = { stars: Math.max(prev.stars || 0, res.stars), score: Math.max(prev.score || 0, res.score) }; save();
      if (res.stars) unlock('first');
      if (res.stars === 3) unlock('three');
      if (res.cacheHit !== null && res.cacheHit >= 0.9 && res.stars) unlock('hit90');
      if (U.LEVELS.filter((l) => l.tier === 5).every(passed)) unlock('tier5');
      if (U.LEVELS.every(passed)) unlock('allch');
    }
    if (game.mode === 'daily') { const k = today(); const p = store.daily[k]; if (!p || res.score > p.score) store.daily[k] = { score: res.score, stars: res.stars }; save(); if (res.stars) unlock('daily'); }
    resultModal(res, sc);
  }
  function postmortem(res, sc) {
    const out = []; const att = res.att || 1; const T = (k) => U.t(k);
    for (const k in res.fail) { const v = res.fail[k]; const c = T('cause.' + k); if (v / att < 0.0005 || !Array.isArray(c)) continue; out.push({ w: v / att, title: c[0], fix: c[1], val: `−${(100 * v / att).toFixed(v / att < 0.01 ? 2 : 1)}%` }); }
    const g = sc.goals; const pm = T('pm');
    if (res.p95 > g.p95) {
      const top = Object.entries(res.slow || {}).filter(([k]) => T('slow.' + k) && k !== 'base').sort((a, b) => b[1] - a[1]).slice(0, 1);
      for (const [k] of top) { const s = T('slow.' + k); out.push({ w: 0.05, title: s[0], fix: s[1], val: ms(res.p95) }); }
    }
    if (res.cacheHit !== null && res.cacheHit < 0.5 && (res.fail.dbSat || res.p95 > g.p95)) out.push({ w: 0.03, title: pm.hit[0], fix: (sc.repeat || 0) < 0.3 ? pm.hit[1] : pm.hit[2], val: Math.round(res.cacheHit * 100) + '%' });
    if (res.staticShare > 0.3) out.push({ w: 0.025, title: pm.static[0], fix: pm.static[1], val: Math.round(res.staticShare * 100) + '%' });
    if (res.bots > 0 && res.botsOriginShare > 0.3) out.push({ w: 0.03, title: pm.bots[0], fix: pm.bots[1], val: Math.round(res.botsOriginShare * 100) + '%' });
    if (res.pass.queue === false || res.pass.lag === false) out.push({ w: 0.04, title: pm.lag[0], fix: pm.lag[1], val: U.fmtAge(Math.max(res.queueMaxAge, res.lagMax)) });
    if (res.pass.inv === false) out.push({ w: 0.06, title: pm.inv[0], fix: pm.inv[1], val: Math.round(res.inv) });
    if (res.pass.hanging === false) out.push({ w: 0.06, title: pm.hanging[0], fix: pm.hanging[1], val: Math.round(res.hanging) });
    if (res.pass.missed === false) out.push({ w: 0.06, title: pm.missed[0], fix: pm.missed[1], val: Math.round(res.missed * 100) + '%' });
    if (res.pass.lost === false || (sc.objective && sc.objective.type === 'lost' && res.lost > 0)) out.push({ w: 0.01, title: pm.lost[0], fix: pm.lost[1], val: Math.round(res.lost) });
    if (res.pass.sec === false) out.push({ w: 0.07, title: pm.sec[0], fix: pm.sec[1], val: Math.round(res.secFrac * 100) + '%' });
    if (!res.pass.cost) { const ids = res.arch.nodes.filter((n) => U.SVC[n.type]).map((n) => n.id); const util = ids.length ? ids.reduce((a, id) => a + (res.avgUtil[id] || 0), 0) / ids.length : 1; out.push({ w: 0.015 + (res.cost / g.budget - 1) * 0.02, title: pm.cost[0], fix: util < 0.35 ? pm.cost[1] : pm.cost[2], val: `${money(res.cost)} / ${money(g.budget)}` }); }
    if (res.events.length && !res.hasMon) out.push({ w: 0.001, title: pm.blind[0], fix: pm.blind[1], val: '20 s' });
    out.sort((a, b) => b.w - a.w);
    return out.slice(0, 4);
  }
  function objLabel(o) {
    if (!o) return '';
    if (o.type === 'has') return U.t('obj.has.' + o.node);
    if (o.type === 'cfg') { const k = U.t('obj.cfg.' + o.node + '_' + o.key); return typeof k === 'string' && !k.startsWith('obj.') ? k : U.t('obj.cfg.' + o.node); }
    const v = o.type === 'maxUtil' || o.type === 'cacheHit' || o.type === 'bots' ? Math.round(o.v * 100) : o.v;
    return U.t('obj.' + o.type, { v });
  }
  function resultModal(res, sc) {
    const g = sc.goals; const pm = postmortem(res, sc); const lv = game.lv; const tx = lv ? U.lvT(lv) : {};
    const next = game.mode === 'level' ? U.LEVELS[U.LEVELS.indexOf(lv) + 1] : null;
    const pr = tx.predict && game.pred != null ? tx.predict : null;
    const top = pm[0];
    const main = res.allPass
      ? (sc.tutorial ? `<div class="main ok">${ic('i-bulb')}<div><b>${esc(ui('tutWin'))}</b><span>${esc(ui('tutWinNote'))}</span></div></div>`
        : tx.lesson ? `<div class="main ok">${ic('i-bulb')}<div><b>${esc(tx.lesson)}</b><span>${esc(tx.real)}</span></div></div>` : '')
      : top ? `<div class="main bad">${ic('i-warn')}<div><b>${esc(top.title)}</b><span>${ic('i-bulb')} ${esc(top.fix)}</span></div></div>` : '';
    const nums = [['i-check', pct(res.avail, 1), ui('gotAnswer'), res.pass.avail], ['i-clock', ms(res.p95), ui('waited'), res.pass.p95], ['i-coin', money(res.cost), ui('inMonth'), res.pass.cost]];
    const rows = [['i-check', ui('answered'), pct(res.avail, 2), `≥ ${g.avail}%`, res.pass.avail], ['i-clock', ui('wait'), ms(res.p95), `≤ ${ms(g.p95)}`, res.pass.p95], ['i-coin', ui('moneyMo'), money(res.cost), `≤ ${money(g.budget)}`, res.pass.cost]];
    if (g.queueAge) rows.push(['i-queue', ui('goalQueue', { v: g.queueAge }), U.fmtAge(res.queueMaxAge), '', res.pass.queue]);
    if (g.lag != null) rows.push(['i-queue', ui('goalLag', { v: g.lag }), U.fmtAge(res.lagMax), '', res.pass.lag]);
    if (g.inv != null) rows.push(['i-shield', ui('goalInv'), String(Math.round(res.inv)), '', res.pass.inv]);
    if (g.hanging != null) rows.push(['i-link', ui('goalHang'), String(Math.round(res.hanging)), '', res.pass.hanging]);
    if (g.missed != null) rows.push(['i-bars', ui('goalMissed'), Math.round(res.missed * 100) + '%', '', res.pass.missed]);
    if (g.sec != null) rows.push(['i-shield', ui('goalSec'), Math.round(res.secFrac * 100) + '%', '', res.pass.sec]);
    if (sc.objective) rows.push(['i-target', objLabel(sc.objective), res.obj.ok ? '✓' : '✗', '★★', res.obj.ok]);
    const adr = tx.adr ? `<div class="adr"><div class="adr-h">${ic('i-book')}<b>${esc(ui('decision'))}:</b> <span>${esc(tx.adr[0])}</span></div><div class="adr-pc"><div class="pro"><small>${esc(ui('pros'))}</small>${tx.adr[1].map((x) => `<span>${ic('i-check')}${esc(x)}</span>`).join('')}</div><div class="con"><small>${esc(ui('cons'))}</small>${tx.adr[2].map((x) => `<span>${ic('i-minus')}${esc(x)}</span>`).join('')}</div></div></div>` : '';
    const primary = res.allPass && next ? `<button class="btn primary huge next">${ic('i-next')} ${esc(ui('next'))}</button>` : `<button class="btn primary huge retry">${ic('i-retry')} ${esc(res.allPass ? ui('again') : ui('fix'))}</button>`;
    const m = modal(`
      <div class="rtop ${res.allPass ? 'win' : 'lose'}">
        <div class="bigstars">${[1, 2, 3].map((k) => `<span class="${k <= res.stars ? 'on' : ''}">${ic('i-star')}</span>`).join('')}</div>
        <h2>${esc(res.allPass ? ui('win') : ui('lose'))}</h2>
      </div>
      <div class="nums">${nums.map(([i, v, l, ok]) => `<div class="${ok ? 'ok' : 'no'}">${ic(i)}<b>${esc(v)}</b><small>${esc(l)}</small></div>`).join('')}</div>
      ${main}
      ${pr ? `<div class="pline ${game.pred === pr[2] ? 'ok' : 'no'}">${ic(game.pred === pr[2] ? 'i-check' : 'i-x')}<span>${esc(game.pred === pr[2] ? ui('predictOk') : ui('predictMiss', { v: pr[1][pr[2]] }))}</span></div>` : ''}
      <div class="actions">${primary}</div>
      <div class="actions sub">${res.allPass && next ? `<button class="lnk retry">${ic('i-retry')} ${esc(ui('again'))}</button>` : ''}<button class="lnk out">${ic('i-map')} ${esc(game.mode === 'level' ? ui('toLevels') : ui('menu'))}</button><button class="lnk det">${ic('i-bars')} ${esc(ui('details'))}</button></div>
      <div class="details" hidden>
        ${pr ? `<p class="why">${esc(pr[3])}</p>` : ''}
        ${adr}
        ${pm.length ? `<h4>${ic('i-warn')} ${esc(res.allPass ? ui('whereThin') : ui('whatBroke'))}</h4><div class="causes">${pm.map((c) => `<div class="cause"><div><b>${esc(c.title)}</b><span class="val">${esc(c.val)}</span><p>${ic('i-bulb')} ${esc(c.fix)}</p></div></div>`).join('')}</div>` : ''}
        ${requestPath(res)}
        <div class="checks">${rows.map(([i, l, v, need, ok]) => `<div class="ck ${ok ? 'ok' : 'no'}">${ic(ok ? 'i-check' : 'i-x', 'ckmark')}${ic(i)}<span>${esc(l)}</span><b>${esc(v)}</b><small>${esc(need)}</small></div>`).join('')}</div>
        <div class="rgrid">${runCharts(res, sc)}</div>
      </div>`, 'sticky result');
    m.querySelectorAll('.retry').forEach((b) => b.onclick = () => { closeModal(); toEdit(); });
    const nx = m.querySelector('.next'); if (nx) nx.onclick = () => { closeModal(); brief(next); };
    m.querySelector('.out').onclick = () => { closeModal(); game.mode === 'level' ? levels() : home(); };
    m.querySelector('.det').onclick = (e) => { const d = m.querySelector('.details'); d.hidden = !d.hidden; e.currentTarget.classList.toggle('on', !d.hidden); };
  }
  function requestPath(res) {
    const rowsP = [[ui('typical'), res.path]];
    if (res.pathSlow && res.slowShare > 0.002) rowsP.push([ui('slowest', { v: (res.slowShare < 0.01 ? '<1' : Math.round(res.slowShare * 100)) + '%' }), res.pathSlow]);
    const tot = (p) => Object.values(p).reduce((a, b) => a + b, 0);
    if (!tot(res.path)) return '';
    const max = Math.max(1, ...rowsP.map(([, p]) => tot(p)));
    const COL = { base: 'var(--mut)', dist: 'var(--c-net)', cq: 'var(--warm)', dq: 'var(--c-data)', conn: 'var(--hot)', side: 'var(--c-async)', over: 'var(--hot)', hop: 'var(--flow)', ext: 'var(--c-x)' };
    const used = new Set(); rowsP.forEach(([, p]) => Object.keys(p).forEach((k) => p[k] >= 1 && used.add(k)));
    return `<div class="rpath"><div class="ph">${ic('i-link')}<b>${esc(ui('path'))}</b><small>${esc(ui('pathNote'))}</small></div>
      ${rowsP.map(([l, p]) => `<div class="rp"><span>${esc(l)}</span><div class="rpb">${Object.keys(COL).filter((k) => p[k] >= 0.5).map((k) => `<i style="width:${(100 * p[k]) / max}%;background:${COL[k]}" title="${esc(U.t('parts.' + k))}: ${Math.round(p[k])}"></i>`).join('')}</div><b>${ms(tot(p))}</b></div>`).join('')}
      <div class="rpl">${Object.keys(COL).filter((k) => used.has(k)).map((k) => `<span><i style="background:${COL[k]}"></i>${esc(U.t('parts.' + k))}</span>`).join('')}</div></div>`;
  }
  function runCharts(res, sc) {
    const tl = res.timeline; if (!tl.length) return '';
    const W = 300, H = 92, dur = tl[tl.length - 1].t || 1;
    const x = (t) => 6 + (t / dur) * (W - 12);
    const minAv = Math.min(90, ...tl.map((p) => p.av * 100));
    const yA = (v) => 10 + (1 - (v - minAv) / (100 - minAv)) * (H - 26);
    const maxP = Math.max(sc.goals.p95 * 1.5, ...tl.map((p) => p.p95));
    const yP = (v) => 10 + (1 - v / maxP) * (H - 26);
    const inc = (res.events || []).filter((e) => !e.warn).map((e) => `<line class="rc-inc" x1="${x(e.t)}" x2="${x(e.t)}" y1="6" y2="${H - 16}"/>`).join('');
    const line = (f) => tl.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${f(p).toFixed(1)}`).join(' ');
    return `
      <div class="rc"><div class="rcl">${ic('i-check')} ${esc(ui('answered'))}</div><svg viewBox="0 0 ${W} ${H}"><line class="rc-goal" x1="6" x2="${W - 6}" y1="${yA(sc.goals.avail)}" y2="${yA(sc.goals.avail)}"/>${inc}<path class="rc-line av" d="${line((p) => yA(p.av * 100))}"/><text x="6" y="${H - 3}">0</text><text x="${W - 6}" y="${H - 3}" text-anchor="end">${dur} s</text></svg></div>
      <div class="rc"><div class="rcl">${ic('i-clock')} ${esc(ui('wait'))}</div><svg viewBox="0 0 ${W} ${H}"><line class="rc-goal" x1="6" x2="${W - 6}" y1="${yP(sc.goals.p95)}" y2="${yP(sc.goals.p95)}"/>${inc}<path class="rc-line p" d="${line((p) => yP(Math.min(p.p95, maxP)))}"/><text x="6" y="${H - 3}">0</text><text x="${W - 6}" y="${H - 3}" text-anchor="end">${dur} s</text></svg></div>`;
  }

  // ---------- обучение поверх игры ----------
  const nodeOf = (type) => game && game.arch.nodes.find((n) => n.type === type);
  const nodeEl = (type) => { const n = nodeOf(type); return n && game.board.nodeEls[n.id] ? game.board.nodeEls[n.id].g.querySelector('.nb') : null; };
  const compId = () => nodeOf('compute') && nodeOf('compute').id;
  const COACH = [
    { el: () => nodeEl('users') },
    { el: () => game.root.querySelector('.pi[data-t=compute]'), act: () => paletteTap('compute'), done: () => !!nodeOf('compute') },
    { el: () => { const n = nodeOf('users'); return n && game.board.nodeEls[n.id].h; }, act: () => { if (!game.arch.edges.length && compId()) { game.arch.edges.push(['users', compId()]); game.board.render(); saveDraft(); } }, done: () => game.arch.edges.length > 0 },
    { el: () => game.root.querySelector('.deploy'), act: () => deploy(), done: () => game.state === 'run' },
    { el: () => nodeEl('compute'), done: () => game.sim && game.sim.t >= 21 },
    { wait: () => game.sim && game.sim.t >= 21.5, enter: () => { if (game.state === 'run') togglePause(); }, el: () => nodeEl('compute'), act: () => game.board.select({ kind: 'node', id: compId() }), done: () => game.sel && game.sel.kind === 'node' && game.sel.id === compId() },
    { el: () => game.root.querySelector('.insp [data-k=n] .inc'), act: () => { const n = nodeOf('compute'); setCfg(n, U.CTL.compute.find((x) => x.key === 'n'), Math.max(3, n.cfg.n)); }, done: () => nodeOf('compute') && nodeOf('compute').cfg.n >= 3 },
    { el: () => game.root.querySelector('.pp'), act: () => { if (game.state === 'pause') togglePause(); }, done: () => game.state === 'run' },
    { el: () => game.root.querySelector('.hud') },
  ];
  function coachStart() {
    game.coach = { i: 0, entered: false };
    const c = document.createElement('div'); c.className = 'coach';
    c.innerHTML = '<div class="spot"></div><div class="bubble"><p></p><div class="cb"><small></small><button class="btn primary cbn"></button></div></div>';
    document.body.appendChild(c); game.coach.el = c;
    c.querySelector('.cbn').onclick = () => { const st = COACH[game.coach.i]; if (st && st.act) { st.act(); if (!st.done || st.done()) coachNext(); } else coachNext(); };
  }
  function coachNext() { game.coach.i++; game.coach.entered = false; }
  function coachTick() {
    const co = game && game.coach; if (!co) return;
    const st = COACH[co.i]; const el = co.el;
    if (!st) { el.remove(); game.coach = null; return; }
    if (st.wait && !st.wait()) { el.hidden = true; return; }
    if (!co.entered) { co.entered = true; if (st.enter) st.enter(); }
    if (st.done && st.done()) { coachNext(); return; }
    el.hidden = false;
    const text = U.t('coach')[co.i], btn = U.t('coachBtn')[co.i];
    const p = el.querySelector('p'); if (p.textContent !== text) p.textContent = text;
    el.querySelector('small').textContent = `${co.i + 1} / ${COACH.length}`;
    const b = el.querySelector('.cbn'); if (b.textContent !== btn) b.textContent = btn;
    const t = st.el && st.el(); const spot = el.querySelector('.spot'), bub = el.querySelector('.bubble');
    if (!t) { spot.hidden = true; Object.assign(bub.style, { left: '50%', top: '90px', transform: 'translateX(-50%)' }); return; }
    const r = t.getBoundingClientRect(); spot.hidden = false;
    Object.assign(spot.style, { left: r.left - 6 + 'px', top: r.top - 6 + 'px', width: r.width + 12 + 'px', height: r.height + 12 + 'px' });
    const bw = Math.min(330, innerWidth - 24), bh = bub.offsetHeight || 120;
    const x = Math.min(innerWidth - bw - 12, Math.max(12, r.left + r.width / 2 - bw / 2));
    let y = r.bottom + 14; if (y + bh > innerHeight - 12) y = Math.max(12, r.top - bh - 14);
    Object.assign(bub.style, { left: x + 'px', top: y + 'px', width: bw + 'px', transform: 'none' });
  }

  // ---------- выживание ----------
  const REV = 0.05;
  function survivalStep(tk) {
    const sv = game.surv; const sim = game.sim; const dt = U.K.dt;
    sv.att += tk.att * dt; sv.ok += tk.ok * dt; sv.cost += tk.cost * dt; sv.peak = Math.max(sv.peak, tk.rps);
    if (sim.t - sv.dayStart < sv.dayLen) return;
    const av = sv.att ? sv.ok / sv.att : 1;
    sv.cash += (sv.ok / sv.dayLen) * REV - sv.cost / sv.dayLen / 30;
    sv.hist.push({ day: sv.day, cash: sv.cash, av });
    if (av < 0.97) { sim.sc.churn *= av < 0.9 ? 0.85 : 0.93; toast(ui('survDayBad', { d: sv.day, v: pct(av * 100) }), 'c-users', 'bad'); }
    sv.bad = av < 0.9 ? sv.bad + 1 : 0;
    if (sv.day === 7) unlock('surv7'); if (sv.day === 30) unlock('surv30');
    if (sv.cash < 0) { finishSurvival(ui('survNoMoney')); return; }
    if (sv.bad >= 3) { finishSurvival(ui('survLeft')); return; }
    sv.day++; sv.dayStart = sim.t; sv.att = 0; sv.ok = 0; sv.cost = 0;
    sim.sc.rps *= 1 + sv.d.g;
    const rnd = Math.random; const p = Math.min(0.9, sv.d.dir * (0.15 + 0.025 * sv.day));
    if (sv.day > 2 && rnd() < p) {
      const pool = [() => ({ type: 'spike', mul: +(1.5 + rnd() * (1 + sv.day / 15)).toFixed(1), ramp: rnd() < 0.5 ? 1 : 8, dur: 8 + rnd() * 8 }), () => ({ type: 'crash', k: 1 + Math.floor(rnd() * 2), dur: 15 }), () => ({ type: 'bots', rps: Math.round(sim.sc.rps * (1 + rnd() * 3)), dur: 12 + rnd() * 8 })];
      if (sv.day > 5) pool.push(() => ({ type: 'cacheLoss', dur: 15 }), () => ({ type: 'zone', zone: 'B', dur: 15 }));
      if (sv.day > 8 && rnd() < 0.3) pool.push(() => ({ type: 'price', mul: 1.2 }));
      const inc = pool[Math.floor(rnd() * pool.length)](); inc.at = sim.t + 3 + rnd() * 10; sim.extra.push(inc);
    }
  }
  function finishSurvival(why) {
    const sv = game.surv; if (!sv) { home(); return; }
    game.state = 'done'; setStateUI();
    const days = sv.day - 1; const rec = days > (store.surv.best || 0); store.surv.best = Math.max(store.surv.best || 0, days); save();
    const h = sv.hist; const W = 300, H = 90;
    const maxC = Math.max(1, ...h.map((x) => x.cash)), minC = Math.min(0, ...h.map((x) => x.cash));
    const x = (i) => 6 + (i / Math.max(1, h.length - 1)) * (W - 12), y = (v) => 8 + (1 - (v - minC) / (maxC - minC || 1)) * (H - 24);
    const chart = h.length > 1 ? `<div class="rc"><div class="rcl">${ic('i-coin')} ${esc(ui('moneyByDay'))}</div><svg viewBox="0 0 ${W} ${H}"><line class="rc-goal" x1="6" x2="${W - 6}" y1="${y(0)}" y2="${y(0)}"/><path class="rc-line av" d="${h.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.cash)}`).join(' ')}"/></svg></div>` : '';
    const pm = postmortem(game.sim.result(), game.sim.sc);
    const m = modal(`
      <div class="rtop lose"><h2>${esc(why)}</h2></div>
      <div class="nums"><div class="ok">${ic('i-fire')}<b>${days}</b><small>${esc(ui('days'))}${rec ? ' · ' + esc(ui('record')) : ''}</small></div><div>${ic('i-up')}<b>${U.fmtRps(sv.peak)}</b><small>${esc(ui('peak'))}</small></div><div>${ic('i-trophy')}<b>${store.surv.best}</b><small>${esc(ui('best'))}</small></div></div>
      ${chart}
      ${pm.length ? `<h4>${ic('i-warn')} ${esc(ui('hitHardest'))}</h4><div class="causes">${pm.slice(0, 3).map((c) => `<div class="cause"><div><b>${esc(c.title)}</b><p>${ic('i-bulb')} ${esc(c.fix)}</p></div></div>`).join('')}</div>` : ''}
      <div class="actions"><button class="btn primary huge again">${ic('i-retry')} ${esc(ui('again'))}</button></div><div class="actions sub"><button class="lnk out">${ic('i-map')} ${esc(ui('menu'))}</button></div>`, 'sticky result');
    m.querySelector('.again').onclick = () => { closeModal(); survivalSetup(); };
    m.querySelector('.out').onclick = () => { closeModal(); home(); };
  }

  // ---------- песочница ----------
  function sandboxPanel() {
    const names = { read: 'sbPresetRead', files: 'sbPresetFiles', write: 'sbPresetWrite', personal: 'sbPresetPersonal', far: 'sbPresetFar' };
    return `<div class="sbox">
      <div class="sbr"><label>${ic('i-up')} ${esc(ui('sbTraffic'))}</label><input type="range" id="sb-rps" min="0" max="1000" value="${Math.round(rpsToSlider(500))}"><b class="sbv">500 rps</b></div>
      <div class="seg sbmix">${Object.keys(PRESETS).map((k) => `<button data-p="${k}" class="${k === 'read' ? 'on' : ''}">${esc(ui(names[k]))}</button>`).join('')}</div>
      <div class="sbinc">${['spike', 'crash', 'zone', 'cacheLoss', 'bots'].map((k) => `<button data-i="${k}" title="${esc(U.t('inc.' + k))}">${ic(INC_IC[k])}</button>`).join('')}<button class="lim">${ic('i-target')}<span>${esc(ui('sbLimit'))}</span></button></div>
      <div class="sbslots"><span>${ic('i-save')}</span>${[0, 1, 2].map((i) => `<button data-sv="${i}">${i + 1}</button>`).join('')}<span class="sep">·</span>${[0, 1, 2].map((i) => `<button data-ld="${i}" ${store.slots[i] ? '' : 'disabled'}>${ic('i-retry')}${i + 1}</button>`).join('')}</div>
    </div>`;
  }
  const rpsToSlider = (r) => (Math.log10(r) - Math.log10(50)) / (6 - Math.log10(50)) * 1000;
  const sliderToRps = (v) => Math.round(Math.pow(10, Math.log10(50) + (v / 1000) * (6 - Math.log10(50))) / 10) * 10 || 50;
  function bindSandbox() {
    const r = game.root;
    const sl = r.querySelector('#sb-rps'), sv = r.querySelector('.sbv');
    sl.oninput = () => { const v = sliderToRps(+sl.value); game.sc.rps = v; if (game.sim) game.sim.sc.rps = v; sv.textContent = U.fmtRps(v); game.ramp = null; };
    r.querySelectorAll('.sbmix button').forEach((b) => b.onclick = () => {
      const keep = game.sc.rps; game.sc = sandboxScenario(b.dataset.p); game.sc.rps = keep;
      if (game.sim) Object.assign(game.sim.sc, U.clone(PRESETS[b.dataset.p]));
      r.querySelectorAll('.sbmix button').forEach((x) => x.classList.toggle('on', x === b));
    });
    r.querySelectorAll('.sbinc [data-i]').forEach((b) => b.onclick = () => {
      if (!game.sim || game.state !== 'run') { toast(ui('firstRun'), 'i-play', 'warn'); return; }
      const t = game.sim.t + 0.01;
      const inc = { spike: { type: 'spike', mul: 3, ramp: 2, dur: 20 }, crash: { type: 'crash', k: 2, dur: 20 }, zone: { type: 'zone', zone: 'B', dur: 25 }, cacheLoss: { type: 'cacheLoss', dur: 25 }, bots: { type: 'bots', rps: game.sim.sc.rps * 3, dur: 25 } }[b.dataset.i];
      inc.at = t; game.sim.extra.push(inc);
    });
    r.querySelector('.lim').onclick = () => { if (!game.sim || game.state !== 'run') { toast(ui('firstRun'), 'i-play', 'warn'); return; } game.ramp = { bad: 0 }; toast(ui('ramping'), 'i-target'); };
    r.querySelectorAll('[data-sv]').forEach((b) => b.onclick = () => { store.slots[+b.dataset.sv] = U.clone(game.arch); save(); toast(ui('saved', { v: +b.dataset.sv + 1 }), 'i-save'); r.querySelectorAll('[data-ld]').forEach((x) => (x.disabled = !store.slots[+x.dataset.ld])); });
    r.querySelectorAll('[data-ld]').forEach((b) => b.onclick = () => { if (game.state === 'run') { toast(ui('pauseToEdit'), 'i-pause', 'warn'); return; } const a = store.slots[+b.dataset.ld]; if (!a) return; game.arch = U.clone(a); if (!game.arch.groups) game.arch.groups = {}; game.board.setArch(game.arch); saveDraft(); hud(); });
  }
  function sandboxStep(tk) {
    if (tk.ok >= 1e6 && tk.av >= 0.99) unlock('million');
    const rp = game.ramp; if (!rp) return;
    const sim = game.sim;
    sim.sc.rps *= Math.pow(1.06, U.K.dt);
    if (tk.av < 0.99 || tk.p95 > 1000) rp.bad += U.K.dt; else rp.bad = 0;
    if (rp.bad >= 3 || sim.sc.rps > 2e6) {
      const lim = sim.sc.rps / Math.pow(1.06, 3); game.limit = lim; game.ramp = null;
      toast(ui('loadTestDone', { v: U.fmtRps(lim) }), 'i-target', 'gold');
      sim.sc.rps = Math.max(50, lim * 0.7); game.sc.rps = sim.sc.rps;
      game.root.querySelector('#sb-rps').value = rpsToSlider(sim.sc.rps); game.root.querySelector('.sbv').textContent = U.fmtRps(sim.sc.rps);
    }
  }

  // ---------- справочник ----------
  function learn(tab) {
    tab = tab || 'comp';
    const types = ['users'].concat(U.ORDER);
    const comps = types.map((t) => `<div class="card g-${U.GROUP_OF[t] || 'x'}"><div class="ch">${ic('c-' + t)}<b>${esc(U.compName(t))}</b></div><p>${esc(U.compShort(t))}</p>${U.compLike(t) ? `<div class="ilike">${esc(U.compLike(t))}</div>` : ''}${U.compTrap(t) ? `<div class="itrap">${ic('i-warn')}<span>${esc(U.compTrap(t))}</span></div>` : ''}</div>`).join('');
    const concepts = U.t('concepts').map(([t, d]) => `<div class="card"><div class="ch"><b>${esc(t)}</b></div><p>${esc(d)}</p></div>`).join('');
    const eng = `<div class="eng"><small>${ic('i-bulb')} ${esc(ui('engCycle'))}</small><div class="engc">${U.t('engCycle').map(([t, d], k) => `<div><span>${k + 1}</span><b>${esc(t)}</b><em>${esc(d)}</em></div>`).join('')}</div></div>`;
    const how = eng + `<div class="legend">${['sync', 'cmd', 'evt', 'db'].map((k) => `<div><svg viewBox="0 0 80 14" class="lg k-${k}"><path class="casing" d="M4 7H76"/><path class="pipe" d="M4 7H76"/></svg><span>${esc(U.t('edgeKind.' + k))}</span></div>`).join('')}</div>`;
    show(`<div class="page"><div class="head">${backBtn()}<h2>${esc(ui('learn'))}</h2>${langBtn()}</div>
      <div class="seg tabs"><button data-t="comp" class="${tab === 'comp' ? 'on' : ''}">${esc(ui('learnComp'))}</button><button data-t="conc" class="${tab === 'conc' ? 'on' : ''}">${esc(ui('learnConc'))}</button><button data-t="how" class="${tab === 'how' ? 'on' : ''}">${esc(ui('learnHow'))}</button></div>
      ${tab === 'how' ? how : `<div class="cards">${tab === 'comp' ? comps : concepts}</div>`}</div>`, 'scr-learn');
    bindBack(home); bindLang(() => learn(tab));
    app.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => learn(b.dataset.t));
  }

  // ---------- клавиатура ----------
  window.addEventListener('keydown', (e) => {
    if (!game || e.target.tagName === 'INPUT') return;
    if (e.key === ' ') { e.preventDefault(); if (game.sim) togglePause(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && game.sel && game.state !== 'run') {
      const s = game.sel;
      if (s.kind === 'node') { const n = game.board.node(s.id); if (n && n.type !== 'users' && n.type !== 'mod') { game.arch.nodes = game.arch.nodes.filter((x) => x.id !== n.id); game.arch.edges = game.arch.edges.filter((x) => x[0] !== n.id && x[1] !== n.id); } }
      else { const e2 = game.arch.edges.find((x) => x[0] + '>' + x[1] === s.id); if (e2 && !U.eopt(e2).need) game.arch.edges = game.arch.edges.filter((x) => x !== e2); }
      game.board.render(); game.board.select(null); saveDraft(); hud();
    }
    if (e.key === 'f' || e.key === 'а') game.board.fit();
    if (e.key === 'Escape') game.board.select(null);
  });
  window.addEventListener('resize', () => { if (game) game.board.fit(); });
  window.addEventListener('error', (e) => toast(ui('error') + ': ' + (e.message || '?'), 'i-warn', 'bad'));
  window.addEventListener('unhandledrejection', (e) => toast(ui('error') + ': ' + ((e.reason && e.reason.message) || e.reason), 'i-warn', 'bad'));
  document.title = ui('appName'); document.documentElement.lang = U.lang();
  return { start: home };
});
