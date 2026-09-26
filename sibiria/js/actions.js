'use strict';
// Действия героя: что рядом (context), E / F / еда / ловушки, завершение долгих действий, крафт, сон, рация.
const Actions = (() => {
  const A = TUNE.act;
  const nearest = (src, r, f) => Space.nearest(src, G.p.x, G.p.y, r, f);
  const liveHare = h => G.hares.includes(h); // сетка зайцев обновляется раз в 8 шагов — отсекаем уже пойманных

  // Тексты с числами (':fire: +25 с', 'Костёр: :wood:3', 'Спать — после 19:00') — литералы контента
  // (сверяются tests/content-snapshot.js); меняя TUNE, поправь и их.
  // ---------- что под рукой ----------
  function context() {
    const p = G.p;
    if (p.sleeping) return null;
    if (G.bear && G.bear.st !== 'gone' && dist2(G.bear, p) < A.bearR * A.bearR) return { k: 'bear', label: p.torch > 0 ? 'Ткнуть факелом' : 'Ударить', o: G.bear };
    const w = nearest(G.wolves, A.wolfR); if (w) return { k: 'wolf', label: 'Ударить', o: w };
    const h = nearest(Space.hares, A.hareR, liveHare); if (h) return { k: 'hare', label: 'Поймать', o: h };
    const tc = Transport.context(p); if (tc) return tc;
    if (p.ride) return null; // верхом — только «слезть»
    const npc = Npc.context(p); if (npc) return npc;
    const zc = Zones.context(p) || Transport.urkContext(p); if (zc) return zc;
    if (!G.labaz && dist2(POI.labaz, p) < 70 * 70) return { k: 'labaz', label: 'Лабаз · :meat:2' };
    const am = G.amuletsAt && G.amuletsAt.find(a => !a.got && dist2(a, p) < 44 * 44); if (am) return { k: 'amulet', label: 'Сэвэки :sevek:', o: am };
    if (G.col) {
      const site = G.col.builds.find(b => !b.done && dist2(b, p) < (BUILDS[b.type].w / 2 + 30) ** 2); if (site) return { k: 'site', label: `Строить ${BUILDS[site.type].i} ${Math.floor(site.prog * 100)}%`, o: site };
      const bl = G.col.builds.find(b => b.done && dist2(b, p) < (BUILDS[b.type].w / 2 + 34) ** 2 && ['market', 'forge'].includes(b.type));
      if (bl) return { k: 'bld', label: bl.type === 'market' ? 'Фактория :market:' : 'Кузня :forge:', o: bl };
    }
    for (const q of INSPECT) if (dist2(q, p) < 50 * 50) return { k: 'inspect', label: 'Осмотреть ' + q.i, o: q };
    const dr = G.deer && nearest(G.deer, 50); if (dr) return { k: 'deer', label: 'Олень :deer:', o: dr };
    for (const id in NOTES) { const n = NOTES[id]; if (dist2(n, p) < 46 * 46 && id !== 'labaz') return { k: 'note', label: G.notes[id] ? 'Перечитать' : 'Прочитать', o: id }; }
    if (p.inside) {
      if (dist2(SPOT.stove, p) < 50 * 50) return { k: 'stove', label: G.hut.fuel > 0 ? 'Подбросить :wood:' : 'Растопить :wood:' };
      if (dist2(SPOT.bench, p) < 52 * 52) return { k: 'bench', label: G.hut.bench ? (G.flags.radioBuilt ? 'Рация / верстак' : 'Верстак') : 'Изба' };
      if (dist2(SPOT.chest, p) < 46 * 46) return { k: 'chest', label: 'Лабаз' };
      if (dist2(SPOT.bed, p) < 48 * 48) return { k: 'bed', label: 'Спать' };
    }
    const tr = nearest(G.traps, 44); if (tr) return { k: 'trap', label: tr.catch ? 'Забрать ' + ITEMS[tr.catch].i : 'Снять ' + ITEMS[tr.kind].i, o: tr };
    const st = nearest(G.stacks, 56);
    if (st) {
      if (st.lit > 0) return null;
      if (st.wood < 4) return { k: 'stack', label: `Куча ${st.wood}/4 · +:wood:`, o: st };
      return { k: 'stack', label: Inv.has('kero', false) ? 'Поджечь :kero:' : 'Поджечь', o: st };
    }
    for (const w of ['cockpit', 'tail']) if (G.wreck[w].length && dist2(POI[w], p) < 120 * 120) return { k: 'wreck', label: `Разбирать · ${G.wreck[w].length}`, o: w };
    if (!G.flags.tube && dist2(TUBE_POS, p) < 44 * 44) return { k: 'tube', label: 'Взять :tube:' };
    const t = nearest(Space.trees, 56, t => t.wood > 0 && !t.wall); if (t) return { k: 'tree', label: 'Рубить', o: t };
    if (onIce(p.x, p.y)) {
      const hole = nearest(G.holes, 34);
      if (hole) return { k: 'fish', label: 'Рыбачить', o: hole };
      return { k: 'dig', label: 'Пробить лунку' };
    }
    return null;
  }

  // ---------- E: действие по контексту ----------
  function interact(silent) {
    if (state !== 'play' || UI.modal()) return;
    const p = G.p;
    if (p.cd > 0 || p.action || p.sleeping) return;
    const c = context();
    if (!c) { if (!silent) Fx.toast(':close: Здесь нечего делать'); p.cd = 0.3; return; }
    if (c.npc) { if (!silent) UI.dialog(Npc.talk(c.k)); return; }
    switch (c.k) {
      case 'wolf': Wolves.hit(c.o); break;
      case 'bear': Bear.hit(c.o); break;
      case 'hare': {
        const h = c.o; G.hares.splice(G.hares.indexOf(h), 1);
        Inv.add('meat'); Inv.add('hare'); G.stats.hares++; Hero.xp('hunt'); p.swing = 0.25; p.cd = 0.4;
        Fx.floatText(h.x, h.y - 20, '+:meat: +:hare:'); Fx.burst(h.x, h.y - 6, 10, '#ffffff'); Sound.pick();
        break;
      }
      case 'note': if (!silent) readNote(c.o); break;
      case 'labaz': G.labaz = 1; Inv.add('meat', 2); readNote('labaz'); Sound.pick(); break;
      case 'amulet': c.o.got = 1; G.amulets++; Fx.toast(`:sevek: Сэвэки ${G.amulets}/12`); Sound.ok2(); Fx.burst(c.o.x, c.o.y - 10, 14, '#ffd27a');
        Quests.check('amulets');
        break;
      case 'site': p.buildT = 0.35; p.buildB = c.o.id; p.cd = 0.25; p.swing = 0.25; if (Math.random() < 0.4) Sound.chop(); break;
      case 'bld': if (!silent) UI.openCraft(c.o.type === 'market' ? 'market' : 'epoch'); break;
      case 'inspect': if (!silent) { Fx.toast(c.o.i + ' ' + c.o.t); p.cd = 1; } break;
      case 'veh': case 'vfix': case 'vfuel': case 'rent': if (!silent || c.k !== 'veh') Transport.act(c); p.cd = 0.4; break;
      case 'survey': p.action = { k: 'survey', t: 0, dur: TUNE.zone.surveyT, o: c.o.id }; break;
      case 'forecast': if (!silent) { Fx.toast(Zones.forecast()); G.flags.forecast = G.day; p.cd = 1; } break;
      case 'loot': p.action = { k: 'loot', t: 0, dur: TUNE.zone.lootT, o: c.o.id }; break;
      case 'deer': if (!silent) { Fx.toast(':deer: Олень Уркачана. Не трогай — дед обидится.'); p.cd = 1; } break;
      case 'stove': Stove.add(); p.cd = 0.3; break;
      case 'bench': if (!silent) UI.openCraft(G.hut.bench ? 'craft' : 'hut'); break;
      case 'chest': if (!silent) UI.openChest(); break;
      case 'bed': if (!silent) trySleep(); break;
      case 'trap': {
        const t = c.o; p.cd = 0.4;
        if (t.catch) {
          if (t.catch === 'hare') { Inv.add('meat'); Inv.add('hare'); Fx.floatText(t.x, t.y - 20, '+:meat: +:hare:'); } else { Inv.add(t.catch); Fx.floatText(t.x, t.y - 20, '+' + ITEMS[t.catch].i); }
          Hero.xp('hunt'); t.catch = null; t.t = G.time; Sound.pick();
        } else { G.traps.splice(G.traps.indexOf(t), 1); Inv.add(t.kind); }
        break;
      }
      case 'stack': {
        const s = c.o;
        if (s.wood < 4) { if (!Inv.take('wood', 1, false)) { Fx.toast(':close: Не хватает: :wood:1'); p.cd = 0.3; } else { s.wood++; p.cd = 0.25; Sound.chop(); } }
        else if (Inv.has('kero', false)) { Inv.take('kero', 1, false); Fire.lightStack(s, A.stackKeroT); }
        else p.action = { k: 'light', t: 0, dur: 1.5, o: s };
        break;
      }
      case 'wreck': p.action = { k: 'wreck', t: 0, dur: A.wreckT, o: c.o }; break;
      case 'tube': G.flags.tube = 1; Inv.add('tube'); Fx.toast(':tube: Радиолампа Гоши'); Sound.ok2(); break;
      case 'tree':
        if (Inv.weight() > Inv.capKg() + TUNE.hero.overChop) { if (!silent) Fx.toast(':pack: Рюкзак полон'); p.cd = 0.5; break; }
        p.action = { k: 'chop', t: 0, dur: Hero.chopTime() * (c.o.kind === 3 ? TUNE.zone.garChop : 1), o: c.o }; p.face = Math.sign(c.o.x - p.x) || p.face; break;
      case 'fish': p.action = { k: 'fish', ph: 'wait', t: 0, dur: rnd(1.5, 4) - 0.2 * (Hero.lvl('fish') - 1), o: c.o }; break;
      case 'dig': p.action = { k: 'dig', t: 0, dur: A.digT }; break;
    }
  }

  // ---------- конец долгого действия ----------
  function finish(a) {
    const p = G.p;
    if (a.k === 'chop') {
      const t = a.o; if (t.wood <= 0) return;
      t.wood--; World.shakeTree(t, 0.35);
      let n = 1; if (Hero.lvl('chop') >= 5 && Math.random() < 0.25) n = 2;
      Inv.add('wood', n); G.stats.wood += n; Hero.xp('chop'); G.s.food = Math.max(0, G.s.food - A.chopFood);
      Fx.floatText(t.x, t.y - 50 * t.s, `+${n} :wood:`); ArtWorld.fx.chips(G.parts, t.x, t.y); ArtWorld.fx.snowPuff(G.parts, t.x, t.y - 4); Sound.chop();
      if (t.wood <= 0) Sound.treeCrack();
    } else if (a.k === 'fish') {
      if (a.ph === 'wait') {
        // клюёт! полоса с зелёной зоной — жми E вовремя
        const w = clamp(0.14 + 0.03 * (Hero.lvl('fish') - 1) + (G.gear.lure ? 0.06 : 0) + (G.col && G.col.techs.nets ? 0.04 : 0), 0.1, 0.4);
        G.p.action = { k: 'fish', ph: 'bite', t: 0, dur: 2.6, o: a.o, z: rnd(0.1, 0.9 - w), w, sp: rnd(1.3, 2.2) }; Sound.tone('sine', 1200, 1500, 0.08, 0.2);
      } else Fx.floatText(a.o.x, a.o.y - 30, 'ушла');
    } else if (a.k === 'dig') {
      G.holes.push({ x: p.x + p.face * 24, y: p.y + 4, fish: A.holeFish }); ArtWorld.fx.splash(G.parts, p.x + p.face * 24, p.y + 4); Sound.hit();
    } else if (a.k === 'wreck') {
      const pool = G.wreck[a.o], id = pool.shift(); if (!id) return;
      if (id === 'saw') { G.gear.saw = 1; Fx.toast(':saw: Пила! Рубка быстрее'); }
      else {
        Inv.add(id); if (id === 'scrap') G.stats.scrap++;
        if (id === 'quartz') { G.flags.quartz = 1; Fx.toast(':quartz: Кварц для рации'); }
        if (id === 'battery') Fx.toast(':battery: Аккумулятор. Тяжёлый. Зарядить у печки');
        if (id === 'cable') Fx.toast(':cable: Кабель — на антенну');
      }
      Fx.floatText(p.x, p.y - 50, '+' + (id === 'saw' ? ':saw:' : ITEMS[id].i)); Sound.hit(); Sound.pick();
    } else if (a.k === 'loot') {
      // обыск построек зон: как обломки, пул предметов; буровая — может обвалиться
      const o = Zones.obj(a.o), pool = G.loot[a.o], id = pool && pool.shift(); if (!id) return;
      if (pool.length === o.loot.length - 1 && o.t) Fx.toast(ZONES[o.zone].ic + ' ' + o.t);
      Inv.add(id); if (id === 'scrap') G.stats.scrap++;
      Fx.floatText(p.x, p.y - 50, '+' + ITEMS[id].i); Sound.hit(); Sound.pick();
      if (o.zone === 'drill' && Math.random() < TUNE.zone.collapseP) { G.s.hp -= TUNE.zone.collapseDmg; G.hurt = 0.8; Fx.shake(5); Fx.toast(ZONE_TXT.collapse); }
    } else if (a.k === 'survey') {
      const o = Zones.surveyPoint(a.o); if (!o) return;
      Zones.survey(o.x, o.y); Fx.toast(ZONE_TXT.survey); Sound.ok2();
      if (o.t && !G.flags['sv_' + o.id]) { G.flags['sv_' + o.id] = 1; setTimeout(() => Fx.toast(ZONES[o.zone].ic + ' ' + o.t), 1600); }
    } else if (a.k === 'vfix') Transport.fixDone();
    else if (a.k === 'light') Fire.lightStack(a.o, A.stackLightT);
    else if (a.k === 'place') {
      Inv.take(a.o, 1, false); G.traps.push({ x: p.x + p.face * 20, y: p.y + 6, kind: a.o, catch: null, t: G.time });
      Fx.toast(a.o === 'trap' ? (World.inCedar(p.x, p.y) ? ':trap: Капкан в кедраче' : ':trap: Капкан (соболь — только в кедраче)') : ':snare: Силок стоит');
    }
  }
  // шаг таймеров героя и долгого действия
  function tick(dt) {
    const p = G.p;
    p.cd = Math.max(0, p.cd - dt); p.swing = Math.max(0, p.swing - dt); p.iT = Math.max(0, (p.iT || 0) - dt);
    G.sniffCd = Math.max(0, (G.sniffCd || 0) - dt); if (G.sniff) { G.sniff.t += dt; if (G.sniff.t > 5) G.sniff = null; }
    p.torch = Math.max(0, p.torch - dt); p.teaT = Math.max(0, p.teaT - dt); p.wetT = Math.max(0, p.wetT - dt);
    if (p.action) {
      p.action.t += dt;
      if (p.action.t >= p.action.dur) { const a = p.action; p.action = null; finish(a); }
    }
    if (p.action && p.action.k === 'fish' && p.action.ph === 'bite' && p.action.t >= p.action.dur) { Fx.floatText(p.action.o.x, p.action.o.y - 30, 'ушла'); p.action = null; }
    if (input.act && !p.action && p.cd <= 0) interact(true);
  }

  function fishStrike() {
    const a = G.p.action; if (!a || a.k !== 'fish' || a.ph !== 'bite') return false;
    const pos = (Math.sin(a.t * a.sp * Math.PI) + 1) / 2, h = a.o; G.p.action = null; G.p.cd = 0.5; Hero.xp('fish'); G.s.food = Math.max(0, G.s.food - A.fishFood);
    if (pos >= a.z - 0.02 && pos <= a.z + a.w + 0.02) {
      let r = Math.random(), f = FISHES[0]; for (const q of FISHES) { if ((r -= q.p) <= 0) { f = q; break; } }
      const kg = rnd(f.w[0], f.w[1]), n = f.big ? 3 : kg > 2 ? 2 : 1;
      Inv.add('fish', n); G.stats.fish++; G.stats.bestKg = Math.max(G.stats.bestKg || 0, kg); ArtWorld.fx.splash(G.parts, h.x, h.y);
      Fx.floatText(h.x, h.y - 30, `:fish: ${f.n} · ${kg.toFixed(2).replace('.', ',')} кг`); Fx.burst(h.x, h.y, 10, '#b9e2ff'); Sound.splash();
      if (f.big) Fx.toast(`:fish: Таймень! ${kg.toFixed(1).replace('.', ',')} кг`);
      if (--h.fish <= 0) { G.holes.splice(G.holes.indexOf(h), 1); Fx.toast(':fish: Лунка пуста'); }
    } else { Fx.floatText(h.x, h.y - 30, 'Сорвалась'); Sound.tone('triangle', 400, 200, 0.2, 0.15); }
    return true;
  }
  function sniff() {
    if (state !== 'play' || UI.modal() || (G.sniffCd || 0) > 0) return;
    G.sniffCd = A.sniffCd; G.sniff = { t: 0, hits: [] };
    const add2 = (o, ic) => { const d = dist(o, G.p); if (d < A.sniffR) G.sniff.hits.push({ x: o.x, y: o.y, ic, d }); };
    for (const h of G.hares) add2(h, ':hare:');
    for (const a of G.amuletsAt) if (!a.got) add2(a, ':sevek:');
    for (const id in NOTES) if (!G.notes[id]) add2(NOTES[id], ':log:');
    for (const t of G.traps) if (t.catch) add2(t, ':trap:');
    for (const w of G.wolves) add2(w, ':wolf:'); if (G.bear) add2(G.bear, ':bear:');
    if (!G.flags.tube) add2(TUBE_POS, ':tube:');
    for (const k of ['cockpit', 'tail']) if (G.wreck[k].length) add2(POI[k], ':scrap:');
    Sound.tone('sine', 300, 900, 0.5, 0.12);
  }

  // ---------- F: огонь ----------
  function fireKey() {
    if (state !== 'play' || UI.modal() || G.p.sleeping) return;
    const p = G.p, F = TUNE.fire;
    if (p.inside) return Stove.add();
    const f = nearest(G.fires, 70);
    if (f) {
      if (f.fuel > 0) {
        if (!Inv.take('wood', 1, false)) return Fx.toast(':close: Не хватает: :wood:1');
        f.fuel = Math.min(f.fuel + F.fuelAdd, F.fuelMax); Fx.floatText(f.x, f.y - 40, ':fire: +25 с'); Fx.burst(f.x, f.y - 10, 10, '#ffb347', 120);
      } else {
        if (Inv.cnt('wood', false) < F.relightCost) return Fx.toast(':close: Разжечь: :wood:2');
        Inv.take('wood', F.relightCost, false); f.fuel = F.relightFuel; Fx.toast(':fire: Огонь горит');
      }
      return;
    }
    const s = nearest(G.stacks, 56);
    if (s && s.wood < 4 && !s.lit) { if (Inv.take('wood', 1, false)) { s.wood++; Sound.chop(); } else Fx.toast(':close: Не хватает: :wood:1'); return; }
    if (Inv.cnt('wood', false) < F.buildCost) return Fx.toast(':close: Костёр: :wood:3');
    const x = clamp(p.x + p.face * 30, 60, W - 60), y = p.y + 8;
    if (onIce(x, y)) return Fx.toast(':close: На льду не разжечь');
    if (Math.abs(x - HUT.x) < 130 && Math.abs(y - HUT.y) < 110) return Fx.toast(':close: Слишком близко к избе');
    Inv.take('wood', F.buildCost, false); G.fires.push({ x, y, fuel: F.buildFuel }); Fx.toast(':fire: Костёр'); Sound.ok2();
  }

  function eat() {
    if (state !== 'play' || UI.modal() || G.p.sleeping) return;
    if (G.s.food >= A.fullAt) return Fx.toast(':food: Не голоден');
    const wc = G.p.inside, k = FOOD_ORDER.find(f => Inv.cnt(f, wc) > 0);
    if (!k) return Fx.toast(':close: Нет еды · :hare: :fish:');
    Inv.take(k, 1, wc);
    const it = ITEMS[k], cooked = !it.raw || !!Fire.near(TUNE.fire.heatR) || (G.p.inside && G.hut.fuel > 0);
    const v = Math.round(it.food * (cooked ? 1 : A.rawFood));
    G.s.food = Math.min(100, G.s.food + v);
    if (it.warm) G.s.warm = Math.min(Hero.maxWarm(), G.s.warm + it.warm);
    Fx.floatText(G.p.x, G.p.y - 44, (cooked ? it.i + ' +' : ':frost: сырое +') + v);
  }

  function placeKey() {
    if (state !== 'play' || UI.modal() || G.p.sleeping || G.p.action) return;
    const p = G.p;
    if (p.inside || onIce(p.x, p.y)) return Fx.toast(':close: Здесь не поставить');
    let k = null;
    if (World.inCedar(p.x, p.y) && Inv.has('trap', false)) k = 'trap';
    else if (Inv.has('snare', false)) k = 'snare';
    else if (Inv.has('trap', false)) k = 'trap';
    if (!k) return Fx.toast(':close: Нет :snare: / :trap: · верстак');
    p.action = { k: 'place', t: 0, dur: 2, o: k };
  }

  // ---------- мастерская и изба ----------
  function stationOk(at) {
    const p = G.p;
    if (at === 'fire') return !!Fire.near(TUNE.fire.heatR) || (p.inside && G.hut.fuel > 0);
    if (at === 'stove') return p.inside && G.hut.fuel > 0;
    if (at === 'bench') return p.inside && !!G.hut.bench;
    return true;
  }
  function recipeState(r) {
    if (r.gear && G.gear[r.gear]) return 'owned';
    if (r.radio && G.flags.radioBuilt) return 'owned';
    if (!stationOk(r.at)) return 'station';
    if (!Inv.canPay(r.in, G.p.inside)) return 'cost';
    if (r.radio && G.charge < 100) return 'charge';
    return 'ok';
  }
  function craft(r) {
    if (recipeState(r) !== 'ok') return false;
    Inv.pay(r.in, G.p.inside);
    if (r.out) for (const [k, v] of Object.entries(r.out)) Inv.add(k, v);
    if (r.gear) G.gear[r.gear] = 1;
    if (r.id === 'torch') { G.p.torch = TUNE.fire.torchT; Fx.toast(':fire: Факел · 60 с'); }
    if (r.id === 'tea') { G.s.warm = Math.min(Hero.maxWarm(), G.s.warm + A.teaWarm); G.p.teaT = A.teaT; Fx.toast(':tea: Тепло разливается'); }
    if (r.radio) { G.flags.radioBuilt = 1; Fx.toast(':radio: Рация собрана!'); }
    else if (r.gear) Fx.toast(`${r.i} ${r.n}`);
    Sound.ok2();
    return true;
  }
  function hutUpgState(u) {
    if (G.hut[u.id]) return 'owned';
    if (u.id === 'damper' && !G.hut.walls) return 'need';
    if (!World.nearHut()) return 'station';
    if (!Inv.canPay(u.in, true)) return 'cost';
    return 'ok';
  }
  function buildHut(u) {
    if (hutUpgState(u) !== 'ok') return false;
    Inv.pay(u.in, true); G.hut[u.id] = 1; if (u.id === 'door') G.hut.doorHp = 100;
    Fx.toast(`${u.i} ${u.n} :ok:`); Sound.ok2(); return true;
  }

  function readNote(id) { G.notes[id] = 1; UI.note(NOTES[id]); if (id === 'pilot') { G.known.tail = 1; G.known.polynya = 1; } }

  // ---------- сон ----------
  function trySleep() {
    const h = hourOf(), T = TUNE.time;
    if (!(h >= T.sleepFrom || h < T.sleepTo)) return Fx.toast(':sleep: Спать — после 19:00');
    if (G.hut.fuel <= 0) return Fx.toast(':close: Сначала растопи печь');
    if (G.wolves.some(w => insideHut(w.x, w.y))) return Fx.toast(':wolf: Волк в избе — не до сна!');
    if (!G.hut.door && G.wolves.some(w => w.st !== 'retreat' && dist2(w, HUT) < TUNE.r.hutWolves * TUNE.r.hutWolves)) return Fx.toast(':wolf: Волки у избы — без двери не уснуть');
    if (G.bear && G.bear.st !== 'flee' && dist2(G.bear, HUT) < A.bearSleepR * A.bearSleepR) return Fx.toast(':bear: Шатун рядом — не уснуть');
    G.p.sleeping = true; G.p.action = null; G.p.x = SPOT.bed.x; G.p.y = SPOT.bed.y + 4;
  }
  function wake(good, msg) {
    G.p.sleeping = false;
    if (good) {
      G.flags.slept = 1; if (G.s.frost > 0) G.s.frost--;
      Fx.toast(':day: Утро · сохранено'); SaveGame.checkpoint();
    } else Fx.toast(msg);
  }
  // сон: утро будит, погасшая печь и волк в избе — тоже
  function tickSleep(h) {
    if (!G.p.sleeping) return;
    if (h >= TUNE.time.wakeAt && h < 12) wake(true);
    else if (G.hut.fuel <= 0) wake(false, ':frost: Печь погасла');
    else if (G.wolves.some(w => insideHut(w.x, w.y))) wake(false, ':wolf: Волк в избе!');
  }

  // ---------- рация: сеансы связи ----------
  function radioSession() {
    if (!G.flags.radioBuilt) return;
    const R = TUNE.radio;
    if (G.flags.contact) return UI.dialog({ who: 'radio', t: '…борт 24713, ждите в 09:00, дайте дым на мари… Приём.', opts: [{ t: 'Понял' }] });
    const h = hourOf(), lines = NPCS.radio.lines;
    if (stormOn()) return UI.dialog({ who: 'radio', t: '…ш-ш-ш… тр-р… (пурга глушит эфир — попробуй, когда стихнет)', opts: [{ t: 'Выключить' }] });
    const sess = R.sessions.some(([a, b]) => h >= a && h < b);
    // до конца осады эфир забит: борт не слышит (глава III закрывается осадой)
    if (sess && G.chapter < R.fromChapter) { UI.dialog({ who: 'radio', t: lines[(Math.random() * lines.length) | 0], opts: [{ t: 'Выключить' }] }); Fx.toast(':radio: Борт не слышит · сначала отбейся от стаи'); return; }
    if (sess) {
      G.flags.contact = 1; G.flags.contactDay = G.day + (h >= 19 ? 0 : -1); G.flags.contactT = G.time; G.known.mar = 1; UI.dialog(DIALOG.radio_ok); Sound.ok2();
      setTimeout(() => Fx.toast(padDone() ? ':pad: Площадка готова · борт через сутки в 09:00' : ':pad: Сядут только на расчищенную марь · :build: Площадка'), 1800);
    }
    else UI.dialog({ who: 'radio', t: Math.random() < 0.6 ? lines[(Math.random() * lines.length) | 0] : DIALOG.radio_noise.t, opts: [{ t: 'Выключить' }] });
  }

  return { nearest, liveHare, context, interact, finish, tick, fishStrike, sniff, fireKey, eat, placeKey,
    stationOk, recipeState, craft, hutUpgState, buildHut, readNote, trySleep, wake, tickSleep, radioSession };
})();
