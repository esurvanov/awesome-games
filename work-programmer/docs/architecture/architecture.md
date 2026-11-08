# Architecture of “Uptime”: C4 and critical paths

“Uptime” is a game about an engineer’s job: you build a service from blocks, send a stream of users through it and watch what breaks first. 43 levels in five tiers, from a single server to splitting a monolith. Browser only, no server and no build step. This is how it is put together: C4 diagrams down to components and the four paths everything rests on.

## C4: context and containers

### Level 1. The system and its surroundings

![System context: the player, the game, browser storage, fonts and tests](diagrams/en/c4-context.svg "There is no server. Offline the game works the same, only with a system font. Double-clicking index.html is enough.")

### Level 2. Containers

![Game containers: page, assembly, content, simulation, board, UI, core](diagrams/en/c4-containers.svg "The simulation knows nothing about the screen: the board draws it, and it runs whole in Node. Levels describe mechanics only; every word lives in two dictionaries.")

## C4 level 3: components of each context

All parts are plain scripts with the `L` registry, as in the other games of the repository: `L.def` declares a part, `L.use` fetches it and runs it on first use. A dependency cycle fails at once with a clear error. Parts put their shared exports into the `U` namespace from `core.js`.

### Simulation

![Components of the flow simulation](diagrams/en/c3-sim.svg "Components of the flow simulation")

- **Model** holds the catalogue of 25 blocks, allowed links, monthly prices, the Erlang C queue and the level’s traffic curve.
- **Sim.step** every half second of game time: incidents, scaling, node state from the previous tick’s load, then segments flow through the pipes with a call stack and timeouts.
- **Incidents** come in 27 kinds: spike, zone, region or cloud outage, an expired certificate, a bad deploy, a memory leak, bots and more.
- **Result** folds availability, wait time (p95), money, level checks and stars; **Run** does the same without a screen and ramps traffic for the load test.

### Board

![Board components](diagrams/en/c3-board.svg "Board components")

- **A tank** is a block with fill: the level shows load, the colour shows whether it copes.
- **A pipe**: thickness is volume, dashes mean async, commands, events, sockets and a shared database each have a colour.
- **Fog**: on observability levels block data stays hidden until monitoring, logs or tracing are added.

### UI

![UI components](diagrams/en/c3-ui.svg "UI components")

- **i18n** picks the language, translates by key and describes every block’s settings: toggles, segments, numbers.
- **The inspector** shows only the settings the level has opened so far: difficulty grows step by step.
- **The debrief** after a run: the decision as an ADR with pros and cons, the request path split into wait parts, and charts.

## Four critical paths

### 1. Startup and a level

![Startup sequence](diagrams/en/seq-start.svg "The “what breaks” prediction is the start button: the player bets first, then sees the flow.")

### 2. A simulation step

![Simulation step sequence](diagrams/en/seq-step.svg "A node’s state comes from the previous tick’s load, so traversal order does not matter and chains A → B → C → A work naturally. The step is fixed, up to 80 steps a frame at high speed.")

### 3. Editing on pause

![Editing on pause sequence](diagrams/en/seq-edit.svg "The new scheme is swapped in on the fly: running machines, queues and caches stay, new machines boot as in real life.")

### 4. Result and debrief

![Result sequence](diagrams/en/seq-result.svg "The result answers two questions: did the system hold and why. The debrief splits the wait into parts and shows where it was thin.")

## The rules everything rests on

- **The simulation knows nothing about the screen.** No DOM, no SVG: the board reads its state after a step.
- **A level is data.** Traffic, incidents, goals and the starting scheme; words live in two dictionaries with the same keys.
- **Every level is proven.** A test runs a naive scheme (must fail) and a reference one (must pass with two stars or more) for all 43 levels and the daily tasks.
- **One step is half a second.** A fixed step gives the same run on any machine.
- **Difficulty drop by drop.** New blocks and settings open on the level that needs them.

## Weak spots

| Where | What is wrong |
|---|---|
| **Big UI** | ui/app.js, about 870 lines, holds every screen, the inspector, the tutorial and the modes in one closure. |
| **Long step** | Sim.step is about 350 lines: flow, retries, timeouts and incidents in one method. |
| **Shared namespace** | Parts write exports into `U`, so a dependency shows in `L.use`, but a specific name only by search. |
| **Balance by constants** | The numbers in `K` are hand-tuned; only the naive and reference scheme test holds them. |
| **Timing-based browser test** | The UI check waits by seconds and sometimes runs late on a cold browser start. |
