// Очередь действий: приоритеты ✅ (user 50 > carpool 45 > auto 2), команда игрока вытесняет автономию,
// отмена текущего → доигрывается выходная анимация. queue[0] — текущее действие, если sim.act есть.
import { PRIORITY, QUEUE_MAX } from '../core/tuning.js';
import { nextUid, notify } from './util.js';

export function pushItem(state, bus, sim, item) {
  if (sim.queue.length >= QUEUE_MAX) { if (item.by === 'user') notify(bus, `${sim.name}: очередь заполнена`, '⏳', sim.id); return null; }
  const it = { uid: nextUid(state), prio: item.by === 'user' ? PRIORITY.user : PRIORITY.auto, ...item };
  // вставка по приоритету, стабильно; текущее действие (queue[0]) не сдвигаем
  let i = sim.act ? 1 : 0;
  while (i < sim.queue.length && sim.queue[i].prio >= it.prio) i++;
  sim.queue.splice(i, 0, it);
  // вытеснение: более важное действие прерывает текущее автономное
  if (sim.act && !sim.act.cancel && it.prio > (sim.act.prio ?? 0) && sim.act.by !== 'user') sim.act.cancel = true;
  // автономные хвосты убираем, если игрок что-то приказал
  if (it.by === 'user') sim.queue = sim.queue.filter(q => q === it || q.by === 'user' || (sim.act && q.uid === sim.act.uid) || q.prio > PRIORITY.auto);
  return it.uid;
}

export function cancelItem(state, bus, sim, uid) {
  if (sim.act && sim.act.uid === uid) { sim.act.cancel = true; return true; }
  const n = sim.queue.length;
  sim.queue = sim.queue.filter(q => q.uid !== uid);
  return sim.queue.length !== n;
}

export const removeItem = (sim, uid) => { sim.queue = sim.queue.filter(q => q.uid !== uid); };
export const hasKey = (sim, key) => sim.queue.some(q => q.interaction === key);
