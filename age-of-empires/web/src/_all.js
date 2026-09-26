// FOUNDATION-OWNED. Imports every ported module (data + content first, see _data_init.js) and registers the module
// namespaces in py.modules - the late-bound lookup that replaces Python's function-local imports
// (`from . import gfx` inside a function  ->  `modules.gfx` at call time). web/main.js imports this first.
import './_data_init.js';
import { register_modules } from '../runtime/py.js';

import * as ai from './ai.js';
import * as ai_army from './ai_army.js';
import * as ai_defense from './ai_defense.js';
import * as ai_war from './ai_war.js';
import * as civ_art from './civ_art.js';
import * as civ_ui from './civ_ui.js';
import * as controls from './controls.js';
import * as controls_draw from './controls_draw.js';
import * as data from './data.js';
import * as defense from './defense.js';
import * as defense_ui from './defense_ui.js';
import * as eco_ai from './eco_ai.js';
import * as economy_ui from './economy_ui.js';
import * as gfx from './gfx.js';
import * as hud from './hud.js';
import * as hud_windows from './hud_windows.js';
import * as i18n from './i18n.js';
import * as keymap from './keymap.js';
import * as lobby from './lobby.js';
import * as map_assets from './map_assets.js';
import * as map_icons from './map_icons.js';
import * as mapgen from './mapgen.js';
import * as maps from './maps.js';
import * as market from './market.js';
import * as match from './match.js';
import * as menu from './menu.js';
import * as menu_art from './menu_art.js';
import * as music from './music.js';
import * as naval from './naval.js';
import * as naval_ai from './naval_ai.js';
import * as naval_gfx from './naval_gfx.js';
import * as orders from './orders.js';
import * as playlist from './playlist.js';
import * as relics from './relics.js';
import * as savegame from './savegame.js';
import * as saves_ui from './saves_ui.js';
import * as scoring from './scoring.js';
import * as screens from './screens.js';
import * as settings from './settings.js';
import * as settings_ui from './settings_ui.js';
import * as sound from './sound.js';
import * as sprites3d from './sprites3d.js';
import * as sprites_extra from './sprites_extra.js';
import * as stats from './stats.js';
import * as synth from './synth.js';
import * as terrain from './terrain.js';
import * as terrain_gfx from './terrain_gfx.js';
import * as themes from './themes.js';
import * as ui from './ui.js';
import * as uiskin from './uiskin.js';
import * as uiskin_map from './uiskin_map.js';
import * as wallgfx from './wallgfx.js';
import * as widgets from './widgets.js';
import * as world from './world.js';
import * as content from './content/__init__.js';
import * as content__army_art from './content/_army_art.js';
import * as content__uni from './content/_uni.js';
import * as content_army_archers from './content/army_archers.js';
import * as content_army_base from './content/army_base.js';
import * as content_army_blacksmith from './content/army_blacksmith.js';
import * as content_army_cavalry from './content/army_cavalry.js';
import * as content_army_infantry from './content/army_infantry.js';
import * as content_army_monks from './content/army_monks.js';
import * as content_army_siege from './content/army_siege.js';
import * as content_army_university from './content/army_university.js';
import * as content_civ_units from './content/civ_units.js';
import * as content_civs from './content/civs.js';
import * as content_economy from './content/economy.js';
import * as content_garrison from './content/garrison.js';
import * as content_man_at_arms from './content/man_at_arms.js';
import * as content_naval from './content/naval.js';
import * as content_relics_wolves from './content/relics_wolves.js';
import * as content_towers from './content/towers.js';
import * as content_walls from './content/walls.js';
import * as content_zz_university_stub from './content/zz_university_stub.js';

register_modules({
    ai, ai_army, ai_defense, ai_war, civ_art, civ_ui, controls, controls_draw, data, defense, defense_ui, eco_ai,
    economy_ui, gfx, hud, hud_windows, i18n, keymap, lobby, map_assets, map_icons, mapgen, maps, market, match, menu,
    menu_art, music, naval, naval_ai, naval_gfx, orders, playlist, relics, savegame, saves_ui, scoring, screens,
    settings, settings_ui, sound, sprites3d, sprites_extra, stats, synth, terrain, terrain_gfx, themes, ui, uiskin,
    uiskin_map, wallgfx, widgets, world,
    content, 'content._army_art': content__army_art, 'content._uni': content__uni,
    'content.army_archers': content_army_archers, 'content.army_base': content_army_base,
    'content.army_blacksmith': content_army_blacksmith, 'content.army_cavalry': content_army_cavalry,
    'content.army_infantry': content_army_infantry, 'content.army_monks': content_army_monks,
    'content.army_siege': content_army_siege, 'content.army_university': content_army_university,
    'content.civ_units': content_civ_units, 'content.civs': content_civs, 'content.economy': content_economy,
    'content.garrison': content_garrison, 'content.man_at_arms': content_man_at_arms, 'content.naval': content_naval,
    'content.relics_wolves': content_relics_wolves, 'content.towers': content_towers, 'content.walls': content_walls,
    'content.zz_university_stub': content_zz_university_stub,
});
