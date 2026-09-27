// Случайные события — механика (владелец: Мозг). Тексты — Писатель: data/text/events.js по id ({title?, text, choices?:[a,b]}).
// kind: phone (звонок) · letter (письмо в ящике) · news (газета) · visitor (кто-то пришёл) · chance (случай на участке)
// w — вес, when — условие ({career, kids, moneyGte, moneyLt, hours:[a,b]}), fx — эффекты (money, motives{}, perf, skill{}, rel, special),
// choices — диалог из двух вариантов [{label, fx, chance?, fail?}]. Эффекты на случайного взрослого дома.
import { TEXT } from '../js/sim/content.js';

const E = (id, kind, text, fx = {}, o = {}) => ({ id, kind, text, fx, w: 1, ...o });
const C = (label, fx = {}, extra = {}) => ({ label, fx, ...extra });

const BASE = [
  // ✉️ письма (16)
  E('letter_inheritance', 'letter', 'Наследство от двоюродной тётушки', { money: 500 }, { w: 0.3 }),
  E('letter_lottery_small', 'letter', 'Лотерейный билет выиграл', { money: 100 }),
  E('letter_lottery_big', 'letter', 'Крупный выигрыш в лотерею!', { money: 2000 }, { w: 0.05 }),
  E('letter_tax_refund', 'letter', 'Налоговый вычет', { money: 200 }),
  E('letter_fine', 'letter', 'Штраф за парковку', { money: -75 }),
  E('letter_discount', 'letter', 'Скидка на коммуналку', { special: 'billDiscount' }, { w: 0.5 }),
  E('letter_fan', 'letter', 'Письмо от поклонника', { motives: { fun: 10, social: 10 } }, { when: { career: true } }),
  E('letter_old_friend', 'letter', 'Весточка от старого друга', { motives: { social: 15 }, rel: 5 }),
  E('letter_chain', 'letter', 'Письмо счастья: «перешли 10 друзьям»', {}, { choices: [C('Переслать', { motives: { fun: -5 } }), C('Выбросить', { motives: { fun: 2 } })] }),
  E('letter_magazine', 'letter', 'Подписка на журнал', {}, { choices: [C('Подписаться (§50)', { money: -50, motives: { fun: 15 } }), C('Отказаться')] }),
  E('letter_bank_error', 'letter', 'Ошибка банка в вашу пользу', { money: 250 }, { w: 0.4 }),
  E('letter_gift_card', 'letter', 'Подарочная карта', { money: 80 }),
  E('letter_charity', 'letter', 'Просьба о пожертвовании', {}, { choices: [C('Пожертвовать §100', { money: -100, motives: { social: 10, fun: 5 } }), C('Не сейчас')] }),
  E('letter_pen_pal', 'letter', 'Письмо от друга по переписке', { motives: { social: 12 } }),
  E('letter_wedding', 'letter', 'Приглашение на свадьбу знакомых', { motives: { social: 10, fun: 5 }, rel: 3 }),
  E('letter_school', 'letter', 'Письмо из школы', { special: 'gradeUp' }, { when: { kids: true } }),
  // ☎️ звонки (16)
  E('phone_wrong', 'phone', 'Ошиблись номером', { motives: { fun: -3 } }),
  E('phone_friend_chat', 'phone', 'Звонит приятель поболтать', { motives: { social: 20, fun: 5 }, rel: 4 }, { w: 1.5 }),
  E('phone_telemarketer', 'phone', 'Звонок из «Чудо-пылесоса»', {}, { choices: [C('Купить (§75)', { money: -75, motives: { fun: 5 } }), C('Повесить трубку', { motives: { fun: 2 } })] }),
  E('phone_survey', 'phone', 'Опрос за вознаграждение', { money: 20, motives: { fun: -4 } }),
  E('phone_radio_quiz', 'phone', 'Радиовикторина!', {}, { choices: [C('Отвечать', { money: 300 }, { skill: 'logic', fail: { motives: { fun: -5 } } }), C('Отказаться')] }),
  E('phone_mom', 'phone', 'Звонит мама', { motives: { social: 15 } }),
  E('phone_boss', 'phone', 'Звонит начальник: хвалит', { perf: 8 }, { when: { career: true } }),
  E('phone_boss_angry', 'phone', 'Звонит начальник: недоволен', { perf: -8 }, { when: { career: true }, w: 0.5 }),
  E('phone_prank', 'phone', 'Детский розыгрыш по телефону', { motives: { fun: 4 } }),
  E('phone_job_offer', 'phone', 'Кадровое агентство предлагает работу', { special: 'jobOffer' }),
  E('phone_party_invite', 'phone', 'Зовут на вечеринку к соседям', { motives: { social: 10, fun: 8 }, rel: 3 }),
  E('phone_doctor', 'phone', 'Напоминание из поликлиники', { motives: { fun: -2 } }),
  E('phone_pizza_promo', 'phone', 'Пиццерия дарит пиццу!', { special: 'freePizza' }, { w: 0.4 }),
  E('phone_neighbor_complaint', 'phone', 'Сосед жалуется на шум', { rel: -5, motives: { fun: -3 } }),
  E('phone_classmate', 'phone', 'Звонит одноклассник', { motives: { social: 12 }, rel: 6 }),
  E('phone_bank', 'phone', 'Банк предлагает вклад', {}, { choices: [C('Вложить §500', {}, { invest: 500 }), C('Отказаться')] , when: { moneyGte: 3000 } }),
  // 📰 газета (16)
  E('news_weather', 'news', 'Синоптики обещают тёплые выходные', { motives: { fun: 2 } }, { w: 1.5 }),
  E('news_sport_win', 'news', 'Наша команда выиграла кубок', { motives: { fun: 5 } }),
  E('news_sport_loss', 'news', 'Наша команда проиграла', { motives: { fun: -3 } }),
  E('news_stocks_up', 'news', 'Биржа растёт', { special: 'stocks', money: 1 }, { when: { moneyGte: 30000 } }),
  E('news_stocks_down', 'news', 'Биржа падает', { special: 'stocks', money: -1 }, { when: { moneyGte: 30000 } }),
  E('news_gossip', 'news', 'Светская хроника', { motives: { fun: 3 } }),
  E('news_festival', 'news', 'В парке — городской праздник', { motives: { fun: 4 } }),
  E('news_science', 'news', 'Учёные открыли новую звезду', { skill: { logic: 0.2 } }),
  E('news_recipe', 'news', 'Рецепт недели: пирожки', { skill: { cooking: 0.3 } }),
  E('news_crime', 'news', 'В районе участились кражи', { motives: { comfort: -3 } }),
  E('news_traffic', 'news', 'Пробки на главной улице', { motives: { fun: -2 } }),
  E('news_horoscope', 'news', 'Гороскоп сулит удачу', { motives: { fun: 4 } }),
  E('news_elections', 'news', 'Выборы мэра на носу', {}),
  E('news_new_shop', 'news', 'Открылся новый магазин', { motives: { fun: 2 } }),
  E('news_art', 'news', 'Выставка молодых художников', { skill: { creativity: 0.2 } }),
  E('news_fitness', 'news', 'Советы по утренней зарядке', { skill: { body: 0.2 } }),
  // 🚪 гости (8)
  E('visit_neighbor', 'visitor', 'Заглянул сосед', { special: 'visitor' }, { w: 1.2, when: { hours: [10, 20] } }),
  E('visit_salesman', 'visitor', 'Коммивояжёр с энциклопедиями', {}, { choices: [C('Купить (§150)', { money: -150, skill: { logic: 0.5 } }), C('Выпроводить')] }),
  E('visit_cookies', 'visitor', 'Скауты продают печенье', {}, { choices: [C('Купить (§20)', { money: -20, motives: { hunger: 15 } }), C('Не надо')] }),
  E('visit_census', 'visitor', 'Перепись населения', { motives: { fun: -3 } }),
  E('visit_postman', 'visitor', 'Почтальон разговорился', { motives: { social: 6 } }),
  E('visit_old_friend', 'visitor', 'Старый друг на пороге', { special: 'visitor', motives: { social: 10 } }, { when: { hours: [10, 21] } }),
  E('visit_lost_dog', 'visitor', 'Во двор забежала чужая собака', { motives: { fun: 8 } }),
  E('visit_carolers', 'visitor', 'Под окнами поют', { motives: { fun: 6, social: 3 } }),
  // 🍀 случаи (12)
  E('chance_wallet', 'chance', 'Найден кошелёк', {}, { choices: [C('Вернуть хозяину', { motives: { social: 10 }, rel: 8 }), C('Оставить себе', { money: 60, motives: { fun: -5 } })] }),
  E('chance_street_money', 'chance', 'На дорожке лежит купюра', { money: 20 }),
  E('chance_car_breaks', 'chance', 'Сломалась машина', { money: -150 }, { w: 0.5, when: { career: true } }),
  E('chance_raffle', 'chance', 'Выигрыш в районной лотерее', { money: 150 }),
  E('chance_tree_fell', 'chance', 'Ветром повалило забор', { money: -100 }, { w: 0.4 }),
  E('chance_pipe_burst', 'chance', 'Прорвало трубу', { special: 'puddle' }, { w: 0.4 }),
  E('chance_power_out', 'chance', 'Отключили свет на час', { motives: { fun: -6, comfort: -3 } }),
  E('chance_package', 'chance', 'Загадочная посылка', {}, { choices: [C('Открыть', { money: 200 }, { chance: 0.6, fail: { motives: { fun: -10 } } }), C('Вернуть на почту')] }),
  E('chance_rainbow', 'chance', 'Над домом радуга', { motives: { fun: 6 } }),
  E('chance_bird', 'chance', 'Птица свила гнездо на крыше', { motives: { fun: 4 } }),
  E('chance_street_musician', 'chance', 'Уличный музыкант у дома', {}, { choices: [C('Дать §10', { money: -10, motives: { fun: 8 } }), C('Пройти мимо')] }),
  E('chance_home_cooking', 'chance', 'Соседи угостили пирогом', { motives: { hunger: 20 }, rel: 4 }),
];

// Писатель (data/text/events.js): {id, kind, icon, title, text, fx?, when?{hours, needs}, options?[{key,label,text,fx,chance?,failText?,failFx?}]}.
// Если у события Писателя есть fx/options — механика берётся у него (текст и эффект совпадают); иначе — наша.
const NEEDS = { nojob: { noCareer: true }, job: { career: true }, child: { kids: true }, rich: { moneyGte: 30000 }, single: { single: true }, garden: {} };
export function normFx(fx = {}) {
  const { rel, gift, visitor, job, ...rest } = fx;
  const out = { ...rest };
  if (rel != null) out.rel = typeof rel === 'object' ? rel.delta ?? 0 : rel;
  if (gift) out.gift = gift;
  if (visitor) out.special = 'visitor';
  if (job) out.special = 'jobOffer';
  return out;
}
const fromWriter = t => {
  const o = {};
  if (t.fx) o.fx = normFx(t.fx);
  if (t.options?.length) o.choices = t.options.map(c => ({ label: c.label, fx: normFx(c.fx), text: c.text,
    ...(c.chance != null && { chance: c.chance, fail: normFx(c.failFx), failText: c.failText }) }));
  if (t.when) o.when = { ...(t.when.hours && { hours: t.when.hours }), ...NEEDS[t.when.needs] };
  return o;
};
const known = new Set(BASE.map(e => e.id));
const extra = Object.values(TEXT.events).filter(t => t?.id && !known.has(t.id)).map(t => ({ ...E(t.id, t.kind ?? 'news', t.text, { motives: { fun: 2 } }), ...fromWriter(t), icon: t.icon }));
export const EVENTS = [...BASE.map(e => (TEXT.events[e.id] ? { ...e, ...fromWriter(TEXT.events[e.id]), icon: TEXT.events[e.id].icon } : e)), ...extra].map(e => {
  const t = TEXT.events[e.id];
  return { ...e, text: t?.text ?? e.text, title: t?.title ?? null };
});
export const eventById = Object.fromEntries(EVENTS.map(e => [e.id, e]));
export const EVENT_ICON = { phone: '☎️', letter: '✉️', news: '📰', visitor: '🚪', chance: '🍀', weird: '🛸', lottery: '🎟️', home: '🏠', kids: '🧒', work: '💼' };
