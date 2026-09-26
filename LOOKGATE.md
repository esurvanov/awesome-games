# 🎯 LOOK-GATE — visual acceptance

Three waves in a row, numeric QA passed while the look got worse: 🕳 a ±5 cm foot check was met by widening the boot pad → footprints became 1 m craters · 🦓 sastrugi turned into uniform corduroy.
Realism has no finite checklist. **Appearance is accepted only by eye, against photos and against the last accepted run.** Numbers (QA.md) guard function, never look.

## ▶️ Commands

| Step | Command | Output |
|---|---|---|
| 1 📸 run | `node tools/look-gate.mjs run <label>` (`--subjects a,b`) | `stand/lookgate-<label>/` (~4 min, benchmark lock) |
| 2 👁 review | fill `review.json` (copy `review.template.json`) | scores + anti-patterns + vs accepted |
| 3 ⚖ check | `node tools/look-gate.mjs check <label>` | ✅ / ⛔ + worst-first table, `check.json`, `index.html` |
| 4 📌 accept | `node tools/look-gate.mjs accept <label> --by <who>` | `stand/lookgate-accepted/` |
| · | `node tools/look-gate.mjs status` · `page <label>` | history · rebuild page |

📌 **Only the user or the main agent runs `accept`.** A fix agent never promotes its own run. `--force` only on the user's explicit word.

## 📂 Per run

| File | For |
|---|---|
| `<subject>.pair.jpg` | 👁 reviewer sheet: game shots left, crop-matched photos right (900×600 tiles, labelled) |
| `<subject>.vs.jpg` | ◀ accepted · now ▶ per shot / motion strip |
| `<motion>.strip.jpg` · `.webp` | 🎞 16 frames every 3rd frame (≈ 0.05 s apart) · animated |
| `index.html` | side-by-side, ◀▶ slider vs accepted, strips, scores |
| `run.json` | camera pos / look / FOV per shot, git head |

## 🎥 Subjects & framing

Free camera (`DBG.camOv`), framed like the photos: height · distance · vertical FOV. Pilot parked behind the camera unless in the shot.

| | Subject | Game framing | Photos |
|---|---|---|---|
| ❄ | snow_open | eye 1.6 m, open flat snow, horizon upper third, fov 50 | a05 a04 h02 |
| 👣 | footprints | trail walked 3 s away from the camera, eye 1.7 m · boots 1.3 m looking down · 🎞 pilot_walk side-on 4 m | c06 c01 c02 c04 · c05 |
| 🌬 | deep_drift | deepest loose snow near the crash, pilot in it at 3.6 m | d06 c05 d05 |
| 🪨 | boulder | boulder ≥ 2.2, camera ~6 m, pilot 0.38 m from its surface | d01 d04 e06 |
| ⛰ | outcrop | from below, 10 m | d03 d02 |
| 🧱 | ruin_wall | 5.5 m · **no direct photo**: stone vs d03/d02 | d03 d02 j05 |
| 🌲 | tree_close | spruce trunk at 2.2 m, looking up, fov 60 | b06 b05 b01 |
| 🌲 | forest_mid | forest edge ≈ 32 m | b02 b03 b04 |
| 🌌 | forest_far | nearest trees ≈ 150 m (impostors) | b04 a05 i04 |
| 🌾 | grass | grass 2.6 m, eye 1.3 m · heather 4 m | e04 e06 e03 e05 |
| 🦌 | stag | side-on 18 m, tele fov 26 · 🎞 stag_graze · stag_flee (pan) | i03 i05 i04 · i01 i06 |
| 🧊 | sea_ice | on the shore ice, looking out | g02 g01 g03 |
| 🏔 | mountains | coast → ring, fov 40 | h04 h01 h05 |
| 🏠 | station_night | 30 m, fov 45 | f01 f02 f04 f05 |
| ✈ | wreck | Kestrel 14 m + R, eye 1.4 m · debris 3 m | j01 j05 j03 j02 |

Photos are day or long exposures: judge **shape, scale, material, ratios, hue relations** — not absolute brightness.

## 👁 Reviewer protocol (agent with vision)

**Order (blind first):**
1. Open `<subject>.pair.jpg` only. Score every criterion 1–5 **against the photos**, one line each: what you see, not what the code does.
2. Walk the subject's anti-pattern list; for each write `false` (looked, absent) or `"where / what"` (seen).
3. Only then open `<subject>.vs.jpg` / the slider → `vsAccepted`: `better` · `same` · `worse`. Any doubt between same and worse = `worse`.
4. `note`: the one thing to fix first (→ next wave's list).
5. `check`. Don't edit scores after seeing the check result.

**Rubric (1 = broken · 2 = clearly CG / wrong · 3 = passable at a glance · 4 = close to the photo · 5 = indistinguishable in this framing)**

| Criterion | Look at | 1–2 means |
|---|---|---|
| 🔷 silhouette | outline, proportions, how it meets the ground and sky | boxy, blobby, wrong size vs the pilot (1.8 m) |
| 🔍 surface | size of the detail vs real scale: grains, prints, bark, cracks, needles | detail 3× too big or too small, repeating tile, smeared |
| 💡 lighting | lit : shadow ratio, contact shadows, soft vs hard | flat, no contact shadow, shadow blacker than the photos |
| 🎨 color | hue relations: shadows bluer than light, warm lamps, neutral snow | cyan cast, grey soup, saturated toy colours |
| 🏃 motion | strips: pose continuity, gait matches speed, no pops (only 🎞 subjects) | pops, sliding, wrong gait for the speed |
| 🦶 contact | where objects meet snow: sink, pillow, gap, clipping (only where it applies) | hovering, cut into the ground, crater around it |

**`review.json`**
```json
{ "label": "…", "reviewer": "…", "date": "…", "baseline": "<accepted label | null>",
  "subjects": { "boulder": { "scores": { "silhouette": [3, "reads as a rock, too round"], "surface": [2, "…"], "lighting": [3, "…"], "color": [3, "…"], "contact": [2, "…"] },
                             "anti": { "hover": false, "plastic": "specular sheen on the top face", "blobs": false, "dither": false },
                             "vsAccepted": "same", "note": "first fix: …" } },
  "verdict": "accept | reject", "reason": "…" }
```

## ⛔ HARD RULES

1. **Any regression vs the accepted run on any subject = reject.** Regression = `vsAccepted: worse` · any criterion score below the accepted review's · any anti-pattern seen that the accepted review had absent. (`check` enforces.)
2. **Numeric QA passing never overrides a visual reject.** `look-gate` does not read QA numbers. A fix that turns a FAIL green but costs one look point is rejected.
3. **Absolute low scores do not block acceptance** — they are the fix list. The gate blocks going backwards, and blocks accepting what hasn't been looked at.
4. The reviewer may reject what the rules allow; the rules can't be talked into accepting.
5. Every applicable criterion scored with a reason, every listed anti-pattern answered — else reject.
6. Fixing to a number (widths, depths, counts) is allowed only if the pair sheet looks better afterwards.

## 🚫 Anti-patterns (check explicitly)

| | Pattern | Where it hides |
|---|---|---|
| 🕳 | craters — prints / hollows much wider or deeper than a boot (≈ 30 × 12 cm) or hoof | trail, boots, drift, around rocks and trees |
| 🦓 | uniform stripes — one wavelength, one direction, whole field | sastrugi, snow normals, sea ice, mountain slopes |
| 🃏 | card planes — flat quads edge-on, crossed cards, billboard swim | grass, shrubs, far trees, branch snow |
| ▦ | dithering noise — screen-door fade, stipple, crawling grain | LOD fades, foliage alpha, film grain on dark areas |
| ⛸ | sliding feet — planted foot moves | pilot_walk, stag strips |
| 🎈 | hovering / intersecting — daylight under an object, or sunk / clipping | boulder + pilot, trees, wreck, ruins, hooves |
| ⬛ | black blobs — near-black masses without inner shading | spruce crowns, rocks in shadow, windows |
| 🧴 | plastic look — uniform sheen, no micro-variation | rocks, metal, ice, snow speculars |

## 📊 Baseline review — `stand/lookgate-base/` (2026-09-26, git dee3b1a)

Worst first = next wave's fix list. Copy of the review: `tools/look/review-base.json`. Not yet promoted (`accept base` is the main agent's / user's call).

| | Subject | min | ⌀ | 🔷 | 🔍 | 💡 | 🎨 | 🏃 | 🦶 | Seen anti-patterns · first fix |
|---|---|---|---|---|---|---|---|---|---|---|
| ⛰ | outcrop | 1 | 1.6 | 1 | 2 | 1 | 2 | · | 2 | ⬛ near-black block · white bloom sphere next to it |
| 🌲 | tree_close | 1 | 2.0 | 2 | 1 | 2 | 2 | · | 3 | 🃏 paper-cutout branch cards · ⬛ black crown core |
| 👣 | footprints | 1 | 2.2 | 1 | 2 | 3 | 3 | 2 | 2 | 🕳 1 m round prints · 🎈 idle boot in the air · 🦓 corduroy |
| 🌬 | deep_drift | 2 | 2.2 | 2 | 2 | 2 | 3 | · | 2 | 🕳 hole around feet · 🎈 drift sheet cuts the sledge · ▦ edge aliasing |
| 🧊 | sea_ice | 2 | 2.3 | 2 | 2 | 2 | 3 | · | · | 🧴 blue cube bergs · no ridges |
| 🦌 | stag | 2 | 2.3 | 3 | 2 | 2 | 2 | 2 | 3 | 🧴 satin hide · red deer colours · rears in place before fleeing |
| 🌲 | forest_mid | 2 | 2.5 | 2 | 2 | 3 | 3 | · | · | ⬛ dark crown · 🦓 ripples in front · thin, snowless crowns |
| 🪨 | boulder | 2 | 2.6 | 3 | 3 | 2 | 2 | · | 3 | 🎈 pale base skirt · no snow cap / pillow · warm tan rock |
| ❄ | snow_open | 2 | 2.8 | 3 | 3 | 2 | 3 | · | · | flat light · square confetti flakes |
| 🌌 | forest_far | 2 | 2.8 | 3 | 2 | 3 | 3 | · | · | foreground ripples dominate |
| 🏔 | mountains | 2 | 2.8 | 3 | 2 | 3 | 3 | · | · | smooth faces, no rock / gullies |
| 🌾 | grass | 2 | 2.8 | 3 | 2 | 3 | 3 | · | 3 | ⬛ heather balls · sparse same-size tufts |
| ✈ | wreck | 2 | 2.8 | 3 | 3 | 2 | 3 | · | 3 | white glow sphere washes the frame |
| 🧱 | ruin_wall | 3 | 3.0 | 3 | 3 | 3 | 3 | · | 3 | no snow on ledges (no direct photo) |
| 🏠 | station_night | 3 | 3.4 | 4 | 3 | 3 | 4 | · | 3 | 🧴 clean panels · no drifts at walls |

Cross-cutting: 🦓 one-wavelength snow ripples in 6 of 15 frames · ⚪ blown-out white glow sphere (outcrop, wreck) · ▫ square white snowflake particles everywhere.

## ⚠️ Limits

- Framings are computed from the world (nearest boulder / outcrop / tree to the crash, deepest snow…): a world change can move a subject → compare the `note` in `run.json` before calling a difference a regression.
- Motion strips come from the page's frame loop: on a loaded machine they hold ~10 fps samples; judge gait shape, not smoothness, when `frames` < 14.
- Photos are day / long exposure; `ruin_wall` has no direct photo.
- `LOOKGATE_ACCEPTED=<dir>` overrides the accepted folder (dry-run tests only).
