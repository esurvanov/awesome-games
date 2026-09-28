/* Эхо Разлома — AI layer (client). Needs ai-content.js loaded first.
 * window.AI = { available, ready, init(ctx), decide(setId, state), tick(dt, ctx), ... }
 * Talks only to the local server (same origin) at /api/*. No server (file://, claude.ai artifact, ?ai=0)
 * → available=false, every decide() resolves null instantly and all modules use deterministic rules.
 * Nothing here ever awaits inside a frame.
 */
(function () {
  'use strict';
  const C = window.AI_CONTENT;
  if (!C) { console.warn('[AI] ai-content.js missing'); return; }
  const now = () => performance.now() / 1000;
  const wrapA = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const hyp = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const rnd = (a, b) => a + Math.random() * (b - a);

  const AI = {
    available: false, ready: null, ctx: null, base: window.AI_ENDPOINT || '',
    cfg: {
      director: { min: 20, max: 40, offlineRules: true },
      creatures: { every: 2.5, radius: 70 },
      hints: { every: 15, cooldown: 120 },
      quality: { every: 3, offlineRules: true, minDwell: 12, upStreak: 3, downStreak: 2 },
      preload: { every: 20 },
      badge: true,
    },
    stats: { calls: 0, ok: 0, nulls: 0, superseded: 0, ms: [] },
    log: [], // last decisions, for debugging (#dbg)
  };
  const note = (set, info) => { AI.log.push({ t: +now().toFixed(1), set, ...info }); if (AI.log.length > 60) AI.log.shift(); };

  /* ================================================================ transport */
  const disabled = /[?&]ai=0/.test(location.search) || location.protocol === 'file:';
  let fails = 0, reprobeT = 0;
  function probe() {
    if (disabled) return Promise.resolve(false);
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 2500); // generous: the page may be busy parsing/compiling on boot
    return fetch(AI.base + '/api/stats', { cache: 'no-store', signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null)).then((j) => { clearTimeout(t); AI.available = !!(j && j.ok && j.ai); fails = 0; badge(); return AI.available; })
      .catch(() => { clearTimeout(t); AI.available = false; badge(); return false; });
  }
  AI.ready = probe();
  // a busy first frame can starve the probe; retry a couple of times (a truly missing server fails instantly and stays off)
  AI.ready.then((ok) => { if (!ok && !disabled) { setTimeout(() => { if (!AI.available) probe(); }, 6000); setTimeout(() => { if (!AI.available) probe(); }, 20000); } });

  const slots = {};
  /** decide(setId, state) → Promise<answers|null>. One request in flight per set; a newer call replaces the queued one (older resolves null). */
  AI.decide = function (setId, state, opts = {}) {
    if (!AI.available || !C.SETS[setId]) return Promise.resolve(null);
    const slot = (slots[setId] ||= { busy: false, queued: null });
    return new Promise((resolve) => {
      const job = { state, resolve, opts };
      if (slot.busy) { if (slot.queued) { AI.stats.superseded++; slot.queued.resolve(null); } slot.queued = job; return; }
      run(setId, slot, job);
    });
  };
  function run(setId, slot, job) {
    slot.busy = true; AI.stats.calls++;
    const t0 = performance.now(), ac = new AbortController();
    const to = setTimeout(() => ac.abort(), (C.SETS[setId].timeoutMs || 1500) + 500);
    fetch(AI.base + '/api/decide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ set: setId, state: job.state, ...(job.opts.deadlineMs ? { deadlineMs: job.opts.deadlineMs } : {}) }), signal: ac.signal })
      .then((r) => r.json().catch(() => null))
      .then((j) => {
        fails = 0; const ms = performance.now() - t0; AI.stats.ms.push(ms); if (AI.stats.ms.length > 200) AI.stats.ms.shift();
        if (j && j.ok) { AI.stats.ok++; job.resolve(j.answers); note(setId, { ms: Math.round(ms), cached: j.meta && j.meta.cached }); }
        else { AI.stats.nulls++; job.resolve(null); note(setId, { ms: Math.round(ms), err: j && j.reason }); }
      })
      .catch(() => { AI.stats.nulls++; job.resolve(null); if (++fails >= 3) { AI.available = false; badge(); reprobeT = now() + 30; } })
      .finally(() => { clearTimeout(to); slot.busy = false; const q = slot.queued; slot.queued = null; if (q) { if (AI.available) run(setId, slot, q); else q.resolve(null); } });
  }
  /** validate+normalize locally (same code as the server) then decide + interpret. Always resolves a decision (model or rules). */
  AI.ask = function (setId, raw, extra) {
    let s; try { s = C.prepare(setId, raw).s; } catch (e) { console.warn('[AI]', setId, e.message); return Promise.resolve(null); }
    return AI.decide(setId, raw).then((a) => C.SETS[setId].interpret(a, s, extra));
  };

  /* ================================================================ ctx helpers */
  const X = () => AI.ctx || {};
  const g = () => X().G || {};
  const playing = () => g().mode === 'play' && !g().pause && !g().ui && !(X().dialogActive && X().dialogActive()) && !(g().deadT > 0);
  const toast = (icon, text, cls) => X().toast && X().toast(icon, text, cls || '');
  const CARD = ['север', 'северо-восток', 'восток', 'юго-восток', 'юг', 'юго-запад', 'запад', 'северо-запад'];
  function dirWords(p) {
    const pl = X().player; if (!pl || !p) return null;
    const dx = p.x - pl.x, dz = p.z - pl.z, d = Math.hypot(dx, dz);
    const bearing = Math.atan2(dx, -dz); // 0 = north (-z), +π/2 = east (+x)
    const yaw = X().cam ? X().cam.yaw : 0, rel = wrapA(bearing + yaw);
    const side = Math.abs(rel) < Math.PI / 4 ? 'впереди' : Math.abs(rel) > Math.PI * 3 / 4 ? 'позади' : rel > 0 ? 'справа' : 'слева';
    const card = CARD[((Math.round(bearing / (Math.PI / 4)) % 8) + 8) % 8];
    return { d, side, card, text: `${side} · ${card} · ${d < 1000 ? Math.round(d / 5) * 5 : (d / 1000).toFixed(1) + 'к'} м` };
  }
  function nearestPOI(p) {
    const P = X().POI || {}, sites = (X().sites && X().sites()) || {};
    const R = { crash: 40, station: 55, lake: 75, spireN: 45, spireW: 45, spireE: 45, rift: 110, camp: 35, ruins: 35, wreck: 45, pier: 30 };
    let best = 'wilds', bd = 1e9;
    for (const [k, v] of Object.entries({ ...P, ...sites })) { if (!R[k] || !v) continue; const d = hyp(p, v); if (d < R[k] && d < bd) { bd = d; best = k; } }
    return best;
  }
  function facingPOI() {
    const pl = X().player, P = X().POI || {}; if (!pl || !X().cam) return 'wilds';
    const yaw = X().cam.yaw; let best = 'wilds', bs = -1;
    for (const k of ['crash', 'station', 'lake', 'spireN', 'spireW', 'spireE', 'rift']) {
      const v = P[k]; if (!v) continue; const d = hyp(pl, v); if (d < 30) continue;
      const rel = Math.abs(wrapA(Math.atan2(v.x - pl.x, -(v.z - pl.z)) + yaw)); const sc = (Math.PI - rel) / Math.PI - d / 3000;
      if (rel < 0.9 && sc > bs) { bs = sc; best = k; }
    }
    return best;
  }

  /* ================================================================ tracking (idle, deaths, stage time, fps) */
  const T = { lastPos: null, idle: 0, deathsAt: [], lastDeaths: 0, stage: -1, stageT: 0, stageDeaths: 0, distHist: [], dts: [], time: 0, lastNow: 0, warm: 0, warmNeed: 8 };
  // frame-time samples for the quality director: real (unclamped) frame intervals, only while playing with the tab
  // visible, and never during a warm-up (8 s after entering play: packs, shader compiles, drift re-stamp; 2 s after a
  // pause, dialog-free menu, hidden tab or a preset switch). Loading hitches must not read as a slow machine.
  function trackFps() {
    const t = performance.now(), G = g(), live = G.mode === 'play' && !G.pause && !document.hidden;
    const d = T.lastNow ? (t - T.lastNow) / 1000 : 0; T.lastNow = t;
    if (!live) { if (T.warm > 0) { T.warm = 0; T.warmNeed = Math.max(T.warmNeed, 2); } return; }
    // a fresh browser profile compiles shaders during the first minutes of play (new areas, new effects): every new
    // program restarts a 4 s warm-up, and so does a jump of the player (teleport, respawn, continue) > 25 m in one frame
    const x = X(), progs = x.renderer && x.renderer.info && x.renderer.info.programs ? x.renderer.info.programs.length : 0, pl = x.player;
    if (progs !== T.progs) { if (T.progs !== undefined) { T.warm = 0; T.warmNeed = Math.max(T.warmNeed, 4); } T.progs = progs; }
    if (pl) { if (T.jumpPos && Math.hypot(pl.x - T.jumpPos.x, pl.z - T.jumpPos.z) > 25) { T.warm = 0; T.warmNeed = Math.max(T.warmNeed, 4); } T.jumpPos = { x: pl.x, z: pl.z }; }
    T.warm += Math.min(d, 0.1);
    if (T.warm < T.warmNeed) { T.dts.length = 0; T.poorT = 0; return; }
    T.warmNeed = 2;   // later interruptions (pause, tab) need only 2 s; compiles / jumps raise it again above
    if (d > 0 && d < 1) { T.dts.push(d); if (T.dts.length > 240) T.dts.shift(); }
  }
  function track(dt) {
    T.time += dt;
    trackFps();
    const pl = X().player, G = g();
    if (pl && G.mode === 'play' && !G.pause) {
      if (T.lastPos) { const m = Math.hypot(pl.x - T.lastPos.x, pl.z - T.lastPos.z); T.idle = m < dt * 0.5 && !(X().dialogActive && X().dialogActive()) ? T.idle + dt : 0; }
      T.lastPos = { x: pl.x, z: pl.z };
      if (G.deaths !== T.lastDeaths) { if (G.deaths > T.lastDeaths) { T.deathsAt.push(T.time); T.stageDeaths++; } T.lastDeaths = G.deaths; }
      if (G.stage !== T.stage) { T.stage = G.stage; T.stageT = 0; T.stageDeaths = 0; T.distHist = []; onStage(); }
      T.stageT += dt;
    }
  }
  const deathsRecent = () => T.deathsAt.filter((t) => T.time - t < 300).length;

  /* ================================================================ timers */
  const timers = { director: 25, creatures: 2, hints: 15, quality: 3, preload: 3 };
  AI.init = function (ctx) {
    AI.ctx = ctx; T.lastDeaths = (ctx.G && ctx.G.deaths) || 0;
    Q.preset = (ctx.getQuality && ctx.getQuality()) || Q.preset;
    buildUI(); badge();
    return AI.ready;
  };
  AI.tick = function (dt, ctx) {
    if (ctx) AI.ctx = ctx;
    if (!AI.ctx || !(dt >= 0)) return;
    track(dt);
    if (!AI.available && reprobeT && now() > reprobeT) { reprobeT = 0; probe(); }
    const G = g();
    if (G.mode === 'play' && !G.pause) {
      if ((timers.director -= dt) <= 0) { timers.director = rnd(AI.cfg.director.min, AI.cfg.director.max); director(); }
      if ((timers.creatures -= dt) <= 0) { timers.creatures = AI.cfg.creatures.every; creatures(); }
      if ((timers.hints -= dt) <= 0) { timers.hints = AI.cfg.hints.every; hints(false); }
      if ((timers.preload -= dt) <= 0) { timers.preload = AI.cfg.preload.every; preload(); }
    }
    if ((timers.quality -= dt) <= 0) { timers.quality = AI.cfg.quality.every; quality(); }
    expireIntents();
  };
  function onStage() { timers.preload = 0.5; }

  /* ================================================================ b. DIRECTOR */
  const D = { last: -999, seq: 0, cd: {}, tension: 2 };
  const COOL = { blizzard: 240, ambush_small: 180, stag_herd: 120, aurora_flare: 120, echo_whisper: 90, fox_find: 90, supply_drop: 150 };
  function directorAllowed(s) {
    const x = X(), ev = x.events || {}, G = g(), t = T.time, ok = (k) => ev[k] && t - (D.cd[k] || -1e9) > COOL[k];
    const out = [];
    const calmPlace = s.location === 'station' || s.location === 'crash';
    if (ok('blizzard') && x.WX && x.WX.target === 0 && G.stage >= 2 && !calmPlace) out.push('blizzard');
    if (ok('ambush_small') && G.hasTool && s.hp >= s.hpMax - 1 && !s.combat && !s.deathsRecent && G.stage >= 2 && G.stage < 8 && !calmPlace && !s.riding) out.push('ambush_small');
    if (ok('stag_herd') && x.STAGS && x.STAGS.length) out.push('stag_herd');
    if (ok('aurora_flare')) out.push('aurora_flare');
    if (ok('echo_whisper') && unreadEcho()) out.push('echo_whisper');
    if (ok('fox_find') && x.fox && x.fox.joined && x.fox.st === 'follow' && nearestShard()) out.push('fox_find');
    if (ok('supply_drop') && s.hp < s.hpMax) out.push('supply_drop');
    return out;
  }
  function directorState() {
    const x = X(), G = g(), pl = x.player || { x: 0, z: 0, hp: 5, hpMax: 5 };
    const s = { hp: pl.hp, hpMax: pl.hpMax, stage: G.stage || 0, storm: x.WX ? (x.WX.storm > 0.6 ? 'blizzard' : x.WX.target > 0 ? 'building' : 'none') : 'none', location: nearestPOI(pl),
      combat: !!(x.inCombat && x.inCombat()), deathsRecent: deathsRecent(), sinceEvent: Math.min(3600, Math.round(T.time - D.last)), idle: Math.min(3600, Math.round(T.idle)), riding: !!G.riding, fox: !!(x.fox && x.fox.joined), allowed: [] };
    s.allowed = directorAllowed(s);
    return s;
  }
  function director(force) {
    if (!playing() && !force) return;
    if (!AI.available && !AI.cfg.director.offlineRules) return;
    const s = directorState();
    if (!s.allowed.length && !force) return;
    const seq = D.seq;
    AI.ask('DIRECTOR', s, seq).then((r) => {
      if (!r || !playing()) return;
      D.tension = r.tension; X().onTension && X().onTension(r.tension);
      note('DIRECTOR', { event: r.event, tension: r.tension, src: r.src });
      if (r.event === 'none' || !s.allowed.includes(r.event)) return;
      applyEvent(r.event);
    });
  }
  function applyEvent(ev) {
    const E = C.EVENTS[ev], x = X(); D.last = T.time; D.cd[ev] = T.time; D.seq++;
    let info = {};
    if (ev === 'echo_whisper') { const e = unreadEcho(); info = { target: e }; }
    if (ev === 'fox_find') info = { target: nearestShard() };
    try { x.events[ev](info); } catch (e) { console.warn('[AI] event', ev, e); return; }
    let line = E.t[D.seq % E.t.length];
    if (line.includes('{dir}')) { const w = info.target && dirWords(info.target.pos || info.target); line = line.replace('{dir}', w ? w.side : 'рядом'); }
    toast(E.icon, line, E.cls);
  }
  AI.director = { force: () => director(true), apply: applyEvent, state: directorState, get tension() { return D.tension; } };

  function unreadEcho() {
    const x = X(), list = (x.echoes && x.echoes()) || [], read = g().echoes || [], pl = x.player; if (!pl) return null;
    let best = null, bd = 1e9; for (const e of list) { if (read.includes(e.i)) continue; const p = e.pos || e; const d = hyp(p, pl); if (d < bd) { bd = d; best = e; } } return best;
  }
  function nearestShard(maxD = 75) {
    const x = X(), list = (x.shards && x.shards()) || [], pl = x.player; if (!pl) return null;
    let best = null, bd = maxD; for (const s of list) { if (s.taken) continue; const d = hyp(s, pl); if (d < bd) { bd = d; best = s; } } return best;
  }

  /* ================================================================ c. CREATURES */
  const intents = new Map(); // object → { act, until, src }
  /** current AI intent for a creature object (stag entry, fox, shardling entry) or null → use the original behaviour */
  AI.intent = (obj) => { const it = intents.get(obj); return it && it.until > T.time ? it.act : null; };
  function expireIntents() { if (intents.size > 64) for (const [k, v] of intents) if (v.until < T.time) intents.delete(k); }
  function creatures() {
    if (!AI.available || !playing()) return; // offline: original creature code runs untouched
    const x = X(), pl = x.player; if (!pl) return;
    const R = AI.cfg.creatures.radius, list = [];
    for (const s of x.STAGS || []) { const d = hyp(s, pl); if (d < R) list.push({ o: s, kind: 'stag', d }); }
    if (x.fox && x.fox.joined && x.fox.st !== 'wait') { const d = hyp(x.fox, pl); if (d < 45) list.push({ o: x.fox, kind: 'fox', d }); }
    const en = (x.enemies || []).filter((e) => !e.dead);
    for (const e of en) { const d = hyp(e, pl); if (d < 50 && e.st !== 'windup' && e.st !== 'dash') list.push({ o: e, kind: 'shardling', d }); }
    if (!list.length) return;
    list.sort((a, b) => a.d - b.d); const pick = list.slice(0, 8);
    const vx = pl.vx || 0, vz = pl.vz || 0, G = g();
    const activity = G.riding ? 'riding' : x.inCombat && x.inCombat() ? 'fighting' : T.idle > 3 ? 'idle' : Math.hypot(vx, vz) > 7 ? 'running' : 'walking';
    const shard = nearestShard(40);
    const state = { activity, hp: pl.hp, armed: !!G.hasTool, combat: !!(x.inCombat && x.inCombat()), creatures: pick.map((c, i) => {
      const toC = { x: c.o.x - pl.x, z: c.o.z - pl.z }, appr = (vx * toC.x + vz * toC.z) > 0.5 * Math.hypot(vx, vz) * Math.hypot(toC.x, toC.z);
      const o = { id: 'c' + i, kind: c.kind, dist: +c.d.toFixed(1), approaching: !!appr, hurt: c.kind === 'shardling' ? (c.o.hp || 3) < 3 : false };
      if (c.kind === 'fox') o.shardNear = !!shard;
      if (c.kind === 'shardling') o.mates = Math.min(9, en.filter((e) => e !== c.o && hyp(e, c.o) < 15).length);
      return o; }) };
    AI.ask('CREATURE', state).then((r) => {
      if (!r) return;
      pick.forEach((c, i) => { const it = r['c' + i]; if (it && it.src === 'model' && it.act) intents.set(c.o, { act: it.act, until: T.time + 4.5, src: it.src }); });
      note('CREATURE', { n: pick.length, acts: pick.map((c, i) => c.kind[0] + ':' + (r['c' + i] || {}).act).join(' ') });
    });
  }
  /** optional steering helper for an intent: returns {tx,tz,speed,anim} or null */
  AI.steer = function (obj, act, kind) {
    const pl = X().player; if (!pl || !act) return null;
    const dx = obj.x - pl.x, dz = obj.z - pl.z, d = Math.hypot(dx, dz) || 1;
    switch (act) {
      case 'flee': return { tx: obj.x + dx / d * 30, tz: obj.z + dz / d * 30, speed: 11, anim: 'run' };
      case 'alert': return { tx: obj.x, tz: obj.z, speed: 0, anim: 'look', face: { x: pl.x, z: pl.z } };
      case 'graze': return { tx: obj.x, tz: obj.z, speed: 0, anim: kind === 'fox' ? 'sit' : 'eat' };
      case 'approach': { const stop = kind === 'stag' ? 12 : kind === 'fox' ? 2.2 : 0; return { tx: pl.x + dx / d * stop, tz: pl.z + dz / d * stop, speed: kind === 'stag' ? 1.4 : kind === 'fox' ? 7 : 7, anim: 'walk' }; }
      case 'circle': { const a = Math.atan2(dz, dx) + 0.6, r = kind === 'fox' ? 3.5 : 11; return { tx: pl.x + Math.cos(a) * r, tz: pl.z + Math.sin(a) * r, speed: kind === 'fox' ? 6 : 6, anim: 'run' }; }
      case 'retreat': return { tx: obj.hx ?? obj.x + dx / d * 20, tz: obj.hz ?? obj.z + dz / d * 20, speed: 8, anim: 'run' };
      case 'lead_player_to_shard': { const s = nearestShard(60); return s ? { tx: s.x, tz: s.z, speed: 12, anim: 'run', shard: s } : null; }
    }
    return null;
  };

  /* ================================================================ e. HINTS */
  const H = { lastT: -999, shown: new Set(), current: null };
  function hintState() {
    const x = X(), G = g(), pl = x.player, tgt = x.objective && x.objective();
    const dist = tgt && pl ? hyp(tgt, pl) : 0;
    T.distHist.push({ t: T.stageT, d: dist }); if (T.distHist.length > 12) T.distHist.shift();
    const old = T.distHist.find((h) => T.stageT - h.t >= 45) || T.distHist[0];
    const trend = !old || T.stageT < 45 ? 'same' : dist < old.d - 25 ? 'closer' : dist > old.d + 25 ? 'farther' : T.idle > 20 ? 'same' : 'wandering';
    return { stage: G.stage || 0, inStage: Math.round(T.stageT), idle: Math.round(T.idle), trend, dist: Math.min(2000, Math.round(dist)), deaths: T.stageDeaths, riding: !!G.riding,
      skimmer: !!(x.sk && x.sk.unlocked), echoes: (G.echoes || []).length, parts: G.parts || 0, location: nearestPOI(pl || { x: 0, z: 0 }) };
  }
  function hints(force) {
    if (!playing() && !force) return;
    const s = hintState();
    if (!force) {
      if (T.time - H.lastT < AI.cfg.hints.cooldown) return;
      if (!(s.inStage > 150 || s.idle > 60 || s.deaths >= 1)) return; // cheap local pre-check before spending a call
    }
    AI.ask('HINTS', s).then((r) => {
      if (!r) return; note('HINTS', { stuck: r.stuck, id: r.id, src: r.src });
      if (!r.stuck && !force) return;
      if (!force && H.shown.has(r.id) && T.time - H.lastT < 600) return;
      H.lastT = T.time; H.shown.add(r.id); H.current = r;
      toast('i-book', r.text, 'c-amber'); X().onHint && X().onHint(r);
    });
  }
  AI.hints = { force: () => hints(true), get current() { return H.current; } };

  /* ================================================================ f. QUALITY_DIRECTOR (+ local hysteresis) */
  const Q = { preset: 'high', lastChange: -999, streak: { dir: 0, n: 0 }, lockUntil: -1, focus: 'landscape' };
  // the ladder the director walks: 'air' (weak laptop, LOWEND.md: 30 fps cap + FSR upscale) below the model's presets.
  // The director is the ONE owner of automatic preset changes (modules/lowend.js only falls back to its own switch when
  // ai.js is absent). low → air only on a poor frame rate (avg < 30 or 1 % < 20, 2 readings in a row, like every step
  // down); air → low never automatically (the 30 fps cap hides any headroom): only by the player (pause menu, ?q=).
  const LADDER = () => ['air'].concat(C.PRESETS);
  function deviceClass() {
    const x = X(); if (x.deviceClass) return x.deviceClass();
    const mob = !!x.coarse || matchMedia('(pointer: coarse)').matches, cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 8;
    return mob || cores <= 4 || mem <= 4 ? (mob && cores <= 4 ? 'low' : 'mid') : cores >= 8 ? 'high' : 'mid';
  }
  function fpsStats() {
    const d = T.dts.filter((v) => v > 0).slice(-180); if (d.length < 20) return null;
    const sum = d.reduce((a, b) => a + b, 0), sorted = [...d].sort((a, b) => a - b), p95 = sorted[Math.floor(sorted.length * 0.95)];
    return { avg: d.length / sum, low: 1 / p95 };
  }
  function quality() {
    const x = X(); if (!x.setQuality) return;
    const G0 = g(); if (G0.mode !== 'play' || G0.pause) return;   // menu / loader / pause: no fps verdict
    if (!AI.available && !AI.cfg.quality.offlineRules) return;
    if (T.time < Q.lockUntil || document.hidden) return;
    const f = fpsStats(); if (!f) return;
    if (Q.preset === 'air') return;   // capped at 30 fps: no headroom reading, leaving air is the player's choice
    const G = g(), info = x.renderer && x.renderer.info ? x.renderer.info.render : { calls: 0, triangles: 0 };
    const pitch = x.cam ? x.cam.pitch : 0.3, dlg = x.dialogActive && x.dialogActive();
    const s = { fpsAvg: +f.avg.toFixed(1), fpsLow: +f.low.toFixed(1), device: deviceClass(), mobile: !!x.coarse, activity: G.mode !== 'play' ? 'menu' : dlg ? 'dialogue' : G.riding ? 'driving' : x.inCombat && x.inCombat() ? 'combat' : 'exploring',
      storm: !!(x.WX && x.WX.storm > 0.5), calls: info.calls | 0, tris: info.triangles | 0, look: dlg ? 'close' : pitch > 0.75 ? 'ground' : pitch < -0.1 ? 'sky' : 'horizon', preset: Q.preset };
    AI.ask('QUALITY_DIRECTOR', s).then((r) => {
      if (!r) return;
      if (r.focus !== Q.focus) { Q.focus = r.focus; x.setFocus && x.setFocus(r.focus); }
      // the model / rules know low…ultra; the step below low is local: a poor frame rate on low → air
      // … and only once it has lasted ≥ 12 s of warmed-up play (a stall that ends is not a slow machine)
      const poor = s.preset === 'low' && (s.fpsAvg < 30 || s.fpsLow < 20);
      T.poorT = poor ? (T.poorT || 0) + AI.cfg.quality.every : 0;
      const want = poor && r.preset === 'low' ? (T.poorT >= 12 ? 'air' : 'low') : r.preset;
      hysteresis(want, s, r.src);
    });
  }
  function hysteresis(want, s, src) {
    const P = LADDER(), cur = P.indexOf(Q.preset), w = P.indexOf(want); if (w < 0 || cur < 0) return;
    const dir = Math.sign(w - cur);
    if (dir === 0) { Q.streak = { dir: 0, n: 0 }; return; }
    Q.streak = Q.streak.dir === dir ? { dir, n: Q.streak.n + 1 } : { dir, n: 1 };
    const since = T.time - Q.lastChange;
    let go = false;
    // drop only on a sustained drop (the offline rule's thresholds, two calls in a row ≈ 6 s): a model vote alone, or one
    // bad window, never lowers the picture
    if (dir < 0) go = Q.streak.n >= AI.cfg.quality.downStreak && (s.fpsAvg < 48 || s.fpsLow < 20) && since > 4;
    else go = Q.streak.n >= AI.cfg.quality.upStreak && since > AI.cfg.quality.minDwell * 2 && s.fpsLow >= 50;   // climb slowly, with headroom
    if (!go) return;
    const next = P[cur + dir]; // one step at a time
    Q.preset = next; Q.lastChange = T.time; Q.streak = { dir: 0, n: 0 };
    T.dts.length = 0; T.warm = 0; T.warmNeed = 2;   // the new preset is judged on its own frames (after the switch spike)
    note('QUALITY', { preset: next, fps: s.fpsAvg, src });
    try { X().setQuality(next); } catch (e) { console.warn('[AI] setQuality', e); }
    // remembered for the next visit only when confirmed: slow for ≥ 30 s of warmed-up play, or already stepped down to air
    // in an earlier session (LowEnd.autoAir keeps a "pending" mark in between)
    if (next === 'air' && window.LowEnd && LowEnd.autoAir) LowEnd.autoAir((T.poorT || 0) >= 30);
    T.poorT = 0;
  }
  AI.quality = { get preset() { return Q.preset; }, get focus() { return Q.focus; }, set(name, lockS = 300) { if (!LADDER().includes(name)) return; T.dts.length = 0; T.warm = 0; T.warmNeed = Math.max(T.warmNeed, 2); Q.preset = name; Q.lastChange = T.time; Q.lockUntil = T.time + lockS; X().setQuality && X().setQuality(name); }, _hyst: hysteresis };

  /* ================================================================ g. PRELOAD */
  const PL = { done: new Set(), visited: new Set() };
  function preload() {
    const x = X(); if (!x.preloadZone) return;
    const pl = x.player; if (!pl) return;
    const at = nearestPOI(pl); if (at !== 'wilds') PL.visited.add(at);
    const zones = (x.preloadZones && x.preloadZones()) || ['crash', 'station', 'lake', 'spireN', 'spireW', 'spireE', 'rift'];
    const left = zones.filter((z) => !PL.done.has(z)); if (!left.length) return;
    const s = { stage: g().stage || 0, at, heading: facingPOI(), riding: !!g().riding, visited: [...PL.visited], zones: left };
    AI.ask('PRELOAD', s).then((r) => {
      if (!r || PL.done.has(r.zone) || !left.includes(r.zone)) return;
      PL.done.add(r.zone); note('PRELOAD', { zone: r.zone, src: r.src });
      try { x.preloadZone(r.zone); } catch (e) { console.warn('[AI] preload', e); }
    });
  }

  /** zone → asset packs (current open-world.html names). prefetch warms the HTTP cache so a later loadPacked() is instant. */
  AI.ZONE_PACKS = {
    crash: ['ship_kestrel_globalhawk', 'pilot_aces'], lake: ['animal_stag', 'tree_dead_birch'], spireW: ['tree_spruce_tall_snow', 'tree_spruce_small_snow'], spireN: ['rock_boulder_01'], spireE: ['rock_boulder_01'], rift: [],
    station: ['struct_hab_module', 'struct_radio_dish', 'struct_radome', 'vehicle_rover_sev', 'prop_barrel_01', 'prop_crate_wood', 'prop_crate_military', 'prop_propane_tank', 'prop_generator', 'prop_lamp_post', 'npc_hermit', 'firepit'],
  };
  const prefetched = new Set();
  AI.prefetch = function (zone, base = 'assets/') {
    for (const n of AI.ZONE_PACKS[zone] || []) {
      if (prefetched.has(n)) continue; prefetched.add(n);
      const l = document.createElement('link'); l.rel = 'prefetch'; l.as = 'script'; l.href = base + 'pack/' + n + '.js'; document.head.appendChild(l);
    }
  };

  /* ================================================================ a. ORM_TALK + d. COMMANDS — UI */
  const UI = { el: null, mode: null, busy: false, recent: [], rec: null };
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function buildUI() {
    if (UI.el || !document.body) return;
    const css = document.createElement('style');
    css.textContent = `
#aiTalk{position:fixed;left:50%;bottom:16%;transform:translateX(-50%);z-index:60;width:min(560px,calc(100vw - 32px));display:flex;gap:8px;align-items:center;
 padding:10px;border-radius:14px;background:var(--panel,rgba(10,16,34,.86));border:1px solid var(--line,rgba(127,227,255,.22));backdrop-filter:blur(8px);font:600 15px Onest,system-ui,sans-serif;color:var(--ink,#e8f4ff)}
#aiTalk[hidden]{display:none}
#aiTalk .who{display:flex;align-items:center;gap:6px;color:var(--amber,#ffb347);white-space:nowrap;font:700 12px Tektur,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase}
#aiTalk .who.cmd{color:var(--ice,#7fe3ff)}
#aiTalk input{flex:1;min-width:0;background:rgba(0,0,0,.25);border:1px solid var(--line,rgba(127,227,255,.22));border-radius:10px;color:inherit;font:inherit;padding:9px 11px;outline:none}
#aiTalk input:focus{border-color:var(--amber,#ffb347)}
#aiTalk button{display:grid;place-items:center;width:38px;height:38px;border-radius:10px;border:1px solid var(--line,rgba(127,227,255,.22));background:rgba(255,255,255,.04);color:inherit;cursor:pointer}
#aiTalk button:hover{background:rgba(255,255,255,.1)} #aiTalk button.on{color:var(--danger,#ff4d7d);border-color:currentColor}
#aiTalk svg.i{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2}
#aiTalk .dots{position:absolute;right:14px;top:-22px;font:700 12px Tektur,system-ui;color:var(--dim,#8a9cc0)}
#aiBadge{position:fixed;right:10px;bottom:8px;z-index:55;font:700 10px Tektur,system-ui,sans-serif;letter-spacing:.08em;color:var(--aur,#5cf5c0);opacity:.55;pointer-events:none}
#aiBadge[hidden]{display:none}`;
    document.head.appendChild(css);
    const el = document.createElement('div'); el.id = 'aiTalk'; el.hidden = true;
    const ic = (id) => `<svg class="i"><use href="#${id}"/></svg>`;
    el.innerHTML = `<span class="who">${ic('i-person')}<b>Орм</b></span><input maxlength="160" autocomplete="off" spellcheck="false"><button data-a="mic" title="Голос">${ic('i-sound')}</button><button data-a="send" title="Enter">${ic('i-check')}</button><button data-a="x" title="Esc">${ic('i-cross')}</button><span class="dots" hidden>···</span>`;
    document.body.appendChild(el); UI.el = el; UI.input = el.querySelector('input'); UI.who = el.querySelector('.who'); UI.dots = el.querySelector('.dots'); UI.mic = el.querySelector('[data-a=mic]');
    if (!SR) UI.mic.hidden = true;
    // keep typing away from the game's key handlers
    for (const t of ['keydown', 'keyup', 'keypress']) UI.input.addEventListener(t, (e) => {
      e.stopPropagation();
      if (t !== 'keydown') return;
      if (e.key === 'Enter') { e.preventDefault(); submit(); } else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    el.querySelector('[data-a=send]').onclick = () => submit();
    el.querySelector('[data-a=x]').onclick = () => close();
    UI.mic.onclick = () => listen();
    const b = document.createElement('div'); b.id = 'aiBadge'; b.hidden = true; b.textContent = 'AI'; document.body.appendChild(b); UI.badge = b;
    addEventListener('keydown', onKey);
  }
  function badge() { if (UI.badge) UI.badge.hidden = !(AI.cfg.badge && AI.available); }
  const canOpen = () => { const G = g(); return G.mode === 'play' && !G.pause && !G.ui && !(X().dialogActive && X().dialogActive()) && !(G.deadT > 0); };
  const ormNear = () => { const x = X(), o = x.orm && (x.orm.pos || x.orm); return o && x.player && hyp(o, x.player) < 7 && (g().stage || 0) >= 2 && !g().riding; };
  function onKey(e) {
    if (e.repeat || !AI.ctx || UI.mode) return;
    if (e.code === 'KeyY' && canOpen()) { if (ormNear()) open('orm'); else toast('i-person', 'Орм далеко', 'c-dim'); }
    else if (e.code === 'KeyV' && canOpen()) { open('cmd'); if (e.shiftKey) listen(); }
  }
  function open(mode) {
    buildUI(); if (!UI.el) return;
    UI.mode = mode; const G = g(); UI.prevUi = G.ui; G.ui = 'ai';
    if (document.pointerLockElement) { G.softUnlock = true; document.exitPointerLock(); }
    UI.who.className = 'who' + (mode === 'cmd' ? ' cmd' : '');
    UI.who.innerHTML = mode === 'cmd' ? '<svg class="i"><use href="#i-chip"/></svg><b>ИРИС</b>' : '<svg class="i"><use href="#i-person"/></svg><b>Орм</b>';
    UI.input.placeholder = mode === 'cmd' ? 'команда: «карта», «где костёр», «позови скиммер»…' : 'спроси Орма…';
    UI.input.value = ''; UI.el.hidden = false; UI.dots.hidden = true; setTimeout(() => UI.input.focus(), 20);
  }
  function close(keepUi) {
    if (!UI.el || !UI.mode) return;
    stopListen(); UI.el.hidden = true; UI.mode = null; UI.busy = false;
    const G = g(); if (G.ui === 'ai') G.ui = null;
    if (!keepUi && !X().coarse && X().lock) X().lock();
  }
  function submit() {
    const text = UI.input.value.trim(); if (!text || UI.busy) return;
    UI.busy = true; UI.dots.hidden = false;
    (UI.mode === 'orm' ? talk(text) : command(text)).finally(() => { UI.busy = false; });
  }
  function ormState(phrase) {
    const G = g(), x = X();
    return { phrase, stage: G.stage || 0, echoes: (G.echoes || []).slice(0, 8), parts: G.parts || 0, fox: !!(x.fox && x.fox.joined), bossDead: !!(x.boss && x.boss.dead), ending: G.ending || 'none' };
  }
  function talk(phrase) {
    return AI.ask('ORM_TALK', ormState(phrase), UI.recent).then((r) => {
      close(true);
      if (!r) { if (!X().coarse && X().lock) X().lock(); return; }
      UI.recent.push(r.id); if (UI.recent.length > 3) UI.recent.shift();
      note('ORM_TALK', { id: r.id, mood: r.mood, lidia: +(r.lidia || 0).toFixed(2), src: r.src });
      const x = X();
      if (x.onOrmReply) x.onOrmReply(r);
      if (x.say) x.say([['you', phrase.slice(0, 120)], ['orm', r.text]], () => { if (!x.coarse && x.lock) x.lock(); });
    });
  }
  AI.orm = { open: () => open('orm'), close, ask: (p) => AI.ask('ORM_TALK', ormState(p), UI.recent) };

  /* ---------- commands ---------- */
  function cmdState(text) {
    const x = X(), G = g(), pl = x.player || { x: 0, z: 0 }, fire = x.firePos && x.firePos();
    return { text, riding: !!G.riding, nearOrm: !!ormNear(), nearFire: !!(fire && hyp(fire, pl) < 6), fox: !!(x.fox && x.fox.joined), skimmer: !!(x.sk && x.sk.unlocked), uiOpen: !!(G.ui && G.ui !== 'ai') };
  }
  function command(text) {
    return AI.ask('COMMANDS', cmdState(text)).then((r) => {
      close(true);
      if (!r) return;
      note('COMMANDS', { id: r.id, conf: +(r.conf || 0).toFixed(2), src: r.src });
      runCommand(r.id);
      if (!['talk_orm', 'open_map', 'open_journal', 'pause'].includes(r.id) && !X().coarse && X().lock && !g().ui) X().lock();
    });
  }
  function where(label, p, icon) { const w = dirWords(p); toast(icon, w ? `${label} — ${w.text}` : `${label} — не найдено`, w ? 'c-amber' : 'c-dim'); }
  function runCommand(id) {
    const x = X(), A = x.actions || {}, G = g(), ic = C.CMD_ICON[id], lab = C.CMD_RU[id];
    const act = (k, ...a) => { if (A[k]) { A[k](...a); return true; } toast(ic, lab + ' — недоступно', 'c-dim'); return false; };
    switch (id) {
      case 'where_objective': return where('Цель', x.objective && x.objective(), 'i-target');
      case 'where_campfire': return where('Костёр', x.firePos && x.firePos(), 'i-fire');
      case 'where_orm': return where('Орм', x.orm && (x.orm.pos || x.orm), 'i-station');
      case 'where_ship': return where('«Кестрел»', x.shipPos && x.shipPos(), 'i-ship');
      case 'where_fox': return x.fox && x.fox.joined ? where('Искра', x.fox, 'i-paw') : toast('i-paw', 'Лиса бродит у обломков', 'c-dim');
      case 'where_echo': { const e = unreadEcho(); return e ? where('Эхо', e.pos || e, 'i-echo') : toast('i-echo', 'Все эхо услышаны', 'c-aur'); }
      case 'where_shard': { const s = nearestShard(400); return s ? where('Осколок', s, 'i-shard') : toast('i-shard', 'Осколков рядом нет', 'c-dim'); }
      case 'hint': return hints(true);
      case 'talk_orm': return ormNear() ? setTimeout(() => open('orm'), 30) : where('Орм', x.orm && (x.orm.pos || x.orm), 'i-person');
      case 'quality_low': case 'quality_high': {
        const P = LADDER(), i = P.indexOf(Q.preset), n = P[Math.max(0, Math.min(P.length - 1, i + (id === 'quality_low' ? -1 : 1)))];
        AI.quality.set(n); return toast('i-chip', 'Графика · ' + n, 'c-ice');
      }
      case 'fox_seek': if (!(x.fox && x.fox.joined)) return toast('i-paw', 'Лисы рядом нет', 'c-dim'); if (x.events && x.events.fox_find && nearestShard()) { x.events.fox_find({ target: nearestShard() }); return toast('i-paw', 'Искра, ищи!', 'c-amber'); } return toast('i-paw', 'Искра ничего не чует', 'c-dim');
      case 'rest': { const f = x.firePos && x.firePos(); if (!f || !x.player || hyp(f, x.player) > 6) return where('Костёр', f, 'i-fire'); return act('rest'); }
      case 'none': return toast('i-cross', 'Не понял команду', 'c-dim');
      default: {
        const map = { call_skimmer: 'callSkimmer', mount: 'mount', dismount: 'dismount', open_map: 'openMap', open_journal: 'openJournal', close_ui: 'closeUI', scan: 'scan', wave: 'wave', pet_fox: 'petFox', pause: 'pause', mute: 'mute', unmute: 'unmute', save: 'save' };
        if (id === 'call_skimmer' && !(x.sk && x.sk.unlocked)) return toast('i-skimmer', 'Скиммер без заряда', 'c-pink');
        if (id === 'pet_fox' && x.fox && x.player && hyp(x.fox, x.player) > 4) return where('Искра', x.fox, 'i-paw');
        if (act(map[id])) toast(ic, lab, 'c-ice');
      }
    }
  }
  AI.commands = { open: () => open('cmd'), run: runCommand, list: C.CMD.map((c) => c.id) };

  /* ---------- voice (Web Speech API, optional) ---------- */
  function listen() {
    if (!SR) { toast('i-mute', 'Голос не поддерживается', 'c-dim'); return; }
    if (UI.rec) { stopListen(); return; }
    let rec; try { rec = new SR(); } catch (e) { toast('i-mute', 'Голос недоступен', 'c-dim'); return; }
    rec.lang = 'ru-RU'; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
    UI.rec = rec; UI.mic.classList.add('on');
    rec.onresult = (e) => { const r = e.results[e.results.length - 1]; UI.input.value = r[0].transcript; if (r.isFinal) { stopListen(); submit(); } };
    rec.onerror = (e) => {
      const m = { 'not-allowed': 'Микрофон запрещён', 'service-not-allowed': 'Микрофон запрещён', 'no-speech': 'Не расслышал', 'network': 'Голос недоступен офлайн', 'audio-capture': 'Нет микрофона', aborted: '' }[e.error];
      if (m) toast('i-mute', m, 'c-dim'); if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') UI.mic.hidden = true;
      stopListen();
    };
    rec.onend = () => stopListen();
    try { rec.start(); } catch (e) { stopListen(); }
  }
  function stopListen() { if (!UI.rec) return; const r = UI.rec; UI.rec = null; UI.mic && UI.mic.classList.remove('on'); try { r.abort(); } catch (e) { /* ignore */ } }

  /* ================================================================ world dump for tools/validate-world.mjs */
  /** Collect placements (props, models, instanced trees/rocks) with ground gap and slope. Posts to /api/world-dump when the server is up. */
  AI.dumpWorld = function (ctx = AI.ctx || {}, opts = {}) {
    const THREE = ctx.THREE || window.THREE, scene = ctx.scene; if (!THREE || !scene) return null;
    const rawH = ctx.getH || raycastGround(THREE, scene), sea = ctx.seaLevel ?? 0, getH = ctx.groundH || ((x, z) => Math.max(rawH(x, z), sea)), normalY = ctx.normalY || ((x, z) => { const e = 1.2, hx = getH(x + e, z) - getH(x - e, z), hz = getH(x, z + e) - getH(x, z - e); return 2 * e / Math.hypot(hx, 2 * e, hz); });
    const names = new Map(Object.entries(ctx.named || {}).filter(([, o]) => o).map(([k, o]) => [o, k]));
    const items = [], box = new THREE.Box3(), v = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), m4 = new THREE.Matrix4();
    const P = ctx.POI || {};
    const poiOf = (x, z) => { let b = 'wilds', bd = 1e9; for (const [k, p] of Object.entries(P)) { const d = Math.hypot(x - p.x, z - p.z); if (d < bd) { bd = d; b = k; } } return [b, Math.round(bd)]; };
    const junk = /^(Scene|RootNode|Root|Armature|Object_\d+|mesh_\d+|Material(\.\d+)?|default|)$/i;
    const labelOf = (o) => {
      if (names.has(o)) return names.get(o);
      let n = junk.test(o.name || '') ? '' : o.name;
      if (!n) o.traverse((c) => { if (n) return; if (c.name && !junk.test(c.name)) n = c.name; else if (c.material && c.material.name && !junk.test(c.material.name)) n = 'mat:' + c.material.name; });
      return n || (o.geometry ? o.geometry.type.replace(/(Buffer)?Geometry/, '').toLowerCase() || 'mesh' : 'group of ' + o.children.length);
    };
    const push = (label, kind, x, z, minY, size) => {
      if (Math.min(...size) < 0.02 && !opts.keepFlat) return; // billboards, glows, decals
      const gH = getH(x, z), hw = Math.max(0.3, size[0] / 2), hd = Math.max(0.3, size[2] / 2);
      const corners = [getH(x - hw, z - hd), getH(x + hw, z - hd), getH(x - hw, z + hd), getH(x + hw, z + hd)];
      const [poi, poiDist] = poiOf(x, z);
      items.push({ id: items.length, label: String(label).slice(0, 40), kind, x: +x.toFixed(1), z: +z.toFixed(1), size: size.map((s) => +s.toFixed(2)), groundY: +gH.toFixed(2),
        gap: +(minY - gH).toFixed(2), sinkMax: +(Math.max(...corners) - minY).toFixed(2), floatMax: +(minY - Math.min(...corners)).toFixed(2),
        slopeDeg: Math.round(Math.acos(Math.min(1, normalY(x, z))) * 180 / Math.PI), water: rawH(x, z) < sea + 0.2, poi, poiDist });
    };
    for (const o of scene.children) {
      if (!o.visible || o.isLight || o.isCamera) continue;
      if (o.isInstancedMesh) {
        const n = o.count, step = Math.max(1, Math.floor(n / (opts.perInstanced || 40)));
        o.geometry.computeBoundingBox(); const gb = o.geometry.boundingBox;
        for (let i = 0; i < n; i += step) {
          o.getMatrixAt(i, m4); m4.premultiply(o.matrixWorld); m4.decompose(v, q, sc);
          if (Math.abs(v.y) > 500) continue;
          const size = [(gb.max.x - gb.min.x) * sc.x, (gb.max.y - gb.min.y) * sc.y, (gb.max.z - gb.min.z) * sc.z];
          push(labelOf(o) + '#inst', 'instanced', v.x, v.z, v.y + gb.min.y * sc.y, size);
        }
        continue;
      }
      box.setFromObject(o); if (box.isEmpty()) continue;
      const s = box.getSize(new THREE.Vector3()); if (s.x > 60 || s.z > 60 || s.y > 80) continue; // terrain, sky, merged world meshes
      const c = box.getCenter(new THREE.Vector3());
      push(labelOf(o), o.isMesh ? 'mesh' : 'group', c.x, c.z, box.min.y, [s.x, s.y, s.z]);
    }
    for (const it of (ctx.extraItems && ctx.extraItems()) || []) push(it.label, it.kind || 'extra', it.x, it.z, it.minY, it.size || [1, 1, 1]);
    const dump = { v: 1, at: new Date().toISOString(), page: location.pathname, count: items.length, sites: ctx.sites ? ctx.sites() : null, items };
    if (AI.available && opts.post !== false) fetch(AI.base + '/api/world-dump', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dump) }).catch(() => {});
    return dump;
  };
  function raycastGround(THREE, scene) {
    let terr = null, best = 0;
    scene.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.geometry && o.geometry.attributes.position) { const n = o.geometry.attributes.position.count; o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox; if (b.max.x - b.min.x > 600 && b.max.x - b.min.x < 1500 && n > best) { best = n; terr = o; } } });
    const rc = new THREE.Raycaster(), dn = new THREE.Vector3(0, -1, 0), o = new THREE.Vector3();
    return (x, z) => { if (!terr) return 0; o.set(x, 400, z); rc.set(o, dn); const h = rc.intersectObject(terr, false)[0]; return h ? h.point.y : -4; };
  }

  window.AI = AI;
})();
