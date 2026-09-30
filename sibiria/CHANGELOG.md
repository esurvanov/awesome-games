# Changelog · История версий

## v1.2.0 — 30.09.2026

A photographic look, a body with weight, and a world that answers back. Play in the browser: https://www.urvanov.com/sibiria/

Фотографичная картинка, тело с весом и мир, который отвечает. Играть в браузере: https://www.urvanov.com/sibiria/

### Picture · Картинка
- Snow lit by a low sun (drifts, sastrugi), CC0 snow and needle grain, soft silhouette shadows, ragged spruces with clumped snow and trunk wells, film grade, mist, grain · Снег при низком солнце (надувы, заструги), CC0-фактура снега и хвои, мягкие тени по силуэту, рваные ёлки с комьями снега и воронками у стволов, плёночная коррекция, дымка, зерно
- Zoom up to 4× with sprites and snow baked per zoom step; storm and snowfall particles stay soft at any zoom · Приближение до 4× со ступенчатой выпечкой спрайтов и снега; снегопад и пурга мягкие на любом зуме
- Photo textures: Poly Haven (CC0), see CREDITS · Фото-текстуры: Poly Haven (CC0), см. CREDITS

### Hero and people · Герой и люди
- New hero: bright polar explorer with a real face; proportions of a grown man, tapered limbs, distinct sleeves and mitts · Новый герой: яркий полярник с настоящим лицом; пропорции взрослого человека, сужающиеся конечности, заметные рукава и варежки
- Motion without snaps: arms no longer spin 360°, poses blend without jumps, feet are planted and do not slide, turns go through the camera · Движение без рывков: руки не крутятся на 360°, позы смешиваются без скачков, стопы закреплены и не скользят, повороты идут через камеру
- Weight and inertia: lean on acceleration, pack and hood lag behind, breath and steam in sync, fatigue and cold change the gait · Вес и инерция: наклон при разгоне, рюкзак и капюшон отстают, дыхание и пар синхронны, усталость и холод меняют походку
- Conversations are staged in the world: camera leans in, people face each other, bubbles, mouth and gestures by meaning, emotions, items handed from hand to hand · Разговоры разыграны в мире: камера подъезжает, люди лицом друг к другу, облачка, рот и жесты по смыслу, эмоции, вещи передаются из рук в руки

### World · Мир
- One wind for everything (direction drifts, gusts, forest shelter); a living wreck: pennant, blade, wires, door, notes · Один ветер на всё (направление меняется, порывы, укрытие леса); живые обломки: вымпел, лопасть, провода, дверь, записки
- Snow caps on things, lee drifts, blown tracks, ground blizzard · Шапки снега на вещах, подветренные наддувы, заметаемые следы, позёмка
- Snow depth: knee, waist, chest; trenches; snowshoes; animals sink by their own rules; a full fall through the ice and climb out · Глубина снега: по колено, пояс, грудь; траншеи; снегоступы; звери вязнут по своим правилам; полный провал под лёд и выбирание
- Footprint table: no walking through the wreck, houses, barrels or furniture; people and animals push each other apart · Таблица подножий: нельзя пройти сквозь вертолёт, дома, бочки и мебель; люди и звери расталкиваются
- Actions take time and leave traces: read a note in hands, eat from a can, craft with progress, walk to bed, felled tree is limbed and bucked into logs · Действия занимают время и оставляют след: записка читается в руках, еда из банки, крафт с прогрессом, сон пешком к лежанке, срубленная ель обрубается и разделывается на чурки
- Context-aware remarks, sound by place, animals react to weather, varied forest edge, hares of real size · Реплики по обстановке, звук с местом, звери по погоде, разный край леса, зайцы реального размера

### Under the hood · Внутри
- Interaction passport (docs/design/INTERACTION-PASSPORT.md), new tests: passport, collisions, context, variety, snow depth · Паспорт взаимодействий и новые тесты: паспорт, столкновения, контекст, разнообразие, глубина снега
- Older saves load; only the world-edge trees differ · Старые сохранения загружаются; отличается только край леса

### Known limits · Известные ограничения
- Legs still look wooden when walking straight toward or away from the camera; deer and other animals turn like cardboard; trees are still flat sprites; the wreck is taken apart the same way everywhere; dragging logs and the backpack volume are not modelled yet · Ноги при ходьбе прямо на камеру и от неё всё ещё деревянные; олени и другие звери поворачиваются как картонка; деревья всё ещё плоские спрайты; обломки везде разбираются одинаково; переноска брёвен и объём рюкзака пока не смоделированы
- Reference screenshots of the visual test are outdated and are not part of the release checks; the zone speed check can fail on a loaded machine · Эталонные кадры визуального теста устарели и не входят в проверки релиза; проверка скорости зон может падать на загруженной машине
- Long bot runs die of hunger or cold more often now that snow is deep · В длинных прогонах бот чаще гибнет от голода и холода: снег стал глубоким

## v1.1.0 — 27.09.2026

A living world and a living hero. Play in the browser: https://www.urvanov.com/sibiria/

Живой мир и живой герой. Играть в браузере: https://www.urvanov.com/sibiria/

### Hero · Герой
- Drawn in a 3/4 view with form light and shade instead of a flat profile; turns through the camera, not by squashing · Вид на три четверти со светотенью вместо плоского профиля; разворот через лицо к камере, а не сплющиванием
- 39 poses: fidgets by situation (stamps from cold, rubs and blows into mitts, adjusts the pack, looks around, yawns, shivers), walks for deep snow, blizzard, cold and fatigue, reactions (slips, flinches at a howl, staggers after a hard bump) · 39 поз: возня по ситуации (переминается от холода, трёт и греет руки, поправляет рюкзак, оглядывается, зевает, дрожит), походки по сугробам, в пургу, на морозе и от усталости, реакции (поскальзывается, вздрагивает от воя, отшатывается от удара)
- Works facing the object — back to the camera when it is above, face when below; chopping differs when tired, frozen or in a blizzard; the wreck is torn apart by hand, not with an axe · Работает лицом к предмету — спиной к камере, если предмет выше, лицом, если ниже; рубит по-разному усталым, замёрзшим и в пургу; обломки разбирает руками, а не топором
- One body state machine: no running after an action, no sliding in a pose when you press a key; 198 state × event pairs checked automatically · Один «хозяин тела»: нет бега после действия и скольжения в позе при нажатии; 198 сочетаний «состояние × событие» проверяются автоматически

### New actions · Новые действия
- `E` / hold `E` / `X`: shake a tree, kick a drift, warm hands at a fire or the stove, bury a campfire with snow, read tracks, sit on a stump, pet or call the laika, throw a stick · `E` / долгое `E` / `X`: трясти дерево, пнуть сугроб, греть руки у костра и печи, засыпать костёр снегом, читать следы, сесть на пень, погладить или позвать лайку, бросить палку

### World · Мир
- One interaction module: things have properties, events have rules — walls slide you along with a thud and snow off the roof, axe blows shake snow off branches and scare ravens, a felled tree falls and lies in the snow · Единый модуль взаимодействий: у вещей свойства, у событий правила — вдоль стен скользишь с глухим звуком и снегом с крыши, от топора с веток сыплется снег и взлетают вороны, срубленное дерево падает и лежит в снегу
- Speech bubbles: the hero, Vera, Urkachan, zone people and settlers talk about cold, wolves, work and each other; the laika barks · Реплики над головой: герой, Вера, Уркачан, люди зон и поселенцы говорят про холод, волков, работу и друг с другом; лайка лает
- Living forest: gusts roll across the taiga, crowns bend while trunks stand, snow falls from branches; lit and shaded sides on trees and people · Живой лес: порывы бегут по тайге, крона гнётся, ствол стоит, снег осыпается с веток; светлая и теневая сторона у деревьев и людей
- Deep snow near drifts slows you and leaves deeper prints; smoke and breath stretch with the wind in a blizzard · В сугробах шаг медленнее, следы глубже; дым и пар вытягивает ветром в пургу
- Dialogs and panels no longer freeze the world: people keep moving while game time stays paused · Диалоги и окна больше не замораживают мир: люди двигаются, а игровое время стоит

### Known limits · Известные ограничения
- New poses and actions were tuned by eye in the browser; no full human playthrough of v1.1 yet · Новые позы и действия выверены на глаз в браузере; полного прохождения v1.1 человеком ещё не было
- Shaking a tree has no touch gesture yet; a torch disappears during two-handed poses · Трясти дерево на телефоне пока нечем; в двуручных позах пропадает факел

## v1.0.0 — 26.09.2026

First release of **Sibiria** — survival and settlement in the Evenki taiga, January 1993.
Play in the browser: https://esurvanov.github.io/awesome-games/sibiria/

Первый релиз **«Сибири»** — выживание и посёлок в эвенкийской тайге, январь 1993.
Играть в браузере: https://esurvanov.github.io/awesome-games/sibiria/

### World · Мир
- ~11 × 11 km of taiga around the crash site, generated from a seed · ~11 × 11 км тайги вокруг места крушения, генерация от зерна
- 8 zones, each changing a rule of play: aufeis, burnt forest, boulder field, bald peak, drill site, Kerbo-2 weather station, winter road, Evenki camp · 8 зон, каждая меняет правило игры: наледь, гарь, курумник, голец, буровая, метеостанция «Кербо-2», зимник, стойбище
- Skis, reindeer sledge, repaired «Buran», fast travel between explored zones; full-screen geological map (`M`) · Лыжи, оленья упряжка, починенный «Буран», быстрые переходы; большая карта-схема (`M`)
- Forest regrows; caches in the field (`T`) · Лес отрастает; тайники в поле (`T`)

### Story · Сюжет
- 7 chapters, 5 endings: everyone home, alone, the taiga takes you, a new settlement, the Kerbo-2 expedition · 7 глав, 5 концовок: все домой, один, тайга приняла, новый посёлок, экспедиция на «Кербо-2»
- 11 characters with dialogue, trade and 15 tasks · 11 жителей с диалогами, торговлей и 15 заданиями
- A hunting wolf pack and a rogue bear; real cold, hunger, frostbite and blizzards · Стая волков и шатун; настоящий холод, голод, обморожение и пурга

### Settlement · Посёлок
- Hire settlers, 8 kinds of buildings, 4 ages, workshop upgrades, a market with 1993 inflation, alarm bell, watchtowers · Поселенцы, 8 видов зданий, 4 эпохи, улучшения, фактория с инфляцией 1993 года, набат, вышки

### Play · Игра
- RTS-style control: box select, right-click orders, groups, context cursors, zoom · Управление как в RTS: рамка, приказы правой кнопкой, группы, курсоры по цели, масштаб
- One design system («painted metal» + «paper»), 99 icons · Единая дизайн-система («жесть» + «бумага»), 99 иконок
- Jointed characters and animals, dynamic light, shadows by the sun, northern lights · Суставные люди и звери, динамический свет, тени по солнцу, северное сияние
- All sound synthesised, adaptive score · Весь звук синтезируется, музыка следует за угрозой
- Phone support: joystick, order mode, pinch zoom, quality auto-tuning · Телефон: джойстик, режим приказов, щипок, автонастройка качества
- 3 save slots + autosave · 3 ячейки сохранений и автосохранение

### Quality · Качество
- 16 automated checks in a real browser: story through all endings, real mouse and touch input, save/load round-trip, no overlapping UI on 4 screen sizes, 16-scene pixel comparison, bot playthroughs · 16 автопроверок в настоящем браузере

### Known limits · Известные ограничения
- Balance was tuned with a bot; no full human playthrough yet · Баланс настроен ботом; полного прохождения человеком ещё не было
- Sound levels were measured, not yet reviewed by ear · Громкость звука выверена замерами, на слух не проверялась
