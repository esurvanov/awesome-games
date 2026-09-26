# INT-VEG — trees, grass, heather (integration wave)

Owner: `modules/vegetation.js`. Brief: LOOKGATE.md is the only appearance criterion. User complaints: close-up spruces look
like flat paper cut-outs with black cores · forest shows dithering noise · heather reads as dark balls · grass tufts
all the same size and sparse.

## What shipped

| Area | Before | After |
|---|---|---|
| 🌲 near-tree LOD fade | screen-door dither discard (`vegDither() > vVFade`) | folded into `diffuseColor.a` (mip-aware boosted texture alpha × fade), `alphaTest` + `alphaToCoverage: true` on every near tree material (needles/bark) → resolved as real MSAA sub-pixel coverage on the scene's multisampled render target (B. Golus, "Anti-aliased Alpha Test") — no discard, no stipple |
| 🌲 needle-card cutout edges | hard `alphaTest` discard, no AA on the texture-alpha silhouette itself | same alpha-to-coverage path now also anti-aliases the needle/leaf cutout edges (previously only ground tufts/leaves had this; tree needles didn't) |
| 🌲 impostor (mid/far) cutout + LOD cross-fade | two separate per-pixel dithered discards (own alpha cutout + near/impostor cross-fade) | both folded into one continuous `diffuseColor.a` (`smoothstep(.25,.65,iAccA) * vIFade`), same alpha-to-coverage mechanism, `alphaTest`/`alphaToCoverage` added to the impostor material |
| 🌲 branch snow (`vegSnow`, models + impostors) | clumps threshold `.18–.62`, noise ×1.1, clamp 0.92 | wider/chunkier clumps: threshold `.02–.5`, noise ×1.35, clamp 0.97 — heavier, more engulfing coverage closer to b03/b04 (was flagged "thin, snowless crowns" in the accepted baseline) |
| 🌾 grass tufts | upright only (no lean), size `(0.6+r×0.7)×(0.75+0.45×bare)`, count 46/chunk, base probability 0.025 | leaning (±0.24 rad, per-instance hash), wider size range `(0.5+r×1.05)×(0.7+0.5×bare)` and height ratio, count 58/chunk, base probability 0.045, LOD fade also folded into alpha (no dither) |
| 🌾 grass snow base | flat blend to snow colour at the stem base | added a brighter "rim" at the snow/blade boundary (peaks at the transition, `snowBase×(1-snowBase)×4`) |
| 🌿 heather (crowberry/willow) shape | uniform-scale instance → reads as a ball on a stem | non-uniform scale: crowberry ×0.58 height / ×1.24 width, willow ×0.76/×1.1 — flattened into a low tangled mat (e05/e06), birch kept upright |
| 🌿 heather colour/light | narrow backlit cone (`pow(...,4)`, hemisphere fill 0.12) → reads near-black off-axis | wider transmission (`pow(...,2.2)`, hemisphere fill 0.26, base multiplier 0.16+.9), wider brightness variance (0.72–1.42 vs 0.8–1.2) — never reads as a flat black mass |
| 🌾 ground plants LOD fade (tuft/leaf) | same screen-door dither as trees | same alpha-to-coverage fold (twig kept the old dither — see Open) |

## What was attempted and reverted

**Baked per-vertex crown AO** (bullet 1's "black cores" / "depth instead of flat cards" ask): wired a `treeAO` vertex
attribute from `assets/baked/treeao.js` (BAKE.md's tree-crown-AO job — a plain base64 byte pack, no KTX2/Basis, per the
brief's "use the plain-image/sidecar data, not KTX2") onto each species' shared `BatchedMesh` geometry, and used it in
`patchTreeNear` as an ambient-floor + contrast lift (not the full baked-terrain-irradiance replacement in
`tools/bake/runtime/baked.js` — that needs the KTX2 atlases, out of scope; this only reused the already-working
`uVHemiS` hemisphere uniform).

Hit an unresolved GLSL compile error on every tree material (`needles`/`bark`/`leaves`): `'treeAO' : redefinition`,
`'vTreeAO' : redefinition`, then cascading `dimension mismatch` errors, confirmed via `look-gate.mjs`'s captured
`run.json.errors` (`THREE.WebGLProgram: Shader Error … Vertex shader is not compiled`). Root cause not confirmed —
ruled out double-invocation of `onBeforeCompile` (the *other* insertions in the same call, `vVFade`/`vVW`, were never
flagged as redefined) and ruled out three.js auto-declaring geometry attributes as shader symbols (checked
`WebGLProgram.js` and `batching_pars_vertex.glsl.js` on `three@0.186.1` directly — no such mechanism). A first attempt
at fixing (adding the missing `uniform vec3 uVHemiS;` declaration) cleared one real bug (confirmed via a separate,
correct diagnosis — that uniform genuinely wasn't declared) but the redefinition itself came back on the next run
against a `BatchedMesh`-specific interaction I could not pin down in the time available. Given every further attempt
consumes the shared `tools/.stand.lock` queue three other integration agents were waiting on, reverted the whole
`treeAO` attribute + its shader consumption rather than keep guessing under that pressure. **This is the one bullet-1
item not delivered this wave** — `assets/baked/treeao.js` is real, correct, and ready; the wiring needs a redo with a
scratch repro (a single `BatchedMesh` + one custom attribute + `onBeforeCompile`, outside the game) to isolate the
redefinition before touching `modules/vegetation.js` again.

## Not attempted (out of code-only scope)

- **More card density near the trunk**: `tools/pack-veg.mjs` only merges pre-authored source GLBs from
  `assets/incoming2`/`incoming` — there's no procedural generator in this repo to add cards to. Needs new source
  geometry (Blender/EZ-Tree authoring), not a shader or placement change.

## Measurements

- `node tools/stand.mjs veg1-forest --views forest --unlimited`: 306 draw calls, 2.53M tris, 0 errors, 8/8 collisions,
  0 black frames, modules 12/12 (`stand/veg1-forest/`). Within VEGETATION.md's ≤400-call budget (previously measured
  353 for this same view). fps not conclusive — machine had 3 other automation Chrome instances running.
- `node tools/qa.mjs --autoplay` (`stand/int-veg1/`) was run once, but it executed while the (now-reverted) crown-AO
  bug was still live in the code — its 29 FAILs (mostly cascading story/save FAILs from the shader crash) are **not**
  representative of the current, fixed code and should be disregarded. Did not re-run a full `qa.mjs` afterward per
  the coordinator's instruction (avoid adding to the shared benchmark-lock queue three other integration agents were
  waiting on) — the main agent runs one combined QA after all four integration agents commit.

## Look-gate — `stand/lookgate-veg1/`, `review.json` (baseline: `perf1`, the accepted run)

Reviewed the 4 mandated subjects only (coordinator instruction, to limit lock contention):

| Subject | vs accepted | Headline |
|---|---|---|
| 🌾 grass | **better** | heather's "black balls" anti-pattern is gone — warm rust-brown colour (was near-black), visible twig/leaf structure, flattened silhouette instead of a ball on a stem; tufts denser + more size-varied |
| 🌲 forest_mid | **better** | background/mid trees now read snow-laden (was "thin, snowless crowns") |
| 🌲 tree_close | **better** (modest) | less flat-cutout reading (heavier snow breaks up the crown, more green shows through); silhouette and the black-core lighting are unchanged — see the reverted crown-AO item above |
| 🌌 forest_far | same | no visible change in this static framing at 150 m — the impostor dither fix should matter most at the LOD transition band / on video, not confirmed improved here |

No criterion scored below the accepted review, no anti-pattern newly appeared. Did **not** run `look-gate.mjs check`
or `accept` (reserved for the main agent/user). Only these 4 subjects were reviewed this run — the other 11 look-gate
subjects were not re-checked, so "no regression elsewhere" is not independently confirmed by this wave alone.

## Open items for the next wave

- Wire the baked crown AO (`assets/baked/treeao.js`) properly — reproduce the `BatchedMesh` custom-attribute
  redefinition bug in isolation first.
- Tree-card density near the trunk needs new source geometry, not a code change.
- `forest_far` unconfirmed improved — worth a targeted look at the LOD transition band specifically (drive the camera
  across `Q.vegTreeMid` and record, rather than one static frame).
- Grass tufts are still round-puff cards, not blade-shaped — the photo references (e03/e05) show tall individual
  blades; closing that gap needs new tuft card geometry, not just placement/shader tuning.
