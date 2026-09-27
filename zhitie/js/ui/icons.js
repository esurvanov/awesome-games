// Свой набор линейных SVG-иконок 24×24 (стиль портирован из russia/index.html:223-267, рисунки свои).
export const IC = {
  // потребности
  hunger: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M16 3c-2 1-3 4-3 7h3v11M16 3v18"/>',
  comfort: '<path d="M5 11V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v4"/><path d="M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v5H3zM6 18v2M18 18v2"/>',
  hygiene: '<path d="M4 8h9a3 3 0 0 1 3 3v1M4 8V5M4 8v2"/><path d="M9 15v1M13 16v1M17 15v1M11 19v1M15 19v1"/><path d="M16 12h4"/>',
  bladder: '<path d="M7 3h10v5H7zM6 8h12l-2 7H8zM9 15l-1 6h8l-1-6"/>',
  energy: '<path d="M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z"/><path d="M16 4h3l-3 3h3"/>',
  fun: '<circle cx="12" cy="12" r="9"/><path d="M8 14c1 2 2.5 3 4 3s3-1 4-3M9 9.5v.5M15 9.5v.5"/>',
  social: '<path d="M3 5h12v8H8l-4 3v-3H3z"/><path d="M15 9h6v8h-1v3l-4-3h-4v-2"/>',
  room: '<path d="M3 11l9-8 9 8M5 10v11h14V10"/><path d="M10 21v-6h4v6"/>',
  // навыки
  cooking: '<path d="M4 10h16v3a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6zM2 10h2M20 10h2"/><path d="M9 7c0-2 2-2 2-4M13 7c0-2 2-2 2-4"/>',
  mechanical: '<path d="M14.5 5.5a4 4 0 0 0 5 5L11 19a2.1 2.1 0 0 1-3-3z"/><path d="M14.5 5.5L17 3l1 3 3 1-2.5 2.5"/>',
  charisma: '<circle cx="12" cy="9" r="5"/><path d="M9.5 10.5c1 1 4 1 5 0M10 8v.2M14 8v.2M7 21c1-4 3-5 5-5s4 1 5 5"/>',
  body: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  logic: '<path d="M8 21h8M9 17h6l1 4H8zM10 17V11M14 17V11M8 11h8M9 11V7l1 1 1-3h2l1 3 1-1v4"/>',
  creativity: '<path d="M4 20c2 0 4-1 4-4a2 2 0 0 0-2-2c-2 0-2 3-2 6z"/><path d="M8 14L19 3l2 2L10 16"/>',
  // черты характера
  neat: '<path d="M12 3v9M6 12h12l1 9H5z"/><path d="M9 16v5M12 16v5M15 16v5"/>',
  outgoing: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2 20c.5-4 3-6 6-6s5.5 2 6 6M13 14.5c1-.3 2-.5 3-.5 3 0 5.5 2 6 6"/>',
  active: '<circle cx="14" cy="4.5" r="2"/><path d="M8 21l3-6 3 2v5M6 11l3-3h4l3 3 3 1M11 15l1-7"/>',
  playful: '<circle cx="12" cy="12" r="9"/><path d="M3.5 9c5 1 12 1 17 0M3.5 15c5-1 12-1 17 0M12 3c-3 5-3 13 0 18"/>',
  nice: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/>',
  // режимы и вкладки
  live: '<circle cx="12" cy="7" r="3.5"/><path d="M5 21c.8-5 3.5-7.5 7-7.5s6.2 2.5 7 7.5"/>',
  buy: '<path d="M4 12V9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3"/><path d="M2 13a2 2 0 0 1 4 0v1h12v-1a2 2 0 0 1 4 0v5H2zM5 18v2M19 18v2"/>',
  build: '<path d="M14 6l4 4M3 21l9-9M13 3l8 8-3 3-8-8z"/>',
  job: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
  trait: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  skill: '<path d="M4 20V14M10 20V9M16 20V5M2 20h20"/>',
  rel: '<path d="M8.5 17s-6-3.8-6-8.3A3.4 3.4 0 0 1 8.5 6.6a3.4 3.4 0 0 1 6 2.1"/><path d="M15.5 21s-6-3.8-6-8.3a3.4 3.4 0 0 1 6-2.1 3.4 3.4 0 0 1 6 2.1c0 4.5-6 8.3-6 8.3z"/>',
  // управление
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3.2"/>',
  play: '<path d="M8 5l11 7-11 7z" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  mute: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/><path d="M3 3l18 18"/>',
  money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 10v4M18 10v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bell: '<path d="M6 17v-6a6 6 0 0 1 12 0v6l2 2H4z"/><path d="M10 21h4"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="M9 21l2-6 3 2 1 4M8 12l2-4h4l2 4M11 15l1-7"/>',
  hand: '<path d="M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14c0 4-3 7-6 7-3 0-5-2-7-5l-1-2a1.5 1.5 0 0 1 2.5-1.5L8 15"/>',
  rotate: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>',
  // стройка
  wall: '<path d="M3 5h18v14H3zM3 10h18M3 15h18M9 5v5M15 5v5M6 10v5M12 10v5M18 10v5M9 15v4M15 15v4"/>',
  wallDel: '<path d="M3 5h18v14H3zM3 12h18M9 5v7M15 12v7"/><path d="M14 2l8 8M22 2l-8 8" stroke="#ff7b7b"/>',
  floor: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5M7.5 5.5l9 5M16.5 5.5l-9 5"/>',
  door: '<path d="M6 21V3h12v18M3 21h18"/><circle cx="15" cy="12" r="1"/>',
  window: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 4v16M4 12h16"/>',
  paint: '<rect x="3" y="3" width="14" height="6" rx="1"/><path d="M17 6h3v5h-8v3M12 14v7"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
  // категории покупок
  seating: '<path d="M7 3h10v9H7zM5 12h14v3H5zM7 15v6M17 15v6"/>',
  surfaces: '<path d="M2 8h20v3H2zM4 11v10M20 11v10M8 11v4h8v-4"/>',
  decor: '<rect x="4" y="3" width="16" height="13" rx="1"/><path d="M4 13l5-4 4 3 3-2 4 3M12 16v5M9 21h6"/>',
  electronics: '<rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M8 21h8M12 17v4"/>',
  appliances: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M5 9h14M8 5v2M8 12v4"/>',
  plumbing: '<path d="M4 12h16v2a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6zM6 12V5a2 2 0 0 1 4 0M8 20l-1 2M16 20l1 2"/>',
  lighting: '<path d="M9 18h6M10 21h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
  misc: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M10 7h4M10 12.5h4M10 17.5h4"/>',
  all: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  wants: '<circle cx="12" cy="12" r="9"/><path d="M12 6.5l1.6 3.3 3.6.5-2.6 2.5.6 3.6L12 14.7l-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/><circle cx="12" cy="12" r="7"/>',
  stairs: '<path d="M3 21h5v-5h5v-5h5V6h3"/><path d="M3 21V17M8 16v-4M13 11V7"/>',
  roof: '<path d="M2 13L12 4l10 9M5 11v9h14v-9"/>',
  gable: '<path d="M3 18L12 6l9 12z"/>',
  hip: '<path d="M2 18l6-10h8l6 10z"/>',
  flat: '<path d="M3 11h18v7H3z"/>',
  sfx: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h8V3M8 21v-7h8v7"/>',
  edge: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12H3M5 10l-2 2 2 2M16 12h5M19 10l2 2-2 2"/>',
  // камера
  camUp: '<path d="M4 20V8l8-5 8 5v12"/>',
  level: '<path d="M4 20h16M4 14h16M4 8h16"/>',
};

export const ico = (n, s = 18, cls = '') =>
  `<svg class="ic ${cls}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ''}</svg>`;

// Эмодзи предметов каталога — быстрый узнаваемый значок на карточке/в очереди
export const OBJ_EMOJI = {
  fridge: '🧊', stove: '🍳', counter: '🗄️', kitchen_sink: '🚰', dining_table: '🍽️', dining_chair: '🪑', trash_can: '🗑️',
  sofa: '🛋️', armchair: '💺', coffee_table: '☕', tv: '📺', stereo: '📻', bookshelf: '📚', computer_desk: '💻', chess: '♟️', phone: '☎️',
  bed_single: '🛏️', bed_double: '🛏️', dresser: '🧺', mirror: '🪞', toilet: '🚽', shower: '🚿', bathtub: '🛁', bath_sink: '🧼',
  floor_lamp: '💡', painting: '🖼️', plant: '🪴', rug: '🟫', mailbox: '📬', door: '🚪', window: '🪟',
};

// Иконка действия/пузыря: имя из IC → SVG, id каталога → эмодзи, иначе — как есть (эмодзи от Мозга)
export function iconHtml(icon, s = 18) {
  if (!icon) return ico('hand', s);
  if (IC[icon]) return ico(icon, s);
  if (OBJ_EMOJI[icon]) return `<span class="emo" style="font-size:${Math.round(s * 0.9)}px">${OBJ_EMOJI[icon]}</span>`;
  return `<span class="emo" style="font-size:${Math.round(s * 0.9)}px">${String(icon).replace(/[<>&"]/g, '')}</span>`;
}

// Подписи и иконки групп
export const MOTIVE_UI = {
  hunger: ['Голод', 'hunger'], comfort: ['Комфорт', 'comfort'], hygiene: ['Гигиена', 'hygiene'], bladder: ['Туалет', 'bladder'],
  energy: ['Бодрость', 'energy'], fun: ['Веселье', 'fun'], social: ['Общение', 'social'], room: ['Комната', 'room'],
};
export const SKILL_UI = {
  cooking: ['Готовка', 'cooking'], mechanical: ['Техника', 'mechanical'], charisma: ['Обаяние', 'charisma'],
  body: ['Тело', 'body'], logic: ['Логика', 'logic'], creativity: ['Творчество', 'creativity'],
};
export const TRAIT_UI = {
  neat: ['Аккуратность', 'neat'], outgoing: ['Общительность', 'outgoing'], active: ['Активность', 'active'],
  playful: ['Игривость', 'playful'], nice: ['Доброта', 'nice'],
};
export const CAT_UI = {
  all: 'Всё', seating: 'Сидеть/лежать', surfaces: 'Поверхности', decor: 'Декор', electronics: 'Электроника',
  appliances: 'Техника', plumbing: 'Сантехника', lighting: 'Свет', misc: 'Разное',
};
