# Project licenses - summary

| Part | Where | License / rights holder |
|---|---|---|
| The code of "Chronicles of Kingdoms" | `main.py`, `game/`, `tools/` | the original code of this repository's authors; not derived from the code of 0 A.D. or its mods |
| Sprites of buildings, walls, nature, ground; unit frame sheets | `assets/gen/` | **CC BY-SA 3.0** - derived from 0 A.D. (c) Wildfire Games and Millennium A.D. (c) The Council of Modders, Fallen Empire Studio, Scion Development (`assets/gen/LICENSE.md`) |
| Interface graphics (buttons, frames, portraits, icons, cursors) | `assets/ui/` | **CC BY-SA 3.0**, derived from 0 A.D. (c) Wildfire Games (`assets/ui/LICENSE.md`) |
| Music, sounds, voices | `assets/audio/` | **CC BY-SA 3.0**, derived from 0 A.D. (c) Wildfire Games (`assets/audio/LICENSE.txt`, `manifest.json`) |
| Linux Biolinum, GNU FreeSans fonts | `assets/fonts/` | GPL v3+ with the font exception (the `*-LICENSE.txt` files next to them) |
| Raw assets of 0 A.D. and Millennium A.D. | `assets/0ad_raw/`, `assets/millenniumad_raw/` | not stored in git; downloaded by `tools/fetch_0ad.py`, `tools/fetch_millennium.py` |

## Millennium A.D.

- The mod's graphics (`art/`) are **CC BY-SA 3.0** (the mod's `art/license.txt`), the same license as
  the 0 A.D. graphics, so parts of both sources can be assembled into one sprite; the result is
  CC BY-SA 3.0 with attribution to both rights holders.
- The mod's code is GPL-2.0 (`License.txt` in the mod's root): **not used**. The mod's music is not used.
- There is no GPL-2.0 graphics in the project. If any ever appears, sprites derived from it
  will be distributed under GPL-2.0-or-later; the project's sources are open in this repository.
- Medieval A.D. is not used (it is unclear which of its two stated licenses applies to the graphics).

## Attribution in the game

The line in the main menu: "Art and sound: 0 A.D. (c) Wildfire Games; Millennium A.D. (c) The Council of
Modders, Fallen Empire Studio, Scion Development; CC BY-SA 3.0". The full credits and links to the licenses are in
`CREDITS.md`.

The CC BY-SA 3.0 license: <https://creativecommons.org/licenses/by-sa/3.0/>.
