// Автокрыша TS1 (вид — у Картинки): крыша над закрытыми комнатами верхнего занятого этажа.
// Клетка получает крышу на этаже L = наивысший этаж, где она в закрытой комнате, если выше нет пола (балкон).
import { roomAt } from './rooms.js';
import { ROOF_DEFAULT, ROOF_STYLES } from './config.js';

export const roofOf = state => state.lot.roof || { ...ROOF_DEFAULT };

/**
 * → { style, color, pitch, levels: [{ level, rects: [{x, y, w, h}] }] }
 * rects — клетки (x,y — мин. угол, w×h), жадное покрытие прямоугольниками; крыша стоит на высоте (level+1)·3 м.
 */
export function roofFootprints(state) {
  const { lot } = state, { w, h } = lot, nL = lot.levels.length;
  const top = new Int8Array(w * h).fill(-1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    for (let L = nL - 1; L >= 0; L--) {
      if (roomAt(state, x, y, L)) {
        const above = L + 1 < nL && lot.levels[L + 1].floor[y * w + x];
        if (!above) top[y * w + x] = L;
        break;
      }
    }
  }
  const levels = [];
  for (let L = 0; L < nL; L++) {
    const m = top.map(v => (v === L ? 1 : 0)), rects = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      let rw = 0;
      while (x + rw < w && m[y * w + x + rw]) rw++;
      let rh = 1;
      while (y + rh < h && Array.from({ length: rw }, (_, i) => m[(y + rh) * w + x + i]).every(Boolean)) rh++;
      for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) m[yy * w + xx] = 0;
      rects.push({ x, y, w: rw, h: rh });
    }
    if (rects.length) levels.push({ level: L, rects });
  }
  return { ...roofOf(state), levels };
}

/** Сменить стиль/цвет/скат крыши. patch: {style?, color?, pitch?} → roof | null (неверный стиль) */
export function setRoof(state, bus, patch = {}) {
  if (patch.style && !ROOF_STYLES.includes(patch.style)) return null;
  state.lot.roof = { ...roofOf(state), ...patch };
  bus?.emit('lot:changed', { level: 0, kind: 'roof' });
  return state.lot.roof;
}
