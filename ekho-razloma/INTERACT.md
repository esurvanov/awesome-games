# 🤝 INTERACT — interaction passport + mediator

Before: every touch was a special case for one pair of objects (probe rays → guess a clip → aim the hands at whatever
the ray hit). Now: every interactable **kind** carries a passport of contact points (data), and one **mediator** picks
the point, the clip, where to stand and how to face for the pilot's intent. New kinds = re-run the authoring tool, no code.

## 🧩 Architecture

```
probes (front / knee / sides, 5 Hz) ─► intent (Jev CONTACT_INTENT or rules) ─► INTERACT.plan(intent, touched entries, pilot)
   passport points of the entry's kind × its transform ─► clip families for the intent (+ what the object offers instead)
   ─► stand spot + yaw per point/clip ─► checks: patch spans the clip's hand height · walkable free stand · free path · reach
   ─► palms / feet snapped onto the DRAWN mesh (three-mesh-bvh) ─► steer (≤ 1.4 m/s, ≤ 4.5 rad/s) ─► play ─► hold
unmarked kinds ─► old probe + BVH path (CONTACT-SURFACE)            marked kind, no valid point ─► no contact (never a palm in the air)
```

| Part | File | Role (Unity XR analogy) |
|---|---|---|
| 🗂 Passport data | `modules/interact-data.js` (generated, ~90 KB) | Interactable: points per kind |
| 🧠 Mediator | `modules/interact.js` → `window.INTERACT` / `ctx.interact` | Interaction Manager |
| 🧍 Pilot contact layer | `modules/interaction.js` CT (`contactPlan`, `planStep`) | Interactor |
| ✋ Limb IK | `assets/pack/animlib-runtime.js` `ContactLayer` / `LimbIK` | hand / foot pose |
| 🛠 Authoring | `tools/interact/author.mjs` + `author-page.js` | point proposal + contact sheets |
| 📏 Checks | `tools/interact/run.mjs` + `page.js` (`IX.*`) | engage / gap / animals / pushables / cost |

## 🗂 Passport format

`kinds['<name>|<vertex count>']` — the vertex count is part of the key: a changed model is never mapped with stale points
(it falls back to the probe path until the tool is re-run).

| Field | Meaning |
|---|---|
| `frame` | `anchors` (instanced kinds: the transform of every instance is solved from 4 of its own drawn vertices, checked on 2 more, residual ≤ 2 cm or the instance is skipped) · `obj` (single objects / pushables: the Object3D matrix, live) · `trunk` (Passport cylinder) |
| `pts[]` | `[x,y,z, nx,ny,nz, ex,ez, type, y0,y1, w]` — type 1 wall patch (vertical extent y0..y1, flat width w), type 2 top rim (e = outward edge) |
| `rAt` (trunks) | drawn bark radius ÷ Passport cylinder radius at 0.9 / 1.3 / 1.6 m |
| `alias` | same model under another name (echo stones = ruin pieces) |

Authoring (`node tools/interact/author.mjs [--kinds re] [--merge]`, ~4 min, one browser): mid-size reference instance;
stations every 0.45 m around its oriented footprint; horizontal rays 0.5–2.2 m → **wall patches** (outward, |n.y| < 0.5,
vertically continuous ≥ 3 samples, two-palm width test ±0.2 m); downward rays walked in from the rim → **tops** (up-facing,
two palms ±0.22 m within 25 cm, a hand's depth in). Contact sheets: `stand/interact-author/<kind>-v0/v1.jpg`.

## ✋ Mediator rules

| Intent | Clips tried (object decides) | If the object can't |
|---|---|---|
| rest_on_rock | hand_wall_both (face ≥ 0.3 m flat) · lean_hands_ledge (top 0.41–0.86 m) · lean_shoulder_r/l · hand_wall_r/l | — |
| touch_surface | hand_wall_r/l/both | → rest_on_rock |
| cross_obstacle | vault_1m (top 0.88–1.22 m, palms within 12 cm of the clip's own height) · step_over (≤ 0.5 m) | → rest_on_rock |

One rule for every clip: the clip's authored contact (character space, surface normal nL) lands on the point with nL turned
onto the point's outward direction: `yaw = atan2(ex, ez) − atan2(−nL.x, −nL.z)`, `stand = q − left·px − fwd·pz`.
Walls are re-cast at the clip's own contact height; two-palm holds are squared to the chord between the two snapped palms.
Shoulder leans (no limb IK) slide the pilot along the normal until the shoulder meets the face.

## 🔧 Fixes found on the way

| Symptom | Cause | Fix |
|---|---|---|
| Palms "on" a rock, fingers 8–9 cm inside it | `LimbIK` pressed local **±X** onto the surface — on this rig X runs along the fingers | palm axis = local **+Y**, measured: ±X −9.5 / +6.2 cm · ±Z ±8 cm · +Y +1.0 / −0.1 cm (`ANIMLIB.PALM`) |
| 4 m boulders vaulted | knee probe reads the base as a low obstacle | the passport has no vaultable top there → rest a hand instead |
| Hands hovering on curved faces | one normal for both palms | square to the snapped palm chord |
| Thin trunks: two palms in the air | probe path picks hand_wall_both on a 10–20 cm trunk | trunk kinds: one palm or a shoulder, never two |

## 📏 Results (M1 Pro, shared machine, same harness before / after in one tree)

Method (`tools/interact/run.mjs <label> --test '<kinds>'`, before = `--init 'window.INTERACT_OFF=true'`): one mid-size
instance per kind, the pilot **walks at it from 4 sides** (W held until blocked or the contact layer takes over, then
released). Engaged = the contact clip is playing. Gap = the **closest glove / boot / sleeve skin vertex to the DRAWN
mesh**, measured along the drawn surface's own normal with a fresh `THREE.Raycaster` on the rendered geometry (never the
module's own target); median over the hold, worst of the effectors; `air` = no drawn surface within 60 cm under the palm.
Target ≤ 3 cm. Engaged / median / worst:

| Kind | Points | Before | After |
|---|---|---|---|
| boulder | 47 | 3/4 · 7.8 cm / 34.1 cm | 3/4 · 9.9 cm / 18.1 cm |
| crate_stack | 18 | 3/4 · 25.2 cm / air | 0/4 · — / — |
| echo0 | 15 | 1/4 · 11.4 cm / 11.4 cm | 1/4 · 4 cm / 4 cm |
| kestrel_tail | 49 | 3/4 · 10.6 cm / 68.1 cm | 4/4 · 6.7 cm / 21 cm |
| kestrel_wing | 36 | 0/4 · — / — | 3/4 · 3.5 cm / 3.5 cm |
| kestrel | 142 | 3/4 · 5.2 cm / 23.1 cm | 3/4 · 2.4 cm / 2.5 cm |
| rock_flat | 3 | 0/4 · — / — | 1/4 · 3.9 cm / 3.9 cm |
| rock_outcrop | 14 | 1/4 · air / air | 0/4 · — / — |
| rock (2515 v) | 5 | 0/4 · — / — | 1/4 · — / — |
| rock (4648 v) | 8 | 1/4 · air / air | 2/4 · air / air |
| rock (4716 v) | 47 | 1/4 · 5.2 cm / 5.2 cm | 2/4 · 1.9 cm / 1.9 cm |
| spireN | 153 | 1/4 · 21.9 cm / 21.9 cm | 0/4 · — / — |
| st_cairn | 7 | 1/4 · 52.2 cm / 52.2 cm | 1/4 · — / — |
| st_drum_depot | 16 | 0/4 · — / — | 1/4 · — / — |
| st_ruin_arch | 15 | 1/4 · air / air | 1/4 · air / air |
| st_ruin_column | 27 | 2/4 · 15.8 cm / 15.8 cm | 3/4 · 8.3 cm / 24.8 cm |
| st_ruin_wall | 35 | 2/4 · air / air | 2/4 · 8.3 cm / 8.3 cm |
| st_sledge | 4 | 0/4 · — / — | 0/4 · — / — |
| st_tent_polar_stove | 29 | 2/4 · 18.4 cm / 18.4 cm | 1/4 · — / — |
| st_tent_polar | 28 | 2/4 · air / air | 1/4 · 3.3 cm / 3.3 cm |
| station_dome | 121 | 3/4 · 7.9 cm / 7.9 cm | 3/4 · 4.5 cm / 9.4 cm |
| station_module | 21 | 2/4 · air / air | 0/4 · — / — |
| station_sledge | 5 | 2/4 · air / air | 2/4 · air / air |
| struct_hab_module | 71 | 3/4 · 7.9 cm / 7.9 cm | 4/4 · 10.9 cm / 19.1 cm |
| tool_crate | 18 | 0/4 · — / — | 1/4 · 20.3 cm / 20.3 cm |
| vehicle_rover_sev | 43 | 2/4 · 20.4 cm / 20.4 cm | 2/4 · 6.3 cm / 6.3 cm |
| barrel_steel | 4 (push: live snap) | 1/4 · — / — | 0/4 · — / — |
| crate_wood_02 | push: live snap | 2/4 · — / — | 0/4 · — / — |
| crate_wood | push: live snap | 3/4 · — / — | 2/4 · — / — |
| drum_blue | push: live snap | 0/4 · — / — | 3/4 · — / — |
| lamp_post | ring | 3/4 · air / air | 3/4 · air / air |
| prop_barrel_01 | 4 (push: live snap) | 1/4 · — / — | 2/4 · — / — |
| prop_crate_military | push: live snap | 2/4 · — / — | 4/4 · — / — |
| prop_crate_wood | 2 (push: live snap) | 2/4 · — / — | 4/4 · — / — |
| st_pole | ring | 4/4 · air / air | 3/4 · air / air |
| tree_dead_birch | ring | 4/4 · air / air | 4/4 · air / air |
| tree_fir_windbent | ring | 4/4 · air / air | 3/4 · 4.3 cm / 5.2 cm |
| tree_snag_dead | ring | 2/4 · air / air | 2/4 · 24.4 cm / 24.4 cm |
| tree_spruce_dense_tall | ring | 4/4 · 35.1 cm / air | 4/4 · 11.2 cm / 29.5 cm |
| tree_spruce_tall_snow | ring | 3/4 · 13.5 cm / air | 3/4 · 5.5 cm / 5.8 cm |

Passport self-check (`IX.verifyAll()`): anchor residual ≤ 1.5 mm on every instanced kind; 96–100 % of mapped points lie
on each instance's drawn surface (spires 85 %: plinth rim).

### ✅ / 🔴 Honest reading

| | |
|---|---|
| ✅ at target | Kestrel hull 2.4 / 2.5 cm (was 5.2 / 23), wing 3.5 (never engaged before), scanned rock 1.9 (5.2), polar tent 3.3 (air), flat rock 3.9 (never engaged), echo stone 4.0 (11.4) |
| 🟡 better, not at target | rover 6.3 (20.4), ruin wall 8.3 (air), dome 4.5 / 9.4 (7.9), boulder worst 18 (34), Kestrel tail worst 21 (68) |
| 🟡 trunks | fir windbent 4.3 / 5.2 (air before), spruce tall 5.5 (13.5), dense spruce 11 / 30 (35 / air) · lamp post, pole, birch still `air`: the palm lands on the fitted cylinder, the drawn trunk is thinner there (radius-per-height data unreliable) |
| 🟡 pushables | engage 2–4 of 4 on most props (drum 0 → 3 of 4), palms snap onto the drawn prop, but the push gap itself was not captured by the harness (too few high-weight frames) |
| 🔴 not solved | hab module 10.9 / 19 (was 7.9), ruin column worst 25, tool crate 20 (ledge palms into the lid), several kinds engage 0–1 of 4 (no valid stand spot from that side: `INTERACT.STATS.why` — mostly `fit:span` = the face does not reach palm height at that spot) |

## 🦌 Animals vs solids — 30 s scripted run (`IX.animals(30)`)

Each stag is sent at the nearest sizeable solid 10–45 m away every 5 s; the fox is sent to a point behind a rock.
| | Before | After |
|---|---|---|
| Stag capsule inside a solid | 4 of 5196 stag-frames (0.08 %) | **2 of 9174 (0.02 %)** |
| Fleeing stag pressed / scraping (moved < 40 % of its step) | 83 of 4466 flee-frames (1.9 %) | **57 of 8687 (0.66 %)** |
| Fox capsule inside a solid | 0 | 0 |
| Fox seeking but not moving (stuck at a rock) | 6 frames | 🔴 71 frames |

Before, the game's own 2D circle push-out already kept bodies mostly outside (hence few overlaps); the steering removes
most of the remaining scraping. Fox: overlaps stay 0, but the re-aimed step sometimes holds still for a few frames when
both sides of a rock are blocked ("boxed in") — worse than before, left for later. Frame counts differ because the
machine was loaded differently (same 30 s).

## 📦 Pushables — shoved down a 24° slope (`IX.pushTest`)

| Prop | Collider | Rest at | Slid / rolled | Jitter after rest |
|---|---|---|---|---|
| crate_wood_02 | hull (before) | 4.4 s | 23.3 m, tumbling | 0.23 mm |
| crate_wood_02 | **box** | **2.7 s**, asleep, toppled 167° | **5.6 m** | **0.07 mm**, 0 wakes |
| drum_blue | hull | still rolling at 7 s | 31 m | — |
| drum_blue | **cylinder** | still rolling (round) | 12.6 m | — |
| prop_crate_military | hull / box | 1.2 / 1.7 s | 3.0 / 2.9 m | 0.06 / 1.2 mm |

Box / upright cylinder is chosen only when the prop's points fill it (outline corners, ring radius); flat or irregular
props keep the hull. Far (> 40 m) nearly still props are put to sleep; a prop found under the ground is put back on the
surface above it (a fitted camp crate spawned overlapping its neighbour was ejected 23.6 m under the one-sided
heightfield; with the guard, a fresh load has 0 of 17 props under the ground, lowest gap −12 cm = sunk into the snow skin).

## ⚡ Cost — CDP CPU throttle 4× (`IX.costSuite()`), before → after

Per-frame JS of the interaction module (EMA) and the physics step, M1 Pro under 4× throttle (≈ Intel Air class CPU):

| Scenario | interaction ms before → after | physics step ms before → after | frame median ms before → after |
|---|---|---|---|
| idle, open snow | 1.97 → 1.82 | 0.69 → 0.55 | 28.4 → 28.3 |
| holding a contact | 2.27 → 2.02 | 0.30 → 0.20 | 42.3 → 32.0 |
| 6 stags fleeing (steering rays) | 2.00 → 2.09 | 0.24 → 0.21 | 19.0 → 18.1 |
| pushing a crate / drum | 3.04 → 3.36 | 1.23 → 0.78 (max 12.6 → 7.3) | 44.3 → 41.0 |
| props at rest nearby | 1.90 → 1.78 | 0.72 → 0.27 | 27.6 → 26.9 |

Per-frame cost unchanged within noise; the fitted colliders make the physics step cheaper. 🔴 One-time spike when a
contact starts: **≈ 21 ms at 4×** on the first touch of an object (building that object's BVH + the plan); later plans
0.3–5 ms. Worth moving the BVH build to load time for the kinds near the pilot.

## 👁 Look-gate

`node tools/look-gate.mjs run interact1 --subjects boulder,pilot_wall,pilot_wreck,pilot_tree,pilot_push` at 1512×860 @2x
→ `stand/lookgate-interact1/`, `review.json` written honestly (`check`/`accept` deliberately not run, per instructions).
New subjects for this wave: `pilot_wall` (ruin wall), `pilot_wreck` (Kestrel), `pilot_tree` (trunk), `pilot_push` (crate) —
`tools/look/subjects-interact.mjs` / `lg-interact.js`, the pilot really walks up (W held) and the contact layer takes over.

| Subject | Verdict |
|---|---|
| 🪨 boulder | visible, plausible contact; vs accepted **same** (worst-case gap much better, median gap slightly worse — a wash, not a clean win) |
| 🧱 pilot_wall | visible, plausible seated lean; new subject, no baseline to compare |
| ✈ pilot_wreck | 🔴 **camera-framing bug**: the shot is almost entirely the pilot's own helmet in close-up; the wreck and the contact point are off-frame even though `run.json` says the shoulder-lean clip did engage |
| 🌲 pilot_tree | 🔴 same class of bug: camera sits under the overhanging branches, trunk and the pilot's hand aren't in frame |
| 📦 pilot_push | 🔴 **this specific attempt never engaged**: `run.json` records `hands -` (push state never entered); the strip shows the pilot running past / hopping over the crate instead of pushing it — consistent with `crate_wood` engaging only 2 of 4 approach angles, and this scripted single-angle test landed on a non-engaging side |

Honest overall read: only boulder and pilot_wall are both visible and judgeable, and neither is a clean win over what
came before. pilot_wreck / pilot_tree are look-gate camera bugs (`lg-interact.js`'s `shot()` distance/yaw needs
per-species tuning), not evidence against the interaction engine. pilot_push is a real engagement miss, the same gap
already measured honestly in the engage-rate table above. `review.json` verdict: **reject** — real, partial progress,
not yet a clean pass; left for the main agent alongside the rest of this list.

## 🔌 Knobs

| Knob | Default | |
|---|---|---|
| `INTERACTION.K.passport` / `passportOnly` | true / true | mediator on; marked kinds never fall back to probe hands |
| `INTERACTION.K.steerSpeed` / `steerTurn` / `steerMax` | 1.4 m/s / 4.5 rad/s / 2.2 s | walk-in to the stand spot |
| `INTERACTION.K.avoid` / `avoidTurn` | true / 5.5 rad/s | stag / fox steering |
| `INTERACT.K.reach` / `maxStandMove` / `maxTurn` / `nearPts` | 2.2 m / 1.6 m / 2.4 rad / 14 | mediator search |
| `window.INTERACT_OFF = true` (before load) | — | the whole pre-INTERACT behaviour for A/B (passport, steering, palm axis, prop fit) |
| `window.PHYS_PROP_FIT = false` | — | hull colliders for props |

## 🧾 Left for later

- Engage rate: from some sides no stand spot passes (face below palm height, stand spot on another solid). Needs points on
  lower faces for the one-palm / ledge clips and a "turn to the side that works" step. (Not attempted this wave —
  substantial authoring/data work; see the pushable-specific fix below, which is a different bug.)
- Hab module / ruin column / tool crate still 10–25 cm; the vault clip is only planned for 0.88–1.22 m tops (its palms
  can't reach lower); step_over has no root motion applied (the body snaps back at the end — pre-existing).
- Trunk radius per height for 5 spruce kinds hit the 0.3 clamp (bark hidden in branches): leans on them are unmeasured.
- Pushables: the drawn-mesh palm snap works while pushing, but the harness measured too few frames to give a gap number.
- Kinds are keyed by vertex count: when another agent changes a model, re-run `node tools/interact/author.mjs` (~4 min).
  Checked this wave: `modules/interact-data.js` was generated (commit `569d30b`) *after* the Camp commit that resized
  crate/drum/sledge/tents/Kestrel (`e409671`), and no model file has changed since — no re-run needed right now.

### 🔧 This wave (CONTACT/CT owner)

- **Root cause found for the pushable engage-rate problem**: `senseKind()` classified *any* object in front matching the
  knee/chest "obstacle" height window as `obstacle_top` (→ vault/step-over), and anything taller as `object_face` (→
  lean/touch) — with no check for the object's Passport role. A pushable crate/drum/barrel satisfies one of those two
  windows on most approaches, so the CT contact layer routinely hijacked control (vaulted it, or leaned on it) *before*
  the pilot got close enough for the dedicated push mechanic (`pushState()` in `armsUpdate`) to ever take over — this is
  exactly the "pilot running past / hopping over the crate instead of pushing it" symptom from the `pilot_push` look-gate
  take, and plausibly a good part of the < 4/4 engage numbers in the pushables table above. Fix (`modules/interaction.js`
  `senseKind()`): any front/knee probe hit tagged `kind: 'prop'` (only pushables use that tag — verified: `spawnDebris`
  with `prop: true` is called nowhere else in the codebase) now returns `surface: 'none'` immediately, before the
  obstacle/wall checks — CT never engages on a pushable, so `pushState()` always gets first (and only) claim on it.
  Verified live: an `interact2` look-gate run this wave shows both `push_crate` and the `pilot_push` motion take
  actually pushing (`INTERACTION.B.arms.mode === 'push'`, "hands push" / "pushes crate_wood across the snow") — the
  earlier `pilot_push` failure mode (`hands -`, never engaged) did not reproduce. A standalone `tools/interact/run.mjs
  --test` re-measure of the 7 pushable kinds' engage rate was attempted but landed on an extremely loaded shared machine
  (lock queue 6–8 deep, load average up to 46 on 8 cores) — the numbers came back noisy and partly contradictory
  (one kind up, several down versus the table above, which is not the expected direction for a fix that can only ever
  remove a competing system, never add a new failure) — **not trusted**, and not written into the table. Re-measure
  `node tools/interact/run.mjs <label> --test '^(crate_wood_02|crate_wood|drum_blue|barrel_steel|prop_barrel_01|prop_crate_military|prop_crate_wood)\|'`
  on a quiet machine before taking this as the final number.
- **Look-gate `pilot_push`**: `lg-interact.js` now retries several angles/entries with the push mechanic itself as the
  success condition (`walkInPush`/`engagePush`, same shape as the existing `engage()`), instead of one fixed approach
  angle. Confirmed engaging in this wave's `interact2` run.
- **Look-gate `pilot_wreck` / `pilot_tree` camera framing — attempted, did NOT fix it.** Gave `shot()` a per-subject
  `pitch` (previously hard-coded 0.3) and tuned `dist`/`yawOff`/`pitch` for both subjects. Re-ran `interact2`: still
  broken — `pilot_wreck` shows the Kestrel's own hull filling the entire frame (no pilot, no contact point), `pilot_tree`
  shows an unrelated patch of snow with a small dark prop, no pilot in frame at all. Both are look-gate-owned images
  (`stand/lookgate-interact2/{lean_wreck,lean_tree}.png`), looked at directly before writing this. Diagnosis this time:
  a constant `dist`/`yawOff` tweak can't fix it, because the game's own camera keeps the boom outside solids — leaning a
  shoulder against the *side* of a huge nearby hull (the Kestrel) or standing right under a tree's canopy means almost
  every camera position along the requested boom direction is inside or grazing that same object, so the boom collapses
  regardless of the requested distance. A real fix needs the shot to pick a `yawOff` that steers the camera-to-pilot
  line away from the object's own bulk (e.g. using the entry's box/trunk radius to bias yaw toward open ground), not a
  fixed per-subject number. Left for the next pass; `pilot_wall`/`pilot_push` (smaller / farther objects) aren't
  affected by this.

### 🔧 Next wave (CONTACT/CT + stags/fox owner)

- **Stag foot sliding — root cause found and fixed** (QA motion FAIL: `stags_flee` ratio 2.0, `stags_flee2` ratio 1.6).
  Two compounding bugs in `stagUpdate()`, both in the flee-speed / gait-blend code added after the ANIMLIB stag pack:
  1. The flee top speed (`top`) was still computed from the **legacy flat `Run` clip's** measured stride × `stagRate`
     (a formula that predates the 20-clip gait blender) — in practice ≈ 4 m/s, sitting squarely between the trot (3.0)
     and canter (6.0) bands, so a fleeing stag topped out there and stayed for the whole flight: pure trot forced to run
     ~30 % faster than its authored stride, forever, instead of crossfading up into canter/gallop where the blender's
     own numbers hold. Fixed: once `S.gait` (the `ANIMLIB.GaitBlender`) is built, `top` is now the **gallop clip's own**
     measured speed (`s.gaitMeta.gaitTable.gallop.speed`, 11 m/s) capped at the existing `K.stagTop` (9.5) — the legacy
     formula is now only a fallback for the (rare) case the blender never builds. Acceleration is separately capped at
     ≤ 7 m/s² (ANIMLIB.md: gait changes need their full stride) since `top` can now be much bigger than before.
  2. **The bigger one**: `GaitBlender` doesn't monkey-patch `A.loop()`/`A.once()` the way the player/fox `makeGait()`
     does — it only owns its own walk/trot/canter/gallop + idle actions. The game's own state machine
     (`open-world.html` `updateStags`) still calls `s.A.loop('run', 0.15)` directly whenever a stag starts fleeing, and
     nothing ever faded that action back out — so the legacy `run` action sat at effective weight 1 for the *entire*
     flee, blended **additively** under the gait blender's own weighted pose on the same bones (three.js accumulates
     per-action weighted contributions; it does not renormalize across actions that were never told about each other).
     A genuine double-drive, not a blend-tuning issue — the feet-analysis clip list even showed `"run×1.00"` active the
     whole time, gait blender or not. Fixed: while `s.gaitDriving` is true, `s.A.acts.run`'s weight is forced to 0 every
     frame after `S.gait.update()`.
  Measured before → after (`node tools/eye.mjs <label> --views none --no-feet --no-placed --motions stags_flee,stags_flee2,fox_follow,fox_seek,boss`,
  same harness, `stand/interact-fox1` = before this fix / after re-enabling fox leg retime, `stand/interact-fox2` = after
  both stag fixes with fox back to its previous config):

  | Take | Before (stag0/3) | After |
  |---|---|---|
  | stags_flee | drift 0.166 / p90 0.26, ratio 1.965 (FAIL) | stag0 drift 0.077 / p90 0.082, ratio 1.146 — **PASS** |
  | stags_flee2 | drift 0.164 / p90 0.451, ratio 1.572 (FAIL) | drift 0.28 / p90 0.28, ratio 3.157 (still FAIL) |

  Honest reading: the fix removes the systematic full-take slide (confirmed: `stag0` now passes cleanly, and the herd's
  measured speed jumped from a flat, suspicious 4.0 m/s in every take to ~9.5 m/s = `K.stagTop`, i.e. stags actually
  reach a believable flee speed now instead of being invisibly capped). The residual FAILs (`stags_flee` stag1, all of
  `stags_flee2`) come from only 1–3 usable steps per take now (steady cruising window got shorter because acceleration
  to the higher top speed eats more of the ~4 s take, and gallop's own duty factor is short — 0.21, harder for a ~12 fps
  sampler to catch mid-stance) — the single dominant "step" in each of these is the **very first stride from a
  standstill**, a known-hard edge case (`GaitBlender` has no analogue to the player/fox `makeGait`'s "start from the
  idle stance's own foot phase" logic). Left for later: give `GaitBlender` a matching cold-start phase pick, or extend
  the QA take a couple seconds so more steady gallop strides land in the sampling window.
- **Fox foot sliding — re-enabling per-leg retime makes it *worse*, confirms the earlier revert was right.**
  `K.foxLegs` (the `legWarp` per-leg clip-time-warp fix, disabled since commit `e349a91`: "per-leg stance detection
  unreliable on this clip") was flipped back on and measured: `fox_follow` drift 0.253→0.515 (ratio 4.4→13.4),
  `fox_seek` drift 0.16→0.66 (ratio 5.0→13.0) — a large regression, not noise. Reverted to `foxLegs: false` (matches
  HEAD). Root cause not fixed this wave — the fox's front paws genuinely sweep at a different rate than the hind paws
  in the source clip (`FIX-PERF` comment in `legWarp`), and warping each leg's own clip time independently is the
  designed answer, but its stance-window detection (`legWarp`'s per-leg local-minimum + tolerance heuristic) picks the
  wrong window on this rig often enough to make things worse on average. A real fix needs a more robust per-leg stance
  detector (e.g. cross-check against the other 3 legs' phase instead of a per-leg tolerance band alone), not a knob
  flip — left for later.
- **`stag1` +0.144 m leg-clearance reading — investigated, not a bone-identification bug.** All 6 stags share the exact
  same hoof-bone lookup (`ST.feet` names, resolved once per instance via `root2.getObjectByName`), so a wrong-bone read
  would show up identically across every stag, not one. A repeat check of the existing QA artifacts found the same
  class of reading recur on different stag indices across different runs (`stand/qa-contact1/qa.json`: `stag1`
  `Backleg_R002` +0.101 m; a separate report of `stag1` at +0.144 m) — consistent with a **transient pose**, not a
  per-instance bug: the 6 stags' idle-family clips (`idle`/`eat`/`look`) run out of phase with each other (each started
  at a different real time), so whichever stag the "grazing stags" spot happens to sample at the moment one of them is
  mid-weight-shift in `look`/`eat` reads a lifted hind leg. Any stag can show this at the right instant; it isn't
  structurally tied to index 1. Not fixed (it isn't a bug to fix) — if a future measurement wants a clean "all planted"
  reading, sample at a moment `st === 'graze' && s.A.cur === 'idle'` specifically rather than any of the idle family.
- **Boss (`golem`) foot sliding — root cause is outside this agent's owned files.** `boss` motion take: drift 0.371 m
  median / 1.973 m worst (ratio 1.057, i.e. it fails on raw drift, not on the stride ratio the way fox/stags do).
  The golem's gait already goes through the same `makeGait()` this wave's stag fix lives next to (`GOLEM.gait`,
  `modules/structures.js`), which *does* correctly monkey-patch `A.loop`/`A.once`/`A.update`, so the stag double-drive
  bug does not apply here. Reading `updateBoss()` (`open-world.html`): the golem only translates (`boss.x/z`) in its
  `'idle'` state, correctly clamped to `boss.vMax`; the `'rise'`/`'drop'`/`'charge'`/`'recover'` states never move
  `boss.x/z` at all, only `boss.y` and arm/body rotations — so the measured drift almost certainly comes from the
  *pose itself* swinging a foot bone sideways during those attack clips (rise/charge have large arm and torso motion)
  while the generic QA stance-detector (which only looks at foot height + vertical speed, not which state the actor is
  in) mistakes a low, momentarily-still foot mid-attack-pose for a "planted stance" and measures the pose's own swing
  as world drift. Fixing this needs either state-aware stance detection (QA-owned, `tools/qa/qa-page.js`) or keeping
  the attack clips' feet visibly still (`modules/structures.js`/`open-world.html`, both outside CONTACT/CT/stags/fox
  ownership) — left for the QA or PHYSBODY/structures owner with this diagnosis, not attempted here.
- **Hand gaps — hab module and ruin column are already fixed** (re-measured this wave, independent Raycaster,
  `node tools/interact/run.mjs handgap1 --test '^(struct_hab_module|st_ruin_column|tool_crate)\|'`): `st_ruin_column`
  3/4 · worst 3.1 cm / med 2.6 cm (was 3/4 · 8.3/24.8 cm) and `struct_hab_module` 3/4 · worst 2.6 cm / med 1.7 cm (was
  4/4 · 10.9/19.1 cm) — both now at or near the ≤ 3 cm target; some other wave's fix (unclear which commit) resolved
  them since this table was last written, confirmed fresh rather than assumed. `tool_crate` is **not** fixed: 1/4 ·
  worst 28 cm / med 28 cm (was 1/4 · 20.3/20.3 cm, i.e. still bad, arguably slightly worse) — matches the standing
  diagnosis ("ledge palms into the lid"): the crate's authored top-rim points assume a rim height that the two-palm
  ledge clip's own recast (`plan1`'s `Math.abs(hit.point.y - q.y) > 0.25` check) accepts even when the palm lands
  inside the lid rather than beside it. This is authoring data (`modules/interact-data.js`, generated), not mediator
  logic — a real fix needs `tool_crate`'s points re-authored with tighter top-rim placement or a smaller y-tolerance
  for this one kind, then `node tools/interact/author.mjs` re-run (~4 min) and re-measured; not attempted this wave
  (no safe way to hand-edit the generated data, and the authoring re-run plus a clean re-measure didn't fit the
  remaining time budget on a very congested shared machine).
- **Shoulder-contact near-miss — confirmed, not fixed.** PHYSBODY.md left this as a read-only conclusion ("the shoulder
  probe should fire ~9 cm before the capsule, from the arithmetic alone — never actually measured"). Measured it this
  wave: stood the pilot at controlled standoffs (0.30 / 0.42 / 0.45 / 0.48 / 0.55 / 0.70 m from a flat Kestrel-hull
  face, capsule confirmed not touching, physics on) and watched `PHYSBODY.STATS.shoulder`. Result: it fires continuously
  at 0.30 m and **not at all** from 0.42 m out to 0.70 m — zero events in the whole advertised 0.42–0.48 m near-miss
  band. The earlier arithmetic (capsule radius 0.2 + shoulder lateral offset 0.22 = 0.18 m of "free" margin before the
  0.27 m threshold) doesn't hold for a **head-on** approach: a shoulder offset *sideways* from the spine centreline
  doesn't bring it meaningfully closer to a flat face directly ahead of the character (only to something beside or at
  a corner), so there's no early-warning margin to find in this exact scenario — the probe is working as coded, the
  previous read-only prediction was wrong about which geometry it protects against. `PHYSBODY.md`'s own `testBump` (an
  oblique 30° approach, i.e. actually grazing a face to the side) is the scenario where the shoulder probe's lateral
  reach is supposed to matter, and that one already measures 8 touches / 17 frames of shoulder contact in this file's
  existing test suite — left as is; not a bug, just a narrower guarantee than previously believed.
- **Look-gate `pilot_wreck` — fixed.** `lg-interact.js`'s `shot()` no longer anchors the camera yaw on `P.face +
  yawOff` (the pilot's own facing, which points *into* the object during a lean); it now anchors on the direction
  *away* from the touched object's own bulk (the contact's authored surface normal, `CT().plan.normal`, or failing
  that the object-centre→pilot line), plus a small ± lateral swing for a 3/4 angle, picking whichever side ends up
  farther from the object's centre (`away()` / `clearance()` in `lg-interact.js`). Re-ran `interact3`
  (`stand/lookgate-interact3/lean_wreck.png`, looked at directly): the Kestrel's full hull, the pilot leaning on it
  shoulder-first, and the contact point are all clearly in frame — was "fills the frame with the hull, no pilot, no
  contact point" before. Clean fix for anything whose bulk is mostly horizontal/2D from the camera's height.
- **Look-gate `pilot_tree` — still broken, different failure mode than `pilot_wreck`.** Same yaw fix applied, plus a
  lower `pitch`/`dist` tried afterward (0.35→0.15, 5.2→4.0 m) since the first re-run still failed — neither helped:
  `stand/lookgate-interact3/lean_tree.png` and `stand/lookgate-interact4/lean_tree.png` (looked at directly) both show
  the trunk large and correctly in frame (an improvement over the old "unrelated patch of snow, no pilot, no trunk"
  failure) but still **no pilot anywhere in frame**, camera swung up above and looking steeply down through canopy.
  Diagnosis: the wreck fix only steers the camera's **horizontal** (yaw) direction away from the object's bulk, which
  is enough for a shape that's wide but low (a fuselage). A spruce canopy is wide **and** wraps around near the ground
  from most directions *and* overhead — there's no single horizontal escape direction, so the boom-vs-solid collision
  keeps rerouting the camera upward over the canopy instead, ending up high and pitched down at the ground with the
  (much shorter) pilot out of frame. A real fix needs the shot to also account for the **vertical** extent of the
  object (canopy height) — e.g. explicitly holding the boom below canopy height rather than letting the collision
  system choose freely — not a yaw-only steer. Left for later; `pilot_wall`/`pilot_push`/`pilot_wreck` (objects without
  a wide overhead canopy) are unaffected.
