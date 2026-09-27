// ═══ СБОРКА СОДЕРЖАНИЯ ═══
// Движок получает CONTENT целиком и не импортирует файлы содержания напрямую.
// CONTENT = { ROLES, MINDS, MOODS, ARCHETYPES, ODDBALLS, NEEDS, TOPICS, CARDS, LINES, EVENTS, CHAT, NAMES, TUNING, LAYOUT }
// сверх схемы plan.md:
//   STYLES[]   — стили карт (content/cards);  WHEN — словарь условий карт
//   ORIGINS    — { from[], since[] } откуда и сколько в Батуми (content/names)
//   ICONS[]    — все ключи иконок, которые встречаются в содержании (для ui/icons: нарисовать каждую)
//   EMOJI      — { ключ иконки: эмодзи } — запасной вид иконки, пока в ui/icons нет своей (и для docs/scenario.md)
'use strict';
L.def('content/index', () => {
const { LAYOUT } = L.use('content/layout');
const { TOPICS } = L.use('content/topics');
const { NEEDS } = L.use('content/needs');
const { ROLES } = L.use('content/roles');
const { MINDS } = L.use('content/minds');
const { MOODS } = L.use('content/moods');
const { ARCHETYPES } = L.use('content/archetypes');
const { ODDBALLS } = L.use('content/oddballs');
const { STYLES, WHEN, CARDS } = L.use('content/cards');
const { LINES } = L.use('content/lines');
const { EVENTS } = L.use('content/events');
const { CHAT } = L.use('content/chat');
const { NAMES, ORIGINS } = L.use('content/names');
const { TUNING } = L.use('content/tuning');

const EMOJI = {
  ash: '🥀', backpack: '🎒', ball: '⚽', balloon: '🎈', banana: '🍌', bank: '🏦', battery: '🔋', 'battery-low': '🪫',
  beer: '🍺', book: '📘', boot: '🥾', brain: '🧠', briefcase: '💼', browser: '🖥️', bug: '🐞', bulb: '💡',
  calendar: '📅', camera: '📸', car: '🚗', cards: '🃏', cat: '🐈', chart: '📊', check: '✅', child: '🧒',
  circle: '⭕', city: '🏙️', clock: '⏰', cloud: '☁️', 'cloud-rain': '🌧️', coffee: '☕', coin: '🪙', compass: '🧭',
  crowd: '👥', crown: '👑', cue: '🎱', dice: '🎲', dino: '🦖', door: '🚪', ear: '👂', exchange: '💱',
  eye: '👀', fire: '🔥', flag: '🏳️', flash: '⚡', food: '🥟', gamepad: '🎮', garland: '🎄', glass: '🥤',
  hand: '🤚', handshake: '🤝', headset: '🎧', heart: '❤️', house: '🏠', kanban: '📋', key: '🔑', lamp: '💡',
  laptop: '💻', laugh: '😂', leaf: '🌿', link: '🔗', list: '📝', lock: '🔒', map: '🗺️', mask: '🎭',
  megaphone: '📣', mic: '🎤', mobile: '📱', moon: '🌙', mountain: '⛰️', music: '🎵', owl: '🦉', palm: '🌴',
  party: '🥳', passport: '🛂', pause: '⏸️', paw: '🐾', pen: '✏️', percent: '💯', phone: '📲', plane: '✈️',
  plant: '🪴', question: '❓', rain: '🌧️', rings: '💍', robot: '🤖', rocket: '🚀', sad: '😔', sax: '🎷',
  scale: '⚖️', scroll: '📜', sea: '🌊', search: '🔍', server: '🗄️', shell: '🐚', shield: '🛡️', shrug: '🤷', smile: '🙂',
  snail: '🐌', sofa: '🛋️', sparkle: '✨', speech: '💬', spray: '🧴', sprout: '🌱', star: '⭐', storm: '⛈️',
  street: '🚶', sun: '☀️', sushi: '🍣', tag: '🏷️', team: '🧑‍🤝‍🧑', thumb: '👍', tools: '🛠️', trophy: '🏆',
  umbrella: '☂️', user: '👤', walk: '🚶', wave: '👋', wine: '🍷',
};

const CONTENT = { ROLES, MINDS, MOODS, ARCHETYPES, ODDBALLS, NEEDS, TOPICS, CARDS, LINES, EVENTS, CHAT, NAMES, TUNING, LAYOUT,
  STYLES, WHEN, ORIGINS, EMOJI, ICONS: [] };

// все значения полей icon (рекурсивно), кроме плана зала — у него свои иконки зон, они тоже нужны
const seen = new Set();
(function walk(v) {
  if (!v || typeof v !== 'object') return;
  if (Array.isArray(v)) { for (const x of v) walk(x); return; }
  for (const k of Object.keys(v)) { if (k === 'icon' && typeof v[k] === 'string') seen.add(v[k]); else walk(v[k]); }
})({ ROLES, MINDS, MOODS, ARCHETYPES, ODDBALLS, NEEDS, TOPICS, CARDS, EVENTS, CHAT, ORIGINS, TUNING, zones: LAYOUT.zones });
CONTENT.ICONS = [...seen].sort();

return { CONTENT };
});
