// Потребности: распад TS1 (research §2.1), эффекты действий, настроение, провалы.
import { DECAY, CAREER, FAILURE } from '../core/tuning.js';
import { clampM } from './util.js';

export const MOTIVES = ['hunger', 'comfort', 'hygiene', 'bladder', 'energy', 'fun', 'social', 'room'];

export const mood = sim => MOTIVES.reduce((s, k) => s + (sim.motives[k] ?? 0), 0) / MOTIVES.length;

export function comfortRate(active) {
  const c = DECAY.comfort;
  return active > 6.66 ? c.highActive : active < 6.66 ? c.lowActive : c.midActive;
}

// Скорости распада в час (положительное = падение). fx — активное действие: {asleep, comfortPaused, passedOut}
export function decayRates(sim, fx = {}) {
  const m = sim.motives;
  const asleep = !!fx.asleep;
  const hunger = Math.max(DECAY.hungerMin, DECAY.hungerK * (100 + m.hunger));
  const r = {
    hunger,
    comfort: fx.comfortPaused ? 0 : comfortRate(sim.personality.active),
    hygiene: asleep ? DECAY.hygiene.asleep : DECAY.hygiene.awake,
    bladder: (asleep ? DECAY.bladder.asleep : DECAY.bladder.awake) + DECAY.bladder.perHungerDecay * hunger,
    energy: asleep ? 0 : DECAY.energy.awake,
    fun: asleep ? DECAY.fun.asleep : DECAY.fun.awake,
    social: (DECAY.social.base + DECAY.social.perOutgoing * sim.personality.outgoing) * 30,
  };
  if (fx.passedOut) r.energy = -DECAY.energy.passedOutGain;
  if (sim.atWork) for (const k in CAREER.workDecayMul) r[k] *= CAREER.workDecayMul[k];
  return r;
}

// Один тик потребностей длиной `minutes`. effects — {motive: за минуту}. Возвращает провалы.
export function motiveTick(sim, fx, minutes, roomScore) {
  const m = sim.motives;
  const r = decayRates(sim, fx);
  const h = minutes / 60;
  for (const k in r) m[k] = clampM(m[k] - r[k] * h);
  for (const [k, per] of Object.entries(fx.effects ?? {})) {
    const gain = per * minutes;
    m[k] = clampM(m[k] + gain);
    if (k === 'hunger' && gain > 0) m.bladder = clampM(m.bladder - DECAY.bladderPerHungerGain * gain);
  }
  if (roomScore != null) m.room = clampM(roomScore);

  const fail = [];
  if (m.bladder <= -100) fail.push('puddle');
  if (m.energy <= -100 && !fx.asleep) fail.push('passOut');
  if (m.hunger <= FAILURE.starveAt) fail.push('starve');
  return fail;
}
