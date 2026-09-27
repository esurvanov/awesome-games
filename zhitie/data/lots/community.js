// Общественные участки района. Здание: зал у фасада + задняя полоса (подсобка | санузел).
// kit: [вид, режим?, сколько?] — режимы как у мебели дома (wall / center / scatter / wallItem / surface).
export const COMMUNITY = {
  park: {
    w: 40, h: 30, building: { W: 6, D: 4, hall: 'kiosk', back: null },   // маленький туалет-киоск
    kit: {
      yard: [['fountain', 'center', 1], ['park_bench', 'scatter', 6], ['tree', 'scatter', 12], ['flowerbed', 'scatter', 6],
        ['swing_set', 'scatter', 1], ['sandbox', 'scatter', 1], ['food_stall', 'scatter', 1], ['trash_bin_street', 'scatter', 3],
        ['streetlight', 'scatter', 4], ['chess', 'scatter', 1], ['hedge', 'scatter', 4], ['grill', 'scatter', 1]],
      kiosk: [['toilet', 'wall', 1], ['bath_sink', 'wall', 1]],
    },
  },
  cafe: {
    w: 30, h: 24, building: { W: 16, D: 11, hall: 'cafe', back: 'cafe_kitchen' },
    kit: {
      cafe: [['counter', 'wall', 3], ['cash_register', 'wall', 1], ['coffee_maker', 'surface', 1], ['@tables', 'cafe_table', 4],
        ['plant', 'wall', 2], ['painting', 'wallItem', 2], ['window', 'wallItem', 4], ['stereo', 'wall', 1]],
      cafe_kitchen: [['fridge', 'wall', 1], ['stove', 'wall', 1], ['kitchen_sink', 'wall', 1], ['counter', 'wall', 1], ['trash_can', 'wall', 1]],
      restroom: [['toilet', 'wall', 1], ['bath_sink', 'wall', 1], ['mirror', 'wallItem', 1]],
      yard: [['tree', 'scatter', 4], ['flowerbed', 'scatter', 3], ['park_bench', 'scatter', 2], ['trash_bin_street', 'scatter', 1]],
    },
  },
  shop: {
    w: 30, h: 24, building: { W: 16, D: 11, hall: 'shop', back: 'storeroom' },
    kit: {
      shop: [['cash_register', 'wall', 1], ['shelf_shop', 'wall', 7], ['shelf_shop', 'center', 3], ['plant', 'wall', 1], ['window', 'wallItem', 4]],
      storeroom: [['shelf_shop', 'wall', 3], ['trash_can', 'wall', 1]],
      restroom: [['toilet', 'wall', 1], ['bath_sink', 'wall', 1]],
      yard: [['tree', 'scatter', 3], ['trash_bin_street', 'scatter', 1], ['streetlight', 'scatter', 2]],
    },
  },
  gym: {
    w: 30, h: 26, building: { W: 16, D: 12, hall: 'gym', back: 'showers' },
    kit: {
      gym: [['gym_machine', 'center', 4], ['treadmill', 'wall', 3], ['exercise_bench', 'center', 2], ['stereo', 'wall', 1],
        ['plant', 'wall', 1], ['window', 'wallItem', 4], ['mirror', 'wallItem', 2]],
      showers: [['shower', 'wall', 2], ['bath_sink', 'wall', 1]],
      restroom: [['toilet', 'wall', 1], ['bath_sink', 'wall', 1]],
      yard: [['tree', 'scatter', 3], ['park_bench', 'scatter', 2], ['streetlight', 'scatter', 2]],
    },
  },
  library: {
    w: 34, h: 28, building: { W: 18, D: 13, hall: 'library', back: 'reading' },
    kit: {
      library: [['library_shelf', 'wall', 8], ['museum_exhibit', 'center', 3], ['chess', 'center', 2], ['armchair', 'wall', 2],
        ['painting', 'wallItem', 3], ['window', 'wallItem', 5], ['plant', 'wall', 2], ['sculpture', 'center', 1]],
      reading: [['@desk', 'computer_desk', 2], ['bookshelf', 'wall', 2], ['@tables', 'dining_table', 1]],
      restroom: [['toilet', 'wall', 1], ['bath_sink', 'wall', 1]],
      yard: [['tree', 'scatter', 4], ['flowerbed', 'scatter', 3], ['park_bench', 'scatter', 2], ['telescope', 'scatter', 1]],
    },
  },
};
