#!/usr/bin/env node
/* perf-compare.mjs — FIX-PERF compare sheet: fps / ms per heavy view (before → after, per preset), QA groups before →
 * after, player-eye views side by side.
 *
 *   node tools/perf-compare.mjs --base <stand result.json> --new <stand result.json (with preset variants)>
 *                               --qa-before stand/qa-fixmotion2 --qa-after stand/<label> [--out stand/perf-compare]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const out = path.resolve(ROOT, opt('out', 'stand/perf-compare'));
const rd = (p) => { try { return JSON.parse(fs.readFileSync(path.resolve(ROOT, p), 'utf8')); } catch (e) { return null; } };
const base = rd(opt('base', '')), nw = rd(opt('new', '')), qa0 = rd(path.join(opt('qa-before', 'stand/qa-fixmotion2'), 'qa.json')), qa1 = rd(path.join(opt('qa-after', ''), 'qa.json'));
fs.mkdirSync(path.join(out, 'img'), { recursive: true });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const VIEWS = ['forest', 'rift_rim', 'station', 'player_rock'];
const NAMES = { forest: '🌲 Лес', rift_rim: '🕳 Край разлома', station: '🏠 Станция', player_rock: '🧍 Пилот на камне' };
const PRE = ['low', 'med', 'high', 'ultra'];
const fpsOf = (r, v, p) => { if (!r || !r.views[v]) return null; if (!p || p === 'high') return r.views[v].fps; const x = r.views[v].variants && r.views[v].variants[p]; return x ? x.fps : null; };
const ms = (f) => (f ? (1000 / f).toFixed(1) : '—');
const maxF = Math.max(200, ...VIEWS.flatMap((v) => PRE.map((p) => fpsOf(nw, v, p) || 0)));
const bar = (f, cls) => `<div class="bar ${cls}" style="width:${Math.min(100, (f || 0) / maxF * 100).toFixed(1)}%"><span>${f ? f.toFixed(0) : '—'}</span></div>`;

// fps rows
const fpsRows = VIEWS.map((v) => `<div class="vrow"><div class="vn">${NAMES[v]}</div><div class="bars">
  ${bar(fpsOf(base, v), 'b0')}${bar(fpsOf(nw, v), 'b1')}<div class="goal" style="left:${(150 / maxF * 100).toFixed(1)}%"></div></div>
  <div class="ms">${ms(fpsOf(base, v))} → <b>${ms(fpsOf(nw, v))}</b> ms</div></div>`).join('');
const preTable = `<table><tr><th></th>${PRE.map((p) => `<th>${p}</th>`).join('')}</tr>${VIEWS.map((v) => `<tr><td>${NAMES[v]}</td>${PRE.map((p) => { const f = fpsOf(nw, v, p); return `<td class="${f >= 150 ? 'ok' : f ? 'lo' : ''}">${f ? f.toFixed(0) : '—'}<small>${ms(f)} ms</small></td>`; }).join('')}</tr>`).join('')}</table>`;

// QA groups
const gmap = (q) => Object.fromEntries(((q && q.groups) || []).map((g) => [g.g, g]));
const G0 = gmap(qa0), G1 = gmap(qa1), gnames = [...new Set([...Object.keys(G0), ...Object.keys(G1)])];
const qaRows = gnames.map((g) => { const a = G0[g], b = G1[g], fa = a ? a.fail : null, fb = b ? b.fail : null, st = fb === null ? '' : fb < fa ? 'ok' : fb > fa ? 'bad' : 'eq';
  return `<tr class="${st}"><td>${esc(g)}</td><td>${a ? `${a.fail} / ${a.n}` : '—'}</td><td>${b ? `${b.fail} / ${b.n}` : '—'}</td><td>${st === 'ok' ? '▲' : st === 'bad' ? '▼' : st === 'eq' ? '＝' : ''}</td></tr>`; }).join('');

// eye views side by side
const eye0 = path.resolve(ROOT, opt('qa-before', 'stand/qa-fixmotion2'), 'eye'), eye1 = qa1 ? path.resolve(ROOT, opt('qa-after'), 'eye') : null;
const shots = fs.existsSync(eye0) ? fs.readdirSync(eye0).filter((f) => /^[a-z_]+\.png$/.test(f)) : [];
const pairs = shots.filter((f) => eye1 && fs.existsSync(path.join(eye1, f))).map((f) => {
  const n = f.replace('.png', '');
  fs.copyFileSync(path.join(eye0, f), path.join(out, 'img', n + '.before.png')); fs.copyFileSync(path.join(eye1, f), path.join(out, 'img', n + '.after.png'));
  return `<figure><div class="pair"><img loading="lazy" src="img/${n}.before.png"><img loading="lazy" src="img/${n}.after.png"></div><figcaption>${esc(n)}</figcaption></figure>`;
}).join('');

const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FIX-PERF compare</title>
<style>
:root{--bg:#0e131c;--panel:#161d2a;--ink:#e7edf7;--dim:#8fa0b8;--line:#263146;--b0:#5b6b86;--b1:#5cf5c0;--ok:#5cf5c0;--bad:#ff6b8a;--goal:#ffb347}
@media (prefers-color-scheme: light){:root{--bg:#f4f6fa;--panel:#fff;--ink:#162033;--dim:#5a6b85;--line:#d8dfeb;--b0:#9aa8bf;--b1:#12a37a;--ok:#12a37a;--bad:#d9345a;--goal:#d98a10}}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.4 system-ui,sans-serif}main{max-width:1180px;margin:0 auto;padding:16px}
h1{font-size:20px;margin:4px 0 14px}h2{font-size:15px;margin:22px 0 10px;color:var(--dim);font-weight:600}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px}
.vrow{display:grid;grid-template-columns:150px 1fr 130px;gap:10px;align-items:center;margin:8px 0}.vn{font-weight:600}.ms{color:var(--dim);font-variant-numeric:tabular-nums;text-align:right}
.bars{position:relative}.bar{height:14px;border-radius:7px;margin:3px 0;position:relative}.bar span{position:absolute;right:-34px;top:-2px;font-size:12px;font-variant-numeric:tabular-nums}
.b0{background:var(--b0)}.b1{background:var(--b1)}.goal{position:absolute;top:-4px;bottom:-4px;border-left:2px dashed var(--goal)}
.legend{display:flex;gap:14px;color:var(--dim);font-size:12px}.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px;vertical-align:-1px}
table{border-collapse:collapse;width:100%}td,th{padding:6px 8px;border-bottom:1px solid var(--line);text-align:center;font-variant-numeric:tabular-nums}td:first-child,th:first-child{text-align:left}
td small{display:block;color:var(--dim);font-size:11px}td.ok{color:var(--ok);font-weight:700}td.lo{color:var(--goal)}tr.ok td:last-child{color:var(--ok)}tr.bad td{color:var(--bad)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:10px}figure{margin:0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:3px}.pair img{width:100%;border-radius:6px;display:block}
figcaption{color:var(--dim);font-size:12px;margin-top:3px}.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:760px){.two{grid-template-columns:1fr}.vrow{grid-template-columns:1fr}.ms{text-align:left}}
</style></head><body><main>
<h1>⚡ FIX-PERF · до → после</h1>
<div class="card"><div class="legend"><span><i style="background:var(--b0)"></i>до</span><span><i style="background:var(--b1)"></i>после · high</span><span><i style="background:var(--goal)"></i>цель 150 fps</span><span>uncapped, 1400×800, M1 Pro</span></div>${fpsRows}</div>
<div class="two"><div><h2>🎚 fps по пресетам (после)</h2><div class="card">${preTable}</div></div>
<div><h2>🔍 QA · FAIL / проверок</h2><div class="card"><table><tr><th>группа</th><th>до</th><th>после</th><th></th></tr>${qaRows}</table></div></div></div>
<h2>👁 глазами игрока · слева до, справа после</h2><div class="grid">${pairs || '<div class="card">нет пар кадров</div>'}</div>
</main></body></html>`;
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log('wrote', path.join(out, 'index.html'), '·', pairs ? pairs.split('<figure>').length - 1 : 0, 'eye pairs');
