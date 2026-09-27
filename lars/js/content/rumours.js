// ═══ СЛУХИ ═══
// По docs/research/people.md §3 и timeline.md §4. Отметки правды — из исследования: часть слухов в симуляции
// «сбывается» (confirm — правило календаря), часть опровергается (revealAt).
//
// RUMOURS[] — {
//   id, icon
//   text      как пересказывают в очереди / в чате (1 строка)
//   truth     'true' | 'false' | 'half' | 'unknown'
//   from      'YYYY-MM-DD HH:MM' — когда появляется
//   at        км от КПП, где зарождается, или 'kpp' | 'tail'
//   share     начальная доля знающих в этом участке (0..1)
//   spread    заразность (множитель к TUNING.rumours.contact)
//   mood      спокойствия в час у поверивших (− тревожит, + успокаивает)
//   demand    { товар|категория: множитель } — пока слух широко известен
//   confirm   id правила календаря: когда оно вступает — слух подтверждается (✅ в чате)
//   revealAt  'YYYY-MM-DD HH:MM' — когда выясняется правда (для false/half)
//   reveal    текст итога (2–6 слов)
// }
'use strict';
L.def('content/rumours', () => {
const RUMOURS = [
  { id: 'r_noon_close', icon: 'barrier', text: 'В полдень границу закроют', truth: 'false', from: '2022-09-22 08:00', at: 'tail', share: 0.15, spread: 1.6, mood: -1.5,
    revealAt: '2022-09-22 14:00', reveal: 'Не закрыли' },
  { id: 'r_close28', icon: 'barrier', text: 'Для мужчин закроют в среду, 28-го', truth: 'false', from: '2022-09-24 18:00', at: 'tail', share: 0.1, spread: 1.5, mood: -1.4,
    revealAt: '2022-09-28 14:00', reveal: 'Не закрыли. Закрыли въезд в регион' },
  { id: 'r_draft', icon: 'flag', text: 'На КПП развернули военкомат', truth: 'true', from: '2022-09-27 12:00', at: 'kpp', share: 0.2, spread: 1.8, mood: -2,
    confirm: 'draftPoint', reveal: 'Правда: повестки 180+' },
  { id: 'r_lists', icon: 'doc', text: 'У пограничников списки мобилизованных', truth: 'half', from: '2022-09-23 10:00', at: 'kpp', share: 0.1, spread: 1.2, mood: -1,
    revealAt: '2022-09-29 12:00', reveal: 'Частично: списки были у военкомата' },
  { id: 'r_ped_rules', icon: 'walk', text: 'Пешком пускают только с женщинами и детьми', truth: 'half', from: '2022-09-25 12:00', at: 'kpp', share: 0.2, spread: 1.4, mood: -0.3,
    revealAt: '2022-09-26 12:00', reveal: 'Пешком пустили всех, семьи — первыми' },
  { id: 'r_ped_ban', icon: 'walk', text: 'С завтра пешком не пустят. И на великах', truth: 'true', from: '2022-09-28 16:00', at: 'kpp', share: 0.2, spread: 1.6, mood: -1, demand: { transport: 0.6 },
    confirm: 'pedBan', reveal: 'Правда: с 29-го пеших разворачивают' },
  { id: 'r_caucasus', icon: 'alert', text: 'Чеченцев и ингушей в Грузию не пускают', truth: 'false', from: '2022-09-23 18:00', at: 'kpp', share: 0.1, spread: 1.1, mood: -0.4,
    revealAt: '2022-09-27 12:00', reveal: 'Пускали, после допроса' },
  // revealAt было не выставлено: у reveal-текста без revealAt/confirm нет ничего, что ставит r.revealed
  // (sim/rumours.js step()) — так «Правда: там долгие проверки» не могла попасть в чат вообще никогда,
  // ни при каком сиде/политике (reachability.js, RUM_REVEAL_SEEN всегда 0%). truth:'true' — не нужно ждать
  // календарного правила, ставим revealAt вскоре после from (как у r_noon_close)
  { id: 'r_222', icon: 'door', text: 'Только не заходите в 222-й кабинет!', truth: 'true', from: '2022-09-22 20:00', at: 'kpp', share: 0.15, spread: 1.0, mood: -0.3,
    revealAt: '2022-09-23 06:00', reveal: 'Правда: там долгие проверки' },
  { id: 'r_tyres', icon: 'alert', text: 'Прокалывают шины, чтобы продать велик', truth: 'unknown', from: '2022-09-25 16:00', at: 3.1, share: 0.1, spread: 1.3, mood: -0.8, demand: { bike: 1.3 } },
  { id: 'r_million', icon: 'wallet', text: 'Местные за ночь заработали миллион', truth: 'unknown', from: '2022-09-24 12:00', at: 9.8, share: 0.1, spread: 1.0, mood: -0.3 },
  { id: 'r_escort', icon: 'siren', text: 'Кортеж с мигалками — 200 000 ₽', truth: 'half', from: '2022-09-25 10:00', at: 6, share: 0.08, spread: 1.2, mood: -0.4,
    revealAt: '2022-09-28 18:00', reveal: 'Были рассказы; ДПС отстранили за взятки' },
  // тот же пропуск revealAt, что у r_222/r_storage — reveal-текст без него не достижим никогда
  { id: 'r_evac', icon: 'car', text: 'Брошенные машины эвакуируют', truth: 'true', from: '2022-09-29 10:00', at: 1, share: 0.15, spread: 1.0, mood: -0.2,
    revealAt: '2022-09-29 20:00', reveal: 'Правда: ~80 машин увезли' },
  { id: 'r_visa', icon: 'doc', text: 'Грузия введёт визы для русских', truth: 'false', from: '2022-09-26 20:00', at: 'tail', share: 0.1, spread: 1.4, mood: -1.2,
    revealAt: '2022-09-29 18:00', reveal: 'Власти Грузии отказались' },
  // тот же пропуск revealAt — а по шапке файла у truth:'half' revealAt как раз обязателен
  { id: 'r_storage', icon: 'house', text: 'Местные бесплатно берут машины на хранение', truth: 'half', from: '2022-09-26 10:00', at: 10, share: 0.1, spread: 0.9, mood: 0.3,
    revealAt: '2022-09-26 20:00', reveal: 'Бывали и честные, и «с выкупом»' },
  { id: 'r_volunteers', icon: 'heart', text: 'Ниже Эзми волонтёры раздают чай и еду бесплатно', truth: 'true', from: '2022-09-23 10:00', at: 6.1, share: 0.2, spread: 1.0, mood: 0.8 },
  { id: 'r_fuel', icon: 'fuel', text: 'Бензин с рук — 1000 за литр', truth: 'true', from: '2022-09-26 20:00', at: 'tail', share: 0.1, spread: 1.1, mood: -0.5, demand: { fuel: 1.3 } },
  { id: 'r_cards', icon: 'card', text: '«Мир» в Грузии не работает нигде', truth: 'true', from: '2022-09-22 10:00', at: 'kpp', share: 0.1, spread: 1.0, mood: -0.3 },
  { id: 'r_kids_first', icon: 'child', text: 'С детьми пропускают без очереди', truth: 'half', from: '2022-09-23 12:00', at: 1, share: 0.1, spread: 1.1, mood: 0.1,
    revealAt: '2022-09-27 10:00', reveal: 'Иногда — пешком, в приоритете' },
  { id: 'r_seat', icon: 'van', text: 'Место в машине через КПП — 10–15 тысяч', truth: 'true', from: '2022-09-22 14:00', at: 3, share: 0.1, spread: 1.0, mood: -0.1 },
];
return { RUMOURS };
});
