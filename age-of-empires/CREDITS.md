# Credits and licenses

The code of the game "Chronicles of Kingdoms" is the original work of this repository's authors.
It is **not** derived from the code of 0 A.D. and is distributed under its own terms. Below are the third-party
materials (graphics, sound, music, fonts) that the game uses or may use. The project contains no
Microsoft / Age of Empires materials.

## 0 A.D. - Wildfire Games

- Source: 0 A.D. by **Wildfire Games** - <https://www.wildfiregames.com/>,
  <https://play0ad.com/>, repository <https://gitea.wildfiregames.com/0ad/0ad>
  (commit `0ed48b3a1fb1b4b718a78869fa497185af55e086`, branch `main`).
- Downloaded by the script `tools/fetch_0ad.py` into `assets/0ad_raw/` (not stored in git).

| What | Path in 0 A.D. | License |
|---|---|---|
| 3D models (DAE/PMD), skin/terrain/UI textures, animations (DAE/PSA), skeletons, actor XML, materials, particles, icons/portraits | `binaries/data/mods/public/art/` | **CC BY-SA 3.0** (c) Wildfire Games |
| Music, sound effects, voices, ambient | `binaries/data/mods/public/audio/` | **CC BY-SA 3.0** (c) Wildfire Games |
| Credits files (`gui/credits/texts/*.json`) - only as a source of names | `binaries/data/mods/public/gui/` | GPL v2 or later |
| DejaVu Sans Mono fonts | `binaries/data/mods/mod/fonts/` | Bitstream Vera / DejaVu (free license, see `DejaVu-LICENSE.txt`) |
| GNU FreeFont fonts (FreeSans, FreeMono) | same | GPL v3+ with the font exception |
| Linux Biolinum fonts | same | GPL (with the font exception), as stated in `LibBiolinum-LICENSE.txt` |

The CC BY-SA 3.0 license: <https://creativecommons.org/licenses/by-sa/3.0/>
(full text: <https://creativecommons.org/licenses/by-sa/3.0/legalcode>).

Some 0 A.D. textures were derived from CGTextures materials (<http://www.cgtextures.com/>,
now Textures.com); CGTextures gave Wildfire Games special permission to distribute
these derived textures under CC BY-SA. The CGTextures originals remain the property of
CGTextures and are not covered by this license.

### Required attribution (CC BY-SA 3.0)

> Graphics, animations, music and sounds: **0 A.D.** (c) Wildfire Games
> (<http://www.wildfiregames.com/>), license CC BY-SA 3.0
> (<http://creativecommons.org/licenses/by-sa/3.0/>). The materials were modified:
> 3D models were rendered into isometric sprites, textures and sounds were
> converted/re-encoded.

This line must be visible in the game's credits and in this file.

### Share-alike: derived sprites

Sprites, atlases, icons, re-encoded sounds and any other files
**derived from** 0 A.D. materials (rendering models into isometric views, recoloring,
slicing, compression, mixing) are derivative works and are
**distributed under the same CC BY-SA 3.0 license**, with attribution to
Wildfire Games and a note that the material was modified. Keep these files
in a separate folder with a copy of this section.
The license for derived assets does not extend to the game code.

### Sounds and music in the game: `assets/audio/` (stored in git)

All files in `assets/audio/` are **derivatives** of 0 A.D. audio (c) Wildfire Games,
license **CC BY-SA 3.0** (text - `assets/audio/LICENSE.txt`), distributed
under the same license. Changes: loudness normalized, silence trimmed from effects
and long tails shortened, the pitch of some effects shifted, everything re-encoded to
Opus. Built by the script `tools/build_audio.py` from `assets/0ad_raw/`.
`assets/audio/manifest.json` gives, for **every file**, the source path in the
0 A.D. repository, the license, the attribution and what was changed.

- **Music** (lead composer Omri Lahav and the Audio section contributors below):
  menu - *Epitaph*; peaceful - *Celtica, Celtic Pride, Highland Mist, Harvest Festival,
  Tavern in the Mist, Northern Frontier, Albian Nocturne, Mountain Idyll, Sunrise,
  The Fledgling Kingdom, Water's Edge, As Seasons Change, Midwinter, Solstice Festival,
  Eastern Dreams, Cisalpine Gaul, The Road Ahead*; battle - *Honor Bound, Tale of Warriors,
  Red Dawn, Calm Before the Storm, Point of No Return, Harsh Lands Rugged People,
  A Brothers Revenge, Bandit Country, Taiko 1, Taiko 2, Upstart King*;
  results - *You are Victorious!*, *Dried Tears*.
- **Effects**: weapons and hits (`attack/`), shouts and deaths (`actor/`),
  gathering and construction (`resource/`), signals and building sounds (`interface/`),
  a surf fragment (`ambient/water/wave_21.ogg`).
- **Voices**: short lines in Latin (`voice/latin/civ/`; voiced by
  Camille Tidjditi, Nicolas Auvray).

**`assets/gen/`** holds such derivative works: isometric sprites of buildings
(10 architectural sets, house variants, docks in 4 rotations, construction stages),
walls and gates (with foundations and construction scaffolding), trees, bushes,
mines, fields, animals and ground texture tiles, rendered from 0 A.D. models and
textures and from the **Millennium A.D.** mod (see the section below) by the script
`tools/build_sprites.py` (the renderer is `tools/render3d/`).
License: **CC BY-SA 3.0**, (c) Wildfire Games and (c) The Council of Modders, Fallen Empire
Studio, Scion Development (for the Millennium A.D. parts); changes: models rendered in
orthographic isometry with new lighting and shadows, downscaled, recolored
(player-color mask, gold tinting), ground textures projected into isometry.
Units - **`assets/gen/units/`**: frame sheets of animated units (villagers,
infantry, cavalry, camels, elephant, monks, carts, siege machines, ships,
sheep, deer, boars), rendered by the script `tools/build_units.py` from
0 A.D. and Millennium A.D. skeletal models, skin controllers and animations (walking, working,
attacking, dying; 8 directions). License: **CC BY-SA 3.0**, (c) Wildfire Games,
(c) The Council of Modders, Fallen Empire Studio, Scion Development;
changes: skeletal animations baked into separate frames, models assembled from
parts (a rider on a horse, a crew on a machine), mirrored horizontally,
rendered in isometry with new lighting and shadows, downscaled, the palette
reduced to 256 colors, a player-color mask added. The ranks (militia -> champion,
scout -> hussar, knight -> paladin...) are assembled from 0 A.D. and Millennium A.D. variants, helmets, shields, armor and
horse blankets; firearms (arquebus, hand cannon, powder keg),
the halberd, a bombard on a carriage and the galleon's cannons are procedural models
(`tools/render3d/procmesh.py`) with textures cut from the 0 A.D. weapons atlas
(`props/prop_weap.dds`, CC BY-SA 3.0, (c) Wildfire Games).
Recognition round 2 (`docs/research/06_units_recognition.md`): the clothing of 0 A.D. / Millennium A.D. bodies
was recolored (tabards, surcoats, aprons, stoles, robes in "player color + white" -
`tools/render3d/paint.py`: some body triangles get a new unwrap and a pattern;
the red and turquoise cloth of the source textures was turned into linen), the crests of the kite shields
are drawn over the Millennium A.D. shield texture (`kite_chiro_white.png`); the procedural
two-handed sword, katana, chapel de fer, bucket helmet, kabuto, morion, plume, ram head,
player-color beams and wrappings, lateen sail, awning, galleon superstructures, powder barrels and the fire ship's siphon
(`procmesh.py`) are derivative works under the same licenses; the elephant's howdah, the head of the
"fanatic" and the repeating crossbow are 0 A.D. actors (CC BY-SA 3.0, (c) Wildfire Games).
A copy of this entry is in `assets/gen/LICENSE.md`.

Small world graphics - **`assets/gen/decals/`** (index `assets/gen/nature_extra.json`,
script `tools/build_decals.py`): fish (shoals and large 0 A.D. fish with a swimming
animation), animal carcasses at three stages of butchering (the 0 A.D. death pose, a "butchered"
texture, a skull, meat, blood), stumps (0 A.D. tree bark), ruins
(`destruct_*`), projectiles (arrow, bolt, dart, stone), as well as fire, smoke,
explosion and water rings - frames of an offline particle simulation on the 0 A.D.
`art/textures/particles` textures. License: **CC BY-SA 3.0**, (c) Wildfire Games;
changes: isometric rendering, recoloring (water depth, blood, meat), outlining of the
projectiles, particles baked into looped frames. A copy - `assets/gen/decals/LICENSE.md`.

Map landscapes - **`assets/gen/maps/`** (index `assets/gen/maps/maps.json`, script
`tools/build_map_assets.py`): ground tiles for desert, steppe, snow, tropics and autumn (0 A.D. textures
`art/textures/terrain/types`: sand/dunes, savanna, alpine and polar snow, tropical grass,
autumn grass and litter - brought to isometry, contrast softened, average color adjusted),
landscape trees (palms, acacias, baobabs, tropical trees, snowy firs, autumn oaks/maples/beeches/poplars -
renders of the `art/actors/flora/trees` models of 0 A.D., foliage tone shifted) and a wolf (the `fauna/wolf.xml` model,
8 directions). License: **CC BY-SA 3.0**, (c) Wildfire Games. The relic (`relic.png`) is drawn
by our own script, without anyone else's graphics.

### 0 A.D. authors (per the game's credits, `gui/credits/texts/art.json`, `audio.json`)

The 0 A.D. credits do not tie particular files to particular authors, so
all contributors of the "Art" and "Audio" sections are listed.

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

## Millennium A.D. - a medieval mod for 0 A.D.

- Source: **Millennium A.D.** - <https://github.com/0ADMods/millenniumad>
  (commit `91636b405ee8d0088ec3a34fba6074dbd5c9d0f3`, branch `master`, mod version 0.28.5);
  forum: <https://wildfiregames.com/forum/index.php?/forum/297-1000-ad/>.
- Downloaded by the script `tools/fetch_millennium.py` into `assets/millenniumad_raw/` (not stored in git);
  inventory - `docs/millenniumad_inventory.md`.
- Authors (the mod's readme): NoMolester, Belisarivs, Abadu, Arishia and the 0 A.D. Council of Modders members;
  the model files also name Stanislas Dolcini and Daniel Morgado.

| What | Path in the mod | License |
|---|---|---|
| 3D models, textures, animations, skeletons, actor XML (Carolingians, Anglo-Saxons, Normans/Vikings, Byzantium, Umayyads, Rus) | `art/` | **CC BY-SA 3.0** (c) 2015 The Council of Modders, Fallen Empire Studio, Scion Development - file `art/license.txt` ("unless stated otherwise"; there is no other statement in `art/`) |
| Some textures from CGTextures materials | `art/textures/` | CC BY-SA 3.0 by special permission of CGTextures (as in 0 A.D.) |
| The mod's code (simulation, interface) | root, `License.txt` | GPL-2.0 - **not used** |
| The mod's music and sounds | `audio/` | **not downloaded and not used** |

### Required attribution (CC BY-SA 3.0)

> Medieval buildings and units: **Millennium A.D.** (c) The Council of Modders, Fallen Empire Studio,
> Scion Development (<http://www.wildfiregames.com/>, <https://github.com/0ADMods/millenniumad>),
> license CC BY-SA 3.0 (<http://creativecommons.org/licenses/by-sa/3.0/>). The materials were modified:
> 3D models were rendered into isometric sprites and animation frame sheets.

Derived sprites are distributed under **CC BY-SA 3.0** (the "Share-alike" section above applies
in the same way). None of the graphics used is under the GPL, so a separate note about
GPL-2.0-or-later for the sprites is not needed. The **Medieval A.D.** mod (<https://github.com/0ADMods/medievalad>)
was reviewed and is **not used**: its `LICENSE.MD` lists CC-BY-4.0 and GPL-2.0-or-later without
saying which applies to which files.

The license summary for the whole project - `docs/licensing.md`.

## Interface: 0 A.D. graphics and fonts (in the repository: `assets/ui/`, `assets/fonts/`)

Built by the script `tools/build_ui_assets.py` from `assets/0ad_raw/` (only the needed files, about 16 MB).

| What | Where in 0 A.D. | How modified | License |
|---|---|---|---|
| Buttons (wooden 9-slice), gold frames, stone tiles, panel texture, ribbon, glow, arrows, crest discs | `art/textures/ui/global/`, `session/`, `tipdisplay/`, `session/icons/bkg/` | DDS -> PNG, the 9 button pieces assembled into one template, discs downscaled | **CC BY-SA 3.0** (c) Wildfire Games |
| Tooltip parchment | `art/textures/ui/tipdisplay/parchment.png` | cropped | **CC BY-SA 3.0** (c) Wildfire Games |
| Portraits of units, buildings, technologies, animals and resources | `art/textures/ui/session/portraits/` | downscaled to 128x128 | **CC BY-SA 3.0** (c) Wildfire Games |
| Icons for resources, population, alarm bell, cancel, garrison, victory/defeat, etc. | `art/textures/ui/session/icons/` | downscaled | **CC BY-SA 3.0** (c) Wildfire Games |
| Cursors (arrow, attack, build, gather, repair, heal) | `art/textures/cursors/` | as is (+ hotspots in JSON) | **CC BY-SA 3.0** (c) Wildfire Games |
| Linux Biolinum font (headings) | `mods/mod/fonts/LinBiolinum_*.ttf` | unchanged | GPL v3+ with the font exception (`assets/fonts/LibBiolinum-LICENSE.txt`) |
| GNU FreeSans font (text) | `mods/mod/fonts/FreeSans*.ttf` | unchanged | GPL v3+ with the font exception (`assets/fonts/FreeFont-LICENSE.txt`) |
| Icons "by the DE dictionary" (`assets/ui/portraits/de/`): symbol buildings, technologies, stances, stat icons, diplomacy | `art/textures/ui/session/portraits/technologies/` | background darkened to black by the item mask, items cut out and combined with each other (mail + swords/horseshoe/arrow, wreath + handshake, axe + log, shield + swords), ore and coin tinted to gold | **CC BY-SA 3.0** (c) Wildfire Games |
| Tool cursors (`assets/ui/cursors/de_*.png`) | the arrow `art/textures/cursors/arrow-default-down.png` + items cut from technology portraits | combined, downscaled to 32x32 | **CC BY-SA 3.0** (c) Wildfire Games |
| Buildings against the sky (`assets/ui/portraits/scenic/`), army order figurines and the trebuchet (`assets/ui/portraits/orders/`), unit portraits in the DE frame (`assets/ui/portraits/units3d/`) | 0 A.D. and Millennium A.D. 3D models (like `assets/gen/`) | rendered by `tools/build_portraits.py` (own angle, light, blue player color); the sky and grass background, windmill sails and the farm field are our own procedural drawing | **CC BY-SA 3.0** (c) Wildfire Games, (c) The Council of Modders, Fallen Empire Studio, Scion Development |

Our own procedural drawing (no third-party materials, `tools/ui_icon_art.py`): age crests, crowns of unique
technologies, a stack of books, an open book, checkered cloth, a collar, a chalice, a ray, a letter on a block, a crane,
an arrow slit (with a 0 A.D. arrow), a scroll with a check mark, a gear, a horn, formations (balls and a triangle), the octagonal
stance frame, a sword in the ground, a boulder, panel textures by culture (iron, marble, sandstone, lacquer), trim ornaments,
plain parchment. The icon subjects repeat common symbols (a sword, a horseshoe, an anchor...); pictures from
Microsoft / Age of Empires are neither used nor copied - the DE references served only for comparison
in the research (`docs/research/05_ui_recognition.md`) and are not part of the repository.

### Fonts from Google Fonts (in the repository: `assets/fonts/`)

| Font | Where in the game | Source | License |
|---|---|---|---|
| **PT Serif** (Regular, Bold, Italic) (c) 2010 ParaType Ltd. | names, resource and stat numbers, tooltips (a bold serif, as in DE) | <https://fonts.google.com/specimen/PT+Serif> (`google/fonts`, `ofl/ptserif`) | **SIL Open Font License 1.1** (`assets/fonts/PTSerif-OFL.txt`) |
| **Cormorant SC** (Bold) (c) 2015 the Cormorant Project Authors | menu and screen headings (small caps) | <https://fonts.google.com/specimen/Cormorant+SC> (`google/fonts`, `ofl/cormorantsc`) | **SIL Open Font License 1.1** (`assets/fonts/CormorantSC-OFL.txt`) |

The font files are unmodified; the Reserved Font Names are not used
for other fonts. The OFL allows embedding and distributing the fonts with the game.

The files in `assets/ui/` are derivative works, distributed under **CC BY-SA 3.0** with attribution to
Wildfire Games (see `assets/ui/LICENSE.md`). The 0 A.D. interface code (GUI XML/JS, GPL) is not used -
only pictures and fonts; the screen layouts are our own.

## Not used

- **OpenEmpires** (<https://github.com/Chilly5/OpenEmpires>): the repository is MIT,
  but its graphics and music have no separate credits or statement of origin. Nothing
  from it is taken into the project.
- The Source Han Sans (CJK) fonts from 0 A.D. are not downloaded (not needed for Cyrillic).
