// Толпа вечера: люди из CONTENT (роль + склад + настроение + архетип + нужда/предложение + темы + шкалы
// + имя + подсказки внешности). Внешность рисует render/looks.makeLook — здесь только lookHints и seed.
// Расписание (приход/уход) сводится к кривой вечера инвариантом, а не подбором: после случайной
// генерации число присутствующих в часы пика приводится в коридор TUNING.crowd.peak, после пика —
// под потолок crowd.after, ранних — ровно early, до закрытия остаются last. Караоке и прочие уходы
// по событиям — дело режиссёра (sim/director).
'use strict';
L.def('sim/crowd', () => {
const { clamp } = L.use('core');

const TRAITS = ['social', 'open', 'trust', 'pace', 'group'];

function namePools(NAMES) {
  const N = NAMES || {};
  if (Array.isArray(N)) return { m: N.filter(x => x.sex !== 'f').map(x => x.name || x), f: N.filter(x => x.sex === 'f').map(x => x.name || x), last: null };
  return { m: (N.m || N.male || []).map(x => x.name || x), f: (N.f || N.female || []).map(x => x.name || x), last: N.last || null };
}

// stay — длительность [мин,макс] ч (или окно ухода, если ≥ 17)
function stayOf(rng, stay, arrive) {
  const s = stay || [2, 3];
  if (s[0] >= 17) return Math.max(arrive + 0.75, rng.range(s[0], s[1]));
  return arrive + rng.range(s[0], s[1]);
}

function makeCrowd(C, T, rng) {
  const TC = T.crowd, byId = arr => Object.fromEntries((arr || []).map(x => [x.id, x]));
  const ROLES = C.ROLES || [], MINDS = C.MINDS || [], MOODS = C.MOODS || [], ARCH = C.ARCHETYPES || [];
  const TOPICS = C.TOPICS || [], NEEDS = byId(C.NEEDS), ORI = C.ORIGINS || null;
  const names = namePools(C.NAMES), usedNames = new Set();
  const start = T.time.start;
  const people = [];
  const earlyArch = ARCH.filter(a => a.arrive && a.arrive[0] < start + 0.3 && !a.pair);
  const lateArch = ARCH.filter(a => a.arrive && a.arrive[0] >= start + 2.2);
  const midArch = ARCH.filter(a => !lateArch.includes(a));
  const nEarly = rng.int(TC.early[0], TC.early[1]);
  const nLate = rng.int(TC.late[0], TC.late[1]);
  const oddPool = (C.ODDBALLS || []).slice();
  const nOdd = Math.min(oddPool.length, rng.int(TC.oddballs[0], TC.oddballs[1]));
  const rareUsed = new Set();

  const pickName = (sex, origin) => {
    let pool = names[sex].length ? names[sex] : names[sex === 'm' ? 'f' : 'm'];
    const extra = origin?.names?.[sex];
    if (extra?.length && rng.chance(0.5)) pool = extra;
    for (let k = 0; k < 40 && pool.length; k++) { const n = rng.pick(pool); if (!usedNames.has(n)) { usedNames.add(n); return n; } }
    for (const n of names[sex]) if (!usedNames.has(n)) { usedNames.add(n); return n; }
    const n = (pool.length ? rng.pick(pool) : '?') + ' ' + (usedNames.size + 1); usedNames.add(n); return n;
  };
  const archPick = pool => {
    const a = rng.weighted(pool.filter(a => !(a.rare && rareUsed.has(a.id))));
    if (a?.rare) rareUsed.add(a.id);
    return a || { id: 'guest', arrive: [start + 1, start + 2], stay: [2, 3], zones: [], group: [2, 5], traits: {} };
  };
  // сдвиг весов: bias.roles/moods/needs/offers = { id: × }
  const wOf = (x, b) => (x.weight ?? 1) * (b?.[x.id] ?? 1);

  function make(i, arch, od) {
    const bias = arch.bias || {};
    const role = rng.weighted(ROLES, r => wOf(r, bias.roles)) || { id: 'guest', title: '', topics: [], needs: [], offers: [], look: {} };
    const mind = rng.weighted(MINDS) || { id: 'plain', likes: [], dislikes: [] };
    const mood = rng.weighted(MOODS, m => wOf(m, bias.moods)) || { id: 'calm', energy: 0.6, leaveShift: 0, likeTopics: [], hateTopics: [], likes: [], dislikes: [] };
    const sex = od?.look?.sex || (rng.chance(role.fem ?? (1 - TC.male)) ? 'f' : 'm');
    const traits = {};
    const base = arch.traits || {}, mt = mind.traits || {};
    for (const k of TRAITS) traits[k] = clamp((base[k] ?? 0.5) + (mt[k] ?? 0) + rng.range(-0.12, 0.12), 0, 1);
    if (od) { traits.social = Math.max(traits.social, 0.75); traits.open = Math.max(traits.open, 0.65); }
    // темы: 2 из роли (первые вероятнее) + из склонностей архетипа/настроения/чудика + случайная; 3..5
    const topics = [];
    const add = t => { if (t && !topics.includes(t) && (!C.TOPICS || TOPICS.some(x => x.id === t))) topics.push(t); };
    if (od?.befriend?.topic) add(od.befriend.topic);
    const rt = role.topics || [];
    for (let k = 0; k < 6 && topics.length < 2 && rt.length; k++) add(rng.weighted(rt, t => rt.length - rt.indexOf(t)));
    if (bias.topics?.length && rng.chance(0.8)) add(rng.pick(bias.topics));
    if (mood.likeTopics?.length && rng.chance(0.4)) add(rng.pick(mood.likeTopics));
    const want = rng.int(TC.topics[0], TC.topics[1]);
    for (let k = 0; k < 12 && topics.length < want && TOPICS.length; k++) add(rng.weighted(TOPICS).id);
    // нужда/предложение: роль ∪ склонности архетипа, веса NEEDS.weight × bias
    const pickNeed = (ids, b, not) => {
      const cand = [...new Set([...(ids || []), ...Object.keys(b || {})])].filter(n => n !== not && (NEEDS[n] || !C.NEEDS));
      return cand.length ? rng.weighted(cand, n => (NEEDS[n]?.weight ?? 1) * (b?.[n] ?? 1)) : null;
    };
    const need = od ? (od.need ?? null) : pickNeed(role.needs, bias.needs, null);
    const offer = od ? (od.offer ?? null) : pickNeed(role.offers, bias.offers, need);
    let arrive;
    if (od) arrive = Array.isArray(od.arrive) ? rng.range(od.arrive[0], od.arrive[1]) : (od.arrive ?? rng.range(start + 1, start + 2.5));
    else arrive = rng.range(arch.arrive?.[0] ?? start + 1, arch.arrive?.[1] ?? start + 2);
    const leave = stayOf(rng, od?.stay || arch.stay, arrive) + (mood.leaveShift || 0);
    const origin = ORI?.from?.length ? rng.weighted(ORI.from) : null;
    const since = arch.since || (ORI?.since?.length ? rng.weighted(ORI.since).id : null);
    const age = od?.look?.age || rng.int(...(role.age || TC.age));
    const smoker = (arch.zones || []).includes('street') || rng.chance(TC.smokers);
    const name = pickName(sex, origin);
    const lastPool = names.last?.[sex];
    return {
      id: 'p' + i, name, last: lastPool?.length ? rng.pick(lastPool) : null, sex, age,
      look: null, seed: (rng.next() * 0x7fffffff) | 0,
      lookHints: { sex, age, style: role.look?.style || 'it', prop: od?.prop || null, oddball: od ? od.id : null, ...(od?.look || {}) },
      role: role.id, job: role.jobs?.length ? rng.pick(role.jobs) : (role.title || ''), roleTitle: role.title || '', roleIcon: role.icon, it: role.it !== false,
      mind: mind.id, mood: mood.id, archetype: arch.id, oddball: od ? od.id : null,
      from: origin?.id || null, since,
      need, offer, topics, traits, smoker,
      energy: clamp(mood.energy ?? 0.6, 0.1, 1),
      battery: mind.battery ?? 1,
      feel: clamp(0.1 + 0.4 * ((mood.energy ?? 0.6) - 0.5), -1, 1),
      rapport: 0, step: 0, known: { name: false, job: false, role: false, topics: false, mind: false, need: false },
      x: 0, z: 0, rot: 0, pose: 'stand', prop: od?.prop || null, speaking: false,
      state: 'out', present: false, group: null, seat: null, home: null, partner: null,
      arrive, leave, early: false, late: false,
      plan: { kind: 'home' }, nav: null, think: 0, ties: {}, cold: 0,
      barAt: 0, smokeAt: 0, aloneSince: 0, comeTo: null, meet: false, talks: 0,
    };
  }

  let i = 0;
  const push = p => { people.push(p); return p; };
  for (let k = 0; k < nEarly; k++) {
    const p = push(make(i++, archPick(earlyArch.length ? earlyArch : ARCH), null));
    p.arrive = rng.range(start - 0.2, start + 0.05); p.leave = Math.max(p.leave, start + 2); p.early = true;
  }
  for (let k = 0; k < nLate; k++) {
    const p = push(make(i++, archPick(lateArch.length ? lateArch : ARCH), null));
    p.arrive = Math.max(p.arrive, TC.lateFrom + rng.range(0, 1.2)); p.leave = Math.max(p.leave, p.arrive + 1); p.late = true;
  }
  while (people.length < TC.total - nOdd) {
    const a = archPick(midArch.length ? midArch : ARCH);
    const p = push(make(i++, a, null));
    p.arrive = clamp(p.arrive, start + 0.45, TC.lateFrom - 0.1);
    p.leave = Math.max(p.leave, p.arrive + 0.5);
    // «пара»: второй — тот же архетип, приходят и уходят вместе
    if (a.pair && people.length < TC.total - nOdd) {
      const q = push(make(i++, a, null));
      q.arrive = p.arrive + 0.01; q.leave = p.leave; q.partner = p.id; p.partner = q.id; q.second = true;
      p.ties[q.id] = q.ties[p.id] = 1; p.couple = q.couple = true;
    }
  }
  for (let k = 0; k < nOdd; k++) {
    const od = rng.weighted(oddPool); oddPool.splice(oddPool.indexOf(od), 1);
    const p = push(make(i++, archPick(midArch.length ? midArch : ARCH), od));
    p.leave = Math.max(p.leave, p.arrive + 1.2);
    // досидеть до своего события
    const ev = (C.EVENTS || []).find(e => e.id === od.event || e.by === od.id);
    if (ev?.at) p.leave = Math.max(p.leave, ev.at[1] + 0.15);
  }
  fixSchedule(people, T, rng);
  return people;
}

// кривая вечера — инвариант: в контрольных точках пика присутствующих в [lo, hi], после пика ≤ hi,
// в after.at ≤ after.max; до закрытия досиживают last
function fixSchedule(people, T, rng) {
  const TC = T.crowd, [pa, pb] = TC.peak.at, end = T.time.end, start = T.time.start;
  // запас в одного человека с каждой стороны: разговор с игроком задерживает уходящего, события уводят раньше
  const m1 = TC.peak.n[1] - TC.peak.n[0] >= 4 ? 1 : 0, lo = TC.peak.n[0] + m1, hi = TC.peak.n[1] - m1;
  const marks = [];
  for (let h = pa; h <= pb + 1.001; h += 0.1) marks.push({ h: +h.toFixed(2), lo: h <= pb + 1e-6 ? lo : 0, hi });
  if (TC.after) marks.push({ h: TC.after.at, lo: 0, hi: TC.after.max });
  const here = (p, h) => p.arrive <= h && p.leave + TC.walkOut > h;   // уходящий ещё идёт к выходу
  const count = h => { let n = 0; for (const p of people) if (here(p, h)) n++; return n; };
  const movable = p => !p.early && !p.oddball && !p.partner;
  for (let it = 0; it < 2000; it++) {
    let ok = true;
    for (const m of marks) {
      const h = m.h, n = count(h);
      if (n > m.hi) {
        ok = false;
        const c = people.filter(p => here(p, h) && movable(p));
        if (!c.length) break;
        const p = rng.pick(c);
        if (h > pb) {                                   // после пика: кто-то уходит пораньше
          if (p.arrive < pb) p.leave = rng.range(pb + 0.05, h - TC.walkOut);
          else { p.arrive = rng.range(h + 0.05, h + 0.6); p.leave = Math.max(p.leave, p.arrive + 0.8); }
        } else if (p.arrive < pa - 1.2) p.leave = rng.range(Math.max(p.arrive + 0.8, pa - 0.9), pa - 0.1 - TC.walkOut);
        else { p.arrive = rng.range(pb + 0.1, pb + 0.9); p.leave = Math.max(p.leave, p.arrive + 1); p.late = true; }
      } else if (n < m.lo) {
        ok = false;
        const c = people.filter(p => !here(p, h) && movable(p));
        if (!c.length) break;
        const p = rng.pick(c);
        if (p.arrive <= h) p.leave = rng.range(pb + 0.2, pb + 1.2);
        else { p.arrive = rng.range(start + 0.6, pa - 0.3); p.late = false; p.leave = Math.max(p.leave, pb + 0.2); }
      }
    }
    if (ok) break;
  }
  // последние до закрытия: из тех, кто есть в конце «потолка после пика» (их продление кривую не ломает)
  const tail = TC.after ? TC.after.at : pb;
  const need = rng.int(TC.last[0], TC.last[1]);
  let have = people.filter(p => p.leave >= end - 0.1).length;
  const c = rng.shuffle(people.filter(p => p.leave < end - 0.1 && p.leave > tail && p.arrive <= tail));
  while (have < need && c.length) { c.pop().leave = end + 0.5; have++; }
  for (const p of people) {
    p.leave = Math.max(p.leave, p.arrive + 0.5);
    if (p.second) { const q = people.find(x => x.id === p.partner); if (q) { p.arrive = q.arrive + 0.01; p.leave = q.leave = Math.max(q.leave, p.leave); } }
  }
}

return { makeCrowd, fixSchedule };
});
