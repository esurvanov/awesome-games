import sys, os, re, json; sys.path.insert(0, '.')
from svgs import flow, seq, standalone
OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
NAMES = ['c4-context', 'c4-containers', 'c3-simulation', 'c3-ai', 'c3-ui', 'c3-runtime', 'seq-start', 'seq-frame', 'seq-order', 'seq-save']
_n = [0]; _lang = ['ru']
def fig(svg, caption):
    name = NAMES[_n[0]]; _n[0] += 1
    d = f'{OUT}/diagrams/{_lang[0]}'; os.makedirs(d, exist_ok=True)
    open(f'{d}/{name}.svg', 'w').write(standalone(svg, name))
    alt = re.search(r'aria-label="([^"]*)"', svg).group(1)
    return f'![{alt}](diagrams/{_lang[0]}/{name}.svg "{caption}")'

def H2(i, t): return f'## {t}'
def H3(t): return f'### {t}'

# ------------------------------------------------------------------ texts: each entry is (ru, en)
def build(L):
    r = (L == 'ru'); t = lambda ru, en: ru if r else en
    P = []
    # ---- lead
    P.append(t(
      '«Хроники Королевств» — стратегия в духе Age of Empires II, которая запускается как обычный сайт: без сервера и сборки, около 80 модулей на JavaScript и холст на всю страницу. Игра переписана из Python-версии построчно, поэтому правила и числа совпадают с оригиналом. Ниже схемы C4 до уровня компонентов и четыре пути, на которых всё держится.',
      '“Chronicles of Kingdoms” is a real-time strategy in the spirit of Age of Empires II that runs as an ordinary website: no server and no build step, about 80 JavaScript modules and one canvas filling the page. It was ported line by line from the Python version, so the rules and numbers match the original. Below: C4 diagrams down to components and the four paths everything rests on.'))
    # ---- contexts
    P.append(H2('ctx', t('Контексты: что окружает игру', 'Contexts: what surrounds the game')))
    P.append('| ' + t('Кто / что', 'Who / what') + ' | ' + t('Что даёт игре', 'What it gives the game') + ' |\n|---|---|\n' + '\n'.join(f'| {a} | {b} |' for a, b in [
        (t('Игрок', 'Player'), t('мышь и клавиатура; видит холст 1280 × 800', 'mouse and keyboard; sees a 1280 × 800 canvas')),
        (t('Статический хостинг', 'Static host'), t('отдаёт файлы `web/` и `assets/`; своего сервера у игры нет', 'serves the `web/` and `assets/` files; the game has no server of its own')),
        (t('API браузера', 'Browser APIs'), t('Canvas 2D для картинки, Web Audio для звука, IndexedDB для сохранений', 'Canvas 2D for the picture, Web Audio for sound, IndexedDB for saves')),
        (t('Конвейер ассетов', 'Asset pipeline'), t('Python-скрипты `tools/` один раз превращают 3D-модели 0 A.D. в изометрические спрайты; результат лежит в `assets/`', 'Python scripts in `tools/` turn 0 A.D. 3D models into isometric sprites once; the result lives in `assets/`')),
        (t('Python-версия', 'Python version'), t('исходник порта и эталон: тесты сверяют браузерный код с настоящим CPython', 'the source of the port and its reference: tests compare the browser code with real CPython'))]))
    # ---- C4 L1/L2
    P.append(H2('c4', t('C4: контекст и контейнеры', 'C4: context and containers')))
    P.append(H3(t('Уровень 1. Система и её окружение', 'Level 1. The system and its surroundings')))
    P.append(fig(flow({
        'pl': (0, 1, [t('Игрок', 'Player'), t('мышь, клавиатура', 'mouse, keyboard')], 'p'),
        'gm': (1, 1, [t('Хроники Королевств', 'Chronicles'), t('игра в браузере', 'a browser game')], 'c'),
        'sh': (2, 0, [t('Статический хостинг', 'Static host'), t('любой, без кода', 'any, no code')], 'x'),
        'st': (2, 2, [t('Хранилище браузера', 'Browser storage'), t('IndexedDB', 'IndexedDB')], 'x'),
        'ar': (3, 0, [t('Конвейер ассетов', 'Asset pipeline'), t('tools/, один раз', 'tools/, run once')], 'x'),
        'py': (3, 2, [t('Версия на Python', 'Python version'), t('эталон для сверки', 'reference for checks')], 'x'),
      }, [('pl', 'gm', t('играет', 'plays'), False), ('sh', 'gm', t('отдаёт файлы', 'serves files'), False), ('gm', 'st', t('сохранения', 'saves'), False), ('ar', 'sh', t('спрайты, звуки', 'sprites, sounds'), False), ('py', 'gm', t('сверка', 'cross-check'), True)], 4, 3,
      t('Контекст системы: игрок, игра, хостинг, хранилище, конвейер и Python-версия', 'System context: the player, the game, the host, storage, the pipeline and the Python version'))
      , t('Игре нужны только файлы и браузер. Конвейер и Python-версия работают вне игры: первый готовит картинки, вторая служит эталоном для тестов.', 'The game needs only files and a browser. The pipeline and the Python version work outside the game: one prepares the pictures, the other is the reference for tests.')))
    P.append(H3(t('Уровень 2. Контейнеры', 'Level 2. Containers')))
    P.append(fig(flow({
        'sh': (0, 0, [t('Статический хостинг', 'Static host'), t('файлы как есть', 'files as they are')], 'x'),
        'bt': (0, 1, [t('Загрузчик', 'Loader'), 'index.html, boot.js'], 'c'),
        'as': (1, 0, [t('Ассеты', 'Assets'), 'assets/ + manifest'], 'c'),
        'gm': (1, 1, [t('Игра', 'Game'), 'main.js + src/'], 'c'),
        'rt': (2, 1, [t('Среда', 'Runtime'), 'runtime/'], 'c'),
        'br': (2, 2, [t('API браузера', 'Browser APIs'), 'Canvas, Audio, IDB'], 'x'),
      }, [('sh', 'bt', t('страница', 'the page'), False), ('bt', 'as', t('группы ассетов', 'asset groups'), False), ('bt', 'gm', 'import', False), ('gm', 'rt', t('вызовы pygame', 'pygame calls'), False), ('rt', 'as', t('чтение', 'reads'), False), ('rt', 'br', t('рисует, звучит', 'draws, sounds'), False)], 3, 3,
      t('Контейнеры: загрузчик, игра, среда, ассеты', 'Containers: loader, game, runtime, assets'))
      , t('Загрузчик тянет ассеты и показывает полосу прогресса, затем подключает игру. Игра говорит с браузером только через среду, которая повторяет API pygame.', 'The loader fetches assets and shows a progress bar, then plugs the game in. The game talks to the browser only through the runtime, which mimics the pygame API.')))
    # ---- C3
    P.append(H2('c3', t('C4 уровня 3: компоненты', 'C4 level 3: components')))
    P.append(t('Главный контейнер, «Игра», делится на три части: симуляция (правила), соперник (ИИ) и интерфейс. Симуляция не знает о графике, поэтому гоняется в тестах без экрана. Среда выполнения разобрана отдельно.',
               'The main container, “Game”, splits into three parts: the simulation (the rules), the opponent (AI) and the interface. The simulation knows nothing about graphics, so tests run it without a screen. The runtime is described separately.'))
    def c3(title, svg, cap, bullets):
        P.append(H3(title)); P.append(fig(svg, cap))
        P.append('\n'.join('- ' + b for b in bullets))
    c3(t('Симуляция', 'Simulation'), flow({
        'nv': (0, 0, [t('Флот', 'Navy'), 'naval.js'], 'c'),
        'da': (0, 1, [t('Таблицы', 'Tables'), 'data.js, content/'], 'c'),
        'mk': (0, 2, [t('Рынок, реликвии', 'Market, relics'), 'market, relics'], 'c'),
        'mt': (1, 0, [t('Правила матча', 'Match rules'), 'match.js'], 'c'),
        'wo': (1, 1, [t('Мир', 'World'), 'world.js'], 'c'),
        'sc': (1, 2, [t('Статистика', 'Stats'), 'stats, scoring'], 'c'),
        'mp': (2, 0, [t('Карты', 'Maps'), 'mapgen, terrain'], 'c'),
        'or': (2, 1, [t('Приказы', 'Orders'), 'orders.js'], 'c'),
        'df': (2, 2, [t('Оборона', 'Defense'), 'defense.js'], 'c'),
      }, [('da', 'wo', t('характеристики', 'stats'), False), ('mt', 'wo', t('параметры', 'settings'), False), ('wo', 'mp', t('генерация', 'generation'), False), ('wo', 'or', t('очередь приказов', 'order queue'), False), ('wo', 'df', t('стены, гарнизон', 'walls, garrison'), False), ('nv', 'wo', t('вода, корабли', 'water, ships'), False), ('mk', 'wo', t('хук tick', 'tick hook'), True), ('wo', 'sc', t('события', 'events'), False)], 3, 3,
      t('Компоненты симуляции', 'Simulation components')),
        t('Мир хранит игроков, юниты, здания, снаряды, туман и ищет пути; один шаг мира двигает всё это.', 'World holds the players, units, buildings, projectiles and fog and finds paths; one world step moves all of it.'),
        [t('Юниты, здания, технологии и 14 цивилизаций лежат в таблицах `content/*`: новая единица добавляется строкой данных.', 'Units, buildings, techs and the 14 civilizations sit in the `content/*` tables: a new unit is a line of data.'),
         t('Параметры матча (ресурсы, эпохи, перемирие, победа) собирает `match.js`.', 'Match parameters (resources, ages, treaty, victory) are collected in `match.js`.'),
         t('Карты: шесть рецептов в `mapgen.js` плюс рельеф с высотами, обрывами и мелями.', 'Maps: six recipes in `mapgen.js` plus relief with heights, cliffs and shallows.')])
    c3(t('Соперник (ИИ)', 'Opponent (AI)'), flow({
        'ec': (0, 0, [t('Экономика', 'Economy'), 'eco_ai.js'], 'c'),
        'wo': (0, 1, [t('Мир', 'World'), t('тот же, что у игрока', 'same as the player’s')], 'x'),
        'nv': (0, 2, [t('Флот', 'Navy'), 'naval_ai.js'], 'x'),
        'pf': (1, 0, [t('Профили', 'Profiles'), t('6 уровней, по эпохам', '6 levels, per age')], 'c'),
        'ai': (1, 1, [t('Планировщик', 'Planner'), 'ai.js'], 'c'),
        'df': (2, 2, [t('Защита', 'Defense'), 'ai_defense.js'], 'c'),
        'ar': (2, 0, [t('Армия', 'Army'), 'ai_army.js'], 'c'),
        'wr': (2, 1, [t('Война', 'War'), 'ai_war.js'], 'c'),
      }, [('pf', 'ai', t('числа', 'numbers'), False), ('ai', 'wo', 'cmd_*', False), ('ai', 'ec', t('излишки', 'surplus'), False), ('ai', 'ar', t('состав', 'composition'), False), ('ai', 'wr', t('волны', 'waves'), False), ('ai', 'df', t('колокол', 'bell'), False), ('ai', 'nv', t('карты с водой', 'water maps'), True)], 3, 3,
      t('Компоненты ИИ', 'AI components')),
        t('Каждый соперник думает раз в полсекунды и отдаёт те же команды, что и игрок.', 'Each opponent thinks twice a second and issues the same commands as the player.'),
        [t('Профиль задаёт, сколько селян держать в каждой эпохе, когда переходить дальше и когда нападать; уровней шесть, от лёгкого до предельного.', 'A profile says how many villagers to keep in each age, when to advance and when to attack; there are six levels, from easiest to extreme.'),
         t('Война идёт по кругу: сбор, поход, бой, отход; решение берётся по сравнению сил.', 'War runs in a loop: rally, march, engage, retreat; the decision comes from comparing strengths.'),
         t('Флот подключается только на картах с водой.', 'The navy is plugged in only on maps with water.')])
    c3(t('Интерфейс', 'Interface'), flow({
        'mn': (0, 0, [t('Меню и лобби', 'Menu and lobby'), 'menu, lobby, screens'], 'c'),
        'sv': (0, 1, [t('Сохранения', 'Saves'), 'savegame, saves_ui'], 'c'),
        'au': (0, 2, [t('Звук', 'Audio'), 'sound, music, synth'], 'c'),
        'wo': (1, 0, [t('Мир', 'World'), t('читает и шлёт приказы', 'reads, sends orders')], 'x'),
        'gm': (1, 1, [t('Экран игры', 'Game screen'), 'ui.js'], 'c'),
        'dr': (1, 2, [t('Отрисовка', 'Rendering'), 'gfx, sprites3d'], 'c'),
        'hu': (2, 0, [t('Панели', 'Panels'), 'hud, hud_windows'], 'c'),
        'ct': (2, 1, [t('Управление', 'Controls'), 'controls.js, keymap'], 'c'),
        'i1': (2, 2, [t('Языки', 'Languages'), t('i18n, 7 локалей', 'i18n, 7 locales')], 'c'),
      }, [('gm', 'wo', 'update(dt)', False), ('gm', 'mn', t('состояние', 'state'), False), ('gm', 'sv', 'F7 / F8', False), ('gm', 'au', t('события мира', 'world events'), False), ('gm', 'dr', t('кадр', 'the frame'), False), ('gm', 'hu', t('интерфейс', 'HUD'), False), ('gm', 'ct', t('ввод', 'input'), False), ('hu', 'i1', t('тексты', 'texts'), False)], 3, 3,
      t('Компоненты интерфейса', 'Interface components')),
        t('Экран игры — один большой класс, к которому подмешаны панели, управление, меню, лобби и экраны вокруг матча.', 'The game screen is one big class with the panels, controls, menu, lobby and the screens around a match mixed into it.'),
        [t('Цикл простой: события, обновление мира, отрисовка, звук; меню, загрузка и итоги — это состояния того же цикла.', 'The loop is simple: events, world update, drawing, sound; the menu, loading and results are states of the same loop.'),
         t('Звук слушает события мира (удар, смерть, постройка) и сам решает, что проиграть.', 'Audio listens to the world’s events (a hit, a death, a building) and decides what to play.'),
         t('Картинка берёт готовые спрайты; если их нет, рисуется запасная процедурная графика.', 'The picture uses ready sprites; if they are missing, a fallback procedural graphic is drawn.')])
    c3(t('Среда выполнения', 'Runtime'), flow({
        'py': (0, 0, [t('Идиомы Python', 'Python idioms'), 'py.js'], 'c'),
        'gm': (0, 1, [t('Игра', 'Game'), 'src/'], 'x'),
        'np': (0, 2, [t('numpy', 'numpy'), 'np.js'], 'c'),
        'pk': (1, 0, [t('Сериализация', 'Serializer'), 'pickle.js'], 'c'),
        'pg': (1, 1, [t('pygame', 'pygame'), 'pygame.js'], 'c'),
        'as': (2, 0, [t('Ассеты', 'Assets'), 'assets.js'], 'c'),
        'st': (2, 2, [t('Файлы', 'Files'), 'storage.js'], 'c'),
        'br': (2, 1, [t('API браузера', 'Browser APIs'), 'Canvas, Audio, IDB'], 'x'),
      }, [('gm', 'py', t('числа, random', 'numbers, random'), False), ('gm', 'pg', t('рисует, ввод', 'draws, input'), False), ('gm', 'np', t('синтез звука', 'sound synthesis'), False), ('gm', 'pk', t('сохранения', 'saves'), False), ('pg', 'as', t('картинки, звук', 'images, sound'), False), ('pg', 'br', 'Canvas, Audio', False), ('st', 'br', 'IndexedDB', False), ('pg', 'st', t('файлы', 'files'), False)], 3, 3,
      t('Компоненты среды выполнения', 'Runtime components')),
        t('Игровой код остался в стиле Python; среда притворяется Python, pygame и numpy поверх браузера.', 'The game code kept its Python style; the runtime pretends to be Python, pygame and numpy on top of the browser.'),
        [t('`py.js` повторяет числа, сортировку и `random` бит в бит, поэтому сохранённая партия и тесты дают те же результаты, что в Python.', '`py.js` reproduces numbers, sorting and `random` bit for bit, so a saved game and the tests give the same results as in Python.'),
         t('`storage.js` ведёт себя как обычные файлы: читает и пишет сразу, а в IndexedDB сбрасывает в фоне.', '`storage.js` behaves like plain files: it reads and writes at once and flushes to IndexedDB in the background.'),
         t('`assets.js` грузит по манифесту группами; листы юнитов приходят по одному, когда нужны.', '`assets.js` loads by manifest in groups; unit sheets arrive one by one when needed.')])
    # ---- sequences
    P.append(H2('paths', t('Четыре критических пути', 'Four critical paths')))
    def sq(title, parts, msgs, cap, label, pw=156):
        P.append(H3(title)); P.append(fig(seq(parts, msgs, label, pw=pw), cap))
    sq(t('1. Начало партии', '1. Starting a match'),
       [('u', t('Игрок', 'Player')), ('l', t('Лобби', 'Lobby')), ('s', t('Загрузка', 'Loading')), ('w', t('Мир', 'World')), ('a', t('ИИ', 'AI')), ('as', t('Ассеты', 'Assets'))],
       [('u', 'l', 'Start Game', ''), ('l', 's', 'begin_loading', ''), ('s', 'w', 'new World(...)', ''), ('w', 'w', t('карта, ресурсы, стартовые юниты', 'map, resources, starting units'), 'n'), ('w', 's', t('мир готов', 'world ready'), 'r'),
        ('s', 'a', t('по ИИ на соперника', 'one AI per opponent'), ''), ('s', 'as', t('листы стартовых юнитов', 'starting unit sheets'), ''), ('s', 's', t('камера, ландшафт, панели', 'camera, ground, panels'), 'n'), ('as', 's', t('листы пришли', 'sheets arrived'), 'r'), ('s', 'u', t('матч идёт', 'match is on'), 'r')],
       t('Мир строится за один шаг, а картинка ждёт, пока придут спрайты стартовых юнитов (не дольше короткого лимита).', 'The world is built in one step and the picture waits for the starting units’ sprites (for a short limit at most).'), t('Последовательность начала партии', 'Sequence of starting a match'))
    sq(t('2. Один кадр', '2. One frame'),
       [('l', t('Цикл', 'Loop')), ('w', t('Мир', 'World')), ('u', t('Юниты', 'Units')), ('b', t('Здания', 'Buildings')), ('a', t('ИИ', 'AI')), ('o', t('Картинка, звук', 'Picture, sound'))],
       [('l', 'l', t('ввод: мышь, клавиши', 'input: mouse, keys'), 'n'), ('l', 'w', t('update(dt)', 'update(dt)'), ''), ('w', 'u', t('update каждого юнита', 'update of each unit'), ''), ('u', 'u', t('путь, добыча, бой', 'path, gather, fight'), 'n'),
        ('w', 'b', t('очереди и стройка', 'queues and building'), ''), ('w', 'w', t('туман, хуки, победа', 'fog, hooks, victory'), 'n'), ('w', 'a', 'ai.update(dt)', ''), ('a', 'u', t('приказы cmd_*', 'cmd_* orders'), ''), ('w', 'l', t('мир обновлён', 'world updated'), 'r'), ('l', 'o', t('draw + события мира', 'draw + world events'), '')],
       t('Время кадра режется на шаги не длиннее 0.034 с; ИИ решает раз в полсекунды, остальные кадры только ждёт.', 'The frame time is cut into steps of at most 0.034 s; the AI decides every half second and idles the rest of the frames.'), t('Последовательность одного кадра', 'Sequence of one frame'))
    sq(t('3. Приказ и его выполнение', '3. An order and its execution'),
       [('u', t('Игрок', 'Player')), ('g', t('Экран игры', 'Game screen')), ('o', t('Приказы', 'Orders')), ('n', t('Юнит', 'Unit')), ('w', t('Мир', 'World'))],
       [('u', 'g', t('ПКМ на карте', 'right-click on the map'), ''), ('g', 'g', t('цель: земля, ресурс, враг, здание', 'target: ground, resource, enemy, building'), 'n'), ('g', 'o', t('issue(юнит, приказ)', 'issue(unit, order)'), ''), ('o', 'n', t('cmd_*: состояние', 'cmd_*: state'), ''),
        ('w', 'n', t('update каждый кадр', 'update every frame'), ''), ('n', 'w', 'find_path (A*)', ''), ('w', 'n', t('путь', 'path'), 'r'), ('n', 'n', t('идёт, добывает, бьёт', 'walks, gathers, fights'), 'n'), ('n', 'o', t('on_idle: из очереди', 'on_idle: from queue'), '')],
       t('Игрок и ИИ используют одни и те же команды юнита; очередь по Shift и патрули живут в модуле приказов.', 'The player and the AI use the same unit commands; the Shift queue and patrols live in the orders module.'), t('Последовательность приказа', 'Sequence of an order'))
    sq(t('4. Сохранение и загрузка', '4. Save and load'),
       [('u', t('Игрок', 'Player')), ('g', t('Экран игры', 'Game screen')), ('s', t('Сохранения', 'Saves')), ('p', 'pickle.js'), ('t', 'storage.js'), ('i', 'IndexedDB')],
       [('u', 'g', t('F7 или слот в меню', 'F7 or a menu slot'), ''), ('g', 's', 'save_world', ''), ('s', 'p', t('dumps: мир, камера', 'dumps: world, camera'), ''), ('p', 's', t('текст, адреса таблиц', 'text, table addresses'), 'r'), ('s', 't', t('.tmp, затем replace', '.tmp, then replace'), ''), ('t', 'i', t('в фоне', 'in background'), ''),
        ('u', 'g', t('F8 или слот в меню', 'F8 or a menu slot'), ''), ('g', 's', 'load_world', ''), ('s', 't', t('читает файл', 'reads the file'), ''), ('t', 's', t('заголовок + тело', 'header + body'), 'r'), ('s', 'p', 'loads', ''), ('p', 's', t('World, random', 'World, random'), 'r'), ('s', 'g', t('мир, камера, шапка', 'world, camera, header'), 'r'), ('g', 'g', 'attach_world(w, ui)', 'n')],
       t('В файл попадает весь граф объектов целиком; статические таблицы записываются адресами и берутся из текущей версии игры.', 'The whole object graph goes into the file; static tables are written as addresses and taken from the current version of the game.'), t('Последовательность сохранения и загрузки', 'Sequence of save and load'))
    # ---- rules, weak spots
    P.append(H2('rules', t('Правила, на которых всё держится', 'The rules everything rests on')))
    P.append('\n'.join('- ' + x for x in [
        t('**Мир один знает правду.** Экран только читает его и шлёт приказы.', '**The World is the only source of truth.** The screen only reads it and sends orders.'),
        t('**Игрок и ИИ равны.** Оба командуют юнитами через одни и те же `cmd_*`.', '**The player and the AI are equals.** Both command units through the same `cmd_*`.'),
        t('**Данные отдельно от кода.** Юниты, здания, технологии и цивилизации живут в таблицах.', '**Data is separate from code.** Units, buildings, techs and civilizations live in tables.'),
        t('**Симуляция без графики.** Тесты гоняют целые матчи ИИ против ИИ без экрана и сверяют их с CPython.', '**Simulation without graphics.** Tests run whole AI-vs-AI matches without a screen and compare them with CPython.'),
        t('**Нужное синхронно загружено заранее.** Загрузчик кладёт ассеты в память до старта игры; листы юнитов подгружаются по одному.', '**What is read synchronously is loaded in advance.** The loader puts assets in memory before the game starts; unit sheets stream in one by one.')]))
    P.append(H2('weak', t('Слабые места', 'Weak spots')))
    wk = [(t('Большие файлы', 'Big files'), t('`world.js` — 3,2 тысячи строк, `ui.js` — 2,2 тысячи, `hud.js` — 2 тысячи: границ внутри них мало.', '`world.js` is 3.2 k lines, `ui.js` 2.2 k, `hud.js` 2 k: there are few boundaries inside them.')),
          (t('Подмешанные части', 'Mixed-in parts'), t('Экран игры собран из шести подмешанных частей, которые общаются через общие поля.', 'The game screen is assembled from six mixed-in parts that talk through shared fields.')),
          (t('Связи по имени', 'Links by name'), t('Модули находят друг друга через реестр `modules.*` во время работы: в коде связи не видны.', 'Modules find each other through the `modules.*` registry at run time: the links are invisible in the code.')),
          (t('Шаг зависит от кадра', 'Step depends on the frame'), t('Длина шага берётся из реального времени. Для общей партии по сети понадобится фиксированный шаг.', 'The step length comes from real time. A shared online match would need a fixed step.')),
          (t('Вес', 'Weight'), t('Первая загрузка около 60 МБ, все листы юнитов — ещё около 90 МБ; в памяти они раздуваются до гигабайтов.', 'The first load is about 60 MB, all unit sheets another ~90 MB; in memory they inflate to gigabytes.')),
          (t('Нет сервера', 'No server'), t('Сохранения живут только в одном браузере, сетевой игры нет.', 'Saves live in one browser only, and there is no online play.'))]
    P.append('| ' + t('Где', 'Where') + ' | ' + t('Что не так', 'What is wrong') + ' |\n|---|---|\n' + '\n'.join(f'| **{a}** | {b} |' for a, b in wk))
    return P

meta = {
 'ru': ('Архитектура игры «Хроники Королевств»: C4 и критические пути', 'Контексты, схемы C4 до уровня компонентов и четыре критических пути через sequence: начало партии, кадр, приказ и сохранение.', 'Архитектура, Игры, C4, Стратегия'),
 'en': ('Architecture of “Chronicles of Kingdoms”: C4 and critical paths', 'Contexts, C4 diagrams down to components and four critical paths as sequences: starting a match, a frame, an order and save/load.', 'Architecture, Games, C4, Strategy'),
}
TOC = {'ru': [('ctx', 'Контексты'), ('c4', 'C4: контекст и контейнеры'), ('c3', 'Компоненты'), ('paths', 'Критические пути'), ('rules', 'Правила'), ('weak', 'Слабые места')],
       'en': [('ctx', 'Contexts'), ('c4', 'C4: context and containers'), ('c3', 'Components'), ('paths', 'Critical paths'), ('rules', 'Rules'), ('weak', 'Weak spots')]}
HEAD = {'ru': {'ctx': 'Контексты: что окружает игру', 'c4': 'C4: контекст и контейнеры', 'c3': 'C4 уровня 3: компоненты', 'paths': 'Четыре критических пути', 'rules': 'Правила, на которых всё держится', 'weak': 'Слабые места'},
        'en': {'ctx': 'Contexts: what surrounds the game', 'c4': 'C4: context and containers', 'c3': 'C4 level 3: components', 'paths': 'Four critical paths', 'rules': 'The rules everything rests on', 'weak': 'Weak spots'}}
os.makedirs(OUT, exist_ok=True)
for L, name in (('ru', 'architecture.ru.md'), ('en', 'architecture.md')):
    _n[0] = 0; _lang[0] = L
    parts = build(L); title, desc, tags = meta[L]
    open(f'{OUT}/{name}', 'w').write(f'# {title}\n\n' + '\n\n'.join(parts) + '\n')
json.dump({'slug': 'chronicles-of-kingdoms-architecture', 'date': '2026-10-02', 'layout': 'wide', 'mentions': 'Canvas 2D, Web Audio, IndexedDB, C4 model, pygame, Age of Empires II, Chronicles of Kingdoms',
           'ru': {'file': 'architecture.ru.md', 'title': meta['ru'][0], 'description': meta['ru'][1], 'tags': meta['ru'][2], 'toc': [{'id': i, 'heading': HEAD['ru'][i], 'label': l} for i, l in TOC['ru']]},
           'en': {'file': 'architecture.md', 'title': meta['en'][0], 'description': meta['en'][1], 'tags': meta['en'][2], 'toc': [{'id': i, 'heading': HEAD['en'][i], 'label': l} for i, l in TOC['en']]}},
          open(f'{OUT}/post.json', 'w'), ensure_ascii=False, indent=1)
print('ok', OUT)
