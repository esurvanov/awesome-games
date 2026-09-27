/* qa-hooks.js — provenance tags for the QA tools (tools/inventory.mjs, tools/eye.mjs). Inert unless the URL has #dbg.
 *
 * Loaded as a module right after the engine bootstrap (so window.THREE exists) and before the game.
 * Every Object3D added to a parent gets userData.owner = the file that called add() (first stack frame in
 * modules/<name>.js → '<name>', worldfill.js → 'worldfill', open-world.html → 'game', …) unless an owner is set already.
 * Explicit tags win: STYLE.tag(obj, { owner, source, intentional }) (style.js) or userData.owner set by the module.
 * Cost: one Error().stack per add() while #dbg is on (load ≈ +50 ms); nothing at all for players.
 */
const T = window.THREE;
if (T && location.hash === '#dbg') {
  const MAP = [[/\/modules\/([\w-]+)\.js/, (m) => m[1]], [/\/worldfill\.js/, () => 'worldfill'], [/\/physics\.js/, () => 'physics'], [/\/ai(-content)?\.js/, () => 'ai'],
    [/\/style\.js/, () => 'style'], [/\/open-world\.html/, () => 'game']];
  const ownerFromStack = () => {
    const lim = Error.stackTraceLimit; Error.stackTraceLimit = 24; const st = new Error().stack || ''; Error.stackTraceLimit = lim;
    for (const line of st.split('\n')) for (const [re, f] of MAP) { const m = line.match(re); if (m) return f(m); }
    return null;
  };
  const stats = { tagged: 0, calls: 0 };
  const add0 = T.Object3D.prototype.add;
  T.Object3D.prototype.add = function (...objs) {
    stats.calls++;
    for (const o of objs) if (o && o.userData && !o.userData.owner) { const w = ownerFromStack(); if (w) { o.userData.owner = w; stats.tagged++; } }
    return add0.apply(this, objs);
  };
  window.QAHOOKS = { stats, ownerFromStack };
}
