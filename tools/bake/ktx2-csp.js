/* ktx2-csp.js — KTX2 (Basis Universal) textures under the claude.ai artifact CSP. Classic script, no imports.
 *
 * Why not THREE.KTX2Loader: it fetch()es the transcoder (.js + .wasm) from the CDN and runs it in a Worker built
 * from a blob: URL. The artifact CSP has connect-src 'self' (no cross-origin fetch, no fetch(blob:)) and no blob: in
 * script-src (no blob workers). What IS allowed: <script src> from cdn.jsdelivr.net, WebAssembly.instantiate
 * ('wasm-unsafe-eval'), and same-origin .js files. So:
 *   - the transcoder JS comes from the CDN as a plain <script> (defines window.BASIS),
 *   - its .wasm ships as a base64 JS pack (assets/baked/basis_wasm.js → window.__PACK['basis_wasm']) and is handed to
 *     the emscripten module as wasmBinary (no fetch),
 *   - the .ktx2 files ship as base64 JS packs too (.ktx2 is not an artifact-served type): window.__PACK['baked/<name>'],
 *   - transcoding runs on the main thread (a few 4k maps at load: ~10–60 ms each).
 *
 *   await BakeKTX2.init(renderer, { transcoderUrl?, wasm?: Uint8Array | base64 })
 *   const tex = BakeKTX2.parse(THREE, uint8Array, { colorSpace })   // THREE.CompressedTexture (+ mips) or DataTexture
 *   BakeKTX2.fromPack(THREE, 'baked/terrain', opts)                  // same, from window.__PACK
 */
(function () {
  const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/libs/basis/basis_transcoder.js';
  const TF = { ETC1: 0, ETC2: 1, BC1: 2, BC3: 3, BC4: 4, BC7_M5: 7, ASTC_4x4: 10, RGBA32: 13 };
  const S = { ready: null, M: null, caps: null, stats: [] };
  const b64 = (s) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const loadScript = (src) => new Promise((ok, bad) => { if (window.BASIS) return ok(); const s = document.createElement('script'); s.src = src; s.crossOrigin = 'anonymous'; s.onload = ok; s.onerror = () => bad(new Error('basis transcoder script failed: ' + src)); document.head.appendChild(s); });

  function init(renderer, o = {}) {
    if (S.ready) return S.ready;
    const ext = renderer.extensions;
    S.caps = { astc: ext.has('WEBGL_compressed_texture_astc'), bptc: ext.has('EXT_texture_compression_bptc'), s3tc: ext.has('WEBGL_compressed_texture_s3tc'),
      etc2: ext.has('WEBGL_compressed_texture_etc'), etc1: ext.has('WEBGL_compressed_texture_etc1') };
    let wasm = o.wasm || (window.__PACK && window.__PACK.basis_wasm);
    if (!wasm) return (S.ready = Promise.reject(new Error('basis wasm pack missing (assets/baked/basis_wasm.js)')));
    if (typeof wasm === 'string') wasm = b64(wasm);
    S.ready = loadScript(o.transcoderUrl || CDN).then(() => new Promise((ok) => {
      const mod = { wasmBinary: wasm, onRuntimeInitialized: () => ok(mod) };
      window.BASIS(mod);
    })).then((mod) => { mod.initializeBasis(); S.M = mod; return mod; });
    return S.ready;
  }

  // target format: same ranking as three's KTX2Loader (LDR only)
  function pick(THREE, uastc, alpha) {
    const c = S.caps;
    if (uastc && c.astc) return [TF.ASTC_4x4, THREE.RGBA_ASTC_4x4_Format];
    if (!uastc && c.etc2) return alpha ? [TF.ETC2, THREE.RGBA_ETC2_EAC_Format] : [TF.ETC1, THREE.RGB_ETC2_Format];
    if (c.bptc) return [TF.BC7_M5, THREE.RGBA_BPTC_Format];
    if (c.astc) return [TF.ASTC_4x4, THREE.RGBA_ASTC_4x4_Format];
    if (c.s3tc) return alpha ? [TF.BC3, THREE.RGBA_S3TC_DXT5_Format] : [TF.BC1, THREE.RGBA_S3TC_DXT1_Format];
    if (uastc && c.etc2) return alpha ? [TF.ETC2, THREE.RGBA_ETC2_EAC_Format] : [TF.ETC1, THREE.RGB_ETC2_Format];
    return [TF.RGBA32, THREE.RGBAFormat];
  }

  function parse(THREE, bytes, o = {}) {
    if (!S.M) throw new Error('BakeKTX2.init() first');
    const t0 = performance.now(), f = new S.M.KTX2File(bytes);
    const done = () => { f.close(); f.delete(); };
    if (!f.isValid()) { done(); throw new Error('invalid ktx2'); }
    const uastc = f.isUASTC(), w = f.getWidth(), h = f.getHeight(), levels = f.getLevels(), alpha = f.getHasAlpha() || o.alpha;
    const [tf, fmt] = pick(THREE, uastc, alpha);
    if (!f.startTranscoding()) { done(); throw new Error('ktx2 startTranscoding failed'); }
    const mips = [];
    for (let l = 0; l < levels; l++) {
      const li = f.getImageLevelInfo(l, 0, 0), dst = new Uint8Array(f.getImageTranscodedSizeInBytes(l, 0, 0, tf));
      if (!f.transcodeImage(dst, l, 0, 0, tf, 0, -1, -1)) { done(); throw new Error('ktx2 transcode failed (level ' + l + ')'); }
      mips.push({ data: dst, width: levels > 1 ? li.origWidth : li.width, height: levels > 1 ? li.origHeight : li.height });
    }
    done();
    let tex;
    if (fmt === THREE.RGBAFormat) { tex = new THREE.DataTexture(mips[0].data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType); tex.mipmaps = mips.length > 1 ? mips : []; tex.generateMipmaps = mips.length <= 1; }
    else { tex = new THREE.CompressedTexture(mips, w, h, fmt, THREE.UnsignedByteType); tex.generateMipmaps = false; }
    tex.minFilter = mips.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.flipY = false;
    tex.colorSpace = o.colorSpace || THREE.NoColorSpace;
    tex.needsUpdate = true;
    const ms = performance.now() - t0; S.stats.push({ name: o.name || '', w, h, levels, uastc, format: fmt, ms: +ms.toFixed(1) });
    return tex;
  }
  function fromPack(THREE, key, o = {}) {
    const s = window.__PACK && window.__PACK[key]; if (!s) throw new Error('pack missing: ' + key);
    return parse(THREE, typeof s === 'string' ? b64(s) : s, Object.assign({ name: key }, o));
  }
  window.BakeKTX2 = { init, parse, fromPack, stats: S.stats, get caps() { return S.caps; } };
})();
