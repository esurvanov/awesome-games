'use strict';
// Ядро: общее пространство имён U, куда части складывают свой экспорт, и генератор случайных чисел с сидом.
// U видно и как globalThis.U — для тестов и консоли.
L.def('core', () => {
  const U = globalThis.U = {};
  U.rng = function (seed) {
    let a = seed >>> 0;
    return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };
  return U;
});
