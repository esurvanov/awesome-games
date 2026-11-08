'use strict';
// ================= СОБЫТИЯ СЮЖЕТА =================
// Событие = триггер → действия. Исполнитель — Story.tick (js/story.js), каждый шаг, по порядку списка.
// Поля:
//   id           — имя; однократность хранится в G.fired[id] (или по пути once: 'flags.x')
//   when(g, c)   — условие; c = {h — час, night — 0..1, dt}
//   do           — операции (Story.run): {toast} {dialog} {sound: [имя, …арг]} {set: путь, v} {inc: путь, max}
//                  {known: id|[id]} {npc: id, state, at: ключ SPOT} {end: концовка | g → концовка} {fn: g → …}
//   repeat: 1    — не однократное (проверяется каждый шаг)
//   tick(g, c)   — вместо when/do: «система» со своим состоянием (вертолёт); вернёт 'stop' — дальше не идём
// Конец игры ({end}) останавливает список на этом шаге.
const EVENTS = [
  { id: 'hutFound', once: 'flags.hutFound', when: g => g.p.inside || dist2(g.p, HUT) < 170 * 170, do: [{ known: 'hut' }] },
  // вой первой ночи: фраза и звук — по тому, где стая (Ctx): нет волков — далеко на северо-западе; стая рядом — «рядом»
  { id: 'E1', when: (g, c) => g.day === 1 && c.night > 0.6, do: [{ toast: g => Ctx.howl(Ctx.howlSrc().d, true) }, { sound: ['howl', 0, 0.12], at: () => Ctx.howlSrc() }] },
  { id: 'E2', when: (g, c) => g.day >= 2 && c.h >= 7 && g.urk.state === 'away',
    do: [{ npc: 'urk', state: 'hut', at: 'urkDoor' }, { toast: ':storm: У зимовья кто-то есть' }] },
  // Вера у хвоста: подошёл — разговор сам
  { id: 'E3', when: g => g.vera.state === 'tail' && dist2(g.vera, g.p) < 130 * 130 && !UI.modal(), do: [{ dialog: 'vera_found' }] },
  // осада: 21:00 3-го дня (или позже, пока глава III не закрыта)
  { id: 'E5', when: (g, c) => (g.day === 3 || (g.day > 3 && g.chapter === 2)) && c.h >= 21,
    do: [{ toast: ':wolf: Стая идёт к зимовью!' }, { dialog: 'siege_urk' }, { sound: ['howl', 0, 0.25], at: () => Ctx.howlSrc(900) }, { fn: g => { Wolves.spawnPack(4, true); g.pack.siege = 1; } }] },
  { id: 'siegeDone', once: 'flags.siegeDone', when: (g, c) => g.fired.E5 && (!g.pack || !g.pack.siege || (g.day >= 4 && c.h >= 7)),
    do: [{ toast: ':wolf: Стая отступила · осада снята' }] },
  // пурга и дверь: первая пурга с главы II — совет деда; после пурги нанос у двери 80–120 см — откопать (лопатой ~50 с, руками — дольше)
  { id: 'stormDoor', when: g => g.chapter >= 1 && g.storm && g.storm.omen && g.time < g.storm.b,
    do: [{ toast: ':evenk: Уркачан: «Дверь внутрь — чтоб откопаться. Лопату — в избу»' }] },
  { id: 'doorDrift', repeat: 1, when: g => g.storm && g.time >= g.storm.b && g.storm.drift !== 1 && (g.storm.drift = 1) && Trail.doorDepth() > 60,
    do: [{ toast: g => g.gear.shovel ? ':shovel: Дверь занесло · E — откапывать' : ':hand: Дверь занесло · E — разгребать руками' }] },
  // шатун: предвестник — следы у мари
  { id: 'E6', when: g => g.chapter >= 3,
    do: [{ toast: ':paw: Следы. Большие.' }, { fn: () => { for (let i = 0; i < 16; i++) Fx.print(POI.mar.x - 250 + i * 30, POI.mar.y + 180 + Math.sin(i) * 20, 0, 'b'); } }] },
  // вертолёт: после связи — каждое утро в 09:00, пока не заметят три огня на площадке
  { id: 'heli', tick: (g, c) => Story.heliTick(c.dt, c.h) },
  // концовка D по выбору: посёлок готов — предложить остаться (один раз сам, дальше — через деда)
  { id: 'dOffer', once: 'flags.dOffered', when: g => Story.colonyReady() && !g.flags.rescued && g.chapter <= 3 && !UI.modal() && !g.p.sleeping, do: [{ dialog: 'col_choice' }] },
  // «остаёмся»: ветка посёлка — глава V «Промысел» (малый мир без зон — сразу концовка D)
  { id: 'stayD', when: g => g.flags.stayD && !UI.modal() && g.chapter <= 3,
    do: [{ fn: g => { if (ZONES.drill.active) Story.go('V'); else Game.end('D'); } }] },
  // ---------- глава VI «Зимовка»: запасы (фиксируются, как только собраны) и большая пурга ----------
  { id: 'winterWood', once: 'flags.winterWood', when: g => g.chapter === 5 && (g.chest.wood || 0) >= STORY.winter.wood,
    do: [{ toast: ':wood: Дров на пургу хватит' }] },
  { id: 'winterFood', once: 'flags.winterFood', when: g => g.chapter === 5 && FOOD_KEYS.reduce((s, k) => s + (g.chest[k] || 0), 0) >= STORY.winter.food,
    do: [{ toast: ':food: Еды на пургу хватит' }] },
  { id: 'bigStormDone', once: 'flags.bigStormDone', when: g => g.chapter === 5 && g.storm && g.storm.big && g.time >= g.storm.b,
    do: [{ toast: ':storm: Большая пурга стихла · посёлок выстоял' }, { sound: ['ok2'] }] },
  // ---------- глава VII «Экспедиция»: сборы, путь, сеанс, борт ----------
  { id: 'expPacked', once: 'flags.expPacked', when: g => g.chapter === 6 && Inv.cnt('food', false) + Inv.cnt('honey', false) >= 4,
    do: [{ toast: ':food: Припасы в рюкзаке — можно идти' }] },
  { id: 'expArrived', once: 'flags.expArrived', when: g => g.chapter === 6 && Zones.idAt(g.p.x, g.p.y) === 'meteo' && Math.hypot(g.p.x - ZONES.meteo.x, g.p.y - ZONES.meteo.y) < 600,
    do: [{ toast: ':radio: Кербо-2 · дым из трубы — живые' }, { fn: g => { if (!g.flags.veraDead && g.vera.state === 'follow' && !UI.modal()) UI.dialog(DIALOG.exp_arrive); } }] },
  // борт после сеанса: на следующий день с 09 до 12 — если герой у метеостанции
  { id: 'expHeli', repeat: 1, when: (g, c) => g.flags.expCalled && !g.flags.expRescued && g.day > g.flags.expCallDay && c.h >= STORY.heli.from && c.h < STORY.heli.to,
    do: [{ fn: g => {
      if (Zones.idAt(g.p.x, g.p.y) === 'meteo') { g.flags.expRescued = 1; Sound.src(ZONES.meteo).heli(); Fx.toast(':heli: Ми-8 садится у мачты!'); }
      else if (g.fired.expHeliDay !== g.day) { g.fired.expHeliDay = g.day; Fx.toast(':heli: Борт кружит над Кербо-2 — к мачте, до полудня!'); Sound.src(ZONES.meteo).heli(); }
    } }] },
  // не успел за STORY.expDays суток — поход кончился зимовкой у деда (концовка C)
  { id: 'expLate', when: (g, c) => g.chapter === 6 && !g.flags.expCalled && g.day >= (g.flags.expDay || g.day) + STORY.expDays && c.h >= TUNE.time.wakeAt,
    do: [{ end: 'C' }] },
  // спасение: борт сел — через rescueT с концовка A (все) или B (один)
  { id: 'rescued', tick: (g, c) => {
    if (!(g.rescueT > 0)) return;
    g.rescueT -= c.dt;
    if (g.rescueT <= 0) { Game.end(STORY.rescueEnding(g)); return 'stop'; }
  } },
  // главы: цели текущей закрыты → следующая
  { id: 'chapters', tick: () => Story.chapterTick() },
];
