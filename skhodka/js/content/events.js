// ═══ СОБЫТИЯ ВЕЧЕРА ═══
// Всё, что случалось на субботних сходках (обобщённо): дождь, стробоскоп, запах после обработки, пробка,
// день рождения, спор, дота, саксофон, футбол, гирлянды, скидка, «до часу работает», общее фото.
// Часть событий устраивают чудики: ODDBALLS.event запускается в момент прихода чудика (chance 0 — само не выпадает).
//
// EVENTS[] — {
//   id, title (2–3 слова), icon
//   at       [h0, h1] — окно, в котором событие начинается (часы вечера)
//   chance   вероятность за вечер (0 — только от чудика)
//   effect   (форма — как у sim/director; все поля необязательны):
//            dur        сколько часов длится
//            flee[]     зоны LAYOUT, откуда все уходят и куда не садятся, пока идёт (дождь → веранда, улица)
//            gather     { zone, share } — доля гостей идёт постоять в зону (к стоячим местам LAYOUT.stands)
//            leave      { share, at? } — доля гостей уходит сейчас (покер, соседний бар); чудик — первым;
//                       at: 'end' — в конце события, первыми — те, кто стоял в кучке (караоке: попели и ушли)
//            stage      { x, z, r, y, face } — где стоит музыкант (его рисуют сборка и сцена); стоячие места в радиусе r заняты;
//                       y — высота пола (подиум LAYOUT.stage), face — куда смотрит (в зал). Саксофон и караоке — на одной сцене
//            stop[]     id событий, которые это событие прекращает (караоке → саксофон доигрывает)
//            huddle     { block, share, r, pose } — доля гостей встаёт кучкой у блока LAYOUT (колонка) и держит позу
//            mood       ± настроение всех (−1..1)
//            energy     ± силы игрока (шкала 0..1)
//            topic      тема «в воздухе»: у всех групп, и карты с ней заходят лучше
//            likes[] / dislikes[]  стили карт, которые пока событие идёт заходят лучше / хуже
//            pose, zone поза сидящих в зоне (ДР → 'sing' за длинным столом)
//            argue      true — в одной большой группе разгорается спор
//            delay      часы, на которые опаздывают ещё не пришедшие (пробка, дождь)
//            photo      true — общее фото у LAYOUT.photo
//            сверх формы sim (для UI/будущего): price — множитель цен меню; food — стол кормят бесплатно
//   scene    эффект зала → sc.setEffect: 'strobe'|'rain'|'football'|'sax'|'birthday'|'garland'|'smell'|'karaoke' | null
//   сверх схемы:
//   by       id чудика ODDBALLS, который приносит событие с собой (для справки; запуск — ODDBALLS.event)
//   month    'dec' — по смыслу декабрьское (гирлянды); сборка может поднять chance в декабре
//   chat     ключ CHAT.events — что пишут в чат при событии
//   toast    2–4 слова — всплывашка игроку при начале
// }
'use strict';
L.def('content/events', () => {
// сцена — низкий подиум у левой стены рядом с барными стульями (LAYOUT.stage): музыкант стоит на нём лицом в зал
const ST = L.use('content/layout').LAYOUT.stage;
const onStage = (r, dx = 0) => ({ x: +(ST.x + dx).toFixed(2), z: ST.z, y: ST.h, face: ST.face, r });
const EVENTS = [
  { id: 'rain', title: 'Ливень', icon: 'rain', at: [19.5, 22.5], chance: 0.35, scene: 'rain', chat: 'rain',
    effect: { dur: 1.5, flee: ['veranda', 'street'], delay: 0.3, topic: 'weather', mood: -0.05, likes: ['joke', 'treat'] },
    toast: 'Все с веранды внутрь!' },
  { id: 'strobe', title: 'Стробоскоп', icon: 'flash', at: [21, 23.5], chance: 0.3, scene: 'strobe', chat: 'strobe',
    effect: { dur: 0.7, mood: -0.1, leave: { share: 0.05 }, likes: ['joke'], dislikes: ['dream', 'listen'] },
    toast: 'Кто включил стробоскоп?' },
  { id: 'smell', title: 'Запах обработки', icon: 'spray', at: [19, 19.6], chance: 0.15, scene: 'smell', chat: 'smell',
    effect: { dur: 1, flee: ['back', 'booth'], energy: -0.03, mood: -0.05 },
    toast: 'Пахнет дихлофосом' },
  { id: 'traffic', title: 'Пробка', icon: 'car', at: [19.5, 20.5], chance: 0.3, scene: null, chat: 'traffic',
    effect: { dur: 1.2, delay: 0.5 },
    toast: 'Город встал' },
  { id: 'birthday', title: 'День рождения', icon: 'balloon', at: [20.5, 22], chance: 0.3, scene: 'birthday', chat: 'birthday',
    effect: { dur: 0.6, zone: 'long', pose: 'sing', mood: 0.2, energy: 0.03, likes: ['praise', 'treat'] },
    toast: 'У кого-то ДР!' },
  { id: 'dota', title: 'Кто-то включил доту', icon: 'gamepad', at: [21, 23], chance: 0.2, scene: null,
    effect: { dur: 0.8, topic: 'games', gather: { zone: 'booth', share: 0.1 } },
    toast: 'Дота на ноутбуке' },
  { id: 'sax', title: 'Живой саксофон', icon: 'sax', at: [22, 22.5], chance: 0.35, scene: 'sax',
    effect: { dur: 2, stage: onStage(0.6), mood: 0.15, topic: 'music', gather: { zone: 'round', share: 0.1 }, dislikes: ['facts'] },
    toast: 'Заиграл саксофон' },
  { id: 'football', title: 'Футбол по ТВ', icon: 'ball', at: [21, 22], chance: 0.25, scene: 'football',
    effect: { dur: 2, gather: { zone: 'bar', share: 0.2 }, topic: 'sport' },
    toast: 'На экране матч' },
  { id: 'garland', title: 'Гирлянды', icon: 'garland', at: [19, 19.1], chance: 0.15, month: 'dec', scene: 'garland',
    effect: { dur: 6, mood: 0.05 },
    toast: 'Декабрь, гирлянды' },
  { id: 'discount', title: 'Скидка 20%', icon: 'percent', at: [19, 19.2], chance: 0.4, scene: null, chat: 'discount',
    effect: { dur: 6, mood: 0.05, price: 0.8 },
    toast: 'Скидка для чата' },
  { id: 'nodiscount', title: 'Скидку отменили', icon: 'sad', at: [20, 21], chance: 0.15, scene: null, chat: 'nodiscount',
    effect: { dur: 0.3, mood: -0.05, price: 1 },
    toast: 'Скидки нет, увы' },
  { id: 'argue', title: 'Спор о Батуми', icon: 'fire', at: [21.5, 23.5], chance: 0.25, scene: null,
    effect: { dur: 0.6, argue: true, topic: 'city', likes: ['argue'] },
    toast: 'Спорят про стройки' },
  { id: 'poker', title: 'Уходят в покер', icon: 'cards', at: [20.4, 20.8], chance: 0.2, scene: null,
    effect: { dur: 0.1, leave: { share: 0.08 }, topic: 'games' },
    toast: 'Часть ушла в покер' },
  { id: 'karaoke', title: 'Караоке-исход', icon: 'mic', at: [23, 23.2], chance: 0.7, scene: 'karaoke', chat: 'karaoke',
    effect: { dur: 0.3, stop: ['sax'], stage: onStage(0.6, 0.1), huddle: { block: 'speaker', share: 0.3, r: 3.2, pose: 'sing' }, leave: { share: 0.2, at: 'end' }, mood: 0.1, topic: 'music', likes: ['joke', 'invite'] },
    toast: 'Караоке на сцене!' },
  { id: 'barhop', title: 'Кто в соседний бар?', icon: 'walk', at: [23.5, 24.2], chance: 0.3, scene: null, chat: 'barhop',
    effect: { dur: 0.1, leave: { share: 0.12 } },
    toast: 'Часть уходит дальше' },
  { id: 'blackout', title: 'Свет моргнул', icon: 'bulb', at: [21, 24], chance: 0.1, scene: null,
    effect: { dur: 0.1, mood: 0.05, topic: 'city' },
    toast: 'Свет моргнул' },
  { id: 'photo', title: 'Общее фото', icon: 'camera', at: [24.2, 24.5], chance: 0.85, scene: null, chat: 'photo',
    effect: { dur: 0.3, photo: true, mood: 0.1 },
    toast: 'Все на фото!' },
  { id: 'lastcall', title: 'До часу работаем', icon: 'clock', at: [24.55, 24.6], chance: 1, scene: null, chat: 'lastcall',
    effect: { dur: 0.4, leave: { share: 0.25 } },
    toast: 'SushiGO до часу' },

  // ── приносят чудики (chance 0: запускаются приходом чудика) ──
  { id: 'feast', title: 'Два кило суши', icon: 'sushi', at: [20, 21], chance: 0, scene: null, by: 'patron',
    effect: { dur: 1.5, mood: 0.15, energy: 0.05, topic: 'food', likes: ['praise', 'treat'], food: true },
    toast: 'Кормят весь стол!' },
  { id: 'pokercall', title: 'Покер в 20:30!', icon: 'cards', at: [19.5, 20.5], chance: 0, scene: null, by: 'poker',
    effect: { dur: 0.5, topic: 'games', likes: ['invite', 'argue'] },
    toast: 'Зовут в покер' },
  { id: 'debate', title: 'Спор про ИИ', icon: 'fire', at: [20, 21.5], chance: 0, scene: null, by: 'prophet',
    effect: { dur: 0.8, argue: true, topic: 'ai', likes: ['argue', 'facts'], dislikes: ['dream'] },
    toast: 'Спор про ИИ!' },
  { id: 'kitten', title: 'Котёнок ищет дом', icon: 'paw', at: [19.5, 21], chance: 0, scene: null, by: 'catmom',
    effect: { dur: 1, topic: 'pets', mood: 0.1, likes: ['praise'] },
    toast: 'Смотрите, котёнок!' },
  { id: 'quiz', title: 'Викторина Гения', icon: 'brain', at: [20, 21.5], chance: 0, scene: null, by: 'genius',
    effect: { dur: 0.5, topic: 'ai', likes: ['facts', 'argue'] },
    toast: 'Задачка на салфетке' },
  { id: 'bananas', title: 'Бананы на столе', icon: 'banana', at: [20, 21.5], chance: 0, scene: null, by: 'meme',
    effect: { dur: 1, mood: 0.1, likes: ['joke'] },
    toast: 'Кто хочет банан?' },
];
return { EVENTS };
});
