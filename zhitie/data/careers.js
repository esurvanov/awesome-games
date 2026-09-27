// Карьеры «Житьё» — механика (владелец: Мозг). Названия/описания должностей и тексты карточек — Писатель
// (data/text/careers.js, ключи: трек → levels[i].title/desc, chance[i].text/a/b); здесь — запасные названия.
// ✅ Бизнес — полная таблица TS1; остальные: зарплата L1→L10 по якорям TS1 (S10) геометрией, навыки/часы/друзья ≈.
import { TEXT } from '../js/sim/content.js';

const FRIENDS = [0, 0, 0, 1, 3, 6, 8, 10, 12, 14];   // ✅ Бизнес; остальным — множитель ≈

const BUSINESS = [
  { title: 'Курьер почтового отдела', pay: 120, hours: [9, 15], skills: {} },
  { title: 'Секретарь-референт', pay: 180, hours: [9, 16], skills: {} },
  { title: 'Торговый представитель', pay: 250, hours: [9, 16], skills: { mechanical: 2 } },
  { title: 'Младший менеджер', pay: 320, hours: [9, 16], skills: { mechanical: 2, charisma: 2 } },
  { title: 'Менеджер', pay: 400, hours: [8, 15], skills: { mechanical: 2, charisma: 2, logic: 2 } },
  { title: 'Старший менеджер', pay: 520, hours: [8, 15], skills: { mechanical: 2, charisma: 3, logic: 3, creativity: 2 } },
  { title: 'Вице-президент', pay: 660, hours: [9, 17], skills: { mechanical: 2, charisma: 4, body: 2, logic: 4, creativity: 2 } },
  { title: 'Президент', pay: 800, hours: [9, 17], skills: { mechanical: 2, charisma: 5, body: 2, logic: 6, creativity: 3 } },
  { title: 'Генеральный директор', pay: 950, hours: [9, 16], skills: { mechanical: 2, charisma: 8, body: 2, logic: 7, creativity: 5 } },
  { title: 'Магнат', pay: 1200, hours: [9, 15], skills: { mechanical: 2, charisma: 8, body: 2, logic: 9, creativity: 6 } },
].map((l, i) => ({ ...l, friends: FRIENDS[i] }));

// ≈ трек по якорям: зарплата геометрией, навыки степенной кривой к целям L10, друзья — кривая Бизнеса × k
function track({ pay1, pay10, top, hours, friendsK = 1, titles }) {
  return titles.map((title, i) => {
    const t = i / 9, skills = {};
    for (const [k, v] of Object.entries(top)) { const lv = Math.round(v * t ** 1.3); if (lv > 0) skills[k] = lv; }
    return { title, pay: Math.round((pay1 * (pay10 / pay1) ** t) / 5) * 5, hours: hours(i + 1), skills, friends: Math.round(FRIENDS[i] * friendsK), approx: true };
  });
}

const DEF = {
  business: { name: 'Бизнес', icon: '💼', levels: BUSINESS, skill: 'charisma' },
  entertainment: { name: 'Шоу-бизнес', icon: '🎭', skill: 'charisma', levels: track({ pay1: 100, pay10: 1400, top: { charisma: 10, body: 6, creativity: 8 }, friendsK: 1.3,
    hours: l => (l < 6 ? [9, 15] : [10, 18]), titles: ['Статист', 'Каскадёр', 'Актёр эпизода', 'Актёр рекламы', 'Актёр сериала', 'Актёр театра', 'Звезда кино', 'Суперзвезда', 'Легенда', 'Икона эпохи'] }) },
  law: { name: 'Полиция', icon: '🚓', skill: 'body', levels: track({ pay1: 240, pay10: 700, top: { body: 8, logic: 6, mechanical: 4, charisma: 5 },
    hours: l => (l < 3 ? [21, 3] : l < 7 ? [9, 15] : [9, 17]), titles: ['Сторож', 'Патрульный', 'Сержант', 'Лейтенант', 'Детектив', 'Капитан', 'Майор', 'Полковник', 'Генерал', 'Министр'] }) },
  crime: { name: 'Криминал', icon: '🕶️', skill: 'mechanical', levels: track({ pay1: 140, pay10: 1100, top: { mechanical: 8, charisma: 6, body: 5, creativity: 5 }, friendsK: 1.5,
    hours: l => (l < 4 ? [9, 15] : [21, 3]), titles: ['Карманник', 'Угонщик', 'Шулер', 'Контрабандист', 'Взломщик', 'Фальшивомонетчик', 'Аферист', 'Налётчик', 'Крёстный отец', 'Теневой магнат'] }) },
  medicine: { name: 'Медицина', icon: '🩺', skill: 'logic', levels: track({ pay1: 200, pay10: 850, top: { mechanical: 7, logic: 8, body: 5, charisma: 4 },
    hours: l => (l < 4 ? [9, 15] : l < 7 ? [8, 16] : [9, 17]), titles: ['Санитар', 'Медбрат', 'Фельдшер', 'Интерн', 'Ординатор', 'Врач', 'Хирург', 'Главврач', 'Профессор медицины', 'Светило медицины'] }) },
  military: { name: 'Армия', icon: '🎖️', skill: 'body', levels: track({ pay1: 250, pay10: 650, top: { mechanical: 6, body: 10, charisma: 6, logic: 4 }, friendsK: 0.8,
    hours: l => (l < 5 ? [6, 12] : [7, 15]), titles: ['Новобранец', 'Рядовой', 'Ефрейтор', 'Сержант', 'Прапорщик', 'Лейтенант', 'Капитан', 'Майор', 'Полковник', 'Генерал армии'] }) },
  politics: { name: 'Политика', icon: '🏛️', skill: 'charisma', levels: track({ pay1: 220, pay10: 750, top: { charisma: 10, logic: 6, creativity: 5, body: 2 }, friendsK: 2,
    hours: l => (l < 5 ? [9, 17] : [9, 16]), titles: ['Агитатор', 'Помощник депутата', 'Муниципал', 'Советник', 'Депутат', 'Вице-мэр', 'Мэр', 'Губернатор', 'Министр', 'Президент страны'] }) },
  athletics: { name: 'Спорт', icon: '🏅', skill: 'body', levels: track({ pay1: 110, pay10: 1300, top: { body: 10, charisma: 6, creativity: 3 },
    hours: l => (l < 4 ? [12, 18] : [10, 16]), titles: ['Талисман команды', 'Запасной', 'Игрок основы', 'Капитан', 'Звезда лиги', 'Сборник', 'Чемпион', 'Рекордсмен', 'Легенда спорта', 'Зал славы'] }) },
  science: { name: 'Наука', icon: '🔬', skill: 'logic', levels: track({ pay1: 155, pay10: 1000, top: { logic: 10, mechanical: 6, cooking: 3, charisma: 4 },
    hours: l => (l < 5 ? [9, 15] : [10, 17]), titles: ['Подопытный', 'Лаборант', 'Младший научный сотрудник', 'Научный сотрудник', 'Завлаб', 'Кандидат наук', 'Доктор наук', 'Профессор', 'Академик', 'Нобелевский лауреат'] }) },
  xtreme: { name: 'Экстрим', icon: '🪂', skill: 'body', levels: track({ pay1: 175, pay10: 925, top: { body: 9, charisma: 6, creativity: 5, logic: 3 },
    hours: l => (l < 5 ? [9, 15] : [11, 17]), titles: ['Каскадёр-любитель', 'Инструктор по банджи', 'Рафтер', 'Горный гид', 'Парашютист', 'Альпинист', 'Покоритель вершин', 'Звезда экстрима', 'Исследователь полюсов', 'Легенда экстрима'] }) },
};

// Тексты Писателя поверх запасных названий
for (const [k, c] of Object.entries(DEF)) {
  const t = TEXT.careers[k];
  if (t?.name) c.name = t.name;
  c.levels.forEach((l, i) => { const lt = t?.levels?.[i]; if (lt?.title) l.title = lt.title; if (lt?.desc) l.desc = lt.desc; });
}
export const CAREERS = DEF;

// Карточки случая (✅ TS1): рискованный вариант A (успех ∝ навык трека) и безопасный B
// Эффекты: money, perf, motives{…}, skill{name: +x}. Тексты — Писатель: TEXT.careers[track].chance[i] или TEXT.chance[`${track}_${i}`].
export const CHANCE = Object.fromEntries(Object.entries(DEF).map(([k, c]) => [k, [
  { id: `${k}_0`, text: `${c.name}: рискованная сделка`, a: { label: 'Рискнуть', ok: { money: 500, perf: 15 }, fail: { money: -300, perf: -15 } }, b: { label: 'Отказаться', ok: { perf: 3 } } },
  { id: `${k}_1`, text: `${c.name}: сверхурочный проект`, a: { label: 'Взяться', ok: { perf: 25, motives: { energy: -20 } }, fail: { perf: -10, motives: { fun: -20 } } }, b: { label: 'Отложить', ok: { motives: { fun: 5 } } } },
  { id: `${k}_2`, text: `${c.name}: курсы повышения`, a: { label: 'Записаться', ok: { skill: { [c.skill]: 1 }, money: -100 }, fail: { money: -100 } }, b: { label: 'Не сейчас', ok: {} } },
]]));
export const chanceText = (track, i, card) => {
  const t = TEXT.careers[track]?.chance?.[i] ?? TEXT.chance[card.id];
  return { text: t?.text ?? card.text, a: t?.a ?? t?.choices?.[0] ?? card.a.label, b: t?.b ?? t?.choices?.[1] ?? card.b.label, aOk: t?.aOk, aFail: t?.aFail, bOk: t?.bOk };
};
