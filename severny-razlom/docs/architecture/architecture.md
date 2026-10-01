# Architecture of “Northern Rift”: C4 and critical paths

“Northern Rift” is a 3D arcade about flying down an endless ice canyon: a single `index.html` of about 70 KB, no build step and no assets of its own. This is how it is put together: C4 diagrams down to the component level and the four paths everything rests on.

## C4: context and containers

### Level 1. The system and its surroundings

![System context: the player, the game, a CDN and fonts](diagrams/en/c4-context.svg "The game has no server of its own: any static host will do. Without three.js it asks the player to reload the page.")

### Level 2. Containers

![Game containers: the page, the script and built-in browser features](diagrams/en/c4-containers.svg "There are no sound or image files: the music is synthesised on the fly and the world is drawn by shaders.")

## C4 level 3: components of each context

The script splits into two contexts. The rules keep the state and decide what happened; the scene and sound only show the result. The shared language is one state object `G` and the `ship`.

### Game rules

![Components of the Game rules context](diagrams/en/c3-play.svg "Everything is decided in one `update(dt)` function: it moves the ship, calls the spawner and checks collisions.")

- Eight obstacle patterns (crystals, lasers, rings, slalom, sweeper and others) are picked at random with weights.
- Difficulty grows smoothly: `diff()` goes 0 to 1 over 14,000 m and new patterns unlock at thresholds.
- Three shields; after a hit, 1.7 s of invulnerability. Boost breaks the ice and costs energy.
- Score = bonuses × multiplier + half the distance. The ×1…×8 multiplier grows with rings and resets on a hit.

### Scene and sound

![Components of the Scene and sound context](diagrams/en/c3-scene.svg "The world is endless thanks to a trick: the ship flies forward and the canyon plane is moved after it every frame.")

- Snow, speed streaks and obstacles are moved ahead once they pass the camera, so nothing piles up.
- All particles live in one 1,400-point buffer; sound is a Web Audio generator that schedules bars ahead of time.
- The aurora colour shifts smoothly every 2,500 m (a new sector).

## Four critical paths

### 1. Starting up

![Startup sequence](diagrams/en/seq-start.svg "The menu is already alive: the ship flies down the canyon behind it. “Start” only resets the score and switches to play mode.")

### 2. One frame

![Sequence of one frame](diagrams/en/seq-frame.svg "Frame time is capped at 0.05 s so objects do not teleport after a stall; on pause dt is zero.")

### 3. From input to action

![Input sequence](diagrams/en/seq-input.svg "Input only records state; the action is born in the frame. Touch pulls the ship to a point, keys set velocity.")

### 4. A hit and the end of a run

![Hit and end-of-run sequence](diagrams/en/seq-crash.svg "The end of a run is the only place the game saves anything. Boost turns the same crystal from a threat into points.")

## The rules everything rests on

- **One loop, one state.** Only the script changes the mode (`state`) and the score (`G`); screens merely display.
- **The world follows the ship.** The ship moves along z while the canyon, sky and snow adjust to the camera.
- **Objects do not pile up.** Whatever is 30 m behind the ship is removed; 430 m are kept ahead.
- **The frame is guarded.** Frame time is capped, pause zeroes it, losing focus pauses the game.
- **Saving is safe.** Any localStorage error is swallowed; the game works without it.

## Weak spots

| Where | What is wrong |
|---|---|
| **Monolith** | Sound, world, rules and UI sit in one block; the boundaries exist only in comments. |
| **One frame function** | `update` keeps growing: input, spawning, collisions and camera in one place. |
| **External dependencies** | three.js and fonts from a CDN: without a network the game does not start. |
| **No tests** | Scoring and difficulty rules are checked only by playing. |
| **Randomness** | The canyon is built from unseeded `Math.random`: a run cannot be replayed. |
