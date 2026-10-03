/* modules/ending.js — Ending: the finale after the last dialogue — Kestrel lifts off, the camera circles, the end card appears.
 * Classic script, loaded before the page: window.createEnding(deps) → { startEnding(), updateEnding(dt), showEndCard() }.
 *   startEnding()   mode → 'ending', stage → 9; hides the HUD, records the ending in the endings list, deletes the run's save,
 *                   lights Kestrel's engines, removes its collider
 *   updateEnding(dt) the liftoff, the sparks (more for the "free" ending), the orbiting camera; shows the card after 7.5 s
 *   showEndCard()   the card: title, closing lines, time / echoes / shards / deaths
 * The words of both endings are in modules/story-data.js (ENDINGS); the save format and keys in modules/progress.js.
 * deps (open-world.html builds them): the objects and helpers named below. */
(function () {
  'use strict';
  window.createEnding = function (D) {
    const { G, $, WORLD, rand, store, sk, Sound, lerp, emit, camera, hudEl, promptEl, touchEl, crossEl, player, dismount, glowMat, Passport, ENDINGS, ICON, V3 } = D;
    const Progress = window.Progress, tmp = new V3(), ship = () => D.Things.get('ship');   // Kestrel, from modules/things.js (read at run time: created after this module)
    function startEnding() {
      G.mode = 'ending'; G.endT = 0; G.stage = 9;
      hudEl.hidden = true; promptEl.hidden = true; touchEl.hidden = true; crossEl.hidden = true;
      player.c.g.visible = false; if (sk.mounted) dismount(); sk.g.visible = true;
      if (document.pointerLockElement) { G.softUnlock = true; document.exitPointerLock(); }
      const done = store.get(Progress.ENDINGS_KEY, []); if (!done.includes(G.ending)) done.push(G.ending); store.set(Progress.ENDINGS_KEY, done);
      store.del(Progress.KEY);
      ship().native.engines.forEach((e) => { e.visible = true; e.material = glowMat(G.ending === 'free' ? 0xc49bff : 0xff9a3c, 1); });
      if (ship().collider) { Passport.remove(ship().collider); ship().collider = null; }
      Sound.whoosh(); Sound.choir(G.ending === 'free');
    }
    function updateEnding(dt) {
      G.endT += dt; const t = G.endT, k = ship().native.g, base = ship().base;
      const up = Math.min(1, t / 2.5);
      k.rotation.x = lerp(base.rot.x, 0, up); k.rotation.z = lerp(base.rot.z, 0, up);
      k.position.y = base.pos.y + up * 6 + Math.max(0, t - 2.5) ** 2 * 1.6;
      if (t > 2.5) { const f = (t - 2.5) ** 2 * 3; k.position.x = base.pos.x - Math.sin(base.rot.y) * f; k.position.z = base.pos.z - Math.cos(base.rot.y) * f; }
      if (G.ending === 'free' && Math.random() < 0.8) emit(k.position.x + rand(-6, 6), k.position.y - 3, k.position.z + rand(-6, 6), 0, rand(4, 9), 0, 1.2, [0x5cf5c0, 0xc49bff, 0x7fe3ff][(Math.random() * 3) | 0], rand(0.5, 1.2), 0.5, -1);
      if (ship().native.exhaust) tmp.copy(ship().native.exhaust); else tmp.set(0, 0, 3); k.localToWorld(tmp); emit(tmp.x, tmp.y, tmp.z, rand(-2, 2), rand(-2, 0), rand(-2, 2), 0.8, 0xffa040, 1, 1, 0);
      const a = 0.6 + t * 0.12;
      camera.position.set(base.pos.x + Math.sin(a) * 26, base.pos.y + 4 + t * 1.2, base.pos.z + Math.cos(a) * 26);
      camera.lookAt(k.position);
      if (t > 7.5 && !G.endShown) { G.endShown = true; showEndCard(); }
    }
    function showEndCard() {
      const e = ENDINGS[G.ending]; $('ending').hidden = false;
      $('endTitle').textContent = e.title; $('endTitle').style.color = e.color; $('endEyebrow').textContent = G.ending === 'free' ? 'финал · свет' : 'финал · тишина';
      const L = $('endLines'); L.innerHTML = '';
      e.lines.forEach((l, i) => { const d = document.createElement('div'); d.style.animationDelay = (0.4 + i * 0.7) + 's'; d.innerHTML = ICON(i === 0 ? 'i-aurora' : i === 1 ? 'i-ship' : 'i-person', 'c-aur') + '<span></span>'; d.lastChild.textContent = l; L.appendChild(d); });
      $('eTime').textContent = Math.max(1, Math.round(G.time / 60)); $('eEcho').textContent = G.echoes.length + '/8'; $('eShard').textContent = G.shards.length + '/24'; $('eDeaths').textContent = G.deaths;
    }

    return { startEnding, updateEnding, showEndCard };
  };
})();
