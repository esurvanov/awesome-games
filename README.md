<div align="center">

🇬🇧 **English** · [🇷🇺 Русский](README.ru.md)

# Echo of the Rift

**A crashed pilot, a polar island and a glowing rift in the ice — an open-world 3D story game that runs right in your browser. No install, no download.**

[![Play in browser](https://img.shields.io/badge/▶_Play_in_browser-esurvanov.github.io-5B3FD6?style=for-the-badge)](https://esurvanov.github.io/awesome-games/ekho-razloma/open-world.html)

[![three.js r186](https://img.shields.io/badge/three.js-r186-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![WebGL 2](https://img.shields.io/badge/WebGL-2-990000?logo=webgl&logoColor=white)](#-run-it-yourself)
[![Code: MIT](https://img.shields.io/badge/code-MIT-yellow)](LICENSE)
[![Assets: CC0 · CC-BY · MIT](https://img.shields.io/badge/assets-CC0%20·%20CC--BY%20·%20MIT-EF9421)](CREDITS.md)
[![No build step](https://img.shields.io/badge/build-none-2ea44f)](#-run-it-yourself)

<img src="docs/screenshots/camp-night.jpg" alt="The polar station camp at night: a fire, the hermit Orm, a geodesic dome and the northern lights" width="100%">

</div>

Your plane, the «Kestrel», goes down on a nameless polar island under the northern lights. The station AI IRIS wakes you in the wreck. An old hermit, Orm, has lived here alone for eleven years, next to a rift in the ice that sings. Find the cutter, reach the station, take the three crystal spires apart, face what lives in the rift — and choose what the aurora does next.

## ✨ Features

| | | |
|---|---|---|
| 🗺 **Open island, 900 × 900 m** — crash site, polar station, frozen lake, ruins, forest, sea ice, the Rift | 📖 **5 chapters, 2 endings** — dialogue with choices, 8 echo recordings, 24 crystal shards | 🛷 **Skimmer** — call it with T, ride it across the ice |
| 👣 **Snow that remembers** — every boot, hoof and paw presses its own shape into the snow; a roll leaves a trough | ✋ **Contact** — the pilot leans on rocks and walls, braces on slopes, vaults low obstacles | 🦌 **Wildlife** — stags that walk, trot and gallop; a fox that follows you |
| 🌌 **Night that looks like night** — aurora, moon shadows, baked lighting, fog, falling snow | ⚔️ **A little combat** — crystal shardlings and a golem in the Rift | 🤖 **Optional AI** — run the local server and the hermit answers what you type (rules take over offline) |

## 🎮 Controls

| | |
|---|---|
| `W A S D` move · `Shift` run · `Space` jump · `C` roll | `E` interact · `LMB` cutter · `Q` scan · `G` wave |
| `T` call the skimmer · `M` map · `J` journal · `Esc` pause | `Y` talk to Orm · `V` command IRIS (with the local AI server) |

## 🚀 Run it yourself

| | |
|---|---|
| In the browser | open **[esurvanov.github.io/awesome-games/ekho-razloma/open-world.html](https://esurvanov.github.io/awesome-games/ekho-razloma/open-world.html)** |
| Locally | `cd ekho-razloma && python3 -m http.server` → open `http://localhost:8000/open-world.html` |
| With the AI hermit | `node server/server.mjs --page open-world.html --open` with `TYPESAFE_API_KEY=…` in `.env` (never commit it) |
| Bonus | [Northern Rift](../severny-razlom/) — the canyon flyer made first in the same world (also `index.html` here) |

Any desktop browser with WebGL 2. Quality adapts to the machine; on Retina screens the picture is rendered at 1× and scaled.

## 🧩 How it is built

No engine and no build step: one `open-world.html` plus feature modules in `modules/` (terrain and snow, vegetation, atmosphere, structures, interaction, baked light, ground contact). Physics is Rapier with a 2D fallback when WebAssembly is blocked. Models ship as base64 JS packs so the game also runs inside sandboxed pages. The design notes live next to the code (`FOUNDATION.md`, `MODULES.md`, `SNOW-CONTACT.md`, `GROUNDBLEND.md`, …); `tools/` holds the headless test bench, the visual acceptance gate and the autoplay that plays both endings.

## 📸 More

| | |
|---|---|
| ![The pilot at the crash site, the wreck of the Kestrel in the snow](docs/screenshots/crash-site.jpg) | ![The island from above: forest, the Rift and the northern lights](docs/screenshots/rift-overview.jpg) |

## 📜 Licence

Code — MIT ([LICENSE](LICENSE)). Models, textures, animations and reference photos keep their own licences — see [CREDITS.md](CREDITS.md).
