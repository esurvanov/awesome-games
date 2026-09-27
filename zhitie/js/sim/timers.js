// Отложенные события (приезд пиццы, мастера, пожарных, Смерти…) — в state.brain.timers, сериализуемо.
import { ensureBrain } from './util.js';

export const TIMER_HANDLERS = {};

export function later(state, minutes, kind, data = {}) {
  const b = ensureBrain(state);
  (b.timers ??= []).push({ at: state.time.minutes + minutes, kind, data });
}

export function runTimers(state, bus, world) {
  const T = state.brain?.timers;
  if (!T?.length) return;
  const now = state.time.minutes;
  const due = T.filter(t => t.at <= now);
  if (!due.length) return;
  state.brain.timers = T.filter(t => t.at > now);
  for (const t of due) TIMER_HANDLERS[t.kind]?.(state, bus, world, t.data);
}
