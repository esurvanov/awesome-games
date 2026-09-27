# 🧠 AI layer: Эхо Разлома

> ⚠️ **Rotate the TypeSafe key.** It was pasted into chat. Issue a new one, put it in `.env` as `TYPESAFE_API_KEY=…`, and revoke the old one. Nothing else needs to change.

| | |
|---|---|
| 🎯 Rule | The model **never writes** text the player sees. It only **picks an id** from pre-written content. Low confidence falls back to deterministic rules. |
| 📴 Offline | No server (claude.ai artifact, `file://`, `?ai=0`) → `AI.available=false` and every `decide()` resolves to `null` **instantly**. The game runs on rules. |
| 🔑 Key | Read by the server only: `$TYPESAFE_API_KEY` or `.env`. It never appears in client files, logs, cache, reports or tests. `.env` and `server/` are never served over HTTP. |
| 🤖 Model | TypeSafe `jev-latest` (currently `jev-1.13.0`), `POST /v1/systemone`, $42 per 1B input tokens |

---

## 🗺 Architecture

```
 open-world.html ──AI.tick(dt)──▶ ai.js ──POST /api/decide {set, state}──▶ server/server.mjs ──▶ api.typesafe.ai
   (ctx hooks)   ◀─apply result── (gates, rules,   ◀── {answers, meta} ───  (whitelist · schema · cache ·
                                   hysteresis)                               rate-limit · breaker · $ cap)
                                      ▲
                               ai-content.js  ◀── same file in the browser AND on the server:
                               lines · options · question builders · schemas · rule fallbacks
```

| File | Role |
|---|---|
| `server/server.mjs` | static files + `/api/decide` + `/api/stats` + `/api/world-dump`; binds to 127.0.0.1 |
| `server/typesafe.mjs` | upstream client: deadline, backoff on 429/529/5xx, honours `retry-after` |
| `server/cache/` | `cache.json` (answers), `usage.json` (tokens, $), `world-dump.json` |
| `ai.js` | `window.AI`: transport, the 7 modules, Orm/command UI, voice input, world dump |
| `ai-content.js` | all pre-written Russian content + English criteria + schemas + rules |
| `tools/ai-integrate.mjs` | applies every hook below by text anchor (to a copy by default) |
| `tools/validate-world.mjs` · `tools/dump-world.html` | offline placement checker |
| `tests/ai.test.mjs` | 47 checks: content, resilience, offline client, real API |
| `Запустить.command` | launcher: Node server if Node is installed, otherwise python `http.server` (no AI) |

### 🛡 Server protections

| Guard | Value |
|---|---|
| Whitelist | only the 7 set ids; the **server** builds the questions from a validated state, so the page can't send its own prompts |
| Schema | typed and clamped fields; unknown keys dropped; body ≤ 16 KB → otherwise 422 |
| Origin | `/api/*` is same-origin only (403 for any other site); POST requires `application/json` |
| Cache | sha256(content version + model + set + built request); TTL per set; memory + disk; phrases normalised |
| Rate limit | 20-request burst, 5 req/s per client → 429 |
| Concurrency | 8 upstream calls at once; identical requests share one call |
| Deadline | 1.5–1.6 s per set; retries only while time is left |
| Circuit breaker | a 429, 529 or network failure pauses upstream calls for 1 s, doubling up to 60 s; meanwhile requests get an instant 503 and the game uses rules |
| Budget | `AI_DAILY_USD` (default **$1/day**) → 503 once reached |
| Stats | `GET /api/stats`: per set: requests, cache hits, errors, tokens, $, p50/p95 |

---

## 🧩 Question sets

| Set | When it runs | Asks | Gate → fallback |
|---|---|---|---|
| 💬 `ORM_TALK` | player types to Orm (**Y** near Orm, or «Спросить…» in his dialog) | choice of **47** replies (filtered by stage and flags) · mood score 1–5 · noul "asking about Lidia?" | top prob ≥ 0.30 or conf ≥ 0.35 · Lidia noul ≥ 0.7 forces a Lidia line · skips recent repeats → keyword matcher |
| 🎬 `DIRECTOR` | every 20–40 s of play | event ∈ {none, blizzard, ambush_small, stag_herd, aurora_flare, echo_whisper, fox_find, supply_drop} · tension 1–5 | code sends only **allowed** events (cooldowns, HP, stage, place) · conf ≥ 0.35 → `directorRules` |
| 🦌 `CREATURE` | every 2.5 s if creatures are within 70 m | one choice per creature (≤ 8 per call): stag {graze, alert, flee, approach} · fox {approach, lead_player_to_shard, circle, alert, graze} · shardling {approach, circle, retreat, alert} | conf ≥ 0.3 → intent for 4.5 s · **offline = original code** |
| 🎙 `COMMANDS` | **V** (text) · **Shift+V** (voice) | action ∈ 27 (26 + `none`) | conf ≥ **0.6** → keyword matcher |
| 📖 `HINTS` | every 15 s, only after a local "maybe stuck" check | noul "stuck?" · choice of 1–4 spoiler-free hints for the stage | noul ≥ 0.6 · 120 s cooldown → `stuckRules` / `hintRules` |
| 🖥 `QUALITY_DIRECTOR` | every 3 s | preset {low, med, high, ultra} · focus {enemy, landscape, dialogue, vehicle} | conf ≥ 0.4 → `qualityRules`; then **local hysteresis** |
| 📦 `PRELOAD` | every 20 s and on stage change | next zone from the zones not yet preloaded | conf ≥ 0.3 → `preloadRules` (stage → zone) |
| 🤝 `CONTACT_INTENT` | only when the probed surface state changes near the player (surface/distance/height/player-state bucket), ≥ 1.2 s apart | one contact action (`rest_on_rock, touch_surface, climb_slope, cross_obstacle, inspect_ground, pick_up, clear_branch`) + `none`, from surface type/height/distance/angle, player speed/state, fatigue (hp⁄hpMax proxy), cold (`WX.storm` proxy), animals/NPC nearby | conf ≥ 0.4 → `contactRules` (same gates as `ANIMLIB.chooseContact`'s own `within()` check: close + slow/idle, never mid-run/combat/ride/climb). See `INT-CONTACT.md` / `modules/interaction.js` (`CT`). |

**Quality hysteresis:** go down one step after 2 samples in a row below 50 fps, or at once below 24 fps. Go up one step only after 3 samples in a row with the worst frame ≥ 50 fps and at least 24 s since the last change. Never skip a level. A manual command locks the preset for 5 minutes.

**Model-facing text:** instructions and option descriptions are in English (jev is most accurate in English). Numbers are turned into words in code ("under a minute", "close (6–15 m)", "poor (20–30 fps)"), following jev's documented weak spots.

### ⌨️ Controls added

| Key | Action |
|---|---|
| **Y** | talk freely to Orm (within 7 m, stage ≥ 2) |
| **V** | command line (ИРИС) |
| **Shift+V** | voice command; the 🎤 button also works inside the panel |
| Enter / Esc | send / close |

Voice uses the Web Speech API with `ru-RU`. If it's missing or the microphone is refused, the mic button hides and a toast explains why. Typing always works.

---

## 📊 Measured (2026-09-25, `jev-1.13.0`)

| Metric | Value |
|---|---|
| ⏱ Upstream latency p50 / p95 | **318 ms / 426 ms** (35 calls) · first cold call ≈ 815 ms |
| ⚡ Cache hit | **0–4 ms** |
| 🔀 3 sets in parallel | 324 ms total |
| 📴 Offline `decide()` | 0.03 ms (resolves `null`) · server probe fails in < 1 ms when nothing listens |
| 🧮 `AI.tick` per frame | ~0.001 ms |
| 💵 Whole test run | 35 calls · 35,477 tokens · **$0.0015** |
| 🧾 All real calls during this build | ≈ 45 (budget was < 60) |

| Set | Tokens/call | $/call | Accuracy (test set) |
|---|---|---|---|
| ORM_TALK | 1464 | $0.000061 | **10/10** (keywords alone: 7/10) |
| COMMANDS | 945 | $0.000040 | 9/10, then 3/3 after one description fix (keywords alone: 10/10 on the easy set) |
| CREATURE (4 creatures) | 1193 | $0.000050 | stag at 8 m → flee ✓ · shardling hurt → retreat ✓ |
| DIRECTOR | 778 | $0.000033 | hurt → supply_drop ✓ · combat → none ✓ · calm → fox_find ✓ |
| QUALITY_DIRECTOR | 657 | $0.000028 | 24 fps → low ✓ · phone → med ✓ · 118 fps → high ✓ |
| HINTS | 539 | $0.000023 | stuck 0.90 vs progressing 0.08 ✓ |
| PRELOAD | 492 | $0.000021 | stage 2 → lake ✓ · stage 6 → rift ✓ |
| CONTACT_INTENT | 739 | $0.000031 | **5/5** (idle at rock → rest_on_rock ✓ · slow approach → touch_surface ✓ · sprinting past → none ✓ · low crate → cross_obstacle ✓ · fighting → none ✓), 2026-09-26 |

**Cost of an hour of play (worst case, no cache hits):** director 120 calls + quality 1200 + creatures ≈ 430 → about 1.4M tokens → **≈ $0.06/h**. Cache hits usually cut this by half or more.

Details: `tests/results.json`. Test run: `node tests/ai.test.mjs` (makes about 35 real calls) or `--offline` (no API calls).

---

## 🔌 Integration into `open-world.html`

Fastest path: `node tools/ai-integrate.mjs --check` checks the anchors, then `node tools/ai-integrate.mjs --in-place` patches the file and makes `open-world.html.pre-ai.bak` first. The same code, placed by hand:

### 1 · Scripts: after `<script src="worldfill.js"></script>`
```html
<script src="ai-content.js"></script>
<script src="ai.js"></script>
```
Both are classic scripts that set `window.AI_CONTENT` / `window.AI`. They work with the module-based game too.

### 2 · `AI.tick`: in `frame(now)`, right after `let dt = …; lastT = now;`
```js
if (window.AI) AI.tick(dt);
```
It must run **before** the `if (G.pause || G.ui) return` early exit, so quality control also works in menus. The modules pause themselves.

### 3 · `AI.init(ctx)`: in `boot()`, just before `requestAnimationFrame(frame)`
The full `ctx` block is `INIT` in `tools/ai-integrate.mjs`, ready to paste. Key fields:

| ctx field | Game binding | Used by |
|---|---|---|
| `G, player, orm, fox, sk, enemies, boss, STAGS, WX, POI, cam` | the game objects | everything |
| `dialogActive, say(lines, done), toast, lock` | `Dialog.active`, `Dialog.play`, `toast`, `requestLock` | Orm, commands |
| `objective()` | `STAGES[G.stage].tgt()` | hints, "where is the objective" |
| `firePos, shipPos, echoes, shards` | `FIRE.pos`, `WORLD.kestrel.g.position`, `WORLD.echoes`, `WORLD.shards` | where-queries, events |
| `inCombat()` | enemies not idle, or the boss is active | director, quality, creatures |
| `getQuality / setQuality` | `Q.name` / foundation's `setQuality(name)` | quality director |
| `preloadZone(z)` | `AI.prefetch(z, ASSET)` (warms `assets/pack/*.js`), or the foundation's zone streamer | preload |
| `actions.*` | `callSkimmer, mount, dismount, openUI('map'/'journal'), closeUI, startScan, rest, waveHello, petFox, setPause, save, Sound.toggle` | commands |
| `events.*` | see below | director |
| `onOrmReply(r)` | `AV.orm.once('yes'/'no'/'talk')` by mood | Orm |
| `onHint(h)` | `G.aiHint = h.text` (show it in `renderJournal`) | hints |

### 4 · 🎬 Director events (`ctx.events`)

| Event | Implementation |
|---|---|
| blizzard | `WX.target = 1; WX.t = 35–50` |
| ambush_small | 2–3 × `spawnShardling(x, z, null)` 20 m behind the camera, set to `'chase'` |
| stag_herd | 3 nearest `STAGS` moved 45 m ahead and off to one side, then set to `flee` across the view |
| aurora_flare | `G.aurora = 2.2` for 14 s (skipped after an ending) |
| echo_whisper | `Sound.echo()`; the toast gives the direction to the nearest unheard echo |
| fox_find | `fox.target = shard; fox.st = 'seek'` |
| supply_drop | `spawnHeal()` 5 m ahead |

The toast text comes from `ai-content.js` → `EVENTS[*].t`. ai.js shows it after applying the event.

### 5 · 🦌 Creature hooks (active only when the server answered)

| Where | Hook |
|---|---|
| `updateStags`, `graze` branch | `ai = AI.intent(s)`: `flee` or d < 10 m → run · `alert`/`approach` → turn and look · no intent → the original `d < 26` rule |
| `updateFox`, `follow` branch, after `want = …` | `lead_player_to_shard` → `seekT = 0` (reuses the seek logic) · `circle` → `AI.steer(fox,'circle','fox')` · `graze`/`alert` → sit |
| `updateEnemies`, `case 'chase'` | `retreat` → `'return'` · `circle` → orbit at 11 m · `alert` → hover beyond 15 m |
| `updateEnemies`, `case 'return'` | don't re-chase while the intent is `retreat` |

### 6 · 💬 Orm free talk
- Key **Y** near Orm, handled inside ai.js. No game code needed.
- Optional: `talkOrm()` appends the choice «Спросить…» after his scripted lines. Only for stage ≥ 2, and only when the dialog has no `done` callback, so story steps are never skipped.
- While the panel is open, `G.ui = 'ai'`: the game freezes and typing doesn't move the player (key events stop at the input).
- The reply is played as `Dialog.play([['you', phrase], ['orm', line]])`.

### 7 · 🖥 Quality → `setQuality(name)`
Preset names match the foundation's `QUALITY` exactly: `low | med | high | ultra`. `setFocus(focus)` is optional; examples: `vehicle` → lower `treeNear`, `landscape` → raise it.

### 8 · 📦 Preload → `loadPacked`
`AI.ZONE_PACKS` maps each zone to its asset packs (current names). The default `AI.prefetch` adds `<link rel=prefetch>` for each pack, so a later `loadPacked()` hits the HTTP cache. Once the foundation streams zones, set `preloadZone: (z) => streamZone(z)` instead.

### 9 · 🐞 Debugging
`#dbg`, then use `AI.log` (last 60 decisions with model/rules source), `AI.stats`, `AI.available`, `AI.director.force()`, `AI.hints.force()`, `AI.commands.run('where_objective')`, `AI.quality.set('low')`. Server side: `http://localhost:8790/api/stats`.

**Verified:** the hooks were applied to the 18:29 backup of `open-world.html` and the page was run in headless Chrome against the live server. It started with AI on; Orm answered from the model (`lidia_who`); all 5 director events applied without errors; commands, the talk panel and the world dump all worked. The live `open-world.html` had a syntax error (`function tintColor`) at test time, from the foundation rewrite in progress. Re-run `--check` once it's stable.

---

## 🚀 Launch

| Where | How |
|---|---|
| `game/` | double-click `Запустить.command` → `node server/server.mjs --port 8790 --page open-world.html --open` |
| `Игры/2 - Эхо Разлома/` | copy `server/` (without `cache/`), `ai.js`, `ai-content.js` and this `Запустить.command` next to `index.html`, then add `.env` (or export `TYPESAFE_API_KEY`). The launcher picks `index.html` when `open-world.html` isn't there. Without Node it falls back to `python3 -m http.server` (no AI). |
| Terminal | `node server/server.mjs [--port 8790] [--page open-world.html] [--open]` · env `AI_DAILY_USD`, `TYPESAFE_MODEL`, `HOST` |

If the port is busy, the server tries the next 10 ports.

---

## 🧱 World validator

```
node server/server.mjs                                   # 1. server
open http://localhost:8790/tools/dump-world.html         # 2. dump → server/cache/world-dump.json (or headless Chrome)
node tools/validate-world.mjs [--max 50] [--dry]         # 3. → tools/reports/world-validation.{md,json}
```
How it works: code describes each object in words (type, size, slope, gap to the ground). It pre-filters the suspicious ones, adds 8 normal samples and 3 control objects, and sends **one** request.

| Run | Value |
|---|---|
| Dump | 722 objects → 465 describable → 50 sent |
| Cost | 10,050 tokens · **$0.00042** · 2.0 s |
| Controls | tent on a 35° slope → 1.13 ✓ · barrel 1.2 m in the air → 1.21 ✓ · crate on the ground → 4.90 ✓ |

| 🔴 Worst finding | Score | Likely cause |
|---|---|---|
| ruins at (138, −215) and (−76, −151) | 1.6 / 1.8 | placed on 53–56° slopes; up to 10–13 m of the footprint buried on one side |
| stags at (150, −30) and (60, 150) | 1.8 / 2.3 | model ~0.85 m above the ground (pivot/offset in `animal_stag`) |
| station wooden crates | 1.8 / 1.9 | 0.35 m in the air before physics starts (dump taken in the menu, so possibly harmless) |
| crystal shard pickup at (58, −306) | 2.4 | on a 60° slope |

---

## ✅ Tests

`node tests/ai.test.mjs` → **47/47** passed.

| Group | Checks |
|---|---|
| Content | ≥ 40 Orm lines (47), ≥ 25 commands (27), every set builds questions, rules work on `null` answers, bad schema/set rejected |
| Resilience (mocked, $0) | 429 → backoff succeeds · cache hit · 400/422/403 · `.env` and `server/` never served, `ai.js` has no key · persistent 529 → fails in 0.6 s, breaker open, instant 503 · hung upstream → timeout at 1.50 s · rate limit → 429 · no key → rules |
| Client offline (VM) | probe fails fast · `decide` → `null` in 0.03 ms · Orm on keywords · director rules fire (low HP → medkit) · hysteresis: flapping advice → 0 changes, 3 × up → one step, fps 20 → one step down |
| Real API | tables above |
