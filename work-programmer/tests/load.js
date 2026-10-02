// Загрузка частей игры в Node: реестр, список из manifest.js, всё кроме интерфейса и поля.
'use strict';
const path = require('path');
const root = path.join(__dirname, '..');
require(path.join(root, 'js/l.js'));
require(path.join(root, 'js/manifest.js'));
for (const f of globalThis.UPTIME_FILES) if (/js\/(core|sim|content)/.test(f)) require(path.join(root, f));
L.use('sim/run'); L.use('content/levels');
module.exports = globalThis.U;
