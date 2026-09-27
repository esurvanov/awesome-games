// ═══ СОБЫТИЯ (карточки с выбором) ═══
// Собирательные сцены по docs/research/people.md и timeline.md. Не выдаём сцены за реальные случаи;
// смертей и родов в очереди нет. TODO-research: сценаристы расширят до ~300.
//
// EVENTS[] — {
//   id, icon, title (2–4 слова)
//   weight   'heavy' | 'light' — режиссёр чередует: после тяжёлого — несколько лёгких
//   forced   true — срабатывает сразу при выполнении условий (объявления правил, КПП), минуя режиссёра
//   npc      id человека из people.js | 'near' — случайный незнакомец рядом (подставляется {name}, {age}, {job})
//   when     условие (всё — И; любое поле необязательно):
//            days: [21, 30] — число сентября;  hours: [20, 6] — часы (через полночь можно)
//            rule: 'pedAllowed' | '!pedBan' | [...];  flag: 'x' | '!x' | [...] (флаги сюжета)
//            need: { warmth: '<40' };  money: { rub_cash: '>=500' };  item: { meds: '>=1' }
//            kpp: [0, 5] — км до КПП;  near: 'seller' | 'place:lars' | 'npc:zaur';  inCar: true|false;
//            signal: true|false — требует/запрещает сеть (ROUTE.signal); карточные переводы (rub_card) —
//            всегда с signal: true, как и переводы в лавке (economy.js payOptions), иначе можно «перевести»
//            там, где телефон в принципе не может отправить перевод
//            weather: 'rain' | [...];  night: true|false;  trust: { zaur: '>=10' };  fuel: '<3'
//            passengers: '>=1';  rumour: 'r_draft' (игрок знает);  chance: 0.5
//   once     по умолчанию true; false + cooldown (часы) — повторяемое
//   text     1–3 коротких предложения; {name} {age} {job} {km} подставляются
//   choices[] — { label, icon, need?, fx, out }
//            need — доп. условие (как when); если fx что-то отнимает (деньги, вещи) — проверяется само
//            out  — короткий итог (показывается вместе с последствиями)
//   fx (эффекты; то же в действиях и ответах в телефоне):
//            needs: { hunger|thirst|warmth|sleep|nerves|charge: ±n }
//            money: { rub_cash|rub_card|usd|gel: ±n }
//            buy: { good, qty?, mul? } — заплатить рыночную цену товара (наличными ₽; mul — торг); {price} в label
//            items: { товар: ±n };  fuel: ±литров;  time: минут проходит
//            trust: { id|'npc': ±n };  flag: { имя: 1|0 };  rumour: id — игрок узнаёт слух
//            places: ±n — сдвиг в очереди (−1 — пропустил одного);  advance: км — объезд очереди вперёд
//            passenger: 'npc' | id — взять в машину;  fuel (fx) — то же, что fuel в fx выше, для машины игрока
//            msg: { chat, text } — сообщение в телефон
//            ВАЖНО: places/advance/passenger/fuel двигают или наполняют машину игрока и работают, только
//            если игрок реально за рулём (world.playerDrives(): p.inCar && w.pcar) — движок это перепроверяет
//            сам (sim/rules.js apply()) и молча не применяет эффект, если водителя нет. Но событие/выбор
//            с такими fx стоит явно пометить when: { inCar: true } (или choices[].need для отдельного
//            варианта), чтобы кнопка не показывалась там, где она заведомо бессмысленна (стоишь у чужой
//            машины пешком) — по одному этому условию, а не отдельной проверкой для каждого события
//            helped: 'кому' | harmed: 'кому' | gave: [..] | got: [..] — строки для итога «отдал / получил»
//            risk: { p, fx, out } — с вероятностью p вместо обычных fx срабатывают эти (развод, неудача)
//            end: { id, title, icon } — конец пути (пересёк иначе, чем на машине)
//            event: id — сразу следующая карточка
// }
'use strict';
L.def('content/events', () => {
const EVENTS = [
  // ——— правила календаря (forced) ———
  { id: 'rule_ped', forced: true, weight: 'heavy', icon: 'walk', title: 'Пешком — можно', when: { rule: 'pedAllowed' },
    text: 'По чату: пеших пропускают, семьи — первыми. Кто-то бросает машины прямо в ряду.',
    choices: [
      { label: 'Остаюсь с машиной', icon: 'car', fx: { needs: { nerves: -2 } }, out: 'Машина — это всё, что есть' },
      { label: 'Написать в чат: беру пеших', icon: 'chat', fx: { msg: { chat: 'lars', text: 'Есть 4 места, {km} км, серый Солярис' }, flag: { offerSeats: 1 }, trust: { gena: 5 } }, out: 'Телефон зажужжал' },
      // раньше — мгновенный бесплатный конец (playthroughs.md F1). Теперь пешая очередь стоит сутки
      // (timeline: пешком ≈ сутки) — время и ночь без машины идут через fx, как и везде в контенте,
      // без отдельного «режима ходьбы» (см. задачу): time — почти сутки, needs — ночь без тепла машины
      { label: 'Оставить машину Ахсару и идти', icon: 'house', need: { trust: { akhsar: '>=0' } },
        fx: { gave: ['машина'], needs: { warmth: -45, sleep: -30, nerves: -8 }, time: 1440, end: { id: 'walk', title: 'Пешком через КПП', icon: 'walk' } },
        out: 'Ключ под камнем. Сутки пешком, в холод и почти без сна — дальше сам' },
    ] },
  { id: 'rule_draft', forced: true, weight: 'heavy', icon: 'flag', title: 'Пункт на КПП', when: { rule: 'draftPoint' },
    text: 'У КПП встал микроавтобус с надписью «Военный комиссариат». В очереди стало тихо.',
    choices: [
      { label: 'Позвонить маме', icon: 'call', need: { need: { charge: '>=5' } }, fx: { needs: { nerves: 6, charge: -5 }, time: 10 }, out: 'Она не плакала. Почти' },
      { label: 'Спросить соседей', icon: 'chat', fx: { rumour: 'r_draft', trust: { lekha: 3 }, needs: { nerves: -3 } }, out: '«Вручают только подлежащим». Никто не верит' },
      { label: 'Просто ждать', icon: 'clock', fx: { needs: { nerves: -6 } }, out: 'Руки дрожат' },
    ] },
  { id: 'rule_entry', forced: true, weight: 'light', icon: 'barrier', title: 'Въезд закрыт', when: { rule: 'carEntry' },
    text: 'Въезд в республику для машин с чужими номерами закрыли. Тех, кто уже стоит, — выпускают.',
    choices: [{ label: 'Хвост больше не растёт', icon: 'check', fx: { needs: { nerves: 3 } }, out: 'Сзади — последние' }] },
  { id: 'rule_pedban', forced: true, weight: 'heavy', icon: 'walk', title: 'Пешком нельзя', when: { rule: 'pedBan' },
    text: 'Пеших разворачивают. По слухам — и велосипеды. У КПП растёт гора брошенных самокатов.',
    choices: [
      { label: 'Взять кого-то пешего', icon: 'car', need: { flag: '!liftDone' }, fx: { helped: 'пеший у КПП', flag: { liftDone: 1 }, trust: { gena: 5 }, needs: { nerves: 5 } }, out: '«Спасибо» — шёпотом' },
      { label: 'Места нет', icon: 'close', fx: { needs: { nerves: -2 } }, out: 'Отвернулся' },
    ] },
  // ——— первая ночь и холод ———
  { id: 'first_night', weight: 'light', icon: 'moon', title: 'Первая ночь', when: { night: true, inCar: true, need: { warmth: '<75' } },
    text: 'Хвост. Впереди — огни на километры. Холодает, пальцы мёрзнут на руле.',
    choices: [
      { label: 'Завести мотор на час', icon: 'fire', need: { fuel: '>=1' }, fx: { fuel: -1, needs: { warmth: 22 } }, out: 'Тепло. Стрелка бензина ниже' },
      { label: 'Куртку на колени', icon: 'blanket', fx: { needs: { warmth: 6, sleep: -3 } }, out: 'Не заснуть' },
      { label: 'Постучать к соседу', icon: 'chat', fx: { trust: { lekha: 6 }, needs: { nerves: 4 }, time: 15 }, out: 'Лёха налил чаю из термоса' },
    ] },
  { id: 'fuel_low', weight: 'heavy', icon: 'fuel', title: 'Бензин на нуле', when: { fuel: '<3', night: true, inCar: true },
    once: false, cooldown: 20,
    text: 'Лампочка бензина горит. Мотор больше не греет. Мимо идёт парень с канистрой.',
    choices: [
      { label: 'Канистра · {price}', icon: 'fuel', fx: { buy: { good: 'fuel' }, fuel: 10, got: ['10 л бензина'] }, out: 'Дороже, чем в Москве в 20 раз' },
      { label: 'Попросить у Лёхи', icon: 'chat', need: { trust: { lekha: '>=10' } }, fx: { fuel: 4, trust: { lekha: -4 }, got: ['4 л от Лёхи'] }, out: '«Отдашь в Тбилиси»' },
      { label: 'Мёрзнуть', icon: 'snow', fx: { needs: { warmth: -12, nerves: -5 } }, out: 'Зубы стучат до утра' },
    ] },
  { id: 'storm', weight: 'light', icon: 'rain', title: 'Мокрое всё', when: { weather: ['rain', 'storm', 'drizzle'], chance: 0.6 },
    text: 'Одежду сушат на капотах. У {name} промокли кроссовки насквозь.', npc: 'near',
    choices: [
      { label: 'Отдать дождевик', icon: 'rain', need: { item: { raincoat: '>=1' } }, fx: { items: { raincoat: -1 }, helped: '{name}', trust: { npc: 15 } }, out: 'Сосед кивнул' },
      { label: 'Пустить погреться', icon: 'car', fx: { helped: '{name}', needs: { nerves: 3 }, time: 30, trust: { npc: 10 } }, out: 'Полчаса молча грелись вдвоём' },
      { label: 'Закрыть окно', icon: 'close', fx: {}, out: '' },
    ] },
  // ——— соседи ———
  // kpp сужен до окна, где реально продают meds (Алан 1,3 км, Мадина 6,1 км — content-graph 4.2: без
  // этого события чаще приходило за 13 км, «Отдать таблетки» был заблокирован 173/173, таблеток взять
  // ещё было негде)
  { id: 'olya_fever', weight: 'heavy', icon: 'child', title: 'У Тимоши жар', npc: 'olya', when: { days: [25, 30], kpp: [0, 9] },
    text: 'Оля стучит в стекло: у сына 39,5. Жаропонижающее кончилось. Медик где-то у КПП.',
    choices: [
      { label: 'Отдать таблетки', icon: 'meds', need: { item: { meds: '>=1' } }, fx: { items: { meds: -1 }, trust: { olya: 30 }, helped: 'Тимоша', needs: { nerves: 4 } }, out: 'Через час Тимоша уснул' },
      { label: 'Написать в SOS Lars', icon: 'phone', need: { need: { charge: '>=5' } }, fx: { needs: { charge: -4 }, msg: { chat: 'sos', text: 'Ребёнок 39,5, {km} км, красный Солярис' }, trust: { olya: 15, alan: 5 }, helped: 'Тимоша', time: 20 }, out: 'Медик ответил: «Иду»' },
      { label: 'Пропустить их вперёд', icon: 'arrowUp', need: { inCar: true }, fx: { places: -1, trust: { olya: 25 }, helped: 'Оля с сыном', gave: ['место в очереди'] }, out: 'Одна машина — это минут сорок' },
      { label: 'Нечем помочь', icon: 'close', fx: { trust: { olya: -10 }, needs: { nerves: -6 } }, out: 'Плач за стеклом до утра' },
    ] },
  { id: 'shift', weight: 'light', icon: 'shield', title: 'Дежурство', npc: 'lekha', when: { night: true },
    text: 'Лёха собирает смены: по двое у обочины, чтобы никто не лез «ёлочкой».',
    choices: [
      { label: 'Взять смену', icon: 'clock', fx: { needs: { sleep: -12, nerves: 4 }, trust: { lekha: 15 }, helped: 'ряд', time: 60 }, out: 'Час на холоде. Никто не пролез' },
      { label: 'Мне надо спать', icon: 'moon', fx: { trust: { lekha: -5 } }, out: '«Ну-ну»' },
    ] },
  { id: 'cutter', weight: 'heavy', icon: 'alert', title: 'Лезут по встречке', when: { kpp: [0.3, 30], inCar: true }, once: false, cooldown: 30,
    text: 'Джип по встречке встаёт перед тобой. Из окна: «Мне срочно, брат». Сзади сигналят.',
    choices: [
      { label: 'Не пустить', icon: 'close', fx: { needs: { nerves: -6 }, trust: { lekha: 8 } }, out: 'Он уехал дальше по встречке' },
      { label: 'Пустить', icon: 'arrowUp', fx: { places: -1, harmed: 'ряд за тобой', trust: { lekha: -10 } }, out: 'Сзади кричат' },
      { label: 'Снять на видео', icon: 'phone', need: { need: { charge: '>=5' } }, fx: { needs: { charge: -3 }, msg: { chat: 'lars', text: 'Опять по встречке, чёрный джип, {km} км' } }, out: 'В чате 40 реакций' },
    ] },
  { id: 'hunger_share', weight: 'light', icon: 'bread', title: 'Икра и голод', npc: 'near', when: { need: { hunger: '<55' } },
    text: 'В соседней машине едят бутерброды с икрой. Рядом {name}, {age}, второй день на яблоке.',
    choices: [
      { label: 'Поделиться хлебом', icon: 'bread', need: { item: { bread: '>=1' } }, fx: { items: { bread: -1 }, helped: '{name}', needs: { nerves: 4 } }, out: 'Съел стоя, быстро' },
      { label: 'Шоколад пополам', icon: 'choco', need: { item: { choco: '>=1' } }, fx: { items: { choco: -1 }, helped: '{name}', needs: { nerves: 6, hunger: 4 } }, out: 'Лучший шоколад в жизни' },
      { label: 'Отвернуться', icon: 'close', fx: { needs: { nerves: -3 } }, out: '' },
    ] },
  { id: 'fire', weight: 'light', icon: 'fire', title: 'Костёр из поддонов', when: { night: true, chance: 0.7 },
    text: 'У обочины жгут поддоны. Кто-то включил музыку. Незнакомые люди делят одну шоколадку.',
    choices: [
      { label: 'Подойти', icon: 'hands', fx: { needs: { warmth: 18, nerves: 10, sleep: -4 }, time: 40, rumour: 'r_storage' }, out: '«Лучшее, что было за год»' },
      { label: 'Сидеть в машине', icon: 'car', fx: {}, out: '' },
    ] },
  { id: 'guitar', weight: 'light', icon: 'music', title: 'Гитара', npc: 'kirill', when: { night: true },
    text: 'Кирилл играет у костра. Поют даже те, кто весь день ругался.',
    choices: [
      { label: 'Подпевать', icon: 'music', fx: { needs: { nerves: 14 }, trust: { kirill: 10 }, time: 30 }, out: 'На секунду — как в походе' },
      { label: 'Дать 500 ₽', icon: 'wallet', fx: { money: { rub_cash: -500 }, trust: { kirill: 20 }, helped: 'Кирилл' }, out: '«Спасибо. Серьёзно»' },
    ] },
  { id: 'kirill_lift', weight: 'heavy', icon: 'walk', title: 'Возьмёте?', npc: 'kirill', when: { passengers: '<4', inCar: true },
    text: 'Кирилл, 20, с гитарой: «Две тысячи — всё, что есть. Довезите до КПП».',
    choices: [
      { label: 'Садись', icon: 'car', fx: { passenger: 'kirill', helped: 'Кирилл', trust: { kirill: 30 }, needs: { nerves: 4 } }, out: 'Гитара на заднем сиденье' },
      { label: 'За две тысячи', icon: 'wallet', fx: { passenger: 'kirill', money: { rub_cash: 2000 }, trust: { kirill: -5 }, got: ['2000 ₽ от студента'] }, out: 'Отдал последнее' },
      { label: 'Нет места', icon: 'close', fx: { trust: { kirill: -10 } }, out: 'Пошёл к следующей машине' },
    ] },
  // ——— продавцы и деньги ———
  { id: 'pie_price', weight: 'light', icon: 'food', title: 'Пирог дорожает', npc: 'zaur', when: { near: 'npc:zaur' },
    text: 'Два часа назад пирог был 300. Сейчас Заур пишет мелом 400. Очередь к нему — 20 человек.',
    choices: [
      { label: 'Взять · {price}', icon: 'food', fx: { buy: { good: 'pie' }, needs: { hunger: 45 }, got: ['горячий пирог'] }, out: 'Сдачу отсчитал честно, до рубля' },
      { label: 'Поторговаться', icon: 'chat', fx: { risk: { p: 0.5, fx: { trust: { zaur: -8 } }, out: '«Не нравится — иди»' }, buy: { good: 'pie', mul: 0.75 }, needs: { hunger: 45 } }, out: 'Уступил сотню' },
      { label: 'Мимо', icon: 'close', fx: {}, out: '' },
    ] },
  { id: 'skip_offer', weight: 'heavy', icon: 'wallet', title: '«В начало очереди»', npc: 'near', when: { rule: 'skipOffers', kpp: [3, 30], inCar: true },
    text: 'Кто-то наклоняется к твоему окну: «В объезд, по полям, до самого КПП. Деньги вперёд».',
    choices: [
      // цена по рыночной кривой 'bypass' (30–45 тыс.) была выше стартовых 28 000 наличными почти всегда
      // (content-graph 4.1: заблокирован 167/168) — торг (mul) делает цену иногда по карману, не меняя
      // саму исследованную цену объезда как таковую (это разовая скидка «сторговался», а не новый тариф)
      { label: 'Заплатить · {price}', icon: 'wallet', fx: { buy: { good: 'bypass', mul: 0.55 }, advance: 6, harmed: 'те, кого объехал', risk: { p: 0.35, fx: { buy: { good: 'bypass', mul: 0.55 } }, out: 'Он уехал с деньгами. Ты — на месте' } }, out: 'Трясло по грунтовке. Ты — ближе на 6 км' },
      { label: 'Стою как все', icon: 'car', fx: { needs: { nerves: 2 } }, out: 'Не такой ценой' },
      { label: 'Предупредить в чате', icon: 'chat', need: { need: { charge: '>=4' } }, fx: { needs: { charge: -3 }, msg: { chat: 'lars', text: 'На {km} км предлагают объезд за деньги вперёд. Осторожно' } }, out: '«Спасибо, брат»' },
    ] },
  { id: 'escort', weight: 'heavy', icon: 'siren', title: 'С мигалками', npc: 'near', when: { days: [25, 30], kpp: [4, 30], money: { usd: '>=500' }, inCar: true },
    text: '«Сопровождение до шлагбаума. Никто не остановит». Мимо уже проехала одна такая колонна.',
    choices: [
      // риск — как у skip_offer/bypass: 28.09 пятерых сотрудников ДПС отстранили за взятки (research/people.md:393),
      // так что «мигалки» не всегда настоящие. На неудаче — те же деньги, но без км и с худшим настроением
      // (никакого выигрыша); на удаче — как раньше, плюс явный след в итоге через harmed
      { label: 'Доллары · {price}', icon: 'dollar', fx: { buy: { good: 'escort', mul: 1 }, advance: 12, harmed: 'вся очередь', needs: { nerves: -4 },
          risk: { p: 0.35, fx: { buy: { good: 'escort', mul: 1 }, needs: { nerves: -10 }, gave: ['деньги за «мигалки» — развернули у обычного поста'] }, out: 'На повороте — обычный пост, не тот. Деньги ушли, ты — там же, где был' } },
        out: 'Все смотрели. Ты — не смотрел' },
      { label: 'Нет', icon: 'close', fx: {}, out: '' },
    ] },
  { id: 'moto', weight: 'heavy', icon: 'moto', title: 'Мотоцикл по обочине', npc: 'soslan', when: { rule: ['pedAllowed'], kpp: [2, 30] },
    text: 'Сослан: «Шестьдесят пять картой — брат переведёт. Через час-полтора у шлагбаума. Машину бросишь».',
    choices: [
      // было 20 000 ₽ и мгновенный конец (meaning.md: исследование 30–100 тыс. ₽). Теперь: цена по
      // исследованию, картой (наличных 28 000 не хватит — так и было бы структурно мёртвым выбором,
      // как skip_offer до фикса), час-полтора и холод обочины вместо 0, и свой риск — как у escort
      { label: 'Перевести · 65 000 ₽', icon: 'moto', need: { signal: true },
        fx: { money: { rub_card: -65000 }, gave: ['машина', '65 000 ₽'], needs: { warmth: -15, sleep: -5, nerves: -8 }, time: 90,
          risk: { p: 0.3, fx: { money: { rub_card: -65000 }, needs: { nerves: -12 }, time: 20, gave: ['65 000 ₽ — мотоцикл так и не пришёл'] }, out: 'Перевёл. Телефон молчит. На повороте — патруль, разворачивают' },
          end: { id: 'moto', title: 'Мимо очереди на мотоцикле', icon: 'moto' } },
        out: 'Ветер. Пыль. Обочина в 30 см от обрыва' },
      { label: 'Остаться', icon: 'car', fx: { trust: { soslan: 5 } }, out: '«Правильно. Своё — не бросай»' },
    ] },
  { id: 'exchange', weight: 'light', icon: 'dollar', title: 'Обмен с рук', npc: 'near', when: { money: { usd: '>=100' }, chance: 0.6 },
    text: '«Меняю доллары. По пятьдесят». В банке было шестьдесят.',
    choices: [
      { label: '$100 → 5000 ₽', icon: 'dollar', fx: { money: { usd: -100, rub_cash: 5000 } }, out: 'Наличные нужнее' },
      { label: 'Нет', icon: 'close', fx: {}, out: '' },
    ] },
  // ——— волонтёры и дом ———
  { id: 'volunteer', weight: 'light', icon: 'heart', title: 'Волонтёр', npc: 'madina', when: { days: [23, 30], chance: 0.8 },
    text: 'Мадина идёт вдоль ряда с чаем. На неё кричат: «Лезешь без очереди!»',
    choices: [
      { label: 'Заступиться', icon: 'shield', fx: { trust: { madina: 20 }, needs: { nerves: -2, warmth: 8, thirst: 12 }, helped: 'Мадина' }, out: '«Я не за кого-то. Просто чай»' },
      { label: 'Взять чай', icon: 'cup', fx: { needs: { warmth: 12, thirst: 15 }, got: ['чай от волонтёров'] }, out: 'Горячий' },
      { label: 'Дать 1000 на еду', icon: 'wallet', fx: { money: { rub_cash: -1000 }, trust: { madina: 15 }, helped: 'волонтёры' }, out: 'Записала на коробке' },
    ] },
  { id: 'medic', weight: 'light', icon: 'meds', title: 'Медик', npc: 'alan', when: { days: [26, 30], kpp: [0, 6] },
    text: 'Алан с рюкзаком: «Кому плохо? Дети первыми». У тебя третьи сутки болит голова.',
    choices: [
      { label: 'Попросить таблетку', icon: 'meds', fx: { needs: { nerves: 5, sleep: 3 }, got: ['таблетка'], trust: { alan: 2 } }, out: '«Воды пей больше»' },
      { label: 'Отдать воду для детей', icon: 'water', need: { item: { water: '>=1' } }, fx: { items: { water: -1 }, helped: 'дети у КПП', trust: { alan: 15 } }, out: 'Он даже не остановился' },
    ] },
  { id: 'sister', weight: 'heavy', icon: 'call', title: 'Звонок', when: { need: { charge: '>=6' }, days: [26, 30] },
    text: 'Двоюродная сестра: «Лучше мёртвый брат, чем предатель». Гудки.',
    choices: [
      { label: 'Перезвонить', icon: 'call', fx: { needs: { charge: -6, nerves: -8 }, time: 10 }, out: 'Не взяла' },
      { label: 'Написать маме', icon: 'heart', fx: { needs: { charge: -2, nerves: 4 } }, out: '«Не слушай никого. Ешь»' },
      { label: 'Выключить звук', icon: 'close', fx: { needs: { nerves: -4 } }, out: '' },
    ] },
  { id: 'megaphone', weight: 'heavy', icon: 'horn', title: 'Рупор', when: { kpp: [0, 4] },
    text: 'Из рупора патрульной машины: «Трусы!». Через минуту продавщица молча отдаёт сдачу женщине с ребёнком.',
    choices: [
      { label: 'Промолчать', icon: 'close', fx: { needs: { nerves: -5 } }, out: 'Две правды в одной минуте' },
      { label: 'Включить музыку', icon: 'music', need: { need: { charge: '>=3' } }, fx: { needs: { nerves: 3, charge: -2 } }, out: 'Соседи подпели' },
    ] },
  { id: 'cat', weight: 'light', icon: 'paw', title: 'Потерялся кот', when: { chance: 0.6 },
    text: 'В чате: «Рыжий кот, выскочил у моста». Фото — кот в переноске, ещё дома.',
    choices: [
      { label: 'Поискать', icon: 'search', fx: { time: 30, needs: { nerves: 3, sleep: -3 }, helped: 'хозяйка кота' }, out: 'Не нашёл. Позже в чате: «Нашёлся в Элисте» 😅' },
      { label: 'Репост', icon: 'chat', need: { need: { charge: '>=2' } }, fx: { needs: { charge: -1 } }, out: '' },
    ] },
  { id: 'toilet', weight: 'light', icon: 'house', title: 'Туалет', when: { chance: 0.7, need: { thirst: '>40' } },
    text: 'Ближайший туалет — за два километра. Говорят, бабушка в Чми пускает за 100 ₽. Или — река.',
    choices: [
      { label: 'Идти 2 км', icon: 'walk', fx: { time: 50, needs: { sleep: -4 }, money: { rub_cash: -100 } }, out: 'Очередь там — как тут' },
      { label: 'К реке', icon: 'water', fx: { needs: { nerves: -3 } }, out: 'Терек шумит и всё прощает' },
    ] },
  { id: 'dog_question', weight: 'heavy', icon: 'doc', title: '«А военник есть?»', forced: true, when: { kpp: [0, 0.12] },
    text: 'Окошко. Пограничник листает паспорт: «Цель поездки? Служил?»',
    choices: [
      { label: 'Туризм. Не служил', icon: 'doc', fx: { needs: { nerves: -8 }, time: 20 }, out: '«Всё, я тебя вылечил. Поздравляю». Штамп' },
      { label: 'Молча протянуть бумаги', icon: 'hands', fx: { needs: { nerves: -4 }, time: 40 }, out: 'Сорок минут в стороне. Штамп' },
    ] },
  // ——— по живым чатам 27–28.09 (docs/research/chat/2022-d_27-28.md, §7) ———
  { id: 'forward_wave', weight: 'heavy', icon: 'phone', title: '«Правда?»', when: { days: [26, 29], need: { charge: '>=3' } }, once: false, cooldown: 16,
    text: 'В чат летит форвард: «Через час закрывают совсем». Двадцать человек уже вышли из машин.',
    choices: [
      { label: 'Ждать очевидца', icon: 'clock', fx: { needs: { nerves: -3 }, time: 40 }, out: '«Только что прошёл. Всё открыто». Выдох' },
      { label: 'Переслать дальше', icon: 'chat', fx: { needs: { charge: -2, nerves: -6 }, harmed: 'чат', msg: { chat: 'lars', text: 'Говорят, через час закрывают!!' } }, out: 'Паника пошла по ряду' },
      { label: 'Написать: «не паникуем»', icon: 'heart', fx: { needs: { charge: -2, nerves: 2 }, helped: 'соседи по чату', msg: { chat: 'lars', text: 'Не паникуем. Ждём очевидцев.' } }, out: '«Спасибо, вы вселяете надежду» ♥' },
    ] },
  { id: 'human_chain', weight: 'light', icon: 'people', title: 'Живой заслон', when: { days: [27, 29], hours: [17, 23] },
    text: 'По встречке снова лезут. Мужчины выходят из машин и встают цепью поперёк полосы.',
    choices: [
      { label: 'Встать в цепь', icon: 'hands', fx: { needs: { warmth: -8, sleep: -6, nerves: 5 }, trust: { lekha: 12 }, helped: 'весь ряд', time: 60 }, out: 'Час в цепи. Задних больше никто не подрезает' },
      { label: 'Сидеть в машине', icon: 'car', fx: { trust: { lekha: -4 } }, out: '' },
    ] },
  { id: 'scam_escort', weight: 'light', icon: 'siren', title: '«ГАИ с мигалками»', when: { rule: 'skipOffers', need: { charge: '>=3' } },
    text: 'В личку: «Сопровождение до КПП, 30 000. Переведите половину вперёд, иначе место уйдёт».',
    choices: [
      // перевод картой — то же самое действие, что и в лавке (economy.js payOptions): без сети телефон
      // его просто не отправит, мошеннический перевод не должен проходить там, где легальный блокируется
      { label: 'Перевести 15 000', icon: 'card', need: { signal: true }, fx: { money: { rub_card: -15000 }, gave: ['15 000 ₽ мошеннику'], needs: { nerves: -10 } }, out: 'Номер заблокировал. Ничего не пришло' },
      { label: 'Это развод', icon: 'shield', fx: { needs: { nerves: 3 }, msg: { chat: 'lars', text: 'Осторожно: «ГАИ с мигалками» за предоплату — развод' }, helped: 'чат' }, out: 'Под сообщением — 60 ♥' },
    ] },
];
return { EVENTS };
});
