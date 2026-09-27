// Свободный разговор: системная подсказка из состояния мира (кто человек, что продаёт и почём сейчас, что слышал,
// где и когда, что у игрока, о чём говорили раньше) + строгая схема ответа { reply, emotion, intent, effects[] }.
// Эффекты — только из белого списка (js/ai/effects.js проверяет и применяет). DOM не трогает (работает в Node).
'use strict';
L.def('ai/prompt', () => {
const { fmtDur } = L.use('core');
const { NEED_NAME } = L.use('sim/rules');

const EMOTIONS = ['calm', 'warm', 'tired', 'nervous', 'irritated', 'joking', 'sad', 'happy', 'suspicious'];
const INTENTS = ['chat', 'sell', 'give', 'lend', 'rumour', 'ask_help', 'swap', 'let_ahead', 'lift', 'refuse', 'end'];
const EFFECTS = ['trust', 'sell', 'give', 'lend', 'rumour', 'ask_help', 'swap', 'let_ahead', 'lift', 'helped', 'harmed', 'end'];
const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['reply', 'emotion', 'intent', 'effects'],
  properties: {
    reply: { type: 'string', description: 'Что человек говорит вслух: 1–3 коротких предложения разговорной русской речи' },
    emotion: { type: 'string', enum: EMOTIONS },
    intent: { type: 'string', enum: INTENTS },
    effects: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['type', 'value', 'good', 'rumour', 'note'],
      properties: {
        type: { type: 'string', enum: EFFECTS },
        value: { type: ['integer', 'null'] }, good: { type: ['string', 'null'] }, rumour: { type: ['string', 'null'] }, note: { type: ['string', 'null'] },
      } } },
  },
};
// что человек может подарить, если он не продавец (мелочь из своих запасов)
const GIFTS = ['pie', 'bread', 'water', 'choco', 'cigs', 'snack'];
const TRUTH = { true: 'правда', false: 'неправда', half: 'полуправда', unknown: 'никто не знает' };
const WX = { clear: 'ясно', cloud: 'облачно', drizzle: 'морось', rain: 'дождь', storm: 'ливень', wind: 'ветер' };
const fmt = n => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const trustWord = t => t <= -40 ? 'враждебно' : t < -10 ? 'недоверчиво' : t < 10 ? 'нейтрально, как к незнакомцу' : t < 30 ? 'по-доброму' : t < 60 ? 'как к своему' : 'как к близкому другу';

// где человек (s — м от КПП по дороге)
function posOf(w, per) {
  if (per.seller) return per.seller.s;
  if (per.car) return per.car.s;
  if (per.ped) return per.ped.s;
  if (per.kind === 'named') { const q = w.npcPos(per.id); if (q && q.s != null) return q.s; }
  return w.playerS();
}
// слухи, которые человек может рассказать: свои (named) + то, что ходит в его участке
function knownRumours(w, per) {
  const out = new Map();
  if (per.kind === 'named') for (const id of per.st?.knows || per.def.knows || []) { const r = w.rum.byId.get(id); if (r && w.clock.t >= r.t0) out.set(id, r); }
  const s = posOf(w, per);
  for (const x of w.rum.at(s).filter(x => x.v > 0.04).sort((a, b) => b.v - a.v).slice(0, 4)) out.set(x.r.id, x.r);
  return [...out.values()].slice(0, 6);
}
// может ли подарить (id товаров)
function giftable(w, per) {
  if (per.seller) return per.seller.goods.filter(id => { const g = w.goods.get(id); return g && g.cat !== 'transport' && g.base <= 700 && (g.service || (per.seller.stock[id] ?? 0) >= 1); });
  return GIFTS;
}
// соседство в очереди (машина прямо перед / за игроком)
function neighbour(w, per) {
  const car = w.pcar; if (!per.car || !car) return '';
  const a = w.queue.cars.filter(c => c.lane === car.lane), i = a.indexOf(car), j = a.indexOf(per.car);
  if (i < 0 || j < 0) return '';
  if (j === i - 1) return 'ahead'; if (j === i + 1) return 'behind';
  return '';
}
function seatsFree(w) { const c = w.pcar; return c ? Math.max(0, c.seats - 1 - w.player.passengers.length) : 0; }
function swapPrice(w) { return Math.max(1000, Math.round(w.econ.market('seat') * 0.5 / 100) * 100); }
// что человек физически может сделать сейчас — для подсказки и для проверки эффектов
function abilities(w, per) {
  const tr = w.trustOf(per.trustKey), nb = neighbour(w, per);
  const isPed = !!per.ped || (per.kind === 'named' && per.def.kind === 'walker');
  return {
    trust: tr, neighbour: nb, isPed,
    sell: !!per.seller && per.seller.priceMul !== 0 && w.econ.active(per.seller),
    free: !!per.seller && per.seller.priceMul === 0,
    gifts: giftable(w, per), rumours: knownRumours(w, per),
    lend: tr >= 20,
    swap: nb === 'ahead', swapPrice: swapPrice(w),
    letAhead: nb === 'behind',
    lift: isPed && !!w.pcar && seatsFree(w) > 0 && !w.player.passengers.some(x => x.id === per.key),
  };
}

function sellLines(w, per) {
  const sel = per.seller; if (!sel) return '';
  const tr = w.trustOf(sel.npc), acc = sel.accepts.map(a => ({ cash_rub: 'наличные ₽', cash_usd: 'доллары', transfer_rub: 'перевод', card_mir: 'карта «Мир»', cash_gel: 'лари' }[a] || a)).join(', ');
  const rows = sel.goods.map(id => {
    const g = w.goods.get(id); if (!g) return '';
    const pr = w.econ.price(sel, id, tr), st = sel.stock[id] ?? 0;
    return `- ${id}: «${g.name}» — ${pr ? fmt(pr) + ' ₽' : 'бесплатно'}${g.service ? '' : st < 1 ? ', кончилось' : st < 5 ? ', осталось мало' : ''}`;
  }).filter(Boolean).join('\n');
  return `\nЧТО У ТЕБЯ ЕСТЬ (цены для этого человека сейчас; торговаться можно в пределах ±20 %)\n${rows}\n- оплата: ${sel.priceMul === 0 ? 'ничего не берёшь — ты раздаёшь бесплатно' : acc}`;
}

function whereLine(w, per) {
  const s = posOf(w, per), km = (Math.max(0, s - w.queue.gateS) / 1000).toFixed(1).replace('.', ',');
  if (per.seller) return `стоишь у дороги со своим товаром, ${km} км до КПП`;
  if (per.car) {
    const M = w.C.CARS.models[per.car.mi]?.name || 'машина', nb = neighbour(w, per);
    return `в очереди в своей машине (${M}, ${per.car.n} чел.)${nb === 'ahead' ? ', прямо перед машиной игрока' : nb === 'behind' ? ', прямо за машиной игрока' : ''}, ${km} км до КПП`;
  }
  if (per.ped || per.def?.kind === 'walker') return `пешком у очереди, ${km} км до КПП`;
  return `${km} км до КПП`;
}
function stateLine(per) {
  const c = per.car; if (!c) return '';
  const a = [];
  if (c.hu < 35) a.push('голоден'); if (c.th < 35) a.push('хочет пить'); if (c.wa < 35) a.push('замёрз'); if (c.ne < 30) a.push('на нервах'); if (c.fuel < 3) a.push('бензин почти кончился');
  return a.length ? '\n- Состояние: ' + a.join(', ') : '';
}
function placeNear(w) {
  const s = w.playerS() / 1000; let best = null, bd = 0.8;
  for (const p of w.C.ROUTE.places) { const d = Math.abs(p.s - s); if (d < bd) { bd = d; best = p; } }
  return best ? best.name : '';
}
function playerLines(w) {
  const p = w.player, r = w.role, m = p.money, low = Object.entries(p.needs).filter(([, v]) => v < 35).map(([k, v]) => `${NEED_NAME[k]} ${Math.round(v)}/100`);
  const items = Object.entries(p.items).filter(([, n]) => n > 0).map(([id, n]) => `${id} «${w.goods.get(id)?.name || id}» ×${n}`);
  return `- ${r.name}, ${r.age}, ${r.job}; ${p.inCar ? 'сидит в своей машине' : 'вышел из машины, стоит рядом'}; свободных мест в его машине: ${seatsFree(w)}
- ${low.length ? 'Ему плохо: ' + low.join(', ') : 'Держится'}
- Деньги: наличные ${fmt(m.rub_cash)} ₽, $${fmt(m.usd)}, карта «Мир» ${fmt(m.rub_card)} ₽ (в Грузии не работает)
- В рюкзаке: ${items.length ? items.join(', ') : 'пусто'}${p.passengers.length ? '\n- В машине с ним: ' + p.passengers.map(x => x.name).join(', ') : ''}`;
}
function pastLines(w, per) {
  const name = per.name, L = w.ledger, a = [];
  for (const x of L.helped) if (x.text.includes(name)) a.push('помог тебе: ' + x.text);
  for (const x of L.harmed) if (x.text.includes(name)) a.push('задел тебя: ' + x.text);
  for (const x of L.got) if (x.text.includes(name)) a.push('получил от тебя: ' + x.text);
  return a.length ? '\nЧТО БЫЛО МЕЖДУ ВАМИ\n' + a.slice(-5).map(s => '- ' + s).join('\n') : '';
}

function effectLines(w, per, ab) {
  const L = [`- trust {value: от −15 до 15} — как изменилось твоё отношение после его слов (вежливо, по-человечески, помог — плюс; грубо, нагло — минус). Не каждый раз.`];
  if (ab.sell) L.push(`- sell {good: id из «что у тебя есть», value: цена в ₽ около указанной} — предложить купить одну штуку (он подтвердит сам)`);
  if (ab.free) L.push(`- sell {good: id из «что у тебя есть», value: 0} — дать взять бесплатно`);
  if (ab.trust >= 0) L.push(`- give {good: одно из ${ab.gifts.join(', ')}} — угостить/подарить одну штуку, если по-человечески хочется (не чаще раза в день)`);
  if (ab.lend) L.push(`- lend {value: до 1000} — одолжить наличные ₽ (редко, только своему)`);
  if (ab.rumours.length) L.push(`- rumour {rumour: id из «что ты слышал»} — пересказать слух`);
  L.push(`- ask_help {good: id вещи из его рюкзака ИЛИ value: до 2000 ₽, note: зачем, 2–5 слов} — попросить его о помощи`);
  if (ab.swap) L.push(`- swap {value: цена в ₽, около ${fmt(ab.swapPrice)}} — поменяться местами в очереди: он встаёт перед тобой и платит`);
  if (ab.letAhead) L.push(`- let_ahead — попросить его пропустить тебя вперёд на одно место`);
  if (ab.lift) L.push(`- lift — согласиться/попроситься сесть к нему в машину (у него есть место)`);
  L.push(`- helped {note: 2–5 слов} / harmed {note: 2–5 слов} — только если он реально помог тебе или задел тебя этим поступком (для итога пути)`);
  L.push(`- end — ты заканчиваешь разговор (занят, устал, обиделся, ушёл)`);
  return L.join('\n');
}

// { system, messages } для /v1/chat/completions; history — [{ r: 'me'|'npc', t }]
function buildTurn(w, per, history, line) {
  const ab = abilities(w, per), lab = w.clock.label(), env = w.env;
  const d = per.def, lines = d?.lines ? [...(d.lines.hi || []), ...(ab.trust < 0 ? d.lines.low || [] : []), ...(ab.trust >= 30 ? d.lines.high || [] : [])].slice(0, 5) : [];
  const origin = per.origin === 'os' ? (per.f ? 'местная, осетинка' : 'местный, осетин') : per.origin === 'ge' ? (per.f ? 'грузинка, едет домой в Грузию' : 'грузин, едет домой в Грузию') : 'из России, уезжаешь в Грузию';
  const mood = per.speaker && typeof per.speaker === 'object' && per.speaker.mood ? per.speaker.mood : '';
  const rules = env.rules.filter(r => env.active.has(r.id)).map(r => r.label);
  const car = w.pcar, ahead = car ? w.queue.ahead(car) : 0, rate = Math.max(1, env.through('car'));
  const rum = ab.rumours.map(r => `- ${r.id}: «${r.text}» (для тебя как автора: ${TRUTH[r.truth] || '?'}${r.revealed && r.reveal ? '; уже выяснилось: ' + r.reveal : ''})`).join('\n');
  const system = `Ты играешь человека в игре «Ларс». Сентябрь 2022 года, очередь машин на КПП Верхний Ларс (из России в Грузию). Тысячи людей ждут сутками в горном ущелье. Тон — человеческий, эмоциональный, без политики. Злодеев нет: у каждого есть хорошее и плохое.

КТО ТЫ
- ${per.name}, ${per.age} лет, ${per.job}; ${per.f ? 'женщина' : 'мужчина'}, ${origin}
- Хорошее в тебе: ${per.good.join(', ') || '—'}; плохое: ${per.bad.join(', ') || '—'}
- Сейчас: ${whereLine(w, per)}${stateLine(per)}${mood ? '\n- Настроение: ' + mood : ''}
- Отношение к собеседнику: ${Math.round(ab.trust)} из ±100 — ${trustWord(ab.trust)}${lines.length ? '\n- Так ты обычно говоришь: ' + lines.map(s => '«' + s + '»').join(' ') : ''}${sellLines(w, per)}${rum ? `\n\nЧТО ТЫ СЛЫШАЛ (ты сам не знаешь, правда ли это; не выдавай слух за факт)\n${rum}` : ''}

ГДЕ И КОГДА
- ${lab.date}, ${lab.wd}, ${lab.time}, ${env.night() ? 'ночь' : 'день'}; ${WX[env.weather()] || env.weather()}, ${Math.round(env.temp())}°${placeNear(w) ? '; рядом ' + placeNear(w) : ''}
- Собеседник в ${(w.playerKpp() / 1000).toFixed(1).replace('.', ',')} км от КПП, впереди него ~${fmt(ahead)} машин, КПП пропускает ~${Math.round(rate)} машин в час, ждать ~${fmtDur(ahead / rate * 3600)}
- Что сейчас действует: ${rules.join('; ') || 'ничего особенного'}

С КЕМ ГОВОРИШЬ
${playerLines(w)}${pastLines(w, per)}

ПРАВИЛА
1. Говори как живой человек в очереди: коротко, разговорно, 1–3 предложения, по-русски, без списков и эмодзи. Можно междометия и недосказанность.
2. Оставайся в роли. Ты не ассистент и не знаешь ни про какую игру.
3. Без политики и пропаганды: не обсуждай власть, войну, политиков, не оценивай, кто прав. Не оскорбляй народы и национальности. На такие темы уходи по-человечески: «Давай не будем. Доехать бы».
4. Не называй реальных людей (политиков, знаменитостей). Ничего о событиях после сентября 2022.
5. Не выдумывай фактов игры: цены, правила, расстояния, сроки — только из данных выше. Не знаешь — так и скажи.
6. Можешь отказать, торговаться, обидеться, пошутить. Щедрость зависит от отношения. На грубость отвечай по-человечески, без брани.
7. Эффекты — только из списка ниже и только когда они естественно следуют из разговора; чаще всего 0–1 эффект. Сделку предлагаешь словами в reply и эффектом одновременно.

ЭФФЕКТЫ (поле effects; неиспользуемые поля — null)
${effectLines(w, per, ab)}

ОТВЕТ — только JSON: {"reply": "...", "emotion": один из ${EMOTIONS.join('|')}, "intent": один из ${INTENTS.join('|')}, "effects": [{"type": ..., "value": число|null, "good": id|null, "rumour": id|null, "note": текст|null}]}`;
  const messages = [{ role: 'system', content: system }];
  for (const h of (history || []).slice(-10)) messages.push({ role: h.r === 'me' ? 'user' : 'assistant', content: h.r === 'me' ? h.t : JSON.stringify({ reply: h.t, emotion: h.e || 'calm', intent: 'chat', effects: [] }) });
  messages.push({ role: 'user', content: line });
  return { system, messages, abilities: ab };
}
return { SCHEMA, EMOTIONS, INTENTS, EFFECTS, GIFTS, buildTurn, abilities, knownRumours, neighbour, swapPrice, posOf };
});
