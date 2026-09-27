// Манифест ассетов «Житьё» (владелец: 📦 Ассеты). Формат — docs/CONTRACT.md §5.
// Пути — от корня сайта. Источники и лицензии — assets/CREDITS.md / assets/credits.json.
//
// Мебель уже нормализована при сборке (scratchpad build-furniture.mjs → assets/models/furniture/*.glb):
//   • метры, опора в y=0, центр следа (fp) в x=z=0, «лицо» (rot=0) смотрит в +Z;
//   • габарит ≤ fp×0.98 по x/z (кроме настенных);
//   • scale: 1 — значит «не вписывать повторно» (instantiate() в assets.js берёт scale как есть).
// Настенные (place:'wall'):
//   • door, window — центрированы по толщине стены (z=0); door 0.98×2.2 м (DOOR_TOP=2.2),
//     window 0.96×1.2 м, ставится с yOffset 0.9 (WIN_BOTTOM..WIN_TOP = 0.9..2.1);
//     у двери створка — отдельный узел 'door' (петля у края, можно поворачивать вокруг Y).
//   • mirror, painting — задник в z=0, толщина в +Z; yOffset = высота нижнего края над полом.
// Поверхностные (place:'surface'): phone — опора в y=0, высоту стола добавляет Рендер (SURFACE_H).
// mount — необязательная подсказка: 'floor' | 'wall-center' | 'wall-back' | 'surface'.

import { CATALOG } from '../../data/catalog.js';

const F = (id) => `assets/models/furniture/${id}.glb`;

export const MODELS = {
  // — Кухня —
  fridge:        { url: F('fridge'),        scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  stove:         { url: F('stove'),         scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  counter:       { url: F('counter'),       scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  kitchen_sink:  { url: F('kitchen_sink'),  scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  dining_table:  { url: F('dining_table'),  scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  dining_chair:  { url: F('dining_chair'),  scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  trash_can:     { url: F('trash_can'),     scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  // — Гостиная —
  sofa:          { url: F('sofa'),          scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  armchair:      { url: F('armchair'),      scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  coffee_table:  { url: F('coffee_table'),  scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  tv:            { url: F('tv'),            scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  stereo:        { url: F('stereo'),        scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  bookshelf:     { url: F('bookshelf'),     scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  computer_desk: { url: F('computer_desk'), scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  chess:         { url: F('chess'),         scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  phone:         { url: F('phone'),         scale: 1, rotY: 0, yOffset: 0, mount: 'surface' },
  // — Спальня —
  bed_single:    { url: F('bed_single'),    scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  bed_double:    { url: F('bed_double'),    scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  dresser:       { url: F('dresser'),       scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  mirror:        { url: F('mirror'),        scale: 1, rotY: 0, yOffset: 1.0, mount: 'wall-back' },
  // — Ванная —
  toilet:        { url: F('toilet'),        scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  shower:        { url: F('shower'),        scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  bathtub:       { url: F('bathtub'),       scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  bath_sink:     { url: F('bath_sink'),     scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  // — Свет и декор —
  floor_lamp:    { url: F('floor_lamp'),    scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  painting:      { url: F('painting'),      scale: 1, rotY: 0, yOffset: 1.3, mount: 'wall-back' },
  plant:         { url: F('plant'),         scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  rug:           { url: F('rug'),           scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  // — Улица —
  mailbox:       { url: F('mailbox'),       scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  // — Строительство —
  door:          { url: F('door'),          scale: 1, rotY: 0, yOffset: 0, mount: 'wall-center' },
  window:        { url: F('window'),        scale: 1, rotY: 0, yOffset: 0.9, mount: 'wall-center' },
  // — Волна 2 —
  exercise_bench:{ url: F('exercise_bench'),scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },    // лёжа вдоль Z, голова к −Z (стойки со штангой)
  easel:         { url: F('easel'),         scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },    // холст смотрит в +Z, художник стоит перед ним
  smoke_alarm:   { url: F('smoke_alarm'),   scale: 1, rotY: 0, yOffset: 2.3, mount: 'wall-back' },
  burglar_alarm: { url: F('burglar_alarm'), scale: 1, rotY: 0, yOffset: 1.5, mount: 'wall-back' },
  crib:          { url: F('crib'),          scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  tombstone:     { url: F('tombstone'),     scale: 1, rotY: 0, yOffset: 0, mount: 'floor' },
  // Лестница 1×4: НИЗ — у +Z (со стороны «лица» rot=0), ВЕРХ — у −Z на высоте 3.0 м (= LEVEL_H).
  // 15 сплошных ступеней: подъём 0.2 м, проступь 0.267 м; перила по стороне +X. Геометрия от z=+2 (низ) до z=−2 (верх).
  stairs:        { url: F('stairs'),        scale: 1, rotY: 0, yOffset: 0, mount: 'floor', stairs: { bottom: '+Z', top: '-Z', rise: 3, steps: 15, tread: 4 / 15 } },
};

// Люди: риг Quaternius UAL (65 костей), лицо в +Z, опора в y=0, T-поза в покое; анимаций внутри нет — клипы из ANIMS.
// Клонировать через SkeletonUtils.clone(); клипы привязываются по именам костей.
// СОВРЕМЕННАЯ ОДЕЖДА (волна 2): тело Quaternius UBC, одежда — отдельные материалы без текстур:
//   'shirt' (футболка/свитер), 'pants', 'shoes', 'dress' (платье, вместо shirt+pants), 'hair' (волосы и брови),
//   'skin' (текстура лица/кожи, можно умножать на цвет кожи), 'eyes'. Красить: material.color по имени.
// Позы для посадки: сидя таз y≈0.54, на 0.33 м позади origin; Lie_Idle_Loop — на спине вдоль Z, голова к −Z, y≈0.05.
const C = (f) => `assets/models/characters/modern/${f}.glb`;
const TINT = ['shirt', 'pants', 'shoes', 'dress', 'hair'];
export const CHARACTERS = {
  male:     { url: C('man'),     height: 1.81, sex: 'm', age: 'adult', tintable: TINT, outfit: 'футболка+джинсы' },
  female:   { url: C('woman'),   height: 1.80, sex: 'f', age: 'adult', tintable: TINT, outfit: 'футболка+джинсы' },
  male_b:   { url: C('man_b'),   height: 1.80, sex: 'm', age: 'adult', tintable: TINT, outfit: 'свитер+брюки, борода' },
  female_b: { url: C('woman_b'), height: 1.80, sex: 'f', age: 'adult', tintable: TINT, outfit: 'платье' },
  elder:    { url: C('elder'),   height: 1.80, sex: 'm', age: 'elder', tintable: TINT, outfit: 'свитер+брюки, седой, борода' },
  elder_f:  { url: C('elder_f'), height: 1.78, sex: 'f', age: 'elder', tintable: TINT, outfit: 'длинное платье, седая' },
};
// Дети — отдельно, чтобы не попадать в пул взрослых. Уже уменьшены ×0.65 (обёртка 'ChildScale' над костью root)
// и голова ×1.3 (масштаб кости Head). Рендер вписывает по height как обычно — повторно ×0.65 НЕ умножать.
export const CHILDREN = {
  child_m: { url: C('child_m'), height: 1.22, sex: 'm', age: 'child', tintable: TINT, outfit: 'футболка+шорты' },
  child_f: { url: C('child_f'), height: 1.22, sex: 'f', age: 'child', tintable: TINT, outfit: 'платье' },
};
// Прежние (волна 1) персонажи в «крестьянской» одежде — запасной вариант.
export const CHARACTERS_LEGACY = {
  male:     { url: 'assets/models/characters/man.glb',     height: 1.81, sex: 'm', tintable: ['MI_Peasant', 'MI_Hair_1'] },
  female:   { url: 'assets/models/characters/woman.glb',   height: 1.80, sex: 'f', tintable: ['MI_Peasant', 'MI_Hair_2'] },
  male_b:   { url: 'assets/models/characters/man_b.glb',   height: 1.81, sex: 'm', tintable: ['MI_Peasant', 'MI_Hair_1'] },
  female_b: { url: 'assets/models/characters/woman_b.glb', height: 1.80, sex: 'f', tintable: ['MI_Peasant', 'MI_Hair_2'] },
  elder:    { url: 'assets/models/characters/elder.glb',   height: 1.84, sex: 'm', tintable: [] },   // дед в капюшоне — годится под балахон Смерти
};

// Реквизит НПС: крепится дочерним объектом к кости (bone.add(prop)); position/quaternion — локально к кости,
// посчитаны по bind-позе. Ручные: +Y вдоль предплечья (черенок вертикален при опущенной руке).
// pizza_box/plate/book — на ладони (ладони вверх в Walk_Carry_Loop / Read_Loop). helmet/cap — на кости Head.
const PR = (f) => `assets/models/props/${f}.glb`;
export const PROPS = {
  scythe:       { url: PR('scythe'), bone: 'hand_r', position: [-0.0248, 0.073, 0.003], quaternion: [0.0031, 0.0214, -0.9998, -0.0017], npc: 'reaper' },
  mop:          { url: PR('mop'), bone: 'hand_r', position: [-0.0248, 0.073, 0.003], quaternion: [0.0031, 0.0214, -0.9998, -0.0017], npc: 'maid' },
  wrench:       { url: PR('wrench'), bone: 'hand_r', position: [-0.0248, 0.073, 0.003], quaternion: [0.0031, 0.0214, -0.9998, -0.0017], npc: 'repair' },
  extinguisher: { url: PR('extinguisher'), bone: 'hand_r', position: [-0.0248, 0.073, 0.003], quaternion: [0.0031, 0.0214, -0.9998, -0.0017], npc: 'fire' },
  trash_bag:    { url: PR('trash_bag'), bone: 'hand_r', position: [-0.0248, 0.073, 0.003], quaternion: [0.0031, 0.0214, -0.9998, -0.0017], npc: 'any' },
  pizza_box:    { url: PR('pizza_box'), bone: 'hand_r', position: [-0.0931, 0.1684, -0.1396], quaternion: [0.0588, -0.5272, -0.7434, -0.4073], npc: 'pizza' },
  plate:        { url: PR('plate'), bone: 'hand_r', position: [-0.0997, 0.1673, -0.1322], quaternion: [0.0588, -0.5272, -0.7434, -0.4073], npc: 'any' },
  book:         { url: PR('book'), bone: 'hand_r', position: [-0.0898, 0.0733, 0.0026], quaternion: [0.4943, -0.4943, -0.4145, 0.5827], npc: 'any' },
  helmet:       { url: PR('helmet'), bone: 'Head', position: [0, 0.1557, 0.0117], quaternion: [-0.0163, 0, 0, 0.9999], npc: 'fire' },
  cap:          { url: PR('cap'), bone: 'Head', position: [0, 0.1657, 0.0114], quaternion: [-0.0163, 0, 0, 0.9999], npc: 'pizza' },
};

// Клипы UAL 1+2 (Standard, CC0) в одном glb без меша + производные: Lie_* (из LayToIdle) и 8 процедурных
// (Wave/Laugh/Cry/Read/Sit_Read/Exercise/Shower/Sit_Eat — база UAL + руки по IK, assets/_src/anims2.mjs).
// clipMap: имя из CONTRACT (sim.anim) → имя клипа. Все 32 имени закрыты.
export const ANIMS = {
  urls: ['assets/anims/ual_anims.glb'],
  url: 'assets/anims/ual_anims.glb',
  clipMap: {
    idle: 'Idle_Loop',
    walk: 'Walk_Loop',
    run: 'Jog_Fwd_Loop',
    sit: 'Sitting_Enter',
    sitIdle: 'Sitting_Idle_Loop',
    sitTalk: 'Sitting_Talking_Loop',
    standUp: 'Sitting_Exit',
    eat: 'Consume',
    drink: 'Consume',
    sleep: 'Lie_Idle_Loop',
    lieDown: 'Lie_Down',
    getUp: 'LayToIdle',
    talk: 'Idle_Talking_Loop',
    phone: 'Idle_TalkingPhone_Loop',
    wave: 'Wave_Loop',
    laugh: 'Laugh_Loop',
    angry: 'Idle_FoldArms_Loop',
    cry: 'Cry_Loop',
    dance: 'Dance_Loop',
    cook: 'Interact',
    wash: 'Farm_Watering',
    pickup: 'PickUp_Table',
    interact: 'Interact',
    repair: 'Fixing_Kneeling',
    read: 'Read_Loop',
    watchTV: 'Sitting_Idle_Loop',
    useComputer: 'Sitting_Talking_Loop',
    toilet: 'Sitting_Idle_Loop',
    shower: 'Shower_Loop',
    exercise: 'Exercise_Loop',
    no: 'Idle_No_Loop',
    yes: 'Yes',
    // дополнительные (не из CONTRACT): еда/чтение сидя, ходьба с ношей
    sitEat: 'Sit_Eat_Loop',
    sitRead: 'Sit_Read_Loop',
    carry: 'Walk_Carry_Loop',
  },
  // если клипа нет — ближайший (имя CONTRACT → имя CONTRACT)
  fallback: { sitEat: 'eat', sitRead: 'read', carry: 'walk', wave: 'talk', laugh: 'yes', cry: 'no', exercise: 'run', shower: 'wash', read: 'idle' },
};

// <gen:shapes> — СГЕНЕРИРОВАНО assets/_src/gen-manifest.mjs из assets/models/lib/_lib.json, руками не править
export const SHAPES = {
  "fireplace": {"url":"assets/models/lib/fireplace.glb","size":[1.45,2.5,0.66],"kinds":["fireplace"],"group":"kind","tint":"wood","tintable":["brick","soot","wood"]},
  "fireplace_stone": {"url":"assets/models/lib/fireplace_stone.glb","size":[1.4,2.45,0.631],"kinds":["fireplace"],"group":"kind","tint":"stone","tintable":["stone","soot"]},
  "piano": {"url":"assets/models/lib/piano.glb","size":[1.5,1.25,0.92],"kinds":["piano"],"group":"kind","tint":"lacquer","tintable":["lacquer"]},
  "piano_grand": {"url":"assets/models/lib/piano_grand.glb","size":[1.4,0.97,1.95],"kinds":["piano"],"group":"kind","tint":"lacquer","tintable":["lacquer"]},
  "guitar": {"url":"assets/models/lib/guitar.glb","size":[0.38,1.38,0.25],"kinds":["guitar"],"group":"kind","tint":"guitarBody","tintable":["guitarBody","fretboard","stand"]},
  "telescope": {"url":"assets/models/lib/telescope.glb","size":[0.518,1.251,1.16],"kinds":["telescope"],"group":"kind","tint":"tube","tintable":["tripod","tube"]},
  "aquarium": {"url":"assets/models/lib/aquarium.glb","size":[1.22,1.36,0.47],"kinds":["aquarium"],"group":"kind","tint":"cabinet","tintable":["cabinet","sand","fish","weed"]},
  "pool_table": {"url":"assets/models/lib/pool_table.glb","size":[2.2,0.848,1.2],"kinds":["pool_table"],"group":"kind","tint":"felt","tintable":["felt","wood","balls","ballsRed"]},
  "dartboard": {"url":"assets/models/lib/dartboard.glb","size":[0.48,0.48,0.06],"kinds":["dartboard"],"group":"kind","tint":"board","tintable":["board","ringRed","ringGreen","cork"],"wall":"back","yOffset":1.35},
  "arcade_machine": {"url":"assets/models/lib/arcade_machine.glb","size":[0.966,1.75,1.297],"kinds":["video_game"],"group":"kind","tint":"colormap","tintable":["colormap"]},
  "game_console": {"url":"assets/models/lib/game_console.glb","size":[1,1.05,0.42],"kinds":["video_game"],"group":"kind","tint":"cabinet","tintable":["cabinet","bezel","console"]},
  "dance_machine": {"url":"assets/models/lib/dance_machine.glb","size":[1.446,1.9,2.05],"kinds":["video_game"],"group":"furn","tint":"colormap","tintable":["colormap"]},
  "claw_machine": {"url":"assets/models/lib/claw_machine.glb","size":[1.237,1.8,1.313],"kinds":["video_game","pinball"],"group":"furn","tint":"colormap","tintable":["colormap"]},
  "pinball": {"url":"assets/models/lib/pinball.glb","size":[1.18,1.75,1.77],"kinds":["pinball"],"group":"kind","tint":"colormap","tintable":["colormap"]},
  "air_hockey": {"url":"assets/models/lib/air_hockey.glb","size":[1.7,0.85,1.19],"kinds":["pool_table"],"group":"furn","tint":"colormap","tintable":["colormap"]},
  "treadmill": {"url":"assets/models/lib/treadmill.glb","size":[0.8,1.45,1.8],"kinds":["treadmill"],"group":"kind","tint":"frame","tintable":["frame","belt"]},
  "hot_tub": {"url":"assets/models/lib/hot_tub.glb","size":[2.155,0.9,2.04],"kinds":["hot_tub"],"group":"kind","tint":"wood","tintable":["wood","rim"]},
  "grill": {"url":"assets/models/lib/grill.glb","size":[0.585,1.02,0.665],"kinds":["grill"],"group":"kind","tint":"grillBody","tintable":["grillBody"]},
  "coffee_maker": {"url":"assets/models/lib/coffee_maker.glb","size":[0.389,0.364,0.492],"kinds":["coffee_maker"],"group":"kind","tint":"carpetWhite","tintable":["carpetWhite"],"surface":true},
  "microwave": {"url":"assets/models/lib/microwave.glb","size":[0.594,0.369,0.471],"kinds":["microwave"],"group":"kind","tint":"carpetWhite","tintable":["carpetWhite"],"surface":true},
  "dishwasher": {"url":"assets/models/lib/dishwasher.glb","size":[0.92,0.92,0.955],"kinds":["dishwasher"],"group":"kind","tint":"counterTop","tintable":["counterTop","panel"]},
  "washing_machine": {"url":"assets/models/lib/washing_machine.glb","size":[0.8,0.963,0.799],"kinds":["washing_machine"],"group":"kind","tint":"_defaultMat","tintable":["_defaultMat"]},
  "dryer": {"url":"assets/models/lib/dryer.glb","size":[0.8,0.963,0.779],"kinds":["washing_machine"],"group":"furn","tint":null,"tintable":[]},
  "washer_dryer": {"url":"assets/models/lib/washer_dryer.glb","size":[0.8,1.927,0.799],"kinds":["washing_machine"],"group":"furn","tint":"_defaultMat","tintable":["_defaultMat"]},
  "toy_box": {"url":"assets/models/lib/toy_box.glb","size":[0.8,0.8,0.505],"kinds":["toy_box"],"group":"kind","tint":"toyWood","tintable":["toyWood","toyRed","toyBlue","toyYellow"]},
  "teddy_bear": {"url":"assets/models/lib/teddy_bear.glb","size":[0.39,0.45,0.248],"kinds":["toy_box"],"group":"furn","tint":"wood","tintable":["fur","wood"]},
  "dollhouse": {"url":"assets/models/lib/dollhouse.glb","size":[0.9,0.962,0.7],"kinds":["dollhouse"],"group":"kind","tint":"wood","tintable":["wood","colormap"]},
  "kids_bed": {"url":"assets/models/lib/kids_bed.glb","size":[0.828,0.544,1.631],"kinds":["kids_bed"],"group":"kind","tint":"carpet","tintable":["carpetWhite","wood","carpet"]},
  "bunk_bed": {"url":"assets/models/lib/bunk_bed.glb","size":[1.171,1.742,2.245],"kinds":["bunk_bed"],"group":"kind","tint":"carpet","tintable":["wood","carpetWhite","carpet"]},
  "wardrobe": {"url":"assets/models/lib/wardrobe.glb","size":[0.941,2,0.588],"kinds":["wardrobe"],"group":"kind","tint":"wood","tintable":["wood"]},
  "desk_lamp": {"url":"assets/models/lib/desk_lamp.glb","size":[0.246,0.594,0.246],"kinds":["desk_lamp"],"group":"kind","tint":null,"tintable":[],"surface":true},
  "desk_lamp_round": {"url":"assets/models/lib/desk_lamp_round.glb","size":[0.312,0.644,0.36],"kinds":["desk_lamp"],"group":"furn","tint":null,"tintable":[],"surface":true},
  "ceiling_lamp": {"url":"assets/models/lib/ceiling_lamp.glb","size":[0.246,0.472,0.246],"kinds":["ceiling_lamp"],"group":"kind","tint":null,"tintable":[],"ceiling":true},
  "ceiling_fan": {"url":"assets/models/lib/ceiling_fan.glb","size":[0.932,0.274,1.076],"kinds":["ceiling_lamp"],"group":"furn","tint":"wood","tintable":["wood"],"ceiling":true},
  "sculpture": {"url":"assets/models/lib/sculpture.glb","size":[0.5,1.49,0.5],"kinds":["sculpture"],"group":"kind","tint":"marble","tintable":["marble","stone","stoneDark","_defaultMat"]},
  "sculpture_obelisk": {"url":"assets/models/lib/sculpture_obelisk.glb","size":[0.631,1.8,0.631],"kinds":["sculpture"],"group":"furn","tint":"stoneDark","tintable":["stoneDark","stone"]},
  "sculpture_ring": {"url":"assets/models/lib/sculpture_ring.glb","size":[1.055,1.4,0.703],"kinds":["sculpture"],"group":"furn","tint":"stone","tintable":["stone","stoneDark"]},
  "sculpture_abstract": {"url":"assets/models/lib/sculpture_abstract.glb","size":[0.5,1.49,0.5],"kinds":["sculpture"],"group":"furn","tint":"marble","tintable":["marble","bronze"]},
  "clock": {"url":"assets/models/lib/clock.glb","size":[0.55,2.08,0.38],"kinds":["clock"],"group":"kind","tint":"wood","tintable":["wood"]},
  "clock_wall": {"url":"assets/models/lib/clock_wall.glb","size":[0.36,0.36,0.047],"kinds":["clock"],"group":"furn","tint":"rim","tintable":["rim"],"wall":"back","yOffset":1.7},
  "flower_vase": {"url":"assets/models/lib/flower_vase.glb","size":[0.18,0.51,0.175],"kinds":["flower_vase"],"group":"kind","tint":"vase","tintable":["vase","stem","petalRed","petalYellow","petalWhite"],"surface":true},
  "plant_small_a": {"url":"assets/models/lib/plant_small_a.glb","size":[0.208,0.308,0.208],"kinds":["flower_vase","plant"],"group":"furn","tint":"wood","tintable":["wood","plant"],"surface":true},
  "plant_small_b": {"url":"assets/models/lib/plant_small_b.glb","size":[0.208,0.308,0.208],"kinds":["flower_vase","plant"],"group":"furn","tint":"wood","tintable":["wood","plant"],"surface":true},
  "plant_small_c": {"url":"assets/models/lib/plant_small_c.glb","size":[0.216,0.319,0.187],"kinds":["flower_vase","plant"],"group":"furn","tint":"wood","tintable":["wood","plant"],"surface":true},
  "pool": {"url":"assets/models/lib/pool.glb","size":[3,0.96,5],"kinds":["pool"],"group":"kind","tint":"poolRim","tintable":["poolRim","poolTile"]},
  "park_bench": {"url":"assets/models/lib/park_bench.glb","size":[1.304,0.85,0.735],"kinds":["park_bench"],"group":"kind","tint":"colormap","tintable":["colormap"]},
  "park_bench_iron": {"url":"assets/models/lib/park_bench_iron.glb","size":[1.304,0.85,0.735],"kinds":["park_bench"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "fountain": {"url":"assets/models/lib/fountain.glb","size":[2.8,0.392,2.8],"kinds":["fountain"],"group":"kind","tint":"colormap","tintable":["colormap"]},
  "fountain_square": {"url":"assets/models/lib/fountain_square.glb","size":[2.8,0.637,2.8],"kinds":["fountain"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "food_stall": {"url":"assets/models/lib/food_stall.glb","size":[1.94,2.4,1.94],"kinds":["food_stall"],"group":"kind","tint":"colormap","tintable":["colormap"]},
  "food_stall_green": {"url":"assets/models/lib/food_stall_green.glb","size":[1.94,2.4,1.94],"kinds":["food_stall"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "food_cart": {"url":"assets/models/lib/food_cart.glb","size":[2.335,1.4,3.503],"kinds":["food_stall"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "cash_register": {"url":"assets/models/lib/cash_register.glb","size":[0.96,1.26,0.62],"kinds":["cash_register"],"group":"kind","tint":"counter","tintable":["counter","top","register"]},
  "shelf_shop": {"url":"assets/models/lib/shelf_shop.glb","size":[1.694,1.8,1.482],"kinds":["shelf_shop"],"group":"kind","tint":"colormap","tintable":["colormap"]},
  "shelf_shop_bags": {"url":"assets/models/lib/shelf_shop_bags.glb","size":[1.668,1.8,1.459],"kinds":["shelf_shop"],"group":"furn","tint":"colormap","tintable":["colormap"]},
  "shop_freezer": {"url":"assets/models/lib/shop_freezer.glb","size":[2.286,1,1.714],"kinds":["shelf_shop"],"group":"furn","tint":"colormap","tintable":["colormap"]},
  "shop_freezer_tall": {"url":"assets/models/lib/shop_freezer_tall.glb","size":[2.222,2,1.111],"kinds":["shelf_shop"],"group":"furn","tint":"colormap","tintable":["colormap"]},
  "shop_fruit": {"url":"assets/models/lib/shop_fruit.glb","size":[1.163,1,1.163],"kinds":["shelf_shop"],"group":"furn","tint":"colormap","tintable":["colormap"]},
  "shop_bread": {"url":"assets/models/lib/shop_bread.glb","size":[1.68,1.2,1.44],"kinds":["shelf_shop"],"group":"furn","tint":"colormap","tintable":["colormap"]},
  "vending_machine": {"url":"assets/models/lib/vending_machine.glb","size":[1.267,1.9,1.203],"kinds":["shelf_shop","video_game"],"group":"furn","tint":"colormap","tintable":["colormap"]},
  "cafe_table": {"url":"assets/models/lib/cafe_table.glb","size":[1.61,0.88,0.689],"kinds":["cafe_table"],"group":"kind","tint":"chairSeat","tintable":["tableTop","chairSeat"]},
  "cafe_table_parasol": {"url":"assets/models/lib/cafe_table_parasol.glb","size":[1.767,2.295,2.04],"kinds":["cafe_table"],"group":"furn","tint":"chairSeat","tintable":["tableTop","chairSeat","colormap"]},
  "gym_machine": {"url":"assets/models/lib/gym_machine.glb","size":[1,2.03,1.3],"kinds":["gym_machine"],"group":"kind","tint":"pad","tintable":["frame","pad","weights"]},
  "library_shelf": {"url":"assets/models/lib/library_shelf.glb","size":[1.64,1.619,0.512],"kinds":["library_shelf"],"group":"kind","tint":"wood","tintable":["wood","carpetDarker","carpetWhite","plant"]},
  "museum_exhibit": {"url":"assets/models/lib/museum_exhibit.glb","size":[0.7,1.52,0.7],"kinds":["museum_exhibit"],"group":"kind","tint":"cloth","tintable":["plinth","cloth"]},
  "swing_set": {"url":"assets/models/lib/swing_set.glb","size":[2.5,2.129,1.185],"kinds":["swing_set"],"group":"kind","tint":"seat","tintable":["frame","seat"]},
  "sandbox": {"url":"assets/models/lib/sandbox.glb","size":[1.92,0.3,1.92],"kinds":["sandbox"],"group":"kind","tint":"wood","tintable":["wood","sand","toy"]},
  "trash_bin_street": {"url":"assets/models/lib/trash_bin_street.glb","size":[0.6,0.98,0.585],"kinds":["trash_bin_street"],"group":"kind","tint":"binGreen","tintable":["binGreen","lid"]},
  "dumpster": {"url":"assets/models/lib/dumpster.glb","size":[1.486,1.132,2],"kinds":["trash_bin_street"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "streetlight": {"url":"assets/models/lib/streetlight.glb","size":[0.593,3.6,1.321],"kinds":["streetlight"],"group":"kind","tint":"colormap","tintable":["colormap"]},
  "streetlight_double": {"url":"assets/models/lib/streetlight_double.glb","size":[0.593,3.6,2.065],"kinds":["streetlight"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "streetlight_modern": {"url":"assets/models/lib/streetlight_modern.glb","size":[0.417,5,1.979],"kinds":["streetlight"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "streetlight_curved": {"url":"assets/models/lib/streetlight_curved.glb","size":[0.37,5,1.667],"kinds":["streetlight"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "lantern_post": {"url":"assets/models/lib/lantern_post.glb","size":[0.334,2.4,0.346],"kinds":["streetlight"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "hedge": {"url":"assets/models/lib/hedge.glb","size":[0.665,0.9,0.983],"kinds":["hedge"],"group":"kind","tint":"leaves","tintable":["leaves","leavesDark"]},
  "hedge_large": {"url":"assets/models/lib/hedge_large.glb","size":[0.665,1.5,0.983],"kinds":["hedge"],"group":"hood","tint":"leaves","tintable":["leaves","leavesDark"]},
  "hedge_curved": {"url":"assets/models/lib/hedge_curved.glb","size":[1,0.25,1],"kinds":["decor"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "tree": {"url":"assets/models/lib/tree.glb","size":[2.431,5.5,2.106],"kinds":["tree"],"group":"kind","tint":"woodBark","tintable":["woodBark","leafsGreen"]},
  "flowerbed": {"url":"assets/models/lib/flowerbed.glb","size":[1.006,0.468,1],"kinds":["flowerbed"],"group":"kind","tint":"soil","tintable":["soil","border","grass","colorRed","colorYellow","colorPurple","colorWhite"]},
  "fence": {"url":"assets/models/lib/fence.glb","size":[1,0.345,0.07],"kinds":["fence"],"group":"kind","tint":"wood","tintable":["wood","woodDark"],"wall":"edge"},
  "fence_planks": {"url":"assets/models/lib/fence_planks.glb","size":[1,0.345,0.096],"kinds":["fence"],"group":"hood","tint":"wood","tintable":["wood"],"wall":"edge"},
  "fence_high": {"url":"assets/models/lib/fence_high.glb","size":[1,0.331,0.107],"kinds":["fence"],"group":"hood","tint":"wood","tintable":["wood"],"wall":"edge"},
  "fence_iron": {"url":"assets/models/lib/fence_iron.glb","size":[1,0.879,0.11],"kinds":["fence"],"group":"hood","tint":"colormap","tintable":["colormap"],"wall":"edge"},
  "fence_picket": {"url":"assets/models/lib/fence_picket.glb","size":[1,0.568,0.158],"kinds":["fence"],"group":"hood","tint":"colormap","tintable":["colormap"],"wall":"edge"},
  "fence_gate": {"url":"assets/models/lib/fence_gate.glb","size":[1,0.345,0.07],"kinds":["fence"],"group":"hood","tint":"wood","tintable":["wood","woodDark","stone"],"wall":"edge"},
  "k_loungeSofa": {"url":"assets/models/lib/k_loungeSofa.glb","size":[2.009,0.943,0.841],"kinds":["sofa"],"group":"furn","tint":"carpet","tintable":["carpet","wood"]},
  "k_loungeSofaLong": {"url":"assets/models/lib/k_loungeSofaLong.glb","size":[2.009,0.943,1.681],"kinds":["sofa"],"group":"furn","tint":"carpet","tintable":["carpet","wood"]},
  "k_loungeDesignSofa": {"url":"assets/models/lib/k_loungeDesignSofa.glb","size":[2.296,0.82,0.841],"kinds":["sofa"],"group":"furn","tint":"carpetBlue","tintable":["carpetBlue"]},
  "k_loungeSofaCorner": {"url":"assets/models/lib/k_loungeSofaCorner.glb","size":[2.009,0.943,2.009],"kinds":["sofa"],"group":"furn","tint":"carpet","tintable":["carpet","wood"]},
  "k_loungeDesignSofaCorner": {"url":"assets/models/lib/k_loungeDesignSofaCorner.glb","size":[2.767,0.82,2.767],"kinds":["sofa"],"group":"furn","tint":"carpetBlue","tintable":["carpetBlue"]},
  "k_benchCushion": {"url":"assets/models/lib/k_benchCushion.glb","size":[0.82,0.943,0.41],"kinds":["sofa"],"group":"furn","tint":"carpet","tintable":["wood","carpet"]},
  "k_loungeChair": {"url":"assets/models/lib/k_loungeChair.glb","size":[1.004,0.943,0.841],"kinds":["armchair"],"group":"furn","tint":"carpet","tintable":["carpet","wood"]},
  "k_loungeChairRelax": {"url":"assets/models/lib/k_loungeChairRelax.glb","size":[1.004,1.291,1.383],"kinds":["armchair"],"group":"furn","tint":"carpet","tintable":["carpet","wood"]},
  "k_loungeDesignChair": {"url":"assets/models/lib/k_loungeDesignChair.glb","size":[1.496,0.82,0.841],"kinds":["armchair"],"group":"furn","tint":"carpetBlue","tintable":["carpetBlue"]},
  "k_loungeSofaOttoman": {"url":"assets/models/lib/k_loungeSofaOttoman.glb","size":[0.902,0.472,0.923],"kinds":["armchair"],"group":"furn","tint":"carpet","tintable":["wood","carpet"]},
  "k_chair": {"url":"assets/models/lib/k_chair.glb","size":[0.41,0.963,0.41],"kinds":["dining_chair"],"group":"furn","tint":"wood","tintable":["wood"]},
  "k_chairCushion": {"url":"assets/models/lib/k_chairCushion.glb","size":[0.41,0.943,0.41],"kinds":["dining_chair"],"group":"furn","tint":"carpet","tintable":["wood","carpet"]},
  "k_chairModernCushion": {"url":"assets/models/lib/k_chairModernCushion.glb","size":[0.41,0.943,0.41],"kinds":["dining_chair"],"group":"furn","tint":"carpetBlue","tintable":["carpetBlue"]},
  "k_chairModernFrameCushion": {"url":"assets/models/lib/k_chairModernFrameCushion.glb","size":[0.41,0.943,0.41],"kinds":["dining_chair"],"group":"furn","tint":"carpetBlue","tintable":["carpetBlue"]},
  "k_chairRounded": {"url":"assets/models/lib/k_chairRounded.glb","size":[0.41,0.933,0.41],"kinds":["dining_chair"],"group":"furn","tint":"wood","tintable":["wood"]},
  "k_chairDesk": {"url":"assets/models/lib/k_chairDesk.glb","size":[0.687,1.246,0.644],"kinds":["dining_chair"],"group":"furn","tint":"carpet","tintable":["carpet"]},
  "k_stoolBar": {"url":"assets/models/lib/k_stoolBar.glb","size":[0.544,0.892,0.471],"kinds":["dining_chair"],"group":"furn","tint":"carpet","tintable":["wood","carpet"]},
  "k_stoolBarSquare": {"url":"assets/models/lib/k_stoolBarSquare.glb","size":[0.315,0.83,0.303],"kinds":["dining_chair"],"group":"furn","tint":"carpet","tintable":["wood","carpet"]},
  "k_bench": {"url":"assets/models/lib/k_bench.glb","size":[0.82,0.963,0.41],"kinds":["dining_chair"],"group":"furn","tint":"wood","tintable":["wood"]},
  "k_benchCushionLow": {"url":"assets/models/lib/k_benchCushionLow.glb","size":[0.861,0.41,0.451],"kinds":["dining_chair"],"group":"furn","tint":"carpet","tintable":["wood","carpet","_defaultMat"]},
  "k_table": {"url":"assets/models/lib/k_table.glb","size":[1.725,0.67,0.917],"kinds":["dining_table"],"group":"furn","tint":"wood","tintable":["wood"]},
  "k_tableCloth": {"url":"assets/models/lib/k_tableCloth.glb","size":[1.725,0.67,0.917],"kinds":["dining_table"],"group":"furn","tint":"carpet","tintable":["wood","carpet"]},
  "k_tableCross": {"url":"assets/models/lib/k_tableCross.glb","size":[1.747,0.712,0.917],"kinds":["dining_table"],"group":"furn","tint":"wood","tintable":["wood"]},
  "k_tableCrossCloth": {"url":"assets/models/lib/k_tableCrossCloth.glb","size":[1.747,0.712,0.917],"kinds":["dining_table"],"group":"furn","tint":"carpet","tintable":["wood","carpet"]},
  "k_tableGlass": {"url":"assets/models/lib/k_tableGlass.glb","size":[1.725,0.67,0.917],"kinds":["dining_table"],"group":"furn","tint":null,"tintable":[]},
  "k_tableRound": {"url":"assets/models/lib/k_tableRound.glb","size":[1.42,0.752,1.64],"kinds":["dining_table"],"group":"furn","tint":"wood","tintable":["wood"]},
  "k_tableCoffee": {"url":"assets/models/lib/k_tableCoffee.glb","size":[1.355,0.472,0.82],"kinds":["coffee_table"],"group":"furn","tint":"wood","tintable":["wood"]},
  "k_tableCoffeeGlass": {"url":"assets/models/lib/k_tableCoffeeGlass.glb","size":[1.355,0.472,0.82],"kinds":["coffee_table"],"group":"furn","tint":null,"tintable":[]},
  "k_tableCoffeeGlassSquare": {"url":"assets/models/lib/k_tableCoffeeGlassSquare.glb","size":[0.82,0.472,0.82],"kinds":["coffee_table"],"group":"furn","tint":null,"tintable":[]},
  "k_tableCoffeeSquare": {"url":"assets/models/lib/k_tableCoffeeSquare.glb","size":[0.82,0.472,0.82],"kinds":["coffee_table"],"group":"furn","tint":"wood","tintable":["wood"]},
  "k_sideTable": {"url":"assets/models/lib/k_sideTable.glb","size":[1.096,0.788,0.451],"kinds":["coffee_table"],"group":"furn","tint":"wood","tintable":["wood","_defaultMat"]},
  "k_sideTableDrawers": {"url":"assets/models/lib/k_sideTableDrawers.glb","size":[1.096,0.788,0.456],"kinds":["coffee_table"],"group":"furn","tint":"wood","tintable":["wood","_defaultMat"]},
  "k_bookcaseOpen": {"url":"assets/models/lib/k_bookcaseOpen.glb","size":[0.82,1.804,0.512],"kinds":["bookshelf"],"group":"furn","tint":"wood","tintable":["wood"]},
  "k_bookcaseOpenLow": {"url":"assets/models/lib/k_bookcaseOpenLow.glb","size":[0.82,0.82,0.512],"kinds":["bookshelf"],"group":"furn","tint":"wood","tintable":["wood"]},
  "k_bookcaseClosed": {"url":"assets/models/lib/k_bookcaseClosed.glb","size":[0.82,1.742,0.512],"kinds":["bookshelf"],"group":"furn","tint":"wood","tintable":["wood"]},
  "k_bookcaseClosedWide": {"url":"assets/models/lib/k_bookcaseClosedWide.glb","size":[1.64,1.619,0.512],"kinds":["bookshelf"],"group":"furn","tint":"wood","tintable":["wood"]},
  "k_cabinetBed": {"url":"assets/models/lib/k_cabinetBed.glb","size":[0.545,0.478,0.441],"kinds":["dresser"],"group":"furn","tint":"wood","tintable":["wood"]},
  "k_cabinetBedDrawer": {"url":"assets/models/lib/k_cabinetBedDrawer.glb","size":[0.545,0.54,0.445],"kinds":["dresser"],"group":"furn","tint":"wood","tintable":["wood","_defaultMat"]},
  "k_cabinetBedDrawerTable": {"url":"assets/models/lib/k_cabinetBedDrawerTable.glb","size":[0.545,0.54,0.445],"kinds":["dresser"],"group":"furn","tint":"wood","tintable":["wood","_defaultMat"]},
  "k_bathroomCabinetDrawer": {"url":"assets/models/lib/k_bathroomCabinetDrawer.glb","size":[0.882,0.967,0.656],"kinds":["dresser"],"group":"furn","tint":"wood","tintable":["wood","carpetWhite"]},
  "k_toilet": {"url":"assets/models/lib/k_toilet.glb","size":[0.641,0.924,0.978],"kinds":["toilet"],"group":"furn","tint":"carpetWhite","tintable":["carpetWhite","_defaultMat"]},
  "k_toiletSquare": {"url":"assets/models/lib/k_toiletSquare.glb","size":[0.622,0.924,0.794],"kinds":["toilet"],"group":"furn","tint":"carpetWhite","tintable":["carpetWhite"]},
  "k_shower": {"url":"assets/models/lib/k_shower.glb","size":[1.152,2.243,1.193],"kinds":["shower"],"group":"furn","tint":"carpetWhite","tintable":["carpetWhite"]},
  "k_showerRound": {"url":"assets/models/lib/k_showerRound.glb","size":[1.152,2.243,1.152],"kinds":["shower"],"group":"furn","tint":"_defaultMat","tintable":["_defaultMat","carpetWhite"]},
  "k_bathtub": {"url":"assets/models/lib/k_bathtub.glb","size":[2.44,0.861,1.148],"kinds":["bathtub"],"group":"furn","tint":"carpetWhite","tintable":["carpetWhite"]},
  "k_bathroomSink": {"url":"assets/models/lib/k_bathroomSink.glb","size":[0.697,1.148,0.594],"kinds":["bath_sink"],"group":"furn","tint":"_defaultMat","tintable":["_defaultMat","carpetWhite"]},
  "k_bathroomSinkSquare": {"url":"assets/models/lib/k_bathroomSinkSquare.glb","size":[0.882,1.189,0.615],"kinds":["bath_sink"],"group":"furn","tint":"carpetWhite","tintable":["carpetWhite"]},
  "k_kitchenFridge": {"url":"assets/models/lib/k_kitchenFridge.glb","size":[0.882,1.886,0.598],"kinds":["fridge"],"group":"furn","tint":null,"tintable":[]},
  "k_kitchenFridgeLarge": {"url":"assets/models/lib/k_kitchenFridgeLarge.glb","size":[1.066,1.886,0.831],"kinds":["fridge"],"group":"furn","tint":null,"tintable":[]},
  "k_kitchenFridgeSmall": {"url":"assets/models/lib/k_kitchenFridgeSmall.glb","size":[0.882,1.231,0.598],"kinds":["fridge"],"group":"furn","tint":null,"tintable":[]},
  "k_kitchenFridgeBuiltIn": {"url":"assets/models/lib/k_kitchenFridgeBuiltIn.glb","size":[0.882,1.781,0.922],"kinds":["fridge"],"group":"furn","tint":"wood","tintable":["wood","woodDark"]},
  "k_kitchenStove": {"url":"assets/models/lib/k_kitchenStove.glb","size":[0.882,0.922,0.922],"kinds":["stove"],"group":"furn","tint":"wood","tintable":["wood","carpetWhite"]},
  "k_kitchenStoveElectric": {"url":"assets/models/lib/k_kitchenStoveElectric.glb","size":[0.882,0.922,0.922],"kinds":["stove"],"group":"furn","tint":"wood","tintable":["wood","carpetWhite"]},
  "k_kitchenCabinet": {"url":"assets/models/lib/k_kitchenCabinet.glb","size":[0.882,0.922,0.922],"kinds":["counter"],"group":"furn","tint":"wood","tintable":["wood","woodDark"]},
  "k_kitchenCabinetDrawer": {"url":"assets/models/lib/k_kitchenCabinetDrawer.glb","size":[0.882,0.922,0.922],"kinds":["counter"],"group":"furn","tint":"wood","tintable":["wood","woodDark"]},
  "k_kitchenBar": {"url":"assets/models/lib/k_kitchenBar.glb","size":[0.882,0.861,0.43],"kinds":["counter"],"group":"furn","tint":"wood","tintable":["wood","woodDark"]},
  "k_kitchenBarEnd": {"url":"assets/models/lib/k_kitchenBarEnd.glb","size":[0.208,0.861,0.43],"kinds":["counter"],"group":"furn","tint":"wood","tintable":["wood"]},
  "k_kitchenCabinetCornerRound": {"url":"assets/models/lib/k_kitchenCabinetCornerRound.glb","size":[0.922,0.922,0.922],"kinds":["counter"],"group":"furn","tint":"wood","tintable":["wood"]},
  "k_kitchenCabinetCornerInner": {"url":"assets/models/lib/k_kitchenCabinetCornerInner.glb","size":[0.943,0.922,0.943],"kinds":["counter"],"group":"furn","tint":"wood","tintable":["wood"]},
  "k_kitchenSink": {"url":"assets/models/lib/k_kitchenSink.glb","size":[0.882,1.004,0.922],"kinds":["kitchen_sink"],"group":"furn","tint":"wood","tintable":["wood","_defaultMat","woodDark"]},
  "k_lampRoundFloor": {"url":"assets/models/lib/k_lampRoundFloor.glb","size":[0.312,1.763,0.36],"kinds":["floor_lamp"],"group":"furn","tint":null,"tintable":[]},
  "k_lampSquareFloor": {"url":"assets/models/lib/k_lampSquareFloor.glb","size":[0.246,1.763,0.246],"kinds":["floor_lamp"],"group":"furn","tint":null,"tintable":[]},
  "k_pottedPlant": {"url":"assets/models/lib/k_pottedPlant.glb","size":[0.435,1.341,0.495],"kinds":["plant"],"group":"furn","tint":"wood","tintable":["wood","woodDark","plant"]},
  "k_trashcan": {"url":"assets/models/lib/k_trashcan.glb","size":[0.426,0.877,0.48],"kinds":["trash_can"],"group":"furn","tint":null,"tintable":[]},
  "k_bathroomMirror": {"url":"assets/models/lib/k_bathroomMirror.glb","size":[0.618,0.891,0.296],"kinds":["mirror"],"group":"furn","tint":"wood","tintable":["wood"],"wall":"back","yOffset":1},
  "k_rugRectangle": {"url":"assets/models/lib/k_rugRectangle.glb","size":[3.218,0.01,1.886],"kinds":["rug"],"group":"furn","tint":"carpet","tintable":["carpet","carpetDarker"]},
  "k_rugRound": {"url":"assets/models/lib/k_rugRound.glb","size":[1.886,0.01,1.886],"kinds":["rug"],"group":"furn","tint":"carpet","tintable":["carpet","carpetDarker"]},
  "k_rugRounded": {"url":"assets/models/lib/k_rugRounded.glb","size":[3.218,0.01,1.886],"kinds":["rug"],"group":"furn","tint":"carpet","tintable":["carpetDarker","carpet"]},
  "k_rugSquare": {"url":"assets/models/lib/k_rugSquare.glb","size":[1.854,0.01,1.886],"kinds":["rug"],"group":"furn","tint":"carpet","tintable":["carpet","carpetDarker"]},
  "k_rugDoormat": {"url":"assets/models/lib/k_rugDoormat.glb","size":[0.88,0.01,0.486],"kinds":["rug"],"group":"furn","tint":"wood","tintable":["wood"]},
  "k_bedSingle": {"url":"assets/models/lib/k_bedSingle.glb","size":[1.171,0.769,2.306],"kinds":["bed_single"],"group":"furn","tint":"carpet","tintable":["carpetWhite","wood","carpet"]},
  "k_bedDouble": {"url":"assets/models/lib/k_bedDouble.glb","size":[1.96,0.769,2.306],"kinds":["bed_double"],"group":"furn","tint":"carpet","tintable":["carpetWhite","wood","carpet"]},
  "k_coatRack": {"url":"assets/models/lib/k_coatRack.glb","size":[0.918,0.574,0.276],"kinds":["decor"],"group":"furn","tint":"wood","tintable":["wood"]},
  "k_coatRackStanding": {"url":"assets/models/lib/k_coatRackStanding.glb","size":[0.559,1.578,0.559],"kinds":["decor"],"group":"furn","tint":"wood","tintable":["wood"]},
  "k_cardboardBoxClosed": {"url":"assets/models/lib/k_cardboardBoxClosed.glb","size":[0.436,0.576,0.436],"kinds":["decor"],"group":"furn","tint":"wood","tintable":["wood","woodDark"]},
  "k_cardboardBoxOpen": {"url":"assets/models/lib/k_cardboardBoxOpen.glb","size":[0.762,0.576,0.436],"kinds":["decor"],"group":"furn","tint":"wood","tintable":["wood","woodDark"]},
  "k_hoodLarge": {"url":"assets/models/lib/k_hoodLarge.glb","size":[0.882,0.758,0.584],"kinds":["decor"],"group":"furn","tint":"_defaultMat","tintable":["_defaultMat"],"wall":"back","yOffset":1.5},
  "k_hoodModern": {"url":"assets/models/lib/k_hoodModern.glb","size":[0.882,0.819,0.584],"kinds":["decor"],"group":"furn","tint":"_defaultMat","tintable":["_defaultMat"],"wall":"back","yOffset":1.5},
  "k_kitchenCabinetUpper": {"url":"assets/models/lib/k_kitchenCabinetUpper.glb","size":[0.882,0.8,0.451],"kinds":["decor"],"group":"furn","tint":"wood","tintable":["wood","woodDark"],"wall":"back","yOffset":1.4},
  "k_kitchenCabinetUpperDouble": {"url":"assets/models/lib/k_kitchenCabinetUpperDouble.glb","size":[0.882,0.8,0.451],"kinds":["decor"],"group":"furn","tint":"wood","tintable":["wood","woodDark"],"wall":"back","yOffset":1.4},
  "k_kitchenCabinetUpperLow": {"url":"assets/models/lib/k_kitchenCabinetUpperLow.glb","size":[0.882,0.4,0.451],"kinds":["decor"],"group":"furn","tint":"wood","tintable":["wood","woodDark"],"wall":"back","yOffset":1.6},
  "k_kitchenCabinetUpperCorner": {"url":"assets/models/lib/k_kitchenCabinetUpperCorner.glb","size":[0.441,0.8,0.43],"kinds":["decor"],"group":"furn","tint":"wood","tintable":["wood"],"wall":"back","yOffset":1.4},
  "k_bathroomCabinet": {"url":"assets/models/lib/k_bathroomCabinet.glb","size":[0.472,0.8,0.266],"kinds":["decor"],"group":"furn","tint":"wood","tintable":["wood","woodDark"],"wall":"back","yOffset":1.3},
  "k_lampWall": {"url":"assets/models/lib/k_lampWall.glb","size":[0.465,0.19,0.308],"kinds":["decor"],"group":"furn","tint":null,"tintable":[],"wall":"back","yOffset":1.7},
  "k_pillow": {"url":"assets/models/lib/k_pillow.glb","size":[0.472,0.455,0.181],"kinds":["decor"],"group":"furn","tint":"carpet","tintable":["carpet"],"surface":true},
  "k_pillowBlue": {"url":"assets/models/lib/k_pillowBlue.glb","size":[0.472,0.263,0.13],"kinds":["decor"],"group":"furn","tint":"carpetBlue","tintable":["carpetBlue"],"surface":true},
  "k_pillowLong": {"url":"assets/models/lib/k_pillowLong.glb","size":[0.792,0.455,0.181],"kinds":["decor"],"group":"furn","tint":"carpet","tintable":["carpet"],"surface":true},
  "k_pillowBlueLong": {"url":"assets/models/lib/k_pillowBlueLong.glb","size":[1.059,0.455,0.181],"kinds":["decor"],"group":"furn","tint":"carpetBlue","tintable":["carpetBlue"],"surface":true},
  "k_books": {"url":"assets/models/lib/k_books.glb","size":[0.308,0.213,0.194],"kinds":["decor"],"group":"furn","tint":"carpetDarker","tintable":["carpetDarker","carpetWhite","plant"],"surface":true},
  "k_kitchenBlender": {"url":"assets/models/lib/k_kitchenBlender.glb","size":[0.278,0.466,0.224],"kinds":["decor"],"group":"furn","tint":null,"tintable":[],"surface":true},
  "k_toaster": {"url":"assets/models/lib/k_toaster.glb","size":[0.385,0.266,0.205],"kinds":["decor"],"group":"furn","tint":null,"tintable":[],"surface":true},
  "k_laptop": {"url":"assets/models/lib/k_laptop.glb","size":[0.541,0.332,0.492],"kinds":["decor"],"group":"furn","tint":null,"tintable":[],"surface":true},
  "k_computerScreen": {"url":"assets/models/lib/k_computerScreen.glb","size":[0.805,0.603,0.213],"kinds":["decor"],"group":"furn","tint":null,"tintable":[],"surface":true},
  "k_speaker": {"url":"assets/models/lib/k_speaker.glb","size":[0.303,1.305,0.303],"kinds":["decor"],"group":"furn","tint":"wood","tintable":["wood"]},
  "k_speakerSmall": {"url":"assets/models/lib/k_speakerSmall.glb","size":[0.303,0.611,0.273],"kinds":["decor"],"group":"furn","tint":"wood","tintable":["wood"],"surface":true},
  "k_radio": {"url":"assets/models/lib/k_radio.glb","size":[0.646,0.468,0.2],"kinds":["decor"],"group":"furn","tint":"wood","tintable":["wood"],"surface":true},
  "k_televisionModern": {"url":"assets/models/lib/k_televisionModern.glb","size":[1.404,0.932,0.263],"kinds":["decor"],"group":"furn","tint":null,"tintable":[],"surface":true},
  "k_televisionVintage": {"url":"assets/models/lib/k_televisionVintage.glb","size":[0.841,0.553,0.553],"kinds":["decor"],"group":"furn","tint":"wood","tintable":["wood"],"surface":true},
  "tv_modern": {"url":"assets/models/lib/tv_modern.glb","size":[1.64,1.568,0.512],"kinds":["tv"],"group":"furn","tint":"wood","tintable":["wood"]},
  "tv_modern_doors": {"url":"assets/models/lib/tv_modern_doors.glb","size":[1.64,1.568,0.533],"kinds":["tv"],"group":"furn","tint":"wood","tintable":["wood"]},
  "tv_vintage": {"url":"assets/models/lib/tv_vintage.glb","size":[1.096,1.543,0.553],"kinds":["tv"],"group":"furn","tint":"wood","tintable":["wood","_defaultMat"]},
  "stereo_tower": {"url":"assets/models/lib/stereo_tower.glb","size":[1.226,1.305,0.445],"kinds":["stereo"],"group":"furn","tint":"wood","tintable":["wood","_defaultMat"]},
  "stereo_radio": {"url":"assets/models/lib/stereo_radio.glb","size":[1.096,1.247,0.456],"kinds":["stereo"],"group":"furn","tint":"wood","tintable":["wood","_defaultMat"]},
  "computer_laptop": {"url":"assets/models/lib/computer_laptop.glb","size":[1.506,1.111,1.132],"kinds":["computer_desk"],"group":"furn","tint":"wood","tintable":["wood"]},
  "computer_corner": {"url":"assets/models/lib/computer_corner.glb","size":[1.998,1.382,1.998],"kinds":["computer_desk"],"group":"furn","tint":"wood","tintable":["wood"]},
  "computer_pc": {"url":"assets/models/lib/computer_pc.glb","size":[1.506,1.382,0.915],"kinds":["computer_desk"],"group":"furn","tint":"wood","tintable":["wood"]},
  "kitchen_island": {"url":"assets/models/lib/kitchen_island.glb","size":[1.763,0.861,0.43],"kinds":["counter"],"group":"furn","tint":"wood","tintable":["wood","woodDark"]},
  "stove_hood": {"url":"assets/models/lib/stove_hood.glb","size":[0.882,2.5,0.922],"kinds":["stove"],"group":"furn","tint":"wood","tintable":["wood","carpetWhite","_defaultMat"]},
  "painting_birch": {"url":"assets/models/lib/painting_birch.glb","size":[0.9,0.7,0.04],"kinds":["painting"],"group":"furn","tint":"frame","tintable":["frame","canvas"],"wall":"back","yOffset":1.3},
  "painting_sea": {"url":"assets/models/lib/painting_sea.glb","size":[0.9,0.7,0.04],"kinds":["painting"],"group":"furn","tint":"frame","tintable":["frame","canvas"],"wall":"back","yOffset":1.3},
  "painting_abstract": {"url":"assets/models/lib/painting_abstract.glb","size":[0.9,0.7,0.04],"kinds":["painting"],"group":"furn","tint":"frame","tintable":["frame","canvas"],"wall":"back","yOffset":1.3},
  "painting_still": {"url":"assets/models/lib/painting_still.glb","size":[0.9,0.7,0.04],"kinds":["painting"],"group":"furn","tint":"frame","tintable":["frame","canvas"],"wall":"back","yOffset":1.3},
  "painting_portrait": {"url":"assets/models/lib/painting_portrait.glb","size":[0.9,0.7,0.04],"kinds":["painting"],"group":"furn","tint":"frame","tintable":["frame","canvas"],"wall":"back","yOffset":1.3},
  "painting_sunset": {"url":"assets/models/lib/painting_sunset.glb","size":[0.9,0.7,0.04],"kinds":["painting"],"group":"furn","tint":"frame","tintable":["frame","canvas"],"wall":"back","yOffset":1.3},
  "painting_wide": {"url":"assets/models/lib/painting_wide.glb","size":[1.4,0.6,0.04],"kinds":["painting"],"group":"furn","tint":"frame","tintable":["frame","canvas"],"wall":"back","yOffset":1.3},
  "pot_large_bush": {"url":"assets/models/lib/pot_large_bush.glb","size":[1.07,1.1,1.03],"kinds":["plant"],"group":"furn","tint":"wood","tintable":["wood","woodBarkDark","grass"]},
  "pot_small_flower": {"url":"assets/models/lib/pot_small_flower.glb","size":[0.458,0.6,0.396],"kinds":["plant","flower_vase"],"group":"furn","tint":"wood","tintable":["wood","woodBarkDark","_defaultMat","grass","colorRed"]},
  "cactus": {"url":"assets/models/lib/cactus.glb","size":[0.597,1.2,0.517],"kinds":["plant"],"group":"furn","tint":"wood","tintable":["wood","woodBarkDark","_defaultMat","leafsGreen"]},
  "xmas_tree": {"url":"assets/models/lib/xmas_tree.glb","size":[1.091,2.1,1.091],"kinds":["plant","decor"],"group":"furn","tint":"colormap","tintable":["colormap"]},
  "snowman": {"url":"assets/models/lib/snowman.glb","size":[1.555,1.5,0.97],"kinds":["sculpture"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "gift_box": {"url":"assets/models/lib/gift_box.glb","size":[0.276,0.35,0.276],"kinds":["decor"],"group":"furn","tint":"colormap","tintable":["colormap"]},
  "lantern_table": {"url":"assets/models/lib/lantern_table.glb","size":[0.121,0.4,0.105],"kinds":["desk_lamp"],"group":"furn","tint":"colormap","tintable":["colormap"],"surface":true},
  "menorah": {"url":"assets/models/lib/menorah.glb","size":[0.293,0.45,0.098],"kinds":["decor"],"group":"furn","tint":"colormap","tintable":["colormap"],"surface":true},
  "barrel": {"url":"assets/models/lib/barrel.glb","size":[0.619,0.9,0.619],"kinds":["decor"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "chest": {"url":"assets/models/lib/chest.glb","size":[0.607,0.6,0.635],"kinds":["toy_box"],"group":"furn","tint":"colormap","tintable":["colormap"]},
  "workbench": {"url":"assets/models/lib/workbench.glb","size":[1.079,0.95,0.98],"kinds":["decor"],"group":"furn","tint":"colormap","tintable":["colormap"]},
  "tent": {"url":"assets/models/lib/tent.glb","size":[1.826,1.6,1.827],"kinds":["decor"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "campfire": {"url":"assets/models/lib/campfire.glb","size":[1.273,0.5,1.234],"kinds":["grill"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "urn": {"url":"assets/models/lib/urn.glb","size":[0.62,0.9,0.62],"kinds":["sculpture"],"group":"furn","tint":"colormap","tintable":["colormap"]},
  "column": {"url":"assets/models/lib/column.glb","size":[0.66,2.2,0.66],"kinds":["sculpture"],"group":"furn","tint":"stoneDark","tintable":["stoneDark","stone","_defaultMat"]},
  "gravestone_cross": {"url":"assets/models/lib/gravestone_cross.glb","size":[0.492,1,0.361],"kinds":["tombstone"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "gravestone_round": {"url":"assets/models/lib/gravestone_round.glb","size":[0.704,0.9,0.391],"kinds":["tombstone"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "gravestone_wide": {"url":"assets/models/lib/gravestone_wide.glb","size":[1.341,0.9,0.473],"kinds":["tombstone"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "shopping_cart": {"url":"assets/models/lib/shopping_cart.glb","size":[0.768,1,1.226],"kinds":["shelf_shop"],"group":"furn","tint":"colormap","tintable":["colormap"]},
  "ticket_machine": {"url":"assets/models/lib/ticket_machine.glb","size":[0.692,1.6,0.685],"kinds":["video_game"],"group":"furn","tint":"colormap","tintable":["colormap"]},
  "prize_wheel": {"url":"assets/models/lib/prize_wheel.glb","size":[1.412,2,0.709],"kinds":["video_game"],"group":"furn","tint":"colormap","tintable":["colormap"]},
  "basketball_game": {"url":"assets/models/lib/basketball_game.glb","size":[1.788,2.2,2.784],"kinds":["video_game"],"group":"furn","tint":"colormap","tintable":["colormap"]},
  "gambling_machine": {"url":"assets/models/lib/gambling_machine.glb","size":[1.149,1.7,1.068],"kinds":["video_game"],"group":"furn","tint":"colormap","tintable":["colormap"]},
  "mailbox_post": {"url":"assets/models/lib/mailbox_post.glb","size":[0.275,1.36,0.45],"kinds":["mailbox"],"group":"hood","tint":"box","tintable":["post","box","flag"]},
  "fire_hydrant": {"url":"assets/models/lib/fire_hydrant.glb","size":[0.4,0.68,0.28],"kinds":["decor"],"group":"hood","tint":"hydrant","tintable":["hydrant","cap"]},
  "n_tree_default": {"url":"assets/models/lib/n_tree_default.glb","size":[2.431,5.5,2.106],"kinds":["tree"],"group":"hood","tint":"woodBark","tintable":["woodBark","leafsGreen"]},
  "n_tree_default_fall": {"url":"assets/models/lib/n_tree_default_fall.glb","size":[2.431,5.5,2.106],"kinds":["tree"],"group":"hood","tint":"woodBirch","tintable":["woodBirch","leafsFall"]},
  "n_tree_default_dark": {"url":"assets/models/lib/n_tree_default_dark.glb","size":[2.431,5.5,2.106],"kinds":["tree"],"group":"hood","tint":"woodBarkDark","tintable":["woodBarkDark","leafsDark"]},
  "n_tree_oak": {"url":"assets/models/lib/n_tree_oak.glb","size":[2.873,5.5,3.318],"kinds":["tree"],"group":"hood","tint":"leafsGreen","tintable":["leafsGreen","woodBark"]},
  "n_tree_oak_fall": {"url":"assets/models/lib/n_tree_oak_fall.glb","size":[2.873,5.5,3.318],"kinds":["tree"],"group":"hood","tint":"leafsFall","tintable":["leafsFall","woodBirch"]},
  "n_tree_oak_dark": {"url":"assets/models/lib/n_tree_oak_dark.glb","size":[2.873,5.5,3.318],"kinds":["tree"],"group":"hood","tint":"leafsDark","tintable":["leafsDark","woodBarkDark"]},
  "n_tree_detailed": {"url":"assets/models/lib/n_tree_detailed.glb","size":[3.497,5.5,3.144],"kinds":["tree"],"group":"hood","tint":"leafsGreen","tintable":["leafsGreen","woodBark","_defaultMat"]},
  "n_tree_detailed_fall": {"url":"assets/models/lib/n_tree_detailed_fall.glb","size":[3.497,5.5,3.144],"kinds":["tree"],"group":"hood","tint":"leafsFall","tintable":["leafsFall","woodBirch","_defaultMat"]},
  "n_tree_detailed_dark": {"url":"assets/models/lib/n_tree_detailed_dark.glb","size":[3.497,5.5,3.144],"kinds":["tree"],"group":"hood","tint":"leafsDark","tintable":["leafsDark","woodBarkDark","_defaultMat"]},
  "n_tree_fat": {"url":"assets/models/lib/n_tree_fat.glb","size":[3.61,5.5,3.126],"kinds":["tree"],"group":"hood","tint":"leafsGreen","tintable":["leafsGreen","woodBark"]},
  "n_tree_fat_fall": {"url":"assets/models/lib/n_tree_fat_fall.glb","size":[3.61,5.5,3.126],"kinds":["tree"],"group":"hood","tint":"leafsFall","tintable":["leafsFall","woodBirch"]},
  "n_tree_fat_dark": {"url":"assets/models/lib/n_tree_fat_dark.glb","size":[3.61,5.5,3.126],"kinds":["tree"],"group":"hood","tint":"leafsDark","tintable":["leafsDark","woodBarkDark"]},
  "n_tree_simple": {"url":"assets/models/lib/n_tree_simple.glb","size":[1.284,5.5,1.482],"kinds":["tree"],"group":"hood","tint":"leafsGreen","tintable":["leafsGreen","woodBark"]},
  "n_tree_simple_fall": {"url":"assets/models/lib/n_tree_simple_fall.glb","size":[1.284,5.5,1.482],"kinds":["tree"],"group":"hood","tint":"leafsFall","tintable":["leafsFall","woodBirch"]},
  "n_tree_simple_dark": {"url":"assets/models/lib/n_tree_simple_dark.glb","size":[1.284,5.5,1.482],"kinds":["tree"],"group":"hood","tint":"leafsDark","tintable":["leafsDark","woodBarkDark"]},
  "n_tree_tall": {"url":"assets/models/lib/n_tree_tall.glb","size":[1.657,7,1.914],"kinds":["tree"],"group":"hood","tint":"leafsGreen","tintable":["leafsGreen","woodBark"]},
  "n_tree_tall_fall": {"url":"assets/models/lib/n_tree_tall_fall.glb","size":[1.657,7,1.914],"kinds":["tree"],"group":"hood","tint":"leafsFall","tintable":["leafsFall","woodBirch"]},
  "n_tree_tall_dark": {"url":"assets/models/lib/n_tree_tall_dark.glb","size":[1.657,7,1.914],"kinds":["tree"],"group":"hood","tint":"leafsDark","tintable":["leafsDark","woodBarkDark"]},
  "n_tree_thin": {"url":"assets/models/lib/n_tree_thin.glb","size":[3.196,7,2.896],"kinds":["tree"],"group":"hood","tint":"leafsGreen","tintable":["leafsGreen","woodBark"]},
  "n_tree_thin_fall": {"url":"assets/models/lib/n_tree_thin_fall.glb","size":[3.196,7,2.896],"kinds":["tree"],"group":"hood","tint":"leafsFall","tintable":["leafsFall","woodBirch"]},
  "n_tree_thin_dark": {"url":"assets/models/lib/n_tree_thin_dark.glb","size":[3.196,7,2.896],"kinds":["tree"],"group":"hood","tint":"leafsDark","tintable":["leafsDark","woodBarkDark"]},
  "n_tree_blocks": {"url":"assets/models/lib/n_tree_blocks.glb","size":[2.785,5.5,2.785],"kinds":["tree"],"group":"hood","tint":"woodBark","tintable":["woodBark","leafsGreen"]},
  "n_tree_blocks_fall": {"url":"assets/models/lib/n_tree_blocks_fall.glb","size":[2.785,5.5,2.785],"kinds":["tree"],"group":"hood","tint":"woodBirch","tintable":["woodBirch","leafsFall"]},
  "n_tree_blocks_dark": {"url":"assets/models/lib/n_tree_blocks_dark.glb","size":[2.785,5.5,2.785],"kinds":["tree"],"group":"hood","tint":"woodBarkDark","tintable":["woodBarkDark","leafsDark"]},
  "n_tree_cone": {"url":"assets/models/lib/n_tree_cone.glb","size":[2.037,5.5,2.037],"kinds":["tree"],"group":"hood","tint":"woodBark","tintable":["woodBark","leafsGreen"]},
  "n_tree_cone_fall": {"url":"assets/models/lib/n_tree_cone_fall.glb","size":[2.037,5.5,2.037],"kinds":["tree"],"group":"hood","tint":"woodBirch","tintable":["woodBirch","leafsFall"]},
  "n_tree_cone_dark": {"url":"assets/models/lib/n_tree_cone_dark.glb","size":[2.037,5.5,2.037],"kinds":["tree"],"group":"hood","tint":"woodBarkDark","tintable":["woodBarkDark","leafsDark"]},
  "n_tree_plateau": {"url":"assets/models/lib/n_tree_plateau.glb","size":[2.693,5.5,2.883],"kinds":["tree"],"group":"hood","tint":"leafsGreen","tintable":["leafsGreen","woodBark"]},
  "n_tree_plateau_fall": {"url":"assets/models/lib/n_tree_plateau_fall.glb","size":[2.693,5.5,2.883],"kinds":["tree"],"group":"hood","tint":"leafsFall","tintable":["leafsFall","woodBirch"]},
  "n_tree_plateau_dark": {"url":"assets/models/lib/n_tree_plateau_dark.glb","size":[2.693,5.5,2.883],"kinds":["tree"],"group":"hood","tint":"leafsDark","tintable":["leafsDark","woodBarkDark"]},
  "n_tree_small": {"url":"assets/models/lib/n_tree_small.glb","size":[0.831,2.6,0.959],"kinds":["tree"],"group":"hood","tint":"woodBark","tintable":["woodBark","leafsGreen"]},
  "n_tree_small_fall": {"url":"assets/models/lib/n_tree_small_fall.glb","size":[0.831,2.6,0.959],"kinds":["tree"],"group":"hood","tint":"woodBirch","tintable":["woodBirch","leafsFall"]},
  "n_tree_small_dark": {"url":"assets/models/lib/n_tree_small_dark.glb","size":[0.831,2.6,0.959],"kinds":["tree"],"group":"hood","tint":"woodBarkDark","tintable":["woodBarkDark","leafsDark"]},
  "n_tree_pineDefaultA": {"url":"assets/models/lib/n_tree_pineDefaultA.glb","size":[2.065,6,2.065],"kinds":["tree"],"group":"hood","tint":"leafsDark","tintable":["leafsDark","woodBarkDark"]},
  "n_tree_pineRoundA": {"url":"assets/models/lib/n_tree_pineRoundA.glb","size":[2.709,6,3.128],"kinds":["tree"],"group":"hood","tint":"woodBarkDark","tintable":["woodBarkDark","leafsDark"]},
  "n_tree_pineRoundC": {"url":"assets/models/lib/n_tree_pineRoundC.glb","size":[2.301,6,2.656],"kinds":["tree"],"group":"hood","tint":"leafsDark","tintable":["leafsDark","woodBarkDark"]},
  "n_tree_pineTallA": {"url":"assets/models/lib/n_tree_pineTallA.glb","size":[2.02,8,2.05],"kinds":["tree"],"group":"hood","tint":"woodBarkDark","tintable":["woodBarkDark","leafsDark"]},
  "n_tree_pineSmallA": {"url":"assets/models/lib/n_tree_pineSmallA.glb","size":[1.292,2.5,1.292],"kinds":["tree"],"group":"hood","tint":"leafsDark","tintable":["leafsDark","woodBarkDark"]},
  "n_tree_palmTall": {"url":"assets/models/lib/n_tree_palmTall.glb","size":[6.104,8,6.104],"kinds":["tree"],"group":"hood","tint":"leafsGreen","tintable":["leafsGreen","woodBark"]},
  "n_tree_palm": {"url":"assets/models/lib/n_tree_palm.glb","size":[3.706,6,4.012],"kinds":["tree"],"group":"hood","tint":"woodBark","tintable":["woodBark","leafsGreen"]},
  "su_tree_large": {"url":"assets/models/lib/su_tree_large.glb","size":[1.646,6,1.901],"kinds":["tree"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "su_tree_small": {"url":"assets/models/lib/su_tree_small.glb","size":[1.299,3.5,1.5],"kinds":["tree"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "ft_tree": {"url":"assets/models/lib/ft_tree.glb","size":[2.12,5,2.12],"kinds":["tree"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "ft_tree_high": {"url":"assets/models/lib/ft_tree_high.glb","size":[2.592,7,2.592],"kinds":["tree"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "n_plant_bush": {"url":"assets/models/lib/n_plant_bush.glb","size":[1.296,0.8,1.296],"kinds":["hedge"],"group":"hood","tint":"grass","tintable":["grass"]},
  "n_plant_bushDetailed": {"url":"assets/models/lib/n_plant_bushDetailed.glb","size":[1.337,0.8,1.337],"kinds":["hedge"],"group":"hood","tint":"grass","tintable":["grass"]},
  "n_plant_bushLarge": {"url":"assets/models/lib/n_plant_bushLarge.glb","size":[1.849,1.2,1.658],"kinds":["hedge"],"group":"hood","tint":"grass","tintable":["grass"]},
  "n_plant_bushSmall": {"url":"assets/models/lib/n_plant_bushSmall.glb","size":[0.924,0.5,0.811],"kinds":["hedge"],"group":"hood","tint":"grass","tintable":["grass"]},
  "n_plant_bushTriangle": {"url":"assets/models/lib/n_plant_bushTriangle.glb","size":[0.986,0.8,1.12],"kinds":["hedge"],"group":"hood","tint":"grass","tintable":["grass"]},
  "n_plant_bushLargeTriangle": {"url":"assets/models/lib/n_plant_bushLargeTriangle.glb","size":[2.889,1.2,3.336],"kinds":["hedge"],"group":"hood","tint":"grass","tintable":["grass"]},
  "n_flower_redA": {"url":"assets/models/lib/n_flower_redA.glb","size":[0.245,0.45,0.279],"kinds":["flowerbed"],"group":"hood","tint":"grass","tintable":["grass","colorRed"]},
  "n_flower_yellowA": {"url":"assets/models/lib/n_flower_yellowA.glb","size":[0.372,0.45,0.423],"kinds":["flowerbed"],"group":"hood","tint":"grass","tintable":["grass","colorYellow"]},
  "n_flower_purpleA": {"url":"assets/models/lib/n_flower_purpleA.glb","size":[0.295,0.45,0.336],"kinds":["flowerbed"],"group":"hood","tint":"grass","tintable":["grass","colorPurple"]},
  "n_flower_redC": {"url":"assets/models/lib/n_flower_redC.glb","size":[0.35,0.45,0.35],"kinds":["flowerbed"],"group":"hood","tint":"grass","tintable":["grass","colorRed","colorWhite"]},
  "n_flower_yellowC": {"url":"assets/models/lib/n_flower_yellowC.glb","size":[0.613,0.45,0.615],"kinds":["flowerbed"],"group":"hood","tint":"grass","tintable":["grass","colorYellow","colorWhite"]},
  "n_flower_purpleC": {"url":"assets/models/lib/n_flower_purpleC.glb","size":[0.445,0.45,0.446],"kinds":["flowerbed"],"group":"hood","tint":"grass","tintable":["grass","colorPurple","colorWhite"]},
  "n_grass_large": {"url":"assets/models/lib/n_grass_large.glb","size":[0.644,0.4,0.642],"kinds":["flowerbed"],"group":"hood","tint":"grass","tintable":["grass"]},
  "n_grass_leafsLarge": {"url":"assets/models/lib/n_grass_leafsLarge.glb","size":[1.336,0.4,1.368],"kinds":["flowerbed"],"group":"hood","tint":"grass","tintable":["grass"]},
  "n_mushroom_redGroup": {"url":"assets/models/lib/n_mushroom_redGroup.glb","size":[0.484,0.45,0.457],"kinds":["flowerbed"],"group":"hood","tint":"_defaultMat","tintable":["_defaultMat","colorRed"]},
  "n_rock_largeA": {"url":"assets/models/lib/n_rock_largeA.glb","size":[3.626,1.2,4.691],"kinds":["decor"],"group":"hood","tint":"dirt","tintable":["dirt","grass"]},
  "n_rock_smallA": {"url":"assets/models/lib/n_rock_smallA.glb","size":[0.943,0.5,0.943],"kinds":["decor"],"group":"hood","tint":"grass","tintable":["grass","dirt"]},
  "n_rock_tallA": {"url":"assets/models/lib/n_rock_tallA.glb","size":[1.579,1.6,1.098],"kinds":["decor"],"group":"hood","tint":"dirt","tintable":["dirt","grass","_defaultMat"]},
  "n_stump_round": {"url":"assets/models/lib/n_stump_round.glb","size":[0.778,0.5,0.898],"kinds":["decor"],"group":"hood","tint":"woodBark","tintable":["woodBark","woodInner"]},
  "n_log_stack": {"url":"assets/models/lib/n_log_stack.glb","size":[0.613,0.5,1.025],"kinds":["decor"],"group":"hood","tint":"woodBark","tintable":["woodBark","woodInner"]},
  "car_sedan": {"url":"assets/models/lib/car_sedan.glb","size":[2.588,2.243,4.4],"kinds":["car"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "car_suv": {"url":"assets/models/lib/car_suv.glb","size":[2.444,2.119,4.4],"kinds":["car"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "car_hatchback_sports": {"url":"assets/models/lib/car_hatchback_sports.glb","size":[2.007,1.698,4.4],"kinds":["car"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "car_van": {"url":"assets/models/lib/car_van.glb","size":[2.836,2.553,5.2],"kinds":["car"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "car_taxi": {"url":"assets/models/lib/car_taxi.glb","size":[2.4,2.4,4.4],"kinds":["car"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "car_police": {"url":"assets/models/lib/car_police.glb","size":[2.129,1.845,4.4],"kinds":["car"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "car_ambulance": {"url":"assets/models/lib/car_ambulance.glb","size":[2.4,2.88,5.2],"kinds":["car"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "car_firetruck": {"url":"assets/models/lib/car_firetruck.glb","size":[3.088,3.5,7],"kinds":["car"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "car_garbage_truck": {"url":"assets/models/lib/car_garbage_truck.glb","size":[3.246,3.246,7],"kinds":["car"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "car_delivery": {"url":"assets/models/lib/car_delivery.glb","size":[3.231,3.554,7],"kinds":["car"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "car_truck": {"url":"assets/models/lib/car_truck.glb","size":[3.559,3.085,7],"kinds":["car"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "car_sedan_sports": {"url":"assets/models/lib/car_sedan_sports.glb","size":[2.243,1.898,4.4],"kinds":["car"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "car_suv_luxury": {"url":"assets/models/lib/car_suv_luxury.glb","size":[2.316,2.007,4.4],"kinds":["car"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "car_tractor": {"url":"assets/models/lib/car_tractor.glb","size":[2.134,2.547,3.5],"kinds":["car"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "rd_road_sign_stop": {"url":"assets/models/lib/rd_road_sign_stop.glb","size":[0.408,2.6,0.727],"kinds":["decor"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "rd_road_sign_street": {"url":"assets/models/lib/rd_road_sign_street.glb","size":[1.074,2.6,1.074],"kinds":["decor"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "rd_road_sign_warning": {"url":"assets/models/lib/rd_road_sign_warning.glb","size":[0.403,2.6,0.768],"kinds":["decor"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "rd_traffic_light": {"url":"assets/models/lib/rd_traffic_light.glb","size":[1.028,4.5,0.786],"kinds":["decor"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "rd_construction_cone": {"url":"assets/models/lib/rd_construction_cone.glb","size":[0.4,0.5,0.4],"kinds":["decor"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "rd_construction_barrier": {"url":"assets/models/lib/rd_construction_barrier.glb","size":[1.042,1,1.731],"kinds":["decor"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "rd_electricity_pole": {"url":"assets/models/lib/rd_electricity_pole.glb","size":[8.824,8,3.264],"kinds":["decor"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "house_a": {"url":"assets/models/lib/house_a.glb","size":[10.137,6.5,8.017],"kinds":["house"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "house_b": {"url":"assets/models/lib/house_b.glb","size":[10.446,6.5,6.514],"kinds":["house"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "house_c": {"url":"assets/models/lib/house_c.glb","size":[8.09,6.5,6.466],"kinds":["house"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "house_d": {"url":"assets/models/lib/house_d.glb","size":[9.225,6.5,5.4],"kinds":["house"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "house_e": {"url":"assets/models/lib/house_e.glb","size":[7.429,6.5,5.874],"kinds":["house"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "house_f": {"url":"assets/models/lib/house_f.glb","size":[8.16,6.5,8.034],"kinds":["house"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "house_g": {"url":"assets/models/lib/house_g.glb","size":[12.269,6.5,9.967],"kinds":["house"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "house_h": {"url":"assets/models/lib/house_h.glb","size":[11.458,6.5,8.073],"kinds":["house"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "house_i": {"url":"assets/models/lib/house_i.glb","size":[11.338,6.5,9.06],"kinds":["house"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "house_j": {"url":"assets/models/lib/house_j.glb","size":[8.583,6.5,5.739],"kinds":["house"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "house_k": {"url":"assets/models/lib/house_k.glb","size":[5.207,6.5,5.767],"kinds":["house"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "house_l": {"url":"assets/models/lib/house_l.glb","size":[6.403,6.5,6.319],"kinds":["house"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "house_m": {"url":"assets/models/lib/house_m.glb","size":[12.586,6.5,12.586],"kinds":["house"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "house_n": {"url":"assets/models/lib/house_n.glb","size":[10.196,6.5,7.874],"kinds":["house"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "house_o": {"url":"assets/models/lib/house_o.glb","size":[7.257,6.5,5.874],"kinds":["house"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "house_p": {"url":"assets/models/lib/house_p.glb","size":[8.78,6.5,7.01],"kinds":["house"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "house_q": {"url":"assets/models/lib/house_q.glb","size":[8.78,6.5,6.271],"kinds":["house"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "house_r": {"url":"assets/models/lib/house_r.glb","size":[5.856,6.5,5.81],"kinds":["house"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "house_s": {"url":"assets/models/lib/house_s.glb","size":[8.034,6.5,6.208],"kinds":["house"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "house_t": {"url":"assets/models/lib/house_t.glb","size":[7.384,6.5,7.906],"kinds":["house"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "house_u": {"url":"assets/models/lib/house_u.glb","size":[8.16,6.5,6.211],"kinds":["house"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "shop_a": {"url":"assets/models/lib/shop_a.glb","size":[6.15,9,6.543],"kinds":["building"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "shop_b": {"url":"assets/models/lib/shop_b.glb","size":[6.752,9,6.543],"kinds":["building"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "shop_c": {"url":"assets/models/lib/shop_c.glb","size":[8.905,9,10.985],"kinds":["building"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "shop_d": {"url":"assets/models/lib/shop_d.glb","size":[5.847,9,6.265],"kinds":["building"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "shop_e": {"url":"assets/models/lib/shop_e.glb","size":[16.529,9,10.158],"kinds":["building"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "shop_f": {"url":"assets/models/lib/shop_f.glb","size":[4.465,9,5.475],"kinds":["building"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "shop_g": {"url":"assets/models/lib/shop_g.glb","size":[5.157,9,4.901],"kinds":["building"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "shop_h": {"url":"assets/models/lib/shop_h.glb","size":[6.15,9,7.015],"kinds":["building"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "shop_i": {"url":"assets/models/lib/shop_i.glb","size":[6.643,9,6.975],"kinds":["building"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "shop_j": {"url":"assets/models/lib/shop_j.glb","size":[11.076,9,7.123],"kinds":["building"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "shop_k": {"url":"assets/models/lib/shop_k.glb","size":[12.757,9,5.767],"kinds":["building"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "shop_l": {"url":"assets/models/lib/shop_l.glb","size":[5.432,9,5.559],"kinds":["building"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "shop_m": {"url":"assets/models/lib/shop_m.glb","size":[3.543,9,3.549],"kinds":["building"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "shop_n": {"url":"assets/models/lib/shop_n.glb","size":[8.419,9,6.605],"kinds":["building"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "cc_detail_awning": {"url":"assets/models/lib/cc_detail_awning.glb","size":[1,1,0.37],"kinds":["decor"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "cc_detail_awning_wide": {"url":"assets/models/lib/cc_detail_awning_wide.glb","size":[2,1,0.37],"kinds":["decor"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "cc_detail_parasol_a": {"url":"assets/models/lib/cc_detail_parasol_a.glb","size":[1.848,2.4,2.133],"kinds":["decor"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "cc_detail_parasol_b": {"url":"assets/models/lib/cc_detail_parasol_b.glb","size":[1.848,2.4,2.133],"kinds":["decor"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "su_driveway_long": {"url":"assets/models/lib/su_driveway_long.glb","size":[1.8,0.05,2],"kinds":["decor"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "su_path_long": {"url":"assets/models/lib/su_path_long.glb","size":[1,0.05,2],"kinds":["decor"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "su_path_stones_long": {"url":"assets/models/lib/su_path_stones_long.glb","size":[0.7,0.05,2],"kinds":["decor"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "su_planter": {"url":"assets/models/lib/su_planter.glb","size":[1,0.443,0.75],"kinds":["decor"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "well_cart": {"url":"assets/models/lib/well_cart.glb","size":[1.868,1.8,2.908],"kinds":["decor"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "kk_armchair": {"url":"assets/models/lib/kk_armchair.glb","size":[1.323,0.9,1.176],"kinds":["armchair"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_armchair_pillows": {"url":"assets/models/lib/kk_armchair_pillows.glb","size":[1.323,0.9,1.176],"kinds":["armchair"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_couch": {"url":"assets/models/lib/kk_couch.glb","size":[2.206,0.9,1.176],"kinds":["sofa"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_couch_pillows": {"url":"assets/models/lib/kk_couch_pillows.glb","size":[2.206,0.9,1.176],"kinds":["sofa"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_bed_double_A": {"url":"assets/models/lib/kk_bed_double_A.glb","size":[2.1,0.677,2.032],"kinds":["bed_double"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_bed_double_B": {"url":"assets/models/lib/kk_bed_double_B.glb","size":[2.1,0.677,2.032],"kinds":["bed_double"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_bed_single_A": {"url":"assets/models/lib/kk_bed_single_A.glb","size":[1.067,0.667,2],"kinds":["bed_single","kids_bed"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_bed_single_B": {"url":"assets/models/lib/kk_bed_single_B.glb","size":[1.067,0.667,2],"kinds":["bed_single","kids_bed"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_cabinet_medium": {"url":"assets/models/lib/kk_cabinet_medium.glb","size":[2.2,1.1,1.102],"kinds":["dresser","wardrobe"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_cabinet_medium_decorated": {"url":"assets/models/lib/kk_cabinet_medium_decorated.glb","size":[1.564,1.4,0.767],"kinds":["dresser"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_cabinet_small": {"url":"assets/models/lib/kk_cabinet_small.glb","size":[0.7,0.7,0.701],"kinds":["dresser"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_cabinet_small_decorated": {"url":"assets/models/lib/kk_cabinet_small_decorated.glb","size":[0.615,0.95,0.648],"kinds":["dresser"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_chair_A": {"url":"assets/models/lib/kk_chair_A.glb","size":[0.566,0.95,0.638],"kinds":["dining_chair"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_chair_A_wood": {"url":"assets/models/lib/kk_chair_A_wood.glb","size":[0.566,0.95,0.638],"kinds":["dining_chair"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_chair_B": {"url":"assets/models/lib/kk_chair_B.glb","size":[0.566,0.95,0.638],"kinds":["dining_chair"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_chair_B_wood": {"url":"assets/models/lib/kk_chair_B_wood.glb","size":[0.566,0.95,0.638],"kinds":["dining_chair"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_chair_C": {"url":"assets/models/lib/kk_chair_C.glb","size":[0.592,0.95,0.739],"kinds":["dining_chair"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_chair_stool": {"url":"assets/models/lib/kk_chair_stool.glb","size":[0.93,0.62,0.93],"kinds":["dining_chair"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_chair_stool_wood": {"url":"assets/models/lib/kk_chair_stool_wood.glb","size":[0.93,0.62,0.93],"kinds":["dining_chair"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_lamp_standing": {"url":"assets/models/lib/kk_lamp_standing.glb","size":[0.675,1.7,0.675],"kinds":["floor_lamp"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_lamp_table": {"url":"assets/models/lib/kk_lamp_table.glb","size":[0.489,0.5,0.489],"kinds":["desk_lamp"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"],"surface":true},
  "kk_rug_oval_A": {"url":"assets/models/lib/kk_rug_oval_A.glb","size":[2,0.1,1.333],"kinds":["rug"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_rug_oval_B": {"url":"assets/models/lib/kk_rug_oval_B.glb","size":[2,0.1,1.333],"kinds":["rug"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_rug_rectangle_A": {"url":"assets/models/lib/kk_rug_rectangle_A.glb","size":[2,0.1,1.333],"kinds":["rug"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_rug_rectangle_B": {"url":"assets/models/lib/kk_rug_rectangle_B.glb","size":[2,0.1,1.333],"kinds":["rug"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_rug_rectangle_stripes_A": {"url":"assets/models/lib/kk_rug_rectangle_stripes_A.glb","size":[2,0.1,1.333],"kinds":["rug"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_rug_rectangle_stripes_B": {"url":"assets/models/lib/kk_rug_rectangle_stripes_B.glb","size":[2,0.1,1.333],"kinds":["rug"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_shelf_B_large": {"url":"assets/models/lib/kk_shelf_B_large.glb","size":[1.2,0.24,0.3],"kinds":["decor"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"],"wall":"back","yOffset":1.3},
  "kk_shelf_B_large_decorated": {"url":"assets/models/lib/kk_shelf_B_large_decorated.glb","size":[1.2,0.491,0.3],"kinds":["decor"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"],"wall":"back","yOffset":1.3},
  "kk_shelf_B_small": {"url":"assets/models/lib/kk_shelf_B_small.glb","size":[0.7,0.28,0.35],"kinds":["decor"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"],"wall":"back","yOffset":1.3},
  "kk_shelf_B_small_decorated": {"url":"assets/models/lib/kk_shelf_B_small_decorated.glb","size":[0.7,0.708,0.4],"kinds":["decor"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"],"wall":"back","yOffset":1.3},
  "kk_shelf_A_big": {"url":"assets/models/lib/kk_shelf_A_big.glb","size":[1,0.2,0.25],"kinds":["decor"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"],"wall":"back","yOffset":1.4},
  "kk_shelf_A_small": {"url":"assets/models/lib/kk_shelf_A_small.glb","size":[0.6,0.24,0.3],"kinds":["decor"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"],"wall":"back","yOffset":1.4},
  "kk_table_low": {"url":"assets/models/lib/kk_table_low.glb","size":[2.16,0.45,1.35],"kinds":["coffee_table"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_table_medium": {"url":"assets/models/lib/kk_table_medium.glb","size":[1.52,0.76,1.52],"kinds":["dining_table"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_table_medium_long": {"url":"assets/models/lib/kk_table_medium_long.glb","size":[2.28,0.76,1.52],"kinds":["dining_table"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_table_small": {"url":"assets/models/lib/kk_table_small.glb","size":[0.72,0.72,0.72],"kinds":["dining_table","coffee_table"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_cactus_medium_A": {"url":"assets/models/lib/kk_cactus_medium_A.glb","size":[0.957,0.9,0.91],"kinds":["plant"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_cactus_medium_B": {"url":"assets/models/lib/kk_cactus_medium_B.glb","size":[0.957,0.9,0.91],"kinds":["plant"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"]},
  "kk_cactus_small_A": {"url":"assets/models/lib/kk_cactus_small_A.glb","size":[0.363,0.4,0.363],"kinds":["plant","flower_vase"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"],"surface":true},
  "kk_cactus_small_B": {"url":"assets/models/lib/kk_cactus_small_B.glb","size":[0.363,0.4,0.363],"kinds":["plant","flower_vase"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"],"surface":true},
  "kk_pictureframe_large_A": {"url":"assets/models/lib/kk_pictureframe_large_A.glb","size":[0.673,0.8,0.133],"kinds":["painting"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"],"wall":"back","yOffset":1.3},
  "kk_pictureframe_large_B": {"url":"assets/models/lib/kk_pictureframe_large_B.glb","size":[1.333,0.8,0.133],"kinds":["painting"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"],"wall":"back","yOffset":1.3},
  "kk_pictureframe_medium": {"url":"assets/models/lib/kk_pictureframe_medium.glb","size":[0.467,0.6,0.133],"kinds":["painting"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"],"wall":"back","yOffset":1.4},
  "kk_pictureframe_small_A": {"url":"assets/models/lib/kk_pictureframe_small_A.glb","size":[0.333,0.4,0.133],"kinds":["painting"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"],"wall":"back","yOffset":1.5},
  "kk_pictureframe_standing_A": {"url":"assets/models/lib/kk_pictureframe_standing_A.glb","size":[0.243,0.3,0.184],"kinds":["decor"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"],"surface":true},
  "kk_book_set": {"url":"assets/models/lib/kk_book_set.glb","size":[0.39,0.25,0.183],"kinds":["decor"],"group":"furn","tint":"furniture_texture","tintable":["furniture_texture"],"surface":true},
  "exercise_bike": {"url":"assets/models/lib/exercise_bike.glb","size":[0.5,1.26,1.1],"kinds":["treadmill","exercise_bench","gym_machine"],"group":"furn","tint":"seat","tintable":["frame","seat"]},
  "bathtub_clawfoot": {"url":"assets/models/lib/bathtub_clawfoot.glb","size":[0.94,0.88,0.611],"kinds":["bathtub"],"group":"furn","tint":"enamel","tintable":["enamel"]},
  "piano_upright_small": {"url":"assets/models/lib/piano_upright_small.glb","size":[1.5,1.25,0.92],"kinds":["piano"],"group":"furn","tint":"lacquer","tintable":["lacquer"]},
  "hedge_ft": {"url":"assets/models/lib/hedge_ft.glb","size":[0.25,0.25,1],"kinds":["decor"],"group":"hood","tint":"colormap","tintable":["colormap"]},
  "beanbag": {"url":"assets/models/lib/beanbag.glb","size":[0.9,0.77,0.9],"kinds":["armchair"],"group":"furn","tint":"fabric","tintable":["fabric"]},
  "armchair_egg": {"url":"assets/models/lib/armchair_egg.glb","size":[1,1.47,0.798],"kinds":["armchair"],"group":"furn","tint":"cushion","tintable":["shell","cushion"]},
  "armchair_rocking": {"url":"assets/models/lib/armchair_rocking.glb","size":[0.54,1.018,0.77],"kinds":["armchair"],"group":"furn","tint":"cushion","tintable":["wood","cushion"]},
  "deck_chair": {"url":"assets/models/lib/deck_chair.glb","size":[0.595,0.84,0.635],"kinds":["armchair","dining_chair"],"group":"furn","tint":"fabric","tintable":["wood","fabric"]},
  "chair_exec": {"url":"assets/models/lib/chair_exec.glb","size":[0.69,1.43,0.6],"kinds":["dining_chair","armchair"],"group":"furn","tint":"leather","tintable":["leather"]},
  "bed_cot": {"url":"assets/models/lib/bed_cot.glb","size":[0.874,0.474,1.95],"kinds":["bed_single"],"group":"furn","tint":"colormap","tintable":["colormap"]},
  "bed_water": {"url":"assets/models/lib/bed_water.glb","size":[1.9,0.9,2.055],"kinds":["bed_double"],"group":"furn","tint":"frame","tintable":["frame","mattress","pillow"]},
  "bed_round": {"url":"assets/models/lib/bed_round.glb","size":[1.96,0.95,1.96],"kinds":["bed_double"],"group":"furn","tint":"blanket","tintable":["frame","blanket","pillow"]},
  "table_banquet": {"url":"assets/models/lib/table_banquet.glb","size":[3.447,0.67,0.917],"kinds":["dining_table"],"group":"furn","tint":"carpet","tintable":["wood","carpet"]},
  "k_desk": {"url":"assets/models/lib/k_desk.glb","size":[1.506,0.788,0.804],"kinds":["computer_desk","dining_table"],"group":"furn","tint":"wood","tintable":["wood"]},
  "fridge_retro": {"url":"assets/models/lib/fridge_retro.glb","size":[0.72,1.6,0.695],"kinds":["fridge"],"group":"furn","tint":"enamel","tintable":["enamel","chrome","logo"]},
  "tv_plasma": {"url":"assets/models/lib/tv_plasma.glb","size":[1.755,1.801,0.512],"kinds":["tv"],"group":"furn","tint":"wood","tintable":["wood"]},
  "tv_projector": {"url":"assets/models/lib/tv_projector.glb","size":[1.7,1.96,0.805],"kinds":["tv"],"group":"furn","tint":"frame","tintable":["frame","projector"]},
  "radio_retro": {"url":"assets/models/lib/radio_retro.glb","size":[0.8,1.02,0.43],"kinds":["stereo"],"group":"furn","tint":"fabric","tintable":["wood","fabric"]},
  "boombox": {"url":"assets/models/lib/boombox.glb","size":[0.6,0.36,0.17],"kinds":["stereo"],"group":"furn","tint":"plastic","tintable":["plastic","speaker","chrome"],"surface":true},
  "jukebox": {"url":"assets/models/lib/jukebox.glb","size":[0.9,1.55,0.62],"kinds":["stereo"],"group":"furn","tint":"wood","tintable":["wood","chrome"]},
  "lamp_lava": {"url":"assets/models/lib/lamp_lava.glb","size":[0.16,0.46,0.156],"kinds":["desk_lamp","floor_lamp"],"group":"furn","tint":"blobs","tintable":["blobs"],"surface":true},
  "lamp_floor_arc": {"url":"assets/models/lib/lamp_floor_arc.glb","size":[0.4,1.996,1.465],"kinds":["floor_lamp"],"group":"furn","tint":"shade","tintable":["shade","marble"]},
  "poster_cat": {"url":"assets/models/lib/poster_cat.glb","size":[0.6,0.8,0.005],"kinds":["painting"],"group":"furn","tint":"frame","tintable":["frame","canvas"],"wall":"back","yOffset":1.3},
  "carpet_wall": {"url":"assets/models/lib/carpet_wall.glb","size":[1.6,1.2,0.012],"kinds":["painting","rug"],"group":"furn","tint":"frame","tintable":["frame","canvas"],"wall":"back","yOffset":0.7},
  "mirror_full": {"url":"assets/models/lib/mirror_full.glb","size":[0.62,1.75,0.534],"kinds":["mirror"],"group":"furn","tint":"frame","tintable":["frame","mirror"]},
  "rug_bear": {"url":"assets/models/lib/rug_bear.glb","size":[1.45,0.2,1.62],"kinds":["rug"],"group":"furn","tint":"fur","tintable":["fur","furDark"]},
  "plant_palm": {"url":"assets/models/lib/plant_palm.glb","size":[1.554,1.8,1.346],"kinds":["plant"],"group":"furn","tint":"wood","tintable":["wood","woodBarkDark","leafsGreen","woodBark"]},
  "plant_bonsai": {"url":"assets/models/lib/plant_bonsai.glb","size":[0.372,0.45,0.322],"kinds":["plant","flower_vase"],"group":"furn","tint":"wood","tintable":["wood","woodBarkDark","_defaultMat","leafsGreen","woodBark"],"surface":true},
  "yoga_mat": {"url":"assets/models/lib/yoga_mat.glb","size":[0.975,0.12,1.86],"kinds":["exercise_bench"],"group":"furn","tint":"mat","tintable":["mat"]},
  "punching_bag": {"url":"assets/models/lib/punching_bag.glb","size":[0.6,2.11,0.875],"kinds":["exercise_bench","gym_machine"],"group":"furn","tint":"frame","tintable":["leather","frame"]},
  "phone_wall": {"url":"assets/models/lib/phone_wall.glb","size":[0.195,0.47,0.075],"kinds":["phone"],"group":"furn","tint":"plastic","tintable":["plastic","cord"],"wall":"back","yOffset":1.3},
  "door_glass": {"url":"assets/models/lib/door_glass.glb","size":[0.98,2.2,0.238],"kinds":["door"],"group":"furn","tint":"carpetWhite","tintable":["carpetWhite"],"wall":"center"},
  "window_porthole": {"url":"assets/models/lib/window_porthole.glb","size":[0.88,0.875,0.22],"kinds":["window"],"group":"furn","tint":null,"tintable":[],"wall":"center","yOffset":1.2},
  "sofa_long3": {"url":"assets/models/lib/sofa_long3.glb","size":[3.013,0.943,0.841],"kinds":["sofa"],"group":"furn","tint":"carpet","tintable":["carpet","wood"]},
  "pool_round": {"url":"assets/models/lib/pool_round.glb","size":[3.02,0.75,2.905],"kinds":["pool"],"group":"furn","tint":"poolRim","tintable":["poolRim","eyes"]},
  "fountain_small": {"url":"assets/models/lib/fountain_small.glb","size":[0.92,1.11,0.906],"kinds":["fountain"],"group":"furn","tint":"stone","tintable":["stone"]},
  "sandbox_small": {"url":"assets/models/lib/sandbox_small.glb","size":[0.94,0.24,0.94],"kinds":["sandbox"],"group":"furn","tint":"wood","tintable":["wood","sand","toy"]},
  "cafe_table_solo": {"url":"assets/models/lib/cafe_table_solo.glb","size":[0.8,0.75,0.8],"kinds":["cafe_table"],"group":"furn","tint":"tableTop","tintable":["tableTop"]},
  "synth": {"url":"assets/models/lib/synth.glb","size":[0.98,0.895,0.5],"kinds":["piano"],"group":"furn","tint":"body","tintable":["body","stand","leds"]},
  "cash_register_counter": {"url":"assets/models/lib/cash_register_counter.glb","size":[1.715,1.2,1.715],"kinds":["cash_register"],"group":"furn","tint":"colormap","tintable":["colormap"]},
  "food_stall_cart": {"url":"assets/models/lib/food_stall_cart.glb","size":[1.8,2.192,1.01],"kinds":["food_stall"],"group":"furn","tint":"wood","tintable":["wood","awning","awningWhite","wheel"]},
  "flowerbed_roses": {"url":"assets/models/lib/flowerbed_roses.glb","size":[1,0.497,1.003],"kinds":["flowerbed"],"group":"furn","tint":"soil","tintable":["soil","border","grass","colorRed","colorWhite"]},
  "flowerbed_veg": {"url":"assets/models/lib/flowerbed_veg.glb","size":[1,0.752,1],"kinds":["flowerbed"],"group":"furn","tint":"soil","tintable":["soil","border","grass","leafsFall","woodBirch","leafsDark","dirt"]},
  "dumbbells": {"url":"assets/models/lib/dumbbells.glb","size":[0.85,0.8,0.4],"kinds":["exercise_bench","gym_machine"],"group":"furn","tint":"frame","tintable":["frame","weights","chrome"]},
  "hedge_2": {"url":"assets/models/lib/hedge_2.glb","size":[0.665,0.909,1.971],"kinds":["hedge"],"group":"hood","tint":"leaves","tintable":["leaves","leavesDark"]},
  "hedge_4": {"url":"assets/models/lib/hedge_4.glb","size":[0.665,0.909,3.977],"kinds":["hedge"],"group":"hood","tint":"leaves","tintable":["leaves","leavesDark"]},
  "hedge_topiary": {"url":"assets/models/lib/hedge_topiary.glb","size":[0.6,1.45,0.585],"kinds":["hedge"],"group":"furn","tint":"leaves","tintable":["leaves","pot","trunk"]},
};
export const KIND_SHAPES = {"fireplace":["fireplace","fireplace_stone"],"piano":["piano","piano_grand","piano_upright_small","synth"],"guitar":["guitar"],"telescope":["telescope"],"aquarium":["aquarium"],"pool_table":["pool_table","air_hockey"],"dartboard":["dartboard"],"video_game":["arcade_machine","game_console","dance_machine","claw_machine","vending_machine","ticket_machine","prize_wheel","basketball_game","gambling_machine"],"pinball":["claw_machine","pinball"],"treadmill":["treadmill","exercise_bike"],"hot_tub":["hot_tub"],"grill":["grill","campfire"],"coffee_maker":["coffee_maker"],"microwave":["microwave"],"dishwasher":["dishwasher"],"washing_machine":["washing_machine","dryer","washer_dryer"],"toy_box":["toy_box","teddy_bear","chest"],"dollhouse":["dollhouse"],"kids_bed":["kids_bed","kk_bed_single_A","kk_bed_single_B"],"bunk_bed":["bunk_bed"],"wardrobe":["wardrobe","kk_cabinet_medium"],"desk_lamp":["desk_lamp","desk_lamp_round","lantern_table","kk_lamp_table","lamp_lava"],"ceiling_lamp":["ceiling_lamp","ceiling_fan"],"sculpture":["sculpture","sculpture_obelisk","sculpture_ring","sculpture_abstract","snowman","urn","column"],"clock":["clock","clock_wall"],"flower_vase":["flower_vase","plant_small_a","plant_small_b","plant_small_c","pot_small_flower","kk_cactus_small_A","kk_cactus_small_B","plant_bonsai"],"plant":["plant_small_a","plant_small_b","plant_small_c","k_pottedPlant","pot_large_bush","pot_small_flower","cactus","xmas_tree","kk_cactus_medium_A","kk_cactus_medium_B","kk_cactus_small_A","kk_cactus_small_B","plant_palm","plant_bonsai"],"pool":["pool","pool_round"],"park_bench":["park_bench","park_bench_iron"],"fountain":["fountain","fountain_square","fountain_small"],"food_stall":["food_stall","food_stall_green","food_cart","food_stall_cart"],"cash_register":["cash_register","cash_register_counter"],"shelf_shop":["shelf_shop","shelf_shop_bags","shop_freezer","shop_freezer_tall","shop_fruit","shop_bread","vending_machine","shopping_cart"],"cafe_table":["cafe_table","cafe_table_parasol","cafe_table_solo"],"gym_machine":["gym_machine","exercise_bike","punching_bag","dumbbells"],"library_shelf":["library_shelf"],"museum_exhibit":["museum_exhibit"],"swing_set":["swing_set"],"sandbox":["sandbox","sandbox_small"],"trash_bin_street":["trash_bin_street","dumpster"],"streetlight":["streetlight","streetlight_double","streetlight_modern","streetlight_curved","lantern_post"],"hedge":["hedge","hedge_large","n_plant_bush","n_plant_bushDetailed","n_plant_bushLarge","n_plant_bushSmall","n_plant_bushTriangle","n_plant_bushLargeTriangle","hedge_2","hedge_4","hedge_topiary"],"decor":["hedge_curved","k_coatRack","k_coatRackStanding","k_cardboardBoxClosed","k_cardboardBoxOpen","k_hoodLarge","k_hoodModern","k_kitchenCabinetUpper","k_kitchenCabinetUpperDouble","k_kitchenCabinetUpperLow","k_kitchenCabinetUpperCorner","k_bathroomCabinet","k_lampWall","k_pillow","k_pillowBlue","k_pillowLong","k_pillowBlueLong","k_books","k_kitchenBlender","k_toaster","k_laptop","k_computerScreen","k_speaker","k_speakerSmall","k_radio","k_televisionModern","k_televisionVintage","xmas_tree","gift_box","menorah","barrel","workbench","tent","fire_hydrant","n_rock_largeA","n_rock_smallA","n_rock_tallA","n_stump_round","n_log_stack","rd_road_sign_stop","rd_road_sign_street","rd_road_sign_warning","rd_traffic_light","rd_construction_cone","rd_construction_barrier","rd_electricity_pole","cc_detail_awning","cc_detail_awning_wide","cc_detail_parasol_a","cc_detail_parasol_b","su_driveway_long","su_path_long","su_path_stones_long","su_planter","well_cart","kk_shelf_B_large","kk_shelf_B_large_decorated","kk_shelf_B_small","kk_shelf_B_small_decorated","kk_shelf_A_big","kk_shelf_A_small","kk_pictureframe_standing_A","kk_book_set","hedge_ft"],"tree":["tree","n_tree_default","n_tree_default_fall","n_tree_default_dark","n_tree_oak","n_tree_oak_fall","n_tree_oak_dark","n_tree_detailed","n_tree_detailed_fall","n_tree_detailed_dark","n_tree_fat","n_tree_fat_fall","n_tree_fat_dark","n_tree_simple","n_tree_simple_fall","n_tree_simple_dark","n_tree_tall","n_tree_tall_fall","n_tree_tall_dark","n_tree_thin","n_tree_thin_fall","n_tree_thin_dark","n_tree_blocks","n_tree_blocks_fall","n_tree_blocks_dark","n_tree_cone","n_tree_cone_fall","n_tree_cone_dark","n_tree_plateau","n_tree_plateau_fall","n_tree_plateau_dark","n_tree_small","n_tree_small_fall","n_tree_small_dark","n_tree_pineDefaultA","n_tree_pineRoundA","n_tree_pineRoundC","n_tree_pineTallA","n_tree_pineSmallA","n_tree_palmTall","n_tree_palm","su_tree_large","su_tree_small","ft_tree","ft_tree_high"],"flowerbed":["flowerbed","n_flower_redA","n_flower_yellowA","n_flower_purpleA","n_flower_redC","n_flower_yellowC","n_flower_purpleC","n_grass_large","n_grass_leafsLarge","n_mushroom_redGroup","flowerbed_roses","flowerbed_veg"],"fence":["fence","fence_planks","fence_high","fence_iron","fence_picket","fence_gate"],"sofa":["k_loungeSofa","k_loungeSofaLong","k_loungeDesignSofa","k_loungeSofaCorner","k_loungeDesignSofaCorner","k_benchCushion","kk_couch","kk_couch_pillows","sofa_long3"],"armchair":["k_loungeChair","k_loungeChairRelax","k_loungeDesignChair","k_loungeSofaOttoman","kk_armchair","kk_armchair_pillows","beanbag","armchair_egg","armchair_rocking","deck_chair","chair_exec"],"dining_chair":["k_chair","k_chairCushion","k_chairModernCushion","k_chairModernFrameCushion","k_chairRounded","k_chairDesk","k_stoolBar","k_stoolBarSquare","k_bench","k_benchCushionLow","kk_chair_A","kk_chair_A_wood","kk_chair_B","kk_chair_B_wood","kk_chair_C","kk_chair_stool","kk_chair_stool_wood","deck_chair","chair_exec"],"dining_table":["k_table","k_tableCloth","k_tableCross","k_tableCrossCloth","k_tableGlass","k_tableRound","kk_table_medium","kk_table_medium_long","kk_table_small","table_banquet","k_desk"],"coffee_table":["k_tableCoffee","k_tableCoffeeGlass","k_tableCoffeeGlassSquare","k_tableCoffeeSquare","k_sideTable","k_sideTableDrawers","kk_table_low","kk_table_small"],"bookshelf":["k_bookcaseOpen","k_bookcaseOpenLow","k_bookcaseClosed","k_bookcaseClosedWide"],"dresser":["k_cabinetBed","k_cabinetBedDrawer","k_cabinetBedDrawerTable","k_bathroomCabinetDrawer","kk_cabinet_medium","kk_cabinet_medium_decorated","kk_cabinet_small","kk_cabinet_small_decorated"],"toilet":["k_toilet","k_toiletSquare"],"shower":["k_shower","k_showerRound"],"bathtub":["k_bathtub","bathtub_clawfoot"],"bath_sink":["k_bathroomSink","k_bathroomSinkSquare"],"fridge":["k_kitchenFridge","k_kitchenFridgeLarge","k_kitchenFridgeSmall","k_kitchenFridgeBuiltIn","fridge_retro"],"stove":["k_kitchenStove","k_kitchenStoveElectric","stove_hood"],"counter":["k_kitchenCabinet","k_kitchenCabinetDrawer","k_kitchenBar","k_kitchenBarEnd","k_kitchenCabinetCornerRound","k_kitchenCabinetCornerInner","kitchen_island"],"kitchen_sink":["k_kitchenSink"],"floor_lamp":["k_lampRoundFloor","k_lampSquareFloor","kk_lamp_standing","lamp_lava","lamp_floor_arc"],"trash_can":["k_trashcan"],"mirror":["k_bathroomMirror","mirror_full"],"rug":["k_rugRectangle","k_rugRound","k_rugRounded","k_rugSquare","k_rugDoormat","kk_rug_oval_A","kk_rug_oval_B","kk_rug_rectangle_A","kk_rug_rectangle_B","kk_rug_rectangle_stripes_A","kk_rug_rectangle_stripes_B","carpet_wall","rug_bear"],"bed_single":["k_bedSingle","kk_bed_single_A","kk_bed_single_B","bed_cot"],"bed_double":["k_bedDouble","kk_bed_double_A","kk_bed_double_B","bed_water","bed_round"],"tv":["tv_modern","tv_modern_doors","tv_vintage","tv_plasma","tv_projector"],"stereo":["stereo_tower","stereo_radio","radio_retro","boombox","jukebox"],"computer_desk":["computer_laptop","computer_corner","computer_pc","k_desk"],"painting":["painting_birch","painting_sea","painting_abstract","painting_still","painting_portrait","painting_sunset","painting_wide","kk_pictureframe_large_A","kk_pictureframe_large_B","kk_pictureframe_medium","kk_pictureframe_small_A","poster_cat","carpet_wall"],"tombstone":["gravestone_cross","gravestone_round","gravestone_wide"],"mailbox":["mailbox_post"],"car":["car_sedan","car_suv","car_hatchback_sports","car_van","car_taxi","car_police","car_ambulance","car_firetruck","car_garbage_truck","car_delivery","car_truck","car_sedan_sports","car_suv_luxury","car_tractor"],"house":["house_a","house_b","house_c","house_d","house_e","house_f","house_g","house_h","house_i","house_j","house_k","house_l","house_m","house_n","house_o","house_p","house_q","house_r","house_s","house_t","house_u"],"building":["shop_a","shop_b","shop_c","shop_d","shop_e","shop_f","shop_g","shop_h","shop_i","shop_j","shop_k","shop_l","shop_m","shop_n"],"exercise_bench":["exercise_bike","yoga_mat","punching_bag","dumbbells"],"phone":["phone_wall"],"door":["door_glass"],"window":["window_porthole"]};
export const HOOD = {"trees":["tree","n_tree_default","n_tree_default_fall","n_tree_default_dark","n_tree_oak","n_tree_oak_fall","n_tree_oak_dark","n_tree_detailed","n_tree_detailed_fall","n_tree_detailed_dark","n_tree_fat","n_tree_fat_fall","n_tree_fat_dark","n_tree_simple","n_tree_simple_fall","n_tree_simple_dark","n_tree_tall","n_tree_tall_fall","n_tree_tall_dark","n_tree_thin","n_tree_thin_fall","n_tree_thin_dark","n_tree_blocks","n_tree_blocks_fall","n_tree_blocks_dark","n_tree_cone","n_tree_cone_fall","n_tree_cone_dark","n_tree_plateau","n_tree_plateau_fall","n_tree_plateau_dark","n_tree_small","n_tree_small_fall","n_tree_small_dark","n_tree_pineDefaultA","n_tree_pineRoundA","n_tree_pineRoundC","n_tree_pineTallA","n_tree_pineSmallA","n_tree_palmTall","n_tree_palm","su_tree_large","su_tree_small","ft_tree","ft_tree_high"],"bushes":["hedge","hedge_large","n_plant_bush","n_plant_bushDetailed","n_plant_bushLarge","n_plant_bushSmall","n_plant_bushTriangle","n_plant_bushLargeTriangle","hedge_2","hedge_4"],"flowers":["flowerbed","n_flower_redA","n_flower_yellowA","n_flower_purpleA","n_flower_redC","n_flower_yellowC","n_flower_purpleC","n_grass_large","n_grass_leafsLarge","n_mushroom_redGroup"],"fences":["fence","fence_planks","fence_high","fence_iron","fence_picket","fence_gate"],"cars":["car_sedan","car_suv","car_hatchback_sports","car_van","car_taxi","car_police","car_ambulance","car_firetruck","car_garbage_truck","car_delivery","car_truck","car_sedan_sports","car_suv_luxury","car_tractor"],"houses":["house_a","house_b","house_c","house_d","house_e","house_f","house_g","house_h","house_i","house_j","house_k","house_l","house_m","house_n","house_o","house_p","house_q","house_r","house_s","house_t","house_u"],"buildings":["shop_a","shop_b","shop_c","shop_d","shop_e","shop_f","shop_g","shop_h","shop_i","shop_j","shop_k","shop_l","shop_m","shop_n"],"street":["trash_bin_street","dumpster","streetlight","streetlight_double","streetlight_modern","streetlight_curved","lantern_post","mailbox_post","rd_road_sign_stop","rd_road_sign_street","rd_road_sign_warning","rd_traffic_light","rd_construction_cone","rd_construction_barrier","rd_electricity_pole"],"park":["hot_tub","grill","sculpture","pool","park_bench","park_bench_iron","fountain","fountain_square","food_stall","food_stall_green","food_cart","swing_set","sandbox","snowman","campfire"],"decor":["fireplace","fireplace_stone","piano","piano_grand","guitar","telescope","aquarium","pool_table","dartboard","arcade_machine","game_console","pinball","treadmill","coffee_maker","microwave","dishwasher","washing_machine","toy_box","dollhouse","kids_bed","bunk_bed","wardrobe","desk_lamp","ceiling_lamp","clock","flower_vase","cash_register","shelf_shop","cafe_table","gym_machine","library_shelf","museum_exhibit","hedge_curved","barrel","tent","gravestone_cross","gravestone_round","gravestone_wide","fire_hydrant","n_rock_largeA","n_rock_smallA","n_rock_tallA","n_stump_round","n_log_stack","cc_detail_awning","cc_detail_awning_wide","cc_detail_parasol_a","cc_detail_parasol_b","su_driveway_long","su_path_long","su_path_stones_long","su_planter","well_cart","hedge_ft"]};
// </gen:shapes>

// <models:auto> — волна 3: модели для новых видов (§9) и для каждого предмета каталога (data/catalog-extra.js).
// Выбор формы: def.shape (явно от Каталога) → форма базового предмета (variantOf) → совпадение слов id с ключом формы
// → по кругу среди форм этого kind (чтобы разные предметы получали разные модели). Цвет варианта: def.tint →
// tint {[материал формы]: цвет}. Масштаб: не больше 1 (только ужимаем в след fp×0.98), ковры растягиваются на след.
export const NEW_KINDS = ['fireplace', 'piano', 'guitar', 'telescope', 'aquarium', 'pool_table', 'dartboard', 'video_game', 'pinball', 'treadmill', 'hot_tub', 'grill', 'coffee_maker', 'microwave', 'dishwasher', 'washing_machine', 'toy_box', 'dollhouse', 'kids_bed', 'bunk_bed', 'wardrobe', 'desk_lamp', 'ceiling_lamp', 'sculpture', 'clock', 'flower_vase', 'pool', 'park_bench', 'fountain', 'food_stall', 'cash_register', 'shelf_shop', 'cafe_table', 'gym_machine', 'library_shelf', 'museum_exhibit', 'swing_set', 'sandbox', 'trash_bin_street', 'streetlight', 'hedge', 'tree', 'flowerbed', 'fence'];
const MOUNT = (sh) => sh.ceiling ? 'ceiling' : sh.wall === 'back' ? 'wall-back' : sh.wall === 'center' ? 'wall-center' : sh.wall === 'edge' ? 'edge' : sh.surface ? 'surface' : 'floor';
export function shapeEntry(key, def, tint) {
  const sh = SHAPES[key]; if (!sh) return null;
  let [sx, sy, sz] = sh.size; let scale = 1, rotY = 0;
  if (def?.fp) {
    const [fw, fd] = def.fp;
    // вытянутая форма поперёк вытянутого следа (ковёр 1×2 и т.п.) — поворачиваем на 90°
    if (!sh.wall && (fw - fd) * (sx - sz) < 0 && Math.abs(sx - sz) > 0.3 * Math.max(sx, sz) && (/rug|mat/.test(key) || Math.min(1, fw * 0.98 / sz, fd * 0.98 / sx) > Math.min(1, fw * 0.98 / sx, fd * 0.98 / sz) + 0.15)) { rotY = Math.PI / 2; [sx, sz] = [sz, sx]; }
    if (/rug/.test(key)) scale = Math.min(fw * 0.95 / sx, fd * 0.95 / sz);
    else if (sh.wall || def.place === 'wall') scale = Math.min(1, 0.98 / sx);
    else if (!['tree', 'house', 'building', 'car'].includes(sh.kinds[0])) scale = Math.min(1, fw * 0.98 / sx, fd * 0.98 / sz);
  }
  const e = { url: sh.url, scale: +scale.toFixed(4), rotY: +rotY.toFixed(4), yOffset: sh.ceiling ? +(3 - sy * scale).toFixed(3) : (sh.yOffset || 0), mount: MOUNT(sh), shape: key };
  if (tint && sh.tint) e.tint = { [sh.tint]: tint };
  return e;
}
export const MODEL_SHAPE = {};   // id предмета → ключ формы (для отчётов/каталога)
{ const cat = Object.fromEntries(CATALOG.map(d => [d.id, d])); for (const k of NEW_KINDS) if (!MODELS[k]) { const key = SHAPES[k] ? k : KIND_SHAPES[k]?.[0]; if (key) { MODELS[k] = shapeEntry(key, cat[k] || null); MODEL_SHAPE[k] = key; } } }
// «Свои модели» (приоритет 2 из docs/reports/catalog.md): id формы → ключ SHAPES
export const OVERRIDES = {
  beanbag: 'beanbag', recliner: 'k_loungeChairRelax', armchair_egg: 'armchair_egg', armchair_rocking: 'armchair_rocking', deck_chair: 'deck_chair',
  chair_bar_stool: 'k_stoolBar', chair_office: 'k_chairDesk', chair_exec: 'chair_exec', loveseat: 'kk_couch', sofa_corner: 'sofa_long3',
  bed_cot: 'bed_cot', bed_sleigh: 'kk_bed_double_B', bed_water: 'bed_water', bed_round: 'bed_round', table_glass: 'k_tableGlass', table_banquet: 'table_banquet',
  desk_basic: 'k_desk', nightstand: 'k_cabinetBedDrawerTable', counter_island: 'kitchen_island', fridge_siberia: 'fridge_retro', tv_plasma: 'tv_plasma', tv_projector: 'tv_projector',
  radio_mayak: 'radio_retro', stereo_boombox: 'boombox', jukebox: 'jukebox', lamp_lava: 'lamp_lava', lamp_floor_arc: 'lamp_floor_arc', poster_cat: 'poster_cat', carpet_wall: 'carpet_wall',
  mirror_full: 'mirror_full', rug_round: 'k_rugRound', rug_bear: 'rug_bear', plant_cactus: 'kk_cactus_medium_A', plant_palm: 'plant_palm', plant_bonsai: 'plant_bonsai',
  yoga_mat: 'yoga_mat', punching_bag: 'punching_bag', hedge_topiary: 'hedge_topiary', hedge_box: 'hedge', bike_exercise: 'exercise_bike', phone_wall: 'phone_wall', door_glass: 'door_glass', window_porthole: 'window_porthole',
};
{
  const rr = {};   // kind → счётчик «по кругу»
  const HOODOK = ['tree', 'hedge', 'fence', 'park_bench', 'fountain', 'streetlight', 'trash_bin_street', 'food_stall'];
  // «свои» формы (особые, из списка Каталога) — только по явной ссылке или совпадению слов, не «по кругу»
  const OWN = new Set(['window_porthole', 'door_glass', 'phone_wall', 'poster_cat', 'carpet_wall', 'rug_bear', 'beanbag', 'armchair_egg', 'bed_water', 'bed_round', 'jukebox', 'lamp_lava', 'tv_projector', 'yoga_mat', 'punching_bag', 'mirror_full', 'fridge_retro', 'radio_retro', 'boombox', 'deck_chair', 'chair_exec', 'armchair_rocking', 'bed_cot', 'table_banquet', 'plant_bonsai']);
  const pick = (d) => {
    const kind = d.kind || d.id; const wallItem = d.place === 'wall' && d.mount !== 'ceiling';
    let cands = (KIND_SHAPES[kind] || []).filter(k => (SHAPES[k].group !== 'hood' || HOODOK.includes(kind)) && (!!SHAPES[k].wall && SHAPES[k].wall !== 'edge') === wallItem);
    if (!cands.length) return null;
    const fitOf = (k) => shapeEntry(k, d)?.scale ?? 0;   // предпочитаем формы, что влезают в след без сильного ужатия
    const good = cands.filter(k => fitOf(k) >= 0.8 || /rug/.test(k));
    cands = good.length ? good : [cands.reduce((a, b) => (fitOf(b) > fitOf(a) ? b : a))];
    const stop = new Set([...kind.split('_'), 'chair', 'table', 'lamp', 'bed', 'sofa', 'small', 'big', 'new', 'old', 'basic']);
    const words = String(d.id).toLowerCase().split(/[_\-]/).filter(w => w.length > 2 && !stop.has(w));
    let best = null, bs = 0; for (const c of cands) { const lc = c.toLowerCase(); const sc = words.filter(w => lc.includes(w)).length; if (sc > bs) { bs = sc; best = c; } }
    if (best) return best;
    cands = cands.filter(k => !OWN.has(k)); if (!cands.length) return null;
    // представитель вида (kind) получает форму вида; остальные — по кругу
    if (SHAPES[kind] && cands.includes(kind) && !rr[kind + ':rep']) { rr[kind + ':rep'] = 1; return kind; }
    rr[kind] = (rr[kind] ?? -1) + 1; return cands[rr[kind] % cands.length];
  };
  const tintFor = (entry, tint) => !tint ? {} : { tint: entry?.shape && SHAPES[entry.shape]?.tint ? { [SHAPES[entry.shape].tint]: tint } : tint };
  // проход 1 — формы (без variantOf); проход 2 — цветовые варианты: модель формы + tint
  for (const d of CATALOG.filter(x => !x.variantOf)) {
    if (MODELS[d.id]) { MODEL_SHAPE[d.id] ??= 'base:' + d.id; continue; }
    const key = OVERRIDES[d.id] && SHAPES[OVERRIDES[d.id]] ? OVERRIDES[d.id] : d.shape && SHAPES[d.shape] ? d.shape : pick(d);
    if (key) { MODELS[d.id] = shapeEntry(key, d, d.tint); MODEL_SHAPE[d.id] = key; continue; }
    const base = MODELS[d.kind]; if (base) { MODELS[d.id] = { ...base, ...tintFor(base, d.tint) }; MODEL_SHAPE[d.id] = 'base:' + d.kind; }
  }
  for (const d of CATALOG.filter(x => x.variantOf)) {
    if (MODELS[d.id] && CATALOG.indexOf(d) < 38) continue;
    const base = MODELS[d.variantOf] || MODELS[d.kind]; if (!base) continue;
    MODELS[d.id] = { ...base, ...tintFor(base, d.tint) }; MODEL_SHAPE[d.id] = MODEL_SHAPE[d.variantOf] || 'base:' + d.kind;
  }
}
// </models:auto>
// <cas> — волна 3: «Создать семью». Тело = OUTFITS[пол][стиль] (лысое тело + одежда, материалы shirt/pants/dress/shoes/skin),
// причёска и аксессуары — статичные меши в локальных координатах кости 'Head':
//   const head = model.getObjectByName('Head'); head.add(hairScene)   // position 0, quaternion identity, scale 1
// (у детей Head уже ×1.3 — причёска растёт вместе с головой). Красить: HAIR → материал 'hair'; ACCESSORIES → 'accColor'.
// BODY — телосложение: масштабы костей (ось Y = вдоль кости, X/Z — обхват), выставлять bone.scale.set(x,y,z) один раз
// после клонирования (в клипах нет каналов масштаба). 'average' — без изменений.
export const OUTFITS = {"m": {"casual": {"url": "assets/models/characters/outfits/m_casual.glb", "label": "повседневная"}, "formal": {"url": "assets/models/characters/outfits/m_formal.glb", "label": "выходная"}, "sport": {"url": "assets/models/characters/outfits/m_sport.glb", "label": "спортивная"}, "sleep": {"url": "assets/models/characters/outfits/m_sleep.glb", "label": "пижама"}, "swim": {"url": "assets/models/characters/outfits/m_swim.glb", "label": "купальная"}, "work_repair": {"url": "assets/models/characters/outfits/m_work_repair.glb", "label": "спецовка мастера"}, "work_police": {"url": "assets/models/characters/outfits/m_work_police.glb", "label": "форма полиции"}, "work_medic": {"url": "assets/models/characters/outfits/m_work_medic.glb", "label": "медицинская"}, "work_fire": {"url": "assets/models/characters/outfits/m_work_fire.glb", "label": "пожарная"}, "work_chef": {"url": "assets/models/characters/outfits/m_work_chef.glb", "label": "повар"}}, "f": {"casual": {"url": "assets/models/characters/outfits/f_casual.glb", "label": "повседневная"}, "formal": {"url": "assets/models/characters/outfits/f_formal.glb", "label": "выходная"}, "sport": {"url": "assets/models/characters/outfits/f_sport.glb", "label": "спортивная"}, "sleep": {"url": "assets/models/characters/outfits/f_sleep.glb", "label": "пижама"}, "swim": {"url": "assets/models/characters/outfits/f_swim.glb", "label": "купальная"}, "work_repair": {"url": "assets/models/characters/outfits/f_work_repair.glb", "label": "спецовка мастера"}, "work_police": {"url": "assets/models/characters/outfits/f_work_police.glb", "label": "форма полиции"}, "work_medic": {"url": "assets/models/characters/outfits/f_work_medic.glb", "label": "медицинская"}, "dress": {"url": "assets/models/characters/outfits/f_dress.glb", "label": "платье"}, "work_maid": {"url": "assets/models/characters/outfits/f_work_maid.glb", "label": "горничная"}}};
export const HAIR = {"parted": {"url": "assets/models/characters/hair/parted.glb", "gender": "u", "label": "пробор", "tint": "hair"}, "long": {"url": "assets/models/characters/hair/long.glb", "gender": "f", "label": "длинные", "tint": "hair"}, "buns": {"url": "assets/models/characters/hair/buns.glb", "gender": "f", "label": "два пучка", "tint": "hair"}, "buzzed": {"url": "assets/models/characters/hair/buzzed.glb", "gender": "u", "label": "ёжик", "tint": "hair"}, "buzzed_f": {"url": "assets/models/characters/hair/buzzed_f.glb", "gender": "f", "label": "ёжик", "tint": "hair"}, "short_messy_m": {"url": "assets/models/characters/hair/short_messy_m.glb", "gender": "m", "label": "короткие взъерошенные", "tint": "hair"}, "quiff_m": {"url": "assets/models/characters/hair/quiff_m.glb", "gender": "m", "label": "кок", "tint": "hair"}, "side_swept_m": {"url": "assets/models/characters/hair/side_swept_m.glb", "gender": "m", "label": "набок", "tint": "hair"}, "spiky_m": {"url": "assets/models/characters/hair/spiky_m.glb", "gender": "m", "label": "ёжик-шипы", "tint": "hair"}, "slick_back_m": {"url": "assets/models/characters/hair/slick_back_m.glb", "gender": "m", "label": "зачёс назад", "tint": "hair"}, "man_bun_m": {"url": "assets/models/characters/hair/man_bun_m.glb", "gender": "m", "label": "пучок на макушке", "tint": "hair"}, "mohawk_m": {"url": "assets/models/characters/hair/mohawk_m.glb", "gender": "m", "label": "ирокез", "tint": "hair"}, "afro_m": {"url": "assets/models/characters/hair/afro_m.glb", "gender": "m", "label": "афро", "tint": "hair"}, "curly_m": {"url": "assets/models/characters/hair/curly_m.glb", "gender": "m", "label": "кудри", "tint": "hair"}, "bun_f": {"url": "assets/models/characters/hair/bun_f.glb", "gender": "f", "label": "пучок", "tint": "hair"}, "braid_f": {"url": "assets/models/characters/hair/braid_f.glb", "gender": "f", "label": "коса", "tint": "hair"}, "curly_f": {"url": "assets/models/characters/hair/curly_f.glb", "gender": "f", "label": "кудри", "tint": "hair"}, "afro_f": {"url": "assets/models/characters/hair/afro_f.glb", "gender": "f", "label": "афро", "tint": "hair"}, "umw_casual": {"url": "assets/models/characters/hair/umw_casual.glb", "gender": "f", "label": "каре с пробором", "tint": "hair"}, "umw_scifi": {"url": "assets/models/characters/hair/umw_scifi.glb", "gender": "f", "label": "длинная чёлка набок", "tint": "hair"}, "umw_soldier": {"url": "assets/models/characters/hair/umw_soldier.glb", "gender": "f", "label": "полухвост", "tint": "hair"}, "umw_witch": {"url": "assets/models/characters/hair/umw_witch.glb", "gender": "f", "label": "длинные распущенные", "tint": "hair"}, "umm_adventurer": {"url": "assets/models/characters/hair/umm_adventurer.glb", "gender": "m", "label": "лохматые с бородой", "tint": "hair"}, "umm_beach": {"url": "assets/models/characters/hair/umm_beach.glb", "gender": "m", "label": "взъерошенные", "tint": "hair"}, "umm_casual_2": {"url": "assets/models/characters/hair/umm_casual_2.glb", "gender": "m", "label": "волна назад", "tint": "hair"}, "umm_casual_hoodie": {"url": "assets/models/characters/hair/umm_casual_hoodie.glb", "gender": "m", "label": "шапка кудрей", "tint": "hair"}, "umm_king": {"url": "assets/models/characters/hair/umm_king.glb", "gender": "m", "label": "с бородой", "tint": "hair"}, "umm_suit": {"url": "assets/models/characters/hair/umm_suit.glb", "gender": "m", "label": "чёлка набок", "tint": "hair"}, "bald": {"url": null, "gender": "u", "label": "лысый"}};
export const ACCESSORIES = {"beard": {"url": "assets/models/characters/hair/beard.glb", "gender": "m", "slot": "face", "label": "борода", "tint": "hair"}, "glasses_m": {"url": "assets/models/characters/acc/glasses_m.glb", "gender": "m", "slot": "eyes", "label": "очки", "tint": "accColor"}, "glasses_f": {"url": "assets/models/characters/acc/glasses_f.glb", "gender": "f", "slot": "eyes", "label": "очки", "tint": "accColor"}, "sunglasses_m": {"url": "assets/models/characters/acc/sunglasses_m.glb", "gender": "m", "slot": "eyes", "label": "тёмные очки", "tint": "accColor"}, "sunglasses_f": {"url": "assets/models/characters/acc/sunglasses_f.glb", "gender": "f", "slot": "eyes", "label": "тёмные очки", "tint": "accColor"}, "cap_m": {"url": "assets/models/characters/acc/cap_m.glb", "gender": "m", "slot": "head", "label": "кепка", "tint": "accColor"}, "cap_f": {"url": "assets/models/characters/acc/cap_f.glb", "gender": "f", "slot": "head", "label": "кепка", "tint": "accColor"}, "beanie_m": {"url": "assets/models/characters/acc/beanie_m.glb", "gender": "m", "slot": "head", "label": "шапка", "tint": "accColor"}, "beanie_f": {"url": "assets/models/characters/acc/beanie_f.glb", "gender": "f", "slot": "head", "label": "шапка", "tint": "accColor"}, "straw_hat_m": {"url": "assets/models/characters/acc/straw_hat_m.glb", "gender": "m", "slot": "head", "label": "соломенная шляпа", "tint": "accColor"}, "straw_hat_f": {"url": "assets/models/characters/acc/straw_hat_f.glb", "gender": "f", "slot": "head", "label": "соломенная шляпа", "tint": "accColor"}, "top_hat_m": {"url": "assets/models/characters/acc/top_hat_m.glb", "gender": "m", "slot": "head", "label": "цилиндр", "tint": "accColor"}, "top_hat_f": {"url": "assets/models/characters/acc/top_hat_f.glb", "gender": "f", "slot": "head", "label": "цилиндр", "tint": "accColor"}, "headband_m": {"url": "assets/models/characters/acc/headband_m.glb", "gender": "m", "slot": "head", "label": "повязка", "tint": "accColor"}, "headband_f": {"url": "assets/models/characters/acc/headband_f.glb", "gender": "f", "slot": "head", "label": "повязка", "tint": "accColor"}, "moustache_m": {"url": "assets/models/characters/acc/moustache_m.glb", "gender": "m", "slot": "face", "label": "усы", "tint": "hair"}, "moustache_f": {"url": "assets/models/characters/acc/moustache_f.glb", "gender": "f", "slot": "face", "label": "усы", "tint": "hair"}, "earrings_m": {"url": "assets/models/characters/acc/earrings_m.glb", "gender": "m", "slot": "ears", "label": "серьги", "tint": "accColor"}, "earrings_f": {"url": "assets/models/characters/acc/earrings_f.glb", "gender": "f", "slot": "ears", "label": "серьги", "tint": "accColor"}};
export const BODY = {"slim": {"spine_01": [0.91, 1, 0.91], "spine_02": [1.098, 1, 1.125], "neck_01": [1.111, 1, 1.111], "clavicle_l": [1.111, 1, 1.111], "clavicle_r": [1.111, 1, 1.111], "upperarm_l": [0.88, 1, 0.88], "upperarm_r": [0.88, 1, 0.88], "lowerarm_l": [1.08, 1, 1.08], "lowerarm_r": [1.08, 1, 1.08], "thigh_l": [0.98, 1, 1.0], "thigh_r": [0.98, 1, 1.0], "calf_l": [1.045, 1, 1.045], "calf_r": [1.045, 1, 1.045], "foot_l": [1.087, 1, 1.087], "foot_r": [1.087, 1, 1.087], "pelvis": [0.9, 1, 0.88]}, "fit": {"spine_03": [1.14, 1, 1.1], "neck_01": [0.877, 1, 0.909], "clavicle_l": [0.877, 1, 0.909], "clavicle_r": [0.877, 1, 0.909], "upperarm_l": [1.16, 1, 1.16], "upperarm_r": [1.16, 1, 1.16], "lowerarm_l": [0.93, 1, 0.93], "lowerarm_r": [0.93, 1, 0.93], "thigh_l": [1.08, 1, 1.08], "thigh_r": [1.08, 1, 1.08], "calf_l": [0.926, 1, 0.926], "calf_r": [0.926, 1, 0.926]}, "heavy": {"spine_01": [1.1, 1, 1.16], "spine_02": [0.833, 1, 0.772], "neck_01": [0.909, 1, 0.893], "clavicle_l": [0.909, 1, 0.893], "clavicle_r": [0.909, 1, 0.893], "upperarm_l": [1.15, 1, 1.15], "upperarm_r": [1.15, 1, 1.15], "lowerarm_l": [0.9, 1, 0.9], "lowerarm_r": [0.9, 1, 0.9], "thigh_l": [1.02, 1, 0.98], "thigh_r": [1.02, 1, 0.98], "calf_l": [0.885, 1, 0.885], "calf_r": [0.885, 1, 0.885], "foot_l": [0.926, 1, 0.926], "foot_r": [0.926, 1, 0.926], "pelvis": [1.2, 1, 1.25]}};
// </cas>
