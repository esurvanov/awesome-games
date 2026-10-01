# Architecture of “Chronicles of Kingdoms”: C4 and critical paths

“Chronicles of Kingdoms” is a real-time strategy in the spirit of Age of Empires II that runs as an ordinary website: no server and no build step, about 80 JavaScript modules and one canvas filling the page. It was ported line by line from the Python version, so the rules and numbers match the original. Below: C4 diagrams down to components and the four paths everything rests on.

## Contexts: what surrounds the game

| Who / what | What it gives the game |
|---|---|
| Player | mouse and keyboard; sees a 1280 × 800 canvas |
| Static host | serves the `web/` and `assets/` files; the game has no server of its own |
| Browser APIs | Canvas 2D for the picture, Web Audio for sound, IndexedDB for saves |
| Asset pipeline | Python scripts in `tools/` turn 0 A.D. 3D models into isometric sprites once; the result lives in `assets/` |
| Python version | the source of the port and its reference: tests compare the browser code with real CPython |

## C4: context and containers

### Level 1. The system and its surroundings

![System context: the player, the game, the host, storage, the pipeline and the Python version](diagrams/en/c4-context.svg "The game needs only files and a browser. The pipeline and the Python version work outside the game: one prepares the pictures, the other is the reference for tests.")

### Level 2. Containers

![Containers: loader, game, runtime, assets](diagrams/en/c4-containers.svg "The loader fetches assets and shows a progress bar, then plugs the game in. The game talks to the browser only through the runtime, which mimics the pygame API.")

## C4 level 3: components

The main container, “Game”, splits into three parts: the simulation (the rules), the opponent (AI) and the interface. The simulation knows nothing about graphics, so tests run it without a screen. The runtime is described separately.

### Simulation

![Simulation components](diagrams/en/c3-simulation.svg "World holds the players, units, buildings, projectiles and fog and finds paths; one world step moves all of it.")

- Units, buildings, techs and the 14 civilizations sit in the `content/*` tables: a new unit is a line of data.
- Match parameters (resources, ages, treaty, victory) are collected in `match.js`.
- Maps: six recipes in `mapgen.js` plus relief with heights, cliffs and shallows.

### Opponent (AI)

![AI components](diagrams/en/c3-ai.svg "Each opponent thinks twice a second and issues the same commands as the player.")

- A profile says how many villagers to keep in each age, when to advance and when to attack; there are six levels, from easiest to extreme.
- War runs in a loop: rally, march, engage, retreat; the decision comes from comparing strengths.
- The navy is plugged in only on maps with water.

### Interface

![Interface components](diagrams/en/c3-ui.svg "The game screen is one big class with the panels, controls, menu, lobby and the screens around a match mixed into it.")

- The loop is simple: events, world update, drawing, sound; the menu, loading and results are states of the same loop.
- Audio listens to the world’s events (a hit, a death, a building) and decides what to play.
- The picture uses ready sprites; if they are missing, a fallback procedural graphic is drawn.

### Runtime

![Runtime components](diagrams/en/c3-runtime.svg "The game code kept its Python style; the runtime pretends to be Python, pygame and numpy on top of the browser.")

- `py.js` reproduces numbers, sorting and `random` bit for bit, so a saved game and the tests give the same results as in Python.
- `storage.js` behaves like plain files: it reads and writes at once and flushes to IndexedDB in the background.
- `assets.js` loads by manifest in groups; unit sheets arrive one by one when needed.

## Four critical paths

### 1. Starting a match

![Sequence of starting a match](diagrams/en/seq-start.svg "The world is built in one step and the picture waits for the starting units’ sprites (for a short limit at most).")

### 2. One frame

![Sequence of one frame](diagrams/en/seq-frame.svg "The frame time is cut into steps of at most 0.034 s; the AI decides every half second and idles the rest of the frames.")

### 3. An order and its execution

![Sequence of an order](diagrams/en/seq-order.svg "The player and the AI use the same unit commands; the Shift queue and patrols live in the orders module.")

### 4. Save and load

![Sequence of save and load](diagrams/en/seq-save.svg "The whole object graph goes into the file; static tables are written as addresses and taken from the current version of the game.")

## The rules everything rests on

- **The World is the only source of truth.** The screen only reads it and sends orders.
- **The player and the AI are equals.** Both command units through the same `cmd_*`.
- **Data is separate from code.** Units, buildings, techs and civilizations live in tables.
- **Simulation without graphics.** Tests run whole AI-vs-AI matches without a screen and compare them with CPython.
- **What is read synchronously is loaded in advance.** The loader puts assets in memory before the game starts; unit sheets stream in one by one.

## Weak spots

| Where | What is wrong |
|---|---|
| **Big files** | `world.js` is 3.2 k lines, `ui.js` 2.2 k, `hud.js` 2 k: there are few boundaries inside them. |
| **Mixed-in parts** | The game screen is assembled from six mixed-in parts that talk through shared fields. |
| **Links by name** | Modules find each other through the `modules.*` registry at run time: the links are invisible in the code. |
| **Step depends on the frame** | The step length comes from real time. A shared online match would need a fixed step. |
| **Weight** | The first load is about 60 MB, all unit sheets another ~90 MB; in memory they inflate to gigabytes. |
| **No server** | Saves live in one browser only, and there is no online play. |
