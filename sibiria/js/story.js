'use strict';
// Исполнитель сюжета: события (EVENTS), главы (CHAPTERS), операции действий, вертолёт, компас.
// Данные — js/content/*.js; здесь только «как выполнить».
const Story = (() => {
  // ---------- пути в G: 'flags.metUrk', 'urk.respect' ----------
  const get = path => { let o = G; for (const k of path.split('.')) { if (o == null) return undefined; o = o[k]; } return o; };
  function set(path, v = 1) { const ks = path.split('.'), last = ks.pop(); let o = G; for (const k of ks) o = o[k] = o[k] || {}; o[last] = v; }

  // ---------- операции (do / acts / reward / onEnter) ----------
  const OPS = {
    set: o => set(o.set, o.v === undefined ? 1 : o.v),
    inc: o => { const v = get(o.inc) || 0; if (o.max === undefined || v < o.max) set(o.inc, v + 1); },
    known: o => { for (const k of [].concat(o.known)) G.known[k] = 1; },
    toast: o => { if (o.delay) setTimeout(() => Fx.toast(o.toast), o.delay); else Fx.toast(o.toast); },
    dialog: o => { if (DIALOG[o.dialog]) UI.dialog(DIALOG[o.dialog]); },
    sound: o => { const [k, ...a] = o.sound; Sound[k](...a); },
    npc: o => { const st = Npc.state(o.npc); st.state = o.state; if (o.at) { st.x = SPOT[o.at].x; st.y = SPOT[o.at].y; } },
    end: o => Game.end(typeof o.end === 'function' ? o.end(G) : o.end),
    add: o => { for (const [k, v] of Object.entries(o.add)) Inv.add(k, v); },   // выдать предметы в рюкзак {kero: 2}
    chapter: o => go(o.chapter),                                                // перейти в главу (номер 'V' | индекс)
    fn: o => o.fn(G),
  };
  function run(ops) {
    if (typeof ops === 'function') return ops(G);
    for (const o of ops) {
      const k = Object.keys(OPS).find(k => k in o);
      if (k) OPS[k](o);
      if (state !== 'play' && k === 'end') return;
    }
  }
  // act узла диалога: задание (QUESTS[*].acts) или персонаж (NPCS[*].acts)
  function act(a) {
    if (Quests.act(a)) return;
    for (const id in NPCS) { const x = NPCS[id].acts && NPCS[id].acts[a]; if (x) { run(x); return; } }
  }

  // ---------- события: по порядку списка, каждый шаг ----------
  function tick(dt, h, night) {
    const c = { dt, h, night };
    for (const e of EVENTS) {
      if (e.tick) { if (e.tick(G, c) === 'stop' || state !== 'play') return; continue; }
      const once = e.once || (e.repeat ? null : 'fired.' + e.id);
      if (once && get(once)) continue;
      if (!e.when(G, c)) continue;
      if (once) set(once, 1);
      run(e.do);
      if (state !== 'play') return;
    }
  }

  // ---------- вертолёт ----------
  function heliTick(dt, h) {
    const f = G.flags, H = STORY.heli;
    if (!f.contact || f.rescued || G.chapter > 3) return; // в ветках V–VII борт к мари не летает
    // борт вылетает в 09:00, но не раньше чем через 20 ч после связи (утро → завтра, вечер → послезавтра)
    const waitT = f.contactT != null ? G.time - f.contactT >= CYCLE * H.waitH / 24 : G.day > f.contactDay;
    if (!G.heli && waitT && h >= H.from && h < H.to && G.heliDay !== G.day) {
      G.heli = { t: H.t, snd: 0 }; G.heliDay = G.day; G.known.mar = 1;
      Fx.toast(padDone() ? ':heli: Гул винтов! Зажги три кучи на мари!' : ':heli: Гул винтов! Площадки нет — сесть не на что…'); if (DIALOG.heli_hum) UI.dialog(DIALOG.heli_hum);
    }
    if (G.heli) {
      G.heli.t -= dt; G.heli.snd -= dt;
      if (G.heli.snd <= 0) { G.heli.snd = H.snd; Sound.heli(); }
      if (G.stacks.every(s => s.lit > 0) && padDone()) {
        f.rescued = 1; G.heli = null; G.rescueT = STORY.rescueT; f.rescueReady = 1; Fx.toast(':heli: Заметили! Садится!'); Sound.ok2(); UI.card(':heli:', 'Борт 24713 — домой', 'Заметили! Садится на марь.'); G.aurora = 1;
      } else if (G.heli.t <= 0) {
        G.heli = null; f.heliMiss = 1;
        if (G.day >= STORY.heliLastDay) { if (noHeli()) return 'stop'; return; }
        Fx.toast(padDone() ? ':heli: Не заметили… Завтра в 09:00' : ':heli: Покружил и ушёл — сесть негде. Завтра в 09:00 · :pad:');
      }
    }
  }

  // ---------- главы ----------
  // номер главы ('V') или индекс → индекс в CHAPTERS
  const chIndex = k => typeof k === 'number' ? k : CHAPTERS.findIndex(c => c.num === k);
  // войти в главу: карточка, операции входа, чекпоинт
  function go(k) {
    const i = chIndex(k); if (i < 0 || !CHAPTERS[i]) return;
    G.chapter = i; UI.chapter(i);
    if (CHAPTERS[i].onEnter) run(CHAPTERS[i].onEnter);
    if (state === 'play') SaveGame.checkpoint();
  }
  // все цели главы закрыты (alt — не обязательны): end — концовка ветки; next — следующая глава
  // (по умолчанию — следующая по списку; next: null — глава закрывается только концовкой)
  function chapterTick() {
    const ch = CHAPTERS[G.chapter];
    if (!ch || !ch.goals.every(g => g.alt || g.ok(G))) return;
    if (ch.end) { Game.end(typeof ch.end === 'function' ? ch.end(G) : ch.end); return 'stop'; }
    if (ch.next === null) return;
    const nx = ch.next === undefined ? G.chapter + 1 : chIndex(ch.next);
    if (CHAPTERS[nx]) go(nx);
  }
  // без вертолёта (упущен последний борт / 8-й день): STORY.noHeli → глава ветки или концовка.
  // true — игра кончилась (дальше шаг не идёт)
  function noHeli() {
    const b = STORY.noHeli(G);                       // 'C' | 'D' — концовка; {chapter: 'V' | 'VII'} — ветка
    if (typeof b === 'string') { Game.end(b); return true; }
    if (CHAPTERS[G.chapter].num !== b.chapter) go(b.chapter);
    return false;
  }
  // без вертолёта: посёлок (эпоха III, 6 человек) — ветка D, иначе — поход (C)
  const colonyReady = () => !!(G.col && G.col.ep >= STORY.dEp && Colony.pop() >= STORY.dPop);

  // ---------- компас: первая открытая цель главы → точка; нет её — взятое задание ----------
  // ключ метки: MARKERS[k] (js/content/chapters.js) или 'npc:id' (персонаж), 'zone:id' (якорь зоны, если зона на карте),
  // 'obj:id' (объект зоны: участок, склад)
  function markAt(k) {
    if (!k) return null;
    if (MARKERS[k]) return MARKERS[k](G);
    const i = k.indexOf(':'), t = k.slice(0, i), id = k.slice(i + 1);
    if (t === 'npc') { const r = NPCS[id], st = r && Npc.state(id); return st && !((r.states && r.states[st.state]) || {}).hidden ? st : null; }
    if (t === 'zone') { const z = ZONES[id]; return z && z.active && G.zoneSeen && G.zoneSeen[id] ? z : null; }
    if (t === 'obj') { const o = Zones.obj(id); return o && Zones.here(o) ? o : null; }
    return null;
  }
  let goalCacheT = null, goalCalcT = 0;
  function goalTarget() {
    if (now - goalCalcT < 0.25) return goalCacheT;
    goalCalcT = now;
    const ch = CHAPTERS[G.chapter]; if (!ch) return (goalCacheT = null);
    const g = ch.goals.find(g => !g.alt && !g.ok(G));
    let t = g ? markAt(g.at) : null, ic = g ? g.ic : null;
    const over = g && ch.marker && ch.marker(G); if (over) t = over;
    if (!t) for (const id of Quests.active()) { const q = QUESTS[id], m = markAt(typeof q.marker === 'function' ? q.marker(G) : q.marker); if (m) { t = m; ic = q.hud ? q.hud[0] : ':pin:'; break; } }
    goalCacheT = t ? { x: t.x, y: t.y, ic } : null;
    return goalCacheT;
  }

  return { get, set, OPS, run, act, tick, heliTick, chapterTick, colonyReady, goalTarget, go, chIndex, noHeli, markAt };
})();
