// Телефон: чат встречи (сообщения по ходу вечера, кнопки-ответы), контакты, альбом легенд.
'use strict';
L.def('ui/phone', () => {
const { ic } = L.use('ui/icons');
const { esc, face, dots, tint } = L.use('ui/dom');
const { hhmm } = L.use('core');
const { cardHtml, nameOf } = L.use('ui/talk');

const TABS = [['chat', 'chat', 'Чат'], ['contacts', 'phone', 'Контакты'], ['legends', 'star', 'Легенды']];

class Phone {
  constructor(ui) {
    this.ui = ui; this.el = ui.root.querySelector('.phone'); this.tab = 'chat'; this.msgs = []; this.unread = 0; this.open = false; this.sel = null;
  }
  push(m) {
    if (!m) return;
    const msg = typeof m === 'string' ? { text: m } : { ...m };
    msg.from = this.from(msg.from); msg.t ??= this.ui.world?.hour;
    this.msgs.push(msg); if (this.msgs.length > 60) this.msgs.shift();
    if (!(this.open && this.tab === 'chat')) this.unread++;
    this.ui.hud.badge(this.unread);
    if (this.open) this.draw();
  }
  from(f) { const npc = f != null ? this.ui.npc(f) : null; return npc ? nameOf(npc) : (f ?? 'Орг'); }
  toggle(on = !this.open, tab) {
    this.open = on; if (tab) this.tab = tab; this.el.hidden = !on; this.ui.root.classList.toggle('ph-on', on);
    if (on) { if (this.tab === 'chat') this.unread = 0; this.ui.hud.badge(this.unread); this.draw(); }
  }
  draw() {
    const ui = this.ui, t = this.tab;
    const contacts = ui.presentKnown(true).filter(p => (p.step | 0) >= 4).sort((a, b) => b.step - a.step);
    this.el.innerHTML = `<div class="phone-frame">
      <div class="ph-head"><span class="ava" style="background:#2e7bd6">${ic('users', 's')}</span><div><b>IT Offline Hangouts</b><small class="num">${ic('clock', 's')} ${hhmm(ui.world?.hour ?? 19)}</small></div>
        <button class="btn sq ghost" data-close>${ic('close')}</button></div>
      <div class="ph-tabs">${TABS.map(([k, icon, l]) => `<button class="${t === k ? 'on' : ''}" data-tab="${k}">${ic(icon, 's')}<span>${l}</span>${k === 'chat' && this.unread ? `<i class="bdg num">${this.unread}</i>` : k === 'contacts' ? `<small class="num">${contacts.length}</small>` : ''}</button>`).join('')}</div>
      <div class="ph-body">${t === 'chat' ? this.chat() : t === 'contacts' ? this.contacts(contacts) : this.legends()}</div>
    </div>`;
    const E = this.el;
    E.querySelector('[data-close]').onclick = () => this.toggle(false);
    E.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { this.tab = b.dataset.tab; if (this.tab === 'chat') { this.unread = 0; ui.hud.badge(0); } this.sel = null; this.draw(); });
    E.querySelectorAll('[data-opt]').forEach(b => b.onclick = () => {
      const m = this.msgs[+b.dataset.m], o = +b.dataset.opt; if (!m || m.answered != null) return;
      m.answered = o; ui.act({ type: 'reply', msg: m.id ?? +b.dataset.m, option: o });
      const opt = m.options[o]; this.msgs.push({ me: true, text: typeof opt === 'string' ? opt : opt.label || opt.text, t: ui.world?.hour });
      this.draw();
    });
    E.querySelectorAll('[data-sel]').forEach(b => b.onclick = () => { this.sel = this.sel === b.dataset.sel ? null : b.dataset.sel; this.draw(); });
    const body = E.querySelector('.ph-body'); if (t === 'chat') body.scrollTop = body.scrollHeight;
  }
  chat() {
    if (!this.msgs.length) return `<div class="empty">${ic('chat', 'xl')}<span>Пока тихо</span></div>`;
    return this.msgs.map((m, i) => {
      const me = !!m.me;
      const opts = m.options && m.options.length ? `<div class="mopts">${m.options.map((o, k) => {
        const lab = typeof o === 'string' ? o : o.label || o.text, icon = typeof o === 'object' && o.icon;
        return `<button class="btn sm ${m.answered === k ? 'on' : ''}" data-m="${i}" data-opt="${k}" ${m.answered != null ? 'disabled' : ''}>${icon ? ic(icon, 's') : ''}${esc(lab)}</button>`;
      }).join('')}</div>` : '';
      return `<div class="msg ${me ? 'me' : ''}">${me ? '' : `<span class="ava" style="background:${tint(m.from)}">${esc(String(m.from || '?')[0])}</span>`}
        <div class="bub">${me ? '' : `<b style="color:${tint(m.from)}">${esc(m.from)}</b>`}<span>${esc(m.text)}</span>${m.t != null ? `<small class="num">${hhmm(m.t)}</small>` : ''}${opts}</div></div>`;
    }).join('');
  }
  contacts(list) {
    if (!list.length) return `<div class="empty">${ic('phone', 'xl')}<span>Контактов нет</span><small>${ic('phone', 's')} = ступень 4</small></div>`;
    return list.map(p => {
      const role = this.ui.find('ROLES', p.role), gone = p.gone || p.state === 'left' || p.state === 'gone';
      return `<button class="crow2 ${gone ? 'gone' : ''}" data-sel="${esc(p.id)}">${face(p.look, 36, p.id)}<b>${esc(nameOf(p))}</b>${role && p.known?.role ? ic(role.icon, 's') : ''}${gone ? ic('exit', 's') : ''}${dots(p.step | 0)}</button>
        ${this.sel === String(p.id) ? `<div class="pcard inl">${cardHtml(this.ui, p)}</div>` : ''}`;
    }).join('');
  }
  legends() {
    const odd = this.ui.C.ODDBALLS || [], met = new Set();
    for (const p of this.ui.allPeople()) if (p.oddball && (p.step | 0) >= 2) met.add(typeof p.oddball === 'string' ? p.oddball : p.oddball.id);
    return `<div class="lg-n num">${ic('star', 's')} ${met.size}/${odd.length}</div><div class="legends">${odd.map(o => met.has(o.id)
      ? `<div class="lg on">${ic(o.icon || 'star', 'l')}<b>${esc(o.title)}</b>${o.catch ? `<small>${esc(o.catch)}</small>` : ''}</div>`
      : `<div class="lg">${ic('question', 'l')}<b>???</b></div>`).join('')}</div>`;
  }
}
return { Phone };
});
