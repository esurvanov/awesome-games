# Architecture of “Skhodka”: C4 and critical paths

“Skhodka” is a Saturday evening of an IT community in a Batumi bar, 19:00 → 01:00, about 18 minutes: browser only, no server and no build step, three.js ships alongside. This is how it is put together: C4 diagrams down to components and the four paths everything rests on.

## C4: context and containers

### Level 1. The system and its surroundings

![System context: the player, the game, browser settings and tests](diagrams/en/c4-context.svg "There is no server and no library fetched over the network: three.js lives in the game folder. Double-clicking index.html is enough.")

### Level 2. Containers

![Game containers: page, assembly, content, simulation, hall, UI, core](diagrams/en/c4-containers.svg "The simulation knows nothing about the screen: it is drawn separately and also runs in Node. Content is data only.")

## C4 level 3: components of each context

All parts are plain scripts with an `L` registry: `L.def` declares a part, `L.use` fetches it and runs it on first use. A dependency cycle fails at once with a clear error. Contexts talk through the world’s event bus (`world.bus`) and the `world.act` call.

### Simulation

![Components of the evening simulation](diagrams/en/c3-sim.svg "Components of the evening simulation")

- **World** holds the clock (180 real seconds per game hour), the people, the player, the seats and the event bus; outward it exposes `step`, `act`, `view`.
- **Crowd** builds guests from roles, minds and needs and fits the arrival schedule to the evening curve by an invariant, not by tuning.
- **Brain** decides for the guests: seat, bar, smoking area, conversation groups. **Director** starts events and phone messages.
- **Talk** plays out the reply cards; **Score** counts acquaintances, pairs, the photo and the title.

### Hall and people

![Components of the hall and people rendering](diagrams/en/c3-render.svg "Components of the hall and people rendering")

- **Scene** builds SushiGO from the plan and decor, 2–4 real lights, the rest of the light baked into textures; effects: rain, sax, karaoke and more.
- **Quality** switches low / mid / high by frame rate: down fast, up slowly, never above a rung it already failed on.
- **People**: each person is a single SkinnedMesh, animation is procedural from pose, mood and “is speaking”.

### UI

![UI components](diagrams/en/c3-ui.svg "UI components")

- **Ui** subscribes to world events (`talk:line`, `ladder`, `pair`, `chat`, `toast`, `end`) and sends the player’s actions to `world.act`.
- Its own `ui.bus`: pause, quality, sound, “another Saturday”.

## Four critical paths

### 1. Startup and a new evening

![Startup sequence](diagrams/en/seq-start.svg "The hall lives from the first frame, behind the title. The world is built only after the profile; `?seed=N` gives the same evening.")

### 2. A simulation step

![Simulation step sequence](diagrams/en/seq-tick.svg "Time moves in fixed 1/30 s steps, so an evening with one seed is the same on any machine.")

### 3. A player’s reply and its consequences

![Player reply sequence](diagrams/en/seq-choice.svg "Rapport rises or falls, the person card opens one field per turn, steps lead from “seen” to “agreed”. A failure or fatigue ends the talk.")

### 4. A frame

![Frame sequence](diagrams/en/seq-frame.svg "The world hands out a flat list “who is where in which pose”, the assembly mirrors it onto the 3D people. A frame error goes to the console, the loop keeps going.")

## The rules everything rests on

- **The simulation knows nothing about the screen.** No DOM, no THREE: it is seen only through `view()` and the event bus.
- **Content is data.** The engine receives `CONTENT` whole; stories and numbers change without the engine, numbers are overridden by `TUNING`.
- **One seed, one evening.** A seeded random generator and a fixed step give repeatability.
- **Invariant instead of tuning.** The head count at peak hours is fitted into a corridor by a formula.
- **The weak machine comes first.** Quality adapts to frames, light is mostly baked.

## Weak spots

| Where | What is wrong |
|---|---|
| **Big assembly** | main.js, about 300 lines, holds input, the end photo and floor marks along with the loop. |
| **UI guesses the world’s shape** | Ui tolerates both a Map and an array of people and several flag names: the data contract is blurred. |
| **Musicians outside the simulation** | The sax player and the singer exist only in the assembly and are invisible to the world. |
| **Large hall files** | scene.js and people.js are 850–950 lines each. |
| **Separate test fixture** | sim/fixture.js duplicates the content schema and can drift from the real one. |
