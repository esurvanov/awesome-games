/* qa-story.js — in-page helpers for tools/autoplay.mjs (window.QAS). The story is advanced only through the game's
 * own code paths: interaction prompts (E), dialog lines (E), dialog choice buttons (click), bolts (F) — teleports
 * replace walking, and the only cheats are named in the trace (hp 99, boss hp boost).
 */
(() => {
  const D = window.DBG, C = D.MODCTX, W = D.WORLD, P = D.player, $ = (id) => document.getElementById(id);
  const QAS = window.QAS = {};
  const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : x);
  QAS.stageText = () => { const t = D.STAGES[D.G.stage] && D.STAGES[D.G.stage].text; return typeof t === 'function' ? t() : t; };
  QAS.target = () => { const s = D.STAGES[D.G.stage]; const t = s && s.tgt(); return t ? { x: r2(t.x), y: r2(t.y), z: r2(t.z) } : null; };
  QAS.snap = () => {
    const G = D.G, tg = QAS.target(), parts = $('parts') ? $('parts').querySelectorAll('.on').length : null;
    return { stage: G.stage, text: QAS.stageText(), mode: G.mode, hp: P.hp, pos: [r2(P.x), r2(P.y), r2(P.z)], ground: r2(D.groundH(P.x, P.z)), onGround: !!P.onGround,
      dialog: D.Dialog.active ? (D.Dialog.choosing ? 'choice' : 'line') : null, riding: !!G.riding, pause: !!G.pause, ui: G.ui, deadT: r2(G.deadT),
      parts: G.parts, echoes: G.echoes.length, shards: G.shards.length, hasTool: G.hasTool, hasCell: G.hasCell, ending: G.ending, bossActive: !!D.boss.active, bossDead: !!D.boss.dead, bossHp: D.boss.hp,
      enemies: D.enemies.filter((e) => !e.dead).length, target: tg, targetDist: tg ? r2(Math.hypot(tg.x - P.x, tg.z - P.z)) : null,
      hud: { objective: $('objText') ? $('objText').textContent : null, partsOn: parts, cShards: $('cShards') ? $('cShards').textContent : null, cEchoes: $('cEchoes') ? $('cEchoes').textContent : null,
        prompt: $('prompt') && !$('prompt').hidden ? $('promptText').textContent : null, dialogWho: D.Dialog.active ? $('dWho').textContent : null, choices: D.Dialog.choosing ? [...document.querySelectorAll('#dChoices button')].map((b) => (b.disabled ? '(off) ' : '') + b.children[1].textContent) : null } };
  };
  // HUD vs game state (quest counters)
  QAS.counterCheck = () => {
    const s = QAS.snap(), bad = [];
    if (s.hud.objective !== s.text) bad.push(`objective text "${s.hud.objective}" ≠ stage text "${s.text}"`);
    if (s.hud.partsOn !== null && s.hud.partsOn !== s.parts) bad.push(`parts icons ${s.hud.partsOn} ≠ G.parts ${s.parts}`);
    if (s.hud.cShards !== null && Number(s.hud.cShards) !== s.shards) bad.push(`shards counter ${s.hud.cShards} ≠ ${s.shards}`);
    if (s.hud.cEchoes !== null && Number(s.hud.cEchoes) !== s.echoes) bad.push(`echo counter ${s.hud.cEchoes} ≠ ${s.echoes}`);
    if (s.stage === 4 && !String(s.text).includes(s.parts + '/3')) bad.push(`stage text lacks ${s.parts}/3`);
    if (W.spires.filter((x) => x.taken).length !== s.parts) bad.push(`taken spires ${W.spires.filter((x) => x.taken).length} ≠ G.parts ${s.parts}`);
    return bad;
  };
  // objective sanity: inside the island, near the ground it stands on, not buried in a solid
  QAS.objectiveCheck = () => {
    const t = QAS.target(); if (!t) return D.G.stage < 9 ? ['stage ' + D.G.stage + ' has no objective target'] : [];
    const bad = [], R = Math.hypot(t.x, t.z), g = D.groundH(t.x, t.z);
    if (!Number.isFinite(t.x + t.z)) bad.push('objective NaN');
    if (R > 430) bad.push(`objective outside the island (r ${Math.round(R)} m)`);
    if (t.y !== undefined && Number.isFinite(t.y) && D.G.stage !== 7 && (t.y < g - 1.5 || t.y > g + 6)) bad.push(`objective ${r2(t.y - g)} m from the ground`);
    if (D.PH && D.PH.ok) { const h = D.PH.P.raycast({ x: t.x, y: g + 60, z: t.z }, { x: 0, y: -1, z: 0 }, 80, { groups: D.PH.P.groups.STATIC }); if (h && h.point.y > g + 5 && h.tag && h.tag.kind === 'solid' && D.G.stage !== 7) bad.push(`objective under a solid (${h.tag.name}, ${r2(h.point.y - g)} m above)`); }
    return bad;
  };
  // put the pilot at distance r from p (ground level), facing it, camera behind
  QAS.goNear = (p, r = 2, a0 = 0.6) => {
    let best = null;
    for (let k = 0; k < 16; k++) { const a = a0 + k * 0.4, x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r, sl = C.slopeAt ? C.slopeAt(x, z, 1) : 0; if (sl < 30 && D.getH(x, z) > -0.5) { best = { x, z }; break; } }
    best = best || { x: p.x + r, z: p.z };
    const yaw = Math.atan2(best.x - p.x, best.z - p.z); D.teleport(best.x, best.z, yaw); P.face = yaw; D.cam.pitch = 0.3; D.cam.dist = 7.5;
    return { x: r2(best.x), z: r2(best.z) };
  };
  QAS.targets = {
    crate: () => W.crate.position, orm: () => C.orm.pos, cell: () => W.cell.position, heart: () => W.heart.g.position, kestrel: () => W.kestrel.g.position,
    spire: (i) => W.spires[i].altar, echo: (i) => W.echoes[i].pos, rift: () => D.POI.rift,
  };
  QAS.cheat = { hp: () => { P.hpMax = 99; P.hp = 99; }, bossHp: (n) => { D.boss.hp = Math.min(D.boss.hp, n); } };
  // face the boss for bolts: camera behind the pilot on the line to the boss core
  QAS.aimAt = (x, y, z, pitch) => { const yaw = Math.atan2(P.x - x, P.z - z); D.cam.yaw = yaw; P.face = yaw; if (pitch !== undefined) D.cam.pitch = pitch; };
})();
