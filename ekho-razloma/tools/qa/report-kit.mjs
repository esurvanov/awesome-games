/* report-kit.mjs — shared look for the QA HTML pages: compact, icon-led, colour statuses, light + dark. */
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const I = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
export const ICON = {
  ok: I('<path d="M5 12l5 5 9-10"/>'), bad: I('<path d="M6 6l12 12M18 6L6 18"/>'), warn: I('<path d="M12 3l10 18H2zM12 10v5M12 18v.5"/>'), na: I('<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/>'),
  run: I('<circle cx="13" cy="4" r="2"/><path d="M8 21l3-6 3 2v5M6 12l3-4 5 1 3 4M11 15l-2-3"/>'), feet: I('<path d="M7 20c-2 0-3-2-2-5l1-4c1-3 5-3 5 1l-1 5c0 2-1 3-3 3zM17 14c-2 0-3-2-2-5l1-3c1-3 5-3 5 1l-1 4c0 2-1 3-3 3z"/>'),
  face: I('<path d="M4 12h13M13 7l5 5-5 5"/>'), cube: I('<path d="M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10"/>'), back: I('<path d="M4 4h16v16H4z"/><path d="M4 20L20 4"/>'),
  prim: I('<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 9h16M9 4v16"/>'), frame: I('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 15l5-4 4 3 3-2 6 4"/>'),
  tex: I('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>'), cam: I('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  perf: I('<path d="M3 12h4l3-8 4 16 3-8h4"/>'), story: I('<path d="M5 4h11l3 3v13H5z"/><path d="M9 10h6M9 14h6"/>'), eye: I('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  float: I('<path d="M4 20h16M8 14h8v-4H8zM12 6V3"/>'), lock: I('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'), list: I('<path d="M8 6h13M8 12h13M8 18h13M3 6h.5M3 12h.5M3 18h.5"/>'),
  owner: I('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>'), tri: I('<path d="M12 3l9 17H3z"/>'),
};
export const status = (ok) => (ok === true ? `<span class="st ok">${ICON.ok}PASS</span>` : ok === false ? `<span class="st bad">${ICON.bad}FAIL</span>` : ok === 'warn' ? `<span class="st warn">${ICON.warn}WARN</span>` : `<span class="st na">${ICON.na}n/a</span>`);
export const CSS = `
:root{--bg:#f5f7fb;--panel:#fff;--ink:#0d1526;--dim:#5b6b86;--line:#dde3ee;--ok:#0f9d6b;--bad:#d93855;--warn:#c98a00;--acc:#2f6fed;--chip:#eef2f9}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#0a0f1e;--panel:#121a30;--ink:#e8f0ff;--dim:#8a9cc0;--line:rgba(127,227,255,.16);--ok:#5cf5c0;--bad:#ff5c7d;--warn:#ffc15c;--acc:#7fe3ff;--chip:#1a2442}}
:root[data-theme="dark"]{--bg:#0a0f1e;--panel:#121a30;--ink:#e8f0ff;--dim:#8a9cc0;--line:rgba(127,227,255,.16);--ok:#5cf5c0;--bad:#ff5c7d;--warn:#ffc15c;--acc:#7fe3ff;--chip:#1a2442}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:13px/1.35 system-ui,-apple-system,sans-serif;padding:16px;max-width:1500px;margin:auto}
svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none;vertical-align:-3px}
h1{display:flex;gap:8px;align-items:center;font-size:18px;margin:0 0 10px}h2{display:flex;gap:8px;align-items:center;font-size:15px;margin:18px 0 8px}
.chip{display:inline-flex;gap:5px;align-items:center;padding:2px 8px;border-radius:99px;background:var(--chip);color:var(--dim);font-size:11px;white-space:nowrap}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:0 0 12px}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:2px;min-width:0}
.tile b{font-size:19px;font-variant-numeric:tabular-nums}.tile small{color:var(--dim);font-size:11px}.tile.ok{border-color:var(--ok)}.tile.bad{border-color:var(--bad)}.tile.warn{border-color:var(--warn)}
.st{display:inline-flex;gap:4px;align-items:center;font-weight:600;font-size:11px}.st.ok{color:var(--ok)}.st.bad{color:var(--bad)}.st.warn{color:var(--warn)}.st.na{color:var(--dim)}
.tw{overflow-x:auto;background:var(--panel);border:1px solid var(--line);border-radius:10px;margin-bottom:12px}
table{border-collapse:collapse;width:100%}th,td{padding:5px 8px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--dim);font-weight:600;font-size:11px;position:sticky;top:0;background:var(--panel);cursor:pointer;white-space:nowrap}td.n{font-variant-numeric:tabular-nums;text-align:right}
.bar{display:inline-block;width:60px;height:6px;border-radius:4px;background:var(--chip);overflow:hidden;vertical-align:middle}.bar i{display:block;height:100%;background:var(--acc)}.bar i.bad{background:var(--bad)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden;min-width:0}
.card .im{position:relative}.card img{width:100%;display:block;cursor:zoom-in}.card img.mask{position:absolute;inset:0;opacity:.85;pointer-events:none;display:none}.card.showmask img.mask{display:block}
.card .cb{padding:6px 8px;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center}.card .cb b{margin-right:auto;font-size:12px}
.sheet img{width:100%;display:block;border-radius:8px;cursor:zoom-in}.muted{color:var(--dim)}.mono{font-family:ui-monospace,Menlo,monospace;font-size:11px}
input[type=search]{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:6px 10px;min-width:220px}
button{background:var(--chip);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:4px 10px;cursor:pointer;font:inherit}
.zoom{position:fixed;inset:0;background:rgba(0,0,0,.88);display:none;place-items:center;z-index:9}.zoom img{max-width:98vw;max-height:96vh}.zoom.on{display:grid}
@media(max-width:640px){body{padding:10px}.grid{grid-template-columns:1fr}}
`;
export const ZOOM_JS = `document.addEventListener('click',e=>{const t=e.target;if(t.tagName==='IMG'&&!t.classList.contains('mask')&&!t.closest('.zoom')){zi.src=t.src;z.classList.add('on')}else if(t.closest('.zoom'))z.classList.remove('on')});`;
export const SORT_JS = `document.querySelectorAll('table.sort').forEach(tb=>{tb.querySelectorAll('th').forEach((th,i)=>th.onclick=()=>{const rows=[...tb.tBodies[0].rows],dir=th.dataset.d=th.dataset.d==='a'?'d':'a';rows.sort((a,b)=>{const x=a.cells[i].dataset.v??a.cells[i].textContent,y=b.cells[i].dataset.v??b.cells[i].textContent,nx=parseFloat(x),ny=parseFloat(y);const c=isNaN(nx)||isNaN(ny)?String(x).localeCompare(String(y)):nx-ny;return dir==='a'?c:-c});rows.forEach(r=>tb.tBodies[0].appendChild(r))})});`;
export const page = (title, body, extraJs = '') => `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style>
<body>${body}<div class="zoom" id="z"><img id="zi" alt=""></div><script>${ZOOM_JS}${SORT_JS}${extraJs}</script></body></html>`;
export const tile = (icon, val, sub, cls = '') => `<div class="tile ${cls}"><span>${icon}</span><b>${esc(val)}</b><small>${esc(sub)}</small></div>`;
export const bar = (v, max, bad) => `<span class="bar"><i class="${bad ? 'bad' : ''}" style="width:${Math.max(0, Math.min(100, (v || 0) / (max || 1) * 100)).toFixed(1)}%"></i></span>`;
