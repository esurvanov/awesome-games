# Millennium A.D. — inventory of the fetched subset

Source: <https://github.com/0ADMods/millenniumad> @ `91636b405ee8d0088ec3a34fba6074dbd5c9d0f3`
(master, 2026-04-02, `mod.json` version 0.28.5, depends on `0ad=0.28.0`).
Fetched by `tools/fetch_millennium.py` into `assets/millenniumad_raw/` (gitignored).

The repository does **not** use Git LFS: blobs are plain git objects. The fetcher makes a
blobless shallow clone, sparse-checks-out the XML, walks the actor dependency closure and then
adds exactly the referenced files to the sparse checkout (one batched blob fetch).

## Licensing (exact)

| Path in the mod | License | Holder |
|---|---|---|
| `art/**` (actors, variants, skeletons, meshes, animations, textures) | **CC BY-SA 3.0** — `art/license.txt`: "if not noted otherwise"; no other notes exist anywhere under `art/` (checked: no license/copyright text in any actor/variant XML; DAE `<author>` fields name only "Blender User", Stanislas Dolcini, Daniel Morgado) | © 2015 The Council of Modders, Fallen Empire Studio, Scion Development |
| `art/textures/**` partly derived from CGTextures | CC BY-SA 3.0 by special permission of CGTextures (same clause as 0 A.D.) | originals © CGTextures |
| repository root `License.txt` | GPL-2.0 — covers code (simulation JS, GUI); **not used** | mod authors |
| `audio/` (music by Antti Martikainen and others) | used with permission of the author / various; **not fetched, not used** | — |

Credits (readme): NoMolester, Belisarivs, Abadu, Arishia, the 0 A.D. Council of Modders;
repository maintained under 0ADMods (commits by Stanislas Dolcini).

**Medieval A.D.** (<https://github.com/0ADMods/medievalad>, Teutonic Order + Poland) was
evaluated and **not used**: its `LICENSE.MD` only lists two SPDX identifiers
(`CC-BY-4.0`, `GPL-2.0-or-later`) without saying which applies to which files, so the art
license is not clear per directory (GPL-only art could not be combined with CC BY-SA 3.0
0 A.D. textures in one sprite).

## Size

| | files | MB |
|---|---:|---:|
| `art/textures/skins` | 740 | 414 |
| `art/meshes/structural` | 186 | 83 |
| `art/meshes/props` + `skeletal` | 271 | 28 |
| `art/animation` (biped, mechanical, other) | 57 | 29 |
| actors + variants XML | 695 | 1.3 |
| **mod files total** | 1 945 | **556** (+ ~400 MB git packs in `_repo/.git`) |
| 0 A.D. `public` files the mod references that the 0 A.D. subset lacked → `public_deps/` | 191 | 56 |

Dangling references in the mod itself (skipped, as the engine does): 5
(`props/structures/persians/stable_horse_*`, `props/units/heads/new/head_pers_*`).

## Content (civs of the mod)

| Mod civ (folder) | Structures (`structures/<civ>/`) | Units (`units/<civ>/`) |
|---|---|---|
| Carolingians (`carolingian`, `caro`) | civil_centre, house (2), farmstead, storehouse, blacksmith, church, lorsch_abbey, lorsch_gate, market, jarls_hold, longhouse, fortress (ring fort), sentry/defense tower, stables¹, mayenne¹, dock_base/structure, watermill, walls (long/medium/short/tower/gate) | infantry sword/spear/javelin/archer (b/a/e), champion (mace), cavalry spear/archer, female citizen, healer (monk), trader, **trebuchet** and **traction trebuchet** (packed/deployed) with operators |
| Anglo-Saxons (`anglo`) | civil_center, house (4), farmstead, storehouse, barracks, stables, blacksmith, temple, market, fortress (palisade + stone keep), defense_tower, dock, walls | infantry sword/spear/javelin, champion, cavalry spear (horse actors without `_m`) |
| Norse (`norse`) | jarls_hold, longhouse, house, barracks, blacksmith, storehouse, temple, market, outpost, defense_tower, dock (+ parts), walls; ships drakkar, karvi, knarr, snekkja, fishing boat | infantry sword/spear/archer, champion berserker, huscarl, female citizen, trader |
| Byzantines (`byzantines`) | civic_center (3), house (5), farmstead, storehouse, barracks (2), range, stable, blacksmith, armory, temple (2), library, market, fortress, towers, dock, walls (3 styles); ships dromon, light warship, merchant, fishing | full roster incl. cataphract-like heavy cavalry, horse archers, siege ram, trebuchet |
| Umayyads (`umayyads`) | civic_center, house (5), farmstead, granary, storehouse, military_colony, stables, blacksmith, temple (mosque), market, fortress, towers | infantry, clubmen, camel archers, cavalry, female citizen, healer, trader |
| Rus (`rus`, partial) | civic_center, house, farmstead, storehouse, barracks, stables, blacksmith, temple, market, fortress, hunting_lodge, trading_post, sentry_tower, dock | infantry, archers, scouts, cavalry, priest |

¹ broken in the mod (mesh UVs do not match the referenced texture) — not used.
No male citizen actors in the mod: male villagers stay 0 A.D. `citizen_male` (neutral peasants).
No crossbowmen: 0 A.D. `macedonians/infantry_crossbowman_c` stays.

## Our mapping (see `tools/build_sprites.py` `MED`, `tools/build_units.py` `UGROUPS`)

| Our civs | Building group | Architecture | Unit group |
|---|---|---|---|
| franks | `caro` | Carolingian | caro |
| teutons | `teut` | Carolingian + Byzantine stone castle/towers/walls | caro |
| britons | `anglo` | Anglo-Saxon | anglo |
| celts | `celt` | Anglo-Saxon + Norse | anglo |
| vikings | `norse` | Norse (+ Carolingian ring fort as castle) | norse |
| goths | `rus` | Rus (log architecture) | rus |
| byzantines | `byz` | Byzantine | byz |
| spanish | `hisp` | Byzantine + Umayyad (alcázar) + Carolingian church | caro |
| persians, saracens, turks | `umay` | Umayyad | umay |
| chinese, japanese, mongols | `han` | 0 A.D. Han | han |

Kinds missing from the mod come from 0 A.D.: archery range and siege workshop (`germans/range`,
`germans/workshop`), great hall (`germans/great_hall`), Persian hall (`achaemenids/hall`),
palisade (`germans/wooden_wall_*`), mud-brick walls (`achaemenids/wall_*`), scaffolding and
foundations (`structures/fndn_*`, `props/structures/construction/scaf_*`).
