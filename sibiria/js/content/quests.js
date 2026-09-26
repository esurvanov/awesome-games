'use strict';
// ================= ЗАДАНИЯ =================
// Задание = одна запись (схема A6 по мотивам CDDA: цель, реплики, награда, продолжение). Исполнитель — js/quests.js.
// Поля:
//   giver        — кто даёт (NPCS); в talk персонажа — правило {quest: id}: узел по стадии задания
//   goal         — give (принести item×n: кнопка «отдать» в разговоре) · kill_type (target) · condition (cond)
//                  · find (набрать count(g) до n; проверка — Quests.check(id)) · go_to (место at)
//   available(g) — когда задание можно предложить (по умолчанию — всегда)
//   started / accepted / cond / done — пути в G ('flags.x', 'urk.y') или функции g → bool:
//                  started — предложено; accepted — взято; cond — цель выполнена; done — награда получена
//   d            — реплики: offer (узел-предложение) · ask/give/notYet (для give) · success (узел-сдача)
//   acts         — act узлов диалога → операции (Story.run) или 'complete' (сдать: забрать item, done, reward)
//   reward       — операции награды (Story.run)
//   marker       — куда указывает компас, если у главы нет открытой цели с меткой (ключ MARKERS | 'npc:id' | 'obj:id';
//                  или g → ключ)
//   hud          — [иконка, текст] строки задания в плашке целей (пока взято и не сдано)
//   next         — задание, которое открывается следом (для цепочек)
//   deadline     — срок в днях от взятия (не используется в I–IV)
const QUESTS = {
  // Уркачан: «принеси две заячьи шкурки» → уважение, лайка Пурга, торговля
  pelts: {
    giver: 'urk', goal: 'give', item: 'hare', n: 2, wc: false,
    started: 'flags.metUrk', accepted: 'flags.metUrk', done: 'flags.urkPelts',
    d: { offer: 'urk_meet', ask: 'Две заячьи шкурки принёс?', give: 'Отдать :hare:×2', notYet: 'Пока нет', success: 'urk_pelts' },
    acts: {
      metUrk: [{ set: 'flags.metUrk' }, { npc: 'urk', state: 'walk' }, { known: ['chum', 'cedar'] }],
      urkPelts: 'complete',
    },
    reward: [
      { inc: 'urk.respect' },
      { fn: g => { // дед отдаёт лайку — чует волков
        if (g.col.units.some(u => u.pet)) return;
        const d = Colony.spawn('laika', { pet: 1, x: g.urk.x, y: g.urk.y + 20 }); d.task = { k: 'guard' };
        setTimeout(() => Fx.toast(':dog: Дед отдал лайку Пургу — чует волков'), 1500);
      } },
    ],
    marker: 'urk',
  },
  // Уркачан: «отгони вожака с рваным ухом» (глава III+) → уважение
  wolf: {
    giver: 'urk', goal: 'kill_type', target: 'wolfLeader',
    available: g => g.chapter >= 2,
    started: 'flags.wolfAsked', accepted: 'urk.wolfQuest', cond: 'flags.leaderDone', done: 'flags.wolfThanked',
    d: { offer: 'urk_wolf', success: 'urk_wolf_done' },
    acts: {
      wolfQuest: [{ set: 'urk.wolfQuest' }, { set: 'flags.wolfAsked' }],
      wolfNo: [{ set: 'flags.wolfAsked' }],
      wolfDone: 'complete',
    },
    reward: [{ inc: 'urk.respect', max: 3 }],
    marker: 'urk',
  },
  // духи тайги: 12 сэвэков по миру → уважение деда (сдаётся само, при последнем обереге)
  amulets: {
    giver: 'urk', goal: 'find', item: 'amulet', n: TUNE.world.amulets, count: g => g.amulets,
    reward: [{ inc: 'urk.respect', max: 3 }, { toast: ':sevek: Все духи собраны · :evenk: дед +1' }],
  },

  // ================= люди зон (A6) =================
  // Цели: give · kill_type · find · condition (go_to/talk — через condition: флаг ставит правило talk другого
  // персонажа, напр. деда). Новых типов цели не понадобилось.
  // 🌡️ Тамара: 2 канистры керосина для генератора → прогноз пурги, торг; дальше — мачта
  tamara_kero: {
    giver: 'tamara', goal: 'give', item: 'kero', n: 2, wc: false,
    started: 'flags.tamaraAsked', accepted: 'flags.tamaraAsked', done: 'flags.tamaraKero',
    d: { offer: 'tam_meet', ask: 'Керосин? Две канистры. Генератор не пьёт — он дегустирует.', give: 'Отдать :kero:×2', notYet: 'Пока нет', success: 'tam_kero_ok' },
    acts: { tamAsk: [{ set: 'flags.tamaraAsked' }], tamKero: 'complete' },
    reward: [{ toast: ':storm: Генератор ожил · у Тамары — прогноз и торг' }],
    marker: 'npc:tamara', hud: [':kero:', 'Керосин Тамаре ×2'],
  },
  // 🌡️ Тамара: 2 куска кабеля на антенну мачты → передатчик слышит Туру (глава VII)
  tamara_mast: {
    // «потом» — не предлагать до завтра (в походе, глава VII, — сразу снова: без мачты не дойти до Туры)
    giver: 'tamara', goal: 'give', item: 'cable', n: 2, wc: false, available: g => g.flags.tamaraKero && (g.fired.mastLater !== g.day || g.chapter === 6),
    started: 'flags.mastAsked', accepted: 'flags.mastAsked', done: 'flags.mastFixed',
    d: { offer: 'tam_mast', ask: 'Кабель для мачты — два куска? Короткий не несите, я сама невысокая.', give: 'Отдать :cable:×2', notYet: 'Пока нет', success: 'tam_mast_ok' },
    acts: { mastAsk: [{ set: 'flags.mastAsked' }], mastLater: [{ fn: g => { g.fired.mastLater = g.day; } }], mastOk: 'complete' },
    reward: [{ toast: ':antenna: Антенна на мачте · сеанс с Турой 08:00 / 20:00' }],
    marker: 'npc:tamara', hud: [':cable:', 'Кабель на мачту ×2'],
  },
  // 🛢️ Михалыч: 3 мяса вахте → «Буран» на ходу + 2 керосина
  mikh_meat: {
    giver: 'mikhalych', goal: 'give', item: 'meat', n: 3, wc: false,
    started: 'flags.mikhAsked', accepted: 'flags.mikhAsked', done: 'flags.mikhMeatDone',
    d: { offer: 'mikh_meet', ask: 'Мясо принёс? Три куска. Макароны нам уже снятся. В строю.', give: 'Отдать :meat:×3', notYet: 'Пока нет', success: 'mikh_meat_ok' },
    acts: { mikhAsk: [{ set: 'flags.mikhAsked' }], mikhMeat: 'complete' },
    reward: [{ add: { kero: 2 } }, { fn: g => { if (g.veh && g.veh.buran) g.veh.buran.fixed = 1; } }, { toast: ':sled: Вахта поставила «Буран» на ход · :kero:×2' }],
    marker: 'npc:mikhalych', hud: [':meat:', 'Мясо вахте ×3'],
  },
  // 🛢️ Михалыч: шатун ломится в балок (глава IV+) → 3 керосина и кабель
  mikh_bear: {
    giver: 'mikhalych', goal: 'kill_type', target: 'bear', available: g => g.flags.mikhMeatDone && g.chapter >= 3 && !g.flags.bearDead,
    started: 'flags.mikhBearAsked', accepted: 'flags.mikhBear', cond: 'flags.bearDead', done: 'flags.mikhBearDone',
    d: { offer: 'mikh_bear', success: 'mikh_bear_ok' },
    acts: { mikhBear: [{ set: 'flags.mikhBear' }, { set: 'flags.mikhBearAsked' }], mikhBearNo: [{ set: 'flags.mikhBearAsked' }], mikhBearOk: 'complete' },
    reward: [{ add: { kero: 3, cable: 1 } }, { toast: ':bear: Вахта благодарит · :kero:×3 :cable:' }],
    marker: 'mar', hud: [':bear:', 'Шатун — проводить'],
  },
  // 🏪 Ефимыч: долг деда — 5 соболей → уважение деда, лечение Веры, скидка
  efim_debt: {
    giver: 'efimych', goal: 'give', item: 'sable', n: 5, wc: false,
    started: 'flags.efimAsked', accepted: 'flags.efimAsked', done: 'flags.efimDebtDone',
    d: { offer: 'efim_meet', ask: 'Долг деда — пять соболей. Принёс? Книга ждёт. Книга терпеливая.', give: 'Отдать :sable:×5', notYet: 'Пока нет', success: 'efim_debt_ok' },
    acts: { efimAsk: [{ set: 'flags.efimAsked' }], efimDebt: 'complete' },
    reward: [{ inc: 'urk.respect', max: 3 }, { set: 'flags.veraHealed' }, { toast: ':evenk: Долг деда закрыт · :person: Вере — мазь и костыль' }],
    marker: 'npc:efimych', hud: [':sable:', 'Долг деда: соболь ×5'],
  },
  // 🪶 Уялан: 6 сэвэков → своя упряжка насовсем
  uyal_sevek: {
    giver: 'uyalan', goal: 'find', item: 'amulet', n: 6, count: g => g.amulets,
    available: g => g.flags.metUyalan && g.fired.uyalSevekLater !== g.day,
    started: 'flags.uyalSevekAsked', accepted: 'flags.uyalSevek', done: 'flags.uyalSevekDone',
    d: { offer: 'uyal_sevek', success: 'uyal_sevek_ok' },
    acts: { uyalSevek: [{ set: 'flags.uyalSevek' }, { set: 'flags.uyalSevekAsked' }], uyalSevekLater: [{ fn: g => { g.fired.uyalSevekLater = g.day; } }], uyalSevekOk: 'complete' },
    reward: [{ fn: g => { const u = Npc.state('uyalan'); g.veh.deer = { x: u.x + 70, y: u.y + 60, face: 1, until: 9999 }; } }, { set: 'flags.ownDeer' },
      { toast: ':deer: Уялан отдала упряжку — насовсем' }],
    marker: 'npc:uyalan', hud: [':sevek:', 'Сэвэки для Уялан ×6'],
  },
  // 🪶 Уялан: весточка брату (condition: флаг ставит разговор с дедом) → уважение деда
  uyal_brother: {
    giver: 'uyalan', goal: 'condition', available: g => g.flags.metUyalan && g.urk.state !== 'away',
    started: g => g.flags.uyalBrotherAsk || g.flags.uyalBrotherNo, accepted: 'flags.uyalBrotherAsk', cond: 'flags.urkSister', done: 'flags.uyalBrotherDone',
    d: { offer: 'uyal_brother', success: 'uyal_brother_ok' },
    acts: { uyalBrother: [{ set: 'flags.uyalBrotherAsk' }], uyalBrotherNo: [{ set: 'flags.uyalBrotherNo' }], uyalBrotherOk: 'complete' },
    reward: [{ inc: 'urk.respect', max: 3 }, { toast: ':evenk: Брат и сестра — снова на связи · дед +1' }],
    marker: g => g.flags.urkSister ? 'npc:uyalan' : 'urk', hud: [':evenk:', 'Весточка деду от сестры'],
  },
  // ✝️ Агафон: 8 жердей (дрова) на ограду → мёд, торг, лечение Веры
  agaf_fence: {
    giver: 'agafon', goal: 'give', item: 'wood', n: 8, wc: false,
    started: 'flags.agafAsked', accepted: 'flags.agafAsked', done: 'flags.agafFence',
    d: { offer: 'agaf_meet', ask: 'Жерди принёс? Восемь. Ограда сама не встанет, она не бес.', give: 'Отдать :wood:×8', notYet: 'Пока нет', success: 'agaf_fence_ok' },
    acts: { agafAsk: [{ set: 'flags.agafAsked' }], agafFence: 'complete' },
    reward: [{ add: { honey: 2 } }, { toast: ':food: Мёд ×2 · Агафон меняется и лечит' }],
    marker: 'npc:agafon', hud: [':wood:', 'Жерди Агафону ×8'],
  },
  // 🧥 Толян: 2 банки тушёнки → склад на гари
  toly_stash: {
    giver: 'tolyan', goal: 'give', item: 'can', n: 2, wc: false,
    started: 'flags.tolyAsked', accepted: 'flags.tolyAsked', done: 'flags.stashKnown',
    d: { offer: 'toly_meet', ask: 'Две банки есть? Меняю на адрес. Честный обмен — редкость в наших краях.', give: 'Отдать :can:×2', notYet: 'Пока нет', success: 'toly_stash_ok' },
    acts: { tolyAsk: [{ set: 'flags.tolyAsked' }], tolyStash: 'complete' },
    reward: [{ toast: ':labaz: Толян показал склад на гари' }],
    marker: 'npc:tolyan', hud: [':can:', 'Тушёнка Толяну ×2'],
  },
  // 🧥 Толян: прикрыть (он идёт в посёлок бичом) или сдать деду (дед +1, Толян уходит на зимник)
  toly_fate: {
    giver: 'tolyan', goal: 'condition', available: g => g.flags.stashKnown,
    started: 'flags.tolyFate', accepted: 'flags.tolyFate', cond: () => true, done: 'flags.tolyDone',
    d: { offer: 'toly_fate', success: 'toly_fate' },
    acts: {
      tolyCover: [{ set: 'flags.tolyanCover' }, { set: 'flags.tolyFate' }],
      tolyTell: [{ set: 'flags.tolyanTell' }, { set: 'flags.tolyFate' }],
      tolyDone: 'complete',
    },
    reward: [{ fn: g => {
      Npc.state('tolyan').state = 'gone';
      if (g.flags.tolyanCover && g.col) { Colony.spawn('bich'); Fx.toast(':bich: Толян пришёл в посёлок — рубит дрова'); }
      else if (g.flags.tolyanTell) Fx.toast(':evenk: Толян ушёл на зимник · скажи деду');
    } }],
  },
  // 🎯 Коченины: 3 волка с путика → 2 соболя и капкан
  koch_wolves: {
    giver: 'kochenin', goal: 'kill_type', target: 'wolf',
    started: 'flags.kochAsked', accepted: 'flags.kochWolves', cond: g => g.stats.wolves - (g.flags.kochW0 || 0) >= 3, done: 'flags.kochWolvesDone',
    d: { offer: 'koch_meet', success: 'koch_wolves_ok' },
    acts: {
      kochWolves: [{ set: 'flags.kochWolves' }, { set: 'flags.kochAsked' }, { fn: g => { g.flags.kochW0 = g.stats.wolves; } }],
      kochNo: [{ set: 'flags.kochAsked' }],
      kochWolvesOk: 'complete',
    },
    reward: [{ add: { sable: 2, trap: 1 } }, { toast: ':sable: Коченины: соболь ×2 и капкан' }],
    marker: 'npc:kochenin', hud: [':wolf:', 'Три волка с путика Кочениных'],
  },
  // 🎯 Коченины: помирить с дедом (condition: дед соглашается при уважении ≥ 2)
  koch_peace: {
    giver: 'kochenin', goal: 'condition', available: g => g.flags.kochWolvesDone,
    started: 'flags.kochPeaceAsked', accepted: 'flags.kochPeaceAsk', cond: 'flags.kochPeaceUrk', done: 'flags.kochPeace',
    d: { offer: 'koch_peace', success: 'koch_peace_ok' },
    acts: { kochPeaceAsk: [{ set: 'flags.kochPeaceAsk' }, { set: 'flags.kochPeaceAsked' }], kochPeaceNo: [{ set: 'flags.kochPeaceAsked' }], kochPeaceOk: 'complete' },
    reward: [{ inc: 'urk.respect', max: 3 }, { add: { sable: 1 } }, { toast: ':trap: Путик поделили у горелой лиственницы · дед +1' }],
    marker: g => g.flags.kochPeaceUrk ? 'npc:kochenin' : 'urk', hud: [':trap:', 'Помирить Кочениных с дедом'],
  },
  // ✉️ Вася: письмо Семёныча Гале (condition: записка «Галя…» прочитана) → керосин, чай
  vasya_letter: {
    giver: 'vasya', goal: 'condition',
    started: 'flags.vasyaMet', accepted: 'flags.vasyaMet', cond: g => !!g.notes.wife, done: 'flags.vasyaLetter',
    d: { offer: 'vasya_meet', success: 'vasya_letter_ok' },
    acts: { vasyaMet: [{ set: 'flags.vasyaMet' }], vasyaLetter: 'complete' },
    reward: [{ add: { kero: 1, tea: 1 } }],
    marker: g => g.notes.wife ? 'npc:vasya' : null, hud: [':log:', 'Письмо Семёныча — почтой'],
  },
};
