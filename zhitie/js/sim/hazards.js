// Грязь, посуда, мусор, поломки, ремонт с ударом током, пожары.
import { DIRT, BREAK, FIRE, FIREPLACE } from '../core/tuning.js';
import { byId } from '../../data/catalog.js';
import { BREAKABLE } from '../../data/interactions.js';
import { rand, notify, speak, setAnim, dist, objById, objRectOf, clampM, isPresent, runtime, K } from './util.js';
import { pushItem } from './queue.js';
import { later } from './timers.js';
import { die } from './death.js';

const breakGroup = def => (def.cat === 'plumbing' ? 'plumbing' : def.depr);

// ── Посуда и мусор ────────────────────────────────────────────────────
export function placeDishes(state, bus, sim) {
  const hosts = state.objects.filter(o => ['dining_table', 'coffee_table', 'counter'].includes(K(o)) && (o.level ?? 0) === (sim.level ?? 0) && !o.st.burnt);
  const c = o => { const r = objRectOf(o, byId[o.def]); return { x: r.X + r.W / 2, y: r.Y + r.D / 2 }; };
  const host = hosts.filter(o => dist(c(o), sim) <= DIRT.hostRadius + 1).sort((a, b) => dist(c(a), sim) - dist(c(b), sim))[0];
  if (host) {
    host.st.dishes = (host.st.dishes ?? 0) + DIRT.dishesPerMeal;
    host.st.dirty = Math.min(100, (host.st.dirty ?? 0) + DIRT.dishDirty);
    bus.emit('object:changed', { id: host.id });
  } else addTrash(state, bus, Math.floor(sim.x), Math.floor(sim.y), sim.level ?? 0);
}

export function addTrash(state, bus, x, y, level) {
  (state.lot.trash ??= []).push({ x, y, level });
  bus.emit('lot:changed', { level, kind: 'trash' });
}

// В ведро; переполнено — мусор на пол рядом
export function toTrashCan(state, bus, sim, n = 1) {
  const can = state.objects.filter(o => K(o) === 'trash_can').sort((a, b) => dist(a, sim) - dist(b, sim))[0];
  if (!can) return addTrash(state, bus, Math.floor(sim.x), Math.floor(sim.y), sim.level ?? 0);
  can.st.fill = (can.st.fill ?? 0) + n;
  if (can.st.fill > DIRT.trashCap) { can.st.fill = DIRT.trashCap; addTrash(state, bus, can.x, can.y + 1, can.level ?? 0); }
  can.st.dirty = Math.round((can.st.fill / DIRT.trashCap) * 60);
  bus.emit('object:changed', { id: can.id });
}

// ── Поломки ───────────────────────────────────────────────────────────
export function rollBreak(state, bus, sim, obj) {
  const def = byId[obj.def];
  if (!def || !BREAKABLE.has(K(obj)) || obj.st.broken) return false;
  if (rand(state) >= (BREAK.perUse[breakGroup(def)] ?? 0)) return false;
  obj.st.broken = true;
  bus.emit('object:changed', { id: obj.id });
  notify(bus, `Сломалось: ${def.name}`, '🔧', sim?.id);
  bus.emit('want', { e: { kind: 'event', what: 'broken' } });
  bus.emit('sfx', { name: 'break' });
  return true;
}

// Удар током при ремонте электроники с низкой механикой
export function rollShock(state, bus, sim, obj) {
  const def = byId[obj.def];
  if (def?.depr !== 'electronics') return false;
  const S = BREAK.shock;
  const p = S.base * Math.max(0, 1 - (sim.skills.mechanical ?? 0) / S.safeSkill);
  if (rand(state) >= p) return false;
  speak(state, bus, sim, '⚡');
  setAnim(sim, bus, 'cry', { once: true });
  sim.motives.energy = clampM(sim.motives.energy - 30);
  sim.motives.hygiene = clampM(sim.motives.hygiene - 20);
  notify(bus, `${sim.name}: удар током!`, '⚡', sim.id);
  bus.emit('want', { simId: sim.id, e: { kind: 'event', what: 'shock' } });
  bus.emit('sfx', { name: 'shock' });
  const wet = (state.lot.puddles ?? []).some(p => p.x === Math.floor(sim.x) && p.y === Math.floor(sim.y));
  if ((S.puddleDeath && wet) || rand(state) < S.deathChance) die(state, bus, sim, 'shock');
  return true;
}

// ── Огонь ─────────────────────────────────────────────────────────────
const fires = state => (state.lot.fires ??= []);
export const hasAlarm = (state, def) => state.objects.some(o => K(o) === def && !o.st.burnt);

export function rollFire(state, bus, sim, obj) {
  const p = FIRE.base * Math.max(0, 1 - (sim.skills.cooking ?? 0) / FIRE.safeSkill);
  if (rand(state) >= p) return false;
  startFire(state, bus, obj.x, obj.y, obj.level ?? 0);
  return true;
}

export function startFire(state, bus, x, y, level, power = 0.3) {
  const F = fires(state);
  if (F.some(f => f.x === x && f.y === y && f.level === level)) return;
  const first = F.length === 0;
  F.push({ x, y, level, power, age: 0 });
  bus.emit('fire:start', { x, y });
  bus.emit('lot:changed', { level, kind: 'fire' });
  if (!first) return;
  notify(bus, 'Пожар!', '🔥');
  if (hasAlarm(state, 'smoke_alarm')) {
    bus.emit('sfx', { name: 'alarm' });
    notify(bus, 'Датчик дыма сработал — пожарные едут', '🚒');
    if (!state.brain.fireCalled) { state.brain.fireCalled = true; later(state, FIRE.brigadeDelay, 'spawnNpc', { npc: 'fire' }); }
  } else notify(bus, 'Датчика дыма нет — пожарные не приедут', '⚠️');
}

export function putOut(state, bus, fire) {
  const F = fires(state), i = F.indexOf(fire);
  if (i < 0) return;
  F.splice(i, 1);
  bus.emit('fire:out', { x: fire.x, y: fire.y });
  bus.emit('lot:changed', { level: fire.level, kind: 'fire' });
  if (!F.length) { state.brain.fireCalled = false; notify(bus, 'Пожар потушен', '🧯'); }
}

const objsAt = (state, x, y, level) => state.objects.filter(o => {
  if ((o.level ?? 0) !== level) return false;
  const r = objRectOf(o, byId[o.def]);
  return x >= r.X && y >= r.Y && x < r.X + r.W && y < r.Y + r.D;
});
const flammable = o => FIRE.flammableCats.includes(byId[o.def]?.cat) && byId[o.def]?.place === 'floor';

// Тик пожаров (раз в 2 мин): рост, поджог предметов, распространение, ожоги, паника
export function tickFires(state, bus, minutes) {
  for (const fp of state.objects) if (K(fp) === 'fireplace' && fp.st.lit) {     // горящий камин: изредка искра на соседей
    if (state.time.minutes - fp.st.lit > FIREPLACE.burnHours * 60) { fp.st.lit = 0; bus.emit('object:changed', { id: fp.id }); continue; }
    if (rand(state) < FIREPLACE.firePer2Min * (minutes / 2)) {
      const near = state.objects.filter(o => o !== fp && flammable(o) && (o.level ?? 0) === (fp.level ?? 0) && Math.abs(o.x - fp.x) <= 1 && Math.abs(o.y - fp.y) <= 2);
      const t = near[Math.floor(rand(state) * near.length)] ?? fp;
      startFire(state, bus, t.x, t.y, t.level ?? 0);
    }
  }
  const F = fires(state);
  if (!F.length) { for (const s of state.sims) s.brain.burn = 0; return; }
  for (const f of [...F]) {
    f.power = Math.min(1, f.power + FIRE.grow * (minutes / 2));
    f.age += minutes;
    if (f.power >= FIRE.burnAt) for (const o of objsAt(state, f.x, f.y, f.level)) if (!o.st.burnt) {
      o.st.burnt = true; o.st.broken = true; bus.emit('object:changed', { id: o.id });
    }
    if (f.power >= FIRE.spreadAt && rand(state) < FIRE.spreadChance) {
      const near = state.objects.filter(o => flammable(o) && !o.st.burnt && (o.level ?? 0) === f.level && Math.abs(o.x - f.x) <= 1 && Math.abs(o.y - f.y) <= 1
        && !F.some(g => g.x === o.x && g.y === o.y));
      const t = near[Math.floor(rand(state) * near.length)];
      if (t) startFire(state, bus, t.x, t.y, f.level, 0.2);
    }
    if (f.age >= FIRE.burnoutMinutes) putOut(state, bus, f);
  }
  for (const s of state.sims) {
    if (s.dead || s.atWork || s.npc === 'fire') continue;
    const hot = F.some(f => f.level === (s.level ?? 0) && f.power >= 0.5 && dist({ x: f.x + 0.5, y: f.y + 0.5 }, s) <= FIRE.burnRadius);
    s.brain.burn = hot ? (s.brain.burn ?? 0) + minutes : 0;
    if (s.brain.burn >= FIRE.burnDeathMinutes) die(state, bus, s, 'fire');
  }
  panic(state, bus);
}

function panic(state, bus) {
  const F = fires(state);
  const alarm = hasAlarm(state, 'smoke_alarm');
  for (const s of state.sims) {
    if (!isPresent(s) || (s.npc && s.npc !== 'visitor') || (s.asleep && !alarm)) continue;
    if (s.act?.key === 'panic' || s.queue.some(q => q.interaction === 'panic')) continue;
    const f = F.filter(f => f.level === (s.level ?? 0)).sort((a, b) => dist(a, s) - dist(b, s))[0];
    if (!f || dist({ x: f.x + 0.5, y: f.y + 0.5 }, s) > FIRE.panicRadius) continue;
    // бежать прочь от огня
    let dx = s.x - (f.x + 0.5), dy = s.y - (f.y + 0.5);
    const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    let tx = Math.round(s.x + dx * FIRE.fleeDist), ty = Math.round(s.y + dy * FIRE.fleeDist);
    tx = Math.max(0, Math.min(state.lot.w - 1, tx)); ty = Math.max(0, Math.min(state.lot.h - 1, ty));
    const w = runtime.world;
    const free = w?.nearestFree?.(state, s.level ?? 0, tx, ty) ?? { x: tx, y: ty };
    s.queue = s.queue.filter(q => q.by === 'user' && q.uid !== s.act?.uid || q.uid === s.act?.uid);
    pushItem(state, bus, s, { interaction: 'panic', target: { kind: 'internal', x: free.x, y: free.y }, by: 'auto', prio: 100, icon: '😱' });
    if (s.act && s.act.key !== 'panic') s.act.cancel = true;
    speak(state, bus, s, '😱');
  }
}

export const onFire = (state, x, y, level) => fires(state).some(f => f.x === x && f.y === y && f.level === level);
