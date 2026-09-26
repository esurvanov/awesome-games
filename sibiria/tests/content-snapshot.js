#!/usr/bin/env node
// Снимок «контракта» контента: главы и цели, реплики, записки, концовки, постройки, люди, улучшения,
// рецепты, обмен, предметы, числа баланса — и все русские строки из js/*.js.
// Страховка для рефакторинга «сюжет/персонажи/события → данные»: ничего не должно потеряться.
//   cd tests && node content-snapshot.js            — сверить с content-snapshot.json
//   node content-snapshot.js --update               — переписать эталон (после осознанной правки контента)
// Правила сверки: пропал ключ / изменилось значение / пропала строка из набора — FAIL;
// новое (ключи, строки, реплики) — только сообщение «+», не ошибка: контент можно добавлять.
// Наборы без порядка ($set): пулы реплик, советы деда, эфир, варианты реплик-геттеров, строки кода.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const URL = process.env.SIBIR_URL || 'file://' + path.resolve(__dirname, '../index.html');
const FILE = path.join(__dirname, 'content-snapshot.json');
const UPDATE = process.argv.includes('--update');

// ---------- русские строковые литералы из исходников (шаблоны: ${…} → {}) ----------
const CYR = /[А-Яа-яЁё]/;
function literals(src) {
  const out = []; let i = 0; const n = src.length;
  const str = q => { let s = ''; i++; while (i < n && src[i] !== q && src[i] !== '\n') { if (src[i] === '\\') { s += src[i + 1]; i += 2; continue; } s += src[i++]; } i++; return s; };
  function tpl() {
    let s = ''; i++;
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { s += src[i + 1]; i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; s += '{}'; expr(); continue; }
      s += src[i++];
    }
    i++; return s;
  }
  function expr() { // до парной }, внутри — свои строки и шаблоны
    let d = 1;
    while (i < n && d > 0) {
      const c = src[i];
      if (c === "'" || c === '"') { out.push(str(c)); continue; }
      if (c === '`') { out.push(tpl()); continue; }
      if (c === '{') d++; else if (c === '}') d--;
      i++;
    }
  }
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === "'" || c === '"') { out.push(str(c)); continue; }
    if (c === '`') { out.push(tpl()); continue; }
    i++;
  }
  return out.filter(s => CYR.test(s)).map(s => s.trim());
}
function codeTexts() {
  // js/*.js и подпапки (js/content/*.js — данные сюжета и персонажей)
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)
    .flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);
  const all = new Set();
  for (const f of walk(path.resolve(__dirname, '../js'))) for (const s of literals(fs.readFileSync(f, 'utf8'))) all.add(s);
  return { $set: [...all].sort() };
}

// ---------- контент из страницы (те же глобалы, что видит игра) ----------
function collect() {
  // Где что лежит (с рефакторинга «контент → данные»): персонажи, реплики, торговля — NPCS (js/content/npcs.js),
  // угрозы глав — CHAPTERS[i].threat, числа — TUNE / STORY. Снимок собирается в прежней форме.
  const WHO = Object.fromEntries(Object.entries(NPCS).map(([k, n]) => [k, n.look ? { n: n.n, i: n.i, look: n.look } : { n: n.n, i: n.i }]));
  const TRADES = NPCS.urk.trade.goods, FUR_PAY = NPCS.urk.trade.pay, URK_TIPS = NPCS.urk.tips, RADIO_LINES = NPCS.radio.lines;
  const IDLE = { urk: NPCS.urk.idle, vera: NPCS.vera.idle }, CH_T = CHAPTERS.map(c => c.threat);
  const START_H = TUNE.time.startH, SLEEP_X = TUNE.time.sleepX, AMULET_N = TUNE.world.amulets, D_EP = STORY.dEp, D_POP = STORY.dPop;
  const plain = o => JSON.parse(JSON.stringify(o)); // функции (условия целей и т.п.) отбрасываются
  const set = a => ({ $set: [...new Set(a)].sort() });
  const byKey = (arr, k = 'id') => Object.fromEntries(arr.map(x => [x[k], plain(x)]));
  const indexed = arr => Object.fromEntries(arr.map((x, i) => [i, plain(x)]));
  // реплика-геттер отдаёт случайный вариант — перебрать все, подставляя Math.random по сетке
  function variants(get) {
    const r0 = Math.random, seen = new Set();
    try { for (let k = 0; k < 64; k++) { Math.random = () => (k + 0.5) / 64; seen.add(JSON.stringify(get())); } } finally { Math.random = r0; }
    return { $set: [...seen].sort() };
  }
  const dialog = {};
  for (const k of Object.keys(DIALOG).sort()) {
    const d = Object.getOwnPropertyDescriptor(DIALOG, k);
    dialog[k] = d.get ? { variants: variants(() => DIALOG[k]) } : plain(DIALOG[k]);
  }
  return {
    chapters: Object.fromEntries(CHAPTERS.map((c, i) => [c.num, {
      order: i, n: c.n, ic: c.ic,
      goals: Object.fromEntries(c.goals.map((g, j) => [g.t, { order: j, ic: g.ic, at: g.at, alt: !!g.alt, cond: typeof g.ok === 'function', show: typeof g.show === 'function' }])),
    }])),
    dialog,
    who: plain(WHO),
    notes: plain(NOTES),
    endings: plain(ENDINGS),
    death: plain(DEATH),
    builds: plain(BUILDS),
    units: plain(UNITS),
    techs: plain(TECHS),
    epochs: indexed(EPOCHS),
    recipes: byKey(RECIPES),
    trades: byKey(TRADES),
    hutUpg: byKey(HUT_UPG),
    items: plain(ITEMS),
    gear: plain(GEAR),
    skills: plain(SKILLS),
    inspect: byKey(INSPECT),
    lines: {
      urkTips: set(URK_TIPS),
      radio: set(RADIO_LINES),
      idleUrk: set(IDLE.urk.map(x => x[1])),
      idleVera: set(IDLE.vera.map(x => x[1])),
    },
    numbers: {
      CYCLE, START_H, SLEEP_X, AMULET_N, D_EP, D_POP, LV, CH_T: indexed(CH_T), WRECK_POOL: plain(WRECK_POOL),
      MARKET: plain(MARKET), MARKET_SELL, MARKET_BUY, FUR_PAY, FOOD_KEYS, FOOD_ORDER, PARTS, fishes: byKey(FISHES, 'n'),
    },
  };
}

// ---------- сравнение ----------
function diff(a, b, p, out) {
  if (a && typeof a === 'object' && a.$set) {
    const bs = new Set((b && b.$set) || []), as = new Set(a.$set);
    for (const x of a.$set) if (!bs.has(x)) out.bad.push(`${p}: пропала строка «${String(x).slice(0, 90)}»`);
    for (const x of (b && b.$set) || []) if (!as.has(x)) out.add.push(`${p}: + «${String(x).slice(0, 90)}»`);
    return;
  }
  if (a && typeof a === 'object' && !Array.isArray(a)) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) { out.bad.push(`${p}: был объект, стало ${JSON.stringify(b)}`); return; }
    for (const k of Object.keys(a)) { if (!(k in b)) out.bad.push(`${p}.${k}: пропал`); else diff(a[k], b[k], `${p}.${k}`, out); }
    for (const k of Object.keys(b)) if (!(k in a)) out.add.push(`${p}.${k}: + новый`);
    return;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.bad.push(`${p}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`.slice(0, 240));
}

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const errs = [];
  let snap = null;
  try {
    const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
    pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
    await pg.route(/^https?:/, r => r.abort());
    await pg.goto(URL, { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => typeof CHAPTERS !== 'undefined' && typeof UI !== 'undefined');
    snap = await pg.evaluate(`(${collect})()`);
  } finally { await b.close().catch(() => {}); }
  snap.codeTexts = codeTexts();
  const count = o => o && typeof o === 'object' ? (o.$set ? o.$set.length : Object.values(o).reduce((s, v) => s + count(v), 0)) : 1;
  const summary = Object.keys(snap).map(k => `${k} ${count(snap[k])}`).join(' · ');
  if (errs.length) { console.log(errs.join('\n')); process.exit(1); }
  if (UPDATE) {
    fs.writeFileSync(FILE, JSON.stringify(snap, null, 1) + '\n');
    console.log(`ok   эталон записан: ${path.basename(FILE)} (${summary})`);
    return;
  }
  if (!fs.existsSync(FILE)) { console.log(`FAIL нет ${path.basename(FILE)} — снять эталон: node content-snapshot.js --update`); process.exit(1); }
  const ref = JSON.parse(fs.readFileSync(FILE, 'utf8')), out = { bad: [], add: [] };
  for (const k of Object.keys(ref)) { if (!(k in snap)) out.bad.push(`${k}: раздел пропал`); else diff(ref[k], snap[k], k, out); }
  for (const l of out.add.slice(0, 40)) console.log('     ' + l);
  if (out.add.length > 40) console.log(`     … ещё новых: ${out.add.length - 40}`);
  for (const l of out.bad.slice(0, 80)) console.log('FAIL ' + l);
  if (out.bad.length > 80) console.log(`FAIL … ещё расхождений: ${out.bad.length - 80}`);
  console.log(out.bad.length
    ? `\nFAIL: content-snapshot · расхождений ${out.bad.length}, новых ${out.add.length} · если правка осознанная: node content-snapshot.js --update`
    : `ok   контент совпадает с эталоном (${summary}) · новых ${out.add.length}`);
  process.exit(out.bad.length ? 1 : 0);
})();
