/* scan-splat.js — classic helper for splat packs made by tools/scan/splat.mjs (window.ScanSplat).
 *   ScanSplat.load(name, dir, cb, onProgress?)  loads the chunk scripts <dir><name>/<name>.spz.<i>.js (chunk 0 carries the
 *                                               count) → cb(Uint8Array spz) (gzip SPZ v2 bytes)
 *   ScanSplat.shimWorkers(url)                  artifact CSP refuses blob:/data: workers → map them to a same-origin file
 *                                               (Spark: tools/scan/vendor/spark-worker-<v>.js). Call before importing Spark.
 *   ScanSplat.decodeSpz(bytes) → Promise<{ n, centers, scales, quats(x,y,z,w), colors(RGBA u8) }>  (DecompressionStream)
 *   ScanSplat.covariances(d) → Float32Array(n*6) (xx, xy, xz, yy, yz, zz) for three's createGaussianSplatGeometry
 */
(function () {
  const SS = window.ScanSplat = window.ScanSplat || {};
  SS.load = function (name, dir, cb, onProgress, count) {
    const parts = []; let i = 0;
    const next = () => {
      const s = document.createElement('script'); s.src = dir + name + '/' + name + '.spz.' + i + '.js'; s.async = true;
      s.onload = () => {
        const key = name + '#' + i, b64 = (window.__PACK || {})[key]; delete window.__PACK[key];
        const bin = atob(b64), u = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
        if (i === 0 && window.__PACK[name + '#count']) { count = window.__PACK[name + '#count']; delete window.__PACK[name + '#count']; }
        parts.push(u); i++; if (onProgress) onProgress(i, count); if (count && i >= count) done(); else next();
      };
      s.onerror = () => { s.remove(); done(); };
      document.head.appendChild(s);
    };
    const done = () => { const n = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } cb(out); };
    next();
  };
  SS.shimWorkers = function (sameOriginUrl) {
    const W = window.Worker; if (W.__scanShim) return;
    const S = function (url, opts) { const u = String(url); return new W(/^(blob|data):/.test(u) ? sameOriginUrl : url, opts); };
    S.prototype = W.prototype; S.__scanShim = true; window.Worker = S;
  };
  SS.decodeSpz = async function (bytes) {
    const ds = new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')));
    const b = new Uint8Array(await ds.arrayBuffer()), dv = new DataView(b.buffer);
    if (dv.getUint32(0, true) !== 0x5053474e) throw new Error('not SPZ');
    const ver = dv.getUint32(4, true), n = dv.getUint32(8, true), deg = b[12], fb = b[13]; let o = 16;
    const centers = new Float32Array(n * 3), scales = new Float32Array(n * 3), quats = new Float32Array(n * 4), colors = new Uint8Array(n * 4);
    const sc = 1 / (1 << fb);
    for (let i = 0; i < n * 3; i++) { let v = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16); if (v & 0x800000) v |= 0xff000000; centers[i] = v * sc; o += 3; }
    for (let i = 0; i < n; i++) colors[i * 4 + 3] = b[o + i]; o += n;
    const C0 = 0.28209479177387814;
    for (let i = 0; i < n * 3; i++) { const dc = (b[o + i] / 255 - 0.5) / 0.15; colors[(i / 3 | 0) * 4 + i % 3] = Math.max(0, Math.min(255, Math.round((0.5 + C0 * dc) * 255))); } o += n * 3;
    for (let i = 0; i < n * 3; i++) scales[i] = Math.exp(b[o + i] / 16 - 10); o += n * 3;
    for (let i = 0; i < n; i++) {
      if (ver >= 3) {
        let c = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24); o += 4; const iL = c >>> 30, q = [0, 0, 0, 0]; let s = 0;
        for (let k = 3; k >= 0; k--) { if (k === iL) continue; const m = c & 511, neg = (c >>> 9) & 1; c >>>= 10; q[k] = Math.SQRT1_2 * m / 511 * (neg ? -1 : 1); s += q[k] * q[k]; }
        q[iL] = Math.sqrt(Math.max(0, 1 - s)); quats.set(q, i * 4);
      } else { const x = b[o] / 127.5 - 1, y = b[o + 1] / 127.5 - 1, z = b[o + 2] / 127.5 - 1; o += 3; quats.set([x, y, z, Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z))], i * 4); }
    }
    return { n, deg, centers, scales, quats, colors };
  };
  SS.covariances = function (d) {
    const out = new Float32Array(d.n * 6);
    for (let i = 0; i < d.n; i++) {
      const x = d.quats[i * 4], y = d.quats[i * 4 + 1], z = d.quats[i * 4 + 2], w = d.quats[i * 4 + 3];
      const R = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
      const s = [d.scales[i * 3], d.scales[i * 3 + 1], d.scales[i * 3 + 2]];
      const M = [R[0] * s[0], R[1] * s[1], R[2] * s[2], R[3] * s[0], R[4] * s[1], R[5] * s[2], R[6] * s[0], R[7] * s[1], R[8] * s[2]];   // R·S
      const r = (a, b) => M[a * 3] * M[b * 3] + M[a * 3 + 1] * M[b * 3 + 1] + M[a * 3 + 2] * M[b * 3 + 2];
      out.set([r(0, 0), r(0, 1), r(0, 2), r(1, 1), r(1, 2), r(2, 2)], i * 6);
    }
    return out;
  };
})();
