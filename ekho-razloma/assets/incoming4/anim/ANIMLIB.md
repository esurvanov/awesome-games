# ANIMLIB — contact clips (pilot/hermit) + stag gaits

Staged here, **not wired into the game**. Pack format = `assets/pack/*.js` (base64 GLB, `window.__PACK[name]`).

| file | what | size |
|---|---|---|
| `anim_pilot_contact.js` | 77 clips, UAL skeleton (pilot + hermit, identical rest) | 3.86 MB (was 4.20 before the palm fix: the 18 clips were re-emitted and the pack compacted) |
| `anim_stag_gaits.js` | 20 clips, `animal_stag` rig (CDmir) | 0.7 MB |
| `*.meta.json` | contact / gait metadata (also embedded: `gltf.parser.json.extras.animlib`) | |
| `qc_pilot.json`, `qc_stag.json` | automatic checks on the shipped GLBs | |
| `animlib-runtime.js` | merge, intent→clip, hand/foot IK, stag gait blender | |
| `preview/*.jpg` | three r186 headless contact sheets + runtime IK test | |

Rebuild: `tools/anim/` (see bottom).

---

## 1 · Pilot clips (`anim_pilot_contact`)

Units = pilot native metres (1.90 m tall ≈ game scale). Character space: feet centre = origin, faces **+Z**, left = **+X**.
All clips in place; travel lives in `rootMotion`. Loops: first frame = last frame (seam 0.0°).
QC: foot slide / palm-to-surface error, cm.

| clip | s | source | contact | root motion | slide | palm err |
|---|---|---|---|---|---|---|
| hand_wall_r_in / _loop | 0.6 / 2.5 | authored, **palm-fixed** | hand_r | – | 0.8 / 0.5 | 1.9 (palm centre) |
| hand_wall_l_in / _loop | 0.6 / 2.5 | authored, **palm-fixed** | hand_l | – | 0.4 / 0.5 | 0.9 |
| hand_wall_both_in / _loop | 0.6 / 2.5 | authored, **palm-fixed** | both hands | – | 0.9 / 0.5 | 0.9 / 1.5 |
| lean_shoulder_r_in / _loop | 0.6 / 2.5 | authored (fold-arms base) | shoulder_r | – | 0.7 | – |
| lean_shoulder_l_in / _loop | 0.6 / 2.5 | authored | shoulder_l | – | 0.6 | – |
| lean_back_in / _loop | 0.6 / 2.5 | authored | back | – | 1.3 | – |
| lean_hands_ledge_loop | 2.5 | CMU 22_18 base, arms/torso **palm-fixed** | both hands, top 0.8-0.9 m | – | 0.4 | 1.1 / 1.8 |
| brace_slope_r/l_in / _loop | 0.6 / 2.5 | authored, hand **palm-fixed** | hand + lead foot | – | 0.4-1.4 | ≤2.9 |
| push_heavy_loop | 2.67 | UAL1 Push_Loop | both hands | cycle | 2.7 | 2.0 |
| reach_branch_r / _l | 1.67 | CMU 144_24 (+mirror) | hand sweep | – | 0.8 | – |
| crouch_inspect | 3.0 | CMU 77_08 | both hands, ground | – | 1.6 | – |
| kneel_in / _loop / _out | 1.7 / 1.4 / 1.0 | CMU 23_03 | – | – | ≤3.1 | – |
| pickup_small_r / _l | 2.3 | CMU 137_27 (+mirror) | hand, ground | – | 0.5 | – |
| step_over | 1.9 | CMU 141_09 | foot_r clearance | yes | 0.0 | – |
| vault_1m | 1.6 | authored | both hands, top | yes | 4.9 | 3.8 |
| slip_recover | 2.23 | CMU 90_17 → 105_59 | – | yes | 1.1 | – |
| catch_balance | 2.23 | CMU 104_13 → 105_59 | – | yes | 0.5 | – |
| wave_r | 2.27 | CMU 141_16 | – | – | 0.0 | – |
| point_r / _l | 2.2 | authored | – | – | 0.3 | – |
| look_around_loop | 5.0 | authored | – | – | 0.3 | – |
| tired_hands_knees_loop | 2.5 | authored | self (thighs) | – | 0.2 | 1.7 |
| tired_breath_loop | 2.5 | authored | – | – | 0.3 | – |
| cold_shiver_loop | 5.3 | CMU 79_68 + tremor | – | – | 0.0 | – |
| sit_rock_in / _loop / _out | 2.87 / 1.8 / 1.57 | CMU 13_04 (stepstool sit) | seat (pelvis), top 0.43 m | – | 0.7 / 0.2 / 2.5 | – |
| sit_rock_high_in / _loop / _out | 2.87 / 1.8 / 1.57 | CMU 13_04, pelvis +0.27, legs re-solved | seat, top 0.60 m | – | 0.7 / 0.2 / 2.5 | – |
| touch_walk_r / _l | 2.0 | authored **arm layer** (arm/hand tracks only) | hand on a side wall, 0.85–1.45 m | – | – | 0.3 (full-body build) |
| squeeze_side_r_in / _loop (+ _l) | 0.7 / 2.9 | CMU 111_26 walk sideways + authored arms | lead palm front wall, trail palm back wall (gap 0.6–1 m) | loop: locomotion 0.28 m/s sideways | 2.1 / 4.0 | 0.2–2.0 |
| foot_on_ledge_l/_r _in / _loop / _out | 1.67 / 2.5 / 0.8 | CMU 111_31 step-up (0.27 m step → 0.45 m ledge) + authored hold | lead sole on a top 0.3–0.8 m, hand on the knee | in: yes | 5.1 / 0.0 / 0.9 | – |
| knee_on_rock_l/_r _in / _loop | 1.0 / 2.5 | authored (no CMU take has a knee on a surface); _r = mirror | knee + shin on a 0.4–0.7 m top, same-side palm beside it | – | 2.9 / 0.0 | 2.2–4.6 |
| lean_dome_l/_r _in / _loop | 0.6 / 2.5 | authored, **palm-fixed** | palm on a rounded top ~1.0-1.4 m (normal 37° toward the pilot) | – | 0.6-0.7 | 0.7-2.2 |
| lean_low_in / _loop | 0.6 / 2.5 | authored | buttocks against a 0.65–0.95 m edge behind, palms on its top | – | 2.5 / 0.7 | 3.0 |
| sit_uneven_l / _r | 1.8 | sit_rock_loop + pelvis roll 9°, spine upright | seat with one thigh ~0.07 m higher | – | 0.4 | – |
| duck_under / duck_under_half | 2.0 / 1.33 | UAL Crouch_Fwd_Loop / Walk_Loop lowered 0.17 m + spine 24°; right palm on the underside | overhang, helmet top ≤ 1.30 / 1.71 m | loop locomotion | 5.4 / 0.0 | 0.9–1.1 |
| jump_down_low / jump_down / jump_down_high | 1.2 / 2.43 / 2.5 | CMU 82_02 (0.66 m) / 82_04 (0.86 m) jump off ledge, flight time-warped | feet on the top edge; landing 0.6 / 1.0 / 1.5 m below the origin | yes | 0.0 / 8.6 / 7.6 | – |
| hand_wall_r/_l/_both_in_walk (**palm-fixed**), lean_shoulder_r/_l_in_walk | 0.33 | UAL Walk_Loop crossfaded into the `_loop` first pose | same contacts as the `_loop` (window 0.23–0.33 s) | – | 0.0 | 0.5–1.9 (palm) |

Rock clips (`tools/anim/build_rock_clips.py`) are **appended** to the shipped GLB: the 37 clips above stay byte-for-byte
(buffer prefix, accessors, animations, nodes and meta all checked identical after the merge). New surface type `seat_top`
(bone `pelvis`, effector `seat`): the character stands with its back to the rock, `approach.facing = [0,0,-1]`,
`approach.distance` = feet origin → seat front edge. `touch_walk_*` carries `layer.bones`: three.js averages overlapping
tracks by weight, so play it with a high weight over walk/jog (or pose + LimbIK). QC's contactPlaneErr for these two
(5–8 cm) is an artefact of the masked load (the spine sits at bind pose there); the full-body build measures 0.3 cm.

Wave 2 (`tools/anim/build_rock_clips2.py`, ARCH-INTERACT.md step 7) appends 28 more clips the same way (49 shipped clips checked
identical) and writes a **`req` block (MotionRequirements) on every clip**, in the World vocabulary: `cls` (affordance class:
hands_wall, lean_shoulder, lean_back, hands_ledge, sit, step_up, climb, squeeze, touch_walk, knee_on, foot_on, duck, jump_down,
lean_dome, lean_low, brace_slope, push, touch, ground, other), `h` (support height range over the stand ground), `tilt` (face
tilt, rad, 0 = vertical), `feetDelta` (ground height difference under the feet), `stretch.contact` / `stretch.spine` (how far the
MotionFitter may move the contact / tilt the spine), `phase` (enter / hold / exit / once) and `from: walk` for the walk entries;
extras per class (`flat`, `facesAway`, `uneven`, `round`, `gap`, `clearance`, `drop`, `layer`, `speed`, `width`, `depth`).
Drop clips: origin = the top surface at the take-off edge, the body ends `drop.height` below it (QC's groundPen for them is
that drop, not an error). Size: new clips carry translation tracks only where they move (pelvis) and share identical constant
accessors (`write_clips(dedup=True)`) — the pack grew 3.25 → 4.20 MB. Sheets: `preview/rock2/`.
Known limits of wave 2: knee_on_rock / lean_dome / lean_low / sit_uneven are hand-keyed (readable, less organic than mocap);
jump_down(_high) is the 0.86 m take with a stronger hop, flight stretched for 1.0 / 1.5 m (slightly floaty at 1.5); duck_under's
palm follows the body (slides along the underside, not planted); walk entries do not pin the stance foot to the ground while the
body decelerates (the runtime brakes the capsule).

#### Palm fix (`tools/anim/build_palm_fix.py`) — 18 clips: hand_wall_r/l/both (_in, _loop, _in_walk), lean_hands_ledge_loop, brace_slope_r/l (_in, _loop), lean_dome_r/l (_in, _loop)

Why the old clips put 6–8 cm of glove into the surface: the drawn glove of this model is **one rigid piece skinned to the forearm** (`lowerarm_*`;
the hand bone has no vertices, only the thumb bones move a few thumb vertices), so a wrist cannot bend - "wrist extension" = the angle of the whole forearm.
The old keys oriented the *hand bone* and put the bone-derived palm point on the wall, so the fingertips met the wall and the palm faced sideways. The rigid
thumb tip additionally sticks 6–7 cm out of the palm plane towards the palm normal.
New clips (measured on the CPU-skinned mesh, `skin.py`; looked at with `miniview.py` + three.js close-ups in `preview/palm/close/`):
per contact window the forearm is oriented so the drawn palm faces the surface (fingers up on a wall / slope, forward on a ledge, spun <= 45° when the arm needs it), the palm
centre lies 0.5–2.0 cm off it, the elbow is solved on the upper-arm sphere for a natural arm (elbow flexion 30–140°, elbow down / out, forearm twist in range, away from
torso and helmet), the thumb bones are tucked toward the palm plane, and the mitten is rolled / pitched by a fixed **19°** (`meta.palm.<side>.tiltDeg`, hands mirror each other) so the
rigid thumb clears the surface. Body: 0–8° lean, ledge = 8° hip fold, two-hand clips square the shoulders (18° turn), the palm points are mirrored.
The finger spin is re-tuned per frame so the palm stays planted while the body breathes (palm drift <= 1.1 cm in the loops).
Surface moves (the arm-along-the-surface pose needs the shoulders within ~0.36 m of the surface): walls 0–0.04 m closer, ledge top 0.62 -> 0.77 m, slope point +0.06/+0.14 m, dome +0.06 m -
`surface.point`, `approach`, `heightRange` and `req.h` moved with them (`hands_wall` h 1.0–1.6 -> 1.2–1.72: a flat forearm needs a face at chest-head height; hands_ledge 0.55–1.05 -> 0.64–0.92).
Meta: `surface.point` = the drawn palm CENTRE on the surface; `contact.palm` = {inHand, normalHand, wrist (character space), gapCm, tiltDeg, gloveInsideCm, armInsideCm, thumbTipInsideCm};
`meta.palm.<l|r>` = palm centre / normals of the drawn glove in the lowerarm frame (`inForearm`, `normalForearm` = the tilted palm normal the clips lay on the surface,
`flatNormalForearm`, `fingersForearm`) for the runtime IK: wrist = point - R_hand * inHand.
Checked on the skinned glove + arm (max penetration of any vertex, all frames of the hold): glove / cuff / sleeve <= 0.4 cm inside; the 24 rigid thumb-tip vertices may sit up to
2.5 cm inside (0–2.5 cm measured, hidden in the rock) - before: 4.7–8.7 cm of glove inside. Palm-normal deviation from -N: 19° (before: ~90°, fingertips on the wall).
Known: the right glove has ~22 vertices weighted 2–27 % to `thigh_r` (model skin bug; global vertex ids 88, 89, 717-719, 13489, 13748, 13772-13791, worst 13783 = 27 %; the left glove has none) - when the arm is raised they stretch to a black
ribbon down to the thigh (visible in the sheets; in the old clips it was a needle). `_in` clips blend the new arm over 0.36 s (peak joint speed 450–800 dps; old 340–590).

### Pipeline
```
CMU FBX (gbionics/cmu-fbx) ─Blender dump─▶ per-frame world matrices
   ─▶ direction-matched retarget onto UAL ─▶ despike ─▶ foot pin (ball joint, 2-bone IK)
   ─▶ root motion out ─▶ loop fold ─▶ hand pin on contacts ─▶ key reduction ─▶ GLB
authored:  UAL Idle / FoldArms base ─▶ key layers (pelvis, spine, neck, hand/foot IK targets + palm normal) ─▶ same export
```
Checks per clip: ground penetration, foot slide, backward knees, joint-speed spikes, loop seam, palm-to-plane.

---

## 2 · Contact metadata

`meta.clips[name]`:

| field | meaning |
|---|---|
| `duration`, `loop`, `fps` | |
| `contacts[]` | see below |
| `rootMotion` | `null` or `{fps, samples:[[x,z,yaw]…], total}` — character space at clip start |
| `footContacts` | foot plant frame ranges (mocap travel clips) |
| `gesture` | `{effector, peak/hold}` for wave/point |
| `obstacle` | vault: `{frontZ, top, depth}` |
| `locomotion` | push: `{speed, cycle, rootMotionCycle}` |

`contacts[i]`:

| field | meaning |
|---|---|
| `effector` / `bone` | `hand_l/r`, `foot_l/r`, `shoulder_l/r` (bone `upperarm_*`), `back` (bone `spine_03`) |
| `window` [t0,t1] s | contact held; `blendIn` / `blendOut` s around it |
| `hold` | true = pinned; false = pass-through (grab, sweep, clearance) |
| `surface.point` | contact point on the **surface** (palm/shoulder/back thickness already removed) |
| `surface.normal` | surface normal, pointing toward the character |
| `surface.type` | `wall`, `ledge_top`, `slope`, `ground`, `object_face`, `obstacle_top`, `branch`, `own_thigh` |
| `heightRange` [min,max] | surface heights the clip + IK can cover |
| `approach` | `{distance:[min, ideal, max], facing, lateral?}` — origin-to-surface distance along −normal |
| `space` | `character` (moves with root) or `start` (fixed at clip start: vault, step_over) |

Offsets used: palm 0.035 m, shoulder 0.10 m, back 0.16 m.

---

## 3 · Integration (pilot / hermit)

```js
// 1. load next to the pilot (same loader as the game)
loadPacked('anim_pilot_contact', ASSET, (lib) => {
  ANIMLIB.mergeClips(pilotGltf.animations, lib);          // clips bind by bone name
  const meta = ANIMLIB.meta(lib);
  AV.player = makeAnimator(root, pilotGltf.animations, { ...old, handWall: 'hand_wall_r_loop', lean: 'lean_back_loop', vault: 'vault_1m' });
  const contact = new ANIMLIB.ContactLayer(root, meta);    // one per character
});
// 2. every frame, AFTER mixer.update(dt):
contact.update(currentAction, (c) => raycastSurface(c));   // returns {point, normal} (world) or null
```

Intent layer (TypeSafe Jev picks the intent, the body decides how):

```
Jev intent ─▶ ANIMLIB.chooseContact(intent, sense, meta) ─▶ {clip, enter, face, standOff}
   sense = probe rays: front/left/right/back {dist, height, normal}, obstacle {dist,height}, slope, onIce
   ─▶ steer to standOff along −normal ─▶ play enter (_in) ─▶ loop ─▶ ContactLayer pins hands to the real hit
   ─▶ exit: play _in reversed (timeScale −1) or crossfade to idle 0.3 s
```

| intent | clip choice |
|---|---|
| `rest_on_rock` | wall behind → lean_back; wall at side → lean_shoulder_r/l; surface 0.5–0.95 m → lean_hands_ledge; tall face → hand_wall_both |
| `touch_surface` | hand_wall_r/l/both |
| `cross_obstacle` | ≤0.5 m → step_over; ≤1.25 m → vault_1m (scale vertical by top/1.0); higher → existing ClimbUp_1m |
| `climb_slope` | brace_slope_r/l |
| `inspect_ground` / `pick_up` | crouch_inspect / kneel · pickup_small_r/l |
| `clear_branch` | reach_branch_r/l (attach branch tip to the hand for `window`) |
| idle moods | tired_*, cold_shiver_loop, look_around_loop |
| reactions | ice + hard stop/turn → slip_recover; trip → catch_balance |

Rules for the "bumps from a distance" complaint:
- Start a contact clip only when `approach.distance[0] ≤ d ≤ approach.distance[2]`; otherwise steer first.
- Hand IK target = raycast hit + normal × 0.035 m; the layer blends with `blendIn/blendOut`.
- Surfaces out of reach are skipped (no hand floating in air): test in preview/runtime_ik_test.jpg — wall at 0.60 m is unreachable, 0.40 m and a 0.85 m ledge are hit exactly (palm on the surface).

---

## 4 · Stag gaits (`anim_stag_gaits`)

Kept the game's CDmir stag (textured, matches the scene). Quaternius CC0 Stag (poly.pizza) was checked: flat low-poly style, only Walk + Gallop — not used.

Existing `Run` clip: hooves move back at only 0.5–2.8 m/s while the herd flees at 11 m/s → visible sliding/jerk. Replace with `gallop_loop`.

| clip | s | speed m/s | stride m | turn °/s | hoof slide cm |
|---|---|---|---|---|---|
| walk_loop | 1.067 | 1.3 | 1.39 | 0 | 0.5 |
| walk_turn_l / _r | 1.067 | 1.3 | 1.39 | ±50 | ≤1.0 |
| trot_loop | 0.633 | 3.0 | 1.90 | 0 | 0.5 |
| trot_turn_l / _r | 0.633 | 3.0 | 1.90 | ±60 | 0.5 |
| canter_loop | 0.533 | 6.0 | 3.20 | 0 | 2.0 |
| canter_turn_l / _r | 0.533 | 6.0 | 3.20 | ±45 | ≤2.4 |
| gallop_loop | 0.433 | 11.0 | 4.77 | 0 | 2.1 |
| gallop_turn_l / _r | 0.433 | 11.0 | 4.77 | ±35 | ≤2.5 |
| walk_start / walk_stop | 1.6 / 2.2 | 0→1.3 / 1.3→0 | | | 0.8 / 3.5 |
| gallop_start | 1.8 | 0→11 | | | 2.1 |
| trot_stop | 2.0 | 3→0 | | | 6.2 |
| alert_loop | 3.0 | idle | | | 0 |
| look_l / look_r | 2.4 | idle | | | 0 |
| stamp | 1.6 | idle | | | 0 |

Gait table (`meta.gaitTable`):

| gait | cycle s | duty | footfall phase (LH/LF/RH/RF) |
|---|---|---|---|
| walk | 1.067 | 0.64 | 0 / .25 / .5 / .75 (lateral sequence) |
| trot | 0.633 | 0.42 | 0 / .5 / .5 / 0 (diagonal pairs) |
| canter | 0.533 | 0.29 | .22 / .42 / 0 / .22 |
| gallop | 0.433 | 0.21 | .09 / .52 / 0 / .42 (transverse) |

How it's made: body path (speed, yaw rate) → footfall schedule → stance hooves fixed in world, swing arcs to predicted touchdown under hip/shoulder → 2-bone IK to the fetlock + phase-driven pastern pitch (roll over the toe, fold in swing) → shoulder/pelvis slide when out of reach (scapula substitute, ≤11 cm) → body bob/pitch/spine flex/head nod by phase, bank + spine bend in turns.

Per-clip meta: `speed`, `strideLength`, `cycle`, `duty`, `phaseOffsets`, `footfalls` (touchdown/lift-off times per hoof), `yawRate_degps`, `turnRadius_m`, `rootMotion`.

### Phase-based blending (simplified MANN-style)

```
phase φ ∈ [0,1), shared by every gait clip (time = φ·duration, timeScale 0)
dφ/dt = Σ wᵢ · (v / speedᵢ) / cycleᵢ          → hooves move at ground speed = no sliding
weights(v): idle ─0.15…0.65─▶ walk ─2.2…2.8─▶ trot ─4.7…5.6─▶ canter ─8.8…10.4─▶ gallop
turn: straight ↔ turn_l / turn_r by |yawRate| / 0.9 rad/s
```

```js
loadPacked('anim_stag_gaits', ASSET, (lib) => {
  const clips = {}; for (const c of [...stagGltf.animations, ...lib.animations]) clips[c.name] = c;
  s.gait = new ANIMLIB.GaitBlender(mixer, clips, ANIMLIB.meta(lib), { idle: 'Idle' });
});
// per frame: s.gait.update(dt, currentSpeed, yawRate)      (replaces s.A.update for moving stags)
// flee: gallop_start once, then the blender; stop: trot_stop / walk_stop; noticed: alert_loop, stamp
```
Keep the stag's acceleration ≤ ~7 m/s² so gait changes get their strides (same rule as the fox).

---

## 5 · Sources & licenses

| source | license | used for |
|---|---|---|
| CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), FBX via huggingface.co/datasets/gbionics/cmu-fbx (cgspeed BVH) | free for all uses incl. commercial (raw data may not be resold); credit requested | wave, pickup, crouch_inspect, kneel, step_over, cold, ledge lean, balance, slip, reach |
| Quaternius Universal Animation Library (UAL1 Standard) | CC0 1.0 | push_heavy_loop, Idle / FoldArms bases |
| CDmir stag (existing `animal_stag`) | CC0 | stag rig |
| authored here (tools/anim) | project | walls, leans, brace, vault, point, tired, look, all stag gaits |

Credit line: "Motion capture data from mocap.cs.cmu.edu, created with funding from NSF EIA-0196217."

### Fall / get-up pack (`assets/pack/anim_pilot_fall.js`, PHYSBODY.md)

| clip in the pack | source clip | source | license | used for |
|---|---|---|---|---|
| `pb_knock` (0.83 s) | Hit_Knockback | Quaternius UAL1 Standard (already inside `pilot_aces_textured`) | CC0 1.0 | fall without WebAssembly: knocked onto the back |
| `pb_getup` (1.53 s) | LayToIdle | same | CC0 1.0 | get up after the ragdoll / after `pb_knock` (starts on the back) |
| `pb_fall` (2.4 s) | Death01 | same | CC0 1.0 | spare collapse clip (not used by default) |

The library had no fall / get-up clips; the pilot's own UAL1 set did (unmapped). They are cut out by
`node tools/anim/extract_clips.mjs assets/pack/pilot_aces_textured.js assets/pack/anim_pilot_fall.js anim_pilot_fall assets/incoming4/anim/anim_pilot_fall.meta.json Death01=pb_fall Hit_Knockback=pb_knock LayToIdle=pb_getup`
(nodes + those three animations only, 0.33 MB instead of re-parsing the 5.6 MB model). No new motion source.

UAL2 was not downloaded (itch download needed a scripted login flow that was not allowed in this session).

---

## 6 · Known limits

- vault_1m is hand-keyed: readable, less organic than mocap; shins graze the top edge at 0.53 s; keys assume a 1.0 m top.
- brace_slope palm is ~2 cm short of the authored point during breathing; runtime IK closes it.
- kneel is a deep squat-kneel (source), not a one-knee kneel.
- trot_stop has 6 cm hoof slide on the last settle step.
- mirrored clips (`_l` of pickup / reach / point) are exact mirrors — same person, opposite hand.
- Stag gaits are procedural (no quadruped mocap with a free license and a deer rig was found); footfalls follow published deer gait patterns.

---

## 7 · Rebuild

```
B=<Blender 4.2>/Contents/MacOS/Blender ; PY=<Blender>/Contents/Resources/4.2/python/bin/python3.11 ; W=<workdir>
$B -b --factory-startup --python tools/anim/fbx_dump.py -- $W/npz $W/cmu/*.fbx      # CMU FBX → npz
$PY tools/anim/build_pilot.py $W   && $PY tools/anim/qc_pilot.py $W                   # pilot clips + QC
$PY tools/anim/deer_gait.py  $W   && $PY tools/anim/qc_stag.py  $W                   # stag gaits + QC
python3 tools/anim/pack.py $W/out/anim_pilot_contact.glb $W/out/anim_pilot_contact.meta.json assets/incoming4/anim/anim_pilot_contact.js anim_pilot_contact
node tools/anim/sheet.mjs <http root> <model pack> <anim glb> <outdir> all 8 55 1.9 <meta>   # contact sheets (three r186)
node tools/anim/runtime_test.mjs <http root> <outdir>                                   # runtime IK + gait blender test
$PY tools/anim/build_rock_clips.py $W   # rock clips appended onto $W/anim_pilot_contact.glb (+ .meta.json, unpacked from the shipped pack); needs npz/13_04, npz/111_26
$PY tools/anim/build_rock_clips2.py $W  # wave 2 + `req` on every clip, appended onto the wave-1 pack; needs npz/111_31, npz/82_02, npz/82_04
$PY tools/anim/build_palm_fix.py $W     # palm fix: re-poses 18 hand-contact clips -> $W/out_palm/ (env PALM_ONLY=hand_wall,... / PALM_FAST=1 / PALM_TILT / PALM_TIPK / PALM_TIPIN); then pack.py on out_palm/*
python3 tools/anim/verify_identical.py <old pack> <new pack>   # byte check: every other clip identical
```
`$W` needs: `pilot_aces_textured.glb`, `npc_hermit.glb`, `animal_stag.glb` (unpacked from assets/pack), `src/UAL1_Standard_RM.glb`, `npz/`.
