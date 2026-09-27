// Состояние игры — один JSON-сериализуемый объект (см. docs/CONTRACT.md §3).
export const SAVE_VERSION = 1;

export function createState(w = 30, h = 30) {
  return {
    version: SAVE_VERSION,
    time: { minutes: 7 * 60, speed: 1 },
    mode: 'live',
    household: { name: 'Ивановы', money: 20000, lastBillDay: 0, bills: [] },
    lot: {
      w, h, rooms: [],
      levels: [0, 1].map(() => ({
        floor: Array(w * h).fill(0),
        wallH: Array(w * (h + 1)).fill(0),
        wallV: Array((w + 1) * h).fill(0),
      })),
    },
    objects: [],
    sims: [],
    nextId: 1,
  };
}

export const newId = state => state.nextId++;

export function save(state, key = 'zhitie.save') {
  try { localStorage.setItem(key, JSON.stringify(state)); return true; } catch { return false; }
}

export function load(key = 'zhitie.save') {
  try {
    const s = JSON.parse(localStorage.getItem(key));
    return s && s.version === SAVE_VERSION ? s : null;
  } catch { return null; }
}
