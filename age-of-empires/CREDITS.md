# Credits / Благодарности и лицензии

Код игры «Хроники Королевств» — отдельная работа авторов этого репозитория.
Он **не** является производной от кода 0 A.D. и распространяется на своих
условиях. Ниже — сторонние материалы (графика, звук, музыка, шрифты), которые
игра использует или может использовать. Никаких материалов Microsoft /
Age of Empires в проекте нет.

## 0 A.D. — Wildfire Games

- Источник: 0 A.D. by **Wildfire Games** — <https://www.wildfiregames.com/>,
  <https://play0ad.com/>, репозиторий <https://gitea.wildfiregames.com/0ad/0ad>
  (коммит `0ed48b3a1fb1b4b718a78869fa497185af55e086`, ветка `main`).
- Скачивается скриптом `tools/fetch_0ad.py` в `assets/0ad_raw/` (не хранится в git).

| Что | Путь в 0 A.D. | Лицензия |
|---|---|---|
| 3D-модели (DAE/PMD), текстуры скинов/террейна/UI, анимации (DAE/PSA), скелеты, акторы XML, материалы, частицы, иконки/портреты | `binaries/data/mods/public/art/` | **CC BY-SA 3.0** © Wildfire Games |
| Музыка, звуковые эффекты, голоса, амбиент | `binaries/data/mods/public/audio/` | **CC BY-SA 3.0** © Wildfire Games |
| Файлы титров (`gui/credits/texts/*.json`) — только как источник имён | `binaries/data/mods/public/gui/` | GPL v2 или новее |
| Шрифты DejaVu Sans Mono | `binaries/data/mods/mod/fonts/` | Bitstream Vera / DejaVu (свободная лицензия, см. `DejaVu-LICENSE.txt`) |
| Шрифты GNU FreeFont (FreeSans, FreeMono) | там же | GPL v3+ с font exception |
| Шрифты Linux Biolinum | там же | GPL (с font exception), как указано в `LibBiolinum-LICENSE.txt` |

Лицензия CC BY-SA 3.0: <https://creativecommons.org/licenses/by-sa/3.0/>
(полный текст: <https://creativecommons.org/licenses/by-sa/3.0/legalcode>).

Часть текстур 0 A.D. получена из материалов CGTextures (<http://www.cgtextures.com/>,
ныне Textures.com); CGTextures дали Wildfire Games специальное разрешение
распространять эти производные текстуры под CC BY-SA. Оригиналы CGTextures
остаются собственностью CGTextures и под эту лицензию не попадают.

### Обязательная атрибуция (CC BY-SA 3.0)

> Графика, анимации, музыка и звуки: **0 A.D.** © Wildfire Games
> (<http://www.wildfiregames.com/>), лицензия CC BY-SA 3.0
> (<http://creativecommons.org/licenses/by-sa/3.0/>). Материалы изменены:
> 3D-модели отрендерены в изометрические спрайты, текстуры и звуки
> конвертированы/перекодированы.

Эта строка должна быть видна в титрах игры и в этом файле.

### Share-alike: производные спрайты

Спрайты, атласы, иконки, перекодированные звуки и любые иные файлы,
**полученные из** материалов 0 A.D. (рендер моделей в изометрию, перекраска,
нарезка, сжатие, микширование), являются производными работами и
**распространяются под той же лицензией CC BY-SA 3.0** с атрибуцией
Wildfire Games и указанием, что материал изменён. Эти файлы следует держать
в отдельной папке с копией этого раздела.
Лицензия на производные ассеты не распространяется на код игры.

### Звуки и музыка в игре: `assets/audio/` (хранится в git)

Все файлы в `assets/audio/` — **производные** от аудио 0 A.D. © Wildfire Games,
лицензия **CC BY-SA 3.0** (текст — `assets/audio/LICENSE.txt`), распространяются
под той же лицензией. Изменения: громкость выровнена, у эффектов срезана тишина
и укорочены длинные хвосты, у части эффектов сдвинут тон, всё перекодировано в
Opus. Собираются скриптом `tools/build_audio.py` из `assets/0ad_raw/`.
`assets/audio/manifest.json` для **каждого файла** указывает исходный путь в
репозитории 0 A.D., лицензию, атрибуцию и что изменено.

- **Музыка** (композитор-руководитель Omri Lahav и участники раздела Audio ниже):
  меню — *Epitaph*; мирная — *Celtica, Celtic Pride, Highland Mist, Harvest Festival,
  Tavern in the Mist, Northern Frontier, Albian Nocturne, Mountain Idyll, Sunrise,
  The Fledgling Kingdom, Water's Edge, As Seasons Change, Midwinter, Solstice Festival,
  Eastern Dreams, Cisalpine Gaul, The Road Ahead*; боевая — *Honor Bound, Tale of Warriors,
  Red Dawn, Calm Before the Storm, Point of No Return, Harsh Lands Rugged People,
  A Brothers Revenge, Bandit Country, Taiko 1, Taiko 2, Upstart King*;
  итог — *You are Victorious!*, *Dried Tears*.
- **Эффекты**: оружие и попадания (`attack/`), крики и смерти (`actor/`),
  добыча и стройка (`resource/`), сигналы и звуки зданий (`interface/`),
  фрагмент прибоя (`ambient/water/wave_21.ogg`).
- **Голоса**: короткие реплики на латыни (`voice/latin/civ/`; озвучание —
  Camille Tidjditi, Nicolas Auvray).

**`assets/gen/`** — такие производные работы: изометрические спрайты зданий
(10 архитектурных наборов, варианты домов, доки в 4 поворотах, стадии стройки),
стен и ворот (с фундаментом и лесами стройки), деревьев, кустов,
шахт, полей, животных и плитки текстур земли, отрендеренные из моделей и
текстур 0 A.D. и мода **Millennium A.D.** (см. раздел ниже) скриптом
`tools/build_sprites.py` (рендерер `tools/render3d/`).
Лицензия: **CC BY-SA 3.0**, © Wildfire Games и © The Council of Modders, Fallen Empire
Studio, Scion Development (для деталей из Millennium A.D.); изменения: модели отрендерены в
ортографической изометрии с новым освещением и тенями, уменьшены, перекрашены
(маска цвета игрока, тонировка золота), текстуры земли спроецированы в изометрию.
Юниты — **`assets/gen/units/`**: листы кадров анимированных юнитов (жители,
пехота, конница, верблюды, слон, монахи, повозки, осадные машины, корабли,
овцы, олени, кабаны), отрендеренные скриптом `tools/build_units.py` из
скелетных моделей, скин-контроллеров и анимаций 0 A.D. и Millennium A.D. (ходьба, работа,
атака, смерть; 8 направлений). Лицензия: **CC BY-SA 3.0**, © Wildfire Games,
© The Council of Modders, Fallen Empire Studio, Scion Development;
изменения: скелетные анимации просчитаны в отдельные кадры, модели собраны из
частей (всадник на коне, экипаж на машине), отражены по горизонтали,
отрендерены в изометрии с новым освещением и тенями, уменьшены, палитра
сокращена до 256 цветов, добавлена маска цвета игрока. Ранги (ополченец → чемпион,
разведчик → гусар, рыцарь → паладин…) собраны из вариантов, шлемов, щитов, доспехов и
конских попон 0 A.D. и Millennium A.D.; огнестрел (аркебуза, ручная пушка, пороховница),
алебарда, бомбарда на лафете и пушки галеона — процедурные модели
(`tools/render3d/procmesh.py`) с текстурами, вырезанными из атласа оружия 0 A.D.
(`props/prop_weap.dds`, CC BY-SA 3.0, © Wildfire Games).
Раунд 2 узнаваемости (`docs/research/06_units_recognition.md`): одежда тел 0 A.D. / Millennium A.D.
перекрашена (табарды, сюрко, фартуки, стола, халаты «цвет игрока + белый» —
`tools/render3d/paint.py`: часть треугольников тела получает новую развёртку и узор;
красная и бирюзовая ткань исходных текстур переведена в лён), гербы каплевидных щитов
нарисованы поверх текстуры щита Millennium A.D. (`kite_chiro_white.png`); процедурные
двуручный меч, катана, шапель, ведёрный шлем, кабуто, морион, плюмаж, голова тарана,
брусья и обмотки цвета игрока, косой парус, тент, надстройки галеона, бочки пороха и сифон
брандера (`procmesh.py`) — производные работы по тем же лицензиям; хауда слона, голова
«фанатика» и магазинный арбалет — акторы 0 A.D. (CC BY-SA 3.0, © Wildfire Games).
Копия этой записи лежит в `assets/gen/LICENSE.md`.

Мелкая графика мира — **`assets/gen/decals/`** (индекс `assets/gen/nature_extra.json`,
скрипт `tools/build_decals.py`): рыба (стайки и крупные рыбы 0 A.D. с анимацией
плавания), туши зверей на трёх стадиях разделки (поза смерти 0 A.D., «разделанная»
текстура, череп, мясо, кровь), пни (кора деревьев 0 A.D.), развалины
(`destruct_*`), снаряды (стрела, болт, дротик, камень), а также огонь, дым,
взрыв и круги на воде — кадры офлайн-симуляции частиц на текстурах
`art/textures/particles` 0 A.D. Лицензия: **CC BY-SA 3.0**, © Wildfire Games;
изменения: рендер в изометрии, перекраска (толща воды, кровь, мясо), обводка
снарядов, частицы просчитаны в зацикленные кадры. Копия — `assets/gen/decals/LICENSE.md`.

Пейзажи карт — **`assets/gen/maps/`** (индекс `assets/gen/maps/maps.json`, скрипт
`tools/build_map_assets.py`): плитки земли пустыни, степи, снегов, тропиков и осени (текстуры
`art/textures/terrain/types` 0 A.D.: песок/дюны, саванна, альпийский и полярный снег, тропическая трава,
осенняя трава и подстилка — приведены к изометрии, смягчён контраст, подогнан средний цвет),
деревья пейзажей (пальмы, акации, баобабы, тропические, заснеженные ели, осенние дубы/клёны/буки/тополя —
рендер моделей `art/actors/flora/trees` 0 A.D., тон листвы сдвинут) и волк (модель `fauna/wolf.xml`,
8 направлений). Лицензия: **CC BY-SA 3.0**, © Wildfire Games. Реликвия (`relic.png`) нарисована
скриптом сама, без чужой графики.

### Авторы 0 A.D. (по титрам игры, `gui/credits/texts/art.json`, `audio.json`)

Титры 0 A.D. не привязывают конкретные файлы к конкретным авторам, поэтому
перечисляются все участники разделов «Art» и «Audio».

### Art (3D/2D/animation)

- **Art lead:** Enrique Keykens (Enrique), Johnathan B. Good (LordGood), Michael D. Hafer (Mythos_Ruler), Jason Bishop (Wijitmaker)
- **2D Art:** Kenneth Branch (Annatar), Brendan Keough (b.w.keough), Sebastián Gómez (Basshunter), Nathanael P. Moore (BigTiger), Allen White (Brownboot), Čestmír Dammer (CDmir), Shan Coster (Centurion_13), Praveen Pillai (Childhood Trauma), Gordon Napier (dashinvaine), Zahra Lotfi (dMAthena), David Benjamin (Dnas), Malte Schwarzkopf (Fire Giant), Maximilian Wagenbach (Foaly), GunChleoc, Gunnar Ries Amphibol, Lori Lee (HstryQT), Shan Sherrill (Hyborian), Iko1992, Ryan Karsten (irishstag), Rizki Dhifan (kul), Kürschner, Lana (lanoocha), Valentin Levalet (Leyto), Marcio Duron (Lion.Kanzen), Johnathan B. Good (LordGood), m7600, Mario Machado (mfmachado), Michael D. Hafer (Mythos_Ruler), Micha L. Rieser, Nescio, nifa, Alejandro Liaño (Obskurias), Paul Maritz, Pedro Blanco (pedro_blanco), Pete Unseth, photos-public-domain.com, Pureon, Quartl, raulfabi, real_tabasco_sauce, Hans Heintze (s1lence), Aaron Robinson (Scorpion Ra), Amish Coelho (Shield Bearer), Malcolm Kwadwo Kwarte Quartey (Sundiata), ThorRune, Tsaag Valren, Vantha, Veronica L. Almy Wright, Victor Rossi, Arjel Kenneth Abulog (wackyserious), Jason Bishop (Wijitmaker), Yordan Grigorov (yoreei)
- **3D Art:** Daniel Morgado (Alexandermb), Athos, Atrik, Sebastián Gómez (Basshunter), Nathanael P. Moore (BigTiger), Robert D. Schultz (Brightgalrs), Egbert Tigelaar (Eggbird), Matthijs de Rijk (EmjeR), Enrique Keykens Espolio (Enrique), Daniel Schubert (Gen.Kenobi), Shane (Historicity), Langbart, Valentin Levalet (Leyto), Johnathan B. Good (LordGood), m7600, Micket, Erhard Lipinski (Mr.lie), Michael D. Hafer (Mythos_Ruler), Thomas Eichler (necro), nifa, Johannes(John) Saarniit (Pacman), William Pryn (paperkat), Jeff Groves (privateer), Pureon, Jordan Quackenbush (Quacker), Saurabh Torne (Saurabh), Aaron Robinson (Scorpion Ra), Amish Coelho (Shield Bearer), Slobodan Vidovic (Vido), Stanislas Dolcini (Stan), Strannik, Jason Bishop (Wijitmaker), Gregory Bertilson (Zaggy1024)

### Audio: music, sound, voices

- **Sound Manager:** Damian Kastbauer (lostchocolatelab)
- **Lead Composer:** Omri Lahav (OmriLahav)
- **Audio: music, sound, voices:** Allan Brown (Dariusofwest), Max Whitfield (skymx), Omri Lahav (OmriLahav), Sam Gossner (Samulis), Boris Hansen (Vaevictis_Music)
- **Additional music, percussion, djembe, sampling:** Jeff Willet
- **Additional music:** Mike Skalandunas, Shlomi Nogay
- **Cajon:** S. Edwards
- **Cello:** M. Packman
- **Celtic harp:** Avital Rom
- **Didgeridoo:** Yael Pinto
- **Djembe:** Bar Guzi
- **Dulcimer:** M. Edwards
- **Flute:** Marta Mc'Cave Dayan
- **Frame drum, darbuka, riq, toms:** Dror Parker
- **Guitar:** D. Coutsouridis
- **Handpan:** S. Edwards
- **Harp:** Etherealwinds
- **Shruti Box:** M. Edwards
- **Tin whistles:** Yotam Ronen
- **Trumpet:** Avior Rokah
- **Viola, violin:** Shir-Ran Yinon
- **Sound:** Carsten Rojahn (carsten), Mike Stanton (dungeonsound615), Nolan, Tony, and Lucas (DynamiteSoundBytes), Evan Bogunia (EvanBogunia), Kaitlynn Hegarty (khegarty), LAVS, Marcio Durón (Lion.Kanzen), Damian Kastbauer (lostchocolatelab), Matt Sherman (MattSherman), Pat Mclelland (mclellandp), p0ss, Shawn Anthony Poxleitner (PhoenixDog), Pureon, Ryan Davies (ryan827), Sam Assoum, Sam Gossner (Samulis), Ron Lacy (Wyrmwood)
- **Greek:** Kaitlynn Hegarty (khegarty)
- **Latin:** Camille Tidjditi, Nicolas Auvray (Itms)
- **Napatan:** Marine Hasselvender, Stanislas Dolcini (Stan)
- **Persian:** Bahare Abasian, Mostafa Lotfi (dMZeroCold)
## Millennium A.D. — средневековый мод для 0 A.D.

- Источник: **Millennium A.D.** — <https://github.com/0ADMods/millenniumad>
  (коммит `91636b405ee8d0088ec3a34fba6074dbd5c9d0f3`, ветка `master`, версия мода 0.28.5);
  форум: <https://wildfiregames.com/forum/index.php?/forum/297-1000-ad/>.
- Скачивается скриптом `tools/fetch_millennium.py` в `assets/millenniumad_raw/` (не хранится в git);
  опись — `docs/millenniumad_inventory.md`.
- Авторы (readme мода): NoMolester, Belisarivs, Abadu, Arishia и участники 0 A.D. Council of Modders;
  в файлах моделей также указаны Stanislas Dolcini и Daniel Morgado.

| Что | Путь в моде | Лицензия |
|---|---|---|
| 3D-модели, текстуры, анимации, скелеты, акторы XML (Каролинги, англосаксы, норманны/викинги, Византия, Омейяды, Русь) | `art/` | **CC BY-SA 3.0** © 2015 The Council of Modders, Fallen Empire Studio, Scion Development — файл `art/license.txt` («если не указано иное»; иных указаний в `art/` нет) |
| Часть текстур из материалов CGTextures | `art/textures/` | CC BY-SA 3.0 по специальному разрешению CGTextures (как в 0 A.D.) |
| Код мода (симуляция, интерфейс) | корень, `License.txt` | GPL-2.0 — **не используется** |
| Музыка и звуки мода | `audio/` | **не скачиваются и не используются** |

### Обязательная атрибуция (CC BY-SA 3.0)

> Средневековые здания и юниты: **Millennium A.D.** © The Council of Modders, Fallen Empire Studio,
> Scion Development (<http://www.wildfiregames.com/>, <https://github.com/0ADMods/millenniumad>),
> лицензия CC BY-SA 3.0 (<http://creativecommons.org/licenses/by-sa/3.0/>). Материалы изменены:
> 3D-модели отрендерены в изометрические спрайты и листы кадров анимации.

Производные спрайты распространяются под **CC BY-SA 3.0** (раздел «Share-alike» выше применяется
так же). Материалов под GPL среди использованной графики нет, поэтому отдельной оговорки о
GPL-2.0-or-later для спрайтов не требуется. Мод **Medieval A.D.** (<https://github.com/0ADMods/medievalad>)
рассмотрен и **не используется**: его `LICENSE.MD` перечисляет CC-BY-4.0 и GPL-2.0-or-later без
указания, что к каким файлам относится.

Сводка лицензий всего проекта — `docs/licensing.md`.

## Интерфейс: графика 0 A.D. и шрифты (в репозитории: `assets/ui/`, `assets/fonts/`)

Собирается скриптом `tools/build_ui_assets.py` из `assets/0ad_raw/` (только нужные файлы, ≈16 МБ).

| Что | Откуда в 0 A.D. | Как изменено | Лицензия |
|---|---|---|---|
| Кнопки (деревянная 9-slice), золотые рамки, каменные плитки, текстура панелей, лента, свечение, стрелки, гербовые диски | `art/textures/ui/global/`, `session/`, `tipdisplay/`, `session/icons/bkg/` | DDS → PNG, 9 кусков кнопки собраны в один шаблон, диски уменьшены | **CC BY-SA 3.0** © Wildfire Games |
| Пергамент подсказок | `art/textures/ui/tipdisplay/parchment.png` | обрезан | **CC BY-SA 3.0** © Wildfire Games |
| Портреты юнитов, зданий, технологий, животных и ресурсов | `art/textures/ui/session/portraits/` | уменьшены до 128×128 | **CC BY-SA 3.0** © Wildfire Games |
| Значки ресурсов, населения, набата, отмены, гарнизона, победы/поражения и др. | `art/textures/ui/session/icons/` | уменьшены | **CC BY-SA 3.0** © Wildfire Games |
| Курсоры (стрелка, атака, стройка, добыча, ремонт, лечение) | `art/textures/cursors/` | как есть (+ точки прицела в JSON) | **CC BY-SA 3.0** © Wildfire Games |
| Шрифт Linux Biolinum (заголовки) | `mods/mod/fonts/LinBiolinum_*.ttf` | без изменений | GPL v3+ с font exception (`assets/fonts/LibBiolinum-LICENSE.txt`) |
| Шрифт GNU FreeSans (текст) | `mods/mod/fonts/FreeSans*.ttf` | без изменений | GPL v3+ с font exception (`assets/fonts/FreeFont-LICENSE.txt`) |
| Значки «по словарю DE» (`assets/ui/portraits/de/`): здания-символы, технологии, стойки, значки характеристик, дипломатия | `art/textures/ui/session/portraits/technologies/` | фон затемнён до чёрного по маске предмета, предметы вырезаны и составлены друг с другом (кольчуга + мечи/подкова/стрела, венок + рукопожатие, топор + бревно, щит + мечи), руда и монета тонированы в золото | **CC BY-SA 3.0** © Wildfire Games |
| Курсоры-инструменты (`assets/ui/cursors/de_*.png`) | стрелка `art/textures/cursors/arrow-default-down.png` + вырезанные предметы портретов технологий | составлены, уменьшены до 32×32 | **CC BY-SA 3.0** © Wildfire Games |
| Здания на фоне неба (`assets/ui/portraits/scenic/`), фигурки приказов армии и требушет (`assets/ui/portraits/orders/`), портреты юнитов в кадре DE (`assets/ui/portraits/units3d/`) | 3D-модели 0 A.D. и Millennium A.D. (как `assets/gen/`) | отрендерены `tools/build_portraits.py` (свой ракурс, свет, синий цвет игрока), фон неба и травы, крылья мельницы и поле фермы — свой процедурный рисунок | **CC BY-SA 3.0** © Wildfire Games, © The Council of Modders, Fallen Empire Studio, Scion Development |

Свой процедурный рисунок (без чужих материалов, `tools/ui_icon_art.py`): гербы эпох, короны уникальных
технологий, стопка книг, раскрытая книга, клетчатая ткань, хомут, чаша, луч, литера на блоке, кран,
бойница (со стрелой 0 A.D.), свиток с галочкой, шестерня, рог, строи (шары и треугольник), восьмиугольная
рамка стоек, меч в земле, валун, текстуры панелей по культурам (железо, мрамор, песчаник, лак), канты-орнаменты,
ровный пергамент. Сюжеты значков повторяют общепринятые символы (меч, подкова, якорь…); картинки
Microsoft / Age of Empires не используются и не копируются — эталоны DE служили только для сверки
в исследовании (`docs/research/05_ui_recognition.md`) и в репозиторий не входят.

### Шрифты с Google Fonts (в репозитории: `assets/fonts/`)

| Шрифт | Где в игре | Источник | Лицензия |
|---|---|---|---|
| **PT Serif** (Regular, Bold, Italic) © 2010 ParaType Ltd. | имена, числа ресурсов и характеристик, подсказки (жирная антиква, как в DE) | <https://fonts.google.com/specimen/PT+Serif> (`google/fonts`, `ofl/ptserif`) | **SIL Open Font License 1.1** (`assets/fonts/PTSerif-OFL.txt`) |
| **Cormorant SC** (Bold) © 2015 the Cormorant Project Authors | заголовки меню и экранов (капитель) | <https://fonts.google.com/specimen/Cormorant+SC> (`google/fonts`, `ofl/cormorantsc`) | **SIL Open Font License 1.1** (`assets/fonts/CormorantSC-OFL.txt`) |

Файлы шрифтов не изменены; зарезервированные имена шрифтов (Reserved Font Names) не используются
для других шрифтов. OFL разрешает встраивать и распространять шрифты вместе с игрой.

Файлы в `assets/ui/` — производные работы, распространяются под **CC BY-SA 3.0** с атрибуцией
Wildfire Games (см. `assets/ui/LICENSE.md`). Код интерфейса 0 A.D. (GUI XML/JS, GPL) не используется —
только картинки и шрифты; раскладка экранов своя.

## Не используется

- **OpenEmpires** (<https://github.com/Chilly5/OpenEmpires>): репозиторий под MIT,
  но у графики и музыки нет отдельных титров и указания происхождения. В проект
  ничего из него не берётся.
- Шрифты Source Han Sans (CJK) из 0 A.D. не скачиваются (не нужны для кириллицы).
