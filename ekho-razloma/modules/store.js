/* modules/store.js — Store: the one place the game touches localStorage (JSON values, never throws).
 * Classic script, loaded before the page: window.Store = { get(key, default), set(key, value), del(key) }.
 * Keys in use (open-world.html): eor-save (progress), eor-endings (seen endings), eor-muted (sound).
 * modules/lowend.js keeps its own raw-string wrapper for the eor-quality-* keys on purpose (different value format). */
(function () {
  'use strict';
  window.Store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
})();
