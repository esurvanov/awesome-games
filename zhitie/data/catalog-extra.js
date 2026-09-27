// Расширение каталога (волна 3). Владелец — 🪑 агент Каталог. Отчёт: docs/reports/catalog.md
//
// Формат записи — как в data/catalog.js + обязательные поля:
//   kind      — id базового предмета (одного из 38) или новый вид из CONTRACT §9; поведение/места/запасная модель — по kind
//   tags[]    — стиль/тир/коллекция ('scandi','granny','hitech','dacha','lux','student','kids','retro','sport','outdoor','community'…)
//   desc      — описание в духе карточки Buy-режима TS1 (1–2 предложения)
//   buyable   — false у объектов общественных участков (cat:'community') и служебных
// Необязательные: variantOf (id предмета-«формы», чей это цветовой вариант; модель = его модель + tint),
//   tint ('#hex' — основной цвет, Рендер/Ассеты красят главный материал), skills, walkable, portal, mount ('ceiling' — подсказка).
//
// Лестницы цен/рейтингов: внутри одного kind «дороже → сумма рейтингов не меньше» (tests/catalog.test.mjs).
// Цветовые варианты повторяют цену, след и рейтинги своей формы.
//
// ВАЖНО: этот файл импортируется из data/catalog.js — отсюда catalog.js НЕ импортировать (цикл).
// Поэтому поля базовых предметов, у которых есть цветовые варианты, продублированы в BASE_REF
// (тест сверяет их с настоящим CATALOG).

// ─────────────────────────── Палитра вариантов ───────────────────────────
// key → [подпись (существительное, чтобы не согласовывать род), hex, шутка для описания]
export const PALETTE = {
  cherry:    ['вишня',          '#9e2b33', 'Цвет спелой вишни — прячет пятна от вишнёвого варенья.'],
  mint:      ['мята',           '#9fd8c0', 'Мятный оттенок освежает интерьер лучше жвачки.'],
  graphite:  ['графит',         '#3a3d42', 'Строгий графит: для тех, кто и в пижаме ходит на совещания.'],
  cream:     ['сливки',         '#efe4c8', 'Сливочный цвет — как торт, только есть нельзя.'],
  mustard:   ['горчица',        '#c9a227', 'Горчичный — смелый выбор для смелых хозяев и их смелых гостей.'],
  lavender:  ['лаванда',        '#a89bd1', 'Лавандовый — моль его ненавидит, дизайнеры обожают.'],
  sea:       ['морская волна',  '#2f8f8f', 'Цвет морской волны: отпуск, который всегда с вами.'],
  coral:     ['коралл',         '#e9765b', 'Коралловый: риф в океане тускнеет от зависти.'],
  avocado:   ['авокадо',        '#8a9a3b', 'Авокадо — привет из семидесятых, они передают, что скучают.'],
  terracotta:['терракота',      '#b8603e', 'Терракотовый — тёплый, как бабушкин цветочный горшок.'],
  walnut:    ['орех',           '#5b3a24', 'Отделка «орех»: солидно, как кабинет нотариуса.'],
  birch:     ['берёза',         '#e2cfa6', 'Светлая «берёза» — будто стоишь в роще, но с вай-фаем.'],
  oak:       ['дуб',            '#a2784a', 'Дубовая отделка: крепко, надёжно, немного консервативно.'],
  silver:    ['серебро',        '#b9bec4', 'Серебристый: выглядит дороже, чем стоит. Мы никому не скажем.'],
  gold:      ['золото',         '#c8a24a', 'Позолота — для тех, кому мало просто хорошо.'],
  lilac:     ['сирень',         '#c7a0c9', 'Сиреневый — пахнет маем, даже в ноябре.'],
  sky:       ['небо',           '#7fb3e0', 'Небесно-голубой: мечтать удобнее.'],
  forest:    ['лес',            '#3f6b45', 'Лесной зелёный — для тех, кто в поход не ходит, но хочет.'],
  rose:      ['роза',           '#e59bb4', 'Розовый. Да, настоящим хозяевам можно.'],
  lemon:     ['лимон',          '#f0d64a', 'Лимонный цвет бодрит без кофеина.'],
  chocolate: ['шоколад',        '#4a2c20', 'Шоколадный — ноль калорий, сто процентов уюта.'],
  snow:      ['пломбир',        '#f4f2ec', 'Белый как пломбир. Держите подальше от детей с фломастерами.'],
  coal:      ['уголь',          '#1f1f22', 'Угольно-чёрный: стильно, загадочно, пыль видно.'],
  sand:      ['песок',          '#d7c08f', 'Песочный: пляж без песка в ботинках.'],
  orange:    ['апельсин',       '#e0803a', 'Апельсиновый — витамин C для глаз.'],
  navy:      ['морской флот',   '#26395f', 'Тёмно-синий, как китель адмирала.'],
  red:       ['пожарный',       '#c8322e', 'Красный: быстрее на три процента. Проверено никем.'],
  teal:      ['бирюза',         '#3fb0a9', 'Бирюзовый — как бабушкины серьги, только модно.'],
  plum:      ['баклажан',       '#5e2f55', 'Цвет «баклажан»: овощ года по версии нашего отдела маркетинга.'],
  latte:     ['кофе с молоком', '#b08d6a', 'Кофе с молоком — единственный кофе, от которого не бессонница.'],
};

// ─────────────────── Поля базовых предметов, у которых есть варианты ───────────────────
// (копия из data/catalog.js — тест проверяет совпадение)
const BASE_REF = {
  dining_chair: { name: 'Стул «Табурет-люкс»',  price: 80,  fp: [1, 1], place: 'floor', cat: 'seating',     room: 'kitchen',  depr: 'furniture',   bill: true, ratings: { comfort: 2 }, desc: 'Классика кухонной посадки: четыре ноги, одна спинка, ноль претензий.' },
  armchair:     { name: 'Кресло',               price: 250, fp: [1, 1], place: 'floor', cat: 'seating',     room: 'living',   depr: 'furniture',   bill: true, ratings: { comfort: 4 }, desc: 'Кресло как кресло. Садишься — и ты уже в кресле.' },
  sofa:         { name: 'Диван «Уют»',          price: 450, fp: [2, 1], place: 'floor', cat: 'seating',     room: 'living',   depr: 'furniture',   bill: true, ratings: { comfort: 5, energy: 3 }, desc: 'Диван, на котором задремал хотя бы раз каждый член семьи. И кот.' },
  bed_single:   { name: 'Кровать «Спартанец»',  price: 300, fp: [1, 2], place: 'floor', cat: 'seating',     room: 'bedroom',  depr: 'furniture',   bill: true, ratings: { comfort: 6, energy: 7 }, desc: 'Спать на ней можно. Мечтать — только о другой кровати.' },
  bed_double:   { name: 'Кровать двуспальная',  price: 750, fp: [2, 2], place: 'floor', cat: 'seating',     room: 'bedroom',  depr: 'furniture',   bill: true, ratings: { comfort: 7, energy: 8 }, desc: 'Места хватит двоим, если один из них не раскидывается звездой.' },
  dining_table: { name: 'Обеденный стол',       price: 200, fp: [2, 1], place: 'floor', cat: 'surfaces',    room: 'kitchen',  depr: 'furniture',   bill: true, ratings: {}, desc: 'За этим столом обсуждали всё: от пересоленного супа до смысла жизни.' },
  coffee_table: { name: 'Журнальный столик',    price: 90,  fp: [2, 1], place: 'floor', cat: 'surfaces',    room: 'living',   depr: 'furniture',   bill: true, ratings: {}, desc: 'Идеален для журналов, пульта и ног, которые на нём быть не должны.' },
  counter:      { name: 'Кухонная стойка',      price: 150, fp: [1, 1], place: 'floor', cat: 'surfaces',    room: 'kitchen',  depr: 'furniture',   bill: true, ratings: {}, desc: 'Рабочая поверхность для нарезки, раскатки и драматичного облокачивания.' },
  fridge:       { name: 'Холодильник «Мороз»',  price: 600, fp: [1, 1], place: 'floor', cat: 'appliances',  room: 'kitchen',  depr: 'appliances',  bill: true, ratings: { hunger: 6 }, desc: 'Гудит по ночам, хранит продукты днём. Настоящий трудяга.' },
  stove:        { name: 'Плита «Хозяюшка»',     price: 400, fp: [1, 1], place: 'floor', cat: 'appliances',  room: 'kitchen',  depr: 'appliances',  bill: true, ratings: { hunger: 6 }, desc: 'Четыре конфорки и духовка. Огнетушитель продаётся отдельно.' },
  toilet:       { name: 'Унитаз «Фаянс»',       price: 300, fp: [1, 1], place: 'floor', cat: 'plumbing',    room: 'bathroom', depr: 'appliances',  bill: true, ratings: { bladder: 8 }, desc: 'Надёжный фаянсовый друг. Не задаёт вопросов.' },
  shower:       { name: 'Душевая кабина',       price: 650, fp: [1, 1], place: 'floor', cat: 'plumbing',    room: 'bathroom', depr: 'appliances',  bill: true, ratings: { hygiene: 6 }, desc: 'Горячая вода, звонкая акустика — идеальная сцена для утренних арий.' },
  bathtub:      { name: 'Ванна',                price: 900, fp: [2, 1], place: 'floor', cat: 'plumbing',    room: 'bathroom', depr: 'appliances',  bill: true, ratings: { hygiene: 7, comfort: 4 }, desc: 'Полежать, отмокнуть, подумать о вечном и о счёте за воду.' },
  bath_sink:    { name: 'Раковина',             price: 200, fp: [1, 1], place: 'floor', cat: 'plumbing',    room: 'bathroom', depr: 'appliances',  bill: true, ratings: { hygiene: 2 }, desc: 'Для рук, зубов и философских взглядов в зеркало над ней.' },
  tv:           { name: 'Телевизор «Горизонт»', price: 500, fp: [1, 1], place: 'floor', cat: 'electronics', room: 'living',   depr: 'electronics', bill: true, ratings: { fun: 4 }, desc: 'Сорок каналов, и по всем одно и то же. Но смотреть приятно.' },
  phone:        { name: 'Телефон',              price: 50,  fp: [1, 1], place: 'surface', cat: 'electronics', room: 'any',    depr: 'electronics', bill: true, ratings: {}, desc: 'Звонит всегда в самый неподходящий момент. Это его работа.' },
  floor_lamp:   { name: 'Торшер',               price: 100, fp: [1, 1], place: 'floor', cat: 'lighting',    room: 'any',      depr: 'furniture',   bill: true, ratings: { room: 1 }, desc: 'Мягкий свет для чтения, вязания и загадочного вида у окна.' },
  rug:          { name: 'Ковёр',                price: 120, fp: [2, 2], place: 'floor', cat: 'decor',       room: 'any',      depr: 'furniture',   bill: true, ratings: { room: 2 }, walkable: true, desc: 'Прикрывает пол, пятна на полу и следы неудачной покраски пола.' },
  plant:        { name: 'Фикус',                price: 60,  fp: [1, 1], place: 'floor', cat: 'decor',       room: 'any',      depr: 'furniture',   bill: true, ratings: { room: 2 }, desc: 'Фикус. Живёт годами, если не забывать поливать. Все забывают.' },
  dresser:      { name: 'Комод',                price: 200, fp: [1, 1], place: 'floor', cat: 'misc',        room: 'bedroom',  depr: 'furniture',   bill: true, ratings: {}, desc: 'Ящики для носков. Все носки без пары — тоже здесь.' },
  door:         { name: 'Дверь деревянная',     price: 150, fp: [1, 1], place: 'wall',  cat: 'build',       room: 'any',      depr: 'none',        bill: false, ratings: {}, portal: true, desc: 'Открывается, закрывается. Иногда хлопает.' },
  crib:         { name: 'Детская кроватка',     price: 300, fp: [1, 1], place: 'floor', cat: 'misc',        room: 'bedroom',  depr: 'furniture',   bill: true, ratings: {}, desc: 'Решётчатая крепость для самого главного жильца дома.' },
};
export const BASE_VARIANT_REF = BASE_REF; // для тестов

// ─────────────────────────── Формы (уникальные модели) ───────────────────────────
const SHAPES = [];
// rows: [id, kind, name, price, ratings, desc, extra?]
function block(defaults, rows) {
  for (const [id, kind, name, price, ratings, desc, extra = {}] of rows) {
    const tags = [...(defaults.tags || []), ...(extra.tags || [])];
    SHAPES.push({ id, name, price, fp: [1, 1], ...defaults, ...extra, kind, ratings, desc, tags });
  }
}
const F = { place: 'floor', bill: true, depr: 'furniture' };

// — Сиденья: обеденные и офисные стулья (kind dining_chair; база §80 comfort 2) —
block({ ...F, cat: 'seating', room: 'kitchen', tags: ['chair'] }, [
  ['chair_folding',   'dining_chair', 'Стул складной «Дачник»',         45,  { comfort: 1 }, 'Складывается за секунду, раскладывается за пятнадцать минут и два прищемлённых пальца.', { tags: ['dacha', 'student'], tint: '#6f8f5a' }],
  ['chair_bar_stool', 'dining_chair', 'Табурет барный «Стойка смирно»',  60,  { comfort: 1 }, 'Сидеть высоко, падать далеко. Спинка не предусмотрена — держите осанку.', { tags: ['retro'], tint: '#b83a3a' }],
  ['chair_plastic',   'dining_chair', 'Стул пластиковый «Летний дождь»', 70,  { comfort: 1 }, 'Не боится ни дождя, ни шашлыка, ни тёти Вали. Штабелируется до потолка.', { room: 'outside', tags: ['dacha', 'outdoor'], tint: '#f2f0ea' }],
  ['chair_rustic',    'dining_chair', 'Стул «Избушка»',                  110, { comfort: 2 }, 'Сколочен топором, отшлифован временем. Занозы — бесплатно.', { tags: ['dacha', 'granny'], tint: '#8a6440' }],
  ['chair_scandi',    'dining_chair', 'Стул «Фьорд»',                    150, { comfort: 3 }, 'Светлое дерево, прямые линии, 14 шестигранников в комплекте. Собирается с первого раза у каждого третьего.', { tags: ['scandi'], tint: '#e2cfa6' }],
  ['chair_vienna',    'dining_chair', 'Стул «Бабуля Венская»',           220, { comfort: 3, room: 1 }, 'Гнутый бук и вековая элегантность. Скрипит исключительно благородно.', { tags: ['granny', 'retro'], tint: '#5b3a24' }],
  ['chair_office',    'dining_chair', 'Кресло офисное «Начальник отдела»', 320, { comfort: 4 }, 'Крутится, катается и подкладывает под спину чувство собственной важности.', { room: 'study', tags: ['office'], tint: '#2b2b2e' }],
  ['chair_hitech',    'dining_chair', 'Стул «Кибер-Табурет»',            450, { comfort: 5, room: 1 }, 'Хромированный каркас и сиденье из материала, название которого засекречено.', { tags: ['hitech'], tint: '#b9bec4' }],
  ['chair_exec',      'dining_chair', 'Кресло «Генеральный»',            800, { comfort: 7, room: 1 }, 'Натуральная кожа, подголовник и ощущение, что вам вот-вот поднимут зарплату.', { room: 'study', tags: ['office', 'lux'], tint: '#4a2c20' }],
  ['chair_parisienne','dining_chair', 'Стул «Парижанка»',                1200, { comfort: 6, room: 3 }, 'Бархат, резьба и французский акцент. Садиться — только с прямой спиной.', { tags: ['lux', 'classic'], tint: '#7d2a45' }],
]);

// — Кресла (kind armchair; база §250 comfort 4) —
block({ ...F, cat: 'seating', room: 'living', tags: ['armchair'] }, [
  ['beanbag',          'armchair', 'Кресло-мешок «Плюх»',            120, { comfort: 3 }, 'Принимает форму любого, кто в него упал. Встать — отдельный квест.', { tags: ['student', 'kids'], tint: '#e0803a' }],
  ['deck_chair',       'armchair', 'Шезлонг «Черноморец»',          180, { comfort: 3 }, 'Полосатый, складной, пахнет морем. Моря в комплекте нет.', { room: 'outside', tags: ['dacha', 'outdoor'], tint: '#3f6fb5' }],
  ['armchair_rocking', 'armchair', 'Кресло-качалка «Дедушкино»',    300, { comfort: 4, room: 1 }, 'Качается само, если достаточно долго на него смотреть.', { tags: ['granny', 'dacha'], tint: '#8a6440' }],
  ['armchair_granny',  'armchair', 'Кресло «Бабушкин трон»',        400, { comfort: 5, room: 1 }, 'Кружевные салфетки на подлокотниках входят в стоимость. Снимать запрещено.', { tags: ['granny'], tint: '#8a4b5a' }],
  ['armchair_scandi',  'armchair', 'Кресло «Сканди-Лось»',          550, { comfort: 6, room: 1 }, 'Шерстяной плед и мягкие изгибы — хюгге в одном предмете мебели.', { tags: ['scandi'], tint: '#c9c3b6' }],
  ['recliner',         'armchair', 'Кресло-реклайнер «Фон Диван»',  850, { comfort: 9, energy: 3 }, 'Откидывается одним рычагом. Обратно — только силой воли, которой у вас нет.', { tags: ['comfy'], tint: '#6b4a2f' }],
  ['armchair_egg',     'armchair', 'Кресло-яйцо «Орбита»',          1100, { comfort: 8, energy: 3, room: 2 }, 'Сидите внутри яйца и чувствуете себя космонавтом. Или цыплёнком.', { tags: ['hitech', 'retro'], tint: '#f4f2ec' }],
  ['armchair_chester', 'armchair', 'Кресло «Честерфилд-Барин»',     1500, { comfort: 9, energy: 3, room: 3 }, 'Каретная стяжка, кожа, запах сигар (сигары не курите, это ароматизатор).', { tags: ['lux', 'classic'], tint: '#4a2c20' }],
]);

// — Диваны (kind sofa; база §450 comfort 5 energy 3) —
block({ ...F, cat: 'seating', room: 'living', fp: [2, 1], tags: ['sofa'] }, [
  ['sofa_student',   'sofa', 'Диван «Студент»',                 200, { comfort: 3, energy: 4 }, 'Достался от прошлых жильцов прошлых жильцов. Пружины помнят всё.', { tags: ['student'], tint: '#7a7f5a' }],
  ['loveseat',       'sofa', 'Диванчик «Двое в лодке»',         320, { comfort: 4, energy: 3 }, 'Ровно на двоих. Третий — лишний, это не мы придумали.', { tags: ['romance'], tint: '#b8603e' }],
  ['sofa_granny',    'sofa', 'Диван «Бабушкин с покрывалом»',   380, { comfort: 5, energy: 3 }, 'Под покрывалом — диван. Под диваном — носки трёх поколений.', { tags: ['granny'], tint: '#8a4b5a' }],
  ['sofa_scandi',    'sofa', 'Диван «Хюгге»',                   700, { comfort: 6, energy: 4, room: 1 }, 'Серый лён, светлые ножки, горы подушек. Свечи зажигаются сами (нет).', { tags: ['scandi'], tint: '#c9c3b6' }],
  ['sofa_cloud',     'sofa', 'Диван «Облако-3000»',             900, { comfort: 7, energy: 4, room: 1 }, 'Мягкость, одобренная тремя котами и одним очень придирчивым дедушкой.', { tags: ['comfy', 'modern'], tint: '#dfe6ee' }],
  ['sofa_corner',    'sofa', 'Угловой диван «Л-Гигант»',        1100, { comfort: 8, energy: 5, room: 1 }, 'Букву «Л» он занимает целиком. И половину гостиной тоже.', { fp: [3, 1], tags: ['modern'], tint: '#556070' }],
  ['sofa_chrome',    'sofa', 'Диван «Хром-Модуль»',             1250, { comfort: 8, energy: 5, room: 2 }, 'Модульный, хромированный и холодный на ощупь — зато как смотрится!', { tags: ['hitech'], tint: '#2b2b2e' }],
  ['sofa_couture',   'sofa', 'Диван «Тутти-Кутюр»',             1450, { comfort: 9, energy: 5, room: 3 }, 'Сочные цвета и итальянская набивка. Садиться в джинсах — моветон.', { tags: ['lux'], tint: '#e05a7a' }],
]);

// — Кровати —
block({ ...F, cat: 'seating', room: 'bedroom', fp: [1, 2], tags: ['bed'] }, [
  ['bed_cot',           'bed_single', 'Раскладушка «Гость»',          120, { comfort: 3, energy: 5 }, 'Намекает гостям, что три дня — это максимум.', { tags: ['student', 'dacha'], tint: '#6f8f5a' }],
  ['bed_single_scandi', 'bed_single', 'Кровать «Норд-Сон»',           500, { comfort: 7, energy: 8 }, 'Минимализм, от которого спится максимально.', { tags: ['scandi'], tint: '#e2cfa6' }],
  ['bed_single_lux',    'bed_single', 'Кровать «Княжна»',             900, { comfort: 8, energy: 9, room: 1 }, 'Горошину под матрас не кладите — проверено, почувствуют.', { tags: ['lux', 'classic'], tint: '#e7a0b8' }],
]);
block({ ...F, cat: 'seating', room: 'bedroom', fp: [2, 2], tags: ['bed'] }, [
  ['bed_double_cheap',  'bed_double', 'Кровать «Эконом-Двойня»',      450, { comfort: 6, energy: 7 }, 'Две половинки, одна щель посередине. Спите дружно.', { tags: ['student'], tint: '#8a8d93' }],
  ['bed_sleigh',        'bed_double', 'Кровать-сани «Наполеон отдыхает»', 1000, { comfort: 8, energy: 9 }, 'Изогнутые спинки и имперский размах. Отступать с неё не хочется.', { tags: ['classic'], tint: '#5b3a24' }],
  ['bed_double_scandi', 'bed_double', 'Кровать «Хюгге-Дуэт»',         1300, { comfort: 8, energy: 9, room: 1 }, 'Белый лён, светлый дуб и вечное воскресное утро.', { tags: ['scandi'], tint: '#e2cfa6' }],
  ['bed_water',         'bed_double', 'Водяная кровать «Прибой»',     1800, { comfort: 9, energy: 9, room: 1 }, 'Лёгкое покачивание гарантировано. Морская болезнь — за ваш счёт.', { tags: ['retro'], tint: '#3f7fb5' }],
  ['bed_round',         'bed_double', 'Кровать круглая «Луна-парк»',  2200, { comfort: 9, energy: 10, room: 1 }, 'Где у неё изголовье — выясняйте сами. Мы до сих пор спорим.', { tags: ['retro', 'lux'], tint: '#c7a0c9' }],
  ['bed_mission',       'bed_double', 'Кровать «Модерн-Миссия»',      3000, { comfort: 9, energy: 10, room: 2 }, 'Сон на ней — это не отдых, это достижение.', { tags: ['lux', 'modern'], tint: '#3a2a20' }],
]);
block({ ...F, cat: 'seating', room: 'bedroom', fp: [1, 2], tags: ['bed', 'kids'] }, [
  ['kids_bed_basic',  'kids_bed', 'Детская кровать «Колобок»',               220, { comfort: 5, energy: 7 }, 'Невысокая, с бортиком — чтобы ночные приключения заканчивались в кровати.', { tint: '#7fb3e0' }],
  ['kids_bed_car',    'kids_bed', 'Кровать-машинка «Турбо-Сон»',             350, { comfort: 6, energy: 7, fun: 1 }, 'Разгоняется от «ещё пять минут» до «сплю» за четыре сказки.', { tint: '#c8322e' }],
  ['kids_bed_castle', 'kids_bed', 'Кровать-замок «Принцесса на горошине»',   600, { comfort: 7, energy: 8, fun: 1 }, 'Башенки, флажки и ров (ров воображаемый, но драконы настоящие).', { tint: '#e59bb4' }],
  ['bunk_bed_basic',  'bunk_bed', 'Двухъярусная кровать «Этажерка»',         450, { comfort: 5, energy: 7 }, 'Кто спит наверху — решает камень-ножницы-бумага. Каждый вечер.', { tint: '#a2784a' }],
  ['bunk_bed_pirate', 'bunk_bed', 'Двухъярусная кровать «Пиратский кубрик»', 800, { comfort: 6, energy: 8, fun: 1 }, 'Верхняя койка — капитанская. Нижняя — для юнги и плюшевого попугая.', { tint: '#6b4a2f' }],
]);
block({ ...F, cat: 'misc', room: 'bedroom', tags: ['kids', 'baby'] }, [
  ['crib_lux', 'crib', 'Колыбель «Агу-Премиум»', 700, { room: 1 }, 'Качается плавно, играет колыбельную и гордится этим больше, чем нужно.', { tint: '#f4f2ec' }],
]);

// — Поверхности —
block({ ...F, cat: 'surfaces', room: 'kitchen', fp: [2, 1], tags: ['table'] }, [
  ['table_folding', 'dining_table', 'Стол складной «Пикник»',        60,   {}, 'Выдерживает салат, торт и восемь локтей. Девятый — уже риск.', { tags: ['dacha', 'student'], tint: '#d7c08f' }],
  ['table_small',   'dining_table', 'Стол «Хрущёвка»',               120,  {}, 'Компактный. Помещается туда, куда не помещается ничего.', { fp: [1, 1], tags: ['retro'], tint: '#c8b27a' }],
  ['desk_basic',    'dining_table', 'Письменный стол «Отличник»',    150,  {}, 'На нём уроки делаются сами. Ну, почти.', { room: 'study', tags: ['office', 'kids'], tint: '#a2784a' }],
  ['table_granny',  'dining_table', 'Стол «Бабушкин с клеёнкой»',    180,  {}, 'Клеёнка в цветочек защищает от пятен и хорошего вкуса.', { tags: ['granny'], tint: '#8a6440' }],
  ['table_scandi',  'dining_table', 'Стол «Фьорд-Обед»',             350,  { room: 1 }, 'Светлый массив и ножки-ёлочки. К столу прилагается чувство покоя.', { tags: ['scandi'], tint: '#e2cfa6' }],
  ['table_glass',   'dining_table', 'Стол «Стеклянный Минимал»',     700,  { room: 2 }, 'Видно, что под столом. Все ваши тапочки теперь — часть интерьера.', { tags: ['hitech'], tint: '#bcd6dc' }],
  ['desk_exec',     'dining_table', 'Стол «Кабинет министра»',       900,  { room: 2 }, 'За таким столом не работают — за таким столом принимают решения.', { room: 'study', tags: ['office', 'lux'], tint: '#4a2c20' }],
  ['table_banquet', 'dining_table', 'Стол «Банкетный Граф»',         1200, { room: 3 }, 'Двенадцать персон, три перемены блюд и одна тётя, которая всё прокомментирует.', { fp: [3, 1], tags: ['lux', 'classic'], tint: '#5b3a24' }],
]);
block({ ...F, cat: 'surfaces', room: 'living', tags: ['table'] }, [
  ['coffee_table_crate',  'coffee_table', 'Столик из ящиков «Грузчик»',    40,  {}, 'Два овощных ящика и немного лака. Модно, дёшево, занозисто.', { fp: [2, 1], tags: ['student', 'dacha'], tint: '#c8a870' }],
  ['end_table',           'coffee_table', 'Приставной столик «Сбоку-припёку»', 55, {}, 'Для лампы, чашки и пульта, который всё равно потеряется.', { tint: '#a2784a' }],
  ['nightstand',          'coffee_table', 'Тумбочка «Ночной дозор»',       70,  {}, 'Хранит будильник, стакан воды и тайны, которые шепчут перед сном.', { room: 'bedroom', tint: '#8a6440' }],
  ['coffee_table_scandi', 'coffee_table', 'Столик «Кофе-Фьорд»',           160, { room: 1 }, 'Круглый, светлый, с полочкой для журналов про другие столики.', { fp: [2, 1], tags: ['scandi'], tint: '#e2cfa6' }],
  ['coffee_table_marble', 'coffee_table', 'Столик «Мрамор-Люкс»',          600, { room: 2 }, 'Холодный камень, тёплые чувства. Подставки под чашки обязательны!', { fp: [2, 1], tags: ['lux'], tint: '#e8e4dc' }],
]);
block({ ...F, cat: 'surfaces', room: 'kitchen', tags: ['counter'] }, [
  ['counter_plastic', 'counter', 'Стойка «Пластик-Фантастик»',   90,  {}, 'Отделка «под мрамор», если смотреть издалека и без очков.', { tags: ['student'], tint: '#e8e2d0' }],
  ['counter_rustic',  'counter', 'Стойка «Деревенская»',         200, {}, 'Дубовая столешница, на которой нарезано больше огурцов, чем вы съедите за жизнь.', { tags: ['dacha', 'granny'], tint: '#8a6440' }],
  ['counter_bar',     'counter', 'Барная стойка «Последний тост»', 350, { room: 1 }, 'Облокачиваться полагается с видом завсегдатая.', { tags: ['retro'], tint: '#4a2c20' }],
  ['counter_granite', 'counter', 'Стойка «Гранитный шеф»',       400, { room: 1 }, 'Гранит не боится ножа, горячего и шеф-повара в плохом настроении.', { tags: ['lux', 'modern'], tint: '#5a5d63' }],
  ['counter_island',  'counter', 'Кухонный остров «Робинзон»',   700, { room: 2 }, 'Необитаемый остров посреди кухни. Вокруг него ходят кругами за солонкой.', { fp: [2, 1], tags: ['lux', 'modern'], tint: '#f2f0ea' }],
]);

// — Кухонная техника —
block({ place: 'floor', bill: true, depr: 'appliances', cat: 'appliances', room: 'kitchen', tags: ['kitchen'] }, [
  ['fridge_mini',   'fridge', 'Холодильник «Пингвин-Мини»',     350,  { hunger: 5 }, 'Влезает кефир, сосиски и одна амбиция.', { tags: ['student'], tint: '#e6e6e0' }],
  ['fridge_polar',  'fridge', 'Холодильник «Северный полюс»',   1200, { hunger: 8 }, 'Внутри так холодно, что продукты сохраняют свежесть и чувство юмора.', { tags: ['modern'], tint: '#c9ccd1' }],
  ['fridge_siberia','fridge', 'Холодильник «Сибирь-Премиум»',   2500, { hunger: 9, room: 1 }, 'Двухдверный, с ледогенератором и собственным климатом. Почти страна.', { tags: ['lux', 'hitech'], tint: '#9aa0a8' }],
  ['stove_camp',    'stove',  'Плита «Походная»',               250,  { hunger: 5 }, 'Две конфорки и много оптимизма.', { tags: ['student', 'dacha'], tint: '#e8e2d0' }],
  ['stove_chef',    'stove',  'Плита «Шеф-Повар Газ»',          1000, { hunger: 7 }, 'Шесть конфорок. Пять из них вы никогда не включите, но как звучит!', { tags: ['modern'], tint: '#b9bec4' }],
  ['stove_michelin','stove',  'Плита «Мишлен-на-дому»',         2100, { hunger: 9, room: 1 }, 'Готовит так, что соседи приходят «просто мимо проходили».', { tags: ['lux'], tint: '#2b2b2e' }],
  ['dishwasher_basic','dishwasher', 'Посудомойка «Чистюля»',    550,  {}, 'Моет тарелки, пока вы делаете вид, что заняты.', { tint: '#e6e6e0' }],
  ['dishwasher_quiet','dishwasher', 'Посудомойка «Тихий омут»', 950,  { room: 1 }, 'Работает так тихо, что её проверяют, не сломалась ли.', { tags: ['lux'], tint: '#b9bec4' }],
  ['kitchen_sink_steel', 'kitchen_sink', 'Мойка «Нержавейка»',  150,  { hygiene: 1 }, 'Звонкая, блестящая, неубиваемая. Как гимн коммунальной кухне.', { cat: 'plumbing', tags: ['student'], tint: '#b9bec4' }],
  ['kitchen_sink_farm',  'kitchen_sink', 'Мойка «Фермерская»',  650,  { hygiene: 3, room: 1 }, 'Глубокая керамическая чаша — хоть поросёнка мой.', { cat: 'plumbing', tags: ['dacha', 'lux'], tint: '#f4f2ec' }],
  ['trash_pedal',   'trash_can', 'Ведро «Педальное»',           45,   {}, 'Нажал ногой — открылось. Магия прогресса.', { depr: 'furniture', cat: 'misc', tags: ['retro'], tint: '#c8322e' }],
  ['trash_compactor','trash_can','Мусоропресс «Уплотнитель»',   375,  {}, 'Спрессует неделю мусора в аккуратный кубик. Хоть на выставку.', { cat: 'misc', tags: ['hitech'], tint: '#9aa0a8' }],
]);
block({ place: 'surface', bill: true, depr: 'appliances', cat: 'appliances', room: 'kitchen', tags: ['kitchen', 'small'] }, [
  ['microwave_basic', 'microwave', 'Микроволновка «Разогрев»',      250, { hunger: 3 }, 'Дзынь — и ужин готов. Не кладите внутрь вилки, фольгу и котов.', { tint: '#e6e6e0' }],
  ['microwave_pro',   'microwave', 'Микроволновка «Импульс-9000»',  500, { hunger: 4 }, 'Сорок программ, гриль и конвекция. Вы всё равно будете жать «30 секунд».', { tags: ['hitech'], tint: '#2b2b2e' }],
  ['coffee_basic',    'coffee_maker', 'Кофеварка «Бодрячок»',        85,  { energy: 1 }, 'Капельная классика: булькает, шипит, спасает утро.', { tags: ['student'], tint: '#2b2b2e' }],
  ['coffee_espresso', 'coffee_maker', 'Эспрессо-машина «Мокко-Мастер»', 450, { energy: 2, fun: 1 }, 'Пенка на капучино выходит в форме сердечка. Иногда в форме Австралии.', { tags: ['modern'], tint: '#b9bec4' }],
  ['coffee_lux',      'coffee_maker', 'Кофемашина «Барристократ»',   1100, { energy: 3, fun: 2 }, 'Мелет, варит, взбивает и смотрит на вас свысока.', { tags: ['lux', 'hitech'], tint: '#3a3d42' }],
]);

// — Сантехника —
block({ place: 'floor', bill: true, depr: 'appliances', cat: 'plumbing', room: 'bathroom', tags: ['bath'] }, [
  ['toilet_dacha',   'toilet',  'Унитаз «Дачный»',            200,  { bladder: 7 }, 'Работает. Иногда со второго раза. Иногда с песней.', { tags: ['dacha', 'student'], tint: '#e8e4d8' }],
  ['toilet_quiet',   'toilet',  'Унитаз «Тихий смыв»',        600,  { bladder: 8, comfort: 2 }, 'Смыв тише шёпота. Больше никто не узнает, где вы были.', { tags: ['modern'], tint: '#f4f2ec' }],
  ['toilet_throne',  'toilet',  'Унитаз «Трон-Регент»',       1200, { bladder: 8, comfort: 4 }, 'Подогрев сиденья, мягкое закрытие и ощущение монаршей власти.', { tags: ['lux', 'hitech'], tint: '#f4f2ec' }],
  ['shower_hose',    'shower',  'Душ «Лейка»',                400,  { hygiene: 5 }, 'Напор как у лейки, зато на воде сэкономите. Наверное.', { tags: ['student', 'dacha'], tint: '#b9bec4' }],
  ['shower_massage', 'shower',  'Душ «Гидромассаж»',          950,  { hygiene: 7 }, 'Двенадцать форсунок бьют со всех сторон. Утро больше не подкрадывается незаметно.', { tags: ['modern'], tint: '#bcd6dc' }],
  ['shower_tropic',  'shower',  'Душ «Тропический ливень»',   1500, { hygiene: 8, room: 1 }, 'Потоп из потолка. Лягушки не прилагаются, но воображение дорисует.', { tags: ['lux', 'hitech'], tint: '#9aa0a8' }],
  ['bathtub_iron',   'bathtub', 'Ванна «Чугунка»',            500,  { hygiene: 6, comfort: 3 }, 'Чугун на века. Нагревается до тепла примерно к четвергу.', { tags: ['student', 'granny'], tint: '#f2f0ea' }],
  ['bathtub_claw',   'bathtub', 'Ванна на лапах «Бабушкина»', 1400, { hygiene: 8, comfort: 5, room: 1 }, 'Стоит на львиных лапах и смотрит на вас с аристократическим снисхождением.', { tags: ['granny', 'classic'], tint: '#f4f2ec' }],
  ['bathtub_nirvana','bathtub', 'Ванна-джакузи «Нирвана»',    3200, { hygiene: 9, comfort: 7, room: 2 }, 'Пузырьки, подсветка и полное просветление. Выход — только когда пальцы станут как изюм.', { tags: ['lux', 'hitech'], tint: '#e8f0f2' }],
  ['bath_sink_communal','bath_sink','Раковина «Коммуналка»',  120,  { hygiene: 1 }, 'Кран с характером: то кипяток, то лёд, то ничего.', { tags: ['student'], tint: '#e8e4d8' }],
  ['bath_sink_tulip','bath_sink', 'Раковина «Тюльпан»',        300,  { hygiene: 2, room: 1 }, 'Изящная ножка, как у настоящего тюльпана. Поливать не нужно.', { tags: ['granny', 'classic'], tint: '#f4f2ec' }],
  ['bath_sink_marble','bath_sink','Раковина «Мраморная чаша»', 900,  { hygiene: 3, room: 2 }, 'Каждое умывание — как в пятизвёздочном отеле, только без шоколадки на подушке.', { tags: ['lux'], tint: '#e8e4dc' }],
]);
block({ place: 'floor', bill: true, depr: 'appliances', cat: 'plumbing', room: 'outside', fp: [2, 2], tags: ['bath', 'outdoor'] }, [
  ['hot_tub_basic', 'hot_tub', 'Горячая купель «Бурлилка»', 3000, { comfort: 5, fun: 4, social: 2 }, 'Горячая вода, пузыри и разговоры, о которых утром лучше не вспоминать.', { tint: '#3fb0a9' }],
  ['hot_tub_lux',   'hot_tub', 'Джакузи «Гейзер-Люкс»',     6200, { comfort: 7, fun: 5, social: 3, room: 1 }, 'Восемь мест, подсветка и массаж. Гости уходить не будут — предупреждаем честно.', { tags: ['lux'], tint: '#2f8f8f' }],
]);

// — Электроника —
block({ place: 'floor', bill: true, depr: 'electronics', cat: 'electronics', room: 'living', tags: ['tech'] }, [
  ['tv_ripple',  'tv', 'Телевизор «Рябь»',                85,   { fun: 2 }, 'Два канала и рябь на третьем. Антенну крутить по часовой стрелке и с молитвой.', { tags: ['student', 'retro'], tint: '#6b4a2f' }],
  ['tv_kinescope','tv','Телевизор «Кинескоп-Плюс»',       250,  { fun: 3 }, 'Цветной! Иногда даже в тех цветах, что задумывал режиссёр.', { tags: ['retro'], tint: '#3a3d42' }],
  ['tv_plasma',  'tv', 'Плазма «Тонкая Грань»',           1500, { fun: 6, room: 1 }, 'Такая тонкая, что сбоку её не видно. Спереди — очень даже.', { tags: ['modern'], tint: '#1f1f22' }],
  ['tv_cinema',  'tv', 'Телевизор «Домашний кинотеатр»',  3500, { fun: 8, room: 1 }, 'Экран размером с окно, звук — с соседскую дрель.', { fp: [2, 1], tags: ['hitech'], tint: '#1f1f22' }],
  ['tv_projector','tv','Проектор «Соседи Завидуют»',      6500, { fun: 9, room: 2 }, 'Кино на всю стену. Соседи видят через окно и завидуют — отсюда и название.', { fp: [2, 1], tags: ['lux', 'hitech'], tint: '#2b2b2e' }],
  ['radio_mayak',   'stereo', 'Радиоприёмник «Маяк»',         60,   { fun: 1 }, 'Новости, прогноз погоды и песни, которые знает вся страна.', { place: 'surface', tags: ['granny', 'retro'], tint: '#8a6440' }],
  ['stereo_boombox','stereo', 'Магнитофон «Кассетник»',       100,  { fun: 2 }, 'Перематывать кассету карандашом — это спорт и немного медитация.', { tags: ['student', 'retro'], tint: '#2b2b2e' }],
  ['stereo_bass',   'stereo', 'Музыкальный центр «Басовитый»', 900,  { fun: 4 }, 'Басы проходят через две стены и одного соседа.', { tags: ['modern'], tint: '#3a3d42' }],
  ['jukebox',       'stereo', 'Музыкальный автомат «Твист-Бокс»', 1800, { fun: 5 }, 'Неоновые трубки, пластинки и ноль желания стоять на месте.', { tags: ['retro'], tint: '#c8322e' }],
  ['stereo_audiophile','stereo','Hi-Fi «Аудиофил-Максимум»',  2550, { fun: 5, room: 1 }, 'Слышно, как дирижёр вздыхает в третьей части. И как вы жуёте чипсы.', { tags: ['lux', 'hitech'], tint: '#1f1f22' }],
]);
block({ place: 'floor', bill: true, depr: 'electronics', cat: 'electronics', room: 'study', fp: [2, 1], tags: ['tech', 'computer'] }, [
  ['computer_basic', 'computer_desk', 'Компьютер «Бейсик-86»',        800,  { fun: 3 }, 'Зелёные буквы на чёрном экране. Зато игры грузятся всего полчаса.', { tags: ['retro', 'student'], tint: '#d8d0b8' }],
  ['computer_pent',  'computer_desk', 'Компьютер «Пентагон-2»',        1800, { fun: 6 }, 'Быстрый, как слухи в подъезде. Уже с модемом, пищащим «по-дельфиньи».', { tags: ['modern'], tint: '#c9ccd1' }],
  ['computer_gamer', 'computer_desk', 'ПК «Геймер-Ночник»',            2600, { fun: 7 }, 'Светится всеми цветами радуги. Играет во всё, кроме «пора спать».', { tags: ['hitech'], tint: '#2b2b2e' }],
  ['computer_quantum','computer_desk','Компьютер «Квантовый скачок»',  3500, { fun: 8, room: 1 }, 'Одновременно включён и выключен. Счёт за свет приходит только один.', { tags: ['lux', 'hitech'], tint: '#f4f2ec' }],
]);
block({ place: 'floor', bill: true, depr: 'electronics', cat: 'electronics', room: 'living', tags: ['tech', 'games'] }, [
  ['console_8bit',  'video_game', 'Приставка «Джойстик-8бит»',     200,  { fun: 4 }, 'Картридж надо продуть. Все знают. Никто не знает зачем.', { place: 'surface', tags: ['retro', 'kids'], tint: '#c9c3b6' }],
  ['console_turbo', 'video_game', 'Приставка «Турбо-Ё»',           500,  { fun: 6 }, 'Графика настолько реалистичная, что пиксели уже почти круглые.', { place: 'surface', tags: ['modern', 'kids'], tint: '#2b2b2e' }],
  ['console_vr',    'video_game', 'Приставка «Виртуалия VR»',       1200, { fun: 8 }, 'Надел шлем — и ты в другом мире. Главное, не врезаться в шкаф в этом.', { tags: ['hitech'], tint: '#f4f2ec' }],
  ['pinball_runner','pinball',    'Пинбол «Шарик-Бегунок»',         1000, { fun: 5 }, 'Звенит, мигает и съедает монеты. Как маленький казино-робот.', { fp: [1, 2], tags: ['retro'], tint: '#3f6fb5' }],
  ['pinball_space', 'pinball',    'Пинбол «Космический рейнджер»',  1800, { fun: 7 }, 'Мультибол, пришельцы и фраза «Экстра-шар!» голосом героя.', { fp: [1, 2], tags: ['retro', 'lux'], tint: '#7d58a8' }],
]);
block({ place: 'surface', bill: true, depr: 'electronics', cat: 'electronics', room: 'any', tags: ['tech', 'phone'] }, [
  ['phone_rotary', 'phone', 'Телефон «Бабушкин дисковый»', 45,  {}, 'Набирать номер с девяткой — это минута медитации.', { tags: ['granny', 'retro'], tint: '#2b2b2e' }],
  ['phone_wall',   'phone', 'Телефон настенный «Алло-Стена»', 75, {}, 'Висит на стене, провод тянется до холодильника. Удобно!', { place: 'wall', tags: ['retro'], tint: '#e8e2d0' }],
  ['phone_gold',   'phone', 'Телефон «Золотая трубка»',   450, { room: 1 }, 'Звонить с него надо только с хорошими новостями.', { tags: ['lux'], tint: '#c8a24a' }],
]);
block({ place: 'wall', bill: true, depr: 'electronics', cat: 'electronics', room: 'any', tags: ['safety'] }, [
  ['smoke_alarm_pro',   'smoke_alarm',   'Датчик дыма «Нюхач-Про»',  120, {}, 'Отличает пожар от подгоревших тостов. В теории.', { tint: '#f4f2ec' }],
  ['burglar_alarm_pro', 'burglar_alarm', 'Сигнализация «Цербер»',    600, {}, 'Три головы, ноль шансов для грабителя. Лает сиреной.', { tint: '#c8322e' }],
]);

// — Свет —
block({ ...F, cat: 'lighting', room: 'any', tags: ['light'] }, [
  ['lamp_floor_stick', 'floor_lamp', 'Торшер «Палка»',            40,  {}, 'Палка, лампочка, провод. Минимализм, до которого не додумались даже шведы.', { tags: ['student'], tint: '#e8e2d0' }],
  ['lamp_lava',        'floor_lamp', 'Лава-лампа «Грувик»',       180, { room: 1, fun: 1 }, 'Пузыри поднимаются, опускаются и гипнотизируют всех старше 30.', { fp: [1, 1], tags: ['retro', 'student'], tint: '#e0803a' }],
  ['lamp_floor_arc',   'floor_lamp', 'Торшер «Дуга»',             350, { room: 2 }, 'Изгибается над диваном, как любопытный журавль.', { tags: ['modern', 'scandi'], tint: '#b9bec4' }],
  ['lamp_floor_stained','floor_lamp','Торшер «Витраж»',           650, { room: 3 }, 'Цветное стекло рисует на стенах радугу. Бесплатный вечерний аттракцион.', { tags: ['lux', 'classic', 'granny'], tint: '#9e6b2b' }],
]);
block({ place: 'surface', bill: true, depr: 'furniture', cat: 'lighting', room: 'any', tags: ['light'] }, [
  ['desk_lamp_student', 'desk_lamp', 'Настольная лампа «Студентка»',  35,  { room: 1 }, 'Гнётся во все стороны и светит прямо в конспект. Или в глаза.', { tags: ['student', 'office'], tint: '#c8322e' }],
  ['desk_lamp_banker',  'desk_lamp', 'Лампа «Банкирская»',            150, { room: 2 }, 'Зелёный абажур. Любой, кто сидит под ней, выглядит как бухгалтер крупного банка.', { tags: ['classic', 'office'], tint: '#3f6b45' }],
  ['desk_lamp_crystal', 'desk_lamp', 'Лампа «Хрустальная слеза»',     400, { room: 3 }, 'Подвески звенят от сквозняка — как маленький оркестр под потолком. Под абажуром.', { tags: ['lux', 'granny'], tint: '#e8f0f2' }],
]);
block({ place: 'floor', walkable: true, mount: 'ceiling', bill: true, depr: 'furniture', cat: 'lighting', room: 'any', tags: ['light', 'ceiling'] }, [
  ['ceiling_bulb',       'ceiling_lamp', 'Лампочка «Ильича»',            25,   { room: 1 }, 'Голая лампочка на проводе. Суровая правда жизни, 60 ватт.', { tags: ['student', 'dacha'], tint: '#f0d64a' }],
  ['ceiling_fan',        'ceiling_lamp', 'Вентилятор-люстра «Пропеллер»', 180, { room: 1, comfort: 1 }, 'Светит и дует. Бумаги со стола улетают сами — очень удобно.', { tags: ['retro'], tint: '#a2784a' }],
  ['ceiling_sputnik',    'ceiling_lamp', 'Люстра «Спутник»',              250, { room: 2 }, 'Лучи во все стороны. Бип-бип.', { tags: ['retro', 'hitech'], tint: '#c8a24a' }],
  ['ceiling_chandelier', 'ceiling_lamp', 'Люстра «Большой театр»',        1500, { room: 4 }, 'Триста хрустальных подвесок. Протирать — отдельная профессия.', { tags: ['lux', 'classic'], tint: '#f0e6c8' }],
]);
block({ place: 'wall', bill: true, depr: 'furniture', cat: 'lighting', room: 'any', tags: ['light', 'wall'] }, [
  ['sconce_nightlight', 'ceiling_lamp', 'Бра «Ночник»',      60,  { room: 1 }, 'Уютный свет над кроватью — чтобы читать, а не искать тапок.', { tags: ['scandi', 'granny'], tint: '#efe4c8' }],
  ['sconce_candelabra', 'ceiling_lamp', 'Бра «Канделябр»',   450, { room: 3 }, 'Свечи электрические, пафос настоящий.', { tags: ['lux', 'classic'], tint: '#c8a24a' }],
]);
block({ place: 'floor', bill: true, depr: 'furniture', cat: 'lighting', room: 'outside', tags: ['light', 'outdoor'] }, [
  ['streetlight_garden', 'streetlight', 'Фонарь садовый «Светлячок»', 120, { room: 1 }, 'Освещает дорожку к дому и мотыльковую дискотеку.', { tags: ['dacha'], tint: '#2b2b2e' }],
]);

// — Декор: картины и зеркала —
block({ place: 'wall', bill: false, depr: 'art', cat: 'decor', room: 'any', tags: ['art'] }, [
  ['painting_kids',     'painting', 'Детский рисунок «Мама и солнце»',     20,    { room: 1 }, 'У мамы четыре руки, у солнца — очки. Бесценно, но продаётся за двадцать.', { tags: ['kids'], tint: '#f0d64a' }],
  ['poster_cat',        'painting', 'Постер «Котик держится»',            45,    { room: 1 }, 'Котик висит на ветке и мотивирует. Вы тоже держитесь.', { tags: ['student'], tint: '#7fb3e0' }],
  ['photo_family',      'painting', 'Фото в рамке «Все улыбаются»',        60,    { room: 1 }, 'Снято с двадцатой попытки. Дядя всё равно моргнул.', { tags: ['granny'], tint: '#a2784a' }],
  ['painting_deer',     'painting', 'Картина «Закат с оленем»',            150,   { room: 2 }, 'Олень, закат, озеро. Классика жанра «над диваном».', { tags: ['granny', 'dacha'], tint: '#e0803a' }],
  ['carpet_wall',       'painting', 'Ковёр на стену «Советский узор»',     300,   { room: 3 }, 'Греет стену, глушит соседей и развивает воображение: в узорах видны драконы.', { tags: ['granny', 'retro'], tint: '#9e2b33' }],
  ['painting_square',   'painting', 'Картина «Квадрат, но не чёрный»',     900,   { room: 4 }, 'Художник долго думал. Теперь думаете вы.', { tags: ['modern', 'hitech'], tint: '#c8322e' }],
  ['painting_portrait', 'painting', 'Портрет «Неизвестный с бакенбардами»',1600,  { room: 5 }, 'Кто он — не знает никто. Но взгляд следит за вами из любой точки комнаты.', { tags: ['classic'], tint: '#4a2c20' }],
  ['painting_sea',      'painting', 'Картина «Девятый вал… почти»',        2400,  { room: 6 }, 'Восьмой с половиной вал. На девятый не хватило краски.', { tags: ['classic', 'lux'], tint: '#26395f' }],
  ['painting_bears',    'painting', 'Картина «Утро в хвойном лесу»',       5000,  { room: 8 }, 'Медвежата, сосны, туман. Сюжет знаком каждому, кто открывал коробку конфет.', { tags: ['classic', 'lux'], tint: '#3f6b45' }],
  ['painting_mona',     'painting', 'Шедевр «Мона Лиза Петровна»',         9000,  { room: 9 }, 'Улыбается загадочно. Говорят, знает, где вы спрятали заначку.', { tags: ['lux', 'classic'], tint: '#6b5a2f' }],
  ['mirror_full',       'mirror',   'Зеркало «Красавчик»',                 350,   { room: 2 }, 'В полный рост. Утром — жестоко, вечером — вполне.', { skills: ['charisma'], tint: '#b9bec4' }],
  ['mirror_magic',      'mirror',   'Зеркало «Свет мой, зеркальце»',       900,   { room: 3 }, 'Золотая рама и честные ответы. Про «всех милее» лучше не спрашивать.', { skills: ['charisma'], tags: ['lux', 'classic'], tint: '#c8a24a' }],
]);
block({ place: 'wall', bill: false, depr: 'art', cat: 'decor', room: 'any', tags: ['clock'] }, [
  ['clock_wall',   'clock', 'Часы настенные «Тик-Так»',        40,  { room: 1 }, 'Идут всегда. Иногда вперёд, иногда в прошлое.', { tags: ['student'], tint: '#f4f2ec' }],
  ['clock_cuckoo', 'clock', 'Часы с кукушкой «Ку-ку, хозяин»', 180, { room: 2 }, 'Кукушка отвечает на любой вопрос. Правильно — только на «сколько времени?»', { tags: ['granny', 'dacha'], tint: '#6b4a2f' }],
]);
block({ place: 'floor', bill: false, depr: 'art', cat: 'decor', room: 'any', tags: ['clock'] }, [
  ['clock_grandfather', 'clock', 'Часы напольные «Дедушкины»', 1200, { room: 4 }, 'Бьют каждый час так, что просыпается даже прадедушка на портрете.', { tags: ['classic', 'granny', 'lux'], tint: '#4a2c20' }],
]);

// — Декор: скульптуры, растения, вазы, ковры, аквариумы, камины —
block({ place: 'floor', bill: false, depr: 'art', cat: 'decor', room: 'any', tags: ['art', 'sculpture'] }, [
  ['flamingo',          'sculpture', 'Фламинго пластиковый «Розовая мечта»', 30,   { room: 1 }, 'Стоит на одной ноге круглый год. Ни разу не пожаловался.', { room: 'outside', tags: ['dacha', 'outdoor', 'retro'], tint: '#e59bb4' }],
  ['garden_gnome',      'sculpture', 'Садовый гном «Геннадий»',             80,   { room: 1 }, 'По ночам переставляет себя на полметра. Доказать это пока никто не смог.', { room: 'outside', tags: ['dacha', 'outdoor'], tint: '#c8322e' }],
  ['sculpture_bust',    'sculpture', 'Бюст «Великий кто-то»',               600,  { room: 3 }, 'Табличку потеряли, но выражение лица говорит само за себя: великий.', { tags: ['classic'], tint: '#e8e4dc' }],
  ['sculpture_bagel',   'sculpture', 'Скульптура «Мысль о бублике»',        1500, { room: 5 }, 'Современное искусство: дырка — главное.', { tags: ['modern', 'hitech'], tint: '#c8a24a' }],
  ['sculpture_david',   'sculpture', 'Статуя «Давид из Подольска»',          4000, { room: 7 }, 'Мраморный, одухотворённый и слегка замёрзший.', { tags: ['lux', 'classic'], tint: '#f0ece2' }],
]);
block({ ...F, cat: 'decor', room: 'any', tags: ['plant'] }, [
  ['plant_cactus',   'plant', 'Кактус «Колючка»',         25,   { room: 1 }, 'Идеальный питомец: поливать раз в месяц, гладить не рекомендуется.', { tags: ['student'], tint: '#4e8a4e' }],
  ['plant_geranium', 'plant', 'Герань «Подоконница»',     40,   { room: 1 }, 'Пахнет бабушкиной квартирой и отгоняет моль и грусть.', { tags: ['granny', 'dacha'], tint: '#d0455a' }],
  ['plant_palm',     'plant', 'Пальма «Отпуск»',          200,  { room: 3 }, 'Поставьте рядом шезлонг — и можно не ехать на море.', { tags: ['modern'], tint: '#4e8a4e' }],
  ['plant_monstera', 'plant', 'Монстера «Прожорливая»',   350,  { room: 3 }, 'Растёт на глазах. Через год понадобится вторая квартира.', { tags: ['scandi', 'modern'], tint: '#2f6b3a' }],
  ['plant_bonsai',   'plant', 'Бонсай «Старец»',          800,  { room: 4 }, 'Ему триста лет, и он смотрит на вашу суету с лёгкой жалостью.', { place: 'surface', tags: ['lux', 'hitech'], tint: '#3f6b45' }],
  ['plant_lemon',    'plant', 'Лимонное дерево «Кисляк»', 1200, { room: 5 }, 'Один лимон в год. Зато свой, домашний, выстраданный.', { tags: ['lux', 'dacha'], tint: '#f0d64a' }],
]);
block({ place: 'surface', bill: false, depr: 'art', cat: 'decor', room: 'any', tags: ['vase'] }, [
  ['vase_dacha',   'flower_vase', 'Ваза «Цветы с дачи»',   50,   { room: 1 }, 'Банка из-под огурцов — тоже ваза, если в ней ромашки.', { tags: ['dacha', 'granny'], tint: '#e8e2d0' }],
  ['vase_crystal', 'flower_vase', 'Ваза «Хрусталь-Сервант»', 250, { room: 2 }, 'Вынимается из серванта раз в год. По большим праздникам.', { tags: ['granny', 'classic'], tint: '#e8f0f2' }],
]);
block({ place: 'floor', bill: false, depr: 'art', cat: 'decor', room: 'any', tags: ['vase'] }, [
  ['vase_ming', 'flower_vase', 'Ваза «Династия Минь-Минь»', 2000, { room: 5 }, 'Ей тысяча лет. Или десять — продавец путался в показаниях.', { tags: ['lux', 'classic'], tint: '#3f6fb5' }],
]);
block({ ...F, cat: 'decor', room: 'any', walkable: true, tags: ['rug'] }, [
  ['rug_knit',    'rug', 'Половик «Бабушкин вязаный»',     50,  { room: 1 }, 'Связан из всех старых свитеров семьи. Узнаёте рукав?', { fp: [1, 2], tags: ['granny', 'dacha'], tint: '#b8603e' }],
  ['rug_round',   'rug', 'Ковёр круглый «Солнышко»',       200, { room: 2 }, 'Круглый, тёплый и жёлтый. Кот считает, что это его личное солнце.', { fp: [2, 2], tags: ['kids', 'scandi'], tint: '#f0c64a' }],
  ['rug_bear',    'rug', 'Шкура «Медведь-не-настоящий»',   450, { room: 3 }, 'Ни один медведь не пострадал. Один плюшевый — немного.', { fp: [2, 2], tags: ['classic', 'dacha'], tint: '#6b4a2f' }],
  ['rug_persian', 'rug', 'Ковёр «Персидский сон»',          800, { room: 4 }, 'Ручная работа, сорок узелков на сантиметр. Летает только по праздникам.', { fp: [2, 2], tags: ['lux', 'classic'], tint: '#8a2b33' }],
]);
block({ ...F, cat: 'decor', room: 'living', depr: 'appliances', tags: ['aquarium'] }, [
  ['aquarium_guppy', 'aquarium', 'Аквариум «Гуппи-сити»',   250,  { fun: 1, room: 1 }, 'Пять гуппи и замок. Кто там король — рыбы решают сами.', { tags: ['kids', 'student'], tint: '#7fb3e0' }],
  ['aquarium_reef',  'aquarium', 'Аквариум «Подводный мир»', 900,  { fun: 2, room: 3 }, 'Кораллы, пузыри, рыба-клоун. Смотреть можно часами — и все смотрят.', { fp: [2, 1], tint: '#2f8f8f' }],
  ['aquarium_ocean', 'aquarium', 'Аквариум «Океанариум»',    2500, { fun: 3, room: 5 }, 'В нём живёт настоящий маленький скат. У него своё мнение о вашем интерьере.', { fp: [2, 1], tags: ['lux', 'hitech'], tint: '#26395f' }],
]);
block({ ...F, cat: 'decor', room: 'living', depr: 'furniture', fp: [2, 1], tags: ['fireplace'] }, [
  ['fireplace_stove', 'fireplace', 'Печь-буржуйка «Тёплый вечер»', 700,  { comfort: 1, room: 3 }, 'Греет, трещит и напоминает о даче. Дрова — ваши.', { fp: [1, 1], tags: ['dacha', 'granny'], tint: '#2b2b2e' }],
  ['fireplace_brick', 'fireplace', 'Камин «Кирпичный уют»',        1400, { comfort: 1, room: 5 }, 'Огонь, кресло, плед. Остальные удовольствия жизни ему завидуют.', { tags: ['classic', 'scandi'], tint: '#b5654a' }],
  ['fireplace_lux',   'fireplace', 'Камин «Графские развалины»',   3500, { comfort: 2, room: 7 }, 'Мраморный портал, кованая решётка. Держите подальше от ковров и занавесок!', { tags: ['lux', 'classic'], tint: '#e8e4dc' }],
]);

// — Хобби и навыки —
block({ ...F, cat: 'misc', room: 'study', tags: ['hobby', 'books'] }, [
  ['bookshelf_bricks', 'bookshelf', 'Полка «Кирпичи и доски»',  100,  { fun: 1 }, 'Архитектура студенческого общежития в лучших традициях.', { skills: ['cooking', 'mechanical'], tags: ['student'], tint: '#a2784a' }],
  ['bookshelf_scandi', 'bookshelf', 'Стеллаж «Книжный фьорд»',  350,  { fun: 1, room: 1 }, 'Книги стоят корешками по цвету. Читать их необязательно.', { skills: ['cooking', 'mechanical'], tags: ['scandi'], tint: '#e2cfa6' }],
  ['bookshelf_erudite','bookshelf', 'Шкаф «Эрудит»',            500,  { fun: 2 }, 'Энциклопедия в 30 томах. Том на букву «Ж» зачитан до дыр.', { skills: ['cooking', 'mechanical'], tags: ['classic'], tint: '#6b4a2f' }],
  ['bookshelf_prof',   'bookshelf', 'Библиотека «Профессорская»', 1100, { fun: 3, room: 2 }, 'Лесенка на колёсиках прилагается. Взбираться с пафосом — обязательно.', { fp: [2, 1], skills: ['cooking', 'mechanical'], tags: ['lux', 'classic'], tint: '#4a2c20' }],
]);
block({ ...F, cat: 'misc', room: 'living', tags: ['hobby', 'music'] }, [
  ['guitar_camp',     'guitar', 'Гитара «Костровая»',            250,  { fun: 3 }, 'Три аккорда, и вы душа любой компании. Пятый аккорд — для профессионалов.', { skills: ['creativity'], tags: ['dacha', 'student'], tint: '#b07a44' }],
  ['synth_disco',     'piano',  'Синтезатор «Дискотека-89»',     700,  { fun: 3 }, 'Сто тембров, автоаккомпанемент и кнопка «самба», которую нажимают чаще всего.', { skills: ['creativity'], tags: ['retro'], tint: '#2b2b2e' }],
  ['guitar_electric', 'guitar', 'Электрогитара «Громыхало»',     900,  { fun: 5, room: 1 }, 'Подключается к усилителю, соседи — к полиции.', { skills: ['creativity'], tags: ['hitech'], tint: '#c8322e' }],
  ['piano_upright',   'piano',  'Пианино «Лунная соната»',        1500, { fun: 4, room: 2 }, 'Расстроено ровно настолько, чтобы собачий вальс звучал как джаз.', { fp: [2, 1], skills: ['creativity'], tags: ['classic', 'granny'], tint: '#2b1e18' }],
  ['piano_grand',     'piano',  'Рояль «Концертный зал»',         4500, { fun: 6, room: 4 }, 'Крышка открывается, аплодисменты звучат в голове сами.', { fp: [2, 2], skills: ['creativity'], tags: ['lux', 'classic'], tint: '#1f1f22' }],
]);
block({ ...F, cat: 'misc', room: 'study', tags: ['hobby'] }, [
  ['easel_pro',       'easel',     'Мольберт «Мастерская»',         950,  { fun: 4, room: 1 }, 'Профессиональный мольберт. Шедевр по-прежнему зависит от вас.', { skills: ['creativity'], tags: ['classic'], tint: '#8a6440' }],
  ['telescope_basic', 'telescope', 'Телескоп «Звездочёт»',          550,  { fun: 4 }, 'Увидите кольца Сатурна, кратеры Луны и, случайно, соседский балкон.', { room: 'outside', skills: ['logic'], tags: ['outdoor'], tint: '#f4f2ec' }],
  ['telescope_pro',   'telescope', 'Телескоп «Галактика-XL»',       2100, { fun: 6, room: 1 }, 'Такой мощный, что иногда кажется, будто и оттуда кто-то смотрит.', { room: 'outside', skills: ['logic'], tags: ['outdoor', 'hitech', 'lux'], tint: '#26395f' }],
  ['chess_yard',      'chess',     'Шахматы «Дворовые»',            150,  { fun: 1 }, 'Не хватает двух пешек — их заменяют пробки от лимонада.', { skills: ['logic'], tags: ['student', 'dacha'], tint: '#a2784a' }],
  ['chess_gm',        'chess',     'Шахматы «Гроссмейстер»',        1500, { fun: 3, room: 2 }, 'Доска из палисандра, фигуры из кости. Проигрывать на ней не так обидно.', { skills: ['logic'], tags: ['lux', 'classic'], tint: '#4a2c20' }],
]);
block({ place: 'wall', bill: true, depr: 'furniture', cat: 'misc', room: 'any', tags: ['hobby', 'games'] }, [
  ['dartboard_basic', 'dartboard', 'Дартс «Яблочко»',    100, { fun: 3 }, 'Попасть в центр трудно, в обои — легко.', { tags: ['student'], tint: '#2b2b2e' }],
  ['dartboard_pub',   'dartboard', 'Дартс «Паб-Турнир»', 350, { fun: 4 }, 'Шкафчик с дротиками, доска для счёта мелом и дух английского паба.', { tags: ['retro'], tint: '#3f6b45' }],
]);
block({ ...F, cat: 'misc', room: 'living', fp: [2, 1], tags: ['hobby', 'games'] }, [
  ['pool_table_basic', 'pool_table', 'Бильярд «Шар в лузу»', 1800, { fun: 5 }, 'Зелёное сукно, скрипучий кий и вечный спор о правилах.', { skills: ['logic'], tint: '#3f6b45' }],
  ['pool_table_baron', 'pool_table', 'Бильярд «Барон»',       4000, { fun: 6, room: 2 }, 'Резные ножки, кожаные лузы. Проигравший варит кофе.', { skills: ['logic'], tags: ['lux', 'classic'], tint: '#7d2a45' }],
]);
block({ ...F, cat: 'misc', room: 'any', tags: ['sport'] }, [
  ['yoga_mat',       'exercise_bench', 'Коврик «Йога-Утро»',            80,   { fun: 1 }, 'Поза собаки мордой вниз гарантирована. Кот займёт коврик первым.', { walkable: false, skills: ['body'], tags: ['scandi'], tint: '#9fd8c0' }],
  ['dumbbells',      'exercise_bench', 'Гантели «Качалка во дворе»',     250,  { fun: 1 }, 'Чугун, упорство и хруст в спине. Результат — к лету (какому — не уточняем).', { skills: ['body'], tags: ['student'], tint: '#3a3d42' }],
  ['punching_bag',   'exercise_bench', 'Груша «Спарринг-партнёр»',       300,  { fun: 2 }, 'Выслушает всё, что вы думаете о начальнике. Молча.', { skills: ['body'], tint: '#c8322e' }],
  ['gym_home',       'exercise_bench', 'Тренажёр «Универсал-Атлет»',     1200, { fun: 3 }, 'Сорок упражнений в одной раме. Сорок первое — вешать на него одежду.', { fp: [2, 1], skills: ['body'], tags: ['hitech'], tint: '#2b2b2e' }],
  ['bike_exercise',  'treadmill', 'Велотренажёр «Тур де Балкон»',        600,  { fun: 1 }, 'Сто километров, не выходя из дома. Пейзаж за окном не меняется.', { skills: ['body'], tint: '#c8322e' }],
  ['treadmill_basic','treadmill', 'Беговая дорожка «Бег на месте»',      800,  { fun: 1 }, 'Бежите, бежите — а всё ещё в гостиной. Прямо как в жизни.', { fp: [1, 2], skills: ['body'], tint: '#3a3d42' }],
  ['treadmill_pro',  'treadmill', 'Дорожка «Марафонец»',                 1800, { fun: 2 }, 'Экран с горными трассами, пульсометр и мотивирующий голос, который никогда не устаёт.', { fp: [1, 2], skills: ['body'], tags: ['hitech'], tint: '#1f1f22' }],
]);

// — Детское —
block({ ...F, cat: 'misc', room: 'bedroom', tags: ['kids'] }, [
  ['toy_box_basic',    'toy_box',   'Ящик с игрушками «Хлам-Сундук»',  90,  { fun: 3 }, 'Всё, что было на полу, теперь внутри. Минут на пять.', { tint: '#e0803a' }],
  ['dollhouse_basic',  'dollhouse', 'Кукольный домик «Житьёнок»',      180, { fun: 4 }, 'Маленький дом, в котором маленькие жители тоже не моют посуду.', { skills: ['creativity'], tint: '#e59bb4' }],
  ['toy_box_treasure', 'toy_box',   'Сундук «Остров сокровищ»',        300, { fun: 4, room: 1 }, 'Пиратский сундук на колёсиках. Карта сокровищ нарисована внутри крышки.', { tint: '#8a6440' }],
  ['dollhouse_palace', 'dollhouse', 'Кукольный дворец «Мини-Версаль»', 600, { fun: 5, room: 1 }, 'Три этажа, бальный зал и лифт. Больше, чем ваша первая квартира.', { skills: ['creativity'], tags: ['lux'], tint: '#f4f2ec' }],
]);

// — Прочее: шкафы, комоды, стирка, почта —
block({ ...F, cat: 'misc', room: 'bedroom', tags: ['storage'] }, [
  ['dresser_plywood', 'dresser',  'Комод «Фанерка»',                     90,   {}, 'Ящики выдвигаются с третьей попытки, а задвигаются только с разбегу.', { tags: ['student'], tint: '#c8b27a' }],
  ['dresser_scandi',  'dresser',  'Комод «Фьорд-Ящик»',                  350,  { room: 1 }, 'Белый, с круглыми ручками. Хранит носки аккуратнее, чем вы.', { tags: ['scandi'], tint: '#f2f0ea' }],
  ['dresser_louis',   'dresser',  'Комод «Людовик Тринадцать с половиной»', 1100, { room: 3 }, 'Гнутые ножки, позолота, секретный ящичек. Секрет — носки.', { tags: ['lux', 'classic'], tint: '#e8dcc0' }],
  ['wardrobe_basic',  'wardrobe', 'Шкаф «Нарния-Эконом»',                300,  {}, 'Внутри — только одежда. Мы проверяли. Дважды.', { fp: [2, 1], tags: ['student'], tint: '#a2784a' }],
  ['wardrobe_granny', 'wardrobe', 'Шифоньер «Бабушкин»',                 450,  { room: 1 }, 'Пахнет нафталином и историей. Антресоль хранит то, что не пригодится никогда.', { fp: [2, 1], tags: ['granny', 'retro'], tint: '#6b4a2f' }],
  ['wardrobe_lux',    'wardrobe', 'Гардероб «Модный приговор»',          1200, { room: 2 }, 'Зеркальные двери и подсветка. Сто вешалок, а надеть всё равно нечего.', { fp: [2, 1], tags: ['lux', 'modern'], tint: '#f4f2ec' }],
]);
block({ place: 'floor', bill: true, depr: 'appliances', cat: 'appliances', room: 'bathroom', tags: ['laundry'] }, [
  ['washer_vortex', 'washing_machine', 'Стиралка «Вихрь-Центрифуга»',     450,  {}, 'На отжиме уезжает на полметра. Привяжите, если дорога.', { tags: ['student'], tint: '#f4f2ec' }],
  ['washer_silent', 'washing_machine', 'Стиральная машина «Тишина-Премиум»', 1100, { room: 1 }, 'Стирает так тихо, что вы забудете про бельё. Как обычно.', { tags: ['lux', 'hitech'], tint: '#b9bec4' }],
]);
block({ place: 'floor', bill: false, depr: 'furniture', cat: 'misc', room: 'outside', tags: ['outdoor'] }, [
  ['mailbox_rustic', 'mailbox', 'Почтовый ящик «Скворечник»',     70,  {}, 'Письма складываются сюда, птицы — тоже иногда.', { tags: ['dacha'], tint: '#8a6440' }],
  ['mailbox_happy',  'mailbox', 'Почтовый ящик «Для писем счастья»', 150, { room: 1 }, 'Счета сюда тоже приходят. Но выглядят чуть радостнее.', { tags: ['classic'], tint: '#26395f' }],
]);

// — Строительство: двери и окна (cat build) —
block({ place: 'wall', bill: false, depr: 'none', cat: 'build', room: 'any', portal: true, tags: ['door'] }, [
  ['door_plywood', 'door', 'Дверь «Фанерная»',          90,  {}, 'Лёгкая, как намёк. Стучать осторожно — может проломиться.', { tags: ['student', 'dacha'], tint: '#c8b27a' }],
  ['door_glass',   'door', 'Дверь «Прозрачный намёк»',  400, { room: 1 }, 'Стеклянная. Закрыта, но всё видно. Как отношения с соседями.', { tags: ['modern', 'hitech'], tint: '#bcd6dc' }],
  ['door_oak',     'door', 'Дверь «Дубовая барская»',   700, { room: 1 }, 'Тяжёлая, резная, с медной ручкой. За ней явно происходит что-то важное.', { tags: ['lux', 'classic'], tint: '#5b3a24' }],
]);
block({ place: 'wall', bill: false, depr: 'none', cat: 'build', room: 'any', tags: ['window'] }, [
  ['window_small',    'window', 'Окно «Форточка»',     60,  { room: 1 }, 'Маленькое, но гордое. Проветривает на совесть.', { tags: ['student', 'dacha'], tint: '#f4f2ec' }],
  ['window_porthole', 'window', 'Окно «Иллюминатор»',   160, { room: 1 }, 'Круглое окно — дом чувствует себя кораблём.', { tags: ['retro'], tint: '#b9bec4' }],
  ['window_panorama', 'window', 'Окно «Панорама»',     250, { room: 2 }, 'От пола почти до потолка. Соседям тоже видно всё.', { tags: ['modern', 'scandi'], tint: '#f4f2ec' }],
]);

// — Улица —
block({ place: 'floor', bill: true, depr: 'appliances', cat: 'appliances', room: 'outside', tags: ['outdoor'] }, [
  ['grill_mangal', 'grill', 'Мангал «Шашлычок»',   150, { hunger: 4, fun: 1 }, 'Железный ящик, угли и мужчина с веером. Классика выходного дня.', { tags: ['dacha'], tint: '#2b2b2e' }],
  ['grill_gas',    'grill', 'Гриль «Барбекю-Босс»', 700, { hunger: 6, fun: 2 }, 'Газовый, с крышкой и термометром. Сосиски жарятся, пока вы в фартуке «Шеф».', { fp: [2, 1], tags: ['modern'], tint: '#b9bec4' }],
]);
block({ place: 'floor', bill: false, depr: 'none', cat: 'decor', room: 'outside', tags: ['outdoor', 'garden'] }, [
  ['flowerbed_veg',   'flowerbed', 'Грядка «Огурец-молодец»',     40,  { room: 1 }, 'Кабачков будет столько, что соседи начнут прятаться.', { walkable: false, tags: ['dacha'], tint: '#5a7a3a' }],
  ['flowerbed_tulip', 'flowerbed', 'Клумба «Тюльпаны»',          60,  { room: 2 }, 'Весной — красота, летом — ботва, осенью — гордые воспоминания.', { tags: ['dacha', 'granny'], tint: '#d0455a' }],
  ['flowerbed_roses', 'flowerbed', 'Клумба «Розы для тёщи»',      200, { room: 3 }, 'Колются, пахнут и требуют ухода. Тёща одобряет.', { tags: ['classic'], tint: '#9e2b33' }],
  ['hedge_box',       'hedge',     'Живая изгородь «Самшит»',     30,  { room: 1 }, 'Зелёная стена, которую можно стричь. Настоящей стене так не повезло.', { tint: '#3f6b45' }],
  ['hedge_topiary',   'hedge',     'Фигурный куст «Слон из кустов»', 400, { room: 3 }, 'Когда-то был шаром. Садовник увлёкся.', { tags: ['lux'], tint: '#3f6b45' }],
  ['tree_birch',      'tree',      'Берёза «Ностальгия»',         120, { room: 2 }, 'Белая, стройная, шелестит о чём-то своём.', { tags: ['dacha'], tint: '#e8e4d8' }],
  ['tree_pine',       'tree',      'Ель «Круглый год Новый»',     180, { room: 2 }, 'Наряжать можно в любое время. Соседи привыкнут.', { tags: ['dacha', 'scandi'], tint: '#2f5a3a' }],
  ['tree_apple',      'tree',      'Яблоня «Антоновка»',          250, { room: 3 }, 'Яблоки падают на голову строго по расписанию для открытий.', { tags: ['dacha', 'granny'], tint: '#4e8a4e' }],
  ['tree_palm',       'tree',      'Пальма «Курортный роман»',    450, { room: 3 }, 'Растёт где угодно при достаточной вере в лето.', { tags: ['retro'], tint: '#5a8a3a' }],
  ['tree_oak',        'tree',      'Дуб «Вековой»',               600, { room: 4 }, 'Цепь и кот не прилагаются, но место для них уже готово.', { fp: [2, 2], tags: ['classic'], tint: '#3f5a2f' }],
  ['fence_picket',    'fence',     'Забор «Штакетник»',           20,  {}, 'Белый заборчик, как в кино про счастливую жизнь.', { tags: ['dacha'], tint: '#f4f2ec' }],
  ['fence_stone',     'fence',     'Ограда «Каменная»',           45,  {}, 'Сложена вручную. Каждый камень — чья-то надорванная спина.', { tags: ['classic'], tint: '#8a8d93' }],
  ['fence_iron',      'fence',     'Ограда «Кованая»',            60,  { room: 1 }, 'Завитки, пики и строгий вид. Коты перелезают всё равно.', { tags: ['lux', 'classic'], tint: '#1f1f22' }],
]);
block({ place: 'floor', bill: true, depr: 'furniture', cat: 'misc', room: 'outside', tags: ['outdoor', 'kids'] }, [
  ['sandbox_basic',  'sandbox',   'Песочница «Куличики»',       120,  { fun: 3 }, 'Песок, ведёрко и формочка-рыбка. Счастье размером два на два метра.', { tint: '#d7c08f' }],
  ['sandbox_pirate', 'sandbox',   'Песочница «Пиратская бухта»', 350, { fun: 4 }, 'С корабликом и навесом. Клад зарывают каждый день, находят через неделю.', { fp: [2, 2], tint: '#8a6440' }],
  ['swing_basic',    'swing_set', 'Качели «Скрип-Скрип»',       400,  { fun: 5 }, 'Слышно на всю улицу. Это и есть звук детства.', { fp: [2, 1], skills: ['body'], tint: '#c8322e' }],
  ['swing_tarzan',   'swing_set', 'Площадка «Тарзания»',        1400, { fun: 7 }, 'Горка, канат, качели и башня. Взрослые тоже пробуют — когда никто не видит.', { fp: [3, 2], skills: ['body'], tint: '#3f6fb5' }],
]);
block({ place: 'floor', bill: true, depr: 'none', cat: 'misc', room: 'outside', tags: ['outdoor', 'sport'] }, [
  ['pool_frog',    'pool', 'Бассейн «Лягушатник»',  1200, { fun: 5, hygiene: 1 }, 'Глубина по колено взрослому и по уши счастью. Лесенка встроена!', { fp: [3, 3], skills: ['body'], tint: '#7fc4e0' }],
  ['pool_olympic', 'pool', 'Бассейн «Олимпийский»', 3500, { fun: 7, hygiene: 1, room: 1 }, 'Длинный, голубой, с дорожками. Не забудьте лесенку — это важно.', { fp: [4, 6], skills: ['body'], tags: ['lux'], tint: '#3f9fd0' }],
]);
block({ place: 'floor', bill: false, depr: 'art', cat: 'decor', room: 'outside', tags: ['outdoor'] }, [
  ['fountain_garden', 'fountain', 'Фонтан «Садовый журчун»', 900, { fun: 1, room: 4 }, 'Журчит, успокаивает и собирает монетки от гостей, загадавших желание.', { tags: ['classic', 'dacha'], tint: '#bfc6c9' }],
]);
block({ place: 'floor', bill: false, depr: 'furniture', cat: 'seating', room: 'outside', tags: ['outdoor'] }, [
  ['bench_garden', 'park_bench', 'Скамейка «Садовая»', 150, { comfort: 3 }, 'Для вечерних разговоров и наблюдения за соседями.', { fp: [2, 1], tags: ['dacha'], tint: '#3f6b45' }],
]);

// — Общественные участки (cat community, не продаются в Buy-режиме дома) —
block({ place: 'floor', bill: false, depr: 'none', cat: 'community', room: 'outside', buyable: false, tags: ['community'] }, [
  ['park_bench_city',   'park_bench',      'Скамейка «Горпарк»',                300,  { comfort: 4 }, 'Сидели все: пенсионеры, голуби, влюблённые. В этом порядке.', { fp: [2, 1], tint: '#6b4a2f' }],
  ['fountain_city',     'fountain',        'Фонтан «Дружба районов»',           5000, { fun: 1, room: 6 }, 'Главный фонтан района. Летом в нём купаются, хотя табличка против.', { fp: [3, 3], tint: '#e8e4dc' }],
  ['vending_soda',      'food_stall',      'Автомат «Газировка»',               900,  { hunger: 2 }, 'Бросил монету — получил газировку. Иногда — только звук.', { tint: '#c8322e' }],
  ['food_stall_icecream','food_stall',     'Киоск «Пломбир»',                  1500, { hunger: 3, fun: 1 }, 'Эскимо, стаканчик и то самое мороженое из детства.', { fp: [2, 1], tint: '#7fb3e0' }],
  ['food_stall_pies',   'food_stall',      'Ларёк «Пирожки горячие»',           2000, { hunger: 5 }, 'С капустой, с картошкой и с сюрпризом (сюрприз — повидло).', { fp: [2, 1], tint: '#e0803a' }],
  ['cash_register',     'cash_register',   'Касса «Пробивай»',                  800,  {}, 'Пик-пик-дзынь. Самый приятный звук для владельца магазина.', { place: 'floor', tint: '#3a3d42' }],
  ['cash_register_cafe','cash_register',   'Касса кафе «Чаевые»',               900,  {}, 'Рядом стоит баночка «на мечту бариста».', { tint: '#6b4a2f' }],
  ['shelf_shop_goods',  'shelf_shop',      'Стеллаж «Всё по 99»',               400,  {}, 'Всё, что вам не нужно, по очень привлекательной цене.', { fp: [2, 1], tint: '#c9ccd1' }],
  ['shelf_shop_food',   'shelf_shop',      'Стеллаж «Продукты»',                450,  {}, 'Хлеб, молоко и то, за чем вы не заходили, но купили.', { fp: [2, 1], tint: '#e0d8c0' }],
  ['shelf_shop_clothes','shelf_shop',      'Вешалка «Модный сезон»',            500,  {}, 'Всё новое, всё модное, всё — не вашего размера.', { fp: [2, 1], tint: '#b9bec4' }],
  ['cafe_table_bistro', 'cafe_table',      'Столик кафе «Бистро»',              250,  {}, 'Круглый, на одной ножке, качается ровно на один миллиметр.', { room: 'any', tint: '#2b2b2e' }],
  ['cafe_table_umbrella','cafe_table',     'Столик с зонтом «Летняя веранда»',  400,  { room: 1 }, 'Тень, лимонад и неторопливые разговоры.', { tint: '#c8322e' }],
  ['gym_machine_press', 'gym_machine',     'Тренажёр «Жим-Жим»',                1500, { fun: 2 }, 'Выжимает всё: вес, пот и обещания начать с понедельника.', { room: 'any', skills: ['body'], fp: [1, 2], tint: '#2b2b2e' }],
  ['gym_machine_row',   'gym_machine',     'Гребной тренажёр «Галера»',         1800, { fun: 2 }, 'Гребите! Берег не приближается, но плечи растут.', { room: 'any', skills: ['body'], fp: [1, 2], tint: '#3a3d42' }],
  ['gym_machine_rack',  'gym_machine',     'Силовая рама «Геракл»',             2500, { fun: 3 }, 'Двенадцатый подвиг — прийти сюда в понедельник утром.', { room: 'any', skills: ['body'], fp: [2, 2], tint: '#c8322e' }],
  ['library_shelf',     'library_shelf',   'Стеллаж библиотеки «Тишина»',       900,  { fun: 2 }, 'Книги, пыль и строгий взгляд библиотекаря.', { room: 'any', skills: ['cooking', 'mechanical', 'logic'], fp: [2, 1], tint: '#6b4a2f' }],
  ['library_shelf_rare','library_shelf',   'Шкаф «Редкие фолианты»',            1600, { fun: 3, room: 1 }, 'Трогать в перчатках. Чихать — в другом зале.', { room: 'any', skills: ['cooking', 'mechanical', 'logic', 'charisma'], fp: [2, 1], tint: '#4a2c20' }],
  ['museum_mammoth',    'museum_exhibit',  'Экспонат «Кость мамонта»',          3000, { fun: 2, room: 5 }, 'Настоящая кость настоящего мамонта. Хозяин просил вернуть, если что.', { room: 'any', fp: [2, 1], tint: '#e8dcc0' }],
  ['museum_amphora',    'museum_exhibit',  'Витрина «Античная амфора»',         4000, { fun: 2, room: 6 }, 'Две тысячи лет, три трещины и ни капли вина.', { room: 'any', tint: '#b8603e' }],
  ['museum_robot',      'museum_exhibit',  'Экспонат «Робот будущего 1985»',    5000, { fun: 3, room: 6 }, 'Так в 1985-м представляли будущее. Будущее посмеялось.', { room: 'any', tint: '#b9bec4' }],
  ['streetlight_city',  'streetlight',     'Фонарь уличный «Горсвет»',          400,  { room: 2 }, 'Включается ровно тогда, когда уже поздно.', { tint: '#2b2b2e' }],
  ['trash_bin_street',  'trash_bin_street','Урна «Не сорить!»',                 60,   {}, 'Надпись строгая, но урна добрая: принимает всё.', { tint: '#3f6b45' }],
  ['trash_bin_recycle', 'trash_bin_street','Урна раздельная «Эко-трио»',        150,  {}, 'Бумага, пластик, стекло. Четвёртое отделение — для совести.', { fp: [2, 1], tint: '#3f9f5f' }],
]);

// ─────────────────────────── Цветовые варианты ───────────────────────────
// [id формы (из SHAPES или BASE_REF), [ключи палитры]]
const VARIANTS = [
  // сиденья
  ['dining_chair',   ['cherry', 'mint', 'graphite', 'mustard']],
  ['chair_scandi',   ['snow', 'graphite', 'sky']],
  ['chair_folding',  ['orange', 'navy']],
  ['chair_plastic',  ['forest', 'red', 'sky']],
  ['chair_bar_stool',['mint', 'coal']],
  ['chair_office',   ['navy', 'red']],
  ['chair_vienna',   ['coal', 'birch']],
  ['armchair',       ['mustard', 'sea', 'lavender', 'chocolate']],
  ['beanbag',        ['lemon', 'rose', 'sky', 'plum']],
  ['recliner',       ['coal', 'navy']],
  ['armchair_scandi',['mustard', 'sea']],
  ['armchair_granny',['forest', 'lilac']],
  ['sofa',           ['cherry', 'mint', 'navy', 'latte']],
  ['sofa_student',   ['orange', 'plum', 'avocado']],
  ['loveseat',       ['rose', 'sea']],
  ['sofa_cloud',     ['lavender', 'sand', 'coral']],
  ['sofa_scandi',    ['mustard', 'forest', 'sky']],
  ['sofa_corner',    ['latte', 'coal']],
  // кровати
  ['bed_single',     ['sky', 'rose', 'forest']],
  ['bed_double',     ['cream', 'plum', 'navy']],
  ['bed_cot',        ['navy']],
  ['bed_sleigh',     ['cherry', 'snow']],
  ['bed_double_scandi', ['graphite']],
  ['kids_bed_basic', ['rose', 'lemon', 'mint']],
  ['kids_bed_car',   ['sky', 'lemon']],
  ['bunk_bed_basic', ['snow', 'sky']],
  ['crib',           ['rose', 'sky']],
  // поверхности
  ['dining_table',   ['walnut', 'snow']],
  ['table_scandi',   ['snow', 'coal']],
  ['desk_basic',     ['snow', 'coal']],
  ['coffee_table',   ['walnut', 'birch']],
  ['counter',        ['snow', 'mint', 'cherry']],
  ['counter_granite',['snow', 'coal']],
  // кухня
  ['fridge',         ['red', 'mint', 'coal', 'lemon']],
  ['fridge_mini',    ['sky', 'rose']],
  ['stove',          ['cream', 'coal']],
  ['microwave_basic',['red', 'silver']],
  ['coffee_basic',   ['red', 'snow']],
  // сантехника
  ['toilet',         ['rose', 'sky', 'avocado']],
  ['bathtub',        ['rose', 'mint']],
  ['bathtub_claw',   ['coal', 'gold']],
  ['shower',         ['mint', 'coal']],
  ['bath_sink',      ['rose', 'avocado']],
  // электроника
  ['tv',             ['walnut', 'silver']],
  ['tv_ripple',      ['orange', 'snow']],
  ['stereo_boombox', ['silver', 'red']],
  ['console_8bit',   ['coal']],
  ['computer_pent',  ['coal', 'snow']],
  ['phone',          ['red', 'snow', 'forest']],
  ['phone_rotary',   ['red', 'cream']],
  // свет
  ['floor_lamp',     ['coal', 'gold']],
  ['lamp_lava',      ['lilac', 'teal', 'red']],
  ['desk_lamp_student', ['sky', 'lemon', 'coal']],
  ['ceiling_sputnik',['silver', 'coal']],
  ['lamp_floor_arc', ['gold', 'coal']],
  // декор
  ['plant_geranium', ['rose', 'snow']],
  ['rug',            ['cherry', 'sea', 'mustard', 'lilac']],
  ['rug_round',      ['sky', 'rose']],
  ['rug_knit',       ['sky', 'forest']],
  ['vase_dacha',     ['sky', 'forest']],
  ['vase_crystal',   ['lilac']],
  ['garden_gnome',   ['sky', 'forest']],
  ['flamingo',       ['sky']],
  ['clock_wall',     ['red', 'coal']],
  ['plant',          ['forest']],
  // хобби, детское, прочее
  ['guitar_camp',    ['coal', 'red']],
  ['piano_upright',  ['snow', 'walnut']],
  ['toy_box_basic',  ['sky', 'forest']],
  ['dresser',        ['snow', 'walnut', 'mint']],
  ['dresser_scandi', ['birch', 'graphite']],
  ['wardrobe_basic', ['snow', 'walnut']],
  ['washer_vortex',  ['silver']],
  ['yoga_mat',       ['lilac', 'coral']],
  ['treadmill_basic',['silver']],
  // улица, стройка
  ['door',           ['snow', 'walnut', 'red']],
  ['door_glass',     ['coal']],
  ['chess_yard',     ['snow']],
  ['bench_garden',   ['walnut', 'snow']],
  ['fence_picket',   ['walnut', 'sky']],
  ['grill_mangal',   ['red']],
  ['swing_basic',    ['lemon']],
];

// ─────────────────────────── Сборка ───────────────────────────
const shapeById = Object.fromEntries(SHAPES.map(s => [s.id, s]));
function firstSentence(t) { const m = t.match(/^.*?[.!?…»](\s|$)/); return (m ? m[0] : t).trim(); }

const VARIANT_ITEMS = [];
for (const [parentId, keys] of VARIANTS) {
  const shape = shapeById[parentId];
  const base = shape || BASE_REF[parentId];
  if (!base) throw new Error(`catalog-extra: нет формы ${parentId}`);
  for (const k of keys) {
    const [label, hex, quip] = PALETTE[k];
    const { id: _i, variantOf: _v, tint: _t, desc: _d, tags: _g, name: _n, ...rest } = base;
    VARIANT_ITEMS.push({
      ...rest,
      id: `${parentId}_${k}`,
      name: `${base.name} · ${label}`,
      kind: shape ? shape.kind : parentId,
      ratings: { ...base.ratings },
      fp: [...base.fp],
      variantOf: parentId,
      tint: hex,
      tags: [...new Set([...(shape?.tags || []), 'variant', `color:${k}`])],
      desc: `${firstSentence(base.desc)} ${quip}`,
    });
  }
}

// ─────────────────────────── Новинки и основная коллекция ───────────────────────────
// isNew — «новинки» для вкладки Интерфейса (~40 ярких форм; у вариантов всегда false).
export const NEW_IDS = [
  'sofa_cloud', 'armchair_egg', 'recliner', 'beanbag', 'chair_parisienne', 'bed_round', 'bed_water', 'kids_bed_car',
  'kids_bed_castle', 'bunk_bed_pirate', 'counter_island', 'fridge_siberia', 'coffee_lux', 'toilet_throne', 'shower_tropic',
  'bathtub_nirvana', 'hot_tub_lux', 'tv_projector', 'jukebox', 'computer_quantum', 'console_vr', 'pinball_space', 'lamp_lava',
  'ceiling_chandelier', 'painting_mona', 'sculpture_david', 'garden_gnome', 'plant_bonsai', 'aquarium_ocean', 'fireplace_lux',
  'piano_grand', 'guitar_electric', 'telescope_pro', 'pool_table_baron', 'dartboard_pub', 'treadmill_pro', 'dollhouse_palace',
  'swing_tarzan', 'pool_olympic', 'grill_gas', 'tree_apple', 'hedge_topiary',
];
// collection — ОДНА основная коллекция у каждого предмета (ключ COLLECTIONS). Берётся первый подходящий тег
// в порядке приоритета; без стилевого тега — 'classic'. Варианты наследуют коллекцию формы.
export const COLLECTION_PRIORITY = ['community', 'kids', 'sport', 'lux', 'hitech', 'scandi', 'granny', 'dacha', 'retro', 'student', 'outdoor', 'classic'];
const COLLECTION_BY_BASE = { dining_chair: 'classic', armchair: 'classic', sofa: 'classic', bed_single: 'student', bed_double: 'classic',
  dining_table: 'classic', coffee_table: 'classic', counter: 'classic', fridge: 'retro', stove: 'classic', toilet: 'classic',
  shower: 'classic', bathtub: 'classic', bath_sink: 'classic', tv: 'retro', phone: 'retro', floor_lamp: 'classic', rug: 'granny',
  plant: 'classic', dresser: 'classic', door: 'classic', crib: 'kids' };
function primaryCollection(d) {
  if (d.cat === 'community') return 'community';
  return COLLECTION_PRIORITY.find(k => d.tags.includes(k)) ?? 'classic';
}

function normalize(d) {
  return {
    buyable: true, walkable: false,
    ...d,
    ratings: { ...d.ratings },
    tags: [...new Set(d.tags || [])],
  };
}

export const EXTRA = [...SHAPES, ...VARIANT_ITEMS].map(normalize);
{
  const newSet = new Set(NEW_IDS);
  const shapeColl = {};
  for (const d of EXTRA) if (!d.variantOf) { d.collection = primaryCollection(d); shapeColl[d.id] = d.collection; }
  for (const d of EXTRA) {
    if (d.variantOf) d.collection = shapeColl[d.variantOf] ?? COLLECTION_BY_BASE[d.variantOf] ?? 'classic';
    d.isNew = !d.variantOf && newSet.has(d.id);
  }
}

// ─────────────────────────── Коллекции для Интерфейса ───────────────────────────
// ids — формы с этой основной коллекцией (d.collection === key); варианты группируются по variantOf.
// tagged — все формы с этим тегом (пересекающиеся подборки, если нужны).
const COLL_DEF = [
  ['scandi',    'Скандинавский', '🌲'],
  ['granny',    'Бабушкин',      '🧶'],
  ['hitech',    'Хай-тек',       '🤖'],
  ['dacha',     'Дачный',        '🥒'],
  ['lux',       'Барский',       '👑'],
  ['student',   'Студенческий',  '🍜'],
  ['retro',     'Ретро',         '📼'],
  ['kids',      'Детская',       '🧸'],
  ['classic',   'Классика',      '🏛️'],
  ['outdoor',   'Сад и двор',    '🌳'],
  ['sport',     'Спорт',         '🏋️'],
  ['community', 'Общественные',  '🏙️'],
];
export const COLLECTIONS = Object.fromEntries(COLL_DEF.map(([key, name, icon]) => [key, {
  name, icon,
  ids: EXTRA.filter(d => d.collection === key && !d.variantOf).map(d => d.id),
  tagged: EXTRA.filter(d => d.tags.includes(key) && !d.variantOf).map(d => d.id),
}]));

// Порядок комнат и категорий для «сортировки по комнате/функции» (как в TS1)
export const ROOM_SORT = [
  { room: 'kitchen',  name: 'Кухня',    icon: '🍳' },
  { room: 'living',   name: 'Гостиная', icon: '🛋️' },
  { room: 'bedroom',  name: 'Спальня',  icon: '🛏️' },
  { room: 'bathroom', name: 'Ванная',   icon: '🛁' },
  { room: 'study',    name: 'Кабинет',  icon: '📚' },
  { room: 'outside',  name: 'Улица',    icon: '🌳' },
  { room: 'any',      name: 'Разное',   icon: '📦' },
];
export const CAT_SORT = [
  { cat: 'seating',     name: 'Сиденья',       icon: '🪑' },
  { cat: 'surfaces',    name: 'Поверхности',   icon: '🟫' },
  { cat: 'decor',       name: 'Декор',         icon: '🖼️' },
  { cat: 'electronics', name: 'Электроника',   icon: '📺' },
  { cat: 'appliances',  name: 'Техника',       icon: '🔌' },
  { cat: 'plumbing',    name: 'Сантехника',    icon: '🚿' },
  { cat: 'lighting',    name: 'Свет',          icon: '💡' },
  { cat: 'misc',        name: 'Разное',        icon: '🎲' },
  { cat: 'build',       name: 'Двери и окна',  icon: '🚪' },
  { cat: 'community',   name: 'Общественные',  icon: '🏙️' },
];

// ─────────────────────────── Стены и полы ───────────────────────────
// id — числа, продолжают WALLS (1..3) и FLOORS (1..4) из data/catalog.js. pattern — подсказка Рендеру для процедурной текстуры.
export const WALLS_EXTRA = [
  [4,  'Краска «Пломбир»',              6,  '#f4f2ec', 'plain'],
  [5,  'Краска «Мятный чай»',           6,  '#bfe0cf', 'plain'],
  [6,  'Краска «Персиковый йогурт»',    6,  '#f2c8a8', 'plain'],
  [7,  'Краска «Небо над дачей»',       6,  '#b8d4ea', 'plain'],
  [8,  'Краска «Горчичное зерно»',      7,  '#d4ae45', 'plain'],
  [9,  'Краска «Графит»',               7,  '#4a4d52', 'plain'],
  [10, 'Краска «Терракота»',            7,  '#b8603e', 'plain'],
  [11, 'Краска «Лавандовое поле»',      7,  '#b9acd9', 'plain'],
  [12, 'Обои «Бабушкины розочки»',      12, '#e8d4c8', 'flowers'],
  [13, 'Обои «Советский ромбик»',       11, '#c9b894', 'diamonds'],
  [14, 'Обои «Полоска-классик»',        14, '#9e2b33', 'stripes'],
  [15, 'Обои «Горошек»',                12, '#f0d64a', 'dots'],
  [16, 'Обои «Клетка шотландская»',     15, '#3f6b45', 'check'],
  [17, 'Обои «Дамаск-Барон»',           22, '#5e2f55', 'damask'],
  [18, 'Обои «Детские звёздочки»',      12, '#7fb3e0', 'stars'],
  [19, 'Обои «Тропики»',                16, '#4e8a4e', 'leaves'],
  [20, 'Обои «Ретро-геометрия 70-х»',   15, '#e0803a', 'geo'],
  [21, 'Кирпич белёный «Лофт»',         20, '#e6e0d6', 'brick'],
  [22, 'Кирпич красный «Заводской»',    19, '#9a4a38', 'brick'],
  [23, 'Кирпич тёмный «Клинкер»',       24, '#5a3a30', 'brick'],
  [24, 'Камень «Дикий»',                28, '#8a8378', 'stone'],
  [25, 'Камень «Замковый»',             32, '#6f6a62', 'stone'],
  [26, 'Панели сосновые «Вагонка»',     16, '#d8b27a', 'planks'],
  [27, 'Панели дубовые «Кабинет»',      26, '#6b4a2f', 'panel'],
  [28, 'Брус «Сруб»',                   22, '#a0703f', 'logs'],
  [29, 'Плитка белая «Кабанчик»',       18, '#f2f0ea', 'subway'],
  [30, 'Плитка голубая «Бассейн»',      17, '#8ecae0', 'tile'],
  [31, 'Плитка «Мозаика-Мурано»',       30, '#2f8f8f', 'mosaic'],
  [32, 'Мрамор «Каррара»',              40, '#ece8e2', 'marble'],
  [33, 'Мрамор чёрный «Неро»',          45, '#2a2a2c', 'marble'],
  [34, 'Бетон «Брутализм»',             9,  '#9a9a96', 'concrete'],
  [35, 'Штукатурка «Венецианская»',     35, '#d8c09a', 'plaster'],
  [36, 'Сайдинг «Американская мечта»',  13, '#dfe6ee', 'siding'],
  [37, 'Шпалеры «Зелёная стена»',       25, '#3f6b45', 'leaves'],
].map(([id, name, price, color, pattern]) => ({ id, name, price, color, pattern }));

export const FLOORS_EXTRA = [
  [5,  'Паркет «Ёлочка»',              16, '#a87a4e', 'herringbone'],
  [6,  'Паркет «Дворцовый»',           30, '#7a5230', 'parquet'],
  [7,  'Доска «Беленый дуб»',          14, '#d8c8aa', 'planks'],
  [8,  'Доска «Орех»',                 15, '#5b3a24', 'planks'],
  [9,  'Доска «Дачная крашеная»',      8,  '#8a4b3a', 'planks'],
  [10, 'Ламинат «Практичный»',         7,  '#b8946a', 'planks'],
  [11, 'Плитка «Шахматная»',           12, '#1f1f22', 'check'],
  [12, 'Плитка «Кабинка»',             9,  '#e8eef0', 'tile'],
  [13, 'Плитка «Терракота»',           11, '#b8603e', 'tile'],
  [14, 'Плитка «Мятная ванная»',       10, '#bfe0cf', 'tile'],
  [15, 'Плитка «Мозаика-бассейн»',     18, '#2f8f8f', 'mosaic'],
  [16, 'Плитка «Метлахская»',          14, '#c8a080', 'hex'],
  [17, 'Мрамор «Каррара»',             35, '#ece8e2', 'marble'],
  [18, 'Мрамор «Зелёный малахит»',     45, '#2f6b4a', 'marble'],
  [19, 'Гранит «Серый»',               25, '#7a7c80', 'speckle'],
  [20, 'Ковролин «Бордо»',             7,  '#7d2a45', 'carpet'],
  [21, 'Ковролин «Лесная поляна»',     7,  '#4e7a4e', 'carpet'],
  [22, 'Ковролин «Бежевый офис»',      6,  '#c8b894', 'carpet'],
  [23, 'Ковролин детский «Облака»',    9,  '#b8d4ea', 'carpet'],
  [24, 'Ковролин «Ворс-Люкс»',         14, '#f0ece2', 'carpet'],
  [25, 'Линолеум «Коммуналка»',        3,  '#b8a070', 'lino'],
  [26, 'Линолеум «Шашечки 60-х»',      5,  '#c8322e', 'check'],
  [27, 'Бетон «Лофт»',                 5,  '#9a9a96', 'concrete'],
  [28, 'Пробка «Эко»',                 12, '#c8a070', 'cork'],
  [29, 'Бамбук «Панда»',               13, '#d7c08f', 'planks'],
  [30, 'Садовая дорожка «Кирпичик»',   6,  '#9a4a38', 'brick'],
  [31, 'Брусчатка «Старый город»',     9,  '#7a7870', 'cobble'],
  [32, 'Гравий «Хрусть»',              3,  '#b8b0a0', 'gravel'],
  [33, 'Деревянный настил «Терраса»',  11, '#9a6a40', 'deck'],
  [34, 'Газон «Английский»',           2,  '#5a9a4a', 'grass'],
  [35, 'Песок «Пляж»',                 2,  '#e0cc98', 'sand'],
  [36, 'Резина «Детская площадка»',    8,  '#c8322e', 'rubber'],
  [37, 'Асфальт «Двор»',               4,  '#4a4a4c', 'asphalt'],
].map(([id, name, price, color, pattern]) => ({ id, name, price, color, pattern }));
