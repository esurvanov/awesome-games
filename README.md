<div align="center">

🇬🇧 **English** · [🇷🇺 Русский](README.ru.md)

<img src="docs/banner.jpg" alt="awesome-games: Chronicles of Kingdoms and Berezovka" width="100%">

### Three complete open-source games: a medieval real-time strategy, a winter open world and a taiga survival-and-settlement game. All three run right in your browser — or clone and play locally.

[![Play Berezovka in your browser](https://img.shields.io/badge/▶_Play_Berezovka_now-in_your_browser-D7263D?style=for-the-badge)](https://esurvanov.github.io/awesome-games/berezovka/)
[![Play Chronicles of Kingdoms in your browser](https://img.shields.io/badge/⚔_Play_Chronicles_of_Kingdoms-in_your_browser-3776AB?style=for-the-badge)](https://esurvanov.github.io/awesome-games/age-of-empires/web/)

![Games](https://img.shields.io/badge/games-3-2ea44f) ![Code](https://img.shields.io/badge/code-MIT-yellow) ![Assets](https://img.shields.io/badge/assets-open_licences-EF9421) ![No store, no ads](https://img.shields.io/badge/no_store-no_ads-lightgrey)

</div>

---

## 🎮 The games

<table>
<tr>
<td width="50%" valign="top">

<a href="age-of-empires/"><img src="age-of-empires/docs/screenshots/battle.jpg" alt="Open-field battle with siege engines"></a>

### ⚔️ [Chronicles of Kingdoms](age-of-empires/)
**Medieval RTS in the spirit of Age of Empires II.**

Build a village in the Dark Age, wall it, raise a castle, reach the Imperial Age and break the enemy with trebuchets — against up to 7 AI players.

- 🏰 14 civilizations · 4 ages · 130+ technologies
- ⚔️ 75+ unit types, formations, naval warfare
- 🗺 6 random maps · 🤖 AI from Easiest to Extreme
- 🌍 7 UI languages · 💾 save / load

`JavaScript` · `Canvas 2D` · any desktop browser · also `Python` + `pygame-ce` for macOS / Windows / Linux

**[▶ Play now](https://esurvanov.github.io/awesome-games/age-of-empires/web/)** · [Python quick start](age-of-empires/README.md#-quick-start)

</td>
<td width="50%" valign="top">

<a href="https://esurvanov.github.io/awesome-games/berezovka/"><img src="berezovka/docs/screenshots/street.jpg" alt="Snowy village street in Berezovka"></a>

### ❄️ [Berezovka](berezovka/)
**A snowbound Russian village you can walk into — 3D open world in the browser.**

Back home after five years: firewood for grandma, a 1979 Zhiguli that won't start, a missing cat past the bear, and a church bell for the holiday night.

- 🗺 ~1 km² open world · 📖 story in 12 steps
- 🚗 drivable Zhiguli with suspension and ice drift
- 🌗 day, night, northern lights, blizzards
- 🎣 ice fishing · 🪆 12 hidden matryoshkas

`three.js` · `WebGL 2` · any desktop browser, nothing to install

**[▶ Play now](https://esurvanov.github.io/awesome-games/berezovka/)**

</td>
</tr>
<tr>
<td colspan="2" valign="top">

<a href="sibiria/"><img src="sibiria/docs/screenshots/village-day.jpg" alt="Sibiria: a hut, settlers and a watchtower in the snow" width="100%"></a>

### 🐺 [Sibiria](sibiria/)

**Survive four nights in the Evenki taiga, 1993 — then build a settlement around your hut.**

Your Mi-8 went down in Evenkia and the radio is smashed. Light the stove, meet the old Evenk Urkachan, carry Vera out of the wreck, hold off the wolves and the rogue bear, and call for a helicopter — or stay and build a village.

- 📖 4 chapters · 4 endings · 🔥 real cold and a hunting wolf pack
- 🏘 hire settlers · 8 buildings · 4 ages · market and alarm bell
- 🎣 reaction fishing · 🎧 all sound synthesised · 📱 phone-ready

`JavaScript` · `Canvas 2D` · any browser, nothing to install

**[▶ Play now](https://esurvanov.github.io/awesome-games/sibiria/)**

</td>
</tr>
</table>

## 📸 A closer look

| Chronicles of Kingdoms | Berezovka |
|---|---|
| ![Byzantine town](age-of-empires/docs/screenshots/town.jpg) | ![Northern lights over the village](berezovka/docs/screenshots/night.jpg) |
| ![Fleet and dock](age-of-empires/docs/screenshots/naval.jpg) | ![The church on the hill](berezovka/docs/screenshots/church.jpg) |
| ![Tech tree](age-of-empires/docs/screenshots/techtree.jpg) | ![Grandma's yard](berezovka/docs/screenshots/yard.jpg) |

## 💡 What these games have in common

| | |
|---|---|
| 🆓 **Open all the way down** | Code under MIT. Every sprite, model, texture and sound comes from open projects under CC0, CC-BY, CC BY-SA or MIT, with authors credited in each game's `CREDITS.md`. |
| 🎯 **Finished, not a demo** | Each game has a start, goals and an ending. You can play it through. |
| 📏 **Built against reality** | Numbers are checked against real ones: unit stats follow the classic RTS, and Berezovka's buildings, walking speeds and car acceleration each have an automated check. |
| 🧩 **Readable source** | No engine editor and no proprietary tools. Clone the repo and read the code. |

## 🚀 Play

| Game | How |
|---|---|
| ❄️ Berezovka | Open **[esurvanov.github.io/awesome-games/berezovka](https://esurvanov.github.io/awesome-games/berezovka/)** — or `cd berezovka && python3 -m http.server` |
| 🐺 Sibiria | Open **[esurvanov.github.io/awesome-games/sibiria](https://esurvanov.github.io/awesome-games/sibiria/)** — or `cd sibiria && python3 -m http.server` |
| ⚔️ Chronicles of Kingdoms | Open **[esurvanov.github.io/awesome-games/age-of-empires](https://esurvanov.github.io/awesome-games/age-of-empires/web/)** — or `python3 -m http.server` in the repo root and open `/age-of-empires/web/`; Python version: `cd age-of-empires && python3 -m venv .venv && .venv/bin/pip install pygame-ce numpy && .venv/bin/python main.py` (macOS: double-click `Play.command`) |

## 📜 Licence

Code — MIT, see each game's `LICENSE`. Art and sound keep their original licences, listed in [age-of-empires/CREDITS.md](age-of-empires/CREDITS.md) and [berezovka/CREDITS.md](berezovka/CREDITS.md).
