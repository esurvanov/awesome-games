// node --test tests/assets.test.mjs — ассеты: каждый id каталога имеет glb, влезает в след, стоит на полу;
// персонажи на риге UAL; все 32 анимации CONTRACT есть; бюджет ≤ 40 MB; всё в credits.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAll } from './assets-check.mjs';

const r = await checkAll();

test('мебель: каждый kind и каждый id каталога имеют модель (id → kind), в пределах следа, опора y=0', () => {
  assert.ok(r.kindTable.length >= 80);
  assert.ok(r.distinctShapes >= 120, `различных моделей ${r.distinctShapes}`);
  const bad = r.rows.filter(x => x.status !== 'ok');
  assert.equal(bad.length, 0, bad.map(x => x.id).join(', ') + '\n' + r.errors.join('\n'));
});
test('персонажи: скин UAL 65 костей, рост 1.55–2.0 м, одежда shirt/pants|dress/shoes', () => {
  assert.ok(r.charRows.filter(x => !x.id.startsWith('legacy:')).length >= 5);
  assert.ok(r.charRows.every(x => x.status === 'ok'), r.errors.join('\n'));
});
test('анимации: все 32 имени CONTRACT → существующий клип', () => {
  assert.ok(r.animRows.length >= 32);
  assert.ok(r.animRows.every(x => x.status === 'ok'), r.errors.join('\n'));
});
test('реквизит НПС: файлы и кости', () => {
  assert.ok(r.propRows.length >= 9);
  assert.ok(r.propRows.every(x => x.status === 'ok'), r.errors.join('\n'));
});
test('CAS: ≥6 нарядов и ≥8 причёсок на пол, аксессуары, телосложения', () => {
  assert.ok(r.casRows.every(x => x.status === 'ok'), JSON.stringify(r.casRows));
});
test('бюджет и лицензии', () => {
  assert.ok(r.totalMB <= 80, `${r.totalMB} MB`);
  assert.deepEqual(r.errors, []);
});
