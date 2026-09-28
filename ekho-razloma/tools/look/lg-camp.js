/* lg-camp.js — LOOK-GATE framings for the camp (CAMP.md), injected after lg-page.js. Third-person player-camera geometry:
 * pilot parked beside the subject, camera ≈ 4–6 m behind / 2.2 m up, looking at the subject.
 *   fire_player  the station fire, 4 m     fire_wide  fire + station, 11 m
 *   tent_player  the stove tent, 5.5 m     camp_wide  the whole camp from its edge, 14 m
 */
(() => {
  const D = window.DBG, C = D.MODCTX, QA = window.QA, S = window.LG.shots, W = D.WORLD;
  const surf = (x, z) => D.groundH(x, z) + (C.snowDepthAt ? C.snowDepthAt(x, z) : 0);
  const frame = (tx, ty, tz, d, a, h, fov, note, pilotAt = 0.55) => {
    const x = tx + Math.sin(a) * d, z = tz + Math.cos(a) * d, pos = [x, surf(x, z) + h, z], look = [tx, ty, tz];
    const px = tx + Math.sin(a + 0.25) * d * pilotAt, pz = tz + Math.cos(a + 0.25) * d * pilotAt;   // pilot in frame, off-centre, like the follow camera
    QA.place(px, pz, { look: [tx, ty, tz] });
    return { pos, look, fov, note, keepPilot: true };
  };
  const fireAng = () => { const f = W.stationW(3, 11), st = W.stationW(0, 0); return Math.atan2(f.x - st.x, f.z - st.z); };
  S.fire_player = () => { const f = W.stationW(3, 11); return frame(f.x, surf(f.x, f.z) + 0.7, f.z, 4.2, fireAng() + 0.9, 2.1, 55, 'station fire, 4 m, third-person height'); };
  S.fire_wide = () => { const f = W.stationW(3, 11); return frame(f.x, surf(f.x, f.z) + 1.2, f.z, 11, fireAng() + 0.6, 2.4, 55, 'fire + station, 11 m'); };
  const tent = () => { const t = window.STRUCT && STRUCT.stats.tents && STRUCT.stats.tents.tent_polar_stove; return t && t.at[0]; };
  S.tent_player = () => { const t = tent(); if (!t) return { skip: 'no polar tent' }; return frame(t[0], t[1] + 1.1, t[2], 5.8, 0.3, 2.2, 55, 'stove tent, 5.8 m'); };
  S.camp_wide = () => { const t = tent(); if (!t) return { skip: 'no polar tent' }; return frame(t[0] + 2.5, t[1] + 0.9, t[2] + 1, 14, 0.75, 2.6, 55, 'camp from its edge, 14 m', 0.75); };
})();
