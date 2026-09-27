// Тексты и жители от Писателя (data/text/*.js, data/hood.js) — подгружаются, если уже есть.
// Мозг держит механику и запасные тексты; строки Писателя имеют приоритет по ключу.
async function opt(path) {
  try { return await import(path); } catch { return {}; }
}
const pick = (m, ...names) => { for (const n of names) if (m?.[n] != null) return m[n]; return m?.default?.[names[0]] ?? null; };

const [hood, tCareers, tEvents, tWants, tSocials] = await Promise.all([
  opt('../../data/hood.js'), opt('../../data/text/careers.js'), opt('../../data/text/events.js'),
  opt('../../data/text/wants.js'), opt('../../data/text/socials.js'),
]);

// Приводим к словарям { key → {…текст} }
const asMap = v => (Array.isArray(v) ? Object.fromEntries(v.filter(x => x && (x.id ?? x.key)).map(x => [x.id ?? x.key, x])) : v ?? {});

export const TEXT = {
  careers: asMap(pick(tCareers, 'CAREERS', 'CAREER_TEXTS', 'careers')),     // { track: { name, levels:[{title, desc}], chance:[{text, a, b}] } }
  chance: asMap(pick(tCareers, 'CHANCE', 'CHANCE_CARDS', 'chance')),        // { id: { text, choices:[a,b] } } (если отдельно)
  events: asMap(pick(tEvents, 'EVENTS', 'EVENT_TEXTS', 'events')),         // { id: { title?, text, choices?:[…] } }
  wants: asMap(pick(tWants, 'WANTS', 'WANT_TEXTS', 'wants')),              // { id: { label } }
  aspirations: asMap(pick(tWants, 'ASPIRATIONS', 'aspirations')),
  socials: asMap(pick(tSocials, 'SOCIALS', 'SOCIAL_TEXTS', 'socials')),    // { key: { label, … } }
};
export const HOOD = {
  families: pick(hood, 'FAMILIES', 'families') ?? [],
  townies: pick(hood, 'TOWNIES', 'townies') ?? [],
  relations: pick(hood, 'RELATIONS', 'relations') ?? [],                  // [[idA, idB, value], …] или [{a,b,value}]
};

// Текст по ключу с запасным вариантом
export const textOf = (group, key, field, fallback) => TEXT[group]?.[key]?.[field] ?? fallback;
