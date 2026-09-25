# 🦶 INTERACTION — bodies meet the world

`modules/interaction.js` (wave 2). No edits to `open-world.html`, `physics.js`, `worldfill.js`.
Every subsystem runs in its own guard: an exception switches off **that subsystem only** (`INTERACTION.SUB`, reason in `INTERACTION.ERR`).

| Area | Before | Now |
|---|---|---|
| 🦶 Feet on a 25° slope | float / sink up to **15 cm** | **≤ 0.6 cm** (two-bone IK, pelvis offset, sole tilted to the ground) |
| 🏃 Foot sliding | playback rate guessed (`hs/5`, `hs/8`) | rate = real speed ÷ clip stride, stride **measured from the clips** |
| 🔊 Footsteps | one generic noise | snow · ice · rock · metal · wood, fired on the **real foot plant** |
| 🧊 Lake ice | static texture | cracks grow from every step, creaks when you stand still |
| ❄️ Sea ice | same grip as snow | acceleration ×0.3, braking ×0.14 |
| 🦌 Stags | snap-turn, body flat on slopes | turn ≤ 2.4 rad/s, speed ramps up, body follows the slope, hooves on the ground |
| 🦊 Fox | flat, walk clip at 6–18 m/s | slope align, trot clip past 2.2 m/s, **pounce** into the snow at a find |
| 🎥 Camera | — | step bob, landing dip, both checked by a sphere-cast |

---

## 🧍 Pilot

```
mixer pose ─► restore bones the mixer skipped ─► ground ray per foot (PH.P.raycast, STATIC)
          ─► pelvis offset = lowest foot's need ─► spine lean ─► leg IK (knee plane kept) ─► sole tilt
          ─► head look-at ─► hands (ledge / prop) ─► foot-plant events (sound, puffs, ice)
```

| Piece | How |
|---|---|
| Foot target | ground under the ankle + clip ankle height ÷ `n.y` + `snowDepthAt × snowFloat` (boot rests 30 % up the loose snow) |
| Pelvis | `min(foot needs)` clamped −0.5…+0.12 m, damped; moves the model wrapper, not the capsule |
| Sole | foot world rotation × tilt(up → ground normal), only while planted (heel or toe down), ≤ 34° |
| Stride | clips sampled on a skeleton clone: walk **0.98**, jog **5.9**, run **8.5** m/s → rate = speed ÷ stride, 0.55–1.9 |
| Lean | roll into turns (yaw-rate × speed), pitch with speed, acceleration, uphill, pushing |
| Look | Orm (≤ 9 m, or talking) › nearest interactable ≤ 6 m › fox ≤ 5 m; neck 40 % / head 60 %, yaw ±63°, pitch −29…+26° |
| Ledge climb | edge found by a ray at climb start; hands IK onto it, 0–78 % of the clip |
| Push | ray from the chest hits a `pushable` → hands on it, extra shove (1.6 × mass N·s/s), scrape sound, snow spray |
| Slide | model turns down the slope, spray, hiss loop |
| Airborne / riding / dead / climbing | leg IK fades out (18/s) |

Never stacks on itself: IK runs only on frames where the mixer moved (`mixer.time` changed); bones the clip does not animate are restored first.

## 🌍 World

| Event | Response |
|---|---|
| 🦶 foot plant | surface = Passport name of the hit (kestrel, ship, station → metal · pier, crate → wood · boulder, ruins → rock) › lake / sea → ice › `ctx.surfaceAt` › slope → rock › snow |
| 🪂 landing > 3 m/s | ring of puffs, thud + surface step, camera dip, `ctx.snowStamp` blob, cracks on the lake |
| 🌲 brushing branches (≤ 1–2.4 m from a trunk, > 1.4 m/s) | `ctx.shakeTree(x, z, s)`; fallback: snow curtain from the branches |
| 🌾 grass | bending is the vegetation module's (it reads player / fox / stag positions itself) |
| 🔊 audio | own `AudioContext` (the game's `Sound` is closed), starts on the first key/pointer, obeys `Sound.muted`. `Sound.step` is wrapped: silent while our steps play, skimmer impacts pass through |

## 🧊 Ice

| | |
|---|---|
| Cracks | thin quads on the lake (ring buffer 6000 segments, one draw), 3–7 branches per plant, grow 3–7 m/s, fork twice |
| Sound | clicks + falling "ice song" tone; a low boom on big impacts |
| Standing still on the lake | a new crack + creak every 1.4 s |
| Traction | `PH.ch.params.groundAccel/Decel` × 0.3 / 0.14 on sea ice, half that effect on the lake, eased in/out |

## 🦌 Animals

| | Stags | Fox |
|---|---|---|
| Ground | lowest hoof sole on its ground (skinned pose, per frame, ≤ 160 m) | `snowDepthAt` float |
| Slope | pitch/roll from 4 ground samples × 0.85, bank in turns | pitch/roll × 0.8 |
| Motion | flee direction turns ≤ 2.4 rad/s; speed ramps 0 → 9.5 m/s in 0.9 s; run rate = speed ÷ 1.67 m/s stride | trot clip past 2.2 m/s, rate = speed ÷ stride |
| Trails | terrain module tracks them; without it: decal hoof prints near the player | pounce → `snowStamp` blob |
| Extra | skinned bounds refreshed every 0.4 s | **seek → find**: crouch, 0.75 m arc, nose-first dive, 0.7 s buried, out |

🦌 "0.85 m above ground": the rendered stag was already on the ground; the **bounding box** was stale (skinned bounds computed once before the bones had world matrices, so tools read the bind mesh lifted by the 0.87 m armature offset). Bounds now refresh from the live pose; body now also follows slopes and the lowest hoof is snapped to the ground.

## 🎥 Camera

| | |
|---|---|
| Step bob | spring kicked by each real foot plant, ≤ 5 cm, scales with speed |
| Landing dip | spring kicked by landing speed, ≤ 40 cm |
| Solid rule | offsets shrink with a short boom and are cut by a sphere-cast (STATIC) and the ground + 0.5 m floor; skipped with `DBG.camOv`, pause and menus |

---

## 🔌 ctx APIs

| Used | From | Fallback |
|---|---|---|
| `PH.P.raycast`, `sphereCast`, `applyImpulseAt`, `PH.ch.params` | physics | `groundH` + finite-difference normal |
| `snowDepthAt(x, z)` | terrain | 0 |
| `surfaceAt(x, z, y)` | terrain | own classifier |
| `snowStamp({x, z, dx, dz, len, wid, type, str})` | terrain | none / decal prints for stags |
| `shakeTree(x, z, strength)` | vegetation | particle snow curtain |
| `VEG.trees` | vegetation | `FOREST.list` |
| `Passport.byRole.pushable`, `INTER`, `orm`, `fox`, `STAGS`, `CLIMB`, `Sound`, `emit`, `lin` | game | — |

| Added | |
|---|---|
| `ctx.interaction` = `window.INTERACTION` | knobs `K`, `SUB`, `STATS`, `off()` / `on()`, `testIK()`, `testWalk()`, `surfaceAt(x, z)` |
| `ctx.surfaceAtPlayer()` | surface of the last foot plant |

## 🎛 Knobs (`INTERACTION.K`)

| Knob | Default | |
|---|---|---|
| `ik` / `ikRay` | true / 1.7 m | leg IK, ray length |
| `pelvisMin` / `pelvisMax` | −0.5 / 0.12 m | body drop / lift |
| `tiltMax` | 0.6 rad | sole tilt limit |
| `stride`, `strideMin/Max` | true, 0.55–1.9 | stride-matched playback |
| `lean`, `look`, `lookRange` | 1, true, 6 m | |
| `snowFloat` | 0.3 | how far up the loose snow a boot / paw / hoof rests |
| `bob`, `dip` | 0.018, 1 | camera |
| `iceAccel`, `iceDecel` | 0.3, 0.14 | sea-ice traction |
| `stagTurn`, `stagTop`, `stagAlign`, `foxAlign` | 2.4 rad/s, 9.5 m/s, 0.85, 0.8 | |
| `trees`, `stepVol` | true, 1 | |

No `QUALITY` knobs: cost is ≈ 0.1–0.5 ms per frame on every preset.

---

## 📏 Measurements (M1 Pro, 1400×800, *high*)

**IK test** — `node tools/stand.mjs <label> --eval "INTERACTION.testIK(25)"`: finds a planar 25° terrain patch, stands across / uphill / downhill, 0.6 s each; error = ankle and ball distance to the ground plane minus the same on flat ground (snow float off).

| | across | uphill | downhill | worst |
|---|---|---|---|---|
| IK off | 12 cm | 15 cm | 15 cm | **15 cm** |
| IK on | 0 cm | 0.2 cm | 0.6 cm | **0.6 cm ✅ (< 5 cm)** |
| pelvis offset | −12.5 cm | −16 cm | −9.7 cm | |

Walking across the same slope (`INTERACTION.testWalk(25)`): planted-frame ankle error ≤ 1.1 cm.

**Bench** — `stand/inter-before` → `stand/inter-after` (other agents' modules landed in between):

| | before | after |
|---|---|---|
| fps, 8 views, vsync | 59.9 all | **59.9 all** (first after-run, 3 other headless Chromes) |
| collisions | 6/8 (kestrel_e, jump_boulder failed) | **8/8** (`inter-after`) · 7/8 in `inter-final` (jump_boulder, flaky before too) |
| JS errors · loader | 0 · 12/12 | 0 · 12/12 |
| module cost | — | 0.1–0.5 ms/frame avg, one 5 ms frame at start (clip stride sampling) |

⚠️ Later runs (`inter-after`, `inter-final`) ran next to 4 other agents' headless Chromes: every view locks to 30 fps (vsync halving), so they say nothing about this module. A/B in the same session (`--eval "INTERACTION.off()"`, `--unlimited`) was dominated by the same noise (±30 fps between identical views). What is measured directly:

| Cost | Value |
|---|---|
| JS per frame (`INTERACTION.STATS.ms`) | **0.1–0.5 ms** |
| extra draw calls | 0 · +1 after the first lake crack |
| one-time | ~5 ms on the first frame after the pilot loads (clip stride sampling) |

🔁 Re-measure on an idle machine: `node tools/stand.mjs inter-check --eval "INTERACTION.testIK(25)"`.

## 🖼 Screenshots — `stand/inter-shots/`

| File | Shows |
|---|---|
| `slope_ik_off.png` / `slope_ik_on.png` | 25° slope: floating downhill boot → both boots on the snow, uphill knee bent |
| `lake_cracks2.png` | cracks spreading around the pilot on the lake |
| `kestrel_wing.png` | standing on the wreck, feet on the metal |
| `fox_pounce_strip.png` | crouch · leap · nose-first dive · buried · out |
| `stag_flee.png` | stag galloping, body on the slope |
| `climb_hands.png` | hands on the crate edge mid-climb |

## ⚠️ Known limits

- Fox and stags still slide a little at top speed: their clips stride 1.4–1.7 m/s, the game moves them at 6–18 m/s; rates are capped (2.6 / 2.0) so legs don't blur.
- The terrain module draws loose snow **above** the physics ground; where it piles high (crash site), a 0.55 m fox can look half-buried. Boots/paws/hooves float by `snowFloat × depth` only.
- Arm IK keeps the clip's elbow plane; on very low ledges (0.8 m) the hands reach down to the edge with straight arms.
- Lake cracks persist for the session (ring buffer wraps after 6000 segments).
