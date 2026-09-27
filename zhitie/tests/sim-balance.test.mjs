// 🧠 Мозг: безголовые прогоны «3 игровых дня» (заглушка и настоящий Мир) + таблица баланса.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runDays, balanceTable } from './sim-harness.mjs';

const CONTRACT_ANIMS = new Set('idle walk run sit sitIdle sitTalk standUp eat drink sleep lieDown getUp talk phone wave laugh angry cry dance cook wash pickup interact repair read watchTV useComputer toilet shower exercise no yes'.split(' '));

function checkRun(r, label) {
  console.log(`\n── ${label} ──\n${balanceTable(r, 3)}`);
  const { state, log, avgMood } = r;
  for (const s of state.sims.filter(s => !s.npc)) {
    assert.equal(s.dead, false, `${s.name} жив`);
    assert.ok(s.brain.stats.work > 0, `${s.name} ходил на работу`);
    assert.ok(s.brain.earned >= 240, `${s.name} получил зарплату ≥ 2 смен (${s.brain.earned})`);
    assert.ok((s.brain.stats.idle ?? 0) < 0.3 * 3 * 1440, `${s.name} не залипает`);
  }
  assert.ok(avgMood > 0, `среднее настроение > 0 (${avgMood.toFixed(1)})`);
  assert.equal(log.fails, 0, 'без луж/обмороков');
  assert.ok(log.notify.some(n => n.text.startsWith('Пришли счета')), 'пришли счета на 3-й день');
  assert.equal(log.deaths.length, 0, 'без смертей');
  for (const a of log.anims) assert.ok(CONTRACT_ANIMS.has(a), `анимация из CONTRACT: ${a}`);
}

test('3 дня, заглушка Мира: двое живы, работают, настроение > 0', async () => {
  checkRun(await runDays({ world: 'stub' }), 'заглушка');
});

test('3 дня, настоящий Мир + стартовый дом', async () => {
  checkRun(await runDays({ world: 'real' }), 'настоящий Мир');
});

test('детерминизм: одинаковый сид → одинаковый итог', async () => {
  const a = await runDays({ world: 'stub', days: 1, seed: 5 });
  const b = await runDays({ world: 'stub', days: 1, seed: 5 });
  assert.equal(JSON.stringify(a.state.sims), JSON.stringify(b.state.sims));
});

test('устойчивость: 5 сидов × 3 дня в настоящем Мире без смертей', async () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const r = await runDays({ world: 'real', seed });
    for (const s of r.state.sims.filter(s => !s.npc)) assert.equal(s.dead, false, `seed ${seed}: ${s.name}`);
    assert.ok(r.avgMood > 0, `seed ${seed}: mood ${r.avgMood.toFixed(1)}`);
  }
});
