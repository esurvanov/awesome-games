# 🧱 ARCH-CORE — physical models + contact pairs

Why: pilot × rock gave "body hangs off · sinks in · hands buried · static" because no one owns the final pose. Each wave patched one
module's numbers (see ARCH-INTERACT.md). Root causes → the fix that closes each one forever.

## Root causes → where they are closed

| # | Root cause | Closed by |
|---|---|---|
| 1 | Two bodies: physics capsule ≠ drawn suit | `BodyModel` is the ONLY source of body shape; capsule built from it (done: ellipse in physics.js; remaining: toes) |
| 2 | Pose taken from a clip made for an ideal wall | `ContactPair` fits the pose to the real surface (stand spot, torso, arms solved together) |
| 3 | No owner of the final pose | One `ContactPair` per active contact: decides torso + limbs together, others only request/apply |
| 4 | Solver corrects after the fact, hands do not follow torso | pair solver moves torso and re-targets limbs in the same step |
| 5 | Three definitions of "inside" | `BODYCONTACT` (done) |
| 6 | Needs typed twice | needs derived from clip meta (done in rock-brain) |
| 7 | Legs / toes not in any correction | `BodyModel.parts` has legs; the pair declares them "must clear" |
| 8–11 | Static poses, no variety | `Variation` layer on top of the pair (state-driven: fatigue, cold, approach speed; pool of clips per pair) |

## Layers (a model per physical kind; shared interfaces, no shared guts)

```
Core (interfaces only)      Surface.query(p) · Surface.patch(p) · Affordances(p) · Body.parts() · Body.reach()
├─ RockModel                drawn + collision shape together; patches (wall / top / gap / slope)
├─ BodyModel                BODYSPEC + BODYCONTACT: parts, radii, must-touch / must-clear lists
├─ SnowModel / IceModel     depth, grip, footprints   (later)
├─ TreeModel / AnimalModel  own shapes, own reactions (later, old paths until then)
└─ ContactPair              (BodyModel part) × (Surface patch) → pose request with a measured error; one law per pair kind
      wall_palm · wall_back · wall_shoulder · ledge_hands · seat · foot_on_slope · …
Physics                     moves the position only; its capsule comes from BodyModel
PosePipeline                the only skeleton writer; applies pair results
Judge                       BODYCONTACT, independent
```

Interfaces are plain objects on `window` (`CORE.surface`, `CORE.body`, `CORE.pairs`), documented in the module header,
so a module never reaches into another's state.

## Order of work

1. ✅ BODYCONTACT, capsule from BodyModel, needs from clip meta.
2. `ContactPair` for wall_palm (hand_wall_*, brace_slope): torso pull + palm re-target in ONE step, measured on BODYCONTACT. ← now
3. wall_back / wall_shoulder / ledge_hands / seat as pairs. Legs and toes: "must clear".
4. `Variation` layer + the six unused clips.
5. Gallery frames + the user's marks (human verdict outranks numbers).

## Object families (modules/contact-core.js, 2026-10-01) — all 47 passport kinds have a family

| Family | Kinds | Owner | Status |
|---|---|---|---|
| stone | rock · rock_flat · rock_outcrop · boulder (6) | rock-brain | owned |
| ruin | st_ruin_arch/column/wall · st_cairn · st_inuksuk (5) | rock-brain (NEW: was rocks only; not yet checked on frames) | owned |
| tree | tree_* (9) | interaction (trunk) | generic |
| prop | barrels · crates · tool_crate · firepit (6) | interaction (push) | generic |
| structure | station_* · struct_* · tents · poles · sledges · lamp_post (13) | interact (passport mediator) | generic |
| vehicle | kestrel* · snowcat · rover (5) | open-world | owned |
| crystal | spire* (3) | — | none |

One family list instead of five copied regexes (rock-brain, interaction, physics slim test). New kind of object = `CORE.register({...})`.
Scaling rule: a family goes from `generic` to `owned` when it gets a model with the same contract as the stone one (read the surface →
choose an affordance → a ContactPair from `CORE.PAIRS` → pose request), and the judge (BODYCONTACT) measures it with the same table.
