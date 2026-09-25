# assets/gen/maps - derivative materials of 0 A.D.

The files in `terrain/`, `trees/`, `animals/` (and their entries in `maps.json`) are derived from the models and
textures of the game **0 A.D.** (c) Wildfire Games (<https://play0ad.com/>) and are distributed under the
**CC BY-SA 3.0** license (<https://creativecommons.org/licenses/by-sa/3.0/>).

What is here: ground tiles for map landscapes (desert, steppe, snow, tropics, autumn), the trees of these
landscapes, a wolf (8 directions).

The material was modified: textures brought to an isometric tile, contrast softened and the
average color adjusted; models rendered into isometric sprites (orthographic camera at 30 degrees, new
lighting and shadows), foliage tone shifted.

`relic.png` is drawn by our own script (no third-party graphics).

Rebuild: `.venv/bin/python tools/build_map_assets.py` (needs the raw assets
`assets/0ad_raw/`, see `tools/fetch_0ad.py`). Full credits - `CREDITS.md`.
