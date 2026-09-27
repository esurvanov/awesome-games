// node rig/reskin.mjs config.json
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, prune, dedup, compactPrimitive } from '@gltf-transform/functions';
import { mat4, vec3 } from 'gl-matrix';
import fs from 'fs';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const cfg = JSON.parse(fs.readFileSync(process.argv[2]));
const doc = await io.read('rig/UAL1.glb'); const root = doc.getRoot();
const man = root.listNodes().find(n => n.getName()==='Mannequin');
const uSkin = man.getSkin(); const uJoints = uSkin.listJoints().map(j=>j.getName());
const uIBM = uSkin.getInverseBindMatrices().getArray();
const uBind = uJoints.map((_,i)=>{ const m=mat4.create(); mat4.invert(m, uIBM.slice(i*16,i*16+16)); return m; });
for (const n of root.listNodes()) if (n.getMesh() && n!==man) n.dispose();
const oldMesh = man.getMesh(); const newMesh = doc.createMesh(cfg.name);
const buf = root.listBuffers()[0];
for (const src of cfg.sources) {
  const sd = await io.read(src.file); const sr = sd.getRoot();
  const map = mergeDocuments(doc, sd);
  for (const sn of sr.listNodes()) {
    const mesh = sn.getMesh(), skin = sn.getSkin(); if (!mesh || !skin) continue;
    if (src.meshes && !src.meshes.includes(sn.getName())) continue;
    const sJ = skin.listJoints().map(j=>j.getName()); const sIBM = skin.getInverseBindMatrices().getArray();
    const M = sJ.map((name,i)=>{ const ui=uJoints.indexOf(name); const m=mat4.create(); mat4.multiply(m, uBind[ui], sIBM.slice(i*16,i*16+16)); return m; });
    const remap = sJ.map(n=>uJoints.indexOf(n));
    for (const sp of mesh.listPrimitives()) {
      const p = map.get(sp);
      const P=p.getAttribute('POSITION'), N=p.getAttribute('NORMAL'), J=p.getAttribute('JOINTS_0'), W=p.getAttribute('WEIGHTS_0');
      const n=P.getCount(); const pos=new Float32Array(n*3), nor=new Float32Array(n*3), jj=new Uint16Array(n*4), ww=new Float32Array(n*4);
      const a=[0,0,0],b=[0,0,0],j4=[0,0,0,0],w4=[0,0,0,0]; const headW=new Float32Array(n);
      for (let i=0;i<n;i++){ P.getElement(i,a); N&&N.getElement(i,b); J.getElement(i,j4); W.getElement(i,w4);
        const m=new Float32Array(16); for(let k=0;k<4;k++){ if(!w4[k]) continue; const mk=M[j4[k]]; for(let e=0;e<16;e++) m[e]+=w4[k]*mk[e]; }
        const v=vec3.transformMat4(vec3.create(),a,m); pos.set(v,i*3);
        const nm=[m[0]*b[0]+m[4]*b[1]+m[8]*b[2], m[1]*b[0]+m[5]*b[1]+m[9]*b[2], m[2]*b[0]+m[6]*b[1]+m[10]*b[2]]; const l=Math.hypot(...nm)||1; nor.set(nm.map(x=>x/l),i*3);
        for(let k=0;k<4;k++){ jj[i*4+k]=w4[k]?remap[j4[k]]:0; ww[i*4+k]=w4[k]; if(w4[k] && ['Head','neck_01'].includes(sJ[j4[k]])) headW[i]+=w4[k]; }
      }
      P.setArray(pos); N&&N.setArray(nor);
      p.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(jj).setBuffer(buf)); p.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(ww).setBuffer(buf));
      for (const s of p.listSemantics()) if (!['POSITION','NORMAL','TEXCOORD_0','JOINTS_0','WEIGHTS_0'].includes(s)) p.setAttribute(s,null);
      if (src.headOnly) { const idx=p.getIndices().getArray(); const keep=[]; for(let t=0;t<idx.length;t+=3){ if(headW[idx[t]]>=src.headOnly&&headW[idx[t+1]]>=src.headOnly&&headW[idx[t+2]]>=src.headOnly) keep.push(idx[t],idx[t+1],idx[t+2]); } p.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(keep)).setBuffer(buf)); }
      if (src.headOnly) compactPrimitive(p);
      if (src.skipMaterials && src.skipMaterials.includes(p.getMaterial()?.getName())) continue;
      newMesh.addPrimitive(p);
    }
  }
  for (const s of root.listScenes().slice(1)) { s.listChildren().forEach(c=>c.dispose()); s.dispose(); }
  for (const sn of sr.listNodes()) map.get(sn)?.dispose();
}
man.setMesh(newMesh).setName(cfg.name); oldMesh.dispose();
if (cfg.retex) for (const t of root.listTextures()) { const f=cfg.retex[t.getName()]; if (f) { t.setImage(fs.readFileSync(f)).setMimeType(f.endsWith('.png')?'image/png':'image/jpeg'); console.log('retex',t.getName()); } }
if (cfg.matColor) for (const m of root.listMaterials()) { const c=cfg.matColor[m.getName()]; if (c) m.setBaseColorFactor(c); }
const keep1 = cfg.ual1 ? new Set(cfg.ual1) : null;
for (const a of root.listAnimations()) if ((keep1 && !keep1.has(a.getName())) || a.getName()==='A_TPose') a.dispose();
if (cfg.ual2?.length) {
  const d2 = await io.read('rig/UAL2.glb'); const want=new Set(cfg.ual2);
  for (const a of d2.getRoot().listAnimations()) if (!want.has(a.getName())) a.dispose();
  const m2 = mergeDocuments(doc, d2); const ualNodes=new Set(d2.getRoot().listNodes().map(n=>m2.get(n)));
  const target={}; for (const n of root.listNodes()) if(!ualNodes.has(n)) target[n.getName()]=n;
  for (const a of d2.getRoot().listAnimations().map(x=>m2.get(x))) for (const c of a.listChannels()) { const t=c.getTargetNode(); if (t&&ualNodes.has(t)) { const nt=target[t.getName()]; nt?c.setTargetNode(nt):c.dispose(); } }
  for (const s of root.listScenes().slice(1)) { s.listChildren().forEach(c=>c.dispose()); s.dispose(); }
  for (const n of ualNodes) n?.dispose();
}
const b0=root.listBuffers()[0]; for (const acc of root.listAccessors()) acc.setBuffer(b0); root.listBuffers().slice(1).forEach(b=>b.dispose());
await doc.transform(prune(), dedup());
await io.write(cfg.out, doc); console.log('ok', cfg.out);
