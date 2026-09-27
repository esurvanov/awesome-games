// Мелочи интерфейса: экранирование, ступени знакомства, портрет-иконка по look, нормализация чисел симуляции.
'use strict';
L.def('ui/dom', () => {
const { ic } = L.use('ui/icons');
const { clamp, hash01 } = L.use('core');

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => Math.round(n || 0).toString();
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

// ступени знакомства 0..5 (plan.md: видел, поздоровался, поговорили, общая тема, контакт, договорились)
const STEPS = [
  { icon: 'eye', t: 'Видел' },
  { icon: 'wave', t: 'Привет' },
  { icon: 'chat', t: 'Поговорили' },
  { icon: 'spark', t: 'Общая тема' },
  { icon: 'phone', t: 'Контакт' },
  { icon: 'handshake', t: 'Договорились' },
];
const dots = (step, cls = '') => `<span class="dots ${cls}" data-s="${step | 0}">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= step ? 'on s' + i : ''}"></i>`).join('')}</span>`;
// цепочка ступеней с иконками
const ladder = step => `<div class="ladder">${STEPS.map((s, i) =>
  `<span class="lstep ${i <= step ? 'on s' + i : ''} ${i === step ? 'cur' : ''}" title="${s.t}">${ic(s.icon, 's')}</span>`).join('<b class="lline"></b>')}</div>`;

// числа симуляции — в шкале 0..1 (силы); симпатия rapport −0.3..1 → 0..1 для полоски теплоты
const unit = v => clamp(+v || 0, 0, 1);
const warm = v => clamp(((+v || 0) + 0.3) / 1.3, 0, 1);

// цвета из look: число THREE (0xrrggbb) или строка
const col = (c, d) => typeof c === 'number' ? '#' + (c >>> 0).toString(16).padStart(6, '0') : (typeof c === 'string' && c ? c : d);
const SKINS = ['#f1c7a5', '#e0ac85', '#c98e66', '#a86d4b', '#f5d5bb'];
const HAIRS = ['#2b1d16', '#5a3a22', '#8a5a2b', '#c9a15a', '#1c1c1c', '#9a9a9a'];
const STYLE_COL = { it: '#3f5fb0', smart: '#e9e1d2', sport: '#2f9a74', party: '#d94a8c' };
const hs = s => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) | 0; return h; };

// смесь двух цветов '#rrggbb'
const mixHex = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const c = s => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return '#' + ((1 << 24) | (c(16) << 16) | (c(8) << 8) | c(0)).toString(16).slice(1);
};
const isHex = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
// причёски/бороды/одежда render/people — тем же набором, что у 3D-фигуры
const HAIR_BACK = {
  long: '<path d="M13 21c0 5-.5 11-1.5 16h25c-1-5-1.5-11-1.5-16z"/>',
  bob: '<path d="M13.2 21c0 4-.3 8-1 10.5 2 1 4.5 1 6.5.5V21zM34.8 21c0 4 .3 8 1 10.5-2 1-4.5 1-6.5.5V21z"/>',
  ponytail: '<path d="M33 19c4 1 5.5 6 4.5 12-.4 2.5-1.8 4-3.3 4.5 1-4 .8-9-1.2-12z"/>',
};
const HAIR_FRONT = {
  short: '<path d="M14 21c0-7 4.5-10 10-10s10 3 10 10c-2-3-5-4.5-10-4.5S16 18 14 21z"/>',
  buzz: '<path d="M15 20.5c0-6 4-9.5 9-9.5s9 3.5 9 9.5c-2-2.6-5-3.8-9-3.8s-7 1.2-9 3.8z" opacity=".8"/>',
  messy: '<path d="M14 21c0-7 4.5-10 10-10s10 3 10 10c-2-3-5-4.5-10-4.5S16 18 14 21zM15.5 14l.5-4.5 3 2.5 1.5-4 2.5 3.5 2-4 2 4 2.5-3 1 4 3.5-1-2 4.5z"/>',
  curly: '<path d="M13 23c-2-4 0-8 3-9 0-3 3-5 6-4 2-2 6-2 7 1 3 0 5 3 4 6 2 1 2 4 1 6-2-3-5-5-10-5s-8 2-11 5z"/>',
  long: '<path d="M13 32V21c0-7 5-10.5 11-10.5S35 14 35 21v11l-4-1V21c-2-2.5-4.5-3.5-7-3.5s-5 1-7 3.5v10z"/>',
  bob: '<path d="M13.2 30V21c0-7 5-10.5 10.8-10.5S34.8 14 34.8 21v9l-3.3.5V21.5c-2-3-4.5-4-7.5-4s-5.5 1-7.5 4v9z"/>',
  ponytail: '<path d="M14 21c0-7 4.5-10 10-10s10 3 10 10c-2-3.2-5-4.5-10-4.5S16 17.8 14 21z"/>',
  bun: '<path d="M14 21c0-7 4.5-10 10-10s10 3 10 10c-2-3-5-4.5-10-4.5S16 18 14 21z"/><circle cx="24" cy="9" r="4"/>',
  balding: '<path d="M14.6 25c-.6-2.5-.4-5 .8-6.8l1.5 1c-.8 1.6-1 3.5-.6 5.6zM33.4 25c.6-2.5.4-5-.8-6.8l-1.5 1c.8 1.6 1 3.5.6 5.6z"/>',
  bald: '',
};
// подсказки старой анкеты ('short'…) → стиль 3D
const HAIR_ALIAS = { short: 'short', buzz: 'buzz', messy: 'messy', long: 'long', bob: 'bob', ponytail: 'ponytail', bun: 'bun', curly: 'curly', bald: 'bald', balding: 'balding' };

// портрет-иконка: круглый медальон с головой, причёской, бородой, очками, головным убором и воротом одежды
function face(look = {}, size = 48, seed = '') {
  look = look || {};
  const k = hs(seed || look.id || JSON.stringify(look).slice(0, 40));
  const r = i => hash01(k, i);
  const sex = look.sex || (r(1) < 0.5 ? 'm' : 'f');
  const skin = col(look.skin ?? look.colors?.skin, SKINS[(r(2) * SKINS.length) | 0]);
  // look — подсказки анкеты ({ hair:'short', beard, glasses:bool }) или полный look из render/looks
  // ({ hair:{ style, color, grey }, beard:'short'|'goatee'…, glasses:'round'|null, top:{ kind, color, accent }, hat }) — портрет как у 3D-фигуры
  const H = typeof look.hair === 'object' && look.hair ? look.hair : null;
  let hairC = col(look.hairColor ?? H?.color ?? look.colors?.hair, HAIRS[(r(3) * (seed === 'me' ? 4 : HAIRS.length)) | 0]);
  const grey = +(H?.grey || 0);
  if (grey > 0 && isHex(hairC)) hairC = mixHex(hairC, '#c9c6c2', Math.min(1, grey) * 0.6);
  const hs0 = H ? H.style : typeof look.hair === 'string' ? look.hair : look.hairStyle;
  const hair = HAIR_ALIAS[hs0] || (sex === 'f' ? ['long', 'bun', 'curly'][(r(4) * 3) | 0] : ['short', 'short', 'bald', 'curly'][(r(4) * 4) | 0]);
  const beard = look.beard === true ? 'full' : look.beard ? String(look.beard) : (sex === 'm' && r(5) < 0.35 ? 'stubble' : 'none');
  const beardC = isHex(look.beardColor) ? look.beardColor : hairC;
  const glasses = 'glasses' in look ? (look.glasses === true ? 'square' : look.glasses || null) : r(6) < 0.25 ? 'square' : null;
  const T = look.top && typeof look.top === 'object' ? look.top : null;
  const top = col(look.shirt ?? (T ? T.color : look.top) ?? look.colors?.top, STYLE_COL[look.style] || ['#3f5fb0', '#2f9a74', '#d94a8c', '#b7692f', '#555'][(r(7) * 5) | 0]);
  const acc = col(T?.accent, '#e8e4dc'), acc2 = col(T?.accent2, acc);
  const kind = T?.kind || '';
  const hat = look.hat && typeof look.hat === 'object' ? look.hat : null;
  const hatC = hat ? col(hat.color, '#2b2b2b') : '';
  const dark = isHex(top) ? mixHex(top, '#000000', 0.35) : top;
  // плечи по телосложению
  const sh = { thin: 'M10 48c1-8 6.5-12 14-12s13 4 14 12z', stocky: 'M6.5 48c1-8 7.5-12.3 17.5-12.3S40.5 40 41.5 48z',
    heavy: 'M5 48c1-8 8-12.5 19-12.5S42 40 43 48z' }[look.build] || 'M8 48c1-8 7-12 16-12s15 4 16 12z';
  // одежда: ворот и узор — как у 3D
  const cloth = {
    tee: `<path d="M20 36.3q4 3.2 8 0" fill="none" stroke="${dark}" stroke-width="1.2"/>`,
    sweat: `<path d="M19.5 36.5q4.5 3.4 9 0" fill="none" stroke="${dark}" stroke-width="2"/>`,
    teePrint: `<path d="M20 36.3q4 3.2 8 0" fill="none" stroke="${dark}" stroke-width="1.2"/><circle cx="24" cy="43.5" r="3" fill="${acc}"/>`,
    hoodie: `<path d="M14.5 39c2-3.4 5.3-4.6 9.5-4.6s7.5 1.2 9.5 4.6l-3 1.6c-1.5-2.2-3.7-3.2-6.5-3.2s-5 1-6.5 3.2z" fill="${dark}"/><path d="M22 39.5v5M26 39.5v5" stroke="${acc}" stroke-width="1"/>`,
    polo: `<path d="M19.5 35.8l4.5 3-2.6 3.2zM28.5 35.8l-4.5 3 2.6 3.2z" fill="${dark}"/><path d="M24 39v4" stroke="${dark}" stroke-width="1"/>`,
    blazer: `<path d="M20 36l4 12 4-12z" fill="${acc}"/><path d="M20 36l-2.5 5 3.5 1.5L24 48M28 36l2.5 5-3.5 1.5L24 48" fill="none" stroke="${dark}" stroke-width="1.3"/>`,
    vest: `<path d="M19.5 36l4.5 12 4.5-12z" fill="${acc}"/><path d="M13 43h4v3h-4zM31 43h4v3h-4z" fill="${dark}"/>`,
    dress: `<path d="M19 36.2q5 5.5 10 0" fill="${skin}"/>`,
    stripes: `<g stroke="${acc}" stroke-width="1.4" opacity=".75"><path d="M12.5 41h23M10 44.3h28M8.6 47.4h30.8"/></g>`,
    check: `<g stroke="${acc}" stroke-width="1.3" opacity=".45"><path d="M12.5 41h23M10 45h28M16 38.5V48M24 37V48M32 38.5V48"/></g>`,
    pattern: `<circle cx="15" cy="43" r="1.6" fill="${acc}"/><circle cx="21" cy="46" r="1.6" fill="${acc2}"/><circle cx="29" cy="42" r="1.6" fill="${acc}"/><circle cx="34" cy="46" r="1.6" fill="${acc2}"/><circle cx="24" cy="40.5" r="1.3" fill="${acc2}"/>`,
  }[kind] || '';
  const beardPath = {
    full: `<path d="M15.5 24c0 7 3.6 11.5 8.5 11.5s8.5-4.5 8.5-11.5c-2 2.5-5 3.5-8.5 3.5s-6.5-1-8.5-3.5z" fill="${beardC}"/>`,
    short: `<path d="M16 25.5c0 5 3.5 8.5 8 8.5s8-3.5 8-8.5c-2 2-5 2.8-8 2.8s-6-.8-8-2.8z" fill="${beardC}"/>`,
    stubble: `<path d="M15.5 24c0 7 4 11 8.5 11s8.5-4 8.5-11c-1 3-3 4.5-4 4.5-1.5-1.5-3-1.5-4.5-1.5s-3 0-4.5 1.5c-1 0-3-1.5-4-4.5z" fill="${beardC}" opacity=".42"/>`,
    goatee: `<path d="M21.8 30.6h4.4l-.6 3.8h-3.2z" fill="${beardC}"/>`,
  }[beard] || '';
  const must = beard === 'mustache' || beard === 'short' || beard === 'full' || beard === 'goatee'
    ? `<path d="M19.6 29.4c1.6-1.4 3.3-1.4 4.4-.5 1.1-.9 2.8-.9 4.4.5-1.6.9-3.1 1-4.4.3-1.3.7-2.8.6-4.4-.3z" fill="${beardC}"/>` : '';
  const gl = glasses === 'round' ? `<g fill="none" stroke="#3a2a20" stroke-width="1.4"><circle cx="20" cy="24" r="3"/><circle cx="28" cy="24" r="3"/><path d="M23 24h2"/></g>`
    : glasses === 'thin' ? `<g fill="none" stroke="#c9a85e" stroke-width=".9"><circle cx="20" cy="24" r="2.8"/><circle cx="28" cy="24" r="2.8"/><path d="M22.8 24h2.4"/></g>`
    : glasses ? `<g fill="none" stroke="#161616" stroke-width="1.5"><rect x="16.6" y="21.8" width="6.6" height="4.6" rx="1"/><rect x="24.8" y="21.8" width="6.6" height="4.6" rx="1"/><path d="M23.2 23.6h1.6"/></g>` : '';
  const hatSvg = !hat ? '' : hat.kind === 'beanie'
    ? `<path d="M13.6 20.5c0-7.5 4.6-11.5 10.4-11.5s10.4 4 10.4 11.5z" fill="${hatC}"/><rect x="13.3" y="17.3" width="21.4" height="4" rx="1.6" fill="${mixHex(hatC, '#000000', 0.25)}"/><circle cx="24" cy="8.5" r="2.6" fill="#fff"/>`
    : hat.kind === 'fedora'
    ? `<path d="M16.5 16l1-7.5q6.5-3 13 0l1 7.5z" fill="${hatC}"/><rect x="16.8" y="13.2" width="14.4" height="2.3" fill="#7a2e36"/><ellipse cx="24" cy="16.3" rx="15" ry="2.4" fill="${hatC}"/>`
    : `<path d="M14.2 19.5c0-6.5 4.3-9.8 9.8-9.8s9.8 3.3 9.8 9.8z" fill="${hatC}"/>${hat.kind === 'capBack'
      ? `<rect x="21.5" y="17.6" width="5" height="2" rx="1" fill="${mixHex(hatC, '#000000', 0.3)}"/>`
      : `<ellipse cx="24" cy="19.6" rx="11.5" ry="2.3" fill="${mixHex(hatC, '#000000', 0.2)}"/>`}`;
  const noTop = hat && hat.kind !== 'capBack'; // под шапкой видно только края
  const hairF = noTop ? (hair === 'long' || hair === 'bob' || hair === 'curly' ? HAIR_FRONT.bob : hair === 'bald' || hair === 'buzz' || hair === 'balding' ? '' : HAIR_FRONT.balding) : HAIR_FRONT[hair];
  const ear = look.earrings ? `<circle cx="15" cy="28" r="1.1" fill="#e8c060"/><circle cx="33" cy="28" r="1.1" fill="#e8c060"/>` : '';
  const skD = isHex(skin) ? mixHex(skin, '#000000', 0.12) : skin;
  return `<svg class="face" viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="24" cy="24" r="24" fill="#2a1719"/>
    <g fill="${hairC}">${HAIR_BACK[hair] || ''}</g>
    <path d="${sh}" fill="${top}"/>${cloth}
    <rect x="21" y="30" width="6" height="${kind === 'dress' ? 7.5 : 6.5}" fill="${skD}"/>
    <ellipse cx="15" cy="24.5" rx="1.6" ry="2.4" fill="${skD}"/><ellipse cx="33" cy="24.5" rx="1.6" ry="2.4" fill="${skD}"/>
    <ellipse cx="24" cy="23" rx="9" ry="10.5" fill="${skin}"/>
    <g fill="${hairC}">${hairF || ''}</g>${beardPath}${must}
    <circle cx="20.5" cy="24" r="1.1" fill="#1a1010"/><circle cx="27.5" cy="24" r="1.1" fill="#1a1010"/>
    ${beard === 'full' || beard === 'short' ? '' : `<path d="M22 30.6q2 1.2 4 0" fill="none" stroke="#6a3a30" stroke-width=".9" stroke-linecap="round"/>`}${gl}${ear}${hatSvg}
  </svg>`;
}
// цвет-метка по имени (аватарки чата)
const tint = s => `hsl(${(Math.abs(hs(s)) % 360)} 60% 55%)`;

return { esc, fmt, el, STEPS, dots, ladder, unit, warm, face, tint, hs, mixHex };
});
