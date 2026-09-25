# assets/gen - derivative materials of 0 A.D. and Millennium A.D.

All files in this folder are derived from the 3D models, animations and textures of:

- the game **0 A.D.** (c) Wildfire Games (<https://play0ad.com/>), license **CC BY-SA 3.0**;
- the **Millennium A.D.** mod (<https://github.com/0ADMods/millenniumad>), graphics (`art/`) (c)
  2015 The Council of Modders, Fallen Empire Studio, Scion Development
  (<http://www.wildfiregames.com/>), license **CC BY-SA 3.0** (the mod's `art/license.txt`).

License: <https://creativecommons.org/licenses/by-sa/3.0/>. The files are distributed under the same
CC BY-SA 3.0 license. The mod's code (GPL-2.0) and its music are not here.

The material was modified: models rendered into isometric sprites (orthographic
camera at 30 degrees, new lighting and shadows, downscaling), a player-color mask added,
ground textures projected into isometric tiles; buildings and walls assembled from
parts of different sets, docks rendered in four rotations, construction stages made
from 0 A.D. foundations and scaffolding.

Units (`units/`): skeletal animations baked into frames (walking, working, attacking,
dying, 8 directions), models assembled from parts, mirrored horizontally,
the palette reduced to 256 colors. Rebuild: `.venv/bin/python tools/build_units.py`.

Unit ranks (militia -> champion, mounted scout -> hussar, knight -> paladin, etc.) are assembled
from variants, helmets, shields, armor textures and horse armor/blankets of 0 A.D. and Millennium A.D.
Firearms (arquebus, hand cannon, powder keg), the halberd, a bombard on a carriage and the cannons on a galleon's sides
are procedural models (`tools/render3d/procmesh.py`) with textures cut from the 0 A.D. weapons
atlas (`art/textures/skins/props/prop_weap.dds`, CC BY-SA 3.0, (c) Wildfire Games).
The clothing of bodies is recolored (tabards, surcoats, aprons, stoles, robes in "player color + white",
`tools/render3d/paint.py`), the crests of the kite shields are drawn over Millennium A.D.'s `kite_chiro_white.png`;
the procedural two-handed sword, katana, helmets (chapel de fer, bucket, kabuto, morion),
plume, ram head, player-color beams, lateen sail, awning, galleon superstructures, barrels and siphon are
derivative works under CC BY-SA 3.0 (details - CREDITS.md).

Which model comes from where - the `actor` field in `atlas.json` and `units/index.json`
(`units/<set>.json` does not store paths; the actor is in the index). Actors from the folders `carolingian`,
`caro`, `anglo`, `norse`, `rus`, `byzantines`, `umayyads` come from Millennium A.D., the rest from 0 A.D.

Rebuild: `.venv/bin/python tools/build_sprites.py` (needs the raw assets
`assets/0ad_raw/` and `assets/millenniumad_raw/`, see `tools/fetch_0ad.py`,
`tools/fetch_millennium.py`). Full credits - `CREDITS.md`, license summary - `docs/licensing.md`.
