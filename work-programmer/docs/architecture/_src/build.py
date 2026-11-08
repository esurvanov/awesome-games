import sys, os, re, json; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from svgs import flow, seq, standalone
OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
NAMES = ['c4-context', 'c4-containers', 'c3-sim', 'c3-board', 'c3-ui', 'seq-start', 'seq-step', 'seq-edit', 'seq-result']
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
      '«Аптайм» — игра про работу инженера: собираешь сервис из блоков, пускаешь поток пользователей и смотришь, что сломается первым. 43 уровня в пяти группах, от одного сервера до распила монолита. Браузер, без сервера и сборки. Здесь описано, как она устроена: схемы C4 до уровня компонентов и четыре пути, на которых всё держится.',
      '“Uptime” is a game about an engineer’s job: you build a service from blocks, send a stream of users through it and watch what breaks first. 43 levels in five tiers, from a single server to splitting a monolith. Browser only, no server and no build step. This is how it is put together: C4 diagrams down to components and the four paths everything rests on.'))
    # ---- C4
    P.append(H2('c4', t('C4: контекст и контейнеры', 'C4: context and containers')))
    P.append(H3(t('Уровень 1. Система и её окружение', 'Level 1. The system and its surroundings')))
    P.append(fig(flow({
        'pl': (0, 1, [t('Игрок', 'Player'), t('мышь, касание', 'mouse, touch')], 'p'),
        'gm': (1, 1, [t('«Аптайм»', '“Uptime”'), t('игра в браузере', 'a browser game')], 'c'),
        'ls': (2, 0, ['localStorage', t('прогресс, язык', 'progress, language')], 'x'),
        'gf': (2, 1, ['Google Fonts', t('шрифты, по желанию', 'fonts, optional')], 'x'),
        'nd': (2, 2, [t('Тесты в Node', 'Node tests'), t('43 уровня без экрана', '43 levels, no screen')], 'x'),
      }, [('pl', 'gm', t('играет', 'plays'), False), ('gm', 'ls', t('звёзды, черновики', 'stars, drafts'), True), ('gm', 'gf', t('шрифт', 'font'), True), ('nd', 'gm', t('гоняют уровни', 'run the levels'), True)], 3, 3,
      t('Контекст системы: игрок, игра, хранилище браузера, шрифты и тесты', 'System context: the player, the game, browser storage, fonts and tests'))
      , t('Своего сервера нет. Без сети игра работает так же, только шрифт берётся системный. Открыть можно двойным щелчком по index.html.', 'There is no server. Offline the game works the same, only with a system font. Double-clicking index.html is enough.')))
    P.append(H3(t('Уровень 2. Контейнеры', 'Level 2. Containers')))
    P.append(fig(flow({
        'ix': (0, 1, [t('Страница и реестр', 'Page and registry'), 'index.html, l.js', 'manifest.js'], 'c'),
        'mn': (1, 1, [t('Сборка', 'Assembly'), 'main.js'], 'c'),
        'ui': (2, 1, [t('Интерфейс', 'UI'), 'ui/*', t('экраны, инспектор', 'screens, inspector')], 'c'),
        'bd': (2, 2, [t('Поле', 'Board'), 'render/board.js', t('трубы и баки, SVG', 'pipes and tanks, SVG')], 'c'),
        'sm': (2, 0, [t('Симуляция', 'Simulation'), 'sim/*', t('без DOM', 'no DOM')], 'c'),
        'ct': (1, 0, [t('Содержание', 'Content'), 'content/*', t('уровни, тексты ru/en', 'levels, ru/en texts')], 'c'),
        'co': (0, 0, [t('Ядро', 'Core'), 'core.js', t('U, генератор', 'U, RNG')], 'c'),
        'cs': (1, 2, [t('Вид', 'Look'), 'css/game.css', t('светлая и тёмная', 'light and dark')], 'x'),
      }, [('ix', 'mn', t('грузит части', 'loads parts'), False), ('mn', 'ui', 'start()', False), ('ui', 'sm', 'new Sim, step', False), ('ui', 'bd', t('схема, кадр', 'scheme, frame'), False), ('ui', 'ct', t('уровень', 'level'), False), ('ct', 'sm', t('прогон', 'run'), True), ('bd', 'cs', t('классы', 'classes'), True), ('co', 'ix', t('общее U', 'shared U'), True)], 3, 3,
      t('Контейнеры игры: страница, сборка, содержание, симуляция, поле, интерфейс, ядро', 'Game containers: page, assembly, content, simulation, board, UI, core'))
      , t('Симуляция ничего не знает об экране: её рисует поле, и она же целиком работает в Node. Уровни описывают только механику, все слова лежат в двух словарях.', 'The simulation knows nothing about the screen: the board draws it, and it runs whole in Node. Levels describe mechanics only; every word lives in two dictionaries.')))
    # ---- C3
    P.append(H2('c3', t('C4 уровня 3: компоненты контекстов', 'C4 level 3: components of each context')))
    P.append(t('Все части — обычные скрипты с реестром `L`, как в остальных играх репозитория: `L.def` объявляет часть, `L.use` берёт её и выполняет при первом обращении. Цикл зависимостей падает сразу с понятной ошибкой. Общий экспорт части складывают в пространство имён `U` из `core.js`.',
               'All parts are plain scripts with the `L` registry, as in the other games of the repository: `L.def` declares a part, `L.use` fetches it and runs it on first use. A dependency cycle fails at once with a clear error. Parts put their shared exports into the `U` namespace from `core.js`.'))
    def c3(title, svg, bullets):
        cap = re.search(r'aria-label="([^"]*)"', svg).group(1)
        P.append(H3(title)); P.append(fig(svg, cap))
        P.append('\n'.join('- ' + b for b in bullets))
    c3(t('Симуляция', 'Simulation'), flow({
        'sm': (1, 1, ['Sim', 'step, result'], 'c'),
        'md': (0, 1, [t('Модель', 'Model'), 'model.js'], 'c'),
        'in': (1, 0, [t('Аварии', 'Incidents'), 'fireIncidents'], 'c'),
        'sc': (2, 0, [t('Масштаб', 'Scaling'), 'scale, k8sTick'], 'c'),
        'st': (2, 1, [t('Состояние узлов', 'Node state'), 'svcState, dbState'], 'c'),
        'ch': (2, 2, [t('Очереди, сокеты', 'Queues, sockets'), 'channels, wsTick'], 'c'),
        'rs': (1, 2, [t('Итог', 'Result'), 'result, evalObjective'], 'c'),
        'rn': (0, 2, [t('Прогон', 'Run'), 'run.js'], 'c'),
      }, [('sm', 'md', t('константы, цены', 'constants, prices'), False), ('sm', 'in', '', False), ('sm', 'sc', '', False), ('sm', 'st', t('по прошлому тику', 'from last tick'), False), ('sm', 'ch', '', False), ('sm', 'rs', '', False), ('rn', 'sm', t('до конца', 'to the end'), False)], 3, 3,
       t('Компоненты симуляции потока', 'Components of the flow simulation')),
      [t('**Модель** хранит каталог из 25 блоков, допустимые связи, цены в месяц, очередь Erlang C и кривую трафика уровня.', '**Model** holds the catalogue of 25 blocks, allowed links, monthly prices, the Erlang C queue and the level’s traffic curve.'),
       t('**Sim.step** раз в полсекунды игрового времени: аварии, масштабирование, состояние узлов по нагрузке прошлого тика, затем поток сегментов по трубам со стеком вызовов и тайм-аутами.', '**Sim.step** every half second of game time: incidents, scaling, node state from the previous tick’s load, then segments flow through the pipes with a call stack and timeouts.'),
       t('**Аварии** — 27 видов: всплеск, падение зоны, региона или облака, истёкший сертификат, плохой выпуск, утечка памяти, боты и другие.', '**Incidents** come in 27 kinds: spike, zone, region or cloud outage, an expired certificate, a bad deploy, a memory leak, bots and more.'),
       t('**Итог** сводит доступность, ожидание (p95), деньги, проверки уровня и звёзды; **Прогон** делает то же без экрана и разгоняет трафик в нагрузочном тесте.', '**Result** folds availability, wait time (p95), money, level checks and stars; **Run** does the same without a screen and ramps traffic for the load test.')])
    c3(t('Поле', 'Board'), flow({
        'bd': (1, 1, ['Board', 'render, live'], 'c'),
        'nd': (0, 0, [t('Баки', 'Tanks'), 'renderNode'], 'c'),
        'pp': (1, 0, [t('Трубы', 'Pipes'), 'layoutEdges'], 'c'),
        'hl': (2, 0, [t('Группы', 'Groups'), 'renderHulls'], 'c'),
        'dt': (2, 1, [t('Точки потока', 'Flow dots'), 'animateDots'], 'c'),
        'in': (0, 1, [t('Ввод', 'Input'), t('перетаскивание, связь', 'drag, link')], 'c'),
        'sm': (1, 2, ['Sim', t('(другой контекст)', '(other context)')], 'x'),
      }, [('bd', 'nd', '', False), ('bd', 'pp', '', False), ('bd', 'hl', '', False), ('bd', 'dt', '', False), ('bd', 'in', '', False), ('bd', 'sm', t('читает rt, tick', 'reads rt, tick'), True)], 3, 3,
       t('Компоненты поля', 'Board components')),
      [t('**Бак** — блок с заливкой: уровень показывает загрузку, цвет — справляется ли блок.', '**A tank** is a block with fill: the level shows load, the colour shows whether it copes.'),
       t('**Труба**: толщина — объём потока, пунктир — асинхронно, свой цвет у команд, событий, сокетов и общей базы.', '**A pipe**: thickness is volume, dashes mean async, commands, events, sockets and a shared database each have a colour.'),
       t('**Туман**: на уровнях про наблюдаемость данные блоков скрыты, пока не поставлены мониторинг, логи или трейсинг.', '**Fog**: on observability levels block data stays hidden until monitoring, logs or tracing are added.')])
    c3(t('Интерфейс', 'UI'), flow({
        'ap': (1, 1, ['app', t('экраны, цикл кадра', 'screens, frame loop')], 'c'),
        'hm': (0, 0, [t('Главная, уровни', 'Home, levels'), 'home, levels'], 'c'),
        'br': (1, 0, [t('Брифинг', 'Brief'), t('прогноз', 'prediction')], 'c'),
        'is': (2, 0, [t('Инспектор', 'Inspector'), t('настройки блока', 'block settings')], 'c'),
        'rm': (2, 1, [t('Разбор', 'Debrief'), t('ADR, путь, графики', 'ADR, path, charts')], 'c'),
        'co': (0, 1, [t('Обучение', 'Tutorial'), 'coach'], 'c'),
        'md': (0, 2, [t('Режимы', 'Modes'), t('выживание, песочница', 'survival, sandbox')], 'c'),
        'i1': (2, 2, ['i18n', t('язык, схема настроек', 'language, settings schema')], 'c'),
      }, [('ap', 'hm', '', False), ('ap', 'br', '', False), ('ap', 'is', '', False), ('ap', 'rm', '', False), ('ap', 'co', '', False), ('ap', 'md', '', False), ('ap', 'i1', 'U.t, U.CTL', False)], 3, 3,
       t('Компоненты интерфейса', 'UI components')),
      [t('**i18n** выбирает язык, переводит по ключу и описывает настройки каждого блока: переключатели, ступени, числа.', '**i18n** picks the language, translates by key and describes every block’s settings: toggles, segments, numbers.'),
       t('**Инспектор** показывает только те настройки, которые уровень уже открыл: сложность прибавляется постепенно.', '**The inspector** shows only the settings the level has opened so far: difficulty grows step by step.'),
       t('**Разбор** после забега: решение в виде ADR с плюсами и минусами, путь запроса по частям ожидания и графики.', '**The debrief** after a run: the decision as an ADR with pros and cons, the request path split into wait parts, and charts.')])
    # ---- paths
    P.append(H2('paths', t('Четыре критических пути', 'Four critical paths')))
    def sq(title, parts, msgs, cap, label):
        P.append(H3(title)); P.append(fig(seq(parts, msgs, label), cap))
    sq(t('1. Запуск и уровень', '1. Startup and a level'),
       [('u', t('Игрок', 'Player')), ('i', 'index.html'), ('m', 'main'), ('a', 'app'), ('c', t('Уровни', 'Levels')), ('b', 'Board')],
       [('u', 'i', t('открывает', 'opens'), ''), ('i', 'm', t('скрипты по списку', 'scripts in order'), ''), ('m', 'a', 'start()', ''), ('a', 'u', t('главная', 'home'), 'r'), ('u', 'a', t('уровень', 'a level'), ''),
        ('a', 'c', 'levelById, startArch', ''), ('a', 'u', t('брифинг, прогноз', 'brief, prediction'), 'r'), ('u', 'a', t('ответ', 'answer'), ''), ('a', 'b', 'new Board(arch)', ''), ('b', 'u', t('поле', 'the board'), 'r')],
       t('Прогноз «что сломается» — кнопка старта: игрок сначала делает ставку, потом видит поток.', 'The “what breaks” prediction is the start button: the player bets first, then sees the flow.'), t('Последовательность запуска', 'Startup sequence'))
    sq(t('2. Шаг симуляции', '2. A simulation step'),
       [('f', 'frame'), ('s', 'Sim'), ('i', t('Аварии', 'Incidents')), ('n', t('Узлы', 'Nodes')), ('q', t('Очереди', 'Queues')), ('b', 'Board')],
       [('f', 's', 'step()', ''), ('s', 'i', 'fireIncidents', ''), ('s', 's', 'scale, k8sTick', 's'), ('s', 'n', t('состояние по прошлому тику', 'state from last tick'), ''), ('s', 's', t('сегменты по трубам', 'segments through pipes'), 's'),
        ('s', 'q', 'channels, wsTick', ''), ('s', 's', t('тайм-ауты, повторы', 'timeouts, retries'), 's'), ('s', 'f', 'tick: av, p95, $', 'r'), ('f', 'b', t('live(sim): баки, трубы, точки', 'live(sim): tanks, pipes, dots'), '')],
       t('Состояние узла берётся из нагрузки прошлого тика, поэтому порядок обхода не важен и цепочки A → B → C → A считаются естественно. Шаг фиксированный, до 80 шагов за кадр на ускорении.', 'A node’s state comes from the previous tick’s load, so traversal order does not matter and chains A → B → C → A work naturally. The step is fixed, up to 80 steps a frame at high speed.'), t('Последовательность шага симуляции', 'Simulation step sequence'))
    sq(t('3. Правка на паузе', '3. Editing on pause'),
       [('u', t('Игрок', 'Player')), ('b', 'Board'), ('a', 'app'), ('s', 'Sim'), ('i', t('Инспектор', 'Inspector'))],
       [('u', 'a', t('пауза', 'pause'), ''), ('u', 'b', t('щелчок по блоку', 'click a block'), ''), ('b', 'a', 'select(n)', ''), ('a', 'i', t('видимые настройки', 'visible settings'), ''), ('u', 'i', t('меняет', 'changes'), ''),
        ('i', 'a', 'setCfg', ''), ('a', 'b', 'updateStatic', ''), ('u', 'a', t('дальше', 'resume'), ''), ('a', 's', 'setArch(arch)', ''), ('s', 's', t('прогретое сохраняется', 'warm state kept'), 's')],
       t('Новая схема подменяется на ходу: работающие машины, очереди и кэши остаются, новые машины загружаются как в жизни.', 'The new scheme is swapped in on the fly: running machines, queues and caches stay, new machines boot as in real life.'), t('Последовательность правки на паузе', 'Editing on pause sequence'))
    sq(t('4. Итог и разбор', '4. Result and debrief'),
       [('f', 'frame'), ('s', 'Sim'), ('a', 'app'), ('l', 'localStorage'), ('u', t('Игрок', 'Player'))],
       [('f', 's', 'done()', ''), ('f', 'a', 'finishLevel', ''), ('a', 's', 'result()', ''), ('s', 's', t('проверки, звёзды', 'checks, stars'), 's'), ('s', 'a', 'res', 'r'),
        ('a', 'l', t('звёзды, достижения', 'stars, achievements'), ''), ('a', 'u', t('итог, прогноз', 'result, prediction'), 'r'), ('a', 'u', t('ADR, путь запроса', 'ADR, request path'), 'r')],
       t('Итог отвечает на два вопроса: выдержала ли система и почему. Разбор раскладывает ожидание по частям и показывает, где было тонко.', 'The result answers two questions: did the system hold and why. The debrief splits the wait into parts and shows where it was thin.'), t('Последовательность итога', 'Result sequence'))
    # ---- rules
    P.append(H2('rules', t('Правила, на которых всё держится', 'The rules everything rests on')))
    P.append('\n'.join('- ' + x for x in [
        t('**Симуляция не знает об экране.** Ни DOM, ни SVG: поле читает её состояние после шага.', '**The simulation knows nothing about the screen.** No DOM, no SVG: the board reads its state after a step.'),
        t('**Уровень — данные.** Трафик, аварии, цели и стартовая схема; слова — в двух словарях с одинаковыми ключами.', '**A level is data.** Traffic, incidents, goals and the starting scheme; words live in two dictionaries with the same keys.'),
        t('**Каждый уровень доказан.** Тест прогоняет наивную схему (должна провалиться) и эталонную (должна пройти на две звезды и выше) для всех 43 уровней и дневных заданий.', '**Every level is proven.** A test runs a naive scheme (must fail) and a reference one (must pass with two stars or more) for all 43 levels and the daily tasks.'),
        t('**Один шаг — полсекунды.** Фиксированный шаг даёт одинаковый забег на любой машине.', '**One step is half a second.** A fixed step gives the same run on any machine.'),
        t('**Сложность по капле.** Новые блоки и настройки открываются уровнем, на котором они нужны.', '**Difficulty drop by drop.** New blocks and settings open on the level that needs them.')]))
    P.append(H2('weak', t('Слабые места', 'Weak spots')))
    wk = [(t('Большой интерфейс', 'Big UI'), t('ui/app.js на 870 строк держит все экраны, инспектор, обучение и режимы в одном замыкании.', 'ui/app.js, about 870 lines, holds every screen, the inspector, the tutorial and the modes in one closure.')),
          (t('Длинный шаг', 'Long step'), t('Sim.step около 350 строк: поток, повторы, тайм-ауты и аварии в одном методе.', 'Sim.step is about 350 lines: flow, retries, timeouts and incidents in one method.')),
          (t('Общее пространство имён', 'Shared namespace'), t('Части пишут экспорт в `U`, поэтому зависимость видна по `L.use`, а конкретное имя — только по поиску.', 'Parts write exports into `U`, so a dependency shows in `L.use`, but a specific name only by search.')),
          (t('Баланс константами', 'Balance by constants'), t('Числа в `K` подобраны вручную; держит их только тест наивных и эталонных схем.', 'The numbers in `K` are hand-tuned; only the naive and reference scheme test holds them.')),
          (t('Тест в браузере по времени', 'Timing-based browser test'), t('Проверка интерфейса ждёт по секундам и на холодном старте браузера иногда опаздывает.', 'The UI check waits by seconds and sometimes runs late on a cold browser start.'))]
    P.append('| ' + t('Где', 'Where') + ' | ' + t('Что не так', 'What is wrong') + ' |\n|---|---|\n' + '\n'.join(f'| **{a}** | {b} |' for a, b in wk))
    return P

meta = {
 'ru': ('Архитектура игры «Аптайм»: C4 и критические пути', 'Схемы C4 до уровня компонентов и четыре критических пути через sequence: запуск уровня, шаг симуляции потока, правка на паузе и итог с разбором.', 'Архитектура, Игры, C4, Системный дизайн'),
 'en': ('Architecture of “Uptime”: C4 and critical paths', 'C4 diagrams down to components and four critical paths as sequences: starting a level, a flow simulation step, editing on pause and the result with a debrief.', 'Architecture, Games, C4, System design'),
}
TOC = {'ru': [('c4', 'C4: контекст и контейнеры'), ('c3', 'Компоненты'), ('paths', 'Критические пути'), ('rules', 'Правила'), ('weak', 'Слабые места')],
       'en': [('c4', 'C4: context and containers'), ('c3', 'Components'), ('paths', 'Critical paths'), ('rules', 'Rules'), ('weak', 'Weak spots')]}
HEAD = {'ru': {'c4': 'C4: контекст и контейнеры', 'c3': 'C4 уровня 3: компоненты контекстов', 'paths': 'Четыре критических пути', 'rules': 'Правила, на которых всё держится', 'weak': 'Слабые места'},
        'en': {'c4': 'C4: context and containers', 'c3': 'C4 level 3: components of each context', 'paths': 'Four critical paths', 'rules': 'The rules everything rests on', 'weak': 'Weak spots'}}
os.makedirs(OUT, exist_ok=True)
for L, name in (('ru', 'architecture.ru.md'), ('en', 'architecture.md')):
    _n[0] = 0; _lang[0] = L
    parts = build(L); title, desc, tags = meta[L]
    open(f'{OUT}/{name}', 'w').write(f'# {title}\n\n' + '\n\n'.join(parts) + '\n')
json.dump({'slug': 'uptime-architecture', 'date': '2026-10-02', 'layout': 'wide', 'mentions': 'C4 model, SVG, system design, Uptime',
           'ru': {'file': 'architecture.ru.md', 'title': meta['ru'][0], 'description': meta['ru'][1], 'tags': meta['ru'][2], 'toc': [{'id': i, 'heading': HEAD['ru'][i], 'label': l} for i, l in TOC['ru']]},
           'en': {'file': 'architecture.md', 'title': meta['en'][0], 'description': meta['en'][1], 'tags': meta['en'][2], 'toc': [{'id': i, 'heading': HEAD['en'][i], 'label': l} for i, l in TOC['en']]}},
          open(f'{OUT}/post.json', 'w'), ensure_ascii=False, indent=1)
print('ok', OUT)
