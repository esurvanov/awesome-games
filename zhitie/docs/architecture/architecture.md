# Architecture of “Zhitiyo”: C4 and critical paths

Zhitiyo is a browser life sim: a neighbourhood of ten households, needs, careers, relationships, Buy and Build modes. No build step and no server: a page, a set of ES modules and three.js from a CDN. Below: C4 diagrams down to components and the four paths everything rests on.

## Contexts

| Context | Folder | Owns |
|---|---|---|
| **Core** | `js/core` | event bus, state, balance numbers |
| **Brain** | `js/sim` | needs, action choice, careers, family, incidents |
| **World** | `js/world` | lot, walls, pathfinding, rooms, neighbourhood |
| **Render** | `js/render` | three.js: scene, camera, models, animations |
| **UI** | `js/ui` | panel, pie menu, buy, build, input |
| **Audio** | `js/audio` | effects, voices, music per mode |
| **Data** | `data/, assets/` | item catalogue, interactions, neighbourhood, texts, glb models |

## C4: context and containers

### Level 1. The system and its surroundings

![System context: player, game, CDN and browser storage](diagrams/en/c4-context.svg "There is no server of its own: any static host will do.")

### Level 2. Containers

![Game containers: wiring, five contexts, data and models](diagrams/en/c4-containers.svg "main.js creates the bus and the state, wires the contexts and runs the loop. Brain, World and UI read the catalogue from data/.")

## C4 level 3: components of each context

Contexts talk through the event bus and one state object. Every fact has one owner: the Brain runs time and needs, the World knows tiles and walls, the Render draws the picture.

### Brain

![Components of the Brain context](diagrams/en/c3-sim.svg "The Brain knows neither DOM nor three.js: it runs in Node, which is how the tests work.")

- Autonomy scores nearby objects by need curves and divides the gain by distance.
- A player command queues above an autonomous one and pre-empts it.
- Subsystems attach to actions through step-end hooks; the loop core does not know them.

### World

![Components of the World context](diagrams/en/c3-world.svg "The World keeps the lot in the state and answers: can it be placed, where to walk, which room is this.")

- Walkability and room grids are computed once and reset when the lot is edited.
- The active lot lives in state.lot; the others are kept as snapshots inside the neighbourhood.

### Render

![Components of the Render context](diagrams/en/c3-render.svg "The Render only reads the state and listens to the bus; it changes nothing in it.")

- Objects and residents resync on bus events; walls also by a hash check twice a second.
- A model not found: a procedural stand-in is drawn.
- Shaders are pre-warmed at start to avoid hitches later.

### UI and audio

![Components of the UI and Audio contexts](diagrams/en/c3-ui.svg "The UI gets the world, brain and render from main.js as one object and calls them directly.")

- Audio starts on the first player gesture: the browser allows nothing earlier.
- Volumes and settings are kept in localStorage.

## Four critical paths

### 1. Startup and world load

![Startup sequence](diagrams/en/seq-start.svg "A new game seeds the RNG, places the start house and two residents; with a save it skips that.")

### 2. Simulation tick

![Simulation tick sequence](diagrams/en/seq-tick.svg "Several sub-steps run per frame: needs tick rarely, actions and walking every sub-step.")

### 3. Player action and its effect

![Player action sequence](diagrams/en/seq-action.svg "The tick then runs the action: walk, enter, loop, exit; the Render reacts to events.")

### 4. A frame: render and audio

![Frame sequence](diagrams/en/seq-frame.svg "One requestAnimationFrame drives everything: simulation, interface, picture, audio and autosave.")

## The rules everything rests on

- **One state.** Everything worth saving lives in one object that turns into JSON as a whole.
- **The event bus links contexts.** An error in one listener does not stop the others.
- **Brain and World without DOM and three.js.** They are tested in Node with no browser.
- **The Render decides nothing.** It draws what is in the state.
- **Player and autonomy share one queue.** A player order always wins.

## Weak spots

| Where | What is wrong |
|---|---|
| **Hooks in one file** | All action-step handlers sit in one 450-line sim/index.js. |
| **UI knows the Render** | Family creation takes outfit lists straight from the render manifest file. |
| **World via a global** | The Brain gets the world as an argument and also keeps it in a module-wide variable. |
| **Save version** | A save of another version is silently dropped; there are no migrations. |
| **Load weight** | three.js comes from an external CDN and the glb model set loads at start. |
