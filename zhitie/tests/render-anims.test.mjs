// node --test tests/render-anims.test.mjs — таблица анимаций Рендера (чистая логика, без браузера)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANIM_NAMES, chain, resolveClip, POSTURE, isUpper } from '../js/render/anims.js';

const CONTRACT = 'idle, walk, run, sit, sitIdle, sitTalk, standUp, eat, drink, sleep, lieDown, getUp, talk, phone, wave, laugh, angry, cry, dance, cook, wash, pickup, interact, repair, read, watchTV, useComputer, toilet, shower, exercise, no, yes'.split(', ');

test('все имена CONTRACT известны', () => assert.deepEqual([...ANIM_NAMES].sort(), [...CONTRACT].sort()));
test('цепочка фолбэков конечна и кончается idle', () => { for (const n of CONTRACT) { const c = chain(n); assert.equal(c.at(-1), 'idle'); assert.ok(c.length < 8); } });
test('только Idle_Loop → любое имя находит клип', () => {
  const clips = [{ name: 'Idle_Loop' }];
  for (const n of CONTRACT) assert.equal(resolveClip(n, clips)?.clip.name, 'Idle_Loop');
});
test('clipMap манифеста главнее встроенной таблицы', () => {
  const clips = [{ name: 'Idle_Loop' }, { name: 'Consume' }, { name: 'Custom_Eat' }];
  assert.equal(resolveClip('eat', clips, { eat: 'Custom_Eat' }).clip.name, 'Custom_Eat');
  assert.equal(resolveClip('eat', clips).clip.name, 'Consume');
});
test('позы: сидячие/лежачие/верхние', () => {
  assert.equal(POSTURE.watchTV, 'sit'); assert.equal(POSTURE.sleep, 'lie'); assert.ok(isUpper('eat')); assert.ok(!isUpper('walk'));
});
