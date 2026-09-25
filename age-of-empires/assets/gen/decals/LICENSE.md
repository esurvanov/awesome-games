# assets/gen/decals - derivative materials of 0 A.D.

All files in this folder (and the index `assets/gen/nature_extra.json`) are derived from the models,
animations and textures of the game **0 A.D.** (c) Wildfire Games (<https://play0ad.com/>) and
are distributed under the **CC BY-SA 3.0** license
(<https://creativecommons.org/licenses/by-sa/3.0/>).

What is here: fish, animal carcasses at butchering stages, stumps, ruins, projectiles,
fire, smoke, explosion, water rings.

The material was modified: models rendered into isometric sprites (orthographic
camera at 30 degrees, new lighting and shadows, downscaling), color blended with water depth /
blood / meat, projectiles outlined; particles (`art/textures/particles`)
baked offline into looped frames.

Rebuild: `.venv/bin/python tools/build_decals.py` (needs the raw assets
`assets/0ad_raw/`, see `tools/fetch_0ad.py`). Full credits - `CREDITS.md`.
