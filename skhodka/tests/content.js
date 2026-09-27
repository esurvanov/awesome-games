// Проверка содержания: всё грузится в Node, объёмы, ссылки между данными, форма по docs/plan.md.
// Запуск: node tests/content.js  (выход 1 — есть ошибки; список ошибок в консоли)
import { load } from './load.js';

const L = load();
const C = L.use('content/index').CONTENT;
const errs = [];
const bad = (m) => errs.push(m);
const ok = (c, m) => { if (!c) bad(m); };
const ids = (arr) => new Set(arr.map(x => x.id));
const uniq = (arr, what) => { const s = new Set(); for (const x of arr) { if (s.has(x.id)) bad(`${what}: повтор id ${x.id}`); s.add(x.id); } };
const inRange = (v, a, b) => typeof v === 'number' && v >= a && v <= b;
const words = s => s.replace(/[!?.,:…«»—-]/g, ' ').trim().split(/\s+/).filter(Boolean).length;

const KEYS = ['ROLES', 'MINDS', 'MOODS', 'ARCHETYPES', 'ODDBALLS', 'NEEDS', 'TOPICS', 'CARDS', 'LINES', 'EVENTS', 'CHAT', 'NAMES', 'TUNING', 'LAYOUT'];
for (const k of KEYS) ok(C[k], `CONTENT.${k} нет`);

const STYLES = C.STYLES, SST = new Set(STYLES);
const TOP = ids(C.TOPICS), NEED = ids(C.NEEDS), ODD = ids(C.ODDBALLS), EVT = ids(C.EVENTS), ARCH = ids(C.ARCHETYPES);
const ZONES = new Set(C.LAYOUT.zones.map(z => z.id));
const SINCE = new Set(C.ORIGINS.since.map(s => s.id));
const REACT = ['good', 'bad', 'meh', 'open', 'reveal', 'leave', 'hello', 'contact', 'deal'];
const TRAITS = ['social', 'open', 'trust', 'pace', 'group'];
const PH = new Set(['name', 'job', 'topic', 'me', 'need', 'time', 'n', 'date', 'odd', 'a', 'b', 'friend', 'announce', 'poll']);
const phOk = (s, where) => { for (const m of String(s).matchAll(/\{(\w+)\}/g)) if (!PH.has(m[1])) bad(`${where}: неизвестная подстановка {${m[1]}}`); };
const styles = (arr, where) => { for (const s of arr || []) if (!SST.has(s)) bad(`${where}: стиль ${s} не из STYLES`); };
const topics = (arr, where) => { for (const t of arr || []) if (!TOP.has(t)) bad(`${where}: тема ${t} не из TOPICS`); };

ok(STYLES.join() === 'ask,share,listen,joke,facts,help,argue,dream,praise,wait,invite,treat', 'STYLES ≠ списку plan.md');

// ── TOPICS ──
uniq(C.TOPICS, 'TOPICS');
ok(C.TOPICS.length >= 20, `тем ${C.TOPICS.length} < 20`);
for (const t of C.TOPICS) ok(t.title && t.icon && t.weight > 0, `TOPICS ${t.id}: title/icon/weight`);

// ── NEEDS ──
uniq(C.NEEDS, 'NEEDS');
ok(C.NEEDS.length >= 8, `нужд ${C.NEEDS.length} < 8`);
for (const n of C.NEEDS) {
  ok(n.seek?.title && n.seek?.icon && n.offer?.title && n.offer?.icon, `NEEDS ${n.id}: seek/offer`);
  topics([n.topic], `NEEDS ${n.id}`);
  ok(n.seekLines?.length >= 3 && n.offerLines?.length >= 3, `NEEDS ${n.id}: реплик раскрытия < 3`);
}

// ── ROLES ──
uniq(C.ROLES, 'ROLES');
ok(C.ROLES.length >= 14, `ролей ${C.ROLES.length} < 14`);
for (const r of C.ROLES) {
  ok(r.title && r.icon && r.weight > 0, `ROLES ${r.id}: title/icon/weight`);
  topics(r.topics, `ROLES ${r.id}`);
  ok(r.topics.length >= 3, `ROLES ${r.id}: тем < 3`);
  for (const x of [...r.needs, ...r.offers]) ok(NEED.has(x), `ROLES ${r.id}: нужда ${x}`);
  ok(['it', 'smart', 'sport', 'party'].includes(r.look?.style), `ROLES ${r.id}: look.style`);
  ok(r.jobs?.length >= 2, `ROLES ${r.id}: jobs`);
}
const wsum = C.ROLES.reduce((s, r) => s + r.weight, 0), be = C.ROLES.find(r => r.id === 'backend');
ok(be && be.weight / wsum > 0.18, 'бэкенд должен быть самой большой ролью');

// ── MINDS ──
uniq(C.MINDS, 'MINDS');
ok(C.MINDS.length === 9, `складов ${C.MINDS.length} ≠ 9`);
for (const m of C.MINDS) {
  styles(m.likes, `MINDS ${m.id}`); styles(m.dislikes, `MINDS ${m.id}`);
  ok(!m.likes.some(s => m.dislikes.includes(s)), `MINDS ${m.id}: likes ∩ dislikes`);
  ok(m.talk && m.title && m.icon && m.weight > 0, `MINDS ${m.id}: поля`);
  for (const k of Object.keys(m.traits || {})) ok(TRAITS.includes(k), `MINDS ${m.id}: шкала ${k}`);
}

// ── MOODS ──
uniq(C.MOODS, 'MOODS');
ok(C.MOODS.length === 9, `настроений ${C.MOODS.length} ≠ 9`);
for (const m of C.MOODS) {
  ok(inRange(m.energy, 0, 1) && typeof m.leaveShift === 'number', `MOODS ${m.id}: energy/leaveShift`);
  topics(m.likeTopics, `MOODS ${m.id}`); topics(m.hateTopics, `MOODS ${m.id}`);
  styles(m.likes, `MOODS ${m.id}`); styles(m.dislikes, `MOODS ${m.id}`);
  ok(m.openLines?.length >= 3, `MOODS ${m.id}: openLines < 3`);
}

// ── ARCHETYPES ──
uniq(C.ARCHETYPES, 'ARCHETYPES');
ok(C.ARCHETYPES.length >= 14, `архетипов ${C.ARCHETYPES.length} < 14`);
for (const a of C.ARCHETYPES) {
  const w = `ARCHETYPES ${a.id}`;
  ok(inRange(a.arrive?.[0], 19, 25) && inRange(a.arrive?.[1], a.arrive[0], 25), `${w}: arrive`);
  ok(a.stay?.[0] > 0 && a.stay[1] >= a.stay[0] && a.stay[1] < 17, `${w}: stay (длительность, ч)`);
  ok(a.zones.length && a.zones.every(z => ZONES.has(z)), `${w}: зоны ${a.zones}`);
  ok(a.group[0] >= 1 && a.group[1] >= a.group[0], `${w}: group`);
  for (const k of TRAITS) ok(inRange(a.traits[k], 0, 1), `${w}: traits.${k}`);
  ok(a.tell && a.first, `${w}: tell/first`);
  if (a.since) ok(SINCE.has(a.since), `${w}: since ${a.since}`);
  const b = a.bias || {};
  for (const k of Object.keys(b.roles || {})) ok(C.ROLES.some(r => r.id === k), `${w}: bias.roles ${k}`);
  for (const k of Object.keys(b.moods || {})) ok(C.MOODS.some(r => r.id === k), `${w}: bias.moods ${k}`);
  for (const k of [...Object.keys(b.needs || {}), ...Object.keys(b.offers || {})]) ok(NEED.has(k), `${w}: bias нужда ${k}`);
  topics(b.topics, w);
}

// ── ODDBALLS ──
uniq(C.ODDBALLS, 'ODDBALLS');
ok(C.ODDBALLS.length >= 16, `чудиков ${C.ODDBALLS.length} < 16`);
for (const o of C.ODDBALLS) {
  const w = `ODDBALLS ${o.id}`;
  ok(o.catch && o.prop && o.sign && o.does && o.howto, `${w}: catch/prop/sign/does/howto`);
  ok(o.look?.oddball === o.id && o.look.sex, `${w}: look`);
  ok(inRange(o.arrive?.[0], 19, 25) && o.arrive[1] >= o.arrive[0], `${w}: arrive`);
  ok(o.event === null || EVT.has(o.event), `${w}: event ${o.event}`);
  if (o.event) ok(C.EVENTS.find(e => e.id === o.event).chance === 0, `${w}: событие чудика должно иметь chance 0`);
  styles(o.befriend?.likes, w); topics([o.befriend?.topic], w);
  ok(o.lines?.length >= 6, `${w}: реплик < 6`);
  ok(o.album?.title && o.album?.icon, `${w}: album`);
  for (const x of [o.offer, o.need]) ok(x == null || NEED.has(x), `${w}: нужда ${x}`);
  for (const s of o.lines) phOk(s, w);
}

// ── CARDS ──
uniq(C.CARDS, 'CARDS');
ok(C.CARDS.length >= 30, `карт ${C.CARDS.length} < 30`);
const longest = C.TOPICS.reduce((a, t) => words(t.title) > words(a) ? t.title : a, '');
for (const k of C.CARDS) {
  const w = `CARDS ${k.id}`;
  ok(SST.has(k.style), `${w}: style ${k.style}`);
  ok(k.icon, `${w}: icon`);
  const n = words(k.label.replace('{topic}', longest));
  ok(n >= 2 && n <= 4, `${w}: «${k.label}» — ${n} слов (нужно 2–4)`);
  if (k.topic) ok(TOP.has(k.topic) || ['their', 'mine', 'event'].includes(k.topic), `${w}: topic ${k.topic}`);
  if (k.when) ok(k.when in C.WHEN, `${w}: when ${k.when}`);
  if (k.do) ok(['contact', 'deal'].includes(k.do) && k.when === k.do, `${w}: do ${k.do}`);
}
for (const s of STYLES) ok(C.CARDS.some(k => k.style === s), `нет карты стиля ${s}`);
for (const t of C.TOPICS) ok(C.CARDS.some(k => k.topic === t.id), `нет карты на тему ${t.id}`);
ok(C.CARDS.some(k => k.do === 'contact') && C.CARDS.some(k => k.do === 'deal'), 'нет карт контакта/договора');
ok(C.CARDS.some(k => k.when === 'first'), 'нет приветственных карт');

// ── LINES ──
let nLines = 0;
for (const key of ['any', ...STYLES, ...TOP]) {
  const L0 = C.LINES[key];
  if (!L0) { bad(`LINES.${key} нет`); continue; }
  for (const r of REACT) {
    const arr = L0[r];
    if (!arr || arr.length < 3) { bad(`LINES.${key}.${r}: < 3 реплик`); continue; }
    if (new Set(arr).size !== arr.length) bad(`LINES.${key}.${r}: повтор`);
    for (const s of arr) phOk(s, `LINES.${key}.${r}`);
    nLines += arr.length;
  }
}
for (const key of Object.keys(C.LINES)) ok(key === 'any' || SST.has(key) || TOP.has(key), `LINES.${key}: ключ не тема и не стиль`);

// ── EVENTS ──
uniq(C.EVENTS, 'EVENTS');
const SCENES = new Set(['strobe', 'rain', 'football', 'sax', 'birthday', 'garland', 'smell', 'karaoke']);
const standZones = new Set(C.LAYOUT.stands.map(s => s.zone));
for (const e of C.EVENTS) {
  const w = `EVENTS ${e.id}`, fx = e.effect || {};
  ok(e.title && e.icon, `${w}: title/icon`);
  ok(inRange(e.at?.[0], 19, 25) && inRange(e.at?.[1], e.at[0], 25), `${w}: at`);
  ok(inRange(e.chance, 0, 1), `${w}: chance`);
  ok(e.scene === null || SCENES.has(e.scene), `${w}: scene ${e.scene}`);
  for (const z of fx.flee || []) ok(ZONES.has(z), `${w}: flee ${z}`);
  if (fx.gather) ok(ZONES.has(fx.gather.zone) && standZones.has(fx.gather.zone) && inRange(fx.gather.share, 0, 1), `${w}: gather (зона со стоячими местами)`);
  if (fx.leave) ok(inRange(fx.leave.share, 0, 1), `${w}: leave.share`);
  if (fx.zone) ok(ZONES.has(fx.zone), `${w}: zone`);
  if (fx.topic) topics([fx.topic], w);
  styles(fx.likes, w); styles(fx.dislikes, w);
  if (e.chat) ok(C.CHAT.events[e.chat], `${w}: chat ${e.chat}`);
  if (e.by) ok(ODD.has(e.by), `${w}: by ${e.by}`);
}
for (const s of SCENES) ok(C.EVENTS.some(e => e.scene === s), `нет события со сценой ${s}`);

// ── CHAT ──
const CH = C.CHAT;
ok(CH.announce?.text?.includes('Суббота в Батуми') && CH.announce.text.includes('О чём встреча'), 'анонс');
ok(CH.poll?.options?.length === 3, 'опрос: 3 варианта');
ok(CH.feed.length >= 20, `лента до встречи ${CH.feed.length} < 20`);
const during = [...CH.before, ...CH.where, ...CH.late];
ok(during.length >= 20, `«где вы / уже тут / опаздываю» ${during.length} < 20`);
ok(CH.after.length + CH.afterFeed.length >= 15, 'после встречи < 15');
uniq([...CH.feed, ...during, ...CH.background, ...CH.after, ...CH.afterFeed], 'CHAT');
for (const m of during) {
  if (m.arch) ok(ARCH.has(m.arch), `CHAT ${m.id}: arch ${m.arch}`);
  for (const o of m.options || []) { ok(o.id && o.label, `CHAT ${m.id}: option`); const n = words(o.label); ok(n >= 1 && n <= 4, `CHAT ${m.id}: «${o.label}»`); }
  phOk(m.text, `CHAT ${m.id}`);
}
for (const m of CH.late) ok(m.arch === 'latecomer', `CHAT ${m.id}: late — от опоздавшего`);
for (const m of [...CH.feed, ...CH.background, ...CH.after, ...CH.afterFeed]) phOk(m.text, `CHAT ${m.id}`);

// ── NAMES ──
ok(C.NAMES.m.length >= 20 && C.NAMES.f.length >= 20, 'имён мало');
ok(new Set(C.NAMES.m).size === C.NAMES.m.length && new Set(C.NAMES.f).size === C.NAMES.f.length, 'имена повторяются');

// ── TUNING ──
const T = C.TUNING;
ok(T.time.realSecPerHour === 180 && T.time.start === 19 && T.time.end === 25, 'TUNING.time');
const cv = T.crowd.curve;
ok(cv[0][0] === 19 && cv[cv.length - 1][0] === 25 && cv.every((p, i) => !i || p[0] > cv[i - 1][0]), 'кривая по часам 19..25');
const at = h => { for (let i = 1; i < cv.length; i++) if (h <= cv[i][0]) { const [a, b] = [cv[i - 1], cv[i]]; return a[1] + (b[1] - a[1]) * (h - a[0]) / (b[0] - a[0]); } return cv[cv.length - 1][1]; };
ok(at(19) <= 3, '19:00 — пусто (2–3)');
ok(at(21.5) >= 20 && at(21.5) <= 25, '21–22 — пик 20–25');
ok(at(25) <= 6, '01:00 — последние');
ok(T.crowd.peak.n[0] >= 20 && T.crowd.peak.n[1] <= 25, 'crowd.peak.n');
for (const s of STYLES) ok(typeof T.talk.cost[s] === 'number', `talk.cost.${s}`);
ok(T.ladder.length === 6, 'ступеней 6');
ok(T.titles.length >= 5 && T.titles.every(t => t.title && t.icon && t.need), 'звания');
uniq(T.menu, 'menu');
// одна шкала 0..1: силы, симпатия, пороги, цены — движок ничего не угадывает
const u = (v, a = 0, b = 1) => typeof v === 'number' && v >= a && v <= b;
for (const k of ['start', 'max', 'say', 'bad', 'outside', 'low']) ok(u(T.energy[k]), `energy.${k} в 0..1`);
for (const k of ['warmGood', 'warmMeh', 'startWarm', 'gate', 'talked', 'contact', 'deal']) ok(u(T.talk[k]), `talk.${k} в 0..1`);
for (const k of ['warmBad', 'failWarm']) ok(u(T.talk[k], -1, 0), `talk.${k} в −1..0`);
for (const k in T.talk.reveal) ok(u(T.talk.reveal[k]), `talk.reveal.${k} в 0..1`);
for (const m of T.menu) ok(u(m.energy), `menu ${m.id}: energy в 0..1`);
for (const e of C.EVENTS) if (e.effect && e.effect.energy != null) ok(u(e.effect.energy, -1, 1), `EVENTS ${e.id}: energy в −1..1`);
for (const c of C.CARDS) if (c.cost != null) ok(u(c.cost, -1, 1), `CARDS ${c.id}: cost в −1..1`);
for (const m of C.MINDS) if (m.gate != null) ok(u(m.gate), `MINDS ${m.id}: gate в 0..1`);
const opts = []; for (const k of ['before', 'where', 'late', 'during']) for (const m of CH[k] || []) opts.push(...(m.options || []));
for (const o of opts) if (o.fx) for (const k of ['rapport', 'energy']) if (o.fx[k] != null) ok(u(o.fx[k], -1, 1), `CHAT ${o.id}: fx.${k} в −1..1`);

// ── иконки ──
for (const i of C.ICONS) ok(C.EMOJI[i], `нет эмодзи для иконки ${i}`);
// каждый ключ содержания нарисован в спрайте интерфейса (или синоним на рисунок) — не «точка»
{ const { ICON, ALIAS } = L.use('ui/icons'); for (const i of C.ICONS) ok(ICON[i] || ICON[ALIAS[i]], `иконки ${i} нет в спрайте ui/icons`); }

// ── без политики и реальных людей (грубый фильтр) ──
const DENY = /путин|войн|мобилиз|санкц|полити|режим|@\w/i;
const texts = [];
for (const k in C.LINES) for (const r in C.LINES[k]) texts.push(...C.LINES[k][r]);
for (const o of C.ODDBALLS) texts.push(o.catch, ...o.lines);
for (const m of [...CH.feed, ...during, ...CH.background, ...CH.after, ...CH.afterFeed]) texts.push(m.text);
for (const s of texts) if (DENY.test(s)) bad(`запрещённое слово: «${s}»`);

// ── итог ──
const n = { roles: C.ROLES.length, minds: C.MINDS.length, moods: C.MOODS.length, arch: C.ARCHETYPES.length, odd: C.ODDBALLS.length,
  needs: C.NEEDS.length, topics: C.TOPICS.length, cards: C.CARDS.length, lines: nLines, events: C.EVENTS.length,
  chat: CH.feed.length + during.length + CH.background.length + CH.after.length + CH.afterFeed.length, icons: C.ICONS.length };
console.log('объёмы:', JSON.stringify(n));
if (errs.length) { console.log(`ОШИБОК: ${errs.length}`); for (const e of errs) console.log(' ✗', e); process.exit(1); }
console.log('content: OK');
