import sys, os, re, json; sys.path.insert(0, '.')
from svgs import flow, seq, standalone
OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
NAMES = ['c4-context', 'c4-containers', 'c3-world', 'c3-body', 'c3-physics', 'c3-story', 'c3-quality', 'c3-assets', 'seq-start', 'seq-frame', 'seq-rock', 'seq-quality']
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
      'Игра «Эхо Разлома» — открытый остров 900 × 900 м в браузере: без движка и сборки, одна страница и набор модулей. Здесь описано, как она устроена: схемы C4 до уровня компонентов и четыре пути, на которых всё держится.',
      '“Echo of the Rift” is an open 900 × 900 m island in the browser: no engine and no build step, one page and a set of modules. This is how it is put together: C4 diagrams down to the component level and the four paths everything rests on.'))
    # ---- C4 L1/L2
    P.append(H2('c4', t('C4: контекст и контейнеры', 'C4: context and containers')))
    P.append(H3(t('Уровень 1. Система и её окружение', 'Level 1. The system and its surroundings')))
    P.append(fig(flow({
        'pl': (0, 1, [t('Игрок', 'Player'), t('клавиатура, мышь', 'keyboard, mouse')], 'p'),
        'gm': (1, 1, [t('«Эхо Разлома»', '“Echo of the Rift”'), t('игра в браузере', 'a browser game')], 'c'),
        'cd': (2, 0, [t('CDN jsDelivr', 'jsDelivr CDN'), 'three.js, Rapier'], 'x'),
      }, [('pl', 'gm', t('играет', 'plays'), False), ('gm', 'cd', t('грузит библиотеки', 'loads libraries'), False)], 4, 2,
      t('Контекст системы: игрок, игра и CDN', 'System context: the player, the game and a CDN'))
      , t('Всё необходимое для игры приходит из браузера и CDN. Своего сервера у игры нет: подойдёт любой статический хостинг.', 'Everything the game needs comes from the browser and the CDN. The game has no server of its own: any static host will do.')))
    P.append(H3(t('Уровень 2. Контейнеры', 'Level 2. Containers')))
    P.append(fig(flow({
        'pg': (0, 1, [t('Страница', 'Page'), 'open-world.html', t('цикл, сюжет, сборка мира', 'loop, story, world assembly')], 'c'),
        'md': (1, 0, [t('Модули', 'Modules'), 'modules/*.js', t('мир, тело, качество', 'world, body, quality')], 'c'),
        'ph': (1, 1, [t('Физика', 'Physics'), 'physics.js + Rapier'], 'c'),
        'wf': (1, 2, ['WorldFill', t('процедурное оформление', 'procedural dressing')], 'c'),
        'pk': (2, 0, [t('Пакеты ассетов', 'Asset packs'), 'pack, veg, baked'], 'c'),
        'cd': (2, 1, ['CDN', 'three.js, Rapier'], 'x'),
      }, [('pg', 'md', t('init и update по порядку', 'init and update in order'), False), ('pg', 'ph', t('шаг', 'step'), False), ('pg', 'wf', 'build', False), ('pg', 'pk', t('загрузка', 'loading'), False), ('md', 'ph', t('цели, лучи', 'goals, rays'), False), ('ph', 'cd', 'WASM', True)], 3, 3,
      t('Контейнеры игры: страница, модули, физика, WorldFill, пакеты', 'Game containers: page, modules, physics, WorldFill, packs'))
      , t('Страница владеет циклом и сюжетом, остальное подключается к ней. Модуль, который падает, отключается один.', 'The page owns the loop and the story; everything else plugs into it. A module that fails is switched off on its own.')))
    # ---- C3
    P.append(H2('c3', t('C4 уровня 3: компоненты контекстов', 'C4 level 3: components of each context')))
    P.append(t('Контексты общаются через общий объект `ctx` и несколько глобальных объектов. У каждого факта один хозяин: пилота двигает физика, кости пишет сборщик позы, о предметах мира знает реестр.',
               'Contexts talk through a shared `ctx` object and a few globals. Every fact has one owner: physics moves the pilot, the pose pipeline writes the bones, the registry knows the world’s objects.'))
    def c3(title, svg, cap, bullets):
        P.append(H3(title)); P.append(fig(svg, cap))
        P.append('\n'.join('- ' + b for b in bullets))
    c3(t('🌍 Мир', '🌍 World'), flow({
        'te': (0, 1, [t('Рельеф и снег', 'Terrain and snow'), 'terrain.js'], 'c'),
        'gb': (1, 0, [t('Контакт со снегом', 'Snow contact'), 'groundblend.js'], 'c'),
        'at': (1, 2, [t('Атмосфера', 'Atmosphere'), t('небо, сияние, туман', 'sky, aurora, fog')], 'c'),
        've': (2, 0, [t('Растительность', 'Vegetation'), t('деревья, трава', 'trees, grass')], 'c'),
        'st': (2, 1, [t('Постройки', 'Structures'), 'structures.js'], 'c'),
        'wf': (2, 2, ['WorldFill', t('горы, лёд, мелочь', 'mountains, ice, clutter')], 'c'),
        'pa': (3, 1, [t('Реестр Passport', 'Passport registry'), t('(контекст «Физика»)', '(Physics context)')], 'x'),
      }, [('te', 'gb', t('высота, снег', 'height, snow'), False), ('te', 've', t('посадка на снег', 'seating on snow'), False), ('ve', 'pa', t('стволы', 'trunks'), False), ('st', 'pa', t('стены', 'walls'), False), ('wf', 'pa', t('формы', 'shapes'), False)], 4, 3,
        t('Компоненты контекста «Мир»', 'Components of the World context')),
        t('Всё, что твёрдое, регистрируется в Passport и становится столкновением.', 'Everything solid registers in Passport and becomes a collision.'),
        [t('Деревья рисуются пакетами по материалам: один вызов отрисовки на материал.', 'Trees are drawn in batches per material: one draw call per material.'),
         t('Дальние деревья заменены картинками с восьми сторон.', 'Far trees are replaced by images from eight sides.')])
    c3(t('🧍 Тело и контакт', '🧍 Body and contact'), flow({
        'co': (0, 1, [t('Реестр CORE', 'CORE registry'), t('что это за объект', 'what the object is')], 'c'),
        'rb': (1, 0, [t('Мозг скал', 'Rock brain'), t('решает действие', 'decides the action')], 'c'),
        'ix': (1, 2, [t('Общее движение', 'General motion'), t('ноги, наклон, взгляд', 'legs, lean, look')], 'c'),
        'rf': (2, 0, [t('Ощущения', 'Feel'), t('звук, следы', 'sound, marks')], 'c'),
        'pp': (2, 1, [t('Сборщик позы', 'Pose pipeline'), t('пишет кости', 'writes the bones')], 'c'),
        'pb': (2, 2, [t('Пружины', 'Springs'), t('толчки, падение', 'knocks, falls')], 'c'),
        'bs': (3, 1, [t('Замер тела', 'Body measure'), 'BODYCONTACT'], 'c'),
      }, [('co', 'rb', t('вид объекта', 'object kind'), False), ('rb', 'pp', t('руки, наклон', 'hands, lean'), False), ('ix', 'pp', t('ноги, взгляд', 'legs, look'), False), ('pb', 'pp', t('пружины', 'springs'), False), ('pp', 'bs', t('замер, поправки', 'measure, fixes'), False), ('rb', 'rf', t('касание', 'touch'), False)], 4, 3,
        t('Компоненты контекста «Тело и контакт»', 'Components of the Body and contact context')),
        t('Четыре модуля просят, один пишет: сборщик позы — единственный, кто двигает кости.', 'Four modules ask, one writes: the pose pipeline is the only one that moves the bones.'),
        [t('Мозг скал читает форму камня и выбирает одно из действий: ладонь, спина, плечо, уступ, сесть, залезть.', 'The rock brain reads a rock’s shape and picks one action: palm, back, shoulder, ledge, sit, climb.'),
         t('Замер тела измеряет настоящую нарисованную форму, его же использует судья в тестах.', 'The body measure reads the real drawn shape; the judge in the tests uses the same one.')])
    c3(t('⚙️ Физика', '⚙️ Physics'), flow({
        'pa': (0, 1, [t('Реестр Passport', 'Passport registry'), t('объекты и роли', 'objects and roles')], 'c'),
        'cl': (1, 0, [t('Коллайдеры', 'Colliders'), t('оболочка и точная форма', 'hull and exact shape')], 'c'),
        'ch': (1, 2, [t('Контроллер пилота', 'Pilot controller'), t('капсула, эллипс у скал', 'capsule, ellipse at rocks')], 'c'),
        'rp': (2, 1, [t('Мир Rapier', 'Rapier world'), 'WASM'], 'c'),
        'qy': (3, 1, [t('Запросы', 'Queries'), t('лучи, касты, цель', 'rays, casts, goal')], 'c'),
      }, [('pa', 'cl', t('роль, форма', 'role, shape'), False), ('cl', 'rp', t('по расстоянию', 'by distance'), False), ('ch', 'rp', t('шаг', 'step'), False), ('rp', 'qy', t('ответы', 'answers'), False)], 4, 3,
        t('Компоненты контекста «Физика»', 'Components of the Physics context')),
        t('Физика — единственная, кто двигает пилота; остальные дают ей цель через setGoal.', 'Physics is the only mover of the pilot; everyone else gives it a goal through setGoal.'),
        [t('Рядом с пилотом камень получает точную форму, вдали остаётся упрощённая оболочка.', 'Near the pilot a rock gets its exact shape; far away it stays a simplified hull.'),
         t('У скал капсула пилота превращается в эллипс по размерам тела.', 'At rocks the pilot’s capsule becomes an ellipse sized from the body.')])
    c3(t('📖 Сюжет и интерфейс', '📖 Story and interface'), flow({
        'sg': (0, 1, [t('Главы и зоны', 'Chapters and zones'), 'STAGES, ZONES'], 'c'),
        'dl': (1, 0, [t('Диалоги', 'Dialogue'), t('выбор ответов', 'choices')], 'c'),
        'bt': (1, 2, [t('Бой', 'Combat'), t('кристаллы, голем', 'crystals, golem')], 'c'),
        'ui': (2, 1, [t('Интерфейс', 'Interface'), t('HUD, карта, журнал', 'HUD, map, journal')], 'c'),
        'sv': (3, 1, [t('Сохранения', 'Saves'), 'localStorage'], 'c'),
      }, [('sg', 'dl', t('сцены', 'scenes'), False), ('sg', 'bt', t('зоны', 'zones'), False), ('dl', 'ui', '', False), ('bt', 'ui', '', False), ('sg', 'sv', t('прогресс', 'progress'), False)], 4, 3,
        t('Компоненты контекста «Сюжет и интерфейс»', 'Components of the Story and interface context')),
        t('Этот контекст пока живёт внутри страницы и не вынесен в модули.', 'This context still lives inside the page and has not been split into modules.'),
        [t('Пять глав и два финала, 24 осколка и 8 записей-эхо.', 'Five chapters, two endings, 24 shards and 8 echo recordings.'),
         t('Прогресс хранится в браузере, без сервера.', 'Progress is stored in the browser, no server.')])
    c3(t('🎛 Качество', '🎛 Quality'), flow({
        'lo': (0, 1, [t('Выбор пресета', 'Preset picker'), 'LowEnd.pick'], 'c'),
        'qp': (1, 0, [t('Пресеты', 'Presets'), 'air … ultra'], 'c'),
        'gv': (1, 2, [t('Регулятор', 'Governor'), t('масштаб рендера по кадру', 'render scale by frame time')], 'c'),
        'sh': (2, 0, [t('Кэш теней', 'Shadow cache'), t('луна не движется', 'the moon never moves')], 'c'),
        'ld': (2, 2, [t('Детализация', 'Detail levels'), t('деревья, камни', 'trees, rocks')], 'c'),
        'tb': (3, 1, [t('Бюджет текстур', 'Texture budget'), 'texbudget'], 'c'),
      }, [('lo', 'qp', t('при старте', 'at start'), False), ('gv', 'qp', t('на ходу', 'on the fly'), False), ('qp', 'sh', t('радиус', 'radius'), False), ('qp', 'ld', t('дальность', 'range'), False), ('qp', 'tb', t('лимиты', 'limits'), False)], 4, 3,
        t('Компоненты контекста «Качество»', 'Components of the Quality context')),
        t('Пресет задаёт всё сразу: сначала подбирается по видеокарте, потом подстраивается по времени кадра.', 'A preset sets everything at once: picked by the GPU first, then tuned by frame time.'),
        [t('Луна не движется, поэтому тени от неподвижных предметов считаются один раз и лежат в кэше.', 'The moon never moves, so shadows of static objects are rendered once and cached.'),
         t('В меню, на паузе и в скрытой вкладке цикл полностью останавливается.', 'In the menu, on pause and in a hidden tab the loop stops completely.')])
    c3(t('📦 Ассеты', '📦 Assets'), flow({
        'ld': (0, 1, [t('Загрузчик', 'Loader'), 'loadPacked'], 'c'),
        'pk': (1, 0, [t('Пакеты', 'Packs'), t('GLB в base64', 'GLB in base64')], 'c'),
        'tx': (1, 2, [t('Текстуры', 'Textures'), 'assets/veg'], 'c'),
        'im': (2, 0, [t('Дальние деревья', 'Far trees'), t('картинки с 8 сторон', 'images from 8 sides')], 'c'),
        'bk': (2, 2, [t('Запечённый свет', 'Baked light'), 'baked.js'], 'c'),
        'wm': (3, 1, [t('Модули мира', 'World modules'), t('берут готовое', 'take what is ready')], 'c'),
      }, [('ld', 'pk', t('разбор', 'parse'), False), ('ld', 'tx', '', False), ('pk', 'wm', '', False), ('im', 'wm', '', False), ('bk', 'wm', '', False)], 4, 3,
        t('Компоненты контекста «Ассеты»', 'Components of the Assets context')),
        t('Модели лежат в .js-файлах как текст: так игра грузится с любого статического хостинга.', 'Models sit in .js files as text, so the game loads from any static host.'),
        [t('Загрузчик показывает список модулей и ресурсов, пока всё не готово.', 'The loader shows a list of modules and resources until everything is ready.'),
         t('Тяжёлое готовится заранее вне игры: картинки дальних деревьев и запечённый свет.', 'The heavy parts are prepared outside the game: far-tree images and baked light.')])
    # ---- sequences
    P.append(H2('paths', t('Четыре критических пути', 'Four critical paths')))
    def sq(title, parts, msgs, cap, label):
        P.append(H3(title)); P.append(fig(seq(parts, msgs, label), cap))
    sq(t('1. Запуск игры', '1. Starting the game'),
       [('u', t('Игрок', 'Player')), ('p', t('Страница', 'Page')), ('c', 'CDN'), ('l', t('Загрузчик', 'Loader')), ('f', t('Физика', 'Physics')), ('m', t('Модули', 'Modules'))],
       [('u', 'p', t('открывает', 'opens'), ''), ('p', 'c', 'three.js, Rapier', ''), ('c', 'p', t('библиотеки', 'libraries'), 'r'), ('p', 'l', t('пакеты, текстуры', 'packs, textures'), ''), ('l', 'p', t('готово', 'ready'), 'r'),
        ('p', 'f', t('ждёт PhysReady', 'awaits PhysReady'), ''), ('f', 'p', t('мир создан', 'world built'), 'r'), ('p', 'm', t('init по возрастанию order', 'init in ascending order'), ''), ('m', 'p', t('мир собран', 'world assembled'), 'r'), ('p', 'u', t('меню, новая игра', 'menu, new game'), 'r')],
       t('Игра не стартует, пока не готовы библиотеки, физика и модули.', 'The game does not start until the libraries, physics and modules are ready.'), t('Последовательность запуска', 'Startup sequence'))
    sq(t('2. Один кадр', '2. One frame'),
       [('l', t('Цикл', 'Loop')), ('f', t('Физика', 'Physics')), ('m', t('Модули', 'Modules')), ('w', t('Мир', 'World')), ('r', t('Рендер', 'Render')), ('h', t('Интерфейс', 'HUD'))],
       [('l', 'f', t('шаг пилота', 'step the pilot'), ''), ('f', 'l', t('положение', 'position'), 'r'), ('l', 'm', 'update(dt)', ''), ('m', 'm', t('убывание order: тело, затем мир', 'descending order: body, then world'), 'n'), ('m', 'w', t('снег, деревья, небо', 'snow, trees, sky'), ''), ('l', 'r', t('кадр', 'frame'), ''), ('r', 'h', 'HUD', '')],
       t('Модули идут по убыванию order: сначала тело (55 … 40), последними мир (−10).', 'Modules run in descending order: the body first (55 … 40), the world last (−10).'), t('Последовательность одного кадра', 'Sequence of one frame'))
    sq(t('3. Пилот у скалы', '3. The pilot at a rock'),
       [('i', t('Ввод', 'Input')), ('f', t('Физика', 'Physics')), ('x', t('Движение', 'Motion')), ('b', t('Мозг скал', 'Rock brain')), ('p', t('Сборщик', 'Pipeline')), ('r', t('Рендер', 'Render'))],
       [('i', 'f', t('идти к скале', 'walk to the rock'), ''), ('f', 'x', t('положение', 'position'), 'r'), ('x', 'p', t('ноги, наклон, взгляд', 'legs, lean, look'), ''), ('b', 'b', t('читает форму, выбирает', 'reads shape, chooses'), 's'), ('b', 'f', t('цель: встать здесь', 'goal: stand here'), ''), ('b', 'p', t('руки на точки', 'hands to points'), ''), ('p', 'p', t('замер, поправки', 'measure, fixes'), 's'), ('p', 'r', t('кости', 'bones'), '')],
       t('Решает мозг скал, двигает физика, кости пишет сборщик.', 'The rock brain decides, physics moves, the pipeline writes the bones.'), t('Последовательность касания скалы', 'Sequence of touching a rock'))
    sq(t('4. Подстройка качества', '4. Quality tuning'),
       [('p', t('Страница', 'Page')), ('u', t('Выбор пресета', 'Picker')), ('g', t('Регулятор', 'Governor')), ('w', t('Мир', 'World')), ('r', t('Рендер', 'Render'))],
       [('p', 'u', t('видеокарта?', 'which GPU?'), ''), ('u', 'p', t('пресет', 'preset'), 'r'), ('p', 'w', t('дальность, тени', 'range, shadows'), ''), ('r', 'g', t('время кадра', 'frame time'), ''), ('g', 'r', t('масштаб рендера', 'render scale'), 'r'), ('g', 'w', t('дальность деревьев', 'tree range'), '')],
       t('Сначала грубый выбор по видеокарте, потом мелкая подстройка по каждому кадру.', 'A coarse pick by the GPU first, then fine tuning from every frame.'), t('Последовательность подстройки качества', 'Quality tuning sequence'))
    # ---- rules, weak spots
    P.append(H2('rules', t('Правила, на которых всё держится', 'The rules everything rests on')))
    P.append('\n'.join('- ' + x for x in [
        t('**Физика единственная двигает пилота.** Остальные дают цель.', '**Physics is the only mover of the pilot.** Everyone else gives a goal.'),
        t('**Сборщик позы единственный пишет кости.** Остальные присылают запросы.', '**The pose pipeline is the only writer of the bones.** Others send requests.'),
        t('**Реестр Passport единственный знает о предметах мира.** Столкновения строятся из него.', '**The Passport registry is the only one that knows the world’s objects.** Collisions are built from it.'),
        t('**Модуль падает один.** Ошибка отключает только его.', '**A module fails alone.** An error switches off only that module.'),
        t('**Один замер «внутри камня».** Игра и проверки меряют одинаково.', '**One “inside the rock” measure.** The game and the tests measure the same way.')]))
    P.append(H2('weak', t('Слабые места', 'Weak spots')))
    wk = [(t('Страница-монолит', 'Monolithic page'), t('Сюжет, цикл и реестр Passport лежат в одном файле на 4,5 тысячи строк, границ между ними нет.', 'The story, the loop and the Passport registry sit in one 4.5 k-line file with no boundaries between them.')),
          (t('Порядок модулей', 'Module order'), t('Порядок задан числами в коде; ошибка в числе меняет поведение молча.', 'The order is set by numbers in code; a wrong number changes behaviour silently.')),
          (t('Глобальные объекты', 'Globals'), t('Модули обмениваются через window.*: связи не видны в коде.', 'Modules exchange data through window.*: links are invisible in the code.')),
          (t('Поза пилота', 'Pilot pose'), t('Итоговую позу решают несколько модулей; единого владельца ещё нет.', 'Several modules decide the final pose; there is no single owner yet.')),
          (t('Вес загрузки', 'Load weight'), t('Пакеты в base64 и библиотеки с внешнего CDN.', 'Base64 packs and libraries from an external CDN.'))]
    P.append('| ' + t('Где', 'Where') + ' | ' + t('Что не так', 'What is wrong') + ' |\n|---|---|\n' + '\n'.join(f'| **{a}** | {b} |' for a, b in wk))
    return P

meta = {
 'ru': ('Архитектура игры «Эхо Разлома»: C4 и критические пути', 'Схемы C4 до уровня компонентов и четыре критических пути через sequence: запуск, кадр, касание скалы и подстройка качества.', 'Архитектура, Игры, C4, three.js'),
 'en': ('Architecture of “Echo of the Rift”: C4 and critical paths', 'C4 diagrams down to components and four critical paths as sequences: startup, a frame, touching a rock and quality tuning.', 'Architecture, Games, C4, three.js'),
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
json.dump({'slug': 'echo-of-the-rift-architecture', 'date': '2026-10-02', 'layout': 'wide', 'mentions': 'three.js, Rapier, C4 model, WebGL, Echo of the Rift',
           'ru': {'file': 'architecture.ru.md', 'title': meta['ru'][0], 'description': meta['ru'][1], 'tags': meta['ru'][2], 'toc': [{'id': i, 'heading': HEAD['ru'][i], 'label': l} for i, l in TOC['ru']]},
           'en': {'file': 'architecture.md', 'title': meta['en'][0], 'description': meta['en'][1], 'tags': meta['en'][2], 'toc': [{'id': i, 'heading': HEAD['en'][i], 'label': l} for i, l in TOC['en']]}},
          open(f'{OUT}/post.json', 'w'), ensure_ascii=False, indent=1)
print('ok', OUT)
