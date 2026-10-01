'use strict';
// Герой: навыки, производные параметры (скорость, одежда, предел тепла) и движение (лёд, пурга, следы, нарты).
const Hero = (() => {
  const H = TUNE.hero;
  // сглаживание, не зависящее от FPS: доля пути за кадр dt при «жёсткости» k (1/с), калибровка — как у прежнего min(1, dt·k) при 60 к/с
  const slick = (x, y) => (typeof Depth !== 'undefined' ? Depth.bareIce(x, y) : onIce(x, y)); // скользко только на голом льду; под снегом — сцепление
  const RATE = k => -60 * Math.log(1 - Math.min(k / 60, 0.99)), ease = (k, dt) => 1 - Math.exp(-dt * RATE(k));
  function lvl(k) { const x = G.skills[k]; let l = 1; for (let i = 1; i < LV.length; i++) if (x >= LV[i]) l = i + 1; return l; }
  function xp(k, n = 1) {
    const b = lvl(k); G.skills[k] += n; const a = lvl(k);
    if (a > b) { Fx.toast(`${SKILLS[k].i} ${SKILLS[k].n} · ур. ${a}`); Sound.ok2(); Fx.floatText(G.p.x, G.p.y - 60, `${SKILLS[k].i} ${a}`); }
  }
  // усталость 0..1 выше порога (TUNE.tire): скорость, рубка, позы
  const TI = TUNE.tire, tire = () => (G && G.s && G.s.tire) || 0;
  const chopTime = () => (G.gear.saw ? H.chopSaw : H.chop) * (1 - H.chopSkill * (lvl('chop') - 1)) * (1 + TI.chop * smooth(TI.chopFrom, 100, tire())); // вымотан — рубит дольше
  const clothMul = () => G.gear.kukhl ? TUNE.cloth.kukhl : G.gear.dokha ? TUNE.cloth.dokha : G.gear.hat ? TUNE.cloth.hat : 1;
  const maxWarm = () => 100 - TUNE.body.frostWarm * G.s.frost;
  // скорость: способ (пешком / лыжи / упряжка / «Буран») × местность (TERRAIN, A7) × волокуша × перегруз × пурга × озноб × вывих
  function speed() {
    const p = G.p, m = Transport.mode(), ter = Zones.terrainAt(p.x, p.y);
    let s = Transport.speedOn(m, ter) || H.speed * ter.walk;
    if (!p.ride) {
      if (G.gear.sled) s *= H.sled;
      if (Inv.weight() > Inv.capKg()) s *= H.over;
      if (G.s.warm < H.coldBelow) s *= H.cold;
      if (p.sprainT > 0) s *= TUNE.zone.sprain;
      // снег: по колено ×0.7 · по пояс ×0.35 · по грудь ×0.2, рывками (js/depth.js; поверхность — уже в TERRAIN.walk); без поля — сугроб ×H.drift
      if (typeof Depth !== 'undefined') s *= Depth.heroMul(); else if (driftAt(p.x, p.y)) s *= H.drift;
      if (p.creaked && World.onThinIce(p)) s *= 0.5; // лёд трещит — ступает осторожно
    }
    if (stormOn() && !p.inside) s *= H.storm;
    s *= 1 - TI.speed * smooth(TI.speedFrom, 100, tire()); // нет сил — плетётся
    return s;
  }
  // шаг движения: разгон/скольжение по льду, снос пургой, следы, нарты следом; перегруз — сообщение
  function move(dt, storm) {
    const p = G.p;
    if (typeof Ice !== 'undefined' && Ice.active()) { p.moving = false; B.glide = false; p.inside = false; return; } // в полынье: телом правит Ice (js/ice.js)
    if (!p.sleeping && !p.doze) { // уснул в снегу — не идёт (будит Survival)
      let mx = input.mx, my = input.my, want = 0;
      const ox = p.x, oy = p.y;
      const len = Math.hypot(mx, my); if (len > 1) { mx /= len; my /= len; }
      p.moving = len > 0.15;
      B.glide = false; // скольжение по льду без ввода — своё состояние тела (не ходьба); действие держит героя на месте
      if (!p.moving && !p.action && slick(p.x, p.y) && Math.hypot(p.vx || 0, p.vy || 0) > PT.glideV) { B.glide = true; const q = 1 - ease(H.iceGrip, dt); p.vx *= q; p.vy *= q; p.x += p.vx * dt; p.y += p.vy * dt; p.face = B.vf; }
      else if (!p.moving) { p.vx = p.vy = 0; B.vf = p.face; }
      if (p.moving) {
        if (p.action) p.action = null;
        let sp = speed();
        const k = slick(p.x, p.y) ? H.iceGrip : H.grip;
        const e = ease(k, dt); p.vx = (p.vx || 0) + (mx * sp - (p.vx || 0)) * e; p.vy = (p.vy || 0) + (my * sp - (p.vy || 0)) * e;
        p.x += p.vx * dt; p.y += p.vy * dt; want = sp * dt;
        B.dr = 0;
        if (storm && !p.inside) { const w = Wind.at(p.x, p.y), k = H.stormDrift * dt * (0.6 + 0.8 * w.gust), v = Math.hypot(p.vx, p.vy) || 1; p.x += w.gx * k; p.y += w.gy * k * 0.6; B.dr = (w.gx * k * p.vx + w.gy * k * 0.6 * p.vy) / v; } // снос — по ветру (Wind.dir, порыв рыщет), сильнее в порыв
        B.drv = dt > 0 ? B.dr / dt : 0; // снос вдоль хода — в путь ногами и скорость шага (стопа в опоре не скользит)
        if (p.ride) Transport.moved(ox, oy);
        if (Math.abs(mx) > 0.1) p.face = Math.sign(mx);
        // видимая сторона (B.vf) — за фактической скоростью: пока тело ещё едет в старую сторону быстрее FACE_V (лёд), не разворачиваем
        const vx = p.vx || 0; if (B.vf !== p.face && !(Math.sign(vx) === B.vf && Math.abs(vx) > FACE_V)) B.vf = p.face;
        p.step += dt * 12;
      }
      contact(p, World.solid(p, 10, 'p'), dt, mx, my, want, ox, oy);
      if (typeof Ice !== 'undefined') Ice.keepOut(p); // открытая полынья — обходить
      if (p.moving) B.odo += Math.max(0, Math.hypot(p.vx || 0, p.vy || 0) * dt + (B.dr || 0)); // путь ногами (после упора — только вдоль стены; снос пургой по ходу — тоже): фаза шага
      if (Math.hypot(p.x - p.lx, p.y - p.ly) > 20) {
        const a = Math.atan2(p.y - p.ly, p.x - p.lx), dr = !p.inside && !!driftAt(p.x, p.y);
        if (!p.inside) Interact.emit('step', { who: 'p', x: p.x, y: p.y, drift: dr });
        // следы ставит рисование — там, где встала стопа (footStep); по пути — только если стоп давно не было (кадр не рисуется)
        if (!p.inside && !p.ride && now - B.feetT > 0.6 && !(typeof Depth !== 'undefined' && Depth.heroSink > 40)) Fx.print(p.x + Math.cos(a + 1.57) * (G.prints.length % 2 ? 4 : -4), p.y + Math.sin(a + 1.57) * (G.prints.length % 2 ? 4 : -4), a, 'p', dr ? 1.35 : 1);
        // задел ветку / кочку на ходу — отклик решают правила Interact (кочки густо: только одна ближайшая)
        if (!p.inside) {
          NB.length = 0; for (const t of treesNear(p.x, p.y, 26, NB)) if (t.wood > 0 && !t.shake) Interact.emit('brush', { who: 'p', target: t, obj: 'tree', x: t.x, y: t.y });
          const t = Space.nearest(Space.tussocks, p.x, p.y, 20, tt => !tt.shake); if (t) Interact.emit('brush', { who: 'p', target: t, obj: 'tussock', x: t.x, y: t.y });
        }
        p.lx = p.x; p.ly = p.y;
      }
      // нарты тянутся следом
      const sdx = p.x - p.sx, sdy = p.y - p.sy, sd = Math.hypot(sdx, sdy);
      if (sd > 34) { p.sx = p.x - sdx / sd * 34; p.sy = p.y - sdy / sd * 34; }
    } else { p.moving = false; B.glide = false; }
    p.inside = insideHut(p.x, p.y);
    if (typeof Depth !== 'undefined') Depth.tickHero(dt); // провал в снег: плавно, траншея, разлёт снега
  }
  // упор в препятствие (c — World.solid): гасим скорость «в стену» → герой скользит вдоль; удар 'bump' и упор 'push' — в Interact.
  // Поля p.blocked/bumpCd/touchT/pressT/pushN — только рантайм (в сейве безвредны).
  const NB = [];
  function contact(p, c, dt, mx, my, want, ox, oy) {
    const I = TUNE.interact;
    p.bumpCd = Math.max(0, (p.bumpCd || 0) - dt);
    p.blocked = !!c && p.moving && Math.hypot(p.x - ox, p.y - oy) < want * I.blocked;
    if (!c) { p.touchT = (p.touchT || 0) + dt; p.pressT = 0; return; }
    const vn = (p.vx || 0) * c.nx + (p.vy || 0) * c.ny, fresh = (p.touchT || 0) > 0.25;
    p.touchT = 0;
    if (vn < 0) { p.vx -= vn * c.nx; p.vy -= vn * c.ny; }
    const ex = p.x - c.nx * 10, ey = p.y - c.ny * 10;
    if (-vn > I.bumpV && fresh && p.bumpCd <= 0) {
      p.bumpCd = I.bumpCd; p.x += c.nx * I.bumpBack; p.y += c.ny * I.bumpBack;
      Interact.emit('bump', { who: 'p', x: ex, y: ey, obj: c.k, target: c.o, power: clamp(-vn / (H.speed * 1.3), 0, 1), nx: c.nx, ny: c.ny, inside: p.inside });
    }
    if (p.moving && mx * c.nx + my * c.ny < -0.3) {
      if (!p.pressT) p.pushN = I.pushEvery;
      p.pressT = (p.pressT || 0) + dt;
      if (p.pressT >= p.pushN) { p.pushN += I.pushEvery; Interact.emit('push', { who: 'p', obj: c.k, target: c.o, x: ex, y: ey, t: p.pressT, inside: p.inside }); }
    } else p.pressT = 0;
  }
  // перегруз: один раз при переходе через предел
  function tickLoad() {
    const p = G.p, over = Inv.weight() > Inv.capKg();
    if (over && !p.overW) Fx.toast(`:weight: Перегруз ${Inv.weight()}/${Inv.capKg()} кг — медленно · лабаз или тайник`);
    p.overW = over;
  }
  // ---------- «живой» герой: возня стоя, походка по обстановке, реакции, позы работы по состоянию ----------
  // Всё — память модуля (не в G): сейвы не меняются. Позы — ArtPeople.register (js/art-poses.js); нет позы — не играем.
  const LR = mulberry(0x11FE), lr = (a, b) => a + LR() * (b - a); // своя случайность: Math.random игры не тратим
  const LF = { still: 0, next: 2, last: '', slipCd: 0, dir: null, wolf: false, sub: false, out: -9 }, LT = TUNE.life, PT = TUNE.pose;
  const has = k => !!(window.ArtPeople && ArtPeople.POSE[k]);
  const can = k => has(k) || !!(window.ArtPeople && ArtPeople.DUR[k]); // встроенные позы (swing, hurt, chop) — без register

  // ---------- тело героя: один автомат (кто владеет телом, кто кого прерывает, что после конца) ----------
  // Владелец — первая строка ORDER, чьё условие верно. Разовые позы (gesture < react < hurt) — только через play():
  // новая вытесняет текущую, если её PRI не меньше; действие, сон, верхом — снимают разовую; ввод движения снимает её через commit с (TUNE.pose).
  // Конец чего угодно → следующая строка ORDER: walk при вводе, иначе glide/panel/idle; смешивание поз 0.13 с — ArtPeople.draw (key).
  // Ходьба — только из ввода и своей скорости (p.vx/vy), не из сдвига на экране: рывки, телепорты, отскоки, ветер позу не меняют.
  // Рантайм, не в G: сейвы не меняются.
  const PRI = { gesture: 1, react: 2, hurt: 3 };
  // vf — сторона, куда герой смотрит на экране (p.face — игровая: куда ставить/бить; расходятся только на ходу/скольжении)
  const B = { s: 'idle', since: 0, one: null, act: null, sw: 0, hurt: 0, glide: false, odo: 0, pp: null, vf: 1, feetT: -9 };
  const FACE_V = 25; // px/с: быстрее этого в старую сторону — ещё не развернулся
  // стопа героя встала на снег (ArtPeople.draw → o.onStep): след в этой точке, по направлению хода
  function footStep(x, y, i, a) {
    const p = G.p; if (p.inside || p.ride || p.sleeping) return;
    B.feetT = now; const dk = typeof Depth !== 'undefined' ? Depth.heroSink : driftAt(x, y) ? 30 : 0;
    if (dk > 40) return; // глубже колена — не следы, а траншея (js/depth.js)
    Fx.print(x, y, a, 'p', dk > 22 ? 1.35 : 1);
  }
  const vface = () => { const p = G.p; return (p.moving || B.glide) && !p.ride ? B.vf : p.face; };
  const intent = () => { const p = G.p; return !!p.moving && !p.sleeping && !p.ride && !UI.kind; };
  const ORDER = [
    ['sleep', p => p.sleeping || p.doze], ['ice', () => typeof Ice !== 'undefined' && Ice.active()], ['ride', p => p.ride], ['act', p => p.action], ['one', () => B.one],
    ['walk', () => intent()], ['glide', () => B.glide], ['panel', p => (B.pp = UI.kind ? panelPose(p) : null)], ['idle', () => true],
  ];
  const STATES = ['sleep', 'ice', 'ride', 'act', 'hurt', 'react', 'gesture', 'walk', 'glide', 'panel', 'idle'];
  // разовая поза: o.react — реакция/подбор, o.kind:'hurt' — урон, иначе возня/жест; tg — точка в мире, th — высота касания, ik — тянуть руку; a0..a1 — доля позы
  function play(k, o = {}) {
    const p = G.p, kind = o.kind || (o.react ? 'react' : 'gesture');
    if (!can(k) || p.sleeping || p.ride || p.action) return false; // тело занято главнее
    if (B.one && PRI[B.one.kind] > PRI[kind] && now - B.one.t0 < B.one.dur) return false;
    B.one = { k, kind, t0: now, dur: o.dur || ArtPeople.DUR[k] || 1, tg: o.tg || null, th: o.th || 0, ik: o.ik === undefined ? true : !!o.ik, a0: o.a0 || 0, a1: o.a1 == null ? 1 : o.a1, commit: PT.commit[k] || 0 };
    LF.last = k; LF.still = 0;
    if (k === 'brushSnow' && typeof Depth !== 'undefined') Depth.brush(); // отряхнул — снега на одежде меньше
    return true;
  }
  // рубка доигрывает замах до конца удара (A9) — только без ввода и без нового действия
  function tail(e) {
    const c = chopCycle(e), a0 = (Math.min(e.t, e.dur) % c.cl) / c.cl, [lo, hi] = PT.tail, k = e.pose && ArtPeople.POSE[e.pose] ? e.pose : 'chop';
    if (a0 > lo && a0 < hi) play(k, { a0, a1: hi, dur: (hi - a0) * (ArtPeople.DUR[k] || ArtPeople.DUR.chop), tg: e.tg, th: e.th || 0 });
  }
  // переходы: сигналы, действия, конец/прерывание разовой позы; возвращает текущее состояние. Идемпотентно (можно звать из рисования).
  function sync() {
    const p = G.p, a = p.action, mv = intent(), sw = p.swing || 0, hu = G.hurt || 0;
    // сигналы модулей, что об автомате не знают (волки, шатун, обвал): замах p.swing, урон G.hurt
    if (sw > B.sw + 1e-3) play('swing', { react: 1 }); B.sw = sw;
    if (hu > B.hurt + 1e-3 && hu > 0.7) play('hurt', { kind: 'hurt' }); B.hurt = hu;
    if (a !== B.act) { const e = B.act; B.act = a; if (a) B.one = null; else if (e && e.k === 'chop' && !mv && !G.gear.saw) tail(e); }
    const o = B.one;
    if (o) { const el = now - o.t0; if (el >= o.dur || p.sleeping || p.ride || a || (mv && el >= o.commit)) B.one = null; }
    let s = 'idle'; for (const [k, f] of ORDER) if (f(p)) { s = k; break; }
    if (s === 'one') s = B.one.kind;
    if (s !== B.s) { B.s = s; B.since = now; }
    return s;
  }
  // поза действия p.action: чем и к чему (A6 — удар на конце цикла; жесты — разовые по доле, петли — по циклу)
  function actPose(a, r) {
    const D = ArtPeople.DUR, POSE = ArtPeople.POSE, p = G.p;
    if (a.k === 'chop') { const c = chopCycle(a); r.anim = a.pose && POSE[a.pose] && r.tool !== 'saw' ? a.pose : 'chop'; r.animT = (a.t % c.cl) / c.cl; r.tg = a.tg; r.th = a.th || 0; r.ik = r.tool !== 'saw'; }
    else if (a.pose) {
      r.anim = POSE[a.pose] ? a.pose : a.fb || 'idle';
      const per = a.k === 'wreck' ? chopCycle(a).cl : a.per || D[r.anim] || 1;
      r.animT = r.anim === 'swing' || !(a.loop || a.per) ? clamp(a.t / a.dur, 0, 1) : (a.t % per) / per;
      if (a.k === 'wreck' || a.k === 'loot') r.tool = r.anim.startsWith('chop') ? 'axe' : 'none'; // обломки отжимают руками; запасная рубка — топором
      r.tg = a.tg; r.th = a.th || 0;
    }
    else if (a.k === 'dig') { r.anim = 'dig'; r.animT = (a.t % D.dig) / D.dig; }
    else if (a.k === 'fish') { r.anim = a.ph === 'bite' ? 'fishBite' : 'fish'; r.animT = clamp(a.t / a.dur, 0, 1); r.tool = 'rod'; r.target = { x: a.o.x, y: a.o.y }; }
    else { r.anim = 'build'; r.animT = (a.t % D.build) / D.build; r.ik = false; r.tg = a.k === 'light' ? a.o : a.k === 'vfix' ? G.veh && G.veh.buran : a.k === 'place' ? { x: p.x + p.face * 20, y: p.y + 6 } : null; }
  }
  // что рисовать сейчас — единственный источник позы героя для GFX: {st, anim, animT, tool, tg, th, ik, target, loco, speed, vy}
  function pose() {
    const p = G.p, s = sync(), D = ArtPeople.DUR;
    const r = { st: s, anim: 'idle', animT: 0, tool: G.gear.saw ? 'saw' : 'axe', tg: null, th: 0, ik: true, target: null, loco: false, speed: 0, vy: 0 };
    if (s === 'sleep') r.anim = 'sleep';
    else if (s === 'ice') { const q = Ice.pose(); r.anim = has(q.k) ? q.k : 'hurt'; r.animT = q.a; r.tool = 'none'; } // полынья: провал → в воде → кромка → ползком → на ноги
    else if (s === 'ride') r.anim = 'sit';
    else if (s === 'act') actPose(p.action, r);
    else if (PRI[s]) { const o = B.one; r.anim = o.k; r.animT = o.a0 + (o.a1 - o.a0) * clamp((now - o.t0) / o.dur, 0, 1); r.tg = o.tg; r.th = o.th; r.ik = o.ik; }
    else if (s === 'walk') { const v = Math.max(0, Math.hypot(p.vx || 0, p.vy || 0) + (B.drv || 0)), l = Math.hypot(input.mx, input.my) || 1; r.loco = true; r.speed = v; r.anim = walkPose(v > PT.runV); r.vy = clamp(input.my / l, -1, 1); }
    else if (s === 'glide') { r.anim = has('slip') ? 'slip' : 'idle'; r.animT = PT.glideA; }
    else if (s === 'panel') { const q = B.pp, d = D[q.k] || 1.6; r.anim = q.k; r.animT = (now % d) / d; r.tg = q.tg || null; r.th = q.th || 0; r.ik = !!q.ik; }
    else { r.anim = idlePose(); if (r.anim !== 'idle') { const f = heat(); r.animT = (now % 1.6) / 1.6; if (f) { r.tg = f; r.th = -8; } } }
    // выкарабкивается из глубокого (Depth.climb 0..1 — по ходу, только при вводе; отпустил — замер на месте позы)
    const ck = typeof Depth !== 'undefined' ? Depth.climb : -1;
    if (ck >= 0 && (s === 'walk' || s === 'idle') && has('climbOut')) { r.anim = 'climbOut'; r.animT = ck; r.loco = false; r.speed = 0; r.tg = null; }
    if (p.torch > 0 && s !== 'act' && r.anim !== 'swing' && r.anim !== 'sleep') r.tool = 'torch';
    // усталость/холод 0..1 — только для рисования (походка ниже, мах рук короче, дыхание чаще); до порогов поз tired/cold — плавно
    r.tire = clamp(Math.max((38 - G.s.warm) / 20, (38 - G.s.food) / 20, (50 - G.s.hp) / 22, typeof Depth !== 'undefined' ? Depth.effort() * 0.8 : 0, (tire() - 50) / 40), 0, 1);
    return r;
  }
  // герой в открытой панели/диалоге (игра стоит, он «занят»): поза-петля и к чему обращён; null — обычный idle
  const PICK = (k, fb) => (ArtPeople.POSE[k] ? k : fb);
  function panelPose(p) {
    const k = UI.kind, P = UI.panel, near = (o, r) => o && dist2(o, p) < r * r;
    if (k === 'dialog') {
      const d = UI.talk; if (!d) return null;
      const o = d.who === 'radio' ? (p.inside ? SPOT.bench : null) : NPCS[d.who] && !NPCS[d.who].voice ? Npc.state(d.who) : null;
      return { k: d.hero ? PICK('talkHero', 'talk') : PICK('listen', 'idle'), tg: o ? { x: o.x, y: o.y } : null };
    }
    if (k === 'trade') { const o = Npc.state(P.trade); return { k: now % 6 < 3.5 ? PICK('rummage', 'idle') : PICK('listen', 'idle'), tg: o ? { x: o.x, y: o.y } : null }; }
    if (k === 'chest') return { k: PICK('rummage', 'idle'), tg: p.inside ? SPOT.chest : null, th: -10, ik: 1 };
    if (k === 'stash') return { k: PICK('rummage', 'idle'), tg: P.stash, th: -6, ik: 1 };
    if (k === 'craft') {
      if (P.tab === 'market' || P.tab === 'epoch') return { k: PICK('rummage', 'idle'), tg: G.col && G.col.builds.find(b => b.done && near(b, 160) && (b.type === 'market' || b.type === 'forge')) };
      if (p.inside && near(SPOT.bench, 90)) return { k: PICK('craft', 'build'), tg: SPOT.bench, th: -24 };
      if (P.tab === 'build' || P.tab === 'hut') return { k: PICK('lookAround', 'idle') };
      const f = Fire.near(TUNE.fire.heatR); return { k: PICK('craft', 'build'), tg: f || { x: p.x + p.face * 18, y: p.y + 4 } };
    }
    if (k === 'note') { for (const id in NOTES) if (near(NOTES[id], 70)) return { k: PICK('crouch', 'idle'), tg: NOTES[id] }; }
    return null;
  }
  // рывок/телепорт (сел на пень, лёг, сел в нарты, слез, провалился): скорость и след не тянутся через скачок; позу не трогает
  function snap() { const p = G.p; p.vx = p.vy = 0; p.lx = p.x; p.ly = p.y; B.glide = false; B.vf = p.face; }
  // для проверок (tests/body-check.js): сбросить память автомата под текущее G
  function bodyReset() { B.one = null; B.act = G.p.action; B.sw = G.p.swing || 0; B.hurt = G.hurt || 0; B.glide = false; B.vf = G.p.face; B.s = 'idle'; B.since = now; }
  const cold = () => G.s.warm < 30, freezing = () => G.s.warm < 20, tired = () => G.s.food < 20 || G.s.hp < 30 || tire() > TI.tired;
  const outStorm = () => stormOn() && !G.p.inside;
  // рубка по состоянию: устал/голоден → тяжело, мёрзнет → зябко, пурга → пригнувшись (длительность — TUNE.act.chopK)
  function chopPose() {
    const k = tired() ? 'chopHeavy' : freezing() ? 'chopCold' : outStorm() ? 'chopLow' : 'chop';
    return G.gear.saw || !has(k) ? 'chop' : k;
  }
  // цикл замахов долгого действия: n ударов, удар (a = ia) в каждом цикле; последний — на конце действия (A6)
  // момент удара в цикле позы (js/art-poses.js): тяжело — позже, на морозе — раньше (топор застревает), пригнувшись — 0.44
  const IMPACT = { chop: 0.52, chopHeavy: 0.62, chopCold: 0.37, chopLow: 0.44 };
  function chopCycle(a) { const d = ArtPeople.DUR[a.pose] || ArtPeople.DUR.chop, n = Math.max(1, Math.round(a.dur / d)), ia = IMPACT[a.pose] || IMPACT.chop; return { n, ia, cl: a.dur / (n - 1 + ia) }; }
  const pickPose = id => (ITEMS[id] && ITEMS[id].kg >= 3 ? 'pickUpHeavy' : 'pickUp');
  // походка по обстановке
  function walkPose(run) {
    const p = G.p; if (run || p.ride) return run ? 'run' : 'walk';
    const dk = typeof Depth !== 'undefined' ? Depth.heroSink : driftAt(p.x, p.y) ? 40 : 0; // провал, см: по пояс и глубже — «плывёт» руками
    const k = !p.inside && dk > 85 && has('wade') ? 'wade' : !p.inside && dk > 25 ? 'trudge' : outStorm() ? 'shield' : freezing() ? 'cold' : tired() ? 'tired' : 'walk';
    return has(k) ? k : 'walk';
  }
  // чем греться стоя: горящая печь рядом (в избе) или костёр (снаружи, без факела в руке); точка в мире | null
  function heat() {
    const p = G.p;
    if (p.inside) return G.hut.fuel > 0 && dist2(SPOT.stove, p) < LT.stoveR * LT.stoveR ? SPOT.stove : null;
    return p.torch > 0 ? null : Fire.near(TUNE.fire.heatR * 0.6);
  }
  // стоя без дела: у огня или печи — греет руки, на морозе — дрожит
  function idlePose() {
    if (!G.p.inside && typeof Depth !== 'undefined' && Depth.heroSink > 95 && has('wade')) return 'wade'; // по грудь в снегу: руки на снегу, не опущены
    if (heat()) { const k = cold() ? 'warmHandsCold' : 'warmHands'; if (has(k)) return k; }
    if (freezing() && has('shiver')) return 'shiver';
    return 'idle';
  }
  const TWO = { rubHands: 1, blowHands: 1, stretch: 1, brushSnow: 1, adjustPack: 1 }; // двуручная возня — не с факелом в руке
  // возня по ситуации (веса), без повтора подряд
  function pickFidget() {
    if (typeof Depth !== 'undefined' && Depth.heroSink > 60) return null; // по пояс в снегу не возится (нос не вытирает)
    const p = G.p, W = [], add = (k, w) => { if (k !== LF.last && has(k) && !(p.torch > 0 && TWO[k])) W.push([k, w]); };
    if (cold()) { add('stamp', 3); add('rubHands', 3); add('blowHands', 2); }
    if (outStorm()) { add('brushSnow', 3); add('wipeNose', 1.5); }
    if (daylight() < 0.3) add('lookAround', 3);
    if (tired()) { add('yawn', 3); add('stretch', 2); }
    if (Inv.weight() > Inv.capKg() * 0.7) add('adjustPack', 3);
    add('lookAround', 1); add('adjustPack', 0.8); add('wipeNose', 0.8); add('stretch', 0.4); if (!p.inside) add('brushSnow', 0.4);
    let s = 0; for (const w of W) s += w[1]; let r = LR() * s;
    for (const w of W) if ((r -= w[1]) <= 0) return w[0];
    return null;
  }
  function tickLife(dt) {
    const p = G.p;
    if (!LF.sub && typeof Interact !== 'undefined') {
      LF.sub = true;
      // отшатнуться — только от сильного удара и не чаще раза в staggerCd: обходя ствол, не «бьётся головой»
      let stagT = -9; Interact.on('bump', e => { if (e.who === 'p' && e.power > TUNE.pose.staggerP / (1 + tire() / 50) && now - stagT > TUNE.pose.staggerCd) { stagT = now; play('stagger', { react: 1 }); } });
      Interact.on('howl', () => { if (!G.p.sleeping) play('flinch', { react: 1 }); });
    }
    LF.slipCd -= dt;
    // лёд: резкий разворот на скорости — поскользнулся
    const len = Math.hypot(input.mx, input.my);
    if (len > 0.3) {
      const d = Math.atan2(input.my, input.mx), v = Math.hypot(p.vx || 0, p.vy || 0);
      if (LF.dir !== null && LF.slipCd <= 0 && v > LT.slipV && slick(p.x, p.y) && !p.ride && Math.abs(Math.atan2(Math.sin(d - LF.dir), Math.cos(d - LF.dir))) > 1.2) {
        LF.slipCd = LT.slipCd; if (LR() < LT.slipP * (1 + tire() / 50) && play('slip', { react: 1 })) { Sound.tone('triangle', 900, 400, 0.12, 0.05); ArtWorld.fx.snowPuff(G.parts, p.x, p.y, 0.3); }
      }
      LF.dir = d;
    } else LF.dir = null;
    // волк выскочил близко — вздрогнул (по фронту)
    const R = LT.flinchR, wn = G.wolves.some(w => w.st !== 'retreat' && dist2(w, p) < R * R);
    if (wn && !LF.wolf && !p.sleeping) play('flinch', { react: 1 });
    LF.wolf = wn;
    // стоит без дела → возня
    sync(); // переходы тела — до расписания возни (ввод уже снял прерываемую позу)
    if (p.moving || p.action || p.sleeping || p.ride || B.glide || UI.modal()) { if (LF.still >= 0) LF.next = lr(LT.fidget[0], LT.fidget[1]); LF.still = -1e-9; return; }
    if (LF.still < 0) LF.still = 0;
    if (B.one) return;
    // выбрался из глубокого и остановился (≤ 4 с) — отряхивается
    if (typeof Depth !== 'undefined' && Depth.outT !== LF.out && G.time - Depth.outT < 4 && Depth.heroSink < 40) { LF.out = Depth.outT; if (play('brushSnow')) return; }
    LF.still += dt;
    if (LF.still > LF.next) { LF.still = 0; LF.next = lr(LT.again[0], LT.again[1]); const k = pickFidget(); if (k) play(k); }
  }
  return { lvl, xp, chopTime, clothMul, maxWarm, speed, move, tickLoad, play, has, chopPose, chopCycle, pickPose, walkPose, idlePose, heat, tickLife,
    sync, pose, snap, bodyReset, STATES, PRI, vface, footStep, odo: () => B.odo, get body() { return B; } };
})();
