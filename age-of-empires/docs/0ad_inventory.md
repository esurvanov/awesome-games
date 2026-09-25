# 0 A.D. asset inventory (raw subset)

Source: `https://gitea.wildfiregames.com/0ad/0ad` @ `0ed48b3a1fb1b4b718a78869fa497185af55e086`
(main, 2026-09-24). The old GitHub mirror `github.com/0ad/0ad` is archived since
2024-08 and is **not** used. Upstream stores `*.dae *.dds *.png *.ogg *.psa *.pmd *.ttf *.otf`
in **Git LFS**; `tools/fetch_0ad.py` clones blobless + sparse with LFS smudge
disabled, resolves actor dependencies and pulls only the needed LFS objects
through the LFS batch API (sha256-verified). Re-run = incremental.

Licenses → see `CREDITS.md`. Short version: `art/` and `audio/` = **CC BY-SA 3.0**
© Wildfire Games; fonts = DejaVu / GNU FreeFont (GPLv3+FE) / Linux Biolinum (GPL+FE).

## Totals

| | files | size |
|---|---:|---:|
| **all** | 10 718 | **2.37 GB** |
| `public/art/textures/terrain` | 352 | 630 MB |
| `public/art/animation/biped` | ~425 | 595 MB |
| `public/art/textures/skins` | ~1 800 | 505 MB |
| `public/audio/music` | 36 | 136 MB |
| `public/art/meshes/structural` | 396 | 130 MB |
| `public/art/animation/quadraped` | 134 | 93 MB |
| `public/art/textures/ui` | 1 120 | 78 MB |
| `public/art/meshes/props` | 838 | 55 MB |
| `public/art/animation/mechanical` | 79 | 35 MB |
| `public/audio/*` (SFX, amb., voices) | 917 | 42 MB |
| `public/art/textures/animated/water` | 242 | 19 MB |
| meshes skeletal + gaia | 334 | 22 MB |
| XML (actors, variants, materials, terrains, skeletons, particles, sound groups) | 3 598 | 4 MB |
| `mod/fonts` (8 TTF + licenses) | 13 | 6 MB |

Per format (before berry/decor add-on, +161 small files): PNG 3 160 (1.16 GB) · DAE 2 251 (0.94 GB) · OGG 953 (178 MB) ·
DDS 422 (64 MB) · TGA 60 · TTF 8 · XML 3 598. **No PMD/PSA** in this subset:
all meshes and animations are COLLADA `.dae`.

## Directory map (`assets/0ad_raw/`)

```
_repo/                      sparse git checkout (XML + LFS pointers), cache only
manifest.json               path, size, sha256 of every fetched file
public/art/actors/          entity descriptions (XML): structures/, units/, props/, flora/, geology/, fauna/, particle/
public/art/variants/        reusable <variant> blocks (animations sets, shields, capes…)
public/art/meshes/          structural/ (buildings, ships, siege), skeletal/ (bodies, horses, animals), props/, gaia/
public/art/animation/       biped/, quadraped/, mechanical/, other(s)/  (.dae)
public/art/skeletons/       skeleton bone-mapping XML (all 81)
public/art/materials/       material → shader defines (all)
public/art/textures/skins/  structural/, skeletal/, props/, gaia/  (baseTex/normTex/specTex/aoTex)
public/art/textures/terrain types/ (DDS+PNG) + alphamaps/ (terrain blend masks)
public/art/terrains/        terrain XML (all groups; textures fetched for temperate/europe/autumn/nordic,
                            grass, dirt, forestfloor, road, sand, shoreline, cliff, water, special)
public/art/textures/ui/     session/ (portraits units/structures/technologies/gaia/emblems, icons, resources),
                            global/ (buttons, borders, tiles), tipdisplay/, pregame/ (no big backgrounds)
public/art/textures/{cursors,selection,particles,animated/water}/
public/audio/               music/ (36 tracks), attack/, actor/, resource/, interface/, ambient/, voice/{greek,latin,global}
public/gui/credits/         credits JSON (source of names for CREDITS.md)
mod/fonts/                  DejaVuSansMono, FreeSans*, FreeMono, LinBiolinum_* + licenses
```

## Formats and conversion

| Format | pygame-ce 2.5.8 | Plan |
|---|---|---|
| PNG (RGBA, 8-bit) | ✅ loads | direct |
| DDS (DXT1 50 · DXT3 212 · DXT5 97 · uncompressed 63) | ❌ "Unsupported image format" | **Pillow 12.3** (installed in `.venv`) decodes all 422 → convert once to PNG in the build step |
| TGA | ✅ | direct |
| OGG Vorbis | ✅ `mixer.Sound` and `mixer.music` | direct (maybe down-mix / normalise) |
| DAE (COLLADA 1.4, Z-up) | — | render offline → sprites. `pycollada` 0.9.3 parses 100 % of sampled meshes (incl. skin controllers); `trimesh` loads static meshes (not skinned ones). Animation DAEs: pycollada fails on ~35 % (`DaeMalformedError` on sampler arrays) → animation channels need a small custom lxml reader (bone matrices per keyframe) |
| sound-group XML (`audio/**/*.xml`) | — | lists the ogg variants + gain/pitch jitter per event; read with ElementTree |
| TTF | ✅ `pygame.font.Font` | DejaVu/FreeSans/Biolinum cover Cyrillic |

## Actor XML system (what the renderer must emulate)

- **Actor** = `<actor>` with several `<group>`s; each group picks **one `<variant>`** (weighted by `frequency`, or by name: e.g. `alive`/`death`, `garrisoned`, `gate_open`). The final look = merge of chosen variants.
- A variant may set `<mesh>` (path under `art/meshes/`), `<textures>` (`baseTex`, `normTex`, `specTex`, `aoTex` under `art/textures/skins/`), `<props>`, `<animations>`, or pull a shared block via `<variant file="biped/…xml">` (`art/variants/`).
- **Props**: `<prop actor="…" attachpoint="head|weapon_R|shield|helmet|props|smoke|garrisoned|root…">` — attached to the mesh node/bone named `prop_<attachpoint>` (or `prop-<attachpoint>`); `root` = model origin. Props nest recursively (heads, helmets, shields, weapons, horses' riders, roof tiles, clutter).
- **Cavalry** = two actors: `*_m.xml` (mount/horse, skeleton `horse`) + `*_r.xml` (rider) attached on the horse's rider point.
- **Materials** (`<material>`): `player_trans_*` → `USE_PLAYERCOLOR`; `objectcolor*` → `USE_OBJECTCOLOR`; `*_trans` → alpha-tested; `*_ao*` → second UV set for `aoTex`; `*_parallax` → height in `normTex.a`; `*_wind` → foliage sway.
- **Player colour rule** (shader `model_common.fs`): `diffuse *= mix(playerColor, 1, baseTex.a)` → **alpha 0 = full team colour, alpha 1 = untouched**. Many building base textures have α = 255 (colour sits on props/banners/roof textures); ~75 % of unit skins use α < 255. For sprites: render twice (neutral + mask from `1-alpha`) and tint the mask at runtime in pygame.
- **Animation names** (from variants): `Idle`, `Walk`, `Run`, `attack_melee`, `attack_ranged`, `attack_slaughter`, `attack_capture`, `death`/`Death`, `gather_tree|grain|fruit|meat|rock|ore|fish`, `carry_food|wood|stone|metal|meat|fish`, `build`, `Build_farm`, `Heal`, `promotion`, gates: `gate_open|opening|closed|closing`. Each `<animation file=… speed=… event=… load=…>`; `event` = fraction of the cycle where the hit/sound happens.
- **Skeletons**: skinned meshes/animations are matched to a standard skeleton by root name via `art/skeletons/*.xml` (`biped`, `horse`, `sheep`, `deer`, `boar`, siege rigs…).
- **Terrain** XML: `baseTex` (+norm/spec) under `art/textures/terrain/`; blends via `alphamaps/`.
- **Foundations / destruction**: `structures/fndn_WxH.xml` (construction scaffold), `destruct_*` (rubble).

## Suggested mapping (our game → 0 A.D. actors, paths under `public/art/actors/`)

### Civ → 0 A.D. architecture set

> **Superseded (2026-09):** buildings and most units now come from the medieval mod
> Millennium A.D. — see `docs/millenniumad_inventory.md` for the current civ → art mapping.
> The table below is the original 0 A.D.-only plan (still used for the Han group and fallbacks).

| Our civs | Buildings from | Units (bodies/heads/shields) from |
|---|---|---|
| britons, celts | `structures/britons/`, `structures/celts/` | `units/britons/`, `units/gauls/` |
| franks | `structures/gauls/` (+ `romans/` stone walls) | `units/gauls/` |
| teutons, goths, vikings | `structures/germans/` (+ `viking/longship.xml`) | `units/germans/` |
| spanish | `structures/iberians/` | `units/iberians/` |
| byzantines | `structures/romans/` | `units/romans/` |
| persians, saracens, turks | `structures/achaemenids/` | `units/achaemenids/` |
| chinese, japanese, mongols | `structures/han/` | `units/han/` |

### Buildings (`<set>` = folder above)

| Ours | 0 A.D. actor | notes |
|---|---|---|
| town_center | `<set>/civic_centre.xml` (`iberians/civic_center`, `han`/`achaemenids/civil_centre`) | |
| house | `<set>/house.xml` | 4 random variants in britons |
| mill | `<set>/farmstead.xml` | |
| lumber_camp, mining_camp | `<set>/storehouse.xml` | |
| farm | `structures/plot_field_temp.xml` (+ `plot_field_found.xml` for construction) | |
| barracks | `<set>/barracks.xml` (gauls → `britons/barracks`) | |
| archery_range | `<set>/range.xml` | |
| stable | `<set>/stable.xml` | |
| blacksmith | `<set>/blacksmith.xml` (`germans/forge`, `han/forge`) | |
| tower | `<set>/scout_tower.xml` → `wooden_tower.xml` → `germans/defense_tower`, `romans/tower_bolt` | age upgrades |
| siege_workshop | `<set>/workshop.xml` (`han/arsenal`) | |
| castle | `<set>/fortress.xml` | |
| monastery | `<set>/temple.xml` (`han/temple`, `achaemenids/temple`) | |
| market | `<set>/market.xml` (`celts/market_newest`) | |
| dock | `<set>/dock.xml` | |
| university | `han/academy.xml` or `achaemenids/hall.xml` | no European analogue |
| walls / gate | `<set>/wall_{short,medium,long,tower,gate}.xml`; palisade: `germans/wooden_wall_*` | gates have open/close anims |
| construction | `structures/fndn_<W>x<H>.xml` | |
| rubble | `structures/destruct_stone_*`, `destruct_wood_3x3` | |

### Units

| Ours | 0 A.D. actor |
|---|---|
| villager (m/f) | `units/<civ>/citizen_male.xml`, `citizen_female.xml` / `female_citizen.xml` (all gather/carry/build anims) |
| militia / man-at-arms | `units/<civ>/infantry_swordsman_b.xml` → `_c` (champion) for later ranks |
| spearman / pikeman | `units/<civ>/infantry_spearman_b.xml`; `han/infantry_halberdman_b` |
| archer | `units/athenians/infantry_archer_b.xml` (Cretan, European look), `achaemenids/`, `han/infantry_archer_b` |
| crossbowman | `han/infantry_crossbowman_b`, `macedonians/infantry_crossbowman_c` (gastraphetes) |
| skirmisher | `units/<civ>/infantry_javelinist_b.xml` |
| slinger (optional) | `units/<civ>/infantry_slinger_b.xml` |
| scout | `germans/cavalry_scout.xml` (+`_r`) or `<civ>/cavalry_javelinist_b_m/_r` |
| knight | `romans/cavalry_swordsman_c_m/_r`, `germans/cavalry_swordsman_c_m/_r`, `<civ>/cavalry_swordsman_b_m/_r` |
| cavalry archer | `achaemenids/cavalry_archer_b_m/_r`, `han/cavalry_archer_b_m/_r` |
| monk | `<civ>/healer.xml` (`germans/healer_b`) |
| trade cart | `<civ>/trader.xml` |
| ram | `romans/siege_ram.xml`, `germans/siege_ram.xml` (`log_ram`), `iberians`/`celts`/`achaemenids/siege_ram.xml` |
| mangonel | `romans/siege_onager.xml`, `han/siege_mangonel.xml` |
| scorpion | `romans/siege_scorpio.xml`, `romans/siege_ballista.xml` |
| trebuchet | none in 0 A.D. → `romans/siege_rock.xml` as placeholder |
| fishing ship | `celts/fishing_boat.xml`, `germans/fishing_boat.xml`, `iberians/fishing_ship.xml` |
| transport / trade cog | `germans/ship_knarr.xml`, `celts/merchant_ship.xml`, `romans/merchantman.xml` |
| galley / war ship | `viking/longship.xml`, `germans/ship_karvi|snekkja|arrow.xml`, `romans/trireme.xml`, `celts/warship.xml` |
| fire ship | `iberians/fireship.xml`, `han/fireship.xml` |

### Nature

| Ours | 0 A.D. actor |
|---|---|
| tree (mixed forest) | `flora/trees/oak*.xml`, `european_beech.xml`, `euro_birch_tree.xml`, `poplar.xml`, `pine.xml`, `fir_tree.xml`, `temperate_forest_biome_tree.xml` |
| berries | `props/flora/berry_bush*.xml`, `bush_berries_large.xml` (+ eye-candy: `props/flora/bush_tempe_*`, `grass_temp_*`, `ferns`, `reeds_*`) |
| gold mine | `geology/metal_temperate_{round,small,square}.xml`, `metalmine_temperate_slabs.xml` |
| stone mine | `geology/stonemine_temperate_quarry*.xml`, `stone_granite_*.xml` |
| sheep / deer / boar | `fauna/sheep{1,2,3}.xml`, `fauna/deer*.xml`, `fauna/boar.xml` (+ `wolf`, `bear_brown`, `cow`, `chicken`, `goat`) |
| fish / whale | `fauna/fish.xml`, `fish_generic.xml`, `whale.xml` |

### Terrain textures (`public/art/textures/terrain/types/`)

grass → `temperate/`, `grass*` groups; dirt → `temp_dirt_*`; farmland → `temperate/farmland_01.png`, `temp_farmland`;
forest floor → `temperate/forestfloor_*`, `autumn_forestfloor_*`; beach/sand → `sand`, `shoreline` groups;
cliffs → `temp_cliff_*`, `cliff_*`; roads → `road` group; water normals → `textures/animated/water/`.

### UI

portraits: `textures/ui/session/portraits/{units/<civ>,structures,technologies,gaia}/*.png` (256×256 RGBA);
resource icons: `session/icons/resources/{food,wood,stone,metal,population,time}(_small).png`;
buttons/borders/tiles: `global/button/*`, `global/border/*`, `global/tile/stone_background*.png`, `tipdisplay/*`;
phase emblems: `session/panel_phase_emblems_*.png`; cursors: `textures/cursors/`.

### Audio (sound-group XML → ogg files beside it)

| Event | Path |
|---|---|
| melee / ranged attack | `attack/weapon/{sword,spear,pike,bow,javelin,sling}_attack.xml`, `attack/impact/*` |
| death | `actor/human/death/*`, `actor/mounted/death/*`, `actor/fauna/death/*` |
| chop / mine / farm / forage / hunt | `resource/lumbering/`, `resource/mining/`, `resource/farming/`, `resource/foraging/`, `resource/gathering/gather_meat.xml` |
| construction / complete | `resource/construction/con_{wood,stone,saw}.xml`, `interface/complete/building/*` |
| alarms (under attack, idle, phase, tech done, victory/defeat) | `interface/alarm/*.xml` |
| selection clicks | `interface/select/building/*`, `interface/select/resource/*`, `interface/ui/*` |
| horse / siege / ship / gate | `actor/mounted/movement`, `attack/siege/*`, `actor/ship/*`, `actor/gate/*` |
| ambience | `ambient/dayscape/day_temperate.xml`, `ambient/water/*`, `ambient/building/*` |
| music: peace | Celtica, Celtic_Pride, Highland_Mist, Harvest_Festival, Tavern_in_the_Mist, Northern_Frontier, Albian_Nocturne, Mountain_Idyll, Sunrise, The_Fledgling_Kingdom, Water's_Edge, As_Seasons_Change, Midwinter, Solstice_Festival, Forging_a_City-State, The_Road_Ahead, Eastern_Dreams, Juno_Protect_You, Cisalpine_Gaul, Harvest_Moon |
| music: battle | Honor_Bound, Tale_of_Warriors, Red_Dawn, Calm_Before_the_Storm, Point_of_No_Return, Harsh_Lands_Rugged_People, A_Brothers_Revenge, Bandit_Country, Taiko_1, Taiko_2, Upstart_King |
| music: menu / end | Epitaph (menu), You_are_Victorious!, Dried_Tears, Hill_of_Sorrows, An_old_Warhorse_goes_to_Pasture |

In-game subset: `tools/build_audio.py` → `assets/audio/` (committed; Opus, loudness-normalised; per-file source/licence in `assets/audio/manifest.json`). Note: `pygame.mixer.music` picks the decoder by extension — Opus must be saved as `.opus`, not `.ogg`.

## Offline sprite-rendering toolchain probe (M1 Pro, macOS, Python 3.14 venv)

| Package | Result |
|---|---|
| `moderngl` 5.12 | ✅ `create_standalone_context()` headless (CGL, "Apple M1 Pro, 4.1 Metal"), FBO render + readback OK, max texture 16384 |
| `pycollada` 0.9.3 | ✅ meshes + skin controllers; ⚠ ~35 % of animation DAEs fail to parse → custom reader needed |
| `trimesh` 5.1 | ✅ static DAE (buildings, trees); ❌ skinned meshes load empty |
| `pyrender` 0.1.45 | ✅ OffscreenRenderer works via pyglet hidden window (needs a logged-in GUI session; not usable over pure SSH). Pins PyOpenGL 3.1.0 |
| `Pillow` 12.3 | ✅ decodes all DDS (DXT1/3/5, raw) |

Recommendation: moderngl (standalone) + own COLLADA loader (pycollada for geometry/skin, lxml for animation samplers) + Pillow for textures.

## Units (skinned, animated) → `assets/gen/units/`

`tools/build_units.py` (skinning/animation: `tools/render3d/skin.py`, actor states: `tools/render3d/animactor.py`)
renders every unit kind into per-model sprite sheets: 8 directions × animations (idle, walk, carry_*, chop, mine,
farm, forage, butcher, build, attack, death), 256-colour palette PNG + L8 player-colour mask + frame JSON; index in
`units/index.json` maps (unit kind, civ group) → sheet. Animation DAEs are read with ElementTree (all 691 parse);
joints are matched by node name; props follow animated prop points (rider on horse `rider`, weapons, capes with the
parent's variant names). Contact sheets: `tools/unit_sheet.py`.

## Excluded on purpose

- Source Han Sans CJK fonts (large, not needed).
- UI: map previews, loading/tips images, pre-game background paintings (big, off-theme).
- Audio: Napatan/Persian voices, weather ambience; music not in the list above.
- Civ sets not fitting the setting (Kushites, Mauryas, Ptolemies, Seleucids, Carthaginians, Hellenic cities) except the two archer actors.
- Wonders, theatres, palaces, lamassu, other monumental/special buildings.
- `gui/**` code, sprites XML and shaders (GPL v2+): not used as assets; shader only read for the player-colour formula.
