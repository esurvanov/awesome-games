// node charpost.mjs in.glb out.glb '{"tex":{"T_Peasant_BaseColor":"tex_man.jpg"},"color":{"MI_Hair_1":[r,g,b,1]}}'
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { prune } from '@gltf-transform/functions'; import fs from 'fs';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS); const [,, i, o, c] = process.argv; const cfg = JSON.parse(c);
const doc = await io.read(i);
for (const t of doc.getRoot().listTextures()) { const f = cfg.tex?.[t.getName()]; if (f) t.setImage(fs.readFileSync(f)).setMimeType('image/jpeg'); }
for (const m of doc.getRoot().listMaterials()) { const col = cfg.color?.[m.getName()]; if (col) m.setBaseColorFactor(col); }
await doc.transform(prune()); await io.write(o, doc); console.log('ok', o, fs.statSync(o).size);
