// Сборка всех данных. Движок получает CONTENT целиком и не импортирует файлы контента напрямую.
'use strict';
L.def('content/index', () => {
const { CALENDAR } = L.use('content/calendar');
const { ROUTE } = L.use('content/route');
const { GOODS } = L.use('content/goods');
const { PEOPLE } = L.use('content/people');
const { ROLES } = L.use('content/roles');
const { RUMOURS } = L.use('content/rumours');
const { EVENTS } = L.use('content/events');
const { ACTIONS } = L.use('content/actions');
const { PHONE } = L.use('content/phone');
const { NAMES, CARS } = L.use('content/names');
const { TUNING } = L.use('content/tuning');
const { VOICES } = L.use('content/voices');

const CONTENT = { CALENDAR, ROUTE, GOODS, PEOPLE, ROLES, RUMOURS, EVENTS, ACTIONS, PHONE, NAMES, CARS, TUNING, VOICES };
return { CONTENT };
});
