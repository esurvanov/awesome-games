// Шейдеры 3D-вида (текстом, GLSL ES 1.0 — для WebGL2 переводятся в render/gl.js).
// Общий свет: солнце (прямое — с учётом стен ущелья), небо/земля, до 8 точечных огней, фонарик, туман с дымкой.
// Цвета палитры — sRGB: в шейдере c*c ≈ линейный, на выходе тон-маппинг и sqrt.
// Координаты: всё в вершинном шейдере уже относительно камеры (vP). Вершины кусков хранятся от своего начала,
// сдвиг «начало − камера» (uOff) считает CPU в double — так нет дрожи float32 в 13–25 км от нуля мира.
'use strict';
L.def('render/shaders', () => {

// шум и сглаживание мелкой детали: aaf(ширина периода в пикселях) гасит рисунок, когда он мельче ~пикселя
// (иначе рябь и муар при движении, особенно под острым углом); без производных — не гасим
const NOISE = `
float hsh(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hsh(i), hsh(i + vec2(1, 0)), f.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), f.x), f.y); }
float aaf(vec2 w) { return 1.0 - smoothstep(0.3, 0.85, max(w.x, w.y)); }
#ifdef NO_DERIV
vec3 fw3(vec3 p) { return vec3(0.0); }
vec2 fw2(vec2 p) { return vec2(0.0); }
#else
vec3 fw3(vec3 p) { return fwidth(p); }
vec2 fw2(vec2 p) { return fwidth(p); }
#endif
`;
// сдвиг к камере по лучу: картинка та же, меняется только глубина (для пятен на асфальте, дороги поверх рельефа).
// a — постоянный запас (м), b·d² — растёт как шаг буфера глубины с расстоянием
const PULL = `
vec3 pullv(vec3 P, float a, float b) { float d = length(P); return P * (1.0 - min(0.5, (a + b * d * d) / max(d, 1e-3))); }
`;

const LIGHT = `
float rsmooth(float a, float b, float x) { return 1.0 - smoothstep(a, b, x); }
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uSkyCol; uniform vec3 uGndCol;
uniform vec3 uFogCol; uniform vec3 uHazeCol; uniform float uFogD; uniform float uExpo;
uniform vec3 uCamDir; uniform float uFlash; uniform float uNight; uniform float uWet; uniform float uTime;
uniform vec4 uLP[8]; uniform vec3 uLC[8]; uniform float uNL;
vec3 shade(vec3 P, vec3 N, vec3 alb, float gloss) {
  vec3 V = normalize(-P);
  if (dot(N, V) < 0.0) N = -N;
  float sd = max(dot(N, uSunDir), 0.0);
  vec3 amb = mix(uGndCol, uSkyCol, 0.5 + 0.5 * N.y);
  vec3 c = alb * (amb + uSunCol * sd);
  vec3 R = reflect(-V, N);
  c += uSunCol * pow(max(dot(R, uSunDir), 0.0), 40.0) * gloss;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uNL) break;
    vec3 L = uLP[i].xyz - P; float d2 = dot(L, L), r = uLP[i].w;
    float att = max(0.0, 1.0 - d2 / (r * r)); att *= att;
    vec3 Ln = L * inversesqrt(d2);
    c += uLC[i] * att * (alb * (0.3 + 0.7 * max(dot(N, Ln), 0.0)) + gloss * 2.0 * pow(max(dot(R, Ln), 0.0), 24.0));
  }
  if (uFlash > 0.0) {
    float d = length(P); vec3 Ln = -P / d;
    float cone = smoothstep(0.86, 0.97, dot(-Ln, uCamDir));
    c += (alb + gloss * 0.3) * vec3(1.0, 0.96, 0.88) * uFlash * cone * max(dot(N, Ln), 0.0) * 9.0 / (1.0 + d * d * 0.05);
  }
  return c;
}
vec3 fogit(vec3 c, vec3 P) {
  float d = length(P);
  float f = 1.0 - exp(-d * uFogD * (1.0 + d * uFogD * 0.6));
  vec3 fc = uFogCol + uHazeCol * pow(max(dot(P / d, uSunDir), 0.0), 5.0);
  return mix(c, fc, clamp(f, 0.0, 1.0));
}
vec4 outc(vec3 c) { return vec4(sqrt(1.0 - exp(-c * uExpo)), 1.0); }
`;

// ─── рельеф: нормали по производным (граненый вид), цвет вершины + скала по крутизне + снег ───
const TERRAIN_V = `
attribute vec3 aPos; attribute vec4 aCol;
uniform mat4 uVP; uniform vec3 uOff; uniform vec3 uOrg;
varying vec3 vP; varying vec4 vC; varying vec3 vW;
void main() { vP = aPos + uOff; vW = aPos + uOrg; vC = aCol; gl_Position = uVP * vec4(vP, 1.0); }`;
const TERRAIN_F = LIGHT + NOISE + `
varying vec3 vP; varying vec4 vC; varying vec3 vW;
uniform float uSnowY; uniform vec3 uRock; uniform vec3 uSnow; uniform float uDetail;
// деталь рельефа: крупный и мелкий шум, мелкий гасится по ширине пикселя
float dn(vec2 p, vec2 w) { return 0.5 + (vn(p * 0.35) - 0.5) * 0.5 * aaf(w * 0.35) + (vn(p * 0.07) - 0.5) * 0.5 * aaf(w * 0.07); }
void main() {
  vec3 fw = fw3(vW);
#ifdef NO_DERIV
  vec3 N = vec3(0.0, 1.0, 0.0);
#else
  vec3 N = normalize(cross(dFdx(vP), dFdy(vP)));
  if (N.y < 0.0) N = -N;
#endif
  vec3 alb = vC.rgb * vC.rgb;
  float kind = floor(vC.a * 255.0 / 40.0 + 0.5);
  float d = length(vP);
  // трипланарно: на стенах шум по вертикальным плоскостям (иначе он вытягивается вертикальными полосами)
  float n = 0.5;
  if (uDetail > 0.5) {
    vec3 A = N * N; float s = 0.0; n = 0.0;
    if (A.y > 0.04) { n += A.y * dn(vW.xz, fw.xz); s += A.y; }
    if (A.x > 0.04) { n += A.x * dn(vW.zy, fw.zy); s += A.x; }
    if (A.z > 0.04) { n += A.z * dn(vW.xy, fw.xy); s += A.z; }
    n = s > 0.0 ? n / s : 0.5;
  }
  float nd = mix(n, 0.5, smoothstep(60.0, 400.0, d));
  alb *= 0.82 + 0.36 * nd;
  if (kind > 2.5) {
    float rel = vW.y - 0.0; float rock = rsmooth(0.26, 0.5, N.y + (n - 0.5) * 0.35);
    float strata = vn(vec2((vW.x + vW.z) * 0.012, vW.y * 0.035)), crack = uDetail > 0.5 ? mix(0.6, vn(vec2((vW.x - vW.z) * 0.09, vW.y * 0.02)), aaf(vec2((fw.x + fw.z) * 0.09, fw.y * 0.02))) : 0.6;
    vec3 rc = uRock * uRock * (0.28 + 0.42 * strata) * (0.65 + 0.35 * smoothstep(0.25, 0.6, crack)) * mix(vec3(1.0), vec3(1.08, 0.98, 0.88), strata);
    alb = mix(alb, rc * mix(1.0, 0.65, uWet), rock);
    float sn = smoothstep(uSnowY - 60.0, uSnowY + 60.0, vW.y + (n - 0.5) * 160.0) * smoothstep(0.55, 0.8, N.y);
    alb = mix(alb, uSnow * uSnow, sn);
  } else alb *= mix(1.0, 0.7, uWet);
  vec3 c = shade(vP, N, alb, uWet * 0.15);
  gl_FragColor = outc(fogit(c, vP));
}`;

// ─── статичная обстановка и дорога ───
const STATIC_V = `
attribute vec3 aPos; attribute vec4 aNrm; attribute vec4 aCol; attribute vec2 aUV;
uniform mat4 uVP; uniform vec3 uCam; uniform mat4 uModel; uniform float uPull;
varying vec3 vP; varying vec3 vN; varying vec4 vC; varying vec2 vUV; varying vec3 vW;
` + PULL + `
void main() {
  vec4 w = uModel * vec4(aPos, 1.0); // uModel уже со сдвигом «сетка − камера»
  vP = w.xyz; vW = w.xyz + uCam; vN = (uModel * vec4(aNrm.xyz, 0.0)).xyz; vC = aCol; vUV = aUV;
  // дорога лежит на 0,33 м над рельефом: вдали этого мало для буфера глубины — чуть тянем к камере
  gl_Position = uVP * vec4(uPull > 0.0 ? pullv(vP, 0.0, uPull) : vP, 1.0);
}`;
const STATIC_F = LIGHT + NOISE + `
varying vec3 vP; varying vec3 vN; varying vec4 vC; varying vec2 vUV; varying vec3 vW;
uniform sampler2D uAtlas; uniform sampler2D uRoad; uniform float uRoadMode;
void main() {
  float m = floor(vC.a * 255.0 + 0.5); vec2 fwz = fw2(vW.xz); // производные — до ветвлений
  vec3 N = normalize(vN);
  vec3 col = vC.rgb; vec3 alb = col * col; vec3 em = vec3(0.0); float gloss = 0.0;
  if (uRoadMode > 0.5) {
    if (m > 200.0) { vec3 t = texture2D(uRoad, vUV).rgb; alb = t * t * mix(1.0, 0.55, uWet); gloss = uWet * 0.9 + 0.04; }
    else { alb *= (0.75 + 0.45 * mix(0.5, vn(vW.xz * 1.3), aaf(fwz * 1.3))) * mix(1.0, 0.7, uWet); gloss = uWet * 0.3; }
  } else if (m == 1.0) { alb = mix(vec3(0.02, 0.025, 0.03), alb * 0.3, 0.3); em = col * col * 2.2 * uNight; gloss = 0.4; }
  else if (m == 2.0) { em = col * col * (1.2 + 3.5 * uNight); alb *= 0.3; }
  else if (m == 3.0 || m == 4.0) { vec3 t = texture2D(uAtlas, vUV).rgb; alb = t * t; if (m == 4.0) em = alb * 1.6 * uNight; }
  else if (m == 10.0) { alb = vec3(0.01); }
  vec3 c = shade(vP, N, alb, gloss) + em;
  gl_FragColor = outc(fogit(c, vP));
}`;

// ─── инстансы: машины, деревья, велосипеды ───
// iP = (x, y, z, sy)  iD = (fx, fz, sx, sz)  iC = (r, g, b, флаги: 1 габариты, 2 стоп, 4 фары, 8 багаж, 16 качание)
const INST_V = `
attribute vec3 aPos; attribute vec4 aNrm; attribute vec4 aCol; attribute vec2 aUV;
attribute vec4 iP; attribute vec4 iD; attribute vec4 iC;
uniform mat4 uVP; uniform vec3 uOff; uniform float uTime; uniform float uWind;
varying vec3 vP; varying vec3 vN; varying vec4 vC; varying vec2 vUV; varying vec4 vI; varying vec3 vL;
float bit(float f, float b) { return mod(floor(f / b), 2.0); }
void main() {
  float m = floor(aCol.a * 255.0 + 0.5);
  vec3 l = aPos * vec3(iD.z, iP.w, iD.w);
  if (m == 9.0 && bit(iC.a, 8.0) < 0.5) l = vec3(0.0);
  if (bit(iC.a, 16.0) > 0.5) { float s = sin(uTime * 1.3 + iP.x * 0.37 + iP.z * 0.21) * uWind; l.x += s * l.y * 0.012; l.z += s * l.y * 0.008; }
  // iP — относительно камеры (машины) или своего куска (деревья, uOff = кусок − камера)
  vec3 w = iP.xyz + uOff + vec3(-l.x * iD.y + l.z * iD.x, l.y, l.x * iD.x + l.z * iD.y);
  vec3 n = aNrm.xyz; vN = vec3(-n.x * iD.y + n.z * iD.x, n.y, n.x * iD.x + n.z * iD.y);
  vP = w; vC = aCol; vUV = aUV; vI = iC; vL = aPos;
  gl_Position = uVP * vec4(vP, 1.0);
}`;
const INST_F = LIGHT + `
varying vec3 vP; varying vec3 vN; varying vec4 vC; varying vec2 vUV; varying vec4 vI; varying vec3 vL;
uniform sampler2D uAtlas; uniform vec4 uPlate;
float bit(float f, float b) { return mod(floor(f / b), 2.0); }
void main() {
  float m = floor(vC.a * 255.0 + 0.5);
  vec3 N = normalize(vN); vec3 col = vC.rgb; vec3 alb = col * col; vec3 em = vec3(0.0); float gloss = 0.0;
  if (m == 11.0) { alb = vI.rgb * vI.rgb; gloss = 0.35 + uWet * 0.4; }
  else if (m == 5.0) { alb = vI.rgb * vI.rgb * col; }
  else if (m == 6.0) {
    vec3 V = normalize(-vP); float fr = pow(1.0 - abs(dot(N, V)), 3.0);
    alb = vec3(0.012, 0.016, 0.02); gloss = 0.9;
    em = mix(uGndCol, uSkyCol, 0.5 + 0.5 * reflect(-V, N).y) * (0.25 + 0.8 * fr) * 0.8;
  }
  else if (m == 7.0) { float on = bit(vI.a, 1.0), br = bit(vI.a, 2.0); em = vec3(1.0, 0.08, 0.04) * (on * 1.6 + br * 4.0) * (0.3 + 0.7 * uNight); alb *= 0.6; }
  else if (m == 8.0) { float on = bit(vI.a, 4.0); em = vec3(1.0, 0.95, 0.82) * on * 3.0; gloss = 0.6; }
  else if (m == 12.0) { vec3 t = texture2D(uAtlas, mix(uPlate.xy, uPlate.zw, vUV)).rgb; alb = t * t * 0.9; }
  vec3 c = shade(vP, N, alb, gloss) + em;
  gl_FragColor = outc(fogit(c, vP));
}`;

// ─── люди: скелет по частям (цвет вершины: r — часть, g — слот цвета) ───
// iP = (x, y, z, рост)  iA = (fx, fz, поза, фаза)  iC1 = куртка + флаги  iC2 = штаны + кожа  iC3 = волосы/шапка + ребёнок
const PERSON_V = `
attribute vec3 aPos; attribute vec4 aNrm; attribute vec4 aCol;
attribute vec4 iP; attribute vec4 iA; attribute vec4 iC1; attribute vec4 iC2; attribute vec4 iC3;
uniform mat4 uVP; uniform float uTime; uniform float uNight;
varying vec3 vP; varying vec3 vN; varying vec3 vAlb; varying float vEm;
mat3 rx(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rz(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
mat3 ry(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
float bit(float f, float b) { return mod(floor(f / b), 2.0); }
void main() {
  float part = floor(aCol.r * 255.0 + 0.5), slot = floor(aCol.g * 255.0 + 0.5);
  float pose = iA.z, t = uTime + iA.w;
  vec3 p = aPos, n = aNrm.xyz;
  // углы: бедро, колено, плечо (вперёд −), локоть, отведение плеча, голова, наклон, подъём тела
  float hipL = 0.0, hipR = 0.0, knL = 0.0, knR = 0.0, shL = 0.05, shR = 0.05, elL = -0.15, elR = -0.15, abL = -0.06, abR = 0.06, hdY = 0.0, hdX = 0.0, lean = 0.0, lift = 0.0;
  float br = sin(t * 1.7) * 0.012;
  if (pose < 0.5) { // стоит
    hdY = sin(t * 0.31) * 0.35; lean = sin(t * 0.23) * 0.03; shL = 0.05 + br; shR = 0.05 - br; }
  else if (pose < 1.5) { // идёт
    float w = sin(t * 5.2); hipL = w * 0.45; hipR = -w * 0.45; knL = max(0.0, -cos(t * 5.2)) * 0.7; knR = max(0.0, cos(t * 5.2)) * 0.7;
    shL = -w * 0.4; shR = w * 0.4; elL = -0.35; elR = -0.35; lift = abs(cos(t * 5.2)) * 0.035; lean = 0.05; }
  else if (pose < 2.5) { // телефон у уха
    shR = -0.35; abR = 0.35; elR = -2.35; hdY = sin(t * 0.4) * 0.15; hdX = 0.08; lean = sin(t * 0.2) * 0.02; }
  else if (pose < 3.5) { // сидит (на отбойнике / бордюре)
    hipL = -1.45; hipR = -1.35; knL = 1.5; knR = 1.4; lift = -0.46; shL = -0.55; shR = -0.5; elL = -0.8; elR = -0.9; hdX = 0.25 + sin(t * 0.3) * 0.1; lean = 0.15; }
  else if (pose < 4.5) { // мёрзнет: руки обхватили себя, переминается
    shL = -0.45; shR = -0.45; abL = 0.32; abR = -0.32; elL = -1.9; elR = -1.9; float st = sin(t * 3.0); hipL = max(st, 0.0) * 0.15; knL = max(st, 0.0) * 0.3; hipR = max(-st, 0.0) * 0.15; knR = max(-st, 0.0) * 0.3; lean = 0.08 + sin(t * 9.0) * 0.012; hdX = 0.18; }
  else if (pose < 5.5) { // разговаривает, жестикулирует
    shR = -0.45 - 0.3 * sin(t * 2.1); elR = -1.1 + 0.45 * sin(t * 3.3); shL = -0.2 + 0.15 * sin(t * 1.3 + 1.0); elL = -0.7; hdY = sin(t * 0.9) * 0.25; hdX = sin(t * 2.3) * 0.08; }
  else if (pose < 6.5) { // продавец за прилавком
    shL = -0.7; shR = -0.6 + 0.25 * sin(t * 1.1); elL = -0.7; elR = -0.9 + 0.3 * sin(t * 1.7); lean = 0.12; hdY = sin(t * 0.5) * 0.3; }
  else if (pose < 7.5) { // ведёт велосипед
    float w = sin(t * 4.6); hipL = w * 0.4; hipR = -w * 0.4; knL = max(0.0, -cos(t * 4.6)) * 0.6; knR = max(0.0, cos(t * 4.6)) * 0.6;
    shL = -0.95; shR = -0.95; elL = -0.35; elR = -0.35; abL = 0.1; abR = -0.1; lean = 0.12; lift = abs(cos(t * 4.6)) * 0.03; }
  else { // курит: рука ко рту и обратно
    float k = smoothstep(0.2, 0.8, sin(t * 0.55) * 0.5 + 0.5); shR = mix(0.05, -0.55, k); elR = mix(-0.4, -2.3, k); abR = mix(0.08, 0.22, k); shL = -0.3; elL = -1.3; abL = 0.25; hdX = mix(0.0, -0.1, k); }
  mat3 R = mat3(1.0);
  if (part == 1.0) { vec3 o = vec3(0.0, 1.47, 0.0); R = ry(hdY) * rx(hdX); p = R * (p - o) + o; }
  else if (part == 2.0 || part == 8.0) { vec3 h = vec3(-0.1, 0.92, 0.0), k = vec3(-0.1, 0.5, 0.0); mat3 K = rx(knL); if (part == 8.0) { p = K * (p - k) + k; n = K * n; } R = rx(hipL); p = R * (p - h) + h; }
  else if (part == 3.0 || part == 9.0) { vec3 h = vec3(0.1, 0.92, 0.0), k = vec3(0.1, 0.5, 0.0); mat3 K = rx(knR); if (part == 9.0) { p = K * (p - k) + k; n = K * n; } R = rx(hipR); p = R * (p - h) + h; }
  else if (part == 4.0 || part == 6.0) { vec3 s = vec3(-0.255, 1.42, 0.0), e = vec3(-0.255, 1.14, 0.0); if (part == 6.0) { mat3 E = rx(elL); p = E * (p - e) + e; n = E * n; } R = rz(abL) * rx(shL); p = R * (p - s) + s; }
  else if (part == 5.0 || part == 7.0 || part == 11.0) { vec3 s = vec3(0.255, 1.42, 0.0), e = vec3(0.255, 1.14, 0.0); if (part != 5.0) { mat3 E = rx(elR); p = E * (p - e) + e; n = E * n; } R = rz(abR) * rx(shR); p = R * (p - s) + s; }
  n = R * n;
  float bag = bit(iC1.a, 1.0), phone = step(1.5, pose) * step(pose, 2.5);
  if (part == 10.0 && bag < 0.5) p = vec3(0.0, 0.9, 0.0);
  if (part == 11.0 && phone < 0.5 && !(pose > 7.5)) p = vec3(0.255, 0.8, 0.0);
  // корпус выше таза наклоняется
  if (part != 2.0 && part != 3.0 && part != 8.0 && part != 9.0 && p.y > 0.85) { mat3 Lm = rx(lean); p = Lm * (p - vec3(0.0, 0.9, 0.0)) + vec3(0.0, 0.9, 0.0); n = Lm * n; }
  p.y += lift;
  float h = iP.w; p *= h;
  vec3 w = iP.xyz + vec3(-p.x * iA.y + p.z * iA.x, p.y, p.x * iA.x + p.z * iA.y);
  vN = vec3(-n.x * iA.y + n.z * iA.x, n.y, n.x * iA.x + n.z * iA.y);
  vec3 c = iC1.rgb; vEm = 0.0;
  if (slot == 0.0) c = vec3(iC2.a, iC2.a * 0.8, iC2.a * 0.66);
  else if (slot == 2.0) c = iC2.rgb;
  else if (slot == 3.0) c = iC3.rgb;
  else if (slot == 4.0) c = vec3(0.1, 0.09, 0.085);
  else if (slot == 5.0) c = vec3(iC3.b * 0.5 + 0.15, iC3.r * 0.4 + 0.2, 0.25);
  else if (slot == 6.0) { c = vec3(0.74, 0.84, 1.0); vEm = uNight * 2.5; }
  vAlb = c * c; vP = w; // iP — относительно камеры
  gl_Position = uVP * vec4(vP, 1.0);
}`;
const PERSON_F = LIGHT + `
varying vec3 vP; varying vec3 vN; varying vec3 vAlb; varying float vEm;
void main() { vec3 c = shade(vP, normalize(vN), vAlb, 0.05) + vAlb * vEm * 3.0; gl_FragColor = outc(fogit(c, vP)); }`;

// ─── Терек: мутная серо-бирюзовая вода, буруны вдоль течения ───
const WATER_V = `
attribute vec3 aPos; attribute vec2 aUV;
uniform mat4 uVP; uniform vec3 uOff; uniform vec3 uOrg;
varying vec3 vP; varying vec2 vUV; varying vec3 vW;
void main() { vP = aPos + uOff; vUV = aUV; vW = aPos + uOrg; gl_Position = uVP * vec4(vP, 1.0); }`;
const WATER_F = LIGHT + NOISE + `
varying vec3 vP; varying vec2 vUV; varying vec3 vW;
uniform vec3 uWater;
void main() {
  vec2 q = vec2(vUV.x * 6.0, vUV.y * 10.0 + uTime * 2.2), fq = fw2(vUV);
  // буруны мельче пикселя вдали — гасим (иначе река искрит «битыми» пикселями)
  float n1 = mix(0.5, vn(q), aaf(fq * vec2(6.0, 10.0))), n2 = mix(0.5, vn(q * 2.3 + vec2(3.1, uTime * 1.3)), aaf(fq * vec2(13.8, 23.0))), n3 = mix(0.45, vn(vec2(vUV.x * 22.0, vUV.y * 40.0 + uTime * 6.0)), aaf(fq * vec2(22.0, 40.0)));
  vec3 N = normalize(vec3((n1 - 0.5) * 0.5 + (n3 - 0.5) * 0.2, 1.0, (n2 - 0.5) * 0.5));
  float edge = smoothstep(0.42, 0.5, abs(vUV.x - 0.5));
  float foam = smoothstep(0.72, 0.9, n1 * 0.6 + n3 * 0.5) * 0.45 + edge * 0.35 * n2;
  vec3 alb = uWater * uWater * (0.55 + 0.25 * n2);
  alb = mix(alb, vec3(0.55, 0.58, 0.56), clamp(foam, 0.0, 1.0));
  vec3 V = normalize(-vP); float fr = 0.04 + 0.5 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 sky = mix(uGndCol, uSkyCol, 0.8) * 1.2;
  vec3 c = shade(vP, N, alb, 0.6);
  c = mix(c, sky, fr * 0.45);
  gl_FragColor = outc(fogit(c, vP));
}`;

// ─── небо: градиент по солнцу, облака по погоде, звёзды и Млечный Путь в безлунную ночь ───
const SKY_V = `
attribute vec2 aPos; varying vec2 vQ;
void main() { vQ = aPos; gl_Position = vec4(aPos, 1.0, 1.0); }`;
const SKY_F = `
float rsmooth(float a, float b, float x) { return 1.0 - smoothstep(a, b, x); }
varying vec2 vQ;
uniform mat4 uInvVP; uniform vec3 uSunDir; uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uSunCol; uniform vec3 uHazeCol;
uniform float uStars; uniform float uCloud; uniform float uTime; uniform float uExpo; uniform float uSidereal; uniform vec3 uFogCol;
float hsh3(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hsh(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hsh(i), hsh(i + vec2(1, 0)), f.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
void main() {
  vec4 r = uInvVP * vec4(vQ, 1.0, 1.0); vec3 d = normalize(r.xyz / r.w);
  float y = max(d.y, 0.0);
  vec3 c = mix(uHor, uZen, pow(y, 0.55));
  float sd = max(dot(d, uSunDir), 0.0);
  c += uHazeCol * pow(sd, 6.0) * 0.8 + uSunCol * pow(sd, 3000.0) * 12.0 * step(0.0, uSunDir.y + 0.02);
  // звёзды: небо вращается (звёздное время)
  if (uStars > 0.01) {
    float ca = cos(uSidereal), sa = sin(uSidereal);
    vec3 e = vec3(ca * d.x - sa * d.z, d.y, sa * d.x + ca * d.z);
    // наклон оси мира (широта 42.8°)
    float cl = 0.733, sl = 0.68; e = vec3(e.x, cl * e.y - sl * e.z, sl * e.y + cl * e.z);
    vec3 g = e * 220.0; vec3 cell = floor(g); vec3 f = fract(g) - 0.5;
    float h = hsh3(cell), st = 0.0;
    if (h > 0.965) { vec3 off = vec3(hsh3(cell + 3.1), hsh3(cell + 7.7), hsh3(cell + 1.3)) - 0.5; float dd = length(f - off * 0.6); st = rsmooth(0.0, 0.16, dd) * (h - 0.965) * 40.0 * (0.7 + 0.3 * sin(uTime * 3.0 + h * 90.0)); }
    // Млечный Путь: полоса вдоль большого круга, пылевые прожилки
    vec3 gn = normalize(vec3(0.35, 0.25, 0.9)); float b = dot(e, gn);
    vec2 uv = vec2(atan(e.y, e.x) * 3.0, b * 12.0);
    float band = exp(-b * b * 22.0) * (0.55 + 0.6 * fbm(uv * 1.3)) * (1.0 - 0.7 * smoothstep(0.35, 0.65, fbm(uv * 3.1 + 4.0)) * exp(-b * b * 60.0));
    vec3 mw = vec3(0.55, 0.58, 0.72) * band * 0.26;
    float dense = step(0.93, hsh3(cell + 11.0)) * band * rsmooth(0.0, 0.2, length(f)) * 1.5;
    c += (vec3(0.9, 0.93, 1.0) * (st + dense) + mw) * uStars * smoothstep(0.0, 0.12, d.y);
  }
  // облака: плоскость над ущельем
  if (uCloud > 0.25 && d.y > 0.0) {
    vec2 p = d.xz / (d.y + 0.08) * 1.3 + vec2(uTime * 0.01, uTime * 0.004);
    float cl = smoothstep(0.62 - uCloud * 0.45, 0.95, fbm(p));
    vec3 cc = mix(uHor * 0.9, uHor * 1.25 + uSunCol * 0.05, fbm(p * 2.0 + 3.0));
    c = mix(c, cc, cl * clamp(uCloud * 1.3, 0.0, 1.0) * smoothstep(0.0, 0.15, d.y));
  }
  c = mix(c, uFogCol, rsmooth(-0.05, 0.08, d.y));
  gl_FragColor = vec4(sqrt(1.0 - exp(-c * uExpo)), 1.0);
}`;

// ─── огни: спрайты (0), пятна на земле (1), отражения на мокром асфальте (2) — аддитивно ───
const GLOW_V = `
attribute vec2 aQ; attribute vec4 iP; attribute vec4 iC;
uniform mat4 uVP; uniform vec3 uRight; uniform vec3 uUp; uniform float uPx; uniform float uWet;
varying vec2 vQ; varying vec3 vC; varying float vK; varying vec3 vP;
` + PULL + `
void main() {
  vec3 P = iP.xyz; float d = length(P); float mode = floor(iC.a / 10.0), inten = mod(iC.a, 10.0); // iP — относительно камеры
  vec3 w, g;
  if (mode < 0.5) {
    float s = max(iP.w, d * uPx * 4.0); w = P + (uRight * aQ.x + uUp * aQ.y) * s; vK = inten * min(1.0, iP.w / max(s, 1e-4) * 1.6 + 0.35);
    // спрайт вперёд на свой радиус: его не режут собственный кузов и асфальт (иначе вдали мерцает)
    g = w * max(0.05, 1.0 - s / max(d, 1e-3));
  }
  else if (mode < 1.5) { w = P + vec3(aQ.x, 0.0, aQ.y) * iP.w; vK = inten; g = pullv(w, 0.02, 6e-7); }
  else { vec2 dir = normalize(-P.xz + 1e-4); vec2 side = vec2(-dir.y, dir.x); float len = iP.w * (1.0 + uWet * 7.0); w = P + vec3(side * aQ.x * iP.w * 0.5 + dir * (aQ.y * 0.5 + 0.5) * len, 0.0); w.y = P.y; vK = inten * uWet; g = pullv(w, 0.02, 6e-7); }
  vQ = aQ; vC = iC.rgb; vP = w;
  gl_Position = uVP * vec4(g, 1.0);
}`;
const GLOW_F = `
varying vec2 vQ; varying vec3 vC; varying float vK; varying vec3 vP;
uniform float uFogD; uniform float uExpo;
void main() {
  float r2 = dot(vQ, vQ);
  float a = exp(-r2 * 5.0) + exp(-r2 * 40.0) * 1.5;
  float d = length(vP); float f = exp(-d * uFogD * 0.45);
  vec3 c = vC * vC * a * vK * f;
  gl_FragColor = vec4(1.0 - exp(-c * uExpo), 1.0);
}`;

// ─── пятна тени под машинами и людьми (умножение) ───
const BLOB_V = `
attribute vec2 aQ; attribute vec4 iP; attribute vec4 iD;
uniform mat4 uVP;
varying vec2 vQ; varying float vK;
` + PULL + `
void main() {
  vec3 l = vec3(aQ.x * iD.z, 0.0, aQ.y * iD.w);
  vec3 w = iP.xyz + vec3(-l.x * iD.y + l.z * iD.x, 0.0, l.x * iD.x + l.z * iD.y); // iP — относительно камеры
  vQ = aQ; vK = iP.w; gl_Position = uVP * vec4(pullv(w, 0.01, 6e-7), 1.0);
}`;
const BLOB_F = `
float rsmooth(float a, float b, float x) { return 1.0 - smoothstep(a, b, x); }
varying vec2 vQ; varying float vK;
void main() { vec2 q = abs(vQ); float e = max(q.x, q.y); float a = rsmooth(0.45, 1.0, e) * vK; gl_FragColor = vec4(vec3(1.0 - a), 1.0); }`;

// ─── дождь и мокрый снег: капли вокруг камеры (мировые, с параллаксом) ───
const RAIN_V = `
attribute vec2 aQ; attribute vec3 iS;
uniform mat4 uVP; uniform vec3 uCamB; uniform float uTime; uniform float uSnow; uniform vec3 uRight; uniform vec2 uWindV;
varying vec2 vQ; varying float vD;
void main() {
  float B = 26.0;
  float sp = mix(9.0, 1.4, uSnow);
  vec3 base = iS * B;
  vec3 p = base + vec3(uWindV.x, -sp, uWindV.y) * uTime;
  p.x += sin(uTime * 1.3 + iS.x * 40.0) * uSnow * 0.6;
  vec3 rel = mod(p - uCamB + B * 0.5, B) - B * 0.5; // uCamB — камера по модулю B (малые числа)
  float len = mix(0.55, 0.06, uSnow), wd = mix(0.012, 0.05, uSnow);
  vec3 w = rel + uRight * aQ.x * wd + vec3(uWindV.x * 0.05, 1.0, uWindV.y * 0.05) * aQ.y * len;
  vQ = aQ; vD = length(rel);
  gl_Position = uVP * vec4(w, 1.0);
}`;
const RAIN_F = `
float rsmooth(float a, float b, float x) { return 1.0 - smoothstep(a, b, x); }
varying vec2 vQ; varying float vD; uniform float uRainA; uniform vec3 uRainC;
void main() { float a = (1.0 - abs(vQ.x)) * rsmooth(3.0, 13.0, vD) * uRainA; gl_FragColor = vec4(uRainC * a, 1.0); }`;

// ─── провода ЛЭП ───
const LINE_V = `attribute vec3 aPos; uniform mat4 uVP; uniform vec3 uOff; varying vec3 vP; void main() { vP = aPos + uOff; gl_Position = uVP * vec4(vP, 1.0); }`;
const LINE_F = LIGHT + `varying vec3 vP; uniform vec3 uLineC; void main() { gl_FragColor = outc(fogit(uLineC * (uSkyCol + uSunCol * 0.3), vP)); }`;

return { TERRAIN_V, TERRAIN_F, STATIC_V, STATIC_F, INST_V, INST_F, PERSON_V, PERSON_F, WATER_V, WATER_F, SKY_V, SKY_F, GLOW_V, GLOW_F, BLOB_V, BLOB_F, RAIN_V, RAIN_F, LINE_V, LINE_F };
});
