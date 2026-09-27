# WorldFill — world dressing for `open-world.html`

Everything is generated procedurally: no new assets, only the existing `TX` snow and rock textures. Wired into `open-world.html` (three r186, linear color pipeline — see FOUNDATION.md). Colliders come from the drawn geometry through `ctx.register` (no hand-typed radii).

| File | What it is |
|---|---|
| `worldfill.js` | the module: `window.WorldFill = { build(ctx, knobs?), update(dt, ctx?), knobs, stats }` |
| `worldfill-demo.html` | test bench: the game's real island + sky + WorldFill, free camera, presets |

## What's added

| # | System | Content | Calls |
|---|---|---|---|
| 1 | 🏔 Horizon | 3 ridge rings (R≈1330 / 1700 / 2080 m) with ridge-noise silhouettes, massifs and gaps; snow by height and slope, gullies, moonlit rim, aerial haze, faint aurora tint; still dimly visible in a blizzard | 1 |
| 2 | 🧊 Sea ice | 14 tabular icebergs (24–60 m, calved notches), ~30 medium and ~44 small icebergs, 150 floes, 12 pressure ridges, ~110 snow drifts, snow banked along the shoreline; glacial-blue shader with a translucent look (backlight + fresnel) and snow on top faces | 1 |
| 2 | 🌊 Open-water leads | 20 crack systems with branches: dark water, sky/aurora reflection, moon glint, refrozen-ice rim | 1 |
| 3 | 🌾 Ground clutter | grass, shrubs, pebbles and snow pillows, ice shards (coast / rift rim / lake shore), logs and stumps (in forest areas); within 120 m of the camera, fading out at the edge; grass and shrubs sway in the wind, harder in a blizzard | 5 |
| 4 | 🌫 Mist | 26 valley patches in 2 layers, the lake, the rift, 2 rings over the sea, frost smoke over leads; all drifting | 1 |
| 4 | 💨 Ground snow | 1100 snow streaks around the camera, driven entirely on the GPU; gusty, much stronger in a blizzard | 1 |
| 4 | ☁ Clouds | a sparse cloud deck at 440 m, thicker in a blizzard | 1 |
| 5 | ⛺ Camp | 3 tents (one standing, one half-collapsed, one flat), a snowed-in snowcat, crates, fuel drums, a sledge, a fire ring, a radio mast | ⤵ |
| 5 | ⚡ Power line | poles from the station to the camp: sagging wires, one fallen pole, one broken wire | ⤵ |
| 5 | 🚢 Shipwreck | a lofted hull locked in the ice, heeled, with a hole and exposed ribs, deck, deckhouse, masts, rigging, snow drifts and ice rubble | ⤵ |
| 5 | 🏛 Ruins | 4 sites: arches (some broken, with fallen stones), colonnades, a fallen column, paving slabs, faintly glowing glyphs | ⤵ |
| 5 | 🗿 Cairns | about 16: on hilltops and at the middle of each route | ⤵ |
| 5 | 🚩 Trail markers | flags on poles along the routes, fluttering | 1 |
| 5 | 🛶 Pier | a pier on the lake (gaps, missing and broken boards) and a rowboat frozen in beside it | ⤵ |
| 6 | 🐦 Birds | 5 flocks × 13 circling high up; 10 ravens perched on masts, cairns, arches and poles that take off when the player comes near and return later | 1 |

⤵ = all structures are merged into **2 meshes**: stone (textured with the game's `patchSurface`) and wood/metal/fabric (weathering, planks, snow on top faces, glowing glyphs).

**Totals:** 15 draw calls + 3 shadow (stone, structures, logs) · 381k triangles at most, with every clutter pool full · colliders = exact triangles of each structure within the reachable radius (<452 m), registered through `ctx.register`.

## Keeping clear of POIs and routes

- `nearPOI` safety margins: camp +26 m, ruins +22, cairns +14, power poles +3; clutter stays out of POI cores.
- `inRift` margins: camp 30, ruins 22.
- Routes (crash→station, crash→lake, lake→spireW, station→spireE, station→spireN, crash→rift edge): camp ≥18 m from them, ruins ≥14 m, cairns ≥5 m; trail markers stand 3.2 m to the side and have no collider.
- Sea-ice objects only go where the sea is confirmed across their whole footprint; the reachable ring keeps floes low (≤0.3 m) and drifts ≤0.35 m.
- Deterministic: WorldFill uses its own seeded RNG (`knobs.seed`) and does **not** consume the game's `srand` sequence, so later game placements (enemies and so on) don't shift.

## `ctx` — required fields

| Field | Used for |
|---|---|
| `THREE` `scene` `camera` | everything |
| `getH` `normalY` `W` `POI` | placement; `POI.*.h` from `flatAt` (lake, station) |
| `riftD` `nearPOI` `inRift` | exclusion zones |
| `fbm` `vnoise` `ridge` | mountain / iceberg / clutter noise |
| `register(src, role, opts)` | colliders: the page's `Passport.register` (FOUNDATION.md). Each structure registers its own drawn triangles (`scope()` in worldfill.js); wires, guy lines and snow drifts are passable |
| `T()` | time getter, e.g. `() => T` |

**Optional:** `storm()` (0…1, default 0) · `patchSurface` (without it, stone uses plain material) · `TX` (`snow`, `rock` for snow and weathering) · `FOG` · `MOON_DIR` · `aurora()` → `{ color, i }` (aurora reflections and tint) · `player()` → `{x,z}` (ravens react to the player instead of the camera).
Accepted but unused: `groundH`, `CELL`, `srand`, `srange`, `glow`, `emit`, `renderer`.

Assumption: the station faces the crash site (`atan2(crash − station)`, as in `places()`), and its mast stands at local (−9, −6); the first power span attaches to it.

## Integration

```html
<!-- after the three.js <script> tags -->
<script src="worldfill.js"></script>
```

```js
// right after places() (the "places" IIFE)
WorldFill.build({
  THREE, scene, camera, renderer, getH, groundH, normalY, W, CELL, POI, riftD, nearPOI, inRift,
  srand, srange, fbm, vnoise, ridge, register: Passport.register, patchSurface, TX, glow, emit, FOG, MOON_DIR,
  T: () => T, storm: () => WX.storm,
  aurora: () => ({ color: aurA, i: skyU.uInt.value }),
  player: () => player,
});

// at the end of updateWorld(dt)
WorldFill.update(dt);
```

`T` and `WX` are declared further down the file. That's fine: the getters are only read inside `update`.

## Performance

| Metric | Value |
|---|---|
| Build | ~0.2 s in the browser (M1 Pro) · ~0.6 s in Node |
| Frame, full view of the camp | 7.23 → **+0.87 ms** (2646×1499, M1 Pro) |
| Frame, open landscape | 7.41 → **+1.6 ms** |
| Draw calls in view | +13…15 main + 3 shadow |
| `update()` | ~0.1 ms average, **≤1.3 ms** worst case when crossing a cell (walking or skimmer) |
| Memory | clutter cell cache ≤2500 cells, then cleared |

Mountain triangles are counted in full (all 3 rings), though only ~¼ of them are in view.

## Knobs (`WorldFill.build(ctx, { ... })` or `WorldFill.knobs`)

| Knob | Default | What it does |
|---|---|---|
| `mountains` `seaIce` `leads` `sites` `clutter` `mist` `gusts` `clouds` `birds` | `true` | turn each system on or off |
| `shadows` | `true` | structures and logs cast shadows (+3 calls) |
| `density` | `1` | clutter density (0.5 for weak GPUs) |
| `clutterR` / `clutterFade` / `clutterCell` | 120 / 26 / 16 m | clutter radius, fade band, cell size |
| `pool` | grass 2600 · shrub 440 · stone 900 · shard 480 · wood 260 | instance caps per pool (= triangle cap) |
| `gustN` / `gustR` | 1100 / 46 m | ground snow streaks: count, radius |
| `wind` | `[1, .18]` | wind direction (the game's snow drifts toward +x) |
| `bergs` | large 14 · medium 30 · small 44 · floes 150 · ridges 12 · drifts 110 | sea-ice amounts |
| `leads` | 20 | open-water leads |
| `birds` | flocks 5 · perFlock 13 · ravens 10 · scare 15 m | birds |
| `mistPatches` | 26 | valley mist patches |
| `mountainSegs` | 960 / 720 / 640 | detail of each ridge ring |
| `seed` | 20260925 | layout |

`WorldFill.stats` → triangles per system, calls, per-step build ms, current clutter instances, and the camp / ship / ruins / pier positions.

## Demo

`python3 -m http.server` → `http://localhost:8000/worldfill-demo.html`
- Controls: drag to look · WASD · Shift · Q/E (with "Пешком" off)
- URL options: `?at=0…6` jumps to a preset (camp, ship, ruins, pier, horizon, shore, station) · `?storm=1` starts in a blizzard
- The top bar shows fps, calls and triangles
