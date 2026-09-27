# Wave-2 feature modules

Game: `open-world.html` (three r186 via importmap → global `THREE`; see FOUNDATION.md). Feature work lives in
`modules/<name>.js`, classic scripts loaded before the game module. Each registers:

```js
(window.GameModules = window.GameModules || []).push({ name, order, init(ctx), update(dt, ctx) });
```

`init(ctx)` runs once at boot (after the world, before the loader finishes); `update(dt, ctx)` every frame after the
game's own updates, before render. A throwing module is disabled; the game keeps running.

`ctx` (MODCTX in open-world.html) exposes internals by reference: THREE, scene, camera, renderer, composer, post, moon,
hemi, aurLight, skyU, FOG, MOON_DIR, QUALITY, Q (active preset object), setQuality, lin, linArr, TX, TU, patchSurface, tex,
MANAGER, ASSET, loadPacked, prepModel, bakeParts, makeAnimator, attach, glow, emit, burst, H, VN, CELL, W, RES, getH,
groundH, normalY, riftD, nearPOI, inRift, POI, RIFT_FLOOR, WORLD, WORLD_TERRAIN, DECOR, FOREST, STAGS, fox, orm, AV, sk,
player, enemies, boss, Passport, PH, CLIMB, cam, keys, pressed, Dialog, INTER, Sound, WX, addFootprint, toast, srand,
srange, fbm, vnoise, ridge, hash2, T (getter), G (getter), mode (getter).

## Rules for every wave-2 agent
- Own only your module file (+ files you create). `open-world.html`: you may ADD fields to the `MODCTX` object and
  nothing else — unless your brief says you own a specific region. `worldfill.js`, `physics.js`: only the agent whose
  brief says so. Re-read a file right before editing it (others edit concurrently).
- Colliders only through `Passport.register(...)` / `registerInstances(...)` with the right role (FOUNDATION.md).
- Colour rules: glTF untouched; albedo textures `SRGBColorSpace`; numeric colours through `lin()`; shaders output linear.
- Models ship as base64 JS packs: `assets/pack/<name>.js` = `(window.__PACK=window.__PACK||{})['<name>']='<base64 glb>';`,
  loaded with `ctx.loadPacked(name, path, cb)`. Textures as .jpg/.png under `assets/`. Never .glb/.bin/.hdr as served files.
- Respect `ctx.Q` quality knobs; register new knobs in `QUALITY` presets if needed (document them).
- Test with `node tools/stand.mjs <label> [--views …]`: all 8 views ≥ 55 fps median on `high`, 0 JS errors, 12/12 loader
  modules, collision tests still pass. Do not kill browser processes you did not start.
- Write `<NAME>.md` next to MODULES.md: what changed, knobs, measurements before/after, screenshots paths.
