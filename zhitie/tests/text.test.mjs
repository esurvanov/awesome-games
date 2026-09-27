// Тесты текстов Писателя: node --test tests/text*.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as hood from '../data/hood.js';
import * as careers from '../data/text/careers.js';
import * as events from '../data/text/events.js';
import * as wants from '../data/text/wants.js';
import * as socials from '../data/text/socials.js';
import * as ui from '../data/text/ui.js';
import * as paper from '../data/text/newspaper.js';

const uniq = (arr, what) => {
  const seen = new Set();
  for (const id of arr) { assert.ok(id, `${what}: пустой id`); assert.ok(!seen.has(id), `${what}: дубль ${id}`); seen.add(id); }
};
const maxLen = (s, n, where) => assert.ok(typeof s === 'string' && s.length > 0 && s.length <= n, `${where}: длина ${s?.length} > ${n}: «${s}»`);
const AXES = ['neat', 'outgoing', 'active', 'playful', 'nice'];
const SKILLS = ['cooking', 'mechanical', 'charisma', 'body', 'logic', 'creativity'];
const TRACKS = ['business', 'entertainment', 'law', 'crime', 'medicine', 'military', 'politics', 'athletics', 'science', 'xtreme'];
const ASP = ['family', 'fortune', 'knowledge', 'popularity', 'romance', 'pleasure'];

test('все модули импортируются', () => {
  for (const m of [hood, careers, events, wants, socials, ui, paper]) assert.ok(Object.keys(m).length > 0);
});

test('район: участки', () => {
  const L = hood.LOTS_HINT;
  uniq(L.map(l => l.id), 'LOTS_HINT');
  for (let i = 1; i <= 10; i++) assert.ok(L.find(l => l.id === `res${i}` && l.kind === 'res'), `res${i}`);
  for (const t of ['park', 'cafe', 'shop', 'gym', 'library']) assert.ok(L.find(l => l.id === t && l.kind === 'community' && l.type === t), t);
});

test('район: семьи и люди', () => {
  const F = hood.FAMILIES, T = hood.TOWNIES, lotIds = new Set(hood.LOTS_HINT.map(l => l.id));
  assert.ok(F.length >= 12, `семей ${F.length}`);
  assert.ok(T.length >= 40, `горожан ${T.length}`);
  uniq(F.map(f => f.id), 'FAMILIES');
  const people = [...F.flatMap(f => f.members), ...T];
  uniq(people.map(p => p.id), 'люди');
  const housed = F.filter(f => f.lotId);
  uniq(housed.map(f => f.lotId), 'lotId семей');
  for (const f of F) {
    assert.ok(f.lotId === null || lotIds.has(f.lotId), `${f.id}: lotId ${f.lotId}`);
    assert.ok(f.lotId === null || f.lotId.startsWith('res'), `${f.id}: живёт на общественном участке`);
    assert.ok(f.members.length >= 1 && f.members.length <= 5, `${f.id}: членов ${f.members.length}`);
    assert.ok(f.members.some(m => m.age !== 'child'), `${f.id}: нет взрослых`);
    assert.ok(Number.isFinite(f.funds) && f.funds >= 0, `${f.id}: funds`);
    maxLen(f.bio, 280, `${f.id}.bio`);
  }
  for (const p of people) {
    const sum = AXES.reduce((s, a) => s + p.personality[a], 0);
    assert.equal(sum, 25, `${p.id}: сумма личности ${sum}`);
    for (const a of AXES) assert.ok(p.personality[a] >= 0 && p.personality[a] <= 10, `${p.id}.${a}`);
    assert.ok(['adult', 'child', 'elder'].includes(p.age), `${p.id}.age`);
    assert.equal(p.elder, p.age === 'elder');
    assert.ok(['m', 'f'].includes(p.gender));
    assert.equal(p.look.body, p.gender === 'f' ? 'female' : 'male');
    for (const k of ['skin', 'hair', 'shirt', 'pants']) assert.match(p.look[k], /^#[0-9a-f]{6}$/i, `${p.id}.look.${k}`);
    assert.ok(ASP.includes(p.aspiration), `${p.id}.aspiration`);
    assert.equal(p.zodiac, hood.zodiacOf(p.personality), `${p.id}.zodiac`);
    for (const s of SKILLS) assert.ok(p.skills[s] >= 0 && p.skills[s] <= 10, `${p.id}.skills.${s}`);
    if (p.age === 'child') { assert.equal(p.career, null, `${p.id}: ребёнок с работой`); assert.ok(SKILLS.every(s => p.skills[s] === 0)); }
    if (p.career) { assert.ok(TRACKS.includes(p.career.track), `${p.id}.career.track`); assert.ok(p.career.level >= 1 && p.career.level <= 10); }
    maxLen(p.name, 20, `${p.id}.name`); maxLen(p.bio, 280, `${p.id}.bio`);
  }
  // разнообразие
  assert.ok(people.some(p => p.age === 'elder') && people.filter(p => p.age === 'child').length >= 5);
  assert.ok(Math.max(...F.map(f => f.funds)) >= 50000 && Math.min(...F.map(f => f.funds)) <= 5000, 'богатые и бедные');
  assert.ok(F.some(f => f.members.filter(m => m.age !== 'child').length === 1 && f.members.some(m => m.age === 'child')), 'мать-одиночка');
});

test('зодиак: 12 архетипов, Σ = 25, различимы', () => {
  const Z = Object.entries(hood.ZODIAC);
  assert.equal(Z.length, 12);
  uniq(Z.map(([, z]) => z.p.join()), 'векторы зодиака');
  for (const [k, z] of Z) {
    assert.equal(z.p.reduce((a, b) => a + b), 25, k);
    assert.equal(hood.zodiacOf(Object.fromEntries(AXES.map((a, i) => [a, z.p[i]]))), k, `${k} — сам себе ближайший`);
  }
});

test('отношения ссылаются на существующих людей', () => {
  const flags = new Set(['married', 'love', 'family', 'friends', 'roommates', 'colleague', 'crush', 'secret', 'feud', 'enemy', 'rival']);
  const pairs = new Set();
  for (const [a, b, v, fl] of hood.RELATIONS) {
    assert.ok(hood.PEOPLE[a], `нет ${a}`); assert.ok(hood.PEOPLE[b], `нет ${b}`);
    assert.notEqual(a, b);
    assert.ok(v >= -100 && v <= 100);
    for (const f of fl) assert.ok(flags.has(f), `флаг ${f}`);
    const k = [a, b].sort().join('|'); assert.ok(!pairs.has(k), `дубль пары ${k}`); pairs.add(k);
  }
  assert.ok(hood.RELATIONS.some(r => r[3].includes('secret')), 'тайный роман');
  assert.ok(hood.RELATIONS.some(r => r[3].includes('feud')), 'вражда соседей');
});

test('toSimSpec: старики — взрослые для механики', () => {
  const s = hood.toSimSpec(hood.PEOPLE['kolb.lev']);
  assert.equal(s.age, 'adult'); assert.equal(s.elder, true); assert.equal(s.look.age, 'elder');
  assert.equal(s.career.track, 'science');
  const kid = hood.toSimSpec(hood.PEOPLE['kopeyk.lyova']);
  assert.equal(kid.age, 'child'); assert.equal(kid.career, null);
});

test('карьеры: 10 треков × 10 уровней', () => {
  const C = careers.CAREERS;
  assert.deepEqual(Object.keys(C).sort(), [...TRACKS].sort());
  for (const [k, c] of Object.entries(C)) {
    assert.ok(c.name && c.icon);
    assert.equal(c.levels.length, 10, k);
    uniq(c.levels.map(l => l.title), `${k} titles`);
    for (const l of c.levels) { maxLen(l.title, 32, `${k}.title`); maxLen(l.desc, 90, `${k}.desc`); maxLen(l.carpool, 40, `${k}.carpool`); }
    assert.equal(c.chance.length, 3, `${k}.chance`);
    for (const ch of c.chance) {
      maxLen(ch.text, 110, `${k}.chance.text`); maxLen(ch.a, 24, `${k}.a`); maxLen(ch.b, 24, `${k}.b`);
      for (const f of ['aOk', 'aFail', 'bOk']) maxLen(ch[f], 90, `${k}.${f}`);
    }
  }
});

test('события: ≥ 60, уникальные, короткие', () => {
  const E = events.EVENTS;
  assert.ok(E.length >= 60, `событий ${E.length}`);
  uniq(E.map(e => e.id), 'EVENTS');
  for (const e of E) {
    assert.ok(events.EVENT_KINDS[e.kind], `${e.id}.kind`);
    assert.ok(e.icon); maxLen(e.title, 32, `${e.id}.title`); maxLen(e.text, 110, `${e.id}.text`);
    assert.ok(e.fx || e.options, `${e.id}: нет ни fx, ни options`);
    if (e.options) {
      assert.ok(e.options.length >= 2, `${e.id}: вариантов < 2`);
      uniq(e.options.map(o => o.key), `${e.id}.options`);
      for (const o of e.options) {
        maxLen(o.label, 28, `${e.id}.${o.key}.label`); maxLen(o.text, 90, `${e.id}.${o.key}.text`);
        if (o.chance != null) { assert.ok(o.chance > 0 && o.chance < 1); maxLen(o.failText, 90, `${e.id}.failText`); }
      }
    }
    for (const fx of [e.fx, ...(e.options ?? []).flatMap(o => [o.fx, o.failFx])].filter(Boolean)) {
      if (fx.rel && !['caller', 'visitor', 'family'].includes(fx.rel.who)) assert.ok(hood.PEOPLE[fx.rel.who], `${e.id}: rel.who ${fx.rel.who}`);
      if (fx.skill) for (const s of Object.keys(fx.skill)) assert.ok(SKILLS.includes(s), `${e.id}: навык ${s}`);
    }
  }
});

test('желания/страхи: 6 устремлений × ≥ 20', () => {
  const W = wants.WANTS;
  assert.deepEqual(wants.ASPIRATIONS.map(a => a.id).sort(), [...ASP].sort());
  uniq(W.map(w => w.id), 'WANTS');
  const kinds = new Set(['skill', 'relation', 'social', 'buy', 'event', 'career', 'money', 'motive']);
  const socialKeys = new Set(socials.SOCIALS.map(s => s.key));
  for (const a of ASP) {
    const mine = W.filter(w => w.asp === a);
    assert.ok(mine.length >= 20, `${a}: ${mine.length}`);
    assert.ok(mine.some(w => w.type === 'fear') && mine.some(w => w.type === 'want'), a);
  }
  for (const w of W) {
    assert.ok(kinds.has(w.kind), `${w.id}.kind`);
    assert.ok(['want', 'fear'].includes(w.type));
    assert.ok(w.type === 'want' ? w.pts > 0 : w.pts < 0, `${w.id}.pts`);
    maxLen(w.label, 48, `${w.id}.label`);
    if (w.kind === 'social') assert.ok(socialKeys.has(w.params.key), `${w.id}: соц. ключ ${w.params.key}`);
    if (w.kind === 'skill') assert.ok([...SKILLS, 'any', 'all'].includes(w.params.skill), `${w.id}: навык`);
    if (w.params.who) assert.ok(hood.PEOPLE[w.params.who], `${w.id}: who`);
  }
  assert.ok(W.length >= 120);
});

test('общение: ≥ 50, все категории, реплики', () => {
  const S = socials.SOCIALS;
  assert.ok(S.length >= 50, `соц. действий ${S.length}`);
  uniq(S.map(s => s.key), 'SOCIALS');
  const cats = new Set(socials.SOCIAL_CATS.map(c => c.id));
  for (const c of cats) assert.ok(S.some(s => s.cat === c), `категория ${c} пуста`);
  for (const s of S) {
    assert.ok(cats.has(s.cat), `${s.key}.cat`); assert.ok(s.icon);
    maxLen(s.label, 28, `${s.key}.label`);
    assert.ok(s.topics.length >= 1 && s.accept.length >= 1 && s.reject.length >= 1, s.key);
    for (const l of [...s.accept, ...s.reject]) maxLen(l, 40, `${s.key} реплика`);
    assert.ok(Number.isFinite(s.hint.rel) && Number.isFinite(s.hint.minRel), `${s.key}.hint`);
  }
  // ключи, которые уже есть у Мозга в data/interactions.js
  for (const k of ['greet', 'invite_in', 'ask_leave', 'talk', 'joke', 'compliment', 'hug', 'flirt', 'kiss', 'insult', 'slap', 'goodbye']) assert.ok(S.find(s => s.key === k), k);
  assert.ok(S.some(s => s.hint.group), 'групповые');
});

test('интерфейс: уведомления, советы, загрузка', () => {
  const sample = { name: 'Иннокентий', a: 'Альбина Звонарёва', b: 'Аристарх Самоваров', money: 12345, obj: 'Холодильник «Мороз»', title: 'Младший научный сотрудник', pay: 1200,
    hours: '10–17', skill: 'Творчество', level: 10, grade: 'A+', n: 2, cause: 'от удара током', track: 'Шоу-бизнес', lot: 'Библиотека-музей «Роща»', baby: 'Мирослава', female: true };
  for (const [k, v] of Object.entries(ui.NOTIFY)) {
    assert.ok(v.icon, k);
    maxLen(ui.fmt(k, sample), 90, `NOTIFY.${k}`);
    assert.ok(!/[[\]{}]/.test(ui.fmt(k, sample)), `${k}: не раскрыт шаблон`);
  }
  assert.equal(ui.fmt('from_work', { name: 'Вера', pay: 120, female: true }), 'Вера вернулась с работы: +§120');
  assert.equal(ui.fmt('from_work', { name: 'Олег', pay: 120 }), 'Олег вернулся с работы: +§120');
  for (const k of ['bills', 'fire', 'burglar_caught', 'promoted', 'fired', 'born', 'died', 'repaired', 'maid_hired', 'pizza_arrived', 'from_school']) assert.ok(ui.NOTIFY[k], k);
  assert.ok(ui.TIPS.length >= 30); ui.TIPS.forEach(t => maxLen(t, 90, 'совет'));
  assert.ok(ui.LOADING.length >= 40); ui.LOADING.forEach(t => maxLen(t, 60, 'загрузка'));
  uniq(ui.TIPS, 'TIPS'); uniq(ui.LOADING, 'LOADING');
});

test('газета: ≥ 30 заголовков и вакансии', () => {
  const H = paper.HEADLINES;
  assert.ok(H.length >= 30);
  uniq(H.map(h => h.id), 'HEADLINES');
  H.forEach(h => { maxLen(h.text, 90, h.id); assert.ok(h.icon && h.tag); });
  for (const t of TRACKS) {
    assert.ok(paper.JOB_AD_INTRO[t], t);
    for (const l of careers.CAREERS[t].levels) maxLen(paper.jobAd({ track: t, title: l.title, pay: 1400, hours: [10, 18] }), 90, `вакансия ${t}`);
  }
  assert.equal(paper.jobAd({ track: 'science', title: 'Лаборант', pay: 155, hours: [9, 15] }), '🔬 НИИ «Роща»: Лаборант. §155/день, 9:00–15:00');
});
