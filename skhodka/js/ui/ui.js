// Интерфейс «Сходки»: DOM-слой поверх холста. Слушает world.bus, действия отдаёт в world.act(...).
// Свои события (пауза, качество, звук, «ещё суббота», «поделиться») — в ui.bus: 'pause' on · 'quality' q ·
// 'sound' 0|1 · 'again' · 'share' text · 'act' a (эхо каждого действия игрока — для стенда и тестов).
'use strict';
L.def('ui/ui', () => {
const { Bus } = L.use('core');
const { mountSprite, ic } = L.use('ui/icons');
const { STEPS, unit, fmt } = L.use('ui/dom');
const screens = L.use('ui/screens');
const { Talk, nameOf } = L.use('ui/talk');
const { Phone } = L.use('ui/phone');
const { Hud, Tags, Acts, toast } = L.use('ui/hud');

const WORLD_EVENTS = ['talk:start', 'talk:line', 'talk:cards', 'talk:end', 'reveal', 'ladder', 'pair', 'chat', 'event', 'energy', 'toast', 'arrive', 'leave', 'end'];

class Ui {
  constructor(root, { world = null, scene = null, people = null, content = null } = {}) {
    mountSprite();
    this.root = root; this.scene = scene; this.people = people; this.bus = new Bus();
    this.C = content || world?.C || world?.content || (() => { try { return L.use('content/index').CONTENT; } catch (e) { return {}; } })();
    this.paused = false; this.screenOn = null; this.pairs = new Set(); this.summary = null; this.off = [];
    root.classList.add('ui');
    root.innerHTML = `
      <div class="tags"></div>
      <div class="hud" hidden></div>
      <div class="toasts"></div>
      <div class="acts" hidden></div>
      <aside class="pcard side plate" hidden></aside>
      <div class="talk plate" hidden></div>
      <div class="phone" hidden></div>
      <div class="scrn" hidden></div>
      <div class="mnu" hidden></div>`;
    this.S = root.querySelector('.scrn'); this.M = root.querySelector('.mnu');
    this.talk = new Talk(this); this.phone = new Phone(this); this.hud = new Hud(this); this.tags = new Tags(this); this.acts = new Acts(this);
    this.M.onclick = e => { if (e.target === this.M) this.setPaused(false); };
    this._key = e => this.key(e); addEventListener('keydown', this._key);
    if (world) this.attach(world);
  }
  // мир можно подключить позже: анкета собирается до создания World
  attach(world) {
    for (const f of this.off) f(); this.off = [];
    this.world = world; this.pairs = new Set();
    if (world?.C && !Object.keys(this.C).length) this.C = world.C;
    const on = (t, f) => this.off.push(world.bus.on(t, d => { try { f(d || {}); } catch (e) { console.error('ui', t, e); } }));
    on('talk:start', d => { if (innerWidth < 640) this.phone.toggle(false); this.talk.start(d.id); });
    on('talk:line', d => this.talk.line(d));
    on('talk:cards', d => this.talk.setCards(d.cards));
    on('talk:end', d => { if (d.id == null || d.id === this.talk.id) this.talk.end(); if (d.result && d.result.text) toast(this, d.result); });
    on('reveal', d => { if (d.id === this.talk.id) { this.talk.reveal(d.field); this.talk.draw(); } });
    on('ladder', d => {
      const p = this.npc(d.id), s = STEPS[d.step | 0];
      // контакт и «договорились» подписывает симуляция своей всплывашкой — здесь только 2–3
      if (p && d.step >= 2 && d.step < 4) toast(this, { icon: s.icon, text: `${nameOf(p)} · ${s.t}`, tone: 's' + (d.step | 0) });
      if (d.id === this.talk.id) this.talk.draw();
    });
    on('pair', d => {
      this.pairs.add([d.a, d.b].sort().join('~'));
    });
    on('chat', d => this.phone.push(d.msg ?? d));
    on('event', d => { if (!d.on) return; const e = this.find('EVENTS', d.id) || d; toast(this, { icon: e.icon || d.icon, text: d.toast || e.toast || e.title, tone: 'ev', ms: 3600 }); });
    on('energy', d => { this.hud.energy = unit(d.v); });
    on('toast', d => toast(this, d));
    on('arrive', d => { const p = this.npc(d.id); if (p && (p.step | 0) >= 4) toast(this, { icon: 'door', text: `${nameOf(p)} пришёл` }); });
    on('leave', d => {
      const p = this.npc(d.id);
      if (p && (p.step | 0) >= 2) toast(this, { icon: 'exit', text: `${nameOf(p)} ушёл` });
      if (d.id === this.talk.id) this.talk.end();
    });
    on('end', d => { this.summary = d.summary || d; this.talk.end(); this.phone.toggle(false); });
  }
  // ───── данные ─────
  allPeople() { const p = this.world?.people; return !p ? [] : p instanceof Map ? [...p.values()] : Array.isArray(p) ? p : Object.values(p); }
  npc(id) {
    const p = this.world?.people; if (id == null || !p) return null;
    if (p instanceof Map) return p.get(id) ?? p.get(+id) ?? p.get(String(id)) ?? null;
    return this.allPeople().find(x => String(x.id) === String(id)) || null;
  }
  lookOf(id) { return this.npc(id)?.look || {}; }
  find(kind, id) { return id == null ? null : (this.C[kind] || []).find(x => x.id === id) || null; }
  // в зале ли: у симуляции — флаг present (до прихода и после ухода — false)
  here(p) { return p.present !== undefined ? !!p.present : !(p.gone || p.state === 'left' || p.state === 'gone'); }
  presentKnown(all = false) { return this.allPeople().filter(p => (p.step | 0) >= 2 && (all || this.here(p))); }
  counts() {
    const sc = this.world?.score || {}, ppl = this.allPeople();
    let met = 0, contacts = 0, present = 0;
    for (const p of ppl) { const s = p.step | 0; if (s >= 1) met++; if (s >= 4) contacts++; if (this.here(p)) present++; }
    const num = (v, d) => typeof v === 'number' ? v : d;
    return { met: num(sc.met, met), contacts: num(sc.contacts, contacts), pairs: num(sc.pairs, this.pairs.size), present: present + 1 };
  }
  act(a) { this.bus.emit('act', a); return this.world && this.world.act ? this.world.act(a) : false; }
  // ───── экраны ─────
  screen(html, name = '') {
    this.screenOn = html ? name : null;
    this.S.hidden = !html; this.S.innerHTML = html || ''; this.S.dataset.s = name;
    this.root.classList.toggle('scr-on', !!html);
    if (html) this.S.scrollTop = 0;
  }
  showTitle(onStart) { this.showHud(false); screens.title(this, onStart); }
  showProfile(onDone) { this.showHud(false); screens.profile(this, onDone); }
  showPreChat(onGo) { this.showHud(false); screens.preChat(this, p => { this.showHud(true); onGo && onGo(p); }); }
  showHud(on = true) { this.hud.el.hidden = !on; this.acts.el.hidden = !on; if (!on) this.acts.toggle(false); }
  showEnd(summary, photoDataUrl, onAgain) {
    this.talk.end(); this.phone.toggle(false); this.setPaused(false, true); this.showHud(false);
    this.root.querySelector('.toasts').innerHTML = '';
    if (onAgain) { const off = this.bus.on('again', () => { off(); onAgain(); }); }
    return screens.end(this, summary || this.summary || {}, photoDataUrl);
  }
  setPaused(on, silent) {
    if (on && this.screenOn) return;
    this.paused = on; this.M.hidden = !on;
    if (on) screens.pause(this); else this.M.innerHTML = '';
    if (!silent) this.bus.emit('pause', on);
  }
  key(e) {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === 'Escape') {
      if (this.phone.open) return this.phone.toggle(false);
      if (!this.screenOn) this.setPaused(!this.paused);
      return;
    }
    if (this.paused || this.screenOn) return;
    if (/^[1-4]$/.test(e.key) && this.talk.id != null) this.talk.say(+e.key - 1);
    else if (e.key === 'p' || e.key === 'з' || e.key === 't' || e.key === 'е') this.phone.toggle();
  }
  update(dt) {
    if (!this.hud.el.hidden) { this.hud.update(dt); this.acts.update(dt); }
    this.tags.update(dt);
  }
  destroy() { for (const f of this.off) f(); removeEventListener('keydown', this._key); this.root.innerHTML = ''; }
}
return { Ui };
});
