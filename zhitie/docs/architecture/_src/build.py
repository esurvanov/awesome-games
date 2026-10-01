import sys, os, re, json; sys.path.insert(0, '.')
from svgs import flow, seq, standalone
OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
NAMES = ['c4-context', 'c4-containers', 'c3-sim', 'c3-world', 'c3-render', 'c3-ui', 'seq-start', 'seq-tick', 'seq-action', 'seq-frame']
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
      'Житьё — симулятор жизни в браузере: район из десяти семей, потребности, карьера, отношения, режимы «Покупка» и «Стройка». Без сборки и сервера: страница, набор ES-модулей и three.js с CDN. Ниже схемы C4 до уровня компонентов и четыре пути, на которых всё держится.',
      'Zhitiyo is a browser life sim: a neighbourhood of ten households, needs, careers, relationships, Buy and Build modes. No build step and no server: a page, a set of ES modules and three.js from a CDN. Below: C4 diagrams down to components and the four paths everything rests on.'))
    # ---- contexts
    P.append(H2('ctx', t('Контексты', 'Contexts')))
    rows = [
      ('', t('Ядро', 'Core'), 'js/core', t('шина событий, состояние, числа баланса', 'event bus, state, balance numbers')),
      ('', t('Мозг', 'Brain'), 'js/sim', t('потребности, выбор действий, карьера, семья, происшествия', 'needs, action choice, careers, family, incidents')),
      ('', t('Мир', 'World'), 'js/world', t('участок, стены, поиск пути, комнаты, район', 'lot, walls, pathfinding, rooms, neighbourhood')),
      ('', t('Рендер', 'Render'), 'js/render', t('three.js: сцена, камера, модели, анимации', 'three.js: scene, camera, models, animations')),
      ('', 'UI', 'js/ui', t('панель, круговое меню, покупка, стройка, ввод', 'panel, pie menu, buy, build, input')),
      ('', t('Звук', 'Audio'), 'js/audio', t('эффекты, голоса, музыка по режимам', 'effects, voices, music per mode')),
      ('', t('Данные', 'Data'), 'data/, assets/', t('каталог предметов, действия, район, тексты, модели glb', 'item catalogue, interactions, neighbourhood, texts, glb models')),
    ]
    P.append('| | ' + t('Контекст', 'Context') + ' | ' + t('Папка', 'Folder') + ' | ' + t('За что отвечает', 'Owns') + ' |\n|---|---|---|---|\n' + '\n'.join(f'| {a} | **{b}** | `{c}` | {d} |' for a, b, c, d in rows))
    # ---- C4 L1/L2
    P.append(H2('c4', t('C4: контекст и контейнеры', 'C4: context and containers')))
    P.append(H3(t('Уровень 1. Система и её окружение', 'Level 1. The system and its surroundings')))
    P.append(fig(flow({
        'pl': (0, 1, [t('Игрок', 'Player'), t('мышь, клавиатура', 'mouse, keyboard')], 'p'),
        'gm': (1, 1, [t('«Житьё»', 'Zhitiyo'), t('игра в браузере', 'a browser game')], 'c'),
        'cd': (2, 0, [t('CDN jsDelivr', 'jsDelivr CDN'), 'three.js 0.169'], 'x'),
        'ls': (2, 2, ['localStorage', t('сохранение, настройки', 'save, settings')], 'x'),
      }, [('pl', 'gm', t('играет', 'plays'), False), ('gm', 'cd', t('грузит библиотеку', 'loads the library'), False), ('gm', 'ls', t('пишет и читает', 'writes and reads'), False)], 4, 3,
      t('Контекст системы: игрок, игра, CDN и хранилище браузера', 'System context: player, game, CDN and browser storage'))
      , t('Своего сервера нет: подойдёт любой статический хостинг.', 'There is no server of its own: any static host will do.')))
    P.append(H3(t('Уровень 2. Контейнеры', 'Level 2. Containers')))
    P.append(fig(flow({
        'mn': (1, 1, ['main.js', t('сборка, цикл, автосохранение', 'wiring, loop, autosave')], 'c'),
        'sm': (1, 0, [t('Мозг', 'Brain'), 'js/sim'], 'c'),
        'wd': (0, 0, [t('Мир', 'World'), 'js/world'], 'c'),
        'co': (2, 0, [t('Ядро', 'Core'), t('шина, состояние', 'bus, state')], 'c'),
        'ls': (0, 1, ['localStorage', t('zhitie.save', 'zhitie.save')], 'x'),
        'ui': (2, 1, ['UI', 'js/ui'], 'c'),
        'au': (3, 0, [t('Звук', 'Audio'), 'js/audio'], 'c'),
        'dt': (3, 1, [t('Данные', 'Data'), 'data/'], 'c'),
        'rn': (1, 2, [t('Рендер', 'Render'), 'js/render'], 'c'),
        'cd': (2, 2, ['CDN', 'three.js'], 'x'),
        'as': (0, 2, [t('Модели', 'Models'), 'assets/*.glb'], 'c'),
      }, [('mn', 'sm', 'tick', False), ('mn', 'wd', 'loadStartLot', False), ('mn', 'ls', 'save / load', False), ('mn', 'ui', 'frame', False), ('mn', 'rn', 'frame', False),
          ('sm', 'co', t('шина, состояние', 'bus, state'), False), ('ui', 'co', t('шина', 'bus'), False), ('ui', 'au', t('звук', 'sound'), False), ('ui', 'dt', t('каталог', 'catalogue'), False),
          ('rn', 'cd', 'import map', True), ('rn', 'as', 'loadManifest', False)], 4, 3,
      t('Контейнеры игры: сборка, пять контекстов, данные и модели', 'Game containers: wiring, five contexts, data and models'))
      , t('main.js создаёт шину и состояние, собирает контексты и крутит цикл. Мозг, Мир и UI читают каталог из data/.', 'main.js creates the bus and the state, wires the contexts and runs the loop. Brain, World and UI read the catalogue from data/.')))
    # ---- C3
    P.append(H2('c3', t('C4 уровня 3: компоненты контекстов', 'C4 level 3: components of each context')))
    P.append(t('Контексты общаются через шину событий и один объект состояния. У каждого факта один хозяин: время и потребности ведёт Мозг, клетки и стены знает Мир, картинку строит Рендер.',
               'Contexts talk through the event bus and one state object. Every fact has one owner: the Brain runs time and needs, the World knows tiles and walls, the Render draws the picture.'))
    def c3(title, svg, cap, bullets):
        P.append(H3(title)); P.append(fig(svg, cap))
        P.append('\n'.join('- ' + b for b in bullets))
    c3(t('Мозг', 'Brain'), flow({
        'ix': (1, 1, ['sim/index.js', 'tick, enqueue'], 'c'),
        'au': (1, 0, ['autonomy.js', t('выбор действия', 'action choice')], 'c'),
        'wk': (2, 0, ['walk.js', t('шаги по пути', 'steps along a path')], 'c'),
        'qu': (0, 1, ['queue.js', t('очередь с приоритетами', 'priority queue')], 'c'),
        'ac': (2, 1, ['actions.js', t('идти, вход, цикл, выход', 'walk, enter, loop, exit')], 'c'),
        'mo': (1, 2, ['motives.js', t('потребности, настроение', 'needs, mood')], 'c'),
        'ss': (3, 1, [t('Подсистемы', 'Subsystems'), 'career, social, family', 'hazards, npc, hood'], 'c'),
        'wd': (2, 2, [t('Мир', 'World'), 'findPath, useSpots'], 'x'),
      }, [('ix', 'au', 'think', False), ('au', 'qu', 'pushItem', False), ('qu', 'ix', t('первый в очереди', 'first in queue'), False), ('ix', 'ac', 'startAction', False), ('ac', 'wk', 'stepWalk', False), ('ix', 'mo', 'motiveTick', False), ('ac', 'ss', 'HOOKS, EVENTS', False), ('ac', 'wd', t('путь', 'path'), True)], 4, 3,
        t('Компоненты контекста «Мозг»', 'Components of the Brain context')),
        t('Мозг не знает ни DOM, ни three.js: его можно запускать в Node, так и устроены тесты.', 'The Brain knows neither DOM nor three.js: it runs in Node, which is how the tests work.'),
        [t('Автономия оценивает предметы вокруг по кривым потребностей и делит выигрыш на расстояние.', 'Autonomy scores nearby objects by need curves and divides the gain by distance.'),
         t('Команда игрока встаёт в очередь выше автономной и вытесняет её.', 'A player command queues above an autonomous one and pre-empts it.'),
         t('Подсистемы подключаются к действиям через хуки завершения шагов, ядро цикла их не знает.', 'Subsystems attach to actions through step-end hooks; the loop core does not know them.')])
    c3(t('Мир', 'World'), flow({
        'ix': (1, 1, ['world/index.js', t('публичный API', 'public API')], 'c'),
        'ed': (0, 0, ['objects, walls', 'floors, roof'], 'c'),
        'ca': (0, 1, ['cache.js', t('производные сетки', 'derived grids')], 'c'),
        'rm': (0, 2, ['rooms.js', 'roomAt, roomScore'], 'c'),
        'nv': (1, 0, ['nav.js', t('поиск пути A*', 'A* pathfinding')], 'c'),
        'sp': (2, 0, ['spots.js', t('точки использования', 'use spots')], 'c'),
        'hd': (2, 1, ['hood.js', t('район, участки, переезд', 'neighbourhood, lots, move-in')], 'c'),
        'gn': (3, 1, ['housegen, furnish', 'community'], 'c'),
        'lt': (1, 2, ['lot.js', 'loadStartLot'], 'c'),
        'dt': (2, 2, ['data/', t('шаблоны, каталог', 'templates, catalogue')], 'x'),
      }, [('ix', 'ed', t('правки', 'edits'), False), ('ed', 'ca', 'invalidate', False), ('ca', 'rm', t('комнаты', 'rooms'), False), ('nv', 'ca', t('проходимость', 'walkability'), False), ('ix', 'nv', 'findPath', False), ('nv', 'sp', t('цели', 'goals'), False), ('ix', 'hd', 'loadLot, moveIn', False), ('hd', 'gn', t('строит дома', 'builds houses'), False), ('ix', 'lt', t('старт', 'start'), False), ('hd', 'dt', t('шаблоны', 'templates'), True)], 4, 3,
        t('Компоненты контекста «Мир»', 'Components of the World context')),
        t('Мир хранит участок в состоянии и отвечает на вопросы: можно ли поставить, где пройти, что за комната.', 'The World keeps the lot in the state and answers: can it be placed, where to walk, which room is this.'),
        [t('Сетки проходимости и комнат считаются один раз и сбрасываются при правке участка.', 'Walkability and room grids are computed once and reset when the lot is edited.'),
         t('Активный участок живёт в state.lot, остальные хранятся снимками внутри района.', 'The active lot lives in state.lot; the others are kept as snapshots inside the neighbourhood.')])
    c3(t('Рендер', 'Render'), flow({
        'ix': (1, 1, ['render/index.js', 'initRender, frame'], 'c'),
        'cm': (0, 0, ['camera.js', t('4 поворота, 3 масштаба', '4 rotations, 3 zooms')], 'c'),
        'ev': (1, 0, ['env.js', t('свет, небо, тени', 'light, sky, shadows')], 'c'),
        'as': (2, 0, ['assets, manifest', t('модели glb', 'glb models')], 'c'),
        'lt': (0, 1, ['lot.js', t('стены и полы', 'walls and floors')], 'c'),
        'ov': (2, 1, ['roof, fire', 'ghosts'], 'c'),
        'ob': (0, 2, ['objects.js', t('предметы', 'furniture')], 'c'),
        'sm': (1, 2, ['sims.js', t('жители, анимации', 'residents, animations')], 'c'),
        'hd': (2, 2, ['hood.js', t('вид района', 'neighbourhood view')], 'c'),
      }, [('ix', 'cm', 'rig', False), ('ix', 'ev', 'update', False), ('ix', 'as', 'loadManifest', False), ('ix', 'lt', 'rebuild', False), ('ix', 'ov', 'update', False), ('ix', 'ob', 'sync', False), ('ix', 'sm', 'sync', False), ('ix', 'hd', 'showHood', False)], 4, 3,
        t('Компоненты контекста «Рендер»', 'Components of the Render context')),
        t('Рендер только читает состояние и слушает шину; сам ничего в нём не меняет.', 'The Render only reads the state and listens to the bus; it changes nothing in it.'),
        [t('Объекты и жители пересинхронизируются по событиям шины, а стены ещё и по хэшу раз в полсекунды.', 'Objects and residents resync on bus events; walls also by a hash check twice a second.'),
         t('Модель не нашлась: рисуется процедурная замена.', 'A model not found: a procedural stand-in is drawn.'),
         t('Шейдеры прогреваются при старте, чтобы не было рывков позже.', 'Shaders are pre-warmed at start to avoid hitches later.')])
    c3(t('UI и звук', 'UI and audio'), flow({
        'ix': (1, 1, ['ui/index.js', t('ввод, режимы, цикл', 'input, modes, loop')], 'c'),
        'pn': (0, 0, ['panel.js', t('потребности, время', 'needs, time')], 'c'),
        'pi': (1, 0, ['pie.js', t('круговое меню', 'pie menu')], 'c'),
        'qb': (2, 0, ['queue, bubbles', t('очередь, пузыри', 'queue, bubbles')], 'c'),
        'cm': (0, 1, ['camera.js', t('мышь, клавиши', 'mouse, keys')], 'c'),
        'bb': (2, 1, ['buy.js, build.js', t('Покупка, Стройка', 'Buy, Build')], 'c'),
        'hc': (0, 2, ['hood.js, cas.js', t('район, семья', 'neighbourhood, family')], 'c'),
        'dl': (1, 2, ['dialogs, events', t('вопросы, события', 'questions, events')], 'c'),
        'au': (2, 2, ['audio/index.js', t('звук и музыка', 'sound and music')], 'c'),
      }, [('ix', 'pn', 'update', False), ('ix', 'pi', 'open', False), ('ix', 'qb', 'update', False), ('ix', 'cm', 'update', False), ('ix', 'bb', 'enter, click', False), ('ix', 'hc', 'open', False), ('ix', 'dl', 'update', False), ('ix', 'au', 'sfx, frame', False)], 4, 3,
        t('Компоненты контекстов «UI» и «Звук»', 'Components of the UI and Audio contexts')),
        t('UI получает от main.js мир, мозг и рендер одним объектом и вызывает их напрямую.', 'The UI gets the world, brain and render from main.js as one object and calls them directly.'),
        [t('Звук стартует по первому жесту игрока: браузер раньше не даёт.', 'Audio starts on the first player gesture: the browser allows nothing earlier.'),
         t('Громкости и настройки хранятся в localStorage.', 'Volumes and settings are kept in localStorage.')])
    # ---- paths
    P.append(H2('paths', t('Четыре критических пути', 'Four critical paths')))
    def sq(title, parts, msgs, cap, alt, bullets=None):
        P.append(H3(title)); P.append(fig(seq(parts, msgs, alt), cap))
    sq(t('1. Запуск и загрузка мира', '1. Startup and world load'),
       [('m', 'main.js'), ('s', t('Хранилище', 'Storage')), ('b', t('Мозг', 'Brain')), ('w', t('Мир', 'World')), ('r', t('Рендер', 'Render')), ('u', 'UI')],
       [('m', 's', t('load(), если ?continue', 'load() if ?continue'), ''), ('s', 'm', t('сохранение или пусто', 'save or nothing'), 'r'), ('m', 'm', t('createState()', 'createState()'), 's'),
        ('m', 'b', 'seed, addSim ×2', ''), ('m', 'w', 'loadStartLot', ''), ('w', 'm', t('точка появления', 'spawn point'), 'r'), ('m', 'w', 'createHood', ''),
        ('m', 'r', 'await initRender', ''), ('r', 'r', t('модели, прогрев шейдеров', 'models, shader warm-up'), 's'), ('r', 'm', t('рендер готов', 'render ready'), 'r'), ('m', 'u', 'initUI', ''), ('m', 'm', 'requestAnimationFrame', 's')],
       t('Новая игра сеет генератор случайных чисел, ставит стартовый дом и двух жителей; с сохранением пропускает это.', 'A new game seeds the RNG, places the start house and two residents; with a save it skips that.'), t('Последовательность запуска', 'Startup sequence'))
    sq(t('2. Тик симуляции', '2. Simulation tick'),
       [('m', 'main.js'), ('b', 'sim.tick'), ('a', 'autonomy'), ('q', 'actions'), ('w', t('Мир', 'World')), ('e', t('Шина', 'Bus'))],
       [('m', 'b', 'tick(dt)', ''), ('b', 'b', t('скорость × минуты; все спят: ускорение', 'speed × minutes; all asleep: speed-up'), 's'), ('b', 'b', t('под-шаги по 0,5 мин', '0.5 min sub-steps'), 's'),
        ('b', 'a', t('think, если нет действия', 'think if no action'), ''), ('a', 'b', t('pushItem в очередь', 'pushItem to queue'), 'r'), ('b', 'q', 'startAction', ''),
        ('q', 'w', 'findPath', ''), ('w', 'q', t('путь', 'path'), 'r'), ('q', 'e', 'sim:anim, object:changed', ''), ('b', 'b', t('потребности раз в 2 мин', 'needs every 2 min'), 's'), ('b', 'e', 'money:changed, notify', '')],
       t('За кадр проходит несколько под-шагов: потребности тикают редко, действия и ходьба каждый под-шаг.', 'Several sub-steps run per frame: needs tick rarely, actions and walking every sub-step.'), t('Последовательность тика симуляции', 'Simulation tick sequence'))
    sq(t('3. Действие игрока и его эффект', '3. Player action and its effect'),
       [('p', t('Игрок', 'Player')), ('u', 'UI'), ('r', t('Рендер', 'Render')), ('b', t('Мозг', 'Brain')), ('e', t('Шина', 'Bus'))],
       [('p', 'u', t('клик по предмету', 'click an object'), ''), ('u', 'r', 'pick(x, y)', ''), ('r', 'u', 'object, id', 'r'), ('u', 'b', 'interactionsFor', ''),
        ('b', 'u', t('пункты и причины отказа', 'items and refusal reasons'), 'r'), ('u', 'p', t('круговое меню', 'pie menu'), 'r'), ('p', 'u', t('выбор пункта', 'pick an item'), ''),
        ('u', 'b', 'enqueue', ''), ('b', 'b', t('очередь выше автономии', 'queue above autonomy'), 's'), ('b', 'e', 'object:changed, sim:anim', ''), ('e', 'r', t('sync, анимация', 'sync, animation'), '')],
       t('Дальше действие выполняет тик: идёт, входит, делает, выходит; Рендер реагирует на события.', 'The tick then runs the action: walk, enter, loop, exit; the Render reacts to events.'), t('Последовательность действия игрока', 'Player action sequence'))
    sq(t('4. Кадр: рендер и звук', '4. A frame: render and audio'),
       [('m', 'main.js'), ('b', 'sim.tick'), ('u', 'UI'), ('a', t('Звук', 'Audio')), ('r', t('Рендер', 'Render')), ('s', t('Хранилище', 'Storage'))],
       [('m', 'b', t('tick(dt), если режим «Жизнь»', 'tick(dt) in Live mode'), ''), ('m', 'u', 'frame(dt)', ''), ('u', 'a', 'frame(dt)', ''), ('a', 'a', t('петли: огонь, пищалка', 'loops: fire, smoke alarm'), 's'),
        ('m', 'r', 'frame(dt)', ''), ('r', 'r', t('sync, вырез стен, крыша', 'sync, wall cutaway, roof'), 's'), ('r', 'r', t('свет по часам игры', 'light by game clock'), 's'), ('r', 'r', t('рисование кадра', 'draw the frame'), 's'),
        ('m', 's', t('save() раз в 30 с', 'save() every 30 s'), '')],
       t('Один requestAnimationFrame ведёт всё: симуляция, интерфейс, картинка, звук и автосохранение.', 'One requestAnimationFrame drives everything: simulation, interface, picture, audio and autosave.'), t('Последовательность кадра', 'Frame sequence'))
    # ---- rules, weak spots
    P.append(H2('rules', t('Правила, на которых всё держится', 'The rules everything rests on')))
    P.append('\n'.join('- ' + x for x in [
        t('**Состояние одно.** Всё, что нужно сохранить, лежит в одном объекте, который целиком превращается в JSON.', '**One state.** Everything worth saving lives in one object that turns into JSON as a whole.'),
        t('**Шина событий связывает контексты.** Ошибка в обработчике одного слушателя не роняет остальных.', '**The event bus links contexts.** An error in one listener does not stop the others.'),
        t('**Мозг и Мир без DOM и three.js.** Их проверяют в Node без браузера.', '**Brain and World without DOM and three.js.** They are tested in Node with no browser.'),
        t('**Рендер ничего не решает.** Он рисует то, что лежит в состоянии.', '**The Render decides nothing.** It draws what is in the state.'),
        t('**Игрок и автономия в одной очереди.** Приказ игрока всегда важнее.', '**Player and autonomy share one queue.** A player order always wins.')]))
    P.append(H2('weak', t('Слабые места', 'Weak spots')))
    wk = [(t('Хуки в одном файле', 'Hooks in one file'), t('Все обработчики шагов действий собраны в sim/index.js на 450 строк.', 'All action-step handlers sit in one 450-line sim/index.js.')),
          (t('UI знает про Рендер', 'UI knows the Render'), t('Создание семьи берёт списки одежды прямо из файла манифеста рендера.', 'Family creation takes outfit lists straight from the render manifest file.')),
          (t('Мир через глобальную ссылку', 'World via a global'), t('Мозг получает мир параметром и ещё хранит его в общей переменной модуля.', 'The Brain gets the world as an argument and also keeps it in a module-wide variable.')),
          (t('Версия сохранения', 'Save version'), t('Сохранение другой версии молча отбрасывается, миграций нет.', 'A save of another version is silently dropped; there are no migrations.')),
          (t('Вес загрузки', 'Load weight'), t('three.js приходит с внешнего CDN, а набор моделей glb грузится при старте.', 'three.js comes from an external CDN and the glb model set loads at start.'))]
    P.append('| ' + t('Где', 'Where') + ' | ' + t('Что не так', 'What is wrong') + ' |\n|---|---|\n' + '\n'.join(f'| **{a}** | {b} |' for a, b in wk))
    return P

meta = {
 'ru': ('Архитектура игры «Житьё»: C4 и критические пути', 'Схемы C4 до уровня компонентов и четыре критических пути через sequence: запуск, тик симуляции, действие игрока и кадр.', 'Архитектура, Игры, C4, three.js'),
 'en': ('Architecture of “Zhitiyo”: C4 and critical paths', 'C4 diagrams down to components and four critical paths as sequences: startup, a simulation tick, a player action and a frame.', 'Architecture, Games, C4, three.js'),
}
TOC = {'ru': [('ctx', 'Контексты'), ('c4', 'C4: контекст и контейнеры'), ('c3', 'Компоненты'), ('paths', 'Критические пути'), ('rules', 'Правила'), ('weak', 'Слабые места')],
       'en': [('ctx', 'Contexts'), ('c4', 'C4: context and containers'), ('c3', 'Components'), ('paths', 'Critical paths'), ('rules', 'Rules'), ('weak', 'Weak spots')]}
HEAD = {'ru': {'ctx': 'Контексты', 'c4': 'C4: контекст и контейнеры', 'c3': 'C4 уровня 3: компоненты контекстов', 'paths': 'Четыре критических пути', 'rules': 'Правила, на которых всё держится', 'weak': 'Слабые места'},
        'en': {'ctx': 'Contexts', 'c4': 'C4: context and containers', 'c3': 'C4 level 3: components of each context', 'paths': 'Four critical paths', 'rules': 'The rules everything rests on', 'weak': 'Weak spots'}}
os.makedirs(OUT, exist_ok=True)
for L, name in (('ru', 'architecture.ru.md'), ('en', 'architecture.md')):
    _n[0] = 0; _lang[0] = L
    parts = build(L); title, desc, tags = meta[L]
    open(f'{OUT}/{name}', 'w').write(f'# {title}\n\n' + '\n\n'.join(parts) + '\n')
json.dump({'slug': 'zhitie-architecture', 'date': '2026-10-02', 'layout': 'wide', 'mentions': 'three.js, C4 model, WebGL, Zhitiyo, The Sims',
           'ru': {'file': 'architecture.ru.md', 'title': meta['ru'][0], 'description': meta['ru'][1], 'tags': meta['ru'][2], 'toc': [{'id': i, 'heading': HEAD['ru'][i], 'label': l} for i, l in TOC['ru']]},
           'en': {'file': 'architecture.md', 'title': meta['en'][0], 'description': meta['en'][1], 'tags': meta['en'][2], 'toc': [{'id': i, 'heading': HEAD['en'][i], 'label': l} for i, l in TOC['en']]}},
          open(f'{OUT}/post.json', 'w'), ensure_ascii=False, indent=1)
print('ok', OUT)
