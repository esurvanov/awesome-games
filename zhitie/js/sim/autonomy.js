// Автономия: формула FreeSO VMFindBestAction (research §2.2) — сумма выигрышей по кривым потребностей,
// деление на (1 + atten·дистанция), top-4 → взвешенный случайный выбор (RNG из state).
import { AUTONOMY, SCORE_CURVE, MOOD, PRIORITY, MOTIVE_ICON, VISITOR_ATTEN, LEVEL_PENALTY } from '../core/tuning.js';
import { INTERACTIONS, rateScale } from '../../data/interactions.js';
import { mood } from './motives.js';
import { getRel, relBetween, targetBusy, socialsFor } from './social.js';
import { hasRoom } from './actions.js';
import { pushItem } from './queue.js';
import { rand, dist, objCenter, hourOf, isPresent, speak, relKey, K } from './util.js';

// Кусочно-линейная кривая «неудовольствия»
export function curve(motive, v) {
  const pts = SCORE_CURVE[motive] ?? SCORE_CURVE.default;
  if (v <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    if (v <= x1) { const [x0, y0] = pts[i - 1]; return y0 + ((y1 - y0) * (v - x0)) / (x1 - x0); }
  }
  return pts[pts.length - 1][1];
}

function persMul(sim, pers) {
  if (!pers) return 1;
  const inv = pers.startsWith('-');
  const t = sim.personality[pers.replace('-', '')] ?? 5;
  return AUTONOMY.persFactor(inv ? 10 - t : t);
}

function isNight(h) { const n = AUTONOMY.nightSleep; return h >= n.from || h < n.to; }

// Оценка набора реклам для сима (без дистанции). src:'baby' — потребность малыша из кроватки obj
export function scoreAds(sim, ads, { hour = 12, sleepAd = false, obj = null } = {}) {
  let score = 0;
  for (const a of ads ?? []) {
    const m = a.src === 'baby' ? obj?.st?.baby?.[a.motive] : sim.motives[a.motive];
    if (m == null) continue;
    let min = a.min, mul = 1;
    if (sleepAd && a.motive === 'energy' && isNight(hour)) { min = Math.max(min, AUTONOMY.nightSleep.energyMin); mul = AUTONOMY.nightSleep.mult; }
    if (m > min) continue;                                      // реклама видна, только если потребность ниже min
    const to = Math.min(100, m + a.delta * persMul(sim, a.pers) * (obj && !a.src ? rateScale(obj, a.motive) : 1));
    score += AUTONOMY.weight * (curve(a.motive, m) - curve(a.motive, to)) * mul;
  }
  return score;
}

// Можно ли симу это взаимодействие по возрасту/роли/состоянию предмета
export function allowed(sim, it, obj, { visitor = false, bad = false, auto = false } = {}) {
  if (obj?.st?.burnt) return false;
  if (obj?.st?.broken && !it.whenBroken) return false;
  if (it.adult && sim.age === 'child') return false;
  if (it.child && sim.age !== 'child') return false;
  if (auto && it.autoMinMech != null && (sim.skills.mechanical ?? 0) < it.autoMinMech) return false;
  if (bad && (it.goodMood || it.skillAd)) return false;          // ✅ в плохом настроении — без навыков
  if (visitor && (it.goodMood || it.skillAd || it.whenBroken || it.advertisements?.some(a => a.motive === 'room' || a.src))) return false;
  return true;
}

// Все кандидаты для сима → [{score, item, motive}]
export function candidates(state, sim, { visitor = false } = {}) {
  const now = state.time.minutes, hour = hourOf(now);
  const bad = mood(sim) < MOOD.bad;
  const AT = visitor ? VISITOR_ATTEN : AUTONOMY.atten;
  const out = [];
  const add = (score, item, ads) => {
    if (score > AUTONOMY.minScore) {
      const own = ads.filter(a => !a.src);
      const motive = own.length ? own.reduce((w, a) => (sim.motives[a.motive] < sim.motives[w] ? a.motive : w), own[0].motive) : ads[0].motive;
      out.push({ score, item, motive });
    }
  };
  const far = o => dist(objCenter(o), sim) + ((o.level ?? 0) !== (sim.level ?? 0) ? LEVEL_PENALTY : 0);
  for (const o of state.objects) {
    if (sim.brain.blocked?.[o.id] > now) continue;
    if (!hasRoom(o, sim.id)) continue;
    const d = far(o);
    for (const it of INTERACTIONS[K(o)] ?? []) {
      if (!it.advertisements?.length || !allowed(sim, it, o, { visitor, bad, auto: true })) continue;
      if (it.dayOnly && isNight(hour)) continue;               // ночью не «дремлют», а спят
      if (it.nightAd && !isNight(hour)) continue;              // на звёзды — ночью
      const ctx = { state, sim, obj: o };
      if (it.show && !it.show(ctx)) continue;
      if (it.check?.(ctx)) continue;
      const atten = AT[it.advertisements[0].atten ?? 'medium'];
      const sc = scoreAds(sim, it.advertisements, { hour, sleepAd: it.sleepAd, obj: o }) / (1 + atten * d);
      add(sc, { objId: o.id, interaction: it.key, target: { kind: 'object', id: o.id }, icon: it.icon }, it.advertisements);
    }
  }
  for (const t of state.sims) {
    if (t === sim || !isPresent(t) || targetBusy(t)) continue;
    if (t.npc && !['townie', 'visitor'].includes(t.npc)) continue;
    if (visitor && t.npc) continue;
    if (sim.brain.socialCd?.[relKey(t)] > now) continue;       // пара недавно общалась
    const d = dist(t, sim) + ((t.level ?? 0) !== (sim.level ?? 0) ? LEVEL_PENALTY : 0);
    const menu = socialsFor(sim, t);
    for (const so of menu) {
      if (!so.advertisements) continue;
      if (so.autoOnly && so.autoOnly !== t.npc) continue;
      const r = relBetween(t, sim), mine = getRel(sim, relKey(t));
      if (so.autoMinRel != null && mine < so.autoMinRel) continue;
      if (so.autoMaxRel != null && mine > so.autoMaxRel) continue;
      if (r < so.minRel) continue;
      const atten = AT[so.advertisements[0].atten];
      const sc = scoreAds(sim, so.advertisements, { hour }) / (1 + atten * d);
      add(sc, { interaction: so.key, target: { kind: 'sim', id: t.id }, icon: so.icon }, so.advertisements);
    }
  }
  if (!visitor && sim.age !== 'child') {                      // лужи и мусор на полу: чистюли убирают сами
    const ads = [{ motive: 'room', delta: 30, min: 100, pers: 'neat', atten: 'medium' }];
    for (const [key, list] of [['clean_puddle', state.lot.puddles], ['clean_trash', state.lot.trash]]) for (const p of list ?? []) {
      const sc = scoreAds(sim, ads) / (1 + AUTONOMY.atten.medium * (dist({ x: p.x + 0.5, y: p.y + 0.5 }, sim) + ((p.level ?? 0) !== (sim.level ?? 0) ? LEVEL_PENALTY : 0)));
      add(sc, { interaction: key, target: { kind: 'tile', x: p.x, y: p.y, level: p.level ?? 0 }, icon: '🧽' }, ads);
    }
  }
  return out;
}

// top-N → взвешенный случайный
export function pick(state, list) {
  if (!list.length) return null;
  const top = [...list].sort((a, b) => b.score - a.score).slice(0, AUTONOMY.topN);
  const sum = top.reduce((s, c) => s + c.score, 0);
  let r = rand(state) * sum;
  for (const c of top) if ((r -= c.score) <= 0) return c;
  return top[top.length - 1];
}

export function think(state, bus, world, sim, opts = {}) {
  const c = pick(state, candidates(state, sim, opts));
  if (!c) {
    sim.brain.nextThink = state.time.minutes + 3;
    if (world?.findPath && rand(state) < AUTONOMY.wanderChance) {
      const R = AUTONOMY.wanderRadius;
      const x = Math.floor(sim.x + (rand(state) * 2 - 1) * R), y = Math.floor(sim.y + (rand(state) * 2 - 1) * R);
      if (x >= 0 && y >= 0 && x < state.lot.w && y < state.lot.h) pushItem(state, bus, sim, { interaction: 'wander', target: { kind: 'internal', x, y, level: sim.level ?? 0 }, by: 'auto', icon: '🚶' });
    }
    return null;
  }
  if (sim.motives[c.motive] < MOOD.thoughtBelow) speak(state, bus, sim, MOTIVE_ICON[c.motive] ?? c.item.icon);
  pushItem(state, bus, sim, { ...c.item, by: 'auto', prio: PRIORITY.auto });
  return c;
}
