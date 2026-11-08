# 🧬 ARCH-MODEL — the data model and where it lives

The game's code is organised by **what the things are**, not by which file happened to draw them. Six entities; every module below is the owner of one of them.
Nothing here changed what the game does: the save format, the story, the AI layer and every old name (`fox`, `STAGS`, `enemies`, `boss`, `player`, `G`, `WORLD`…) work as before.
How we got here: `docs/architecture/refactor-plan-model.ru.html`, `docs/architecture/architecture-model.ru.html`.

| Entity | What it is | Owner (file) | One list / one object |
|---|---|---|---|
| 🐾 **Creature** | pilot, Orm, fox, stags, ravens, shardlings, the guardian — the same fields for every kind: `kind · family · controller · x · y · z · yaw · st · hp · group` | `modules/creatures.js` | `Creatures.all()` · `ofKind` · `natives(kind)` |
| 🧱 **Thing** | objects with a state and a part in the story: cutter case, power cell, 3 spires, 24 shards, 8 echo stones, the rift heart, Kestrel, snowmobile, camp fire | `modules/things.js` | `Things.all()` · `get(id)` · `ofKind` · `nearest(kind, x, z)` |
| 🪪 **Passport** | the shared identity of creatures and things: kind, family (13), role, shape, box, who owns the touch | `modules/passport.js`, `modules/contact-core.js` | `Passport.list` · `beings()` · `drift()` · `CORE.familyOf/roleOf` |
| 🌦️ **Scene** | terrain, sky, moon, weather, snow around the camera, horizon, ice | `modules/environment.js`, `terrain.js`, `atmosphere.js`, `worldfill.js` | `WX` · `Environment` |
| 📖 **Progress** | the run: stage, items, shards, echoes, cleared zones, deaths, time, ending — saved (`eor-save`) | `modules/progress.js`, `story-data.js`, `ending.js` | `G.progress` (11 keys) · `Progress.record/restore` |
| 🎮 **Player** | the human's side: input, camera, climb, aim, fire, roll, the cutter in hand — separate from the pilot they drive | `modules/player-control.js` | `Player` |

**Session** (`G.session`, 17 keys: mode, pause, screen, riding, death/rest/ending timers, sky intensity…) is never saved. `G` itself is one object over the two stores, so `G.stage` and `G.riding` read as ever.
**Processes** work on the data and keep none of their own: the AI layer (`ai.js`: director, hints, quality, preload, Orm talk), physics, the world's placement at start, loading, graphics settings.

## What each entity guarantees (and the gate checks)

* **Creature** — every kind answers to `x, y, z, yaw, st, hp, group`; the rules other modules used to repeat per kind (what presses into snow, bends grass, casts a shadow, breathes, counts as «animals near», is «in combat») are in one table in `creatures.js`. Probe: each rule equals the old per-kind code, same list in the same order.
* **Controller** — who steers a creature: `player` · `story` (Orm, the guardian) · `rules+ai` (fox, stags, shardlings) · `flock` (ravens). The AI layer's advice is asked in one place, `Controllers.intent(native)`; no advice → the plain rules.
* **Thing** — each has `id, kind, family, position, state` (`closed/open`, `placed/taken`, `waiting/taken`, `unread/read`, `sealed/rising/gone`, `wrecked/flying`, `locked/ready/ridden`, `lit`). The stage targets, the fox's shard search and the ending read things from here.
* **Save** — each owner registers what it writes into the record and what it does with a loaded one: `Progress.persist(key, { save, load, order })`. Order: 10 flags (fox, snowmobile, guardian) · 20 the world's things · 30 heart and sky after an ending · 40 health · 50 the pilot's spot. The record keeps its v1 shape and key order.
* **State** — every key of `G` is progress or session; the gate fails on a key that is neither, and on a session key in the save.

## How to add…

* a **creature kind** — give it a row in `ACC/FILL`, `CTL` and `sources` in `creatures.js` (fields, controller, where its objects live) and a family regex in `contact-core.js`; the consumers pick it up.
* a **thing** — one `add(...)` line in `things.js`; if it survives a save, a `Progress.persist(...)` next to it.
* something to **save** — `Progress.persist('key', { save, load, order })` in the module that owns it; nothing in the page.
* an **AI intent** for a creature — nothing to wire: the kind's update already asks `Controllers.intent(self)`.

## The big modules, split without changing a line

Four modules grew past a thousand lines and mixed several jobs. Each was cut along its own section banners; every block was moved **verbatim**
(`tools/refactor/extract.py` moves a block and leaves a factory call in its place; the script checks that the text is unchanged), names the blocks share are
passed in as dependencies or handed over later by `bind()` (a name declared further down, or assigned in `init`: `C`, `V3`, `THREE`…).

| Was | Now (the first file is the glue: `init`, `update`, the exports) |
|---|---|
| `interaction.js` (1751) | `interaction.js` 243 · `interaction-body.js` (gait, lean, look, arms) · `interaction-contact.js` (lean on a rock, a hand on a surface) · `interaction-ground.js` (steps, landing, branches, props, ice) · `interaction-camera.js` · `interaction-tests.js` · `animal-gait.js` (stags and fox) |
| `structures.js` (1409) | `structures.js` 272 · `structures-camp.js` · `structures-landmarks.js` · `structures-creatures.js` · `structures-snowmobile.js` · `structures-wreck.js` |
| `physbody.js` (699) | `physbody.js` 287 · `physbody-ragdoll.js` · `physbody-tests.js` |
| `rock-brain.js` (1080) | `rock-brain.js` 772 · `rock-brain-needs.js` · `rock-brain-squeeze.js` · `rock-brain-checks.js` (the fitting block stays: it shares the mutable `RELAX` flag with the automaton) |

Rule for the next cut: a block that assigns a `let` of the source module either keeps it (the block stays) or gets a private copy (a scratch value only);
`extract.py` prints `private copies` and `PROBLEMS` — read them.

The pilot's mode is one word, `Player.mode` (`dead · ride · climb · roll · walk`); `Player.board()` / `Player.leave()` are the only writers of «riding».

## Safety net

`tools/refactor/gate.sh <label> [--quick|--collide]`: unit tests of the save and state (`progress.test.mjs`), the AI layer's own offline tests, a snapshot of the Passport against `baseline/base.json`, 17 behaviour probes (`behaviours.mjs`), the whole story to both endings with 13 save-compatibility cases (`tools/autoplay.mjs`), optionally the collision net against `baseline/collide-base.json`. A flaky machine can fail the snapshot or the first story step: the gate retries once.
Known, older than the data model: the placement of structures (echo stones, Kestrel's parts, ruins, scanned rocks) differs a little between identical runs, so the snapshot compares those by name and count only.
