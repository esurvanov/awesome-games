/* modules/environment.js — Environment: the weather and everything that is "the air around the camera".
 * Classic script, loaded before the page: window.createEnvironment(deps) → { WX, update(dt, T), weather(dt) }.
 *   WX            { storm 0..1, target, t }  the weather state; modules read it through ctx.WX (same object as before the move)
 *   weather(dt)   next blizzard timer, storm easing, fog near/far
 *   update(dt, T) sky uniforms and aurora hue, the sky dome follows the camera, snow falling around the camera,
 *                 aurora light, the ground-environment refresh (updateEnv) and the wind sound
 * Terrain, the horizon, the sky shader and the moon stay in their own modules/files; this owns only the time-varying part.
 * deps (open-world.html builds them): scene, camera, skyU, TU, aurA, sky, aurLight, SNOW + SN (the snow points and their count),
 * G (getter: the game state), Sound, toast, updateEnv, and the math helpers lerp, damp, clamp, rand. */
(function () {
  'use strict';
  window.createEnvironment = function (D) {
    const { scene, camera, skyU, TU, aurA, sky, aurLight, SNOW, SN, Sound, toast, updateEnv, lerp, damp, clamp, rand } = D;
    const WX = { storm: 0, target: 0, t: 120 };

    function weather(dt) {
      const G = D.G;
      if (G.mode === 'play' && dt > 0) {
        WX.t -= dt;
        if (WX.t <= 0) {
          if (WX.target === 0) { WX.target = 1; WX.t = rand(40, 60); toast('i-wind', 'Метель', 'c-ice'); }
          else { WX.target = 0; WX.t = rand(150, 230); }
        }
      }
      WX.storm = damp(WX.storm, G.mode === 'play' ? WX.target : 0, 0.35, dt);
      scene.fog.near = lerp(90, 6, WX.storm); scene.fog.far = lerp(640, 160, WX.storm);
    }

    function update(dt, T) {
      const G = D.G;
      skyU.uTime.value = T;
      skyU.uInt.value = damp(skyU.uInt.value, G.aurora * (1 - 0.75 * WX.storm), 0.5, dt); skyU.uStorm.value = WX.storm; TU.uTime.value = T;
      if (G.aurora > 1.5) { aurA.setHSL((T * 0.03) % 1, 0.9, 0.6); }
      sky.position.copy(camera.position);
      // snow around the camera
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      for (let i = 0; i < SN; i++) {
        const o = i * 3; SNOW.p[o] += Math.sin(T * 0.5 + i) * dt * 0.6 + dt * (0.8 + WX.storm * 22); SNOW.p[o + 1] -= dt * (1.4 + WX.storm * 4);
        if (SNOW.p[o] - cx > 60) SNOW.p[o] -= 120; if (SNOW.p[o] - cx < -60) SNOW.p[o] += 120;
        if (SNOW.p[o + 2] - cz > 60) SNOW.p[o + 2] -= 120; if (SNOW.p[o + 2] - cz < -60) SNOW.p[o + 2] += 120;
        if (SNOW.p[o + 1] < cy - 20) SNOW.p[o + 1] += 40; if (SNOW.p[o + 1] > cy + 20) SNOW.p[o + 1] -= 40;
      }
      SNOW.geo.attributes.position.needsUpdate = true;
      // the moon is a SunLight: direction only; its two cascades follow the view camera by themselves
      aurLight.intensity = 0.7 * Math.min(skyU.uInt.value, 2);
      updateEnv(T);
      Sound.setWind(Math.max(clamp((camera.position.y - 20) / 80, 0, 1), WX.storm));
    }

    return { WX, weather, update };
  };
})();
