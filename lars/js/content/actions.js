// ═══ ДЕЙСТВИЯ ИГРОКА ═══
// Меню действий появляется по тапу/клику на человека, машину, продавца, свою машину или по кнопке «Я».
//
// ACTIONS[] — {
//   id, label (1–3 слова), icon
//   target   'self'   — всегда (кнопка «Я»)
//            'own'    — своя машина
//            'car'    — чужая машина (водитель)
//            'person' — человек на ногах (пешеход, пассажир вне машины)
//            'seller' — продавец / волонтёр
//   op       операция движка (необязательно):
//            shop · exchange · talk · news · give · lift · swapAhead · letAhead · push · askCharge ·
//            sleep · engine (arg: 1|0) · toCar · phone · backpack · refuel · honk · callHome · rest · leaveCar ·
//            freeTalk — «сказать своё»: живой разговор голосом или текстом (нужен ключ OpenAI; js/ui/talk.js)
//   arg      аргумент операции
//   when     условие на игрока (тот же язык, что в событиях: rule, flag, need, money, item, inCar, night, …)
//   tgt      условие на цель: { ped: true, seats: true (есть место в твоей машине), ahead: true (машина прямо
//            перед тобой), behind: true, named: true, trustMin: n, engine: 0|1 }
//   fx       эффекты (как в событиях), применяются после op; time — игровых минут занимает
// }
// Число действий растёт до ~40 — добавляются сюда, движок не меняется, если хватает op.
'use strict';
L.def('content/actions', () => {
const ACTIONS = [
  // --- продавец ---
  { id: 'buy', label: 'Купить', icon: 'cart', target: 'seller', op: 'shop', time: 3 },
  { id: 'exchange', label: 'Обменять $', icon: 'dollar', target: 'seller', op: 'exchange', when: { money: { usd: '>=50' } }, time: 5 },
  { id: 'chargeSeller', label: 'Зарядить', icon: 'plug', target: 'seller', op: 'shop', arg: 'charge', time: 30 },
  { id: 'talkSeller', label: 'Поговорить', icon: 'chat', target: 'seller', op: 'talk', time: 6 },
  { id: 'saySeller', label: 'Сказать своё', icon: 'mic', target: 'seller', op: 'freeTalk', time: 0 },
  { id: 'warmSeller', label: 'Погреться', icon: 'fire', target: 'seller', tgt: { trustMin: 20 }, fx: { needs: { warmth: 30, nerves: 5 }, trust: { target: 2 } }, time: 40 },
  { id: 'donate', label: 'Помочь деньгами', icon: 'heart', target: 'seller', tgt: { named: true }, when: { money: { rub_cash: '>=500' } },
    fx: { money: { rub_cash: -500 }, trust: { target: 12 }, needs: { nerves: 4 }, helped: '{name}' }, time: 2 },
  // --- чужая машина ---
  { id: 'talkCar', label: 'Поговорить', icon: 'chat', target: 'car', op: 'talk', time: 8 },
  { id: 'newsCar', label: 'Что слышно?', icon: 'ear', target: 'car', op: 'news', time: 6 },
  { id: 'sayCar', label: 'Сказать своё', icon: 'mic', target: 'car', op: 'freeTalk', time: 0 },
  { id: 'askCharge', label: 'Зарядку?', icon: 'plug', target: 'car', op: 'askCharge', time: 30 },
  { id: 'giveCar', label: 'Угостить', icon: 'gift', target: 'car', op: 'give', time: 3 },
  { id: 'swapAhead', label: 'Поменяться', icon: 'swap', target: 'car', op: 'swapAhead', tgt: { ahead: true }, time: 5 },
  { id: 'letAhead', label: 'Пропустить', icon: 'arrowUp', target: 'car', op: 'letAhead', tgt: { behind: true }, time: 4 },
  { id: 'push', label: 'Подтолкнуть', icon: 'hands', target: 'car', op: 'push', time: 15 },
  { id: 'honk', label: 'Посигналить', icon: 'horn', target: 'car', op: 'honk', time: 1 },
  // --- человек ---
  { id: 'talkPerson', label: 'Поговорить', icon: 'chat', target: 'person', op: 'talk', time: 8 },
  { id: 'newsPerson', label: 'Что слышно?', icon: 'ear', target: 'person', op: 'news', time: 6 },
  { id: 'sayPerson', label: 'Сказать своё', icon: 'mic', target: 'person', op: 'freeTalk', time: 0 },
  { id: 'givePerson', label: 'Дать', icon: 'gift', target: 'person', op: 'give', time: 3 },
  { id: 'lift', label: 'Подвезти', icon: 'car', target: 'person', op: 'lift', tgt: { ped: true, seats: true }, time: 4 },
  { id: 'lend', label: 'Одолжить 1000', icon: 'wallet', target: 'person', when: { money: { rub_cash: '>=1000' } },
    fx: { money: { rub_cash: -1000 }, trust: { target: 15 }, helped: '{name}' }, time: 3 },
  // --- своя машина ---
  { id: 'toCar', label: 'В машину', icon: 'car', target: 'own', op: 'toCar', when: { inCar: false }, time: 0 },
  { id: 'leave', label: 'Выйти', icon: 'walk', target: 'own', op: 'leaveCar', when: { inCar: true }, time: 0 },
  { id: 'engineOn', label: 'Завести', icon: 'fire', target: 'own', op: 'engine', arg: 1, when: { inCar: true, flag: '!engine' }, time: 1 },
  { id: 'engineOff', label: 'Заглушить', icon: 'snow', target: 'own', op: 'engine', arg: 0, when: { flag: 'engine' }, time: 1 },
  { id: 'sleep', label: 'Спать', icon: 'moon', target: 'own', op: 'sleep', when: { inCar: true }, time: 0 },
  { id: 'refuel', label: 'Заправить', icon: 'fuel', target: 'own', op: 'refuel', when: { item: { fuel: '>=1' } }, time: 5 },
  // --- я ---
  { id: 'phone', label: 'Телефон', icon: 'phone', target: 'self', op: 'phone', time: 0 },
  { id: 'bag', label: 'Рюкзак', icon: 'bag', target: 'self', op: 'backpack', time: 0 },
  { id: 'callHome', label: 'Позвонить маме', icon: 'call', target: 'self', op: 'callHome', when: { need: { charge: '>=8' } }, time: 10 },
  { id: 'rest', label: 'Отдышаться', icon: 'wind', target: 'self', op: 'rest', time: 20 },
];
return { ACTIONS };
});
