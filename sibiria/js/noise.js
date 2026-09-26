'use strict';
// Шум simplex 2D (минимальная встроенная реализация по мотивам jwagner/simplex-noise, MIT; без CDN).
// Детерминирован: таблица перестановок перемешивается переданным PRNG (mulberry(seed)).
//   const N = Noise.make(mulberry(seed)); N.n2(x, y) → −1..1;  N.fbm(x, y, oct) → −1..1 (октавы ×2, вес ×0.5)
const Noise = (() => {
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  const GR = [1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0, -1];
  function make(rand) {
    const p = new Uint8Array(256); for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = (rand() * (i + 1)) | 0, t = p[i]; p[i] = p[j]; p[j] = t; }
    const perm = new Uint8Array(512), pm12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = (perm[i] % 12) * 2; }
    function n2(x, y) {
      const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s), t = (i + j) * G2;
      const x0 = x - (i - t), y0 = y - (j - t), i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
      const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
      const ii = i & 255, jj = j & 255;
      let n = 0, tt = 0.5 - x0 * x0 - y0 * y0;
      if (tt > 0) { const g = pm12[ii + perm[jj]]; tt *= tt; n += tt * tt * (GR[g] * x0 + GR[g + 1] * y0); }
      tt = 0.5 - x1 * x1 - y1 * y1;
      if (tt > 0) { const g = pm12[ii + i1 + perm[jj + j1]]; tt *= tt; n += tt * tt * (GR[g] * x1 + GR[g + 1] * y1); }
      tt = 0.5 - x2 * x2 - y2 * y2;
      if (tt > 0) { const g = pm12[ii + 1 + perm[jj + 1]]; tt *= tt; n += tt * tt * (GR[g] * x2 + GR[g + 1] * y2); }
      return 70 * n;
    }
    function fbm(x, y, oct = 3) { let a = 1, f = 1, s = 0, w = 0; for (let o = 0; o < oct; o++) { s += a * n2(x * f, y * f); w += a; a *= 0.5; f *= 2; } return s / w; }
    return { n2, fbm };
  }
  return { make };
})();
