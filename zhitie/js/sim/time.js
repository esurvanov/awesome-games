// Часы: события time:hour / time:day и суточные дела (полночь — деньги, 16:00 — остывание отношений).
import { REL } from '../core/tuning.js';
import { midnight } from './money.js';
import { relDecay } from './social.js';

export function crossHours(state, bus, t0, t1, onHour) {
  for (let h = Math.floor(t0 / 60) + 1; h <= Math.floor(t1 / 60); h++) {
    const hour = h % 24;
    bus.emit('time:hour', { hour });
    if (hour === 0) { const day = h / 24; midnight(state, bus); bus.emit('time:day', { day }); }
    if (hour === REL.decayHour) relDecay(state);
    onHour?.(hour);
  }
}
