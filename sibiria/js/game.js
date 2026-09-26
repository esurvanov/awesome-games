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
    s: { warm: B.warm0, food: B.food0, hp: 100, frost: 0 }, frostAcc: 0, coldAcc: 0,
    inv: { can: 1 }, chest: {}, gear: {}, skills: { chop: 0, fish: 0, hunt: 0, cold: 0 },
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

  Actions.tickSleep(h);
  Hero.move(dt, storm);
  Fx.tick(dt, storm);
  Hero.tickLoad();
  Actions.tick(dt);
  Fire.tick(dt, night, storm);
  Stove.tick(dt, night, storm);
  Survival.tick(dt, night);

  Fauna.hares(dt);
  Story.tick(dt, h, night);
  World.thinIce(dt);
  Zones.tick(dt);
  Transport.tick();
  if (state === 'play') Weather.tick();
  Director.tick(dt, night, storm);
  Wolves.tick(dt, night);
  Bear.tick(dt, h, night);
  Npc.tick(dt);
  Colony.update(dt, h, storm);
  Fauna.living(dt);

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
    if (m) {
      G.p.x = SPOT.bed.x; G.p.y = SPOT.bed.y + 4; G.p.action = null; G.p.sleeping = false;
      G.s.hp = m.hp; G.s.warm = m.warm; G.s.food = Math.max(G.s.food, m.food); G.time += CYCLE * m.skip; G.hut.fuel = Math.max(G.hut.fuel, m.fuel);
      G.inv.wood = Math.floor((G.inv.wood || 0) * m.woodKeep); G.wolves = []; G.pack = null;
      UI.card(...m.card);
      return;
    }
    deathLog[G.chapter] = (deathLog[G.chapter] || 0) + 1;
    end('death', cause);
  }
  function end(kind, cause) { state = 'over'; input.act = false; if (kind !== 'death' && typeof Finale !== 'undefined') Finale.play(kind, G.stats, () => UI.end(kind, cause)); else { if (kind === 'death') Sound.sting && Sound.sting('death'); UI.end(kind, cause); } }
  return { newDay, dawn, die, end };
})();
