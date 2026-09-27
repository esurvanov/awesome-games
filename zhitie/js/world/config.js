// Константы Мира.

import { WORLD } from '../core/tuning.js';

// Числа баланса живут в js/core/tuning.js (раздел WORLD) — здесь только переименование для модулей Мира.
export const PATH_NODE_LIMIT = WORLD.pathNodeLimit;   // лимит раскрытий A*
export const DIAG = WORLD.diag;                       // цена диагонального шага
export const DEPRECIATION = WORLD.depreciation;       // продажа не в день покупки → price·(1−k)
export const DAY_MIN = WORLD.dayMinutes;
export const ROOM = WORLD.room;                       // оценка комнаты, research §2.10
export const BARE_WALL_TYPE = WORLD.bareWallType;     // «Штукатурка белая» считается голой стеной

// Наборы ВИДОВ (kindOf(def)), волна 3: поведение ищется по виду, а не по id
import { kindOf } from '../../data/catalog.js';
export { kindOf };
// Виды, на которые можно ставить place:'surface' (телефон, кофеварка…)
export const SURFACE_HOSTS = new Set(['counter', 'dining_table', 'coffee_table', 'dresser', 'computer_desk', 'bookshelf', 'cafe_table', 'food_stall', 'wardrobe']);
// Сиденья (для «сесть к столу/перед ТВ»)
export const SEATS = new Set(['dining_chair', 'armchair', 'sofa', 'park_bench']);
export const isHost = defId => SURFACE_HOSTS.has(kindOf(defId));
export const isSeat = defId => SEATS.has(kindOf(defId));
// окно-подобные: занимают ребро целиком, светят в обе стороны
export const isWindow = defId => kindOf(defId) === 'window';

// Волна 2. Числа — из tuning.js WORLD, если оркестратор их туда перенёс; иначе значения по умолчанию (см. отчёт «Просьбы»).
export const SUPPORT_PERP = WORLD.supportPerp ?? 2;  // стена снизу держит пол этажа выше на 2 клетки поперёк
export const SUPPORT_PAR = WORLD.supportPar ?? 1;    // и на 1 клетку за концы вдоль
export const ROOF_DEFAULT = WORLD.roof ?? { style: 'gable', color: '#8a4b3a', pitch: 0.5 };
export const ROOF_STYLES = ['gable', 'hip', 'flat'];
export const LAND_PER_TILE = WORLD.landPerTile ?? 5;  // цена земли за клетку участка
