// Сыграть вечер как игрок — мышью через интерфейс: подойти, выбрать карту, свести двоих, заказать, телефон, фото.
// Время между действиями проматывается шагами симуляции. Снимки — в OUT (по умолчанию tests/play/), лог — в консоль.
// node play.js [seed] [W×H]     например: node play.js 5 390x844
import { serve } from './serve.js';
import { launch, watch, enterHall, skipTo, simFor, presentList, clickPerson } from './game.js';
import fs from 'node:fs';
const OUT = process.env.OUT || new URL('./play/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const seed = +(process.argv[2] || 5), [W, H] = (process.argv[3] || '1280x800').split('x').map(Number);
const mobile = W < 700;
const { srv, url } = await serve();
const b = await launch();
const pg = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: mobile ? 2 : 1, hasTouch: mobile, isMobile: mobile });
const errs = []; watch(pg, errs);
let shotN = 0;
const shot = async name => { const f = `${OUT}${String(++shotN).padStart(2, '0')}-${name}.png`; await pg.screenshot({ path: f }); console.log('  📸', f.split('/').pop()); };
const log = (...a) => console.log(...a);
const click = async sel => { const el = await pg.$(sel); if (!el || !(await el.isVisible())) return false; if (mobile) await el.tap(); else await el.click(); return true; };

await pg.goto(url + '?seed=' + seed);
await enterHall(pg);
await pg.evaluate(() => { const w = SKHODKA.w; window.__log = []; for (const t of ['toast', 'pair', 'ladder', 'event']) w.bus.on(t, d => window.__log.push([t, w.hour.toFixed(2), d.text || d.title || d.id || '', d.step ?? d.on ?? '']));
  w.bus.on('talk:line', d => { if (d.who !== 'me') window.__log.push(['line', w.hour.toFixed(2), d.text]); }); });
await pg.waitForTimeout(1200); await shot('hall-start');

// выбор карты «как игрок»: карта-действие (контакт/договориться), когда можно; иначе — с темой, которую видно у человека;
// иначе — по складу, если он раскрыт; иначе — первая
const pickCard = () => pg.evaluate(() => {
  const w = SKHODKA.w, c = w.talk.cur; if (!c || c.pending) return -1;
  const cards = [...document.querySelectorAll('.talk .t-cards .card')]; if (!cards.length) return -1;
  const n = w.people.get(c.id), offer = c.offer || [];
  const mind = n.known.mind ? w.idx.MINDS[n.mind] : null, topics = n.known.topics ? n.topics : [];
  let best = 0, bs = -1e9;
  offer.slice(0, cards.length).forEach((k, i) => {
    let s = Math.random() * 0.5;
    if (k.act === 'contact') s += n.rapport >= w.talk.contactThr(n) ? 5 : -5;
    if (k.act === 'deal') s += n.rapport >= w.T.talk.deal && w.talk.dealWhy(n) ? 6 : -6;
    if (k.act === 'bye') s -= 9;
    if (k.topic && (topics.includes(k.topic) || w.player.topics.includes(k.topic))) s += 1.5;
    if (mind && mind.likes.includes(k.style)) s += 2; if (mind && mind.dislikes.includes(k.style)) s -= 3;
    if (s > bs) { bs = s; best = i; }
  });
  return best;
});

const tried = new Map();
let phoneShot = false, talkShots = 0, pairShot = false, orderShot = false;
while (true) {
  const st = await pg.evaluate(() => { const w = SKHODKA.w; return { over: w.over, hour: w.hour, talk: w.talk.cur?.id ?? null, energy: w.player.energy, photoEv: w.events.some(e => e.effect.photo), me: w.score.photo }; });
  if (st.over) break;
  // общее фото: кнопка появляется — жмём
  if (st.photoEv && !st.me) {
    if (await click('.acts [data-photo]:not([hidden])')) { log('→ на фото'); await simFor(pg, 25); await pg.waitForTimeout(300); await shot('photo'); continue; }
  }
  if (st.energy < 0.3 && !st.talk) {
    await click('.acts [data-order]'); if (!orderShot) { await pg.waitForTimeout(200); await shot('order-menu'); orderShot = true; }
    await click('.a-menu [data-it="beer"]'); log('→ пиво'); await simFor(pg, 6);
  }
  if (!phoneShot && st.hour > 20.6) {
    await click('.hud [data-phone]'); await pg.waitForTimeout(300); await shot('phone'); await click('.phone [data-close]'); phoneShot = true;
  }
  if (st.talk) {
    // свести: знакомый, у кого совпадает нужда ↔ предложение или тема
    const pair = await pg.evaluate(() => {
      const w = SKHODKA.w, n = w.people.get(w.talk.cur.id); if (n.step < 2) return null;
      for (const m of w.list) { if (m === n || !m.present || m.step < 2) continue;
        const key = [n.id, m.id].sort().join('|'); if (w.talk.pairs.has(key) || (window.__tp ||= new Set()).has(key)) continue;
        if ((n.need && n.need === m.offer) || (m.need && m.need === n.offer) || n.topics.some(t => m.topics.includes(t))) { window.__tp.add(key); return m.id; } }
      return null;
    });
    if (pair && await click('.talk [data-intro]:not([disabled])')) {
      await pg.waitForTimeout(150);
      if (!pairShot) { await shot('introduce-pick'); }
      if (await click(`.talk .pchip[data-b="${pair}"]`)) { log('→ знакомлю с', pair); await simFor(pg, 2); if (!pairShot) { await shot('introduce-done'); pairShot = true; } continue; }
    }
    const n = await pg.evaluate(() => { const w = SKHODKA.w, n = w.people.get(w.talk.cur.id); return { step: n.step, turns: w.talk.cur.turns ?? 0 }; });
    const turns = (tried.get('t' + st.talk) || 0) + 1; tried.set('t' + st.talk, turns);
    if (n.step >= 5 || turns > 10 || (n.step >= 4 && turns > 6)) { await click('.talk [data-bye2]'); log('→ ухожу, ступень', n.step); continue; }
    const i = await pickCard();
    if (i >= 0) { const cards = await pg.$$('.talk .t-cards .card'); if (cards[i]) { if (mobile) await cards[i].tap(); else await cards[i].click(); } }
    await simFor(pg, 1.6); await pg.waitForTimeout(60);
    if (talkShots < 3 && turns === 2) { await shot('talk-' + talkShots); talkShots++; }
    continue;
  }
  // подойти к ближайшему, с кем ещё не дошли до контакта
  const ppl = (await presentList(pg)).filter(p => p.step < 4 && !(tried.get(p.id) > st.hour - 0.3)).sort((a, b) => a.d - b.d);
  let went = null;
  for (const p of ppl.slice(0, 6)) if (await clickPerson(pg, p.id)) { went = p; break; }
  if (!went && ppl[0]) { await pg.evaluate(id => SKHODKA.ui.act({ type: 'approach', id }), ppl[0].id); went = ppl[0]; }
  if (went) {
    tried.set(went.id, st.hour); log(`${Math.floor(st.hour)}:${String(Math.round(st.hour % 1 * 60)).padStart(2, '0')} → к`, went.name, `(${went.d.toFixed(1)} м)`);
    for (let k = 0; k < 30; k++) { await simFor(pg, 0.5); if (await pg.evaluate(() => !!SKHODKA.w.talk.cur || !SKHODKA.w.player.goal)) break; }
  } else await simFor(pg, 20);
  // пусть идёт время: между разговорами — пара игровых минут
  await skipTo(pg, st.hour + 0.04);
}
await pg.waitForSelector('.scr.end', { timeout: 30000 }); await pg.waitForTimeout(400); await shot('end');
const sum = await pg.evaluate(() => { const s = SKHODKA.w.score.stats(); return { ...s, title: SKHODKA.w.score.title()?.title }; });
log('итог', JSON.stringify(sum));
const L = await pg.evaluate(() => window.__log);
log('события:', L.filter(x => x[0] === 'event' && x[3] === true).map(x => x[1] + ' ' + x[2]).join(' · '));
log('пары:', L.filter(x => x[0] === 'pair').length, ' тостов:', L.filter(x => x[0] === 'toast').length);
log(errs.length ? 'ОШИБКИ:\n' + errs.join('\n') : 'консоль чистая');
await b.close(); srv.close();
