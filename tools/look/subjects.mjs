/* subjects.mjs — LOOK-GATE subjects: game shots (tools/look/lg-page.js) ↔ reference photos (references/img) with the crop
 * box that matches the game framing, the rubric criteria that apply, and the anti-patterns the reviewer MUST check.
 * crop = [x0, y0, x1, y1] (fractions of the photo); compose.py trims it to the game aspect around its centre.
 */
export const CRITERIA = [
  ['silhouette', '🔷', 'Silhouette / shape'],
  ['surface', '🔍', 'Surface detail scale'],
  ['lighting', '💡', 'Lighting ratio'],
  ['color', '🎨', 'Color'],
  ['motion', '🏃', 'Motion smoothness'],
  ['contact', '🦶', 'Contact plausibility'],
];
export const ANTI = {
  craters: '🕳 craters — footprints / hollows far wider or deeper than a boot / hoof',
  stripes: '🦓 uniform stripes — corduroy sastrugi / ripples with one wavelength and direction',
  cards: '🃏 card planes — flat quads visible edge-on, crossed cards, billboard swim',
  dither: '▦ dithering noise — screen-door fades, stipple, grain crawling on surfaces',
  sliding: '⛸ sliding feet — planted foot moves over the ground',
  hover: '🎈 hovering / intersecting — gap under an object, or sunk / clipping through',
  blobs: '⬛ black blobs — near-black masses with no internal shading',
  plastic: '🧴 plastic look — uniform specular sheen, no micro-variation, CG-clean',
};
// motion + contact apply only where listed; the other four always apply
export const SUBJECTS = [
  { name: 'snow_open', icon: '❄', title: 'Open snow field', shots: ['snow_open'], refs: [['a05', [0, 0.35, 1, 1]], ['a04', [0, 0.3, 1, 1]], ['h02', [0, 0.25, 1, 1]]],
    anti: ['stripes', 'dither', 'plastic', 'craters'] },
  { name: 'footprints', icon: '👣', title: 'Footprint trail + boots', shots: ['footprints', 'boots'], refs: [['c06', [0.1, 0.25, 1, 1]], ['c01', [0, 0, 1, 1]], ['c02', [0, 0, 1, 1]], ['c04', [0, 0, 1, 1]]],
    motions: ['pilot_walk'], mrefs: [['c05', [0, 0.3, 1, 0.8]]], criteria: ['motion', 'contact'], anti: ['craters', 'sliding', 'hover', 'stripes'] },
  { name: 'deep_drift', icon: '🌬', title: 'Deep drift / wind snow', shots: ['deep_drift'], refs: [['d06', [0, 0, 1, 1]], ['c05', [0, 0.35, 1, 0.85]], ['d05', [0.2, 0, 1, 1]]],
    criteria: ['contact'], anti: ['stripes', 'craters', 'hover', 'dither'] },
  { name: 'boulder', icon: '🪨', title: 'Boulder + pilot touching', shots: ['boulder'], refs: [['d01', [0, 0.3, 1, 0.95]], ['d04', [0, 0.2, 1, 1]], ['e06', [0, 0.45, 0.7, 1]]],
    motions: ['pilot_lean_boulder'], mrefs: [['d04', [0, 0.2, 1, 1]]], criteria: ['motion', 'contact'], anti: ['hover', 'plastic', 'blobs', 'dither', 'sliding'] },
  { name: 'outcrop', icon: '⛰', title: 'Rock outcrop', shots: ['outcrop'], refs: [['d03', [0, 0.25, 0.8, 1]], ['d02', [0, 0, 1, 1]]],
    criteria: ['contact'], anti: ['hover', 'plastic', 'blobs', 'cards'] },
  { name: 'ruin_wall', icon: '🧱', title: 'Ruin wall (no direct photo)', shots: ['ruin_wall'], refs: [['d03', [0, 0.35, 0.6, 1]], ['d02', [0.4, 0.2, 1, 1]], ['j05', [0, 0.4, 0.6, 1]]],
    criteria: ['contact'], anti: ['hover', 'plastic', 'blobs'] },
  { name: 'tree_close', icon: '🌲', title: 'Spruce 2 m', shots: ['tree_close'], refs: [['b06', [0, 0.15, 1, 0.75]], ['b05', [0, 0.1, 1, 0.7]], ['b01', [0, 0.35, 1, 0.95]]],
    motions: ['pilot_branch'], mrefs: [['b06', [0, 0.15, 1, 0.75]]], criteria: ['motion', 'contact'], anti: ['cards', 'blobs', 'dither', 'hover'] },
  { name: 'forest_mid', icon: '🌲', title: 'Forest edge 30 m', shots: ['forest_mid'], refs: [['b02', [0, 0, 1, 1]], ['b03', [0, 0, 1, 1]], ['b04', [0, 0, 1, 1]]],
    anti: ['cards', 'blobs', 'dither', 'stripes'] },
  { name: 'forest_far', icon: '🌌', title: 'Forest 150 m', shots: ['forest_far'], refs: [['b04', [0.35, 0, 1, 1]], ['a05', [0, 0.3, 1, 1]], ['i04', [0, 0, 1, 1]]],
    anti: ['cards', 'dither', 'blobs'] },
  { name: 'grass', icon: '🌾', title: 'Grass / heather', shots: ['grass', 'heather'], refs: [['e04', [0, 0, 1, 1]], ['e06', [0, 0.35, 1, 1]], ['e03', [0, 0, 1, 1]], ['e05', [0, 0, 1, 1]]],
    criteria: ['contact'], anti: ['cards', 'dither', 'blobs', 'hover'] },
  { name: 'stag', icon: '🦌', title: 'Stag graze + flee', shots: ['stag'], refs: [['i03', [0.2, 0.3, 1, 1]], ['i05', [0, 0.25, 1, 1]], ['i04', [0.3, 0.2, 1, 1]]],
    motions: ['stag_graze', 'stag_flee'], mrefs: [['i01', [0, 0, 1, 1]], ['i06', [0, 0, 1, 1]]], criteria: ['motion', 'contact'], anti: ['sliding', 'hover', 'plastic', 'blobs'] },
  { name: 'sea_ice', icon: '🧊', title: 'Sea ice', shots: ['sea_ice'], refs: [['g02', [0, 0, 1, 1]], ['g01', [0, 0, 1, 1]], ['g03', [0, 0, 1, 1]]],
    anti: ['plastic', 'stripes', 'hover', 'dither'] },
  { name: 'mountains', icon: '🏔', title: 'Mountains', shots: ['mountains'], refs: [['h04', [0, 0, 1, 1]], ['h01', [0, 0, 1, 1]], ['h05', [0, 0, 1, 1]]],
    anti: ['stripes', 'blobs', 'dither'] },
  { name: 'station_night', icon: '🏠', title: 'Station at night', shots: ['station_night'], refs: [['f01', [0, 0, 1, 1]], ['f02', [0.2, 0, 1, 1]], ['f04', [0, 0, 1, 1]], ['f05', [0, 0.4, 1, 0.95]]],
    criteria: ['contact'], anti: ['plastic', 'blobs', 'hover', 'dither'] },
  { name: 'wreck', icon: '✈', title: 'Wreck', shots: ['wreck', 'wreck_close'], refs: [['j01', [0.4, 0.2, 1, 0.9]], ['j05', [0, 0.2, 1, 1]], ['j03', [0, 0, 1, 1]], ['j02', [0, 0, 1, 1]]],
    criteria: ['contact'], anti: ['plastic', 'hover', 'blobs', 'cards'] },
];
export const criteriaOf = (s) => CRITERIA.filter(([k]) => !['motion', 'contact'].includes(k) || (s.criteria || []).includes(k)).map(([k]) => k);
