// Фото-текстуры (CC0, см. CREDITS.md): микрорельеф снега и зерно хвои. Только QUALITY high. Обязательный фолбэк: пока файл
// не загрузился, при ошибке загрузки или QUALITY !== 'high' pattern() возвращает null и игра рисует по-старому.
// Картинки берутся из assets/photo/photo-data.js (data:-URI тех же .webp): так canvas не становится «tainted» при запуске
// с file:// (toDataURL/getImageData продолжают работать). Бандл грузится лениво — при первом запросе в high; в low не грузится вовсе.
const Photo = (() => {
  const DATA = 'assets/photo/photo-data.js?v=1.2.0';
  // тёмные вкрапления снега — в холодный синий, не в серый: синий канал не опускается ниже порога ('lighten' по каналам),
  // зелёный — чуть. Светлое и нейтральное (128) не меняется. Без чтения пикселей
  const TINT = { snow: 'rgb(0,64,112)' };
  const img = {}, pat = {}, subs = [];
  let ver = 0, asked = false;
  const scratch = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  // снег: оставить только мелкое зерно наста. Полоса «σ≈0.8 минус σ≈2.8» (разность двух размытий) — крупные тёмные дуги
  // (края следов/надувов на фото) уходят, после тонировки они читались синими прожилками-«трещинами»; мягкий потолок
  // tanh — одиночные тёмные крапины не выбиваются. Циклическое размытие — тайл остаётся бесшовным. Один раз при загрузке.
  function box(src, dst, W, H, r) { // разделимое окно (2r+1) с заворотом по краям
    const tmp = new Float32Array(W * H), n = 2 * r + 1;
    for (let y = 0; y < H; y++) {
      const o = y * W; let s = 0; for (let i = -r; i <= r; i++) s += src[o + ((i + W) % W)];
      for (let x = 0; x < W; x++) { tmp[o + x] = s / n; s += src[o + (x + r + 1) % W] - src[o + (x - r + W) % W]; }
    }
    for (let x = 0; x < W; x++) {
      let s = 0; for (let i = -r; i <= r; i++) s += tmp[((i + H) % H) * W + x];
      for (let y = 0; y < H; y++) { dst[y * W + x] = s / n; s += tmp[((y + r + 1) % H) * W + x] - tmp[((y - r + H) % H) * W + x]; }
    }
  }
  function fineGrain(g, W, H) {
    const im = g.getImageData(0, 0, W, H), d = im.data, N = W * H, L = new Float32Array(N), A = new Float32Array(N), B = new Float32Array(N);
    for (let i = 0; i < N; i++) L[i] = d[i * 4];
    box(L, A, W, H, 1); box(L, B, W, H, 3); box(B, B, W, H, 3);
    const D = 18;
    for (let i = 0; i < N; i++) { const v = 128 + D * Math.tanh((A[i] - B[i]) * 1.4 / D), o = i * 4; d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255; }
    g.putImageData(im, 0, 0);
  }
  function prep(k, im) {
    if (!TINT[k]) return im;
    try {
      const c = document.createElement('canvas'); c.width = im.naturalWidth || im.width; c.height = im.naturalHeight || im.height;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      if (k === 'snow') { try { fineGrain(g, c.width, c.height); } catch (e) { /* нет доступа к пикселям — фото как есть */ } }
      g.globalCompositeOperation = 'lighten'; g.fillStyle = TINT[k]; g.fillRect(0, 0, c.width, c.height);
      return c;
    } catch (e) { return im; }
  }
  function decode() {
    const D = window.PHOTO_DATA; if (!D) return;
    // подписчики (перепечка кусков и спрайтов) — один раз, когда разобраны все картинки
    let left = Object.keys(D).length;
    const done = () => { if (--left > 0 || !ver) return; for (const f of subs) { try { f(); } catch (e) { /* фолбэк */ } } };
    for (const k in D) {
      try {
        const im = new Image();
        im.onload = () => { img[k] = prep(k, im); ver++; done(); };
        im.onerror = () => { img[k] = null; done(); };
        im.src = D[k];
      } catch (e) { done(); }
    }
  }
  function load() {
    if (asked || typeof document === 'undefined') return; asked = true;
    if (window.PHOTO_DATA) { decode(); return; }
    try {
      const s = document.createElement('script'); s.src = DATA; s.async = true;
      s.onload = decode; s.onerror = () => { /* нет бандла — остаёмся процедурными */ };
      document.head.appendChild(s);
    } catch (e) { /* фолбэк */ }
  }
  // CanvasPattern (repeat) с масштабом sc и поворотом rot в мировых координатах; null — рисовать по-старому
  function pattern(kind, sc = 1, rot = 0) {
    if (window.QUALITY !== 'high' || !scratch) return null;
    if (!img[kind]) { load(); return null; }
    const key = kind + sc + '_' + rot;
    if (pat[key]) return pat[key];
    try {
      const p = scratch.createPattern(img[kind], 'repeat');
      if (!p) return null;
      if (p.setTransform && typeof DOMMatrix !== 'undefined') p.setTransform(new DOMMatrix().rotate(rot * 180 / Math.PI).scale(sc));
      return (pat[key] = p);
    } catch (e) { return null; }
  }
  return { pattern, onLoad(f) { subs.push(f); }, get ready() { return !!img.snow; }, get version() { return ver; } };
})();
