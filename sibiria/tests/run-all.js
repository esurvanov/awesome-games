#!/usr/bin/env node
// Одна команда: все дымовые тесты (smoke*.js) + 3 быстрых прогона бота. Сводка ok/fail в конце.
//   cd tests && npm i && node run-all.js          (или ./run-all.sh)
//   BOT_LIMIT=900 node run-all.js                 — длиннее прогоны бота (игровых секунд бота)
//   ONLY=smoke-ui node run-all.js                 — только тесты, чьё имя содержит подстроку
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const LIMIT = +(process.env.BOT_LIMIT || 420);
const env = Object.assign({}, process.env, {
  SIBIR_URL: process.env.SIBIR_URL || 'file://' + path.resolve(DIR, '../index.html'),
  NODE_OPTIONS: ((process.env.NODE_OPTIONS || '') + ' --require ' + path.join(DIR, '_offline.js')).trim(),
});
fs.mkdirSync(path.join(DIR, 'shots'), { recursive: true });
try { require.resolve('playwright', { paths: [DIR, ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)] }); }
catch (e) { console.error('Нет playwright: cd tests && npm i  (и один раз: npx playwright install chromium, если нет Google Chrome)'); process.exit(2); }

const jobs = fs.readdirSync(DIR).filter(f => /^smoke.*\.js$/.test(f)).sort().map(f => ({ name: f, args: [f] }));
jobs.push({ name: 'ui-overlap.js', args: ['ui-overlap.js'] }); // SPEC-ui §6: 4 размера × S/M/L → 0 наложений
jobs.push({ name: 'coll.js', args: ['coll.js'] }); // подножия вещей, линии героя насквозь, ходоки и стволы, расталкивание
jobs.push({ name: 'visual.js', args: ['visual.js'] }); // 16 эталонных сцен canvas (эталоны: node visual.js --update)
for (const [i, fixBed] of [[1, false], [2, false], [3, true]]) jobs.push({ name: `bot#${i}`, args: ['run.js', JSON.stringify({ tag: 'all' + i, limit: LIMIT, fixBed })], bot: true });
const only = process.env.ONLY;

// признаки провала в выводе: ошибки страницы, FAIL/ERR-строки тестов, ERR внутри лога бота
const BAD = /(PAGEERR|CONSOLE (?!Failed to load resource)|^\s*FAIL\b|^ERR\b|\bERR [A-Za-z]|Error: )/m;
const res = [];
for (const j of jobs) {
  if (only && !j.name.includes(only)) continue;
  const t0 = Date.now();
  const r = spawnSync(process.execPath, j.args, { cwd: DIR, env, encoding: 'utf8', timeout: 8 * 60 * 1000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const sec = ((Date.now() - t0) / 1000).toFixed(0);
  let ok = r.status === 0 && !BAD.test(out);
  let note = '';
  if (j.bot) {
    const last = out.trim().split('\n').find(l => l.startsWith('{"res"'));
    try { const o = JSON.parse(last); note = `день ${o.day} · глава ${o.ch} · смертей ${o.res.deaths.length}${o.res.ending ? ' · ' + o.res.ending : ''}`; } catch (e) { ok = false; note = 'нет итога бота'; }
  }
  if (r.error) { ok = false; note = r.error.message; }
  const why = ok ? '' : (out.split('\n').filter(l => BAD.test(l)).slice(0, 4).join('\n      ') || out.trim().split('\n').slice(-4).join('\n      '));
  res.push({ ok, name: j.name, sec, note, why });
  console.log(`${ok ? '✅ ok  ' : '❌ fail'}  ${j.name.padEnd(16)} ${String(sec).padStart(4)} с  ${note}${why ? '\n      ' + why : ''}`);
}
const bad = res.filter(r => !r.ok).length;
console.log(`\nИтого: ${res.length - bad} ok · ${bad} fail`);
process.exit(bad ? 1 : 0);
