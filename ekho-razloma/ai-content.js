/* Эхо Разлома — AI layer content & question sets.
 * Shared by the browser (window.AI_CONTENT) and the Node server (require()).
 * The model NEVER writes text for the player: every line below is pre-written;
 * the model only picks ids. Instructions/criteria are in English (jev's best language),
 * everything the player sees is Russian.
 */
(function (root) {
  'use strict';
  const VERSION = 'c4';

  /* ------------------------------------------------------------------ helpers */
  const clampI = (v, a, b) => Math.max(a, Math.min(b, Math.round(+v || 0)));
  const bucket = (v, edges, labels) => { for (let i = 0; i < edges.length; i++) if (v < edges[i]) return labels[i]; return labels[labels.length - 1]; };
  const secs = (s) => bucket(+s || 0, [20, 60, 120, 300, 600], ['under 20 seconds', 'under a minute', '1-2 minutes', '2-5 minutes', '5-10 minutes', 'over 10 minutes']);
  const normPhrase = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}?\s-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);

  /* tiny schema validator: drops unknown keys, coerces, clamps, throws on type errors */
  function check(schema, v, path = 'state') {
    const [t, a, b] = schema;
    switch (t) {
      case 'int': if (v === undefined || v === null || isNaN(+v)) throw new Error(path + ': int'); return clampI(v, a, b);
      case 'num': if (v === undefined || v === null || isNaN(+v)) throw new Error(path + ': num'); return Math.max(a, Math.min(b, +v));
      case 'bool': return !!v;
      case 'str': if (typeof v !== 'string') throw new Error(path + ': str'); return v.slice(0, a);
      case 'enum': if (!a.includes(v)) throw new Error(path + ': enum ' + String(v).slice(0, 20)); return v;
      case 'arr': { if (!Array.isArray(v)) throw new Error(path + ': arr'); if (v.length > b) throw new Error(path + ': too long'); return v.map((x, i) => check(a, x, path + '[' + i + ']')); }
      case 'obj': { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(path + ': obj'); const o = {};
        for (const k in a) { const s = a[k]; if (v[k] === undefined && s.opt) continue; o[k] = check(s, v[k], path + '.' + k); } return o; }
      default: throw new Error('schema');
    }
  }
  const S = { int: (a, b) => ['int', a, b], num: (a, b) => ['num', a, b], bool: () => ['bool'], str: (n) => ['str', n], enu: (l) => ['enum', l], arr: (s, n) => ['arr', s, n], obj: (o) => ['obj', o] };
  const opt = (s) => Object.assign(s, { opt: true });

  /* ------------------------------------------------------------------ story */
  // plain-English summary of each stage, so the model knows where the player is
  const STAGE_EN = [
    'Just crashed. Has not met Orm yet. Must take the cutter tool from the crashed ship cargo.',
    'Has the cutter. Following a signal east to the station. Has not met Orm yet.',
    'Met Orm. Must fetch a power cell from the West Lake, guarded by crystal creatures (shardlings).',
    'Has the power cell. Must bring it back to Orm at the station.',
    'Orm charged the skimmer (hover-bike). Must recover 3 ship parts from the 3 Spires (north mountains, west ice forest, east cliff).',
    'Has all 3 ship parts. Heard the Keepers speak. Must return to Orm.',
    'Orm told about the Heart of the Rift. Must descend into the Rift in the island centre.',
    'In the Rift. Must defeat the Guardian and touch the Heart of the Rift.',
    'Made the final choice at the Heart. Must return to the ship Kestrel.',
    'The story is finished.',
  ];
  const POIS = ['crash', 'station', 'lake', 'spireN', 'spireW', 'spireE', 'rift', 'camp', 'ruins', 'wreck', 'pier', 'wilds'];
  const POI_EN = {
    crash: 'the crash site of the player ship Kestrel (south)', station: 'Orm\'s research station with a campfire (east)', lake: 'the frozen West Lake',
    spireN: 'the North Spire in the mountains', spireW: 'the West Spire in the ice forest', spireE: 'the East Spire on the cliff', rift: 'the Rift in the island centre',
    camp: 'an abandoned expedition camp', ruins: 'ancient ruins with echo stones', wreck: 'an old shipwreck in the sea ice', pier: 'the pier on the lake', wilds: 'open snowy wilderness',
  };
  const POI_RU = { crash: '«Кестрел»', station: 'станция', lake: 'Западное озеро', spireN: 'Северный Шпиль', spireW: 'Западный Шпиль', spireE: 'Восточный Шпиль', rift: 'Разлом',
    camp: 'лагерь', ruins: 'руины', wreck: 'затёртый корабль', pier: 'причал', wilds: 'снега' };
  const ECHO_EN = [
    'the Keepers came from the stars and fell asleep so the island could live',
    'the Spires were built by those who feared the Keepers\' sleep',
    'the Guardian was made to guard, and forgot from whom',
    'expedition log by Orm: the aurora sings at night, Lidia says she understands the words',
    'everything that carries current falls towards the Spires',
    'expedition log by Orm: Lidia went to the Rift alone, Orm did not follow and still has not',
    'the Heart is not a stone, it is all the Keepers squeezed into one drop of light',
    'the Keepers remember how to be grateful',
  ];

  /* ------------------------------------------------------------------ a. ORM_TALK */
  // s = stage range [min,max]; need = extra flag test; g = group; kw = fallback keyword stems
  const ORM = [
    // social
    { id: 'greet', g: 'social', t: 'Живой. Уже хорошо. Чего хотел?', en: 'Reply to a greeting (hello, hi, good day).', kw: ['привет', 'здрав', 'добр', 'хай', 'салют', 'здоров'] },
    { id: 'who', g: 'social', t: 'Орм. Механик экспедиции «Полярная». Бывший механик.', en: 'Player asks who Orm is, his name or his job.', kw: ['кто ты', 'кто вы', 'как зовут', 'имя', 'ты кто'] },
    { id: 'how', g: 'social', t: 'Одиннадцать лет один. Привык. Почти.', en: 'Player asks how Orm is doing, how he feels, or how he survives alone.', kw: ['как ты', 'как дела', 'как жив', 'одинок', 'один'] },
    { id: 'thanks', g: 'social', t: 'Не за что. Нас тут мало — надо держаться друг друга.', en: 'Player thanks Orm.', kw: ['спасиб', 'благодар', 'спс'] },
    { id: 'bye', g: 'social', t: 'Иди. Сияние не любит, когда стоят на месте.', en: 'Player says goodbye or that they are leaving.', kw: ['пока', 'прощ', 'до встреч', 'ухожу', 'пойду'] },
    { id: 'rude', g: 'social', t: 'Злость тут не греет. Побереги силы.', en: 'Player is rude, insults Orm, swears or threatens him.', kw: ['дурак', 'идиот', 'туп', 'заткн', 'бесиш', 'убью', 'старик'] },
    { id: 'joke', g: 'social', t: 'Смешно. Я уже забыл, как это звучит.', en: 'Player jokes, laughs or says something funny or silly.', kw: ['шутк', 'хаха', 'смешн', 'анекдот', 'лол'] },
    { id: 'help_me', g: 'social', t: 'Помогу, чем смогу. Спрашивай про остров — я тут всё обошёл.', en: 'Player asks Orm for help in general or says they are lost, without naming a place.', kw: ['помоги', 'помощ', 'заблуд', 'потерял'] },
    // island & lore
    { id: 'island', g: 'lore', t: 'Остров без карт. Лёд, камень и свет над головой.', en: 'Player asks what this island or place is, or where they are.', kw: ['остров', 'где мы', 'что за место', 'где я', 'куда попал'] },
    { id: 'danger', g: 'lore', t: 'Осколыши, метели, Страж. Остров не злой. Просто не наш.', en: 'Player asks what is dangerous here, about monsters or enemies.', kw: ['опасн', 'монстр', 'враг', 'осколыш', 'кристалл', 'твар'] },
    { id: 'storm', g: 'lore', t: 'Метель приходит разом. Держись огня и не ходи вслепую.', en: 'Player asks about the weather, cold, snow or blizzards.', kw: ['метел', 'погод', 'холод', 'снег', 'буран', 'вьюг', 'мороз'] },
    { id: 'station', g: 'lore', t: 'Станция «Полярная». Всё, что от нас осталось. Огонь горит — это главное.', en: 'Player asks about the station or base where Orm lives.', kw: ['станц', 'баз', 'полярн', 'дом'] },
    { id: 'expedition', g: 'lore', t: 'Нас было девять. Пришли за сиянием. Остался я.', en: 'Player asks about the expedition, Orm\'s team or what happened to the others.', kw: ['экспедиц', 'команд', 'остальн', 'други', 'люди', 'девять'] },
    { id: 'aurora', g: 'lore', t: 'Сияние — их дыхание. Так говорила Лидия.', en: 'Player asks about the aurora, the lights in the sky or the glow.', kw: ['сияни', 'свет в неб', 'аврор', 'небо'] },
    { id: 'spires', g: 'lore', t: 'Шпили тянут к себе всё, в чём есть ток. Твой корабль тоже.', en: 'Player asks what the Spires are or why the ship fell.', kw: ['шпил', 'башн', 'почему упал', 'сбил'] },
    { id: 'spires_where', g: 'dir', s: [3, 9], t: 'Север — в горах. Запад — в ледяном лесу. Восток — у обрыва.', en: 'Player asks where the Spires are located.', kw: ['где шпил', 'где башн', 'какой шпил'] },
    { id: 'spire_voice', g: 'lore', s: [4, 9], need: (s) => s.parts > 0, t: 'Ты их слышал внутри, да? Я слышал однажды. Больше не хожу.', en: 'Player says they heard voices inside a Spire.', kw: ['голос', 'слышал', 'говорил', 'шепот'] },
    { id: 'keepers', g: 'lore', need: (s) => s.parts > 0 || s.echoes.includes(0) || s.echoes.includes(1), t: 'Хранители. Спят подо льдом. Шпили — их цепи.', en: 'Player asks about the Keepers, the voices or who sleeps under the ice.', kw: ['хранител', 'кто спит', 'подо льдом', 'голоса'] },
    { id: 'rift', g: 'lore', t: 'Разлом — трещина в сердце острова. Внизу спит то, что светится.', en: 'Player asks what the Rift is.', kw: ['разлом', 'трещин', 'пропаст', 'центр'] },
    { id: 'heart', g: 'lore', s: [5, 9], t: 'Сердце Разлома. Кораблю нужна его сила. Другой здесь нет.', en: 'Player asks about the Heart of the Rift or a power source.', kw: ['сердц', 'источник', 'энерги'] },
    { id: 'guardian', g: 'lore', s: [5, 9], t: 'Страж — лёд, который помнит приказ. Бей в ядро, не в броню.', en: 'Player asks about the Guardian or how to fight the boss.', kw: ['страж', 'босс', 'как победить', 'ядро'] },
    { id: 'choice', g: 'lore', s: [6, 7], t: 'Забрать или отпустить — решать тебе. Я своё решение уже принял.', en: 'Player asks what to do with the Heart, whether to take it or free the Keepers.', kw: ['забрать', 'отпуст', 'выбор', 'решени', 'что выбрать'] },
    { id: 'echoes', g: 'lore', t: 'Синие камни у руин. Голоса тех, кто спит. Слушай их.', en: 'Player asks about echoes, blue stones or ruins.', kw: ['эхо', 'камн', 'руин', 'синие'] },
    { id: 'echoes_many', g: 'lore', need: (s) => s.echoes.length >= 3, t: 'Ты слышал много эха. Значит, понимаешь их лучше меня.', en: 'Player talks about the echoes they heard or what the echo voices said.', kw: ['услышал эхо', 'эхо сказал', 'я слышал эхо'] },
    // Lidia
    { id: 'lidia_who', g: 'lidia', t: 'Лидия. Наш лингвист. Она первой услышала их песню.', en: 'Player asks who Lidia is.', kw: ['лиди', 'кто она', 'лингвист'] },
    { id: 'lidia_where', g: 'lidia', t: 'Ушла к Разлому. Одна. Я не пошёл за ней.', en: 'Player asks where Lidia went or what happened to her.', kw: ['где лиди', 'куда ушл', 'что с ней', 'пропал'] },
    { id: 'lidia_guilt', g: 'lidia', t: 'Не спрашивай, почему я остался. Я сам себя спрашиваю каждую ночь.', en: 'Player asks why Orm did not follow Lidia, or blames him.', kw: ['почему не пош', 'почему остал', 'струсил', 'бросил', 'виноват'] },
    { id: 'lidia_alive', g: 'lidia', t: 'Не знаю. Иногда в сиянии слышу её голос. Может, это просто ветер.', en: 'Player asks if Lidia is alive or could be found.', kw: ['жива', 'живая', 'найти её', 'вернется'] },
    // fox
    { id: 'fox', g: 'fox', need: (s) => !s.fox, t: 'Белая лиса? Ходит у обломков. Людей не боится. Странно.', en: 'Player asks about the white fox.', kw: ['лис', 'зверь', 'животн'] },
    { id: 'fox_joined', g: 'fox', need: (s) => s.fox, t: 'Искра с тобой? Хороший знак. Она чует осколки лучше сканера.', en: 'Player talks about their fox companion Iskra.', kw: ['лис', 'искр', 'зверь'] },
    // ship
    { id: 'ship', g: 'ship', t: '«Кестрел»? Корпус держится. Нужны детали и энергия.', en: 'Player asks about their ship Kestrel or how to fly home.', kw: ['корабл', 'кестрел', 'домой', 'улет', 'взлет'] },
    { id: 'ship_parts', g: 'ship', s: [4, 5], t: 'Детали внутри Шпилей. Три. Без них не взлетишь.', en: 'Player asks where the ship parts are.', kw: ['детал', 'запчаст'] },
    { id: 'ship_power', g: 'ship', s: [5, 9], t: 'Энергию даст только Сердце. Или они сами. Если поверишь.', en: 'Player asks where to get energy for the ship.', kw: ['энерги', 'заряд', 'топлив'] },
    { id: 'skimmer', g: 'ship', s: [4, 9], t: 'Скиммер тебя слушается. Позови — и приедет.', en: 'Player asks about the skimmer, hover-bike or transport.', kw: ['скиммер', 'байк', 'транспорт', 'машин'] },
    { id: 'skimmer_dead', g: 'ship', s: [2, 3], t: 'Скиммер стоит без заряда. Нужна ячейка с озера.', en: 'Player asks about the skimmer, hover-bike or transport.', kw: ['скиммер', 'байк', 'транспорт', 'машин'] },
    // objectives per stage
    { id: 'goal_cell', g: 'dir', s: [2, 2], t: 'Ячейка на Западном озере. Светится на льду. Осколыши рядом.', en: 'Player asks what to do now, where to go, or where the power cell is.', kw: ['что делать', 'куда идти', 'ячейк', 'озер', 'задани', 'дальше'] },
    { id: 'goal_bring', g: 'dir', s: [3, 3], t: 'Неси ячейку сюда. Без неё скиммер — просто железо.', en: 'Player asks what to do now or where to go.', kw: ['что делать', 'куда идти', 'ячейк', 'задани', 'дальше'] },
    { id: 'goal_spires', g: 'dir', s: [4, 4], t: 'Иди на свет Шпилей. Лучи видно отовсюду.', en: 'Player asks what to do now or where to go.', kw: ['что делать', 'куда идти', 'задани', 'дальше'] },
    { id: 'goal_return', g: 'dir', s: [5, 5], t: 'Детали у тебя? Тогда слушай. Разговор будет серьёзный.', en: 'Player asks what to do now or where to go.', kw: ['что делать', 'куда идти', 'задани', 'дальше'] },
    { id: 'goal_rift', g: 'dir', s: [6, 7], t: 'Спускайся в Разлом. Центр острова. Не отступай.', en: 'Player asks what to do now or where to go.', kw: ['что делать', 'куда идти', 'задани', 'дальше'] },
    { id: 'goal_ship', g: 'dir', s: [8, 9], t: 'Возвращайся к «Кестрелу». Остров тебя отпускает.', en: 'Player asks what to do now or where to go.', kw: ['что делать', 'куда идти', 'задани', 'дальше'] },
    { id: 'rest', g: 'dir', t: 'Отдохни у огня. Метель переждать можно только здесь.', en: 'Player says they are tired, hurt, cold, or asks where to rest or heal.', kw: ['устал', 'ранен', 'отдох', 'лечи', 'костер', 'огонь', 'замерз'] },
    // endings
    { id: 'after_take', g: 'end', s: [8, 9], need: (s) => s.ending === 'take', t: 'Темно стало. Тихо. Ты выбрал — живи с этим.', en: 'Player talks about the Heart they took or the dark sky.', kw: ['сердц', 'темн', 'погас', 'выбор'] },
    { id: 'after_free', g: 'end', s: [8, 9], need: (s) => s.ending === 'free', t: 'Слышишь? Поют. Я пойду к Разлому. Наконец.', en: 'Player talks about the freed Keepers or the song.', kw: ['свобод', 'поют', 'песн', 'выбор', 'хранител'] },
    // fallbacks (always available)
    { id: 'dont_understand', g: 'fb', t: 'Не понял. Говори проще — я давно ни с кем не говорил.', en: 'The phrase is gibberish, unclear, or not a question Orm could answer.', kw: [] },
    { id: 'dont_know', g: 'fb', t: 'Не знаю. Остров не всё мне рассказал.', en: 'Player asks about something that is not part of this island\'s story (real world, other games, technology, math).', kw: [] },
    { id: 'refuse', g: 'fb', t: 'Об этом не буду. Не сейчас.', en: 'Player pushes Orm about something painful or private, or asks him to do something he will not do (leave the station, fight, fly).', kw: ['пойдем со мной', 'летим', 'иди со мной'] },
  ];
  const ormById = Object.fromEntries(ORM.map((r) => [r.id, r]));
  function ormAvailable(s) {
    return ORM.filter((r) => (!r.s || (s.stage >= r.s[0] && s.stage <= r.s[1])) && (!r.need || r.need(s)));
  }
  function ormKeyword(s) {
    const p = ' ' + normPhrase(s.phrase) + ' ';
    if (!p.trim()) return 'greet';
    let best = null, bs = 0;
    for (const r of ormAvailable(s)) {
      let sc = 0; for (const k of r.kw) if (p.includes(k.replace(/ё/g, 'е'))) sc += k.length > 6 ? 2 : 1;
      if (r.g === 'dir' && r.s) sc += sc ? 0.5 : 0; // prefer stage-specific directions on ties
      if (sc > bs) { bs = sc; best = r.id; }
    }
    return best || 'dont_understand';
  }

  /* ------------------------------------------------------------------ b. DIRECTOR */
  const EVENTS = {
    none: { en: 'Nothing happens. Best when the player is fighting, or an event happened less than a minute ago.' },
    blizzard: { en: 'Start a blizzard. Good when things are calm and the player is outdoors far from the station, adds pressure. Bad when HP is low.', icon: 'i-wind', cls: 'c-ice', t: ['Ветер крепчает. Идёт метель', 'Горизонт пропал. Метель'] },
    ambush_small: { en: 'A small group of 2-3 shardlings attacks. Good when the player has full health, a weapon, and has been calm for a long time. Bad after recent deaths or with low HP.', icon: 'i-skull', cls: 'c-pink', t: ['Осколыши! Движение рядом', 'Лёд звенит. Осколыши'] },
    stag_herd: { en: 'A herd of stags runs past. Calm, beautiful moment. Good when the player explores quietly.', icon: 'i-paw', cls: 'c-amber', t: ['Олени идут через долину', 'Стадо рядом. Тише'] },
    aurora_flare: { en: 'The aurora flares brightly in the sky. Beautiful low-stakes moment, good at night calm or after a hard fight.', icon: 'i-aurora', cls: 'c-aur', t: ['Сияние вспыхнуло ярче', 'Небо поёт'] },
    echo_whisper: { en: 'A whisper hints at the direction of an unheard echo stone. Good when the player is idle, wandering or seems lost.', icon: 'i-echo', cls: 'c-aur', t: ['Эхо шепчет где-то {dir}', 'Голос зовёт {dir}'] },
    fox_find: { en: 'The fox companion sniffs out a nearby shard and leads the player to it. Only when the fox has joined. Good when idle or bored.', icon: 'i-paw', cls: 'c-amber', t: ['Искра что-то учуяла', 'Искра зовёт за собой'] },
    supply_drop: { en: 'The player finds an old expedition medkit that heals. Good when HP is low or after recent deaths.', icon: 'i-heart', cls: 'c-aur', t: ['Под снегом — аптечка экспедиции', 'Старый ящик «Полярной». Лекарства'] },
  };
  const TENSION = ['very calm, nothing to worry about', 'calm, exploring', 'some pressure', 'tense, danger nearby', 'very tense, fighting or about to die'];
  function directorRules(s, seq) {
    const A = new Set(s.allowed);
    const pick = (list) => list.find((e) => A.has(e)) || 'none';
    if (s.combat) return 'none';
    if ((s.hp <= s.hpMax * 0.4 || s.deathsRecent > 0) && A.has('supply_drop')) return 'supply_drop';
    if (s.sinceEvent < 45) return 'none';
    if (s.idle >= 60) return pick(['fox_find', 'echo_whisper', 'stag_herd']);
    if (s.sinceEvent >= 150) { const cyc = ['stag_herd', 'aurora_flare', 'ambush_small', 'echo_whisper', 'blizzard']; return pick(cyc.slice(seq % cyc.length).concat(cyc)); }
    return 'none';
  }
  function tensionRules(s) { return s.combat ? 5 : s.hp <= s.hpMax * 0.4 ? 4 : s.storm === 'blizzard' ? 3 : s.stage >= 6 ? 3 : 2; }

  /* ------------------------------------------------------------------ c. CREATURE */
  const CREATURE = {
    stag: { graze: 'Keep grazing calmly. When the player is far or still.', alert: 'Raise the head and watch the player. When the player is at medium distance or approaching slowly.', flee: 'Run away. When the player is close and moving fast, riding, fighting or shooting.', approach: 'Step closer out of curiosity. Only when the player stands still for a long time and is not armed or fighting.' },
    fox: { approach: 'Come back to the player\'s side. Default when the player moves on.', lead_player_to_shard: 'Run to a nearby shard and wait there so the player follows. When a shard is near and there is no fight.', circle: 'Circle playfully around the player. When the player is idle and happy.', alert: 'Stop and growl towards danger. When enemies are near.', graze: 'Sit and rest. When the player is resting or in dialogue.' },
    shardling: { approach: 'Advance and attack the player. When the player is close and hurt or alone.', circle: 'Circle the player at medium range, waiting. When other shardlings are attacking or the player is aiming.', retreat: 'Back off towards its home. When hurt or when the player is much stronger.', alert: 'Hover in place and watch. When the player is far away.' },
  };
  const DIST = (d) => bucket(d, [6, 15, 30, 60], ['very close (under 6 m)', 'close (6-15 m)', 'medium (15-30 m)', 'far (30-60 m)', 'very far']);
  function creatureRules(c, s) {
    if (c.kind === 'stag') return c.dist < 26 ? 'flee' : c.dist < 40 && s.activity !== 'idle' ? 'alert' : 'graze';
    if (c.kind === 'fox') return s.combat ? 'alert' : c.shardNear ? 'lead_player_to_shard' : 'approach';
    if (c.kind === 'shardling') return c.hurt && c.dist < 10 ? 'retreat' : c.dist < 26 ? 'approach' : 'alert';
    return null;
  }

  /* ------------------------------------------------------------------ d. COMMANDS */
  const CMD = [
    { id: 'call_skimmer', en: 'Call the skimmer (hover-bike) to come to the player.', kw: ['позови скиммер', 'вызови скиммер', 'скиммер ко мне', 'скиммер сюда', 'транспорт', 'байк'] },
    { id: 'mount', en: 'Get on the skimmer and drive.', kw: ['садись', 'сесть', 'поехали', 'сяду'] },
    { id: 'dismount', en: 'Get off the skimmer.', kw: ['слезь', 'выйти', 'спешить', 'слезаю', 'вылез'] },
    { id: 'open_map', en: 'Open the map.', kw: ['карт'] },
    { id: 'open_journal', en: 'Open the journal / quest log / diary.', kw: ['журнал', 'дневник', 'записи', 'квест'] },
    { id: 'close_ui', en: 'Close the open window, go back to the game.', kw: ['закрой', 'закрыть', 'назад'] },
    { id: 'scan', en: 'Use the scanner to reveal things nearby.', kw: ['скан', 'сканир', 'что рядом', 'осмотр'] },
    { id: 'where_objective', en: 'Ask where the current objective is or what to do next.', kw: ['куда идти', 'где цель', 'что делать', 'куда дальше', 'задани', 'цель'] },
    { id: 'where_campfire', en: 'Ask where the campfire is.', kw: ['костер', 'огонь', 'где отдох', 'костр'] },
    { id: 'where_orm', en: 'Ask where Orm or the station is.', kw: ['где орм', 'орм', 'станци'] },
    { id: 'where_ship', en: 'Ask where the player ship Kestrel is.', kw: ['корабл', 'кестрел'] },
    { id: 'where_fox', en: 'Ask where the fox Iskra is located (a question, not an order).', kw: ['где лис', 'где искр'] },
    { id: 'where_echo', en: 'Ask where the nearest unheard echo stone is.', kw: ['где эхо', 'эхо', 'камн'] },
    { id: 'where_shard', en: 'Ask where the nearest shard (collectible crystal) is.', kw: ['осколок', 'осколк', 'кристалл'] },
    { id: 'rest', en: 'Rest at the campfire to heal.', kw: ['отдохн', 'отдых', 'поспать', 'привал', 'лечи'] },
    { id: 'wave', en: 'Wave hello (emote).', kw: ['помаши', 'махни', 'привет рук'] },
    { id: 'pet_fox', en: 'Pet the fox.', kw: ['погладь', 'гладить', 'погладить'] },
    { id: 'fox_seek', en: 'Order the fox Iskra to search / sniff out shards (e.g. "Искра, ищи", "ищи осколки"). Not a question about where the fox is.', kw: ['ищи', 'искра ищи', 'найди'] },
    { id: 'talk_orm', en: 'Start talking to Orm.', kw: ['поговор', 'говорить с орм', 'спросить орм'] },
    { id: 'pause', en: 'Pause the game.', kw: ['пауз', 'стоп игра', 'остановить'] },
    { id: 'mute', en: 'Turn the sound off.', kw: ['выключи звук', 'без звука', 'тихо', 'звук выкл', 'замолчи'] },
    { id: 'unmute', en: 'Turn the sound on.', kw: ['включи звук', 'звук вкл', 'громче'] },
    { id: 'hint', en: 'Ask for a hint because the player is stuck.', kw: ['подсказ', 'помоги', 'застрял', 'не знаю что'] },
    { id: 'quality_low', en: 'Lower the graphics quality, the game is slow or laggy.', kw: ['тормоз', 'лагает', 'лаги', 'графику ниже', 'медленно'] },
    { id: 'quality_high', en: 'Raise the graphics quality, make it prettier.', kw: ['графику выше', 'красивее', 'максимальн', 'ультра'] },
    { id: 'save', en: 'Save the game.', kw: ['сохрани', 'сохранить', 'сейв'] },
    { id: 'none', en: 'Not a game command, unclear, or chit-chat.', kw: [] },
  ];
  const CMD_RU = { call_skimmer: 'Скиммер', mount: 'Сесть', dismount: 'Слезть', open_map: 'Карта', open_journal: 'Журнал', close_ui: 'Закрыть', scan: 'Скан', where_objective: 'Цель',
    where_campfire: 'Костёр', where_orm: 'Орм', where_ship: '«Кестрел»', where_fox: 'Искра', where_echo: 'Эхо', where_shard: 'Осколок', rest: 'Отдых', wave: 'Привет', pet_fox: 'Погладить',
    fox_seek: 'Искра, ищи', talk_orm: 'Разговор', pause: 'Пауза', mute: 'Без звука', unmute: 'Звук', hint: 'Подсказка', quality_low: 'Графика ↓', quality_high: 'Графика ↑', save: 'Сохранено', none: 'Не понял' };
  const CMD_ICON = { call_skimmer: 'i-skimmer', mount: 'i-skimmer', dismount: 'i-skimmer', open_map: 'i-map', open_journal: 'i-book', close_ui: 'i-cross', scan: 'i-scan', where_objective: 'i-target',
    where_campfire: 'i-fire', where_orm: 'i-station', where_ship: 'i-ship', where_fox: 'i-paw', where_echo: 'i-echo', where_shard: 'i-shard', rest: 'i-fire', wave: 'i-wave', pet_fox: 'i-paw',
    fox_seek: 'i-paw', talk_orm: 'i-person', pause: 'i-pause', mute: 'i-mute', unmute: 'i-sound', hint: 'i-book', quality_low: 'i-chip', quality_high: 'i-chip', save: 'i-check', none: 'i-cross' };
  function cmdKeyword(text) {
    const p = ' ' + normPhrase(text) + ' '; let best = 'none', bs = 0;
    for (const c of CMD) { let sc = 0; for (const k of c.kw) if (p.includes(k)) sc += k.length; if (sc > bs) { bs = sc; best = c.id; } }
    return best;
  }

  /* ------------------------------------------------------------------ e. HINTS (no spoilers, per stage, gentle → firm) */
  const HINTS = [
    [['h0a', 'Светящийся контейнер у обломков. Подойди и нажми E.', 'The glowing cargo container is right next to the crash, walk to it.'], ['h0b', 'Посмотри вокруг корабля — голубой свет у земли.', 'Look around the ship for a blue glow on the ground.']],
    [['h1a', 'Сигнал на востоке. Держи метку компаса впереди.', 'Follow the compass marker east.'], ['h1b', 'Станция — дым и огни за холмом.', 'The station has smoke and lights behind a hill.'], ['h1c', 'Q — скан. Покажет, что рядом.', 'Use the scanner to reveal nearby things.']],
    [['h2a', 'Озеро на западе. Ищи свет на льду.', 'The lake is to the west, look for a light on the ice.'], ['h2b', 'Осколыши бьют рывком. C — перекат в сторону.', 'Shardlings dash-attack; dodge roll sideways.'], ['h2c', 'Ранен? Костёр на станции лечит.', 'If hurt, the campfire at the station heals.']],
    [['h3a', 'Ячейка у тебя. Орм ждёт на станции.', 'You have the cell; Orm waits at the station.'], ['h3b', 'Метка компаса ведёт к Орму.', 'The compass marker leads to Orm.']],
    [['h4a', 'Три луча в небе — три Шпиля. Иди на любой.', 'Three light beams in the sky mark the three Spires; go to any.'], ['h4b', 'T — позвать скиммер. Так быстрее.', 'Call the skimmer with T, it is faster.'], ['h4c', 'У Шпиля стражи. Сначала очисти зону.', 'Each Spire is guarded; clear the area first.'], ['h4d', 'Деталь лежит на алтаре внутри. Подойди вплотную.', 'The part lies on the altar; walk right up to it.']],
    [['h5a', 'Детали собраны. Возвращайся к Орму.', 'Parts collected, go back to Orm.'], ['h5b', 'Станция на востоке. Скиммер домчит.', 'The station is east; the skimmer is quick.']],
    [['h6a', 'Разлом — в центре острова. Спускайся вниз.', 'The Rift is in the centre of the island; go down.'], ['h6b', 'Склоны крутые. Ищи пологий спуск.', 'Slopes are steep; look for a gentle way down.']],
    [['h7a', 'Бей в светящееся ядро Стража.', 'Hit the Guardian\'s glowing core.'], ['h7b', 'Кольца по земле — прыгай через них.', 'Jump over the rings on the ground.'], ['h7c', 'Эхо помогает понять Хранителей. Выбор зависит от них.', 'Echoes help understand the Keepers; the choice depends on them.']],
    [['h8a', '«Кестрел» ждёт у места падения. На юг.', 'The Kestrel waits at the crash site, to the south.']],
    [['h9a', 'История завершена. Остров твой.', 'The story is over; explore freely.']],
  ];
  function hintRules(s) {
    const list = HINTS[s.stage] || HINTS[0];
    const tier = s.inStage > 420 ? 2 : s.inStage > 240 ? 1 : 0;
    if (s.stage === 2 && s.deaths > 0) return 'h2b';
    if (s.stage === 4 && !s.riding && s.inStage > 90) return 'h4b';
    return list[Math.min(tier, list.length - 1)][0];
  }
  function stuckRules(s) { return s.inStage > 240 && s.trend !== 'closer' || s.idle > 90 || s.deaths >= 2; }

  /* ------------------------------------------------------------------ f. QUALITY_DIRECTOR */
  const PRESETS = ['low', 'med', 'high', 'ultra'];
  const PRESET_EN = { low: 'Lowest quality. For weak devices or when frame rate is below 30.', med: 'Medium quality. When frame rate is 30-50 or a mobile device.', high: 'High quality. Frame rate is steady near 60 on a desktop.', ultra: 'Maximum quality. Only for strong desktops with a steady 60+ frame rate and headroom.' };
  const FOCUS_EN = { enemy: 'Combat: sharpness and effects around enemies matter most.', landscape: 'Exploring: far view distance, trees and sky matter most.', dialogue: 'A conversation: characters close-up matter most.', vehicle: 'Driving fast: motion and far terrain matter most, small details do not.' };
  const fpsWord = (f) => bucket(f, [20, 30, 45, 56, 75], ['unplayable (under 20 fps)', 'poor (20-30 fps)', 'below target (30-45 fps)', 'almost smooth (45-55 fps)', 'smooth (about 60 fps)', 'very smooth (above 75 fps)']);
  function qualityRules(s) {
    const i = PRESETS.indexOf(s.preset);
    if (s.fpsAvg < 30 || s.fpsLow < 20) return PRESETS[Math.max(0, i - 1)];
    if (s.fpsAvg < 48) return PRESETS[Math.max(0, i - 1)];
    const cap = s.device === 'low' ? 1 : s.device === 'mid' ? 2 : 3;
    if (s.fpsAvg >= 58 && s.fpsLow >= 50 && i < cap) return PRESETS[i + 1];
    return PRESETS[Math.min(i, cap)];
  }
  const focusRules = (s) => s.activity === 'combat' ? 'enemy' : s.activity === 'dialogue' ? 'dialogue' : s.activity === 'driving' ? 'vehicle' : 'landscape';

  /* ------------------------------------------------------------------ h. CONTACT_INTENT (pilot body-to-surface contact) */
  const CONTACT_SURF_EN = {
    wall: 'a flat rock or wall face directly ahead, taller than the player', ledge: 'a flat top at waist-to-chest height directly ahead',
    slope: 'a steep rising snow or rock slope ahead', object_face: 'the flat side of a pushable prop or wreck panel ahead',
    obstacle_top: 'a low obstacle (crate, fallen log, low rock) ahead, knee-to-waist height', branch: 'a low tree branch ahead, at head/chest height',
    ground: 'bare ground or something small on the ground just ahead', none: 'nothing close enough ahead to react to',
  };
  const CONTACT_STATE_EN = { idle: 'standing still', walking: 'walking slowly', running: 'running or sprinting', riding: 'riding the skimmer', combat: 'fighting', climbing: 'climbing a ledge', sliding: 'sliding down a slope' };
  const CONTACT_ACTS = {
    rest_on_rock: 'Lean a hand, shoulder or the back against the surface, or rest both hands on a ledge top, and hold that pose. Only when standing still or moving under about 0.6 m/s right next to it.',
    touch_surface: 'Reach out and place one or both hands flat on the wall while approaching it slowly (under about 1.4 m/s).',
    climb_slope: 'Brace a hand and the lead foot against a steep slope directly ahead.',
    cross_obstacle: 'Step over (low) or vault (higher, hands-first) the obstacle ahead instead of walking around it.',
    inspect_ground: 'Crouch or kneel to look closely at the ground just ahead. Only when standing still or nearly so.',
    pick_up: 'Bend down and pick up a small object on the ground just ahead.',
    clear_branch: 'Sweep a low branch aside with a hand while passing it.',
    none: 'Do nothing special; keep the normal walk/run/idle pose.',
  };
  /** deterministic fallback for CONTACT_INTENT — offline, or the model's confidence is too low */
  function contactRules(s) {
    if (s.surface === 'branch') return s.speed > 0.3 ? 'clear_branch' : 'none';
    if (s.surface === 'obstacle_top') return s.state !== 'combat' && s.state !== 'riding' ? 'cross_obstacle' : 'none';
    if (s.surface === 'slope') return s.speed < 3 && s.state !== 'riding' ? 'climb_slope' : 'none';
    if (s.surface === 'ground') return (s.state === 'idle' || s.speed < 0.8) && s.distance < 1.0 ? 'inspect_ground' : 'none';
    if (s.surface === 'wall' || s.surface === 'ledge' || s.surface === 'object_face') {
      if (s.distance > 1.15 || s.state === 'combat' || s.state === 'riding' || s.state === 'climbing') return 'none';
      if (s.state === 'idle' || s.speed < 0.6) return 'rest_on_rock';
      if (s.speed < 1.4) return 'touch_surface';
    }
    return 'none';
  }

  /* ------------------------------------------------------------------ g. PRELOAD */
  const STAGE_ZONE = ['crash', 'station', 'lake', 'station', 'spireN', 'station', 'rift', 'rift', 'crash', 'crash'];
  function preloadRules(s) {
    if (s.stage === 4) { const left = ['spireN', 'spireW', 'spireE'].filter((z) => !s.visited.includes(z)); if (left.length) return left.includes(s.heading) ? s.heading : left[0]; }
    return STAGE_ZONE[s.stage] || 'station';
  }

  /* ------------------------------------------------------------------ SETS (server builds questions from validated state) */
  const stageSchema = S.int(0, 9);
  const SETS = {
    ORM_TALK: {
      ttl: 7 * 86400, timeoutMs: 1600,
      schema: S.obj({ phrase: S.str(200), stage: stageSchema, echoes: S.arr(S.int(0, 7), 8), parts: S.int(0, 3), fox: S.bool(), bossDead: S.bool(), ending: S.enu(['none', 'take', 'free']) }),
      normalize: (s) => ({ ...s, phrase: normPhrase(s.phrase), echoes: [...new Set(s.echoes)].sort() }),
      build(s) {
        const avail = ormAvailable(s);
        return {
          state: {
            player_phrase: s.phrase,
            speaker: 'Orm, a lonely old mechanic, the last survivor of the polar expedition "Polyarnaya", living at a station on an arctic island for 11 years.',
            listener: 'A stranded pilot whose ship Kestrel crashed on the island.',
            story_now: STAGE_EN[s.stage],
            player_heard_echoes: s.echoes.map((i) => ECHO_EN[i]),
            fox_companion: s.fox ? 'yes, a white fox called Iskra follows the player' : 'no',
          },
          questions: {
            reply: { type: 'choice', instructions: 'The player said `player_phrase` (Russian) to Orm. Which reply from Orm answers it best? Match the meaning of the phrase first; use `story_now` only to break ties between similar replies.', criteria: Object.fromEntries(avail.map((r) => [r.id, r.en])) },
            mood: { type: 'score', instructions: 'How friendly is `player_phrase` towards Orm?', criteria: ['hostile, rude or insulting', 'cold or impatient', 'neutral', 'friendly', 'warm, caring or grateful'] },
            lidia: { type: 'noul', instructions: 'Is `player_phrase` asking about or mentioning Lidia (Лидия), a woman from the expedition who went missing, or Orm\'s lost companion?' },
          },
        };
      },
      interpret(a, s, recent = []) {
        const avail = new Set(ormAvailable(s).map((r) => r.id));
        let id = null, src = 'rules';
        const r = a && a.reply;
        if (r && r.probabilities) {
          const ranked = Object.entries(r.probabilities).filter(([k]) => avail.has(k)).sort((x, y) => y[1] - x[1]);
          const [top, p] = ranked[0] || [];
          if (top && (p >= 0.3 || r.confidence >= 0.35)) {
            id = top; src = 'model';
            if (recent.includes(top) && ranked[1] && ranked[1][1] >= p * 0.5) id = ranked[1][0];
            if (a.lidia && a.lidia.noul >= 0.7 && ormById[id].g !== 'lidia') { const l = ranked.find(([k]) => ormById[k].g === 'lidia'); if (l) id = l[0]; }
          }
        }
        if (!id) id = ormKeyword(s);
        const mood = a && a.mood ? Math.round(a.mood.score) + 1 : 3;
        return { id, text: ormById[id].t, mood, lidia: a && a.lidia ? a.lidia.noul : (ormById[id].g === 'lidia' ? 1 : 0), src };
      },
    },
    DIRECTOR: {
      ttl: 600, timeoutMs: 1500,
      schema: S.obj({ hp: S.int(0, 10), hpMax: S.int(1, 10), stage: stageSchema, storm: S.enu(['none', 'building', 'blizzard']), location: S.enu(POIS), combat: S.bool(), deathsRecent: S.int(0, 9), sinceEvent: S.int(0, 3600), idle: S.int(0, 3600), riding: S.bool(), fox: S.bool(), night: opt(S.bool()), allowed: S.arr(S.enu(Object.keys(EVENTS)), 8) }),
      normalize: (s) => ({ ...s, sinceEvent: Math.min(600, Math.round(s.sinceEvent / 30) * 30), idle: Math.min(300, Math.round(s.idle / 30) * 30), allowed: [...new Set(['none', ...s.allowed])].sort() }),
      build(s) {
        return {
          state: {
            game: 'Third-person arctic island adventure. You are the event director: keep the pace interesting but fair.',
            health: s.hp >= s.hpMax ? 'full health' : s.hp <= s.hpMax * 0.4 ? 'low health, in danger' : 'slightly hurt',
            story_now: STAGE_EN[s.stage], weather: s.storm === 'blizzard' ? 'blizzard now' : s.storm === 'building' ? 'wind rising' : 'clear',
            location: POI_EN[s.location], fighting_now: s.combat ? 'yes' : 'no', deaths_last_5_min: s.deathsRecent ? String(s.deathsRecent) : 'none',
            time_since_last_event: secs(s.sinceEvent), player_idle_for: secs(s.idle), riding_skimmer: s.riding ? 'yes' : 'no', fox_companion: s.fox ? 'yes' : 'no',
          },
          questions: {
            event: { type: 'choice', instructions: 'Which event should happen now? Choose `none` only if the player is fighting or an event happened less than a minute ago; after 2+ calm minutes pick the event that fits the situation best.', criteria: Object.fromEntries(s.allowed.map((k) => [k, EVENTS[k].en])) },
            tension: { type: 'score', instructions: 'How tense is the player\'s situation right now?', criteria: TENSION },
          },
        };
      },
      interpret(a, s, seq = 0) {
        const allowed = new Set(['none', ...s.allowed]);
        let ev = null, src = 'rules';
        if (a && a.event && allowed.has(a.event.choice) && a.event.confidence >= 0.35) { ev = a.event.choice; src = 'model'; }
        if (!ev) ev = directorRules(s, seq);
        const tension = a && a.tension ? Math.round(a.tension.score) + 1 : tensionRules(s);
        return { event: ev, tension, src };
      },
    },
    CREATURE: {
      ttl: 60, timeoutMs: 1500,
      schema: S.obj({ activity: S.enu(['idle', 'walking', 'running', 'riding', 'fighting', 'dialogue', 'resting']), hp: S.int(0, 10), armed: S.bool(), combat: S.bool(),
        creatures: S.arr(S.obj({ id: S.str(12), kind: S.enu(['stag', 'fox', 'shardling']), dist: S.num(0, 999), approaching: S.bool(), hurt: S.bool(), shardNear: opt(S.bool()), mates: opt(S.int(0, 9)) }), 8) }),
      normalize: (s) => ({ ...s, creatures: s.creatures.map((c) => ({ ...c, dist: Math.round(c.dist / 5) * 5 })) }),
      build(s) {
        const q = {}, st = { player: { activity: s.activity, health: s.hp <= 2 ? 'low' : 'ok', armed: s.armed ? 'yes' : 'no', fighting: s.combat ? 'yes' : 'no' }, creatures: {} };
        for (const c of s.creatures) {
          st.creatures[c.id] = { kind: c.kind === 'shardling' ? 'shardling (hostile crystal creature)' : c.kind === 'fox' ? 'white fox, the player\'s friendly companion' : 'wild stag (shy deer)',
            distance_to_player: DIST(c.dist), player_moving_towards_it: c.approaching ? 'yes' : 'no', hurt: c.hurt ? 'yes' : 'no',
            ...(c.kind === 'fox' ? { shard_nearby: c.shardNear ? 'yes' : 'no' } : {}), ...(c.kind === 'shardling' ? { other_shardlings_nearby: String(c.mates || 0) } : {}) };
          q[c.id] = { type: 'choice', instructions: `What should creature \`creatures.${c.id}\` do next?`, criteria: CREATURE[c.kind] };
        }
        return { state: st, questions: q };
      },
      interpret(a, s) {
        const out = {};
        for (const c of s.creatures) {
          const x = a && a[c.id];
          out[c.id] = x && CREATURE[c.kind][x.choice] && x.confidence >= 0.3 ? { act: x.choice, src: 'model' } : { act: creatureRules(c, s), src: 'rules' };
        }
        return out;
      },
    },
    COMMANDS: {
      ttl: 7 * 86400, timeoutMs: 1600,
      schema: S.obj({ text: S.str(160), riding: S.bool(), nearOrm: S.bool(), nearFire: S.bool(), fox: S.bool(), skimmer: S.bool(), uiOpen: S.bool() }),
      normalize: (s) => ({ ...s, text: normPhrase(s.text) }),
      build(s) {
        return {
          state: { player_said: s.text, context: { riding_skimmer: s.riding, standing_near_orm: s.nearOrm, standing_near_campfire: s.nearFire, has_fox: s.fox, skimmer_available: s.skimmer, a_menu_is_open: s.uiOpen } },
          questions: { action: { type: 'choice', instructions: 'The player gave a voice or text command in Russian: `player_said`. Which game action did they ask for? Choose `none` if it is not a clear command.', criteria: Object.fromEntries(CMD.map((c) => [c.id, c.en])) } },
        };
      },
      interpret(a, s) {
        const x = a && a.action;
        if (x && x.choice !== 'none' && x.confidence >= 0.6) return { id: x.choice, src: 'model', conf: x.confidence };
        const k = cmdKeyword(s.text);
        return { id: k, src: 'rules', conf: x ? x.confidence : 0 };
      },
    },
    HINTS: {
      ttl: 86400, timeoutMs: 1500,
      schema: S.obj({ stage: stageSchema, inStage: S.int(0, 36000), idle: S.int(0, 36000), trend: S.enu(['closer', 'same', 'farther', 'wandering']), dist: S.int(0, 2000), deaths: S.int(0, 99), riding: S.bool(), skimmer: S.bool(), echoes: S.int(0, 8), parts: S.int(0, 3), location: S.enu(POIS) }),
      normalize: (s) => ({ ...s, inStage: Math.min(900, Math.round(s.inStage / 60) * 60), idle: Math.min(300, Math.round(s.idle / 30) * 30), dist: Math.round(s.dist / 50) * 50, deaths: Math.min(s.deaths, 3) }),
      build(s) {
        const list = HINTS[s.stage] || HINTS[0];
        return {
          state: { goal: STAGE_EN[s.stage], time_on_this_goal: secs(s.inStage), idle_for: secs(s.idle), distance_to_goal: DIST(s.dist), progress: s.trend, deaths_on_this_goal: String(s.deaths),
            riding_skimmer: s.riding ? 'yes' : 'no', skimmer_unlocked: s.skimmer ? 'yes' : 'no', location: POI_EN[s.location] },
          questions: {
            stuck: { type: 'noul', instructions: 'Does the player seem stuck or lost on the current goal (long time, not getting closer, dying, or idle)?' },
            hint: { type: 'choice', instructions: 'Which hint would help the player most right now without spoiling the story?', criteria: Object.fromEntries(list.map(([id, , en]) => [id, en])) },
          },
        };
      },
      interpret(a, s) {
        const list = HINTS[s.stage] || HINTS[0], ids = list.map((h) => h[0]);
        const stuck = a && a.stuck ? a.stuck.noul >= 0.6 : stuckRules(s);
        const id = a && a.hint && ids.includes(a.hint.choice) && a.hint.confidence >= 0.3 ? a.hint.choice : hintRules(s);
        return { stuck, id, text: list.find((h) => h[0] === id)[1], src: a ? 'model' : 'rules' };
      },
    },
    QUALITY_DIRECTOR: {
      ttl: 900, timeoutMs: 1500,
      schema: S.obj({ fpsAvg: S.num(0, 240), fpsLow: S.num(0, 240), device: S.enu(['low', 'mid', 'high']), mobile: S.bool(), activity: S.enu(['exploring', 'combat', 'dialogue', 'driving', 'menu']), storm: S.bool(),
        calls: S.int(0, 100000), tris: S.int(0, 1e8), look: S.enu(['sky', 'horizon', 'ground', 'close']), preset: S.enu(PRESETS) }),
      normalize: (s) => ({ ...s, fpsAvg: Math.round(s.fpsAvg / 5) * 5, fpsLow: Math.round(s.fpsLow / 5) * 5, calls: Math.round(s.calls / 50) * 50, tris: Math.round(s.tris / 250000) * 250000 }),
      build(s) {
        return {
          state: { frame_rate_average: fpsWord(s.fpsAvg), frame_rate_worst: fpsWord(s.fpsLow), device: s.device + (s.mobile ? ' (mobile, touch)' : ' (desktop)'), activity: s.activity, blizzard: s.storm ? 'yes' : 'no',
            scene_load: bucket(s.tris, [300000, 900000, 2000000], ['light', 'moderate', 'heavy', 'very heavy']), camera_looks_at: s.look, current_preset: s.preset },
          questions: {
            preset: { type: 'choice', instructions: 'Which graphics preset keeps the game smooth (about 60 fps) while looking as good as possible? Lower it if the frame rate is below target; raise it only with clear headroom.', criteria: PRESET_EN },
            focus: { type: 'choice', instructions: 'What should rendering detail focus on right now?', criteria: FOCUS_EN },
          },
        };
      },
      interpret(a, s) {
        const p = a && a.preset && a.preset.confidence >= 0.4 ? { preset: a.preset.choice, src: 'model' } : { preset: qualityRules(s), src: 'rules' };
        p.focus = a && a.focus && a.focus.confidence >= 0.3 ? a.focus.choice : focusRules(s);
        return p;
      },
    },
    PRELOAD: {
      ttl: 3600, timeoutMs: 1500,
      schema: S.obj({ stage: stageSchema, at: S.enu(POIS), heading: S.enu(POIS), riding: S.bool(), visited: S.arr(S.enu(POIS), 12), zones: S.arr(S.enu(POIS), 12) }),
      normalize: (s) => ({ ...s, visited: [...new Set(s.visited)].sort(), zones: [...new Set(s.zones)].sort() }),
      build(s) {
        return {
          state: { goal: STAGE_EN[s.stage], player_is_at: POI_EN[s.at], camera_faces: POI_EN[s.heading], riding_skimmer: s.riding ? 'yes' : 'no', already_visited: s.visited.map((v) => POI_EN[v]) },
          questions: { next: { type: 'choice', instructions: 'Which place will the player most likely reach next? Consider the goal first, then where the camera faces.', criteria: Object.fromEntries(s.zones.map((z) => [z, POI_EN[z]])) } },
        };
      },
      interpret(a, s) {
        if (a && a.next && s.zones.includes(a.next.choice) && a.next.confidence >= 0.3) return { zone: a.next.choice, src: 'model' };
        return { zone: preloadRules(s), src: 'rules' };
      },
    },
    CONTACT_INTENT: {
      ttl: 20, timeoutMs: 1200,
      schema: S.obj({ surface: S.enu(['wall', 'ledge', 'slope', 'object_face', 'obstacle_top', 'branch', 'ground', 'none']), height: S.num(0, 4), distance: S.num(0, 3), angleDeg: S.int(0, 180),
        speed: S.num(0, 15), state: S.enu(['idle', 'walking', 'running', 'riding', 'combat', 'climbing', 'sliding']), stamina: S.num(0, 1), cold: S.num(0, 1), animalsNear: S.int(0, 9), npcNear: S.bool(), onIce: S.bool() }),
      normalize: (s) => ({ ...s, distance: +s.distance.toFixed(2), height: +s.height.toFixed(2), speed: Math.round(s.speed * 10) / 10 }),
      build(s) {
        return {
          state: { surface_ahead: CONTACT_SURF_EN[s.surface], surface_height_m: s.height.toFixed(1), distance_to_surface_m: s.distance.toFixed(1), approach_angle_deg: s.angleDeg,
            player_state: CONTACT_STATE_EN[s.state], player_speed_ms: s.speed.toFixed(1), fatigue: bucket(s.stamina, [0.3, 0.7], ['tired', 'somewhat tired', 'fresh']),
            cold_exposure: bucket(s.cold, [0.3, 0.7], ['comfortable', 'cold', 'freezing']), animals_nearby: String(s.animalsNear), npc_nearby: s.npcNear ? 'yes' : 'no', standing_on_ice: s.onIce ? 'yes' : 'no' },
          questions: { intent: { type: 'choice', instructions: 'Should the player\'s body react to the surface ahead, and how? Only pick a contact action when close enough and slow enough (or standing still); never mid-run, mid-climb, riding or fighting. Choose `none` if nothing ahead deserves a reaction.', criteria: CONTACT_ACTS } },
        };
      },
      interpret(a, s) {
        if (a && a.intent && CONTACT_ACTS[a.intent.choice] && a.intent.confidence >= 0.4) return { intent: a.intent.choice, src: 'model' };
        return { intent: contactRules(s), src: 'rules' };
      },
    },
  };

  const API = {
    VERSION, SETS, ORM, ormById, ormAvailable, ormKeyword, EVENTS, CREATURE, creatureRules, CMD, CMD_RU, CMD_ICON, cmdKeyword, HINTS, PRESETS, POIS, POI_RU, POI_EN, STAGE_EN,
    directorRules, qualityRules, focusRules, preloadRules, hintRules, stuckRules, contactRules, CONTACT_ACTS, normPhrase, check,
    /** validate + normalize client state for a whitelisted set; throws on bad input */
    prepare(setId, raw) { const set = SETS[setId]; if (!set) throw new Error('unknown set'); const s = set.normalize(check(set.schema, raw)); return { set, s }; },
  };
  root.AI_CONTENT = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
