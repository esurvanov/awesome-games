/* cmp-report.mjs — stand/compare-<label>/index.html from before.json + after.json (+ optional verdicts.json).
 * verdicts.json (written by whoever looked at the pictures): { notes: [..], shots: { <shot>: { v: 'diff'|'same'|'worse'|'nf'|'bug', t: '2–6 words', n: 'optional note chip' } } }
 */
import fs from 'node:fs';
import path from 'node:path';

const SHOT = {
  menu: { t: 'Меню', c: 'мигание чёрным · 10 с', i: 'menu' },
  snow_walk: { t: 'Следы на снегу', c: 'след за пилотом', i: 'feet' },
  boots: { t: 'Ботинки крупно', c: 'ботинок в снегу', i: 'boot' },
  jump_roll: { t: 'Прыжок + кувырок', c: 'что осталось в снегу', i: 'jump' },
  boulder_lean: { t: 'Касание валуна', c: 'рука на камне', i: 'hand' },
  rock_close: { t: 'Камень вблизи', c: 'снег сверху, стык с землёй', i: 'rock' },
  tufts: { t: 'Трава вблизи', c: 'пучки и вереск', i: 'grass' },
  forest_edge: { t: 'Опушка', c: 'деревья 5–15 м', i: 'tree' },
  forest_mid: { t: 'В лесу', c: 'деревья вокруг', i: 'tree' },
  station_fire: { t: 'Костёр Орма', c: 'чёрные кадры · 5 с', i: 'fire' },
  stags: { t: 'Олени', c: 'бег при бегстве', i: 'stag' },
};
const ORDER = Object.keys(SHOT);
const P = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  menu: P('<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 10h8M8 14h5"/>'),
  feet: P('<path d="M7 20c-2 0-3-2-2-5l1-4c1-3 5-3 5 1l-1 5c0 2-1 3-3 3zM17 14c-2 0-3-2-2-5l1-3c1-3 5-3 5 1l-1 4c0 2-1 3-3 3z"/>'),
  boot: P('<path d="M7 3v10l-3 3v3h16v-2c0-2-2-3-5-3l-3-1V3z"/>'),
  jump: P('<circle cx="12" cy="5" r="2"/><path d="M12 8v6M8 11l4-2 4 2M9 20l3-6 3 6M4 22h16"/>'),
  hand: P('<path d="M8 13V5a1.5 1.5 0 013 0v6M11 11V4a1.5 1.5 0 013 0v7M14 11V6a1.5 1.5 0 013 0v8c0 4-3 7-6 7s-5-2-6-4l-2-4a1.5 1.5 0 012.6-1.5L8 13"/>'),
  rock: P('<path d="M3 19l4-8 4-3 5 2 5 9z"/><path d="M8 10l3 2 4-1"/>'),
  grass: P('<path d="M4 20c2-4 2-8 1-12M9 20c0-5 1-9 4-12M14 20c0-4 2-7 6-9M11 20c-1-3-3-5-6-6"/>'),
  tree: P('<path d="M12 3l6 8h-3l4 6H5l4-6H6zM12 17v4"/>'),
  fire: P('<path d="M12 3c1 4 5 5 5 10a5 5 0 01-10 0c0-3 2-4 2-6 2 1 3 3 3 5 1-2 1-5 0-9z"/>'),
  stag: P('<path d="M5 3l2 3 2-1M19 3l-2 3-2-1M9 5l1 4h4l1-4M8 11c0 3 1 5 4 5s4-2 4-5M9 16v5M15 16v5"/>'),
  ok: P('<path d="M5 12l5 5 9-10"/>'), eq: P('<path d="M5 9h14M5 15h14"/>'), x: P('<path d="M6 6l12 12M18 6L6 18"/>'), warn: P('<path d="M12 3l10 18H2zM12 10v5M12 18v.5"/>'),
  fps: P('<path d="M4 18a8 8 0 1116 0"/><path d="M12 18l4-6"/>'), black: P('<rect x="4" y="5" width="16" height="14" rx="1" fill="currentColor"/>'), pin: P('<path d="M12 21s-7-6-7-11a7 7 0 0114 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
  play: P('<path d="M8 5l11 7-11 7z"/>'), img: P('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>'), cpu: P('<rect x="6" y="6" width="12" height="12" rx="1"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>'),
};
const VERD = { diff: ['ok', 'видно отличие'], same: ['eq', 'не отличить'], worse: ['warn', 'стало хуже'], nf: ['x', 'не снять'], bug: ['warn', 'баг'] };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const readJ = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };

function chips(r, name, busy) {
  if (!r) return '';
  const c = [];
  const fps = r.fpsRun != null ? r.fpsRun : r.fpsIdle != null ? r.fpsIdle : r.fps;
  if (fps != null) c.push(`<span class="chip${busy ? ' dim' : ''}" title="медиана кадров в секунду на этой машине${busy ? ' — машина была занята' : ''}">${ICON.fps}${Math.round(fps)} fps</span>`);
  const bl = r.rendered || r.screen;
  if (bl) { const n = Math.max(r.rendered ? r.rendered.black : 0, r.screen ? r.screen.black : 0), of = r.rendered ? r.rendered.frames : r.screen.frames;
    c.push(`<span class="chip ${n ? 'bad' : 'good'}" title="чёрных кадров из отрисованных">${ICON.black}${n} / ${of}</span>`); }
  if (r.run && r.run.contactEngaged !== undefined) c.push(r.run.contactEngaged === true ? `<span class="chip good">${ICON.hand}касание</span>` : `<span class="chip bad">${ICON.hand}нет касания</span>`);
  if (r.run && r.run.decals != null && (name === 'snow_walk' || name === 'boots' || name === 'jump_roll')) c.push(`<span class="chip" title="плоских картинок-отпечатков (старая система); 0 = след вдавлен в геометрию">${ICON.feet}${r.run.decals ? r.run.decals + ' картинок' : 'вмятины'}</span>`);
  if (r.run && r.run.fledAfterS != null) c.push(`<span class="chip">${ICON.stag}бегут</span>`);
  if (r.run && name === 'forest_edge' && r.run.nearestTreeM != null) c.push(`<span class="chip">${ICON.tree}${r.run.nearestTreeM} м</span>`);
  return c.join('');
}
function col(side, d, name, dir) {
  const r = d && d.shots && d.shots[name];
  const lab = side === 'before' ? 'ДО' : 'ПОСЛЕ';
  if (!r) return `<div class="col"><div class="tag ${side}">${lab}</div><div class="empty">${ICON.x}не снято</div></div>`;
  if (r.setup && r.setup.skip) return `<div class="col"><div class="tag ${side}">${lab}</div><div class="empty">${ICON.x}нет в этой сборке</div></div>`;
  if (r.error) return `<div class="col"><div class="tag ${side}">${lab}</div><div class="empty">${ICON.warn}${esc(r.error.slice(0, 80))}</div></div>`;
  const still = name === 'menu' ? `menu.${side}.webp` : r.headline;
  const clip = fs.existsSync(path.join(dir, `${name}.${side}.clip.webp`)) ? `${name}.${side}.clip.webp` : null;
  const blk = r.blackFrame && fs.existsSync(path.join(dir, r.blackFrame)) ? r.blackFrame : null;
  const busy = d.machine && !d.machine.quiet;
  return `<div class="col"><div class="tag ${side}">${lab}</div>
    <figure data-still="${esc(still)}" data-clip="${esc(clip || '')}"><a href="${esc(still)}" target="_blank"><img loading="lazy" src="${esc(still)}" alt="${lab}"></a></figure>
    <div class="row">${clip ? `<button class="b" data-k="clip">${ICON.play}клип</button>` : ''}${blk ? `<a class="b bad" href="${esc(blk)}" target="_blank">${ICON.black}чёрный кадр</a>` : ''}${chips(r, name, busy)}</div></div>`;
}

export function renderPage(dir) {
  const B = readJ(path.join(dir, 'before.json')), A = readJ(path.join(dir, 'after.json')), V = readJ(path.join(dir, 'verdicts.json')) || { shots: {}, notes: [] };
  const head = (d, side) => d ? `<div class="build ${side}"><b>${side === 'before' ? 'ДО' : 'ПОСЛЕ'}</b> <code>${esc(String(d.sha).slice(0, 7))}</code> <span>${esc((d.date || '').slice(0, 16))}</span>
      <span class="chip ${d.machine && d.machine.quiet ? 'good' : 'dim'}">${ICON.cpu}${d.machine && d.machine.quiet ? 'машина тихая' : 'машина занята'}</span></div>` : `<div class="build ${side}"><b>${side === 'before' ? 'ДО' : 'ПОСЛЕ'}</b> —</div>`;
  const summary = ORDER.map((n) => { const v = V.shots && V.shots[n]; const k = v ? VERD[v.v] : null;
    return `<a class="sum ${v ? v.v : ''}" href="#${n}">${ICON[SHOT[n].i]}<span>${esc(SHOT[n].t)}</span>${k ? `<i title="${esc(k[1])}">${ICON[k[0]]}</i>` : ''}</a>`; }).join('');
  const cards = ORDER.map((n) => { const v = V.shots && V.shots[n]; const k = v ? VERD[v.v] : null;
    const same = (() => { const a = A && A.shots[n] && A.shots[n].setup, b = B && B.shots[n] && B.shots[n].setup; if (!a || !b || a.x == null || b.x == null) return ''; const d = Math.hypot(a.x - b.x, a.z - b.z);
      return `<span class="chip ${d < 0.5 ? 'good' : 'dim'}" title="где стоит пилот">${ICON.pin}${d < 0.5 ? 'то же место' : 'сдвиг ' + d.toFixed(0) + ' м'}</span>`; })();
    return `<section class="card" id="${n}"><header>${ICON[SHOT[n].i]}<h2>${esc(SHOT[n].t)}</h2><span class="cap">${esc(SHOT[n].c)}</span>${same}
      ${v && v.n ? `<span class="chip dim">${ICON.warn}${esc(v.n)}</span>` : ''}${k ? `<span class="verdict ${v.v}">${ICON[k[0]]}${esc(v.t || k[1])}</span>` : ''}</header>
      <div class="pair">${col('before', B, n, dir)}${col('after', A, n, dir)}</div></section>`; }).join('\n');
  const notes = (V.notes || []).map((t) => `<div class="note">${ICON.warn}<span>${esc(t)}</span></div>`).join('');
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>До и после</title>
<style>
:root{--bg:#f4f6fa;--panel:#fff;--ink:#141a26;--dim:#667085;--line:#e3e7ef;--good:#12805c;--bad:#c4263e;--warn:#a86a00;--b4:#6b7a99;--af:#2f6fe0;--chip:#eef1f6}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0b0f18;--panel:#131a26;--ink:#e8edf6;--dim:#8d99ad;--line:#243044;--good:#4fd6a3;--bad:#ff6b82;--warn:#f1b544;--b4:#8d99ad;--af:#7fb0ff;--chip:#1b2433}}
:root[data-theme=dark]{--bg:#0b0f18;--panel:#131a26;--ink:#e8edf6;--dim:#8d99ad;--line:#243044;--good:#4fd6a3;--bad:#ff6b82;--warn:#f1b544;--b4:#8d99ad;--af:#7fb0ff;--chip:#1b2433}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.35 system-ui,-apple-system,sans-serif;padding:16px;max-width:1700px;margin:auto}
svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}
h1{display:flex;align-items:center;gap:8px;font-size:20px;margin:0 0 10px}h1 svg{width:22px;height:22px}
.builds{display:flex;flex-wrap:wrap;gap:8px 18px;margin-bottom:10px;color:var(--dim)}.build{display:flex;align-items:center;gap:8px}.build b{color:var(--ink)}.build.after b{color:var(--af)}
code{background:var(--chip);padding:1px 5px;border-radius:4px}
.sums{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 12px}.sum{display:flex;align-items:center;gap:6px;padding:5px 9px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);text-decoration:none;font-size:13px}
.sum i{display:flex}.sum.diff i{color:var(--good)}.sum.same i{color:var(--dim)}.sum.nf i,.sum.bug i{color:var(--bad)}.sum.worse i{color:var(--warn)}
.note{display:flex;gap:8px;align-items:center;padding:8px 10px;border-radius:8px;background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--warn);margin:6px 0}.note svg{color:var(--warn)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px;margin:12px 0}
.card header{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:8px}.card h2{font-size:16px;margin:0}.cap{color:var(--dim)}
.verdict{margin-left:auto;display:flex;align-items:center;gap:5px;font-weight:600;padding:3px 9px;border-radius:999px;background:var(--chip)}
.verdict.diff{color:var(--good)}.verdict.same{color:var(--dim)}.verdict.nf,.verdict.bug{color:var(--bad)}.verdict.worse{color:var(--warn)}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media (max-width:760px){.pair{grid-template-columns:1fr}}
.col{position:relative;min-width:0}.tag{position:absolute;z-index:1;top:6px;left:6px;font-weight:700;font-size:12px;padding:2px 8px;border-radius:6px;background:rgba(0,0,0,.6);color:#fff}.tag.after{background:var(--af)}
figure{margin:0}figure img{display:block;width:100%;aspect-ratio:1512/860;object-fit:cover;border-radius:8px;background:#000}
.row{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;align-items:center}
.chip,.b{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:999px;background:var(--chip);font-size:12.5px;color:var(--ink);text-decoration:none}
.chip.good{color:var(--good)}.chip.bad{color:var(--bad)}.chip.dim{color:var(--dim)}
.b{border:1px solid var(--line);cursor:pointer;font:inherit;font-size:12.5px}.b.on{background:var(--af);color:#fff;border-color:var(--af)}.b.bad{color:var(--bad)}
.empty{display:flex;align-items:center;justify-content:center;gap:6px;aspect-ratio:1512/860;border-radius:8px;border:1px dashed var(--line);color:var(--dim)}
.top{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}.meta{color:var(--dim);font-size:12.5px}
</style></head><body>
<h1>${ICON.img}До и после · глазами игрока</h1>
<div class="builds">${head(B, 'before')}${head(A, 'after')}<span class="chip">${ICON.menu}1512×860 @2x</span><span class="chip">качество high</span><span class="chip">камера игрока</span></div>
<div class="top"><button class="b" id="allclip">${ICON.play}все клипы</button><span class="meta">клик по кадру — полный размер</span></div>
${notes}
<nav class="sums">${summary}</nav>
${cards}
<script>
const swap = (fig, on) => { const img = fig.querySelector('img'); img.src = on && fig.dataset.clip ? fig.dataset.clip : fig.dataset.still; fig.querySelector('a').href = img.src; };
document.querySelectorAll('button[data-k=clip]').forEach((b) => b.onclick = () => { const on = !b.classList.contains('on'); b.classList.toggle('on', on); swap(b.closest('.col').querySelector('figure'), on); });
document.getElementById('allclip').onclick = (e) => { const on = !e.currentTarget.classList.contains('on'); e.currentTarget.classList.toggle('on', on);
  document.querySelectorAll('button[data-k=clip]').forEach((b) => { b.classList.toggle('on', on); swap(b.closest('.col').querySelector('figure'), on); }); };
</script>
</body></html>`;
  fs.writeFileSync(path.join(dir, 'index.html'), html);
}
