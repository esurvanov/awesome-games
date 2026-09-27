// ═══ КАЛЕНДАРЬ: дни, погода, пропускная способность, курсы, правила ═══
// Источник: docs/research/timeline.md (разделы 1, 3, 4 «Игровые крючки»), economy.md (курсы), geography.md (погода, свет).
// Пропуск/прибытие машин подобраны так, чтобы очередь в симуляции шла по опорным точкам из timeline.md:
// 23.09 06:00 ≈ 1700 · 24.09 ≈ 2200 · 25.09 ≈ 2500 · 26.09 ≈ 3500 · 27.09 пик ≈ 5000+ · 28.09 ≈ 3300 · 30.09 ≈ 2500 (проверка: tests/sim-queue.js).
//
// CALENDAR.start        — 'YYYY-MM-DD', полночь первого дня = игровое время 0
// CALENDAR.worldStart   — 'YYYY-MM-DD HH:MM', с какого момента живёт мир (до старта роли — быстрый предпрогон)
// CALENDAR.days[i]      — один календарный день (по порядку, без пропусков):
//   date      'YYYY-MM-DD'
//   temp      [мин, макс] °C у Ларса (минимум в ~5:00, максимум в ~15:00)
//   sun       [восход, закат] часы MSK (дробные) — geography.md §3
//   snow      граница снега на вершинах, м над морем (3D; geography.md §3: 22.09 снег в Гудаури 2190 м, 24.09 мокрый снег
//             выше 1500 м, 25–26.09 снег на вершинах, дальше тает)
//   moon      яркость луны ночью 0..1 (новолуние 25.09 — ночи без света, Млечный Путь)
//   weather   'clear' | 'cloud' | 'drizzle' | 'rain' | 'storm' | 'wind'  — тепло и освещение
//   through   { car, ped } — сколько машин / пешеходов в час пропускает КПП РФ (среднее по дню)
//   arrive    { car, ped } — сколько машин / пешеходов в час прибывает в хвост (среднее)
//   rates     { usd, gel, cashUsd, gelStreet } — ₽ за 1 $ (ЦБ), ₽ за 1 ₾ (офиц.), множитель наличного $
//             к ЦБ, штраф обмена ₽→₾ «с рук»
//   prices    число | { категория: множитель } — дневной множитель для товаров без своей кривой m[]
//   mood      фон «спокойствия» в час у всех (− тревожнее)
//   tag       2–4 слова для календаря в HUD
//   wait      ориентир «сколько стоят» (для подсказок и сверки), строка
// CALENDAR.hourly       — 24 множителя прибытия по часам
// CALENDAR.hourlyThrough— 24 множителя пропуска КПП по часам
// CALENDAR.rules[]      — правила с окнами действия:
//   id, icon, label (2–4 слова), from 'YYYY-MM-DD HH:MM', to (или null)
//   fx { through:{car,ped}, arrive:{car,ped} — множители; demand:{товар|категория: множитель}; mood: доп. в час;
//        wheels: true — пеший проход только «на колёсах» (велосипед/самокат считаются транспортом) }
//   События, слухи и действия ссылаются на правила: when.rule = 'pedAllowed' | '!pedBan'.
'use strict';
L.def('content/calendar', () => {
const CALENDAR = {
  start: '2022-09-21',
  worldStart: '2022-09-21 10:00',
  days: [
    { date: '2022-09-21', snow: 3400, temp: [15, 23], sun: [5.77, 18.0], moon: 0.15, weather: 'drizzle', through: { car: 70, ped: 30 }, arrive: { car: 75, ped: 10 },
      rates: { usd: 60.02, gel: 21.2, cashUsd: 1.05, gelStreet: 1.15 }, prices: 1.0, mood: -0.6, tag: 'Объявили', wait: '6+ ч' },
    { date: '2022-09-22', snow: 2300, temp: [15, 21], sun: [5.8, 17.97], moon: 0.1, weather: 'drizzle', through: { car: 70, ped: 40 }, arrive: { car: 120, ped: 25 },
      rates: { usd: 60.87, gel: 21.5, cashUsd: 1.2, gelStreet: 1.15 }, prices: { '*': 1.2 }, mood: -1, tag: 'Первые самокаты', wait: '16 ч' },
    { date: '2022-09-23', snow: 2600, temp: [13, 20], sun: [5.82, 17.95], moon: 0.05, weather: 'rain', through: { car: 70, ped: 40 }, arrive: { car: 95, ped: 30 },
      rates: { usd: 59.83, gel: 21.2, cashUsd: 1.25, gelStreet: 1.2 }, prices: { '*': 1.8 }, mood: -1.3, tag: 'Дождь, 1700 машин', wait: '16–24 ч' },
    { date: '2022-09-24', snow: 1500, temp: [7, 14], sun: [5.83, 17.92], moon: 0, weather: 'storm', through: { car: 65, ped: 40 }, arrive: { car: 80, ped: 35 },
      rates: { usd: 58.10, gel: 20.6, cashUsd: 1.25, gelStreet: 1.2 }, prices: { '*': 2.4 }, mood: -1.6, tag: 'Ливень, мокрый снег', wait: '~сутки' },
    { date: '2022-09-25', snow: 1900, temp: [7, 12], sun: [5.85, 17.88], moon: 0, weather: 'clear', through: { car: 60, ped: 40 }, arrive: { car: 85, ped: 45 },
      rates: { usd: 58.10, gel: 20.6, cashUsd: 1.25, gelStreet: 1.2 }, prices: { '*': 2.7 }, mood: -1.4, tag: 'Пешком к шлагбауму', wait: '30 ч' },
    { date: '2022-09-26', snow: 2100, temp: [6, 17], sun: [5.87, 17.85], moon: 0, weather: 'clear', through: { car: 60, ped: 160 }, arrive: { car: 115, ped: 60 },
      rates: { usd: 58.10, gel: 20.6, cashUsd: 1.3, gelStreet: 1.25 }, prices: { '*': 3.0 }, mood: -1.6, tag: 'Пеший переход', wait: '2–3 сут' },
    { date: '2022-09-27', snow: 2500, temp: [7, 22], sun: [5.88, 17.82], moon: 0.03, weather: 'clear', through: { car: 65, ped: 180 }, arrive: { car: 105, ped: 50 },
      rates: { usd: 58.00, gel: 20.5, cashUsd: 1.3, gelStreet: 1.25 }, prices: { '*': 3.0 }, mood: -2, tag: 'Пик: 20–30 км', wait: '3–4 сут' },
    { date: '2022-09-28', snow: 2900, temp: [12, 24], sun: [5.9, 17.8], moon: 0.08, weather: 'wind', through: { car: 150, ped: 160 }, arrive: { car: 100, ped: 30 },
      rates: { usd: 58.18, gel: 20.6, cashUsd: 1.3, gelStreet: 1.25 }, prices: { '*': 2.6 }, mood: -1.8, tag: 'Въезд закрыт', wait: '2–5 сут' },
    { date: '2022-09-29', snow: 3100, temp: [13, 18], sun: [5.92, 17.77], moon: 0.12, weather: 'drizzle', through: { car: 170, ped: 0 }, arrive: { car: 100, ped: 10 },
      rates: { usd: 58.45, gel: 20.7, cashUsd: 1.3, gelStreet: 1.2 }, prices: { '*': 2.3 }, mood: -1.8, tag: 'Пешком нельзя', wait: 'вдвое короче' },
    { date: '2022-09-30', snow: 3200, temp: [9, 19], sun: [5.93, 17.73], moon: 0.18, weather: 'clear', through: { car: 150, ped: 0 }, arrive: { car: 80, ped: 5 },
      rates: { usd: 57.41, gel: 20.3, cashUsd: 1.3, gelStreet: 1.2 }, prices: { '*': 2.0 }, mood: -1, tag: 'Стабилизировалась', wait: '~сутки' },
  ],
  // ущелье: прямое солнце появляется позже восхода и уходит раньше заката (geography.md §3), ч
  gorge: { morning: 1.0, evening: 1.2 },
  hourly: [0.35, 0.25, 0.2, 0.2, 0.25, 0.4, 0.65, 0.9, 1.15, 1.3, 1.4, 1.45, 1.4, 1.35, 1.3, 1.3, 1.3, 1.3, 1.25, 1.15, 1.0, 0.85, 0.65, 0.45],
  hourlyThrough: [0.85, 0.8, 0.8, 0.8, 0.85, 0.9, 1, 1.05, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.05, 1.05, 1, 0.95, 0.9, 0.9],
  rules: [
    { id: 'mobilization', icon: 'flag', label: 'Мобилизация', from: '2022-09-21 09:00', to: null, fx: { mood: -0.2 } },
    { id: 'scooters', icon: 'scooter', label: 'Самокаты в нейтралке', from: '2022-09-22 08:00', to: '2022-09-26 00:00', fx: { wheels: true, demand: { scooter: 1.5 } } },
    { id: 'turnback', icon: 'shield', label: 'ДПС разворачивает', from: '2022-09-22 20:00', to: '2022-09-23 08:00', fx: { arrive: { car: 0.8 } } },
    { id: 'skipOffers', icon: 'wallet', label: '«Места в начале»', from: '2022-09-23 00:00', to: '2022-09-28 12:00', fx: {} },
    { id: 'walkToBarrier', icon: 'walk', label: 'Пешком к шлагбауму', from: '2022-09-25 06:00', to: '2022-09-26 00:00', fx: { wheels: true, demand: { transport: 1.5 } } },
    { id: 'pedAllowed', icon: 'walk', label: 'Пеший переход', from: '2022-09-26 00:00', to: '2022-09-29 00:00', fx: { mood: 0.3 } },
    { id: 'volunteers', icon: 'heart', label: 'SOS Lars', from: '2022-09-26 06:00', to: null, fx: { demand: { drink: 0.8, food: 0.9 }, mood: 0.4 } },
    { id: 'draftPoint', icon: 'flag', label: 'Пункт военкомата', from: '2022-09-27 16:48', to: null, fx: { mood: -1.2, demand: { cigs: 1.5 } } },
    { id: 'summonsAll', icon: 'alert', label: 'Повестки по спискам', from: '2022-09-27 20:00', to: null, fx: { mood: -0.8 } },
    { id: 'carEntry', icon: 'barrier', label: 'Въезд в регион закрыт', from: '2022-09-28 00:00', to: null, fx: { arrive: { car: 0.2, ped: 0.4 } } },
    { id: 'pedBan', icon: 'walk', label: 'Пешком нельзя', from: '2022-09-29 00:00', to: null, fx: { through: { ped: 0 }, demand: { transport: 0.2 }, mood: -0.4 } },
  ],
};
return { CALENDAR };
});
