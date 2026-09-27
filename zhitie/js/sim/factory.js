// Создание записи сима (семья, дети, НПС) — одна форма для всех.
import { FLOOR_HEIGHT } from '../core/tuning.js';

// Утро нового дня: выспались, но голодны, пора в туалет и в душ — первые минуты сразу заняты делом
const DEFAULT_MOTIVES = { hunger: 35, comfort: 60, hygiene: 40, bladder: 30, energy: 90, fun: 55, social: 50, room: 0 };
const DEFAULT_PERS = { neat: 5, outgoing: 5, active: 5, playful: 5, nice: 5 };
const DEFAULT_SKILLS = { cooking: 0, mechanical: 0, charisma: 0, body: 0, logic: 0, creativity: 0 };

export function makeSim(state, spec = {}) {
  const id = state.nextId++;
  const career = typeof spec.career === 'string' ? { track: spec.career, level: 1, perf: 0, missed: 0 }
    : spec.career ? { perf: 0, missed: 0, level: 1, ...spec.career } : null;
  const level = spec.level ?? 0;
  return {
    id, name: spec.name ?? `Сим ${id}`, look: spec.look ?? {},
    x: spec.x ?? 1.5, y: spec.y ?? 1.5, level, z: level * FLOOR_HEIGHT, facing: spec.facing ?? 0,
    motives: { ...DEFAULT_MOTIVES, ...spec.motives },
    personality: { ...DEFAULT_PERS, ...spec.personality },
    skills: { ...DEFAULT_SKILLS, ...spec.skills },
    career, rel: { ...spec.rel }, love: { ...spec.love },
    age: spec.age ?? 'adult',
    ...(spec.hoodId && { hoodId: spec.hoodId }), ...(spec.aspiration && { aspiration: spec.aspiration }), ...(spec.bio && { bio: spec.bio }),
    ...(spec.age === 'child' && { school: { grade: 70, homework: false, ...spec.school } }),
    queue: [], act: null, anim: 'idle', animTarget: null, bubble: null, path: null,
    posture: 'stand', asleep: false, atWork: null, dead: false, reaction: null,
    ...(spec.npc && { npc: spec.npc, household: false, npcTask: spec.npcTask ?? {} }),
    ...(spec.townieId && { townieId: spec.townieId }),
    brain: { nextThink: 0, blocked: {}, carpoolDay: -1, workedDay: -1, missedDay: -1, stats: {}, earned: 0, burn: 0 },
  };
}
