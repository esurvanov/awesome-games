// Диалоги-вопросы (CONTRACT §8): Мозг спрашивает через bus 'dialog', Интерфейс отвечает answer().
import { ensureBrain, nextUid } from './util.js';

export const DIALOG_HANDLERS = {};
// Колбэки onAnswer — вне state (несериализуемы): после загрузки сохранения вопрос без колбэка просто закроется
const CALLBACKS = new Map();

export function ask(state, bus, { kind = 'custom', simId, icon, text, options, data }, onAnswer) {
  const b = ensureBrain(state);
  b.dialogs ??= {};
  const id = nextUid(state);
  b.dialogs[id] = { kind, simId, options, data };
  if (onAnswer) CALLBACKS.set(id, onAnswer);
  bus.emit('dialog', { id, ...(simId != null && { simId }), icon, text, options });
  return id;
}

export function answer(state, bus, id, key) {
  const d = state.brain?.dialogs?.[id];
  if (!d || !d.options.some(o => o.key === key)) return false;
  delete state.brain.dialogs[id];
  const cb = CALLBACKS.get(id);
  CALLBACKS.delete(id);
  cb?.(key, { id, simId: d.simId, data: d.data });
  DIALOG_HANDLERS[d.kind]?.(state, bus, d, key);
  return true;
}
