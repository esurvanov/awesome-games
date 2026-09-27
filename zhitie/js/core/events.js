// Шина событий — единственный канал между модулями (см. docs/CONTRACT.md §4).
export function createBus() {
  const map = new Map();
  return {
    on(type, fn) { (map.get(type) || map.set(type, new Set()).get(type)).add(fn); return () => this.off(type, fn); },
    off(type, fn) { map.get(type)?.delete(fn); },
    emit(type, payload) { for (const fn of map.get(type) || []) { try { fn(payload); } catch (e) { console.error(`[bus] ${type}`, e); } } },
  };
}
