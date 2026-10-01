import sys, os, re, json; sys.path.insert(0, '.')
from svgs import flow, seq, standalone
OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
NAMES = ['c4-context', 'c4-containers', 'c3-play', 'c3-scene', 'seq-start', 'seq-frame', 'seq-input', 'seq-crash']
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
      'Игра «Северный Разлом» — 3D-аркада про полёт по бесконечному ледяному каньону: один файл `index.html` около 70 КБ, без сборки и без своих ассетов. Здесь описано, как она устроена: схемы C4 до уровня компонентов и четыре пути, на которых всё держится.',
      '“Northern Rift” is a 3D arcade about flying down an endless ice canyon: a single `index.html` of about 70 KB, no build step and no assets of its own. This is how it is put together: C4 diagrams down to the component level and the four paths everything rests on.'))
    P.append(H2('c4', t('C4: контекст и контейнеры', 'C4: context and containers')))
    P.append(H3(t('Уровень 1. Система и её окружение', 'Level 1. The system and its surroundings')))
    P.append(fig(flow({
        'pl': (0, 1, [t('Игрок', 'Player'), t('клавиатура, касания', 'keyboard, touch')], 'p'),
        'gm': (1, 1, [t('«Северный Разлом»', '“Northern Rift”'), t('игра в браузере', 'a browser game')], 'c'),
        'cd': (2, 0, [t('CDN cdnjs', 'cdnjs CDN'), 'three.js r128'], 'x'),
        'gf': (2, 2, ['Google Fonts', 'Tektur, Onest'], 'x'),
      }, [('pl', 'gm', t('играет', 'plays'), False), ('gm', 'cd', t('грузит движок', 'loads the engine'), False), ('gm', 'gf', t('шрифты', 'fonts'), False)], 4, 3,
      t('Контекст системы: игрок, игра, CDN и шрифты', 'System context: the player, the game, a CDN and fonts'))
      , t('Своего сервера у игры нет: подойдёт любой статический хостинг. Без three.js игра показывает просьбу обновить страницу.', 'The game has no server of its own: any static host will do. Without three.js it asks the player to reload the page.')))
    P.append(H3(t('Уровень 2. Контейнеры', 'Level 2. Containers')))
    P.append(fig(flow({
        'pg': (0, 1, [t('Страница', 'Page'), 'index.html', t('меню, HUD, экраны', 'menu, HUD, screens')], 'c'),
        'js': (1, 1, [t('Скрипт игры', 'Game script'), t('один блок, ~950 строк', 'one block, ~950 lines')], 'c'),
        'th': (2, 0, ['three.js', t('сцена, шейдеры, WebGL', 'scene, shaders, WebGL')], 'x'),
        'au': (2, 1, ['Web Audio', t('музыка и эффекты', 'music and effects')], 'x'),
        'ls': (2, 2, ['localStorage', t('рекорд, звук', 'record, sound')], 'x'),
      }, [('pg', 'js', t('кнопки, клавиши', 'buttons, keys'), False), ('js', 'th', t('рендер', 'render'), False), ('js', 'au', t('синтез', 'synthesis'), False), ('js', 'ls', t('читает, пишет', 'reads, writes'), False)], 3, 3,
      t('Контейнеры игры: страница, скрипт и встроенные возможности браузера', 'Game containers: the page, the script and built-in browser features'))
      , t('Звука-файлов и картинок нет: музыка синтезируется на лету, мир рисуется шейдерами.', 'There are no sound or image files: the music is synthesised on the fly and the world is drawn by shaders.')))
    P.append(H2('c3', t('C4 уровня 3: компоненты контекстов', 'C4 level 3: components of each context')))
    P.append(t('Скрипт делится на два контекста. Правила игры хранят состояние и решают, что произошло; сцена и звук только показывают результат. Общий язык один: объект состояния `G` и корабль `ship`.',
               'The script splits into two contexts. The rules keep the state and decide what happened; the scene and sound only show the result. The shared language is one state object `G` and the `ship`.'))
    def c3(title, svg, cap, bullets):
        P.append(H3(title)); P.append(fig(svg, cap))
        P.append('\n'.join('- ' + b for b in bullets))
    c3(t('Правила игры', 'Game rules'), flow({
        'in': (0, 1, [t('Ввод', 'Input'), t('клавиши, указатель', 'keys, pointer')], 'c'),
        'st': (1, 0, [t('Режим', 'Mode'), 'play · pause · over'], 'c'),
        'sp': (1, 2, [t('Генератор', 'Spawner'), 'PATTERNS, diff()'], 'c'),
        'co': (2, 1, [t('Объекты, столкновения', 'Objects, hits'), 'objs[]'], 'c'),
        'sc': (3, 0, [t('Счёт и состояние', 'Score and state'), 'G'], 'c'),
        'sv': (3, 2, [t('Рекорд', 'Record'), 'rift-best'], 'x'),
      }, [('in', 'st', t('старт, пауза', 'start, pause'), False), ('in', 'co', t('руль, прорыв', 'steer, boost'), False), ('sp', 'co', t('новые объекты', 'new objects'), False), ('st', 'co', '', False), ('co', 'sc', t('события', 'events'), False), ('sc', 'sv', t('при конце', 'at the end'), False)], 4, 3,
        t('Компоненты контекста «Правила игры»', 'Components of the Game rules context')),
        t('Всё решается в одной функции `update(dt)`: она же двигает корабль, зовёт генератор и проверяет столкновения.', 'Everything is decided in one `update(dt)` function: it moves the ship, calls the spawner and checks collisions.'),
        [t('Восемь шаблонов препятствий (кристаллы, лазеры, кольца, слалом, маятник и другие) выбираются случайно с весами.', 'Eight obstacle patterns (crystals, lasers, rings, slalom, sweeper and others) are picked at random with weights.'),
         t('Сложность растёт плавно: `diff()` от 0 до 1 на дистанции 14 000 м, новые шаблоны открываются по порогам.', 'Difficulty grows smoothly: `diff()` goes 0 to 1 over 14,000 m and new patterns unlock at thresholds.'),
         t('Три щита; после удара 1,7 с неуязвимости. Прорыв ломает лёд и стоит энергии.', 'Three shields; after a hit, 1.7 s of invulnerability. Boost breaks the ice and costs energy.'),
         t('Счёт = бонусы × множитель + половина дистанции. Множитель ×1…×8 растёт за кольца и сбрасывается ударом.', 'Score = bonuses × multiplier + half the distance. The ×1…×8 multiplier grows with rings and resets on a hit.')])
    c3(t('Сцена и звук', 'Scene and sound'), flow({
        'rd': (0, 1, [t('Рендерер', 'Renderer'), 'WebGLRenderer'], 'c'),
        'tr': (1, 0, [t('Каньон', 'Canyon'), t('шейдер рельефа', 'terrain shader')], 'c'),
        'sk': (1, 2, [t('Небо и сияние', 'Sky and aurora'), t('шейдер, палитры', 'shader, palettes')], 'c'),
        'sh': (2, 0, [t('Корабль и шлейфы', 'Ship and trails'), 'ship, makeTrail'], 'c'),
        'pt': (2, 2, [t('Частицы, снег', 'Particles, snow'), 'burst, emit'], 'c'),
        'cm': (3, 1, [t('Камера', 'Camera'), t('наклон, FOV, тряска', 'tilt, FOV, shake')], 'c'),
        'au': (3, 2, ['Sound', t('музыка, эффекты', 'music, effects')], 'c'),
      }, [('tr', 'rd', '', False), ('sk', 'rd', '', False), ('sh', 'rd', '', False), ('pt', 'rd', '', False), ('cm', 'rd', t('вид', 'view'), False)], 4, 3,
        t('Компоненты контекста «Сцена и звук»', 'Components of the Scene and sound context')),
        t('Мир бесконечный за счёт приёма: корабль летит вперёд, а плоскость каньона каждый кадр подтягивается следом.', 'The world is endless thanks to a trick: the ship flies forward and the canyon plane is moved after it every frame.'),
        [t('Снег, полосы скорости и препятствия пересаживаются вперёд, когда уходят за камеру: объекты не копятся.', 'Snow, speed streaks and obstacles are moved ahead once they pass the camera, so nothing piles up.'),
         t('Все частицы лежат в одном буфере на 1400 точек; звук — генератор на Web Audio, который шагает по тактам заранее.', 'All particles live in one 1,400-point buffer; sound is a Web Audio generator that schedules bars ahead of time.'),
         t('Цвет сияния плавно меняется каждые 2500 м (новый сектор).', 'The aurora colour shifts smoothly every 2,500 m (a new sector).')])
    P.append(H2('paths', t('Четыре критических пути', 'Four critical paths')))
    def sq(title, parts, msgs, cap, label):
        P.append(H3(title)); P.append(fig(seq(parts, msgs, label), cap))
    sq(t('1. Запуск', '1. Starting up'),
       [('u', t('Игрок', 'Player')), ('p', t('Страница', 'Page')), ('c', 'CDN'), ('s', t('Скрипт', 'Script')), ('m', t('Меню', 'Menu'))],
       [('u', 'p', t('открывает', 'opens'), ''), ('p', 'c', 'three.js, fonts', ''), ('c', 'p', t('библиотеки', 'libraries'), 'r'), ('p', 's', t('запуск скрипта', 'run script'), ''), ('s', 's', t('рекорд из localStorage', 'record from localStorage'), 's'), ('s', 'm', 'boot: resetGame', ''), ('m', 'u', t('меню и мир под ним', 'menu over a live canyon'), 'r'), ('u', 's', t('Старт / Enter', 'Start / Enter'), ''), ('s', 'm', 'startGame: play', '')],
       t('Меню уже живое: корабль летит по каньону под ним. «Старт» только сбрасывает счёт и включает режим игры.', 'The menu is already alive: the ship flies down the canyon behind it. “Start” only resets the score and switches to play mode.'), t('Последовательность запуска', 'Startup sequence'))
    sq(t('2. Один кадр', '2. One frame'),
       [('r', 'rAF'), ('u', 'update'), ('g', t('Генератор', 'Spawner')), ('o', t('Объекты', 'Objects')), ('s', t('Сцена', 'Scene')), ('h', 'HUD')],
       [('r', 'u', 'dt ≤ 0.05', ''), ('u', 'u', t('скорость, руль, позиция', 'speed, steering, position'), 's'), ('u', 'g', t('впереди пусто?', 'room ahead?'), ''), ('g', 'o', t('новый шаблон', 'new pattern'), 'r'), ('u', 'o', t('столкновения', 'collisions'), ''), ('o', 'u', t('осколок, кольцо, удар', 'shard, ring, hit'), 'r'), ('u', 's', t('камера, небо, частицы', 'camera, sky, particles'), ''), ('u', 'h', t('счёт, щиты, энергия', 'score, shields, energy'), ''), ('r', 's', 'render', '')],
       t('Время кадра ограничено 0,05 с, чтобы после паузы объекты не «телепортировались»; на паузе dt равен нулю.', 'Frame time is capped at 0.05 s so objects do not teleport after a stall; on pause dt is zero.'), t('Последовательность одного кадра', 'Sequence of one frame'))
    sq(t('3. Ввод в действие', '3. From input to action'),
       [('k', t('Клавиши', 'Keys')), ('p', t('Касание', 'Touch')), ('i', t('Ввод', 'Input')), ('u', 'update'), ('s', t('Корабль', 'Ship'))],
       [('k', 'i', 'WASD, Space', ''), ('p', 'i', t('сдвиг пальца, кнопка', 'drag, button'), ''), ('i', 'i', 'keys{} / pointer / boostHeld', 's'), ('u', 'i', t('читает каждый кадр', 'reads every frame'), ''), ('u', 's', t('скорость x, y; прорыв', 'velocity x, y; boost'), ''), ('s', 'u', t('позиция в пределах каньона', 'position within the canyon'), 'r')],
       t('Ввод только записывает состояние; действие рождается в кадре. Касание тянет корабль к точке, клавиши задают скорость.', 'Input only records state; the action is born in the frame. Touch pulls the ship to a point, keys set velocity.'), t('Последовательность ввода', 'Input sequence'))
    sq(t('4. Удар и конец заезда', '4. A hit and the end of a run'),
       [('o', t('Объекты', 'Objects')), ('u', 'update'), ('g', t('Состояние', 'State')), ('a', t('Звук, частицы', 'Sound, FX')), ('l', 'localStorage'), ('e', t('Экран итога', 'Result'))],
       [('o', 'u', t('лазер / кристалл', 'laser / crystal'), ''), ('u', 'g', 'hurt: shields−1', ''), ('g', 'a', t('вспышка, тряска', 'flash, shake'), ''), ('g', 'g', t('множитель ×1, неуязвим 1,7 с', 'multiplier ×1, 1.7 s grace'), 'n'), ('g', 'g', 'shields = 0 → crash', 's'), ('g', 'l', t('рекорд, дистанция', 'record, distance'), ''), ('g', 'e', t('через 1,3 с', 'after 1.3 s'), ''), ('e', 'u', t('Ещё раз / Меню', 'Again / Menu'), 'r')],
       t('Единственное место, где игра что-то сохраняет, — конец заезда. Прорыв превращает тот же кристалл из угрозы в очки.', 'The end of a run is the only place the game saves anything. Boost turns the same crystal from a threat into points.'), t('Последовательность удара и конца заезда', 'Hit and end-of-run sequence'))
    P.append(H2('rules', t('Правила, на которых всё держится', 'The rules everything rests on')))
    P.append('\n'.join('- ' + x for x in [
        t('**Один цикл, одно состояние.** Режим (`state`) и счёт (`G`) меняет только код скрипта; экраны лишь показывают.', '**One loop, one state.** Only the script changes the mode (`state`) and the score (`G`); screens merely display.'),
        t('**Мир идёт за кораблём.** Корабль движется по оси z, а каньон, небо и снег подстраиваются под камеру.', '**The world follows the ship.** The ship moves along z while the canyon, sky and snow adjust to the camera.'),
        t('**Объекты не копятся.** Что ушло за корабль на 30 м, убирается; впереди держится запас в 430 м.', '**Objects do not pile up.** Whatever is 30 m behind the ship is removed; 430 m are kept ahead.'),
        t('**Кадр защищён.** Время кадра ограничено, пауза обнуляет его, потеря фокуса ставит игру на паузу.', '**The frame is guarded.** Frame time is capped, pause zeroes it, losing focus pauses the game.'),
        t('**Сохранения безопасны.** Любая ошибка localStorage гасится, игра работает и без него.', '**Saving is safe.** Any localStorage error is swallowed; the game works without it.')]))
    P.append(H2('weak', t('Слабые места', 'Weak spots')))
    wk = [(t('Монолит', 'Monolith'), t('Звук, мир, правила и интерфейс лежат в одном блоке; границы только в комментариях.', 'Sound, world, rules and UI sit in one block; the boundaries exist only in comments.')),
          (t('Одна функция кадра', 'One frame function'), t('`update` растёт: ввод, спавн, столкновения и камера в одном месте.', '`update` keeps growing: input, spawning, collisions and camera in one place.')),
          (t('Внешние зависимости', 'External dependencies'), t('three.js и шрифты с CDN: без сети игра не стартует.', 'three.js and fonts from a CDN: without a network the game does not start.')),
          (t('Нет тестов', 'No tests'), t('Правила счёта и сложности проверяются только игрой.', 'Scoring and difficulty rules are checked only by playing.')),
          (t('Случайность', 'Randomness'), t('Каньон строится от `Math.random` без зерна: заезд не воспроизвести.', 'The canyon is built from unseeded `Math.random`: a run cannot be replayed.'))]
    P.append('| ' + t('Где', 'Where') + ' | ' + t('Что не так', 'What is wrong') + ' |\n|---|---|\n' + '\n'.join(f'| **{a}** | {b} |' for a, b in wk))
    return P

meta = {
 'ru': ('Архитектура игры «Северный Разлом»: C4 и критические пути', 'Схемы C4 до уровня компонентов и четыре критических пути через sequence: запуск, кадр, ввод и конец заезда.', 'Архитектура, Игры, C4, three.js'),
 'en': ('Architecture of “Northern Rift”: C4 and critical paths', 'C4 diagrams down to components and four critical paths as sequences: startup, a frame, input and the end of a run.', 'Architecture, Games, C4, three.js'),
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
json.dump({'slug': 'northern-rift-architecture', 'date': '2026-10-02', 'layout': 'wide', 'mentions': 'three.js, WebGL, Web Audio, C4 model, Northern Rift',
           'ru': {'file': 'architecture.ru.md', 'title': meta['ru'][0], 'description': meta['ru'][1], 'tags': meta['ru'][2], 'toc': [{'id': i, 'heading': HEAD['ru'][i], 'label': l} for i, l in TOC['ru']]},
           'en': {'file': 'architecture.md', 'title': meta['en'][0], 'description': meta['en'][1], 'tags': meta['en'][2], 'toc': [{'id': i, 'heading': HEAD['en'][i], 'label': l} for i, l in TOC['en']]}},
          open(f'{OUT}/post.json', 'w'), ensure_ascii=False, indent=1)
print('ok', OUT)
