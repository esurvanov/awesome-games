// Ключ OpenAI на старте: компактная карточка «🔊 голоса + 🎙 говорить самому» с полем ключа и «Проверить» —
// и равноправное «Играть без голоса» (запоминается: больше не спрашиваем; «Настройки» на старте остаются).
// Успешная проверка — сохраняем ключ и сразу включаем «Голос + текст». Та же карточка — окном, если игрок
// нажал «Сказать своё» или V без ключа.
'use strict';
L.def('ui/onboard', () => {
const { ic } = L.use('ui/icons');
const { esc, Modal, toast } = L.use('ui/dom');
const { Settings } = L.use('core');
const { Voice } = L.use('audio/voice');

const KEYS_URL = 'https://platform.openai.com/api-keys';
const shouldAsk = () => !Voice.opt('voiceKey') && Settings.get('keyAsk') !== 'skip';

function html(modal) {
  return `<div class="okey${modal ? ' plate card' : ''}" id="ob">
    <div class="okh">${ic('volume')}${ic('mic')}<b>Голоса и живой разговор</b>${modal ? `<button class="btn sq x" data-close>${ic('close')}</button>` : ''}</div>
    <div class="chips"><span class="chip i">${ic('volume')}голоса персонажей</span><span class="chip i">${ic('mic')}говорить самому</span></div>
    <div class="okrow">${ic('key')}<input type="password" id="ob-key" placeholder="Вставь ключ OpenAI sk-…" autocomplete="off" spellcheck="false"><span id="ob-st" class="kst"></span></div>
    <div class="note dim">${ic('shield', 's')}<span>Ключ остаётся в этом браузере · платно, обычно центы за вечер · <a href="${KEYS_URL}" target="_blank" rel="noopener">получить ключ</a></span></div>
    <div class="okb"><button class="btn acc" id="ob-check">${ic('check', 's')}Проверить и включить</button><button class="btn" id="ob-skip">${ic('mute', 's')}Играть без голоса</button></div>
  </div>`;
}
// el — контейнер карточки; onDone(ok) — ключ принят (true) или игрок отказался (false)
function mount(el, onDone) {
  const $ = q => el.querySelector(q), st = (icon, cls, t) => { const s = $('#ob-st'); s.className = 'kst ' + cls; s.innerHTML = ic(icon, 's') + (t ? `<span>${esc(t)}</span>` : ''); };
  const key = $('#ob-key'), btn = $('#ob-check');
  const check = async () => {
    const k = key.value.trim(); if (!k) { key.focus(); st('key', 'bad', 'пусто'); return; }
    btn.disabled = true; st('clock', '', '…');
    const r = await Voice.check(k);
    btn.disabled = false;
    if (r === 'ok') {
      Voice.set('voiceKey', k); if (Voice.opt('voiceMode') === 'off') Voice.set('voiceMode', 'both'); Settings.set('keyAsk', 'done');
      st('check', 'ok', 'готово');
      el.querySelector('.okb').innerHTML = `<span class="chip p">${ic('volume')}голос включён</span><span class="chip p">${ic('mic')}V — сказать своё</span>`;
      setTimeout(() => onDone(true), 900);
    } else st(r === 'bad' ? 'close' : 'alert', 'bad', r === 'bad' ? 'неверный ключ' : 'нет сети');
  };
  btn.onclick = check;
  key.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') check(); };
  $('#ob-skip').onclick = () => { Settings.set('keyAsk', 'skip'); onDone(false); };
  el.querySelector('[data-close]')?.addEventListener('click', () => onDone(false, true));
}
// на стартовом экране: вставить в host, если ключа нет и игрок не отказался
function startCard(host) {
  if (!shouldAsk()) return false;
  const box = document.createElement('div'); box.innerHTML = html(false);
  const card = box.firstChild; host.insertBefore(card, host.querySelector('.btns'));
  mount(card, () => card.remove());
  return true;
}
// окном — из игры («Сказать своё» / V без ключа)
function openKeyCard(game) {
  Modal.show(html(true), el => mount(el, (ok, closed) => {
    if (Modal.top() === 'key') Modal.close();
    if (ok) toast({ icon: 'mic', text: 'Готово: V — сказать своё', tone: 1 });
    else if (!closed) toast({ icon: 'mute', text: 'Без голоса. Ключ — в настройках' });
  }), 'key');
}
return { shouldAsk, startCard, openKeyCard };
});
