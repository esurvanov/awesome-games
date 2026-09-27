// Реакции интерфейса на события волны 2: приход НПС, пожар, смерть, рождение, навыки, звонки.
import { h } from './dom.js';

// Роли НПС: подпись для всплывашки у курсора + тост и звук при приходе
export const NPC_UI = {
  maid: { name: 'Горничная', icon: '🧹', arrive: 'Пришла горничная', sfx: 'doorbell' },
  repair: { name: 'Мастер', icon: '🔧', arrive: 'Мастер пришёл', sfx: 'doorbell' },
  fire: { name: 'Пожарный', icon: '🚒', arrive: 'Пожарные приехали', sfx: 'burglar', cls: 'alert' },
  police: { name: 'Полиция', icon: '👮', arrive: 'Полиция на месте', sfx: 'burglar', cls: 'alert' },
  burglar: { name: 'Грабитель', icon: '🦹', arrive: 'Грабитель в доме!', cls: 'alert' },
  pizza: { name: 'Разносчик пиццы', icon: '🍕', arrive: 'Пицца привезена', sfx: 'pizza' },
  visitor: { name: 'Гость', icon: '🏠', arrive: 'Пришли гости', sfx: 'doorbell' },
  townie: { name: 'Знакомый', icon: '🙋', arrive: 'Зашёл знакомый', sfx: 'doorbell' },
  carpool: { name: 'Водитель', icon: '🚗' },
  reaper: { name: 'Смерть', icon: '💀' },
};
export const npcName = s => (s?.npc ? `${NPC_UI[s.npc]?.icon || '👤'} ${s.name && s.npc !== 'reaper' ? s.name + ' · ' : ''}${NPC_UI[s.npc]?.name || 'Гость'}` : null);

const CAUSE = { hunger: 'от голода', starve: 'от голода', fire: 'в огне', shock: 'от удара током', drown: 'утонул(а)', old: 'от старости' };

export function createEvents(ctx) {
  const { state, bus } = ctx;
  const fireEl = h('div.zh-fire', { hidden: true });
  ctx.root.append(fireEl);
  ctx.skillEvents = false;
  const has = def => state.objects.some(o => o.def === def && !o.st?.broken && !o.st?.burnt);

  bus.on('npc:arrive', ({ simId, npc }) => {
    const r = NPC_UI[npc];
    if (!r?.arrive) return;
    ctx.toast(r.arrive, r.icon, simId, r.cls);
    // сигнализация срабатывает, только если она куплена
    if (npc === 'burglar') { if (has('burglar_alarm')) ctx.audio.sfx('burglar'); }
    else if (r.sfx) ctx.audio.sfx(r.sfx);
  });
  bus.on('fire:start', () => { syncFire(); ctx.toast('Пожар!', '🔥', null, 'alert'); });
  bus.on('fire:out', () => syncFire());
  bus.on('lot:changed', ({ kind } = {}) => { if (kind === 'fire') syncFire(); });
  bus.on('sim:died', ({ simId, cause }) => {
    const s = state.sims.find(x => x.id === simId);
    const who = s?.name || 'Житель';
    ctx.toast(`${who} умер(ла)${CAUSE[cause] ? ' ' + CAUSE[cause] : ''}`, '🕯️', simId, 'death', 12);
    ctx.audio.sfx('reaper');
    setTimeout(() => ctx.audio.sfx('sad'), 1800);
  });
  // {simId:null, cribId} — младенец в кроватке; {simId} — младенец вырос в ребёнка
  bus.on('sim:born', ({ simId, cribId }) => {
    if (simId == null) {
      const crib = state.objects.find(o => o.id === cribId);
      ctx.toast(`Родился малыш${crib?.st?.baby?.name ? ' ' + crib.st.baby.name : ''}!`, '👶', null, 'joy');
      ctx.audio.sfx('babyCry');
      setTimeout(() => ctx.audio.sfx('celebrate'), 900);
      return;
    }
    const s = state.sims.find(x => x.id === simId);
    ctx.toast(`${s?.name || 'Малыш'} подрос(ла)!`, '🧒', simId, 'joy');
    ctx.audio.sfx('celebrate');
  });
  bus.on('skill:up', ({ simId }) => {
    ctx.skillEvents = true; // Мозг шлёт событие — свой наблюдатель навыков больше не нужен
    if (ctx.household().some(s => s.id === simId)) ctx.audio.sfx('skill');
  });

  // Пожар: рамка мигает и трещит, пока есть огонь; пищалка — если есть датчик дыма
  function syncFire() {
    const burning = (state.lot.fires || []).length > 0;
    fireEl.hidden = !burning;
    ctx.audio.loop('fire', burning);
    ctx.audio.loop('smoke', burning && has('smoke_alarm'));
  }
  return { update() { const b = (state.lot.fires || []).length > 0; if (b === fireEl.hidden) syncFire(); } };
}
