# 🛩 FIX-WORLD — world objects, wreck, pilot, marker, story

Pass-3 assets wired in; every v1 primitive left in the world replaced. Runs: `stand/qa-baseline` → `stand/fixw-final2` (`node tools/qa.mjs --autoplay`).

## 📊 Before → after

| QA group / row | baseline | after |
|---|---|---|
| 🧱 v1 primitives | 26 / 26 FAIL | **0 / 26** |
| 🪨 buried > 30 % (my objects) | rock ×300 · st_ruin_column ×6 · debris ×4 | **0** |
| 🪨 buried > 30 % (handed over by FIX-LOOK) | wf_ice ×38 · crystal_tree ×8 · rift_crystal ×6 · pressure_ridge ×3 · pier | **0** |
| 🔲 back faces · tunnel tent | 1197 px (two-sided) | **0** |
| 🔲 back faces · pilot suit / visor | 326–682 px | **0** |
| 🎨 textures · pilot untextured | 21 WARN | **0** (textured suit) |
| ⬛ radio dish near-black (WARN) | 91 % | 93 % — support/pipes now light; the bowl's back is in its own shadow from the station-door view |
| 📖 story | 2 / 16 FAIL | **0 / 16** · both endings · saves 13/13 |
| 🧍 collision tests · Kestrel ×4 | 4/4 | **4/4** |

## 🔧 What changed

| Object | Before | Now | Where |
|---|---|---|---|
| Kestrel | Global Hawk scan, forced shiny metal | `ship_kestrel` DC-3-like wreck, authored weathered aluminium, snow on top (`snowCover`), terrain drifts, nose dug in / tail break open, right wing up (left torn off) | structures.js `buildKestrel` |
| Kestrel collider | Global Hawk trimesh | drawn wreck as trimesh: top, wing stub, cabin via tail break / cargo door | same |
| Debris | 9 black boxes | 12 wreck pieces along the crash trail (tail section 27 m behind, wing panel 17 m left, skin, cowling, blade, seat, wheel, door…), re-seated after snow drifts settle | `placeDebris` |
| Tool container | 2 boxes + glow | ribbed cargo case; E → lid `Open` clip, cutter lifts out and flies into the hand; saved games open it | `buildCase`, `takeTool` |
| Spire altar parts | icosahedron / torus-knot / octahedron | cowling · propeller blade · cable loom from the wreck | `spireParts` |
| Lake cell | cylinder + dark circle | dented tank in a broken-ice hole decal | `lakeCell`, `iceHoleTexture` |
| Lake ice | Ø98 m disc | lake-shaped sheet | `lakeSheetGeo` |
| 300 rocks | icosahedra | boulder scan + 2 closed-back rock faces, instanced per 200 m cell, convex colliders | `placeRocks` |
| Clutter stones | icosahedra | boulder scan clustered to ~480 tris | `WorldFill.setStoneGeometry` |
| Pilot | `pilot_aces` flat colours | `pilot_aces_textured` (same 37 clips), inner shell instead of double-sided | pilot loader |
| Objective marker | 140 m open tube | camera-facing beam + ground ring + constant glyph, `0xffb347` | `makeObjectiveMarker` |
| Tents | double-sided fabric | two single-sided shells | `solidShells` |

## 📏 Placement rule (one formula, not tuning)

`seatY()` solves the height from the same measure the QA uses: footprint 3×3, lowest vertex per cell vs the visible snow, buried share averaged, never floating. Targets: rocks 12–20 % (+ future drift), debris 10–12 %, masonry 5 %, crystals 14–15 %, wreck ≤ 20 %.
Pier piles and sea ice under the water line are cut out of the colliders (unreachable).

## 📖 Story / saves

| | |
|---|---|
| Prompt priority | story beat 3 · ship / echo / skimmer 1 · rest 2 when hurt else 0 · nearest among equals |
| Legacy save inside the dome | → nearest open ground (6.8 m), `G.migrated` records it; autoplay checks the pilot is exactly there |
| Save inside a combat arena (W spire) | 3 s grace after Continue, shardlings never spawn within 7 m |

## ⚠️ Honest gaps

- Wreck vs j01–j05: references are bright bare aluminium with sharp torn edges and dents; in-game at night the skin reads dark blue-grey, torn edges are simpler, the radial engine is low detail.
- Belly depth ends 0–0.6 m (≈ 0.25 m mean) + drifts: the QA burial cap (≤ 30 %) wins over the brief's 0.5–0.8 m because the low wing root counts.
- `climb_crate` fails inside full runs, passes alone (`stand/fixw-c`) — timing under load; climbing is FIX-MOTION's.
- Feet rows (boots in snow) — FIX-MOTION.
- Radio dish: material fixed (was navy, metal 1); the bowl seen from behind at night stays dark — 1.1 % of the frame, WARN only.
