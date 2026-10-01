# Architecture of “Sibiria”: C4 and critical paths

“Sibiria” is a top-down taiga survival game in the browser: no engine, no build step, about fifty scripts drawing on a 2D canvas. This is how it is put together: C4 diagrams down to the component level and the four paths everything rests on.

## C4: context and containers

### Level 1. The system and its surroundings

![System context: the player, the game, fonts and browser storage](diagrams/en/c4-context.svg "The game has no server of its own: any static host will do. Without the fonts it still runs, only the typeface changes.")

### Level 2. Containers

![Game containers: page, core, systems, picture, sound, interface](diagrams/en/c4-containers.svg "The loop lives in the interface and calls the systems, the renderer and sound in turn. All scripts load in order through the tags in index.html.")

## C4 level 3: components of each context

Five contexts where the game is decided are shown. Saving is covered below as a critical path.

### World

![Components of the World context](diagrams/en/c3-world.svg "The world is built from a seed: forest, zones and drifts are recomputed, not stored.")

- Zones (aufeis, burnt forest, boulder field, bald peak and more) change the rules: cold, pace, hazards.
- Responses are a table of “event + properties of the thing → reaction”, not “who with what” pairs.

### Hero, survival and threats

![Components of the Survival and Threats contexts](diagrams/en/c3-survival.svg "Warmth drops with frost and wind and rises at a fire or stove; the director watches the hero and decides when the wolves come.")

- The threat director works like Left 4 Dead: tension → budget → omen (howl, tracks) → scout or pack.
- A storm drives the pack away, and at low health the director pauses.

### Settlement and people

![Components of the Settlement and people context](diagrams/en/c3-colony.svg "A new character or quest is an entry in the data; the executors stay as they are.")

- Settlers follow a “gather → store → again” loop; extra builders give diminishing returns.
- Four ages, eight kinds of buildings, trade in roubles at a floating rate.

### Story

![Components of the Story context](diagrams/en/c3-story.svg "The story is data and Story only executes it: “when the condition holds, run the operations”.")

- Seven chapters, five endings: the branch depends on whether the helicopter comes and whether the settlement is ready.
- Entering a chapter makes an autosave by itself.

### Picture, sound and interface

![Components of the Picture, sound and interface contexts](diagrams/en/c3-render.svg "All input goes through one state machine, and the picture is built in layers with one light and one sun.")

- All sound is synthesised in Web Audio, no files; the music follows the danger.
- If frames run past 28 ms or below 30 fps for two windows in a row, the graphics are simplified.

## Four critical paths

### 1. One frame

![Sequence of one frame](diagrams/en/seq-frame.svg "During sleep update runs four times per frame; with a panel open the world stands still and only “breathes”.")

### 2. A night threat

![Sequence of a night threat](diagrams/en/seq-night.svg "A warning first, then the attack: the player has time to reach a fire.")

### 3. A story step

![Sequence of a story step](diagrams/en/seq-story.svg "An event fires once, tracked by a saved flag; the chapter changes when all its goals are done.")

### 4. Saving and loading

![Save and load sequence](diagrams/en/seq-save.svg "Only what changed is saved: forest, zones and drifts are recomputed from the seed.")

## The rules everything rests on

- **One state `G`.** Systems read and write it; a save is `G` plus the seed.
- **The world is computed from a seed.** Forest, zones and drifts are not stored.
- **The story is data.** Chapters, events, quests and people sit in `content/`; the executors know nothing about them.
- **One step order.** `update` calls the systems in a fixed order.
- **One `Ctx` summary.** Barks, sound and light take “what is around the hero” from it.

## Weak spots

| Where | What is wrong |
|---|---|
| **Script order** | About 55 tags in index.html; the order matters and nothing checks it. |
| **Global modules** | Modules call each other by name; the code has no boundaries between contexts. |
| **The big `G`** | One mutable state for everything: any system can break another’s field. |
| **ui.js** | One thousand-line file holds the HUD, dialogues, map, frame loop and saves. |
| **Old saves** | Saves before version 4 are not readable: the world is different. |
