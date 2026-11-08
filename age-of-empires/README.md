<div align="center">

🇬🇧 **English** · [🇷🇺 Русский](README.ru.md)

# Chronicles of Kingdoms

**An open-source medieval RTS in the spirit of Age of Empires II — Python, isometric, license-safe.**

[![Python 3.12+](https://img.shields.io/badge/Python-3.12%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![pygame-ce](https://img.shields.io/badge/pygame--ce-2.5-6DA55F)](https://pyga.me/)
[![Code: MIT](https://img.shields.io/badge/code-MIT-yellow)](LICENSE)
[![Assets: CC BY-SA 3.0](https://img.shields.io/badge/assets-CC%20BY--SA%203.0-EF9421)](CREDITS.md)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](#-quick-start)
[![Languages](https://img.shields.io/badge/UI-7%20languages-blue)](#-features)

<img src="docs/screenshots/hero.jpg" alt="A Frankish lakeside town under attack: half-built palisade scaffolding, a ram among the houses, siege engines on the slope, fires, the harbour behind" width="100%">

</div>

Build a village in the Dark Age, wall it, raise a castle, research your way to the Imperial Age and break the enemy with trebuchets — against up to 7 AI players, on six DE-style random maps, with 14 civilizations. Rules and numbers follow the classic game closely; every sprite, sound and note comes from open projects (0 A.D., Millennium A.D.) or our own procedural work.

## ✨ Features

| | | |
|---|---|---|
| 🏰 **14 civilizations** — unique units, unique techs, team bonuses | 🕰 **4 ages** — Dark · Feudal · Castle · Imperial | 🌳 **Full tech tree** — 130+ technologies, F5 in-game |
| ⚔️ **75+ unit types** — infantry, archers, cavalry, siege, monks, ships | 💰 **Economy** — market trade, trade carts, relics, farms | 🧱 **Walls, gates, towers, garrison** — repair, eject, ring the bell |
| 🎖 **Formations & stances** — line, box, staggered, flank · aggressive → no attack | 🚢 **Naval warfare** — docks, fishing, transports, galleys, fire ships | 🗺 **6 random maps** — Wasteland, Walled Court, Thicket, Nomad, Archipelago, Inland Sea |
| ⛰ **Landscapes** — hills, cliffs, shallows, 6 biomes | 🤖 **AI** — 6 difficulty levels, Easiest → Extreme | 👥 **Up to 8 players**, teams, diplomacy, chat, minimap flares |
| 💾 **Save / load** — slots + quick save (F7/F8) | 📊 **Post-game statistics** — 6 tabs, timeline chart | 🌍 **7 UI languages** — en, ru, de, fr, es, pt-BR, it |
| 🎨 **Art** — 3D models pre-rendered to isometric sprites + procedural icons | 🎵 **Soundtrack & voices** — from 0 A.D., plus procedural medieval pieces | 🖥 **1280×800 window**, wheel zoom ×0.6–1.6 |

## 📸 Screenshots

| Main menu | Skirmish lobby |
|---|---|
| ![Main menu](docs/screenshots/menu.jpg) | ![Lobby](docs/screenshots/lobby.jpg) |
| **Byzantine town** | **Open-field battle with siege** |
| ![Town](docs/screenshots/town.jpg) | ![Battle](docs/screenshots/battle.jpg) |
| **Archipelago: fleet and dock** | **Hills, a rocky ridge and groves** |
| ![Naval](docs/screenshots/naval.jpg) | ![Hills](docs/screenshots/hills.jpg) |
| **Tech tree** | **Post-game statistics** |
| ![Tech tree](docs/screenshots/techtree.jpg) | ![Statistics](docs/screenshots/stats.jpg) |

## 🚀 Quick start

**macOS** — double-click `Play.command` (creates a venv and installs dependencies on first run).

**All platforms:**

```bash
python3 -m venv .venv
.venv/bin/pip install pygame-ce numpy        # Windows: .venv\Scripts\pip
.venv/bin/python main.py                     # Windows: .venv\Scripts\python main.py
```

| Requirement | |
|---|---|
| 🐍 Python | 3.12 or newer |
| 📦 Packages | `pygame-ce`, `numpy` (numpy: procedural sound; the game is silent without it) |
| 🧠 RAM | 4 GB |
| 💽 Disk | ~300 MB (assets ≈ 210 MB + venv) |

## 🌐 Play in the browser

The whole game also runs in a browser as a plain static site: no server code, no build step, no install.
The browser version lives in `web/` (JavaScript ES modules, Canvas 2D, Web Audio, saves in IndexedDB) and reads the same `assets/`.

| Where | How |
|---|---|
| 💻 Locally | from the repository root: `python3 -m http.server 8000`, then open <http://localhost:8000/web/> (any static server works: `npx serve`, nginx, …) |
| 🌍 GitHub Pages | Settings → Pages → *Deploy from a branch* → `main`, folder `/ (root)`; the game is at `https://<user>.github.io/<repo>/` (redirects to `web/`) |
| 🗂 Any static hosting | upload the repository as is (at least `web/`, `assets/`, `CREDITS.md`, `index.html`, `.nojekyll`) and open `web/` |

| Note | |
|---|---|
| 📂 `file://` | does not work: browsers block ES modules from local files, so use any static server |
| ⏳ First start | downloads ≈ 65 MB (UI, terrain, buildings, portraits); unit sprites and music stream in as needed |
| 💾 Saves, settings | stay in this browser (IndexedDB), separate from the Python version's `~/.cache/khroniki` |
| 🧪 Checks | `node --test web/tests/test_*.mjs` (logic vs CPython, incl. a lockstep AI-vs-AI match) · `node web/tests/e2e.mjs` (headless Chromium: menu → skirmish → build → save/load → settings → exit) |

## 🎮 Controls

| Keys | Action |
|---|---|
| **LMB** / drag · double-click | select · all of the same type on screen (max 60) |
| **RMB** | move · gather · build · attack · garrison (Alt+RMB into a building) |
| **Q W E R T / A S D F G / Z X C V B** | command-panel grid (villager: **Q** economy, **W** military buildings) |
| **Shift** + build / train / order | several foundations · 5 units · queue orders (waypoints) |
| **Ctrl+1…9** · **1…9** · **Shift+1…9** | assign group · select (tap twice → camera) · add to selection; Alt → groups 10–19 |
| **H** · **Ctrl+B/A/L/K/D/Y/C/M/S/U/N/E/I/T** | town center · jump to barracks, archery range, stable, siege workshop, dock, monastery, castle, market, blacksmith, university, mill, lumber/mining camp, tower |
| **.** · **,** · **Space** · **Backspace** · **Home** | idle villager · idle military · go to selection · previous view · last event |
| Army panel | patrol · guard · follow · attack-move · attack ground · stances (aggressive / defensive / stand ground / no attack) · formations (line / box / staggered / flank) |
| **Tab** / Ctrl+wheel · **Delete** | rotate gate while placing · delete unit (Shift+Del: all selected) |
| Arrows / screen edge · **wheel** · **+ / −** | scroll camera · zoom · game speed |
| **F1 F2 F3 F4 F5** | help · civilization card · pause (also P) · score · tech tree |
| **F7 F8 F10 F11** · **Enter** · **Alt+F** | quick save · quick load · game menu · clock · chat · flare on minimap |
| **M** · **N** · **Esc** | music · sound effects · cancel order mode / close window |

All keys can be remapped: *Settings → Hotkeys*.

## 🎯 How faithful is it?

Measured against Age of Empires II: Definitive Edition, quantum by quantum — see [docs/research/00_summary.md](docs/research/00_summary.md).

| Area | Checked | ✅ exact | ⚠️ partial | ❌ missing |
|---|---|---|---|---|
| Controls | 82 | 70 | 8 | 2 |
| Menus | 55 | 38 | 14 | 0 |
| HUD panels | 80 | 67 | 9 | 3 |
| Graphics | 48 | 15 | 19 | 13 |
| **Total** | **265** | **190 (72 %)** | **50 (19 %)** | **18 (7 %)** |

Round 2 (blind recognition tests): all 6 maps recognised from their overview, icons 57 %, units 28 % exact / 49 % by line — the [work queue](docs/research/00_summary.md) is open.

**Not there yet:** campaigns · multiplayer (the button says "soon") · 16-direction unit animations · unit outlines behind buildings · relic victory. Only 6 of DE's biomes; icons, cursors, emblems, voices and menu art are our own, not copies.

## 🏗 Architecture

- **Simulation** — `game/world.py` (players, resources, pathing, projectiles, fog), `game/content/*` (units, buildings, techs, civs as data), `game/orders.py`, `game/defense.py`, `game/naval.py`, `game/terrain.py`, `game/market.py`, `game/relics.py`.
- **AI** — `game/ai.py` + `eco_ai.py` / `ai_army.py` / `ai_war.py` / `ai_defense.py` / `naval_ai.py`: age plans per difficulty, villager allocation, timed attacks.
- **Rendering pipeline** — `tools/render3d/` renders 0 A.D. / Millennium A.D. 3D models headlessly (moderngl) into isometric sprite atlases with player-colour masks; `game/sprites3d.py`, `terrain_gfx.py`, `wallgfx.py`, `gfx.py` draw them, falling back to procedural graphics if atlases are missing.
- **UI** — `game/ui.py` (game loop), `hud.py`, `hud_windows.py`, `controls.py`, `menu.py`, `lobby.py`, `screens.py`, `settings_ui.py`, `uiskin.py`; hotkeys in `game/keymap.py`.
- **Audio** — `game/sound.py`, `music.py`, `playlist.py`, `synth.py` (procedural sound/music via numpy).
- **Tools & research** — headless screenshot scripts, blind tests and DE-parity reports in `tools/` and `docs/research/`.

### Tests

Headless, plain scripts — exit code 0 means pass:

```bash
export SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy
for t in army_test civ_test controls_test menu_test relic_wolf_test terrain_test test_defense test_naval ui_flow_test; do
  .venv/bin/python tools/$t.py || echo "FAIL $t"
done
```

Benchmarks and checks: `tools/ai_bench.py`, `tools/draw_bench.py`, `tools/civ_balance.py`, `tools/eco_check.py`.

### Rebuilding assets

Raw 0 A.D. / Millennium A.D. files are **downloaded, not stored** (`assets/0ad_raw/`, `assets/millenniumad_raw/` are git-ignored); the generated sprites in `assets/gen/`, `assets/ui/`, `assets/audio/` are committed.

```bash
.venv/bin/pip install pillow moderngl                 # extra deps for the pipeline
.venv/bin/python tools/fetch_0ad.py                   # pinned commit, curated subset
.venv/bin/python tools/fetch_millennium.py
.venv/bin/python tools/build_sprites.py               # buildings, nature, terrain → assets/gen/
.venv/bin/python tools/build_units.py                 # animated units → assets/gen/units/
.venv/bin/python tools/build_map_assets.py            # biomes
.venv/bin/python tools/build_portraits.py tools/build_ui_assets.py tools/build_decals.py
.venv/bin/python tools/build_audio.py                 # sounds, voices, music → assets/audio/
```

## 📜 Credits & licences

- **Code** — [MIT](LICENSE). Not derived from 0 A.D. code.
- **Art, animations, music, sounds** — [0 A.D.](https://play0ad.com/) © Wildfire Games and [Millennium A.D.](https://github.com/0ADMods/millenniumad) © The Council of Modders, Fallen Empire Studio, Scion Development — **CC BY-SA 3.0**, modified (rendered to isometric sprites, re-encoded). Derived files under `assets/` stay CC BY-SA 3.0.
- **Fonts** — PT Serif, Cormorant SC (SIL OFL 1.1); Linux Biolinum, GNU FreeSans (GPL with font exception).
- Full attribution and per-folder licences: [CREDITS.md](CREDITS.md) · [docs/licensing.md](docs/licensing.md).

> **Trademark notice.** Chronicles of Kingdoms is an independent fan project. It is not affiliated with, endorsed by or sponsored by Microsoft or Xbox Game Studios. *Age of Empires* is a trademark of Microsoft Corporation. No original Age of Empires assets (graphics, sounds, music, text) are used.

## 🤝 Contributing & roadmap

Issues and pull requests are welcome at [Hedgehogues/awesome-games](https://github.com/Hedgehogues/awesome-games/tree/main/age-of-empires). Before a PR: run the test scripts above and keep new art license-compatible (CC BY-SA 3.0 or freer).

| Next | Status |
|---|---|
| Icon dictionary and unit portraits in the DE frame | 🟡 in progress |
| Unit outlines behind buildings, 16-direction animations | ⚪ planned |
| Remaining 5 biomes, solid cliff walls | ⚪ planned |
| Multiplayer, campaigns | ⚪ later |
