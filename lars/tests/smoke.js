// Дымовой тест: страница без ошибок, время идёт, очередь движется, событие выбирается, меню/лавка/телефон,
// сохранение и загрузка; озвучка; ключ на старте, голоса, живой разговор (текст и микрофон) с подменённым OpenAI.
// node smoke.js  (снимки — tests/shots/)
import { chromium, devices } from 'playwright';
import { serve } from './serve.js';
import fs from 'node:fs';
const OUT = new URL('./shots/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const { srv, url } = await serve();
export const GPU = ['--use-gl=angle', '--use-angle=' + (process.env.ANGLE || 'metal'), '--enable-unsafe-swiftshader'];
const b = await chromium.launch({ headless: true, args: GPU });
const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
pg.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
let fails = 0;
const ok = (cond, msg, extra = '') => { console.log((cond ? '  ok  ' : '  FAIL') + ' ' + msg + (extra !== '' ? '  ' + extra : '')); if (!cond) fails++; };
const G = fn => pg.evaluate(fn);

await pg.goto(url); await pg.evaluate(() => localStorage.clear()); await pg.reload();
await pg.waitForSelector('#st-new');
ok(errs.length === 0, 'страница загрузилась без ошибок', errs.join(' | '));

// старт
const t0 = Date.now();
await pg.click('#st-new');
await pg.waitForFunction(() => window.LARS && window.LARS.w && window.LARS.loop, null, { timeout: 30000 });
ok(true, 'мир создан', (Date.now() - t0) + ' мс');
const s0 = await G(() => ({ t: LARS.w.clock.t, cars: LARS.w.queue.cars.length, people: LARS.w.queue.people }));
ok(s0.cars > 1000 && s0.people > 3000, 'в очереди тысячи машин и людей', `${s0.cars} машин, ${s0.people} чел.`);

// время идёт само (×1: 1 игровой час ≈ 1 минута)
await pg.waitForTimeout(2500);
const t1 = await G(() => LARS.w.clock.t);
ok(t1 - s0.t >= 90, 'время идёт', `+${Math.round(t1 - s0.t)} игровых с за 2,5 с`);

// очередь движется
const q0 = await G(() => ({ passed: LARS.w.queue.passed.cars, s: LARS.w.pcar.s, ahead: LARS.w.queue.ahead(LARS.w.pcar) }));
await G(() => { LARS.setSpeed(0); const w = LARS.w; for (let i = 0; i < 720; i++) w.step(10); LARS.pending.length = 0; LARS.Modal.closeAll(); });
const q1 = await G(() => ({ passed: LARS.w.queue.passed.cars, s: LARS.w.pcar.s, ahead: LARS.w.queue.ahead(LARS.w.pcar) }));
ok(q1.passed > q0.passed + 50, 'КПП пропускает машины', `${q1.passed - q0.passed} за 2 ч`);
ok(q1.s < q0.s && q1.ahead < q0.ahead, 'машина игрока продвинулась', `${Math.round(q0.s - q1.s)} м, впереди ${q0.ahead} → ${q1.ahead}`);

// событие: показать, выбрать, увидеть последствия
await G(() => { const w = LARS.w, e = w.C.EVENTS.find(e => e.id === 'volunteer'); LARS.pending.push(w.prepareEvent(e)); LARS.flushEvents(); });
await pg.waitForSelector('.card .choice:not(.off)');
const tr0 = await G(() => LARS.w.trustOf('madina'));
await pg.click('.card .choice:not(.off)');
await pg.waitForSelector('[data-ok]');
const chipsN = await pg.$$eval('.card .chip', a => a.length);
ok(chipsN > 0, 'после выбора видны последствия', chipsN + ' чипов');
await pg.click('[data-ok]');
const tr1 = await G(() => LARS.w.trustOf('madina'));
ok(tr1 !== tr0, 'выбор изменил мир (доверие Мадины)', `${tr0} → ${tr1}`);

// ─── 3D от первого лица ───
const v3 = await G(() => ({ ok: !!(LARS.view3 && LARS.view3.ok), mode: LARS.mode, gl2: LARS.view3?.G?.v2, build: Math.round(LARS.view3?.buildMs || 0), inCar: LARS.w.player.inCar }));
ok(v3.ok && v3.mode === '3d', '3D-вид включён по умолчанию', `WebGL${v3.gl2 ? 2 : 1}, сборка ${v3.build} мс`);
ok(v3.inCar, 'старт — в своей машине (вид из салона)');
await G(() => { LARS.pending.length = 0; LARS.Modal.closeAll(); LARS.menu.hide(); });
await pg.keyboard.press('KeyF'); await pg.waitForTimeout(150);
const out = await G(() => ({ inCar: LARS.w.player.inCar, x: LARS.w.player.x, y: LARS.w.player.y }));
ok(!out.inCar, 'F — вышел из машины');
await G(() => { LARS.fp.yaw -= Math.PI / 2; });
await pg.keyboard.down('KeyW'); await pg.waitForTimeout(1200); await pg.keyboard.up('KeyW');
const walked = await G(() => ({ x: LARS.w.player.x, y: LARS.w.player.y, cy: LARS.view3.cam.y }));
const dist = Math.hypot(walked.x - out.x, walked.y - out.y);
ok(dist > 0.8, 'WASD — идёт пешком', dist.toFixed(1) + ' м');
// взгляд на человека → подсказка → E → меню
const aimed = await G(() => new Promise(res => {
  const G2 = LARS, v = G2.view3, w = G2.w;
  // встать рядом с ближайшим человеком у машин и посмотреть на него
  let t = v.targets.find(t => t.cyl && t.tg.kind === 'person' && t.tg.who);
  if (!t) { const i = w.queue.cars.indexOf(w.pcar); for (let k = 1; k < 60 && !t; k++) { const c = w.queue.cars[i - k]; if (!c) break; } }
  const go = () => { t = v.targets.find(t => t.cyl && t.tg.kind === 'person'); if (!t) return res(null);
    const dx = t.x - v.cam.x, dz = t.z - v.cam.z, d = Math.hypot(dx, dz);
    const px = t.x - dx / d * 2.5, pz = t.z - dz / d * 2.5; w.player.x = px; w.player.y = pz;
    requestAnimationFrame(() => requestAnimationFrame(() => { const dx2 = t.x - v.cam.x, dz2 = t.z - v.cam.z; G2.fp.yaw = Math.atan2(dx2, -dz2); G2.fp.pitch = Math.atan2(t.y + t.h * 0.6 - v.cam.y, Math.hypot(dx2, dz2));
      requestAnimationFrame(() => requestAnimationFrame(() => res(G2.fp.target ? G2.fp.target.name : null))); })); };
  if (!t) { const i = w.queue.cars.indexOf(w.pcar), c = w.queue.cars[Math.max(0, i - 3)], q = w.road.at(c.s, -4.5); w.player.x = q.x; w.player.y = q.y; requestAnimationFrame(() => requestAnimationFrame(go)); } else go();
}));
ok(!!aimed, 'прицел на человеке — подсказка с именем', aimed || '');
await pg.keyboard.press('KeyE');
await pg.waitForSelector('#menu:not([hidden]) .acts', { timeout: 3000 }).catch(() => {});
const m3 = await G(() => ({ open: LARS.menu.open, n: document.querySelectorAll('#menu .acts .btn').length }));
ok(m3.open && m3.n >= 3, 'E — меню действий на человеке', m3.n + ' действий');
await pg.screenshot({ path: OUT + 'smoke-3d-menu.png' });
await G(() => LARS.menu.hide());
// назад в машину
await G(() => { const v = LARS.view3, p = LARS.w.player, pc = v.pcarPose; p.x = pc.x - pc.fz * 2.2; p.y = pc.z + pc.fx * 2.2; });
await pg.waitForTimeout(100);
await pg.keyboard.press('KeyF'); await pg.waitForTimeout(150);
ok(await G(() => LARS.w.player.inCar), 'F у своей машины — сел');
// карта (M) и обратно
await pg.keyboard.press('KeyM'); await pg.waitForTimeout(150);
ok(await G(() => LARS.mode === 'map' && !document.getElementById('view').hidden), 'M — карта сверху');
await G(() => LARS.setMode('map'));

// меню действий на соседней машине
await G(() => { const G = window.LARS; G.input.follow = false; const w = G.w; G.view.cam.x = w.player.x; G.view.cam.y = w.player.y; G.view.cam.z = 6; });
await pg.waitForTimeout(200);
const pos = await G(() => { const w = LARS.w, i = w.queue.cars.indexOf(w.pcar), c = w.queue.cars[i + 1] || w.queue.cars[i - 1]; const q = LARS.view.carPose(c); return LARS.view.toScreen(q.x, q.y); });
await pg.mouse.click(pos.x, pos.y);
await pg.waitForSelector('#menu:not([hidden]) .acts');
const acts = await pg.$$eval('#menu .acts .btn', a => a.map(b => b.textContent.trim()));
ok(acts.length >= 5, 'меню действий открылось', acts.slice(0, 8).join(' · '));
await pg.click('#menu .acts .btn:not(.off)');
await pg.waitForTimeout(300);
const res = await pg.$eval('#menu', el => el.textContent);
ok(/Ещё/.test(res), 'действие выполнено, показан итог');
await G(() => LARS.menu.hide());

// лавка: купить
const m0 = await G(() => LARS.w.player.money.rub_cash);
await G(() => { const w = LARS.w, s = w.econ.sellers.find(o => o.npc === 'zaur'); LARS.openUi({ kind: 'shop', seller: s }); });
await pg.waitForSelector('.pays .btn:not(.off)');
await pg.click('.pays .btn:not(.off)');
const m1 = await G(() => LARS.w.player.money.rub_cash);
ok(m1 < m0, 'покупка у Заура', `${m0} → ${m1} ₽`);
await G(() => LARS.Modal.closeAll());

// телефон
await G(() => LARS.openPhone());
await pg.waitForSelector('.pchat');
const nChats = await pg.$$eval('.pchat', a => a.length);
await pg.click('.pchat');
await pg.waitForSelector('.msgs');
ok(nChats >= 3, 'телефон: чаты открываются', nChats + ' чатов');
await G(() => LARS.Modal.closeAll());

// сохранение и загрузка
const saved = await G(() => { LARS.save(true); const w = LARS.w; return { t: w.clock.t, cash: w.player.money.rub_cash, cars: w.queue.cars.length, s: w.pcar.s, kb: Math.round(localStorage.getItem('lars-save-v1').length / 1024) }; });
await pg.reload();
await pg.waitForSelector('#st-cont');
await pg.click('#st-cont');
await pg.waitForFunction(() => window.LARS && window.LARS.w, null, { timeout: 30000 });
const loaded = await G(() => { LARS.setSpeed(0); const w = LARS.w; return { t: w.clock.t, cash: w.player.money.rub_cash, cars: w.queue.cars.length, s: w.pcar.s }; });
ok(Math.abs(loaded.t - saved.t) < 600 && loaded.cash === saved.cash && loaded.cars === saved.cars, 'сохранение → загрузка', `${saved.kb} КБ, t ${saved.t} → ${loaded.t}`);
await G(() => { const w = LARS.w; for (let i = 0; i < 60; i++) w.step(10); });
ok(true, 'после загрузки мир живёт');

// телефон-экран: HUD помещается
const mp = await b.newPage({ ...devices['iPhone 13'] });
mp.on('pageerror', e => errs.push('MOBILE ' + e.message));
await mp.bringToFront(); await mp.goto(url); await mp.evaluate(() => localStorage.clear()); await mp.reload();
await mp.tap('#st-new');
await mp.waitForFunction(() => window.LARS && window.LARS.w, null, { timeout: 30000 });
await mp.evaluate(() => { LARS.setSpeed(0); LARS.w.step(10); }); await mp.waitForTimeout(3500);
await mp.screenshot({ path: OUT + 'smoke-mobile.png' });
const overlap = await mp.evaluate(() => { const a = document.querySelector('.queue').getBoundingClientRect(), b = document.querySelector('.dock').getBoundingClientRect(); return a.bottom > b.top && a.top < b.bottom && a.right > b.left; });
ok(!overlap, 'телефон: панель очереди не перекрывает док');
await pg.screenshot({ path: OUT + 'smoke-end.png' });

// file:// — двойной щелчок по index.html
const fp = await b.newPage({ viewport: { width: 1000, height: 640 } });
const ferr = []; fp.on('pageerror', e => ferr.push(e.message)); fp.on('console', m => { if (m.type() === 'error') ferr.push(m.text()); });
await fp.goto(new URL('../index.html', import.meta.url).href); await fp.evaluate(() => localStorage.clear()); await fp.reload();
await fp.click('#st-new');
await fp.waitForFunction(() => window.LARS && window.LARS.w && window.LARS.loop, null, { timeout: 60000 });
await fp.waitForTimeout(1200);
const fok = await fp.evaluate(() => ({ ok: !!(LARS.view3 && LARS.view3.ok), mode: LARS.mode, draws: LARS.view3?.stats.draws }));
ok(fok.ok && fok.mode === '3d' && fok.draws > 20 && ferr.length === 0, 'file:// — открывается, 3D рисуется', `${fok.draws} вызовов` + (ferr.length ? ' ' + ferr.join(' | ') : ''));
await fp.close();

// ─── озвучка OpenAI (подменяем api.openai.com: тихий mp3) ───
const MP3 = Buffer.from('//NAxAAAAANIAAAAAExBTUU0LjBVVVVVVVVVVVVVVVVMQU1FNC4wVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LEWwAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FNC4wVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80DEpAAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUU0LjBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsSjAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUU0LjBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMSkAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTQuMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxKMAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTQuMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxKQAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FNC4wVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LEowAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FNC4wVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80DEpAAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUU0LjBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsSjAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUU0LjBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMSkAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTQuMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxKMAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTQuMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxKQAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LEowAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=', 'base64');
async function fakeOpenAI(page, log) {
  await page.route('https://api.openai.com/**', async r => {
    const q = r.request(), cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const bad = (q.headers()['authorization'] || '') === 'Bearer sk-bad';
    if (bad) return r.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: '{"error":{"code":"invalid_api_key"}}' });
    if (q.url().endsWith('/v1/models')) return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"data":[]}' });
    log.push(JSON.parse(q.postData() || '{}'));
    return r.fulfill({ status: 200, headers: cors, contentType: 'audio/mpeg', body: MP3 });
  });
}
const showEv = (page, id) => page.evaluate(id => { const w = LARS.w; LARS.pending.length = 0; LARS.Modal.closeAll(); LARS.pending.push(w.prepareEvent(w.C.EVENTS.find(e => e.id === id))); LARS.flushEvents(); }, id);
const until = async (page, f, arg, ms = 5000) => { try { await page.waitForFunction(f, arg, { timeout: ms }); return true; } catch (e) { return false; } };
{
  const vc = await b.newContext({ viewport: { width: 1100, height: 700 } }), vp = await vc.newPage();
  const verr = [], vlog = [];
  vp.on('pageerror', e => verr.push(e.message)); vp.on('console', m => { if (m.type() === 'error') verr.push(m.text()); });
  await fakeOpenAI(vp, vlog);
  await vp.goto(url); await vp.evaluate(() => localStorage.clear()); await vp.reload();
  await vp.click('#st-new');
  await vp.waitForFunction(() => window.LARS && window.LARS.w && window.LARS.loop, null, { timeout: 30000 });
  await vp.evaluate(() => LARS.setSpeed(0));
  // без ключа: ни одного запроса, текст как был
  await showEv(vp, 'olya_fever'); await vp.waitForSelector('.card p'); await vp.waitForTimeout(800);
  ok(vlog.length === 0 && !(await vp.$('.card .vbtn')) && verr.length === 0, 'озвучка: без ключа — ни одного запроса, без ошибок', verr.join(' | '));
  // настройки через шестерёнку: ключ, «голос + текст», проверка ключа
  await vp.evaluate(() => LARS.Modal.closeAll());
  await vp.click('#h-set'); await vp.waitForSelector('.set');
  await vp.fill('#s-key', 'sk-test'); await vp.click('[data-mode="both"]'); await vp.click('#s-check');
  const kOk = await until(vp, () => !!document.querySelector('#s-kst.ok'));
  await vp.screenshot({ path: OUT + 'smoke-voice-settings.png' });
  ok(kOk && await vp.evaluate(() => JSON.parse(localStorage.getItem('lars-settings')).voiceMode === 'both'), 'настройки: ключ проверен ✅, режим сохранён');
  await vp.keyboard.press('Escape');
  // событие → ровно один запрос: рассказчик, текст карточки
  const ev = await vp.evaluate(() => { const w = LARS.w; return { text: w.prepareEvent(w.C.EVENTS.find(e => e.id === 'olya_fever')).text, voice: w.C.VOICES.speakers.narrator.voice }; });
  await showEv(vp, 'olya_fever');
  await until(vp, () => document.querySelector('.card .vbtn'));
  await vp.waitForTimeout(1200);
  const b0 = vlog[0] || {};
  ok(vlog.length === 1 && b0.voice === ev.voice && (b0.input || '').includes(ev.text.slice(0, 30)) && b0.model === 'gpt-4o-mini-tts' && !!b0.instructions,
    'озвучка: карточка → 1 запрос, голос рассказчика, текст карточки', `${vlog.length} запр., ${b0.voice}: «${(b0.input || '').slice(0, 40)}…»`);
  const played = await until(vp, () => L.use('audio/voice').Voice.stats.played >= 1 && !L.use('audio/voice').Voice.cur, null, 4000);
  ok(played, 'озвучка: фраза проиграна, очередь пуста');
  // та же фраза снова — из кэша
  await showEv(vp, 'olya_fever'); await vp.waitForTimeout(1000);
  const hits = await vp.evaluate(() => L.use('audio/voice').Voice.stats.hit);
  ok(vlog.length === 1 && hits >= 1, 'озвучка: повтор той же фразы — из кэша, без запроса', `запросов ${vlog.length}, из кэша ${hits}`);
  // «только голос»: текст свёрнут, реплика в кавычках — голосом персонажа
  await vp.evaluate(() => L.use('audio/voice').Voice.set('voiceMode', 'voice'));
  await showEv(vp, 'kirill_lift');
  await until(vp, (n) => document.querySelector('.card .vt.vo'), null, 3000); await vp.waitForTimeout(1200);
  const vo = await vp.evaluate(() => ({ collapsed: !!document.querySelector('.card .vt.vo .vfull[hidden]'), kir: L.use('content/voices').VOICES.speakers.kirill.voice }));
  const kirReq = vlog.slice(1);
  await vp.screenshot({ path: OUT + 'smoke-voice-only.png' });
  ok(vo.collapsed && kirReq.length === 2 && kirReq.some(x => x.voice === vo.kir) && kirReq.some(x => x.voice === ev.voice), '«только голос»: текст свёрнут, рассказчик + голос Кирилла', kirReq.map(x => x.voice + ': ' + x.input.slice(0, 24)).join(' · '));
  // неверный ключ → тост, озвучка выключается, текст снова виден
  await vp.evaluate(() => L.use('audio/voice').Voice.set('voiceKey', 'sk-bad'));
  await showEv(vp, 'fire');
  const bad = await until(vp, () => L.use('audio/voice').Voice.keyBad && [...document.querySelectorAll('.toast')].some(t => /неверный ключ/.test(t.textContent)));
  ok(bad, 'озвучка: 401 → «неверный ключ», дальше текст');
  const verr2 = verr.filter(e => !/status of 401/.test(e)); // «Failed to load resource: 401» — браузер пишет сам, это ожидаемо
  ok(verr2.length === 0, 'озвучка: без ошибок в консоли', verr2.join(' | '));
  await vc.close();
}
// file:// — озвучка тоже работает (fetch к api.openai.com с origin null)
{
  const fc = await b.newContext({ viewport: { width: 1000, height: 640 } }), fv = await fc.newPage();
  const ferr2 = [], flog = [];
  fv.on('pageerror', e => ferr2.push(e.message)); fv.on('console', m => { if (m.type() === 'error') ferr2.push(m.text()); });
  await fakeOpenAI(fv, flog);
  await fv.goto(new URL('../index.html', import.meta.url).href);
  await fv.evaluate(() => { localStorage.clear(); localStorage.setItem('lars-settings', JSON.stringify({ voiceMode: 'both', voiceKey: 'sk-test' })); }); await fv.reload();
  await fv.click('#st-new');
  await fv.waitForFunction(() => window.LARS && window.LARS.w && window.LARS.loop, null, { timeout: 60000 });
  await fv.evaluate(() => LARS.setSpeed(0));
  await showEv(fv, 'fire'); await until(fv, () => document.querySelector('.card .vbtn')); await fv.waitForTimeout(1500);
  const idb = await fv.evaluate(() => new Promise(r => { try { const q = indexedDB.open('lars-voice', 1); q.onsuccess = () => { try { const c = q.result.transaction('clips').objectStore('clips').count(); c.onsuccess = () => r(c.result); c.onerror = () => r(-1); } catch (e) { r(-2); } }; q.onerror = () => r(-3); } catch (e) { r(-4); } }));
  ok(flog.length === 1 && ferr2.length === 0, 'file:// — озвучка: запрос ушёл, без ошибок', `${flog.length} запр., IndexedDB: ${idb >= 0 ? idb + ' клип(ов)' : 'нет (' + idb + ')'}` + (ferr2.length ? ' ' + ferr2.join(' | ') : ''));
  await fc.close();
}

// ─── голоса: у именных — свои, у безымянных — стабильные и разные ───
{
  const vp = await b.newPage({ viewport: { width: 1000, height: 700 } });
  await vp.goto(url);
  const v = await vp.evaluate(() => {
    const { VOICES } = L.use('content/voices'), { CONTENT } = L.use('content/index'), { strangerVoice } = L.use('ai/persona');
    const named = [...CONTENT.PEOPLE.map(p => p.id), ...CONTENT.PHONE.contacts.map(c => c.id)].map(id => ({ id, ...VOICES.speakers[id] }));
    const missing = named.filter(x => !x.voice).map(x => x.id);
    const by = {}; for (const x of named) (by[x.voice] ||= []).push(x);
    const clash = Object.values(by).filter(a => a.length > 2 || (a.length === 2 && a[0].say === a[1].say)).map(a => a.map(x => x.id).join('+'));
    const keys = Array.from({ length: 40 }, (_, i) => 'c:' + (1000 + i * 7) + ':0');
    const vs = keys.map((k, i) => strangerVoice(k, i % 3 === 0, 20 + (i * 7) % 45));
    const again = keys.map((k, i) => strangerVoice(k, i % 3 === 0, 20 + (i * 7) % 45));
    const combos = new Set(vs.map(s => s.voice + '|' + s.mood));
    return { missing, clash, voices: new Set(vs.map(s => s.voice)).size, combos: combos.size, stable: vs.every((s, i) => s === again[i]), os: /осетин/.test(strangerVoice('s:x', false, 50, 'os').say), ge: /грузин/.test(strangerVoice('g:x', false, 40, 'ge').say) };
  });
  ok(!v.missing.length && !v.clash.length, 'голоса: у каждого именного свой голос или своя подача', v.missing.concat(v.clash).join(' '));
  ok(v.voices >= 6 && v.combos >= 15 && v.stable && v.os && v.ge, 'голоса: безымянные — стабильно, разные голоса и подача, акценты', `${v.voices} голосов, ${v.combos} сочетаний`);
  await vp.close();
}

// ─── ключ на старте: без ключа — карточка один раз, «Играть без голоса» запоминается, ни одного запроса ───
const AI = { log: [], chat: [], stt: 0, tts: [], queue: [], models: '{"data":[{"id":"gpt-4o-mini"},{"id":"gpt-4.1-mini"},{"id":"tts-1"},{"id":"gpt-4o-mini-transcribe"},{"id":"whisper-1"}]}' };
async function fakeAI(page, st) {
  await page.route('https://api.openai.com/**', async r => {
    const q = r.request(), cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const u = q.url(); st.log.push(u);
    if (u.endsWith('/v1/models')) return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: st.models });
    if (u.endsWith('/audio/speech')) { st.tts.push(JSON.parse(q.postData() || '{}')); return r.fulfill({ status: 200, headers: cors, contentType: 'audio/mpeg', body: MP3 }); }
    if (u.endsWith('/audio/transcriptions')) { st.stt++; return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ text: st.sttText || 'Почём пироги?' }) }); }
    if (u.endsWith('/chat/completions')) {
      st.chat.push(JSON.parse(q.postData() || '{}'));
      const nx = st.queue.shift() || { reply: 'Ну.', emotion: 'calm', intent: 'chat', effects: [] };
      if (nx.status) return r.fulfill({ status: nx.status, headers: cors, contentType: 'application/json', body: '{"error":{"message":"boom"}}' });
      const content = typeof nx === 'string' ? nx : JSON.stringify(nx);
      return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 900, completion_tokens: 40 } }) });
    }
    return r.fulfill({ status: 404, headers: cors, body: '{}' });
  });
}
const E = (type, o = {}) => ({ type, value: null, good: null, rumour: null, note: null, ...o });
{
  const c = await b.newContext({ viewport: { width: 1100, height: 720 } }), p = await c.newPage();
  const perr = [], st = { ...AI, log: [], chat: [], tts: [], queue: [] };
  p.on('pageerror', e => perr.push(e.message)); p.on('console', m => { if (m.type() === 'error') perr.push(m.text()); });
  await fakeAI(p, st);
  await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.waitForSelector('#st-new');
  const n1 = await p.$$eval('#ob', a => a.length);
  await p.screenshot({ path: OUT + 'smoke-onboard.png' });
  await p.click('#ob-skip');
  const gone = !(await p.$('#ob'));
  await p.reload(); await p.waitForSelector('#st-new');
  const n2 = await p.$$eval('#ob', a => a.length), setBtn = !!(await p.$('#st-set'));
  ok(n1 === 1 && gone && n2 === 0 && setBtn, 'ключ на старте: карточка один раз, «Играть без голоса» запомнено, «Настройки» на месте');
  await p.click('#st-new');
  await p.waitForFunction(() => window.LARS && window.LARS.w && window.LARS.loop, null, { timeout: 30000 });
  await p.evaluate(() => LARS.setSpeed(0));
  // «Сказать своё» без ключа — предлагает ключ, запросов нет
  const k = await p.evaluate(() => { const w = LARS.w, s = w.econ.sellers.find(o => o.npc === 'zaur'); LARS.openUi({ kind: 'talk', tg: { kind: 'seller', seller: s, npc: 'zaur' } }); return !!document.querySelector('#modal .okey'); });
  await p.evaluate(() => LARS.Modal.closeAll());
  await p.keyboard.press('KeyV'); await p.waitForTimeout(300);
  ok(k && st.log.length === 0 && perr.length === 0, 'без ключа: «Сказать своё» предлагает ключ, ни одного запроса, без ошибок', perr.join(' | '));
  await c.close();
}
// ─── ключ на старте → проверка → «голос + текст»; разговор текстом: промпт, доверие, сделка, ошибки ───
{
  const c = await b.newContext({ viewport: { width: 1100, height: 720 } }), p = await c.newPage();
  const perr = [], st = { ...AI, log: [], chat: [], tts: [], queue: [] };
  p.on('pageerror', e => perr.push(e.message)); p.on('console', m => { if (m.type() === 'error') perr.push(m.text()); });
  await fakeAI(p, st);
  await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.fill('#ob-key', 'sk-test'); await p.click('#ob-check');
  const on = await until(p, () => { const s = JSON.parse(localStorage.getItem('lars-settings') || '{}'); return s.voiceKey === 'sk-test' && s.voiceMode === 'both'; });
  await p.waitForTimeout(1200);
  ok(on && !(await p.$('#ob')), 'ключ на старте: проверен → «Голос + текст» включён, карточка ушла');
  await p.click('#st-new');
  await p.waitForFunction(() => window.LARS && window.LARS.w && window.LARS.loop, null, { timeout: 30000 });
  await p.evaluate(() => { LARS.setSpeed(0); LARS.pending.length = 0; LARS.Modal.closeAll(); });
  // меню на соседе: есть «Сказать своё»
  const hasBtn = await p.evaluate(() => { const w = LARS.w; return w.actionsFor({ kind: 'person', who: w.person(5, 1) }).some(x => x.a.op === 'freeTalk'); });
  // открыть разговор с Зауром
  const info = await p.evaluate(() => {
    const w = LARS.w, s = w.econ.sellers.find(o => o.npc === 'zaur');
    LARS.openUi({ kind: 'talk', tg: { kind: 'seller', seller: s, npc: 'zaur' } });
    return { price: w.econ.price(s, 'pie', w.trustOf('zaur')), trust: w.trustOf('zaur'), cash: w.player.money.rub_cash, pie: w.player.items.pie || 0 };
  });
  await p.waitForSelector('#talk #t-in');
  const line = 'Здравствуйте! Почём пироги сегодня?';
  st.queue.push({ reply: 'Пятьсот тридцать. Горячие, с сыром.', emotion: 'warm', intent: 'chat', effects: [E('trust', { value: 40 })] });
  await p.fill('#t-in', line); await p.press('#t-in', 'Enter');
  await until(p, () => document.querySelectorAll('#t-msgs .msg.npc').length >= 1, null, 8000);
  const b0 = st.chat[0] || {}, sys = b0.messages?.[0]?.content || '', last = b0.messages?.[b0.messages.length - 1]?.content;
  const fmtP = String(info.price).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
  ok(st.chat.length === 1 && sys.includes('Заур') && sys.includes('«Осетинский пирог» — ' + fmtP) && last === line && b0.response_format?.type === 'json_schema' && b0.model === 'gpt-4.1-mini',
    'разговор: 1 запрос, в промпте — Заур, цена пирога сейчас и реплика игрока', `${st.chat.length} запр., ${b0.model}, ${fmtP}, ${sys.length} симв.`);
  const t1 = await p.evaluate(() => ({ trust: LARS.w.trustOf('zaur'), chip: [...document.querySelectorAll('#t-msgs .chip')].map(x => x.textContent).join(' · '), mem: LARS.w.talks.zaur?.h.length }));
  ok(t1.trust === info.trust + 15 && /Заур \+15/.test(t1.chip) && t1.mem === 2, 'разговор: доверие +15 (40 обрезано до 15), чип виден, память сохранена', `${info.trust} → ${t1.trust} · ${t1.chip}`);
  await until(p, () => true);
  await p.waitForTimeout(800);
  const zv = await p.evaluate(() => L.use('content/voices').VOICES.speakers.zaur.voice);
  ok(st.tts.some(x => x.voice === zv && /Пятьсот/.test(x.input) && /Сейчас: тепло/.test(x.instructions || '')), 'разговор: ответ озвучен голосом Заура с эмоцией', st.tts.map(x => x.voice).join(','));
  // сделка: предложение → только после подтверждения
  st.queue.push({ reply: 'Бери, отдам за четыреста пятьдесят.', emotion: 'warm', intent: 'sell', effects: [E('sell', { good: 'pie', value: 450 })] });
  await p.fill('#t-in', 'Давайте один'); await p.press('#t-in', 'Enter');
  await p.waitForSelector('#t-offers .choice', { timeout: 8000 });
  const mid = await p.evaluate(() => ({ cash: LARS.w.player.money.rub_cash, label: document.querySelector('#t-offers .choice').textContent }));
  await p.screenshot({ path: OUT + 'smoke-talk.png' });
  await p.click('#t-offers .choice');
  const aft = await p.evaluate(() => ({ cash: LARS.w.player.money.rub_cash, pie: LARS.w.player.items.pie || 0 }));
  ok(mid.cash === info.cash && aft.cash < info.cash && aft.pie === info.pie + 1, 'разговор: продажа — деньги только после подтверждения', `${mid.label.trim()} · ${info.cash} → ${aft.cash} ₽`);
  // испорченный JSON и 500 — мягко, с «Меню действий»
  st.queue.push('это не json');
  await p.fill('#t-in', 'А чай есть?'); await p.press('#t-in', 'Enter');
  const e1 = await until(p, () => !!document.querySelector('#t-msgs .tsys.err'), null, 8000);
  st.queue.push({ status: 500 });
  await p.click('#t-msgs .tsys.err [data-sb$=":0"]'); // «Ещё раз»
  const e2 = await until(p, () => document.querySelectorAll('#t-msgs .tsys.err').length >= 1 && LARS.w && !document.querySelector('#t-msgs .think'), null, 8000);
  await p.waitForTimeout(300);
  const btn = await p.$('#t-msgs .tsys.err button:last-child');
  await btn.click();
  const back = await p.evaluate(() => ({ talk: !!document.querySelector('#talk'), menu: LARS.menu.open }));
  const perr2 = perr.filter(e => !/status of 500/.test(e));
  ok(hasBtn && e1 && e2 && !back.talk && back.menu && perr2.length === 0 && st.chat.length === 4, 'разговор: плохой JSON и 500 → сообщение, «Меню действий», без ошибок', `${st.chat.length} запр.` + (perr2.length ? ' ' + perr2.join(' | ') : ''));
  // счётчик расходов в настройках, проба голосов
  await p.evaluate(() => { LARS.menu.hide(); LARS.openSettings(); });
  await p.waitForSelector('#s-use .chip');
  const set = await p.evaluate(() => ({ use: document.querySelector('#s-use').textContent, rows: document.querySelectorAll('#s-voices .vrow').length, opts: [...document.querySelectorAll('#s-tmodel option')].map(o => o.value) }));
  await p.evaluate(() => { document.querySelector('#s-voices').open = true; });
  await p.click('#s-voices [data-pv="akhsar"]'); await p.waitForTimeout(600);
  ok(/4 ответов/.test(set.use) && set.rows >= 20 && set.opts.includes('gpt-4.1-mini') && !set.opts.includes('tts-1') && st.tts.some(x => x.voice === 'onyx' && /старик|Старик/.test(x.instructions || '')),
    'настройки: расход сессии, модели ответа, проба голосов', `${set.rows} голосов · ${set.use.slice(0, 60)}`);
  await p.screenshot({ path: OUT + 'smoke-voices.png' });
  // сохранение: память разговора переживает перезагрузку
  const saved = await p.evaluate(() => { LARS.Modal.closeAll(); LARS.save(true); return JSON.parse(localStorage.getItem('lars-save-v1')).talks?.zaur?.h.length; });
  ok(saved >= 4, 'разговор: память в сохранении', saved + ' реплик');
  await c.close();
}
// ─── микрофон: поддельное устройство Chromium → держим V → одна расшифровка → ответ ───
{
  const mb = await chromium.launch({ headless: true, args: [...GPU, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  for (const where of ['file', 'http']) {
    const c = await mb.newContext({ viewport: { width: 1000, height: 680 } }), p = await c.newPage();
    const perr = [], st = { ...AI, log: [], chat: [], tts: [], queue: [], sttText: 'Почём пироги?' };
    p.on('pageerror', e => perr.push(e.message)); p.on('console', m => { if (m.type() === 'error') perr.push(m.text()); });
    await fakeAI(p, st);
    await p.goto(where === 'file' ? new URL('../index.html', import.meta.url).href : url);
    await p.evaluate(() => { localStorage.clear(); localStorage.setItem('lars-settings', JSON.stringify({ voiceMode: 'off', voiceKey: 'sk-test', keyAsk: 'done' })); }); await p.reload();
    const sec = await p.evaluate(() => ({ sc: window.isSecureContext, ok: L.use('audio/mic').Mic.ok() }));
    await p.click('#st-new');
    await p.waitForFunction(() => window.LARS && window.LARS.w && window.LARS.loop, null, { timeout: 60000 });
    await p.evaluate(() => { LARS.setSpeed(0); LARS.pending.length = 0; LARS.Modal.closeAll(); const w = LARS.w, s = w.econ.sellers.find(o => o.npc === 'zaur'); LARS.openUi({ kind: 'talk', tg: { kind: 'seller', seller: s, npc: 'zaur' } }); });
    await p.waitForSelector('#talk');
    const hasMic = !!(await p.$('#t-mic'));
    st.queue.push({ reply: 'Пятьсот. Бери, пока горячие.', emotion: 'joking', intent: 'chat', effects: [] });
    await p.keyboard.down('KeyV');
    const rec = await until(p, () => L.use('audio/mic').Mic.recording, null, 4000);
    await p.waitForTimeout(900);
    const lv = await p.evaluate(() => getComputedStyle(document.querySelector('#t-lv') || document.body).getPropertyValue('--lv'));
    await p.keyboard.up('KeyV');
    const got = await until(p, () => document.querySelectorAll('#t-msgs .msg.npc').length >= 1, null, 8000);
    const me = await p.evaluate(() => document.querySelector('#t-msgs .msg.me')?.textContent || '');
    const lastUser = st.chat[0]?.messages?.slice(-1)[0]?.content;
    ok(sec.ok === hasMic && (!sec.ok || (rec && got && st.stt === 1 && me === 'Почём пироги?' && lastUser === 'Почём пироги?' && perr.length === 0)),
      `микрофон (${where}): ${sec.ok ? 'держим V → 1 расшифровка → ответ' : 'нет защищённого контекста — только текст'}`, `secure=${sec.sc} mic=${sec.ok} stt=${st.stt} уровень=${lv || '—'}` + (perr.length ? ' ' + perr.join(' | ') : ''));
    await c.close();
  }
  await mb.close();
}

ok(errs.length === 0, 'нет ошибок в консоли', errs.join(' | '));
await b.close(); srv.close();
console.log(fails ? `\n${fails} FAIL` : '\nвсё ок');
process.exit(fails ? 1 : 0);
