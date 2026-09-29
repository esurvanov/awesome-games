# Сходка — договор между частями

Игра: один субботний вечер в SushiGO (Батуми), 19:00 → 01:00, ~18 минут реального времени.
Играешь участником чата Batumi IT Offline Hangouts. Цель — познакомиться и подружиться с как можно большим
числом людей и сводить их между собой (нетворкинг). 3D-зал должен быть **узнаваем** для тех, кто там был.

Открывается двойным щелчком по `index.html`: без сборки,
без сервера, без ES-модулей (file:// их не грузит). Всё — обычные `<script>` с реестром `L` (`js/l.js`).
Слабые машины и телефоны: 30+ кадров на встроенной графике, без теней в реальном времени по умолчанию.
Эмоции без политики. Реальных участников чата в игре нет — только собирательные образы; имена вымышлены.
Весь текст для игрока — по-русски, коротко (подписи 2–4 слова, иконки, шкалы; без абзацев).

## Файлы и хозяева

| Часть | Файлы | Хозяин |
|---|---|---|
| Реестр, ядро | `js/l.js`, `js/core.js`, `js/manifest.js`, `index.html` (оболочка) | общий, правки точечные |
| 3D-движок | `js/vendor/three.min.js` (r158, UMD, глобальный `THREE`) | не трогать |
| План зала | `js/content/layout.js` | сцена (числа), схема — договор |
| Зал | `js/render/scene.js`, `js/render/textures.js`, `js/render/props.js`, `js/render/camera.js`, `js/render/quality.js` | агент «сцена» |
| Люди в 3D | `js/render/people.js`, `js/render/looks.js` | агент «люди» |
| Содержание | `js/content/*.js` кроме layout, `docs/scenario.md` | агент «сценарий» |
| Симуляция | `js/sim/*.js`, `tests/sim.js` | агент «симуляция» |
| Интерфейс | `js/ui/*.js`, `css/ui.css` | агент «интерфейс» |
| Сборка | `js/main.js`, `tests/smoke.js`, `tests/shots.js`, `tests/perf.js` | сборка (после всех) |

Каждая часть добавляет свои файлы в **свою секцию** `js/manifest.js` и больше в чужие секции не пишет.
Отладочные страницы — `dev/<часть>.html` (свои, можно любые).

## Реестр

```js
L.def('render/scene', () => { const { clamp } = L.use('core'); …; return { Scene }; });
```
Тело выполняется при первом `L.use`. Файлы `content/`, `sim/`, `core` не трогают DOM и `THREE` —
они грузятся и в Node (`tests/load.js`).

## Координаты

Метры, Y вверх. X — поперёк зала, Z — вглубь (0 = стеклянный фасад, Z<0 — веранда и улица).
Угол `face`/`rot`: 0 смотрит в +Z, π/2 — в +X. Высоты: сиденье 0.45, стол 0.75, барная стойка 1.1,
барный стул 0.75, сцена-подиум 0.25, рост людей 1.55–1.95. Зал — прямоугольник 10 × 13.5 м (кухня за левой стеной).

## Время

`hour` — часы вечера: 19.0 … 25.0 (25 = 01:00). Масштаб по умолчанию: 1 игровой час ≈ 3 реальные минуты
(`TUNING.time.realSecPerHour = 180`), разговор идёт в реальном времени, но часы при этом не стоят.

## API частей

### render/scene — зал
```js
const { Scene } = L.use('render/scene');
const sc = new Scene(canvas, { quality });   // строит зал из LAYOUT
sc.scene, sc.camera, sc.renderer             // THREE-объекты (люди добавляются в sc.scene)
sc.setHour(h)                                // свет: закат в окнах → вечер → ночь; неон, гирлянды
sc.setEffect(id, on)                         // 'strobe' | 'rain' | 'football' | 'sax' | 'birthday' | 'garland' | 'smell' | 'karaoke'
sc.pick(clientX, clientY) → { kind:'person', id } | { kind:'floor', x, z } | { kind:'seat', id } | null
sc.focus({ x, z } | null)                    // камера плавно наезжает на разговор / возвращается
sc.follow({ x, z })                          // куда смотрит камера по умолчанию (игрок)
sc.toScreen(x, y, z) → { x, y, visible }     // для подписей над головами
sc.render(dt)                                // один кадр
sc.resize()
```
Камера: вид сверху-сбоку, вдоль длинной стены; колесо/щипок — масштаб; тянуть — поворот/сдвиг в пределах зала.

### render/people — люди
```js
const { People } = L.use('render/people');
const pp = new People(sc.scene);
pp.add(id, look)                             // look — см. render/looks
pp.set(id, { x, z, y?, rot, pose, mood, speaking, prop })   // y — высота пола (подиум сцены), по умолчанию 0   // pose: 'stand'|'walk'|'sit'|'sitSofa'|'talk'|'laugh'|'phone'|'drink'|'photo'|'sing'|'wave'|'leave'
pp.remove(id)
pp.update(dt)                                // анимации, плавное движение к последней позиции
pp.pickables                                 // меши с userData.personId (для sc.pick)
pp.highlight(id | null, kind)                // 'hover' | 'talk' | 'known'
```
```js
const { makeLook } = L.use('render/looks');
makeLook(rng, hints) → look    // hints: { sex, age, style:'it'|'smart'|'sport'|'party', prop, oddball }
```

### sim — вечер
```js
const { World } = L.use('sim/world');
const w = new World(CONTENT, { seed, profile });   // profile — анкета игрока (см. ниже)
w.step(dt)                                  // реальные секунды
w.hour, w.over, w.player, w.people (Map id→npc), w.groups, w.events, w.score
w.act(a)          // { type:'walk', x, z } | { type:'approach', id } | { type:'say', card } |
                  // { type:'introduce', a, b } | { type:'endTalk' } | { type:'order', item } |
                  // { type:'sit', seat } | { type:'photo' } | { type:'reply', msg, option }
w.bus.on(type, f) // 'talk:start' {id} · 'talk:line' {who, text, mood} · 'talk:cards' {cards[]} · 'talk:end' {id, result}
                  // 'reveal' {id, field} · 'ladder' {id, step} · 'pair' {a, b} · 'chat' {msg} · 'event' {id, on}
                  // 'energy' {v} · 'toast' {icon, text} · 'arrive' {id} · 'leave' {id} · 'end' {summary}
w.view()          // снимок для отрисовки: [{ id, x, z, rot, pose, mood, speaking, look, prop, known }]
```
NPC (`w.people.get(id)`): `{ id, name, age, look, role, mind, mood, archetype, oddball, need, offer, topics[],
traits{social,open,trust,pace,group}, energy, rapport, step, known{…}, x, z, rot, pose, state, group, seat,
arrive, leave }`. `step` — ступень знакомства 0..5: видел, поздоровался, поговорили, общая тема, контакт, договорились.

Анкета игрока (`profile`): `{ name, look, role, topics[3], need, offer }`.

### ui
```js
const { Ui } = L.use('ui/ui');
const ui = new Ui(root, { world, scene, people });   // подписывается на world.bus, рисует HUD, разговор, телефон, итог
ui.showTitle(onStart) · ui.showProfile(onDone) · ui.update(dt)
```

## Содержание (js/content) — схемы

`CONTENT = L.use('content/index').CONTENT` собирает всё ниже.

- `ROLES[]` — работа: `{ id, title, icon, weight, topics[], needs[], offers[], look:{style} }`
- `MINDS[]` — склад характера: `{ id, title, icon, weight, likes[], dislikes[], talk }`
  `likes/dislikes` ⊂ стили карт: `ask | share | listen | joke | facts | help | argue | dream | praise | wait | invite | treat`
- `MOODS[]` — настроение на вечер: `{ id, title, icon, weight, energy, leaveShift, likeTopics[], hateTopics[], likes[], dislikes[] }`
- `ARCHETYPES[]` — поведение в зале: `{ id, title, icon, weight, arrive:[h0,h1], stay:[h0,h1], zones[], group:[min,max], traits:{…}, tell }`
  (`tell` — как узнать: поза/место/первая реплика)
- `ODDBALLS[]` — чудики: `{ id, title, icon, catch, prop, look, arrive, event, befriend:{ likes[] }, lines[] }` (1–2 за вечер)
- `NEEDS[]` — `{ id, seek:{title,icon}, offer:{title,icon} }` — пары «ищет ↔ предлагает»
- `TOPICS[]` — `{ id, title, icon, weight }`
- `CARDS[]` — ходы игрока в разговоре: `{ id, style, icon, label, topic?, when? }` (label 2–4 слова)
- `LINES` — реплики людей: `LINES[topic|style][reaction]` → строки с `{name} {job} {topic}`; reaction: `good | bad | meh | open | reveal | leave | hello | contact | deal`
- `EVENTS[]` — `{ id, title, icon, at:[h0,h1], chance, effect, scene }` (scene → `sc.setEffect`)
  `effect.stage {x,z,r,y,face}` — место музыканта (sax, karaoke): одно на симуляцию (места рядом заняты), сцену (свет) и сборку (фигура);
  оба стоят на сцене `LAYOUT.stage` (подиум у бара): `y` — высота подиума, `face` — лицом в зал;
  `effect.huddle` — кучка у колонки поёт, `leave {share, at:'end'}` — потом уходят; итог: «на фото» = сколько людей в кадре снимка,
  фото не было — снимок «Конец вечера» и «фото не было»
- `CHAT` — сообщения в телефоне: до встречи, «где вы?», после (с плейсхолдерами)
- `NAMES` — вымышленные имена/фамилии по полу
- `TUNING` — числа баланса (время, силы, пороги доверия, очки); силы, симпатия, пороги, цены карт — в шкале 0..1
- `LAYOUT` — план зала (см. шапку layout.js): прямоугольный зал `hall` (+ коридорчик в туалет), стойка дугой `bar`,
  сцена `stage`, туалет `wc`; блок может нести точный `poly` (ходьба берёт его). Стоячие места `kind:'wc'` — только для
  коротких отлучек (sim/brain: редкий поход к двери WC и назад), своим местом их не выбирают
