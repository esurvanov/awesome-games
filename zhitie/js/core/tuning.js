// Все числа баланса «Житьё» — единственный источник (docs/CONTRACT.md §0.2).
// ✅ — из research-sims-mechanics.md (TS1/FreeSO), ≈ — наше приближение, проверяется тестом-харнессом tests/sim-balance.test.mjs.

// ── Время ─────────────────────────────────────────────────────────────
export const TIME = {
  tickMinutes: 2,                 // ✅ потребности тикают раз в 2 игровые минуты (30 раз в час)
  minutesPerRealSec: 1,           // ✅ 1 игровая минута = 1 реальная секунда на скорости 1
  speeds: [0, 1, 3, 10],          // ≈ state.time.speed 0|1|2|3 → множитель (пауза / ×1 / ×3 / ×10)
  autoUltra: 10,                  // ✅ все спят или на работе → авто-ускорение (≈ множитель)
  maxRealDt: 0.25,                // защита от скачка кадра (вкладка в фоне)
  subStep: 0.5,                   // шаг интегрирования ходьбы/таймеров, игровые минуты
  startMinutes: 8 * 60,           // ✅ въезд в 07:00–08:00
  dayMinutes: 24 * 60,
  thinkCooldown: 3,               // ≈ пауза автономии, если выбрать нечего (игр. мин)
  staggerMinutes: 1.5,            // ≈ сдвиг первого решения у каждого следующего домочадца
};

// ── Потребности (TS1, FreeSO VMTS1MotiveDecay) ────────────────────────
export const MOTIVE_RANGE = [-100, 100];
export const DECAY = {                           // очков в игровой ЧАС
  hungerK: 0.063,                 // ✅ 0.063·(100+H)/ч: 12.6 при 100, 6.3 при 0
  hungerMin: 1.5,                 // ≈ нижняя граница, иначе экспонента не доходит до −100 (голодная смерть невозможна)
  comfort: { lowActive: 18, midActive: 15, highActive: 12 },   // ✅ Active <6.66 / =6.66 / >6.66
  hygiene: { awake: 5.1, asleep: 2.4 },                         // ✅
  bladder: { awake: 9, asleep: 4.5, perHungerDecay: 0.3 },      // ✅ + 0.3 × скорость падения голода
  bladderPerHungerGain: 0.2,      // ≈ еда наполняет мочевой пузырь: −0.2 за каждое очко сытости
  energy: { awake: 11.25, passedOutGain: 38.6 },                // ✅ 180 очков за 16 ч бодрствования
  fun: { awake: 7.5, asleep: 0 },                               // ✅
  social: { base: 0.055, perOutgoing: 0.0125 },                 // ✅ (0.055+0.000125·Outgoing[0..1000])·30 → 1.65…5.4/ч; здесь Outgoing 0..10
};

// ── Настроение и провалы ──────────────────────────────────────────────
export const MOOD = {
  bad: -10,                       // ≈ ниже — «плохое настроение»: без навыков, без поиска работы, без карпула по своей воле
  urgent: -60,                    // ≈ досуг прерывается, если другая потребность ниже
  critical: -85,                  // ≈ даже сон прерывается (мочевой пузырь, голод)
  runBelow: -70,                  // ≈ сим бежит к цели, если ведущая потребность ниже
  thoughtBelow: -40,              // ≈ пузырь-мысль с иконкой потребности
};
export const FAILURE = {
  puddle: { hygiene: -40, comfort: -20 },   // ≈ мочевой пузырь на −100 → лужа, пузырь → 100
  passOut: { untilEnergy: 40, comfort: -30 },// ✅ уснул на полу; ≈ до 40 энергии
  starveAt: -100,                            // ✅ голод на −100 → смерть
};

// ── Кривые оценки автономии (FreeSO VMFindBestAction) ─────────────────
// Кривая «неудовольствия»: высокая при низкой потребности, плоская при высокой. ≈ точки (global.iff закрыт).
export const SCORE_CURVE = {
  default: [[-100, 100], [-50, 60], [0, 25], [50, 5], [100, 0]],
  fun:     [[-100, 100], [-50, 60], [0, 30], [70, 5], [100, 0]],
  social:  [[-100, 100], [-50, 60], [0, 30], [70, 5], [100, 0]],
};
export const AUTONOMY = {
  weight: 1 / 9,                  // ✅ равные веса по 9 входам
  atten: { none: 0, low: 0.1, medium: 0.3, high: 0.6 },   // ✅ деление на (1 + atten·дистанция)
  minScore: 1e-7, minScoreSitting: 1e-6,                  // ✅
  topN: 4,                        // ✅ top-4 → взвешенный случайный выбор
  persFactor: t => 0.5 + t / 10,  // ≈ Nice/Outgoing… 0..10 → ×0.5..×1.5 к обещанию рекламы
  blockedMinutes: 30,             // ≈ «не могу дойти» — предмет исключается на 30 мин
  nightSleep: { from: 21, to: 6, energyMin: 60, mult: 1.5 },  // ≈ ночью кровать рекламируется раньше (иначе сон уезжает в день)
  wanderChance: 0.25, wanderRadius: 4,                    // ≈ праздное блуждание
};

// ── Очередь ───────────────────────────────────────────────────────────
export const PRIORITY = { max: 100, user: 50, parentIdle: 40, carpool: 45, parentExit: 30, auto: 2, idle: 0 };  // ✅ (+ carpool ≈)
export const QUEUE_MAX = 8;       // ✅ ≈ 8 иконок

// ── Ходьба и анимации ─────────────────────────────────────────────────
export const WALK = {
  tilesPerMinute: 1.6,            // ≈ 1.6 тайла/с реального времени на ×1
  runMult: 1.6,
  arriveEps: 0.05,
  socialDist: 1.8,                // дистанция, с которой можно общаться
  socialRetries: 3,
  socialWait: 10,                 // ≈ ждать занятого собеседника, мин
};
export const ANIM_MIN = { entry: 1, exit: 1, once: 1 };   // длительность одноразовых клипов, игр. мин

// ── Выведение эффектов из рейтингов каталога (0–10) ───────────────────
// Все формулы ≈: рейтинг карточки → скорость восстановления (минута) и обещание рекламы.
export const DERIVE = {
  adDelta: r => r * 10,                          // обещание = рейтинг × 10
  comfortPerMin: r => r * 8 / 60,                // стул 2 → 16/ч, диван 5 → 40/ч, кровать 6 → 48/ч
  energyPerMin: r => (10 + 2 * r) / 60,          // кровать 7 → 24/ч, диван 3 → 16/ч
  hygienePerMin: r => r * 0.5,                   // душ 6 → 3/мин
  bladderPerMin: r => r * 1.25,                  // унитаз 8 → 10/мин
  funPerMin: r => r * 0.2,                       // ТВ 4 → 48/ч, компьютер 5 → 60/ч
  mealTotal: r => 40 + 5 * r,                    // холодильник+плита 6 → 70 сытости за ужин
  mealPerCookingPoint: 0.05,                     // +5 % сытости за очко кулинарии
  snackTotal: 20,
};

// ── Навыки ────────────────────────────────────────────────────────────
export const SKILLS = {
  list: ['cooking', 'mechanical', 'charisma', 'body', 'logic', 'creativity'],
  max: 10,
  perHour: level => 0.8 / (1 + 0.15 * level),   // ≈ 1.25 ч на 1-е очко, ~2 ч на 5-е, ~3 ч на 10-е
};

// ── Отношения и общение ───────────────────────────────────────────────
export const REL = {
  range: [-100, 100],
  enemy: -50, acquaintance: 25, warm: 25, friend: 50, crush: 70,   // ✅ crush ≥ 70 — романтика
  decayPerDay: 2, decayHour: 16,                                   // ✅ −2/день в 16:00 (тем, кого нет на участке)
  initiatorShare: 0.7,
  householdStart: 30,             // ≈ домочадцы при заселении — «тёплые» знакомые            // ≈ инициатор меняет своё отношение на 70 % от дельты цели
};
// accept: вероятность = clamp(0.5 + (rel − minRel)/60 + moodЦели/200 + личность, 0.05, 0.97)
export const SOCIAL = {
  acceptSpan: 60, moodDiv: 200, pMin: 0.05, pMax: 0.97, persDiv: 20,
  talkTopicEvery: 3,
  pairCooldown: 45,
  groupMax: 2, groupRadius: 3,    // ≈ общий разговор: до 2 соседей в радиусе 3 тайлов               // ≈ та же пара не болтает снова 45 мин (автономно)              // смена иконки темы разговора, мин
  townies: ['Пётр Сидоров', 'Галина Орлова', 'Виктор Лебедев', 'Нина Козлова', 'Аркадий Смирнов', 'Зоя Павлова'],
  phoneChatRel: 0.25,             // отношение/мин при телефонном разговоре
};

// ── Деньги ────────────────────────────────────────────────────────────
export const MONEY = {
  start: 20000,                   // ✅ ≈
  billEveryDays: 3,               // ✅
  billRate: 0.03,                 // ✅ 3 % амортизированной стоимости
  repoAfterDays: 5,               // ≈ неоплаченный счёт → коллектор
  repoPenalty: 0.1,               // ≈ +10 % при принудительном взыскании
  depr: {                         // ✅ первая полночь; ≈ далее −1 % от цены в день, пол 20 %
    first: { electronics: 0.25, appliances: 0.20, furniture: 0.15, art: 0, none: 0 },
    perDay: 0.01, floor: 0.2,
    artPerDay: 0.01, artCap: 2,   // ≈ искусство дорожает до ×2
  },
};

// ── Работа ────────────────────────────────────────────────────────────
export const CAREER = {
  carpoolBefore: 60,              // ✅ машина за час до смены
  carpoolWait: 60,                // ✅ ждёт час — окно [start−60, start]
  missedToFire: 2,                // ✅ уволен после 2 пропусков подряд
  perf: { goodBase: 10, goodPerMood: 0.1, badPerMood: 0.2, promoteAt: 50, demoteAt: -50, range: [-100, 100] },  // ≈
  workDecayMul: { hunger: 1, comfort: 0.5, hygiene: 1, bladder: 0, energy: 1, fun: 1.2, social: -0.5 },         // ≈ на работе: пузырь не падает, общение растёт
  chanceCard: 0.12,               // ≈ шанс карточки случая в рабочий день
};

// Карьеры: 10 треков × 10 уровней — data/careers.js (механика), тексты — Писатель
export { CAREERS } from '../../data/careers.js';

// Иконки потребностей для пузырей-мыслей
export const MOTIVE_ICON = { hunger: '🍔', comfort: '🛋️', hygiene: '🚿', bladder: '🚽', energy: '💤', fun: '🎈', social: '💬', room: '🏠' };

// ── Мир (перенесено из js/world/config.js по просьбе Мира; Мир переключит импорт) ──
export const WORLD = {
  pathNodeLimit: 4000,            // лимит раскрытий A*
  diag: Math.SQRT2,               // цена диагонального шага
  depreciation: MONEY.depr.first, // ✅ продажа не в день покупки → price·(1−k), если Мозг ещё не вёл st.value
  dayMinutes: TIME.dayMinutes,
  room: {                         // ✅ формула §2.10; вклады ≈
    perRating: 10, areaDiv: 12, base: -10, outsideScale: 30, outsideBase: -15,
    floorFull: 10, bareFloorTile: -3, bareWallEdge: -1, dirtyMax: -20, broken: -10, puddle: -15, trash: -10,
  },
  bareWallType: 1,
  supportPerp: 2, supportPar: 1,
  landPerTile: 5,                 // ≈ цена земли за тайл (Мир: покупка участка)  // ✅ TS1: стена держит 2 тайла перпендикулярно и 1 вдоль
  roof: { style: 'gable', color: '#8a4b3a', pitch: 0.5 },
};

// ════ Волна 2 ═══════════════════════════════════════════════════════
export const FLOOR_HEIGHT = 3;                    // м, для sim.z на лестнице
export const LEVEL_PENALTY = 8;                   // ≈ автономия: предмет на другом этаже «дальше» на 8 тайлов
export const VISITOR_ATTEN = { none: 0, low: 0.01, medium: 0.02, high: 0.03 };   // ✅ гости

// Грязь, посуда, мусор, поломки
export const DIRT = {
  dishesPerMeal: 1, dishDirty: 25,                // ≈ тарелка → st.dishes, st.dirty += 25 (Мир учитывает грязь в комнате)
  hostRadius: 3,                                  // стол/стойка для посуды в пределах 3 тайлов
  trashCap: 6, trashShow: 3,                      // ≈ ведро: вместимость, «вынести» видно с 3
};
export const BREAK = {
  perUse: { electronics: 0.02, appliances: 0.015, plumbing: 0.02 },   // ≈ шанс поломки за использование
  repairMinutes: 90, repairPerMech: 0.25,         // ≈ 90 мин / (1 + 0.25·механика)
  autoMinMech: 3,                                 // ≈ сам чинит только с механикой ≥ 3
  shock: { base: 0.35, safeSkill: 4, deathChance: 0.1, puddleDeath: true },   // ≈ удар током при ремонте электроники
};

// Огонь
export const FIRE = {
  base: 0.06, safeSkill: 4,                       // ≈ шанс пожара за готовку: 6 % · (1 − кулинария/4)
  grow: 0.05,                                     // мощность за 2 мин
  spreadAt: 0.6, spreadChance: 0.12,              // ≈ перекидывается на соседний горючий предмет
  burnAt: 0.8,                                    // предмет становится st.burnt
  burnoutMinutes: 180,                            // без пожарных гаснет сам (иначе вечно)
  panicRadius: 6, fleeDist: 5,
  burnRadius: 1.2, burnDeathMinutes: 20,          // ≈ стоять вплотную 20 мин → смерть
  brigadeDelay: 15, extinguishMinutes: 3,         // ≈ пожарные через 15 мин после датчика
  flammableCats: ['seating', 'surfaces', 'decor', 'electronics', 'appliances', 'misc', 'lighting'],
};

// Службы (✅ TS1: горничная §10/ч 10–17, мастер §50/ч, пицца §40)
export const SERVICES = {
  maid: { perHour: 10, from: 10, to: 17 },
  repair: { perHour: 50, minHours: 1, delay: 60 },
  pizza: { price: 40, delay: 60, servings: 6, perServing: 22, eatMinutes: 10 },
  invite: { delay: 30, stay: 180, noAfter: 0, noBefore: 7 },
  walkBy: { from: 9, to: 20, chancePerHour: 0.25 },
  burglar: { hour: 3, chance: 0.15, stealMinutes: 20, policeDelay: 10, reward: 1000 },   // ✅ §1000 награда
  reaperDelay: 10, reapMinutes: 5,
  socialWorkerNeglect: 8 * 60,                    // ≈ младенец в запущенном состоянии 8 ч → соцработник
};

// Семья
export const FAMILY = {
  maxSize: 8,                                     // ✅ TS1
  babyHours: 72,                                  // ✅ 72 ч → ребёнок
  babyDecay: { hunger: 8, fun: 6 },               // ≈ в час
  babyFeed: 60, babyPlay: 50, babyNeglectBelow: -60, babyCryBelow: -20,
  school: { hours: [8, 15], busBefore: 60 },      // ✅ автобус 08:00 ≈ окно 07–08
  grade: { start: 70, goodDay: 4, badDay: -4, homework: 6, missedHomework: -8, missed: -10 },
  mourn: { social: -20, fun: -20, days: 2 },
};

// Предложения работы (✅ газета 1, компьютер 3)
export const JOBS = { newspaper: 1, computer: 3 };

// Новые предметы
export const EASEL = { finishMinutes: 120, saleBase: 20, salePerSkill: 40 };   // ≈ картина: §20 + §40·творчество

// ════ Волна 3 ═══════════════════════════════════════════════════════
export const GROCERY = { pack: 10, mealBonus: 1.2 };            // ≈ продукты из магазина: +20 % сытости, 10 обедов
export const FIREPLACE = { firePer2Min: 0.0015, burnHours: 4 }; // ≈ ~4 %/ч пожар от горящего камина
export const PARTY = { minGuests: 3, maxGuests: 5, hours: 4, arrive: 30, perSocial: 4, perMoodTick: 0.004, stars: [20, 50, 90], relBonus: 8 };   // ≈ шкала вечеринки
export const EVENTS_T = { perHour: 0.12, maxPerDay: 3, hours: [8, 22], stocksRate: 0.02, invest: { rate: 0.1, days: 3 }, billDiscount: 0.5 };   // ≈ планировщик событий
export const WANTS_T = { wants: 4, fears: 3, rollHour: 6, aspWeight: 4, meterRange: [-100, 100], dailyDecay: 0.1,
  reward: { moneyPerPt: 2, fun: 10, social: 5 }, fearHit: { fun: -10 }, levels: { platinum: 80, gold: 50, green: 0, red: -50 }, platinumBoost: 15 };   // ≈ слой TS2
export const HOOD_T = { promoteChance: 0.05, befriendPairs: 3, befriendDelta: [1, 4], communityTownies: [3, 5], communityStay: 240 };   // ≈ жизнь района «за кадром»
