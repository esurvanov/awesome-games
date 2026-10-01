# Architecture of “Berezovka”: C4 and critical paths

Berezovka is a snowbound village in the browser: an open world about a kilometre across, a story, a Zhiguli, ice fishing. No server and no build step: one page and five modules. Below: the surroundings, C4 diagrams down to components and the four paths everything rests on.

## C4: context and containers

### Level 1. The system and its surroundings

![System context: the player, the game, a CDN and fonts](diagrams/en/c4-context.svg "The game has no server of its own: it runs from static files and progress lives in the browser.")

### Level 2. Containers

![Game containers: page, modules, packs, save](diagrams/en/c4-containers.svg "The page owns the loop and the state; modules get what they need through a passed ctx object and keep no globals of their own.")

## C4 level 3: components

The containers worth opening: the page, four modules and asset loading. Sound (`sound.js`) is simple: `makeSound(env)` receives a snapshot of the game state and decides what to play.

### Page

![Components of the page](diagrams/en/c3-page.svg "The story sets a stage number; it decides which items are visible and where the quest arrow points.")

- The loop caps one step at 0.05 s so nothing jumps after a pause.
- The save is written on every stage change and every 15 seconds.

### Look and light

![Components of the Look module](diagrams/en/c3-look.svg "Sky, ambient light and fog come from the same panoramas, so every model sits in the same light.")

- By day and in overcast it is Poly Haven panoramas, at night an image of its own.
- Corner shading switches itself off if the average frame takes longer than 33 ms.

### Motion

![Components of the Motion module](diagrams/en/c3-motion.svg "The pure logic does not depend on three.js: a human and a car can be run in a test with no screen.")

- Speed grows with finite acceleration, turns follow an arc.
- Step rate is speed divided by the clip’s stride length: feet do not slide.
- The car: four springs, body roll, ice, handbrake; 0–100 in about 18 s.

### Layout and scale

![Components of the layout and scale modules](diagrams/en/c3-layout.svg "All placement is driven by one fixed random seed: the world comes out the same every time.")

- A house turns to the nearest road; the yard gets a fence and ruts.
- A model’s size is checked against the real one: outside the band, the target size is used.
- Far forest is cut into tiles and hidden whole while the player is away.

### Asset loading

![Components of asset loading](diagrams/en/c3-assets.svg "Models sit in .js files as text, so the game loads from any static host.")

- The loader shows resource groups and marks the one where something failed.
- Sounds load separately; until a file arrives, a synthesised stand-in plays.

## Four critical paths

### 1. Starting the game

![Startup sequence](diagrams/en/seq-start.svg "The menu appears only when everything is loaded and built; “Continue” shows if a save exists.")

### 2. One frame

![Sequence of one frame](diagrams/en/seq-frame.svg "In the menu the loop only orbits the camera around the village; while loading it does nothing.")

### 3. A story step

![Sequence of a story step](diagrams/en/seq-quest.svg "The game leads the player through a chain of 13 stages; the bell at stage 11 triggers the finale.")

### 4. A weak machine

![Quality adaptation sequence](diagrams/en/seq-quality.svg "The game lowers quality by itself: no post-processing on touch screens, no corner shading on slow GPUs.")

## The rules everything rests on

- **One source of light.** Sky, ambient light and fog come from the same panoramas.
- **A module keeps no global data.** Everything arrives through ctx from the page.
- **Pure logic apart from the screen.** Motion is tested without three.js.
- **Every measurable property has a check.** The game prints GATE … OK or FAIL lines to the console: building sizes, walking speed, foot slip, car acceleration, frame brightness.
- **The world is deterministic.** Placement runs from a fixed seed.

## Weak spots

| Where | What is wrong |
|---|---|
| **Monolithic page** | Loop, story, collisions, UI and world assembly sit in one file of about 1,500 lines. |
| **Story in code** | Lines and stages are hard-wired in talk(); a new chapter needs a page edit. |
| **Load weight** | About 33 MB on first start: base64 models and a library from an external CDN. |
| **No server** | The save lives in a single browser and vanishes when site data is cleared. |
| **Phones** | There is a joystick, but the game targets desktop; touch screens get no post-processing. |
