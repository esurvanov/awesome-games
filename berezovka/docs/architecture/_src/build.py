import sys, os, re, json; sys.path.insert(0, '.')
from svgs import flow, seq, standalone
OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
NAMES = ['c4-context', 'c4-containers', 'c3-page', 'c3-look', 'c3-motion', 'c3-layout', 'c3-assets', 'seq-start', 'seq-frame', 'seq-quest', 'seq-quality']
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
      'Берёзовка — заснеженная деревня в браузере: открытый мир около километра, сюжет, «Жигули», рыбалка. Без сервера и без сборки: одна страница и пять модулей. Ниже: окружение, схемы C4 до компонентов и четыре пути, на которых всё держится.',
      'Berezovka is a snowbound village in the browser: an open world about a kilometre across, a story, a Zhiguli, ice fishing. No server and no build step: one page and five modules. Below: the surroundings, C4 diagrams down to components and the four paths everything rests on.'))
    # ---- who surrounds
    P.append(H2('ctx', t('Кто вокруг игры', 'Who surrounds the game')))
    P.append('| ' + t('Кто', 'Who') + ' | ' + t('Что даёт или берёт', 'What it gives or takes') + ' |\n|---|---|\n' + '\n'.join('| ' + a + ' | ' + b + ' |' for a, b in [
        (t('**Игрок**', '**Player**'), t('клавиатура, мышь или сенсорный экран; получает картинку и звук', 'keyboard, mouse or touch; gets picture and sound')),
        (t('**Статический хостинг**', '**Static host**'), t('отдаёт страницу, модули, пакеты моделей, текстуры и звуки', 'serves the page, modules, model packs, textures and sounds')),
        (t('**CDN jsDelivr**', '**jsDelivr CDN**'), t('библиотека three.js r158', 'the three.js r158 library')),
        (t('**Google Fonts**', '**Google Fonts**'), t('два шрифта для интерфейса; без них игра идёт на запасном', 'two interface fonts; without them the game uses a fallback')),
        (t('**Браузер**', '**Browser**'), t('WebGL 2, звук, localStorage для сохранения', 'WebGL 2, audio, localStorage for the save'))]))
    # ---- C4 L1/L2
    P.append(H2('c4', t('C4: контекст и контейнеры', 'C4: context and containers')))
    P.append(H3(t('Уровень 1. Система и её окружение', 'Level 1. The system and its surroundings')))
    P.append(fig(flow({
        'pl': (0, 1, [t('Игрок', 'Player'), t('клавиатура, мышь, касание', 'keyboard, mouse, touch')], 'p'),
        'gm': (1, 1, [t('«Берёзовка»', '“Berezovka”'), t('игра в браузере', 'a browser game')], 'c'),
        'cd': (2, 0, [t('CDN jsDelivr', 'jsDelivr CDN'), 'three.js'], 'x'),
        'ft': (2, 2, ['Google Fonts', t('шрифты', 'fonts')], 'x'),
      }, [('pl', 'gm', t('играет', 'plays'), False), ('gm', 'cd', t('грузит библиотеку', 'loads the library'), False), ('gm', 'ft', t('грузит шрифты', 'loads fonts'), True)], 4, 3,
      t('Контекст системы: игрок, игра, CDN и шрифты', 'System context: the player, the game, a CDN and fonts')),
      t('Своего сервера у игры нет: всё работает из статических файлов, прогресс лежит в браузере.', 'The game has no server of its own: it runs from static files and progress lives in the browser.')))
    P.append(H3(t('Уровень 2. Контейнеры', 'Level 2. Containers')))
    P.append(fig(flow({
        'pg': (0, 1, [t('Страница', 'Page'), 'index.html', t('цикл, сюжет, мир', 'loop, story, world')], 'c'),
        'md': (1, 0, [t('Модули', 'Modules'), 'src/*.js', t('свет, движение, лес', 'light, motion, forest')], 'c'),
        'pk': (1, 1, [t('Пакеты и текстуры', 'Packs and textures'), 'assets/', t('модели, небо, звуки', 'models, sky, sounds')], 'c'),
        'ls': (1, 2, [t('Сохранение', 'Save'), 'localStorage'], 'c'),
        'cd': (2, 0, ['CDN', 'three.js'], 'x'),
      }, [('pg', 'md', t('вызывает', 'calls'), False), ('pg', 'pk', t('загрузка', 'loading'), False), ('pg', 'ls', t('прогресс', 'progress'), False), ('md', 'cd', 'import', True), ('pg', 'cd', 'import', True)], 3, 3,
      t('Контейнеры игры: страница, модули, пакеты, сохранение', 'Game containers: page, modules, packs, save')),
      t('Страница владеет циклом и состоянием; модули получают всё нужное через переданный объект ctx и своих глобальных данных не заводят.', 'The page owns the loop and the state; modules get what they need through a passed ctx object and keep no globals of their own.')))
    # ---- C3
    P.append(H2('c3', t('C4 уровня 3: компоненты', 'C4 level 3: components')))
    P.append(t('Показаны контейнеры, где есть что разбирать: страница и четыре модуля плюс загрузка ассетов. Звук (`sound.js`) устроен просто: `makeSound(env)` получает снимок состояния игры и сам решает, что играть.',
               'The containers worth opening: the page, four modules and asset loading. Sound (`sound.js`) is simple: `makeSound(env)` receives a snapshot of the game state and decides what to play.'))
    def c3(title, svg, cap, bullets):
        P.append(H3(title)); P.append(fig(svg, cap))
        P.append('\n'.join('- ' + b for b in bullets))
    c3(t('Страница', 'Page'), flow({
        'lp': (0, 1, [t('Цикл', 'Loop'), 'loop(now)'], 'c'),
        'pl': (1, 0, [t('Игрок и машина', 'Player and car'), t('ввод, шаг', 'input, step')], 'c'),
        'co': (2, 0, [t('Столкновения', 'Collisions'), t('сетка коробок и кругов', 'grid of boxes, circles')], 'c'),
        'st': (2, 1, [t('Сюжет', 'Story'), t('13 этапов, диалоги', '13 stages, dialogue')], 'c'),
        'wd': (1, 1, [t('Мир и жители', 'World and life'), t('NPC, звери, погода', 'NPCs, animals, weather')], 'c'),
        'ui': (1, 2, [t('Интерфейс', 'Interface'), t('HUD, карта, компас', 'HUD, map, compass')], 'c'),
        'sv': (3, 1, [t('Сохранение', 'Save'), 'berezovka_v1'], 'c'),
        'rn': (0, 2, [t('Рендер', 'Render'), t('постобработка', 'post-processing')], 'c'),
      }, [('lp', 'pl', 'update', False), ('pl', 'co', t('позиция', 'position'), False), ('lp', 'wd', 'update', False), ('lp', 'ui', 'HUD', False), ('wd', 'st', t('предметы, речь', 'items, talk'), False), ('st', 'sv', t('этап', 'stage'), False), ('lp', 'rn', 'render', False)], 4, 3,
        t('Компоненты страницы', 'Components of the page')),
        t('Сюжет задаёт номер этапа; от него зависит, какие предметы видны и куда указывает стрелка задания.', 'The story sets a stage number; it decides which items are visible and where the quest arrow points.'),
        [t('Цикл ограничивает шаг по времени 0,05 с, чтобы после паузы ничего не «прыгнуло».', 'The loop caps one step at 0.05 s so nothing jumps after a pause.'),
         t('Сохранение пишется при смене этапа и каждые 15 секунд.', 'The save is written on every stage change and every 15 seconds.')])
    c3(t('Свет и вид', 'Look and light'), flow({
        'sk': (0, 1, [t('Небо', 'Sky'), 'buildSky', t('три панорамы', 'three panoramas')], 'c'),
        'up': (1, 0, [t('Смена суток', 'Day cycle'), 'update', t('солнце, туман, сияние', 'sun, fog, aurora')], 'c'),
        'sn': (1, 2, [t('Снег на моделях', 'Snow on models'), 'snowify'], 'c'),
        'ao': (2, 0, [t('Затенение углов', 'Corner shading'), 'addAO / setAO'], 'c'),
        'rm': (2, 2, [t('Материалы', 'Materials'), t('дорога, горы, облака', 'road, mountains, clouds')], 'c'),
        'gt': (3, 1, [t('Проверка вида', 'Look check'), 'gate'], 'c'),
      }, [('sk', 'up', t('единый источник', 'one source'), False), ('up', 'ao', '', False), ('sk', 'sn', '', False), ('sn', 'rm', '', False), ('up', 'gt', '', False), ('rm', 'gt', '', False)], 4, 3,
        t('Компоненты модуля «Свет и вид»', 'Components of the Look module')),
        t('Небо, окружающий свет и туман берутся из одних и тех же панорам, поэтому все модели стоят в одном свете.', 'Sky, ambient light and fog come from the same panoramas, so every model sits in the same light.'),
        [t('Днём и в пасмурь это панорамы Poly Haven, ночью своя картинка.', 'By day and in overcast it is Poly Haven panoramas, at night an image of its own.'),
         t('Затенение углов само выключается, если средний кадр дольше 33 мс.', 'Corner shading switches itself off if the average frame takes longer than 33 ms.')])
    c3(t('Движение', 'Motion'), flow({
        'hu': (0, 0, [t('Человек', 'Human'), 'humanStep'], 'c'),
        'ca': (0, 2, [t('Машина', 'Car'), 'carStep, suspStep'], 'c'),
        'ga': (1, 0, [t('Походка', 'Gait'), 'calibrate, gaitPlay'], 'c'),
        'im': (1, 2, [t('Удар', 'Impact'), 'carImpact'], 'c'),
        'qd': (2, 0, [t('Четвероногие', 'Quadrupeds'), 'makeQuad, updateQuad'], 'c'),
        'sm': (3, 1, [t('Проверки', 'Checks'), 'simHuman, simCar'], 'c'),
      }, [('hu', 'ga', t('скорость', 'speed'), False), ('ca', 'im', '', False), ('ga', 'qd', t('темп шага', 'step rate'), False), ('qd', 'sm', '', False), ('im', 'sm', '', False)], 4, 3,
        t('Компоненты модуля «Движение»', 'Components of the Motion module')),
        t('Чистая логика не зависит от three.js: человека и машину можно прогнать в тесте без экрана.', 'The pure logic does not depend on three.js: a human and a car can be run in a test with no screen.'),
        [t('Скорость растёт с конечным ускорением, поворот идёт дугой.', 'Speed grows with finite acceleration, turns follow an arc.'),
         t('Темп шага считается как скорость, делённая на длину шага клипа: ноги не скользят.', 'Step rate is speed divided by the clip’s stride length: feet do not slide.'),
         t('Машина: четыре пружины, крен, лёд, ручник; разгон 0–100 за около 18 с.', 'The car: four springs, body roll, ice, handbrake; 0–100 in about 18 s.')])
    c3(t('Расстановка и масштаб', 'Layout and scale'), flow({
        'pn': (0, 1, [t('План', 'Plan'), 'plan', t('повороты домов, зоны', 'house turns, zones')], 'c'),
        'vl': (1, 0, [t('Деревня и посёлок', 'Village and town'), 'buildVillage, buildTown'], 'c'),
        'fr': (1, 2, [t('Лес', 'Forest'), 'forestField, placeForest'], 'c'),
        'rl': (2, 0, [t('Реальные размеры', 'Real sizes'), 'REAL, fitReal'], 'c'),
        'gf': (3, 0, [t('Посадка на землю', 'Seating on ground'), 'groundFit'], 'c'),
        'tl': (2, 2, [t('Плитки и отсечение', 'Tiles and culling'), 'tiled, cullTiles'], 'c'),
      }, [('pn', 'vl', t('дворы', 'yards'), False), ('pn', 'fr', t('зоны', 'zones'), False), ('vl', 'rl', t('модель', 'model'), False), ('rl', 'gf', '', False), ('fr', 'tl', t('дальний лес', 'far forest'), False)], 4, 3,
        t('Компоненты модулей layout и scale', 'Components of the layout and scale modules')),
        t('Все расстановки считаются от одного зерна случайных чисел: мир каждый раз получается одинаковым.', 'All placement is driven by one fixed random seed: the world comes out the same every time.'),
        [t('Дом разворачивается к ближайшей дороге, двор получает забор и колею.', 'A house turns to the nearest road; the yard gets a fence and ruts.'),
         t('Размер модели сверяется с реальным: если выходит из допустимой полосы, ставится целевой.', 'A model’s size is checked against the real one: outside the band, the target size is used.'),
         t('Дальний лес режется на плитки и скрывается целиком, пока игрок далеко.', 'Far forest is cut into tiles and hidden whole while the player is away.')])
    c3(t('Загрузка ассетов', 'Asset loading'), flow({
        'ml': (0, 1, [t('Загрузчик', 'Loader'), 'loadModels, loadPack'], 'c'),
        'pk': (1, 0, [t('Пакеты моделей', 'Model packs'), t('GLB в base64', 'GLB in base64')], 'c'),
        'tx': (1, 2, [t('Текстуры', 'Textures'), t('небо, снег, скала', 'sky, snow, rock')], 'c'),
        'sf': (0, 2, [t('Звуки', 'Sounds'), 'assets/sfx'], 'c'),
        'lt': (2, 1, [t('Плитки загрузки', 'Load tiles'), t('что готово', 'what is ready')], 'c'),
        'mo': (3, 0, ['model()', t('клон из кэша', 'clone from cache')], 'c'),
      }, [('ml', 'pk', t('скрипт, разбор', 'script, parse'), False), ('ml', 'tx', '', False), ('pk', 'lt', '', False), ('tx', 'lt', '', False), ('pk', 'mo', '', False), ('ml', 'sf', t('отдельно', 'separately'), True)], 4, 3,
        t('Компоненты загрузки ассетов', 'Components of asset loading')),
        t('Модели лежат в .js-файлах как текст: так игра грузится с любого статического хостинга.', 'Models sit in .js files as text, so the game loads from any static host.'),
        [t('Загрузчик показывает группы ресурсов и помечает ту, где что-то не загрузилось.', 'The loader shows resource groups and marks the one where something failed.'),
         t('Звуки подгружаются отдельно, пока файла нет, играет синтез.', 'Sounds load separately; until a file arrives, a synthesised stand-in plays.')])
    # ---- sequences
    P.append(H2('paths', t('Четыре критических пути', 'Four critical paths')))
    def sq(title, parts, msgs, cap, label):
        P.append(H3(title)); P.append(fig(seq(parts, msgs, label), cap))
    sq(t('1. Запуск игры', '1. Starting the game'),
       [('u', t('Игрок', 'Player')), ('p', t('Страница', 'Page')), ('c', 'CDN'), ('l', t('Загрузчик', 'Loader')), ('m', t('Модули', 'Modules'))],
       [('u', 'p', t('открывает', 'opens'), ''), ('p', 'c', 'three.js', ''), ('c', 'p', t('библиотека', 'library'), 'r'), ('p', 'l', t('пакеты, текстуры', 'packs, textures'), ''), ('l', 'p', t('готово', 'ready'), 'r'),
        ('p', 'm', 'buildWorld, motionSetup', ''), ('m', 'p', t('мир собран', 'world built'), 'r'), ('p', 'p', t('рендер-цепочка', 'render chain'), 's'), ('p', 'u', t('меню', 'menu'), 'r'), ('u', 'p', t('«Новая игра»', '“New game”'), '')],
       t('Меню появляется, только когда загружено и собрано всё; кнопка «Продолжить» видна, если есть сохранение.', 'The menu appears only when everything is loaded and built; “Continue” shows if a save exists.'), t('Последовательность запуска', 'Startup sequence'))
    sq(t('2. Один кадр', '2. One frame'),
       [('l', t('Цикл', 'Loop')), ('e', t('Свет', 'Look')), ('h', t('Движение', 'Motion')), ('c', t('Столкн.', 'Collide')), ('w', t('Мир', 'World')), ('r', t('Рендер', 'Render'))],
       [('l', 'e', 'updateEnv', ''), ('l', 'h', t('шаг человека или машины', 'step human or car'), ''), ('h', 'c', t('новая позиция', 'new position'), ''), ('c', 'l', t('вытолкнуто', 'pushed out'), 'r'), ('l', 'w', t('жители, погода, лес', 'life, weather, forest'), ''), ('l', 'l', t('камера, HUD, звук', 'camera, HUD, audio'), 's'), ('l', 'r', 'render', '')],
       t('Если игра в меню, цикл только крутит камеру вокруг деревни; в загрузке ничего не делает.', 'In the menu the loop only orbits the camera around the village; while loading it does nothing.'), t('Последовательность одного кадра', 'Sequence of one frame'))
    sq(t('3. Шаг сюжета', '3. A story step'),
       [('u', t('Игрок', 'Player')), ('p', t('Страница', 'Page')), ('s', t('Сюжет', 'Story')), ('d', t('Диалог', 'Dialogue')), ('v', t('Сохранение', 'Save'))],
       [('u', 'p', t('E у героя', 'E near a character'), ''), ('p', 's', 'talk(id)', ''), ('s', 'd', t('реплики по этапу', 'lines for the stage'), ''), ('d', 'u', t('печатает, ждёт выбор', 'types, awaits choice'), 'r'), ('u', 'd', t('ответ', 'answer'), ''), ('d', 's', t('конец реплик', 'lines done'), 'r'), ('s', 's', 'setStage(n)', 's'), ('s', 'v', 'save()', ''), ('s', 'p', t('новая цель', 'new goal'), 'r')],
       t('Игра ведёт игрока по цепочке из 13 этапов; финал запускается колоколом на 12-м.', 'The game leads the player through a chain of 13 stages; the bell at stage 11 triggers the finale.'), t('Последовательность шага сюжета', 'Sequence of a story step'))
    sq(t('4. Слабая машина', '4. A weak machine'),
       [('p', t('Страница', 'Page')), ('l', t('Свет', 'Look')), ('r', t('Рендер', 'Render')), ('a', t('Затенение', 'Shading'))],
       [('p', 'r', t('сенсорный экран?', 'touch screen?'), ''), ('r', 'p', t('без постобработки', 'no post-processing'), 'r'), ('r', 'a', t('кадр', 'frame'), ''), ('l', 'l', t('копит время кадров 4 с', 'sums frame times for 4 s'), 's'), ('l', 'a', t('среднее больше 33 мс: выкл.', 'average over 33 ms: off'), ''), ('a', 'r', t('кадр без затенения', 'frame without shading'), 'r')],
       t('Игра снижает качество сама: на сенсорных экранах без постобработки, на медленных видеокартах без затенения углов.', 'The game lowers quality by itself: no post-processing on touch screens, no corner shading on slow GPUs.'), t('Последовательность подстройки качества', 'Quality adaptation sequence'))
    # ---- rules, weak spots
    P.append(H2('rules', t('Правила, на которых всё держится', 'The rules everything rests on')))
    P.append('\n'.join('- ' + x for x in [
        t('**Один источник света.** Небо, окружение и туман берутся из одних панорам.', '**One source of light.** Sky, ambient light and fog come from the same panoramas.'),
        t('**Модуль не заводит глобальных данных.** Всё приходит через ctx из страницы.', '**A module keeps no global data.** Everything arrives through ctx from the page.'),
        t('**Чистая логика отдельно от экрана.** Движение проверяется без three.js.', '**Pure logic apart from the screen.** Motion is tested without three.js.'),
        t('**Каждое измеримое свойство имеет проверку.** Игра печатает в консоль строки GATE … OK или FAIL: размеры зданий, скорость шага, скольжение ног, разгон машины, яркость кадра.', '**Every measurable property has a check.** The game prints GATE … OK or FAIL lines to the console: building sizes, walking speed, foot slip, car acceleration, frame brightness.'),
        t('**Мир детерминирован.** Расстановка идёт от фиксированного зерна.', '**The world is deterministic.** Placement runs from a fixed seed.')]))
    P.append(H2('weak', t('Слабые места', 'Weak spots')))
    wk = [(t('Страница-монолит', 'Monolithic page'), t('Цикл, сюжет, столкновения, интерфейс и сборка мира лежат в одном файле на полторы тысячи строк.', 'Loop, story, collisions, UI and world assembly sit in one file of about 1,500 lines.')),
          (t('Сюжет в коде', 'Story in code'), t('Реплики и этапы зашиты в функции talk; новую главу не добавить без правки страницы.', 'Lines and stages are hard-wired in talk(); a new chapter needs a page edit.')),
          (t('Вес загрузки', 'Load weight'), t('Около 33 МБ при первом запуске: модели в base64 и библиотека с внешнего CDN.', 'About 33 MB on first start: base64 models and a library from an external CDN.')),
          (t('Нет сервера', 'No server'), t('Сохранение живёт только в одном браузере и пропадает при очистке данных сайта.', 'The save lives in a single browser and vanishes when site data is cleared.')),
          (t('Телефоны', 'Phones'), t('Есть джойстик, но игра рассчитана на компьютер; на сенсорных экранах нет постобработки.', 'There is a joystick, but the game targets desktop; touch screens get no post-processing.'))]
    P.append('| ' + t('Где', 'Where') + ' | ' + t('Что не так', 'What is wrong') + ' |\n|---|---|\n' + '\n'.join(f'| **{a}** | {b} |' for a, b in wk))
    return P

meta = {
 'ru': ('Архитектура игры «Березовка»: C4 и критические пути', 'Окружение, схемы C4 до компонентов и четыре критических пути: запуск, кадр, шаг сюжета и подстройка под слабую машину.', 'Архитектура, Игры, C4, three.js'),
 'en': ('Architecture of “Berezovka”: C4 and critical paths', 'The surroundings, C4 diagrams down to components and four critical paths: startup, a frame, a story step and adapting to a weak machine.', 'Architecture, Games, C4, three.js'),
}
TOC = {'ru': [('ctx', 'Кто вокруг'), ('c4', 'C4: контекст и контейнеры'), ('c3', 'Компоненты'), ('paths', 'Критические пути'), ('rules', 'Правила'), ('weak', 'Слабые места')],
       'en': [('ctx', 'Surroundings'), ('c4', 'C4: context and containers'), ('c3', 'Components'), ('paths', 'Critical paths'), ('rules', 'Rules'), ('weak', 'Weak spots')]}
HEAD = {'ru': {'ctx': 'Кто вокруг игры', 'c4': 'C4: контекст и контейнеры', 'c3': 'C4 уровня 3: компоненты', 'paths': 'Четыре критических пути', 'rules': 'Правила, на которых всё держится', 'weak': 'Слабые места'},
        'en': {'ctx': 'Who surrounds the game', 'c4': 'C4: context and containers', 'c3': 'C4 level 3: components', 'paths': 'Four critical paths', 'rules': 'The rules everything rests on', 'weak': 'Weak spots'}}
os.makedirs(OUT, exist_ok=True)
for L, name in (('ru', 'architecture.ru.md'), ('en', 'architecture.md')):
    _n[0] = 0; _lang[0] = L
    parts = build(L); title, desc, tags = meta[L]
    open(f'{OUT}/{name}', 'w').write(f'# {title}\n\n' + '\n\n'.join(parts) + '\n')
json.dump({'slug': 'berezovka-architecture', 'date': '2026-10-02', 'layout': 'wide', 'mentions': 'three.js, C4 model, WebGL, Berezovka',
           'ru': {'file': 'architecture.ru.md', 'title': meta['ru'][0], 'description': meta['ru'][1], 'tags': meta['ru'][2], 'toc': [{'id': i, 'heading': HEAD['ru'][i], 'label': l} for i, l in TOC['ru']]},
           'en': {'file': 'architecture.md', 'title': meta['en'][0], 'description': meta['en'][1], 'tags': meta['en'][2], 'toc': [{'id': i, 'heading': HEAD['en'][i], 'label': l} for i, l in TOC['en']]}},
          open(f'{OUT}/post.json', 'w'), ensure_ascii=False, indent=1)
print('ok', OUT)
