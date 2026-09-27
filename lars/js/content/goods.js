// ═══ ТОВАРЫ И УСЛУГИ ═══
// Источник цен и кривых: docs/research/economy.md, раздел 5. Где исследования нет — TODO-research (оценка).
//
// GOODS[] — {
//   id     ключ (инвентарь, события, спрос в правилах)
//   name   1–3 слова;  icon — ключ из js/ui/icons.js;  unit — 'шт' | 'л' | 'порция' …
//   cat    'food' | 'drink' | 'warm' | 'energy' | 'transport' | 'service' | 'misc' — для дневного множителя
//   base   «нормальная» цена до кризиса в валюте cur
//   cur    'RUB' | 'USD' | 'GEL' (по умолчанию RUB)
//   m      [10 чисел] — множитель к base по дням 21..30.09 (индекс 0 = 21.09); без m — CALENDAR.days[].prices
//   pay    чем можно платить: 'cash_rub' | 'transfer_rub' (перевод по номеру карты — нужен заряд телефона)
//          | 'card_mir' | 'cash_usd' | 'cash_gel' (продавец может сузить список своим accepts)
//   use    что даёт при использовании: { needs: { hunger|thirst|warmth|sleep|nerves|charge: ±число } }
//   service true — покупается и сразу применяется, в рюкзак не кладётся
//   keep   true — не пропадает сразу; charges — сколько раз можно применить
//   wheels true — «колёса»: пешеход с этим проходит КПП, когда пеший переход закрыт (правило wheels/pedBan)
//   drivers[] что двигает спрос (справочно для сценаристов; движок учитывает правила demand и толпу)
// Итоговая цена = base × (m[день] | дневной множитель) × спрос у продавца × наценка продавца × доверие × вечер.
'use strict';
L.def('content/goods', () => {
const GOODS = [
  // — вода и еда —
  { id: 'water', name: 'Вода 5 л', icon: 'water', cat: 'drink', unit: 'бут', base: 80, m: [1, 1, 2, 3, 3, 3, 3, 3, 2, 1.5], pay: ['cash_rub', 'transfer_rub'],
    use: { needs: { thirst: 45 } }, keep: true, charges: 3, drivers: ['queue_days', 'volunteers'] },
  { id: 'tea', name: 'Чай горячий', icon: 'cup', cat: 'drink', unit: 'стакан', base: 50, pay: ['cash_rub'], service: true, use: { needs: { thirst: 15, warmth: 14, nerves: 4 } } }, // TODO-research
  { id: 'coffee', name: 'Кофе', icon: 'cup', cat: 'drink', unit: 'стакан', base: 100, m: [1, 1, 1.5, 2, 2, 2, 2, 2, 2, 1.5], pay: ['cash_rub'], service: true,
    use: { needs: { thirst: 8, sleep: 14, warmth: 8 } } },
  { id: 'snack', name: 'Еда из ларька', icon: 'bread', cat: 'food', unit: 'набор', base: 150, m: [1, 1, 2, 3, 3, 3, 3, 3, 2.5, 2], pay: ['cash_rub'],
    use: { needs: { hunger: 28, nerves: 2 } } },
  { id: 'pie', name: 'Осетинский пирог', icon: 'food', cat: 'food', unit: 'шт', base: 200, m: [1, 1, 1.3, 1.4, 1.5, 1.5, 1.5, 1.5, 1.4, 1.3], pay: ['cash_rub'],
    use: { needs: { hunger: 45, nerves: 5 } }, drivers: ['queue_days'] }, // people.md: пирог 300 → 400 → 500 ₽ за часы
  { id: 'meal', name: 'Горячий обед', icon: 'food', cat: 'food', unit: 'порция', base: 300, m: [1, 1, 1.5, 2, 2.3, 2.3, 2.3, 2.3, 2.3, 2], pay: ['cash_rub', 'transfer_rub'],
    use: { needs: { hunger: 55, warmth: 8, nerves: 6 } } },
  { id: 'bread', name: 'Лаваш', icon: 'bread', cat: 'food', unit: 'шт', base: 60, pay: ['cash_rub'], use: { needs: { hunger: 18 } } }, // TODO-research
  { id: 'choco', name: 'Шоколад', icon: 'choco', cat: 'food', unit: 'шт', base: 90, pay: ['cash_rub'], use: { needs: { hunger: 10, nerves: 5 } } }, // TODO-research
  { id: 'cigs', name: 'Сигареты', icon: 'cigs', cat: 'misc', unit: 'пачка', base: 180, pay: ['cash_rub'], keep: true, charges: 20, use: { needs: { nerves: 7 } } }, // TODO-research
  { id: 'meds', name: 'Жаропонижающее', icon: 'meds', cat: 'misc', unit: 'упак', base: 250, pay: ['cash_rub'], use: { needs: { nerves: 6 } } }, // TODO-research
  // — энергия и тепло —
  { id: 'charge', name: 'Зарядка 30 мин', icon: 'plug', cat: 'energy', unit: 'раз', base: 100, m: [1, 1, 1.5, 2, 2, 2, 2, 2, 2, 1.5], pay: ['cash_rub'], service: true, use: { needs: { charge: 45 } } }, // TODO-research
  { id: 'powerbank', name: 'Повербанк', icon: 'battery', cat: 'energy', unit: 'шт', base: 1500, pay: ['cash_rub'], keep: true, charges: 3, use: { needs: { charge: 60 } } }, // TODO-research
  { id: 'blanket', name: 'Плед', icon: 'blanket', cat: 'warm', unit: 'шт', base: 600, pay: ['cash_rub'], keep: true, charges: 999, use: { needs: { warmth: 18 } } }, // TODO-research
  { id: 'raincoat', name: 'Дождевик', icon: 'rain', cat: 'warm', unit: 'шт', base: 300, pay: ['cash_rub'], keep: true, charges: 999, use: { needs: { warmth: 6 } } }, // TODO-research
  { id: 'fuel', name: 'Бензин с рук 10 л', icon: 'fuel', cat: 'transport', unit: 'канистра', base: 600, m: [1, 2, 5, 8, 12, 16, 17, 17, 12, 8], pay: ['cash_rub'],
    drivers: ['queue_days', 'night', 'engines_idle'] },
  // — колёса —
  { id: 'bike', name: 'Велосипед б/у', icon: 'bike', cat: 'transport', unit: 'шт', base: 5000, m: [1, 1, 1.2, 2, 4, 5, 6, 6, 0.3, 0.1], pay: ['cash_rub', 'transfer_rub'], wheels: true,
    drivers: ['rule_bikes_allowed', 'queue_length', 'ban_foot_29'] },
  { id: 'scooter', name: 'Самокат', icon: 'scooter', cat: 'transport', unit: 'шт', base: 4000, m: [1, 1, 1.2, 1.5, 2, 2.5, 2.5, 2, 0.2, 0.1], pay: ['cash_rub'], wheels: true,
    drivers: ['rule_bikes_allowed', 'ban_foot_29'] },
  // — услуги-сделки (продаются в событиях, не в лавке) —
  { id: 'seat', name: 'Место через КПП', icon: 'van', cat: 'service', unit: 'место', base: 1000, m: [2, 10, 10, 8, 6, 8, 10, 10, 12, 8], pay: ['cash_rub'] },
  { id: 'bypass', name: 'Такси в объезд', icon: 'car', cat: 'service', unit: 'поездка', base: 3000, m: [0, 3, 5, 7, 10, 15, 15, 15, 10, 8], pay: ['cash_rub'] },
  { id: 'escort', name: '«С мигалками»', icon: 'siren', cat: 'service', unit: 'машина', base: 65000, m: [0, 0, 0, 0, 0.8, 1, 1, 1.5, 1.5, 1], pay: ['cash_rub', 'cash_usd'] },
  // — Грузия —
  { id: 'sim', name: 'Грузинская SIM', icon: 'sim', cat: 'misc', unit: 'шт', base: 10, cur: 'GEL', pay: ['cash_gel'] },
];
return { GOODS };
});
