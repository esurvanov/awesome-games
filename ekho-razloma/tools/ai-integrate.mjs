// Applies the AI-layer hooks to the game page by text anchors (see AI.md → Integration).
//   node tools/ai-integrate.mjs                    → writes ai-integration-test.html (open-world.html untouched)
//   node tools/ai-integrate.mjs --out file.html    → custom output
//   node tools/ai-integrate.mjs --check            → only report which anchors are found
//   node tools/ai-integrate.mjs --in-place         → patch open-world.html itself (integrator only; makes a .bak first)
// Every hook is optional at runtime: `window.AI` missing → the page behaves exactly as before.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const SRC = path.join(ROOT, arg('in', 'open-world.html'));
const IN_PLACE = process.argv.includes('--in-place'), CHECK = process.argv.includes('--check');
const OUT = IN_PLACE ? SRC : path.join(ROOT, arg('out', 'ai-integration-test.html'));

// ---- the ctx handed to AI.init (lives inside the game's closure, so it can see everything) ----
export const INIT = `
  /* ---- AI layer (ai.js). Absent/offline → nothing changes. ---- */
  if (window.AI) {
    const nearP = (p, r) => Math.hypot(p.x - player.x, p.z - player.z) < r;
    AI.init({
      THREE, scene, camera, renderer, cam, coarse, G, player, orm, fox, sk, enemies, boss, STAGS, WX, POI, getH, groundH, normalY,
      dialogActive: () => Dialog.active,
      say: (lines, done) => Dialog.play(lines, done),
      toast, lock: requestLock,
      objective: () => (STAGES[G.stage] && STAGES[G.stage].tgt()) || null,
      firePos: () => FIRE.pos,
      shipPos: () => WORLD.kestrel.g.position,
      echoes: () => WORLD.echoes,
      shards: () => WORLD.shards,
      inCombat: () => enemies.some((e) => !e.dead && e.st !== 'idle' && e.st !== 'return') || (boss.active && !boss.dead),
      sites: () => (window.WorldFill && WorldFill.stats ? { camp: WorldFill.stats.camp, wreck: WorldFill.stats.ship, pier: WorldFill.stats.pier } : {}),
      getQuality: () => (typeof Q !== 'undefined' && Q.name) || undefined, setQuality: typeof setQuality === 'function' ? setQuality : undefined,
      preloadZone: (z) => AI.prefetch(z, ASSET),
      onOrmReply: (r) => { if (AV.orm) AV.orm.once(r.mood <= 2 ? 'no' : r.mood >= 4 ? 'yes' : 'talk', 2.4); },
      onHint: (h) => { G.aiHint = h.text; },
      named: { fox: fox.g, skimmer: sk.g, ship_kestrel: WORLD.kestrel.g, heart_of_rift: WORLD.heart.g, cargo_crate: WORLD.crate, power_cell: WORLD.cell },
      actions: {
        callSkimmer, mount: () => { if (!sk.unlocked || G.riding) return; if (!nearP(sk, 6)) callSkimmer(); mount(); },
        dismount: () => { if (G.riding) dismount(); }, openMap: () => openUI('map'), openJournal: () => openUI('journal'), closeUI,
        scan: startScan, rest, wave: waveHello, petFox, pause: () => setPause(true), save,
        mute: () => { Sound.init(); if (!Sound.muted) Sound.toggle(); renderSoundBtn(); },
        unmute: () => { Sound.init(); if (Sound.muted) Sound.toggle(); renderSoundBtn(); },
      },
      events: {
        blizzard: () => { WX.target = 1; WX.t = rand(35, 50); },
        ambush_small: () => {
          const bx = Math.sin(cam.yaw), bz = Math.cos(cam.yaw), n = 2 + (Math.random() < 0.5 ? 1 : 0);   // behind the camera, ~20 m
          for (let i = 0; i < n; i++) { const a = (i - (n - 1) / 2) * 0.5, x = player.x + (bx * Math.cos(a) - bz * Math.sin(a)) * 20, z = player.z + (bz * Math.cos(a) + bx * Math.sin(a)) * 20; spawnShardling(x, z, null).st = 'chase'; }
          Sound.whoosh();
        },
        stag_herd: () => {
          const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = -fz, rz = fx;                         // run across the view, 45 m ahead
          STAGS.slice().sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z)).slice(0, 3).forEach((s, i) => {
            s.x = player.x + fx * (45 + i * 4) - rx * (40 + i * 3); s.z = player.z + fz * (45 + i * 4) - rz * (40 + i * 3);
            s.st = 'flee'; s.t = rand(6, 8); s.fx = rx; s.fz = rz; s.A.loop('run', 0.15);
          });
        },
        aurora_flare: () => { if (G.ending) return; const a0 = G.aurora; G.aurora = 2.2; setTimeout(() => { if (G.aurora === 2.2 && !G.ending) G.aurora = a0; }, 14000); },
        echo_whisper: () => Sound.echo(),
        fox_find: ({ target }) => { if (!target) return; fox.target = target; fox.st = 'seek'; fox.seekT = 14; Sound.yip(); },
        supply_drop: () => { const x = player.x - Math.sin(cam.yaw) * 5, z = player.z - Math.cos(cam.yaw) * 5; spawnHeal(x, groundH(x, z) + 0.9, z); },
      },
    });
  }
`;

const HOOKS = [
  { name: 'scripts', find: '<script src="worldfill.js"></script>', mode: 'after', text: '\n<script src="ai-content.js"></script>\n<script src="ai.js"></script>' },
  { name: 'init (boot)', find: /(\n  requestAnimationFrame\(frame\);\n\}\)\(\);\n\}\)\(\);)/, mode: 'before', text: INIT },
  { name: 'tick (frame)', find: 'let dt = Math.min((now - lastT) / 1000, 0.05); lastT = now;', mode: 'after', text: '\n  if (window.AI) AI.tick(dt);' },
  // creatures — intents only exist when the server answered; otherwise AI.intent() → null → original behaviour
  { name: 'stags', find: "      if (d < 26 && G.mode === 'play') { s.st = 'flee';", mode: 'replace',
    text: "      const ai = window.AI ? AI.intent(s) : null;\n      if (ai === 'alert' || ai === 'approach') { if (d >= 10) { if (s.lk !== 1) { s.lk = 1; s.A.loop('look', 0.3); } s.yaw += wrapA(Math.atan2(-dx, -dz) - s.yaw) * Math.min(1, dt * 3); } }\n      else s.lk = 0;\n      if ((ai ? ai === 'flee' || d < 10 : d < 26) && G.mode === 'play') { s.st = 'flee';" },
  { name: 'fox', find: "      want = bd > 1.2 ? (G.riding ? 18 : bd > 9 ? 13 : 6.5) : 0;", mode: 'after',
    text: "\n      const ai = window.AI && !G.riding ? AI.intent(fox) : null;\n      if (ai === 'lead_player_to_shard' && fox.seekT > 1) fox.seekT = 0;\n      else if (ai === 'circle' && d < 8) { const st = AI.steer(fox, 'circle', 'fox'); tx = st.tx; tz = st.tz; want = st.speed; }\n      else if ((ai === 'graze' || ai === 'alert') && d < 6) want = 0;" },
  { name: 'shardlings chase', find: "      case 'chase':\n        mx = dx; mz = dz; mv = G.riding ? 10 : 7; combat = 1;", mode: 'replace',
    text: "      case 'chase': {\n        const ai = window.AI ? AI.intent(e) : null;\n        if (ai === 'retreat' && d > 6) { e.st = 'return'; break; }\n        if (ai === 'circle' && d > 7) { const a = Math.atan2(e.z - player.z, e.x - player.x) + 0.9; mx = player.x + Math.cos(a) * 11 - e.x; mz = player.z + Math.sin(a) * 11 - e.z; mv = 6; combat = 1; break; }\n        if (ai === 'alert' && d > 15) { combat = 1; break; }\n      }\n        mx = dx; mz = dz; mv = G.riding ? 10 : 7; combat = 1;" },
  { name: 'shardlings return', find: "if (hd < 3) e.st = 'idle'; if (d < 18 && alive) e.st = 'chase'; break;", mode: 'replace',
    text: "if (hd < 3) e.st = 'idle'; if (d < 18 && alive && !(window.AI && AI.intent(e) === 'retreat')) e.st = 'chase'; break;" },
  // Orm: free-talk option after the scripted lines (stage ≥ 2)
  { name: 'orm talk choice', find: '  else Dialog.play(D.ormLate);', mode: 'after',
    text: "\n  if (window.AI && G.stage >= 2 && Dialog.active && !Dialog.done) { Dialog.q = Dialog.q.concat([{ who: 'orm', prompt: '', choices: [{ label: 'Спросить…', icon: 'i-person', hint: 'Y', fn: () => AI.orm.open() }, { label: 'Уйти', icon: 'i-home', fn: () => { if (!coarse) requestLock(); } }] }]); }" },
];

let src = fs.readFileSync(SRC, 'utf8'); const report = [];
for (const h of HOOKS) {
  const found = typeof h.find === 'string' ? src.includes(h.find) : h.find.test(src);
  report.push([h.name, found]);
  if (!found || CHECK) continue;
  if (typeof h.find === 'string') src = src.replace(h.find, h.mode === 'after' ? h.find + h.text : h.mode === 'before' ? h.text + h.find : h.text);
  else src = src.replace(h.find, (m) => (h.mode === 'before' ? h.text + m : m + h.text));
}
for (const [n, f] of report) console.log((f ? '✓ ' : '✗ ') + n);
if (CHECK) process.exit(report.every((r) => r[1]) ? 0 : 1);
if (IN_PLACE) fs.copyFileSync(SRC, SRC + '.pre-ai.bak');
fs.writeFileSync(OUT, src);
console.log('→ ' + path.relative(ROOT, OUT) + (report.every((r) => r[1]) ? '' : '  (some anchors missing — see AI.md for manual placement)'));
