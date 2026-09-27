// Телефон: чаты (слухи участка, SOS), сообщения из дома с ответами, батарея. Садится — только совет, где зарядить.
'use strict';
L.def('ui/phone', () => {
const { ic } = L.use('ui/icons');
const { esc, chips, Modal } = L.use('ui/dom');
const { msgBlock } = L.use('ui/speak');

function openPhone(game, chatId = null, free = false) {
  const w = game.w, P = w.C.PHONE, p = w.player;
  if (!chatId && !free) w.addNeed('charge', -w.T.phone.use);
  const bat = Math.round(p.needs.charge);
  const sig = w.signal();
  const bar = `<div class="pbar"><span class="num">${w.clock.label().time}</span><span style="color:${sig ? 'var(--s-ok)' : 'var(--s-danger)'};font-size:11px">${sig ? '▂▄▆' : 'нет сети'}</span><span class="bat">${ic('battery', 's')}<b class="num" style="color:${bat < 15 ? 'var(--s-danger)' : 'inherit'}">${bat}%</b></span><button class="btn sq" data-close style="min-height:26px;width:26px">${ic('close', 's')}</button></div>`;
  if (bat <= 0) {
    Modal.show(`<div class="phone">${bar}<div></div><div class="dead">${ic('battery', 'xl')}<b>Телефон сел</b><div class="chips"><span class="chip i">${ic('plug')}продавец</span><span class="chip i">${ic('fire')}мотор</span><span class="chip i">${ic('battery')}повербанк</span></div></div><div></div></div>`,
      el => el.querySelector('[data-close]').onclick = () => Modal.close(), 'phone');
    return;
  }
  const chats = [...P.chats.filter(c => w.chatAvailable(c)), ...P.contacts.filter(c => w.role.contacts.includes(c.id))];
  const msgs = w.phone.msgs;
  if (!chatId) {
    const list = chats.map(c => {
      const ms = msgs.filter(m => m.chat === c.id), last = ms[ms.length - 1], un = ms.filter(m => !m.read).length;
      return `<div class="pchat" data-c="${c.id}"><span class="av">${ic(c.icon)}</span><b>${esc(c.name)}</b><span class="badge">${un || ''}</span><span class="last">${last ? esc(last.text) : '—'}</span><span class="dim num" style="font-size:10px">${last ? w.clock.label(last.t).time : ''}</span></div>`;
    }).join('');
    Modal.show(`<div class="phone">${bar}<div class="phead">${ic('chat')}<b>Чаты</b></div><div class="plist">${list}</div><div></div></div>`, el => {
      el.querySelector('[data-close]').onclick = () => Modal.close();
      el.querySelectorAll('[data-c]').forEach(d => d.onclick = () => { Modal.close(); openPhone(game, d.dataset.c); });
    }, 'phone');
    return;
  }
  const c = chats.find(x => x.id === chatId);
  const ms = msgs.filter(m => m.chat === chatId);
  for (const m of ms) if (!m.read) { m.read = true; w.phone.unread = Math.max(0, w.phone.unread - 1); }
  const pend = [...ms].reverse().find(m => m.replies && m.replied == null);
  const body = ms.slice(-40).map(m => {
    const r = m.rumour && w.rum.byId.get(m.rumour);
    const cls = m.from === 'me' ? 'me' : m.reveal ? 'rev' : m.rumour ? 'rum' : '';
    return `<div class="msg ${cls}">${msgBlock(w, m, (r && !m.reveal ? ic(r.icon, 's') + ' ' : '') + esc(m.text))}<small>${w.clock.label(m.t).date} · ${w.clock.label(m.t).time}</small></div>`;
  }).join('');
  Modal.show(`<div class="phone">${bar}<div class="phead"><button class="btn sq" data-back style="min-height:28px;width:28px">${ic('back', 's')}</button>${ic(c.icon)}<b>${esc(c.name)}</b></div>
    <div class="msgs" id="p-msgs">${body || '<div class="dim">пусто</div>'}</div>
    <div class="preps">${pend ? pend.replies.map((r, i) => `<button class="btn" data-r="${i}">${esc(r.label)}</button>`).join('') : ''}<div id="p-res"></div></div></div>`, el => {
    el.querySelector('[data-close]').onclick = () => Modal.close();
    el.querySelector('[data-back]').onclick = () => { Modal.close(); openPhone(game, null, true); };
    const box = el.querySelector('#p-msgs'); box.scrollTop = box.scrollHeight;
    el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
      const res = w.reply(pend, +b.dataset.r); Modal.close(); openPhone(game, chatId);
      if (res) game.toastChips(res.chips);
    });
  }, 'phone');
}
return { openPhone };
});
