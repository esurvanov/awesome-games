// ═══ РОЛИ: кто и зачем пришёл (работа) ═══
// Доли — по #whois-анкетам чата (≈390 анкет; округлено, сумма ≈ 130: у многих две роли, берём основную).
// Роль задаёт {job}, темы, нужды/предложения и одежду. Характер — MINDS, настроение — MOODS,
// поведение в зале — ARCHETYPES. Игрок выбирает себе роль из этого же списка (анкета profile.role).
//
// ROLES[] — {
//   id, title (2–3 слова), icon
//   weight    доля в зале (относительная)
//   topics[]  id тем (TOPICS), о которых человек этой роли говорит охотно (первые — вероятнее)
//   needs[]   id нужд (NEEDS), которые у роли бывают «ищет»
//   offers[]  id нужд, которые роль может «предложить»
//   look      { style: 'it'|'smart'|'sport'|'party' } — подсказка render/looks
//   сверх схемы:
//   jobs[]    варианты {job} в репликах и карточке («Go-разработчик»)
//   fem       доля женщин в роли (0..1) — для пола и имени
//   age       [мин, макс] лет
//   it        false — не айтишник (учитель, риелтор, музыкант): айтишные темы ему «meh»
// }
'use strict';
L.def('content/roles', () => {
const ROLES = [
  { id: 'backend', title: 'Бэкенд', icon: 'server', weight: 28,
    topics: ['backend', 'ai', 'devops', 'jobs', 'remote', 'crypto'],
    needs: ['job', 'gig', 'flat', 'advice', 'game', 'english'], offers: ['gig', 'advice', 'mentor', 'game', 'cofounder'],
    look: { style: 'it' }, jobs: ['Go-разработчик', 'Java-разработчик', 'PHP-бэкендер', 'питонист', '.NET-разработчик', 'бэкенд-синьор', 'C++ разработчик'],
    fem: 0.15, age: [24, 45] },
  { id: 'ai', title: 'ИИ и данные', icon: 'robot', weight: 16,
    topics: ['ai', 'startup', 'backend', 'jobs', 'crypto'],
    needs: ['job', 'cofounder', 'gig', 'flat'], offers: ['gig', 'mentor', 'cofounder'],
    look: { style: 'it' }, jobs: ['ML-инженер', 'дата-сайентист', 'аналитик данных', 'вайб-кодер', 'промпт-инженер', 'дата-инженер'],
    fem: 0.3, age: [23, 42] },
  { id: 'lead', title: 'Менеджер, лид', icon: 'kanban', weight: 15,
    topics: ['product', 'jobs', 'ai', 'remote', 'startup', 'kids'],
    needs: ['gig', 'flat', 'advice', 'hike'], offers: ['job', 'mentor', 'advice'],
    look: { style: 'smart' }, jobs: ['тимлид', 'проджект', 'продакт', 'CTO', 'деливери-менеджер', 'бизнес-аналитик', 'скрам-мастер'],
    fem: 0.35, age: [28, 50] },
  { id: 'biz', title: 'Свой бизнес', icon: 'rocket', weight: 12,
    topics: ['startup', 'marketing', 'crypto', 'housing', 'ai', 'banks'],
    needs: ['gig', 'job', 'cofounder'], offers: ['job', 'flat', 'advice', 'cofounder'],
    look: { style: 'smart' }, jobs: ['основатель стартапа', 'владелец студии', 'предприниматель', 'кофаундер', 'директор IT-компании'],
    fem: 0.25, age: [28, 55] },
  { id: 'frontend', title: 'Фронтенд', icon: 'browser', weight: 9,
    topics: ['frontend', 'design', 'ai', 'jobs', 'games'],
    needs: ['job', 'gig', 'flat', 'mentor', 'english'], offers: ['gig', 'mentor'],
    look: { style: 'it' }, jobs: ['фронтендер', 'React-разработчик', 'фулстек', 'верстальщик', 'Vue-разработчик'],
    fem: 0.3, age: [22, 40] },
  { id: 'qa', title: 'Тестировщик', icon: 'bug', weight: 9,
    topics: ['qa', 'jobs', 'remote', 'ai', 'travel'],
    needs: ['job', 'gig', 'mentor', 'english'], offers: ['gig', 'mentor'],
    look: { style: 'it' }, jobs: ['QA-автоматизатор', 'ручной тестировщик', 'QA-лид', 'AQA на Python'],
    fem: 0.5, age: [23, 45] },
  { id: 'design', title: 'Дизайнер', icon: 'pen', weight: 8,
    topics: ['design', 'frontend', 'travel', 'music', 'pets'],
    needs: ['gig', 'job', 'flat'], offers: ['gig'],
    look: { style: 'party' }, jobs: ['продуктовый дизайнер', 'UX/UI-дизайнер', 'моушн-дизайнер', 'дизайнер интерфейсов', 'иллюстратор'],
    fem: 0.6, age: [23, 40] },
  { id: 'marketing', title: 'Маркетинг', icon: 'megaphone', weight: 8,
    topics: ['marketing', 'startup', 'ai', 'travel', 'food'],
    needs: ['gig', 'job', 'cofounder'], offers: ['gig', 'advice'],
    look: { style: 'party' }, jobs: ['маркетолог', 'SMM-щик', 'таргетолог', 'контент-менеджер', 'growth-менеджер'],
    fem: 0.6, age: [23, 42] },
  { id: 'crypto', title: 'Крипта', icon: 'coin', weight: 8,
    topics: ['crypto', 'banks', 'startup', 'ai', 'travel'],
    needs: ['cofounder', 'gig'], offers: ['exchange', 'gig', 'cofounder'],
    look: { style: 'smart' }, jobs: ['трейдер', 'блокчейн-разработчик', 'DeFi-аналитик', 'криптоэнтузиаст', 'солидити-разработчик'],
    fem: 0.15, age: [22, 45] },
  { id: 'mobile', title: 'Мобильная разработка', icon: 'mobile', weight: 6,
    topics: ['mobile', 'frontend', 'jobs', 'games'],
    needs: ['job', 'gig', 'flat'], offers: ['gig', 'mentor'],
    look: { style: 'it' }, jobs: ['iOS-разработчик', 'Android-разработчик', 'Flutter-разработчик', 'Kotlin-разработчик'],
    fem: 0.2, age: [23, 40] },
  { id: 'devops', title: 'Девопс', icon: 'cloud', weight: 5,
    topics: ['devops', 'backend', 'crypto', 'sport', 'games'],
    needs: ['job', 'game', 'hike'], offers: ['gig', 'advice', 'mentor'],
    look: { style: 'sport' }, jobs: ['девопс', 'SRE', 'сисадмин', 'платформенный инженер', 'кубернетес-инженер'],
    fem: 0.1, age: [25, 48] },
  { id: 'hr', title: 'HR, рекрутер', icon: 'team', weight: 4,
    topics: ['jobs', 'remote', 'product', 'travel'],
    needs: ['advice', 'flat'], offers: ['job', 'mentor'],
    look: { style: 'smart' }, jobs: ['IT-рекрутер', 'HR-бизнес-партнёр', 'сорсер', 'эйчар стартапа'],
    fem: 0.8, age: [24, 42] },
  { id: 'teacher', title: 'Преподаватель', icon: 'book', weight: 3, it: false,
    topics: ['georgian', 'kids', 'travel', 'jobs', 'city'],
    needs: ['flat', 'advice'], offers: ['english', 'georgian', 'mentor'],
    look: { style: 'smart' }, jobs: ['учитель английского', 'репетитор', 'преподаватель языков', 'учитель грузинского'],
    fem: 0.7, age: [25, 55] },
  { id: 'realtor', title: 'Риелтор', icon: 'house', weight: 3, it: false,
    topics: ['housing', 'city', 'banks', 'vnzh'],
    needs: ['gig'], offers: ['flat', 'advice'],
    look: { style: 'smart' }, jobs: ['риелтор', 'агент по недвижимости', 'управляющий апартаментами'],
    fem: 0.55, age: [27, 55] },
  { id: 'musician', title: 'Музыкант', icon: 'music', weight: 2, it: false,
    topics: ['music', 'city', 'travel', 'food'],
    needs: ['gig', 'flat', 'job'], offers: ['game'],
    look: { style: 'party' }, jobs: ['саксофонист', 'гитарист', 'звукорежиссёр', 'диджей'],
    fem: 0.3, age: [22, 45] },
];
return { ROLES };
});
