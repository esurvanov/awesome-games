// Библиотека форм (волна 3): node build-lib.mjs <outDir> [key,key…]
// Каждая форма → <outDir>/<key>.glb, нормализована: метры, опора y=0, центр в (0,0) по x/z, лицо в +Z.
// Настенные (wall:'back') — задник в z=0; wall:'center' — по центру толщины; ceiling — верх в y=h (Рендер: yOffset = 3 − h).
// Итог — <outDir>/_lib.json (размеры, материалы, треугольники) → генератор манифеста.
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, prune, dedup, getBounds } from '@gltf-transform/functions';
import fs from 'fs';
import { mat, G, box, cyl, sphere, quad, meshNode, paintingTex } from './geo.mjs';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const OUT = process.argv[2] || 'lib'; const ONLY = process.argv[3] ? process.argv[3].split(',') : null;
fs.mkdirSync(OUT, { recursive: true });
const KIT = { k: 'kz/furniture-kit/Models/GLTF format', n: 'kz/nature-kit/Models/GLTF format', su: 'kz/city-kit-suburban/Models/GLB format', cc: 'kz/city-kit-commercial/Models/GLB format',
  rd: 'kz/city-kit-roads/Models/GLB format', car: 'kz/car-kit/Models/GLB format', ho: 'kz/holiday-kit/Models/GLB format', fd: 'kz/food-kit/Models/GLB format', ar: 'kz/mini-arcade/Models/GLB format',
  mm: 'kz/mini-market/Models/GLB format', sv: 'kz/survival-kit/Models/GLB format', gy: 'kz/graveyard-kit/Models/GLB format', ft: 'kz/fantasy-town-kit/Models/GLB format', kk: 'kaykit/KayKit-Furniture-Bits-1.0-main/addons/kaykit_furniture_bits/Assets/gltf', pp: 'pp' };
const KITNAME = { k: 'Kenney Furniture Kit', n: 'Kenney Nature Kit', su: 'Kenney City Kit (Suburban)', cc: 'Kenney City Kit (Commercial)', rd: 'Kenney City Kit (Roads)', car: 'Kenney Car Kit', ho: 'Kenney Holiday Kit', fd: 'Kenney Food Kit', ar: 'Kenney Mini Arcade', mm: 'Kenney Mini Market', sv: 'Kenney Survival Kit', gy: 'Kenney Graveyard Kit', ft: 'Kenney Fantasy Town Kit', kk: 'KayKit Furniture Bits (Kay Lousberg)' };
const K = 2.05;
const L = []; const add = (key, group, kinds, src, o = {}) => L.push({ key, group, kinds, src, ...o });
const P = (src, at = [0, 0, 0], ry = 0, s = 1) => ({ src, at, ry, s });

// ======================= НОВЫЕ ВИДЫ (§9) =======================
add('fireplace', 'kind', ['fireplace'], 'proc:fireplace');
add('fireplace_stone', 'kind', ['fireplace'], 'proc:fireplace_stone');
add('piano', 'kind', ['piano'], 'proc:piano');
add('piano_grand', 'kind', ['piano'], 'proc:piano_grand');
add('guitar', 'kind', ['guitar'], 'proc:guitar');
add('telescope', 'kind', ['telescope'], 'proc:telescope');
add('aquarium', 'kind', ['aquarium'], 'proc:aquarium');
add('pool_table', 'kind', ['pool_table'], 'proc:pool_table');
add('dartboard', 'kind', ['dartboard'], 'proc:dartboard', { wall: 'back', yOffset: 1.35 });
add('arcade_machine', 'kind', ['video_game'], 'ar:arcade-machine', { h: 1.75 });
add('game_console', 'kind', ['video_game'], 'proc:game_console');
add('dance_machine', 'furn', ['video_game'], 'ar:dance-machine', { h: 1.9 });
add('claw_machine', 'furn', ['video_game', 'pinball'], 'ar:claw-machine', { h: 1.8 });
add('pinball', 'kind', ['pinball'], 'ar:pinball', { h: 1.75 });
add('air_hockey', 'furn', ['pool_table'], 'ar:air-hockey', { h: 0.85 });
add('treadmill', 'kind', ['treadmill'], 'proc:treadmill');
add('hot_tub', 'kind', ['hot_tub'], 'proc:hot_tub');
add('grill', 'kind', ['grill'], 'proc:grill');
add('coffee_maker', 'kind', ['coffee_maker'], 'k:kitchenCoffeeMachine', { surface: true });
add('microwave', 'kind', ['microwave'], 'k:kitchenMicrowave', { surface: true });
add('dishwasher', 'kind', ['dishwasher'], 'proc:dishwasher');
add('washing_machine', 'kind', ['washing_machine'], 'k:washer');
add('dryer', 'furn', ['washing_machine'], 'k:dryer');
add('washer_dryer', 'furn', ['washing_machine'], 'k:washerDryerStacked');
add('toy_box', 'kind', ['toy_box'], 'proc:toy_box');
add('teddy_bear', 'furn', ['toy_box'], 'k:bear', { h: 0.45 });
add('dollhouse', 'kind', ['dollhouse'], [P('proc:dollhouse_table'), P('su:building-type-b', [0, 0.45, 0], 0, 0.45)], {});
add('kids_bed', 'kind', ['kids_bed'], 'k:bedSingle', { sc: 1.45 });
add('bunk_bed', 'kind', ['bunk_bed'], 'k:bedBunk');
add('wardrobe', 'kind', ['wardrobe'], 'k:bookcaseClosedDoors', { h: 2.0 });
add('desk_lamp', 'kind', ['desk_lamp'], 'k:lampSquareTable', { surface: true });
add('desk_lamp_round', 'furn', ['desk_lamp'], 'k:lampRoundTable', { surface: true });
add('ceiling_lamp', 'kind', ['ceiling_lamp'], 'k:lampSquareCeiling', { ceiling: true });
add('ceiling_fan', 'furn', ['ceiling_lamp'], 'k:ceilingFan', { ceiling: true });
add('sculpture', 'kind', ['sculpture'], [P('proc:pedestal'), P('n:statue_head', [0, 0.94 + 0.05 * 0.55, 0], 0, 0.55)], {});
add('sculpture_obelisk', 'furn', ['sculpture'], 'n:statue_obelisk', { h: 1.8 });
add('sculpture_ring', 'furn', ['sculpture'], 'n:statue_ring', { h: 1.4 });
add('sculpture_abstract', 'furn', ['sculpture'], 'proc:sculpture_abstract');
add('clock', 'kind', ['clock'], 'proc:grandfather_clock');
add('clock_wall', 'furn', ['clock'], 'proc:wall_clock', { wall: 'back', yOffset: 1.7 });
add('flower_vase', 'kind', ['flower_vase'], 'proc:flower_vase', { surface: true });
add('plant_small_a', 'furn', ['flower_vase', 'plant'], 'k:plantSmall1', { surface: true, sc: 2.2 });
add('plant_small_b', 'furn', ['flower_vase', 'plant'], 'k:plantSmall2', { surface: true, sc: 2.2 });
add('plant_small_c', 'furn', ['flower_vase', 'plant'], 'k:plantSmall3', { surface: true, sc: 2.2 });
add('pool', 'kind', ['pool'], 'proc:pool');
add('park_bench', 'kind', ['park_bench'], 'ho:bench', { h: 0.85 });
add('park_bench_iron', 'hood', ['park_bench'], 'gy:bench', { h: 0.85 });
add('fountain', 'kind', ['fountain'], 'ft:fountain-round', { len: 2.8 });
add('fountain_square', 'hood', ['fountain'], 'ft:fountain-square', { len: 2.8 });
add('food_stall', 'kind', ['food_stall'], 'ft:stall-red', { h: 2.4 });
add('food_stall_green', 'hood', ['food_stall'], 'ft:stall-green', { h: 2.4 });
add('food_cart', 'hood', ['food_stall'], 'ft:cart', { h: 1.4 });
add('cash_register', 'kind', ['cash_register'], 'proc:register_small');
add('cash_register_counter', 'furn', ['cash_register'], 'mm:cash-register', { h: 1.2 });
add('shelf_shop', 'kind', ['shelf_shop'], 'mm:shelf-boxes', { h: 1.8 });
add('shelf_shop_bags', 'furn', ['shelf_shop'], 'mm:shelf-bags', { h: 1.8 });
add('shop_freezer', 'furn', ['shelf_shop'], 'mm:freezer', { h: 1.0 });
add('shop_freezer_tall', 'furn', ['shelf_shop'], 'mm:freezers-standing', { h: 2.0 });
add('shop_fruit', 'furn', ['shelf_shop'], 'mm:display-fruit', { h: 1.0 });
add('shop_bread', 'furn', ['shelf_shop'], 'mm:display-bread', { h: 1.2 });
add('vending_machine', 'furn', ['shelf_shop', 'video_game'], 'ar:vending-machine', { h: 1.9 });
add('cafe_table', 'kind', ['cafe_table'], 'proc:cafe_table');
add('cafe_table_parasol', 'furn', ['cafe_table'], [P('proc:cafe_table'), P('cc:detail-parasol-a', [0, 0, 0], 0, 5.1)], {});
add('gym_machine', 'kind', ['gym_machine'], 'proc:gym_machine');
add('library_shelf', 'kind', ['library_shelf'], [P('k:bookcaseClosedWide'), ...[0.13, 0.37, 0.61].flatMap(y => [0.04, 0.2, 0.36, 0.52].map(x => P('k:books', [x, y, -0.06])))], {});
add('museum_exhibit', 'kind', ['museum_exhibit'], 'proc:museum_exhibit');
add('swing_set', 'kind', ['swing_set'], 'proc:swing_set');
add('sandbox', 'kind', ['sandbox'], 'proc:sandbox');
add('trash_bin_street', 'kind', ['trash_bin_street'], 'proc:street_bin');
add('dumpster', 'hood', ['trash_bin_street'], 'rd:dumpster', { len: 2.0 });
add('streetlight', 'kind', ['streetlight'], 'gy:lightpost-single', { h: 3.6 });
add('streetlight_double', 'hood', ['streetlight'], 'gy:lightpost-double', { h: 3.6 });
add('streetlight_modern', 'hood', ['streetlight'], 'rd:light-square', { h: 5 });
add('streetlight_curved', 'hood', ['streetlight'], 'rd:light-curved', { h: 5 });
add('lantern_post', 'hood', ['streetlight'], 'ft:lantern', { h: 2.4 });
add('hedge', 'kind', ['hedge'], 'proc:hedge_box:0.9:1');
add('hedge_large', 'hood', ['hedge'], 'proc:hedge_box:1.5:1');
add('hedge_2', 'hood', ['hedge'], 'proc:hedge_box:0.9:2');
add('hedge_4', 'hood', ['hedge'], 'proc:hedge_box:0.9:4');
add('hedge_topiary', 'furn', ['hedge'], 'proc:topiary');
add('hedge_ft', 'hood', ['decor'], 'ft:hedge', { len: 1.0 });
add('hedge_curved', 'hood', ['decor'], 'ft:hedge-curved', { len: 1.0 });
add('tree', 'kind', ['tree'], 'n:tree_default', { h: 5.5 });
add('flowerbed', 'kind', ['flowerbed'], [P('proc:bed_soil'), ...[[-0.3, -0.25, 'flower_redA'], [0, -0.25, 'flower_yellowA'], [0.3, -0.25, 'flower_purpleA'], [-0.3, 0.05, 'flower_yellowB'], [0, 0.05, 'flower_purpleB'], [0.3, 0.05, 'flower_redB'], [-0.15, 0.3, 'flower_redC'], [0.15, 0.3, 'flower_yellowC']].map(([x, z, f]) => P('n:' + f, [x, 0.08, z], 0, 1.6))], { fitParts: false, sc: 1 });
add('fence', 'kind', ['fence'], 'n:fence_simple', { len: 1.0, wall: 'edge' });
add('fence_planks', 'hood', ['fence'], 'n:fence_planks', { len: 1.0, wall: 'edge' });
add('fence_high', 'hood', ['fence'], 'n:fence_simpleHigh', { len: 1.0, wall: 'edge' });
add('fence_iron', 'hood', ['fence'], 'gy:iron-fence', { len: 1.0, wall: 'edge' });
add('fence_picket', 'hood', ['fence'], 'su:fence', { len: 1.0, wall: 'edge' });
add('fence_gate', 'hood', ['fence'], 'n:fence_gate', { len: 1.0, wall: 'edge' });

// ======================= ФОРМЫ МЕБЕЛИ (Kenney Furniture Kit) =======================
const KF = {
  sofa: ['loungeSofa', 'loungeSofaLong', 'loungeDesignSofa', 'loungeSofaCorner', 'loungeDesignSofaCorner', 'benchCushion'],
  armchair: ['loungeChair', 'loungeChairRelax', 'loungeDesignChair', 'loungeSofaOttoman'],
  dining_chair: ['chair', 'chairCushion', 'chairModernCushion', 'chairModernFrameCushion', 'chairRounded', 'chairDesk', 'stoolBar', 'stoolBarSquare', 'bench', 'benchCushionLow'],
  dining_table: ['table', 'tableCloth', 'tableCross', 'tableCrossCloth', 'tableGlass', 'tableRound'],
  coffee_table: ['tableCoffee', 'tableCoffeeGlass', 'tableCoffeeGlassSquare', 'tableCoffeeSquare', 'sideTable', 'sideTableDrawers'],
  bookshelf: ['bookcaseOpen', 'bookcaseOpenLow', 'bookcaseClosed', 'bookcaseClosedWide'],
  dresser: ['cabinetBed', 'cabinetBedDrawer', 'cabinetBedDrawerTable', 'bathroomCabinetDrawer'],
  toilet: ['toilet', 'toiletSquare'], shower: ['shower', 'showerRound'], bathtub: ['bathtub'], bath_sink: ['bathroomSink', 'bathroomSinkSquare'],
  fridge: ['kitchenFridge', 'kitchenFridgeLarge', 'kitchenFridgeSmall', 'kitchenFridgeBuiltIn'],
  stove: ['kitchenStove', 'kitchenStoveElectric'],
  counter: ['kitchenCabinet', 'kitchenCabinetDrawer', 'kitchenBar', 'kitchenBarEnd', 'kitchenCabinetCornerRound', 'kitchenCabinetCornerInner'],
  kitchen_sink: ['kitchenSink'], floor_lamp: ['lampRoundFloor', 'lampSquareFloor'], plant: ['pottedPlant'], trash_can: ['trashcan'], mirror: ['bathroomMirror'],
  rug: ['rugRectangle', 'rugRound', 'rugRounded', 'rugSquare', 'rugDoormat'],
  bed_single: ['bedSingle'], bed_double: ['bedDouble'],
  misc: ['coatRack', 'coatRackStanding', 'cardboardBoxClosed', 'cardboardBoxOpen', 'hoodLarge', 'hoodModern', 'kitchenCabinetUpper', 'kitchenCabinetUpperDouble', 'kitchenCabinetUpperLow', 'kitchenCabinetUpperCorner', 'bathroomCabinet', 'lampWall', 'pillow', 'pillowBlue', 'pillowLong', 'pillowBlueLong', 'books', 'kitchenBlender', 'toaster', 'laptop', 'computerScreen', 'speaker', 'speakerSmall', 'radio', 'televisionModern', 'televisionVintage'],
};
const WALLISH = { kitchenCabinetUpper: 1.4, kitchenCabinetUpperDouble: 1.4, kitchenCabinetUpperLow: 1.6, kitchenCabinetUpperCorner: 1.4, bathroomCabinet: 1.3, lampWall: 1.7, hoodLarge: 1.5, hoodModern: 1.5, bathroomMirror: 1.0 };
const SURF = new Set(['books', 'kitchenBlender', 'toaster', 'laptop', 'computerScreen', 'radio', 'speakerSmall', 'pillow', 'pillowBlue', 'pillowLong', 'pillowBlueLong', 'televisionModern', 'televisionVintage']);
for (const [kind, names] of Object.entries(KF)) for (const nm of names) {
  const o = {}; if (WALLISH[nm]) { o.wall = 'back'; o.yOffset = WALLISH[nm]; } if (SURF.has(nm)) o.surface = true; if (kind === 'rug') o.flat = true;
  add('k_' + nm, 'furn', kind === 'misc' ? ['decor'] : [kind], 'k:' + nm, o);
}
// составные ТВ/стерео/компьютер
add('tv_modern', 'furn', ['tv'], [P('k:cabinetTelevision'), P('k:televisionModern', [0.4, 0.31, -0.125])]);
add('tv_modern_doors', 'furn', ['tv'], [P('k:cabinetTelevisionDoors'), P('k:televisionModern', [0.4, 0.31, -0.125])]);
add('tv_vintage', 'furn', ['tv'], [P('k:sideTable'), P('k:televisionVintage', [0.06, 0.38, 0.02]), P('k:televisionAntenna', [0.265, 0.65, -0.12])]);
add('stereo_tower', 'furn', ['stereo'], [P('k:speaker'), P('k:speaker', [0.45, 0, 0]), P('k:cabinetBedDrawer', [0.17, 0, 0.02]), P('k:radio', [0.14, 0.26, -0.05])]);
add('stereo_radio', 'furn', ['stereo'], [P('k:sideTableDrawers'), P('k:radio', [0.11, 0.38, -0.06])]);
add('computer_laptop', 'furn', ['computer_desk'], [P('k:desk'), P('k:laptop', [0.24, 0.38, -0.3])]);
add('computer_corner', 'furn', ['computer_desk'], [P('k:deskCorner'), P('k:computerScreen', [0.2, 0.38, -0.35]), P('k:computerKeyboard', [0.24, 0.38, -0.15])]);
add('computer_pc', 'furn', ['computer_desk'], [P('k:desk'), P('k:computerScreen', [0.17, 0.38, -0.33]), P('k:computerKeyboard', [0.22, 0.38, -0.12]), P('k:computerMouse', [0.56, 0.38, -0.12])]);
add('kitchen_island', 'furn', ['counter'], [P('k:kitchenBar'), P('k:kitchenBar', [0.43, 0, 0])]);
add('stove_hood', 'furn', ['stove'], [P('k:kitchenStove'), P('k:hoodModern', [0, 0.85, 0])]);
// картины
for (const t of ['birch', 'sea', 'abstract', 'still', 'portrait', 'sunset']) add('painting_' + t, 'furn', ['painting'], 'proc:painting:' + t, { wall: 'back', yOffset: 1.3 });
add('painting_wide', 'furn', ['painting'], 'proc:painting_wide:sunset', { wall: 'back', yOffset: 1.3 });
// растения / декор из других китов
add('pot_large_bush', 'furn', ['plant'], [P('n:pot_large'), P('n:plant_bushDetailed', [0, 0.25, 0], 0, 0.9)], { h: 1.1 });
add('pot_small_flower', 'furn', ['plant', 'flower_vase'], [P('n:pot_small'), P('n:flower_redA', [0, 0.18, 0], 0, 0.8)], { h: 0.6 });
add('cactus', 'furn', ['plant'], [P('n:pot_small'), P('n:cactus_tall', [0, 0.18, 0], 0, 0.6)], { h: 1.2 });
add('xmas_tree', 'furn', ['plant', 'decor'], 'ho:tree-decorated', { h: 2.1 });
add('snowman', 'hood', ['sculpture'], 'ho:snowman', { h: 1.5 });
add('gift_box', 'furn', ['decor'], 'ho:present-a-cube', { h: 0.35 });
add('lantern_table', 'furn', ['desk_lamp'], 'ho:lantern', { h: 0.4, surface: true });
add('menorah', 'furn', ['decor'], 'ho:hanukkah-menorah-candles', { h: 0.45, surface: true });
add('barrel', 'hood', ['decor'], 'sv:barrel', { h: 0.9 });
add('chest', 'furn', ['toy_box'], 'sv:chest', { h: 0.6 });
add('workbench', 'furn', ['decor'], 'sv:workbench', { h: 0.95 });
add('tent', 'hood', ['decor'], 'sv:tent', { h: 1.6 });
add('campfire', 'hood', ['grill'], 'sv:campfire-pit', { h: 0.5 });
add('urn', 'furn', ['sculpture'], 'gy:urn-round', { h: 0.9 });
add('column', 'furn', ['sculpture'], 'n:statue_column', { h: 2.2 });
add('gravestone_cross', 'hood', ['tombstone'], 'gy:gravestone-cross', { h: 1.0 });
add('gravestone_round', 'hood', ['tombstone'], 'gy:gravestone-round', { h: 0.9 });
add('gravestone_wide', 'hood', ['tombstone'], 'gy:gravestone-wide', { h: 0.9 });
add('shopping_cart', 'furn', ['shelf_shop'], 'mm:shopping-cart', { h: 1.0 });
add('ticket_machine', 'furn', ['video_game'], 'ar:ticket-machine', { h: 1.6 });
add('prize_wheel', 'furn', ['video_game'], 'ar:prize-wheel', { h: 2.0 });
add('basketball_game', 'furn', ['video_game'], 'ar:basketball-game', { h: 2.2 });
add('gambling_machine', 'furn', ['video_game'], 'ar:gambling-machine', { h: 1.7 });
add('mailbox_post', 'hood', ['mailbox'], 'proc:mailbox_modern');
add('fire_hydrant', 'hood', ['decor'], 'proc:hydrant');
// ======================= РАЙОН =======================
for (const t of ['tree_default', 'tree_oak', 'tree_detailed', 'tree_fat', 'tree_simple', 'tree_tall', 'tree_thin', 'tree_blocks', 'tree_cone', 'tree_plateau', 'tree_small'])
  for (const v of ['', '_fall', '_dark']) { const nm = t + v === 'tree_fat_dark' ? 'tree_fat_darkh' : t + v; if (!fs.existsSync(`${KIT.n}/${nm}.glb`)) continue; add('n_' + t + v, 'hood', ['tree'], 'n:' + nm, { h: t === 'tree_small' ? 2.6 : t === 'tree_tall' || t === 'tree_thin' ? 7 : 5.5 }); }
for (const t of ['tree_pineDefaultA', 'tree_pineRoundA', 'tree_pineRoundC', 'tree_pineTallA', 'tree_pineSmallA', 'tree_palmTall', 'tree_palm']) add('n_' + t, 'hood', ['tree'], 'n:' + t, { h: /Small/.test(t) ? 2.5 : /Tall/.test(t) ? 8 : 6 });
add('su_tree_large', 'hood', ['tree'], 'su:tree-large', { h: 6 }); add('su_tree_small', 'hood', ['tree'], 'su:tree-small', { h: 3.5 });
add('ft_tree', 'hood', ['tree'], 'ft:tree', { h: 5 }); add('ft_tree_high', 'hood', ['tree'], 'ft:tree-high-round', { h: 7 });
for (const b of ['plant_bush', 'plant_bushDetailed', 'plant_bushLarge', 'plant_bushSmall', 'plant_bushTriangle', 'plant_bushLargeTriangle']) add('n_' + b, 'hood', ['hedge'], 'n:' + b, { h: /Large/.test(b) ? 1.2 : /Small/.test(b) ? 0.5 : 0.8 });
for (const f of ['flower_redA', 'flower_yellowA', 'flower_purpleA', 'flower_redC', 'flower_yellowC', 'flower_purpleC', 'grass_large', 'grass_leafsLarge', 'mushroom_redGroup']) add('n_' + f, 'hood', ['flowerbed'], 'n:' + f, { h: /grass/.test(f) ? 0.4 : 0.45 });
for (const r of ['rock_largeA', 'rock_smallA', 'rock_tallA', 'stump_round', 'log_stack']) add('n_' + r, 'hood', ['decor'], 'n:' + r, { h: /large/.test(r) ? 1.2 : /tall/.test(r) ? 1.6 : 0.5 });
for (const c of ['sedan', 'suv', 'hatchback-sports', 'van', 'taxi', 'police', 'ambulance', 'firetruck', 'garbage-truck', 'delivery', 'truck', 'sedan-sports', 'suv-luxury', 'tractor'])
  add('car_' + c.replace(/-/g, '_'), 'hood', ['car'], 'car:' + c, { len: /truck|firetruck|delivery/.test(c) ? 7 : /van|ambulance/.test(c) ? 5.2 : /tractor/.test(c) ? 3.5 : 4.4 });
for (const s of ['road-sign-stop', 'road-sign-street', 'road-sign-warning', 'traffic-light', 'construction-cone', 'construction-barrier', 'electricity-pole']) add('rd_' + s.replace(/-/g, '_'), 'hood', ['decor'], 'rd:' + s, { h: /cone/.test(s) ? 0.5 : /barrier/.test(s) ? 1.0 : /pole/.test(s) ? 8 : /traffic/.test(s) ? 4.5 : 2.6 });
for (const b of 'abcdefghijklmnopqrstu') add('house_' + b, 'hood', ['house'], 'su:building-type-' + b, { h: 6.5 });
for (const b of 'abcdefghijklmn') add('shop_' + b, 'hood', ['building'], 'cc:building-' + b, { h: 9 });
for (const b of ['detail-awning', 'detail-awning-wide', 'detail-parasol-a', 'detail-parasol-b']) add('cc_' + b.replace(/-/g, '_'), 'hood', ['decor'], 'cc:' + b, { h: /parasol/.test(b) ? 2.4 : 1.0 });
for (const d of ['driveway-long', 'path-long', 'path-stones-long', 'planter']) add('su_' + d.replace(/-/g, '_'), 'hood', ['decor'], 'su:' + d, { len: /planter/.test(d) ? 1.0 : 2.0 });
add('well_cart', 'hood', ['decor'], 'ft:cart-high', { h: 1.8 });


// ======================= KayKit Furniture Bits (CC0) =======================
for (const [nm, kinds, o] of [
  ['armchair', ['armchair'], { h: 0.9 }], ['armchair_pillows', ['armchair'], { h: 0.9 }], ['couch', ['sofa'], { h: 0.9 }], ['couch_pillows', ['sofa'], { h: 0.9 }],
  ['bed_double_A', ['bed_double'], { len: 2.1 }], ['bed_double_B', ['bed_double'], { len: 2.1 }], ['bed_single_A', ['bed_single', 'kids_bed'], { len: 2.0 }], ['bed_single_B', ['bed_single', 'kids_bed'], { len: 2.0 }],
  ['cabinet_medium', ['dresser', 'wardrobe'], { h: 1.1 }], ['cabinet_medium_decorated', ['dresser'], { h: 1.4 }], ['cabinet_small', ['dresser'], { h: 0.7 }], ['cabinet_small_decorated', ['dresser'], { h: 0.95 }],
  ['chair_A', ['dining_chair'], { h: 0.95 }], ['chair_A_wood', ['dining_chair'], { h: 0.95 }], ['chair_B', ['dining_chair'], { h: 0.95 }], ['chair_B_wood', ['dining_chair'], { h: 0.95 }], ['chair_C', ['dining_chair'], { h: 0.95 }], ['chair_stool', ['dining_chair'], { h: 0.62 }], ['chair_stool_wood', ['dining_chair'], { h: 0.62 }],
  ['lamp_standing', ['floor_lamp'], { h: 1.7 }], ['lamp_table', ['desk_lamp'], { h: 0.5, surface: true }],
  ['rug_oval_A', ['rug'], { len: 2.0, flat: true }], ['rug_oval_B', ['rug'], { len: 2.0, flat: true }], ['rug_rectangle_A', ['rug'], { len: 2.0, flat: true }], ['rug_rectangle_B', ['rug'], { len: 2.0, flat: true }], ['rug_rectangle_stripes_A', ['rug'], { len: 2.0, flat: true }], ['rug_rectangle_stripes_B', ['rug'], { len: 2.0, flat: true }],
  ['shelf_B_large', ['decor'], { len: 1.2, wall: 'back', yOffset: 1.3 }], ['shelf_B_large_decorated', ['decor'], { len: 1.2, wall: 'back', yOffset: 1.3 }], ['shelf_B_small', ['decor'], { len: 0.7, wall: 'back', yOffset: 1.3 }], ['shelf_B_small_decorated', ['decor'], { len: 0.7, wall: 'back', yOffset: 1.3 }],
  ['shelf_A_big', ['decor'], { len: 1.0, wall: 'back', yOffset: 1.4 }], ['shelf_A_small', ['decor'], { len: 0.6, wall: 'back', yOffset: 1.4 }],
  ['table_low', ['coffee_table'], { h: 0.45 }], ['table_medium', ['dining_table'], { h: 0.76 }], ['table_medium_long', ['dining_table'], { h: 0.76 }], ['table_small', ['dining_table', 'coffee_table'], { h: 0.72 }],
  ['cactus_medium_A', ['plant'], { h: 0.9 }], ['cactus_medium_B', ['plant'], { h: 0.9 }], ['cactus_small_A', ['plant', 'flower_vase'], { h: 0.4, surface: true }], ['cactus_small_B', ['plant', 'flower_vase'], { h: 0.4, surface: true }],
  ['pictureframe_large_A', ['painting'], { h: 0.8, wall: 'back', yOffset: 1.3 }], ['pictureframe_large_B', ['painting'], { h: 0.8, wall: 'back', yOffset: 1.3 }], ['pictureframe_medium', ['painting'], { h: 0.6, wall: 'back', yOffset: 1.4 }],
  ['pictureframe_small_A', ['painting'], { h: 0.4, wall: 'back', yOffset: 1.5 }], ['pictureframe_standing_A', ['decor'], { h: 0.3, surface: true }], ['book_set', ['decor'], { h: 0.25, surface: true }],
]) add('kk_' + nm, 'furn', kinds, 'kk:' + nm, o);
add('exercise_bike', 'furn', ['treadmill', 'exercise_bench', 'gym_machine'], 'proc:exercise_bike');
add('bathtub_clawfoot', 'furn', ['bathtub'], 'proc:bathtub_clawfoot');
add('piano_upright_small', 'furn', ['piano'], 'proc:piano');

// ======================= «свои модели» из отчёта Каталога (приоритет 2) =======================
for (const [key, kinds, src, o = {}] of [
  ['beanbag', ['armchair'], 'proc:beanbag'], ['armchair_egg', ['armchair'], 'proc:egg_chair'], ['armchair_rocking', ['armchair'], 'proc:rocking_chair'], ['deck_chair', ['armchair', 'dining_chair'], 'proc:deck_chair'],
  ['chair_exec', ['dining_chair', 'armchair'], 'proc:exec_chair'], ['bed_cot', ['bed_single'], 'sv:bedroll-frame', { len: 1.95 }], ['bed_water', ['bed_double'], 'proc:water_bed'], ['bed_round', ['bed_double'], 'proc:round_bed'],
  ['table_banquet', ['dining_table'], [P('k:tableCloth'), P('k:tableCloth', [0.84, 0, 0])]], ['k_desk', ['computer_desk', 'dining_table'], 'k:desk'],
  ['fridge_retro', ['fridge'], 'proc:fridge_retro'], ['tv_plasma', ['tv'], [P('k:cabinetTelevision'), P('k:televisionModern', [0.4, 0.31, -0.125], 0, 1.25)]], ['tv_projector', ['tv'], 'proc:projector'],
  ['radio_retro', ['stereo'], 'proc:radio_retro'], ['boombox', ['stereo'], 'proc:boombox', { surface: true }], ['jukebox', ['stereo'], 'proc:jukebox'],
  ['lamp_lava', ['desk_lamp', 'floor_lamp'], 'proc:lava_lamp', { surface: true }], ['lamp_floor_arc', ['floor_lamp'], 'proc:arc_lamp'],
  ['poster_cat', ['painting'], 'proc:poster:cat', { wall: 'back', yOffset: 1.3 }], ['carpet_wall', ['painting', 'rug'], 'proc:wallcarpet:carpet', { wall: 'back', yOffset: 0.7 }], ['mirror_full', ['mirror'], 'proc:mirror_full'],
  ['rug_bear', ['rug'], 'proc:rug_bear', { flat: false }], ['plant_palm', ['plant'], [P('n:pot_large'), P('n:tree_palmShort', [0, 0.15, 0], 0, 0.45)], { h: 1.8 }], ['plant_bonsai', ['plant', 'flower_vase'], [P('n:pot_small'), P('n:tree_oak', [0, 0.2, 0], 0, 0.12)], { h: 0.45, surface: true }],
  ['yoga_mat', ['exercise_bench'], 'proc:yoga_mat'], ['punching_bag', ['exercise_bench', 'gym_machine'], 'proc:punching_bag'], ['phone_wall', ['phone'], 'proc:phone_wall', { wall: 'back', yOffset: 1.3 }],
  ['door_glass', ['door'], 'k:doorwayFront', { fitWH: [0.98, 2.2], wall: 'center' }], ['window_porthole', ['window'], 'proc:porthole', { wall: 'center', yOffset: 1.2 }],
]) add(key, 'furn', kinds, src, o);

// подгонка под следы каталога 1×1 / 3×1 / 3×3
for (const [key, kinds, src, o = {}] of [
  ['sofa_long3', ['sofa'], [P('k:loungeSofa'), P('k:loungeChair', [0.98, 0, 0])]], ['pool_round', ['pool'], 'proc:pool_round'], ['fountain_small', ['fountain'], 'proc:fountain_small'],
  ['sandbox_small', ['sandbox'], 'proc:sandbox_small'], ['cafe_table_solo', ['cafe_table'], 'proc:cafe_table_solo'], ['synth', ['piano'], 'proc:synth'],
]) add(key, 'furn', kinds, src, o);

add('food_stall_cart', 'furn', ['food_stall'], 'proc:stall_cart');
add('dumbbells', 'furn', ['exercise_bench', 'gym_machine'], 'proc:dumbbells');
add('flowerbed_roses', 'furn', ['flowerbed'], [P('proc:bed_soil'), ...[[-0.3, -0.25], [0, -0.25], [0.3, -0.25], [-0.3, 0.05], [0, 0.05], [0.3, 0.05], [-0.15, 0.3], [0.15, 0.3]].map(([x, z], i) => P('n:' + ['flower_redA', 'flower_redB', 'flower_redC'][i % 3], [x, 0.08, z], 0, 1.7))], { sc: 1 });
add('flowerbed_veg', 'furn', ['flowerbed'], [P('proc:bed_soil'), ...[[-0.25, -0.25, 'crop_carrot'], [0.25, -0.25, 'crop_turnip'], [-0.25, 0.25, 'crop_pumpkin'], [0.25, 0.25, 'crop_melon']].map(([x, z, f]) => P('n:' + f, [x, 0.08, z], 0, 1.1))], { sc: 1 });

// ======================= ПРОЦЕДУРНЫЕ =======================
const PR = {
  async exercise_bike(doc) { const f = mat(doc, 'frame', '#2f5fa6', { metal: 0.3, rough: 0.4 }), dk = mat(doc, 'seat', '#1d1d1d'), sc = mat(doc, 'display', '#1d3b5a', { emissive: '#12324f' }); const F = G(), D = G(), S = G();
    box(F, 0, 0, 0, 0.5, 0.06, 1.1); box(F, 0, 0.06, -0.35, 0.08, 0.9, 0.08); box(F, 0, 0.06, 0.25, 0.08, 1.1, 0.08); cyl(D, 0, 0.35, -0.1, 0.22, 0.22, 0.06, 16, 'x'); D.pos = D.pos.map((v, i) => i % 3 === 0 ? v - 0.03 : v);
    box(D, 0, 0.96, -0.35, 0.28, 0.07, 0.34); box(F, 0, 1.16, 0.25, 0.5, 0.04, 0.05); box(S, 0, 1.12, 0.3, 0.2, 0.14, 0.04); return meshNode(doc, 'exercise_bike', [[F, f], [D, dk], [S, sc]]); },
  async bathtub_clawfoot(doc) { const w = mat(doc, 'enamel', '#f3f1ec', { rough: 0.25 }), g = mat(doc, 'gold', '#c9a14a', { metal: 0.7, rough: 0.3 }), wt = mat(doc, 'water', '#9fd6ea', { alpha: 0.6 }); const W = G(), Gd = G(), T = G();
    sphere(W, 0, 0.62, 0, 0.47, 0.42, 0.31, 18, 8); W.pos = W.pos.map((v, i) => (i % 3 === 1 && v > 0.62) ? 0.62 : v); box(W, 0, 0.6, 0, 0.9, 0.06, 0.6); box(T, 0, 0.58, 0, 0.8, 0.01, 0.48);
    for (const x of [-0.33, 0.33]) for (const z of [-0.18, 0.18]) { cyl(Gd, x, 0, z, 0.05, 0.03, 0.26, 8); } cyl(Gd, 0.42, 0.66, 0, 0.02, 0.02, 0.22, 6); return meshNode(doc, 'bathtub_clawfoot', [[W, w], [Gd, g], [T, wt]]); },
  async beanbag(doc) { const f = mat(doc, 'fabric', '#c0392b', { rough: 0.9 }); const F = G(); sphere(F, 0, 0.3, 0, 0.45, 0.32, 0.45, 16, 10); sphere(F, 0, 0.55, -0.18, 0.3, 0.22, 0.2, 12, 8); F.pos = F.pos.map((v, i) => (i % 3 === 1 && v < 0) ? 0 : v); return meshNode(doc, 'beanbag', [[F, f]]); },
  async egg_chair(doc) { const sh = mat(doc, 'shell', '#f2efe8', { rough: 0.3 }), c = mat(doc, 'cushion', '#c0392b', { rough: 0.8 }), m = mat(doc, 'metal', '#9aa0a6', { metal: 0.6, rough: 0.3 }); const S = G(), C = G(), M = G();
    sphere(S, 0, 0.85, -0.05, 0.5, 0.62, 0.45, 18, 10); S.pos = S.pos.map((v, i, a) => (i % 3 === 2 && a[i] > 0.12) ? 0.12 : v); sphere(C, 0, 0.62, 0.02, 0.38, 0.16, 0.3, 14, 7); cyl(M, 0, 0, 0, 0.3, 0.25, 0.03, 16); cyl(M, 0, 0.03, 0, 0.04, 0.04, 0.3, 8); return meshNode(doc, 'egg_chair', [[S, sh], [C, c], [M, m]]); },
  async rocking_chair(doc) { const w = mat(doc, 'wood', '#8a5a34'), c = mat(doc, 'cushion', '#6f8f5a'); const W = G(), C = G();
    for (const x of [-0.25, 0.25]) for (let i = 0; i < 8; i++) { const t = (i / 7 - 0.5) * 1.6; box(W, x, 0.06 + t * t * 0.18, t * 0.4, 0.04, 0.04, 0.13); }
    for (const x of [-0.24, 0.24]) { box(W, x, 0.08, 0.18, 0.04, 0.4, 0.04); box(W, x, 0.08, -0.2, 0.04, 1.0, 0.04); box(W, x, 0.62, 0, 0.04, 0.04, 0.42); } box(C, 0, 0.44, 0, 0.5, 0.06, 0.45); box(W, 0, 0.5, -0.22, 0.5, 0.55, 0.04); for (let i = 0; i < 5; i++) box(W, -0.2 + i * 0.1, 0.5, -0.2, 0.03, 0.55, 0.03);
    return meshNode(doc, 'rocking_chair', [[W, w], [C, c]]); },
  async deck_chair(doc) { const w = mat(doc, 'wood', '#c8a06a'), f = mat(doc, 'fabric', '#2f7fbf', { ds: true }); const W = G(), F = G(); for (const x of [-0.28, 0.28]) { for (let i = 0; i < 6; i++) { const t = i / 5; box(W, x, 0.05 + t * 0.7, 0.3 - t * 0.55, 0.035, 0.14, 0.035); box(W, x, 0.05 + t * 0.35, -0.3 + t * 0.55, 0.035, 0.08, 0.035); } }
    for (let i = 0; i < 10; i++) { const t = i / 9; box(F, 0, 0.12 + t * 0.62, 0.25 - t * 0.5, 0.52, 0.01, 0.07); } return meshNode(doc, 'deck_chair', [[W, w], [F, f]]); },
  async exec_chair(doc) { const l = mat(doc, 'leather', '#3a2418', { rough: 0.45 }), m = mat(doc, 'metal', '#2b2b2b', { metal: 0.5, rough: 0.35 }); const L = G(), M = G();
    box(L, 0, 0.45, 0, 0.58, 0.12, 0.55); box(L, 0, 0.55, -0.24, 0.58, 0.8, 0.12); sphere(L, 0, 1.33, -0.24, 0.29, 0.1, 0.07, 10, 5); for (const x of [-0.31, 0.31]) box(L, x, 0.55, 0.02, 0.07, 0.2, 0.45);
    cyl(M, 0, 0.1, 0, 0.04, 0.04, 0.35, 8); for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; box(M, Math.cos(a) * 0.15, 0.06, Math.sin(a) * 0.15, 0.05, 0.04, 0.05); box(M, Math.cos(a) * 0.28, 0, Math.sin(a) * 0.28, 0.06, 0.06, 0.06); box(M, Math.cos(a) * 0.08, 0.08, Math.sin(a) * 0.08, 0.2, 0.03, 0.04); }
    return meshNode(doc, 'exec_chair', [[L, l], [M, m]]); },
  async water_bed(doc) { const f = mat(doc, 'frame', '#5a3620'), w = mat(doc, 'mattress', '#3f8fc0', { rough: 0.15 }), p = mat(doc, 'pillow', '#f2efe8'); const F = G(), W = G(), P = G(); box(F, 0, 0, 0, 1.9, 0.35, 2.0); box(F, 0, 0, -0.97, 1.9, 0.9, 0.08);
    for (let i = 0; i < 6; i++) sphere(W, 0, 0.35, -0.75 + i * 0.32, 0.88, 0.08, 0.2, 14, 6); box(W, 0, 0.3, 0, 1.78, 0.1, 1.88); for (const x of [-0.45, 0.45]) sphere(P, x, 0.47, -0.78, 0.3, 0.07, 0.14, 10, 5); return meshNode(doc, 'water_bed', [[F, f], [W, w], [P, p]]); },
  async round_bed(doc) { const f = mat(doc, 'frame', '#e8e2d8'), m = mat(doc, 'blanket', '#b0413e', { rough: 0.9 }), p = mat(doc, 'pillow', '#f2efe8'); const F = G(), M = G(), P = G(); cyl(F, 0, 0, 0, 0.98, 0.98, 0.3, 28); cyl(M, 0, 0.3, 0, 0.93, 0.93, 0.14, 28); box(F, 0, 0, -0.9, 1.4, 0.95, 0.1);
    for (const x of [-0.35, 0.35]) sphere(P, x, 0.5, -0.62, 0.28, 0.08, 0.14, 10, 5); return meshNode(doc, 'round_bed', [[F, f], [M, m], [P, p]]); },
  async fridge_retro(doc) { const w = mat(doc, 'enamel', '#efece2', { rough: 0.25 }), c = mat(doc, 'chrome', '#c8ccd0', { metal: 0.8, rough: 0.2 }), r = mat(doc, 'logo', '#c0392b'); const W = G(), C = G(), R = G();
    box(W, 0, 0.08, 0, 0.72, 1.42, 0.66); sphere(W, 0, 1.5, 0, 0.36, 0.1, 0.33, 14, 5, true); box(C, 0.28, 0.9, 0.34, 0.04, 0.3, 0.05); box(C, 0, 0, 0, 0.66, 0.08, 0.6); box(R, 0, 1.2, 0.331, 0.2, 0.05, 0.005); box(C, 0, 0.35, 0.331, 0.6, 0.02, 0.005);
    return meshNode(doc, 'fridge_retro', [[W, w], [C, c], [R, r]]); },
  async projector(doc) { const s = mat(doc, 'screen', '#f7f7f5', { rough: 0.9, emissive: '#303030' }), f = mat(doc, 'frame', '#2b2b2b'), b = mat(doc, 'projector', '#dcdcdc'); const S = G(), F = G(), B = G();
    box(S, 0, 0.9, -0.3, 1.6, 1.0, 0.02); box(F, 0, 0, -0.3, 0.06, 1.95, 0.06); box(F, 0, 1.9, -0.3, 1.7, 0.06, 0.06); for (const x of [-0.3, 0.3]) box(F, x, 0, -0.3, 0.6, 0.03, 0.05); box(F, 0, 0, 0.3, 0.35, 0.6, 0.35); box(B, 0, 0.6, 0.3, 0.3, 0.12, 0.25); cyl(F, 0, 0.66, 0.17, 0.04, 0.04, 0.03, 10, 'z');
    return meshNode(doc, 'projector', [[S, s], [F, f], [B, b]]); },
  async radio_retro(doc) { const w = mat(doc, 'wood', '#6b4a2b', { rough: 0.4 }), f = mat(doc, 'fabric', '#c8b07a', { rough: 0.95 }), d = mat(doc, 'dial', '#f0d98a', { emissive: '#3a2a0a' }); const W = G(), F = G(), D = G();
    box(W, 0, 0, 0, 0.8, 0.9, 0.4); sphere(W, 0, 0.9, 0, 0.4, 0.12, 0.2, 14, 5, true); box(F, 0, 0.35, 0.201, 0.62, 0.4, 0.005); box(D, 0, 0.78, 0.201, 0.4, 0.08, 0.005); for (const x of [-0.25, 0.25]) cyl(W, x, 0.65, 0.2, 0.035, 0.035, 0.03, 10, 'z');
    return meshNode(doc, 'radio_retro', [[W, w], [F, f], [D, d]]); },
  async boombox(doc) { const b = mat(doc, 'plastic', '#2b2b2e', { rough: 0.4 }), s = mat(doc, 'speaker', '#111'), c = mat(doc, 'chrome', '#c8ccd0', { metal: 0.8, rough: 0.2 }); const B = G(), S = G(), C = G();
    box(B, 0, 0, 0, 0.6, 0.3, 0.16); for (const x of [-0.19, 0.19]) { cyl(S, x, 0.15, 0.08, 0.1, 0.1, 0.01, 16, 'z'); cyl(C, x, 0.15, 0.081, 0.11, 0.11, 0.005, 16, 'z'); } box(C, 0, 0.18, 0.081, 0.12, 0.08, 0.005); box(C, 0, 0.3, 0, 0.4, 0.03, 0.03); for (const x of [-0.2, 0.2]) box(C, x, 0.28, 0, 0.03, 0.08, 0.03);
    return meshNode(doc, 'boombox', [[B, b], [C, c], [S, s]]); },
  async jukebox(doc) { const w = mat(doc, 'wood', '#7a2e2e', { rough: 0.35 }), c = mat(doc, 'chrome', '#d8dcdf', { metal: 0.8, rough: 0.2 }), g = mat(doc, 'glow', '#f5b642', { emissive: '#f08a1a' }), gl = mat(doc, 'glass', '#cfe6ee', { alpha: 0.35 }); const W = G(), C = G(), Gw = G(), Gl = G();
    box(W, 0, 0, 0, 0.9, 1.1, 0.6); sphere(W, 0, 1.1, 0, 0.45, 0.45, 0.3, 16, 8, true); box(Gw, 0, 0.1, 0.301, 0.7, 0.08, 0.01); for (const x of [-0.4, 0.4]) box(Gw, x, 0.2, 0.28, 0.06, 1.0, 0.06); box(Gl, 0, 0.75, 0.3, 0.6, 0.45, 0.01); box(C, 0, 0.55, 0.3, 0.64, 0.06, 0.03); for (let i = 0; i < 6; i++) cyl(C, -0.2 + i * 0.08, 0.35, 0.3, 0.025, 0.025, 0.02, 8, 'z');
    return meshNode(doc, 'jukebox', [[W, w], [C, c], [Gw, g], [Gl, gl]]); },
  async lava_lamp(doc) { const m = mat(doc, 'metal', '#b0b4b8', { metal: 0.7, rough: 0.3 }), gl = mat(doc, 'glass', '#f08a3a', { alpha: 0.6, emissive: '#a03a10' }), b = mat(doc, 'blobs', '#ffd23a', { emissive: '#ff8a00' }); const M = G(), Gl = G(), B = G();
    cyl(M, 0, 0, 0, 0.08, 0.05, 0.14, 14); cyl(Gl, 0, 0.14, 0, 0.05, 0.035, 0.26, 14); cyl(M, 0, 0.4, 0, 0.035, 0.02, 0.06, 12); sphere(B, 0, 0.2, 0, 0.03); sphere(B, 0.005, 0.3, 0, 0.022); sphere(B, -0.005, 0.36, 0, 0.015); return meshNode(doc, 'lava_lamp', [[M, m], [Gl, gl], [B, b]]); },
  async arc_lamp(doc) { const m = mat(doc, 'metal', '#c8ccd0', { metal: 0.8, rough: 0.2 }), s = mat(doc, 'shade', '#f2efe8', { emissive: '#5a5040' }), b = mat(doc, 'marble', '#2b2b2b', { rough: 0.3 }); const M = G(), S = G(), B = G();
    box(B, 0, 0, -0.3, 0.3, 0.12, 0.3); for (let i = 0; i < 14; i++) { const a = i / 13 * Math.PI * 0.62; box(M, 0, 0.12 + Math.sin(a) * 1.7, -0.3 + (1 - Math.cos(a)) * 0.95, 0.03, 0.18, 0.03); }
    sphere(S, 0, 1.55, 0.55, 0.2, 0.2, 0.2, 14, 7, true); S.pos = S.pos.map((v, i) => (i % 3 === 1) ? 1.55 + (1.55 - v) * 0.8 + 0.15 : v); return meshNode(doc, 'arc_lamp', [[M, m], [S, s], [B, b]]); },
  async mirror_full(doc) { const f = mat(doc, 'frame', '#c9a14a', { metal: 0.5, rough: 0.3 }), g = mat(doc, 'mirror', '#dfe9ee', { metal: 1, rough: 0.05 }); const F = G(), M = G();
    box(F, 0, 0, 0, 0.62, 1.75, 0.06); box(M, 0, 0.05, 0.031, 0.54, 1.65, 0.005); for (const x of [-0.25, 0.25]) box(F, x, 0, -0.25, 0.04, 0.04, 0.5); box(F, 0, 0.1, -0.2, 0.04, 1.0, 0.04); return meshNode(doc, 'mirror_full', [[F, f], [M, g]]); },
  async rug_bear(doc) { const f = mat(doc, 'fur', '#6b4a2b', { rough: 1 }), d = mat(doc, 'furDark', '#3a2618', { rough: 1 }); const F = G(), D = G(); box(F, 0, 0, 0, 0.8, 0.03, 1.1); for (const [x, z] of [[-0.55, -0.35], [0.55, -0.35], [-0.55, 0.35], [0.55, 0.35]]) box(F, x, 0, z, 0.35, 0.025, 0.18);
    sphere(D, 0, 0.08, -0.72, 0.18, 0.1, 0.2, 10, 6); box(D, 0, 0, 0.62, 0.12, 0.02, 0.18); return meshNode(doc, 'rug_bear', [[F, f], [D, d]]); },
  async yoga_mat(doc) { const m = mat(doc, 'mat', '#7a4fb0', { rough: 0.8 }); const M = G(); box(M, 0, 0, 0, 0.65, 0.01, 1.8); cyl(M, 0, 0.06, -0.9, 0.06, 0.06, 0.65, 12, 'x'); return meshNode(doc, 'yoga_mat', [[M, m]]); },
  async punching_bag(doc) { const b = mat(doc, 'leather', '#b0302a', { rough: 0.5 }), f = mat(doc, 'frame', '#2b2b2b', { metal: 0.5, rough: 0.4 }); const B = G(), F = G(); cyl(B, 0, 0.55, 0, 0.18, 0.18, 0.95, 14); box(F, 0, 0, -0.45, 0.6, 0.05, 0.5); box(F, 0, 0, -0.55, 0.06, 2.1, 0.06); box(F, 0, 2.05, -0.3, 0.06, 0.06, 0.55); box(F, 0, 1.5, 0, 0.01, 0.55, 0.01);
    return meshNode(doc, 'punching_bag', [[B, b], [F, f]]); },
  async phone_wall(doc) { const b = mat(doc, 'plastic', '#e8e2d0', { rough: 0.4 }), d = mat(doc, 'cord', '#2b2b2b'); const B = G(), D = G(); box(B, 0, 0, 0.03, 0.14, 0.24, 0.06); box(B, 0.1, 0.02, 0.05, 0.05, 0.2, 0.05); for (let i = 0; i < 8; i++) box(D, 0.1, -0.02 - i * 0.03, 0.05, 0.02, 0.02, 0.02); cyl(D, 0, 0.12, 0.06, 0.04, 0.04, 0.01, 12, 'z');
    return meshNode(doc, 'phone_wall', [[B, b], [D, d]]); },
  async porthole(doc) { const r = mat(doc, 'brass', '#c9a14a', { metal: 0.7, rough: 0.3 }), g = mat(doc, 'glass', '#bfe3f2', { alpha: 0.35, rough: 0.05 }); const R = G(), Gl = G(); for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; box(R, Math.cos(a) * 0.36, 0.4 + Math.sin(a) * 0.36 - 0.05, 0, 0.1, 0.1, 0.2); } cyl(Gl, 0, 0.4, -0.01, 0.34, 0.34, 0.02, 24, 'z');
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; cyl(R, Math.cos(a) * 0.42, 0.4 + Math.sin(a) * 0.42, 0.1, 0.02, 0.02, 0.02, 6, 'z'); } return meshNode(doc, 'porthole', [[R, r], [Gl, g]]); },
  async pool_round(doc) { const r = mat(doc, 'poolRim', '#2f9a5a', { rough: 0.5 }), w = mat(doc, 'water', '#4fc0e8', { alpha: 0.8, emissive: '#0a3a4a' }), e = mat(doc, 'eyes', '#f2efe8'); const R = G(), W = G(), E = G();
    cyl(R, 0, 0, 0, 1.4, 1.4, 0.45, 24, 'y', false); cyl(R, 0, 0, 0, 1.25, 1.25, 0.45, 24, 'y', false); for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; box(R, Math.cos(a) * 1.32, 0.42, Math.sin(a) * 1.32, 0.38, 0.06, 0.2); } cyl(W, 0, 0.3, 0, 1.26, 1.26, 0.01, 24);
    for (const x of [-0.4, 0.4]) { sphere(R, x, 0.55, -1.3, 0.2); sphere(E, x, 0.6, -1.14, 0.08); } return meshNode(doc, 'pool_round', [[R, r], [W, w], [E, e]]); },
  async fountain_small(doc) { const s = mat(doc, 'stone', '#b8b4aa', { rough: 0.9 }), w = mat(doc, 'water', '#6fc3e6', { alpha: 0.75, emissive: '#0a3a4a' }); const S = G(), W = G();
    cyl(S, 0, 0, 0, 0.46, 0.46, 0.3, 18); cyl(W, 0, 0.3, 0, 0.4, 0.4, 0.01, 18); cyl(S, 0, 0.3, 0, 0.08, 0.06, 0.45, 10); cyl(S, 0, 0.75, 0, 0.25, 0.25, 0.08, 14); cyl(W, 0, 0.83, 0, 0.21, 0.21, 0.01, 14); cyl(S, 0, 0.83, 0, 0.04, 0.03, 0.2, 8); sphere(W, 0, 1.06, 0, 0.05);
    return meshNode(doc, 'fountain_small', [[S, s], [W, w]]); },
  async sandbox_small(doc) { const w = mat(doc, 'wood', '#c8914a'), s = mat(doc, 'sand', '#e3cf8a', { rough: 1 }), t = mat(doc, 'toy', '#e04040'); const W = G(), S = G(), T = G();
    for (const [x, z, ww, dd] of [[0, -0.43, 0.94, 0.08], [0, 0.43, 0.94, 0.08], [-0.43, 0, 0.08, 0.94], [0.43, 0, 0.08, 0.94]]) box(W, x, 0, z, ww, 0.2, dd); box(S, 0, 0, 0, 0.8, 0.14, 0.8); cyl(T, 0.2, 0.14, -0.15, 0.06, 0.08, 0.1, 10); return meshNode(doc, 'sandbox_small', [[W, w], [S, s], [T, t]]); },
  async cafe_table_solo(doc) { const top = mat(doc, 'tableTop', '#f2efe8', { rough: 0.3 }), m = mat(doc, 'metal', '#2b2b2b', { metal: 0.5, rough: 0.4 }); const T = G(), M = G(); cyl(T, 0, 0.72, 0, 0.4, 0.4, 0.03, 20); cyl(M, 0, 0.02, 0, 0.03, 0.03, 0.7, 8); cyl(M, 0, 0, 0, 0.24, 0.22, 0.02, 12);
    return meshNode(doc, 'cafe_table_solo', [[T, top], [M, m]]); },
  async register_small(doc) { const c = mat(doc, 'counter', '#8a5a34'), t = mat(doc, 'top', '#e8e2d8'), r = mat(doc, 'register', '#3a3d42', { rough: 0.4 }), s = mat(doc, 'display', '#1d6b3a', { emissive: '#0a3a1a' }); const C = G(), T = G(), R = G(), S = G();
    box(C, 0, 0, 0, 0.94, 0.95, 0.6); box(T, 0, 0.95, 0, 0.96, 0.04, 0.62); box(R, 0.15, 0.99, 0, 0.36, 0.12, 0.3); box(R, 0.15, 1.11, -0.1, 0.3, 0.14, 0.06); box(S, 0.15, 1.2, -0.06, 0.2, 0.06, 0.01); box(R, -0.25, 0.99, 0.05, 0.22, 0.03, 0.2);
    return meshNode(doc, 'register_small', [[C, c], [T, t], [R, r], [S, s]]); },
  async synth(doc) { const b = mat(doc, 'body', '#2b2b2e', { rough: 0.35 }), w = mat(doc, 'keysWhite', '#f4f1ea'), k = mat(doc, 'keysBlack', '#0c0c0c'), st = mat(doc, 'stand', '#9aa0a6', { metal: 0.6 }), led = mat(doc, 'leds', '#e040a0', { emissive: '#a02070' }); const B = G(), W = G(), K = G(), S = G(), L = G();
    box(B, 0, 0.78, 0, 0.98, 0.08, 0.32); box(W, 0, 0.86, 0.06, 0.9, 0.02, 0.14); for (let i = 0; i < 30; i++) if ([1, 2, 4, 5, 6].includes(i % 7)) box(K, -0.44 + i * 0.03, 0.88, 0.03, 0.014, 0.015, 0.08); for (let i = 0; i < 8; i++) box(L, -0.4 + i * 0.1, 0.86, -0.1, 0.03, 0.01, 0.03);
    for (const x of [-0.3, 0.3]) { box(S, x, 0, 0, 0.04, 0.78, 0.04); box(S, x, 0, 0, 0.04, 0.03, 0.5); } return meshNode(doc, 'synth', [[B, b], [W, w], [K, k], [S, st], [L, led]]); },
  async stall_cart(doc) { const w = mat(doc, 'wood', '#c8914a'), a = mat(doc, 'awning', '#d64040', { ds: true }), a2 = mat(doc, 'awningWhite', '#f2efe8', { ds: true }), m = mat(doc, 'wheel', '#2b2b2b'); const W = G(), A = G(), A2 = G(), M = G();
    box(W, 0, 0.35, 0, 1.8, 0.6, 0.8); box(W, 0, 0.95, 0.3, 1.8, 0.04, 0.3); for (const x of [-0.85, 0.85]) for (const z of [-0.36, 0.36]) box(W, x, 0.95, z, 0.05, 1.2, 0.05);
    for (let i = 0; i < 8; i++) box(i % 2 ? A2 : A, -0.9 + (i + 0.5) * 0.225, 2.15, 0, 0.225, 0.05, 1.0); for (let i = 0; i < 8; i++) box(i % 2 ? A2 : A, -0.9 + (i + 0.5) * 0.225, 1.95, 0.5, 0.225, 0.2, 0.02);
    for (const x of [-0.6, 0.6]) cyl(M, x, 0.3, 0.41, 0.3, 0.3, 0.05, 14, 'z'); return meshNode(doc, 'stall_cart', [[W, w], [A, a], [A2, a2], [M, m]]); },
  async dumbbells(doc) { const f = mat(doc, 'frame', '#2b2b2e', { metal: 0.4, rough: 0.4 }), w = mat(doc, 'weights', '#151515'), c = mat(doc, 'chrome', '#c8ccd0', { metal: 0.8, rough: 0.2 }); const F = G(), W = G(), C = G();
    for (const x of [-0.4, 0.4]) { box(F, x, 0, 0, 0.05, 0.8, 0.4); } box(F, 0, 0.3, 0, 0.85, 0.03, 0.35); box(F, 0, 0.6, -0.05, 0.85, 0.03, 0.3);
    for (let i = 0; i < 4; i++) for (const [y, z] of [[0.33, 0], [0.63, -0.05]]) { const x = -0.3 + i * 0.2, r = 0.04 + i * 0.008; cyl(C, x - 0.07, y + r, z, 0.012, 0.012, 0.14, 6, 'x'); cyl(W, x - 0.07, y + r, z, r, r, 0.035, 10, 'x'); cyl(W, x + 0.035, y + r, z, r, r, 0.035, 10, 'x'); } return meshNode(doc, 'dumbbells', [[F, f], [W, w], [C, c]]); },
  async fireplace(doc) { const brick = mat(doc, 'brick', '#a4553f'), dark = mat(doc, 'soot', '#1c1a19'), mantel = mat(doc, 'wood', '#6b4a2b'), fire = mat(doc, 'fire', '#ff9a2e', { emissive: '#ff6a00' });
    const B = G(), D = G(), M = G(), F = G(); box(B, 0, 0, 0, 1.3, 1.1, 0.5); box(B, 0, 1.1, -0.05, 0.9, 1.4, 0.4); box(D, 0, 0.12, 0.2, 0.7, 0.6, 0.12); box(M, 0, 1.1, 0.02, 1.45, 0.08, 0.56);
    box(D, 0, 0, 0.3, 1.4, 0.06, 0.2); for (const x of [-0.15, 0, 0.15]) cyl(F, x, 0.13, 0.2, 0.08, 0.01, 0.3, 6); return meshNode(doc, 'fireplace', [[B, brick], [D, dark], [M, mantel], [F, fire]]); },
  async fireplace_stone(doc) { const st = mat(doc, 'stone', '#8d8a84', { rough: 0.95 }), dark = mat(doc, 'soot', '#1c1a19'), fire = mat(doc, 'fire', '#ff9a2e', { emissive: '#ff6a00' });
    const S = G(), D = G(), F = G(); box(S, 0, 0, 0, 1.4, 1.2, 0.55); box(S, 0, 1.2, 0, 1.0, 0.25, 0.45); box(S, 0, 1.45, -0.05, 0.6, 1.0, 0.35); box(D, 0, 0.15, 0.22, 0.75, 0.62, 0.12); cyl(F, 0, 0.16, 0.22, 0.14, 0.01, 0.35, 7);
    return meshNode(doc, 'fireplace_stone', [[S, st], [D, dark], [F, fire]]); },
  async piano(doc) { const bl = mat(doc, 'lacquer', '#1a1716', { rough: 0.25 }), wh = mat(doc, 'keysWhite', '#f4f1ea', { rough: 0.3 }), kb = mat(doc, 'keysBlack', '#0c0c0c');
    const B = G(), W = G(), K = G(); box(B, 0, 0, -0.12, 1.5, 1.25, 0.4); box(B, 0, 0.68, 0.08, 1.5, 0.05, 0.22); for (const x of [-0.7, 0.7]) box(B, x, 0, 0.12, 0.06, 0.7, 0.06);
    box(W, 0, 0.73, 0.11, 1.3, 0.025, 0.16); for (let i = 0; i < 36; i++) if ([1, 2, 4, 5, 6].includes(i % 7)) box(K, -0.64 + i * (1.3 / 36), 0.755, 0.07, 0.018, 0.02, 0.09);
    box(B, 0, 0, 0.45, 0.8, 0.46, 0.3); return meshNode(doc, 'piano', [[B, bl], [W, wh], [K, kb]]); },
  async piano_grand(doc) { const bl = mat(doc, 'lacquer', '#1a1716', { rough: 0.25 }), wh = mat(doc, 'keysWhite', '#f4f1ea'), kb = mat(doc, 'keysBlack', '#0c0c0c');
    const B = G(), W = G(), K = G(); box(B, 0, 0.62, -0.2, 1.4, 0.32, 1.3); cyl(B, 0.2, 0.62, -0.85, 0.5, 0.5, 0.32, 16); for (const [x, z] of [[-0.6, 0.35], [0.6, 0.35], [0.1, -1.1]]) box(B, x, 0, z, 0.08, 0.62, 0.08);
    box(W, 0, 0.8, 0.52, 1.3, 0.025, 0.16); for (let i = 0; i < 36; i++) if ([1, 2, 4, 5, 6].includes(i % 7)) box(K, -0.64 + i * (1.3 / 36), 0.825, 0.48, 0.018, 0.02, 0.09);
    const lid = G(); box(lid, 0, 0.94, -0.35, 1.3, 0.03, 1.0); return meshNode(doc, 'piano_grand', [[B, bl], [W, wh], [K, kb], [lid, bl]]); },
  async guitar(doc) { const wood = mat(doc, 'guitarBody', '#b5652a', { rough: 0.35 }), dark = mat(doc, 'fretboard', '#2a1c12'), stand = mat(doc, 'stand', '#222'); const Bd = G(), N = G(), S = G();
    sphere(Bd, 0, 0.32, 0.05, 0.19, 0.2, 0.06, 14, 8); sphere(Bd, 0, 0.6, 0.05, 0.14, 0.14, 0.055, 14, 8); box(N, 0, 0.7, 0.07, 0.05, 0.55, 0.03); box(N, 0, 1.24, 0.07, 0.08, 0.14, 0.03); cyl(N, 0, 0.45, 0.11, 0.045, 0.045, 0.004, 12, 'z');
    box(S, 0, 0, 0, 0.3, 0.03, 0.25); box(S, 0, 0, -0.1, 0.03, 0.9, 0.03); return meshNode(doc, 'guitar', [[Bd, wood], [N, dark], [S, stand]]); },
  async telescope(doc) { const w = mat(doc, 'tripod', '#6b4a2b'), t = mat(doc, 'tube', '#e8e4da', { rough: 0.3 }), br = mat(doc, 'brass', '#c9a14a', { metal: 0.6, rough: 0.35 }); const L = G(), T = G(), B = G();
    for (const a of [0, 2.1, 4.2]) { const x = Math.cos(a) * 0.35, z = Math.sin(a) * 0.35; for (let i = 0; i < 6; i++) { const f = (i + 0.5) / 6; box(L, x * (1 - f), 1.1 * f - 0.09, z * (1 - f), 0.035, 0.2, 0.035); } }
    cyl(T, 0, 1.15, -0.45, 0.08, 0.1, 1.1, 14, 'z'); cyl(B, 0, 1.15, 0.65, 0.105, 0.105, 0.06, 14, 'z'); box(B, 0, 1.05, 0.1, 0.08, 0.12, 0.08); return meshNode(doc, 'telescope', [[L, w], [T, t], [B, br]]); },
  async aquarium(doc) { const c = mat(doc, 'cabinet', '#2b2b2e'), gl = mat(doc, 'glass', '#bfe3f2', { alpha: 0.3, rough: 0.05 }), wt = mat(doc, 'water', '#2f8fc0', { alpha: 0.55, rough: 0.1 }), sand = mat(doc, 'sand', '#d9c27a'), fish = mat(doc, 'fish', '#ff7a1a', { emissive: '#552200' }), weed = mat(doc, 'weed', '#3f9a4a');
    const C = G(), Gl = G(), W = G(), S = G(), F = G(), Wd = G(); box(C, 0, 0, 0, 1.2, 0.75, 0.45); box(C, 0, 1.3, 0, 1.22, 0.06, 0.47); box(S, 0, 0.75, 0, 1.16, 0.05, 0.41); box(W, 0, 0.8, 0, 1.16, 0.44, 0.41); box(Gl, 0, 0.75, 0, 1.2, 0.55, 0.45);
    for (const [x, y, z] of [[-0.3, 1.0, 0.05], [0.1, 1.1, -0.05], [0.35, 0.95, 0.08]]) sphere(F, x, y, z, 0.05, 0.025, 0.015, 8, 5); for (const x of [-0.45, -0.1, 0.4]) cyl(Wd, x, 0.8, -0.1, 0.03, 0.005, 0.35, 5);
    return meshNode(doc, 'aquarium', [[C, c], [S, sand], [F, fish], [Wd, weed], [W, wt], [Gl, gl]]); },
  async pool_table(doc) { const felt = mat(doc, 'felt', '#1f7a3f', { rough: 0.95 }), wood = mat(doc, 'wood', '#5a3620'), ball = mat(doc, 'balls', '#e9e2cf', { rough: 0.2 }), red = mat(doc, 'ballsRed', '#c0392b', { rough: 0.2 });
    const F = G(), W = G(), B = G(), R = G(); box(W, 0, 0.6, 0, 2.2, 0.18, 1.2); box(F, 0, 0.78, 0, 1.96, 0.01, 0.96); for (const [x, z] of [[-1.02, 0], [1.02, 0], [0, -0.52], [0, 0.52]]) box(W, x, 0.78, z, x ? 0.14 : 2.2, 0.06, z ? 0.14 : 1.2);
    for (const x of [-0.95, 0.95]) for (const z of [-0.45, 0.45]) box(W, x, 0, z, 0.14, 0.6, 0.14); for (let i = 0; i < 6; i++) sphere(i % 2 ? R : B, 0.35 + (i % 3) * 0.06, 0.82, -0.06 + Math.floor(i / 3) * 0.07, 0.028, 0.028, 0.028, 8, 6); sphere(B, -0.5, 0.82, 0, 0.028, 0.028, 0.028, 8, 6);
    return meshNode(doc, 'pool_table', [[W, wood], [F, felt], [B, ball], [R, red]]); },
  async dartboard(doc) { const bk = mat(doc, 'board', '#1a1a1a'), r = mat(doc, 'ringRed', '#c0392b'), g = mat(doc, 'ringGreen', '#2e8b57'), c = mat(doc, 'cork', '#e3d3a8'); const A = G(), R = G(), Gr = G(), C = G();
    cyl(A, 0, 0, 0, 0.24, 0.24, 0.04, 24, 'z'); cyl(C, 0, 0, 0.04, 0.2, 0.2, 0.004, 20, 'z'); cyl(R, 0, 0, 0.044, 0.17, 0.17, 0.003, 20, 'z'); cyl(C, 0, 0, 0.047, 0.15, 0.15, 0.003, 20, 'z'); cyl(Gr, 0, 0, 0.05, 0.08, 0.08, 0.003, 16, 'z'); cyl(C, 0, 0, 0.053, 0.06, 0.06, 0.003, 16, 'z'); cyl(R, 0, 0, 0.056, 0.015, 0.015, 0.004, 10, 'z');
    return meshNode(doc, 'dartboard', [[A, bk], [C, c], [R, r], [Gr, g]]); },
  async game_console(doc) { const cab = mat(doc, 'cabinet', '#3a3a3e'), tv = mat(doc, 'screen', '#0d1a2a', { rough: 0.15, emissive: '#10304a' }), bez = mat(doc, 'bezel', '#111'), con = mat(doc, 'console', '#ececec', { rough: 0.35 });
    const C = G(), S = G(), B = G(), X = G(); box(C, 0, 0, 0, 1.0, 0.5, 0.42); box(B, 0, 0.5, -0.05, 0.9, 0.55, 0.05); box(S, 0, 0.53, -0.02, 0.84, 0.49, 0.005); box(B, 0, 0.5, -0.05, 0.25, 0.02, 0.2); box(X, 0.25, 0.3, 0.12, 0.3, 0.07, 0.18); box(X, -0.2, 0.5, 0.12, 0.12, 0.03, 0.07);
    return meshNode(doc, 'game_console', [[C, cab], [B, bez], [S, tv], [X, con]]); },
  async treadmill(doc) { const f = mat(doc, 'frame', '#3a3d42', { metal: 0.4, rough: 0.4 }), belt = mat(doc, 'belt', '#151515'), sc = mat(doc, 'display', '#1d3b5a', { emissive: '#12324f' }); const F = G(), B = G(), S = G();
    box(F, 0, 0, 0, 0.8, 0.15, 1.8); box(B, 0, 0.15, 0.05, 0.56, 0.02, 1.6); for (const x of [-0.36, 0.36]) box(F, x, 0.15, -0.72, 0.05, 1.15, 0.06); box(F, 0, 1.2, -0.72, 0.8, 0.05, 0.3); box(S, 0, 1.25, -0.72, 0.4, 0.2, 0.05);
    return meshNode(doc, 'treadmill', [[F, f], [B, belt], [S, sc]]); },
  async hot_tub(doc) { const w = mat(doc, 'wood', '#7a5234'), wt = mat(doc, 'water', '#3fb0d8', { alpha: 0.75, rough: 0.05, emissive: '#0c3040' }), rim = mat(doc, 'rim', '#e9e5da'); const W = G(), T = G(), R = G();
    cyl(W, 0, 0, 0, 1.0, 1.0, 0.85, 8, 'y', false); cyl(R, 0, 0.85, 0, 1.0, 1.0, 0.05, 8, 'y', false); cyl(R, 0, 0.0, 0, 0.9, 0.9, 0.9, 8, 'y', false); cyl(T, 0, 0.78, 0, 0.9, 0.9, 0.01, 8); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; box(R, Math.cos(a + Math.PI / 8) * 0.95, 0.88, Math.sin(a + Math.PI / 8) * 0.95, 0.4, 0.02, 0.1); } for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + Math.PI / 8; box(W, Math.cos(a) * 1.05, 0, Math.sin(a) * 1.05, 0.1, 0.4, 0.1); }
    return meshNode(doc, 'hot_tub', [[W, w], [R, rim], [T, wt]]); },
  async grill(doc) { const b = mat(doc, 'grillBody', '#1d1d1d', { rough: 0.4, metal: 0.3 }), m = mat(doc, 'steel', '#9aa0a6', { metal: 0.7, rough: 0.35 }), coal = mat(doc, 'coal', '#ff7a2e', { emissive: '#aa3300' }); const B = G(), M = G(), C = G();
    sphere(B, 0, 0.8, 0, 0.3, 0.22, 0.3, 14, 7); for (const a of [0.5, 2.6, 4.7]) box(M, Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2, 0.03, 0.8, 0.03); cyl(C, 0, 0.8, 0, 0.26, 0.26, 0.02, 14); box(M, 0, 0.9, 0.34, 0.3, 0.03, 0.08);
    return meshNode(doc, 'grill', [[B, b], [M, m], [C, coal]]); },
  async dishwasher(doc) { const s = mat(doc, 'steel', '#c8ccd0', { metal: 0.6, rough: 0.3 }), top = mat(doc, 'counterTop', '#e6e2da'), dk = mat(doc, 'panel', '#2a2d31'); const S = G(), T = G(), D = G();
    box(S, 0, 0, 0, 0.88, 0.88, 0.9); box(T, 0, 0.88, 0, 0.92, 0.04, 0.94); box(D, 0, 0.74, 0.455, 0.8, 0.1, 0.01); box(D, 0, 0.62, 0.47, 0.5, 0.03, 0.03); return meshNode(doc, 'dishwasher', [[S, s], [T, top], [D, dk]]); },
  async toy_box(doc) { const w = mat(doc, 'toyWood', '#d9a34a'), r = mat(doc, 'toyRed', '#d64040'), b = mat(doc, 'toyBlue', '#3f6fd6'), y = mat(doc, 'toyYellow', '#f2c830'); const W = G(), R = G(), B = G(), Y = G();
    box(W, 0, 0, 0, 0.8, 0.45, 0.5); box(R, 0, 0.45, -0.24, 0.8, 0.35, 0.03); box(B, -0.22, 0.45, 0.02, 0.14, 0.14, 0.14); sphere(Y, 0.1, 0.52, 0.0, 0.08); box(R, 0.28, 0.45, 0.05, 0.1, 0.1, 0.1); cyl(B, 0.28, 0.55, 0.05, 0.03, 0.03, 0.12, 6);
    return meshNode(doc, 'toy_box', [[W, w], [R, r], [B, b], [Y, y]]); },
  async dollhouse_table(doc) { const w = mat(doc, 'wood', '#e8dcc6'); const T = G(); box(T, 0, 0.4, 0, 0.9, 0.05, 0.7); for (const x of [-0.4, 0.4]) for (const z of [-0.3, 0.3]) box(T, x, 0, z, 0.05, 0.4, 0.05); return meshNode(doc, 'dollhouse_table', [[T, w]]); },
  async pedestal(doc) { const m = mat(doc, 'marble', '#e8e6e1', { rough: 0.35 }); const P = G(); box(P, 0, 0, 0, 0.5, 0.08, 0.5); box(P, 0, 0.08, 0, 0.4, 0.8, 0.4); box(P, 0, 0.88, 0, 0.5, 0.06, 0.5); return meshNode(doc, 'pedestal', [[P, m]]); },
  async sculpture_abstract(doc) { const m = mat(doc, 'marble', '#e8e6e1', { rough: 0.35 }), b = mat(doc, 'bronze', '#9c6b30', { metal: 0.7, rough: 0.35 }); const P = G(), B = G();
    box(P, 0, 0, 0, 0.5, 0.8, 0.5); sphere(B, 0, 1.05, 0, 0.18); cyl(B, 0, 0.8, 0, 0.04, 0.04, 0.3, 8); sphere(B, 0.12, 1.3, 0.05, 0.1); sphere(B, -0.1, 1.42, -0.04, 0.07); return meshNode(doc, 'sculpture_abstract', [[P, m], [B, b]]); },
  async grandfather_clock(doc) { const w = mat(doc, 'wood', '#5a3620'), f = mat(doc, 'dial', '#f3ecd8'), br = mat(doc, 'brass', '#c9a14a', { metal: 0.6, rough: 0.35 }), gl = mat(doc, 'glass', '#cfe6ee', { alpha: 0.3 }); const W = G(), F = G(), B = G(), Gl = G();
    box(W, 0, 0, 0, 0.5, 0.25, 0.35); box(W, 0, 0.25, 0, 0.4, 1.3, 0.3); box(W, 0, 1.55, 0, 0.5, 0.45, 0.35); box(W, 0, 2.0, 0, 0.55, 0.08, 0.38); cyl(F, 0, 1.78, 0.17, 0.16, 0.16, 0.01, 18, 'z');
    box(B, 0, 1.78, 0.185, 0.01, 0.12, 0.005); box(B, 0.04, 1.8, 0.185, 0.08, 0.01, 0.005); cyl(B, 0, 0.6, 0.12, 0.07, 0.07, 0.01, 12, 'z'); box(B, 0, 0.67, 0.12, 0.01, 0.6, 0.01); box(Gl, 0, 0.35, 0.155, 0.3, 1.0, 0.005);
    return meshNode(doc, 'grandfather_clock', [[W, w], [F, f], [B, br], [Gl, gl]]); },
  async wall_clock(doc) { const r = mat(doc, 'rim', '#2a2a2a'), f = mat(doc, 'dial', '#f7f4ea'), h = mat(doc, 'hands', '#111'); const R = G(), F = G(), H = G();
    cyl(R, 0, 0.18, 0, 0.18, 0.18, 0.04, 24, 'z'); cyl(F, 0, 0.18, 0.04, 0.16, 0.16, 0.003, 24, 'z'); box(H, 0, 0.18, 0.045, 0.012, 0.11, 0.004); box(H, 0.04, 0.18, 0.045, 0.09, 0.012, 0.004);
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; box(H, Math.cos(a) * 0.14, 0.18 + Math.sin(a) * 0.14 - 0.008, 0.045, 0.012, 0.016, 0.004); }
    return meshNode(doc, 'wall_clock', [[R, r], [F, f], [H, h]]); },
  async flower_vase(doc) { const v = mat(doc, 'vase', '#3f6fb0', { rough: 0.25 }), st = mat(doc, 'stem', '#3f8f3f'), fl = [mat(doc, 'petalRed', '#e0455a'), mat(doc, 'petalYellow', '#f2c230'), mat(doc, 'petalWhite', '#f4f1ea')]; const V = G(), S = G(), F = [G(), G(), G()];
    cyl(V, 0, 0, 0, 0.06, 0.09, 0.12, 14); cyl(V, 0, 0.12, 0, 0.09, 0.04, 0.12, 14); for (let i = 0; i < 7; i++) { const a = i * 0.9, x = Math.cos(a) * 0.05, z = Math.sin(a) * 0.05; cyl(S, x * 0.3, 0.2, z * 0.3, 0.006, 0.006, 0.18 + (i % 3) * 0.04, 4); sphere(F[i % 3], x, 0.4 + (i % 3) * 0.04, z, 0.035, 0.03, 0.035, 8, 5); }
    return meshNode(doc, 'flower_vase', [[V, v], [S, st], ...F.map((g, i) => [g, fl[i]])]); },
  async pool(doc) { const rim = mat(doc, 'poolRim', '#e8e3d6'), wt = mat(doc, 'water', '#3fb6e0', { alpha: 0.8, rough: 0.05, emissive: '#0a3a4a' }), tile = mat(doc, 'poolTile', '#7fcfe8'); const R = G(), W = G(), T = G(); const w = 3, d = 5, t = 0.25;
    box(R, 0, 0, -d / 2 + t / 2, w, 0.06, t); box(R, 0, 0, d / 2 - t / 2, w, 0.06, t); box(R, -w / 2 + t / 2, 0, 0, t, 0.06, d); box(R, w / 2 - t / 2, 0, 0, t, 0.06, d); box(T, 0, 0, 0, w - 2 * t, 0.01, d - 2 * t); box(W, 0, 0.02, 0, w - 2 * t, 0.01, d - 2 * t);
    for (const x of [-0.1, 0.1]) { box(R, x + w / 2 - 0.6, 0.06, d / 2 - 0.2, 0.03, 0.9, 0.03); } return meshNode(doc, 'pool', [[R, rim], [T, tile], [W, wt]]); },
  async cafe_table(doc) { const top = mat(doc, 'tableTop', '#f2efe8', { rough: 0.3 }), m = mat(doc, 'metal', '#2b2b2b', { metal: 0.5, rough: 0.4 }), ch = mat(doc, 'chairSeat', '#b0413e'); const T = G(), M = G(), C = G();
    cyl(T, 0, 0.72, 0, 0.35, 0.35, 0.03, 18); cyl(M, 0, 0.02, 0, 0.03, 0.03, 0.7, 8); cyl(M, 0, 0, 0, 0.22, 0.2, 0.02, 12);
    for (const sx of [-1, 1]) { box(C, sx * 0.62, 0.44, 0, 0.36, 0.04, 0.36); box(C, sx * 0.79, 0.48, 0, 0.03, 0.4, 0.34); for (const dx of [-0.15, 0.15]) for (const dz of [-0.15, 0.15]) cyl(M, sx * 0.62 + dx, 0, dz, 0.012, 0.012, 0.44, 5); }
    return meshNode(doc, 'cafe_table', [[T, top], [M, m], [C, ch]]); },
  async gym_machine(doc) { const f = mat(doc, 'frame', '#3a3d42', { metal: 0.4, rough: 0.4 }), pad = mat(doc, 'pad', '#b0302a', { rough: 0.6 }), w = mat(doc, 'weights', '#111'); const F = G(), P = G(), W = G();
    box(F, 0, 0, 0, 1.0, 0.06, 1.3); for (const x of [-0.4, 0.4]) box(F, x, 0, -0.5, 0.06, 2.0, 0.06); box(F, 0, 1.97, -0.5, 0.86, 0.06, 0.06); box(W, 0, 0.06, -0.5, 0.3, 0.6, 0.2);
    box(P, 0, 0.45, 0.15, 0.4, 0.08, 0.4); box(P, 0, 0.5, -0.15, 0.4, 0.6, 0.08); box(F, 0, 1.2, -0.2, 0.9, 0.04, 0.04); return meshNode(doc, 'gym_machine', [[F, f], [P, pad], [W, w]]); },
  async museum_exhibit(doc) { const m = mat(doc, 'plinth', '#2a2a2e'), gl = mat(doc, 'glass', '#d6eef5', { alpha: 0.25, rough: 0.05 }), gold = mat(doc, 'gold', '#d4a83a', { metal: 0.8, rough: 0.25 }), cl = mat(doc, 'cloth', '#7a1f2b'); const M = G(), Gl = G(), A = G(), C = G();
    box(M, 0, 0, 0, 0.7, 0.9, 0.7); box(C, 0, 0.9, 0, 0.6, 0.02, 0.6); box(Gl, 0, 0.92, 0, 0.66, 0.6, 0.66); cyl(A, 0, 0.92, 0, 0.1, 0.13, 0.08, 14); cyl(A, 0, 1.0, 0, 0.13, 0.06, 0.2, 14); sphere(A, 0, 1.25, 0, 0.07);
    return meshNode(doc, 'museum_exhibit', [[M, m], [C, cl], [A, gold], [Gl, gl]]); },
  async swing_set(doc) { const f = mat(doc, 'frame', '#d64040', { metal: 0.3, rough: 0.5 }), s = mat(doc, 'seat', '#2f5fa6'), ch = mat(doc, 'chain', '#9aa0a6', { metal: 0.7 }); const F = G(), S = G(), C = G();
    for (const x of [-1.2, 1.2]) for (const z of [-0.6, 0.6]) { for (let i = 0; i < 8; i++) { const t = (i + 0.5) / 8; box(F, x, 2.1 * t - 0.14, z * (1 - t), 0.06, 0.28, 0.06); } } box(F, 0, 2.05, 0, 2.5, 0.07, 0.07);
    for (const x of [-0.55, 0.55]) { box(S, x, 0.45, 0, 0.45, 0.04, 0.2); for (const dx of [-0.2, 0.2]) box(C, x + dx, 0.49, 0, 0.012, 1.56, 0.012); } return meshNode(doc, 'swing_set', [[F, f], [S, s], [C, ch]]); },
  async sandbox(doc) { const w = mat(doc, 'wood', '#c8914a'), s = mat(doc, 'sand', '#e3cf8a', { rough: 1 }), t = mat(doc, 'toy', '#e04040'); const W = G(), S = G(), T = G();
    for (const [x, z, ww, dd] of [[0, -0.9, 1.9, 0.12], [0, 0.9, 1.9, 0.12], [-0.9, 0, 0.12, 1.9], [0.9, 0, 0.12, 1.9]]) box(W, x, 0, z, ww, 0.25, dd); box(S, 0, 0, 0, 1.7, 0.18, 1.7); sphere(S, -0.3, 0.18, 0.2, 0.25, 0.1, 0.2, 10, 5); cyl(T, 0.4, 0.18, -0.3, 0.08, 0.1, 0.12, 10); box(T, 0.2, 0.18, 0.4, 0.04, 0.02, 0.2);
    return meshNode(doc, 'sandbox', [[W, w], [S, s], [T, t]]); },
  async street_bin(doc) { const g = mat(doc, 'binGreen', '#2f5f3a', { metal: 0.3, rough: 0.5 }), dk = mat(doc, 'lid', '#1d1d1d'); const B = G(), L = G(); cyl(B, 0, 0.05, 0, 0.26, 0.28, 0.85, 14); cyl(L, 0, 0.9, 0, 0.3, 0.2, 0.08, 14); box(L, 0, 0, 0, 0.1, 0.05, 0.1); return meshNode(doc, 'street_bin', [[B, g], [L, dk]]); },
  async bed_soil(doc) { const s = mat(doc, 'soil', '#5a3f2a', { rough: 1 }), b = mat(doc, 'border', '#8d8a84'); const S = G(), B = G(); box(S, 0, 0, 0, 0.94, 0.1, 0.94); for (const [x, z, w, d] of [[0, -0.47, 0.98, 0.06], [0, 0.47, 0.98, 0.06], [-0.47, 0, 0.06, 0.98], [0.47, 0, 0.06, 0.98]]) box(B, x, 0, z, w, 0.14, d); return meshNode(doc, 'bed_soil', [[S, s], [B, b]]); },
  async mailbox_modern(doc) { const p = mat(doc, 'post', '#3a3a3a'), bx = mat(doc, 'box', '#2f5fa6', { metal: 0.3, rough: 0.4 }), f = mat(doc, 'flag', '#d64040'); const P = G(), B = G(), F = G(); box(P, 0, 0, 0, 0.08, 1.0, 0.08); box(B, 0, 1.0, 0.05, 0.25, 0.25, 0.45); sphere(B, 0, 1.25, 0.05, 0.125, 0.08, 0.225, 10, 4, true); box(F, 0.14, 1.1, -0.05, 0.02, 0.25, 0.04); box(F, 0.14, 1.3, -0.02, 0.02, 0.06, 0.12);
    return meshNode(doc, 'mailbox_modern', [[P, p], [B, bx], [F, f]]); },
  async hydrant(doc) { const r = mat(doc, 'hydrant', '#c0392b', { rough: 0.4 }), d = mat(doc, 'cap', '#d9d9d9', { metal: 0.5 }); const R = G(), D = G(); cyl(R, 0, 0, 0, 0.14, 0.14, 0.06, 12); cyl(R, 0, 0.06, 0, 0.11, 0.11, 0.5, 12); sphere(R, 0, 0.56, 0, 0.11, 0.08, 0.11, 12, 5, true); cyl(D, 0, 0.62, 0, 0.03, 0.03, 0.06, 8); cyl(D, -0.2, 0.36, 0, 0.05, 0.05, 0.4, 8, 'x');
    return meshNode(doc, 'hydrant', [[R, r], [D, d]]); },
};
function hedgeBox(doc, h, len = 1) { const g = mat(doc, 'leaves', '#4f8a3a', { rough: 0.95 }), d = mat(doc, 'leavesDark', '#3d7430', { rough: 0.95 }); const A = G(), B = G(); const L = 0.96 * len + (len - 1) * 0.04;
  box(A, 0, 0, 0, 0.6, h - 0.05, L); let sd = 3; const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 26 * len; i++) sphere(i % 2 ? A : B, (r() < 0.5 ? -1 : 1) * 0.26, 0.15 + r() * (h - 0.25), (r() - 0.5) * (L - 0.15), 0.08, 0.11, 0.11, 7, 5);
  for (let i = 0; i < 8 * len; i++) sphere(B, (r() - 0.5) * 0.4, h - 0.08, (r() - 0.5) * (L - 0.15), 0.13, 0.08, 0.13, 7, 5);
  return meshNode(doc, 'hedge', [[A, g], [B, d]]); }
function topiary(doc) { const g = mat(doc, 'leaves', '#4f8a3a', { rough: 0.95 }), p = mat(doc, 'pot', '#a0522d'), t = mat(doc, 'trunk', '#6b4a2b'); const A = G(), P = G(), T = G();
  cyl(P, 0, 0, 0, 0.2, 0.26, 0.35, 12); cyl(T, 0, 0.35, 0, 0.03, 0.03, 0.6, 6); sphere(A, 0, 1.15, 0, 0.3, 0.3, 0.3, 14, 10); sphere(A, 0, 0.62, 0, 0.18, 0.16, 0.18, 12, 8);
  return meshNode(doc, 'topiary', [[A, g], [P, p], [T, t]]); }
async function paintingNode(doc, kind, wide, poster) { const frame = mat(doc, 'frame', '#6a4a2a'), canvas = mat(doc, 'canvas', '#ffffff', { rough: 0.9 }); canvas.setBaseColorTexture(doc.createTexture('p_' + kind).setImage(await paintingTex(kind)).setMimeType('image/jpeg'));
  if (wide === 'carpet') { const C = G(); const W = 1.6, H = 1.2; quad(C, [[-W / 2, 0, 0.012], [W / 2, 0, 0.012], [W / 2, H, 0.012], [-W / 2, H, 0.012]], [0, 0, 1]); const B = G(); box(B, 0, 0, 0.005, W, H, 0.01); return meshNode(doc, 'wall_carpet', [[B, frame], [C, canvas]]); }
  if (poster) { const C = G(); const W = 0.6, H = 0.8; quad(C, [[-W / 2, 0, 0.004], [W / 2, 0, 0.004], [W / 2, H, 0.004], [-W / 2, H, 0.004]], [0, 0, 1]); const B = G(); box(B, 0, 0, 0.001, W, H, 0.003); return meshNode(doc, 'poster', [[B, frame], [C, canvas]]); }
  const W = wide ? 1.4 : 0.9, H = wide ? 0.6 : 0.7, D = 0.04, t = 0.06; const F = G(), C = G(); box(F, 0, 0, D / 2, W, t, D); box(F, 0, H - t, D / 2, W, t, D); box(F, -W / 2 + t / 2, t, D / 2, t, H - 2 * t, D); box(F, W / 2 - t / 2, t, D / 2, t, H - 2 * t, D); box(F, 0, t, 0.005, W - 2 * t, H - 2 * t, 0.01);
  quad(C, [[-W / 2 + t, t, D * 0.6], [W / 2 - t, t, D * 0.6], [W / 2 - t, H - t, D * 0.6], [-W / 2 + t, H - t, D * 0.6]], [0, 0, 1]); return meshNode(doc, 'painting', [[F, frame], [C, canvas]]); }

// ======================= сборка =======================
async function loadSrc(doc, src) {
  if (src.startsWith('proc:')) { const [, n, arg] = src.split(':'); if (n === 'painting' || n === 'painting_wide') return [await paintingNode(doc, arg, n === 'painting_wide')]; if (n === 'hedge_box') return [hedgeBox(doc, +arg, +(src.split(':')[3] || 1))]; if (n === 'topiary') return [topiary(doc)]; if (n === 'poster') return [await paintingNode(doc, arg, false, true)]; if (n === 'wallcarpet') return [await paintingNode(doc, arg, 'carpet')]; return [await PR[n](doc)]; }
  const [kit, name] = src.split(':'); const file = kit === 'kk' ? `${KIT[kit]}/${name}.gltf` : `${KIT[kit]}/${name}.glb`;
  const sd = await io.read(file); const map = mergeDocuments(doc, sd);
  const roots = sd.getRoot().listScenes()[0].listChildren().map(n => map.get(n));
  for (const s of doc.getRoot().listScenes().slice(1)) s.dispose();
  return roots;
}
const results = [];
for (const e of L) {
  if (ONLY && !ONLY.includes(e.key)) continue;
  const doc = new Document(); doc.createBuffer(); const scene = doc.createScene(e.key);
  const rot = doc.createNode('rot'); const outer = doc.createNode(e.key).addChild(rot); scene.addChild(outer);
  const parts = Array.isArray(e.src) ? e.src : [P(e.src)];
  let kitKey = null;
  for (const p of parts) {
    const g = doc.createNode('part').setTranslation(p.at).setScale([p.s, p.s, p.s]); if (p.ry) g.setRotation([0, Math.sin(p.ry * Math.PI / 360), 0, Math.cos(p.ry * Math.PI / 360)]);
    for (const n of await loadSrc(doc, p.src)) g.addChild(n); rot.addChild(g); if (!kitKey && !p.src.startsWith('proc:')) kitKey = p.src.split(':')[0];
  }
  if (e.ry) rot.setRotation([0, Math.sin(e.ry * Math.PI / 360), 0, Math.cos(e.ry * Math.PI / 360)]);
  const b = getBounds(scene); const size = b.max.map((v, i) => v - b.min[i]);
  const firstKit = parts[0].src.split(':')[0];
  let s = e.sc ?? (firstKit === 'k' ? K : 1);
  if (e.h) s = e.h / size[1]; if (e.len) s = e.len / Math.max(size[0], size[2]);
  let sv = e.flat ? [s, 1, s] : [s, s, s];
  if (e.fitWH) { const sw = e.fitWH[0] / size[0], sh = e.fitWH[1] / size[1]; sv = [sw, sh, (sw + sh) / 2]; }
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  let tz = -cz * sv[2]; if (e.wall === 'back') tz = -b.min[2] * sv[2];
  outer.setScale(sv).setTranslation([-cx * sv[0], -b.min[1] * sv[1], tz]);
  for (const m of doc.getRoot().listMaterials()) { m.setExtension('KHR_materials_unlit', null); if (!m.getBaseColorTexture() && m.getMetallicFactor() === 0 && m.getRoughnessFactor() === 1) m.setRoughnessFactor(/glass/i.test(m.getName()) ? 0.2 : 0.75); }
  for (const x of doc.getRoot().listExtensionsUsed()) if (x.extensionName === 'KHR_materials_unlit') x.dispose();
  const b0 = doc.getRoot().listBuffers()[0]; for (const a of doc.getRoot().listAccessors()) a.setBuffer(b0); doc.getRoot().listBuffers().slice(1).forEach(x => x.dispose());
  await doc.transform(prune(), dedup());
  const fb = getBounds(scene); const file = `${OUT}/${e.key}.glb`; await io.write(file, doc);
  let tris = 0; scene.traverse(n => { const m = n.getMesh(); if (m) for (const p of m.listPrimitives()) { const i = p.getIndices(); tris += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; } });
  const mats = [...new Set(doc.getRoot().listMaterials().map(m => m.getName()))];
  const kits = [...new Set(parts.map(p => p.src.split(':')[0]))];
  results.push({ key: e.key, group: e.group, kinds: e.kinds, size: fb.max.map((v, i) => +(v - fb.min[i]).toFixed(3)), tris, bytes: fs.statSync(file).size, mats,
    wall: e.wall || null, yOffset: e.yOffset ?? 0, surface: !!e.surface, ceiling: !!e.ceiling,
    src: parts.map(p => p.src).join(' + '), source: kits.map(k => k === 'proc' ? 'процедурная (build-lib.mjs)' : KITNAME[k]).join(' + ') });
}
const prev = fs.existsSync(`${OUT}/_lib.json`) ? JSON.parse(fs.readFileSync(`${OUT}/_lib.json`)) : [];
const merged = Object.values(Object.fromEntries([...prev, ...results].map(r => [r.key, r])));
fs.writeFileSync(`${OUT}/_lib.json`, JSON.stringify(merged, null, 1));
console.log('built', results.length, 'total', merged.length, 'MB', (results.reduce((s, r) => s + r.bytes, 0) / 1048576).toFixed(2));
