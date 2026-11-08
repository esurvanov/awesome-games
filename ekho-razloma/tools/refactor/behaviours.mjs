// Behaviour probes the existing QA does not assert (docs/architecture/migration-plan.ru.html, phase 0):
//   fox befriending + following · stags fleeing · shardling chase and return · snowmobile mount/dismount · save contents
//   node tools/refactor/behaviours.mjs <label>   → stand/refactor/behaviours-<label>.json, exit 1 when a probe fails
import fs from 'node:fs';
import path from 'node:path';
import { openGame, OUT } from '../qa/harness.mjs';

const label = process.argv[2] || 'run';
const H = await openGame({ label: 'behaviours', quality: 'high' });
const results = [];
const probe = async (name, fn) => {
  // every probe starts from a normal play state: an earlier probe's shardling may have hurt the pilot, a dialog or a pause may be open
  await H.page.evaluate(() => { const D = window.DBG; D.G.mode = 'play'; D.G.pause = false; D.G.ui = null; D.G.deadT = 0; D.G.restT = 0; D.G.riding = false; D.player.hp = D.player.hpMax; D.player.inv = 0;
    for (const e of D.enemies) e.dead = true; D.enemies.length = 0; if (D.Dialog && D.Dialog.close) D.Dialog.close();
    D.ZONES.forEach((z) => { if (!D.G.cleared.includes(z.id)) D.G.cleared.push(z.id); }); });   // a probe that teleports the pilot must not wake a zone (shardlings and a dialog)
  let r; try { r = await H.page.evaluate(fn); } catch (e) { r = { ok: false, why: 'exception: ' + e.message.slice(0, 200) }; }
  results.push({ name, ...r }); console.log(r.ok ? '✅' : '❌', name, r.ok ? '' : r.why || '', r.info ? JSON.stringify(r.info) : '');
};
try {
  await H.newGame();
  // probes wait in GAME seconds (the sky clock), not wall-clock ones: a loaded machine runs frames slowly and a timed wait would see too little happen
  await H.page.evaluate(() => { window.__waitGame = (sec) => new Promise((res) => { const D = window.DBG, t0 = D.skyU.uTime.value, s0 = performance.now(); const tick = () => { if (D.skyU.uTime.value - t0 >= sec || performance.now() - s0 > sec * 8000 + 4000) res(); else setTimeout(tick, 30); }; tick(); }); });
  // the AI layer fires random events (ambush, stag herd, blizzard…) on its own timers: silence its tick for the probes, the last probe tests it
  await H.page.evaluate(() => { if (window.AI) { window.__AI_TICK = AI.tick; AI.tick = () => {}; } });

  await probe('fox: pet → joins → follows', async () => {
    const D = window.DBG, wait = (ms) => window.__waitGame(ms / 1000);
    D.teleport(D.fox.x + 3, D.fox.z, 0); await wait(300);
    const it = D.INTER.find((i) => /лис/i.test(String(i.label)));
    if (!it) return { ok: false, why: 'no fox interaction' };
    it.act(); D.Dialog.close && D.Dialog.close(); D.G.ui = null;
    if (!D.fox.joined || D.fox.st !== 'follow') return { ok: false, why: `joined=${D.fox.joined} st=${D.fox.st}` };
    D.teleport(D.fox.x + 14, D.fox.z, 0); await wait(300);
    const d0 = Math.hypot(D.fox.x - D.player.x, D.fox.z - D.player.z); await wait(3500);
    const d1 = Math.hypot(D.fox.x - D.player.x, D.fox.z - D.player.z);
    return { ok: d1 < d0 - 3, why: `distance ${d0.toFixed(1)} → ${d1.toFixed(1)}`, info: { d0: +d0.toFixed(1), d1: +d1.toFixed(1), st: D.fox.st } };
  });

  await probe('stags: close pilot → flee and move away', async () => {
    const D = window.DBG, wait = (ms) => window.__waitGame(ms / 1000);
    const s = D.STAGS[0]; s.st = 'graze'; s.t = 99; const x0 = s.x, z0 = s.z;
    D.teleport(s.x + 16, s.z, 0); await wait(2500);
    const moved = Math.hypot(s.x - x0, s.z - z0);
    return { ok: s.st === 'flee' && moved > 6, why: `st=${s.st} moved=${moved.toFixed(1)}`, info: { st: s.st, moved: +moved.toFixed(1) } };
  });

  await probe('shardling: chase → leash back → idle', async () => {
    const D = window.DBG, wait = (ms) => window.__waitGame(ms / 1000);
    D.teleport(0, 0, 0); await wait(300);
    const seen = new Set(); const z = D.ZONES[0];
    const e = D.spawnShardling(D.player.x + 14, D.player.z, z); D.G.cleared.length = 0;
    for (let i = 0; i < 30; i++) { await wait(100); seen.add(e.st); }
    D.teleport(D.player.x + 160, D.player.z, 0);
    for (let i = 0; i < 100 && !(seen.has('return') && e.st === 'idle'); i++) { await wait(150); seen.add(e.st); }
    const chased = seen.has('chase'), back = seen.has('return') || e.st === 'idle';
    e.dead = true; D.enemies.length = 0;
    return { ok: chased && back, why: `states: ${[...seen].join(',')}`, info: { states: [...seen] } };
  });

  await probe('snowmobile: mount → riding → dismount', async () => {
    const D = window.DBG, wait = (ms) => window.__waitGame(ms / 1000);
    D.sk.unlocked = true; D.teleport(D.sk.x + 3, D.sk.z, 0); await wait(300);
    D.mount(); await wait(500);
    const riding = D.G.riding && D.sk.mounted;
    const x0 = D.sk.x, z0 = D.sk.z; D.keys.KeyW = true; await wait(2500); D.keys.KeyW = false;   // drive: hold forward
    const drove = Math.hypot(D.sk.x - x0, D.sk.z - z0), rider = Math.hypot(D.player.x - D.sk.x, D.player.z - D.sk.z);
    if (drove < 5 || rider > 1.5) { D.keys.KeyW = false; window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })); await wait(400); return { ok: false, why: `drove ${drove.toFixed(1)} m, rider ${rider.toFixed(1)} m from the sled`, info: { drove, rider } }; }
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })); await wait(600);
    const off = !D.G.riding && !D.sk.mounted;
    return { ok: riding && off, why: `riding=${riding} dismounted=${off}`, info: { riding, off, drove: +drove.toFixed(1) } };
  });

  await probe('passport: every kind has a family and an agreed role', async () => {
    const D = window.DBG, C = window.CORE; if (!C || !C.roleOf) return { ok: false, why: 'CORE.roleOf missing' };
    const noFam = new Set(), bad = new Set();
    for (const e of D.Passport.list) { if (!e.alive || e.name === 'debris') continue; if (!e.family) noFam.add(e.kind || e.name); const w = C.roleOf(e.name); if (w && w !== e.role) bad.add(e.kind + ':' + e.role + '≠' + w); }
    const drift = D.Passport.drift();
    return { ok: !noFam.size && !bad.size && !drift.length, why: (drift.length ? 'registry drift: ' + drift.join(',') + ' · ' : '') + `no family: ${[...noFam].join(',')} · role mismatch: ${[...bad].join(',')}`, info: { families: C.families.length } };
  });

  await probe('beings: pilot, fox, stags, boss, orm all have a kind and family', async () => {
    const D = window.DBG, b = D.Passport.beings(), cnt = {}; b.forEach((x) => { const k = x.family + '/' + x.kind; cnt[k] = (cnt[k] || 0) + 1; });
    const want = { 'pilot/pilot': 1, 'animal/fox': 1, 'animal/stag': D.STAGS.length, 'animal/raven': 10, 'enemy/golem': 1, 'being/orm': 1 };
    const bad = Object.keys(want).filter((k) => cnt[k] !== want[k]).map((k) => `${k}: ${cnt[k]} (want ${want[k]})`);
    return { ok: !bad.length && b.every((x) => x.family), why: bad.join('; ') || 'a being has no family', info: cnt };
  });

  await probe('environment: blizzard starts, storm rises, fog closes in, sky clock runs', async () => {
    const D = window.DBG, wait = (ms) => window.__waitGame(ms / 1000);
    D.G.mode = 'play'; D.WX.target = 0; D.WX.storm = 0; const t0 = D.skyU.uTime.value, fog0 = D.scene.fog.near;
    D.WX.t = 0.01; await wait(2500);
    const ok = D.WX.target === 1 && D.WX.storm > 0.1 && D.scene.fog.near < fog0 - 5 && D.skyU.uTime.value > t0 && D.skyU.uStorm.value > 0.1;
    const info = { target: D.WX.target, storm: +D.WX.storm.toFixed(2), fogNear: +D.scene.fog.near.toFixed(1), clock: +(D.skyU.uTime.value - t0).toFixed(1) };
    D.WX.target = 0; D.WX.t = 200;
    return { ok, why: JSON.stringify(info), info };
  });

  await probe('campfire: rest by the fire restores health and sets the checkpoint', async () => {
    const D = window.DBG, wait = (ms) => window.__waitGame(ms / 1000);
    D.G.mode = 'play'; D.G.stage = Math.max(D.G.stage, 2); D.G.riding = false; D.G.checkpoint = null;
    const it = D.INTER.find((i) => i.label === 'Отдохнуть у огня'); if (!it) return { ok: false, why: 'no rest interaction' };
    const p = it.pos(); D.teleport(p.x + 2, p.z, 0); D.player.hpMax = D.player.hpMax || 5; D.player.hp = 1; await wait(300);
    it.act(); await wait(4000);
    return { ok: D.player.hp === D.player.hpMax && D.G.checkpoint === 'station', why: `hp ${D.player.hp}/${D.player.hpMax} checkpoint=${D.G.checkpoint}`, info: { hp: D.player.hp, cp: D.G.checkpoint } };
  });

  await probe('load save: the fox that had joined is with the pilot again', async () => {
    const D = window.DBG; D.fox.joined = false; D.fox.st = 'wild';
    const s = D.store.get('eor-save', null) || { v: 1, stage: 2, hasTool: true, hasCell: false, parts: [], shards: [], echoes: [], cleared: [], deaths: 0, time: 1, sk: false, bossDead: false, ending: null, cp: 'crash' };
    D.applySave(Object.assign({}, s, { fox: true }));
    const on = D.fox.joined && D.fox.st === 'follow'; D.applySave(Object.assign({}, s, { fox: false }));
    return { ok: on, why: `joined=${D.fox.joined} st=${D.fox.st}`, info: { on } };
  });

  await probe('save: contents have the expected fields', async () => {
    const D = window.DBG; D.G.mode = 'play'; D.save(); const s = D.store.get('eor-save', null);
    const need = ['stage', 'hasTool', 'hasCell', 'parts', 'shards', 'echoes', 'cleared', 'deaths', 'fox', 'time', 'pos', 'sk', 'bossDead', 'ending', 'cp'];
    const miss = s ? need.filter((k) => !(k in s)) : need;
    return { ok: !!s && !miss.length, why: 'missing: ' + miss.join(','), info: { keys: s ? Object.keys(s) : null } };
  });
  await probe('things: every story object is listed with a state; stage targets and the shard search equal the old code', async () => {
    const D = window.DBG, T = D.Things; if (!T) return { ok: false, why: 'DBG.Things missing' };
    const W = D.WORLD, orm = D.MODCTX.orm, player = D.player, bad = [];
    const want = { container: 1, cell: 1, spire: 3, shard: 24, echo: 8, heart: 1, ship: 1, snowmobile: 1, campfire: 1 }, got = {};
    T.all().forEach((t) => { got[t.kind] = (got[t.kind] || 0) + 1; });
    for (const k in want) if (got[k] !== want[k]) bad.push(`count ${k}: ${got[k]} (want ${want[k]})`);
    const fam = new Set(window.CORE.families.map((f) => f.id));
    for (const t of T.all()) { const p = t.position; if (!t.id || !t.kind || !fam.has(t.family) || !t.native || !p || !Number.isFinite(p.x) || !Number.isFinite(p.z) || typeof t.state !== 'string') { bad.push('thing ' + t.id + ' incomplete'); break; } }
    // state follows the game
    const h0 = D.G.hasTool, c0 = D.G.hasCell; D.G.hasTool = false; D.G.hasCell = false;
    if (T.get('crate').state !== 'closed' || T.get('cell').state !== 'placed') bad.push('state closed/placed');
    D.G.hasTool = true; D.G.hasCell = true; if (T.get('crate').state !== 'open' || T.get('cell').state !== 'taken') bad.push('state open/taken');
    D.G.hasTool = h0; D.G.hasCell = c0;
    // the stage targets, as the page had them
    const legacy = [() => W.crate.position, () => orm.pos, () => W.cell.position, () => orm.pos,
      () => { let b = null, bd = 1e9; for (const s of W.spires) if (!s.taken) { const d = Math.hypot(s.altar.x - player.x, s.altar.z - player.z); if (d < bd) { bd = d; b = s.altar; } } return b; },
      () => orm.pos, null, () => W.heart.g.position, () => W.kestrel.g.position, () => null];
    const tk = W.spires.map((s) => s.taken); const place = (x, z) => { player.x = x; player.z = z; };
    for (const [x, z] of [[0, 0], [-250, 250], [34, -280], [300, 0]]) { place(x, z); for (const tk2 of [[false, false, false], [true, false, false], [true, true, false], [true, true, true]]) { W.spires.forEach((s, i) => { s.taken = tk2[i]; });
      legacy.forEach((f, i) => { if (!f) return; const a = f(), b2 = D.STAGES[i].tgt(); if (a !== b2) bad.push(`stage ${i} target differs at ${x},${z} taken=${tk2}`); }); } }
    W.spires.forEach((s, i) => { s.taken = tk[i]; });
    // the shard search (the fox)
    const shardOld = (x, z) => { let best = null, bdist = 75; for (const s of W.shards) if (!s.taken) { const sd = Math.hypot(s.x - x, s.z - z); if (sd < bdist) { bdist = sd; best = s; } } return best; };
    const t0 = W.shards.map((s) => s.taken); W.shards[0].taken = true; W.shards[5].taken = true;
    for (const s of W.shards.slice(0, 6)) for (const [dx, dz] of [[0, 0], [30, 10], [-60, 20]]) { const n = T.nearest('shard', s.x + dx, s.z + dz, 75, (q) => !q.taken); if ((n && n.native) !== shardOld(s.x + dx, s.z + dz)) bad.push('nearest shard at ' + s.i); }
    W.shards.forEach((s, i) => { s.taken = t0[i]; });
    return { ok: !bad.length, why: bad.join('; '), info: { things: T.all().length, kinds: got } };
  });

  await probe('creatures: one list with the same fields; every consumer rule equals the old per-kind code', async () => {
    const D = window.DBG, C = D.Creatures; if (!C) return { ok: false, why: 'DBG.Creatures missing' };
    const orm = D.MODCTX.orm, fox = D.fox, boss = D.boss, player = D.player, STAGS = D.STAGS, getH = D.getH;
    const e1 = D.spawnShardling(player.x + 40, player.z, D.ZONES[0]), e2 = D.spawnShardling(player.x - 40, player.z, D.ZONES[0]); e2.dead = true; const enemies = D.enemies;
    const bad = [], same = (name, a, b) => { if (a.length !== b.length || a.some((x, i) => (Array.isArray(x) ? x.length !== b[i].length || x.some((v, k) => v !== b[i][k]) : x !== b[i]))) bad.push(name + ` (${a.length} vs ${b.length})`); };
    // the records
    const all = C.all(), want = { pilot: 1, orm: 1, fox: 1, stag: STAGS.length, shardling: enemies.length, golem: 1, raven: 10 }, got = {}; all.forEach((r) => { got[r.kind] = (got[r.kind] || 0) + 1; });
    for (const k in want) if (got[k] !== want[k]) bad.push(`count ${k}: ${got[k]} (want ${want[k]})`);
    for (const r of all) { const n = r.native; if (!['x', 'y', 'z', 'st', 'hp', 'group'].every((k) => k in n) || !['x', 'y', 'z'].every((k) => Number.isFinite(n[k]))) { bad.push('native of ' + r.id + ' lacks a common field'); break; } }
    for (const r of all) { if (!r.family || !r.controller || !r.native || !Number.isFinite(r.x) || !Number.isFinite(r.z) || !Number.isFinite(r.y) || !Number.isFinite(r.yaw)) { bad.push('record ' + r.id + ' ' + r.kind + ' incomplete'); break; } }
    // legacy rules, written out as the consumers had them
    const lSnow = [[player.c.g, 1.3], [orm.g, 1.3], [fox.g, 1.2], ...STAGS.map((s) => [s.g, 2.2]), ...enemies.filter((e) => !e.dead).map((e) => [e.g, 1.8]), ...(boss.g ? [[boss.g, 5]] : [])].filter((a) => a[0] && a[0].isObject3D).map((a) => [a[0], a[1]]);
    same('snowRoots', lSnow, C.snowRoots().map((r) => [r.root, r.r]));
    const lPress = [...(fox.g ? [[fox.x, fox.g.position.y, fox.z, 0.3, 0.3]] : []), ...STAGS.filter((s) => s.g && s.g.visible !== false).map((s) => [s.x, s.g.position.y, s.z, 0.4, 0.45])];
    same('pressMarks', lPress, C.pressMarks().map((m) => [m.x, m.y, m.z, m.tol, m.f]));
    const lGrass = [[player.x, player.y, player.z, 1.1], ...(fox.g && fox.g.visible !== false ? [[fox.x, fox.y || getH(fox.x, fox.z), fox.z, 0.7]] : []), ...STAGS.map((s) => [s.x, getH(s.x, s.z), s.z, 1.3]), ...enemies.filter((e) => e.hp > 0).map((e) => [e.x, (e.y || 0) - 1.3, e.z, 1.2])];
    same('grassActors', lGrass, C.grassActors());
    const lBlend = [player.c && player.c.g, fox.g || fox.root, ...STAGS.map((s) => s.g || s.root), ...enemies.map((e) => e.g || e.mesh), boss.g || boss.root].map((g) => g || null);
    same('blendRoots', lBlend, C.blendRoots().map((r) => r.group));
    const lShadow = [player.c.g, fox.g, orm.g, ...(boss.g ? [boss.g] : []), ...STAGS.filter((s) => s.g).map((s) => s.g), ...enemies.filter((e) => e.g).map((e) => e.g)];
    same('shadowRoots', lShadow, C.shadowRoots());
    // animals near and the fight flag, in several situations
    const near = (x, z) => { let n = 0; for (const s of STAGS) if (Math.hypot(s.x - x, s.z - z) < 30) n++; if (fox.joined && Math.hypot(fox.x - x, fox.z - z) < 15) n++; return n; };
    const spots = [[player.x, player.z], [STAGS[0].x + 5, STAGS[0].z], [fox.x + 3, fox.z], [STAGS[3].x, STAGS[3].z + 20], [9999, 9999]]; const j0 = fox.joined;
    for (const j of [false, true]) { fox.joined = j; for (const [x, z] of spots) if (near(x, z) !== C.animalsNear(x, z)) bad.push(`animalsNear joined=${j} at ${x | 0},${z | 0}`); }
    fox.joined = j0;
    const combatL = () => enemies.some((e) => !e.dead && e.st !== 'idle' && e.st !== 'return') || (boss.active && !boss.dead);
    const s0 = e1.st, ba = boss.active, bd = boss.dead;
    for (const [st, act, dead] of [['idle', false, false], ['chase', false, false], ['return', false, false], ['idle', true, false], ['idle', true, true], ['windup', false, false]]) { e1.st = st; boss.active = act; boss.dead = dead; if (combatL() !== C.inCombat()) bad.push(`inCombat ${st}/${act}/${dead}`); }
    e1.st = s0; boss.active = ba; boss.dead = bd;
    // Passport.beings is this list
    const bf = {}; D.Passport.beings().forEach((b) => { const k = b.family + '/' + b.kind; bf[k] = (bf[k] || 0) + 1; });
    for (const r of all) { const k = r.family + '/' + r.kind; if (!bf[k]) bad.push('Passport.beings lacks ' + k); }
    e1.dead = true; enemies.length = 0;   // tidy up
    return { ok: !bad.length, why: bad.join('; '), info: { records: all.length, kinds: got } };
  });

  await probe('player: control state lives on Player, the pilot keeps aliases, the roll works', async () => {
    const D = window.DBG, wait = (ms) => window.__waitGame(ms / 1000), P = D.Player;
    if (!P) return { ok: false, why: 'DBG.Player missing' };
    const same = P.creature === D.player && P.input.keys === D.keys && P.input.pressed === D.pressed && P.camera === D.cam && P.climb === D.CLIMB;
    P.roll.t = 0.3; P.aim.t = 0.4; P.fire.cd = 0.1; P.roll.cd = 0.2;
    const al = D.player.rollT === 0.3 && D.player.aimT === 0.4 && D.player.fireCd === 0.1 && D.player.rollCd === 0.2;
    D.player.rollT = 0; D.player.aimT = 0; D.player.fireCd = 0; D.player.rollCd = 0;
    const back = P.roll.t === 0 && P.aim.t === 0 && P.fire.cd === 0 && P.roll.cd === 0;
    D.G.mode = 'play'; D.G.pause = false; D.G.ui = null; D.G.riding = false; D.teleport(D.player.x, D.player.z, 0); await wait(400);
    D.pressed.add('KeyC'); await wait(250); const rolling = P.roll.t > 0 && D.player.rollT > 0; D.pressed.delete('KeyC'); await wait(1300); const ended = P.roll.t === 0;
    // the pilot's mode: walk → roll (above) → ride → walk, dead on top of everything; G.riding is the old name of Player.riding
    const m0 = P.mode; D.sk.unlocked = true; D.teleport(D.sk.x + 3, D.sk.z, 0); await wait(300); D.mount(); await wait(400);
    const mRide = P.mode, rideAlias = D.G.riding === true && P.riding === true; D.G.deadT = 1; const mDead = P.mode; D.G.deadT = 0;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })); await wait(600); const mWalk = P.mode, offAlias = D.G.riding === false && P.riding === false;
    const modes = m0 === 'walk' && mRide === 'ride' && rideAlias && mDead === 'dead' && mWalk === 'walk' && offAlias;
    return { ok: same && al && back && rolling && ended && modes, why: `same=${same} aliases=${al} writeback=${back} rolling=${rolling} ended=${ended} modes=${[m0, mRide, mDead, mWalk]}`, info: { same, al, back, rolling, ended, modes: [m0, mRide, mDead, mWalk] } };
  });

  await probe('animal gait: the stags and the fox get their gait set up and driven (interaction module)', async () => {
    const D = window.DBG, wait = (ms) => window.__waitGame(ms / 1000), I = window.INTERACTION, bad = [];
    if (!I || !I.ST || !I.FX) return { ok: false, why: 'INTERACTION.ST / FX missing' };
    D.G.mode = 'play'; D.G.pause = false; D.G.ui = null; const cleared0 = D.G.cleared.slice(); D.ZONES.forEach((z) => { if (!D.G.cleared.includes(z.id)) D.G.cleared.push(z.id); });   // the stags stand near the lake zone: no zone may wake up and open a dialog
    const s = D.STAGS[0]; s.st = 'graze'; s.t = 99; D.teleport(s.x + 14, s.z, 0); D.fox.joined = true; D.fox.st = 'follow'; D.fox.seekT = 99; D.fox.target = null; await wait(3500);   // seekT high: it follows instead of going off to a shard
    if (!I.ST.ready) bad.push('stag setup not done');
    if (I.ST.per.size !== D.STAGS.length) bad.push();
    if (!I.FX.ready) bad.push('fox setup not done');
    if (!(D.fox.vMax > 0)) bad.push('fox.vMax ' + D.fox.vMax);
    const S = I.ST.per.get(s); if (!S) bad.push('no record for stag 0'); else if (s.st === 'flee' && !(S.v > 0 || S.gait)) bad.push('fleeing stag has no driven gait');
    const f0 = [D.fox.x, D.fox.z]; D.teleport(D.fox.x + 18, D.fox.z, 0); await wait(2500);
    const moved = Math.hypot(D.fox.x - f0[0], D.fox.z - f0[1]); if (moved < 5) bad.push('fox did not run after the pilot: ' + moved.toFixed(1) + ' st=' + D.fox.st + ' speed=' + D.fox.speed + ' joined=' + D.fox.joined + ' riding=' + D.G.riding + ' mode=' + D.G.mode + ' paused=' + D.G.pause + ' dlg=' + D.Dialog.active + ' pilot=' + [D.player.x | 0, D.player.z | 0] + ' fox=' + [D.fox.x | 0, D.fox.z | 0]);
    D.fox.joined = false; D.fox.st = 'wild'; D.G.cleared.length = 0; D.G.cleared.push(...cleared0);
    return { ok: !bad.length, why: bad.join('; '), info: { stagRecords: I.ST.per.size, foxReady: I.FX.ready, vMax: D.fox.vMax, stState: s.st, foxMoved: +moved.toFixed(1) } };
  });

  await probe('state: every key of G is classified (progress or session)', async () => {
    const D = window.DBG, bad = Progress.unclassified(D.G);
    const saved = D.store.get('eor-save', null) || {}; const leak = Progress.SESSION_KEYS.filter((k) => k in saved);
    return { ok: !bad.length && !leak.length, why: `unclassified: ${bad.join(',')} · session keys in the save: ${leak.join(',')}`, info: { progress: Progress.PROGRESS_KEYS.length, session: Progress.SESSION_KEYS.length } };
  });

  await probe('ai layer (offline rules): director, hints, quality, preload, Orm talk, intents', async () => {
    const wait = (ms) => window.__waitGame(ms / 1000); if (!window.AI) return { ok: false, why: 'window.AI missing (ai.js not loaded)' };
    const D = window.DBG, have = (k) => typeof AI[k] !== 'undefined';
    const miss = ['decide', 'ask', 'tick', 'intent', 'steer', 'director', 'hints', 'quality', 'orm', 'commands', 'prefetch'].filter((k) => !have(k));
    if (miss.length) return { ok: false, why: 'missing: ' + miss.join(',') };
    D.G.mode = 'play'; D.G.pause = false; D.G.ui = null; AI.log.length = 0;
    AI.tick = window.__AI_TICK; await wait(100); AI.tick = () => {};
    await AI.director.force(); await AI.hints.force(); await wait(800);
    const sets = [...new Set(AI.log.map((e) => e.set))];
    const ui = !!document.getElementById('aiBadge') && !!document.getElementById('aiTalk');
    const orm = document.querySelector('#dialog') != null && typeof AI.orm.open === 'function';
    return { ok: sets.includes('DIRECTOR') && sets.includes('HINTS') && ui && orm && AI.available === false, why: `sets=${sets.join(',')} ui=${ui} available=${AI.available}`, info: { sets, ui } };
  });

  await probe('controllers: the AI layer advises through Controllers; no advice → the plain rules', async () => {
    const D = window.DBG, wait = (ms) => window.__waitGame(ms / 1000), real = AI.intent, bad = [];
    if (!window.Controllers) return { ok: false, why: 'Controllers missing' };
    if (D.Creatures.all().some((r) => !r.controller)) bad.push('a creature without a controller');
    D.G.mode = 'play'; D.G.pause = false; D.G.ui = null; const cleared0 = D.G.cleared.slice(); D.ZONES.forEach((z) => { if (!D.G.cleared.includes(z.id)) D.G.cleared.push(z.id); });   // no zone wakes up shardlings during the probe
    // stag: advice «alert» at 15 m keeps it grazing and looking; advice «flee» makes it run
    const s = D.STAGS[0]; s.st = 'graze'; s.t = 99; s.lk = 0; D.teleport(s.x + 15, s.z, 0);
    AI.intent = (o) => (o === s ? 'alert' : null); await wait(900); if (!(s.st === 'graze' && s.lk === 1)) bad.push(`stag alert: st=${s.st} lk=${s.lk}`);
    AI.intent = (o) => (o === s ? 'flee' : null); await wait(900); if (s.st !== 'flee') bad.push(`stag flee: st=${s.st}`);
    // shardling: advice «retreat» sends a chasing one home
    AI.intent = () => null; D.teleport(0, 0, 0); await wait(300); const e = D.spawnShardling(D.player.x + 20, D.player.z, D.ZONES[0]); e.st = 'chase'; e.t = 5; e.hx = e.x + 35; e.hz = e.z;   // its home is far away: «return» has somewhere to go
    AI.intent = (o) => (o === e ? 'retreat' : null); await wait(600); if (e.st !== 'return') bad.push(`shardling retreat: st=${e.st}`);
    e.dead = true; D.enemies.length = 0;
    // fox: advice «lead_player_to_shard» zeroes the seek timer
    D.fox.joined = true; D.fox.st = 'follow'; D.fox.seekT = 5; AI.intent = (o) => (o === D.fox ? 'lead_player_to_shard' : null); await wait(500); if (!(D.fox.seekT > 13 || D.fox.st === 'seek')) bad.push(`fox lead: seekT=${D.fox.seekT} st=${D.fox.st}`);   // advice zeroes the timer, the fox then looks for a shard and the timer restarts at 14
    AI.intent = real; D.fox.joined = false; D.fox.st = 'wild'; D.player.hp = D.player.hpMax; D.G.deadT = 0; D.G.cleared.length = 0; D.G.cleared.push(...cleared0);
    return { ok: !bad.length, why: bad.join('; '), info: { controllers: [...new Set(D.Creatures.all().map((r) => r.controller))] } };
  });

  await probe('save and load: every owner puts its part of the world back and writes its part of the save', async () => {
    const D = window.DBG, W = D.WORLD, bad = [], P = window.Progress;
    const near = { x: D.POI.station.x + 6, z: D.POI.station.z + 18 };
    const rec = { v: 1, stage: 5, hasTool: true, hasCell: true, parts: [true, true, false], shards: [0, 1, 2, 6, 7, 8], echoes: [0, 3], cleared: ['lake'], deaths: 2, fox: true, time: 321, pos: [near.x, near.z], sk: true, bossDead: false, ending: null, cp: 'station' };
    D.fox.joined = false; D.fox.st = 'wild'; D.sk.unlocked = false;
    D.applySave(JSON.parse(JSON.stringify(rec)));
    if (!(W.spires[0].taken && W.spires[1].taken && !W.spires[2].taken)) bad.push('spires taken');
    if (W.spires[0].part.visible || W.spires[1].beam.visible || !W.spires[2].part.visible) bad.push('spire parts visibility');
    if (D.G.parts !== 2) bad.push('G.parts ' + D.G.parts);
    if (![0, 1, 2, 6, 7, 8].every((i) => W.shards[i].taken && !W.shards[i].g.visible) || W.shards[3].taken) bad.push('shards');
    if (W.crateGlow.parent) bad.push('crate glow still on'); if (W.cell.visible) bad.push('cell still visible');
    if (!(D.fox.joined && D.fox.st === 'follow')) bad.push('fox'); if (!D.sk.unlocked) bad.push('snowmobile'); if (D.boss.dead) bad.push('boss dead');
    if (D.player.hpMax !== 6) bad.push('hpMax ' + D.player.hpMax);
    if (Math.hypot(D.player.x - near.x, D.player.z - near.z) > 12) bad.push('position moved too far');
    if (D.G.stage !== 5 || D.G.deaths !== 2 || D.G.checkpoint !== 'station' || D.G.time !== 321) bad.push('story fields');
    // the save the game writes back: same fields, same values
    D.G.mode = 'play'; D.G.stage = 5; D.save(); const back = D.store.get('eor-save', null);
    if (!back) bad.push('no save written'); else {
      for (const k of ['v', 'stage', 'hasTool', 'hasCell', 'shards', 'echoes', 'cleared', 'deaths', 'fox', 'sk', 'bossDead', 'ending', 'cp']) if (JSON.stringify(back[k]) !== JSON.stringify(rec[k])) bad.push('save.' + k + ' ' + JSON.stringify(back[k]));
      if (JSON.stringify(back.parts) !== JSON.stringify([true, true, false])) bad.push('save.parts');
      if (JSON.stringify(Object.keys(back)) !== JSON.stringify(Object.keys(rec))) bad.push('save key order ' + Object.keys(back).join(','));
    }
    // endings and the guardian's flag
    D.applySave({ ...rec, bossDead: true, ending: 'take' }); if (!(D.boss.dead && !W.heart.g.visible && Math.abs(D.G.aurora - 0.12) < 1e-9)) bad.push('ending take');
    W.heart.g.visible = true; D.applySave({ ...rec, bossDead: true, ending: 'free' }); if (!(D.G.heartRise === true && D.G.aurora === 2.2 && Math.abs(W.heart.g.position.y - (D.MODCTX.RIFT_FLOOR + 5)) < 1e-6)) bad.push('ending free');
    return { ok: !bad.length, why: bad.join('; '), info: { owners: (P._persist || []).map((p) => p.key + ':' + p.order).join(' ') } };
  });

} finally {
  const errors = H.errors.slice(0, 20);
  fs.mkdirSync(path.join(OUT, 'refactor'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'refactor', `behaviours-${label}.json`), JSON.stringify({ results, errors }, null, 1));
  await H.close();
  const bad = results.filter((r) => !r.ok).length + (errors.length ? 1 : 0);
  console.log(bad ? `❌ ${bad} failing` : '✅ all probes pass', errors.length ? `· ${errors.length} page errors: ${errors[0]}` : '');
  process.exitCode = bad ? 1 : 0;
}
