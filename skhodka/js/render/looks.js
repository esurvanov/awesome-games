// ═══ ВНЕШНОСТЬ ЛЮДЕЙ ═══
// makeLook(rng, hints) → look: чистые данные (строки, числа, цвета '#rrggbb'), без THREE и DOM —
// поэтому часть грузится и в Node. По look render/people строит человечка; одинаковый rng → одинаковый look.
//
// Публика: IT-релоканты 25–45, в основном футболки, худи, рубашки; очки, бороды, короткие стрижки;
// женщин примерно треть. hints: { sex:'m'|'f', age, style:'it'|'smart'|'sport'|'party', prop, oddball }.
// oddball — строка-id («photographer», «karaoke», «patron», «fivejobs», «sax», «cat», «tea» и т. п.,
// узнаётся по ключевым словам) или объект { id, ...поля look для замены } — яркая примета издалека.
'use strict';
L.def('render/looks', () => {

// ---------- палитры ----------
const SKIN = ['#f3d2bd', '#eec4a8', '#e8b896', '#dcaa86', '#d19c78', '#c68b66', '#b07550', '#8e5a3c'];
const SKIN_W = [3, 5, 5, 4, 3, 2, 1, 0.5];
const HAIR = { black: '#1a1614', dark: '#33231a', brown: '#4e3120', light: '#6e4a2c', blond: '#d6b25e', red: '#8f3a1a', grey: '#a8a4a0', white: '#dedad4' };
const HAIR_W = { black: 4, dark: 6, brown: 5, light: 2.5, blond: 1.5, red: 0.8 };
const DYE = ['#e0679a', '#6a8de0', '#9b6ad6', '#e08a3a'];
// одежда: приглушённые «айтишные» + яркие для вечеринки
const CALM = ['#2d3142', '#3c4a5c', '#4a5a4a', '#5a4636', '#2b2b2b', '#6b6f78', '#e8e4dc', '#3f5f7f', '#7a2e36', '#556b2f', '#8a7a64', '#284b63', '#c8c2b4', '#1f3a5a'];
const BRIGHT = ['#e8553d', '#f2b134', '#2ea3a8', '#d64b8a', '#5c7cfa', '#3fb55f', '#ff8c42', '#9b5de5', '#f15bb5', '#00b4d8'];
const PASTEL = ['#f4c7c3', '#c6dbef', '#d9ead3', '#fff2cc', '#e4d1f0', '#f9d9b8', '#cfe8e5'];
const DENIM = ['#2f4a6d', '#3a5a82', '#243650', '#4d6a8f', '#1f2a3a'];
const PANTS = ['#2b2b2b', '#3a3a40', '#5a4e3c', '#6b6353', '#2f3b2f', '#7a6e5a', '#1c2230'];
const SHOES = ['#1e1e1e', '#efefef', '#6b4a2e', '#3a3a3a', '#d8d2c6', '#8a2b2b', '#2b3f66'];
const PRINTS = ['#f2b134', '#e8553d', '#2ea3a8', '#ffffff', '#5c7cfa', '#3fb55f', '#d64b8a'];

const PROPS = [null, 'beer', 'phone', 'camera', 'mic', 'tray', 'laptop', 'teapot', 'sax', 'cat-photo'];

// одежда по стилю: [вид, вес]
const TOPS = {
  it:    { tee: 5, teePrint: 5, hoodie: 4, sweat: 2, check: 2, stripes: 1, polo: 1, pattern: 0.5 },
  smart: { stripes: 4, pattern: 2, check: 1, polo: 2, blazer: 3, tee: 1, sweat: 1 },
  sport: { tee: 4, teePrint: 2, hoodie: 4, polo: 3, sweat: 2 },
  party: { pattern: 4, teePrint: 3, tee: 2, stripes: 1, blazer: 1, hoodie: 1 },
};
const TOPS_F = { // поправки для женщин: платья, меньше клетки
  it:    { dress: 1, check: -1 },
  smart: { dress: 3, check: -0.5 },
  sport: { dress: 0 },
  party: { dress: 4 },
};

const pickW = (rng, obj) => rng.weighted(Object.keys(obj).filter(k => obj[k] > 0), k => obj[k]);

// смесь двух цветов '#rrggbb'
function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const c = s => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return '#' + ((1 << 24) | (c(16) << 16) | (c(8) << 8) | c(0)).toString(16).slice(1);
}

// ---------- чудики: примета издалека ----------
// ключ → поправки к look. Сопоставление по ключевым словам id (id задаёт сценарий).
const ODD = [
  { re: /photo|фото|camera/i, id: 'photographer',
    set: { prop: 'camera', top: { kind: 'vest', color: '#7a6a45', accent: '#2b2b2b' }, hat: { kind: 'capBack', color: '#2b2b2b' } } },
  { re: /karaoke|sing|караок|mic/i, id: 'karaoke',
    set: { prop: 'mic', top: { kind: 'pattern', color: '#ff4fa3', accent: '#ffd23f', accent2: '#3ec9d6' } } },
  { re: /patron|mecen|меценат|sushi|суши|tray/i, id: 'patron',
    set: { prop: 'tray', top: { kind: 'blazer', color: '#efe9dc', accent: '#b0263a' }, glasses: 'round' } },
  { re: /five|jobs|пятираб|laptop|ноут/i, id: 'fivejobs',
    set: { prop: 'laptop', top: { kind: 'hoodie', color: '#f2b134', accent: '#2b2b2b' }, hair: { style: 'messy' } } },
  { re: /sax|сакс/i, id: 'sax',
    set: { prop: 'sax', top: { kind: 'blazer', color: '#1c1c24', accent: '#e8e4dc' }, hat: { kind: 'fedora', color: '#2b2b2b' } } },
  { re: /cat|кот|кош/i, id: 'cat',
    set: { prop: 'cat-photo', top: { kind: 'teePrint', color: '#9b5de5', accent: '#ffffff' } } },
  { re: /tea|чай/i, id: 'tea',
    set: { prop: 'teapot', top: { kind: 'sweat', color: '#2ea3a8', accent: '#e8e4dc' }, hat: { kind: 'beanie', color: '#e8553d' } } },
];

// ---------- главное ----------
function makeLook(rng, hints = {}) {
  const sex = hints.sex || (rng.chance(0.34) ? 'f' : 'm');
  const f = sex === 'f';
  const age = hints.age ?? Math.round(rng.range(24, 46));
  const style = TOPS[hints.style] ? hints.style : rng.weighted(['it', 'smart', 'sport', 'party'], s => ({ it: 6, smart: 2, sport: 1.5, party: 1 })[s]);

  // рост и телосложение
  const height = Math.max(1.55, Math.min(1.95, f ? rng.range(1.57, 1.78) : rng.range(1.68, 1.94)));
  const build = rng.weighted(['thin', 'avg', 'stocky', 'heavy'], b => ({ thin: 2, avg: 5, stocky: 2.5, heavy: age > 32 ? 1.8 : 1 })[b]);
  const skin = rng.weighted(SKIN, c => SKIN_W[SKIN.indexOf(c)]);

  // волосы: седина с возрастом, лысина у мужчин постарше
  let hairKey = pickW(rng, HAIR_W);
  let color = HAIR[hairKey];
  if (f && style === 'party' && rng.chance(0.3)) color = rng.pick(DYE);
  const grey = age > 34 ? Math.min(0.7, (age - 34) / 16 * rng.next()) : 0;
  const hairStyle = f
    ? rng.weighted(['long', 'ponytail', 'bob', 'bun', 'curly', 'short'], s => ({ long: 5, ponytail: 3, bob: 3, bun: 2, curly: 1.5, short: 1 })[s])
    : rng.weighted(['short', 'buzz', 'bald', 'balding', 'curly', 'long', 'messy', 'ponytail'],
        s => ({ short: 8, buzz: 3, bald: age > 33 ? 1.5 : 0.3, balding: age > 30 ? 2 : 0.5, curly: 1.2, long: 0.7, messy: 1.5, ponytail: 0.5 })[s]);
  const hair = { style: hairStyle, color, grey: +grey.toFixed(2) };

  // борода: почти половина мужчин
  const beard = f ? 'none' : rng.weighted(['none', 'stubble', 'short', 'full', 'mustache', 'goatee'],
    b => ({ none: 4, stubble: 3, short: 2.5, full: 1.5, mustache: 0.4, goatee: 0.6 })[b]);
  const beardColor = mix(color === HAIR.blond ? HAIR.light : color, HAIR.grey, grey * 0.8);

  // очки: айтишники — часто
  const glasses = rng.chance(style === 'it' ? 0.42 : 0.28) ? rng.pick(['round', 'square', 'square', 'thin']) : null;

  // верх
  const tw = { ...TOPS[style] };
  if (f) for (const [k, v] of Object.entries(TOPS_F[style])) tw[k] = (tw[k] || 0) + v;
  const kind = pickW(rng, tw);
  const pal = style === 'party' ? BRIGHT : style === 'sport' ? (rng.chance(0.5) ? BRIGHT : CALM) : (rng.chance(0.8) ? CALM : BRIGHT);
  let topColor = rng.pick(pal);
  let accent = rng.pick(kind === 'teePrint' ? PRINTS : kind === 'stripes' ? ['#ffffff', '#e8e4dc', '#c6dbef'] : BRIGHT);
  if (kind === 'stripes') topColor = rng.pick(['#3f5f7f', '#1f3a5a', '#7a2e36', '#5a6b8a', '#2b2b2b']);
  if (kind === 'pattern' && style !== 'party') topColor = rng.pick([...CALM, ...PASTEL]);
  if (kind === 'dress') topColor = rng.pick([...CALM, ...BRIGHT, '#1a1a1a', '#7a2e36']);
  if (kind === 'blazer') { topColor = rng.pick(['#2b2b2b', '#3c4a5c', '#5a4636', '#6b6f78', '#1f3a5a', '#c8c2b4']); accent = rng.pick(['#e8e4dc', '#2b2b2b', '#f2f2f2', rng.pick(BRIGHT)]); }
  if (accent === topColor) accent = '#ffffff';
  const top = { kind, color: topColor, accent, accent2: rng.pick(PRINTS) };

  // низ
  const bottom = kind === 'dress' ? { kind: 'legs', color: rng.chance(0.5) ? '#2b2b2b' : skin }
    : style === 'sport' && rng.chance(0.35) ? { kind: 'shorts', color: rng.pick(PANTS) }
    : f && rng.chance(0.2) ? { kind: 'skirt', color: rng.pick([...PANTS, '#7a2e36']) }
    : rng.chance(0.6) ? { kind: 'jeans', color: rng.pick(DENIM) }
    : { kind: 'chinos', color: rng.pick(PANTS) };
  const shoes = rng.pick(SHOES);

  // головной убор, аксессуары
  const hat = hairStyle !== 'bun' && rng.chance(style === 'sport' ? 0.3 : 0.07)
    ? { kind: rng.chance(0.8) ? 'cap' : 'capBack', color: rng.pick([...CALM, ...BRIGHT]) } : null;
  const watch = rng.chance(0.4);
  const earrings = f ? rng.chance(0.5) : rng.chance(0.06);
  const lanyard = style === 'it' && rng.chance(0.08);

  const look = {
    sex, age, height: +height.toFixed(2), build, skin, hair, beard, beardColor, glasses, top, bottom, shoes,
    hat, watch, earrings, lanyard, prop: null, oddball: null, style, seed: Math.floor(rng.next() * 1e9),
  };

  // проп: из подсказки, иначе иногда пиво/телефон
  if (hints.prop !== undefined) look.prop = PROPS.includes(hints.prop) ? hints.prop : null;
  else look.prop = rng.weighted([null, 'beer', 'phone'], p => ({ null: 6, beer: 2.5, phone: 1.5 })[p]);

  // чудик
  if (hints.oddball) applyOddball(look, hints.oddball, rng);
  if (hints.look) deepSet(look, hints.look);
  return look;
}

function applyOddball(look, odd, rng) {
  const id = typeof odd === 'string' ? odd : (odd.id || '');
  const o = ODD.find(o => o.re.test(id));
  if (o) deepSet(look, o.set);
  else { // незнакомый чудик: яркий верх + шапка
    deepSet(look, { top: { kind: 'pattern', color: rng.pick(BRIGHT), accent: rng.pick(BRIGHT) }, hat: { kind: 'beanie', color: rng.pick(BRIGHT) } });
  }
  if (typeof odd === 'object') { const { id: _, ...rest } = odd; deepSet(look, rest); }
  look.oddball = o ? o.id : (id || 'odd');
  if (look.hat && (look.hair.style === 'bun' || look.hair.style === 'long')) look.hair.style = 'short';
}

function deepSet(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object') deepSet(dst[k], v);
    else dst[k] = v;
  }
  return dst;
}

// ---------- анкета игрока: всё, что умеет нарисовать render/people ----------
// Варианты полей для выбора внешности + tidy(look) — пересчёт производных полей (цвет бороды, акцент одежды,
// стиль) после ручной правки. Игрок выбирает полный look, main отдаёт его в makeLook через hints.look.
const OPTS = {
  sex: ['m', 'f'],
  height: [1.6, 1.68, 1.76, 1.84, 1.92],
  build: ['thin', 'avg', 'stocky', 'heavy'],
  skin: SKIN,
  hair: ['short', 'buzz', 'messy', 'curly', 'long', 'bob', 'ponytail', 'bun', 'balding', 'bald'],
  hairColor: [HAIR.black, HAIR.dark, HAIR.brown, HAIR.light, HAIR.blond, HAIR.red, HAIR.white, ...DYE],
  grey: [0, 0.3, 0.6, 1],
  beard: ['none', 'stubble', 'short', 'full', 'mustache', 'goatee'],
  glasses: [null, 'round', 'square', 'thin'],
  hat: [null, 'cap', 'capBack', 'beanie', 'fedora'],
  hatColor: ['#2b2b2b', '#e8e4dc', '#1f3a5a', '#556b2f', '#8a7a64', '#e8553d', '#f2b134', '#2ea3a8', '#d64b8a', '#5c7cfa'],
  top: ['tee', 'teePrint', 'hoodie', 'sweat', 'polo', 'check', 'stripes', 'pattern', 'blazer', 'vest', 'dress'],
  topColor: ['#2b2b2b', '#e8e4dc', '#6b6f78', '#3c4a5c', '#1f3a5a', '#3f5f7f', '#556b2f', '#7a2e36', '#8a7a64',
    '#e8553d', '#f2b134', '#2ea3a8', '#d64b8a', '#5c7cfa', '#9b5de5', '#f4c7c3'],
  bottom: ['jeans', 'chinos', 'shorts', 'skirt', 'legs'],
  bottomColor: ['#2f4a6d', '#4d6a8f', '#1f2a3a', '#2b2b2b', '#5a4e3c', '#7a6e5a', '#2f3b2f', '#7a2e36', '#d8d2c6'],
  shoes: SHOES,
  extras: ['watch', 'earrings', 'lanyard'],
};
const STYLE_OF = { tee: 'it', teePrint: 'it', hoodie: 'it', sweat: 'it', polo: 'sport', check: 'smart', stripes: 'smart',
  pattern: 'party', blazer: 'smart', vest: 'it', dress: 'party' };
const lum = c => { const p = parseInt(c.slice(1), 16); return (0.3 * (p >> 16) + 0.59 * ((p >> 8) & 255) + 0.11 * (p & 255)) / 255; };
function tidy(look) {
  const h = look.hair, t = look.top;
  h.grey = +(+h.grey || 0).toFixed(2);
  look.beardColor = mix(h.color === HAIR.blond ? HAIR.light : h.color, HAIR.grey, Math.min(1, h.grey) * 0.8);
  const light = lum(t.color) > 0.55, hi = parseInt(t.color.slice(1), 16) % PRINTS.length;
  t.accent = t.kind === 'teePrint' || t.kind === 'pattern' ? (PRINTS[hi] === t.color ? '#ffffff' : PRINTS[hi])
    : t.kind === 'stripes' || t.kind === 'blazer' || t.kind === 'hoodie' || t.kind === 'check' ? (light ? '#2b2b2b' : '#e8e4dc')
    : t.kind === 'vest' ? (light ? '#3c4a5c' : '#e8e4dc') : (light ? '#3c4a5c' : '#ffffff');
  t.accent2 = t.kind === 'pattern' ? BRIGHT[(hi + 3) % BRIGHT.length] : t.accent;
  look.style = STYLE_OF[t.kind] || look.style || 'it';
  if (t.kind === 'dress' && look.bottom.kind !== 'legs') look.bottom = { kind: 'legs', color: '#2b2b2b' };
  return look;
}
// сохранённый look (localStorage) похож на настоящий? — иначе не верим
const hex = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
function validLook(l) {
  return !!(l && typeof l === 'object' && OPTS.sex.includes(l.sex) && hex(l.skin) && l.hair && OPTS.hair.includes(l.hair.style) && hex(l.hair.color)
    && OPTS.beard.includes(l.beard) && OPTS.glasses.includes(l.glasses ?? null) && l.top && OPTS.top.includes(l.top.kind) && hex(l.top.color)
    && l.bottom && OPTS.bottom.includes(l.bottom.kind) && hex(l.bottom.color) && hex(l.shoes) && OPTS.build.includes(l.build)
    && +l.height >= 1.55 && +l.height <= 1.95 && (!l.hat || (['cap', 'capBack', 'beanie', 'fedora'].includes(l.hat.kind) && hex(l.hat.color))));
}

return { makeLook, mix, PROPS, OPTS, tidy, validLook, HAIR };
});
