'use strict';
// Исполнитель персонажей: читает NPCS (js/content/npcs.js) — состояние, движение, разговор, торговля, хуки.
// Новый персонаж не требует правок здесь: запись в NPCS (+ облик в art-people.js, если нужен свой).
const Npc = (() => {
  const ids = () => Object.keys(NPCS).filter(id => !NPCS[id].voice);
  // состояние персонажа в G: G[slot] (Уркачан, Вера) или G.npcs[id]
  function state(id) { const r = NPCS[id]; return r.slot ? G[r.slot] : (G.npcs && G.npcs[id]); }
  // новая игра / загрузка старого сейва: создать недостающие состояния
  function ensure() {
    for (const id of ids()) {
      const r = NPCS[id]; if (!r.init || state(id)) continue;
      if (r.slot) G[r.slot] = r.init(); else (G.npcs = G.npcs || {})[id] = r.init();
    }
  }
  const beh = (r, st) => (r.states && r.states[st.state]) || {};
  // персонажи в мире (для рендера, мини-карты, выбора мышью): [{id, rec, st}]
  function list() {
    const out = [];
    for (const id of ids()) { const r = NPCS[id], st = state(id); if (st && !beh(r, st).hidden) out.push({ id, rec: r, st }); }
    return out;
  }
  // с кем можно заговорить (E) — для Actions.context
  function context(p) {
    for (const id of ids()) {
      const r = NPCS[id], st = state(id); if (!st) continue;
      const b = beh(r, st); if (b.hidden || b.talk === false) continue;
      if (r.canTalk && !r.canTalk(G)) continue;
      if (dist2(st, p) < r.talkR * r.talkR) return { k: id, npc: 1, label: r.label || r.n, o: st };
    }
    return null;
  }

  // ---------- разговор ----------
  const node = (n, g) => typeof n === 'function' ? n(g) : DIALOG[n];
  function say(r, id, s) {
    let t;
    if (s.idle === 'any') {
      const lines = r.idle.filter(([c]) => c(G)).map(([, t]) => t).concat(s.tips ? r.tips : []);
      t = lines[(Math.random() * lines.length) | 0];
    } else {
      let n = { t: (r.idle.find(([c]) => c(G)) || [0, DIALOG[s.fallback].t])[1] };
      if (s.chance && Math.random() < s.chance[0]) n = DIALOG[s.chance[1]];
      const top = (s.topics || []).find(q => q.if(G));
      if (top) { n = node(top.node, G); if (top.do) Story.run(top.do); }
      t = n.t;
    }
    return t;
  }
  function menu(r) { return (r.menu || []).filter(o => !o.if || o.if(G)).map(({ if: _, ...o }) => o); }
  // узел разговора с персонажем: первое сработавшее правило talk
  function talk(id) {
    const r = NPCS[id];
    for (const q of r.talk) {
      if (q.quest) { const n = Quests.node(q.quest); if (n) return n; continue; }
      if (q.say) {
        const opts = q.menu ? menu(r) : [{ t: 'Пока' }];
        return { who: id, t: say(r, id, q.say), opts };
      }
      if (!q.if || q.if(G)) { if (q.do) Story.run(q.do); return node(q.node, G); }
    }
    return null;
  }
  // вариант {run} в диалоге: обработчик персонажа → id следующего узла (или null)
  function run(id, h) { const r = NPCS[id], f = r && r.run && r.run[h]; return f ? f(G, state(id)) : null; }
  function closed(who) { const r = NPCS[who]; if (r && r.onClose) r.onClose(G); }
  function dawn() { for (const id of ids()) { const r = NPCS[id]; if (r.onDawn) r.onDawn(G, state(id)); } }

  // ---------- движение по состоянию ----------
  const MOVES = {
    // стоит и смотрит на героя
    face(u, b, dt) { u.face = Math.sign(G.p.x - u.x) || u.face; },
    // идёт к точке b.to(); дошёл — состояние b.arrive
    goto(u, b, dt) {
      // обход вещей и стволов (World.walk: Nav + упор + шаг в сторону); цель внутри вещи — к её краю
      const t = b.to(), fr = World.freeNear(t.x, t.y, 9);
      if (Math.hypot(fr.x - u.x, fr.y - u.y) < 8 || World.walk(u, t.x, t.y, b.speed, dt) < 8) u.state = b.arrive; else u.step += dt * 8;
    },
    // ковыляет за героем (или сама к двери избы, если герой внутри); вошла в избу — состояние b.into у лежанки
    follow(v, b, dt) {
      const p = G.p, d = dist(v, p);
      const tgt = p.inside && !insideHut(v.x, v.y) ? (Math.abs(v.x - HUT.x) < 12 && v.y > HUT_IN.y0 ? { x: HUT.x, y: HUT.y } : { x: HUT.x, y: HUT_IN.y1 + 30 }) : p;
      const dt2 = dist(v, tgt);
      // отстала — всё равно ковыляет следом
      if (d > b.lagR) { v.waitT -= dt; if (v.waitT <= 0) { v.waitT = b.lagT; Fx.toast(b.lagToast); } }
      if (dt2 > (tgt === p ? 56 : 2)) {
        // обход избы/построек по сетке Nav; у деревьев — шаг в сторону, если застряла
        const q = dt2 > 40 && !insideHut(tgt.x, tgt.y) ? Nav.way(v, tgt.x, tgt.y) : tgt;
        let dx = q.x - v.x, dy = q.y - v.y; const dq = Math.hypot(dx, dy) || 1;
        dx /= dq; dy /= dq;
        if (v.sideT > 0) { v.sideT -= dt; const sx = -dy * v.side, sy = dx * v.side; dx = dx * 0.3 + sx; dy = dy * 0.3 + sy; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; }
        const sp = d > b.lagR ? b.slow : (typeof b.speed === 'function' ? b.speed(G) : b.speed), st = Math.min(sp * dt, q === tgt ? dt2 : dq);
        const x0 = v.x, y0 = v.y;
        v.x += dx * st; v.y += dy * st; v.face = Math.sign(dx) || v.face; v.step += dt * 6;
        World.solid(v, 9, 'n');
        v.chk = (v.chk || 0) + dt; v.moved = (v.moved || 0) + Math.hypot(v.x - x0, v.y - y0);
        if (v.chk > 0.8) { if (v.moved < 12 && !(v.sideT > 0)) { v.sideT = 0.7; v.side = Math.random() < 0.5 ? 1 : -1; } v.chk = 0; v.moved = 0; }
      }
      if (insideHut(v.x, v.y)) { v.state = b.into; v.x = SPOT[b.bed].x; v.y = SPOT[b.bed].y; Fx.toast(b.intoToast); }
    },
  };
  // распорядок: b.at(g, u) → точка по часу (дом, будка, мачта…); пока с ним говорят — стоит; дошёл — смотрит на героя
  MOVES.sched = function (u, b, dt) {
    const t = b.at(G, u);
    if (!t || (UI.modal() && dist2(u, G.p) < 110 * 110)) return MOVES.face(u, b, dt);
    const fr = World.freeNear(t.x, t.y, 9); // точка распорядка у стены/в вещи — встаём у края
    if (Math.hypot(fr.x - u.x, fr.y - u.y) < 6) return MOVES.face(u, b, dt);
    if (World.walk(u, t.x, t.y, b.speed, dt) < 6) return MOVES.face(u, b, dt);
    u.step += dt * 8;
  };
  // появиться в точке to: не возникнуть у двери, а прийти из-за края видимости (от своего дома — чум деда — или от героя прочь)
  function arrive(id, to) {
    const st = state(id), r = NPCS[id], p = G.p; if (!st || !to) return;
    const home = r.from || (id === 'urk' ? POI.chum : null);
    let dx = home ? home.x - to.x : to.x - p.x, dy = home ? home.y - to.y : to.y - p.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const hw = (typeof GFX !== 'undefined' && GFX.vw ? GFX.vw : 1280) / 2 + 70, hh = (typeof GFX !== 'undefined' && GFX.vh ? GFX.vh : 800) / 2 + 90;
    let d = 200;
    for (; d < 1600; d += 40) { const x = to.x + dx * d, y = to.y + dy * d; if (Math.abs(x - p.x) > hw || Math.abs(y - p.y) > hh) break; }
    st.x = clamp(to.x + dx * d, 40, W - 40); st.y = clamp(to.y + dy * d, 40, H - 40); st.come = { x: to.x, y: to.y };
  }
  function come(st, dt) {
    const c = st.come;
    if ((st.comeT = (st.comeT || 0) + dt) > 60 || World.walk(st, c.x, c.y, 78, dt) < 6) { st.come = null; st.comeT = 0; return; }
    st.step = (st.step || 0) + dt * 8;
  }
  function tick(dt) {
    for (const id of ids()) {
      const r = NPCS[id], st = state(id); if (!st) continue;
      if (r.tick) r.tick(G, st, dt);                      // хук персонажа: смена состояния по времени (почтальон приезжает)
      if (st.come) { come(st, dt); continue; }             // идёт к месту появления (Story: шаг npc с at)
      const b = beh(r, st); if (b.move && MOVES[b.move]) MOVES[b.move](st, b, dt);
    }
  }

  // ---------- торговля: товар за «валюту» персонажа (пушнина деда, керосин Тамары, еда вахты…) ----------
  // trade.pay — чем платят (ключи ITEMS), trade.val — цена единицы (по умолчанию ITEMS[k].fur), trade.price — наценка
  const tr = (id = 'urk') => NPCS[id].trade;
  const unit = (id, k) => (tr(id).val && tr(id).val[k]) || ITEMS[k].fur || 1;
  const price = (t, id = 'urk') => tr(id).price ? tr(id).price(t, G) : t.p;
  const furTotal = (id = 'urk') => tr(id).pay.reduce((s, k) => s + Inv.cnt(k, false) * unit(id, k), 0);
  function buy(t, id = 'urk') {
    const pr = price(t, id), st = state(id);
    if (st.stock[t.id] <= 0 || (t.gear && G.gear[t.gear]) || furTotal(id) < pr) return false;
    let left = pr;
    for (const k of tr(id).pay) while (left > 0 && Inv.cnt(k, false) > 0) { Inv.take(k, 1, false); left -= unit(id, k); }
    st.stock[t.id]--;
    if (t.out) for (const [k, v] of Object.entries(t.out)) Inv.add(k, v);
    if (t.gear) G.gear[t.gear] = 1;
    if (t.rub && G.col) G.col.rub += t.rub;
    if (t.set) Story.run([{ set: t.set }]);
    if (t.ops) Story.run(t.ops);
    Fx.toast(`${t.i} ${t.n}`); Sound.ok2(); return true;
  }

  return { state, ensure, list, context, talk, run, closed, dawn, tick, MOVES, price, furTotal, buy, unit, arrive };
})();
