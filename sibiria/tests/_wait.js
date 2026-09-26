// Общий помощник тестов ввода: ждать УСЛОВИЯ и КАДРЫ игры, а не миллисекунды; «заморозить» мир на время проверки.
//
// Почему: игра двигает состояние в requestAnimationFrame (камера-lerp, инерция, призрак, курсор, таймеры сюжета),
// шаг кадра обрезан до 0.05 с. Под нагрузкой кадров меньше → «подождать 150 мс» = 1 кадр вместо 9; а случайные
// события (сюжетный диалог, подсказка, пурга, волки, NPC, бродящие люди) перекрывают точку касания/клика.
//
//   const W = require('./_wait');
//   await W.prepare(page);            // ДО goto: счётчик кадров + нагрузка (если задана SIBIR_LOAD)
//   await W.freeze(page);             // после старта игры: seed, без сюжета/директора/погоды/NPC/подсказок, время стоит
//   await W.until(page, () => ..., arg, { timeout })  → значение условия или false (не бросает)
//   await W.frames(page, 3);          // дождаться N кадров игрового цикла
//   await W.snapCam(page);            // камера ровно на герое (follow без догоняющего lerp)
//
//   await W.settleUI(page);           // HUD перестроился после смены выделения/режима (кнопки могут встать под палец)
//   await W.input(page, 1, () => tap)  // жест + дождаться, что страница получила отпускание
//
// Нагрузка (доказательство устойчивости): SIBIR_LOAD=cpuN — CDP Emulation.setCPUThrottlingRate N
// (cpu4 — как просили; в headless кадры дешёвые и 30 к/с держатся, реальную просадку до ~9 к/с даёт cpu20).

// ---------- в странице: счётчик кадров (обёртка rAF — до скриптов игры) ----------
// + счётчики pointerdown/up: CDP-касание подтверждается ДО обработчика страницы (touch — неблокирующее),
//   поэтому «отправил → сразу проверил» — гонка; ждём, пока страница реально получила N отпусканий.
const INIT = () => {
  const T = window.__T = { frames: 0, down: 0, up: 0 };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => raf(t => { T.frames++; cb(t); });
  addEventListener('pointerdown', () => { T.down++; }, true);
  addEventListener('pointerup', () => { T.up++; }, true);
  // журнал последних событий касания/указателя (цель + время) — для сообщения о провале, см. diag()
  T.log = []; for (const k of ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'touchcancel']) addEventListener(k, e => { T.log.push(k[0] + k.slice(-4) + ':' + (e.target.id || e.target.className || e.target.tagName) + '@' + Math.round(performance.now())); if (T.log.length > 30) T.log.shift(); }, true);
};

const LOAD = process.env.SIBIR_LOAD || '';
async function load(page) {
  if (!LOAD) return;
  if (!/^cpu\d+$/.test(LOAD)) throw new Error('SIBIR_LOAD: ожидается cpuN, например cpu4');
  const c = await page.context().newCDPSession(page);
  await c.send('Emulation.setCPUThrottlingRate', { rate: +LOAD.slice(3) });
}

async function prepare(page) {
  await page.addInitScript(INIT);
  await load(page);
}

// ---------- мир на паузе для проверок ввода ----------
// Время суток стоит, Math.random детерминирован, сюжет/директор угроз/погода/волки/медведь/NPC/звери/голод-холод
// и автономия людей (Colony.update) не тикают, подсказки и авто-качество выключены, окна закрыты.
// Герой (Hero.move) и камера/ввод работают — они и проверяются.
function FREEZE(o) {
  if (window.__T.frozen) return;
  window.__T.frozen = true;
  Math.random = mulberry(o.seed);
  // оригиналы — в __T.orig['Colony.update'] и т. п.: проверка может прогнать систему шагом вручную
  const orig = window.__T.orig = {};
  const off = (obj, name, ...ks) => { for (const k of ks) if (obj && typeof obj[k] === 'function') { orig[name + '.' + k] = obj[k]; obj[k] = () => {}; } };
  off(Story, 'Story', 'tick'); off(Weather, 'Weather', 'tick', 'newDay'); off(Director, 'Director', 'tick'); off(Wolves, 'Wolves', 'tick'); off(Bear, 'Bear', 'tick');
  off(Npc, 'Npc', 'tick', 'dawn'); off(Fauna, 'Fauna', 'hares', 'living', 'dawnTraps'); off(Survival, 'Survival', 'tick'); off(World, 'World', 'thinIce');
  off(Colony, 'Colony', 'update', 'newDay'); // люди не бродят, не идут в бой сами (эвенк убивал волка из проверки)
  const upd = window.update;
  window.update = dt => { const t = G.time; upd(dt); G.time = t; }; // сутки не идут: ни ночи, ни нового дня
  UI.tips.tick = () => {}; UI.tips.hide();
  Quality.set(window.QUALITY === 'low' ? 'low' : 'high'); // без авто-переключения (resize посреди жеста)
  G.storm = null; G.col.alarm = false; G.wolves = []; G.bear = null; G.shake = 0; G.hurt = 0;
  G.s.hp = 1e9; G.s.warm = 100; G.s.food = 100; G.time = tAt(G.day, 11);
  for (let i = 0; i < 8 && UI.modal(); i++) UI.closePanel();
  const dlg = document.getElementById('dialog'); if (dlg) dlg.hidden = true;
}
async function freeze(page, o = {}) {
  await page.evaluate(FREEZE, { seed: o.seed || 12345 });
  await closeModals(page);
  await frames(page, 2);
}
// закрыть всё модальное (карточка главы, диалог, панель) — до чистого мира
async function closeModals(page) {
  await until(page, () => { if (!UI.modal()) return true; UI.closePanel(); const d = document.getElementById('dialog'); if (UI.kind === 'dialog' && d) { d.hidden = true; } return false; }, null, { timeout: 8000, polling: 50 });
}

// ---------- ожидания ----------
// условие в странице → его значение, или false по таймауту (проверка сама напишет FAIL с фактическим значением)
async function until(page, fn, arg, o = {}) {
  try { const h = await page.waitForFunction(fn, arg, { timeout: o.timeout || 5000, polling: o.polling || 'raf' }); return await h.jsonValue(); }
  catch (e) { if (!/Timeout/i.test(e.message)) throw e; return false; }
}
// N кадров игрового цикла (не миллисекунд)
async function frames(page, n = 1) {
  const f0 = await page.evaluate(() => window.__T.frames);
  await page.waitForFunction(f => window.__T.frames >= f, f0 + n, { timeout: 30000, polling: 'raf' });
}
// камера ровно на герое: follow-режим с нулевым отставанием lerp (не «перестала двигаться за 120 мс»)
async function snapCam(page) {
  await page.evaluate(() => { GFX.recenter(); cam.x = G.p.x - GFX.vw / 2; cam.y = G.p.y - 20 - GFX.vh / 2; });
  await frames(page, 2);
  await until(page, () => GFX.mode === 'follow' && Math.abs(cam.x - (G.p.x - GFX.vw / 2)) < 0.01 && Math.abs(cam.y - (G.p.y - 20 - GFX.vh / 2)) < 0.01, null, { timeout: 3000 });
}
// камера стоит N кадров подряд (для свободной камеры/инерции): сравнение по кадрам, не по таймеру
async function camStill(page, n = 3) {
  return until(page, n => { const T = window.__T, s = cam.x.toFixed(2) + ',' + cam.y.toFixed(2); if (T.camS !== s) { T.camS = s; T.camF = T.frames; } return T.frames - T.camF >= n; }, n, { timeout: 8000 });
}

// HUD/раскладка обновляются раз в 0.08 с игрового времени (0.16 на простой графике), шаг кадра ≤ 0.05 с →
// не больше 4 кадров. После смены выделения/режима кнопки HUD (набат, бездельники…) появляются не сразу —
// точку «свободного места» выбирать только после этого.
const settleUI = page => frames(page, 6);
// что под экранной точкой (id/класс) — проверить цель прямо перед касанием
const hit = (page, x, y) => page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? e.id || String(e.className) || e.tagName : null; }, [x, y]);
// строка диагностики для сообщения о провале: состояние ввода и последние события
const diag = page => page.evaluate(() => JSON.stringify({ in: Input.debug(), gate: Input.gate(), modal: UI.kind, frames: window.__T.frames, ev: window.__T.log.slice(-8) }));

// ---------- ввод ----------
// выполнить жест и дождаться, пока страница обработала `ups` отпусканий (+1 кадр на отклик игры)
async function input(page, ups, fn) {
  const u0 = await page.evaluate(() => window.__T.up);
  await fn();
  const got = await until(page, n => window.__T.up >= n, u0 + ups, { timeout: 8000 });
  await frames(page, 1);
  return !!got;
}
// пачка CDP-событий одним заходом (без ожидания каждого): интервалы жеста — как у живого пальца/мыши,
// а не «время туда-обратно до браузера», которое под нагрузкой растёт до сотен мс (двойной тап > 300 мс,
// долгое нажатие 400 мс срабатывает посреди протяжки)
const burst = (cdp, method, evs) => Promise.all(evs.map(e => cdp.send(method, e)));
const touchBurst = (cdp, evs) => burst(cdp, 'Input.dispatchTouchEvent', evs);
const mouseBurst = (cdp, evs) => burst(cdp, 'Input.dispatchMouseEvent', evs);
const T1 = (x, y, id = 1) => ({ x, y, id });

module.exports = { prepare, load, freeze, closeModals, until, frames, snapCam, camStill, settleUI, hit, diag, input, touchBurst, mouseBurst, T1, LOAD };
