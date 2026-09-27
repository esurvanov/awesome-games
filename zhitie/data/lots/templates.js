// Ручные шаблоны домов (формат плана — js/world/housegen.js). Координаты — вершины (комнаты) и клетки (двери, пол).
// Улица — y = h−1. Двери: {x,y,rot,level} как у настенных предметов (ребро за спиной клетки).
export const TEMPLATES = {
  // Домик на двоих: санузел | спальня; гостиная | кухня
  cottage: {
    w: 24, h: 24, ext: 3, int: 1, members: 2,
    rooms: [
      { type: 'bath', level: 0, x0: 7, y0: 9, x1: 10, y1: 13 },
      { type: 'bedroom', level: 0, x0: 10, y0: 9, x1: 16, y1: 13, beds: ['bed_double'] },
      { type: 'living', level: 0, x0: 7, y0: 13, x1: 12, y1: 17 },
      { type: 'kitchen', level: 0, x0: 12, y0: 13, x1: 16, y1: 17 },
    ],
    doors: [{ x: 8, y: 13, rot: 0, level: 0 }, { x: 13, y: 13, rot: 0, level: 0 }, { x: 12, y: 15, rot: 1, level: 0 }, { x: 9, y: 16, rot: 2, level: 0 }],
    stairs: [],
    floors: [{ level: 0, x0: 8, y0: 17, x1: 10, y1: 18, id: 'porch' }, { level: 0, x0: 9, y0: 19, x1: 9, y1: 23, id: 'porch' }],
    front: { x: 9, y: 17 }, mailbox: { x: 11, y: 22 },
    yards: [{ x0: 1, y0: 19, x1: 23, y1: 22, level: 0, type: 'front' }, { x0: 1, y0: 1, x1: 23, y1: 8, level: 0, type: 'back' }],
  },
  // Г-образный с гаражом: санузел | 2 спальни; гостиная | кухня | гараж
  bungalow: {
    w: 30, h: 30, ext: 3, int: 2, members: 4,
    rooms: [
      { type: 'bath', level: 0, x0: 8, y0: 12, x1: 11, y1: 17 },
      { type: 'bedroom', level: 0, x0: 11, y0: 12, x1: 16, y1: 17, beds: ['bed_double'] },
      { type: 'bedroom', level: 0, x0: 16, y0: 12, x1: 22, y1: 17, beds: ['kids_bed', 'kids_bed'], kid: true },
      { type: 'living', level: 0, x0: 8, y0: 17, x1: 15, y1: 23 },
      { type: 'kitchen', level: 0, x0: 15, y0: 17, x1: 22, y1: 23 },
      { type: 'garage', level: 0, x0: 22, y0: 17, x1: 27, y1: 23 },
    ],
    doors: [{ x: 9, y: 17, rot: 0, level: 0 }, { x: 12, y: 17, rot: 0, level: 0 }, { x: 18, y: 17, rot: 0, level: 0 },
      { x: 15, y: 19, rot: 1, level: 0 }, { x: 22, y: 19, rot: 1, level: 0 }, { x: 10, y: 22, rot: 2, level: 0 }, { x: 24, y: 22, rot: 2, level: 0 }],
    stairs: [],
    floors: [{ level: 0, x0: 9, y0: 23, x1: 11, y1: 24, id: 'porch' }, { level: 0, x0: 10, y0: 25, x1: 10, y1: 29, id: 'porch' }],
    front: { x: 10, y: 23 }, mailbox: { x: 12, y: 28 },
    yards: [{ x0: 1, y0: 25, x1: 29, y1: 28, level: 0, type: 'front' }, { x0: 1, y0: 1, x1: 29, y1: 11, level: 0, type: 'back' }],
  },
  // Двухэтажный таунхаус: внизу санузел | кабинет, гостиная | кухня; наверху две спальни и коридор; лестница снаружи
  townhouse: {
    w: 26, h: 30, ext: 3, int: 1, members: 3,
    rooms: [
      { type: 'bath', level: 0, x0: 6, y0: 14, x1: 9, y1: 18 },
      { type: 'study', level: 0, x0: 9, y0: 14, x1: 16, y1: 18 },
      { type: 'living', level: 0, x0: 6, y0: 18, x1: 11, y1: 23 },
      { type: 'kitchen', level: 0, x0: 11, y0: 18, x1: 16, y1: 23 },
      { type: 'hall', level: 1, x0: 6, y0: 21, x1: 16, y1: 23 },
      { type: 'bedroom', level: 1, x0: 6, y0: 14, x1: 11, y1: 21, beds: ['bed_double'] },
      { type: 'bedroom', level: 1, x0: 11, y0: 14, x1: 16, y1: 21, beds: ['kids_bed'], kid: true },
    ],
    doors: [{ x: 7, y: 18, rot: 0, level: 0 }, { x: 12, y: 18, rot: 0, level: 0 }, { x: 11, y: 20, rot: 1, level: 0 }, { x: 8, y: 22, rot: 2, level: 0 },
      { x: 7, y: 21, rot: 0, level: 1 }, { x: 13, y: 21, rot: 0, level: 1 }, { x: 15, y: 22, rot: 3, level: 1 }],
    stairs: [{ x: 17, y: 18, rot: 2 }],
    floors: [{ level: 1, x0: 16, y0: 21, x1: 16, y1: 22 }, { level: 1, x0: 17, y0: 22, x1: 17, y1: 22 },
      { level: 0, x0: 7, y0: 23, x1: 9, y1: 24, id: 'porch' }, { level: 0, x0: 8, y0: 25, x1: 8, y1: 29, id: 'porch' }],
    front: { x: 8, y: 23 }, mailbox: { x: 10, y: 28 },
    yards: [{ x0: 1, y0: 25, x1: 25, y1: 28, level: 0, type: 'front' }, { x0: 1, y0: 1, x1: 25, y1: 13, level: 0, type: 'back' }],
  },
};
