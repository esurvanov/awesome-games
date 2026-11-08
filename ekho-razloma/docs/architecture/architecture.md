# Architecture of “Echo of the Rift”: C4 and critical paths

“Echo of the Rift” is an open 900 × 900 m island in the browser: no engine and no build step, one page and a set of modules. This is how it is put together: C4 diagrams down to the component level and the four paths everything rests on.

## C4: context and containers

### Level 1. The system and its surroundings

![System context: the player, the game and a CDN](diagrams/en/c4-context.svg "Everything the game needs comes from the browser and the CDN. The game has no server of its own: any static host will do.")

### Level 2. Containers

![Game containers: page, modules, physics, WorldFill, packs](diagrams/en/c4-containers.svg "The page owns the loop and the story; everything else plugs into it. A module that fails is switched off on its own.")

## Game domains

![Four game domains and the shared object passport](diagrams/en/domains.svg "A domain is where entities have a life of their own. Graphics settings and loading have none and are not domains.")

| Domain | What is inside | Life |
|---|---|---|
| **Progress** | chapters, goal, endings, shards, echo recordings | started → chapters → ending; saved |
| **Beings** | pilot, ravens, animals later | appears → moves → reacts to a thing |
| **Things** | rocks and ruins, trees, structures, vehicles, barrels and crates, the fire | placed at start → stands; some change |
| **Environment** | day, weather, snow, sky and moon, fog, horizon, ice | flows on its own, independent of the player |

## C4 level 3: components of each domain

Domains talk through a shared `ctx` object and a few globals. Every fact has one owner: physics moves the pilot, the pose pipeline writes the bones, the passport knows the world’s objects.

### Progress

![Components of the Progress domain](diagrams/en/c3-story.svg "This domain still lives inside the page and has not been split into modules.")

- Five chapters, two endings, 24 shards and 8 echo recordings; every six shards give a shield.
- A shard lying in the world belongs to progress: only its place stays in the world.
- Progress is stored in the browser, no server.

### Beings

![Components of the Beings domain](diagrams/en/c3-beings.svg "Only physics moves the pilot and only the pose pipeline writes the bones; the rest give goals and ask.")

- The rock brain sits on the border: it reads a thing’s shape and picks an action (palm, back, shoulder, ledge, sit, climb). Contact is not a domain but a link between a being and a thing.
- Only the “palm” action is done; the other five are waiting.
- At rocks the pilot’s capsule becomes an ellipse sized from the body.
- There are no animals in the game yet; the shared body is ready to take them.

### Things

![Components of the Things domain](diagrams/en/c3-things.svg "One passport for all things and beings: kind, shape, how to touch, material, owner.")

- Near the pilot a rock gets its exact shape; far away it stays a simplified hull.
- Trees are drawn in batches per material: one draw call per material; far ones are replaced by images from eight sides.
- The “Kestrel” is a special thing: it has a path “wrecked → goal → takes off”, yet it is still described as a plain structure.

### Environment

![Components of the Environment domain](diagrams/en/c3-environment.svg "The environment flows on its own: day and weather pass, snow and light change.")

- The moon never moves, so sky and shadows are stable.
- Mountains on the horizon, sea ice and mist are generated procedurally by WorldFill, no new assets.

## Beside the game: settings and loading

These parts have no life of their own, so they are not domains: they tune the game and deliver it to the browser.

### Graphics settings

![Components of the graphics settings](diagrams/en/c3-quality.svg "A preset sets everything at once: picked by the GPU first, then tuned by frame time.")

- The moon never moves, so shadows of static objects are rendered once and cached.
- In the menu, on pause and in a hidden tab the loop stops completely.

### Loading

![Components of loading](diagrams/en/c3-assets.svg "Models sit in .js files as text, so the game loads from any static host.")

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
- **One passport per thing and being.** Collisions and touches are built from it.
- **A module fails alone.** An error switches off only that module.
- **One “inside the rock” measure.** The game and the tests measure the same way.

## Weak spots

| Where | What is wrong |
|---|---|
| **Monolithic page** | The story, the loop and the Passport registry sit in one 4.5 k-line file with no boundaries between them. |
| **Module order** | The order is set by numbers in code; a wrong number changes behaviour silently. |
| **Globals** | Modules exchange data through window.*: links are invisible in the code. |
| **Pilot pose** | Several modules decide the final pose; there is no single owner yet. |
| **Domain borders** | Domains exist on the diagram but not in the code: everything is mixed across the page and the modules. |
| **Border objects** | The “Kestrel” and the shards live in both progress and the world, and have no assigned owner. |
| **Load weight** | Base64 packs and libraries from an external CDN. |
