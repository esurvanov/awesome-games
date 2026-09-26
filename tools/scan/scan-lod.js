/* scan-lod.js — classic helper for mesh packs made by tools/scan/import.mjs (window.ScanLOD).
 *   const lod = ScanLOD.fromGLTF(gltf, THREE)   → THREE.LOD with <name>_LOD0/1/2 at the distances baked into the pack
 *                                                  (userData.scan: { lodDist, role, size }); shadows on
 *   ScanLOD.passport(lod, Passport, opts)        registers LOD0 (the drawn surface) with the role suggested at import
 * Usage in a module (MODULES.md):  ctx.loadPacked('scan_boulder', ctx.ASSET, (g) => {
 *   const lod = ScanLOD.fromGLTF(g, ctx.THREE); lod.position.set(x, ctx.groundH(x, z), z); ctx.scene.add(lod);
 *   lod.updateMatrixWorld(true); ScanLOD.passport(lod, ctx.Passport, { name: 'scan_boulder' }); });
 */
(function () {
  const SL = window.ScanLOD = window.ScanLOD || {};
  SL.fromGLTF = function (g, THREE) {
    const scene = g.scene || g; let meta = {};
    scene.traverse((o) => { if (o.userData && o.userData.scan) { try { meta = typeof o.userData.scan === 'string' ? JSON.parse(o.userData.scan) : o.userData.scan; } catch (e) { /* keep {} */ } } });
    const levels = [];
    scene.traverse((o) => { const m = o.isMesh && /_LOD(\d+)$/.exec(o.name); if (m) levels[+m[1]] = o; });
    const lod = new THREE.LOD(); lod.name = (scene.children[0] && scene.children[0].name) || 'scan';
    const dist = meta.lodDist || [0, 15, 40];
    levels.forEach((mesh, i) => {
      if (!mesh) return; mesh.removeFromParent(); mesh.position.set(0, 0, 0); mesh.quaternion.identity(); mesh.scale.set(1, 1, 1);
      mesh.castShadow = mesh.receiveShadow = true;
      lod.addLevel(mesh, dist[i] != null ? dist[i] : i * 20);
    });
    lod.userData.scan = meta; lod.userData.source = lod.name;
    return lod;
  };
  SL.passport = function (lod, Passport, opts) {
    const meta = lod.userData.scan || {}, lvl = lod.levels[0] && lod.levels[0].object; if (!lvl || !Passport) return null;
    const role = (opts && opts.role) || meta.passportRole || 'solid';
    return Passport.register(lvl, role, Object.assign({ name: lod.name }, opts || {}));
  };
})();
