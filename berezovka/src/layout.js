// Берёзовка — расстановка (принцип наименьшего действия), вариации без повторов, облегчение сцены.
// Модуль получает всё нужное из index.html через ctx (C), своих глобалов не трогает.
import * as THREE from 'three';

const V3=THREE.Vector3, PI=Math.PI, TAU=PI*2;
function mulberry(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
let rnd=mulberry(90210);const R=(a,b)=>a+(b-a)*rnd();
const sstep=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t)};
const _m=new THREE.Matrix4(),_q=new THREE.Quaternion(),_e=new THREE.Euler(),_v=new V3(),_s=new V3(),_c=new THREE.Color();

export const REG={houses:[],rows:[],pts:[],birch:[],paths:0,apts:[]};
let C=null;
const P=(x,z)=>REG.pts.push([x,z]);

/* ---------- геометрия дворов: локальная система дома (+z = к дороге) ---------- */
const wl=(h,lx,lz)=>{const c=Math.cos(h.r),s=Math.sin(h.r);return[h.x+lx*c+lz*s,h.z-lx*s+lz*c]};
function nearestRoad(x,z,ROADS){let b=null,bd=1e18;for(const r of ROADS){const p=r.p;for(let i=0;i<p.length-1;i++){const ax=p[i].x,az=p[i].z,vx=p[i+1].x-ax,vz=p[i+1].z-az;
  let t=((x-ax)*vx+(z-az)*vz)/(vx*vx+vz*vz||1);t=Math.max(0,Math.min(1,t));const qx=ax+vx*t,qz=az+vz*t,d=(qx-x)**2+(qz-z)**2;if(d<bd){bd=d;b={x:qx,z:qz,w:r.w,asph:r.asph}}}}
  b.d=Math.sqrt(bd);return b}

// План: вызывается при инициализации модуля (до постройки рельефа) — считает положения/повороты домов и зоны выравнивания.
export function plan(c){const {HOUSES,ZONES,ROADS}=c;
  HOUSES.forEach(h=>{
    if(h.z===undefined){const n=nearestRoad(h.x,41,ROADS);h.z=n.z+h.side*17.5}
    const n=nearestRoad(h.x,h.z,ROADS);h.r=Math.atan2(n.x-h.x,n.z-h.z);h.rd=n.d;h.rw=n.w;
    h.F=Math.min(10,h.rd-n.w/2-2.4);h.B=h.B||17;h.xl=h.xl??-9;h.xr=h.xr??9;
    const [cx,cz]=wl(h,(h.xl+h.xr)/2,(h.F-h.B)/2);ZONES.push({x:cx,z:cz,r:Math.max(h.xr-h.xl,h.F+h.B)/2});
  })}

/* ---------- заборы: штакетник/жерди, инстансы с разбросом ---------- */
const FEN={pick:[],pickC:[],rail:[],railC:[],post:[],postC:[],snow:[]};
const WOOD=[0x7b7266,0x8a8173,0x6f675d,0x938877,0x7f776b,0x85796a],PAINT=[0x5e7a5c,0x5b7390,0x6d8a70,0x56708a];
let styleN=0;
function fenceStyle(){const painted=(styleN++%3===2);return{col:painted?PAINT[(styleN>>1)%PAINT.length]:WOOD[(styleN*5)%WOOD.length],h:R(1.02,1.34),sp:R(.17,.24),lean:R(.015,.07),miss:R(.02,.07),painted}}
const DEF_STYLE={col:0x7d7468,h:1.25,sp:.2,lean:.03,miss:.03};
function jit(col,a=.1){_c.setHex(col);const k=1+(rnd()-.5)*2*a;return _c.clone().multiplyScalar(k)}
function quat(yaw,lean,tilt){_e.set(lean,yaw,tilt,'YXZ');return new THREE.Quaternion().setFromEuler(_e)}
// o: {st, rails:true -> жерди без штакетин, solid -> глухие ворота, noCol, noPosts}
export const CHURCH={col:0x55695a,h:1.45,sp:.15,lean:.008,miss:0};
export function varyM(w,i){if(w)vary(w,{mirror:i%2===1,tint:TINTS[i%3]})}
export function fence(x1,z1,x2,z2,o={}){
  const dx=x2-x1,dz=z2-z1,Ln=Math.hypot(dx,dz);if(Ln<.15)return;
  const st=o.st||DEF_STYLE,H=o.h||st.h,ang=Math.atan2(dz,dx),yaw=-ang;
  const nS=Math.max(1,Math.round(Ln/2.4)),sl=Ln/nS;
  for(let i=0;i<=nS;i++){if(o.noPosts&&(i===0||i===nS))continue;const t=i/nS,x=x1+dx*t,z=z1+dz*t,y=C.terrainH(x,z),ph=H+(o.rails?.05:.12);
    FEN.post.push(new THREE.Matrix4().compose(new V3(x,y+ph/2-.12,z),quat(yaw+R(-.2,.2),R(-.04,.04),R(-.04,.04)),new V3(o.solid?1.5:1,ph,o.solid?1.5:1)));FEN.postC.push(jit(st.col,.15).multiplyScalar(.8));P(x,z)}
  for(let i=0;i<nS;i++){const ax=x1+dx*i/nS,az=z1+dz*i/nS,bx=x1+dx*(i+1)/nS,bz=z1+dz*(i+1)/nS,ya=C.terrainH(ax,az),yb=C.terrainH(bx,bz);
    const lean=(rnd()-.5)*2*st.lean*(o.solid?.3:1),tilt=Math.atan2(yb-ya,sl),q=quat(yaw,lean,tilt),mx=(ax+bx)/2,mz=(az+bz)/2,my=(ya+yb)/2;
    const up=new V3(0,1,0).applyQuaternion(q);
    const railH=o.rails?[.35,.75,H-.05]:[.28,H-.26];
    railH.forEach((rh,k)=>{const p=new V3(mx,my,mz).addScaledVector(up,rh);FEN.rail.push(new THREE.Matrix4().compose(p,q,new V3(sl*1.02,o.rails?1.3:1,o.rails?1.6:1)));FEN.railC.push(jit(st.col,.12).multiplyScalar(o.rails?.85:.92));
      if(k===railH.length-1&&rnd()<.85){const ps=p.clone().addScaledVector(up,.06);FEN.snow.push(new THREE.Matrix4().compose(ps,q,new V3(sl*R(.5,1),1,1)))}});
    if(o.rails)continue;
    const sp=o.solid?.125:st.sp,nP=Math.max(1,Math.floor(sl/sp));
    for(let k=0;k<nP;k++){if(!o.solid&&rnd()<st.miss)continue;const t=(k+.5)/nP,px=ax+(bx-ax)*t,pz=az+(bz-az)*t,py=C.terrainH(px,pz)-.12;
      let hh=(H+.1)*(o.solid?1:R(.96,1.04));if(!o.solid&&rnd()<.03)hh*=R(.45,.7);
      const qq=quat(yaw,lean+R(-.035,.035),R(-.03,.03)),base=new V3(px,py,pz).addScaledVector(new V3(0,0,1).applyQuaternion(q),.03);
      FEN.pick.push(new THREE.Matrix4().compose(base,qq,new V3(o.solid?1.45:1,hh,1)));FEN.pickC.push(jit(st.col,.09))}
    if(!o.solid&&rnd()<st.miss*1.5){const px=mx+R(-1,1),pz=mz+R(-1,1)+.5;FEN.pick.push(new THREE.Matrix4().compose(new V3(px,C.terrainH(px,pz)+.02,pz),quat(R(0,TAU),PI/2,0),new V3(1,H*.9,1)));FEN.pickC.push(jit(st.col,.1))}
  }
  if(!o.noCol)C.addBox((x1+x2)/2,(z1+z2)/2,Ln/2,.12,-ang);
}
function picketGeo(){const w=.085,s=new THREE.Shape();s.moveTo(-w/2,0);s.lineTo(w/2,0);s.lineTo(w/2,.93);s.lineTo(0,1);s.lineTo(-w/2,.93);s.closePath();
  const g=new THREE.ExtrudeGeometry(s,{depth:.022,bevelEnabled:false});g.translate(0,0,-.011);return g}
function instList(geo,mat,ms,cols,shadow=true){if(!ms.length)return null;const im=new THREE.InstancedMesh(geo,mat,ms.length);ms.forEach((m,i)=>{im.setMatrixAt(i,m);if(cols)im.setColorAt(i,cols[i])});
  im.castShadow=shadow;im.receiveShadow=true;im.computeBoundingSphere();C.scene.add(im);return im}
export function flushFences(){
  const wm=C.reg(new THREE.MeshStandardMaterial({color:0xffffff,roughness:.95,flatShading:true}));const hold=new THREE.Group();
  const a=instList(picketGeo(),wm,FEN.pick,FEN.pickC),b=instList(new THREE.BoxGeometry(1,.085,.03),wm,FEN.rail,FEN.railC),c=instList(new THREE.BoxGeometry(.1,1,.1),wm,FEN.post,FEN.postC);
  [a,b,c].forEach(m=>{if(m)hold.add(m)});C.snowify(hold,.55);[a,b,c].forEach(m=>{if(m)C.scene.add(m)});
  instList(new THREE.BoxGeometry(1,.05,.1),C.reg(new THREE.MeshStandardMaterial({color:0xf2f5fa,roughness:.8})),FEN.snow,null,false);
  for(const k in FEN)FEN[k].length=0}

/* ---------- тропинки и колеи: ленты по рельефу ---------- */
const RIB={path:[],rut:[]};
function ribbon(list,pts,w,lift){const out=[];for(let i=0;i<pts.length-1;i++){const [ax,az]=pts[i],[bx,bz]=pts[i+1],L=Math.hypot(bx-ax,bz-az),n=Math.max(1,Math.ceil(L/.9));
    for(let k=(i?1:0);k<=n;k++){const t=k/n;out.push([ax+(bx-ax)*t,az+(bz-az)*t])}}
  if(out.length<2)return;const pos=[],uv=[],idx=[];let d=0;
  for(let i=0;i<out.length;i++){const a=out[Math.max(0,i-1)],c=out[Math.min(out.length-1,i+1)];let tx=c[0]-a[0],tz=c[1]-a[1];const l=Math.hypot(tx,tz)||1;tx/=l;tz/=l;
    if(i)d+=Math.hypot(out[i][0]-out[i-1][0],out[i][1]-out[i-1][1]);const ww=w*(.85+.3*Math.sin(d*.7+i));
    for(const sd of[-1,1]){const x=out[i][0]-tz*ww/2*sd,z=out[i][1]+tx*ww/2*sd;pos.push(x,C.terrainH(x,z)+lift,z);uv.push((sd+1)/2,d/(w*2.2))}
    if(i){const q=(i-1)*2;idx.push(q,q+2,q+1,q+1,q+2,q+3)}}
  list.push({pos,uv,idx});out.forEach((p,i)=>{if(i%3===0)P(p[0],p[1])})}
function path(pts,w=.95){ribbon(RIB.path,pts,w,.05);REG.paths++}
function ribTex(kind){const c=document.createElement('canvas');c.width=64;c.height=128;const x=c.getContext('2d');
  if(kind==='path'){const g=x.createLinearGradient(0,0,64,0);g.addColorStop(0,'rgba(120,128,146,0)');g.addColorStop(.25,'rgba(120,128,146,.5)');g.addColorStop(.75,'rgba(120,128,146,.5)');g.addColorStop(1,'rgba(120,128,146,0)');x.fillStyle=g;x.fillRect(0,0,64,128);
    for(let i=0;i<14;i++){const px=18+Math.random()*28,py=Math.random()*128;x.fillStyle='rgba(90,98,118,.55)';x.beginPath();x.ellipse(px,py,4,7,Math.random()-.5,0,TAU);x.fill()}}
  else{const g=x.createLinearGradient(0,0,64,0);g.addColorStop(0,'rgba(95,86,76,0)');g.addColorStop(.35,'rgba(95,86,76,.62)');g.addColorStop(.65,'rgba(95,86,76,.62)');g.addColorStop(1,'rgba(95,86,76,0)');x.fillStyle=g;x.fillRect(0,0,64,128);
    for(let i=0;i<40;i++){x.fillStyle='rgba(70,62,55,.35)';x.fillRect(20+Math.random()*24,Math.random()*128,2+Math.random()*4,2)}}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;return t}
function flushRibbons(){[['path',RIB.path,-5],['rut',RIB.rut,-9]].forEach(([k,list,po])=>{if(!list.length)return;const pos=[],uv=[],idx=[];let o=0;
  list.forEach(r=>{pos.push(...r.pos);uv.push(...r.uv);r.idx.forEach(v=>idx.push(v+o));o+=r.pos.length/3});
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();
  const m=new THREE.Mesh(g,C.reg(new THREE.MeshStandardMaterial({map:ribTex(k),transparent:true,depthWrite:false,roughness:1,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:po,polygonOffsetUnits:po})));m.receiveShadow=true;m.renderOrder=1;C.scene.add(m);list.length=0})}
export function ruts(){C.ROADS.forEach(r=>{if(r.asph)return;const p=r.p;[-.82,.82].forEach(off=>{const pts=[];for(let i=0;i<p.length;i++){const a=p[Math.max(0,i-1)],c=p[Math.min(p.length-1,i+1)];let tx=c.x-a.x,tz=c.z-a.z;const l=Math.hypot(tx,tz)||1;
    const o=off+Math.sin(i*.37+off*3)*.12;pts.push([p[i].x-tz/l*o,p[i].z+tx/l*o])}ribbon(RIB.rut,pts,.42,.12)})})}

/* ---------- процедурные мелочи двора (одна общая геометрия с цветами вершин) ---------- */
let BLD=[],FILM=[];
function part(geo,col,lm,wm){const g=geo.index?geo.toNonIndexed():geo;g.applyMatrix4(lm);if(wm)g.applyMatrix4(wm);BLD.push(C.P(g,col))}
const LM=(x,y,z,rx=0,ry=0,rz=0,sx=1,sy=1,sz=1)=>new THREE.Matrix4().compose(new V3(x,y,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,ry,rz)),new V3(sx,sy,sz));
const WM=(x,z,r,dy=0)=>new THREE.Matrix4().compose(new V3(x,C.terrainH(x,z)+dy,z),new THREE.Quaternion().setFromAxisAngle(new V3(0,1,0),r),new V3(1,1,1));
// дровница: поленница под навесом или под снежной шапкой + колода
function woodpile(x,z,r,roof){const wm=WM(x,z,r,-.05);const rows=roof?5:4,n=roof?9:7,len=.55;
  for(let j=0;j<rows;j++)for(let i=0;i<n-(j%2);i++){const px=-n*.13+i*.26+(j%2)*.13,py=.14+j*.23;part(new THREE.CylinderGeometry(.12,.12,len,5),[0x9a7a55,0x8b6c4a,0xa98760,0x7e6245][(i*7+j*3)%4],LM(px,py,0,PI/2,R(-.2,.2),0,1,1,R(.9,1.1)),wm)}
  const top=.14+rows*.23;
  if(roof){[-1,1].forEach(s=>part(new THREE.BoxGeometry(.09,top+.45,.09),0x5a4a3c,LM(s*n*.14,(top+.45)/2,-.35),wm));[-1,1].forEach(s=>part(new THREE.BoxGeometry(.09,top+.2,.09),0x5a4a3c,LM(s*n*.14,(top+.2)/2,.4),wm));
    part(new THREE.BoxGeometry(n*.3+.4,.05,1.25),0x6a6158,LM(0,top+.36,0,-.2),wm);part(new THREE.BoxGeometry(n*.3+.45,.1,1.2),0xeef2f8,LM(0,top+.43,0,-.2),wm)}
  else part(new THREE.BoxGeometry(n*.26,.12,.5),0xeef2f8,LM(0,top-.02,0,0,0,0,1,1,1),wm);
  part(new THREE.CylinderGeometry(.24,.27,.5,7),0x6e5a44,LM(n*.14+.7,.22,.3),wm);part(new THREE.CylinderGeometry(.245,.245,.06,7),0xeef2f8,LM(n*.14+.7,.5,.3),wm);
  C.addBox(x,z,n*.15+.2,.4,r);P(x,z)}
// сарай: доски, односкатная крыша, дверь
function shed(x,z,r,col){const wm=WM(x,z,r,-.1);const w=R(3,3.8),d=R(2.4,3),h=R(2.1,2.4);
  part(new THREE.BoxGeometry(w,h,d),col,LM(0,h/2,0),wm);for(let i=0;i<5;i++)part(new THREE.BoxGeometry(w+.02,.03,d+.02),0x4d4239,LM(0,.35+i*(h-.4)/4,0),wm);
  part(new THREE.BoxGeometry(.9,1.8,.06),0x4a3c30,LM(-w*.2,.95,d/2+.03),wm);part(new THREE.BoxGeometry(w+.6,.12,d+.8),0x5c5650,LM(0,h+.12,0,-.14),wm);part(new THREE.BoxGeometry(w+.6,.16,d+.7),0xeef2f8,LM(0,h+.24,0,-.14),wm);
  C.addBox(x,z,w/2,d/2,r);C.mapShapes.push({x,z,hx:w/2,hz:d/2,rot:r,col:'#5f4a38'});P(x,z)}
function bench(x,z,r,col=0x6b5a48){const wm=WM(x,z,r);[-.7,.7].forEach(s=>part(new THREE.BoxGeometry(.08,.45,.35),0x4a4038,LM(s,.22,0),wm));
  part(new THREE.BoxGeometry(1.7,.06,.38),col,LM(0,.47,0),wm);part(new THREE.BoxGeometry(1.7,.05,.3),0xeef2f8,LM(0,.52,0),wm);part(new THREE.BoxGeometry(1.7,.3,.05),col,LM(0,.75,-.2,-.12),wm);C.addBox(x,z,.85,.25,r);P(x,z)}
// огород: колья рядами + парник
function garden(h,x0,x1,z0,z1,sg){const wm=WM(h.x,h.z,h.r,0);
  for(let lz=z0;lz<z1;lz+=R(1.2,1.6))for(let lx=x0;lx<x1;lx+=R(.7,1)){if(rnd()<.45)continue;const [wx,wz]=wl(h,lx*sg,lz);const hh=R(.3,.9);
    part(new THREE.BoxGeometry(.04,hh,.04),rnd()<.3?0x7a6a55:0x4f4336,LM(0,hh/2-.05,0,R(-.2,.2),0,R(-.2,.2)),WM(wx,wz,0));P(wx,wz)}
  if(rnd()<.75){const [gx,gz]=wl(h,(x0+x1)/2*sg+R(-1,1),(z0+z1)/2),gw=WM(gx,gz,h.r+R(-.1,.1));const L=R(3,4.2),rad=.95;
    for(let i=0;i<=4;i++){const t=new THREE.TorusGeometry(rad,.025,3,9,PI);part(t,0x6a6a66,LM(0,0,-L/2+i*L/4),gw)}
    const film=new THREE.CylinderGeometry(rad,rad,L,9,1,true,-PI/2,PI);film.rotateX(-PI/2);const f=film.toNonIndexed();f.applyMatrix4(gw);FILM.push(C.P(f,0xffffff));
    part(new THREE.CylinderGeometry(rad+.03,rad+.03,L*.9,6,1,true,-PI/5,PI*.4).rotateX(-PI/2),0xf2f5fa,LM(0,0,0),gw);C.addBox(gx,gz,rad,L/2,h.r);P(gx,gz)}}
// гараж-ракушка
function shell(x,z,r,col){const wm=WM(x,z,r,-.05);const L=4.6,rad=1.45;
  part(new THREE.CylinderGeometry(rad,rad,L,10,1,true,-PI/2,PI).rotateX(-PI/2),col,LM(0,0,0,0,0,0,1.05,1,1),wm);
  part(new THREE.CircleGeometry(rad,10,0,PI),col,LM(0,0,-L/2,0,PI,0,1.05,1,1),wm);part(new THREE.CircleGeometry(rad,10,0,PI),jit(col,.1).getHex(),LM(0,0,L/2,0,0,0,1.05,1,1),wm);
  part(new THREE.CylinderGeometry(rad+.02,rad+.02,L*.96,6,1,true,-PI/6,PI/3).rotateX(-PI/2),0xf2f5fa,LM(0,0,0),wm);
  C.addBox(x,z,rad,L/2,r);C.mapShapes.push({x,z,hx:rad,hz:L/2,rot:r,col:'#6a7076'});P(x,z)}
function flushBld(){if(BLD.length){const m=new THREE.Mesh(C.mergeGeos(BLD),C.MAT.vc);m.castShadow=true;m.receiveShadow=true;C.scene.add(m)}
  if(FILM.length){const m=new THREE.Mesh(C.mergeGeos(FILM),C.reg(new THREE.MeshStandardMaterial({color:0xdfe7ec,transparent:true,opacity:.55,roughness:.25,side:THREE.DoubleSide,depthWrite:false})));C.scene.add(m)}
  BLD=[];FILM=[]}

/* ---------- модели: слияние частей, зеркало, оттенок ---------- */
// слить меши модели по материалу (меньше вызовов отрисовки), опц. оттенок
function compact(w,tint){w.updateMatrixWorld(true);const inv=new THREE.Matrix4().copy(w.matrixWorld).invert(),groups=new Map();
  w.userData.src.traverse(m=>{if(!m.isMesh||m.isSkinnedMesh||!m.visible||Array.isArray(m.material))return;const k=m.material.uuid;if(!groups.has(k))groups.set(k,{mat:m.material,list:[]});groups.get(k).list.push(m)});
  const out=[];groups.forEach(({mat,list})=>{const gs=list.map(m=>{let g=m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone();const keep={position:1,normal:1,uv:1};
      Object.keys(g.attributes).forEach(a=>{if(!keep[a])g.deleteAttribute(a)});g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv,m.matrixWorld));return g});
    const hasUV=gs.every(g=>g.attributes.uv);gs.forEach(g=>{if(!hasUV&&g.attributes.uv)g.deleteAttribute('uv');if(!g.attributes.normal)g.computeVertexNormals()});
    let n=0;gs.forEach(g=>n+=g.attributes.position.count);const geo=new THREE.BufferGeometry();['position','normal',...(hasUV?['uv']:[])].forEach(a=>{const sz=a==='uv'?2:3,arr=new Float32Array(n*sz);let o=0;gs.forEach(g=>{arr.set(g.attributes[a].array,o);o+=g.attributes[a].count*sz});geo.setAttribute(a,new THREE.BufferAttribute(arr,sz))});
    let mt=mat;if(tint){mt=mat.clone();mt.onBeforeCompile=mat.onBeforeCompile;mt.customProgramCacheKey=mat.customProgramCacheKey;mt.color=mat.color.clone().multiply(tint);C.reg(mt)}
    const mm=new THREE.Mesh(geo,mt);mm.castShadow=true;mm.receiveShadow=true;out.push(mm)});
  w.remove(w.userData.inner);out.forEach(m=>w.add(m));return w}
function vary(w,{mirror=false,k=1,tint=null}={}){compact(w,tint);w.scale.set(mirror?-k:k,k,k);w.updateMatrixWorld(true);return w}
const HT=['house1','house2','house3'],TINTS=[[1,1,1],[.86,.84,.8],[1.06,1,.93]].map(a=>new THREE.Color(...a));

/* ---------- деревня ---------- */
export function buildVillage(c){C=c;rnd=mulberry(90210);
  const {HOUSES}=c,sides={};
  HOUSES.forEach(h=>{(sides[h.side||(h.z>41?1:-1)]=sides[h.side||(h.z>41?1:-1)]||[]).push(h)});
  Object.entries(sides).forEach(([s,list])=>{list.sort((a,b)=>a.x-b.x);list.forEach((h,i)=>{if(h.v===undefined)h.v=(i+(s>0?0:1))%3;h.mir=h.mir??(i%2===(s>0?1:0));h.ti=(i+(s>0?0:2))%3})});
  HOUSES.forEach((h,i)=>{
    const sg=h.sg||(h.mir?-1:1);          // сторона двора с дровником/сараем
    const name=HT[h.v%3],k=h.fixed?1:R(.93,1.07);
    const w=C.placeM(name,h.x,h.z,h.r,{len:9.5,snow:1,dy:-.25,mapCol:'#7a5230'});
    if(w){vary(w,{mirror:h.mir,k,tint:TINTS[h.ti]});const v=new V3(.18*w.userData.size.x,1.0*w.userData.size.y,-.1*w.userData.size.z);w.localToWorld(v);C.smokeSrc.push(v)}
    const key=name+(h.mir?'m':'')+h.ti;REG.houses.push({h,key,path:0,wood:0});const rec=REG.houses[REG.houses.length-1];
    for(let a=-4;a<=4;a+=4)for(let b=-4;b<=4;b+=4)P(...wl(h,a,b));
    // забор: штакетник спереди и до зада дома, дальше жерди вокруг огорода; калитка + ворота напротив крыльца
    const st=fenceStyle(),F=h.F,B=h.B,xl=h.xl,xr=h.xr,g=0,f=(a,b,cc,d,o={})=>{const [x1,z1]=wl(h,a,b),[x2,z2]=wl(h,cc,d);fence(x1,z1,x2,z2,{st,...o})};
    const gw=h.gateOpen?h.gateOpen:null;
    if(gw){f(xl,F,g-.65,F);f(g+.65,F,gw[0],F);f(gw[1],F,xr,F)}
    else{const v0=g+.75,v1=g+4.05;const [a0,a1]=sg>0?[v0,v1]:[-v1,-v0];
      if(sg>0){f(xl,F,g-.65,F);f(a0,F,a1,F,{solid:1,h:st.h+.3});f(a1,F,xr,F)}else{f(xl,F,a0,F);f(a0,F,a1,F,{solid:1,h:st.h+.3});f(a1,F,g+.65,F);f(g+.65,F,xr,F)}}
    // приоткрытая калитка
    {const hx=g-.62,[x1,z1]=wl(h,hx,F),[x2,z2]=wl(h,hx+Math.cos(1.1)*1.15,F-Math.sin(1.1)*1.15);fence(x1,z1,x2,z2,{st,noCol:1,noPosts:1})}
    f(xl,F,xl,-3);f(xr,F,xr,-3);f(xl,-3,xl,-B,{rails:1});f(xr,-3,xr,-B,{rails:1});f(xl,-B,xr,-B,{rails:1});
    // тропинки: крыльцо → калитка → дорога; крыльцо → дровник → сарай
    const edge=h.rd-h.rw/2+.35;path([wl(h,g,4.6),wl(h,g+R(-.2,.2),F*.6+2),wl(h,g,F),wl(h,g+R(-.3,.3),edge)]);rec.path=1;
    const side=(lx)=>lx*sg;
    if(!h.noWood){const [px,pz]=wl(h,side(-7.4),1.2);woodpile(px,pz,h.r+PI/2*sg,rnd()<.5);rec.wood=1}
    path([wl(h,side(-1.5),4.4),wl(h,side(-5.4),3.4),wl(h,side(-6.3),1.2),wl(h,side(-6.3),-6.5),wl(h,side(-5.2),-8.2)],.8);
    if(!h.noShed){const [sx,sz]=wl(h,side(-5.2),-10.3);if(i%2)shed(sx,sz,h.r,[0x6d5a47,0x5f5245,0x76624c][i%3]);else{const s=C.placeM('banya',sx,sz,h.r+PI,{len:R(4.3,4.9),snow:1,dy:-.2,mapCol:'#5f3f25'});if(s)vary(s,{mirror:!!(i&2),tint:TINTS[(i>>1)%3]})}}
    garden(h,h.gx?h.gx[0]:-1.5,h.gx?h.gx[1]:xr-1.2,-B+1.2,-7,sg);
    // лавочка у калитки, берёза у забора
    const [bx,bz]=wl(h,side(-1.9),F+.75);bench(bx,bz,h.r);
    const bt=rnd()<.6?wl(h,side(xl+1.3),F+1.25):wl(h,side(xl-1.6),-B+2);REG.birch.push(bt);
  });
  // колодец — общий, между дворами
  REG.rows.push(sides[1]||[],sides[-1]||[]);
}
export function villageDone(){ruts();flushRibbons();flushFences();flushBld()}

/* ---------- посёлок: пятиэтажки, дворы, машины, ракушки ---------- */
const CAR_COL=[0xd8d2c4,0x8e2a26,0x2f5f8a,0x4f6b3a,0xc8a64a,0x6b6f75,0x5a2d3c,0x9aa39b];
export function buildTown(c,apts){C=c;rnd=mulberry(4455);
  const APT_T=[[1,1,1],[1.18,1.08,.94],[.95,1.02,1.12],[1.12,.98,.96]].map(a=>new THREE.Color(...a));
  const rows={};apts.forEach(a=>{(rows[a.z>40?1:-1]=rows[a.z>40?1:-1]||[]).push(a)});
  const cars=[];
  Object.entries(rows).forEach(([s,list])=>{list.sort((a,b)=>a.x-b.x);list.forEach((a,i)=>{const mir=i%2===1,ti=(i+(s>0?0:2))%4;if(a.w)vary(a.w,{mirror:mir,tint:APT_T[ti]});a.key='apt'+(mir?'m':'')+ti;
    const sz=a.w?a.w.userData.size:new V3(16,15,10),h={x:a.x,z:a.z,r:a.r},fz=sz.z/2,road=nearestRoad(a.x,a.z,C.ROADS),edge=road.d-road.w/2-.4;
    // подъезды: 2 на дом; к каждому — лавочки и тропинка к тротуару
    [-sz.x/4,sz.x/4].forEach((ex,k)=>{const [b1x,b1z]=wl(h,ex-1.8,fz+1.4),[b2x,b2z]=wl(h,ex+1.8,fz+1.4);bench(b1x,b1z,h.r+PI/2,0x4f7050);if(rnd()<.6)bench(b2x,b2z,h.r-PI/2,0x4f6a7a);
      path([wl(h,ex,fz+.3),wl(h,ex+R(-.3,.3),fz+4),wl(h,ex,edge)],1.1)});
    path([wl(h,-sz.x/2-1,fz+3.2),wl(h,sz.x/2+1,fz+3.2)],1.2);
    // машины у подъезда: поперёк, между подъездами
    const nc=1+(rnd()<.6?1:0)+(rnd()<.3?1:0);for(let k=0;k<nc;k++){const lx=-sz.x/2+2+rnd()*(sz.x-4),lz=fz+6.5+R(-.3,.3);const [cx,cz]=wl(h,lx,lz);if(Math.abs(lx)<1.5)continue;cars.push([cx,cz,h.r+(rnd()<.5?0:PI)+R(-.12,.12)])}
    REG.apts.push(a)});REG.rows.push(list)});
  // ракушки вдоль проезда и у края южного ряда
  const SH=[0x5f7a60,0x8a5a3a,0x8a8f92,0x587a95,0x6f7a52];
  for(let i=0;i<6;i++){if(i===3)continue;shell(144.5,58+i*3.3,PI/2+R(-.05,.05),SH[(i*3)%5])}
  for(let i=0;i<4;i++)shell(279+i*3.3,23,R(-.05,.05),SH[(i*2+1)%5]);
  cars.push([147,76,PI/2+.1],[284,30,.1]);
  instCars(cars);
  flushRibbons();flushBld();
}
function instCars(list){const w=C.model('car',{len:4.1});if(!w||!list.length)return;compact(w);w.updateMatrixWorld(true);const hold=new THREE.Group();
  const ms=list.map(([x,z,r])=>new THREE.Matrix4().compose(new V3(x,C.terrainH(x,z)-.03,z),new THREE.Quaternion().setFromAxisAngle(new V3(0,1,0),r),new V3(1,1,1)));
  w.children.forEach(m=>{if(!m.isMesh)return;let mt=m.material;const body=/Material\.001/.test(mt.name);if(body){mt=mt.clone();mt.color.set(0xffffff);C.reg(mt)}
    const im=new THREE.InstancedMesh(m.geometry,mt,ms.length);ms.forEach((M,i)=>{im.setMatrixAt(i,new THREE.Matrix4().multiplyMatrices(M,m.matrix));if(body)im.setColorAt(i,new THREE.Color(CAR_COL[(i*3)%CAR_COL.length]))});
    im.castShadow=true;im.receiveShadow=true;im.computeBoundingSphere();hold.add(im)});
  C.snowify(hold,.5);[...hold.children].forEach(m=>C.scene.add(m));
  const sz=w.userData.size;list.forEach(([x,z,r])=>{C.addBox(x,z,sz.x/2*.9,sz.z/2*.9,r);C.mapShapes.push({x,z,hx:sz.x/2,hz:sz.z/2,rot:r,col:'#556'})})}

/* ---------- лес: куртины и опушки ---------- */
// плотность леса: крупные массивы + сгущения; подлесок на кромке
export function forestField(fbm){return(x,z)=>{let f=fbm(x*.0065+3.3,z*.0065-1.7,3)+.32*Math.exp(-((x+60)**2+(z-125)**2)/5000)+.12*Math.exp(-((x+195)**2+(z+122)**2)/2500)-.1*Math.exp(-((x-72)**2+(z+122)**2)/1600);return f}}
export function placeForest(c,types,inZone){C=c;rnd=mulberry(777);const F=forestField(c.fbm),T0=.57,cnt=types.map(()=>0),list=[];
  const clump=(x,z)=>sstep(.38,.62,c.fbm(x*.05+9,z*.05-4,2));
  // берёзы у дворов
  REG.birch.forEach(([x,z])=>{if(c.collide({x,z},.8,false))return;const s=R(7,9.5);list.push({x,z,ti:2,v:2,s,sy:s*R(.92,1.1),rot:rnd()*TAU});c.addCirc(x,z,.3);cnt[2]++});
  types.forEach((ty,ti)=>{let tries=0;while(cnt[ti]<ty.c&&tries<ty.c*60){tries++;const a=rnd()*TAU,rr=Math.sqrt(rnd())*480,x=Math.cos(a)*rr,z=Math.sin(a)*rr;
    const f=F(x,z),edge=1-Math.min(1,Math.abs(f-T0)/.05);let p;
    if(ti===0)p=sstep(T0,T0+.07,f)*(.25+.75*clump(x,z));
    else if(ti===1)p=sstep(T0-.02,T0+.05,f)*sstep(.45,.6,c.fbm(x*.02-5,z*.02+8,2));
    else if(ti===2)p=.75*edge+(f<T0?.05:.03);
    else p=.9*edge+(f>T0?.12:.02);
    if(rnd()>p)continue;
    if(c.roadDist(x,z)<4||Math.abs(z-c.riverZ(x))<10)continue;
    if(inZone(x,z))continue;
    if(c.collide({x,z},ti===3?1:2.2,false))continue;
    const small=edge>.3&&ti===0,s=R(ty.h[0],ty.h[1])*(small?.8:1);
    list.push({x,z,ti,v:ti===0?(small||rnd()<.35?1:0):ti===1?0:ti===2?2:-1,s,sy:s*R(.92,1.1),rot:rnd()*TAU});if(ti<3)c.addCirc(x,z,ti===2?.3:.45);cnt[ti]++}});
  return{list,cnt}}
// дальние деревья: части модели сливаются в одну геометрию с цветами вершин (1 вызов отрисовки на породу)
export function farParts(c,name,o,snow){C=c;
  let geo;if(name==='birch')geo=lowBirch();else{const parts=c.partsOf(name,o);if(!parts||!parts.length)return null;
    const gs=parts.map(p=>{const g=p.geo.index?p.geo.toNonIndexed():p.geo.clone();['uv','uv1','uv2','tangent','color'].forEach(a=>g.attributes[a]&&g.deleteAttribute(a));g.applyMatrix4(p.mw);
      const col=[].concat(p.mat)[0].color||new THREE.Color(1,1,1),n=g.attributes.position.count,a=new Float32Array(n*3);for(let i=0;i<n;i++){a[i*3]=col.r;a[i*3+1]=col.g;a[i*3+2]=col.b}g.setAttribute('color',new THREE.BufferAttribute(a,3));return g});
    geo=c.mergeGeos(gs)}
  const mat=c.reg(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9}));const mm=new THREE.Mesh(geo,mat);if(snow)c.snowify(mm,snow);
  return[{geo,mat:mm.material,mw:new THREE.Matrix4()}]}
// лёгкая дальняя берёза (~70 треуг.): белый ствол, тёмные ветви
function lowBirch(){const L=[];const add=(g,col,m)=>{const q=g.toNonIndexed();q.applyMatrix4(m);L.push(C.P(q,col))};
  add(new THREE.CylinderGeometry(.01,.026,1,5),0xe9e6de,LM(0,.5,0));
  // тонкие ветви вверх-наружу: силуэт «метлы», без шара-кроны
  for(let i=0;i<8;i++){const a=i*2.4,y=.42+i*.055,l=.34-i*.02,t=.45+.1*(i%3);const g=new THREE.CylinderGeometry(.002,.007,l,3);g.translate(0,l/2,0);
    const m=new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationZ(t));m.setPosition(0,y,0);add(g,i%2?0x5b514a:0x4a413b,m)}
  return C.mergeGeos(L)}

/* ---------- мелочь на земле: тайлы, видимость по расстоянию ---------- */
const TILES=[];const TILE=64;
export function tiled(c,parts,list,maxD){C=c;const buckets=new Map();
  list.forEach(M=>{_v.setFromMatrixPosition(M);const k=Math.floor(_v.x/TILE)+':'+Math.floor(_v.z/TILE);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(M)});
  buckets.forEach((ms,k)=>{const [i,j]=k.split(':').map(Number);const t={x:(i+.5)*TILE,z:(j+.5)*TILE,d:maxD+TILE*.72,m:[]};
    parts.forEach(p=>{const im=new THREE.InstancedMesh(p.geo,p.mat,ms.length);ms.forEach((M,q)=>{if(p.mw)_m.multiplyMatrices(M,p.mw);else _m.copy(M);im.setMatrixAt(q,_m)});
      im.castShadow=p.shadow!==false;im.receiveShadow=true;im.computeBoundingSphere();C.scene.add(im);t.m.push(im)});TILES.push(t)})}
export function cullTiles(cx,cz){for(const t of TILES){const v=(t.x-cx)**2+(t.z-cz)**2<t.d*t.d;for(const m of t.m)m.visible=v}}

/* ---------- ВОРОТА ---------- */
export function sceneTris(scene){let t=0;scene.traverse(o=>{if(!o.isMesh&&!o.isInstancedMesh)return;let p=o;while(p){if(!p.visible)return;p=p.parent}
  const g=o.geometry;if(!g||!g.attributes.position)return;const n=(g.index?g.index.count:g.attributes.position.count)/3;t+=n*(o.isInstancedMesh?o.count:1)});return t}
export function gates(c){const out=[],G=(n,v,band,ok)=>{const s=`GATE ${n} ${v} ${band} ${ok?'OK':'FAIL'}`;out.push(s);console.log(s)};
  // 1. повторы подряд вдоль улицы
  let run=0;REG.rows.forEach(list=>{let r=0,prev=null;list.map(o=>o.key||REG.houses.find(q=>q.h===o)?.key).forEach(k=>{r=k===prev?r+1:1;prev=k;run=Math.max(run,r)})});
  G('layout.same_in_row',run,'<=2',run<=2);
  // 2. дом фасадом к ближайшей дороге
  let worst=0;REG.houses.forEach(({h})=>{const n=nearestRoad(h.x,h.z,c.ROADS),want=Math.atan2(n.x-h.x,n.z-h.z);let d=Math.abs(((h.r-want+PI)%TAU+TAU)%TAU-PI);worst=Math.max(worst,d*180/PI)});
  G('layout.house_face_road_deg',worst.toFixed(1),'<=20',worst<=20);
  // 3. тропинка и дровница у каждого дома
  const np=REG.houses.filter(q=>q.path).length,nw=REG.houses.filter(q=>q.wood).length,N=REG.houses.length;
  G('layout.house_path',`${np}/${N}`,'=all',np===N&&N>0);G('layout.house_woodpile',`${nw}/${N}`,'=all',nw===N&&N>0);
  // 4. пустые клетки 20x20 м в деревне
  const X0=-180,X1=-20,Z0=0,Z1=80,occ=new Set();const put=(x,z)=>{if(x>=X0&&x<X1&&z>=Z0&&z<Z1)occ.add(Math.floor((x-X0)/20)+':'+Math.floor((z-Z0)/20))};
  REG.pts.forEach(([x,z])=>put(x,z));c.treePts.forEach(([x,z])=>put(x,z));c.mapShapes.forEach(s=>put(s.x,s.z));
  const cells=(X1-X0)/20*(Z1-Z0)/20,empty=(cells-occ.size)/cells;G('layout.village_empty_cells',empty.toFixed(2),'<=0.30',empty<=.3);
  // 5. треугольники в сцене: максимум по контрольным видам
  const cam=c.camera,save=cam.position.clone();let mx=0,where='';
  [['street',-120,41],['yard',-66,47],['town',205,40],['forest',-60,110],['spawn',-8,44.5]].forEach(([n,x,z])=>{cam.position.set(x+4,c.terrainH(x,z)+4,z+6);c.updateForest(true);const t=sceneTris(c.scene);if(t>mx){mx=t;where=n}});
  cam.position.copy(save);c.updateForest(true);
  G('scene.tris_max',Math.round(mx)+'@'+where,'<=1500000',mx<=1.5e6);
  window.__gates=(window.__gates||[]).concat(out);return out}
