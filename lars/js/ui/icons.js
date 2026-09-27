// Иконки «Ларса»: один источник для DOM (SVG-спрайт) и канваса (Path2D). Контур 24×24, штрих 2, свои рисунки.
// DOM: ic('fuel') → '<svg class="ic"><use href="#i-fuel"/></svg>';  канвас: drawIcon(g, 'fuel', x, y, px, color)
'use strict';
L.def('ui/icons', () => {
const ICON = {
  food: 'M4 11h16a8 8 0 0 1-16 0zM7 11V9M12 11V7M17 11V9M8 21h8',
  water: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11zM9.5 15a2.5 2.5 0 0 0 2.5 2.5',
  fire: 'M12 22a7 7 0 0 0 7-7c0-4-3-6-4-9-1 2-2 3-3 3 0-2-1-4-3-6 0 4-4 6-4 12a7 7 0 0 0 7 7zM12 22a3 3 0 0 1-3-3c0-2 3-4 3-4s3 2 3 4a3 3 0 0 1-3 3z',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  heart: 'M12 20s-8-4.8-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.2 12 20 12 20z',
  battery: 'M3 8h15v8H3zM21 11v2M6 11v2M9 11v2',
  cash: 'M2 7h20v10H2zM12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM5 10v4M19 10v4',
  card: 'M2 6h20v12H2zM2 10h20M6 15h4',
  dollar: 'M12 2v20M17 6.5C16 5 14.5 4.5 12 4.5c-3 0-4.5 1.5-4.5 3.5 0 5 9.5 2.5 9.5 8 0 2-1.8 3.5-5 3.5-2.5 0-4-.8-5-2.5',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H3zM3 7l12-4v4M16 13h2',
  fuel: 'M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 10h10M14 8l3 2v7a1.5 1.5 0 0 0 3 0V9l-3-3',
  car: 'M4 16v3h3v-3M17 16v3h3v-3M3 16v-4l2-5h14l2 5v4zM3 12h18M7 14h.01M17 14h.01',
  van: 'M2 17V6h13l4 4 3 1v6zM2 11h20M6 17a2 2 0 1 0 4 0M15 17a2 2 0 1 0 4 0M15 6v5',
  bike: 'M5.5 17.5m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M18.5 17.5m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M5.5 17.5L9 9h6l3.5 8.5M9 9l3 8.5 3-8.5M13 5h3',
  scooter: 'M5 18a2 2 0 1 0 0-.01M19 18a2 2 0 1 0 0-.01M7 18h10M17 18L14 4h3',
  moto: 'M5 17a3 3 0 1 0 0-.01M19 17a3 3 0 1 0 0-.01M8 17h8l3-6h-4l-2-4H9M5 17l4-6h5',
  walk: 'M13 4a1.5 1.5 0 1 1 0-.01M9 21l2-6 3 3v3M11 15l-1-5 4-2 3 4h3M10 10l-3 3',
  user: 'M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21a8 8 0 0 1 16 0',
  child: 'M12 4a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM8 21l1.5-7h5L16 21M7 12l5-2 5 2',
  phone: 'M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18h2',
  chat: 'M4 5h16v11H9l-5 4z',
  call: 'M5 3h4l2 5-3 2a11 11 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z',
  bag: 'M5 8h14l1 13H4zM9 8V6a3 3 0 0 1 6 0v2M9 12h6',
  cart: 'M2 3h3l3 12h11l2-8H6M9 20a1 1 0 1 0 0-.01M18 20a1 1 0 1 0 0-.01',
  plug: 'M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5',
  gift: 'M3 9h18v4H3zM5 13h14v8H5zM12 9v12M12 9C10 5 7 5 7 7s3 2 5 2c2 0 5 0 5-2s-3-2-5 2',
  swap: 'M7 4v16M7 4L3 8M7 4l4 4M17 20V4M17 20l-4-4M17 20l4-4',
  arrowUp: 'M12 20V4M5 11l7-7 7 7',
  hands: 'M4 13l4-4 3 3M8 9l3-3 5 5-6 6-4-4M13 16l2 2M16 11l4-4',
  horn: 'M3 10v4h4l6 5V5L7 10zM17 9a4 4 0 0 1 0 6M19.5 6.5a8 8 0 0 1 0 11',
  snow: 'M12 2v20M4 7l16 10M20 7L4 17M9 3l3 3 3-3M9 21l3-3 3 3',
  cloud: 'M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z',
  rain: 'M7 14a4 4 0 0 1-.5-8A6 6 0 0 1 18 5a4.5 4.5 0 0 1-.5 9zM8 17l-1 3M12 17l-1 3M16 17l-1 3',
  wind: 'M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5l3 2',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 4l12 8-12 8z',
  fast: 'M4 5l8 7-8 7zM12 5l8 7-8 7z',
  faster: 'M2 5l6 7-6 7zM9 5l6 7-6 7zM16 5l6 7-6 7z',
  barrier: 'M3 21V9M3 11h18M3 15h18M7 11l-2 4M12 11l-2 4M17 11l-2 4M21 11v10',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  doc: 'M6 2h9l4 4v16H6zM15 2v4h4M9 12h7M9 16h7',
  door: 'M5 21V3h11v18M3 21h16M13 12h.01',
  house: 'M3 11l9-8 9 8M5 9.5V21h14V9.5M10 21v-6h4v6',
  stone: 'M3 19l3-9 5-4 6 2 4 7-2 4z',
  tower: 'M7 21V6h10v15M6 6V3h2v2h2V3h4v2h2V3h2v3M10 21v-4h4v4M11 10h2',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  bridge: 'M2 16h20M4 16v-4M20 16v-4M2 12c4-5 16-5 20 0M8 12v4M12 11v5M16 12v4',
  seller: 'M3 10l2-6h14l2 6M3 10h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0zM5 14v7h14v-7M10 21v-4h4v4',
  laptop: 'M4 5h16v11H4zM2 19h20',
  meds: 'M4 9h16v12H4zM8 9V6a4 4 0 0 1 8 0v3M12 12v6M9 15h6',
  blanket: 'M4 4h16v13l-3 3H4zM17 17v3M4 9h16M4 13h16',
  cup: 'M5 8h12v7a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5zM17 10h1.5a2.5 2.5 0 0 1 0 5H17M9 2c-1 1.5 1 2.5 0 4M13 2c-1 1.5 1 2.5 0 4',
  bread: 'M6 20h12a2 2 0 0 0 2-2V10a5 5 0 0 0-3-8.5H7A5 5 0 0 0 4 10v8a2 2 0 0 0 2 2zM9 7l-1 2M13 7l-1 2M17 7l-1 2',
  choco: 'M6 3h12v18H6zM6 9h12M6 15h12M12 3v18',
  cigs: 'M2 14h14v4H2zM16 14h2v4h-2zM20 14v4M18 10c0-2 2-2 2-4M21 10c0-2 1-3 1-4',
  sim: 'M6 2h8l4 4v16H6zM9 11h6v7H9zM12 11v7M9 14.5h6',
  siren: 'M6 18v-6a6 6 0 0 1 12 0v6M4 21h16M4 18h16M12 2v2M3 7l1.5 1M21 7l-1.5 1',
  ear: 'M6 9a6 6 0 0 1 12 0c0 4-4 5-4 8a3 3 0 0 1-6 1M10 9a2 2 0 0 1 4 0c0 1.5-2 2-2 3',
  handshake: 'M2 11l4-4 4 2 3-2 4 1 5 3M2 11l2 2M22 11l-5 5-3-1-2 2-3-1-5-3M9 13l2 2M12 12l3 3',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  paw: 'M8 7a1.5 2 0 1 1 0-.01M16 7a1.5 2 0 1 1 0-.01M4.5 11a1.5 2 0 1 1 0-.01M19.5 11a1.5 2 0 1 1 0-.01M12 12c-3 0-6 4-5 6.5s3.5 1 5 1 4 1.5 5-1-2-6.5-5-6.5z',
  search: 'M10.5 3a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15zM16 16l5 5',
  close: 'M5 5l14 14M19 5L5 19',
  check: 'M4 12l5 5L20 6',
  save: 'M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7',
  menu: 'M4 6h16M4 12h16M4 18h16',
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  target: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 11.5v1',
  temp: 'M10 14V4a2 2 0 0 1 4 0v10a4 4 0 1 1-4 0zM12 10v7',
  people: 'M9 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM2 20a7 7 0 0 1 14 0M16 4a3 3 0 0 1 0 6M18 14a6 6 0 0 1 4 6',
  zoomIn: 'M10.5 3a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15zM16 16l5 5M7.5 10.5h6M10.5 7.5v6',
  zoomOut: 'M10.5 3a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15zM16 16l5 5M7.5 10.5h6',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  back: 'M15 5l-7 7 7 7',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
  volume: 'M4 9h4l5-4v14l-5-4H4zM16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11',
  mute: 'M4 9h4l5-4v14l-5-4H4zM16 9.5l5 5M21 9.5l-5 5',
  gear: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM10 2h4l.6 2.7 2.3 1.3 2.6-.9 2 3.5-2.1 1.8v3.2l2.1 1.8-2 3.5-2.6-.9-2.3 1.3L14 22h-4l-.6-2.7-2.3-1.3-2.6.9-2-3.5 2.1-1.8v-3.2L2.5 7.6l2-3.5 2.6.9L9.4 3.7z',
  key: 'M7.5 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM11.5 12H21M18 12v3M15 12v2',
  text: 'M4 6h16M4 12h16M4 18h10',
  chip: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3M8 21h8',
  send: 'M3 11l18-8-8 18-2-8zM11 13l10-10',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
};

function ic(id, cls = '') { return `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${ICON[id] ? id : 'star'}"/></svg>`; }
// SVG-спрайт в документ (один раз)
function mountSprite() {
  const s = Object.entries(ICON).map(([k, d]) => `<symbol id="i-${k}" viewBox="0 0 24 24"><path d="${d}"/></symbol>`).join('');
  const el = document.createElement('div');
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0" aria-hidden="true">${s}</svg>`;
  document.body.prepend(el.firstChild);
}
const P2D = {};
function drawIcon(g, id, x, y, px, color, lw = 2) {
  const d = ICON[id]; if (!d) return;
  const p = P2D[id] || (P2D[id] = new Path2D(d));
  g.save(); g.translate(x - px / 2, y - px / 2); g.scale(px / 24, px / 24);
  g.strokeStyle = color; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(p); g.restore();
}
return { ICON, ic, mountSprite, drawIcon };
});
