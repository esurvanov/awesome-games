/* modules/structures-landmarks.js — the story landmarks: the echo ruins and their stones, the three spires with altars and parts, the rift crystals and the heart, the shard pickups. Moved out of modules/structures.js unchanged. Classic script, loaded BEFORE structures.js: window.createStructuresLandmarks(deps) → { buildSpires, buildShards, buildRift, buildEchoes, bind({...}) }. */
(function () {
  'use strict';
  window.createStructuresLandmarks = function (X) {
    const { need, flat, count, rr, spawn, snowify, TAU, warn, mat4, register, findSpot, taken, ST, fitLog, H, groundTilt } = X;
    let THREE, C, V3, seatY, withY;   // assigned later in the source module: set through bind()
  /* ============================ echo ruins ============================ */
  let runeTex = null;
  function runeTexture() {
    if (runeTex) return runeTex;
    const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d');
    g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineWidth = 5; g.shadowColor = '#fff'; g.shadowBlur = 6;
    const r = (a) => (Math.sin(a * 12.9898) * 43758.5453) % 1;
    for (let row = 0; row < 4; row++) {   // four runes: vertical stave + 1–2 branches
      const y0 = 10 + row * 29, y1 = y0 + 22, x = 32; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1);
      const b = Math.abs(r(row + 1)); if (b > 0.3) { g.moveTo(x, y0 + 4); g.lineTo(x + (b > 0.6 ? 12 : -12), y0 + 12); }
      if (Math.abs(r(row + 7)) > 0.45) { g.moveTo(x, y0 + 12); g.lineTo(x - 11, y1 - 2); }
      g.stroke();
    }
    runeTex = new THREE.CanvasTexture(c); runeTex.colorSpace = THREE.SRGBColorSpace; return runeTex;
  }
  function buildEchoes() {
    const kinds = ['struct_ruin_arch', 'struct_ruin_wall', 'struct_ruin_column'];
    const echoes = C.WORLD.echoes || [];
    for (const eo of echoes) {
      const pack = kinds[eo.i % 3];
      need(pack, (gl) => {
        const F = flat(pack, gl); for (const p of F.parts) snowify(p.mat);
        const x0 = eo.g.position.x, z0 = eo.g.position.z, yaw = rr(0, TAU);
        const sp = findSpot(x0, z0, yaw, F.box, 1, { maxDeg: 20, maxRise: 0.8, R: 26, step: 1.5, avoid: (x, z) => C.inRift(x, z, 6) });
        if (!sp) { warn('echo', eo.i, 'no ground'); return; }
        if (!sp.ok) warn('echo', eo.i, 'best-effort ground', sp.g.slope.toFixed(0) + '°');
        taken.push([sp.x, sp.z, 3]);
        const y = seatY(F, mat4(sp.x, 0, sp.z, yaw), 0.08, { maxGap: 0.02 }).dy;   // ~8 % under the visible snow, never floats
        const M = mat4(sp.x, y, sp.z, yaw); fitLog('echo' + eo.i, sp, y + F.box.min.y, 'upright');
        const meshes = spawn(F, [M], { name: 'echo_ruin' });
        register(F, [M], 'solid', { name: 'echo' + eo.i });
        // rune decal on the stone face that looks toward the old echo spot (the player's usual approach)
        const faceDir = new V3(x0 - sp.x, 0, z0 - sp.z); if (faceDir.lengthSq() < 1) faceDir.set(Math.sin(yaw), 0, Math.cos(yaw)); faceDir.normalize();
        const hitY = y + F.box.min.y + 1.5, rc = new THREE.Raycaster(new V3(sp.x + faceDir.x * 9, hitY, sp.z + faceDir.z * 9), faceDir.clone().negate(), 0, 12);
        meshes.forEach((m) => m.updateMatrixWorld(true));
        const hit = rc.intersectObjects(meshes, false)[0];
        const dec = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.84), new THREE.MeshBasicMaterial({ map: runeTexture(), color: new THREE.Color(0x5cf5c0).multiplyScalar(2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
        dec.userData.noCollide = true;
        let px, py, pz, n;
        if (hit) { n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : faceDir.clone(); n.y = 0; if (n.lengthSq() < 0.1) n.copy(faceDir); n.normalize(); px = hit.point.x; py = hit.point.y; pz = hit.point.z; }
        else { n = faceDir.clone(); px = sp.x + n.x * 0.8; py = hitY; pz = sp.z + n.z * 0.8; }
        dec.position.set(px + n.x * 0.03, py, pz + n.z * 0.03); dec.lookAt(dec.position.x + n.x, py, dec.position.z + n.z); C.scene.add(dec);
        // move the echo there: group (glow sprite) + interaction point
        eo.g.position.set(px + n.x * 0.5, H(px + n.x * 0.5, pz + n.z * 0.5), pz + n.z * 0.5);
        eo.eg.position.set(0, py - eo.g.position.y, 0);
        eo.pos.set(eo.g.position.x, eo.g.position.y + 1.2, eo.g.position.z);
        eo.decal = dec; ST.stats.moved.push({ kind: 'echo' + eo.i, from: [x0, z0], to: [sp.x, sp.z], slope: +sp.g.slope.toFixed(1) });
        count('echo_ruin');
      });
    }
  }

  /* ============================ spires ============================ */
  function buildSpires() {
    need('crystal_spire', (gl) => {
      const F = flat('crystal_spire', gl), S = 0.9;
      const rock = F.parts.find((p) => !/crystal/i.test(p.name)), crys = F.parts.find((p) => /crystal/i.test(p.name));
      if (rock) snowify(rock.mat, 0.8);
      // plinth: its lowest rim sits 0.3 m in the ground
      const rb = rock ? rock.geo.boundingBox : F.box, y0 = -rb.min.y * S - 0.3;
      need('struct_ruin_column', (gc) => {
        const FC = flat('struct_ruin_column', gc); for (const p of FC.parts) snowify(p.mat);
        for (const s of C.WORLD.spires) {
          const g = s.g;
          const cm = crys.mat.clone(); cm.emissive.setHex(0x1b5fb0); cm.emissiveIntensity = s.taken ? 0.15 : 1; s.mat = cm;
          const holder = new THREE.Group(); holder.position.y = y0; holder.scale.setScalar(S); g.add(holder);
          const meshes = spawn({ parts: F.parts.map((p) => (p === crys ? { geo: p.geo, mat: cm } : p)) }, [new THREE.Matrix4()], { parent: holder, name: s.key });
          g.updateMatrixWorld(true);
          // altar = broken column stump on the plinth surface at (ax, az)
          const rc = new THREE.Raycaster(new V3(g.position.x + s.ax, g.position.y + 30, g.position.z + s.az), new V3(0, -1, 0), 0, 60);
          const hit = rc.intersectObjects(meshes, false).filter((h) => h.object.material !== cm)[0];
          const top = hit ? hit.point.y - g.position.y : 0.3;
          const alt = new THREE.Group(), as = 0.5; alt.position.set(s.ax, top - 0.1 - FC.box.min.y * as, s.az); alt.scale.setScalar(as); alt.rotation.y = Math.atan2(-s.ax, -s.az); g.add(alt);
          spawn(FC, [new THREE.Matrix4()], { parent: alt, name: 'altar' });
          const altTop = top - 0.1 + (FC.box.max.y - FC.box.min.y) * as;
          s.partY = altTop + 1.1; s.part.position.y = s.partY; s.pg.position.y = s.partY;
          s.altar.set(g.position.x + s.ax, g.position.y + altTop + 0.2, g.position.z + s.az);
          g.updateMatrixWorld(true);
          s.col = C.Passport.register(g, 'solid', { name: s.key });   // plinth, crystals, altar (ring/part/beam excluded)
          s.plinthTop = top; count('spire');
        }
      });
    });
  }

  /* ============================ rift: crystals, heart ============================ */
  function readInstances(name) {
    let im = null; C.scene.traverse((o) => { if (!im && o.isInstancedMesh && o.name === name) im = o; });
    if (!im) return null;
    const out = []; for (let i = 0; i < im.count; i++) { const m = new THREE.Matrix4(); im.getMatrixAt(i, m); out.push(m); }
    return { im, mats: out };
  }
  function dropEntries(prefix) {
    const P = C.Passport, list = (P.list || []).filter((e) => e && e.name && e.name.indexOf(prefix) === 0);
    for (const e of list) P.remove(e);
    return list.length;
  }
  function buildRift() {
    need('crystal_cluster_ground', (gl) => {
      const F = flat('crystal_cluster_ground', gl), p = F.parts[0];
      const jobs = [['rift_crystal', 0x4a1a9a, 1.25, 0.8, false], ['crystal_tree', 0x1b3a86, 0.85, 2.1, false]];
      for (const [name, em, ei, k, cast] of jobs) {
        const src = readInstances(name); if (!src) { warn('no instances', name); continue; }
        const mat = p.mat.clone(); mat.emissive.setHex(em); mat.emissiveIntensity = ei;
        const mats = src.mats.map((M) => {
          const pos = new V3(), q = new THREE.Quaternion(), sc = new V3(); M.decompose(pos, q, sc);
          const M0 = new THREE.Matrix4().compose(new V3(pos.x, 0, pos.z), q, new V3(sc.x * k, sc.y * k, sc.z * k));
          return withY(M0, seatY({ parts: [p] }, M0, 0.14, { maxGap: 0.02, extra: 0.03 }).dy);   // ~14 % under the visible snow (QA burial measure)
        });
        src.im.visible = false; src.im.parent && src.im.parent.remove(src.im);
        const gone = dropEntries(name);
        spawn({ parts: [{ geo: p.geo, mat }] }, mats, { name, instanced: true, cast });
        register({ parts: [{ geo: p.geo, mat }] }, mats, 'solid', { name: 'st_' + name, shape: 'hull' });
        count(name, mats.length); ST.stats[name + '_replacedEntries'] = gone;
      }
    });
    need('crystal_cluster_large', (gl) => {   // hero clusters on the crater rim
      const F = flat('crystal_cluster_large', gl), rp = C.POI.rift, mats = [];
      const cm = F.parts.find((q) => /crystal/i.test(q.name)); if (cm) { cm.mat = cm.mat.clone(); cm.mat.emissive.setHex(0x4a1a9a); cm.mat.emissiveIntensity = 1.2; }
      for (const q of F.parts) if (q !== cm) snowify(q.mat, 0.7);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * TAU + rr(-0.3, 0.3), d = rr(58, 70), x = rp.x + Math.cos(a) * d, z = rp.z + Math.sin(a) * d / 1.25, s = rr(1.1, 1.7), yaw = rr(0, TAU);
        const sp = findSpot(x, z, yaw, F.box, s, { maxDeg: 26, maxRise: 0.9 * s, R: 10, minH: -50 });
        if (!sp) continue;
        const [crx, crz] = groundTilt(sp.x, sp.z, yaw, F.box, s, 0.3), M0 = mat4(sp.x, 0, sp.z, yaw, s, crx, crz);
        mats.push(withY(M0, seatY(F, M0, 0.15, { maxGap: 0.02 }).dy)); taken.push([sp.x, sp.z, 2.5 * s]);
      }
      if (mats.length) { spawn(F, mats, { name: 'rift_cluster', instanced: true }); register(F, mats, 'solid', { name: 'st_rift_cluster', shape: 'hull' }); count('rift_cluster', mats.length); }
    });
    need('rift_heart', (gl) => {
      const h = C.WORLD.heart; if (!h) return;
      const root = gl.scene.clone(true);
      root.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.emissive.setHex(0x8a4dff); o.material.emissiveIntensity = 1.3; o.castShadow = true; o.userData.noCollide = true; } });
      const bb = new THREE.Box3().setFromObject(root), c = bb.getCenter(new V3()); root.position.sub(c);   // centred pivot (spins in place)
      root.userData.struct = true; h.m.add(root); count('heart');
    });
  }

  /* ============================ shard pickups ============================ */
  function buildShards() {
    need('crystal_shard_pickup', (gl) => {
      const F = flat('crystal_shard_pickup', gl), p = F.parts[0], mat = p.mat.clone(); mat.emissive.setHex(0xff7a10); mat.emissiveIntensity = 1.1;
      const cy = (F.box.min.y + F.box.max.y) / 2;
      for (const s of C.WORLD.shards || []) {
        const w = new THREE.Group(), m = new THREE.Mesh(p.geo, mat); m.position.y = -cy; m.castShadow = false; m.userData.noCollide = true; w.add(m); w.userData.struct = true;
        w.rotation.copy(s.m.rotation); s.m.visible = false; s.g.add(w); s.m = w;
      }
      count('shard', (C.WORLD.shards || []).length);
    });
  }


    return { buildSpires, buildShards, buildRift, buildEchoes, bind(o) { if ("THREE" in o) THREE = o.THREE; if ("C" in o) C = o.C; if ("V3" in o) V3 = o.V3; if ("seatY" in o) seatY = o.seatY; if ("withY" in o) withY = o.withY; } };
  };
})();
