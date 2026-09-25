# Physics module (`physics.js`)

Rapier 0.20 (`@dimforge/rapier3d-compat`) wrapped in a small game-oriented API.
Files: `physics.js` (module), `physics-demo.html` (sandbox), this doc.

## 1. Engine choice

| Engine | Loads under artifact CSP | Size (raw / gzip) | Heightfield | Character controller | Vehicle | Notes |
|---|---|---|---|---|---|---|
| **Rapier 0.20 `rapier3d-compat`** ✅ | ✅ one self-contained `.mjs`, WASM inlined as base64, **no fetch** | 2.86 MB / 1.08 MB | ✅ exact match with `getH` | ✅ KCC: max slope, slide, autostep, snap-to-ground, push bodies | ✅ ray-cast vehicle (not used; custom hover) | JS-friendly API (no manual free), fast, maintained |
| Jolt (`jolt-physics` `wasm-compat`) | ✅ WASM inlined | 3.2 MB / 0.9 MB | ✅ | ✅ `CharacterVirtual` (best in class) | ✅ wheeled/tracked | Emscripten API, manual `destroy()` of every temp object — heavy integration cost |
| cannon-es 0.20 | ✅ pure JS | 0.35 MB / 75 KB | ✅ | ❌ (DIY) | ✅ RaycastVehicle | Slow with many contacts, no CCD, no KCC — would have to hand-write slopes/steps |
| ammo.js | ⚠ asm.js build ok, wasm build fetches `.wasm` | 1.6 MB / 0.32 MB (asm) | ✅ | ⚠ btKinematicCharacterController (buggy) | ✅ | npm package stale (0.0.10), awkward API |
| OimoPhysics 1.2 | ✅ pure JS | ~0.5 MB | ❌ no heightfield | ❌ | ❌ | not suitable |

Verified:
- `https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.20.0/dist/rapier.mjs` → **200**, 2 857 590 B, no `import` statements, byte-identical to the npm tarball (unpkg mirror also 200).
- Source audit: the only `fetch(` / `new URL("rapier_wasm3d_bg.wasm")` is the *fallback* branch of the wasm-bindgen loader; `init()` always passes the inlined base64 bytes, so the fallback never runs. Headless Chrome network log shows exactly one request for the engine.
- ⚠ **WASM needs `'wasm-unsafe-eval'` (or `'unsafe-eval'`) in `script-src`.** Tested: with it → works; without it → `WebAssembly.instantiate` blocked. `PhysReady` then rejects with a clear message. If the artifact CSP ever forbids WASM compilation, no WASM engine will work (the fallback would be cannon-es + hand-written controller).

## 2. Include

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="physics.js"></script>          <!-- classic script, sets window.Phys + window.PhysReady -->
<script>
  PhysReady.then((Phys) => {
    Phys.init({ H, VN, CELL, W, seaLevel: 0 });
    // ... create character / vehicle / statics
  }).catch((e) => console.warn(e.message));   // keep the old code path as fallback
</script>
```

`physics.js` is a classic script that does a dynamic `import()` of the CDN URL (allowed in classic scripts), so it can be inlined into the single-file game as a plain `<script>` block too. Override the URL with `globalThis.PHYS_RAPIER_URL` before the script (used by the Node tests). No THREE dependency (meshes are duck-typed: `position.set`, `quaternion.set`, `scale.set`, `parent.remove`).

## 3. API

Units: metres, seconds, kg; Y up. Character positions are **feet** (same as `player.y`).

| Call | Returns | Notes |
|---|---|---|
| `Phys.init({H, VN, CELL, W, seaLevel=0, gravity=20})` | `Phys` | Heightfield from `H` (same triangulation as `getH`) + ice slab with top at `seaLevel`. `gravity` = world gravity for debris/vehicles. |
| `Phys.addStaticCylinder(x, z, r, yBottom, height, tag?, group?)` | collider | trunks (`group = Phys.groups.TRUNK`). In the game only via `Passport` — never with a guessed radius |
| `Phys.addStaticTrimesh(vertices, indices, tag?, {friction?, raw?})` | collider | exact static mesh (world space). Internal-edge fix on; used by `Passport` role `solid` |
| `Phys.addStaticConvex(points, tag?, {friction?})` | collider or `null` | convex hull (small rocks, `Passport` shape `hull`) |
| `Phys.addStaticBox(center, halfExtents, quat?, tag?)` | collider | walls, steps, ruins |
| `Phys.removeCollider(col)` | | |
| `Phys.createCharacter({radius=.4, height=1.8, x,y,z, gravity=28, jumpHeight=2, groundAccel=60, groundDecel=45, airAccel=9, maxSlopeDeg=45, stepHeight=.4, snapDistance=.5, coyoteTime=.12, jumpBuffer=.12, mass=80})` | character | |
| `ch.move(dt, {x,z}, jumpPressed)` | `{position, velocity, grounded, landed, landingSpeed, sliding, slideDir, groundNormal, jumped}` | `{x,z}` = **desired** horizontal velocity (m/s). Steps itself at fixed 1/60 with interpolation; independent of `Phys.step`. `jumpPressed` = edge (pressed this frame). `landed` true for one frame, `landingSpeed` = impact m/s. `velocity.xz` = real displacement rate (0 when pushing a wall). |
| `ch.setPosition(x,y,z)` / `ch.setVelocity(x,y,z)` / `ch.addVelocity(x,y,z)` / `ch.setEnabled(bool)` / `ch.destroy()` | | knockback: `addVelocity`; riding / ledge climb: `setEnabled(false)` |
| `ch.unstick()` | bool | called by `move()` automatically: a capsule placed *inside* a solid (teleport, respawn) is lifted onto the surface above. Without it the controller grinds through overlapping triangles (≈70 ms/frame). `state.unstuck` counts lifts |
| `Phys.spawnDebris(mesh, {shape:'box'|'sphere'|'convex', size, points?, mass=1, velocity, angularVelocity, lifetime=8, fade=.5, prop=false, friction, restitution, ccd=true, onDespawn, keepMesh})` | debris handle `{body, collider, mesh}` | Mesh must be a direct child of the scene (world transform). `size`: box = full extents (number or `{x,y,z}`), sphere = radius. `convex` without `points` uses `mesh.geometry` vertices × `mesh.scale`. After `lifetime` it shrinks for `fade` s, then is removed from its parent. `prop:true` = permanent, kickable, collides with the player. Cap: 160 shards (oldest removed). |
| `Phys.applyExplosion(center, radius, force, {upBias=.35, characters=true})` | | impulse = `force·(1−d/r)` N·s on debris/props/vehicles; characters get `Δv = impulse/mass` |
| `Phys.createHoverVehicle({x,z,y?,yaw, mass=250, halfExtents={1,.3,1.9}, hoverHeight=1.2, accel=30, maxSpeed=44, boostSpeed=58, reverseMax=12, turnRate=1.9, grip=6, driftGrip=1.2, jumpSpeed=9, mesh?})` | vehicle | Dynamic body + 4 spring rays. |
| `vh.update(dt, throttle, steer, boost, jump, drift?)` | `{position, quaternion, velocity, speed, yaw, grounded, height, bank, impact}` | inputs are applied inside the next `Phys.step`. `steer +1` = right. `bank` = visual lean (rad). `impact` = speed lost by collision this frame (m/s). Parking brake when idle. |
| `vh.teleport(x,y,z,yaw)` / `vh.setEnabled(bool)` / `vh.destroy()` | | |
| `Phys.raycast(origin, dir, maxDist, {groups?, debris=false, characters=false, excludeCollider?})` | `{point, normal, distance, collider, tag}` or `null` | default ignores characters and shards (camera/aim) |
| `Phys.sphereCast(origin, dir, maxDist, radius, {groups?, excludeCollider?})` | `{point, normal, distance, collider, tag}` or `null` | swept ball; the camera boom uses `groups: Phys.groups.STATIC` (terrain + solids only) |
| `Phys.applyImpulseAt(collider, point, impulse)` | bool | push what a ray hit |
| `Phys.groundY(x, z)` | number | top of terrain/ice/statics |
| `Phys.step(dt)` | substeps run | fixed 1/60, max 5 substeps, interpolated mesh sync. Call **once per frame**. |
| `Phys.clearDebris()`, `Phys.removeDebris(d)`, `Phys.stats()`, `Phys.world`, `Phys.RAPIER` | | |

Collision groups: `STATIC 1, CHAR 2, DEBRIS 4, PROP 8, VEHICLE 16, TRUNK 32` (TRUNK blocks bodies but not the camera ray; hover pads ride on STATIC + PROP only). Shards don't touch characters (no jitter underfoot), props do. Vehicle ignores the player capsule.

## 4. Integration into `open-world.html`

> **Superseded (2026-09-25):** colliders are no longer added here by hand. Every object registers through `Passport` (see FOUNDATION.md); `Passport.attach(Phys)` creates the Rapier colliders. The snippets below are kept as history.

Everything lives inside the game IIFE, so wire it there. Keep the old code as fallback while `PH.ok` is false.

**a) Collect colliders + init** (WORLD section / boot)
```js
const COLS = [];                                         // in addCol(): COLS.push(c);
const PH = { ok: false };
window.PhysReady && PhysReady.then((Phys) => {
  Phys.init({ H, VN, CELL, W, seaLevel: 0, gravity: 22 });
  for (const c of COLS) Phys.addStaticCylinder(c.x, c.z, c.r, groundH(c.x, c.z) - 2, 14);
  PH.P = Phys;
  PH.ch = Phys.createCharacter({ x: player.x, y: player.y, z: player.z, gravity: 28, jumpHeight: 1.97 });
  PH.sk = Phys.createHoverVehicle({ x: sk.x, z: sk.z, yaw: sk.yaw, hoverHeight: 1.1 });
  PH.ok = true;
}).catch((e) => console.warn(e.message));
```
Station walls/ruins with known boxes → `addStaticBox` instead of cylinders.

**b) `updatePlayer`** — replace the block from `player.vx = damp(...)` through the `groundH` snap (incl. `collide`, `vy -= 28*dt`):
```js
if (PH.ok) {
  const want = player.rollT > 0 ? { x: player.rollDir[0] * 15, z: player.rollDir[1] * 15 } : { x: mx * spd, z: mz * spd };
  const st = PH.ch.move(dt, want, pressed.has('Space'));
  player.x = st.position.x; player.y = st.position.y; player.z = st.position.z;
  player.vx = st.velocity.x; player.vz = st.velocity.z; player.vy = st.velocity.y; player.onGround = st.grounded;
  if (st.jumped) Sound.jump();
  if (st.landed && st.landingSpeed > 12) { Sound.step(); shake = Math.max(shake, Math.min(0.8, st.landingSpeed / 40)); }
  if (boundary(player, 430)) PH.ch.setPosition(player.x, player.y, player.z);
} else { /* old code */ }
```
In the roll-start branch (where `rollT = 0.55` is set) add `PH.ch.setVelocity(rdx * 15, 0, rdz * 15)` so the roll bursts instantly. Remove the manual slope slow-down (`sl > 0.75`) — slopes are handled by the controller. Hurt knockback: `PH.ch.addVelocity(dx/d*12, 5, dz/d*12)`. `respawn()` / `dismount()`: `PH.ch.setPosition(...)`. `mount()`: `PH.ch.setEnabled(false)`; `dismount()`: `setEnabled(true)` then `setPosition`.

**c) `updateSkimmer`** — replace the speed/yaw/`collide`/height code:
```js
const s = PH.sk.update(dt, iy, ix, boost, pressed.has('Space'));
sk.x = s.position.x; sk.y = s.position.y; sk.z = s.position.z; sk.yaw = s.yaw; sk.speed = s.speed;
sk.g.position.set(sk.x, sk.y, sk.z); sk.g.quaternion.set(s.quaternion.x, s.quaternion.y, s.quaternion.z, s.quaternion.w);
sk.g.rotateZ(s.bank);
if (s.impact > 8) { shake = Math.min(1, s.impact / 30); Sound.step(); }
```
`callSkimmer()`: `PH.sk.teleport(sk.x, groundH(sk.x, sk.z) + 1.2, sk.z, sk.yaw)`. `boundary(sk, 440)` → teleport back when outside.

**d) Frame loop** — call `if (PH.ok) PH.P.step(dt);` after `updatePlayer/updateEnemies/updateBolts` and before `updateCamera`.

**e) `killEnemy` → shards**
```js
if (PH.ok) for (let i = 0; i < 10; i++) {
  const m = new THREE.Mesh(OCT, e.mat); const s = rand(0.15, 0.35); m.scale.set(s, s * rand(1, 2.2), s);
  m.position.set(e.x + rand(-.6, .6), e.y + rand(-.6, .6), e.z + rand(-.6, .6)); scene.add(m);
  PH.P.spawnDebris(m, { shape: 'convex', mass: 0.5, lifetime: rand(4, 7),
    velocity: { x: rand(-6, 6), y: rand(3, 8), z: rand(-6, 6) }, angularVelocity: { x: rand(-9, 9), y: rand(-9, 9), z: rand(-9, 9) } });
}
```
(`e.mat` is shared per enemy — fine, the enemy mesh is removed.) Boss death: same with bigger shards + `applyExplosion(boss, 12, 80)`.

**f) Bolts → raycast** in `updateBolts`, before moving the bolt:
```js
const sp = Math.hypot(b.vx, b.vy, b.vz), h = PH.ok && PH.P.raycast(b, { x: b.vx, y: b.vy, z: b.vz }, sp * dt, { debris: true });
if (h) { b.x = h.point.x; b.y = h.point.y; b.z = h.point.z; hit = true; PH.P.applyImpulseAt(h.collider, h.point, { x: b.vx * .05, y: b.vy * .05, z: b.vz * .05 }); }
```
Replaces `b.y < getH(...)` and makes bolts stop at rocks/pillars (they currently pass through).

**g) Camera** in `updateCamera` after computing `camera.position`:
```js
if (PH.ok) { const d = tmp.subVectors(camera.position, cam.look), L = d.length(), h = PH.P.raycast(cam.look, d, L);
  if (h) camera.position.copy(cam.look).addScaledVector(d.normalize(), Math.max(0.6, h.distance - 0.3)); }
```

**h) Kickable props**: crates/barrels near the station → `spawnDebris(mesh, { shape:'box', size:1, mass:15, prop:true })`.

## 5. Tests (Node, headless, same `rapier.mjs` as the CDN)

Game-sized grid (VN=257, W=900). Script: `scratchpad/phys-work/test.mjs`.

| Check | Result |
|---|---|
| Heightfield vs `max(getH,0)`, 20 000 random points | max error **0.0004 m** |
| Triangle split in noisy region, 2 000 pts | max error **0.0002 m** |
| Stand on 20° slope, 3 s | drift **0.006 m**, grounded |
| Walk up 20° at 6 m/s | 10.1 m in 2 s |
| Walk down 20° at 8 m/s | **0/150** airborne frames (snap) |
| 60° slope | slides **9.3 m** in 1.5 s, peak 28 m/s; cannot climb (0.006 m) |
| 0.3 m step | climbed, feet +0.300 m |
| 0.6 m ledge | blocked |
| Fall 20 m | landingSpeed **33.6 m/s** (ideal 33.5), t 1.18 s (ideal 1.20) |
| Jump | apex **2.000 m** (target 2.0) |
| Jump buffer / coyote | pressed 5 frames early → jumps on landing +1 frame; jump 4 frames after leaving a ledge → accepted |
| 27 boxes + convex shards | all asleep after 10 s, |v| = 0, none below ground |
| Explosion | 36 bodies woken, up to 17.7 m/s |
| Lifetime | removed after lifetime + fade |
| Player pushes 15 kg crate | 2.4 m in 2 s |
| Raycast → prop impulse | hit, Δv 4 m/s |
| Hover at rest | **1.238 m** (target 1.2), peak-to-peak 0.0000 m |
| Drive 10 s over noisy terrain | max tilt 30°, height 0.54–4.1 m, 32 m/s, no NaN |
| Parked on 20° ramp | drift 0.000 m, body tilt 19.3° |
| Crash into a pillar | stopped at the face, impact 25.9 m/s |
| Over sea ice | 1.238 m |

Browser (headless Chrome, emulated CSP): loads in ~2–4 s, one request to jsDelivr, WASD/jump/boxes/shatter/ride all work.

## 6. Performance

| Scene | Cost/frame (M-series, Node) |
|---|---|
| Heightfield 257² build | 22 ms once |
| 400 static cylinders | 2 ms once |
| 1 character + 1 vehicle + 160 debris piling + 400 cylinders + 1 ray | avg **0.40 ms**, p95 0.94 ms, max 4.7 ms (first pile-up frame) |
| Typical (1 char, 1 vehicle, 40 resting debris) | 0.07 ms |

Download: +1.08 MB gzip (once, cached). Ready in 2–4 s in the headless-browser test (download + WASM compile).

## 7. Pitfalls

- **Heightfield layout**: Rapier wants column-major with rows = Z. `physics.js` transposes `H` (`hs[iz + ix*VN] = H[iz*VN + ix]`). Passing `H` directly mirrors the terrain along the diagonal (94 m errors in tests).
- If `H` changes (terrain edits), call `init` again — the heightfield is a copy.
- Queries see new static colliders only after a world step; `physics.js` handles that with an internal flush, but add statics before creating characters where possible.
- `Phys.step` drives debris and vehicles; characters step inside `move()`. Call `vh.update()` before `Phys.step()` in the frame (one-frame input latency otherwise, harmless).
- `jumpPressed` must be an edge (`pressed.has('Space')`), not a held key — a held key keeps re-buffering.
- Negative / huge `dt` (tab switch, first frame) is clamped (`0..0.1` character, `0..0.25` world).
- Feet sit 0.02 m above ground on flat (controller skin), ~0.03 m on a 20° slope — invisible, but don't re-snap to `getH` afterwards.
- Shards ignore the player on purpose; set `prop:true` for things the player should bump.
- Spheres keep rolling down slopes (no rolling friction in Rapier); default angular damping 0.8 + lifetime handles it.
- Hover height settles ~3% above target (spring damping reads post-gravity velocity) — set `hoverHeight` 0.04 lower if exact matters.
- CSP must allow `'wasm-unsafe-eval'`; otherwise `PhysReady` rejects — keep the old movement code as fallback.
