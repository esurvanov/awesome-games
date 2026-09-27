// Настройки: озвучка через OpenAI (режим, ключ, модель, громкость, скорость, чат вслух), живой разговор
// (модель ответа, распознавание, лимит сессии, расход, микрофон, приватность) и проба голосов. Всё — в localStorage.
'use strict';
L.def('ui/settings', () => {
const { ic } = L.use('ui/icons');
const { esc, Modal } = L.use('ui/dom');
const { Settings } = L.use('core');
const { Voice } = L.use('audio/voice');
const { VOICES } = L.use('content/voices');
const { CONTENT } = L.use('content/index');
const { Api, chatModels } = L.use('ai/api');
const { Mic } = L.use('audio/mic');
const { strangerVoice } = L.use('ai/persona');

const MODES = [['off', 'mute', 'Выкл'], ['both', 'volume', 'Голос + текст'], ['voice', 'volume', 'Только голос']];
const SAMPLE = VOICES.speakers.narrator.sample;
const fmt = n => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// кто есть в пробе голосов: рассказчик, люди с именем, контакты, чаты, служебные, несколько незнакомцев
function voiceList() {
  const S = VOICES.speakers, out = [{ id: 'narrator', name: 'Рассказчик', icon: 'text', sp: 'narrator', text: SAMPLE }];
  for (const p of CONTENT.PEOPLE) out.push({ id: p.id, name: p.name, icon: p.icon, sp: S[p.id] ? p.id : strangerVoice(p.id, false, p.age), text: S[p.id]?.sample || p.lines?.hi?.[0] || 'Здравствуйте.' });
  for (const c of CONTENT.PHONE.contacts) if (S[c.id]) out.push({ id: c.id, name: c.name, icon: c.icon, sp: c.id, text: S[c.id].sample || 'Привет.' });
  for (const c of CONTENT.PHONE.chats) if (S[c.id]) out.push({ id: c.id, name: c.name, icon: c.icon, sp: c.id, text: S[c.id].sample || 'Сообщение.' });
  for (const [id, name, icon] of [['border', 'Пограничник', 'shield'], ['geo_guard', 'Грузинский пост', 'shield'], ['sister', 'Сестра', 'call'], ['megaphone', 'Рупор', 'horn']]) out.push({ id, name, icon, sp: id, text: S[id].sample });
  const demo = [['d1', false, 28, '', 'Третьи сутки тут. Главное — не глушить мотор.'], ['d2', true, 33, '', 'Вы не знаете, волонтёры далеко? У меня ребёнок.'],
    ['d3', false, 57, 'os', 'Пирожки горячие, бери. Утром меньше народу будет.'], ['d4', true, 66, 'os', 'Заходи, сынок, погрейся. Чай есть.'],
    ['d5', false, 41, 'ge', 'Я домой, в Тбилиси. Двадцать лет в Москве прожил.'], ['d6', true, 24, '', 'Ну и очередь… Кто бы знал, что так будет.']];
  for (const [id, f, age, o, text] of demo) {
    const sp = strangerVoice('demo:' + id, f, age, o), mood = VOICES.moods.find(m => sp.say.includes(m.say));
    out.push({ id, name: (f ? 'Незнакомка' : 'Незнакомец') + ', ' + age + (o === 'os' ? ' · местн.' : o === 'ge' ? ' · грузин' : ''), icon: 'user', sp, text, tag: mood?.id });
  }
  return out;
}
let lit = false;
function litOnce() { if (lit) return; lit = true; Voice.listen(v => document.querySelectorAll('[data-pv]').forEach(b => b.classList.toggle('on', v.playing('pv:' + b.dataset.pv)))); }

function openSettings(game) {
  const o = Voice.opt, key = o('voiceKey'), mode = o('voiceMode'), vl = voiceList();
  const cur = s => { const r = Voice.resolve(s.sp, o('voiceModel')); return r.voice; };
  const html = `<div class="plate card set">
    <div class="hd">${ic('gear', 'l')}<h2>Настройки</h2><button class="btn sq x" data-close>${ic('close')}</button></div>
    <div class="sh">${ic('volume')}<b>Озвучка</b><span class="dim">OpenAI</span></div>
    <div class="seg">${MODES.map(([id, icn, lb]) => `<button class="btn${mode === id ? ' on' : ''}" data-mode="${id}">${ic(icn)}${id === 'both' ? ic('text', 's') : ''}<span>${lb}</span></button>`).join('')}</div>
    <div class="srow">${ic('key')}<input type="password" id="s-key" placeholder="sk-…" autocomplete="off" spellcheck="false" value="${esc(key)}"><button class="btn" id="s-check">${ic('check', 's')}Проверить</button><span id="s-kst" class="kst"></span></div>
    <div class="note dim">${ic('shield', 's')}<span>Ключ хранится только в этом браузере, запросы идут напрямую в OpenAI · <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">получить ключ</a></span></div>
    <div class="note dim">${ic('dollar', 's')}<span>Платно, за символы · фраза оплачивается один раз, потом — из кэша</span></div>
    <div class="srow">${ic('chip')}<span>Модель</span><select id="s-model">${Object.keys(VOICES.models).map(m => `<option${m === o('voiceModel') ? ' selected' : ''}>${m}</option>`).join('')}</select></div>
    <div class="srow">${ic('volume')}<input type="range" id="s-vol" min="0" max="1" step="0.05" value="${o('voiceVol')}"><b class="num" id="s-volv"></b></div>
    <div class="srow">${ic('fast')}<input type="range" id="s-spd" min="0.7" max="1.5" step="0.05" value="${o('voiceSpeed')}"><b class="num" id="s-spdv"></b></div>
    <label class="srow chk">${ic('chat')}<span>Читать чат вслух</span><input type="checkbox" id="s-chat"${o('voiceChat') ? ' checked' : ''}></label>
    <div class="btns"><button class="btn" id="s-try">${ic('play', 's')}Проба</button><button class="btn" id="s-del">${ic('trash', 's')}Удалить ключ</button></div>
    <details class="vlist" id="s-voices"><summary>${ic('people', 's')}<b>Голоса</b><span class="dim">${vl.length}</span></summary>
      <div class="vrows">${vl.map((s, i) => `<div class="vrow">${ic(s.icon || 'user', 's')}<span class="vnm">${esc(s.name)}</span><span class="dim vv" data-vv="${i}">${esc(cur(s))}${s.tag ? ' · ' + s.tag : ''}</span><button class="vbtn" data-pv="${esc(s.id)}" data-i="${i}" title="Послушать">${ic('play', 's')}</button></div>`).join('')}</div>
    </details>
    <div class="sh">${ic('mic')}<b>Разговор</b><span class="dim">V · «Сказать своё»</span></div>
    <div class="srow">${ic('chat')}<span>Ответы</span><select id="s-tmodel"><option value="">авто</option></select></div>
    <div class="srow">${ic('ear')}<span>Распознавание</span><select id="s-stt">${Api.STT.map(m => `<option${m === Api.opt('sttModel') ? ' selected' : ''}>${m}</option>`).join('')}</select></div>
    <div class="srow">${ic('alert')}<input type="range" id="s-cap" min="20" max="300" step="10" value="${Api.cap()}"><b class="num" id="s-capv"></b></div>
    <div class="chips" id="s-use"></div>
    <div class="note dim">${ic('mic', 's')}<span id="s-mic"></span></div>
    <div class="note dim">${ic('shield', 's')}<span>Запись голоса и реплики уходят напрямую в OpenAI с твоим ключом; игра их не хранит (в сохранении — только текст последних реплик)</span></div>
  </div>`;
  Modal.show(html, el => {
    const $ = s => el.querySelector(s);
    const show = () => {
      $('#s-volv').textContent = Math.round(o('voiceVol') * 100) + '%';
      $('#s-spdv').textContent = (+o('voiceSpeed')).toFixed(2).replace(/0$/, '') + '×';
      $('#s-capv').textContent = Api.cap();
      el.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === o('voiceMode')));
      $('#s-del').disabled = !o('voiceKey'); $('#s-try').disabled = !Voice.on();
      el.querySelectorAll('[data-pv]').forEach(b => b.disabled = !Voice.on());
      el.querySelectorAll('[data-vv]').forEach(s => { const v = vl[+s.dataset.vv]; s.firstChild.textContent = cur(v) + (v.tag ? ' · ' + v.tag : ''); });
      const u = Api.usage;
      $('#s-use').innerHTML = [['chat', u.chat, 'ответов'], ['mic', u.stt, 'фраз'], ['clock', Math.round(u.sttSec) + ' с', 'речи'], ['volume', Voice.stats.req, 'озвучено'],
        ['text', fmt(Voice.stats.chars) + '', 'символов'], ['chip', fmt(u.tokIn + u.tokOut), 'токенов']].map(([i, v, t]) => `<span class="chip i" title="${t}">${ic(i)}${v} ${t}</span>`).join('') +
        (Api.spent() >= Api.cap() ? `<span class="chip n">${ic('alert')}лимит сессии</span>` : '');
      $('#s-mic').textContent = Mic.ok() ? 'Микрофон доступен: держи V или кнопку 🎙 в разговоре' : 'Микрофон недоступен (' + Mic.why() + ') — говорить можно текстом';
    };
    const st = (icon, cls, t) => { const s = $('#s-kst'); s.className = 'kst ' + cls; s.innerHTML = ic(icon, 's') + (t ? `<span>${esc(t)}</span>` : ''); };
    const fillModels = ids => {
      const sel = $('#s-tmodel'), saved = Settings.get('talkModel') || '';
      const list = ids ? chatModels(ids) : [];
      if (saved && !list.includes(saved)) list.unshift(saved);
      sel.innerHTML = `<option value="">авто${list[0] ? ' · ' + esc(list[0]) : ''}</option>` + list.map(m => `<option${m === saved ? ' selected' : ''}>${esc(m)}</option>`).join('');
      if (ids) { const sttSel = $('#s-stt'); [...sttSel.options].forEach(op => op.disabled = !ids.includes(op.value)); }
    };
    fillModels(Api.ids);
    if (Api.ready() && !Api.ids) Api.models().then(ids => { if (el.isConnected) fillModels(ids); });
    $('[data-close]').onclick = () => Modal.close();
    el.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { Voice.set('voiceMode', b.dataset.mode); if (b.dataset.mode === 'off') Voice.stop(); show(); });
    const key = $('#s-key');
    key.oninput = () => { Voice.set('voiceKey', key.value.trim()); Api.ids = null; st('key', '', ''); show(); };
    key.onkeydown = e => e.stopPropagation();
    $('#s-check').onclick = async () => {
      st('clock', '', '…');
      const r = await Voice.check(key.value.trim());
      // рабочий ключ при выключенной озвучке — сразу включаем «голос + текст», иначе кажется, что не работает
      if (r === 'ok') { if (o('voiceMode') === 'off') Voice.set('voiceMode', 'both'); Settings.set('keyAsk', 'done'); st('check', 'ok', ''); Api.models(true).then(ids => { if (el.isConnected) fillModels(ids); }); }
      else if (r === 'bad') st('close', 'bad', 'неверный'); else st('alert', 'bad', 'нет сети');
      show();
    };
    $('#s-model').onchange = e => { Voice.set('voiceModel', e.target.value); show(); };
    $('#s-tmodel').onchange = e => Settings.set('talkModel', e.target.value);
    $('#s-stt').onchange = e => Settings.set('sttModel', e.target.value);
    $('#s-cap').oninput = e => { Settings.set('talkCap', +e.target.value); show(); };
    $('#s-vol').oninput = e => { Voice.set('voiceVol', +e.target.value); show(); };
    $('#s-spd').oninput = e => { Voice.set('voiceSpeed', +e.target.value); show(); };
    $('#s-chat').onchange = e => Voice.set('voiceChat', e.target.checked ? 1 : 0);
    $('#s-try').onclick = () => Voice.say([{ speaker: 'narrator', text: SAMPLE }], { key: 'sample' });
    $('#s-del').onclick = () => { Voice.stop(); Voice.set('voiceKey', ''); Api.ids = null; key.value = ''; st('trash', '', 'удалён'); fillModels(null); show(); };
    litOnce();
    el.querySelectorAll('[data-pv]').forEach(b => b.onclick = () => {
      const s = vl[+b.dataset.i], k = 'pv:' + s.id;
      if (Voice.playing(k)) Voice.stop(); else Voice.say([{ speaker: s.sp, text: s.text }], { key: k });
    });
    show();
  }, 'settings');
}
return { openSettings, voiceList };
});
