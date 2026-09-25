# Лицензии проекта — сводка

| Часть | Где | Лицензия / правообладатель |
|---|---|---|
| Код игры «Хроники Королевств» | `main.py`, `game/`, `tools/` | собственный код авторов этого репозитория; не производная от кода 0 A.D. или модов |
| Спрайты зданий, стен, природы, земли; листы кадров юнитов | `assets/gen/` | **CC BY-SA 3.0** — производные от 0 A.D. © Wildfire Games и от Millennium A.D. © The Council of Modders, Fallen Empire Studio, Scion Development (`assets/gen/LICENSE.md`) |
| Графика интерфейса (кнопки, рамки, портреты, значки, курсоры) | `assets/ui/` | **CC BY-SA 3.0**, производные от 0 A.D. © Wildfire Games (`assets/ui/LICENSE.md`) |
| Музыка, звуки, голоса | `assets/audio/` | **CC BY-SA 3.0**, производные от 0 A.D. © Wildfire Games (`assets/audio/LICENSE.txt`, `manifest.json`) |
| Шрифты Linux Biolinum, GNU FreeSans | `assets/fonts/` | GPL v3+ с font exception (файлы `*-LICENSE.txt` рядом) |
| Сырые ассеты 0 A.D. и Millennium A.D. | `assets/0ad_raw/`, `assets/millenniumad_raw/` | не хранятся в git; скачиваются `tools/fetch_0ad.py`, `tools/fetch_millennium.py` |

## Millennium A.D.

- Графика мода (`art/`) — **CC BY-SA 3.0** (файл `art/license.txt` мода), та же лицензия, что у
  графики 0 A.D., поэтому детали обоих источников можно собирать в один спрайт; результат —
  CC BY-SA 3.0 с атрибуцией обоим правообладателям.
- Код мода — GPL-2.0 (`License.txt` в корне мода): **не используется**. Музыка мода не используется.
- Графики под GPL-2.0 в проекте нет. Если она когда-нибудь появится, производные от неё спрайты
  будут распространяться на условиях GPL-2.0-or-later; исходники проекта открыты в этом репозитории.
- Medieval A.D. не используется (неясно, какая из двух заявленных лицензий относится к графике).

## Атрибуция в игре

Строка в главном меню: «Графика и звук: 0 A.D. © Wildfire Games; Millennium A.D. © The Council of
Modders, Fallen Empire Studio, Scion Development; CC BY-SA 3.0». Полные титры и ссылки на лицензии —
`CREDITS.md`.

Лицензия CC BY-SA 3.0: <https://creativecommons.org/licenses/by-sa/3.0/>.
