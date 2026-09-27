// Готовые сцены для снимков (строки для page.evaluate): время (мир живёт, игрок в машине), место игрока, взгляд.
// yaw 0 — лицом к КПП, π — к хвосту; inCar — вид из салона.
export const at = (t, s, off, yaw, pitch = -0.02, inCar = false) => `(() => { const G = LARS, w = G.w; w.player.inCar = true; w.player.tx = null;
  const t1 = w.clock.parse('${t}'); while (w.clock.t < t1) w.step(30); G.pending.length = 0; G.Modal.closeAll(); G.menu.hide(); w.player.sleeping = false;
  ${inCar ? '' : `w.player.inCar = false; const q = w.road.at(${s}, ${off}); w.player.x = q.x; w.player.y = q.y;`}
  const q2 = w.road.at(${inCar ? 'w.pcar.s' : s}, 0); const f = [-q2.ny, q2.nx]; G.fp.yaw = Math.atan2(f[0], -f[1]) + (${yaw}); G.fp.pitch = ${pitch}; G.fp.eyeY = null; })()`;
