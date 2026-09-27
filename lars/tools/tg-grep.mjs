// Раскладывает обезличенные сообщения (после tg-extract.mjs) по темам для исследования кейсов.
//
//   node tools/tg-grep.mjs [папка, по умолчанию .cache/tg] [сколько лучших на тему, по умолчанию 400]
//
// Выход: <папка>/cat/<тема>.jsonl — все совпадения; <папка>/cat/<тема>.top.txt — лучшие
// (длинные рассказы от первого лица и с реакциями выше); <папка>/summary.md — таблица тем по месяцам.
import { createReadStream, mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';

const [dir = '.cache/tg', TOP = 400] = process.argv.slice(2);

// Темы: имя → [значок, подпись, регулярка по тексту в нижнем регистре]
export const TOPICS = {
  y2022:    ['📅', 'Воспоминания о 2022', /(2022|в 22[- ]?м?\s*год|двадцать втор|мобилизац|частичн\w* мобил|повестк)/],
  queue:    ['🚗', 'Очередь, сколько стоим', /(очеред|стоим|стояли|пробк|сколько машин|км до|километр\w* до|не двига|движется|ползем|ползём)/],
  refuse:   ['🚫', 'Отказ, развернули', /(отказ\w* во въезд|отказали|развернул|не пустил|не пропуст|запрет\w* на въезд|депорт|ограничен\w* выезд|невыездн)/],
  guard:    ['🛂', 'Пограничники, досмотр', /(погранич|досмотр|допрос|собеседован|фсб|проверял\w* телефон|смотрел\w* телефон|листал|вопрос\w* задава|отдельн\w* комнат|опер\w*)/],
  family:   ['👨‍👩‍👧', 'Дети, семья', /(ребен|ребён|дет[иейь]|малыш|беремен|с мамой|с женой|с мужем|бабушк|дедушк|родител)/],
  pets:     ['🐈', 'Животные', /(кот[аиу ]|кошк|собак|пёс|пес[ ,.]|животн|ветпаспорт|переноск)/],
  help:     ['🤝', 'Помощь, доброта', /(помогл|помог[ ,.!]|бесплатно|накормил|угостил|волонт|добр\w* люд|спасибо огромн|выручил|подвезл|подвез[ ,.]|приютил)/],
  bad:      ['😣', 'Обман, конфликты', /(мошен|развод[ия ]|кинул|обман|вымога|взятк|без очереди|лезут|влезл|наглы|драк|хамств|хамил)/],
  money:    ['💰', 'Цены и деньги', /(\d+\s*(лари|gel|₾|руб|р\.|₽|\$|доллар|евро|€)|обмен\w* валют|курс\w* лари|за место|сколько стоит)/],
  car:      ['🚙', 'Машина, документы', /(страховк|доверенност|техпаспорт|стс|птс|растаможк|сломал\w* машин|эвакуатор|бензин|заправк|шин[ауы ]|аккумулятор)/],
  foot:     ['🚲', 'Пешком, автобус, такси', /(пешком|пешеход|велосипед|самокат|автобус|маршрутк|такси|таксист|попутк|подсад)/],
  road:     ['🏔', 'Дорога закрыта, погода', /(закрыт\w* (дорог|трасс|граница|перевал|ларс)|перевал|лавин|снегопад|сн[её]г|туман|гололед|гололёд|цеп[ие]|камнепад|сель)/],
  body:     ['🥶', 'Холод, еда, туалет, сон', /(туалет|холодн|замерз|мёрзн|мерзн|спали в машин|ночь в машин|ночевал|голодн|нет воды|вода есть|кушать|поесть)/],
  feel:     ['😭', 'Эмоции', /(страшно|боюсь|плак|сл[её]з|нервы|нервн|паник|трясет|трясёт|счастлив|наконец-?то|выдохнул|ура[! ]|господи|отчаян|ужас)/],
  through:  ['✅', 'Прошли, как это было', /(прошли границ|прошел границ|прошёл границ|прошла границ|мы прошли|я прошел|я прошёл|я прошла|пересекл|перешл[иа])/],
  rumour:   ['💬', 'Слухи', /(говорят что|говорят,|слышал\w* что|слух|правда что|правда ли|кто-нибудь знает|кто знает|вроде бы|якобы)/],
};

// «Рассказ»: длинно, от первого лица, прошедшее время.
const STORY = /(^|\s)(я|мы|нас|меня|мне)\s/;
const PAST = /(ли|ла|л)\s/;
const score = m => (m.re || 0) * 40 + Math.min(m.t.length, 1500) + (m.t.length > 300 && STORY.test(m.t.toLowerCase()) && PAST.test(m.t) ? 800 : 0);

mkdirSync(`${dir}/cat`, { recursive: true });
const outs = {}, tops = {}, byMonth = {};
for (const k of Object.keys(TOPICS)) { outs[k] = createWriteStream(`${dir}/cat/${k}.jsonl`); tops[k] = []; byMonth[k] = {}; }
tops.story = []; outs.story = createWriteStream(`${dir}/cat/story.jsonl`); byMonth.story = {};

const push = (k, m) => {
  outs[k].write(JSON.stringify(m) + '\n');
  const mon = m.d.slice(0, 7); byMonth[k][mon] = (byMonth[k][mon] || 0) + 1;
  const s = score(m), t = tops[k];
  if (t.length < TOP) { t.push([s, m]); if (t.length === TOP) t.sort((a, b) => a[0] - b[0]); }
  else if (s > t[0][0]) { t[0] = [s, m]; t.sort((a, b) => a[0] - b[0]); }
};

let n = 0;
const rl = createInterface({ input: createReadStream(`${dir}/messages.jsonl`, 'utf8'), crlfDelay: Infinity });
for await (const line of rl) {
  const m = JSON.parse(line); n++;
  if (m.t.length < 25) continue;
  const low = m.t.toLowerCase();
  for (const [k, [, , re]] of Object.entries(TOPICS)) if (re.test(low)) push(k, m);
  if (m.t.length > 400 && STORY.test(low) && PAST.test(m.t)) push('story', m);
}
for (const o of Object.values(outs)) o.end();

for (const [k, t] of Object.entries(tops)) {
  t.sort((a, b) => b[0] - a[0]);
  writeFileSync(`${dir}/cat/${k}.top.txt`, t.map(([, m]) => `#${m.id} ${m.d.slice(0, 16)}${m.re ? ' ♥' + m.re : ''}\n${m.t}\n`).join('\n'));
}

const mons = [...new Set(Object.values(byMonth).flatMap(Object.keys))].sort();
const label = k => k === 'story' ? '📖 Длинные рассказы' : `${TOPICS[k][0]} ${TOPICS[k][1]}`;
const rows = Object.keys(byMonth).map(k => {
  const total = Object.values(byMonth[k]).reduce((a, b) => a + b, 0);
  return `| ${label(k)} | ${total} | ${mons.map(mm => byMonth[k][mm] || '').join(' | ')} |`;
});
writeFileSync(`${dir}/summary.md`, `Сообщений: ${n}\n\n| Тема | Всего | ${mons.join(' | ')} |\n|---|---|${mons.map(() => '---').join('|')}|\n${rows.join('\n')}\n`);
console.log(`сообщений: ${n}`);
for (const k of Object.keys(byMonth)) console.log(label(k).padEnd(32), String(Object.values(byMonth[k]).reduce((a, b) => a + b, 0)).padStart(7));
