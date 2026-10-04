/* modules/interaction-camera.js — camera feel: head bob while walking, a dip on landing. Moved out of modules/interaction.js unchanged. Classic script, loaded BEFORE interaction.js: window.createInteractionCamera(deps) → { CAM, camUpdate, bind({ C }) }. */
(function () {
  'use strict';
  window.createInteractionCamera = function (X) {
    const { clamp, STATS, K } = X;
    let C;   // assigned later in the source module: set through bind()
  /* ------------------------------------------------------------------ camera feel */
  const CAM = { bob: 0, bobV: 0, dip: 0, dipV: 0, lastSteps: 0, applied: 0 };
  function camUpdate(dt) {
    const P = C.player, G = C.G, cam = C.camera;
    if (C.mode !== 'play' || G.pause || G.ui || window.DBG && window.DBG.camOv) { CAM.dip = CAM.dipV = CAM.bob = CAM.bobV = 0; return; }
    const hs = G.riding ? 0 : Math.hypot(P.vx, P.vz);
    if (STATS.steps !== CAM.lastSteps) { CAM.lastSteps = STATS.steps; if (P.onGround) CAM.bobV -= K.bob * 9 * clamp(hs / 7, 0.3, 1.4); }
    // two critically-damped-ish springs
    const kS = 160, cS = 2 * Math.sqrt(kS) * 0.75;
    CAM.bobV += (-kS * CAM.bob - cS * CAM.bobV) * dt; CAM.bob += CAM.bobV * dt;
    const kD = 70, cD = 2 * Math.sqrt(kD) * 0.8;
    CAM.dipV += (-kD * CAM.dip - cD * CAM.dipV) * dt; CAM.dip += CAM.dipV * dt;
    let dy = clamp(CAM.bob, -0.05, 0.03) + clamp(CAM.dip, -0.4, 0.08);
    const boom = C.cam.boom || C.cam.dist; dy *= clamp(boom / 3, 0.25, 1);   // close to a wall: smaller moves
    if (Math.abs(dy) < 1e-4) return;
    // stay outside solids (Passport 'solid' + terrain), as the game's own boom does
    if (C.PH.ok) {
      const h = C.PH.P.sphereCast({ x: cam.position.x, y: cam.position.y, z: cam.position.z }, { x: 0, y: Math.sign(dy), z: 0 }, Math.abs(dy) + 0.05, 0.22, { groups: C.PH.P.groups.STATIC });
      if (h) dy = Math.sign(dy) * Math.max(0, h.distance - 0.05);
    }
    const gmin = C.groundH(cam.position.x, cam.position.z) + 0.5;
    if (dy < 0) dy = Math.max(dy, Math.min(0, gmin - cam.position.y));
    cam.position.y += dy; CAM.applied = dy;
  }

    return { CAM, camUpdate, bind(o) { if ("C" in o) C = o.C; } };
  };
})();
