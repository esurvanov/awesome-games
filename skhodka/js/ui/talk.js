// Разговор: нижняя панель (портрет, реплика, теплота, карты-реплики, «познакомить», «уйти») и карточка человека.
'use strict';
L.def('ui/talk', () => {
const { ic } = L.use('ui/icons');
const { esc, face, dots, ladder, warm, STEPS } = L.use('ui/dom');

// раскрыто ли поле: known[field] — true | число | массив раскрытых id (для topics)
function knownList(npc, field) {
  const v = (npc.known || {})[field], all = npc[field] || [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'number') return all.slice(0, v);
  return v ? all : [];
}
const isKnown = (npc, f) => { const v = (npc.known || {})[f]; return Array.isArray(v) ? v.length > 0 : !!v; };
const Q = '<span class="q">???</span>';

function nameOf(npc) { return npc && isKnown(npc, 'name') ? npc.name : '???'; }

// карточка человека (сбоку от разговора и в контактах телефона)
function cardHtml(ui, npc, flash) {
  const C = ui.C, f = k => flash === k ? 'flash' : '';
  const role = ui.find('ROLES', npc.role), mind = ui.find('MINDS', npc.mind), need = ui.find('NEEDS', npc.need), offer = ui.find('NEEDS', npc.offer);
  const mood = ui.find('MOODS', typeof npc.mood === 'string' ? npc.mood : null);
  const tk = knownList(npc, 'topics'), tAll = npc.topics || [];
  const row = (k, icon, v) => `<div class="crow ${f(k)}"><span class="ck">${ic(icon, 's')}</span><span class="cv">${v}</span></div>`;
  const chip = (icon, t) => `<span class="chip">${ic(icon || 'dot', 's')}${esc(t)}</span>`;
  const odd = npc.oddball && ui.find('ODDBALLS', typeof npc.oddball === 'string' ? npc.oddball : npc.oddball.id);
  return `<div class="pc-top">
      <div class="pc-face">${face(npc.look, 56, npc.id)}${odd ? `<span class="pc-odd">${ic(odd.icon || 'star', 's')}</span>` : ''}</div>
      <div class="pc-name ${f('name')}"><b>${esc(nameOf(npc))}</b>${npc.age && isKnown(npc, 'name') ? `<small class="num">${npc.age}</small>` : ''}</div>
    </div>
    ${ladder(npc.step | 0)}
    <div class="pc-step">${ic(STEPS[npc.step | 0].icon, 's')}${STEPS[npc.step | 0].t}</div>
    ${row('role', role?.icon || 'briefcase', isKnown(npc, 'role') && role ? chip(role.icon, role.title) : Q)}
    ${row('topics', 'star', tAll.length ? tAll.map((id, i) => { const t = ui.find('TOPICS', id); return tk.includes(id) && t ? chip(t.icon, t.title) : `<span class="chip q">?</span>`; }).join('') : Q)}
    ${row('mind', mind?.icon && isKnown(npc, 'mind') ? mind.icon : 'brain', isKnown(npc, 'mind') && mind ? chip(mind.icon, mind.title) : Q)}
    ${mood ? row('mood', 'smile', isKnown(npc, 'mood') ? chip(mood.icon, mood.title) : Q) : ''}
    ${row('need', 'search', isKnown(npc, 'need') && need ? chip(need.seek?.icon, need.seek?.title) : Q)}
    ${row('offer', 'gift', isKnown(npc, 'offer') && offer ? chip(offer.offer?.icon, offer.offer?.title) : Q)}`;
}

class Talk {
  constructor(ui) {
    this.ui = ui; this.id = null; this.lines = []; this.cards = []; this.pick = false; this.cardOpen = false; this.flash = null; this.face = 'meh';
    this.P = ui.root.querySelector('.talk'); this.K = ui.root.querySelector('.pcard');
  }
  get npc() { return this.id != null ? this.ui.npc(this.id) : null; }
  start(id) { this.id = id; this.lines = []; this.cards = []; this.pick = false; this.face = 'meh'; this.P.hidden = false; this.K.hidden = false; this.draw(); this.ui.root.classList.add('talking'); }
  line(d) {
    const me = d.who === 'player' || d.who === 'me' || d.who === this.ui.world?.player?.id;
    this.lines.push({ me, text: d.text, mood: d.mood }); if (this.lines.length > 2) this.lines.shift();
    if (!me && d.mood != null) this.face = moodFace(d.mood);
    this.draw();
  }
  setCards(cards) { this.cards = (cards || []).map(c => typeof c === 'string' ? (this.ui.find('CARDS', c) || { id: c, label: c }) : c); this.draw(); }
  end() { this.id = null; this.P.hidden = true; this.K.hidden = true; this.ui.root.classList.remove('talking'); }
  reveal(field) { this.flash = field; this.drawCard(); setTimeout(() => { if (this.flash === field) { this.flash = null; } }, 1200); }
  draw() {
    const npc = this.npc; if (!npc) return;
    const ui = this.ui, w = warm(npc.rapport), role = ui.find('ROLES', npc.role);
    const npcLine = [...this.lines].reverse().find(l => !l.me), myLine = [...this.lines].reverse().find(l => l.me);
    const present = ui.presentKnown().filter(p => p.id !== this.id);
    this.P.innerHTML = `
      <div class="t-head">
        <button class="t-face" data-card title="Карточка">${face(npc.look, 44, npc.id)}</button>
        <div class="t-who"><b>${esc(nameOf(npc))}</b><span>${isKnown(npc, 'role') && role ? ic(role.icon, 's') : ''}${dots(npc.step | 0)}</span></div>
        <div class="warm" title="Теплота">${ic('meh', 's')}<span class="wtrack"><i style="width:${w * 100}%"></i><b style="left:${w * 100}%"></b></span>${ic('smile', 's')}</div>
        <button class="btn sq ghost" data-bye title="Уйти">${ic('exit')}</button>
      </div>
      <div class="t-lines">
        ${npcLine ? `<div class="say">${ic(this.face, 's')}<span>${esc(npcLine.text)}</span></div>` : `<div class="say dim">${ic('dot', 's')}<span>…</span></div>`}
        ${myLine ? `<div class="say me"><span>${esc(myLine.text)}</span></div>` : ''}
      </div>
      <div class="t-cards">${this.cards.slice(0, 4).map((c, i) => {
        const t = c.topic ? ui.find('TOPICS', c.topic) : null;
        return `<button class="card st-${esc(c.style || 'x')}" data-i="${i}"><span class="k num">${i + 1}</span>${ic(c.icon || 'chat')}<span class="cl">${esc(c.label)}</span>${t ? `<span class="ct">${ic(t.icon, 's')}</span>` : ''}</button>`;
      }).join('')}</div>
      <div class="t-foot">
        <button class="btn ${this.pick ? 'on' : ''}" data-intro ${present.length ? '' : 'disabled'}>${ic('userPlus')}Познакомить<span class="n num">${present.length}</span></button>
        ${this.pick ? `<div class="pick">${present.map(p => `<button class="pchip" data-b="${esc(p.id)}">${face(p.look, 28, p.id)}<b>${esc(nameOf(p))}</b>${dots(p.step | 0)}</button>`).join('')}</div>` : ''}
        <button class="btn" data-bye2>${ic('exit')}Уйти</button>
      </div>`;
    const P = this.P;
    P.querySelectorAll('[data-i]').forEach(b => b.onclick = () => this.say(+b.dataset.i));
    P.querySelector('[data-intro]').onclick = () => { this.pick = !this.pick; this.draw(); };
    P.querySelectorAll('[data-b]').forEach(b => b.onclick = () => { ui.act({ type: 'introduce', a: this.id, b: b.dataset.b }); this.pick = false; this.draw(); });
    P.querySelector('[data-bye]').onclick = P.querySelector('[data-bye2]').onclick = () => ui.act({ type: 'endTalk' });
    P.querySelector('[data-card]').onclick = () => { this.cardOpen = !this.cardOpen; this.K.classList.toggle('open', this.cardOpen); };
    this.drawCard();
    this.ui.root.style.setProperty('--talk-h', P.offsetHeight + 'px');
  }
  drawCard() { const npc = this.npc; if (npc) this.K.innerHTML = `<button class="pc-x btn sq ghost" data-x>${ic('close', 's')}</button>` + cardHtml(this.ui, npc, this.flash);
    const x = this.K.querySelector('[data-x]'); if (x) x.onclick = () => { this.cardOpen = false; this.K.classList.remove('open'); }; }
  say(i) {
    const c = this.cards[i]; if (!c) return;
    this.ui.act({ type: 'say', card: c.id });
  }
}
function moodFace(m) {
  if (typeof m === 'string') return { good: 'smile', open: 'smile', reveal: 'smile', contact: 'laugh', deal: 'laugh', bad: 'frown', leave: 'frown', meh: 'meh', hello: 'smile' }[m] || 'meh';
  return m > 0.5 ? 'laugh' : m > 0.15 ? 'smile' : m < -0.15 ? 'frown' : 'meh';
}
return { Talk, cardHtml, nameOf, isKnown };
});
