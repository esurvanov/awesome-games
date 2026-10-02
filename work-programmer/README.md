# Uptime

🇬🇧 **English** · [🇷🇺 Русский](README.ru.md) · **[▶ Play](https://esurvanov.github.io/awesome-games/work-programmer/)**

You build a service. It breaks. You fix it. A game about an engineer’s job for people who have never coded:
a stream of users runs through pipes, you place blocks, bet on what breaks first and watch.

![flow through services](docs/screenshots/flow.png)
![result and debrief](docs/screenshots/result.png)

| | |
|---|---|
| 🧭 43 levels | 5 tiers: basics → load → observability → platform → architecture |
| 🧱 25 blocks | servers, cache, database, queue, broker, Kubernetes, sockets, VPN, sagas, monitoring, logs, tracing |
| 💥 27 incidents | spike, zone, region, cloud, bad deploy, certificate, leak, bots |
| 🔮 prediction | before the start: what breaks first |
| 📋 debrief | the decision (ADR) with pros and cons, the request path, where it was thin |
| 🎲 modes | daily task, survival, sandbox · 🌐 Russian and English |

## Running

Double-click `index.html`. No server, build step or libraries; offline you get a system font.

## Controls

| | Mouse | Touch |
|---|---|---|
| ➕ place a block | click or drag from the list on the left | tap |
| 🔗 draw a pipe | dot at a block → another block | tap, tap |
| ⚙️ settings | click a block or a pipe | tap |
| ▶ start · ⏸ pause | button, `Space` | button |
| ⏩ speed | 1× · 2× · 4× | button |
| 🗑 remove | `Delete` (not while running) | — |
| 🔍 zoom | wheel, buttons bottom left | pinch |

## Layout

```
index.html         icon sprite + app root; parts are plain <script>s with the L registry (js/l.js), listed in js/manifest.js
js/core.js         the U namespace, a seeded random generator
js/sim/            flow without DOM: model.js — blocks, links, prices, Erlang C queue, traffic;
                   sim.js — simulation step, incidents, scaling, result; run.js — headless run, load test
js/content/        DATA: levels.js — 43 levels (traffic, incidents, goals, starting scheme), text.ru.js / text.en.js — every word
js/render/         board.js — the SVG board: tanks, pipes, groups, flow dots, dragging and linking
js/ui/             i18n.js — language and block settings schema; app.js — screens, inspector, tutorial, result, modes
js/main.js         assembly: opens the home screen
css/game.css       look, light and dark theme
docs/              architecture/ — how it is built (C4, critical paths), page/ — game page data, screenshots/
tests/             Node + Playwright
```

## Tests

```sh
cd tests && npm install   # once, for the browser checks
node levels.test.js       # all 43 levels and daily tasks: the naive scheme fails, the reference one passes
node dbg.js <level> [naive|ref]   # block load over a run
node ui.smoke.js          # browser: tutorial, levels, editing on pause, load test, language, phone
node hostile.test.js      # the tutorial completes even if the browser loses a button release
```
