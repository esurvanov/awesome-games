# 🧱 ARCH-INTERACT — pilot × rock interaction, target architecture

Scope of this wave: **rocks only** (Passport names `rock*`, `st_rock*`, `boulder*`, `rock_flat*`, `rock_outcrop*`).
Names are generic (Interactable, not Rock) so other object classes can plug in later — but only the rock class is implemented now.
Fox / stags / other objects stay on the old paths until the pilot passes step 5.

## Contexts

| Context | Owns | Module (new / existing) |
|---|---|---|
| World | Interactable instances, their affordances and surface patches | `modules/ix-world.js` (new) on top of `Passport` (read-only) |
| Body | BodySpec (one source of body measures), PosePipeline (the only writer of the pilot skeleton) | `modules/body-spec.js`, `modules/pose-pipeline.js` (new) |
| Motion | clips + MotionRequirements in the World vocabulary, MotionFitter | `assets/pack/anim_pilot_contact.js` + meta, `modules/motion-fit.js` (new) |
| Behaviour | Interaction (one per pilot) + ActionMatcher | `modules/rock-brain.js` → refactored into `modules/ix-behaviour.js` |
| Judgement | Scenario / Baseline (frozen), independent Judge, Verdict (human marks, saved in the repo) | `tools/rockgallery/*`, `modules/rock-lab.js`, `server/server.mjs` (marks endpoint) |

Physics (`physics.js`, Rapier) is an external system: **only physics moves the pilot's position**; others hand it a desired point.
The animation mixer is an external system: it yields a base pose only.

## Aggregates & invariants

| Element | Kind | Invariant |
|---|---|---|
| Interactable (+ profile: class, mass, mobile, flexible, material) | aggregate | description matches THIS instance's drawn triangles |
| Affordance (stand spot + what can be done: lean_back, lean_shoulder, hands_wall, hands_ledge, sit, step_up, climb, squeeze, touch_walk, knee_on, foot_on, duck, jump_down) | entity in Interactable | stand spot walkable and free for the BodySpec volume |
| SurfacePatch (height, tilt, curvature, width, flat, depth) | value object | measured on the drawn mesh |
| BodySpec (helmet sphere, shoulder width, chest/pelvis capsules, arm/leg lengths, palm offset from wrist, glove/boot/suit thickness, capsule radius) | value object | measured from the drawn pilot model; no module keeps its own body constants |
| PilotPose (per frame) — root: PosePipeline | aggregate | body volume not inside any solid (> 2 cm), palms on a surface (≤ 3 cm) or released, feet on ground, joints in limits |
| PoseRequest (limb target / spine lean / look / pelvis offset / spring) with priority + source | value object | never writes bones itself |
| MotionClip + MotionRequirements (height range, face tilt range, feet level delta, stretch limits) | entity + VO | requirements use the SurfacePatch vocabulary |
| Interaction (notice → approach → act → hold → release) | aggregate | one per pilot; target Interactable fixed until end; allowed transitions only |
| Scenario / Baseline | aggregate | frozen after capture (fixed rocklab layout/seed) |
| Verdict (human mark + judge numbers) | entity | human mark outranks numbers |

Domain services: InteractableReader, ActionMatcher, PoseSolver (inside PosePipeline), MotionFitter, Judge.
Domain events: `InteractionStarted`, `ContactMade`, `ContactLost`, `PoseRejected`, `InteractionEnded` — rock-feel (sound / snow / marks) and camera subscribe, they decide nothing.

## Steps (each behind a switch; old path kept until the new one is not worse on the baseline)

1. Judge + frozen baseline + marks saved to the repo.
2. BodySpec measured from the model; every duplicated body constant reads it.
3. PosePipeline at the end of the frame, pass-through (no visible change).
4. Writers moved one by one to PoseRequests: legs IK, spine lean, look, hands (contact layer / rock-brain), physbody springs. After each — baseline compare.
5. PoseSolver volume check vs drawn rock; compromise (pelvis back → less lean → hands higher) or reject; no direct position writes except physics.
6. Interactable + Affordances per instance; Interaction aggregate; ActionMatcher = Affordance × MotionRequirements. rock-brain split into these.
7. MotionFitter (stretch / tilt / feet on slope within limits) + missing motions from the affordance list.

## Rules

- One agent per file set; no two agents edit the same file.
- Every "better" claim needs the Judge on the frozen baseline AND frames looked at; the human Verdict is final.
- No git commit unless the user asks. Do not kill servers (8795 is ours; 8790, 8931 belong to other copies).

## BodySpec map (step 2 inventory — duplicated body measures → the BODYSPEC field that replaces them)

`modules/body-spec.js` → `window.BODYSPEC` / `ctx.bodySpec` (frozen once measured; `BODYSPEC.whenReady` promise; `debugDraw()` / `debugHide()`).
Measured from the drawn suit: skin weights split off the helmet (head bone) and the gloves (hand + finger bones); every other
vertex goes to the nearest segment SURFACE (pelvis, chest, upper / fore arm, thigh, shin, foot), radii re-estimated 4×.
Not replaced yet — steps 3–5 switch these readers to BODYSPEC.

| File:line | Now | BODYSPEC field |
|---|---|---|
| physics.js:182 | capsule `radius ?? 0.4`, `height ?? 1.8` | `capsule.radius`, `capsule.height` |
| open-world.html:3682–3685 | slim capsule `r: 0.26` ("shoulder half-width") | `capsule.slimRadius` (the torso's front-back half-depth + 2 cm; the shoulder half-width is `shoulderHalf`) |
| physics.js:342 | slim probe `radiusBase + 0.18` | `capsule.radius` + `arm.upperR` |
| open-world.html:3505–3510 | camera ray body `0.35`, `1.9` | `capsule.radius`, `height` |
| modules/physbody.js:28–29 | spine spring `r 0.15`, head `r 0.12` | `chest.r`, `helmet.r` |
| modules/physbody.js:31 | forearm spring `r 0.06` | `arm.foreR` |
| modules/physbody.js:156 | "shoulder 0.22 m from the centre line" | `shoulderHalf` − `arm.upperR` |
| modules/physbody.js:241–250 | ragdoll radii pelvis 0.12 · torso 0.15 · head 0.11 · upper 0.055 · fore 0.05 · thigh 0.075 · calf 0.06 | `pelvis.r` · `chest.r` · `helmet.r` · `arm.upperR` · `arm.foreR` · `leg.thighR` · `leg.shinR` |
| modules/rock-brain.js:180–195 | ACTS `body: [[h, clearance]]` (0.35/0.9/1.2 m, 0.02–0.3 m), no helmet / shoulder height | `pelvis.y0..y1`, `chest.y0..y1`, `helmet` (height = neck + `helmet.center`), clearances from `chest.halfD` / `pelvis.halfD` / `shoulderHalf` |
| modules/rock-brain.js:218–221 (standFree 0.5 / 1.25 m, `0.22`, `0.16` for lean_back) | stand spot free radius | `capsule.radius` at `pelvis` / `chest` heights |
| modules/rock-brain.js:28, 322–328 | `armFar 0.7`, shoulder fallback `±0.19, 1.43`, `reachTol 0.16` | `arm.reach` (+ `palm.*.wristToPalm`), `shoulderHalf`, `chest.y1` |
| modules/rock-brain.js:163 | scan ray heights 1.15 / 0.45 / 0.22 | `chest.y0`, `leg.hipHeight` / 2 |
| modules/interact.js:164–180 | standFree `0.36` ("0.4 m capsule"), pathFree sphere `0.22` | `capsule.radius` |
| assets/pack/animlib-runtime.js:111 (+ assets/incoming4/anim/animlib-runtime.js:110) | `SURF_OFF` hand 0.035 · shoulder 0.10 · back 0.16 | `palm.*.palmSkinOverBone` · `arm.upperR` · `chest.halfD` |
| tools/anim/build_pilot.py:40, 45–48; tools/anim/build_rock_clips.py:23 | same surface offsets; palm = 60 % wrist → middle_01 | `palm.*.center` / `wristToPalm` (measured on the glove) |
| modules/interaction.js:18, 391 | `pelvisMin/Max`, `snowFloat`; ankle height from the clip | `boot.*.ankleHeight`, `boot.*.soleBelowAnkle` |
| modules/interaction.js:619–620 | probe heights 1.0 / 0.38 | `chest.y0`, `leg.hipHeight` × 0.43 |
| tools/rockgallery/page.js:101 | body-inside check: 11 joint CENTRES | volumes: `helmet` sphere, `chest` / `pelvis` / limb capsules |
| tools/rockgallery/page.js:395, 415 | glove gap from ~40 sampled vertices, 3 cm | `palm.*.center` + `normal` |
| modules/rock-lab.js:70, 220–263 | body bands 0.4 / 0.8 / 1.2 / 1.4 m | `pelvis`, `chest`, `helmet` heights |
