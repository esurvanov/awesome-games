# 🔍 QA — verification system

Earlier checks passed on numbers (fps, collisions, errors, 8 distant views) while the player saw sunk feet, black frames, stags running backwards, black triangles and v1 boxes. This system looks **through the player's camera** and **checks motion**. It does not fix visuals — it lists them.

## ▶️ One command

```
node tools/qa.mjs                    # stand + inventory + eye views + feet + placed objects + motion  (~10 min)
node tools/qa.mjs --autoplay         # + both story endings and save compatibility                     (~+5 min)
```
→ `stand/qa-<date>/index.html` (PASS/FAIL table, eye-view grid with back-face overlay, motion contact sheets) · `qa.json` · `inventory.html`.
Options: `--label x` · `--no-stand` · `--no-eye` · `--no-motion` · `--views a,b` · `--motions a,b` · `--headful`.

| Tool | Does |
|---|---|
| `tools/qa.mjs` | runs everything under one lock, writes the report |
| `tools/stand.mjs` | 8 distant views, fps **repeat × 3 + median**, `--quiet-check`, collision tests (existing, upgraded) |
| `tools/eye.mjs <label>` | player-eye views, feet, placed objects, motion takes (`--views`, `--motions`, `--no-feet`, `--no-placed`) |
| `tools/inventory.mjs` | every drawable → `stand/inventory.{json,html}` |
| `tools/autoplay.mjs` | both endings through the real story code, save compatibility, Jev oracle |
| `tools/qa/qa-page.js` | in-page library `window.QA` (all measurements) |
| `tools/qa/qa-views.js` | views, feet spots, motion takes `window.QAV` |
| `tools/qa/qa-story.js` | story helpers `window.QAS` |
| `tools/qa/hygiene.mjs` | lock, machine load, spread stats |
| `tools/qa/probe.mjs "<js>"` | open the game, evaluate expressions (debugging a check) |

> 🎯 **Appearance is NOT accepted by these numbers.** Visual acceptance = `LOOKGATE.md` (`node tools/look-gate.mjs run|check|accept`); a visual reject is never overridden by a QA PASS.

## 🔒 Measurement hygiene

| | |
|---|---|
| Lock | `tools/.stand.lock` `{pid, label, started}` · FIFO queue `tools/.stand-queue/` · dead pid = stale, taken over · child runs inherit (`STAND_LOCK_PARENT`) |
| Busy machine | other automation Chrome with CPU ≥ 8 % of a core · other processes > 50 % of all cores · load > cores (idle automation browsers are only noted) |
| `--quiet-check` | waits ≤ 3 min for quiet, else `fpsVerdict: refused: machine busy (…)` — numbers kept, no fps PASS/FAIL |
| fps | `--repeat 3` × 900 ms, median, `fpsSamples`, `fpsSpreadPct`; spread > 15 % → `noisy`, verdict `unreliable` |

## ✅ Invariants (each PASS/FAIL with numbers, `qa.json → verdicts`)

| # | Check | How | FAIL when |
|---|---|---|---|
| a | 🧭 facing ↔ motion | visual forward from the **drawn skeleton** (biped: up × (right hip − left hip); quadruped: head − hip; shardling: eye; snowmobile: headlights − tail light) vs velocity of the actor | > 5 % of samples with speed > 0.5 m/s have dot < 0.7, or ≥ 0.25 s in a row |
| b | 🦶 foot sliding | stance spans per foot (sole ≤ 5 cm over its local minimum relative to the root, vertical speed < 0.6 m/s); drift = world motion of the planted sole; ratio = body travel ÷ sole sweep in body space | median drift > 8 cm/step, or ratio outside 0.75–1.33 (steady-speed steps) |
| b′ | 🧍 pose continuity | pelvis motion relative to the actor root per frame; root jumps | pelvis > 6 m/s (player) / 10 m/s (animals, boss), root > 30 m/s |
| c | 👣 feet on surface | GPU height map of the **visible** surface (top-down ortho render of the real scene, actors/clutter/foliage hidden) vs the lowest sole vertices | grounded foot beyond ± 5 cm |
| c′ | 🪨 placed objects | every Passport object: lowest vertex per 3×3 footprint cell vs visible ground (+ physics ray to a supporting object); buried share per column | whole object > 10 cm above support · > 30 % of its height buried |
| d | 🔲 back faces | real materials twice: as drawn → depth D1; opaque meshes forced to BackSide → D3. D3 < D1 = hole (open mesh seen from behind), D3 ≈ D1 on double-sided = back side drawn; 3×3 erosion removes silhouettes; ID pass names the mesh | holes > 0.05 % of the frame (two-sided back > 0.5 % = WARN) |
| e | 🧱 v1 primitives | Box/Cylinder/Cone/Octahedron/… geometry, not intentional (fx, unlit HDR emitters, beams, custom-shader sky, `STYLE.tag(…, {intentional})`), visible pixels via ID pass | any ≥ 4 px on screen |
| f | ⬛ black / NaN | final frame: exact-zero pixels (NaN → 0 after tone mapping), dark share, histogram; every frame of every take | zero-px > 0.2 %, dark > 85 %, mean < 3, or a frame < 25 % of the take median |
| f′ | 🌑 near-black objects | dark final pixels attributed per object | > 50 % of an object's pixels near-black (WARN) |
| g | 🎥 camera | underground · sight line look→camera blocked (physics) · back-face-first rays (inside a mesh) · near-plane clip · > 20 % of the view closer than 1.2 m | any |
| h | 🎨 texture sanity | no albedo map / custom sampler (env, shadow, normal maps don't count) and ≥ 0.4 % of the screen; `flat` if luma σ < 4 | WARN |

## 🧱 Realism rules (REALISM-QA.md) — `tools/qa/realism*.mjs`, group «реализм» / «столкновения»

`node tools/qa/realism.mjs rules|collide|air` alone (one browser, lock) · in `qa.mjs` by default (`--no-realism`, `--no-air`).

| # | Rule | Measure | FAIL when | Source |
|---|---|---|---|---|
| 1 | 📏 size | Passport box h / min-area l·w / trunk height; pilot skinned height; quadruped withers (first neck bone, rest pose) | outside `tools/qa/sizes.json` range | per-row sources in sizes.json; ±15 % (PLAN §6) |
| 2 | ⚪ albedo | map average (linear, alpha-weighted) × colour × vertex colour → sRGB luminance | < 30 or > 240 (snow 245); WARN 30–50 | PBR charts (charcoal ≈ 50, fresh snow ≈ 240) |
| 3 | 🌙 frame | measure.py port on forest / camp / lake_shore / mountains | beyond night_master [min,max] ×/÷ 2 (Y), ×/÷ 1.5 (lit/shadow), ± 0.25 (blue/red), ± 0.15 (dark share), ± 0.1 (contrast); inside margin = WARN | references/targets.json |
| 4 | 🪨 grounding | lowest vertex per 4×4 footprint cell vs `ctx.snowField` drawn surface (+ physics ray onto a supporting object) | min gap > 3 cm · buried > 30 % (krummholz 70 %) | PLAN §6.4, QA c′ |
| 4b | 👻 collider exists | drawn rock/prop/structure instance ≥ 0.3 m with no Passport box around it | any | invisible-air's opposite |
| 5 | 🔍 texel density | albedo px per metre (UV area × texture size ÷ world area) vs neighbours within 20 m | > 50 % of a mesh's instances > 3× off the neighbour median | PLAN §6.5 |
| 6 | 🔺 faceting | smooth-shaded edges bending > 20° and > 24 px with the object at 40 % of a 1720 px frame | > 12 % of smooth edge length | silhouette corner visibility |
| 6 | 🔁 repetition | same geometry within 2.2 × radius (≥ 2.5 m), rotation < 6°, scale < 4 %, same tint | any pair | PLAN §6.7 |
| 6 | 🧊 weathering | compiled uniforms: snow (`uSc*/tSc*/tVSnow/tSnow`) + grime (`tGb/uGbM`) on collider-backed static props (fantasy pieces excluded) | missing | PLAN §6.8 |
| 7 | 💻 air fps | `?q=air`, 1280×800 @2x, CPU ×4, forest_deep + camp, rAF median 5 s | < 30 | PLAN §1/§10 |
| B | 🧗 exact collision | walk into each kind, gap capsule ↔ VISIBLE surface (own per-instance raycaster) + seam-snag slide + jump on top + physics cost | \|gap\| > 3 cm | PLAN §9 |

Note: the game sets `InstancedMesh.prototype.raycast = acceleratedRaycast` (three-mesh-bvh), which ignores instances — any stock `Raycaster` against instanced rocks misses. The QA tools raycast instances one by one.

## 👁 Views, spots, takes

| Set | Items |
|---|---|
| 25 eye views | crate_close · debris · kestrel_side · kestrel_wing · forest · forest_edge · boulder · outcrop_front · outcrop_back · grass · shrubs · station_door · orm · pier · lake_shore · camp · ruins · rift_rim · mountains · beam · pilot_hands · fox · stags · enemies · snowmobile |
| 7 feet spots + animals | flat snow · 25° slope · deepest loose snow · boulder top · Kestrel wing · crate stack · lake ice · grazing stags · sitting fox |
| 12 motion takes | walk · run_turn · strafe_back · climb_crate · climb_kestrel · ride · fox_follow · fox_seek · stags_flee · stags_flee2 · shardlings · boss → `eye/motion/<take>.sheet.png` + `.webp` |

Add a view: `QAV.views.<name> = () => { QA.place(x, z, { look: [x, y, z] }); return { note, feet: ['player'] }; }` and append to `QAV.viewOrder`. A take: `QAV.motions.<name> = { setup() { … return { only: ['stag'] }; }, async run() { … } }`.

## 🏷 Provenance

| Tag | Set by |
|---|---|
| `userData.owner` | `qa-hooks.js` (only with `#dbg`): the file that called `add()` · or `STYLE.tag(obj, { owner })` |
| `userData.source` | `loadPacked` tags the scene + geometries with the pack name (merged geometries keep it in `mergedUserData`) · `STYLE.tag(obj, { source })` |
| `qaIntentional` | `STYLE.tag(obj, { intentional: 'beam' })` — primitive allowed on screen |

## 🎬 Autoplay

`E` on real prompts and dialog lines, a click on the choice button, `F` for bolts; teleport between objectives; cheats in the trace (hp 99, boss hp 3).
Per step: prompt shown · stage advanced · HUD counters = state · objective inside the island / on the ground / not under a solid · pilot in bounds · dialog not stuck · no JS errors · another prompt stealing the target (WARN).
Saves: v1 format (unchanged since the first build) at stages 0–8 + legacy variants → reload → Continue.
Oracle: `server/typesafe.mjs`, key read by Node from `.env`, never printed, ≤ 4 calls per run; classifies each flagged step.

## ⚠️ Limits of the checks

- Facing uses bones/emitters; a model with swapped L/R bone names would read reversed (pilot, stag, fox, golem verified).
- Height map and ID pass run on a paused frame; shader-displaced meshes (terrain rings, grass) are exact in the height map and back-face mask, approximate in attribution.
- Foot sliding needs ≥ 2 steady steps; accelerations are reported separately (`worst`).
- Placed-object support uses the CPU ground (heightfield + loose snow) and physics rays; objects resting on non-colliding meshes read as floating.
- fps is only concluded on a quiet machine.

## 📊 Baseline — `stand/qa-baseline/` (2026-09-26, M1 Pro, *high*, 10.3 min incl. autoplay)

| Group | FAIL / checks | Main offenders (numbers) |
|---|---|---|
| 🏃 motion / facing | 14 / 50 | 🦌 **stags run backwards**: dot −1.0 for 100 % of the flight (stags_flee, stags_flee2) · 🛷 **after mounting + dismounting the snowmobile the pilot walks with the model turned away** (dot −0.3…−0.9, 100 %, foot drift 0.4–1.0 m/step) · sprint slides 0.25 m/step (stride ratio 3.9) · 🦊 fox trot drift 0.16 m/step, seek run 1.06 m/step (ratio 10) · golem walk drift 0.9 m/step, pelvis 13 m/s in attacks · 🧗 Kestrel: static ledge probe finds a 1.06 m ledge, the pilot never climbs it (walks/jumps over the wreck); crate climb pelvis jump 6–7 m/s · snowmobile turn 9 % sideways samples · shardling dash 7 % backwards |
| 👣 feet / contact | 18 / 38 | pilot boots **sunk 6–11 cm** in every snowy eye view (crate −0.11, camp −0.10, beam −0.10), −0.20 on the outcrop slope, −0.27 in 32 cm drift (sink ≈ 0.7–0.8 × loose-snow depth) · stags hooves −0.11 (stag0/1) and +0.14…+0.23 floating (stag2) · 18 trees floating (fir_windbent ×11 up to 1.49 m, krummholz ×7 up to 0.22 m) · buried > 30 %: rock ×300, rock_flat ×70, boulder ×47, rock_outcrop ×34, ice ×65, st_crystal_tree ×8, st_ruin_column ×6 |
| 🔲 back faces | 2 / 25 | `veg_tree_pbark` (pine trunk renders inside-out: see-through) 179–224 px in forest / rift_rim · WARN two-sided: tunnel tent 1197 px (seen from its back side), pilot suit/visor 326–671 px |
| 🧱 v1 primitives | 26 / 26 | on screen in every view: procedural `rock` icosahedra (300), `wf_clutter_stone` icosahedra, `debris` boxes ×9, `tool_crate` box, spire parts (icosahedron / torus-knot / octahedron), lake cell cylinder, lake hole circle |
| ⬛ black frames | 3 / 39 | **intermittent NaN frame**: stags_flee2 take 192–199/199 frames with 83 % black, 44 % exact-zero pixels (2 of 4 full runs; also a black block in an early climb take) · camera inside spruce crowns: rift_rim 2.3 % zero-px, forest/ruins 0.3–0.4 % · WARN radio dish 91 % near-black |
| 🎨 textures | 0 / 21 (21 WARN) | the whole pilot is untextured flat colours (`blinn3SG.003` hands/gloves 4.5 % of a close-up, suit, boots) · 73 untextured meshes in the scene (Kestrel parts, v1 primitives) |
| 🎥 camera | 2 / 38 | orm: 37 % of the view within 1.2 m (dome wall) · rift_rim: 63 % within 3 m (tree crown) · strafe_back: sight line blocked by a spruce |
| ⚡ perf | 0 / 5 | 59.9 fps all 8 views, spread 0 %, quiet machine → verdict PASS · collisions 8/8 · 0 JS errors · 12/12 modules |
| 📖 story | 2 / 16 | both endings reached through the real code (take → «Тихое небо», free → «Песня сияния») · WARN "Отдохнуть у огня" steals the Orm prompt when hurt · saves: legacy position inside the station → pilot lands on the dome roof (9.4 m) · save next to the W spire → pushed 5.6 m |

Repro: every row in `index.html` has its frame / sheet; motion rows: `node tools/eye.mjs x --views none --no-feet --no-placed --motions <take>` (the snowmobile one: `--motions ride,walk_after_ride`; the black frame needs the full take sequence).

