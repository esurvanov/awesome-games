// Стартовый дом «Житьё» на участке 30×30. Улица — сторона y = h−1 (юг, +y).
// Дом 12×10 (вершины x 9..21, y 12..22): сзади спальня | ванная | кабинет, спереди гостиная | кухня-столовая.
//
//        x: 9    11   13   15 16 17 18 19 20
//  y=12  ┌──────────────┬────────┬────────┐
//        │  спальня     │ ванная │кабинет │
//  y=17  ├──D───────────┴D───────┼──D─────┤
//        │  гостиная          D  кухня     │
//  y=22  └────D─────────────────┴──────────┘   → улица, почтовый ящик (10,28)
//
// Этаж 1 (волна 2): мастерская над ванной+кабинетом (x 15..20, y 12..16), дверь на восток →
// площадка x=21 (y 15..17) + (22,17) → наружная лестница x=22, ступени y 13..16 (rot 2):
// низ (22,12) на земле, верх (22,17) на площадке. Стены/пол/предметы с level:1.
//
// walls: линии по вершинам; objects: {def, x, y, rot} — x,y = мин. угол футпринта,
// у настенных — клетка, в которую предмет смотрит (ребро за её спиной, см. js/world/footprint.js).
export const START_LOT = {
  w: 30, h: 30,
  spawn: { x: 12, y: 24 },
  frontDoor: { x: 12, y: 22 },             // клетка улицы перед входной дверью
  walls: [
    { rect: [9, 12, 21, 22], type: 3 },    // внешний периметр — кирпич
    { line: [9, 17, 21, 17], type: 2 },    // зад/перёд
    { line: [15, 12, 15, 17], type: 2 },   // спальня | ванная
    { line: [18, 12, 18, 17], type: 2 },   // ванная | кабинет
    { line: [16, 17, 16, 22], type: 2 },   // гостиная | кухня
    { rect: [15, 12, 21, 17], type: 3, level: 1 },   // мастерская наверху
  ],
  floors: [
    { rect: [9, 12, 14, 16], id: 3 },      // спальня — ковролин
    { rect: [15, 12, 17, 16], id: 2 },     // ванная — плитка
    { rect: [18, 12, 20, 16], id: 1 },     // кабинет — паркет
    { rect: [9, 17, 15, 21], id: 1 },      // гостиная — паркет
    { rect: [16, 17, 20, 21], id: 4 },     // кухня — линолеум
    { rect: [15, 12, 20, 16], id: 1, level: 1 },   // мастерская — паркет
    { rect: [21, 15, 21, 17], id: 1, level: 1 },   // площадка
    { rect: [22, 17, 22, 17], id: 1, level: 1 },   // верх лестницы
  ],
  objects: [
    // двери
    { def: 'door', x: 12, y: 21, rot: 2 },         // входная, ребро wallH(12,22)
    { def: 'door', x: 11, y: 17, rot: 0 },         // гостиная → спальня
    { def: 'door', x: 15, y: 17, rot: 0 },         // гостиная → ванная
    { def: 'door', x: 19, y: 17, rot: 0 },         // кухня → кабинет
    { def: 'door', x: 16, y: 19, rot: 1 },         // гостиная → кухня
    // окна
    { def: 'window', x: 13, y: 12, rot: 0 }, { def: 'window', x: 9, y: 15, rot: 1 },
    { def: 'window', x: 16, y: 12, rot: 0 },
    { def: 'window', x: 19, y: 12, rot: 0 }, { def: 'window', x: 20, y: 13, rot: 3 },
    { def: 'window', x: 14, y: 21, rot: 2 }, { def: 'window', x: 9, y: 18, rot: 1 },
    { def: 'window', x: 17, y: 21, rot: 2 }, { def: 'window', x: 20, y: 19, rot: 3 },
    // спальня
    { def: 'bed_double', x: 12, y: 12, rot: 0 },
    { def: 'dresser', x: 9, y: 12, rot: 0 },
    { def: 'floor_lamp', x: 10, y: 12, rot: 0 },
    { def: 'plant', x: 14, y: 16, rot: 3 },
    { def: 'rug', x: 12, y: 14, rot: 0 },
    { def: 'painting', x: 9, y: 13, rot: 1 },
    // ванная
    { def: 'shower', x: 15, y: 12, rot: 0 },
    { def: 'bath_sink', x: 16, y: 12, rot: 0 },
    { def: 'toilet', x: 17, y: 12, rot: 0 },
    { def: 'bathtub', x: 17, y: 14, rot: 3 },
    { def: 'mirror', x: 15, y: 14, rot: 1 },
    // кабинет
    { def: 'computer_desk', x: 18, y: 12, rot: 0 },
    { def: 'bookshelf', x: 20, y: 12, rot: 0 },
    { def: 'bed_single', x: 20, y: 14, rot: 0 },
    { def: 'chess', x: 18, y: 15, rot: 0 },
    // гостиная
    { def: 'stereo', x: 9, y: 17, rot: 1 },
    { def: 'tv', x: 13, y: 17, rot: 0 },
    { def: 'armchair', x: 9, y: 19, rot: 1 },
    { def: 'coffee_table', x: 13, y: 19, rot: 0 },
    { def: 'phone', x: 14, y: 19, rot: 0 },
    { def: 'floor_lamp', x: 9, y: 20, rot: 1 },
    { def: 'plant', x: 9, y: 21, rot: 1 },
    { def: 'sofa', x: 13, y: 21, rot: 2 },
    { def: 'painting', x: 10, y: 21, rot: 2 },
    // кухня-столовая
    { def: 'fridge', x: 16, y: 17, rot: 0 },
    { def: 'stove', x: 17, y: 17, rot: 0 },
    { def: 'kitchen_sink', x: 18, y: 17, rot: 0 },
    { def: 'counter', x: 20, y: 17, rot: 0 },
    { def: 'dining_table', x: 18, y: 20, rot: 0 },
    { def: 'dining_chair', x: 18, y: 19, rot: 0 },
    { def: 'dining_chair', x: 19, y: 21, rot: 2 },
    { def: 'trash_can', x: 16, y: 21, rot: 1 },
    { def: 'painting', x: 20, y: 21, rot: 3 },
    { def: 'plant', x: 16, y: 20, rot: 1 },
    { def: 'smoke_alarm', x: 17, y: 17, rot: 0 },  // на стене над плитой
    // лестница и мастерская (этаж 1)
    { def: 'stairs', x: 22, y: 13, rot: 2 },
    { def: 'door', x: 20, y: 15, rot: 3, level: 1 },
    { def: 'window', x: 17, y: 12, rot: 0, level: 1 }, { def: 'window', x: 15, y: 14, rot: 1, level: 1 },
    { def: 'window', x: 20, y: 13, rot: 3, level: 1 },
    { def: 'easel', x: 16, y: 13, rot: 0, level: 1 },
    { def: 'exercise_bench', x: 18, y: 12, rot: 0, level: 1 },
    { def: 'plant', x: 15, y: 16, rot: 1, level: 1 },
    { def: 'painting', x: 19, y: 16, rot: 2, level: 1 },
    { def: 'floor_lamp', x: 20, y: 16, rot: 3, level: 1 },
    // улица
    { def: 'mailbox', x: 10, y: 28, rot: 0 },
    { def: 'plant', x: 14, y: 23, rot: 0 },
  ],
};
