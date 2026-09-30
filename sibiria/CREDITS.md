# Credits · Авторы

Code: MIT (see [LICENSE](LICENSE)). The game draws all of its art and sound itself in code (canvas 2D, Web Audio); the only third-party assets are the icons, the web fonts and two CC0 photo textures below.

Код — MIT. Всю графику и звук игра рисует и синтезирует сама (canvas 2D, Web Audio); внешние ресурсы — только иконки, шрифты и две фото-текстуры CC0 из списка ниже. Авторы иконок также перечислены в окне «Об игре» и в итоговом акте.

## Photo textures · Фото-текстуры

Used in `assets/photo/` (via `js/photo.js`, high quality only): neutral-grey high-pass detail maps made from the photographs below (tileable, resized, converted to WebP; `photo-data.js` holds the same two files as data URIs so the canvas stays readable when the game is opened from `file://`). Both are **CC0 1.0** (public domain) by Rob Tuytel, published on [Poly Haven](https://polyhaven.com/license) (licence checked on the site and via `api.polyhaven.com/info`).

| File | Source | Author | Licence |
|---|---|---|---|
| `snow-detail-1k.webp` | [Snow 02](https://polyhaven.com/a/snow_02) | Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `needles-detail-512.webp` | [Forest Leaves 04](https://polyhaven.com/a/forest_leaves_04) (pine-needle litter) | Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

## Icons · Иконки

99 icons in `js/icons.js` (one source for the HTML interface and the canvas). Silhouettes come from three sets; a few are assembled from them or drawn by hand.

| Set | Authors | Licence |
|---|---|---|
| [game-icons.net](https://game-icons.net) | Lorc, Delapouite, Caro Asercion, Skoll, Sbed, DarkZaitzev | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| [Lucide](https://lucide.dev) | Lucide Contributors | ISC |
| [Tabler Icons](https://tabler.io/icons) | Paweł Kuna | MIT |

Assembled from ready-made silhouettes: `gunner`, `snare`, `woodshed`. Drawn for this game: `balok`, `tube`, `sled`.

## Fonts · Шрифты

Loaded from Google Fonts at run time (SIL Open Font License 1.1): [Russo One](https://fonts.google.com/specimen/Russo+One) · [PT Sans](https://fonts.google.com/specimen/PT+Sans) · [PT Mono](https://fonts.google.com/specimen/PT+Mono). Without a network connection the game falls back to system fonts.

## Ideas · Идеи

The settlement (workers, ages, market, alarm) follows the spirit of *Age of Empires*; the fishing minigame, the hidden wooden charms and the soft-fail first chapter follow [Berezovka](../berezovka/). Design research and specs are in [docs/design](docs/design/).
