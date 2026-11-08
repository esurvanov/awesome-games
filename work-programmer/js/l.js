// Реестр частей игры вместо ES-модулей: браузер не грузит type="module" с file://, а игра должна
// открываться двойным щелчком по index.html. Каждая часть — L.def('путь', () => { …; return {экспорт}; }),
// зависимости — const { a, b } = L.use('путь'). Тело части выполняется при первом L.use, поэтому
// порядок <script> в index.html важен только для l.js (первым) и запуска main (последним).
'use strict';
(() => {
  const defs = {}, mods = {};
  const L = globalThis.L = {
    def(id, f) { defs[id] = f; },
    use(id) {
      if (mods[id] === null) throw new Error(`L: цикл через «${id}»`);
      if (id in mods) return mods[id];
      if (!defs[id]) throw new Error(`L: нет части «${id}»`);
      mods[id] = null; // метка «выполняется»: повторный вход = цикл
      return (mods[id] = defs[id]());
    },
  };
})();
