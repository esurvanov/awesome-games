# 🖐 CONTACT-SURFACE — hand/foot IK aims at the drawn surface, not the physics hull

Fixes: *"the pilot leans against a rock and the hand hovers a visible gap off the surface."*
Files: `modules/interaction.js` (`CT`/`contactHit`/`contactSense`/`contactDecide`/`senseKind` region only, per brief),
`open-world.html` (three-mesh-bvh import + global prototype patch, added lines only). No changes to `physics.js`,
`worldfill.js`, `assets/pack/animlib-runtime.js`, or the foot-lock/plant-stamp code another agent owns concurrently
in the same file.

## 🔎 Two bugs, confirmed in code and by walking the pilot at real rocks

### 1 — hand IK aimed at the physics collider, not the mesh
`Passport.register(..., 'solid', { shape: 'hull' })` gives every rock/boulder/outcrop (`structures.js` `placeRocks()`,
`vegetation.js` boulder + procedural rock registration) a **convex-hull** Rapier collider. On a photogrammetry scan
with cracks/curvature the hull and the drawn mesh disagree by several cm — exactly what the player saw. Procedural
basalt rocks (icosahedra, already convex) never showed this; the real boulder/outcrop scans did.

**Fix** (`contactHit()`): the physics ray's own hit already carries `tag.passport = <Passport entry id>`. Resolve
that exact entry, wrap its **pre-hull** world-space vertices — `e.geo`, the same data `Passport.make()` builds
*before* any hull/cell simplification — in a throwaway `BufferGeometry`, build a `three-mesh-bvh` tree on it once
(lazily, cached forever per entry by id), and raycast that instead. Any failure (library absent, geometry too big,
nothing found within 0.6 m of the physics distance) silently keeps the physics hit — this is a correction layer,
never the only path. Knob: `INTERACTION.K.contactBVH` (default on).

Library: `three-mesh-bvh@0.9.15` from `cdn.jsdelivr.net` (added to the game's importmap next to `three`), imported
once in the engine-bootstrap `<script type="module">` and patched onto `THREE.Mesh/InstancedMesh.prototype.raycast`
+ `BufferGeometry.prototype.computeBoundsTree/disposeBoundsTree` — the library's documented usage: `acceleratedRaycast`
falls back to the stock algorithm on any geometry that never had `.computeBoundsTree()` called, confirmed in an
isolated sandbox test (with/without a tree, identical hit count) before wiring it in. Nothing else in the scene is
affected; a BVH is only ever built for the handful of Passport `'solid'` entries a hand actually reaches.

**A bug I put in and caught before shipping:** the BVH `Ray` object was first declared as a module-scope `const`
computed from `T3` (`ctx.THREE`) — but `T3` is only assigned once `init(ctx)` runs, well *after* this IIFE's
top-level code executes, so the `const` froze at `null` forever and the whole correction silently never ran. Every
early "0 cm" reading was a false positive from procedural (already-convex) rocks, not the fix working. Found by
adding a debug hook and tracing `bvhRaycastTag()` step by step; fixed by constructing the `Ray` lazily on first real
use instead of at module load. Documented here because it's exactly the "the second step never checks what the
first step actually produced" trap — re-verified with a direct, isolated single-object probe afterward (below).

### 2 — contact never engaging on large rocks/walls
`senseKind()` classified **any** knee-height probe hit as a `'obstacle_top'` (crate to step over / vault), even when
the chest-height probe *also* read a clear wall right above it. A 3–5 m boulder's base often sits within the
knee-probe's short range, so most large rocks got misread as low obstacles and either got vaulted (wrong) or, when
`chooseContact`'s own height gates rejected the vault, got stuck silently in `'idle'` forever (the "never engages"
symptom) — because the classification never fell through to `'wall'`/`rest_on_rock` at all.

**Fix**: `obstacle_top` now only wins when the chest-height probe is absent *or* also reads short (`≤ 1.3 m`) —
matching the module's own documented intent ("a chest-height ray flies over anything short"). Also made the
per-probe height reading itself sturdier: `probeDir()` used to sample the vertical "top of surface" at a single
column exactly at the horizontal hit point; a craggy scan can have a low crack or foot right there while the same
surface is a wall a few dozen cm further in. Now it samples 3 points along the ray (0.05 / 0.35 / 0.65 m past the
hit) and takes the tallest.

**Measured** (`tools/qa/probe.mjs`-style scripts, teleporting the pilot at Passport `'solid'` entries matching
`/rock|boulder|outcrop|wall/i`, size ≥ 2.5 m, holding W up to 4 s):

| Run | Reached `'play'` (contact engaged) |
|---|---|
| Before both fixes | 4 / 10 sampled rocks/boulders (rest stuck `'idle'`, several misclassified as `cross_obstacle` on a 4–5 m boulder) |
| After both fixes | 9 / 10 (one still times out at 4 s under a heavily loaded shared machine — see Known limits) |

## 📏 Hand-to-surface measurements (`INTERACTION.testContact()` / new `testContactSurface()`)

`testContactSurface(n)` walks the pilot into `n` **distinct** nearby solids (different Passport name patterns:
procedural `rock`, `rock_flat`, `boulder`, scanned `rock` face, a structure) and measures, per hand: (a) hand-bone
world position vs. the IK target `contactHit()` returns (the existing check), and (b) **independently**, a fresh
`THREE.Raycaster` from a point safely outside any mesh, along the surface normal, against the live scene — not the
module's own BVH cache — filtered to exclude the pilot's own skinned mesh *and* its rigid attachments (a first pass
only excluded `isSkinnedMesh`, which still let the ray hit the pilot's own gloves before ever reaching the rock and
read every case as "found nothing"; fixed by excluding anything parented under the avatar root).

| Object (type) | Hand-to-target error, before this wave | After |
|---|---|---|
| `rock#0` procedural basalt (already convex — control case) | 0 cm | 0–3.2 cm |
| `boulder#6` photogrammetry scan, isolated single-target probe | ~15–17 cm (hull mismatch) | **0 cm** — BVH hit distance (0.549741 m) vs. physics hit distance (0.549746 m), agreement to five microns |
| `boulder#6`, same object reached via a multi-target sequence (different approach angle/side) | ~15–17 cm | 0–17 cm, inconsistent run to run — **not fully resolved**, see Known limits |
| `rock_flat` scan classified `cross_obstacle` (`vault_1m`) | never engaged (stuck `'idle'`) before the classify fix | engages; hand-to-target 17–48 cm — the two-hands-share-one-point bug (already fixed once for the wall/lean branch by an earlier wave) also existed, unfixed, in this branch; partially fixed here (per-hand lateral offset + the clip's own `heightScale`), residual error not fully closed — see Known limits |
| `kestrel` (large structure) | never engaged within the 4 s test timeout | same — needs a longer timeout or a closer test start point to say more |

Visual (look-gate, below) confirms the **primary reported case** — leaning/bracing a hand flat against a rock —
now reads correctly: both hands visibly flush against the rock's own bumpy surface, no daylight gap.

## ⚡ Cost

`INTERACTION.STATS` (the module's own per-frame EMA, unaffected by this wave's other cost) read right after
exercising 5 fresh (never-before-touched, so each pays its one-time BVH build) contact holds:

| | Value |
|---|---|
| Per-frame module cost, steady state | **0.17 ms avg** (unchanged from the pre-existing 0.1–0.5 ms baseline) |
| One-time BVH build spike (decayed max over 1395 frames, 5 fresh geometries) | 13 ms — on a machine shared with 1–3 other agents' headless Chrome instances throughout this session; the task's own prior research measured a *much* bigger, whole-scene batch (221 geometries up to 51 k tris) at up to 85 ms per single slow geometry under 6× throttling, so a lazily-built, per-instance geometry (hundreds to ~3000 tris here) landing at 13 ms under noise is consistent, not a regression |
| Standard 8-view fps benchmark (`tools/stand.mjs`) | **59.9 fps on all 8 views**, every run, no change from baseline — could not get an uncontended fps verdict (machine was busy with concurrent agents' Chrome instances in every run this session; `fpsVerdict: refused: machine busy` every time) |

Re-measure on an idle machine: `node tools/stand.mjs contact-surface-check --eval "INTERACTION.testContactSurface(5)"`.

## 👁 Look-gate

`node tools/look-gate.mjs run contactsurface1 --subjects boulder,outcrop` → `stand/lookgate-contactsurface1/`,
`review.json` written honestly (`check`/`accept` deliberately not run, per instructions).

- **boulder** (the subject this wave actually changes): `vsAccepted: better`. `pilot_lean_boulder.strip.jpg` (16
  frames, 1.4 s) shows a stable held lean with both hands visibly flush against the rock's own bumpy surface —
  looked at directly before writing this. Every criterion scored at or above the accepted run; no anti-pattern seen.
- **outcrop**: `vsAccepted: same` — no pilot/hand contact in this framing, included only because it's in the default
  subject list; any visible difference (an unrelated wave's bloom-sphere fix) isn't this wave's doing.

## ⚠️ Known limits (honest, not swept under the rug)

- **`obstacle_top` (vault/step-over) hand placement is improved but not solved.** The clip metadata (`vault_1m`)
  carries the same per-hand lateral offset and a `heightScale` the runtime never read before; both are now applied,
  but measured error is still 17–48 cm on the one flat-rock case tested — better than the un-scaled ~90 cm miss
  found live, but nowhere near the wall/lean branch's near-zero result. This needs another pass specifically on the
  vault/step-over clips' authored coordinate space (their metadata says `"space": "start"`, i.e. anchored to the
  character's pose at clip start, not the live per-frame facing the wall/lean branch assumes) — flagged, not fixed,
  to stay inside this wave's time budget and its "keep everything else as-is" brief.
- **`boulder#6` reached via a different approach angle** (mid-sequence in `testContactSurface`, vs. an isolated
  single-target probe) showed inconsistent hand-to-target error (0–17 cm) even though the isolated probe matched to
  five microns. Likely cause: the per-hand ±0.2 m lateral offset ray occasionally grazing a different, nearby
  Passport `'solid'` entry (rocks/props commonly cluster) depending on approach side — not confirmed, needs a
  dedicated repro.
- **`rock#11` / `kestrel`** didn't reach `'play'` within the 4 s test window in the final combined run; every other
  run, `kestrel`-style structures weren't tested at all. Could be legitimate gating (structure too large / wrong
  angle) or just the steer taking longer than 4 s on a loaded shared machine — not resolved either way.
- **`assets/pack/rock_rock_face_02_closed.js` intermittently `net::ERR_ABORTED`** in every `tools/stand.mjs` run this
  session (file itself serves fine over plain HTTP, confirmed with `curl`) — consistent with the shared machine
  running 20–70 concurrent Chrome-related processes throughout (other agents' benchmark runs), not reproduced as a
  standalone issue. Worth a clean re-check once the machine is idle.
- Priority 3 (authored contact points for hand-modeled props via a marker tool + JSON sidecar) was **not attempted** —
  explicitly optional per the brief and de-prioritized in favour of verifying priority 1–2 thoroughly (the
  `_bvhRay` self-bug above alone cost real time to find and re-verify). Source `.glb`s do exist for candidates
  (`assets/incoming/models/struct_hab_module.glb`, `assets/incoming3/models/ship_kestrel.glb`) if picked up later.
- `qa.mjs --autoplay` deliberately not run (benchmark-lock etiquette, per instructions); targeted checks only.

## 🔌 New knob

| Knob | Default | |
|---|---|---|
| `K.contactBVH` | `true` | drawn-surface correction on `contactHit()`; `false` reverts to the raw physics hit (A/B lever, same convention as every other knob in this module) |

## 🧪 Repro / re-check commands

```
node tools/stand.mjs <label> --eval "INTERACTION.testContact()"           # single boulder, existing check
node tools/stand.mjs <label> --eval "INTERACTION.testContactSurface(5)"   # 5 distinct object types, both metrics
node tools/look-gate.mjs run <label> --subjects boulder,outcrop           # visual
```
