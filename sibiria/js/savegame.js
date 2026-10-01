'use strict';
// Сохранение состояния игры (формат) и чекпоинты. Ячейки localStorage — Saves (js/ui.js).
// Формат v4 («Сибирь 2.0»): seed + версия генератора + изменения. Статичный мир (лес, стена, сугробы,
// трещины, кочки, места оберегов) пересчитывается из seed и не хранится. Хранятся:
//  treeD — изменённые деревья [индекс, дрова(, дрожь)]; fogB — туман 2 бита на клетку (base64);
//  live — зайцы/вороны/олени компактно (числа до 0,01); amGot — индексы собранных оберегов;
//  trailB/trailF — тропы и расчистка (js/trail.js: тронутые блоки, байты, RLE нулей, base64) и счётчик заметания;
//  всё остальное состояние G как есть. Ссылки на общие объекты (дерево в задаче человека, лунка
//  в действии героя) пишутся как {$ref:[список, индекс]} и восстанавливаются при загрузке.
// Версии: 2 — ключ sibir2-save; 3 — ячейки, весь G; 4 — дельта. Сейвы < 4 не читаются (мир другой).
const SaveGame = (() => {
  const V = 4;
  const SKIP = new Set(['trees', 'rocks', 'drifts', 'cracks', 'tussocks', 'prints', 'parts', 'fog', 'hares', 'ravens', 'deer', 'amuletsAt']);
  const LIVE = ['hares', 'ravens', 'deer'];
  const REF_LISTS = ['holes', 'stacks', 'traps', 'fires'];
  const q2 = v => typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v;
  // список однотипных объектов → {k: ключи, v: [[значения]]}; числа округляются прямо в G (сохранение = состояние)
  function packList(arr) {
    const keys = []; for (const o of arr) for (const k in o) if (!keys.includes(k)) keys.push(k);
    return { k: keys, v: arr.map(o => keys.map(k => { if (!(k in o)) return null; const v = q2(o[k]); o[k] = v; return v; })) };
  }
  function unpackList(p) { return p ? p.v.map(row => { const o = {}; p.k.forEach((k, i) => { if (row[i] !== null) o[k] = row[i]; }); return o; }) : []; }
  function packFog(f) {
    let bin = ''; for (let i = 0; i < f.length; i += 4) bin += String.fromCharCode((f[i] & 3) | ((f[i + 1] & 3) << 2) | ((f[i + 2] & 3) << 4) | ((f[i + 3] & 3) << 6));
    return btoa(bin);
  }
  function unpackFog(b64) {
    const FOG = World.FOG, f = new Array(FOG.nx * FOG.ny).fill(0); if (!b64) return f;
    const bin = atob(b64);
    for (let i = 0; i < f.length; i++) f[i] = (bin.charCodeAt(i >> 2) >> ((i & 3) * 2)) & 3;
    return f;
  }
  function snapshot() {
    const refs = new Map(), TREE_I = World.TREE_I;
    for (const k of REF_LISTS) (G[k] || []).forEach((o, i) => refs.set(o, [k, i, G[k]]));
    const o = { _v: V, gen: World.GEN_V, W, H, cyc: CYCLE };
    for (const k of Object.keys(G).sort()) if (!SKIP.has(k)) o[k] = G[k];
    // treeD: [индекс, дрова, дрожь?, стадия отрастания?, время рубки (G.time)?] — хвост опускается, если по
    // умолчанию (0); молодое деревце и пень уже отличаются по drова от wood0, поэтому попадают сюда сами
    o.treeD = [];
    G.trees.forEach((t, i) => {
      if (t.wood === World.wood0(t) && t.shake <= 0 && t.cutAt == null) return;
      // без округления: t.cutAt/t.shake остаются как в живом G, сравнение save→load — байт в байт
      const row = [i, t.wood];
      if (t.shake > 0 || t.stage || t.cutAt != null) row.push(t.shake || 0);
      if (t.stage || t.cutAt != null) row.push(t.stage || 0);
      if (t.cutAt != null) row.push(t.cutAt);
      o.treeD.push(row);
    });
    o.fogB = packFog(G.fog);
    if (typeof Trail !== 'undefined') { const tb = Trail.pack(); if (tb) { o.trailB = tb; o.trailF = +Trail.fill.toFixed(3); } } // тропы (js/trail.js)
    o.live = {}; for (const k of LIVE) o.live[k] = packList(G[k] || []);
    o.amGot = []; (G.amuletsAt || []).forEach((a, i) => { if (a.got) o.amGot.push(i); });
    return JSON.stringify(o, function (key, v) {
      if (v && typeof v === 'object') {
        if (TREE_I.has(v)) return { $ref: ['trees', TREE_I.get(v)] };
        const r = refs.get(v); if (r && this !== r[2]) return { $ref: [r[0], r[1]] };
      }
      return v;
    });
  }
  // чекпоинт (сон, новая глава) = автосохранение в ячейку «Авто»
  function saveCheckpoint() {
    checkpoint = snapshot();
    if (typeof Saves !== 'undefined') Saves.write('auto', checkpoint);
  }
  // почему сейв не подходит к этой игре (null — подходит)
  function problem(g) {
    const v = g._v || 2;
    if (v > V) return `из новой версии игры (v${v})`;
    if (v < V) return `старое сохранение (v${v}) — мир «Сибири 2.0» другой, начните заново`;
    if (g.W !== W || g.H !== H) return `мир другого размера (${g.W}×${g.H})`;
    if (g.gen !== World.GEN_V) return `другая версия генератора мира (${g.gen})`;
    return null;
  }
  function load(json) {
    const g = typeof json === 'string' ? JSON.parse(json) : json;
    const bad = problem(g); if (bad) throw new Error(bad);
    const { _v, gen, W: _w, H: _h, cyc, treeD, fogB, live, amGot, trailB, trailF, ...rest } = g;
    G = Object.assign(rest, { trees: [], drifts: [], cracks: [], tussocks: [], prints: [], parts: [] });
    // темп времени: сейв со старыми сутками (cyc нет — 480) → те же день и час при нынешнем CYCLE
    const kT = CYCLE / (cyc || 480);
    if (kT !== 1) retime(G, kT);
    G.s.tire = G.s.tire || 0; G.s.awake = G.s.awake || 0; // усталость: старый сейв — свежие силы
    const r = mulberry(G.seed);
    World.gen(r); World.genLiving(r);
    // миграция старых сейвов (до отрастания леса): срубленное дерево без времени рубки — «пень со
    // временем рубки давно», уже почти дошедший до стадии молодого деревца — регрочится дальше как обычно
    for (const [i, w, sh, stage, cutAt] of treeD || []) {
      const t = G.trees[i]; if (!t) continue;
      t.wood = w; if (sh) t.shake = sh;
      if (cutAt != null) { t.stage = stage || 0; t.cutAt = cutAt * kT; }
      else if (w <= 0) { t.stage = 0; t.cutAt = G.time - TUNE.world.regrowStumpDays * CYCLE * 0.7; }
    }
    G.stashes = G.stashes || [];
    G.fog = unpackFog(fogB);
    if (typeof Trail !== 'undefined') Trail.load(trailB, trailF); // нет поля (старый сейв) — троп нет
    for (const k of LIVE) G[k] = unpackList(live && live[k]);
    for (const i of amGot || []) if (G.amuletsAt[i]) G.amuletsAt[i].got = 1;
    // ссылки → объекты
    (function fix(o) {
      for (const k in o) {
        const v = o[k];
        if (!v || typeof v !== 'object') continue;
        if (v.$ref) { const [list, i] = v.$ref; o[k] = G[list] ? G[list][i] || null : null; continue; }
        if (o === G && (k === 'trees' || SKIP.has(k))) continue;
        fix(v);
      }
    })(G);
    World.buildGrid(); GFX.reset(); Nav.reset();
    if (!G.col) { const a = G.amulets; Colony.init(); G.amulets = a || 0; }
    G.col.ghost = null;
    Npc.ensure(); // персонажи, которых не было в этом сейве
    Zones.initState(); Transport.initState();
    G.hand = G.hand || { p: [], t: null }; Inv.migrate();   // вещи с массой и объёмом: старые «числа» → вещи (js/inventory.js)
  }
  // пересчёт сейва на другой темп (k = новые сутки / старые): метки времени и календарное топливо ×k
  function retime(g, k) {
    const mul = (o, f) => { if (o && typeof o[f] === 'number') o[f] *= k; };
    mul(g, 'time'); if (g.storm) { mul(g.storm, 'a'); mul(g.storm, 'b'); }
    mul(g.flags, 'contactT'); mul(g.hut, 'fuel');
    for (const f of g.fires || []) { mul(f, 'fuel'); mul(f, 't0'); mul(f, 't1'); }
    for (const t of g.traps || []) mul(t, 't');
    for (const L of [g.litter, g.chunks, g.loose]) for (const q of L || []) mul(q, 't');
    for (const L of [g.logs, g.iceHoles, g.corpses, g.carcs]) for (const q of L || []) { mul(q, 't0'); mul(q, 'done'); }
    if (g.col) { mul(g.col, 'eatT'); for (const b of g.col.builds || []) { mul(b, 't'); if (b.type === 'tower') mul(b, 'fuel'); } }
  }
  return { V, snapshot, checkpoint: saveCheckpoint, problem, load, packFog, unpackFog };
})();
