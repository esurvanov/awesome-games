'use strict';
// Игра: новая игра, главный шаг update (порядок систем), смена суток, смерть и концовки.
// Системы — в своих модулях (js/*.js), сюжет и персонажи — данные (js/content/*.js).
// Глобально отсюда — точки входа newGame / update и пространство имён Game.

function newGame() {
  const seed = (Math.random() * 1e9) | 0, r = mulberry(seed), B = TUNE.body;
  G = {
    time: 0, day: 1, chapter: 0, seed, lastDawn: 1,
    p: { x: POI.cockpit.x + 60, y: POI.cockpit.y + 120, face: 1, step: 0, moving: false, action: null, cd: 0, swing: 0,
      torch: 0, teaT: 0, wetT: 0, iceT: 0, lx: 0, ly: 0, inside: false, sleeping: false, sx: 0, sy: 0, br: 0, creaked: 0 },
    s: { warm: B.warm0, food: B.food0, hp: 100, frost: 0, tire: 0, awake: 0 }, frostAcc: 0, coldAcc: 0,
    inv: { can: 1 }, chest: {}, gear: {}, hand: { p: [], t: null }, sled: {}, loose: [], carcs: [], itemsV: 2, skills: { chop: 0, fish: 0, hunt: 0, cold: 0 },
    hut: { walls: 0, door: 0, bench: 0, damper: 0, fuel: 0, doorHp: 100 }, charge: 0,
    flags: {}, notes: {}, fired: {}, known: { cockpit: 1 }, stats: { wood: 0, fish: 0, hares: 0, wolves: 0, scrap: 0 },
    trees: [], drifts: [], cracks: [], tussocks: [], hares: [], wolves: [], bear: null, fires: [], holes: [], traps: [],
    stacks: STACKS.map(s => ({ x: s.x, y: s.y, wood: 0, lit: 0 })),
    wreck: { cockpit: [...WRECK_POOL.cockpit], tail: [...WRECK_POOL.tail] },
    D: { phase: 'relax', budget: 15, tension: 0, calmT: 20, last: null, queued: null, omenT: 0, dir: 0 },
    pack: null, storm: null, heli: null, heliDay: 0, rescueT: 0, labaz: 0, bearNight: -1,
    fog: new Array(World.FOG.nx * World.FOG.ny).fill(0), mercy: 0, aurora: 0.7,
    prints: [], parts: [], stashes: [],
  };
  Npc.ensure(); // состояния персонажей (Уркачан → G.urk, Вера → G.vera, новые → G.npcs)
  World.gen(r);
  World.buildGrid();
  for (let i = 0, n = WORLD.count('hares'); i < n; i++) Fauna.spawnHare(true);
  Colony.init();
  World.genLiving(r);
  Zones.initState(); Transport.initState(); // зоны (увиденные, обыск, бурелом), транспорт
  G.decals = []; G.corpses = [];
  G.p.lx = G.p.x; G.p.ly = G.p.y; G.p.sx = G.p.x - 30; G.p.sy = G.p.y;
}

// ---------- главный шаг ----------
function update(dt) {
  const p = G.p;
  Space.tick(dt);
  G.time += dt;
  const h = hourOf(), d = daylight(h), night = 1 - d, storm = stormOn();
  const day = dayOf();
  if (day !== G.day) { G.day = day; Game.newDay(); if (state !== 'play') return; }
  if (h >= TUNE.time.wakeAt && h < 12 && G.lastDawn !== G.day) { G.lastDawn = G.day; Game.dawn(); }
  p.inside = insideHut(p.x, p.y);

  Actions.tickSleep(h, dt);
  Hero.move(dt, storm);
  Fx.tick(dt, storm);
  if (typeof Depth !== 'undefined') Depth.tick(dt, storm); // траншеи и разгребы заметает
  Hero.tickLoad();
  Actions.tick(dt);
  Fire.tick(dt, night, storm);
  Stove.tick(dt, night, storm);
  Survival.tick(dt, night);

  Fauna.hares(dt);
  Story.tick(dt, h, night);
  World.thinIce(dt);
  Zones.tick(dt);
  Transport.tick(dt);
  if (state === 'play') Weather.tick();
  Director.tick(dt, night, storm);
  Wolves.tick(dt, night);
  Bear.tick(dt, h, night);
  Npc.tick(dt);
  Colony.update(dt, h, storm);
  Fauna.living(dt);
  World.crowd(dt);        // тела расталкиваются (r1 + r2), герой сквозь людей и зверей не проходит
  Interact.tick(dt);
  Barks.tick(dt);

  Fx.tickParts(dt);
  World.tickFog(dt);
  World.tickRegrow(dt);
  World.tickStashRaids(dt, night);

  if (G.s.hp <= 0) Game.die(G.cause || 'cold');
}

const Game = (() => {
  // полночь: цены посёлка, развилка 8-го дня, пурга и сияние на сутки
  function newDay() {
    Colony.newDay();
    // 8-й день без спасения: ветка «посёлок» (глава V) или «поход к метеостанции» (VII); нет зон — концовка
    if (G.day >= STORY.lastDay && !G.flags.rescued && G.chapter <= 3 && Story.noHeli()) return;
    Weather.newDay();
  }
  // рассвет: улов в ловушках, добыча участков, голод персонажей, гаснут забытые костры
  function dawn() {
    Fauna.dawnTraps();
    Zones.plotDawn();
    Npc.dawn();
    Fire.dawn();
  }
  function die(cause) {
    const m = CHAPTERS[G.chapter].softDeath;
    // «мягкая» смерть: не телепорт в тот же кадр — упал/замерз → затемнение → очнулся в избе (карточка: кто донёс) → встаёт (Actions.knockout)
    if (m) { if (!G.p.ko) Actions.knockout(cause, m); return; }
    deathLog[G.chapter] = (deathLog[G.chapter] || 0) + 1;
    end('death', cause);
  }
  // открыта панель/диалог: время, тело, звери и топливо стоят (update не зовётся), а мир «дышит» —
  // искры и дым огня, частицы, дрожь веток; позы людей рисует GFX по реальному времени (now)
  function visual(dt) {
    const storm = stormOn(), P = G.parts;
    for (const f of G.fires) if (f.fuel > 0) {
      if (Math.random() < dt * 7) P.push({ type: 'spark', x: f.x + rnd(-6, 6), y: f.y - 14, vx: rnd(-15, 15), vy: rnd(-80, -40), life: rnd(0.5, 1), max: 1, g: -10 });
      if (Math.random() < dt * 3) P.push({ type: 'smoke', x: f.x, y: f.y - 24, vx: rnd(-6, 6), vy: rnd(-30, -18), life: 2.5, max: 2.5 });
    }
    for (const s of G.stacks) if (s.lit > 0 && Math.random() < dt * 8) P.push({ type: 'smoke', x: s.x, y: s.y - 40, vx: rnd(-8, 8), vy: rnd(-45, -25), life: 3.5, max: 3.5, big: 1 });
    if (G.hut.fuel > 0 && Math.random() < dt * 3) P.push({ type: 'smoke', x: HUT.x - 70 + rnd(-2, 2), y: HUT.y - 150, vx: rnd(-5, 5), vy: rnd(-30, -20), life: 3, max: 3 });
    FX.update(P, dt); World.tickTrees(dt);
  }
  // hit-stop: удар топора «застревает» на 50–70 мс — мир стоит, кадр рисуется (только главный цикл; update() в проверках не трогает)
  let stopT = 0;
  function hitStop(s) { if (typeof UI !== 'undefined' && UI.reduced) return; stopT = Math.max(stopT, Math.min(0.1, s)); }
  function stopped(dt) { if (stopT <= 0) return false; stopT -= dt; return true; }
  function end(kind, cause) { state = 'over'; input.act = false; if (kind !== 'death' && typeof Finale !== 'undefined') Finale.play(kind, G.stats, () => UI.end(kind, cause)); else { if (kind === 'death') Sound.sting && Sound.sting('death'); UI.end(kind, cause); } }
  return { newDay, dawn, die, end, visual, hitStop, stopped };
})();
