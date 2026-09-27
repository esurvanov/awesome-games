'use strict';
// Эффекты логики: сообщения, всплывающий текст, частицы, тряска, следы, туши. Рисует их рендер (gfx/art-world).
// breath — глобально: его зовёт и рендер (пар изо рта деда).
function breath(x, y, face, T) {
  for (let i = 0, n = T < -35 ? 4 : 3; i < n; i++)
    G.parts.push({ type: 'breath', x: x + i * face * 2, y, vx: face * rnd(10, 22) + (stormOn() ? 60 : 4), vy: rnd(-8, -3), life: 1.1, max: 1.1 });
}

const Fx = (() => {
  const E = TUNE.engine;
  function toast(txt) { UI.toast(txt); }
  function floatText(x, y, text) { G.parts.push({ type: 'text', x, y, vx: 0, vy: -28, life: 1.3, max: 1.3, text }); }
  function burst(x, y, n, color, spd = 90) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = rnd(20, spd);
      G.parts.push({ type: 'dot', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: rnd(0.4, 0.8), max: 0.8, color, g: 160 });
    }
  }
  function shake(n) { if (!UI.reduced && Settings.get('shake')) G.shake = Math.max(G.shake || 0, n); }
  function corpse(kind, x, y) { ArtWorld.fx.blood(G.parts, x, y, G.decals = G.decals || []); (G.corpses = G.corpses || []).push({ kind, x: Math.round(x), y: Math.round(y), t0: G.time }); if (G.corpses.length > E.corpses) G.corpses.shift(); }
  function print(x, y, a, k, d) { G.prints.push({ x, y, a, k, life: E.printLife, d }); if (G.prints.length > E.prints) G.prints.shift(); }
  // шаг частиц, следов и пятен
  function tick(dt, storm) {
    for (const f of G.prints) f.life -= dt * (storm ? 4 : 1);
    while (G.prints.length && G.prints[0].life <= 0) G.prints.shift();
  }
  function tickParts(dt) {
    FX.update(G.parts, dt); // единый слой частиц (js/particles.js): интегратор, ветер, лимиты по типам
    World.tickTrees(dt);
    if (G.parts.length > E.parts) G.parts.splice(0, G.parts.length - E.parts);
    if (G.decals) { for (const d of G.decals) d.life -= dt; G.decals = G.decals.filter(d => d.life > 0).slice(-E.decals); }
  }
  return { toast, floatText, burst, shake, corpse, print, tick, tickParts };
})();
