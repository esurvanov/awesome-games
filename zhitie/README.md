<div align="center">

🇬🇧 **English** · [🇷🇺 Русский](README.ru.md)

# Zhitiyo (Житьё)

**A browser-native life-simulation game in the spirit of The Sims 1 — isometric 3D low-poly, a whole neighbourhood of households, needs, careers and relationships. No install, no build.**

[![Play in browser](https://img.shields.io/badge/▶_Play_in_browser-esurvanov.github.io-D7263D?style=for-the-badge)](https://esurvanov.github.io/awesome-games/zhitie/)

[![three.js](https://img.shields.io/badge/three.js-WebGL-000000?logo=threedotjs&logoColor=white)](#-under-the-hood)
[![Vanilla JS](https://img.shields.io/badge/vanilla-JavaScript-F7DF1E?logo=javascript&logoColor=black)](#-run-it-yourself)
[![Code: MIT](https://img.shields.io/badge/code-MIT-yellow)](LICENSE)
[![Assets: CC0](https://img.shields.io/badge/assets-CC0-EF9421)](CREDITS.md)
[![No build step](https://img.shields.io/badge/build-none-2ea44f)](#-run-it-yourself)

<img src="docs/screenshots/home.jpg" alt="A household in Zhitiyo: two sims inside their furnished house, needs panel and interaction menu on screen" width="100%">

</div>

Move into **Berёzovaya Roshcha** (Birch Grove), a small neighbourhood of ten households, a park, a café, a shop, a gym and a library. Take control of a family, keep everyone fed, rested and happy, hold down a job, build friendships and romances, furnish and extend the house room by room — all rendered in low-poly 3D with a fixed isometric camera, the classic four-rotation view.

This is an original mechanics clone, built from scratch: no Sims/EA trademarks, art, music or UI — its own visual language (a green halo over each sim instead of a diamond) and its own gibberish speech.

## ✨ Features

| | | |
|---|---|---|
| 🏘 **A living neighbourhood** — 10 households you can move between, from newlyweds to a family of five, plus shared lots: park, café, shop, gym, library | 🧠 **Needs & mood** — hunger, energy, hygiene, bladder, fun, social, room and comfort drive what a sim wants to do next | 💼 **Careers & skills** — 10 career tracks, promotions, six skills that grow with practice |
| 💞 **Relationships** — friendships, romances, secret affairs, family feuds; 86 social interactions | 🛋 **Buy & Build modes** — 38 furniture pieces across styles, walls, floors, doors, windows, multiple floors and roofs | 🌗 **Day/night cycle** — adjustable game speed, a full in-game clock |
| 🎥 **Classic isometric camera** — 4 rotations × 3 zoom levels, cutaway walls | 🎨 **Low-poly 3D, CC0 all the way** — every model and animation under CC0 | 📱 **Runs in any modern browser** — plain ES modules, `three.js` via CDN import map, nothing to install |

## 📸 Screenshots

| The neighbourhood | Inside the house |
|---|---|
| ![Neighbourhood map](docs/screenshots/neighborhood.jpg) | ![House interior](docs/screenshots/home.jpg) |

## 🎮 Controls

Point-and-click, like the games it takes after: click a sim or an object to open a radial menu of actions, click a tile to walk there.

| | Key |
|---|---|
| Switch Live / Buy / Build | `F1` / `F2` / `F3` |
| Pause / resume | `P` |
| Game speed | `0`–`3` |
| Cycle through household members | `Space` |
| Rotate / zoom camera | drag / wheel, or the on-screen controls |

## 🚀 Run it yourself

The game is static files — no dependencies and no build step; `three.js` loads from a CDN via an import map.

```bash
./serve.sh        # then open http://localhost:8123
```

Opening `index.html` directly does not work — ES modules require a server.

## 🧪 Tests

```bash
npm test                       # pure logic, node --test
npm i && node tests/ui-shot.mjs  # Playwright, browser + screenshots
```

## 🛠 Under the hood

| File | What it does |
|---|---|
| `js/sim/*`, `js/core/tuning.js` | needs, mood, action choice, queueing, time, money, jobs, skills, relationships, social interactions |
| `js/world/*` | lot grid, walls on edges, floors, doors/windows, object placement, rooms, A* pathfinding |
| `js/render/*` | three.js scene, isometric camera, day/night lighting, cutaway walls, animated sims, object picking |
| `js/ui/*`, `js/audio/*` | bottom panel, need bars, radial menu, queue, mode switching, catalog, clock, money, notifications, sound |
| `data/*` | item catalog, careers, social interactions, wants, the neighbourhood and its households |

## 📜 Licence

Code — MIT, see [LICENSE](LICENSE). Assets — CC0, credited in [CREDITS.md](CREDITS.md).
