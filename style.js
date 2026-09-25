/* style.js — placeholder, filled in below (see STYLE.md) */
(function () {
  const STYLE = window.STYLE = window.STYLE || {};
  STYLE.tag = function (obj, t) { if (!obj || !obj.userData) return obj; const u = obj.userData; for (const k in t) if (t[k] !== undefined) u[k === 'intentional' ? 'qaIntentional' : k] = t[k]; return obj; };
})();
