// ═══ ИГРАБЕЛЬНЫЕ РОЛИ ═══
// По docs/research/people.md §4 (роль 1: айтишник-одиночка, 27 — «заплатить за объезд или стоять»).
// TODO-research: остальные 11 ролей добавляются сюда же.
//
// ROLES[] — {
//   id, name, age, job, icon
//   blurb     одна строка для экрана выбора (2–8 слов)
//   start     'YYYY-MM-DD HH:MM' — когда роль «входит» в мир (мир до этого живёт сам)
//   arrive    'tail' — встаёт в хвост очереди | { s: км } — в конкретное место
//   car       { model, color, seats, fuel, tank } — своя машина; null — пешком
//   money     { rub_cash, rub_card, usd, gel }
//   items     { товар: штук }
//   needs     { hunger, thirst, warmth, sleep, nerves, charge } 0..100 (100 — хорошо)
//   contacts[] id контактов из PHONE.contacts — от них придут сообщения «из дома»
//   goal      строка-цель для HUD (2–4 слова)
// }
'use strict';
L.def('content/roles', () => {
const ROLES = [
  { id: 'artyom', name: 'Артём', age: 27, job: 'программист', icon: 'laptop',
    blurb: 'Москва → Тбилиси, один в машине, не спит',
    start: '2022-09-25 21:00', arrive: 'tail',
    car: { model: 'Солярис', color: '#8e969f', seats: 5, fuel: 14, tank: 50 },
    money: { rub_cash: 28000, rub_card: 240000, usd: 1500, gel: 0 },
    items: { water: 1, bread: 1, choco: 1 },
    needs: { hunger: 50, thirst: 45, warmth: 70, sleep: 35, nerves: 38, charge: 52 },
    contacts: ['mama', 'nastya', 'work'],
    goal: 'Пересечь КПП',
  },
];
return { ROLES };
});
