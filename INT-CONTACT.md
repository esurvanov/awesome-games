# 🤝 INT-CONTACT — bodies touch the world (rocks, walls, slopes, obstacles, branches)

Fixes: *"I stand near a rock and there is no interaction — I don't lean on it, I just bump into it from a distance."*
Wave 3 on top of `modules/interaction.js` (wave 2, see `INTERACTION.md`). Packs the 37 pilot/hermit contact clips and
20 stag gait clips from `assets/incoming4/anim/` (see `ANIMLIB.md`) into `assets/pack/`, wires them into the
mixers, drives hand IK onto the *real* raycast hit, and adds one new Jev question set (`CONTACT_INTENT`).

## 📦 What shipped

| Piece | File | What |
|---|---|---|
| 📦 Pack | `assets/pack/anim_pilot_contact.js` (2.5 MB), `anim_stag_gaits.js` (0.7 MB), `animlib-runtime.js` (12 KB) | copied verbatim from `assets/incoming4/anim/` — base64 GLB (embedded metadata) + the merge/IK/gait-blend runtime |
| 🔌 Wiring | `open-world.html` | `attachContactLib()` merges the 37 clips into `AV.player.acts` / `AV.orm.acts` (pilot + hermit share the UAL skeleton) and builds a `ContactLayer`; `animal_stag`'s loader merges the 20 gait clips into every stag's `s.A.acts` once the pack lands |
| 🧠 Contact layer | `modules/interaction.js` (`CT`) | probe → decide (Jev + rules) → steer to stand-off → play clip → hand/foot IK onto the probed point |
| 🎬 Jev set | `ai-content.js` (`CONTACT_INTENT`) | compact scene description → one of 7 contact intents + `none`; confidence ≥ 0.4, else `contactRules()` |
| 🦌 Stag gait | `modules/interaction.js` (`stagUpdate`) | `ANIMLIB.GaitBlender` per stag: phase-synced walk/trot/canter/gallop, speed-matched to the existing flee-speed ramp |
| 🎨 Stag colour | `open-world.html` (`animal_stag` tint) | pack's texture multiplied towards pale grey (i01–i05), roughness ↑, metalness/env ↓ (satin → matte) |

No changes to `physics.js`, `worldfill.js`, or the footprint/stamp functions in `interaction.js` (INT-SNOW's).

## 🧍 Contact layer — state machine (`modules/interaction.js` → `CT`)

```
every 0.2 s: probeDir × 5 (front/left/right/back at chest height, front at knee height)
             → sense {front,left,right,back,knee,obstacle,ground,speed,onIce}
             → senseKind(sense) → compact description → contactRules() (instant) + Jev CONTACT_INTENT (async, cached)
idle  ─(wantIntent≠none, ANIMLIB.chooseContact(intent,sense,meta) picks a clip)─▶ steer
steer ─(nudge the last few cm to the clip's ideal stand-off; PH.ch.setPosition, no fighting the controller)─▶ enter/play
play  ─(A.loop/once the clip; ContactLayer.update pins hand/foot bones to the probed point+normal each frame)─▶ idle (hold ends) or auto (one-shot finishes)
```

| Probe | Ray | Feeds |
|---|---|---|
| `front` | horizontal, chest height (1.0 m), `K.contactRange` (1.7 m) | wall / ledge / slope / branch / object_face classification, hand IK for most contacts |
| `left` / `right` / `back` | horizontal, chest height, 1.15 m | reserved for shoulder/back leans (placement-only in `ANIMLIB.ContactLayer`, no extra IK needed) |
| `knee` | horizontal, 0.38 m, 1.5 m | `obstacle` field (step-over / vault candidates — a chest-height ray flies over anything short) |
| any hit | + one vertical ray from 3.5 m down to the hit XZ | **height** = real top of that surface above the feet (a wall with no top within reach reads as tall, which is the correct fallback) |

**Stand-off, not capsule resize.** The capsule radius (0.4 m, `physics.js`) already lands within a few cm of the
clips' authored stand-off (`approach.distance[1]`: 0.45–0.62 m for hand/lean contacts, 0.3 m for pickup). `steer`
closes exactly that remainder — a few centimetres, over a few tenths of a second, only while the player isn't
pressing a movement key — instead of resizing the collider. `chooseContact`'s own `within()` gate (§ANIMLIB.md) also
means a contact clip is only offered inside `approach.distance[0]..[2]`, so nothing plays with a hand floating in air.

**`driveAvatar` handoff** (`open-world.html`): while `CT.state === 'play'`, `driveAvatar` skips its own idle/walk/jog
state pick — the contact clip owns `A.cur` — but still calls `A.update(dt)` every frame so the mixer keeps advancing.
Outside `'play'` (idle/steer/one-shot-just-finished) `driveAvatar` behaves exactly as before wave 2.

**Idle moods** (`tired_*`, `cold_shiver_loop`, `look_around_loop`) and **push** are in the runtime/meta but out of this
wave's scope: push already existed (arms IK onto a pushed prop, wave 2); idle moods have no trigger wired yet (no
"tired"/"cold" meter in the game beyond hp and `WX.storm`, reused below as proxies) — left for a later pass.

## 🧠 Jev — `CONTACT_INTENT`

| | |
|---|---|
| Trigger | only when the probed surface state *changes* (surface kind / distance bucket / player state / height bucket / on-ice) **and** ≥ `K.contactAsk` (1.2 s) since the last ask — not every frame near a rock |
| Asks | one `choice` among `rest_on_rock · touch_surface · climb_slope · cross_obstacle · inspect_ground · pick_up · clear_branch · none` |
| State sent | surface kind (English bucket), height/distance (m, 1 decimal), player state (idle/walking/running/riding/combat/climbing/sliding), speed (m/s), `fatigue` (hp⁄hpMax — no stamina meter in this game, documented proxy), `cold_exposure` (`WX.storm`, documented proxy), animals/NPC nearby |
| Gate | confidence ≥ 0.4, else `AI_CONTENT.contactRules(s)` (deterministic, same thresholds as `chooseContact`'s own gates: idle/slow + close) |
| Cache | `ttl: 20 s` server-side (identical (state → same answer) hits the existing sha256 cache); client-side the `askKey` gate above stops most repeat asks before they even reach the network |
| Server | no `server/server.mjs` change needed — its whitelist is `Object.keys(content.SETS)`, generic; adding the set to `ai-content.js` is the whole integration |

`tests/ai.test.mjs --offline`: added a `CONTACT_INTENT` fixture to the generic "builds questions & rules fallback"
loop (34/35 pass; the one pre-existing failure — quality-hysteresis fps-20 step — reproduces identically on `HEAD`
without any of this wave's changes, confirmed via `git stash`).

**Measured (real TypeSafe API, `node tests/ai.test.mjs`, 5 new cases added to part 4):**

| Case | → intent | confidence | 
|---|---|---|
| idle at a rock face | `rest_on_rock` ✓ | 0.78 |
| slow approach to a wall | `touch_surface` ✓ | 0.96 |
| sprinting past a wall | `none` ✓ | 0.92 |
| low crate ahead, walking | `cross_obstacle` ✓ | 0.83 |
| fighting next to a wall | `none` ✓ | 0.98 |

5/5 accuracy · **739 tokens/call** · **≈ $0.000031/call** · part of a 40-call, $0.001666, whole-suite run (the other
6 sets unaffected). The two hard gates it exists to enforce (no contact mid-sprint, no contact mid-combat) both hit.

## 🦌 Stag gait blend + colour

- `S.gait = new ANIMLIB.GaitBlender(s.A.mixer, clips, s.gaitMeta, {idle:'Idle'})`, built lazily per stag once
  `anim_stag_gaits` lands (async, after the spots loop already built `STAGS`).
- Drives the mixer **instead of** `s.A.update(dt)` while fleeing or coasting down (`s.gaitDriving` flag read by
  `updateStags` in `open-world.html` — exactly one `mixer.update()` per frame either way, never both).
- The existing flee-speed ramp (`S.v`, 0→top over 0.9 s) now also **ramps down** on stopping (`damp` over ~0.5 s)
  instead of snapping `S.v=0` — this was the literal mechanism behind the baseline's "rears in place before running"
  and its mirror image at the other end: the gait blender's own speed→gait-weight curve (walk→trot→canter→gallop)
  turns a continuous speed ramp into a continuous gait change, so there's no discrete Run↔Idle pose swap to pop.
- Colour: `prepModel(g.scene, 0, tint)`, **`m.map = null`** + `m.color.setHex(0xc9c2b4)`, `roughness = 0.92`,
  `metalness = 0`, `envMapIntensity = 0.4`. First attempt multiplied `material.color` by a near-uniform grey instead —
  wrong: a multiply scales every channel by the same factor, so the *ratio* between channels (the hue) is unchanged;
  it only dims the same red-brown. Confirmed wrong by actually looking at `stand/lookgate-contact1/stag.pair.jpg`
  (still brown) before landing on the fix that changes hue — dropping the map for a flat pale hide, the same pattern
  already used on the fox a few lines below. Trade-off: loses the texture's leg/muzzle shading; matte pale grey (i01,
  i05) reads right at the `stag` subject's 18 m tele framing.

## 🔧 Contact-hold error — three bugs found by actually measuring it

Added `INTERACTION.testContact()` (walks the pilot into the nearest boulder ≥ 2 m, waits for the hold, measures each
hand bone against its IK target). First run: **never engaged at all**. Chasing that down (each fix verified by
re-running the same measurement, not assumed):

| # | Symptom | Cause | Fix |
|---|---|---|---|
| 1 | pilot walked **away** from the boulder | `chooseContact`'s `face` for `rest_on_rock` needs the character pointed at the surface; the sign was flipped (`atan2(-ux,-uz)` instead of `atan2(ux,uz)`) | fixed the sign, walked straight to it |
| 2 | stuck forever on the 0.6 s **enter** clip (never reached the loop hold) | the exit check still referenced a variable (`moving`) removed in an earlier edit — a `ReferenceError` inside the per-frame update, caught by this module's own crash-isolation guard, silently disabled the whole contact subsystem for the rest of that page session | removed the leftover reference; also restructured so the enter clip is **committed** once started (0.6 s, uninterruptible) instead of re-checked every frame — a per-frame "is the player still moving" check kept re-triggering while a key was held into a wall the capsule had already stopped at (blocked ≠ stationary velocity every single frame), restarting `A.once()` from t=0 each time |
| 3 | held pose reached, but hands **11–22 cm** off the rock | both hands of a `_both` clip (e.g. `hand_wall_both`) were aimed at the *same* single front-probe point; the clip's own two hands sit ~0.2 m apart sideways and a boulder is rarely flat across that span | `contactHit()` now re-probes per hand at query time, offset by that contact's own authored local point (character space, +X = left) rather than reusing the shared front/knee probe |

**Final measured** (`INTERACTION.testContact()`, `hand_wall_both_loop`, boulder ≥ 2 m near the crash): **hand_l 0.00 cm
· hand_r 0.00 cm · pass ✓** (gate: < 3 cm). Re-confirmed the `boulder` / `stag` look-gate subjects afterwards on the
corrected build (see below) — this is the version reflected in `review.json`.

## ✅ Verification run (coordinator-scoped, to avoid the shared benchmark-lock queue)

Full `qa.mjs --autoplay` deferred to the combined post-merge run; targeted checks instead:

| Check | Command | Result |
|---|---|---|
| Stag regression | `tools/eye.mjs contact-eye1 --views none --no-feet --no-placed --motions stags_flee,walk` | `stags_flee`: facing PASS all 3 stags (dot 0.88–0.95) · foot drift ratio 0.93 (no sliding) · continuity PASS · black/camera PASS |
| Player walk (unrelated) | same run, `walk` take | `continuity FAIL` (pelvis 7.0 m/s, one frame) + 1 JS error (`THREE.BatchedMesh: … missing "treeAO"`) — that error is a tree-batching/AO-bake issue from a different, concurrently-edited module (not `modules/interaction.js`, not touched by this wave); the walk path never comes near a rock/wall so `CT` can't be involved. Flagged, not fixed here — out of ownership. Worth a clean re-run once that other wave lands. |
| Contact hold accuracy | `INTERACTION.testContact()` via `tools/qa/probe.mjs` | **0.00 cm** both hands (see the bug table above) |
| Jev `CONTACT_INTENT` | `node tests/ai.test.mjs` (real API) | 5/5 accuracy, 739 tok/call, $0.000031/call (table above) |
| Visual | `node tools/look-gate.mjs run contact1 --subjects stag,boulder` | `stand/lookgate-contact1/`, `review.json` written honestly (both subjects `vsAccepted: better`, verdict `accept`) — **`check`/`accept` deliberately not run**, per instructions |

## ⚠️ Known limits

- `climb_slope` always braces the right hand (`chooseContact`'s `s.slopeSide` isn't set by this wave's sense —
  cosmetic only, the brace still lands on the real slope via IK).
- `inspect_ground` / `pick_up` play the crouch/kneel/pickup pose correctly but the hand IK usually has nothing to pin
  to (the chest-height/knee-height probes don't reach ground-level clutter) — no generic "small pickup prop" registry
  exists yet in this game beyond shards/crates, so these two intents are the least precisely grounded of the seven.
- `lean_back` (face-away) only fires when the player is already idle with a rock at their back (the `back` probe) —
  no automatic turn-around is attempted.
- Sense refresh is 5 Hz and 5 raycasts × 2 (top-probe) = up to 10 rays; cheap next to the character controller's own
  raycasts, but not free — kept off (`K.contact=false`) is the A/B lever, same convention as every other knob here.
- `left`/`right`/`back` contacts are placement-only (`ANIMLIB.ContactLayer` itself skips non-hand/foot bones) — the
  shoulder/back leans rely entirely on the `steer` stand-off being accurate, not on a per-frame IK correction.
