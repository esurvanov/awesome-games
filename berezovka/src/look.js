// Берёзовка — СВЕТ, ФОН, МАТЕРИАЛЫ: один источник правды для неба, окружения, тумана, солнца и гор.
// Небо днём/в пасмурь — HDRI Poly Haven (CC0): horn-koppe_snow (ясно), snow_field (пасмурно), ночь — assets/sky.jpg.
// Панорамы подготовлены офлайн: солнце и его ореол вычтены из ясной панорамы, ореол сохранён таблицей AUR
// (отношение яркости неба к фоновому профилю в зависимости от угла до солнца, 0..100°). В шейдере ореол
// возвращается уже вокруг ИГРОВОГО солнца, панорама поворачивается под его азимут.
import * as THREE from 'three';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';

const V3 = THREE.Vector3, PI = Math.PI;
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) };
const lerp = (a, b, t) => a + (b - a) * t;

// ---- измерено скриптом hdr.py по исходным .hdr (единицы HDR-файла) ----
const PANO = {
  day:   {sunU: .59985, scale: 1.43073, Esun: 3.8415, Esky: .38746},   // sunU — столбец солнца; scale: stored = linear*scale
  storm: {sunU: .61890, scale: .46566, Esky: 2.54054},
  night: {moonU: .59814},
};
const AUR_RAW = [693.073,382.197,221.867,89.756,57.379,37.156,36.837,26.334,17.784,23.725,17.311,12.098,15.264,11.429,8.206,11.243,8.462,6.209,8.986,6.758,5.041,7.561,5.688,4.297,6.571,4.961,3.778,5.847,4.439,3.395,5.301,4.043,3.103,4.876,3.736,2.876,4.528,3.487,2.696,4.231,3.284,2.552,3.971,3.116,2.435,3.743,2.977,2.341,3.538,2.860,2.261,3.348,2.759,2.191,3.172,2.667,2.129,3.007,2.582,2.074,2.856,2.502,2.024,2.716,2.426,1.976,2.593,2.352,1.925,2.487,2.274,1.870,2.395,2.193,1.809,2.310,2.114,1.751,2.227,2.043,1.698,2.146,1.978,1.651,2.070,1.918,1.608,2.002,1.860,1.566,1.940,1.803,1.525,1.885,1.749,1.483,1.831,1.698,1.443,1.780,1.650,1.404,1.731,1.606,1.368,1.684,1.565,1.334,1.637,1.528,1.304,1.587,1.492,1.275,1.515,1.446,1.250,1.429,1.390,1.228,1.334,1.328,1.209,1.267,1.281,1.193,1.224,1.249,1.178,1.201,1.230,1.164,1.181,1.211,1.152,1.162,1.194,1.140,1.146,1.177,1.128,1.131,1.163,1.117,1.118,1.149,1.106,1.106,1.135,1.096,1.094,1.122,1.086,1.083,1.108,1.077,1.072,1.095,1.067,1.061,1.082,1.058,1.051,1.070,1.048,1.043,1.058,1.040,1.035,1.047,1.032,1.028,1.036,1.025,1.020,1.026,1.018,1.014,1.017,1.012,1.008,1.008,1.005,1.002,1.000,0.999,0.995,0.992,0.992,0.989,0.984,0.985,0.985,0.975,0.978,0.985,0.973,0.972];
const AUR = (() => { const n = AUR_RAW.length / 3, t = [], e = [AUR_RAW[(n - 1) * 3], AUR_RAW[(n - 1) * 3 + 1], AUR_RAW[(n - 1) * 3 + 2]];
  for (let i = 0; i <= 100; i++) { const k = Math.min(i, n - 1) * 3; t.push(new V3(Math.max(1, AUR_RAW[k] / e[0]), Math.max(1, AUR_RAW[k + 1] / e[1]), Math.max(1, AUR_RAW[k + 2] / e[2]))) } return t })();

// ---- настройки (единое место) ----
export const CFG = {
  K: 1.0,                 // единицы игры = единицы HDR
  expoDay: 1.0, expoNight: 1.6, expoAdapt: .5,
  nightGain: .46, moonI: .5,
  fogDay: .0034, fogNight: .005,
  snowCol: [.80, .83, .88],
};

export const LOOK = {sky: null, envScene: null, pm: null, envRT: null, stats: null, U: null, ao: null, aoOn: true, last: {}, fogCol: new THREE.Color(), amb: new THREE.Color(), frame: 0};
let CTX = null;

/* ---------- статистика панорам (CPU): горизонт и косинус-взвешенное среднее неба ---------- */
function panoStats(tex, night) {
  const W = 256, H = 128, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', {willReadFrequently: true}); x.drawImage(tex.image, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data; const lin = v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4) };
  const hor = [0, 0, 0], cosw = [0, 0, 0], gnd = [0, 0, 0]; let nh = 0, wc = 0, ng = 0;
  for (let j = 0; j < H; j++) { const el = (.5 - (j + .5) / H) * PI;
    for (let i = 0; i < W; i++) { const k = (j * W + i) * 4; let r = lin(d[k]), g = lin(d[k + 1]), b = lin(d[k + 2]);
      if (night) { r = Math.pow(r, 2.5) * .42; g = Math.pow(g, 2.5) * .5; b = Math.pow(b, 2.5) * .72 }
      if (el > 0 && el < 6 * PI / 180) { hor[0] += r; hor[1] += g; hor[2] += b; nh++ }
      if (el > 0) { const w = Math.sin(el) * Math.cos(el); cosw[0] += r * w; cosw[1] += g * w; cosw[2] += b * w; wc += w }
      else { gnd[0] += r; gnd[1] += g; gnd[2] += b; ng++ } } }
  return {hor: new THREE.Color(hor[0] / nh, hor[1] / nh, hor[2] / nh), sky: new THREE.Color(cosw[0] / wc, cosw[1] / wc, cosw[2] / wc), gnd: new THREE.Color(gnd[0] / ng, gnd[1] / ng, gnd[2] / ng)};
}

/* ---------- небо (видимое и для захвата окружения — один шейдер) ---------- */
const SKY_VS = 'varying vec3 vD;void main(){vD=position;vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position=p.xyww;}';
const SKY_FS = `uniform sampler2D tDay,tStorm,tNight;uniform vec3 uAur[101];
 uniform vec3 uSun,uMoon,uFog,uSunCol,uNGnd;uniform float uRotD,uRotS,uRotN,uGainD,uGainS,uGainN,uStorm,uNight,uSunset,uSunVis,uTime,uAurora;
 varying vec3 vD;
 vec2 equ(vec3 d,float rot){float a=atan(d.z,d.x)-rot;return vec2(fract(a*.15915494+.5),asin(clamp(d.y,-1.,1.))*.31830989+.5);}
 float hs(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
 vec3 aur(float deg){float t=clamp(deg,1.,99.);int i=int(t);return mix(uAur[i],uAur[i+1],fract(t));}
 void main(){vec3 d=normalize(vD);float y=d.y;
  float ca=clamp(dot(d,uSun),-1.,1.);float deg=degrees(acos(ca));
  float sw=clamp(uSunset*(exp(-deg/35.)*.9+(1.-smoothstep(0.,.35,y))*.7),0.,1.);
  vec3 tint=mix(vec3(1.),vec3(1.45,.82,.52),sw);
  vec3 day=texture2D(tDay,equ(d,uRotD)).rgb*uGainD*tint;
  vec3 st=texture2D(tStorm,equ(d,uRotS)).rgb*uGainS;
  vec3 ex=(aur(deg)-1.)*smoothstep(-.03,.05,y)*uSunVis*(1.-uStorm*.85)*(1.-uNight);
  vec3 ng=texture2D(tNight,equ(d,uRotN)).rgb;vec3 night=pow(ng,vec3(2.5))*vec3(.42,.5,.72)*uGainN;
  if(y>0.){vec3 sp=floor(d*320.);float s=hs(sp);night+=vec3(smoothstep(.9965,1.,s))*(.55+.45*sin(uTime*3.+s*90.))*.5*uGainN;}
  if(y>.01){vec2 p=vec2(d.x,-d.z)/(y+.12);float a=0.;
   for(int i=0;i<4;i++){float fi=float(i);float off=sin(p.x*.6+uTime*.07+fi*1.3)*.8+sin(p.x*1.7-uTime*.11+fi)*.35;
    float band=exp(-pow(p.y-1.6-fi*.4+off,2.)*3.);float stt=.55+.45*sin(p.x*11.+fi*4.+uTime*.35+sin(p.x*3.+uTime*.2)*2.);a+=band*stt*(1.-fi*.18);}
   float fy=smoothstep(.01,.2,y)*(1.-smoothstep(.55,.9,y));vec3 ac=mix(vec3(.12,1.,.5),vec3(.55,.3,1.),smoothstep(.25,.7,y));
   night+=ac*a*fy*uAurora*.35*uGainN;}
  vec3 col=mix(mix(day,st,uStorm),night,uNight);
  vec3 glow=day*ex;
 #ifdef ENVCAP
  if(y<0.)col=mix(col,uNGnd,uNight);           // ночью земля в окружении — снег под луной, не отражение озера
  glow=min(glow,vec3(40.));
 #else
  float hb=smoothstep(0.,.14,y);col=mix(uFog,col,hb);glow*=hb*hb;
  col+=uSunCol*smoothstep(.99988,.99994,ca)*uSunVis*(1.-uStorm)*(1.-uNight);
  vec3 md=normalize(uMoon);float mm=dot(d,md);col+=vec3(.8,.85,1.)*pow(max(mm,0.),900.)*uNight*.6*uGainN*hb;
 #endif
  col+=glow;
  gl_FragColor=vec4(col,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;

function prepPano(t) { if (!t) return null; t.mapping = THREE.UVMapping; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t }

export function buildSky(ctx) {
  CTX = ctx; const {scene, renderer, TXP} = ctx;
  const tDay = prepPano(TXP.skyDay), tStorm = prepPano(TXP.skyStorm || TXP.skyDay), tNight = prepPano(TXP.sky || TXP.skyDay);
  LOOK.stats = {day: tDay ? panoStats(tDay) : null, storm: tStorm ? panoStats(tStorm) : null, night: tNight ? panoStats(tNight, true) : null};
  const U = LOOK.U = {tDay: {value: tDay}, tStorm: {value: tStorm}, tNight: {value: tNight}, uAur: {value: AUR},
    uSun: {value: new V3(0, 1, 0)}, uMoon: {value: new V3(0, 1, 0)}, uFog: {value: new THREE.Color()}, uSunCol: {value: new THREE.Color()}, uNGnd: {value: new THREE.Color()},
    uRotD: {value: 0}, uRotS: {value: 0}, uRotN: {value: 0}, uGainD: {value: 1}, uGainS: {value: 1}, uGainN: {value: 1},
    uStorm: {value: 0}, uNight: {value: 0}, uSunset: {value: 0}, uSunVis: {value: 1}, uTime: {value: 0}, uAurora: {value: 1}};
  const mk = env => new THREE.ShaderMaterial({uniforms: U, side: THREE.BackSide, depthWrite: false, fog: false, defines: env ? {ENVCAP: 1} : {}, vertexShader: SKY_VS, fragmentShader: SKY_FS});
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mk(false)); sky.frustumCulled = false; sky.renderOrder = -1; sky.userData.noAO = 1; scene.add(sky);
  LOOK.sky = sky;
  LOOK.envScene = new THREE.Scene(); LOOK.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), mk(true)));
  LOOK.pm = new THREE.PMREMGenerator(renderer); LOOK.pm.compileCubemapShader?.();
  // мягкие тени солнца: PCF с радиусом (PCFSoft радиус игнорирует)
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return sky;
}
export function setupLights(sun, hemi) { sun.shadow.radius = 2.5; sun.shadow.bias = -.0005; sun.shadow.normalBias = .04; hemi.intensity = 0; LOOK.sun = sun; LOOK.hemi = hemi }

function captureEnv() {
  const old = LOOK.envRT; LOOK.envRT = LOOK.pm.fromScene(LOOK.envScene, 0, 1, 200);
  CTX.scene.environment = LOOK.envRT.texture; if (old) old.dispose();
}

/* ---------- покадровое обновление: всё освещение из одного состояния неба ---------- */
const _c = new THREE.Color(), _d = new THREE.Color(), _n = new THREE.Color(), _tint = new THREE.Color();
export function update(s) {
  // s: {sd, el, nightF, dayK, sunset, storm, focus, T, aurora, HZ}
  const {sd, el, nightF, dayK, sunset, storm, focus, T, HZ} = s; const U = LOOK.U, sun = LOOK.sun, st = LOOK.stats; if (!U) return;
  const K = CFG.K, skyEl = lerp(.35, 1, sst(-.05, .42, el));          // небо тусклее при низком солнце
  const gD = K / PANO.day.scale * skyEl, gS = K / PANO.storm.scale * .55 * skyEl, gN = CFG.nightGain;
  const sunVis = sst(-.03, .02, el);
  const phiG = Math.atan2(sd.z, sd.x);
  const md = new V3(-sd.x, Math.abs(sd.y) + .25, -sd.z).normalize();
  U.uSun.value.copy(sd); U.uMoon.value.copy(md);
  U.uRotD.value = phiG - (PANO.day.sunU - .5) * 2 * PI; U.uRotS.value = phiG - (PANO.storm.sunU - .5) * 2 * PI;
  U.uRotN.value = Math.atan2(md.z, md.x) - (PANO.night.moonU - .5) * 2 * PI;
  U.uGainD.value = gD; U.uGainS.value = gS; U.uGainN.value = gN; U.uStorm.value = storm; U.uNight.value = nightF; U.uSunset.value = sunset;
  U.uSunVis.value = sunVis; U.uTime.value = T; U.uAurora.value = s.aurora || 1;
  // туман = среднее по азимуту неба у горизонта (та же смесь панорам и тот же закатный тон)
  const tw = Math.min(1, sunset * .85); _tint.setRGB(lerp(1, 1.45, tw), lerp(1, .82, tw), lerp(1, .52, tw));
  if (st.day) {
    _c.copy(st.day.hor).multiplyScalar(gD).multiply(_tint); _d.copy(st.storm.hor).multiplyScalar(gS); _c.lerp(_d, storm);
    _n.copy(st.night.hor).multiplyScalar(gN); _c.lerp(_n, nightF); LOOK.fogCol.copy(_c);
    // рассеянный свет неба (косинус-взвешенная яркость; ореол солнца добавляет ~25% днём)
    _c.copy(st.day.sky).multiplyScalar(gD * (1 + .25 * sunVis)).multiply(_tint); _d.copy(st.storm.sky).multiplyScalar(gS); _c.lerp(_d, storm);
    _n.copy(st.night.sky).multiplyScalar(gN); _c.lerp(_n, nightF); LOOK.amb.copy(_c);
    U.uNGnd.value.copy(st.night.hor).multiplyScalar(gN * .8);
  }
  U.uFog.value.copy(LOOK.fogCol);
  const sc = CTX.scene; sc.fog.color.copy(LOOK.fogCol); sc.fog.density = lerp(CFG.fogDay, CFG.fogNight, nightF) * (1 + storm * 2.4);
  // солнце / луна
  let sunI = 0;
  if (el > -.02) { sun.position.copy(focus).addScaledVector(sd, 220); const w = sst(0, .3, el);
    sun.color.setRGB(1, lerp(.62, .95, w), lerp(.4, .88, w)); sunI = PANO.day.Esun * K * sst(-.02, .12, el) * lerp(.55, 1, sst(0, .35, el)) * (1 - storm * .85); sun.intensity = sunI }
  else { sun.position.copy(focus).addScaledVector(md, 220); sun.color.setRGB(.6, .7, 1); sun.intensity = CFG.moonI * nightF * (1 - storm * .7) }
  sun.target.position.copy(focus); U.uSunCol.value.copy(sun.color).multiplyScalar(Math.max(sunI, 0) * 40);
  if (LOOK.hemi) LOOK.hemi.intensity = 0;
  // экспозиция: частичная адаптация к освещённости горизонтальной поверхности
  const Eh = PI * (LOOK.amb.r * .3 + LOOK.amb.g * .59 + LOOK.amb.b * .11) + sun.intensity * Math.max(el > -.02 ? sd.y : md.y, 0);
  const Eref = PI * .24 + PANO.day.Esun * Math.sin(.42);
  const eD = CFG.expoDay * Math.pow(Eref / Math.max(Eh, 1e-3), CFG.expoAdapt);
  CTX.renderer.toneMappingExposure = lerp(CFG.expoNight, Math.min(eD, 2.2), dayK);
  // горы и облака — тот же свет
  if (HZ) { HZ.uFog.value.copy(LOOK.fogCol); HZ.uLight.value.copy(sun.position).sub(sun.target.position).normalize();
    HZ.uLCol.value.copy(sun.color).multiplyScalar(sun.intensity / PI); HZ.uAmb.value.copy(LOOK.amb); HZ.uNight.value = nightF; HZ.uT.value = T; HZ.uStorm.value = storm }
  // пере-захват окружения, когда небо заметно изменилось
  const L = LOOK.last, dv = L.sd ? L.sd.distanceTo(sd) : 9;
  if (s.force || dv > .035 || Math.abs((L.n ?? 9) - nightF) > .04 || Math.abs((L.s ?? 9) - storm) > .05 || Math.abs((L.ss ?? 9) - sunset) > .06) {
    L.sd = sd.clone(); L.n = nightF; L.s = storm; L.ss = sunset; captureEnv() }
  LOOK.frame++;
  aoTick(s.dt || 0);
}

/* ---------- горы и облако: шейдеры (освещение = солнце + небо, воздушная перспектива к туману) ---------- */
export const MOUNT_FS = GLN => `uniform vec3 uFog,uLight,uLCol,uAmb;uniform float uStorm,uNight;varying vec3 vW;varying vec3 vN;varying float vL;${GLN}
 void main(){vec3 n=normalize(vN);vec3 dv=vW-cameraPosition;float dist=length(dv);vec3 V=-dv/dist;
  float nz=fb(vW.xz*.006+vL*7.),fine=vn(vW.xz*.05);float snowLine=18.+vL*32.+(nz-.5)*90.;
  float snow=smoothstep(.5,.78,n.y+(fine-.5)*.3)*smoothstep(snowLine-10.,snowLine+30.,vW.y);
  float gully=vn(vec2(atan(vW.z,vW.x)*(520.+vL*200.),vW.y*.025+nz));
  snow=clamp(max(snow,smoothstep(.55,.85,gully)*smoothstep(.1,.45,n.y)*smoothstep(snowLine,snowLine+80.,vW.y)*.9),0.,1.);
  vec3 rock=vec3(.085,.09,.1)*(.55+.9*nz);vec3 alb=mix(rock,vec3(.74,.77,.83),snow);
  float dif=max(dot(n,uLight),0.);float skyV=.3+.7*clamp(n.y*.5+.5,0.,1.);
  float cav=.55+.45*smoothstep(.2,.8,fine);                       // складки и промоины темнее
  vec3 col=alb*(uAmb*.75*skyV*cav+uLCol*dif*(.7+.3*cav));
  float ap=1.-exp(-dist*(.00036+vL*.00006));ap*=mix(1.,.72,smoothstep(20.,320.,vW.y));
  ap=clamp(ap+exp(-max(vW.y,0.)/45.)*.3,0.,.93);ap=mix(ap,.97,uStorm);
  vec3 fc=uFog*(1.+.5*pow(max(dot(-V,uLight),0.),8.)*(1.-uNight));
  gl_FragColor=vec4(mix(col,fc,ap),1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;
export const CLOUD_FS = GLN => `uniform float uT,uStorm,uNight;uniform vec3 uFog,uLight,uLCol,uAmb;varying vec3 vW;${GLN}
 void main(){vec2 p=vW.xz*.0011+vec2(.8,.3)*uT*.004;float n=fb(p)*.65+fb(p*2.7+5.)*.35;float cov=mix(.58,.36,uStorm);
  float d=smoothstep(cov,cov+.2,n);float edge=1.-smoothstep(1500.,2250.,length(vW.xz));vec3 V=normalize(vW-cameraPosition);
  float thick=smoothstep(cov+.05,cov+.4,n);
  vec3 lit=.85*(uAmb*1.15+uLCol*(.35+.9*pow(max(dot(V,uLight),0.),4.)*(1.-thick*.7)));   // нижняя сторона: небо + просвет солнца
  vec3 col=lit*mix(1.,.55,thick);
  col=mix(col,uFog,smoothstep(.35,.05,V.y));
  gl_FragColor=vec4(col,d*edge*mix(.85,.5,uNight));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;

/* ---------- экранное затенение (по глубине, 16 выборок, затухает с расстоянием), выключаемое ---------- */
const AO_FS = `uniform sampler2D tDiffuse,tDepth;uniform mat4 uPInv,uP;uniform vec2 uRes;uniform float uRad,uInt,uOn;varying vec2 vUv;
 vec3 vpos(vec2 uv){float d=texture2D(tDepth,uv).x;vec4 v=uPInv*vec4(uv*2.-1.,d*2.-1.,1.);return v.xyz/v.w;}
 float h12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
 void main(){vec4 col=texture2D(tDiffuse,vUv);float d=texture2D(tDepth,vUv).x;
  if(uOn<.5||d>=.9999){gl_FragColor=col;return;}
  vec3 P=vpos(vUv);vec3 N=normalize(cross(dFdx(P),dFdy(P)));if(dot(N,P)>0.)N=-N;
  float z=-P.z;vec2 rs=vec2(uRad*uP[0][0],uRad*uP[1][1])/z*.5;
  float a0=h12(vUv*uRes)*6.2832,occ=0.;
  for(int i=0;i<16;i++){float fi=float(i);float r=(fi+.5)/16.;r=r*r*.85+.15;float a=a0+fi*2.39996;
   vec3 S=vpos(vUv+vec2(cos(a),sin(a))*r*rs);vec3 v=S-P;float l=length(v)+1e-4;
   occ+=max(0.,dot(v,N)/l-.12)*(1.-smoothstep(uRad*.6,uRad*1.6,l));}
  occ/=16.;float ao=clamp(1.-occ*uInt,0.,1.);ao=mix(ao,1.,smoothstep(45.,90.,z));
  gl_FragColor=vec4(col.rgb*ao,col.a);}`;
export function addAO(composer, scene, camera, renderer) {
  try {
    const q = new URLSearchParams(location.search); if (q.has('noao')) LOOK.aoOn = false;
    composer.renderTarget1.depthTexture = new THREE.DepthTexture(); composer.renderTarget2.depthTexture = new THREE.DepthTexture();
    const ao = new ShaderPass({uniforms: {tDiffuse: {value: null}, tDepth: {value: null}, uPInv: {value: new THREE.Matrix4()}, uP: {value: new THREE.Matrix4()}, uRes: {value: new THREE.Vector2(1, 1)},
      uRad: {value: 1.1}, uInt: {value: 1.6}, uOn: {value: 1}},
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}', fragmentShader: AO_FS});
    const rr = ao.render.bind(ao);
    ao.render = (r, wb, rb, dt, mk) => { const u = ao.uniforms; u.tDepth.value = rb.depthTexture; u.uPInv.value.copy(camera.projectionMatrixInverse); u.uP.value.copy(camera.projectionMatrix);
      u.uRes.value.set(rb.width, rb.height); u.uOn.value = LOOK.aoOn ? 1 : 0; rr(r, wb, rb, dt, mk) };
    composer.addPass(ao); LOOK.ao = ao; return ao
  } catch (e) { console.warn('ao off', e); return null }
}
let aoAcc = 0, aoN = 0;
function aoTick(dt) {   // слабое устройство: средний кадр > 33 мс в течение ~4 с → выключить AO
  if (!LOOK.ao || !LOOK.aoOn || /_test/.test(location.pathname) || !dt) return;
  aoAcc += dt; aoN++; if (aoAcc > 4) { if (aoAcc / aoN > 1 / 30) { LOOK.aoOn = false; console.log('LOOK: AO off (slow frame ' + (aoAcc / aoN * 1000 | 0) + ' ms)') } aoAcc = 0; aoN = 0 }
}
export function setAO(on) { LOOK.aoOn = on }

/* ---------- снег на моделях: только пологие верхние широкие поверхности, шумовая маска ---------- */
const WOOD_FIX = {'03___Default': 0x5e3a22};   // избa house3: красно-розовые брёвна → коричневое дерево (hue ~25°)
const snowCache = new Map();
export function snowify(root, amt) {
  root.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(root); const y0 = box.min.y, hh = Math.max(1e-3, box.max.y - box.min.y);
  const v = new V3();
  root.traverse(m => { if (!m.isMesh) return; const g = m.geometry;
    if (!g.attributes.aSnowH) { const pa = g.attributes.position, a = new Float32Array(pa.count);
      if (m.isSkinnedMesh) a.fill(1); else for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i).applyMatrix4(m.matrixWorld); a[i] = (v.y - y0) / hh }
      g.setAttribute('aSnowH', new THREE.BufferAttribute(a, 1)) }
    const cv = mt => { const k = mt.uuid + '|' + amt; if (snowCache.has(k)) return snowCache.get(k); const n = mt.clone();
      if (WOOD_FIX[mt.name] !== undefined && n.color) n.color.setHex(WOOD_FIX[mt.name]);
      const sc = CFG.snowCol.map(x => x.toFixed(3)).join(',');
      n.onBeforeCompile = sh => {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aSnowH;varying float vSnowH;varying vec3 vSWP;')
          .replace('#include <fog_vertex>', `#include <fog_vertex>
            vec4 swp=vec4(transformed,1.);
            #ifdef USE_INSTANCING
              swp=instanceMatrix*swp;
            #endif
            vSWP=(modelMatrix*swp).xyz;vSnowH=aSnowH;`);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
            varying float vSnowH;varying vec3 vSWP;
            float snh(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);vec4 h=fract(sin(vec4(dot(i,vec2(127.1,311.7)),dot(i+vec2(1.,0.),vec2(127.1,311.7)),dot(i+vec2(0.,1.),vec2(127.1,311.7)),dot(i+1.,vec2(127.1,311.7))))*43758.5453);return mix(mix(h.x,h.y,f.x),mix(h.z,h.w,f.x),f.y);}`)
          .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
            {vec3 wn=inverseTransformDirection(normal,viewMatrix);
             vec3 gn=normalize(cross(dFdx(vSWP),dFdy(vSWP)));if(dot(gn,wn)<0.)gn=-gn;
             float curv=length(fwidth(wn))/max(length(fwidth(vSWP)),1e-4);      // кривизна 1/м: брёвна круглые → без снега
             float flatK=1.-smoothstep(1.2,3.,curv);
             float up=smoothstep(.42,.68,min(wn.y,gn.y+.08));
             float hm=smoothstep(.22,.4,vSnowH);
             float nz=snh(vSWP.xz*1.3)*.65+snh(vSWP.xz*5.1)*.35;
             float cover=up*flatK*hm*${amt.toFixed(2)};
             float sn=smoothstep(.36,.46,cover*(.8+.45*nz));
             diffuseColor.rgb=mix(diffuseColor.rgb,vec3(${sc})*(.93+.07*nz),sn);
             #ifdef STANDARD
               roughnessFactor=mix(roughnessFactor,.82,sn);metalnessFactor=mix(metalnessFactor,0.,sn);
             #endif
            }`) };
      n.customProgramCacheKey = () => 'snow2' + amt.toFixed(2); snowCache.set(k, n); return n };
    m.material = Array.isArray(m.material) ? m.material.map(cv) : cv(m.material) });
}

/* ---------- дорога: укатанная колея (цвет + нормали + шероховатость) ---------- */
function cvs(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c }
function rnd(s) { return () => { s = (s * 16807) % 2147483647; return s / 2147483647 } }
function roadTex(asph, renderer) {
  const W = 128, H = 512, r = rnd(asph ? 7 : 3);
  const hgt = new Float32Array(W * H), col = cvs(W, H), x = col.getContext('2d');
  // профиль поперёк: бровки (снег), укатанное полотно, две колеи
  const prof = u => { const berm = sst(.1, 0, u) + sst(.9, 1, u); const rut = asph ? 0 : Math.exp(-(((u - .3) / .065) ** 2)) + Math.exp(-(((u - .7) / .065) ** 2)); return {berm, rut} };
  const img = x.createImageData(W, H), d = img.data;
  const streak = new Float32Array(W); for (let i = 0; i < W; i++) streak[i] = r();
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const u = (i + .5) / W, {berm, rut} = prof(u); const k = j * W + i;
    const sN = (streak[i] * .6 + streak[(i + 1) % W] * .4) - .5;       // продольные следы шин
    const n = r() - .5;
    let R, G, B;
    if (asph) { const v = .36 + n * .05 + sN * .04; R = v; G = v * 1.01; B = v * 1.05 }
    else { const pack = .7 + n * .04 + sN * .06; R = pack * .96; G = pack * .93; B = pack * .88;
      const rc = [.42 + sN * .08 + n * .04, .37 + sN * .07 + n * .04, .32 + sN * .06 + n * .03]; R = lerp(R, rc[0], rut * .85); G = lerp(G, rc[1], rut * .85); B = lerp(B, rc[2], rut * .85) }
    const sn = .86 + n * .03; R = lerp(R, sn * .97, berm); G = lerp(G, sn * .98, berm); B = lerp(B, sn, berm);
    d[k * 4] = Math.min(255, R * 255); d[k * 4 + 1] = Math.min(255, G * 255); d[k * 4 + 2] = Math.min(255, B * 255); d[k * 4 + 3] = 255;
    hgt[k] = berm * .25 - rut * .45 + sN * .12 + n * .05 }
  x.putImageData(img, 0, 0);
  if (asph) { x.fillStyle = 'rgba(230,226,215,.85)'; for (let j = 0; j < H; j += 64) x.fillRect(W * .49, j, W * .02, 32) }
  // карта нормалей и шероховатости из высот
  const nc = cvs(W, H), nx = nc.getContext('2d'), ni = nx.createImageData(W, H), nd = ni.data;
  const rc2 = cvs(W, H), rx = rc2.getContext('2d'), ri = rx.createImageData(W, H), rd = ri.data;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i, hx = hgt[j * W + (i + 1) % W] - hgt[j * W + (i - 1 + W) % W], hy = hgt[((j + 1) % H) * W + i] - hgt[((j - 1 + H) % H) * W + i];
    const s = 2.2, vx = -hx * s, vy = -hy * s, l = Math.hypot(vx, vy, 1); nd[k * 4] = (vx / l * .5 + .5) * 255; nd[k * 4 + 1] = (vy / l * .5 + .5) * 255; nd[k * 4 + 2] = (1 / l * .5 + .5) * 255; nd[k * 4 + 3] = 255;
    const {berm, rut} = prof((i + .5) / W); const ro = asph ? .75 : lerp(lerp(.9, .42, rut), .95, berm); rd[k * 4] = rd[k * 4 + 1] = rd[k * 4 + 2] = ro * 255; rd[k * 4 + 3] = 255 }
  nx.putImageData(ni, 0, 0); rx.putImageData(ri, 0, 0);
  const an = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const T = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = an; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t };
  return {map: T(col, 1), normalMap: T(nc), roughnessMap: T(rc2)};
}
const RT = {};
export function roadMat(asph, renderer, extra = {}) {
  const k = asph ? 'a' : 'd'; if (!RT[k]) RT[k] = roadTex(asph, renderer);
  return new THREE.MeshStandardMaterial(Object.assign({map: RT[k].map, normalMap: RT[k].normalMap, roughnessMap: RT[k].roughnessMap, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(1, 1)}, extra));
}

/* ---------- ВОРОТА: измерения по пикселям итогового кадра ---------- */
function grab(renderer) {
  const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return {px, w, h};
}
const Y = (r, g, b) => (.2126 * r + .7152 * g + .0722 * b) / 255;
function frameStats(g) { let s = 0, s2 = 0, over = 0, n = 0; const {px} = g;
  for (let k = 0; k < px.length; k += 16) { const y = Y(px[k], px[k + 1], px[k + 2]); s += y; s2 += y * y; if (y > .97) over++; n++ }
  const m = s / n; return {mean: m, sd: Math.sqrt(Math.max(0, s2 / n - m * m)), over: over / n} }
function hue(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (d < 1e-4) return {h: 0, s: 0};
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; const l = (mx + mn) / 2; return {h, s: d / (1 - Math.abs(2 * l - 1))} }

// c: {renderer, camera, scene, render(), setTime(t), terrainH, player, updateForest}
export function gate(c) {
  const {renderer, camera} = c; const out = {}; const save = {p: c.player.pos.clone(), cp: camera.position.clone(), cq: camera.quaternion.clone(), fov: camera.fov, t: c.getTime()};
  const view = (px, pz, tx, tz, dy = 2.85, ty = 1.6) => { const y = c.terrainH(px, pz), yt = c.terrainH(tx, tz); c.player.pos.set(tx, yt, tz);
    camera.position.set(px, y + dy, pz); camera.lookAt(tx, yt + ty, tz); camera.updateMatrixWorld(); c.updateForest && c.updateForest() };
  const shot = t => { c.setTime(t); c.render(); c.render(); return grab(renderer) };
  try {
    view(-126.9, 41, -120, 41); const d1 = frameStats(shot(11.5));
    view(70, -81.1, 70, -88); const d2 = frameStats(shot(13));
    view(-126.9, 41, -120, 41); const n1 = frameStats(shot(23));
    out.dayMean = Math.min(d1.mean, d2.mean); out.dayMeanMax = Math.max(d1.mean, d2.mean); out.dayOver = Math.max(d1.over, d2.over); out.daySD = Math.min(d1.sd, d2.sd); out.nightMean = n1.mean;
    out.views = {street: d1, temple: d2, night: n1};
    // тон брёвен избы (house3 у (-70,58)): медиана оттенка насыщенных пикселей в центре кадра
    view(-70, 47.5, -70, 58, 1.7, 1.9); let g = shot(12); { const hs = []; const {px, w, h} = g;
      for (let j = (h * .38) | 0; j < h * .62; j += 2) for (let i = (w * .4) | 0; i < w * .6; i += 2) { const k = (j * w + i) * 4, q = hue(px[k], px[k + 1], px[k + 2]); if (q.s > .18) hs.push(q.h > 300 ? q.h - 360 : q.h) }
      hs.sort((a, b) => a - b); out.logHue = hs.length ? hs[hs.length >> 1] : -1; out.logN = hs.length }
    // туман против неба у горизонта: зонд далеко (≥900 м, туман ≈1) против неба за ним, 4 азимута, днём
    const probe = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({color: 0x808080})); probe.userData.noAO = 1;
    let worst = 0; const hideHZ = c.scene.children.filter(o => o.renderOrder <= -4 && o.visible); hideHZ.forEach(o => o.visible = false);
    for (let a = 0; a < 4; a++) { const ang = a * PI / 2 + .3, cx = -60, cz = 40, cy = c.terrainH(cx, cz) + 30;
      camera.position.set(cx, cy, cz); const dir = new V3(Math.cos(ang), Math.tan(2.2 * PI / 180), Math.sin(ang)).normalize(); camera.lookAt(camera.position.clone().add(dir)); camera.updateMatrixWorld();
      probe.position.copy(camera.position).addScaledVector(dir, 950); probe.lookAt(camera.position); probe.scale.setScalar(300);
      c.scene.add(probe); let g1 = shot(11.5); c.scene.remove(probe); let g2 = shot(11.5);
      const k = ((g1.h >> 1) * g1.w + (g1.w >> 1)) * 4; const dd = Math.max(Math.abs(g1.px[k] - g2.px[k]), Math.abs(g1.px[k + 1] - g2.px[k + 1]), Math.abs(g1.px[k + 2] - g2.px[k + 2])) / 255; worst = Math.max(worst, dd) }
    hideHZ.forEach(o => o.visible = true); out.fogSky = worst;
  } finally { c.player.pos.copy(save.p); camera.position.copy(save.cp); camera.quaternion.copy(save.cq); c.setTime(save.t); }
  const f = (x, d = 3) => +x.toFixed(d);
  const G = [
    ['look_day_mean', f(out.dayMean), '0.45..0.65 (min улица/храм)', out.dayMean >= .45 && out.dayMeanMax <= .65, 'max=' + f(out.dayMeanMax)],
    ['look_day_overexp', f(out.dayOver, 4), '<=0.03 доля Y>0.97', out.dayOver <= .03],
    ['look_day_contrast_sd', f(out.daySD), '>=0.12', out.daySD >= .12],
    ['look_night_mean', f(out.nightMean), '0.08..0.20', out.nightMean >= .08 && out.nightMean <= .2],
    ['look_log_hue_deg', f(out.logHue, 1), '15..40°', out.logHue >= 15 && out.logHue <= 40, 'n=' + out.logN],
    ['look_fog_vs_sky', f(out.fogSky), '<=0.05 (макс. канал, 4 азимута)', out.fogSky <= .05],
  ];
  const lines = G.map(g => `GATE ${g[0]} ${g[1]} ${g[2]} ${g[3] ? 'OK' : 'FAIL'}${g[4] ? ' ' + g[4] : ''}`);
  window.__gates = (window.__gates || []).concat(lines); lines.forEach(l => console.log(l));
  return out;
}
