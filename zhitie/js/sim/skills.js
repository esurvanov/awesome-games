// Навыки 0..10: прирост за игровую минуту на предмете, в плохом настроении не растут (✅ TS1).
import { SKILLS, MOOD } from '../core/tuning.js';
import { mood } from './motives.js';
import { notify, speak } from './util.js';

const NAMES = { cooking: 'Кулинария', mechanical: 'Механика', charisma: 'Обаяние', body: 'Тело', logic: 'Логика', creativity: 'Творчество' };

export function gainSkill(state, bus, sim, name, minutes, mult = 1) {
  if (!name || sim.age === 'child' || sim.npc || mood(sim) < MOOD.bad) return 0;   // ✅ TS1: навыки только у взрослых
  const cur = sim.skills[name] ?? 0;
  if (cur >= SKILLS.max) return 0;
  const next = Math.min(SKILLS.max, cur + (SKILLS.perHour(cur) * mult * minutes) / 60);
  sim.skills[name] = next;
  if (Math.floor(next) > Math.floor(cur)) {
    speak(state, bus, sim, '⭐');
    notify(bus, `${sim.name}: ${NAMES[name]} — уровень ${Math.floor(next)}`, '⭐', sim.id);
    bus.emit('sfx', { name: 'skill' });
    bus.emit('skill:up', { simId: sim.id, skill: name, level: Math.floor(next) });
  }
  return next - cur;
}
