<div align="center">

🇬🇧 **English** · [🇷🇺 Русский](README.ru.md)

# Sibiria

**Survive four nights in the Evenki taiga, 1993 — then build a settlement around your hut. A top-down survival and settlement game that runs right in your browser. No install, no build.**

[![Play in browser](https://img.shields.io/badge/▶_Play_in_browser-hedgehogues.github.io-D7263D?style=for-the-badge)](https://hedgehogues.github.io/awesome-games/sibiria/)

[![Canvas 2D](https://img.shields.io/badge/Canvas-2D-E34F26?logo=html5&logoColor=white)](#-run-it-yourself)
[![Vanilla JS](https://img.shields.io/badge/vanilla-JavaScript-F7DF1E?logo=javascript&logoColor=black)](#-under-the-hood)
[![Code: MIT](https://img.shields.io/badge/code-MIT-yellow)](LICENSE)
[![Icons: CC BY 3.0 · ISC · MIT](https://img.shields.io/badge/icons-CC%20BY%203.0%20·%20ISC%20·%20MIT-EF9421)](CREDITS.md)
[![No build step](https://img.shields.io/badge/build-none-2ea44f)](#-run-it-yourself)

<img src="docs/screenshots/night-wolves.jpg" alt="Night in the taiga: a campfire, a hut with a lit window, wolves circling at the edge of the light, northern lights overhead" width="100%">

</div>

January 1993. Mi-8 board 24713 went down on a river bend in Evenkia. You are Lyosha, the radio operator. The radio is smashed, the crew is gone, and the nearest people are days away. Find the old hunters' hut, light its stove, meet the old Evenk Urkachan, drag the injured geologist Vera out of the tail section, and get the radio talking before the taiga wins.

## ✨ Features

| | | |
|---|---|---|
| 📖 **Four chapters** — Wreckage, Urkachan, The Pack, The Signal; twelve found notes, typed dialogue, dry humour | 🔥 **Real cold** — warmth, hunger, frostbite, blizzards; a fire is the only safe place | 🐺 **A hunting pack** — a scout, a circle that tightens, a lunge; wolves fear fire and torches |
| 🏚 **Your hut, upgraded** — chinks, door, workbench, damper; sleep to save | 🏘 **A settlement of your own** — hire hands, build 8 kinds of buildings, climb 4 ages, trade for roubles | 🐻 **A rogue bear** — smashes the smokehouse, steals food, breaks the door |
| 🎣 **Reaction fishing** — grayling, taimen, burbot; every catch has a weight | 🧭 **RTS-style control** — box-select, right-click orders, groups, alarm bell, zoom | 🎧 **All sound synthesised** — wind, howls, footsteps, an adaptive score that follows the danger |
| 🏆 **Four endings** — everyone home, alone, the taiga takes you, a new settlement | 📱 **Phone-ready** — joystick, order mode, pinch zoom, quality auto-tuning | 💾 **3 save slots + autosave** — sleep in the hut to bank progress |

## 📸 Screenshots

| Day at the hut | Your settlers |
|---|---|
| ![Day](docs/screenshots/village-day.jpg) | ![Settlers](docs/screenshots/settlers.jpg) |
| **The hut at dusk** | **Building** |
| ![Inside the hut](docs/screenshots/hut-inside.jpg) | ![Build panel](docs/screenshots/build-panel.jpg) |
| **Urkachan** | **Rescue** |
| ![Dialogue](docs/screenshots/dialog.jpg) | ![Finale](docs/screenshots/finale.jpg) |

| Menu | The final act |
|---|---|
| ![Menu](docs/screenshots/menu.jpg) | ![Act](docs/screenshots/act.jpg) |

## 🎮 Controls

| | Keyboard and mouse | Phone |
|---|---|---|
| Move | `W` `A` `S` `D` | joystick |
| Act (chop, fish, read, talk) | `E` | 🪓 button |
| Fire · eat · trap | `F` · `Q` · `R` | round buttons |
| Workshop · build | `C` · `B` | buttons |
| Sniff out game and finds | `V` | button |
| Select people | drag a box, `Shift` adds, double-click = same type | tap, or the order-mode button |
| Give an order | right-click a tree, ice, wreck, site, enemy or ground | tap while people are selected |
| Alarm / all clear | `H` | button |
| Camera | wheel zoom, middle-drag or screen edge pan, `0` back to the hero | pinch, drag |
| Pause | `Esc` | button |

## 🚀 Run it yourself

The game is static files — no dependencies and no build step.

```bash
cd sibiria
python3 -m http.server        # then open http://localhost:8000
```

Opening `index.html` directly also works.

## 🧪 Tests

```bash
cd sibiria/tests && npm i && node run-all.js
```

Twelve checks with a real browser: smoke runs, real mouse and touch input, save/load round-trip, no overlapping interface on four screen sizes, a 16-scene pixel comparison, and three bot playthroughs.

## 🛠 Under the hood

| File | What it does |
|---|---|
| `js/data.js` | world, items, recipes, buildings, ages, chapters, dialogue, notes |
| `js/game.js` | state, survival, the threat director, wolves, the bear, story, saves |
| `js/colony.js` | settlement: workers, construction, ages, upgrades, market, alarm |
| `js/input.js` | one input model: states, cursors, hit zones, camera, orders |
| `js/gfx.js` · `js/art-*.js` | renderer, light and shadows; jointed people, animals, buildings, effects |
| `js/ui.js` · `js/icons.js` | interface built from one design system, 99 icons |
| `js/audio.js` · `js/finale.js` | synthesised sound and music; the ending scenes |

Design research behind the last big rework — audits, style guide, specs — is in [docs/design](docs/design/).

## 📜 Licence

Code — MIT, see [LICENSE](LICENSE). Icons and fonts keep their licences, listed in [CREDITS.md](CREDITS.md).
