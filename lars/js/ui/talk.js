// «Сказать своё»: живой разговор с человеком в очереди. Голос (держать V / кнопку 🎙) или текст → распознавание →
// ответ человека по состоянию мира (js/ai/prompt.js) → его голосом (speak.js) → последствия чипами; сделки — только
// после подтверждения (js/ai/effects.js). Любая ошибка — мягко: сообщение и «Меню действий». Время — как в окнах.
// Сценарный «Поговорить» и события остаются основными; это — дополнительный слой, только с ключом OpenAI.
'use strict';
L.def('ui/talk', () => {
const { ic } = L.use('ui/icons');
const { esc, chips, Modal, toast } = L.use('ui/dom');
const { Voice, speak, block, nextKey } = L.use('ui/speak');
const { personaOf, withEmotion } = L.use('ai/persona');
const { Api } = L.use('ai/api');
const { SCHEMA, buildTurn } = L.use('ai/prompt');
const { judge, accept } = L.use('ai/effects');
const { Mic } = L.use('audio/mic');
const { openKeyCard } = L.use('ui/onboard');

const TALKABLE = new Set(['person', 'car', 'seller']);
const HIST = 12;
const ERR = { nokey: 'Нужен ключ OpenAI', key: 'Неверный ключ', net: 'Нет сети', timeout: 'Долго молчит — не дождался', busy: 'Лимит OpenAI — подожди', http: 'Не ответил', parse: 'Не понял его ответ', refusal: 'Не стал отвечать' };
let S = null, seq = 0;

const talkable = tg => !!tg && TALKABLE.has(tg.kind);
const live = s => s && S === s && Modal.top() === 'talk' && s.el && s.el.isConnected;
const clean = t => String(t || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim();

function memory(w, key) { w.talks ||= {}; return (w.talks[key] ||= { n: 0, h: [] }); }

// ─── окно ───
function openTalk(G, tg, o = {}) {
  const w = G.w; if (!w || G.ended) return false;
  if (!Api.ready()) { G.menu?.hide(); openKeyCard(G); return false; }
  const per = personaOf(w, tg);
  if (!per) { toast({ icon: 'user', text: 'Здесь не с кем говорить', tone: -1 }); return false; }
  G.menu?.hide();
  if (document.pointerLockElement) document.exitPointerLock?.();
  const mem = memory(w, per.key);
  S = { id: ++seq, G, tg, per, busy: false, ended: false, offers: [], items: [], recording: false, counted: false, el: null };
  for (const h of mem.h.slice(-6)) S.items.push(h.r === 'me' ? { k: 'me', t: h.t } : { k: 'npc', t: h.t, vk: nextKey('tk'), old: true });
  if (S.items.length) S.items.push({ k: 'sys', t: 'раньше', icon: 'clock' });
  const mic = Mic.ok();
  const html = `<div class="plate card talk" id="talk">
    <div class="hd"><span class="big">${ic(per.def?.icon || (per.seller ? 'seller' : 'user'), 'l')}</span><div><h2>${esc(per.name)}</h2><div class="who">${per.age} · ${esc(per.job)}</div></div><button class="btn sq x" data-close title="Esc">${ic('close')}</button></div>
    <div class="trust" id="t-trust"></div>
    <div class="msgs tmsgs" id="t-msgs"></div>
    <div class="choices toffers" id="t-offers"></div>
    <div class="tin">
      ${mic ? `<button class="btn sq tmic" id="t-mic" title="Держи — говори (V)">${ic('mic')}<i class="lv" id="t-lv"></i></button>` : ''}
      <input id="t-in" type="text" maxlength="300" autocomplete="off" placeholder="${mic ? 'Держи V или напиши…' : 'Напиши, что скажешь…'}">
      <button class="btn sq acc" id="t-send" title="Сказать (Enter)">${ic('send')}</button>
    </div>
    <div class="tfoot dim">${mic ? `<span>${ic('mic', 's')}V — держать</span>` : `<span title="${esc(Mic.why())}">${ic('text', 's')}только текст</span>`}<span>${ic('chip', 's')}<b id="t-use" class="num"></b></span><span>Esc — выйти</span></div>
  </div>`;
  Modal.show(html, el => mount(el), 'talk');
  if (o.rec) startRec();
  return true;
}

function mount(el) {
  const s = S; if (!s) return;
  s.el = el;
  const $ = q => el.querySelector(q);
  $('[data-close]').onclick = close;
  const inp = $('#t-in');
  inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') { const t = inp.value; inp.value = ''; send(t); } else if (e.key === 'Escape') close(); };
  $('#t-send').onclick = () => { const t = inp.value; inp.value = ''; send(t); };
  const mic = $('#t-mic');
  if (mic) {
    mic.onpointerdown = e => { e.preventDefault(); try { mic.setPointerCapture(e.pointerId); } catch (x) {} startRec(); };
    mic.onpointerup = mic.onpointercancel = () => stopRec();
    mic.oncontextmenu = e => e.preventDefault();
  }
  draw(); drawOffers(); drawTrust(); drawUse();
  // с микрофоном поле не фокусируем сразу — иначе V печатает букву вместо «держи и говори»
  if (!s.recording && !mic && !matchMedia('(pointer: coarse)').matches) setTimeout(() => { if (live(s) && !s.recording) inp.focus(); }, 30);
}
function close() {
  const s = S; if (s && s.recording) { s.recording = false; Mic.stop(); }
  S = null;
  if (Modal.top() === 'talk') Modal.close();
  if (s) s.G.afterAction();
}

// ─── отрисовка ───
function itemHtml(it) {
  if (it.k === 'me') return `<div class="msg me">${esc(it.t)}</div>`;
  if (it.k === 'think') return `<div class="msg think"><i></i><i></i><i></i>${it.icon ? ic(it.icon, 's') : ''}</div>`;
  if (it.k === 'sys') return `<div class="tsys${it.err ? ' err' : ''}">${ic(it.icon || 'alert', 's')}<span>${esc(it.t)}</span>${(it.btns || []).map((b, i) => `<button class="btn" data-sb="${it.id}:${i}">${ic(b.icon, 's')}${esc(b.label)}</button>`).join('')}</div>${it.chips ? chips(it.chips) : ''}`;
  const body = `<span>${esc(it.t)}</span>`;
  return `<div class="msg npc${it.old ? ' old' : ''}">${it.old ? body : block(it.vk, body, it.t)}${it.chips && it.chips.length ? chips(it.chips) : ''}</div>`;
}
function draw() {
  const s = S; if (!s || !s.el) return;
  const box = s.el.querySelector('#t-msgs'); if (!box) return;
  box.innerHTML = s.items.map(itemHtml).join('') || `<div class="tsys">${ic('chat', 's')}<span>Скажи что-нибудь — ${esc(s.per.name)} ответит</span></div>`;
  box.querySelectorAll('[data-sb]').forEach(b => b.onclick = () => { const [id, i] = b.dataset.sb.split(':'); const it = s.items.find(x => x.id === +id); it && it.btns[+i].f(); });
  box.scrollTop = box.scrollHeight;
  const inp = s.el.querySelector('#t-in'), snd = s.el.querySelector('#t-send'), mic = s.el.querySelector('#t-mic');
  const off = s.busy || s.ended;
  if (inp) { inp.disabled = s.ended; inp.placeholder = s.ended ? 'Разговор окончен' : inp.placeholder; }
  if (snd) snd.disabled = off; if (mic) mic.disabled = off && !s.recording;
}
function drawOffers() {
  const s = S; if (!s || !s.el) return;
  const box = s.el.querySelector('#t-offers'); if (!box) return;
  box.innerHTML = s.offers.map((o, i) => `<button class="btn choice" data-of="${i}">${ic(o.icon)}<span class="lb">${esc(o.label)}</span>${chips(o.chips)}</button>`).join('') +
    (s.offers.length ? `<button class="btn tno" data-no>${ic('close', 's')}Нет, спасибо</button>` : '');
  box.querySelectorAll('[data-of]').forEach(b => b.onclick = () => take(+b.dataset.of));
  box.querySelector('[data-no]')?.addEventListener('click', () => { s.offers = []; drawOffers(); });
}
function drawTrust() {
  const s = S; if (!s || !s.el) return;
  const t = s.G.w.trustOf(s.per.trustKey), el = s.el.querySelector('#t-trust');
  if (el) el.innerHTML = `${ic('handshake', 's')}<div class="bar" style="--v:${(t + 100) / 2};--col:${t >= 0 ? 'var(--s-ok)' : 'var(--s-danger)'}"><i></i></div><b>${t > 0 ? '+' : ''}${Math.round(t)}</b>`;
}
function drawUse() {
  const s = S; if (!s || !s.el) return;
  const el = s.el.querySelector('#t-use'); if (el) el.textContent = Api.spent() + '/' + Api.cap();
}
let iid = 0;
function add(it) { const s = S; if (!s) return it; it.id = ++iid; s.items.push(it); if (s.items.length > 40) s.items.splice(0, s.items.length - 40); draw(); return it; }
function drop(it) { const s = S; if (!s) return; const i = s.items.indexOf(it); if (i >= 0) s.items.splice(i, 1); draw(); }

// ─── голос: держать V / кнопку ───
async function startRec() {
  const s = S; if (!s || s.busy || s.ended || s.recording) return;
  if (!Mic.ok()) { toast({ icon: 'mic', text: 'Микрофон недоступен — напиши текстом', tone: -1 }); return; }
  s.recording = true; micUi(true);
  Voice.stop(); // не слушать самого себя
  Mic.onLevel = lv => { if (live(s)) s.el.querySelector('#t-lv')?.style.setProperty('--lv', lv.toFixed(2)); };
  Mic.onAuto = () => stopRec();
  const ok = await Mic.start();
  if (!ok) {
    s.recording = false; micUi(false);
    toast({ icon: 'mic', text: 'Микрофон: ' + (Mic.why() || 'нет доступа') + ' — пиши текстом', tone: -1 });
    if (live(s)) s.el.querySelector('#t-mic')?.remove();
  }
}
async function stopRec() {
  const s = S; if (!s || !s.recording) return;
  s.recording = false; micUi(false);
  const r = await Mic.stop();
  if (!live(s)) return;
  if (!r) { toast({ icon: 'mic', text: 'Держи V, пока говоришь' }); return; }
  const th = add({ k: 'think', icon: 'mic' }); s.busy = true; draw();
  const names = s.G.w.C.PEOPLE.map(p => p.name).join(', ');
  let text = '';
  try { text = await Api.transcribe(r.blob, { sec: r.sec, prompt: 'Разговор в очереди на Верхнем Ларсе, 2022. Имена: ' + names + '.' }); }
  catch (e) { if (!live(s)) return; drop(th); s.busy = false; fail(e, null); return; }
  if (!live(s)) return;
  drop(th); s.busy = false; drawUse();
  if (!text) { add({ k: 'sys', t: 'Не расслышал — ещё раз', icon: 'mic' }); return; }
  send(text);
}
function micUi(on) { const s = S; if (!s || !s.el) return; const b = s.el.querySelector('#t-mic'); if (b) b.classList.toggle('rec', on); }

// ─── реплика игрока → ответ ───
async function send(text, retry = false) {
  const s = S; text = clean(text).slice(0, 300);
  if (!s || !text || s.busy || s.ended) return;
  const G = s.G, w = G.w;
  if (!retry) add({ k: 'me', t: text });
  if (Api.overCap()) {
    add({ k: 'sys', t: 'Лимит сессии: ' + Api.spent() + ' запросов', icon: 'dollar', err: true, btns: [{ icon: 'play', label: 'Продолжить', f: () => { Api.capOk = true; send(text, true); } }, menuBtn(s)] });
    return;
  }
  s.busy = true; s.offers = []; drawOffers();
  const th = add({ k: 'think' });
  const mem = memory(w, s.per.key);
  let out;
  try {
    const turn = buildTurn(w, s.per, mem.h, text);
    out = await Api.chat(turn.messages, SCHEMA);
    if (!out || typeof out.reply !== 'string' || !clean(out.reply)) { const e = new Error('parse'); e.kind = 'parse'; throw e; }
  } catch (e) {
    if (!live(s)) return;
    drop(th); s.busy = false; draw(); drawUse(); fail(e, text); return;
  }
  if (S !== s) return; // окно закрыли — ответ не применяем
  drop(th);
  const reply = clean(out.reply).slice(0, 400), emo = typeof out.emotion === 'string' ? out.emotion : 'calm';
  const j = judge(w, s.per, s.tg, out);
  if (j.dropped.length) console.info('talk: отклонено', j.dropped);
  mem.h.push({ r: 'me', t: text }, { r: 'npc', t: reply, e: emo }); if (mem.h.length > HIST) mem.h.splice(0, mem.h.length - HIST);
  mem.n++;
  if (!s.counted) { s.counted = true; w.ledger.talks = (w.ledger.talks || 0) + 1; }
  const vk = nextKey('tk');
  add({ k: 'npc', t: reply, chips: j.chips, vk });
  speak(vk, [{ speaker: withEmotion(s.per.speaker, emo), text: reply }]);
  s.offers = j.offers; s.busy = false;
  if (j.end) { s.ended = true; add({ k: 'sys', t: 'Разговор окончен', icon: 'chat', btns: [menuBtn(s)] }); }
  draw(); drawOffers(); drawTrust(); drawUse();
  if (w.ended) close();
}
function menuBtn(s) { return { icon: 'menu', label: 'Меню действий', f: () => { close(); s.G.openMenu(s.tg); } }; }
function fail(e, text) {
  const s = S; if (!s) return;
  const kind = e && e.kind || 'http';
  console.warn('talk:', e && e.message);
  const btns = [];
  if (text && kind !== 'key' && kind !== 'nokey') btns.push({ icon: 'play', label: 'Ещё раз', f: () => { drop(it); send(text, true); } });
  btns.push(menuBtn(s));
  const it = add({ k: 'sys', t: ERR[kind] || ERR.http, icon: kind === 'key' || kind === 'nokey' ? 'key' : 'alert', err: true, btns });
}
function take(i) {
  const s = S; if (!s || s.busy) return;
  const o = s.offers[i]; if (!o) return;
  const r = accept(s.G.w, s.per, s.tg, o);
  s.offers.splice(i, 1);
  add({ k: 'sys', t: r.out || (r.fail ? 'Не вышло' : o.label), icon: r.fail ? 'alert' : 'check', chips: r.chips, err: r.fail });
  drawOffers(); drawTrust();
  s.G.afterAction();
  if (s.G.w.ended) close();
}

// ─── нажми-и-говори: V на человеке под прицелом (3D), в открытом меню или в окне разговора ───
function pickTarget(G) {
  if (G.menu && G.menu.open && talkable(G.menu.tg)) return G.menu.tg;
  if (G.mode === '3d' && G.fp && G.fp.target && talkable(G.fp.target.tg)) return G.fp.target.tg;
  if (G.mode === 'map' && G.view && talkable(G.view.sel)) return G.view.sel;
  return null;
}
let installed = false;
function installPTT(G) {
  if (installed) return; installed = true;
  addEventListener('keydown', e => {
    if (e.code !== 'KeyV' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && e.target.closest && e.target.closest('input,textarea,select')) return;
    if (!G.w || G.ended) return;
    if (S && Modal.top() === 'talk') { e.preventDefault(); startRec(); return; }
    if (Modal.open) return;
    const tg = pickTarget(G);
    if (!tg) { toast({ icon: 'mic', text: 'V — наведи прицел на человека' }); return; }
    e.preventDefault();
    if (!Api.ready()) { G.menu?.hide(); openKeyCard(G); return; }
    if (!G.w.inReach(tg)) { toast({ icon: 'walk', text: 'Подойди ближе', tone: -1 }); return; }
    openTalk(G, tg, { rec: Mic.ok() });
  });
  addEventListener('keyup', e => { if (e.code === 'KeyV' && S && S.recording) stopRec(); });
  Api.listen(() => drawUse());
}
return { openTalk, installPTT, talkable, pickTarget, state: () => S };
});
