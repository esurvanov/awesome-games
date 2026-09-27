// Тонкая обёртка над WebGL (без библиотек): контекст WebGL2 → WebGL1, шейдеры одного текста для обоих,
// инстансинг (WebGL2 или ANGLE_instanced_arrays), буферы, матрицы 4×4 (column-major, как в GL).
// Мир 3D: X — восток, Y — вверх, Z — юг (= y карты). Камера всегда в начале координат, и мир рисуется
// относительно неё: мир лежит в 13–25 км от нуля, где float32 держит лишь ~1 мм, поэтому вершины хранятся
// относительно своего куска/инстанса, а сдвиг «кусок − камера» считается на CPU в double (uOff).
'use strict';
L.def('render/gl', () => {

function createGL(canvas, opt = {}) {
  const attrs = { antialias: opt.antialias ?? true, alpha: false, depth: true, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: !!opt.preserve, powerPreference: 'high-performance' };
  let gl = canvas.getContext('webgl2', attrs), v2 = !!gl;
  if (!gl) gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
  if (!gl) return null;
  const G = { gl, v2, ext: {} };
  if (!v2) {
    const ia = gl.getExtension('ANGLE_instanced_arrays');
    if (!ia) return null;
    G.ext.ia = ia;
    if (!gl.getExtension('OES_standard_derivatives')) G.noDeriv = true;
    gl.getExtension('OES_element_index_uint');
  }
  G.divisor = v2 ? (i, d) => gl.vertexAttribDivisor(i, d) : (i, d) => G.ext.ia.vertexAttribDivisorANGLE(i, d);
  G.drawElementsInstanced = v2 ? (m, n, t, o, k) => gl.drawElementsInstanced(m, n, t, o, k) : (m, n, t, o, k) => G.ext.ia.drawElementsInstancedANGLE(m, n, t, o, k);
  G.drawArraysInstanced = v2 ? (m, f, n, k) => gl.drawArraysInstanced(m, f, n, k) : (m, f, n, k) => G.ext.ia.drawArraysInstancedANGLE(m, f, n, k);
  // один текст шейдера (GLSL ES 1.0) → для WebGL2 переводим в 3.00 es
  G.program = (vs, fs, name = '') => {
    const pre2v = '#version 300 es\n#define attribute in\n#define varying out\n#define texture2D texture\nprecision highp float;\n';
    const pre2f = '#version 300 es\nprecision highp float;\n#define varying in\n#define texture2D texture\nout vec4 fragColor_;\n#define gl_FragColor fragColor_\n';
    const pre1v = 'precision highp float;\n';
    const pre1f = (G.noDeriv ? '#define NO_DERIV 1\n' : '#extension GL_OES_standard_derivatives : enable\n') + '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s); const lines = src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n');
        throw new Error('shader ' + name + ': ' + log + '\n' + lines.slice(0, 4000));
      }
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, (v2 ? pre2v : pre1v) + vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, (v2 ? pre2f : pre1f) + fs));
    const a0 = (vs.match(/attribute\s+\w+\s+(aPos|aQ)\b/) || [])[1]; if (a0) gl.bindAttribLocation(p, 0, a0);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link ' + name + ': ' + gl.getProgramInfoLog(p));
    const prog = { p, a: {}, u: {} };
    const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < na; i++) { const x = gl.getActiveAttrib(p, i); prog.a[x.name] = gl.getAttribLocation(p, x.name); }
    const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) { const x = gl.getActiveUniform(p, i); const n = x.name.replace(/\[0\]$/, ''); prog.u[n] = gl.getUniformLocation(p, x.name); }
    return prog;
  };
  G.buffer = (data, target = gl.ARRAY_BUFFER, usage = gl.STATIC_DRAW) => { const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, usage); return b; };
  // динамический буфер инстансов: растёт по необходимости
  G.dyn = () => ({ b: gl.createBuffer(), cap: 0 });
  G.upload = (d, arr, n) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, d.b);
    if (arr.length > d.cap) { d.cap = arr.length; gl.bufferData(gl.ARRAY_BUFFER, arr.byteLength, gl.DYNAMIC_DRAW); }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, n == null ? arr : arr.subarray(0, n));
  };
  // атрибут: loc, buffer, size, type, norm, stride, offset, divisor
  G.attr = (loc, buf, size, type = gl.FLOAT, norm = false, stride = 0, off = 0, div = 0) => {
    if (loc == null || loc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, type, norm, stride, off); G.divisor(loc, div);
    G.used.add(loc);
  };
  G.used = new Set();
  G.resetAttrs = () => { for (const l of G.used) { gl.disableVertexAttribArray(l); G.divisor(l, 0); } G.used.clear(); };
  G.texture = (src, { repeat = true, mip = true, nearest = false, aniso = 8 } = {}) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const pot = (src.width & (src.width - 1)) === 0 && (src.height & (src.height - 1)) === 0;
    const wrap = repeat && (pot || v2) ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    if (mip && (pot || v2)) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
    else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
    // анизотропия — чтобы асфальт и разметка под острым углом не рябили и не мылились
    if (G.aniso === undefined) { const an = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic'); G.aniso = an ? { e: an, max: gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1 } : null; }
    if (G.aniso && mip && (pot || v2)) gl.texParameterf(gl.TEXTURE_2D, G.aniso.e.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(aniso, G.aniso.max));
    return t;
  };
  return G;
}

// ─── матрицы (Float32Array(16), column-major) ───
const M4 = {
  perspective(out, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    out.fill(0); out[0] = f / aspect; out[5] = f; out[10] = (far + near) * nf; out[11] = -1; out[14] = 2 * far * near * nf;
    return out;
  },
  // вид из начала координат: yaw (0 — север, −Z; по часовой к востоку), pitch (+ вверх)
  viewYawPitch(out, yaw, pitch, roll = 0) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const f = [sy * cp, sp, -cy * cp];
    let r = [cy, 0, sy];
    let u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    if (roll) { const cr = Math.cos(roll), sr = Math.sin(roll); const r2 = r.map((v, i) => v * cr + u[i] * sr), u2 = u.map((v, i) => u[i] * cr - r[i] * sr); r = r2; u = u2; }
    out[0] = r[0]; out[4] = r[1]; out[8] = r[2]; out[12] = 0;
    out[1] = u[0]; out[5] = u[1]; out[9] = u[2]; out[13] = 0;
    out[2] = -f[0]; out[6] = -f[1]; out[10] = -f[2]; out[14] = 0;
    out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
    return out;
  },
  mul(out, a, b) {
    const r = new Float32Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; r[i * 4 + j] = s;
    }
    out.set(r); return out;
  },
  invert(out, m) {
    const a = m, inv = new Float32Array(16);
    inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
    inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
    inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
    inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
    inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
    inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
    inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
    inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
    inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
    inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
    inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
    inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
    inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
    inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
    inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
    inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
    let det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
    det = det ? 1 / det : 0; for (let i = 0; i < 16; i++) out[i] = inv[i] * det;
    return out;
  },
  // модель: перенос (x,y,z) и поворот вокруг Y так, что локальная +Z смотрит в (fx, fz)
  model(out, x, y, z, fx, fz) {
    out.fill(0);
    out[0] = -fz; out[2] = fx;   // локальная X (вправо) → (−fz, 0, fx)
    out[5] = 1;
    out[8] = fx; out[10] = fz;   // локальная Z (вперёд) → (fx, 0, fz)
    out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
    return out;
  },
  ident(out) { out.fill(0); out[0] = out[5] = out[10] = out[15] = 1; return out; },
};

// цвет '#rrggbb' → [r,g,b] 0..1
const HEXC = new Map();
function hex(h) {
  let v = HEXC.get(h); if (v) return v;
  const n = parseInt(h.slice(1), 16); v = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; HEXC.set(h, v); return v;
}
function mixc(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
return { createGL, M4, hex, mixc };
});
