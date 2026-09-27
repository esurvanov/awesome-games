// Headless-прогон симуляции в Node (без браузера): размер очереди по дням против опорных точек timeline.md,
// ожидание игрока, скорость шага. node tests/sim-queue.js
import { loadGame } from './game.js';
const L = loadGame();
const { CONTENT } = L.use('content/index');
const { World } = L.use('sim/world');
const REF = { '23 06': 1715, '24 14': 2300, '25 08': 2500, '26 12': 3500, '27 10': 5000, '28 12': 3300, '29 12': 3000, '30 12': 2500 };
const t0 = performance.now();
const w = new World(CONTENT);
w.busy = () => false;
w.init('artyom');
console.log('presim ms', Math.round(performance.now() - t0), 'cars', w.queue.cars.length, 'player ahead', w.queue.ahead(w.pcar), 'km', (w.pcar.s / 1000).toFixed(1));
let ev = 0; w.bus.on('event', e => { ev++; const ok = e.e.choices.filter(c => !w.choiceBlock(c, e) && !c.fx?.end && !c.fx?.advance && !c.fx?.buy); const ch = ok[ok.length - 1]; if (ch) w.choose(e, ch); });
const rows = [];
const t1 = performance.now(); let steps = 0;
const endT = w.clock.parse('2022-09-30 23:00');
let passedAt = null;
w.bus.on('end', s => { if (!passedAt) passedAt = w.clock.label(); });
const w2 = new World(CONTENT); // отдельный мир без игрока — чистая очередь
w2.clock.t = w2.clock.parse(CONTENT.CALENDAR.worldStart); w2.econ.build();
for (let i = 0; i < CONTENT.TUNING.queue.startCars; i++) w2.queue.spawnCar();
while (w2.clock.t < endT) {
  w2.step(120, true);
  const L = w2.clock.label(), key = L.date.split(' ')[0] + ' ' + L.time.slice(0, 2);
  if (L.time.endsWith(':00') && REF[key] && !rows.find(r => r[0] === key)) rows.push([key, w2.queue.cars.length, REF[key], (w2.queue.tailS / 1000).toFixed(1) + ' км']);
}
console.table(rows);
while (w.clock.t < endT && !w.ended) { w.step(10); steps++; if (w.player.sleeping) w.player.sleeping = false; }
const ms = performance.now() - t1;
console.log('player passed at', passedAt, 'waited h', ((w.clock.t - w.player.startT) / 3600).toFixed(1), 'events', ev, 'steps', steps, 'ms/step', (ms / steps).toFixed(3));
console.log('needs', JSON.stringify(w.player.needs, (k, v) => typeof v === 'number' ? Math.round(v) : v), 'money', JSON.stringify(w.player.money));
console.log('ledger', JSON.stringify({ helped: w.ledger.helped.length, gave: w.ledger.gave.length, got: w.ledger.got.length, lost: w.ledger.placesLost }), 'phone', w.phone.msgs.length, 'knows', w.player.knows.size);
const s = JSON.stringify(w.save()); console.log('save KB', (s.length / 1024).toFixed(0));
console.log('prices', JSON.stringify(w.stats.price.bike?.filter((_, i) => i % 12 === 0)), JSON.stringify(w.stats.price.fuel?.filter((_, i) => i % 12 === 0)));
