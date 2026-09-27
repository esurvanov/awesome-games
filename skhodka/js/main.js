// Сборка «Сходки»: заставка → анкета → чат перед встречей → вечер в зале → итог с общим фото.
// Один rAF-цикл (core.Loop): симуляция фиксированным шагом, отрисовка — раз в кадр. Мир → люди в 3D
// (view() → People.set), час → свет зала, события → эффекты сцены, разговор → наезд камеры и подсветка.
// Ввод по залу: клик/тап по человеку — подойти и заговорить, по месту — сесть, по полу — идти.
// window.SKHODKA — всё состояние для тестов и отладки. ?seed=N — повторить вечер.
'use strict';
L.def('main', () => {
const { CONTENT } = L.use('content/index');
const { World } = L.use('sim/world');
const { Loop, RNG, Settings, $, clamp } = L.use('core');
const { Scene } = L.use('render/scene');
const { People } = L.use('render/people');
const { makeLook } = L.use('render/looks');
const { LEVELS } = L.use('render/quality');
const { Ui } = L.use('ui/ui');

const Q = new URLSearchParams(location.search);
const LAY = CONTENT.LAYOUT;
const STEP = 1 / 30;

// подсказки анкеты { sex, hair, beard, glasses, style } → подсказки makeLook
const HAIR = { short: 'short', long: 'long', bun: 'bun', curly: 'curly', bald: 'bald' };
function playerHints(h = {}) {
  if (h && h.hair && typeof h.hair === 'object') return { sex: h.sex, style: h.style, prop: null, look: h }; // анкета отдала полный look
  const f = h.sex === 'f';
  const look = { hair: { style: HAIR[h.hair] || (f ? 'long' : 'short') }, beard: f ? 'none' : (h.beard || 'none'), glasses: h.glasses ? 'square' : null };
  return { sex: f ? 'f' : 'm', style: h.style || 'it', prop: null, look };
}
const qualityLevel = q => q === 'medium' ? 'mid' : q;
// музыканты событий: где стоят (поле сцены: [x, z, y подиума, куда смотрит]), облик
const STAGE = {
  sax: { id: 'sax-player', at: 'saxAt', salt: 0x5a5,
    // светлый костюм и шляпа — читается сверху на тёмном полу и в розовом луче
    hints: { sex: 'm', prop: 'sax', oddball: { id: 'sax', top: { kind: 'blazer', color: '#f1e9d6', accent: '#1c1c24' }, hat: { kind: 'fedora', color: '#f4efe4' } } } },
  karaoke: { id: 'karaoke-singer', at: 'karaokeAt', salt: 0x6ac,
    hints: { sex: 'f', prop: 'mic', style: 'party', oddball: 'karaoke' } },
};

const G = {
  w: null, sc: null, pp: null, ui: null, loop: null, profile: null,
  paused: false, ended: false, extras: new Set(), shot: null, seed: 0,
  errs: 0, hoverId: null, knownKey: '', talkId: null,

  // ─── запуск: зал живёт с первого кадра (за заставкой — вечерний SushiGO) ───
  boot() {
    const cv = $('view');
    this.sc = new Scene(cv, { quality: Settings.get('quality') || 'auto' });
    this.pp = new People(this.sc.scene);
    this.ui = new Ui($('ui'), { scene: this.sc, people: this.pp, content: CONTENT });
    this.sc.setHour(19);
    this.sc.follow({ x: LAY.door.x, z: LAY.door.z + 3 });
    this.buildMarks();
    this.bindInput(cv);
    const U = this.ui.bus;
    U.on('pause', on => { this.paused = !!on; });
    U.on('quality', q => this.setQuality(q));
    this.loop = new Loop({
      step: STEP, maxSteps: 8,
      scale: () => this.scale(),
      update: dt => this.safe('шаг', () => this.w.step(dt)),
      render: (a, dt) => this.safe('кадр', () => this.frame(dt)),
    });
    this.loop.start();
    this.ui.showTitle(() => this.ui.showProfile(p => { this.profile = p; this.preChat(); }));
  },
  preChat() { this.ui.showPreChat(vote => this.start(vote)); },
  // ошибки не глотаем: в консоль (первые 20), цикл при этом не умирает
  safe(where, f) {
    try { f(); } catch (e) { if (this.errs++ < 20) console.error('Сходка:', where, e); }
  },
  scale() { return this.w && !this.ended && !this.paused && !this.ui.screenOn ? 1 : 0; },

  // ─── новый вечер ───
  start() {
    this.clearWorld();
    const seed = this.seed = Q.has('seed') && !this.w0 ? (+Q.get('seed') >>> 0) || 1 : (Date.now() % 2147483647) >>> 0 || 1;
    this.w0 = true;
    const month = new Date().getMonth() === 11 ? 'dec' : null;
    const pr = this.profile || {};
    const w = this.w = new World(CONTENT, { seed, month, profile: { ...pr, look: null } });
    w.player.look = makeLook(new RNG(seed ^ 0x5eed), playerHints(pr.look));
    w.player.lookHints = pr.look || null;
    this.ended = false; this.paused = false; this.shot = null; this.talkId = null; this.knownKey = '';
    this.ui.attach(w);
    this.ui.showHud(true);
    const B = w.bus;
    B.on('event', e => { if (e.scene) this.sc.setEffect(e.scene, e.on); if (STAGE[e.scene]) this.performer(e.scene, e.on);
      // событие на сцене (караоке, саксофон) — камера коротко показывает место, если игрок не в разговоре
      const st = e.on && !this.talkId && w.idx?.EVENTS?.[e.id]?.effect?.stage; if (st) this.sc.ctl.peek(st); });
    B.on('talk:start', d => this.onTalk(d.id));
    B.on('talk:end', () => this.onTalk(null));
    // снимок — в тот же миг, когда симуляция засчитала, кто на фото (шаги могут идти пачкой без кадров)
    B.on('photo', d => this.safe('фото', () => { this.sync(); this.takeShot('photo', d.me ? [...d.on, 'me'] : d.on.slice(), d.me); }));
    // фото не было — снимок конца вечера: кто остался в зале
    B.on('end', d => { this.summary = d.summary; this.ended = true; if (!this.shot) this.safe('фото', () => { this.sync(); this.takeShot('end', null, false); }); });
    for (const f of ['strobe', 'rain', 'football', 'sax', 'birthday', 'garland', 'smell', 'karaoke']) this.sc.setEffect(f, false);
    for (const k of Object.keys(STAGE)) this.performer(k, false);
    this.sc.ctl.home();
    this.sc.setHour(w.hour, true);
    this.sync();
  },
  clearWorld() {
    if (this.w) for (const id of [...this.pp.map.keys()]) this.pp.remove(id);
    this.extras.clear();
    this.pp.highlight(null, 'known'); this.pp.highlight(null, 'talk'); this.pp.highlight(null, 'hover');
    this.sc.focus(null); this.sc.view(null);
    this.w = null; this.summary = null; this.shot = null;
    if (this.marks) this.marks.goal.visible = this.marks.me.visible = false;
  },

  // ─── кадр ───
  frame(dt) {
    const w = this.w, sc = this.sc;
    if (w) {
      this.sync();
      sc.setHour(w.hour);
      const me = this.pp.map.get('me');
      if (me) sc.follow({ x: me.x, z: me.z });
    }
    this.pp.update(dt);
    this.updateMarks(dt);
    sc.render(dt);
    this.ui.update(dt);
    if (this.ended && this.summary && !this.ui.screenOn) this.finish();
  },
  // мир → люди в 3D
  sync() {
    const w = this.w, pp = this.pp, seen = this.seen || (this.seen = new Set());
    seen.clear();
    for (const v of w.view()) {
      seen.add(v.id);
      if (!pp.map.has(v.id)) {
        const src = v.me ? w.player : w.people.get(v.id);
        if (!src.look) src.look = makeLook(new RNG(v.seed || 1), v.lookHints || {});
        pp.add(v.id, src.look);
      }
      pp.set(v.id, { x: v.x, z: v.z, rot: v.rot, pose: v.pose, mood: v.mood, speaking: v.speaking, prop: v.prop || undefined });
    }
    for (const id of [...pp.map.keys()]) if (!seen.has(id) && !this.extras.has(id)) { pp.remove(id); if (this.hoverId === id) this.hoverId = null; }
    // знакомые — бирюзовое кольцо (ступень ≥ 1); пересчёт только при изменении набора
    let key = '';
    for (const n of w.list) if (n.present && n.step >= 1) key += n.id + ',';
    if (key !== this.knownKey) { this.knownKey = key; pp.highlight(null, 'known'); const ids = key.split(',').filter(Boolean); if (ids.length) pp.highlight(ids, 'known'); }
  },
  // музыканты событий (в симуляции их нет): саксофонист и певица с микрофоном — на сцене у стойки
  performer(kind, on) {
    const S = STAGE[kind], id = S.id, at = this.sc[S.at];
    if (!on || !at) { if (this.extras.delete(id)) this.pp.remove(id); return; }
    if (this.extras.has(id)) return;
    this.extras.add(id);
    this.pp.add(id, makeLook(new RNG(this.seed ^ S.salt), S.hints));
    this.pp.set(id, { x: at[0], z: at[1], y: at[2] || 0, rot: at[3] ?? 0, pose: 'sing', speaking: true });
  },
  onTalk(id) {
    this.talkId = id;
    this.pp.highlight(id, 'talk');
    if (id == null) { this.sc.focus(null); return; }
    const n = this.w.people.get(id), P = this.w.player;
    // sight — живые позиции пары и остальных: камера подбирает ракурс, откуда оба видны
    if (n) this.sc.focus({ x: (n.x + P.x) / 2, z: (n.z + P.z) / 2, sight: () => this.pp.sight(id, 'me') });
  },

  // ─── снимок для итога (без preserveDrawingBuffer: кадр рисуется и читается сразу) ───
  // kind 'photo' — общее фото: ids — кого засчитала симуляция; стоящие поворачиваются к камере и машут/смеются,
  //   сидящие машут с места. kind 'end' — фото не было: кто остался в зале, как есть.
  // Камера отъезжает, пока в кадр не войдут все; «на фото» = сколько людей реально в кадре.
  takeShot(kind, ids, me) {
    const sc = this.sc, pp = this.pp, P = LAY.photo;
    const cam = sc.camera, vis = [this.marks.goal.visible, this.marks.me.visible];
    try {
      pp.highlight(null, 'known'); pp.highlight(null, 'hover'); pp.highlight(null, 'talk');
      this.marks.goal.visible = this.marks.me.visible = false;
      let grp = ids ? ids.map(id => pp.map.get(id)).filter(Boolean)
        : [...pp.map.values()].filter(p => !this.extras.has(p.id) && p.tz > 0.3 && LAY.zoneAt(p.tx, p.tz) !== 'veranda');
      for (const p of grp) { p.x = p.tx; p.z = p.tz; p.speed = 0; }   // догнать симуляцию: без «на ходу»
      let cx = P.x, cz = P.z;
      if (grp.length) { cx = grp.reduce((s, p) => s + p.x, 0) / grp.length; cz = grp.reduce((s, p) => s + p.z, 0) / grp.length; }
      // смотрим вглубь зала (+Z), если сзади есть место; иначе — от дальней стены к витрине
      const dz = cz > 4.5 ? 1 : -1, dx = kind === 'photo' ? -0.12 : -0.2 * dz;
      const pts = grp.length ? grp : [{ x: cx, z: cz }];
      const fov = 58, cy = kind === 'photo' ? 2.3 : 2.7;
      const tmp = this.tmpCam || (this.tmpCam = new THREE.PerspectiveCamera());
      tmp.fov = fov; tmp.aspect = cam.aspect; tmp.near = 0.1; tmp.far = 60; tmp.updateProjectionMatrix();
      const v = new THREE.Vector3(), inFrame = (p, m = 1) => {
        for (const y of [0.15, p.seat ? 1.3 : 1.85]) { v.set(p.x, y, p.z).project(tmp); if (v.z > 1 || v.z < -1 || Math.abs(v.x) > m || Math.abs(v.y) > m) return false; }
        return true;
      };
      const zMin = 0.6, zMax = LAY.size.d - 0.4, xMax = () => LAY.size.w - 0.4;
      let pos = null;
      for (let d = 2.4; d <= 12; d += 0.3) {
        const z = clamp(cz - dz * d, zMin, zMax), x = clamp(cx + dx * d, 0.7, xMax(z));
        tmp.position.set(x, cy, z); tmp.lookAt(cx, kind === 'photo' ? 1.05 : 0.9, cz); tmp.updateMatrixWorld();
        pos = [x, cy, z];
        if (pts.every(p => inFrame(p, 0.92))) break;
      }
      if (kind === 'photo') grp.forEach((p, i) => {
        const o = { pose: ['wave', 'laugh', 'wave', 'stand'][i % 4] };
        if (!p.seat) { o.rot = Math.atan2(pos[0] - p.x, pos[2] - p.z); p.rot = o.rot; }
        pp.set(p.id, o);
      });
      pp.update(0.6); pp.update(0.6);
      sc.view({ pos, look: [cx, kind === 'photo' ? 1.05 : 0.9, cz], fov }); sc.render(0);
      const url = sc.renderer.domElement.toDataURL('image/jpeg', 0.86);
      // в кадре и не заслонён целиком: хоть одна точка (голова, грудь, плечи) видна мимо других людей
      sc.scene.updateMatrixWorld();
      const ray = this.ray || (this.ray = new THREE.Raycaster()), picks = pp.pickables, cp = cam.position;
      const seen = p => {
        const top = p.seat ? 1.25 : 1.7, sx = cp.z - p.z, sz = p.x - cp.x, sl = Math.hypot(sx, sz) || 1;
        for (const [o, y] of [[0, top], [0, top - 0.45], [0.2, top - 0.35], [-0.2, top - 0.35]]) {
          const t = v.set(p.x + sx / sl * o, y, p.z + sz / sl * o), dist = t.distanceTo(cp);
          ray.set(cp, t.clone().sub(cp).normalize()); ray.far = dist;
          const hit = ray.intersectObjects(picks, false).find(h => h.object.userData.personId !== p.id);
          if (!hit || hit.distance > dist - 0.35) return true;
        }
        return false;
      };
      const shown = grp.filter(p => inFrame(p, 1) && seen(p)).map(p => p.id);
      this.shot = { kind, url, ids: shown, me: !!me && shown.includes('me'), at: this.w ? this.w.hour : 25 };
    } catch (e) { console.error('Сходка: фото', e); this.shot = { kind, url: null, ids: [], me: false }; }
    sc.view(null); this.knownKey = '';
    [this.marks.goal.visible, this.marks.me.visible] = vis;
    if (this.talkId) pp.highlight(this.talkId, 'talk');
    return this.shot;
  },
  // итог: число «на фото» и подпись — по тому, что реально на снимке
  finish() {
    const s = this.summary; this.summary = null;
    if (!this.shot) { this.sync(); this.takeShot('end', null, false); }
    const sh = this.shot, hm = h => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.floor(h % 1 * 60)).padStart(2, '0')}`;
    if (sh.kind === 'photo') {
      s.photoEv = true;
      s.photoN = sh.ids.length;
      s.photoWith = (s.photoWith || []).filter(id => sh.ids.includes(id));
      s.snapCap = `Общее фото · ${hm(sh.at)}${s.photo ? '' : ' · без тебя'}`;
    } else { s.photoEv = false; s.photoN = 0; s.snapCap = 'Конец вечера · 01:00'; }
    this.sc.focus(null);
    this.ui.showEnd(s, sh.url, () => this.preChat());
  },

  // ─── ввод по залу ───
  bindInput(cv) {
    let down = null, lastMove = 0;
    cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    cv.addEventListener('pointerup', e => {
      const d = down; down = null;
      if (!d || this.sc.dragged || e.button > 0) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) return;
      this.safe('клик', () => this.tap(e.clientX, e.clientY));
    });
    cv.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse' || !this.w || down) return;
      const t = performance.now(); if (t - lastMove < 80) return; lastMove = t;
      const hit = this.sc.pick(e.clientX, e.clientY);
      const id = hit && hit.kind === 'person' && hit.id !== 'me' ? hit.id : null;
      if (id !== this.hoverId) { this.hoverId = id; this.pp.highlight(id, 'hover'); }
      cv.style.cursor = hit && (hit.kind === 'person' && hit.id !== 'me' || hit.kind === 'seat') ? 'pointer' : hit ? 'crosshair' : 'default';
    });
    cv.addEventListener('pointerleave', () => { if (this.hoverId != null) { this.hoverId = null; this.pp.highlight(null, 'hover'); } });
  },
  tap(x, y) {
    const w = this.w; if (!w || this.ended || this.paused || this.ui.screenOn) return;
    const hit = this.sc.pick(x, y); if (!hit) return;
    if (hit.kind === 'person') {
      if (hit.id === 'me') return;
      this.ui.act({ type: 'approach', id: hit.id });
      this.goalAt(w.people.get(hit.id));
    } else if (hit.kind === 'seat') {
      if (this.ui.act({ type: 'sit', seat: hit.id }) !== false) this.goalAt(LAY.seatById[hit.id]);
    } else if (hit.kind === 'floor') {
      this.ui.act({ type: 'walk', x: hit.x, z: hit.z });
      this.goalAt(hit);
    }
  },

  // ─── метки на полу: куда иду (янтарь), где я (голубое кольцо) ───
  buildMarks() {
    const mk = (r0, r1, col, op) => {
      const g = new THREE.RingGeometry(r0, r1, 32); g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.renderOrder = 2; m.visible = false; this.sc.scene.add(m); return m;
    };
    this.marks = { goal: mk(0.16, 0.26, 0xffc15a, 0.9), me: mk(0.44, 0.52, 0x5ab8ff, 0.7), goalT: 0 };
  },
  goalAt(p) { if (!p) return; const g = this.marks.goal; g.position.set(p.x, 0.02, p.z); g.visible = true; this.marks.goalT = 0; },
  updateMarks(dt) {
    const M = this.marks, me = this.w && this.pp.map.get('me');
    M.me.visible = !!me && !this.ui.screenOn;
    if (me) M.me.position.set(me.x, 0.018, me.z);
    if (M.goal.visible) {
      M.goalT += dt;
      const s = 1 + 0.25 * Math.sin(M.goalT * 8); M.goal.scale.set(s, 1, s);
      const P = this.w && this.w.player;
      if (!P || M.goalT > 6 || (!P.nav && M.goalT > 0.4)) M.goal.visible = false;
    }
  },

  setQuality(q) {
    const Qo = this.sc.quality, lv = qualityLevel(q);
    Qo.auto = !LEVELS[lv];
    if (LEVELS[lv]) Qo.set(lv);
    Qo.rs = 1;
    this.sc.applyQuality();
  },
};

window.SKHODKA = G;
G.boot();
return { G };
});
