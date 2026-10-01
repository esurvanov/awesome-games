import sys, os, re, json; sys.path.insert(0, '.')
from svgs import flow, seq, standalone
OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
NAMES = ['c4-context', 'c4-containers', 'c3-sim', 'c3-render', 'c3-ui', 'seq-start', 'seq-tick', 'seq-choice', 'seq-frame']
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
      'Игра «Сходка» — субботний вечер IT-сообщества в баре Батуми, 19:00 → 01:00, около 18 минут: браузер, без сервера и сборки, three.js лежит рядом. Здесь описано, как она устроена: схемы C4 до уровня компонентов и четыре пути, на которых всё держится.',
      '“Skhodka” is a Saturday evening of an IT community in a Batumi bar, 19:00 → 01:00, about 18 minutes: browser only, no server and no build step, three.js ships alongside. This is how it is put together: C4 diagrams down to components and the four paths everything rests on.'))
    # ---- C4
    P.append(H2('c4', t('C4: контекст и контейнеры', 'C4: context and containers')))
    P.append(H3(t('Уровень 1. Система и её окружение', 'Level 1. The system and its surroundings')))
    P.append(fig(flow({
        'pl': (0, 1, [t('Игрок', 'Player'), t('мышь, касание', 'mouse, touch')], 'p'),
        'gm': (1, 1, [t('«Сходка»', '“Skhodka”'), t('игра в браузере', 'a browser game')], 'c'),
        'ls': (2, 0, ['localStorage', t('качество, звук', 'quality, sound')], 'x'),
        'nd': (2, 2, [t('Тесты в Node', 'Node tests'), t('симуляция без экрана', 'simulation, no screen')], 'x'),
      }, [('pl', 'gm', t('играет', 'plays'), False), ('gm', 'ls', t('настройки', 'settings'), True), ('nd', 'gm', t('гоняют мир', 'run the world'), True)], 4, 3,
      t('Контекст системы: игрок, игра, настройки браузера и тесты', 'System context: the player, the game, browser settings and tests'))
      , t('Своего сервера нет и внешних библиотек по сети нет: three.js лежит в папке игры. Открыть можно двойным щелчком по index.html.', 'There is no server and no library fetched over the network: three.js lives in the game folder. Double-clicking index.html is enough.')))
    P.append(H3(t('Уровень 2. Контейнеры', 'Level 2. Containers')))
    P.append(fig(flow({
        'ix': (0, 1, [t('Страница и реестр', 'Page and registry'), 'index.html, l.js', 'manifest.js'], 'c'),
        'mn': (1, 1, [t('Сборка', 'Assembly'), 'main.js', t('цикл, ввод, снимок', 'loop, input, shot')], 'c'),
        'ct': (2, 0, [t('Содержание', 'Content'), 'content/*', t('данные вечера', 'evening data')], 'c'),
        'sm': (2, 1, [t('Симуляция', 'Simulation'), 'sim/*', t('мир без DOM и THREE', 'world, no DOM or THREE')], 'c'),
        'rn': (1, 2, [t('Зал и люди', 'Hall and people'), 'render/*', 'three.js'], 'c'),
        'ui': (2, 2, [t('Интерфейс', 'UI'), 'ui/*', t('DOM поверх холста', 'DOM over the canvas')], 'c'),
        'co': (0, 0, [t('Ядро', 'Core'), 'core.js', 'RNG, Bus, Loop'], 'c'),
      }, [('ix', 'mn', t('грузит части', 'loads parts'), False), ('mn', 'sm', t('step, act, view', 'step, act, view'), False), ('mn', 'rn', t('поза, свет, кадр', 'pose, light, frame'), False), ('mn', 'ui', 'attach', False), ('sm', 'ct', t('читает', 'reads'), False), ('ui', 'sm', t('act / события', 'act / events'), False), ('co', 'mn', t('утилиты', 'utilities'), True)], 3, 3,
      t('Контейнеры игры: страница, сборка, содержание, симуляция, зал, интерфейс, ядро', 'Game containers: page, assembly, content, simulation, hall, UI, core'))
      , t('Симуляция ничего не знает об экране: её рисуют отдельно, и она же работает в Node. Содержание — только данные.', 'The simulation knows nothing about the screen: it is drawn separately and also runs in Node. Content is data only.')))
    # ---- C3
    P.append(H2('c3', t('C4 уровня 3: компоненты контекстов', 'C4 level 3: components of each context')))
    P.append(t('Все части — обычные скрипты с реестром `L`: `L.def` объявляет часть, `L.use` берёт её и выполняет при первом обращении. Циклическая зависимость падает сразу с понятной ошибкой. Контексты общаются через шину событий мира (`world.bus`) и вызов `world.act`.',
               'All parts are plain scripts with an `L` registry: `L.def` declares a part, `L.use` fetches it and runs it on first use. A dependency cycle fails at once with a clear error. Contexts talk through the world’s event bus (`world.bus`) and the `world.act` call.'))
    def c3(title, svg, bullets):
        cap = re.search(r'aria-label="([^"]*)"', svg).group(1)
        P.append(H3(title)); P.append(fig(svg, cap))
        P.append('\n'.join('- ' + b for b in bullets))
    c3(t('Симуляция', 'Simulation'), flow({
        'wd': (1, 1, ['World', t('шаг, act, view', 'step, act, view')], 'c'),
        'cr': (0, 0, [t('Толпа', 'Crowd'), 'crowd.js'], 'c'),
        'nv': (0, 2, [t('Ходьба', 'Navigation'), 'nav.js'], 'c'),
        'dr': (2, 0, [t('Режиссёр', 'Director'), 'director.js'], 'c'),
        'br': (1, 0, [t('Мозг людей', 'Brain'), 'brain.js'], 'c'),
        'tk': (2, 1, [t('Разговор', 'Talk'), 'talk.js'], 'c'),
        'sc': (2, 2, [t('Счёт', 'Score'), 'score.js'], 'c'),
        'ct': (0, 1, [t('Содержание', 'Content'), t('(другой контекст)', '(other context)')], 'x'),
      }, [('wd', 'cr', t('создаёт людей', 'creates people'), False), ('wd', 'dr', 'update', False), ('wd', 'br', 'update', False), ('wd', 'tk', 'update', False), ('wd', 'sc', 'update', False), ('wd', 'nv', t('пути', 'paths'), False), ('tk', 'sc', t('ступени, пары', 'steps, pairs'), False), ('wd', 'ct', t('читает', 'reads'), True)], 4, 3,
       t('Компоненты симуляции вечера', 'Components of the evening simulation')),
      [t('**World** держит часы (180 с реального времени на игровой час), людей, игрока, места и шину событий; наружу даёт `step`, `act`, `view`.', '**World** holds the clock (180 real seconds per game hour), the people, the player, the seats and the event bus; outward it exposes `step`, `act`, `view`.'),
       t('**Crowd** строит гостей из ролей, складов и нужд, а расписание прихода сводит к кривой вечера инвариантом, а не подбором.', '**Crowd** builds guests from roles, minds and needs and fits the arrival schedule to the evening curve by an invariant, not by tuning.'),
       t('**Brain** решает за гостей: место, бар, курилка, группы разговора. **Director** запускает события и сообщения в телефон.', '**Brain** decides for the guests: seat, bar, smoking area, conversation groups. **Director** starts events and phone messages.'),
       t('**Talk** разыгрывает карточки-реплики; **Score** считает знакомства, пары, фото и звание.', '**Talk** plays out the reply cards; **Score** counts acquaintances, pairs, the photo and the title.')])
    c3(t('Зал и люди', 'Hall and people'), flow({
        'sn': (1, 1, [t('Зал', 'Scene'), 'scene.js'], 'c'),
        'cm': (0, 0, [t('Камера', 'Camera'), 'camera.js'], 'c'),
        'ql': (1, 0, [t('Качество', 'Quality'), 'quality.js'], 'c'),
        'tx': (2, 0, [t('Текстуры', 'Textures'), 'textures.js'], 'c'),
        'pr': (2, 1, [t('Мебель, мелочь', 'Props'), 'props.js'], 'c'),
        'pp': (1, 2, [t('Люди', 'People'), 'people.js'], 'c'),
        'lk': (2, 2, [t('Облик', 'Looks'), 'looks.js'], 'c'),
        'ly': (0, 1, [t('План зала', 'Layout'), 'content/layout.js'], 'x'),
      }, [('sn', 'cm', t('ракурс', 'view'), False), ('sn', 'ql', 'sample(dt)', False), ('sn', 'tx', t('запечённый свет', 'baked light'), False), ('sn', 'pr', t('декор', 'decor'), False), ('lk', 'pp', t('облик, через сборку', 'look, via assembly'), False), ('sn', 'ly', t('столы, стены', 'tables, walls'), True)], 3, 3,
       t('Компоненты отрисовки зала и людей', 'Components of the hall and people rendering')),
      [t('**Зал** строит SushiGO из плана и декора, 2–4 настоящих источника света, остальной свет запечён в текстуры; эффекты: дождь, саксофон, караоке и другие.', '**Scene** builds SushiGO from the plan and decor, 2–4 real lights, the rest of the light baked into textures; effects: rain, sax, karaoke and more.'),
       t('**Quality** переключает low / mid / high по частоте кадров: быстро вниз, медленно вверх и не выше ступени, на которой уже падали.', '**Quality** switches low / mid / high by frame rate: down fast, up slowly, never above a rung it already failed on.'),
       t('**Люди**: каждый человек — один SkinnedMesh, анимация процедурная по позе, настроению и «говорит ли».', '**People**: each person is a single SkinnedMesh, animation is procedural from pose, mood and “is speaking”.')])
    c3(t('Интерфейс', 'UI'), flow({
        'ui': (1, 1, ['Ui', t('слушает world.bus', 'listens to world.bus')], 'c'),
        'hd': (0, 0, ['HUD', t('время, силы, бирки', 'time, energy, tags')], 'c'),
        'tk': (1, 0, [t('Панель разговора', 'Talk panel'), 'talk.js'], 'c'),
        'ph': (2, 0, [t('Телефон', 'Phone'), 'phone.js'], 'c'),
        'sr': (2, 1, [t('Экраны', 'Screens'), t('заставка, анкета, итог', 'title, profile, end')], 'c'),
        'dm': (0, 1, ['Dom, Icons', t('вёрстка и иконки', 'markup and icons')], 'c'),
        'wd': (1, 2, [t('Мир', 'World'), 'world.act, bus'], 'x'),
      }, [('ui', 'hd', '', False), ('ui', 'tk', '', False), ('ui', 'ph', '', False), ('ui', 'sr', '', False), ('ui', 'dm', '', False), ('ui', 'wd', t('act / события', 'act / events'), True)], 3, 3,
       t('Компоненты интерфейса', 'UI components')),
      [t('**Ui** подписывается на события мира (`talk:line`, `ladder`, `pair`, `chat`, `toast`, `end`) и отдаёт действия игрока в `world.act`.', '**Ui** subscribes to world events (`talk:line`, `ladder`, `pair`, `chat`, `toast`, `end`) and sends the player’s actions to `world.act`.'),
       t('Своя шина `ui.bus`: пауза, качество, звук, «ещё одна суббота».', 'Its own `ui.bus`: pause, quality, sound, “another Saturday”.')])
    # ---- paths
    P.append(H2('paths', t('Четыре критических пути', 'Four critical paths')))
    def sq(title, parts, msgs, cap, label):
        P.append(H3(title)); P.append(fig(seq(parts, msgs, label), cap))
    sq(t('1. Запуск и новый вечер', '1. Startup and a new evening'),
       [('u', t('Игрок', 'Player')), ('i', 'index.html'), ('m', 'main'), ('r', t('Зал и люди', 'Hall')), ('s', t('Интерфейс', 'UI')), ('w', 'World')],
       [('u', 'i', t('открывает', 'opens'), ''), ('i', 'm', t('скрипты по списку', 'scripts in order'), ''), ('m', 'm', 'L.use(main)', 's'), ('m', 'r', 'Scene, People', ''), ('m', 's', 'Ui', ''), ('m', 'r', 'loop.start', ''),
        ('s', 'u', t('заставка, анкета, чат', 'title, profile, chat'), 'r'), ('u', 's', t('поехали', 'go'), ''), ('s', 'm', 'start()', ''), ('m', 'w', 'new World(seed)', ''), ('m', 's', 'attach(world)', ''), ('w', 'm', t('вечер идёт', 'the evening runs'), 'r')],
       t('Зал живёт с первого кадра, за заставкой. Мир создаётся только после анкеты; `?seed=N` даёт тот же вечер.', 'The hall lives from the first frame, behind the title. The world is built only after the profile; `?seed=N` gives the same evening.'), t('Последовательность запуска', 'Startup sequence'))
    sq(t('2. Шаг симуляции', '2. A simulation step'),
       [('l', 'Loop'), ('w', 'World'), ('d', t('Режиссёр', 'Director')), ('b', t('Мозг', 'Brain')), ('t', t('Разговор', 'Talk')), ('c', t('Счёт', 'Score'))],
       [('l', 'w', 'step(1/30)', ''), ('w', 'd', t('события, чат', 'events, chat'), ''), ('w', 'b', t('места, группы', 'seats, groups'), ''), ('w', 'w', t('ходьба игрока', 'player walk'), 's'), ('w', 't', t('ответ собеседника', 'reply'), ''), ('w', 'c', t('счёт', 'score'), ''),
        ('w', 'l', t('до 8 шагов за кадр', 'up to 8 steps a frame'), 'r'), ('w', 'w', t('hour ≥ 25: finish → end', 'hour ≥ 25: finish → end'), 's')],
       t('Время идёт фиксированными шагами в 1/30 с, поэтому вечер с одним сидом одинаков на любой машине.', 'Time moves in fixed 1/30 s steps, so an evening with one seed is the same on any machine.'), t('Последовательность шага симуляции', 'Simulation step sequence'))
    sq(t('3. Реплика игрока и её последствия', '3. A player’s reply and its consequences'),
       [('u', t('Игрок', 'Player')), ('s', t('Интерфейс', 'UI')), ('w', 'World'), ('t', t('Разговор', 'Talk')), ('c', t('Счёт', 'Score'))],
       [('u', 's', t('карточка, 1–4', 'card, keys 1–4'), ''), ('s', 'w', 'act(say)', ''), ('w', 't', 'say(card)', ''), ('t', 't', t('трата сил', 'energy cost'), 's'), ('t', 's', 'talk:line', 'r'),
        ('t', 't', t('пауза ответа', 'reply pause'), 's'), ('t', 't', t('оценка реплики', 'score the reply'), 's'), ('t', 's', 'talk:line, reveal', 'r'), ('t', 'c', t('ступень', 'step'), ''), ('t', 's', t('talk:cards, ladder', 'talk:cards, ladder'), 'r')],
       t('Симпатия растёт или падает, карточка человека раскрывается по одному полю за ход, ступени ведут от «видел» до «договорились». Срыв или усталость закрывают разговор.', 'Rapport rises or falls, the person card opens one field per turn, steps lead from “seen” to “agreed”. A failure or fatigue ends the talk.'), t('Последовательность реплики игрока', 'Player reply sequence'))
    sq(t('4. Кадр', '4. A frame'),
       [('l', 'Loop'), ('m', 'main'), ('w', 'World'), ('p', t('Люди', 'People')), ('r', t('Зал', 'Scene')), ('s', t('Интерфейс', 'UI'))],
       [('l', 'w', t('update × n', 'update × n'), ''), ('l', 'm', 'render(dt)', ''), ('m', 'w', 'view()', ''), ('w', 'm', t('позиции, позы', 'positions, poses'), 'r'), ('m', 'p', 'add / set', ''), ('m', 'r', t('час, следить за игроком', 'hour, follow player'), ''),
        ('m', 'p', 'update(dt)', ''), ('m', 'r', 'render(dt)', ''), ('r', 'r', 'quality.sample', 's'), ('m', 's', 'update(dt)', ''), ('m', 'm', t('конец → снимок, итог', 'end → shot, summary'), 's')],
       t('Мир отдаёт плоский список «кто где в какой позе», сборка переносит его на людей в 3D. Ошибка в кадре идёт в консоль, цикл не умирает.', 'The world hands out a flat list “who is where in which pose”, the assembly mirrors it onto the 3D people. A frame error goes to the console, the loop keeps going.'), t('Последовательность кадра', 'Frame sequence'))
    # ---- rules
    P.append(H2('rules', t('Правила, на которых всё держится', 'The rules everything rests on')))
    P.append('\n'.join('- ' + x for x in [
        t('**Симуляция не знает об экране.** Ни DOM, ни THREE: её видно только через `view()` и шину событий.', '**The simulation knows nothing about the screen.** No DOM, no THREE: it is seen only through `view()` and the event bus.'),
        t('**Содержание — данные.** Движок получает `CONTENT` целиком; истории и числа правятся без движка, числа перекрывает `TUNING`.', '**Content is data.** The engine receives `CONTENT` whole; stories and numbers change without the engine, numbers are overridden by `TUNING`.'),
        t('**Один сид — один вечер.** Генератор случайных чисел с сидом и фиксированный шаг дают повторяемость.', '**One seed, one evening.** A seeded random generator and a fixed step give repeatability.'),
        t('**Инвариант вместо подбора.** Число людей в часы пика сводится в коридор формулой.', '**Invariant instead of tuning.** The head count at peak hours is fitted into a corridor by a formula.'),
        t('**Слабая машина — первая.** Качество подстраивается по кадрам, свет в основном запечён.', '**The weak machine comes first.** Quality adapts to frames, light is mostly baked.')]))
    P.append(H2('weak', t('Слабые места', 'Weak spots')))
    wk = [(t('Сборка большая', 'Big assembly'), t('main.js на 300 строк держит ввод, снимок для итога и метки на полу вместе с циклом.', 'main.js, about 300 lines, holds input, the end photo and floor marks along with the loop.')),
          (t('Интерфейс угадывает форму мира', 'UI guesses the world’s shape'), t('Ui терпит и Map, и массив людей, и разные имена флагов: договор о форме данных размыт.', 'Ui tolerates both a Map and an array of people and several flag names: the data contract is blurred.')),
          (t('Музыканты вне симуляции', 'Musicians outside the simulation'), t('Саксофонист и певица существуют только в сборке и не видны миру.', 'The sax player and the singer exist only in the assembly and are invisible to the world.')),
          (t('Большие файлы зала', 'Large hall files'), t('scene.js и people.js по 850–950 строк.', 'scene.js and people.js are 850–950 lines each.')),
          (t('Тестовый набор отдельно', 'Separate test fixture'), t('sim/fixture.js дублирует схему содержания и может разойтись с настоящей.', 'sim/fixture.js duplicates the content schema and can drift from the real one.'))]
    P.append('| ' + t('Где', 'Where') + ' | ' + t('Что не так', 'What is wrong') + ' |\n|---|---|\n' + '\n'.join(f'| **{a}** | {b} |' for a, b in wk))
    return P

meta = {
 'ru': ('Архитектура игры «Сходка»: C4 и критические пути', 'Схемы C4 до уровня компонентов и четыре критических пути через sequence: запуск, шаг симуляции, реплика игрока и кадр.', 'Архитектура, Игры, C4, three.js'),
 'en': ('Architecture of “Skhodka”: C4 and critical paths', 'C4 diagrams down to components and four critical paths as sequences: startup, a simulation step, a player reply and a frame.', 'Architecture, Games, C4, three.js'),
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
json.dump({'slug': 'skhodka-architecture', 'date': '2026-10-02', 'layout': 'wide', 'mentions': 'three.js, C4 model, WebGL, Skhodka',
           'ru': {'file': 'architecture.ru.md', 'title': meta['ru'][0], 'description': meta['ru'][1], 'tags': meta['ru'][2], 'toc': [{'id': i, 'heading': HEAD['ru'][i], 'label': l} for i, l in TOC['ru']]},
           'en': {'file': 'architecture.md', 'title': meta['en'][0], 'description': meta['en'][1], 'tags': meta['en'][2], 'toc': [{'id': i, 'heading': HEAD['en'][i], 'label': l} for i, l in TOC['en']]}},
          open(f'{OUT}/post.json', 'w'), ensure_ascii=False, indent=1)
print('ok', OUT)
