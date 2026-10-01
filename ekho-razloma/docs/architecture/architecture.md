# Architecture of “Echo of the Rift”: C4 and critical paths

“Echo of the Rift” is an open 900 × 900 m island in the browser: no engine and no build step, one page and a set of modules. This is how it is put together: C4 diagrams down to the component level and the four paths everything rests on.

## C4: context and containers

### Level 1. The system and its surroundings

![System context: the player, the game and a CDN](diagrams/en/c4-context.svg "Everything the game needs comes from the browser and the CDN. The game has no server of its own: any static host will do.")

### Level 2. Containers

![Game containers: page, modules, physics, WorldFill, packs](diagrams/en/c4-containers.svg "The page owns the loop and the story; everything else plugs into it. A module that fails is switched off on its own.")

## C4 level 3: components of each context

Contexts talk through a shared `ctx` object and a few globals. Every fact has one owner: physics moves the pilot, the pose pipeline writes the bones, the registry knows the world’s objects.

### 🌍 World

![Components of the World context](diagrams/en/c3-world.svg "Everything solid registers in Passport and becomes a collision.")

- Trees are drawn in batches per material: one draw call per material.
- Far trees are replaced by images from eight sides.

### 🧍 Body and contact

![Components of the Body and contact context](diagrams/en/c3-body.svg "Four modules ask, one writes: the pose pipeline is the only one that moves the bones.")

- The rock brain reads a rock’s shape and picks one action: palm, back, shoulder, ledge, sit, climb.
- The body measure reads the real drawn shape; the judge in the tests uses the same one.

### ⚙️ Physics

![Components of the Physics context](diagrams/en/c3-physics.svg "Physics is the only mover of the pilot; everyone else gives it a goal through setGoal.")

- Near the pilot a rock gets its exact shape; far away it stays a simplified hull.
- At rocks the pilot’s capsule becomes an ellipse sized from the body.

### 📖 Story and interface

![Components of the Story and interface context](diagrams/en/c3-story.svg "This context still lives inside the page and has not been split into modules.")

- Five chapters, two endings, 24 shards and 8 echo recordings.
- Progress is stored in the browser, no server.

### 🎛 Quality

![Components of the Quality context](diagrams/en/c3-quality.svg "A preset sets everything at once: picked by the GPU first, then tuned by frame time.")

- The moon never moves, so shadows of static objects are rendered once and cached.
- In the menu, on pause and in a hidden tab the loop stops completely.

### 📦 Assets

![Components of the Assets context](diagrams/en/c3-assets.svg "Models sit in .js files as text, so the game loads from any static host.")

- The loader shows a list of modules and resources until everything is ready.
- The heavy parts are prepared outside the game: far-tree images and baked light.

## Four critical paths

### 1. Starting the game

![Startup sequence](diagrams/en/seq-start.svg "The game does not start until the libraries, physics and modules are ready.")

### 2. One frame

![Sequence of one frame](diagrams/en/seq-frame.svg "Modules run in descending order: the body first (55 … 40), the world last (−10).")

### 3. The pilot at a rock

![Sequence of touching a rock](diagrams/en/seq-rock.svg "The rock brain decides, physics moves, the pipeline writes the bones.")

### 4. Quality tuning

![Quality tuning sequence](diagrams/en/seq-quality.svg "A coarse pick by the GPU first, then fine tuning from every frame.")

## The rules everything rests on

- **Physics is the only mover of the pilot.** Everyone else gives a goal.
- **The pose pipeline is the only writer of the bones.** Others send requests.
- **The Passport registry is the only one that knows the world’s objects.** Collisions are built from it.
- **A module fails alone.** An error switches off only that module.
- **One “inside the rock” measure.** The game and the tests measure the same way.

## Weak spots

| Where | What is wrong |
|---|---|
| **Monolithic page** | The story, the loop and the Passport registry sit in one 4.5 k-line file with no boundaries between them. |
| **Module order** | The order is set by numbers in code; a wrong number changes behaviour silently. |
| **Globals** | Modules exchange data through window.*: links are invisible in the code. |
| **Pilot pose** | Several modules decide the final pose; there is no single owner yet. |
| **Load weight** | Base64 packs and libraries from an external CDN. |
