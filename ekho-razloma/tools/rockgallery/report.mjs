/* tools/rockgallery/report.mjs — writes <dir>/index.html from a gallery result (run.mjs calls it after every card).
 *   node tools/rockgallery/report.mjs <label>     rebuild the page from out/<label>/result.json
 * Marks (natural / not + a note): opened from the game server (http://localhost:8795/tools/rockgallery/out/<label>/index.html)
 * they are saved to the repo — POST /api/marks → tools/rockgallery/marks/<label>.json (server/server.mjs) — and loaded back
 * on open; from file:// they stay in the browser's localStorage ("⬇ отметки" downloads them). The human mark is the verdict.
 * Badges come from the JUDGE (tools/rockgallery/page.js: drawn body vs drawn rock), never from the module's own state.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// thresholds of the automatic checks (green / amber / red) — same numbers the page colours by
export const TH = { changes: [0.6, 1.5], flips: [0, 2], air: [0, 20], inside: [2, 6],
  pen: [2, 6], airS: [0.2, 0.8], idle: [0.6, 1.5], jolts: [0, 2], clips: [1.0, 2.0] };

export function writeReport(dir, res) {
  const data = JSON.stringify(res).replace(/</g, '\\u003c');
  fs.writeFileSync(path.join(dir, 'index.html'), PAGE.replace('__TH__', () => JSON.stringify(TH)).replace('__DATA__', () => data));
}

const PAGE = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Скалы: галерея</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#1b1f24;--mut:#6b7280;--line:#e3e6ea;--ok:#1f9d55;--warn:#d98a00;--bad:#d64545;--acc:#3b6fd8;--chip:#eef1f5}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#111418;--card:#1a1e24;--ink:#e7eaee;--mut:#9aa3ad;--line:#2a3038;--chip:#232932;--acc:#6f9bff}}
:root[data-theme=dark]{--bg:#111418;--card:#1a1e24;--ink:#e7eaee;--mut:#9aa3ad;--line:#2a3038;--chip:#232932;--acc:#6f9bff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:13px/1.35 system-ui,-apple-system,Segoe UI,sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);padding:8px 16px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
h1{font-size:15px;margin:0 8px 0 0}.kpi{display:flex;gap:6px;flex-wrap:wrap}.k{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:3px 8px}.k b{font-size:14px}
select,button,input{font:inherit;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:3px 7px}button{cursor:pointer}
main{padding:12px 16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,560px),1fr));gap:10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:6px}
.card.yes{outline:2px solid var(--ok)}.card.no{outline:2px solid var(--bad)}
.top{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.ttl{font-weight:600}.mut{color:var(--mut)}
.strip{display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:3px}.strip figure{margin:0;position:relative}.strip img{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:4px;display:block;cursor:zoom-in;background:var(--chip)}
.strip figcaption{position:absolute;left:2px;bottom:2px;font-size:10px;background:#000a;color:#fff;border-radius:3px;padding:0 3px;max-width:96%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.chips{display:flex;gap:4px;flex-wrap:wrap}.c{background:var(--chip);border-radius:999px;padding:1px 8px;display:inline-flex;gap:4px;align-items:center}
.c i{width:8px;height:8px;border-radius:50%;display:inline-block}.g i{background:var(--ok)}.a i{background:var(--warn)}.r i{background:var(--bad)}.n i{background:var(--mut)}
.mark{display:flex;gap:4px;align-items:center}.mark input{flex:1;min-width:60px}.mark button.on.y{background:var(--ok);color:#fff;border-color:var(--ok)}.mark button.on.x{background:var(--bad);color:#fff;border-color:var(--bad)}
#zoom{position:fixed;inset:0;background:#000d;display:none;align-items:center;justify-content:center;z-index:9;padding:16px}#zoom img{max-width:100%;max-height:100%;border-radius:6px}
</style></head><body>
<header><h1>🪨 Скалы</h1><div class="kpi" id="kpi"></div>
<select id="fSpot"></select><select id="fScen"></select><select id="fStat"><option value="">все статусы</option><option value="r">🔴 есть красное</option><option value="g">🟢 всё зелёное</option></select>
<select id="fMark"><option value="">все отметки</option><option value="none">⬜ не отмечено</option><option value="yes">✅ естественно</option><option value="no">❌ нет</option></select>
<span class="mut" id="note"></span><span class="k" id="sync">💾</span><button id="dl">⬇ отметки</button><button id="th">◐</button></header>
<main id="grid"></main><div id="zoom"><img alt=""></div>
<script>
const R=__DATA__, TH=__TH__, LS='rockgallery:'+R.label;
let M={};try{M=JSON.parse(localStorage.getItem(LS)||'{}')}catch(e){M={}}
const SRV=/^https?:/.test(location.protocol);let syncT=0,syncOk=null;
const saveM=()=>{try{localStorage.setItem(LS,JSON.stringify(M))}catch(e){}
 if(SRV){clearTimeout(syncT);syncT=setTimeout(()=>fetch('/api/marks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({label:R.label,marks:M})}).then(r=>{syncOk=r.ok;showSync()}).catch(()=>{syncOk=false;showSync()}),400)}};
function showSync(){const el=document.getElementById('sync');if(el)el.textContent=!SRV?'💾 браузер':syncOk===false?'⚠ не сохранено':syncOk?'💾 в проекте':'💾 …'}
if(SRV)fetch('/api/marks?label='+encodeURIComponent(R.label)).then(r=>r.ok?r.json():null).then(j=>{if(j&&j.marks){M=Object.assign({},M,j.marks);syncOk=true;render();kpi()}showSync()}).catch(()=>showSync());
const SC={walk:'🚶 шаг',run:'🏃 бег',along:'↔️ вдоль',holdw:'⏩ держу W',jump:'🦘 прыжок',sit:'🪑 сесть',down:'⬇ спуск'},SIDE=['⬆','➡','⬇','⬅'];
const spot=id=>R.spots.find(s=>s.id===id)||{label:id};
const lvl=(v,[g,a],inv)=>v==null?'n':v<=g?'g':v<=a?'a':'r';
function checks(c){if(c.error)return[['r','⚠ '+c.error.slice(0,40)]];const o=[],j=c.judge;
 if(j){o.push([j.contact?'g':'a',j.contact?'🤝 '+j.contactS+'с':'🤝 нет']);
  o.push([lvl(j.penCm,TH.pen),'🧱 '+j.penCm+' см'+(j.penPart&&j.penCm>2?' '+({head:'шлем',torso:'корпус',arm:'рука',hand:'кисть',leg:'нога'}[j.penPart]||j.penPart):'')]);
  o.push([lvl(j.airS,TH.airS),'✋ в воздухе '+j.airS+'с']);
  o.push([lvl(j.idleNearS,TH.idle),'🧍 без контакта '+j.idleNearS+'с']);
  o.push([lvl(j.teleports+j.snaps,TH.jolts),'⚡ рывки '+(j.teleports+j.snaps)]);
  o.push([lvl(j.clipsPerS,TH.clips),'🎞 '+j.clipsPerS+'/с']);
  if(j.footPenCm>6)o.push(['a','🦶 '+j.footPenCm+' см']);
  if(c.scen==='jump')o.push([c.onTop||c.climbed?'g':'a',(c.onTop?'⬆ наверху':c.climbed?'🧗 лез':'⬆ нет')]);
  return o}
 o.push([c.contact?'g':'r',c.contact?'🤝 контакт':'🤝 нет']);
 o.push([lvl(c.changesPerS,TH.changes),'🔁 '+c.changesPerS+'/с']);
 o.push([lvl(c.flips,TH.flips),'↩ '+c.flips]);
 o.push([c.handAirPct==null?'n':lvl(c.handAirPct,TH.air),'✋ '+(c.handAirPct==null?'—':c.handAirPct+'% мимо')+(c.handGapMedCm!=null?' · '+c.handGapMedCm+' см':'')]);
 o.push([lvl(c.insideCm,TH.inside),'🧱 '+c.insideCm+' см'+(c.insidePart&&c.insideCm>2?' '+c.insidePart:'')]);
 if(c.scen==='jump')o.push([c.onTop||c.climbed?'g':'a',(c.onTop?'⬆ наверху':c.climbed?'🧗 лез':'⬆ нет')]);
 return o}
const worst=c=>{const l=checks(c).map(x=>x[0]);return l.includes('r')?'r':l.includes('a')?'a':'g'};
function kpi(){const cs=R.cards,n=cs.length,m=Object.values(M);const k=[['🃏',n],['🤝',cs.filter(c=>c.judge?c.judge.contact:c.contact).length+'/'+n],['🔴',cs.filter(c=>worst(c)==='r').length],['✅',m.filter(x=>x.v==='yes').length],['❌',m.filter(x=>x.v==='no').length],['🧠',R.brain?'новый':'старый']];
 document.getElementById('kpi').innerHTML=k.map(([a,b])=>'<span class="k">'+a+' <b>'+b+'</b></span>').join('')}
function fill(){const fs=document.getElementById('fSpot'),fc=document.getElementById('fScen');
 fs.innerHTML='<option value="">все камни</option>'+R.spots.filter(s=>!s.missing).map(s=>'<option value="'+s.id+'">'+s.label+'</option>').join('');
 fc.innerHTML='<option value="">все сценарии</option>'+Object.entries(SC).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('')}
function render(){const g=document.getElementById('grid'),fS=fSpot.value,fC=fScen.value,fT=fStat.value,fM=fMark.value;
 g.innerHTML='';for(const c of R.cards){if(fS&&c.spot!==fS)continue;if(fC&&c.scen!==fC)continue;const w=worst(c);if(fT==='r'&&w!=='r')continue;if(fT==='g'&&w!=='g')continue;
  const mk=M[c.id]||{};if(fM==='none'&&mk.v)continue;if(fM&&fM!=='none'&&mk.v!==fM)continue;
  const s=spot(c.spot),el=document.createElement('div');el.className='card'+(mk.v?' '+mk.v:'');
  el.innerHTML='<div class="top"><span class="ttl">'+s.label+'</span><span class="c n">'+SIDE[c.side]+'</span><span class="c n">'+(SC[c.scen]||c.scen)+'</span><span class="mut">'+(c.actions||[]).slice(0,3).join(' · ')+'</span></div>'
   +'<div class="strip">'+(c.shots||[]).map(f=>'<figure><img loading="lazy" src="'+f.f+'" alt=""><figcaption>'+(f.t/1000).toFixed(1)+'с '+(f.close?'🔍 ':f.over?'🛰 ':f.game?'🎮 ':'')+(f.act||f.st||'')+'</figcaption></figure>').join('')+'</div>'
   +'<div class="chips">'+checks(c).map(([l,t])=>'<span class="c '+l+'"><i></i>'+t+'</span>').join('')+'</div>'
   +'<div class="mark"><button class="y'+(mk.v==='yes'?' on':'')+'">✅</button><button class="x'+(mk.v==='no'?' on':'')+'">❌</button><input placeholder="заметка" value="'+(mk.note||'').replace(/"/g,'&quot;')+'"></div>';
  const [by,bx]=el.querySelectorAll('button'),inp=el.querySelector('input');
  const set=v=>{M[c.id]=Object.assign(M[c.id]||{},{v:(M[c.id]||{}).v===v?null:v});saveM();render();kpi()};
  by.onclick=()=>set('yes');bx.onclick=()=>set('no');inp.onchange=()=>{M[c.id]=Object.assign(M[c.id]||{},{note:inp.value});saveM()};
  el.querySelectorAll('img').forEach(i=>i.onclick=()=>{zoom.querySelector('img').src=i.src;zoom.style.display='flex'});
  g.appendChild(el)}}
zoom.onclick=()=>zoom.style.display='none';
dl.onclick=()=>{const b=new Blob([JSON.stringify({label:R.label,at:new Date().toISOString(),marks:M},null,1)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='rock-marks-'+R.label+'.json';a.click()};
th.onclick=()=>{const r=document.documentElement,d=r.dataset.theme==='dark'||(!r.dataset.theme&&matchMedia('(prefers-color-scheme:dark)').matches);r.dataset.theme=d?'light':'dark'};
for(const id of ['fSpot','fScen','fStat','fMark'])document.getElementById(id).onchange=render;
if(R.note)document.getElementById('note').textContent='ℹ '+R.note;else if(R.lab)document.getElementById('note').textContent='🧪 площадка';
fill();kpi();render();
</script></body></html>`;

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const label = process.argv[2] || 'base', dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', label);
  writeReport(dir, JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8')));
  console.log(path.join(dir, 'index.html'));
}
