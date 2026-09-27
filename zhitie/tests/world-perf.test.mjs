// Бенчмарк findPath: цель < 1 мс на типичный путь по участку 30×30
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../js/core/state.js';
import { createBus } from '../js/core/events.js';
import * as W from '../js/world/index.js';

test('findPath быстрый на стартовом доме', () => {
  const s = createState(), bus = createBus();
  W.loadStartLot(s, bus);
  const cases = [
    [{ x: 0, y: 29 }, [{ x: 17, y: 13 }]],                 // с улицы к унитазу
    [{ x: 10, y: 13 }, [{ x: 20, y: 18 }]],                // из спальни к стойке
    [{ x: 0, y: 0 }, [{ x: 29, y: 29 }]],                  // угол в угол вокруг дома
    [{ x: 19, y: 14 }, [{ x: 3, y: 27 }]],
  ];
  for (let i = 0; i < 200; i++) for (const [a, g] of cases) W.findPath(s, 0, a, g);   // прогрев + кэш
  const N = 2000, t0 = performance.now();
  for (let i = 0; i < N; i++) { const [a, g] = cases[i % cases.length]; assert.ok(W.findPath(s, 0, a, g).reached); }
  const ms = (performance.now() - t0) / N;
  console.log(`findPath: ${(ms * 1000).toFixed(1)} мкс/путь`);
  assert.ok(ms < 1, `${ms} мс`);
  // холодный путь (после lot:changed — пересборка сетки)
  const t1 = performance.now();
  for (let i = 0; i < 100; i++) { W.invalidate(); W.findPath(s, 0, cases[0][0], cases[0][1]); }
  const cold = (performance.now() - t1) / 100;
  console.log(`findPath с пересборкой сетки: ${(cold * 1000).toFixed(1)} мкс`);
  assert.ok(cold < 5);
});
