"""Таблицы соответствия: наши юниты / здания / технологии → портреты 0 A.D. (CC BY-SA 3.0, Wildfire Games).

Пути — относительно `session/portraits/` в 0 A.D. и `assets/ui/portraits/` у нас (там лежат уменьшенные копии,
см. tools/build_ui_assets.py). Для юнитов — список кандидатов по имени файла; ищется сначала в папках
«своей» группы цивилизации, затем во всех остальных по порядку FALLBACK_DIRS. Нет ни одного — остаётся
наша процедурная иконка.

Словарь «предмет DE → наш значок» (docs/research/05_ui_recognition.md): здания-символы, технологии, эпохи,
верхние кнопки — 'de/<имя>' (tools/ui_icon_art.py: переназначенные и составные портреты 0 A.D., свой рисунок);
здания-«картинки» (дом, мельница, замок, башни, стены, ворота, ферма) — 'scenic/<группа>/<вид>' (рендер наших
моделей на небе, tools/build_portraits.py); портреты юнитов в кадре DE — 'units3d/<вид>.<группа юнитов>'
(tools/build_portraits.py --units --install), если есть, — раньше портретов 0 A.D.
"""

# наши цивилизации → папки юнитов 0 A.D. (в порядке предпочтения)
CIV_DIRS = {
    'britons': ('brit', 'gaul', 'celt'),
    'celts': ('gaul', 'brit', 'celt'),
    'franks': ('gaul', 'celt', 'brit'),
    'teutons': ('germ', 'gaul'),
    'goths': ('germ', 'gaul'),
    'vikings': ('germ', 'gaul'),
    'spanish': ('iber', 'rome'),
    'byzantines': ('rome', 'mace'),
    'persians': ('achae', 'sele'),
    'saracens': ('achae', 'kush', 'ptol'),
    'turks': ('achae', 'sele'),
    'chinese': ('han',),
    'japanese': ('han',),
    'mongols': ('han', 'achae'),
}
FALLBACK_DIRS = ('rome', 'germ', 'gaul', 'iber', 'brit', 'celt', 'achae', 'han', 'mace', 'cart', 'athen',
                 'hele', 'spart', 'sele', 'ptol', 'maur', 'kush')

_SWORD = ('infantry_swordsman', 'infantry_swordsman_2')
_CHAMP = ('champion_infantry_swordsman', 'champion_infantry', 'infantry_swordsman')
_SPEAR = ('infantry_spearman', 'infantry_spearman_2')
_ARCH = ('infantry_archer', 'champion_infantry_archer')
_XBOW = ('infantry_crossbowman', 'champion_infantry_crossbowman', 'champion_infantry_ranged_gastraphetes')
_JAV = ('infantry_javelinist', 'infantry_javelineer')
_SCOUT = ('cavalry_scout', 'cavalry_javelinist', 'cavalry_javelineer')
_KNIGHT = ('cavalry_swordsman', 'champion_cavalry', 'cavalry_spearman')
_CAVARCH = ('cavalry_archer', 'champion_cavalry_archer')
_CAMEL = ('camel_swordsman', 'camel_javelinist', 'camel_archer')
_RAM = ('siege_ram', 'siege_ram_covered')
_MANG = ('siege_mangonel', 'siege_onager', 'siege_lithobolos')
_SCORP = ('siege_scorpio', 'siege_boltshooter', 'siege_oxybeles', 'siege_ballista')
_WARSHIP = ('ship_arrow', 'ship_ram')
_FIRESHIP = ('ship_fire',)

UNIT_PORTRAITS = {
    'villager': ('support_civilian', 'support_female_citizen'),
    'militia': ('infantry_spearman_militia',) + _SWORD,
    'man_at_arms': _SWORD, 'long_swordsman': _SWORD, 'two_handed_swordsman': _SWORD + ('champion_infantry',),
    'champion': _CHAMP,
    'spearman': _SPEAR, 'pikeman': ('infantry_pikeman',) + _SPEAR, 'halberdier': ('infantry_halberdman', 'infantry_pikeman'),
    'archer': _ARCH, 'crossbowman': _XBOW + _ARCH, 'arbalester': _XBOW[::-1] + _ARCH,
    'skirmisher': _JAV, 'elite_skirmisher': ('kardakes_skirmisher',) + _JAV,
    'hand_cannoneer': ('champion_infantry_ranged_gastraphetes', 'champion_infantry_crossbowman'),
    'scout': _SCOUT, 'light_cavalry': _SCOUT, 'hussar': ('cavalry_javelinist',) + _SCOUT,
    'knight': _KNIGHT, 'cavalier': _KNIGHT, 'paladin': ('champion_cavalry',) + _KNIGHT,
    'cavalry_archer': _CAVARCH, 'heavy_cavalry_archer': _CAVARCH[::-1],
    'camel_rider': _CAMEL, 'heavy_camel_rider': _CAMEL,
    'monk': ('support_healer', 'champion_healer'),
    'trade_cart': ('support_trader', 'support_wagon_covered', 'support_wagon'),
    'ram': _RAM, 'capped_ram': _RAM[::-1], 'siege_ram': _RAM[::-1],
    'mangonel': _MANG, 'onager': ('siege_onager',) + _MANG, 'siege_onager': ('siege_onager',) + _MANG,
    'scorpion': _SCORP, 'heavy_scorpion': _SCORP,
    'trebuchet': ('siege_lithobolos', 'siege_onager_packed', 'siege_mangonel_packed'),
    'bombard_cannon': ('siege_ballista', 'siege_oxybeles'),
    'fishing_ship': ('ship_fishing',),
    'transport_ship': ('ship_merchant',),
    'galley': _WARSHIP, 'war_galley': _WARSHIP, 'galleon': ('ship_siege', 'ship_arrow'),
    'cannon_galleon': ('ship_siege',),
    'fire_galley': _FIRESHIP, 'fire_ship': _FIRESHIP, 'fast_fire_ship': _FIRESHIP,
    'demolition_ship': ('ship_ram', 'ship_scout'), 'heavy_demolition_ship': ('ship_ram', 'ship_scout'),
    # уникальные
    'longbowman': ('champion_ranged', 'infantry_archer'),
    'throwing_axeman': ('infantry_axeman',),
    'woad_raider': ('champion_fanatic', 'champion_swordsman_carnyx'),
    'huskarl': ('champion_infantry_axeman', 'infantry_axeman'),
    'berserk': ('infantry_clubman', 'champion_infantry_axeman'),
    'teutonic_knight': ('champion_infantry_swordsman', 'champion_infantry'),
    'samurai': ('champion_infantry_swordsman', 'infantry_swordsman'),
    'chu_ko_nu': ('infantry_crossbowman', 'champion_infantry_crossbowman'),
    'mangudai': ('cavalry_archer', 'champion_cavalry_archer'),
    'cataphract': ('champion_cavalry', 'cavalry_spearman'),
    'janissary': ('champion_infantry_ranged_gastraphetes', 'kardakes'),
    'conquistador': ('cavalry_javelinist', 'champion_cavalry'),
    'war_elephant': ('champion_elephant',),
    'mameluke': ('camel_swordsman', 'champion_cavalry'),
}
# элитные версии — как обычные
for _k in list(UNIT_PORTRAITS):
    UNIT_PORTRAITS.setdefault('elite_' + _k, UNIT_PORTRAITS[_k])

GAIA_PORTRAITS = {
    'sheep': 'gaia/fauna_sheep', 'deer': 'gaia/fauna_deer', 'boar': 'gaia/fauna_boar',
    'tree': 'gaia/flora_tree_generic', 'berries': 'gaia/flora_bush_berry', 'gold': 'gaia/geology_metal_2',
    'stone': 'gaia/geology_stone', 'shore_fish': 'gaia/fauna_fish', 'deep_fish': 'gaia/fauna_fish',
}

# цивилизация → группа архитектуры (как tools/build_sprites.CIV_GROUP) → группа юнитов (build_units.BUILD_TO_UNIT)
CIV_GROUP = {
    'franks': 'caro', 'teutons': 'teut', 'britons': 'anglo', 'celts': 'celt', 'vikings': 'norse',
    'goths': 'rus', 'byzantines': 'byz', 'spanish': 'hisp',
    'persians': 'umay', 'saracens': 'umay', 'turks': 'umay',
    'chinese': 'han', 'japanese': 'han', 'mongols': 'han',
}
UNIT_GROUP = {'caro': 'caro', 'teut': 'caro', 'anglo': 'anglo', 'celt': 'anglo', 'norse': 'norse', 'rus': 'rus',
              'byz': 'byz', 'hisp': 'caro', 'umay': 'umay', 'han': 'han'}
DEFAULT_GROUP = 'caro'
# здания-«картинки» DE (на фоне неба): вид здания → вид значка scenic/<группа>/…
SCENIC_BUILDINGS = {'house': 'house', 'mill': 'mill', 'castle': 'castle', 'tower': 'tower',
                    'guard_tower': 'guard_tower', 'keep': 'keep', 'farm': 'farm', 'palisade_wall': 'palisade_wall',
                    'palisade_gate': 'palisade_gate', 'stone_wall': 'stone_wall', 'gate': 'gate'}
# технологии, у которых в DE картинка здания (башни, стена)
SCENIC_TECHS = {'guard_tower': 'guard_tower', 'keep': 'keep'}
_D = 'de/'
# здания-символы DE (предмет на чёрном)
DE_BUILDINGS = {'barracks': _D + 'barracks', 'stable': _D + 'stable', 'siege_workshop': _D + 'siege_workshop',
                'dock': _D + 'dock', 'lumber_camp': _D + 'lumber_camp', 'mining_camp': _D + 'mining_camp',
                'market': _D + 'market', 'university': _D + 'university', 'town_center': _D + 'town_center'}

BUILDING_PORTRAITS = {
    'town_center': 'structures/civic_centre', 'house': 'structures/house', 'mill': 'structures/farmstead',
    'lumber_camp': 'structures/palace_wood', 'mining_camp': 'structures/storehouse', 'farm': 'structures/field',
    'barracks': 'structures/barracks', 'archery_range': 'structures/range', 'stable': 'structures/stable_01',
    'blacksmith': 'structures/blacksmith', 'tower': 'structures/sentry_tower',
    'guard_tower': 'structures/defense_tower', 'keep': 'structures/tower',
    'siege_workshop': 'structures/siege_workshop', 'castle': 'structures/fortress',
    'monastery': 'structures/temple', 'market': 'structures/market', 'dock': 'structures/dock',
    'university': 'structures/library_scroll', 'stone_wall': 'structures/wall', 'gate': 'structures/gate',
    'palisade_wall': 'structures/palisade_wall', 'palisade_gate': 'structures/wooden_gate',
}

_T = 'technologies/'
TECH_PORTRAITS = {
    'feudal': _T + 'town_phase', 'castle': _T + 'city_phase', 'imperial': _T + 'imperial_phase',
    'loom': _T + 'loom', 'wheelbarrow': _T + 'wheelbarrow_empty', 'hand_cart': _T + 'handcart_empty',
    'double_bit': _T + 'wood_axe_01', 'bow_saw': _T + 'wood_saw_bow', 'two_man_saw': _T + 'wood_saw_two_man',
    'gold_mining': _T + 'mining_metal_01', 'gold_shaft': _T + 'mining_metal_02',
    'stone_mining': _T + 'mining_stone_01', 'stone_shaft': _T + 'mining_stone_02',
    'horse_collar': _T + 'plow', 'heavy_plow': _T + 'gallic_plow', 'crop_rotation': _T + 'crop_rotation',
    'forging': _T + 'sword_01', 'iron_casting': _T + 'sword_02', 'blast_furnace': _T + 'sword_03',
    'fletching': _T + 'arrow_01', 'bodkin_arrow': _T + 'arrow_02', 'bracer': _T + 'arrow_03',
    'scale_armor': _T + 'armor_scale', 'chain_mail': _T + 'armor_chain', 'plate_mail': _T + 'armor_plates_iron',
    'scale_barding': _T + 'armor_leather_cavalry', 'chain_barding': _T + 'armor_plates_cavalry',
    'plate_barding': _T + 'armor_plates_silver_cavalry',
    'padded_archer_armor': _T + 'armor_quilted', 'leather_archer_armor': _T + 'armor_leather_arrow',
    'ring_archer_armor': _T + 'armor_plates_ranged',
    'thumb_ring': _T + 'archery_tradition', 'parthian_tactics': _T + 'horse_rider',
    'bloodlines': _T + 'nisean_war_horses', 'husbandry': _T + 'husbandry_horses',
    'supplies': _T + 'grain_bag', 'squires': _T + 'leather_boots', 'arson': _T + 'fire_arrows',
    'sanctity': _T + 'healing_rate', 'fervor': _T + 'walk', 'atonement': _T + 'high_priest',
    'redemption': _T + 'sacrifice', 'block_printing': _T + 'sibylline_books', 'illumination': _T + 'healing_range',
    'ballistics': _T + 'accuracy_bolt', 'chemistry': _T + 'incendiary_weapons',
    'siege_engineers': _T + 'military_engineers',
    'coinage': _T + 'coinage', 'caravan': _T + 'trade_caravan', 'guilds': _T + 'scales',
    'town_watch': _T + 'sentries', 'town_patrol': _T + 'signal_fires',
    'gillnets': _T + 'fishing_net', 'careening': _T + 'ship_cladding', 'dry_dock': _T + 'anchor',
    'shipwright': _T + 'armor_ship_bronze',
    'guard_tower': _T + 'crenelations', 'keep': _T + 'column', 'murder_holes': _T + 'murder_holes',
    'arrowslits': _T + 'arrow_accuracy', 'masonry': _T + 'masonry_rubble', 'architecture': _T + 'architecture',
    'fortified_wall': _T + 'wall', 'treadmill_crane': _T + 'engineering',
    # уникальные
    'bearded_axe': _T + 'battle_axe', 'chivalry': _T + 'horseshoe_gold', 'yeomen': _T + 'arrow_accuracy',
    'warwolf': _T + 'torsion_springs', 'nomads': _T + 'breeding_herd', 'drill': _T + 'cavalry_speed',
    'greek_fire': _T + 'flaming_munitions', 'logistica': _T + 'spear_buttspike', 'ironclad': _T + 'armor_plates_gold',
    'crenellations': _T + 'crenelations', 'yasama': _T + 'sentries', 'kataparuto': _T + 'torsion_springs',
    'great_wall': _T + 'masonry_polygonal', 'rocketry': _T + 'fire_arrows', 'kamandaran': _T + 'arrow_poison',
    'mahouts': _T + 'elephant_mahout', 'bimaristan': _T + 'asclepius_rod', 'zealotry': _T + 'frenzy',
    'sipahi': _T + 'horse_trainer', 'artillery': _T + 'heavy_shot', 'chieftains': _T + 'standard',
    'berserkergang': _T + 'frenzy', 'anarchy': _T + 'clenched_fist', 'perfusion': _T + 'patriotism',
    'stronghold': _T + 'masonry_clamps', 'furor_celtica': _T + 'carnyx', 'inquisition': _T + 'vial_poison',
    'supremacy': _T + 'laurel_wreath',
}
EXTRA_PORTRAITS = [_T + 'cartography', _T + 'carnyx']
# технологии по словарю DE (перекрывают TECH_PORTRAITS, если файл собран)
DE_TECHS = {k: _D + k for k in (
    'loom', 'wheelbarrow', 'hand_cart', 'double_bit', 'bow_saw', 'two_man_saw', 'gold_mining', 'gold_shaft',
    'stone_mining', 'stone_shaft', 'horse_collar', 'heavy_plow', 'crop_rotation', 'coinage', 'caravan', 'guilds',
    'town_watch', 'town_patrol', 'gillnets', 'careening', 'dry_dock', 'shipwright', 'supplies', 'forging',
    'iron_casting', 'blast_furnace', 'fletching', 'bodkin_arrow', 'bracer', 'scale_armor', 'chain_mail',
    'plate_mail', 'scale_barding', 'chain_barding', 'plate_barding', 'padded_archer_armor', 'leather_archer_armor',
    'ring_archer_armor', 'thumb_ring', 'parthian_tactics', 'bloodlines', 'husbandry', 'squires', 'arson',
    'sanctity', 'fervor', 'atonement', 'redemption', 'block_printing', 'illumination', 'ballistics', 'chemistry',
    'siege_engineers', 'masonry', 'architecture', 'fortified_wall', 'murder_holes', 'arrowslits',
    'treadmill_crane')}
DE_TECHS.update({'feudal': _D + 'age_btn_1', 'castle': _D + 'age_btn_2', 'imperial': _D + 'age_btn_3'})
# уникальные технологии DE — корона: серебряная (эпоха замков), золотая (имперская)
CROWN = {2: _D + 'crown_silver', 3: _D + 'crown_gold'}
AGE_PORTRAITS = [_D + 'age_0', _D + 'age_1', _D + 'age_2', _D + 'age_3']
AGE_PORTRAITS_0AD = [_T + 'village_phase', _T + 'town_phase', _T + 'city_phase', _T + 'imperial_phase']
