#!/usr/bin/env node
/* inventory.mjs — every drawable object in the running game, with provenance and render facts.
 *
 *   node tools/inventory.mjs [--out stand/inventory] [--headful]
 *     → <out>.json (rows) + <out>.html (sortable table + summary tiles)
 *
 * Row: name, path, type, owner (userData.owner: qa-hooks.js tags the file that added it; STYLE.tag / module tags win),
 * source ('pack:<name>' from loadPacked, 'primitive:<Box…>', 'generated'), geometry, triangles, instances, material
 * types, textured (albedo map or custom sampler), vertexColors, side, castShadow, receiveShadow, frustumCulled,
 * visible, world bounding box, Passport role, intentional (fx / emitter / beam / shader / userData.qaIntentional),
 * primitive (v1 primitive geometry). Primitive + visible + not intentional = "v1 leftover".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGame, sleep, OUT } from './qa/harness.mjs';
import { page as htmlPage, esc, ICON, tile, bar } from './qa/report-kit.mjs';

export async function collectInventory(H) {
  return H.page.evaluate(() => QA.inventory());
}

export function summarize(rows) {
  const vis = rows.filter((r) => r.visible);
  const byOwner = {}; for (const r of vis) { const o = byOwner[r.owner] = byOwner[r.owner] || { owner: r.owner, n: 0, tris: 0, prim: 0, untex: 0 }; o.n++; o.tris += r.trisTotal; if (r.primitive && !r.intentional) o.prim++; if (!r.textured && !r.intentional && r.type !== 'Sprite') o.untex++; }
  const leftovers = vis.filter((r) => r.primitive && !r.intentional);
  const untextured = vis.filter((r) => !r.textured && !r.intentional && !/Sprite|Points|Line/.test(r.type));
  return { total: rows.length, visible: vis.length, tris: vis.reduce((s, r) => s + r.trisTotal, 0), byOwner: Object.values(byOwner).sort((a, b) => b.tris - a.tris), leftovers, untextured,
    noShadowCast: vis.filter((r) => !r.castShadow && !r.intentional && /Mesh/.test(r.type)).length, unculled: vis.filter((r) => !r.frustumCulled && /Mesh/.test(r.type)).length };
}

export function inventoryHtml(rows, meta = {}) {
  const S = summarize(rows);
  const maxT = Math.max(1, ...rows.map((r) => r.trisTotal));
  const tr = (r) => `<tr class="${r.visible ? '' : 'hid'}"><td>${esc(r.path)}</td><td><span class="chip">${esc(r.owner)}</span></td><td class="mono">${esc(r.source)}</td><td>${esc(r.type)}</td><td class="n" data-v="${r.trisTotal}">${bar(r.trisTotal, maxT)} ${r.trisTotal.toLocaleString('ru')}</td>
<td class="n">${r.instances}</td><td class="mono">${esc(r.mat)}${r.matNames ? '<br><span class="muted">' + esc(r.matNames).slice(0, 80) + '</span>' : ''}</td><td data-v="${r.textured ? 1 : 0}">${r.textured ? ICON.ok : '<span class="st warn">' + ICON.warn + '</span>'}</td>
<td>${esc(r.side)}</td><td data-v="${r.castShadow ? 1 : 0}">${r.castShadow ? '●' : '○'}</td><td data-v="${r.frustumCulled ? 1 : 0}">${r.frustumCulled ? '●' : '○'}</td><td>${esc(r.passport || '')}</td>
<td>${r.primitive ? (r.intentional ? '<span class="chip">' + esc(r.intentional) + '</span>' : '<span class="st bad">' + ICON.prim + 'v1</span>') : esc(r.intentional || '')}</td><td data-v="${r.visible ? 1 : 0}">${r.visible ? ICON.eye : ''}</td>
<td class="mono muted">${r.box ? r.box[0].map((x) => Math.round(x)).join(',') + ' → ' + r.box[1].map((x) => Math.round(x)).join(',') : ''}</td></tr>`;
  const body = `<h1>${ICON.list}Инвентарь сцены <span class="chip">${esc(meta.date || '')}</span></h1>
<div class="tiles">${tile(ICON.cube, S.visible, 'видимых объектов · всего ' + S.total)}${tile(ICON.tri, (S.tris / 1e6).toFixed(2) + 'M', 'треугольников (видимые)')}
${tile(ICON.prim, S.leftovers.length, 'примитивы v1', S.leftovers.length ? 'bad' : 'ok')}${tile(ICON.tex, S.untextured.length, 'без текстуры', S.untextured.length ? 'warn' : 'ok')}
${tile(ICON.cam, S.unculled, 'frustumCulled выкл.')}${tile(ICON.owner, S.byOwner.length, 'владельцев')}</div>
<div class="tw"><table><thead><tr><th>владелец</th><th>объектов</th><th>треугольников</th><th>примитивы v1</th><th>без текстуры</th></tr></thead><tbody>
${S.byOwner.map((o) => `<tr><td><span class="chip">${esc(o.owner)}</span></td><td class="n">${o.n}</td><td class="n">${bar(o.tris, S.tris)} ${(o.tris / 1e6).toFixed(2)}M</td><td class="n">${o.prim ? '<span class="st bad">' + o.prim + '</span>' : 0}</td><td class="n">${o.untex}</td></tr>`).join('')}</tbody></table></div>
<p><input type="search" id="q" placeholder="фильтр: имя, владелец, источник…"> <label><input type="checkbox" id="onlyVis" checked> только видимые</label> <label><input type="checkbox" id="onlyBad"> только v1 / без текстуры</label></p>
<div class="tw"><table class="sort" id="inv"><thead><tr><th>объект</th><th>владелец</th><th>источник</th><th>тип</th><th>треуг.</th><th>инст.</th><th>материал</th><th>текст.</th><th>сторона</th><th>тень</th><th>culled</th><th>паспорт</th><th>прим.</th><th>вид.</th><th>bbox</th></tr></thead>
<tbody>${rows.slice().sort((a, b) => b.trisTotal - a.trisTotal).map(tr).join('')}</tbody></table></div>`;
  const js = `const f=()=>{const q=document.getElementById('q').value.toLowerCase(),v=document.getElementById('onlyVis').checked,b=document.getElementById('onlyBad').checked;for(const r of document.querySelectorAll('#inv tbody tr')){const t=r.textContent.toLowerCase();r.style.display=(!q||t.includes(q))&&(!v||!r.classList.contains('hid'))&&(!b||r.querySelector('.st.bad,.st.warn'))?'':'none'}};['q','onlyVis','onlyBad'].forEach(i=>document.getElementById(i).addEventListener('input',f));f();`;
  return htmlPage('Инвентарь сцены', body, js);
}

export function writeInventory(rows, outBase, meta) {
  fs.mkdirSync(path.dirname(outBase), { recursive: true });
  fs.writeFileSync(outBase + '.json', JSON.stringify({ meta, summary: (({ leftovers, untextured, ...s }) => Object.assign(s, { leftovers: leftovers.map((r) => r.path + ' · ' + r.geo + ' · ' + r.owner), untextured: untextured.map((r) => r.path + ' · ' + r.owner) }))(summarize(rows)), rows }, null, 1));
  fs.writeFileSync(outBase + '.html', inventoryHtml(rows, meta));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
  const outBase = path.resolve(String(opt('out', path.join(OUT, 'inventory'))));
  const H = await openGame({ label: 'inventory', quality: 'high', headful: !!opt('headful'), log: (...a) => console.log('[inventory]', ...a) });
  try {
    await H.newGame(); await sleep(1500);
    const rows = await collectInventory(H), meta = { date: new Date().toISOString(), gpu: H.gpu };
    writeInventory(rows, outBase, meta);
    const S = summarize(rows);
    console.log(`[inventory] ${S.visible}/${S.total} visible · ${(S.tris / 1e6).toFixed(2)}M tris · v1 primitives ${S.leftovers.length} · untextured ${S.untextured.length}`);
    for (const r of S.leftovers) console.log('  v1 primitive:', r.path, r.geo, r.owner, r.passport || '');
    console.log('[inventory] wrote', outBase + '.json', outBase + '.html');
  } finally { await H.close(); }
}
