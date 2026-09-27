// Смерть (голод, огонь, ток): sim:died → Смерть-НПС → надгробие → сим убирается из семьи; семья скорбит.
import { SERVICES, FAMILY } from '../core/tuning.js';
import { abortAll } from './actions.js';
import { later } from './timers.js';
import { placeFree } from './place.js';
import { setAnim, notify, speak, clampM, household, simById } from './util.js';

const CAUSE = { starve: 'от голода', fire: 'в огне', shock: 'от удара током' };

export function die(state, bus, sim, cause) {
  if (sim.dead) return;
  abortAll(state, bus, sim);
  sim.dead = true; sim.deathCause = cause; sim.atWork = null; sim.reaction = null;
  setAnim(sim, bus, 'lieDown', { once: true });
  bus.emit('sim:died', { simId: sim.id, cause });
  notify(bus, `${sim.name} погиб(ла) ${CAUSE[cause] ?? ''}`.trim(), '🪦', sim.id);
  bus.emit('sfx', { name: 'death' });
  if (!sim.npc) for (const o of household(state)) {
    if (o === sim || o.dead) continue;
    o.motives.social = clampM(o.motives.social + FAMILY.mourn.social);
    o.motives.fun = clampM(o.motives.fun + FAMILY.mourn.fun);
    speak(state, bus, o, '😢', sim.id);
  }
  if (!household(state).some(s => !s.dead)) notify(bus, 'В доме больше никого не осталось…', '🕯️');
  later(state, SERVICES.reaperDelay, 'reaper', { bodyId: sim.id });
}

// Хук Смерти: надгробие рядом с телом, тело убрать
export function reap(state, bus, world, bodyId) {
  const body = simById(state, bodyId);
  if (!body) return;
  const x = Math.floor(body.x), y = Math.floor(body.y), level = body.level ?? 0;
  placeFree(state, bus, world, 'tombstone', x, y, level, { of: body.name, simId: body.id, cause: body.deathCause, diedAt: state.time.minutes });
  state.sims.splice(state.sims.indexOf(body), 1);
  bus.emit('sim:removed', { id: body.id });
}

