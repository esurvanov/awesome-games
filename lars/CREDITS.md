# Credits · Авторы

Code: MIT (see [LICENSE](LICENSE)). The game has no third-party assets and no libraries: the 3D world, people, cars and sky are drawn in hand-written WebGL, the sound is synthesised with Web Audio, the icons are drawn for this game (`js/ui/icons.js`), and the fonts are the system ones.

Код — MIT. Внешних ресурсов и библиотек нет: мир, люди, машины и небо нарисованы на WebGL вручную, звук синтезируется через Web Audio, иконки нарисованы для этой игры (`js/ui/icons.js`), шрифты системные.

## Data · Данные

The route, terrain and weather are simplified from open data (see [docs/research/geography.md](docs/research/geography.md)):

| Data | Source | Licence |
|---|---|---|
| Road, villages, checkpoint layout | © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors | ODbL |
| Elevations | [Copernicus DEM](https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model) via [Open-Meteo](https://open-meteo.com/en/docs/elevation-api) | Copernicus licence |
| Weather, sunrise and sunset, Sept 2022 | [ERA5](https://cds.climate.copernicus.eu/) reanalysis via [Open-Meteo](https://open-meteo.com/en/docs/historical-weather-api) | Copernicus licence · CC BY 4.0 |

Dates, queue sizes, rules, prices and personal stories come from press reports and eyewitness accounts; every fact is linked to its source in [docs/research](docs/research/). Personal accounts are anonymised.

## Voices · Голоса

Optional. Speech, transcription and conversation go through the [OpenAI API](https://platform.openai.com/) with the player's own key; nothing is bundled with the game.
