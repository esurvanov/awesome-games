// Регрессии для трёх инвариантов движка (см. docs/PLAN.md — движок отделён от контента, а тело/машина/время/
// сохранение — общие для всех ролей и сцен правила). Headless-прогон в Node (без браузера), как sim-queue.js.
//   node tests/invariants.js
import { loadGame } from './game.js';
const L = loadGame();
const { CONTENT } = L.use('content/index');
const { World } = L.use('sim/world');
const { check, apply, buyPrice } = L.use('sim/rules');

let fails = 0;
const ok = (cond, msg, extra = '') => { console.log((cond ? '  ok  ' : '  FAIL') + ' ' + msg + (extra !== '' ? '  ' + extra : '')); if (!cond) fails++; };

const newGame = (seed = 1) => { const w = new World(CONTENT, { seed }); w.busy = () => false; w.init('artyom'); return w; };

// ═══ 1 · Тело и машина: одна проверка «за рулём» (world.playerDrives) ═══

{
  const w = newGame(1);
  w.player.inCar = false; // вышел, машина осталась в очереди
  const s0 = w.pcar.s;
  const km = w.advance(6); // объезд/эскорт — как fx.advance в events.js
  ok(km === 0 && w.pcar.s === s0, 'advance() не двигает машину без водителя внутри');
}
{
  const w = newGame(2);
  w.player.inCar = false;
  const n0 = w.queue.cars.length;
  const moved = w.shiftPlaces(-1); // «пропустить соседа» — как fx.places
  ok(moved === 0 && w.queue.cars.length === n0, 'shiftPlaces() не двигает машину без водителя внутри');
}
{
  const w = newGame(3);
  w.player.inCar = false;
  const added = w.addPassenger('kirill');
  ok(added === false, 'addPassenger() не сажает пассажира без водителя внутри');
}
{
  // события с fx, которые двигают/наполняют машину, должны требовать when:{inCar:true} (F4)
  const w = newGame(4);
  w.player.money.usd = 1000;
  w.pcar.s = w.queue.gateS + 10000; // 10 км до шлагбаума — внутри диапазонов escort/skip_offer
  const gated = ['escort', 'skip_offer', 'cutter', 'kirill_lift', 'fuel_low'];
  for (const id of gated) {
    const e = CONTENT.EVENTS.find(x => x.id === id); if (!e) { ok(false, id + ' — событие не найдено'); continue; }
    ok(!!e.when?.inCar, id + ': when.inCar помечен в контенте');
  }
  w.player.inCar = true;
  const inCarOk = check(CONTENT.EVENTS.find(e => e.id === 'escort').when, w, {});
  w.player.inCar = false;
  const outCarBlocked = check(CONTENT.EVENTS.find(e => e.id === 'escort').when, w, {});
  ok(inCarOk === '' && outCarBlocked !== '', 'escort: доступно за рулём, заблокировано пешком', `«${inCarOk}» → «${outCarBlocked}»`);
}
{
  // машина игрока доходит до шлагбаума без водителя — не должна «пройти» сама (F2). Воспроизводим ровно то,
  // что делает queue.js перед вызовом onPass: убирает машину из очереди и уже посчитала её прошедшей.
  const w = newGame(5);
  const car = w.pcar; car.s = w.queue.gateS;
  w.player.inCar = false;
  const i = w.queue.cars.indexOf(car); w.queue.cars.splice(i, 1);
  const passedBefore = w.queue.passed.cars; w.queue.passed.cars++; w.queue.passed.people += car.n;
  w.onPass(car);
  ok(!w.ended, 'onPass(): брошенная машина у шлагбаума не заканчивает игру');
  ok(w.queue.passed.cars === passedBefore, 'onPass(): счётчик прошедших откатывается — брошенная машина не в счёт');
  ok(w.queue.cars.includes(car) && car.stall === 1, 'onPass(): машина возвращена в очередь, стоит стальная');
}
{
  // «Выйти» из машины во сне — сперва будит (не оставляет спать посреди шага, ходьбы «во сне» тоже нет)
  const w = newGame(6);
  w.player.sleeping = true;
  const r = w.doAction({ op: 'leaveCar', time: 0 }, { kind: 'own', car: w.pcar });
  ok(!w.player.sleeping, '«Выйти» будит спящего игрока, прежде чем высадить его из машины');
}
{
  // машина стоит с той секунды, как водитель вышел — без порога по расстоянию (leaveCar 90 м убран из гейта)
  const w = newGame(7);
  const car = w.pcar;
  w.player.inCar = false; // позиция игрока (рядом или далеко) больше не имеет значения — сравнить нечего
  w.stepPlayer(10, car.s);
  ok(car.stall === 1, 'car.stall=1 сразу, как только игрок не за рулём — независимо от расстояния до машины');
  w.player.inCar = true;
  w.stepPlayer(10, car.s);
  ok(car.stall === 0, 'car.stall=0, пока игрок за рулём');
}
{
  // сцена КПП не пропадает после объезда, который сажает машину у самого шлагбаума в одном шаге (content-graph 4.3 / F4)
  const w = newGame(8);
  w.pcar.s = w.queue.gateS + 12000;
  w.advance(12); // ≈ escort/skip_offer: игрок за рулём (по умолчанию inCar=true)
  ok(w.pcar.hold === 1, 'машина держится у шлагбаума сразу после объезда — до того, как отработает dog_question');
  let fired = 0, endedBeforeFire = false;
  w.bus.on('event', e => { if (e.e.id === 'dog_question') { fired++; endedBeforeFire = !!w.ended; w.choose(e, e.e.choices[0]); } });
  for (let i = 0; i < 2000 && !w.ended && fired === 0; i++) w.step(10);
  // если бы машина проскочила КПП раньше сцены, playerDrives()===true оборвал бы игру концовкой «car» —
  // цикл выше остановился бы по !w.ended с fired всё ещё 0 (сцена так и не сработала бы). После того как
  // dog_question отработал, доигрывать (fx.time → skipTime) и закончить игру — это уже нормальный, ожидаемый ход.
  ok(fired === 1 && !endedBeforeFire, 'сцена «А военник есть?» срабатывает ровно один раз, раньше, чем машина могла бы пройти КПП', 'сработала ' + fired + ' раз(а)');
}

// ═══ 2 · Одни часы: ходьба стоит игрового времени пропорционально масштабу, а не кадру/паузе ═══
// Формула — та же, что G.isWalking()/G.scale() в main.js: пока у игрока есть цель ходьбы (p.tx) и он не за
// рулём, эффективный масштаб — как на ×1, что бы ни было выставлено на спидометре (иначе шаг стоил бы 0 часов
// на паузе и десятки часов на ×16 — F5). Тут это воспроизведено на голом World, без DOM/main.js.
{
  const T = CONTENT.TUNING.time;
  const walkCost = (scaleIndex, distance = 220) => {
    const w = newGame(9); w.player.inCar = false; w.syncPlayerPos();
    const x0 = w.player.x, y0 = w.player.y;
    w.walkTo(x0 + distance, y0);
    const t0 = w.clock.t, base = T.scales[scaleIndex], frameDt = 1 / 30;
    let acc = 0, realT = 0, guard = 0;
    while (w.player.tx != null && realT < 90 && guard++ < 300000) {
      const scale = (w.player.tx != null && !w.player.inCar) ? 1 : base;
      acc += frameDt * T.realToGame * scale;
      while (acc >= T.step) { w.step(T.step); acc -= T.step; }
      w.frame(frameDt);
      realT += frameDt;
    }
    return { arrived: w.player.tx == null, gameT: w.clock.t - t0, realT };
  };
  const r1 = walkCost(1), r16 = walkCost(3), r0 = walkCost(0);
  ok(r1.arrived && r16.arrived && r0.arrived, 'дошёл во всех трёх прогонах (×1, ×16, пауза)', `${r1.realT.toFixed(1)}с / ${r16.realT.toFixed(1)}с / ${r0.realT.toFixed(1)}с реальных`);
  const rel = (a, b) => Math.abs(a - b) / Math.max(a, b, 1);
  ok(rel(r1.gameT, r16.gameT) < 0.1, 'игровое время на тот же путь одинаково на ×1 и ×16 (не в 16 раз больше)', `${(r1.gameT / 60).toFixed(1)} мин vs ${(r16.gameT / 60).toFixed(1)} мин`);
  ok(rel(r1.gameT, r0.gameT) < 0.1, 'игровое время на тот же путь одинаково на ×1 и на паузе (не бесплатно)', `${(r1.gameT / 60).toFixed(1)} мин vs ${(r0.gameT / 60).toFixed(1)} мин`);
  ok(r0.gameT > 0, 'ходьба на паузе не бесплатна (0 игровых секунд недопустимо)', (r0.gameT).toFixed(0) + ' игр. с');
}
{
  // F15: заявленное время сделки (лавка/обмен/«дать») действительно проходит — а не 0, как раньше (return
  // до строки a.time). Тестируем ту же цепочку doAction → res.ui.time → skipTime, что и js/ui/bag.js.
  const w = newGame(10);
  const sel = w.econ.sellers.find(s => s.npc === 'zaur') || w.econ.sellers[0];
  const buyAction = CONTENT.ACTIONS.find(a => a.id === 'buy');
  const r = w.doAction(buyAction, { kind: 'seller', seller: sel });
  ok(r.ui && r.ui.kind === 'shop' && r.ui.time === buyAction.time, 'открытие лавки несёт заявленное время сделки (a.time), а не тратит его сразу');
  const t0 = w.clock.t;
  const g = sel.goods[0], price = w.econ.price(sel, g, 0);
  const buyRes = w.buy(sel, g, { method: 'cash_rub', cur: 'rub_cash', amount: price });
  if (buyRes && buyRes.out === '') w.skipTime(r.ui.time); // именно так это теперь делает js/ui/bag.js
  ok(w.clock.t - t0 >= r.ui.time * 60 - 1, 'покупка списывает заявленное время сделки', (w.clock.t - t0) / 60 + ' мин из ' + r.ui.time);
}
{
  // F9: «Поговорить» больше не бесконечный бесплатный источник доверия/спокойствия
  const w = newGame(11);
  const npc = 'lekha';
  const tg = { kind: 'car', npc, car: w.npcCar(npc) };
  const trust0 = w.trustOf(npc);
  w.doAction(CONTENT.ACTIONS.find(a => a.id === 'talkCar'), tg);
  const trust1 = w.trustOf(npc);
  w.doAction(CONTENT.ACTIONS.find(a => a.id === 'talkCar'), tg); // сразу второй раз, без паузы
  const trust2 = w.trustOf(npc);
  ok(trust1 > trust0, 'первый разговор даёт доверие');
  ok(trust2 === trust1, 'повторный разговор без перерыва — без доверия (не бесконечный источник)', `${trust0} → ${trust1} → ${trust2}`);
}

// ═══ 3 · Сохранение/загрузка восстанавливают тот же мир ═══

function seedPlay(seed, hours) {
  const w = newGame(seed);
  w.bus.on('event', e => { const opts = e.e.choices.filter(c => !w.choiceBlock(c, e) && !c.fx?.end); const ch = opts[seed % Math.max(1, opts.length)] || e.e.choices[0]; w.choose(e, ch); });
  const stopT = w.clock.t + hours * 3600;
  while (w.clock.t < stopT && !w.ended) w.step(10);
  return w;
}
for (const seed of [21, 34, 47]) {
  const w = seedPlay(seed, 6 + (seed % 5));
  if (w.ended) { ok(true, `сид ${seed}: игра уже кончилась раньше точки сохранения — пропуск`); continue; }
  // сдвигаем продавцов и ряд от «свежего» состояния, чтобы пересборка из RNG (старый баг) стало бы заметно
  const sel = w.econ.sellers[seed % w.econ.sellers.length];
  sel.stock[sel.goods[0]] = Math.max(0, (sel.stock[sel.goods[0]] || 0) - 3);
  sel.demand[sel.goods[0]] = 1.27;
  w.pcar.l2 = 1; w.pcar.lane = Math.min(1, w.queue.lanes - 1);
  const before = JSON.parse(JSON.stringify(w.econ.sellers));
  const saved = JSON.parse(JSON.stringify(w.save())); // настоящий JSON-круг — как localStorage, не общие ссылки
  const w2 = World.load(CONTENT, saved);
  ok(JSON.stringify(w2.econ.sellers) === JSON.stringify(before), `сид ${seed}: продавцы после загрузки — тот же снимок (не пересобраны из RNG)`);
  const car2 = w2.queue.cars.find(c => c.pl);
  ok(!!car2 && car2.l2 === w.pcar.l2 && car2.lane === w.pcar.lane, `сид ${seed}: ряд (l2/lane) машины игрока сохранён`, `l2 ${w.pcar.l2}→${car2?.l2}, lane ${w.pcar.lane}→${car2?.lane}`);
  ok(w2.clock.t === w.clock.t && w2.player.money.rub_cash === w.player.money.rub_cash, `сид ${seed}: время и деньги совпадают`);
}
{
  // «идёт к машине» переживает save/load и сам садится по прибытии (p.goal вместо колбэка p.then)
  const w = newGame(55);
  w.player.inCar = false; w.syncPlayerPos();
  w.player.x -= 40; // отошёл от машины
  w.doAction({ op: 'toCar', time: 0 }, { kind: 'own', car: w.pcar });
  ok(w.player.goal && w.player.goal.type === 'car' && w.player.tx != null, '«В машину» ставит серialisable-цель (p.goal), не колбэк');
  const saved = JSON.parse(JSON.stringify(w.save()));
  const w2 = World.load(CONTENT, saved);
  ok(w2.player.goal && w2.player.goal.type === 'car', 'цель «дойти до машины» пережила save/load');
  let guard = 0; while (w2.player.tx != null && guard++ < 100000) w2.frame(1);
  ok(w2.player.inCar === true, 'после загрузки игрок доходит до машины и сам садится (F6)');
}

// ═══ 4 · Экономика: пустой склад не списывает деньги и не сжигает часовой лимит (F7) ═══
{
  const w = newGame(60);
  const sel = w.econ.sellers.find(s => s.npc === 'zaur'), g = sel.goods[0];
  sel.stock[g] = 0;
  const before = w.player.money.rub_cash, price = w.econ.price(sel, g, 0);
  const r = w.buy(sel, g, { method: 'cash_rub', cur: 'rub_cash', amount: price });
  ok(r && r.out === 'Кончилось', 'buy(): пустой склад — «Кончилось», а не тихий провал', JSON.stringify(r));
  ok(w.player.money.rub_cash === before, 'buy(): деньги не списаны, когда товара нет', `${before} → ${w.player.money.rub_cash}`);
}
{
  const w = newGame(61), sel = w.econ.sellers.find(s => s.npc === 'madina'), g = 'tea'; // priceMul 0 — «бесплатно»
  sel.stock[g] = 0;
  const r = w.buy(sel, g, { method: 'free' });
  ok(r && r.out === 'Кончилось', 'buy(): бесплатная точка тоже честно «Кончилось» на пустом складе (не «Уже брал»)');
  sel.stock[g] = 40; // склад пополнился — часовой лимит не должен был сгореть зря на пустом складе
  const r2 = w.buy(sel, g, { method: 'free' });
  ok(r2 && r2.out === '', 'buy(): часовой лимит бесплатного не потрачен впустую, пока склад был пуст');
}

// ═══ 5 · Мошеннический перевод требует сеть — как и легальный перевод картой (F14) ═══
{
  const w = newGame(62);
  w.player.money.rub_card = 50000; w.player.needs.charge = 50;
  const scam = CONTENT.EVENTS.find(e => e.id === 'scam_escort'), ch = scam.choices.find(c => c.label.includes('Перевести'));
  w.pcar.s = w.queue.gateS + 3000; // 3 км до КПП — внутри мёртвой зоны 2,4–4,2 км (ROUTE.signal)
  ok(!w.signal(), 'в зоне 2,4–4,2 км от КПП сети нет (ROUTE.signal)', (w.playerKpp() / 1000).toFixed(1) + ' км');
  const why = w.choiceBlock(ch, { npc: null, who: null, vars: {}, icon: scam.icon });
  ok(why !== '', '«Перевести 15 000» мошеннику заблокирован без сети — так же, как перевод в лавке', `«${why}»`);
  w.pcar.s = w.queue.gateS + 8000; // 8 км — сеть есть
  const why2 = w.choiceBlock(ch, { npc: null, who: null, vars: {}, icon: scam.icon });
  ok(why2 === '', 'при сети выбор снова доступен', `«${why2}»`);
}

// ═══ 6 · Очередь: разброс времени прохода КПП между сидами (content-graph 3.x — раньше 0 разброса) ═══
// throughJitter() в queue.js — сид-детерминированный медленный шум пропуска КПП (не по каждому вызову step,
// иначе за десятки часов он сам себя гасит и час прохода не сдвигается — см. комментарий в queue.js).
{
  const REF = { '23 06': 1715, '24 14': 2300, '25 08': 2500, '26 12': 3500, '27 10': 5000, '28 12': 3300, '29 12': 3000, '30 12': 2500 };
  const endTStr = '2022-09-30 23:00';
  const seeds = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112];
  const waited = [];
  // допуск REF — широкий (не тест на баланс календаря, только «житер не разгоняет существующий разрыв»):
  // тот же разрыв (≈35–40 %) есть и без throughJitter вовсе — это заранее известное расхождение
  // календарной кривой и симуляции (content-graph.md, аудит), не то, что чинит эта задача
  let maxRel = 0;
  for (const seed of seeds) {
    const w2 = new World(CONTENT, { seed });
    w2.clock.t = w2.clock.parse(CONTENT.CALENDAR.worldStart); w2.econ.build();
    for (let i = 0; i < CONTENT.TUNING.queue.startCars; i++) w2.queue.spawnCar();
    const endT = w2.clock.parse(endTStr), rows = [];
    while (w2.clock.t < endT) {
      w2.step(120, true);
      const lb = w2.clock.label(), key = lb.date.split(' ')[0] + ' ' + lb.time.slice(0, 2);
      if (lb.time.endsWith(':00') && REF[key] && !rows.find(r => r[0] === key)) rows.push([key, w2.queue.cars.length]);
    }
    for (const [key, val] of rows) maxRel = Math.max(maxRel, Math.abs(val - REF[key]) / REF[key]);

    const w = newGame(seed);
    w.bus.on('event', e => { const opts = e.e.choices.filter(c => !w.choiceBlock(c, e) && !c.fx?.end); const ch = opts[opts.length - 1] || e.e.choices[0]; if (ch) w.choose(e, ch); });
    const endT2 = w.clock.parse('2022-09-30 23:59');
    while (w.clock.t < endT2 && !w.ended) { w.step(10); if (w.player.sleeping) w.player.sleeping = false; }
    waited.push((w.clock.t - w.player.startT) / 3600);
  }
  ok(maxRel < 0.5, `sim-queue.js REF: житер не уводит очередь дальше заранее известного разрыва (< 50 %)`, `max ${(maxRel * 100).toFixed(0)} %`);
  const mean = waited.reduce((a, b) => a + b, 0) / waited.length;
  const std = Math.sqrt(waited.reduce((a, b) => a + (b - mean) ** 2, 0) / waited.length);
  ok(std > 1.0, `${seeds.length} сидов: время прохода КПП больше не одна и та же минута — есть разброс`, `mean ${mean.toFixed(1)} ч, std ${std.toFixed(2)} ч, ${Math.min(...waited).toFixed(1)}–${Math.max(...waited).toFixed(1)} ч`);
}

// ═══ 7 · Пространственная связность (audit 3-spatial.md) — road.walkable() одна на ходьбу/авто-подход/клик ═══

{
  // мосты — коридор через реку, а не стена (finding 1): по всем полосам проходимы целиком
  const w = newGame(70);
  ok(w.road.bridges.length === 3, 'мостов найдено 3 (по пересечению оси Терека и дороги)', w.road.bridges.map(b => (b.s / 1000).toFixed(2)).join(' · '));
  for (const b of w.road.bridges) {
    let blocked = false;
    for (let s = b.s - 30; s <= b.s + 30 && !blocked; s += 2) for (const off of [-5.4, -1.9, 1.9, 5.4]) {
      const q = w.road.at(s, off); if (!w.road.walkable(q.x, q.y)) blocked = true;
    }
    ok(!blocked, `мост на ${(b.s / 1000).toFixed(1)} км проходим по всем полосам`);
  }
}
{
  // вне моста река остаётся стеной (finding 1, «от противного»): мост — исключение, не отмена реки целиком
  const w = newGame(71);
  const s = 6100, q = w.road.at(s, w.road.RIV[w.road.idx(s)]); // прямо в русле, далеко от любого моста
  ok(!w.road.bridges.some(b => Math.abs(b.s - s) < 200), '6,1 км — не рядом с мостом (проверка условия теста)');
  ok(!w.road.walkable(q.x, q.y), 'вне моста русло Терека непроходимо (6,1 км)');
}
{
  // КПП — не насквозь: сразу за буфером у шлагбаума пешего дальше не пускает (finding 10, 18)
  const w = newGame(72);
  const p0 = w.road.at(0, 0), tx = w.road.NY[0], ty = -w.road.NX[0];
  const near = w.road.walkable(p0.x - tx * 10, p0.y - ty * 10), far = w.road.walkable(p0.x - tx * 60, p0.y - ty * 60);
  ok(near && !far, 'у шлагбаума ещё можно стоять, а полсотни метров дальше — уже нельзя', `10 м: ${near}, 60 м: ${far}`);
}
{
  // хвост дороги не бесконечен: за буфером у конца — пустое ущелье, дальше не пускаем (finding 16, 18)
  const w = newGame(73);
  const iEnd = w.road.idx(w.road.len), pEnd = w.road.at(w.road.len, 0), tx = w.road.NY[iEnd], ty = -w.road.NX[iEnd];
  const near = w.road.walkable(pEnd.x + tx * 20, pEnd.y + ty * 20), far = w.road.walkable(pEnd.x + tx * 100, pEnd.y + ty * 100);
  ok(near && !far, 'хвост дороги блокирует пешего дальше буфера — не уйти в пустое ущелье', `+20 м: ${near}, +100 м: ${far}`);
}
{
  // ловушка: если сам стоишь не там (старое сохранение, обходной клик) — первый шаг наружу не блокирован (finding 9)
  const w = newGame(74);
  const stuck = w.road.at(6100, w.road.RIV[w.road.idx(6100)]), toRoad = w.road.at(6100, 0);
  ok(!w.road.walkable(stuck.x, stuck.y), 'стартовая точка теста действительно непроходима (проверка условия)');
  const step = w.road.walkableTarget(stuck.x, stuck.y, toRoad.x, toRoad.y);
  ok(!!step, 'из непроходимой точки можно шагнуть куда угодно — не заперт навсегда');
}
{
  // «К машине» после объезда на несколько км идёт вдоль дороги (road.at), не по прямой через Терек и склоны
  // (finding 11) — весь путь остаётся в пределах дорожного полотна (без глубокого проникновения в откос/реку)
  const w = newGame(75);
  w.player.inCar = false; w.syncPlayerPos();
  w.pcar.s = Math.max(w.queue.gateS, w.pcar.s - 8000); // объезд/эскорт увёл машину на 8 км вперёд
  w.walkToCar();
  ok(!!w.player.path && w.player.path.length > 1, '«К машине» строит маршрут из нескольких точек (не прямая через полочереди)', (w.player.path?.length || 0) + ' точек');
  let guard = 0, maxOff = 0;
  while (w.player.tx != null && guard++ < 300000) { w.frame(1); maxOff = Math.max(maxOff, Math.abs(w.road.project(w.player.x, w.player.y).off)); }
  ok(w.player.inCar === true, 'дошёл до машины и сам сел', 'шагов ' + guard);
  ok(maxOff < 12, 'весь путь — у оси дороги, без ухода в реку/скалы', 'макс. отклонение от оси ' + maxOff.toFixed(1) + ' м');
}
{
  // targeting: продавец у КПП, где вокруг сотни пеших, всё равно виден как цель (finding 7) — источник
  // независим от лимита прорисовки 3D (peopleNear, а не «кого нарисовал рендер в этом кадре»)
  const w = newGame(76);
  const sel = w.econ.sellers.find(s => s.s < 1500) || w.econ.sellers[0];
  for (let i = 0; i < 300; i++) w.queue.peds.push({ id: w.queue.nextId++, s: sel.s + (i % 40) - 20, lat: 5, st: 1, bike: 0, ph: 0 });
  const near = w.peopleNear(sel.x, sel.y, 30);
  ok(near.some(x => x.tg.kind === 'seller' && x.tg.seller === sel), 'продавец находится через peopleNear() среди 300 пеших рядом', near.length + ' целей в радиусе');
}
{
  // Гена — своя машина, отдельная от Оли, а не переписана друг на друга (finding 8)
  const w = newGame(77);
  const gCar = w.npcCar('gena'), oCar = w.npcCar('olya');
  ok(!!gCar && !!oCar && gCar.id !== oCar.id, 'у Гены своя машина, отдельная от машины Оли', `gena=${gCar?.id}, olya=${oCar?.id}`);
  ok(gCar?.npc === 'gena' && oCar?.npc === 'olya', 'машины подписаны верными хозяевами (не переписаны друг на друга при клоне слота)');
}

// ═══ 8 · Контент: рибаланс шорткатов (audit content-graph 4.1/4.3, meaning.md 3.1/3.2/3.3, playthroughs.md F1) ═══

{
  // escort: платный выбор больше не гарантированный мгновенный рывок на 12 км без риска — единственный
  // по-настоящему выгодный платный вариант (playthroughs.md: «эскорт — единственный, который реально
  // экономит время, помощь всегда наказана»). Провал — деньги теряются, без объезда, с честным следом в итоге
  const ev = CONTENT.EVENTS.find(e => e.id === 'escort');
  const ch = ev.choices.find(c => c.fx.buy);
  ok(!!ch.fx.risk, 'escort: у платного выбора появился риск (content-graph 4.1 / meaning.md 3.1)');
  ok(ch.fx.risk.p > 0 && ch.fx.risk.p < 1, 'escort: вероятность провала в (0,1)', String(ch.fx.risk.p));

  const w1 = newGame(94); w1.player.money.usd = 2000; w1.pcar.s = w1.queue.gateS + 10000; w1.queue.resort();
  const s0 = w1.pcar.s, usd0 = w1.player.money.usd;
  w1.rng.chance = () => true; // форсируем провал
  apply(ch.fx, w1, { npc: null, vars: {} });
  ok(w1.pcar.s === s0, 'escort (провал): машина не продвинулась — нет объезда без результата');
  ok(w1.player.money.usd < usd0, 'escort (провал): доллары всё равно списаны', `${usd0} → ${w1.player.money.usd}`);
  ok(w1.ledger.gave.length > 0, 'escort (провал): в итоге остаётся честный след о деньгах без толку (content-graph 1.5/4.1)');

  const w2 = newGame(95); w2.player.money.usd = 2000; w2.pcar.s = w2.queue.gateS + 10000; w2.queue.resort();
  const s0b = w2.pcar.s;
  w2.rng.chance = () => false; // гарантированный успех
  apply(ch.fx, w2, { npc: null, vars: {} });
  ok(w2.pcar.s < s0b, 'escort (успех): машина по-прежнему продвигается объездом, как раньше', `${(s0b - w2.pcar.s).toFixed(0)} м`);
  ok(w2.ledger.harmed.length > 0, 'escort (успех): «вся очередь» остаётся в итоге, как раньше');
}
{
  // moto: раньше 20 000 ₽ и мгновенный бесплатный конец (meaning.md: исследование — 30–100 тыс. ₽).
  // Теперь: цена по исследованию, картой (иначе почти всегда «мало денег» на старте — как было у
  // skip_offer до фикса), время и цена по нуждам вместо 0, свой риск — как у escort
  const w = newGame(90); w.player.money.rub_card = 200000; w.player.needs.charge = 50;
  w.pcar.s = w.queue.gateS + 2000; // 2 км — ближний край окна события
  const ev = CONTENT.EVENTS.find(e => e.id === 'moto');
  const ch = ev.choices.find(c => c.fx.end);
  const price = -(ch.fx.money.rub_cash || 0) || -(ch.fx.money.rub_card || 0);
  ok(price >= 30000 && price <= 100000, 'moto: цена в исследованном диапазоне 30–100 тыс. ₽ (было 20 000)', price + ' ₽');
  ok(ch.fx.money.rub_cash === undefined, 'moto: платится не наличными (иначе почти всегда «мало денег» на старте — как было у skip_offer)');
  ok(ch.fx.time > 0, 'moto: время больше не 0 — платный побег больше не мгновенный', ch.fx.time + ' мин');
  ok((ch.fx.needs?.warmth < 0 || ch.fx.needs?.sleep < 0), 'moto: есть цена по нуждам, не только деньги');
  ok(!!ch.fx.risk && ch.fx.risk.p > 0 && ch.fx.risk.p < 1, 'moto: есть свой риск (мигалки — не единственный шорткат с риском)', String(ch.fx.risk?.p));

  // даже с этим временем «призрак» брошенной машины (playerDrives() всё ещё true — content-graph 4.1/F4
  // семья багов) не успевает доехать до шлагбаума и подменить конец «moto» концом «car»: скорость
  // приближения к шлагбауму у первых км определяет пропускная способность КПП (env.through), а не шаг
  // подтягивания — проверено эмпирически на 20 сидах перед тем, как выбрать это время
  const w2 = newGame(91); w2.player.money.rub_card = 200000; w2.player.needs.charge = 50;
  w2.pcar.s = w2.queue.gateS + 2000; w2.queue.resort();
  w2.rng.chance = () => false; // без риска — гарантированный успех
  const ev2 = w2.prepareEvent(ev);
  w2.choose(ev2, ch);
  ok(w2.ended && w2.ended.id === 'moto', 'moto: концовка действительно «moto», не подменена гонкой с «своей машиной»', w2.ended?.id);
}
{
  // rule_ped «Оставить машину и идти»: раньше мгновенный бесплатный конец, 3 игровых часа, 0 ₽ — доминирующая
  // стратегия (playthroughs.md F1: 48–100 % партий). Теперь — сутки пешком с ценой по теплу/сну
  const ev = CONTENT.EVENTS.find(e => e.id === 'rule_ped');
  const ch = ev.choices.find(c => c.fx.end);
  ok(ch.fx.time >= 600, 'rule_ped «пешком»: время похода — часы, не мгновенно (было 0)', `${ch.fx.time} мин ≈ ${(ch.fx.time / 60).toFixed(1)} ч`);
  ok((ch.fx.needs?.warmth < -10 || ch.fx.needs?.sleep < -10), 'rule_ped «пешком»: заметная цена по теплу/сну — ночь без машины');
  ok(ch.fx.helped === undefined, `rule_ped «пешком»: helped:'никто' убран из fx — «выбор без эффекта» больше не пишет в итог (meaning.md 3.3)`);

  // разовая цена по нуждам — считаем её отдельно, с time:0 (без последующего skipTime): stepPlayer тянет
  // тепло к цели «как в машине», пока p.inCar не сброшен явно (движок это не даёт сделать из fx — за
  // рамками этой задачи, см. content-graph 2.7/F10), поэтому за 24 симулированных часа разовый штраф
  // может быть частично отыгран назад тем же движком — проверяем сам штраф изолированно, а не итог после суток
  const w0 = newGame(97);
  const warmth00 = w0.player.needs.warmth;
  apply({ ...ch.fx, time: 0, end: undefined }, w0, { vars: {} });
  ok(w0.player.needs.warmth < warmth00 - 20, 'rule_ped «пешком»: разовая цена по теплу ощутимая в момент выбора', `${warmth00} → ${w0.player.needs.warmth}`);

  const w = newGame(93);
  const t0 = w.clock.t;
  const ev2 = w.prepareEvent(ev);
  w.choose(ev2, ch);
  ok(w.clock.t - t0 >= ch.fx.time * 60 - 1, 'rule_ped «пешком»: время действительно проходит (skipTime), не мгновенно', `${((w.clock.t - t0) / 60).toFixed(0)} мин`);
  ok(w.ended && w.ended.id === 'walk', 'rule_ped «пешком»: концовка «walk» доходит до конца, не подменяется гонкой с «своей машиной»', w.ended?.id);
}
{
  // skip_offer «Заплатить»: цена по кривой 'bypass' (30–45 тыс.) была выше стартовых 28 000 наличными
  // почти всегда (content-graph 4.1: заблокирован в 167 из 168 показов) — торг (mul) должен сделать
  // цену иногда по карману в окне роли (25–27.09), а не структурно мёртвым выбором
  const ev = CONTENT.EVENTS.find(e => e.id === 'skip_offer');
  const ch = ev.choices.find(c => c.fx.buy);
  const startCash = CONTENT.ROLES.find(r => r.id === 'artyom').money.rub_cash;
  let affordableDays = 0;
  const prices = [];
  for (let d = 25; d <= 27; d++) {
    const w = newGame(96 + d);
    w.clock.t = w.clock.parse(`2022-09-${d} 12:00`);
    const price = buyPrice(ch.fx.buy, w);
    prices.push(price);
    if (price <= startCash) affordableDays++;
  }
  ok(affordableDays > 0, 'skip_offer «Заплатить»: цена по карману хотя бы иногда в окне роли 25–27.09 (было 167/168 заблокировано)', `по карману ${affordableDays}/3 дней, цены ${prices.join(' / ')} ₽ (старт ${startCash} ₽)`);
}

console.log(fails ? `\n${fails} FAIL` : '\nвсё ок');
process.exit(fails ? 1 : 0);
