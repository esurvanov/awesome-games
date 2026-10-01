import sys, os, re, json; sys.path.insert(0, '.')
from svgs import flow, seq, standalone
OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
NAMES = ['c4-context', 'c4-containers', 'c3-world', 'c3-survival', 'c3-colony', 'c3-story', 'c3-render', 'seq-frame', 'seq-night', 'seq-story', 'seq-save']
_n = [0]; _lang = ['ru']
def fig(svg, caption):
    name = NAMES[_n[0]]; _n[0] += 1
    d = f'{OUT}/diagrams/{_lang[0]}'; os.makedirs(d, exist_ok=True)
    open(f'{d}/{name}.svg', 'w').write(standalone(svg, name))
    alt = re.search(r'aria-label="([^"]*)"', svg).group(1)
    return f'![{alt}](diagrams/{_lang[0]}/{name}.svg "{caption}")'

def H2(i, t): return f'## {t}'
def H3(t): return f'### {t}'

def build(L):
    r = (L == 'ru'); t = lambda ru, en: ru if r else en
    P = []
    P.append(t(
      '«Сибирь» — игра на выживание в тайге, вид сверху, прямо в браузере: без движка, без сборки, около пятидесяти скриптов на холсте 2D. Здесь описано, как она устроена: контексты, схемы C4 до уровня компонентов и четыре пути, на которых всё держится.',
      '“Sibiria” is a top-down taiga survival game in the browser: no engine, no build step, about fifty scripts drawing on a 2D canvas. This is how it is put together: the contexts, C4 diagrams down to the component level and the four paths everything rests on.'))
    # ---- contexts
    P.append(H2('contexts', t('Контексты игры', 'The contexts of the game')))
    rows = [
      (t('Мир', 'World'), 'world, zones, depth, ice, wind, snow, live', t('лес, зоны, глубина снега, лёд, ветер, живые вещи', 'forest, zones, snow depth, ice, wind, living things')),
      (t('Герой и выживание', 'Hero and survival'), 'hero, survival, fire, actions, time', t('тепло, голод, огонь, действия, сутки, погода', 'warmth, hunger, fire, actions, day cycle, weather')),
      (t('Угрозы', 'Threats'), 'director, wolves, bear, fauna', t('директор угроз, волки, шатун, зайцы и олени', 'threat director, wolves, bear, hares and deer')),
      (t('Посёлок и люди', 'Settlement and people'), 'colony, npc, talk, barks', t('люди, стройка, эпохи, персонажи, разговоры', 'workers, building, ages, characters, conversations')),
      (t('Сюжет', 'Story'), 'story, quests, content/*, finale', t('события, главы, задания, вертолёт, финалы', 'events, chapters, quests, the helicopter, endings')),
      (t('Картинка и звук', 'Picture and sound'), 'gfx, art-*, particles, audio', t('рендер, спрайты, частицы, синтез звука', 'renderer, sprites, particles, synthesised sound')),
      (t('Ввод и интерфейс', 'Input and interface'), 'input, ui, map, icons', t('мышь и тач, HUD, панели, карта, цикл кадра', 'mouse and touch, HUD, panels, map, the frame loop')),
      (t('Сохранение', 'Saving'), 'savegame, Saves, Settings', t('снимок игры, ячейки, настройки', 'game snapshot, slots, settings')),
    ]
    P.append('| ' + t('Контекст', 'Context') + ' | ' + t('Файлы js/', 'Files in js/') + ' | ' + t('За что отвечает', 'What it owns') + ' |\n|---|---|---|\n' + '\n'.join(f'| {a} | `{b}` | {c} |' for a, b, c in rows))
    P.append(t('Контексты общаются через одно общее состояние `G` и несколько глобальных объектов-модулей. Сводку «что вокруг героя» даёт `Ctx`.',
               'Contexts talk through one shared state `G` and a few global module objects. `Ctx` gives the “what is around the hero” summary.'))
    # ---- C4
    P.append(H2('c4', t('C4: контекст и контейнеры', 'C4: context and containers')))
    P.append(H3(t('Уровень 1. Система и её окружение', 'Level 1. The system and its surroundings')))
    P.append(fig(flow({
        'pl': (0, 1, [t('Игрок', 'Player'), t('мышь, клавиатура, тач', 'mouse, keyboard, touch')], 'p'),
        'gm': (1, 1, [t('«Сибирь»', '“Sibiria”'), t('игра в браузере', 'a browser game')], 'c'),
        'gf': (2, 0, [t('Google Fonts', 'Google Fonts'), t('шрифты интерфейса', 'interface fonts')], 'x'),
        'ls': (2, 2, [t('Браузер', 'Browser'), 'localStorage'], 'x'),
      }, [('pl', 'gm', t('играет', 'plays'), False), ('gm', 'gf', t('грузит шрифты', 'loads fonts'), True), ('gm', 'ls', t('сохранения', 'saves'), False)], 4, 3,
      t('Контекст системы: игрок, игра, шрифты и память браузера', 'System context: the player, the game, fonts and browser storage'))
      , t('Своего сервера у игры нет: подойдёт любой статический хостинг. Без шрифтов игра работает, меняется только гарнитура.', 'The game has no server of its own: any static host will do. Without the fonts it still runs, only the typeface changes.')))
    P.append(H3(t('Уровень 2. Контейнеры', 'Level 2. Containers')))
    P.append(fig(flow({
        'pg': (0, 1, ['index.html', t('холст, HUD, стили', 'canvas, HUD, styles')], 'c'),
        'dt': (1, 0, [t('Ядро и данные', 'Core and data'), 'core, data, content/*'], 'c'),
        'sy': (1, 1, [t('Системы', 'Systems'), t('модули js/*.js', 'js/*.js modules')], 'c'),
        'rn': (1, 2, [t('Картинка', 'Picture'), 'gfx, art-*, particles'], 'c'),
        'au': (2, 2, [t('Звук', 'Sound'), 'audio.js, Web Audio'], 'c'),
        'ui': (2, 1, [t('Интерфейс и цикл', 'Interface and loop'), 'ui, input, map'], 'c'),
        'st': (3, 1, [t('Хранилище', 'Storage'), 'localStorage'], 'x'),
      }, [('pg', 'ui', t('грузит скрипты', 'loads scripts'), False), ('dt', 'sy', t('числа, сюжет', 'numbers, story'), False), ('ui', 'sy', 'update(dt)', False), ('ui', 'rn', 'render', False), ('ui', 'au', 'Sound.frame', False), ('sy', 'st', t('сейв', 'save'), True)], 4, 3,
      t('Контейнеры игры: страница, ядро, системы, картинка, звук, интерфейс', 'Game containers: page, core, systems, picture, sound, interface'))
      , t('Цикл живёт в интерфейсе и по очереди зовёт системы, рендер и звук. Все скрипты грузятся по порядку тегами в index.html.', 'The loop lives in the interface and calls the systems, the renderer and sound in turn. All scripts load in order through the tags in index.html.')))
    # ---- C3
    P.append(H2('c3', t('C4 уровня 3: компоненты контекстов', 'C4 level 3: components of each context')))
    P.append(t('Показаны пять контекстов, где решается игра. Сохранение разобрано ниже как критический путь.', 'Five contexts where the game is decided are shown. Saving is covered below as a critical path.'))
    def c3(title, svg, cap, bullets):
        P.append(H3(title)); P.append(fig(svg, cap))
        P.append('\n'.join('- ' + b for b in bullets))
    c3(t('Мир', 'World'), flow({
        'wd': (0, 1, [t('Генерация', 'Generation'), 'World.gen(seed)'], 'c'),
        'zn': (1, 0, [t('Зоны', 'Zones'), t('8 зон, свои правила', '8 zones, own rules')], 'c'),
        'dp': (1, 1, [t('Глубина снега', 'Snow depth'), 'depth.js'], 'c'),
        'ic': (1, 2, [t('Лёд', 'Ice'), t('провал у переката', 'falling through')], 'c'),
        'wn': (2, 0, [t('Ветер', 'Wind'), 'wind.js'], 'c'),
        'sn': (2, 1, [t('Снег на вещах', 'Snow on things'), 'snow.js'], 'c'),
        'lv': (2, 2, [t('Живые вещи', 'Living things'), t('лопасть, дверь, провода', 'blade, door, wires')], 'c'),
        'ix': (3, 1, [t('Отклики', 'Responses'), 'interact.js'], 'c'),
      }, [('wd', 'zn', t('карта зон', 'zone map'), False), ('wd', 'dp', t('поверхность', 'surface'), False), ('wd', 'ic', t('река', 'river'), False), ('wn', 'sn', t('сдув, наддув', 'blow, drift'), False), ('wn', 'lv', t('качает', 'sways'), False), ('sn', 'ix', t('шапки', 'caps'), False), ('lv', 'ix', t('события', 'events'), False)], 4, 3,
        t('Компоненты контекста «Мир»', 'Components of the World context')),
        t('Мир строится из числа seed: лес, зоны и сугробы пересчитываются, а не хранятся.', 'The world is built from a seed: forest, zones and drifts are recomputed, not stored.'),
        [t('Зоны (наледь, гарь, курумник, голец и другие) меняют правила: холод, шаг, опасности.', 'Zones (aufeis, burnt forest, boulder field, bald peak and more) change the rules: cold, pace, hazards.'),
         t('Отклики вещей описаны таблицей «событие + свойства вещи → реакция», а не парами «кто с чем».', 'Responses are a table of “event + properties of the thing → reaction”, not “who with what” pairs.')])
    c3(t('Герой, выживание и угрозы', 'Hero, survival and threats'), flow({
        'tw': (0, 0, [t('Время и погода', 'Time and weather'), 'time.js'], 'c'),
        'hr': (0, 1, [t('Герой', 'Hero'), t('движение, навыки', 'motion, skills')], 'c'),
        'ac': (0, 2, [t('Действия', 'Actions'), t('E, F, крафт, сон', 'E, F, craft, sleep')], 'c'),
        'su': (1, 1, [t('Выживание', 'Survival'), t('тепло, голод, здоровье', 'warmth, hunger, health')], 'c'),
        'fi': (1, 2, [t('Огонь и печь', 'Fire and stove'), 'fire.js'], 'c'),
        'di': (2, 1, [t('Директор угроз', 'Threat director'), t('напряжение, бюджет', 'tension, budget')], 'c'),
        'wo': (3, 0, [t('Волки', 'Wolves'), t('разведчик, стая', 'scout, pack')], 'c'),
        'be': (3, 1, [t('Шатун', 'Rogue bear'), 'bear.js'], 'c'),
        'fa': (3, 2, [t('Живность', 'Fauna'), t('зайцы, олени', 'hares, deer')], 'c'),
      }, [('tw', 'su', t('мороз', 'frost'), False), ('hr', 'su', t('одежда', 'clothing'), False), ('ac', 'hr', t('жесты', 'gestures'), False), ('ac', 'fi', t('дрова', 'wood'), False), ('fi', 'su', t('тепло', 'heat'), False), ('su', 'di', t('состояние героя', 'hero state'), False), ('di', 'wo', t('вызывает', 'spawns'), False), ('di', 'be', t('ночь', 'night'), False)], 4, 3,
        t('Компоненты контекстов «Выживание» и «Угрозы»', 'Components of the Survival and Threats contexts')),
        t('Тепло падает от мороза и ветра, растёт у огня и печи; директор следит за состоянием героя и решает, когда прийти волкам.', 'Warmth drops with frost and wind and rises at a fire or stove; the director watches the hero and decides when the wolves come.'),
        [t('Директор угроз устроен как в Left 4 Dead: напряжение → бюджет → предвестник (вой, следы) → разведчик или стая.', 'The threat director works like Left 4 Dead: tension → budget → omen (howl, tracks) → scout or pack.'),
         t('Пурга прогоняет стаю, а при низком здоровье директор берёт паузу.', 'A storm drives the pack away, and at low health the director pauses.')])
    c3(t('Посёлок и люди', 'Settlement and people'), flow({
        'ct': (0, 1, [t('Данные', 'Data'), 'content/npcs, people, quests'], 'c'),
        'np': (1, 0, [t('Персонажи', 'Characters'), 'npc.js'], 'c'),
        'qs': (1, 2, [t('Задания', 'Quests'), 'quests.js'], 'c'),
        'tk': (2, 0, [t('Разговор', 'Conversation'), 'talk.js'], 'c'),
        'cl': (2, 1, [t('Посёлок', 'Settlement'), t('люди, стройка, эпохи', 'workers, building, ages')], 'c'),
        'bk': (2, 2, [t('Реплики мира', 'World barks'), 'barks.js'], 'c'),
        'in': (3, 1, [t('Ввод', 'Input'), t('приказы ПКМ', 'right-click orders')], 'x'),
        'cx': (3, 2, [t('Сводка Ctx', 'Ctx summary'), 'context.js'], 'x'),
      }, [('ct', 'np', t('записи', 'entries'), False), ('ct', 'qs', t('записи', 'entries'), False), ('np', 'tk', t('говорит', 'talks'), False), ('qs', 'tk', t('узлы диалога', 'dialogue nodes'), False), ('in', 'cl', t('приказ', 'order'), False), ('cx', 'bk', t('что вокруг', 'surroundings'), False)], 4, 3,
        t('Компоненты контекста «Посёлок и люди»', 'Components of the Settlement and people context')),
        t('Новый персонаж или задание добавляются записью в данные, исполнители не меняются.', 'A new character or quest is an entry in the data; the executors stay as they are.'),
        [t('Люди посёлка работают по циклу «добыть → склад → снова», стройка даёт убывающую отдачу строителей.', 'Settlers follow a “gather → store → again” loop; extra builders give diminishing returns.'),
         t('Четыре эпохи, восемь видов построек, торговля за рубли с плавающим курсом.', 'Four ages, eight kinds of buildings, trade in roubles at a floating rate.')])
    c3(t('Сюжет', 'Story'), flow({
        'ev': (0, 1, [t('События', 'Events'), 'content/events.js'], 'c'),
        'ch': (1, 0, [t('Главы', 'Chapters'), 'chapterTick'], 'c'),
        'op': (1, 1, [t('Операции', 'Operations'), 'OPS, Story.run'], 'c'),
        'he': (1, 2, [t('Вертолёт', 'Helicopter'), 'heliTick'], 'c'),
        'ui': (2, 0, [t('Диалоги, карточки', 'Dialogues, cards'), 'UI.dialog'], 'c'),
        'sv': (2, 1, [t('Чекпоинт', 'Checkpoint'), 'SaveGame'], 'c'),
        'fi': (2, 2, [t('Финал', 'Ending'), 'finale.js'], 'c'),
        'cp': (3, 1, [t('Компас', 'Compass'), 'goalTarget'], 'c'),
      }, [('ev', 'ch', t('каждый шаг', 'every step'), False), ('ev', 'op', 'when → do', False), ('ev', 'he', t('каждый шаг', 'every step'), False), ('op', 'ui', t('показать', 'show'), False), ('ch', 'sv', t('новая глава', 'new chapter'), False), ('he', 'fi', t('спасены', 'rescued'), False), ('ch', 'cp', t('цель', 'goal'), False)], 4, 3,
        t('Компоненты контекста «Сюжет»', 'Components of the Story context')),
        t('Сюжет лежит данными, а Story только исполняет: «когда выполнится условие — сделать операции».', 'The story is data and Story only executes it: “when the condition holds, run the operations”.'),
        [t('Семь глав, пять концовок: ветка выбирается тем, придёт ли вертолёт и готов ли посёлок.', 'Seven chapters, five endings: the branch depends on whether the helicopter comes and whether the settlement is ready.'),
         t('Вход в главу сам делает автосохранение.', 'Entering a chapter makes an autosave by itself.')])
    c3(t('Картинка, звук и интерфейс', 'Picture, sound and interface'), flow({
        'in': (0, 1, [t('Ввод', 'Input'), 'input.js'], 'c'),
        'mp': (1, 0, [t('Карта', 'Map'), 'map.js'], 'c'),
        'ui': (1, 1, [t('Интерфейс и цикл', 'Interface and loop'), 'ui.js'], 'c'),
        'ql': (1, 2, [t('Качество', 'Quality'), t('авто-упрощение', 'auto-simplify')], 'c'),
        'gf': (2, 1, [t('Рендер', 'Renderer'), 'gfx.js'], 'c'),
        'au': (2, 2, [t('Звук', 'Sound'), 'audio.js'], 'c'),
        'ar': (3, 0, [t('Спрайты', 'Sprites'), 'art-*.js'], 'c'),
        'fx': (3, 1, [t('Частицы, погода', 'Particles, weather'), 'particles.js'], 'c'),
      }, [('in', 'ui', t('намерение', 'intent'), False), ('ui', 'mp', t('открыть', 'open'), False), ('ui', 'gf', 'render', False), ('ql', 'ui', t('fps', 'fps'), False), ('ui', 'au', 'Sound.frame', False), ('gf', 'ar', t('рисует', 'draws'), False), ('gf', 'fx', t('слои', 'layers'), False)], 4, 3,
        t('Компоненты контекстов «Картинка, звук и интерфейс»', 'Components of the Picture, sound and interface contexts')),
        t('Весь ввод проходит через один автомат, а картинка собирается слоями с одним светом и одним солнцем.', 'All input goes through one state machine, and the picture is built in layers with one light and one sun.'),
        [t('Звук целиком синтезируется в Web Audio, файлов нет; музыка следует за опасностью.', 'All sound is synthesised in Web Audio, no files; the music follows the danger.'),
         t('Если кадры дольше 28 мс или реже 30 в секунду два окна подряд, графика упрощается.', 'If frames run past 28 ms or below 30 fps for two windows in a row, the graphics are simplified.')])
    # ---- sequences
    P.append(H2('paths', t('Четыре критических пути', 'Four critical paths')))
    def sq(title, parts, msgs, cap, label):
        P.append(H3(title)); P.append(fig(seq(parts, msgs, label), cap))
    sq(t('1. Один кадр', '1. One frame'),
       [('b', t('Браузер', 'Browser')), ('u', t('Цикл', 'Loop')), ('g', 'update'), ('r', t('Рендер', 'Renderer')), ('s', t('Звук', 'Sound')), ('q', t('Качество', 'Quality'))],
       [('b', 'u', 'requestAnimationFrame', ''), ('u', 'u', 'dt ≤ 0.05 с', 's'), ('u', 'g', 'update(dt)', ''), ('g', 'g', t('время, герой, огонь, выживание, угрозы, люди, посёлок', 'time, hero, fire, survival, threats, people, settlement'), 'n'), ('g', 'u', t('мир обновлён', 'world updated'), 'r'), ('u', 'r', 'GFX.render', ''), ('u', 's', 'Sound.frame', ''), ('u', 'q', 'sample(fps)', ''), ('u', 'u', t('панель или диалог: только visual', 'panel or dialogue: visual only'), 'n')],
       t('Во сне update идёт четыре раза за кадр, при открытой панели мир стоит и только «дышит».', 'During sleep update runs four times per frame; with a panel open the world stands still and only “breathes”.'), t('Последовательность одного кадра', 'Sequence of one frame'))
    sq(t('2. Ночная угроза', '2. A night threat'),
       [('s', t('Выживание', 'Survival')), ('d', t('Директор', 'Director')), ('x', t('Звук, тосты', 'Sound, toasts')), ('w', t('Волки', 'Wolves')), ('f', t('Огонь', 'Fire'))],
       [('s', 'd', t('тепло, голод, здоровье', 'warmth, hunger, health'), ''), ('d', 'd', t('напряжение → бюджет', 'tension → budget'), 's'), ('d', 'x', t('вой и следы (предвестник)', 'howl and tracks (omen)'), ''), ('d', 'w', t('spawnPack / spawnScout', 'spawnPack / spawnScout'), ''), ('w', 'f', t('защита огня', 'fire protection'), ''), ('w', 's', t('выпад: здоровье', 'lunge: health'), ''), ('d', 'd', t('пурга, рассвет или бегство: стая уходит', 'storm, dawn or rout: the pack leaves'), 'n')],
       t('Сначала предупреждение, потом нападение: игрок успевает дойти до огня.', 'A warning first, then the attack: the player has time to reach a fire.'), t('Последовательность ночной угрозы', 'Sequence of a night threat'))
    sq(t('3. Шаг сюжета', '3. A story step'),
       [('s', 'Story.tick'), ('e', t('События', 'Events')), ('o', t('Операции', 'Operations')), ('u', t('Интерфейс', 'Interface')), ('c', t('Главы', 'Chapters')), ('v', 'SaveGame')],
       [('s', 'e', 'when(G, c)', ''), ('e', 's', t('условие верно', 'condition holds'), 'r'), ('s', 'o', 'run(do)', ''), ('o', 'o', t('флаги, предметы', 'flags, items'), 's'), ('o', 'u', t('диалог, тост', 'dialogue, toast'), ''), ('s', 'c', 'chapterTick', ''), ('c', 'c', t('все цели закрыты?', 'all goals done?'), 's'), ('c', 'u', t('карточка главы', 'chapter card'), ''), ('c', 'v', 'checkpoint()', '')],
       t('Событие срабатывает один раз по сохранённому флагу; глава меняется, когда закрыты все её цели.', 'An event fires once, tracked by a saved flag; the chapter changes when all its goals are done.'), t('Последовательность шага сюжета', 'Sequence of a story step'))
    sq(t('4. Сохранение и загрузка', '4. Saving and loading'),
       [('p', t('Игрок', 'Player')), ('a', t('Игра, UI', 'Game, UI')), ('v', 'SaveGame'), ('l', 'Saves'), ('w', t('Мир', 'World'))],
       [('p', 'a', t('сон в избе, новая глава', 'sleep in the hut, new chapter'), ''), ('a', 'v', 'checkpoint()', ''), ('v', 'v', t('snapshot: seed + изменения', 'snapshot: seed + changes'), 's'), ('v', 'l', 'write("auto")', ''), ('l', 'l', 'localStorage', 's'), ('p', 'a', t('«Продолжить»', '“Continue”'), ''), ('a', 'v', 'load(json)', ''), ('v', 'w', 'gen(seed)', ''), ('v', 'a', t('изменения применены', 'changes applied'), 'r')],
       t('В сохранение попадает только то, что изменилось: лес, зоны и сугробы пересчитываются из seed.', 'Only what changed is saved: forest, zones and drifts are recomputed from the seed.'), t('Последовательность сохранения и загрузки', 'Save and load sequence'))
    # ---- rules, weak
    P.append(H2('rules', t('Правила, на которых всё держится', 'The rules everything rests on')))
    P.append('\n'.join('- ' + x for x in [
        t('**Одно состояние `G`.** Системы читают и пишут в него, сохранение это `G` плюс seed.', '**One state `G`.** Systems read and write it; a save is `G` plus the seed.'),
        t('**Мир считается из seed.** Лес, зоны и сугробы не хранятся.', '**The world is computed from a seed.** Forest, zones and drifts are not stored.'),
        t('**Сюжет это данные.** Главы, события, задания и люди лежат в `content/`, исполнители про них ничего не знают.', '**The story is data.** Chapters, events, quests and people sit in `content/`; the executors know nothing about them.'),
        t('**Один порядок шага.** `update` зовёт системы в фиксированном порядке.', '**One step order.** `update` calls the systems in a fixed order.'),
        t('**Одна сводка `Ctx`.** Реплики, звук и свет берут «что вокруг героя» оттуда.', '**One `Ctx` summary.** Barks, sound and light take “what is around the hero” from it.')]))
    P.append(H2('weak', t('Слабые места', 'Weak spots')))
    wk = [(t('Порядок скриптов', 'Script order'), t('Около 55 тегов в index.html, порядок важен и нигде не проверяется.', 'About 55 tags in index.html; the order matters and nothing checks it.')),
          (t('Глобальные модули', 'Global modules'), t('Модули зовут друг друга по именам, границ между контекстами в коде нет.', 'Modules call each other by name; the code has no boundaries between contexts.')),
          (t('Большой `G`', 'The big `G`'), t('Одно изменяемое состояние на всё: любая система может сломать чужое поле.', 'One mutable state for everything: any system can break another’s field.')),
          (t('ui.js', 'ui.js'), t('В одном файле на тысячу строк HUD, диалоги, карта, цикл кадра и сохранения.', 'One thousand-line file holds the HUD, dialogues, map, frame loop and saves.')),
          (t('Старые сейвы', 'Old saves'), t('Сейвы до версии 4 не читаются: мир другой.', 'Saves before version 4 are not readable: the world is different.'))]
    P.append('| ' + t('Где', 'Where') + ' | ' + t('Что не так', 'What is wrong') + ' |\n|---|---|\n' + '\n'.join(f'| **{a}** | {b} |' for a, b in wk))
    return P

meta = {
 'ru': ('Архитектура игры «Сибирь»: C4 и критические пути', 'Контексты, схемы C4 до уровня компонентов и четыре критических пути через sequence: кадр, ночная угроза, шаг сюжета и сохранение.', 'Архитектура, Игры, C4, JavaScript'),
 'en': ('Architecture of “Sibiria”: C4 and critical paths', 'The contexts, C4 diagrams down to components and four critical paths as sequences: a frame, a night threat, a story step and saving.', 'Architecture, Games, C4, JavaScript'),
}
TOC = {'ru': [('contexts', 'Контексты'), ('c4', 'C4: контекст и контейнеры'), ('c3', 'Компоненты'), ('paths', 'Критические пути'), ('rules', 'Правила'), ('weak', 'Слабые места')],
       'en': [('contexts', 'Contexts'), ('c4', 'C4: context and containers'), ('c3', 'Components'), ('paths', 'Critical paths'), ('rules', 'Rules'), ('weak', 'Weak spots')]}
HEAD = {'ru': {'contexts': 'Контексты игры', 'c4': 'C4: контекст и контейнеры', 'c3': 'C4 уровня 3: компоненты контекстов', 'paths': 'Четыре критических пути', 'rules': 'Правила, на которых всё держится', 'weak': 'Слабые места'},
        'en': {'contexts': 'The contexts of the game', 'c4': 'C4: context and containers', 'c3': 'C4 level 3: components of each context', 'paths': 'Four critical paths', 'rules': 'The rules everything rests on', 'weak': 'Weak spots'}}
os.makedirs(OUT, exist_ok=True)
for L, name in (('ru', 'architecture.ru.md'), ('en', 'architecture.md')):
    _n[0] = 0; _lang[0] = L
    parts = build(L); title, desc, tags = meta[L]
    open(f'{OUT}/{name}', 'w').write(f'# {title}\n\n' + '\n\n'.join(parts) + '\n')
json.dump({'slug': 'sibiria-architecture', 'date': '2026-10-02', 'layout': 'wide', 'mentions': 'Canvas 2D, JavaScript, C4 model, Web Audio, Sibiria',
           'ru': {'file': 'architecture.ru.md', 'title': meta['ru'][0], 'description': meta['ru'][1], 'tags': meta['ru'][2], 'toc': [{'id': i, 'heading': HEAD['ru'][i], 'label': l} for i, l in TOC['ru']]},
           'en': {'file': 'architecture.md', 'title': meta['en'][0], 'description': meta['en'][1], 'tags': meta['en'][2], 'toc': [{'id': i, 'heading': HEAD['en'][i], 'label': l} for i, l in TOC['en']]}},
          open(f'{OUT}/post.json', 'w'), ensure_ascii=False, indent=1)
print('ok', OUT)
