'use strict';
// Время суток и погода. Глобальные функции времени читает и рендер (hourOf, daylight, stormOn).
// t — игровое время (по умолчанию «сейчас»); прогноз ночи (Survival.forecast) спрашивает о будущем
const hourOf = (t = G.time) => ((TUNE.time.startH / 24 + t / CYCLE) % 1) * 24;
const dayOf = (t = G.time) => 1 + Math.floor(TUNE.time.startH / 24 + t / CYCLE);
const tAt = (day, hour) => ((day - 1) + hour / 24 - TUNE.time.startH / 24) * CYCLE;
// игровая длительность словами: 105 → «1 ч 45 мин», 60 → «1 ч», 30 → «30 мин» (игровые с → часы и минуты)
function gameDur(sec) {
  const m = Math.round(sec / HOUR * 60), h = Math.floor(m / 60), mm = m % 60;
  return h ? (mm ? `${h} ч ${mm} мин` : `${h} ч`) : `${mm} мин`;
}
function daylight(h = hourOf()) { return smooth(6.4, 8, h) * (1 - smooth(17.6, 19.3, h)); }
const stormOn = (t = G.time) => !!(G.storm && t >= G.storm.a && t < G.storm.b);
function temperature(t = G.time) {
  // БЛОКЕР (баланс, найден ботом на главах V–VII): ночной мороз ограничен снизу coldMin с coldDay-го дня,
  // а дневной — нет: day0 + dayStep·(день−1) падает без предела и к 15–20-му дню (обычное дело для
  // затяжной ветки «посёлок»/«экспедиция») даёт −50…−60°, из-за чего герой замерзает в чистом поле почти
  // мгновенно. Дневной мороз ограничиваем тем же порогом, что и ночной (день теплее ночи, но не бесконечно).
  const T = TUNE.temp, d = daylight(hourOf(t)), day = t === G.time ? G.day : dayOf(t);
  const tn = day >= T.coldDay ? T.coldMin : T.night0 + T.nightStep * (day - 1);
  const td = Math.max(T.day0 + T.dayStep * (day - 1), T.coldMin);
  return Math.round(tn + (td - tn) * d + (stormOn(t) ? T.storm : 0));
}

const Weather = (() => {
  // новый день: пурга по таблице угроз главы (CHAPTERS[i].threat.storm — длительность, с), сияние
  function newDay() {
    const ch = CHAPTERS[G.chapter].threat, S = TUNE.storm;
    if (G.storm && G.storm.big && G.storm.b > G.time) { G.aurora = 0; return; } // «большая пурга» (глава VI) — назначена сюжетом, не перебивать
    if (ch.storm && Math.random() < S.chance) {
      const a = tAt(G.day, rnd(S.from, S.to)); G.storm = { a, b: a + ch.storm * rnd(S.lenMin, S.lenMax), omen: 0 };
    }
    G.aurora = Math.random() < TUNE.sky.auroraChance ? rnd(TUNE.sky.auroraMin, 1) : 0;
  }
  // предвестник и начало пурги; в пургу стая уходит
  function tick() {
    if (G.storm && !G.storm.omen && G.time > G.storm.a - TUNE.storm.omenT && G.time < G.storm.a) { G.storm.omen = 1; Fx.toast(':storm: Небо сереет — идёт пурга'); }
    if (stormOn() && !G.storm.said) { G.storm.said = 1; Fx.toast(G.storm.big ? ':storm: Большая пурга! Все — в укрытие' : ':storm: Пурга!'); if (G.pack) Wolves.retreatAll(); }
  }
  return { newDay, tick };
})();
